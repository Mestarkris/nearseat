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
import { account, call, env, envFile, loadEnv, MAINNET_USDC, network, provider, rawQuery, repoRoot, TGAS, view } from "@nearseat/shared/node";

// Mainnet (real money):
//   NEAR_NETWORK=mainnet MASTER_ACCOUNT=<you>.near node scripts/deploy.mjs          # prints the plan, sends nothing
//   NEAR_NETWORK=mainnet MASTER_ACCOUNT=<you>.near node scripts/deploy.mjs --yes    # deploys
// It uses Circle's USDC, creates only club/gate/fan01/fan02, and refuses a season
// price above 1 USDC. Settings go to .env.mainnet; the testnet .env is not touched.
loadEnv();
const MAINNET = network() === "mainnet";
const MASTER = env("MASTER_ACCOUNT");
if (MAINNET && !MASTER.endsWith(".near") && !/^[0-9a-f]{64}$/.test(MASTER)) throw new Error(`${MASTER} is not a mainnet account`);
// Season price in the token's smallest unit (6 decimals). Mainnet default: 0.20 USDC.
const SEASON_PRICE = BigInt(process.env.SEASON_PRICE ?? (MAINNET ? 200_000 : 200_000_000));
if (MAINNET && SEASON_PRICE > 1_000_000n) throw new Error("On mainnet the season price is capped at 1 USDC for this demo");
// NEAR the master account needs: contract storage is locked, the rest is spent.
const SUBS = MAINNET
  ? { club: 1, gate: 0.2, fan01: 0.3, fan02: 0.3 }
  : { tusdc: 2.5, club: 2, gate: 0.5, relayer: 1, ...Object.fromEntries(Array.from({ length: 10 }, (_, i) => [`fan${String(i + 1).padStart(2, "0")}`, 0.2])) };
if (MAINNET) {
  const size = (n) => readFileSync(join(repoRoot, "target", "near", n, `${n}.wasm`)).length;
  const st = await provider().viewAccount({ accountId: MASTER }).catch(() => null);
  if (!st) throw new Error(`${MASTER} not found on mainnet`);
  const have = Number(BigInt(st.amount) / 10n ** 21n) / 1000;
  const fresh = st.code_hash === "11111111111111111111111111111111";
  const lock = fresh ? size("nearseat") / 1e5 : 0;
  const subs = Object.values(SUBS).reduce((a, b) => a + b, 0);
  const vaultFee = (size("nearseat_vault") / 1e5) * 10;
  const need = lock + subs + vaultFee + 0.5;
  console.log(`MAINNET PLAN for ${MASTER} (balance ${have.toFixed(2)} NEAR)`);
  console.log(`  contract storage, locked not spent   ${lock.toFixed(2)} NEAR`);
  console.log(`  sub-accounts ${Object.keys(SUBS).join(", ")}   ${subs.toFixed(2)} NEAR (stays in those accounts)`);
  console.log(`  publish vault code by hash, about    ${vaultFee.toFixed(2)} NEAR (spent; skipped if already published)`);
  console.log(`  fees and margin                      0.50 NEAR`);
  console.log(`  needed in total, about               ${need.toFixed(2)} NEAR`);
  console.log(`  token ${MAINNET_USDC} (USDC), season price ${Number(SEASON_PRICE) / 1e6} USDC`);
  if (have < need) throw new Error(`Not enough NEAR: have ${have.toFixed(2)}, need about ${need.toFixed(2)}`);
  if (!process.argv.includes("--yes")) {
    console.log("\nNothing was sent. Re-run with --yes to deploy.");
    process.exit(0);
  }
}
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
const made = {};
for (const [prefix, amount] of Object.entries(SUBS)) made[prefix] = await ensureSub(prefix, amount);
const ids = { TUSDC_ID: MAINNET ? MAINNET_USDC : made.tusdc, CLUB_ID: made.club, GATE_ID: made.gate };
if (!MAINNET) ids.RELAYER_ID = made.relayer;

step("Vault code → global contract, addressed by hash (immutable)");
const vault = wasm("nearseat_vault");
const hash = base58Encode(createHash("sha256").update(vault).digest());
const globalExists = await rawQuery({ request_type: "view_global_contract_code", code_hash: hash }).then(() => true, () => false);
if (globalExists) {
  console.log(`  global vault ${hash} already on-chain`);
} else {
  await master.deployGlobalContract(vault, "codeHash");
  console.log(`  deployed global vault ${hash}`);
}

if (MAINNET) {
  step("Register accounts with USDC (0.00125 NEAR each, one-off)");
  const club = account(ids.CLUB_ID);
  for (const id of [MASTER, ids.CLUB_ID, made.fan01, made.fan02]) {
    if (await view(MAINNET_USDC, "storage_balance_of", { account_id: id })) console.log(`  ${id} already registered`);
    else {
      await call(club, MAINNET_USDC, "storage_deposit", { account_id: id, registration_only: true }, { deposit: 1_250_000_000_000_000_000_000n });
      console.log(`  registered ${id}`);
    }
  }
} else {
  step("tUSDC test token");
  const tusdc = account(ids.TUSDC_ID);
  if ((await exists(ids.TUSDC_ID)).code_hash === "11111111111111111111111111111111") {
    await tusdc.deployContract(wasm("tusdc"));
    await call(tusdc, ids.TUSDC_ID, "new", {});
    console.log("  deployed and initialised");
  } else console.log("  already deployed");
}

step(`NearSeat contract on ${MASTER}`);
if (state.code_hash === "11111111111111111111111111111111") {
  await master.deployContract(wasm("nearseat"));
  await call(master, MASTER, "new", {
    club: ids.CLUB_ID,
    gate: ids.GATE_ID,
    stablecoin: ids.TUSDC_ID,
    vault_code_hash: hash,
    season_name: "2026/27",
    season_price: String(SEASON_PRICE),
    max_supply: 50,
  }, { gas: 100n * TGAS });
  console.log("  deployed and initialised");
} else console.log("  already deployed");

step(`Writing ${MAINNET ? ".env.mainnet" : ".env"}`);
const file = envFile();
let text = existsSync(file) ? readFileSync(file, "utf8") : readFileSync(join(repoRoot, ".env.example"), "utf8");
const set = (k, v) => {
  text = new RegExp(`^${k}=.*$`, "m").test(text) ? text.replace(new RegExp(`^${k}=.*$`, "m"), `${k}=${v}`) : `${text}\n${k}=${v}`;
};
if (MAINNET) {
  set("NEAR_NETWORK", "mainnet");
  set("NEAR_RPC_URL", "https://free.rpc.fastnear.com");
  set("MASTER_ACCOUNT", MASTER);
  set("VITE_NETWORK", "mainnet");
  set("VITE_RPC_URL", "https://free.rpc.fastnear.com");
  set("VITE_RELAYER_URL", "");
  set("RELAYER_ID", "");
}
set("CONTRACT_ID", MASTER);
set("VITE_CONTRACT_ID", MASTER);
for (const [k, v] of Object.entries(ids)) set(k, v);
set("VITE_TUSDC_ID", ids.TUSDC_ID);
set("VITE_CLUB_ID", ids.CLUB_ID);
writeFileSync(file, text);
if (MAINNET) {
  // The site's mainnet build (served at /mainnet/) reads its ids from this committed file.
  const idsFile = join(repoRoot, "web", "src", "mainnet.json");
  writeFileSync(idsFile, JSON.stringify({ contractId: MASTER, tokenId: ids.TUSDC_ID, clubId: ids.CLUB_ID }, null, 2) + "\n");
  console.log(`  ${idsFile} updated. Commit it to publish the mainnet site.`);
}
console.log(`  ${file} updated. Next: ${MAINNET ? "NEAR_NETWORK=mainnet node scripts/seed.mjs" : "npm run seed"}`);
