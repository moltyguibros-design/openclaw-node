#!/usr/bin/env node
/**
 * mesh-agent-bus-reconnect.test.js — the agent outlives a bus outage on both
 * platforms: launchd never restarts the on-demand agent (KeepAlive false), so
 * it reconnects for as long as it runs, retries a first connect made before the
 * bus is up, and bounds its shutdown drain so a stop during an outage ends.
 *
 * Run: node --test test/mesh-agent-bus-reconnect.test.js
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-bus-'));
Object.assign(process.env, {
  HOME: TMP,
  MESH_WORKSPACE: path.join(TMP, 'workspace'),
  OPENCLAW_NODE_ID: 'node-bus',
  OPENCLAW_OBS_DB: ':memory:',
  MESH_MEMORY_RECALL: 'off',
});

const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const agent = require('../bin/mesh-agent.js');

const ROOT = path.join(__dirname, '..');
after(() => fs.rmSync(TMP, { recursive: true, force: true }));

describe('bus connection', () => {
  it('reconnects without a limit', () => {
    const opts = agent.__test.agentConnectOptions();
    assert.equal(opts.reconnect, true);
    assert.equal(opts.maxReconnectAttempts, -1);
  });

  it('retries a first connect made before the bus is up, with backoff', async () => {
    const waits = [];
    let calls = 0;
    const conn = { fake: true };
    const nc = await agent.__test.connectToBus(async (opts) => {
      calls += 1;
      assert.equal(opts.maxReconnectAttempts, -1);
      if (calls <= 2) throw new Error('CONNECTION_REFUSED');
      return conn;
    }, { sleep: async (ms) => { waits.push(ms); } });
    assert.equal(nc, conn);
    assert.equal(calls, 3);
    assert.deepEqual(waits, [2000, 4000]);
  });

  it('a stop drain the bus never answers ends within its bound and closes the connection', async () => {
    let closed = false;
    const conn = { drain: () => new Promise(() => {}), close: async () => { closed = true; }, isClosed: () => closed };
    await assert.rejects(agent.__test.drainBus(conn, 50), /did not finish within/);
    assert.equal(closed, true);
  });

  it('a drain that completes is a clean stop', async () => {
    let closed = false;
    const conn = { drain: async () => { closed = true; }, close: async () => {}, isClosed: () => closed };
    await agent.__test.drainBus(conn, 1000);
  });
});

describe('start hints for the on-demand agent', () => {
  const plist = fs.readFileSync(path.join(ROOT, 'services/launchd/ai.openclaw.mesh-agent.plist'), 'utf8');
  const services = fs.readFileSync(path.join(ROOT, 'scripts/install/services.sh'), 'utf8');

  it('no exit claims a launchd restart that KeepAlive false never performs', () => {
    assert.match(plist, /<key>KeepAlive<\/key>\s*<false\/>/);
    assert.doesNotMatch(fs.readFileSync(path.join(ROOT, 'bin/mesh-agent.js'), 'utf8'), /launchd restart/);
    assert.doesNotMatch(plist, /ThrottleInterval/, 'inert without KeepAlive');
  });

  it('macOS is told to kickstart the agent (RunAtLoad false: a load starts nothing), Linux to start it without enabling it at boot', () => {
    assert.doesNotMatch(plist, /load manually with: launchctl load/);
    assert.match(plist, /launchctl kickstart gui\/\$\(id -u\)\/ai\.openclaw\.mesh-agent/);
    assert.match(services, /launchctl kickstart gui\/\\\$\(id -u\)\/ai\.openclaw\.mesh-agent/);
    assert.match(services, /systemctl --user start openclaw-mesh-agent/);
  });
});
