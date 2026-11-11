//! Membership minting, vault creation and the NEP-171 / 177 / 178 / 181 surface.
//!
//! Transfers go through `before_transfer` and `after_transfer`, which enforce
//! the rules from the threat model: tickets are soulbound, a listed / indebted /
//! mid-withdrawal membership can't be moved, and every owner change clears
//! approvals (done by the standard), lend offers and auto-lend rules, and bumps
//! the state nonce.

use crate::*;
use near_contract_standards::non_fungible_token::approval::NonFungibleTokenApproval;
use near_contract_standards::non_fungible_token::core::{
    NonFungibleTokenCore, NonFungibleTokenResolver,
};
use near_contract_standards::non_fungible_token::enumeration::NonFungibleTokenEnumeration;
use near_contract_standards::non_fungible_token::metadata::{
    NonFungibleTokenMetadataProvider, TokenMetadata,
};
use near_contract_standards::non_fungible_token::Token;
use near_sdk::serde_json::json;
use near_sdk::{assert_one_yocto, ext_contract, Gas, NearToken, Promise, PromiseOrValue};
use std::collections::HashMap;

/// NEAR sent to each new vault so it can attach 1 yocto to `ft_transfer`.
pub const VAULT_FUNDING: NearToken = NearToken::from_millinear(20);
/// NEP-145 registration of the vault in the stablecoin contract.
pub const FT_STORAGE_DEPOSIT: NearToken = NearToken::from_micronear(2_500);
/// Club attaches this to `mint_membership`; covers vault + token storage.
pub const MINT_DEPOSIT: NearToken = NearToken::from_millinear(100);

const GAS_FOR_STORAGE_DEPOSIT: Gas = Gas::from_tgas(10);
const GAS_FOR_ON_VAULT_CREATED: Gas = Gas::from_tgas(30);

#[ext_contract(ext_ft_storage)]
#[allow(dead_code)]
trait FtStorage {
    fn storage_deposit(&mut self, account_id: Option<AccountId>, registration_only: Option<bool>);
}

#[ext_contract(ext_self_mint)]
#[allow(dead_code)]
trait SelfMint {
    fn on_vault_created(&mut self, seat: String, owner_id: AccountId, tier_floor: Tier);
    fn on_vault_bought(&mut self, seat: String, buyer: AccountId, amount: U128) -> U128;
}

/// Seats are `<stand a-d><row 1-6>-<number 1-15>`, e.g. `c5-12`. 4 × 6 × 15 = 360 seats.
pub fn assert_valid_seat(seat: &str) {
    let ok = (|| {
        let (left, num) = seat.split_once('-')?;
        let mut chars = left.chars();
        let stand = chars.next()?;
        let row: u8 = chars.as_str().parse().ok()?;
        let n: u8 = num.parse().ok()?;
        let canonical = format!("{stand}{row}-{n}") == seat;
        Some(canonical && ('a'..='d').contains(&stand) && (1..=6).contains(&row) && (1..=15).contains(&n))
    })()
    .unwrap_or(false);
    require!(ok, "invalid seat: expected <a-d><1-6>-<1-15>, e.g. c5-12");
}

#[near]
impl NearSeat {
    /// Club-only. Creates the keyless vault `seat-<seat>.<this contract>` running
    /// the global vault code, then mints the membership NFT to `owner_id`.
    /// The vault is created with **no access keys**.
    #[payable]
    pub fn mint_membership(
        &mut self,
        seat: String,
        owner_id: AccountId,
        tier_floor: Option<Tier>,
    ) -> Promise {
        self.assert_club();
        require!(
            env::attached_deposit() >= MINT_DEPOSIT,
            format!("attach at least {MINT_DEPOSIT} to cover the vault and storage")
        );
        self.start_vault_creation(&seat)
            .then(
                ext_self_mint::ext(env::current_account_id())
                    .with_static_gas(GAS_FOR_ON_VAULT_CREATED)
                    .on_vault_created(seat, owner_id, tier_floor.unwrap_or(Tier::Bronze)),
            )
    }

    /// Mints the NFT only if the vault account was created. If the token
    /// registration failed, settlement into that vault fails safely and is
    /// restored by its callback until `register_vault` is called.
    #[private]
    pub fn on_vault_created(&mut self, seat: String, owner_id: AccountId, tier_floor: Tier) -> bool {
        self.pending_seats.remove(&seat);
        let created = env::promise_result_checked(0, 64).is_ok();
        if !created {
            self.emit("vault_create_failed", json!({ "seat": seat }));
            return false;
        }
        self.mint_to(&seat, &owner_id, tier_floor);
        true
    }

    /// Callback for a fan buying a new membership from the club with tUSDC
    /// (`BuyNewMembership` in `ft_on_transfer`). Returns the unused amount:
    /// 0 on success, or the full price if the vault couldn't be created, which
    /// makes the stablecoin refund the buyer automatically (NEP-141 resolve).
    #[private]
    pub fn on_vault_bought(&mut self, seat: String, buyer: AccountId, amount: U128) -> U128 {
        self.pending_seats.remove(&seat);
        if env::promise_result_checked(0, 64).is_err() {
            self.emit("vault_create_failed", json!({ "seat": seat, "refunded": buyer }));
            return amount;
        }
        self.mint_to(&seat, &buyer, Tier::Bronze);
        self.club_balance += amount.0;
        let token_id = membership_token_id(&seat);
        self.record(&token_id, "bought_from_club", Some(amount.0), Some(buyer.clone()), None);
        self.emit("membership_bought", json!({ "token_id": token_id, "buyer": buyer, "price": amount }));
        U128(0)
    }

    /// Anyone can (re)register a vault in the stablecoin if minting's
    /// registration step failed. Caller pays the NEP-145 deposit.
    #[payable]
    pub fn register_vault(&mut self, token_id: TokenId) -> Promise {
        require!(env::attached_deposit() >= FT_STORAGE_DEPOSIT, "attach the storage deposit");
        let vault = self.member(&token_id).vault.clone();
        ext_ft_storage::ext(self.stablecoin.clone())
            .with_attached_deposit(env::attached_deposit())
            .with_static_gas(GAS_FOR_STORAGE_DEPOSIT)
            .storage_deposit(Some(vault), Some(true))
    }
}

// ---------- minting helpers (club mint and fan purchase share these) ----------
impl NearSeat {
    /// Checks the seat can become a membership, reserves it, and starts creating
    /// its keyless vault: CreateAccount + Transfer + UseGlobalContract, deliberately
    /// no AddKey, plus the vault's NEP-145 registration in the stablecoin.
    pub(crate) fn start_vault_creation(&mut self, seat: &str) -> Promise {
        assert_valid_seat(seat);
        let token_id = membership_token_id(seat);
        require!(!self.members.contains_key(&token_id), "seat already has a membership");
        require!(!self.pending_seats.contains(&seat.to_string()), "a purchase for this seat is in progress");
        require!((self.members.len() + 1) <= self.max_supply, "season membership supply is exhausted");
        // A seat already sold as a single-match ticket for an upcoming match can't
        // also become a membership, or two people would hold that seat's gate pass.
        let taken = self
            .matches
            .values()
            .filter(|m| matches!(m.status, MatchStatus::Scheduled | MatchStatus::Live))
            .any(|m| self.sold_seats.contains_key(&(m.id, seat.to_string())));
        require!(!taken, "seat is sold as a single-match ticket for an upcoming match");
        self.pending_seats.insert(seat.to_string());

        let vault: AccountId = format!("{token_id}.{}", env::current_account_id())
            .parse()
            .unwrap_or_else(|_| env::panic_str("vault account id is invalid"));
        Promise::new(vault.clone())
            .create_account()
            .transfer(VAULT_FUNDING)
            .use_global_contract(self.vault_code_hash)
            .and(
                ext_ft_storage::ext(self.stablecoin.clone())
                    .with_attached_deposit(FT_STORAGE_DEPOSIT)
                    .with_static_gas(GAS_FOR_STORAGE_DEPOSIT)
                    .storage_deposit(Some(vault), Some(true)),
            )
    }

    /// A fan buys a brand-new membership from the club with tUSDC (called from
    /// `ft_on_transfer`). The price must be exactly the season price; the money
    /// is credited to the club only after the vault exists, otherwise refunded.
    /// The contract's own NEAR pays for the vault account and its storage.
    pub(crate) fn internal_buy_new_membership(&mut self, buyer: AccountId, amount: u128, seat: String) -> Promise {
        require!(
            amount == Category::of_seat(&seat).price(self.season_price),
            "send exactly the season price for this seat's category"
        );
        self.start_vault_creation(&seat).then(
            ext_self_mint::ext(env::current_account_id())
                .with_static_gas(GAS_FOR_ON_VAULT_CREATED)
                .on_vault_bought(seat, buyer, U128(amount)),
        )
    }

    /// Mints the membership NFT and its state once the vault exists.
    pub(crate) fn mint_to(&mut self, seat: &str, owner_id: &AccountId, tier_floor: Tier) {
        let seat = seat.to_string();
        let owner_id = owner_id.clone();
        let token_id = membership_token_id(&seat);
        let vault: AccountId = format!("{token_id}.{}", env::current_account_id()).parse().unwrap();
        let now = env::block_timestamp();

        let metadata = TokenMetadata {
            title: Some(format!("Illia Stars United · Seat {}", seat.to_uppercase())),
            description: Some(format!(
                "Season membership {}. This NFT owns the keyless account {vault}. \
                 Whoever holds the NFT controls the account.",
                self.season_name
            )),
            media: None,
            media_hash: None,
            copies: Some(1),
            issued_at: Some(now.to_string()),
            expires_at: None,
            starts_at: None,
            updated_at: None,
            extra: None,
            reference: None,
            reference_hash: None,
        };
        self.tokens.internal_mint_with_refund(token_id.clone(), owner_id.clone(), Some(metadata), None);
        near_contract_standards::non_fungible_token::events::NftMint {
            owner_id: &owner_id,
            token_ids: &[&token_id],
            memo: None,
        }
        .emit();

        self.total_weight += Category::of_seat(&seat).weight();
        self.members.insert(
            token_id.clone(),
            Member {
                seat: seat.clone(),
                vault: vault.clone(),
                tier_floor,
                minted_at: now,
                acc_snapshot: self.acc_per_share,
                credit: 0,
                pending_loan_income: vec![],
                vault_balance: 0,
                outflows_in_flight: 0,
                nonce: 0,
                listing: None,
                debt: 0,
                attended: vec![],
                food_credits: 10,
                holders: vec![(owner_id.clone(), now)],
                totals: MemberTotals::default(),
                history_len: 0,
                last_settled_round: self.payout_round,
                open_offers: vec![],
                autolend_rules: vec![],
            },
        );
        self.record(&token_id, "minted", None, Some(owner_id.clone()), None);
        self.emit(
            "membership_minted",
            json!({ "token_id": token_id, "owner_id": owner_id, "vault": vault, "seat": seat }),
        );
    }
}

// ---------- transfer hooks ----------
impl NearSeat {
    pub(crate) fn before_transfer(&self, token_id: &TokenId) {
        require!(!self.tickets.contains_key(token_id), "single-match tickets are non-transferable");
        if let Some(m) = self.members.get(token_id) {
            require!(m.listing.is_none(), "membership is listed; delist or sell via buy");
            require!(m.debt == 0, "repay the advance before transferring");
            require!(m.outflows_in_flight == 0, "a withdrawal is still in flight");
        }
    }

    /// Runs after every owner change of a membership, whatever the path.
    pub(crate) fn after_transfer(&mut self, token_id: &TokenId, from: &AccountId, to: &AccountId, reason: &str) {
        if !self.members.contains_key(token_id) {
            return;
        }
        let now = env::block_timestamp();
        let offers = {
            let m = self.member_mut(token_id);
            m.listing = None;
            m.nonce += 1;
            m.holders.push((to.clone(), now));
            m.autolend_rules.clear();
            std::mem::take(&mut m.open_offers)
        };
        self.clear_renewal_saving(token_id);
        // Un-rented offers die with the sale. Paid rentals stay: the renter keeps that match.
        for match_id in offers {
            let key = (match_id, token_id.clone());
            if matches!(self.loans.get(&key), Some(Loan::Offered { .. })) {
                self.loans.remove(&key);
            }
        }
        self.record(token_id, reason, None, Some(to.clone()), None);
        self.emit(
            "membership_transferred",
            json!({ "token_id": token_id, "from": from, "to": to, "reason": reason }),
        );
    }

    fn decorate(&self, mut token: Token) -> Token {
        if let Some(meta) = token.metadata.as_mut() {
            if self.members.contains_key(&token.token_id) {
                meta.media = Some(self.membership_svg_data_uri(&token.token_id));
            } else if let Some(t) = self.tickets.get(&token.token_id) {
                meta.media = Some(svg::ticket_svg_data_uri(t, self.matches.get(&t.match_id)));
            }
        }
        token
    }
}

// ---------- NEP-171 core ----------
#[near]
impl NonFungibleTokenCore for NearSeat {
    #[payable]
    fn nft_transfer(
        &mut self,
        receiver_id: AccountId,
        token_id: TokenId,
        approval_id: Option<u64>,
        memo: Option<String>,
    ) {
        assert_one_yocto();
        self.before_transfer(&token_id);
        let from = self.owner_of(&token_id);
        self.tokens.nft_transfer(receiver_id.clone(), token_id.clone(), approval_id, memo);
        self.after_transfer(&token_id, &from, &receiver_id, "transfer");
    }

    #[payable]
    fn nft_transfer_call(
        &mut self,
        receiver_id: AccountId,
        token_id: TokenId,
        approval_id: Option<u64>,
        memo: Option<String>,
        msg: String,
    ) -> PromiseOrValue<bool> {
        assert_one_yocto();
        self.before_transfer(&token_id);
        let from = self.owner_of(&token_id);
        let result = self.tokens.nft_transfer_call(
            receiver_id.clone(),
            token_id.clone(),
            approval_id,
            memo,
            msg,
        );
        self.after_transfer(&token_id, &from, &receiver_id, "transfer");
        result
    }

    fn nft_token(&self, token_id: TokenId) -> Option<Token> {
        self.tokens.nft_token(token_id).map(|t| self.decorate(t))
    }
}

#[near]
impl NonFungibleTokenResolver for NearSeat {
    #[private]
    fn nft_resolve_transfer(
        &mut self,
        previous_owner_id: AccountId,
        receiver_id: AccountId,
        token_id: TokenId,
        approved_account_ids: Option<HashMap<AccountId, u64>>,
    ) -> bool {
        let kept = self.tokens.nft_resolve_transfer(
            previous_owner_id.clone(),
            receiver_id.clone(),
            token_id.clone(),
            approved_account_ids,
        );
        if !kept {
            // Receiver returned the token: log the move back so history stays true.
            self.after_transfer(&token_id, &receiver_id, &previous_owner_id, "returned");
        }
        kept
    }
}

// ---------- NEP-178 approvals ----------
#[near]
impl NonFungibleTokenApproval for NearSeat {
    #[payable]
    fn nft_approve(
        &mut self,
        token_id: TokenId,
        account_id: AccountId,
        msg: Option<String>,
    ) -> Option<Promise> {
        require!(!self.tickets.contains_key(&token_id), "single-match tickets are non-transferable");
        self.tokens.nft_approve(token_id, account_id, msg)
    }

    #[payable]
    fn nft_revoke(&mut self, token_id: TokenId, account_id: AccountId) {
        self.tokens.nft_revoke(token_id, account_id)
    }

    #[payable]
    fn nft_revoke_all(&mut self, token_id: TokenId) {
        self.tokens.nft_revoke_all(token_id)
    }

    fn nft_is_approved(
        &self,
        token_id: TokenId,
        approved_account_id: AccountId,
        approval_id: Option<u64>,
    ) -> bool {
        self.tokens.nft_is_approved(token_id, approved_account_id, approval_id)
    }
}

// ---------- NEP-181 enumeration ----------
#[near]
impl NonFungibleTokenEnumeration for NearSeat {
    fn nft_total_supply(&self) -> U128 {
        self.tokens.nft_total_supply()
    }

    fn nft_tokens(&self, from_index: Option<U128>, limit: Option<u64>) -> Vec<Token> {
        self.tokens
            .nft_tokens(from_index, limit)
            .into_iter()
            .map(|t| self.decorate(t))
            .collect()
    }

    fn nft_supply_for_owner(&self, account_id: AccountId) -> U128 {
        self.tokens.nft_supply_for_owner(account_id)
    }

    fn nft_tokens_for_owner(
        &self,
        account_id: AccountId,
        from_index: Option<U128>,
        limit: Option<u64>,
    ) -> Vec<Token> {
        self.tokens
            .nft_tokens_for_owner(account_id, from_index, limit)
            .into_iter()
            .map(|t| self.decorate(t))
            .collect()
    }
}

// ---------- NEP-177 metadata ----------
#[near]
impl NonFungibleTokenMetadataProvider for NearSeat {
    fn nft_metadata(&self) -> near_contract_standards::non_fungible_token::metadata::NFTContractMetadata {
        self.metadata.get().expect("metadata set at init")
    }
}
