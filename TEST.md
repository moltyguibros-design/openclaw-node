# Test Suite — openclaw-node

## Quick Start

```bash
# Run all unit tests (root + Mission Control)
npm run test:all

# Root tests only (node:test)
npm test

# Mission Control tests only (vitest)
npm run test:mc

# Integration tests (requires NATS)
npm run test:integration

# Single test file
node --test test/mesh-plans.test.js
```

## Test Runner

- **Root tests** (`test/`): Node.js built-in test runner (`node:test`) + `assert/strict`
- **Mission Control** (`mission-control/src/lib/__tests__/`): Vitest + `expect`
- No external test dependencies for root tests — runs on the CI matrix (Node 20 and 22)

## Root Tests (`test/`)

The tables list representative files, not the whole suite: `test/*.test.*` and
`mission-control/src/lib/__tests__/*.test.ts` are the full set.

### Unit Tests

| File | Module | What it covers |
|------|--------|----------------|
| `mesh-plans.test.js` | `lib/mesh-plans.js` | Plan creation, wave computation (DAG), delegation routing decision tree, PlanStore CRUD + lifecycle |
| `mesh-registry.test.js` | `lib/mesh-registry.js` | Tool registration to KV, NATS subscriptions, listTools, shutdown cleanup, remote call |
| `nats-resolve.test.js` | `lib/nats-resolve.js` | 4-step URL/token resolution chain (env var, openclaw.env, .mesh-config, fallback), natsConnectOpts |
| `agent-activity.test.js` | `lib/agent-activity.js` | Path encoding, JSONL session file discovery, activity state detection, cost/summary extraction |
| `memory-budget.test.mjs` | `lib/memory-budget.mjs` | Freeze/thaw lifecycle, character budget enforcement, trimming, event emission, stats |
| `kanban-io.test.js` | `lib/kanban-io.js` | Markdown task parsing, field updates, file locking |
| `llm-providers.test.js` | `lib/llm-providers.js` | Provider factory, arg building, env cleaning |
| `mesh-harness.test.js` | `lib/mesh-harness.js` | Rule loading by scope, output scanning, enforcement |
| `mesh-tasks-status.test.js` | `lib/mesh-tasks.js` | Task status enum, createTask defaults |
| `collab-unit.test.js` | `lib/mesh-collab.js` | Session lifecycle, dead node handling, convergence (unanimous/majority/quorum), turn advancement |
| `collab-circling.test.js` | `lib/mesh-collab.js` | Circling strategy mode, artifact management, phase transitions |
| `hyperagent-store.test.js` | `lib/hyperagent-store.mjs` | Store operations, strategy persistence, reflection lifecycle |
| `plan-templates.test.js` | `lib/plan-templates.js` | Template definitions, variable substitution |
| `role-loader.test.js` | `lib/role-loader.js` | YAML parsing, role finding, validation, forbidden patterns |
| `rule-loader.test.js` | `lib/rule-loader.js` | Frontmatter parsing, glob matching, rule priority sorting |
| `field-roundtrip.test.js` | Field serialization | Serialize/parse round-trip for task fields |
| `regression-bugs.test.js` | Various | Regression suite for previously fixed bugs |

### Integration Tests (require NATS)

| File | What it covers |
|------|----------------|
| `distributed-mc.test.js` | Distributed MC sync: KV mirror + sync engine across nodes |
| `collab-integration.test.js` | Multi-node collaboration with simulated KV |
| `collab-agent-lifecycle.test.js` | Full agent lifecycle within collaboration sessions |
| `e2e-collab.test.js` | End-to-end collaboration pipeline |
| `agent-recruit.test.js` | Agent recruitment and node selection |

## Mission Control Tests (`mission-control/src/lib/__tests__/`)

| File | Module | What it covers |
|------|--------|----------------|
| `wikilinks.test.ts` | `memory/wikilinks.ts` | `[[wikilink]]` extraction, task ID extraction, file ref extraction, resolution maps, cross-reference dedup |
| `daily-log.test.ts` | `parsers/daily-log.ts` | Date extraction from filename, H1 title fallback, directory listing, chronological sort |
| `memory-md.test.ts` | `parsers/memory-md.ts` | H1 title extraction, `##` section parsing state machine, empty sections, full content preservation |
| `task-markdown.test.ts` | `parsers/task-markdown.ts` | Task YAML parsing, status mapping, mesh fields, collaboration fields, serialization round-trip |
| `status-kanban.test.ts` | `parsers/task-markdown.ts` | Status-to-kanban mapping, kanban-to-status reverse mapping |
| `mesh-kv-sync.test.ts` | `sync/mesh-kv.ts` | KV-to-DB sync, CAS writes, watcher notifications, conflict resolution |

## Mock Patterns

### NATS Module Mock (used by all NATS-dependent tests)

```javascript
const Module = require('module');
const encoder = new TextEncoder();
const decoder = new TextDecoder();
const mockNats = {
  StringCodec: () => ({
    encode: (str) => encoder.encode(str),
    decode: (buf) => decoder.decode(buf),
  }),
};
const origResolve = Module._resolveFilename;
Module._resolveFilename = function (request, parent, ...rest) {
  if (request === 'nats') return 'nats';
  return origResolve.call(this, request, parent, ...rest);
};
require.cache['nats'] = {
  id: 'nats', filename: 'nats', loaded: true, exports: mockNats,
};
```

Place this **before any `require()` that depends on NATS**. See `test/collab-unit.test.js` for the canonical example.

### MockKV (in-memory NATS KV replacement)

```javascript
class MockKV {
  constructor() { this.store = new Map(); }
  async put(key, value) { this.store.set(key, { value }); }
  async get(key) { return this.store.get(key) || null; }
  async delete(key) { this.store.delete(key); }
  async keys() {
    const iter = this.store.keys();
    return {
      [Symbol.asyncIterator]() {
        return { next() { return Promise.resolve(iter.next()); } };
      },
    };
  }
}
```

Used by `mesh-plans.test.js`, `mesh-registry.test.js`, `collab-unit.test.js`, and the MC `mock-kv.ts`.

### Filesystem Mocking

- Root tests: use `fs.mkdtempSync` for real temp directories, cleaned up in `afterEach`
- MC tests: same pattern via vitest `beforeEach`/`afterEach`
- No monkey-patching of `fs` — real file I/O against temp dirs

## Writing New Tests

### Root test (node:test)

```javascript
#!/usr/bin/env node
const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');

// Mock NATS if needed (see pattern above)

const { myFunction } = require('../lib/my-module');

describe('myFunction', () => {
  it('does the thing', () => {
    assert.equal(myFunction('input'), 'expected');
  });
});
```

Run: `node --test test/my-module.test.js`

### MC test (vitest)

```typescript
import { describe, it, expect } from "vitest";
import { myFunction } from "../path/to/module";

describe("myFunction", () => {
  it("does the thing", () => {
    expect(myFunction("input")).toBe("expected");
  });
});
```

Run: `cd mission-control && npx vitest run src/lib/__tests__/my-module.test.ts`

## CI

GitHub Actions runs on every push/PR to `main`:
- Root unit tests on Node 20, 22
- MC tests on Node 22

See `.github/workflows/test.yml`.

## Coverage Gaps (known)

These modules have no direct unit tests, or only for one helper. Integration tests cover some indirectly.

| Module | Reason |
|--------|--------|
| `mission-control/.../memory/entities.ts` | NLP-like entity extraction |
| `mission-control/.../memory/extract.ts` | Heuristic-based fact extraction (only `getItemsWithSource` is unit-tested) |
| `mission-control/.../scheduler.ts` | Cron evaluation, timezone handling |
| `mission-control/.../hooks.ts` | Lifecycle hooks (only `memoryContentKey` is unit-tested) |
