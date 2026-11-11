// Landing page: hero, the problem, the animated seat story, live proof,
// roadmap + FAQ, and the call to join. Sections ease in as they are reached.
import { useEffect, useRef, useState, type CSSProperties, type PointerEvent } from "react";
import { view } from "../near/rpc";
import { usePoll } from "../lib/usePoll";
import type { FeedItem, Membership, Season } from "../lib/types";
import { Reveal, useCountUp, useInView } from "../lib/motion";
import { MembershipCard } from "../components/MembershipCard";
import { SeatStory } from "../components/SeatStory";
import { describe } from "../components/Feed";
import { Loading } from "../components/ui";

const wrap = "mx-auto max-w-6xl px-4";

export function Landing({ section }: { section?: string }) {
  // Footer links such as #/faq land here and scroll to that part of the page.
  useEffect(() => {
    if (section) document.getElementById(section)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [section]);
  return (
    <main>
      <Hero />
      <Ticker />
      <Problem />
      <section id="how" className={`${wrap} scroll-mt-24 py-20 sm:py-28`}>
        <Reveal>
          <h2 className="max-w-3xl text-4xl font-extrabold sm:text-6xl">One seat, followed through a season</h2>
          <p className="mt-4 max-w-2xl text-lg text-white/70">Scroll to follow seat C5-12 from the day it is bought to the day it is sold.</p>
        </Reveal>
        <div className="mt-10 lg:mt-0"><SeatStory /></div>
      </section>
      <Proof />
      <Roadmap />
      <Faq />
      <JoinCta />
    </main>
  );
}

function Hero() {
  const sample = usePoll(() => view<Membership | null>("membership", { token_id: "seat-c5-12" }), []);
  const card = useRef<HTMLDivElement>(null);
  const tilt = (e: PointerEvent<HTMLDivElement>) => {
    const el = card.current;
    if (!el || e.pointerType !== "mouse") return;
    const r = el.getBoundingClientRect();
    el.style.setProperty("--ry", `${((e.clientX - r.left) / r.width - 0.5) * 9}deg`);
    el.style.setProperty("--rx", `${(0.5 - (e.clientY - r.top) / r.height) * 9}deg`);
  };
  const level = () => { card.current?.style.setProperty("--rx", "0deg"); card.current?.style.setProperty("--ry", "0deg"); };
  return (
    <section className={`${wrap} grid items-center gap-10 pb-14 pt-8 sm:pt-14 lg:min-h-[calc(100dvh-140px)] lg:grid-cols-[1.25fr_1fr]`}>
      <div>
        <p className="hero-fade text-sm text-muted">Illia Stars United, season 2026/27. Running on NEAR testnet.</p>
        <h1 className="mt-4 font-number whitespace-nowrap text-[clamp(4rem,8.5vw,7.5rem)] font-normal leading-[0.9] tracking-normal">
          <span className="rise-line"><span>Your seat</span></span>
          <span className="rise-line"><span style={{ "--d": "110ms" } as CSSProperties}>now <span className="text-lime">earns.</span></span></span>
        </h1>
        <p className="hero-fade mt-6 max-w-xl text-lg text-white/80">
          A season membership that owns a real NEAR account. It collects a share of every ticket the club sells,
          can be lent for a match you'll miss, and opens the gate. Sell it, and everything inside goes to the buyer.
        </p>
        <div className="hero-fade mt-8 flex flex-wrap items-center gap-3">
          <a href="#/join" className="btn-primary px-6 py-3 text-base">Become a member</a>
          <a href="#/how" className="btn-ghost px-6 py-3 text-base">See how it works</a>
          <a href="#/whitepaper" className="px-3 py-3 text-sm text-white/70 underline decoration-line underline-offset-4 hover:text-white">Read the whitepaper</a>
        </div>
      </div>
      <div className="hero-settle mx-auto w-full max-w-sm" onPointerMove={tilt} onPointerLeave={level}>
        <div ref={card} className="tilt">
          {sample.data ? <MembershipCard m={sample.data} /> : sample.loading ? <Loading what="Reading seat-c5-12 from testnet" /> : (
            <div className="card p-6 text-sm text-muted">Deploy and seed the contract to see a live card here.</div>
          )}
        </div>
        <p className="mt-3 text-center text-xs text-muted">A real membership, read from the chain just now. <a className="text-lime" href="#/verify/seat-c5-12">Check it yourself</a></p>
      </div>
    </section>
  );
}

/** A slow strip of the latest contract events, like a stadium ribbon board. */
function Ticker() {
  const feed = usePoll(() => view<FeedItem[]>("get_feed", {}), [], 20_000);
  const items = (feed.data ?? []).slice(-14).reverse().map((it) => {
    let data: Record<string, unknown> = {};
    try { data = JSON.parse(it.data); } catch { /* keep empty */ }
    const d = describe(it.event, data);
    return { key: it.seq, text: d.sub ? `${d.title}: ${d.sub}` : d.title };
  });
  if (items.length < 3) return null;
  const run = (hidden: boolean) => items.map((it) => (
    <span key={`${hidden}${it.key}`} aria-hidden={hidden} className="flex items-center gap-3 whitespace-nowrap px-6 text-sm text-white/70">
      <span className="size-1.5 rounded-full bg-lime" />{it.text}
    </span>
  ));
  return (
    <div className="marquee overflow-hidden border-y border-line bg-card py-3" aria-label="Latest activity on the contract">
      <div className="marquee-track">{run(false)}{run(true)}</div>
    </div>
  );
}

const TODAY = [
  ["You miss a match", "The seat sits empty and you have still paid for it.", "Lend it for that one match. The rent lands in your seat's account."],
  ["The club sells out", "The gate takings are the club's. Your loyalty earns nothing.", "5% of every match's ticket sales is shared between the members, by seat category."],
  ["You want to sell", "Paper forms, touts, or a flat no from the ticket office.", "One sale moves the seat, its balance, its history and gate access, at a capped price."],
  ["A match is postponed", "You wait, then chase the refund yourself.", "Everyone who paid for that match is refunded by the contract."],
];

function Problem() {
  return (
    <section className={`${wrap} py-20 sm:py-28`}>
      <Reveal>
        <h2 className="max-w-4xl text-4xl font-extrabold sm:text-6xl">
          A season ticket is the most loyal thing a fan buys. Today it's a plastic card that does nothing.
        </h2>
      </Reveal>
      <div className="mt-12 border-t border-line">
        <div className="hidden grid-cols-[1fr_1.3fr_1.3fr] gap-6 py-3 text-sm text-muted md:grid">
          <span /> <span>Season ticket today</span> <span className="text-lime">Membership on NearSeat</span>
        </div>
        {TODAY.map(([when, now, then], i) => (
          <Reveal key={when} delay={i * 70}>
            <div className="grid gap-x-6 gap-y-2 border-t border-line py-6 md:grid-cols-[1fr_1.3fr_1.3fr]">
              <h3 className="text-xl font-bold">{when}</h3>
              <p className="text-white/50 line-through decoration-white/25">{now}</p>
              <p className="text-white/90">{then}</p>
            </div>
          </Reveal>
        ))}
      </div>
    </section>
  );
}

function Score({ value, digits = 0, label, run, delay }: { value: number; digits?: number; label: string; run: boolean; delay: number }) {
  const [go, setGo] = useState(false);
  useEffect(() => { if (run) { const t = setTimeout(() => setGo(true), delay); return () => clearTimeout(t); } }, [run, delay]);
  const v = useCountUp(value, go, 1200);
  return (
    <div className="px-5 py-6 sm:px-6">
      <div className="font-number text-6xl leading-none text-lime tabular-nums sm:text-7xl">{v.toFixed(digits)}</div>
      <div className="mt-2 text-sm text-white/70">{label}</div>
    </div>
  );
}

function Proof() {
  const season = usePoll(() => view<Season>("season"), [], 30_000);
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref);
  const s = season.data;
  const scores: [number, number, string][] = [
    [s?.memberships ?? 0, 0, "seat accounts live on testnet"],
    [s ? Number(s.pool_total_distributed) / 1e6 : 0, 2, "tUSDC shared with members so far"],
    [0, 0, "keys on any seat account"],
    [21, 0, "attacks you can try yourself, all refused"],
    [112, 0, "automated tests, including a sale in the middle of a payout"],
  ];
  return (
    <section className="border-y border-line bg-card">
      <div className={`${wrap} py-20 sm:py-28`}>
        <Reveal>
          <h2 className="max-w-3xl text-4xl font-extrabold sm:text-6xl">Don't take our word for it</h2>
          <p className="mt-4 max-w-2xl text-lg text-white/70">
            These numbers are read from the contract as this page loads. Every seat account, payout and past holder is public, and you can check any of it without a wallet.
          </p>
        </Reveal>
        <div ref={ref} className="mt-10 grid divide-line overflow-hidden rounded-[28px] border border-line bg-ink max-sm:divide-y sm:grid-cols-2 sm:[&>*]:border-b sm:[&>*]:border-line lg:grid-cols-5 lg:divide-x lg:[&>*]:border-b-0">
          {scores.map(([value, digits, label], i) => <Score key={label} value={value} digits={digits} label={label} run={inView && (!!s || i > 1)} delay={i * 120} />)}
        </div>
        <Reveal className="mt-8 flex flex-wrap gap-3">
          <a href="#/verify/seat-c5-12" className="btn-primary px-6 py-3">Verify a seat yourself</a>
          <a href="#/lab" className="btn-ghost px-6 py-3">Try to break it in the Attack Lab</a>
        </Reveal>
      </div>
    </section>
  );
}

const ROADMAP: [string, string, string[]][] = [
  ["Live now", "On NEAR testnet", [
    "Memberships that own a keyless account",
    "Ticket sales in a stablecoin, with members' share paid each match",
    "Seat lending, capped resale and automatic refunds",
    "Rotating gate pass and a scanner for stewards",
    "Member voting, weighted by attendance",
    "Paying club-approved vendors from the seat's account",
    "Saving payouts towards next season, and a season statement for every seat",
    "Seat categories: VIP, pitchside, standard and fans' end, each with its own price and share",
  ]],
  ["Next", "After the hackathon", [
    "Category perks at the gate, such as lounge access",
    "Shared tickets for friends sitting together",
    "Sponsor rewards dropped straight into seat accounts",
  ]],
  ["Later", "With a real club", [
    "Independent security audit",
    "Mainnet launch with a regulated stablecoin",
    "More than one club and season on the same contracts",
  ]],
];

function Roadmap() {
  return (
    <section id="roadmap" className={`${wrap} scroll-mt-24 py-20 sm:py-28`}>
      <Reveal><h2 className="text-4xl font-extrabold sm:text-6xl">Roadmap</h2></Reveal>
      <div className="mt-10 grid gap-10 lg:grid-cols-3 lg:gap-0">
        {ROADMAP.map(([stage, when, items], i) => (
          <Reveal key={stage} delay={i * 120} className="lg:border-l lg:border-line lg:pl-8 lg:pr-6">
            <div className="flex items-center gap-3">
              <span className={`size-3 rounded-full ${i === 0 ? "bg-lime" : "border border-muted"}`} />
              <h3 className="text-2xl font-bold">{stage}</h3>
            </div>
            <p className="mt-1 text-sm text-muted">{when}</p>
            <ul className="mt-4 space-y-3 text-white/80">
              {items.map((it) => <li key={it}>{it}</li>)}
            </ul>
          </Reveal>
        ))}
      </div>
    </section>
  );
}

const FAQ: [string, string][] = [
  ["Do I need real money to try it?", "No. NearSeat runs on NEAR's test network. You connect a free testnet wallet, press one button to get test tUSDC, and use that to buy tickets or a membership. Nothing here has real value."],
  ["What do I actually own?", "An NFT in your wallet, and through it the seat's own account. That account holds the seat's earnings, match passes and attendance record. Nobody has a key to it, the club included. The contract only moves its money when the current NFT holder asks."],
  ["Are all seats the same?", "No. Where a seat is decides its category: VIP, Pitchside, Standard or Fans' End. A VIP seat costs 2.5 times a standard one and earns 2.5 times the share of every payout. A seat in the Fans' End costs less and earns in proportion. The grade on the card (Bronze to Legend) is separate: you earn it by turning up."],
  ["I lent my seat. How does the other person get in?", "For that one match the contract records them as the seat's holder. Their wallet shows a gate pass that changes every 30 seconds, and the steward's scanner checks it against the contract. Your own pass is paused for that match, then comes back on its own after full time."],
  ["I bought a membership from another fan. How do I get in?", "The same way the seller did. The gate asks the contract who holds the seat at the moment of the scan, and after the sale that is you. The seller's pass stops working in the same transaction."],
  ["Could a seller empty the seat's account just before I pay?", "No. Listing a membership freezes withdrawals from it. If anything about it changes after you looked, the purchase is cancelled and your payment comes straight back."],
  ["What happens if a match is postponed?", "The contract refunds everyone who paid for that match: single-ticket buyers and fans who rented a seat. Nobody has to apply."],
  ["Can a tout buy memberships and resell them at any price?", "Resale and lending prices are capped by the contract, and the club takes a small royalty on each resale. The cap is enforced in the sale itself, so there is no way around it on this market."],
];

function Faq() {
  return (
    <section id="faq" className="scroll-mt-24 border-t border-line">
      <div className={`${wrap} grid gap-10 py-20 sm:py-28 lg:grid-cols-[1fr_1.6fr]`}>
        <Reveal>
          <h2 className="text-4xl font-extrabold sm:text-6xl">Questions fans ask</h2>
          <p className="mt-4 text-white/70">More detail is in the <a className="text-lime" href="#/whitepaper">whitepaper</a>.</p>
        </Reveal>
        <Reveal delay={100}>
          {FAQ.map(([q, a]) => (
            <details key={q} className="faq border-b border-line py-5">
              <summary className="flex items-center justify-between gap-4 text-lg font-semibold">
                {q}
                <svg className="faq-plus shrink-0 text-lime" width="20" height="20" viewBox="0 0 20 20" aria-hidden><path d="M10 3v14M3 10h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
              </summary>
              <p className="mt-3 max-w-2xl text-white/75">{a}</p>
            </details>
          ))}
        </Reveal>
      </div>
    </section>
  );
}

function JoinCta() {
  return (
    <section className={`${wrap} pb-24`}>
      <Reveal>
        <div className="rounded-[32px] bg-lime px-6 py-14 text-lime-ink sm:px-14 sm:py-20">
          <h2 className="font-number text-6xl font-normal leading-[0.9] tracking-normal sm:text-8xl">Pick your seat.</h2>
          <p className="mt-4 max-w-xl text-lg font-medium">Choose a free seat in Stars Arena, pay the season price in test tUSDC, and watch its account appear on chain.</p>
          <div className="mt-8 flex flex-wrap gap-3">
            <a href="#/join" className="pill bg-ink px-6 py-3 text-base font-semibold text-white hover:bg-card">Become a member</a>
            <a href="#/matches" className="pill border border-ink/40 px-6 py-3 text-base font-semibold hover:bg-ink/10">Buy a single match ticket</a>
          </div>
        </div>
      </Reveal>
    </section>
  );
}
