#!/usr/bin/env node
// IRREVERSIBLE. Deletes every access key on the NearSeat contract account so
// nobody (including you) can ever redeploy or drain it. Run only after the
// final deploy and seed — sub-accounts can't be created afterwards.
//
//   node scripts/lock.mjs --yes-delete-all-keys
import { actions, PublicKey } from "near-api-js";
import { account, env, loadEnv, provider } from "@nearseat/shared/node";

loadEnv();
const CONTRACT = env("CONTRACT_ID");
if (!process.argv.includes("--yes-delete-all-keys")) {
  console.error(`This deletes ALL access keys on ${CONTRACT} forever. Re-run with --yes-delete-all-keys.`);
  process.exit(1);
}
const acc = account(CONTRACT);
const { keys } = await provider().viewAccessKeyList({ accountId: CONTRACT });
await acc.signAndSendTransaction({
  receiverId: CONTRACT,
  actions: keys.map((k) => actions.deleteKey(PublicKey.from(k.public_key))),
});
console.log(`Deleted ${keys.length} key(s). Check: npm run verify`);
