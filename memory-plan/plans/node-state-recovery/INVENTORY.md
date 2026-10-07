# Node state recovery — inventory

| Block | Step | Version | Status | Description |
|---|---|---|---|---|
| 1 | 1.1 | v1.1 | [x] | Establish verified application SQLite recovery snapshots |
| 1 | 1.2 | v1.2 | [A] | Establish verified JetStream history recovery snapshots |
| 1 | 1.3 | v1.3 | [ ] | Establish a coordinated application and bus recovery point |

> **1.1 — Goal:** Establish verified application SQLite recovery snapshots.
> **Needs:** Twelve application stores enumerated; SQLite backup API and installed sqlite-vec available; private backup storage with sufficient space.
> **Feeds:** Node-readiness 1.3 and later storage/capture repair.
> **Verify:** runtime/code: Read-only source transactions feed SQLite's backup API; offline restores pass integrity_check with identical schema, user_version, per-table row counts and content digests. Services stay running; no application initialization or source repair. Backup/restore directories 0700 and files 0600.

Closed 2026-09-28: twelve stores / 116 physical tables restored with matching fingerprints, six native FTS checks and eight vector probes; private deployed tools; unchanged service PIDs/runs; green isolated CI and Claude Message 68 acceptance. See step11_sqlite/AUDIT_POST.md. Individual points only; parent 1.3 remains open.

> **1.2 — Goal:** Establish verified JetStream history recovery snapshots.
> **Needs:** Four distinct store directories and four configurations inventoried; offline R=1 directories intact; installed NATS CLI/server available; independent review of snapshot/restore sequence.
> **Feeds:** Node-readiness 1.3 and topology 1.4.
> **Verify:** runtime/code: Reachable streams snapshot/restore on isolated loopback servers; stopped-server copies preserve all four stores including unavailable R=1 streams. Restored counts, messages and last sequences match captured originals, with explicit treatment of expiring health streams. No isolated server routes to production; histories remain separate.

In flight 2026-09-28 21:33 EDT: offline member-1 master/restore and eleven online archives accepted; revised owned recovery/admission tests pass after a retained refused run. Lifecycle prerequisite repairs are merged. Crash recovery did not close this step. Durable intent and account-group observations now have owned fault/election evidence. A managed driver with real stop gates, the three healthy cold masters, their isolated restores and truthful service resumption are still required. Full-baseline restoration, a shared node lock/unresolved fence and an immutable sealing mechanism now have owned evidence. The detached managed driver, actual unit/process identity bindings, real stop controls and degraded-history resolution procedure remain pending. A fixed persistent parent, complete explicit inventory and recoverable receipts now have owned fault evidence; Claude review of the new patch is pending. See step12_jetstream/RUNTIME_EVIDENCE.md and D7–D10.

Third-round checkpoint 2026-09-28 23:49 EDT: Claude accepted bbbc883's eight fixes and lineage; exact CI36516935187 is green. Its new creation-interruption and static-identity findings have source/deployed53-test evidence. Setup now prepares the full receipt before mkdir and reopens restore-only; Finder metadata is explicit. Exact new CI/review and the managed driver/healthy cold masters remain pending. See D11.

Fourth-round checkpoint 2026-09-29 00:58 EDT: ab7097c exact CI36518928261
is green; Claude accepted N1/N2 and identified owned regular Finder metadata
inside an initializing root. tools-v31 passes55 fresh tests, old source fails
the added recovery regression, and invalid metadata remains fenced. Main
55131b8's verified readiness prerequisite is integrated before fresh CI. This
checkpoint remains1.2[A]/v1.2-pre; managed driver/cold masters still pending.
See D12 and FINDER_SETUP_EVIDENCE.json.

Managed-stop checkpoint 2026-09-29 01:11 EDT: tools-v33 passes six actual
owned Mac controls and eleven read-only owner bindings. The obsolete private
driver is retired without service operations. Source N3 checkpoint0b96e93
has green exact CI and Claude Message38 acceptance. Stop-adapter CI/review
and the complete detached production orchestration remain pending;1.2 stays[A].
See D13 and MANAGED_STOP_EVIDENCE.json.

Fixture checkpoint 2026-09-29 01:21 EDT: tools-v36 passes the complete owned
recovery suite after tightening its placement cohort gate; an actual missing
member refuses. Prior f3bb44f CI failed before the Mac adapter ran; exact new
CI/review required.1.2 remains[A]; no production cold-copy acceptance.

> **1.3 — Goal:** Establish a coordinated application and bus recovery point.
> **Needs:** 1.1 and 1.2 recovery mechanisms verified; all writers and their service ownership identified; inventory ENOENT robustness addressed; primary/derived file sources, configs and browser-profile policy enumerated; quiescence/restart sequence independently challenged.
> **Feeds:** Node-readiness 1.3, then topology repair 1.4.
> **Verify:** runtime/code: With application and bus writers quiesced, take one final application/JetStream recovery set, including or explicitly excluding each non-SQLite canonical source; record its common quiet window, cursor/consumer states and hashes. Prove isolated recovery while keeping original owners/configuration/history intact; all services resume their prior state. Do not resume task execution from a mismatched set.

Managed-controls checkpoint 2026-09-29 01:44 EDT: private tools-v40 passes13
actual Mac controls/1 explicit cross-domain skip, tools-v39 passes recovery
with actual peer/route negatives. Thirteen owners have read-only entry/code/
environment bindings; Discord has no current root PID and deploy listener
remains unready. Timer idle/log observations alone refuse complete unload
verification. New exact CI/review pending; no production quiet window or
healthy cold-copy acceptance. See D15 and MANAGED_CONTROL_REVIEW.json.

Loaded-provenance checkpoint 2026-09-29 02:09 EDT: tools-v44 passes17
actual Mac controls/1 skip, v42 passes full recovery/all8 placement negatives.
Thirteen live owners retain the same PIDs and pass actual loaded plist/log
provenance. New exact CI/review pending. Producer tick gaps, stop margins,
Discord/timer proof, detached orchestration and healthy cold masters remain
open at1.2-pre. See D16 and LOADED_PROVENANCE_EVIDENCE.json.

Checkpoint2026-09-29 02:33 EDT: tools-v46 passes20 actual Mac controls/1
explicit domain skip, including real kernel errno and unexpected-event
retention plus the pre-watch startup rewrite. Owned historical-size NATS
and idle memory stops measure34–65ms, with normal exits and cleanup; no
worst-case or production preservation claim. 9deef65 CI36530037917 green3/3
and Claude Message46 has no blocker. New exact CI/review pending;1.2 remains[A].

Checkpoint2026-09-29 02:50 EDT: tools-v49 passes21 actual Mac controls/1
explicit domain skip, including bound-PID foreign-filter refusal with durable
raw evidence after reopen.56 journal controls pass.19243eb exact CI runs
36531518336/36531517977 green3/3; Claude Message48 has no blocker. Two
fixture layout refusals are retained; no production preservation started.
New exact CI/review pending;1.2 remains[A]. See DURABLE_KERNEL_EVIDENCE.json.

Checkpoint 2026-09-29 03:09:24 EDT: integer-PID ordering bug reproduced on owned old
source before any production journal. String PID exports plus strict
recursive string-key encoding pass58 journal tests and21 actual Mac controls/1
domain skip; verified/failed mixed-width chains reopen, restore and resolve.
New exact CI/review pending.1.2 remains[A]; see PID_KEY_EVIDENCE.json.

### Source foundation checkpoint — 2026-09-29 07:12:37 EDT

PR144 now targets the reviewed recovery tools, not completion of1.2. The
1.2 row remains[A] and VERSION remainsv1.2-pre. Exact integration CI and
Claude review are pending at this checkpoint. All existing forensic evidence
is retained as tool-development history; merging source enables no live hold.

| Component / remaining outcome | Status | Evidence / consumer |
|---|---|---|
| Sole Journal and failure/lineage primitives | Verified private tools | Unchanged5fabf6e hashes; fresh copied58/58 controls; FOUNDATION_EVIDENCE.json |
| Managed stop and admission/restore primitives | Verified bounded private controls | Prior21 actual Mac controls/1 explicit cross-domain skip, unchanged source; historical evidence |
| Restore-only interrupted execution-hold integration | Open | bus3.5; original-session continuity must not be reconstructed |
| Protected NATS root-lock lifecycle | Open | Before the production tripwire may be lifted: pin pre-receipt lock identity; recover empty and pending journal states; provide durable pre-marker abandonment, rollback and successor after reboot; bind root census to transaction, phase and lock identity; verify pinned transfer and fresh physical admission. After lifting it, compare site and lock by filesystem identity, including case and firmlink aliases. PR #178 is source-only. |
| Five actual Mac scheduled-job holds | Open | bus3.6; no production gate installation yet |
| Complete production preservation controller and new static baseline | Open | recovery1.2; all owners/invokers/dependencies and hold restoration readiness |
| Three healthy cold masters and isolated restores | Open | recovery1.2; no accepted common healthy cold-copy window |
| Complete live restoration / step1.2 closure | Open | Runtime evidence required after all prerequisites; source merge does not close it |

Checkpoint 2026-10-01 00:01 EDT: the actual on-demand mesh-agent state exposed
a full-node baseline refusal. D21 records the strict class correction and the
known-broken classification fence. A read-only 20-unit structural capture now
passes with 54 direct file pins; 65 Journal and 27 owned Mac recovery tests
pass. Complete dependency/provenance pins, production controller, three healthy
cold masters, isolated restores and truthful resumption remain open at
1.2[A]/v1.2-pre. See step12_jetstream/RUNTIME_EVIDENCE.md.

Checkpoint 2026-10-01 13:40 EDT, amending the 00:01 capture above (foreman
PR #174, operator-approved): `ai.openclaw.mesh-agent` was re-pointed to the
layered release `~/.openclaw/releases/worker-drain-69b7f37-foreman-5cb71b7-e57f89b`,
which is worker-drain-69b7f37-e57f89b plus `lib/foreman/supervisor.mjs` (see
its LIFECYCLE_PROVENANCE.json). Only `ProgramArguments[1]` changed. The plist
sha256 went from bb28366cfa6abde712e89dd84c5d0e725a1557cc2eec6ad024f321375d535de5
to c9209b9b66ffde255061c790d3c9fa62fffa46fbe7e60357f6472258af578d0c. Unchanged:
entry SHA 1304cb31…, environment, KeepAlive/RunAtLoad false, the `node_modules`
link and bare-module resolutions. The unit is still loaded, not running and not
disabled (D21 on-demand). The 00:01 capture's mesh-agent pins are stale:
recapture the full-node baseline before the first full-node journal. Rollback:
restore `~/.openclaw/backups/foreman/ai.openclaw.mesh-agent.plist.20261001T134005.bak`,
then bootout and bootstrap; the old release is untouched.

Checkpoint 2026-10-01 01:29 EDT: D22 widens the draft full-node source cohort
to 23 and adds a strict durable scope plus a multi-domain entrypoint preflight.
The live read-only preflight refuses two additional loaded system jobs; the
legacy root agent is crash-looping and cannot be retired without administrator
access. The gateway/viewer stop and detached-process fence, passive network
helper exclusion, complete dependency pins, protected-controller handoff,
healthy cold masters, isolated restores and truthful service resumption remain
open. No production preservation window started; 1.2 remains [A] at v1.2-pre.

Checkpoint 2026-10-01 01:55 EDT: Claude's exact b0669c7 challenge found an
unscoped 23-unit journal and neutral-label loaded-job omissions. D23's source
correction requires explicit new-window scope, binds the multi-domain inventory
to the full-node journal, and restores the deploy listener last. Owned tests and
new exact CI/review are required. The live widened scan still refuses the two
system jobs; the driver, cold masters and production restoration remain open.

Checkpoint 2026-10-01 02:29:15 EDT: the bounded PR #169 source now carries
Claude's d7fc991 follow-up corrections. Relative/wrapper and hard-linked
argument jobs are classified, recovery continues restoring known units after
inventory drift without certifying, and full-node sealing refuses until a
continuous launchd/process watch exists. The current read-only scan takes
4.75 seconds and still refuses the same two root-managed system jobs. The
controller, privileged job disposition, healthy cold masters, isolated
restores and verified production resumption remain open at 1.2[A]/v1.2-pre.

Checkpoint 2026-10-01 12:29 EDT: D24 defines the separate protected-writer
migration boundary. A source-only guard refuses ordinary install/auth-sync
paths once the future root-owned handoff marker exists. It has no effect on the
current live bus, where no marker has been created. Root migration journal,
old GUI job retirement, protected service UID/volume, credential lifecycle,
system-domain probes and healthy cold masters remain open; 1.2 stays [A].

Checkpoint 2026-10-01 12:41 EDT: D25 adds the reachable `openclaw-stack up`
refusal and keeps auth fixture tests runnable after a host marker is published.
The separate root migration, protected credential publisher, system-domain
monitoring and production recovery evidence remain open at 1.2[A].

Checkpoint 2026-10-01 12:43 EDT: D26 defines the marker directory mode,
pre-commit rollback removal order, and installer rechecks at NATS write
boundaries. The future root migration must also exclude installers already in
flight; the source rechecks alone are not a cross-process lock.

Checkpoint 2026-10-01 12:55 EDT: D27 adds a system-domain NATS watcher path
under the fixed handoff marker. This Mac's active labels are `nats`, `nats-2`,
`nats-3`; historical `nats-1` must remain unloaded. A 0600 node-local cohort
file records that layout; fresh installs create the singleton declaration,
while missing declarations report UNKNOWN. The future root marker must pin
its active cohort. GUI
and user-domain known-label duplicates refuse. Owned tests cover both
layouts, legacy/protected domains and invalid markers. A read-only live probe
of the no-marker branch observed all five core PIDs with no loaded known
duplicates. This does not exercise a protected system job. Claude's review of
e9b17e6 found no source blocker within PID-liveness scope and identified the
portable-layout correction. Claude's a96251c delta review then reproduced a
missing-file false WORKING during partial bootout; the declaration is now
mandatory, initialized only for fresh singleton installs. Focused owned tests
pass; exact new CI and review are pending. Root
migration and three healthy cold masters remain open at 1.2[A].

Checkpoint 2026-10-01 13:18 EDT: D28's read-only `/routez` + `/jsz` audit
confirms standalone 4222 and a separate two-member 4223/4224 cluster.
The owned topology classifier passes four fixture controls; the live
`--expect standalone-plus-two` control passes and
`--expect three-member-cluster` exits 1. The protected handoff must preserve these
distinct histories before any repair. No service, store or marker changed;
root migration, three healthy cold masters and complete restoration remain
open at 1.2[A]/v1.2-pre.

Checkpoint 2026-10-01 13:20 EDT: D29's read-only protected-site audit
passes its owned controls and refuses staging on the live host because
`_openclaw_nats` and `/private/var/db/openclaw-nats` are absent. APFS ownership
and the root-controlled parent pass. The audit is not cutover authorization;
no account, directory, service or store changed. Privileged staging and the
root migration journal remain required before a protected writer can start.

Checkpoint 2026-10-01 13:33 EDT: D30 extends that audit to every protected
ancestor and refuses a handoff root on a different device. The refreshed
`SITE_STATIC_EVIDENCE.json` passes the ancestor-chain check; the account and
root remain absent. Focused controls pass 69/69. No privileged mutation or
writer cutover occurred.

Checkpoint 2026-10-01 13:47 EDT: D31 closes Claude's PR #175 staging-account
blocker in source and retains the offline third Raft peer in the topology
evidence. The audit now checks the account's dedicated identity, ACL absence,
the monitor-to-client port binding and the shared marker path. The live site
still refuses: `_openclaw_nats` and the protected root are absent. Root
migration, account creation, the three healthy cold masters and restoration proof
remain open at 1.2[A]/v1.2-pre.

Checkpoint 2026-10-01 13:55 EDT: D32 narrows the offline-replica claim to
one live peer's observation; the leader is not pinned by the saved snapshot.
The separately held member-1 store and three healthy cold masters retain
their independent preservation requirements.

Checkpoint 2026-10-01 14:03 EDT: D33 hardens the read-only site audit's
macOS parsing after adversarial review. ACL entries are read even when `ls`
shows `@`, and a valid `dseditgroup` non-membership result is accepted despite
exit 67. The live protected site is still not staged; no writer changed.

Checkpoint 2026-10-01 14:09 EDT: D34 requires exclusive service UID/GID
directory records, an empty dedicated group and a narrow supplemental-group
set before staging. The root account/directory, migration journal and cold
masters remain absent; no production writer changed.

Checkpoint 2026-10-01 14:15 EDT: D35 requires converged three-member
metadata before the audit can label a fully routed graph a three-member
cluster. The saved evidence is now a reproducible CLI projection with a
hashed unresolved peer ID. The live split topology is unchanged; this is
read-only observation, not a cold-master or cutover acceptance.

Checkpoint 2026-10-01 14:25 EDT: D36 closes two more protected-account
false-ready cases: an operator whose primary or supplemental group is the
service GID, and GUID-only `GroupMembers` membership. A follow-up search
requires no other user's primary GID to match the service group, including a
space-bearing directory record name. The live account and protected root
remain absent; no writer cutover occurred.

Checkpoint 2026-10-01 14:29 EDT: D37 records server names, metadata leaders
and `/varz` start times in reproducible public evidence. The current read-only
`standalone-plus-two` control passes, the three-member expectation exits 1,
and the three live process start times are unchanged. This is an election
observation, not cold-master or restoration acceptance. Exact CI and Claude
delta review remain pending for this head.

Checkpoint 2026-10-01 14:38 EDT: D38 makes the read-only staging audit refuse
a protected root with any leftover entry. This closes an older false-ready
case without touching the live node; its root and dedicated account remain
absent. Focused tests and exact-head CI/review must pass before merging the
preflight source. UID/GID stale-file search across the data volume remains a
separate account-provisioning requirement, not evidence from this audit.

Checkpoint 2026-10-01 15:03 EDT: PR #175's read-only preflight merged with
exact-head CI green on rerun and Claude's no-blocker review. The active watcher
was separately switched to the already-merged PR #173 cohort code and reports
the actual `nats`, `nats-2`, `nats-3` layout as WORKING. D39 records four
root-migration design blockers and a revised review candidate. No root
transaction, protected account/marker, cold masters, isolated restores or
cutover exists; step 1.2 remains [A] at v1.2-pre.

Checkpoint 2026-10-01 15:17 EDT: D40 adds the shared-lock prerequisite to
legacy installer, uninstaller, auth-render, trust-peer sync, cohort init and
stack control source. Private lock fixtures prove shared child lifetime,
exclusive contention, marker refusal and invalid-file refusal. The macOS CI
job exercises the descriptor handoff and background-child release; relevant
source tests pass. The root-owned lock has not been created, and the existing production
entrypoints have not been redeployed from this candidate. Root journal,
durable user-to-root transfer, client hold and cutover remain open at 1.2[A].

Checkpoint 2026-10-01 16:02 EDT: PR #177 merged with four green CI jobs and
Claude's no-blocker review. The new root-side exclusion primitive and macOS
fixtures are being prepared separately. No live lock file exists yet; merged
legacy source is not evidence that installed old copies have been replaced.
The root journal, preservation transfer, client disable, cold masters and
protected bootstrap remain open at 1.2[A]/v1.2-pre.

Checkpoint 2026-10-01 16:16 EDT: draft PR #178 now includes a source-only root
lock bootstrap journal: intent-before-create, exclusive lock, old-writer
census callback, and admission readback under exclusion. Local private
fixtures pass (root lock 14/14, journal 17/17). The callbacks do not yet have a
production pinned root driver; no marker, service, store or root-owned path
was changed. Claude's exact-head review requires pre-receipt lock identity
pinning, empty/pending-record reentry and a terminal reboot/abandonment path
before this journal can control a live migration. The production path now
refuses in code until those are implemented. Durable preservation transfer,
physical census implementation, cold masters and cutover remain open at
1.2[A]/v1.2-pre.

Checkpoint 2026-10-01 17:11 EDT: a source-only follow-up to PR #178 now
prototypes a single locked ledger outside the protected site and stages the
shared lock under a transaction-specific name before linking it into view.
Private tests cover an empty ledger, interrupted pending records, concurrent
drivers, a two-link interruption, same-inode restart, deletion before the
admission receipt, and replacement after it. The production root path remains
gated. This does not yet implement terminal abandonment, reboot successors,
user-journal transfer, marker/rollback states, physical census or the
protected NATS driver. No live root path or NATS process was changed; step
1.2 remains [A] at v1.2-pre.

Checkpoint 2026-10-01 17:44 EDT: after PR #179 merged, a new source-only
branch adds a durable pre-marker `returned` outcome, a public readback receipt
and successor transactions. A successor inherits the same lock inode, nonce
and change time; once `lock-staged` was recorded, return relinks the recorded
inode instead of dropping its last name. Intent-only unpublished stage may be
discarded. Returning takes exclusive exclusion, so a live shared holder
refuses. Private Mac fixtures passed 49/49 across journal and root-lock tests,
including marker refusal, tampered outcome, reboot return and repeated
successors. The real macOS-root path remains gated. Physical release/admission
checks, durable user transfer, marker/rollback states, the protected driver,
cold masters and live deployment remain open at 1.2[A]/v1.2-pre.

Checkpoint 2026-10-01 17:55 EDT: Claude's exact-head review of draft PR #180
at 970ab8c confirmed same-inode relink and all four CI jobs, and found two
fail-closed ledger wedges: a reused transaction ID, and an empty intent-only
stage after interrupted creation. A local revision refuses reuse before
append, permits only a one-link nonce-prefix unpublished stage to be removed,
binds forward admission to the current boot, matches the user journal's boot
hash format, and creates the public outcome directory at its fixed mode under
a restrictive umask. Focused Mac tests pass 59/59. The revision needs a new
exact-head CI and Claude review; live state is unchanged and 1.2 remains [A].

Checkpoint 2026-10-01 18:16 EDT: PR #180 merged at e918a3e with 4/4 CI,
Claude's no-blocker exact-head review, and 59/59 local Mac root-lock fixtures.
The new user-transfer source branch records a full-node NATS transfer intent
and freezes its journal until an owner-checked, exact-binding root `returned`
receipt closes it. Returned windows remain restore-only. Local tests pass
112/112 for the user journal and hold, 59/59 for the root journal and lock.
This is source-only: root `declined`, post-marker `rolled-back`, and `accepted`
outcomes, physical user-journal validation in the root driver, root service
admission/census, protected marker/rollback, cold masters and live cutover are
still open. The production macOS-root path remains gated; no live service or
protected store was changed. Step 1.2 remains [A] at v1.2-pre.

Checkpoint 2026-10-01 18:30 EDT: Claude's exact-head read-only review of
PR #181 at d0eafbc reproduced the user (112 tests) and root (45 tests)
suites and found a blocking unclosable transfer when no root transaction ever
began. The branch now gates the production transfer entrypoint until `declined`
and root validation exist. Returned legacy NATS restoration additionally checks
the marker and shares the root writer lock around each mutation, while any
transfer ends the original hold's same-process forward certification. New
focused controls cover the production gate, shared-lock exclusion and hold
certification. Exact-head CI/review remain pending for this revision; no live
root or NATS state was changed. Step 1.2 remains [A] at v1.2-pre.

Checkpoint 2026-10-01 18:46 EDT: a dependent source branch adds a read-only
root validator for the owner-private user transfer. It holds the node and
journal locks, pins the journal directory descriptor, verifies the chain,
full-node baseline, current boot, node receipt, original native hold and NATS
unload lineage, then rechecks the same transfer head. The user intent now
includes transfer-time hold evidence so the root can bind its hash and compare
the watch session to the original close without requiring volatile fields to
stay byte-identical. Five root-reader fixtures and 115 user/hold tests pass
locally. The root journal does not yet invoke this validator or durably pin
the two records. All production gates remain in place; 1.2 stays [A].

Checkpoint 2026-10-01 18:57 EDT: the next dependent source slice binds root
bootstrap and reentry to a locked, still-open user transfer. The wrapper holds
the owner node/journal locks across root intent and writer-lock admission;
five local controls pass, including a closed-transfer negative before writer
lock creation and rejection of a root descriptor for another user head. It
still accepts an isolated-test physical callback and does
not durably pin the two user records or lift the macOS-root gate. Step 1.2
remains [A].

Checkpoint 2026-10-01 19:01 EDT: adversarial review of PR #182 found that
the real `close_and_drain` verifier records native hold evidence at the top
level; the first validator fixture incorrectly nested it. The validator and
fixture now use the producer's shape. Root recheck also detects replacement
of a held owner lock by comparing open and named inode/ctime identities. The
production root and transfer gates remain closed pending exact-head review.

Checkpoint 2026-10-01 19:07 EDT: PR #182's adversarial review reproduced the
receipt-shape blocker with a real gate/hold chain. The revision now includes
that real macOS positive control, allows owner-owned Finder metadata, refuses
unknown forward-window events, and detects replacement of either held owner
lock. Local root/transfer suites pass 68/68 and user journal/hold 115/115.
The branch remains draft until revised-head CI and review pass.

Checkpoint 2026-10-01 19:15 EDT: Claude's exact-head review of 0006d8b
reported no blocker. Its two minor refusal cases are now closed: owner-owned
regular Finder metadata is allowed regardless of mode under the 0700 journal
directory, and deeply nested malformed JSON returns `Refused`. macOS CI now
runs the existing user journal and hold suites as well as the real-gate
validator test. Local focused tests remain 68/68; user/hold tests 115/115.
Revised CI is pending. Production gates remain closed.

Checkpoint 2026-10-01 19:29 EDT: a dependent source slice now includes the
exact validated user baseline and transfer records in the root-owned intent
and checks their content hashes, descriptor binding, and equality on bound
reentry. Root journal and bound admission controls pass 51/51 locally.
PR #183's independent adversarial review is still probing reboot reentry;
neither slice authorizes production root bootstrap. The physical driver,
outcome lifecycle, protected staging, cold masters, isolated restores, and
live acceptance remain open at 1.2 [A].

Checkpoint 2026-10-01 19:33 EDT: bound root reentry now distinguishes a
prior-boot intent from a current-boot one. A prior-boot transfer must match
the root-owned copies and may only take the pre-marker return path; it cannot
readmit the writer. The new reboot fixture passes with the user-transfer
checks. Production release observations and the full outcome lifecycle remain
open; the root tripwire stays closed.

Checkpoint 2026-10-01 19:56 EDT: a source-only `declined` outcome is now
recorded in the existing root ledger under owner and ledger locks when no
root intent survived. A one-link pending root intent is settled; a published
intent refuses decline. The root receipt can be republished after a crash,
and the user closure accepts `declined` for restore-only recovery. Twelve
focused decline controls, 87 root-side controls, 78 user-journal controls,
and 17 preservation checks pass locally; adversarial review and CI are pending.
The physical absence callback remains test-supplied and the
production transfer/root gates remain closed. Step 1.2 stays [A].

Checkpoint 2026-10-01 20:09 EDT: Claude's exact-head PR #185 review found no
reachable safety blocker and CI passed 4/4, but its E4 probe exposed a stale
outcome collision detected after the decline record. D50 moves the protected
transaction-slot check before the durable decline append. The new regression
passes in the focused 13/13 suite; revised-head CI and review remain pending.
The production physical driver and step 1.2 runtime acceptance remain open.

Checkpoint 2026-10-01 20:27 EDT: the next source slice now holds a carried
writer lock shared through the decline append and stores bounded, replay-
validated physical absence evidence in the root ledger (D51). Owned probes
cover an exclusive lock holder, a competing writer during observation and
append, oversized evidence, and rehashed evidence tampering; the root and
user-journal suites pass 92/92 and 78/78 locally. The protected
root-owned observer, fixed production paths, launchd/process/store census,
root installation, three healthy cold masters and live restoration remain
open. The production macOS-root gate stays closed; 1.2 remains [A].

Checkpoint 2026-10-01 20:37 EDT: Claude's exact-head PR #186 review found no
protocol-reachable blocker and green 4/4 CI, but reproduced a lock change
detected only after a durable decline. D52 adds commit-boundary rechecks and
canonical evidence validation. Three new commit-window controls and the
malformed-evidence control pass; the root journal, bound admission, decline
and user-transfer suites pass 82/82 locally. Revised-head CI and adversarial
review are pending. The protected observer, root-owned installation, cold
masters and live acceptance remain open at 1.2 [A].

Checkpoint 2026-10-01 20:47 EDT: PR #186 merged with Claude's revised-head
no-blocker review and green 4/4 CI. D53 adds non-mutating root ledger
inspection for the future observe-only driver: absent state is reported
without creation, a valid chain is summarized, pending records stay in place
and refuse, and an active driver refuses. The focused root-journal suite
passes 49/49 on macOS. Exact CI/review of this new source slice are pending;
the fixed-path physical observer, protected installation and live recovery
remain open at 1.2 [A].

Checkpoint 2026-10-01 20:53 EDT: Claude's PR #187 probe showed a same-site
stale ledger directory could be substituted during a path-based read. D54
pins record enumeration and open to the held directory descriptor, rechecks
the named site/ledger identities, and marks the output `ledger-only` with
`last_event` rather than suggesting physical safety or a terminal state.
The focused Mac root-journal suite passes 51/51, including before- and
after-read swaps. Revised-head CI and review remain pending; production
physical census and root installation are still unbuilt.

Checkpoint 2026-10-01 22:01 EDT: Claude's 0cb808c review found no blocker and
green 4/4 CI, but exposed a FIFO hang, a directory-record descriptor leak,
and path/permission race reports. D55 adds nonblocking typed record opens,
descriptor cleanup, opened-directory validation, final record rechecks and
uniform refusal. Focused regressions pass after the VM restart; full suites
and revised-head review remain pending. The production observer and root
installation remain unbuilt; 1.2 stays [A] at v1.2-pre.

Checkpoint 2026-10-01 22:20 EDT: PR #187 merged at cdd7d680 after green
4/4 CI and Claude's revised-head no-blocker review. D56 adds a read-only
macOS live census on a new branch: exact four GUI/system labels, disabled
overrides, plist identities, NATS kernel process identity/arguments and open
vnode identities, and four store trees. Eight focused tests pass, and the
command reports the current three running GUI jobs plus disabled/unloaded
member 1 without changing them. The report is diagnostic only. Protected
fixed-path deployment, complete mutator/store-holder absence, writer-lock
bracketing, cold masters, isolated restores and live acceptance remain open.
The macOS-root tripwire stays closed; 1.2 remains [A] at v1.2-pre.

Checkpoint 2026-10-01 22:39 EDT: Claude's first-head PR #188 review found no
blocker for the diagnostic source slice, but reproduced misleading empty
process/store-holder reports and an unchecked waiting-job argument change.
The revised census states its incomplete coverage, compares loaded arguments
for waiting and running GUI/system jobs, and keeps argument values out of the
report. The new tests run in CI at 595f0df (4/4 green); revised-head CI and
adversarial review are pending. This does not certify absence or authorize
the production migration. Step 1.2 stays [A] at v1.2-pre.
Claude's second pass also reproduced a control-character parsing ambiguity;
the next revision refuses such arguments and keys the report digests per
scan. Exact-head CI and review remain pending.

Checkpoint 2026-10-01 22:33 EDT: D57 tightens the future observer's root
ledger input boundary. Observe-only reads precheck record type before open
and map malformed JSON/schema exceptions to `Refused`. Three new controls
cover an unopened FIFO, deeply nested JSON, and a rehashed invalid returned
lock; the focused macOS root-journal suite passes 60/60. This does not add
the protected physical observer, change NATS state, or lift the root gate.

Checkpoint 2026-10-01 22:57 EDT: PR #188 merged at d5b5c13 after 4/4 green
CI and Claude's exact-head no-blocker review of its diagnostic scope. D57 was
rebased onto that source and its related root-journal, decline, admission and
user-transfer suites pass 97/97 locally. D57 still needs exact CI and review;
the protected physical absence observer and production cutover gates remain
open at 1.2 [A]/v1.2-pre.

Checkpoint 2026-10-01 22:59 EDT: PR #190's first Ubuntu CI run exposed a
Python parser-depth difference: 1,200 nested arrays return a list on that
runner and are refused by schema validation, while macOS raises recursion.
The test now accepts either clean refusal for that real input and separately
forces RecursionError and TypeError to verify uniform boundary mapping. The
source behavior is unchanged; revised CI and Claude review are pending.

Checkpoint 2026-10-01 23:08 EDT: Claude's PR #190 fuzzing found a non-string
transaction escaping as `AttributeError` after a record was rehashed. D57 now
requires string UUIDs in intent and decline validation and maps residual
attribute errors at the read-only boundary. Both new malformed-transaction
regressions pass; journal and decline suites pass 83/83 locally. Exact-head
CI and follow-up adversarial review are pending; root production gates remain
closed.

Checkpoint 2026-10-01 23:04 EDT: D58 adds an independent read-only holder
command that scans vnode descriptors across readable processes of every name,
including retained paths for unlinked store files. Seven focused Mac tests
pass. A live user-level scan found PID 842 holding one linked 4222 entry,
with 145 unreadable PIDs and 41 unattributed unlinked handles on store
devices; it explicitly does not certify absence. Exact CI/review are pending.
The protected root observer, cold masters and cutover remain open at 1.2 [A].

Checkpoint 2026-10-01 23:16 EDT: PR #190 merged after exact-head 4/4 CI and
Claude's no-blocker review. D59 closes the previously reproduced raw root-
driver `TypeError` for a rehashed returned record with a non-dictionary lock.
A direct driver control also pins the non-string intent transaction refusal.
The root journal and decline suites pass 85/85 locally, including both new
driver controls. The protected physical observer,
three healthy cold masters and production cutover remain open; 1.2 stays [A]
at v1.2-pre.

Checkpoint 2026-10-01 23:20 EDT: Claude's PR #191 review found no blocker for
its diagnostic scope but reproduced false deleted-file attribution through a
replaced symlink and identified unlabelled process-snapshot churn. D58 now
matches retained paths lexically and verifies the current device/inode for a
linked file created after the store walk. It retries once, reports exited
versus unreadable PIDs, and declares its open-FD coverage. The related local
suites pass 20/20 and a read-only live scan still observes one
linked 4222 holder with 141 unreadable and two exited PIDs. Revised-head CI
and adversarial review are pending; no absence verdict or cutover is allowed.

Checkpoint 2026-10-01 23:40 EDT: PR #191 merged with exact-head 4/4 CI and
Claude's no-blocker diagnostic review. Its D58 holder census remains read-only
and does not certify physical absence. PR #192 now includes D59's direct-driver
refusal for non-finite JSON and recursive raw records, after incorporating
#191's merged base. The root journal and decline suites pass 88/88 locally,
including a two-link pending-record refusal that preserves both names.
Exact-head CI and adversarial review of the revised #192 are pending; the
protected physical observer, three healthy cold masters and production
cutover remain open at 1.2 [A]/v1.2-pre.

Checkpoint 2026-10-02 06:20 EDT: a read-only 23-unit provisional recapture
includes the operator-approved host Ollama target `http://192.168.64.1:11434`.
The mesh-agent and memory-daemon plists now hash to `d0d01ead…` and
`a3fb84ea…`; the former hashes are present in Foreman backups. Memory-daemon
PID 37477 started at 2026-10-01 22:34:32 EDT and its argv and LLM setting
match its plist. The env file and Foreman backup remain 0600; no env-file
digest is published. All 23 structural states match and 59 direct pins over
29 distinct files were hashed, but the entrypoint preflight still refuses the
two loaded unapproved system jobs. See the sanitized diagnostic and
RUNTIME_EVIDENCE.md. The previous 20-unit capture and the 13:40 mesh-agent
pin are stale. No full-node journal or cold master exists; 1.2 stays [A] at
v1.2-pre. The source memory-daemon plist template and separate
`workspace-bin/install-daemon` renderer lack `LLM_BASE_URL`, so a future
reinstall would undo the live setting until those source gaps are fixed.

Checkpoint 2026-10-02 06:50 EDT: a source-only correction now threads the
configured `LLM_BASE_URL` through the memory-daemon launchd and systemd
templates and the separate direct installer (macOS, systemd and pm2). The
direct installer reads only that key from `~/.openclaw/openclaw.env` with the
same precedence as the normal installer;
an isolated HOME with stub service commands exercised all three render paths.
The normal launchd template rendered and parsed with the host URL. This has not been
installed or restarted on the live node. The 23-unit diagnostic remains
provisional, the two system jobs still refuse preflight, and 1.2 stays [A] at
v1.2-pre pending exact CI and adversarial review.

Checkpoint 2026-10-02 07:10 EDT: PR #196 merged at 0d3237f after exact-head
4/4 CI and Claude's no-blocker review. The source memory-daemon installers now
preserve the saved host-Ollama URL across normal launchd/systemd installs and
the separate macOS/systemd/pm2 path. No live service was changed. Node-init's
mesh-agent renderer still read only the process environment, so a plain-shell
rerun could drop that service's saved URL; a source-only correction is under
test. The diagnostic baseline remains provisional and 1.2 stays [A].

Checkpoint 2026-10-02 07:27 EDT: PR #197 merged at 5caf0b6 after exact-head
4/4 CI and Claude's no-blocker review. Node-init now renders the mesh-agent's
saved host-Ollama URL even when a stale localhost value is present in the
shell. The shared env reader no longer consumes the next line after an empty
key, while retaining its original first-duplicate rule for NATS. The live
plists and services are unchanged; this source repair does not certify the
23-unit diagnostic, remove the two unapproved system jobs, or close 1.2.

Checkpoint 2026-10-02 08:00 EDT: the D60 source draft admits only the exact
idle `com.openclaw.tailscale-up` system one-shot as an explicit, rechecked
exclusion. Its launch count, plist, wrapper, signed app and boot identity are
saved in the full-node inventory; a later run or drift refuses. The focused
preservation suites pass 103/103 and the root transfer suite passes 10/10;
read-only validation of the installed
helper passes. The live preflight still refuses `com.openclaw.agent`, so the
23-unit baseline remains provisional. No system job or node service was
changed, and 1.2 remains [A] at v1.2-pre.

Checkpoint 2026-10-02 08:30 EDT: Claude's bc99aac challenge confirmed the
reboot/update recovery wedge is fixed but found an unreported helper run after
NATS transfer intent. Recovery now records a durable boolean comparing the
fresh exclusion with the original baseline, without blocking restore-only
resolution. A run during one recovery attempt fails that attempt; retry records
the changed baseline comparison. Source tests include the returned-transfer
case. The root-held transfer still needs its own live observer before cold
master acceptance. The focused preservation suites now pass 104/104. This
record does not authorize cutover or close 1.2.

Checkpoint 2026-10-02 08:54 EDT: PR #199 merged at 8b451da after its exact-head
4/4 CI rerun. Claude's no-blocker review was at 4435211; follow-up 0c6c30f
addressed its test and wording notes without changing production code. It admits the exact idle
Tailscale system helper as an explicit exclusion and durably reports changes
observed when recovery starts; it does not certify the root-held transfer. A
narrow retirement runbook for the obsolete root-managed `com.openclaw.agent`
has been prepared and the live plist hash, owner, absent entry file and
repeated exit 1 were rechecked. Noninteractive administrator access is
unavailable, so no root action occurred. The live full-node preflight still
refuses that job; the protected observer, three cold masters and cutover remain
open at 1.2 [A]/v1.2-pre.

Checkpoint 2026-10-02 09:06 EDT: the legacy root-owned
`/etc/sudoers.d/openclaw-mesh` also remains installed (root:wheel 0440).
Effective `sudo -n -l` output still grants passwordless wildcard
`launchctl load/unload` and `killall -9 node`. Those grants can reload the
obsolete root job or stop Node services, so they also defeat the proposed
root boundary. PR #200's runbook requires inspection, protected backup and
removal of those exact legacy rules before retiring the daemon in one locked
local administrator session, with no action if its contents differ. Claude found
no safety blocker in the original daemon sequence and asked for explicit
preflight, collision, disabled-state and post-action checks. No administrator
or NATS action occurred.

Checkpoint 2026-10-02 09:17 EDT: the retirement preflight is now required to
hold the existing owner-private `node.lock` with macOS `lockf -kn -t 0` for the
whole administrator session. A private temporary-file control confirmed
`lockf` and the journal's Python `fcntl.flock` contend; the real node lock was
also acquired and released with no action. This closes the check-to-retire
race in the written procedure. Live retirement remains unexecuted.

Checkpoint 2026-10-02 09:27 EDT: PR #200's ordered procedure now keeps a
root recovery shell open while the legacy sudoers file is moved, syntax and
fresh password authentication are checked, and only then the pinned daemon
is disabled, booted out and archived. The node lock remains held until the
23-unit preflight and before/after census finish. CI passed 4/4 at the prior
draft head `8558076`; this ordering revision still needs exact-head CI and
adversarial review. The administrator action is still unexecuted, and 1.2
remains [A] at v1.2-pre.

Checkpoint 2026-10-02 09:39 EDT: Claude's exact-head review of PR #200 at
`1c3e8ee` confirmed the revised lock/sudoers/daemon order and all four CI
checks, then found procedural gaps in pasted-block failure handling, sudoers
hash recording and policy restoration. The next source-only follow-up makes
each command an individually checked step, prints the inspected sudoers hash,
provides a pinned restore branch, uses absolute sudo/Python paths, and adds
checkout, private-output and lock-continuity checks. Exact-head CI and review
of that follow-up remain pending. No administrator or NATS action has run;
the protected observer, cold masters and cutover remain open at 1.2 [A].

Checkpoint 2026-10-02 09:45 EDT: Claude found no blocker in the `a985298`
procedure after its three prior gaps were fixed. Its remaining notes led to
a final instruction that every node-user and root command be checked
individually, the checkout must have no changes, and the second-terminal
lock proof precedes any retirement report. CI and review at this final head
remain pending. No root action has occurred.

Checkpoint 2026-10-02 09:52 EDT: PR #200 merged at `a629e9a` after exact-head
CI 4/4 and Claude's no-blocker review of `d181549`. It supplies the guarded
local retirement procedure only. A Codex terminal is waiting for the operator
to authenticate locally; no administrator action or node lock is active.
The 23-unit live preflight still refuses the installed legacy root job.
Step 1.2 stays [A]/v1.2-pre; protected root observation, healthy cold masters,
and production cutover remain unbuilt or unaccepted.

Checkpoint 2026-10-02 10:13 EDT: the D56/D58 node-user diagnostics now open
plists nonblocking without following a final symlink and traverse store
directories through pinned descriptors. Owned regressions cover a plist
replaced by a FIFO and root or nested store directories replaced by symlinks
between checks. This narrows diagnostic read races; neither command is a
protected root observer or an absence certificate. The live retirement and
full-node preservation gates remain open work at 1.2 [A].

Checkpoint 2026-10-02 10:33 EDT: PR #201 merged at `0b74e32` with CI 4/4
and Claude's no-blocker review of `44d5bb3`. The next source slice extends
the same read-only process snapshots to kernel working-directory and mapped
file vnode identities, including mappings whose original descriptor closed.
An owned macOS test covers cwd identity, a fixture covers cwd inside a store,
and another native test covers an unlinked mapping. This
does not make the user-run censuses single-instant or authorize physical
absence; PID reuse, unreadable processes and in-flight descriptors remain
explicit limits. The guarded legacy retirement is still awaiting local
administrator authentication, and step 1.2 remains [A]/v1.2-pre.

Checkpoint 2026-10-02 11:09 EDT: PR #202 merged at `bfe997e8` after exact-head
CI 4/4 and Claude's no-blocker review of `f7238e3`. Cwd and mapped-vnode
observations remain diagnostic only. Claude's next read-only driver challenge
found that the full-node user journal guarded NATS restoration only after a
returned transfer. D61's source correction applies marker and shared-lock
checks to every full-node NATS recovery, including no-transfer windows. Owned
marker and exclusive-lock controls pass with the 85-test journal suite. Exact
CI and adversarial review of this change are pending. The production driver,
protected observer, healthy cold masters, and live retirement remain open;
step 1.2 stays [A]/v1.2-pre.

Checkpoint 2026-10-02 11:29 EDT: Claude found no blocker in PR #203's first
head and its quick delta probe confirmed the held member and final check. The
follow-up now also brackets hold preparation, final readiness/gate reopen and
resolution; old unscoped NATS journals use the same exclusion, and a lock
appearing during an initially lock-free action refuses. Owned regressions pass;
the full exact-head suite, CI and adversarial delta verdict remain pending.
No production NATS service was changed, and 1.2 remains [A]/v1.2-pre.

Checkpoint 2026-10-02 11:53 EDT: Claude's PR #203 review found that the
original unscoped-journal regression could pass after its callbacks were
swallowed, and that tests still touched the live root marker paths. The
regression now asserts that no NATS callback ran, and both parent and child
hold tests use private marker and lock fixtures. A proposed mandatory root
lock check passed 154/154 local tests but conflicts with recovery after a
crash before the durable user transfer: root lock bootstrap itself requires
that transfer. The no-lock checked branch is retained, with an added test
that recovers an old unscoped journal before bootstrap. Targeted controls
pass 3/3 after this correction; the revised full suite, exact-head CI and
Claude delta review are pending. The live root lock remains absent. No
production NATS service or root path was changed; 1.2 stays [A]/v1.2-pre.

Checkpoint 2026-10-02 12:18 EDT: Claude's scratch probe confirmed the
mandatory-lock deadlock and validated the checked absent-lock recovery. The
user guard now rechecks immediately before NATS restart, gate unlink and
terminal row; a detection after a restart or observed gate opening is labelled
`after_commit`, and a terminal row followed by a receipt/guard failure raises
`CommittedRefusal` with its hash. Private fixtures replace all real root-path
reads in the hold suite. The revised journal/hold suites pass 134/134 on this
Mac, and the separate owned restore-only suite passes 27/27; an earlier
combined run had two load-sensitive owned readiness failures, with no NATS
guard involved. The revised PR head, CI and Claude exact-delta review remain
pending. No live root or NATS state changed; 1.2 stays [A]/v1.2-pre.

Checkpoint 2026-10-02 12:32 EDT: Claude found no blocker in PR #203 at
`c9acbbe` with exact-head CI 4/4, but its mutation pass exposed two missing
journal-level guards and a test that bypassed the sticky journal write flag.
The revised tests now assert a new lock before NATS restart refuses, the
recovery facade passes the NATS check into the gate's last before-open step,
and a restart that raises is still reported as possibly committed. A real
sticky `hold-opened` failure now raises `CommittedRefusal` naming the observed
open gate without attempting another journal append. The revised local
journal/hold suites pass 138/138; exact-head CI and Claude delta review for
this final follow-up remain pending. The earlier owned restore-only suite
passed 27/27. No live root or NATS state changed; 1.2 stays [A]/v1.2-pre.

Checkpoint 2026-10-02 12:45 EDT: PR #203 merged at `4d6e2c9` after
exact-head CI 4/4, Claude's no-blocker delta review, and a fresh macOS
restore-only run passing 27/27 at `93e1e84`. The macOS CI job is being
extended to run that owned restore-only suite on every source change. This
does not establish a full-node preservation window, protected root physical
admission, cold masters, or live NATS restoration; 1.2 stays [A]/v1.2-pre.

Checkpoint 2026-10-02 12:51 EDT: the new macOS CI run exposed a fixture
assumption hidden by the node's local layout: its owned service plist named
`/usr/local/bin/node`, absent on the hosted arm64 runner. The fixture now
pins the installed Node executable selected by the job's PATH. This changes
only owned test setup; exact CI rerun is required before PR #204 can merge.

Checkpoint 2026-10-02 12:55 EDT: the first local rerun after fixing the
fixture path exposed the owned recovery adapter's matching hardcoded Node
path. It now accepts the canonical absolute Node executable already saved
and content-pinned in the journal, then binds the running process to that
same path. The previously failing ambiguous-open readiness case passes in
isolation. Full local and exact-head CI runs remain pending.

Checkpoint 2026-10-02 13:03 EDT: the adapter's saved Node path now also
requires a regular, single-link executable before any content read. An owned
FIFO-path control refuses before the read; this guards a malformed saved
baseline from hanging recovery. The earlier exact-head CI at `002dfca` passed
4/4 and the owned suite passed 27/27 locally. The new 28-case suite and
corresponding CI run are pending. Protected root admission and live cutover
remain open at 1.2[A]/v1.2-pre.

Checkpoint 2026-10-02 13:12 EDT: PR #204 merged at `734c06a` after its
exact-head CI passed 4/4 and the owned restore-only suite passed 28/28 on
the hosted macOS runner. Claude found no blocker in the saved-executable
fix or the special-file refusal; the regression test is now bounded by an
alarm. A separate source slice makes the shared `static_identity` capture
read only bounded regular files through non-blocking, no-follow descriptors,
with a FIFO control. Its journal and hold suites pass 96/96 and 43/43
locally; owned restore-only and exact-head CI are pending. This is source
hardening, not a live full-node admission or cutover.

Checkpoint 2026-10-02 13:26 EDT: PR #205's exact-head CI rerun passed
4/4; the first attempt failed in an unrelated NATS test teardown race.
Claude found no blocker in the bounded static-identity read and verified
existing saved identities remain comparable. Its review prompted an
`O_NOCTTY` open flag and a stricter FIFO timeout assertion, plus symlinked
and oversized plist controls; final exact-head CI for that delta is pending.
Draft PR #206 separately fixes the NATS test teardown by waiting for its
private server to exit before removing its store. Root admission and live
cutover remain open at 1.2[A]/v1.2-pre.

Checkpoint 2026-10-02 13:56 EDT: PR #205 merged at `894dca6` after its
final exact-head CI passed 4/4 and local journal, hold and owned restore-only
suites passed 97/97, 43/43 and 28/28. Claude found no blocker in the final
bounded-read delta. PR #206 merged at `aa5ff69` after exact-head CI passed
4/4 and Claude's adversarial checks showed that the NATS test server exits
before its private store is removed, including startup failures; its final
file-level cleanup hook also makes an injected teardown failure exit nonzero
under the CI Node 20 and 22 commands. Neither PR changed live services.
The 2026-10-02 provisional full-node baseline includes the approved host
Ollama endpoint changes, but still refuses the obsolete system-domain
`com.openclaw.agent` job. Its guarded retirement runbook is prepared; local
administrator authentication has not yet been supplied. Protected root
observer/admission, three healthy cold masters, isolated restores and live
cutover remain open at 1.2[A]/v1.2-pre.

Checkpoint 2026-10-02 22:21 EDT: the operator-attested legacy root-agent and
sudoers retirement was observed at 22:09 in private evidence; a separate
public preflight observed the job absent at 22:21 on the same boot. Private
root copies and postflight evidence are retained, and the preservation lock
is released. A fresh read-only diagnostic
from main `b6e8874` accepts exactly 23 approved installed jobs, 21 GUI-loaded
jobs and the pinned idle Tailscale exclusion; no cohort job is loaded in the
user or system domain. The 23 plist hashes and 59 direct file pins match the
earlier provisional capture, and both operator-approved host-Ollama plist
values still match the private env file, whose mode was checked as 0600. This
is a point-in-time preflight,
not a Journal baseline or continuous hold. Reboot persistence, complete
provenance and readiness, the production controller/root observer, three
healthy cold masters, isolated restores and live resumption remain open at
1.2 [A]/v1.2-pre. See the runbook execution record and
`POST_RETIREMENT_BASELINE_RECAPTURE_20261002.json`.
The merged PR #195 templates for node-watch, health-watch, consolidation-
scheduler and memory-daemon differ from these installed plists; a re-render
will change at least four pinned plist hashes and require another capture.

Checkpoint 2026-10-02 23:23 EDT: authenticated read-only JetStream observation
found only `local-events-daedalus` on the standalone bus. It owns `local.>`
and holds 24,286 messages; its newest retained message is from 2026-07-14.
The current `moltymacs-virtual-machine` stream is absent from that standalone
bus. All four inspected current
service plists use `OPENCLAW_NODE_ID=moltymacs-virtual-machine`, and the
memory-daemon logs reject creation of its local stream because subjects
overlap. Changing node-watch alone to `daedalus` would falsely mark historical
data as current. Preserve and restore the legacy stream before any subject
repartition or replacement. Protocol step 4.1 observed the current-node stream
working in August on an R=3 topology. A 23:40 read-only check found that exact
`local-events-moltymacs-virtual-machine` stream visible through both
still-running cluster members' JetStream APIs at 4223/4224, with 55,173
retained messages through 2026-09-23. Its only replica is led by nats-3.
The existing private 2026-09-28 cluster-online archive records the same
55,173 messages and last sequence; its separate standalone-online archive
records the older 24,286-message stream. These online points are not the
three healthy cold masters or the isolated restores required by step 1.2.
Preserve and restore that newer history as well as the older standalone stream
before subject migration; prove current-node event emission afterward. The
cluster stream's last retained message is 2026-09-23T18:11:02Z; the daemon now
targets the standalone bus. The cause and date of that switch are not yet
established. This publication failure does not reopen the dotted-name source
fix.
No bus, plist or service changed. See step12_jetstream/RUNTIME_EVIDENCE.md.

Checkpoint 2026-10-03 08:47 EDT: a read-only review of retained NATS and
memory-daemon logs identifies a repeated 4222/8222 collision between
standalone and cluster member 1. Member 1 won on August 24 and August 30;
standalone won on August 26 and September 6. Member 1 restarted under the
same ownership on September 5. The September 6 daemon overlap refusal
followed standalone's successful bind by ten seconds. The daemon's currently
loaded endpoint and an October 1 backup with July 14 modification time name
port 4222, though
intermediate renders are not fully proven. This explains the listener
ownership transition without treating later cluster decay events as daemon
publications. See `audits/step12_jetstream/PORT_4222_FORENSIC_20261003.md`.
Step 1.2 remains [A]/v1.2-pre: the full-node quiet-window controller, three
healthy cold masters, their isolated restores, protected writer and truthful
service restoration remain open. No live state changed.

Checkpoint 2026-10-03 08:58 EDT: follow-up retained logs show member 1
serving 4222 on September 22 while standalone failed its monitor bind, then
standalone serving 4222 on September 25 while member 1 failed. The member-1
interval provides a possible path for the cluster's last observed message at
14:11 EDT on September 23. It does not explain earlier post-September-6
messages or identify their publisher. See the same forensic note. Step 1.2
remains open.

Checkpoint 2026-10-03 09:47 EDT: the read-only legacy NATS census now binds
all four installed GUI plists to their current private config files and
refuses undeclared include, substitution or active non-ASCII tokens. The live
node accepts four current config observations;
35 focused tests pass. This does not establish running-process config bytes,
physical absence, cold masters or a quiet window. Step 1.2 remains [A] at
v1.2-pre; see step12_jetstream/NATS_CONFIG_CENSUS_20261003.md.

Checkpoint 2026-10-03 10:14 EDT: the next read-only diagnostic checks the
`user/<uid>` launchd domain for the four legacy NATS labels and refuses any
loaded job there before scanning processes or stores. A local 36-test focused
suite passes, and this node currently has zero loaded user-domain NATS jobs.
Installed GUI NATS plists also refuse Background session eligibility, which
could create a second job at a later login.
The diagnostic still checks only this user's domains plus system and sets
`physical_absence_certified: false`; full-node hold, protected observer, cold
masters, isolated restores and cutover remain open at 1.2 [A]/v1.2-pre.

Checkpoint 2026-10-03 10:25 EDT: PR #217's first macOS run exposed a
transient owned-fixture health timeout during restore-only recovery; an
unchanged exact-head rerun passed all four jobs. The owned adapter now retries
only transport failures for a bounded three seconds before binding the same
process identity. A transient-timeout regression and the previously failing
owned timer recovery case pass locally. This does not alter production
services or establish a full-node preservation window; 1.2 remains [A].

Checkpoint 2026-10-03 10:48 EDT: PR #219 merged after exact-head CI passed
4/4 and Claude found no blocker in the bounded owned health retry. A follow-up
owned-only control refuses redirects and non-boolean or non-integer health
fields before accepting the restored process. The owned suite passed 30/30,
exact-head CI passed 4/4, and Claude found no blocker. Neither change
certifies a production quiet window or changes live services; step 1.2
remains [A]/v1.2-pre.

Checkpoint 2026-10-03 12:24 EDT: the loaded memory daemon now runs a private
copy that refreshes the node-scoped graph cache even while its session state
is ENDED. The live cache refreshed and node-watch graded the cache, daemon
and ingest WORKING; a 23-unit structural recapture changed only the
memory-daemon plist since the watcher recapture and retained the operator's
host-Ollama settings. The existing private Obsidian sync configuration is
disabled; its apparent "sync done" child exit was a no-op. The stale
`obs.sync` watch reads a separate local concept vault, so its cause remains
unproven. The source change also restores the
installed flush-result gate before a future source redeploy. Remaining
1.2 work still includes full dependency/provenance pins, physical writer
exclusion, three healthy cold masters and isolated restores, plus truthful
resumption. Neither maintenance nor this point-in-time recapture closes
1.2[A]/v1.2-pre. See the post-memory-daemon recapture in step12_jetstream.

Checkpoint 2026-10-03 12:48 EDT: the watcher now grades local vault-note
freshness across the five managed Markdown directories, so a recent
session/daily note no longer loses to stale concepts. A private release
passed an isolated live-vault read and replaced the running watcher entry;
the next report showed vault, graph cache, ingestion and memory daemon
WORKING. A new 23-unit structural recapture changed only the node-watch
plist since the memory-daemon recapture and retained the operator's
host-Ollama settings. The Obsidian sync CLI remains disabled; vault-note
freshness is not external sync proof. The release still links shared
dependencies, and neither this repair nor the recapture certifies physical
writer absence, three healthy cold masters or a NATS cutover. Step 1.2
remains [A]/v1.2-pre; see the post-vault-watcher artifact in
step12_jetstream.

Checkpoint 2026-10-03 13:23 EDT: draft PR #224 records a candidate
powered-off-VM route for historical JetStream snapshots, with three serving
cold masters and the separately held member-1 history kept distinct. Claude
found no blocker in the candidate at 407d20b, and its four exact-head checks
passed. The branch now includes the post-vault-watcher baseline from main;
the host UTM package path and host-side execution path remain unverified.
A typed host receipt, historical acceptance manifest, treatment of the
pre-power-off writer gap, three extracted and isolated-restored cold masters,
and verified service resumption still remain. No live NATS service, store or
VM was changed. Step 1.2 stays [A]/v1.2-pre; neither the full-node Journal
nor the cold masters are sealed.

Checkpoint 2026-10-03 13:48 EDT: the owned JetStream fixture now separates
online-archive evidence from direct cold-store evidence with a deliberately
late message and consumer acknowledgement. Standalone archive sequence 12
differs from its cold clone at 13; the fixture's held R1 earlier capture is 7
and its separate single-member cold clone is 8. The fixture passed on the
installed NATS CLI/server, with only working copies booted and all owned
servers stopped. This is synthetic evidence only. The actual host VM image,
three serving cold masters, acceptance engine/receipt, writer-gap contract
and truthful production resumption remain open at 1.2 [A]/v1.2-pre. See
step12_jetstream/COLD_STORE_ARCHIVE_DIVERGENCE_FIXTURE.json.

Checkpoint 2026-10-03 14:07 EDT: an owned direct-baseline driver now captures
server identity, complete reachable stream digests and consumer positions in
private manifests, with explicit offline assignments. The owned fixture
passed final standalone/cluster captures and rejected false-offline,
undeclared-offline and failed-auth cases; all owned servers stopped. This is
synthetic pre-stop evidence, not an accepted production baseline or common
quiet point. The host's powered-off UTM backing artifact and execution path,
three serving cold masters, host receipt, writer-gap decision, isolated
restores and service resumption remain open. Step 1.2 stays [A]/v1.2-pre;
see step12_jetstream/COLD_BASELINE_FIXTURE.json.

Checkpoint 2026-10-03 14:46 EDT: an owned isolated direct-store probe boots
working copies of four frozen distinct store trees, checks standalone content,
held R1 in isolation, the two survivors' offline assignment and R1 after
rejoin, then rehashes every master. The owned fixture passed and a deliberately
stale archive baseline refused with no success report; all test servers
stopped. This is synthetic restore-mechanism evidence only. Host-side stopped
VM access, three real serving cold masters, the typed host receipt, protected
writer-gap decision and truthful production resumption remain open; 1.2 stays
[A]/v1.2-pre. See step12_jetstream/COLD_TREE_PROBE_FIXTURE.json.

Checkpoint 2026-10-03 15:04 EDT: the direct pre-stop JetStream capture now
requires a pinned server name, ID and cluster, refusing a wrong listener
owner before any stream read. Owned controls for wrong name, ID and cluster
all produced private failure records without success manifests; the complete
four-tree fixture still passed and all test servers stopped. The expected
identity must come from independent managed-service and monitor preflight,
not the ambiguous 4222 endpoint alone. This closes one port-flip capture
hazard, not the production writer-gap, host image, three serving cold masters
or resumption; 1.2 stays [A]/v1.2-pre. See
step12_jetstream/COLD_BASELINE_IDENTITY_FIXTURE.json.

Checkpoint 2026-10-04 11:51 EDT: SSH access to the Mac host established the
UTM 4.7.5 package candidate, its single 211 GB writable image, auxiliary
storage and stale vmstate. The running virtualization process still owns the
image. The local APFS volume has only 115.7 GB free; a disposable same-volume
clone control passed, but no real image was copied. UTM control refuses SSH
sessions, so a host-GUI power handoff and durable host copy/receipt are still
required. This is read-only production discovery plus a disposable synthetic
clone test, not a stopped-VM or cold-master observation. Step 1.2 remains
[A]/v1.2-pre; see step12_jetstream/STOPPED_VM_COLD_MASTER_CANDIDATE.md.

Checkpoint 2026-10-04 12:08 EDT: the host's logged-in launchd domain ran a
one-shot UTM status query and identified the pinned guest as started; ordinary
SSH UTM control still refuses. The installed stop verb defaults to a forced
power-off and requires `--request` for a guest shutdown request. A disposable
ASIF image was cloned, attached and mounted read-only on the host, with its
marker recovered exactly; no real UTM image was copied or mounted. Guest
FileVault is off and the four NATS store trees total about 107 MB, suggesting
an ephemeral COW image clone could be discarded before guest restart after
extracting masters. A durable host handoff, capacity floor, clean shutdown,
typed receipt, production extraction, three isolated restores and truthful
resumption remain unimplemented. Step 1.2 stays [A]/v1.2-pre.

The bounded host ASIF extractor and its macOS fixture now copy all four
declared store trees from an owner-private read-only clone and refuse a wrong
Data-volume UUID or image hash. This is a tested source component, not a host
power controller or production extraction. The plan's live and restoration
gates above remain open; see step12_jetstream/HOST_ASIF_EXTRACT_FIXTURE.json.

Checkpoint 2026-10-04: the host's isolated four-store JetStream fixture passed
with all owned test servers stopped and original synthetic masters unchanged.
The ASIF extractor now also refuses traversal and symlink entries, restricts
new file modes and records detach failure before success. Guest and host Mac
fixtures pass; exact-head CI for the preceding extractor commit passed 4/4.
These are mechanism results only. No production VM stop or cold master exists.

The host read-only preflight now checks UTM package/config/image identity and
combines the SSH account's package access with a one-shot GUI UTM status query.
It reported the pinned VM `started` with one image holder; a wrong config hash
failed closed. It does not control guest shutdown or certify a cold-copy
window; see step12_jetstream/HOST_VM_PREFLIGHT_FIXTURE.json.

The host capture worker now passes a disposable VM-shaped ASIF rehearsal on
guest and host, including a detached host execution and a no-shutdown refusal.
It uses clonefile directly because `cp -c` may fall back to a full copy. It
does not stop the production guest and its sampled stopped-state capture is
not a cold-master acceptance; see step12_jetstream/HOST_CAPTURE_FIXTURE.json.

Guest-to-host stopped-store content matching now passes the integrated
four-store disposable fixture on both Macs, and a changed extracted file
refuses. The guest source hash still needs the real managed writer hold; the
actual three serving histories and held R1 have not been copied or restored.
See step12_jetstream/HOST_STOPPED_TREE_MATCH_FIXTURE.json.

The host's persistent owner-only recovery directory now exists on the VM
image's device. No production image or store has been copied into it.
The host's pinned 0600 VM and four-store specifications pass a fresh read-only
preflight there; UTM is still `started` with one disk holder. See
step12_jetstream/HOST_PREPARED_SPECS.json.

The next exact-head CI run exposed an intermittent `TIMEOUT` while the owned
two-member cold-restore cluster answered its initial stream-name query. The
same fixture failed once and passed on subsequent local runs; the restore
still refuses a missing or changed stream. The initial name query now retries
only request timeouts within a bounded interval, and failure records identify
which cluster-read phase refused. No production bus or VM was changed.

At 2026-10-04 13:28 EDT, the four Python host preservation tools were copied
as owner-private, hash-checked regular files into the host's persistent
recovery directory. Running the staged preflight reported the pinned VM
`started` with one image holder and unchanged config/controller hashes. This
is preparation, not a shutdown, image capture or master acceptance; see
step12_jetstream/HOST_STAGED_TOOLS_20261004.json.

The host's persistent isolated restore runtime now has byte-matched Node
24.13.0, NATS CLI 0.3.1, NATS server 2.12.6, the current recovery scripts and
all 212 required dependency files. An owned four-history fixture run from that
directory passed with every test server stopped, unchanged masters and stale
baseline refusal. This is synthetic restore capability, not a real cold-master
test; see step12_jetstream/HOST_ISOLATED_RUNTIME_20261004.json.

The separately pinned release verifier refused that host package until the
dependency root was made owner-only, then verified all nine top-level files
and 212 dependencies. A wrong manifest pin refused with no success receipt;
owned mutation controls cover changed code, changed dependency, readable
directory and an extra symlink. The original failed receipt remains. This
integrity gate does not attest any VM power state or real history; see
step12_jetstream/HOST_RUNTIME_VERIFY_20261004.json.

At 2026-10-04 13:57 EDT, the stopped-tree matcher was bound to the private
host capture receipt and the exact cloned image. Guest and host disposable
ASIF fixtures pass, including a changed-receipt refusal. The updated tools
were staged as owner-private, hash-checked regular files on the host; the
isolated restore runtime still verifies against its separate pinned manifest.
The production VM remains started. No actual image or history was copied,
restored or accepted; the full-node hold, shutdown provenance and service
resumption gates remain open at 1.2 [A]/v1.2-pre. See
step12_jetstream/HOST_CAPTURE_BINDING_20261004.json.

Checkpoint 2026-10-04 15:52 EDT: Claude's read-only adversarial review of
PR #224 at 1133b83b found no blocker in the mechanism-only host capture and
matching delta, but identified retained same-volume clone lifetime as the
next safety-critical production gate. A disposable Mac fixture now refuses
clone disposal while the VM is reported running and removes the clone with a
private receipt only after a fresh stopped/no-holder preflight and full image
hashes. Absolute-path and hardlink extraction refusals are also covered.
Claude's read-only delta review at dcebda81 found no code blocker and confirmed
that a continuous host restart interlock and failed-capture cleanup remain
required. CI at that head failed only when the disposable ASIF fixture's
immediate eject returned "Volume failed to eject" after hardlink creation; the
fixture now makes bounded retries for that exact transient result. Exact-head
macOS, Node 20 and Mission Control CI checks for the retry passed. The Node 22
job failed in an unrelated mesh-agent lifecycle fixture because two independent
free-port requests returned the same port; its failed job is rerunning. The
seven reviewed host files were staged as an
inactive owner-private package and verified by manifest hash; see
step12_jetstream/HOST_STAGED_DISPOSAL_20261004.json. This work does not prevent
an independent UTM restart, clean up an incomplete capture, accept real
stores, or authorize a production VM stop. 1.2 stays [A]/v1.2-pre.

Checkpoint 2026-10-04 16:10 EDT: the host disposal tool now has a separate
failed-capture cleanup action. An owned ASIF fixture induced a capture failure
after clone creation, proved cleanup refuses while that clone is attached,
then ejected and removed the orphan with the original image intact. The
action requires the failed/armed records, the same source-image file identity,
no clone holder or disk-image attachment, and stopped/no-holder observations
before and after unlink. This is a disposable mechanism test, not a production
boot interlock or master acceptance. Exact-head CI and adversarial review of
this delta remain pending; 1.2 stays [A]/v1.2-pre.

At 2026-10-04 16:17 EDT, the updated host package's seven files verified
against source-manifest SHA-256 d8efb760c9ae97e61c27e1033d6e1f46fad18e24809b1f0d3a376690f2346451.
The disposable failed-capture fixture passed on both Macs, Claude's read-only
ad581126 review found no blocker, and exact-head CI run 37231113880 passed
all four jobs. The previous Node 22 duplicate-port failure also cleared on
rerun. These results cover mechanism and staging only. No production VM stop,
clone or real-store restore occurred; the continuous UTM hold, boot interlock,
historical master acceptance and truthful service resumption remain open at
1.2 [A]/v1.2-pre. See step12_jetstream/HOST_FAILED_CLEANUP_20261004.json.

At 2026-10-04 16:29 EDT, disposable guest/host probes showed that `uchg`
blocks a new writable open and survives `clonefile`, but an existing writable
descriptor can still write after the flag is set. A read-only attach of an
immutable synthetic ASIF clone passed on the guest. The host has no external
volume mounted with room for the full image. Claude's adversarial design review
identified stranded immutability as an availability hazard. Before this guard
enters the production capture path, a disposable UTM start/refusal/recovery
test and idempotent clone-first boot reconciliation are required. No source
flag was applied to the production VM; 1.2 remains [A]/v1.2-pre. See
step12_jetstream/HOST_UCHG_DESIGN_PROBE_20261004.json.

The isolated `host_image_immutable.py` primitive and macOS fixture now verify
the flag operation by open file identity, refusal of wrong inode and symlink,
the pre-existing writable-descriptor bypass, inherited clone flag, read-only
attach, clone-only unlock and eventual source unlock. The fixture passed on
both guest and Mac host with disposable ASIF files. The primitive is not
connected to the production capture or boot path; UTM-level behavior and
crash reconciliation remain the next safety work.

At 2026-10-04 16:39 EDT, exact-head CI run 37232577479 passed all four jobs
at 09f5b8da, and Claude's read-only delta review found no blocker in the
isolated primitive. The Mac host's disposable fixture also passed, then its
temporary test files were removed. No production hold was acquired. See
step12_jetstream/HOST_IMMUTABLE_PRIMITIVE_20261004.json.

The next host slice is specified in
step12_jetstream/HOST_BOOT_GUARD_DESIGN_20261004.md: prove real disposable UTM
start/refusal, then implement crash-safe clone-first reconciliation. Clearing
the source flag yields only a bootable disk; the separate VM start decision
still needs accepted histories or an explicitly designed abort path. Neither
production controller exists yet.

A disposable crash-reconciliation mechanism now recovers from an immutable
source plus an orphan clone, refuses an attached clone, another sibling clone
or a changed completed-capture source, and yields only a scoped `BOOTABLE`
receipt. Its guest and Mac-host fixtures pass. A repeated preflight in that
fixture exposed a GUI status publication race; `host_vm_preflight.py` now
publishes that JSON by atomic rename, with a deterministic regression check.
These tools remain disconnected from the production VM and do not authorize
its start. Real UTM behavior and the full-node hold remain open.

The inactive guard candidate now writes a durable intent bound to the armed
attempt and stopped image identity before applying the source flag. The
reconciler refuses a missing or mismatched intent, so an old arm receipt alone
cannot clear an unrelated guarded image. Disposable guest and Mac-host
regressions cover that refusal and a complete guard/reconcile cycle. This
does not establish a continuous production no-start bracket or cold-master
acceptance; step 1.2 remains [A]/v1.2-pre.

Claude's exact f95414ab guard-intent review found no blocker and pointed out
that a prior successful `BOOTABLE` receipt should not allow a later flag to
be cleared by reusing that old intent. The reconciler now permits an
idempotent repeat only if the source is still unguarded and the clone absent;
a re-guarded source refuses. Guest and Mac-host fixtures pass, all four
exact-head CI jobs pass at 15b384df (run 37234974722), and Claude's narrow
delta review found no blocker. Ten source files are staged on the host in an
inactive 0700/0600, hash-verified package; no production VM or service was
changed. See step12_jetstream/HOST_GUARD_INTENT_20261004.json. This remains
a disposable source candidate at 1.2 [A]/v1.2-pre.

The inactive host capture candidate now refuses a sampled `Data/vmstate`
identity change between its running arm observation and stopped extraction.
Two focused regressions and the synthetic ASIF capture pass locally; the
host's current stale vmstate was inspected read-only. This narrows accidental
suspend acceptance but does not prove a clean shutdown or cold restart.
All four exact-head CI jobs passed at d85caa20 (run 37236853002), and
Claude's read-only delta review found no blocker. The exact ten-file source
package is staged inactive and hash-verified on the host; a fresh read-only
preflight still reports the VM started with one image holder and the stale
vmstate present. Real UTM clean-shutdown behavior could still make the
candidate refuse, so a disposable VM rehearsal remains required. No
production hold, VM stop, clone or history acceptance occurred. See
step12_jetstream/HOST_VMSTATE_GATE_20261004.json. Step 1.2 remains
[A]/v1.2-pre.

Checkpoint 2026-10-04 21:36 EDT: the retained member-1 R1 tree was
self-consistent with its co-located 128-entry manifest (82 files, 6,346,296
bytes). Every entry was owner-owned, read-only and immutable at observation.
The manifest SHA-256 was pinned here for the first time; without an
independent September 28 pin, continuity since the reported freeze is not
proven. Member 1 was disabled and unloaded. The 23 installed job hashes
matched the post-vault-watcher structural baseline, with 21 GUI jobs loaded
and one approved system exclusion. This is not a new common recovery point
or acceptance of the three serving histories. No live VM, service or NATS
store changed; 1.2 remains [A]/v1.2-pre. See
step12_jetstream/HELD_R1_RECHECK_20261004.json.

An owned synthetic ASIF regression now opens a writable image descriptor
between the guard's initial stopped/no-holder observation and its flag change.
The post-guard observation refuses without a GUARD receipt, and reconciliation
refuses while the holder remains before restoring bootability after it closes.
The local macOS fixture passes; the interrupted host fixture has no result.
Real UTM start/refusal behavior and the full-node hold remain unproven. No
production VM or service changed; 1.2 remains [A]/v1.2-pre.

Checkpoint 2026-10-04 23:25 EDT: the host reconciler now validates any
`GUARD.json` against its durable intent and records `guard_completed` in the
scoped `BOOTABLE` receipt. Recovery after an aborted guard records false; a
completed guard records true. The holder-present negative now asserts that
the source remains immutable and `OPERATOR_REQUIRED.json` exists. The local
macOS reconciliation fixture passes (2/2), and plan-lint remains conformant.
`BOOTABLE` still means disk bootability only; no VM start controller, real
UTM rehearsal, full-node hold, cold-master acceptance or service resumption
is claimed. No production state changed; 1.2 remains [A]/v1.2-pre.

Checkpoint 2026-10-04 23:33 EDT: Claude's read-only full-node review found
that no production 23-unit hold driver exists, and the planned post-capture
guest boot would allow bootout-only jobs to restart before recovery can enforce
dependency or deploy-listener order. D62 records the persistent-hold and
explicit acceptance-or-abort requirement for this planned reboot. The review
also identified detached-process, other launch-path and host UTM autostart
gaps; none is certified by the current point-in-time scans. Claude's review
of the `guard_completed` receipt found no false-acceptance blocker but did
find that a partial `GUARD.json` write could strand an immutable image. The
guard now publishes that receipt atomically, and the macOS interrupted-write
regression recovers a bootable source with `guard_completed:false`. The local
reconciliation fixture passes (2/2). This is still a disposable mechanism;
no production hold, VM stop, cold master, history acceptance or resumption
occurred. Step 1.2 remains [A]/v1.2-pre.

Checkpoint 2026-10-04 23:39 EDT: Claude accepted the atomic guard receipt
code and blocked D62's first draft because it inverted the stopped-VM order.
D62 now keeps the original guest off through host-side isolated restore,
historical acceptance and freeze, or until an explicit failed-capture abort
after host cleanup. It requires the boot-time job/process check before
`Journal.recover()` can label an owner `already-restored`; gated timer starts
are not silently exempted. The guard now refuses pre-existing receipt artifacts
before changing the image flag, and BOOTABLE publishes atomically as well.
Local macOS reconciliation tests pass (2/2), including partial guard and
BOOTABLE receipt writes. No production VM or service changed; full-node hold,
real UTM rehearsal, real-history acceptance and resumption remain open at
1.2 [A]/v1.2-pre.

Checkpoint 2026-10-04 23:46 EDT: Claude's re-review found no blocker in the
guard/BOOTABLE crash fixes or corrected D62. It exposed a separate existing
strand point: a partial final `CAPTURE.json` would stop clone cleanup and
source unlocking. The capture worker now publishes that receipt atomically;
a partial temporary receipt is ignored by reconciliation after fresh stopped,
no-holder and source-identity checks. Local macOS capture tests pass (4/4)
and reconciliation tests pass (2/2), including the partial-capture recovery.
D62 now distinguishes expected Tailscale helper execution under D60 from
cohort auto-start and includes failed-acceptance aborts. Production capture
ordering, full-node hold, real UTM rehearsal, cold masters and runtime
resumption remain unproven; 1.2 stays [A]/v1.2-pre.

Checkpoint 2026-10-04 23:59 EDT: the inactive capture candidate now requires
a matching completed image guard before creating the clone, rechecks the
guarded source and receipt hash through extraction, and records the guard hash
in its capture receipt; the guest/host matcher rechecks that hash. The
disposable ASIF capture exposed that `clonefile`
inherits the immutable flag; the worker now clears it on the verified clone
only, and failed-capture cleanup can remove an interrupted immutable clone.
The Mac fixture exercises guarded capture, disposal and reconciliation,
and a missing-guard negative refuses before cloning. This is sampled guard
binding, not a continuous no-writer claim. No production VM or service has
changed; full-node hold, UTM rehearsal, historical acceptance and resumption
remain open at 1.2 [A]/v1.2-pre.

Checkpoint 2026-10-05 00:19 EDT: the capture wait now requires the guard to
have been observed during a stopped/no-holder sample, then takes a fresh
pre-clone preflight. Successful clone disposal now uses the same open-holder
and disk-attachment refusal as failed-capture cleanup and reconciliation.
The disposable ASIF fixture attaches the completed clone read-only, confirms
disposal refuses with the clone intact, ejects it, then completes disposal.
The local host test group passes (9/9). This remains a sampled, disposable
mechanism; no production VM or service changed, and 1.2 remains
[A]/v1.2-pre.

Checkpoint 2026-10-05 00:27 EDT: Claude's read-only review of 9ca5e89d
found no new false-acceptance path but confirmed that completed-clone disposal
could unlink an attached image. The attached-clone refusal landed at
396e4950, whose four CI jobs passed. A disposable host probe showed that
`hdiutil info` retains an attachment's original path even after external
unlink. Reconciliation now checks for that attachment before unlocking the
source, including when the clone path is gone. A transient pre-intent guard
failure can be retried in a fresh preflight directory; post-intent failure
still requires reconciliation. The host fixture pins both cases and passes
9/9 locally. This does not establish a complete abort controller or permit
production VM shutdown; step 1.2 remains [A]/v1.2-pre.

Checkpoint 2026-10-05 00:48 EDT: a disposable macOS probe showed user-level
`lsof` reports no holder for either a read-only or writable `hdiutil`
attachment of an ASIF image. Host preflight now refuses an attached source
image before guard, capture or reconciliation can treat it as stopped and
idle. The fixture refuses a writable source attachment before guard and a
read-only source attachment before reconciliation unlock.
The guard also refuses a capture directory already marked failed or complete;
its intent now publishes atomically under the armed receipt lock before
changing the flag. A deliberately interrupted intent write leaves no final
intent or immutable source, and a retry succeeds. The local host group passes
9/9. These disposable checks do not prove continuous exclusion or authorize
production shutdown; 1.2 remains [A]/v1.2-pre.

Checkpoint 2026-10-05 01:04 EDT: Claude's review of `658982fe` found that the
armed receipt lock ended after intent publication. A paused guard could then
allow reconciliation to issue `BOOTABLE`, resume, and flag the source again.
The guard now holds that lock through its immutable flag and `GUARD.json`
receipt; reconciliation holds the same lock through `BOOTABLE` or
`OPERATOR_REQUIRED`. A disposable macOS concurrency fixture pauses the guard
after intent publication and checks reconciliation cannot enter preflight or
issue `BOOTABLE` until the guard finishes; it then records
`guard_completed:true` and an unflagged source. The local host group passes
10/10. Capture-worker terminal writes and active extraction are not yet
serialized against reconciliation. This does not authorize production VM
shutdown; the full-node hold, UTM rehearsal, historical acceptance and
resumption remain open at 1.2 [A]/v1.2-pre.

Checkpoint 2026-10-05 01:25 EDT: Claude found no blocker in the same-attempt
guard/reconcile serialization at `e465b9c8`, but identified by inspection
that an active capture paused before cloning could race reconciliation and
leave a false `BOOTABLE` claim. The capture worker now holds an attempt-local activity lock
from before arming through its terminal-write attempt; reconciliation
refuses that lock non-blockingly before touching the image. Capture also
serializes its terminal write with guard publication on `ARMED.json`. The
disposable fixtures pin lock ownership during the worker's shutdown wait,
reconcile refusal while capture is paused immediately before cloning, and
terminal failure waiting for the armed lock. The local host group passes
12/12. The prior exact-head CI's macOS job
first hit an unrelated `mesh-agent` restore-only timeout, then passed on a
failed-job rerun with all four checks green. Sibling attempts, a killed worker
without a terminal receipt, the full-node hold and real UTM rehearsal remain
unproven; no production VM or service changed. Step 1.2 remains
[A]/v1.2-pre.

Checkpoint 2026-10-05 01:40 EDT: Claude found no same-attempt false
`BOOTABLE` path or deadlock in `23825654`; all four exact-head CI jobs passed.
The review clarified that a killed capture worker releases its activity lock
without a terminal receipt. The guard now probes that lock without waiting
before publishing intent and refuses when the lock is free; the disposable
fixture checks that refusal leaves no intent or image flag and that a live lock still
permits a guarded attempt. A second test case releases the worker lock after
preflight and confirms the guard's final probe refuses before intent or flag.
The local host group passes 12/12. No source-wide exclusion, no-intent abort receipt,
real UTM rehearsal, full-node hold or production stop is claimed. Step 1.2
remains [A]/v1.2-pre.

Checkpoint 2026-10-05 02:22 EDT: the GUI launchd adapter now has a disabled
override probe and separate disable/re-enable methods. Re-enable refuses while
the job is still loaded. The owned macOS fixture arms its process watch, disables
its disposable job, observes a normal stop, confirms the disabled override
survives bootout, then re-enables and restarts the same job. The restore-only
prototype uses the same override inspection. This is a per-job primitive,
not a production 23-job hold or a reboot-persistence test. Root/user jobs,
detached processes, other launch paths, host UTM autostart, continuous
exclusion and the D62 boot decision remain open. No production service or VM
was changed; step 1.2 remains [A]/v1.2-pre.

Checkpoint 2026-10-05 02:38 EDT: Claude's exact-head review of `04f654b3`
found no production-code blocker but showed that the stop path did not require
the override, the fixture had not tried a blocked restart, and CI skipped the
macOS-only test. The opt-in managed stop now refuses bootout unless the GUI
override is disabled and rechecks it after bootout. Managed bootstrap and
kickstart refuse a disabled label. The owned fixture checks the stop proof and
refused restart; a small dependency-free macOS CI fixture tests the same
disable/bootout/re-enable sequence. The launchd override covers only the GUI
domain and that head did not prove reboot persistence or a direct launchctl
restart refusal. The test label is stable now, but
earlier local runs left three random test-label entries and the stable label
marked `enabled` in the host launchd override database; no production label
was disabled. The full-node hold remains open at 1.2 [A]/v1.2-pre.

Checkpoint 2026-10-05 02:44 EDT: Claude found that the refused-restart
assertion at `2df27167` was self-checking: `Launchd.bootstrap()` refused
before launchctl could be asked. The macOS fixture now also calls
`launchctl bootstrap` directly while the owned GUI label is disabled. On the
operator host it returned nonzero, left the job unloaded, and did not recreate
its ready marker during a one-second observation. The wrapper refusal remains
a separate check. The two owned fixtures use distinct stable labels and
recover a stale disabled override for their own label at setup if it is
unloaded. This proves one
direct GUI-domain bootstrap refusal on this host, not legacy `load`, other
domains or reboot persistence. No production service or VM changed; 1.2
remains [A]/v1.2-pre.

Checkpoint 2026-10-05 03:02 EDT: the direct launchctl fixture now waits a
second after owned-job bootout before testing disabled bootstrap, then uses
the same raw bootstrap command immediately after re-enabling the label. The
disabled attempt returned nonzero with no loaded job or ready marker; the
enabled attempt loaded and ran the owned job. This controls for a transient
post-bootout refusal in the previous test. The dedicated macOS fixture passes
locally (1/1), and plan-lint is conformant (14 pass, one existing idle-step
warning). CI and Claude review of this exact revision remain pending. This
remains one GUI-domain job; no production hold, other-domain restart exclusion,
reboot persistence, or production VM change is claimed. Step 1.2 stays
[A]/v1.2-pre.

Checkpoint 2026-10-05 03:16 EDT: D64 closes one false-restoration path while
the D62 boot controller is absent. A full-node journal reopened in another
boot now refuses `recover()` before observing or restoring a service, so a
login auto-start cannot be labeled `already-restored` by that API. The owned
journal suite passes 97/97 locally, including the new no-callback/no-record
reboot assertion. The actual persistent 23-job hold, boot decision, detached
process census, safe service order and real-history acceptance remain open;
this refusal does not make the node operational. No production service or VM
was changed; 1.2 remains [A]/v1.2-pre.

Checkpoint 2026-10-05 03:29 EDT: D65 makes the isolated four-history probe
reject an output directory that physically overlaps any cold master before
creating that directory, including an absent path under a symlinked ancestor.
The disposable NATS fixture passed with the new alias regression; it also
verified the target was not created and the master tree hash stayed unchanged.
This closes a probe path-isolation defect, not the remaining full-node hold,
real-history capture/restore, historical acceptance, or boot/resumption gates.
No production history or service was changed; 1.2 remains [A]/v1.2-pre.

Checkpoint 2026-10-05 05:31 EDT: D66 closes the isolated probe's omitted-R1
set check. It now requires `held.streams`, the two serving baselines' offline
assignments and the held baseline's R1 snapshots to identify the same streams
before starting servers. The disposable four-history fixture passes, including
a negative held-baseline mutation refused at validation with its master hash
unchanged. Claude's other findings on per-member replica validation, offline
consumer positions and recovery ordering remain under review; this is not
production history acceptance. No production service or history was changed;
1.2 remains [A]/v1.2-pre.

Checkpoint 2026-10-05 05:39 EDT: D67 fixes the owned launchd stop census
missing descendants of orphaned members of the owner's process group. The
four-process negative regression passes, and the disposable macOS launchd
suite passes 26 tests (one existing skip). This does not cover arbitrary
detached writers, root/user agents, or the absent full-node hold driver. No
production service was stopped; 1.2 remains [A]/v1.2-pre.

Checkpoint 2026-10-05 05:47 EDT: D68 moves full-node checks of the held
member-1 and federation jobs ahead of all service restoration; a mismatch
produces no restoration intent. A prior service or entrypoint error also
withholds the deploy listener while preserving D23's restoration of safe known
units. The two negative regressions and full journal suite pass 99/99; the
hold suite still passes 43/43. Continuous member-1 exclusion, a deploy fence
and a clean-path pre-listener final check remain open, as do the other step
1.2 acceptance and resumption gates. No production service was changed;
1.2 remains [A]/v1.2-pre.

Checkpoint 2026-10-05 06:59 EDT: D69 closes the D66 test gap found by
Claude. The disposable cluster now has two genuinely offline R1 streams on
the held member. An otherwise valid plan that omits the second held stream
refuses at validation before any probe server starts; the master hash remains
unchanged. The positive four-history fixture passes and all owned servers
stop. Per-member replica validation, offline consumer positions, a deploy
fence and full-node hold are still open. No production store or service was
changed; 1.2 remains [A]/v1.2-pre.

Checkpoint 2026-10-05 07:10 EDT: D70 makes a cold baseline refuse an
unavailable R1 consumer on an otherwise available R3 stream. In a disposable
three-member NATS 2.12.6 cluster, a durable acknowledged a message before its
single consumer replica's owner stopped. A survivor then returned an empty-name
placeholder with `missing` naming that consumer. `take_cold_baseline` now
failed without a success manifest; after the owned member restarted and the
temporary stream was removed, the full four-history fixture still passed and
all owned processes stopped. This addresses the observed consumer-position
false acceptance, not per-member replica verification, independent consumer
inventory, or any production hold/restore gate. No production history or
service changed; 1.2 remains [A]/v1.2-pre.

Checkpoint 2026-10-05 07:31 EDT: D71 follows Claude's process-tree review.
The owned launchd census now closes over children and every discovered
process group, and the watcher refuses a pre-signal group change or a
survivor in any group recorded at bind. Synthetic orphaned-group negatives
exclude an unrelated session, and the full owned macOS suite passes 29 tests
with one existing skip. This is still only the bound service tree; a wholly
detached group, root/user jobs, host autostart and reboot persistence require
the missing full-node hold. No production service changed; 1.2 remains
[A]/v1.2-pre.

Checkpoint 2026-10-05 07:41 EDT: D72 closes a second consumer-inventory false
acceptance found in Claude's review. An owned NATS 2.12.6 cluster returns an
R2 durable in `CONSUMER.LIST.missing` with zero consumer rows after its leader
stops, even though the R3 stream remains online. The shared raw paginated
lister now refuses that response, plus D70's empty-name R1 placeholder, in
baseline, snapshot and capture paths. One owned loopback run with an
acknowledged R2 durable produced the missing-only response and a failed cold
baseline with no success manifest. Subsequent real runs timed out on the list
request, so the repeatable regression injects the exact raw response into the
shared lister. The real R1 placeholder and positive four-history fixture still
pass with all test servers stopped. Per-member replica
validation and independent expected-consumer inventory remain open, along
with the full-node hold, VM and resumption gates. No production history or
service changed; 1.2 remains [A]/v1.2-pre.

Checkpoint 2026-10-05 07:54 EDT: D73 restores the post-loop observation of
held `nats-1` and `federation-tick` during full-node recovery while retaining
D68's pre-loop check. In a disposable journal, either job changing as
`nats-2` restores now produces a named error, no restored result and no
execution-hold release. The 100-test journal suite passes. These are two
samples, not a continuous exclusion proof; the complete production hold and
restart barriers remain open. No production job changed; 1.2 remains
[A]/v1.2-pre.

Checkpoint 2026-10-05 08:09 EDT: D74 corrects the D72 fixture limit. Claude's
three disposable R2 trials showed that NATS takes about four seconds to
report the missing consumer; our one-second fixture requests caused the
apparent nondeterminism. The fixture now uses the normal ten-second request,
retries transient post-leader-loss 503, and again requires the real missing-only
response and an acknowledged consumer position. Cold baseline and snapshot
commands both refuse with the consumer named and no success manifest, then
the positive four-history probe passes and all owned servers stop. This is
owned test evidence only. Serving-member replica verification, the physical
hold and production acceptance remain open; 1.2 stays [A]/v1.2-pre.

Checkpoint 2026-10-05 08:32 EDT: Claude's exact-head review confirmed that
reverting the snapshot consumer lister makes the owned R2 fixture accept a
missing consumer, while the unchanged fixture refuses with the required
message and no manifest. The fixture now also waits for stream information
after observing the missing-consumer response, so a stream leadership delay
cannot become a different failure. CI at the previous head found an unrelated
task-daemon test collision: two separately sampled ephemeral ports were
identical. The fixture now resamples its monitor port until distinct; all
seven task-daemon lifecycle tests pass locally. CI for this correction remains
required. No production history or service changed; 1.2 remains [A]/v1.2-pre.

Checkpoint 2026-10-05 09:13 EDT: D75 makes completed-capture disposal and
reconciliation refuse before clone deletion or source unlock until a bound
acceptance or explicit abort decision exists. The owned host tests pass 9/9;
their completed-capture negatives retain the clone and immutable source while
interrupted-guard and failed-capture cleanup remain tested. This is source and
disposable-fixture evidence only. The acceptance/abort and boot controllers,
full-node hold, real UTM start/refusal rehearsal and real-history restores
remain open. No production VM, service or NATS store changed; 1.2 stays
[A]/v1.2-pre.

Checkpoint 2026-10-05 09:30 EDT: Claude challenged D75 against staged host
tool copies, a vanished sibling clone and the missing terminal decision. The
new receipt scope makes old staged tools refuse after publication; reconcile
also refuses a sibling completed receipt with no clone. Production capture
entry now refuses before creating an attempt until an acceptance/abort
controller exists. Retiring old staged packages, proving the full-node hold,
real UTM guard behavior, terminal decisions and isolated real-history restores
remain open. No production VM, service or NATS store changed; 1.2 stays
[A]/v1.2-pre.

Checkpoint 2026-10-05 11:50 EDT: D76 bounds `Launchd.status()` inspection
at ten seconds, matching other managed commands, so a hung `launchctl print`
fails the stop/recovery path instead of waiting indefinitely. The owned
preflight tests pass with a timeout negative. This is a local liveness guard;
the persistent full-node hold, deployment fence, stopped-VM decision path,
four-history acceptance and verified resumption remain open. No production
job, VM or NATS store changed; 1.2 stays [A]/v1.2-pre.

Checkpoint 2026-10-05 12:13 EDT: D77 moves the deploy listener's release
behind the second held-unit check, a fresh check of the other 22 services,
physical ownership and loaded jobs, and a required deploy-fence callback.
The release evidence is durable before any listener restore; an unexpected
restart after this journal stopped the listener now refuses. The owned
journal suite passes 106 tests, including late failure and clean release
cases. The actual deploy-marker and pending-work fence, forward stop-order
enforcement, persistent full-node hold, stopped-VM decision controller and
real-history acceptance remain open. No production service, VM or NATS store
changed; 1.2 stays [A]/v1.2-pre.

Checkpoint 2026-10-05 12:29 EDT: Claude found that D77's listener release
was using a no-op per-unit guard. D78 includes the listener in the NATS
legacy lock interval. The owned clean-path test now proves an independent
exclusive writer cannot take that lock during either the deploy-fence
decision or the listener restore. The journal suite passes 106 tests.
Production deploy-fence logic, full-node hold and all capture/acceptance
gates remain open. No production service, VM or NATS store changed; 1.2 stays
[A]/v1.2-pre.

Checkpoint 2026-10-05 12:40 EDT: D79 closes Claude's crash-after-release
gap: a release row without a later listener recovery-verified or
already-restored row cannot authorize a listener found running on a later
attempt. The owned negative refuses before the fence or any restore. Tests
for late service and listener drift now use call counts so recovery cannot
swallow a test assertion and appear to pass. The journal suite passes
107 tests. This does not supply the production deploy fence, persistent
hold, stopped-VM decision controller, four-history acceptance or verified
service resumption. No production service, VM or NATS store changed;
1.2 stays [A]/v1.2-pre.

Checkpoint 2026-10-05 13:05 EDT: Claude's exact-head review found no new
journal release blocker, but a missing test of the listener's NATS commit
point. D80's owned negative creates a root handoff marker during the deploy
fence and requires the precommit check to prevent any listener restore. A
partial-start test documents the conservative retry: an unverified running
listener must be stopped before recovery can restart it. The production
adapter must refuse an already-running listener, and the full-node hold,
deploy fence, stopped-VM decision, real-history acceptance and resumption
remain open. No production service, VM or NATS store changed; 1.2 stays
[A]/v1.2-pre.

Checkpoint 2026-10-05 14:06 EDT: D81 makes a verified execution-hold anchor
and persistently disabled deploy-listener stop precede every other full-node
mutation and the NATS-transfer intent. The listener receipt is matched to its
own durable intent and checked for bootout, normal exit, disabled override and
absent process/network remnants. The journal suite passes 113 tests and the
hold suite 43; the restore-only loaded-daemon test passed in isolation after
one full-suite final-readiness failure, and the full suite passed on rerun
(30/30). The production full-node controller,
real macOS hold rehearsal, deploy fence, VM stop/capture and four-history
acceptance remain open. No production service, VM or NATS store changed; 1.2
stays [A]/v1.2-pre.

Checkpoint 2026-10-05 14:14 EDT: the first D81 CI run found an older root
transfer fixture still stopping NATS before the listener. Both its simulated
and native-hold paths now stage a listener stop first; the 10 root-admission
fixture tests pass locally. The native path uses owned simulated stop evidence,
so it does not prove the production process stop. CI rerun remains required;
step 1.2 stays [A]/v1.2-pre.

Checkpoint 2026-10-05 14:30 EDT: D82 closes Claude's independent root-admission
gap: root now refuses a transfer journal without a listener-first,
persistently disabled stop receipt bound to the original hold session. Owned
negative fixtures omit the listener, move it after NATS, insert a NATS intent
before listener verification, corrupt each proof field, or change the original
hold certificate. Root transfer 15, root
admission 7, root decline 22 and journal 114 tests pass locally. This remains
fixture evidence; production transfer, full-node hold, real-history restore,
capture decisions and service resumption remain open. No production service,
VM or NATS store changed; 1.2 stays [A]/v1.2-pre.

Checkpoint 2026-10-05 14:44 EDT: D83 refuses a forged listener completion
recorded before its own stop intent at both user and root boundaries. Owned
negatives retain a valid journal hash chain while reversing those rows, and
corrupt the root session, loaded-set, verified and bootout proof in turn.
The journal suite passes 115 tests, root transfer 16, root admission 7 and
root decline 22; plan lint is conformant.
Production hold, real listener stop, VM capture, four-history acceptance and
service resumption remain open. No production service, VM or NATS store
changed; 1.2 stays [A]/v1.2-pre.

Checkpoint 2026-10-05 15:52 EDT: D84 connects a persistent managed stop to
the journaled execution hold: a disposable launchd job is disabled only
after its durable `disable-and-unload` intent, and its normal exit, absent
connections/listeners and lasting override are verified before the receipt.
A forced post-disable failure leaves a durable failed row and the override
still disabled; full-node label mismatches refuse before any intent. The
owned macOS managed-stop suite passes 36 tests with one domain skip; the
adjacent journal/hold suites pass 158 tests. macOS CI now includes the owned
suite, with exact-head results pending. The native hold plus real listener
integration, enable-capable recovery for all 23 jobs, continuous exclusion,
deploy fence, stopped-VM decision, real-history acceptance and verified
resumption remain open. No production service, VM or history changed;
1.2 remains [A]/v1.2-pre.

Checkpoint 2026-10-05 16:07 EDT: D85 adds Claude's missing post-intent
readiness negative, a foreign-held-unload refusal and an actual
`StopWatch.mutate()` composition against a full-node journal with simulated
launchd. The owned macOS stop suite passes 38 tests with one domain skip;
the journal suite passes 116. macOS CI now uses a SHA-256-checked NATS 2.12.6
release artifact; exact-head CI is pending. This is fixture and source
evidence, not a native hold plus real production listener stop. The complete
writer/VM hold, four-history restore and acceptance, and verified resumption
remain open. No production service, VM or NATS store changed; 1.2 remains
[A]/v1.2-pre.

Checkpoint 2026-10-05 17:45 EDT: D86 binds the owned native launchd stop
receipt to the full-node journal listener proof predicate. The macOS owned
suite passes 38 tests with one domain skip, and plan lint is conformant.
The earlier D85 CI run had three jobs canceled before runner acquisition;
the failed jobs were rerun and all four passed on the same head, including
116 journal and 38 managed-stop tests on macOS with the pinned NATS download.
D86 exact-head CI remains pending. This adds fixture evidence, not a
production full-node hold or service resumption. No production service, VM or
NATS history changed;
1.2 remains [A]/v1.2-pre.

Checkpoint 2026-10-05 19:55 EDT: D87 refuses a scoped execution hold when
any baselined timer bypasses the staged gate command or saved pins. An owned
ungated-observer negative refuses before gate closure; 44 native-hold and 116
journal tests pass locally. D86 exact-head CI passed all four jobs. The
complete continuous writer/VM hold, stopped-VM capture, real four-history
acceptance and verified service resumption remain open. No production
service, VM or NATS history changed; 1.2 remains [A]/v1.2-pre.

Checkpoint 2026-10-05 19:57 EDT: D87's first exact-head macOS CI job
found an older root-transfer fixture with ungated timer argv. The fixture
now uses the owned gated-timer identity for its full timer cohort; all 16
root-transfer tests pass locally. The CI refusal was in test setup, before
any production action. Exact-head CI for the fixture repair remains pending.
No production service, VM or NATS history changed; 1.2 remains [A]/v1.2-pre.

Checkpoint 2026-10-05 21:51 EDT: D88 adds a three-domain launchd disabled-
override census to full-node baseline and every forward journal check. An
owned disposable listener re-enable without reload now refuses before the
next mutation; member-1 and unrelated-override negatives also refuse.
Owned macOS launchd showed that its GUI and user override views move
together. The focused preservation and owned launchd suites passed: 183
tests, one skipped; the NATS-transfer negative refuses before a durable
transfer intent. Exact-head CI remains pending for D88.
This only samples a fence. Persistent stops and restore for the remaining
jobs, detached and other launch paths, continuous watch, reboot rehearsal,
host decision controller, four cold-history acceptance and verified
resumption remain open. No production service, VM or NATS history changed;
1.2 remains [A]/v1.2-pre.

Checkpoint 2026-10-05 22:04 EDT: D88's first exact-head CI exposed a stale
root-transfer schema and fixture: the root reader refused the new override
inventory, and its owned listener-stop fixture did not simulate disabling the
override. The root reader now validates baseline and listener-stop override
evidence; all 16 root-transfer tests pass locally on macOS. The independent
Mission Control shipped-dependency audit found a new high-severity
`source-map-js` advisory; its lockfile now pins 1.2.2, and the high-severity
audit gate passes locally. Exact-head CI for these repairs is pending. No
production service, VM or NATS history changed; 1.2 remains [A]/v1.2-pre.

Checkpoint 2026-10-05 22:13 EDT: The next exact-head CI passed Mission
Control and the repaired root-transfer fixtures. The Node 20 job then failed
at the root dependency audit on a new critical `proxy-addr` advisory; Node 22
was cancelled by the matrix fail-fast. The root lockfile now pins 2.0.8.
An owned `npm ci --ignore-scripts` and the high-severity root audit pass
locally; seven moderate findings remain below the configured gate. Exact-head
CI for this lockfile repair is pending. No production service, VM or NATS
history changed; 1.2 remains [A]/v1.2-pre.

Checkpoint 2026-10-05 22:22 EDT: Exact-head CI for the lockfile repair
passed all four jobs. Claude's independent read-only review of D88 found
that the root transfer reader did not compare the listener's disabled
override proof with subsequent verified stop receipts. The root reader now
checks every later receipt; both journal and reader require a newly stopped
listener disabled in GUI and user views. Owned negatives for missing GUI or
user disable, explicit system enable, and later held-member override loss
refuse. The preservation suite passed 125 tests, root-transfer suite passed
17, and plan lint is conformant (14 pass, one longstanding warning). Exact-
head CI for this final receipt-continuity change remains pending. No
production service, VM or NATS history changed; 1.2 remains [A]/v1.2-pre.

Checkpoint 2026-10-05 22:40 EDT: Exact-head CI for d539c1a1 passed all
four jobs. Claude's second read-only adversarial review found that the root
reader's override walk started after the listener receipt, and that the
missing-GUI tests also left the user view unset. The reader now walks every
verified receipt from the baseline, rejects extra pre-listener receipts,
and binds the final override map in the NATS transfer intent. Isolated
user-only-disable negatives now protect both GUI checks. Local root-transfer
tests pass 20/20; the preservation and hold suites pass 170/170. Exact-head
CI for these final changes remains pending. No production service, VM or
NATS history changed; 1.2 remains [A]/v1.2-pre.

Checkpoint 2026-10-05 22:58 EDT: D89 adds an opt-in persistent idle-timer
stop: disable before bootout, refuse if the timer starts during disable,
and require the override to survive verification. Owned macOS controls
showed a delayed direct bootstrap refusal, re-enable and restoration,
and refusal of a lost override. The managed-launchd suite passed 41 tests
with one domain skip; plan lint is conformant (14 pass, one warning).
Exact-head CI for this change remains pending. This does not supply the
full-node journal driver, production spawn watch, enable-capable restore,
or the reboot and host gates. No production service, VM or NATS history
changed; 1.2 remains [A]/v1.2-pre.

Checkpoint 2026-10-05 23:09 EDT: Claude's read-only challenge found that a
stopped job found running at recovery could be accepted as already
restored. D90 now refuses any full-node stopped unit without a later
`recovery-verified` receipt if it has reappeared loaded or running, before
hold preparation or any restoration write. An owned restarted-NATS negative
and three listener-restart cases pass; the complete preservation suite
passes 127 tests. The separate boot-time hold decision, persistent stops
for the remaining jobs, enable-capable restore, continuous watch, and host
capture gates are still open. Exact-head CI for D89–D90 is pending. No
production service, VM or NATS history changed; 1.2 remains [A]/v1.2-pre.

Checkpoint 2026-10-05 23:28 EDT: D91 refuses a plain `unload` as a
full-node stop before applying it or recording a new intent, and both sides
of the NATS user-to-root handoff now require persistent serving-member stop
receipts. The disposable plain-unload journal and root-reader negatives pass;
focused suites pass 128 preservation, 44 hold, and 21 root-transfer tests.
This is an action-level guard, not per-class stop proof or an all-21-job
certificate. The production persistent-stop restriction and post-reboot
recovery refusal remain. Exact-head CI for D91 is pending. No production
service, VM or NATS history changed; 1.2 remains [A]/v1.2-pre.

Checkpoint 2026-10-05 23:53 EDT: Exact-head CI for D91 passed all four
jobs. Claude's read-only D89–D90 challenge then reproduced a gateway restart
after D90's preflight that recovery accepted as already restored. D92 adds a
second preflight after hold preparation and a per-unit check during recovery;
owned prepare-time and later-loop restart negatives pass, along with 130
preservation and 44 hold tests. The check is sampled, and an ambiguous
failed restore or failed idle-timer stop still needs a controlled retry
procedure. Exact-head CI for D92 is pending. No production service, VM or
NATS history changed; 1.2 remains [A]/v1.2-pre.

Checkpoint 2026-10-06 00:12 EDT: D92's exact-head CI passed all four jobs
after a failed macOS owned-service readiness wait passed on rerun. Claude's
independent D92 challenge found that an observation exception at a stopped
unit's restore turn let later units restore. D93 now aborts that loop and
requires a persistent stop's disabled override to remain set, including
while the job is unloaded. Owned negatives cover the lost override and an
unobservable gateway with a later stopped viewer; the hold-preparation
negative also checks the node receipt. The preservation and hold suites
pass 176 tests; plan lint is conformant (14 pass, one warning). The all-job
certificate, continuous watch, restart-safe adapter, disposable reboot,
host capture and four-history acceptance remain open. No production
service, VM or NATS history changed; 1.2 remains [A]/v1.2-pre.

Checkpoint 2026-10-06 00:23 EDT: D93 exact-head CI passed all four jobs.
Claude then found the two later-loop regressions lacked the hold facade's
restore hooks, so they could pass without reaching the later viewer. D94
supplies those hooks. Both pristine tests pass; removing the recovery-abort
branch in a disposable copy now fails both because the viewer is restored.
The focused suites pass 176 tests and plan lint is conformant (14 pass,
one warning). Exact-head CI for D94 remains pending. No
production service, VM or NATS history changed; 1.2 remains [A]/v1.2-pre.

Checkpoint 2026-10-06 00:27 EDT: Claude's D93 review independently
confirmed the override and unobservable-unit refusals, and identified an
enable-then-fail retry that D93 now fences while the job is unloaded. D95
retains that refusal until a journaled re-disable/retry path exists; an
intent alone cannot distinguish the journal's enable from an outside one.
The first macOS CI failure at D92 was an owned launchctl command timeout,
not a proven readiness-loop timeout. D94 exact-head CI remains pending.
No production service, VM or NATS history changed; 1.2 remains [A]/v1.2-pre.

Checkpoint 2026-10-06 00:44 EDT: D94 exact-head CI passed all four jobs on
rerun. D95 CI again failed in the isolated JetStream fixture while the
Node 20 job was cancelled by fail-fast; the test's broad phase label and
silenced child hid the cause. The fixture now labels its cluster baseline
step and surfaces only that owned child's saved error if it fails. The
unchanged fixture passed twice locally against NATS server 2.12.6 and CLI
0.3.1, with all owned servers stopped. Exact-head CI for the diagnostic
change remains pending. No production service, VM or NATS history changed;
1.2 remains [A]/v1.2-pre.

Checkpoint 2026-10-06 01:04 EDT: D96 makes both the full-node user journal
and independent root reader refuse serving NATS stop receipts lacking the
managed unload/process/connection/override proof already required for the
deploy listener. Focused preservation, root-transfer and owned launchd tests
pass (133, 88, and 41 with one domain skip). This is a source-only safeguard;
the other jobs' per-class proof, all-job hold certificate, reboot rehearsal,
host capture, isolated real-history acceptance and verified resumption remain
open. No production service, VM or NATS history changed; 1.2 remains
[A]/v1.2-pre.

Checkpoint 2026-10-06 01:15 EDT: Claude's read-only D96 review found an
untested user transfer guard and a root negative that could refuse before the
NATS predicate in a root-run environment. D97 now gives the root validator a
positive control and challenges all three serving member receipts; a hand-
appended weak `nats-2` receipt tests the user transfer guard. Focused suites
pass (134 preservation, 22 user-to-root). D96 exact-head CI passed four jobs.
The fields remain user-writable and root physical NATS/store-holder admission
is not wired; no full-node certificate, real NATS persistent-stop proof,
disposable reboot or production capture is claimed. Step 1.2 stays [A].

Checkpoint 2026-10-06 02:56 EDT: D98's owned macOS launchd control stopped
a real nats-server 2.12.6 JetStream process with the persistent `StopWatch`
path. The kernel exit status was 0, the normal NATS log marker appeared, the
job unloaded with its override still disabled, and D96's managed-stop
predicate accepted the receipt. This observes the real-server termination
shape only: no client-drain proof, journaled full-node NATS stop, all-job
certificate, root physical census, disposable reboot, production capture,
four-history acceptance or verified resumption follows from it. No live
service, VM or production NATS history changed; step 1.2 remains [A].

Checkpoint 2026-10-06 03:10 EDT: Claude's read-only D98 challenge confirmed
the owned real-server stop and exact-head four-job CI pass, but found the
specific version and exit-0 claims were not asserted. D99 pins both using
`/varz.version`, the termination field and kernel wait status. The focused
owned macOS test passes locally. Normal fixture teardown re-enables the
throwaway label; retained temporary artifacts and crash-only override
residue are documented. Full-node journal composition and physical root
admission are still unproved. No production service, VM or history changed;
step 1.2 remains [A].

Checkpoint 2026-10-06 05:09 EDT: D100 requires class-specific persistent
stop evidence for every loaded full-node job, rather than only the deploy
listener and NATS servers. The owned journal fixture exercises all 21 loaded
jobs and negative receipt shapes. This is still a user-journal shape gate,
not an all-job hold certificate or root physical observation. The production
non-listener stop and timer spawn-evidence paths remain closed, and no live
service, VM or NATS history changed; step 1.2 remains [A]/v1.2-pre.

Checkpoint 2026-10-06 05:22 EDT: Claude’s read-only D100 review at
d4e63130 found no new receipt-predicate false acceptance or refusal; all
four exact-head CI jobs passed. D101 pins four idle-receipt clauses and
records that direct journal callers can bypass the current adapter guard,
all loaded-idle classes lack a production spawn-evidence producer, and
failed rows do not retain rejected receipts. No production service, VM or
history changed; step 1.2 remains [A]/v1.2-pre.

Checkpoint 2026-10-06 09:00 EDT: D102 retains a rejected serializable
stop receipt in the durable failure row, separately from adapter failure
evidence. The full-node negative and 180 journal/hold tests pass. This
improves restoration forensics but does not certify an all-job hold or
physical absence. No production service, VM or history changed; step 1.2
remains [A]/v1.2-pre.

Checkpoint 2026-10-06 09:12 EDT: Claude's D102 review found the unverified
and unserializable candidate cases unpinned, and a diagnostic callback
could still mask the stop failure. D103 records a fixed failure stage,
retains the original failure when diagnostics raise, and verifies both
negative candidates after journal reopen. The full hold, shutdown and
four-history acceptance gates remain open; step 1.2 remains [A]/v1.2-pre.

Checkpoint 2026-10-06 15:16 EDT: D104's disposable NATS 2.12.6 fixture
refuses swapped serving masters, removed follower message blocks and a
same-length flipped payload after the isolated probe's role digest,
member-local and forced-leader checks. The baseline records a monitor-bound
physical store path for later role binding. These are mechanism controls;
the plan digest must still be derived from a trusted MATCH extraction role,
and the guest path must match that server's pre-stop monitor path. The
full-node hold, stopped-VM capture, three serving cold masters, four real
history restores, acceptance and verified resumption remain open. No live
service or VM changed; step 1.2 remains [A]/v1.2-pre.

Checkpoint 2026-10-06 15:37 EDT: Claude independently verified D104's three
mechanism refusals on owned NATS 2.12.6 servers and found no blocker in that
delta. D105 adds an unchanged leader-epoch check across each replicated stream
read and records the serving leader in the probe report. The Node 22 owned
fixture passes with all servers stopped. Provenance binding, expired-stream
treatment, full-node hold and the production stop/capture/restore/resume chain
remain open; step 1.2 remains [A]/v1.2-pre.

Checkpoint 2026-10-06 16:49 EDT: D106 binds the guest stopped-tree manifest
and host capture receipt to byte-identical four-path store specifications,
with guest scope and pre-guard timestamp checks. The disposable macOS ASIF
fixture refuses a swapped guest role path and two malformed guest claims;
the host capture suite passes eight tests. Guest-origin attestation, full-node
hold, production capture, four real-history restores, acceptance and verified
resumption remain open. No production VM or service changed; step 1.2 stays
[A]/v1.2-pre.

Checkpoint 2026-10-06 17:01 EDT: Claude found no D106 static-binding blocker
and independently reproduced the digest, scope and time refusals. D107 binds
each producer's parsed store roles to the same bytes it hashes, refuses an
observed guest-side spec rewrite, and adds a digest-only ASIF negative. Scope,
declaration and clock-order failures now have distinct diagnostics. Guest
origin, clock synchronization, full-node hold, production capture, four
real-history restores, acceptance and resumption remain open. No production
VM or service changed; step 1.2 remains [A]/v1.2-pre.

Checkpoint 2026-10-06 17:20 EDT: D108 adds a narrowly scoped launchd
compensation primitive for an unloaded job whose disabled override was
cleared during a failed restoration. An actual owned macOS job was
re-fenced after an interrupted enable: direct bootstrap refused, while
re-enable then bootstrap succeeded. The managed-launchd suite passes
43 tests with one explicit domain skip. No journal restore callback uses
this yet, so a complete full-node hold and recovery adapter remain open;
no production service, VM or NATS history changed. Step 1.2 stays
[A]/v1.2-pre.

Checkpoint 2026-10-06 21:20 EDT: D109 makes full-node journal recovery refuse
an `override-clear-intent` left without a later verified recovery, even if
launchd again reports the unit unloaded and disabled. The reopened-journal
negative refuses before hold preparation, service restoration, or state write;
the journal suite passes 138 tests. Claude identified the underlying detached
child false-accept in the proposed adapter: bare `bootout` plus re-disable is
not a stop proof. An enable-capable adapter still needs a journaled pre-enable
intent, new process-tree watch, verified compensation, and an answer for
children detached before binding. Full-node hold, stopped-VM capture, all
four real-history restores, acceptance and verified resumption remain open;
no production service, VM or NATS history changed. Step 1.2 stays [A]/v1.2-pre.

Checkpoint 2026-10-06 22:25 EDT: D110 closes a same-run gap in D109. An owned
restore callback recorded an `override-clear-intent` for the stopped gateway
and failed; recovery then restored the stopped workplan viewer before the next
run's preflight could refuse. The exception path now stops the loop when any
stopped unit has an unresolved override-clear intent. A second negative
records an intent for another stopped unit during a successful callback and
refuses the next restore. Both fail on D109 and pass with the fix; 140 focused
journal tests pass. Claude's exact-head D109 adversarial review is pending.
This does not supply the
enable-capable adapter or a detached-process census; full-node hold, capture,
four-history acceptance and verified resumption remain open. No production
VM, service or NATS store changed; step 1.2 stays [A]/v1.2-pre.

Checkpoint 2026-10-06 22:45 EDT: Claude's D109 review independently
reproduced the same-run failure, and its D110 review confirmed that the
all-stopped loop gate closes it without an unintended refusal. The review
found one untested clause: removing the exception-path immediate stop still
left the 140-test suite green. D111's added assertion makes that mutant fail
and the actual code pass. A synchronous re-fence is still terminal to this
journal because no validated re-fence receipt clears the intent; the future
adapter must supply that receipt and remain scoped to its current unit.
Exact-head macOS CI passes the 140 journal and 43 launchd tests. Root and
Mission Control CI fail after passing their tests, at dependency audits;
Node 22 is canceled by fail-fast. Full-node hold, stopped-VM capture,
four-history acceptance and verified resumption remain open. No production
VM, service or NATS history changed; step 1.2 stays [A]/v1.2-pre.

Checkpoint 2026-10-07 01:20 EDT: D112's owned macOS launchd regression shows
that an owner can spawn a detached child before binding; after bootout the
label can be unloaded and disabled while the child remains alive. The owned
suite passes 44 tests with one explicit domain skip, and plan lint passes on
the operator checkout. The test uses a successful bootstrap; it invalidates
the unloaded/disabled evidence proposed for D111's `never-spawned` receipt,
not a failed-bootstrap behavior itself. An attempted bootstrap without a bound
owner remains unproven and must keep the D109 fence closed.
An owned follow-up confirmed the disabled override appears in the user domain
as well as GUI while the detached child remains alive; the focused test passes.
The enable-capable adapter and complete hold, capture, four-history acceptance
and verified resumption are still open. No production VM, service or NATS
history changed; step 1.2 stays [A]/v1.2-pre.
