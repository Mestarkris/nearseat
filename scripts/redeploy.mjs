#!/usr/bin/env node
// Redeploys the NearSeat contract code onto CONTRACT_ID, keeping its state.
// Only possible before `scripts/lock.mjs` removes the keys. Only safe when the
// stored (borsh) state layout is unchanged; this script checks that the
// existing state still reads correctly after the deploy.
//
//   npm run build:contracts && node scripts/redeploy.mjs --yes
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { base58Encode } from "@nearseat/shared";
import { account, env, loadEnv, rawQuery, repoRoot, view } from "@nearseat/shared/node";

loadEnv();
const CONTRACT = env("CONTRACT_ID");
if (!process.argv.includes("--yes")) {
  console.error(`Redeploys new code onto ${CONTRACT}. Re-run with --yes.`);
  process.exit(1);
}
const code = readFileSync(join(repoRoot, "target", "near", "nearseat", "nearseat.wasm"));
const hash = base58Encode(createHash("sha256").update(code).digest());
const before = await view(CONTRACT, "season");
console.log(`current code ${(await rawQuery({ request_type: "view_account", account_id: CONTRACT })).code_hash}`);
console.log(`deploying    ${hash}`);

await account(CONTRACT).deployContract(code);

const after = await view(CONTRACT, "season");
const sameState = after.memberships === before.memberships && after.pool_total_distributed === before.pool_total_distributed;
console.log(`live code    ${(await rawQuery({ request_type: "view_account", account_id: CONTRACT, finality: "optimistic" })).code_hash}`);
console.log(sameState ? `✅ state intact: ${after.memberships} memberships, pool ${after.pool_total_distributed}` : "❌ state changed or unreadable!");
process.exit(sameState ? 0 : 1);
