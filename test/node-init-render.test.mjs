/**
 * node-init-render.test.mjs — REMEDIATION_PLAN P4-8 (second half).
 *
 * openclaw-node-init.js used to write its own inline plist/unit text and a
 * second deploy listener. It now renders the repo's services/* templates —
 * the same files install.sh renders — so every node runs one definition.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync, readdirSync, writeFileSync, mkdtempSync, mkdirSync, rmSync, symlinkSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const { renderServiceTemplate, serviceTemplateVars, SERVICE_TEMPLATE_VARS } = require('../bin/openclaw-node-init.js');

const vars = serviceTemplateVars({ meshDir: '/opt/openclaw', nodeId: 'worker-7', config: { nats: 'nats://10.0.0.5:4222', provider: 'deepseek' } });
const formatOf = (t) => (t.endsWith('.plist') ? 'plist' : 'systemd');

describe('node-init renders the shared service templates', () => {
  const templates = [
    'launchd/ai.openclaw.mesh-agent.plist', 'launchd/ai.openclaw.mesh-deploy-listener.plist',
    'systemd/openclaw-mesh-agent.service', 'systemd/openclaw-mesh-deploy-listener.service',
  ];
  for (const t of templates) {
    it(`${t}: every placeholder is rendered and the node values land`, () => {
      const out = renderServiceTemplate(readFileSync(join(ROOT, 'services', t), 'utf8'), vars, formatOf(t));
      assert.doesNotMatch(out, /\$\{[A-Z_]+\}/, 'no placeholder survives');
      assert.ok(out.includes('nats://10.0.0.5:4222'), 'NATS URL from discovery');
      assert.ok(out.includes('worker-7'), 'node id');
      assert.ok(out.includes('/opt/openclaw/bin/'), 'repo dir');
    });
  }

  // The switch is also read from ~/.openclaw/openclaw.env, so each case runs under a temp HOME:
  // the operator's own env file must not decide these assertions.
  function withServiceEnv(envFile, fn) {
    const saved = { enforce: process.env.MESH_FOREMAN_ENFORCE, llm: process.env.LLM_BASE_URL, home: process.env.HOME };
    const home = mkdtempSync(join(tmpdir(), 'openclaw-foreman-'));
    if (envFile !== null) {
      mkdirSync(join(home, '.openclaw'), { recursive: true });
      writeFileSync(join(home, '.openclaw', 'openclaw.env'), envFile);
    }
    process.env.HOME = home;
    delete process.env.MESH_FOREMAN_ENFORCE;
    delete process.env.LLM_BASE_URL;
    try { return fn(); } finally {
      process.env.HOME = saved.home;
      if (saved.enforce === undefined) delete process.env.MESH_FOREMAN_ENFORCE; else process.env.MESH_FOREMAN_ENFORCE = saved.enforce;
      if (saved.llm === undefined) delete process.env.LLM_BASE_URL; else process.env.LLM_BASE_URL = saved.llm;
      rmSync(home, { recursive: true, force: true });
    }
  }
  const renderAgent = (t) => renderServiceTemplate(readFileSync(join(ROOT, 'services', t), 'utf8'),
    serviceTemplateVars({ meshDir: '/opt/openclaw', nodeId: 'worker-7', config: { nats: 'nats://10.0.0.5:4222' } }), formatOf(t));
  const switchIn = (value) => {
    assert.match(renderAgent('systemd/openclaw-mesh-agent.service'), new RegExp(`^Environment="MESH_FOREMAN_ENFORCE=${value}"$`, 'm'));
    assert.match(renderAgent('launchd/ai.openclaw.mesh-agent.plist'), new RegExp(`<key>MESH_FOREMAN_ENFORCE</key>\\s*<string>${value}</string>`));
  };

  it('renders the Foreman switch empty unless the operator set it — empty is shadow (foreman D3)', () => {
    withServiceEnv(null, () => {
      switchIn('');
      process.env.MESH_FOREMAN_ENFORCE = '1';
      switchIn('1');
    });
  });

  it('reads the Foreman switch from ~/.openclaw/openclaw.env, as install.sh does; the process env wins', () => {
    withServiceEnv('OPENCLAW_NATS=nats://10.0.0.5:4222\nMESH_FOREMAN_ENFORCE=1\n', () => {
      switchIn('1');
      process.env.MESH_FOREMAN_ENFORCE = '0';
      switchIn('0');
    });
    // openclaw.env.example carries the switch commented out: that is still shadow.
    withServiceEnv('# MESH_FOREMAN_ENFORCE=1\n', () => switchIn(''));
  });

  it('renders the saved host Ollama URL before a stale shell value', () => {
    withServiceEnv('LLM_BASE_URL=http://192.168.64.1:11434\n', () => {
      assert.match(renderAgent('launchd/ai.openclaw.mesh-agent.plist'),
        /<key>LLM_BASE_URL<\/key>\s*<string>http:\/\/192\.168\.64\.1:11434<\/string>/);
      assert.match(renderAgent('systemd/openclaw-mesh-agent.service'),
        /^Environment="LLM_BASE_URL=http:\/\/192\.168\.64\.1:11434"$/m);
      process.env.LLM_BASE_URL = 'http://localhost:11434';
      assert.match(renderAgent('launchd/ai.openclaw.mesh-agent.plist'),
        /<key>LLM_BASE_URL<\/key>\s*<string>http:\/\/192\.168\.64\.1:11434<\/string>/);
    });
    withServiceEnv(null, () => {
      process.env.LLM_BASE_URL = 'http://caller:11434';
      assert.match(renderAgent('launchd/ai.openclaw.mesh-agent.plist'),
        /<key>LLM_BASE_URL<\/key>\s*<string>http:\/\/caller:11434<\/string>/);
    });
  });

  it('an unknown placeholder fails loudly instead of shipping ${GARBAGE} into a unit', () => {
    assert.throws(() => renderServiceTemplate('ExecStart=${NODE_BIN} ${NOT_A_VAR}/x', vars, 'systemd'), /unrendered template variable/);
  });

  // The split/join render was literal but never XML-escaped, so '&' in a value made the plist unparseable.
  it('plist values are XML-escaped and every value character stays literal', () => {
    const plist = readFileSync(join(ROOT, 'services/launchd/ai.openclaw.mesh-agent.plist'), 'utf8');
    const out = renderServiceTemplate(plist, { ...vars, LLM_BASE_URL: 'http://h/?a=1&b=<2>' }, 'plist');
    assert.ok(out.includes('<string>http://h/?a=1&amp;b=&lt;2&gt;</string>'), out);
    assert.ok(renderServiceTemplate('<string>${LLM_MODEL}</string>', { ...vars, LLM_MODEL: "$&|\\$'" }, 'plist')
      .includes("<string>$&amp;|\\$'</string>"));
    assert.equal(renderServiceTemplate('M=${LLM_MODEL}', { ...vars, LLM_MODEL: '$&|${HOME}' }, 'systemd'), 'M=$&|${HOME}');
  });

  it('the renderer knows every variable the templates use (drift lock)', () => {
    const used = new Set();
    for (const dir of ['launchd', 'systemd']) {
      for (const f of readdirSync(join(ROOT, 'services', dir))) {
        if (!/mesh-agent|mesh-deploy-listener/.test(f)) continue;
        for (const m of readFileSync(join(ROOT, 'services', dir, f), 'utf8').matchAll(/\$\{([A-Z_]+)\}/g)) used.add(m[1]);
      }
    }
    for (const v of used) assert.ok(SERVICE_TEMPLATE_VARS.includes(v), `template variable ${v} is not rendered by node-init`);
    const anyTemplate = ['launchd', 'systemd'].flatMap((dir) => readdirSync(join(ROOT, 'services', dir))
      .map((f) => readFileSync(join(ROOT, 'services', dir, f), 'utf8'))).join('\n');
    for (const v of SERVICE_TEMPLATE_VARS) assert.ok(anyTemplate.includes(`\${${v}}`), `node-init renders ${v}, which no template uses`);
  });

  // The agent spawns its provider CLI by name; nvm/fnm/volta npm -g bins and Claude Code's
  // native installer land in the node dir and ~/.local/bin. They lead, so the CLI's
  // `#!/usr/bin/env node` gets the installer's node, not a distro or Homebrew one.
  const agentPaths = (v) => [
    renderServiceTemplate(readFileSync(join(ROOT, 'services/systemd/openclaw-mesh-agent.service'), 'utf8'), v, 'systemd')
      .match(/^Environment="PATH=(.*)"$/m)[1],
    renderServiceTemplate(readFileSync(join(ROOT, 'services/launchd/ai.openclaw.mesh-agent.plist'), 'utf8'), v, 'plist')
      .match(/<key>PATH<\/key>\s*<string>([^<]*)<\/string>/)[1],
  ];
  it('the mesh-agent PATH leads with the installer node dir and ~/.local/bin', () => {
    assert.ok(SERVICE_TEMPLATE_VARS.includes('NODE_BIN_DIR'));
    const head = `${dirname(process.execPath)}:${homedir()}/.local/bin:`;
    for (const p of agentPaths(serviceTemplateVars({ meshDir: '/opt/openclaw', nodeId: 'worker-7', config: {} }))) {
      assert.ok(p.startsWith(head), p);
      assert.match(p, /\/\.npm-global\/bin:/);
    }
  });

  it('a provider CLI in the node dir runs under the installer node when a system dir holds another node', () => {
    const dir = mkdtempSync(join(tmpdir(), 'agent-path-'));
    try {
      const nodeDir = join(dir, 'nvm');
      const sys = join(dir, 'sys');
      mkdirSync(nodeDir);
      mkdirSync(sys);
      writeFileSync(join(sys, 'node'), '#!/bin/sh\necho system node\n', { mode: 0o755 });
      symlinkSync(process.execPath, join(nodeDir, 'node'));
      writeFileSync(join(nodeDir, 'claude'), '#!/usr/bin/env node\nconsole.log("installer node")\n', { mode: 0o755 });
      const v = { ...serviceTemplateVars({ meshDir: '/opt/openclaw', nodeId: 'worker-7', config: {} }), NODE_BIN_DIR: nodeDir, HOME: join(dir, 'home') };
      for (const p of agentPaths(v)) {
        const PATH = p.split(':').map((d) => (d === '/usr/local/bin' || d === '/opt/homebrew/bin' ? sys : d)).join(':');
        const r = spawnSync('claude', [], { encoding: 'utf8', env: { PATH } });
        assert.equal(r.stdout.trim(), 'installer node', `${PATH}: ${r.stdout}${r.stderr}`);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  // The units append stdout/stderr to files, so the journalctl hints showed only systemd's
  // own lifecycle lines on a Linux node, never the listener's error.
  it('the log hints name the files the rendered units write', () => {
    const { serviceLogPaths } = require('../bin/openclaw-node-init.js');
    for (const unit of ['openclaw-mesh-agent', 'openclaw-mesh-deploy-listener']) {
      const service = renderServiceTemplate(readFileSync(join(ROOT, `services/systemd/${unit}.service`), 'utf8'), vars, 'systemd');
      assert.deepEqual(serviceLogPaths({ serviceType: 'systemd' }, unit), {
        out: service.match(/^StandardOutput=append:(.*)$/m)[1], err: service.match(/^StandardError=append:(.*)$/m)[1],
      });
      const plist = renderServiceTemplate(readFileSync(join(ROOT, `services/launchd/ai.openclaw.${unit.replace(/^openclaw-/, '')}.plist`), 'utf8'), vars, 'plist');
      assert.deepEqual(serviceLogPaths({ serviceType: 'launchd' }, unit), {
        out: plist.match(/<key>StandardOutPath<\/key>\s*<string>([^<]*)<\/string>/)[1],
        err: plist.match(/<key>StandardErrorPath<\/key>\s*<string>([^<]*)<\/string>/)[1],
      });
    }
    const src = readFileSync(join(ROOT, 'bin/openclaw-node-init.js'), 'utf8');
    assert.doesNotMatch(src, /journalctl --user -u openclaw-mesh-deploy-listener -n 20/);
    assert.doesNotMatch(src, /journalctl --user -u openclaw-mesh-agent -f/);
  });

  it('never writes the legacy second listener name', () => {
    const src = readFileSync(join(ROOT, 'bin', 'openclaw-node-init.js'), 'utf8');
    assert.ok(!/writeFileSync\([^)]*deploy-listener/.test(src.replace(/mesh-deploy-listener/g, '')), 'inline deploy-listener writer is gone');
    assert.ok(src.includes('ai.openclaw.deploy-listener.plist') && src.includes('Retired legacy'), 'legacy listener is retired, not left running');
  });
});

// Phase 7 (P7-1): the join token is the bootstrap channel. node-init must turn
// it into durable trust state — lead key in both allowlists (merged, never
// overwriting operator keys), lead in the identity registry, bus auth mode —
// and the service units must render with the merged allowlist.
describe('node-init join-token trust provisioning', () => {
  const { parseJoinToken, updateEnvFile, provisionTrust } = require('../bin/openclaw-node-init.js');
  const { encodeJoinToken } = require('../lib/join-token.js');
  const LEAD_KEY = 'LEADKEYAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';

  function withHome(fn) {
    const home = mkdtempSync(join(tmpdir(), 'openclaw-init-'));
    const saved = { HOME: process.env.HOME, MESH_JOIN_TOKEN: process.env.MESH_JOIN_TOKEN, OPENCLAW_IDENTITY_DIR: process.env.OPENCLAW_IDENTITY_DIR, D: process.env.OPENCLAW_DEPLOY_TRUSTED_KEYS, O: process.env.OPENCLAW_OPERATOR_TRUSTED_KEYS, A: process.env.OPENCLAW_NATS_AUTH };
    process.env.HOME = home;
    process.env.OPENCLAW_IDENTITY_DIR = join(home, '.openclaw');
    delete process.env.OPENCLAW_DEPLOY_TRUSTED_KEYS; delete process.env.OPENCLAW_OPERATOR_TRUSTED_KEYS; delete process.env.OPENCLAW_NATS_AUTH;
    mkdirSync(join(home, '.openclaw'), { recursive: true });
    try { return fn(home); } finally {
      process.env.HOME = saved.HOME; process.env.OPENCLAW_IDENTITY_DIR = saved.OPENCLAW_IDENTITY_DIR;
      if (saved.MESH_JOIN_TOKEN === undefined) delete process.env.MESH_JOIN_TOKEN; else process.env.MESH_JOIN_TOKEN = saved.MESH_JOIN_TOKEN;
      for (const [k, v] of [['OPENCLAW_DEPLOY_TRUSTED_KEYS', saved.D], ['OPENCLAW_OPERATOR_TRUSTED_KEYS', saved.O], ['OPENCLAW_NATS_AUTH', saved.A]]) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
      rmSync(home, { recursive: true, force: true });
    }
  }

  it('parseJoinToken reads the v4 facts and refuses an expired token', () => {
    withHome(() => {
      process.env.MESH_JOIN_TOKEN = encodeJoinToken({ v: 4, nats: 'nats://10.0.0.5:4222', provider: 'ollama', lead_node_id: 'lead-1', lead_identity_pubkey: LEAD_KEY, nats_auth: 'nkey', expires: Date.now() + 60_000 }, 's').token;
      assert.deepEqual(parseJoinToken(), { nats: 'nats://10.0.0.5:4222', provider: 'ollama', leadNodeId: 'lead-1', leadPubkey: LEAD_KEY, natsAuth: 'nkey' });
      process.env.MESH_JOIN_TOKEN = encodeJoinToken({ v: 3, nats: 'nats://10.0.0.5:4222', expires: Date.now() + 60_000 }, 's').token;
      assert.equal(parseJoinToken().leadPubkey, undefined, 'v3 token: no pubkey, no crash');
    });
  });

  it('updateEnvFile sets keys in place and merges allowlists without duplicates', () => {
    withHome((home) => {
      const envPath = join(home, '.openclaw', 'openclaw.env');
      writeFileSync(envPath, 'OPENCLAW_NATS=nats://a:4222\nOPENCLAW_DEPLOY_TRUSTED_KEYS="opKey"\n');
      updateEnvFile({ OPENCLAW_NATS_AUTH: 'nkey' }, { OPENCLAW_DEPLOY_TRUSTED_KEYS: ['opKey', 'k2'], OPENCLAW_OPERATOR_TRUSTED_KEYS: ['k2'] });
      const env = readFileSync(envPath, 'utf8');
      assert.match(env, /^OPENCLAW_DEPLOY_TRUSTED_KEYS=opKey,k2$/m);
      assert.match(env, /^OPENCLAW_OPERATOR_TRUSTED_KEYS=k2$/m);
      assert.match(env, /^OPENCLAW_NATS_AUTH=nkey$/m);
      assert.match(env, /^OPENCLAW_NATS=nats:\/\/a:4222$/m, 'untouched keys survive');
    });
  });

  it('an empty key in openclaw.env stays empty instead of swallowing the next line', () => {
    withHome((home) => {
      const envPath = join(home, '.openclaw', 'openclaw.env');
      writeFileSync(envPath, 'OPENCLAW_DEPLOY_TRUSTED_KEYS=\nOPENCLAW_NODE_ID=x\n');
      updateEnvFile({}, { OPENCLAW_DEPLOY_TRUSTED_KEYS: 'k1' });
      const env = readFileSync(envPath, 'utf8');
      assert.match(env, /^OPENCLAW_DEPLOY_TRUSTED_KEYS=k1$/m);
      assert.match(env, /^OPENCLAW_NODE_ID=x$/m);

      writeFileSync(envPath, 'OPENCLAW_NATS=\nOPENCLAW_NODE_ID=x\n');
      const fakeBin = join(home, 'fakebin');
      mkdirSync(fakeBin);
      writeFileSync(join(fakeBin, 'tailscale'), '#!/bin/sh\nexit 1\n', { mode: 0o755 });
      const r = spawnSync(process.execPath, ['-e', `require(${JSON.stringify(join(ROOT, 'bin', 'openclaw-node-init.js'))}).discoverNats(null)`], {
        encoding: 'utf8', timeout: 30000,
        env: { ...process.env, HOME: home, PATH: `${fakeBin}:${process.env.PATH}` },
      });
      assert.doesNotMatch(r.stdout, /Found existing NATS config/);
      assert.match(r.stderr, /Tailscale not available/);
    });
  });

  it('provisionTrust creates the identity, trusts the lead, and the units render with the merged allowlist', () => {
    withHome((home) => {
      writeFileSync(join(home, '.openclaw', 'openclaw.env'), 'OPENCLAW_DEPLOY_TRUSTED_KEYS=opKey\n');
      const self = provisionTrust({ leadNodeId: 'lead-1', leadPubkey: LEAD_KEY, natsAuth: 'nkey' }, 'worker-7');
      assert.equal(self.publicKeyBase64.length, 44);
      const env = readFileSync(join(home, '.openclaw', 'openclaw.env'), 'utf8');
      assert.match(env, new RegExp(`^OPENCLAW_DEPLOY_TRUSTED_KEYS=opKey,${self.publicKeyBase64.replace(/[+/=]/g, '\\$&')},${LEAD_KEY.replace(/[+/=]/g, '\\$&')}$`, 'm'));
      assert.match(env, /^OPENCLAW_NATS_AUTH=nkey$/m);
      const registry = JSON.parse(readFileSync(join(home, '.openclaw', 'identity-registry.json'), 'utf8'));
      assert.equal(registry['lead-1'].pubkey, LEAD_KEY);
      assert.equal(registry['lead-1'].addedBy, 'join-token');
      // The listener unit is rendered from process.env — the merged list must be there.
      const v = serviceTemplateVars({ meshDir: '/opt/openclaw', nodeId: 'worker-7', config: { nats: 'nats://a:4222' } });
      assert.equal(v.OPENCLAW_DEPLOY_TRUSTED_KEYS, `opKey,${self.publicKeyBase64},${LEAD_KEY}`);
      const unit = renderServiceTemplate(readFileSync(join(ROOT, 'services/systemd/openclaw-mesh-deploy-listener.service'), 'utf8'), v, 'systemd');
      assert.ok(unit.includes(LEAD_KEY), 'deploy listener unit carries the lead key');
      // Idempotent: a second run adds nothing.
      provisionTrust({ leadNodeId: 'lead-1', leadPubkey: LEAD_KEY, natsAuth: 'nkey' }, 'worker-7');
      assert.equal(readFileSync(join(home, '.openclaw', 'openclaw.env'), 'utf8'), env);
    });
  });

  it('openclaw-trust-peer honours OPENCLAW_IDENTITY_DIR and stores --role', () => {
    withHome((home) => {
      const dir = join(home, 'ids');
      const env = { ...process.env, OPENCLAW_IDENTITY_DIR: dir };
      const pub = spawnSync(process.execPath, [join(ROOT, 'bin/openclaw-trust-peer.mjs'), '--my-pubkey'], { encoding: 'utf8', env });
      assert.equal(pub.status, 0, pub.stderr);
      assert.equal(pub.stdout.trim().length, 44);
      assert.ok(readFileSync(join(dir, 'identity.pub'), 'utf8').includes('BEGIN PUBLIC KEY'), 'identity created under the requested dir');
      const add = spawnSync(process.execPath, [join(ROOT, 'bin/openclaw-trust-peer.mjs'), 'w9', LEAD_KEY, '--role', 'lead'], { encoding: 'utf8', env });
      assert.equal(add.status, 0, add.stderr);
      const registry = JSON.parse(readFileSync(join(dir, 'identity-registry.json'), 'utf8'));
      assert.equal(registry.w9.role, 'lead');
    });
  });
});

// MESH_NODE_HEALTH and MESH_TOOLS belong to their publishers, which create them
// with a 120 s TTL. A reader that opened them with create semantics made a
// TTL-less bucket when it ran first, so a dead node's entry never expired.
describe('read-only mesh CLIs bind to KV buckets, never create them', () => {
  it('node-init discoverTopology binds MESH_NODE_HEALTH', async () => {
    const { discoverTopology } = require('../bin/openclaw-node-init.js');
    const Module = require('node:module');
    const opened = [];
    const fakeNats = {
      StringCodec: () => ({ decode: (b) => String(b) }),
      connect: async () => ({
        jetstream: () => ({ views: { kv: async (bucket, opts) => {
          opened.push({ bucket, opts });
          if (opts.bindOnly) throw new Error('stream not found');
          return { keys: async () => [][Symbol.iterator](), get: async () => null };
        } } }),
        drain: async () => {},
      }),
    };
    const home = mkdtempSync(join(tmpdir(), 'node-init-topology-'));
    const savedHome = process.env.HOME;
    const realLoad = Module._load;
    process.env.HOME = home;
    mkdirSync(join(home, '.openclaw'), { recursive: true });
    Module._load = function (request, ...rest) { return request === 'nats' ? fakeNats : realLoad.call(this, request, ...rest); };
    try {
      await discoverTopology('nats://127.0.0.1:4222', 'worker-7');
    } finally {
      Module._load = realLoad;
      process.env.HOME = savedHome;
      rmSync(home, { recursive: true, force: true });
    }
    assert.deepEqual(opened.map((o) => o.bucket), ['MESH_NODE_HEALTH']);
    assert.equal(opened[0].opts.bindOnly, true);
  });

  it('discord-read binds MESH_TOOLS at every open', () => {
    const src = readFileSync(join(ROOT, 'bin', 'discord-read.js'), 'utf8');
    const opens = [...src.matchAll(/openMeshKv\(js, 'MESH_TOOLS', ([^,]+),/g)].map((m) => m[1]);
    assert.equal(opens.length, 2);
    for (const o of opens) assert.equal(o, '{ bindOnly: true }');
  });

  // A bind does not check the stream, so a MESH_TOOLS nobody created yet fails at keys(),
  // which sat outside the "no bucket" catch and ended the CLI with "stream not found".
  it('discord-read treats a MESH_TOOLS bucket nobody created as no tools', (t) => {
    const dir = mkdtempSync(join(tmpdir(), 'discord-read-nobucket-'));
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    const preload = join(dir, 'fake-nats.cjs');
    writeFileSync(preload, `const Module = require('node:module');
const realLoad = Module._load;
const fake = {
  StringCodec: () => ({ encode: (s) => Buffer.from(s), decode: (b) => String(b) }),
  connect: async () => ({
    subscribe: () => ({ unsubscribe() {} }), publish() {}, close: async () => {}, drain: async () => {},
    jetstream: () => ({ views: { kv: async (bucket, opts) => {
      if (!opts.bindOnly) throw new Error('read-only CLI tried to create ' + bucket);
      return { keys: async () => { throw new Error('stream not found'); }, get: async () => null };
    } } }),
  }),
};
Module._load = function (request, ...rest) { return request === 'nats' ? fake : realLoad.call(this, request, ...rest); };
`);
    const run = (...args) => spawnSync(process.execPath, ['-r', preload, join(ROOT, 'bin', 'discord-read.js'), ...args], {
      encoding: 'utf8', env: { PATH: process.env.PATH, HOME: dir, OPENCLAW_WORKSPACE: join(dir, 'ws'), OPENCLAW_NATS: 'nats://127.0.0.1:4222' },
    });
    let r = run('tools');
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /^No tools registered\.$/m);
    r = run('history', '123');
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.match(r.stderr, /Discord history tool not found in registry/);
    assert.doesNotMatch(r.stderr, /stream not found/);
  });
});

// Nothing subscribes to mesh.health.<id> (only mesh.health.alerts is used), node-init
// has no --repair option, and an object literal keeps only the last duplicate key.
describe('mesh CLI dead code stays gone', () => {
  it('node-init and mesh-node-remove publish no mesh.health.<id> announcement', () => {
    for (const f of ['openclaw-node-init.js', 'mesh-node-remove.js']) {
      assert.doesNotMatch(readFileSync(join(ROOT, 'bin', f), 'utf8'), /mesh\.health\./, f);
    }
  });

  it('mesh-install.sh does not forward --repair to node-init', () => {
    assert.doesNotMatch(readFileSync(join(ROOT, 'mesh-install.sh'), 'utf8'), /EXTRA_ARGS="\$EXTRA_ARGS --repair"/);
  });

  it('the daemon test surface lists each hook once', () => {
    const src = readFileSync(join(ROOT, 'bin', 'mesh-task-daemon.js'), 'utf8');
    const start = src.indexOf('module.exports.__test = {');
    const literal = src.slice(start, src.indexOf('\n  };\n', start));
    const keys = [...literal.matchAll(/^ {4}(\w+)(?::|\()/gm)].map((m) => m[1]);
    assert.ok(keys.length > 10, 'keys parsed');
    assert.deepEqual(keys.filter((k, i) => keys.indexOf(k) !== i), []);
  });
});

// mesh-node-remove must undo every unit node-init installs (plus the health
// publisher a full install adds): a deploy listener left behind keeps the
// "removed" node on the bus and crash-loops once --purge deletes ~/openclaw.
describe('mesh-node-remove removes every unit node-init installs', () => {
  it('stops and deletes the agent, deploy listener and health publisher units, and prints the revoke step', (t) => {
    const platform = process.platform;
    if (platform !== 'linux' && platform !== 'darwin') return t.skip(`no service manager on ${platform}`);
    const initSrc = readFileSync(join(ROOT, 'bin', 'openclaw-node-init.js'), 'utf8');
    const listName = platform === 'darwin' ? 'LAUNCHD_SERVICES' : 'SYSTEMD_SERVICES';
    const listSrc = initSrc.match(new RegExp(`const ${listName} = \\[([^\\]]*)\\]`))[1];
    const installed = [...listSrc.matchAll(/'([^']+)'/g)].map((m) => m[1]);
    assert.equal(installed.length, 2, `${listName} parsed`);
    const publisher = platform === 'darwin' ? 'ai.openclaw.mesh-health-publisher.plist' : 'openclaw-mesh-health-publisher.service';
    const units = [...installed, publisher];

    const home = mkdtempSync(join(tmpdir(), 'openclaw-remove-'));
    try {
      const unitDir = platform === 'darwin' ? join(home, 'Library', 'LaunchAgents') : join(home, '.config', 'systemd', 'user');
      mkdirSync(unitDir, { recursive: true });
      for (const u of units) writeFileSync(join(unitDir, u), 'unit\n');
      const fakeBin = join(home, 'fakebin');
      mkdirSync(fakeBin);
      const callLog = join(home, 'calls.log');
      for (const tool of ['systemctl', 'launchctl']) {
        writeFileSync(join(fakeBin, tool), `#!/bin/sh\necho "${tool} $*" >> "${callLog}"\n`, { mode: 0o755 });
      }

      const r = spawnSync(process.execPath, [join(ROOT, 'bin', 'mesh-node-remove.js'), '--force'], {
        encoding: 'utf8',
        timeout: 30000,
        env: { ...process.env, HOME: home, PATH: `${fakeBin}:${process.env.PATH}`, OPENCLAW_NATS: 'nats://127.0.0.1:1' },
      });
      assert.equal(r.status, 0, r.stderr);
      const left = readdirSync(unitDir);
      for (const u of units) assert.ok(!left.includes(u), `${u} removed`);
      const calls = readFileSync(callLog, 'utf8');
      for (const u of units) {
        const name = u.replace(/\.(plist|service)$/, '');
        assert.ok(calls.includes(name), `${name} stopped before its file was deleted`);
      }
      assert.match(r.stdout, /openclaw-trust-peer\.mjs --remove \S+ --sync-nats/);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
});

// The agent is on demand (manifest autostart:false, plist RunAtLoad false). On
// macOS node-init loaded it, then failed the join because it had no PID; on
// Linux it enabled and started it at boot. Both now leave it off, and the join
// is judged on the deploy listener.
describe('node-init leaves the mesh agent on demand', () => {
  for (const serviceType of ['systemd', 'launchd']) {
    it(`${serviceType}: the listener is started and verified, the agent is neither started nor enabled`, () => {
      const home = mkdtempSync(join(tmpdir(), 'node-init-ondemand-'));
      try {
        const fakeBin = join(home, 'fakebin');
        mkdirSync(fakeBin);
        const callLog = join(home, 'calls.log');
        const stub = (tool, body = '') => writeFileSync(join(fakeBin, tool),
          `#!/bin/sh\necho "${tool} $*" >> "${callLog}"\n${body}exit 0\n`, { mode: 0o755 });
        stub('systemctl', 'if [ "$2" = is-active ]; then if [ "$3" = openclaw-mesh-deploy-listener ]; then echo active; else echo inactive; exit 3; fi; fi\n');
        stub('launchctl', 'if [ "$1" = list ]; then printf "321\\t0\\tai.openclaw.mesh-deploy-listener\\n-\\t0\\tai.openclaw.mesh-agent\\n"; fi\n');
        stub('loginctl');
        stub('sudo');
        stub('plutil');

        const script = `
          const ni = require(${JSON.stringify(join(ROOT, 'bin', 'openclaw-node-init.js'))});
          const osInfo = { serviceType: ${JSON.stringify(serviceType)} };
          ni.installService(osInfo, ${JSON.stringify(ROOT)}, { nats: 'nats://127.0.0.1:4222', provider: 'shell' });
          console.log('VERIFIED=' + ni.verifyServiceRunning(osInfo, { settleMs: 0 }));
          console.log('START=' + ni.agentStartCommand(osInfo));
        `;
        const t0 = Date.now();
        const r = spawnSync(process.execPath, ['-e', script], {
          encoding: 'utf8', timeout: 30000,
          env: { ...process.env, HOME: home, PATH: `${fakeBin}:${process.env.PATH}`, OPENCLAW_NODE_ID: 'worker-7' },
        });
        assert.equal(r.status, 0, r.stderr);
        assert.match(r.stdout, /VERIFIED=true/);
        assert.ok(Date.now() - t0 < 5000, 'the settle wait is skipped when the caller asks');
        const calls = readFileSync(callLog, 'utf8').split('\n').filter(Boolean);
        if (serviceType === 'systemd') {
          assert.ok(calls.includes('systemctl --user enable openclaw-mesh-deploy-listener'), calls.join('\n'));
          assert.ok(calls.includes('systemctl --user restart openclaw-mesh-deploy-listener'));
          assert.deepEqual(calls.filter((c) => /(enable|restart|start) openclaw-mesh-agent/.test(c)), []);
          assert.match(r.stdout, /START=systemctl --user start openclaw-mesh-agent/);
        } else {
          assert.ok(calls.some((c) => /^launchctl load .*ai\.openclaw\.mesh-agent\.plist$/.test(c)), calls.join('\n'));
          assert.ok(calls.some((c) => /^launchctl load .*ai\.openclaw\.mesh-deploy-listener\.plist$/.test(c)));
          assert.deepEqual(calls.filter((c) => /kickstart|start ai\.openclaw\.mesh-agent/.test(c)), []);
          assert.match(r.stdout, /START=launchctl kickstart gui\/\$\(id -u\)\/ai\.openclaw\.mesh-agent/);
        }
      } finally {
        rmSync(home, { recursive: true, force: true });
      }
    });
  }
});
