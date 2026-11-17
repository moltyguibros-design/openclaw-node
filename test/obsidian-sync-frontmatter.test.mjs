import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import yaml from 'js-yaml';
import { injectFrontmatter } from '../workspace-bin/obsidian-sync.mjs';

const INJECTED = { title: 'Note', status: 'draft', tags: ['auto-synced', 'node-private'], source_node: 'n1' };

function frontmatterOf(out) {
  const m = out.match(/^---\n([\s\S]*?)\n---\n/);
  assert.ok(m, `no frontmatter in:\n${out}`);
  return { meta: yaml.load(m[1], { schema: yaml.JSON_SCHEMA }), raw: m[1], body: out.slice(m[0].length) };
}

describe('obsidian-sync injectFrontmatter', () => {
  it('keeps block-style lists and nested maps, and unions the injected tags', () => {
    const src = '---\ntags:\n  - coding\n  - style\nmeta:\n  source: clawvault\n  refs:\n    - a\n---\n# Body\n';
    const { meta, body } = frontmatterOf(injectFrontmatter(src, INJECTED));
    assert.deepEqual(meta.tags, ['coding', 'style', 'auto-synced', 'node-private']);
    assert.deepEqual(meta.meta, { source: 'clawvault', refs: ['a'] });
    assert.equal(meta.source, undefined);
    assert.equal(meta.title, 'Note');
    assert.equal(body, '# Body\n');
  });

  it('existing scalar fields win and dates stay strings', () => {
    const src = '---\ntitle: "Mine: v2"\ncreated: 2026-01-05\n---\nx\n';
    const { meta, raw } = frontmatterOf(injectFrontmatter(src, INJECTED));
    assert.equal(meta.title, 'Mine: v2');
    assert.equal(meta.created, '2026-01-05');
    assert.match(meta.updated, /^\d{4}-\d{2}-\d{2}$/);
    assert.doesNotMatch(raw, /T\d\d:\d\d/);
  });

  it('adds frontmatter to a file without one', () => {
    const { meta, body } = frontmatterOf(injectFrontmatter('plain\n', INJECTED));
    assert.deepEqual(meta.tags, ['auto-synced', 'node-private']);
    assert.equal(meta.created, meta.updated);
    assert.equal(body, 'plain\n');
  });

  it('unparseable frontmatter is kept verbatim and only missing keys are appended', () => {
    const src = '---\ntitle: kept\nbroken: [unclosed\n---\nbody\n';
    const out = injectFrontmatter(src, INJECTED);
    assert.ok(out.startsWith('---\ntitle: kept\nbroken: [unclosed\n'));
    assert.doesNotMatch(out, /\ntitle: Note/);
    assert.match(out, /\nsource_node: n1\n/);
    assert.ok(out.endsWith('\n---\nbody\n'));
  });
});
