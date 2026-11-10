//! One-off state migration for the seat-categories upgrade.
//!
//! Before: the members' pool was split equally, `acc_per_share` counted tUSDC
//! per membership. After: it counts tUSDC per unit of weight (see `category`).
//! The migration pays every membership what it was owed under the old rule into
//! its credit, then restarts the accumulator in the new unit. Nobody loses a
//! cent that was already earned.
//!
//! Sent in the same transaction as the code deploy, so a failure here rolls the
//! deploy back too. It can't run twice: the new state no longer parses as the
//! old layout.

use crate::category::Category;
use crate::*;

#[near(serializers = [borsh])]
pub struct OldNearSeat {
    pub(crate) tokens: NonFungibleToken,
    pub(crate) metadata: LazyOption<NFTContractMetadata>,
    pub(crate) club: AccountId,
    pub(crate) gate: AccountId,
    pub(crate) stablecoin: AccountId,
    pub(crate) vault_code_hash: CryptoHash,
    pub(crate) season_name: String,
    pub(crate) season_price: u128,
    pub(crate) max_supply: u32,
    pub(crate) config: Config,
    pub(crate) members: IterableMap<TokenId, Member>,
    pub(crate) pending_seats: LookupSet<String>,
    pub(crate) history: LookupMap<(TokenId, u32), HistoryEntry>,
    pub(crate) matches: IterableMap<MatchId, Match>,
    pub(crate) payments: LookupMap<(MatchId, u32), Payment>,
    pub(crate) sold_seats: LookupMap<(MatchId, String), u32>,
    pub(crate) tickets_per_account: LookupMap<(MatchId, AccountId), u8>,
    pub(crate) tickets: LookupMap<TokenId, TicketInfo>,
    pub(crate) loans: LookupMap<(MatchId, TokenId), Loan>,
    pub(crate) check_ins: LookupMap<(MatchId, TokenId), CheckIn>,
    pub(crate) ticket_check_ins: LookupSet<TokenId>,
    pub(crate) next_match_id: MatchId,
    pub(crate) acc_per_share: u128,
    pub(crate) pool_total_distributed: u128,
    pub(crate) club_balance: u128,
    pub(crate) advance_fund: u128,
    pub(crate) claimable: LookupMap<AccountId, u128>,
    pub(crate) payout_round: u32,
    pub(crate) round_settled: u32,
    pub(crate) feed: LookupMap<u64, FeedItem>,
    pub(crate) feed_seq: u64,
    pub(crate) polls: IterableMap<u32, voting::Poll>,
    pub(crate) votes: LookupSet<(u32, TokenId)>,
    pub(crate) next_poll_id: u32,
}

#[near]
impl NearSeat {
    #[private]
    #[init(ignore_state)]
    pub fn migrate_categories() -> Self {
        let old: OldNearSeat = env::state_read().unwrap_or_else(|| env::panic_str("old state not found"));
        let old_acc = old.acc_per_share;
        let mut c = Self {
            tokens: old.tokens,
            metadata: old.metadata,
            club: old.club,
            gate: old.gate,
            stablecoin: old.stablecoin,
            vault_code_hash: old.vault_code_hash,
            season_name: old.season_name,
            season_price: old.season_price,
            max_supply: old.max_supply,
            config: old.config,
            members: old.members,
            pending_seats: old.pending_seats,
            history: old.history,
            matches: old.matches,
            payments: old.payments,
            sold_seats: old.sold_seats,
            tickets_per_account: old.tickets_per_account,
            tickets: old.tickets,
            loans: old.loans,
            check_ins: old.check_ins,
            ticket_check_ins: old.ticket_check_ins,
            next_match_id: old.next_match_id,
            acc_per_share: 0,
            pool_total_distributed: old.pool_total_distributed,
            club_balance: old.club_balance,
            advance_fund: old.advance_fund,
            claimable: old.claimable,
            payout_round: old.payout_round,
            round_settled: old.round_settled,
            feed: old.feed,
            feed_seq: old.feed_seq,
            polls: old.polls,
            votes: old.votes,
            next_poll_id: old.next_poll_id,
            total_weight: 0,
        };
        let ids: Vec<TokenId> = c.members.keys().cloned().collect();
        let mut total_weight = 0u128;
        for id in &ids {
            let m = c.member_mut(id);
            // Old rule: one equal share per membership.
            let owed = (old_acc - m.acc_snapshot) / ACC_SCALE;
            m.credit += owed;
            m.totals.pool_earned = U128(m.totals.pool_earned.0 + owed);
            m.acc_snapshot = 0;
            total_weight += Category::of_seat(&m.seat).weight();
        }
        c.total_weight = total_weight;
        c.emit(
            "categories_enabled",
            near_sdk::serde_json::json!({ "memberships": ids.len(), "total_weight": U128(total_weight) }),
        );
        c
    }
}
