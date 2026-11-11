// NEAR Intents, through the public 1Click API: "what would it cost to pay this
// price in USDC on NEAR, starting from a token on another chain?"
//
// 1Click runs on mainnet only. NearSeat is deployed on testnet with a test
// stablecoin, so we only ever ask for DRY quotes: the API prices the route with
// live market makers but creates no deposit address, and no funds can move.
const API = "https://1click.chaindefuser.com/v0";

/** Native USDC on NEAR mainnet: what a mainnet NearSeat would be paid in. */
const USDC_ON_NEAR = "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";
/** A dry quote still needs a recipient and a refund account. Nothing is ever sent to it. */
const DRY_RUN_ACCOUNT = "near";

export interface PayAsset { id: string; symbol: string; chain: string; digits: number }
export const PAY_ASSETS: PayAsset[] = [
  { id: "nep141:sol.omft.near", symbol: "SOL", chain: "Solana", digits: 4 },
  { id: "nep141:sol-5ce3bf3a31af18be40ba30f721101b4341690186.omft.near", symbol: "USDC", chain: "Solana", digits: 2 },
  { id: "nep141:btc.omft.near", symbol: "BTC", chain: "Bitcoin", digits: 6 },
  { id: "nep141:eth.omft.near", symbol: "ETH", chain: "Ethereum", digits: 5 },
  { id: "nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near", symbol: "USDC", chain: "Base", digits: 2 },
  { id: "nep141:arb-0xaf88d065e77c8cc2239327c5edb3a432268e5831.omft.near", symbol: "USDC", chain: "Arbitrum", digits: 2 },
  { id: "nep141:wrap.near", symbol: "NEAR", chain: "NEAR", digits: 3 },
];

export interface PayQuote {
  /** What the payer sends, at most. Anything not needed is refunded by 1Click. */
  amountIn: number;
  amountInUsd: number;
  amountOutUsd: number;
  seconds: number;
  at: number;
}

/** Live dry quote for delivering exactly `usdcRaw` (6 decimals) of USDC on NEAR. */
export async function quoteExactUsdc(asset: PayAsset, usdcRaw: bigint, signal?: AbortSignal): Promise<PayQuote> {
  const res = await fetch(`${API}/quote`, {
    method: "POST",
    signal,
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      dry: true,
      swapType: "EXACT_OUTPUT",
      slippageTolerance: 100,
      originAsset: asset.id,
      depositType: "ORIGIN_CHAIN",
      destinationAsset: USDC_ON_NEAR,
      amount: usdcRaw.toString(),
      refundTo: DRY_RUN_ACCOUNT,
      refundType: "INTENTS",
      recipient: DRY_RUN_ACCOUNT,
      recipientType: "DESTINATION_CHAIN",
      deadline: new Date(Date.now() + 3_600_000).toISOString(),
    }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.quote) throw new Error(typeof body.message === "string" ? body.message : `1Click answered ${res.status}`);
  const q = body.quote;
  return { amountIn: Number(q.amountInFormatted), amountInUsd: Number(q.amountInUsd), amountOutUsd: Number(q.amountOutUsd), seconds: Number(q.timeEstimate), at: Date.now() };
}
