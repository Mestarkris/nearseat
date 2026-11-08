import type { ActionState } from "../lib/useAction";

export function ActionStatus({ a }: { a: ActionState }) {
  if (a.busy) return <p className="mt-3 text-sm text-muted" role="status">{a.busy}… confirm in your wallet</p>;
  if (a.error) return <p className="mt-3 rounded-xl border border-danger/40 bg-danger/10 p-3 text-sm text-danger" role="alert">Refused: {a.error}</p>;
  if (a.done) return <p className="mt-3 text-sm text-lime" role="status">✓ {a.done}</p>;
  return null;
}
