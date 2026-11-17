import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { atomicWriteFileSync, atomicWriteFile } from '../lib/atomic-write.mjs';

let dir;
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'atomic-write-test-')); });
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

const strayTmps = () => fs.readdirSync(dir).filter((n) => n.includes('.tmp.'));

describe('atomicWriteFileSync', () => {
  it('writes through mkdirp and reads back', () => {
    const p = path.join(dir, 'a', 'b', 'note.md');
    atomicWriteFileSync(p, 'hello', { mkdirp: true });
    assert.equal(fs.readFileSync(p, 'utf8'), 'hello');
    atomicWriteFileSync(p, Buffer.from('again'));
    assert.equal(fs.readFileSync(p, 'utf8'), 'again');
  });

  it('a failed write removes its tmp file', () => {
    assert.throws(() => atomicWriteFileSync(path.join(dir, 'x.md'), 123));
    assert.deepEqual(strayTmps(), []);
  });

  it('a failed rename removes its tmp file', () => {
    const target = path.join(dir, 'occupied');
    fs.mkdirSync(path.join(target, 'child'), { recursive: true });
    assert.throws(() => atomicWriteFileSync(target, 'x'));
    assert.deepEqual(strayTmps(), []);
  });
});

describe('atomicWriteFile', () => {
  it('writes through mkdirp and reads back', async () => {
    const p = path.join(dir, 'a', 'b', 'note.md');
    await atomicWriteFile(p, 'hello', { mkdirp: true });
    assert.equal(fs.readFileSync(p, 'utf8'), 'hello');
  });

  it('a failed rename removes its tmp file', async () => {
    const target = path.join(dir, 'occupied');
    fs.mkdirSync(path.join(target, 'child'), { recursive: true });
    await assert.rejects(atomicWriteFile(target, 'x'));
    assert.deepEqual(strayTmps(), []);
  });

  it('two concurrent writes to one path in the same millisecond both land whole', async () => {
    const p = path.join(dir, 'race.md');
    const big = 'A'.repeat(1 << 20);
    const small = 'B'.repeat(16);
    const realNow = Date.now;
    Date.now = () => 1;
    let results;
    try {
      results = await Promise.allSettled([atomicWriteFile(p, big), atomicWriteFile(p, small)]);
    } finally {
      Date.now = realNow;
    }
    assert.deepEqual(results.map((r) => r.status), ['fulfilled', 'fulfilled']);
    assert.ok([big, small].includes(fs.readFileSync(p, 'utf8')));
    assert.deepEqual(strayTmps(), []);
  });
});
