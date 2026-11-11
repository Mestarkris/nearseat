//! End-to-end tests on a local NEAR sandbox: real accounts, real receipts,
//! real callbacks. Build the wasm first with `./scripts/build-contracts.sh`.
//!
//! Most tests use `mock-ft` as the stablecoin so they can force transfers to
//! fail; `full_season_on_real_tusdc` runs the happy path on the real tUSDC.

use near_workspaces::network::Sandbox;
use near_workspaces::result::ExecutionFinalResult;
use near_workspaces::types::NearToken;
use near_workspaces::{Account, AccountId, Contract, ContractState, Worker};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};

const ONE: u128 = 1_000_000; // 1 tUSDC
const SEASON_PRICE: u128 = 200 * ONE;
const TICKET: u128 = 15 * ONE;
const HOUR_NS: u64 = 3_600_000_000_000;
const SEAT: &str = "c5-12";
const TOKEN: &str = "seat-c5-12";

fn wasm(name: &str) -> Vec<u8> {
    let path = format!("{}/../../target/near/{name}/{name}.wasm", env!("CARGO_MANIFEST_DIR"));
    std::fs::read(&path).unwrap_or_else(|_| panic!("missing {path}: run ./scripts/build-contracts.sh first"))
}

struct World {
    worker: Worker<Sandbox>,
    seat: Contract,
    token: Contract,
    real_tusdc: bool,
    club: Account,
    gate: Account,
    alice: Account,
    bob: Account,
    carol: Account,
    vault_hash: [u8; 32],
}

async fn sub(root: &Account, name: &str, near: u128) -> anyhow::Result<Account> {
    Ok(root.create_subaccount(name).initial_balance(NearToken::from_near(near)).transact().await?.into_result()?)
}

/// Asserts success and hands the result back (for `.json()`).
fn succeeded(r: ExecutionFinalResult) -> ExecutionFinalResult {
    assert!(r.is_success(), "expected success, got {:#?}", r.failures());
    r
}

async fn ok(r: ExecutionFinalResult) {
    let _ = succeeded(r);
}

fn failed_with(r: &ExecutionFinalResult, needle: &str) {
    let all = format!("{:?}", r.failures());
    assert!(all.contains(needle), "expected failure containing {needle:?}, got {all}");
}

impl World {
    async fn new(real_tusdc: bool) -> anyhow::Result<Self> {
        let worker = near_workspaces::sandbox().await?;
        let root = worker.root_account()?;

        // 1. Vault code as an immutable global contract (by hash).
        let globals = sub(&root, "globals", 20).await?;
        let globals = globals.deploy(&wasm("mock_ft")).await?.into_result()?;
        ok(globals.call("new").transact().await?).await;
        let vault_code = wasm("nearseat_vault");
        ok(globals.call("deploy_global").args_borsh(vault_code.clone()).max_gas().transact().await?).await;
        let vault_hash: [u8; 32] = Sha256::digest(&vault_code).into();

        // 2. Stablecoin.
        let token_acc = sub(&root, "tusdc", 20).await?;
        let token = if real_tusdc {
            token_acc.deploy(&wasm("tusdc")).await?.into_result()?
        } else {
            token_acc.deploy(&wasm("mock_ft")).await?.into_result()?
        };
        ok(token.call("new").transact().await?).await;

        // 3. People.
        let club = sub(&root, "club", 30).await?;
        let gate = sub(&root, "gate", 10).await?;
        let alice = sub(&root, "alice", 10).await?;
        let bob = sub(&root, "bob", 10).await?;
        let carol = sub(&root, "carol", 10).await?;

        // 4. NearSeat. Vaults become <seat>.nearseat.<root>.
        let seat_acc = sub(&root, "nearseat", 50).await?;
        let seat = seat_acc.deploy(&wasm("nearseat")).await?.into_result()?;
        ok(seat
            .call("new")
            .args_json(json!({
                "club": club.id(),
                "gate": gate.id(),
                "stablecoin": token.id(),
                "vault_code_hash": bs58::encode(vault_hash).into_string(),
                "season_name": "2026/27",
                "season_price": SEASON_PRICE.to_string(),
                "max_supply": 20,
            }))
            .transact()
            .await?)
        .await;

        let w = World { worker, seat, token, real_tusdc, club, gate, alice, bob, carol, vault_hash };
        for acc in [w.seat.as_account().clone(), w.club.clone(), w.alice.clone(), w.bob.clone(), w.carol.clone()] {
            w.register(acc.id()).await?;
        }
        Ok(w)
    }

    async fn register(&self, id: &AccountId) -> anyhow::Result<()> {
        ok(self
            .club
            .call(self.token.id(), "storage_deposit")
            .args_json(json!({ "account_id": id, "registration_only": true }))
            .deposit(NearToken::from_millinear(10))
            .transact()
            .await?)
        .await;
        Ok(())
    }

    async fn fund(&self, who: &Account, amount: u128) -> anyhow::Result<()> {
        let r = if self.real_tusdc {
            who.call(self.token.id(), "faucet").args_json(json!({ "amount": amount.to_string() })).transact().await?
        } else {
            who.call(self.token.id(), "mint")
                .args_json(json!({ "account_id": who.id(), "amount": amount.to_string() }))
                .transact()
                .await?
        };
        ok(r).await;
        Ok(())
    }

    async fn balance(&self, id: &AccountId) -> anyhow::Result<u128> {
        let v: String = self.token.view("ft_balance_of").args_json(json!({ "account_id": id })).await?.json()?;
        Ok(v.parse()?)
    }

    async fn view(&self, method: &str, args: Value) -> anyhow::Result<Value> {
        Ok(self.seat.view(method).args_json(args).await?.json()?)
    }

    async fn membership(&self) -> anyhow::Result<Value> {
        self.view("membership", json!({ "token_id": TOKEN })).await
    }

    fn vault_id(&self) -> AccountId {
        format!("{TOKEN}.{}", self.seat.id()).parse().unwrap()
    }

    async fn call(&self, who: &Account, method: &str, args: Value, yocto: u128) -> anyhow::Result<ExecutionFinalResult> {
        Ok(who
            .call(self.seat.id(), method)
            .args_json(args)
            .deposit(NearToken::from_yoctonear(yocto))
            .max_gas()
            .transact()
            .await?)
    }

    /// Pays the NearSeat contract with `ft_transfer_call`.
    async fn pay(&self, who: &Account, amount: u128, msg: Value) -> anyhow::Result<ExecutionFinalResult> {
        Ok(who
            .call(self.token.id(), "ft_transfer_call")
            .args_json(json!({ "receiver_id": self.seat.id(), "amount": amount.to_string(), "msg": msg.to_string() }))
            .deposit(NearToken::from_yoctonear(1))
            .max_gas()
            .transact()
            .await?)
    }

    async fn mint(&self, seat: &str, owner: &Account) -> anyhow::Result<()> {
        let r = self
            .club
            .call(self.seat.id(), "mint_membership")
            .args_json(json!({ "seat": seat, "owner_id": owner.id() }))
            .deposit(NearToken::from_millinear(100))
            .max_gas()
            .transact()
            .await?;
        ok(r).await;
        Ok(())
    }

    async fn new_match(&self) -> anyhow::Result<u32> {
        let now = self.worker.view_block().await?.timestamp();
        let r = succeeded(self
            .call(
                &self.club,
                "create_match",
                json!({
                    "opponent": "Stepan City FC",
                    "competition": "League",
                    "kickoff_at": (now + HOUR_NS).to_string(),
                    "ticket_price": TICKET.to_string(),
                }),
                0,
            )
            .await?);
        Ok(r.json()?)
    }

    async fn club_does(&self, method: &str, args: Value) -> anyhow::Result<ExecutionFinalResult> {
        self.call(&self.club, method, args, 0).await
    }

    /// Tops up the pool and settles everything into vaults.
    async fn pay_members(&self, amount: u128) -> anyhow::Result<()> {
        self.fund(&self.club, amount).await?;
        ok(self.pay(&self.club, amount, json!({ "action": "top_up_pool" })).await?).await;
        ok(self.call(&self.carol, "settle", json!({ "token_id": TOKEN }), 0).await?).await;
        Ok(())
    }

    async fn list_and_buy(&self, seller: &Account, buyer: &Account, price: u128) -> anyhow::Result<ExecutionFinalResult> {
        ok(self.call(seller, "list", json!({ "token_id": TOKEN, "price": price.to_string() }), 1).await?).await;
        let nonce = self.membership().await?["nonce"].as_str().unwrap().to_string();
        self.fund(buyer, price).await?;
        self.pay(buyer, price, json!({ "action": "buy_membership", "token_id": TOKEN, "expected_nonce": nonce })).await
    }
}

fn u(v: &Value) -> u128 {
    v.as_str().map(|s| s.parse().unwrap()).unwrap_or_else(|| v.as_u64().unwrap() as u128)
}

// ---------------------------------------------------------------------------

#[tokio::test]
async fn vault_is_keyless_runs_global_code_and_obeys_only_parent() -> anyhow::Result<()> {
    let w = World::new(false).await?;
    w.mint(SEAT, &w.alice).await?;

    let keys = w.worker.view_access_keys(&w.vault_id()).await?;
    assert!(keys.is_empty(), "vault must have zero access keys");

    let details = w.worker.view_account(&w.vault_id()).await?;
    match details.contract_state {
        ContractState::GlobalHash(h) => assert_eq!(h.0, w.vault_hash, "vault runs the published code hash"),
        other => panic!("vault should use the global contract by hash, got {other:?}"),
    }

    // Outsider and the owner herself call the vault directly: both refused.
    for who in [&w.carol, &w.alice] {
        let r = who
            .call(&w.vault_id(), "pay")
            .args_borsh((w.token.id().as_str(), who.id().as_str(), 1u128))
            .max_gas()
            .transact()
            .await?;
        failed_with(&r, "vault only obeys its parent contract");
    }
    Ok(())
}

#[tokio::test]
async fn full_season_on_real_tusdc() -> anyhow::Result<()> {
    let w = World::new(true).await?;
    w.mint(SEAT, &w.alice).await?;
    w.mint("c5-13", &w.bob).await?;
    let m = w.new_match().await?;

    // Two single tickets: 30 tUSDC in this match's escrow.
    w.fund(&w.carol, 1000 * ONE).await?;
    for seat in ["a3-1", "a3-2"] {
        ok(w.pay(&w.carol, TICKET, json!({ "action": "buy_seat", "match_id": m, "seat": seat })).await?).await;
    }
    ok(w.call(&w.gate, "check_in", json!({ "token_id": TOKEN, "match_id": m, "holder": w.alice.id() }), 0).await?).await;
    ok(w.club_does("kickoff", json!({ "match_id": m })).await?).await;
    ok(w.club_does("goal", json!({ "match_id": m, "side": "Home", "scorer": "Adewale" })).await?).await;
    ok(w.club_does("full_time", json!({ "match_id": m })).await?).await;

    // Keeper settles the payout round: 5% of 30 = 1.5, split by 2.
    ok(w.call(&w.carol, "settle_batch", json!({}), 0).await?).await;
    assert_eq!(w.balance(&w.vault_id()).await?, 750_000, "money is on the vault account itself");
    let season = w.view("season", json!({})).await?;
    assert_eq!(season["round_settled"], 2);

    let before = w.balance(w.alice.id()).await?;
    ok(w.call(&w.alice, "withdraw", json!({ "token_id": TOKEN, "amount": "750000" }), 1).await?).await;
    assert_eq!(w.balance(w.alice.id()).await? - before, 750_000);
    assert_eq!(w.balance(&w.vault_id()).await?, 0);

    let card = w.membership().await?;
    assert_eq!(card["goal_stamps"].as_array().unwrap().len(), 1);
    assert_eq!(card["tier"], "Silver");
    Ok(())
}

#[tokio::test]
async fn sale_mid_payout_buyer_receives_settlement() -> anyhow::Result<()> {
    let w = World::new(false).await?;
    w.mint(SEAT, &w.alice).await?;
    w.fund(&w.club, 10 * ONE).await?;
    ok(w.pay(&w.club, 10 * ONE, json!({ "action": "top_up_pool" })).await?).await;
    ok(w.call(&w.alice, "list", json!({ "token_id": TOKEN, "price": SEASON_PRICE.to_string() }), 1).await?).await;
    let nonce = w.membership().await?["nonce"].as_str().unwrap().to_string();
    w.fund(&w.bob, SEASON_PRICE).await?;

    // Fire the settlement and the purchase without waiting: their receipts interleave.
    let settle = w.carol.call(w.seat.id(), "settle").args_json(json!({ "token_id": TOKEN })).max_gas().transact_async().await?;
    let buy = w
        .bob
        .call(w.token.id(), "ft_transfer_call")
        .args_json(json!({
            "receiver_id": w.seat.id(),
            "amount": SEASON_PRICE.to_string(),
            "msg": json!({ "action": "buy_membership", "token_id": TOKEN, "expected_nonce": nonce }).to_string(),
        }))
        .deposit(NearToken::from_yoctonear(1))
        .max_gas()
        .transact_async()
        .await?;
    ok(settle.await?).await;
    ok(buy.await?).await;

    let card = w.membership().await?;
    assert_eq!(card["owner_id"], w.bob.id().as_str());
    assert_eq!(u(&card["vault_balance"]), 10 * ONE, "settlement landed in the vault, now Bob's");
    assert_eq!(w.balance(&w.vault_id()).await?, 10 * ONE);
    // Seller got exactly price minus 5% royalty.
    assert_eq!(w.balance(w.alice.id()).await?, SEASON_PRICE - SEASON_PRICE / 20);

    let r = w.call(&w.alice, "withdraw", json!({ "token_id": TOKEN, "amount": "1" }), 1).await?;
    failed_with(&r, "only the current holder can do this");
    ok(w.call(&w.bob, "withdraw", json!({ "token_id": TOKEN, "amount": (10 * ONE).to_string() }), 1).await?).await;
    assert_eq!(w.balance(w.bob.id()).await?, 10 * ONE);
    Ok(())
}

#[tokio::test]
async fn failed_settlement_callback_restores_state() -> anyhow::Result<()> {
    let w = World::new(false).await?;
    w.mint(SEAT, &w.alice).await?;
    ok(w.token.call("set_failing").args_json(json!({ "account_id": w.vault_id(), "failing": true })).transact().await?).await;
    w.fund(&w.club, 10 * ONE).await?;
    ok(w.pay(&w.club, 10 * ONE, json!({ "action": "top_up_pool" })).await?).await;
    // The outer call succeeds; the transfer it spawns fails, and the callback must undo it.
    let _ = w.call(&w.carol, "settle", json!({ "token_id": TOKEN }), 0).await?;

    let card = w.membership().await?;
    assert_eq!(u(&card["unsettled"]), 10 * ONE, "credit restored by the callback");
    assert_eq!(u(&card["vault_balance"]), 0);
    assert_eq!(w.balance(&w.vault_id()).await?, 0);

    // Once the token accepts transfers again, the same money settles.
    ok(w.token.call("set_failing").args_json(json!({ "account_id": w.vault_id(), "failing": false })).transact().await?).await;
    ok(w.call(&w.carol, "settle", json!({ "token_id": TOKEN }), 0).await?).await;
    assert_eq!(w.balance(&w.vault_id()).await?, 10 * ONE);
    Ok(())
}

#[tokio::test]
async fn failed_withdraw_callback_restores_vault_balance() -> anyhow::Result<()> {
    let w = World::new(false).await?;
    w.mint(SEAT, &w.alice).await?;
    w.pay_members(10 * ONE).await?;
    ok(w.token.call("set_failing").args_json(json!({ "account_id": w.alice.id(), "failing": true })).transact().await?).await;
    let _ = w.call(&w.alice, "withdraw", json!({ "token_id": TOKEN, "amount": (4 * ONE).to_string() }), 1).await?;
    let card = w.membership().await?;
    assert_eq!(u(&card["vault_balance"]), 10 * ONE);
    assert_eq!(card["outflows_in_flight"], 0);
    assert_eq!(w.balance(&w.vault_id()).await?, 10 * ONE);
    Ok(())
}

#[tokio::test]
async fn wrong_nonce_refunds_buyer_and_keeps_owner() -> anyhow::Result<()> {
    let w = World::new(false).await?;
    w.mint(SEAT, &w.alice).await?;
    w.pay_members(10 * ONE).await?;
    ok(w.call(&w.alice, "list", json!({ "token_id": TOKEN, "price": SEASON_PRICE.to_string() }), 1).await?).await;
    let seen = w.membership().await?["nonce"].as_str().unwrap().to_string();

    // Seller delists, drains the vault, relists at the same price.
    ok(w.call(&w.alice, "delist", json!({ "token_id": TOKEN }), 1).await?).await;
    ok(w.call(&w.alice, "withdraw", json!({ "token_id": TOKEN, "amount": (10 * ONE).to_string() }), 1).await?).await;
    ok(w.call(&w.alice, "list", json!({ "token_id": TOKEN, "price": SEASON_PRICE.to_string() }), 1).await?).await;

    w.fund(&w.bob, SEASON_PRICE).await?;
    let r = w.pay(&w.bob, SEASON_PRICE, json!({ "action": "buy_membership", "token_id": TOKEN, "expected_nonce": seen })).await?;
    failed_with(&r, "vault changed since you looked");
    assert_eq!(w.balance(w.bob.id()).await?, SEASON_PRICE, "buyer refunded in full");
    assert_eq!(w.membership().await?["owner_id"], w.alice.id().as_str());
    Ok(())
}

#[tokio::test]
async fn price_caps_enforced() -> anyhow::Result<()> {
    let w = World::new(false).await?;
    w.mint(SEAT, &w.alice).await?;
    let m = w.new_match().await?;
    let r = w.call(&w.alice, "list", json!({ "token_id": TOKEN, "price": (241 * ONE).to_string() }), 1).await?;
    failed_with(&r, "resale cap");
    let r = w.call(&w.alice, "lend", json!({ "token_id": TOKEN, "match_id": m, "price": (23 * ONE).to_string() }), 1).await?;
    failed_with(&r, "lend cap");
    Ok(())
}

#[tokio::test]
async fn renter_and_old_owner_locked_out() -> anyhow::Result<()> {
    let w = World::new(false).await?;
    w.mint(SEAT, &w.alice).await?;
    let m = w.new_match().await?;
    ok(w.call(&w.alice, "lend", json!({ "token_id": TOKEN, "match_id": m, "price": (20 * ONE).to_string() }), 1).await?).await;
    w.fund(&w.carol, 20 * ONE).await?;
    ok(w.pay(&w.carol, 20 * ONE, json!({ "action": "buy_seat", "match_id": m, "seat": SEAT })).await?).await;

    // While rented, only Carol gets in; Alice is refused.
    let r = w.call(&w.gate, "check_in", json!({ "token_id": TOKEN, "match_id": m, "holder": w.alice.id() }), 0).await?;
    failed_with(&r, "pass holder is not the current holder");

    // Alice sells; Carol keeps her match; Alice can't use the old pass.
    let r = w.list_and_buy(&w.alice, &w.bob, SEASON_PRICE).await?;
    ok(r).await;
    assert_eq!(w.view("holder_for", json!({ "token_id": TOKEN, "match_id": m })).await?, w.carol.id().as_str());

    ok(w.club_does("kickoff", json!({ "match_id": m })).await?).await;
    ok(w.club_does("full_time", json!({ "match_id": m })).await?).await;
    let r = w.call(&w.gate, "check_in", json!({ "token_id": TOKEN, "match_id": m, "holder": w.carol.id() }), 0).await?;
    failed_with(&r, "gates are closed for this match");

    // Rental income (20 − 5% = 19) followed the token to Bob.
    assert_eq!(u(&w.membership().await?["unsettled"]), 19 * ONE);
    Ok(())
}

#[tokio::test]
async fn goal_stamps_only_for_checked_in_members() -> anyhow::Result<()> {
    let w = World::new(false).await?;
    w.mint(SEAT, &w.alice).await?;
    w.mint("c5-13", &w.bob).await?;
    let m = w.new_match().await?;
    ok(w.call(&w.gate, "check_in", json!({ "token_id": TOKEN, "match_id": m, "holder": w.alice.id() }), 0).await?).await;
    ok(w.club_does("kickoff", json!({ "match_id": m })).await?).await;
    ok(w.club_does("goal", json!({ "match_id": m, "side": "Home", "scorer": "Adewale" })).await?).await;
    let bob = w.view("membership", json!({ "token_id": "seat-c5-13" })).await?;
    assert_eq!(w.membership().await?["goal_stamps"].as_array().unwrap().len(), 1);
    assert!(bob["goal_stamps"].as_array().unwrap().is_empty());
    let r = w.call(&w.alice, "goal", json!({ "match_id": m, "side": "Home", "scorer": "Fake" }), 0).await?;
    failed_with(&r, "only the club can do this");
    Ok(())
}

#[tokio::test]
async fn postpone_refunds_every_ticket() -> anyhow::Result<()> {
    let w = World::new(false).await?;
    w.mint(SEAT, &w.alice).await?;
    let m = w.new_match().await?;
    w.fund(&w.carol, 1000 * ONE).await?;
    w.fund(&w.bob, 1000 * ONE).await?;
    ok(w.pay(&w.carol, TICKET, json!({ "action": "buy_seat", "match_id": m, "seat": "a3-1" })).await?).await;
    ok(w.call(&w.alice, "lend", json!({ "token_id": TOKEN, "match_id": m, "price": (20 * ONE).to_string() }), 1).await?).await;
    ok(w.pay(&w.bob, 20 * ONE, json!({ "action": "buy_seat", "match_id": m, "seat": SEAT })).await?).await;

    ok(w.club_does("postpone", json!({ "match_id": m })).await?).await;
    ok(w.call(&w.carol, "process_refunds", json!({ "match_id": m }), 0).await?).await;
    assert_eq!(w.balance(w.carol.id()).await?, 1000 * ONE);
    assert_eq!(w.balance(w.bob.id()).await?, 1000 * ONE);
    let mm = w.view("get_match", json!({ "match_id": m })).await?;
    assert_eq!(mm["refunds_done"], 2);
    Ok(())
}

#[tokio::test]
async fn advance_repaid_on_sale() -> anyhow::Result<()> {
    let w = World::new(false).await?;
    w.mint(SEAT, &w.alice).await?;
    for _ in 0..4 {
        w.new_match().await?;
    }
    w.fund(&w.club, 100 * ONE).await?;
    ok(w.pay(&w.club, 100 * ONE, json!({ "action": "top_up_advance_fund" })).await?).await;
    ok(w.call(&w.alice, "borrow", json!({ "token_id": TOKEN, "amount": (2 * ONE).to_string() }), 1).await?).await;
    assert_eq!(w.balance(w.alice.id()).await?, 2 * ONE);

    let r = w.call(&w.alice, "nft_transfer", json!({ "receiver_id": w.bob.id(), "token_id": TOKEN }), 1).await?;
    failed_with(&r, "repay the advance before transferring");

    ok(w.list_and_buy(&w.alice, &w.bob, SEASON_PRICE).await?).await;
    let card = w.membership().await?;
    assert_eq!(u(&card["debt"]), 0);
    // Seller got price − 5% royalty − 2 tUSDC advance, on top of the 2 borrowed.
    assert_eq!(w.balance(w.alice.id()).await?, 2 * ONE + SEASON_PRICE - SEASON_PRICE / 20 - 2 * ONE);
    Ok(())
}

#[tokio::test]
async fn double_vote_blocked_after_sale() -> anyhow::Result<()> {
    let w = World::new(false).await?;
    w.mint(SEAT, &w.alice).await?;
    let m = w.new_match().await?;
    ok(w.call(&w.gate, "check_in", json!({ "token_id": TOKEN, "match_id": m, "holder": w.alice.id() }), 0).await?).await;
    let poll: u32 = succeeded(
        w.club_does("create_poll", json!({ "question": "Kit colour?", "options": ["Lime", "Black"], "duration_hours": 24 })).await?,
    )
    .json()?;
    ok(w.call(&w.alice, "vote", json!({ "token_id": TOKEN, "poll_id": poll, "option": 0 }), 1).await?).await;
    ok(w.call(&w.alice, "nft_transfer", json!({ "receiver_id": w.bob.id(), "token_id": TOKEN }), 1).await?).await;
    let r = w.call(&w.bob, "vote", json!({ "token_id": TOKEN, "poll_id": poll, "option": 1 }), 1).await?;
    failed_with(&r, "already voted");
    Ok(())
}

#[tokio::test]
async fn fan_buys_new_membership_from_club_with_tusdc() -> anyhow::Result<()> {
    let w = World::new(true).await?;
    w.fund(&w.alice, 1000 * ONE).await?;
    ok(w.pay(&w.alice, SEASON_PRICE, json!({ "action": "buy_new_membership", "seat": "b3-7" })).await?).await;

    let card = w.view("membership", json!({ "token_id": "seat-b3-7" })).await?;
    assert_eq!(card["owner_id"], w.alice.id().as_str());
    let vault: AccountId = card["vault"].as_str().unwrap().parse()?;
    assert!(w.worker.view_access_keys(&vault).await?.is_empty(), "bought vault is keyless too");
    assert_eq!(w.balance(w.alice.id()).await?, 1000 * ONE - SEASON_PRICE);
    assert_eq!(u(&w.view("season", json!({})).await?["club_balance"]), SEASON_PRICE);

    // Wrong price: refunded in full, nothing minted.
    let before = w.balance(w.alice.id()).await?;
    let r = w.pay(&w.alice, SEASON_PRICE / 2, json!({ "action": "buy_new_membership", "seat": "b3-8" })).await?;
    failed_with(&r, "send exactly the season price");
    assert_eq!(w.balance(w.alice.id()).await?, before);
    assert!(w.view("membership", json!({ "token_id": "seat-b3-8" })).await?.is_null());
    Ok(())
}

#[tokio::test]
async fn vip_seat_costs_more_and_earns_a_bigger_share() -> anyhow::Result<()> {
    let w = World::new(true).await?;
    w.mint(SEAT, &w.alice).await?; // standard, weight 4
    w.fund(&w.bob, 1000 * ONE).await?;

    // A VIP seat is refused at the standard price and sold at 2.5x.
    let r = w.pay(&w.bob, SEASON_PRICE, json!({ "action": "buy_new_membership", "seat": "a1-1" })).await?;
    failed_with(&r, "send exactly the season price for this seat's category");
    assert_eq!(w.balance(w.bob.id()).await?, 1000 * ONE);
    let vip_price = SEASON_PRICE * 5 / 2;
    ok(w.pay(&w.bob, vip_price, json!({ "action": "buy_new_membership", "seat": "a1-1" })).await?).await;
    let vip = w.view("membership", json!({ "token_id": "seat-a1-1" })).await?;
    assert_eq!(vip["category"], "Vip");
    assert_eq!(vip["share_weight"], 10);
    assert_eq!(u(&w.view("season", json!({})).await?["total_weight"]), 14);

    // 14 tUSDC to the pool: 10 to the VIP seat's account, 4 to the standard one.
    w.fund(&w.club, 14 * ONE).await?;
    ok(w.pay(&w.club, 14 * ONE, json!({ "action": "top_up_pool" })).await?).await;
    ok(w.call(&w.carol, "settle", json!({ "token_id": TOKEN }), 0).await?).await;
    ok(w.call(&w.carol, "settle", json!({ "token_id": "seat-a1-1" }), 0).await?).await;
    let vip_vault: AccountId = vip["vault"].as_str().unwrap().parse()?;
    assert_eq!(w.balance(&vip_vault).await?, 10 * ONE);
    assert_eq!(w.balance(&w.vault_id()).await?, 4 * ONE);
    Ok(())
}

#[tokio::test]
async fn seat_pays_a_vendor_and_keeps_renewal_savings_locked() -> anyhow::Result<()> {
    let w = World::new(true).await?;
    w.mint(SEAT, &w.alice).await?;
    // Carol runs the food kiosk; the club approves her.
    ok(w.call(&w.club, "set_vendor", json!({ "account_id": w.carol.id(), "name": "Mama Tee's Kitchen" }), 0).await?).await;
    // Alice sets half of every payout aside for renewal, then a payout lands.
    ok(w.call(&w.alice, "set_renewal_saving", json!({ "token_id": TOKEN, "bps": 5000 }), 1).await?).await;
    w.pay_members(10 * ONE).await?;
    let card = w.membership().await?;
    assert_eq!((u(&card["vault_balance"]), u(&card["renewal_saved"]), u(&card["spendable"])), (10 * ONE, 5 * ONE, 5 * ONE));

    // The seat's own account pays for the meal: vault → vendor, nothing via Alice.
    ok(w.call(&w.alice, "pay_vendor", json!({ "token_id": TOKEN, "vendor_id": w.carol.id(), "amount": (3 * ONE).to_string(), "memo": "Jollof rice" }), 1).await?).await;
    assert_eq!(w.balance(w.carol.id()).await?, 3 * ONE);
    assert_eq!(w.balance(&w.vault_id()).await?, 7 * ONE);
    assert_eq!(w.balance(w.alice.id()).await?, 0);
    assert_eq!(u(&w.membership().await?["vendor_spent"]), 3 * ONE);

    // Only 2 tUSDC is free now: the saved half can't be spent or withdrawn.
    let r = w.call(&w.alice, "pay_vendor", json!({ "token_id": TOKEN, "vendor_id": w.carol.id(), "amount": (3 * ONE).to_string() }), 1).await?;
    failed_with(&r, "amount exceeds what this seat can spend");
    let r = w.call(&w.alice, "withdraw", json!({ "token_id": TOKEN, "amount": (3 * ONE).to_string() }), 1).await?;
    failed_with(&r, "set aside for renewal");
    // Someone who isn't an approved vendor can't be paid, and a non-holder can't pay.
    let r = w.call(&w.alice, "pay_vendor", json!({ "token_id": TOKEN, "vendor_id": w.bob.id(), "amount": ONE.to_string() }), 1).await?;
    failed_with(&r, "not an approved vendor");
    let r = w.call(&w.carol, "pay_vendor", json!({ "token_id": TOKEN, "vendor_id": w.carol.id(), "amount": ONE.to_string() }), 1).await?;
    failed_with(&r, "only the current holder can do this");
    assert_eq!(w.balance(&w.vault_id()).await?, 7 * ONE);
    Ok(())
}
