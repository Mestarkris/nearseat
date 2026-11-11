#!/usr/bin/env node
// Renames the opponent on one or more fixtures from the club account.
// Money, seats and status are untouched; sold tickets get the new title.
//
//   node scripts/rename-fixture.mjs 2="Eddy Athletic" 9="Mert Mariners"
import { account, call, env, loadEnv, view, TGAS } from "@nearseat/shared/node";

loadEnv();
const CONTRACT = env("CONTRACT_ID");
const club = account(env("CLUB_ID"));
const pairs = process.argv.slice(2).map((a) => a.split("="));
if (!pairs.length || pairs.some(([id, name]) => !Number(id) || !name)) {
  console.error('usage: node scripts/rename-fixture.mjs <fixture id>="<new opponent>" ...');
  process.exit(1);
}
for (const [id, opponent] of pairs) {
  const m = await view(CONTRACT, "get_match", { match_id: Number(id) });
  if (!m) { console.log(`fixture ${id}: not found`); continue; }
  if (m.opponent === opponent) { console.log(`fixture ${id}: already v ${opponent}`); continue; }
  await call(club, CONTRACT, "rename_match", { match_id: Number(id), opponent }, { gas: 300n * TGAS });
  console.log(`fixture ${id}: v ${m.opponent} → v ${opponent}`);
}
