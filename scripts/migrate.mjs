#!/usr/bin/env node
// Seat-categories upgrade: deploys the new contract code onto CONTRACT_ID and
// runs `migrate_categories` in the SAME transaction, so a failed migration
// rolls the deploy back. Only possible before `scripts/lock.mjs`.
//
// Checks afterwards that no membership lost anything it had already earned.
//
//   npm run build:contracts && node scripts/migrate.mjs --yes
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { actions } from "near-api-js";
import { base58Encode } from "@nearseat/shared";
import { account, env, loadEnv, rawQuery, repoRoot, view, TGAS } from "@nearseat/shared/node";

loadEnv();
const CONTRACT = env("CONTRACT_ID");
if (!process.argv.includes("--yes")) {
  console.error(`Deploys new code onto ${CONTRACT} and migrates its state. Re-run with --yes.`);
  process.exit(1);
}
const code = readFileSync(join(repoRoot, "target", "near", "nearseat", "nearseat.wasm"));
const hash = base58Encode(createHash("sha256").update(code).digest());
const codeHash = async () => (await rawQuery({ request_type: "view_account", account_id: CONTRACT })).code_hash;

let failures = 0;
const check = (ok, msg) => {
  if (!ok) failures++;
  console.log(`${ok ? "✅" : "❌"} ${msg}`);
};

const before = await view(CONTRACT, "season");
const membersBefore = await view(CONTRACT, "memberships", { limit: 100 });
console.log(`current code ${await codeHash()}`);
console.log(`deploying    ${hash}`);
if (before.total_weight !== undefined) {
  console.error("This contract already has seat categories. Nothing to do.");
  process.exit(1);
}

await account(CONTRACT).signAndSendTransaction({
  receiverId: CONTRACT,
  actions: [actions.deployContract(code), actions.functionCall("migrate_categories", {}, 200n * TGAS, 0n)],
});

// RPC nodes can lag a block behind: wait until the new code answers.
let after;
for (let i = 0; i < 15; i++) {
  after = await view(CONTRACT, "season");
  if (after.total_weight !== undefined) break;
  await new Promise((r) => setTimeout(r, 1500));
}
const membersAfter = await view(CONTRACT, "memberships", { limit: 100 });

check((await codeHash()) === hash, `live code is ${hash}`);
check(after.memberships === before.memberships && membersAfter.length === membersBefore.length, `${after.memberships} memberships kept`);
check(after.pool_total_distributed === before.pool_total_distributed, `pool total kept: ${Number(after.pool_total_distributed) / 1e6} tUSDC`);
check(after.club_balance === before.club_balance, `club balance kept: ${Number(after.club_balance) / 1e6} tUSDC`);
const weight = membersAfter.reduce((s, m) => s + m.share_weight, 0);
check(Number(after.total_weight) === weight, `total weight ${after.total_weight} = sum of the seats' weights`);
for (const old of membersBefore) {
  const now = membersAfter.find((m) => m.token_id === old.token_id);
  check(now && now.unsettled === old.unsettled && now.owner_id === old.owner_id && now.vault_balance === old.vault_balance,
    `${old.token_id}  ${now?.category_label} (weight ${now?.share_weight})  owed ${Number(old.unsettled) / 1e6} → ${Number(now?.unsettled) / 1e6} tUSDC`);
}
console.log(failures ? `\n${failures} check(s) failed` : "\nMigration complete, nothing lost");
process.exit(failures ? 1 : 0);
