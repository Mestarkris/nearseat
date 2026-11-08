#!/usr/bin/env node
// Verifies a live deployment against your local build, using only public RPC:
//   - each vault has ZERO access keys and runs the global vault code by hash
//   - the vault hash equals sha256 of target/near/nearseat_vault/nearseat_vault.wasm
//   - the main contract's code_hash equals the local nearseat.wasm
//   - lists the main contract's access keys (should be none after `lock`)
//
//   npm run verify                 # contract from .env
//   npm run verify -- seat-c5-12   # also check one vault in detail
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { base58Encode } from "@nearseat/shared";
import { env, loadEnv, rawQuery, repoRoot, view } from "@nearseat/shared/node";

loadEnv();
const CONTRACT = env("CONTRACT_ID");
const account = (id) => rawQuery({ request_type: "view_account", account_id: id });
const keysOf = async (id) => (await rawQuery({ request_type: "view_access_key_list", account_id: id })).keys;
const localHash = (name) => {
  const f = join(repoRoot, "target", "near", name, `${name}.wasm`);
  return existsSync(f) ? base58Encode(createHash("sha256").update(readFileSync(f)).digest()) : null;
};
const ok = (b) => (b ? "✅" : "❌");
let failures = 0;
const check = (cond, msg) => {
  if (!cond) failures++;
  console.log(`${ok(cond)} ${msg}`);
};

const season = await view(CONTRACT, "season");
const main = await account(CONTRACT);
const mainKeys = await keysOf(CONTRACT);
const localMain = localHash("nearseat");
const localVault = localHash("nearseat_vault");

console.log(`\nNearSeat contract ${CONTRACT}`);
console.log(`   code_hash ${main.code_hash}`);
check(!localMain || main.code_hash === localMain, `code hash matches local build (${localMain ?? "no local build"})`);
console.log(`${mainKeys.length === 0 ? "✅" : "⚠️ "} access keys on contract: ${mainKeys.length}${mainKeys.length ? " (run scripts/lock.mjs after the final deploy)" : ""}`);
check(!localVault || season.vault_code_hash === localVault, `contract's vault_code_hash ${season.vault_code_hash} matches local vault build`);

const tokens = process.argv[2] ? [process.argv[2]] : (await view(CONTRACT, "memberships", { limit: 100 })).map((m) => m.token_id);
console.log(`\nVaults (${tokens.length})`);
for (const tokenId of tokens) {
  const m = await view(CONTRACT, "membership", { token_id: tokenId });
  const acc = await account(m.vault);
  const keys = await keysOf(m.vault);
  const hash = acc.global_contract_hash ?? null;
  check(keys.length === 0 && hash === season.vault_code_hash, `${m.vault}  keys=${keys.length}  global_code=${hash}  owner=${m.owner_id}`);
}
console.log(failures ? `\n${failures} check(s) failed` : "\nAll checks passed");
process.exit(failures ? 1 : 0);
