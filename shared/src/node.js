// Node-only helpers shared by relayer, keeper and scripts: config from .env,
// keys from ~/.near-credentials (near-cli-rs legacy keychain) or env vars,
// and thin wrappers over near-api-js 7.
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { Account, JsonRpcProvider, KeyPairSigner } from "near-api-js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

/** Loads <repo>/.env into process.env (without overriding real env vars). */
export function loadEnv() {
  const file = join(ROOT, ".env");
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

export function env(name, fallback) {
  const v = process.env[name] ?? fallback;
  if (v === undefined || v === "") throw new Error(`Missing ${name}. Copy .env.example to .env and fill it in.`);
  return v;
}

export const repoRoot = ROOT;
export const network = () => process.env.NEAR_NETWORK ?? "testnet";
export const provider = () => new JsonRpcProvider({ url: process.env.NEAR_RPC_URL ?? `https://rpc.${network()}.near.org` });

/** Finds a private key: $<ID>_PRIVATE_KEY, or ~/.near-credentials/<net>/<id>.json, or <id>/<pk>.json. */
export function findKey(accountId) {
  const envName = accountId.replace(/[^a-z0-9]/gi, "_").toUpperCase() + "_PRIVATE_KEY";
  if (process.env[envName]) return process.env[envName];
  const dir = join(homedir(), ".near-credentials", network());
  const flat = join(dir, `${accountId}.json`);
  if (existsSync(flat)) return JSON.parse(readFileSync(flat, "utf8")).private_key;
  const nested = join(dir, accountId);
  if (existsSync(nested)) {
    const f = readdirSync(nested).find((n) => n.endsWith(".json"));
    if (f) return JSON.parse(readFileSync(join(nested, f), "utf8")).private_key;
  }
  return undefined;
}

export function account(accountId, privateKey = findKey(accountId)) {
  if (!privateKey) {
    throw new Error(
      `No key for ${accountId}. Put it in ~/.near-credentials/${network()}/${accountId}.json ` +
        `(near-cli-rs "legacy keychain") or set ${accountId.replace(/[^a-z0-9]/gi, "_").toUpperCase()}_PRIVATE_KEY.`,
    );
  }
  return new Account(accountId, provider(), KeyPairSigner.fromSecretKey(privateKey));
}

export async function view(contractId, method, args = {}) {
  return provider().callFunction({ contractId, method, args });
}

export const TGAS = 1_000_000_000_000n;
export const ONE_YOCTO = 1n;

/** Calls a contract method and throws a readable error on failure. */
export async function call(acc, contractId, methodName, args = {}, { deposit = 0n, gas = 100n * TGAS } = {}) {
  return acc.callFunction({ contractId, methodName, args, deposit, gas });
}

/** True if `publicKey` is a FullAccess key of `accountId` right now. */
export async function isFullAccessKey(accountId, publicKey) {
  try {
    const key = await provider().viewAccessKey({ accountId, publicKey });
    return key?.permission === "FullAccess" || key?.permission?.FullAccess !== undefined;
  } catch {
    return false;
  }
}

/** Raw JSON-RPC `query` (keeps every field, e.g. global_contract_hash). */
export async function rawQuery(params) {
  const url = process.env.NEAR_RPC_URL ?? `https://rpc.${network()}.near.org`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "query", params: { finality: "final", ...params } }),
  });
  const body = await res.json();
  if (body.error) throw new Error(JSON.stringify(body.error));
  return body.result;
}
