#!/usr/bin/env node
/**
 * @openclaw/mcp-knowledge — model-backed test suite
 *
 * 7 groups that need the real embedder: embedding, indexing, semantic search,
 * findRelated, stats, the engine factory and the HTTP transport.
 * Manual local suite: it loads the real bge-m3 embedder (~2 GB download on
 * first run), so neither CI nor the root `npm test` runs it. The model-free
 * checks (scanner, chunkers, hashing, schema, sqlite-vec) live in the root
 * suite's test/mcp-knowledge-core.test.mjs. Run: node test.mjs
 */

import { readFileSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

import {
  initDatabase,
  embed,
  embedBatch,
  indexWorkspace,
  semanticSearch,
  findRelated,
  getStats,
  createKnowledgeEngine,
  EMBEDDING_DIM,
  MODEL_NAME,
  SNIPPET_LENGTH,
} from './core.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ─── Test Helpers ────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;
let currentGroup = '';

function group(name) {
  currentGroup = name;
  process.stdout.write(`\n=== ${name} ===\n`);
}

function ok(val, msg) {
  if (val) {
    passed++;
    process.stdout.write(`  PASS: ${msg}\n`);
  } else {
    failed++;
    process.stdout.write(`  FAIL: ${msg} [got falsy]\n`);
  }
}

function eq(actual, expected, msg) {
  if (actual === expected) {
    passed++;
    process.stdout.write(`  PASS: ${msg}\n`);
  } else {
    failed++;
    process.stdout.write(`  FAIL: ${msg} [expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}]\n`);
  }
}

function gt(a, b, msg) {
  if (a > b) {
    passed++;
    process.stdout.write(`  PASS: ${msg}\n`);
  } else {
    failed++;
    process.stdout.write(`  FAIL: ${msg} [expected ${a} > ${b}]\n`);
  }
}

function gte(a, b, msg) {
  if (a >= b) {
    passed++;
    process.stdout.write(`  PASS: ${msg}\n`);
  } else {
    failed++;
    process.stdout.write(`  FAIL: ${msg} [expected ${a} >= ${b}]\n`);
  }
}

function lt(a, b, msg) {
  if (a < b) {
    passed++;
    process.stdout.write(`  PASS: ${msg}\n`);
  } else {
    failed++;
    process.stdout.write(`  FAIL: ${msg} [expected ${a} < ${b}]\n`);
  }
}

// ─── Workspace Helpers ───────────────────────────────────────────────────────

function createTestWorkspace() {
  const dir = join(tmpdir(), `mcp-k-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const docsDir = join(dir, 'docs');
  mkdirSync(docsDir, { recursive: true });

  writeFileSync(join(docsDir, 'oracle.md'), `# Oracle Threat Model

## GPS Spoofing Attacks

The primary risk to biome-based gameplay is GPS spoofing. Players could fake their location to harvest mana from biomes they haven't physically visited.

## Mitigation Strategies

We use Nodle's DePIN network for location verification. The NodleLocationOracle contract cross-references device attestations with on-chain proofs.
`);

  writeFileSync(join(docsDir, 'factions.md'), `# Faction Lore

## The Verdant Pact

The Verdant Pact draws power from natural biomes — forests, rivers, mountains. Their mana harvesting is strongest in green zones.

## The Iron Syndicate

The Iron Syndicate operates in urban environments. Their technology-augmented spells work best near cell towers and data centers.
`);

  writeFileSync(join(docsDir, 'architecture.md'), `# Technical Architecture

## Smart Contract Stack

The core contracts are: ArcaneKernel (entry point), ManaWell (resource management), BiomeOracle (location verification), and NodeController (network governance).

## Mobile Client

The Unity-based mobile client handles AR rendering, GPS tracking, and wallet integration via WalletConnect.
`);

  // Non-md files that should be ignored
  writeFileSync(join(docsDir, 'data.json'), '{"key": "value"}');
  writeFileSync(join(docsDir, 'contract.sol'), 'pragma solidity ^0.8.0;');
  writeFileSync(join(docsDir, 'image.png'), 'fakepng');

  // Excluded file
  writeFileSync(join(dir, 'active-tasks.md'), '# Active Tasks\n\nstuff');

  return {
    dir,
    docsDir,
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}

// ─── Group 1: Embedding Pipeline ─────────────────────────────────────────────

async function testEmbedding() {
  group('1. Embedding Pipeline');

  process.stdout.write('  Loading model...\n');

  // Dimension
  const v1 = await embed('Hello world');
  eq(v1.length, EMBEDDING_DIM, `Output dimension is ${EMBEDDING_DIM}`);

  // Normalization
  let norm = 0;
  for (let i = 0; i < v1.length; i++) norm += v1[i] * v1[i];
  norm = Math.sqrt(norm);
  lt(Math.abs(norm - 1.0), 0.01, `Normalized (L2 norm=${norm.toFixed(4)})`);

  // Semantic similarity
  const vSimilar = await embed('Greetings planet');
  const vDifferent = await embed('Database schema migration');
  function cosine(a, b) {
    let d = 0;
    for (let i = 0; i < a.length; i++) d += a[i] * b[i];
    return d;
  }
  const simClose = cosine(v1, vSimilar);
  const simFar = cosine(v1, vDifferent);
  gt(simClose, simFar, `"Hello world" closer to "Greetings planet" (${simClose.toFixed(3)}) than "DB migration" (${simFar.toFixed(3)})`);

  // embedBatch count
  const batch = await embedBatch(['one', 'two', 'three']);
  eq(batch.length, 3, 'embedBatch returns correct count');

  // Truncation (long text doesn't crash)
  const longText = 'word '.repeat(2000);
  const vLong = await embed(longText);
  eq(vLong.length, EMBEDDING_DIM, 'Long text embedding succeeds (truncated)');
}

// ─── Group 2: Indexer ────────────────────────────────────────────────────────

async function testIndexer() {
  group('2. Indexer');

  // indexWorkspace scans the default INCLUDE_DIRS (memory/, SOUL.md, ...), not docs/.
  const ws2 = createTestWorkspace();
  const memDir = join(ws2.dir, 'memory');
  mkdirSync(memDir, { recursive: true });
  writeFileSync(join(memDir, 'day1.md'), '# Day 1\n\nBuilt the knowledge server.');
  writeFileSync(join(memDir, 'day2.md'), '# Day 2\n\nFixed sqlite-vec quirk.');
  writeFileSync(join(ws2.dir, 'SOUL.md'), '# Soul\n\nI am Daedalus.');

  const dbPath2 = join(ws2.dir, 'idx2.db');
  const db2 = initDatabase(dbPath2);

  const r2 = await indexWorkspace(db2, ws2.dir);
  gte(r2.indexed, 2, `Indexes new files (got ${r2.indexed})`);
  eq(r2.total, r2.indexed + r2.skipped, 'total = indexed + skipped');

  // Verify DB state
  const docCount = db2.prepare('SELECT COUNT(*) as c FROM documents').get().c;
  gte(docCount, 2, `Documents in DB after index (got ${docCount})`);
  const chunkCount = db2.prepare('SELECT COUNT(*) as c FROM chunks').get().c;
  const vecCount = db2.prepare('SELECT COUNT(*) as c FROM chunk_vectors').get().c;
  eq(chunkCount, vecCount, `Chunk count == vector count (${chunkCount} == ${vecCount})`);

  // --- Test: skips unchanged files ---
  const r3 = await indexWorkspace(db2, ws2.dir);
  eq(r3.indexed, 0, 'Second index skips unchanged files');
  eq(r3.skipped, r2.indexed, `Skipped count matches previous indexed (${r3.skipped})`);

  // --- Test: re-indexes changed files ---
  writeFileSync(join(memDir, 'day1.md'), '# Day 1 Updated\n\nCompletely new content for testing re-index.');
  const day1Chunks = () => db2.prepare("SELECT COUNT(*) as c FROM chunks WHERE doc_path = 'memory/day1.md'").get().c;
  const day1Before = day1Chunks();
  const pending4 = indexWorkspace(db2, ws2.dir);
  const day1During = day1Chunks();
  const r4 = await pending4;
  gte(day1Before, 1, `Changed doc had chunks before the re-index (got ${day1Before})`);
  eq(day1During, day1Before, 'Changed doc stays searchable while it re-embeds');
  gte(r4.indexed, 1, `Re-indexes changed file (got ${r4.indexed})`);
  const chunksAfter = db2.prepare('SELECT COUNT(*) as c FROM chunks').get().c;
  const vecsAfter = db2.prepare('SELECT COUNT(*) as c FROM chunk_vectors').get().c;
  eq(vecsAfter, chunksAfter, `No orphaned vectors after re-index (${vecsAfter} == ${chunksAfter})`);

  // --- Test: detects deleted files ---
  rmSync(join(memDir, 'day2.md'));
  const r5 = await indexWorkspace(db2, ws2.dir);
  gte(r5.deleted, 1, `Detects deleted file (got ${r5.deleted})`);

  // Verify deleted file's chunks are gone
  const deletedChunks = db2.prepare("SELECT COUNT(*) as c FROM chunks WHERE doc_path = 'memory/day2.md'").get().c;
  eq(deletedChunks, 0, 'Deleted file chunks removed from DB');

  // --- Test: force re-indexes everything ---
  const r6 = await indexWorkspace(db2, ws2.dir, { force: true });
  gte(r6.indexed, 1, `Force re-indexes all files (got ${r6.indexed})`);
  eq(r6.skipped, 0, 'Force mode skips nothing');

  // --- Test: last_index_time updated ---
  const meta = db2.prepare("SELECT value FROM meta WHERE key = 'last_index_time'").get();
  ok(meta && parseInt(meta.value) > 0, 'last_index_time updated in meta table');

  // --- Test: snippet generation ---
  const snippet = db2.prepare('SELECT snippet FROM chunks LIMIT 1').get();
  ok(snippet && snippet.snippet.length > 0, 'Snippets are generated');
  ok(snippet && snippet.snippet.length <= SNIPPET_LENGTH, `Snippet <= ${SNIPPET_LENGTH} chars`);
  ok(snippet && !snippet.snippet.includes('\n'), 'Snippet has no newlines');

  db2.close();
  ws2.cleanup();

  // --- Test: empty workspace ---
  const wsEmpty = { dir: join(tmpdir(), `mcp-k-empty-${Date.now()}`), cleanup: null };
  mkdirSync(wsEmpty.dir, { recursive: true });
  const dbEmpty = initDatabase(join(wsEmpty.dir, 'empty.db'));
  const rEmpty = await indexWorkspace(dbEmpty, wsEmpty.dir);
  eq(rEmpty.indexed, 0, 'Empty workspace → 0 indexed');
  eq(rEmpty.skipped, 0, 'Empty workspace → 0 skipped');
  dbEmpty.close();
  rmSync(wsEmpty.dir, { recursive: true, force: true });
}

// ─── Group 3: semanticSearch ─────────────────────────────────────────────────

async function testSearch() {
  group('3. Semantic Search');

  // Build indexed DB
  const ws = createTestWorkspace();
  const memDir = join(ws.dir, 'memory');
  mkdirSync(memDir, { recursive: true });
  writeFileSync(join(memDir, 'oracle.md'), readFileSync(join(ws.docsDir, 'oracle.md'), 'utf-8'));
  writeFileSync(join(memDir, 'factions.md'), readFileSync(join(ws.docsDir, 'factions.md'), 'utf-8'));
  writeFileSync(join(memDir, 'arch.md'), readFileSync(join(ws.docsDir, 'architecture.md'), 'utf-8'));

  const dbPath = join(ws.dir, 'search.db');
  const db = initDatabase(dbPath);
  await indexWorkspace(db, ws.dir);

  // Relevance ranking
  const r1 = await semanticSearch(db, 'GPS spoofing location attacks', 5);
  ok(r1.length > 0, 'Search returns results');
  eq(r1[0].path, 'memory/oracle.md', 'Top result for GPS spoofing is oracle.md');

  // Result shape
  ok(r1[0].path && r1[0].section && r1[0].snippet, 'Result has path, section, snippet');
  ok(typeof r1[0].score === 'number', 'Score is a number');
  ok(r1[0].score >= -1 && r1[0].score <= 1, `Score in valid range (got ${r1[0].score})`);

  // Limit parameter
  const r2 = await semanticSearch(db, 'any query', 2);
  ok(r2.length <= 2, `Limit=2 respected (got ${r2.length})`);

  // Empty index returns empty
  const emptyDb = initDatabase(':memory:');
  const rEmpty = await semanticSearch(emptyDb, 'test', 5);
  eq(rEmpty.length, 0, 'Empty index returns empty array');
  emptyDb.close();

  // Cross-domain query still returns results (top-K regardless)
  const r3 = await semanticSearch(db, 'quantum physics black holes', 5);
  ok(r3.length > 0, 'Unrelated query still returns top-K results');

  db.close();
  ws.cleanup();
}

// ─── Group 4: findRelated ────────────────────────────────────────────────────

async function testFindRelated() {
  group('4. findRelated');

  const ws = createTestWorkspace();
  const memDir = join(ws.dir, 'memory');
  mkdirSync(memDir, { recursive: true });
  writeFileSync(join(memDir, 'oracle.md'), readFileSync(join(ws.docsDir, 'oracle.md'), 'utf-8'));
  writeFileSync(join(memDir, 'factions.md'), readFileSync(join(ws.docsDir, 'factions.md'), 'utf-8'));
  writeFileSync(join(memDir, 'arch.md'), readFileSync(join(ws.docsDir, 'architecture.md'), 'utf-8'));

  const dbPath = join(ws.dir, 'related.db');
  const db = initDatabase(dbPath);
  await indexWorkspace(db, ws.dir);

  // Finds related docs (excludes self)
  const r1 = await findRelated(db, 'memory/oracle.md', 5);
  ok(Array.isArray(r1), 'Returns array');
  ok(r1.length > 0, 'Returns related documents');
  ok(!r1.some(r => r.path === 'memory/oracle.md'), 'Excludes self from results');

  // Non-existent doc
  const r2 = await findRelated(db, 'nonexistent.md', 5);
  ok(r2.error, 'Non-existent doc returns error object');

  // Deduplication (one entry per doc)
  const paths = r1.map(r => r.path);
  const uniquePaths = [...new Set(paths)];
  eq(paths.length, uniquePaths.length, 'Results deduplicated by document');

  // Limit respected
  const r3 = await findRelated(db, 'memory/oracle.md', 1);
  ok(r3.length <= 1, `Limit=1 respected (got ${r3.length})`);

  // Result shape
  if (r1.length > 0) {
    ok(r1[0].path && r1[0].section && r1[0].snippet, 'Result has path, section, snippet');
    ok(typeof r1[0].score === 'number', 'Score is a number');
  }

  db.close();
  ws.cleanup();
}

// ─── Group 5: getStats ──────────────────────────────────────────────────────

async function testGetStats() {
  group('5. getStats');

  const ws = createTestWorkspace();
  const memDir = join(ws.dir, 'memory');
  mkdirSync(memDir, { recursive: true });
  writeFileSync(join(memDir, 'test.md'), '# Test\n\nBody.');

  const dbPath = join(ws.dir, 'stats.db');
  const db = initDatabase(dbPath);
  await indexWorkspace(db, ws.dir);

  const stats = getStats(db);
  gte(stats.documents, 1, `Document count >= 1 (got ${stats.documents})`);
  gte(stats.chunks, 1, `Chunk count >= 1 (got ${stats.chunks})`);
  eq(stats.embedding_dim, EMBEDDING_DIM, 'Embedding dim matches');
  eq(stats.model, MODEL_NAME, 'Model name matches');
  ok(stats.last_indexed, 'last_indexed timestamp present');

  db.close();
  ws.cleanup();
}

// ─── Group 6: Engine Factory ────────────────────────────────────────────────

async function testEngine() {
  group('6. Engine Factory');

  const ws = createTestWorkspace();
  const memDir = join(ws.dir, 'memory');
  mkdirSync(memDir, { recursive: true });
  writeFileSync(join(memDir, 'engine-test.md'), '# Engine Test\n\nSemantic search engine testing document.');

  const dbPath = join(ws.dir, 'engine.db');
  const engine = await createKnowledgeEngine({
    workspace: ws.dir,
    dbPath,
  });

  // Interface check
  ok(typeof engine.search === 'function', 'engine.search is a function');
  ok(typeof engine.related === 'function', 'engine.related is a function');
  ok(typeof engine.reindex === 'function', 'engine.reindex is a function');
  ok(typeof engine.stats === 'function', 'engine.stats is a function');

  // Search through engine
  const results = await engine.search('engine testing', 5);
  ok(Array.isArray(results), 'engine.search returns array');

  // Stats through engine
  const stats = engine.stats();
  gte(stats.documents, 1, 'engine.stats shows indexed docs');

  // Reindex through engine
  const reResult = await engine.reindex(true);
  ok(typeof reResult.indexed === 'number', 'engine.reindex returns result object');

  engine.db.close();
  ws.cleanup();
}

// ─── Group 7: HTTP Transport ────────────────────────────────────────────────

async function testHttpTransport() {
  group('7. HTTP Transport');

  const ws = createTestWorkspace();
  const memDir = join(ws.dir, 'memory');
  mkdirSync(memDir, { recursive: true });
  writeFileSync(join(memDir, 'http-test.md'), '# HTTP Test\n\nDocument for HTTP transport testing.');

  const port = 3199 + Math.floor(Math.random() * 100);
  const dbPath = join(ws.dir, 'http.db');

  const serverProc = spawn('node', [join(__dirname, 'server.mjs')], {
    env: {
      ...process.env,
      KNOWLEDGE_ROOT: ws.dir,
      KNOWLEDGE_DB: dbPath,
      KNOWLEDGE_PORT: String(port),
      KNOWLEDGE_POLL_MS: '0',
    },
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  // Wait for readiness by watching stderr for the "listening" message
  let ready = false;
  let stderr = '';
  const readyPromise = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('HTTP server startup timeout (60s)')), 60000);
    serverProc.stderr.on('data', (data) => {
      stderr += data.toString();
      if (stderr.includes('HTTP MCP server listening')) {
        ready = true;
        clearTimeout(timeout);
        resolve();
      }
    });
    serverProc.on('exit', (code) => {
      if (!ready) {
        clearTimeout(timeout);
        reject(new Error(`Server exited with code ${code} before ready. stderr: ${stderr}`));
      }
    });
  });

  try {
    await readyPromise;

    // GET /health
    const healthRes = await fetch(`http://127.0.0.1:${port}/health`);
    const health = await healthRes.json();
    eq(healthRes.status, 200, 'GET /health returns 200');
    eq(health.status, 'ok', 'Health status is "ok"');
    ok(typeof health.uptime === 'number', 'Health has uptime field');

    // POST /mcp with initialize
    const mcpRes = await fetch(`http://127.0.0.1:${port}/mcp`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'text/event-stream, application/json',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'initialize',
        params: {
          protocolVersion: '2025-03-26',
          capabilities: {},
          clientInfo: { name: 'test', version: '0.1.0' },
        },
        id: 1,
      }),
    });
    eq(mcpRes.status, 200, 'POST /mcp initialize returns 200');
    const mcpBody = await mcpRes.text();
    ok(mcpBody.includes('@openclaw/mcp-knowledge'), 'MCP response contains server name');

    // GET /mcp → 405
    const getRes = await fetch(`http://127.0.0.1:${port}/mcp`);
    eq(getRes.status, 405, 'GET /mcp returns 405');

    // GET /unknown → 404
    const notFoundRes = await fetch(`http://127.0.0.1:${port}/unknown`);
    eq(notFoundRes.status, 404, 'GET /unknown returns 404');

    // MCP initialize response has tool capabilities
    ok(mcpBody.includes('"tools"'), 'Initialize response declares tool capabilities');

    // DELETE /mcp → 405
    const delRes = await fetch(`http://127.0.0.1:${port}/mcp`, { method: 'DELETE' });
    eq(delRes.status, 405, 'DELETE /mcp returns 405');

  } finally {
    serverProc.kill('SIGTERM');
    ws.cleanup();
  }
}

// ─── Run All ─────────────────────────────────────────────────────────────────

async function main() {
  process.stdout.write('╔══════════════════════════════════════════════════╗\n');
  process.stdout.write('║  @openclaw/mcp-knowledge — model-backed suite    ║\n');
  process.stdout.write('╚══════════════════════════════════════════════════╝\n');

  await testEmbedding();
  await testIndexer();
  await testSearch();
  await testFindRelated();
  await testGetStats();
  await testEngine();
  await testHttpTransport();

  process.stdout.write(`\n${'═'.repeat(50)}\n`);
  process.stdout.write(`Results: ${passed} passed, ${failed} failed\n`);
  process.stdout.write(`${'═'.repeat(50)}\n`);
  setTimeout(() => process.exit(failed > 0 ? 1 : 0), 200);
}

main().catch(err => {
  process.stderr.write(`Test error: ${err.message}\n${err.stack}\n`);
  process.exit(1);
});
