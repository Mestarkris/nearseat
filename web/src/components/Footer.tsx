// Site footer: logo, where to go next, the documents behind the project, and
// the live contract details so anyone can check what they're using.
import { useState } from "react";
import { view } from "../near/rpc";
import { usePoll } from "../lib/usePoll";
import type { Season } from "../lib/types";
import { config, MAINNET, MAINNET_LIVE } from "../config";
import { Logo } from "./ui";

const REPO = "https://github.com/Mestarkris/nearseat";
const ext = { target: "_blank", rel: "noreferrer" } as const;

const COLUMNS: [string, [string, string, boolean?][]][] = [
  ["Use it", [
    ["Become a member", "#/join"],
    ["Match tickets", "#/matches"],
    ["Membership market", "#/market"],
    ["My membership", "#/member"],
    ["Steward's scanner", "#/scan"],
  ]],
  ["Learn", [
    ["Whitepaper", "#/whitepaper"],
    ["How it works", "#/how"],
    ["Roadmap", "#/roadmap"],
    ["Questions fans ask", "#/faq"],
    ["Architecture", `${REPO}/blob/main/docs/ARCHITECTURE.md`, true],
  ]],
  ["Security", [
    ["Verify a seat", "#/verify/seat-c5-12"],
    ["Attack Lab", "#/lab"],
    ["Threat model", `${REPO}/blob/main/docs/THREAT_MODEL.md`, true],
    ["Source code", REPO, true],
    ["MIT licence", `${REPO}/blob/main/LICENSE`, true],
  ]],
];

function Copy({ value, label }: { value: string; label: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      className="group flex w-full items-center justify-between gap-3 rounded-xl border border-line bg-ink px-3 py-2 text-left hover:border-lime/60"
      onClick={() => navigator.clipboard?.writeText(value).then(() => { setDone(true); setTimeout(() => setDone(false), 1500); })}
      aria-label={`Copy ${label}`}
    >
      <span className="min-w-0">
        <span className="block text-xs text-muted">{label}</span>
        <span className="mono block truncate text-xs text-fg">{value}</span>
      </span>
      <span className="shrink-0 text-xs text-lime" aria-live="polite">{done ? "Copied" : "Copy"}</span>
    </button>
  );
}

export function Footer() {
  const season = usePoll(() => view<Season>("season"), [], 120_000);
  return (
    <footer className="border-t border-line bg-card">
      <div className="mx-auto max-w-6xl px-4 py-14">
        <div className="grid grid-cols-2 gap-x-6 gap-y-10 sm:grid-cols-3 lg:grid-cols-[1.4fr_repeat(3,1fr)_1.5fr]">
          <div className="col-span-full lg:col-span-1">
            <a href="#/" aria-label="NearSeat home" className="inline-block"><Logo size={36} /></a>
            <p className="mt-4 max-w-xs text-sm text-fg/70">Season memberships that own their own NEAR accounts. Your seat now earns.</p>
            <a className="btn-ghost mt-5" href={REPO} {...ext}>
              <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden fill="currentColor"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" /></svg>
              GitHub
            </a>
          </div>
          {COLUMNS.map(([title, links]) => (
            <nav key={title} aria-label={title}>
              <h2 className="font-display text-sm font-bold text-fg">{title}</h2>
              <ul className="mt-4 space-y-2.5 text-sm">
                {links.map(([label, href, external]) => (
                  <li key={label}><a className="text-fg/65 hover:text-lime" href={href} {...(external ? ext : {})}>{label}</a></li>
                ))}
              </ul>
            </nav>
          ))}
          <div className="col-span-full lg:col-span-1">
            <h2 className="flex items-center gap-2 font-display text-sm font-bold text-fg">
              <span className="size-2 rounded-full bg-wine" />On NEAR {config.network}
            </h2>
            <div className="mt-4 space-y-2">
              <Copy label="Contract" value={config.contractId} />
              <Copy label={MAINNET ? "Stablecoin (Circle USDC)" : "Test stablecoin (tUSDC)"} value={config.tusdcId} />
              {season.data && <Copy label="Seat program hash" value={season.data.vault_code_hash} />}
            </div>
            <a className="mt-3 inline-block text-sm text-fg/65 hover:text-lime" href={`${config.explorer}/address/${config.contractId}`} {...ext}>View the contract on NearBlocks</a>
          </div>
        </div>
        <div className="mt-12 flex flex-col gap-3 border-t border-line pt-6 text-xs text-muted md:flex-row md:justify-between">
          <p>© 2026 NearSeat. Built for the NEAR hackathon. Open source under the MIT licence.</p>
          <p className="max-w-xl md:text-right">{MAINNET ? <>Real USDC on NEAR mainnet, at prices of a few cents. <a className="underline hover:text-fg" href="/">The full demo is on testnet.</a></> : <>Testnet. tUSDC is a test token with no value.{MAINNET_LIVE && <> <a className="underline hover:text-fg" href="/mainnet/">There is also a mainnet copy that takes real USDC.</a></>}</>} Illia Stars United is a fictional club. This build has not been audited and nothing here is financial advice.</p>
        </div>
      </div>
    </footer>
  );
}
