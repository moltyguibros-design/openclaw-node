import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, chmodSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'check-llm-baseline.mjs');

describe('check-llm-baseline CLI', () => {
  let dir;
  let preloadUrl;

  before(() => {
    dir = mkdtempSync(join(tmpdir(), 'llm-baseline-'));
    const preload = join(dir, 'fake-mem.mjs');
    writeFileSync(preload, "import os from 'node:os';\nos.totalmem = () => Number(process.env.FAKE_MEM_GB) * 1024 ** 3;\n");
    preloadUrl = pathToFileURL(preload).href;
    // Fake ollama whose pull writes 2 MiB of progress to stderr: more than execFile's 1 MiB default maxBuffer.
    const ollama = join(dir, 'ollama');
    writeFileSync(ollama, [
      '#!/bin/sh',
      'if [ "$1" = "--version" ]; then echo "ollama version is 0.0.0-test"; exit 0; fi',
      'if [ "$1" = "pull" ]; then head -c 2097152 /dev/zero | tr \'\\0\' x >&2; exit 0; fi',
      'exit 1',
      '',
    ].join('\n'));
    chmodSync(ollama, 0o755);
  });

  after(() => rmSync(dir, { recursive: true, force: true }));

  function run(memGb, args) {
    return spawnSync(process.execPath, ['--import', preloadUrl, SCRIPT, ...args], {
      env: { ...process.env, FAKE_MEM_GB: String(memGb), PATH: `${dir}:${process.env.PATH}` },
      encoding: 'utf8',
      maxBuffer: 16 * 1024 * 1024,
    });
  }

  it('--json exits 2 on a host below the floor', () => {
    const r = run(8, ['--json']);
    assert.equal(r.status, 2, r.stderr);
    assert.equal(JSON.parse(r.stdout).recommendation.tier, null);
  });

  it('--json exits 0 with a tier on a host at the floor', () => {
    const r = run(20, ['--json']);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(JSON.parse(r.stdout).recommendation.model, 'qwen3:8b');
  });

  it('human report exits 2 on a host below the floor', () => {
    assert.equal(run(8, []).status, 2);
  });

  it('--install survives a pull whose progress output exceeds 1 MiB', () => {
    const r = run(20, ['--install']);
    assert.equal(r.status, 0, r.stderr.slice(-500));
    assert.match(r.stdout, /qwen3:8b is installed and ready/);
  });
});
