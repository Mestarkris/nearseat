// Calls back for contract events that happen while the page is open (not for
// the backlog already in the feed), so the map can react to a goal or full time.
import { useEffect, useRef } from "react";
import { view } from "../near/rpc";
import { config } from "../config";
import type { FeedItem } from "./types";

export type EventData = Record<string, unknown>;

export function useFeedEvents(onEvent: (event: string, data: EventData) => void) {
  const cb = useRef(onEvent);
  cb.current = onEvent;
  useEffect(() => {
    let alive = true;
    let since: string | undefined;
    let primed = false;
    const tick = async () => {
      try {
        const fresh = await view<FeedItem[]>("get_feed", since ? { since } : {});
        if (!alive) return;
        if (fresh.length) since = fresh[fresh.length - 1].seq;
        if (primed) {
          for (const it of fresh) {
            let d: EventData = {};
            try { d = JSON.parse(it.data) as EventData; } catch { /* keep empty */ }
            cb.current(it.event, d);
          }
        }
        primed = true;
      } catch { /* the next tick retries */ }
    };
    tick();
    const t = setInterval(tick, config.pollMs);
    return () => { alive = false; clearInterval(t); };
  }, []);
}
