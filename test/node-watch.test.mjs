#!/usr/bin/env node
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  WATCH_TARGETS, runWatch, formatHtml, STATUS, watchTransitions, buildSourceMap,
  parseLaunchdPrint, gradeMeshServices, gradeRequiredServices, gradeGateway, probeCoreLaunchdServices, probeMeshServices,
  probeGateway, probeCoordinator,
} from '../lib/node-watch.mjs';
import { parseSystemdShow } from '../lib/fed-probes.mjs';
import { resolveNodeConfig } from '../lib/node-acceptance.mjs';
import { createRuntimeContext } from '../lib/node-acceptance-probes.mjs';

const BIN = fileURLToPath(new URL('../bin/node-watch.mjs', import.meta.url));

const config = resolveNodeConfig({ OPENCLAW_HOME: '/tmp/acc', OPENCLAW_NODE_ID: 'tn' });

function makeQueryDb(cfg = {}) {
  return (_p, fn) => fn({
    prepare: (sql) => ({
      get: () => {
        if (/integrity_check/i.test(sql)) return { integrity_check: cfg.integrity ?? 'ok' };
        if (/SELECT value/i.test(sql)) return cfg.metaValue !== undefined ? { value: cfg.metaValue } : undefined;
        if (/COUNT\(\*\)/i.test(sql)) return { n: cfg.count ?? 0 };
        if (/MAX\(/i.test(sql)) return { t: cfg.last ?? null };
        return {};
      },
      all: () => [],
    }),
  });
}

function makeCtx(over = {}) {
  const ctx = {
    config, path, teardown: [],
    fsp: {
      stat: async () => ({ mtimeMs: Date.now(), mode: 0o100600 }),
      access: async () => {},
      readFile: async () => '',
      readdir: async () => [],
    },
    queryDb: makeQueryDb(),
    httpGet: async () => ({ status: 200, json: {} }),
    exec: async () => ({ code: 0, stdout: '', stderr: '' }),
    checkVaultLinks: async () => ({ notes: 3, links: 5, resolved: 5, dangling: [], orphans: [] }),
  };
  return Object.assign(ctx, over);
}

const target = (id) => WATCH_TARGETS.find((t) => t.id === id);
const W_OK = { status: STATUS.WORKING, detail: 'opens; integrity ok', evidence: '' };
const envFor = (ctx, extra = {}) => ({ ctx, config: ctx.config, hc: {}, probes: {}, includeHeavy: true, ...extra });

describe('node-watch honesty invariants', () => {
  it('launchd parsing distinguishes a running PID from a loaded stopped job', () => {
    assert.deepEqual(
      parseLaunchdPrint({ code: 0, stdout: 'state = running\npid = 56662\nlast exit code = 1\n' }),
      { observable: true, loaded: true, running: true, pid: 56662, state: 'running' },
    );
    assert.deepEqual(
      parseLaunchdPrint({ code: 0, stdout: 'state = not running\nlast exit code = (never exited)\n' }),
      { observable: true, loaded: true, running: false, pid: null, state: 'not running' },
    );
  });

  it('loaded PID-less mesh labels cannot earn WORKING', () => {
    const stopped = [{ label: 'ai.openclaw.mesh-agent', observable: true, loaded: true, running: false, pid: null }];
    assert.equal(gradeMeshServices(stopped).status, STATUS.BROKEN);
    const mixed = [...stopped, { label: 'ai.openclaw.mesh-bridge', observable: true, loaded: true, running: true, pid: 42 }];
    assert.equal(gradeMeshServices(mixed).status, STATUS.BROKEN);
    assert.match(gradeMeshServices(mixed).detail, /no PID/);
    const running = [{ label: 'ai.openclaw.mesh-bridge', observable: true, loaded: true, running: true, pid: 42 }];
    assert.equal(gradeMeshServices(running).status, STATUS.WORKING);
    assert.match(gradeMeshServices(running).detail, /PID evidence/);
  });

  it('an idle on-demand mesh worker is unverified, while a failed worker is broken', () => {
    const agent = {
      label: 'ai.openclaw.mesh-agent', observable: true, loaded: true,
      running: false, pid: null, state: 'not running', lastExitCode: null, exitKnown: true,
    };
    const bridge = { label: 'ai.openclaw.mesh-bridge', observable: true, loaded: true, running: true, pid: 42 };
    const idle = gradeMeshServices([agent, bridge]);
    assert.equal(idle.status, STATUS.UNKNOWN);
    assert.match(idle.detail, /idle on demand; execution path not probed/);
    assert.equal(gradeMeshServices([{ ...agent, lastExitCode: 1 }, bridge]).status, STATUS.BROKEN);
    assert.equal(gradeMeshServices([{ ...agent, state: 'waiting' }, bridge]).status, STATUS.BROKEN);
  });

  it('the mesh target separates idle workers from spawn, signal and peer failures', async () => {
    let agentOutput = 'state = not running\nlast exit code = 78: EX_CONFIG\n';
    let bridgeDown = false;
    let discordEnabled = true;
    let discordOutput = 'state = running\npid = 42\nlast exit code = 0\nHOME => /tmp/test\n';
    const ctx = makeCtx({
      fsp: { readFile: async () => JSON.stringify({ channels: { discord: { enabled: discordEnabled } } }) },
      exec: async (_command, args) => {
        const agent = args[1].endsWith('/ai.openclaw.mesh-agent');
        const discord = args[1].endsWith('/ai.openclaw.mesh-tool-discord');
        const stopped = bridgeDown && args[1].endsWith('/ai.openclaw.mesh-bridge');
        return { code: 0, stderr: '', stdout: agent
          ? agentOutput : discord ? discordOutput : stopped ? 'state = not running\nlast exit code = 1\nHOME => /tmp/test\n'
            : 'state = running\npid = 42\nlast exit code = 0\nHOME => /tmp/test\n' };
      },
    });
    assert.equal((await probeMeshServices(ctx, { platform: 'darwin' })).status, STATUS.BROKEN);
    agentOutput = 'state = not running\nlast exit code = (never exited)\nlast terminating signal = Killed: 9\n';
    assert.equal((await probeMeshServices(ctx, { platform: 'darwin' })).status, STATUS.BROKEN);
    agentOutput = 'state = not running\n';
    assert.equal((await probeMeshServices(ctx, { platform: 'darwin' })).status, STATUS.BROKEN);
    agentOutput = 'state = not running\nlast exit code = 0\n';
    assert.equal((await probeMeshServices(ctx, { platform: 'darwin' })).status, STATUS.UNKNOWN);
    agentOutput = 'state = not running\nlast exit code = (never exited)\n';
    assert.equal((await probeMeshServices(ctx, { platform: 'darwin' })).status, STATUS.UNKNOWN);
    bridgeDown = true;
    const peerFailure = await probeMeshServices(ctx, { platform: 'darwin' });
    assert.equal(peerFailure.status, STATUS.BROKEN);
    assert.match(peerFailure.detail, /mesh-bridge/);
    bridgeDown = false;
    agentOutput = 'state = running\npid = 42\nlast exit code = 0\n';
    discordEnabled = false;
    discordOutput = 'state = not running\nHOME => /tmp/test\n';
    assert.equal((await probeMeshServices(ctx, { platform: 'darwin' })).status, STATUS.UNKNOWN);
  });

  it('required core labels need a running PID, not mere loaded state', () => {
    const running = { label: 'ai.openclaw.nats', observable: true, loaded: true, running: true, pid: 10 };
    assert.equal(gradeRequiredServices([running]).status, STATUS.WORKING);
    assert.equal(gradeRequiredServices([{ ...running, running: false, pid: null }]).status, STATUS.BROKEN);
    assert.equal(gradeRequiredServices([{ ...running, loaded: false, running: false, pid: null }]).status, STATUS.BROKEN);
    assert.equal(gradeRequiredServices([{ ...running, observable: false }]).status, STATUS.UNKNOWN);
  });

  it('reads the selected NATS cohort and refuses known jobs in other domains', async () => {
    const calls = [];
    let marker = true;
    const local = ['ai.openclaw.nats', 'ai.openclaw.nats-2', 'ai.openclaw.nats-3'];
    const documented = ['ai.openclaw.nats-1', 'ai.openclaw.nats-2', 'ai.openclaw.nats-3'];
    const loaded = { gui: new Set(), user: new Set(), system: new Set(local) };
    let markerContent = JSON.stringify({ schema: 1, kind: 'openclaw-nats-writer-handoff', activeLabels: local });
    let cohortContent = null;
    let markerUid = 0;
    const ctx = makeCtx({
      fsp: { lstat: async () => {
        if (!marker) throw Object.assign(new Error('missing'), { code: 'ENOENT' });
        return { isFile: () => true, isSymbolicLink: () => false, uid: markerUid, mode: 0o100644 };
      }, readFile: async (name) => {
        if (name.endsWith('nats-writer-cohort.json')) {
          if (cohortContent == null) throw Object.assign(new Error('missing'), { code: 'ENOENT' });
          return cohortContent;
        }
        return markerContent;
      } },
      exec: async (_bin, args) => {
        const name = args[1];
        calls.push(name);
        const domain = name.split('/')[0];
        const label = name.slice(name.lastIndexOf('/') + 1);
        if (label.startsWith('ai.openclaw.nats') && !loaded[domain].has(label)) {
          return { code: 113, stdout: '', stderr: 'Could not find service' };
        }
        return { code: 0, stdout: 'state = running\npid = 42\n', stderr: '' };
      },
    });
    const protectedVerdict = await probeCoreLaunchdServices(ctx, { platform: 'darwin' });
    assert.equal(protectedVerdict.status, STATUS.WORKING);
    assert.match(protectedVerdict.evidence, /system\/ai\.openclaw\.nats:42/);
    assert.ok(calls.includes('system/ai.openclaw.nats'));
    markerContent = '{broken';
    calls.length = 0;
    assert.equal((await probeCoreLaunchdServices(ctx, { platform: 'darwin' })).status, STATUS.UNKNOWN);
    assert.equal(calls.length, 0);
    markerContent = JSON.stringify({ schema: 1, kind: 'openclaw-nats-writer-handoff', activeLabels: local });
    markerUid = 501;
    assert.equal((await probeCoreLaunchdServices(ctx, { platform: 'darwin' })).status, STATUS.UNKNOWN);
    markerUid = 0;
    loaded.gui.add(local[0]);
    assert.equal((await probeCoreLaunchdServices(ctx, { platform: 'darwin' })).status, STATUS.BROKEN);
    loaded.gui.clear();
    loaded.user.add(local[0]);
    assert.equal((await probeCoreLaunchdServices(ctx, { platform: 'darwin' })).status, STATUS.BROKEN);
    loaded.user.clear();
    loaded.system.add('ai.openclaw.nats-1');
    assert.equal((await probeCoreLaunchdServices(ctx, { platform: 'darwin' })).status, STATUS.BROKEN);
    loaded.system.delete('ai.openclaw.nats-1');
    marker = false;
    loaded.system.clear();
    for (const label of local) loaded.gui.add(label);
    cohortContent = JSON.stringify({ schema: 1, activeLabels: local });
    calls.length = 0;
    const legacyVerdict = await probeCoreLaunchdServices(ctx, { platform: 'darwin' });
    assert.equal(legacyVerdict.status, STATUS.WORKING);
    assert.ok(calls.includes(`gui/${process.getuid()}/ai.openclaw.nats`));
    assert.ok(calls.includes(`user/${process.getuid()}/ai.openclaw.nats`));
    assert.ok(calls.includes('system/ai.openclaw.nats'));
    loaded.system.add(local[0]);
    assert.equal((await probeCoreLaunchdServices(ctx, { platform: 'darwin' })).status, STATUS.BROKEN);
    loaded.system.clear();
    cohortContent = null;
    loaded.gui.clear();
    loaded.gui.add('ai.openclaw.nats');
    calls.length = 0;
    assert.equal((await probeCoreLaunchdServices(ctx, { platform: 'darwin' })).status, STATUS.UNKNOWN);
    assert.equal(calls.length, 0);
    cohortContent = JSON.stringify({ schema: 1, activeLabels: ['ai.openclaw.nats'] });
    assert.equal((await probeCoreLaunchdServices(ctx, { platform: 'darwin' })).status, STATUS.WORKING);
    cohortContent = JSON.stringify({ schema: 1, activeLabels: documented });
    loaded.gui.clear();
    for (const label of documented) loaded.gui.add(label);
    assert.equal((await probeCoreLaunchdServices(ctx, { platform: 'darwin' })).status, STATUS.WORKING);
    cohortContent = '{broken';
    assert.equal((await probeCoreLaunchdServices(ctx, { platform: 'darwin' })).status, STATUS.UNKNOWN);
  });

  it('does not claim core services healthy when handoff state cannot be read', async () => {
    const ctx = makeCtx({ fsp: { lstat: async () => { throw Object.assign(new Error('denied'), { code: 'EACCES' }); } },
      exec: async () => { throw new Error('must not probe jobs'); } });
    const verdict = await probeCoreLaunchdServices(ctx, { platform: 'darwin' });
    assert.equal(verdict.status, STATUS.UNKNOWN);
    assert.match(verdict.detail, /EACCES/);
  });

  describe('Linux systemd units', () => {
    const unit = (over = {}) => Object.entries({
      LoadState: 'loaded', UnitFileState: 'enabled', ActiveState: 'active', SubState: 'running',
      MainPID: '4242', ExecMainCode: '0', ExecMainStatus: '0', Result: 'success',
      Environment: 'HOME=/home/op PATH=/usr/bin', ...over,
    }).map(([k, v]) => `${k}=${v}`).join('\n') + '\n';
    const RUNNING = unit();
    const DEAD_OK = unit({ ActiveState: 'inactive', SubState: 'dead', MainPID: '0', ExecMainCode: '1' });
    const FAILED = unit({ ActiveState: 'failed', SubState: 'failed', MainPID: '0', ExecMainCode: '1', ExecMainStatus: '1', Result: 'exit-code' });
    const DISABLED = unit({ UnitFileState: 'disabled', ActiveState: 'inactive', SubState: 'dead', MainPID: '0' });
    const NOT_FOUND = 'LoadState=not-found\nActiveState=inactive\nMainPID=0\n';
    const systemdCtx = (units, over = {}) => {
      const calls = [];
      return { calls, ctx: makeCtx({
        exec: async (bin, args) => {
          assert.equal(bin, 'systemctl');
          const name = args.at(-1);
          calls.push(name);
          return { code: 0, stdout: units[name] ?? NOT_FOUND, stderr: '' };
        },
        ...over,
      }) };
    };

    it('maps systemctl show onto the launchd-shaped record', () => {
      assert.deepEqual(parseSystemdShow({ code: 0, stdout: RUNNING }), {
        observable: true, loaded: true, running: true, pid: 4242, state: 'running',
        lastExitCode: null, exitKnown: true, terminatingSignal: false, home: '/home/op' });
      const dead = parseSystemdShow({ code: 0, stdout: DEAD_OK });
      assert.equal(dead.running, false);
      assert.equal(dead.state, 'not running');
      assert.equal(dead.lastExitCode, 0);
      assert.equal(parseSystemdShow({ code: 0, stdout: FAILED }).state, 'failed/failed');
      assert.equal(parseSystemdShow({ code: 0, stdout: unit({ ExecMainCode: '2', ActiveState: 'inactive', MainPID: '0' }) }).terminatingSignal, true);
      assert.equal(parseSystemdShow({ code: 0, stdout: DISABLED }).loaded, false);
      assert.equal(parseSystemdShow({ code: 0, stdout: NOT_FOUND }).loaded, false);
      assert.equal(parseSystemdShow({ code: 1, stdout: '', stderr: 'Failed to connect to bus' }).observable, false);
    });

    it('mesh services grade openclaw-mesh-*.service units', async () => {
      const units = Object.fromEntries(['agent', 'bridge', 'deploy-listener', 'health-publisher', 'task-daemon', 'tool-discord']
        .map((name) => [`openclaw-mesh-${name}.service`, RUNNING]));
      const { ctx, calls } = systemdCtx(units, { fsp: { readFile: async () => JSON.stringify({ channels: { discord: { enabled: true } } }) } });
      const working = await probeMeshServices(ctx, { platform: 'linux' });
      assert.equal(working.status, STATUS.WORKING);
      assert.ok(calls.includes('openclaw-mesh-task-daemon.service'));
      units['openclaw-mesh-bridge.service'] = FAILED;
      const broken = await probeMeshServices(ctx, { platform: 'linux' });
      assert.equal(broken.status, STATUS.BROKEN);
      assert.match(broken.detail, /mesh-bridge/);
      assert.equal((await probeMeshServices(ctx, { platform: 'freebsd' })).status, STATUS.UNKNOWN);
    });

    it('core services read the cohort and refuse a stray NATS unit', async () => {
      const units = {
        'openclaw-memory-daemon.service': RUNNING,
        'openclaw-nats.service': RUNNING,
        'openclaw-mission-control.service': RUNNING,
      };
      const { ctx } = systemdCtx(units, { fsp: {
        lstat: async () => { throw new Error('the launchd handoff marker must not be read on Linux'); },
        readFile: async () => JSON.stringify({ schema: 1, activeLabels: ['ai.openclaw.nats'] }),
      } });
      assert.equal((await probeCoreLaunchdServices(ctx, { platform: 'linux' })).status, STATUS.WORKING);
      units['openclaw-nats-2.service'] = RUNNING;
      const stray = await probeCoreLaunchdServices(ctx, { platform: 'linux' });
      assert.equal(stray.status, STATUS.BROKEN);
      assert.match(stray.detail, /nats-2/);
      delete units['openclaw-nats-2.service'];
      units['openclaw-mission-control.service'] = FAILED;
      assert.equal((await probeCoreLaunchdServices(ctx, { platform: 'linux' })).status, STATUS.BROKEN);
      units['openclaw-mission-control.service'] = DISABLED;
      assert.match((await probeCoreLaunchdServices(ctx, { platform: 'linux' })).detail, /not loaded/);
    });

    it('gateway and coordinator grade their units instead of staying UNKNOWN', async () => {
      const units = { 'openclaw-gateway.service': RUNNING, 'openclaw-mesh-task-daemon.service': RUNNING };
      const { ctx } = systemdCtx(units, { fsp: {
        readdir: async () => ['s.jsonl'], stat: async () => ({ mtimeMs: Date.now() }),
      } });
      assert.equal((await probeGateway(ctx, config, { platform: 'linux' })).status, STATUS.WORKING);
      assert.equal((await probeCoordinator(ctx, { platform: 'linux' })).status, STATUS.WORKING);
      units['openclaw-gateway.service'] = FAILED;
      units['openclaw-mesh-task-daemon.service'] = FAILED;
      assert.equal((await probeGateway(ctx, config, { platform: 'linux' })).status, STATUS.BROKEN);
      assert.equal((await probeCoordinator(ctx, { platform: 'linux' })).status, STATUS.BROKEN);
      delete units['openclaw-gateway.service'];
      delete units['openclaw-mesh-task-daemon.service'];
      assert.equal((await probeGateway(ctx, config, { platform: 'linux' })).status, STATUS.OFF);
      assert.equal((await probeCoordinator(ctx, { platform: 'linux' })).status, STATUS.OFF);
    });
  });

  it('an old gateway JSONL cannot earn WORKING even when the service has a PID', () => {
    const service = { observable: true, loaded: true, running: true, pid: 77, state: 'running' };
    const verdict = gradeGateway({ service, newestSessionMs: Date.now() - 18 * 24 * 3600_000 });
    assert.equal(verdict.status, STATUS.UNKNOWN);
    assert.match(verdict.detail, /stale/);
    assert.equal(gradeGateway({ service: { ...service, running: false, pid: null }, newestSessionMs: Date.now() }).status, STATUS.BROKEN);
  });

  it('a slow target is UNKNOWN (never WORKING) when not probed this cycle', async () => {
    const report = await runWatch({
      ctx: makeCtx(), config,
      healthCheckFn: async () => ({}),
      probes: {},
      includeHeavy: false,
      targets: [target('obs.links')], // slow: true
    });
    assert.equal(report.results[0].status, STATUS.UNKNOWN);
    assert.notEqual(report.results[0].status, STATUS.WORKING);
  });

  it('heavy probe is UNKNOWN (not WORKING) when not probed this cycle', async () => {
    const probes = { 'LLM-L2-GEN': { slow: true, run: async () => ({ status: 'PASS', detail: 'ran' }) } };
    const skipped = await target('llm.local_gen').run(envFor(makeCtx(), { probes, includeHeavy: false }));
    assert.equal(skipped.status, STATUS.UNKNOWN);
    assert.equal(skipped.notProbed, true);
    const probed = await target('llm.local_gen').run(envFor(makeCtx(), { probes, includeHeavy: true }));
    assert.equal(probed.status, STATUS.WORKING);
    assert.equal(probed.notProbed, undefined);
  });

  it('light/deep alternation neither fabricates a BROKEN nor hides a recovery', async () => {
    const light = await runWatch({
      ctx: makeCtx(), config,
      healthCheckFn: async () => ({}),
      probes: {},
      includeHeavy: false,
      targets: [target('obs.links')],
    });
    assert.equal(light.results[0].notProbed, true);
    const broken = { results: [{ id: 'obs.links', status: STATUS.BROKEN }] };
    const working = { results: [{ id: 'obs.links', status: STATUS.WORKING }] };
    let s = watchTransitions(null, broken);
    assert.deepEqual([s.broke, s.recovered], [[], []]);
    s = watchTransitions(s.next, light);
    assert.equal(s.next.get('obs.links'), STATUS.BROKEN);
    s = watchTransitions(s.next, broken);
    assert.deepEqual(s.broke, []);
    s = watchTransitions(s.next, light);
    s = watchTransitions(s.next, working);
    assert.deepEqual(s.recovered, ['obs.links']);
    s = watchTransitions(s.next, broken);
    assert.deepEqual(s.broke, ['obs.links']);
  });

  it('reused acceptance verdicts map PASS→WORKING, FAIL→BROKEN', async () => {
    const ok = { 'MEM-L2-INJECT': { run: async () => ({ status: 'PASS', detail: 'ok' }) } };
    const bad = { 'MEM-L2-INJECT': { run: async () => ({ status: 'FAIL', detail: '401' }) } };
    assert.equal((await target('mem.inject').run(envFor(makeCtx(), { probes: ok }))).status, STATUS.WORKING);
    assert.equal((await target('mem.inject').run(envFor(makeCtx(), { probes: bad }))).status, STATUS.BROKEN);
  });

  it('a light tick checks inject liveness via /health and never runs the inject pipeline', async () => {
    let pipelineRuns = 0;
    const probes = { 'MEM-L2-INJECT': { run: async () => { pipelineRuns++; return { status: 'PASS', detail: 'ok' }; } } };
    const seen = [];
    const ctxFor = (reply) => makeCtx({
      fsp: { ...makeCtx().fsp, readFile: async () => 'tok\n' },
      httpGet: async (url, opts) => { seen.push({ url, auth: opts?.headers?.Authorization }); return reply(); },
      httpPost: async () => { throw new Error('light tick must not POST'); },
    });
    const light = (ctx) => target('mem.inject').run(envFor(ctx, { probes, includeHeavy: false }));

    assert.equal((await light(ctxFor(() => ({ status: 200, json: { ok: true } })))).status, STATUS.WORKING);
    assert.deepEqual(seen.at(-1), { url: `http://${config.injectHost}:${config.injectPort}/health`, auth: 'Bearer tok' });
    assert.equal((await light(ctxFor(() => ({ status: 401, json: { error: 'unauthorized' } })))).status, STATUS.BROKEN);
    assert.equal((await light(ctxFor(() => { throw new Error('ECONNREFUSED'); }))).status, STATUS.BROKEN);
    assert.equal(pipelineRuns, 0);

    assert.equal((await target('mem.inject').run(envFor(ctxFor(() => ({ status: 200 })), { probes, includeHeavy: true }))).status, STATUS.WORKING);
    assert.equal(pipelineRuns, 1, 'the deep sweep runs the full pipeline');
  });

  it('a missing reused probe is UNKNOWN, never WORKING', async () => {
    const r = await target('net.nats').run(envFor(makeCtx(), { probes: {} }));
    assert.equal(r.status, STATUS.UNKNOWN);
  });

  it('a reusing target inherits the reused probe timeoutMs (no 30s default clamp)', async () => {
    // probe declares a 50ms budget and takes 150ms: with inheritance the target
    // times out at 50ms (UNKNOWN "timeout 50ms"); under the old default clamp
    // (30s) it would have completed and reported WORKING.
    const t = target('llm.extraction_task');
    assert.equal(t.reuses, 'LLM-L2-EXTRACT');
    const probes = {
      'LLM-L2-EXTRACT': {
        timeoutMs: 50,
        run: () => new Promise((res) => setTimeout(() => res({ status: 'PASS', detail: 'slow ok' }), 150)),
      },
    };
    const report = await runWatch({
      ctx: makeCtx(), config,
      healthCheckFn: async () => ({}),
      probes, includeHeavy: true,
      targets: [t],
    });
    assert.equal(report.results[0].status, STATUS.UNKNOWN);
    assert.match(report.results[0].detail, /timeout 50ms/);
  });
});

describe('node-watch OFF semantics (intentionally not active ≠ broken)', () => {
  it('cloud LLM (via companion-bridge) is OFF when the bridge is not running', async () => {
    const ctx = makeCtx({ httpGet: async () => { throw new Error('ECONNREFUSED'); } });
    assert.equal((await target('llm.cloud').run(envFor(ctx))).status, STATUS.OFF);
  });

  it('companion-bridge is OFF when not listening (on-demand), not BROKEN', async () => {
    const ctx = makeCtx({ httpGet: async () => { throw new Error('ECONNREFUSED'); } });
    assert.equal((await target('runtime.bridge').run(envFor(ctx))).status, STATUS.OFF);
  });

  it('companion-bridge: a 5xx is BROKEN, the unrouted-root 404 is WORKING', async () => {
    assert.equal((await target('runtime.bridge').run(envFor(makeCtx({ httpGet: async () => ({ status: 503 }) })))).status, STATUS.BROKEN);
    assert.equal((await target('runtime.bridge').run(envFor(makeCtx({ httpGet: async () => ({ status: 404 }) })))).status, STATUS.WORKING);
  });

  it('federation is OFF when no identity-registry (not deployed)', async () => {
    const ctx = makeCtx({ fsp: { ...makeCtx().fsp, access: async () => { throw new Error('ENOENT'); } } });
    assert.equal((await target('net.federation').run(envFor(ctx))).status, STATUS.OFF);
  });
});

describe('node-watch disabled Discord lifecycle', () => {
  const discord = {
    label: 'ai.openclaw.mesh-tool-discord', observable: true, loaded: true,
    running: false, pid: null, state: 'not running', lastExitCode: 0,
  };
  const peer = {
    label: 'ai.openclaw.mesh-agent', observable: true, loaded: true,
    running: true, pid: 42, state: 'running', lastExitCode: null,
  };

  it('confirmed inactive Discord is explicit OFF alongside observed working peers', () => {
    const r = gradeMeshServices([peer, discord], { discordEnabled: false });
    assert.equal(r.status, STATUS.WORKING);
    assert.match(r.detail, /1\/1.*mesh-tool-discord OFF/);
    assert.match(r.evidence, /mesh-agent:42.*mesh-tool-discord:OFF\(exit0\)/);
  });

  it('an inactive-only node is OFF rather than a working cluster', () => {
    const r = gradeMeshServices([discord], { discordEnabled: false });
    assert.equal(r.status, STATUS.OFF);
    assert.match(r.detail, /explicitly disabled.*exit0/);
  });

  for (const [name, enabled] of [['enabled', true], ['legacy', undefined], ['string false', 'false'], ['null', null], ['zero', 0]]) {
    it(`${name} policy cannot waive a stopped Discord service`, () => {
      assert.equal(gradeMeshServices([peer, discord], { discordEnabled: enabled }).status, STATUS.BROKEN);
    });
  }

  for (const [name, change, expected] of [
    ['failed exit', { lastExitCode: 1 }, STATUS.BROKEN],
    ['signal exit', { lastExitCode: -15 }, STATUS.BROKEN],
    ['no exit observed', { lastExitCode: null }, STATUS.UNKNOWN],
    ['no state observed', { state: null }, STATUS.UNKNOWN],
    ['waiting state', { state: 'waiting' }, STATUS.UNKNOWN],
    ['unobservable state', { observable: false }, STATUS.UNKNOWN],
    ['running contradiction', { running: true, pid: 43, state: 'running' }, STATUS.BROKEN],
  ]) {
    it(`${name} cannot earn healthy disabled inactivity`, () => {
      assert.equal(gradeMeshServices([peer, { ...discord, ...change }], { discordEnabled: false }).status, expected);
    });
  }

  it('confirmed inactive Discord cannot hide another stopped peer', () => {
    assert.equal(gradeMeshServices([{ ...peer, running: false, pid: null }, discord], { discordEnabled: false }).status, STATUS.BROKEN);
  });

  it('an unobservable peer cannot earn WORKING beside an inactive Discord', () => {
    assert.equal(gradeMeshServices([{ ...peer, observable: false }, discord], { discordEnabled: false }).status, STATUS.UNKNOWN);
    assert.equal(gradeMeshServices([peer, { ...peer, label: 'ai.openclaw.mesh-bridge', observable: false }]).status, STATUS.UNKNOWN);
  });

  it('known failures remain BROKEN when policy or another service is unobservable', () => {
    const stoppedPeer = { ...peer, running: false, pid: null };
    assert.equal(gradeMeshServices([stoppedPeer, discord], { discordPolicyError: 'config unreadable' }).status, STATUS.BROKEN);
    assert.equal(gradeMeshServices([peer, { ...discord, lastExitCode: 1 }], { discordPolicyError: 'config unreadable' }).status, STATUS.BROKEN);
    assert.equal(gradeMeshServices([stoppedPeer, { ...discord, observable: false }]).status, STATUS.BROKEN);
    assert.equal(gradeMeshServices([peer, discord], { discordPolicyError: 'config unreadable' }).status, STATUS.UNKNOWN);
  });

  it('an unloaded role remains OFF without inventing inactive exit evidence', () => {
    assert.equal(gradeMeshServices([{ ...discord, loaded: false }], { discordEnabled: false }).status, STATUS.OFF);
  });

  it('Darwin target reads the loaded Discord HOME and preserves failure priority', { skip: process.platform !== 'darwin' }, async () => {
    const observedHome = '/tmp/discord-loaded-home';
    const samples = [
      { name: 'false', body: '{"channels":{"discord":{"enabled":false}}}', status: STATUS.WORKING },
      { name: 'true', body: '{"channels":{"discord":{"enabled":true}}}', status: STATUS.BROKEN },
      { name: 'legacy', body: '{}', status: STATUS.BROKEN },
      { name: 'string', body: '{"channels":{"discord":{"enabled":"false"}}}', status: STATUS.BROKEN },
      { name: 'null', body: '{"channels":{"discord":{"enabled":null}}}', status: STATUS.BROKEN },
      { name: 'malformed', body: '{', status: STATUS.UNKNOWN },
      { name: 'missing config', missing: true, status: STATUS.UNKNOWN },
      { name: 'missing HOME', noHome: true, status: STATUS.UNKNOWN },
      { name: 'failed peer plus malformed policy', body: '{', peerFailed: true, status: STATUS.BROKEN },
      { name: 'failed peer plus missing HOME', noHome: true, peerFailed: true, status: STATUS.BROKEN },
      { name: 'failed Discord plus malformed policy', body: '{', exit: 1, status: STATUS.BROKEN },
      { name: 'exit unobserved', body: '{"channels":{"discord":{"enabled":false}}}', exit: '(never exited)', status: STATUS.UNKNOWN },
      { name: 'running disabled', body: '{"channels":{"discord":{"enabled":false}}}', discordRunning: true, status: STATUS.BROKEN },
    ];
    for (const s of samples) {
      const reads = [];
      const ctx = makeCtx({
        fsp: { ...makeCtx().fsp, readFile: async (p) => {
          reads.push(p);
          assert.equal(p, path.join(observedHome, '.openclaw', 'openclaw.json'));
          if (s.missing) throw new Error('ENOENT');
          return s.body;
        } },
        exec: async (_command, args) => {
          const isDiscord = args[1].endsWith('/ai.openclaw.mesh-tool-discord');
          const stopped = isDiscord ? !s.discordRunning : s.peerFailed;
          return { code: 0, stderr: '', stdout: `state = ${stopped ? 'not running' : 'running'}\n${stopped ? '' : 'pid = 42\n'}last exit code = ${isDiscord ? s.exit ?? 0 : 1}\n${isDiscord && s.noHome ? '' : `HOME => ${observedHome}\n`}` };
        },
      });
      const r = await target('net.mesh').run(envFor(ctx));
      assert.equal(r.status, s.status, s.name);
      assert.equal(reads.length, s.noHome ? 0 : 1, s.name);
    }
  });
});

describe('node-watch observed verdicts', () => {
  it('vault freshness follows recent session notes when concepts are stale', async () => {
    const vault = await fs.mkdtemp(path.join(os.tmpdir(), 'node-watch-vault-'));
    const prior = process.env.OBSIDIAN_VAULT_PATH;
    process.env.OBSIDIAN_VAULT_PATH = vault;
    try {
      await fs.mkdir(path.join(vault, 'concepts'));
      await fs.mkdir(path.join(vault, 'sessions'));
      const concept = path.join(vault, 'concepts', 'old.md');
      const session = path.join(vault, 'sessions', 'recent.md');
      const marker = path.join(vault, 'sessions', 'recent.tmp');
      await Promise.all([fs.writeFile(concept, ''), fs.writeFile(session, ''), fs.writeFile(marker, '')]);
      const old = new Date(Date.now() - 3 * 3600_000);
      const recent = new Date(Date.now() - 30 * 60_000);
      await Promise.all([fs.utimes(concept, old, old), fs.utimes(session, recent, recent)]);
      const ctx = makeCtx({ fsp: fs });
      assert.equal((await target('obs.sync').run(envFor(ctx))).status, STATUS.WORKING);
      await fs.utimes(session, old, old);
      assert.equal((await target('obs.sync').run(envFor(ctx))).status, STATUS.BROKEN);
      await Promise.all([fs.rm(concept), fs.rm(session)]);
      assert.equal((await target('obs.sync').run(envFor(ctx))).status, STATUS.UNKNOWN);
    } finally {
      if (prior === undefined) delete process.env.OBSIDIAN_VAULT_PATH;
      else process.env.OBSIDIAN_VAULT_PATH = prior;
      await fs.rm(vault, { recursive: true, force: true });
    }
  });

  it('HyperAgent is WORKING only with a successful deploy probe and fresh scheduler tick', async () => {
    const probes = { 'L0-HYPERAGENT': { run: async () => ({ status: 'PASS', detail: 'imports' }) } };
    const fresh = makeCtx({
      fsp: { ...makeCtx().fsp, readFile: async () => JSON.stringify({ lastHyperagentReflect: Date.now() - 60_000 }) },
      queryDb: makeQueryDb({ count: 2 }),
    });
    assert.equal((await target('ops.hyperagent').run(envFor(fresh, { probes }))).status, STATUS.WORKING);

    const stale = makeCtx({
      fsp: { ...makeCtx().fsp, readFile: async () => JSON.stringify({ lastHyperagentReflect: Date.now() - 2 * 3600_000 }) },
      queryDb: makeQueryDb({ count: 2 }),
    });
    assert.equal((await target('ops.hyperagent').run(envFor(stale, { probes }))).status, STATUS.BROKEN);
  });

  it('HyperAgent reuses a proven CLI import on light ticks until a dependency changes', async () => {
    let spawns = 0;
    let status = 'PASS';
    const probes = { 'L0-HYPERAGENT': { run: async () => { spawns++; return { status, detail: 'imports' }; } } };
    const mtimes = new Map();
    const ctx = makeCtx({
      config: { ...config, workspace: '/tmp/acc/ha-cache-ws' },
      fsp: { ...makeCtx().fsp,
        stat: async (p) => ({ ino: 1, size: 10, mtimeMs: mtimes.get(p) ?? 1000 }),
        readFile: async () => JSON.stringify({ lastHyperagentReflect: Date.now() - 60_000 }) },
      queryDb: makeQueryDb({ count: 2 }),
    });
    const tick = async (includeHeavy) => (await target('ops.hyperagent').run(envFor(ctx, { probes, includeHeavy }))).status;
    assert.equal(await tick(false), STATUS.WORKING);
    assert.equal(await tick(false), STATUS.WORKING);
    assert.equal(await tick(false), STATUS.WORKING);
    assert.equal(spawns, 1, 'unchanged dependencies are not re-proven every minute');

    mtimes.set('/tmp/acc/ha-cache-ws/lib/hyperagent-store.mjs', 2000);
    assert.equal(await tick(false), STATUS.WORKING);
    assert.equal(spawns, 2, 'a redeployed store is re-proven');

    assert.equal(await tick(true), STATUS.WORKING);
    assert.equal(spawns, 3, 'a deep sweep always re-proves');

    status = 'FAIL';
    mtimes.set('/tmp/acc/ha-cache-ws/bin/hyperagent.mjs', 3000);
    assert.equal(await tick(false), STATUS.BROKEN);
    assert.equal(await tick(false), STATUS.BROKEN);
    assert.equal(spawns, 5, 'a failed import is never cached');
  });

  it('daemon WORKING/BROKEN from health-check', async () => {
    assert.equal((await target('mem.daemon').run(envFor(makeCtx(), { hc: { daemon: { ok: true, detail: 'pid=1' } } }))).status, STATUS.WORKING);
    assert.equal((await target('mem.daemon').run(envFor(makeCtx(), { hc: { daemon: { ok: false, detail: 'down' } } }))).status, STATUS.BROKEN);
  });

  it('state.db integrity ok → WORKING; absent → BROKEN', async () => {
    assert.equal((await target('store.state_db').run(envFor(makeCtx({ queryDb: makeQueryDb({ integrity: 'ok' }) })))).status, STATUS.WORKING);
    const absent = makeCtx({ queryDb: () => { throw new Error('unable to open database file'); } });
    assert.equal((await target('store.state_db').run(envFor(absent))).status, STATUS.BROKEN);
  });

  it('a light tick never runs integrity_check: it proves the DB answers and carries the last deep verdict', async () => {
    const sql = [];
    let integrity = 'ok';
    const cfg = { ...config, stateDb: '/tmp/acc/light-tick-state.db' };
    const ctx = makeCtx({ config: cfg, queryDb: (_p, fn) => fn({ prepare: (q) => { sql.push(q); return {
      get: () => (/integrity_check/i.test(q) ? { integrity_check: integrity } : { 1: 1 }) }; } }) });
    const light = async () => target('store.state_db').run(envFor(ctx, { includeHeavy: false }));
    const deep = async () => target('store.state_db').run(envFor(ctx, { includeHeavy: true }));

    const first = await light();
    assert.equal(first.status, STATUS.WORKING);
    assert.equal(first.lightTick, true);
    assert.deepEqual(sql, ['SELECT 1']);

    integrity = '*** in database main ***\nPage 7: btreeInitPage() returns error code 11';
    sql.length = 0;
    const corrupt = await deep();
    assert.equal(corrupt.status, STATUS.BROKEN);
    assert.equal(corrupt.lightTick, undefined);
    assert.match(sql[0], /integrity_check/);

    sql.length = 0;
    const carried = await light();
    assert.deepEqual(sql, ['SELECT 1']);
    assert.equal(carried.status, STATUS.BROKEN, 'a light tick must not turn a corrupt DB green');
    assert.match(carried.detail, /last integrity_check \d+min ago/);

    // Deep BROKEN, light carries it, deep BROKEN again: one alert, no flapping.
    const asResult = (v) => ({ results: [{ id: 'store.state_db', ...v }] });
    let state = watchTransitions(null, asResult(W_OK));
    state = watchTransitions(state.next, asResult(corrupt));
    assert.deepEqual(state.broke, ['store.state_db']);
    state = watchTransitions(state.next, asResult({ ...carried, status: STATUS.WORKING }));
    assert.deepEqual(state.recovered, [], 'a light-tick result never registers a recovery');
    state = watchTransitions(state.next, asResult(corrupt));
    assert.deepEqual(state.broke, [], 'and the next deep BROKEN is not a new alert');

    const unopenable = await target('store.state_db').run(envFor(
      makeCtx({ config: cfg, queryDb: () => { throw new Error('unable to open database file'); } }), { includeHeavy: false }));
    assert.equal(unopenable.status, STATUS.BROKEN);
    assert.equal(unopenable.lightTick, undefined, 'an observed open failure still alerts on a light tick');
  });

  it('knowledge index grades the daemon job stamp, not the MCP-client-only workspace stamp', async () => {
    const meta = (values) => makeCtx({ queryDb: (_p, fn) => fn({ prepare: () => ({ get: (key) => (key in values ? { value: values[key] } : undefined) }) }) });
    const hoursAgo = (h) => String(Date.now() - h * 3600_000);
    // No MCP client for a day, daemon job ran 5 min ago: indexing works.
    const daemonFresh = meta({ last_index_time: hoursAgo(24), last_session_index_time: hoursAgo(5 / 60) });
    assert.equal((await target('mem.knowledge_index').run(envFor(daemonFresh))).status, STATUS.WORKING);
    const daemonStale = meta({ last_index_time: hoursAgo(0.1), last_session_index_time: hoursAgo(3) });
    assert.equal((await target('mem.knowledge_index').run(envFor(daemonStale))).status, STATUS.BROKEN);
    const never = meta({ last_index_time: hoursAgo(0.1) });
    assert.equal((await target('mem.knowledge_index').run(envFor(never))).status, STATUS.UNKNOWN);
  });

  it('graph cache fresh → WORKING; stale → BROKEN (channel 5 degraded)', async () => {
    const fresh = makeCtx({ queryDb: makeQueryDb({ metaValue: new Date().toISOString() }) });
    assert.equal((await target('obs.graph_cache').run(envFor(fresh))).status, STATUS.WORKING);
    const stale = makeCtx({ queryDb: makeQueryDb({ metaValue: new Date(Date.now() - 5 * 3600_000).toISOString() }) });
    assert.equal((await target('obs.graph_cache').run(envFor(stale))).status, STATUS.BROKEN);
  });

  it('roadmap viewer requires authenticated plan discovery, not a public sign-in page', async () => {
    const down = makeCtx({ httpGet: async () => { throw new Error('ECONNREFUSED'); } });
    assert.equal((await target('ops.roadmap').run(envFor(down))).status, STATUS.OFF);
    const shell = makeCtx({ httpGet: async () => ({ status: 200 }) });
    assert.equal((await target('ops.roadmap').run(envFor(shell))).status, STATUS.BROKEN);
    const denied = makeCtx({ httpGet: async () => ({ status: 401 }) });
    assert.equal((await target('ops.roadmap').run(envFor(denied))).status, STATUS.BROKEN);
    const up = makeCtx({ httpGet: async url => {
      assert.equal(url, 'http://127.0.0.1:7892/api/plans');
      return { status: 200, json: { plans: [] } };
    } });
    assert.equal((await target('ops.roadmap').run(envFor(up))).status, STATUS.WORKING);
  });

  it('fed.cluster.quorum grades a JetStream-disabled server BROKEN, not single-node WORKING', async () => {
    const off = makeCtx({ httpGet: async () => ({ status: 200, json: { disabled: true, config: {}, memory: 0, storage: 0, streams: 0 } }) });
    const r = await target('fed.cluster.quorum').run(envFor(off));
    assert.equal(r.status, STATUS.BROKEN);
    assert.match(r.detail, /JetStream disabled/);
  });

  it('quorum, bridge and viewer targets probe the endpoints the node env configures', async () => {
    const seen = [];
    const recording = (cfg) => makeCtx({ config: cfg, httpGet: async (u) => { seen.push(u); throw new Error('ECONNREFUSED'); } });
    const cfg = resolveNodeConfig({ OPENCLAW_HOME: '/tmp/acc', NATS_MONITOR_URL: 'http://127.0.0.1:18222' });
    await target('fed.cluster.quorum').run(envFor(recording(cfg)));
    assert.deepEqual(seen, ['http://127.0.0.1:18222/jsz']);
    const saved = { ADAPTER_PORT: process.env.ADAPTER_PORT, WORKPLAN_VIEWER_PORT: process.env.WORKPLAN_VIEWER_PORT };
    try {
      process.env.ADAPTER_PORT = '18787';
      process.env.WORKPLAN_VIEWER_PORT = '17892';
      seen.length = 0;
      await target('runtime.bridge').run(envFor(recording(config)));
      await target('ops.roadmap').run(envFor(recording(config)));
      assert.deepEqual(seen, ['http://127.0.0.1:18787/', 'http://127.0.0.1:17892/api/plans']);
    } finally {
      for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    }
  });

  it('deploy-drift diff skips node_modules, which the deploy never syncs', async () => {
    const saved = process.env.OPENCLAW_REPO_DIR;
    delete process.env.OPENCLAW_REPO_DIR;
    try {
      let argv;
      const ctx = makeCtx({ exec: async (cmd, a) => { argv = [cmd, ...a]; return { code: 0, stdout: '', stderr: '' }; } });
      assert.equal((await target('fabric.deploy_drift').run(envFor(ctx))).status, STATUS.WORKING);
      assert.deepEqual(argv.slice(0, 4), ['diff', '-rq', '-x', 'node_modules']);
      assert.deepEqual(argv.slice(5), [config.workspaceLib]);
    } finally {
      if (saved !== undefined) process.env.OPENCLAW_REPO_DIR = saved;
    }
  });

  it('cloud LLM via bridge: WORKING when /health reports a served session', async () => {
    const ctx = makeCtx({ httpGet: async () => ({ status: 200, json: { status: 'ok', companion: 'http://localhost:3457', model: 'm', sessions: [{ lifetimeTurns: 5, zombieRetryCount: 0, contextTrackingHealthy: true }] } }) });
    assert.equal((await target('llm.cloud').run(envFor(ctx))).status, STATUS.WORKING);
  });
  it('cloud LLM via bridge: BROKEN when a session is degraded (zombie retries)', async () => {
    const ctx = makeCtx({ httpGet: async () => ({ status: 200, json: { status: 'ok', sessions: [{ lifetimeTurns: 2, zombieRetryCount: 2 }] } }) });
    assert.equal((await target('llm.cloud').run(envFor(ctx))).status, STATUS.BROKEN);
  });
  it('cloud LLM via bridge: UNKNOWN when bridge up but no completed turns (no billable probe sent)', async () => {
    const ctx = makeCtx({ httpGet: async () => ({ status: 200, json: { status: 'ok', sessions: [] } }) });
    assert.equal((await target('llm.cloud').run(envFor(ctx))).status, STATUS.UNKNOWN);
  });

  it('vault links WORKING when no dangling wikilinks', async () => {
    const ctx = makeCtx({ checkVaultLinks: async () => ({ notes: 4, links: 10, resolved: 10, dangling: [] }) });
    assert.equal((await target('obs.links').run(envFor(ctx))).status, STATUS.WORKING);
  });
  it('vault links BROKEN when dangling wikilinks exist', async () => {
    const ctx = makeCtx({ checkVaultLinks: async () => ({ notes: 4, links: 10, resolved: 8, dangling: [{ file: 'a.md', target: 'X' }, { file: 'b.md', target: 'Y' }] }) });
    assert.equal((await target('obs.links').run(envFor(ctx))).status, STATUS.BROKEN);
  });
  it('vault links UNKNOWN when vault has no notes', async () => {
    const ctx = makeCtx({ checkVaultLinks: async () => ({ notes: 0, links: 0, resolved: 0, dangling: [] }) });
    assert.equal((await target('obs.links').run(envFor(ctx))).status, STATUS.UNKNOWN);
  });

  it('calendar OFF when Mission Control is not running', async () => {
    const ctx = makeCtx({ httpGet: async () => { throw new Error('ECONNREFUSED'); } });
    assert.equal((await target('ops.calendar').run(envFor(ctx))).status, STATUS.OFF);
  });
  it('calendar WORKING when scheduler reachable and nothing overdue', async () => {
    const ctx = makeCtx({ httpGet: async () => ({ status: 200, json: { scheduled: { at: 2, cron: 1 }, ready: 0, overdue: 0, graceMinutes: 30 } }) });
    assert.equal((await target('ops.calendar').run(envFor(ctx))).status, STATUS.WORKING);
  });
  it('calendar BROKEN when scheduled tasks are overdue (tick not running)', async () => {
    const ctx = makeCtx({ httpGet: async () => ({ status: 200, json: { scheduled: { at: 3, cron: 0 }, overdue: 2, overdueIds: ['T1', 'T2'], graceMinutes: 30 } }) });
    assert.equal((await target('ops.calendar').run(envFor(ctx))).status, STATUS.BROKEN);
  });
});

describe('node-watch HTML dropdown view', () => {
  const fakeReport = {
    meta: { nodeId: 'tn', mode: 'once', timestamp: '2026-06-15T00:00:00Z' },
    counts: { WORKING: 1, BROKEN: 1, OFF: 1, UNKNOWN: 1 },
    results: [
      { id: 'a', family: 'memory', label: 'Memory daemon', signal: 'alive', status: 'WORKING', detail: 'pid=1', evidence: '', latency_ms: 1 },
      { id: 'b', family: 'memory', label: 'Inject server', signal: '200', status: 'BROKEN', detail: '401', evidence: '', latency_ms: 2 },
      { id: 'c', family: 'llm-cloud', label: 'Cloud LLM', signal: 'reachable', status: 'OFF', detail: 'no key', evidence: '', latency_ms: 0 },
      { id: 'd', family: 'ops', label: 'Calendar', signal: 'tick', status: 'UNKNOWN', detail: 'no probe', evidence: '', latency_ms: 0 },
    ],
  };

  it('renders a dropdown with one option per checked item, showing its result', () => {
    const html = formatHtml(fakeReport);
    assert.ok(html.includes('<select'), 'has a dropdown');
    assert.equal((html.match(/<option /g) || []).length, 4, 'one option per item');
    for (const r of fakeReport.results) {
      assert.ok(html.includes(`${r.status} — ${r.label}`), `option shows "${r.status} — ${r.label}"`);
    }
  });

  it('groups the dropdown by family and embeds the data for the detail panel', () => {
    const html = formatHtml(fakeReport);
    assert.ok(html.includes('<optgroup label="memory">'));
    assert.ok(html.includes('<optgroup label="llm-cloud">'));
    assert.ok(html.includes('<optgroup label="ops">'));
    assert.ok(html.includes('JSON.parse'), 'embeds report data for detail rendering');
    assert.ok(html.includes('<!doctype html>'), 'self-contained page');
  });

  it('detail script parses the embedded data and renders the preselected item', () => {
    const report = {
      ...fakeReport,
      results: [...fakeReport.results,
        { id: 'e', family: 'ops', label: 'L "q" </script><b>x\\y  ', signal: 's', status: 'OFF', detail: 'a\nb', evidence: '', latency_ms: 0 }],
    };
    const html = formatHtml(report);
    assert.equal(html.split('</script>').length - 1, 1, 'a label cannot close the script element');
    const body = html.match(/<script>([\s\S]*?)<\/script>/)[1];
    let shown = '';
    const document = {
      getElementById: (id) => (id === 'items'
        ? { addEventListener() {}, value: '' }
        : { set innerHTML(v) { shown = v; }, set textContent(_v) {} }),
    };
    const R = new Function('document', `${body};return R;`)(document);
    assert.deepEqual(R, report.results);
    assert.ok(shown.includes('Inject server'), 'the first BROKEN item is rendered');
  });
});

describe('node-watch runner', () => {
  it('runs all targets, tallies, and drains teardown', async () => {
    const ctx = makeCtx({ httpGet: async () => { throw new Error('bridge down'); }, checkVaultLinks: async () => ({ notes: 0, links: 0, resolved: 0, dangling: [] }) });
    ctx.teardown.push(async () => { ctx._cleaned = true; });
    const report = await runWatch({
      ctx, config,
      healthCheckFn: async () => ({ daemon: { ok: true, detail: 'pid=1' } }),
      probes: {},
      includeHeavy: true,
      targets: [target('mem.daemon'), target('obs.links'), target('llm.cloud')],
    });
    assert.equal(report.results.length, 3);
    assert.equal(report.counts.WORKING, 1);   // daemon (hc.ok)
    assert.equal(report.counts.UNKNOWN, 1);    // obs.links (no probe)
    assert.equal(report.counts.OFF, 1);        // cloud via bridge (bridge down → OFF)
    assert.equal(ctx._cleaned, true);
    // honesty: nothing WORKING beyond what was observed
    assert.ok(report.results.find((r) => r.id === 'obs.links').status !== STATUS.WORKING);
    assert.ok(report.results.every((r) => r.code && r.source), 'every result keeps its source provenance');
  });

  it('source provenance stays resolved once a later context cannot build probes', () => {
    const first = buildSourceMap(createRuntimeContext(config, { mutate: false }), [target('net.nats')]);
    assert.equal(first['net.nats'].file, 'lib/node-acceptance-probes.mjs');
    const second = buildSourceMap(makeCtx(), [target('net.nats')]);
    assert.equal(second['net.nats'].file, 'lib/node-acceptance-probes.mjs');
    assert.equal(second['net.nats'].code, first['net.nats'].code);
    assert.equal(second['net.nats'].line, first['net.nats'].line);
  });

  it('a composite target that reuses a probe keeps its own provenance', () => {
    const sm = buildSourceMap(createRuntimeContext(config, { mutate: false }), [target('ops.hyperagent'), target('net.nats')]);
    assert.equal(sm['ops.hyperagent'].file, 'lib/node-watch.mjs');
    assert.match(sm['ops.hyperagent'].code, /daemon-throttle\.json/);
    assert.equal(sm['net.nats'].file, 'lib/node-acceptance-probes.mjs');
  });
});

// ── memory ingest/extraction regressions ─────────────────────────────────────
import { gradeExtraction } from '../lib/node-watch.mjs';

const T_MSG_LAST = Date.parse('2026-07-14T23:04:49.727Z');
const T_ENTITY_LAST = Date.parse('2026-07-11T19:46:58.327Z');

describe('gradeExtraction (keeps pace with ingest)', () => {
  it('REGRESSION: entities 5 days behind flowing ingest grades BROKEN', () => {
    const v = gradeExtraction({ entityCount: 1112, lastEntityMs: T_ENTITY_LAST, lastMessageMs: T_MSG_LAST });
    assert.equal(v.status, STATUS.BROKEN);
    assert.match(v.detail, /STALLED/);
  });
  it('entities within the stall budget of the newest message → WORKING; none yet → UNKNOWN', () => {
    assert.equal(gradeExtraction({ entityCount: 10, lastEntityMs: T_MSG_LAST - 3600_000, lastMessageMs: T_MSG_LAST }).status, STATUS.WORKING);
    assert.equal(gradeExtraction({ entityCount: 0, lastEntityMs: NaN, lastMessageMs: T_MSG_LAST }).status, STATUS.UNKNOWN);
  });
});

describe('mem.ingest configured-source parity', () => {
  it('does not accept metadata-only sources and immediately flags fresh archive inconsistency', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'node-watch-ingest-empty-'));
    try {
      const home = path.join(root, '.openclaw');
      const source = path.join(root, 'transcripts');
      await fs.mkdir(path.join(home, 'config'), { recursive: true });
      await fs.mkdir(source);
      await fs.writeFile(path.join(home, 'config', 'transcript-sources.json'), JSON.stringify({
        sources: [{ name: 'test', path: source, format: 'claude-code', enabled: true }],
      }));
      const file = path.join(source, 'fresh.jsonl');
      await fs.writeFile(file, JSON.stringify({ type: 'last-prompt', timestamp: new Date().toISOString() }) + '\n');
      let inconsistent = false;
      const recent = new Date().toISOString();
      const ctx = makeCtx({
        config: { ...config, home, stateDb: path.join(home, 'state.db') },
        fsp: fs,
        queryDb: (_p, fn) => fn({ prepare: (sql) => ({ get: () => sql.includes('archived_session_id')
          ? { archived_session_id: inconsistent ? 'fresh' : null, message_count: inconsistent ? 1 : null,
            end_time: inconsistent ? recent : null, actual_count: 0 }
          : { n: 0 } }) }),
      });
      assert.equal((await target('mem.ingest').run(envFor(ctx))).status, STATUS.UNKNOWN);
      inconsistent = true;
      await fs.writeFile(file, JSON.stringify({ type: 'user', message: { content: 'fresh turn' }, timestamp: recent }) + '\n');
      assert.equal((await target('mem.ingest').run(envFor(ctx))).status, STATUS.BROKEN);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it('ignores later metadata-only writes but catches an unarchived conversation turn', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'node-watch-ingest-'));
    try {
      const home = path.join(root, '.openclaw');
      const source = path.join(root, 'transcripts');
      await fs.mkdir(path.join(home, 'config'), { recursive: true });
      await fs.mkdir(source);
      const registry = path.join(home, 'config', 'transcript-sources.json');
      await fs.writeFile(registry, JSON.stringify({
        sources: [{ name: 'test', path: source, format: 'claude-code', enabled: true }],
      }));
      const file = path.join(source, 'session-1.jsonl');
      const old = new Date(Date.now() - 3 * 3600_000).toISOString();
      await fs.writeFile(file, [
        JSON.stringify({ type: 'user', message: { content: 'hello' }, timestamp: old }),
        JSON.stringify({ type: 'last-prompt', timestamp: new Date().toISOString() }),
        '',
      ].join('\n'));
      await fs.utimes(file, new Date(old), new Date(old));
      const localConfig = { ...config, home, stateDb: path.join(home, 'state.db') };
      let declaredCount = 1;
      let storedRows = 1;
      let hasSession = true;
      let archivedLast = old;
      let now = Date.now();
      const ctx = makeCtx({
        config: localConfig,
        fsp: fs,
        now: () => now,
        queryDb: (_p, fn) => fn({
          prepare: (sql) => ({ get: (sessionId) => {
            if (sql.includes('MAX(timestamp)')) return { t: old };
            if (sql.includes('archived_session_id')) return {
              archived_session_id: hasSession && sessionId === 'session-1' ? sessionId : null,
              message_count: hasSession && sessionId === 'session-1' ? declaredCount : null,
              end_time: hasSession && sessionId === 'session-1' ? archivedLast : null,
              actual_count: sessionId === 'session-1' ? storedRows : 0,
            };
            return { n: 1 };
          } }),
        }),
      });
      assert.equal((await target('mem.ingest').run(envFor(ctx))).status, STATUS.WORKING);
      ctx.observeIngestLag = () => { throw new Error('ledger unavailable'); };
      const unavailable = await target('mem.ingest').run(envFor(ctx));
      assert.equal(unavailable.status, STATUS.UNKNOWN);
      assert.match(unavailable.detail, /ledger unavailable/);
      delete ctx.observeIngestLag;
      await fs.writeFile(registry, JSON.stringify({
        sources: [{ name: 'test', path: source, format: 'openclaw-gateway', enabled: true }],
      }));
      assert.equal((await target('mem.ingest').run(envFor(ctx))).status, STATUS.BROKEN);
      await fs.writeFile(registry, JSON.stringify({
        sources: [{ name: 'test', path: source, format: 'claude-code', enabled: true }],
      }));
      assert.equal((await target('mem.ingest').run(envFor(ctx))).status, STATUS.WORKING);
      hasSession = false;
      assert.equal((await target('mem.ingest').run(envFor(ctx))).status, STATUS.BROKEN);
      hasSession = true;
      storedRows = 0;
      assert.equal((await target('mem.ingest').run(envFor(ctx))).status, STATUS.BROKEN);
      storedRows = 1;
      declaredCount = 0;
      assert.equal((await target('mem.ingest').run(envFor(ctx))).status, STATUS.BROKEN);
      declaredCount = 1;
      archivedLast = new Date(Date.parse(old) - 1000).toISOString();
      assert.equal((await target('mem.ingest').run(envFor(ctx))).status, STATUS.BROKEN);
      archivedLast = old;
      const recentTurn = new Date().toISOString();
      await fs.appendFile(file, JSON.stringify({ type: 'assistant', message: { content: 'reply' }, timestamp: recentTurn }) + '\n');
      assert.equal((await target('mem.ingest').run(envFor(ctx))).status, STATUS.UNKNOWN);
      const stale = new Date(Date.now() - 3 * 3600_000);
      await fs.utimes(file, stale, stale);
      assert.equal((await target('mem.ingest').run(envFor(ctx))).status, STATUS.UNKNOWN);
      now += 2 * 3600_000 + 1;
      const lagged = await target('mem.ingest').run(envFor(ctx));
      assert.equal(lagged.status, STATUS.BROKEN);
      assert.match(lagged.detail, /overdue or inconsistent archive state/);
      await fs.writeFile(path.join(source, 'newer.jsonl'), JSON.stringify({ type: 'last-prompt', timestamp: new Date().toISOString() }) + '\n');
      assert.equal((await target('mem.ingest').run(envFor(ctx))).status, STATUS.BROKEN);
      const link = path.join(source, 'linked.jsonl');
      await fs.symlink(file, link);
      const mixed = await target('mem.ingest').run(envFor(ctx));
      assert.equal(mixed.status, STATUS.BROKEN);
      assert.match(mixed.detail, /other file\(s\) unobservable/);
      await fs.unlink(link);
      declaredCount = 2;
      storedRows = 2;
      archivedLast = recentTurn;
      await fs.writeFile(path.join(source, 'ignored.txt'), JSON.stringify({ type: 'user', message: { content: 'not a source' } }));
      assert.equal((await target('mem.ingest').run(envFor(ctx))).status, STATUS.WORKING);
      const twoTurns = await fs.readFile(file, 'utf8');
      await fs.appendFile(file, JSON.stringify({ type: 'user', message: { content: 'pending before restore' }, timestamp: recentTurn }) + '\n');
      assert.equal((await target('mem.ingest').run(envFor(ctx))).status, STATUS.UNKNOWN);
      declaredCount = 1;
      storedRows = 1;
      archivedLast = old;
      const lowerPending = await target('mem.ingest').run(envFor(ctx));
      assert.equal(lowerPending.status, STATUS.UNKNOWN);
      assert.match(lowerPending.detail, /below a prior observation/);
      await fs.writeFile(file, `${twoTurns.split('\n')[0]}\n`);
      assert.equal((await target('mem.ingest').run(envFor(ctx))).status, STATUS.WORKING);
      await fs.writeFile(file, twoTurns);
      declaredCount = 2;
      storedRows = 2;
      archivedLast = recentTurn;
      assert.equal((await target('mem.ingest').run(envFor(ctx))).status, STATUS.WORKING);
      await fs.symlink(file, link);
      assert.match((await target('mem.ingest').run(envFor(ctx))).detail, /not regular/);
      await fs.unlink(link);
      let reads = 0;
      const raceCtx = { ...ctx, fsp: { ...fs, lstat: async (candidate) => {
        if (candidate === file && ++reads === 2) {
          await fs.appendFile(file, JSON.stringify({ type: 'last-prompt', timestamp: new Date().toISOString() }) + '\n');
        }
        return fs.lstat(candidate);
      } } };
      assert.equal((await target('mem.ingest').run(envFor(raceCtx))).status, STATUS.UNKNOWN);
      await fs.appendFile(file, JSON.stringify({ type: 'user', message: { content: 'old unarchived turn' }, timestamp: old }) + '\n');
      assert.equal((await target('mem.ingest').run(envFor(ctx))).status, STATUS.UNKNOWN);
      now += 2 * 3600_000 + 1;
      assert.equal((await target('mem.ingest').run(envFor(ctx))).status, STATUS.BROKEN);
      await fs.appendFile(file, JSON.stringify({ type: 'assistant', message: { content: 'newer unarchived reply' }, timestamp: new Date().toISOString() }) + '\n');
      assert.equal((await target('mem.ingest').run(envFor(ctx))).status, STATUS.BROKEN);
      await fs.appendFile(file, JSON.stringify({ type: 'last-prompt', timestamp: new Date().toISOString() }) + '\n');
      let swapped = false;
      const swapCtx = { ...ctx, fsp: { ...fs, open: async (candidate, flags) => {
        if (candidate === file && !swapped) {
          swapped = true;
          await fs.rename(file, link);
          await fs.symlink(link, file);
        }
        return fs.open(candidate, flags);
      } } };
      const swappedVerdict = await target('mem.ingest').run(envFor(swapCtx));
      assert.equal(swapped, true);
      assert.equal(swappedVerdict.status, STATUS.UNKNOWN);
      await fs.rename(source, path.join(root, 'missing-source'));
      assert.match((await target('mem.ingest').run(envFor(ctx))).detail, /MISSING/);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});

describe('mem.ingest incremental transcript parse', () => {
  it('parses only the appended bytes of a grown transcript and re-parses a rewritten one', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'node-watch-ingest-delta-'));
    try {
      const home = path.join(root, '.openclaw');
      const source = path.join(root, 'transcripts');
      await fs.mkdir(path.join(home, 'config'), { recursive: true });
      await fs.mkdir(source);
      await fs.writeFile(path.join(home, 'config', 'transcript-sources.json'), JSON.stringify({
        sources: [{ name: 'test', path: source, format: 'claude-code', enabled: true }],
      }));
      const file = path.join(source, 'live.jsonl');
      const base = Date.now() - 60_000;
      const turn = (n) => JSON.stringify({ type: n % 2 ? 'user' : 'assistant', message: { content: `turn ${n}` },
        timestamp: new Date(base + n).toISOString() });
      await fs.writeFile(file, `${turn(1)}\n${turn(2)}\n`);
      let archived = { count: 2, last: JSON.parse(turn(2)).timestamp };
      const starts = [];
      const ctx = makeCtx({
        config: { ...config, home, stateDb: path.join(home, 'state.db') },
        fsp: { ...fs, open: async (candidate, flags) => {
          const handle = await fs.open(candidate, flags);
          const createReadStream = handle.createReadStream.bind(handle);
          handle.createReadStream = (opts) => { starts.push(opts?.start ?? 0); return createReadStream(opts); };
          return handle;
        } },
        observeIngestLag: () => ({ overdue: [], lower: [] }),
        queryDb: (_p, fn) => fn({ prepare: (sql) => ({ get: () => sql.includes('archived_session_id')
          ? { archived_session_id: 'live', message_count: archived.count, end_time: archived.last, actual_count: archived.count }
          : { n: archived.count } }) }),
      });
      const verdict = async () => (await target('mem.ingest').run(envFor(ctx))).status;
      assert.equal(await verdict(), STATUS.WORKING);
      assert.deepEqual(starts, [0]);

      const grownFrom = (await fs.stat(file)).size;
      await fs.appendFile(file, `${turn(3)}\n`);
      archived = { count: 3, last: JSON.parse(turn(3)).timestamp };
      starts.length = 0;
      assert.equal(await verdict(), STATUS.WORKING);
      assert.deepEqual(starts, [grownFrom], 'only the appended line is parsed');

      // An unterminated final line counts exactly as a full parse would count it.
      const partialFrom = (await fs.stat(file)).size;
      await fs.appendFile(file, turn(4));
      archived = { count: 4, last: JSON.parse(turn(4)).timestamp };
      starts.length = 0;
      assert.equal(await verdict(), STATUS.WORKING);
      assert.deepEqual(starts, [partialFrom]);
      await fs.appendFile(file, `\n${turn(5)}\n`);
      archived = { count: 5, last: JSON.parse(turn(5)).timestamp };
      starts.length = 0;
      assert.equal(await verdict(), STATUS.WORKING);
      assert.deepEqual(starts, [partialFrom], 'the uncommitted tail is re-read once it completes');

      // Same inode, different prefix, larger size: the cached prefix is no longer valid.
      await fs.writeFile(file, [7, 8, 9, 10, 11, 12].map(turn).join('\n') + '\n');
      archived = { count: 6, last: JSON.parse(turn(12)).timestamp };
      starts.length = 0;
      assert.equal(await verdict(), STATUS.WORKING);
      assert.deepEqual(starts, [0]);

      await fs.writeFile(file, `${turn(1)}\n`);
      archived = { count: 1, last: JSON.parse(turn(1)).timestamp };
      starts.length = 0;
      assert.equal(await verdict(), STATUS.WORKING);
      assert.deepEqual(starts, [0], 'a shrunk transcript is re-parsed from the start');
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});

describe('node-watch CLI exit contract', () => {
  it('a bad flag exits 3 (harness error), not 1 (BROKEN)', () => {
    const r = spawnSync(process.execPath, [BIN, '--bogus'], { encoding: 'utf8' });
    assert.equal(r.status, 3, r.stderr);
    assert.match(r.stderr, /Usage: node-watch\.mjs/);
  });
  it('an unknown --axis in --watch mode exits 3 instead of looping on tick errors', () => {
    const r = spawnSync(process.execPath, [BIN, '--watch', '--quiet', '--axis', 'TYPO_AXIS'], { encoding: 'utf8', timeout: 10_000 });
    assert.equal(r.status, 3, r.stderr);
    assert.match(r.stderr, /unknown axis 'TYPO_AXIS'/);
  });
});

describe('OPENCLAW_HOME node isolation', () => {
  it('runWatch hands the spawn tree state.db and workspace to the L1 health check', async () => {
    const spawn = resolveNodeConfig({ OPENCLAW_HOME: '/tmp/spawn/.openclaw-n2', OPENCLAW_NODE_ID: 'n2' });
    let seen;
    await runWatch({ ctx: makeCtx({ config: spawn }), config: spawn, probes: {}, targets: [target('obs.links')],
      includeHeavy: false, healthCheckFn: async (o) => { seen = o; return {}; } });
    assert.equal(seen.stateDb, '/tmp/spawn/.openclaw-n2/state.db');
    assert.equal(seen.workspace, '/tmp/spawn/.openclaw-n2/workspace');
  });

  it('a ~ transcript source expands to the user home, not into a spawn tree', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'node-watch-tilde-'));
    try {
      const home = path.join(root, '.openclaw-n2');
      await fs.mkdir(path.join(home, 'config'), { recursive: true });
      await fs.writeFile(path.join(home, 'config', 'transcript-sources.json'), JSON.stringify({
        sources: [{ name: 'tilde', path: '~/.no-such-openclaw-source-dir/', format: 'claude-code', enabled: true }],
      }));
      const ctx = makeCtx({ config: { ...config, home, stateDb: path.join(home, 'state.db') }, fsp: fs,
        queryDb: (_p, fn) => fn({ prepare: () => ({ get: () => ({ n: 0 }) }) }) });
      const v = await target('mem.ingest').run(envFor(ctx));
      assert.ok(v.detail.includes(path.join(os.homedir(), '.no-such-openclaw-source-dir')), v.detail);
      assert.ok(!v.detail.includes(home), v.detail);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});
