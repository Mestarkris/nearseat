//! tUSDC: a **valueless** NEP-141 test token for NearSeat on testnet.
//!
//! 6 decimals like USDC. Anyone registered can call `faucet` for up to
//! 1,000 tUSDC every 10 minutes. It is not money and is never redeemable.

use near_contract_standards::fungible_token::events::FtMint;
use near_contract_standards::fungible_token::metadata::{
    FungibleTokenMetadata, FungibleTokenMetadataProvider, FT_METADATA_SPEC,
};
use near_contract_standards::fungible_token::{
    FungibleToken, FungibleTokenCore, FungibleTokenResolver,
};
use near_contract_standards::storage_management::{
    StorageBalance, StorageBalanceBounds, StorageManagement,
};
use near_sdk::json_types::U128;
use near_sdk::store::LookupMap;
use near_sdk::{env, near, require, AccountId, BorshStorageKey, NearToken, PanicOnDefault, PromiseOrValue};

/// 1,000 tUSDC (6 decimals).
pub const FAUCET_MAX: u128 = 1_000_000_000;
pub const FAUCET_COOLDOWN_NS: u64 = 10 * 60 * 1_000_000_000;

#[derive(BorshStorageKey)]
#[near]
enum StorageKey {
    Token,
    LastFaucet,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct TestUsdc {
    token: FungibleToken,
    last_faucet: LookupMap<AccountId, u64>,
}

#[near]
impl TestUsdc {
    #[init]
    pub fn new() -> Self {
        Self {
            token: FungibleToken::new(StorageKey::Token),
            last_faucet: LookupMap::new(StorageKey::LastFaucet),
        }
    }

    /// Mints up to 1,000 tUSDC to the caller. Caller must be registered (NEP-145).
    pub fn faucet(&mut self, amount: U128) {
        let who = env::predecessor_account_id();
        require!(amount.0 > 0 && amount.0 <= FAUCET_MAX, "faucet gives 1..1000 tUSDC per call");
        let now = env::block_timestamp();
        if let Some(last) = self.last_faucet.get(&who) {
            require!(now >= last + FAUCET_COOLDOWN_NS, "faucet cooldown: try again in a few minutes");
        }
        self.last_faucet.insert(who.clone(), now);
        self.token.internal_deposit(&who, amount.0);
        FtMint { owner_id: &who, amount, memo: Some("faucet (test token, no value)") }.emit();
    }
}

#[near]
impl FungibleTokenCore for TestUsdc {
    #[payable]
    fn ft_transfer(&mut self, receiver_id: AccountId, amount: U128, memo: Option<String>) {
        self.token.ft_transfer(receiver_id, amount, memo)
    }

    #[payable]
    fn ft_transfer_call(
        &mut self,
        receiver_id: AccountId,
        amount: U128,
        memo: Option<String>,
        msg: String,
    ) -> PromiseOrValue<U128> {
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
impl FungibleTokenResolver for TestUsdc {
    #[private]
    fn ft_resolve_transfer(&mut self, sender_id: AccountId, receiver_id: AccountId, amount: U128) -> U128 {
        let (used, _burned) = self.token.internal_ft_resolve_transfer(&sender_id, receiver_id, amount);
        used.into()
    }
}

#[near]
impl StorageManagement for TestUsdc {
    #[payable]
    fn storage_deposit(
        &mut self,
        account_id: Option<AccountId>,
        registration_only: Option<bool>,
    ) -> StorageBalance {
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

#[near]
impl FungibleTokenMetadataProvider for TestUsdc {
    fn ft_metadata(&self) -> FungibleTokenMetadata {
        FungibleTokenMetadata {
            spec: FT_METADATA_SPEC.to_string(),
            name: "Test USDC (no value)".to_string(),
            symbol: "tUSDC".to_string(),
            icon: None,
            reference: None,
            reference_hash: None,
            decimals: 6,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use near_sdk::test_utils::VMContextBuilder;
    use near_sdk::testing_env;

    fn setup(who: &str, ts: u64) -> TestUsdc {
        let mut b = VMContextBuilder::new();
        b.predecessor_account_id(who.parse().unwrap()).block_timestamp(ts);
        testing_env!(b.build());
        let mut t = TestUsdc::new();
        t.token.internal_register_account(&who.parse().unwrap());
        t
    }

    #[test]
    fn faucet_mints_to_caller() {
        let mut t = setup("fan.testnet", 1);
        t.faucet(U128(5_000_000));
        assert_eq!(t.ft_balance_of("fan.testnet".parse().unwrap()).0, 5_000_000);
    }

    #[test]
    #[should_panic(expected = "faucet gives 1..1000 tUSDC per call")]
    fn faucet_is_capped() {
        setup("fan.testnet", 1).faucet(U128(FAUCET_MAX + 1));
    }

    #[test]
    #[should_panic(expected = "faucet cooldown")]
    fn faucet_has_cooldown() {
        let mut t = setup("fan.testnet", 1);
        t.faucet(U128(1));
        t.faucet(U128(1));
    }
}
