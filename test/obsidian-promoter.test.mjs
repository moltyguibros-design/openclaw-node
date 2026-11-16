import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { mkdtemp, rm, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import Database from 'better-sqlite3';
import yaml from 'js-yaml';

import {
  sharedConceptsDir,
  buildPromotedFrontmatter,
  queryPromotableConcepts,
  promoteConceptNotes,
} from '../lib/obsidian-promoter.mjs';

// ── Helpers ──────────────────────────────────────────────

function createTestDb() {
  const db = new Database(':memory:');
  // Schema matches the F-C15 privacy migration: entities/decisions/themes
  // have a `private` column defaulting to 1. seedConceptData publishes
  // (private=0) so the test fixtures surface under F-N102's filter.
  db.exec(`
    CREATE TABLE entities (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'concept',
      first_seen TEXT,
      last_seen TEXT,
      mention_count INTEGER DEFAULT 0,
      private INTEGER DEFAULT 1,
      source_type TEXT DEFAULT 'local',
      source_node TEXT,
      source_event_id TEXT
    );
    CREATE TABLE mentions (
      id INTEGER PRIMARY KEY,
      entity_id INTEGER NOT NULL,
      session_id TEXT NOT NULL,
      salience REAL DEFAULT 0.5,
      created_at TEXT DEFAULT '2026-01-01T00:00:00Z',
      source_type TEXT DEFAULT 'local',
      source_node TEXT,
      source_event_id TEXT
    );
    CREATE TABLE decisions (
      id INTEGER PRIMARY KEY,
      decision TEXT NOT NULL,
      rationale TEXT,
      session_id TEXT NOT NULL,
      confidence REAL DEFAULT 0.5,
      created_at TEXT DEFAULT '2026-01-01T00:00:00Z',
      private INTEGER DEFAULT 1,
      source_type TEXT DEFAULT 'local',
      source_node TEXT,
      source_event_id TEXT
    );
    CREATE TABLE themes (
      id INTEGER PRIMARY KEY,
      label TEXT NOT NULL,
      session_id TEXT,
      private INTEGER DEFAULT 1,
      source_type TEXT DEFAULT 'local',
      source_node TEXT,
      source_event_id TEXT
    );
  `);
  return db;
}

function seedConceptData(db, name, mentionCount, type = 'concept') {
  // F-N102: published (private=0) so the seed surfaces under the vault filter.
  const entityId = db.prepare(`
    INSERT INTO entities (name, type, first_seen, last_seen, mention_count, private)
    VALUES (?, ?, '2026-01-01T00:00:00Z', '2026-05-22T00:00:00Z', ?, 0)
  `).run(name, type, mentionCount).lastInsertRowid;

  // Add mentions
  for (let i = 0; i < mentionCount; i++) {
    db.prepare(`
      INSERT INTO mentions (entity_id, session_id, salience, created_at)
      VALUES (?, ?, 0.7, '2026-05-${String(i + 1).padStart(2, '0')}T00:00:00Z')
    `).run(entityId, `session-${i}`);
  }

  return entityId;
}

// ── Tests ────────────────────────────────────────────────

describe('sharedConceptsDir', () => {
  const saved = { cfg: process.env.OPENCLAW_OBSIDIAN_SYNC_CONFIG, ws: process.env.OPENCLAW_WORKSPACE };
  let dir;
  before(async () => { dir = await mkdtemp(join(tmpdir(), 'promoter-cfg-')); });
  after(async () => {
    for (const [k, v] of [['OPENCLAW_OBSIDIAN_SYNC_CONFIG', saved.cfg], ['OPENCLAW_WORKSPACE', saved.ws]]) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
    await rm(dir, { recursive: true, force: true });
  });

  it('is concepts-shared/ in the vault root obsidian-sync.json names (workspace-relative or absolute)', async () => {
    const cfg = join(dir, 'obsidian-sync.json');
    process.env.OPENCLAW_OBSIDIAN_SYNC_CONFIG = cfg;
    process.env.OPENCLAW_WORKSPACE = join(dir, 'ws');
    await writeFile(cfg, JSON.stringify({ vaultPath: 'projects/my-vault' }));
    assert.equal(sharedConceptsDir(), join(dir, 'ws', 'projects', 'my-vault', 'concepts-shared'));
    await writeFile(cfg, JSON.stringify({ vaultPath: '/srv/vault' }));
    assert.equal(sharedConceptsDir(), join('/srv/vault', 'concepts-shared'));
    await writeFile(cfg, '{}');
    assert.equal(sharedConceptsDir(), join(dir, 'ws', 'projects', 'arcane-vault', 'concepts-shared'));
  });
});

describe('buildPromotedFrontmatter', () => {
  it('includes standard concept fields plus provenance fields', () => {
    const entity = {
      name: 'NATS JetStream',
      type: 'technology',
      first_seen: '2026-01-01T00:00:00Z',
      last_seen: '2026-05-22T00:00:00Z',
      mention_count: 15,
    };
    const fm = buildPromotedFrontmatter(entity, 'test-node', ['Ollama', 'SQLite'], 0.82);

    assert.ok(fm.startsWith('---'));
    assert.ok(fm.endsWith('---'));
    assert.ok(fm.includes('type: concept'));
    assert.ok(fm.includes('entity_type: technology'));
    assert.ok(fm.includes('mention_count: 15'));
    assert.ok(fm.includes('salience: 0.82'));
    // Quoted slug links: bare [[X]] in a YAML flow list parses as nested arrays.
    const parsed = yaml.load(fm.slice(4, -4));
    assert.deepEqual(parsed.related, ['[[ollama|Ollama]]', '[[sqlite|SQLite]]']);
    assert.equal(parsed.source_node, 'test-node');
    // Provenance fields
    assert.ok(fm.includes('source_node: test-node'));
    assert.ok(fm.includes('original_path:'));
    assert.ok(fm.includes('promoted_at:'));
    assert.ok(fm.includes('nats-jetstream.md'));
  });

  it('keeps a newline in a name or node id from forging frontmatter keys', () => {
    const entity = { name: 'X', type: 'tech\nprivate: false', first_seen: 'a', last_seen: 'b', mention_count: 11 };
    const fm = buildPromotedFrontmatter(entity, 'n1\nforged', ['Y\nZ']);
    assert.doesNotMatch(fm, /^private:/m);
    assert.match(fm, /^entity_type: tech private: false$/m);
    assert.match(fm, /^source_node: n1 forged$/m);
  });
});

describe('queryPromotableConcepts', () => {
  it('returns only entities meeting the threshold', () => {
    const db = createTestDb();
    seedConceptData(db, 'HighMention', 12);
    seedConceptData(db, 'LowMention', 3);
    seedConceptData(db, 'Borderline', 10);

    const results = queryPromotableConcepts(db, 10);
    const names = results.map(r => r.entity.name);

    assert.ok(names.includes('HighMention'));
    assert.ok(names.includes('Borderline'));
    assert.ok(!names.includes('LowMention'));
    assert.equal(results.length, 2);
    db.close();
  });

  it('leaves out private entities and private co-mentions (the shared dir is cross-node)', () => {
    const db = createTestDb();
    seedConceptData(db, 'Public', 12);
    const secret = seedConceptData(db, 'Secret', 12);
    db.prepare('UPDATE entities SET private = 1 WHERE id = ?').run(secret);
    db.prepare(`INSERT INTO decisions (decision, session_id, private) VALUES ('private call', 'session-0', 1)`).run();
    db.prepare(`INSERT INTO decisions (decision, session_id, private) VALUES ('public call', 'session-0', 0)`).run();

    const results = queryPromotableConcepts(db, 10);
    assert.deepEqual(results.map(r => r.entity.name), ['Public']);
    assert.deepEqual(results[0].relatedEntities, []);
    assert.deepEqual(results[0].decisions.map(d => d.decision), ['public call']);
    db.close();
  });
});

describe('promoteConceptNotes', () => {
  let tmpDir;
  let vaultDir;

  before(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'promoter-test-'));
    vaultDir = join(tmpDir, 'concepts-shared');
  });

  after(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('writes qualifying concepts to the shared directory', async () => {
    const db = createTestDb();
    seedConceptData(db, 'Spreading Activation', 15);
    seedConceptData(db, 'Wikilinks', 12);
    seedConceptData(db, 'Below Threshold', 5);

    const policy = {
      automatic: ['kanban_events'],
      explicit: ['share_true'],
      threshold: { concept_mention_count: 10, decision_confidence: 0.95 },
      manual_review: ['everything_else'],
    };

    const result = await promoteConceptNotes({
      db,
      sharedDir: vaultDir,
      policy,
      nodeId: 'test-node',
    });

    assert.equal(result.promoted, 2);
    assert.ok(result.notes.includes('spreading-activation.md'));
    assert.ok(result.notes.includes('wikilinks.md'));

    // Verify files exist on disk
    const files = await readdir(vaultDir);
    assert.ok(files.includes('spreading-activation.md'));
    assert.ok(files.includes('wikilinks.md'));
    assert.ok(!files.includes('below-threshold.md'));

    db.close();
  });

  it('includes provenance frontmatter in written notes', async () => {
    const db = createTestDb();
    seedConceptData(db, 'ProvenanceTest', 11);

    const sharedDir2 = join(tmpDir, 'provenance-test');
    const policy = {
      automatic: ['kanban_events'],
      explicit: ['share_true'],
      threshold: { concept_mention_count: 10, decision_confidence: 0.95 },
      manual_review: ['everything_else'],
    };

    await promoteConceptNotes({
      db,
      sharedDir: sharedDir2,
      policy,
      nodeId: 'prov-node',
    });

    const content = await readFile(join(sharedDir2, 'provenancetest.md'), 'utf-8');
    assert.ok(content.includes('source_node: prov-node'));
    assert.ok(content.includes('original_path:'));
    assert.ok(content.includes('promoted_at:'));
    assert.ok(content.includes('type: concept'));

    db.close();
  });

  it('returns zero notes for an empty extraction store', async () => {
    const db = createTestDb();
    const sharedDir3 = join(tmpDir, 'empty-test');
    const policy = {
      automatic: ['kanban_events'],
      explicit: ['share_true'],
      threshold: { concept_mention_count: 10, decision_confidence: 0.95 },
      manual_review: ['everything_else'],
    };

    const result = await promoteConceptNotes({
      db,
      sharedDir: sharedDir3,
      policy,
      nodeId: 'test-node',
    });

    assert.equal(result.promoted, 0);
    assert.deepEqual(result.notes, []);

    db.close();
  });

  it('is idempotent — an unchanged concept is skipped, not rewritten (R8, repair 2.3)', async () => {
    const db = createTestDb();
    seedConceptData(db, 'IdempotentConcept', 15);

    const sharedDir4 = join(tmpDir, 'idempotent-test');
    const policy = {
      automatic: ['kanban_events'],
      explicit: ['share_true'],
      threshold: { concept_mention_count: 10, decision_confidence: 0.95 },
      manual_review: ['everything_else'],
    };

    const r1 = await promoteConceptNotes({ db, sharedDir: sharedDir4, policy, nodeId: 'n1' });
    assert.equal(r1.promoted, 1);

    const files = await readdir(sharedDir4);
    assert.equal(files.length, 1);
    const notePath = join(sharedDir4, files[0]);
    const mtimeBefore = (await stat(notePath)).mtimeMs;

    const r2 = await promoteConceptNotes({ db, sharedDir: sharedDir4, policy, nodeId: 'n1' });
    assert.equal(r2.promoted, 0, 'unchanged note must not be rewritten');
    assert.deepEqual(r2.skipped, files);
    assert.equal((await stat(notePath)).mtimeMs, mtimeBefore, 'file must be untouched');

    db.close();
  });

  it('a changed concept rewrites exactly its own note', async () => {
    const db = createTestDb();
    seedConceptData(db, 'StableConcept', 15);
    seedConceptData(db, 'GrowingConcept', 15);

    const sharedDir5 = join(tmpDir, 'changed-test');
    const policy = {
      automatic: ['kanban_events'],
      explicit: ['share_true'],
      threshold: { concept_mention_count: 10, decision_confidence: 0.95 },
      manual_review: ['everything_else'],
    };

    await promoteConceptNotes({ db, sharedDir: sharedDir5, policy, nodeId: 'n1' });
    db.exec(`UPDATE entities SET mention_count = mention_count + 1 WHERE name = 'GrowingConcept'`);

    const r2 = await promoteConceptNotes({ db, sharedDir: sharedDir5, policy, nodeId: 'n1' });
    assert.deepEqual(r2.notes, ['growingconcept.md']);
    assert.deepEqual(r2.skipped, ['stableconcept.md']);

    db.close();
  });

  it('asks the LLM for a summary only for a new or changed note', async () => {
    const db = createTestDb();
    seedConceptData(db, 'Summarized', 15);
    seedConceptData(db, 'Other', 15);
    const sharedDir = join(tmpDir, 'llm-test');
    const policy = { threshold: { concept_mention_count: 10 } };
    const asked = [];
    const client = {
      async generate(messages) {
        asked.push(messages[1].content.match(/^Concept: (.*)$/m)[1]);
        return { content: 'A concept summary that is long enough.' };
      },
    };

    await promoteConceptNotes({ db, client, sharedDir, policy, nodeId: 'n1' });
    assert.deepEqual(asked.sort(), ['Other', 'Summarized']);
    assert.match(await readFile(join(sharedDir, 'summarized.md'), 'utf-8'), /A concept summary that is long enough\./);

    asked.length = 0;
    const r2 = await promoteConceptNotes({ db, client, sharedDir, policy, nodeId: 'n1' });
    assert.deepEqual(asked, [], 'unchanged notes must not cost an LLM call');
    assert.equal(r2.promoted, 0);

    db.exec(`UPDATE entities SET mention_count = mention_count + 1 WHERE name = 'Summarized'`);
    const r3 = await promoteConceptNotes({ db, client, sharedDir, policy, nodeId: 'n1' });
    assert.deepEqual(asked, ['Summarized']);
    assert.deepEqual(r3.notes, ['summarized.md']);
    db.close();
  });

  it('slug collisions resolve deterministically — highest mention_count wins, collision reported', async () => {
    const db = createTestDb();
    seedConceptData(db, 'Collide Case', 20);
    seedConceptData(db, 'collide-case', 12);

    const sharedDir6 = join(tmpDir, 'collision-test');
    const policy = {
      automatic: ['kanban_events'],
      explicit: ['share_true'],
      threshold: { concept_mention_count: 10, decision_confidence: 0.95 },
      manual_review: ['everything_else'],
    };

    const r1 = await promoteConceptNotes({ db, sharedDir: sharedDir6, policy, nodeId: 'n1' });
    assert.deepEqual(r1.notes, ['collide-case.md']);
    assert.deepEqual(r1.collisions, [{ filename: 'collide-case.md', entity: 'collide-case' }]);

    const note = await readFile(join(sharedDir6, 'collide-case.md'), 'utf-8');
    assert.match(note, /mention_count: 20/, 'the higher-mention entity must own the slug');

    const r2 = await promoteConceptNotes({ db, sharedDir: sharedDir6, policy, nodeId: 'n1' });
    assert.equal(r2.promoted, 0, 'collision must not cause ping-pong rewrites');

    db.close();
  });
});
