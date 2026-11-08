//! Every tUSDC payment enters through `ft_on_transfer`.
//!
//! If any check fails we panic. NEP-141 then refunds the whole amount to the
//! sender in `ft_resolve_transfer`, and all state changes in this receipt are
//! rolled back. So a buyer can never pay for a seat or membership they don't get.

use crate::*;
use near_contract_standards::fungible_token::receiver::FungibleTokenReceiver;
use near_contract_standards::non_fungible_token::metadata::TokenMetadata;
use near_sdk::serde_json::{self, json};
use near_sdk::PromiseOrValue;

#[near]
impl FungibleTokenReceiver for NearSeat {
    fn ft_on_transfer(
        &mut self,
        sender_id: AccountId,
        amount: U128,
        msg: String,
    ) -> PromiseOrValue<U128> {
        require!(
            env::predecessor_account_id() == self.stablecoin,
            "only the season stablecoin is accepted"
        );
        let message: FtMessage =
            serde_json::from_str(&msg).unwrap_or_else(|_| env::panic_str("unknown payment message"));
        match message {
            FtMessage::BuySeat { match_id, seat } => self.buy_seat(sender_id, amount.0, match_id, seat),
            FtMessage::BuyMembership { token_id, expected_nonce } => {
                self.internal_buy_membership(sender_id, amount.0, token_id, expected_nonce.0)
            }
            FtMessage::TopUpPool => {
                self.distribute_to_pool(amount.0);
                self.emit("pool_topped_up", json!({ "from": sender_id, "amount": amount }));
            }
            FtMessage::TopUpAdvanceFund => {
                self.advance_fund += amount.0;
                self.emit("advance_fund_topped_up", json!({ "from": sender_id, "amount": amount }));
            }
        }
        PromiseOrValue::Value(U128(0))
    }
}

impl NearSeat {
    fn buy_seat(&mut self, buyer: AccountId, amount: u128, match_id: MatchId, seat: String) {
        membership::assert_valid_seat(&seat);
        let (status, ticket_price, big, priority_until) = {
            let m = self.match_ref(match_id);
            (m.status, m.ticket_price.0, m.big_match, m.priority_until.0)
        };
        require!(status == MatchStatus::Scheduled, "sales are closed for this match");
        require!(
            !self.sold_seats.contains_key(&(match_id, seat.clone())),
            "seat already taken for this match"
        );
        let payment_index = self.match_ref(match_id).payment_count;

        let token_id = membership_token_id(&seat);
        let kind = if self.members.contains_key(&token_id) {
            self.rent_member_seat(&buyer, amount, match_id, &token_id)
        } else {
            self.sell_club_seat(&buyer, amount, match_id, &seat, ticket_price, big, priority_until, payment_index)
        };

        self.sold_seats.insert((match_id, seat.clone()), payment_index);
        self.payments.insert(
            (match_id, payment_index),
            Payment { payer: buyer, amount: U128(amount), kind, status: PaymentStatus::Paid },
        );
        self.match_mut(match_id).payment_count += 1;
    }

    /// A member's seat can only be sold if that member offered it for this match.
    fn rent_member_seat(
        &mut self,
        renter: &AccountId,
        amount: u128,
        match_id: MatchId,
        token_id: &TokenId,
    ) -> PaymentKind {
        let key = (match_id, token_id.clone());
        let (price, to) = match self.loans.get(&key) {
            Some(Loan::Offered { price, to, .. }) => (price.0, to.clone()),
            Some(Loan::Rented { .. }) => env::panic_str("seat already rented for this match"),
            None => env::panic_str("this member seat is not offered for this match"),
        };
        require!(amount == price, "send exactly the rental price");
        if let Some(to) = to {
            require!(&to == renter, "this seat is lent privately to another account");
        }
        require!(&self.owner_of(token_id) != renter, "you already hold this membership");

        let fee = price * self.config.lend_club_fee_bps as u128 / BPS;
        let net = price - fee;
        self.loans.insert(key, Loan::Rented { price: U128(price), renter: renter.clone() });
        let seat = {
            let m = self.member_mut(token_id);
            m.open_offers.retain(|id| *id != match_id);
            m.pending_loan_income.push((match_id, net));
            m.seat.clone()
        };
        {
            let mm = self.match_mut(match_id);
            mm.rental_fees = U128(mm.rental_fees.0 + fee);
            mm.seats_rented += 1;
        }
        self.record(token_id, "rented", Some(net), Some(renter.clone()), Some(match_id));
        self.emit(
            "seat_rented",
            json!({ "token_id": token_id, "match_id": match_id, "renter": renter, "price": U128(price) }),
        );
        PaymentKind::Rental { seat, token_id: token_id.clone() }
    }

    #[allow(clippy::too_many_arguments)]
    fn sell_club_seat(
        &mut self,
        buyer: &AccountId,
        amount: u128,
        match_id: MatchId,
        seat: &str,
        ticket_price: u128,
        big_match: bool,
        priority_until: u64,
        payment_index: u32,
    ) -> PaymentKind {
        require!(amount == ticket_price, "send exactly the ticket price");
        let count_key = (match_id, buyer.clone());
        let bought = self.tickets_per_account.get(&count_key).copied().unwrap_or(0);
        require!(
            bought < self.config.max_tickets_per_account,
            "ticket limit per account reached for this match"
        );
        if big_match && env::block_timestamp() < priority_until {
            require!(
                self.holds_tier_at_least(buyer, Tier::Gold),
                "priority window: only Gold and Legend members can buy now"
            );
        }
        self.tickets_per_account.insert(count_key, bought + 1);

        let ticket_id = format!("t{match_id}-{seat}");
        let opponent = self.match_ref(match_id).opponent.clone();
        let metadata = TokenMetadata {
            title: Some(format!("Illia Stars United v {opponent} · Seat {}", seat.to_uppercase())),
            description: Some("Single-match ticket. Non-transferable; refunded automatically if the match is postponed.".into()),
            media: None,
            media_hash: None,
            copies: Some(1),
            issued_at: Some(env::block_timestamp().to_string()),
            expires_at: None,
            starts_at: None,
            updated_at: None,
            extra: None,
            reference: None,
            reference_hash: None,
        };
        self.tokens.internal_mint_with_refund(ticket_id.clone(), buyer.clone(), Some(metadata), None);
        near_contract_standards::non_fungible_token::events::NftMint {
            owner_id: buyer,
            token_ids: &[&ticket_id],
            memo: None,
        }
        .emit();
        self.tickets.insert(
            ticket_id.clone(),
            TicketInfo { match_id, seat: seat.to_string(), buyer: buyer.clone(), payment_index },
        );
        {
            let m = self.match_mut(match_id);
            m.escrow = U128(m.escrow.0 + amount);
            m.tickets_sold += 1;
        }
        self.emit(
            "ticket_sold",
            json!({ "match_id": match_id, "seat": seat, "buyer": buyer, "price": U128(amount), "ticket_id": ticket_id }),
        );
        PaymentKind::Ticket { seat: seat.to_string(), ticket_id }
    }

    pub(crate) fn holds_tier_at_least(&self, account: &AccountId, tier: Tier) -> bool {
        let Some(owned) = self.tokens.tokens_per_owner.as_ref().and_then(|t| t.get(account)) else {
            return false;
        };
        let found = owned
            .iter()
            .filter_map(|id| self.members.get(&id))
            .any(|m| (self.tier_of(m) as u8) >= (tier as u8));
        found
    }
}
