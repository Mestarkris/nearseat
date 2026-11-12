// Deployment config, injected at build time from VITE_* env vars.
// The mainnet build (served at /mainnet/) reads its account ids from
// mainnet.json, which scripts/deploy.mjs writes, so the testnet env vars on the
// build machine can't leak into it.
import mainnetIds from "./mainnet.json";

const env = import.meta.env;
const mainnet = env.VITE_NETWORK === "mainnet";

export const config = mainnet
  ? {
      network: "mainnet" as "testnet" | "mainnet",
      rpcUrl: "https://free.rpc.fastnear.com",
      contractId: mainnetIds.contractId,
      tusdcId: mainnetIds.tokenId,
      clubId: mainnetIds.clubId,
      relayerUrl: "", // no relayer on mainnet: no gasless, no gate scanner, no members-only page
      explorer: "https://nearblocks.io",
      pollMs: 6000,
    }
  : {
      network: "testnet" as "testnet" | "mainnet",
      rpcUrl: env.VITE_RPC_URL ?? "https://test.rpc.fastnear.com",
      contractId: env.VITE_CONTRACT_ID ?? "nearseat.testnet",
      tusdcId: env.VITE_TUSDC_ID ?? "tusdc.nearseat.testnet",
      clubId: env.VITE_CLUB_ID ?? "club.nearseat.testnet",
      relayerUrl: env.VITE_RELAYER_URL ?? "http://localhost:8787",
      explorer: "https://testnet.nearblocks.io",
      pollMs: 4000,
    };

export const MAINNET = mainnet;
/** The stablecoin's name as shown to people: real USDC on mainnet, the test token on testnet. */
export const SYM = mainnet ? "USDC" : "tUSDC";
/** Set once the mainnet deployment exists; the testnet site then links to it. */
export const MAINNET_LIVE = mainnetIds.contractId !== "";
