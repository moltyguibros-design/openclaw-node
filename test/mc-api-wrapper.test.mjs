/**
 * mc-api-wrapper.test.mjs — workspace-bin/mc-api, the agent's way into
 * Mission Control's /api. MC denies every /api method without its session
 * token, and `curl -s` exits 0 on that 401, so the agent docs' bare curl calls
 * read as neither "up" nor "down". The wrapper sends the token as a header and
 * turns refused / down into distinct exit codes.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const BIN = path.join(ROOT, 'workspace-bin', 'mc-api');
const TOKEN = 'test-session-token';

function run(args, env, stdin) {
  return new Promise(resolve => {
    const child = spawn(process.execPath, [BIN, ...args], { env: { ...process.env, ...env } });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', d => { stdout += d; });
    child.stderr.on('data', d => { stderr += d; });
    child.on('close', code => resolve({ code, stdout, stderr }));
    child.stdin.end(stdin ?? '');
  });
}

describe('mc-api', () => {
  let dir;
  let server;
  let env;
  const seen = [];

  before(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-api-'));
    fs.writeFileSync(path.join(dir, 'token'), `${TOKEN}\n`, { mode: 0o600 });
    server = http.createServer((req, res) => {
      let body = '';
      req.on('data', d => { body += d; });
      req.on('end', () => {
        seen.push({ method: req.method, url: req.url, auth: req.headers.authorization, type: req.headers['content-type'], body });
        if (req.headers.authorization !== `Bearer ${TOKEN}`) {
          res.writeHead(401, { 'Content-Type': 'application/json' });
          return res.end('{"error":"token"}');
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, url: req.url }));
      });
    });
    await new Promise(r => server.listen(0, '127.0.0.1', r));
    env = { OPENCLAW_MC_URL: `http://127.0.0.1:${server.address().port}`, OPENCLAW_MC_TOKEN_FILE: path.join(dir, 'token') };
  });

  after(() => {
    server.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('GETs with the session token as a Bearer header, never on argv', async () => {
    const r = await run(['/api/tasks'], env);
    assert.equal(r.code, 0, r.stderr);
    assert.deepEqual(JSON.parse(r.stdout), { ok: true, url: '/api/tasks' });
    assert.equal(seen.at(-1).method, 'GET');
    assert.equal(seen.at(-1).auth, `Bearer ${TOKEN}`);
  });

  it('sends a JSON body from an argument, @file or stdin', async () => {
    const r1 = await run(['POST', '/api/memory/items', '{"content":"a"}'], env);
    assert.equal(r1.code, 0, r1.stderr);
    assert.deepEqual(seen.at(-1), { method: 'POST', url: '/api/memory/items', auth: `Bearer ${TOKEN}`, type: 'application/json', body: '{"content":"a"}' });

    fs.writeFileSync(path.join(dir, 'b.json'), '{"action":"approve"}');
    const r2 = await run(['patch', '/api/souls/x/evolution?eventId=e1', `@${path.join(dir, 'b.json')}`], env);
    assert.equal(r2.code, 0, r2.stderr);
    assert.equal(seen.at(-1).method, 'PATCH');
    assert.equal(seen.at(-1).url, '/api/souls/x/evolution?eventId=e1');
    assert.equal(seen.at(-1).body, '{"action":"approve"}');

    const r3 = await run(['POST', 'memory/flush', '-'], env, '{"facts":[]}');
    assert.equal(r3.code, 0, r3.stderr);
    assert.equal(seen.at(-1).url, '/api/memory/flush');
    assert.equal(seen.at(-1).body, '{"facts":[]}');
  });

  it('maps a path written without its leading slash onto /api once', async () => {
    const r = await run(['api/tasks'], env);
    assert.equal(r.code, 0, r.stderr);
    assert.equal(seen.at(-1).url, '/api/tasks');
  });

  it('refuses a body given without a method as a usage error, not as MC down', async () => {
    const before = seen.length;
    const r = await run(['/api/tasks', '{"a":1}'], env);
    assert.equal(r.code, 2, r.stderr);
    assert.match(r.stderr, /usage:/);
    assert.equal(seen.length, before);
  });

  it('exits 22 with a token hint when MC refuses', async () => {
    const r = await run(['/api/tasks'], { ...env, OPENCLAW_MC_TOKEN_FILE: path.join(dir, 'missing') });
    assert.equal(r.code, 22);
    assert.equal(seen.at(-1).auth, undefined);
    assert.match(r.stderr, /HTTP 401 on GET \/api\/tasks — session token missing or stale/);
  });

  it('exits 7 when MC is down', async () => {
    const probe = http.createServer();
    await new Promise(r => probe.listen(0, '127.0.0.1', r));
    const port = probe.address().port;
    await new Promise(r => probe.close(r));
    const r = await run(['/api/tasks'], { ...env, OPENCLAW_MC_URL: `http://127.0.0.1:${port}` });
    assert.equal(r.code, 7);
    assert.match(r.stderr, /Mission Control unreachable/);
  });
});
