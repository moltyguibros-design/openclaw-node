import { test, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, rmSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_ANALYSIS_TIMEOUT } from '../lib/llm-client.mjs';

// Gate mutation-tests (audits/gate_mutation): prove each CUSTOM gate still
// REJECTS known-bad input. Vendored tools don't rot; our glue does — grep
// patterns, shell guards, budget constants. Two live rot instances motivated
// this (inject probe budget, embed-benchmark load sensitivity).

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');

// ── 1. Tarball-smoke assertions ─────────────────────────────────────────────
// Replicates the workflow's three asserts against doctored pack listings. The
// drift-lock test pins the YAML so the replica can't silently diverge.

const MODULES = readdirSync(join(REPO, 'scripts/install')).filter(f => f.endsWith('.sh')).map(f => f.slice(0, -3));
const goodListing = () => [
  'npm notice 6.0kB install.sh',
  ...MODULES.map(m => `npm notice 9.3kB scripts/install/${m}.sh`),
  'npm notice 1.2kB packages/event-schemas/dist/index.js',
  'npm notice 4.4kB uninstall.sh',
].join('\n');

function smokePasses(listing) {
  const hasInstall = / install\.sh/.test(listing);
  const moduleCount = (listing.match(/ scripts\/install\/.*\.sh/g) || []).length === MODULES.length;
  const hasDist = / packages\/event-schemas\/dist\//.test(listing);
  return hasInstall && moduleCount && hasDist;
}

describe('tarball-smoke gate rejects doctored listings', () => {
  it('accepts the healthy listing', () => {
    assert.equal(smokePasses(goodListing()), true);
  });
  it('rejects a listing missing one installer module', () => {
    assert.ok(MODULES.includes('env'), 'env.sh left the tree — pick another module to drop');
    assert.equal(smokePasses(goodListing().replace(/^.*scripts\/install\/env\.sh$/m, '')), false);
  });
  it('rejects a listing missing install.sh', () => {
    assert.equal(smokePasses(goodListing().replace(/^.*[^/]install\.sh$/m, '')), false);
  });
  it('rejects a listing missing the event-schemas dist', () => {
    assert.equal(smokePasses(goodListing().replace(/^.*event-schemas.*$/m, '')), false);
  });
  it('drift-lock: the workflow still carries the three assertion strings this replica mirrors', () => {
    const yml = readFileSync(join(REPO, '.github/workflows/test.yml'), 'utf8');
    assert.ok(yml.includes('grep -q " install.sh"'), 'install.sh grep changed — re-sync smokePasses()');
    assert.ok(yml.includes('grep -c " scripts/install/.*\\.sh"'), 'module-count grep changed — re-sync smokePasses()');
    assert.ok(yml.includes('$(ls scripts/install/*.sh | wc -l'), 'module count is no longer compared against the tree — re-sync smokePasses()');
    assert.ok(yml.includes('grep -q " packages/event-schemas/dist/"'), 'dist grep changed — re-sync smokePasses()');
  });
});

// ── 1b. Root test scripts build the workspace dist first ────────────────────
// npm runs `pretest` only for `npm test`, and packages/*/dist/ is gitignored:
// a script that calls node --test directly fails on a fresh clone.

describe('root test scripts build the workspace dist first', () => {
  const { scripts } = JSON.parse(readFileSync(join(REPO, 'package.json'), 'utf8'));
  it('pretest still builds the workspaces', () => {
    assert.ok(scripts.pretest.includes('--workspaces --if-present build'), scripts.pretest);
  });
  for (const name of ['test:unit', 'test:strict', 'test:all']) {
    it(`${name} goes through npm test or builds first`, () => {
      const s = scripts[name];
      assert.ok(/(^|\s)npm test(\s|$)/.test(s) || s.includes('npm run --workspaces --if-present build'),
        `${name} = ${s} skips the pretest build`);
    });
  }
  it('test:all does not re-run distributed-mc, which the root glob already covers', () => {
    assert.ok(!scripts['test:all'].includes('test:integration'), scripts['test:all']);
  });
});

// ── 2. Inject probe budget vs server design ─────────────────────────────────
// The relationship that rotted once: the probe's HTTP budget must clear the
// inject server's DESIGNED worst case (analysis fallback wait + retrieval),
// or a live-but-loaded server grades BROKEN.

describe('MEM-L2-INJECT budget clears the designed worst case', () => {
  const src = readFileSync(join(REPO, 'lib/node-acceptance-probes.mjs'), 'utf8');
  const block = src.slice(src.indexOf("id: 'MEM-L2-INJECT'"), src.indexOf("id: 'MEM-L4-ROUNDTRIP'"));
  const probeTimeout = Number(block.match(/timeoutMs:\s*(\d+)/)[1]);
  const httpTimeout = Number(block.match(/timeoutMs:\s*(\d+)/g)[1].match(/(\d+)/)[1]);

  it('HTTP budget ≥ 2× the analysis fallback wait', () => {
    assert.ok(httpTimeout >= DEFAULT_ANALYSIS_TIMEOUT * 2,
      `httpTimeout ${httpTimeout} < 2×analysis ${DEFAULT_ANALYSIS_TIMEOUT} — a loaded live server will grade BROKEN again`);
  });
  it('probe budget exceeds its own HTTP budget', () => {
    assert.ok(probeTimeout > httpTimeout, `probe ${probeTimeout} must outlive its HTTP call ${httpTimeout}`);
  });
});

// ── 3. MC eslint gate vacuity ───────────────────────────────────────────────
// Rot mode: the flat config's ignores silently swallowing src/ — the gate then
// passes because nothing is linted. Assert eslint still scans a real file AND
// still rejects a seeded error-level violation. Skips visibly where MC deps
// aren't installed (CI's unit-tests job installs root deps only).

const MC = join(REPO, 'mission-control');
const ESLINT = join(MC, 'node_modules/.bin/eslint');
const MC_SKIP = existsSync(ESLINT) ? false : 'mission-control node_modules not installed';

describe('mission-control eslint gate is not vacuous', { skip: MC_SKIP }, () => {
  it('actually scans real source (not ignored away)', () => {
    const out = execFileSync(ESLINT, ['--format', 'json', 'src/lib/config.ts'], { cwd: MC, encoding: 'utf8' });
    const results = JSON.parse(out);
    assert.equal(results.length, 1);
    assert.notEqual(results[0].messages?.some?.(m => m.ruleId === null && /ignored/i.test(m.message)), true,
      'config.ts is being ignored — the lint gate is passing vacuously');
  });
  it('rejects a seeded error-level violation', () => {
    const scratch = join(MC, 'src', '__gate-mutation-scratch.ts');
    // ban-ts-comment is severity-2 in this config (probed); core no-dupe-keys
    // is off for TS files (tsc owns it), so it can't serve as the seed.
    writeFileSync(scratch, '// @ts-ignore\nexport const x: number = 1;\n');
    try {
      let status = 0;
      try {
        execFileSync(ESLINT, ['--format', 'json', 'src/__gate-mutation-scratch.ts'], { cwd: MC, encoding: 'utf8' });
      } catch (e) {
        status = e.status;
      }
      assert.equal(status, 1, 'eslint accepted a seeded @ts-ignore (ban-ts-comment error) — the gate would too');
    } finally {
      rmSync(scratch, { force: true });
    }
  });
});

// ── 4. CI mesh tier cannot skip silently ────────────────────────────────────
// A daemon that never answers used to leave the readiness loop green, and
// without OPENCLAW_REQUIRE_MESH the census only skips — the whole mesh tier
// could vanish from a green run.

describe('CI requires the mesh tier and fails on a dead daemon', () => {
  const yml = readFileSync(join(REPO, '.github/workflows/test.yml'), 'utf8');
  it('the readiness loop fails the step when the daemon never answers', () => {
    assert.ok(yml.includes('[ "$ready" != 1 ]'), 'readiness loop no longer fails the step on a dead daemon');
  });
  it('the root unit tests run with OPENCLAW_REQUIRE_MESH=1', () => {
    const start = yml.indexOf('- name: Root unit tests');
    assert.ok(start >= 0, 'Root unit tests step not found');
    const next = yml.indexOf('- name:', start + 1);
    const block = yml.slice(start, next < 0 ? undefined : next);
    assert.match(block, /OPENCLAW_REQUIRE_MESH:\s*"1"/);
  });
});
