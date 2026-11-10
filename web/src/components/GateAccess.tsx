// Who the gate lets in on this seat for the next match. Read from the same
// contract view the gate scanner uses, so it is always the live answer.
import { view } from "../near/rpc";
import { usePoll } from "../lib/usePoll";
import type { Match, Membership } from "../lib/types";
import { shortDate } from "../lib/format";

export function GateAccess({ m }: { m: Membership }) {
  const d = usePoll(async () => {
    const matches = await view<Match[]>("get_matches");
    const next = matches
      .filter((x) => x.status === "Scheduled" || x.status === "Live")
      .sort((x, y) => (BigInt(x.kickoff_at) < BigInt(y.kickoff_at) ? -1 : 1))[0];
    if (!next) return null;
    return { next, holder: await view<string>("holder_for", { token_id: m.token_id, match_id: next.id }) };
  }, [m.token_id, m.nonce], 15_000);
  if (!d.data) return null;
  const { next, holder } = d.data;
  const lent = holder !== m.owner_id;
  return (
    <div className={`rounded-2xl border px-3 py-2.5 ${lent ? "border-warn/50" : "border-lime/50"}`} role="status">
      <div className="text-xs text-muted">Gets in on this seat {next.status === "Live" ? "today" : "next match"}, v {next.opponent}</div>
      <div className={`mono mt-0.5 truncate text-sm font-semibold ${lent ? "text-warn" : "text-lime"}`}>{holder}</div>
      <div className="mt-0.5 text-xs text-muted">
        {lent ? `Lent for this match. ${m.owner_id}'s pass is paused until full time.` : `The owner. ${shortDate(next.kickoff_at)}`}
      </div>
    </div>
  );
}
