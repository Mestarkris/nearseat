// Relayer allow-list and abuse limits (threat model T51, T54).
import { test } from "node:test";
import assert from "node:assert/strict";
import { checkDelegate, RateLimiter, NonceStore } from "../src/policy.mjs";

const fc = (methodName, deposit = 0n) => ({ functionCall: { methodName, args: new Uint8Array(), gas: 30_000_000_000_000n, deposit } });
const opts = { allowedReceivers: ["nearseat.testnet", "tusdc.nearseat.testnet"] };

test("allows a 1-yocto withdraw to the contract", () => {
  assert.equal(checkDelegate({ receiverId: "nearseat.testnet", actions: [fc("withdraw", 1n)] }, opts), null);
});

test("rejects non-allowlisted receiver", () => {
  assert.match(checkDelegate({ receiverId: "evil.testnet", actions: [fc("withdraw", 1n)] }, opts), /not allowed/);
});

test("rejects unknown method and big deposits", () => {
  assert.match(checkDelegate({ receiverId: "nearseat.testnet", actions: [fc("mint_membership")] }, opts), /not relayed/);
  assert.match(checkDelegate({ receiverId: "nearseat.testnet", actions: [fc("withdraw", 2n)] }, opts), /Deposit too large/);
});

test("rejects non-function-call actions", () => {
  assert.match(checkDelegate({ receiverId: "nearseat.testnet", actions: [{ transfer: { deposit: 1n } }] }, opts), /Only function calls/);
});

test("rate limiter caps per account per minute", () => {
  const l = new RateLimiter({ perMinute: 2 });
  assert.equal(l.take("a", 0), true);
  assert.equal(l.take("a", 1), true);
  assert.equal(l.take("a", 2), false);
  assert.equal(l.take("b", 2), true);
  assert.equal(l.take("a", 61_000), true);
});

test("nonces are single-use", () => {
  const s = new NonceStore({ ttlMs: 1000 });
  assert.equal(s.consume("n1", 0), true);
  assert.equal(s.consume("n1", 10), false);
});
