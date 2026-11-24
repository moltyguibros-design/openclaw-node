/**
 * install-plan-templates.test.mjs — Step 19 of the installer copied each plan
 * template into ~/.openclaw/plan-templates only when absent, and `mesh plan`
 * reads that folder before the shipped templates, so a template fix never
 * reached an installed node. Now a copy the operator never edited follows the
 * shipped template; an edited one is kept and the new version saved as .new.
 *
 * Runs the real Step 19 block of scripts/install/integrations.sh against a
 * scratch repo dir and HOME.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const { tmpDir } = createRequire(import.meta.url)('./helpers/tmp-dir.cjs');
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const integrations = readFileSync(join(ROOT, 'scripts/install/integrations.sh'), 'utf8');

const block = (from, to) => integrations.slice(integrations.indexOf(from), integrations.indexOf(to, integrations.indexOf(from)));
const hashFn = block('rule_hash() {', '\n}\n') + '\n}\n';
const step19 = block('step "Step 19: Plan Templates"', '# Step 20');

function scratch() {
  const base = tmpDir('openclaw-plan-tmpl-');
  const repo = join(base, 'repo');
  const home = join(base, 'home');
  mkdirSync(join(repo, 'config', 'plan-templates'), { recursive: true });
  mkdirSync(home, { recursive: true });
  for (const t of ['team-feature', 'team-bugfix', 'team-deploy']) ship(repo, t, `id: ${t}\nname: ${t} v1\n`);
  return { base, repo, home, dst: (t) => join(home, '.openclaw', 'plan-templates', `${t}.yaml`) };
}

function ship(repo, name, body) {
  writeFileSync(join(repo, 'config', 'plan-templates', `${name}.yaml`), body);
}

function install({ repo, home }) {
  const r = spawnSync('bash', ['-c', [
    'DRY_RUN=false',
    `REPO_DIR=${JSON.stringify(repo)}`,
    `OPENCLAW_ROOT=${JSON.stringify(join(home, '.openclaw'))}`,
    `source ${JSON.stringify(join(ROOT, 'scripts/install/helpers.sh'))}`,
    hashFn,
    step19,
  ].join('\n')], { encoding: 'utf8', env: { ...process.env, HOME: home } });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  return r;
}

test('an untouched template copy follows the shipped template', () => {
  const s = scratch();
  try {
    install(s);
    assert.equal(readFileSync(s.dst('team-feature'), 'utf8'), 'id: team-feature\nname: team-feature v1\n');
    assert.ok(existsSync(`${s.dst('team-feature')}.sha`), 'the install records what it copied');

    ship(s.repo, 'team-feature', 'id: team-feature\nname: team-feature v2\n');
    const r = install(s);
    assert.equal(readFileSync(s.dst('team-feature'), 'utf8'), 'id: team-feature\nname: team-feature v2\n');
    assert.ok(!existsSync(`${s.dst('team-feature')}.new`));
    assert.match(r.stdout, /Updated plan template: team-feature\.yaml/);
  } finally {
    rmSync(s.base, { recursive: true, force: true });
  }
});

test('an edited template copy is kept and the new version saved as .new', () => {
  const s = scratch();
  try {
    install(s);
    writeFileSync(s.dst('team-bugfix'), 'id: team-bugfix\nname: my own routing\n');
    ship(s.repo, 'team-bugfix', 'id: team-bugfix\nname: team-bugfix v2\n');
    const r = install(s);
    assert.equal(readFileSync(s.dst('team-bugfix'), 'utf8'), 'id: team-bugfix\nname: my own routing\n');
    assert.equal(readFileSync(`${s.dst('team-bugfix')}.new`, 'utf8'), 'id: team-bugfix\nname: team-bugfix v2\n');
    assert.match(r.stdout, /team-bugfix\.yaml.*\.new/);
  } finally {
    rmSync(s.base, { recursive: true, force: true });
  }
});

test('a copy installed before records existed is adopted while pristine, then updates', () => {
  const s = scratch();
  try {
    mkdirSync(dirname(s.dst('team-deploy')), { recursive: true });
    writeFileSync(s.dst('team-deploy'), 'id: team-deploy\nname: team-deploy v1\n');
    install(s);
    assert.ok(existsSync(`${s.dst('team-deploy')}.sha`), 'record backfilled for an unedited copy');
    ship(s.repo, 'team-deploy', 'id: team-deploy\nname: team-deploy v2\n');
    install(s);
    assert.equal(readFileSync(s.dst('team-deploy'), 'utf8'), 'id: team-deploy\nname: team-deploy v2\n');
    assert.ok(!existsSync(`${s.dst('team-deploy')}.new`));
  } finally {
    rmSync(s.base, { recursive: true, force: true });
  }
});

test('the record and .new files are not listed as templates', () => {
  const { listTemplates } = createRequire(import.meta.url)('../lib/plan-templates.js');
  const s = scratch();
  try {
    install(s);
    writeFileSync(s.dst('team-bugfix'), 'id: team-bugfix\nname: edited\n');
    ship(s.repo, 'team-bugfix', 'id: team-bugfix\nname: team-bugfix v2\n');
    install(s);
    const ids = listTemplates(dirname(s.dst('team-bugfix'))).map((t) => t.file).sort();
    assert.deepEqual(ids, ['team-bugfix.yaml', 'team-deploy.yaml', 'team-feature.yaml']);
  } finally {
    rmSync(s.base, { recursive: true, force: true });
  }
});
