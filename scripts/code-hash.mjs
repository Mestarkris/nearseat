#!/usr/bin/env node
// Prints the NEAR code hash (base58 of sha256) for each wasm file given.
// Compare with `code_hash` from RPC `view_account` (see README → Verify).
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
export function base58(bytes) {
  let n = BigInt("0x" + Buffer.from(bytes).toString("hex"));
  let out = "";
  while (n > 0n) {
    out = ALPHABET[Number(n % 58n)] + out;
    n /= 58n;
  }
  for (const b of bytes) {
    if (b !== 0) break;
    out = "1" + out;
  }
  return out;
}

for (const file of process.argv.slice(2)) {
  const hash = createHash("sha256").update(readFileSync(file)).digest();
  console.log(`${base58(hash)}  ${file}`);
}
