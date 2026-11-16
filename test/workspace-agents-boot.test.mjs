import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

// identity/ is the one source of the workspace AGENTS.md (install.sh and mesh deploy).
const docs = ['identity/AGENTS.md'].map((rel) => fileURLToPath(new URL(`../${rel}`, import.meta.url)));

test('boot step checks Mission Control through mc-health and never starts a dev server', () => {
  for (const p of docs) {
    const step = fs.readFileSync(p, 'utf8').split('\n').find((l) => /^10\. /.test(l));
    assert.ok(step, `${p}: boot step 10 missing`);
    assert.match(step, /`node bin\/mc-health\.mjs`/, p);
    assert.match(step, /`node bin\/mc-health\.mjs --restart`/, p);
    assert.match(step, /Never start a development server/, p);
    assert.doesNotMatch(step, /cd projects\/mission-control/, p);
    assert.doesNotMatch(step, /curl -s localhost:3000/, p);
  }
});
