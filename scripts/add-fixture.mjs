#!/usr/bin/env node
// Adds one fixture from the club account, so the ticket page always has a
// match that has not kicked off yet. Skips a fixture that already exists.
//
//   node scripts/add-fixture.mjs "Makoko Mariners" 2026-11-19T19:00:00Z [price in tUSDC, default 10]
import { account, call, env, loadEnv, view } from "@nearseat/shared/node";

loadEnv();
const [opponent, when, price = "10"] = process.argv.slice(2);
const at = Date.parse(when ?? "");
if (!opponent || Number.isNaN(at) || at < Date.now()) {
  console.error('usage: node scripts/add-fixture.mjs "<opponent>" <kickoff, ISO time in the future> [price]');
  process.exit(1);
}
const CONTRACT = env("CONTRACT_ID");
const existing = await view(CONTRACT, "get_matches");
if (existing.some((m) => m.opponent === opponent && m.status === "Scheduled")) {
  console.log(`v ${opponent} is already scheduled`);
  process.exit(0);
}
const id = await call(account(env("CLUB_ID")), CONTRACT, "create_match", {
  opponent, competition: "Lagos Premier League",
  kickoff_at: String(BigInt(at) * 1_000_000n),
  ticket_price: String(BigInt(Math.round(Number(price) * 1e6))),
});
console.log(`fixture ${id} added: v ${opponent}, kickoff ${new Date(at).toISOString()}, ${price} tUSDC`);
