import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const MC = join(fileURLToPath(new URL('..', import.meta.url)), 'mission-control');

test('Mission Control has one schema source: runMigrations, no stale drizzle-kit artifacts', () => {
  assert.equal(existsSync(join(MC, 'drizzle')), false, 'mission-control/drizzle/ was never applied');
  assert.equal(existsSync(join(MC, 'drizzle.config.ts')), false);
  const pkg = JSON.parse(readFileSync(join(MC, 'package.json'), 'utf8'));
  assert.equal(pkg.devDependencies?.['drizzle-kit'], undefined);
  assert.equal(pkg.dependencies?.['drizzle-kit'], undefined);
  const lock = JSON.parse(readFileSync(join(MC, 'package-lock.json'), 'utf8'));
  assert.equal(lock.packages['node_modules/drizzle-kit'], undefined, 'regenerate the lockfile');
  assert.equal(lock.packages[''].devDependencies?.['drizzle-kit'], undefined);
  assert.match(readFileSync(join(MC, 'src/lib/db/index.ts'), 'utf8'), /function runMigrations\(/);
});
