import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));
const test = path.join(dir, 'test_placement_gossip.mjs');
const probe = fs.readFileSync(path.join(dir, 'probe_placement_gossip.mjs'), 'utf8');
const helper = fs.readFileSync(path.join(dir, 'placement_readiness.mjs'), 'utf8');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'owned-placement-mutants-'));
const run = (pattern, module) => spawnSync(process.execPath,
  ['--test', '--test-reporter=tap', '--test-name-pattern=' + pattern, test],
  { encoding: 'utf8', timeout: 30000, env: { ...process.env, PLACEMENT_GOSSIP_TEST_MODULE: module || '' } });
const controls = run('portable ');
assert.equal(controls.status, 0, controls.stdout + controls.stderr);
assert(!controls.stdout.includes('placement-gossip-report'), 'mutant controls must not start live cohorts');
console.log('unmutated placement-gossip controls: all passed');
const variants = [];
for (const key of ['cohort', 'identities', 'leaderAgreement', 'membership', 'currentPeers', 'clusterSizes', 'routePeers', 'confinedRoutes']) {
  variants.push({ name: 'old-' + key, target: 'helper', before: 'Object.values(checks).every(Boolean)',
    after: `Object.entries(checks).filter(([key]) => key !== '${key}').every(([, value]) => value)`,
    test: `portable old predicate ${key} refuses`, assertion: `old predicate ${key} refuses changed table` });
}
for (const key of ['version', 'controlReady', 'faultReady', 'injections', 'singleCreate', 'controlCreated', 'exactRefusal', 'leaderReason', 'controlApi', 'faultApi', 'cleanup', 'isolation']) {
  variants.push({ name: 'evidence-' + key, target: 'probe', before: "Object.values(checks).every(Boolean) ? 'owned-counterexample'",
    after: `Object.entries(checks).filter(([key]) => key !== '${key}').every(([, value]) => value) ? 'owned-counterexample'`,
    test: `portable evidence ${key} refuses`, assertion: `evidence ${key} cannot claim reproduction` });
}
for (const [name, before, after] of [
    ['drop-window', 'window.from < 0 || window.to < window.from || window.truncated', 'false'],
  ['drop-offline-summary', "&& line.includes('offline:true')", ''],
  ['drop-misc-summary', "&& line.includes('misc:false')", ''],
]) variants.push({ name, target: 'probe', before, after,
  test: 'portable leader evidence rejects', assertion: 'leader evidence rejects missing or unrelated reason' });
for (const [name, before, after, selected, assertion] of [
  ['forced-remaining-one', 'const remaining = NAMES.length - discarded.length;', 'const remaining = 1;', 'portable three-discard partition includes', 'three-discard partition accepts remaining zero'],
  ['drop-conservation', 'Number(summary[2]) === remaining && Number(summary[4]) === remaining', 'true', 'portable partition zero-without-self refuses', 'partition zero-without-self refuses'],
  ['one-discard-accepted', 'others.every(name =>', 'others.some(name =>', 'portable partition single-nonleader refuses', 'partition single-nonleader refuses'],
  ['foreign-name-accepted', '!discarded.every(name => NAMES.includes(name))', 'false', 'portable partition foreign-name refuses', 'partition foreign-name refuses'],
  ['duplicate-name-accepted', 'new Set(discarded).size !== discarded.length || ', '', 'portable partition duplicate-name refuses', 'partition duplicate-name refuses'],
  ['drop-summary-uniqueness', 'summaries.length !== 1', 'summaries.length === 0', 'portable partition two-summaries refuses', 'partition two-summaries refuses'],
  ['leader-only-accepted', 'others.every(name => discarded.includes(name))', 'discarded.includes(leader)', 'portable partition leader-only refuses', 'partition leader-only refuses'],
]) variants.push({ name, target: 'probe', before, after, test: selected, assertion });
for (const [name, before] of [
  ['drop-before-identity', 'before[0].server_id !== ready.js.server_id || '],
  ['drop-after-identity', ' || after[0].server_id !== ready.js.server_id'],
]) variants.push({ name, target: 'probe', before, after: '',
  test: 'portable counter snapshots reject', assertion: 'evidence faultApi rejects changed input' });
for (const [name, before, after] of [
  ['connected-member-only', 'const deltas = apiDeltas(row);', 'const deltas = apiDeltas(row)?.filter(delta => delta.name === row.connectedMember);'],
  ['first-row-only', 'deltas.reduce((n, delta) => n + delta.total, 0)', 'deltas[0].total'],
]) variants.push({ name, target: 'probe', before, after,
  test: 'portable api accounting follows', assertion: 'aggregate counters accept one responder request' });
for (const [i, variant] of variants.entries()) {
  const owned = path.join(root, String(i)); fs.mkdirSync(owned, { mode: 0o700 });
  const original = variant.target === 'probe' ? probe : helper;
  assert.equal(original.split(variant.before).length, 2, variant.name + ': unique mutation site');
  const changed = original.replace(variant.before, variant.after);
  fs.writeFileSync(path.join(owned, 'probe_placement_gossip.mjs'), variant.target === 'probe' ? changed : probe);
  fs.writeFileSync(path.join(owned, 'placement_readiness.mjs'), variant.target === 'helper' ? changed : helper);
  const result = run(variant.test, path.join(owned, 'probe_placement_gossip.mjs'));
  const output = result.stdout + result.stderr;
  assert.equal(result.status, 1, variant.name + ': must fail an assertion\n' + output);
  assert(output.includes("code: 'ERR_ASSERTION'") && (output.includes("error: '" + variant.assertion + "'") || output.includes("error: |-\n    " + variant.assertion + "\n")),
    variant.name + ': wrong failure\n' + output);
  assert(!output.includes('placement-gossip-report'), 'mutants must not start live cohorts');
  console.log(variant.name + ': intended assertion killed');
}
console.log(`placement-gossip mutants: ${variants.length}/${variants.length} intended assertions killed; controls intact`);
