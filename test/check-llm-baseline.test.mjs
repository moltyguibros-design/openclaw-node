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

// Linux MemTotal sits under the installed size (a 16 GB box reports ~15.7 GB) while macOS
// reports the full amount, so each tier allows 1 GB under its size.
describe('recommend', () => {
  it('puts a Linux box in the same tier as a Mac with the same installed RAM', async () => {
    const { recommend } = await import(pathToFileURL(SCRIPT).href);
    for (const [gb, model] of [[15.7, 'qwen3:8b'], [16, 'qwen3:8b'], [31.3, 'qwen3:14b'], [32, 'qwen3:14b'], [47.2, 'qwen3:32b'], [64, 'qwen3:32b']]) {
      assert.equal(recommend(gb).tier?.model, model, `${gb} GB`);
    }
    for (const gb of [14.5, 8]) assert.equal(recommend(gb).tier, null, `${gb} GB`);
  });

  it('the CLI recommends the floor tier for a 15.7 GB Linux MemTotal', () => {
    const preload = join(mkdtempSync(join(tmpdir(), 'llm-baseline-')), 'fake-mem.mjs');
    writeFileSync(preload, "import os from 'node:os';\nos.totalmem = () => 15.7 * 1024 ** 3;\n");
    const r = spawnSync(process.execPath, ['--import', pathToFileURL(preload).href, SCRIPT, '--json'], { encoding: 'utf8' });
    rmSync(dirname(preload), { recursive: true, force: true });
    assert.equal(r.status, 0, r.stderr);
    assert.equal(JSON.parse(r.stdout).recommendation.model, 'qwen3:8b');
  });
});

// Wave 2 takes its recommendation from the CLI, and an --update never moves an existing
// node's LLM_MODEL to a bigger tier (a ~9 GB pull nobody asked for).
describe('installer tier callers', () => {
  const ROOT = join(dirname(SCRIPT), '..');
  it('llm-setup.sh has no tier table of its own', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(join(ROOT, 'scripts/install/llm-setup.sh'), 'utf8');
    assert.match(src, /bin\/check-llm-baseline\.mjs" --json/);
    assert.doesNotMatch(src, /RAM_GB" -ge/);
    assert.doesNotMatch(src, /MemTotal|hw\.memsize/);
  });

  it('llm-setup.sh --check prints the CLI recommendation for a 15.7 GB host', () => {
    const dir = mkdtempSync(join(tmpdir(), 'llm-setup-'));
    try {
      const preload = join(dir, 'fake-mem.mjs');
      writeFileSync(preload, "import os from 'node:os';\nos.totalmem = () => 15.7 * 1024 ** 3;\n");
      for (const [name, body] of [['ollama', 'exit 0'], ['curl', 'exit 7']]) {
        writeFileSync(join(dir, name), `#!/bin/sh\n${body}\n`);
        chmodSync(join(dir, name), 0o755);
      }
      writeFileSync(join(dir, 'node'), `#!/bin/sh\nexec "${process.execPath}" --import "${pathToFileURL(preload).href}" "$@"\n`);
      chmodSync(join(dir, 'node'), 0o755);
      const r = spawnSync('bash', [join(ROOT, 'scripts/install/llm-setup.sh'), '--check'], {
        encoding: 'utf8',
        env: { HOME: dir, PATH: `${dir}:/usr/bin:/bin`, NODE_BIN: join(dir, 'node'), OPENCLAW_ROOT: join(dir, '.openclaw'), OPENCLAW_LLM_HOST: '0' },
      });
      assert.equal(r.status, 0, r.stdout + r.stderr);
      assert.match(r.stdout, /Detected RAM\s+: 15\.7 GB/);
      assert.match(r.stdout, /Recommended\s+: qwen3:8b\s+\(~5 GB download\)/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('components.sh upgrades LLM_MODEL by RAM tier on a full install, never on --update', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(join(ROOT, 'scripts/install/components.sh'), 'utf8');
    const start = src.indexOf('    TIER_MODEL=');
    const end = src.indexOf('\n    fi\n', src.indexOf('RAM-tier upgrade')) + '\n    fi\n'.length;
    const block = src.slice(start, end);
    const dir = mkdtempSync(join(tmpdir(), 'llm-tier-'));
    try {
      const preload = join(dir, 'fake-mem.mjs');
      writeFileSync(preload, "import os from 'node:os';\nos.totalmem = () => 31.3 * 1024 ** 3;\n");
      writeFileSync(join(dir, 'node'), `#!/bin/sh\nexec "${process.execPath}" --import "${pathToFileURL(preload).href}" "$@"\n`);
      chmodSync(join(dir, 'node'), 0o755);
      for (const [update, want] of [['true', 'qwen3:8b'], ['false', 'qwen3:14b']]) {
        const envFile = join(dir, 'openclaw.env');
        writeFileSync(envFile, 'LLM_MODEL=qwen3:8b\n');
        const r = spawnSync('bash', ['-ec', `run() { "$@"; }; info() { echo "$*"; }\n${block}`], {
          encoding: 'utf8',
          env: { PATH: process.env.PATH, NODE_BIN: join(dir, 'node'), REPO_DIR: ROOT, ENV_FILE: envFile, LLM_MODEL: 'qwen3:8b', UPDATE_ONLY: update },
        });
        assert.equal(r.status, 0, r.stderr);
        assert.equal(readFileSync(envFile, 'utf8'), `LLM_MODEL=${want}\n`, `UPDATE_ONLY=${update}`);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// The header said exit 2 meant "<8 GB RAM after reservations"; recommend()
// compares total RAM with FLOOR_GB, so a 14 GB host exits 2 too.
describe('check-llm-baseline header', () => {
  it('documents the exit-2 floor the code enforces', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(SCRIPT, 'utf8');
    const floor = src.match(/^const FLOOR_GB = (\d+);/m)[1];
    assert.match(src, new RegExp(`^ \\*   2 — system below floor \\(<${floor} GB total RAM\\)`, 'm'));
  });

  it('names in its tier policy only the model tags it pulls', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(SCRIPT, 'utf8');
    const pulled = new Set([...src.matchAll(/model: '([^']+)'/g)].map((m) => m[1]));
    const documented = [...src.matchAll(/^ \*   ≥\d+ GB RAM\s+→ (\S+)/gm)].map((m) => m[1]);
    assert.equal(documented.length, 3);
    for (const tag of documented) assert.ok(pulled.has(tag), `header names ${tag}, TIERS pulls ${[...pulled].join(', ')}`);
  });
});
