/**
 * obsidian-promoter.mjs — Promote selected concepts to the shared vault.
 *
 * Queries the extraction store for non-private entities meeting the promotion
 * policy's concept_mention_count threshold, generates concept notes with
 * provenance frontmatter, and writes them to concepts-shared/ in the Obsidian
 * vault root (obsidian-sync.json vaultPath).
 *
 * The shared dir is a cross-node surface, so unlike the local vault writers
 * (transparent by default, repair D7) it filters private entities and
 * decisions.
 *
 * Depends on:
 *   - lib/obsidian-summarizer.mjs (queryConceptData, slugifyName, buildConceptFrontmatter, buildConceptBody)
 *   - lib/promotion-policy.mjs (loadPromotionPolicy)
 *   - lib/obsidian-vault.mjs (getVaultPath, getObsidianVaultRoot)
 */

import { join } from 'node:path';
import { mkdir, readFile } from 'node:fs/promises';
import { hostname } from 'node:os';
import { atomicWriteFileSync } from './atomic-write.mjs';
import {
  queryConceptData, slugifyName, yamlSafe, buildConceptFrontmatter, buildConceptBody,
  generateConceptSummary, extractExistingSummary,
} from './obsidian-summarizer.mjs';
import { loadPromotionPolicy } from './promotion-policy.mjs';
import { getVaultPath, getObsidianVaultRoot } from './obsidian-vault.mjs';

/** Shared concepts directory: concepts-shared/ in the configured Obsidian vault root. */
export function sharedConceptsDir() {
  return join(getObsidianVaultRoot(), 'concepts-shared');
}

/**
 * Resolve the node ID from env or hostname.
 * Consistent with the rest of the codebase.
 *
 * @returns {string}
 */
export function getNodeId() {
  return process.env.OPENCLAW_NODE_ID || hostname();
}

/**
 * Build YAML frontmatter for a promoted concept note.
 * Includes standard concept fields plus provenance fields per Block 5 §0.
 *
 * @param {object} entity — entity row from extraction store
 * @param {string} nodeId — source node identifier
 * @param {string[]} relatedEntities — names of co-mentioned entities
 * @param {number} [avgSalience] — average salience across mentions
 * @param {{ resolvableSlugs?: Set<string> }} [opts] — related links only to these slugs
 * @returns {string} YAML frontmatter block (including --- delimiters)
 */
export function buildPromotedFrontmatter(entity, nodeId, relatedEntities = [], avgSalience, opts = {}) {
  // The local concept frontmatter (quoted slug wikilinks, yamlSafe fields),
  // with the Block 5 §0 provenance fields before the closing fence.
  const base = buildConceptFrontmatter(entity, relatedEntities, avgSalience, opts);
  const slug = slugifyName(entity.name);
  const provenance = [
    `source_node: ${yamlSafe(nodeId, 100)}`,
    `original_path: ${yamlSafe(`${getVaultPath()}/concepts/${slug}.md`, 400)}`,
    `promoted_at: ${new Date().toISOString()}`,
  ];
  return `${base.slice(0, -'---'.length)}${provenance.join('\n')}\n---`;
}

/**
 * Query the extraction store for concepts meeting the promotion threshold.
 * Reuses queryConceptData from obsidian-summarizer with the policy threshold.
 *
 * @param {object} db — better-sqlite3 database instance
 * @param {number} threshold — minimum mention_count for promotion
 * @returns {Array<object>} concept data objects (same shape as queryConceptData)
 */
export function queryPromotableConcepts(db, threshold) {
  return queryConceptData(db, threshold, { respectPrivacy: true });
}

/**
 * Promote qualifying concepts to the shared vault directory.
 *
 * @param {object} opts
 * @param {object} opts.db — better-sqlite3 database instance (extraction store)
 * @param {object} [opts.client] — LLM client (null = data-only body)
 * @param {string} [opts.sharedDir] — shared concepts directory override
 * @param {object} [opts.policy] — pre-loaded policy (skips file read if provided)
 * @param {string} [opts.nodeId] — node ID override
 * @returns {Promise<{ promoted: number, sharedDir: string, notes: string[], skipped: string[], collisions: Array<{filename: string, entity: string}> }>}
 */
export async function promoteConceptNotes(opts) {
  const { db, client = null } = opts;
  const sharedDir = opts.sharedDir || sharedConceptsDir();
  const nodeId = opts.nodeId || getNodeId();

  // Load policy to get the promotion threshold
  let policy;
  if (opts.policy) {
    policy = opts.policy;
  } else {
    policy = await loadPromotionPolicy();
  }

  const threshold = policy.threshold?.concept_mention_count ?? 10;

  // Ensure shared directory exists
  await mkdir(sharedDir, { recursive: true });

  // Query concepts meeting the promotion threshold
  const conceptData = queryPromotableConcepts(db, threshold);
  const notes = [];
  const skipped = [];
  const collisions = [];

  // R8 fix (repair 2.3): promoted_at changes every run, so change detection
  // must compare content without it — otherwise every note always "changed".
  const stripVolatile = (s) => s.replace(/^promoted_at: .*$/m, '');
  // Distinct entities can slugify to one filename (e.g. "OpenClaw" vs
  // "openclaw" — extraction-normalization duplicates). First wins (the list
  // is mention_count DESC) so output is deterministic instead of ping-pong
  // overwrites. The duplication itself is a separate captured defect.
  const claimedSlugs = new Set();
  // Related links only to notes this run promotes: anything else would dangle in the shared dir.
  const resolvableSlugs = new Set(conceptData.map(d => slugifyName(d.entity.name)));

  for (const data of conceptData) {
    const { entity, avgSalience, relatedEntities, mentions, decisions, recentSessions } = data;

    const filename = `${slugifyName(entity.name)}.md`;
    if (claimedSlugs.has(filename)) {
      collisions.push({ filename, entity: entity.name });
      continue;
    }
    claimedSlugs.add(filename);

    const frontmatter = buildPromotedFrontmatter(entity, nodeId, relatedEntities, avgSalience, { resolvableSlugs });
    const compose = summary => `${frontmatter}\n\n${buildConceptBody(entity.name, { summary, decisions, recentSessions })}`;

    // R8 fix (repair 2.3): write only new/changed notes. The comparison reuses
    // the note's own summary, so an unchanged concept never costs an LLM call;
    // one is requested only for a new note, changed data, or a note still
    // carrying the placeholder.
    const filePath = join(sharedDir, filename);
    let existing = null;
    try { existing = await readFile(filePath, 'utf-8'); } catch { /* new note */ }
    const existingSummary = extractExistingSummary(existing);
    if (existing !== null && existingSummary !== null
        && stripVolatile(existing) === stripVolatile(compose(existingSummary))) {
      skipped.push(filename);
      continue;
    }
    const summary = (await generateConceptSummary(client, entity.name, mentions)) ?? existingSummary;
    const noteContent = compose(summary);
    if (existing !== null && stripVolatile(existing) === stripVolatile(noteContent)) {
      skipped.push(filename);
      continue;
    }
    atomicWriteFileSync(filePath, noteContent);

    notes.push(filename);
  }

  return { promoted: notes.length, sharedDir, notes, skipped, collisions };
}
