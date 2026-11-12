// Club dashboard: season totals, fixtures, Matchday control, payout progress.
// Matchday buttons are club-only contract calls; anyone else is refused on-chain.
import { useState } from "react";
import { view } from "../near/rpc";
import { useWallet } from "../near/wallet";
import { usePoll } from "../lib/usePoll";
import { useAction } from "../lib/useAction";
import type { Match, Season, Vendor } from "../lib/types";
import { matchMinute, shortDate, toRaw, usd } from "../lib/format";
import { config, SYM } from "../config";
import { downloadClubPayments, downloadFixtureSummary } from "../lib/exports";
import { ActionStatus } from "../components/ActionStatus";
import { Feed } from "../components/Feed";
import { ErrorBox, LiveBadge, Loading, Progress, Section, Stat } from "../components/ui";

const STATUS_STYLE: Record<string, string> = {
  Scheduled: "bg-sky/20 text-sky",
  Live: "bg-wine text-wine-ink",
  Finished: "bg-fg/10 text-fg",
  Postponed: "bg-warn/20 text-warn",
};

export function ClubPage() {
  const d = usePoll(async () => ({ season: await view<Season>("season"), matches: await view<Match[]>("get_matches") }), []);
  if (d.loading && !d.data) return <Loading what="Loading the club's books" />;
  if (d.error && !d.data) return <ErrorBox error={d.error} retry={d.refresh} />;
  const { season, matches } = d.data!;
  // Seats are priced by category, so read the takings from the contract: the
  // escrow while a match is open, and the members' cut scaled back up once it is paid out.
  const takings = (m: Match) => (m.status === "Finished" ? (BigInt(m.members_cut) * 10_000n) / BigInt(season.config.members_cut_bps) : BigInt(m.escrow));
  const revenue = matches.reduce((s, m) => s + takings(m), 0n);
  const refunded = matches.reduce((s, m) => s + m.refunds_done, 0);
  const lent = matches.reduce((s, m) => s + m.seats_rented, 0);
  return (
    <div>
      <h1 className="text-4xl font-extrabold sm:text-5xl">Illia Stars United · Club dashboard</h1>
      <p className="mt-2 text-fg/70">Ticket sales, member payouts and refunds, settled in stablecoins with no spreadsheets.</p>
      <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Ticket revenue this season" value={`${usd(revenue, 0)} ${SYM}`} sub={`${matches.length} fixtures`} />
        <Stat label="Paid to member accounts" value={usd(season.pool_total_distributed, 0)} sub={`${season.memberships} memberships`} />
        <Stat label="Refunded automatically" value={refunded} sub={`${matches.filter((m) => m.status === "Postponed").length} postponed`} />
        <Stat label="Seats lent by members" value={lent} sub="this season" />
      </div>
      <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_360px]">
        <div className="space-y-6">
          <Section title="Fixtures" right={<ClubExports matches={matches} season={season} />}>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[560px] text-left text-sm">
                <thead className="text-xs text-muted"><tr><th className="py-2">Match</th><th>Seats sold</th><th>Revenue</th><th>To members (5%)</th><th>Status</th></tr></thead>
                <tbody className="divide-y divide-line">
                  {matches.map((m) => (
                    <tr key={m.id}>
                      <td className="py-3"><div className="font-semibold">vs {m.opponent}</div><div className="text-xs text-muted">{shortDate(m.kickoff_at)}</div></td>
                      <td className="w-40 pr-4"><Progress value={m.tickets_sold} max={360} /><span className="text-xs text-muted">{m.tickets_sold} / 360</span></td>
                      <td>{usd(takings(m), 0)}</td>
                      <td className="text-lime">{m.status === "Finished" ? usd(m.members_cut) : "—"}</td>
                      <td><span className={`rounded-full px-3 py-1 text-xs font-semibold ${STATUS_STYLE[m.status]}`}>{m.status === "Finished" && season.round_settled < season.memberships ? "Paying out" : m.status}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Section>
          <Section title="Club feed"><Feed limit={10} /></Section>
        </div>
        <div className="space-y-6">
          <MatchdayControl matches={matches} refresh={d.refresh} />
          <Payout season={season} refresh={d.refresh} />
          <ClubTools season={season} refresh={d.refresh} />
          <Vendors />
          <section className="card p-5 opacity-80">
            <h2 className="text-lg font-bold">Sponsor drop</h2>
            <p className="mt-2 text-sm text-muted">Tier-filtered vouchers sent into seat accounts. On the roadmap: not built for this submission.</p>
          </section>
        </div>
      </div>
    </div>
  );
}

/** The club's books as CSV files: one row per payment, and one row per fixture. */
function ClubExports({ matches, season }: { matches: Match[]; season: Season }) {
  const [note, setNote] = useState<string>();
  const payments = async () => {
    setNote("Reading payments");
    try { setNote(`Downloaded ${await downloadClubPayments(matches, season)} payments`); }
    catch (e) { setNote(`Could not build the file: ${String((e as Error).message ?? e).slice(0, 100)}`); }
  };
  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      {note && <span className="text-xs text-muted" role="status">{note}</span>}
      <button className="btn-ghost" onClick={payments}>Payments CSV</button>
      <button className="btn-ghost" onClick={() => setNote(`Downloaded ${downloadFixtureSummary(matches, season)} fixtures`)}>Fixtures CSV</button>
    </div>
  );
}

function MatchdayControl({ matches, refresh }: { matches: Match[]; refresh: () => void }) {
  const { accountId, call } = useWallet();
  const a = useAction(refresh);
  const [scorer, setScorer] = useState("");
  const [chosen, setChosen] = useState<number>();
  const [confirmPostpone, setConfirmPostpone] = useState(false);
  // Only fixtures that matchday actions can still apply to.
  const open = matches.filter((x) => x.status === "Live" || x.status === "Scheduled");
  const m = open.find((x) => x.id === chosen) ?? open.find((x) => x.status === "Live") ?? open[0];
  const isClub = accountId === config.clubId;
  if (!m) return null;
  const run = (label: string, method: string, args: object) => a.run(label, () => call(method, { match_id: m.id, ...args }), `${label} recorded on-chain`);
  // The scorer is optional; the contract needs a name, so fall back to the team's.
  const goal = (side: "Home" | "Away", team: string) => {
    const name = scorer.trim() || team;
    run(`Goal · ${team}`, "goal", { side, scorer: name.slice(0, 32) }).then((ok) => ok && setScorer(""));
  };
  const refunds = m.payment_count;
  return (
    <section className="card p-5">
      <div className="flex items-center justify-between"><h2 className="text-lg font-bold">Matchday control</h2>{m.status === "Live" && <LiveBadge label={`LIVE ${matchMinute(m.started_at)}'`} />}</div>
      {open.length > 1 && (
        <select className="input mt-3" value={m.id} onChange={(e) => { setChosen(Number(e.target.value)); setConfirmPostpone(false); a.clear(); }} aria-label="Fixture to control">
          {open.map((x) => <option key={x.id} value={x.id}>v {x.opponent} · {x.status === "Live" ? "LIVE" : shortDate(x.kickoff_at)}</option>)}
        </select>
      )}
      <div className="mt-3 flex items-center justify-between rounded-2xl bg-ink/70 px-4 py-3 font-semibold">
        <span>Illia Stars</span><span className="font-display text-2xl">{m.home_goals} – {m.away_goals}</span><span>{m.opponent}</span>
      </div>
      {!isClub ? (
        <p className="mt-3 rounded-xl border border-warn/40 bg-warn/10 p-3 text-xs text-warn">
          Read-only: you're connected as {accountId ?? "nobody"}. Only {config.clubId} can run matchday, and the contract refuses anyone else.
          Try it yourself in the Attack Lab ("Fake a goal stamp").
        </p>
      ) : (
        <>
          <input className="input mt-3" value={scorer} maxLength={32} onChange={(e) => setScorer(e.target.value)} aria-label="Goal scorer (optional)" placeholder="Goal scorer (optional)" />
          <div className="mt-3 grid grid-cols-2 gap-2">
            <button className="btn-ghost justify-center" disabled={m.status !== "Scheduled" || !!a.busy} onClick={() => run("Kickoff", "kickoff", {})}>Kickoff{m.status === "Live" ? " ✓" : ""}</button>
            <button className="btn-primary justify-center" disabled={m.status !== "Live" || !!a.busy} onClick={() => goal("Home", "Illia Stars")}>Goal · Illia Stars</button>
            <button className="btn-ghost justify-center" disabled={m.status !== "Live" || !!a.busy} onClick={() => goal("Away", m.opponent)}>Goal · {m.opponent.split(" ")[0]}</button>
            <button className="btn-ghost justify-center" disabled={m.status !== "Live" || !!a.busy} onClick={() => run("Full time", "full_time", {})}>Full time</button>
          </div>
          {!confirmPostpone ? (
            <button className="btn-danger mt-2 w-full justify-center" disabled={!!a.busy} onClick={() => setConfirmPostpone(true)}>Postpone match · refund all tickets</button>
          ) : (
            <div className="mt-2 rounded-2xl border border-warn/60 bg-warn/10 p-3 text-sm text-warn" role="alert">
              Postpone v {m.opponent}? This can't be undone: all {refunds} payment{refunds === 1 ? "" : "s"} for this match will be refunded.
              <div className="mt-2 flex gap-2">
                <button className="btn-danger" disabled={!!a.busy} onClick={() => run("Postpone", "postpone", {}).then(() => setConfirmPostpone(false))}>Yes, postpone</button>
                <button className="btn-ghost" onClick={() => setConfirmPostpone(false)}>Cancel</button>
              </div>
            </div>
          )}
        </>
      )}
      <ActionStatus a={a} />
      <p className="mt-3 text-xs text-muted">Each button is an on-chain transaction from {config.clubId}. Goals stamp every checked-in member; full time ends loans and starts the payout.</p>
    </section>
  );
}

function Payout({ season, refresh }: { season: Season; refresh: () => void }) {
  const { accountId, call } = useWallet();
  const a = useAction(refresh);
  if (season.payout_round === 0) return null;
  const done = season.round_settled >= season.memberships;
  return (
    <section className="card-glow p-5">
      <span className="chip gap-2 font-semibold">{done ? "PAYOUT COMPLETE" : <><span className="size-2 rounded-full bg-wine" /> PAYOUT RUNNING</>}</span>
      <h2 className="mt-3 text-xl font-bold">Round {season.payout_round} to members</h2>
      <div className="mt-3"><Progress label="Seat accounts settled" value={season.round_settled} max={season.memberships} right={`${season.round_settled} of ${season.memberships}`} /></div>
      <p className="mt-3 rounded-xl bg-ink/70 p-3 text-xs text-muted">If a membership changes hands during this payout, its share still lands in the seat account, so the new holder receives it.</p>
      {!done && accountId && <button className="btn-ghost mt-3 w-full justify-center" disabled={!!a.busy} onClick={() => a.run("Settling next batch", () => call("settle_batch", { limit: 8 }, { gasTgas: 300 }))}>Settle next batch (anyone can)</button>}
      <ActionStatus a={a} />
    </section>
  );
}

function ClubTools({ season, refresh }: { season: Season; refresh: () => void }) {
  const { accountId, call, payTusdc } = useWallet();
  const a = useAction(refresh);
  const [topUp, setTopUp] = useState("");
  const [opp, setOpp] = useState("");
  const [when, setWhen] = useState("");
  const [price, setPrice] = useState("10");
  const [big, setBig] = useState(false);
  if (accountId !== config.clubId) return null;

  const amount = (() => { try { const r = BigInt(toRaw(topUp)); return r > 0n ? r : null; } catch { return null; } })();
  const fixtureError = (() => {
    const name = opp.trim();
    if (!name) return "Enter the opponent's name";
    if (name.length > 40) return "Opponent name must be 40 characters or fewer";
    const t = Date.parse(when);
    if (!when || Number.isNaN(t)) return "Pick a kickoff date and time";
    if (t <= Date.now()) return "Kickoff must be in the future";
    try { if (BigInt(toRaw(price)) <= 0n) return "Ticket price must be above 0"; } catch { return "Ticket price must be a number like 10 or 12.50"; }
    return null;
  })();

  return (
    <section className="card p-5">
      <h2 className="text-lg font-bold">Club treasury</h2>
      <p className="mt-1 text-sm text-muted">Club balance: {usd(season.club_balance)} {SYM} · advance fund {usd(season.advance_fund)}</p>
      <div className="mt-3 flex gap-2">
        <input className="input" inputMode="decimal" placeholder={`Top up members' pool (${SYM})`} aria-label="Top-up amount" value={topUp} onChange={(e) => setTopUp(e.target.value)} />
        <button className="btn-primary" disabled={!amount || !!a.busy} onClick={() => a.run("Topping up", () => payTusdc(String(amount), { action: "top_up_pool" }), `${topUp} ${SYM} shared across all members`).then((ok) => ok && setTopUp(""))}>Send</button>
      </div>
      <button className="btn-ghost mt-2 w-full justify-center" disabled={BigInt(season.club_balance) === 0n || !!a.busy} onClick={() => a.run("Withdrawing club revenue", () => call("club_withdraw", { amount: season.club_balance }, { deposit: "1" }), `${usd(season.club_balance)} ${SYM} sent to ${config.clubId}`)}>
        Withdraw {usd(season.club_balance)} {SYM} club revenue
      </button>

      <h3 className="mt-5 font-semibold">New fixture</h3>
      <div className="mt-2 grid gap-2">
        <input className="input" placeholder="Opponent" aria-label="Opponent" maxLength={40} value={opp} onChange={(e) => setOpp(e.target.value)} />
        <input className="input" type="datetime-local" aria-label="Kickoff date and time" value={when} onChange={(e) => setWhen(e.target.value)} />
        <div className="flex gap-2">
          <input className="input" inputMode="decimal" aria-label={`Ticket price in ${SYM}`} placeholder="Ticket price" value={price} onChange={(e) => setPrice(e.target.value)} />
          <label className="flex shrink-0 items-center gap-2 text-sm"><input type="checkbox" className="accent-wine" checked={big} onChange={(e) => setBig(e.target.checked)} />Big match</label>
        </div>
        {fixtureError && (opp || when) ? <p className="text-xs text-warn">{fixtureError}</p> : null}
        <button className="btn-primary justify-center" disabled={!!fixtureError || !!a.busy}
          onClick={() => a.run("Creating fixture", () => call("create_match", {
            opponent: opp.trim(), competition: "Lagos Premier League",
            kickoff_at: String(BigInt(Date.parse(when)) * 1_000_000n), ticket_price: toRaw(price),
            big_match: big, priority_hours: big ? 48 : null,
          }), `Fixture v ${opp.trim()} added`).then((ok) => { if (ok) { setOpp(""); setWhen(""); } })}>
          Add fixture
        </button>
      </div>
      <ActionStatus a={a} />
    </section>
  );
}

/** Who members can pay from their seat's account. The club approves and removes vendors. */
function Vendors() {
  const { accountId, call } = useWallet();
  const list = usePoll(() => view<Vendor[]>("vendors"), [], 20_000);
  const a = useAction(list.refresh);
  const [id, setId] = useState("");
  const [name, setName] = useState("");
  const isClub = accountId === config.clubId;
  const account = id.trim().toLowerCase();
  return (
    <section className="card p-5">
      <h2 className="text-lg font-bold">Vendors at the ground</h2>
      <p className="mt-1 text-sm text-muted">Members can pay these accounts straight from what their seat has earned.</p>
      {(list.data ?? []).length === 0 ? <p className="mt-3 text-sm text-muted">{list.loading ? "Loading…" : "No vendors approved yet."}</p> : (
        <ul className="mt-3 space-y-2 text-sm">
          {list.data!.map((v) => (
            <li key={v.account_id} className="flex items-center justify-between gap-2 rounded-xl bg-ink/70 px-3 py-2">
              <span className="min-w-0"><span className="block font-semibold">{v.name}</span><span className="mono block truncate text-xs text-muted">{v.account_id}</span></span>
              {isClub && <button className="btn-ghost shrink-0 px-3 py-1 text-xs" disabled={!!a.busy} onClick={() => a.run("Removing vendor", () => call("set_vendor", { account_id: v.account_id, name: null }), `${v.name} removed`)}>Remove</button>}
            </li>
          ))}
        </ul>
      )}
      {isClub && (
        <div className="mt-3 grid gap-2">
          <input className="input" placeholder="Vendor's NEAR account" aria-label="Vendor account" value={id} onChange={(e) => setId(e.target.value)} />
          <input className="input" maxLength={40} placeholder="Name shown to members" aria-label="Vendor name" value={name} onChange={(e) => setName(e.target.value)} />
          <button className="btn-primary justify-center" disabled={!account || !name.trim() || !!a.busy}
            onClick={() => a.run("Approving vendor", () => call("set_vendor", { account_id: account, name: name.trim() }), `${name.trim()} approved`).then((ok) => { if (ok) { setId(""); setName(""); } })}>
            Approve vendor
          </button>
          <p className="text-xs text-muted">The vendor's account must be registered with {SYM} first, or payments to it are returned to the seat.</p>
        </div>
      )}
      <ActionStatus a={a} />
    </section>
  );
}
