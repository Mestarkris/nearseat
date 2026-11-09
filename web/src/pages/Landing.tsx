import { view } from "../near/rpc";
import { usePoll } from "../lib/usePoll";
import type { Membership } from "../lib/types";
import { MembershipCard } from "../components/MembershipCard";
import { Loading } from "../components/ui";

const FEATURES = [
  ["Your seat owns an account", "Each membership comes with its own NEAR account holding your balance, match passes and attendance record. No keys exist for anyone to steal or keep."],
  ["It earns every matchday", "A share of every ticket the club sells lands in your membership account. Lend your seat when you can't go and it earns that too."],
  ["Sell it and everything moves", "One sale moves the balance, passes, history and gate access to the buyer. The seller is locked out in the same moment."],
];

const FACTS = [
  ["0", "access keys on any membership account"],
  ["5%", "of every match ticket shared with members"],
  ["30s", "gate pass that rotates, so screenshots fail"],
  ["Auto", "refunds when a match is postponed"],
];

export function Landing() {
  const sample = usePoll(() => view<Membership | null>("membership", { token_id: "seat-c5-12" }), []);
  return (
    <div className="space-y-12">
      <section className="grid items-center gap-10 lg:grid-cols-[1.2fr_1fr]">
        <div>
          <div className="flex flex-wrap items-center gap-2 text-sm text-muted">
            <span className="rounded-full bg-white px-3 py-1 text-xs font-semibold text-ink">Built on NEAR</span>
            Illia Stars United · Season 2026/27
          </div>
          <h1 className="mt-5 text-5xl font-extrabold leading-[1.02] sm:text-7xl">
            Your seat now <span className="text-lime">earns.</span>
          </h1>
          <p className="mt-6 max-w-xl text-lg text-white/80">
            Every season membership is an NFT that owns a real NEAR account. It earns a share of every ticket sold,
            refunds itself, lends your seat, and opens the gate. Sell it, and everything inside moves to the buyer.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <a href="#/join" className="btn-primary px-6 py-3">Become a member</a>
            <a href="#/member" className="btn-ghost px-6 py-3">My membership</a>
            <a href="#/verify/seat-c5-12" className="btn-ghost px-6 py-3">See a live membership</a>
          </div>
        </div>
        <div className="mx-auto w-full max-w-sm">
          {sample.data ? <MembershipCard m={sample.data} /> : sample.loading ? <Loading what="Reading seat-c5-12 from testnet" /> : (
            <div className="card p-6 text-sm text-muted">Deploy and seed the contract to see a live card here.</div>
          )}
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-3">
        {FEATURES.map(([t, d]) => (
          <div key={t} className="card p-6">
            <h3 className="text-lg font-bold">{t}</h3>
            <p className="mt-2 text-sm text-white/70">{d}</p>
          </div>
        ))}
      </section>

      <section className="card-glow grid gap-6 p-6 sm:grid-cols-2 lg:grid-cols-4">
        {FACTS.map(([n, t]) => (
          <div key={t}>
            <div className="font-display text-4xl font-extrabold text-lime">{n}</div>
            <div className="mt-1 text-sm text-white/70">{t}</div>
          </div>
        ))}
      </section>

      <section className="grid gap-4 md:grid-cols-2">
        <a href="#/lab" className="card block p-6 hover:border-lime/60">
          <h3 className="text-lg font-bold">Attack Lab →</h3>
          <p className="mt-2 text-sm text-white/70">21 documented attacks (seller, old owner, renter, tout, outsider). Each one links to its test, and you can try it on testnet and watch it fail.</p>
        </a>
        <a href="#/verify/seat-c5-12" className="card block p-6 hover:border-lime/60">
          <h3 className="text-lg font-bold">Verify without a wallet →</h3>
          <p className="mt-2 text-sm text-white/70">Live RPC check: zero keys on the vault, the code hash matches the published build, current owner, every past holder and payout.</p>
        </a>
      </section>
    </div>
  );
}
