/**
 * worker-queue-stuck.test.mjs — health-watch's stuck-Ollama recovery reads the
 * daemon's queue snapshot, but flush/import extraction runs in flush-worker
 * threads with their own ollama-queue singleton. Their extraction timeouts
 * never reached the snapshot, so ">= 3 consecutive extraction timeouts" could
 * not fire, and the report said "queue idle" while a worker was extracting.
 */
import { describe, it, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { Worker } from 'node:worker_threads';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  foldWorkerQueueState,
  getState,
  exportStateSnapshot,
  readStateSnapshot,
  snapshotLooksStuck,
  markExternalJob,
  clearExternalJob,
  _resetForTesting,
} from '../lib/ollama-queue.mjs';
import { formatQueueSection, maybeAutoRestartOllama } from '../bin/health-watch.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const tmp = mkdtempSync(join(tmpdir(), 'worker-queue-'));
beforeEach(() => _resetForTesting());
after(() => { _resetForTesting(); rmSync(tmp, { recursive: true, force: true }); });

const timedOutWorker = { extraction_timeouts: 1, extraction_successes: 0, timeouts: 1 };

describe('worker extraction timeouts reach the daemon snapshot', () => {
  it('three workers that each timed out make the exported snapshot stuck', () => {
    for (let i = 0; i < 3; i++) foldWorkerQueueState(timedOutWorker);
    const file = join(tmp, 'state.json');
    exportStateSnapshot(file);
    const snap = readStateSnapshot(file);
    assert.equal(snap.consecutive_timeouts.extraction, 3);
    assert.equal(snap.totals.timeouts, 3);
    assert.equal(snapshotLooksStuck(snap), true);
  });

  it('a worker with any successful extraction ends the streak', () => {
    foldWorkerQueueState(timedOutWorker);
    foldWorkerQueueState(timedOutWorker);
    foldWorkerQueueState({ extraction_timeouts: 0, extraction_successes: 4, timeouts: 0 });
    assert.equal(getState().consecutive_timeouts.extraction, 0);
    foldWorkerQueueState({ extraction_timeouts: 2, extraction_successes: 1, timeouts: 2 });
    assert.equal(getState().consecutive_timeouts.extraction, 2);
    foldWorkerQueueState(undefined);
    assert.equal(getState().consecutive_timeouts.extraction, 2);
  });

  it('flush-worker attaches its queue counters to the message it posts', async () => {
    const home = mkdtempSync(join(tmp, 'home-'));
    const w = new Worker(join(ROOT, 'workspace-bin', 'flush-worker.mjs'), {
      workerData: { kind: 'flush', jsonlPath: join(home, 'missing.jsonl'), memoryMdPath: join(home, 'MEMORY.md'), checkShouldFlush: true },
      env: { ...process.env, HOME: home },
    });
    const [m] = await Promise.race([
      new Promise((resolve) => w.once('message', (msg) => resolve([msg]))),
      new Promise((_, reject) => setTimeout(() => reject(new Error('worker posted nothing')), 20_000)),
    ]);
    await w.terminate();
    assert.deepEqual(m.queue, { extraction_timeouts: 0, extraction_successes: 0, timeouts: 0 });
  });

  it('the daemon folds every worker message into its queue state', () => {
    const src = readFileSync(join(ROOT, 'workspace-bin', 'memory-daemon.mjs'), 'utf8');
    const fn = src.slice(src.indexOf('function runMemoryWorker'), src.indexOf('function runFlushInWorker'));
    assert.match(fn, /w\.once\('message', \(m\) => \{\s*if \(!settled\) foldWorkerQueueState\(m\.queue\);/);
  });
});

describe('health-watch report and recovery over worker state', () => {
  it('lists a running worker job instead of claiming the queue is idle', () => {
    markExternalJob('flush-1', { type: 'flush', detail: 'abc.jsonl' });
    const section = formatQueueSection(getState(), []);
    clearExternalJob('flush-1');
    assert.match(section, /In flight \(worker\):\*\* flush abc\.jsonl/);
    assert.doesNotMatch(section, /queue idle/);
    assert.match(formatQueueSection(getState(), []), /none \(queue idle\)/);
  });

  it('unloads once per new timeout evidence, not on every tick of a still-stuck snapshot', async () => {
    const previousUrl = process.env.LLM_BASE_URL;
    const previousFetch = globalThis.fetch;
    let requests = 0;
    try {
      process.env.LLM_BASE_URL = 'http://127.0.0.1:11434';
      globalThis.fetch = async () => { requests++; return { ok: true }; };
      for (let i = 0; i < 3; i++) foldWorkerQueueState(timedOutWorker);
      const file = join(tmp, 'stuck.json');
      exportStateSnapshot(file);
      assert.equal(await maybeAutoRestartOllama(file), true);
      assert.equal(await maybeAutoRestartOllama(file), false);
      assert.equal(requests, 1);
      assert.match(formatQueueSection(readStateSnapshot(file)), /Last auto-unload:\*\* stuck extraction at .* \(\d+ in last 15min\)/);
      foldWorkerQueueState(timedOutWorker);
      exportStateSnapshot(file);
      assert.equal(await maybeAutoRestartOllama(file), true);
      assert.equal(requests, 2);
    } finally {
      if (previousUrl === undefined) delete process.env.LLM_BASE_URL;
      else process.env.LLM_BASE_URL = previousUrl;
      globalThis.fetch = previousFetch;
    }
  });
});
