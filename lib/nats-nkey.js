/**
 * nats-nkey.js — this node's identity key as a NATS nkey (Phase 7).
 *
 * NATS nkeys are ed25519 keypairs with a base32 text encoding: a seed string
 * "SU…" (user seed) and a public key "U…". The node identity at
 * ~/.openclaw/identity.key is ALSO an ed25519 key (PKCS8 PEM), so the same key
 * material serves both: raw seed = last 32 bytes of the PKCS8 DER, raw public
 * key = last 32 bytes of the SPKI DER (the exact bytes node-identity.mjs
 * exposes as publicKeyBase64). Signatures produced through nkeys verify with
 * node:crypto against the identity public key, and vice versa — proven in
 * test/nats-nkey.test.js.
 *
 * Trade-off (federation DECISIONS D17): one secret per node. Whoever holds
 * identity.key holds the bus credential and the signing key. The API takes an
 * identity dir, so moving to a separate `nats-nkey.seed` later is a local swap.
 *
 * This module never logs, prints, or throws the seed.
 *
 * CJS on purpose: lib/nats-resolve.js is CJS and is required by every daemon at
 * load time; nkeys.js is pinned in the root dependencies to the version `nats` uses. Only its
 * public entry is used: the nkey text codec (prefix + payload + CRC16, base32) is not exported, so
 * it is vendored below rather than reached through nkeys.js's internal lib/codec.js path.
 */

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const nkeys = require('nkeys.js');

const IDENTITY_KEY_FILE = 'identity.key';

function defaultIdentityDir() {
  return process.env.OPENCLAW_IDENTITY_DIR || path.join(os.homedir(), '.openclaw');
}

const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/** CRC-16/XMODEM, the nkey checksum. */
function crc16(bytes) {
  let crc = 0;
  for (const b of bytes) {
    crc ^= b << 8;
    for (let i = 0; i < 8; i++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
  }
  return crc;
}

/** RFC 4648 base32, unpadded. */
function base32(bytes) {
  let out = '';
  let value = 0;
  let bits = 0;
  for (const b of bytes) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32[(value << (5 - bits)) & 31];
  return out;
}

/** prefix bytes + payload + little-endian CRC16, base32-encoded (nkeys' text form). */
function encodeNkey(prefix, payload) {
  const body = Buffer.concat([Buffer.from(prefix), Buffer.from(payload)]);
  const check = Buffer.alloc(2);
  check.writeUInt16LE(crc16(body));
  return base32(Buffer.concat([body, check]));
}

/** A seed's two prefix bytes spell "S" + the role letter once base32-encoded. */
function encodeSeed(role, seed32) {
  return encodeNkey([nkeys.Prefix.Seed | (role >> 5), (role & 31) << 3], seed32);
}

/** Raw 32-byte ed25519 public key → "U…" nkey public string. */
function rawPublicToNkey(raw32) {
  return encodeNkey([nkeys.Prefix.User], raw32);
}

/** Raw base64 pubkey (identity registry / publicKeyBase64 form) → "U…". */
function publicKeyBase64ToNkey(b64) {
  const raw = Buffer.from(String(b64), 'base64');
  if (raw.length !== 32) throw new Error(`expected a 32-byte raw ed25519 pubkey, got ${raw.length} bytes`);
  return rawPublicToNkey(raw);
}

/**
 * Derive the nkey pair from an identity PEM (or a KeyObject).
 * @returns {{ seed: string, publicNkey: string, publicKeyBase64: string }}
 */
function nkeyFromPrivateKey(pemOrKey) {
  const privateKey = typeof pemOrKey === 'string' || Buffer.isBuffer(pemOrKey)
    ? crypto.createPrivateKey(pemOrKey)
    : pemOrKey;
  if (privateKey.asymmetricKeyType !== 'ed25519') {
    throw new Error(`identity key must be ed25519, got ${privateKey.asymmetricKeyType}`);
  }
  const seed32 = privateKey.export({ type: 'pkcs8', format: 'der' }).subarray(-32);
  const pub32 = crypto.createPublicKey(privateKey).export({ type: 'spki', format: 'der' }).subarray(-32);
  const seed = encodeSeed(nkeys.Prefix.User, seed32);
  const publicNkey = rawPublicToNkey(pub32);
  // Cross-check: the nkeys library must agree on the public key it derives.
  const check = nkeys.fromSeed(new TextEncoder().encode(seed)).getPublicKey();
  if (check !== publicNkey) throw new Error('nkey derivation mismatch between node:crypto and nkeys');
  return { seed, publicNkey, publicKeyBase64: pub32.toString('base64') };
}

/**
 * Read the node identity and derive its nkey. Returns null when no identity
 * exists in the dir (the caller decides whether that is fatal).
 */
function identityToNkey(identityDir = defaultIdentityDir()) {
  const keyPath = path.join(identityDir, IDENTITY_KEY_FILE);
  if (!fs.existsSync(keyPath)) return null;
  return nkeyFromPrivateKey(fs.readFileSync(keyPath, 'utf8'));
}

/**
 * A `nats` authenticator for this node, or null without an identity. The seed
 * bytes stay inside the closure the nats client uses to sign the server nonce.
 */
function nkeyAuthenticatorFor(identityDir = defaultIdentityDir()) {
  const pair = identityToNkey(identityDir);
  if (!pair) return null;
  const { nkeyAuthenticator } = require('nats');
  return nkeyAuthenticator(new TextEncoder().encode(pair.seed));
}

module.exports = {
  defaultIdentityDir,
  identityToNkey,
  nkeyFromPrivateKey,
  publicKeyBase64ToNkey,
  rawPublicToNkey,
  nkeyAuthenticatorFor,
};
