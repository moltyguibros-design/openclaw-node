/**
 * mesh-roles.js — the deploy components of the OpenClaw mesh and which role runs each.
 *
 * bin/mesh-deploy.js takes every MANIFEST entry's nodeFilter from this table and
 * refuses to start when the two id lists differ, so the deploy listener's filter
 * and the health record can never name a component the deploy tool does not have.
 */
const DEPLOY_COMPONENTS = [
  { id: 'mesh-daemons', nodeFilter: 'all' },
  { id: 'mesh-cli', nodeFilter: 'all' },
  { id: 'shared-lib', nodeFilter: 'all' },
  { id: 'mc', nodeFilter: 'lead' },
  { id: 'memory-daemon', nodeFilter: 'lead' },
  { id: 'workspace-bin', nodeFilter: 'all' },
  { id: 'memory-harness', nodeFilter: 'lead' },
  { id: 'souls', nodeFilter: 'all' },
  { id: 'skills', nodeFilter: 'all' },
  { id: 'boot', nodeFilter: 'lead' },
  { id: 'workspace-docs', nodeFilter: 'all' },
  { id: 'harness-rules', nodeFilter: 'all' },
  { id: 'config', nodeFilter: 'all' },
  { id: 'services', nodeFilter: 'all' },
  // Not from this repo: they install whatever npm / the companion remote serves,
  // so a fleet trigger never names them; only a local `mesh deploy --component` does.
  { id: 'openclaw', nodeFilter: 'all', localOnly: true },
  { id: 'companion', nodeFilter: 'lead', localOnly: true },
  { id: 'lane-watchdog', nodeFilter: 'lead' },
  { id: 'log-rotate', nodeFilter: 'lead' },
  { id: 'mesh-tool-discord', nodeFilter: 'lead' },
];

const runsOn = (comp, role) => comp.nodeFilter === 'all' || comp.nodeFilter === role;

const byRole = pick => ({
  lead: DEPLOY_COMPONENTS.filter(c => runsOn(c, 'lead') && pick(c)).map(c => c.id),
  worker: DEPLOY_COMPONENTS.filter(c => runsOn(c, 'worker') && pick(c)).map(c => c.id),
});

// What each role runs (advertised in its health record).
const ROLE_COMPONENTS = byRole(() => true);
// What a signed fleet mesh.deploy.trigger may name on each role.
const FLEET_COMPONENTS = byRole(c => !c.localOnly);

module.exports = { DEPLOY_COMPONENTS, ROLE_COMPONENTS, FLEET_COMPONENTS };
