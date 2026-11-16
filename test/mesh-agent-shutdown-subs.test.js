#!/usr/bin/env node
/**
 * mesh-agent-shutdown-subs.test.js — audit mesh-core#29.
 *
 * main() closes each long-lived subscription it opened before it drains, and
 * the collab recruit subscription was the one it forgot. nc.drain() closes it
 * anyway, so nothing observable changes at runtime; this pins the pairing so
 * the next subscription added to main() is closed too.
 *
 * Run: node --test test/mesh-agent-shutdown-subs.test.js
 */
const fs = require('node:fs');
const path = require('node:path');
const { it } = require('node:test');
const assert = require('node:assert/strict');

const source = fs.readFileSync(path.join(__dirname, '..', 'bin', 'mesh-agent.js'), 'utf-8');

it('main() unsubscribes every subscription it opens before draining', () => {
  const main = source.slice(source.indexOf('async function main()'));
  const body = main.slice(0, main.indexOf("log('Draining NATS...')"));
  const opened = [...body.matchAll(/const (\w+) = nc\.subscribe\(/g)].map((m) => m[1]);
  assert.ok(opened.includes('recruitSub'), 'main() still opens the recruit subscription');
  for (const name of opened) {
    assert.ok(body.includes(`${name}.unsubscribe();`), `${name} is never unsubscribed at shutdown`);
  }
});
