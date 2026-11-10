// Runs a full seeded match on testnet, slowly enough to watch it live in the app:
// tickets sold → a member lends their seat → check-ins → kickoff → goals →
// full time → members' payout settles into every vault.
//
//   npm run demo                # uses the next scheduled fixture
//   npm run demo -- --fast      # shorter pauses
import { account, call, env, loadEnv, view, TGAS, ONE_YOCTO } from "@nearseat/shared/node";

loadEnv();
const CONTRACT = env("CONTRACT_ID");
const TUSDC = env("TUSDC_ID");
const club = account(env("CLUB_ID"));
const gate = account(env("GATE_ID"));
const master = env("MASTER_ACCOUNT");
const fans = Array.from({ length: 10 }, (_, i) => `fan${String(i + 1).padStart(2, "0")}.${master}`);
const PAUSE = process.argv.includes("--fast") ? 1_500 : 6_000;

const say = (s) => console.log(`\n▶ ${s}`);
const wait = (ms = PAUSE) => new Promise((r) => setTimeout(r, ms));

async function pay(fanId, amount, msg) {
  const fan = account(fanId);
  return call(fan, TUSDC, "ft_transfer_call", { receiver_id: CONTRACT, amount: String(amount), msg: JSON.stringify(msg) }, { deposit: ONE_YOCTO, gas: 150n * TGAS });
}

const matches = await view(CONTRACT, "get_matches");
const m = matches.find((x) => x.status === "Scheduled");
if (!m) throw new Error("No scheduled fixture. Run `npm run seed` first.");
const price = BigInt(m.ticket_price);
say(`Matchday: Illia Stars United v ${m.opponent} (match ${m.id}). Open the app → My membership to watch.`);

say("Fans buy single-match tickets (5% of each goes to the members' pool)");
const taken = new Set((await view(CONTRACT, "seat_map", { match_id: m.id })).map((s) => s.seat));
let bought = 0;
for (const [i, fanId] of fans.slice(5).entries()) {
  for (let n = 1; n <= 2; n++) {
    const seat = `a${i + 1}-${n}`;
    if (taken.has(seat)) continue;
    // Seats are priced by category (VIP, pitchside, standard, fans' end).
    const seatPrice = await view(CONTRACT, "ticket_price_for", { match_id: m.id, seat });
    await pay(fanId, seatPrice, { action: "buy_seat", match_id: m.id, seat }).catch((e) => console.log("  skip", seat, e.message));
    bought++;
    console.log(`  ${fanId} bought ${seat}`);
  }
}
await wait();

say("fan02 can't make it: lends seat c5-13 for this match; fan09 rents it");
const lender = account(fans[1]);
const lent = await call(lender, CONTRACT, "lend", { token_id: "seat-c5-13", match_id: m.id, price: String((price * 3n) / 2n) }, { deposit: ONE_YOCTO })
  .then(() => true)
  .catch((e) => (console.log("  lend skipped:", e.message), false));
if (lent) await pay(fans[8], (price * 3n) / 2n, { action: "buy_seat", match_id: m.id, seat: "c5-13" }).catch((e) => console.log("  rent skipped:", e.message));
await wait();

say("Gates open: members check in (the gate scanner normally does this after a QR scan)");
for (const seat of ["c5-12", "c5-14", "c5-15", "c6-1"]) {
  const token = `seat-${seat}`;
  const holder = await view(CONTRACT, "holder_for", { token_id: token, match_id: m.id }).catch(() => null);
  if (!holder) continue;
  await call(gate, CONTRACT, "check_in", { token_id: token, match_id: m.id, holder }).then(
    () => console.log(`  ${holder} entered on ${token}`),
    (e) => console.log(`  ${token}: ${e.message}`),
  );
}
await wait();

say("Kickoff — loans are now locked");
await call(club, CONTRACT, "kickoff", { match_id: m.id });
await wait(PAUSE * 2);

say("GOAL! Adewale — goal stamp for every checked-in member");
await call(club, CONTRACT, "goal", { match_id: m.id, side: "Home", scorer: "Adewale" });
await wait(PAUSE * 2);

say(`Goal for ${m.opponent}`);
await call(club, CONTRACT, "goal", { match_id: m.id, side: "Away", scorer: "Okon" });
await wait(PAUSE * 2);

say("GOAL! Okafor");
await call(club, CONTRACT, "goal", { match_id: m.id, side: "Home", scorer: "Okafor" });
await wait(PAUSE * 2);

say("Full time — renters' passes end, members' cut goes to the pool");
await call(club, CONTRACT, "full_time", { match_id: m.id });
await wait();

say("Payout: settling every membership's share into its own account");
for (;;) {
  const s = await view(CONTRACT, "season");
  console.log(`  ${s.round_settled} / ${s.memberships} seat accounts settled`);
  if (s.round_settled >= s.memberships) break;
  await call(club, CONTRACT, "settle_batch", { limit: 8 }, { gas: 300n * TGAS });
}
say(`Done. ${bought} tickets sold. Check any membership's history: /#/verify/seat-c5-12`);
