// Gets free tUSDC (a valueless test token) for the connected wallet:
// registers NEP-145 storage if needed, then calls the faucet.
import { view, ftBalance } from "../near/rpc";
import { useWallet } from "../near/wallet";
import { usePoll } from "../lib/usePoll";
import { useAction } from "../lib/useAction";
import { config } from "../config";
import { usd } from "../lib/format";
import { ActionStatus } from "./ActionStatus";

export function Faucet() {
  const { accountId, call } = useWallet();
  const bal = usePoll(() => (accountId ? ftBalance(accountId).catch(() => "0") : Promise.resolve("0")), [accountId], 10_000);
  const a = useAction(bal.refresh);
  if (!accountId) return null;
  const get = async () => {
    const registered = await view("storage_balance_of", { account_id: accountId }, config.tusdcId);
    if (!registered) {
      await call("storage_deposit", { account_id: accountId, registration_only: true }, { contractId: config.tusdcId, deposit: "12500000000000000000000" });
    }
    await call("faucet", { amount: "100000000" }, { contractId: config.tusdcId });
  };
  return (
    <div className="rounded-2xl border border-line p-3 text-sm">
      <div className="flex items-center justify-between gap-2">
        <span className="text-muted">Your tUSDC: <b className="text-white">{usd(bal.data ?? "0")}</b></span>
        <button className="btn-ghost py-1" disabled={!!a.busy} onClick={() => a.run("Getting test tUSDC", get, "+100 tUSDC (test token, no value)")}>Get 100 test tUSDC</button>
      </div>
      <ActionStatus a={a} />
    </div>
  );
}
