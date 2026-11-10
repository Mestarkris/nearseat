// The membership NFT card, drawn from live on-chain state (the contract also
// renders an equivalent SVG in `nft_token` for wallets and explorers).
import type { Membership } from "../lib/types";
import { parseSeat, usd } from "../lib/format";
import { CATEGORIES } from "../lib/category";
import { Crest } from "./ui";

export function MembershipCard({ m, compact = false }: { m: Membership; compact?: boolean }) {
  const seat = parseSeat(m.seat);
  const renter = m.loans.find((l) => "Rented" in l.loan);
  const stats: [string, string][] = [
    ["ATT", String(m.attended.length)],
    ["BAL", usd(m.vault_balance, 1)],
    ["PAS", String(m.passes_left)],
    ["SHR", usd(BigInt(m.totals.pool_earned) + BigInt(m.unsettled), 1)],
    ["LND", usd(m.totals.loan_income, 1)],
    ["RFD", usd(m.totals.loan_refunds, 1)],
  ];
  return (
    <article
      className="card-glow relative overflow-hidden p-5"
      aria-label={`Membership ${m.token_id}, ${CATEGORIES[m.category].label} seat, ${m.tier} grade, owned by ${m.owner_id}`}
    >
      <div className="pitch absolute inset-0 opacity-[0.35]" aria-hidden />
      <svg className="absolute inset-0 size-full opacity-20" aria-hidden preserveAspectRatio="none" viewBox="0 0 100 140">
        <rect x="4" y="4" width="92" height="132" fill="none" stroke="white" strokeWidth="0.4" />
        <line x1="4" y1="70" x2="96" y2="70" stroke="white" strokeWidth="0.4" />
        <circle cx="50" cy="70" r="12" fill="none" stroke="white" strokeWidth="0.4" />
      </svg>
      <div className="relative">
        <div className="flex items-start justify-between">
          <div>
            <div className="font-number text-6xl leading-none text-lime">{seat.number}</div>
            <div className="label">Seat</div>
          </div>
          <Crest size={compact ? 48 : 64} />
          <div className="flex flex-col items-end gap-1.5">
            <span className="rounded-full bg-lime px-3 py-1 text-xs font-bold uppercase text-lime-ink">{m.tier}</span>
            <span className={`rounded-full border border-current px-3 py-0.5 text-xs font-bold uppercase ${CATEGORIES[m.category].text}`}>{CATEGORIES[m.category].label}</span>
          </div>
        </div>
        <div className="mt-3 text-center font-number text-3xl tracking-wide">
          BLOCK {seat.block} · ROW {seat.row}
        </div>
        {renter && "Rented" in renter.loan && (
          <div className="mt-2 text-center text-sm font-semibold text-lime">Lent to @{renter.loan.Rented.renter}</div>
        )}
        {m.listing && <div className="mt-2 text-center text-sm font-semibold text-warn">For sale · {usd(m.listing.price)} tUSDC</div>}
        <dl className="mt-4 grid grid-cols-3 gap-2">
          {stats.map(([k, v]) => (
            <div key={k} className="rounded-xl border border-line bg-ink/80 px-2 py-2 text-center">
              <dd className="font-display text-lg font-bold">{v}</dd>
              <dt className="text-[10px] tracking-wider text-muted">{k}</dt>
            </div>
          ))}
        </dl>
        {(m.attended.length > 0 || m.goal_stamps.length > 0) && (
          <div className="mt-3 flex flex-wrap items-center gap-1" aria-label="Attendance and goal stamps">
            {m.attended.map((id) => (
              <span key={`a${id}`} className="size-3 rounded-full bg-lime" title={`Attended match ${id}`} />
            ))}
            {m.goal_stamps.map((g, i) => (
              <span key={`g${i}`} title={`${g.scorer} ${g.minute}' v ${g.opponent}`} className="text-sm">⚽</span>
            ))}
          </div>
        )}
        <div className="mt-4 rounded-xl border border-line bg-ink/90 p-3">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-lime">Owns its own account · Keys: 0</div>
          <div className="mono mt-1 truncate text-xs">{m.vault}</div>
        </div>
      </div>
    </article>
  );
}
