/**
 * nats-auth.ts — how Mission Control authenticates to the mesh bus (Phase 7).
 *
 * Mirrors lib/nats-resolve.js + lib/nats-nkey.js from the node repo, in
 * TypeScript, because MC's build and vitest run without ../lib present (the
 * runtime-path probing in mesh-sign.ts exists precisely because that is
 * fragile) and everything needed — `nkeyAuthenticator`, `nkeys` — ships in
 * the `nats` package MC already imports.
 *
 * Modes (OPENCLAW_NATS_AUTH, env → openclaw.env chain):
 *   token        — the shared OPENCLAW_NATS_TOKEN (default; pre-Phase-7 behaviour)
 *   nkey         — the host node's identity key (~/.openclaw/identity.key) as an
 *                  NATS nkey; legacy user/password fallback without an identity
 *   nkey-strict  — nkey or refuse
 *
 * Identity → nkey: raw seed = last 32 bytes of the PKCS8 DER, encoded as a
 * user seed ("SU…") through the nkeys codec. Never logged.
 */

import { createPrivateKey } from "crypto";
import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { nkeyAuthenticator, nkeys, type Authenticator } from "nats";
import { openclawEnvFile, openclawHome } from "./config";

// The nkey seed codec is not exported by `nats` (nor by nkeys.js's public
// entry), so it is vendored, as in lib/nats-nkey.js: prefix + payload +
// little-endian CRC-16/XMODEM, base32 without padding.
const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function crc16(bytes: Uint8Array): number {
  let crc = 0;
  for (const b of bytes) {
    crc ^= b << 8;
    for (let i = 0; i < 8; i++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
  }
  return crc;
}

function base32(bytes: Uint8Array): string {
  let out = "";
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

function encodeSeed(role: number, seed32: Uint8Array): string {
  const body = Buffer.concat([Buffer.from([nkeys.Prefix.Seed | (role >> 5), (role & 31) << 3]), Buffer.from(seed32)]);
  const check = Buffer.alloc(2);
  check.writeUInt16LE(crc16(body));
  return base32(Buffer.concat([body, check]));
}

export type NatsAuthMode = "token" | "nkey" | "nkey-strict";
const MODES: NatsAuthMode[] = ["token", "nkey", "nkey-strict"];

/** env → openclaw.env (same regex as the node resolver). */
export function resolveEnvKey(key: string, env: NodeJS.ProcessEnv = process.env): string | null {
  if (env[key]) return env[key] as string;
  try {
    const envFile = openclawEnvFile();
    if (existsSync(envFile)) {
      const content = readFileSync(envFile, "utf8");
      const match = content.match(new RegExp(`^\\s*${key}\\s*=\\s*(.+)`, "m"));
      if (match && match[1].trim()) return match[1].trim().replace(/^["']|["']$/g, "");
    }
  } catch {
    // File unreadable — fall through
  }
  return null;
}

export function resolveNatsAuthMode(): NatsAuthMode {
  const mode = (resolveEnvKey("OPENCLAW_NATS_AUTH") || "token").trim().toLowerCase() as NatsAuthMode;
  return MODES.includes(mode) ? mode : "token";
}

/** Derive the "SU…" seed and "U…" public nkey from an ed25519 PKCS8 PEM. */
export function nkeyFromPem(pem: string): { seed: string; publicNkey: string } {
  const key = createPrivateKey(pem);
  if (key.asymmetricKeyType !== "ed25519") throw new Error(`identity key must be ed25519, got ${key.asymmetricKeyType}`);
  const seed32 = key.export({ type: "pkcs8", format: "der" }).subarray(-32);
  const seed = encodeSeed(nkeys.Prefix.User, seed32);
  const publicNkey = nkeys.fromSeed(new TextEncoder().encode(seed)).getPublicKey();
  return { seed, publicNkey };
}

/** An authenticator for the host identity, or null when identity.key is absent. */
export function identityAuthenticator(identityDir: string = process.env.OPENCLAW_IDENTITY_DIR || openclawHome()): Authenticator | null {
  const keyPath = join(identityDir, "identity.key");
  if (!existsSync(keyPath)) return null;
  const { seed } = nkeyFromPem(readFileSync(keyPath, "utf8"));
  return nkeyAuthenticator(new TextEncoder().encode(seed));
}

export interface NatsAuthOptions {
  token?: string;
  user?: string;
  pass?: string;
  authenticator?: Authenticator;
}

/**
 * The auth part of connect() options for the resolved mode.
 * `token` is the already-resolved OPENCLAW_NATS_TOKEN (null when unset).
 */
export function natsAuthOptions(token: string | null, mode: NatsAuthMode = resolveNatsAuthMode()): NatsAuthOptions {
  if (mode === "token") return token ? { token } : {};
  const authenticator = identityAuthenticator();
  if (authenticator) return { authenticator };
  if (mode === "nkey-strict") {
    throw new Error("OPENCLAW_NATS_AUTH=nkey-strict but no node identity (identity.key) under OPENCLAW_HOME");
  }
  const user = resolveEnvKey("OPENCLAW_NATS_LEGACY_USER") || "openclaw";
  return token ? { user, pass: token } : {};
}
