import { describe, it, mock, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHealthWatch } from '../bin/health-watch.mjs';

const ROOT = new URL('..', import.meta.url).pathname;
const ok = { ok: true, detail: 'ok', latency_ms: 1 };
const noLocalModel = async () => ({
  daemon: ok, nats: ok, ollama: { ok: false, detail: 'fetch failed', latency_ms: 1 },
  embedder: ok, sqlite: ok, workspace_writable: ok,
});

describe('health-watch on a node installed without a local model', () => {
  afterEach(() => mock.timers.reset());

  async function fiveTicks(skipLlm) {
    const dir = mkdtempSync(join(tmpdir(), 'health-watch-skip-llm-'));
    const alerts = [];
    try {
      mock.timers.enable({ apis: ['Date'], now: 1_000_000 });
      const watcher = createHealthWatch({
        targets: ['nats', 'banner'],
        skipLlm,
        queueSnapshotPath: join(dir, 'absent.json'),
        healthCheckFn: noLocalModel,
        alerters: {
          nats: async (status) => { alerts.push(['nats', status]); },
          banner: async (status) => { alerts.push(['banner', status]); },
        },
      });
      for (let i = 0; i < 5; i++) {
        await watcher.tick();
        mock.timers.tick(300_000);
      }
      return alerts;
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  it('with OPENCLAW_SKIP_LLM set, the missing model raises no degraded alert', async () => {
    const alerts = await fiveTicks(true);
    assert.deepEqual(alerts.filter(([, status]) => status !== 'healthy'), []);
  });

  it('without the flag the degraded alert still repeats every 5 minutes', async () => {
    const alerts = await fiveTicks(false);
    assert.equal(alerts.filter(([target, status]) => target === 'banner' && status === 'degraded').length, 5);
    assert.equal(alerts.filter(([target, status]) => target === 'nats' && status === 'degraded').length, 5);
  });
});

describe('install persists --skip-llm for health-watch', () => {
  const cfg = readFileSync(join(ROOT, 'scripts/install/config.sh'), 'utf8');
  const start = cfg.indexOf('# --skip-llm/--sandbox install no local model');
  const end = cfg.indexOf('# Generate OPENCLAW_NATS_TOKEN');
  const block = cfg.slice(start, end);

  function run(skipLlm, initial) {
    const dir = mkdtempSync(join(tmpdir(), 'skip-llm-env-'));
    const envFile = join(dir, 'openclaw.env');
    writeFileSync(envFile, initial);
    try {
      const r = spawnSync('bash', ['-c', `set -euo pipefail
        source "${join(ROOT, 'scripts/install/helpers.sh')}"
        DRY_RUN=false; SKIP_LLM=${skipLlm}; ENV_FILE="${envFile}"
        ${block}
        printf '%s' "\${OPENCLAW_SKIP_LLM:-}"`], { encoding: 'utf8', env: { PATH: process.env.PATH } });
      assert.equal(r.status, 0, r.stderr);
      return { exported: r.stdout, file: readFileSync(envFile, 'utf8') };
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  it('the config.sh block exists', () => {
    assert.ok(start > 0 && end > start, 'skip-llm block must precede the NATS token block in config.sh');
  });

  it('--skip-llm writes OPENCLAW_SKIP_LLM=1 and exports it for the unit render', () => {
    assert.deepEqual(run(true, 'OTHER=1\n'), { exported: '1', file: 'OTHER=1\nOPENCLAW_SKIP_LLM=1\n' });
  });

  it('a run without the flag never writes it and keeps an earlier choice', () => {
    assert.deepEqual(run(false, 'OTHER=1\n'), { exported: '', file: 'OTHER=1\n' });
    assert.equal(run(false, 'OPENCLAW_SKIP_LLM=1\n').file, 'OPENCLAW_SKIP_LLM=1\n');
  });

  it('both health-watch units carry the flag and the installer renders it', () => {
    for (const unit of ['services/launchd/ai.openclaw.health-watch.plist', 'services/systemd/openclaw-health-watch.service']) {
      assert.match(readFileSync(join(ROOT, unit), 'utf8'), /OPENCLAW_SKIP_LLM.*\n?.*\$\{OPENCLAW_SKIP_LLM\}/, unit);
    }
    const names = readFileSync(join(ROOT, 'scripts/install/services.sh'), 'utf8').match(/^UNIT_NAMES='([^']*)'$/m)[1];
    assert.ok(names.split(' ').includes('OPENCLAW_SKIP_LLM'));
  });
});
