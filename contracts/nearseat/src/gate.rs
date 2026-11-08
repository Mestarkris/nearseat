//! Stadium gate.
//!
//! The scanner verifies the fan's rotating NEP-413 gate pass off-chain, then
//! calls `check_in`. The contract checks everything again: caller is the gate
//! role, `holder` is the **live** owner (or that match's paid renter), the match
//! is open, and the seat hasn't already been used. An old owner, an expired
//! renter or a screenshot can't get through here even if a scanner were fooled.

use crate::*;
use near_sdk::serde_json::json;

/// Gates open this long before scheduled kickoff.
pub const GATES_OPEN_BEFORE_NS: u64 = 4 * 60 * 60 * 1_000_000_000;

#[near]
impl NearSeat {
    /// Who may enter on this membership for this match: the paid renter if the
    /// seat is rented, otherwise the live owner.
    pub fn holder_for(&self, token_id: TokenId, match_id: MatchId) -> AccountId {
        match self.loans.get(&(match_id, token_id.clone())) {
            Some(Loan::Rented { renter, .. }) => renter.clone(),
            _ => self.owner_of(&token_id),
        }
    }

    /// Gate-only. Records attendance for a membership holder or renter.
    pub fn check_in(&mut self, token_id: TokenId, match_id: MatchId, holder: AccountId) {
        self.assert_gate();
        require!(self.members.contains_key(&token_id), "not a membership");
        self.assert_gates_open(match_id);
        let key = (match_id, token_id.clone());
        require!(!self.check_ins.contains_key(&key), "this seat already entered for this match");
        let expected = self.holder_for(token_id.clone(), match_id);
        require!(holder == expected, "pass holder is not the current holder for this match");

        let kind = if holder == self.owner_of(&token_id) { EntryKind::Owner } else { EntryKind::Renter };
        let now = env::block_timestamp();
        self.check_ins.insert(key, CheckIn { holder: holder.clone(), at: U64(now), kind });
        if kind == EntryKind::Owner {
            // Attendance and tiers count the member's own visits only.
            self.member_mut(&token_id).attended.push((match_id, now));
            self.match_mut(match_id).members_checked_in += 1;
        }
        self.record(&token_id, "checked_in", None, Some(holder.clone()), Some(match_id));
        let tier = self.tier_of(self.member(&token_id));
        self.emit(
            "check_in",
            json!({ "token_id": token_id, "match_id": match_id, "holder": holder, "kind": kind, "tier": tier }),
        );
    }

    /// Gate-only. Admits a single-match ticket holder.
    pub fn check_in_ticket(&mut self, ticket_id: TokenId, holder: AccountId) {
        self.assert_gate();
        let info = self.tickets.get(&ticket_id).cloned().unwrap_or_else(|| env::panic_str("ticket not found"));
        self.assert_gates_open(info.match_id);
        require!(self.owner_of(&ticket_id) == holder, "pass holder does not own this ticket");
        let paid = self
            .payments
            .get(&(info.match_id, info.payment_index))
            .map(|p| p.status == PaymentStatus::Paid)
            .unwrap_or(false);
        require!(paid, "ticket was refunded");
        require!(!self.ticket_check_ins.contains(&ticket_id), "ticket already used");
        self.ticket_check_ins.insert(ticket_id.clone());
        self.emit("ticket_check_in", json!({ "ticket_id": ticket_id, "holder": holder }));
    }

    /// Gate/kiosk-only. Spends food & drink credits for the live holder.
    pub fn spend_food_credit(&mut self, token_id: TokenId, holder: AccountId, credits: u32) {
        self.assert_gate();
        require!(self.owner_of(&token_id) == holder, "only the current holder can spend credits");
        let m = self.member_mut(&token_id);
        require!(credits > 0 && credits <= m.food_credits, "not enough credits");
        m.food_credits -= credits;
        self.record(&token_id, "credits_spent", Some(credits as u128), Some(holder), None);
    }
}

impl NearSeat {
    fn assert_gates_open(&self, match_id: MatchId) {
        let m = self.match_ref(match_id);
        let open = match m.status {
            MatchStatus::Live => true,
            MatchStatus::Scheduled => env::block_timestamp() + GATES_OPEN_BEFORE_NS >= m.kickoff_at.0,
            MatchStatus::Finished | MatchStatus::Postponed => false,
        };
        require!(open, "gates are closed for this match");
    }
}
