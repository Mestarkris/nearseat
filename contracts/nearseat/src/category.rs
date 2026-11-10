//! Seat categories.
//!
//! A seat's category is decided by where it is in the stadium and never
//! changes, so it is derived from the seat id instead of being stored. It sets
//! three things: what the seat costs (season membership and single ticket),
//! the cap on lending and resale prices, and the membership's share of the
//! members' pool. The share follows the price: a seat that cost 2.5x a
//! standard seat earns 2.5x a standard share.
//!
//! The numbers are constants on purpose. The club can change the base prices
//! for future matches, but it can't re-weight the pool after fans have bought in.

use crate::*;

#[near(serializers = [json])]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Category {
    /// Main stand (A), rows 1-2.
    Vip,
    /// Rows 1-2 of the side stands (B and C).
    Pitchside,
    /// Rows 3-6 of stands A, B and C.
    Standard,
    /// Stand D, behind the goal.
    FansEnd,
}

pub const CATEGORIES: [Category; 4] =
    [Category::Vip, Category::Pitchside, Category::Standard, Category::FansEnd];

/// Pool weight of a standard seat; advance caps are scaled against it.
pub const STANDARD_WEIGHT: u128 = 4;

impl Category {
    /// `seat` must already have passed `assert_valid_seat`.
    pub fn of_seat(seat: &str) -> Self {
        let mut chars = seat.chars();
        let stand = chars.next().unwrap_or('c');
        let row = chars.next().and_then(|c| c.to_digit(10)).unwrap_or(6);
        match (stand, row) {
            ('d', _) => Category::FansEnd,
            ('a', 1..=2) => Category::Vip,
            (_, 1..=2) => Category::Pitchside,
            _ => Category::Standard,
        }
    }

    /// Price as a share of the base (standard) price, in basis points.
    pub fn price_bps(self) -> u128 {
        match self {
            Category::Vip => 25_000,
            Category::Pitchside => 15_000,
            Category::Standard => 10_000,
            Category::FansEnd => 7_500,
        }
    }

    /// Units of the members' pool this seat holds: 10, 6, 4 or 3.
    pub fn weight(self) -> u128 {
        self.price_bps() / 2_500
    }

    pub fn price(self, base: u128) -> u128 {
        base * self.price_bps() / BPS
    }

    pub fn label(self) -> &'static str {
        match self {
            Category::Vip => "VIP",
            Category::Pitchside => "PITCHSIDE",
            Category::Standard => "STANDARD",
            Category::FansEnd => "FANS' END",
        }
    }
}

#[near(serializers = [json])]
pub struct CategoryView {
    pub category: Category,
    pub label: String,
    pub price_bps: u32,
    pub weight: u32,
    pub season_price: U128,
    pub resale_cap: U128,
    pub memberships: u32,
}

#[near]
impl NearSeat {
    pub fn seat_category(&self, seat: String) -> Category {
        membership::assert_valid_seat(&seat);
        Category::of_seat(&seat)
    }

    /// Season membership price for this seat.
    pub fn season_price_for(&self, seat: String) -> U128 {
        membership::assert_valid_seat(&seat);
        U128(Category::of_seat(&seat).price(self.season_price))
    }

    /// Single-match ticket price for this seat at this match.
    pub fn ticket_price_for(&self, match_id: MatchId, seat: String) -> U128 {
        membership::assert_valid_seat(&seat);
        U128(Category::of_seat(&seat).price(self.match_ref(match_id).ticket_price.0))
    }

    pub fn categories(&self) -> Vec<CategoryView> {
        CATEGORIES
            .iter()
            .map(|c| CategoryView {
                category: *c,
                label: c.label().to_string(),
                price_bps: c.price_bps() as u32,
                weight: c.weight() as u32,
                season_price: U128(c.price(self.season_price)),
                resale_cap: U128(c.price(self.season_price) * self.config.resale_cap_bps as u128 / BPS),
                memberships: self.members.values().filter(|m| Category::of_seat(&m.seat) == *c).count() as u32,
            })
            .collect()
    }
}
