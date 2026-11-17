#!/usr/bin/env node
/**
 * mesh-cli-collab-gate.test.js — audit mesh-core~2#13.
 *
 * A circling session waiting at a gate resumes only on a signed
 * mesh.collab.gate.approve|reject, and nothing could send one: the CLI had no
 * collab command, while the bridge told the operator to "approve/reject". The
 * reject handler also read the session, appended its gate_rejected audit entry,
 * and then blind-put the stale copy, erasing that entry.
 *
 * The REAL `mesh collab gate` CLI runs as a child process against a minimal
 * in-process NATS stand-in that hands each gate request to the daemon's REAL
 * handler over an in-memory CollabStore, so the CLI's signature has to pass the
 * daemon's own operator check.
 *
 * Run: node --test test/mesh-cli-collab-gate.test.js
 */
const fs = require('node:fs');
const os = require('node:os');
const net = require('node:net');
const path = require('node:path');
const { spawn } = require('node:child_process');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'cli-collab-gate-'));
Object.assign(process.env, {
  HOME: TMP,
  OPENCLAW_OBS_DB: path.join(TMP, 'obs.db'),
});

const { describe, it, before, after, mock } = require('node:test');
const assert = require('node:assert/strict');
const { StringCodec } = require('nats');
const { getOrCreateIdentity } = require('../lib/node-identity.mjs');

const operator = getOrCreateIdentity(path.join(TMP, '.openclaw'));
process.env.OPENCLAW_OPERATOR_TRUSTED_KEYS = operator.publicKeyBase64;

const daemon = require('../bin/mesh-task-daemon.js');
const { createSession, CollabStore, COLLAB_STATUS } = require('../lib/mesh-collab');

const sc = StringCodec();
const REPO = path.join(__dirname, '..');

class MockKV {
  constructor() { this.store = new Map(); }
  async put(key, value) { this.store.set(key, { value }); }
  async update(key, value) { return this.put(key, value); }
  async get(key) { return this.store.get(key) || null; }
  async delete(key) { this.store.delete(key); }
  async keys() { return this.store.keys(); }
}

const collabStore = new CollabStore(new MockKV());
const completed = [];
daemon.__test.setContext({
  collabStore,
  store: {
    async get(taskId) { return { task_id: taskId, title: 'circling task', description: 'd', scope: [] }; },
    async touchActivity() {},
    async markCompleted(taskId, result) { completed.push(taskId); return { task_id: taskId, status: 'completed', result }; },
    async markReleased() { return null; },
  },
  nc: { publish() {}, request: async () => { throw new Error('no agent on the test bus'); } },
});

const HANDLERS = {
  'mesh.collab.gate.approve': daemon.__test.handleCirclingGateApprove,
  'mesh.collab.gate.reject': daemon.__test.handleCirclingGateReject,
};

/** Just enough of the NATS client protocol for one request/reply per connection. */
function natsStandIn() {
  const sockets = new Set();
  const server = net.createServer((socket) => {
    sockets.add(socket);
    socket.on('error', () => {});
    const subs = [];
    let buf = Buffer.alloc(0);
    const deliver = (reply, payload) => {
      const sub = subs.find(s => s.pattern.endsWith('.*') ? reply.startsWith(s.pattern.slice(0, -1)) : s.pattern === reply);
      if (!sub) return;
      const body = Buffer.from(payload);
      socket.write(`MSG ${reply} ${sub.sid} ${body.length}\r\n`);
      socket.write(Buffer.concat([body, Buffer.from('\r\n')]));
    };
    socket.on('data', async (chunk) => {
      buf = Buffer.concat([buf, chunk]);
      for (;;) {
        const eol = buf.indexOf('\r\n');
        if (eol < 0) return;
        const line = buf.subarray(0, eol).toString();
        const [op, ...rest] = line.split(' ');
        if (op === 'PUB' || op === 'HPUB') {
          const total = Number(rest[rest.length - 1]);
          if (buf.length < eol + 2 + total + 2) return;
          let payload = buf.subarray(eol + 2, eol + 2 + total);
          if (op === 'HPUB') payload = payload.subarray(Number(rest[rest.length - 2]));
          buf = buf.subarray(eol + 2 + total + 2);
          const [subject, reply] = rest;
          const handler = HANDLERS[subject];
          if (handler && rest.length >= (op === 'HPUB' ? 4 : 3)) {
            await handler({ data: new Uint8Array(payload), respond: (data) => deliver(reply, data) });
          }
          continue;
        }
        buf = buf.subarray(eol + 2);
        if (op === 'PING') socket.write('PONG\r\n');
        else if (op === 'SUB') subs.push({ pattern: rest[0], sid: rest[rest.length - 1] });
      }
    });
    socket.write('INFO {"server_id":"stand-in","version":"2.10.0","proto":1,"max_payload":1048576,"headers":true}\r\n');
  });
  return {
    async listen() { await new Promise(r => server.listen(0, '127.0.0.1', r)); return `nats://127.0.0.1:${server.address().port}`; },
    async close() { for (const s of sockets) s.destroy(); await new Promise(r => server.close(r)); },
  };
}

const bus = natsStandIn();
let natsUrl;
before(async () => { natsUrl = await bus.listen(); });
after(async () => { await bus.close(); fs.rmSync(TMP, { recursive: true, force: true }); });

function mesh(...args) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [path.join(REPO, 'bin', 'mesh.js'), ...args], {
      cwd: REPO, env: { ...process.env, OPENCLAW_NATS: natsUrl, OPENCLAW_OPERATOR_TRUSTED_KEYS: '' },
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', d => { stdout += d; });
    child.stderr.on('data', d => { stderr += d; });
    child.on('close', status => resolve({ status, stdout, stderr }));
  });
}

/** A circling session at its gate, SR1 done. */
async function sessionAtGate(phase = 'circling') {
  const session = createSession(`gate-task-${Math.random().toString(36).slice(2, 8)}`, {
    mode: 'circling_strategy', min_nodes: 3, max_nodes: 3, max_subrounds: 1, automation_tier: 3,
    node_roles: [{ role: 'worker' }, { role: 'reviewer' }, { role: 'reviewer' }],
  });
  await collabStore.put(session);
  for (const [id, role] of [['node-worker', 'worker'], ['node-revA', 'reviewer'], ['node-revB', 'reviewer']]) {
    await collabStore.addNode(session.session_id, id, role, '*');
  }
  const s = await collabStore.get(session.session_id);
  s.status = COLLAB_STATUS.ACTIVE;
  s.circling.phase = phase;
  s.circling.current_subround = 1;
  s.circling.current_step = 2;
  await collabStore.put(s);
  return session.session_id;
}

describe('mesh collab gate', () => {
  // startCirclingStep arms a per-step timeout; keep it from holding the process open.
  before(() => mock.timers.enable({ apis: ['setTimeout'] }));
  after(() => mock.timers.reset());

  it('reject: a signed request reaches the daemon, opens another sub-round and keeps its audit entry', async () => {
    const sid = await sessionAtGate();
    const r = await mesh('collab', 'gate', 'reject', sid);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, new RegExp(`Gate rejected: ${sid} → sub-round 2`));
    const s = await collabStore.get(sid);
    assert.equal(s.circling.current_subround, 2);
    assert.equal(s.circling.max_subrounds, 2);
    assert.ok(s.audit_log.some(e => e.event === 'gate_rejected'), 'the gate_rejected audit entry survives');
  });

  it('approve at finalization completes the session', async () => {
    const sid = await sessionAtGate('finalization');
    const r = await mesh('collab', 'gate', 'approve', sid);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, new RegExp(`Gate approved: ${sid} resumes`));
    const s = await collabStore.get(sid);
    assert.equal(s.status, COLLAB_STATUS.COMPLETED);
    assert.ok(s.audit_log.some(e => e.event === 'gate_approved'));
  });

  it('a refusal exits non-zero with the daemon\'s reason', async () => {
    const r = await mesh('collab', 'gate', 'approve', 'no-such-session');
    assert.equal(r.status, 1);
    assert.match(r.stderr, /mesh\.collab\.gate\.approve refused: Not a circling session/);
  });

  it('usage errors exit non-zero', async () => {
    const r = await mesh('collab', 'gate', 'maybe', 'x');
    assert.equal(r.status, 1);
    assert.match(r.stderr, /Usage: mesh collab gate approve\|reject <session-id>/);
  });
});
