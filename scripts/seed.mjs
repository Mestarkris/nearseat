#!/usr/bin/env node
// Seeds the demo season: Illia Stars United, 10 memberships, 3 fixtures,
// funded fans, a members' pool and an advance fund. Safe to re-run.
//
//   MY_ACCOUNT=<your wallet>.testnet npm run seed   # optional: you get seat C5-12
//
// Mainnet (real USDC): NEAR_NETWORK=mainnet MY_ACCOUNT=<you>.near node scripts/seed.mjs
// mints two memberships and two fixtures at 0.05 USDC. It moves no USDC.
import { account, call, env, loadEnv, network, view, TGAS, ONE_YOCTO } from "@nearseat/shared/node";

loadEnv();
const CONTRACT = env("CONTRACT_ID");
const TUSDC = env("TUSDC_ID");
const MASTER = env("MASTER_ACCOUNT");
const club = account(env("CLUB_ID"));
const ONE = 1_000_000n;
const MAINNET = network() === "mainnet";
const fans = Array.from({ length: MAINNET ? 2 : 10 }, (_, i) => `fan${String(i + 1).padStart(2, "0")}.${MASTER}`);
const SEATS = MAINNET ? ["c5-12", "c5-13"] : ["c5-12", "c5-13", "c5-14", "c5-15", "c6-1", "c6-2", "c6-3", "c6-4", "c6-5", "c6-6"];
// Standard ticket price. Mainnet: 0.05 USDC.
const TICKET = MAINNET ? 50_000n : 10n * 1_000_000n;
const step = (s) => console.log(`\n▶ ${s}`);
const soft = (p, what) => p.then(() => console.log(`  ✓ ${what}`), (e) => console.log(`  · ${what}: ${String(e.message).slice(0, 120)}`));

async function register(payer, id) {
  const bal = await view(TUSDC, "storage_balance_of", { account_id: id });
  if (bal) return;
  await call(payer, TUSDC, "storage_deposit", { account_id: id, registration_only: true }, { deposit: 12_500_000_000_000_000_000_000n });
}

if (MAINNET) {
  step("Advance estimate scaled to the tiny prices");
  const cfg = (await view(CONTRACT, "season")).config;
  if (cfg.expected_share_per_match !== "2500") await soft(call(club, CONTRACT, "set_config", { config: { ...cfg, expected_share_per_match: "2500" } }), "expected share per match 0.0025 USDC");
} else {
  step("Register tUSDC storage");
  for (const id of [CONTRACT, club.accountId, ...fans]) await soft(register(club, id), id);

  step("Faucet tUSDC (test token, no value)");
  for (const id of [club.accountId, ...fans]) await soft(call(account(id), TUSDC, "faucet", { amount: String(1000n * ONE) }), id);
}

step("Fixtures");
const existing = await view(CONTRACT, "get_matches");
const now = BigInt(Date.now()) * 1_000_000n;
const DAY = 86_400_000_000_000n;
const fixtures = [
  { opponent: "Stepan City FC", kickoff_at: now + DAY / 24n, ticket_price: TICKET },
  { opponent: "Eddy Athletic", kickoff_at: now + 7n * DAY, ticket_price: TICKET },
  { opponent: "Avichal Rangers", kickoff_at: now + 14n * DAY, ticket_price: (TICKET * 12n) / 10n, big_match: true, priority_hours: 48 },
].slice(0, MAINNET ? 2 : 3);
for (const f of fixtures) {
  if (existing.some((m) => m.opponent === f.opponent)) {
    console.log(`  · v ${f.opponent} exists`);
    continue;
  }
  await soft(call(club, CONTRACT, "create_match", {
    opponent: f.opponent, competition: "Lagos Premier League", kickoff_at: String(f.kickoff_at),
    ticket_price: String(f.ticket_price), big_match: f.big_match ?? false, priority_hours: f.priority_hours,
  }), `v ${f.opponent}`);
}

step("Memberships (each creates a keyless vault sub-account)");
const mine = process.env.MY_ACCOUNT;
for (const [i, seat] of SEATS.entries()) {
  if (await view(CONTRACT, "membership", { token_id: `seat-${seat}` })) {
    console.log(`  · seat-${seat} exists`);
    continue;
  }
  // Mainnet: fan01 holds C5-12 (sold in the recorded cycle); C5-13 goes to your own wallet.
  if (MAINNET && i === 1 && !mine) {
    console.log("  · seat-c5-13 skipped: pass MY_ACCOUNT=<you>.near to hold it yourself");
    continue;
  }
  const owner = MAINNET ? (i === 0 ? fans[0] : mine) : i === 0 && mine ? mine : fans[i];
  await soft(call(club, CONTRACT, "mint_membership", { seat, owner_id: owner }, { deposit: 100_000_000_000_000_000_000_000n, gas: 150n * TGAS }), `seat-${seat} → ${owner}`);
}

if (MAINNET) {
  console.log("\nSeeded on mainnet. No USDC was moved. Next: NEAR_NETWORK=mainnet node scripts/mainnet-cycle.mjs");
  process.exit(0);
}
step("Club funds the members' pool and the advance fund");
const pay = (amount, msg) => call(club, TUSDC, "ft_transfer_call", { receiver_id: CONTRACT, amount: String(amount), msg: JSON.stringify(msg) }, { deposit: ONE_YOCTO, gas: 100n * TGAS });
await soft(pay(50n * ONE, { action: "top_up_pool" }), "50 tUSDC to the members' pool");
await soft(pay(200n * ONE, { action: "top_up_advance_fund" }), "200 tUSDC to the advance fund");
await soft(call(club, CONTRACT, "settle_batch", { limit: 8 }, { gas: 300n * TGAS }), "settle (1/2)");
await soft(call(club, CONTRACT, "settle_batch", { limit: 8 }, { gas: 300n * TGAS }), "settle (2/2)");

step("Poll");
if ((await view(CONTRACT, "get_polls")).length === 0) {
  await soft(call(club, CONTRACT, "create_poll", { question: "Which kit for the Avichal Rangers derby?", options: ["Lime home", "Black away", "Retro 1996"], duration_hours: 24 * 14 }), "kit poll");
}
console.log("\nSeeded. Start the app: npm run dev   ·   Run a live match: npm run demo");
