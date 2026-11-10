// Member dashboard: live match, live feed, earnings, Seat account side panel,
// and tabs for lending, advance and voting.
import { useState } from "react";
import { view, viewAccessKeys } from "../near/rpc";
import { useWallet, ONE_YOCTO } from "../near/wallet";
import { usePoll } from "../lib/usePoll";
import { useAction } from "../lib/useAction";
import type { HistoryEntry, Match, Membership, Poll, Season } from "../lib/types";
import { matchMinute, seatLabel, shortDate, toRaw, usd } from "../lib/format";
import { Feed } from "../components/Feed";
import { MyTickets } from "../components/MyTickets";
import { ActionStatus } from "../components/ActionStatus";
import { CATEGORIES, multiple, priceFor } from "../lib/category";
import { GateAccess } from "../components/GateAccess";
import { Crest, Empty, ErrorBox, LiveBadge, Loading, Progress, Section, TierBadge } from "../components/ui";

type Tab = "overview" | "lending" | "advance" | "vote" | "sell";

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

  const tabs: [Tab, string][] = [["overview", "Overview"], ["lending", "Seat lending"], ["advance", "Advance"], ["vote", "Vote"], ["sell", "Sell"]];
  return (
    <div>
      {live && <LiveBadge label="MATCHDAY LIVE" />}
      <h1 className="mt-3 text-3xl font-extrabold sm:text-5xl">My membership · {seatLabel(m.seat)}</h1>
      <p className="mt-2 text-white/70">Every ticket sold today pays into your seat's account in real time.</p>
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
        <a className="btn-ghost" href={`#/verify/${m.token_id}`}>History <span className="rounded-full bg-lime px-2 text-xs font-bold text-ink">{m.history_len}</span></a>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_360px]">
        <div className="space-y-6">
          {tab === "overview" && <Overview m={m} live={live} next={next} season={season} isHolder={isHolder} />}
          {tab === "lending" && <Lending m={m} matches={matches} isHolder={isHolder} refresh={data.refresh} />}
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
          <div className="mt-5 grid gap-3 sm:grid-cols-3">
            <div className="rounded-2xl border border-lime/60 p-3 text-center"><div className="text-xs text-muted">Your share today</div><div className="font-bold text-lime">+{usd(shareToday)} tUSDC</div></div>
            <div className="rounded-2xl border border-lime/60 p-3 text-center"><div className="text-xs text-muted">Next home game</div><div className="font-bold">{next ? `v ${next.opponent}` : "—"}</div></div>
            <div className="rounded-2xl border border-lime/60 p-3 text-center"><div className="text-xs text-muted">Auto-lend rule</div><div className="font-bold">{rule ? `On · ${rule.hours_before}h before` : "Off"}</div></div>
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
          At full time: loans end, attendance is final, and your share of the members' pool pays into <span className="mono text-white">{m.vault}</span>.
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
                <div className="w-full max-w-10 rounded-lg bg-lime" style={{ height: `${Math.max(6, Number((v * 100n) / max))}%` }} />
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
        <div className="font-display text-5xl font-extrabold">{usd(m.vault_balance)} <span className="text-base font-semibold text-muted">tUSDC</span></div>
        {BigInt(m.unsettled) > 0n && <div className="text-sm text-lime">+{usd(m.unsettled)} on its way</div>}
      </div>
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
            disabled={!!a.busy || frozen || BigInt(m.vault_balance) === 0n}
            onClick={() => a.run("Withdrawing", () => call("withdraw", { token_id: m.token_id, amount: m.vault_balance }, { deposit: ONE_YOCTO }), `Sent ${usd(m.vault_balance)} tUSDC to ${accountId}`)}
          >
            Withdraw to {accountId}
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

function Lending({ m, matches, isHolder, refresh }: { m: Membership; matches: Match[]; isHolder: boolean; refresh: () => void }) {
  const { call } = useWallet();
  const a = useAction(refresh);
  const [price, setPrice] = useState<Record<number, string>>({});
  const [to, setTo] = useState<Record<number, string>>({});
  const upcoming = matches.filter((x) => x.status === "Scheduled");
  if (!upcoming.length) return <Empty title="No upcoming matches to lend for" />;
  return (
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
              {isHolder && !loan && (
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
