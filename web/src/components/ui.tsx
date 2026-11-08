// Small shared UI pieces: badges, progress, stats, and loading/empty/error states.
import type { ReactNode } from "react";

export function LiveBadge({ label = "LIVE" }: { label?: string }) {
  return (
    <span className="chip gap-2 font-semibold text-white">
      <span className="relative flex size-2">
        <span className="absolute inline-flex size-full animate-ping rounded-full bg-lime opacity-60" />
        <span className="relative inline-flex size-2 rounded-full bg-lime" />
      </span>
      {label}
    </span>
  );
}

export function TierBadge({ tier }: { tier: string }) {
  return <span className="rounded-full bg-lime px-3 py-1 text-xs font-bold uppercase text-lime-ink">{tier}</span>;
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
        <div className="h-full rounded-full bg-lime transition-[width] duration-700" style={{ width: `${pct}%` }} />
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
    <svg width={size} height={size} viewBox="0 0 64 64" aria-label="Illia Stars United crest">
      <circle cx="32" cy="32" r="28" fill="#0a0c0f" stroke="#b8e62b" strokeWidth="2.5" />
      <path d="M32 14 L46 22 L46 40 L32 50 L18 40 L18 22 Z" fill="none" stroke="#b8e62b" strokeWidth="2" />
      <path d="M32 24 l2.6 5.4 5.9.8-4.3 4.1 1 5.8-5.2-2.8-5.2 2.8 1-5.8-4.3-4.1 5.9-.8z" fill="#b8e62b" />
    </svg>
  );
}
