// tUSDC has 6 decimals.
export const ONE = 1_000_000n;

export function usd(raw: string | bigint | null | undefined, digits = 2): string {
  if (raw == null) return "0.00";
  const v = typeof raw === "bigint" ? raw : BigInt(raw);
  const whole = v / ONE;
  const frac = (v % ONE).toString().padStart(6, "0").slice(0, digits);
  return `${whole.toLocaleString("en-US")}${digits ? "." + frac : ""}`;
}

export function toRaw(amount: string): string {
  const [w, f = ""] = amount.trim().split(".");
  if (!/^\d+$/.test(w || "0") || !/^\d*$/.test(f)) throw new Error("Enter a number like 12.50");
  return (BigInt(w || "0") * ONE + BigInt((f + "000000").slice(0, 6))).toString();
}

const STANDS: Record<string, string> = { a: "North", b: "East", c: "South", d: "West" };

/** `c5-12` → { block: "C", stand: "South", row: 5, number: 12 } */
export function parseSeat(seat: string) {
  const m = /^([a-d])(\d)-(\d+)$/.exec(seat);
  if (!m) return { block: "?", stand: "?", row: 0, number: 0 };
  return { block: m[1].toUpperCase(), stand: STANDS[m[1]], row: Number(m[2]), number: Number(m[3]) };
}

export function seatLabel(seat: string): string {
  const s = parseSeat(seat);
  return `Block ${s.block} · Row ${s.row} · Seat ${s.number}`;
}

export function nsToDate(ns: string | number): Date {
  return new Date(Number(BigInt(ns) / 1_000_000n));
}

export function shortDate(ns: string): string {
  return nsToDate(ns).toLocaleString(undefined, { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

export function matchMinute(startedNs: string | null, nowMs = Date.now()): number {
  if (!startedNs) return 0;
  return Math.min(120, Math.floor((nowMs - Number(BigInt(startedNs) / 1_000_000n)) / 60_000) + 1);
}

export function short(account: string, n = 22): string {
  return account.length > n ? `${account.slice(0, n - 8)}…${account.slice(-7)}` : account;
}
