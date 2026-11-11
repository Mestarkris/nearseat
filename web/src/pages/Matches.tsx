// Pick a match, pick your seat. Burgundy seats are lent by members: buying one pays
// that member's seat account. The other free seats are sold by the club, priced
// by category.
import { useEffect, useState } from "react";
import { view } from "../near/rpc";
import { useWallet } from "../near/wallet";
import { usePoll } from "../lib/usePoll";
import { useAction } from "../lib/useAction";
import type { Match, Membership, Season, SeatView, TicketInfo } from "../lib/types";
import { parseSeat, shortDate, usd } from "../lib/format";
import { CATEGORIES, categoryOf, priceFor } from "../lib/category";
import { PayFromAnyChain } from "../components/PayFromAnyChain";
import { StadiumMap, standName, type MapEffect } from "../components/StadiumMap";
import { SeatPeek, useSeatPeek } from "../components/SeatPeek";
import { useFeedEvents } from "../lib/feedEvents";
import { useCountUp } from "../lib/motion";
import { ActionStatus } from "../components/ActionStatus";
import { Faucet } from "../components/Faucet";
import { NewHere } from "../components/NewHere";
import { Empty, ErrorBox, LiveBadge, Loading } from "../components/ui";

export function MatchesPage() {
  const matches = usePoll(() => view<Match[]>("get_matches"), []);
  const [picked, setPicked] = useState<number>();
  const all = matches.data ?? [];
  const onSale = all.filter((m) => m.status === "Scheduled" || m.status === "Live").sort((a, b) => Number(BigInt(a.kickoff_at) - BigInt(b.kickoff_at)));
  // A fixture whose kickoff time has passed but which the club has not started yet.
  const due = (m: Match) => m.status === "Scheduled" && Number(BigInt(m.kickoff_at) / 1_000_000n) < Date.now();
  // The last result stays on the page, so the full-time payout can be watched (and replayed).
  const last = all.filter((m) => m.status === "Finished").sort((a, b) => Number(BigInt(b.ended_at ?? 0) - BigInt(a.ended_at ?? 0)))[0];
  const open = last ? [...onSale, last] : onSale;
  const current = open.find((m) => m.id === picked) ?? open.find((m) => m.status === "Live") ?? open.find((m) => m.status === "Scheduled" && !due(m)) ?? open[0];
  // Hold on to the fixture being watched, so it stays on screen when it goes from live to full time.
  useEffect(() => { if (picked === undefined && current) setPicked(current.id); }, [picked, current]);
  if (matches.loading && !matches.data) return <Loading what="Loading fixtures" />;
  if (matches.error && !matches.data) return <ErrorBox error={matches.error} retry={matches.refresh} />;
  return (
    <div>
      <h1 className="text-4xl font-extrabold sm:text-5xl">Pick a match, pick your seat</h1>
      <p className="mt-2 text-fg/70">5% of every ticket goes to season members. Burgundy seats are lent by members: buy one and that member's seat account gets paid.</p>
      {open.length === 0 ? <div className="mt-6"><Empty title="No fixtures yet" /></div> : (
        <>
          <div className="mt-5 flex flex-wrap gap-2" role="tablist" aria-label="Fixtures">
            {open.map((m) => (
              <button key={m.id} role="tab" aria-selected={current?.id === m.id} onClick={() => setPicked(m.id)}
                className={`rounded-2xl px-4 py-2 text-left text-sm ${current?.id === m.id ? "bg-wine text-wine-ink" : "border border-line"}`}>
                <div className="font-semibold">vs {m.opponent}</div>
                <div className="text-xs opacity-70">{m.status === "Finished" ? `Full time ${m.home_goals}–${m.away_goals}` : shortDate(m.kickoff_at)}{m.status === "Live" ? " · LIVE" : due(m) ? " · kickoff due" : ""}</div>
              </button>
            ))}
          </div>
          {current && <SeatPicker key={current.id} match={current} />}
        </>
      )}
    </div>
  );
}

type Pick = { seat: string; v?: SeatView };
const seatLabel = (seat: string) => { const p = parseSeat(seat); return `${standName(seat)} · Row ${p.row} · Seat ${p.number}`; };
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

function SeatPicker({ match }: { match: Match }) {
  const { accountId, signIn, payTusdcMany, gasless, setGasless } = useWallet();
  const seats = usePoll(() => view<SeatView[]>("seat_map", { match_id: match.id }), [match.id]);
  const season = usePoll(() => view<Season>("season"), []);
  // What this wallet already holds: tickets count towards the per-match limit, a membership already opens the gate.
  const mine = usePoll(async () => accountId ? {
    tickets: await view<[string, TicketInfo][]>("tickets_for_owner", { account_id: accountId }),
    memberships: await view<Membership[]>("memberships_for_owner", { account_id: accountId }),
  } : { tickets: [], memberships: [] }, [accountId], 12_000);
  const [basket, setBasket] = useState<Pick[]>([]);
  const [full, setFull] = useState(false);
  const [bought, setBought] = useState<{ got: { label: string; passId: string }[]; missed: string[] }>();
  const a = useAction(() => { seats.refresh(); mine.refresh(); setBasket([]); setFull(false); });
  const peek = useSeatPeek();
  const finished = match.status === "Finished";
  // A home goal sends a wave round the ground; full time sends the members' share to their seats.
  const [effect, setEffect] = useState<MapEffect>();
  const play = (kind: MapEffect["kind"]) => setEffect((e) => ({ kind, id: (e?.id ?? 0) + 1 }));
  useFeedEvents((event, d) => {
    if (d.match_id !== match.id) return;
    if (event === "goal" && d.side === "Home") play("wave");
    if (event === "full_time") { setBasket([]); play("payout"); }
  });

  const isLent = (p: Pick) => p.v?.state === "lent";
  const priceOf = (p: Pick) => isLent(p) ? BigInt(p.v!.price!) : priceFor(match.ticket_price, p.seat);
  const feeBps = BigInt(season.data?.config.lend_club_fee_bps ?? 500);
  const cutBps = BigInt(season.data?.config.members_cut_bps ?? 500);
  const total = basket.reduce((t, p) => t + priceOf(p), 0n);
  const toMembers = basket.filter(isLent).reduce((t, p) => t + priceOf(p) - (priceOf(p) * feeBps) / 10_000n, 0n);
  const clubFee = basket.filter(isLent).reduce((t, p) => t + (priceOf(p) * feeBps) / 10_000n, 0n);
  const toPool = basket.filter((p) => !isLent(p)).reduce((t, p) => t + (priceOf(p) * cutBps) / 10_000n, 0n);
  // One wallet may hold a few club tickets per match (4 by default). Lent seats are not counted by the contract.
  const limit = season.data?.config.max_tickets_per_account ?? 4;
  const held = (mine.data?.tickets ?? []).filter(([, t]) => t.match_id === match.id).length;
  const room = Math.max(0, limit - held);
  const toggle = (seat: string, v?: SeatView) => {
    a.clear();
    if (basket.some((p) => p.seat === seat)) { setFull(false); setBasket(basket.filter((p) => p.seat !== seat)); return; }
    const club = v?.state !== "lent";
    if (basket.length >= limit || (club && basket.filter((p) => !isLent(p)).length >= room)) { setFull(true); return; }
    setFull(false);
    setBasket([...basket, { seat, v }]);
  };
  // A member's own seat for this match: theirs to sit in unless they lent it out.
  const myMembership = mine.data?.memberships[0];
  const mySeat = myMembership && seats.data?.find((x) => x.token_id === myMembership.token_id);
  const lentOut = !!mySeat && (mySeat.state === "lent" || mySeat.state === "rented");

  const buy = async () => {
    const wanted = basket;
    let result: { got: { label: string; passId: string }[]; missed: string[] } = { got: [], missed: [] };
    const ok = await a.run(wanted.length > 1 ? `Buying ${wanted.length} tickets` : "Buying", async () => {
      await payTusdcMany(wanted.map((p) => ({ amountRaw: priceOf(p).toString(), msg: { action: "buy_seat", match_id: match.id, seat: p.seat } })));
      // A payment the contract refuses is sent straight back, so read the chain to see which seats are really ours.
      let landed: Pick[] = [];
      for (let i = 0; i < 6; i++) {
        const [tix, map] = await Promise.all([
          view<[string, TicketInfo][]>("tickets_for_owner", { account_id: accountId }),
          view<SeatView[]>("seat_map", { match_id: match.id }),
        ]);
        landed = wanted.filter((p) => isLent(p)
          ? map.some((x) => x.seat === p.seat && x.state === "rented" && x.holder === accountId)
          : tix.some(([id]) => id === `t${match.id}-${p.seat}`));
        if (landed.length === wanted.length) break;
        await pause(1500);
      }
      if (!landed.length) throw new Error("No seat was bought. The payment was refused and your tUSDC came straight back. The seats may have just been taken, or this wallet has reached its ticket limit for the match.");
      result = {
        got: landed.map((p) => ({ label: seatLabel(p.seat), passId: isLent(p) ? p.v!.token_id! : `t${match.id}-${p.seat}` })),
        missed: wanted.filter((p) => !landed.includes(p)).map((p) => seatLabel(p.seat)),
      };
    }, wanted.length > 1 ? "Tickets bought" : "Ticket bought");
    if (ok) setBought(result);
  };

  return (
    <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_340px]">
      <section className="card p-4 sm:p-6">
        <div className="mb-3 flex flex-wrap justify-between gap-x-4 gap-y-1 text-sm"><span className="font-display text-lg font-bold">Stars Arena</span><span className="text-muted">vs {match.opponent} · {shortDate(match.kickoff_at)}</span></div>
        {seats.loading && !seats.data ? <Loading what="Loading seats" /> : seats.error && !seats.data ? <ErrorBox error={seats.error} retry={seats.refresh} /> : (
          <StadiumMap seats={seats.data ?? []} picked={basket.map((p) => p.seat)} onPick={toggle} onMember={peek.open} readOnly={finished} effect={effect} />
        )}
        {match.status === "Live" && <p className="mt-3 text-center text-xs text-muted">Stay on this page: a home goal sends a wave round the ground, and at full time the members' share flies to their seats.</p>}
      </section>
      {peek.tokenId && <SeatPeek tokenId={peek.tokenId} onClose={peek.close} />}
      {finished ? <FullTime match={match} seats={seats.data ?? []} payoutPlays={effect?.kind === "payout" ? effect.id : 0} play={play} /> : (
      <aside className="card-glow h-fit p-5 lg:sticky lg:top-24" aria-label="Ticket slip">
        <div className="flex items-center justify-between"><h2 className="text-lg font-bold">Ticket slip</h2></div>
        {accountId && myMembership && (
          <p className="mt-3 rounded-2xl border border-line bg-card-2 p-3 text-sm text-fg/85" role="note">
            {lentOut
              ? <>You lent seat {myMembership.seat.toUpperCase()} for this match, so your membership will not open the gate. Buy a ticket here if you still want to come.</>
              : <>Your membership already gets you in to this match, in seat {myMembership.seat.toUpperCase()}. Buy tickets here only for guests.</>}
          </p>
        )}
        {bought && basket.length === 0 && (
          <div className="mt-4 rounded-2xl border border-lime/60 bg-wine/10 p-4" role="status">
            <div className="font-semibold text-lime">✓ {bought.got.length === 1 ? `Ticket bought: ${bought.got[0].label}` : `${bought.got.length} tickets bought`}</div>
            {bought.got.length > 1 && <ul className="mt-1 text-sm text-fg/80">{bought.got.map((g) => <li key={g.passId}>{g.label}</li>)}</ul>}
            <p className="mt-1 text-sm text-fg/80">{bought.got.length === 1 ? "It's in your wallet as an NFT and shows on your gate pass on match day." : "They're in your wallet as NFTs. Each one has its own gate pass on match day."}</p>
            {bought.missed.length > 0 && <p className="mt-2 text-sm text-warn">Not bought: {bought.missed.join(", ")}. That payment was refused and the money came straight back to your wallet.</p>}
            <div className="mt-3 flex flex-wrap gap-2">
              {bought.got.length === 1 && <a className="btn-primary" href={`#/pass/${bought.got[0].passId}`}>Gate pass</a>}
              <a className={bought.got.length === 1 ? "btn-ghost" : "btn-primary"} href="#/member">My tickets</a>
            </div>
          </div>
        )}
        {basket.length === 0 ? (
          <p className="mt-4 text-sm text-muted">
            {bought ? "Tap another seat to buy more." : `Tap a free seat on the map. You can pick up to ${limit} for one match. Colour shows the category, and burgundy seats are lent by members.`}
            {accountId && held > 0 && !bought ? ` This wallet already holds ${held} for this match.` : ""}
          </p>
        ) : (
          <>
            <ul className="mt-4 space-y-2">
              {basket.map((p) => (
                <li key={p.seat} className="rounded-2xl border border-line p-3">
                  <div className="flex items-start justify-between gap-2 font-semibold">
                    <span>{seatLabel(p.seat)}</span>
                    <span className="flex shrink-0 items-center gap-2">
                      {usd(priceOf(p))}
                      <button type="button" onClick={() => toggle(p.seat, p.v)} aria-label={`Remove ${seatLabel(p.seat)}`}
                        className="grid size-6 place-items-center rounded-full border border-line text-sm leading-none text-muted hover:border-fg hover:text-fg">×</button>
                    </span>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    <span className={`rounded-full border border-current px-2 py-0.5 text-[10px] font-bold uppercase ${CATEGORIES[categoryOf(p.seat)].text}`}>{CATEGORIES[categoryOf(p.seat)].label}</span>
                    {isLent(p) && <span className="rounded-full bg-wine px-2 py-0.5 text-[10px] font-bold uppercase text-wine-ink">Lent by a member</span>}
                  </div>
                </li>
              ))}
            </ul>
            <div className="mt-2 text-xs text-muted">vs {match.opponent} · {shortDate(match.kickoff_at)}{basket.length < limit ? " · tap more seats to add them" : ""}</div>
            {full && <p className="mt-2 text-sm text-warn" role="status">One wallet can hold {limit} tickets for a match{held > 0 ? `, and this one already holds ${held}` : ""}. Remove a seat to pick a different one.</p>}
            <dl className="mt-4 space-y-2 text-sm">
              {toMembers > 0n && <div className="flex justify-between"><dt className="text-muted">To the lending members' seat accounts</dt><dd>{usd(toMembers)}</dd></div>}
              {clubFee > 0n && <div className="flex justify-between"><dt className="text-muted">Club fee</dt><dd>{usd(clubFee)}</dd></div>}
              {toPool > 0n && <div className="flex justify-between"><dt className="text-muted">Of which to members' pool</dt><dd>{usd(toPool)}</dd></div>}
              <div className="flex items-center justify-between gap-2">
                <dt className="text-muted">Network fee</dt>
                <dd>
                  {basket.length > 1 ? <span className="text-xs text-muted">{"< 0.01 NEAR from your wallet"}</span> : (
                    <label className="flex cursor-pointer items-center gap-2 text-xs">
                      <input type="checkbox" checked={gasless} onChange={(e) => setGasless(e.target.checked)} className="accent-wine" />
                      <span className={gasless ? "text-lime" : "text-muted"}>{gasless ? "Gasless via relayer*" : "< 0.001 NEAR from your wallet"}</span>
                    </label>
                  )}
                </dd>
              </div>
              <div className="flex justify-between border-t border-line pt-2 text-base font-bold"><dt>Total{basket.length > 1 ? ` for ${basket.length} seats` : ""}</dt><dd>{usd(total)} tUSDC</dd></div>
            </dl>
            <PayFromAnyChain amount={total} what={basket.length > 1 ? "these seats" : "this seat"} />
            {accountId ? (
              <button className="btn-primary mt-4 w-full justify-center py-3" disabled={!!a.busy} onClick={buy}>
                {basket.length > 1 ? `Buy ${basket.length} tickets` : "Buy ticket"}
              </button>
            ) : <button className="btn-primary mt-4 w-full justify-center py-3" onClick={signIn}>Connect wallet to buy</button>}
            {!accountId && <NewHere />}
            <ActionStatus a={a} />
            {basket.length > 1 && <p className="mt-3 text-center text-xs text-muted">You approve once in your wallet. Tickets stay in the wallet that buys them, so your guests come in with you.</p>}
            <p className="mt-3 text-center text-xs text-muted">{basket.length > 1 ? "Passes appear" : "Your pass appears"} on match day. If the match is postponed you're refunded automatically.</p>
            {gasless && basket.length === 1 && <p className="mt-1 text-center text-[11px] text-muted">*If your wallet can't sign meta-transactions, it falls back to a normal transaction.</p>}
            <div className="mt-3"><Faucet /></div>
          </>
        )}
      </aside>
      )}
    </div>
  );
}

/** What happened at full time, with the payout and each home goal ready to watch again. */
function FullTime({ match, seats, payoutPlays, play }: { match: Match; seats: SeatView[]; payoutPlays: number; play: (kind: MapEffect["kind"]) => void }) {
  const members = seats.filter((s) => s.state !== "sold").length;
  const cut = Number(match.members_cut) / 1e6;
  // Counts up from zero each time the payout plays.
  const [target, setTarget] = useState(cut);
  useEffect(() => {
    if (!payoutPlays) { setTarget(cut); return; }
    setTarget(0);
    const t = setTimeout(() => setTarget(cut), 60);
    return () => clearTimeout(t);
  }, [payoutPlays, cut]);
  const paid = useCountUp(target, true, payoutPlays ? 1100 + members * 90 : 1);
  return (
    <aside className="card-glow h-fit p-5 lg:sticky lg:top-24" aria-label="Full time">
      <LiveBadge label="FULL TIME" />
      <div className="mt-4 grid grid-cols-[1fr_auto_1fr] items-center gap-3 text-center">
        <div className="text-sm font-semibold">Illia Stars United</div>
        <div className="font-number text-6xl leading-none">{match.home_goals}–{match.away_goals}</div>
        <div className="text-sm font-semibold">{match.opponent}</div>
      </div>
      <div className="mt-5 rounded-2xl border border-lime/50 bg-ink p-4">
        <div className="text-sm text-fg/80">Paid to members at the whistle</div>
        <div className="mt-1 flex items-baseline gap-2">
          <span className="font-number text-5xl leading-none text-lime tabular-nums">{paid.toFixed(2)}</span>
          <span className="text-sm text-muted">tUSDC</span>
        </div>
        <p className="mt-2 text-xs text-muted">5% of this match's ticket sales, split across {members} seat accounts by category. A VIP seat's coin is bigger because its share is 2.5 times a standard one.</p>
        <button className="btn-primary mt-3 w-full justify-center" onClick={() => play("payout")}>Replay the payout</button>
      </div>
      <h3 className="mt-5 font-semibold">Goals</h3>
      {match.goals.length === 0 ? <p className="mt-1 text-sm text-muted">No goals in this one.</p> : (
        <ul className="mt-2 space-y-2 text-sm">
          {match.goals.map((g, i) => (
            <li key={i} className="flex items-center justify-between gap-2 rounded-xl bg-ink/70 px-3 py-2">
              <span><span className="font-number text-lg text-lime">{g.minute}'</span> {g.scorer}</span>
              {g.side === "Home"
                ? <button className="text-xs font-semibold text-lime underline-offset-2 hover:underline" onClick={() => play("wave")}>Replay the wave</button>
                : <span className="text-xs text-muted">{match.opponent}</span>}
            </li>
          ))}
        </ul>
      )}
      <p className="mt-4 text-xs text-muted">Tap a blue seat to open that member's card. Every home goal is stamped on the cards of members who were checked in.</p>
    </aside>
  );
}
