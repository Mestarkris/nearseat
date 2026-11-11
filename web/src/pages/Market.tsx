// Second-hand memberships. The buyer pins the vault nonce they inspected; if the
// seller changes anything before the purchase lands, it reverts and refunds.
import { view } from "../near/rpc";
import { useWallet } from "../near/wallet";
import { usePoll } from "../lib/usePoll";
import { useAction } from "../lib/useAction";
import type { Membership, Season } from "../lib/types";
import { seatLabel, usd } from "../lib/format";
import { CATEGORIES } from "../lib/category";
import { ActionStatus } from "../components/ActionStatus";
import { Faucet } from "../components/Faucet";
import { Empty, ErrorBox, Loading, TierBadge } from "../components/ui";

export function MarketPage() {
  const d = usePoll(async () => ({
    all: await view<Membership[]>("memberships", { limit: 100 }),
    season: await view<Season>("season"),
  }), []);
  if (d.loading && !d.data) return <Loading what="Loading listings" />;
  if (d.error && !d.data) return <ErrorBox error={d.error} retry={d.refresh} />;
  const listed = d.data!.all.filter((m) => m.listing);
  return (
    <div>
      <h1 className="text-4xl font-extrabold sm:text-5xl">Membership market</h1>
      <p className="mt-2 max-w-3xl text-fg/70">
        Buy a season membership second-hand. You get the seat, its account balance, remaining passes, attendance record and gate access in one transaction.
        Every listing is capped at {d.data!.season.config.resale_cap_bps / 100}% of what a seat of its category costs from the club, so touts can't gouge.
      </p>
      <div className="mt-4 max-w-md"><Faucet /></div>
      <div className="mt-6 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {listed.length === 0 ? <div className="md:col-span-3"><Empty title="Nothing listed right now">Holders list from the Sell tab of their membership. Or <a className="text-lime" href="#/join">buy a new one from the club</a>.</Empty></div> :
          listed.map((m) => <Listing key={m.token_id} m={m} refresh={d.refresh} />)}
      </div>
    </div>
  );
}

function Listing({ m, refresh }: { m: Membership; refresh: () => void }) {
  const { accountId, signIn, payTusdc } = useWallet();
  const a = useAction(refresh);
  return (
    <article className="card p-5">
      <div className="flex items-center justify-between"><span className="font-display text-xl font-bold">{m.token_id}</span><TierBadge tier={m.tier} /></div>
      <div className="text-sm text-muted">{seatLabel(m.seat)} · held by {m.owner_id}</div>
      <div className="mt-1 text-sm"><span className={`font-semibold ${CATEGORIES[m.category].text}`}>{CATEGORIES[m.category].label}</span> <span className="text-muted">· {m.share_weight / 4}x a standard share · {usd(m.season_price, 0)} tUSDC new from the club</span></div>
      <dl className="mt-4 grid grid-cols-2 gap-2 text-sm">
        <div className="rounded-xl bg-ink/70 p-2"><dt className="text-xs text-muted">Vault balance</dt><dd className="font-semibold">{usd(m.vault_balance)}</dd></div>
        <div className="rounded-xl bg-ink/70 p-2"><dt className="text-xs text-muted">Unsettled</dt><dd className="font-semibold">{usd(m.unsettled)}</dd></div>
        <div className="rounded-xl bg-ink/70 p-2"><dt className="text-xs text-muted">Passes left</dt><dd className="font-semibold">{m.passes_left}</dd></div>
        <div className="rounded-xl bg-ink/70 p-2"><dt className="text-xs text-muted">Attended</dt><dd className="font-semibold">{m.attended.length}</dd></div>
      </dl>
      <div className="mt-3 text-xs text-muted">State nonce <span className="mono">{m.nonce}</span> · <a className="text-lime" href={`#/verify/${m.token_id}`}>full history</a></div>
      <div className="mt-4 flex items-center justify-between">
        <span className="font-display text-2xl font-bold">{usd(m.listing!.price)} <span className="text-sm text-muted">tUSDC</span></span>
        {accountId ? (
          <button className="btn-primary" disabled={!!a.busy || accountId === m.owner_id}
            onClick={() => a.run("Buying", () => payTusdc(m.listing!.price, { action: "buy_membership", token_id: m.token_id, expected_nonce: m.nonce }), `${m.token_id} is yours, with everything inside`)}>
            Buy
          </button>
        ) : <button className="btn-primary" onClick={signIn}>Connect to buy</button>}
      </div>
      <ActionStatus a={a} />
    </article>
  );
}
