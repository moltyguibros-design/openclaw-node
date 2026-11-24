import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { tmpDir } from './helpers/tmp-dir.cjs';

import {
  EXTRACT_SUBJECT,
  publishExtractDirect,
  createNatsPublisher,
  resolvePublisherNodeId,
} from '../lib/publishers/publish-helper.mjs';
import { wrapOpenAI } from '../lib/publishers/openai-wrapper.mjs';
import { wrapAnthropic } from '../lib/publishers/anthropic-wrapper.mjs';
import { wrapGemini } from '../lib/publishers/gemini-wrapper.mjs';
import { wrapMiniMax } from '../lib/publishers/minimax-wrapper.mjs';
import { runExtractNow } from '../bin/openclaw-extract-now.mjs';

// --- publish-helper tests ---

describe('publish-helper constants', () => {
  it('exports EXTRACT_SUBJECT matching extraction-trigger', () => {
    assert.equal(EXTRACT_SUBJECT, 'mesh.memory.extract_request');
  });
});

describe('publishExtractDirect', () => {
  it('publishes to correct subject with payload', () => {
    const published = [];
    const mockNc = {
      publish(subject, data) {
        published.push({ subject, data: JSON.parse(new TextDecoder().decode(data)) });
      },
    };

    publishExtractDirect(mockNc, 'node-1', 'test-trigger');

    assert.equal(published.length, 1);
    assert.equal(published[0].subject, 'mesh.memory.extract_request.node-1');
    assert.equal(published[0].data.node_id, 'node-1');
    assert.equal(published[0].data.triggered_by, 'test-trigger');
    assert.ok(published[0].data.timestamp);
  });
});

describe('createNatsPublisher', () => {
  it('returns publish and close functions', () => {
    const published = [];
    const mockNc = {
      publish(subject, data) {
        published.push({ subject, data: JSON.parse(new TextDecoder().decode(data)) });
      },
      async drain() {},
    };

    const publisher = createNatsPublisher({ nc: mockNc, nodeId: 'test-node' });
    assert.equal(typeof publisher.publish, 'function');
    assert.equal(typeof publisher.close, 'function');
  });

  it('publishes via injected nc', async () => {
    const published = [];
    const mockNc = {
      publish(subject, data) {
        published.push({ subject, data: JSON.parse(new TextDecoder().decode(data)) });
      },
      async drain() {},
    };

    const publisher = createNatsPublisher({ nc: mockNc, nodeId: 'test-node' });
    await publisher.publish('test-source');

    assert.equal(published.length, 1);
    assert.equal(published[0].data.triggered_by, 'test-source');
    assert.equal(published[0].data.node_id, 'test-node');
  });

  it('falls back to lib/node-id resolveNodeId (MESH_NODE_ID) instead of the raw hostname', async () => {
    const saved = { OPENCLAW_NODE_ID: process.env.OPENCLAW_NODE_ID, MESH_NODE_ID: process.env.MESH_NODE_ID, HOME: process.env.HOME };
    delete process.env.OPENCLAW_NODE_ID;
    process.env.MESH_NODE_ID = 'legacy-node';
    process.env.HOME = tmpDir('pub-home-'); // no openclaw.env
    try {
      const published = [];
      const mockNc = {
        publish(subject, data) {
          published.push({ subject, data: JSON.parse(new TextDecoder().decode(data)) });
        },
        async drain() {},
      };
      const publisher = createNatsPublisher({ nc: mockNc });
      await publisher.publish('t');
      assert.equal(published[0].data.node_id, 'legacy-node');
    } finally {
      for (const [k, v] of Object.entries(saved)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    }
  });

  it("publishes on the daemon's per-node subject, taking the id from openclaw.env when the env lacks it", async () => {
    const saved = { OPENCLAW_NODE_ID: process.env.OPENCLAW_NODE_ID, MESH_NODE_ID: process.env.MESH_NODE_ID, HOME: process.env.HOME };
    delete process.env.OPENCLAW_NODE_ID;
    delete process.env.MESH_NODE_ID;
    const home = tmpDir('pub-home-');
    fs.mkdirSync(path.join(home, '.openclaw'));
    fs.writeFileSync(path.join(home, '.openclaw', 'openclaw.env'), 'OPENCLAW_NODE_ID=custom-lead\n');
    process.env.HOME = home;
    try {
      assert.equal(resolvePublisherNodeId(), 'custom-lead');
      const published = [];
      const publisher = createNatsPublisher({ nc: { publish: (subject) => published.push(subject), async drain() {} } });
      await publisher.publish('hook');
      assert.deepEqual(published, ['mesh.memory.extract_request.custom-lead']);
    } finally {
      fs.rmSync(home, { recursive: true, force: true });
      for (const [k, v] of Object.entries(saved)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    }
  });

  async function withLocalServer(onSocket, run) {
    const sockets = new Set();
    const server = net.createServer((socket) => {
      sockets.add(socket);
      socket.on('error', () => {});
      onSocket(socket);
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const savedUrl = process.env.NATS_URL;
    delete process.env.NATS_URL;
    try {
      await run(`nats://127.0.0.1:${server.address().port}`);
    } finally {
      if (savedUrl === undefined) delete process.env.NATS_URL;
      else process.env.NATS_URL = savedUrl;
      for (const socket of sockets) socket.destroy();
      await new Promise((resolve) => server.close(resolve));
    }
  }

  it('dials again after a failed first connect', async () => {
    let dials = 0;
    await withLocalServer((socket) => { dials++; socket.destroy(); }, async (natsUrl) => {
      const publisher = createNatsPublisher({ natsUrl, nodeId: 't' });
      await publisher.publish();
      const firstDials = dials;
      await publisher.publish();
      assert.ok(firstDials >= 1);
      assert.ok(dials > firstDials, 'second publish must dial instead of reusing the failed connect');
      await publisher.close();
    });
  });

  it('replaces a managed connection that has closed', async () => {
    const pubsPerConnection = [];
    // A repeated auth error makes nats.js abort reconnecting and close the connection.
    const onSocket = (socket) => {
      const index = pubsPerConnection.push(0) - 1;
      socket.write('INFO {"server_id":"fake","version":"2.10.0","proto":1,"max_payload":1048576}\r\n');
      socket.on('data', (chunk) => {
        const text = chunk.toString();
        if (text.includes('PING\r\n')) socket.write('PONG\r\n');
        if (!text.includes('PUB mesh.memory.extract_request')) return;
        pubsPerConnection[index]++;
        if (index === 0) socket.write("-ERR 'Authorization Violation'\r\n-ERR 'Authorization Violation'\r\n");
      });
    };
    const until = async (done, step = async () => {}) => {
      const deadline = Date.now() + 3000;
      while (!done() && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 20));
        await step();
      }
    };
    await withLocalServer(onSocket, async (natsUrl) => {
      const publisher = createNatsPublisher({ natsUrl, nodeId: 't' });
      await publisher.publish();
      await until(() => pubsPerConnection[0] === 1);
      assert.deepEqual(pubsPerConnection, [1]);
      await until(() => pubsPerConnection[1] >= 1, () => publisher.publish());
      assert.equal(pubsPerConnection.length, 2, 'a publish after the close must dial a new connection');
      assert.ok(pubsPerConnection[1] >= 1);
      await publisher.close();
    });
  });
});

// --- SDK wrapper tests ---

describe('wrapOpenAI', () => {
  it('wraps chat.completions.create and publishes post-response', async () => {
    const publishCalls = [];
    const mockPublisher = {
      publish(triggeredBy) {
        publishCalls.push(triggeredBy);
        return Promise.resolve();
      },
    };
    const mockClient = {
      chat: {
        completions: {
          create: async () => ({ id: 'resp-1', choices: [{ message: { content: 'hello' } }] }),
        },
      },
    };

    const wrapped = wrapOpenAI(mockClient, mockPublisher);
    const result = await wrapped.chat.completions.create({ model: 'gpt-4', messages: [] });

    assert.equal(result.id, 'resp-1');
    // Allow async publish to settle
    await new Promise(r => setTimeout(r, 10));
    assert.equal(publishCalls.length, 1);
    assert.equal(publishCalls[0], 'openai-wrapper');
  });

  it('throws on invalid client', () => {
    assert.throws(() => wrapOpenAI({}, { publish: () => {} }), /chat\.completions\.create/);
  });
});

describe('wrapAnthropic', () => {
  it('wraps messages.create and publishes post-response', async () => {
    const publishCalls = [];
    const mockPublisher = {
      publish(triggeredBy) {
        publishCalls.push(triggeredBy);
        return Promise.resolve();
      },
    };
    const mockClient = {
      messages: {
        create: async () => ({ id: 'msg-1', content: [{ text: 'hello' }] }),
      },
    };

    const wrapped = wrapAnthropic(mockClient, mockPublisher);
    const result = await wrapped.messages.create({ model: 'claude-sonnet-4-20250514', messages: [] });

    assert.equal(result.id, 'msg-1');
    await new Promise(r => setTimeout(r, 10));
    assert.equal(publishCalls.length, 1);
    assert.equal(publishCalls[0], 'anthropic-wrapper');
  });
});

describe('wrapGemini', () => {
  it('wraps generateContent and publishes post-response', async () => {
    const publishCalls = [];
    const mockPublisher = {
      publish(triggeredBy) {
        publishCalls.push(triggeredBy);
        return Promise.resolve();
      },
    };
    const mockModel = {
      generateContent: async () => ({ response: { text: () => 'hello' } }),
    };

    const wrapped = wrapGemini(mockModel, mockPublisher);
    const result = await wrapped.generateContent('test');

    assert.ok(result.response);
    await new Promise(r => setTimeout(r, 10));
    assert.equal(publishCalls.length, 1);
    assert.equal(publishCalls[0], 'gemini-wrapper');
  });
});

describe('wrapMiniMax', () => {
  it('wraps chat.completions.create and publishes post-response', async () => {
    const publishCalls = [];
    const mockPublisher = {
      publish(triggeredBy) {
        publishCalls.push(triggeredBy);
        return Promise.resolve();
      },
    };
    const mockClient = {
      chat: {
        completions: {
          create: async () => ({ id: 'mm-1', choices: [] }),
        },
      },
    };

    const wrapped = wrapMiniMax(mockClient, mockPublisher);
    const result = await wrapped.chat.completions.create({});

    assert.equal(result.id, 'mm-1');
    await new Promise(r => setTimeout(r, 10));
    assert.equal(publishCalls.length, 1);
    assert.equal(publishCalls[0], 'minimax-wrapper');
  });

  it('names itself in the guard error through the shared wrapper body', () => {
    assert.throws(() => wrapMiniMax({}, { publish() {} }), /^Error: wrapMiniMax: client must have chat\.completions\.create/);
    assert.throws(() => wrapOpenAI({}, { publish() {} }), /^Error: wrapOpenAI: client must have chat\.completions\.create/);
  });
});

// Entities and decisions are private by default, so a wrapper that let the
// injector's fail-safe privacy default apply recalled almost nothing.
describe('SDK wrappers recall the caller\'s own memory, private rows included', () => {
  const EMPTY = { concepts: [], decisions: [], snippets: [] };
  const recorder = () => {
    const seen = [];
    return { seen, injector: { retrieve: async (query, opts) => { seen.push(opts); return EMPTY; } } };
  };
  const openaiClient = () => ({
    chat: { completions: { create: async (params) => ({ choices: [], _params: params }) } },
  });
  const prompts = ['what about NATS', 'what about NATS @memory deep', 'what about NATS @memory only:mesh'];

  for (const [name, wrap, call] of [
    ['wrapOpenAI', (inj) => wrapOpenAI(openaiClient(), { publish: async () => {} }, { injector: inj }),
      (c, p) => c.chat.completions.create({ messages: [{ role: 'user', content: p }] })],
    ['wrapMiniMax', (inj) => wrapMiniMax(openaiClient(), { publish: async () => {} }, { injector: inj }),
      (c, p) => c.chat.completions.create({ messages: [{ role: 'user', content: p }] })],
    ['wrapAnthropic', (inj) => wrapAnthropic({ messages: { create: async (params) => ({ _params: params }) } }, { publish: async () => {} }, { injector: inj }),
      (c, p) => c.messages.create({ messages: [{ role: 'user', content: p }] })],
    ['wrapGemini', (inj) => wrapGemini({ generateContent: async (content) => ({ _content: content }) }, { publish: async () => {} }, { injector: inj }),
      (c, p) => c.generateContent(p)],
  ]) {
    it(`${name} passes respectPrivacy:false on every directive`, async () => {
      const { seen, injector } = recorder();
      const client = wrap(injector);
      for (const p of prompts) await call(client, p);
      assert.equal(seen.length, prompts.length);
      assert.ok(seen.every(o => o.respectPrivacy === false), JSON.stringify(seen));
    });
  }

  it('a real injector over a default-private store injects those concepts', async () => {
    const { default: Database } = await import('better-sqlite3');
    const { createExtractionStore } = await import('../lib/extraction-store.mjs');
    const { createMemoryInjector } = await import('../lib/memory-injector.mjs');
    const store = createExtractionStore({ dbPath: ':memory:', integrityCheck: false });
    const knowledgeDb = new Database(':memory:');
    try {
      store.storeExtractionResult('sess-1', {
        entities: [{ name: 'JetStreamQuorum', type: 'technology', salience: 0.8 }],
        themes: [], decisions: [], actions: [], friction_signals: [], relationships: [],
      });
      assert.equal(store.db.prepare('SELECT private FROM entities').get().private, 1);
      knowledgeDb.exec(`CREATE TABLE session_chunks (
        id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT NOT NULL,
        turn_index INTEGER NOT NULL, role TEXT NOT NULL, text TEXT NOT NULL, snippet TEXT NOT NULL)`);
      knowledgeDb.prepare(`INSERT INTO session_chunks (session_id, turn_index, role, text, snippet)
        VALUES ('sess-1', 0, 'user', 'quorum setup', 'quorum setup')`).run();
      const real = createMemoryInjector({ knowledgeDb, extractionDb: store.db, llmClient: null });
      // No embedding model in the test: the vector channel stays empty.
      const injector = { retrieve: (q, o) => real.retrieve(q, { ...o, embedFn: async () => null }) };
      const client = openaiClient();
      wrapOpenAI(client, { publish: async () => {} }, { injector });
      const res = await client.chat.completions.create({ messages: [{ role: 'user', content: 'how is JetStreamQuorum doing' }] });
      const system = res._params.messages.find(m => m.role === 'system');
      assert.ok(system && system.content.includes('JetStreamQuorum'), JSON.stringify(res._params.messages));
    } finally {
      knowledgeDb.close();
      store.close();
    }
  });
});

// --- CLI tool test ---

describe('openclaw-extract-now', () => {
  it('exports runExtractNow function', () => {
    assert.equal(typeof runExtractNow, 'function');
  });
});

// --- Hook file existence tests ---

describe('hook files exist', () => {
  const repoRoot = path.resolve(new URL('.', import.meta.url).pathname, '..');

  it('hooks/claude-code/pre-compact.sh exists', () => {
    assert.ok(fs.existsSync(path.join(repoRoot, 'hooks/claude-code/pre-compact.sh')));
  });

  it('hooks/openwebui/openclaw-publisher-plugin.py exists', () => {
    assert.ok(fs.existsSync(path.join(repoRoot, 'hooks/openwebui/openclaw-publisher-plugin.py')));
  });

  it('hooks/continue/openclaw-config.json exists', () => {
    assert.ok(fs.existsSync(path.join(repoRoot, 'hooks/continue/openclaw-config.json')));
  });

  // The module is ESM with top-level await: require() throws ERR_REQUIRE_ASYNC_MODULE.
  it('hooks/librechat/openclaw-trigger.js documents an import, not require()', () => {
    const src = fs.readFileSync(path.join(repoRoot, 'hooks/librechat/openclaw-trigger.js'), 'utf8');
    const header = src.slice(0, src.indexOf('*/'));
    assert.doesNotMatch(header, /require\(['"]\.\/openclaw-trigger\.js['"]\)/);
    assert.match(header, /import \{ onResponse \} from '\.\/openclaw-trigger\.js'/);
  });

  // A forced id ({{hostname}}, or a .local host name) fails the extraction subject check, and a
  // forced localhost bus has no listener on a cluster node: the CLI resolves both from openclaw.env.
  it('the Continue template lets the CLI resolve the node id and bus itself', () => {
    const cfg = JSON.parse(fs.readFileSync(path.join(repoRoot, 'hooks/continue/openclaw-config.json'), 'utf8'));
    assert.equal(cfg.openclaw.env?.OPENCLAW_NODE_ID, undefined);
    assert.equal(cfg.openclaw.env?.NATS_URL, undefined);
    assert.equal(cfg.openclaw.extraction_trigger.cwd, '{{OPENCLAW_REPO_DIR}}');
  });

  const HAVE_PY = spawnSync('python3', ['--version']).status === 0;
  it('the OpenWebUI plugin finds the checkout under OPENCLAW_REPO_DIR and the standard install paths', { skip: !HAVE_PY && 'python3 not available' }, () => {
    const home = tmpDir('owui-plugin-');
    const checkout = (dir) => {
      fs.mkdirSync(path.join(dir, 'bin'), { recursive: true });
      fs.writeFileSync(path.join(dir, 'bin', 'openclaw-extract-now.mjs'), '');
      return dir;
    };
    const find = (env) => spawnSync('python3', ['-I', '-c',
      'import importlib.util,sys;s=importlib.util.spec_from_file_location("p",sys.argv[1]);m=importlib.util.module_from_spec(s);s.loader.exec_module(m);print(m._find_repo_root())',
      path.join(repoRoot, 'hooks/openwebui/openclaw-publisher-plugin.py')], { encoding: 'utf8', env: { PATH: process.env.PATH, HOME: home, ...env } });
    const deployed = checkout(path.join(home, '.openclaw-src', 'openclaw-node'));
    assert.equal(find({}).stdout.trim(), deployed);
    fs.rmSync(deployed, { recursive: true });
    const meshInstall = checkout(path.join(home, 'openclaw'));
    assert.equal(find({}).stdout.trim(), meshInstall);
    const elsewhere = checkout(path.join(home, 'elsewhere'));
    assert.equal(find({ OPENCLAW_REPO_DIR: elsewhere }).stdout.trim(), elsewhere);
    fs.rmSync(home, { recursive: true, force: true });
  });
});
