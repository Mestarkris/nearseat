//! Seller-proof resale.
//!
//! `list` freezes the vault: no withdrawals, loans or advances. Every outflow
//! and every listing change bumps `nonce`. A buyer pays with
//! `ft_transfer_call(msg = BuyMembership { token_id, expected_nonce })`, and the
//! purchase only goes through if the nonce still matches what they inspected
//! and nothing is leaving the vault. NFT ownership, and with it vault control,
//! balance, inventory, record and access, moves in that one receipt.
//! The sale price pays the club royalty (NEP-199) and any open advance first;
//! the seller gets exactly the rest.

use crate::*;
use near_contract_standards::non_fungible_token::core::NonFungibleTokenCore;
use near_contract_standards::non_fungible_token::events::NftTransfer;
use near_sdk::assert_one_yocto;
use near_sdk::serde_json::json;
use std::collections::HashMap;

/// Split of a sale price, in the order it is paid.
pub(crate) struct Split {
    pub royalty: u128,
    pub advance_repaid: u128,
    pub seller: u128,
}

#[near]
impl NearSeat {
    #[payable]
    pub fn list(&mut self, token_id: TokenId, price: U128) {
        assert_one_yocto();
        self.assert_owner(&token_id);
        let cap = self.resale_cap_for(&token_id);
        require!(price.0 > 0 && price.0 <= cap, format!("price must be 1..{cap} (resale cap)"));
        {
            let m = self.member_mut(&token_id);
            require!(m.listing.is_none(), "already listed");
            m.listing = Some(Listing { price, listed_at: env::block_timestamp().into() });
            m.nonce += 1;
        }
        self.record(&token_id, "listed", Some(price.0), None, None);
        self.emit("listed", json!({ "token_id": token_id, "price": price }));
    }

    #[payable]
    pub fn delist(&mut self, token_id: TokenId) {
        assert_one_yocto();
        self.assert_owner(&token_id);
        {
            let m = self.member_mut(&token_id);
            require!(m.listing.is_some(), "not listed");
            m.listing = None;
            m.nonce += 1;
        }
        self.record(&token_id, "delisted", None, None, None);
        self.emit("delisted", json!({ "token_id": token_id }));
    }

    /// Maximum resale price for a standard-category membership.
    pub fn resale_cap(&self) -> U128 {
        U128(self.season_price * self.config.resale_cap_bps as u128 / BPS)
    }

    /// Maximum resale price for this membership: the cap applies to what a
    /// seat of its category costs.
    pub fn resale_cap_of(&self, token_id: TokenId) -> U128 {
        U128(self.resale_cap_for(&token_id))
    }

    pub(crate) fn resale_cap_for(&self, token_id: &TokenId) -> u128 {
        let category = Category::of_seat(&self.member(token_id).seat);
        category.price(self.season_price) * self.config.resale_cap_bps as u128 / BPS
    }

    /// NEP-199. Payout for selling `token_id` at `balance`.
    pub fn nft_payout(&self, token_id: TokenId, balance: U128, max_len_payout: Option<u32>) -> Payout {
        let owner = self.owner_of(&token_id);
        let split = self.split(&token_id, balance.0);
        require!(split.advance_repaid == 0, "membership has an open advance; sell via the NearSeat market");
        let mut payout = HashMap::new();
        if split.royalty > 0 {
            payout.insert(self.club.clone(), U128(split.royalty));
        }
        *payout.entry(owner).or_insert(U128(0)) = U128(split.seller);
        if let Some(max) = max_len_payout {
            require!(payout.len() as u32 <= max, "max_len_payout too small");
        }
        Payout { payout }
    }

    /// NEP-199 transfer for external marketplaces holding a NEP-178 approval.
    /// Same rules as the built-in market: price cap, no open advance, nothing in flight.
    #[payable]
    pub fn nft_transfer_payout(
        &mut self,
        receiver_id: AccountId,
        token_id: TokenId,
        approval_id: Option<u64>,
        memo: Option<String>,
        balance: U128,
        max_len_payout: Option<u32>,
    ) -> Payout {
        assert_one_yocto();
        require!(self.members.contains_key(&token_id), "only memberships can be resold");
        require!(balance.0 <= self.resale_cap_for(&token_id), "price is above the resale cap");
        self.before_transfer(&token_id);
        let payout = self.nft_payout(token_id.clone(), balance, max_len_payout);
        let from = self.owner_of(&token_id);
        self.tokens.nft_transfer(receiver_id.clone(), token_id.clone(), approval_id, memo);
        self.after_transfer(&token_id, &from, &receiver_id, "sold");
        payout
    }
}

impl NearSeat {
    pub(crate) fn split(&self, token_id: &TokenId, price: u128) -> Split {
        let royalty = price * self.config.resale_fee_bps as u128 / BPS;
        let advance_repaid = self.member(token_id).debt.min(price - royalty);
        Split { royalty, advance_repaid, seller: price - royalty - advance_repaid }
    }

    /// Called from `ft_on_transfer`. Any failed check panics, which refunds
    /// the buyer in full and leaves the membership untouched.
    pub(crate) fn internal_buy_membership(
        &mut self,
        buyer: AccountId,
        amount: u128,
        token_id: TokenId,
        expected_nonce: u64,
    ) {
        let seller = self.owner_of(&token_id);
        {
            let m = self.member(&token_id);
            let listing = m.listing.as_ref().unwrap_or_else(|| env::panic_str("membership is not listed"));
            require!(amount == listing.price.0, "send exactly the listed price");
            require!(m.nonce == expected_nonce, "vault changed since you looked; refresh and try again");
            require!(m.outflows_in_flight == 0, "a withdrawal is in flight; try again shortly");
        }
        require!(buyer != seller, "you already hold this membership");

        let split = self.split(&token_id, amount);
        // Move the NFT. internal_transfer also clears every NEP-178 approval.
        self.tokens.internal_transfer(&seller, &buyer, &token_id, None, Some("resale".into()));
        NftTransfer {
            old_owner_id: &seller,
            new_owner_id: &buyer,
            token_ids: &[&token_id],
            authorized_id: None,
            memo: Some("resale"),
        }
        .emit();

        {
            let m = self.member_mut(&token_id);
            m.debt -= split.advance_repaid;
            m.totals.advances_repaid = U128(m.totals.advances_repaid.0 + split.advance_repaid);
        }
        self.advance_fund += split.advance_repaid;
        self.club_balance += split.royalty;
        self.after_transfer(&token_id, &seller, &buyer, "sold");
        self.record(&token_id, "sale_price", Some(amount), Some(seller.clone()), None);
        if split.advance_repaid > 0 {
            self.record(&token_id, "advance_repaid", Some(split.advance_repaid), None, None);
        }
        if split.seller > 0 {
            self.pay_person(&seller, split.seller, "resale proceeds").detach();
        }
        self.emit(
            "membership_sold",
            json!({
                "token_id": token_id,
                "seller": seller,
                "buyer": buyer,
                "price": U128(amount),
                "royalty": U128(split.royalty),
                "advance_repaid": U128(split.advance_repaid),
                "seller_received": U128(split.seller),
            }),
        );
    }
}
