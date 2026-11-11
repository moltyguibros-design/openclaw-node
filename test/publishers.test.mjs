import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';

import {
  DEFAULT_NATS_URL,
  EXTRACT_SUBJECT,
  publishExtractDirect,
  createNatsPublisher,
} from '../lib/publishers/publish-helper.mjs';
import { wrapOpenAI } from '../lib/publishers/openai-wrapper.mjs';
import { wrapAnthropic } from '../lib/publishers/anthropic-wrapper.mjs';
import { wrapGemini } from '../lib/publishers/gemini-wrapper.mjs';
import { wrapMiniMax } from '../lib/publishers/minimax-wrapper.mjs';
import { runExtractNow } from '../bin/openclaw-extract-now.mjs';

// --- publish-helper tests ---

describe('publish-helper constants', () => {
  it('exports DEFAULT_NATS_URL', () => {
    assert.equal(DEFAULT_NATS_URL, 'nats://localhost:4222');
  });

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
    assert.equal(published[0].subject, 'mesh.memory.extract_request');
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
    const saved = { OPENCLAW_NODE_ID: process.env.OPENCLAW_NODE_ID, MESH_NODE_ID: process.env.MESH_NODE_ID };
    delete process.env.OPENCLAW_NODE_ID;
    process.env.MESH_NODE_ID = 'legacy-node';
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
});
