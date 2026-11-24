/**
 * memory-inject-server-empty-token.test.mjs — an emptied token file never
 * opens the inject server.
 *
 * An empty or whitespace-only token file read back as '', and a request whose
 * bearer value trims to '' (a non-breaking space survives the HTTP parser,
 * String.trim removes it) then matched it. Mission Control refuses an empty
 * session token for this reason. Kept in its own file because the token path
 * is fixed when the server module loads.
 *
 * Run: node --test test/memory-inject-server-empty-token.test.mjs
 */

import { it, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import net from 'node:net';

const TMP_HOME = mkdtempSync(join(tmpdir(), 'mis-empty-token-'));
const ROOT = join(TMP_HOME, '.openclaw');
process.env.HOME = TMP_HOME;
process.env.OPENCLAW_HOME = ROOT;
process.env.MEMORY_INJECT_PORT = '0';
process.env.INJECTION_LOG_DISABLED = '1';
const TOKEN_PATH = join(ROOT, 'config', 'memory-injection-token');
mkdirSync(join(ROOT, 'config'), { recursive: true });
writeFileSync(TOKEN_PATH, '  \n');

const { startInjectionServer } = await import('../lib/memory-inject-server.mjs');

after(() => rmSync(TMP_HOME, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));

function rawStatus(port, authValue) {
  return new Promise((resolve, reject) => {
    const sock = net.connect(port, '127.0.0.1');
    let data = '';
    sock.on('data', (c) => { data += c.toString('latin1'); });
    sock.on('end', () => resolve(data.split('\r\n')[0]));
    sock.on('error', reject);
    sock.end(Buffer.from(
      `GET /health HTTP/1.1\r\nHost: 127.0.0.1\r\nAuthorization: ${authValue}\r\nConnection: close\r\n\r\n`,
      'latin1',
    ));
  });
}

it('regenerates a whitespace-only token file and refuses a bearer that trims to empty', async () => {
  const server = await startInjectionServer({ llmClient: null }, { port: 0, host: '127.0.0.1', log: () => {} });
  try {
    assert.match(server.token, /^[0-9a-f]{64}$/);
    assert.equal(readFileSync(TOKEN_PATH, 'utf8').trim(), server.token);
    assert.match(await rawStatus(server.port, 'Bearer  '), / 401 /);
    assert.match(await rawStatus(server.port, `Bearer ${server.token}`), / 200 /);
  } finally {
    await server.close();
  }
});
