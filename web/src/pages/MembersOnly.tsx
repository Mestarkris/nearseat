// Members-only page. Content comes from the relayer, which verifies a fresh
// NEP-413 signature (single-use nonce) and the LIVE on-chain owner on every load.
// Nothing here is cached: sell the membership and the next load is refused.
import { useState } from "react";
import { MEMBERS_RECIPIENT, membersMessage } from "@nearseat/shared";
import { view } from "../near/rpc";
import { useWallet, friendlyError } from "../near/wallet";
import { usePoll } from "../lib/usePoll";
import type { Membership } from "../lib/types";
import { config } from "../config";
import { Empty, Loading } from "../components/ui";

interface Content { headline: string; perks: string[]; notice: string }

export function MembersOnlyPage() {
  const { accountId, signIn, signMessage } = useWallet();
  const mine = usePoll(() => (accountId ? view<Membership[]>("memberships_for_owner", { account_id: accountId }) : Promise.resolve([])), [accountId], 30_000);
  const [content, setContent] = useState<Content>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [tokenId, setTokenId] = useState("");

  if (!accountId) return <Empty title="Members only"><p>Connect the wallet that holds a membership.</p><button className="btn-primary mt-4" onClick={signIn}>Connect wallet</button></Empty>;
  if (mine.loading && !mine.data) return <Loading />;
  const token = tokenId || mine.data?.[0]?.token_id || "seat-c5-12";

  const open = async () => {
    setBusy(true);
    setError(undefined);
    setContent(undefined);
    try {
      const signed = await signMessage(membersMessage({ accountId, tokenId: token, issuedAt: Date.now() }), MEMBERS_RECIPIENT);
      const r = await fetch(`${config.relayerUrl}/members`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(signed) });
      const body = await r.json();
      if (!body.ok) throw new Error(body.error);
      setContent(body.content);
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="text-4xl font-extrabold">Members only</h1>
      <p className="mt-2 text-white/70">Opens only for the current holder. Your wallet signs a one-time message; the server checks it and the live owner on-chain on every visit.</p>
      <div className="mt-4 flex gap-2">
        <input className="input" value={token} onChange={(e) => setTokenId(e.target.value)} aria-label="Membership to prove" />
        <button className="btn-primary" onClick={open} disabled={busy}>{busy ? "Checking…" : "Open"}</button>
      </div>
      {error && <p className="mt-4 rounded-2xl border border-danger/40 bg-danger/10 p-4 text-danger" role="alert">🔒 Locked: {error}</p>}
      {content && (
        <section className="card-glow mt-6 p-6">
          <h2 className="text-2xl font-bold">{content.headline}</h2>
          <ul className="mt-4 space-y-2">{content.perks.map((p) => <li key={p} className="rounded-xl bg-ink/70 p-3">{p}</li>)}</ul>
          <p className="mt-4 text-xs text-muted">{content.notice}</p>
        </section>
      )}
    </div>
  );
}
