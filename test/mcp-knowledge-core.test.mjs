/**
 * test/mcp-knowledge-core.test.mjs — model-free tests of the knowledge core:
 * chunking of session turns and markdown.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  chunkSessionTurns,
  splitByParagraphs,
  MAX_CHUNK_CHARS,
} from '../lib/mcp-knowledge/core.mjs';

// A paragraph longer than a chunk (tool output, a log, a code paste) used to be
// stored whole mid-turn and cut to its first MAX_CHUNK_CHARS at the end of one.
describe('oversized paragraphs', () => {
  it('a long single-newline tool output keeps its tail, in at most four chunks that each fit', () => {
    const lines = Array.from({ length: 3000 }, (_, i) => `line ${i}`);
    const chunks = chunkSessionTurns([{ role: 'tool', content: lines.join('\n') }]);
    assert.ok(chunks.length <= 4, `got ${chunks.length} chunks`);
    assert.ok(chunks.length > 1);
    for (const c of chunks) assert.ok(c.text.length <= MAX_CHUNK_CHARS, `chunk of ${c.text.length} chars`);
    assert.ok(chunks.every(c => c.text.startsWith('[tool] ') && c.turn_index === 0));
    assert.ok(chunks.at(-1).text.endsWith('line 2999'), 'the last chunk carries the end of the output');
    assert.ok(chunks[0].text.includes('line 0\n'), 'the first chunk carries its start');
  });

  it('a long paragraph mid-turn is windowed, not stored oversized', () => {
    const content = `head\n\n${'x'.repeat(4000)}\n\ntail words`;
    const chunks = chunkSessionTurns([{ role: 'assistant', content }]);
    for (const c of chunks) assert.ok(c.text.length <= MAX_CHUNK_CHARS, `chunk of ${c.text.length} chars`);
    const body = chunks.map(c => c.text.slice('[assistant] '.length)).join('');
    assert.equal(body.replace(/\n/g, '').length, 'head'.length + 4000 + 'tail words'.length);
    assert.ok(chunks.at(-1).text.endsWith('tail words'));
  });

  it('a long last paragraph is not cut to its first chunk', () => {
    const content = `short head\n\n${'y'.repeat(3000)}z`;
    const chunks = chunkSessionTurns([{ role: 'user', content }]);
    for (const c of chunks) assert.ok(c.text.length <= MAX_CHUNK_CHARS);
    assert.ok(chunks.at(-1).text.endsWith('yz'), 'the end of the paragraph is indexed');
  });

  it('a turn within the window budget loses nothing', () => {
    const lines = Array.from({ length: 500 }, (_, i) => `row ${i}`);
    const chunks = chunkSessionTurns([{ role: 'tool', content: lines.join('\n') }]);
    const rows = chunks.flatMap(c => c.text.slice('[tool] '.length).split('\n'));
    assert.deepEqual(rows, lines);
  });

  it('splitByParagraphs windows a paragraph longer than a chunk at its newlines', () => {
    const lines = Array.from({ length: 1000 }, (_, i) => `entry ${i}`);
    const chunks = [];
    splitByParagraphs('## Log', `intro\n\n${lines.join('\n')}`, chunks);
    for (const c of chunks) assert.ok(c.text.length <= MAX_CHUNK_CHARS, `chunk of ${c.text.length} chars`);
    const rows = chunks.flatMap(c => c.text.split(/\n+/));
    assert.deepEqual(rows, ['intro', ...lines]);
    assert.ok(chunks.every(c => c.section.startsWith('## Log [part ')));
  });
});
