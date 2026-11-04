import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { test } from 'node:test';

const base = new URL('./', import.meta.url);
const variant = process.env.PLACEMENT_GOSSIP_TEST_MODULE;
const probeURL = variant ? pathToFileURL(path.resolve(variant)) : new URL('probe_placement_gossip.mjs', base);
const { NAMES, VERSION, REFUSAL, apiDeltas, leaderReason, classifyDiagnosis, runDiagnosis } = await import(probeURL);
const { placementState, waitCluster } = await import(new URL('placement_readiness.mjs', probeURL));
const sha = value => createHash('sha256').update(value).digest('hex');

function ready() {
  return NAMES.map((name, i) => ({ name,
    js: { server_id: `id-${i}`, meta_cluster: { leader: NAMES[0], cluster_size: 3,
      replicas: i === 0 ? NAMES.slice(1).map(name => ({ name, current: true, offline: false })) : [] } },
    varz: { server_name: name, server_id: `id-${i}` },
    routes: { server_id: `id-${i}`, routes: NAMES.flatMap((_, j) => j === i ? [] : [{ ip: '127.0.0.1', remote_id: `id-${j}` }]) }
  }));
}

function cohort(fault) {
  const apiBefore = NAMES.map((name, i) => ({ name, server_id: `id-${i}`, api: { total: 7, errors: 2 } }));
  const apiAfter = structuredClone(apiBefore);
  apiAfter[2].api.total++;
  if (fault) apiAfter[2].api.errors++;
  return { root: fault ? '/owned/fault' : '/owned/control', fault, ports: Array.from({ length: 9 }, (_, i) => 18000 + i + (fault ? 20 : 0)),
    attempts: 1, discoveryConnections: 3, connectedMember: NAMES[0], ready: ready(), apiBefore, apiAfter,
    outcome: fault ? 'refused' : 'created', response: { replicas: 3 },
    error: { code: '400', message: REFUSAL, api_error: { code: 400, err_code: 10005, description: REFUSAL } },
    selection: [{ name: NAMES[0], from: 100, to: 600, truncated: false, lines: [
      ...NAMES.slice(1).map(name => `[DBG] Peer selection: discard ${name}@recovery-fixture reason: offline`),
      '[DBG] Peer selection: required 3 nodes but found 1 (cluster: recovery-fixture replica: 3 existing: []/0 peers: 3 result-peers: 1 err: {excludeTag:false offline:true noStorage:false uniqueTag:false misc:false noJsClust:false noMatchTags:map[] excludeTags:map[]})' ] }],
    cleanupFailures: [], owners: NAMES.map(name => ({ name, exitCode: 0, signalCode: null, shutdownMarker: true })) };
}
const report = () => ({ binary: { version: VERSION }, control: cohort(false), fault: cohort(true) });
function refuses(change, check) {
  const value = report();
  change(value);
  const result = classifyDiagnosis(value);
  assert.equal(result.checks[check], false, `evidence ${check} rejects changed input`);
  assert.equal(result.outcome, 'inconclusive', `evidence ${check} cannot claim reproduction`);
}

test('portable source extraction keeps exact helpers and pins the owned recovery caller', () => {
  assert.equal(sha(placementState.toString()), '55bd148bddf7b16efabd8c84a881b2f9eff75483c2792479ed31d8c18a499e0a');
  assert.equal(sha(waitCluster.toString()), '0458913e112d04a24918160160054cd772dd61bbc67f05cab4e3ff4461dffcf2');
  const source = fs.readFileSync(new URL('test_recovery.mjs', base), 'utf8');
  const line = "import { placementState, waitCluster, addR3WithEvidence } from './placement_readiness.mjs';\n";
  assert.equal(source.split(line).length, 2);
  assert.equal(sha(source.replace(line, '')), '0aaae6f7f8dd4b089eed3a954baaaba2e1185afa46940bc69e93a68bece924b7');
});

test('portable old gate accepts the complete synthetic ready table', () => {
  const state = placementState(ready(), NAMES);
  assert.deepEqual(Object.values(state.checks), Array(8).fill(true));
  assert.equal(state.ready, true);
});

const oldChanges = {
  cohort: rows => { rows[1].name = 'foreign'; rows[1].varz.server_name = 'foreign'; },
  identities: rows => { rows[1].varz.server_id = 'foreign'; },
  leaderAgreement: rows => { rows[1].js.meta_cluster.leader = NAMES[1]; },
  membership: rows => { rows[0].js.meta_cluster.replicas[0].name = 'foreign'; },
  currentPeers: rows => { rows[0].js.meta_cluster.replicas[0].current = false; },
  clusterSizes: rows => { rows[1].js.meta_cluster.cluster_size = 2; },
  routePeers: rows => { rows[1].routes.routes.pop(); },
  confinedRoutes: rows => { rows[1].routes.routes[0].ip = '192.0.2.1'; },
};
for (const [key, change] of Object.entries(oldChanges)) test(`portable old predicate ${key} refuses`, () => {
  const rows = ready(); change(rows);
  const state = placementState(rows, NAMES);
  assert.deepEqual(state.checks, Object.fromEntries(Object.keys(oldChanges).map(name => [name, name !== key])));
  assert.equal(state.ready, false, `old predicate ${key} refuses changed table`);
});

test('portable api accounting follows the responder when connected member has zero delta', () => {
  const value = report();
  assert.deepEqual(apiDeltas(value.control).map(row => row.total), [0, 0, 1]);
  assert.deepEqual(apiDeltas(value.fault).map(row => row.errors), [0, 0, 1]);
  assert.equal(classifyDiagnosis(value).outcome, 'owned-counterexample', 'aggregate counters accept one responder request');
});

const changes = {
  version: d => { d.binary.version = 'nats-server: v2.12.7'; },
  controlReady: d => { d.control.ready[0].routes.routes.pop(); },
  faultReady: d => { d.fault.ready[0].routes.routes.pop(); },
  injections: d => { d.fault.discoveryConnections = 2; },
  singleCreate: d => { d.fault.attempts = 2; },
  controlCreated: d => { d.control.response.replicas = 1; },
  exactRefusal: d => { d.fault.error.api_error.description = 'no suitable peers for placement, miscellaneous issue'; },
  leaderReason: d => { d.fault.selection[0].lines.pop(); },
  controlApi: d => { d.control.apiAfter[2].api.total++; },
  faultApi: d => { d.fault.apiAfter[2].api.errors--; },
  cleanup: d => { d.control.cleanupFailures.push({ error: 'forced cleanup' }); },
  isolation: d => { d.fault.ports[0] = d.control.ports[0]; },
};
for (const [key, change] of Object.entries(changes)) test(`portable evidence ${key} refuses`, () => refuses(change, key));

test('portable leader evidence rejects each missing peer, wrong leader, reason and window', () => {
  const edits = [
    c => c.selection[0].lines.splice(0, 1), c => c.selection[0].lines.splice(1, 1),
    c => { c.selection[0].name = NAMES[1]; }, c => { c.selection[0].truncated = true; },
    c => { c.selection[0].from = -1; }, c => { c.selection[0].to = 0; },
    c => { c.selection[0].lines[0] = c.selection[0].lines[0].replace('offline', 'missing'); },
    c => { c.selection[0].lines[2] = c.selection[0].lines[2].replace('misc:false', 'misc:true'); },
    c => { c.selection[0].lines[2] = c.selection[0].lines[2].replace('offline:true', 'offline:false'); },
    c => { c.selection[0].lines[2] = c.selection[0].lines[2].replace('peers: 3', 'peers: 4'); },
  ];
  assert(leaderReason(cohort(true)));
  for (const edit of edits) { const c = cohort(true); edit(c); assert.equal(leaderReason(c), false, 'leader evidence rejects missing or unrelated reason'); }
});

function partition(c, names, found = 3 - names.length, result = found, required = 3, peers = 3) {
  c.selection[0].lines = [
    ...names.map(name => `[DBG] Peer selection: discard ${name}@recovery-fixture reason: offline`),
    `[DBG] Peer selection: required ${required} nodes but found ${found} (cluster: recovery-fixture replica: 3 existing: []/0 peers: ${peers} result-peers: ${result} err: {excludeTag:false offline:true noStorage:false uniqueTag:false misc:false noJsClust:false noMatchTags:map[] excludeTags:map[]})`
  ];
}

test('portable three-discard partition includes the leader', () => {
  const value = report();
  partition(value.fault, [NAMES[0], NAMES[2], NAMES[1]]);
  assert.equal(leaderReason(value.fault), true, 'three-discard partition accepts remaining zero');
  assert.equal(classifyDiagnosis(value).outcome, 'owned-counterexample');
});

const partitions = {
  'single-nonleader': c => partition(c, [NAMES[1]]),
  'leader-only': c => partition(c, [NAMES[0]]),
  'self-plus-other': c => partition(c, [NAMES[0], NAMES[1]]),
  'foreign-name': c => partition(c, [NAMES[1], NAMES[2], 'foreign']),
  'duplicate-name': c => partition(c, [NAMES[1], NAMES[2], NAMES[1]]),
  'two-summaries': c => c.selection[0].lines.push(c.selection[0].lines.at(-1)),
  'wrong-required': c => partition(c, NAMES.slice(1), 1, 1, 2),
  'wrong-peers': c => partition(c, NAMES.slice(1), 1, 1, 3, 4),
  'wrong-found': c => partition(c, NAMES.slice(1), 0, 1),
  'wrong-result': c => partition(c, NAMES.slice(1), 1, 0),
  'zero-without-self': c => partition(c, NAMES.slice(1), 0, 0),
  'one-with-self': c => partition(c, NAMES, 1, 1),
  'unpinned-reason': c => { c.selection[0].lines[0] = c.selection[0].lines[0].replace('reason: offline', 'reason: not target cluster foreign'); },
  'unpinned-line': c => c.selection[0].lines.push('[DBG] Peer selection: unknown message'),
};
for (const [name, change] of Object.entries(partitions)) test(`portable partition ${name} refuses`, () => {
  const c = cohort(true); change(c);
  assert.equal(leaderReason(c), false, `partition ${name} refuses`);
});

test('portable counter snapshots reject missing, duplicate, changed identity and reverse counters', () => {
  const edits = [
    c => c.apiBefore.pop(), c => c.apiAfter.pop(), c => { c.apiBefore[1].name = NAMES[0]; },
    c => { c.apiAfter[1].server_id = 'foreign'; }, c => { c.apiBefore[1].server_id = 'foreign'; },
    c => { c.apiAfter[1].api.total--; }, c => { c.apiAfter[1].api.errors--; },
    c => { c.apiAfter[1].api.total--; c.apiAfter[2].api.total++; },
    c => { c.apiAfter[1].api.errors--; c.apiAfter[2].api.errors++; },
  ];
  for (const edit of edits) refuses(d => edit(d.fault), 'faultApi');
});

test('portable cleanup requires all three normal owners in each cohort', () => {
  for (const side of ['control', 'fault']) for (const edit of [
    c => c.owners.pop(), c => { c.owners[0].exitCode = 1; }, c => { c.owners[0].signalCode = 'SIGKILL'; },
    c => { c.owners[0].shutdownMarker = false; }, c => { c.owners[1].name = NAMES[0]; },
  ]) refuses(d => edit(d[side]), 'cleanup');
});

test('portable isolation rejects root overlap, production ports and incomplete port tables', () => {
  for (const edit of [d => { d.fault.root = d.control.root; }, d => { d.control.ports[0] = 4222; },
    d => d.fault.ports.pop()]) refuses(edit, 'isolation');
});

test('portable client refusal requires all exact codes and both descriptions', () => {
  for (const edit of [c => { c.outcome = 'created'; }, c => { c.error.code = '503'; },
    c => { c.error.api_error.code = 503; }, c => { c.error.api_error.err_code = 10008; },
    c => { c.error.message = 'different'; }]) refuses(d => edit(d.fault), 'exactRefusal');
});

test('portable wrong binary version refuses before loading NATS or starting a cohort', async () => {
  await assert.rejects(runDiagnosis(process.execPath), /probe pins the exact upstream debug wording and server version/);
});

test('real owned control and STATSZ-denied pair', async () => {
  const value = await runDiagnosis(process.env.NATS_SERVER, process.env.PLACEMENT_GOSSIP_REPORT);
  console.log('placement-gossip-report ' + JSON.stringify(value));
  assert.equal(value.historicalCauseEstablished, false);
  assert.equal(value.repair, false);
  assert.equal(value.diagnosis.outcome, 'owned-counterexample', 'real owned pair must establish only the injected sufficiency counterexample');
  assert.equal(fs.existsSync(path.join(value.control.root, 'placement-failure.json')), false);
  const retained = JSON.parse(fs.readFileSync(path.join(value.fault.root, 'placement-failure.json'), 'utf8'));
  assert.equal(retained.phase, 'injected-stats-denied-r3-create');
  assert.equal(retained.attempts, 1);
  assert.equal(retained.preCreate.ready, true);
  assert.equal(retained.error.apiErrorCode, 10005);
  const leader = value.fault.ready[0].js.meta_cluster.leader;
  assert.deepEqual(retained.windows.find(row => row.name === leader).selection,
    value.fault.selection.find(row => row.name === leader).lines.map(line => line.slice(line.indexOf('Peer selection:'))));
});
