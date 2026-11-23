/**
 * nats-auth-render.test.mjs — the server-side auth block (bin/nats-auth-render.mjs).
 *
 * token mode must be byte-equivalent to the block the templates used to inline;
 * nkey mode lists this node + every registry peer with the v1 worker deny set,
 * lead entries allow all, the legacy password user is present unless dropped,
 * and a render that would lock every node out is refused.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { renderAuthorization, syncNatsAuth, WORKER_PUBLISH_DENY, peersFromRegistry } from '../bin/nats-auth-render.mjs';
import { PROTECTED_NATS_HANDOFF } from '../lib/nats-writer-ownership.mjs';
import { getOrCreateIdentity, createIdentityRegistry } from '../lib/node-identity.mjs';

const require = createRequire(import.meta.url);
const { identityToNkey, publicKeyBase64ToNkey } = require('../lib/nats-nkey.js');
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

const LEAD = 'UDGYMDZZXUB7NCYYJGDZYZMVD7PUZ3VU44ATD6YIX2D5GAKNJKKSAQ7R';
const WORKER = 'UBZJ7OCYDR6BKVIAV4P2Z5SEVDISO2V2JKQ7CS3DI4FYIDMEJCYGM4WB';

function runIsolatedCli(home, script, args, env) {
  const preload = path.join(home, 'isolated-handoff.cjs');
  fs.writeFileSync(preload, `const fs = require('node:fs');
const original = fs.lstatSync;
fs.lstatSync = (name, ...rest) => {
  if (String(name) === ${JSON.stringify(PROTECTED_NATS_HANDOFF)}) {
    const error = new Error('isolated fixture has no host handoff');
    error.code = 'ENOENT';
    throw error;
  }
  return original(name, ...rest);
};
`);
  return spawnSync(process.execPath, ['--require', preload, path.join(ROOT, script), ...args], { encoding: 'utf8', env });
}

describe('renderAuthorization', () => {
  it('token mode reproduces the pre-Phase-7 block exactly', () => {
    assert.equal(renderAuthorization({ mode: 'token', token: 'abc' }), 'authorization {\n  token: "abc"\n}\n');
    assert.equal(renderAuthorization({ mode: 'token', token: null }), 'authorization {\n  token: ""\n}\n');
  });

  it('nkey mode: lead allows all, workers carry the deny set, legacy user last', () => {
    const out = renderAuthorization({
      mode: 'nkey', token: 'tok',
      self: { nodeId: 'lead-a', nkey: LEAD, role: 'lead' },
      peers: [{ nodeId: 'w1', nkey: WORKER, role: 'worker' }],
    });
    assert.ok(out.startsWith('authorization {\n  users: [\n'));
    assert.ok(out.includes(`{ nkey: "${LEAD}" }`), 'lead entry has no permissions block');
    assert.ok(out.includes(`{ nkey: "${WORKER}", permissions: { publish: { deny: ["mesh.deploy.trigger", "$JS.API.STREAM.DELETE.>", "$JS.API.STREAM.PURGE.>", "$JS.API.STREAM.UPDATE.>", "$JS.API.STREAM.MSG.DELETE.>"] } } }`));
    assert.ok(out.includes('{ user: "openclaw", password: "tok" }'));
    assert.deepEqual(WORKER_PUBLISH_DENY, ['mesh.deploy.trigger', '$JS.API.STREAM.DELETE.>', '$JS.API.STREAM.PURGE.>', '$JS.API.STREAM.UPDATE.>', '$JS.API.STREAM.MSG.DELETE.>']);
    // Worker perms deny only publishes: no subscribe block (the deploy listener subscribes).
    assert.doesNotMatch(out, /subscribe/);
  });

  it('nkey mode: a worker self, a lead peer, the legacy user dropped, duplicates collapsed', () => {
    const out = renderAuthorization({
      mode: 'nkey', token: 'tok', legacyUser: false,
      self: { nodeId: 'w1', nkey: WORKER, role: 'worker' },
      peers: [{ nodeId: 'lead-a', nkey: LEAD, role: 'lead' }, { nodeId: 'w1-again', nkey: WORKER, role: 'lead' }],
    });
    assert.equal(out.match(/nkey: "/g).length, 2, 'the same nkey is listed once, first role wins');
    assert.ok(out.includes(`{ nkey: "${WORKER}", permissions`));
    assert.ok(out.includes(`{ nkey: "${LEAD}" }`));
    assert.doesNotMatch(out, /password/);
    assert.doesNotMatch(renderAuthorization({ mode: 'nkey', token: 'tok', legacyUser: '0', self: { nkey: LEAD, role: 'lead' } }), /password/);
  });

  it('refuses nkey mode with zero nkeys and unknown modes', () => {
    assert.throws(() => renderAuthorization({ mode: 'nkey', token: 'tok' }), /zero nkeys/);
    assert.throws(() => renderAuthorization({ mode: 'creds', token: 'tok' }), /unknown auth mode/);
  });
});

describe('syncNatsAuth', () => {
  function tmpHome() {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'nats-auth-sync-'));
    fs.mkdirSync(path.join(home, '.openclaw'), { recursive: true });
    return home;
  }
  // --sync-nats reloads nats-server; a stub first on PATH takes that call so
  // the host's own nats-server is never signalled.
  function stubNatsServer(home) {
    const dir = path.join(home, 'stubbin');
    fs.mkdirSync(dir);
    fs.writeFileSync(path.join(dir, 'nats-server'), '#!/bin/sh\nprintf \'%s\\n\' "$*" >> "$NATS_STUB_LOG"\nexit 0\n', { mode: 0o755 });
    return { dir, log: path.join(home, 'nats-server.log') };
  }
  const KEYS = ['HOME', 'OPENCLAW_NATS_TOKEN', 'OPENCLAW_NATS_AUTH', 'OPENCLAW_NODE_ROLE', 'OPENCLAW_NODE_ID', 'OPENCLAW_IDENTITY_DIR', 'OPENCLAW_NATS_LEGACY_USER'];

  it('renders from the identity + registry through the CLI, mode 600, no secret on argv', () => {
    const home = tmpHome();
    const dir = path.join(home, '.openclaw');
    fs.writeFileSync(path.join(dir, 'openclaw.env'), 'OPENCLAW_NATS_TOKEN=tok-xyz\nOPENCLAW_NATS_AUTH=nkey\nOPENCLAW_NODE_ROLE=lead\nOPENCLAW_NODE_ID=lead-a\n');
    const self = getOrCreateIdentity(dir);
    const peer = getOrCreateIdentity(path.join(home, 'peer'));
    const registry = createIdentityRegistry({ path: path.join(dir, 'identity-registry.json'), mode: 'strict' });
    registry.trust('w1', peer.publicKeyBase64, 'operator');
    registry.trust('bad', 'not-a-key', 'operator');
    const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !KEYS.includes(k)));
    const out = path.join(dir, 'config', 'nats-auth.conf');
    const r = runIsolatedCli(home, 'bin/nats-auth-render.mjs', ['--out', out], { ...env, HOME: home });
    assert.equal(r.status, 0, r.stderr);
    assert.doesNotMatch(r.stderr, /tok-xyz/, 'the token never appears in output/logs');
    assert.match(r.stderr, /skipping registry entry bad/);
    assert.match(r.stderr, /2 nkey user\(s\) \[lead-a:lead, w1:worker\] \+ legacy user openclaw/);
    const text = fs.readFileSync(out, 'utf8');
    assert.equal(fs.statSync(out).mode & 0o777, 0o600);
    assert.ok(text.includes(`{ nkey: "${identityToNkey(dir).publicNkey}" }`), 'self is the lead: allow all');
    assert.ok(text.includes(`{ nkey: "${publicKeyBase64ToNkey(peer.publicKeyBase64)}", permissions`));
    assert.ok(text.includes('password: "tok-xyz"'));
    // --no-legacy-user drops the password entry; --mode token overrides the file.
    const r2 = runIsolatedCli(home, 'bin/nats-auth-render.mjs', ['--out', out, '--no-legacy-user'], { ...env, HOME: home });
    assert.equal(r2.status, 0, r2.stderr);
    assert.doesNotMatch(fs.readFileSync(out, 'utf8'), /password/);
    const r3 = runIsolatedCli(home, 'bin/nats-auth-render.mjs', ['--out', out, '--mode', 'token'], { ...env, HOME: home });
    assert.equal(r3.status, 0, r3.stderr);
    assert.equal(fs.readFileSync(out, 'utf8'), 'authorization {\n  token: "tok-xyz"\n}\n');
    fs.rmSync(home, { recursive: true, force: true });
  });

  it('nkey mode refuses to guess this node\'s role: unset or unknown renders nothing', () => {
    const home = tmpHome();
    const dir = path.join(home, '.openclaw');
    getOrCreateIdentity(dir);
    const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !KEYS.includes(k)));
    const out = path.join(dir, 'config', 'nats-auth.conf');
    for (const roleLine of ['', 'OPENCLAW_NODE_ROLE=Lead\n']) {
      fs.writeFileSync(path.join(dir, 'openclaw.env'), `OPENCLAW_NATS_TOKEN=t\nOPENCLAW_NATS_AUTH=nkey\nOPENCLAW_NODE_ID=lead-a\n${roleLine}`);
      const r = runIsolatedCli(home, 'bin/nats-auth-render.mjs', ['--out', out], { ...env, HOME: home });
      assert.equal(r.status, 1, `${JSON.stringify(roleLine)}: ${r.stderr}`);
      assert.match(r.stderr, /OPENCLAW_NODE_ROLE is (not set|"Lead") — nkey mode/);
      assert.doesNotMatch(r.stderr, /mac|linux|darwin/i);
      assert.ok(!fs.existsSync(out), 'a render with a guessed role was written');
    }
    // Token mode carries no per-node permissions: it needs no role.
    const r = runIsolatedCli(home, 'bin/nats-auth-render.mjs', ['--out', out, '--mode', 'token'], { ...env, HOME: home });
    assert.equal(r.status, 0, r.stderr);
    // An explicit worker role renders the worker entry.
    fs.writeFileSync(path.join(dir, 'openclaw.env'), 'OPENCLAW_NATS_TOKEN=t\nOPENCLAW_NATS_AUTH=nkey\nOPENCLAW_NODE_ID=lead-a\nOPENCLAW_NODE_ROLE=worker\n');
    const w = runIsolatedCli(home, 'bin/nats-auth-render.mjs', ['--out', out], { ...env, HOME: home });
    assert.equal(w.status, 0, w.stderr);
    assert.match(w.stderr, /\[lead-a:worker\]/);
    fs.rmSync(home, { recursive: true, force: true });
  });

  it('peersFromRegistry maps raw base64 pubkeys to public nkeys with their role', () => {
    const home = tmpHome();
    const a = getOrCreateIdentity(path.join(home, 'a'));
    const registry = createIdentityRegistry({ path: path.join(home, 'r.json'), mode: 'strict' });
    registry.trust('zeta', a.publicKeyBase64, 'operator', { role: 'lead' });
    const peers = peersFromRegistry(registry);
    assert.deepEqual(peers, [{ nodeId: 'zeta', nkey: publicKeyBase64ToNkey(a.publicKeyBase64), role: 'lead' }]);
    fs.rmSync(home, { recursive: true, force: true });
  });

  it('openclaw-trust-peer --sync-nats re-renders the file after trusting a peer', async () => {
    const home = tmpHome();
    const dir = path.join(home, '.openclaw');
    fs.writeFileSync(path.join(dir, 'openclaw.env'), 'OPENCLAW_NATS_TOKEN=t\nOPENCLAW_NATS_AUTH=nkey\nOPENCLAW_NODE_ROLE=lead\nOPENCLAW_NODE_ID=lead-a\n');
    const peer = getOrCreateIdentity(path.join(home, 'peer'));
    const stub = stubNatsServer(home);
    const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !KEYS.includes(k)));
    const r = runIsolatedCli(home, 'bin/openclaw-trust-peer.mjs', ['w2', peer.publicKeyBase64, '--sync-nats'], { ...env, HOME: home, OPENCLAW_IDENTITY_DIR: dir, NATS_STUB_LOG: stub.log, PATH: `${stub.dir}${path.delimiter}${process.env.PATH}` });
    assert.equal(r.status, 0, r.stderr + r.stdout);
    assert.match(r.stdout, /trusted: w2 \(worker\)/);
    assert.match(r.stdout, /nats-auth: nkey mode/);
    const text = fs.readFileSync(path.join(dir, 'config', 'nats-auth.conf'), 'utf8');
    assert.ok(text.includes(publicKeyBase64ToNkey(peer.publicKeyBase64)));
    assert.match(r.stdout, /reloaded via nats-server --signal reload/);
    assert.equal(fs.readFileSync(stub.log, 'utf8').trim(), '--signal reload');
    fs.rmSync(home, { recursive: true, force: true });
  });

  it('openclaw-trust-peer --sync-nats still syncs when the peer was already trusted with the same key', () => {
    const home = tmpHome();
    const dir = path.join(home, '.openclaw');
    fs.writeFileSync(path.join(dir, 'openclaw.env'), 'OPENCLAW_NATS_TOKEN=t\nOPENCLAW_NATS_AUTH=nkey\nOPENCLAW_NODE_ROLE=lead\nOPENCLAW_NODE_ID=lead-a\n');
    const peer = getOrCreateIdentity(path.join(home, 'peer'));
    const stub = stubNatsServer(home);
    const env = { ...Object.fromEntries(Object.entries(process.env).filter(([k]) => !KEYS.includes(k))), HOME: home, OPENCLAW_IDENTITY_DIR: dir, NATS_STUB_LOG: stub.log, PATH: `${stub.dir}${path.delimiter}${process.env.PATH}` };
    const first = runIsolatedCli(home, 'bin/openclaw-trust-peer.mjs', ['w2', peer.publicKeyBase64], env);
    assert.equal(first.status, 0, first.stderr);
    assert.equal(fs.existsSync(path.join(dir, 'config', 'nats-auth.conf')), false);
    const again = runIsolatedCli(home, 'bin/openclaw-trust-peer.mjs', ['w2', peer.publicKeyBase64, '--sync-nats'], env);
    assert.equal(again.status, 0, again.stderr + again.stdout);
    assert.match(again.stdout, /already trusted with same pubkey/);
    assert.ok(fs.readFileSync(path.join(dir, 'config', 'nats-auth.conf'), 'utf8').includes(publicKeyBase64ToNkey(peer.publicKeyBase64)));
    assert.match(again.stdout, /reloaded via nats-server --signal reload/);
    assert.equal(fs.readFileSync(stub.log, 'utf8').trim(), '--signal reload');
    fs.rmSync(home, { recursive: true, force: true });
  });

  it('openclaw-trust-peer fails instead of reporting trusted when the registry cannot be written', () => {
    const home = tmpHome();
    const notDir = path.join(home, 'identity-is-a-file');
    fs.writeFileSync(notDir, '');
    const peer = getOrCreateIdentity(path.join(home, 'peer'));
    const env = { ...Object.fromEntries(Object.entries(process.env).filter(([k]) => !KEYS.includes(k))), HOME: home, OPENCLAW_IDENTITY_DIR: notDir };
    const r = runIsolatedCli(home, 'bin/openclaw-trust-peer.mjs', ['w2', peer.publicKeyBase64], env);
    assert.notEqual(r.status, 0);
    assert.doesNotMatch(r.stdout, /trusted:/);
    assert.match(r.stderr, /could not be written/);
    fs.rmSync(home, { recursive: true, force: true });
  });
});
