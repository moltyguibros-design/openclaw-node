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

const { createTriggerQueue, createRejectionNotifier } = require('../bin/mesh-deploy-listener.js');

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

  it('a live trigger offered during a catch-up runs after it', async () => {
    const ran = [];
    let release;
    const run = async (t) => {
      ran.push(t.catchUp ? 'catch-up' : t.sha);
      if (t.catchUp) await new Promise(r => { release = r; });
    };
    const q = createTriggerQueue(run);
    q.offer({ catchUp: true });
    await tick();
    q.offer({ sha: 'b' });
    release();
    await tick(); await tick();
    assert.deepEqual(ran, ['catch-up', 'b']);
  });

  it('a catch-up never replaces a pending live trigger', async () => {
    const ran = [];
    const superseded = [];
    let release;
    const run = async (t) => {
      ran.push(t.catchUp ? 'catch-up' : t.sha);
      if (t.sha === 'a') await new Promise(r => { release = r; });
    };
    const q = createTriggerQueue(run, { onSuperseded: (old, next) => superseded.push([old.sha, next.sha]) });
    q.offer({ sha: 'a' });
    await tick();
    q.offer({ sha: 'b' });
    q.offer({ catchUp: true });
    assert.deepEqual(superseded, []);
    release();
    await tick(); await tick();
    assert.deepEqual(ran, ['a', 'b']);
  });

  // A catch-up ran outside the queue: a trigger published before the startup
  // subscription was lost, and one offered during a reconnect catch-up was
  // dropped by executeDeploy's "Already deploying" guard.
  it('startup and reconnect catch-ups go through the queue, after the subscription exists', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'bin', 'mesh-deploy-listener.js'), 'utf8');
    const main = src.slice(src.indexOf('async function main()'));
    const subscribed = main.indexOf("nc.subscribe('mesh.deploy.trigger')");
    const firstCatchUp = main.indexOf('deployQueue.offer({ catchUp: true })');
    assert.ok(subscribed > 0 && firstCatchUp > subscribed, 'subscribe before the startup catch-up');
    assert.doesNotMatch(main, /await checkAndCatchUp/);
    const statusLoop = main.slice(main.indexOf('for await (const s of nc.status())'));
    assert.match(statusLoop.slice(0, 400), /deployQueue\.offer\(\{ catchUp: true \}\)/);
    const exec = src.slice(src.indexOf('async function executeDeploy('), src.indexOf('// ── Node Registry'));
    assert.doesNotMatch(exec, /Already deploying/);
  });

  it('the subscription loop hands verified triggers to the queue instead of awaiting the deploy', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'bin', 'mesh-deploy-listener.js'), 'utf8');
    const loop = src.slice(src.indexOf('for await (const msg of sub)'), src.indexOf('// NATS status monitoring'));
    assert.match(loop, /verifyDeployTrigger\(trigger\)[\s\S]*deployQueue\.offer\(trigger\)/);
    assert.doesNotMatch(loop, /await executeDeploy/);
  });
});

// Each rejected trigger spawned a notifier process and a popup, so a flood of
// junk triggers from any client that can publish hit every node at line rate.
describe('createRejectionNotifier', () => {
  it('alerts once per window and reports how many rejections it held back', () => {
    const calls = [];
    let clock = 0;
    const notify = createRejectionNotifier((...a) => calls.push(a), { windowMs: 1000, now: () => clock });
    for (let i = 0; i < 100; i++) notify('bad sig');
    assert.deepEqual(calls, [['block', 'Mesh deploy REJECTED', 'bad sig']]);
    clock = 1000;
    notify('bad sig 2');
    assert.deepEqual(calls[1], ['block', 'Mesh deploy REJECTED', 'bad sig 2 (+99 more rejected since the last alert)']);
    clock = 1001;
    notify('bad sig 3');
    assert.equal(calls.length, 2);
  });

  it('the subscription loop alerts through the notifier, and still logs every rejection', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'bin', 'mesh-deploy-listener.js'), 'utf8');
    const loop = src.slice(src.indexOf('for await (const msg of sub)'), src.indexOf('// NATS status monitoring'));
    assert.match(loop, /console\.error\(`\[deploy-listener\] REJECTED deploy trigger[\s\S]*notifyRejected\(/);
    assert.doesNotMatch(loop, /notifyDesktop\('block'/);
  });
});
