// Gate scanner (staff). Reads a QR with the camera (jsQR) or a pasted payload,
// sends it to the relayer's /gate/scan, which verifies it and calls check_in
// as the gate account. The contract re-checks the holder on-chain.
import { useEffect, useRef, useState } from "react";
import jsQR from "jsqr";
import { config } from "../config";

type Result = { ok: true; holder: string; tokenId: string; matchId: number } | { ok: false; error: string };

export function ScanPage() {
  const video = useRef<HTMLVideoElement>(null);
  const [camera, setCamera] = useState(false);
  const [paste, setPaste] = useState("");
  const [result, setResult] = useState<Result>();
  const [busy, setBusy] = useState(false);
  const last = useRef("");

  const submit = async (qr: string) => {
    if (busy || qr === last.current) return;
    last.current = qr;
    setBusy(true);
    try {
      const r = await fetch(`${config.relayerUrl}/gate/scan`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ qr }) });
      setResult(await r.json());
    } catch (e) {
      setResult({ ok: false, error: `Scanner can't reach ${config.relayerUrl}: ${(e as Error).message}` });
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (!camera) return;
    let stream: MediaStream | undefined;
    let raf = 0;
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
        if (!video.current) return;
        video.current.srcObject = stream;
        await video.current.play();
        const loop = () => {
          const v = video.current;
          if (v && v.readyState === v.HAVE_ENOUGH_DATA) {
            canvas.width = v.videoWidth;
            canvas.height = v.videoHeight;
            ctx.drawImage(v, 0, 0);
            const code = jsQR(ctx.getImageData(0, 0, canvas.width, canvas.height).data, canvas.width, canvas.height);
            if (code?.data) submit(code.data);
          }
          raf = requestAnimationFrame(loop);
        };
        loop();
      } catch (e) {
        setResult({ ok: false, error: `Camera unavailable: ${(e as Error).message}. Paste the pass instead.` });
        setCamera(false);
      }
    })();
    return () => { cancelAnimationFrame(raf); stream?.getTracks().forEach((t) => t.stop()); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [camera]);

  return (
    <div className="mx-auto max-w-md">
      <h1 className="text-3xl font-extrabold">Gate scanner</h1>
      <p className="mt-2 text-sm text-muted">Staff device. Each scan is checked against the chain; a valid pass records attendance on-chain.</p>
      <div className={`mt-4 rounded-3xl border-4 p-2 ${result ? (result.ok ? "border-lime" : "border-danger") : "border-line"}`}>
        {camera ? <video ref={video} className="w-full rounded-2xl" muted playsInline /> : (
          <button className="btn-primary w-full justify-center py-4" onClick={() => setCamera(true)}>Start camera</button>
        )}
      </div>
      <div aria-live="assertive" className="mt-4">
        {busy && <p className="text-muted">Checking on-chain…</p>}
        {result && (result.ok ? (
          <div className="rounded-2xl bg-lime p-4 text-ink"><div className="text-2xl font-extrabold">✓ Welcome in</div><div className="text-sm">{result.holder} · {result.tokenId} · match {result.matchId} · attendance recorded</div></div>
        ) : (
          <div className="rounded-2xl bg-danger/20 p-4 text-danger"><div className="text-2xl font-extrabold">✗ Refused</div><div className="text-sm">{result.error}</div></div>
        ))}
      </div>
      <details className="mt-6">
        <summary className="cursor-pointer text-sm text-muted">No camera? Paste a pass payload</summary>
        <textarea className="input mt-2 h-28" value={paste} onChange={(e) => setPaste(e.target.value)} aria-label="Pass payload" />
        <button className="btn-ghost mt-2" onClick={() => { last.current = ""; submit(paste.trim()); }}>Check pass</button>
      </details>
    </div>
  );
}
