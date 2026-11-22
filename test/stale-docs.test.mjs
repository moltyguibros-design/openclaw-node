import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const read = (rel) => fs.readFileSync(fileURLToPath(new URL(`../${rel}`, import.meta.url)), 'utf8');

// GitHub's heading slug: lowercase, drop everything but letters, digits, spaces and hyphens, spaces to hyphens.
const slug = (heading) => heading.trim().toLowerCase().replace(/[^\p{L}\p{N} _-]/gu, '').replace(/ /g, '-');

test('every in-page link of the circling V3 reference resolves to a heading', () => {
  const doc = read('docs/circling-strategy-implementationV3.md');
  const anchors = new Set([...doc.matchAll(/^#{1,6} (.+)$/gm)].map((m) => slug(m[1])));
  const links = [...doc.matchAll(/\]\(#([^)]+)\)/g)].map((m) => m[1]);
  assert.ok(links.length > 0);
  for (const link of links) assert.ok(anchors.has(link), `#${link} has no heading`);
});

test('mission-control/README.md points at the deploy runbook and the token bootstrap', () => {
  const readme = read('mission-control/README.md');
  assert.match(readme, /workspace-docs\/RUNBOOK_MC_DEPLOY\.md/);
  assert.match(readme, /mc-session-token/);
  assert.doesNotMatch(readme, /create-next-app/);
});

test('the Mission Control deploy runbook leads with install.sh --update and covers both service managers', () => {
  const runbook = read('workspace-docs/RUNBOOK_MC_DEPLOY.md');
  assert.match(runbook, /install\.sh --update/);
  assert.match(runbook, /systemctl --user restart openclaw-mission-control/);
  assert.match(runbook, /launchctl kickstart -k gui\/\$\(id -u\)\/ai\.openclaw\.mission-control/);
  assert.doesNotMatch(runbook, /gui\/501|only via this procedure|~\/openclaw-nodedev/);
  assert.doesNotMatch(read('workspace-docs/RUNBOOK_HYPERAGENT_SYNTHESIS.md'), /until 1\.1 lands/);
});

test('the 2026-09-06 remediation plan says it is historical and what has landed', () => {
  const head = read('REMEDIATION_PLAN_2026-09-06.md').split('\n').slice(0, 6).join('\n');
  assert.match(head, /^\*\*Status:\*\* historical\. Phases 0–3 landed/m);
});

// The listener's mesh.deploy.status.<nodeId> responder stays: fleet-deploy --status
// queries it (mesh-ops-nats#27), so mesh-ops-nats~2#21 removed only the leftovers.
test('deploy tooling carries no mesh-deploy-v2 pointer or unused imports, and its status responder has a caller', () => {
  assert.match(read('bin/mesh-deploy-listener.js'), /mesh\.deploy\.status\.\$\{NODE_ID\}/);
  assert.match(read('bin/fleet-deploy.js'), /mesh\.deploy\.status\.\$\{nodeId\}/);
  const fleet = read('bin/fleet-deploy.js');
  assert.doesNotMatch(fleet, /mesh-deploy-v2/);
  assert.doesNotMatch(fleet, /require\('fs'\)/);
  assert.doesNotMatch(read('bin/mesh.js'), /createInbox/);
  assert.doesNotMatch(read('bin/spawn-node.mjs'), /createRequire/);
});
