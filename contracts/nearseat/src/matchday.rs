//! Fixtures and live matchday: kickoff, goals, full time, postponement, refunds.
//!
//! Strict state machine: Scheduled → Live → Finished, and Scheduled/Live → Postponed.
//! Every transition is club-only except `process_refunds`, which anyone (the
//! keeper, a fan) can call so the club can't sit on refunds.

use crate::money::{GAS_FOR_CALLBACK, GAS_FOR_FT_TRANSFER};
use crate::*;
use near_sdk::serde_json::json;
use near_sdk::{ext_contract, NearToken};

/// Refund transfers spawned per `process_refunds` call.
pub const MAX_REFUND_BATCH: u32 = 8;
/// Longest a scorer name may be (it is rendered in the card SVG).
const MAX_SCORER_LEN: usize = 32;
const NS_PER_MINUTE: u64 = 60_000_000_000;

#[ext_contract(ext_self_refund)]
#[allow(dead_code)]
trait SelfRefund {
    fn on_refunded(&mut self, match_id: MatchId, index: u32);
}

#[near]
impl NearSeat {
    /// Club-only. Adds a fixture. For big matches, Gold+ members get a
    /// priority window of `priority_hours` before general sale.
    pub fn create_match(
        &mut self,
        opponent: String,
        competition: String,
        kickoff_at: U64,
        ticket_price: U128,
        big_match: Option<bool>,
        priority_hours: Option<u32>,
    ) -> MatchId {
        self.assert_club();
        require!(!opponent.is_empty() && opponent.len() <= 40, "opponent name must be 1..40 chars");
        require!(competition.len() <= 40, "competition name must be <= 40 chars");
        require!(ticket_price.0 > 0, "ticket price must be positive");
        let id = self.next_match_id;
        self.next_match_id += 1;
        let big = big_match.unwrap_or(false);
        let priority_until = if big {
            env::block_timestamp() + priority_hours.unwrap_or(24).min(168) as u64 * 60 * NS_PER_MINUTE
        } else {
            0
        };
        self.matches.insert(
            id,
            Match {
                id,
                opponent: opponent.clone(),
                competition,
                kickoff_at,
                status: MatchStatus::Scheduled,
                started_at: None,
                ended_at: None,
                home_goals: 0,
                away_goals: 0,
                goals: vec![],
                ticket_price,
                big_match: big,
                priority_until: U64(priority_until),
                tickets_sold: 0,
                seats_rented: 0,
                members_checked_in: 0,
                escrow: U128(0),
                rental_fees: U128(0),
                members_cut: U128(0),
                payment_count: 0,
                refund_cursor: 0,
                refunds_done: 0,
            },
        );
        self.emit("match_created", json!({ "match_id": id, "opponent": opponent, "kickoff_at": kickoff_at }));
        id
    }

    /// Club-only. Locks new loans and sales; the match minute counts from now.
    pub fn kickoff(&mut self, match_id: MatchId) {
        self.assert_club();
        let now = env::block_timestamp();
        let m = self.match_mut(match_id);
        require!(m.status == MatchStatus::Scheduled, "match is not scheduled");
        m.status = MatchStatus::Live;
        m.started_at = Some(U64(now));
        let (sold, rented) = (m.tickets_sold, m.seats_rented);
        self.emit(
            "kickoff",
            json!({ "match_id": match_id, "tickets_sold": sold, "seats_rented": rented }),
        );
    }

    /// Club-only. Records a goal. A home goal becomes a goal stamp on every
    /// membership whose holder checked in before the goal (derived in views
    /// from check-in time < goal time, so no per-member writes here).
    pub fn goal(&mut self, match_id: MatchId, side: Side, scorer: String) {
        self.assert_club();
        require!(!scorer.is_empty() && scorer.len() <= MAX_SCORER_LEN, "scorer must be 1..32 chars");
        let now = env::block_timestamp();
        let m = self.match_mut(match_id);
        require!(m.status == MatchStatus::Live, "match is not live");
        let started = m.started_at.expect("live match has a start").0;
        let minute = (((now - started) / NS_PER_MINUTE) + 1).min(120) as u32;
        match side {
            Side::Home => m.home_goals += 1,
            Side::Away => m.away_goals += 1,
        }
        m.goals.push(Goal { side, scorer: scorer.clone(), minute, at: U64(now) });
        let (h, a) = (m.home_goals, m.away_goals);
        self.emit(
            "goal",
            json!({ "match_id": match_id, "side": side, "scorer": scorer, "minute": minute, "score": [h, a] }),
        );
    }

    /// Club-only. Ends loans, finalises attendance, pays the members' cut into
    /// the pool and opens a new payout round for `settle_batch`.
    pub fn full_time(&mut self, match_id: MatchId) {
        self.assert_club();
        let cut_bps = self.config.members_cut_bps as u128;
        let now = env::block_timestamp();
        let (escrow, rental_fees, h, a) = {
            let m = self.match_mut(match_id);
            require!(m.status == MatchStatus::Live, "match is not live");
            m.status = MatchStatus::Finished;
            m.ended_at = Some(U64(now));
            (m.escrow.0, m.rental_fees.0, m.home_goals, m.away_goals)
        };
        let cut = escrow * cut_bps / BPS;
        self.distribute_to_pool(cut);
        self.club_balance += escrow - cut + rental_fees;
        {
            let m = self.match_mut(match_id);
            m.members_cut = U128(cut);
            m.escrow = U128(0);
        }
        self.payout_round += 1;
        self.round_settled = 0;
        self.emit(
            "full_time",
            json!({
                "match_id": match_id,
                "score": [h, a],
                "members_cut": U128(cut),
                "payout_round": self.payout_round,
            }),
        );
    }

    /// Club-only. Cancels or postpones a match; every payment for it becomes
    /// refundable through `process_refunds`.
    pub fn postpone(&mut self, match_id: MatchId) {
        self.assert_club();
        let m = self.match_mut(match_id);
        require!(
            matches!(m.status, MatchStatus::Scheduled | MatchStatus::Live),
            "only scheduled or live matches can be postponed"
        );
        m.status = MatchStatus::Postponed;
        let payments = m.payment_count;
        self.emit("postponed", json!({ "match_id": match_id, "refunds_due": payments }));
    }

    /// Permissionless. Refunds the next batch of payments for a postponed match.
    /// Each refund is marked before its transfer; a failed transfer parks the
    /// amount in the payer's `claimable` balance, so a bad account can't block
    /// the batch and nobody is refunded twice.
    pub fn process_refunds(&mut self, match_id: MatchId, limit: Option<u32>) -> u32 {
        let limit = limit.unwrap_or(MAX_REFUND_BATCH).min(MAX_REFUND_BATCH);
        let (status, start, end) = {
            let m = self.match_ref(match_id);
            (m.status, m.refund_cursor, m.payment_count)
        };
        require!(status == MatchStatus::Postponed, "match is not postponed");
        let stop = end.min(start + limit);
        for index in start..stop {
            let key = (match_id, index);
            let mut p = self.payments.get(&key).cloned().expect("payment exists");
            if p.status != PaymentStatus::Paid {
                continue;
            }
            p.status = PaymentStatus::Refunding;
            self.payments.insert(key, p.clone());
            if let PaymentKind::Rental { token_id, .. } = &p.kind {
                let tid = token_id.clone();
                {
                    let m = self.member_mut(&tid);
                    m.totals.loan_refunds = U128(m.totals.loan_refunds.0 + p.amount.0);
                }
                self.record(&tid, "loan_refunded", Some(p.amount.0), Some(p.payer.clone()), Some(match_id));
            }
            money::ext_ft::ext(self.stablecoin.clone())
                .with_attached_deposit(NearToken::from_yoctonear(1))
                .with_static_gas(GAS_FOR_FT_TRANSFER)
                .ft_transfer(p.payer.clone(), p.amount, Some(format!("refund match {match_id}")))
                .then(
                    ext_self_refund::ext(env::current_account_id())
                        .with_static_gas(GAS_FOR_CALLBACK)
                        .on_refunded(match_id, index),
                )
                .detach();
        }
        self.match_mut(match_id).refund_cursor = stop;
        stop - start
    }

    #[private]
    pub fn on_refunded(&mut self, match_id: MatchId, index: u32) -> bool {
        let ok = money::promise_ok();
        let key = (match_id, index);
        let mut p = self.payments.get(&key).cloned().expect("payment exists");
        p.status = if ok { PaymentStatus::Refunded } else { PaymentStatus::RefundClaimable };
        if !ok {
            self.add_claimable(&p.payer, p.amount.0);
        }
        self.payments.insert(key, p.clone());
        self.match_mut(match_id).refunds_done += 1;
        self.emit(
            if ok { "refunded" } else { "refund_parked" },
            json!({ "match_id": match_id, "to": p.payer, "amount": p.amount }),
        );
        ok
    }
}
