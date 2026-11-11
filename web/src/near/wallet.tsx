// Wallet Selector (Meteor, HOT, MyNearWallet) + helpers for contract calls,
// tUSDC payments, NEP-413 signing and optional gasless relaying (NEP-366).
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { setupWalletSelector, type WalletSelector } from "@near-wallet-selector/core";
import { setupModal, type WalletSelectorModal } from "@near-wallet-selector/modal-ui";
import { setupMeteorWallet } from "@near-wallet-selector/meteor-wallet";
import { setupMyNearWallet } from "@near-wallet-selector/my-near-wallet";
import { setupHotWallet } from "@near-wallet-selector/hot-wallet";
import "@near-wallet-selector/modal-ui/styles.css";
import { JsonRpcProvider, actions as naj, buildDelegateAction, encodeSignedDelegate } from "near-api-js";
import { Buffer } from "buffer";
import { actionCreators } from "@near-js/transactions";
import { b64encode, randomNonce } from "@nearseat/shared";
import { config } from "../config";

const TGAS = 1_000_000_000_000n;
export const ONE_YOCTO = "1";

export interface SignedNep413 {
  accountId: string;
  publicKey: string;
  signature: string;
  message: string;
  nonce: string; // base64
}

interface WalletApi {
  ready: boolean;
  accountId: string | null;
  signIn: () => void;
  signOut: () => Promise<void>;
  /** Calls a NearSeat (or other) contract method from the signed-in wallet. */
  call: (method: string, args: object, opts?: { deposit?: string; gasTgas?: number; contractId?: string }) => Promise<unknown>;
  /** Pays NearSeat in tUSDC via ft_transfer_call. */
  payTusdc: (amountRaw: string, msg: object) => Promise<unknown>;
  /** Several tUSDC payments behind one wallet approval (one transaction each, so one can fail alone). */
  payTusdcMany: (items: { amountRaw: string; msg: object }[]) => Promise<unknown>;
  signMessage: (message: string, recipient: string) => Promise<SignedNep413>;
  gasless: boolean;
  setGasless: (v: boolean) => void;
}

const Ctx = createContext<WalletApi | null>(null);

export function WalletProvider({ children }: { children: ReactNode }) {
  const [selector, setSelector] = useState<WalletSelector>();
  const [modal, setModal] = useState<WalletSelectorModal>();
  const [accountId, setAccountId] = useState<string | null>(null);
  const [publicKey, setPublicKey] = useState<string | null>(null);
  const [gasless, setGasless] = useState(() => localStorageGet("nearseat:gasless") === "1");

  useEffect(() => {
    let sub: { unsubscribe: () => void } | undefined;
    (async () => {
      const s = await setupWalletSelector({
        network: config.network,
        modules: [setupMeteorWallet(), setupHotWallet(), setupMyNearWallet()],
      });
      const m = setupModal(s, { contractId: "", description: "NearSeat asks your wallet to sign. It never sees your keys." });
      const sync = (accs: { accountId: string; active: boolean; publicKey?: string }[]) => {
        const active = accs.find((a) => a.active) ?? accs[0];
        setAccountId(active?.accountId ?? null);
        setPublicKey(active?.publicKey ?? null);
      };
      sync(s.store.getState().accounts);
      sub = s.store.observable.subscribe((st) => sync(st.accounts));
      setSelector(s);
      setModal(m);
    })().catch((e) => console.error("wallet selector failed", e));
    return () => sub?.unsubscribe();
  }, []);

  useEffect(() => localStorageSet("nearseat:gasless", gasless ? "1" : "0"), [gasless]);

  const wallet = useCallback(async () => {
    if (!selector || !accountId) throw new Error("Connect a wallet first");
    return selector.wallet();
  }, [selector, accountId]);

  /** NEP-366: wallet signs a delegate action, the relayer pays gas. */
  const relay = useCallback(
    async (receiverId: string, action: ReturnType<typeof naj.functionCall>) => {
      const w = (await wallet()) as unknown as { signDelegateAction?: (d: unknown) => Promise<{ signedDelegate: unknown }> };
      if (typeof w.signDelegateAction !== "function" || !publicKey) throw new Error("wallet can't sign delegate actions");
      const provider = new JsonRpcProvider({ url: config.rpcUrl });
      const key = await provider.viewAccessKey({ accountId: accountId!, publicKey });
      const block = await provider.viewBlock({ finality: "final" });
      const delegate = buildDelegateAction({
        senderId: accountId!,
        receiverId,
        actions: [action],
        nonce: BigInt(key.nonce) + 1n,
        maxBlockHeight: BigInt(block.header.height) + 120n,
        publicKey: publicKey as never,
      });
      const { signedDelegate } = await w.signDelegateAction(delegate);
      const res = await fetch(`${config.relayerUrl}/relay`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ signedDelegate: b64encode(encodeSignedDelegate(signedDelegate as never)) }),
      });
      const body = await res.json();
      if (!body.ok) throw new Error(body.error);
      return body.outcome;
    },
    [wallet, accountId, publicKey],
  );

  const call = useCallback<WalletApi["call"]>(
    async (method, args, opts = {}) => {
      const receiverId = opts.contractId ?? config.contractId;
      const gas = BigInt(opts.gasTgas ?? 100) * TGAS;
      const deposit = opts.deposit ?? "0";
      if (gasless) {
        try {
          return await relay(receiverId, naj.functionCall(method, args, gas, BigInt(deposit)));
        } catch (e) {
          console.warn("gasless relay unavailable, falling back to a normal transaction:", e);
        }
      }
      const w = await wallet();
      return w.signAndSendTransaction({
        receiverId,
        // Wallet Selector speaks @near-js/transactions actions.
        actions: [actionCreators.functionCall(method, args, gas, BigInt(deposit))],
      });
    },
    [wallet, gasless, relay],
  );

  const payTusdc = useCallback<WalletApi["payTusdc"]>(
    (amountRaw, msg) =>
      call("ft_transfer_call", { receiver_id: config.contractId, amount: amountRaw, msg: JSON.stringify(msg) }, { deposit: ONE_YOCTO, gasTgas: 100, contractId: config.tusdcId }),
    [call],
  );

  const payTusdcMany = useCallback<WalletApi["payTusdcMany"]>(
    async (items) => {
      if (items.length === 1) return payTusdc(items[0].amountRaw, items[0].msg);
      const w = await wallet();
      return w.signAndSendTransactions({
        transactions: items.map((it) => ({
          receiverId: config.tusdcId,
          actions: [actionCreators.functionCall("ft_transfer_call", { receiver_id: config.contractId, amount: it.amountRaw, msg: JSON.stringify(it.msg) }, 100n * TGAS, BigInt(ONE_YOCTO))],
        })),
      });
    },
    [wallet, payTusdc],
  );

  const signMessage = useCallback<WalletApi["signMessage"]>(
    async (message, recipient) => {
      const w = await wallet();
      if (!w.signMessage) throw new Error("This wallet can't sign messages. Try Meteor, HOT or MyNearWallet.");
      const nonce = randomNonce();
      const signed = await w.signMessage({ message, recipient, nonce: Buffer.from(nonce) });
      if (!signed) throw new Error("Signing was cancelled");
      return { accountId: signed.accountId, publicKey: signed.publicKey, signature: signed.signature, message, nonce: b64encode(nonce) };
    },
    [wallet],
  );

  const api = useMemo<WalletApi>(
    () => ({
      ready: !!selector,
      accountId,
      signIn: () => modal?.show(),
      signOut: async () => {
        if (selector) await (await selector.wallet()).signOut();
      },
      call,
      payTusdc,
      payTusdcMany,
      signMessage,
      gasless,
      setGasless,
    }),
    [selector, modal, accountId, call, payTusdc, payTusdcMany, signMessage, gasless],
  );

  return <Ctx.Provider value={api}>{children}</Ctx.Provider>;
}

export function useWallet(): WalletApi {
  const v = useContext(Ctx);
  if (!v) throw new Error("useWallet outside WalletProvider");
  return v;
}

/** Turns "Smart contract panicked: X" deep in a wallet error into "X". */
export function friendlyError(e: unknown): string {
  const s = e instanceof Error ? e.message : typeof e === "string" ? e : JSON.stringify(e);
  const m = /panicked: ([^"\\]+)/.exec(s) ?? /ExecutionError":"([^"]+)/.exec(s);
  return m ? m[1] : s;
}

function localStorageGet(k: string): string | null {
  try { return localStorage.getItem(k); } catch { return null; }
}
function localStorageSet(k: string, v: string) {
  try { localStorage.setItem(k, v); } catch { /* private mode */ }
}
