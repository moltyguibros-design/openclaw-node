import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { spawn, execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { createHash, randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { placementState, waitCluster, addR3WithEvidence } from './placement_readiness.mjs';

export const NAMES = ['member-1', 'member-2', 'member-3'];
export const VERSION = 'nats-server: v2.12.6';
export const REFUSAL = 'no suitable peers for placement, peer offline';
export const DENY = '$SYS.SERVER.*.STATSZ';
const PRODUCTION_PORTS = [4222, 4223, 4224, 6222, 6223, 6224, 8222, 8223, 8224];
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const sha = value => createHash('sha256').update(value).digest('hex');
const save = (file, value) => fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n', { mode: 0o600, flag: 'wx' });

export function apiDeltas(cohort) {
  if (cohort.apiBefore.length !== 3 || cohort.apiAfter.length !== 3) return null;
  const result = [];
  for (const name of NAMES) {
    const before = cohort.apiBefore.filter(row => row.name === name);
    const after = cohort.apiAfter.filter(row => row.name === name);
    const ready = cohort.ready.find(row => row.name === name);
    if (before.length !== 1 || after.length !== 1 || !ready
        || before[0].server_id !== ready.js.server_id || after[0].server_id !== ready.js.server_id) return null;
    result.push({ name, total: after[0].api.total - before[0].api.total,
      errors: after[0].api.errors - before[0].api.errors });
  }
  return result;
}

export function leaderReason(cohort) {
  if (!cohort.ready.length) return false;
  const leader = cohort.ready[0].js.meta_cluster?.leader;
  const window = cohort.selection.find(row => row.name === leader);
  if (!window || window.from < 0 || window.to < window.from || window.truncated) return false;
  const others = NAMES.filter(name => name !== leader);
  const discardLines = window.lines.filter(line => line.includes('Peer selection: discard '));
  const summaries = window.lines.filter(line => line.includes('Peer selection: required '));
  if (window.lines.length !== discardLines.length + summaries.length || summaries.length !== 1) return false;
  const matches = discardLines.map(line => line.match(/Peer selection: discard ([^@\s]+)@recovery-fixture reason: offline$/));
  if (matches.some(match => !match)) return false;
  const discarded = matches.map(match => match[1]);
  if (new Set(discarded).size !== discarded.length || !discarded.every(name => NAMES.includes(name))) return false;
  const remaining = NAMES.length - discarded.length;
  const line = summaries[0];
  const summary = line.match(/Peer selection: required (\d+) nodes but found (\d+) \(cluster: recovery-fixture replica: 3 existing: \[\]\/0 peers: (\d+) result-peers: (\d+) err: \{.*\}\)$/);
  return others.length === 2 && others.every(name => discarded.includes(name)) && summary !== null
    && Number(summary[1]) === 3 && Number(summary[3]) === 3
    && Number(summary[2]) === remaining && Number(summary[4]) === remaining
    && line.includes('offline:true') && line.includes('misc:false');
}

export function classifyDiagnosis(report) {
  const { control, fault } = report;
  const normal = row => row.cleanupFailures.length === 0 && row.owners.length === 3
    && NAMES.every(name => row.owners.filter(owner => owner.name === name && owner.exitCode === 0
      && owner.signalCode === null && owner.shutdownMarker).length === 1);
  const counts = (row, errors) => {
    const deltas = apiDeltas(row);
    return deltas !== null && deltas.every(delta => delta.total >= 0 && delta.errors >= 0)
      && deltas.reduce((n, delta) => n + delta.total, 0) === 1
      && deltas.reduce((n, delta) => n + delta.errors, 0) === errors;
  };
  const checks = {
    version: report.binary.version === VERSION,
    controlReady: placementState(control.ready, NAMES).ready,
    faultReady: placementState(fault.ready, NAMES).ready,
    injections: control.fault === false && fault.fault === true
      && control.discoveryConnections === 3 && fault.discoveryConnections === 3,
    singleCreate: control.attempts === 1 && fault.attempts === 1,
    controlCreated: control.outcome === 'created' && control.response?.replicas === 3,
    exactRefusal: fault.outcome === 'refused' && fault.error?.code === '400'
      && fault.error?.api_error?.code === 400 && fault.error?.api_error?.err_code === 10005
      && fault.error?.message === REFUSAL && fault.error?.api_error?.description === REFUSAL,
    leaderReason: leaderReason(fault),
    controlApi: counts(control, 0),
    faultApi: counts(fault, 1),
    cleanup: normal(control) && normal(fault),
    isolation: control.root !== fault.root && control.ports.length === 9 && fault.ports.length === 9
      && new Set([...control.ports, ...fault.ports]).size === 18
      && [...control.ports, ...fault.ports].every(port => !PRODUCTION_PORTS.includes(port)),
  };
  return { outcome: Object.values(checks).every(Boolean) ? 'owned-counterexample' : 'inconclusive', checks };
}

async function ports(excluded) {
  const held = [], chosen = [];
  try {
    while (chosen.length < 9) {
      const socket = net.createServer();
      socket.listen(0, '127.0.0.1');
      await once(socket, 'listening');
      held.push(socket);
      const port = socket.address().port;
      assert(!PRODUCTION_PORTS.includes(port), 'owned allocator selected a production port');
      if (!excluded.has(port)) chosen.push(port);
    }
    return chosen;
  } finally {
    await Promise.all(held.map(socket => new Promise(resolve => socket.close(resolve))));
  }
}

async function jsSnapshot(members) {
  return Promise.all(members.map(async member => {
    const response = await fetch(`http://127.0.0.1:${member.monitor}/jsz`, { signal: AbortSignal.timeout(2000) });
    assert(response.ok, 'owned counter observation refused');
    const js = await response.json();
    return { name: member.name, server_id: js.server_id, now: js.now, api: js.api };
  }));
}

async function stop(member) {
  if (member.proc.exitCode === null && member.proc.signalCode === null) {
    const ended = once(member.proc, 'exit');
    member.proc.kill('SIGTERM');
    let timer;
    try {
      await Promise.race([ended, new Promise((_, reject) => {
        timer = setTimeout(() => reject(Error('owned shutdown timeout')), 10000);
      })]);
    } finally { clearTimeout(timer); }
  }
  assert.equal(member.proc.exitCode, 0, 'owned process did not exit normally');
  assert(fs.readFileSync(member.log, 'utf8').includes('Server Exiting'), 'owned shutdown marker absent');
}

async function runCohort(binary, connect, root, fault, excluded) {
  fs.mkdirSync(root, { mode: 0o700 });
  const selected = await ports(excluded);
  const token = randomBytes(24).toString('hex'), password = randomBytes(24).toString('hex');
  const members = [], connections = [];
  const result = { root, fault, ports: selected, attempts: 0, discoveryConnections: 0, outcome: 'inconclusive',
    ready: [], apiBefore: [], apiAfter: [], selection: [], owners: [], cleanupFailures: [] };
  try {
    result.phase = 'start';
    for (let i = 0; i < 3; i++) {
      const config = path.join(root, `server-${i}.conf`), log = path.join(root, `server-${i}.log`);
      const permissions = fault
        ? `permissions { import { allow: [">"] , deny: ["${DENY}"] }, export { allow: [">"] , deny: ["${DENY}"] } }` : '';
      const routes = selected.filter((port, index) => index % 3 === 2 && index !== i * 3 + 2)
        .map(port => JSON.stringify(`nats-route://owned:${password}@127.0.0.1:${port}`)).join(',');
      fs.writeFileSync(config, `server_name: ${NAMES[i]}
server_tags: [${JSON.stringify(NAMES[i])}]
debug: true
listen: 127.0.0.1:${selected[i * 3]}
http: 127.0.0.1:${selected[i * 3 + 1]}
authorization { token: "${token}" }
jetstream { store_dir: ${JSON.stringify(path.join(root, `store-${i}`))}, max_memory_store: 1GB, max_file_store: 2GB }
cluster { name: recovery-fixture, listen: 127.0.0.1:${selected[i * 3 + 2]}, no_advertise: true,
 authorization { user: owned, password: "${password}" }, routes: [${routes}], ${permissions} }
`, { mode: 0o600, flag: 'wx' });
      const fd = fs.openSync(log, 'wx', 0o600);
      const proc = spawn(binary, ['--config', config], { stdio: ['ignore', fd, fd] });
      fs.closeSync(fd);
      const member = { name: NAMES[i], client: selected[i * 3], monitor: selected[i * 3 + 1], proc, log };
      members.push(member);
      const end = Date.now() + 5000;
      let healthy = false;
      while (Date.now() < end) {
        assert.equal(proc.exitCode, null, 'owned server exited during startup');
        try {
          healthy = (await fetch(`http://127.0.0.1:${member.monitor}/healthz?js-enabled-only=true`,
            { signal: AbortSignal.timeout(500) })).ok;
        } catch {}
        if (healthy) break;
        await delay(50);
      }
      assert(healthy, 'owned server health deadline expired');
    }
    result.phase = 'discovery';
    for (const member of members) {
      const nc = await connect({ servers: `nats://127.0.0.1:${member.client}`, token, reconnect: false,
        ignoreClusterUpdates: true, timeout: 3000, name: 'owned-gossip-probe' });
      connections.push(nc);
      assert.equal(nc.info.server_name, member.name);
      result.discoveryConnections++;
    }
    result.phase = 'existing-placement-gate';
    result.ready = await waitCluster(members, NAMES);
    result.evaluation = placementState(result.ready, NAMES);
    assert(result.evaluation.ready, 'unchanged placement gate must pass');
    result.phase = 'manager';
    const manager = await connections[0].jetstreamManager();
    result.connectedMember = members[0].name;
    result.apiBefore = await jsSnapshot(members);
    const offsets = members.map(member => fs.statSync(member.log).size);
    result.phase = 'single-r3-create';
    result.attempts++;
    try {
      const response = await addR3WithEvidence(manager, { name: 'GOSSIP_PROBE', subjects: ['gossip-probe'],
        storage: 'file', num_replicas: 3 }, members, result.ready,
      fault ? 'injected-stats-denied-r3-create' : 'control-r3-create', path.join(root, 'placement-failure.json'));
      result.response = { name: response.config.name, replicas: response.config.num_replicas };
      result.outcome = 'created';
    } catch (error) {
      result.error = { name: error.name, code: error.code, message: error.message, api_error: error.api_error };
      result.outcome = 'refused';
    }
    result.apiAfter = await jsSnapshot(members);
    result.counterIncrementMembers = apiDeltas(result).filter(row => row.total > 0).map(row => row.name);
    result.selection = members.map((member, i) => {
      const buffer = fs.readFileSync(member.log);
      return { name: member.name, from: offsets[i], to: buffer.length, truncated: false,
        lines: buffer.subarray(offsets[i]).toString('utf8').split('\n').filter(line => line.includes('Peer selection:')) };
    });
  } catch (error) {
    result.outcome = 'inconclusive';
    result.observationError = { name: error.name, message: error.message };
  } finally {
    for (const nc of connections) {
      try { await nc.close(); }
      catch (error) { result.cleanupFailures.push({ connection: 'owned', error: error.message }); }
    }
    for (const member of members) {
      try { await stop(member); }
      catch (error) {
        result.cleanupFailures.push({ name: member.name, pid: member.proc.pid, error: error.message });
        if (member.proc.exitCode === null && member.proc.signalCode === null) {
          const ended = once(member.proc, 'exit');
          member.proc.kill('SIGKILL');
          await ended;
        }
      }
      result.owners.push({ name: member.name, pid: member.proc.pid, exitCode: member.proc.exitCode,
        signalCode: member.proc.signalCode, shutdownMarker: fs.readFileSync(member.log, 'utf8').includes('Server Exiting') });
    }
    const serialized = JSON.stringify(result);
    assert(!serialized.includes(token) && !serialized.includes(password), 'owned credentials must not enter evidence');
    save(path.join(root, 'result.json'), result);
  }
  return result;
}

export async function runDiagnosis(binary = process.env.NATS_SERVER || 'nats-server', output) {
  const candidate = binary.includes(path.sep) ? path.resolve(binary)
    : (process.env.PATH || '').split(path.delimiter).map(dir => path.join(dir, binary)).find(file => fs.existsSync(file));
  assert(candidate, 'owned NATS binary absent');
  const executable = fs.realpathSync(candidate);
  const version = execFileSync(executable, ['--version'], { encoding: 'utf8', timeout: 5000 }).trim();
  assert.equal(version, VERSION, 'probe pins the exact upstream debug wording and server version');
  const { connect } = createRequire(import.meta.url)('nats');
  process.umask(0o077);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'owned-placement-gossip-'));
  const report = { scope: 'owned placement-gossip diagnosis; not admission', historicalCauseEstablished: false,
    repair: false, root, node: process.version, binary: { path: executable, version, sha256: sha(fs.readFileSync(executable)) },
    helperSha256: { placementState: sha(placementState.toString()), waitCluster: sha(waitCluster.toString()) } };
  report.control = await runCohort(executable, connect, path.join(root, 'control'), false, new Set());
  report.fault = await runCohort(executable, connect, path.join(root, 'stats-denied'), true, new Set(report.control.ports));
  report.diagnosis = classifyDiagnosis(report);
  save(path.join(root, 'experiment.json'), report);
  if (output) save(output, report);
  return report;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const report = await runDiagnosis(process.argv[2], process.argv[3]);
  console.log(JSON.stringify(report));
  if (report.diagnosis.outcome !== 'owned-counterexample') process.exitCode = 2;
}
