import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { pathToFileURL } from 'node:url';

const moduleURL = process.env.PLACEMENT_FAILURE_TEST_MODULE
  ? pathToFileURL(path.resolve(process.env.PLACEMENT_FAILURE_TEST_MODULE))
  : new URL('placement_readiness.mjs', import.meta.url);
const { addR3WithEvidence } = await import(moduleURL);

const names = ['member-1', 'member-2', 'member-3'];
const ready = () => names.map((name, i) => ({ name,
  js: { server_id: `id-${i}`, meta_cluster: { leader: names[0], cluster_size: 3,
    replicas: i === 0 ? names.slice(1).map(name => ({ name, current: true, offline: false })) : [] } },
  varz: { server_name: name, server_id: `id-${i}` },
  routes: { server_id: `id-${i}`, routes: names.flatMap((_, j) => j === i ? []
    : [{ ip: '127.0.0.1', remote_id: `id-${j}` }]) }
}));

function owned() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'owned-r3-failure-evidence-'));
  const items = names.map(name => {
    const log = path.join(root, name + '.log');
    fs.writeFileSync(log, 'before: Peer selection: old line\n', { mode: 0o600 });
    return { name, log };
  });
  return { root, items, output: path.join(root, 'placement-failure.json') };
}

async function sameError(promise, original) {
  let caught;
  try { await promise; } catch (error) { caught = error; }
  assert.equal(caught, original, 'original placement error identity survives capture');
}

test('portable failure records exact post-offset selection windows and rethrows the original error', async () => {
  const { root, items, output } = owned();
  const prior = fs.statSync(items[0].log).size;
  const error = Object.assign(new Error('no suitable peers for placement, peer offline'),
    { name: 'NatsError', code: '400', api_error: { code: 400, err_code: 10005 } });
  const emitted = [];
  let calls = 0;
  const manager = { streams: { add: async config => {
    calls++;
    assert.equal(config.num_replicas, 3);
    fs.appendFileSync(items[0].log, '[DBG] Peer selection: discard member-2@recovery-fixture reason: offline\n');
    fs.appendFileSync(items[0].log, '[DBG] Peer selection: required 3 nodes but found 1\n');
    fs.appendFileSync(items[1].log, 'unrelated debug output\n');
    throw error;
  } } };
  await sameError(addR3WithEvidence(manager, { num_replicas: 3 }, items, ready(),
    'cluster-offline-consumer-placeholder', output, line => emitted.push(line)), error);
  assert.equal(calls, 1, 'failed R3 request is never retried');
  assert(fs.existsSync(output), 'failed R3 report must exist');
  const report = JSON.parse(fs.readFileSync(output, 'utf8'));
  assert.equal(fs.statSync(output).mode & 0o777, 0o600);
  assert.equal(report.schema, 'owned-r3-placement-failure-v1');
  assert.equal(report.phase, 'cluster-offline-consumer-placeholder');
  assert.equal(report.attempts, 1);
  assert.equal(report.preCreate.ready, true);
  assert.deepEqual(Object.values(report.preCreate.checks), Array(8).fill(true));
  assert.deepEqual(report.preCreate.members.map(row => row.name), names);
  assert.deepEqual(report.windows.map(row => row.name), names);
  assert.equal(report.windows[0].from, prior, 'phase-local window starts after preexisting log');
  assert.equal(report.windows[0].to, fs.statSync(items[0].log).size);
  assert.equal(report.windows[0].complete, true);
  assert.deepEqual(report.windows[0].selection, [
    'Peer selection: discard member-2@recovery-fixture reason: offline',
    'Peer selection: required 3 nodes but found 1'
  ], 'selector lines retained from failed call');
  assert.equal(report.windows[0].sha256, createHash('sha256').update(fs.readFileSync(items[0].log).subarray(prior)).digest('hex'),
    'raw window digest binds the selected bytes');
  assert.deepEqual(report.windows[1].selection, []);
  assert.equal(report.error.peerOffline, true);
  assert.equal(report.error.apiErrorCode, 10005, 'NATS error code retained');
  assert.equal(emitted.length, 1);
  assert(emitted[0].startsWith('owned-r3-placement-failure: '));
  assert.equal(JSON.parse(emitted[0].slice('owned-r3-placement-failure: '.length)).phase, report.phase);
  fs.rmSync(root, { recursive: true, force: true });
});

test('portable success returns the response without creating failure evidence', async () => {
  const { root, items, output } = owned();
  const response = { config: { name: 'R3', num_replicas: 3 } };
  let calls = 0;
  const emitted = [];
  const value = await addR3WithEvidence({ streams: { add: async () => { calls++; return response; } } },
    { num_replicas: 3 }, items, ready(), 'cluster-replicated-r3-create', output, line => emitted.push(line));
  assert.equal(value, response);
  assert.equal(calls, 1);
  assert.equal(fs.existsSync(output), false);
  assert.deepEqual(emitted, []);
  fs.rmSync(root, { recursive: true, force: true });
});

test('portable failure report does not serialize an error message containing a secret', async () => {
  const { root, items, output } = owned();
  const secret = 'owned-private-token-for-negative';
  const error = Object.assign(new Error(secret), { name: 'NatsError', code: '503' });
  const emitted = [];
  await assert.rejects(addR3WithEvidence({ streams: { add: async () => { throw error; } } },
    { num_replicas: 3 }, items, ready(), 'cluster-empty-r3-create', output, line => emitted.push(line)), value => value === error);
  const bytes = fs.readFileSync(output, 'utf8');
  assert.equal(bytes.includes(secret), false, 'private message bytes cannot enter the report');
  assert.equal(emitted.join('').includes(secret), false, 'private message bytes cannot enter the log');
  assert.equal(JSON.parse(bytes).error.peerOffline, false);
  fs.rmSync(root, { recursive: true, force: true });
});

test('portable failed pre-create readiness stays false in the report', async () => {
  const { root, items, output } = owned();
  const observations = ready();
  observations[1].routes.routes.pop();
  const error = new Error('owned failure');
  await assert.rejects(addR3WithEvidence({ streams: { add: async () => { throw error; } } },
    { num_replicas: 3 }, items, observations, 'cluster-empty-r3-create', output, () => {}), value => value === error);
  const report = JSON.parse(fs.readFileSync(output, 'utf8'));
  assert.equal(report.preCreate.ready, false, 'pre-create readiness is not inferred from the failed API call');
  assert.equal(report.preCreate.checks.routePeers, false);
  fs.rmSync(root, { recursive: true, force: true });
});

test('portable oversized selector windows remain explicitly incomplete', async () => {
  const { root, items, output } = owned();
  const error = new Error('owned failure');
  await assert.rejects(addR3WithEvidence({ streams: { add: async () => {
    fs.appendFileSync(items[0].log, 'x'.repeat(131073));
    throw error;
  } } }, { num_replicas: 3 }, items, ready(), 'cluster-empty-r3-create', output, () => {}), value => value === error);
  const report = JSON.parse(fs.readFileSync(output, 'utf8'));
  assert.equal(report.windows[0].complete, false, 'oversized selector window cannot claim complete evidence');
  assert.deepEqual(report.windows[0].selection, []);
  fs.rmSync(root, { recursive: true, force: true });
});

test('portable evidence capture failure preserves the original placement error', async () => {
  const { root, items, output } = owned();
  const error = new Error('placement failed');
  await sameError(addR3WithEvidence({ streams: { add: async () => {
    fs.rmSync(items[0].log);
    throw error;
  } } }, { num_replicas: 3 }, items, ready(), 'cluster-empty-r3-create', output, () => {}), error);
  assert.equal(fs.existsSync(output), false);
  fs.rmSync(root, { recursive: true, force: true });
});

test('portable recovery fixture routes every owned R3 creation through the evidence helper', () => {
  const source = fs.readFileSync(new URL('test_recovery.mjs', import.meta.url), 'utf8');
  assert.equal((source.match(/await addR3\(manager, \{/g) || []).length, 4);
  assert.equal((source.match(/await manager\.streams\.add\(\{[^\n]*num_replicas: 3/g) || []).length, 0);
});
