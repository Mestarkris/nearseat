//! Members' pool, settlement into vaults, withdrawals and every money callback.
//!
//! Invariants:
//! - Pool rewards and loan income are owed to a **token**, never a person.
//! - Settlement (inflow) moves tUSDC into the vault; the holder at withdrawal
//!   time gets it. Inflows don't change the nonce: buyers only gain from them.
//! - Every outflow marks itself in flight and bumps the nonce *before* the
//!   cross-contract call. Its callback restores the books if the transfer failed.
//! - Transfers to people that fail go to `claimable`, never lost.

use crate::*;
use near_sdk::serde_json::json;
use near_sdk::{assert_one_yocto, ext_contract, Gas, NearToken, Promise};

pub const GAS_FOR_FT_TRANSFER: Gas = Gas::from_tgas(10);
pub const GAS_FOR_VAULT_PAY: Gas = Gas::from_tgas(25);
pub const GAS_FOR_CALLBACK: Gas = Gas::from_tgas(15);
/// Memberships settled per `settle_batch` call (each spawns a transfer + callback).
pub const MAX_SETTLE_BATCH: u32 = 8;

#[ext_contract(ext_ft)]
#[allow(dead_code)]
pub trait FungibleToken {
    fn ft_transfer(&mut self, receiver_id: AccountId, amount: U128, memo: Option<String>);
}

/// Calls the vault's `pay(token, receiver, amount)` with borsh arguments.
/// The vault checks that the caller is its parent, i.e. this contract.
pub(crate) fn vault_pay(vault: AccountId, token: &AccountId, receiver: &AccountId, amount: u128) -> Promise {
    let args = near_sdk::borsh::to_vec(&(token.as_str(), receiver.as_str(), amount))
        .unwrap_or_else(|_| env::panic_str("borsh encoding failed"));
    Promise::new(vault).function_call("pay", args, NearToken::from_yoctonear(0), GAS_FOR_VAULT_PAY)
}

#[ext_contract(ext_self)]
#[allow(dead_code)]
pub trait SelfCallbacks {
    fn on_settled(&mut self, token_id: TokenId, amount: U128);
    fn on_withdrawn(&mut self, token_id: TokenId, amount: U128, receiver_id: AccountId);
    fn on_paid_out(&mut self, receiver_id: AccountId, amount: U128, reason: String);
    fn on_club_withdrawn(&mut self, amount: U128);
}

pub(crate) fn promise_ok() -> bool {
    env::promise_result_checked(0, 256).is_ok()
}

#[near]
impl NearSeat {
    /// Moves everything a membership is owed into its vault. Permissionless:
    /// the keeper calls it, anyone may. Debt (Layer 2 advance) is repaid first.
    pub fn settle(&mut self, token_id: TokenId) -> Option<Promise> {
        self.internal_settle(&token_id)
    }

    /// Settles the next `limit` memberships of the current payout round.
    /// Payout progress = `round_settled / total memberships`.
    pub fn settle_batch(&mut self, limit: Option<u32>) -> u32 {
        let limit = limit.unwrap_or(MAX_SETTLE_BATCH).min(MAX_SETTLE_BATCH);
        let round = self.payout_round;
        let due: Vec<TokenId> = self
            .members
            .iter()
            .filter(|(_, m)| m.last_settled_round < round)
            .take(limit as usize)
            .map(|(id, _)| id.clone())
            .collect();
        for token_id in &due {
            self.member_mut(token_id).last_settled_round = round;
            self.round_settled += 1;
            if let Some(p) = self.internal_settle(token_id) {
                p.detach();
            }
        }
        due.len() as u32
    }

    #[private]
    pub fn on_settled(&mut self, token_id: TokenId, amount: U128) {
        if promise_ok() {
            let m = self.member_mut(&token_id);
            m.vault_balance += amount.0;
            m.totals.settled_into_vault = U128(m.totals.settled_into_vault.0 + amount.0);
            self.record(&token_id, "settled", Some(amount.0), None, None);
            self.emit("settled", json!({ "token_id": token_id, "amount": amount }));
        } else {
            // Nothing left the contract: give the token its credit back.
            self.member_mut(&token_id).credit += amount.0;
            self.emit("settle_failed", json!({ "token_id": token_id, "amount": amount }));
        }
    }

    /// Holder withdraws tUSDC from the vault to their own account.
    /// Blocked while listed or while an advance is open.
    #[payable]
    pub fn withdraw(&mut self, token_id: TokenId, amount: U128) -> Promise {
        assert_one_yocto();
        let owner = self.assert_owner(&token_id);
        let stablecoin = self.stablecoin.clone();
        let vault = {
            let m = self.member_mut(&token_id);
            require!(m.listing.is_none(), "vault is frozen while listed");
            require!(m.debt == 0, "withdrawals are blocked while an advance is open");
            require!(amount.0 > 0 && amount.0 <= m.vault_balance, "amount exceeds vault balance");
            m.vault_balance -= amount.0;
            m.outflows_in_flight += 1;
            m.nonce += 1;
            m.vault.clone()
        };
        self.emit("withdraw_started", json!({ "token_id": token_id, "amount": amount, "to": owner }));
        vault_pay(vault, &stablecoin, &owner, amount.0)
            .then(
                ext_self::ext(env::current_account_id())
                    .with_static_gas(GAS_FOR_CALLBACK)
                    .on_withdrawn(token_id, amount, owner),
            )
    }

    #[private]
    pub fn on_withdrawn(&mut self, token_id: TokenId, amount: U128, receiver_id: AccountId) -> bool {
        let ok = promise_ok();
        {
            let m = self.member_mut(&token_id);
            m.outflows_in_flight -= 1;
            if ok {
                m.totals.withdrawn = U128(m.totals.withdrawn.0 + amount.0);
            } else {
                // Tokens never left the vault: restore the mirror balance.
                m.vault_balance += amount.0;
            }
        }
        if ok {
            self.record(&token_id, "withdrawn", Some(amount.0), Some(receiver_id.clone()), None);
            self.emit("withdrawn", json!({ "token_id": token_id, "amount": amount, "to": receiver_id }));
        } else {
            self.emit("withdraw_failed", json!({ "token_id": token_id, "amount": amount }));
        }
        ok
    }

    /// Generic person-payout callback: failure parks the amount in `claimable`.
    #[private]
    pub fn on_paid_out(&mut self, receiver_id: AccountId, amount: U128, reason: String) -> bool {
        let ok = promise_ok();
        if !ok {
            self.add_claimable(&receiver_id, amount.0);
            self.emit(
                "payout_parked",
                json!({ "to": receiver_id, "amount": amount, "reason": reason }),
            );
        }
        ok
    }

    /// Pulls anything parked for the caller (failed refunds, seller payouts).
    #[payable]
    pub fn claim(&mut self) -> Promise {
        assert_one_yocto();
        let who = env::predecessor_account_id();
        let amount = self.claimable.remove(&who).unwrap_or(0);
        require!(amount > 0, "nothing to claim");
        self.pay_person(&who, amount, "claim")
    }

    /// Club pulls its accumulated revenue (ticket sales minus members' cut, fees).
    #[payable]
    pub fn club_withdraw(&mut self, amount: U128) -> Promise {
        assert_one_yocto();
        self.assert_club();
        require!(amount.0 > 0 && amount.0 <= self.club_balance, "amount exceeds club balance");
        self.club_balance -= amount.0;
        ext_ft::ext(self.stablecoin.clone())
            .with_attached_deposit(NearToken::from_yoctonear(1))
            .with_static_gas(GAS_FOR_FT_TRANSFER)
            .ft_transfer(self.club.clone(), amount, Some("club withdraw".into()))
            .then(
                ext_self::ext(env::current_account_id())
                    .with_static_gas(GAS_FOR_CALLBACK)
                    .on_club_withdrawn(amount),
            )
    }

    #[private]
    pub fn on_club_withdrawn(&mut self, amount: U128) -> bool {
        let ok = promise_ok();
        if !ok {
            self.club_balance += amount.0;
        }
        ok
    }
}

impl NearSeat {
    /// Spreads `amount` across all memberships by category weight, O(1).
    pub(crate) fn distribute_to_pool(&mut self, amount: u128) {
        let supply = self.total_weight;
        if amount == 0 {
            return;
        }
        if supply == 0 {
            self.club_balance += amount;
            return;
        }
        self.acc_per_share += amount * ACC_SCALE / supply;
        self.pool_total_distributed += amount;
    }

    /// Brings a token's credit up to date: pool share + loan income from
    /// finished matches. Floor rounding; the remainder stays in the snapshot
    /// gap so it's paid later instead of lost.
    pub(crate) fn accrue(&mut self, token_id: &TokenId) {
        let acc = self.acc_per_share;
        let finished: Vec<(MatchId, MatchStatus)> = self
            .member(token_id)
            .pending_loan_income
            .iter()
            .map(|(id, _)| (*id, self.match_ref(*id).status))
            .collect();
        let m = self.member_mut(token_id);
        let weight = Category::of_seat(&m.seat).weight();
        let owed = (acc - m.acc_snapshot) * weight / ACC_SCALE;
        // Round the snapshot up so repeated accruals can never pay more than the pool holds.
        m.acc_snapshot += (owed * ACC_SCALE).div_ceil(weight);
        m.credit += owed;
        m.totals.pool_earned = U128(m.totals.pool_earned.0 + owed);

        let mut loan_income = 0u128;
        m.pending_loan_income.retain(|(id, amount)| {
            match finished.iter().find(|(fid, _)| fid == id).map(|(_, s)| *s) {
                Some(MatchStatus::Finished) => {
                    loan_income += *amount;
                    false
                }
                // Postponed: the renter is refunded from escrow, nothing is owed.
                Some(MatchStatus::Postponed) => false,
                _ => true,
            }
        });
        m.credit += loan_income;
        m.totals.loan_income = U128(m.totals.loan_income.0 + loan_income);
    }

    pub(crate) fn internal_settle(&mut self, token_id: &TokenId) -> Option<Promise> {
        self.accrue(token_id);
        let (amount, repaid, vault) = {
            let m = self.member_mut(token_id);
            let repaid = m.debt.min(m.credit);
            m.debt -= repaid;
            m.totals.advances_repaid = U128(m.totals.advances_repaid.0 + repaid);
            let amount = m.credit - repaid;
            m.credit = 0;
            (amount, repaid, m.vault.clone())
        };
        if repaid > 0 {
            self.advance_fund += repaid;
            self.record(token_id, "advance_repaid", Some(repaid), None, None);
            self.emit("advance_repaid", json!({ "token_id": token_id, "amount": U128(repaid) }));
        }
        if amount == 0 {
            return None;
        }
        Some(
            ext_ft::ext(self.stablecoin.clone())
                .with_attached_deposit(NearToken::from_yoctonear(1))
                .with_static_gas(GAS_FOR_FT_TRANSFER)
                .ft_transfer(vault, U128(amount), Some(format!("settle {token_id}")))
                .then(
                    ext_self::ext(env::current_account_id())
                        .with_static_gas(GAS_FOR_CALLBACK)
                        .on_settled(token_id.clone(), U128(amount)),
                ),
        )
    }

    /// Sends tUSDC from this contract to a person; failure parks it in `claimable`.
    pub(crate) fn pay_person(&mut self, to: &AccountId, amount: u128, reason: &str) -> Promise {
        ext_ft::ext(self.stablecoin.clone())
            .with_attached_deposit(NearToken::from_yoctonear(1))
            .with_static_gas(GAS_FOR_FT_TRANSFER)
            .ft_transfer(to.clone(), U128(amount), Some(reason.to_string()))
            .then(
                ext_self::ext(env::current_account_id())
                    .with_static_gas(GAS_FOR_CALLBACK)
                    .on_paid_out(to.clone(), U128(amount), reason.to_string()),
            )
    }
}
