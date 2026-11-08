// Rotating gate pass. One wallet signature (NEP-413) authorises a session key
// kept only in this tab's memory; the QR is re-signed every 5 s and is only
// valid for 30 s. Works for the holder, a match's renter, or a ticket holder.
import { useEffect, useMemo, useRef, useState } from "react";
import QRCode from "qrcode";
import { GATE_RECIPIENT, certMessage, makePass, newSessionKey } from "@nearseat/shared";
import { view } from "../near/rpc";
import { useWallet, friendlyError } from "../near/wallet";
import { usePoll } from "../lib/usePoll";
import type { Match, Membership, TicketInfo } from "../lib/types";
import { seatLabel, shortDate } from "../lib/format";
import { Empty, Loading } from "../components/ui";

interface Pass { tokenId: string; matchId: number; label: string }

export function PassPage({ tokenId }: { tokenId?: string }) {
  const { accountId, signIn } = useWallet();
  const d = usePoll(async () => {
    if (!accountId) return null;
    const [matches, mine, tickets] = await Promise.all([
      view<Match[]>("get_matches"),
      view<Membership[]>("memberships_for_owner", { account_id: accountId }),
      view<[string, TicketInfo][]>("tickets_for_owner", { account_id: accountId }),
    ]);
    const open = matches.filter((m) => m.status === "Scheduled" || m.status === "Live");
    const passes: Pass[] = [];
    for (const m of open) {
      for (const mem of mine) {
        const loan = mem.loans.find((l) => l.match_id === m.id)?.loan;
        if (!(loan && "Rented" in loan)) passes.push({ tokenId: mem.token_id, matchId: m.id, label: `${seatLabel(mem.seat)} · v ${m.opponent} · ${shortDate(m.kickoff_at)}` });
      }
      for (const [id, t] of tickets) if (t.match_id === m.id) passes.push({ tokenId: id, matchId: m.id, label: `Ticket ${t.seat.toUpperCase()} · v ${m.opponent}` });
    }
    // Seats rented TO this account (renter's pass).
    if (tokenId && !passes.some((p) => p.tokenId === tokenId)) {
      for (const m of open) {
        const holder = await view<string>("holder_for", { token_id: tokenId, match_id: m.id }).catch(() => null);
        if (holder === accountId) passes.push({ tokenId, matchId: m.id, label: `Rented seat ${tokenId} · v ${m.opponent}` });
      }
    }
    return passes;
  }, [accountId, tokenId], 30_000);

  if (!accountId) return <Empty title="Connect the wallet that holds the seat"><button className="btn-primary mt-4" onClick={signIn}>Connect wallet</button></Empty>;
  if (d.loading && !d.data) return <Loading what="Finding your passes" />;
  const passes = d.data ?? [];
  if (!passes.length) return <Empty title="No pass for an upcoming match">Members, renters and ticket holders see their pass here on match day.</Empty>;
  const initial = passes.find((p) => p.tokenId === tokenId) ?? passes[0];
  return <PassView passes={passes} initial={initial} />;
}

function PassView({ passes, initial }: { passes: Pass[]; initial: Pass }) {
  const { signMessage } = useWallet();
  const [pass, setPass] = useState(initial);
  const [cert, setCert] = useState<Awaited<ReturnType<typeof signMessage>>>();
  const [error, setError] = useState<string>();
  const [qr, setQr] = useState<string>();
  const [now, setNow] = useState(Date.now());
  const session = useMemo(() => newSessionKey(), []);
  const signedAt = useRef(0);

  const start = async () => {
    setError(undefined);
    try {
      const message = certMessage({ tokenId: pass.tokenId, matchId: pass.matchId, sessionKey: session.publicKey, expiresAt: Date.now() + 6 * 3600_000 });
      setCert(await signMessage(message, GATE_RECIPIENT));
    } catch (e) {
      setError(friendlyError(e));
    }
  };

  useEffect(() => {
    if (!cert) return;
    const render = async () => {
      const t = Date.now();
      signedAt.current = t;
      const payload = makePass({ cert, session, tokenId: pass.tokenId, matchId: pass.matchId, now: t });
      setQr(await QRCode.toDataURL(payload, { margin: 1, scale: 6, errorCorrectionLevel: "L", color: { dark: "#0A0C0F", light: "#FFFFFF" } }));
    };
    render();
    const t1 = setInterval(render, 5_000);
    const t2 = setInterval(() => setNow(Date.now()), 250);
    return () => { clearInterval(t1); clearInterval(t2); };
  }, [cert, session, pass]);

  const age = Math.max(0, Math.floor((now - signedAt.current) / 1000));
  return (
    <div className="mx-auto max-w-md">
      <h1 className="text-3xl font-extrabold">Gate pass</h1>
      <select className="input mt-4" value={`${pass.tokenId}|${pass.matchId}`} onChange={(e) => { const [t, m] = e.target.value.split("|"); setCert(undefined); setPass(passes.find((p) => p.tokenId === t && p.matchId === Number(m))!); }} aria-label="Choose pass">
        {passes.map((p) => <option key={`${p.tokenId}|${p.matchId}`} value={`${p.tokenId}|${p.matchId}`}>{p.label}</option>)}
      </select>
      <div className="card-glow mt-4 p-6 text-center">
        {!cert ? (
          <>
            <p className="text-sm text-white/80">Sign once with your wallet. Your phone then shows a code that changes every 5 seconds and expires after 30, so screenshots and forwarded codes don't work.</p>
            <button className="btn-primary mt-4" onClick={start}>Show my pass</button>
            {error && <p className="mt-3 text-sm text-danger" role="alert">{error}</p>}
          </>
        ) : (
          <>
            {qr ? <img src={qr} alt="Rotating gate pass QR code" className="mx-auto w-64 rounded-2xl bg-white p-2" /> : <Loading />}
            <div className="mt-3 font-display text-lg font-bold">{pass.label}</div>
            <div className="mt-1 text-sm text-muted">Refreshes in {Math.max(0, 5 - age)}s · valid 30 s · signed by {cert.accountId}</div>
            <div className="mx-auto mt-3 h-1.5 w-48 rounded-full bg-line"><div className="h-full rounded-full bg-lime transition-[width]" style={{ width: `${Math.max(0, 100 - age * 20)}%` }} /></div>
          </>
        )}
      </div>
      <p className="mt-4 text-center text-xs text-muted">The gate checks the chain at scan time. If you sell or lend this seat, this pass stops working.</p>
    </div>
  );
}
