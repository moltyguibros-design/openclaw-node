import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getOrCreateIdentity, createSeenEventCache } from '../lib/node-identity.mjs';
import {
  signDeployTrigger,
  verifyDeployTrigger,
  verifyDeployMarker,
  trustedDeployKeys,
  requireSignedDeploy,
} from '../lib/deploy-trigger-auth.mjs';

/** A representative deploy trigger payload (matches bin/mesh.js / fleet-deploy.js). */
function trigger() {
  return {
    sha: 'abc1234',
    branch: 'main',
    nodes: ['all'],
    initiator: 'lead-node',
    timestamp: new Date().toISOString(),
  };
}

describe('deploy-trigger-auth', () => {
  let dir, id;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'deploy-auth-'));
    id = getOrCreateIdentity(dir);
    delete process.env.OPENCLAW_REQUIRE_SIGNED_DEPLOY;
    delete process.env.OPENCLAW_DEPLOY_TRUSTED_KEYS;
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    delete process.env.OPENCLAW_REQUIRE_SIGNED_DEPLOY;
    delete process.env.OPENCLAW_DEPLOY_TRUSTED_KEYS;
  });

  it('sign → verify roundtrip passes for a trusted key (strict)', () => {
    const signed = signDeployTrigger(trigger(), { identityDir: dir });
    assert.ok(signed.signature, 'trigger is signed');
    assert.equal(signed.signer_pubkey, id.publicKeyBase64);
    const res = verifyDeployTrigger(signed, {
      requireSigned: true,
      trustedKeys: [id.publicKeyBase64],
    });
    assert.deepEqual(res, { ok: true, reason: 'verified' });
  });

  it('strict mode REJECTS an unsigned trigger', () => {
    const res = verifyDeployTrigger(trigger(), { requireSigned: true, trustedKeys: [id.publicKeyBase64] });
    assert.equal(res.ok, false);
    assert.equal(res.reason, 'missing-signature');
  });

  it('strict mode REJECTS a valid signature from an UNtrusted key', () => {
    const signed = signDeployTrigger(trigger(), { identityDir: dir });
    const res = verifyDeployTrigger(signed, { requireSigned: true, trustedKeys: ['someOtherKeyBase64=='] });
    assert.equal(res.ok, false);
    assert.equal(res.reason, 'untrusted-signer');
  });

  it('strict mode FAILS CLOSED when no trust allowlist is configured', () => {
    const signed = signDeployTrigger(trigger(), { identityDir: dir });
    const res = verifyDeployTrigger(signed, { requireSigned: true, trustedKeys: [] });
    assert.equal(res.ok, false);
    assert.equal(res.reason, 'no-trusted-deploy-keys-configured');
  });

  it('strict mode REJECTS a tampered payload (sha swapped after signing)', () => {
    const signed = signDeployTrigger(trigger(), { identityDir: dir });
    const tampered = { ...signed, sha: 'deadbeef' }; // attacker changes the deploy target
    const res = verifyDeployTrigger(tampered, { requireSigned: true, trustedKeys: [id.publicKeyBase64] });
    assert.equal(res.ok, false);
    assert.equal(res.reason, 'invalid-signature');
  });

  it('strict mode REJECTS a stale trigger (replay window)', () => {
    const old = { ...trigger(), timestamp: new Date(Date.now() - 48 * 3600 * 1000).toISOString() };
    const signed = signDeployTrigger(old, { identityDir: dir });
    const res = verifyDeployTrigger(signed, { requireSigned: true, trustedKeys: [id.publicKeyBase64] });
    assert.equal(res.ok, false);
    assert.match(res.reason, /too-old/);
  });

  it('non-strict (explicit opt-out) allows an unsigned trigger, with a warning', () => {
    let warned = false;
    const res = verifyDeployTrigger(trigger(), { requireSigned: false, log: () => { warned = true; } });
    assert.deepEqual(res, { ok: true, reason: 'unsigned-allowed' });
    assert.ok(warned, 'unsigned acceptance is logged, not silent');
  });

  it('non-strict passes a signed trigger through without requiring trust', () => {
    const signed = signDeployTrigger(trigger(), { identityDir: dir });
    const res = verifyDeployTrigger(signed, { requireSigned: false });
    assert.deepEqual(res, { ok: true, reason: 'signed-not-required' });
  });

  it('strict mode REJECTS a replayed trigger (same event_id verified twice)', () => {
    const signed = signDeployTrigger(trigger(), { identityDir: dir });
    assert.ok(signed.event_id, 'signing stamps an event_id');
    const opts = { requireSigned: true, trustedKeys: [id.publicKeyBase64] };
    assert.equal(verifyDeployTrigger(signed, opts).ok, true);
    const replayed = verifyDeployTrigger(signed, opts);
    assert.equal(replayed.ok, false);
    assert.equal(replayed.reason, 'replay');
  });

  it('strict mode: an untrusted signer cannot evict a trusted id from the replay cache', () => {
    const otherDir = mkdtempSync(join(tmpdir(), 'deploy-auth-other-'));
    try {
      const seen = createSeenEventCache(2);
      const opts = { requireSigned: true, trustedKeys: [id.publicKeyBase64], seenIds: seen };
      const signed = signDeployTrigger(trigger(), { identityDir: dir });
      assert.equal(verifyDeployTrigger(signed, opts).ok, true);
      for (let i = 0; i < 2; i++) {
        const flood = signDeployTrigger(trigger(), { identityDir: otherDir });
        assert.equal(verifyDeployTrigger(flood, opts).reason, 'untrusted-signer');
      }
      assert.equal(seen.size(), 1);
      assert.deepEqual(verifyDeployTrigger(signed, opts), { ok: false, reason: 'replay' });
    } finally {
      rmSync(otherDir, { recursive: true, force: true });
    }
  });

  it('strict mode REJECTS a trigger older than the deploy freshness window (15min default)', () => {
    const old = { ...trigger(), timestamp: new Date(Date.now() - 20 * 60_000).toISOString() };
    const signed = signDeployTrigger(old, { identityDir: dir });
    const res = verifyDeployTrigger(signed, { requireSigned: true, trustedKeys: [id.publicKeyBase64] });
    assert.equal(res.ok, false);
    assert.match(res.reason, /too-old/);
  });

  it('marker: a trusted-signed marker verifies with NO freshness bound (days old)', () => {
    const old = { ...trigger(), timestamp: new Date(Date.now() - 5 * 24 * 3600 * 1000).toISOString() };
    const signed = signDeployTrigger(old, { identityDir: dir });
    const res = verifyDeployMarker(signed, { requireSigned: true, trustedKeys: [id.publicKeyBase64] });
    assert.deepEqual(res, { ok: true, reason: 'verified' });
    // and again — markers are re-read on every startup, no replay cache
    assert.equal(verifyDeployMarker(signed, { requireSigned: true, trustedKeys: [id.publicKeyBase64] }).ok, true);
  });

  it('marker: strict mode REJECTS an unsigned legacy marker ({sha, branch})', () => {
    const res = verifyDeployMarker({ sha: 'abc1234', branch: 'main' }, { requireSigned: true, trustedKeys: [id.publicKeyBase64] });
    assert.equal(res.ok, false);
    assert.equal(res.reason, 'missing-signature');
  });

  it('marker: strict mode REJECTS a tampered marker (sha swapped after signing)', () => {
    const signed = signDeployTrigger(trigger(), { identityDir: dir });
    const res = verifyDeployMarker({ ...signed, sha: 'deadbeef' }, { requireSigned: true, trustedKeys: [id.publicKeyBase64] });
    assert.equal(res.ok, false);
    assert.equal(res.reason, 'invalid-signature');
  });

  it('marker: non-strict allows an unsigned legacy marker with a warning', () => {
    let warned = false;
    const res = verifyDeployMarker({ sha: 'abc1234', branch: 'main' }, { requireSigned: false, log: () => { warned = true; } });
    assert.equal(res.ok, true);
    assert.ok(warned);
  });

  it('env toggles: requireSignedDeploy() + trustedDeployKeys()', () => {
    // Strict is the DEFAULT (env unset). Only an explicit '0' opens it.
    assert.equal(requireSignedDeploy(), true, 'unset env must mean strict');
    process.env.OPENCLAW_REQUIRE_SIGNED_DEPLOY = '1';
    assert.equal(requireSignedDeploy(), true);
    process.env.OPENCLAW_REQUIRE_SIGNED_DEPLOY = '0';
    assert.equal(requireSignedDeploy(), false, 'explicit 0 opts out');
    delete process.env.OPENCLAW_REQUIRE_SIGNED_DEPLOY;
    process.env.OPENCLAW_DEPLOY_TRUSTED_KEYS = 'keyA==, keyB==';
    assert.deepEqual(trustedDeployKeys(), ['keyA==', 'keyB==']);
  });
});

// Both publishers fell back to an unsigned trigger and catch-up marker when the
// key could not be read or made, then said "Deploy trigger sent": every strict
// listener rejected it and raised a security alert.
describe('deploy publishers never send an unsigned trigger', () => {
  const ROOT = fileURLToPath(new URL('..', import.meta.url));
  let tmp, busLog, busStub;
  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'deploy-sign-required-'));
    // An identity key that cannot be read (a directory where the PEM should be).
    mkdirSync(join(tmp, 'home', '.openclaw', 'identity.key'), { recursive: true });
    // A lead checkout whose origin has its branch (fleet-deploy deploys origin's tip).
    const git = (cwd, ...args) => spawnSync('git', args, { cwd, encoding: 'utf8', env: { ...process.env,
      GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@example.invalid', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@example.invalid' } });
    git(tmp, 'init', '-q', '--bare', '-b', 'main', join(tmp, 'origin.git'));
    git(tmp, 'clone', '-q', join(tmp, 'origin.git'), join(tmp, 'lead'));
    git(join(tmp, 'lead'), 'commit', '-q', '--allow-empty', '-m', 'A');
    git(join(tmp, 'lead'), 'push', '-q', 'origin', 'HEAD:main');
    busLog = join(tmp, 'bus.jsonl');
    busStub = join(tmp, 'bus-stub.js');
    writeFileSync(busStub, `
      const Module = require('module');
      const fs = require('fs');
      const load = Module._load;
      const record = (e) => fs.appendFileSync(${JSON.stringify(busLog)}, JSON.stringify(e) + '\\n');
      const enc = (o) => new TextEncoder().encode(JSON.stringify(o));
      const kv = (name) => ({
        keys: async () => (async function* () { yield 'w1'; })(),
        get: async () => (name === 'MESH_NODES' ? { value: enc({ nodeId: 'w1', role: 'worker', lastSeen: new Date().toISOString() }) } : null),
        put: async (k) => record({ put: name, key: k }),
      });
      const nc = {
        subscribe: () => ({ unsubscribe() {} }),
        publish: (subject) => { if (!subject.startsWith('openclaw.trace.')) record({ publish: subject }); },
        flush: async () => {}, close: async () => {},
        jetstream: () => ({ views: { kv: async (name) => kv(name) } }),
      };
      Module._load = function (request, ...rest) {
        const mod = load.call(this, request, ...rest);
        return request === 'nats' ? { ...mod, connect: async () => nc } : mod;
      };
    `);
  });
  afterEach(() => rmSync(tmp, { recursive: true, force: true }));

  const publish = (script, args) => {
    const r = spawnSync(process.execPath, [join(ROOT, 'bin', script), ...args], {
      encoding: 'utf8', cwd: ROOT,
      env: {
        ...process.env, HOME: join(tmp, 'home'), OPENCLAW_REPO_DIR: join(tmp, 'lead'), OPENCLAW_NODE_ID: 'lead-x',
        OPENCLAW_OBS_DB: ':memory:', NODE_OPTIONS: `--require ${busStub}`,
      },
    });
    const bus = existsSync(busLog) ? readFileSync(busLog, 'utf8').trim().split('\n').map(JSON.parse) : [];
    return { ...r, bus };
  };

  for (const [script, args] of [['mesh.js', ['deploy']], ['fleet-deploy.js', ['--node', 'w1']]]) {
    it(`${script} exits non-zero and writes neither the marker nor the trigger`, () => {
      const r = publish(script, args);
      assert.notEqual(r.status, 0, r.stdout + r.stderr);
      assert.match(r.stdout + r.stderr, /\[deploy-auth\] could not sign trigger: /);
      assert.deepEqual(r.bus, [], 'something reached the bus');
      assert.doesNotMatch(r.stdout, /Deploy trigger sent|Trigger published/);
    });
  }
});
