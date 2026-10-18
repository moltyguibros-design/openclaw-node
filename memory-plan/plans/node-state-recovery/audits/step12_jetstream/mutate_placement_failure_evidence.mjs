import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(path.join(dir, 'placement_readiness.mjs'), 'utf8');
const suite = path.join(dir, 'test_placement_failure_evidence.mjs');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'owned-r3-evidence-mutants-'));
const run = (pattern, module = '') => spawnSync(process.execPath,
  ['--test', '--test-reporter=tap', '--test-name-pattern=' + pattern, suite],
  { encoding: 'utf8', timeout: 30000, env: { ...process.env, PLACEMENT_FAILURE_TEST_MODULE: module } });
const controls = run('portable ');
assert.equal(controls.status, 0, controls.stdout + controls.stderr);
assert(!controls.stdout.includes('owned-r3-placement-failure:'), 'controls cannot start a live cohort');
console.log('unmutated R3 failure-evidence controls: all passed');

const variants = [
  ['old-log-included', 'from: fs.statSync(file).size', 'from: 0',
    'portable failure records', 'phase-local window starts after preexisting log'],
  ['selector-dropped', 'return index < 0 ? [] : [line.slice(index)];', 'return [];',
    'portable failure records', 'selector lines retained from failed call'],
  ['failed-create-retried', 'return await manager.streams.add(config);',
    'await manager.streams.add(config).catch(() => {}); return await manager.streams.add(config);',
    'portable failure records', 'failed R3 request is never retried'],
  ['report-dropped', "fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\\n', { mode: 0o600, flag: 'wx' });",
    'void report;', 'portable failure records', 'failed R3 report must exist'],
  ['api-error-code-dropped', 'apiErrorCode: error.api_error?.err_code', 'apiErrorCode: undefined',
    'portable failure records', 'NATS error code retained'],
  ['message-serialized', 'peerOffline: error.message ===', 'message: error.message, peerOffline: error.message ===',
    'portable failure report does', 'private message bytes cannot enter the report'],
  ['message-emitted', "emit('owned-r3-placement-failure: ' + JSON.stringify(report));", 'emit(error.message);',
    'portable failure report does', 'private message bytes cannot enter the log'],
  ['readiness-forced', 'ready: state.ready, checks: state.checks', 'ready: true, checks: state.checks',
    'portable failed pre-create', 'pre-create readiness is not inferred from the failed API call'],
  ['window-limit-raised', 'length <= 131072', 'length <= 262144',
    'portable oversized', 'oversized selector window cannot claim complete evidence'],
  ['selector-line-limit-dropped', 'complete: complete && lines.every(line => line.length <= 1024)',
    'complete', 'portable oversized selector line', 'long selector line cannot claim complete evidence'],
  ['window-hash-dropped', "createHash('sha256').update(window).digest('hex')",
    "createHash('sha256').update(Buffer.alloc(0)).digest('hex')",
    'portable failure records', 'raw window digest binds the selected bytes'],
  ['original-error-replaced', 'throw error;\n  }\n}', "throw new Error('replacement');\n  }\n}",
    'portable evidence capture failure', 'original placement error identity survives capture'],
  ['success-report-written', 'return await manager.streams.add(config);',
    "const result = await manager.streams.add(config); fs.writeFileSync(output, '{}'); return result;",
    'portable success', 'success cannot create a failure report']
];

try {
  for (const [i, [name, before, after, pattern, assertion]] of variants.entries()) {
    assert.equal(source.split(before).length, 2, name + ': unique mutation site');
    const file = path.join(root, String(i) + '.mjs');
    fs.writeFileSync(file, source.replace(before, after), { mode: 0o600 });
    const result = run(pattern, file);
    const output = result.stdout + result.stderr;
    assert.equal(result.status, 1, name + ': must fail an assertion\n' + output);
    assert(output.includes("code: 'ERR_ASSERTION'") && output.includes(assertion),
      name + ': wrong failure\n' + output);
    assert(!output.includes('owned-r3-placement-failure:'), 'mutants cannot start a live cohort');
    console.log(name + ': intended assertion killed');
  }
  console.log(`R3 failure-evidence mutants: ${variants.length}/${variants.length} intended assertions killed; controls intact`);
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
