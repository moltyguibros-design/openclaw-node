import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SKILL = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'skills', 'n8n');
const SCRIPT = path.join(SKILL, 'scripts', 'n8n_api.py');

// A stand-in `requests` that records each call instead of reaching the network.
const FAKE_REQUESTS = `
import json, os
class exceptions:
    class HTTPError(Exception):
        pass
class _Response:
    status_code = 200
    content = b'{}'
    text = '{}'
    def raise_for_status(self):
        pass
    def json(self):
        return {}
class Session:
    def __init__(self):
        self.headers = {}
    def request(self, method, url, **kwargs):
        with open(os.environ['FAKE_REQUESTS_LOG'], 'a') as f:
            f.write(json.dumps({'method': method, 'url': url, 'json': kwargs.get('json')}) + '\\n')
        return _Response()
`;

describe('n8n skill client', () => {
  let dir;
  let log;
  before(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'n8n-skill-'));
    fs.writeFileSync(path.join(dir, 'requests.py'), FAKE_REQUESTS);
    log = path.join(dir, 'calls.jsonl');
  });
  after(() => fs.rmSync(dir, { recursive: true, force: true }));

  const run = (args, env = {}) => {
    fs.rmSync(log, { force: true });
    const r = spawnSync('python3', [SCRIPT, ...args], {
      encoding: 'utf8',
      env: { PATH: process.env.PATH, PYTHONPATH: dir, FAKE_REQUESTS_LOG: log, N8N_API_KEY: 'k', ...env },
    });
    const calls = fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n').map(l => JSON.parse(l)) : [];
    return { ...r, calls };
  };

  it('refuses to start without N8N_BASE_URL instead of requesting None/api/v1', () => {
    const r = run(['list-workflows']);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /N8N_BASE_URL not found/);
    assert.deepEqual(r.calls, []);
  });

  it('activate and deactivate use the public API POST endpoints', () => {
    const env = { N8N_BASE_URL: 'http://n8n.test:5678' };
    assert.deepEqual(run(['activate', '--id', '7'], env).calls,
      [{ method: 'POST', url: 'http://n8n.test:5678/api/v1/workflows/7/activate', json: null }]);
    assert.deepEqual(run(['deactivate', '--id', '7'], env).calls,
      [{ method: 'POST', url: 'http://n8n.test:5678/api/v1/workflows/7/deactivate', json: null }]);
  });

  it('offers no execute command, which the public API does not have', () => {
    const r = run(['execute', '--id', '7'], { N8N_BASE_URL: 'http://n8n.test:5678' });
    assert.equal(r.status, 2);
    assert.deepEqual(r.calls, []);
    assert.doesNotMatch(fs.readFileSync(path.join(SKILL, 'SKILL.md'), 'utf8'), /n8n_api\.py execute/);
  });

  it('ships requests in requirements.txt so the installer pip-installs it, and documents N8N_BASE_URL', () => {
    assert.match(fs.readFileSync(path.join(SKILL, 'requirements.txt'), 'utf8'), /^requests\b/m);
    assert.match(fs.readFileSync(path.join(SKILL, 'SKILL.md'), 'utf8'), /export N8N_BASE_URL=/);
  });
});
