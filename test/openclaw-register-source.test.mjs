/**
 * openclaw-register-source.test.mjs — workspace-bin/openclaw-register-source
 * writes ~/.openclaw/config/transcript-sources.json, which memory-daemon and
 * archive-transcripts.sh read from their own working directories. A relative
 * --path has to be stored resolved against the caller's cwd.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const BIN = fileURLToPath(new URL('../workspace-bin/openclaw-register-source', import.meta.url));

function setup(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'register-source-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const home = path.join(root, 'home');
  const cwd = path.join(root, 'a');
  fs.mkdirSync(home);
  fs.mkdirSync(cwd);
  const add = (name, p) => {
    // The registry asserted on is ~/.openclaw's; an inherited OPENCLAW_HOME (CI exports one) would move it.
    const { OPENCLAW_HOME: _inheritedRoot, ...env } = process.env;
    const r = spawnSync(process.execPath, [BIN, 'add', '--name', name, '--path', p], { cwd, encoding: 'utf8', env: { ...env, HOME: home } });
    assert.equal(r.status, 0, r.stderr);
    return r.stdout;
  };
  const stored = name => JSON.parse(fs.readFileSync(path.join(home, '.openclaw/config/transcript-sources.json'), 'utf8'))
    .sources.find(s => s.name === name).path;
  return { cwd, add, stored };
}

test('a relative --path is stored resolved against the caller cwd', t => {
  const { cwd, add, stored } = setup(t);
  const out = add('x', 'rel/dir');
  assert.equal(stored('x'), path.join(cwd, 'rel/dir'));
  assert.ok(out.includes(`Added source: x → ${path.join(cwd, 'rel/dir')}`), out);
});

test('~ and absolute paths are stored as given', t => {
  const { add, stored } = setup(t);
  add('home', '~/s');
  add('abs', '/abs/s');
  assert.equal(stored('home'), '~/s');
  assert.equal(stored('abs'), '/abs/s');
});

test('re-adding a source reports the stored path', t => {
  const { cwd, add } = setup(t);
  add('x', 'one');
  const out = add('x', 'two');
  assert.ok(out.includes(`Updated source: x → ${path.join(cwd, 'two')}`), out);
});

test('under OPENCLAW_HOME the source lands in that node\'s registry, the one the readers load', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'register-source-node-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const nodeRoot = path.join(root, 'node-b');
  const r = spawnSync(process.execPath, [BIN, 'add', '--name', 'b', '--path', '/b/sessions'], {
    encoding: 'utf8', env: { ...process.env, HOME: path.join(root, 'home'), OPENCLAW_HOME: nodeRoot },
  });
  assert.equal(r.status, 0, r.stderr);
  assert.ok(!fs.existsSync(path.join(root, 'home', '.openclaw')), 'nothing written under ~/.openclaw');
  const { loadTranscriptSources } = await import('../lib/transcript-sources.mjs');
  assert.deepEqual(loadTranscriptSources(nodeRoot).map(s => s.path), ['/b/sessions']);
});
