//! Lending a seat for one match.
//!
//! The holder offers the seat at a price capped by the club. Whoever pays
//! (via `BuySeat` on that seat) becomes the renter and holds that match's gate
//! pass. Income is owed to the token (net of the club fee) once the match
//! finishes. Loans end at full time or postponement. If the membership is sold,
//! un-rented offers are dropped but a paid renter keeps their match.

use crate::*;
use near_sdk::assert_one_yocto;
use near_sdk::serde_json::json;

#[near]
impl NearSeat {
    /// Offers the seat for `match_id` at `price`. `to` makes it a private loan.
    #[payable]
    pub fn lend(&mut self, token_id: TokenId, match_id: MatchId, price: U128, to: Option<AccountId>) {
        assert_one_yocto();
        let owner = self.assert_owner(&token_id);
        self.internal_offer(&token_id, &owner, match_id, price.0, to);
    }

    /// Withdraws an offer nobody has paid for yet. Paid rentals can't be cancelled.
    #[payable]
    pub fn cancel_lend(&mut self, token_id: TokenId, match_id: MatchId) {
        assert_one_yocto();
        self.assert_owner(&token_id);
        let key = (match_id, token_id.clone());
        require!(
            matches!(self.loans.get(&key), Some(Loan::Offered { .. })),
            "no open offer for this match (a paid rental can't be cancelled)"
        );
        self.loans.remove(&key);
        self.member_mut(&token_id).open_offers.retain(|id| *id != match_id);
        // Taking the seat back means the holder is coming: the season rule must not lend it again.
        self.mark_skipped(&token_id, match_id, true);
        self.emit("lend_cancelled", json!({ "token_id": token_id, "match_id": match_id }));
    }

    /// Highest price a member may ask for a seat at this match: a multiple of
    /// what the club charges for a seat of the same category. Without a
    /// `token_id` it answers for a standard seat.
    pub fn lend_cap(&self, match_id: MatchId, token_id: Option<TokenId>) -> U128 {
        let category = token_id.map_or(Category::Standard, |id| Category::of_seat(&self.member(&id).seat));
        let face = category.price(self.match_ref(match_id).ticket_price.0);
        U128(face * self.config.lend_cap_bps as u128 / BPS)
    }
}

impl NearSeat {
    /// Shared by `lend` and auto-lend; re-checks every condition.
    pub(crate) fn internal_offer(
        &mut self,
        token_id: &TokenId,
        owner: &AccountId,
        match_id: MatchId,
        price: u128,
        to: Option<AccountId>,
    ) {
        require!(
            self.match_ref(match_id).status == MatchStatus::Scheduled,
            "loans are locked once the match kicks off"
        );
        require!(price > 0 && price <= self.lend_cap(match_id, Some(token_id.clone())).0, "price is above the club's lend cap");
        {
            let m = self.member(token_id);
            require!(m.listing.is_none(), "vault is frozen while listed");
        }
        let key = (match_id, token_id.clone());
        require!(!self.loans.contains_key(&key), "seat is already lent for this match");
        require!(!self.check_ins.contains_key(&key), "you already checked in for this match");
        if let Some(to) = &to {
            require!(to != owner, "can't lend to yourself");
        }
        self.loans.insert(
            key,
            Loan::Offered { price: U128(price), to: to.clone(), offered_by: owner.clone() },
        );
        self.member_mut(token_id).open_offers.push(match_id);
        self.record(token_id, "lend_offered", Some(price), to.clone(), Some(match_id));
        self.emit(
            "seat_lent",
            json!({ "token_id": token_id, "match_id": match_id, "price": U128(price), "to": to }),
        );
    }
}
