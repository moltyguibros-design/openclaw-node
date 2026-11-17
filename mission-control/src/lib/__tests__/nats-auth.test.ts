/**
 * nats-auth.test.ts — MC's nkey derivation must match the node repo's
 * (lib/nats-nkey.js): same fixed vector, same mode semantics.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createPrivateKey, generateKeyPairSync, verify as cryptoVerify } from "crypto";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { nkeys } from "nats";
import { nkeyFromPem, natsAuthOptions, resolveNatsAuthMode, resolveEnvKey } from "../nats-auth";

// Same vector as test/nats-nkey.test.js in the node repo: seed bytes 0x01..0x20.
const SEED32 = Buffer.from(Array.from({ length: 32 }, (_, i) => i + 1));
const VECTOR_PEM = createPrivateKey({
  key: Buffer.concat([Buffer.from("302e020100300506032b657004220420", "hex"), SEED32]),
  format: "der", type: "pkcs8",
}).export({ type: "pkcs8", format: "pem" }) as string;
// What nkeys.js 1.1.0's own codec encodes SEED32 to (and the public key it derives).
const VECTOR_SEED = "SUAACAQDAQCQMBYIBEFAWDANBYHRAEISCMKBKFQXDAMRUGY4DUPB6IC5CQ";
const VECTOR_PUBLIC = "UB43KVROR7TFJ6KAPCYRF2FJROTZAH4FHLTJLPWX4DRZCC5NASLGJBFE";

describe("nats-auth nkey derivation", () => {
  it("matches the shared fixed vector and cross-verifies with node:crypto", () => {
    const r = nkeyFromPem(VECTOR_PEM);
    expect(r.seed).toBe(VECTOR_SEED);
    expect(r.publicNkey).toBe(VECTOR_PUBLIC);
    expect(r.seed).toMatch(/^SU[A-Z2-7]{56}$/);
    expect(r.publicNkey).toMatch(/^U[A-Z2-7]{55}$/);
    const { privateKey, publicKey } = generateKeyPairSync("ed25519");
    const pem = privateKey.export({ type: "pkcs8", format: "pem" }) as string;
    const kp = nkeys.fromSeed(new TextEncoder().encode(nkeyFromPem(pem).seed));
    const nonce = Buffer.from("nonce-bytes");
    expect(cryptoVerify(null, nonce, publicKey, Buffer.from(kp.sign(nonce)))).toBe(true);
  });
});

describe("natsAuthOptions by mode", () => {
  let home: string;
  const saved: Record<string, string | undefined> = {};
  const KEYS = ["OPENCLAW_HOME", "OPENCLAW_NATS_AUTH", "OPENCLAW_IDENTITY_DIR", "OPENCLAW_NATS_LEGACY_USER"];

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "mc-nats-auth-"));
    for (const k of KEYS) { saved[k] = process.env[k]; delete process.env[k]; }
    process.env.OPENCLAW_HOME = home;
  });
  afterEach(() => {
    for (const k of KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
    rmSync(home, { recursive: true, force: true });
  });

  it("token mode sends the token; unknown values fall back to token", () => {
    expect(natsAuthOptions("abc", "token")).toEqual({ token: "abc" });
    expect(natsAuthOptions(null, "token")).toEqual({});
    writeFileSync(join(home, "openclaw.env"), "OPENCLAW_NATS_AUTH=banana\n");
    expect(resolveNatsAuthMode()).toBe("token");
    expect(resolveEnvKey("OPENCLAW_NATS_AUTH")).toBe("banana");
  });

  it("nkey mode uses the identity when present, else the legacy user", () => {
    writeFileSync(join(home, "openclaw.env"), "OPENCLAW_NATS_AUTH=nkey\nOPENCLAW_NATS_LEGACY_USER=mc\n");
    expect(natsAuthOptions("abc")).toEqual({ user: "mc", pass: "abc" });
    mkdirSync(home, { recursive: true });
    writeFileSync(join(home, "identity.key"), VECTOR_PEM);
    const opts = natsAuthOptions("abc");
    expect(typeof opts.authenticator).toBe("function");
    expect(opts.token).toBeUndefined();
  });

  it("nkey-strict without an identity throws", () => {
    writeFileSync(join(home, "openclaw.env"), "OPENCLAW_NATS_AUTH=nkey-strict\n");
    expect(() => natsAuthOptions("abc")).toThrow(/nkey-strict/);
  });
});
