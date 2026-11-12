// Shown to a visitor with no wallet connected: the three steps to try NearSeat
// (with test money on testnet, with a few cents of real USDC on mainnet), and a
// way to look around without a wallet.
import { MAINNET } from "../config";

export function NewHere() {
  const look = <>Just looking? <a className="text-lime underline" href="#/verify/seat-c5-12">Open a real membership</a> or <a className="text-lime underline" href="#/lab">see the attacks the contract refuses</a>, no wallet needed.</>;
  if (MAINNET) {
    return (
      <details className="mt-3 rounded-2xl border border-line bg-card-2 p-3 text-sm">
        <summary className="cursor-pointer font-semibold">First time here? This copy uses real USDC</summary>
        <ol className="mt-2 list-decimal space-y-1 pl-5 text-fg/80">
          <li>You need a NEAR mainnet wallet holding a little USDC on NEAR. Prices here are a few cents.</li>
          <li>Press Connect wallet.</li>
          <li>Buy a ticket or a membership. The contract is not audited, so don't put in more than you would hand a stranger.</li>
        </ol>
        <p className="mt-2 text-muted">Want to try everything for free? <a className="text-lime underline" href="/">Use the testnet site</a>. {look}</p>
      </details>
    );
  }
  return (
    <details className="mt-3 rounded-2xl border border-line bg-card-2 p-3 text-sm">
      <summary className="cursor-pointer font-semibold">First time here? Try it with test money</summary>
      <ol className="mt-2 list-decimal space-y-1 pl-5 text-fg/80">
        <li>Create a free test wallet at <a className="text-lime underline" href="https://testnet.mynearwallet.com" target="_blank" rel="noreferrer">testnet.mynearwallet.com</a>. It takes about a minute.</li>
        <li>Come back and press Connect wallet.</li>
        <li>Press Get 250 test tUSDC, then buy a ticket or a membership with it.</li>
      </ol>
      <p className="mt-2 text-muted">Nothing here costs real money. {look}</p>
    </details>
  );
}
