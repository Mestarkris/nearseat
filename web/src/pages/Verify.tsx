// Public, wallet-free history of one membership + a live "Verify" check
// straight against public RPC: zero keys, code hash, owner, active loan.
import { useState } from "react";
import { view, viewAccessKeys, viewAccount } from "../near/rpc";
import { usePoll } from "../lib/usePoll";
import type { HistoryEntry, Membership, Season } from "../lib/types";
import { nsToDate, usd } from "../lib/format";
import { config } from "../config";
import { MembershipCard } from "../components/MembershipCard";
import { GateAccess } from "../components/GateAccess";
import { CATEGORIES, multiple } from "../lib/category";
import { Empty, ErrorBox, Loading, Section } from "../components/ui";

const KIND_LABEL: Record<string, string> = {
  minted: "Minted to", transfer: "Transferred to", sold: "Sold to", returned: "Returned to", sale_price: "Sale price (seller)",
  settled: "Payout settled into vault", withdrawn: "Withdrawn to", rented: "Seat rented by", lend_offered: "Seat offered",
  loan_refunded: "Rental refunded (postponed)", checked_in: "Checked in", listed: "Listed for sale", delisted: "Delisted",
  advance_taken: "Advance taken", advance_repaid: "Advance repaid", advance_recovered: "Advance recovered", voted: "Voted (weight)",
  credits_spent: "Food credits spent",
};

export function VerifyPage({ tokenId }: { tokenId?: string }) {
  const [input, setInput] = useState(tokenId ?? "seat-c5-12");
  if (!tokenId) {
    return (
      <form className="card mx-auto max-w-lg p-6" onSubmit={(e) => { e.preventDefault(); location.hash = `#/verify/${input.trim()}`; }}>
        <h1 className="text-2xl font-bold">Look up any membership</h1>
        <p className="mt-1 text-sm text-muted">No wallet needed. Everything is read live from public RPC.</p>
        <input className="input mt-4" value={input} onChange={(e) => setInput(e.target.value)} aria-label="Membership id" />
        <button className="btn-primary mt-3">Show history</button>
      </form>
    );
  }
  return <History tokenId={tokenId} />;
}

function History({ tokenId }: { tokenId: string }) {
  const d = usePoll(async () => {
    const m = await view<Membership | null>("membership", { token_id: tokenId });
    const h = m ? await view<HistoryEntry[]>("history", { token_id: tokenId, from_index: Math.max(0, m.history_len - 200), limit: 200 }) : [];
    return { m, h };
  }, [tokenId], 8_000);
  if (d.loading && !d.data) return <Loading what={`Reading ${tokenId}`} />;
  if (d.error && !d.data) return <ErrorBox error={d.error} retry={d.refresh} />;
  const { m, h } = d.data!;
  if (!m) return <Empty title={`${tokenId} doesn't exist on ${config.contractId}`} />;
  const t = m.totals;
  return (
    <div>
      <h1 className="text-3xl font-extrabold sm:text-5xl">{m.token_id} · public history</h1>
      <p className="mt-2 text-white/70">What it earned, what it paid out, and who held it. No wallet needed.</p>
      <div className="mt-6 grid gap-6 lg:grid-cols-[340px_1fr]">
        <div className="space-y-6">
          <MembershipCard m={m} compact />
          <GateAccess m={m} />
          <dl className="card space-y-2 p-4 text-sm">
            <div className="flex justify-between gap-3"><dt className="text-muted">Category</dt><dd className={`font-semibold ${CATEGORIES[m.category].text}`}>{CATEGORIES[m.category].label}</dd></div>
            <div className="flex justify-between gap-3"><dt className="text-muted">Share of every payout</dt><dd className="font-semibold">{multiple(m.category)} a standard seat</dd></div>
            <div className="flex justify-between gap-3"><dt className="text-muted">Grade, from matches attended</dt><dd className="font-semibold">{m.tier}</dd></div>
            <div className="flex justify-between gap-3"><dt className="text-muted">New from the club</dt><dd className="font-semibold">{usd(m.season_price, 0)} tUSDC</dd></div>
            <div className="flex justify-between gap-3"><dt className="text-muted">Highest resale price</dt><dd className="font-semibold">{usd(m.resale_cap, 0)} tUSDC</dd></div>
          </dl>
          <VerifyBox m={m} />
        </div>
        <div className="space-y-6">
          <Section title="Money">
            <dl className="grid gap-2 sm:grid-cols-2">
              {[
                ["Earned from ticket share", t.pool_earned], ["Earned from seat lending", t.loan_income],
                ["Settled into the vault", t.settled_into_vault], ["Withdrawn by holders", t.withdrawn],
                ["Advances taken", t.advances_taken], ["Advances repaid", t.advances_repaid],
                ["Rentals refunded", t.loan_refunds], ["In the vault now", m.vault_balance],
              ].map(([k, v]) => (
                <div key={k} className="flex justify-between rounded-xl bg-ink/70 px-3 py-2 text-sm"><dt className="text-muted">{k}</dt><dd className="font-semibold">{usd(v)}</dd></div>
              ))}
            </dl>
          </Section>
          <Section title={`Every holder (${m.holders.length})`}>
            <ol className="space-y-2 text-sm">
              {m.holders.map(([acc, at], i) => (
                <li key={i} className="flex justify-between gap-2 rounded-xl bg-ink/70 px-3 py-2">
                  <span className="mono truncate">{acc}{i === m.holders.length - 1 ? " (current)" : ""}</span>
                  <time className="shrink-0 text-muted">{nsToDate(at).toLocaleDateString()}</time>
                </li>
              ))}
            </ol>
          </Section>
          <Section title={`On-chain record (${m.history_len})`}>
            <ol className="divide-y divide-line text-sm">
              {[...h].reverse().map((e, i) => (
                <li key={i} className="flex flex-wrap justify-between gap-2 py-2">
                  <span>{KIND_LABEL[e.kind] ?? e.kind}{e.account ? ` ${e.account}` : ""}{e.match_id != null ? ` · match ${e.match_id}` : ""}</span>
                  <span className="text-muted">{e.amount != null && e.kind !== "voted" && e.kind !== "credits_spent" ? `${usd(e.amount)} tUSDC · ` : e.amount ? `${e.amount} · ` : ""}{nsToDate(e.at).toLocaleString()}</span>
                </li>
              ))}
            </ol>
          </Section>
        </div>
      </div>
    </div>
  );
}

interface Check { label: string; ok: boolean; detail: string }

function VerifyBox({ m }: { m: Membership }) {
  const [checks, setChecks] = useState<Check[]>();
  const [err, setErr] = useState<unknown>();
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    setErr(undefined);
    try {
      const [vaultKeys, vaultAcc, season, owner, mainKeys] = await Promise.all([
        viewAccessKeys(m.vault), viewAccount(m.vault), view<Season>("season"),
        view<{ owner_id: string } | null>("nft_token", { token_id: m.token_id }), viewAccessKeys(config.contractId),
      ]);
      const rented = m.loans.find((l) => "Rented" in l.loan);
      setChecks([
        { label: "Vault has zero access keys", ok: vaultKeys.length === 0, detail: `${vaultKeys.length} keys on ${m.vault}` },
        { label: "Vault runs the published vault code", ok: vaultAcc.global_contract_hash === season.vault_code_hash, detail: `global code ${vaultAcc.global_contract_hash ?? "none"}` },
        { label: "Current owner (live from NEP-171)", ok: owner?.owner_id === m.owner_id, detail: owner?.owner_id ?? "?" },
        { label: "Active loan", ok: true, detail: rented && "Rented" in rented.loan ? `match ${rented.match_id} → ${rented.loan.Rented.renter}` : "none" },
        { label: "Main contract keys", ok: mainKeys.length === 0, detail: mainKeys.length === 0 ? "0: locked, nobody can redeploy" : `${mainKeys.length} (not locked yet: development deploy)` },
      ]);
    } catch (e) {
      setErr(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="card p-5">
      <h2 className="text-lg font-bold">Verify</h2>
      <p className="mt-1 text-xs text-muted">Queries {config.rpcUrl} right now. Compare the code hash with your own build: <code>npm run build:contracts</code>.</p>
      <button className="btn-primary mt-3" onClick={run} disabled={busy}>{busy ? "Checking…" : "Verify on-chain"}</button>
      {err ? <div className="mt-3"><ErrorBox error={err} /></div> : null}
      {checks && (
        <ul className="mt-4 space-y-2 text-sm">
          {checks.map((c) => (
            <li key={c.label} className="rounded-xl bg-ink/70 px-3 py-2">
              <div className="font-semibold">{c.ok ? "✅" : "⚠️"} {c.label}</div>
              <div className="mono break-all text-xs text-muted">{c.detail}</div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
