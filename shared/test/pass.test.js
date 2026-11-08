// Gate pass and members-only checks (threat model T12, T31, T32, T53, T54).
import { test } from "node:test";
import assert from "node:assert/strict";
import { ed25519 } from "@noble/curves/ed25519.js";
import {
  GATE_RECIPIENT, MEMBERS_RECIPIENT, b64encode, certMessage, formatPublicKey, makePass,
  membersMessage, nep413Hash, newSessionKey, randomNonce, verifyMembersRequest, verifyPass,
  base58Decode, base58Encode,
} from "../src/index.js";

/** A fake wallet that signs NEP-413 like Meteor / MyNearWallet / HOT do. */
function wallet(accountId) {
  const secret = ed25519.utils.randomSecretKey();
  const publicKey = formatPublicKey(ed25519.getPublicKey(secret));
  return {
    accountId,
    publicKey,
    signMessage({ message, nonce, recipient }) {
      const signature = b64encode(ed25519.sign(nep413Hash({ message, nonce, recipient }), secret));
      return { accountId, publicKey, signature, message, nonce: b64encode(nonce) };
    },
  };
}

const alice = wallet("alice.testnet");
const NOW = 1_800_000_000_000;

function issuePass(w = alice, { exp = NOW + 3 * 3600_000 } = {}) {
  const session = newSessionKey();
  const message = certMessage({ tokenId: "seat-c5-12", matchId: 1, sessionKey: session.publicKey, expiresAt: exp });
  const cert = w.signMessage({ message, nonce: randomNonce(), recipient: GATE_RECIPIENT });
  return { cert, session };
}

const deps = (holder = "alice.testnet", fullAccess = [alice.publicKey]) => ({
  isFullAccessKey: async (_acc, pk) => fullAccess.includes(pk),
  holderFor: async () => holder,
});

test("base58 round-trips", () => {
  const b = Uint8Array.of(0, 0, 1, 2, 255);
  assert.deepEqual(base58Decode(base58Encode(b)), b);
});

test("fresh pass from the live holder is accepted", async () => {
  const { cert, session } = issuePass();
  const qr = makePass({ cert, session, tokenId: "seat-c5-12", matchId: 1, now: NOW });
  const r = await verifyPass(qr, deps(), NOW + 5_000);
  assert.equal(r.ok, true);
  assert.equal(r.holder, "alice.testnet");
});

test("screenshot older than 30 s is rejected (T31)", async () => {
  const { cert, session } = issuePass();
  const qr = makePass({ cert, session, tokenId: "seat-c5-12", matchId: 1, now: NOW });
  const r = await verifyPass(qr, deps(), NOW + 31_000);
  assert.equal(r.ok, false);
  assert.match(r.reason, /older than 30 s/);
});

test("old owner's pass fails after a sale (T12)", async () => {
  const { cert, session } = issuePass();
  const qr = makePass({ cert, session, tokenId: "seat-c5-12", matchId: 1, now: NOW });
  const r = await verifyPass(qr, deps("bob.testnet"), NOW);
  assert.equal(r.ok, false);
  assert.match(r.reason, /not the current holder/);
});

test("certificate signed by a key that isn't the holder's full-access key fails (T32)", async () => {
  const mallory = wallet("alice.testnet"); // claims to be Alice with her own key
  const { cert, session } = issuePass(mallory);
  const qr = makePass({ cert, session, tokenId: "seat-c5-12", matchId: 1, now: NOW });
  const r = await verifyPass(qr, deps(), NOW);
  assert.equal(r.ok, false);
  assert.match(r.reason, /not a full-access key/);
});

test("tampered match id breaks the rotating signature", async () => {
  const { cert, session } = issuePass();
  const qr = JSON.parse(makePass({ cert, session, tokenId: "seat-c5-12", matchId: 1, now: NOW }));
  const forged = JSON.stringify({ ...qr, ts: NOW + 1 });
  const r = await verifyPass(forged, deps(), NOW);
  assert.equal(r.ok, false);
});

test("expired certificate fails", async () => {
  const { cert, session } = issuePass(alice, { exp: NOW - 1 });
  const qr = makePass({ cert, session, tokenId: "seat-c5-12", matchId: 1, now: NOW });
  assert.equal((await verifyPass(qr, deps(), NOW)).ok, false);
});

test("members-only request: valid once, replay rejected, non-holder rejected (T53, T54)", async () => {
  const seen = new Set();
  const d = (owner) => ({
    isFullAccessKey: async (_a, pk) => pk === alice.publicKey,
    ownerOf: async () => owner,
    consumeNonce: async (n) => (seen.has(n) ? false : (seen.add(n), true)),
  });
  const message = membersMessage({ accountId: "alice.testnet", tokenId: "seat-c5-12", issuedAt: NOW });
  const req = alice.signMessage({ message, nonce: randomNonce(), recipient: MEMBERS_RECIPIENT });
  assert.equal((await verifyMembersRequest(req, d("alice.testnet"), NOW)).ok, true);
  const replay = await verifyMembersRequest(req, d("alice.testnet"), NOW);
  assert.match(replay.reason, /replay/);

  const req2 = alice.signMessage({ message, nonce: randomNonce(), recipient: MEMBERS_RECIPIENT });
  const sold = await verifyMembersRequest(req2, d("bob.testnet"), NOW);
  assert.match(sold.reason, /don't hold/);
});
