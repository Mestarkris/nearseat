//! TEST ONLY. A NEP-141 token whose `ft_transfer` panics for receivers on a
//! fail-list. Sandbox tests use it to prove that NearSeat's callbacks restore
//! state when a transfer into a vault, to a seller, or as a refund fails.
//! It also exposes `deploy_global`, because near-workspaces has no builder for
//! the DeployGlobalContract action. Never deployed to testnet.

use near_contract_standards::fungible_token::{FungibleToken, FungibleTokenCore, FungibleTokenResolver};
use near_contract_standards::storage_management::{StorageBalance, StorageBalanceBounds, StorageManagement};
use near_sdk::json_types::U128;
use near_sdk::store::LookupSet;
use near_sdk::{env, near, AccountId, BorshStorageKey, NearToken, PanicOnDefault, Promise, PromiseOrValue};

#[derive(BorshStorageKey)]
#[near]
enum StorageKey {
    Token,
    Failing,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct MockFt {
    token: FungibleToken,
    failing: LookupSet<AccountId>,
}

#[near]
impl MockFt {
    #[init]
    pub fn new() -> Self {
        Self { token: FungibleToken::new(StorageKey::Token), failing: LookupSet::new(StorageKey::Failing) }
    }

    pub fn mint(&mut self, account_id: AccountId, amount: U128) {
        self.token.internal_deposit(&account_id, amount.0);
    }

    /// Deploys `code` as an immutable global contract, addressed by its hash.
    pub fn deploy_global(&mut self, #[serializer(borsh)] code: Vec<u8>) -> Promise {
        Promise::new(env::current_account_id()).deploy_global_contract(code)
    }

    pub fn set_failing(&mut self, account_id: AccountId, failing: bool) {
        if failing {
            self.failing.insert(account_id);
        } else {
            self.failing.remove(&account_id);
        }
    }
}

#[near]
impl FungibleTokenCore for MockFt {
    #[payable]
    fn ft_transfer(&mut self, receiver_id: AccountId, amount: U128, memo: Option<String>) {
        if self.failing.contains(&receiver_id) {
            env::panic_str("mock-ft: transfer to this receiver fails");
        }
        self.token.ft_transfer(receiver_id, amount, memo)
    }

    #[payable]
    fn ft_transfer_call(&mut self, receiver_id: AccountId, amount: U128, memo: Option<String>, msg: String) -> PromiseOrValue<U128> {
        self.token.ft_transfer_call(receiver_id, amount, memo, msg)
    }

    fn ft_total_supply(&self) -> U128 {
        self.token.ft_total_supply()
    }

    fn ft_balance_of(&self, account_id: AccountId) -> U128 {
        self.token.ft_balance_of(account_id)
    }
}

#[near]
impl FungibleTokenResolver for MockFt {
    #[private]
    fn ft_resolve_transfer(&mut self, sender_id: AccountId, receiver_id: AccountId, amount: U128) -> U128 {
        self.token.internal_ft_resolve_transfer(&sender_id, receiver_id, amount).0.into()
    }
}

#[near]
impl StorageManagement for MockFt {
    #[payable]
    fn storage_deposit(&mut self, account_id: Option<AccountId>, registration_only: Option<bool>) -> StorageBalance {
        self.token.storage_deposit(account_id, registration_only)
    }

    #[payable]
    fn storage_withdraw(&mut self, amount: Option<NearToken>) -> StorageBalance {
        self.token.storage_withdraw(amount)
    }

    #[payable]
    fn storage_unregister(&mut self, force: Option<bool>) -> bool {
        self.token.internal_storage_unregister(force).is_some()
    }

    fn storage_balance_bounds(&self) -> StorageBalanceBounds {
        self.token.storage_balance_bounds()
    }

    fn storage_balance_of(&self, account_id: AccountId) -> Option<StorageBalance> {
        self.token.storage_balance_of(account_id)
    }
}
