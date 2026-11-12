#!/usr/bin/env node
// One full money cycle, recorded with transaction links:
//   a fan buys a ticket → kickoff → the member checks in → goal, full time →
//   the members' share is paid into the seat's account → the membership is
//   sold with its balance → the old owner is refused → the new owner withdraws.
//
//   NEAR_NETWORK=mainnet node scripts/mainnet-cycle.mjs          # prints the plan, sends nothing
//   NEAR_NETWORK=mainnet node scripts/mainnet-cycle.mjs --yes    # runs it
//
// On mainnet this spends real USDC from the buyer account, so every payment is
// capped at 1 USDC and the script stops before sending if a price is higher.
// Finished steps are saved, so a re-run continues where it stopped.
// Optional: SEAT, SELLER, BUYER, MATCH_ID, TICKET_SEAT (used to rehearse on testnet).
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { account, call, callTx, env, loadEnv, network, repoRoot, view, TGAS, ONE_YOCTO } from "@nearseat/shared/node";

loadEnv();
const MAINNET = network() === "mainnet";
const CONTRACT = env("CONTRACT_ID");
const TOKEN = env("TUSDC_ID");
const MASTER = env("MASTER_ACCOUNT");
const SEAT = process.env.SEAT ?? "c5-12";
const TOKEN_ID = `seat-${SEAT}`;
const SELLER = process.env.SELLER ?? `fan01.${MASTER}`;
const BUYER = process.env.BUYER ?? `fan02.${MASTER}`;
const TICKET_SEAT = process.env.TICKET_SEAT ?? "c4-7";
const SYMBOL = MAINNET ? "USDC" : "tUSDC";
const EXPLORER = MAINNET ? "https://nearblocks.io" : "https://testnet.nearblocks.io";
const CAP = 1_000_000n; // 1 USDC: the most any single payment may be on mainnet
const GO = process.argv.includes("--yes");
const usd = (n) => (Number(n) / 1e6).toFixed(n % 10_000n === 0n ? 2 : 4);
const say = (s) => console.log(`\n▶ ${s}`);

const outFile = join(repoRoot, "docs", MAINNET ? "mainnet-cycle.json" : "testnet-cycle.json");
const log = existsSync(outFile) ? JSON.parse(readFileSync(outFile, "utf8")) : { network: network(), contract: CONTRACT, token: TOKEN, steps: [] };
const done = (id) => log.steps.find((s) => s.id === id);
/** Runs a step once; records what happened and the transaction hash. */
async function step(id, what, fn) {
  if (done(id)) return console.log(`  · ${what} (already done)`);
  const r = (await fn()) ?? {};
  log.steps.push({ id, what, ...r, at: new Date().toISOString() });
  writeFileSync(outFile, JSON.stringify(log, null, 2) + "\n");
  console.log(`  ✓ ${what}${r.tx ? `  ${EXPLORER}/txns/${r.tx}` : ""}`);
}
const tiny = (amount, what) => {
  if (MAINNET && BigInt(amount) > CAP) throw new Error(`${what} is ${usd(BigInt(amount))} USDC, above the 1 USDC cap. Nothing was sent.`);
};
const pay = (from, amount, msg) =>
  callTx(account(from), TOKEN, "ft_transfer_call", { receiver_id: CONTRACT, amount: String(amount), msg: JSON.stringify(msg) }, { deposit: ONE_YOCTO, gas: 150n * TGAS });
const balance = (id) => view(TOKEN, "ft_balance_of", { account_id: id }).then(BigInt);
const member = () => view(CONTRACT, "membership", { token_id: TOKEN_ID });

// ---- plan ----
const season = await view(CONTRACT, "season");
if (season.stablecoin !== TOKEN) throw new Error(`contract takes ${season.stablecoin}, env says ${TOKEN}`);
let m0 = await member();
if (!m0) throw new Error(`${TOKEN_ID} does not exist. Run the seed script first.`);
const matches = await view(CONTRACT, "get_matches");
const match =
  matches.find((x) => String(x.id) === String(process.env.MATCH_ID ?? log.match_id)) ??
  matches.find((x) => x.status === "Scheduled");
if (!match) throw new Error("No scheduled fixture. Add one with scripts/add-fixture.mjs.");
log.match_id = match.id;
if (!done("sale") && m0.owner_id !== SELLER) throw new Error(`${TOKEN_ID} is held by ${m0.owner_id}, not ${SELLER}`);
const ticketPrice = BigInt(await view(CONTRACT, "ticket_price_for", { match_id: match.id, seat: TICKET_SEAT }));
const salePrice = BigInt(m0.season_price);
tiny(ticketPrice, "The ticket");
tiny(salePrice, "The membership");
const need = (done("ticket") ? 0n : ticketPrice) + (done("sale") ? 0n : salePrice);
const have = await balance(BUYER);

console.log(`${MAINNET ? "MAINNET, real USDC" : "testnet, test tokens"}: contract ${CONTRACT}`);
console.log(`  match ${match.id}: Illia Stars United v ${match.opponent} (${match.status})`);
console.log(`  ${BUYER} buys ticket ${TICKET_SEAT} for ${usd(ticketPrice)} ${SYMBOL}`);
console.log(`  ${SELLER} sells ${TOKEN_ID} to ${BUYER} for ${usd(salePrice)} ${SYMBOL}`);
console.log(`  ${BUYER} holds ${usd(have)} ${SYMBOL}, needs ${usd(need)} ${SYMBOL}`);
if (have < need) {
  console.log(`\nSend at least ${usd(need - have)} ${SYMBOL} to ${BUYER} (on NEAR), then run this again. Nothing was sent.`);
  process.exit(1);
}
if (!GO) {
  console.log("\nNothing was sent. Re-run with --yes to run the cycle.");
  process.exit(0);
}

// ---- run ----
const club = account(env("CLUB_ID"));
const gate = account(env("GATE_ID"));
// Balance of the seat's account before anything happens, read from the token itself.
log.vault_balance_start ??= String(await balance(m0.vault));

say("A fan buys a single-match ticket");
await step("ticket", `${BUYER} paid ${usd(ticketPrice)} ${SYMBOL} for seat ${TICKET_SEAT}`, async () => ({
  tx: await pay(BUYER, ticketPrice, { action: "buy_seat", match_id: match.id, seat: TICKET_SEAT }),
  amount: String(ticketPrice),
}));

say("Matchday");
await step("kickoff", "Kickoff", async () => ({ tx: await callTx(club, CONTRACT, "kickoff", { match_id: match.id }) }));
// The gate only accepts check-ins close to kickoff or during the match.
await step("check_in", `${SELLER} checked in at the gate on ${TOKEN_ID}`, async () => ({
  tx: await callTx(gate, CONTRACT, "check_in", { token_id: TOKEN_ID, match_id: match.id, holder: SELLER }),
}));
await step("goal", "Goal for Illia Stars United: a goal stamp for the checked-in member", async () => ({
  tx: await callTx(club, CONTRACT, "goal", { match_id: match.id, side: "Home", scorer: "Adewale" }),
}));
await step("full_time", "Full time: the members' share of ticket sales goes to the pool", async () => ({
  tx: await callTx(club, CONTRACT, "full_time", { match_id: match.id }),
}));

say("Payout into the seat's own account");
await step("settle", `Members' share settled into ${m0.vault}`, async () => {
  const before = BigInt(log.vault_balance_start);
  let tx;
  for (let i = 0; i < 20; i++) {
    const s = await view(CONTRACT, "season");
    if (s.round_settled >= s.memberships && BigInt((await member()).unsettled) === 0n) break;
    tx = await callTx(club, CONTRACT, "settle_batch", { limit: 8 }, { gas: 300n * TGAS });
  }
  const after = await balance(m0.vault);
  if (after <= before) throw new Error(`the seat account's ${SYMBOL} balance did not grow (${before} → ${after})`);
  return { tx, vault: m0.vault, vault_balance_before: String(before), vault_balance_after: String(after) };
});

say("The membership is sold with everything in it");
await step("list", `${SELLER} listed ${TOKEN_ID} for ${usd(salePrice)} ${SYMBOL}`, async () => ({
  tx: await callTx(account(SELLER), CONTRACT, "list", { token_id: TOKEN_ID, price: String(salePrice) }, { deposit: ONE_YOCTO }),
}));
await step("sale", `${BUYER} bought ${TOKEN_ID} for ${usd(salePrice)} ${SYMBOL}`, async () => {
  const m = await member();
  const inVault = await balance(m.vault);
  const tx = await pay(BUYER, salePrice, { action: "buy_membership", token_id: TOKEN_ID, expected_nonce: m.nonce });
  const after = await member();
  if (after.owner_id !== BUYER) throw new Error(`sale did not go through: owner is still ${after.owner_id}`);
  return { tx, amount: String(salePrice), moved_with_the_seat: String(inVault), new_owner: after.owner_id };
});

say("The old owner is refused");
await step("old_owner_refused", `${SELLER} tried to withdraw from ${TOKEN_ID} and was refused`, async () => {
  try {
    await call(account(SELLER), CONTRACT, "withdraw", { token_id: TOKEN_ID, amount: "1" }, { deposit: ONE_YOCTO, gas: 100n * TGAS });
  } catch (e) {
    const reason = /only the current holder can do this/.exec(String(e.message))?.[0];
    if (!reason) throw e;
    return { refused_with: reason };
  }
  throw new Error("the old owner's withdrawal was NOT refused");
});

say("The new owner controls the money");
await step("withdraw", `${BUYER} withdrew the seat account's balance to their own wallet`, async () => {
  const m = await member();
  const amount = BigInt(m.spendable);
  if (amount === 0n) throw new Error("nothing spendable in the seat account");
  const before = await balance(BUYER);
  const tx = await callTx(account(BUYER), CONTRACT, "withdraw", { token_id: TOKEN_ID, amount: String(amount) }, { deposit: ONE_YOCTO, gas: 100n * TGAS });
  const after = await balance(BUYER);
  if (after - before !== amount) throw new Error(`expected ${amount} to arrive, got ${after - before}`);
  return { tx, amount: String(amount) };
});

// ---- write the evidence page ----
if (MAINNET) {
  const row = (s) => `| ${s.what} | ${s.tx ? `[${s.tx.slice(0, 8)}…](${EXPLORER}/txns/${s.tx})` : s.refused_with ? `refused: \`${s.refused_with}\`` : ""} |`;
  const settle = done("settle");
  const md = `# Real money on NEAR mainnet

NearSeat also runs on mainnet at [\`${CONTRACT}\`](${EXPLORER}/address/${CONTRACT}), taking Circle's USDC (\`${TOKEN}\`).
Prices are set to a few cents on purpose: the contract is unaudited, so it holds almost nothing.

One full cycle, run with \`scripts/mainnet-cycle.mjs\`. Every row is a real transaction:

| What happened | Transaction |
|---|---|
${log.steps.map(row).join("\n")}

The seat account [\`${settle.vault}\`](${EXPLORER}/address/${settle.vault}) has no access keys.
Its USDC balance went from ${usd(BigInt(settle.vault_balance_before))} to ${usd(BigInt(settle.vault_balance_after))} at the payout, moved to the buyer with the sale, and only the buyer could withdraw it.

The raw record is in [\`mainnet-cycle.json\`](mainnet-cycle.json).
`;
  writeFileSync(join(repoRoot, "docs", "MAINNET.md"), md);
  console.log("\nWrote docs/MAINNET.md");
}
console.log(`\nCycle complete. Record: ${outFile}`);
