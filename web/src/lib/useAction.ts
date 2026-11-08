import { useState } from "react";
import { friendlyError } from "../near/wallet";

export interface ActionState {
  busy: string | null;
  error: string | null;
  done: string | null;
  run: (label: string, fn: () => Promise<unknown>, success?: string) => Promise<boolean>;
  clear: () => void;
}

/** Wraps a wallet call with pending / error / success state for the UI. */
export function useAction(onDone?: () => void): ActionState {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  return {
    busy,
    error,
    done,
    clear: () => { setError(null); setDone(null); },
    run: async (label, fn, success) => {
      setBusy(label);
      setError(null);
      setDone(null);
      try {
        await fn();
        setDone(success ?? `${label}: done`);
        onDone?.();
        return true;
      } catch (e) {
        setError(friendlyError(e));
        return false;
      } finally {
        setBusy(null);
      }
    },
  };
}
