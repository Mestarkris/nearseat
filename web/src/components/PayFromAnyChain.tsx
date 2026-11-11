// "I hold SOL, not USDC on NEAR": a live NEAR Intents quote for the price on
// screen. Opened by the reader; it asks the 1Click API what the payment would
// cost from another chain. It is a quote only: see lib/oneclick.ts for why.
import { useEffect, useState } from "react";
import { PAY_ASSETS, quoteExactUsdc, type PayAsset, type PayQuote } from "../lib/oneclick";
import { usd } from "../lib/format";

type State = { asset: string; quote?: PayQuote; error?: string };

export function PayFromAnyChain({ amount, what }: { amount: bigint; what: string }) {
  const [open, setOpen] = useState(false);
  const [asset, setAsset] = useState<PayAsset>(PAY_ASSETS[0]);
  const [tick, setTick] = useState(0);
  const [state, setState] = useState<State>();

  useEffect(() => {
    if (!open || amount <= 0n) return;
    const stop = new AbortController();
    quoteExactUsdc(asset, amount, stop.signal).then(
      (quote) => setState({ asset: asset.id, quote }),
      (e) => { if (!stop.signal.aborted) setState({ asset: asset.id, error: String(e?.message ?? e) }); },
    );
    return () => stop.abort();
  }, [open, asset, amount, tick]);

  const current = state?.asset === asset.id ? state : undefined;
  const q = current?.quote;
  const cost = q ? Math.max(0, q.amountInUsd - q.amountOutUsd) : 0;

  return (
    <div className="mt-4 rounded-2xl border border-line text-sm">
      <button type="button" className="flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span><span className="font-semibold">Holding another token?</span> <span className="text-muted">See the price from any chain</span></span>
        <span className={`text-muted transition-transform ${open ? "rotate-180" : ""}`} aria-hidden>▾</span>
      </button>
      {open && (
        <div className="border-t border-line px-3 pb-3 pt-3">
          <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Token to pay with">
            {PAY_ASSETS.map((x) => (
              <button key={x.id} type="button" role="radio" aria-checked={x.id === asset.id} onClick={() => setAsset(x)}
                className={`rounded-full border px-2.5 py-1 text-xs transition-colors ${x.id === asset.id ? "border-lime bg-wine text-wine-ink" : "border-line text-muted hover:text-white"}`}>
                {x.symbol}<span className="opacity-70"> on {x.chain}</span>
              </button>
            ))}
          </div>
          <div className="mt-3 min-h-[4.5rem] rounded-xl bg-ink p-3" aria-live="polite">
            {!current ? <span className="text-muted">Asking NEAR Intents for a price</span> : q ? (
              <>
                <div className="flex items-baseline justify-between gap-2">
                  <span className="font-number text-3xl leading-none text-lime tabular-nums">{q.amountIn.toFixed(asset.digits)}</span>
                  <span className="text-muted">{asset.symbol} on {asset.chain}</span>
                </div>
                <div className="mt-1.5 text-xs text-muted">
                  Pays for {what}: {usd(amount)} USDC delivered on NEAR in about {q.seconds} seconds. Route cost about ${cost.toFixed(2)}; any unused part is refunded to the sender.
                </div>
              </>
            ) : (
              <span className="text-warn">No market maker is quoting {asset.symbol} on {asset.chain} right now ({current.error}). Try another token.</span>
            )}
          </div>
          <p className="mt-2 text-xs text-muted">
            A live quote from NEAR Intents (1Click API), which runs on mainnet. This demo is on testnet and takes a test stablecoin, so the payment itself can't be sent from here. On mainnet the USDC lands in your NEAR account and the purchase is one gasless tap.{" "}
            <button type="button" className="underline hover:text-white" onClick={() => { setState(undefined); setTick(tick + 1); }}>Refresh the price</button>
          </p>
        </div>
      )}
    </div>
  );
}
