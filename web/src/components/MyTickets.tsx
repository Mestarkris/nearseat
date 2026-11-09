// Single-match tickets held by the connected wallet (soulbound NEP-171 tokens).
import { view } from "../near/rpc";
import { usePoll } from "../lib/usePoll";
import type { Match, TicketInfo } from "../lib/types";
import { shortDate } from "../lib/format";
import { standName } from "./StadiumMap";
import { Section } from "./ui";

export function MyTickets({ accountId }: { accountId: string }) {
  const d = usePoll(async () => ({
    tickets: await view<[string, TicketInfo][]>("tickets_for_owner", { account_id: accountId }),
    matches: await view<Match[]>("get_matches"),
  }), [accountId], 8_000);
  if (!d.data?.tickets.length) return null;
  const byId = new Map(d.data.matches.map((m) => [m.id, m]));
  return (
    <Section title={`My tickets (${d.data.tickets.length})`}>
      <ul className="grid gap-3 sm:grid-cols-2">
        {d.data.tickets.map(([id, t]) => {
          const m = byId.get(t.match_id);
          const [row, num] = t.seat.slice(1).split("-");
          const open = m && (m.status === "Scheduled" || m.status === "Live");
          return (
            <li key={id} className="rounded-2xl border border-line p-4">
              <div className="flex items-center justify-between gap-2">
                <span className="font-semibold">v {m?.opponent ?? `match ${t.match_id}`}</span>
                <span className="chip">{m?.status ?? "?"}</span>
              </div>
              <div className="mt-1 text-sm text-muted">{standName(t.seat)} · Row {row} · Seat {num}{m ? ` · ${shortDate(m.kickoff_at)}` : ""}</div>
              <div className="mono mt-1 text-xs text-muted">{id} · non-transferable NFT</div>
              {open && <a className="btn-primary mt-3" href={`#/pass/${id}`}>Gate pass</a>}
              {m?.status === "Postponed" && <p className="mt-2 text-sm text-warn">Postponed: refunded automatically to your wallet.</p>}
            </li>
          );
        })}
      </ul>
    </Section>
  );
}
