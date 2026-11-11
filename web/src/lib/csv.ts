// CSV files an accountant can open in Excel, Numbers or Google Sheets without
// any setup: UTF-8 with a byte-order mark, CRLF line ends, every text cell
// quoted, plain decimal numbers (no thousands separators, no currency sign).
export type Cell = string | number | null | undefined;

function cell(v: Cell): string {
  if (v == null || v === "") return "";
  if (typeof v === "number") return String(v);
  // A cell that starts with = + - or @ can run as a formula in a spreadsheet.
  const safe = /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
  return `"${safe.replace(/"/g, '""')}"`;
}

export function toCsv(header: string[], rows: Cell[][]): string {
  return [header, ...rows].map((r) => r.map(cell).join(",")).join("\r\n") + "\r\n";
}

export function downloadCsv(filename: string, header: string[], rows: Cell[][]): void {
  const blob = new Blob(["﻿" + toCsv(header, rows)], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Raw 6-decimal token amount → "12.50" (a plain number, as text so no digit is lost). */
export function money(raw: string | bigint | null | undefined): number | "" {
  if (raw == null) return "";
  const v = typeof raw === "bigint" ? raw : BigInt(raw);
  return Number(v) / 1e6;
}

/** Nanosecond timestamp → "2026-11-11 10:40" in UTC. */
export function utc(ns: string): string {
  return new Date(Number(BigInt(ns) / 1_000_000n)).toISOString().slice(0, 16).replace("T", " ");
}
