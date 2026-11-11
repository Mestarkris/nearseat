// NearSeat keeper: pokes permissionless contract methods so nothing waits on
// the club. Every call is re-checked by the contract, so a buggy or hostile
// keeper can at worst waste its own gas (threat model T20, T47).
//
//   - settle_batch     after full time, until every membership is settled
//   - process_refunds  for postponed matches, until every payment is refunded
//   - execute_autolend when a holder's auto-lend window opens
import { account, call, env, loadEnv, view, TGAS } from "@nearseat/shared/node";

loadEnv();
const CONTRACT = env("CONTRACT_ID");
const keeper = account(env("KEEPER_ID", process.env.RELAYER_ID));
const EVERY_MS = Number(process.env.KEEPER_INTERVAL_MS ?? 15_000);

const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

async function tryCall(method, args, gas = 300n * TGAS) {
  try {
    const r = await call(keeper, CONTRACT, method, args, { gas });
    log("✓", method, JSON.stringify(args), "→", JSON.stringify(r ?? null));
    return r;
  } catch (e) {
    log("✗", method, JSON.stringify(args), String(e.message ?? e).slice(0, 160));
  }
}

export async function tick() {
  const [season, matches] = await Promise.all([view(CONTRACT, "season"), view(CONTRACT, "get_matches")]);

  if (season.payout_round > 0 && season.round_settled < season.memberships) {
    await tryCall("settle_batch", { limit: 8 });
  }

  for (const m of matches) {
    if (m.status === "Postponed" && m.refunds_done < m.payment_count) {
      await tryCall("process_refunds", { match_id: m.id, limit: 8 });
    }
  }

  const now = BigInt(Date.now()) * 1_000_000n;
  const scheduled = new Map(matches.filter((m) => m.status === "Scheduled").map((m) => [m.id, m]));
  if (scheduled.size === 0) return;
  for (const mem of await view(CONTRACT, "memberships", { limit: 100 })) {
    for (const rule of mem.autolend_rules) {
      const m = scheduled.get(rule.match_id);
      if (!m) continue;
      const opensAt = BigInt(m.kickoff_at) - BigInt(rule.hours_before) * 3_600_000_000_000n;
      if (now >= opensAt) await tryCall("execute_autolend", { token_id: mem.token_id, match_id: rule.match_id }, 50n * TGAS);
    }
  }

  // Season rules ("lend every match I miss"): the contract lists exactly the seats that are due.
  for (const due of await view(CONTRACT, "season_autolend_due", { limit: 20 })) {
    await tryCall("execute_season_autolend", due, 50n * TGAS);
  }
}

if (import.meta.url === `file://${process.argv[1]}` && process.argv.includes("--once")) {
  // One pass, for schedulers (the GitHub Actions cron in .github/workflows/keeper.yml).
  await tick();
} else if (import.meta.url === `file://${process.argv[1]}`) {
  log(`keeper ${keeper.accountId} watching ${CONTRACT} every ${EVERY_MS / 1000}s`);
  for (;;) {
    await tick().catch((e) => log("tick failed:", e.message));
    await new Promise((r) => setTimeout(r, EVERY_MS));
  }
}
