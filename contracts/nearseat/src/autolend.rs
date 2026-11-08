//! Layer 2: auto-lend rules.
//!
//! "If I haven't checked in `hours_before` hours before kickoff, lend my seat
//! at `price`." The keeper calls `execute_autolend`; the contract re-checks
//! every condition, so a buggy or malicious keeper can't lend against the
//! holder's wishes. Rules live inside the membership and are cleared whenever
//! it changes hands.

use crate::*;
use near_sdk::assert_one_yocto;
use near_sdk::serde_json::json;

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug)]
pub struct Rule {
    pub match_id: MatchId,
    pub hours_before: u32,
    pub price: U128,
    /// Holder who created the rule; must still be the holder at execution.
    pub owner: AccountId,
}

#[near]
impl NearSeat {
    #[payable]
    pub fn set_autolend(&mut self, token_id: TokenId, match_id: MatchId, hours_before: u32, price: U128) {
        assert_one_yocto();
        let owner = self.assert_owner(&token_id);
        require!(self.match_ref(match_id).status == MatchStatus::Scheduled, "match is not scheduled");
        require!((1..=72).contains(&hours_before), "hours_before must be 1..72");
        require!(price.0 > 0 && price.0 <= self.lend_cap(match_id).0, "price is above the club's lend cap");
        let m = self.member_mut(&token_id);
        m.autolend_rules.retain(|r| r.match_id != match_id);
        m.autolend_rules.push(Rule { match_id, hours_before, price, owner });
        self.emit(
            "autolend_set",
            json!({ "token_id": token_id, "match_id": match_id, "hours_before": hours_before, "price": price }),
        );
    }

    #[payable]
    pub fn clear_autolend(&mut self, token_id: TokenId, match_id: MatchId) {
        assert_one_yocto();
        self.assert_owner(&token_id);
        self.member_mut(&token_id).autolend_rules.retain(|r| r.match_id != match_id);
        self.emit("autolend_cleared", json!({ "token_id": token_id, "match_id": match_id }));
    }

    /// Permissionless (the keeper calls it). Fires the rule only if every
    /// condition still holds; `internal_offer` re-checks the rest.
    pub fn execute_autolend(&mut self, token_id: TokenId, match_id: MatchId) {
        let rule = self
            .member(&token_id)
            .autolend_rules
            .iter()
            .find(|r| r.match_id == match_id)
            .cloned()
            .unwrap_or_else(|| env::panic_str("no auto-lend rule for this match"));
        let owner = self.owner_of(&token_id);
        require!(rule.owner == owner, "rule was set by a previous holder");
        let kickoff = self.match_ref(match_id).kickoff_at.0;
        let window = rule.hours_before as u64 * 3_600_000_000_000;
        require!(env::block_timestamp() + window >= kickoff, "too early: the rule's window hasn't started");
        self.member_mut(&token_id).autolend_rules.retain(|r| r.match_id != match_id);
        self.internal_offer(&token_id, &owner, match_id, rule.price.0, None);
        self.emit("autolend_executed", json!({ "token_id": token_id, "match_id": match_id }));
    }
}
