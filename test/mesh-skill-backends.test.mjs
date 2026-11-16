/**
 * mesh-skill-backends.test.mjs — the mesh skill and the heartbeat only drive
 * commands that have a live backend.
 *
 * The retired ~/openclaw/agent.js (2026-10-02) was the only responder for
 * openclaw.<node>.exec/.capture/.heartbeat and openclaw.broadcast, mesh-health.sh
 * and mesh-repair.sh never existed in this repo, nothing synced
 * ~/openclaw/shared/, and no `mesh` binary is installed. The skill still
 * advertised all of it and every heartbeat ran `mesh health`, so the agent
 * reported mesh outages that were not real. `mesh status` and `mesh health` stay:
 * they read the MESH_NODE_HEALTH KV every node's health publisher writes.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');
const MESH = read('bin/mesh.js');
const SKILL = read('skills/mesh/SKILL.md');
const HEARTBEAT = read('identity/HEARTBEAT.md');
const RETIRED = ['exec', 'capture', 'ls', 'put', 'broadcast', 'repair'];

const dispatched = new Set([...MESH.matchAll(/case '([a-z-]+)':\s+return cmd(?!Help)/g)].map((m) => m[1]));

test('bin/mesh.js dispatches only commands with a live backend', () => {
  assert.deepEqual([...dispatched].sort(), ['deploy', 'health', 'plan', 'status', 'submit', 'tasks']);
  for (const sub of RETIRED) assert.ok(!dispatched.has(sub), `mesh ${sub} has no backend`);
  assert.doesNotMatch(MESH, /openclaw\.\$\{|openclaw\.broadcast|openclaw\.\*\.heartbeat|install-mesh-skill/);
  const r = spawnSync(process.execPath, [join(ROOT, 'bin', 'mesh.js'), 'exec', 'ls'], { encoding: 'utf8', timeout: 30_000 });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /Unknown command: exec/);
});

test('the mesh skill names only dispatched subcommands and requires no `mesh` binary', () => {
  const used = new Set([...SKILL.matchAll(/^mesh ([a-z-]+)/gm)].map((m) => m[1]));
  assert.ok(used.size > 0, 'no mesh examples found');
  for (const sub of used) assert.ok(dispatched.has(sub), `SKILL.md uses \`mesh ${sub}\`, which bin/mesh.js does not dispatch`);
  const frontmatter = SKILL.split(/^---$/m)[1];
  assert.doesNotMatch(frontmatter, /bins:/);
});

test('the heartbeat mesh check runs a probe that exists and is installed', () => {
  for (const sub of RETIRED) assert.doesNotMatch(HEARTBEAT, new RegExp(`\\bmesh ${sub}\\b`));
  assert.match(HEARTBEAT, /`bin\/node-acceptance\.mjs --axis network --no-mutate`/);
  assert.ok(existsSync(join(ROOT, 'bin', 'node-acceptance.mjs')));
  assert.match(read('scripts/install/workspace.sh'), /for _wsbin in [^;]*\bnode-acceptance\.mjs\b/);
});
