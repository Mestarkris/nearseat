#!/usr/bin/env node
// Runs every club action once on the live deployment and checks the result
// on-chain. Uses a NEW fixture, so existing fixtures and tickets are untouched.
//
//   node scripts/club-check.mjs [fixture id from an interrupted run]
//
// Covered: create_match, a fan ticket sale, gate check_in, kickoff, home goal
// (named scorer), away goal, full_time, settle_batch (payout round), top-up of
// the members' pool, create_poll, club_withdraw, and that a non-club account is
// refused. Postpone + refunds are covered by sandbox tests instead (no real refunds here).
import { account, call, env, loadEnv, view, TGAS, ONE_YOCTO } from "@nearseat/shared/node";

loadEnv();
const CONTRACT = env("CONTRACT_ID");
const TUSDC = env("TUSDC_ID");
const MASTER = env("MASTER_ACCOUNT");
const club = account(env("CLUB_ID"));
const gate = account(env("GATE_ID"));
const fanId = `fan07.${MASTER}`;
const memberToken = "seat-c5-12";
const ONE = 1_000_000n;

let failures = 0;
const check = (ok, msg) => {
  if (!ok) failures++;
  console.log(`${ok ? "✅" : "❌"} ${msg}`);
};
const step = async (label, fn) => {
  try {
    const r = await fn();
    return r;
  } catch (e) {
    check(false, `${label}: ${String(e.message ?? e).slice(0, 200)}`);
    return undefined;
  }
};
const match = (id) => view(CONTRACT, "get_match", { match_id: id });
/** RPC nodes can lag a block behind the transaction that just finished: retry a read until it shows the expected state. */
async function settle(read, ok, tries = 10) {
  let v;
  for (let i = 0; i < tries; i++) {
    v = await read();
    if (ok(v)) return v;
    await new Promise((r) => setTimeout(r, 1500));
  }
  return v;
}

// 1. New fixture, kicking off in 30 minutes (gates open 4 h before).
const kickoffAt = BigInt(Date.now() + 30 * 60_000) * 1_000_000n;
// Pass a fixture id to carry on with one an earlier, interrupted run created.
const resume = process.argv[2] ? Number(process.argv[2]) : undefined;
const id = resume ?? await step("create_match", () =>
  call(club, CONTRACT, "create_match", { opponent: "Haseeb Wanderers", competition: "Club check", kickoff_at: String(kickoffAt), ticket_price: String(10n * ONE) }));
check(typeof id === "number", `${resume ? "using" : "create_match →"} fixture ${id} v Haseeb Wanderers`);
if (typeof id !== "number") process.exit(1);
await settle(() => match(id).catch(() => undefined), (x) => x !== undefined);

// 2. A fan buys a ticket, so the members' cut is non-zero.
const seat = `d1-${(id % 15) + 1}`;
// A fans' end seat costs 0.75x the base price: 7.50 tUSDC.
const seatPrice = BigInt(await view(CONTRACT, "ticket_price_for", { match_id: id, seat }));
check(seatPrice === 7_500_000n, `fans' end seat ${seat.toUpperCase()} is priced at ${Number(seatPrice) / 1e6} tUSDC (0.75x of 10)`);
const refusedPrice = await call(account(fanId), TUSDC, "ft_transfer_call", { receiver_id: CONTRACT, amount: String(10n * ONE), msg: JSON.stringify({ action: "buy_seat", match_id: id, seat }) }, { deposit: ONE_YOCTO, gas: 100n * TGAS }).then(() => true, () => true);
check(refusedPrice && (await match(id)).tickets_sold === 0, "paying the standard price for it is refused and refunded");
await step("ticket sale", () =>
  call(account(fanId), TUSDC, "ft_transfer_call", { receiver_id: CONTRACT, amount: String(seatPrice), msg: JSON.stringify({ action: "buy_seat", match_id: id, seat }) }, { deposit: ONE_YOCTO, gas: 100n * TGAS }));
check((await settle(() => match(id), (x) => x.tickets_sold === 1)).tickets_sold === 1, `${fanId} bought seat ${seat.toUpperCase()} for ${Number(seatPrice) / 1e6} tUSDC`);

// 3. A member checks in at the gate.
const holder = await view(CONTRACT, "holder_for", { token_id: memberToken, match_id: id });
await step("check_in", () => call(gate, CONTRACT, "check_in", { token_id: memberToken, match_id: id, holder }));
check((await settle(() => match(id), (x) => x.members_checked_in === 1)).members_checked_in === 1, `gate checked in ${holder} on ${memberToken}`);

// 4. A non-club account is refused.
const refused = await call(account(fanId), CONTRACT, "kickoff", { match_id: id }).then(() => false, (e) => /only the club/.test(String(e.message)));
check(refused, "non-club kickoff is refused by the contract");

// 5. Matchday.
await step("kickoff", () => call(club, CONTRACT, "kickoff", { match_id: id }));
check((await settle(() => match(id), (x) => x.status === "Live")).status === "Live", "kickoff → Live");
await step("home goal", () => call(club, CONTRACT, "goal", { match_id: id, side: "Home", scorer: "Okafor" }));
await step("away goal", () => call(club, CONTRACT, "goal", { match_id: id, side: "Away", scorer: "Haseeb Wanderers" }));
const live = await settle(() => match(id), (x) => x.home_goals === 1 && x.away_goals === 1);
check(live.home_goals === 1 && live.away_goals === 1, `goals recorded → ${live.home_goals}–${live.away_goals}`);
const stamps = (await settle(() => view(CONTRACT, "membership", { token_id: memberToken }), (v) => v.goal_stamps.some((g) => g.match_id === id))).goal_stamps.filter((g) => g.match_id === id);
check(stamps.length === 1, `checked-in member got exactly 1 goal stamp (home goals only)`);

const roundBefore = (await view(CONTRACT, "season")).payout_round;
await step("full_time", () => call(club, CONTRACT, "full_time", { match_id: id }));
const done = await settle(() => match(id), (x) => x.status === "Finished");
check(done.status === "Finished" && done.members_cut === String(375_000n), `full time → Finished, members' cut ${Number(done.members_cut) / 1e6} tUSDC`);

// 6. The cut is split by category weight: seat-c5-12 (standard, 4 units) is owed 4/total of it.
const sv = await view(CONTRACT, "season");
const mine = await view(CONTRACT, "membership", { token_id: memberToken });
check(mine.category === "Standard" && mine.share_weight === 4, `${memberToken} is a Standard seat with 4 of ${sv.total_weight} pool units`);

// 6b. Payout round settles every membership.
for (let i = 0; i < 6; i++) {
  const s = await settle(() => view(CONTRACT, "season"), (x) => x.payout_round === roundBefore + 1);
  if (s.payout_round === roundBefore + 1 && s.round_settled >= s.memberships) break;
  await step("settle_batch", () => call(club, CONTRACT, "settle_batch", { limit: 8 }, { gas: 300n * TGAS }));
}
const season = await settle(() => view(CONTRACT, "season"), (x) => x.payout_round === roundBefore + 1 && x.round_settled >= x.memberships);
check(season.payout_round === roundBefore + 1 && season.round_settled === season.memberships, `payout round ${season.payout_round}: ${season.round_settled}/${season.memberships} seat accounts settled`);

// 7. Treasury: top up the pool, open a poll, withdraw club revenue.
const poolBefore = BigInt(season.pool_total_distributed);
// The faucet has a 10-minute cooldown, so only use it if the club is short.
if (BigInt(await view(TUSDC, "ft_balance_of", { account_id: club.accountId })) < 10n * ONE) {
  await step("faucet", () => call(club, TUSDC, "faucet", { amount: String(20n * ONE) }));
}
await step("top_up_pool", () =>
  call(club, TUSDC, "ft_transfer_call", { receiver_id: CONTRACT, amount: String(10n * ONE), msg: JSON.stringify({ action: "top_up_pool" }) }, { deposit: ONE_YOCTO, gas: 100n * TGAS }));
check(BigInt((await settle(() => view(CONTRACT, "season"), (x) => BigInt(x.pool_total_distributed) === poolBefore + 10n * ONE)).pool_total_distributed) === poolBefore + 10n * ONE, "top_up_pool → +10 tUSDC to the members' pool");

const pollsBefore = (await view(CONTRACT, "get_polls")).length;
await step("create_poll", () => call(club, CONTRACT, "create_poll", { question: "Man of the match v Haseeb?", options: ["Okafor", "Adewale"], duration_hours: 48 }));
check((await settle(() => view(CONTRACT, "get_polls"), (p) => p.length === pollsBefore + 1)).length === pollsBefore + 1, "create_poll → new poll open");

const clubBal = BigInt((await view(CONTRACT, "season")).club_balance);
const walletBefore = BigInt(await view(TUSDC, "ft_balance_of", { account_id: club.accountId }));
await step("club_withdraw", () => call(club, CONTRACT, "club_withdraw", { amount: String(ONE) }, { deposit: ONE_YOCTO }));
const walletAfter = BigInt(await settle(() => view(TUSDC, "ft_balance_of", { account_id: club.accountId }), (b) => BigInt(b) - walletBefore === ONE));
check(clubBal >= ONE && walletAfter - walletBefore === ONE, "club_withdraw → 1 tUSDC from club revenue to the club wallet");

console.log(failures ? `\n${failures} club action(s) failed` : "\nAll club actions valid ✔");
process.exit(failures ? 1 : 0);
