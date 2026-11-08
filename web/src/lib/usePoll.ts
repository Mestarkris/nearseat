import { useCallback, useEffect, useRef, useState } from "react";
import { config } from "../config";

export interface Polled<T> {
  data: T | undefined;
  error: unknown;
  loading: boolean;
  refresh: () => void;
}

/**
 * Runs `load` now and every `config.pollMs` (3–5 s) while the tab is visible.
 * Keeps the last good data on a transient error so the UI doesn't flicker.
 */
export function usePoll<T>(load: () => Promise<T>, deps: unknown[], intervalMs = config.pollMs): Polled<T> {
  const [data, setData] = useState<T>();
  const [error, setError] = useState<unknown>();
  const [loading, setLoading] = useState(true);
  const loadRef = useRef(load);
  loadRef.current = load;

  const run = useCallback(async () => {
    try {
      const next = await loadRef.current();
      setData(next);
      setError(undefined);
    } catch (e) {
      setError(e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    setLoading(true);
    setData(undefined);
    run();
    const t = setInterval(() => {
      if (document.visibilityState === "visible") run();
    }, intervalMs);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return { data, error, loading, refresh: run };
}
