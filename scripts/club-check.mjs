#!/usr/bin/env node
// Runs every club action once on the live deployment and checks the result
// on-chain. Uses a NEW fixture, so existing fixtures and tickets are untouched.
//
//   node scripts/club-check.mjs
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

// 1. New fixture, kicking off in 30 minutes (gates open 4 h before).
const kickoffAt = BigInt(Date.now() + 30 * 60_000) * 1_000_000n;
const id = await step("create_match", () =>
  call(club, CONTRACT, "create_match", { opponent: "Ikoyi Wanderers", competition: "Club check", kickoff_at: String(kickoffAt), ticket_price: String(10n * ONE) }));
check(typeof id === "number", `create_match → fixture ${id} v Ikoyi Wanderers`);
if (typeof id !== "number") process.exit(1);

// 2. A fan buys a ticket, so the members' cut is non-zero.
const seat = `d1-${(id % 15) + 1}`;
await step("ticket sale", () =>
  call(account(fanId), TUSDC, "ft_transfer_call", { receiver_id: CONTRACT, amount: String(10n * ONE), msg: JSON.stringify({ action: "buy_seat", match_id: id, seat }) }, { deposit: ONE_YOCTO, gas: 100n * TGAS }));
check((await match(id)).tickets_sold === 1, `${fanId} bought seat ${seat.toUpperCase()} for 10 tUSDC`);

// 3. A member checks in at the gate.
const holder = await view(CONTRACT, "holder_for", { token_id: memberToken, match_id: id });
await step("check_in", () => call(gate, CONTRACT, "check_in", { token_id: memberToken, match_id: id, holder }));
check((await match(id)).members_checked_in === 1, `gate checked in ${holder} on ${memberToken}`);

// 4. A non-club account is refused.
const refused = await call(account(fanId), CONTRACT, "kickoff", { match_id: id }).then(() => false, (e) => /only the club/.test(String(e.message)));
check(refused, "non-club kickoff is refused by the contract");

// 5. Matchday.
await step("kickoff", () => call(club, CONTRACT, "kickoff", { match_id: id }));
check((await match(id)).status === "Live", "kickoff → Live");
await step("home goal", () => call(club, CONTRACT, "goal", { match_id: id, side: "Home", scorer: "Okafor" }));
await step("away goal", () => call(club, CONTRACT, "goal", { match_id: id, side: "Away", scorer: "Ikoyi Wanderers" }));
const live = await match(id);
check(live.home_goals === 1 && live.away_goals === 1, `goals recorded → ${live.home_goals}–${live.away_goals}`);
const stamps = (await view(CONTRACT, "membership", { token_id: memberToken })).goal_stamps.filter((g) => g.match_id === id);
check(stamps.length === 1, `checked-in member got exactly 1 goal stamp (home goals only)`);

const roundBefore = (await view(CONTRACT, "season")).payout_round;
await step("full_time", () => call(club, CONTRACT, "full_time", { match_id: id }));
const done = await match(id);
check(done.status === "Finished" && done.members_cut === String(500_000n), `full time → Finished, members' cut ${Number(done.members_cut) / 1e6} tUSDC`);

// 6. Payout round settles every membership.
for (let i = 0; i < 4; i++) {
  const s = await view(CONTRACT, "season");
  if (s.round_settled >= s.memberships) break;
  await step("settle_batch", () => call(club, CONTRACT, "settle_batch", { limit: 8 }, { gas: 300n * TGAS }));
}
const season = await view(CONTRACT, "season");
check(season.payout_round === roundBefore + 1 && season.round_settled === season.memberships, `payout round ${season.payout_round}: ${season.round_settled}/${season.memberships} seat accounts settled`);

// 7. Treasury: top up the pool, open a poll, withdraw club revenue.
const poolBefore = BigInt(season.pool_total_distributed);
await step("faucet", () => call(club, TUSDC, "faucet", { amount: String(20n * ONE) }));
await step("top_up_pool", () =>
  call(club, TUSDC, "ft_transfer_call", { receiver_id: CONTRACT, amount: String(10n * ONE), msg: JSON.stringify({ action: "top_up_pool" }) }, { deposit: ONE_YOCTO, gas: 100n * TGAS }));
check(BigInt((await view(CONTRACT, "season")).pool_total_distributed) === poolBefore + 10n * ONE, "top_up_pool → +10 tUSDC to the members' pool");

const pollsBefore = (await view(CONTRACT, "get_polls")).length;
await step("create_poll", () => call(club, CONTRACT, "create_poll", { question: "Man of the match v Ikoyi?", options: ["Okafor", "Adewale"], duration_hours: 48 }));
check((await view(CONTRACT, "get_polls")).length === pollsBefore + 1, "create_poll → new poll open");

const clubBal = BigInt((await view(CONTRACT, "season")).club_balance);
const walletBefore = BigInt(await view(TUSDC, "ft_balance_of", { account_id: club.accountId }));
await step("club_withdraw", () => call(club, CONTRACT, "club_withdraw", { amount: String(ONE) }, { deposit: ONE_YOCTO }));
const walletAfter = BigInt(await view(TUSDC, "ft_balance_of", { account_id: club.accountId }));
check(clubBal >= ONE && walletAfter - walletBefore === ONE, "club_withdraw → 1 tUSDC from club revenue to the club wallet");

console.log(failures ? `\n${failures} club action(s) failed` : "\nAll club actions valid ✔");
process.exit(failures ? 1 : 0);
