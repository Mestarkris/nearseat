// Builds a second copy of the site for the mainnet deployment, served at
// /mainnet/. Skipped until scripts/deploy.mjs has written the mainnet contract
// id to src/mainnet.json.
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

const ids = JSON.parse(readFileSync(new URL("./src/mainnet.json", import.meta.url), "utf8"));
if (!ids.contractId && !process.env.FORCE_MAINNET_BUILD) {
  console.log("No mainnet deployment yet: skipping the /mainnet/ build.");
  process.exit(0);
}
execFileSync("npx", ["vite", "build", "--outDir", "dist/mainnet"], {
  stdio: "inherit",
  cwd: new URL(".", import.meta.url),
  env: { ...process.env, VITE_NETWORK: "mainnet", VITE_BASE: "/mainnet/" },
});
