// NearSeat relayer.
//
//   POST /relay        NEP-366: submits a user-signed delegate action, relayer pays gas.
//   POST /members      Members-only content after NEP-413 proof + live owner check.
//   POST /gate/scan    Verifies a rotating gate pass, then calls `check_in` as the gate.
//   GET  /health
//
// Threat model: T51 (allow-list, rate limit, no deposits > 1 yocto), T52 (it can't
// forge: delegate actions are user-signed), T53/T54 (server-side gate, single-use nonces),
// T31/T32 (gate pass checks). The contract re-checks everything on-chain anyway.
import express from "express";
import { deserialize } from "borsh";
import { SCHEMA, actions } from "near-api-js";
import { b64decode, verifyMembersRequest, verifyPass } from "@nearseat/shared";
import { account, call, env, isFullAccessKey, loadEnv, view, TGAS } from "@nearseat/shared/node";
import { RateLimiter, NonceStore, checkDelegate } from "./policy.mjs";

loadEnv();
const CONTRACT = env("CONTRACT_ID");
const TUSDC = env("TUSDC_ID");
const PORT = Number(process.env.RELAYER_PORT ?? process.env.PORT ?? 8787);
const ORIGIN = process.env.RELAYER_ALLOWED_ORIGIN ?? "*";

const relayer = account(env("RELAYER_ID"));
const gate = account(env("GATE_ID"));
const limiter = new RateLimiter({ perMinute: 10 });
const nonces = new NonceStore({ ttlMs: 10 * 60_000 });

const app = express();
app.use(express.json({ limit: "64kb" }));
app.use((req, res, next) => {
  res.setHeader("access-control-allow-origin", ORIGIN);
  res.setHeader("access-control-allow-headers", "content-type");
  res.setHeader("access-control-allow-methods", "GET,POST,OPTIONS");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

const fail = (res, status, error) => res.status(status).json({ ok: false, error });

app.get("/health", (_req, res) => res.json({ ok: true, contract: CONTRACT, relayer: relayer.accountId }));

app.post("/relay", async (req, res) => {
  try {
    const bytes = b64decode(String(req.body?.signedDelegate ?? ""));
    const signed = deserialize(SCHEMA.SignedDelegate, bytes);
    const da = signed.delegateAction;
    const problem = checkDelegate(da, { allowedReceivers: [CONTRACT, TUSDC] });
    if (problem) return fail(res, 400, problem);
    if (!limiter.take(da.senderId)) return fail(res, 429, "Too many relayed transactions; try again in a minute");

    const outcome = await relayer.signAndSendTransaction({
      receiverId: da.senderId,
      actions: [actions.signedDelegate({ delegateAction: da, signature: signed.signature })],
      throwOnFailure: false,
    });
    res.json({ ok: true, txHash: outcome?.transaction_outcome?.id ?? outcome?.transaction?.hash, outcome });
  } catch (e) {
    fail(res, 400, `Could not relay: ${e.message}`);
  }
});

app.post("/members", async (req, res) => {
  const r = await verifyMembersRequest(req.body, {
    isFullAccessKey,
    ownerOf: async (tokenId) => (await view(CONTRACT, "nft_token", { token_id: tokenId }))?.owner_id,
    consumeNonce: async (n) => nonces.consume(n),
  });
  if (!r.ok) return fail(res, 403, r.reason);
  const m = await view(CONTRACT, "membership", { token_id: r.tokenId });
  res.json({
    ok: true,
    holder: r.accountId,
    tokenId: r.tokenId,
    content: {
      headline: `Welcome back, ${r.accountId}`,
      perks: [
        "Training-ground open day · Sat 21 Nov · bring this page to the North gate",
        "Away-day coach seats released to members first, 48 h before general sale",
        `Members' bar: ${m?.food_credits ?? 0} food & drink credits on your seat account`,
      ],
      notice: "Checked against the chain on this request. Sell the membership and this page locks for you.",
    },
  });
});

app.post("/gate/scan", async (req, res) => {
  const qr = String(req.body?.qr ?? "");
  const r = await verifyPass(qr, {
    isFullAccessKey,
    // Memberships: live owner, or that match's renter. Single tickets: live NFT owner.
    holderFor: async (tokenId, matchId) =>
      tokenId.startsWith("seat-")
        ? view(CONTRACT, "holder_for", { token_id: tokenId, match_id: matchId })
        : (await view(CONTRACT, "nft_token", { token_id: tokenId }))?.owner_id,
  });
  if (!r.ok) return fail(res, 403, r.reason);
  try {
    if (r.tokenId.startsWith("seat-")) {
      await call(gate, CONTRACT, "check_in", { token_id: r.tokenId, match_id: r.matchId, holder: r.holder }, { gas: 50n * TGAS });
    } else {
      await call(gate, CONTRACT, "check_in_ticket", { ticket_id: r.tokenId, holder: r.holder }, { gas: 50n * TGAS });
    }
    res.json({ ok: true, holder: r.holder, tokenId: r.tokenId, matchId: r.matchId });
  } catch (e) {
    // The contract refused (already entered, gates closed, holder changed…).
    fail(res, 409, String(e.message ?? e).replace(/^.*Smart contract panicked: /s, ""));
  }
});

app.listen(PORT, () => console.log(`NearSeat relayer on :${PORT} → ${CONTRACT} (relayer ${relayer.accountId})`));
