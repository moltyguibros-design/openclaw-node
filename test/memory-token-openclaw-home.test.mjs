#!/usr/bin/env node
/**
 * memory-token-openclaw-home.test.mjs — the memory daemon keeps its inject token
 * under OPENCLAW_HOME (lib/memory-daemon-paths.mjs); its two other readers, the
 * mesh-agent recall and the context-engine plugin's client, look there too.
 *
 * Run: node --test test/memory-token-openclaw-home.test.mjs
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { createRequire } from 'node:module';
import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'token-home-'));
const NODE_ROOT = path.join(TMP, 'node-root');
fs.mkdirSync(path.join(NODE_ROOT, 'config'), { recursive: true });
fs.writeFileSync(path.join(NODE_ROOT, 'config', 'memory-injection-token'), 'root-token\n');
fs.mkdirSync(path.join(TMP, 'home', '.openclaw', 'config'), { recursive: true });
fs.writeFileSync(path.join(TMP, 'home', '.openclaw', 'config', 'memory-injection-token'), 'home-token\n');

const seen = [];
const server = http.createServer((req, res) => {
  seen.push(req.headers.authorization);
  req.resume();
  req.on('end', () => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ block: '[memory: ok]' })); });
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
after(() => { server.close(); fs.rmSync(TMP, { recursive: true, force: true }); });

Object.assign(process.env, {
  HOME: path.join(TMP, 'home'),
  OPENCLAW_HOME: NODE_ROOT,
  MEMORY_INJECT_PORT: String(server.address().port),
  MESH_WORKSPACE: path.join(TMP, 'workspace'),
  OPENCLAW_NODE_ID: 'node-token',
  OPENCLAW_OBS_DB: ':memory:',
});
delete process.env.MESH_MEMORY_RECALL;

const require = createRequire(import.meta.url);
const agent = require('../bin/mesh-agent.js');
const { createMemoryClient, defaultTokenPath } = await import('../packages/openclaw-memory-context-engine/memory-client.js');

describe('memory inject token under OPENCLAW_HOME', () => {
  it('mesh-agent recall sends the token from OPENCLAW_HOME, not ~/.openclaw', async () => {
    const block = await agent.recallForTask({ task_id: 'T-tok', title: 'find the notes', description: 'about tokens' });
    assert.equal(block, '[memory: ok]');
    assert.equal(seen.at(-1), 'Bearer root-token');
  });

  it('the context-engine client reads the token from OPENCLAW_HOME by default', async () => {
    const client = createMemoryClient({ injectUrl: `http://127.0.0.1:${server.address().port}` });
    assert.equal(client.tokenPath, path.join(NODE_ROOT, 'config', 'memory-injection-token'));
    await client.health();
    assert.equal(seen.at(-1), 'Bearer root-token');
  });

  it('without OPENCLAW_HOME both fall back to ~/.openclaw', () => {
    assert.equal(defaultTokenPath({}, '/home/u'), '/home/u/.openclaw/config/memory-injection-token');
    assert.equal(defaultTokenPath({ OPENCLAW_HOME: '/srv/n' }, '/home/u'), '/srv/n/config/memory-injection-token');
  });
});
