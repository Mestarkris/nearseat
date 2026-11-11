#!/usr/bin/env node
// Sets up a demo vendor and checks kiosk payment and renewal saving on the
// live deployment, with real tUSDC.
//
//   node scripts/kiosk.mjs
//
// Creates kiosk.<MASTER_ACCOUNT> if needed, registers it with tUSDC, has the
// club approve it, then seat-c5-12's holder: sets 50% of each payout aside,
// pays the vendor 0.25 tUSDC from the seat's account, and is refused when
// trying to spend more than the seat can spend or to pay an unapproved account.
import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { KeyPair } from "near-api-js";
import { account, call, env, loadEnv, network, provider, view, TGAS, ONE_YOCTO } from "@nearseat/shared/node";

loadEnv();
const CONTRACT = env("CONTRACT_ID");
const TUSDC = env("TUSDC_ID");
const MASTER = env("MASTER_ACCOUNT");
const club = account(env("CLUB_ID"));
const VENDOR = `kiosk.${MASTER}`;
const VENDOR_NAME = "Mama Tee's Kitchen";
const TOKEN = "seat-c5-12";

let failures = 0;
const check = (ok, msg) => { if (!ok) failures++; console.log(`${ok ? "✅" : "❌"} ${msg}`); };
const settle = async (read, ok, tries = 12) => {
  let v;
  for (let i = 0; i < tries; i++) { v = await read(); if (ok(v)) return v; await new Promise((r) => setTimeout(r, 1500)); }
  return v;
};
const refusal = (p, pattern) => p.then(() => false, (e) => pattern.test(String(e.message ?? e)));
const membership = () => view(CONTRACT, "membership", { token_id: TOKEN });

// 1. The vendor's account, registered with tUSDC so it can be paid.
if (!(await provider().viewAccount({ accountId: VENDOR }).catch(() => null))) {
  const kp = KeyPair.fromRandom("ed25519");
  const dir = join(homedir(), ".near-credentials", network());
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${VENDOR}.json`);
  writeFileSync(file, JSON.stringify({ account_id: VENDOR, public_key: kp.getPublicKey().toString(), private_key: kp.toString() }));
  chmodSync(file, 0o600);
  await account(MASTER).createSubAccount({ accountOrPrefix: "kiosk", publicKey: kp.getPublicKey(), nearToTransfer: 10n ** 23n });
  console.log(`created ${VENDOR}, key saved to ~/.near-credentials/${network()}/`);
}
if (!(await view(TUSDC, "storage_balance_of", { account_id: VENDOR }))) {
  await call(club, TUSDC, "storage_deposit", { account_id: VENDOR, registration_only: true }, { deposit: 12_500_000_000_000_000_000_000n });
}

// 2. The club approves it; anyone else is refused.
const m0 = await membership();
const holder = account(m0.owner_id);
// Demo holders are funded with little NEAR; a 100 Tgas call reserves about 0.1 up front.
if (m0.owner_id.endsWith(`.${MASTER}`) && BigInt((await provider().viewAccount({ accountId: m0.owner_id })).amount) < 5n * 10n ** 23n) {
  await account(MASTER).transfer({ receiverId: m0.owner_id, amount: 10n ** 24n });
}
check(await refusal(call(holder, CONTRACT, "set_vendor", { account_id: VENDOR, name: "Fake" }), /only the club/), "a non-club account can't approve a vendor");
await call(club, CONTRACT, "set_vendor", { account_id: VENDOR, name: VENDOR_NAME });
const vendors = await settle(() => view(CONTRACT, "vendors"), (v) => v.some((x) => x.account_id === VENDOR));
check(vendors.some((x) => x.account_id === VENDOR && x.name === VENDOR_NAME), `club approved ${VENDOR} as "${VENDOR_NAME}"`);

// 3. Renewal saving: 50% of each payout from now on.
await call(holder, CONTRACT, "set_renewal_saving", { token_id: TOKEN, bps: 5000 }, { deposit: ONE_YOCTO });
check((await settle(membership, (m) => m.renewal_bps === 5000)).renewal_bps === 5000, `${TOKEN} sets aside 50% of each payout`);

// 4. Pay the vendor from the seat's account.
const m1 = await membership();
const amount = 250_000n;
if (BigInt(m1.spendable) < amount || m1.listing || BigInt(m1.debt) > 0n) {
  console.log(`· skipping the payment: ${TOKEN} can spend ${m1.spendable} (listed: ${!!m1.listing}, debt ${m1.debt})`);
} else {
  const before = BigInt(await view(TUSDC, "ft_balance_of", { account_id: VENDOR }));
  await call(holder, CONTRACT, "pay_vendor", { token_id: TOKEN, vendor_id: VENDOR, amount: String(amount), memo: "Jollof and a malt" }, { deposit: ONE_YOCTO, gas: 100n * TGAS });
  const after = BigInt(await settle(() => view(TUSDC, "ft_balance_of", { account_id: VENDOR }), (b) => BigInt(b) === before + amount));
  const m2 = await settle(membership, (m) => BigInt(m.vendor_spent) === BigInt(m1.vendor_spent) + amount);
  check(after === before + amount, `${VENDOR} received 0.25 tUSDC from the seat's account`);
  check(BigInt(m2.vault_balance) === BigInt(m1.vault_balance) - amount && BigInt(m2.vendor_spent) === BigInt(m1.vendor_spent) + amount, `${TOKEN} balance fell by 0.25 and its spending record grew by 0.25`);
  check(await refusal(call(holder, CONTRACT, "pay_vendor", { token_id: TOKEN, vendor_id: VENDOR, amount: String(BigInt(m2.spendable) + 1n) }, { deposit: ONE_YOCTO, gas: 100n * TGAS }), /exceeds what this seat can spend/), "spending more than the seat can spend is refused");
}
check(await refusal(call(holder, CONTRACT, "pay_vendor", { token_id: TOKEN, vendor_id: club.accountId, amount: "1" }, { deposit: ONE_YOCTO, gas: 100n * TGAS }), /not an approved vendor/), "paying an account the club hasn't approved is refused");
check(await refusal(call(club, CONTRACT, "pay_vendor", { token_id: TOKEN, vendor_id: VENDOR, amount: "1" }, { deposit: ONE_YOCTO, gas: 100n * TGAS }), /holder/), "only the holder can spend from the seat");

console.log(failures ? `\n${failures} check(s) failed` : "\nKiosk and renewal saving valid ✔");
process.exit(failures ? 1 : 0);
