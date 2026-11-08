//! Layer 2: advance on future earnings, with the membership as collateral.
//!
//! - Cap: `advance_cap_bps` of expected remaining-season income, and never more
//!   than the fund holds.
//! - Every settlement repays the advance before anything reaches the vault.
//! - While an advance is open: no withdrawals and no plain transfers. A sale
//!   repays it from the price in the same receipt (see `market`).
//! - At season end the club can recover any unpaid balance from the vault.

use crate::money::{vault_pay, GAS_FOR_CALLBACK};
use crate::*;
use near_sdk::serde_json::json;
use near_sdk::{assert_one_yocto, ext_contract, Promise};

#[ext_contract(ext_self_advance)]
#[allow(dead_code)]
trait SelfAdvance {
    fn on_recovered(&mut self, token_id: TokenId, amount: U128);
}

#[near]
impl NearSeat {
    /// How much this membership can borrow right now.
    pub fn advance_cap(&self, token_id: TokenId) -> U128 {
        let remaining = self
            .matches
            .values()
            .filter(|m| m.status == MatchStatus::Scheduled)
            .count() as u128;
        let expected = self.config.expected_share_per_match.0 * remaining;
        let cap = expected * self.config.advance_cap_bps as u128 / BPS;
        let debt = self.member(&token_id).debt;
        U128(cap.saturating_sub(debt).min(self.advance_fund))
    }

    #[payable]
    pub fn borrow(&mut self, token_id: TokenId, amount: U128) -> Promise {
        assert_one_yocto();
        let owner = self.assert_owner(&token_id);
        require!(amount.0 > 0 && amount.0 <= self.advance_cap(token_id.clone()).0, "amount is above your advance cap");
        {
            let m = self.member_mut(&token_id);
            require!(m.listing.is_none(), "vault is frozen while listed");
            m.debt += amount.0;
            m.nonce += 1;
            m.totals.advances_taken = U128(m.totals.advances_taken.0 + amount.0);
        }
        self.advance_fund -= amount.0;
        self.record(&token_id, "advance_taken", Some(amount.0), Some(owner.clone()), None);
        self.emit("advance_taken", json!({ "token_id": token_id, "amount": amount, "to": owner }));
        self.pay_person(&owner, amount.0, "advance")
    }

    /// Club-only, after the last fixture. Pulls unpaid advances back from vaults.
    pub fn recover_advances(&mut self, limit: Option<u32>) -> u32 {
        self.assert_club();
        require!(
            self.matches.values().all(|m| matches!(m.status, MatchStatus::Finished | MatchStatus::Postponed)),
            "season is not over"
        );
        let limit = limit.unwrap_or(8).min(8) as usize;
        let due: Vec<TokenId> = self
            .members
            .iter()
            .filter(|(_, m)| m.debt > 0 && m.outflows_in_flight == 0)
            .take(limit)
            .map(|(id, _)| id.clone())
            .collect();
        for token_id in &due {
            // Settle first so pending income repays the debt without a transfer.
            if let Some(p) = self.internal_settle(token_id) {
                p.detach();
            }
            let stablecoin = self.stablecoin.clone();
            let (amount, vault) = {
                let m = self.member_mut(token_id);
                let amount = m.debt.min(m.vault_balance);
                if amount == 0 {
                    continue;
                }
                m.vault_balance -= amount;
                m.debt -= amount;
                m.outflows_in_flight += 1;
                m.nonce += 1;
                (amount, m.vault.clone())
            };
            vault_pay(vault, &stablecoin, &env::current_account_id(), amount)
                .then(
                    ext_self_advance::ext(env::current_account_id())
                        .with_static_gas(GAS_FOR_CALLBACK)
                        .on_recovered(token_id.clone(), U128(amount)),
                )
                .detach();
        }
        due.len() as u32
    }

    #[private]
    pub fn on_recovered(&mut self, token_id: TokenId, amount: U128) -> bool {
        let ok = money::promise_ok();
        {
            let m = self.member_mut(&token_id);
            m.outflows_in_flight -= 1;
            if ok {
                m.totals.advances_repaid = U128(m.totals.advances_repaid.0 + amount.0);
            } else {
                m.vault_balance += amount.0;
                m.debt += amount.0;
            }
        }
        if ok {
            self.advance_fund += amount.0;
            self.record(&token_id, "advance_recovered", Some(amount.0), None, None);
        }
        self.emit(
            if ok { "advance_recovered" } else { "advance_recovery_failed" },
            json!({ "token_id": token_id, "amount": amount }),
        );
        ok
    }
}
