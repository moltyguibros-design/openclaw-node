#!/usr/bin/env node
/**
 * mesh-agent-foreman-retention.test.js — agent startup prunes Foreman timelines
 * older than MESH_FOREMAN_RETENTION_DAYS (default 30; 0 keeps them all), as it
 * ages out kept task branches; nothing else in the directory is touched.
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
