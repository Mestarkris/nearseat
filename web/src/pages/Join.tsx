// Buy a brand-new season membership from the club: pick a free seat, pay the
// season price in tUSDC, and the contract creates that seat's keyless account
// and mints the membership NFT to you. If anything fails, you're refunded.
import { useState } from "react";
import { view } from "../near/rpc";
import { useWallet } from "../near/wallet";
import { usePoll } from "../lib/usePoll";
import { useAction } from "../lib/useAction";
import type { Match, Membership, Season, SeatView } from "../lib/types";
import { parseSeat, usd } from "../lib/format";
import { CATEGORIES, CATEGORY_ORDER, categoryOf, multiple, priceFor } from "../lib/category";
import { StadiumMap, standName } from "../components/StadiumMap";
import { SeatPeek, useSeatPeek } from "../components/SeatPeek";
import { ActionStatus } from "../components/ActionStatus";
import { Faucet } from "../components/Faucet";
import { ErrorBox, Loading } from "../components/ui";
import { config } from "../config";

const PERKS = [
  "Your own NEAR account for the seat, with zero keys: only the NFT holder controls it",
  "A share of 5% of every match's ticket sales, sized by your seat's category and paid into that account",
  "A gate pass for every home match this season",
  "Lend the seat for matches you can't make; the rent goes to your seat's account",
  "Sell it any time on the market, with everything inside it",
];

export function JoinPage() {
  const { accountId, signIn, payTusdc } = useWallet();
  const d = usePoll(async () => {
    const [season, matches, members] = await Promise.all([
      view<Season>("season"),
      view<Match[]>("get_matches"),
      view<Membership[]>("memberships", { limit: 100 }),
    ]);
    const open = matches.filter((m) => m.status === "Scheduled" || m.status === "Live");
    const maps = await Promise.all(open.map((m) => view<SeatView[]>("seat_map", { match_id: m.id })));
    // Member seats, plus seats already sold as single tickets for an upcoming match.
    const taken = new Map<string, SeatView>();
    for (const m of members) taken.set(m.seat, { seat: m.seat, state: "member", price: null, token_id: m.token_id, holder: m.owner_id });
    for (const map of maps) for (const s of map) if (s.state === "sold" && !taken.has(s.seat)) taken.set(s.seat, s);
    return { season, members, taken: [...taken.values()] };
  }, [], 10_000);
  const [pick, setPick] = useState<string>();
  const [bought, setBought] = useState<string>();
  const a = useAction(() => { d.refresh(); setPick(undefined); });
  const peek = useSeatPeek();

  if (d.loading && !d.data) return <Loading what="Loading free seats" />;
  if (d.error && !d.data) return <ErrorBox error={d.error} retry={d.refresh} />;
  const { season, members, taken } = d.data!;
  const left = season.max_supply - season.memberships;
  const s = pick ? parseSeat(pick) : null;
  const cat = pick ? categoryOf(pick) : null;
  const price = pick ? priceFor(season.season_price, pick) : 0n;

  return (
    <div>
      <h1 className="text-4xl font-extrabold sm:text-5xl">Become a season member</h1>
      <p className="mt-2 max-w-3xl text-white/70">
        Pick your seat for the {season.name} season. Your membership is an NFT that owns its own NEAR account: it earns from every match and
        moves with the NFT if you ever sell. {left > 0 ? `${left} memberships left.` : "Sold out."}
      </p>
      <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_340px]">
        <section className="card p-4 sm:p-6">
          <div className="mb-3 flex flex-wrap justify-between gap-x-4 text-sm">
            <span className="font-display text-lg font-bold">Stars Arena · choose a seat</span>
            <span className="text-muted">Colour shows the category. Blue seats belong to members: tap one to see its card.</span>
          </div>
          <StadiumMap seats={taken} picked={pick} onPick={(seat) => { a.clear(); setBought(undefined); setPick(seat); }} onMember={peek.open} />
        </section>
        <aside className="card-glow h-fit p-5 lg:sticky lg:top-24" aria-label="Membership slip">
          <h2 className="text-lg font-bold">Season membership</h2>
          {bought && !pick && (
            <div className="mt-4 rounded-2xl border border-lime/60 bg-lime/10 p-4" role="status">
              <div className="font-semibold text-lime">✓ Welcome, member! seat-{bought} is yours.</div>
              <p className="mt-1 text-sm text-white/80">Its own account <span className="mono">seat-{bought}.{config.contractId}</span> was just created, with zero keys.</p>
              <a className="btn-primary mt-3" href={`#/member/seat-${bought}`}>Open my membership</a>
            </div>
          )}
          {!pick || !s ? (
            !bought && (
              <>
                <p className="mt-4 text-sm text-muted">Tap a free seat on the map. Where it is sets the price and its share of every payout.</p>
                <table className="mt-4 w-full text-sm">
                  <thead className="text-left text-xs text-muted"><tr><th className="pb-2 font-normal">Category</th><th className="pb-2 text-right font-normal">Season</th><th className="pb-2 text-right font-normal">Pool share</th></tr></thead>
                  <tbody>
                    {CATEGORY_ORDER.map((c) => (
                      <tr key={c} className="border-t border-line">
                        <td className="py-2"><span className="flex items-center gap-2"><span className={`size-3 shrink-0 rounded-sm ${CATEGORIES[c].swatch}`} /><span><span className="font-semibold">{CATEGORIES[c].label}</span><span className="block text-xs text-muted">{CATEGORIES[c].where}</span></span></span></td>
                        <td className="py-2 text-right align-top font-semibold tabular-nums">{usd((BigInt(season.season_price) * CATEGORIES[c].bps) / 10_000n, 0)}</td>
                        <td className="py-2 text-right align-top tabular-nums text-muted">{multiple(c)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            )
          ) : (
            <>
              <div className="mt-4 rounded-2xl border border-line p-3">
                <div className="flex items-start justify-between gap-2 font-semibold"><span>{standName(pick)} · Row {s.row} · Seat {s.number}</span><span className={`shrink-0 rounded-full border border-current px-2 py-0.5 text-[11px] font-bold uppercase ${CATEGORIES[cat!].text}`}>{CATEGORIES[cat!].label}</span></div>
                <div className="mono text-xs text-muted">seat-{pick}.{config.contractId}</div>
              </div>
              <ul className="mt-4 space-y-2 text-sm text-white/80">
                {PERKS.map((p) => <li key={p} className="flex gap-2"><span className="text-lime">✓</span>{p}</li>)}
              </ul>
              <div className="mt-4 flex justify-between border-t border-line pt-3 text-base font-bold"><span>Season price</span><span>{usd(price)} tUSDC</span></div>
              <p className="mt-1 text-xs text-muted">{CATEGORIES[cat!].label} seats pay {multiple(cat!)} the standard price and earn {multiple(cat!)} a standard share of every payout.</p>
              {accountId ? (
                <button className="btn-primary mt-4 w-full justify-center py-3" disabled={!!a.busy || left <= 0}
                  onClick={async () => {
                    const seat = pick;
                    if (await a.run("Buying membership", () => payTusdc(price.toString(), { action: "buy_new_membership", seat }))) setBought(seat);
                  }}>
                  Buy membership
                </button>
              ) : <button className="btn-primary mt-4 w-full justify-center py-3" onClick={signIn}>Connect wallet to buy</button>}
              <ActionStatus a={a} />
              <p className="mt-3 text-center text-xs text-muted">If the seat's account can't be created, the payment is refunded automatically.</p>
            </>
          )}
          <div className="mt-4"><Faucet /></div>
        </aside>
      </div>
      {peek.tokenId && <SeatPeek tokenId={peek.tokenId} known={members.find((x) => x.token_id === peek.tokenId)} onClose={peek.close} />}
    </div>
  );
}
