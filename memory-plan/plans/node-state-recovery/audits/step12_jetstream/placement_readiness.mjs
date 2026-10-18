import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash } from 'node:crypto';

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

export function placementState(observations, names) {
  const expected = [...names].sort();
  const ids = new Set(observations.map(row => row.js.server_id));
  const leaders = new Set(observations.map(row => row.js.meta_cluster?.leader));
  const leader = observations.find(row => row.name === row.js.meta_cluster?.leader)?.js.meta_cluster;
  const checks = {
    cohort: observations.length === names.length
      && JSON.stringify(observations.map(row => row.name).sort()) === JSON.stringify(expected),
    identities: ids.size === names.length && observations.every(({ name, js, routes, varz }) =>
      varz.server_name === name && varz.server_id === js.server_id && routes.server_id === js.server_id),
    leaderAgreement: leaders.size === 1 && typeof [...leaders][0] === 'string',
    membership: Array.isArray(leader?.replicas)
      && JSON.stringify([leader.leader, ...leader.replicas.map(peer => peer.name)].sort()) === JSON.stringify(expected),
    currentPeers: Array.isArray(leader?.replicas) && leader.replicas.length === names.length - 1
      && leader.replicas.every(peer => peer.current && !peer.offline),
    clusterSizes: observations.every(row => row.js.meta_cluster?.cluster_size === names.length),
    routePeers: observations.every(row => new Set(row.routes.routes.map(peer => peer.remote_id)).size === names.length - 1),
    confinedRoutes: observations.every(row => row.routes.routes.every(peer =>
      peer.ip === '127.0.0.1' && peer.remote_id !== row.js.server_id && ids.has(peer.remote_id)))
  };
  return { ready: Object.values(checks).every(Boolean), checks };
}

export async function waitCluster(items, names, milliseconds = 15000) {
  const end = Date.now() + milliseconds;
  let observations;
  while (Date.now() < end) {
    const read = async (item, endpoint) => {
      const response = await fetch(`http://127.0.0.1:${item.monitor}/${endpoint}`, {
        signal: AbortSignal.timeout(Math.max(1, Math.min(2000, end - Date.now())))
      });
      assert(response.ok);
      return response.json();
    };
    try {
      observations = await Promise.all(items.map(async item => ({
        name: item.name, js: await read(item, 'jsz'), routes: await read(item, 'routez'), varz: await read(item, 'varz')
      })));
    } catch (error) {
      if (error.name === 'TimeoutError' && Date.now() >= end) break;
      throw error;
    }
    if (placementState(observations, names).ready) return observations;
    await delay(Math.min(50, Math.max(0, end - Date.now())));
  }
  throw new Error('owned placement cluster not ready');
}

export async function addR3WithEvidence(manager, config, items, observations, phase, output, emit = console.error) {
  const offsets = items.map(item => {
    const file = item.log || item.config + '.log';
    return { name: item.name, file, from: fs.statSync(file).size };
  });
  try {
    return await manager.streams.add(config);
  } catch (error) {
    try {
      const windows = offsets.map(({ name, file, from }) => {
        const fd = fs.openSync(file, 'r');
        let to, window, complete;
        try {
          to = fs.fstatSync(fd).size;
          const length = to - from;
          complete = length >= 0 && length <= 131072;
          window = complete ? Buffer.alloc(length) : Buffer.alloc(0);
          if (complete) assert.equal(fs.readSync(fd, window, 0, length, from), length);
        } finally {
          fs.closeSync(fd);
        }
        const lines = complete ? window.toString('utf8').split('\n').flatMap(line => {
          const index = line.indexOf('Peer selection:');
          return index < 0 ? [] : [line.slice(index)];
        }) : [];
        return { name, from, to, complete: complete && lines.every(line => line.length <= 1024),
          sha256: complete ? createHash('sha256').update(window).digest('hex') : null,
          selection: lines.every(line => line.length <= 1024) ? lines : [] };
      });
      const state = placementState(observations, items.map(item => item.name));
      const report = { schema: 'owned-r3-placement-failure-v1', phase, attempts: 1,
        failedAt: new Date().toISOString(),
        preCreate: { source: 'caller-supplied-observations', ready: state.ready, checks: state.checks,
          observedAt: observations.map(row => ({ name: row.name, at: row.js.now })),
          members: observations.map(row => ({ name: row.name, serverId: row.js.server_id,
            leader: row.js.meta_cluster?.leader })) },
        error: { name: error.name, code: error.code, apiCode: error.api_error?.code,
          apiErrorCode: error.api_error?.err_code,
          peerOffline: error.message === 'no suitable peers for placement, peer offline' }, windows };
      fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
      emit('owned-r3-placement-failure: ' + JSON.stringify(report));
    } catch (captureError) {
      console.error('owned-r3-placement-evidence-unavailable: ' + captureError.name);
    }
    throw error;
  }
}
