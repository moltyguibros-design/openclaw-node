/**
 * The knowledge package carries no code that measures a configuration
 * production no longer uses: the deleted bench.mjs embedded with
 * max_length 256 (core.mjs moved to EMBED_MAX_TOKENS=2048 because 256
 * dropped ~45% of each chunk) and fell back to one operator's home path.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const PKG = fileURLToPath(new URL('../lib/mcp-knowledge', import.meta.url));
const sources = readdirSync(PKG).filter((f) => f.endsWith('.mjs'));

describe('lib/mcp-knowledge stale configuration', () => {
  it('embeds only through EMBED_MAX_TOKENS', () => {
    const literal = sources.filter((f) => /max_length:\s*\d/.test(readFileSync(join(PKG, f), 'utf8')));
    assert.deepEqual(literal, []);
  });

  it('hardcodes no home directory', () => {
    const homes = sources.filter((f) => /['"`]\/(Users|home)\/[^/'"`]+\//.test(readFileSync(join(PKG, f), 'utf8')));
    assert.deepEqual(homes, []);
  });
});
