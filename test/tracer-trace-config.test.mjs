/**
 * tracer-trace-config.test.mjs — Mission Control's dev/smart trace switch
 * reaches the daemons.
 *
 * MC published openclaw.trace.config, but nothing subscribed to it and
 * setTraceMode had no caller: the toggle reported success and every daemon
 * stayed at OPENCLAW_TRACE_MODE. setNatsConnection now subscribes, and applies
 * only a request signed by a trusted operator key.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tracer-config-'));
process.env.OPENCLAW_OBS_DB = path.join(tmp, 'obs.db');
const tracer = require('../lib/tracer.js');
const { getOrCreateIdentity } = await import('../lib/node-identity.mjs');
const { signOperatorRequest } = await import('../lib/operator-auth.mjs');

const operator = getOrCreateIdentity(path.join(tmp, 'operator'));
const stranger = getOrCreateIdentity(path.join(tmp, 'stranger'));
const wire = obj => Buffer.from(JSON.stringify(obj));

function fakeNc() {
  const subs = [];
  return {
    subs,
    publish() {},
    subscribe(subject, opts) {
      const sub = { subject, callback: opts.callback, unsubscribed: false, unsubscribe() { this.unsubscribed = true; } };
      subs.push(sub);
      return sub;
    },
  };
}

describe('openclaw.trace.config', () => {
  let savedKeys;
  before(() => {
    savedKeys = process.env.OPENCLAW_OPERATOR_TRUSTED_KEYS;
    process.env.OPENCLAW_OPERATOR_TRUSTED_KEYS = operator.publicKeyBase64;
    tracer.setTraceMode('smart');
  });
  after(() => {
    if (savedKeys === undefined) delete process.env.OPENCLAW_OPERATOR_TRUSTED_KEYS;
    else process.env.OPENCLAW_OPERATOR_TRUSTED_KEYS = savedKeys;
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('setNatsConnection subscribes, and a signed operator request switches the mode', async () => {
    const nc = fakeNc();
    tracer.setNatsConnection(nc, null);
    assert.deepEqual(nc.subs.map(s => s.subject), ['openclaw.trace.config']);

    nc.subs[0].callback(null, { data: wire(signOperatorRequest({ mode: 'dev' }, { identity: operator })) });
    for (let i = 0; i < 100 && tracer.getTraceMode() !== 'dev'; i++) await new Promise(r => setTimeout(r, 10));
    assert.equal(tracer.getTraceMode(), 'dev');

    const again = fakeNc();
    tracer.setNatsConnection(again, null);
    assert.equal(nc.subs[0].unsubscribed, true, 'a reconnect does not leave a second subscription');
  });

  it('refuses unsigned, foreign-signed and replayed requests', async () => {
    tracer.setTraceMode('dev');
    assert.equal(await tracer.applyTraceConfig(wire({ mode: 'smart' })), false);
    assert.equal(await tracer.applyTraceConfig(wire(signOperatorRequest({ mode: 'smart' }, { identity: stranger }))), false);
    assert.equal(tracer.getTraceMode(), 'dev');

    const signed = wire(signOperatorRequest({ mode: 'smart' }, { identity: operator }));
    assert.equal(await tracer.applyTraceConfig(signed), true);
    assert.equal(tracer.getTraceMode(), 'smart');
    tracer.setTraceMode('dev');
    assert.equal(await tracer.applyTraceConfig(signed), false, 'replay');
    assert.equal(tracer.getTraceMode(), 'dev');
  });

  it('ignores a signed request for an unknown mode', async () => {
    tracer.setTraceMode('smart');
    assert.equal(await tracer.applyTraceConfig(wire(signOperatorRequest({ mode: 'verbose' }, { identity: operator }))), false);
    assert.equal(tracer.getTraceMode(), 'smart');
  });
});
