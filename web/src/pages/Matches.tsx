// Pick a match, pick your seat. Lime seats are lent by members: buying one pays
// that member's seat account. The other free seats are sold by the club, priced
// by category.
import { useState } from "react";
import { view } from "../near/rpc";
import { useWallet } from "../near/wallet";
import { usePoll } from "../lib/usePoll";
import { useAction } from "../lib/useAction";
import type { Match, Season, SeatView } from "../lib/types";
import { parseSeat, shortDate, usd } from "../lib/format";
import { CATEGORIES, categoryOf, priceFor } from "../lib/category";
import { StadiumMap, standName } from "../components/StadiumMap";
import { ActionStatus } from "../components/ActionStatus";
import { Faucet } from "../components/Faucet";
import { Empty, ErrorBox, Loading } from "../components/ui";

export function MatchesPage() {
  const matches = usePoll(() => view<Match[]>("get_matches"), []);
  const [picked, setPicked] = useState<number>();
  if (matches.loading && !matches.data) return <Loading what="Loading fixtures" />;
  if (matches.error && !matches.data) return <ErrorBox error={matches.error} retry={matches.refresh} />;
  const open = (matches.data ?? []).filter((m) => m.status === "Scheduled" || m.status === "Live");
  const current = open.find((m) => m.id === picked) ?? open[0];
  return (
    <div>
      <h1 className="text-4xl font-extrabold sm:text-5xl">Pick a match, pick your seat</h1>
      <p className="mt-2 text-white/70">5% of every ticket goes to season members. Lime seats are lent by members: buy one and that member's seat account gets paid.</p>
      {open.length === 0 ? <div className="mt-6"><Empty title="No fixtures on sale" /></div> : (
        <>
          <div className="mt-5 flex flex-wrap gap-2" role="tablist" aria-label="Fixtures">
            {open.map((m) => (
              <button key={m.id} role="tab" aria-selected={current?.id === m.id} onClick={() => setPicked(m.id)}
                className={`rounded-2xl px-4 py-2 text-left text-sm ${current?.id === m.id ? "bg-lime text-ink" : "border border-line"}`}>
                <div className="font-semibold">vs {m.opponent}</div>
                <div className="text-xs opacity-70">{shortDate(m.kickoff_at)}{m.status === "Live" ? " · LIVE" : ""}</div>
              </button>
            ))}
          </div>
          {current && <SeatPicker key={current.id} match={current} />}
        </>
      )}
    </div>
  );
}

function SeatPicker({ match }: { match: Match }) {
  const { accountId, signIn, payTusdc, gasless, setGasless } = useWallet();
  const seats = usePoll(() => view<SeatView[]>("seat_map", { match_id: match.id }), [match.id]);
  const season = usePoll(() => view<Season>("season"), []);
  const [pick, setPick] = useState<{ seat: string; v?: SeatView }>();
  const [bought, setBought] = useState<{ label: string; passId: string }>();
  const a = useAction(() => { seats.refresh(); setPick(undefined); });

  const lent = pick?.v?.state === "lent";
  const price = lent ? BigInt(pick!.v!.price!) : pick ? priceFor(match.ticket_price, pick.seat) : 0n;
  const feeBps = BigInt(season.data?.config.lend_club_fee_bps ?? 500);
  const fee = lent ? (price * feeBps) / 10_000n : 0n;
  const s = pick ? parseSeat(pick.seat) : null;

  return (
    <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_340px]">
      <section className="card p-4 sm:p-6">
        <div className="mb-3 flex flex-wrap justify-between gap-x-4 gap-y-1 text-sm"><span className="font-display text-lg font-bold">Stars Arena</span><span className="text-muted">vs {match.opponent} · {shortDate(match.kickoff_at)}</span></div>
        {seats.loading && !seats.data ? <Loading what="Loading seats" /> : seats.error && !seats.data ? <ErrorBox error={seats.error} retry={seats.refresh} /> : (
          <StadiumMap seats={seats.data ?? []} picked={pick?.seat} onPick={(seat, v) => { a.clear(); setPick({ seat, v }); }} />
        )}
      </section>
      <aside className="card-glow h-fit p-5 lg:sticky lg:top-24" aria-label="Ticket slip">
        <div className="flex items-center justify-between"><h2 className="text-lg font-bold">Ticket slip</h2></div>
        {bought && !pick && (
          <div className="mt-4 rounded-2xl border border-lime/60 bg-lime/10 p-4" role="status">
            <div className="font-semibold text-lime">✓ Ticket bought: {bought.label}</div>
            <p className="mt-1 text-sm text-white/80">It's in your wallet as an NFT and shows on your gate pass on match day.</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <a className="btn-primary" href={`#/pass/${bought.passId}`}>Gate pass</a>
              <a className="btn-ghost" href="#/member">My tickets</a>
            </div>
          </div>
        )}
        {!pick || !s ? <p className="mt-4 text-sm text-muted">{bought ? "Tap another seat to buy more." : "Tap a free seat on the map. Colour shows the category, and lime seats are lent by members."}</p> : (
          <>
            <div className="mt-4 rounded-2xl border border-line p-3">
              <div className="flex justify-between font-semibold"><span>{standName(pick.seat)} · Row {s.row} · Seat {s.number}</span><span>{usd(price)}</span></div>
              <div className="text-xs text-muted">vs {match.opponent} · {shortDate(match.kickoff_at)}</div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                <span className={`rounded-full border border-current px-2 py-0.5 text-[10px] font-bold uppercase ${CATEGORIES[categoryOf(pick.seat)].text}`}>{CATEGORIES[categoryOf(pick.seat)].label}</span>
                {lent && <span className="rounded-full bg-lime px-2 py-0.5 text-[10px] font-bold uppercase text-ink">Lent by a member</span>}
              </div>
            </div>
            <dl className="mt-4 space-y-2 text-sm">
              {lent ? (
                <>
                  <div className="flex justify-between"><dt className="text-muted">To {pick.v?.token_id}'s account</dt><dd>{usd(price - fee)}</dd></div>
                  <div className="flex justify-between"><dt className="text-muted">Club fee</dt><dd>{usd(fee)}</dd></div>
                </>
              ) : (
                <div className="flex justify-between"><dt className="text-muted">Of which to members' pool</dt><dd>{usd((price * BigInt(season.data?.config.members_cut_bps ?? 500)) / 10_000n)}</dd></div>
              )}
              <div className="flex items-center justify-between gap-2">
                <dt className="text-muted">Network fee</dt>
                <dd>
                  <label className="flex cursor-pointer items-center gap-2 text-xs">
                    <input type="checkbox" checked={gasless} onChange={(e) => setGasless(e.target.checked)} className="accent-lime" />
                    <span className={gasless ? "text-lime" : "text-muted"}>{gasless ? "Gasless via relayer*" : "< 0.001 NEAR from your wallet"}</span>
                  </label>
                </dd>
              </div>
              <div className="flex justify-between border-t border-line pt-2 text-base font-bold"><dt>Total</dt><dd>{usd(price)} tUSDC</dd></div>
            </dl>
            {accountId ? (
              <button className="btn-primary mt-4 w-full justify-center py-3" disabled={!!a.busy}
                onClick={async () => {
                  const label = `${standName(pick.seat)} · Row ${s.row} · Seat ${s.number}`;
                  const passId = lent ? pick.v!.token_id! : `t${match.id}-${pick.seat}`;
                  if (await a.run("Buying", () => payTusdc(price.toString(), { action: "buy_seat", match_id: match.id, seat: pick.seat }))) setBought({ label, passId });
                }}>
                Buy ticket
              </button>
            ) : <button className="btn-primary mt-4 w-full justify-center py-3" onClick={signIn}>Connect wallet to buy</button>}
            <ActionStatus a={a} />
            <p className="mt-3 text-center text-xs text-muted">Your pass appears on match day. If the match is postponed you're refunded automatically.</p>
            {gasless && <p className="mt-1 text-center text-[11px] text-muted">*If your wallet can't sign meta-transactions, it falls back to a normal transaction.</p>}
            <div className="mt-3"><Faucet /></div>
          </>
        )}
      </aside>
    </div>
  );
}
