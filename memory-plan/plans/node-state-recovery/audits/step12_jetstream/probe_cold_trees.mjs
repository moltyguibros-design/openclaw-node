import assert from 'node:assert/strict';
import { randomBytes, createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { api, capture, copyCold, hashTree, jsonPrivate, openBus, privateDir, writePrivate } from './recovery.mjs';

const [planFile, target] = process.argv.slice(2);
assert(planFile && target && path.isAbsolute(planFile) && path.isAbsolute(target) && !fs.existsSync(target),
  'usage: node probe_cold_trees.mjs <private-plan.json> <new-private-dir>');
process.umask(0o077);

const planStat = fs.lstatSync(planFile);
assert(planStat.isFile() && !planStat.isSymbolicLink() && planStat.uid === process.getuid() && !(planStat.mode & 0o077));
const plan = JSON.parse(fs.readFileSync(planFile, 'utf8'));
const roles = [plan.standalone, ...plan.cluster.members, plan.held];
let ancestor = path.dirname(target);
const missing = [path.basename(target)];
while (!fs.existsSync(ancestor)) {
  missing.unshift(path.basename(ancestor));
  ancestor = path.dirname(ancestor);
}
const targetReal = path.join(fs.realpathSync(ancestor), ...missing);
assert(roles.every(role => {
  assert(path.isAbsolute(role.master));
  const master = fs.realpathSync(role.master);
  return targetReal !== master && !targetReal.startsWith(master + path.sep) && !master.startsWith(targetReal + path.sep);
}), 'cold target overlaps master');
privateDir(target);
assert.equal(fs.realpathSync(target), targetReal);
const servers = [];
const connections = [];
const token = randomBytes(32).toString('hex');
const routeToken = randomBytes(32).toString('hex');
const forbidden = new Set([4222, 4223, 4224, 6222, 6223, 6224, 8222, 8223, 8224]);
const roleName = value => assert.match(value, /^[A-Za-z0-9_-]+$/);
let binaryReal;

function privateRegular(file) {
  const st = fs.lstatSync(file);
  assert(st.isFile() && !st.isSymbolicLink() && st.uid === process.getuid() && !(st.mode & 0o077));
}

function frozenTree(dir) {
  const st = fs.lstatSync(dir);
  assert(!st.isSymbolicLink() && st.uid === process.getuid() && !(st.mode & 0o277));
  if (st.isDirectory()) for (const name of fs.readdirSync(dir)) frozenTree(path.join(dir, name));
  else assert(st.isFile() && st.nlink === 1);
}

function baseline(role) {
  roleName(role.name);
  assert(path.isAbsolute(role.master) && path.isAbsolute(role.baseline));
  assert.match(role.masterSha256, /^[0-9a-f]{64}$/);
  privateRegular(role.baseline);
  frozenTree(role.master);
  const data = JSON.parse(fs.readFileSync(role.baseline, 'utf8'));
  assert.equal(data.serverInfo.server_name, role.name);
  assert(Array.isArray(data.streams) && data.streams.length > 0);
  assert.equal(new Set(data.streams.map(row => row.stream)).size, data.streams.length);
  for (const row of data.streams) {
    roleName(row.stream);
    assert(row.offline === true || row.snapshot?.content?.sha256);
  }
  return data;
}

function treeHash(dir) {
  return createHash('sha256').update(JSON.stringify(hashTree(dir))).digest('hex');
}

async function ports(count) {
  const sockets = [];
  for (let i = 0; i < count; i++) {
    const socket = net.createServer();
    socket.listen(0, '127.0.0.1');
    await once(socket, 'listening');
    sockets.push(socket);
  }
  const selected = sockets.map(socket => socket.address().port);
  assert(selected.every(port => !forbidden.has(port)));
  await Promise.all(sockets.map(socket => new Promise(resolve => socket.close(resolve))));
  return selected;
}

async function monitor(port, endpoint) {
  const response = await fetch(`http://127.0.0.1:${port}/${endpoint}`, { signal: AbortSignal.timeout(2000) });
  assert(response.ok);
  return response.json();
}

async function start(role, selected, cluster, suffix = '') {
  const working = path.join(target, 'working-' + role.name + suffix);
  copyCold(role.master, working);
  const [client, http, route] = selected;
  const config = path.join(target, 'config-' + role.name + suffix + '.conf');
  let value = `server_name: ${role.name}\nlisten: 127.0.0.1:${client}\nhttp: 127.0.0.1:${http}\nauthorization { token: ${JSON.stringify(token)} }\njetstream { store_dir: ${JSON.stringify(working)}, max_memory_store: 20GB, max_file_store: 1TB }\n`;
  if (cluster) value += `cluster { name: ${cluster.name}, listen: 127.0.0.1:${route}, no_advertise: true, authorization { user: recovery, password: ${JSON.stringify(routeToken)} }, routes: [${cluster.routes.filter(port => port !== route).map(port => JSON.stringify(`nats-route://recovery:${routeToken}@127.0.0.1:${port}`)).join(',')}] }\n`;
  writePrivate(config, value);
  const log = path.join(target, 'log-' + role.name + suffix + '.txt');
  const fd = fs.openSync(log, 'wx', 0o600);
  const proc = spawn(binaryReal, ['--config', config], { stdio: ['ignore', fd, fd] });
  fs.closeSync(fd);
  const item = { role: role.name, proc, client, http, route, working, log };
  servers.push(item);
  for (let attempt = 0; attempt < 100; attempt++) {
    assert.equal(proc.exitCode, null, `cold probe server exited: ${role.name}`);
    try {
      const response = await fetch(`http://127.0.0.1:${http}/healthz?js-enabled-only=true`, { signal: AbortSignal.timeout(2000) });
      if (response.ok) return item;
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`cold probe server startup timeout: ${role.name}`);
}

async function stop(item) {
  if (item.proc.exitCode === null && item.proc.signalCode === null) {
    const exited = once(item.proc, 'exit');
    item.proc.kill('SIGTERM');
    let timer;
    try {
      await Promise.race([exited, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`cold probe server stop timeout: ${item.role}`)), 10000); })]);
    } finally { clearTimeout(timer); }
  }
  assert.equal(item.proc.exitCode, 0, `cold probe server did not exit normally: ${item.role}`);
  assert.match(fs.readFileSync(item.log, 'utf8'), /Server Exiting/);
}

async function bus(item) {
  const nc = await openBus(`nats://127.0.0.1:${item.client}`, token);
  connections.push(nc);
  assert.equal(nc.info.server_name, item.role);
  const varz = await monitor(item.http, 'varz');
  assert.equal(varz.server_id, nc.info.server_id);
  const connz = await monitor(item.http, 'connz?limit=100');
  assert.equal(connz.total, 1, `unexpected client on isolated ${item.role}`);
  assert(connz.connections.every(connection => connection.ip === '127.0.0.1' && connection.name.startsWith('recovery-readonly-')));
  const leafz = await monitor(item.http, 'leafz');
  assert.equal(leafz.leafnodes, 0);
  const gatewayz = await monitor(item.http, 'gatewayz');
  assert.equal(Object.keys(gatewayz.outbound_gateways || {}).length, 0);
  assert.equal(Object.keys(gatewayz.inbound_gateways || {}).length, 0);
  return nc;
}

async function names(nc, timeout = 10000) {
  const found = [];
  for (let offset = 0;;) {
    const page = await api(nc, '$JS.API.STREAM.NAMES', { offset }, timeout);
    found.push(...page.streams);
    offset += page.streams.length;
    if (offset >= page.total) break;
    assert(page.streams.length > 0);
  }
  return found.sort();
}

async function exactNames(nc, expected, timeout = 10000) {
  assert.deepEqual(await names(nc, timeout), [...expected].sort(), 'isolated stream inventory mismatch');
}

async function waitExactNames(nc, expected) {
  const deadline = performance.now() + 20000;
  for (;;) {
    try {
      await exactNames(nc, expected, 2000);
      return;
    } catch (err) {
      if (err.code !== 'TIMEOUT' || performance.now() >= deadline) throw err;
      await new Promise(resolve => setTimeout(resolve, 200));
    }
  }
}

async function compare(nc, data, selected = data.streams.map(row => row.stream)) {
  const rows = data.streams.filter(row => selected.includes(row.stream));
  assert.deepEqual(rows.map(row => row.stream).sort(), [...selected].sort());
  const actualNames = await names(nc);
  for (const row of rows) {
    assert(actualNames.includes(row.stream), `missing cold stream: ${row.stream}`);
    if (row.offline) {
      await assert.rejects(api(nc, `$JS.API.STREAM.INFO.${row.stream}`), err => err.api?.code === 500 && err.api.description === 'stream is offline');
      continue;
    }
    const actual = await capture(nc, row.stream);
    const expected = row.snapshot;
    assert.deepEqual(actual.content, expected.content, `cold content mismatch: ${row.stream}`);
    assert.deepEqual(actual.config, expected.config, `cold config mismatch: ${row.stream}`);
    assert.equal(actual.created, expected.created, `cold creation timestamp mismatch: ${row.stream}`);
    for (const key of ['messages', 'bytes', 'first_seq', 'last_seq', 'num_deleted', 'deleted']) assert.deepEqual(actual.state[key], expected.state[key], `cold state mismatch: ${row.stream}/${key}`);
    assert.deepEqual(actual.consumers, expected.consumers, `cold consumer mismatch: ${row.stream}`);
  }
  return rows.map(row => ({ stream: row.stream, offline: !!row.offline, last: row.snapshot?.content.last }));
}

async function routes(items) {
  const ids = new Set(items.map(item => item.nc.info.server_id));
  assert.equal(ids.size, items.length);
  for (const item of items) {
    const result = await monitor(item.http, 'routez');
    const peers = result.routes.map(route => route.remote_id);
    assert.equal(new Set(peers).size, items.length - 1);
    assert(result.routes.every(route => route.ip === '127.0.0.1' && route.remote_id !== item.nc.info.server_id && ids.has(route.remote_id)));
  }
}

async function waitRoutes(items) {
  for (let attempt = 0; attempt < 150; attempt++) {
    try { await routes(items); return; } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('isolated cluster routes did not settle');
}

async function waitActive(nc, data) {
  for (const row of data.streams.filter(row => !row.offline)) {
    let online = false;
    for (let attempt = 0; attempt < 150; attempt++) {
      try { await api(nc, `$JS.API.STREAM.INFO.${row.stream}`, {}, 1000); online = true; break; } catch {}
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert(online, `isolated stream did not become available: ${row.stream}`);
  }
}

async function localState(item, data) {
  const jsz = await monitor(item.http, 'jsz?streams=true');
  const varz = await monitor(item.http, 'varz');
  assert.equal(jsz.server_id, varz.server_id);
  assert.equal(varz.server_name, item.role);
  assert.equal(fs.realpathSync(path.dirname(jsz.config.store_dir)), fs.realpathSync(item.working));
  assert(!jsz.meta_cluster?.leader, `isolated member unexpectedly has quorum: ${item.role}`);
  const details = (jsz.account_details || []).flatMap(account => account.stream_detail || []);
  assert.equal(new Set(details.map(row => row.name)).size, details.length, 'ambiguous local stream names');
  const checked = [];
  for (const row of data.streams.filter(row => !row.offline && row.snapshot.config.num_replicas > 1)) {
    const actual = details.find(detail => detail.name === row.stream);
    assert(actual, `missing local cold stream: ${item.role}/${row.stream}`);
    for (const key of ['messages', 'bytes', 'first_seq', 'last_seq']) {
      assert.equal(actual.state[key] || 0, row.snapshot.state[key] || 0,
        `local cold state mismatch: ${item.role}/${row.stream}/${key}`);
    }
    const deletionCount = state => (state.num_deleted || 0)
      - (state.messages === 0 && state.last_seq === 0 && state.deleted?.includes(0) ? 1 : 0);
    assert.equal(deletionCount(actual.state), deletionCount(row.snapshot.state),
      `local cold deletion count mismatch: ${item.role}/${row.stream}`);
    checked.push(row.stream);
  }
  return { member: item.role, streams: checked };
}

async function waitLeader(nc, stream, preferred, serving) {
  for (let attempt = 0; attempt < 150; attempt++) {
    try {
      const info = await api(nc, `$JS.API.STREAM.INFO.${stream}`, {}, 1000);
      const peers = info.cluster?.replicas || [];
      const other = serving.find(name => name !== preferred);
      const peer = peers.find(row => row.name === other);
      if (info.cluster?.leader === preferred && peer?.current && !peer.offline && !(peer.lag || 0)) return;
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`cold stream did not become current under ${preferred}: ${stream}`);
}

let failure;
let report;
let phase = 'validate';
try {
  assert(path.isAbsolute(plan.binary));
  binaryReal = fs.realpathSync(plan.binary);
  const binaryStat = fs.lstatSync(binaryReal);
  assert(binaryStat.isFile() && !binaryStat.isSymbolicLink() && (binaryStat.mode & 0o111));
  const binarySha256 = createHash('sha256').update(fs.readFileSync(binaryReal)).digest('hex');
  assert.equal(binarySha256, plan.binarySha256);
  assert.equal(plan.cluster.members.length, 2);
  assert(plan.cluster.offline.length > 0 && plan.held.streams.length > 0);
  roleName(plan.cluster.name);
  assert.equal(new Set(roles.map(role => role.name)).size, 4);
  assert.equal(new Set(roles.map(role => fs.realpathSync(role.master))).size, 4);
  const baselines = new Map(roles.map(role => [role.name, baseline(role)]));
  assert(!baselines.get(plan.standalone.name).serverInfo.cluster);
  for (const role of plan.cluster.members) assert.equal(baselines.get(role.name).serverInfo.cluster, plan.cluster.name);
  assert.equal(baselines.get(plan.held.name).serverInfo.cluster, plan.cluster.name);
  const firstCluster = baselines.get(plan.cluster.members[0].name);
  const secondCluster = baselines.get(plan.cluster.members[1].name);
  assert.deepEqual(firstCluster.streams.map(row => [row.stream, !!row.offline]), secondCluster.streams.map(row => [row.stream, !!row.offline]));
  assert.deepEqual(firstCluster.streams.filter(row => row.offline).map(row => row.stream).sort(), [...plan.cluster.offline].sort());
  assert.deepEqual([...plan.held.streams].sort(), [...plan.cluster.offline].sort(), 'held stream set omits an offline R1 history');
  assert.deepEqual(baselines.get(plan.held.name).streams.filter(row => row.snapshot?.config.num_replicas === 1)
    .map(row => row.stream).sort(), [...plan.cluster.offline].sort(), 'held baseline R1 stream set differs from offline assignments');
  for (const stream of plan.held.streams) {
    const row = baselines.get(plan.held.name).streams.find(row => row.stream === stream);
    assert(row?.snapshot && row.snapshot.config.num_replicas === 1);
  }
  const hashes = new Map(roles.map(role => [role.name, treeHash(role.master)]));
  for (const role of roles) assert.equal(hashes.get(role.name), role.masterSha256,
    `cold master differs from its recorded extraction: ${role.name}`);
  const selected = await ports(15);
  phase = 'standalone';
  const standalone = await start(plan.standalone, selected.slice(0, 3));
  const standaloneNC = await bus(standalone);
  await exactNames(standaloneNC, baselines.get(plan.standalone.name).streams.map(row => row.stream));
  const standaloneRows = await compare(standaloneNC, baselines.get(plan.standalone.name));
  phase = 'held';
  const held = await start(plan.held, selected.slice(9, 12));
  const heldNC = await bus(held);
  await exactNames(heldNC, plan.held.streams);
  const heldRows = await compare(heldNC, baselines.get(plan.held.name), plan.held.streams);
  phase = 'cluster';
  const clusterPorts = [selected.slice(3, 6), selected.slice(6, 9), selected.slice(12, 15)];
  const memberLocal = [];
  for (let i = 0; i < 2; i++) {
    const role = plan.cluster.members[i];
    phase = 'member-local-' + role.name;
    const item = await start(role, clusterPorts[i], { name: plan.cluster.name, routes: clusterPorts.map(row => row[2]) }, '-local');
    memberLocal.push(await localState(item, baselines.get(role.name)));
    await stop(item);
  }
  phase = 'cluster';
  const members = [];
  for (let i = 0; i < 2; i++) members.push(await start(plan.cluster.members[i], clusterPorts[i], { name: plan.cluster.name, routes: clusterPorts.map(row => row[2]) }));
  for (const item of members) item.nc = await bus(item);
  phase = 'cluster-routes';
  await waitRoutes(members);
  phase = 'cluster-streams-ready';
  await waitActive(members[0].nc, firstCluster);
  phase = 'cluster-streams-first-names';
  await waitExactNames(members[0].nc, firstCluster.streams.map(row => row.stream));
  phase = 'cluster-streams-second-names';
  await waitExactNames(members[1].nc, secondCluster.streams.map(row => row.stream));
  for (const stream of plan.cluster.offline) {
    phase = 'cluster-streams-offline-' + stream;
    try {
      await api(members[0].nc, `$JS.API.STREAM.INFO.${stream}`, {}, 1000);
      assert.fail(`held stream unexpectedly served without its master: ${stream}`);
    } catch (err) {
      if (err.api?.code !== 500 && err.code !== 'TIMEOUT') throw err;
    }
  }
  phase = 'cluster-compare';
  const activeStreams = firstCluster.streams.filter(row => !row.offline).map(row => row.stream);
  const memberReads = [];
  const serving = members.map(item => item.role);
  for (const item of members) {
    const data = baselines.get(item.role);
    for (const row of data.streams.filter(row => !row.offline && row.snapshot.config.num_replicas > 1)) {
      phase = 'cluster-member-reads-' + item.role;
      const before = await api(item.nc, `$JS.API.STREAM.INFO.${row.stream}`);
      if (before.cluster?.leader !== item.role) {
        await api(item.nc, `$JS.API.STREAM.LEADER.STEPDOWN.${row.stream}`,
          { placement: { preferred: item.role } });
      }
      await waitLeader(item.nc, row.stream, item.role, serving);
      await compare(item.nc, data, [row.stream]);
      await waitLeader(item.nc, row.stream, item.role, serving);
      memberReads.push({ member: item.role, stream: row.stream });
    }
  }
  phase = 'cluster-compare';
  const clusterRows = await compare(members[0].nc, firstCluster, activeStreams);
  await compare(members[1].nc, secondCluster, activeStreams);
  phase = 'cluster-held-rejoin';
  const rejoined = await start(plan.held, clusterPorts[2], { name: plan.cluster.name, routes: clusterPorts.map(row => row[2]) }, '-cluster');
  rejoined.nc = await bus(rejoined);
  members.push(rejoined);
  await waitRoutes(members);
  await waitActive(members[0].nc, baselines.get(plan.held.name));
  await exactNames(members[0].nc, baselines.get(plan.held.name).streams.map(row => row.stream));
  const rejoinedRows = await compare(members[0].nc, baselines.get(plan.held.name), plan.held.streams);
  assert.deepEqual(rejoinedRows, heldRows);
  for (const item of members) assert.equal((await monitor(item.http, 'connz?limit=100')).total, 1);
  for (const role of roles) assert.equal(treeHash(role.master), hashes.get(role.name), `cold master changed: ${role.name}`);
  report = { scope: 'isolated direct-store mechanism probe; not host provenance or production acceptance', at: new Date().toISOString(), binary: binaryReal, binarySha256, roles: roles.map(role => ({ role: role.name, masterSha256: hashes.get(role.name) })), standalone: standaloneRows, held: heldRows, cluster: clusterRows, memberLocal, memberReads, offlineBeforeRejoin: [...plan.cluster.offline], rejoined: rejoinedRows };
} catch (err) { failure = err; }

for (const nc of connections) {
  try { await nc.close(); } catch (err) { failure ||= err; }
}
for (const item of servers.reverse()) {
  try { await stop(item); }
  catch (err) {
    failure ||= err;
    if (item.proc.exitCode === null && item.proc.signalCode === null) {
      const exited = once(item.proc, 'exit'); item.proc.kill('SIGKILL'); await exited;
    }
  }
}
if (failure) {
  jsonPrivate(path.join(target, 'FAILED.json'), { at: new Date().toISOString(), phase, error: failure.message, scope: 'cold probe only' });
  throw failure;
}
jsonPrivate(path.join(target, 'probe.json'), report);
console.log(JSON.stringify({ target, scope: report.scope, streams: { standalone: report.standalone.length, held: report.held.length, cluster: report.cluster.length } }));
