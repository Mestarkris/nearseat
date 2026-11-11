//! Unit tests. Cross-contract calls don't execute here, so callbacks are
//! invoked directly with a simulated promise result. The same flows run
//! end-to-end with real receipts in `tests/sandbox.rs`.

use super::*;
use crate::membership::MINT_DEPOSIT;
use near_contract_standards::fungible_token::receiver::FungibleTokenReceiver;
use near_contract_standards::non_fungible_token::core::NonFungibleTokenCore;
use near_sdk::json_types::{Base58CryptoHash, U64};
use near_sdk::test_utils::VMContextBuilder;
use near_sdk::{testing_env, NearToken, PromiseResult, RuntimeFeesConfig};

const CONTRACT: &str = "nearseat.testnet";
const CLUB: &str = "club.testnet";
const GATE: &str = "gate.testnet";
const USDC: &str = "tusdc.testnet";
const ALICE: &str = "alice.testnet";
const BOB: &str = "bob.testnet";
const CAROL: &str = "carol.testnet";

const T0: u64 = 1_800_000_000_000_000_000;
const HOUR: u64 = 3_600_000_000_000;
const ONE: u128 = 1_000_000; // 1 tUSDC
const SEAT_A: &str = "c5-12";
const SEAT_B: &str = "c5-13";

fn a(s: &str) -> AccountId {
    s.parse().unwrap()
}

fn tid(seat: &str) -> TokenId {
    membership_token_id(seat)
}

struct Env {
    now: u64,
}

impl Env {
    fn call(&self, who: &str, deposit: u128) {
        let mut b = VMContextBuilder::new();
        b.current_account_id(a(CONTRACT))
            .predecessor_account_id(a(who))
            .signer_account_id(a(who))
            .attached_deposit(NearToken::from_yoctonear(deposit))
            .block_timestamp(self.now);
        testing_env!(b.build());
    }

    fn callback(&self, ok: bool) {
        let mut b = VMContextBuilder::new();
        b.current_account_id(a(CONTRACT))
            .predecessor_account_id(a(CONTRACT))
            .block_timestamp(self.now);
        let result = if ok { PromiseResult::Successful(vec![]) } else { PromiseResult::Failed };
        testing_env!(
            b.build(),
            near_sdk::test_vm_config(),
            RuntimeFeesConfig::test(),
            Default::default(),
            vec![result]
        );
    }
}

fn setup() -> (NearSeat, Env) {
    let env = Env { now: T0 };
    env.call(CLUB, 0);
    let c = NearSeat::new(
        a(CLUB),
        a(GATE),
        a(USDC),
        Base58CryptoHash::from([7u8; 32]),
        "2026/27".into(),
        U128(200 * ONE),
        50,
        None,
    );
    (c, env)
}

fn mint(c: &mut NearSeat, e: &Env, seat: &str, owner: &str) {
    e.call(CLUB, MINT_DEPOSIT.as_yoctonear());
    c.mint_membership(seat.into(), a(owner), None).detach();
    e.callback(true);
    assert!(c.on_vault_created(seat.into(), a(owner), Tier::Bronze));
}

fn pay(c: &mut NearSeat, e: &Env, from: &str, amount: u128, msg: &str) {
    e.call(USDC, 0);
    let _ = c.ft_on_transfer(a(from), U128(amount), msg.to_string());
}

fn new_match(c: &mut NearSeat, e: &Env) -> MatchId {
    e.call(CLUB, 0);
    c.create_match("Lagos City".into(), "League".into(), U64(e.now + HOUR), U128(15 * ONE), None, None)
}

fn club(e: &Env) {
    e.call(CLUB, 0);
}

// ---------- membership & vault ----------

#[test]
fn mint_creates_membership_owning_vault_subaccount() {
    let (mut c, e) = setup();
    mint(&mut c, &e, SEAT_A, ALICE);
    let m = c.membership(tid(SEAT_A)).unwrap();
    assert_eq!(m.vault.as_str(), "seat-c5-12.nearseat.testnet");
    assert_eq!(m.owner_id.as_str(), ALICE);
    assert_eq!(c.nft_token(tid(SEAT_A)).unwrap().owner_id.as_str(), ALICE);
}

#[test]
#[should_panic(expected = "only the club can do this")]
fn outsider_cannot_mint() {
    let (mut c, e) = setup();
    e.call(ALICE, MINT_DEPOSIT.as_yoctonear());
    c.mint_membership(SEAT_A.into(), a(ALICE), None).detach();
}

#[test]
#[should_panic(expected = "invalid seat")]
fn invalid_seat_rejected() {
    let (mut c, e) = setup();
    e.call(CLUB, MINT_DEPOSIT.as_yoctonear());
    c.mint_membership("z9-99".into(), a(ALICE), None).detach();
}

#[test]
fn failed_vault_creation_mints_nothing() {
    let (mut c, e) = setup();
    e.call(CLUB, MINT_DEPOSIT.as_yoctonear());
    c.mint_membership(SEAT_A.into(), a(ALICE), None).detach();
    e.callback(false);
    assert!(!c.on_vault_created(SEAT_A.into(), a(ALICE), Tier::Bronze));
    assert!(c.membership(tid(SEAT_A)).is_none());
}

// ---------- pool accumulator ----------

#[test]
fn new_mint_gets_no_past_rewards() {
    let (mut c, e) = setup();
    mint(&mut c, &e, SEAT_A, ALICE);
    pay(&mut c, &e, CLUB, 100 * ONE, r#"{"action":"top_up_pool"}"#);
    mint(&mut c, &e, SEAT_B, BOB);
    assert_eq!(c.membership(tid(SEAT_A)).unwrap().unsettled.0, 100 * ONE);
    assert_eq!(c.membership(tid(SEAT_B)).unwrap().unsettled.0, 0);
}

#[test]
fn accumulator_never_over_distributes() {
    let (mut c, e) = setup();
    for seat in ["a3-1", "a3-2", "a3-3"] {
        mint(&mut c, &e, seat, ALICE);
    }
    for amount in [1u128, 7, 10, 333_333, 2, 1_000_001] {
        pay(&mut c, &e, CLUB, amount, r#"{"action":"top_up_pool"}"#);
    }
    let total: u128 = ["a3-1", "a3-2", "a3-3"]
        .iter()
        .map(|s| c.membership(tid(s)).unwrap().unsettled.0)
        .sum();
    assert!(total <= c.pool_total_distributed);
    assert!(c.pool_total_distributed - total < 3 * 6, "dust stays tiny");
}

// ---------- tickets, refunds, matchday ----------

#[test]
fn full_time_moves_members_cut_to_pool() {
    let (mut c, e) = setup();
    mint(&mut c, &e, SEAT_A, ALICE);
    mint(&mut c, &e, SEAT_B, BOB);
    let m = new_match(&mut c, &e);
    pay(&mut c, &e, CAROL, 15 * ONE, &format!(r#"{{"action":"buy_seat","match_id":{m},"seat":"a3-1"}}"#));
    pay(&mut c, &e, CAROL, 15 * ONE, &format!(r#"{{"action":"buy_seat","match_id":{m},"seat":"a3-2"}}"#));
    club(&e);
    c.kickoff(m);
    c.full_time(m);
    // 5% of 30 = 1.5 tUSDC, split over 2 memberships.
    assert_eq!(c.membership(tid(SEAT_A)).unwrap().unsettled.0, 750_000);
    assert_eq!(c.club_balance, 30 * ONE - 1_500_000);
    assert_eq!(c.payout_round, 1);
}

#[test]
#[should_panic(expected = "this member seat is not offered for this match")]
fn cannot_sell_unlent_member_seat() {
    let (mut c, e) = setup();
    mint(&mut c, &e, SEAT_A, ALICE);
    let m = new_match(&mut c, &e);
    pay(&mut c, &e, CAROL, 15 * ONE, &format!(r#"{{"action":"buy_seat","match_id":{m},"seat":"{SEAT_A}"}}"#));
}

#[test]
#[should_panic(expected = "ticket limit per account reached")]
fn per_account_ticket_cap() {
    let (mut c, e) = setup();
    let m = new_match(&mut c, &e);
    for n in 1..=5 {
        pay(&mut c, &e, CAROL, 15 * ONE, &format!(r#"{{"action":"buy_seat","match_id":{m},"seat":"b3-{n}"}}"#));
    }
}

#[test]
#[should_panic(expected = "seat already taken")]
fn second_buyer_of_seat_rejected() {
    let (mut c, e) = setup();
    let m = new_match(&mut c, &e);
    let msg = format!(r#"{{"action":"buy_seat","match_id":{m},"seat":"b3-1"}}"#);
    pay(&mut c, &e, CAROL, 15 * ONE, &msg);
    pay(&mut c, &e, BOB, 15 * ONE, &msg);
}

#[test]
#[should_panic(expected = "single-match tickets are non-transferable")]
fn ticket_nft_transfer_rejected() {
    let (mut c, e) = setup();
    let m = new_match(&mut c, &e);
    pay(&mut c, &e, CAROL, 15 * ONE, &format!(r#"{{"action":"buy_seat","match_id":{m},"seat":"b3-1"}}"#));
    e.call(CAROL, 1);
    c.nft_transfer(a(BOB), format!("t{m}-b3-1"), None, None);
}

#[test]
fn postpone_refunds_once_and_parks_failures() {
    let (mut c, e) = setup();
    let m = new_match(&mut c, &e);
    pay(&mut c, &e, CAROL, 15 * ONE, &format!(r#"{{"action":"buy_seat","match_id":{m},"seat":"b3-1"}}"#));
    pay(&mut c, &e, BOB, 15 * ONE, &format!(r#"{{"action":"buy_seat","match_id":{m},"seat":"b3-2"}}"#));
    club(&e);
    c.postpone(m);
    e.call(CAROL, 0); // anyone may process refunds
    assert_eq!(c.process_refunds(m, None), 2);
    assert_eq!(c.process_refunds(m, None), 0, "no double refund");
    e.callback(true);
    c.on_refunded(m, 0);
    e.callback(false);
    c.on_refunded(m, 1);
    assert_eq!(c.payment(m, 0).unwrap().status, PaymentStatus::Refunded);
    assert_eq!(c.payment(m, 1).unwrap().status, PaymentStatus::RefundClaimable);
    assert_eq!(c.claimable_of(a(BOB)).0, 15 * ONE);
}

#[test]
#[should_panic(expected = "match is not live")]
fn goal_before_kickoff_rejected() {
    let (mut c, e) = setup();
    let m = new_match(&mut c, &e);
    club(&e);
    c.goal(m, Side::Home, "Okafor".into());
}

#[test]
#[should_panic(expected = "match is not live")]
fn full_time_twice_rejected() {
    let (mut c, e) = setup();
    let m = new_match(&mut c, &e);
    club(&e);
    c.kickoff(m);
    c.full_time(m);
    c.full_time(m);
}

#[test]
fn goal_stamps_only_for_checked_in_members() {
    let (mut c, mut e) = setup();
    mint(&mut c, &e, SEAT_A, ALICE);
    mint(&mut c, &e, SEAT_B, BOB);
    let m = new_match(&mut c, &e);
    e.call(GATE, 0);
    c.check_in(tid(SEAT_A), m, a(ALICE));
    club(&e);
    c.kickoff(m);
    e.now += 12 * 60 * 1_000_000_000;
    club(&e);
    c.goal(m, Side::Home, "Okafor".into());
    c.goal(m, Side::Away, "Visitor".into());
    e.now += 1;
    e.call(GATE, 0);
    c.check_in(tid(SEAT_B), m, a(BOB)); // arrives after the goal
    let stamps_a = c.membership(tid(SEAT_A)).unwrap().goal_stamps;
    assert_eq!(stamps_a.len(), 1, "home goals only");
    assert_eq!(stamps_a[0].minute, 13);
    assert!(c.membership(tid(SEAT_B)).unwrap().goal_stamps.is_empty());
}

#[test]
#[should_panic(expected = "only the gate scanner can do this")]
fn non_gate_cannot_check_in() {
    let (mut c, e) = setup();
    mint(&mut c, &e, SEAT_A, ALICE);
    let m = new_match(&mut c, &e);
    e.call(ALICE, 0);
    c.check_in(tid(SEAT_A), m, a(ALICE));
}

#[test]
#[should_panic(expected = "this seat already entered")]
fn second_check_in_rejected() {
    let (mut c, e) = setup();
    mint(&mut c, &e, SEAT_A, ALICE);
    let m = new_match(&mut c, &e);
    e.call(GATE, 0);
    c.check_in(tid(SEAT_A), m, a(ALICE));
    c.check_in(tid(SEAT_A), m, a(ALICE));
}

#[test]
fn tier_only_from_attendance() {
    let (mut c, e) = setup();
    mint(&mut c, &e, SEAT_A, ALICE);
    assert_eq!(c.membership(tid(SEAT_A)).unwrap().tier, Tier::Bronze);
    for _ in 0..2 {
        let m = new_match(&mut c, &e);
        e.call(GATE, 0);
        c.check_in(tid(SEAT_A), m, a(ALICE));
    }
    assert_eq!(c.membership(tid(SEAT_A)).unwrap().tier, Tier::Gold);
}

#[test]
#[should_panic(expected = "members_cut_bps must be 1%..20%")]
fn admin_setters_clamped() {
    let (mut c, e) = setup();
    e.call(CLUB, 0);
    c.set_config(Config { members_cut_bps: 0, ..Config::default() });
}

#[test]
#[should_panic(expected = "only the current holder can do this")]
fn club_cannot_move_member_funds() {
    let (mut c, e) = setup();
    mint(&mut c, &e, SEAT_A, ALICE);
    e.call(CLUB, 1);
    c.withdraw(tid(SEAT_A), U128(1)).detach();
}

// ---------- lending ----------

fn lend(c: &mut NearSeat, e: &Env, m: MatchId, price: u128) {
    e.call(ALICE, 1);
    c.lend(tid(SEAT_A), m, U128(price), None);
}

#[test]
#[should_panic(expected = "price is above the club's lend cap")]
fn lend_price_cap() {
    let (mut c, e) = setup();
    mint(&mut c, &e, SEAT_A, ALICE);
    let m = new_match(&mut c, &e);
    lend(&mut c, &e, m, 23 * ONE); // cap = 1.5 × 15 = 22.5
}

#[test]
#[should_panic(expected = "seat is already lent for this match")]
fn double_lend_rejected() {
    let (mut c, e) = setup();
    mint(&mut c, &e, SEAT_A, ALICE);
    let m = new_match(&mut c, &e);
    lend(&mut c, &e, m, 20 * ONE);
    lend(&mut c, &e, m, 20 * ONE);
}

fn rent(c: &mut NearSeat, e: &Env, m: MatchId) {
    pay(c, e, CAROL, 20 * ONE, &format!(r#"{{"action":"buy_seat","match_id":{m},"seat":"{SEAT_A}"}}"#));
}

#[test]
fn renter_holds_pass_and_income_follows_token() {
    let (mut c, e) = setup();
    mint(&mut c, &e, SEAT_A, ALICE);
    let m = new_match(&mut c, &e);
    lend(&mut c, &e, m, 20 * ONE);
    rent(&mut c, &e, m);
    assert_eq!(c.holder_for(tid(SEAT_A), m).as_str(), CAROL);
    club(&e);
    c.kickoff(m);
    c.full_time(m);
    // 20 tUSDC minus the 5% club fee is owed to the token, not to Alice.
    assert_eq!(c.membership(tid(SEAT_A)).unwrap().unsettled.0, 19 * ONE);
    assert_eq!(c.club_balance, ONE);
}

#[test]
#[should_panic(expected = "pass holder is not the current holder for this match")]
fn owner_refused_while_lent() {
    let (mut c, e) = setup();
    mint(&mut c, &e, SEAT_A, ALICE);
    let m = new_match(&mut c, &e);
    lend(&mut c, &e, m, 20 * ONE);
    rent(&mut c, &e, m);
    e.call(GATE, 0);
    c.check_in(tid(SEAT_A), m, a(ALICE));
}

#[test]
#[should_panic(expected = "gates are closed for this match")]
fn renter_locked_out_after_full_time() {
    let (mut c, e) = setup();
    mint(&mut c, &e, SEAT_A, ALICE);
    let m = new_match(&mut c, &e);
    lend(&mut c, &e, m, 20 * ONE);
    rent(&mut c, &e, m);
    club(&e);
    c.kickoff(m);
    c.full_time(m);
    e.call(GATE, 0);
    c.check_in(tid(SEAT_A), m, a(CAROL));
}

#[test]
#[should_panic(expected = "loans are locked once the match kicks off")]
fn kickoff_locks_loans() {
    let (mut c, e) = setup();
    mint(&mut c, &e, SEAT_A, ALICE);
    let m = new_match(&mut c, &e);
    club(&e);
    c.kickoff(m);
    lend(&mut c, &e, m, 20 * ONE);
}

#[test]
fn postponed_rental_owes_token_nothing() {
    let (mut c, e) = setup();
    mint(&mut c, &e, SEAT_A, ALICE);
    let m = new_match(&mut c, &e);
    lend(&mut c, &e, m, 20 * ONE);
    rent(&mut c, &e, m);
    club(&e);
    c.postpone(m);
    let v = c.membership(tid(SEAT_A)).unwrap();
    assert_eq!(v.unsettled.0, 0);
    assert_eq!(v.pending_loan_income.0, 0);
}

// ---------- settlement, withdrawal, resale ----------

/// Gives SEAT_A a settled vault balance of `amount`.
fn fund_vault(c: &mut NearSeat, e: &Env, amount: u128) {
    pay(c, e, CLUB, amount, r#"{"action":"top_up_pool"}"#);
    e.call(CAROL, 0);
    c.settle(tid(SEAT_A)).unwrap().detach();
    e.callback(true);
    c.on_settled(tid(SEAT_A), U128(amount));
}

fn list(c: &mut NearSeat, e: &Env, price: u128) {
    e.call(ALICE, 1);
    c.list(tid(SEAT_A), U128(price));
}

fn buy_msg(nonce: u64) -> String {
    format!(r#"{{"action":"buy_membership","token_id":"{}","expected_nonce":"{nonce}"}}"#, tid(SEAT_A))
}

#[test]
fn failed_settlement_restores_credit() {
    let (mut c, e) = setup();
    mint(&mut c, &e, SEAT_A, ALICE);
    pay(&mut c, &e, CLUB, 10 * ONE, r#"{"action":"top_up_pool"}"#);
    e.call(CAROL, 0);
    c.settle(tid(SEAT_A)).unwrap().detach();
    assert_eq!(c.member(&tid(SEAT_A)).credit, 0);
    e.callback(false);
    c.on_settled(tid(SEAT_A), U128(10 * ONE));
    assert_eq!(c.member(&tid(SEAT_A)).credit, 10 * ONE);
    assert_eq!(c.member(&tid(SEAT_A)).vault_balance, 0);
}

#[test]
fn failed_withdraw_restores_balance() {
    let (mut c, e) = setup();
    mint(&mut c, &e, SEAT_A, ALICE);
    fund_vault(&mut c, &e, 10 * ONE);
    e.call(ALICE, 1);
    c.withdraw(tid(SEAT_A), U128(4 * ONE)).detach();
    assert_eq!(c.member(&tid(SEAT_A)).outflows_in_flight, 1);
    e.callback(false);
    assert!(!c.on_withdrawn(tid(SEAT_A), U128(4 * ONE), a(ALICE)));
    let m = c.member(&tid(SEAT_A));
    assert_eq!((m.vault_balance, m.outflows_in_flight), (10 * ONE, 0));
}

#[test]
#[should_panic(expected = "vault is frozen while listed")]
fn withdraw_blocked_while_listed() {
    let (mut c, e) = setup();
    mint(&mut c, &e, SEAT_A, ALICE);
    fund_vault(&mut c, &e, 10 * ONE);
    list(&mut c, &e, 200 * ONE);
    e.call(ALICE, 1);
    c.withdraw(tid(SEAT_A), U128(ONE)).detach();
}

#[test]
#[should_panic(expected = "price must be 1..")]
fn price_above_cap_rejected() {
    let (mut c, e) = setup();
    mint(&mut c, &e, SEAT_A, ALICE);
    list(&mut c, &e, 241 * ONE); // cap = 120% of 200
}

#[test]
#[should_panic(expected = "vault changed since you looked")]
fn wrong_nonce_rejected() {
    let (mut c, e) = setup();
    mint(&mut c, &e, SEAT_A, ALICE);
    list(&mut c, &e, 200 * ONE);
    let seen = c.membership(tid(SEAT_A)).unwrap().nonce.0;
    e.call(ALICE, 1);
    c.delist(tid(SEAT_A));
    list(&mut c, &e, 200 * ONE); // same price, new nonce
    pay(&mut c, &e, BOB, 200 * ONE, &buy_msg(seen));
}

#[test]
#[should_panic(expected = "a withdrawal is in flight")]
fn buy_rejected_during_inflight_withdraw() {
    let (mut c, e) = setup();
    mint(&mut c, &e, SEAT_A, ALICE);
    fund_vault(&mut c, &e, 10 * ONE);
    e.call(ALICE, 1);
    c.withdraw(tid(SEAT_A), U128(ONE)).detach();
    // Force a listing to exist while the withdrawal is in flight.
    c.member_mut(&tid(SEAT_A)).listing = Some(Listing { price: U128(200 * ONE), listed_at: U64(0) });
    let nonce = c.member(&tid(SEAT_A)).nonce;
    pay(&mut c, &e, BOB, 200 * ONE, &buy_msg(nonce));
}

#[test]
fn sale_mid_payout_buyer_receives_settlement() {
    let (mut c, e) = setup();
    mint(&mut c, &e, SEAT_A, ALICE);
    pay(&mut c, &e, CLUB, 5 * ONE, r#"{"action":"top_up_pool"}"#);
    // Settlement into the vault is in flight...
    e.call(CAROL, 0);
    c.settle(tid(SEAT_A)).unwrap().detach();
    // ...when Alice's listing is bought by Bob.
    list(&mut c, &e, 200 * ONE);
    let nonce = c.membership(tid(SEAT_A)).unwrap().nonce.0;
    pay(&mut c, &e, BOB, 200 * ONE, &buy_msg(nonce));
    assert_eq!(c.nft_token(tid(SEAT_A)).unwrap().owner_id.as_str(), BOB);
    // Settlement lands after the sale: it belongs to the token, so to Bob.
    e.callback(true);
    c.on_settled(tid(SEAT_A), U128(5 * ONE));
    assert_eq!(c.member(&tid(SEAT_A)).vault_balance, 5 * ONE);
    e.call(BOB, 1);
    c.withdraw(tid(SEAT_A), U128(5 * ONE)).detach();
    // Royalty 5% to the club; Alice is paid the rest by a separate transfer.
    assert_eq!(c.club_balance, 10 * ONE);
}

#[test]
#[should_panic(expected = "only the current holder can do this")]
fn old_owner_cannot_withdraw_after_sale() {
    let (mut c, e) = setup();
    mint(&mut c, &e, SEAT_A, ALICE);
    fund_vault(&mut c, &e, 10 * ONE);
    list(&mut c, &e, 200 * ONE);
    let nonce = c.membership(tid(SEAT_A)).unwrap().nonce.0;
    pay(&mut c, &e, BOB, 200 * ONE, &buy_msg(nonce));
    e.call(ALICE, 1);
    c.withdraw(tid(SEAT_A), U128(ONE)).detach();
}

#[test]
fn sale_clears_offers_but_renter_keeps_match() {
    let (mut c, e) = setup();
    mint(&mut c, &e, SEAT_A, ALICE);
    let m1 = new_match(&mut c, &e);
    let m2 = new_match(&mut c, &e);
    lend(&mut c, &e, m1, 20 * ONE);
    rent(&mut c, &e, m1);
    lend(&mut c, &e, m2, 20 * ONE);
    list(&mut c, &e, 200 * ONE);
    let nonce = c.membership(tid(SEAT_A)).unwrap().nonce.0;
    pay(&mut c, &e, BOB, 200 * ONE, &buy_msg(nonce));
    assert_eq!(c.holder_for(tid(SEAT_A), m1).as_str(), CAROL, "renter keeps the paid match");
    assert!(c.loan_of(tid(SEAT_A), m2).is_none(), "un-rented offer cleared");
}

// ---------- Layer 2 ----------

fn fund_advances(c: &mut NearSeat, e: &Env) {
    pay(c, e, CLUB, 100 * ONE, r#"{"action":"top_up_advance_fund"}"#);
    for _ in 0..4 {
        new_match(c, e);
    }
}

#[test]
fn advance_repaid_on_sale() {
    let (mut c, e) = setup();
    mint(&mut c, &e, SEAT_A, ALICE);
    fund_advances(&mut c, &e);
    // cap = 50% × 1 tUSDC × 4 remaining matches = 2 tUSDC
    assert_eq!(c.advance_cap(tid(SEAT_A)).0, 2 * ONE);
    e.call(ALICE, 1);
    c.borrow(tid(SEAT_A), U128(2 * ONE)).detach();
    list(&mut c, &e, 200 * ONE);
    let nonce = c.membership(tid(SEAT_A)).unwrap().nonce.0;
    pay(&mut c, &e, BOB, 200 * ONE, &buy_msg(nonce));
    assert_eq!(c.member(&tid(SEAT_A)).debt, 0);
    assert_eq!(c.advance_fund, 100 * ONE);
}

#[test]
#[should_panic(expected = "repay the advance before transferring")]
fn plain_transfer_blocked_with_open_advance() {
    let (mut c, e) = setup();
    mint(&mut c, &e, SEAT_A, ALICE);
    fund_advances(&mut c, &e);
    e.call(ALICE, 1);
    c.borrow(tid(SEAT_A), U128(ONE)).detach();
    c.nft_transfer(a(BOB), tid(SEAT_A), None, None);
}

#[test]
fn settlement_repays_advance_first() {
    let (mut c, e) = setup();
    mint(&mut c, &e, SEAT_A, ALICE);
    fund_advances(&mut c, &e);
    e.call(ALICE, 1);
    c.borrow(tid(SEAT_A), U128(2 * ONE)).detach();
    pay(&mut c, &e, CLUB, 5 * ONE, r#"{"action":"top_up_pool"}"#);
    e.call(CAROL, 0);
    c.settle(tid(SEAT_A)).unwrap().detach();
    assert_eq!(c.member(&tid(SEAT_A)).debt, 0);
    assert_eq!(c.advance_fund, 100 * ONE);
}

#[test]
#[should_panic(expected = "this membership already voted in this poll")]
fn double_vote_blocked_after_sale() {
    let (mut c, mut e) = setup();
    mint(&mut c, &e, SEAT_A, ALICE);
    let m = new_match(&mut c, &e);
    e.call(GATE, 0);
    c.check_in(tid(SEAT_A), m, a(ALICE));
    e.now += 1;
    e.call(CLUB, 0);
    let poll = c.create_poll("New kit colour?".into(), vec!["Lime".into(), "Black".into()], 24);
    e.call(ALICE, 1);
    c.vote(tid(SEAT_A), poll, 0);
    e.call(ALICE, 1);
    c.nft_transfer(a(BOB), tid(SEAT_A), None, None);
    e.call(BOB, 1);
    c.vote(tid(SEAT_A), poll, 1);
}

#[test]
fn vote_weight_is_snapshotted_at_poll_start() {
    let (mut c, mut e) = setup();
    mint(&mut c, &e, SEAT_A, ALICE);
    e.call(CLUB, 0);
    let poll = c.create_poll("Q?".into(), vec!["Y".into(), "N".into()], 24);
    e.now += 1;
    let m = new_match(&mut c, &e);
    e.call(GATE, 0);
    c.check_in(tid(SEAT_A), m, a(ALICE));
    assert_eq!(c.vote_weight(tid(SEAT_A), poll), 0, "attendance after the poll opened doesn't count");
}

#[test]
#[should_panic(expected = "no auto-lend rule for this match")]
fn autolend_rule_cleared_on_transfer() {
    let (mut c, e) = setup();
    mint(&mut c, &e, SEAT_A, ALICE);
    let m = new_match(&mut c, &e);
    e.call(ALICE, 1);
    c.set_autolend(tid(SEAT_A), m, 2, U128(20 * ONE));
    c.nft_transfer(a(BOB), tid(SEAT_A), None, None);
    e.call(CAROL, 0);
    c.execute_autolend(tid(SEAT_A), m);
}

#[test]
#[should_panic(expected = "you already checked in for this match")]
fn autolend_rechecks_conditions() {
    let (mut c, e) = setup();
    mint(&mut c, &e, SEAT_A, ALICE);
    let m = new_match(&mut c, &e);
    e.call(ALICE, 1);
    c.set_autolend(tid(SEAT_A), m, 2, U128(20 * ONE));
    e.call(GATE, 0);
    c.check_in(tid(SEAT_A), m, a(ALICE));
    e.call(CAROL, 0); // the keeper
    c.execute_autolend(tid(SEAT_A), m);
}

#[test]
fn feed_keeps_recent_events_in_order() {
    let (mut c, e) = setup();
    mint(&mut c, &e, SEAT_A, ALICE);
    for _ in 0..70 {
        new_match(&mut c, &e);
    }
    let feed = c.get_feed(None);
    assert_eq!(feed.len() as u64, events::FEED_SIZE);
    assert!(feed.windows(2).all(|w| w[0].seq.0 < w[1].seq.0));
    assert_eq!(c.get_feed(Some(U64(c.feed_seq - 2))).len(), 2);
}

// ---------- buying a new membership from the club ----------

fn buy_new_msg(seat: &str) -> String {
    format!(r#"{{"action":"buy_new_membership","seat":"{seat}"}}"#)
}

#[test]
fn buy_new_membership_mints_to_buyer_and_pays_club() {
    let (mut c, e) = setup();
    pay(&mut c, &e, BOB, 200 * ONE, &buy_new_msg("b3-7"));
    e.callback(true);
    assert_eq!(c.on_vault_bought("b3-7".into(), a(BOB), U128(200 * ONE)).0, 0, "nothing refunded");
    let m = c.membership(tid("b3-7")).unwrap();
    assert_eq!(m.owner_id.as_str(), BOB);
    assert_eq!(m.vault.as_str(), "seat-b3-7.nearseat.testnet");
    assert_eq!(c.club_balance, 200 * ONE);
}

#[test]
fn failed_vault_on_purchase_refunds_buyer() {
    let (mut c, e) = setup();
    pay(&mut c, &e, BOB, 200 * ONE, &buy_new_msg("b3-7"));
    e.callback(false);
    // Returning the full amount makes the stablecoin refund Bob (NEP-141 resolve).
    assert_eq!(c.on_vault_bought("b3-7".into(), a(BOB), U128(200 * ONE)).0, 200 * ONE);
    assert!(c.membership(tid("b3-7")).is_none());
    assert_eq!(c.club_balance, 0);
    // The seat is free again.
    pay(&mut c, &e, CAROL, 200 * ONE, &buy_new_msg("b3-7"));
}

#[test]
#[should_panic(expected = "send exactly the season price")]
fn buy_new_membership_wrong_price_rejected() {
    let (mut c, e) = setup();
    pay(&mut c, &e, BOB, 100 * ONE, &buy_new_msg("b3-7"));
}

#[test]
#[should_panic(expected = "seat already has a membership")]
fn cannot_buy_existing_member_seat() {
    let (mut c, e) = setup();
    mint(&mut c, &e, SEAT_A, ALICE);
    pay(&mut c, &e, BOB, 200 * ONE, &buy_new_msg(SEAT_A));
}

#[test]
#[should_panic(expected = "a purchase for this seat is in progress")]
fn concurrent_purchase_of_same_seat_rejected() {
    let (mut c, e) = setup();
    pay(&mut c, &e, BOB, 200 * ONE, &buy_new_msg("b3-7"));
    pay(&mut c, &e, CAROL, 200 * ONE, &buy_new_msg("b3-7"));
}

#[test]
#[should_panic(expected = "seat is sold as a single-match ticket for an upcoming match")]
fn cannot_buy_membership_for_seat_sold_as_ticket() {
    let (mut c, e) = setup();
    let m = new_match(&mut c, &e);
    pay(&mut c, &e, CAROL, 15 * ONE, &format!(r#"{{"action":"buy_seat","match_id":{m},"seat":"b3-7"}}"#));
    pay(&mut c, &e, BOB, 200 * ONE, &buy_new_msg("b3-7"));
}

// ---------- seat categories ----------

#[test]
fn category_follows_the_seat_location() {
    for (seat, cat, weight) in [
        ("a1-1", Category::Vip, 10),
        ("a2-15", Category::Vip, 10),
        ("a3-1", Category::Standard, 4),
        ("b1-4", Category::Pitchside, 6),
        ("c2-9", Category::Pitchside, 6),
        ("c5-12", Category::Standard, 4),
        ("b6-15", Category::Standard, 4),
        ("d1-1", Category::FansEnd, 3),
        ("d6-15", Category::FansEnd, 3),
    ] {
        assert_eq!(Category::of_seat(seat), cat, "{seat}");
        assert_eq!(cat.weight(), weight, "{seat}");
    }
    let (c, _) = setup();
    assert_eq!(c.season_price_for("a1-1".into()).0, 500 * ONE);
    assert_eq!(c.season_price_for("b1-1".into()).0, 300 * ONE);
    assert_eq!(c.season_price_for("c5-12".into()).0, 200 * ONE);
    assert_eq!(c.season_price_for("d3-3".into()).0, 150 * ONE);
    assert_eq!(c.season().categories.len(), 4);
}

#[test]
fn membership_price_depends_on_category() {
    let (mut c, e) = setup();
    pay(&mut c, &e, BOB, 500 * ONE, &buy_new_msg("a1-1"));
    e.callback(true);
    assert_eq!(c.on_vault_bought("a1-1".into(), a(BOB), U128(500 * ONE)).0, 0);
    let m = c.membership(tid("a1-1")).unwrap();
    assert_eq!(m.category, Category::Vip);
    assert_eq!(m.share_weight, 10);
    assert_eq!(m.season_price.0, 500 * ONE);
    assert_eq!(m.resale_cap.0, c.resale_cap().0 * 5 / 2);
    assert_eq!(c.total_weight, 10);
}

#[test]
#[should_panic(expected = "send exactly the season price for this seat's category")]
fn vip_seat_at_standard_price_rejected() {
    let (mut c, e) = setup();
    pay(&mut c, &e, BOB, 200 * ONE, &buy_new_msg("a1-1"));
}

#[test]
fn ticket_price_depends_on_category() {
    let (mut c, e) = setup();
    let m = new_match(&mut c, &e);
    assert_eq!(c.ticket_price_for(m, "a1-1".into()).0, 37_500_000);
    assert_eq!(c.ticket_price_for(m, "d1-1".into()).0, 11_250_000);
    pay(&mut c, &e, CAROL, 37_500_000, &format!(r#"{{"action":"buy_seat","match_id":{m},"seat":"a1-1"}}"#));
    pay(&mut c, &e, BOB, 11_250_000, &format!(r#"{{"action":"buy_seat","match_id":{m},"seat":"d1-1"}}"#));
    assert_eq!(c.get_match(m).unwrap().tickets_sold, 2);
}

#[test]
#[should_panic(expected = "send exactly the ticket price for this seat's category")]
fn vip_ticket_at_standard_price_rejected() {
    let (mut c, e) = setup();
    let m = new_match(&mut c, &e);
    pay(&mut c, &e, CAROL, 15 * ONE, &format!(r#"{{"action":"buy_seat","match_id":{m},"seat":"a1-1"}}"#));
}

#[test]
fn pool_is_split_by_category_weight() {
    let (mut c, e) = setup();
    for seat in ["a1-1", "b1-1", SEAT_A, "d1-1"] {
        mint(&mut c, &e, seat, ALICE);
    }
    assert_eq!(c.total_weight, 23);
    pay(&mut c, &e, CLUB, 23 * ONE, r#"{"action":"top_up_pool"}"#);
    let owed = |c: &NearSeat, s: &str| c.membership(tid(s)).unwrap().unsettled.0;
    assert_eq!(owed(&c, "a1-1"), 10 * ONE);
    assert_eq!(owed(&c, "b1-1"), 6 * ONE);
    assert_eq!(owed(&c, SEAT_A), 4 * ONE);
    assert_eq!(owed(&c, "d1-1"), 3 * ONE);
    // A seat minted later only shares in what arrives after it.
    mint(&mut c, &e, SEAT_B, BOB);
    assert_eq!(owed(&c, SEAT_B), 0);
    pay(&mut c, &e, CLUB, 27 * ONE, r#"{"action":"top_up_pool"}"#);
    assert_eq!(owed(&c, SEAT_B), 4 * ONE);
    assert_eq!(owed(&c, "a1-1"), 20 * ONE);
}

#[test]
fn weighted_pool_never_over_distributes() {
    let (mut c, e) = setup();
    let seats = ["a1-1", "a2-2", "b1-1", SEAT_A, SEAT_B, "d1-1", "d6-15"];
    for seat in seats {
        mint(&mut c, &e, seat, ALICE);
    }
    let mut paid = 0u128;
    for (i, amount) in [1u128, 7, 10, 333_333, 2, 1_000_001, 39, 86_500_000].into_iter().enumerate() {
        pay(&mut c, &e, CLUB, amount, r#"{"action":"top_up_pool"}"#);
        // Settle a different seat after every top-up, so snapshots advance unevenly.
        let id = tid(seats[i % seats.len()]);
        let before = c.membership(id.clone()).unwrap().unsettled.0;
        e.call(ALICE, 0);
        if let Some(p) = c.settle(id.clone()) {
            p.detach();
        }
        paid += before - c.membership(id).unwrap().unsettled.0;
    }
    let owed: u128 = seats.iter().map(|s| c.membership(tid(s)).unwrap().unsettled.0).sum();
    assert!(paid + owed <= c.pool_total_distributed, "{paid} + {owed}");
    assert!(c.pool_total_distributed - paid - owed < 100, "dust stays tiny");
}

#[test]
fn lend_and_resale_caps_follow_category() {
    let (mut c, e) = setup();
    mint(&mut c, &e, "a1-1", ALICE);
    mint(&mut c, &e, "d1-1", ALICE);
    let m = new_match(&mut c, &e);
    assert_eq!(c.lend_cap(m, None).0, 22_500_000);
    assert_eq!(c.lend_cap(m, Some(tid("a1-1"))).0, 56_250_000);
    assert_eq!(c.lend_cap(m, Some(tid("d1-1"))).0, 16_875_000);
    assert_eq!(c.resale_cap_of(tid("a1-1")).0, c.resale_cap().0 * 5 / 2);
    assert_eq!(c.resale_cap_of(tid("d1-1")).0, c.resale_cap().0 * 3 / 4);
    e.call(ALICE, 1);
    c.list(tid("a1-1"), U128(c.resale_cap().0 * 2));
}

#[test]
#[should_panic(expected = "resale cap")]
fn fans_end_seat_cannot_list_at_standard_cap() {
    let (mut c, e) = setup();
    mint(&mut c, &e, "d1-1", ALICE);
    e.call(ALICE, 1);
    c.list(tid("d1-1"), U128(c.resale_cap().0));
}

#[test]
fn migration_pays_out_old_equal_shares_then_switches_to_weights() {
    let (mut c, e) = setup();
    for seat in ["a1-1", SEAT_A, "d1-1"] {
        mint(&mut c, &e, seat, ALICE);
    }
    // Rebuild the pre-upgrade state: 30 tUSDC split equally (10 each), with the
    // fans' end seat having already collected 4 of its 10.
    c.member_mut(&tid("d1-1")).acc_snapshot = 4 * ONE * ACC_SCALE;
    let old = migrate::OldNearSeat {
        tokens: c.tokens,
        metadata: c.metadata,
        club: c.club,
        gate: c.gate,
        stablecoin: c.stablecoin,
        vault_code_hash: c.vault_code_hash,
        season_name: c.season_name,
        season_price: c.season_price,
        max_supply: c.max_supply,
        config: c.config,
        members: c.members,
        pending_seats: c.pending_seats,
        history: c.history,
        matches: c.matches,
        payments: c.payments,
        sold_seats: c.sold_seats,
        tickets_per_account: c.tickets_per_account,
        tickets: c.tickets,
        loans: c.loans,
        check_ins: c.check_ins,
        ticket_check_ins: c.ticket_check_ins,
        next_match_id: c.next_match_id,
        acc_per_share: 10 * ONE * ACC_SCALE,
        pool_total_distributed: 30 * ONE,
        club_balance: c.club_balance,
        advance_fund: c.advance_fund,
        claimable: c.claimable,
        payout_round: c.payout_round,
        round_settled: c.round_settled,
        feed: c.feed,
        feed_seq: c.feed_seq,
        polls: c.polls,
        votes: c.votes,
        next_poll_id: c.next_poll_id,
    };
    near_sdk::env::state_write(&old);
    drop(old);

    e.call(CONTRACT, 0);
    let mut c = NearSeat::migrate_categories();
    assert_eq!(c.total_weight, 17);
    assert_eq!(c.acc_per_share, 0);
    let owed = |c: &NearSeat, s: &str| c.membership(tid(s)).unwrap().unsettled.0;
    assert_eq!(owed(&c, "a1-1"), 10 * ONE);
    assert_eq!(owed(&c, SEAT_A), 10 * ONE);
    assert_eq!(owed(&c, "d1-1"), 6 * ONE);
    assert_eq!(c.pool_total_distributed, 30 * ONE);

    // From here on the split follows the weights.
    pay(&mut c, &e, CLUB, 17 * ONE, r#"{"action":"top_up_pool"}"#);
    assert_eq!(owed(&c, "a1-1"), 20 * ONE);
    assert_eq!(owed(&c, SEAT_A), 14 * ONE);
    assert_eq!(owed(&c, "d1-1"), 9 * ONE);
}

// ---------- kiosk payments and renewal saving ----------

const KIOSK: &str = "kiosk.testnet";

fn approve_kiosk(c: &mut NearSeat, e: &Env) {
    club(e);
    c.set_vendor(a(KIOSK), Some("Mama Tee's Kitchen".into()));
}

#[test]
fn club_approves_and_removes_vendors() {
    let (mut c, e) = setup();
    approve_kiosk(&mut c, &e);
    assert_eq!(c.vendors().len(), 1);
    assert_eq!(c.vendors()[0].name, "Mama Tee's Kitchen");
    club(&e);
    c.set_vendor(a(KIOSK), None);
    assert!(c.vendors().is_empty());
}

#[test]
#[should_panic(expected = "only the club can do this")]
fn outsider_cannot_approve_vendor() {
    let (mut c, e) = setup();
    e.call(BOB, 0);
    c.set_vendor(a(BOB), Some("Bob".into()));
}

#[test]
fn holder_pays_vendor_from_the_seat() {
    let (mut c, e) = setup();
    mint(&mut c, &e, SEAT_A, ALICE);
    fund_vault(&mut c, &e, 10 * ONE);
    approve_kiosk(&mut c, &e);
    e.call(ALICE, 1);
    let nonce = c.member(&tid(SEAT_A)).nonce;
    c.pay_vendor(tid(SEAT_A), a(KIOSK), U128(3 * ONE), Some("Jollof rice".into())).detach();
    let m = c.member(&tid(SEAT_A));
    assert_eq!((m.vault_balance, m.outflows_in_flight, m.nonce), (7 * ONE, 1, nonce + 1));
    e.callback(true);
    assert!(c.on_vendor_paid(tid(SEAT_A), U128(3 * ONE), a(KIOSK)));
    let v = c.membership(tid(SEAT_A)).unwrap();
    assert_eq!((v.vault_balance.0, v.vendor_spent.0, v.outflows_in_flight), (7 * ONE, 3 * ONE, 0));
}

#[test]
fn failed_vendor_payment_restores_balance() {
    let (mut c, e) = setup();
    mint(&mut c, &e, SEAT_A, ALICE);
    fund_vault(&mut c, &e, 10 * ONE);
    approve_kiosk(&mut c, &e);
    e.call(ALICE, 1);
    c.pay_vendor(tid(SEAT_A), a(KIOSK), U128(3 * ONE), None).detach();
    e.callback(false);
    assert!(!c.on_vendor_paid(tid(SEAT_A), U128(3 * ONE), a(KIOSK)));
    let v = c.membership(tid(SEAT_A)).unwrap();
    assert_eq!((v.vault_balance.0, v.vendor_spent.0, v.outflows_in_flight), (10 * ONE, 0, 0));
}

#[test]
#[should_panic(expected = "not an approved vendor")]
fn unapproved_vendor_cannot_be_paid() {
    let (mut c, e) = setup();
    mint(&mut c, &e, SEAT_A, ALICE);
    fund_vault(&mut c, &e, 10 * ONE);
    e.call(ALICE, 1);
    c.pay_vendor(tid(SEAT_A), a(BOB), U128(ONE), None).detach();
}

#[test]
#[should_panic(expected = "only the current holder can do this")]
fn only_the_holder_can_spend_from_the_seat() {
    let (mut c, e) = setup();
    mint(&mut c, &e, SEAT_A, ALICE);
    fund_vault(&mut c, &e, 10 * ONE);
    approve_kiosk(&mut c, &e);
    e.call(KIOSK, 1);
    c.pay_vendor(tid(SEAT_A), a(KIOSK), U128(ONE), None).detach();
}

#[test]
#[should_panic(expected = "vault is frozen while listed")]
fn vendor_payment_blocked_while_listed() {
    let (mut c, e) = setup();
    mint(&mut c, &e, SEAT_A, ALICE);
    fund_vault(&mut c, &e, 10 * ONE);
    approve_kiosk(&mut c, &e);
    list(&mut c, &e, 100 * ONE);
    e.call(ALICE, 1);
    c.pay_vendor(tid(SEAT_A), a(KIOSK), U128(ONE), None).detach();
}

fn save_half(c: &mut NearSeat, e: &Env) {
    e.call(ALICE, 1);
    c.set_renewal_saving(tid(SEAT_A), 5_000);
}

#[test]
fn renewal_saving_sets_aside_a_share_of_each_payout() {
    let (mut c, e) = setup();
    mint(&mut c, &e, SEAT_A, ALICE);
    fund_vault(&mut c, &e, 4 * ONE); // before the rule: nothing set aside
    save_half(&mut c, &e);
    fund_vault(&mut c, &e, 10 * ONE);
    let v = c.membership(tid(SEAT_A)).unwrap();
    assert_eq!((v.vault_balance.0, v.renewal_saved.0, v.spendable.0, v.renewal_bps), (14 * ONE, 5 * ONE, 9 * ONE, 5_000));
}

#[test]
#[should_panic(expected = "part of this balance is set aside for renewal")]
fn set_aside_money_cannot_be_withdrawn() {
    let (mut c, e) = setup();
    mint(&mut c, &e, SEAT_A, ALICE);
    save_half(&mut c, &e);
    fund_vault(&mut c, &e, 10 * ONE);
    e.call(ALICE, 1);
    c.withdraw(tid(SEAT_A), U128(6 * ONE)).detach();
}

#[test]
#[should_panic(expected = "amount exceeds what this seat can spend")]
fn set_aside_money_cannot_be_spent_at_a_vendor() {
    let (mut c, e) = setup();
    mint(&mut c, &e, SEAT_A, ALICE);
    save_half(&mut c, &e);
    fund_vault(&mut c, &e, 10 * ONE);
    approve_kiosk(&mut c, &e);
    e.call(ALICE, 1);
    c.pay_vendor(tid(SEAT_A), a(KIOSK), U128(6 * ONE), None).detach();
}

#[test]
fn switching_saving_off_releases_everything() {
    let (mut c, e) = setup();
    mint(&mut c, &e, SEAT_A, ALICE);
    save_half(&mut c, &e);
    fund_vault(&mut c, &e, 10 * ONE);
    e.call(ALICE, 1);
    c.withdraw(tid(SEAT_A), U128(5 * ONE)).detach(); // the free half is fine
    e.callback(true);
    c.on_withdrawn(tid(SEAT_A), U128(5 * ONE), a(ALICE));
    e.call(ALICE, 1);
    c.set_renewal_saving(tid(SEAT_A), 0);
    let v = c.membership(tid(SEAT_A)).unwrap();
    assert_eq!((v.renewal_saved.0, v.spendable.0), (0, 5 * ONE));
}

#[test]
fn renewal_saving_stops_at_the_season_price() {
    let (mut c, e) = setup();
    mint(&mut c, &e, SEAT_A, ALICE);
    e.call(ALICE, 1);
    c.set_renewal_saving(tid(SEAT_A), 10_000);
    fund_vault(&mut c, &e, 150 * ONE);
    fund_vault(&mut c, &e, 150 * ONE);
    let v = c.membership(tid(SEAT_A)).unwrap();
    assert_eq!((v.renewal_saved.0, v.spendable.0), (200 * ONE, 100 * ONE));
}

#[test]
fn sale_clears_renewal_saving_for_the_buyer() {
    let (mut c, e) = setup();
    mint(&mut c, &e, SEAT_A, ALICE);
    save_half(&mut c, &e);
    fund_vault(&mut c, &e, 10 * ONE);
    list(&mut c, &e, 100 * ONE);
    let nonce = c.member(&tid(SEAT_A)).nonce;
    pay(&mut c, &e, BOB, 100 * ONE, &buy_msg(nonce));
    let v = c.membership(tid(SEAT_A)).unwrap();
    assert_eq!(v.owner_id, a(BOB));
    assert_eq!((v.renewal_bps, v.renewal_saved.0, v.spendable.0), (0, 0, 10 * ONE));
}

#[test]
#[should_panic(expected = "only the current holder can do this")]
fn only_the_holder_can_change_renewal_saving() {
    let (mut c, e) = setup();
    mint(&mut c, &e, SEAT_A, ALICE);
    e.call(BOB, 1);
    c.set_renewal_saving(tid(SEAT_A), 5_000);
}
