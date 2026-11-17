/**
 * deploy-trigger-queue.test.js — a trigger that arrives during a long deploy
 * is verified on receipt and waits; only the newest waiting trigger runs. The
 * listener used to await each deploy inside its subscription loop, so a
 * trigger buffered through a >15-minute deploy failed the freshness check and
 * was reported as "Mesh deploy REJECTED".
 */

const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'deploy-queue-'));
process.env.HOME = tmp;
process.env.OPENCLAW_IDENTITY_DIR = path.join(tmp, '.openclaw');
process.env.OPENCLAW_OBS_DB = path.join(tmp, 'obs.db');
process.env.OPENCLAW_NODE_ID = 'node-x';

const { createTriggerQueue } = require('../bin/mesh-deploy-listener.js');

after(() => fs.rmSync(tmp, { recursive: true, force: true }));

const tick = () => new Promise(r => setImmediate(r));

describe('createTriggerQueue', () => {
  it('offer does not wait for the running deploy, and only the newest pending trigger runs', async () => {
    const ran = [];
    const superseded = [];
    let release;
    const run = async (t) => {
      ran.push(t.sha);
      if (t.sha === 'a') await new Promise(r => { release = r; });
    };
    const q = createTriggerQueue(run, { onSuperseded: (old, next) => superseded.push([old.sha, next.sha]) });

    assert.equal(q.offer({ sha: 'a' }), undefined, 'offer returns at once');
    await tick();
    q.offer({ sha: 'b' });
    q.offer({ sha: 'c' });
    assert.deepEqual(ran, ['a'], 'nothing else starts while a deploys');
    assert.deepEqual(superseded, [['b', 'c']]);

    release();
    await tick(); await tick();
    assert.deepEqual(ran, ['a', 'c']);

    q.offer({ sha: 'd' });
    await tick();
    assert.deepEqual(ran, ['a', 'c', 'd'], 'an idle queue runs the next trigger straight away');
  });

  it('the subscription loop hands verified triggers to the queue instead of awaiting the deploy', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'bin', 'mesh-deploy-listener.js'), 'utf8');
    const loop = src.slice(src.indexOf('for await (const msg of sub)'), src.indexOf('// NATS status monitoring'));
    assert.match(loop, /verifyDeployTrigger\(trigger\)[\s\S]*deployQueue\.offer\(trigger\)/);
    assert.doesNotMatch(loop, /await executeDeploy/);
  });
});
