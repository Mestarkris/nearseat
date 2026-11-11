#!/usr/bin/env node
// Checks the season auto-lend rule on the live deployment.
//
//   node scripts/season-rule.mjs
//
// seat-c5-12's holder sets the rule once ("lend every match I haven't checked
// in for, 72 hours before kickoff, at the ticket price"). The club then
// announces a NEW fixture; any account (the keeper) can fire the rule for it.
// Also checked: a non-holder can't set a rule, the rule can't fire twice,
// taking the seat back stops it for that match, and the holder can hand the
// match back to the rule. The check fixture is postponed at the end, and the
// rule is left switched on for the remaining fixtures.
import { account, call, env, loadEnv, view, TGAS, ONE_YOCTO } from "@nearseat/shared/node";

loadEnv();
const CONTRACT = env("CONTRACT_ID");
const MASTER = env("MASTER_ACCOUNT");
const club = account(env("CLUB_ID"));
const TOKEN = "seat-c5-12";
const stranger = account(`fan07.${MASTER}`); // stands in for the keeper: any account may fire a rule

let failures = 0;
const check = (ok, msg) => { if (!ok) failures++; console.log(`${ok ? "✅" : "❌"} ${msg}`); };
const settle = async (read, ok, tries = 12) => {
  let v;
  for (let i = 0; i < tries; i++) { v = await read(); if (ok(v)) return v; await new Promise((r) => setTimeout(r, 1500)); }
  return v;
};
const refusal = (p, pattern) => p.then(() => false, (e) => pattern.test(String(e.message ?? e)));
const membership = () => view(CONTRACT, "membership", { token_id: TOKEN });
const due = () => view(CONTRACT, "season_autolend_due", { limit: 100 });
const isDue = (list, id) => list.some((d) => d.token_id === TOKEN && d.match_id === id);
const fire = (who, id) => call(who, CONTRACT, "execute_season_autolend", { token_id: TOKEN, match_id: id }, { gas: 50n * TGAS });

const holder = account((await membership()).owner_id);

// 1. Only the holder can set the rule.
check(await refusal(call(stranger, CONTRACT, "set_season_autolend", { token_id: TOKEN, hours_before: 72, price_bps: 10_000 }, { deposit: ONE_YOCTO }), /only the current holder/),
  "a non-holder is refused when setting a season rule");
await call(holder, CONTRACT, "set_season_autolend", { token_id: TOKEN, hours_before: 72, price_bps: 10_000 }, { deposit: ONE_YOCTO });
const rule = (await settle(membership, (m) => m.season_autolend)).season_autolend;
check(rule?.hours_before === 72 && rule?.price_bps === 10_000, `${holder.accountId} set the season rule: 72 hours before kickoff, at the ticket price`);

// 2. A fixture announced AFTER the rule was set is covered by it.
const kickoffAt = BigInt(Date.now() + 6 * 3_600_000) * 1_000_000n;
const id = await call(club, CONTRACT, "create_match", { opponent: "Surulere Town", competition: "Season rule check", kickoff_at: String(kickoffAt), ticket_price: String(10_000_000n) });
check(isDue(await settle(due, (d) => isDue(d, id)), id), `new fixture ${id} v Surulere Town is due for auto-lend, though the rule was set first`);

// 3. Anyone can fire it; the seat goes on offer at the ticket price for its category.
await fire(stranger, id);
const face = await view(CONTRACT, "ticket_price_for", { match_id: id, seat: "c5-12" });
const loan = await settle(() => view(CONTRACT, "loan_of", { token_id: TOKEN, match_id: id }), (l) => l);
check(loan?.Offered?.price === face, `a stranger fired the rule: seat on offer at ${Number(face) / 1e6} tUSDC`);
check(await refusal(fire(stranger, id), /already lent/), "the rule can't fire twice for the same match");

// 4. Taking the seat back means "I'm coming": the rule leaves that match alone.
await call(holder, CONTRACT, "cancel_lend", { token_id: TOKEN, match_id: id }, { deposit: ONE_YOCTO });
await settle(() => view(CONTRACT, "loan_of", { token_id: TOKEN, match_id: id }), (l) => !l);
check(await refusal(fire(stranger, id), /keeping the seat/), "after the holder takes the seat back, the rule is refused for that match");
check(!isDue(await due(), id), "and the match is no longer listed as due");

// 5. The holder can hand the match back to the rule.
await call(holder, CONTRACT, "skip_autolend", { token_id: TOKEN, match_id: id, skip: false }, { deposit: ONE_YOCTO });
check(isDue(await settle(due, (d) => isDue(d, id)), id), "the holder released the match and it is due again");

// 6. Tidy up: postpone the check fixture. The rule stays on for the real fixtures.
await call(club, CONTRACT, "postpone", { match_id: id });
check(!isDue(await settle(due, (d) => !isDue(d, id)), id), `check fixture ${id} postponed; nothing is due for it`);

console.log(failures ? `\n${failures} check(s) failed` : "\nSeason auto-lend rule valid ✔");
process.exit(failures ? 1 : 0);
