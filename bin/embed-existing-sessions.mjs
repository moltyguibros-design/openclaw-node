#!/usr/bin/env node
/**
 * bin/embed-existing-sessions.mjs — One-time migration: embed all sessions
 *
 * Reads sessions from the session-store SQLite database, chunks their turns,
 * and indexes embeddings into the mcp-knowledge database via indexSessionTurns().
 *
 * Resumable: tracks progress in a checkpoint file; sessions already in the
 * checkpoint are skipped. Later growth is indexed by the daemon's knowledge-index-job.
 *
 * Usage:
 *   node bin/embed-existing-sessions.mjs
 *   node bin/embed-existing-sessions.mjs --session-db ~/.openclaw/state.db
 *   node bin/embed-existing-sessions.mjs --knowledge-db ~/.openclaw/workspace/.knowledge.db
 */

import { openStore } from '../lib/sqlite-store.mjs';
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import { initDatabase, indexSessionTurns } from '../lib/mcp-knowledge/core.mjs';
import { atomicWriteFileSync } from '../lib/atomic-write.mjs';

// ─── Defaults ────────────────────────────────────────────────────────────────

const DEFAULT_SESSION_DB = join(homedir(), '.openclaw/state.db');
export const DEFAULT_KNOWLEDGE_DB = process.env.KNOWLEDGE_DB
  || join(process.env.KNOWLEDGE_ROOT || join(homedir(), '.openclaw/workspace'), '.knowledge.db');
const DEFAULT_CHECKPOINT = join(homedir(), '.openclaw/.embed-migration-checkpoint.json');

// ─── Checkpoint helpers ──────────────────────────────────────────────────────

function loadCheckpoint(path) {
  if (!existsSync(path)) return { completed: [], totalChunks: 0, startedAt: null };
  try {
    const raw = JSON.parse(readFileSync(path, 'utf-8'));
    return {
      completed: raw.completed || [],
      totalChunks: raw.totalChunks || 0,
      startedAt: raw.startedAt || null,
    };
  } catch {
    return { completed: [], totalChunks: 0, startedAt: null };
  }
}

// Atomic: an interrupted write used to leave a torn checkpoint, which
// loadCheckpoint reads as empty and the migration restarts from zero.
export function saveCheckpoint(path, checkpoint) {
  atomicWriteFileSync(path, JSON.stringify({
    completed: checkpoint.completed,
    totalChunks: checkpoint.totalChunks,
    startedAt: checkpoint.startedAt,
    lastUpdated: new Date().toISOString(),
  }, null, 2) + '\n', { mkdirp: true });
}

// ─── Migration core ──────────────────────────────────────────────────────────

/**
 * Run the embedding migration.
 *
 * @param {Object} opts
 * @param {string} opts.sessionDbPath - Path to session-store SQLite DB
 * @param {string} opts.knowledgeDbPath - Path to knowledge SQLite DB
 * @param {string} opts.checkpointPath - Path to checkpoint JSON file
 * @returns {Promise<{processed: number, skipped: number, chunks: number, total: number}>}
 */
export async function runMigration(opts = {}) {
  const {
    sessionDbPath = DEFAULT_SESSION_DB,
    knowledgeDbPath = DEFAULT_KNOWLEDGE_DB,
    checkpointPath = DEFAULT_CHECKPOINT,
  } = opts;

  // Open session store (read-only)
  if (!existsSync(sessionDbPath)) {
    process.stderr.write(`[embed-migration] session store not found: ${sessionDbPath}\n`);
    return { processed: 0, skipped: 0, chunks: 0, total: 0 };
  }
  const sessionDb = openStore(sessionDbPath, { readonly: true });

  // Open knowledge DB (read-write, creates tables if needed)
  const knowledgeDb = initDatabase(knowledgeDbPath);

  // Load checkpoint
  const checkpoint = loadCheckpoint(checkpointPath);
  if (!checkpoint.startedAt) checkpoint.startedAt = new Date().toISOString();
  const completedSet = new Set(checkpoint.completed);

  // Query all sessions
  const sessions = sessionDb.prepare(
    'SELECT id, source, start_time, message_count FROM sessions ORDER BY start_time ASC'
  ).all();
  const total = sessions.length;

  process.stderr.write(`[embed-migration] found ${total} sessions in session store\n`);
  process.stderr.write(`[embed-migration] checkpoint has ${completedSet.size} already completed\n`);

  let processed = 0;
  let skipped = 0;
  let chunksThisRun = 0;
  let stopped = false;

  // Graceful SIGINT handling
  const onSigint = () => { stopped = true; };
  process.on('SIGINT', onSigint);

  try {
    for (let i = 0; i < sessions.length; i++) {
      if (stopped) {
        process.stderr.write(`[embed-migration] SIGINT received, stopping gracefully\n`);
        break;
      }

      const session = sessions[i];

      // Skip if already in checkpoint
      if (completedSet.has(session.id)) {
        skipped++;
        continue;
      }

      // Get messages for this session
      const messages = sessionDb.prepare(
        'SELECT role, content FROM messages WHERE session_id = ? ORDER BY turn_index ASC'
      ).all(session.id);

      // Skip sessions with no messages
      if (messages.length === 0) {
        completedSet.add(session.id);
        checkpoint.completed.push(session.id);
        skipped++;
        saveCheckpoint(checkpointPath, checkpoint);
        continue;
      }

      // Form turns array
      const turns = messages.map(m => ({ role: m.role, content: m.content }));

      // Index into knowledge DB
      const result = await indexSessionTurns(knowledgeDb, session.id, `session-store://${session.id}`, turns);

      processed++;
      if (result.indexed) {
        chunksThisRun += result.chunks;
        checkpoint.totalChunks += result.chunks;
      }

      // Update checkpoint after each session
      completedSet.add(session.id);
      checkpoint.completed.push(session.id);
      saveCheckpoint(checkpointPath, checkpoint);

      // Progress report every 10 sessions
      if (processed % 10 === 0) {
        process.stderr.write(
          `[embed-migration] progress: ${processed + skipped}/${total} (${processed} indexed, ${skipped} skipped)\n`
        );
      }
    }
  } finally {
    process.removeListener('SIGINT', onSigint);
    sessionDb.close();
    knowledgeDb.close();
  }

  process.stderr.write(
    `[embed-migration] done: ${processed} indexed, ${skipped} skipped, ${chunksThisRun} chunks created\n`
  );

  return { processed, skipped, chunks: chunksThisRun, total };
}

// ─── CLI entry point ─────────────────────────────────────────────────────────

// Other CLIs import DEFAULT_KNOWLEDGE_DB from here. Compare real paths: Node
// resolves symlinks in the main module's URL (and percent-encodes spaces) but
// keeps argv[1] as given.
function isEntrypoint() {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false; // argv[1] is not a path, e.g. `node -e '…' arg`
  }
}

if (isEntrypoint()) {
  const { values } = parseArgs({
    options: {
      'session-db': { type: 'string', default: DEFAULT_SESSION_DB },
      'knowledge-db': { type: 'string', default: DEFAULT_KNOWLEDGE_DB },
      'checkpoint': { type: 'string', default: DEFAULT_CHECKPOINT },
    },
  });

  runMigration({
    sessionDbPath: values['session-db'],
    knowledgeDbPath: values['knowledge-db'],
    checkpointPath: values['checkpoint'],
  }).catch(err => {
    process.stderr.write(`[embed-migration] fatal: ${err.message}\n`);
    process.exit(1);
  });
}
