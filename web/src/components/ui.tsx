// Small shared UI pieces: badges, progress, stats, and loading/empty/error states.
import type { ReactNode } from "react";

export function LiveBadge({ label = "LIVE" }: { label?: string }) {
  return (
    <span className="chip gap-2 font-semibold text-white">
      <span className="relative flex size-2">
        <span className="absolute inline-flex size-full animate-ping rounded-full bg-wine opacity-60" />
        <span className="relative inline-flex size-2 rounded-full bg-wine" />
      </span>
      {label}
    </span>
  );
}

export function TierBadge({ tier }: { tier: string }) {
  return <span className="rounded-full bg-wine px-3 py-1 text-xs font-bold uppercase text-wine-ink">{tier}</span>;
}

export function Progress({ value, max, label, right }: { value: number; max: number; label?: string; right?: ReactNode }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return (
    <div>
      {(label || right) && (
        <div className="mb-1 flex justify-between text-xs">
          <span className="text-muted">{label}</span>
          <span className="font-semibold text-lime">{right}</span>
        </div>
      )}
      <div className="h-1.5 rounded-full bg-line" role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100} aria-label={label}>
        <div className="h-full rounded-full bg-wine transition-[width] duration-700" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

export function Stat({ label, value, sub }: { label: string; value: ReactNode; sub?: ReactNode }) {
  return (
    <div className="card p-5">
      <div className="text-sm text-muted">{label}</div>
      <div className="mt-1 font-display text-3xl font-bold">{value}</div>
      {sub && <div className="mt-1 text-xs text-lime">{sub}</div>}
    </div>
  );
}

export function Loading({ what = "Loading" }: { what?: string }) {
  return (
    <div className="flex items-center gap-3 p-6 text-sm text-muted" role="status">
      <span className="size-4 animate-spin rounded-full border-2 border-line border-t-lime" />
      {what}…
    </div>
  );
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="card p-8 text-center">
      <div className="font-display text-lg font-semibold">{title}</div>
      {children && <div className="mt-2 text-sm text-muted">{children}</div>}
    </div>
  );
}

export function ErrorBox({ error, retry }: { error: unknown; retry?: () => void }) {
  const msg = error instanceof Error ? error.message : String(error);
  return (
    <div className="rounded-2xl border border-danger/40 bg-danger/10 p-4 text-sm text-danger" role="alert">
      <div className="font-semibold">Something went wrong</div>
      <div className="mt-1 break-words opacity-90">{msg}</div>
      {retry && <button className="btn-ghost mt-3" onClick={retry}>Try again</button>}
    </div>
  );
}

export function Section({ title, right, children, className = "" }: { title: string; right?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`card p-5 sm:p-6 ${className}`}>
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="text-lg font-bold">{title}</h2>
        {right}
      </div>
      {children}
    </section>
  );
}

export function Crest({ size = 40 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" role="img" aria-label="NearSeat crest">
      <path d="M32 5 L52 13 V33 C52 46 43 54 32 59 C21 54 12 46 12 33 V13 Z" fill="none" stroke="#ead9b5" strokeWidth="3.2" strokeLinejoin="round" />
      <polygon points="32.0,17.0 34.5,23.6 41.5,23.9 36.0,28.3 37.9,35.1 32.0,31.2 26.1,35.1 28.0,28.3 22.5,23.9 29.5,23.6" fill="#ead9b5" />
      <path d="M21 41 Q32 48 43 41" fill="none" stroke="#ead9b5" strokeWidth="3" strokeLinecap="round" />
      <path d="M24.5 47.5 Q32 52 39.5 47.5" fill="none" stroke="#ead9b5" strokeWidth="2.2" strokeLinecap="round" opacity="0.6" />
    </svg>
  );
}

/** Header lockup: crest + NEARSEAT wordmark in Bebas Neue. */
export function Logo({ size = 32 }: { size?: number }) {
  return (
    <span className="flex items-center gap-2">
      <Crest size={size} />
      <span className="font-number text-[1.75rem] leading-none tracking-wide">NEAR<span className="text-lime">SEAT</span></span>
    </span>
  );
}
