// The NearSeat whitepaper as a page: plain-language design document with a
// live parameters table read from the contract. "Save as PDF" uses the print sheet.
import type { ReactNode } from "react";
import { view } from "../near/rpc";
import { usePoll } from "../lib/usePoll";
import type { Season } from "../lib/types";
import { usd } from "../lib/format";
import { config } from "../config";
import { Logo } from "../components/ui";

const REPO = "https://github.com/Mestarkris/nearseat";
const pct = (bps: number) => `${bps / 100}%`;

const SECTIONS: [string, string][] = [
  ["summary", "Summary"],
  ["problem", "The problem"],
  ["design", "A seat that owns an account"],
  ["money", "How money moves"],
  ["access", "Getting through the gate"],
  ["lending", "Lending a seat"],
  ["resale", "Selling a membership"],
  ["failure", "When something fails"],
  ["security", "Security model"],
  ["parameters", "Live parameters"],
  ["limits", "Known limits"],
  ["roadmap", "Roadmap"],
];

function S({ id, n, title, children }: { id: string; n: number; title: string; children: ReactNode }) {
  return (
    <section id={`wp-${id}`} className="scroll-mt-24 border-t border-line py-10">
      <h2 className="flex items-baseline gap-4 text-2xl font-extrabold sm:text-3xl">
        <span className="font-number text-3xl font-normal text-lime sm:text-4xl">{n}</span>{title}
      </h2>
      <div className="mt-4 space-y-4 text-[17px] leading-relaxed text-white/80">{children}</div>
    </section>
  );
}

export function WhitepaperPage() {
  const season = usePoll(() => view<Season>("season"), [], 60_000);
  const s = season.data;
  const c = s?.config;
  const go = (id: string) => document.getElementById(`wp-${id}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
  const params: [string, string][] = s && c ? [
    ["Season price", `${usd(s.season_price, 0)} tUSDC`],
    ["Memberships sold / maximum", `${s.memberships} / ${s.max_supply}`],
    ["Members' share of each match's ticket sales", pct(c.members_cut_bps)],
    ["Highest price for lending a seat", `${pct(c.lend_cap_bps)} of the match ticket price`],
    ["Club fee on a seat loan", pct(c.lend_club_fee_bps)],
    ["Highest resale price", `${usd(s.resale_cap, 0)} tUSDC (${pct(c.resale_cap_bps)} of the season price)`],
    ["Club royalty on a resale", pct(c.resale_fee_bps)],
    ["Single tickets one account may buy per match", String(c.max_tickets_per_account)],
    ["Matches attended for Silver / Gold / Legend", c.tier_thresholds.join(" / ")],
    ["Largest advance on future earnings", `${pct(c.advance_cap_bps)} of expected earnings`],
  ] : [];
  let n = 0;
  return (
    <div className="grid gap-10 lg:grid-cols-[220px_minmax(0,1fr)]">
      <aside className="no-print hidden lg:block">
        <nav className="sticky top-24 space-y-1 text-sm" aria-label="Whitepaper sections">
          {SECTIONS.map(([id, title], i) => (
            <button key={id} onClick={() => go(id)} className="flex w-full gap-3 rounded-lg px-2 py-1.5 text-left text-muted hover:bg-card hover:text-white">
              <span className="w-4 text-lime">{i + 1}</span>{title}
            </button>
          ))}
        </nav>
      </aside>
      <article className="max-w-[70ch]">
        <Logo size={36} />
        <h1 className="mt-6 text-4xl font-extrabold sm:text-6xl">NearSeat whitepaper</h1>
        <p className="mt-3 text-muted">Version 1.0, November 2026. Season memberships that own their own NEAR accounts.</p>
        <div className="no-print mt-5 flex flex-wrap gap-3">
          <button className="btn-primary" onClick={() => window.print()}>Save as PDF</button>
          <a className="btn-ghost" href={REPO} target="_blank" rel="noreferrer">Source code on GitHub</a>
        </div>

        <div className="mt-10">
          <S id="summary" n={++n} title="Summary">
            <p>NearSeat turns a football season membership into something that works for its holder. Each membership is an NFT, and each NFT owns a real account on NEAR. That account collects a share of every ticket the club sells, holds the seat's match passes and attendance record, and is the thing the gate checks on matchday.</p>
            <p>Nobody holds a key to a seat's account. The contract moves its money only when the current NFT holder asks. So when a membership is sold, the buyer gets the seat and everything in it, and the seller loses access in the same transaction.</p>
            <p>It is built for a fictional club, Illia Stars United, and runs on NEAR testnet with a test stablecoin called tUSDC.</p>
          </S>

          <S id="problem" n={++n} title="The problem">
            <p>A season ticket is the largest and most loyal purchase a fan makes, and it is a dead asset. If you miss a match the seat sits empty. When the club sells out, none of that reaches the people who filled the stadium all year. Passing a ticket on is slow or forbidden, which pushes fans towards touts.</p>
            <p>Clubs have the mirror image of that problem. Empty season seats are lost atmosphere and lost sales, refunds for postponed matches are manual work, and the resale market happens somewhere they can't see or set rules for.</p>
          </S>

          <S id="design" n={++n} title="A seat that owns an account">
            <p>When a membership for seat C5-12 is minted, the contract creates the account <span className="mono text-sm">seat-c5-12.{config.contractId}</span> in the same transaction. The account is created with no access keys at all, so there is nothing to steal, leak or hold back after a sale.</p>
            <p>Each seat account runs a very small program that does one thing: pay out when its parent, the NearSeat contract, tells it to. The parent in turn acts only for the current owner of the NFT, and it looks the owner up at the moment of every action. Ownership is never cached.</p>
            <p>The seat program is published once on NEAR as a global contract and referenced by its hash. Every seat account runs exactly that code, it cannot be swapped, and anyone can compare the hash with the published build.</p>
          </S>

          <S id="money" n={++n} title="How money moves">
            <p>Fans buy match tickets and memberships in tUSDC. Ticket money for a match is held by the contract until the match is played. At full time a fixed share of that match's sales goes to the members' pool and the rest becomes club revenue.</p>
            <p>The pool is split equally between memberships using a running per-share total, so the cost of a payout does not grow with the number of members. Each seat's share is then settled into its own account. If a membership changes hands in the middle of a payout round, earnings up to the sale stay with the seat, and so go to the buyer, exactly as the listing showed.</p>
            <p>A holder can withdraw from the seat account to their wallet at any time. They can also take a capped advance on future earnings, which is repaid first out of later payouts or out of the sale price.</p>
          </S>

          <S id="access" n={++n} title="Getting through the gate">
            <p>A member opens their pass in the app. The wallet signs a short message, and the app shows a QR code that changes every 30 seconds, so a screenshot is useless within moments.</p>
            <p>The steward's scanner checks the signature, then asks the contract who holds that seat for that match. Only a match with the contract's answer opens the gate, and the check-in is recorded on chain so the same seat cannot be used twice.</p>
            <p>Because the contract is asked at the moment of the scan, access follows ownership with no extra step. A new owner's pass works straight after the sale. A previous owner's does not.</p>
          </S>

          <S id="lending" n={++n} title="Lending a seat">
            <p>A member who can't attend offers the seat for one match at a price up to a cap. Another fan pays and becomes the seat's holder for that match only. The rent, minus a small club fee, goes into the seat's account.</p>
            <p>For that match the borrower's wallet produces the valid gate pass and the owner's is paused, so one seat never admits two people. After full time the seat is the owner's again without anyone doing anything. Loans lock at kickoff, and members can set a rule that offers the seat automatically if they haven't checked in by a chosen time.</p>
          </S>

          <S id="resale" n={++n} title="Selling a membership">
            <p>A member lists the membership at a price up to the resale cap. Listing freezes withdrawals, loans and advances on that seat, so what a buyer sees is what they get.</p>
            <p>Every change to a seat's state bumps a counter. The buyer's payment names the counter value they looked at. If anything changed in between, the purchase is cancelled and the payment returns in full. On success, one transaction pays the seller, pays the club its royalty, and moves the NFT. The balance, passes, attendance record and gate access follow because they belong to the seat, not the person.</p>
          </S>

          <S id="failure" n={++n} title="When something fails">
            <p>Every step that touches another contract has a matching undo step. A payout that can't be delivered is restored to the membership and retried. A failed withdrawal puts the balance back. If a new seat account can't be created, the buyer's payment is returned.</p>
            <p>When a match is postponed, the contract refunds everyone who paid for it: single-ticket buyers and fans who rented a seat. A scheduled job triggers the refunds, and the contract checks every one of them.</p>
          </S>

          <S id="security" n={++n} title="Security model">
            <p>The threat model was written before any code. It lists 58 ways a seller, a past owner, a borrower, a tout, the club's own staff or an outsider might try to cheat, and what stops each one.</p>
            <p>The contracts are covered by 86 automated tests, including a sale that lands in the middle of a payout and failures injected into every callback. Twenty-one of the attacks are also wired into the <a className="text-lime" href="#/lab">Attack Lab</a>, where anyone can attempt them against the live contract and watch them be refused.</p>
            <p>The <a className="text-lime" href="#/verify/seat-c5-12">Verify page</a> checks a seat without a wallet: zero keys on its account, the code hash, the current owner, and every past holder and payout.</p>
            <p className="no-print">Read the full <a className="text-lime" href={`${REPO}/blob/main/docs/THREAT_MODEL.md`} target="_blank" rel="noreferrer">threat model</a> and <a className="text-lime" href={`${REPO}/blob/main/docs/ARCHITECTURE.md`} target="_blank" rel="noreferrer">architecture diagrams</a>.</p>
          </S>

          <S id="parameters" n={++n} title="Live parameters">
            <p>These are the rules the contract is enforcing right now, read from it as this page loaded.</p>
            {params.length === 0 ? <p className="text-muted">{season.error ? "Couldn't reach the contract. Reload to try again." : "Reading the contract…"}</p> : (
              <dl className="overflow-hidden rounded-2xl border border-line text-base">
                {params.map(([k, v]) => (
                  <div key={k} className="flex flex-wrap justify-between gap-x-6 gap-y-1 border-b border-line px-4 py-3 last:border-b-0">
                    <dt className="text-white/70">{k}</dt><dd className="font-semibold text-white">{v}</dd>
                  </div>
                ))}
              </dl>
            )}
            <p className="text-sm text-muted">Contract <span className="mono">{config.contractId}</span>. Stablecoin <span className="mono">{config.tusdcId}</span>.{s && <> Seat program hash <span className="mono break-all">{s.vault_code_hash}</span>.</>}</p>
          </S>

          <S id="limits" n={++n} title="Known limits">
            <p>This is a hackathon build on a test network, and it has not been audited. tUSDC has no value.</p>
            <p>The steward's scanner key lives on the club's server. A stolen scanner key still can't let in someone who doesn't hold a seat, because the contract re-checks, but it could mark an absent member as present. The club can replace that key.</p>
            <p>Limits on touts are per account, so someone with many accounts is slowed but not stopped. Free transactions for fans depend on the wallet supporting them, and otherwise cost a fraction of a cent of test NEAR. There is deliberately no upgrade switch, so fixing a bug means a fresh deployment.</p>
          </S>

          <S id="roadmap" n={++n} title="Roadmap">
            <p><b className="text-white">Next:</b> seat categories (VIP, pitchside, standard, fans' end) with their own prices and share of earnings, category perks at the gate, shared tickets for groups, and sponsor rewards paid straight into seat accounts.</p>
            <p><b className="text-white">Later:</b> an independent audit, a mainnet launch with a regulated stablecoin alongside a real club, and support for several clubs and seasons on the same contracts.</p>
          </S>
        </div>
      </article>
    </div>
  );
}
