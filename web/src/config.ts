// Deployment config, injected at build time from VITE_* env vars.
const env = import.meta.env;

export const config = {
  network: (env.VITE_NETWORK ?? "testnet") as "testnet" | "mainnet",
  rpcUrl: env.VITE_RPC_URL ?? "https://test.rpc.fastnear.com",
  contractId: env.VITE_CONTRACT_ID ?? "nearseat.testnet",
  tusdcId: env.VITE_TUSDC_ID ?? "tusdc.nearseat.testnet",
  clubId: env.VITE_CLUB_ID ?? "club.nearseat.testnet",
  relayerUrl: env.VITE_RELAYER_URL ?? "http://localhost:8787",
  explorer: "https://testnet.nearblocks.io",
  pollMs: 4000,
};
