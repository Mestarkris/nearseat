// Pure relayer policy, unit-tested in test/policy.test.mjs.

/** Methods the relayer will pay gas for. Anything else is refused (T51). */
export const ALLOWED_METHODS = new Set([
  // nearseat
  "withdraw", "lend", "cancel_lend", "list", "delist", "claim", "borrow", "vote",
  "set_autolend", "clear_autolend", "settle", "nft_transfer",
  // tusdc
  "ft_transfer_call", "storage_deposit", "faucet",
]);
export const MAX_DEPOSIT_YOCTO = 1n;
/** storage_deposit needs a real deposit; it is paid by the user, never the relayer. */
export const STORAGE_DEPOSIT_MAX_YOCTO = 12_500_000_000_000_000_000_000n; // 0.0125 NEAR

/** Returns an error string, or null if the delegate action is acceptable. */
export function checkDelegate(da, { allowedReceivers }) {
  if (!da || !Array.isArray(da.actions) || da.actions.length === 0) return "Empty delegate action";
  if (!allowedReceivers.includes(da.receiverId)) return `Receiver ${da.receiverId} is not allowed`;
  if (da.actions.length > 4) return "Too many actions";
  for (const a of da.actions) {
    const fc = a.functionCall;
    if (!fc) return "Only function calls can be relayed";
    if (!ALLOWED_METHODS.has(fc.methodName)) return `Method ${fc.methodName} is not relayed`;
    const deposit = BigInt(fc.deposit ?? 0);
    const cap = fc.methodName === "storage_deposit" ? STORAGE_DEPOSIT_MAX_YOCTO : MAX_DEPOSIT_YOCTO;
    if (deposit > cap) return `Deposit too large for ${fc.methodName}`;
    if (BigInt(fc.gas ?? 0) > 300_000_000_000_000n) return "Too much gas";
  }
  return null;
}

/** Sliding one-minute window per account. */
export class RateLimiter {
  constructor({ perMinute }) {
    this.perMinute = perMinute;
    this.hits = new Map();
  }
  take(key, now = Date.now()) {
    const recent = (this.hits.get(key) ?? []).filter((t) => now - t < 60_000);
    if (recent.length >= this.perMinute) {
      this.hits.set(key, recent);
      return false;
    }
    recent.push(now);
    this.hits.set(key, recent);
    return true;
  }
}

/** Single-use NEP-413 nonces for the members-only API (T54). */
export class NonceStore {
  constructor({ ttlMs }) {
    this.ttlMs = ttlMs;
    this.seen = new Map();
  }
  consume(nonce, now = Date.now()) {
    for (const [k, t] of this.seen) if (now - t > this.ttlMs) this.seen.delete(k);
    if (this.seen.has(nonce)) return false;
    this.seen.set(nonce, now);
    return true;
  }
}
