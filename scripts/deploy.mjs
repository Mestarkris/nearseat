#!/usr/bin/env node
// Deploys NearSeat to testnet from ONE account you created yourself.
//
//   MASTER_ACCOUNT=<you>.testnet   (key in ~/.near-credentials/testnet/, ~20 testnet NEAR)
//   npm run build:contracts && npm run deploy
//
// Creates sub-accounts tusdc/club/gate/relayer/fan01..fan10.<master> with fresh
// keys saved to ~/.near-credentials/testnet/ (never the repo), deploys the vault
// as a global contract BY HASH, deploys tUSDC, deploys NearSeat on <master>
// itself (so vaults are seat-*.<master>), and writes the account ids to .env.
// Safe to re-run: existing accounts and contracts are skipped.
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { join } from "node:path";
import { KeyPair } from "near-api-js";
import { base58Encode } from "@nearseat/shared";
import { account, call, env, loadEnv, network, provider, repoRoot, TGAS } from "@nearseat/shared/node";

loadEnv();
const MASTER = env("MASTER_ACCOUNT");
const master = account(MASTER);
const near = (n) => BigInt(Math.round(n * 1e6)) * 10n ** 18n;
const wasm = (name) => {
  const f = join(repoRoot, "target", "near", name, `${name}.wasm`);
  if (!existsSync(f)) throw new Error(`Missing ${f}. Run: npm run build:contracts`);
  return readFileSync(f);
};
const step = (s) => console.log(`\n▶ ${s}`);

async function exists(accountId) {
  try {
    return await provider().viewAccount({ accountId });
  } catch {
    return null;
  }
}

function saveKey(accountId, kp) {
  const dir = join(homedir(), ".near-credentials", network());
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${accountId}.json`);
  writeFileSync(file, JSON.stringify({ account_id: accountId, public_key: kp.getPublicKey().toString(), private_key: kp.toString() }));
  chmodSync(file, 0o600);
}

async function ensureSub(prefix, amountNear) {
  const id = `${prefix}.${MASTER}`;
  if (await exists(id)) {
    console.log(`  ${id} exists`);
    return id;
  }
  const kp = KeyPair.fromRandom("ed25519");
  saveKey(id, kp);
  await master.createSubAccount({ accountOrPrefix: prefix, publicKey: kp.getPublicKey(), nearToTransfer: near(amountNear) });
  console.log(`  created ${id} (${amountNear} NEAR), key saved to ~/.near-credentials/${network()}/`);
  return id;
}

step(`Master account ${MASTER}`);
const state = await exists(MASTER);
if (!state) throw new Error(`${MASTER} not found on ${network()}`);
console.log(`  balance ${(Number(BigInt(state.amount) / 10n ** 21n) / 1000).toFixed(2)} NEAR`);

step("Sub-accounts");
const ids = {
  TUSDC_ID: await ensureSub("tusdc", 2.5),
  CLUB_ID: await ensureSub("club", 2),
  GATE_ID: await ensureSub("gate", 0.5),
  RELAYER_ID: await ensureSub("relayer", 1),
};
for (let i = 1; i <= 10; i++) await ensureSub(`fan${String(i).padStart(2, "0")}`, 0.2);

step("Vault code → global contract, addressed by hash (immutable)");
const vault = wasm("nearseat_vault");
const hash = base58Encode(createHash("sha256").update(vault).digest());
try {
  await master.deployGlobalContract(vault, "codeHash");
  console.log(`  deployed global vault ${hash}`);
} catch (e) {
  if (!/already/i.test(String(e.message))) throw e;
  console.log(`  global vault ${hash} already deployed`);
}

step("tUSDC test token");
const tusdc = account(ids.TUSDC_ID);
if ((await exists(ids.TUSDC_ID)).code_hash === "11111111111111111111111111111111") {
  await tusdc.deployContract(wasm("tusdc"));
  await call(tusdc, ids.TUSDC_ID, "new", {});
  console.log("  deployed and initialised");
} else console.log("  already deployed");

step(`NearSeat contract on ${MASTER}`);
if (state.code_hash === "11111111111111111111111111111111") {
  await master.deployContract(wasm("nearseat"));
  await call(master, MASTER, "new", {
    club: ids.CLUB_ID,
    gate: ids.GATE_ID,
    stablecoin: ids.TUSDC_ID,
    vault_code_hash: hash,
    season_name: "2026/27",
    season_price: String(200_000_000n),
    max_supply: 50,
  }, { gas: 100n * TGAS });
  console.log("  deployed and initialised");
} else console.log("  already deployed");

step("Writing .env");
const envFile = join(repoRoot, ".env");
let text = existsSync(envFile) ? readFileSync(envFile, "utf8") : readFileSync(join(repoRoot, ".env.example"), "utf8");
const set = (k, v) => {
  text = new RegExp(`^${k}=.*$`, "m").test(text) ? text.replace(new RegExp(`^${k}=.*$`, "m"), `${k}=${v}`) : `${text}\n${k}=${v}`;
};
set("CONTRACT_ID", MASTER);
set("VITE_CONTRACT_ID", MASTER);
for (const [k, v] of Object.entries(ids)) set(k, v);
set("VITE_TUSDC_ID", ids.TUSDC_ID);
set("VITE_CLUB_ID", ids.CLUB_ID);
writeFileSync(envFile, text);
console.log(`  ${envFile} updated. Next: npm run seed`);
