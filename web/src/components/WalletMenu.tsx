// The connected wallet in the header. One click opens a short menu, so
// signing out is a deliberate choice and not what happens when you tap your name.
import { useEffect, useRef, useState } from "react";
import { useWallet } from "../near/wallet";
import { view } from "../near/rpc";
import { short } from "../lib/format";
import type { Membership } from "../lib/types";

const item = "flex w-full items-center justify-between gap-3 rounded-xl px-3 py-2.5 text-left text-sm text-white/90 hover:bg-card-2 focus-visible:bg-card-2 focus-visible:outline-none";

export function WalletMenu({ accountId }: { accountId: string }) {
  const { signOut } = useWallet();
  const [open, setOpen] = useState(false);
  const [seats, setSeats] = useState<Membership[] | null>(null);
  const [copied, setCopied] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);

  // Read this wallet's memberships the first time the menu opens.
  useEffect(() => {
    if (!open || seats) return;
    let live = true;
    view<Membership[]>("memberships_for_owner", { account_id: accountId }).then((m) => { if (live) setSeats(m); }, () => { if (live) setSeats([]); });
    return () => { live = false; };
  }, [open, seats, accountId]);
  useEffect(() => setSeats(null), [accountId]);

  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    const outside = (e: PointerEvent) => { if (!root.current?.contains(e.target as Node)) close(); };
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") { close(); button.current?.focus(); } };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", key);
    addEventListener("hashchange", close);
    return () => { document.removeEventListener("pointerdown", outside); document.removeEventListener("keydown", key); removeEventListener("hashchange", close); };
  }, [open]);

  const copy = async () => {
    try { await navigator.clipboard.writeText(accountId); setCopied(true); setTimeout(() => setCopied(false), 1600); } catch { /* clipboard blocked: the full address is shown above */ }
  };

  return (
    <div ref={root} className="relative ml-auto lg:ml-0">
      <button ref={button} className="btn-ghost" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <span className="size-2 rounded-full bg-lime" aria-hidden />
        {short(accountId, 20)}
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden className={`transition-transform ${open ? "rotate-180" : ""}`}><path d="M1.5 3.5 5 7l3.5-3.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
      </button>
      {open && (
        <div role="menu" aria-label="Wallet" className="wallet-menu absolute right-0 top-full z-40 mt-2 w-72 max-w-[calc(100vw-2rem)] rounded-2xl border border-line bg-card p-1.5 shadow-[0_24px_48px_-16px_rgb(0_0_0/.8)]">
          <div className="px-3 pb-2 pt-2">
            <div className="text-xs text-muted">Connected wallet</div>
            <div className="mono mt-0.5 break-all text-sm text-white">{accountId}</div>
          </div>
          <div className="border-t border-line pt-1.5">
            <a role="menuitem" href="#/member" className={item}>My membership</a>
            {seats === null && <div className="px-3 py-2.5 text-sm text-muted">Looking for your seat…</div>}
            {seats?.map((m) => (
              <a key={m.token_id} role="menuitem" href={`#/statement/${m.token_id}`} className={item}>
                Season statement <span className="mono text-xs text-muted">{m.token_id.replace(/^seat-/, "").toUpperCase()}</span>
              </a>
            ))}
            {seats?.length === 0 && <a role="menuitem" href="#/join" className={item}>Become a member <span className="text-xs text-muted">No seat yet</span></a>}
            <button role="menuitem" className={item} onClick={copy}>{copied ? "Address copied" : "Copy address"}</button>
          </div>
          <div className="mt-1.5 border-t border-line pt-1.5">
            <button role="menuitem" className={`${item} text-danger`} onClick={() => { setOpen(false); signOut(); }}>Disconnect</button>
          </div>
        </div>
      )}
    </div>
  );
}
