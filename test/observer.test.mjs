import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { readFile } from 'node:fs/promises';
import Database from 'better-sqlite3';
import {
  sampleLayers, appendSample, scanMemoryActivity, extractActivity,
  readTimeline, readActivity, GAP_THRESHOLD_MS, WORKING_WINDOW_MS, CORE_SERVICES,
  coreServiceRoster, coreServices, readLastExtraction,
} from '../lib/observer.mjs';
import { cliSummaryLines, stampLine } from '../bin/consolidation-scheduler.mjs';

let tmp;
beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'observer-test-')); });
afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

describe('sampleLayers', () => {
  it('captures all five layers; interaction ACTIVE + fresh => active, stale extraction => not working', () => {
    const now = Date.parse('2026-07-04T12:00:00Z');
    const dsPath = path.join(tmp, 'daemon-state.json');
    fs.writeFileSync(dsPath, JSON.stringify({ state: 'ACTIVE', sessionId: 'abcd1234-x', pid: process.pid, lastActivityTime: now - 30_000 }));

    const s = sampleLayers({
      now, boot: 111, daemonStatePath: dsPath,
      roster: { up: CORE_SERVICES.slice(0, -1), down: CORE_SERVICES.slice(-1) },
      lastExtraction: new Date(now - WORKING_WINDOW_MS - 3600_000).toISOString(), // stale
    });
    assert.equal(s.vm_boot, 111);
    assert.equal(s.node.core_up, CORE_SERVICES.length - 1);
    assert.equal(s.node.core_total, CORE_SERVICES.length);
    assert.equal(s.interaction.active, true, 'ACTIVE + 30s idle => active');
    assert.equal(s.interaction.session, 'abcd1234');
    assert.equal(s.memory.daemon, true, 'own pid is alive');
    assert.equal(s.memory.working, false, 'stale extraction => not forming memories (the frozen-brain state)');
  });

  it('interaction is NOT active when ENDED or idle past the window', () => {
    const now = Date.parse('2026-07-04T12:00:00Z');
    const dsPath = path.join(tmp, 'ds.json');
    fs.writeFileSync(dsPath, JSON.stringify({ state: 'ACTIVE', pid: process.pid, lastActivityTime: now - 60 * 60_000 })); // 1h idle
    const s = sampleLayers({ now, boot: 1, daemonStatePath: dsPath, roster: { up: [], down: CORE_SERVICES }, lastExtraction: null });
    assert.equal(s.interaction.active, false, 'idle past the window => not active even if state says ACTIVE');
    assert.equal(s.memory.working, false);

    fs.writeFileSync(dsPath, JSON.stringify({ state: 'ENDED', pid: process.pid, lastActivityTime: now - 60_000 }));
    const ended = sampleLayers({ now, boot: 1, daemonStatePath: dsPath, roster: { up: [], down: CORE_SERVICES }, lastExtraction: null });
    assert.equal(ended.interaction.active, false, 'ENDED => not active even with fresh activity');
  });
});

describe('readLastExtraction', () => {
  // Stands in for the sqlite3 CLI: prints the scalar, or exits non-zero on an SQL error.
  const sqliteCli = (cmd, [flag, dbPath, sql]) => {
    assert.equal(cmd, 'sqlite3');
    assert.equal(flag, '-readonly');
    const db = new Database(dbPath, { readonly: true });
    try { return `${db.prepare(sql).pluck().get() ?? ''}\n`; } finally { db.close(); }
  };

  it('reads the last extraction run, not the first sighting of a re-seen mention', () => {
    const dbPath = path.join(tmp, 'state.db');
    const db = new Database(dbPath);
    db.exec(`CREATE TABLE mentions (entity_id INTEGER, session_id TEXT, created_at TEXT NOT NULL);
      CREATE TABLE extraction_state (session_id TEXT PRIMARY KEY, content_hash TEXT NOT NULL, message_count INTEGER, extracted_at TEXT NOT NULL);
      INSERT INTO mentions VALUES (1, 's1', '2026-07-04T00:00:00.000Z');
      INSERT INTO extraction_state VALUES ('s1', 'h', 40, '2026-07-04T09:00:00.000Z');`);
    db.close();
    assert.equal(readLastExtraction(dbPath, sqliteCli), '2026-07-04T09:00:00.000Z');
  });

  it('falls back to mentions when the store has no extraction_state table', () => {
    const dbPath = path.join(tmp, 'old.db');
    const db = new Database(dbPath);
    db.exec(`CREATE TABLE mentions (entity_id INTEGER, session_id TEXT, created_at TEXT NOT NULL);
      INSERT INTO mentions VALUES (1, 's1', '2026-07-04T00:00:00.000Z');`);
    db.close();
    assert.equal(readLastExtraction(dbPath, sqliteCli), '2026-07-04T00:00:00.000Z');
  });
});

describe('coreServiceRoster — Linux', () => {
  const units = ['openclaw-nats', 'openclaw-memory-daemon', 'openclaw-mission-control', 'openclaw-node-watch',
    'openclaw-health-watch', 'openclaw-nats-1', 'openclaw-nats-2', 'openclaw-nats-3'];
  const systemctl = (states) => (cmd, args) => {
    assert.equal(cmd, 'systemctl');
    assert.deepEqual(args, ['--user', 'is-active', ...units]);
    const out = units.map((u) => states[u] ?? 'inactive').join('\n') + '\n';
    if (units.some((u) => states[u] !== 'active')) throw Object.assign(new Error('exit 3'), { stdout: out });
    return out;
  };

  it('counts the autostarted units only, so a healthy node reads fully up', () => {
    const r = coreServiceRoster({ platform: 'linux', execFile: systemctl({
      'openclaw-nats': 'active', 'openclaw-memory-daemon': 'active',
      'openclaw-mission-control': 'active', 'openclaw-node-watch': 'active', 'openclaw-health-watch': 'active',
    }) });
    assert.deepEqual(r, { up: coreServices('linux'), down: [] });
    assert.equal(coreServices('linux').length, 5);
    assert.ok(coreServices('linux').includes('openclaw-health-watch'));
    assert.ok(!coreServices('linux').some((s) => /gateway/.test(s)));
  });

  it('credits the nats slot to the single-host R=3 cluster only when all three nodes run', () => {
    const base = { 'openclaw-memory-daemon': 'active', 'openclaw-mission-control': 'active', 'openclaw-node-watch': 'active',
      'openclaw-health-watch': 'active' };
    const all = coreServiceRoster({ platform: 'linux', execFile: systemctl({ ...base,
      'openclaw-nats-1': 'active', 'openclaw-nats-2': 'active', 'openclaw-nats-3': 'active' }) });
    assert.deepEqual(all.down, []);
    const two = coreServiceRoster({ platform: 'linux', execFile: systemctl({ ...base,
      'openclaw-nats-1': 'active', 'openclaw-nats-2': 'active' }) });
    assert.deepEqual(two.down, ['openclaw-nats']);
  });

  it('no user manager => unknown, recorded in the sample and left out of node uptime', () => {
    const r = coreServiceRoster({ platform: 'linux', execFile: () => { throw Object.assign(new Error('bus'), { stdout: '' }); } });
    assert.equal(r.unknown, true);
    const t0 = Date.parse('2026-07-04T00:00:00Z');
    const samples = [0, 1, 2, 3].map((i) => {
      const s = sampleLayers({ now: t0 + i * 60_000, boot: 1, daemonStatePath: path.join(tmp, 'none.json'),
        daemonUp: true, lastExtraction: null, platform: 'linux',
        roster: i < 2 ? { up: coreServices('linux'), down: [] } : r });
      return JSON.stringify({ event: 'sample', ...s });
    });
    assert.equal(JSON.parse(samples[3]).node.unknown, true);
    const t = readTimeline(samples.join('\n'), { now: t0 + 3 * 60_000 + 1000 });
    assert.equal(t.layers.node.uptimePct, 100, 'unknown intervals are not downtime');
    assert.equal(t.layers.node.current, '?');
  });
});

describe('coreServiceRoster — macOS', () => {
  const launchctl = (labels) => (cmd, args) => {
    assert.equal(cmd, 'launchctl');
    assert.deepEqual(args, ['list']);
    return ['PID\tStatus\tLabel', ...labels.map((l) => `123\t0\t${l}`)].join('\n') + '\n';
  };
  const rest = coreServices('darwin').filter((s) => s !== 'ai.openclaw.nats');

  it('credits the nats slot to the nats-1..3 cohort only when all three run', () => {
    const all = coreServiceRoster({ platform: 'darwin', execFile: launchctl([...rest,
      'ai.openclaw.nats-1', 'ai.openclaw.nats-2', 'ai.openclaw.nats-3']) });
    assert.deepEqual(all, { up: coreServices('darwin'), down: [] });
    const two = coreServiceRoster({ platform: 'darwin', execFile: launchctl([...rest,
      'ai.openclaw.nats-1', 'ai.openclaw.nats-2']) });
    assert.deepEqual(two.down, ['ai.openclaw.nats']);
  });
});

describe('appendSample — VM off / reboot inscription', () => {
  it('inscribes a reboot gap when samples straddle a boot change past the threshold', async () => {
    const ledgerPath = path.join(tmp, 'observer.jsonl');
    const t0 = Date.parse('2026-07-04T00:00:00Z');
    await appendSample(mk(t0, 100), { ledgerPath });
    const r = await appendSample(mk(t0 + 30 * 60_000, 200), { ledgerPath }); // +30min, new boot
    assert.equal(r.gapInscribed, true);
    const recs = (await readFile(ledgerPath, 'utf8')).trim().split('\n').map(JSON.parse);
    const gap = recs.find((x) => x.event === 'gap');
    assert.equal(gap.reason, 'reboot');
    assert.equal(gap.minutes, 30);
  });

  it('no gap for the normal 60s cadence', async () => {
    const ledgerPath = path.join(tmp, 'l.jsonl');
    const t0 = Date.parse('2026-07-04T00:00:00Z');
    await appendSample(mk(t0, 1), { ledgerPath });
    const r = await appendSample(mk(t0 + 60_000, 1), { ledgerPath });
    assert.equal(r.gapInscribed, false);
  });
});

describe('extractActivity — daemon log → structured events', () => {
  it('structures synthesis mode, knowledge-index, graph-cache, and failure lines', () => {
    const log = [
      '[2026-07-04, 12:48:18]   Phase 2: interval synthesis [regex]: 19 facts found',
      '[2026-06-16, 22:17:06]   Phase 2: interval synthesis [llm]: 26 facts found, 26 added',
      '[2026-07-04, 12:50:45]   Phase 2: knowledge-index: 1 sessions indexed (216 chunks)',
      '[2026-07-04, 12:36:11]   Phase 2: graph-cache refreshed: 152 nodes, 1072 edges',
      '[2026-07-03, 16:45:53] [watcher] ALERT: extraction_failure_rate — 3/3 extractions failed (100%)',
      'a line with no timestamp — ignored',
    ].join('\n');
    const ev = extractActivity(log);
    const synth = ev.find((e) => e.kind === 'synthesis' && e.mode === 'llm');
    assert.ok(synth, 'llm synthesis captured');
    assert.equal(synth.facts, 26);
    assert.equal(ev.find((e) => e.kind === 'knowledge-index').chunks, 216);
    assert.equal(ev.find((e) => e.kind === 'graph-cache').edges, 1072);
    assert.ok(ev.find((e) => e.kind === 'extraction-failure'));
    assert.equal(ev.length, 5, 'the timestamp-less line is skipped');
  });
});

describe('scanMemoryActivity — incremental, offset-tracked', () => {
  it('appends only NEW events on a second scan (offset advances)', async () => {
    const logPath = path.join(tmp, 'daemon.log');
    const activityPath = path.join(tmp, 'activity.jsonl');
    const logPosPath = path.join(tmp, 'pos.json');
    fs.writeFileSync(logPath, '[2026-07-04, 12:00:00]   Phase 2: interval synthesis [regex]: 5 facts found\n');
    const a1 = await scanMemoryActivity({ daemonLogPath: logPath, activityPath, logPosPath });
    assert.equal(a1.appended, 1);
    // second scan, nothing new
    const a2 = await scanMemoryActivity({ daemonLogPath: logPath, activityPath, logPosPath });
    assert.equal(a2.appended, 0, 'no re-append without new log lines');
    // append a new line
    fs.appendFileSync(logPath, '[2026-07-04, 12:01:00]   Phase 2: knowledge-index: 2 sessions indexed (10 chunks)\n');
    const a3 = await scanMemoryActivity({ daemonLogPath: logPath, activityPath, logPosPath });
    assert.equal(a3.appended, 1, 'only the new line');
    const feed = readActivity(await readFile(activityPath, 'utf8'));
    assert.equal(feed.count, 2);
  });

  it('keeps the byte offset aligned when the log holds multi-byte characters', async () => {
    const logPath = path.join(tmp, 'daemon-utf8.log');
    const activityPath = path.join(tmp, 'activity-utf8.jsonl');
    const logPosPath = path.join(tmp, 'pos-utf8.json');
    // '→' and '—' are 3 bytes each: a char-indexed slice by the byte offset overshoots.
    const noise = '[2026-07-04, 11:59:00]   State: ACTIVE → IDLE — idle 300s\n'.repeat(40);
    fs.writeFileSync(logPath, noise + '[2026-07-04, 12:00:00]   Phase 2: interval synthesis [regex]: 5 facts found\n');
    assert.equal((await scanMemoryActivity({ daemonLogPath: logPath, activityPath, logPosPath })).appended, 1);
    fs.appendFileSync(logPath, '[2026-07-04, 12:01:00]   Phase 2: knowledge-index: 2 sessions indexed (10 chunks)\n');
    assert.equal((await scanMemoryActivity({ daemonLogPath: logPath, activityPath, logPosPath })).appended, 1,
      'the line appended after multi-byte text is seen');
  });

  it('leaves a partially written last line for the next scan', async () => {
    const logPath = path.join(tmp, 'daemon-partial.log');
    const activityPath = path.join(tmp, 'activity-partial.jsonl');
    const logPosPath = path.join(tmp, 'pos-partial.json');
    fs.writeFileSync(logPath, '[2026-07-04, 12:00:00]   Phase 2: interval synth');
    assert.equal((await scanMemoryActivity({ daemonLogPath: logPath, activityPath, logPosPath })).appended, 0);
    fs.appendFileSync(logPath, 'esis [regex]: 5 facts found\n');
    assert.equal((await scanMemoryActivity({ daemonLogPath: logPath, activityPath, logPosPath })).appended, 1);
  });
});

describe('consolidation activity', () => {
  const cycle = {
    ok: true, durationMs: 1234,
    result: {
      decayed: { decayedEntities: 7, decayedDecisions: 3, archivedEntities: 1 },
      pruned: { archivedDecisions: 0, prunedThemes: 0 },
      reinforced: { reinforcedEntities: 2 },
      clusters: { clusters: [] },
      contradictions: { total: 0 },
      promotionCandidates: { entityCandidates: [1, 2], decisionCandidates: [] },
    },
  };

  it('records decay + promotion from the standalone timer log beside the daemon log', async () => {
    const logPath = path.join(tmp, 'memory-daemon.log');
    const activityPath = path.join(tmp, 'activity.jsonl');
    const logPosPath = path.join(tmp, 'pos.json');
    fs.writeFileSync(logPath, '');
    const at = new Date('2026-07-04T16:00:00Z');
    const consolidationLog = cliSummaryLines(cycle).map((l) => stampLine(l, at, 'America/Montreal')).join('\n') + '\n';
    fs.writeFileSync(path.join(tmp, 'consolidation-scheduler.log'), 'Skipped: busy\n' + consolidationLog);

    const a1 = await scanMemoryActivity({ daemonLogPath: logPath, activityPath, logPosPath });
    const decay = a1.events.find((e) => e.kind === 'consolidation-decay');
    assert.deepEqual({ entities: decay.entities, decisions: decay.decisions }, { entities: 7, decisions: 3 });
    assert.equal(decay.ts, '2026-07-04T12:00:00', 'Montreal local, like the daemon log');
    assert.equal(a1.events.find((e) => e.kind === 'promotion').entities, 2);
    assert.equal(a1.appended, 2);
    assert.equal((await scanMemoryActivity({ daemonLogPath: logPath, activityPath, logPosPath })).appended, 0,
      'the consolidation log keeps its own offset');
  });

  it("consolidation timer stamps in the node's configured zone", () => {
    const saved = process.env.OPENCLAW_TIMEZONE;
    process.env.OPENCLAW_TIMEZONE = 'Europe/Paris';
    try {
      assert.equal(stampLine('x', new Date('2026-07-04T16:00:00Z')), '[2026-07-04, 18:00:00] x');
    } finally {
      if (saved === undefined) delete process.env.OPENCLAW_TIMEZONE;
      else process.env.OPENCLAW_TIMEZONE = saved;
    }
  });

  it("matches the in-process scheduler's cycle-complete line in the daemon log", () => {
    const ev = extractActivity('[2026-07-04, 12:00:00] [consolidation-scheduler] cycle complete (812ms): decayed 4 entities + 2 decisions, archived 0 entities');
    assert.equal(ev.length, 1);
    assert.deepEqual(ev[0], { ts: '2026-07-04T12:00:00', kind: 'consolidation-decay', entities: 4, decisions: 2 });
  });
});

describe('appendSample — ledger tail', () => {
  it('finds the last sample behind trailing gap records in a ledger larger than the tail window', async () => {
    const ledgerPath = path.join(tmp, 'big.jsonl');
    const t0 = Date.parse('2026-07-04T00:00:00Z');
    const filler = JSON.stringify({ event: 'sample', ...mk(t0 - 86_400_000, 1) }) + '\n';
    fs.writeFileSync(ledgerPath, filler.repeat(Math.ceil(200_000 / filler.length))
      + JSON.stringify({ event: 'sample', ...mk(t0, 1) }) + '\n'
      + JSON.stringify({ event: 'gap', ts: new Date(t0).toISOString(), minutes: 1 }) + '\n');
    const r = await appendSample(mk(t0 + 60_000, 1), { ledgerPath });
    assert.equal(r.gapInscribed, false, 'compared against the newest sample, not the day-old filler');
  });
});

describe('readTimeline — per-layer uptime', () => {
  it('computes independent uptime per layer and flags the memory-idle condition', () => {
    const t0 = Date.parse('2026-07-04T00:00:00Z');
    const lines = [];
    // 4 samples at 60s: vm always up, node up, interaction active for 2 then idle,
    // memory daemon up throughout but working only for the first 2
    for (let i = 0; i < 4; i++) {
      lines.push(JSON.stringify({
        event: 'sample', ts: new Date(t0 + i * 60_000).toISOString(), vm_boot: 1,
        node: { core_up: CORE_SERVICES.length, core_total: CORE_SERVICES.length, down: [] },
        interaction: { state: i < 2 ? 'ACTIVE' : 'ENDED', session: 's', idle_s: 5, active: i < 2 },
        memory: { daemon: true, extraction_age_h: i < 2 ? 1 : 999, working: i < 2 },
      }));
    }
    const t = readTimeline(lines.join('\n'), { now: t0 + 3 * 60_000 + 1000 });
    assert.equal(t.layers.vm.uptimePct, 100);
    assert.equal(t.layers.node.uptimePct, 100);
    assert.ok(t.layers.interaction.uptimePct > 0 && t.layers.interaction.uptimePct < 100);
    assert.equal(t.layers.memory.uptimePct, 100, 'daemon up the whole time');
    assert.ok(t.layers.memory.workingPct < 100, 'but forming memories only part of the time');
    assert.equal(t.layers.memory.current, 'IDLE (not extracting)', 'last sample: up but stale extraction');
  });

  it('current reads OFF when the last sample is stale', () => {
    const t0 = Date.parse('2026-07-04T00:00:00Z');
    const line = JSON.stringify({ event: 'sample', ts: new Date(t0).toISOString(), vm_boot: 1,
      node: { core_up: 6, core_total: 6, down: [] }, interaction: { state: 'ACTIVE', active: true },
      memory: { daemon: true, working: true, extraction_age_h: 1 } });
    const t = readTimeline(line, { now: t0 + GAP_THRESHOLD_MS + 60_000 });
    assert.equal(t.layers.vm.current, 'OFF');
    assert.equal(t.lastSampleStale, true);
  });
});

function mk(nowMs, boot) {
  return {
    ts: new Date(nowMs).toISOString(), vm_boot: boot,
    node: { core_up: 6, core_total: 6, down: [] },
    interaction: { state: 'IDLE', session: null, idle_s: 100, active: false },
    memory: { daemon: true, last_extraction: null, extraction_age_h: null, working: false },
  };
}
