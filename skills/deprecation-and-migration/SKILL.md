---
name: deprecation-and-migration
description: "Retire code, APIs or schemas safely: prove the replacement first, announce, migrate callers incrementally with strangler or expand-contract, then delete once usage is verifiably zero. Use when removing an old system or changing a schema without downtime."
triggers:
  - "deprecate this API"
  - "expand contract migration"
  - "remove the old system"
  - "sunset this feature"
negative_triggers:
  - "wipe and reseed memory"
  - "migrate skill frontmatter"
  - "write a feature spec"
license: MIT
metadata: {"clawdbot":{"emoji":"🪦","source":"addyosmani/agent-skills (MIT)"}}
---

# Deprecation and Migration

Code is a liability. Every line carries tests, docs, patches, dependency churn, and mental
overhead for anyone working nearby. Deprecation removes code that no longer earns its keep;
migration moves consumers safely from old to new.

Two facts shape the whole procedure. First, with enough consumers every observable behavior gets
depended on, including bugs and timing quirks — so removal needs active migration, not an
announcement. Second, deprecation planning starts at design time: ask how you would remove a
system three years from now while its interfaces are still cheap to shape.

## When to use

- Replacing an old system, API, or library
- Sunsetting a feature, or consolidating duplicate implementations
- Removing code nobody owns but everybody depends on
- Changing a production schema without downtime
- Deciding whether to maintain a legacy system or invest in migrating off it

## The deprecation decision

```
1. Does this still provide unique value?
   → yes: maintain it. no: continue.
2. How many consumers depend on it?
   → quantify the migration scope before promising anything.
3. Does a replacement exist and work?
   → no: build it first. Never deprecate without an alternative.
4. What is the migration cost per consumer?
   → trivially automatable: just do it. Manual and heavy: weigh it.
5. What does NOT deprecating cost?
   → security risk, engineer time, the drag of carrying the complexity.
```

**Advisory vs compulsory.** Advisory deprecation means warnings, docs, and nudges; consumers
migrate on their own timeline. Compulsory means a hard removal date, and is justified only by
security exposure, blocked progress, or unsustainable maintenance cost. Default to advisory. A
compulsory deadline without migration tooling, docs, and support is not a plan.

## The migration process

**Step 1 — build the replacement.** It must cover every critical use case, carry documentation
and a migration guide, and be proven in production rather than theoretically better.

**Step 2 — announce and document.**

```markdown
## Deprecation Notice: OldService

**Status:** Deprecated as of 2025-03-01
**Replacement:** NewService (see migration guide below)
**Removal date:** Advisory — no hard deadline yet
**Reason:** OldService requires manual scaling and lacks observability.

### Migration Guide
1. Replace `import { client } from 'old-service'` with `import { client } from 'new-service'`
2. Update configuration (see examples below)
3. Run the migration verification check
```

**Step 3 — migrate incrementally.** One consumer at a time: identify every touchpoint, update it
to the replacement, verify behavior matches with tests or integration checks, remove the old
references, confirm no regressions.

The churn rule: if you own the thing being deprecated, you own migrating its consumers, or you
ship a backward-compatible update that requires no migration. Do not announce and walk away.

**Step 4 — remove.** Only once every consumer has moved: verify zero active usage from metrics,
logs, and dependency analysis; delete the code; delete its tests, docs, and configuration; delete
the deprecation notices themselves.

## Migration patterns

**Strangler.** Run both systems and shift traffic incrementally. Old 100% → new at 10% canary →
50% → 100% with the old system idle → remove the old system. Each step is observable and each is
reversible by shifting traffic back.

**Adapter.** Keep the old interface, delegate to the new implementation, and migrate consumers off
the interface later.

```typescript
class LegacyTaskService implements OldTaskAPI {
  constructor(private newService: NewTaskService) {}

  getTask(id: number): OldTask {
    return this.toOldFormat(this.newService.findById(String(id)));
  }
}
```

**Feature flag.** Switch consumers one at a time, with an instant path back.

```typescript
function getTaskService(userId: string): TaskService {
  if (featureFlags.isEnabled('new-task-service', { userId })) {
    return new NewTaskService();
  }
  return new LegacyTaskService();
}
```

## Database schema migrations (expand/contract)

A schema change is the riskiest migration because the data is the one thing a deploy revert does
not roll back. The failure mode is coupling the schema change to the code change: rename a column
in the release that starts using the new name and, during the rollout window when old and new code
run together, one of them queries a column that does not exist. Never change a column in place.

```
EXPAND ──────────────→ MIGRATE ──────────────→ CONTRACT
add the new column,    backfill existing rows,  once no code reads the
nullable, alongside    dual-write old+new from  old column, drop it in
the old one            the app                  a later, separate deploy
```

Renaming `name` to `full_name`:

1. **Expand.** Add `full_name` as nullable. Deploy. Old code ignores it.
2. **Dual-write.** The app writes both columns on every insert and update. Deploy.
3. **Backfill.** Copy `name` into `full_name` for existing rows, in throttled batches.
4. **Switch reads.** Point the app at `full_name`, still writing both. Deploy and bake.
5. **Contract.** Stop writing `name`, then drop the column in a separate, later deploy.

Every step is independently deployable and reversible: if step 4 misbehaves, roll the code back
and `full_name` is still being populated.

Rules:

- **Additive first, destructive last and alone.** New nullable columns, tables, and indexes are
  safe in any deploy. Drops and renames get their own deploy after no code references the old shape.
- **Every migration has a tested down path.** A migration you cannot reverse is a deploy you
  cannot roll back. Write and run the down before merging.
- **Backfill in batches, off the hot path.** One `UPDATE` over millions of rows locks the table.
- **Build large indexes without blocking writes** (for example Postgres `CREATE INDEX CONCURRENTLY`).
- **Decouple the cutover from the schema with a feature flag** when it is risky.

## Zombie code

Code nobody owns but everybody depends on: no commits in six months with active consumers, no
maintainer, failing tests nobody fixes, known-vulnerable dependencies nobody updates, docs
referencing systems that no longer exist. Zombie code cannot stay in limbo. Either assign an owner
and maintain it properly, or deprecate it with a concrete migration plan.

## Red flags

- A deprecation with no replacement available, or no migration tooling and documentation
- Soft deprecation that has been advisory for years with no measured progress
- Zombie code with no owner and active consumers
- New features added to a deprecated system instead of to its replacement
- Deprecating without measuring current usage, or removing without verifying zero consumers
- A schema change shipped in the same deploy as the code that depends on it
- A column renamed or dropped in place rather than through expand/contract
- A migration merged with no tested down path, or a backfill that locks the table

## Verification

After a deprecation:

- [ ] The replacement is production-proven and covers every critical use case
- [ ] A migration guide exists with concrete steps and examples
- [ ] All active consumers migrated, verified by metrics or logs
- [ ] Old code, tests, documentation, and configuration are fully removed
- [ ] No references to the deprecated system remain
- [ ] The deprecation notices are gone; they served their purpose

After a schema migration:

- [ ] The change shipped in additive phases, not a single in-place edit
- [ ] Old and new code were both valid against the schema at every deploy step
- [ ] Each migration had a tested down path; backfills ran in throttled batches
- [ ] Destructive steps shipped in their own deploy, after no code referenced the old shape
