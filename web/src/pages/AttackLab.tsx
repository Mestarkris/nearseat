// Attack Lab: documented attacks, each with its mitigation, the test that proves
// it, and (where it can be tried from a browser wallet) a button that sends the
// attack to testnet so you can watch the contract refuse it.
import { useState } from "react";
import { useWallet, friendlyError } from "../near/wallet";
import { config } from "../config";
import { toRaw } from "../lib/format";

type Actor = "Seller" | "Previous owner" | "Renter" | "Tout" | "Outsider" | "Club";

interface Attack {
  id: string;
  actor: Actor;
  title: string;
  path: string;
  fix: string;
  tests: string[];
  attempt?: (w: ReturnType<typeof useWallet>) => Promise<unknown>;
}

const T = "seat-c5-12";
const borshPay = (token: string, to: string) => {
  const enc = new TextEncoder();
  const parts: number[] = [];
  for (const s of [token, to]) {
    const b = enc.encode(s);
    parts.push(...new Uint8Array(new Uint32Array([b.length]).buffer), ...b);
  }
  parts.push(...new Uint8Array(16).fill(0).map((_, i) => (i === 0 ? 1 : 0)));
  return new Uint8Array(parts);
};

const ATTACKS: Attack[] = [
  { id: "T5", actor: "Outsider", title: "Call the vault directly", path: `Anyone calls pay() on ${T}.${config.contractId} to drain it.`, fix: "The vault obeys only its parent contract (predecessor check). No other code path exists.", tests: ["sandbox: vault_is_keyless_runs_global_code_and_obeys_only_parent", "vault unit: parent_is_everything_after_the_first_dot"],
    attempt: (w) => w.call("pay", borshPay(config.tusdcId, w.accountId ?? "x") as never, { contractId: `${T}.${config.contractId}`, gasTgas: 30 }) },
  { id: "T1", actor: "Previous owner", title: "Keep a key on the vault", path: "Create the vault with an access key, keep it, sign from the vault after selling.", fix: "Vaults are created with CreateAccount + Transfer + UseGlobalContract only, never AddKey. Verify shows 0 keys live.", tests: ["sandbox: vault_is_keyless_runs_global_code_and_obeys_only_parent"] },
  { id: "T12", actor: "Previous owner", title: "Withdraw after selling", path: "Old owner calls withdraw() on the membership they sold.", fix: "Every action reads the live NEP-171 owner in the same receipt. No cached ownership.", tests: ["unit: old_owner_cannot_withdraw_after_sale", "sandbox: sale_mid_payout_buyer_receives_settlement"],
    attempt: (w) => w.call("withdraw", { token_id: T, amount: "1" }, { deposit: "1" }) },
  { id: "T12b", actor: "Previous owner", title: "Reuse an old gate pass or members session", path: "Keep a QR or a signed members-only message from before the sale.", fix: "Scanner and members API re-check the live owner on every scan or load; QR expires in 30 s; members nonces are single-use.", tests: ["shared: old owner's pass fails after a sale (T12)", "shared: members-only request: valid once, replay rejected, non-holder rejected"] },
  { id: "T6", actor: "Seller", title: "Drain the vault while listed", path: "List at 200, buyer sees 80 tUSDC inside, seller withdraws before the buy lands.", fix: "Listing freezes the vault: withdraw, lend and borrow are refused.", tests: ["unit: withdraw_blocked_while_listed"] },
  { id: "T7", actor: "Seller", title: "Change the vault between look and buy", path: "Delist, withdraw, relist at the same price.", fix: "Every outflow and (de)list bumps a nonce; buy() needs the nonce the buyer saw, else full refund.", tests: ["sandbox: wrong_nonce_refunds_buyer_and_keeps_owner", "unit: wrong_nonce_rejected"] },
  { id: "T8", actor: "Seller", title: "Sell mid-withdrawal", path: "Start withdraw(), get the sale in before the callback.", fix: "Withdrawals mark themselves in flight; buy() refuses until the callback ran.", tests: ["unit: buy_rejected_during_inflight_withdraw"] },
  { id: "T9", actor: "Seller", title: "Pocket a payout that lands after the sale", path: "Payout transfer is in flight when the membership sells.", fix: "Payouts are owed to the token and land in the vault; the new holder withdraws them.", tests: ["sandbox: sale_mid_payout_buyer_receives_settlement", "unit: sale_mid_payout_buyer_receives_settlement"] },
  { id: "T41", actor: "Seller", title: "Borrow, then sell or gift", path: "Take an advance on future earnings, then transfer the membership away.", fix: "Plain transfer is blocked with an open advance; a sale repays it from the price first.", tests: ["sandbox: advance_repaid_on_sale", "unit: plain_transfer_blocked_with_open_advance"] },
  { id: "T45", actor: "Seller", title: "Vote, sell, vote again", path: "Buyer votes again with the same membership.", fix: "Votes are keyed by (poll, membership), not by account.", tests: ["sandbox: double_vote_blocked_after_sale", "unit: double_vote_blocked_after_sale"] },
  { id: "T27", actor: "Renter", title: "Use the seat after the loan", path: "Renter scans the pass after full time or at the next match.", fix: "A loan covers one match; full time / postponement closes the gates for it.", tests: ["sandbox: renter_and_old_owner_locked_out", "unit: renter_locked_out_after_full_time"] },
  { id: "T28", actor: "Renter", title: "Owner and renter both enter", path: "Owner lends the seat and still scans in.", fix: "While rented, only the renter is a valid holder for that match.", tests: ["unit: owner_refused_while_lent"] },
  { id: "T13", actor: "Tout", title: "List a membership at 10×", path: "List at 2,000 tUSDC.", fix: "list() and NEP-199 payouts reject prices above the 120% cap.", tests: ["sandbox: price_caps_enforced", "unit: price_above_cap_rejected"],
    attempt: (w) => w.call("list", { token_id: T, price: toRaw("2000") }, { deposit: "1" }) },
  { id: "T23", actor: "Tout", title: "Sell a member's seat without consent", path: `Buy seat C5-12 for a match its member didn't lend.`, fix: "Member seats are only sold if the member offered them for that match; payment is refunded.", tests: ["unit: cannot_sell_unlent_member_seat"],
    attempt: (w) => w.payTusdc("1000000", { action: "buy_seat", match_id: 1, seat: "c5-12" }) },
  { id: "T24", actor: "Tout", title: "Bulk-buy single tickets", path: "Buy 50 seats from one account and resell them.", fix: "4 per account per match; single tickets are soulbound NFTs.", tests: ["unit: per_account_ticket_cap", "unit: ticket_nft_transfer_rejected"] },
  { id: "T31", actor: "Outsider", title: "Screenshot a gate pass", path: "Photograph someone's QR and show it at the gate later.", fix: "The QR is re-signed every 5 s and rejected after 30 s.", tests: ["shared: screenshot older than 30 s is rejected (T31)"],
    attempt: async () => {
      const r = await fetch(`${config.relayerUrl}/gate/scan`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ qr: JSON.stringify({ v: 1, cert: { message: "{}" }, ts: Date.now() - 120_000, sig: "AA==" }) }) });
      const b = await r.json();
      if (!b.ok) throw new Error(b.error);
      return b;
    } },
  { id: "T32", actor: "Outsider", title: "Forge a pass for someone else's seat", path: "Sign a gate certificate naming Alice with your own key.", fix: "The signing key must be a full-access key of the named holder, and the holder must be live.", tests: ["shared: certificate signed by a key that isn't the holder's full-access key fails (T32)"] },
  { id: "T33", actor: "Outsider", title: "Fake your attendance", path: "Call check_in() yourself to farm tiers.", fix: "Only the gate role can check in, and only the live holder, only while gates are open.", tests: ["sandbox: goal_stamps_only_for_checked_in_members", "unit: non_gate_cannot_check_in"],
    attempt: (w) => w.call("check_in", { token_id: T, match_id: 1, holder: w.accountId }) },
  { id: "T34", actor: "Outsider", title: "Fake a goal stamp", path: "Call goal() to stamp your membership.", fix: "goal() is club-only and only while live; stamps go only to members checked in before the goal.", tests: ["sandbox: goal_stamps_only_for_checked_in_members", "unit: goal_stamps_only_for_checked_in_members"],
    attempt: (w) => w.call("goal", { match_id: 1, side: "Home", scorer: "Me" }) },
  { id: "T38", actor: "Club", title: "Club takes members' money", path: "Club withdraws from a member vault or sets the members' cut to 0.", fix: "No club path touches vaults; fee setters are clamped to hard-coded bounds.", tests: ["unit: club_cannot_move_member_funds", "unit: admin_setters_clamped"],
    attempt: (w) => w.call("set_config", { config: { members_cut_bps: 0, lend_club_fee_bps: 500, lend_cap_bps: 15000, resale_fee_bps: 500, resale_cap_bps: 12000, max_tickets_per_account: 4, tier_thresholds: [1, 2, 3], advance_cap_bps: 5000, expected_share_per_match: "1000000" } }) },
  { id: "T10", actor: "Outsider", title: "Make a payout fail to lose funds", path: "Force the transfer into a vault (or to a seller) to fail.", fix: "Every cross-contract call has a callback that restores state; person payouts park in claimable.", tests: ["sandbox: failed_settlement_callback_restores_state", "sandbox: failed_withdraw_callback_restores_vault_balance", "unit: postpone_refunds_once_and_parks_failures"] },
];

export function AttackLabPage() {
  const w = useWallet();
  const [results, setResults] = useState<Record<string, { state: "busy" | "refused" | "passed"; msg: string }>>({});
  const [actor, setActor] = useState<Actor | "All">("All");
  const go = async (a: Attack) => {
    if (!w.accountId && a.id !== "T31") return w.signIn();
    setResults((r) => ({ ...r, [a.id]: { state: "busy", msg: "Sending the attack…" } }));
    try {
      await a.attempt!(w);
      setResults((r) => ({ ...r, [a.id]: { state: "passed", msg: "The call did not fail. If you hold this membership or are the club, this was a legitimate action. Try from another account." } }));
    } catch (e) {
      setResults((r) => ({ ...r, [a.id]: { state: "refused", msg: friendlyError(e) } }));
    }
  };
  const actors: (Actor | "All")[] = ["All", "Seller", "Previous owner", "Renter", "Tout", "Outsider", "Club"];
  const shown = ATTACKS.filter((a) => actor === "All" || a.actor === actor);
  return (
    <div>
      <h1 className="text-4xl font-extrabold sm:text-5xl">Attack Lab</h1>
      <p className="mt-2 max-w-3xl text-white/70">
        {ATTACKS.length} attacks against NearSeat, each with the mitigation and the test that proves it. Where a browser wallet can attempt it, press
        <b> Try it on testnet</b>: the transaction is really sent, and you see the contract refuse it. Full model: <code>docs/THREAT_MODEL.md</code>.
      </p>
      <div className="mt-5 flex flex-wrap gap-2">
        {actors.map((x) => <button key={x} className={actor === x ? "btn-primary" : "btn-ghost"} onClick={() => setActor(x)}>{x}</button>)}
      </div>
      <div className="mt-6 grid gap-4 md:grid-cols-2">
        {shown.map((a) => {
          const r = results[a.id];
          return (
            <article key={a.id} className="card p-5">
              <div className="flex items-center justify-between gap-2"><span className="chip">{a.actor}</span><span className="mono text-xs text-muted">{a.id}</span></div>
              <h2 className="mt-3 text-lg font-bold">{a.title}</h2>
              <p className="mt-1 text-sm text-white/80"><b className="text-danger">Attack:</b> {a.path}</p>
              <p className="mt-1 text-sm text-white/80"><b className="text-lime">Mitigation:</b> {a.fix}</p>
              <ul className="mt-2 space-y-0.5 text-xs text-muted">{a.tests.map((t) => <li key={t} className="mono break-all">✓ {t}</li>)}</ul>
              {a.attempt && <button className="btn-ghost mt-3" disabled={r?.state === "busy"} onClick={() => go(a)}>Try it on testnet</button>}
              {r && (
                <p className={`mt-3 rounded-xl p-3 text-sm ${r.state === "refused" ? "bg-lime/15 text-lime" : r.state === "passed" ? "bg-warn/15 text-warn" : "text-muted"}`} role="status">
                  {r.state === "refused" ? `🛡 Refused by the chain: ${r.msg}` : r.msg}
                </p>
              )}
            </article>
          );
        })}
      </div>
    </div>
  );
}
