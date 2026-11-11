import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import Database from 'better-sqlite3';
import { checkVaultLinks, checkReferentialCoverage } from '../lib/obsidian-link-checker.mjs';

describe('checkVaultLinks', () => {
  let vault;

  before(async () => {
    vault = await mkdtemp(join(tmpdir(), 'vault-check-'));
    await mkdir(join(vault, 'concepts'), { recursive: true });
    await mkdir(join(vault, 'sessions'), { recursive: true });

    await writeFile(join(vault, 'concepts', 'alpha.md'),
      '---\ntype: concept\n---\n# Alpha\nLinks: [[Beta Note]], [[Ghost Entity]], [[gamma-prime]] and [[Gamma Display|shown]]');
    await writeFile(join(vault, 'concepts', 'beta-note.md'),
      '---\ntype: concept\n---\n# Beta\nBack to [[alpha]].');
    await writeFile(join(vault, 'concepts', 'gamma-prime.md'),
      '---\ntype: concept\naliases: [Gamma Display, Gamma]\n---\n# Gamma\nNo outbound links.');
    await writeFile(join(vault, 'sessions', 'lonely-session.md'),
      '---\ntype: session\n---\n# Lonely\nPoints at [[alpha#heading]].');
  });

  after(async () => {
    await rm(vault, { recursive: true, force: true });
  });

  it('classifies exact, slug-resolvable, and dangling links', () => {
    const r = checkVaultLinks(vault);
    assert.equal(r.notes, 4);
    assert.equal(r.links, 6);
    // exact: [[gamma-prime]], [[Gamma Display|shown]] (alias), [[alpha]], [[alpha#heading]]
    assert.equal(r.resolved, 4);
    // slug-resolvable: [[Beta Note]] → beta-note.md
    assert.deepEqual(r.slugResolvable, [{ file: join('concepts', 'alpha.md'), target: 'Beta Note' }]);
    // dangling: [[Ghost Entity]]
    assert.deepEqual(r.dangling, [{ file: join('concepts', 'alpha.md'), target: 'Ghost Entity' }]);
  });

  it('reports orphans — notes with zero inbound links', () => {
    const r = checkVaultLinks(vault);
    assert.deepEqual(r.orphans, [join('sessions', 'lonely-session.md')]);
  });

  it('a seeded dangling link is detected by name and clears when removed', async () => {
    const seeded = join(vault, 'concepts', 'seeded.md');
    await writeFile(seeded, '# Seeded\n[[repair-2-4-seeded-dangling-target]]');
    const withSeed = checkVaultLinks(vault);
    assert.ok(withSeed.dangling.some((d) => d.target === 'repair-2-4-seeded-dangling-target'));

    await rm(seeded);
    const cleared = checkVaultLinks(vault);
    assert.ok(!cleared.dangling.some((d) => d.target === 'repair-2-4-seeded-dangling-target'));
  });

  it('missing vault path returns an empty report, not a throw', () => {
    const r = checkVaultLinks(join(vault, 'does-not-exist'));
    assert.equal(r.notes, 0);
    assert.equal(r.links, 0);
  });
});

describe('checkReferentialCoverage', () => {
  it('measures concept coverage, link resolution, and session linkage (repair 2.6)', async () => {
    const vault = await mkdtemp(join(tmpdir(), 'vault-cov-'));
    await mkdir(join(vault, 'concepts'), { recursive: true });
    await mkdir(join(vault, 'sessions'), { recursive: true });
    await writeFile(join(vault, 'concepts', 'covered-entity.md'), '# Covered\n[[Covered Entity]] self.');
    await writeFile(join(vault, 'sessions', 'linked-session.md'), '# S1\nTouched [[Covered Entity]].');
    await writeFile(join(vault, 'sessions', 'unlinked-session.md'), '# S2\nNo concept links here.');

    const db = new Database(':memory:');
    db.exec(`CREATE TABLE entities (id INTEGER PRIMARY KEY, name TEXT, mention_count INTEGER)`);
    db.exec(`CREATE TABLE decisions (id INTEGER PRIMARY KEY, session_id TEXT, decision TEXT, rationale TEXT, confidence REAL, created_at TEXT, salience REAL)`);
    db.exec(`CREATE TABLE themes (id INTEGER PRIMARY KEY, label TEXT, mention_count INTEGER)`);
    db.prepare(`INSERT INTO entities (name, mention_count) VALUES (?, ?)`).run('Covered Entity', 9);
    db.prepare(`INSERT INTO entities (name, mention_count) VALUES (?, ?)`).run('Missing Entity', 7);
    db.prepare(`INSERT INTO entities (name, mention_count) VALUES (?, ?)`).run('Below Threshold', 2);
    // Decay drives live decision salience far below the retired 0.4 gate; the
    // generator still writes these, so coverage must count them.
    const addDecision = db.prepare('INSERT INTO decisions (session_id, decision, rationale, confidence, created_at, salience) VALUES (?,?,?,?,?,?)');
    addDecision.run('s1', 'Decayed but real decision', 'r', 0.9, '2026-06-02T10:00:00Z', 0.02);
    addDecision.run('s1', 'Decayed and unwritten decision', 'r', 0.8, '2026-06-03T10:00:00Z', 0.01);
    addDecision.run('s1', 'Below the junk floor', 'r', 0.9, '2026-06-04T10:00:00Z', 0);
    await mkdir(join(vault, 'decisions'), { recursive: true });
    await writeFile(join(vault, 'decisions', '2026-06-02-decayed-but-real-decision.md'), '# D\n');

    const cov = checkReferentialCoverage({ db, vaultPath: vault, threshold: 5 });

    assert.deepEqual(cov.decisions, { eligible: 2, withNote: 1, pct: 50 });

    assert.equal(cov.concepts.eligible, 2);
    assert.equal(cov.concepts.withNote, 1);
    assert.equal(cov.concepts.pct, 50);
    assert.deepEqual(cov.concepts.missing, ['Missing Entity']);
    assert.equal(cov.sessions.notes, 2);
    assert.equal(cov.sessions.linkingConcepts, 1);
    assert.equal(cov.sessions.pct, 50);
    assert.equal(cov.links.total, 2);

    db.close();
    await rm(vault, { recursive: true, force: true });
  });
});
