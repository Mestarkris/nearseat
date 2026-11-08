// Shared by the web app (gate pass + scanner), the relayer (members-only API,
// gate scanning) and tests. Pure functions; network checks are passed in.
//
// Gate pass design (threat model §3.6, T31, T32):
// 1. Holder signs ONE NEP-413 message with their wallet:
//    { kind:"nearseat-gate", token, match, session:<ed25519 pubkey>, exp }
//    recipient "nearseat-gate", random 32-byte nonce.
// 2. The browser keeps the session secret key in memory and, every few seconds,
//    signs "nearseat-pass|<token>|<match>|<ts>". That is the QR.
// 3. The scanner checks: NEP-413 signature, signing key is a FULL-ACCESS key of
//    the named holder, holder is the LIVE owner/renter, cert not expired,
//    ts within 30 s, session signature valid. Then the contract checks again.

import { ed25519 } from "@noble/curves/ed25519.js";
import { sha256 } from "@noble/hashes/sha2.js";

export const GATE_RECIPIENT = "nearseat-gate";
export const MEMBERS_RECIPIENT = "nearseat-members";
export const PASS_MAX_AGE_MS = 30_000;
export const MEMBERS_MAX_AGE_MS = 5 * 60_000;
const NEP413_TAG = 2 ** 31 + 413;

// ---------- encodings ----------
const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const te = new TextEncoder();

export function base58Encode(bytes) {
  let n = 0n;
  for (const b of bytes) n = (n << 8n) | BigInt(b);
  let out = "";
  while (n > 0n) {
    out = ALPHABET[Number(n % 58n)] + out;
    n /= 58n;
  }
  for (const b of bytes) {
    if (b !== 0) break;
    out = "1" + out;
  }
  return out;
}

export function base58Decode(s) {
  let n = 0n;
  for (const c of s) {
    const i = ALPHABET.indexOf(c);
    if (i < 0) throw new Error("bad base58");
    n = n * 58n + BigInt(i);
  }
  const bytes = [];
  while (n > 0n) {
    bytes.unshift(Number(n & 0xffn));
    n >>= 8n;
  }
  for (const c of s) {
    if (c !== "1") break;
    bytes.unshift(0);
  }
  return Uint8Array.from(bytes);
}

export function b64encode(bytes) {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

export function b64decode(s) {
  const bin = atob(s);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

/** "ed25519:<base58>" → 32 bytes */
export function parsePublicKey(pk) {
  const [curve, data] = String(pk).split(":");
  if (curve !== "ed25519" || !data) throw new Error("only ed25519 keys are supported");
  const bytes = base58Decode(data);
  if (bytes.length !== 32) throw new Error("bad ed25519 public key");
  return bytes;
}

export function formatPublicKey(bytes) {
  return `ed25519:${base58Encode(bytes)}`;
}

// ---------- NEP-413 ----------
function borshString(s) {
  const b = te.encode(s);
  const out = new Uint8Array(4 + b.length);
  new DataView(out.buffer).setUint32(0, b.length, true);
  out.set(b, 4);
  return out;
}

/** sha256(borsh({tag, message, nonce, recipient, callbackUrl})) as NEP-413 defines. */
export function nep413Hash({ message, nonce, recipient, callbackUrl }) {
  if (nonce.length !== 32) throw new Error("NEP-413 nonce must be 32 bytes");
  const tag = new Uint8Array(4);
  new DataView(tag.buffer).setUint32(0, NEP413_TAG, true);
  const cb = callbackUrl ? [Uint8Array.of(1), borshString(callbackUrl)] : [Uint8Array.of(0)];
  const parts = [tag, borshString(message), nonce, borshString(recipient), ...cb];
  const len = parts.reduce((s, p) => s + p.length, 0);
  const buf = new Uint8Array(len);
  let o = 0;
  for (const p of parts) {
    buf.set(p, o);
    o += p.length;
  }
  return sha256(buf);
}

/**
 * Verifies a wallet's signMessage result. Only checks the cryptography;
 * callers must still confirm the key is a full-access key of accountId.
 */
export function verifyNep413({ publicKey, signature, message, nonce, recipient, callbackUrl }) {
  try {
    const hash = nep413Hash({ message, nonce, recipient, callbackUrl });
    return ed25519.verify(b64decode(signature), hash, parsePublicKey(publicKey));
  } catch {
    return false;
  }
}

export function randomNonce() {
  return crypto.getRandomValues(new Uint8Array(32));
}

// ---------- gate pass ----------
export function newSessionKey() {
  const secret = ed25519.utils.randomSecretKey();
  return { secret, publicKey: formatPublicKey(ed25519.getPublicKey(secret)) };
}

export function certMessage({ tokenId, matchId, sessionKey, expiresAt }) {
  return JSON.stringify({ kind: "nearseat-gate", token: tokenId, match: matchId, session: sessionKey, exp: expiresAt });
}

function passBytes(tokenId, matchId, ts) {
  return te.encode(`nearseat-pass|${tokenId}|${matchId}|${ts}`);
}

/**
 * Builds the QR payload. `cert` is the one wallet signature:
 * { accountId, publicKey, signature, message, nonce(base64) }.
 */
export function makePass({ cert, session, tokenId, matchId, now = Date.now() }) {
  const sig = ed25519.sign(passBytes(tokenId, matchId, now), session.secret);
  return JSON.stringify({ v: 1, cert, ts: now, sig: b64encode(sig) });
}

/**
 * Checks a scanned pass. `deps` does the live network checks:
 *   isFullAccessKey(accountId, publicKey) → boolean
 *   holderFor(tokenId, matchId) → current owner or renter account id
 * Returns { ok, holder, tokenId, matchId } or { ok:false, reason }.
 */
export async function verifyPass(qr, deps, now = Date.now()) {
  let pass;
  try {
    pass = JSON.parse(qr);
  } catch {
    return { ok: false, reason: "Not a NearSeat pass" };
  }
  const { cert, ts, sig } = pass ?? {};
  if (!cert || typeof ts !== "number" || !sig) return { ok: false, reason: "Malformed pass" };
  if (Math.abs(now - ts) > PASS_MAX_AGE_MS) return { ok: false, reason: "Pass expired: QR is older than 30 s (screenshot?)" };

  let claim;
  try {
    claim = JSON.parse(cert.message);
  } catch {
    return { ok: false, reason: "Bad certificate" };
  }
  if (claim.kind !== "nearseat-gate") return { ok: false, reason: "Wrong certificate type" };
  if (typeof claim.exp !== "number" || claim.exp < now) return { ok: false, reason: "Certificate expired" };

  const nep413ok = verifyNep413({
    publicKey: cert.publicKey,
    signature: cert.signature,
    message: cert.message,
    nonce: b64decode(cert.nonce),
    recipient: GATE_RECIPIENT,
  });
  if (!nep413ok) return { ok: false, reason: "Wallet signature invalid" };

  let sessionPk;
  try {
    sessionPk = parsePublicKey(claim.session);
  } catch {
    return { ok: false, reason: "Bad session key" };
  }
  if (!ed25519.verify(b64decode(sig), passBytes(claim.token, claim.match, ts), sessionPk)) {
    return { ok: false, reason: "Rotating code signature invalid" };
  }

  if (!(await deps.isFullAccessKey(cert.accountId, cert.publicKey))) {
    return { ok: false, reason: `Signing key is not a full-access key of ${cert.accountId}` };
  }
  const holder = await deps.holderFor(claim.token, claim.match);
  if (holder !== cert.accountId) {
    return { ok: false, reason: `${cert.accountId} is not the current holder (holder is ${holder})` };
  }
  return { ok: true, holder, tokenId: claim.token, matchId: claim.match };
}

// ---------- members-only page ----------
export function membersMessage({ accountId, tokenId, issuedAt }) {
  return JSON.stringify({ kind: "nearseat-members", account: accountId, token: tokenId, iat: issuedAt });
}

/**
 * Verifies a members-only request. `deps`:
 *   isFullAccessKey(accountId, publicKey), ownerOf(tokenId), consumeNonce(nonceB64) → boolean (false if seen)
 */
export async function verifyMembersRequest(req, deps, now = Date.now()) {
  const { accountId, publicKey, signature, message, nonce } = req ?? {};
  let claim;
  try {
    claim = JSON.parse(message);
  } catch {
    return { ok: false, reason: "Bad message" };
  }
  if (claim.kind !== "nearseat-members" || claim.account !== accountId) return { ok: false, reason: "Wrong message" };
  if (typeof claim.iat !== "number" || now - claim.iat > MEMBERS_MAX_AGE_MS || claim.iat - now > 60_000) {
    return { ok: false, reason: "Signature too old; sign again" };
  }
  if (!verifyNep413({ publicKey, signature, message, nonce: b64decode(nonce), recipient: MEMBERS_RECIPIENT })) {
    return { ok: false, reason: "Signature invalid" };
  }
  if (!(await deps.isFullAccessKey(accountId, publicKey))) return { ok: false, reason: "Not a full-access key of that account" };
  if (!(await deps.consumeNonce(nonce))) return { ok: false, reason: "Signature already used (replay)" };
  const owner = await deps.ownerOf(claim.token);
  if (owner !== accountId) return { ok: false, reason: "You don't hold this membership right now" };
  return { ok: true, accountId, tokenId: claim.token };
}
