/**
 * premise-benchmark-doc.test.mjs — docs/PREMISE_BENCHMARK.md told a rerun to
 * use the retired grappe-benchmark.mjs (which only printed RETIRED) and task
 * files that never existed. The retired script is deleted; the protocol must
 * name only commands and files that exist.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const doc = fs.readFileSync(path.join(ROOT, 'docs', 'PREMISE_BENCHMARK.md'), 'utf8');
const harness = fs.readFileSync(path.join(ROOT, 'bin', 'fed-benchmark.mjs'), 'utf8');

describe('PREMISE_BENCHMARK protocol', () => {
  it('names no retired benchmark driver (fed-chaos.test.mjs checks they are deleted)', () => {
    assert.doesNotMatch(doc, /node bin\/(grappe-benchmark|fed-benchmark-driver)\.mjs/);
  });

  it('opens with the CLOSED FAILED status', () => {
    assert.match(doc.split('\n## ')[0], /CLOSED FAILED/);
  });

  it('every `node bin/<script>` it names exists', () => {
    const scripts = [...doc.matchAll(/node (bin\/[\w.-]+)/g)].map(m => m[1]);
    assert.ok(scripts.length > 0);
    for (const s of scripts) assert.ok(fs.existsSync(path.join(ROOT, s)), `${s} is missing`);
  });

  it('every fed-benchmark subcommand it uses is one the harness dispatches', () => {
    const dispatch = harness.match(/const run = \{([\s\S]*?)\}\[cmd\]/)[1];
    const known = new Set([...dispatch.matchAll(/^\s*(\w+):/gm)].map(m => m[1]));
    const used = [...doc.matchAll(/`(?:node bin\/fed-benchmark\.mjs )?(submit|status|collect|repackage|tally|run|reveal)\b/g)].map(m => m[1]);
    assert.ok(used.length > 0);
    for (const c of used) assert.ok(known.has(c), `fed-benchmark has no '${c}' command`);
  });

  it('the task files it points at exist', () => {
    assert.match(doc, /benchmark\/tasks\/<id>\.md/);
    assert.ok(fs.readdirSync(path.join(ROOT, 'benchmark', 'tasks')).some(f => f.endsWith('.md')));
    assert.doesNotMatch(doc, /tasks\/<\w+>\.json/);
  });
});
