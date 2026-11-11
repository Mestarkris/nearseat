// Member dashboard: live match, live feed, earnings, Seat account side panel,
// and tabs for lending, advance and voting.
import { NewHere } from "../components/NewHere";
import { useState } from "react";
import { view, viewAccessKeys } from "../near/rpc";
import { useWallet, ONE_YOCTO } from "../near/wallet";
import { usePoll } from "../lib/usePoll";
import { useAction } from "../lib/useAction";
import type { HistoryEntry, Match, Membership, Poll, Season, Vendor } from "../lib/types";
import { useCountUp } from "../lib/motion";
import { Stamps } from "../components/MembershipCard";
import { matchMinute, seatLabel, shortDate, toRaw, usd } from "../lib/format";
import { Feed } from "../components/Feed";
import { MyTickets } from "../components/MyTickets";
import { ActionStatus } from "../components/ActionStatus";
import { CATEGORIES, multiple, priceFor } from "../lib/category";
import { GateAccess } from "../components/GateAccess";
import { Crest, Empty, ErrorBox, LiveBadge, Loading, Progress, Section, TierBadge } from "../components/ui";

type Tab = "overview" | "lending" | "spend" | "advance" | "vote" | "sell";

export function MemberPage({ tokenId }: { tokenId?: string }) {
  const { accountId, signIn } = useWallet();
  const mine = usePoll(
    () => (accountId ? view<Membership[]>("memberships_for_owner", { account_id: accountId }) : Promise.resolve([])),
    [accountId],
  );
  if (!accountId && !tokenId) {
    return (
      <Empty title="Connect your wallet to open your membership">
        <button className="btn-primary mt-4" onClick={signIn}>Connect wallet</button>
        <div className="mx-auto max-w-md text-left"><NewHere /></div>
        <p className="mt-4">No wallet? <a className="text-lime" href="#/verify/seat-c5-12">View a membership publicly</a>.</p>
      </Empty>
    );
  }
  if (mine.loading && !mine.data) return <Loading what="Finding your memberships" />;
  const chosen = tokenId ?? mine.data?.[0]?.token_id;
  if (!chosen) {
    return (
      <div className="space-y-6">
        {accountId && <MyTickets accountId={accountId} />}
        <Empty title="This account holds no season membership">
          <a className="text-lime" href="#/join">Buy one from the club</a>, buy one second-hand on the <a className="text-lime" href="#/market">market</a>, or pick a single-match ticket in <a className="text-lime" href="#/matches">Matches</a>.
        </Empty>
      </div>
    );
  }
  return (
    <>
      {mine.data && mine.data.length > 1 && (
        <div className="mb-4 flex flex-wrap gap-2">
          {mine.data.map((m) => (
            <a key={m.token_id} href={`#/member/${m.token_id}`} className={`chip ${m.token_id === chosen ? "border-lime text-lime" : ""}`}>{m.token_id}</a>
          ))}
        </div>
      )}
      <Dashboard tokenId={chosen} />
      {accountId && <div className="mt-6"><MyTickets accountId={accountId} /></div>}
    </>
  );
}

function Dashboard({ tokenId }: { tokenId: string }) {
  const { accountId } = useWallet();
  const [tab, setTab] = useState<Tab>("overview");
  const data = usePoll(async () => {
    const [m, matches, season] = await Promise.all([
      view<Membership | null>("membership", { token_id: tokenId }),
      view<Match[]>("get_matches"),
      view<Season>("season"),
    ]);
    return { m, matches, season };
  }, [tokenId]);

  if (data.loading && !data.data) return <Loading what="Reading your seat account" />;
  if (data.error && !data.data) return <ErrorBox error={data.error} retry={data.refresh} />;
  const { m, matches, season } = data.data!;
  if (!m) return <Empty title={`${tokenId} doesn't exist`} />;
  const isHolder = accountId === m.owner_id;
  const live = matches.find((x) => x.status === "Live");
  const next = matches.filter((x) => x.status === "Scheduled").sort((a, b) => Number(BigInt(a.kickoff_at) - BigInt(b.kickoff_at)))[0];

  const tabs: [Tab, string][] = [["overview", "Overview"], ["lending", "Seat lending"], ["spend", "Pay at the ground"], ["advance", "Advance"], ["vote", "Vote"], ["sell", "Sell"]];
  return (
    <div>
      {live && <LiveBadge label="MATCHDAY LIVE" />}
      <h1 className="mt-3 text-3xl font-extrabold sm:text-5xl">My membership · {seatLabel(m.seat)}</h1>
      <p className="mt-2 text-fg/70">Every ticket sold today pays into your seat's account in real time.</p>
      {!isHolder && (
        <p className="mt-3 rounded-xl border border-warn/40 bg-warn/10 p-3 text-sm text-warn">
          You're viewing {m.token_id}, held by {m.owner_id}. Actions are disabled. Only the current holder can act.
        </p>
      )}
      <div className="mt-5 flex flex-wrap gap-2" role="tablist">
        {tabs.map(([t, label]) => (
          <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)} className={tab === t ? "btn-primary" : "btn-ghost"}>
            {label}
          </button>
        ))}
        <a className="btn-ghost" href={`#/verify/${m.token_id}`}>History <span className="rounded-full bg-wine px-2 text-xs font-bold text-wine-ink">{m.history_len}</span></a>
        <a className="btn-ghost" href={`#/statement/${m.token_id}`}>Season statement</a>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_360px]">
        <div className="space-y-6">
          {tab === "overview" && <Overview m={m} live={live} next={next} season={season} isHolder={isHolder} />}
          {tab === "lending" && <Lending m={m} matches={matches} season={season} isHolder={isHolder} refresh={data.refresh} />}
          {tab === "spend" && <Spend m={m} isHolder={isHolder} refresh={data.refresh} />}
          {tab === "advance" && <Advance m={m} isHolder={isHolder} refresh={data.refresh} />}
          {tab === "vote" && <Vote m={m} isHolder={isHolder} />}
          {tab === "sell" && <Sell m={m} season={season} isHolder={isHolder} refresh={data.refresh} />}
        </div>
        <SeatAccount m={m} isHolder={isHolder} refresh={data.refresh} />
      </div>
    </div>
  );
}

function Overview({ m, live, next, season, isHolder }: { m: Membership; live?: Match; next?: Match; season: Season; isHolder: boolean }) {
  const legend = season.config.tier_thresholds[2];
  const cutBps = BigInt(season.config.members_cut_bps);
  // The pool is split by category weight, not equally.
  const totalWeight = BigInt(season.total_weight);
  const shareToday = live && totalWeight > 0n ? ((BigInt(live.escrow) * cutBps) / 10_000n) * BigInt(m.share_weight) / totalWeight : 0n;
  const rule = next && m.autolend_rules.find((r) => r.match_id === next.id);
  return (
    <>
      {live ? (
        <section className="card p-6">
          <div className="flex items-center justify-between"><LiveBadge /><span className="font-display text-lg font-bold text-lime">{matchMinute(live.started_at)}'</span></div>
          <div className="my-6 grid grid-cols-[1fr_auto_1fr] items-center gap-4 text-center">
            <div><div className="mx-auto w-fit"><Crest size={44} /></div><div className="mt-2 text-sm font-semibold">Illia Stars United</div></div>
            <div className="font-display text-5xl font-extrabold">{live.home_goals} – {live.away_goals}</div>
            <div><div className="mx-auto grid size-11 place-items-center rounded-full border-2 border-sky text-sky">≈</div><div className="mt-2 text-sm font-semibold">{live.opponent}</div></div>
          </div>
          <div className="space-y-3">
            <Progress label="Tickets sold today" value={live.tickets_sold} max={360} right={`${live.tickets_sold} of 360`} />
            <Progress label="Members' pool from today" value={Number((BigInt(live.escrow) * cutBps) / 10_000n)} max={Number(BigInt(live.ticket_price) * 360n * cutBps / 10_000n)} right={`${usd((BigInt(live.escrow) * cutBps) / 10_000n)} tUSDC`} />
            <Progress label="Your progress to Legend" value={m.attended.length} max={legend} right={`${m.attended.length} of ${legend} matches`} />
          </div>
          {m.goal_stamps.some((g) => g.match_id === live.id) && (
            <div className="mt-4 flex flex-wrap items-center gap-3 text-sm text-muted">
              <span>Stamped on your card today</span>
              <Stamps m={{ ...m, attended: [], goal_stamps: m.goal_stamps.filter((g) => g.match_id === live.id) }} />
            </div>
          )}
          <div className="mt-5 grid gap-3 sm:grid-cols-3">
            <div className="rounded-2xl border border-lime/60 p-3 text-center"><div className="text-xs text-muted">Your share today</div><div className="font-bold text-lime">+{usd(shareToday)} tUSDC</div></div>
            <div className="rounded-2xl border border-lime/60 p-3 text-center"><div className="text-xs text-muted">Next home game</div><div className="font-bold">{next ? `v ${next.opponent}` : "—"}</div></div>
            <div className="rounded-2xl border border-lime/60 p-3 text-center"><div className="text-xs text-muted">Auto-lend rule</div><div className="font-bold">{rule ? `On · ${rule.hours_before}h before` : m.season_autolend ? `Every match · ${m.season_autolend.hours_before}h before` : "Off"}</div></div>
          </div>
        </section>
      ) : (
        <section className="card p-6">
          <div className="label">Next home game</div>
          {next ? (
            <>
              <div className="mt-2 font-display text-2xl font-bold">Illia Stars United v {next.opponent}</div>
              <div className="text-sm text-muted">{shortDate(next.kickoff_at)} · {next.tickets_sold} tickets sold</div>
              {isHolder && <a className="btn-primary mt-4" href={`#/pass/${m.token_id}`}>Open gate pass</a>}
            </>
          ) : <p className="mt-2 text-muted">No fixtures scheduled.</p>}
        </section>
      )}

      <Section title="Live on-chain feed" right={<span className="text-xs text-muted">Read from the contract every 4 s</span>}>
        <Feed limit={6} filter={(_it, d) => !d.token_id || d.token_id === m.token_id || d.match_id !== undefined} />
        <p className="mt-3 rounded-xl bg-ink/70 p-3 text-xs text-muted">
          At full time: loans end, attendance is final, and your share of the members' pool pays into <span className="mono text-fg">{m.vault}</span>.
        </p>
      </Section>

      <Earnings tokenId={m.token_id} historyLen={m.history_len} />
    </>
  );
}

function Earnings({ tokenId, historyLen }: { tokenId: string; historyLen: number }) {
  const h = usePoll(() => view<HistoryEntry[]>("history", { token_id: tokenId, from_index: Math.max(0, historyLen - 100), limit: 100 }), [tokenId, historyLen], 15_000);
  const settled = (h.data ?? []).filter((e) => e.kind === "settled").slice(-8);
  const max = settled.reduce((a, e) => (BigInt(e.amount ?? 0) > a ? BigInt(e.amount ?? 0) : a), 1n);
  return (
    <Section title="Earned per payout" right={<span className="text-xs text-muted">tUSDC landed in the seat account</span>}>
      {settled.length === 0 ? <p className="text-sm text-muted">No payouts yet. They appear after the first full time.</p> : (
        <div className="flex h-48 items-end gap-3" role="img" aria-label="Bar chart of recent payouts">
          {settled.map((e, i) => {
            const v = BigInt(e.amount ?? 0);
            return (
              <div key={i} className="flex flex-1 flex-col items-center justify-end gap-1">
                <span className="text-xs text-muted">{usd(v, 1)}</span>
                <div className="w-full max-w-10 rounded-lg bg-wine" style={{ height: `${Math.max(6, Number((v * 100n) / max))}%` }} />
                <span className="text-[10px] text-muted">P{i + 1}</span>
              </div>
            );
          })}
        </div>
      )}
    </Section>
  );
}

function SeatAccount({ m, isHolder, refresh }: { m: Membership; isHolder: boolean; refresh: () => void }) {
  const { call, accountId } = useWallet();
  const a = useAction(refresh);
  const keys = usePoll(() => viewAccessKeys(m.vault).then((k) => k.length), [m.vault], 30_000);
  const frozen = !!m.listing || BigInt(m.debt) > 0n;
  // The balance rolls up to its new value when a payout lands.
  const balance = useCountUp(Number(m.vault_balance) / 1e6, true, 1200);
  const saved = BigInt(m.renewal_saved);
  return (
    <aside className="card-glow h-fit space-y-4 p-5 lg:sticky lg:top-24" aria-label="Seat account">
      <div className="flex items-center justify-between gap-2"><h2 className="text-lg font-bold">Seat account</h2><TierBadge tier={m.tier} /></div>
      <div className="flex items-center justify-between gap-3 rounded-2xl border border-line px-3 py-2.5 text-sm">
        <span><span className={`font-bold ${CATEGORIES[m.category].text}`}>{CATEGORIES[m.category].label}</span><span className="block text-xs text-muted">{CATEGORIES[m.category].where}</span></span>
        <span className="shrink-0 text-right"><span className="font-semibold">{multiple(m.category)} share</span><span className="block text-xs text-muted">of every payout</span></span>
      </div>
      <GateAccess m={m} />
      <div className="mono text-xs text-muted">{m.vault} · keys: {keys.data ?? "…"}</div>
      <div>
        <div className="text-sm text-muted">Balance</div>
        <div className="font-display text-5xl font-extrabold tabular-nums">{usd(BigInt(Math.round(balance * 1e6)))} <span className="text-base font-semibold text-muted">tUSDC</span></div>
        {BigInt(m.unsettled) > 0n && <div className="text-sm text-lime">+{usd(m.unsettled)} on its way</div>}
        {saved > 0n && <div className="text-sm text-muted">{usd(saved)} of it is set aside for renewal</div>}
      </div>
      <Renewal m={m} isHolder={isHolder} refresh={refresh} />
      <dl className="space-y-2 text-sm">
        {[
          ["Ticket-sales share", `+${usd(m.totals.pool_earned)}`],
          ["Seat lending", `+${usd(m.totals.loan_income)}`],
          ["Lending refunds", usd(m.totals.loan_refunds)],
          ["Advance owed", usd(m.debt)],
        ].map(([k, v]) => (
          <div key={k} className="flex justify-between rounded-xl bg-ink/70 px-3 py-2"><dt className="text-muted">{k}</dt><dd className="font-semibold text-lime">{v}</dd></div>
        ))}
      </dl>
      <div>
        <div className="label mb-2">Inventory inside</div>
        <div className="flex flex-wrap gap-2">
          <span className="chip">{m.passes_left} match passes</span>
          <span className="chip">{m.food_credits} food credits</span>
          <span className="chip">{m.attended.length} match stamps</span>
          <span className="chip">{m.goal_stamps.length} goal stamps</span>
        </div>
      </div>
      {isHolder ? (
        <div className="space-y-2">
          <button
            className="btn-primary w-full justify-center py-3"
            disabled={!!a.busy || frozen || BigInt(m.spendable) === 0n}
            onClick={() => a.run("Withdrawing", () => call("withdraw", { token_id: m.token_id, amount: m.spendable }, { deposit: ONE_YOCTO }), `Sent ${usd(m.spendable)} tUSDC to ${accountId}`)}
          >
            Withdraw {usd(m.spendable)} to {accountId}
          </button>
          {BigInt(m.unsettled) > 0n && (
            <button className="btn-ghost w-full justify-center" disabled={!!a.busy} onClick={() => a.run("Settling", () => call("settle", { token_id: m.token_id }, { gasTgas: 60 }), "Payout settled into your seat account")}>
              Settle {usd(m.unsettled)} now
            </button>
          )}
          <div className="grid grid-cols-2 gap-2">
            <a className="btn-ghost justify-center" href={`#/pass/${m.token_id}`}>Gate pass</a>
            <a className="btn-ghost justify-center" href="#/members">Members only</a>
          </div>
          {frozen && <p className="text-xs text-warn">{m.listing ? "Frozen while listed for sale." : "Withdrawals are blocked until the advance is repaid."}</p>}
          <ActionStatus a={a} />
        </div>
      ) : null}
      <p className="text-center text-xs text-muted">Only the current holder can act. Ownership is checked on-chain on every call.</p>
    </aside>
  );
}

/** How far the seat's own earnings go towards next season, and a switch to set part of each payout aside. */
function Renewal({ m, isHolder, refresh }: { m: Membership; isHolder: boolean; refresh: () => void }) {
  const { call } = useWallet();
  const a = useAction(refresh);
  const earned = BigInt(m.totals.pool_earned) + BigInt(m.totals.loan_income);
  const price = BigInt(m.season_price);
  const pct = price > 0n ? Number((earned * 1000n) / price) / 10 : 0;
  const frozen = !!m.listing;
  return (
    <div className="rounded-2xl border border-line p-3">
      <div className="text-sm font-semibold">This seat has earned {pct >= 100 ? "all" : `${pct.toFixed(pct < 10 ? 1 : 0)}%`} of next season's price</div>
      <div className="mt-2"><Progress value={Number(earned)} max={Number(price)} label={`${usd(earned)} of ${usd(price, 0)} tUSDC`} right={BigInt(m.renewal_saved) > 0n ? `${usd(m.renewal_saved)} set aside` : undefined} /></div>
      <div className="mt-3 text-xs text-muted" id="saving-label">Set aside from each payout</div>
      <div className="mt-1.5 grid grid-cols-4 gap-1.5" role="radiogroup" aria-labelledby="saving-label">
        {[0, 2500, 5000, 10000].map((bps) => {
          const on = m.renewal_bps === bps;
          return (
            <button key={bps} role="radio" aria-checked={on} disabled={!isHolder || on || frozen || !!a.busy}
              onClick={() => a.run("Updating", () => call("set_renewal_saving", { token_id: m.token_id, bps }, { deposit: ONE_YOCTO }), bps ? `${bps / 100}% of each payout will be set aside` : "Saving switched off. Everything set aside is free to use again")}
              className={`rounded-full border px-2 py-1.5 text-xs font-semibold disabled:cursor-default ${on ? "border-lime bg-wine text-wine-ink" : "border-line text-fg enabled:hover:bg-card-2 disabled:opacity-60"}`}>
              {bps ? `${bps / 100}%` : "Off"}
            </button>
          );
        })}
      </div>
      <p className="mt-2 text-xs text-muted">Money set aside stays in the seat's account and can't be withdrawn or spent until you choose Off. It stops at the season price.</p>
      <ActionStatus a={a} />
    </div>
  );
}

/** Pay a club-approved vendor straight from the seat's account. */
function Spend({ m, isHolder, refresh }: { m: Membership; isHolder: boolean; refresh: () => void }) {
  const { call } = useWallet();
  const a = useAction(refresh);
  const vendors = usePoll(() => view<Vendor[]>("vendors"), [], 30_000);
  const [to, setTo] = useState<string>();
  const [amount, setAmount] = useState("");
  const [memo, setMemo] = useState("");
  const list = vendors.data ?? [];
  const vendor = list.find((v) => v.account_id === to) ?? list[0];
  const spendable = BigInt(m.spendable);
  const raw = (() => { try { return BigInt(toRaw(amount)); } catch { return 0n; } })();
  const blocked = m.listing ? "The seat's account is frozen while the membership is listed for sale." : BigInt(m.debt) > 0n ? "Payments are blocked until the advance is repaid." : null;
  const problem = !amount ? null : raw <= 0n ? "Enter an amount like 4.50" : raw > spendable ? `This seat can spend up to ${usd(spendable)} tUSDC` : null;
  return (
    <Section title="Pay at the ground" right={<span className="text-xs text-muted">Spent so far: {usd(m.vendor_spent)} tUSDC</span>}>
      <p className="text-sm text-muted">Pay for food and drink with what the seat has earned. The money goes from the seat's account straight to the vendor, and only to vendors the club has approved.</p>
      <div className="mt-4 rounded-2xl bg-ink/70 p-4">
        <div className="text-xs text-muted">This seat can spend</div>
        <div className="font-display text-2xl font-bold">{usd(spendable)} tUSDC</div>
        {BigInt(m.renewal_saved) > 0n && <div className="text-xs text-muted">{usd(m.renewal_saved)} more is set aside for renewal</div>}
      </div>
      {vendors.loading && !vendors.data ? <Loading what="Loading vendors" /> : list.length === 0 ? (
        <p className="mt-4 text-sm text-muted">The club hasn't approved any vendors yet.</p>
      ) : (
        <>
          <div className="mt-4 grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="Vendor">
            {list.map((v) => (
              <button key={v.account_id} role="radio" aria-checked={vendor?.account_id === v.account_id} onClick={() => setTo(v.account_id)}
                className={`rounded-2xl border p-3 text-left ${vendor?.account_id === v.account_id ? "border-lime bg-wine/10" : "border-line hover:bg-card-2"}`}>
                <div className="font-semibold">{v.name}</div>
                <div className="mono truncate text-xs text-muted">{v.account_id}</div>
              </button>
            ))}
          </div>
          {isHolder && vendor && (
            <div className="mt-3 grid gap-2 sm:grid-cols-[140px_1fr_auto]">
              <input className="input" inputMode="decimal" placeholder="Amount" aria-label="Amount in tUSDC" value={amount} onChange={(e) => setAmount(e.target.value)} />
              <input className="input" maxLength={80} placeholder="What for (optional)" aria-label="Note for the vendor" value={memo} onChange={(e) => setMemo(e.target.value)} />
              <button className="btn-primary justify-center" disabled={!!a.busy || !!blocked || !!problem || raw <= 0n}
                onClick={() => a.run("Paying", () => call("pay_vendor", { token_id: m.token_id, vendor_id: vendor.account_id, amount: raw.toString(), memo: memo.trim() || null }, { deposit: ONE_YOCTO, gasTgas: 100 }), `Paid ${usd(raw)} tUSDC to ${vendor.name}`).then((ok) => { if (ok) { setAmount(""); setMemo(""); } })}>
                Pay {vendor.name}
              </button>
            </div>
          )}
          {(blocked || problem) && <p className="mt-2 text-xs text-warn">{blocked ?? problem}</p>}
        </>
      )}
      <ActionStatus a={a} />
    </Section>
  );
}

const RULE_HOURS = [3, 12, 24, 48, 72];

/** One rule for the whole season: any match the holder has not checked in for is offered automatically. */
function SeasonRule({ m, capBps, isHolder, refresh }: { m: Membership; capBps: number; isHolder: boolean; refresh: () => void }) {
  const { call } = useWallet();
  const a = useAction(refresh);
  const rule = m.season_autolend;
  const [hours, setHours] = useState(rule?.hours_before ?? 24);
  const [bps, setBps] = useState(Math.min(rule?.price_bps ?? 10_000, capBps));
  const prices = [5_000, 7_500, 10_000, 12_500, 15_000].filter((b) => b <= capBps);
  const pick = (on: boolean) => `rounded-full border px-3 py-1.5 text-sm transition-colors ${on ? "border-lime bg-wine text-wine-ink" : "border-line text-muted hover:text-fg"}`;
  if (!isHolder && !rule) return null;
  return (
    <Section title="Lend every match I miss" right={<span className={`chip ${rule ? "border-lime text-lime" : ""}`}>{rule ? "On" : "Off"}</span>}>
      <p className="text-sm text-muted">
        Set this once. Before each home match, if you have not checked in, your seat is offered to other fans at the price you choose. Check in, or keep a match below, and the seat stays yours. The rule ends if the membership changes hands.
      </p>
      {rule && (
        <p className="mt-3 text-sm">
          Now: offered <b>{rule.hours_before} hours</b> before kickoff at <b>{rule.price_bps / 100}%</b> of the ticket price for your seat.
        </p>
      )}
      {isHolder && (
        <>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <div>
              <div className="mb-2 text-xs text-muted">Offer the seat this long before kickoff</div>
              <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Hours before kickoff">
                {RULE_HOURS.map((h) => <button key={h} type="button" role="radio" aria-checked={h === hours} className={pick(h === hours)} onClick={() => setHours(h)}>{h}h</button>)}
              </div>
            </div>
            <div>
              <div className="mb-2 text-xs text-muted">Price, as a share of the ticket price</div>
              <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Price as a share of the ticket price">
                {prices.map((b) => <button key={b} type="button" role="radio" aria-checked={b === bps} className={pick(b === bps)} onClick={() => setBps(b)}>{b / 100}%</button>)}
              </div>
            </div>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <button className="btn-primary" disabled={!!a.busy || !!m.listing || (!!rule && rule.hours_before === hours && rule.price_bps === bps)}
              onClick={() => a.run("Saving rule", () => call("set_season_autolend", { token_id: m.token_id, hours_before: hours, price_bps: bps }, { deposit: ONE_YOCTO }), `Your seat will be offered ${hours}h before any match you miss`)}>
              {rule ? "Save changes" : "Turn on"}
            </button>
            {rule && (
              <button className="btn-ghost" disabled={!!a.busy}
                onClick={() => a.run("Turning off", () => call("clear_season_autolend", { token_id: m.token_id }, { deposit: ONE_YOCTO }), "Season lending turned off")}>
                Turn off
              </button>
            )}
          </div>
          {m.listing && <p className="mt-2 text-xs text-warn">The membership is listed for sale, so its lending rules are paused.</p>}
        </>
      )}
      <ActionStatus a={a} />
    </Section>
  );
}

function Lending({ m, matches, season, isHolder, refresh }: { m: Membership; matches: Match[]; season: Season; isHolder: boolean; refresh: () => void }) {
  const { call } = useWallet();
  const a = useAction(refresh);
  const [price, setPrice] = useState<Record<number, string>>({});
  const [to, setTo] = useState<Record<number, string>>({});
  const upcoming = matches.filter((x) => x.status === "Scheduled");
  const seasonRule = m.season_autolend;
  const ruleCard = <SeasonRule m={m} capBps={season.config.lend_cap_bps} isHolder={isHolder} refresh={refresh} />;
  if (!upcoming.length) return <>{ruleCard}<Empty title="No upcoming matches to lend for" /></>;
  return (
    <>
    {ruleCard}
    <Section title="Lend your seat for one match">
      <p className="mb-4 text-sm text-muted">The renter gets the gate pass for that match only. You earn the price minus a 5% club fee, paid into your seat account at full time. Prices are capped at 1.5× what the club charges for a seat of your category.</p>
      <ul className="space-y-4">
        {upcoming.map((x) => {
          const loan = m.loans.find((l) => l.match_id === x.id)?.loan;
          // 1.5x what the club charges for a seat of this category.
          const face = priceFor(x.ticket_price, m.seat);
          const cap = (face * 15n) / 10n;
          const rule = m.autolend_rules.find((r) => r.match_id === x.id);
          return (
            <li key={x.id} className="rounded-2xl border border-line p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div><div className="font-semibold">v {x.opponent}</div><div className="text-xs text-muted">{shortDate(x.kickoff_at)} · cap {usd(cap)} tUSDC</div></div>
                {loan && "Rented" in loan && <span className="chip border-lime text-lime">Rented by {loan.Rented.renter} · {usd(loan.Rented.price)}</span>}
                {loan && "Offered" in loan && <span className="chip">Offered at {usd(loan.Offered.price)}{loan.Offered.to ? ` to ${loan.Offered.to}` : ""}</span>}
              </div>
              {isHolder && !loan && (
                <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
                  <input className="input" inputMode="decimal" placeholder={`Price (max ${usd(cap)})`} aria-label="Lend price in tUSDC" value={price[x.id] ?? ""} onChange={(e) => setPrice({ ...price, [x.id]: e.target.value })} />
                  <input className="input" placeholder="Only for (optional) friend.testnet" aria-label="Private renter account" value={to[x.id] ?? ""} onChange={(e) => setTo({ ...to, [x.id]: e.target.value })} />
                  <button className="btn-primary justify-center" disabled={!!a.busy} onClick={() => a.run("Lending", () => call("lend", { token_id: m.token_id, match_id: x.id, price: toRaw(price[x.id] ?? ""), to: to[x.id] || null }, { deposit: ONE_YOCTO }), "Seat offered")}>Lend</button>
                </div>
              )}
              {isHolder && loan && "Offered" in loan && (
                <button className="btn-ghost mt-3" disabled={!!a.busy} onClick={() => a.run("Cancelling", () => call("cancel_lend", { token_id: m.token_id, match_id: x.id }, { deposit: ONE_YOCTO }))}>Cancel offer</button>
              )}
              {isHolder && !loan && !rule && seasonRule && (
                <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
                  {seasonRule.skip.includes(x.id) ? (
                    <>
                      <span className="chip border-lime text-lime">You are keeping this one</span>
                      <button className="btn-ghost" disabled={!!a.busy} onClick={() => a.run("Releasing", () => call("skip_autolend", { token_id: m.token_id, match_id: x.id, skip: false }, { deposit: ONE_YOCTO }), "Your season rule covers this match again")}>Let the rule lend it</button>
                    </>
                  ) : (
                    <>
                      <span className="chip">Season rule: offered {seasonRule.hours_before}h before at {usd((face * BigInt(Math.min(seasonRule.price_bps, season.config.lend_cap_bps))) / 10_000n)}</span>
                      <button className="btn-ghost" disabled={!!a.busy} onClick={() => a.run("Keeping the seat", () => call("skip_autolend", { token_id: m.token_id, match_id: x.id, skip: true }, { deposit: ONE_YOCTO }), "The seat stays yours for this match")}>I'm coming to this one</button>
                    </>
                  )}
                </div>
              )}
              {isHolder && !loan && (!seasonRule || rule) && (
                <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
                  <span className="text-muted">Auto-lend:</span>
                  {rule ? (
                    <>
                      <span className="chip">if not checked in {rule.hours_before}h before → {usd(rule.price)}</span>
                      <button className="btn-ghost" onClick={() => a.run("Clearing rule", () => call("clear_autolend", { token_id: m.token_id, match_id: x.id }, { deposit: ONE_YOCTO }))}>Clear</button>
                    </>
                  ) : (
                    <button className="btn-ghost" disabled={!!a.busy} onClick={() => a.run("Setting auto-lend", () => call("set_autolend", { token_id: m.token_id, match_id: x.id, hours_before: 3, price: toRaw(price[x.id] || usd(face).replace(/,/g, "")) }, { deposit: ONE_YOCTO }), "Auto-lend rule set (3h before kickoff)")}>
                      Lend automatically if I'm not in 3h before
                    </button>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>
      <ActionStatus a={a} />
    </Section>
    </>
  );
}

function Advance({ m, isHolder, refresh }: { m: Membership; isHolder: boolean; refresh: () => void }) {
  const { call } = useWallet();
  const a = useAction(refresh);
  const cap = usePoll(() => view<string>("advance_cap", { token_id: m.token_id }), [m.token_id, m.debt]);
  const [amount, setAmount] = useState("");
  return (
    <Section title="Advance on future earnings">
      <p className="text-sm text-muted">Borrow up to 50% of your expected remaining-season share. Every payout repays the advance first. While it's open you can't withdraw, and a sale repays it from the price in the same transaction.</p>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <div className="rounded-2xl bg-ink/70 p-4"><div className="text-xs text-muted">You can borrow</div><div className="font-display text-2xl font-bold">{cap.data ? usd(cap.data) : "…"} tUSDC</div></div>
        <div className="rounded-2xl bg-ink/70 p-4"><div className="text-xs text-muted">Owed now</div><div className="font-display text-2xl font-bold">{usd(m.debt)} tUSDC</div></div>
      </div>
      {isHolder && (
        <div className="mt-4 flex gap-2">
          <input className="input" inputMode="decimal" placeholder="Amount in tUSDC" aria-label="Advance amount" value={amount} onChange={(e) => setAmount(e.target.value)} />
          <button className="btn-primary" disabled={!!a.busy} onClick={() => a.run("Borrowing", () => call("borrow", { token_id: m.token_id, amount: toRaw(amount) }, { deposit: ONE_YOCTO }), "Advance sent to your wallet")}>Borrow</button>
        </div>
      )}
      <ActionStatus a={a} />
    </Section>
  );
}

function Vote({ m, isHolder }: { m: Membership; isHolder: boolean }) {
  const { call } = useWallet();
  const polls = usePoll(() => view<Poll[]>("get_polls"), []);
  const a = useAction(polls.refresh);
  if (polls.loading && !polls.data) return <Loading />;
  if (!polls.data?.length) return <Empty title="No polls right now" />;
  return (
    <Section title="Member votes">
      <p className="mb-4 text-sm text-muted">Voting power = verified matches attended before the poll opened. One vote per membership per poll, even after a sale.</p>
      {polls.data.map((p) => <PollCard key={p.id} p={p} m={m} isHolder={isHolder} onVote={(i) => a.run("Voting", () => call("vote", { token_id: m.token_id, poll_id: p.id, option: i }, { deposit: ONE_YOCTO }), "Vote recorded")} />)}
      <ActionStatus a={a} />
    </Section>
  );
}

function PollCard({ p, m, isHolder, onVote }: { p: Poll; m: Membership; isHolder: boolean; onVote: (i: number) => void }) {
  const st = usePoll(async () => ({
    voted: await view<boolean>("has_voted", { poll_id: p.id, token_id: m.token_id }),
    weight: await view<number>("vote_weight", { poll_id: p.id, token_id: m.token_id }),
  }), [p.id, m.token_id, p.voters]);
  const total = p.tallies.reduce((s, t) => s + t, 0) || 1;
  return (
    <div className="mb-4 rounded-2xl border border-line p-4">
      <div className="font-semibold">{p.question}</div>
      <div className="text-xs text-muted">{p.voters} memberships voted · your weight {st.data?.weight ?? "…"}{st.data?.voted ? " · voted ✓" : ""}</div>
      <div className="mt-3 space-y-2">
        {p.options.map((o, i) => (
          <div key={o} className="flex items-center gap-3">
            <div className="flex-1"><Progress label={o} value={p.tallies[i]} max={total} right={p.tallies[i]} /></div>
            {isHolder && !st.data?.voted && <button className="btn-ghost" disabled={!st.data?.weight} onClick={() => onVote(i)}>Vote</button>}
          </div>
        ))}
      </div>
    </div>
  );
}

function Sell({ m, season, isHolder, refresh }: { m: Membership; season: Season; isHolder: boolean; refresh: () => void }) {
  const { call } = useWallet();
  const a = useAction(refresh);
  const [price, setPrice] = useState("");
  return (
    <Section title="Sell this membership">
      <p className="text-sm text-muted">
        Listing freezes the seat account: no withdrawals, loans or advances until it sells or you delist. The buyer pays exactly your price and gets the balance,
        passes, history and gate access in one transaction. You receive the price minus a {season.config.resale_fee_bps / 100}% club royalty
        {BigInt(m.debt) > 0n ? ` and your ${usd(m.debt)} tUSDC advance` : ""}. Cap for a {CATEGORIES[m.category].label} seat: {usd(m.resale_cap)} tUSDC.
      </p>
      {m.listing ? (
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <span className="chip border-lime text-lime">Listed at {usd(m.listing.price)} tUSDC</span>
          {isHolder && <button className="btn-ghost" disabled={!!a.busy} onClick={() => a.run("Delisting", () => call("delist", { token_id: m.token_id }, { deposit: ONE_YOCTO }))}>Delist</button>}
        </div>
      ) : isHolder ? (
        <div className="mt-4 flex gap-2">
          <input className="input" inputMode="decimal" placeholder={`Price (max ${usd(m.resale_cap)})`} aria-label="Sale price" value={price} onChange={(e) => setPrice(e.target.value)} />
          <button className="btn-primary" disabled={!!a.busy} onClick={() => a.run("Listing", () => call("list", { token_id: m.token_id, price: toRaw(price) }, { deposit: ONE_YOCTO }), "Listed on the market")}>List</button>
        </div>
      ) : null}
      <ActionStatus a={a} />
    </Section>
  );
}
