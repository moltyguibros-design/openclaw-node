import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const daemonSrc = fs.readFileSync(path.join(repo, 'workspace-bin/memory-daemon.mjs'), 'utf8');

test('the daemon does no session-store import on its main thread', () => {
  assert.doesNotMatch(daemonSrc, /store\.importDirectory\(|store\.importSession\(/);
  assert.doesNotMatch(daemonSrc, /new SessionStore\(/);
});

test('boot and Phase 2 run the directory import in the worker; session end archives through the worker', () => {
  const phase0 = daemonSrc.match(/async function runPhase0Bootstrap[\s\S]*?\n\}\n/)[0];
  assert.match(phase0, /runImportDirInWorker\(/);
  const phase2Import = daemonSrc.match(/throttle\.lastSessionImport = now;[\s\S]*?\n  \}\n/)[0];
  assert.match(phase2Import, /runImportDirInWorker\(/);
  const sessionEnd = daemonSrc.match(/\/\/ 0b\. Archive current session to SQLite[\s\S]*?\/\/ 0c\./)[0];
  assert.match(sessionEnd, /runImportInWorker\(/);
});

test('the separate live-import job is gone, so it cannot overlap the directory pass', () => {
  assert.doesNotMatch(daemonSrc, /lastLiveImport/);
  assert.match(daemonSrc, /function serializeImport\(/);
  assert.match(daemonSrc, /serializeImport\(\(\) => runMemoryWorker\(\{ kind: 'import'/);
  assert.match(daemonSrc, /serializeImport\(\(\) => runMemoryWorker\(\{ kind: 'importDir'/);
});

test('a transcript the directory pass could not import is logged and emitted as an ingest error', () => {
  const dirImport = daemonSrc.match(/async function runImportDirInWorker[\s\S]*?\n\}\n/)[0];
  assert.match(dirImport, /for \(const f of failed\) \{[\s\S]*?emitErrorEvent\('ingest'/);
});

test('the importDir worker imports changed transcripts and skips them on the next pass', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'import-dir-worker-'));
  try {
    const src = path.join(home, 'transcripts');
    fs.mkdirSync(src);
    for (const id of ['s1', 's2']) {
      fs.writeFileSync(path.join(src, `${id}.jsonl`), JSON.stringify({ type: 'user', message: { content: `hello ${id}` } }) + '\n');
    }
    const script = `
      import { Worker } from 'node:worker_threads';
      const w = new Worker(${JSON.stringify(path.join(repo, 'workspace-bin/flush-worker.mjs'))}, {
        execArgv: [],
        workerData: { kind: 'importDir', sources: [{ path: ${JSON.stringify(src)}, name: 'claude-code' }] },
      });
      w.once('message', (m) => { console.log(JSON.stringify(m)); });
    `;
    const run = () => {
      const r = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
        env: { ...process.env, HOME: home }, encoding: 'utf8', timeout: 60_000,
      });
      assert.equal(r.status, 0, r.stderr);
      return JSON.parse(r.stdout.trim().split('\n').pop());
    };

    const first = run();
    assert.equal(first.ok, true, first.error);
    assert.deepEqual(first.result.results.map(x => [x.sessionId, x.source, x.messageCount]).sort(),
      [['s1', 'claude-code', 1], ['s2', 'claude-code', 1]]);

    const second = run();
    assert.deepEqual(second.result.results, []);

    // A failing transcript is reported per file and the pass goes on.
    fs.mkdirSync(path.join(src, 's0-broken.jsonl'));
    fs.writeFileSync(path.join(src, 's3.jsonl'), JSON.stringify({ type: 'user', message: { content: 'hello s3' } }) + '\n');
    const third = run();
    assert.equal(third.ok, true, third.error);
    assert.deepEqual(third.result.results.map(x => x.sessionId), ['s3']);
    assert.deepEqual(third.result.failed.map(f => [path.basename(f.file), f.source]), [['s0-broken.jsonl', 'claude-code']]);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});
