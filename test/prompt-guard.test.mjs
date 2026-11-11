/**
 * prompt-guard.test.mjs — REMEDIATION_PLAN P5-8.
 *
 * The SKILL.md config example switched HiveFence reporting on while the
 * skill claims it is off by default, and audit.py inspected ~/.clawdbot, so
 * on an OpenClaw node it found nothing and passed vacuously.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SKILL_DIR = join(ROOT, 'skills', 'prompt-guard');
const HAVE_PY = spawnSync('python3', ['--version'], { encoding: 'utf8' }).status === 0;

describe('prompt-guard', () => {
  it('documented config keeps HiveFence reporting off', () => {
    const md = readFileSync(join(SKILL_DIR, 'SKILL.md'), 'utf8');
    const start = md.indexOf('  hivefence:');
    assert.ok(start >= 0, 'hivefence block not found');
    const block = md.slice(start, md.indexOf('```', start));
    assert.doesNotMatch(block, /enabled:\s*true/);
    assert.doesNotMatch(block, /auto_report:\s*true/);
  });

  it('audit.py inspects ~/.openclaw', { skip: !HAVE_PY && 'python3 not available' }, () => {
    const home = mkdtempSync(join(tmpdir(), 'pg-audit-'));
    const dir = join(home, '.openclaw');
    mkdirSync(dir, { mode: 0o700 });
    chmodSync(dir, 0o700);
    const cfg = join(dir, 'openclaw.json');
    writeFileSync(cfg, JSON.stringify({ gateway: { bind: '0.0.0.0', auth: { mode: 'token' } } }));
    chmodSync(cfg, 0o600);
    const env = join(dir, 'openclaw.env');
    writeFileSync(env, 'OPENCLAW_NODE_ID=test\n');
    chmodSync(env, 0o644);
    const r = spawnSync('python3', [join(SKILL_DIR, 'scripts', 'audit.py'), '--json', '--quick'], {
      encoding: 'utf8',
      env: { ...process.env, HOME: home },
    });
    const out = JSON.parse(r.stdout);
    const failed = out.issues.map((i) => i.check);
    assert.ok(failed.includes('Gateway bind'), JSON.stringify(out));
    assert.ok(failed.includes('Secrets file permissions'), JSON.stringify(out));
    assert.ok(out.passed.some((p) => p.startsWith('OpenClaw directory permissions')), JSON.stringify(out));
  });
});
