#!/usr/bin/env node
/**
 * mesh-agent-foreman-retention.test.js — agent startup prunes Foreman timelines
 * older than MESH_FOREMAN_RETENTION_DAYS (default 30; 0 keeps them all), as it
 * ages out kept task branches; nothing else in the directory is touched. The
 * window comes from the environment, else ~/.openclaw/openclaw.env, since the
 * agent's service units do not pass it.
 *
 * Run: node --test test/mesh-agent-foreman-retention.test.js
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-foreman-retention-'));
const DIR = path.join(TMP, 'foreman');
Object.assign(process.env, {
  HOME: TMP,
  MESH_WORKSPACE: path.join(TMP, 'workspace'),
  OPENCLAW_NODE_ID: 'node-retention',
  OPENCLAW_OBS_DB: ':memory:',
  MESH_FOREMAN_DIR: DIR,
});
delete process.env.MESH_FOREMAN_RETENTION_DAYS;

const { describe, it, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const agent = require('../bin/mesh-agent.js');

after(() => fs.rmSync(TMP, { recursive: true, force: true }));

const DAY = 86400000;
function file(name, ageDays) {
  const p = path.join(DIR, name);
  fs.writeFileSync(p, '{}\n');
  const t = new Date(Date.now() - ageDays * DAY);
  fs.utimesSync(p, t, t);
  return p;
}

describe('Foreman timeline retention', () => {
  beforeEach(() => {
    fs.rmSync(DIR, { recursive: true, force: true });
    fs.mkdirSync(DIR, { recursive: true });
    delete process.env.MESH_FOREMAN_RETENTION_DAYS;
  });

  it('removes timelines past 30 days by default and keeps fresh ones and other files', async () => {
    const old = file('T-old.jsonl', 40);
    const fresh = file('T-fresh.jsonl', 2);
    const other = file('notes.txt', 40);
    await agent.__test.pruneForemanTimelines();
    assert.equal(fs.existsSync(old), false);
    assert.equal(fs.existsSync(fresh), true);
    assert.equal(fs.existsSync(other), true);
  });

  it('honours MESH_FOREMAN_RETENTION_DAYS, and 0 keeps everything', async () => {
    process.env.MESH_FOREMAN_RETENTION_DAYS = '5';
    const week = file('T-week.jsonl', 7);
    const day = file('T-day.jsonl', 1);
    await agent.__test.pruneForemanTimelines();
    assert.equal(fs.existsSync(week), false);
    assert.equal(fs.existsSync(day), true);

    process.env.MESH_FOREMAN_RETENTION_DAYS = '0';
    const ancient = file('T-ancient.jsonl', 400);
    await agent.__test.pruneForemanTimelines();
    assert.equal(fs.existsSync(ancient), true);
  });

  it('reads MESH_FOREMAN_RETENTION_DAYS from ~/.openclaw/openclaw.env, the environment still first', async () => {
    const envDir = path.join(TMP, '.openclaw');
    const envFile = path.join(envDir, 'openclaw.env');
    fs.mkdirSync(envDir, { recursive: true });
    try {
      fs.writeFileSync(envFile, 'MESH_FOREMAN_RETENTION_DAYS=0\n');
      const ancient = file('T-ancient.jsonl', 400);
      await agent.__test.pruneForemanTimelines();
      assert.equal(fs.existsSync(ancient), true, 'openclaw.env 0 keeps every timeline');

      fs.writeFileSync(envFile, 'MESH_FOREMAN_RETENTION_DAYS=5\n');
      const week = file('T-week.jsonl', 7);
      const day = file('T-day.jsonl', 1);
      await agent.__test.pruneForemanTimelines();
      assert.equal(fs.existsSync(week), false, 'openclaw.env 5 prunes a 7-day-old timeline');
      assert.equal(fs.existsSync(day), true);

      process.env.MESH_FOREMAN_RETENTION_DAYS = '0';
      const old = file('T-old.jsonl', 400);
      await agent.__test.pruneForemanTimelines();
      assert.equal(fs.existsSync(old), true, 'the environment wins over openclaw.env');
    } finally {
      fs.rmSync(envDir, { recursive: true, force: true });
    }
  });

  it('a set value that is not a number (a trailing comment included) skips the prune and warns', async () => {
    const envDir = path.join(TMP, '.openclaw');
    const envFile = path.join(envDir, 'openclaw.env');
    fs.mkdirSync(envDir, { recursive: true });
    const warnings = [];
    const retentionWarnings = () => warnings.filter((w) => /MESH_FOREMAN_RETENTION_DAYS/.test(w));
    const origWarn = console.warn;
    console.warn = (msg) => warnings.push(String(msg));
    try {
      fs.writeFileSync(envFile, 'MESH_FOREMAN_RETENTION_DAYS=0   # keep step 1.2 evidence\n');
      const ancient = file('T-ancient.jsonl', 400);
      await agent.__test.pruneForemanTimelines();
      assert.equal(fs.existsSync(ancient), true, 'a commented openclaw.env value deletes nothing');
      assert.equal(retentionWarnings().length, 1);
      assert.match(retentionWarnings()[0], /keep step 1\.2 evidence/);

      process.env.MESH_FOREMAN_RETENTION_DAYS = 'thirty';
      const old = file('T-old.jsonl', 400);
      await agent.__test.pruneForemanTimelines();
      assert.equal(fs.existsSync(old), true, 'an unparseable environment value deletes nothing');
      assert.equal(retentionWarnings().length, 2);
    } finally {
      console.warn = origWarn;
      fs.rmSync(envDir, { recursive: true, force: true });
    }
  });

  it('a missing directory is nothing to prune', async () => {
    fs.rmSync(DIR, { recursive: true, force: true });
    await agent.__test.pruneForemanTimelines();
    assert.equal(fs.existsSync(DIR), false);
  });

  it('runs at startup beside the kept-branch reconcile, and is documented', () => {
    const src = fs.readFileSync(path.join(__dirname, '../bin/mesh-agent.js'), 'utf8');
    assert.match(src, /await reconcileKeptBranches\(\);\n\s*await pruneForemanTimelines\(\)/);
    assert.match(fs.readFileSync(path.join(__dirname, '../docs/foreman.md'), 'utf8'), /\| `MESH_FOREMAN_RETENTION_DAYS` \| `30` \|/);
  });
});
