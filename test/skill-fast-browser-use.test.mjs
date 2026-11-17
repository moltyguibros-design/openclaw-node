/**
 * skill-fast-browser-use.test.mjs — the vendored fast-browser-use skill: its
 * SKILL.md documents only what the Rust code implements, and Chrome keeps its
 * sandbox unless the operator opts out. Source-level: no cargo build in CI.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SKILL = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'skills', 'fast-browser-use');
const read = (rel) => fs.readFileSync(path.join(SKILL, rel), 'utf8');
const cli = read('src/bin/cli.rs');
const mcpServer = read('src/bin/mcp_server.rs');
const doc = read('SKILL.md');

const kebab = (s) => s.replace(/_/g, '-');

function subcommands() {
  const body = cli.slice(cli.indexOf('enum Commands'), cli.indexOf('#[derive(Serialize'));
  const out = new Map();
  for (const m of body.matchAll(/^    (\w+) \{([\s\S]*?)^    \},/gm)) {
    const flags = [...m[2].matchAll(/^\s+(\w+): /gm)].map((f) => `--${kebab(f[1])}`);
    out.set(m[1].toLowerCase(), new Set(flags));
  }
  return out;
}

describe('fast-browser-use: Chrome sandbox', () => {
  it('the CLI never hard-codes the sandbox off; every launch follows --no-sandbox', () => {
    assert.doesNotMatch(cli, /\.sandbox\(false\)/);
    assert.match(cli, /#\[arg\(long, global = true\)\]\s+no_sandbox: bool/);
    assert.match(cli, /let sandbox = !cli\.no_sandbox;/);
    const launches = cli.match(/LaunchOptions::default\(\)[^;]*/g);
    assert.equal(launches.length, 7);
    for (const l of launches) assert.match(l, /\.sandbox\(sandbox\)/, l);
  });

  it('the MCP server keeps the sandbox on unless --no-sandbox', () => {
    assert.match(mcpServer, /no_sandbox: bool/);
    assert.match(mcpServer, /LaunchOptions \{ headless: !cli\.headed, sandbox: !cli\.no_sandbox, \.\.Default::default\(\) \}/);
  });
});

describe('fast-browser-use: SKILL.md matches the code', () => {
  const subs = subcommands();

  it('documents no environment configuration the code never reads', () => {
    assert.doesNotMatch(doc, /CHROME_PATH=|BROWSER_HEADLESS|requiredEnv/);
    assert.doesNotMatch(cli + mcpServer, /env::var/);
  });

  it('every documented CLI invocation uses a real subcommand and its real flags', () => {
    assert.equal(subs.size, 7);
    const invocations = [...doc.matchAll(/^fast-browser-use (\w+)((?:[^\n]*\\\n)*[^\n]*)/gm)];
    assert.ok(invocations.length >= 7);
    for (const [whole, sub, rest] of invocations) {
      assert.ok(subs.has(sub), `unknown subcommand: ${whole}`);
      for (const [flag] of rest.matchAll(/--[a-z][a-z-]*/g)) {
        if (flag === '--no-sandbox') continue;
        assert.ok(subs.get(sub).has(flag), `${sub} has no ${flag}: ${whole}`);
      }
    }
  });

  it('every subcommand that reads a page is documented with its own --url', () => {
    for (const [whole, sub, rest] of doc.matchAll(/^fast-browser-use (\w+)((?:[^\n]*\\\n)*[^\n]*)/gm)) {
      if (subs.get(sub).has('--url')) assert.match(rest, /--url /, whole);
    }
  });

  it('every documented MCP tool is registered, and no unregistered names are listed', () => {
    const registered = new Set([...read('src/mcp/mod.rs').matchAll(/^\s+(browser_\w+) =>/gm)].map((m) => m[1]));
    const documented = [...doc.matchAll(/\*\*(\w+)\*\*/g)].map((m) => m[1]).filter((n) => /^browser_/.test(n));
    assert.ok(documented.length >= registered.size);
    for (const n of documented) assert.ok(registered.has(n), `not an MCP tool: ${n}`);
    for (const stale of ['vision_map', 'local_storage', 'cookies', 'debug']) {
      assert.doesNotMatch(doc, new RegExp(`\\*\\*${stale}\\*\\*`));
    }
  });
});
