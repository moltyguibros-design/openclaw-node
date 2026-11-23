/**
 * test/mcp-knowledge-core.test.mjs — model-free tests of the knowledge core:
 * the markdown scanner, the markdown and session-turn chunkers, content
 * hashing, the schema and sqlite-vec. The checks that need the embedding
 * model stay in the manual lib/mcp-knowledge/test.mjs.
 */

import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpDir } from './helpers/tmp-dir.cjs';

import {
  scanMarkdownFiles,
  chunkMarkdown,
  chunkSessionTurns,
  splitByParagraphs,
  hashContent,
  initDatabase,
  EMBEDDING_DIM,
  MAX_CHUNK_CHARS,
} from '../lib/mcp-knowledge/core.mjs';

function createTestWorkspace() {
  const dir = tmpDir('mcp-k-core-');
  const docsDir = join(dir, 'docs');
  mkdirSync(docsDir, { recursive: true });
  writeFileSync(join(docsDir, 'oracle.md'), '# Oracle Threat Model\n\n## GPS Spoofing Attacks\n\nPlayers could fake their location.\n');
  writeFileSync(join(docsDir, 'factions.md'), '# Faction Lore\n\n## The Verdant Pact\n\nPower from natural biomes.\n');
  writeFileSync(join(docsDir, 'architecture.md'), '# Technical Architecture\n\n## Smart Contract Stack\n\nThe core contracts.\n');
  writeFileSync(join(docsDir, 'data.json'), '{"key": "value"}');
  writeFileSync(join(docsDir, 'contract.sol'), 'pragma solidity ^0.8.0;');
  writeFileSync(join(docsDir, 'image.png'), 'fakepng');
  writeFileSync(join(dir, 'active-tasks.md'), '# Active Tasks\n\nstuff');
  return { dir, docsDir };
}

describe('scanMarkdownFiles', () => {
  let ws;
  before(() => { ws = createTestWorkspace(); });

  it('finds only the .md files of an included directory, each with path and rel', () => {
    const files = scanMarkdownFiles(ws.dir, ['docs/'], []);
    assert.deepEqual(files.map(f => f.rel).sort(), ['docs/architecture.md', 'docs/factions.md', 'docs/oracle.md']);
    assert.ok(files.every(f => f.path === join(ws.dir, f.rel)));
  });

  it('drops files matching an exclude pattern', () => {
    const files = scanMarkdownFiles(ws.dir, ['docs/', 'active-tasks.md'], [/active-tasks\.md$/]);
    assert.ok(!files.some(f => f.rel.includes('active-tasks')));
  });

  it('a missing or empty include directory yields nothing', () => {
    assert.deepEqual(scanMarkdownFiles(ws.dir, ['nonexistent/'], []), []);
    mkdirSync(join(ws.dir, 'empty'));
    assert.deepEqual(scanMarkdownFiles(ws.dir, ['empty/'], []), []);
  });

  it('a single file works as an include', () => {
    writeFileSync(join(ws.dir, 'SOUL.md'), '# Soul\n\nIdentity file.');
    assert.deepEqual(scanMarkdownFiles(ws.dir, ['SOUL.md'], []).map(f => f.rel), ['SOUL.md']);
  });
});

describe('chunkMarkdown', () => {
  const bigPara = 'A'.repeat(800);

  it('cuts at headings and labels each chunk with its heading', () => {
    const chunks = chunkMarkdown('# Title\n\nIntro.\n\n## Section A\n\nBody A.\n\n## Section B\n\nBody B.');
    assert.deepEqual(chunks.map(c => c.section), ['# Title', '## Section A', '## Section B']);
  });

  it('a document without headings is one (top) chunk; an empty one still yields a chunk', () => {
    const plain = chunkMarkdown('Plain text, no headings.');
    assert.equal(plain.length, 1);
    assert.equal(plain[0].section, '(top)');
    assert.equal(chunkMarkdown('').length, 1);
  });

  it('an oversized section splits at paragraphs into [part N] chunks', () => {
    const chunks = chunkMarkdown(`# Big\n\n${[bigPara, bigPara, bigPara].join('\n\n')}`);
    assert.ok(chunks.length >= 2, `got ${chunks.length}`);
    assert.ok(chunks.every(c => c.section.startsWith('# Big [part ')));
  });

  it('an oversized section splits at its sub-headings first, recursively', () => {
    const doc = `## Parent\n\n### Sub A\n\n${'B'.repeat(600)}\n\n### Sub B\n\n${'C'.repeat(600)}\n\n### Sub C\n\n${'D'.repeat(600)}`;
    const chunks = chunkMarkdown(doc);
    assert.ok(chunks.length >= 3, `got ${chunks.length}`);
    assert.ok(chunks.some(c => c.section === '### Sub A'));
    assert.ok(chunkMarkdown('## L2\n\n### L3\n\n#### L4a\n\nContent A.\n\n#### L4b\n\nContent B.').length >= 1);
  });

  it('no chunk exceeds MAX_CHUNK_CHARS', () => {
    const docs = [
      `# Big\n\n${[bigPara, bigPara, bigPara].join('\n\n')}`,
      `## Parent\n\n### Sub A\n\n${'B'.repeat(2500)}\n\n### Sub B\n\n${'C'.repeat(600)}`,
      `# One paragraph\n\n${'word '.repeat(1500)}`,
      `# Log\n\n${Array.from({ length: 800 }, (_, i) => `entry ${i}`).join('\n')}`,
    ];
    for (const doc of docs) {
      for (const c of chunkMarkdown(doc)) assert.ok(c.text.length <= MAX_CHUNK_CHARS, `${c.section}: ${c.text.length} chars`);
    }
  });

  it('keeps mixed heading levels, unicode and frontmatter', () => {
    assert.equal(chunkMarkdown('# H1\n\nA.\n\n### H3\n\nB.\n\n## H2\n\nC.').length, 3);
    assert.ok(chunkMarkdown('# Titre\n\nContenu en français: é, è, ê, à, ü.')[0].text.includes('français'));
    assert.ok(chunkMarkdown('---\ntitle: Test\n---\n\n# Real Header\n\nBody.').some(c => c.text.includes('---')));
  });
});

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

describe('hashContent', () => {
  it('is a stable SHA-256 hex digest', () => {
    assert.equal(hashContent('hello'), hashContent('hello'));
    assert.notEqual(hashContent('hello'), hashContent('world'));
    assert.match(hashContent(''), /^[0-9a-f]{64}$/);
  });
});

describe('initDatabase', () => {
  it('creates the document tables, the vector table and the doc-path index', () => {
    const db = initDatabase(':memory:');
    try {
      const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(r => r.name);
      for (const t of ['documents', 'chunks', 'meta', 'chunk_vectors']) assert.ok(tables.includes(t), `${t} missing`);
      assert.ok(db.prepare("SELECT 1 FROM sqlite_master WHERE type='index' AND name='idx_chunks_doc_path'").get());
    } finally {
      db.close();
    }
  });

  it('opens a file database in WAL mode', () => {
    const db = initDatabase(join(tmpDir('mcp-k-core-wal-'), 'wal-test.db'));
    try {
      assert.equal(db.pragma('journal_mode', { simple: true }), 'wal');
    } finally {
      db.close();
    }
  });
});

describe('sqlite-vec', () => {
  it('loads and ranks nearest neighbours by distance', () => {
    const db = initDatabase(':memory:');
    try {
      assert.ok(db.prepare('SELECT vec_version() AS v').get().v);
      const v1 = new Float32Array(EMBEDDING_DIM);
      v1[0] = 1;
      const b1 = Buffer.from(v1.buffer);
      db.prepare('INSERT INTO chunk_vectors VALUES (1, ?)').run(b1);
      const self = db.prepare('SELECT rowid, distance FROM chunk_vectors WHERE embedding MATCH ? AND k = 5').all(b1);
      assert.equal(self.length, 1);
      assert.ok(self[0].distance < 0.001, `self distance ${self[0].distance}`);

      const v2 = new Float32Array(EMBEDDING_DIM);
      v2[1] = 1;
      db.prepare('INSERT INTO chunk_vectors VALUES (2, ?)').run(Buffer.from(v2.buffer));
      const knn = db.prepare('SELECT rowid, distance FROM chunk_vectors WHERE embedding MATCH ? AND k = 5').all(b1);
      assert.deepEqual(knn.map(r => r.rowid), [1, 2]);
      assert.ok(knn[1].distance > knn[0].distance);
    } finally {
      db.close();
    }
  });
});
