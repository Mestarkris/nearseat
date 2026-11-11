//! Spending and saving from the seat's own account.
//!
//! - **Kiosk payments.** The holder pays a club-approved vendor (food, the
//!   shop) straight from the seat's vault. Same outflow rules as a withdrawal:
//!   blocked while listed or while an advance is open, marked in flight, and
//!   rolled back if the transfer fails. Only approved vendors can be paid, so
//!   this is not a way around the withdrawal checks.
//! - **Renewal saving.** The holder sets a share of every payout aside towards
//!   next season's price. The set-aside part can't be withdrawn or spent until
//!   the holder switches saving off. A sale clears the rule: the buyer gets
//!   the whole balance, unlocked.
//!
//! Both live in their own storage keys, so the main state layout is unchanged.

use crate::money::{ext_self, promise_ok, vault_pay, GAS_FOR_CALLBACK};
use crate::*;
use near_sdk::serde_json::json;
use near_sdk::store::LookupMap;
use near_sdk::{assert_one_yocto, Promise};

const VENDORS_KEY: &[u8] = b"__vendors";
const EXTRAS_PREFIX: &[u8] = b"__extras";
pub const MAX_VENDORS: usize = 20;
pub const MAX_VENDOR_NAME: usize = 40;
pub const MAX_MEMO: usize = 80;

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
pub struct Vendor {
    pub account_id: AccountId,
    pub name: String,
}

/// Per-membership spending and saving state.
#[near(serializers = [borsh])]
#[derive(Clone, Default)]
pub struct Extras {
    /// Share of every payout set aside for renewal, in basis points.
    pub save_bps: u16,
    /// Set aside so far. Never more than the vault balance or the season price.
    pub saved: u128,
    /// Lifetime total paid to vendors from this seat.
    pub spent: u128,
}

fn extras_map() -> LookupMap<TokenId, Extras> {
    LookupMap::new(EXTRAS_PREFIX)
}

pub(crate) fn extras_of(token_id: &TokenId) -> Extras {
    extras_map().get(token_id).cloned().unwrap_or_default()
}

fn set_extras(token_id: &TokenId, x: Extras) {
    let mut map = extras_map();
    map.insert(token_id.clone(), x);
    map.flush();
}

fn read_vendors() -> Vec<Vendor> {
    env::storage_read(VENDORS_KEY)
        .map(|raw| near_sdk::borsh::from_slice(&raw).unwrap_or_else(|_| env::panic_str("vendors unreadable")))
        .unwrap_or_default()
}

#[near]
impl NearSeat {
    /// Club approves a vendor (or renames it). `name: None` removes it.
    pub fn set_vendor(&mut self, account_id: AccountId, name: Option<String>) {
        self.assert_club();
        let mut vendors = read_vendors();
        vendors.retain(|v| v.account_id != account_id);
        if let Some(name) = name.clone() {
            require!(!name.is_empty() && name.len() <= MAX_VENDOR_NAME, "vendor name must be 1 to 40 characters");
            require!(vendors.len() < MAX_VENDORS, "too many vendors");
            vendors.push(Vendor { account_id: account_id.clone(), name });
        }
        let raw = near_sdk::borsh::to_vec(&vendors).unwrap_or_else(|_| env::panic_str("borsh encoding failed"));
        env::storage_write(VENDORS_KEY, &raw);
        self.emit("vendor_set", json!({ "account_id": account_id, "name": name }));
    }

    pub fn vendors(&self) -> Vec<Vendor> {
        read_vendors()
    }

    /// Holder pays an approved vendor from the seat's vault.
    #[payable]
    pub fn pay_vendor(&mut self, token_id: TokenId, vendor_id: AccountId, amount: U128, memo: Option<String>) -> Promise {
        assert_one_yocto();
        self.assert_owner(&token_id);
        require!(read_vendors().iter().any(|v| v.account_id == vendor_id), "not an approved vendor");
        require!(memo.as_ref().is_none_or(|m| m.len() <= MAX_MEMO), "memo too long");
        let spendable = self.spendable(&token_id);
        let stablecoin = self.stablecoin.clone();
        let vault = {
            let m = self.member_mut(&token_id);
            require!(m.listing.is_none(), "vault is frozen while listed");
            require!(m.debt == 0, "payments are blocked while an advance is open");
            require!(amount.0 > 0 && amount.0 <= spendable, "amount exceeds what this seat can spend");
            m.vault_balance -= amount.0;
            m.outflows_in_flight += 1;
            m.nonce += 1;
            m.vault.clone()
        };
        self.emit("vendor_payment_started", json!({ "token_id": token_id, "amount": amount, "to": vendor_id, "memo": memo }));
        vault_pay(vault, &stablecoin, &vendor_id, amount.0).then(
            ext_self::ext(env::current_account_id())
                .with_static_gas(GAS_FOR_CALLBACK)
                .on_vendor_paid(token_id, amount, vendor_id),
        )
    }

    #[private]
    pub fn on_vendor_paid(&mut self, token_id: TokenId, amount: U128, vendor_id: AccountId) -> bool {
        let ok = promise_ok();
        {
            let m = self.member_mut(&token_id);
            m.outflows_in_flight -= 1;
            if !ok {
                // Tokens never left the vault: restore the mirror balance.
                m.vault_balance += amount.0;
            }
        }
        if ok {
            let mut x = extras_of(&token_id);
            x.spent += amount.0;
            set_extras(&token_id, x);
            self.record(&token_id, "paid_vendor", Some(amount.0), Some(vendor_id.clone()), None);
            self.emit("vendor_paid", json!({ "token_id": token_id, "amount": amount, "to": vendor_id }));
        } else {
            self.emit("vendor_payment_failed", json!({ "token_id": token_id, "amount": amount }));
        }
        ok
    }

    /// Holder sets the share of every payout to set aside for renewal.
    /// `bps = 0` switches saving off and releases everything set aside.
    #[payable]
    pub fn set_renewal_saving(&mut self, token_id: TokenId, bps: u16) {
        assert_one_yocto();
        self.assert_owner(&token_id);
        require!(bps as u128 <= BPS, "share must be 0 to 100%");
        let mut x = extras_of(&token_id);
        x.save_bps = bps;
        if bps == 0 {
            x.saved = 0;
        }
        set_extras(&token_id, x);
        self.emit("renewal_saving_set", json!({ "token_id": token_id, "bps": bps }));
    }
}

impl NearSeat {
    /// Set aside for renewal right now. Clamped, so it can never exceed the balance.
    pub(crate) fn saved_for_renewal(&self, token_id: &TokenId) -> u128 {
        extras_of(token_id).saved.min(self.member(token_id).vault_balance)
    }

    /// What the holder may withdraw or spend: the balance minus the set-aside part.
    pub(crate) fn spendable(&self, token_id: &TokenId) -> u128 {
        self.member(token_id).vault_balance - self.saved_for_renewal(token_id)
    }

    /// Called when a payout lands in the vault: sets the chosen share aside,
    /// up to the price of this seat's next season.
    pub(crate) fn save_from_payout(&mut self, token_id: &TokenId, amount: u128) {
        let mut x = extras_of(token_id);
        if x.save_bps == 0 {
            return;
        }
        let m = self.member(token_id);
        let goal = Category::of_seat(&m.seat).price(self.season_price);
        let saved = x.saved.min(m.vault_balance);
        x.saved = (saved + amount * x.save_bps as u128 / BPS).min(goal).min(m.vault_balance);
        set_extras(token_id, x);
    }

    /// A sale or transfer clears the saving rule; the balance moves unlocked.
    pub(crate) fn clear_renewal_saving(&mut self, token_id: &TokenId) {
        let mut x = extras_of(token_id);
        if x.save_bps != 0 || x.saved != 0 {
            x.save_bps = 0;
            x.saved = 0;
            set_extras(token_id, x);
        }
    }
}
