//! Plain data types stored in contract state and returned by views.

use near_sdk::json_types::{U128, U64};
use near_sdk::{near, AccountId};

pub type MatchId = u32;
/// Membership token ids look like `seat-c5-12`; ticket ids look like `t2-a1-07`.
pub type TokenId = String;

/// Fixed-point scale for the reward-per-share accumulator.
pub const ACC_SCALE: u128 = 1_000_000_000_000_000_000; // 1e18

/// Basis points denominator (10_000 = 100%).
pub const BPS: u128 = 10_000;

#[near(serializers = [borsh, json])]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Tier {
    Bronze,
    Silver,
    Gold,
    Legend,
}

impl Tier {
    pub fn label(self) -> &'static str {
        match self {
            Tier::Bronze => "BRONZE",
            Tier::Silver => "SILVER",
            Tier::Gold => "GOLD",
            Tier::Legend => "LEGEND",
        }
    }
}

/// Fees, caps and thresholds. Every setter is clamped to the bounds in
/// `Config::assert_within_bounds`, so the club can't set abusive values.
#[near(serializers = [borsh, json])]
#[derive(Clone, Debug)]
pub struct Config {
    /// Share of each match's single-ticket revenue paid to members (bps).
    pub members_cut_bps: u16,
    /// Club fee taken from seat-lending income (bps).
    pub lend_club_fee_bps: u16,
    /// Lend price cap as a multiple of the match's face value (bps).
    pub lend_cap_bps: u16,
    /// NEP-199 resale royalty to the club (bps).
    pub resale_fee_bps: u16,
    /// Resale price cap as a multiple of the season price (bps).
    pub resale_cap_bps: u16,
    /// Max single-match tickets one account can buy for one match.
    pub max_tickets_per_account: u8,
    /// Attendance needed for Silver, Gold, Legend.
    pub tier_thresholds: [u32; 3],
    /// Max advance as a share of expected remaining-season income (bps).
    pub advance_cap_bps: u16,
    /// Club's published estimate of members' income per membership per match,
    /// used only to cap advances.
    pub expected_share_per_match: U128,
}

impl Default for Config {
    fn default() -> Self {
        Self {
            members_cut_bps: 500,
            lend_club_fee_bps: 500,
            lend_cap_bps: 15_000,
            resale_fee_bps: 500,
            resale_cap_bps: 12_000,
            max_tickets_per_account: 4,
            tier_thresholds: [1, 2, 3],
            advance_cap_bps: 5_000,
            expected_share_per_match: U128(1_000_000), // 1 tUSDC
        }
    }
}

impl Config {
    pub fn assert_within_bounds(&self) {
        use near_sdk::require;
        require!((100..=2_000).contains(&self.members_cut_bps), "members_cut_bps must be 1%..20%");
        require!(self.lend_club_fee_bps <= 2_000, "lend_club_fee_bps must be <= 20%");
        require!((10_000..=20_000).contains(&self.lend_cap_bps), "lend_cap_bps must be 100%..200%");
        require!(self.resale_fee_bps <= 1_000, "resale_fee_bps must be <= 10%");
        require!((10_000..=15_000).contains(&self.resale_cap_bps), "resale_cap_bps must be 100%..150%");
        require!((1..=10).contains(&self.max_tickets_per_account), "max_tickets_per_account must be 1..10");
        let [s, g, l] = self.tier_thresholds;
        require!(0 < s && s < g && g < l, "tier thresholds must be increasing");
        require!(self.advance_cap_bps <= 5_000, "advance_cap_bps must be <= 50%");
    }
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug)]
pub struct Listing {
    pub price: U128,
    pub listed_at: U64,
}

/// One season membership. Money owed to the membership is keyed here, by
/// token, never by person — so it always follows the NFT.
#[near(serializers = [borsh])]
#[derive(Clone, Debug)]
pub struct Member {
    pub seat: String,
    pub vault: AccountId,
    pub tier_floor: Tier,
    pub minted_at: u64,
    /// Pool accumulator value already accounted for this token.
    pub acc_snapshot: u128,
    /// Owed to the vault, not yet transferred (pool share + finished loan income).
    pub credit: u128,
    /// Loan income held until that match finishes: (match, net amount).
    pub pending_loan_income: Vec<(MatchId, u128)>,
    /// tUSDC this contract has moved into the vault and not out again.
    pub vault_balance: u128,
    /// Outflows from the vault whose callbacks haven't run yet.
    pub outflows_in_flight: u32,
    /// Bumped by every outflow and every listing change; buyers pin it.
    pub nonce: u64,
    pub listing: Option<Listing>,
    /// Outstanding advance (Layer 2), repaid before anything else.
    pub debt: u128,
    /// (match id, check-in timestamp) for matches the holder attended.
    pub attended: Vec<(MatchId, u64)>,
    pub food_credits: u32,
    /// Every holder with the time they received the token.
    pub holders: Vec<(AccountId, u64)>,
    pub totals: MemberTotals,
    pub history_len: u32,
    pub last_settled_round: u32,
    /// Matches with an un-rented lend offer; cleared when the token changes hands.
    pub open_offers: Vec<MatchId>,
    /// Auto-lend rules (Layer 2); cleared when the token changes hands.
    pub autolend_rules: Vec<crate::autolend::Rule>,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, Default)]
pub struct MemberTotals {
    pub pool_earned: U128,
    pub loan_income: U128,
    pub settled_into_vault: U128,
    pub withdrawn: U128,
    pub advances_taken: U128,
    pub advances_repaid: U128,
    pub loan_refunds: U128,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum MatchStatus {
    Scheduled,
    Live,
    Finished,
    Postponed,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Side {
    Home,
    Away,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug)]
pub struct Goal {
    pub side: Side,
    pub scorer: String,
    pub minute: u32,
    pub at: U64,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug)]
pub struct Match {
    pub id: MatchId,
    pub opponent: String,
    pub competition: String,
    /// Scheduled kickoff (ns).
    pub kickoff_at: U64,
    pub status: MatchStatus,
    /// Actual kickoff block time (ns); the match minute is derived from it.
    pub started_at: Option<U64>,
    pub ended_at: Option<U64>,
    pub home_goals: u8,
    pub away_goals: u8,
    pub goals: Vec<Goal>,
    pub ticket_price: U128,
    pub big_match: bool,
    /// During a big match's priority window only Gold+ members' accounts can buy.
    pub priority_until: U64,
    pub tickets_sold: u32,
    pub seats_rented: u32,
    pub members_checked_in: u32,
    /// Single-ticket revenue held for this match only.
    pub escrow: U128,
    /// Club's fee on seat rentals, released to the club only at full time.
    pub rental_fees: U128,
    pub members_cut: U128,
    pub payment_count: u32,
    pub refund_cursor: u32,
    pub refunds_done: u32,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum PaymentKind {
    Ticket { seat: String, ticket_id: TokenId },
    Rental { seat: String, token_id: TokenId },
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum PaymentStatus {
    Paid,
    Refunding,
    Refunded,
    /// Refund transfer failed; amount moved to the payer's claimable balance.
    RefundClaimable,
}

/// Every tUSDC payment taken for a match, so postponement can refund it.
#[near(serializers = [borsh, json])]
#[derive(Clone, Debug)]
pub struct Payment {
    pub payer: AccountId,
    pub amount: U128,
    pub kind: PaymentKind,
    pub status: PaymentStatus,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug)]
pub enum Loan {
    /// Member offered the seat; optional `to` restricts who may rent it.
    Offered { price: U128, to: Option<AccountId>, offered_by: AccountId },
    /// Renter paid; the renter holds the gate pass for this match only.
    Rented { price: U128, renter: AccountId },
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum EntryKind {
    Owner,
    Renter,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug)]
pub struct CheckIn {
    pub holder: AccountId,
    pub at: U64,
    pub kind: EntryKind,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug)]
pub struct HistoryEntry {
    pub at: U64,
    pub kind: String,
    pub amount: Option<U128>,
    pub account: Option<AccountId>,
    pub match_id: Option<MatchId>,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug)]
pub struct FeedItem {
    pub seq: U64,
    pub at: U64,
    pub event: String,
    pub data: String,
}

/// Single-match ticket record (tickets are soulbound NEP-171 tokens).
#[near(serializers = [borsh, json])]
#[derive(Clone, Debug)]
pub struct TicketInfo {
    pub match_id: MatchId,
    pub seat: String,
    pub buyer: AccountId,
    pub payment_index: u32,
}

/// tUSDC messages accepted by `ft_on_transfer`.
#[near(serializers = [json])]
#[derive(Clone, Debug)]
#[serde(tag = "action", rename_all = "snake_case")]
pub enum FtMessage {
    /// Buy a club seat, or rent a member's offered seat, for one match.
    BuySeat { match_id: MatchId, seat: String },
    /// Buy a listed membership; reverts unless the vault state still matches.
    BuyMembership { token_id: TokenId, expected_nonce: U64 },
    /// Add to the members' pool, split equally across all memberships.
    TopUpPool,
    /// Add to the fund that members borrow advances from.
    TopUpAdvanceFund,
}

/// NEP-199 payout.
#[near(serializers = [json])]
#[derive(Clone, Debug, Default)]
pub struct Payout {
    pub payout: std::collections::HashMap<AccountId, U128>,
}
