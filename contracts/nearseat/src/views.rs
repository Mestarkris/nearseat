//! Read-only views for the frontend, the Verify page and the public history.

use crate::*;
use near_sdk::json_types::Base58CryptoHash;

#[near(serializers = [json])]
pub struct GoalStamp {
    pub match_id: MatchId,
    pub opponent: String,
    pub scorer: String,
    pub minute: u32,
}

#[near(serializers = [json])]
pub struct LoanView {
    pub match_id: MatchId,
    pub loan: Loan,
}

#[near(serializers = [json])]
pub struct MembershipView {
    pub token_id: TokenId,
    pub seat: String,
    pub vault: AccountId,
    pub owner_id: AccountId,
    pub tier: Tier,
    /// Where the seat is: sets its price, caps and share of the pool.
    pub category: Category,
    pub category_label: String,
    pub share_weight: u32,
    pub season_price: U128,
    pub resale_cap: U128,
    pub attended: Vec<MatchId>,
    pub goal_stamps: Vec<GoalStamp>,
    pub vault_balance: U128,
    /// Owed to the vault but not yet settled (pool share + finished loans).
    pub unsettled: U128,
    pub pending_loan_income: U128,
    pub debt: U128,
    pub nonce: U64,
    pub listing: Option<Listing>,
    pub outflows_in_flight: u32,
    pub passes_left: u32,
    pub food_credits: u32,
    pub holders: Vec<(AccountId, U64)>,
    pub totals: MemberTotals,
    pub loans: Vec<LoanView>,
    pub autolend_rules: Vec<autolend::Rule>,
    pub history_len: u32,
}

#[near(serializers = [json])]
pub struct SeasonView {
    pub name: String,
    pub contract: AccountId,
    pub club: AccountId,
    pub gate: AccountId,
    pub stablecoin: AccountId,
    pub vault_code_hash: Base58CryptoHash,
    pub season_price: U128,
    pub resale_cap: U128,
    pub max_supply: u32,
    pub memberships: u32,
    pub config: Config,
    pub pool_total_distributed: U128,
    pub club_balance: U128,
    pub advance_fund: U128,
    pub payout_round: u32,
    pub round_settled: u32,
    pub total_weight: U128,
    pub categories: Vec<category::CategoryView>,
}

#[near(serializers = [json])]
pub struct SeatView {
    pub seat: String,
    /// "sold" | "rented" | "lent" (offered) | "member" | "member_in" (checked in)
    pub state: String,
    pub price: Option<U128>,
    pub token_id: Option<TokenId>,
    pub holder: Option<AccountId>,
}

#[near]
impl NearSeat {
    pub fn season(&self) -> SeasonView {
        SeasonView {
            name: self.season_name.clone(),
            contract: env::current_account_id(),
            club: self.club.clone(),
            gate: self.gate.clone(),
            stablecoin: self.stablecoin.clone(),
            vault_code_hash: self.vault_code_hash.into(),
            season_price: U128(self.season_price),
            resale_cap: self.resale_cap(),
            max_supply: self.max_supply,
            memberships: self.members.len(),
            config: self.config.clone(),
            pool_total_distributed: U128(self.pool_total_distributed),
            club_balance: U128(self.club_balance),
            advance_fund: U128(self.advance_fund),
            payout_round: self.payout_round,
            round_settled: self.round_settled,
            total_weight: U128(self.total_weight),
            categories: self.categories(),
        }
    }

    pub fn membership(&self, token_id: TokenId) -> Option<MembershipView> {
        let m = self.members.get(&token_id)?;
        Some(self.membership_view(&token_id, m))
    }

    pub fn memberships(&self, from_index: Option<u32>, limit: Option<u32>) -> Vec<MembershipView> {
        self.members
            .iter()
            .skip(from_index.unwrap_or(0) as usize)
            .take(limit.unwrap_or(50).min(100) as usize)
            .map(|(id, m)| self.membership_view(id, m))
            .collect()
    }

    pub fn memberships_for_owner(&self, account_id: AccountId) -> Vec<MembershipView> {
        let Some(owned) = self.tokens.tokens_per_owner.as_ref().and_then(|t| t.get(&account_id)) else {
            return vec![];
        };
        let views = owned
            .iter()
            .filter_map(|id| self.members.get(&id).map(|m| self.membership_view(&id, m)))
            .collect();
        views
    }

    /// Public, wallet-free history of a membership.
    pub fn history(&self, token_id: TokenId, from_index: Option<u32>, limit: Option<u32>) -> Vec<HistoryEntry> {
        let len = self.member(&token_id).history_len;
        let from = from_index.unwrap_or(0);
        let to = len.min(from + limit.unwrap_or(100).min(200));
        (from..to)
            .filter_map(|i| self.history.get(&(token_id.clone(), i)).cloned())
            .collect()
    }

    pub fn get_match(&self, match_id: MatchId) -> Option<Match> {
        self.matches.get(&match_id).cloned()
    }

    pub fn get_matches(&self) -> Vec<Match> {
        let mut all: Vec<Match> = self.matches.values().cloned().collect();
        all.sort_by_key(|m| m.id);
        all
    }

    /// Non-available seats for a match. Every seat not listed is on sale by the club.
    pub fn seat_map(&self, match_id: MatchId) -> Vec<SeatView> {
        let count = self.matches.get(&match_id).map(|m| m.payment_count).unwrap_or(0);
        let mut out: Vec<SeatView> = (0..count)
            .filter_map(|i| self.payments.get(&(match_id, i)))
            .filter(|p| p.status == PaymentStatus::Paid)
            .map(|p| match &p.kind {
                PaymentKind::Ticket { seat, .. } => SeatView {
                    seat: seat.clone(),
                    state: "sold".into(),
                    price: Some(p.amount),
                    token_id: None,
                    holder: Some(p.payer.clone()),
                },
                PaymentKind::Rental { seat, token_id } => SeatView {
                    seat: seat.clone(),
                    state: "rented".into(),
                    price: Some(p.amount),
                    token_id: Some(token_id.clone()),
                    holder: Some(p.payer.clone()),
                },
            })
            .collect();
        for (id, m) in self.members.iter() {
            let key = (match_id, id.clone());
            let (state, price) = match self.loans.get(&key) {
                Some(Loan::Rented { .. }) => continue, // already listed from payments
                Some(Loan::Offered { price, .. }) => ("lent", Some(*price)),
                None if self.check_ins.contains_key(&key) => ("member_in", None),
                None => ("member", None),
            };
            out.push(SeatView {
                seat: m.seat.clone(),
                state: state.into(),
                price,
                token_id: Some(id.clone()),
                holder: Some(self.owner_of(id)),
            });
        }
        out
    }

    pub fn claimable_of(&self, account_id: AccountId) -> U128 {
        U128(self.claimable.get(&account_id).copied().unwrap_or(0))
    }

    pub fn tickets_for_owner(&self, account_id: AccountId) -> Vec<(TokenId, TicketInfo)> {
        let Some(owned) = self.tokens.tokens_per_owner.as_ref().and_then(|t| t.get(&account_id)) else {
            return vec![];
        };
        let tickets = owned
            .iter()
            .filter_map(|id| self.tickets.get(&id).map(|t| (id.clone(), t.clone())))
            .collect();
        tickets
    }

    pub fn check_in_of(&self, token_id: TokenId, match_id: MatchId) -> Option<CheckIn> {
        self.check_ins.get(&(match_id, token_id)).cloned()
    }

    pub fn loan_of(&self, token_id: TokenId, match_id: MatchId) -> Option<Loan> {
        self.loans.get(&(match_id, token_id)).cloned()
    }

    pub fn payment(&self, match_id: MatchId, index: u32) -> Option<Payment> {
        self.payments.get(&(match_id, index)).cloned()
    }
}

impl NearSeat {
    pub(crate) fn goal_stamps(&self, m: &Member) -> Vec<GoalStamp> {
        let mut out = vec![];
        for (match_id, checked_in_at) in &m.attended {
            let Some(mm) = self.matches.get(match_id) else { continue };
            for g in mm.goals.iter().filter(|g| g.side == Side::Home && g.at.0 > *checked_in_at) {
                out.push(GoalStamp {
                    match_id: *match_id,
                    opponent: mm.opponent.clone(),
                    scorer: g.scorer.clone(),
                    minute: g.minute,
                });
            }
        }
        out
    }

    /// What `accrue` would add right now, without mutating.
    pub(crate) fn unsettled_of(&self, m: &Member) -> (u128, u128) {
        let pool = (self.acc_per_share - m.acc_snapshot) * Category::of_seat(&m.seat).weight() / ACC_SCALE;
        let mut finished = 0;
        let mut pending = 0;
        for (id, amount) in &m.pending_loan_income {
            match self.matches.get(id).map(|x| x.status) {
                Some(MatchStatus::Finished) => finished += amount,
                Some(MatchStatus::Postponed) => {}
                _ => pending += amount,
            }
        }
        (m.credit + pool + finished, pending)
    }

    pub(crate) fn passes_left(&self, token_id: &TokenId) -> u32 {
        self.matches
            .values()
            .filter(|mm| matches!(mm.status, MatchStatus::Scheduled | MatchStatus::Live))
            .filter(|mm| !self.check_ins.contains_key(&(mm.id, token_id.clone())))
            .count() as u32
    }

    pub(crate) fn membership_view(&self, token_id: &TokenId, m: &Member) -> MembershipView {
        let (unsettled, pending) = self.unsettled_of(m);
        let loans = self
            .matches
            .values()
            .filter(|mm| matches!(mm.status, MatchStatus::Scheduled | MatchStatus::Live))
            .filter_map(|mm| {
                self.loans
                    .get(&(mm.id, token_id.clone()))
                    .map(|loan| LoanView { match_id: mm.id, loan: loan.clone() })
            })
            .collect();
        MembershipView {
            token_id: token_id.clone(),
            seat: m.seat.clone(),
            vault: m.vault.clone(),
            owner_id: self.owner_of(token_id),
            tier: self.tier_of(m),
            category: Category::of_seat(&m.seat),
            category_label: Category::of_seat(&m.seat).label().to_string(),
            share_weight: Category::of_seat(&m.seat).weight() as u32,
            season_price: U128(Category::of_seat(&m.seat).price(self.season_price)),
            resale_cap: U128(self.resale_cap_for(token_id)),
            attended: m.attended.iter().map(|(id, _)| *id).collect(),
            goal_stamps: self.goal_stamps(m),
            vault_balance: U128(m.vault_balance),
            unsettled: U128(unsettled),
            pending_loan_income: U128(pending),
            debt: U128(m.debt),
            nonce: U64(m.nonce),
            listing: m.listing.clone(),
            outflows_in_flight: m.outflows_in_flight,
            passes_left: self.passes_left(token_id),
            food_credits: m.food_credits,
            holders: m.holders.iter().map(|(a, t)| (a.clone(), U64(*t))).collect(),
            totals: m.totals.clone(),
            loans,
            autolend_rules: m.autolend_rules.clone(),
            history_len: m.history_len,
        }
    }
}
