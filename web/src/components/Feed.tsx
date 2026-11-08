// Live on-chain feed: polls the contract's `get_feed` ring buffer over RPC.
import { useEffect, useRef, useState } from "react";
import { view } from "../near/rpc";
import type { FeedItem } from "../lib/types";
import { config } from "../config";
import { nsToDate, usd } from "../lib/format";
import { ErrorBox, Loading } from "./ui";

type Data = Record<string, unknown>;

/** Human sentence for each contract event. */
export function describe(event: string, d: Data): { title: string; sub?: string } {
  const a = (k: string) => String(d[k] ?? "");
  const money = (k: string) => `${usd(a(k))} tUSDC`;
  switch (event) {
    case "kickoff": return { title: "Kickoff · seat loans locked", sub: `${a("tickets_sold")} tickets sold, ${a("seats_rented")} seats rented` };
    case "goal": {
      const [h, aw] = (d.score as number[]) ?? [0, 0];
      return { title: `Goal · ${a("scorer")} ${a("minute")}'`, sub: `${d.side === "Home" ? "Illia Stars" : "Visitors"} · ${h}–${aw}. Stamp added to checked-in memberships` };
    }
    case "full_time": return { title: "Full time · members' payout started", sub: `${money("members_cut")} to the members' pool, round ${a("payout_round")}` };
    case "postponed": return { title: "Match postponed · refunds open", sub: `${a("refunds_due")} payments will be refunded automatically` };
    case "ticket_sold": return { title: `Ticket sold · seat ${a("seat").toUpperCase()}`, sub: `${money("price")} by ${a("buyer")}` };
    case "seat_rented": return { title: `${a("token_id")} rented`, sub: `${a("renter")} paid ${money("price")}` };
    case "seat_lent": return { title: `${a("token_id")} offered for match ${a("match_id")}`, sub: money("price") };
    case "settled": return { title: `Payout landed in ${a("token_id")}`, sub: money("amount") };
    case "settle_failed": return { title: `Payout to ${a("token_id")} bounced`, sub: "Restored to the membership; will retry" };
    case "withdrawn": return { title: `Withdrawal from ${a("token_id")}`, sub: `${money("amount")} to ${a("to")}` };
    case "withdraw_failed": return { title: `Withdrawal from ${a("token_id")} failed`, sub: "Vault balance restored" };
    case "check_in": return { title: `Check-in · ${a("token_id")}`, sub: `${a("holder")} (${a("kind")}) · ${a("tier")}` };
    case "listed": return { title: `${a("token_id")} listed`, sub: money("price") };
    case "membership_sold": return { title: `${a("token_id")} sold`, sub: `${money("price")} · seller got ${money("seller_received")}` };
    case "membership_transferred": return { title: `${a("token_id")} → ${a("to")}`, sub: `from ${a("from")} (${a("reason")})` };
    case "membership_minted": return { title: `Membership minted · ${a("token_id")}`, sub: `vault ${a("vault")}` };
    case "refunded": return { title: "Refund sent", sub: `${money("amount")} to ${a("to")}` };
    case "pool_topped_up": return { title: "Club topped up the members' pool", sub: money("amount") };
    case "advance_taken": return { title: `Advance on ${a("token_id")}`, sub: money("amount") };
    case "advance_repaid": return { title: `Advance repaid · ${a("token_id")}`, sub: money("amount") };
    case "vote_cast": return { title: `Vote cast · poll ${a("poll_id")}`, sub: `weight ${a("weight")}` };
    case "match_created": return { title: `Fixture added · v ${a("opponent")}` };
    default: return { title: event.replaceAll("_", " ") };
  }
}

export function Feed({ filter, limit = 8 }: { filter?: (item: FeedItem, d: Data) => boolean; limit?: number }) {
  const [items, setItems] = useState<FeedItem[]>([]);
  const [error, setError] = useState<unknown>();
  const [loaded, setLoaded] = useState(false);
  const since = useRef<string | undefined>(undefined);

  useEffect(() => {
    let alive = true;
    const tick = async () => {
      try {
        const fresh = await view<FeedItem[]>("get_feed", since.current ? { since: since.current } : {});
        if (!alive) return;
        if (fresh.length) {
          since.current = fresh[fresh.length - 1].seq;
          setItems((old) => [...fresh.reverse(), ...old].slice(0, 64));
        }
        setError(undefined);
      } catch (e) {
        if (alive) setError(e);
      } finally {
        if (alive) setLoaded(true);
      }
    };
    tick();
    const t = setInterval(tick, config.pollMs);
    return () => { alive = false; clearInterval(t); };
  }, []);

  const shown = items
    .map((it) => ({ it, d: safeParse(it.data) }))
    .filter(({ it, d }) => !filter || filter(it, d))
    .slice(0, limit);

  if (!loaded) return <Loading what="Reading the contract" />;
  return (
    <div>
      {error ? <ErrorBox error={error} /> : null}
      {shown.length === 0 ? (
        <p className="py-4 text-sm text-muted">No on-chain events yet. They appear here within a few seconds of happening.</p>
      ) : (
        <ol className="divide-y divide-line" aria-live="polite">
          {shown.map(({ it, d }) => {
            const { title, sub } = describe(it.event, d);
            return (
              <li key={it.seq} className="flex gap-4 py-3">
                <time className="w-12 shrink-0 font-display text-sm font-bold text-lime">
                  {nsToDate(it.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                </time>
                <div className="min-w-0">
                  <div className="font-semibold">{title}</div>
                  {sub && <div className="truncate text-sm text-muted">{sub}</div>}
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}

function safeParse(s: string): Data {
  try { return JSON.parse(s) as Data; } catch { return {}; }
}
