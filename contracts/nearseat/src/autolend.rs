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
        require!(price.0 > 0 && price.0 <= self.lend_cap(match_id, Some(token_id.clone())).0, "price is above the club's lend cap");
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

// ---------- Season rule: set once, applies to every match ----------
//
// "For every match this season, if I haven't checked in `hours_before` hours
// before kickoff, lend my seat at `price_bps` of that match's ticket price."
// It covers fixtures the club has not announced yet. A rule for one match (above)
// takes priority, and the holder can skip a single match ("I'm coming to this
// one"). Stored under its own keys, so the main state layout is unchanged.

use near_sdk::store::LookupMap;

const SEASON_PREFIX: &[u8] = b"__standing";
const SEASON_INDEX_KEY: &[u8] = b"__standing_ix";
/// Matches a holder can mark as "I'm coming" at one time.
pub const MAX_SKIPS: usize = 40;

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug)]
pub struct SeasonRule {
    pub hours_before: u32,
    /// Asking price as a share of the match's ticket price for this seat's category.
    pub price_bps: u16,
    /// Holder who created the rule; must still be the holder at execution.
    pub owner: AccountId,
    /// Matches the holder is keeping the seat for.
    pub skip: Vec<MatchId>,
}

#[near(serializers = [json])]
pub struct DueLend {
    pub token_id: TokenId,
    pub match_id: MatchId,
}

fn season_map() -> LookupMap<TokenId, SeasonRule> {
    LookupMap::new(SEASON_PREFIX)
}

pub(crate) fn season_rule(token_id: &TokenId) -> Option<SeasonRule> {
    season_map().get(token_id).cloned()
}

fn season_index() -> Vec<TokenId> {
    env::storage_read(SEASON_INDEX_KEY)
        .map(|raw| near_sdk::borsh::from_slice(&raw).unwrap_or_else(|_| env::panic_str("season rules unreadable")))
        .unwrap_or_default()
}

fn write_season_index(ix: &[TokenId]) {
    env::storage_write(SEASON_INDEX_KEY, &near_sdk::borsh::to_vec(ix).unwrap());
}

fn put_season_rule(token_id: &TokenId, rule: SeasonRule) {
    let mut map = season_map();
    map.insert(token_id.clone(), rule);
    map.flush();
    let mut ix = season_index();
    if !ix.contains(token_id) {
        ix.push(token_id.clone());
        write_season_index(&ix);
    }
}

/// Removes the rule. Returns whether there was one.
pub(crate) fn drop_season_rule(token_id: &TokenId) -> bool {
    let mut map = season_map();
    let had = map.remove(token_id).is_some();
    map.flush();
    if had {
        let mut ix = season_index();
        ix.retain(|t| t != token_id);
        write_season_index(&ix);
    }
    had
}

#[near]
impl NearSeat {
    /// Sets (or replaces) the season rule. 1 yoctoNEAR, holder only.
    #[payable]
    pub fn set_season_autolend(&mut self, token_id: TokenId, hours_before: u32, price_bps: u16) {
        assert_one_yocto();
        let owner = self.assert_owner(&token_id);
        require!(self.member(&token_id).listing.is_none(), "vault is frozen while listed");
        require!((1..=72).contains(&hours_before), "hours_before must be 1..72");
        require!(
            price_bps >= 1_000 && price_bps <= self.config.lend_cap_bps,
            "price must be between 10% of the ticket price and the club's lend cap"
        );
        // Keep the matches the holder already said they are coming to.
        let skip = season_rule(&token_id).filter(|r| r.owner == owner).map(|r| r.skip).unwrap_or_default();
        put_season_rule(&token_id, SeasonRule { hours_before, price_bps, owner, skip });
        self.emit(
            "season_autolend_set",
            json!({ "token_id": token_id, "hours_before": hours_before, "price_bps": price_bps }),
        );
    }

    #[payable]
    pub fn clear_season_autolend(&mut self, token_id: TokenId) {
        assert_one_yocto();
        self.assert_owner(&token_id);
        require!(drop_season_rule(&token_id), "no season rule on this seat");
        self.emit("season_autolend_cleared", json!({ "token_id": token_id }));
    }

    /// "I'm coming to this one" (`skip = true`), or hand the match back to the rule.
    #[payable]
    pub fn skip_autolend(&mut self, token_id: TokenId, match_id: MatchId, skip: bool) {
        assert_one_yocto();
        self.assert_owner(&token_id);
        require!(self.match_ref(match_id).status == MatchStatus::Scheduled, "match is not scheduled");
        require!(season_rule(&token_id).is_some(), "no season rule on this seat");
        self.mark_skipped(&token_id, match_id, skip);
        self.emit("season_autolend_skip", json!({ "token_id": token_id, "match_id": match_id, "skip": skip }));
    }

    pub fn season_autolend(&self, token_id: TokenId) -> Option<SeasonRule> {
        season_rule(&token_id)
    }

    /// What the keeper should fire right now. Same checks as execution, so a
    /// seat appears here only while the call would succeed.
    pub fn season_autolend_due(&self, limit: Option<u32>) -> Vec<DueLend> {
        let limit = limit.unwrap_or(20).min(100) as usize;
        let mut due = Vec::new();
        for token_id in season_index() {
            for (match_id, m) in self.matches.iter() {
                if m.status == MatchStatus::Scheduled && self.season_lend_price(&token_id, *match_id).is_ok() {
                    due.push(DueLend { token_id: token_id.clone(), match_id: *match_id });
                    if due.len() >= limit {
                        return due;
                    }
                }
            }
        }
        due
    }

    /// Permissionless (the keeper calls it). Lends the seat under its season
    /// rule only if every condition still holds.
    pub fn execute_season_autolend(&mut self, token_id: TokenId, match_id: MatchId) {
        let price = self.season_lend_price(&token_id, match_id).unwrap_or_else(|why| env::panic_str(why));
        let owner = self.owner_of(&token_id);
        self.internal_offer(&token_id, &owner, match_id, price, None);
        self.emit("autolend_executed", json!({ "token_id": token_id, "match_id": match_id, "season_rule": true }));
    }
}

impl NearSeat {
    /// The price the season rule would lend at for this match, or why it must not fire.
    fn season_lend_price(&self, token_id: &TokenId, match_id: MatchId) -> Result<u128, &'static str> {
        let rule = season_rule(token_id).ok_or("no season rule on this seat")?;
        let member = self.members.get(token_id).ok_or("no such membership")?;
        if rule.owner != self.owner_of(token_id) {
            return Err("rule was set by a previous holder");
        }
        let m = self.matches.get(&match_id).ok_or("no such match")?;
        if m.status != MatchStatus::Scheduled {
            return Err("loans are locked once the match kicks off");
        }
        if rule.skip.contains(&match_id) {
            return Err("the holder is keeping the seat for this match");
        }
        if member.autolend_rules.iter().any(|r| r.match_id == match_id) {
            return Err("this match has its own rule");
        }
        if member.listing.is_some() {
            return Err("vault is frozen while listed");
        }
        let key = (match_id, token_id.clone());
        if self.loans.contains_key(&key) {
            return Err("seat is already lent for this match");
        }
        if self.check_ins.contains_key(&key) {
            return Err("you already checked in for this match");
        }
        let window = rule.hours_before as u64 * 3_600_000_000_000;
        if env::block_timestamp() + window < m.kickoff_at.0 {
            return Err("too early: the rule's window hasn't started");
        }
        let face = Category::of_seat(&member.seat).price(m.ticket_price.0);
        // If the club lowered the cap after the rule was set, the cap wins.
        let price = (face * rule.price_bps as u128 / BPS).min(face * self.config.lend_cap_bps as u128 / BPS);
        if price == 0 {
            return Err("this match has no ticket price to lend against");
        }
        Ok(price)
    }

    /// Records that the holder keeps (or releases) one match. No-op without a season rule.
    pub(crate) fn mark_skipped(&mut self, token_id: &TokenId, match_id: MatchId, skip: bool) {
        let Some(mut rule) = season_rule(token_id) else { return };
        rule.skip.retain(|id| *id != match_id);
        if skip {
            // Finished and postponed matches no longer need remembering.
            rule.skip.retain(|id| self.matches.get(id).is_some_and(|m| m.status == MatchStatus::Scheduled));
            require!(rule.skip.len() < MAX_SKIPS, "too many matches marked; clear the season rule instead");
            rule.skip.push(match_id);
        }
        put_season_rule(token_id, rule);
    }
}
