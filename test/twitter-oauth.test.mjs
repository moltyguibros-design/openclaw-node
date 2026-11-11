/**
 * twitter-oauth.test.mjs — twitter.sh signed GET requests over the full URL,
 * query included, and left the query pairs out of the parameter string, so
 * the server's RFC 5849 recomputation never matched: `whoami` (the skill's
 * credential check) and `lookup` always returned 401. The signature is
 * checked against an independent RFC 5849 HMAC-SHA1 computed here, with
 * curl, date and `openssl rand` shimmed so nonce and timestamp are fixed.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHmac } from 'node:crypto';
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPT = join(ROOT, 'skills', 'twitter', 'scripts', 'twitter.sh');
const which = (bin) => spawnSync('bash', ['-c', `command -v ${bin}`], { encoding: 'utf8' }).stdout.trim();
const OPENSSL = which('openssl');
const HAVE_TOOLS = Boolean(OPENSSL && which('jq'));

const NONCE = '0123456789abcdef0123456789abcdef';
const TIMESTAMP = '1700000000';
const KEYS = { consumerKey: 'ck', consumerSecret: 'cs', token: 'at', tokenSecret: 'ats' };

const enc = (s) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

function expectedSignature(method, baseUrl, extra = []) {
  const params = [
    ['oauth_consumer_key', KEYS.consumerKey],
    ['oauth_nonce', NONCE],
    ['oauth_signature_method', 'HMAC-SHA1'],
    ['oauth_timestamp', TIMESTAMP],
    ['oauth_token', KEYS.token],
    ['oauth_version', '1.0'],
    ...extra,
  ].map(([k, v]) => `${enc(k)}=${enc(v)}`).sort();
  const base = `${method}&${enc(baseUrl)}&${enc(params.join('&'))}`;
  const sig = createHmac('sha1', `${enc(KEYS.consumerSecret)}&${enc(KEYS.tokenSecret)}`).update(base).digest('base64');
  return enc(sig);
}

function run(args) {
  const dir = mkdtempSync(join(tmpdir(), 'twitter-oauth-'));
  const out = join(dir, 'curl-args');
  const shim = (name, body) => {
    writeFileSync(join(dir, name), `#!/usr/bin/env bash\n${body}\n`);
    chmodSync(join(dir, name), 0o755);
  };
  shim('curl', [
    'printf "%s\\n" "$@" >> "$OUT"',
    'printf \'%s\' \'{"data":{"id":"1","name":"n","username":"u","text":"hi","public_metrics":{}}}\'',
    'case "$*" in *http_code*) printf "\\n200\\n" ;; esac',
  ].join('\n'));
  shim('date', `echo ${TIMESTAMP}`);
  shim('openssl', `if [ "$1" = rand ]; then echo ${NONCE}; else exec "${OPENSSL}" "$@"; fi`);
  const r = spawnSync('bash', [SCRIPT, ...args], {
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${dir}:${process.env.PATH}`,
      OUT: out,
      TWITTER_API_KEY: KEYS.consumerKey,
      TWITTER_API_SECRET: KEYS.consumerSecret,
      TWITTER_ACCESS_TOKEN: KEYS.token,
      TWITTER_ACCESS_TOKEN_SECRET: KEYS.tokenSecret,
    },
  });
  assert.equal(r.status, 0, r.stderr);
  const auth = readFileSync(out, 'utf8').split('\n').find((l) => l.startsWith('Authorization: OAuth '));
  assert.ok(auth, 'curl got an OAuth Authorization header');
  return auth.match(/oauth_signature="([^"]+)"/)[1];
}

describe('twitter.sh OAuth 1.0a signatures', { skip: !HAVE_TOOLS && 'openssl or jq not available' }, () => {
  it('whoami signs the query pairs as parameters, not as part of the URI', () => {
    assert.equal(
      run(['whoami']),
      expectedSignature('GET', 'https://api.x.com/2/users/me', [['user.fields', 'username,name,id,public_metrics']]),
    );
  });

  it('lookup signs its query the same way', () => {
    assert.equal(
      run(['lookup', '@someone']),
      expectedSignature('GET', 'https://api.x.com/2/users/by/username/someone', [
        ['user.fields', 'name,username,id,description,public_metrics,created_at,profile_image_url'],
      ]),
    );
  });

  it('post (no query, JSON body) signs only the oauth parameters', () => {
    assert.equal(run(['post', 'hi']), expectedSignature('POST', 'https://api.x.com/2/tweets'));
  });
});
