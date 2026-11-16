/**
 * obsidian-graph.mjs — Wikilink graph parser for the Obsidian vault.
 *
 * Walks the vault directory, parses each markdown note's frontmatter and body,
 * extracts [[wikilinks]], and returns a {nodes, edges} graph structure.
 *
 * Node ids are vault-relative paths without .md (`concepts/nats`,
 * `themes/nats`): keyed by basename, a theme hub and a concept note with the
 * same slug collapsed into one node. conceptNodeId/themeNodeId give the id of
 * an entity's or a theme's note (retrieval channel 5 seeds and maps back).
 *
 * Depends on:
 *   - lib/obsidian-vault.mjs (vault path resolution)
 *   (normalizeLinkTarget inlines slugifyName's rule: obsidian-summarizer imports this module)
 *   - js-yaml (frontmatter parsing — existing dependency)
 */

import { join, relative, basename, extname, dirname, sep } from 'node:path';
import { readdir, readFile, stat } from 'node:fs/promises';
import yaml from 'js-yaml';
import { getVaultPath } from './obsidian-vault.mjs';

/** Graph node id of a vault-relative path: posix separators, no .md. */
export function noteIdFromRelPath(relPath) {
  return relPath.split(sep).join('/').replace(/\.md$/, '');
}

export const conceptNodeId = (slug) => `concepts/${slug}`;
export const themeNodeId = (slug) => `themes/${slug}`;

const noteName = (id) => id.slice(id.lastIndexOf('/') + 1);
const noteDir = (id) => (id.includes('/') ? id.slice(0, id.lastIndexOf('/')) : '');

/**
 * One of several notes a bare name could mean: the one in the linking note's
 * folder, else the shallowest path, else the first alphabetically.
 */
export function pickNote(candidates, fromId = '') {
  if (candidates.length === 1) return candidates[0];
  const here = candidates.find((c) => noteDir(c) === noteDir(fromId));
  if (here) return here;
  return [...candidates].sort((a, b) => a.split('/').length - b.split('/').length || (a < b ? -1 : 1))[0];
}

/** Lookup structure for normalizeLinkTarget: the ids, and the ids per note name. */
export function createNoteIndex(ids) {
  const byName = new Map();
  for (const id of ids) {
    const name = noteName(id);
    if (!byName.has(name)) byName.set(name, []);
    byName.get(name).push(id);
  }
  return { ids: new Set(ids), byName };
}

/**
 * Recursively walk a vault directory and return all .md file descriptors.
 *
 * @param {string} vaultPath — root vault directory
 * @returns {Promise<Array<{filePath: string, relativePath: string, id: string, name: string, subdirectory: string}>>}
 */
export async function walkVault(vaultPath) {
  const resolved = vaultPath || getVaultPath();
  const results = [];

  async function walk(dir) {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return; // directory doesn't exist or unreadable — skip
    }
    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
      } else if (entry.isFile() && extname(entry.name) === '.md') {
        const relPath = relative(resolved, fullPath);
        const subdir = relative(resolved, dirname(fullPath)) || '.';
        results.push({
          filePath: fullPath,
          relativePath: relPath,
          id: noteIdFromRelPath(relPath),
          name: basename(entry.name, '.md'),
          subdirectory: subdir,
        });
      }
    }
  }

  await walk(resolved);
  return results;
}

/**
 * Parse a markdown note into frontmatter and body.
 *
 * @param {string} content — raw file content
 * @returns {{ frontmatter: object|null, body: string }}
 */
export function parseNote(content) {
  const fmMatch = content.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!fmMatch) {
    return { frontmatter: null, body: content };
  }

  let frontmatter = null;
  try {
    frontmatter = yaml.load(fmMatch[1]);
  } catch {
    // Malformed YAML — treat as no frontmatter
  }

  return { frontmatter, body: fmMatch[2] };
}

/**
 * Extract all [[wikilink]] targets from text.
 * Handles both [[target]] and [[target|display text]] forms.
 *
 * @param {string} text
 * @returns {string[]} array of target strings (without display text)
 */
export function extractWikilinks(text) {
  const matches = [...text.matchAll(/\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g)];
  return matches.map(m => m[1].trim());
}

/**
 * Normalize a wikilink target to a graph node id (vault-relative path).
 * A path-style target ([[concepts/nats]]) names its note; a bare name, or a
 * display name ([[NATS JetStream]] → nats-jetstream), resolves by note name,
 * and pickNote breaks a tie between folders. Legacy display-name targets
 * left 42/105 cached edges permanently dangling (memory review 2026-07-04).
 *
 * @param {string} target
 * @param {{ids: Set<string>, byName: Map<string, string[]>}} index — createNoteIndex
 * @param {string} [fromId] — the linking note
 */
export function normalizeLinkTarget(target, index, fromId = '') {
  const path = target.replace(/\.md$/i, '');
  if (index.ids.has(path)) return path;
  const base = noteName(path);
  const slug = base
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  const candidates = index.byName.get(base) || index.byName.get(slug);
  if (candidates) return pickNote(candidates, fromId);
  return base; // dangling — keep for diagnostics
}

/** Flatten js-yaml's parse of legacy `related: [[[Name]], ...]` (nested arrays)
 *  and modern quoted strings into a flat list of link-bearing strings. */
function flattenRelated(related) {
  const out = [];
  const visit = (v) => {
    if (typeof v === 'string') out.push(v.includes('[[') ? v : `[[${v}]]`);
    else if (Array.isArray(v)) v.forEach(visit);
  };
  visit(related);
  return out;
}

/**
 * Determine edge type from frontmatter directives.
 * If frontmatter has an `edge_types` mapping (target → type), use it.
 * Otherwise default to 'mentions'.
 *
 * @param {object|null} frontmatter
 * @param {string} target — the wikilink target name
 * @returns {string} edge type
 */
function resolveEdgeType(frontmatter, target) {
  if (!frontmatter || !frontmatter.edge_types) return 'mentions';
  const mapping = frontmatter.edge_types;
  if (typeof mapping !== 'object') return 'mentions';
  // Look up target directly, or by lowercase match
  if (mapping[target]) return mapping[target];
  const lower = target.toLowerCase();
  for (const [key, val] of Object.entries(mapping)) {
    if (key.toLowerCase() === lower) return val;
  }
  return 'mentions';
}

/**
 * Build a graph from all markdown notes in the vault.
 *
 * @param {string} [vaultPath] — vault root (defaults via getVaultPath)
 * @returns {Promise<{nodes: Map<string, object>, edges: Array<{source: string, target: string, type: string}>}>}
 */
export async function buildGraph(vaultPath) {
  const resolved = vaultPath || getVaultPath();
  const notes = await walkVault(resolved);
  const nodes = new Map();
  const edges = [];

  const parsed = [];
  for (const note of notes) {
    const content = await readFile(note.filePath, 'utf-8');
    const { frontmatter, body } = parseNote(content);

    nodes.set(note.id, {
      label: note.name,
      subdirectory: note.subdirectory,
      ...(frontmatter || {}),
    });
    parsed.push({ note, frontmatter, body });
  }

  // Two passes: node ids must be complete before targets can normalize.
  const index = createNoteIndex([...nodes.keys()]);
  for (const { note, frontmatter, body } of parsed) {
    const seen = new Set();
    const addEdge = (rawTarget) => {
      const target = normalizeLinkTarget(rawTarget, index, note.id);
      if (target === note.id || seen.has(target)) return;
      seen.add(target);
      edges.push({ source: note.id, target, type: resolveEdgeType(frontmatter, rawTarget) });
    };

    for (const target of extractWikilinks(body)) addEdge(target);

    // Frontmatter `related`: flattened so legacy nested-array notes still
    // contribute edges (the strict typeof-string branch was dead code for
    // every real note — zero concept→concept edges).
    if (frontmatter && frontmatter.related != null) {
      for (const rel of flattenRelated(frontmatter.related)) {
        for (const target of extractWikilinks(rel)) addEdge(target);
      }
    }
  }

  return { nodes, edges };
}

/**
 * Per-node link degrees, the raw material for boundary scoring (frontier
 * detection ported from claude-obsidian's boundary-score: notes that link out
 * more than they are linked back to are the graph's growing edge).
 *
 * @param {{nodes: Map<string, object>, edges: Array<{source: string, target: string}>}} graph
 * @returns {Map<string, {out: number, in: number}>} keyed by node id. Edges to
 *   dangling targets still count toward the source's out-degree — an unwritten
 *   target is exactly what makes a note frontier.
 */
export function computeBoundaryDegrees(graph) {
  const degrees = new Map();
  for (const id of graph.nodes.keys()) degrees.set(id, { out: 0, in: 0 });
  for (const { source, target } of graph.edges) {
    const s = degrees.get(source);
    if (s) s.out++;
    const t = degrees.get(target);
    if (t) t.in++;
  }
  return degrees;
}
