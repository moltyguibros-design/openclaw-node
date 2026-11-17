import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  walkVault,
  parseNote,
  extractWikilinks,
  buildGraph,
  computeBoundaryDegrees,
} from '../lib/obsidian-graph.mjs';

describe('computeBoundaryDegrees', () => {
  it('counts out/in per node; dangling targets still feed the source out-degree', () => {
    const graph = {
      nodes: new Map([['a', {}], ['b', {}], ['c', {}]]),
      edges: [
        { source: 'a', target: 'b' },
        { source: 'a', target: 'c' },
        { source: 'b', target: 'a' },
        { source: 'a', target: 'ghost' },
      ],
    };
    const d = computeBoundaryDegrees(graph);
    assert.deepEqual(d.get('a'), { out: 3, in: 1 });
    assert.deepEqual(d.get('b'), { out: 1, in: 1 });
    assert.deepEqual(d.get('c'), { out: 0, in: 1 });
    assert.equal(d.has('ghost'), false);
  });
});

describe('walkVault', () => {
  let tmpDir;

  before(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'obsidian-graph-walk-'));
    await mkdir(join(tmpDir, 'concepts'), { recursive: true });
    await mkdir(join(tmpDir, 'decisions'), { recursive: true });
    await writeFile(join(tmpDir, 'concepts', 'nats.md'), '# NATS\n');
    await writeFile(join(tmpDir, 'concepts', 'sqlite.md'), '# SQLite\n');
    await writeFile(join(tmpDir, 'decisions', 'use-nats.md'), '# Use NATS\n');
    await writeFile(join(tmpDir, 'not-markdown.txt'), 'ignored');
  });

  after(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('finds .md files across subdirectories', async () => {
    const notes = await walkVault(tmpDir);
    assert.equal(notes.length, 3);
    const ids = notes.map(n => n.id).sort();
    assert.deepStrictEqual(ids, ['concepts/nats', 'concepts/sqlite', 'decisions/use-nats']);
    assert.deepStrictEqual(notes.map(n => n.name).sort(), ['nats', 'sqlite', 'use-nats']);
  });

  it('assigns correct subdirectory to each file', async () => {
    const notes = await walkVault(tmpDir);
    const nats = notes.find(n => n.id === 'concepts/nats');
    assert.equal(nats.subdirectory, 'concepts');
    const decision = notes.find(n => n.id === 'decisions/use-nats');
    assert.equal(decision.subdirectory, 'decisions');
  });

  it('returns empty array for non-existent vault', async () => {
    const notes = await walkVault(join(tmpDir, 'nonexistent'));
    assert.deepStrictEqual(notes, []);
  });
});

describe('parseNote', () => {
  it('parses frontmatter and body', () => {
    const content = `---
type: concept
mention_count: 12
related: [\"[[SQLite]]\", \"[[JetStream]]\"]
---

# NATS

Some body text with a [[wikilink]].
`;
    const { frontmatter, body } = parseNote(content);
    assert.equal(frontmatter.type, 'concept');
    assert.equal(frontmatter.mention_count, 12);
    assert.ok(Array.isArray(frontmatter.related));
    assert.ok(body.includes('# NATS'));
    assert.ok(body.includes('[[wikilink]]'));
  });

  it('returns null frontmatter for notes without frontmatter', () => {
    const content = '# Plain Note\n\nNo frontmatter here.\n';
    const { frontmatter, body } = parseNote(content);
    assert.equal(frontmatter, null);
    assert.ok(body.includes('# Plain Note'));
  });

  it('handles malformed YAML gracefully', () => {
    const content = '---\n: invalid: yaml: [\n---\n\nBody text.\n';
    const { frontmatter, body } = parseNote(content);
    assert.equal(frontmatter, null);
    assert.ok(body.includes('Body text.'));
  });
});

describe('extractWikilinks', () => {
  it('extracts simple [[target]] wikilinks', () => {
    const text = 'See [[NATS]] and [[SQLite]] for details.';
    const links = extractWikilinks(text);
    assert.deepStrictEqual(links, ['NATS', 'SQLite']);
  });

  it('handles [[target|display text]] form', () => {
    const text = 'See [[NATS JetStream|JetStream]] for messaging.';
    const links = extractWikilinks(text);
    assert.deepStrictEqual(links, ['NATS JetStream']);
  });

  it('returns empty array for text with no wikilinks', () => {
    const links = extractWikilinks('No links here.');
    assert.deepStrictEqual(links, []);
  });
});

describe('buildGraph', () => {
  let tmpDir;

  before(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'obsidian-graph-build-'));
    await mkdir(join(tmpDir, 'concepts'), { recursive: true });

    // Note 1: NATS with frontmatter and body wikilinks
    await writeFile(
      join(tmpDir, 'concepts', 'nats.md'),
      `---
type: concept
mention_count: 15
related: [\"[[SQLite]]\"]
---

# NATS

Used with [[JetStream]] for event streaming.
`
    );

    // Note 2: SQLite with no wikilinks
    await writeFile(
      join(tmpDir, 'concepts', 'sqlite.md'),
      `---
type: concept
mention_count: 8
---

# SQLite

Local database engine.
`
    );

    // Note 3: JetStream with edge_types in frontmatter
    await writeFile(
      join(tmpDir, 'concepts', 'jetstream.md'),
      `---
type: concept
mention_count: 10
edge_types:
  NATS: derived_from
---

# JetStream

Built on [[NATS]]. See also [[SQLite]].
`
    );
  });

  after(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('builds nodes from all notes', async () => {
    const { nodes } = await buildGraph(tmpDir);
    assert.equal(nodes.size, 3);
    assert.ok(nodes.has('concepts/nats'));
    assert.ok(nodes.has('concepts/sqlite'));
    assert.ok(nodes.has('concepts/jetstream'));
  });

  it('node includes frontmatter fields', async () => {
    const { nodes } = await buildGraph(tmpDir);
    const nats = nodes.get('concepts/nats');
    assert.equal(nats.label, 'nats');
    assert.equal(nats.type, 'concept');
    assert.equal(nats.mention_count, 15);
    assert.equal(nats.subdirectory, 'concepts');
  });

  it('creates edges from body wikilinks', async () => {
    const { edges } = await buildGraph(tmpDir);
    const natsToJetstream = edges.find(
      e => e.source === 'concepts/nats' && e.target === 'concepts/jetstream'
    );
    assert.ok(natsToJetstream, 'Expected edge from nats to jetstream (display-name target normalized to node id)');
    assert.equal(natsToJetstream.type, 'mentions');
  });

  it('creates edges from frontmatter related field', async () => {
    const { edges } = await buildGraph(tmpDir);
    const natsToSqlite = edges.find(
      e => e.source === 'concepts/nats' && e.target === 'concepts/sqlite'
    );
    assert.ok(natsToSqlite, 'Expected edge from nats to sqlite via related');
  });

  it('uses edge_types from frontmatter when present', async () => {
    const { edges } = await buildGraph(tmpDir);
    const jsToNats = edges.find(
      e => e.source === 'concepts/jetstream' && e.target === 'concepts/nats'
    );
    assert.ok(jsToNats, 'Expected edge from jetstream to nats');
    assert.equal(jsToNats.type, 'derived_from');
  });

  it('defaults to mentions type when no edge_types mapping', async () => {
    const { edges } = await buildGraph(tmpDir);
    const jsToSqlite = edges.find(
      e => e.source === 'concepts/jetstream' && e.target === 'concepts/sqlite'
    );
    assert.ok(jsToSqlite, 'Expected edge from jetstream to sqlite');
    assert.equal(jsToSqlite.type, 'mentions');
  });

  it('returns empty graph for empty vault', async () => {
    const emptyDir = await mkdtemp(join(tmpdir(), 'obsidian-graph-empty-'));
    try {
      const { nodes, edges } = await buildGraph(emptyDir);
      assert.equal(nodes.size, 0);
      assert.equal(edges.length, 0);
    } finally {
      await rm(emptyDir, { recursive: true, force: true });
    }
  });
});

// A theme hub and a concept note that share a slug used to be one node keyed
// 'nats': the later file's frontmatter won, both notes' edges shared a source,
// and the hub's link to its own concept was dropped as a self-loop.
describe('same-named notes in different folders', () => {
  let tmpDir;

  before(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'obsidian-graph-collide-'));
    for (const d of ['concepts', 'themes', 'sessions']) await mkdir(join(tmpDir, d), { recursive: true });
    await writeFile(join(tmpDir, 'concepts', 'nats.md'), '---\ntype: concept\n---\n# NATS\nSee [[jetstream]].\n');
    await writeFile(join(tmpDir, 'concepts', 'jetstream.md'), '---\ntype: concept\n---\n# JetStream\n');
    await writeFile(join(tmpDir, 'themes', 'nats.md'),
      '---\ntype: theme\n---\n# nats\n## Concepts\n- [[concepts/nats|NATS]]\n## Related themes\n- [[themes/messaging|messaging]]\n');
    await writeFile(join(tmpDir, 'themes', 'messaging.md'), '---\ntype: theme\n---\n# messaging\nSee [[nats]].\n');
    await writeFile(join(tmpDir, 'sessions', 's1.md'), '---\ntype: session\n---\nTalked about [[nats]].\n');
  });

  after(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('keeps both notes as separate nodes with their own frontmatter', async () => {
    const { nodes } = await buildGraph(tmpDir);
    assert.equal(nodes.size, 5);
    assert.equal(nodes.get('concepts/nats').type, 'concept');
    assert.equal(nodes.get('themes/nats').type, 'theme');
    assert.equal(nodes.get('themes/nats').label, 'nats');
  });

  it('keeps the hub → concept edge and each note its own out-edges', async () => {
    const { edges } = await buildGraph(tmpDir);
    const has = (s, t) => edges.some(e => e.source === s && e.target === t);
    assert.ok(has('themes/nats', 'concepts/nats'), 'hub links its same-named concept');
    assert.ok(has('themes/nats', 'themes/messaging'));
    assert.ok(has('concepts/nats', 'concepts/jetstream'));
    assert.ok(!has('themes/nats', 'concepts/jetstream'), 'the hub does not inherit the concept\'s links');
  });

  it('a bare name resolves to the note in the linking folder, else the first by path', async () => {
    const { edges } = await buildGraph(tmpDir);
    const targetOf = s => edges.filter(e => e.source === s).map(e => e.target);
    assert.deepEqual(targetOf('themes/messaging'), ['themes/nats']);
    assert.deepEqual(targetOf('sessions/s1'), ['concepts/nats']);
  });
});
