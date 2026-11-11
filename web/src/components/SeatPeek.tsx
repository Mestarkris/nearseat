// Tap a member's seat on the map and the square grows into that membership's
// card (a view transition where the browser has them; a plain open elsewhere).
import { useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { view } from "../near/rpc";
import { usePoll } from "../lib/usePoll";
import { reduced } from "../lib/motion";
import type { Membership } from "../lib/types";
import { MembershipCard } from "./MembershipCard";
import { Loading } from "./ui";

const NAME = "seat-card";
type Doc = Document & { startViewTransition?: (update: () => void) => { finished: Promise<void> } };

export function useSeatPeek() {
  const [tokenId, setTokenId] = useState<string>();
  const seat = useRef<HTMLElement | null>(null);

  const morph = (update: () => void, seatHasName: "before" | "after") => {
    const doc = document as Doc;
    const el = seat.current;
    if (!doc.startViewTransition || reduced() || !el?.isConnected) { update(); return; }
    if (seatHasName === "before") el.style.setProperty("view-transition-name", NAME);
    const t = doc.startViewTransition(() => {
      flushSync(update);
      if (seatHasName === "before") el.style.removeProperty("view-transition-name");
      else el.style.setProperty("view-transition-name", NAME);
    });
    t.finished.finally(() => el.style.removeProperty("view-transition-name"));
  };

  return {
    tokenId,
    open: (id: string, el: HTMLElement) => { seat.current = el; morph(() => setTokenId(id), "before"); },
    close: () => { morph(() => setTokenId(undefined), "after"); seat.current?.focus(); },
  };
}

export function SeatPeek({ tokenId, known, onClose }: { tokenId: string; known?: Membership; onClose: () => void }) {
  const d = usePoll(() => view<Membership | null>("membership", { token_id: tokenId }), [tokenId], 8_000);
  const m = d.data ?? known;
  const closeBtn = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    closeBtn.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <div className="fixed inset-0 z-40 grid place-items-center overflow-y-auto bg-ink/85 p-4 backdrop-blur-sm" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label={`Membership ${tokenId}`} className="w-full max-w-[360px]" onClick={(e) => e.stopPropagation()}>
        <div style={{ viewTransitionName: NAME }} className="min-h-[430px] rounded-[var(--radius-card)]">
          {m ? <MembershipCard m={m} compact /> : <div className="card grid min-h-[430px] place-items-center"><Loading what="Reading the seat" /></div>}
        </div>
        {m && <p className="mt-3 truncate text-center text-sm text-muted">Held by <span className="text-white">{m.owner_id}</span></p>}
        <div className="mt-3 grid grid-cols-3 gap-2">
          <a className="btn-ghost justify-center px-2" href={`#/verify/${tokenId}`}>History</a>
          <a className="btn-ghost justify-center px-2" href={`#/statement/${tokenId}`}>Statement</a>
          <button ref={closeBtn} className="btn-primary justify-center px-2" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
