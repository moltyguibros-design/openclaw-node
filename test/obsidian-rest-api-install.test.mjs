/**
 * obsidian-rest-api-install.test.mjs — the Obsidian scaffold no longer vendors
 * the Local REST API plugin (a 2.5 MB minified bundle) and enables only the
 * plugin the installer provides; the installer downloads a pinned release and
 * installs nothing whose sha256 does not match.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPT = join(ROOT, 'scripts/install/obsidian-rest-api.sh');

test('the scaffold vendors no plugin and enables only the one the installer provides', () => {
  assert.equal(existsSync(join(ROOT, 'obsidian-vault/.obsidian/plugins/obsidian-local-rest-api/main.js')), false);
  const enabled = JSON.parse(readFileSync(join(ROOT, 'obsidian-vault/.obsidian/community-plugins.json'), 'utf8'));
  assert.deepEqual(enabled, ['obsidian-local-rest-api']);
});

test('components.sh installs the plugin through the pinned, checksummed script', () => {
  const comp = readFileSync(join(ROOT, 'scripts/install/components.sh'), 'utf8');
  assert.match(comp, /bash "\$REPO_DIR\/scripts\/install\/obsidian-rest-api\.sh" "\$VAULT_DIR"/);
  const script = readFileSync(SCRIPT, 'utf8');
  assert.match(script, /^VERSION="\d+\.\d+\.\d+"$/m);
  assert.equal((script.match(/^ {2}[0-9a-f]{64}$/gm) || []).length, 3, 'one pinned sha256 per release file');
  assert.equal(spawnSync('bash', ['-n', SCRIPT]).status, 0);
});

test('a download whose checksum does not match is refused and nothing lands in the vault', () => {
  const dir = mkdtempSync(join(tmpdir(), 'olra-'));
  try {
    const mirror = join(dir, 'mirror');
    mkdirSync(mirror);
    for (const f of ['main.js', 'manifest.json', 'styles.css']) writeFileSync(join(mirror, f), `tampered ${f}\n`);
    const vault = join(dir, 'vault');
    const r = spawnSync('bash', [SCRIPT, vault], {
      encoding: 'utf8',
      env: { ...process.env, OPENCLAW_OBSIDIAN_REST_API_BASE_URL: pathToFileURL(mirror).href },
    });
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /checksum MISMATCH/);
    assert.equal(existsSync(join(vault, '.obsidian/plugins/obsidian-local-rest-api')), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
