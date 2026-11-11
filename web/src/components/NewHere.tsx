// Shown to a visitor with no wallet connected: the three steps to try NearSeat
// with test money, and a way to look around without a wallet.
export function NewHere() {
  return (
    <details className="mt-3 rounded-2xl border border-line bg-card-2 p-3 text-sm">
      <summary className="cursor-pointer font-semibold">First time here? Try it with test money</summary>
      <ol className="mt-2 list-decimal space-y-1 pl-5 text-fg/80">
        <li>Create a free test wallet at <a className="text-lime underline" href="https://testnet.mynearwallet.com" target="_blank" rel="noreferrer">testnet.mynearwallet.com</a>. It takes about a minute.</li>
        <li>Come back and press Connect wallet.</li>
        <li>Press Get 250 test tUSDC, then buy a ticket or a membership with it.</li>
      </ol>
      <p className="mt-2 text-muted">Nothing here costs real money. Just looking? <a className="text-lime underline" href="#/verify/seat-c5-12">Open a real membership</a> or <a className="text-lime underline" href="#/lab">see the attacks the contract refuses</a>, no wallet needed.</p>
    </details>
  );
}
