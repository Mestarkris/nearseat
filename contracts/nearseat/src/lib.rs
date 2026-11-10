//! # NearSeat
//!
//! Season memberships for Illia Stars United (fictional club) as NEP-171 NFTs.
//! Each membership owns a keyless vault sub-account
//! (`seat-c5-12.nearseat.testnet`) that holds its tUSDC. The vault obeys only
//! this contract, and this contract only obeys the **current** NFT owner,
//! read live from token state in the same receipt as every decision.
//!
//! Module map:
//! - `membership`: minting, vault creation, NEP-171/177/178/181/199 surface
//! - `money`: pool accumulator, settlement into vaults, withdrawals, callbacks
//! - `payments`: `ft_on_transfer` router (tickets, rentals, resale, top-ups)
//! - `matchday`: fixtures, kickoff/goal/full time/postpone, refunds
//! - `lending`: lending a seat for one match
//! - `market`: listing and seller-proof resale
//! - `gate`: check-in at the stadium gate
//! - `advance`, `autolend`, `voting`: Layer 2 features
//! - `category`: seat categories (price and pool weight by location)
//! - `views`, `svg`, `events`: read-only surface and the live feed

mod advance;
mod autolend;
mod category;
mod events;
mod gate;
mod lending;
mod market;
mod matchday;
mod membership;
mod migrate;
mod money;
mod payments;
mod svg;
mod types;
mod views;
mod voting;

pub use category::Category;
pub use types::*;

use near_contract_standards::non_fungible_token::metadata::NFTContractMetadata;
use near_contract_standards::non_fungible_token::NonFungibleToken;
use near_sdk::collections::LazyOption;
use near_sdk::json_types::{U128, U64};
use near_sdk::store::{IterableMap, LookupMap, LookupSet};
use near_sdk::{env, near, require, AccountId, BorshStorageKey, CryptoHash, PanicOnDefault};

#[derive(BorshStorageKey)]
#[near]
enum StorageKey {
    NftOwners,
    NftMetadata,
    NftEnumeration,
    NftApprovals,
    ContractMetadata,
    Members,
    PendingSeats,
    Matches,
    Payments,
    SoldSeats,
    TicketsPerAccount,
    Tickets,
    Loans,
    CheckIns,
    TicketCheckIns,
    History,
    Claimable,
    Feed,
    Polls,
    Votes,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct NearSeat {
    pub(crate) tokens: NonFungibleToken,
    pub(crate) metadata: LazyOption<NFTContractMetadata>,

    // Roles
    pub(crate) club: AccountId,
    pub(crate) gate: AccountId,
    pub(crate) stablecoin: AccountId,
    pub(crate) vault_code_hash: CryptoHash,

    // Season
    pub(crate) season_name: String,
    pub(crate) season_price: u128,
    pub(crate) max_supply: u32,
    pub(crate) config: Config,

    // Memberships
    pub(crate) members: IterableMap<TokenId, Member>,
    pub(crate) pending_seats: LookupSet<String>,
    pub(crate) history: LookupMap<(TokenId, u32), HistoryEntry>,

    // Matches and tickets
    pub(crate) matches: IterableMap<MatchId, Match>,
    pub(crate) payments: LookupMap<(MatchId, u32), Payment>,
    pub(crate) sold_seats: LookupMap<(MatchId, String), u32>,
    pub(crate) tickets_per_account: LookupMap<(MatchId, AccountId), u8>,
    pub(crate) tickets: LookupMap<TokenId, TicketInfo>,
    pub(crate) loans: LookupMap<(MatchId, TokenId), Loan>,
    pub(crate) check_ins: LookupMap<(MatchId, TokenId), CheckIn>,
    pub(crate) ticket_check_ins: LookupSet<TokenId>,
    pub(crate) next_match_id: MatchId,

    // Money
    pub(crate) acc_per_share: u128,
    pub(crate) pool_total_distributed: u128,
    pub(crate) club_balance: u128,
    pub(crate) advance_fund: u128,
    pub(crate) claimable: LookupMap<AccountId, u128>,
    pub(crate) payout_round: u32,
    pub(crate) round_settled: u32,

    // Live feed (ring buffer of the last FEED_SIZE events)
    pub(crate) feed: LookupMap<u64, FeedItem>,
    pub(crate) feed_seq: u64,

    // Layer 2
    pub(crate) polls: IterableMap<u32, voting::Poll>,
    pub(crate) votes: LookupSet<(u32, TokenId)>,
    pub(crate) next_poll_id: u32,

    /// Sum of every membership's pool weight (see `category`).
    pub(crate) total_weight: u128,
}

#[near]
impl NearSeat {
    /// Deploys the contract. `vault_code_hash` is the base58 hash of the vault
    /// global contract; it is fixed for the life of this contract.
    #[init]
    #[allow(clippy::too_many_arguments)]
    pub fn new(
        club: AccountId,
        gate: AccountId,
        stablecoin: AccountId,
        vault_code_hash: near_sdk::json_types::Base58CryptoHash,
        season_name: String,
        season_price: U128,
        max_supply: u32,
        config: Option<Config>,
    ) -> Self {
        let config = config.unwrap_or_default();
        config.assert_within_bounds();
        require!((1..=200).contains(&max_supply), "max_supply must be 1..200");
        require!(season_price.0 > 0, "season_price must be positive");
        let metadata = NFTContractMetadata {
            spec: near_contract_standards::non_fungible_token::metadata::NFT_METADATA_SPEC
                .to_string(),
            name: format!("NearSeat · Illia Stars United {season_name}"),
            symbol: "SEAT".to_string(),
            icon: Some(svg::crest_icon_data_uri()),
            base_uri: None,
            reference: None,
            reference_hash: None,
        };
        Self {
            tokens: NonFungibleToken::new(
                StorageKey::NftOwners,
                env::current_account_id(),
                Some(StorageKey::NftMetadata),
                Some(StorageKey::NftEnumeration),
                Some(StorageKey::NftApprovals),
            ),
            metadata: LazyOption::new(StorageKey::ContractMetadata, Some(&metadata)),
            club,
            gate,
            stablecoin,
            vault_code_hash: vault_code_hash.into(),
            season_name,
            season_price: season_price.0,
            max_supply,
            config,
            members: IterableMap::new(StorageKey::Members),
            pending_seats: LookupSet::new(StorageKey::PendingSeats),
            history: LookupMap::new(StorageKey::History),
            matches: IterableMap::new(StorageKey::Matches),
            payments: LookupMap::new(StorageKey::Payments),
            sold_seats: LookupMap::new(StorageKey::SoldSeats),
            tickets_per_account: LookupMap::new(StorageKey::TicketsPerAccount),
            tickets: LookupMap::new(StorageKey::Tickets),
            loans: LookupMap::new(StorageKey::Loans),
            check_ins: LookupMap::new(StorageKey::CheckIns),
            ticket_check_ins: LookupSet::new(StorageKey::TicketCheckIns),
            next_match_id: 1,
            acc_per_share: 0,
            pool_total_distributed: 0,
            club_balance: 0,
            advance_fund: 0,
            claimable: LookupMap::new(StorageKey::Claimable),
            payout_round: 0,
            round_settled: 0,
            feed: LookupMap::new(StorageKey::Feed),
            feed_seq: 0,
            polls: IterableMap::new(StorageKey::Polls),
            votes: LookupSet::new(StorageKey::Votes),
            next_poll_id: 1,
            total_weight: 0,
        }
    }

    /// Club-only. New values must stay inside the hard-coded bounds.
    pub fn set_config(&mut self, config: Config) {
        self.assert_club();
        config.assert_within_bounds();
        self.config = config;
        self.emit("config_updated", near_sdk::serde_json::json!({}));
    }

    /// Club-only. Rotates the gate scanner account (e.g. after a lost device).
    pub fn set_gate(&mut self, gate: AccountId) {
        self.assert_club();
        self.gate = gate.clone();
        self.emit("gate_rotated", near_sdk::serde_json::json!({ "gate": gate }));
    }
}

// ---------- shared internal helpers ----------
impl NearSeat {
    pub(crate) fn assert_club(&self) {
        require!(env::predecessor_account_id() == self.club, "only the club can do this");
    }

    pub(crate) fn assert_gate(&self) {
        require!(env::predecessor_account_id() == self.gate, "only the gate scanner can do this");
    }

    /// Live owner of a token, straight from NEP-171 state.
    pub(crate) fn owner_of(&self, token_id: &TokenId) -> AccountId {
        self.tokens
            .owner_by_id
            .get(token_id)
            .unwrap_or_else(|| env::panic_str("token not found"))
    }

    /// Requires the caller to be the live owner of a membership.
    pub(crate) fn assert_owner(&self, token_id: &TokenId) -> AccountId {
        let caller = env::predecessor_account_id();
        require!(
            self.members.contains_key(token_id),
            "not a membership token"
        );
        require!(self.owner_of(token_id) == caller, "only the current holder can do this");
        caller
    }

    pub(crate) fn member(&self, token_id: &TokenId) -> &Member {
        self.members
            .get(token_id)
            .unwrap_or_else(|| env::panic_str("membership not found"))
    }

    pub(crate) fn member_mut(&mut self, token_id: &TokenId) -> &mut Member {
        self.members
            .get_mut(token_id)
            .unwrap_or_else(|| env::panic_str("membership not found"))
    }

    pub(crate) fn match_ref(&self, match_id: MatchId) -> &Match {
        self.matches
            .get(&match_id)
            .unwrap_or_else(|| env::panic_str("match not found"))
    }

    pub(crate) fn match_mut(&mut self, match_id: MatchId) -> &mut Match {
        self.matches
            .get_mut(&match_id)
            .unwrap_or_else(|| env::panic_str("match not found"))
    }

    pub(crate) fn tier_of(&self, m: &Member) -> Tier {
        let attended = m.attended.len() as u32;
        let [s, g, l] = self.config.tier_thresholds;
        let earned = if attended >= l {
            Tier::Legend
        } else if attended >= g {
            Tier::Gold
        } else if attended >= s {
            Tier::Silver
        } else {
            Tier::Bronze
        };
        if (earned as u8) >= (m.tier_floor as u8) {
            earned
        } else {
            m.tier_floor
        }
    }

    /// Appends to a membership's public on-chain history.
    pub(crate) fn record(
        &mut self,
        token_id: &TokenId,
        kind: &str,
        amount: Option<u128>,
        account: Option<AccountId>,
        match_id: Option<MatchId>,
    ) {
        let idx = {
            let m = self.member_mut(token_id);
            let idx = m.history_len;
            m.history_len += 1;
            idx
        };
        self.history.insert(
            (token_id.clone(), idx),
            HistoryEntry {
                at: env::block_timestamp().into(),
                kind: kind.to_string(),
                amount: amount.map(U128),
                account,
                match_id,
            },
        );
    }

    pub(crate) fn add_claimable(&mut self, account: &AccountId, amount: u128) {
        let current = self.claimable.get(account).copied().unwrap_or(0);
        self.claimable.insert(account.clone(), current + amount);
    }
}

pub(crate) fn membership_token_id(seat: &str) -> TokenId {
    format!("seat-{seat}")
}

#[cfg(test)]
mod tests;
