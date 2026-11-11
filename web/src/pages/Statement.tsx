// Season statement: one public page that sums up a seat's season. Everything
// on it is read live from the contract, so it can be shared and checked.
import { useState } from "react";
import { view } from "../near/rpc";
import { usePoll } from "../lib/usePoll";
import { useCountUp } from "../lib/motion";
import type { HistoryEntry, Match, Membership, Season } from "../lib/types";
import { nsToDate, parseSeat, usd } from "../lib/format";
import { config } from "../config";
import { CATEGORIES, multiple } from "../lib/category";
import { Stamps } from "../components/MembershipCard";
import { Crest, Empty, ErrorBox, Loading, Progress } from "../components/ui";

export function StatementPage({ tokenId }: { tokenId?: string }) {
  const id = tokenId ?? "seat-c5-12";
  const d = usePoll(async () => {
    const [m, matches, season] = await Promise.all([
      view<Membership | null>("membership", { token_id: id }),
      view<Match[]>("get_matches"),
      view<Season>("season"),
    ]);
    const h = m ? await view<HistoryEntry[]>("history", { token_id: id, from_index: Math.max(0, m.history_len - 200), limit: 200 }) : [];
    return { m, matches, season, h };
  }, [id], 15_000);
  if (d.loading && !d.data) return <Loading what={`Reading ${id}`} />;
  if (d.error && !d.data) return <ErrorBox error={d.error} retry={d.refresh} />;
  const { m, matches, season, h } = d.data!;
  if (!m) return <Empty title={`${id} doesn't exist on ${config.contractId}`} />;
  return <Statement m={m} matches={matches} season={season} history={h} />;
}

function Figure({ label, value, unit, digits = 0 }: { label: string; value: number; unit?: string; digits?: number }) {
  const v = useCountUp(value, true, 1100);
  return (
    <div>
      <dd className="font-number text-5xl leading-none tabular-nums sm:text-6xl">
        {v.toFixed(digits)}{unit && <span className="ml-1.5 font-sans text-sm font-medium text-muted">{unit}</span>}
      </dd>
      <dt className="mt-1 text-sm text-white/70">{label}</dt>
    </div>
  );
}

function Statement({ m, matches, season, history }: { m: Membership; matches: Match[]; season: Season; history: HistoryEntry[] }) {
  const [copied, setCopied] = useState(false);
  const seat = parseSeat(m.seat);
  const played = matches.filter((x) => x.status === "Finished").sort((a, b) => Number(BigInt(a.kickoff_at) - BigInt(b.kickoff_at)));
  const lentFor = new Set(history.filter((e) => e.kind === "rented" && e.match_id != null).map((e) => e.match_id!));
  const earned = BigInt(m.totals.pool_earned) + BigInt(m.totals.loan_income);
  const price = BigInt(m.season_price);
  const pct = price > 0n ? Number((earned * 1000n) / price) / 10 : 0;
  const num = (raw: string | bigint) => Number(raw) / 1e6;
  const url = `${location.origin}${location.pathname}#/statement/${m.token_id}`;
  const share = async () => {
    try {
      if (navigator.share) await navigator.share({ title: `Season statement · ${m.token_id}`, url });
      else { await navigator.clipboard.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 2000); }
    } catch { /* the reader closed the share sheet */ }
  };
  return (
    <div className="mx-auto max-w-3xl">
      <article className="card overflow-hidden" aria-label={`Season statement for ${m.token_id}`}>
        <header className="relative overflow-hidden px-5 pb-7 pt-6 sm:px-9">
          <div className="pitch absolute inset-0 opacity-30" aria-hidden />
          <div className="relative">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-3"><Crest size={44} /><div><div className="font-display font-bold">Illia Stars United</div><div className="text-sm text-white/70">Season statement, {season.name}</div></div></div>
              <span className={`shrink-0 rounded-full border border-current px-3 py-1 text-xs font-bold ${CATEGORIES[m.category].text}`}>{CATEGORIES[m.category].label}</span>
            </div>
            <h1 className="mt-7 font-number text-6xl leading-[0.9] tracking-wide sm:text-8xl">
              {seat.stand} stand<br /><span className="text-lime">Row {seat.row}, seat {seat.number}</span>
            </h1>
            <p className="mt-4 text-sm text-white/80">Held by <span className="mono break-all text-white">{m.owner_id}</span>. {m.tier} grade, {multiple(m.category)} share of every payout.</p>
          </div>
        </header>

        {/* The tear line of a ticket stub. */}
        <div className="relative border-t-2 border-dashed border-line" aria-hidden>
          <span className="absolute -left-3 -top-3 size-6 rounded-full bg-ink" /><span className="absolute -right-3 -top-3 size-6 rounded-full bg-ink" />
        </div>

        <div className="px-5 py-7 sm:px-9">
          <dl className="grid grid-cols-2 gap-x-6 gap-y-7 sm:grid-cols-3">
            <Figure label={`of ${played.length} home matches attended`} value={m.attended.length} />
            <Figure label="home goals seen from this seat" value={m.goal_stamps.length} />
            <Figure label={`${lentFor.size === 1 ? "match" : "matches"} lent to another fan`} value={lentFor.size} />
            <Figure label="earned from ticket sales" value={num(m.totals.pool_earned)} unit="tUSDC" digits={2} />
            <Figure label="earned from lending the seat" value={num(m.totals.loan_income)} unit="tUSDC" digits={2} />
            <Figure label="spent at the ground" value={num(m.vendor_spent)} unit="tUSDC" digits={2} />
          </dl>

          <div className="mt-8 rounded-2xl border border-lime/50 bg-ink p-4">
            <div className="font-display text-lg font-bold">This seat has earned {pct >= 100 ? "all" : `${pct.toFixed(pct < 10 ? 1 : 0)}%`} of next season's price</div>
            <div className="mt-3"><Progress value={Number(earned)} max={Number(price)} label={`${usd(earned)} of ${usd(price, 0)} tUSDC`} right={`${usd(m.vault_balance)} in the seat now`} /></div>
            {BigInt(m.renewal_saved) > 0n && <p className="mt-2 text-sm text-white/80">{usd(m.renewal_saved)} tUSDC is set aside for renewal ({m.renewal_bps / 100}% of each payout).</p>}
          </div>

          {m.goal_stamps.length > 0 && (
            <div className="mt-8">
              <h2 className="text-lg font-bold">Goal stamps</h2>
              <Stamps m={{ ...m, attended: [] }} className="mt-3" />
            </div>
          )}

          <h2 className="mt-8 text-lg font-bold">Match by match</h2>
          {played.length === 0 ? <p className="mt-2 text-sm text-muted">No home match has finished yet.</p> : (
            <ol className="mt-3 divide-y divide-line text-sm">
              {played.map((x) => {
                const there = m.attended.includes(x.id);
                const goals = m.goal_stamps.filter((g) => g.match_id === x.id).length;
                return (
                  <li key={x.id} className="grid grid-cols-[1fr_auto] items-center gap-x-4 gap-y-0.5 py-3">
                    <span className="font-semibold">v {x.opponent} <span className="ml-1 font-number text-lg text-white/80">{x.home_goals}–{x.away_goals}</span></span>
                    <span className={`text-right font-semibold ${there ? "text-lime" : lentFor.has(x.id) ? "text-sky" : "text-muted"}`}>{there ? "In the seat" : lentFor.has(x.id) ? "Lent out" : "Not checked in"}</span>
                    <span className="text-xs text-muted">{nsToDate(x.kickoff_at).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}</span>
                    <span className="text-right text-xs text-muted">{goals > 0 ? `${goals} goal ${goals === 1 ? "stamp" : "stamps"}` : ""}</span>
                  </li>
                );
              })}
            </ol>
          )}
        </div>

        <footer className="border-t border-line px-5 py-4 text-xs text-muted sm:px-9">
          Read from <span className="mono text-white/80">{config.contractId}</span> on {new Date().toLocaleString()}. The seat's own account is <span className="mono break-all text-white/80">{m.vault}</span>.
        </footer>
      </article>

      <div className="no-print mt-5 flex flex-wrap gap-2">
        <button className="btn-primary" onClick={share}>{copied ? "Link copied" : "Share this statement"}</button>
        <button className="btn-ghost" onClick={() => print()}>Print</button>
        <a className="btn-ghost" href={`#/verify/${m.token_id}`}>Check it on-chain</a>
      </div>
    </div>
  );
}
