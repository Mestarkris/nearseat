// Read-only NEAR RPC over plain fetch. No wallet needed: the public history,
// Verify page and live feed all work for anyone.
import { config } from "../config";

let id = 0;

export class RpcError extends Error {}

async function rpc<T>(method: string, params: unknown): Promise<T> {
  const res = await fetch(config.rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params }),
  });
  if (!res.ok) throw new RpcError(`RPC HTTP ${res.status}`);
  const body = await res.json();
  if (body.error) throw new RpcError(body.error.data ?? body.error.message ?? "RPC error");
  if (body.result?.error) throw new RpcError(body.result.error);
  return body.result as T;
}

const enc = new TextEncoder();
const dec = new TextDecoder();

function b64(s: string): string {
  let bin = "";
  for (const byte of enc.encode(s)) bin += String.fromCharCode(byte);
  return btoa(bin);
}

/** Calls a view method and parses its JSON result. */
export async function view<T>(method: string, args: object = {}, contractId = config.contractId): Promise<T> {
  const r = await rpc<{ result: number[] }>("query", {
    request_type: "call_function",
    finality: "optimistic",
    account_id: contractId,
    method_name: method,
    args_base64: b64(JSON.stringify(args)),
  });
  return JSON.parse(dec.decode(new Uint8Array(r.result))) as T;
}

export interface AccountView {
  amount: string;
  code_hash: string;
  global_contract_hash?: string | null;
  global_contract_account_id?: string | null;
  storage_usage: number;
}

export function viewAccount(accountId: string) {
  return rpc<AccountView>("query", { request_type: "view_account", finality: "final", account_id: accountId });
}

export interface AccessKeyInfo {
  public_key: string;
  access_key: { nonce: number; permission: "FullAccess" | { FunctionCall: unknown } };
}

export async function viewAccessKeys(accountId: string): Promise<AccessKeyInfo[]> {
  const r = await rpc<{ keys: AccessKeyInfo[] }>("query", {
    request_type: "view_access_key_list",
    finality: "final",
    account_id: accountId,
  });
  return r.keys;
}

export async function ftBalance(accountId: string): Promise<string> {
  return view<string>("ft_balance_of", { account_id: accountId }, config.tusdcId);
}
