# Step 1.2 — JetStream history recovery

## 0 — Micro Re-Orient
- Block 1 preserves histories before topology/storage repair.
- Step 1.1 delivered twelve verified per-store SQLite snapshots, merged PR #143.
- This step proves both split JetStream histories recover, including offline R1.
- It serves local-first durable memory and trustworthy optional federation.
- Yes: histories must survive before competing listeners are repaired.

## 1 — Needs and current evidence
Four distinct directories/configs were inventoried 2026-09-28 08:37 EDT.
Standalone has seven streams; cluster has six, two unavailable R1 on member 1.
Installed CLI 0.3.1 and server 2.12.6 are available. Claude Message 70 supplied
independent challenge before any service stop. Actual live units all name
/opt/homebrew/bin/nats-server, unlike template differences. At 08:56 EDT the
member-1 fatal line is monitor 8222 already in use: recovery has not opened its
store on that attempt. No prior stopped copy or topology change is claimed.

## 2 — Design
Use installed official CLI snapshots with consumers; never create ordered
consumers on production for digesting. Verify raw sequence, subject, exact
server timestamp, headers and payload via read-only message-get APIs on isolated
restores. Record snapshot metadata and consumer delivered/ack/pending state.
Owned fixtures cover deleted holes, binary payload/duplicate headers, pending
acks, TTL expiry, R1 offline-member recovery and route confinement.

After fixtures: boot out failing member 1, verify no owner, copy/fsync/hash its
intact store and config privately. Persistently disable it and verify print-disabled (D6). Take reachable online
CLI snapshots. Before the other cold copies, prove idle executors/leases, all
consumer ack-pending zero, all clients/timers quiesced and connz empty; stop
members 2/3 before standalone. Copy only after verified exit/clean shutdown.
Resume standalone and verify both 4222/8222 plus JetStream ready, then members
2/3, then original client/timer set. Never resume member 1 into contested ports.

All recovered servers use working copies; immutable private masters are never
opened. Generate configs with original names/global account, sufficient limits,
fresh unique loopback client/monitor/route ports, route credentials and
no_advertise. Verify routez/leafz/gatewayz and actual listeners. Start clone 2/3,
verify COLLAB/PLANS assignments, then clone 1; preserve offline originals even
if catch-up would discard a working copy. Snapshots restore into distinct empty
servers, never an existing-history clone. Record any R3->R1 isolated override.
Compare snapshot restore to cold clone at snapshot high-water mark, accounting
for retention changes explicitly; mismatch refuses acceptance. Health TTL
expiry is expected and separately recorded, never called restored liveness.

## 3 — Risk register
- Client fallback can cross histories: resolve URLs, drain timers, stop cluster
  before standalone; no application workers on clones.
- Stop timeout can force a crash: record signal/exit/log evidence; label crash
  consistency and do not claim clean shutdown without evidence.
- Stale metadata can delete R1 copies: protected masters + assignment check.
- Snapshot state differs from later stream info: use backup metadata and compare
  isolated contents, not a count taken at another time.
- TTL/consumer inactivity/redelivery can change state: fixtures and explicit
  treatment; drained production consumers have zero pending acknowledgements.
- Copies remain on this disk: logical rollback, not machine-loss protection.

## 4 — Verification
Focused owned fixtures only locally; isolated CI retains the existing suite.
Actual snapshots restore to independent instances with matching non-expiring
message digests/sequences/holes and durable positions. All four cold copies
carry path/config/binary/hash provenance. Sanitize public proof, keep payloads
and tokens only in 0700 directories / 0600 files. Inspect deployed tools.
No topology repair, history union, requeue, source deletion or application
initialization. Parent coordinated recovery remains open.

## 5 — Runtime landing
Private tools and immutable/working backup sets under
~/.openclaw/backups/node-readiness/jetstream-20260928-<run>/, consumed by child
1.3 and topology 1.4. Both plan tick chains remain unloaded.

## 6 — File deltas
- This audit directory: official CLI wrapper, digest verifier, focused fixtures,
  operational runbook and pre/post/runtime evidence.
- Plan inventory/version/registry/decisions: current carrier and verified state.
- .github/workflows/test.yml: run isolated recovery fixtures with pinned tools.
- No production application source or NATS configuration change.

D7 implementation adds `preservation_journal.py` and its owned fault tests in
this audit directory. It is a journal primitive for the replacement driver,
not a managed shutdown command. Directory/file fsync precedes each mutation;
single-writer locking, chained records and boot identity preserve interrupted
intent. A failed durable write poisons the open handle so it cannot overwrite
uncertain intent. Recovery alone may restore prior states after a reboot or
failed verification, in dependency order, with explicit readiness evidence.
The operational driver and real service-stop checks remain in step1.2.

## Mid-Implementation Findings
The first full-node read-only baseline after bus3.11 refused because the
actual mesh-agent is loaded but idle. `daemon` required running, while
`known-broken` would waive the running-state check. D21 adds a narrow
on-demand class only for that worker and confines known-broken to Discord.
No serving bus or client was stopped for this schema correction. The direct
file hashes are structural evidence only; dependency closure and a production
restoration adapter remain required before a preservation window.
Claude's separate review found a running on-demand worker would be sent to
`restore()`; the Journal now refuses before restoration intent. A scratch
reproduction with the immutable 3.11 parser showed it can rename a later
full-node receipt as corrupt. This early description of the active-transition
trigger is superseded by D21: a manual commission rerun after a completed timer
transition can reach the old parser once a full-node receipt reads `restored`.

Claude Message46 accepts9deef65, then identifies discarded raw kernel errors
and the missing pre-watch startup-rewrite negative. Retain raw events before
classification, refuse EV_ERROR, restore that negative and supply a structural
ready-before-intent helper. Explicitly document inode/path limits. Twenty
actual Mac controls pass with one cross-domain skip; v45's missing-import
draft remains refused. Four owned NATS stops and one idle memory stop supply
historical production-size samples only. Discord is disabled with no token;
its unconditional restart loop cannot be treated as a working integration.
Claude Message40 accepts the adapter only within its limited scope and identifies
timeout, orphaned process-group, child/fork, identity/environment and idle-timer
race gaps. This next adapter checkpoint handles those stop-evidence gaps with
owned controls, without a production window. The current installed task unit
reports exit timeout5; timeouts come from actual loaded job output, not an assumed
template default. Darwin's header says NOTE_FORK does not expose the child PID
and NOTE_TRACK is unsupported; any observed fork/exec therefore refuses the
window rather than claiming complete automatic child tracking. Delivery order
is observational, not a kernel exit timestamp. Timer status/log checks cannot
prove an atomic unload; missing independent spawn evidence must refuse complete
verification. No production quiet window is authorized by this checkpoint.

Installed CLI 0.3.1 ignores `stream restore --config`: its restoreAction shadows
`cfg` inside the input-file branch (upstream cli/stream_command.go:1272), leaving
the outer override unset. The owned R3 fixture confirmed a config declaring R1
still fails with replicas>1 on a standalone server. Use the explicit `--replicas`
flag without --config; test it. No upstream fix or tool upgrade in this step.
Original health TTL remains intact; restored expired points are not liveness.
Source: https://github.com/nats-io/natscli/blob/v0.3.1/cli/stream_command.go#L1271

Claude Message 74 independently passed the pinned Linux fixture and actual
offline-driver path. Its operational blocker was the reboot race left by bootout:
D6 now requires a persistent reversible disable. The assignment deletion negative
case, deleted-list cross-check, empty-directory hashing and path decoding refine
the same preservation outcome. Production snapshot restore exposed the explicitly
listed serializer differences in RECOVERY.md; compare equivalent API queries,
never weaken policy or content checks to get a pass.

The 20:55 EDT VM reboot invalidated old owner/CID/counter baselines. Explicit
worker restoration passed a separate 65-second idle guard; selected task state
and nine non-expiring bus states match preserved older evidence. D7 binds fresh
server identity, admission counters, durable state and a reboot-resumable
journal. Owned admission checks and revised recovery fixtures pass; the real
managed orchestration and three healthy cold stores remain unaccepted. Memory
shutdown still swallows drain errors and does not itself await external worker
threads; a fresh empty external-job anchor plus conservative post-anchor log
refusal is required. Further lifecycle changes require their own bounded step.

Post-stall recheck found one worker claim-loop timeout at21:18:53 EDT, followed
by an idle reply and unchanged owners/task fields. Existing node-watch requests
exercise Ollama while the memory queue says idle; the runner was consuming
about900% CPU. This is a carry-forward resource/monitoring finding, not proven
causality or an extra repair in this step. Preserve the healthy-stop refusal
until fresh stability and safe operational sequencing are independently proved.

Claude review of35e56ff exposed management-only Raft observation and uncaught
HTTP protocol errors. Account-filtered observations and an actual stream-leader
regression correct the same quiet-window mechanism. Recovered stability covers
management/routes only; it is not all-group or preservation acceptance.

Claude Message24 found additional b38933a journal faults. D10 narrows the same
recovery mechanism: full explicit inventory, one persistent parent, redundant
baseline restoration, terminal-gap reconciliation and busy timer/serialization
controls. No operational healthy-stop claim follows. The owned launchd probe
provides actual kernel exit-status evidence only; real child/CID negative cases
and the managed driver remain required. CI's first mesh.tasks.list503 at fixture
line113 feeds a separate lifecycle readiness step, leaving this suite red until
that prerequisite is fixed and verified.

Claude Message30 independently passed the twenty cleanup-skipping creation
crash-boundary cases and ENOSPC recovery on ab7097c, then found owned regular
Finder metadata still fenced restoration inside an initializing root. D12
applies the existing metadata rule at that exact boundary; negative metadata
controls retain fencing. No healthy production bus stops or copy acceptance
follow. The installed PR149 readiness repair is now merged before integration
CI. Its broader managed driver remains to be implemented and verified.

D13 introduces the single managed stop adapter, with actual Mac ownership,
exit/CID/listener, crash, descendant and timer-race controls. The private old
sampled-window driver is retired, retaining forensic bytes. This is a driver
component, not permission to run an incomplete preservation sequence. Exact
static identity, later-child/physical ownership, admitted-client and restoration
checks remain tracked at1.2. N3 exact0b96e93 CI and Claude Message38 pass.

Exact f3bb44f CI failed before Mac test collection in the prior recovery
fixture's stream placement. Its leader-only startup gate did not prove all
three placement peers/current routes. Add explicit full readiness plus an
actual missing-peer refusal; preserve the failed attempts. This remains owned
recovery-fixture verification, with no production source/configuration change.

Claude Message44 accepts8286c96 controls/exact green CI, then identifies
producer tick gaps,5second stop-margin measurements and Discord stop-path
prerequisites for the future driver. Those remain open; no production hold
starts. The present delta binds loaded plist/log provenance and moves expensive
re-binding before intent with kernel file watches. It also completes all eight
placement predicate negatives. Source/library controls remain in active1.2.

Claude Message48 accepts19243eb, but points out exception detail is still only
in memory and non-vnode filters are classified by exclusion. D18 writes the
StopWatch snapshot into post-intent failed journal records and explicitly
requires KQ_FILTER_PROC. Pre-intent preparation still needs private durable
driver refusal records. Owned real-filter/durable-reopen controls cover this
correction; no production preservation or controller completeness is claimed.

Claude Message54's fresh owned reproduction exposes journal hash poisoning
when numeric PID sorting differs from string sorting after reload. D19 rejects
non-string dictionary keys before hashing and makes StopWatch exports string
keys. Successful and failed evidence both need mixed-width reopen/resolve
controls. Do not alter old forensic bytes or claim the new tests prove a
complete production controller. Raw kernel trace growth still needs a finite
driver budget before operational use.

### Foundation dependency checkpoint — 2026-09-29 07:12:37 EDT

Consume accepted bus3.1–3.4 by integrating main51a817f. Recast this still-open
PR as the bounded recovery-tool foundation specified in D20 and
FOUNDATION_CHECKPOINT.md. Code/test bytes remain5fabf6e; only plan/evidence
clarifications accompany integration. Fresh private Journal58/58 passes;
exact integration CI/read-only re-review remain required before merge. Do
not close1.2 or introduce production imports, controller, holds or timer wiring.

### B5 owned journal-mount source slice — 2026-10-17 00:44 EDT

The active slice feeds B5-stopped-ASIF checkpoint extraction: wrap the D191
reader in an owned-fixture-only read-only ASIF mount and publish a receipt
of exactly the inputs it read. It does not enable production capture or
close B5. D168/D173/D174/D175 and the four separate histories remain binding.

Needs: published checkpoint/commitment/reader source at 5b6c84af, a completed
owned capture, caller-supplied role table and no active capture worker. File
deltas: host_journal_mount.py, probe_asif_mount_ownership.py,
test_host_journal_mount.py, reader read-metadata output and its tests, both
scripted CI paths, and the plan/evidence ledgers. The probe stays unwired;
native mount facts and the protected B3/acceptance roots are separate gates.

Verify: scripted mount suite passes, every new boundary has a decisive
negative, designated unmutated controls pass, one-rule mutations fail for
their intended reason, Claude challenges the final bytes, then exact-head
CI passes. Native ASIF ownership/flags/ctime behavior must be observed on
an isolated CI runner before claiming mounted-image verification. These
scripted checks never mount a volume or touch a VM. Source publication
does not satisfy the disposable-macOS reboot rehearsal.

Current local evidence: 60 scripted macOS tests OK (one Linux platform-guard
skip), 30 reader tests OK, 119 wrapper/probe mutations killed with no runner
problems. The updated 46 reader mutations are all killed for their intended reason
with unmutated controls passing and no runner problems. The previous
published head has all five checks green in CI run 38930108319; that says
nothing about this uncommitted delta.

Mid-implementation finding: the probe's cleanup repeats eject by disk
number without re-binding it to its own image, unlike the wrapper's
cleanup. A timed-out applied eject can release that number for another
image. Claude is reviewing this and the probe's partial-attach, interrupt
and recursive-removal boundaries before source publication or any native
probe execution. No production VM, service, image or timer changed.

The scripted counterexample is reproduced locally: the first eject times
out after releasing the probe image, the simulated disk number is reused,
and the probe issues one foreign eject and reports clean. All command and
inventory functions were mocked; no disk command ran. Claude confirmed
the retry defect and additional partial-attach, unreadable-inventory,
interrupt/report and recursive-removal defects. The previously passing
119 mutations do not cover these cases. Corrected source plus decisive
tests is required before the CI-only probe can be published or executed.


2026-10-17 01:10 EDT — D192 source candidate: the acf2e671 patch was
checksum-verified (93548a7d…63356) and applied. A new direct counterexample
then reproduced foreign eject on a second cleanup with a stale attach disk
list. Codex removed remembered-number eject authority from wrapper and probe;
missing/unreadable inventory now keeps cleanup uncertain. Final local checks:
71 scripted tests OK (one Linux-only skip), 30 reader tests OK, 46 reader
mutations and 3 focused eject-rule mutations killed with controls passing.
No native mount/probe/VM action occurred. Broader candidate probe mutations
are not claimed as final validation. Final Claude review and exact-head CI
are pending; B5-owned-journal-mount source is not yet ready. The next gate
is native owned ASIF characterization on an isolated CI runner; B5-macOS-
access and the separate reboot rehearsal remain open, and B6 stays closed.


2026-10-17 02:51 EDT — B5-exact-head-CI diagnostic, D193. Exact b694b342
has four green CI jobs and the recurring macOS owned-kickstart failure
(39005360286/117316604376); its new reader30/mount71 tests pass. Claude
Message85 reports no material defect on that head. The ten-second timeout
still leaves recovery partial, gate closed and receipt unresolved.

Goal: distinguish the owned launchctl client's post-timeout state from
service state, without changing any recovery rule. Needs: exact owned argv
and temporary root, original D180 behavior and no production hook. Feeds:
B5-exact-head-CI diagnosis/source readiness, then B5-native-ASIF-mount.
Verify: six subprocess controls and three decisive mutations pass, a native
owned restoration emits the exact-client trace, and the revised head receives
Claude review and CI. The native control succeeded with a 9.008 s request;
this is not a cause attribution for CI. Only a test helper, its tests, the
existing owned test and scripted CI registration change. Action10s, post-
timeout observation1s and parent20s limits are unchanged; no fixture throttle
override or runtime code changes. All production state stays unchanged.

The next two gates remain reviewed exact-head source CI (owned resources
only, B1 authorization) and then native ASIF characterization on an isolated
CI-created image after source readiness. Disposable macOS reboot access is
still separate; B3/B4 were not recaptured, B6–B9 stay closed and the node
is not accepted as operational.

2026-10-17 04:45 EDT — B5-native-ASIF-mount preflight. Exact source
151bb3bdbcdf0bd09c7d15e6f0679832edae6a3d has all five checks green in
39011578564; Claude Message89 finds no material defect, following Message85's
review of the unchanged mount/probe source. The native owned kickstart trace
completed at exit 0 in 9.026776584 s against the original 10 s limit. This
does not explain the earlier timeouts. The current JSON-only caller cannot
reach Claude's hypothetical non-serializable diagnostic context; record that
limit without broadening this change into diagnostic hardening.

The independently executable next gate is native ASIF mount characterization.
Needs: the reviewed probe and cleanup, a separate GitHub-hosted macOS runner,
all existing CI-only guards, and a fresh 64 MiB image created by the probe.
File deltas: add one isolated job and unconditional report upload to
.github/workflows/test.yml; correct the probe's now-obsolete unwired docstring;
record D194 and the verified source milestone in the plan ledgers. No mount,
capture or recovery implementation changes. Verify: inspect the uploaded
report's actual ownership, root-0600 denial, flags, identities/ctime/xattrs
and cleanup, not merely job exit 0; any failed assumption stays a refusal.
Claude review and exact-head CI remain required for this workflow revision.
No local disk image or VM operation is part of this gate. After it, the owned
stopped-ASIF reader integration needs reviewed wiring and a native fixture;
D62 reboot rehearsal still needs separately designated macOS access.


## Native characterization re-orient — 2026-10-17 04:51 EDT
- Still step1.2/B5, never a production stop or capture.
- D194 executed the existing owned probe on a separate CI runner; setup refused.
- Two native findings: owner enforcement exposes root-owned fixture root; attach IDs differ in spelling.
- Correct only probe preparation/evidence retention and test those real boundaries.
- File deltas add probe/tests plus raw report, hashed evidence and append-only ledgers; wrapper unchanged.
- Same native verification outcome; no gate widening to D62/production or timer changes.


2026-10-17 04:51 EDT — B5-native-ASIF-mount first actual report, D195:
6ae7dd58 run39018637637/job117355795880 failed exit1 during write setup,
PermissionError13 after ownership enable; no readonly variant ran. Retained
artifact12096210442 is copied unchanged as B5_NATIVE_ASIF_FIRST_REPORT_20261017.json.
Inventory-bound unmount/eject succeeded and final inventory0/mounted[]/removed
are recorded, but bare disk7 was not harvested, so disks_gone[] is vacuous.
The root-owned volume-root permission explanation is an inference pending
native rerun, not a traceback-proven cause. Actual attach entries are bare
IDs; inventory and DeviceNode use /dev paths. The wrapper still refuses that
spelling and is unchanged.

Codex-owned correction within this same native characterization gate: make
only the newly created probe volume root runner-owned after enableOwnership
(the root0600 file remains root-owned), strictly canonicalize attach IDs for
absence checks and Data observation, and retain partial variant evidence on
failure. No eject fallback is restored. The wrapper's checks are not relaxed.
75 scripted tests pass (one platform skip); four intended-reason mutants are
killed and nine focused controls pass. B5_NATIVE_ASIF_SETUP_20261017.json
records report/source/log hashes. New native CI and Claude review are pending;
this corrects the source fixture rather than retrying unchanged code. Next
native observations then owned reader integration remain held until their
actual verification. B5/1.2 open, B6–B9 closed; no local mount or VM action.


2026-10-17 04:56 EDT — D196, B5-native-ASIF-mount runtime observations:
6f7e9371 run39018959320/job117356737655 completed the corrected probe at
exit0. Artifact12096186192 is retained unchanged as
B5_NATIVE_ASIF_COMPLETE_REPORT_20261017.json (SHA2567097f7d9…2e09f4);
B5_NATIVE_ASIF_OBSERVATIONS_20261017.json records the interpretation.
On one isolated macOS26.6.2 arm64 runner, both exact-option variants set
readonly/nodev/nosuid/noexec and honored owners, including after the probe
explicitly disabled ownership before reattach. Root0:0 mode0600 stayed
unreadable to uid501; its own0600 file was readable. Plain readonly was
correctly refused for absent noexec. Image bytes/inode/size/mtime/ctime/flags
and empty xattr-name lists were identical before/after each readonly cycle.
The intervening write/disable phases are not covered by that equality.
Each phase independently confirmed its remembered disk gone, inventory0
and no mount; final cleanup removed the directory. These are sequential
observations, not physical exclusion or real-history acceptance.

B5-native-device-binding is a new Codex-owned source blocker: actual attach
IDs are bare while hdiutil/DeviceNode are /dev paths. The unchanged wrapper
refuses attach equality before mount; replay of the native rows with all
commands mocked also returns bare disk8s1 from data_volume and refuses
verify_mount with 'private mount point holds another device'. The probe's
canonical call is accepted, not the complete wrapper. Exact unblock: reviewed
strict canonical whole-disk/Data identity binding with decisive mismatch and
cleanup controls, then native owned reader integration. No check is relaxed
here. Native facts are observed; the gate stays open for review/current-head
CI and this binding correction. The next two gates are that owned source
correction and integrated stopped-ASIF reader verification; both use only
owned resources and require Claude plus exact-head green CI. D62 reboot
rehearsal still requires separately designated macOS access. B3/B4 were not
repeated; B5/1.2 open, B6–B9 closed, production capture disabled, node not
operationally accepted. No local VM, service, image or timer changed.

## B5-native-device-binding preflight — 2026-10-17 06:45 EDT
- Still1.2/B5; B1 permits source and owned tests, B6–B9 remain closed.
- Exact611127b9 is green in all6 jobs39019163444; Claude Message96 finds no material defect.
- D196 native rows expose two deterministic spelling refusals in the wrapper.
- Correct strict device identity binding, requiring a harvestable whole disk after successful attach.
- Reuse that binding in the existing probe; restore its seeded root to0:0/0755 for the native positive.
- Owned scripted/native evidence plus Claude/exact-head CI; no production action or B3/B4 recapture.

File deltas: host_journal_mount.py shares strict raw/canonical device parsing
with the existing probe; bind attach whole disk to canonical inventory and
Data DeviceNode to its exact raw partition, preserve raw receipt fields and
mandatory cleanup absence checks. probe_asif_mount_ownership.py consumes those
helpers and refuses a successful unharvestable attach (Claude F1); after
seeding restore only its newly-created volume root to root ownership and
record root uid/gid/mode per variant (F2). Extend the existing scripted suite
with actual committed native rows, successful bare-ID read, mismatches,
malformed/unharvestable entries and root seeding order. Mutation controls
must kill removal of each binding/mandatory-observation rule. Record source,
review/CI and runtime limits in the ledgers/evidence; VERSION stays-pre.
This is the one named B5-native-device-binding gate, feeding the separate
native stopped-ASIF reader integration, never production acceptance.

Claude F3's error-filename/timestamp reporting suggestions remain follow-ups;
no diagnostic expansion here. The new committed native-row replay tests
replace D196's previously uncommitted replay claim with reviewable evidence.
Read-write native phases changed the image's hash/times (write phase also
size); that observation reinforces read-only attach plus post-read hashing,
without generalizing a cause beyond this owned runner.


2026-10-17 06:48 EDT — D197, B5-native-device-binding source candidate.
Exact611127b9 has all6 CI jobs green (39019163444); Claude Message96
reports no material defect and confirms D196's native observations. Shared
strict parsing now accepts bare/canonical attach spellings, requires a valid
whole-disk observation after successful attach, binds it to the canonical
image inventory, and binds Data DeviceNode to the exact raw partition.
Remembered disks remain absence checks only. Raw attach/inventory fields
are retained. The existing CI-only probe consumes those same helpers and
restores its fresh seeded volume root to0:0, recording per-variant root
metadata; the root0600 negative stays intact.
80 scripted tests OK (one native platform skip); after one final root-owner
assertion tightening,18 focused controls pass and7 intended-assertion mutants
are killed. The runner is committed, and actual native-row replay is now a
committed test. B5_NATIVE_DEVICE_BINDING_SOURCE_20261017.json records hashes
and the precise test sequence. New native CI and Claude review remain pending;
no source-readiness claim. Next two gates: this source's exact-head review/CI
and root-owned-root native report, then integrated owned stopped-ASIF reader
verification. Both are B1-owned-test work; D62 macOS reboot access remains
separate. B3/B4 were not repeated, B5/1.2 open, B6–B9 closed, D64 unchanged;
all production services/VM/timers and four histories untouched.


2026-10-17 06:51 EDT — D198: native shared device binding observed at
b1119e78 in39026337387/job117377947876 (artifact12097953565), exit0.
B5_NATIVE_DEVICE_BINDING_REPORT_20261017.json retains raw bytes with SHA256
efbd1656…1ae4cd6; the RUNTIME JSON records the interpretation. The seeded
volume root is0:0/0755 after preparation and in all3 variants. Both exact-
option variants honor owners, deny root0600 reads, preserve every recorded
image identity field across their readonly cycle and confirm per-phase
known-disk absence/cleanup. Plain readonly still refuses absent noexec.
The shared whole/Data binding helpers ran natively; the complete wrapper's
locked reader/capture flow did not. Guest uid parity, never-registered UUIDs,
sibling/dirty guest volumes and pre-existing xattrs remain unproved.
All-six exact-head CI and Claude review are pending; B5-native-device-binding
stays open. Next that review/CI gate, then native owned stopped-ASIF journal
reader integration, both within B1's owned-test authorization. D62 rehearsal
access stays operator-owned and separate. B3/B4 were not repeated; B5/1.2
open, B6–B9 closed, D64 unchanged and production untouched.

## B5-kickstart-cause-probe preflight — 2026-10-17 08:45 EDT
- Still1.2/B5; source6912b7e7 is5green/1red, not ready.
- Claude Message100 finds no material defect; native80 controls pass in CI.
- New trace samples the owned launchctl client alive after10.004358542s.
- Advance one diagnostic gate: bounded seven-arm timing on separate CI-owned labels.
- No runtime deadline, fixture throttle, acceptance rule, production service or VM changes.
- Report interprets observed spawn/client timing; it cannot prove the prior failure's cause alone.

Needs: exact red CI39026495833/job117378396060; prior source-only observer;
Claude's immutable7d3e90a4 artifact, independently read and SHA256-verified
77838cc9b9fcbb33c5f83776695223ee0d2a6c8f62c9251495ca9c4967871b64.
That artifact is a design input, not yet executable readiness. Correct its
owned-client interrupt cleanup, stale-PID signal use, ignored cleanup/domain
observation failures and removal-before-proven-cleanup before native wiring.
Keep primary errors and partial trial evidence; missing/nonzero reports hold.
File deltas: one owned-only probe derived from that candidate, its pure/mock
controls, isolated macOS CI job with always-upload, and plan/evidence ledgers.
Verify: original guard refusals, completed/alive/pipe-held measurement controls,
client interruption/cleanup controls and unknown job-observation refusals;
CI report for seven fresh labels with actual first/second job times, ten-second
post-timeout client observation, later return bound and verified bootout.
Any cause inference is bounded to one runner and differentiated trials.
Claude reviews material bytes; full exact-head CI remains required for source
readiness. The original recovery10s/1s/20s limits remain unchanged.

Carry-forwards from Message100: T1 root-uid ambiguity in the probe seeding
scripted test and T2 missing wrapper applied-failure harvest-order assertion
remain tracked owned-test work; neither is silently fixed in this diagnostic
slice. The native integration gate stays held by exact-head CI. B3/B4 remain
unrecaptured; B5/1.2 open, B6–B9 closed, D64 unchanged, four histories separate.


2026-10-17 08:55 EDT — D199, B5-kickstart-cause-probe. Exact6912b7e7
has5green/1red in39026495833; mount80 tests pass, while the owned stopped
job kickstart times out again. The new client trace has poll=None after
10.004358542s (bootstrap age.285780875s, stop wait.009570166s). This narrows
the current failure to a still-alive sampled client, not a cause attribution.
Recovery remains partial, gate closed and receipt unresolved. Claude
Message100 finds no material defect in the binding revision; source readiness
is held by red CI.
A checksum-verified Claude7d3e90a4 experiment is adapted as one CI-only probe:
seven fresh jobs vary runtime/throttle, record first/second job times, sample
the launchctl client after10s and measure a bounded later return. Before
wiring, Codex corrected client/target cleanup, stale-PID signals, unreadable
observations, premature file removal and lost partial reports.19 pure/mock
controls pass; the real classifier's3 shapes pass on the final local candidate and rerun in the dedicated CI job. Missing/nonzero/native
partial reports cannot clear this gate; this is not a fixture/runtime fix.
Next timing report, then an evidence-backed owned fixture/runtime remedy
with Claude review and exact-head green CI before native reader integration.
Both are B1-owned work; no production service/VM or timer change. B3/B4 were
not repeated, B5/1.2 open, B6–B9 closed, D64 unchanged, four histories separate.


2026-10-17 09:04 EDT — D200, B5-kickstart-cause-probe runtime report.
1695ce92 job117402189372/run39034737877 exited0; artifact12101407361 and
raw SHA2560659ef76…f6bc3f4 are retained. All7 trial bootouts and individual
post-bootout checks passed; final target/domain observations show all7 absent,
no probe labels left, directory removed. Default short-runtime client stayed
alive after10.007s and returned success at10.016s. DefaultR3/R12 requests took
7.017s/.006s; delayed-request1s short-default took9.011s; explicitThrottle1
short/R3 took1.016s/.010s;Throttle0 short took1.007s. This supports a throttle-
and prior-runtime-related wait and reproduces the failure shape on this
runner, not an exact undocumented timing rule or proof of the earlier CI
cause. The runner was not idle: recorded load averages were24–43. Python
instruction timestamps, observed exits and the changed signal path limit
transfer. No runtime or fixture policy has been changed.
Claude's final source/evidence review and full exact-head CI remain pending.
Next a reviewed owned-fixture remedy justified by these observations, then
exact-head CI before native stopped-ASIF reader integration. Both are B1
source/owned work; D62/macOS access stays separate. B3/B4 not repeated,
B5/1.2 open, B6–B9 closed, D64 unchanged, production untouched.


2026-10-17 09:11 EDT — D201, B5-kickstart-cause-probe review and second CI report.
Claude Message104 finds no material source defect at1695ce92 and independently
passes19 controls plus3 real client classifiers. Runtime and old fixture bytes
are unchanged. The review identifies measurement extensions before interpreting
future anomalous/incomplete runs: second-start deadline anchoring, continuing
other arms after a measured anomaly with verified cleanup, instruction-origin
predictions/residual controls, and bounded logs on failure covering the run.
These do not invalidate the7 completed D200 arms; no exact timer rule or
historical full-suite cause is claimed. Codex corrected the review's prose:
this implementation removes private files only after completed+clean and then
writes the report. Lost reports cannot pass. Evidence interpretation review
of7a8dcb64 is pending in Claude Message105; no fixture remedy is applied.

The normal current-head CI39035129935, job117403289389, independently completed
the unchanged7-arm probe at7a8dcb64 (mergefd9d06db). Artifact12102275128 is
retained as B5_KICKSTART_TIMING_REPORT_REPEAT_20261017.json, SHA256
e25d03de25d904e482f3e238ce4d16b11a24b5a1749872b5494860a400d3bccb.
Default short/R3/R12/delayed-short client blocks are10.031/7.018/.008/9.017s;
Throttle1 short/R3 are1.059/.007s;Throttle0 short is1.019s. The default-short
client was alive at the post-timeout10.0036s sample and returned0 later.
All7 trial bootouts and absence checks, final individual absences/readable
GUI-domain/no-label checks and directory removal passed. Two separate CI
reports support the bounded timing association; they are not a distribution,
exact origin proof or production test. Full all-job CI remains pending, so
source readiness and B5-native-device-binding closure remain held.
Next gates: a reviewed owned-fixture-only remedy with unchanged runtime limits,
then native owned stopped-ASIF reader integration. Both need Claude and exact-
head green CI under B1. D62 disposable-macOS access remains a separate operator
decision. B3/B4 were not repeated; B5/1.2 open, B6–B9 closed, D64 unchanged,
production capture disabled and four physical histories separate. No live
service, VM, production image or timer was changed.


### 2026-10-17 10:46 EDT — B5-owned-kickstart-fixture preflight (D202)

1.2 remains active; prior D201 has two complete timing reports but exact0d329038 CI is6green/1red.
Claude106 accepts the observations and requires a matching owned adapter policy change.
This slice changes only the temporary daemon throttle and its strict admission/tests.
The north-star recovery contract still requires fail-closed durable restoration evidence.
Needs above exist; B1 authorizes these owned tests, no live operation.
Next remains this bounded fixture correction; native reader and D62 are downstream.

File deltas: restore_only.py owned expected configuration; test_restore_only.py temporary daemon settings/trace assertion; test_kickstart_applied_timeout.py simulated settings and portable real-file configuration controls; mutate_owned_fixture_policy.py intended guard-removal verification; source-evidence JSON plus plan decision/inventory/frontier/registry/audit updates. No managed_launchd.py, journal, service_gate.py, timer or production file changes.
Verification: portable controls/guard mutant and existing timeout regressions locally; CI-only native stopped-daemon recovery with trace; Claude review and exact-head full CI before source readiness. Remaining default-policy and measurement extensions stay tracked.

D202 verification refinement: add a separate15-minute owned-kickstart-fixture-macos CI job for the existing timeout controls, intended guard mutant and two focused native cases. Full legacy/all-job CI remains mandatory; this gives earlier native feedback and does not replace it or rerun an unchanged failed artifact. Workflow is an additional planned verification delta.


D202 source checkpoint: the owned mesh-agent plist and adapter now require
integer ThrottleInterval1; the timer remains unchanged and refuses that
extra field. Both native and simulated fixture producers match. Portable
real-file policy controls pass (including missing/0/2/bool throttle and extra
fields), and a removed-equality mutant dies at the intended assertion.
5 timeout controls and11 applied-timeout/readiness/policy tests pass locally;
the durable partial/closed/unresolved outcome and retry without another
kickstart remain asserted. Managed launchd/journal/gate/trace/probe bytes are
unchanged from0d329038. Python syntax and plan conformance pass. The new
15-minute focused macOS job exercises the two native cases with explicit
trace output before the existing long all-job gate can finish. No native
host test was run here. B5_OWNED_KICKSTART_FIXTURE_SOURCE_20261017.json records
hashes, baseline failure and proof limits. Candidate Claude review and exact-
head all-job CI remain pending; no source-readiness claim. Next native owned
stopped-ASIF journal reader integration, then D62/D175 admission/resumption
source under B1; actual macOS reboot still needs separate disposable access.
B3/B4 not repeated, B5/1.2 open, B6–B9 closed, capture disabled, production
untouched and all four histories separate.


### Mid-Implementation Findings — 2026-10-17 10:59 EDT, Claude108

No material regression on exact1e915d8a. All changed-source and preserved-runtime hashes were independently checked. Linux11/5/6/19 applied-timeout/launchd/trace/timing controls pass, managed-launchd61 with40 platform skips and restore-only31 with29 skips; guard-removal/type/expected-value mutants are killed. T3: Linux's documented anchor identity seam bypasses its exact plist policy, so two anchor mutants survive there; native timer-negative and native simulated anchor restore exercise those checks. T3 is tracked separately rather than expanded into this daemon remedy. Existing RunAtLoad/KeepAlive bool/int dictionary equivalence is unchanged and not fixed here.

Focused native job117424417161 succeeds on PR-head1e915d8a/mergec013dd3d, with explicitThrottle1 and a completed0.004771s client under timeout10, resolved/open recovery and restored receipt; changed timer is refused before launchd. B5_OWNED_KICKSTART_FIXTURE_NATIVE_20261017.json retains the narrow result and its inherited-teardown/no-independent-process-absence limit. All-job CI remains the final source gate.


2026-10-17 11:17 EDT — D203, owned restoration fixture source verified at1e915d8a.
All8 exact-head jobs pass in39042421331; Claude Message108 finds no material
regression and independently verifies preserved runtime hashes, portable
controls, refusal-before-launchd and guard mutants. Focused native job
117424417161 passes2 tests; full macOS job117424417172 passes the31-test
restore-only module in104.459s and completes the remaining job. The focused/
full stopped-daemon traces show explicit integerThrottle1, client rc0 and
completed in.004771/.006608s under timeout10; both recover resolved/open with
receipt restored. The timer-only policy negative passes, and the applied-
timeout controls still preserve partial/closed/unresolved plus a fresh retry
without another kickstart. The full run has no failed check. This source-only
milestone is at the named verified head; this receipt changes no executable
or workflow. Later heads still require their own checks.

The retained native JSON binds source/merge/run/jobs and filtered observations,
not an independent teardown/process-absence proof. It does not prove production
default-throttle recovery, D62 reboot safety, physical writer exclusion or real
history acceptance. B5-default-kickstart-policy remains open. T3 portable
anchor-policy coverage is a separate nonblocking carry-forward; T1/T2 and
future anomalous-probe measurement extensions are not expanded here.
Shared device-binding sources/probe and the differentiated timing probe are
unchanged from their reviewed/native-observed revisions; this green exact-
head run clears their outstanding CI hold without repeating their artifacts.

Next B5-owned-stopped-ASIF-reader uses B1-owned CI storage, a valid synthetic
checkpoint/commitment/CAPTURE fixture, the complete locked reader/mount wrapper
and frozen verifier, decisive corrupt/pending/unknown-entry refusals, unchanged
image identity, cleanup evidence, Claude review and exact-head green CI. Then
D62/D175 restore-only admission/resumption needs durable host ACCEPTED-or-ABORT
binding, scoped launchd/process comparison before Journal.recover, fail-closed
manual fallback and conditional value-only timer migration tested on owned
APFS reattach. Actual reboot/launchd/login/hold-reattach still requires a
separately designated disposable macOS machine or approved measured disk/RAM
budget/capacity source. No local UTM VM was provisioned or operated; only the owned CI checks ran.
B3/B4 were not repeated; B5/1.2 remain open, B6–B9 closed, D64 unchanged,
production capture disabled and all four histories separate. No live service,
VM, production image or installed timer was changed.


## B5-owned-stopped-ASIF-reader preflight — 2026-10-17 12:55 EDT

Micro re-orient: Block1/step1.2 remains v1.2-pre; production preservation is closed.
D203 verified the owned kickstart fixture; current68d45483 has all8 checks green.
This slice supplies the missing complete native frozen-journal read on CI-owned ASIF.
It feeds B5 byte binding, then D62/D175 admission/manual restoration; never B8 history acceptance.
The checkpoint, pin publication, bounded reader, wrapper and private fixture all exist.
This remains the next independently executable gate; no production operation is authorized.

Needs checked against current source: StoppedImage builds the real Journal/capture_ready,
commit/commit_checkpoint and pinned CAPTURE records with synthetic hold/VM observations;
read_journal_inputs holds both real host locks and calls locked_read/verify_stopped_journal/
verify_frozen_checkpoint. The native probe already owns its ASIF, mount options and
inventory-bound cleanup. No BLOCKED.md; tree clean before this preflight.

### File deltas / verification

Extend probe_asif_mount_ownership.py with a separately guarded CI-only reader mode, reusing
its native attach/release and the existing synthetic journal fixture. Bind the real fresh
volume UUID before the manifest commitment, seed the owned tree while writable, restore
root ownership, detach, then publish the fixture clone hash/size and read through the
unmodified complete wrapper. Test intact, corrupt chain, pending, unknown entry and changed
config bytes; each case retains before/after image metadata, receipt or exact primary refusal
and nonvacuous known-disk cleanup. Native disk commands run only on an isolated CI runner.
Portable controls in test_host_journal_mount.py cover fixture seeding, refusal oracle and
reader-mode guards/dispatch; workflow retains the complete native report even on refusal.
No runtime source, production plist, action budget, T1/T2/T3 or default-policy change.

WIN: portable decisive controls pass; Claude adversarial review; native positive reaches
the frozen verifier with matching host pins, every named negative refuses for its intended
reason, every readonly cycle leaves image identity/bytes unchanged and disks absent, final
owned directory removed; current exact-head CI all green. Native report is synthetic
quiescence/mechanism evidence, not a VM capture, guest UID parity, physical writer proof or
real-history acceptance. D64/production capture stay closed; B3/B4 are not repeated.

### D204 mid-implementation finding — portable guard dispatch seam

The new main-dispatch control must pass darwin explicitly to the real guard in its test
seam: changing sys.platform cannot alter the import-bound function default. Corrected the
control and passed it with the real default forced to linux. This is the same reader
integration verification slice; no native/probe/runtime guard relaxed.

### D204 review verification extension

Claude's reader_run assertion coverage gap is in this slice's verification contract.
Add ReaderRun controls in the existing test module;15 selected cases pass with one platform
skip, and image/pin/head removed-guard mutants die at the intended0!=1 assertion. Retain
the raw native report named in D204 (54 reads, four intended negatives,5 stable readonly
cycles and known-disk cleanups, final directory removed). Runtime/probe source unchanged.
Completed Claude verdict and current-head all-green CI still required before closure.

### D204 review corrections and final verification outline

Consume Claude114 R1 with ReaderRun negative/partial/cleanup controls; R2 keeps failed
owned-reader images until diagnosis. Add mutate_stopped_asif_reader.py as a verification
helper (4 intended guard kills) and run it in the existing isolated ASIF CI job. The
workflow uploads a failed owned image; success still removes its own directory. Older
ownership-run behavior and all production/runtime sources stay unchanged. Local91 tests
pass (one platform skip), the6-control mutation baseline passes and all4 mutants die at
their intended assertions. Native corrected-source and exact-head CI/review still pending.


### 2026-10-17 14:01 EDT — B5-owned-stopped-ASIF-reader verified (D205)

Verified source e120e78d / exact CI39053730664: all8 checks green; Claude116
closes R1/R2 with no material defect. Native job117457344212 verifies54 intact file reads,
4 intended read-stage refusals,5 stable readonly image intervals and nonvacuous seed/read
disk absence, with final directory removed. The reviewed raw report is retained under
step12_jetstream; its SHA256 starts e02ab656. All91 controls and4 intended guard mutants
pass. Failed native upload itself was not exercised; scripted retention/interrupt controls
are explicit. Synthetic fixture evidence only: no VM capture, guest UID parity, physical
pre-stop exclusion or B8 acceptance.
Next B5-D62-admission needs reviewed host-decision/scoped-observation/manual-fallback
source and owned tests; B5-D175-owned-repin then needs that admission and strict5-timer
value-only migration with owned APFS reattach negatives. Both need Claude/exact-head CI.
Actual reboot rehearsal still needs separate operator-designated disposable macOS access
or a measured fixed resource decision. B3/B4 not repeated; B5/1.2 open, B6–B9 closed,
D64 and production capture refusal unchanged. No production operation occurred.

D205 post-verification ledger: promised complete locked reader/frozen verifier — yes;
intact and4 intended refusals — yes; unchanged readonly image metadata/hash and known-disk
cleanup — yes; R1 outer/partial/interrupt controls and R2 retention — yes, native upload
not exercised; Claude and exact source CI — yes. Feeds: native integration prerequisite
for D62/D175 source/owned work; not B8 histories. Carry-forwards: T1/T2/T3, default-throttle
policy and all production/reboot/host-provenance requirements remain tracked and open.


## 2026-10-17 17:13 EDT — terminal ABORT micro re-orient and bounded delta

- Block1/step1.2 remains active at v1.2-pre; production preservation is held.
- D209 verified nonterminal clone cleanup under sampled source denial, final1f7dc5b7 CI green8/8.
- This slice binds a terminal owned ABORT to that cleanup and strictly verifies it.
- It feeds a separately checked source release, then guest admission/manual restoration.
- No flag change, guest gate, production operation, ACCEPTED producer or D64 relaxation.
- Yes: D62 requires a durable decision before future release; file presence is insufficient.

Claude148's six design corrections govern: native preflight write-set allow-list, exactly
one root ABORT exception in conflict checks, forward-bound cleanup sample bytes, caller-held
locks and a caller-supplied fresh observation for the read-only verifier, exported exact
key sets and canonical bytes. A completed fixed decision subtree is also required after
post-publication checks; a visible ABORT without COMPLETE or beside FAILED/temp refuses.
A metadata touch to the guarded source or a host reboot/device change makes the attempt
manual; no exception is added. Same-user coordinated rewrites remain D189's limit.
§6 deltas for this slice: host_clone_dispose.py, preflight file-name constant only,
test_host_terminal_abort.py, mutate_host_terminal_abort.py, workflow registration and
four plan ledgers. Tests use existing real checkpoint/cleanup producers with scripted
host/flags; no local disk image, launchd, UTM or production operation is permitted.


### D210 mid-implementation findings and re-orient — 2026-10-17 17:30 EDT

The caller-lock cardinality counterexample and native log-mode assumption are two
required corrections to the same terminal-decision input contract. Re-oriented at the
consumer boundary: neither introduces source release, a new controller or guest recovery.
The verifier must refuse incomplete lock lists; the strict reader must ingest its actual
producer's files. The preflight writer change and native assertion are the named
B5-terminal-native-stdio prerequisite within this source slice, not a production rollout.
§6 delta correction: preflight now also pre-creates its two logs exclusively0600;
test_host_vm_preflight_status.py models append-open and collisions, and the existing
CI-only native HostCaptureTest checks sample_files against two real sample trees.
Local proof29terminal/15status and14mutants is green; native proof and exact-head
Claude/CI remain pending. Current B1 source/owned authorization covers these corrections;
no local VM/image/launchd test or production resource operation is added.


## 2026-10-17 18:29 EDT — owned source release micro re-orient

- Block1/step1.2 remains active at v1.2-pre; B5 is open and B6–B9 held.
- D211 terminal ABORT source is reviewed; receipt c171c72c now has all8 green checks.
- This slice consumes it durably under both locks before an owned-only source release.
- It feeds guest decision binding/scoped admission and the manual route before D175.
- No boot permission, production operation, native reboot claim or D64 relaxation.
- Yes: D62 needs a checked release after the durable decision, separate from ABORT.

Design is under Claude review before implementation. The fixed abort-release directory
will be single use, with intent before the flag operation and completion only after
post-release checks. Consumer-established file/directory synchronization, raw-byte
readback and fresh original-host/source checks precede mutation. From entry to the flag
operation onward, failures may leave denial uncertain: manual handling without automatic
retry/re-guard or a success claim. The existing image flag helper remains descriptor-
pinned; no reader descriptor is held across preflight's no-holder observation.

§6 deltas: host_vm_reconcile.py, one reserved attempt name in host_clone_dispose.py,
test_host_abort_release.py, mutate_host_abort_release.py, Linux/macOS suite registration,
four plan ledgers and source-only audit records. New tests remain scripted for VM/flags
with actual owned files and real checkpoint/cleanup/terminal producers. Native full
cleanup→decision→release and actual guest reboot are carry-forwards, not this Verify.


D212 design review166/168 adds the separate read-only release verifier and exact released
identity helper now; canonical INTENT/COMPLETE exported schemas and the fixed three-
sample layout; clone-only siblings; full file flush where available with no error
fallback and bottom-up directory fsync; an honest uncertain/manual post-clear failure
contract; and a dedicated source-clear hook with a ctime advance. These are the same
owned release contract, not guest admission. A barrier-skipped mutant exposed blanket
fault masking by a later independent sample barrier; the control now fails only the
original evidence-table barrier and kills the intended missing-durability guard.
Initial release fixture errors came from autospeccing an already mocked lstat; chaining
the existing fixture's side-effect fixes test setup without changing runtime validation.


D212 freshness re-orient: B5-release-freshness is an owned release prerequisite,
with a decisive current-source zero-flag-call failure after an INTENT-time holder
change. Correct within this same release contract: last live sample after the full
rehash and durable INTENT, cheap original metadata/guard checks, no new hash afterward,
COMPLETE pins the added before-clear sample and the core verifier consumes it. Fixed
layout and schema parity tests change together. No guest source or production fence
changes. The source row stays active pending corrected exact review/CI; the earlier
Linux CI failed before these Python controls, not at this source finding.


Claude172 confirms correction and precision points: exact pre-clear ctime, final
clone/attachment/clone-only sibling absence and INTENT bytes. These are included with
zero-call negatives. Optional same-uid flag-helper no-op gap remains D189, not closed.
Unrelated finding B5-CI-R3-placement is tracked in INVENTORY for its own work unit:
recurring unchanged NATS peer-offline10005 before Python; no fixture patch here.


## 2026-10-17 20:01 EDT — D62 guest-admission design re-orient

- Block1/step1.2 remains active at v1.2-pre; B5 is open and B6–B9 held.
- D213's e582f9f9 receipt now has all8 exact-head CI checks green, freshly rechecked.
- The next source boundary must bind the host decision before any guest recovery gate.
- It feeds scoped boot-time admission, explicit manual restoration and then D175.
- B1 authorizes owned design/tests only; D64's production first refusal remains.
- Re-orient before implementation: post-boot ASIF changes invalidate verify_release's inputs.

Claude design review is pending against e582f9f9. The guest cannot call verify_release
after boot: it requires the original stopped VM and unchanged original image bytes.
A copied self-hashed decision is not a protected host authority. The producer/consumer,
trusted external binding, durable single-use handling and failure/manual route must be
explicit before any source admission exception is written. ACCEPTED has no B8 producer;
the available ABORT/cleanup/release path is owned-only.

The existing Gate constructor and JournaledHold.validate also compare saved st_dev in
identity.json, metadata_identity and path evidence, before any conditional timer re-pin.
Changing only the five timer plists and manifest pins would still fail that constructor.
Design must preserve identity.json bytes/nonce/hash and same-boot descriptor/path mapping,
yet avoid requiring a successfully constructed old-device Gate to admit the change.
This is a dependency to resolve within the reviewed D62/D175 design, not permission to
rewrite identity.json, relax arbitrary identities or operate installed timers.

The first independently executable source slice and its §6 deltas will be recorded after
the review identifies a concrete producer and consumer. No executable delta is authorized
by this preflight beyond B1's owned boundary. Real launchd/login/process/hold-reattach
rehearsal remains separately gated by exact disposable-Mac access and resource approval.

### First unit selected after Claude183's source inspection

B5-D62-host-boot-decision has one outcome: a strictly checked owned RESTORE_PRIOR
decision and a pure claim-only consumer. It grants no start, admission or recovery.
Its existing producer module is host_vm_reconcile.py; restore_only.py receives the
canonical bytes/digest and the local checkpoint as an explicitly unprotected claim.
The verifier remains pre-start only, preserving original-host session, stopped/holder,
full source-byte and metadata checks; no post-start weakening is introduced.

§6 deltas: those two existing modules; reserve abort-boot in host_clone_dispose.py;
one portable owned test module and an intended-assertion mutant runner; existing Linux/
macOS test registration; this audit, AUDIT_POST and the four plan ledgers. abort_conflicts,
Journal.recover's first D64 refusal, Gate, JournaledHold and installed timers stay unchanged.
The fixed attempt uses RESTORE_PRIOR.json, avoiding abort_conflicts' existing rejection
of nested DECISION.json. Any failure/partial/repeat remains single use and manual.

Verify: real owned checkpoint→commit→capture→cleanup→ABORT→release producers feed the
new decision; actual owned-file barriers, two held locks, fresh consumed/written sample
parity and unchanged source/transcript bind it. Decisive negatives cover production/
fixture fences, locks, source/host identity, holders/clone/attachments/siblings, barrier/
publication/readback errors, interruption, replay and canonical schema/enum/digests.
The pure guest consumer refuses a changed checkpoint or digest and cannot call Journal,
Gate, host verification, recovery or filesystem APIs. Guard mutants must fail intended
assertions, with controls passing; Claude exact-source review and exact-head green CI
precede source readiness. Native whole-pipeline/ASIF/VM reboot is not this Verify.

Claude183's proposed changed-host-session/post-start mode and broad platform-interpreter
allow-list are not adopted. Its proposed manual steps name future tools, not a presently
executable route. D175 translation must eventually be per verified filesystem/path
component, preserving identity.json bytes and all same-boot descriptor mappings. Guest
scoped admission, actual manual restoration and reattachment remain subsequent units.


D214 mutation-runner integration correction: aa340975 duplicates the prior release
runner's literal durable_evidence(evidence) anchor (2 hits, expected1). CI39082243166
was canceled as superseded before claiming a native/green result. Rename only the new
decision producer's local variable to transcript and update only its own runner anchor;
old release/runtime bodies and runner stay unchanged. All27 decision controls pass
43.692s, all13 new decision mutants pass, and the unchanged prior release runner passes
all13 intended kills with its controls. This is a necessary same-contract test integration
correction, not a production behavior change. Exact corrected-head Claude/CI still required.


D214 proof re-orient, 2026-10-17 20:36 EDT: Claude193 finds no required source
finding at3cbc9cd5 and independently reproduces27controls/13decision/13release mutants
as uid65534 plus regressions. Its live extra mutations expose three material optional
proof gaps: stored-sample host binding, decision-to-intent pin and independent decoder
nonce/arm/checkpoint bindings. Close B5-decision-binding-tests within this same owned
handoff contract before source closure: six new controls also isolate previous/pre-head
and released-flags schema; seven added mutants pin those present guards. All33 controls
pass41.735s, all20 decision mutants fail at their intended assertions with controls
passing/noERROR. Runtime/workflow/release runner bytes are unchanged from3cbc. This
supersedes the27/13 test floor without relabelling earlier runs. Exact test-head Claude
and CI remain required. Smaller JSONDecodeError normalization and host import-graph
notes are carried, not defects or a new refactor. Guest/manual/D175 and Mac proof stay open.

## 2026-10-17 21:56 EDT — D62 scoped-observation re-orient

Step1.2/B5 remains open at v1.2-pre; D215's owned pre-start decision prerequisite is verified.
The next outcome is a record-free scoped process diagnostic, before any admission exception.
Existing Journal.recover, recover_owned, Gate, saved identities and installed timers stay unchanged.
This supports the local-first recovery path without granting a production or reboot waiver.
The source needs a process policy that the saved hold does not yet contain; producer work is separate.
Still the right next source work: only an explicitly scoped diagnostic can advance independently.

Fresh source pre-screen: capture_ready/CAPTURE_KEYS and capture_cohort bind the existing
job observations, stopped states and original hold, but no UID-wide expected process policy.
The forward window refuses new record types. The existing two-job owned recovery driver
cannot supply a legitimate full-node post-boot policy. D64 remains its first cross-boot refusal.
Fresh PR224 receipt0d8099c1 is open/draft with all8 checks success and a clean worktree before
this audit. B1 permits design/owned tests; B2 stays Alpine-only; B3 stays23-job JIT and B4 a
bounded design input, neither repeated. B6 lacks an exact-window release; B7–B9 remain held.

New Codex-owned warning B5-boot-process-policy: a future UID-wide admission cannot derive
expected post-boot processes from old PIDs, a live sampled allow-list, or the current saved
job/override tables. Codex must design and verify an explicit recorded pre-window policy
producer and its frozen binding before that admission. It holds guest admission, manual
restoration and D175. The independent diagnostic must not close this warning or call a
root-only/UID-disabled positive a full D62 observation.

Claude203's initial design is not adopted as written. It proposes a pre-journal consumer in
recover_owned but disables UID scope, uses basename-dependent unreadable-process handling,
implicitly allows self/launchctl helpers and claims native readability from the older census.
Codex204 rejects those exceptions and the claimed need for a new operator approval merely to
keep production refusal in place. Unknown scope must refuse; every allowed process needs
explicit expectations, with no automatic descendant/platform exception. D162's unreadable
process evidence is a limit, not a readability guarantee. D60 needs a freshly validated boot
anchor and static exclusion binding; its durable admission record is later work.

Executable deltas and the exact diagnostic contract await the corrected design. No source,
policy producer, admission record, recovery waiver, service/VM/image/timer operation or Mac
reboot proof is implemented or claimed by this preflight. Four NATS histories remain separate.

### First unit after the Claude205 correction: scoped process diagnostic

B5-D62-scoped-process-diagnostic is narrower than the proposed combined observation gate.
It compares an explicit CURRENT-BOOT expected-generation table, not a pre-stop policy or
cross-boot admission. Its record-free owned CLI is the concrete consumer. Missing post-boot
policy production, all job/hold/stopped/override/D60 comparison, admission records and manual
restoration remain separate open outcomes. There is no inferred self/helper or UID-off mode.
Unknown membership refuses even for another UID; PID-list changes refuse conservatively.
Source reading measures per-process generations, argv/cwd and current on-disk executable
bytes using existing libproc and file/path primitives. This is sampled path/UID evidence,
not loaded-image authorship, physical exclusion or continuous coverage.

§6 deltas: one new scoped_process_diagnostic.py module, one portable/native-owned test
module, one intended-assertion runner, existing Linux/macOS CI registration and plan/audit
ledgers. Every existing executable body, recovery driver, journal/hold schema, Gate, host
module, shared census primitive and installed timer stays unchanged. The CLI requires an
owner-private literal temporary fixture root/file before observation and emits redacted
comparison facts with admission/history_certified false, never an enrollment policy.

Needs: verified D215 exact-head all8 CI; existing nats_macos_proc, relevant_entrypoint,
regular_content and boot_identity primitives. Feeds: explicit future policy authoring and
disposable-Mac unknown-set measurement, then the separately reviewed producer/admission/
manual/D175 gates. Verify: portable strict schema/scope/unknown/unstable/generation/code/
argv/cwd/count/boot negatives, actual owned child primitive observation on macOS with any
enumeration substitution labelled, byte-unchanged fixture/CLI refusals, intended-assertion
mutants with passing controls/noERROR, Claude exact-source review and exact-head green CI.
No native whole-host positive or admission/readability claim follows from this unit.


### 2026-10-17 22:13 EDT — owned process diagnostic candidate (D216)

New scoped_process_diagnostic.py composes unchanged process/path/file primitives and
provides a record-free fixture CLI with explicit current-boot expectations.36 local
controls1.456s and24 intended mutants pass, including an independent spawned C-child
control under explicitly substituted enumeration. No native full-host positive, policy
producer, job/hold/decision comparison or admission is claimed. Report outcome is clean/
refused, never verified; admission/history_certified stay false and argv is redacted.
Claude207 design corrections are included; exact-source review and exact-head CI pending.
B5-boot-process-policy stays open, along with guest admission/manual/D175 and actual Mac
access/measurement/reboot proof. B5/1.2 pre/open, B6–B9 held, D64/production/timers unchanged,
four histories separate. See D216 for sampling, current-disk-image and decoder limits.

Mid-implementation re-orient: Claude207 narrows image/ctime and enumeration claims,
requires a second per-PID sample and independently expected native argv. These stay
inside the same record-free process outcome; no admission/policy/recovery delta is added.
The comparison's shared path helper reads paths, so read-only replaces the earlier pure
wording. The C fixture replaces a false Python-launcher assumption. Production is unchanged.


### 2026-10-17 22:25 EDT — D216 whole-argument scope correction candidate

A bounded independent file-only reproduction at ffd7cb8c showed an other-UID
argv symlink with spaces into a declared root reported clean/excluded. Whole
executable/cwd/argv paths now resolve before the unchanged shared token helper;
absolute and relative whole-argument regressions and their named mutant pin it.
Local40 controls pass0.847s and28 intended mutants fail their named assertions
with intact controls. Superseded CI39089415728 was canceled for this correction,
not green. Exact-source review and corrected-head CI remain required. No shared
runtime API, job/hold/journal/Gate/timer or production operation changed.


### 2026-10-17 22:30 EDT — D216 directory-root proof candidate

Claude213 confirms the required whole-argument scope defect is fixed at07347924,
reproduces40 portable tests (one native skip) and28 intended mutants as uid65534,
and finds no required source issue. Its independent delimiter aliases and embedded
flag control behave correctly. The optional live parent-directory branch was still
unproved: the equality-only mutant passed40 tests. The regression now exercises
each delimiter alias against both a file root and its parent directory; a named
parents-branch mutant fails its intended assertion. Local40 tests pass3.023s and
all29 intended mutants pass with intact controls. Runtime/workflow bytes remain
identical to07347924. Superseded CI39090103107 was canceled for the proof extension,
not counted green. Corrected-test exact-source review and exact-head green CI are
pending. B5/1.2 remain open/pre, D64/timers/production unchanged, no admission.


### 2026-10-17 23:41 EDT — B5-D62-process-policy-binding candidate (D218)

The owned diagnostic receipt4e3605bf passes all8 CI39092308432; native40
controls8.813s/29 intended mutants, owned child matched/full scan refused with
522 unknown entries and318 unexpected rows. Claude221 finds no required receipt
issue; these receipt-CI observations are Codex's and do not replace D217's
source-native516/299 evidence. No admission or production operation is added.

The next bounded outcome is one authored, generation-free process policy in a
new full-node baseline, plus a fixed-path owned producer and a dedicated frozen
consumer that first verifies the external checkpoint. The optional carrier is
inert for all old no-policy callers/readers. No in-window event, CAPTURE_KEYS,
D64/recover, Gate, identity.json, timer, host executable or production change.
Code/argv/cwd/uid/gid/count and explicit launchd-or-expectation attribution are
exact; references must terminate, and held managed jobs/commands cannot be
authored as expectations. No implicit self, root, platform or ancestor permission.

Claude219/223/225 and Codex222/224 define the pre-audit. The complete initial
receipt, not a policy-only cap or arbitrary growth reserve, is the tighter1MiB
reader threshold; both actual serialized files must fit before publication.
Ordinary reopen, interrupted-created=True initialization (including its OSError
early return), and the final reopen path reject a supplied policy. The owned
producer derives every writable path beneath its literal private temporary
root, rejects symlinked parents before Journal construction, and takes explicit
caller-supplied prior/inventory rather than claiming live process enrollment.

Recorded owner binding uses the actual metadata_identity.uid and last watched
gate-root identity.uid plus the root device:inode pin. Root/lock pins themselves
are strings without uid; ancestor path owners differ. Missing owner carriers in
a new policy refuse. The producer observes its own uid; only the image reader
labels actual file-owner metadata. The pure validator observes no filesystem.
The consumer claims pinned-checkpoint consistency only: same-uid coordinated
rewrite/recommit remains undetected (D189); authorship, pre-stop authenticity,
policy completeness/satisfiability and record-time eligibility remain unproven.

Verify: portable honest producer/frozen/image positives and independent refusal
cases for schema/code/argv/owner/root/count/attribution/held jobs, swap/absence/
malformed rehashed policy, exact complete-receipt byte boundary and all reopen
routes; intended-assertion mutants with intact controls; unchanged old baseline
and D64 controls, exact-source Claude review and exact-head green CI. These
checks are pending. Only this owned source prerequisite may close. B5/1.2 remain
open/pre, B6–B9 held; boot comparator/observer/durable admission, manual/D175,
Mac access/APFS reattach/reboot and the separate physical histories remain open.


### 2026-10-18 00:14 EDT — D218 checkpoint-order proof correction candidate

Claude227 reproduces source433966aa:47 controls/44 intended mutants as uid65534,
435 existing tests ran with usual skips and all suites OK, unchanged runtime
bodies except constructor/open. It finds no required source defect, but its
checkpoint-before-policy reordering mutant survives47 tests. That is a required
proof gap because malformed extracted records then escape as key/type errors or
reach policy validation before the external committed digest is checked.

The new negative feeds a non-list, a baseline missing inventory, a string prior
and a rechained malformed policy, requiring the checkpoint's Refused class and
message precedence. Its statement-reordering mutant now fails that named
assertion, with no ERROR counted. A second negative also closes Claude227's
optional image pin-order gap: a scripted divergent second commitment read must
refuse before the real read_inputs can select a window. Local49 controls pass
11.591s and46 intended mutants pass with intact controls. Runtime and workflow
bytes are identical to433966aa; the prior324-test batch remains evidence of the
common executable paths, not a new325/326-test execution claim.

Superseded CI39095435399 is cancelled for this proof correction, not green. Its
Linux117580780740 recorded47/0.960s/44 at merge3a743eddd6137ae831ae4a3441000ab169d4c504
(source433966aa second parent, identical whole tree); raw SHA256
1bc8c68cfa910d921f5c153c183a3bef064a06d8bfde703b955e2af4d03c7590. This
is the earlier proof only. Corrected-test exact-source review and new-head CI
remain pending. B5/1.2 stay open/pre; no admission, production, Gate or timer change.


### 2026-10-18 01:25 EDT — B5-D62-process-observation-envelope candidate (D220)

D219 receipt2615452b and sourceee311fcd pass all8 CI39097936909 and39096484480.
Claude229/237 find no required source/receipt issue. Receipt-native49/2.326s/46
and Linux49/0.831s/46 are Codex's final run observations, separate from Claude237's
independently verified source-native log. Receipt merge5335589ac9524a7d66d947453c16958466f64345
has receipt2615452b as second parent and an identical whole tree. The stale B5
frontier summary is corrected here; D219's pending-at-commit text stays historical.

Next bounded outcome: one four-PID-sample, current-boot observation envelope over
a bound authored policy, consumed by a record-free owned diagnostic. Claude241
proposes composing unchanged diagnostic.compare(raw, empty expectations) for
raw schema, scope and redaction rather than a second census/resolver. Its own
clean/refused verdict is stripped. Codex242 pins outer-boot expectations so inner
boot failures survive as unknown, all raw unknown multiplicity, excluded-row
fingerprints, both launchd reads and plist identities, unique namespace/label
pairs, integer monotonic offsets and the fixed owned fixture boundary. Final
pre-audit response is pending; no observer source or test exists at this entry.

Recorded means a complete coherent observation, never a class-policy match or
admission. Unknown, unreadable, unstable, changed, incomplete or expired evidence
refuses. Unloaded/idle job observations are known negative facts for the later
comparator. Same-UID scope cannot be excluded. Other-UID scope remains read-only
observer evidence, bound to the policy and samples, with D189's unprotected-input
limit; no basename/platform/controller exception and no raw argv disclosure.
The120-second acceptance window cannot interrupt blocked filesystem/libproc
calls; at most16 distinct anchors are queried. No hard wall-clock guarantee.

Minimal source surface after the pre-audit: one new step12 module, test and
intended-assertion runner, four CI registration lines, and these six ledgers.
Existing diagnostic, policy binder, shared lib, Journal/schema/recover/D64,
Gate/identity, host executables and timers stay unchanged. The owned consumer
reads a separately prepared fixture; it constructs no Journal/Gate, capture or
policy enrollment and writes no file. Scripted file input always stays scripted.

Verify before closing only this owned source prerequisite: pure schema/coherence
controls and intended mutants; actual helper composition and ordered samples;
unknown-entry retention, all-row stability, namespace/generation/plist bracketing,
redaction, budget/cap and provenance negatives; honest frozen-policy owned reader
with unchanged files and zero constructors; native substituted and CI full-runner
measurements, no full-scope positive claim; exact-source review and green CI.
Class matching, jobs/recorded hold/overrides/fresh D60, durable admission, attended
manual/D175, Mac access/APFS reattach/reboot and four-history acceptance stay later.
B5/1.2 remain open/pre, B6–B9 held. No production operation is added or performed.


### D220 pre-audit settled — Claude243, before source work

Claude243 accepts Codex242 with no required issue. Carry the seven precision pins:
outer boot_start is the empty-expectations boot; inner boot=None and all unknowns
survive unchanged; excluded rows carry full redacted-row fingerprints; J1 is read
for unloaded/idle as well as running jobs; both redacted job reads and both plist
identities survive; reported PID generations bind both passes, including excluded
rows; anchors are unique namespace/label pairs without choosing an authored hash;
integer monotonic_ns offsets use120000000000ns and16 anchors; fixed private owned
fixture capture/data/table/envelope paths precede all reading/collection. table.json
is fixture authority only and supplies no B3 provenance. Scripted source/coverage
is forced by the file consumer; original claims are narrowly typed labels only.
No raw arguments key or inherited diagnostic verdict appears in serialized facts.
Recorded is coherent sampled observation only, never class matching or admission.
The on-disk and D189 limits remain. Source/proof implementation now starts; exact
review/CI and the candidate row remain open.


### 2026-10-18 01:50 EDT — D220 local observation-envelope candidate proof

The new process_observation_envelope composes the existing two-sample observe
and compare scope stages twice, with an outer current boot and bracketed launchd
facts. Its pure serialized validator retains all unknown entries, including
multiple failures for one PID and global failures; compares included rows and
excluded full-row fingerprints across passes; and independently recomputes
coverage, generation/job/plist ties, budget and the envelope verdict. It strips
the old diagnostic verdict and emits no raw process or launchd arguments.
Recorded is coherent sampled observation only, not a class-policy match.

Local52 tests pass11.274s; all47 named intended-assertion mutants pass with their
unmutated controls intact. The combined old diagnostic/policy plus new suite
passes141 tests22.714s. Earlier50/51 and139 executions retain their actual counts.
The first four mutation attempts exposed proof-harness issues (an earlier
assertion firing, nonviable mocks after removed guards, a finite fake clock and
an inherited fixture umask dependency); those attempts are not complete proof.
The final fixture sets private creation permissions only while preparing its
owned files and restores the caller's mask; its standalone022-mask control
passes. No exception or unrelated failure is counted as a kill.

The owned consumer reads an honestly prepared frozen-policy fixture through the
unchanged reader, with Journal/Gate constructors forbidden and unchanged file
snapshots. It fixes capture/data/table/envelope inputs beneath one literal
private temporary root, validates the actual caller/policy-root ownership, bounds
canonical single-link file input at8MiB, and forces file provenance scripted.
The table is fixture authority only, never B3 host-held pin provenance.
Local native evidence is the substituted child run with four PID-list calls and
real existing libproc/argv/hash/cwd primitives; no unpatched local full scan ran.
The native CI full-runner measurement remains pending and must refuse unknown;
no native full-scope or attribution positive is claimed.

Only three new step12 executable/proof files and four CI registration lines
change executable surface; every existing diagnostic, policy-binding, library,
Journal/schema/recover/D64, Gate/identity, host executable and timer byte is
unchanged from2615452b. Some cross-sample refusal predicates are dominated by
coverage/row equality/empty-unknown constraints; no equivalent single-predicate
removal is counted. The process-pass-reuse mutant and real four-list child
control pin actual collection, and all47 counted changes fail named assertions.

Exact-source review and exact-head CI are pending. The D220 row stays open;
B5/1.2 open/pre, B6–B9 held. Class matching, jobs/hold/overrides/fresh D60, durable
admission, attended manual/D175 and physical Mac/APFS/reboot histories stay later.
No production operation, resource provisioning, policy enrollment or admission.


### 2026-10-18 02:08 EDT — D220 sample/expiry proof and strict binding-UID correction

Claude245 reproduces source2393e724 as uid65534:52 ran with one native skip and47
intended kills with intact controls; it verifies the ten-file lineage, unchanged
existing executable trees and each kill's intended assertion. It requires two
proof additions: within-pass before/after equality can fail while union coverage
and cross-pass rows agree, and elapsed_ns above the window can be paired with a
false expired flag. Neither predicate is dominated. The earlier broad dominance
sentence is withdrawn; the new negatives and individual runner mutations pin both.
Only the specifically confirmed pass-B generation half and private symlink-leaf
literal check are treated as dominated; other unpinned cases are carried below.

Codex independently finds a strict-schema source defect: Python deep equality
lets a Boolean binding uid alias valid UID0/1. A scripted pure table with both
scope digests recomputed is recorded with that Boolean at2393e724; admission stays
false. The new test fails for both aliases before the fix. The validator now
checks the binding's exact key set and integer UID before equality, rejecting the
aliases without changing any ordinary observation or production authority.

Local55 tests pass52.273s;50 intended-assertion mutations pass with intact controls,
including the two required predicates and removal of the UID type check. The
combined suite passes144 tests41.351s. Earlier52/47,141 and139 executions retain
their own counts; this is a new run. No ERROR or unrelated failure is counted.
Only the new module's two binding-schema lines and its tests/runner change
executable bytes from2393e724; the existing workflow and all pre-existing runtime
paths stay byte-identical. No local unpatched full scan or production operation.

Superseded CI39101987342 was cancelled for this required correction, not
counted all-eight green. Its Linux117599965393 passed52/1.237s with one native skip
and47 mutants at merge430dd088f8dbce75813c7d7dff0ac28344d8d643, source2393e724 second
parent and identical whole tree; raw SHA256
df5bf9c247e7ca712efdecad62a1490b649c8d1d46adb88a3f78443da204f277.
That evidence is not the corrected55/50 proof. New-head review and CI remain
pending; the D220 row stays candidate/open. B5/1.2 open/pre, B6–B9 held, no class
matching, physical exclusion, eligibility, authorship or admission claim.


### 2026-10-18 03:14 EDT — B5-D62-process-class-comparator candidate (D222)

Micro re-orient: step1.2/B5 stays open at v1.2-pre, B6–B9 held.
D221 verifies the owned observation-envelope source; its receipt e9efb244 now
passes all8 CI39104976663 and Claude253 is clear (255 acknowledges Codex's final
run measurements). Receipt-native55/3.848s/50, full runner refused with child in
both passes,1032 unknown entries and2 reasons; Linux55/1.813s/one skip/50.
Merge34b4bb0423d6b41ca4dc74714d1e2a561ab40f97 has receipt as second parent and
an identical whole tree. These final receipt-CI measurements are Codex's,
separate from Claude253's independently checked source-native proof.

This unit contributes only a pure process-class consistency comparison and its
real record-free owned consumer over that verified envelope and D218 policy.
The prevalidated policy comes from the unchanged frozen/image reader; this is
not an arbitrary-policy parser or a replacement D218 validator. Final pre-audit
is requested in Claude256; no comparator source/proof exists at this entry.

Goal: compare one complete coherent sampled envelope to the bound authored
class/attribution/count claims without granting eligibility or admission.
Needs: D221 exact-head source/receipt all8 green, clear247/253 reviews, unchanged
valid_envelope/binding/image_process_policy, and B1/D189 owned boundaries.
Feeds: jobs/recorded hold/overrides/fresh D60, then durable admission, attended
manual and D175. Class consistency cannot establish a stopped hold.
Verify: code: pure scripted positives/negatives with intended-assertion mutants;
owned frozen-policy consumer with no constructors/writes and unpromoted scripted
provenance; old envelope55/50 behavior; native owned-child substituted refusal
and CI-only full-runner refusal; exact-source review plus all8 CI, then a separate
five-Markdown receipt with its own review/all8 CI. No native positive is claimed.

Proposed contract: validate the envelope first, and refuse its non-recorded or
malformed state before class logic. Bind the report to the exact input's canonical
hash and policy hash. Keys are literal executable, on-disk SHA, NUL-joined argv
SHA, uid/gid/cwd. PID/PPID/birth/name are not cross-boot class keys. Sort observed
rows by birth then PID; attribute launchd rows to their actual policy-owner
namespace/label, running state, current generation and authored plist SHA.
Expected-parent rows need a strictly older included parent already uniquely
assigned the referenced label. Zero candidates is unexpected, multiple ambiguous;
counts are exact after assignment, never a count-solving permission. Launchd
count above one remains valid but unsatisfied. Empty policy matches no included
process. Carry source/coverage unchanged and always admission/history false.

No raw argv representation or policy is emitted; redacted fields may legitimately
overlap argv0/cwd, so tests pin dedicated secret sentinels rather than an impossible
ban on every argument substring (including empty arguments). Keep anchors private
in memory for the later jobs gate; the class report binds their envelope hash and
does not itself carry job-configuration evidence. Do not count dominated single
launchd checks as isolated kills; use coherent recorded wrong-row attribution,
non-running-with-PID and authored-plist mismatches for the relevant mechanisms.

File deltas: one new step12 process_class_comparator.py, its test and intended
mutation runner; four CI registration lines; bounded extraction of inspect_owned
into owned_envelope returning the same policy+envelope privately, with inspect_owned
returning the latter and only its policy-emission mutation anchor updated; these
six ledgers. No D218 binder, Journal/schema/recover/D64, lib, Gate/identity, host
executable or timer change. No production operation or local unpatched full scan.
Optional D220/D218 follow-ups stay carried. Mac access, native positive attribution,
full pipeline, APFS reattach/reboot and four-history acceptance stay separate.


### D222 pre-audit settled — Claude257, before source work

Claude257 clears the contract with two required precisions, adopted: every
unexpected entry carries its redacted process and class_candidates before
attribution; gate on valid_envelope's recomputed copy and use that copy's reasons,
while the hash binds the exact input bytes. Native child candidates must equal
its authored label exactly. Rows/report entries follow (sec,usec,pid) order.
Policy is the prevalidated reader argument; the optional redundant row-schema
check is not added. Optional D220/D218 controls stay carried.

The existing diagnostic.redacted helper only copies dict fields and replaces
arguments with the NUL-join digest; it performs no process-schema validation.
Expected keys can therefore project its actual output over the validated policy
row, reusing that exact helper instead of duplicating its hash expression. Tests
will pin that shared call and empty/non-ASCII/argv-boundary behavior.

Only the settled comparator/extraction surface now enters implementation. No
class comparator, jobs/hold/D60 gate, admission or production operation is claimed
by this pre-audit entry; source review/CI and the candidate row stay open.


### 2026-10-18 03:30 EDT — D222 local class-comparator candidate proof

The102-line pure comparator validates the envelope before expected or observed
class keys, gates on its recomputed outcome/reasons, and hashes the exact input
object plus prevalidated policy. It reuses diagnostic.redacted for expected argv
hashes, sorts rows by birth/PID, requires actual launchd namespace/running/current
generation/authored plist or an older uniquely assigned referenced parent, then
refuses zero/multiple candidates and exact count deficits/excess. Unexpected
rows retain pre-attribution class_candidates. Source/coverage come from the
recomputed envelope, so a forged full label cannot promote substituted/scripted
facts. Redacted reports emit neither policy nor raw argv or job-anchor tables.
Class-consistent establishes no stopped hold, eligibility, authorship or admission.

Local37 tests pass5.536s; all50 intended-assertion mutants pass with intact named
controls. Existing envelope55 tests pass8.781s and its50 mutants still pass after
the bounded helper extraction/re-anchoring. The combined diagnostic/policy/envelope/
class run passes181 tests21.429s. Earlier32/36 tests retain their actual counts;
the32 run failed one incomplete test fixture that correctly stopped at envelope
coverage. The first new mutation attempt left the argv-digest field unchanged
because of whitespace in its replacement; that partial run is not complete proof.
The corrected runner checks every replacement anchor and counts only the named
assertion failure, never ERROR or an unrelated failure.

The native owned C child is authored before spawn, observed through existing
libproc/hash/argv/cwd calls with only PID enumeration substituted (four calls),
and reports exactly its authored class candidate while refusing its absent
parent. This is a native attribution refusal, not an attribution positive.
Owned frozen-policy scripted positives pass through one shared reader; constructors
are forbidden, files remain unchanged, and file source/coverage stays scripted.
Only CI will perform the full-runner observation; no local unpatched full scan
or production service/VM/timer operation occurred.

Only three new files, four workflow lines, the envelope owned helper extraction,
its old policy-emission mutation anchor, and six ledgers change. Every pre-existing
envelope function except inspect_owned is AST-identical; valid_envelope, binding,
collector and all frozen/private reader checks remain unchanged. The extracted
body has the same first fixture gate and fences, returns the same policy plus
value privately, and inspect_owned returns its second item. No D218 binder,
Journal/schema/recover/D64, lib, Gate/identity, host executable or timer change.

Claude257 pre-audit requirements are adopted; exact-source review and exact-head
all8 CI remain pending. Only this owned source prerequisite may close after its
separate reviewed green evidence receipt. B5/1.2 remain open/pre, B6–B9 held.
Jobs/hold/overrides/D60, durable admission, manual/D175, native positive attribution,
full pipeline, Mac access/APFS/reboot and four-history acceptance stay later.


## Mid-Implementation Findings — D222 own-label proof


### 2026-10-18 03:50 EDT — D222 own-launchd-label proof correction

Claude259 independently reproduces ea87f6fa as uid65534:37 new tests/one native
skip/50 intended kills; old envelope55/one skip/50; combined181/three skips. It
confirms the twelve-file delta,30 unchanged envelope definitions and the identical
18-statement extracted body except paired returns. Source is correct, but it
requires a proof correction: removing name == key survives the37-test suite.
Two D218-valid launchd expectations can share a plist hash while differing in
label and class. Swapped running anchors are internally recorded facts; the
missing name filter then borrows the other label's matching generation and
wrongly reports class-consistent. This predicate is not dominated by validation.

Codex independently reproduces the surviving removal against the original37
tests (all pass5.676s), then adds the coherent shared-plist/two-label swap control.
The unchanged source refuses both rows, preserves their exact class_candidates,
assigns neither and reports both missing; the new single-predicate removal fails
that named assertion. D218 plist-hash uniqueness is not changed. The source,
workflow, envelope helper and old runner are byte-identical to ea87f6fa.
Only the new test/runner and six ledgers change in this correction.

Local38 tests pass6.733s;51 intended-assertion mutants pass with intact controls;
the combined suite passes182 tests32.091s. Earlier37/50 and181 runs retain their
counts. Superseded CI39107975073 is cancelled for this required proof, not counted
green. Its Linux117617833935 separately passed37/0.470s/one native skip/50, raw
1517497 bytes SHA256145e23cafa336aad6cd1445b9088836f12aebe0e8d13a4e516bb95be694e8817,
checkout4699d64b4786eeadf6716faa12c207d8605dac16 with ea87f6fa as second parent
and an identical whole tree. It is not the corrected38/51 source proof; no native
result is claimed for that cancelled job.

The native CI test now asserts each process pass is non-null before indexing,
turning that failure mode into an explicit assertion. CLI early exceptions can
return a minimal refusal without phase/hashes; no class-consistent result follows.
Claude259's five forbidden-key mutations share the observed7-tuple mechanism;
they are counted, not discriminating, while the separate field positives pin the
contract. Pass-B instead of A, PID instead of generation equality and dropping
loaded are equivalent under recorded input, not gaps or counted extra kills.
D220/D218 optional controls remain carried.

Corrected exact-head source review and CI are pending; D222 stays open, B5/1.2
open/pre, B6–B9 held. Runtime/operational boundaries remain unchanged. No local
unpatched full scan, production operation, policy enrollment, hold eligibility,
loaded-image/history/physical proof or admission is added or claimed.


### 2026-10-18 05:16 EDT — owned held-job negative comparator pre-audit (D224)

Micro re-orient: B5/step1.2 stay open at v1.2-pre; B6–B9 held.
D223 source39638d1e/receipt907046d9 have clear261/265 reviews and all8 exact-head
CI39109210059/39111452945. Receipt native38/2.788s/51; full runner refused with
child in both passes,1036 unknown entries and2 reasons; Linux38/.504s/one skip/51.
Merge75c377af0dd4e8269e575fc2b9311819242bd3f3 has receipt second parent and equal
tree. Later receipt-CI facts are Codex's;267 preserves that evidence separation.

Pre-audit correction269: the optional launchd-command comparator does not feed
the held-cohort gate because D218 forbids its labels/commands. Its uncommitted
candidate is replaced before source work; no command-comparator source exists.
The actual frontier is a pure held-cohort negative-job comparator. Claude271
clears request270 at exact907046d9 with the following corrections adopted.

Goal: one scripted negative-job consistency result for every verified managed
label in gui/recordedUID, user/recordedUID and system, without admission.
Needs: D223 clear source/receipt all8 CI, unchanged frozen/stopped readers,
valid_job, complete full-node fixture and B1/D189 owned boundaries.
Feeds: the later full managed-job current-boot collector, then overrides/fresh
D60 and integration with strict process gates before durable admission/manual/D175.
Verify: code: coherent portable/scripted positives and independent four-bucket,
UID/key derivation, ordering, hash/privacy and intended-assertion mutations;
real owned frozen-image reader/CLI with and without policy, no constructors/writes,
unchanged prior regressions, exact-source review/all8 CI then a separate reviewed
all8-green five-Markdown receipt. runtime: none. Native execution is scripted
reader portability with no skip, never a live launchd/process or held-state claim.

compare_held_jobs(records,jobs) takes records already verified by the unchanged
frozen verifier; it is not a journal parser. That verifier already proves prior
and CAPTURE completeness, held_as_checkpointed, all unloaded observations and
empty final loaded inventory. These dominated predicates are reused, not counted
as new proof or new intended mutants. Derive labels only from verified prior,
using ai.openclaw.+unit; no timer-only, original-domain or policy-anchor filter.
Derive all three namespace keys from that count (currently23 units/69 keys), with
no16-anchor cap or hard-coded unit count. Owner UID is strictly int>=0 from
scheduler-heartbeat.execution_hold.metadata_identity.uid, refusing absent/bool;
this is D218's namespace-owner convention, not a caller-derived permission.
The consumer requires nonempty stopped-reader metadata and every read UID equal
to the recorded UID, without using os.getuid for that binding. Older records
without this owner field refuse; no runtime/schema change supplies it here.

Jobs is a string-keyed JSON object. Missing expected keys are missing; outside
keys are extra without interpreting their shape or value; malformed present
expected facts are unknown {key,error_type}, catching only valid_job's Refused.
A well-typed loaded job is unexpected_loaded regardless of state or PID. Only
exact {loaded:false} is negative. Each bucket is retained/sorted and independently
pinned; no basename, command, process or loaded-idle exception. Report exact
encoded(jobs) SHA, baseline and verified checkpoint digests; literal scripted
source, sampled true/continuous false and admission/history/hold_certified false.
Only all four empty yields held-jobs-negative-consistent. No job values, program,
argv digest, plist path, policy or full table is emitted; optional baseline
process_policy is ignored. No timing budget is inferred from the envelope.

Owned consumer: --fixture AND --scripted before any IO; private/literal owned
temp root openclaw-owned-held-jobs-16hex, root/capture/data checks and unchanged
read_private for table.json and held-jobs.json (8MiB diagnostic, not frozen-reader
widening). Copy image_process_policy's pin-coherence sequence textually; pins
precede one read_inputs, then one verify_frozen_checkpoint, then owner binding,
job-file read and compare. A frozen-verifier refusal must prevent compare and is
pinned by an order-swap mutant. Canonical redacted CLI stdout;0 only narrow
consistent,2 refusal, minimal early-error shape accepted. No process_policy need,
new census, Journal/Gate construction or write. The policy-free honest fixture
with recorded owner was read and frozen-verified locally:23 units,54 reads/uid501.
The first prototype asked the fixture for missing binary/home attributes and
failed; the corrected prototype uses read_inputs' actual returned fields.

Deltas: three new held_job_negative_comparator/module-test-mutator files,
four workflow registration lines, six ledgers. Existing executable/test/mutator
bytes stay fixed. No Journal/schema/recover/D64/lib/Gate/identity/host/timer change.
B5/1.2 stay open/pre; row close waits for source and separate receipt review/CI.
No live observation, inventory/overrides/D60, hold/physical absence, eligibility,
authorship/history or admission. No production operation. Optional D220/D218
controls stay carried. Later69-key double sampling at10s per call can exceed20min;
120s cannot be inherited, and system-domain unreadability must stay unknown.
Mac access, APFS reattach/reboot and four-history acceptance remain separate.


### 2026-10-18 05:23 EDT — D224 local held-job comparator candidate proof

The new97-line record-free module consumes prevalidated frozen records and an
explicit scripted job table, derives every managed label in all three domains
from prior and the recorded owner UID, reuses valid_job, and retains sorted
missing/extra/unknown/unexpected_loaded buckets. No optional policy is interpreted.
Malformed expected facts are unknown; extra keys are retained without parsing
key shape or value. Every well-typed loaded job refuses, including idle without
PID. Exact jobs/baseline/checkpoint digests bind the claims; no job values or
policy are emitted. No live node or execution-hold assertion is made.

Local31 tests pass10.692s;44 intended-assertion mutants pass with intact named
controls and no ERROR-only kill. Existing182 process regressions pass21.580s.
The earlier30-test run passed6.477s. The first mutation attempt rejected a
zero-UID guard mutant through a Refused exception rather than its intended
assertion; it is not counted and the real zero-UID positive stays a non-counted
control. The prior42-mutation run passed before adding explicit verifier skipped/
duplicated controls and an owned-root owner mismatch check. Scope and false
claim flags, recorded UID type/carrier, all domains/member1/federation, each
bucket/verdict, idle/malformed loaded, hash/privacy, pin-before-read, exactly one
read/verifier, verifier-before-compare, every read owner and CLI exits are pinned.

The actual owned consumer succeeds with and without a process policy, requires
both flags before IO and the literal private fixture root/files, copies the
existing pin-coherence sequence textually, and runs one read_inputs followed by
one verify_frozen_checkpoint before owner binding/job-file read/comparison.
Constructors are forbidden in the observation test; before/after files match.
Bad checkpoint/receipt, ownership, mode, alias or canonical input refuses through
unchanged readers before comparison. No existing executable/test/mutation runner
changes; only the three new files, four CI registration lines and six ledgers.

Frozen record completeness/held_as_checkpointed/all-unloaded inventory are
upstream verifier proof, not new comparator predicates or counted mutants.
Native CI will execute the same31 scripted checks/44 mutations with no skip;
there is no live job/process observation or new native full-scan measurement.
Source exact-head review/all8 CI remain pending, followed by the separate
five-Markdown receipt review/all8 CI before this owned row closes. B5/1.2
remain open/pre, B6–B9 held; D64/Gate/installed timers/production unchanged.
Full managed-job collection, overrides/freshD60, process-gate integration,
durable admission/manual/D175 and physical Mac/APFS/reboot gates remain later.


### 2026-10-18 05:35 EDT — D224 consumer recorded-owner proof correction

Claude273 independently reproduces exact104d808e as uid65534:31 tests/no skip,
44 intended kills/intact controls,182 prior process regressions/three skips.
It confirms the97-line source correct, the10-file/1332-insertion delta, unchanged
pre-existing executable/test/mutator bytes, identical six-ledger blocks and pin
sequence, full-node preconditions and every claimed source ordering/bucket fact.
It requires one proof correction: replacing the ownership tie's recorded uid
with envelope.os.getuid() survives all31 tests and accepts a constructible frozen
image whose recorded owner is foreign but whose files belong to the runner.

Codex independently reproduces that surviving substitution against the original
31 controls: all pass6.746s. The new control patches only the existing fixture's
recorded_hold metadata UID to runnerUID+1 before the honest journal/commit/capture
flow. The real frozen reader verifies this policy-free chain; every returned
file UID is runnerUID. The unchanged source refuses reader ownership and never
calls compare. The one targeted ownership-tie substitution now fails the named
foreign-owner refusal assertion, not through ERROR. Local32 tests pass11.587s;
45 intended-assertion mutations pass with intact controls. Comparator/runtime,
workflow and all existing source/proof files remain byte-identical to104d808e.
Only the new test/runner and six ledgers change in this correction. The separate
182 local regressions/21.580s are the earlier unchanged-runtime run, not a new run.

Superseded CI39115186066 was cancelled for the required proof, never counted
all8 green. Its completed Linux117639445757 separately passed31/1.597s/no skip/44;
raw1521527 bytes SHA2565ee0980f5397e4f683e13f26b22e453fdf091c38e6d7dee038fd02cbbd5a412b,
merge2042217fa6bfcfaa79d34d9247a1d0aa4a01d3b9 with104d808e second parent and equal
whole tree. No completed native result is claimed for that cancelled run.
The earlier30/42 and rejected ERROR-only control retain their historical counts.

Claude273's optional weak verdict needle is strengthened to loaded-key-refusal
wording without adding a count. Job-file read-after-owner ordering and the
root-name/temp-parent predicates remain source facts but non-discriminating
controls, carried as optional follow-ups; the string-key boundary is tested but
not a counted mutant. Deriving labels from UNITS and dropping the verifier-digest
override are equivalent for prevalidated records, not gaps or additional kills.
No new source predicate, schema, reader, timer, hold or admission behavior changes.

Corrected exact-head review/all8 CI remain pending, followed by the independent
five-Markdown receipt review/all8 CI before only this owned row closes. B5/1.2
stay open/pre,B6–B9 held; source remains scripted-only and all live observation,
overrides/D60/process integration/durable admission/manual/D175/physical gates
remain later. No production operation, caller-UID permission or release occurs.


### 2026-10-18 06:46 EDT — managed-job observation pre-audit candidate (D226)

Micro re-orient: B5/1.2 remain open/v1.2-pre; B6–B9 held.
D225 receipt956f6c03/source d5d6aefd have all8 CI39118302426/39115988725
and clear279/275 reviews. Receipt native32 scripted tests/45 mutations; its
complete-log/tree evidence is Codex's, separately acknowledged by Claude281.
Only scripted negative-job consistency closed; current-boot managed-job facts
remain absent. No local production-label scan or production operation is authorized.

Goal: one complete, bounded, current-boot managed-job observation envelope.
Needs: D225 reviewed green source and receipt; unchanged expected_keys/owner_uid,
launchd_service, redacted_job/valid_job, boot_identity, private frozen readers
and the honest full-node owned fixture; B1/D189. All exist at956f6c03.
Feeds: later combination with the held-negative comparator, then overrides/fresh
D60, strict process-gate integration, durable admission/manual restoration/D175.
Verify: portable scripted collector/validator and real frozen-reader consumer
controls, decisive named assertion mutations, isolated macOS CI observations,
exact-source review/all8 CI and a separate reviewed green five-Markdown receipt.
No production runtime verification or live hold/eligibility/admission claim.

Pre-audit request282 is pending. Proposed surface: three new managed_job_observation
module/test/mutator files, four CI registration lines and these six ledgers.
No existing executable/test/mutator changes, no shared census primitive/parser,
Journal/schema/recover/D64/Gate/identity/host/timer change. VERSION stays pre
because the enclosing step has not met its live exit gates.

Proposed observations derive every managed label and all gui/recordedUID,
user/recordedUID and system keys from verified prior, with no policy/timer
filter or16-anchor cap. Two complete sequential launchd_service sweeps retain
per-key typed redacted facts or errors; only the shared parser's exact absent
service return is unloaded. System/domain unreadability and timeouts stay unknown.
Boot identity brackets and a separately reviewed30-minute acceptance-only
budget are proposed, not a hard deadline:138 ten-second calls can take23 minutes
and boot_identity itself has no subprocess timeout. No120s inheritance.
Expiry must stop further job acquisition and retain every unsampled key.
Loaded/idle facts may be recorded, never interpreted as held negatives here.

The validator will rederive frozen binding/key coverage, schema, boot, budget,
unknown and two-sweep agreement; stored outcome cannot authorize anything.
Serialized facts contain argv digests, never raw arguments. No continuous,
physical absence, process generation/attribution, complete entrypoint inventory,
overrides, freshD60, hold, history/authorship or admission claim. D189 applies.
The actual schema/budget/provenance and native boundary await282's review.

The intended real CLI remains --fixture AND --scripted before anyIO, consuming
private literal owned inputs and copied pin-coherence followed by one read_inputs,
one frozen verification, then every read owner tied to recordedUID. It cannot
turn an input file's observed claim into live authority. No constructor or write.
A prepared temp image cannot prove host isolation; a collector library and
isolated CI-owned native harness are proposed, with no local unpatched scan.
Mac access/designation, APFS reattach/reboot and four-history acceptance stay
separate. Optional D218/D220/D224 controls stay carried, not silently closed.


### D226 pre-audit settled — Claude283, before source work

Clear to implement the smallest live half of the held-job gate, with structural
boundary: inspect_owned/main require fixture AND scripted before input IO and
never call the collector. owned_records supplies only frozen records/digest;
collect_jobs is called live only by the test harness's darwin/GITHUB_ACTIONS
branch. That branch is an isolation convention, not environment attestation.
No operator-gated live path is added. The requested two-replacement mutant must
relax flags AND wire collection, and the CLI-with-fixture-only control must
assert refusal and zero census calls.

Use structured (namespace,label) pairs from owner_uid and every prior unit,
never parse keys back into domains; assert their keys equal expected_keys.
Each job entry is either unchanged valid_job shape or exact error_type string.
Catch only envelope.ERRORS, including TimeoutExpired; malformed loaded/arguments
become errors, never unloaded. On budget expiry retain every remaining key in
both sweeps with BudgetExpired, no further census call.30min WINDOW_NS is an
acceptance-only budget checked before each call and after boot_end; validator
recomputes expired from elapsed. Pin30min >=2*keycount*shared10s timeout for the
fixture so cohort growth cannot silently outgrow it. boot_identity has no timeout.

Exact four stages boot_start/sweep_a/sweep_b/boot_end, all present, failures empty,
not expired, two equal hex64 current boot values, complete exact key coverage,
no per-key errors and equal sweep values are required for recorded. Bind exactly
baseline/checkpoint digests and recordedUID, reject typed aliases; baseline boot
is not an expectation. Loaded/idle facts may be recorded; no held-negative verdict.
Stored outcome/reasons never trusted. Scripted input is private/bounded/canonical,
source forced scripted, file source/coverage retained only as sample_labels;
coverage sampled true/continuous false/physical false, admission/history/hold false.
Only recorded/refused vocabulary, no raw arguments. Native CI prints real outcome
and error histogram, asserts coverage/shape only, no native positive assumed.
Per-key/domain/error/timeout/expiry/order/schema/provenance and owner/frozen-path
controls get named intended assertion mutants; no ERROR-only kills. Optional
shape-compatibility control may feed a recorded scripted sweep to the unchanged
negative comparator; this is not full integration. Per-sweep timing and loaded
summary are deferred. Plist digests/overrides/freshD60 remain outside this unit.


### 2026-10-18 06:57 EDT — D226 local managed-job observation candidate proof

The202-line module implements the settled283 boundary: the actual record-free
CLI requires both flags before any input IO and never references collect_jobs.
owned_records copies the unchanged pin-coherence sequence, reads once, frozen-
verifies once and ties every nonempty read metadata row to the recorded UID.
Only the CI-only native test branch composes that path with the live collector.
Environment/fixture claims do not attest isolation; no local unpatched job scan
was run. Source and script inputs remain unprotected under D189.

The collector builds structured namespace/label pairs, cross-checks expected_keys
and records two ordered complete-key sweeps, current boot brackets, elapsed
acceptance budget and every per-key error. Exact shared absence is the only
unloaded return; loaded/idle facts are recordable. TimeoutExpired is retained;
programming errors outside envelope.ERRORS propagate. Expiry prevents more
launchd calls and fills all remaining keys with BudgetExpired. Thirty minutes
is independent of the process120s budget; boot_identity has no timeout and the
limit cannot interrupt an in-flight call. The growth control compares2*keycount
*shared10s against this limit. Plist identities, generations, overrides and D60
are not acquired. No process attribution/absence or live hold can follow.

Pure validation recomputes exact frozen binding, typed UID, four-stage presence,
complete key coverage, both boot and sweep equality, errors/failures and expiry;
stored verdict/reasons cannot control recording. Source/coverage/certification
claims are constrained. The real private canonical bounded file consumer forces
scripted provenance and retains only bounded source/coverage sample claims.
Raw argv is digested through the shared redactor and never serialized. The
optional shape control feeds a scripted sweep to the unchanged negative
comparator without claiming full integration. Reports say recorded/refused only.

Final local34 tests pass15.367s with one intentional CI-only native skip;
55 named intended-assertion mutants pass with intact controls and no ERROR-only
kill. Prior214 process/policy/envelope/class/held regressions pass42.920s with
no local skip. Earlier34-test6.862s and33-test13.948s runs retain their counts;
the final in-method extra sample-label control is included in15.367s.
Initial32-test7.074s run had one error: the unchanged redactor's equality shortcut
lets numeric0 resemble false until valid_job. The collector now invokes valid_job
immediately inside its primitive-failure bracket, recording malformed facts as
errors. The corrected32-test7.256s passed with the CI-only skip. No shared helper
was changed. The first mutation attempt stopped after one kill because a genuine
missing-domain assertion used a different needle; it is not a final full run.
Expected pairs now derive independently from the unchanged held-key helper.
The54-kill run predates the final bounded sample-label schema control;55 is the
final count. Per-domain/unit omissions require removal of the independent pair
coverage guard too; these are explicit two-replacement variants, not single
predicate kills. The live-CLI variant also deliberately relaxes flags and wires
the collector in, as283 required. Shared frozen/record/key preconditions remain
upstream proof, not newly counted predicates.

Delta: three new module/test/runner files, four workflow lines and six ledgers
including the B5 frontier row reconciliation. Existing executable/test/mutation
bytes stay fixed. Local plan-lint14 PASS/1 old idle-version WARN/0 FAIL.
Promised collection/schema/CLI/proof/registration/ledger deltas all land; no
Phase-8 scope expansion. Required source review and all8 exact-head CI remain
pending, followed by a separate five-Markdown reviewed green receipt before
this owned row closes. Native CI will measure only fixed-label job facts and
print actual outcome/error histogram; it need not record successfully. This is
not the earlier process full-scan evidence, which retains its original scope.
B5/1.2 remain open/pre,B6–B9 held; D64/Gate/installed timers/production unchanged.
Full hold/overrides/freshD60/process integration, durable admission/manual/D175,
Mac access/APFS/reboot/four-history acceptance remain separately gated.


### 2026-10-18 08:14 EDT — managed-job negative observation pre-audit candidate (D228)

Micro re-orient: B5/1.2 remain open/v1.2-pre, B6–B9 held.
D227 receipt2d54d6e9 and source6d2e9096 have clear289/285 reviews and
all8 CI39123687039/39121279608. Claude291 distinguishes its independent
source-native proof from Codex's later receipt-CI observations.
Current managed facts and scripted negative consistency exist separately;
this atom connects them without declaring a live hold or admission.

Goal: one negative consistency result over a validated managed-job observation.
Needs: D227 reviewed green source/receipt; unchanged managed.valid_observation,
owned_records, collect_jobs, held.compare_held_jobs, private readers and honest
frozen fixtures; B1/D189. All are present at2d54d6e9.
Feeds: overrides/freshD60, complete held-gate/process integration, durable
admission/manual/D175; no new production route or window authorization.
Verify: portable envelope-to-comparator and real owned consumer controls with
named assertion mutants; isolated CI native measurement without requiring a
positive; exact-source review/all8 CI, then separate reviewed green receipt.
Runtime: none in production; no local unpatched managed-label scan.

Pre-audit request292 is pending. Proposed source surface: new
managed_job_negative_observation.py plus test/mutation runner, four CI lines,
and these six source ledgers. Existing executables/tests/runners remain fixed.
No Journal/schema/recover/D64/Gate/identity/host/timer change. VERSION remains
v1.2-pre because the enclosing live recovery exit gates are not satisfied.

Proposed comparison first revalidates the complete observation against already
frozen-verified records, recomputes recorded/refused, then and only then passes
the proven complete, error-free, equal first sweep to unchanged held comparison.
Loaded idle/no-PID is recordable but cannot satisfy the negative comparison.
Input observation fingerprint, frozen binding, provenance/coverage and temporal
budget summary remain visible. Nested supplied-fact comparator scope/source
remain scripted; wrapper separately records observed or forced-scripted source.
All hold/history/admission certification flags stay false.

The real owned CLI requires fixture AND scripted before IO, reuses owned_records
for pin coherence, one reader/frozen verification and every metadata owner tied
to recordedUID, then reads the private canonical bounded managed-jobs.json.
File source claims remain untrusted sample labels; no CLI collector reference.
No constructor, state write or installation. The darwin+GITHUB_ACTIONS native
test path may compose the reader, collector and wrapper; that guard is an
isolation convention, not attestation. No native positive is assumed.

Risk/claim limits: this uses only the job30min acceptance budget and two boot-
bracketed sweeps, not a joint process/job window or a new age/freshness proof.
No current clock/boot reread in pure comparison, no baseline-boot expectation,
no continuous/physical exclusion or hold assertion. Blocked calls cannot be
interrupted by the budget. Unprotected supplied facts remain subject to D189.
Overrides/freshD60, strict process scope/attribution, durable admission/manual/
D175, Mac designation/APFS/reboot and four-history acceptance remain later.
Optional prior controls remain carried, not silently closed.


### D228 pre-audit settled — Claude293, before source work

Clear to implement pure composition, no new predicate beyond the recorded gate.
Validate before fingerprint/comparison. Malformed observations propagate refusal;
recomputed non-recorded returns phase observation, recomputed reasons, negative
null and never calls the comparator. Hash the exact received value after validation,
copy binding/source/sample_labels/coverage/budget from the recomputed copy.
Pass its first sweep verbatim; loaded-idle/running facts must refuse. Preserve
the nested comparator result exactly, including scripted scope/source; top success
is managed-jobs-negative-consistent only for its held-jobs-negative-consistent.
All top and nested admission/history/hold flags stay false. Missing/extra/unknown
nested buckets are empty by construction on recorded inputs, upstream proof,
not newly counted predicates. Raw input stages or sweep_b are equivalent on this
path and are not counted mutants. No live authority or authorship follows source.

Reuse one owned_records; fixture AND scripted precede IO. Keep the forcing block
textually identical to managed.inspect_owned, pinned by textual control. Test
frozen refusal before observation read, duplicate image reads, provenance loss,
and explicit two-replacement gate-relaxation/live-route mutant with benign census
and fixture-only CLI refusal/zero calls. No collector reference in real CLI.
Native darwin-plus-CI branch composes reader/collector/wrapper and records actual
phase/outcome/coverage/idempotence only. A negative-consistent runner observation
is a runner fact, not a node positive or hold evidence. No local unpatched scan.
Purity/no-input-mutation and observation idempotence controls are adopted; optional
loaded_keys summary omitted. No new job/process coherence, current clock/boot read
or freshness promise;30min acceptance window and blocked-call limits remain.
Source/receipt exact reviews/all8 CI required separately; B5/1.2 open/pre.


### 2026-10-18 08:19 EDT — D228 local negative-observation candidate proof

The new64-line wrapper validates first, then fingerprints the exact received
object and copies the recomputed frozen binding/provenance/coverage/budget and
boot bracket. Non-recorded returns refused/phase observation/recomputed reasons/
negative null, without a comparator call. Recorded passes the validated first
sweep verbatim to unchanged compare_held_jobs; only its exact negative-consistent
verdict yields top managed-jobs-negative-consistent. Loaded idle and running
facts refuse. The nested result, literal scripted scope/source included, remains
unchanged. Both layers keep admission/history/hold false; no raw job values or
argv/policy appear in the wrapper result. Input immutability and no-IO comparison
are controlled. No live clock/boot read or new temporal/physical guarantee.

Local final20 tests pass7.981s with one intentional CI-only native skip;28 named
intended-assertion mutants die with intact controls, no ERROR-only kill. The
prior248 tests pass35.246s with the managed observer's one CI-only native skip.
The first20-test run failed because the test helper treated explicit None as
its default valid input; the malformed test now calls the wrapper directly.
No source correction was needed. The intermediate20 run passed5.339s; final
7.981s includes the provenance Refused-to-assertion control used by the runner.
No failed/partial mutant run occurred. Live-route mutation has two explicit
replacements: gate relaxation plus collector wiring; not a single-predicate kill.

The real private frozen consumer uses exactly one unchanged owned_records,
then bounded canonical observation read and the textually identical source/
sample-label forcing block. Both flags precede IO; frozen refusal prevents the
observation-file read. Genuine foreign recorded owner refuses upstream, with
and without optional policy the honest fixture reaches the same narrow result.
Journal/Gate construction and live census are forbidden in consumer controls;
files remain identical before/after. Canonical stdout and all three CLI phases
have correct exit codes. The fixture-only CLI with benign census refuses and
makes zero census calls. No local unpatched managed-label scan occurred.

All six pre-audit/local blocks are identical across the source ledgers. Promised
deltas land: three new files, four workflow registration lines and six ledgers.
Existing executable/test/mutator bytes remain fixed. Local plan lint14 PASS,
1 old idle-version WARN,0 FAIL. Upstream full-record/coverage/shape predicates
remain earlier proof, not new kills. Raw-stage or second-sweep substitutions are
equivalent on recorded inputs, not counted. Optional loaded_keys omitted; prior
optional controls remain carried. B5/1.2 open/v1.2-pre,B6–B9 held.

Required exact-source review/all8 CI are pending, then a separate five-Markdown
reviewed green receipt before only this owned row closes. CI native composes
the real reader/collector/wrapper and prints actual outcome/phase/69-key coverage/
errors/elapsed, asserting shape/idempotence only; no native positive is assumed.
Any negative-consistent CI result describes only sampled runner facts, never
node readiness, live hold, process absence, disabled overrides, full inventory,
freshD60, eligibility/history/authorship/physical exclusion or admission.
Overrides/freshD60, strict process integration, durable admission/manual/D175,
Mac/APFS/reboot/four-history acceptance remain later. D64/Gate/timers/production
are unchanged. No Phase-8 scope expansion or production operation occurred.


### 2026-10-18 09:36 EDT — scripted entrypoint consistency pre-audit candidate (D230)

Micro re-orient: B5/1.2 open/v1.2-pre, B6–B9 held.
D229 receipt7cdd3ba8/source665ccdb4 have all8 CI39129315402/39126847156
and clear299/295 reviews; Claude301 acknowledges the evidence split.
Fixed managed-job negatives are connected to validated observations; inventory,
overrides and exclusion facts are not yet compared on the new diagnostic path.
This atom targets scripted entrypoint consistency, not fresh observation.

Goal: one scripted entrypoint consistency result against the frozen checkpoint.
Needs: reviewed green D229; unchanged inventory/exclusion validators, frozen
reader and honest fixture construction, full terminal CAPTURE facts; B1/D189.
All source prerequisites exist at7cdd3ba8. A nonempty exclusion must be recorded
through the honest fixture before its baseline, never injected after verification.
Feeds: separately reviewed current entrypoint observer/overrides/freshD60
measurement, full held/process integration, durable admission/manual/D175.
Verify: portable real frozen-reader positives/negatives and decisive named
assertion mutants; scripted native-CI portability only, exact source review/all8
CI plus separate reviewed green five-Markdown receipt. Runtime: no production.

Pre-audit request302 pending. Proposed surface: new scripted_entrypoint_consistency
module/test/runner, four workflow registration lines and six source ledgers.
No existing executable/test/mutator, Journal/schema/recover/D64/Gate/identity/
host/timer change. VERSION stays pre because the enclosing live gates remain.

Read-only source audit: valid_entrypoint_inventory binds baseline loaded and
disabled flags, so original prior cannot validate held current facts. Proposed
private expectation adapter copies baseline prior, replacing loaded/running/
disabled from already-verified terminal observations, then calls that unchanged
validator. No adapter is persisted or treated as a journal/baseline; its exact
role and soundness await302. Compare installed/roots/disabled artifacts to
baseline, loaded/overrides to terminal CAPTURE, all domains/all labels.

Proposed exact supplied input is boot/inventory. D60 current shape uses unchanged
valid_tailscale_exclusion; label set plus plist/wrapper identity equals baseline,
current excluded boot equals the supplied boot. Old dynamic app/run/boot facts
are not compared across boot. No live code/signature/launchd verification or
new age/freshness claim follows a shaped file. Empty exclusions must match
baseline emptiness. All source/hold/history/admission/freshness flags remain
fixed scripted/false. Hash only the exact supplied value after validation,
report binding/reasons without raw inventory/policy/argv.

Consumer proposal: fixture AND scripted before IO, one managed.owned_records
with coherent pins/one reader/frozen verifier/all recorded-owner ties, then
private canonical bounded entrypoints.json and pure comparison. No collector
reference, constructor or write. No local unpatched inventory/job scan.
Current observer timing/boot-coherence and privileged readability remain later,
not inherited from job30min or process120s envelopes. D189/unprotected provenance
still applies. Physical Mac/APFS/reboot/four-history gates remain separate.
Optional older controls remain carried, not silently closed. If adapter/fixture
proof is unsound or scope spans outcomes, split before source work.


### D230 pre-audit settled — Claude303, before implementation

The atom and private terminal-state adapter are sound. valid_entrypoint_inventory
uses prior only for installed plist digests, loaded-set expectation and disabled
override rules; copy only terminal loaded/running/disabled into a private copy.
Never persist it, call it a baseline or pass it to valid_prior. Exact terminal
override equality is additional to the shared true/not-true predicate and rests
on the stated premise that launchd's override database persists across reboot.
A previously unloaded/non-disabled RunAtLoad job starting at login must refuse,
correctly; this unit adds no permitted-start exception.

Decision: app drift refuses. Compare the full per-label app identity as well as
plist and wrapper to baseline; a Tailscale update requires a separately reviewed
new baseline. This conservative owned-comparator choice is made before source
work, not a production re-baseline operation. The proposed app-drift positive
is dropped before implementation. Only validated launchd dynamics (e.g. run
count) and boot may differ; current excluded boot must equal supplied boot.
Equal label sets are mandatory both empty/nonempty ways. A nonempty passing
input asserts not-running, runs>=1, exit0, disabledfalse in that supplied boot.
Those are supplied shaped claims, not observed/authenticated fresh D60 proof.

Order: exact outer schema/boot digest, explicit valid_tailscale_exclusion, then
unchanged valid_entrypoint_inventory over the private adapter, then fingerprint
exact received value, then compare. verifiedtrue is only a shape claim. Report
fixed scripted source, frozen baseline/checkpoint/recordedUID binding and named
field reasons without any raw inventory/overrides/exclusion/paths/policy/argv.
Hold/history/admission/freshness flags false. Consumer both flags before IO,
one owned_records, private canonical bounded file, no collector/constructor/
write. CI scripted portability only, no new native or local unpatched scan.

The pre-screen already proves the nonempty fixture viable: patch only guest
full_entrypoint_evidence to carry tailscale_record and a disabled-artifact hash
before original Journal creation; real capture/commit/stopped reader/frozen
verification succeeds through owned_records.23 managed labels/1 excluded label,
all3 loaded sets empty; private terminal adapter passes the shared validator.
No post-verification record mutation, real Tailscale/file signature measurement
or production operation. Temporary owned probe was cleaned.

Count only decisive named assertions with intact controls, never ERROR-only
kills. Loaded equality and installed digest comparison are dominated by shared
validation; running substitution is unused there. Copying the exact input before
hashing is equivalent because these validators do not normalize it; hashing
only inventory (omitting supplied boot) is the discriminating hash variant.
Copying terminal identity is also equivalent because frozen verification already
binds it; arbitrary fourth-field identity corruption must be detected, not
claimed as a permissive defect. Optional drift-only reporting is not adopted;
all mismatches refuse. Earlier optional controls remain carried.

D230 row stays candidate until source exact review/all8 CI and the separately
reviewed green five-Markdown receipt. B5/1.2 open/pre,B6–B9 held,D64/Gate/
installed timers/production untouched. Actual current inventory/override/D60
observer, full held/process integration, durable admission/manual/D175 and
physical Mac/APFS/reboot/four-history evidence remain later.


### 2026-10-18 09:49 EDT — D230 local scripted entrypoint candidate proof

The new80-line module shape-validates boot/inventory, explicitly validates D60
shape, calls unchanged valid_entrypoint_inventory over the private terminal
expectations, then hashes exact supplied input and compares. Installed paths,
roots and disabled artifacts match baseline; loaded/overrides match terminal
CAPTURE exactly; excluded label sets match and plist/wrapper/full app identity
match baseline. Current exclusion boot equals supplied boot. Changed valid run
counts/boot may pass; app SHA/version/cdhash drift refuses. Full maps preserve
none versus false and extra com.openclaw override keys in every domain.
No inventory/path/override/exclusion table/policy/argv is echoed. Fixed scripted
source, frozen digest/recordedUID binding and all four certification flags false.

Local final28 tests pass8.394s/no skip;39 named intended-assertion mutations
pass with intact selected controls/no ERROR-only kills. Earlier268 regressions
pass53.089s/two intentional CI-only native skips on this Mac. New native CI
coverage is scripted portability only, not live collection or fresh D60.
The honest nonempty exclusion/artifact fixture records them before original
Journal creation and reaches the actual capture/commit/stopped reader/frozen
verification path. Empty/nonempty and both policy cases work. The honest foreign
recorded-owner chain verifies as a frozen input for the pure binding control,
while the real owned consumer correctly refuses its reader UID mismatch.

## Mid-Implementation Findings — D230 fixture precondition

One fixture assumption in303 cannot occur under this head's full-node contract.
All prior-unloaded units are disabled: member1 held and federation tick required
disabled; known-broken Discord must be loaded, not disabled. First27-test run
errors8.777s with StopIteration searching for an unloaded enabled unit. The next
28-test run errors9.095s when a pre-baseline attempt to make Discord unloaded
is correctly refused by unchanged valid_prior. No bypass, rehashed invalid
fixture or post-verification record mutation is used. Replace that impossible
example with every managed-label start in all3 domains refusing against honest
frozen records. This is one precondition finding/two failed proof attempts, not
two source defects or scope expansions. The80-line source never changed.

The first39-kill run had intact selected controls but excluded the then-invalid
example; it was not evidence of a passing28-test suite. After fixture correction
the final full28 and a fresh39-kill runner pass on the same test bytes. Both
runs retain their actual counts.303's generic RunAtLoad forecast is qualified:
a future broadened baseline may allow it, but the current frozen precondition
does not. No new allowed-start exemption is added.

The terminal adapter preserves all other baseline fields and input immutability;
its identity-corruption variant is a contract/false-refusal control, not a claimed
permissive defect. Explicit exclusion removal/reversal pins call order; the later
inventory validator already repeats exclusion shape checking. Installed digest,
static exclusion path constraints and terminal loaded equality are dominated
shared proof, not extra single-predicate acceptance kills. Running substitution,
copying the full input before hashing and terminal identity substitution are
equivalents, not counted. Full-input hash versus inventory-only is discriminating.
The live-CLI variant explicitly relaxes flags AND wires a benign patched inventory
collector; fixture-only CLI refusal/zero calls kills it. No real CLI collector
reference, constructor, write or local unpatched inventory/job scan exists.

Promised deltas land: three new files, four workflow lines and six ledgers. All
pre-existing executable/test/runner bytes remain fixed. Pin/read/frozen verifier
and every recorded-owner tie are reused once before private canonical bounded
entrypoints.json and comparison. Input/capture/owner/flags/no-constructor/no-write/
CLI controls pass. Local lint14PASS/1old idle-version WARN/0FAIL. No Phase-8
patch or source scope expansion. Optional older controls remain carried.

Source exact review/all8 CI are pending, then separate five-Markdown reviewed
green receipt before this owned row closes. Exact override equality assumes
launchd override persistence across reboot; no live measurement certifies it.
Nonempty success supplies a completed successful run claim in the supplied boot,
without observing/authenticating it. verifiedtrue is shape only; no fresh D60,
current clock/boot read, process absence, live hold, eligibility/history/
authorship/physical exclusion/admission or protected provenance. D189 applies.
B5/1.2 open/v1.2-pre,B6–B9 held; D64/Gate/installed timers/production unchanged.
Actual inventory/override/D60 observer, full held/process integration, durable
admission/manual/D175/Mac/APFS/reboot/four-history evidence remain later.


### 2026-10-18 11:02 EDT — shared entrypoint whole-value scope pre-audit (D232)

Micro re-orient: B5/1.2 open/v1.2-pre; B6–B9 held.
D231 receipt60992e9e/source0aa1df7d are reviewed clear311/307 and
all8CI39135740710/39133265637;313 acknowledges the temporal evidence split.
Scripted consistency is available; current inventory observation is still open.
Its pre-screen finds the shared classifier can silently omit a relevant job.
Fix that bounded prerequisite before designing the observer envelope.

Goal: classify a whole path containing tokenizer delimiters before token scanning.
Needs: unchanged shared installed/loaded callers and classification contract,
owned symlink/hardlink/plist fixtures, reviewed green D231; all exist at60992e9e.
Feeds: existing installed_entrypoints/loaded_entrypoints/capture_entrypoint_inventory,
then the separate current inventory/override/D60 observer.
Verify: portable real owned-path and caller controls/intended-assertion mutants,
prior preservation/process/job/comparator regressions, native CI owned-path
portability, exact source review/all8CI plus separate reviewed green five-Markdown
receipt. Runtime: no unpatched production inventory/job scan or service action.

Pre-screen uses an owned canonical temporary root, neutral label org.fixture.neutral
and a binary under a protected directory. Program/argv is an outside symlink:
without space shared relevant=True and installed_labels contains the neutral label;
with space both shared relevance and unclassified_executable are False and installed
labels empty, although alias.resolve() has the protected root in its parents.
This reproduces a permissive omission inherited by the prospective observer,
not a defect in D230's supplied-value comparator. D216 corrected whole values in
process scope only and explicitly left this shared API unchanged. The first
noncanonical /var temporary-path probe did not establish containment on this Mac;
only the resolved-root rerun above is evidence. No production path was scanned.

Proposed delta: only relevant_entrypoint resolves each entire expanded absolute
or cwd-relative value with strict=False and the same equal-or-parents predicate
before retaining its existing substring/token scan. Preserve label prefixes,
HOME/environment expansion, source/application/system hardlink rules, embedded
flags/shell scans and nonpath negatives. Whole-value hardlink attribution should
use the same existing suspicious_hardlink rule, never a new exemption. No changes
to installed/loaded collectors, validators, Journal/schema/recover/D64/Gate/host/
identity/timers, or the already-reviewed process shim. Pre-audit314 pending;
settle exact whole-value and relative-path semantics before implementation.

Proof plan: spaces, parentheses, both quotes, semicolon/comma/pipe/ampersand/backtick,
absolute and cwd-relative aliases, equality and parent roots, expanded environment,
whole argument hardlinks, embedded-token fallback, managed prefixes, benign paths,
and actual installed/loaded callers refusing extras through shared inventory
verification. Owned filesystem inputs only; no native launchd mutation or global
scan. New test_entrypoint_path_scope.py and mutate_entrypoint_path_scope.py; four
workflow registration lines plus six source ledgers. Existing executable delta is
restricted to the one shared classifier; existing tests/runners remain fixed.

This corrects one membership false negative; it is not complete physical writer
coverage or fresh observation, process absence, execution hold, eligibility,
protected provenance, history/authorship or admission. All observer timing/boot/
recordedUID/native full-path measurement remains later. Prior optional controls
and the R3 placement follow-up remain open. B5/1.2 open/pre; D64/Gate/installed
timers/production untouched, four histories separate.


### 2026-10-18 11:13 EDT — D232 settled pre-audit and local path-scope proof

Claude315 independently reproduces the shared omission at60992e9e as uid65534
through the helper and both callers; the atom is the smallest useful correction.
Settled semantics, before source implementation: whole expanded absolute paths
or slash-relative paths joined to expanded supplied cwd; bare names are never
joined and no process cwd is inferred. strict=False intentionally includes
dangling aliases resolving into a protected root. Root matching is exact equality
or parent containment, never substring on the resolved value. Reuse existing
hardlink suspicion with both System-source and application-path exemptions.
Keep existing raw substring and token scans, prefix shortcut and expansion.
The D216 process shim retains its broader bare-name join unchanged.

Nine added lines in relevant_entrypoint implement exactly that rule. No other
existing executable changed; callers/validators/process shim/Journal/schema/
recover/D64/Gate/identity/host/timers remain fixed. A real future baseline may
newly refuse a neutral job reaching protected roots through a delimiter alias;
that is the intended rejection of extras, not a production observation here.
The existing installed/loaded callers reach the corrected shared helper now;
no parallel classifier or prospective observer envelope is introduced.

New test_entrypoint_path_scope.py has21 passing controls,0.155s/no skip on this
Mac. New runner kills17 named mutants by intended assertions with intact
selected controls and no ERROR-only kills. All twelve absolute delimiter
subcases fail on the parent helper with0errors. Whole-value-after-token order
passes all21 and is declared equivalent, not counted. Mutants include whole-step
omission/unresolved value/equality-only/parents-only/resolved substring/strict
existence/bare-name or implicit process-cwd joins/no relative join/no expansion/
hardlink removal or either exemption loss and fallback/prefix losses.

Owned real symlinks and hardlinks exercise exact-file and parent roots, all
tokenizer delimiters plus tab/newline, relative cwd/environment/home expansion,
dangling targets and prefix siblings. Real installed caller uses owned plists;
loaded caller uses supplied launchd text/inspect stub with subprocess blocked.
Program/argv/cwd and loaded environment values reach the whole rule. The installed
caller expands referenced environment variables; it does not scan unused
environment values, which remains unchanged. Both discovered extra-label sets
refuse through unchanged inventory verification as controls, not extra kills.
No new native launchd call or unpatched inventory scan is performed locally.
Native new-unit CI is real owned filesystem portability only.

Declared limits: an embedded --flag= delimiter alias stays token-only/False;
slash-relative without cwd staysFalse; nonstring values skipped; over-NAME_MAX
values do not raise. The pre-existing raw substring rule may over-include raw
prefix siblings, while a delimiter alias resolving to a prefix sibling correctly
staysFalse. Supplied roots are resolved and home is explicit/owned. Newline is
covered directly and through plist parsing, but the existing loaded text parser
loses embedded newlines and that caller's delimiter matrix excludes newline.
No full classification/completeness, physical writer or fresh D60 claim follows.
Optional later removal of the now partially redundant process shim is carried,
not implemented. Existing R3 placement and older optional controls stay open.

Prior Gates/process-policy/envelope/class/job/entrypoint regressions:311 pass
45.650s with two intentional CI-only unpatched native skips; no failed control.
All pre-existing tests/runners are fixed. Delta: one existing function, two new
proof files, four workflow registration lines and six ledgers. One workflow edit
invocation initially used the step directory and found no relative workflow
path; it changed nothing, then was applied from checkout root. No source repair
or proof-failure claim follows that invocation.

D231 receipt60992e9e independently clear311/source clear307 with all8 ownCI
39135740710; source CI39133265637 resolves attempt2 with only Linux re-executed
and the seven original successes carried, not relabelled new executions. Its
original placement failure and local-control limits remain.313 acknowledges
the evidence split. This D232 candidate needs exact source review/all8CI and
then a separate reviewed green five-Markdown D233 receipt before row closure.
B5/1.2 open/v1.2-pre,B6–B9 held. Current observer/override/freshD60, full held/
process integration, durable admission/manual/D175 and Mac/APFS/reboot/four-history
evidence remain later. D189 applies; production and installed timers untouched.


## Mid-Implementation Findings — D232 process mutation redundancy

One required proof interaction was exposed by exact source488ad0cf's Linux CI
39139556698/job117710977048: the existing process runner's first mutant no
longer fails because the new shared helper rescues the removed process-shim
parent check. New21/17 was not reached in that job. Raw failed log83687bytes
SHA2560a2d6f07d9565620ed039befbef4a107f12d9f59d03894a83d38a42be2c8f7a8
is retained; no rerun or all8 claim. This is not the old R3 placement failure.

Fresh local audit of all29 prior mutants finds27 intended assertion kills,
exactly two surviving variants and0invalid/error results. Those are whole-
argument-directory-root-skipped and whole-argument-path-skipped. Each also
passes the full40 process tests (0.832s and0.198s, no skip locally). The two
previous single-site kill claims are no longer independent with the shared
whole-value rule; historical D21729-kill evidence at its old head stays true.

Re-orient before correction: retain the production process shim and every
existing assertion, keep the new21/17 proof fixed, and revise only the old
mutation runner to classify these two as explicit expected-pass redundant-
branch controls, never kills. Count27 remaining old process kills separately;
no manufactured two-site variant or silently retained29 claim. This is a
necessary proof-only exception to the earlier old-runners-fixed promise,
not observer or production scope expansion. Claude318 assessment pending.
New source head after this narrow proof/ledger correction must obtain fresh
exact review/all8 CI before the separate D233 receipt. Original failure is
retained. Current observer, B5/1.2 and physical gates remain open; production,
D64/Gate/installed timers unchanged.


### D232 proof re-orient settled — Claude319, before corrected head

Micro re-orient: one shared classification outcome, nine runtime lines unchanged.
CI failed a redundant old proof claim;319 confirms the structural rescue.
319 also requires a real-cwd control for the natural absolute-gate mutant.
Both are proof-only corrections within the same narrow outcome, settled before
the corrected commit; no observer or new runtime outcome is added.
B5/1.2 open/pre; physical and production gates stay held.

319 independently reproduces21new controls/17kills as uid65534 and all315
path/caller probes. Parent replay gives34failures/0errors across the full new
suite, including12absolute and12relative subcases; Codex's selected-parent
12absolute failures remains narrower separate evidence. It verifies all29old
variants:27kills/2survivors/0errors; both survivors pass40process tests and
fail again with the parent shared helper (18/36failures). Executable/cwd rows
are validated absolute, and every relative argument is appended cwd-joined
before the shared fallback, so all shim candidates reach the new shared rule.

Necessary exception: mutate_scoped_process_diagnostic retains the two exact
replacements as expected-pass selected-test controls. Its unmutated controls
still include them, all existing assertions and production shim remain fixed.
It now reports27intended process kills plus2redundant-branch passes, not29kills.
New shared-helper mutations remain separately counted. Local full-module passes
for each redundant variant are40/0.832s and40/0.198s; CI expected-pass checks
use the selected delimiter test, avoiding extra unpatched native census runs.
Historical D21729-kill proof remains attributed to its original source.

319's second required proof correction: replacing the absolute gate byTrue
survives the original21 tests because Path.resolve uses actual cwd, not the
mocked Path.cwd. The same existing test now changes into an owned real cwd and
registers restoration before temporary cleanup; the natural mutant fails its
intended assertion. This is false in-scope classification (and possible false
refusal downstream), not an admission bypass in the committed source. The
optional raw-versus-expanded slash control is also adopted inside the existing
relative test; its natural variant now dies independently. Test count stays21.

Corrected local proof:21controls0.064s/no skip;19new intended-assertion kills
with intact selected controls/noERROR; old runner27kills plus2expected-pass
controls. Nine-line helper and every other runtime executable remain byte-
identical to488ad0cf. The earlier311regressions45.650s/two CI-only native skips
remain valid at those unchanged runtime bytes and are not relabelled a new run.
Whole-after-token order is an equivalent, not counted. Passing a resolved path
to the hardlink helper survives these controls and is not counted; no universal
claim is made about spelling-dependent application exemptions. No shim cleanup.

319 reproduces the complete failed Linux943-line log and its Codex byte count/
digest, confirming Python ran and the first old mutant survived15commands
before the new unit. This initial CI is not green; no retry of it is requested.
Its prior-regression replay was34of40 with missing sandbox NATS and the old
mutator exits when reported, not a claimed311replay. The corrected head needs
its own exact review/full CI; only then D233. D64/Gate/timers/production fixed.


### 2026-10-18 13:14 EDT — owned cluster group-readiness pre-audit (D234)

Micro re-orient: B5/1.2 open/v1.2-pre; B6–B9 held.
D233 receipt b0d55130/source4abd6360 have clear325/321 reviews and all8 CI.
Current inventory observation remains open; repeated owned fixture failures impede CI.
Split the two symptoms: fix group settling only; peer placement remains undiagnosed.
This unit makes the existing owned test wait for its existing acceptance requirements.
Still the right bounded prerequisite: yes; no production mechanism or admission.

Pre-screen: exact clean parent b0d55130; existing capture and owned three-server
fixture available; local NATS2.12.6/Node24.13.0 available. Retained receipt CI
39144200140 attempt1 Linux117724597070 fails the unchanged nonempty $G leader
assertion after stable-table settling, with cleanupFailures[]. The source loop
can finish with an unchanged but invalid table: stable groups alone do not imply
$SYS/$G presence, two account groups, or nonempty leaders. This source mismatch
is demonstrable with scripted captures; the retained CI log contains no table
and cannot prove which intermediate state caused its failure. No root-cause
claim for peer-offline placement or real NATS convergence follows.

Goal: one independently verifiable outcome: the existing owned replication
fixture cannot finish its settling loop until every sample meets the unchanged
post-loop requirements continuously for the existing one-second stable interval,
within the existing ten-second deadline. Missing/empty groups or empty leaders
reset stability, as do changed group tables. Preserve capture refusal behavior,
the exact final assertions, QuietWindow, real election and own-process cleanup.
Timeout retains the last full capture and raises an assertion; no wider timeout,
stream-create retry, monitor-parser change, production scan or operation.

Section6 file deltas: extract only the existing settle loop into a test-local
wait_for_groups(ports,root) function in test_preservation_cluster.py and call it
from the same place. New test_cluster_group_readiness.py scripts capture/time
without network, covering invalid-stable timeout, eventual valid convergence,
per-member failures, regression/reset, changing tables, capture refusal and
last-observation timeout evidence. New mutate_cluster_group_readiness.py requires
intact selected controls and named assertion failures, never ERROR-only kills.
Four registration lines in .github/workflows/test.yml run the new portable
suite/runner on Linux22 and native macOS. Existing real cluster remains its Linux
consumer; run it once locally against three own loopback servers with normal
cleanup. Six ledgers document candidate/proof and boundaries. All other existing
executable/test/runner bodies stay fixed. Only a source-ready owned prerequisite
may close after exact review/all8 CI and a separate reviewed green receipt;
B5/1.2 and placement follow-up remain open. VERSION remains v1.2-pre.

Risks: a valid table can regress while settling, so invalidate the clock rather
than accumulating disjoint ready samples. The table is sampled, not continuous
physical evidence. The test-local extraction must actually feed the real test;
prove call placement and leave final assertions byte-identical. Missing monitor
keys must be treated as not ready in the scripted predicate without weakening
capture's strict parser. Root timeout evidence is fixture-owned; no raw token
or config copied. No feature deployment/service restart applies to this test-only
unit; actual owned test execution plus CI is its runtime, not serving services.
D64/Gate/installed timers and production remain untouched; no retry-as-proof.


### D234 pre-audit settled — Claude329, before implementation

329 inspected exact b0d55130 without subagents and clears the atom with pins.
Adopt all four existing conditions per member and no agreement/extra readiness
rule; valid identical second sample starts the clock, invalid/change resets,
previous always advances. Preserve sample-then-check deadline semantics: a batch
started before10s may finish and succeed after10s; three unchanged capture calls
can overrun by about6s. This is a polling deadline, not a hard wall-clock bound.
Inject clock/sleep only on the test-local helper; real call passes neither.
Timeout now records full last captures, named failed conditions per member and
last reset cause (invalid/change), also in its assertion. Refused propagates.
AST proves exactly one call/result feeds unchanged final assertions; Linux real
cluster and one own Mac run are live proof, native new suite is scripted only.
Keep syntax Python3.9 compatible. The explicit missing-$G predicate is logically
dominated for acceptance by the >=2 count, but its named evidence remains
independently testable; no false independent acceptance-kill claim.
Parent extracted-loop replay with stable two $G groups/empty leaders reaches
its final assertion at1.05 scripted seconds/66captures, no network. First replay
used a three-port list instead of fixture's nine-port layout and raisedIndexError;
that harness error is corrected and never counted as proof or mutant kill.
No peer-placement root cause inferred, no timer/deadline constant change.


### 2026-10-18 13:23 EDT — D234 local group-readiness candidate proof

Landed only the test-local wait_for_groups extraction/call, two new proof files,
four workflow lines and six ledgers. Final four assertions, creation readiness,
QuietWindow/election/cleanup, preservation_checks and all production code stay
fixed. Returned full captures feed the one real call with no injected clock or
sleep; the portable AST control pins that tie.13controls0.282s/no skip and
22 intended-assertion mutants pass with intact selected controls/no ERROR-only
kills. Scripted cases cover all four original conditions on every member, empty
and single groups, None/empty leaders, eventual convergence, invalid regression,
valid changes, exact original polling/stability/deadline, completion overrun,
no-sample timeout, full evidence, Refused identity and no added member agreement.
The missing-$G condition's counted mutation tests its diagnostic reason; it is
not an independent acceptance gate beyond the >=2 count. Removing only the
invalid-sample clock reset while retaining valid-change reset passes the earlier
12-test suite and is a logical acceptance equivalent, not a kill: next valid
sample necessarily differs, then resets. Both resets remain in source; removing
change reset or all resets dies. Source has no new readiness/member agreement.

One actual owned Mac cluster run on NATS2.12.6/Node24.13.0 passes1test3.626s,
normal three-process shutdown/cleanupFailures[], only random loopback ports and
own credentials/routes. Owned root openclaw-preservation-cluster-xr8694ws;
raw 312bytes SHA256b7c80ce4ef0eddd6f8f7d34d5fcab67dd08d1effc115c735872ba02e1c5c4190.
This exercises the actual helper/QuietWindow/election consumer, not a Linux
failure reproduction, deployment or proof of the retained failure's cause.
Unchanged preservation_checks regressions23tests3.286s pass with three owned
servers/cleanupFailures[]/noProductionConnections true. New macOS CI lines are
scripted only; the existing Linux cluster line supplies real CI execution.
Local plan lint14PASS/1old idle-versionWARN/0FAIL. No timeout extended and no
stream-add retry; the peer-offline placement follow-up stays open.

First local candidate proof failed one floating-point exact boundary expectation
(1.65 became1.7 at the same >=1 comparison) and one AST harness dedent over the
existing multiline JS string. Fixed only tests: permit one existing poll step
of rounding and parse the full module before selecting the consumer AST. Neither
failure is a source defect or counted mutant. No source expansion followed.

Committed candidate digests:
- test_preservation_cluster.py: 5ece2bec768b00d378204103a54c8bc599e55171ed466a1206f18b00b7d47ef6
- test_cluster_group_readiness.py: 547e2e253e538b99c664f2d4fc4f70eef44e7a89d215660ff95fd460fddf875b
- mutate_cluster_group_readiness.py: f679065dac56bde434fb17124913a5bc0813ec69eab2b03a3a6b3d545937bf6a

Source exact-head review/all8CI remain pending; only after those a separate
reviewed green five-Markdown receipt may close this auxiliary row. B5/1.2
open/v1.2-pre,B6–B9held,D64/Gate/installed timers/production untouched. Current
inventory/override/D60 observer, integration, admission/manual/D175 and physical
reboot/history work remain later. This does not close B5-CI-R3-placement.


### 2026-10-18 14:48 EDT — owned placement-gossip diagnosis pre-audit (D236)

Micro re-orient: B5/1.2 open/v1.2-pre; B6–B9 held.
D235 source08f90df7/receipt6df6c8b6 are clear331/333 with both all8 attempt1 CI.
Group settling is corrected; peer-offline placement diagnosis remains separate.
This unit measures one candidate sufficiency gap in the unchanged placement gate.
It serves trustworthy owned recovery evidence, never a production stop/admission.
Still the right next unit: diagnosis before proposing a readiness repair.

Pre-screen: clean parent6df6c8b6, existing NATS2.12.6/Node24.13.0 and owned
fixture available; no BLOCKED.md. Retained CI39133265637/job117692584463 fails
at cluster-offline-consumer-placeholder after the fixture's current waitCluster;
no forensic root artifact was uploaded. Prior failure cause remains unproved.
Official tagged NATS sources show placement consults peer configuration/statistics
in addition to metadata replication; existing eight Raft/route checks do not
inspect that cache. Source-level sufficiency gap is a hypothesis for the old
failure, not its observed cause. The installed binary accepts a route permission
rule denying only $SYS.SERVER.*.STATSZ; parser-only check started zero servers
and made zero connections. No actual fault/control pair has run at this point.

Goal: produce bounded owned fault/control evidence testing whether the unchanged
placement gate can accept while R3 placement reports peer offline. Run a fresh
three-node normal control and a fresh three-node cohort differing only in the
STATSZ route-deny rule, with random loopback ports, own private tokens/routes,
no advertise and production-port exclusions. Reuse the exact source of the
existing placementState/waitCluster; no duplicate classifier or dynamic eval.
Attempt create once per cohort only after the unchanged gate passes, retain full
ready facts and exact API error/phase-local debug selection reasons, then require
normal own cleanup. A gate timeout, wrong refusal, or failed cleanup is an
inconclusive/failing experiment, never a counterexample. No creation retry or
sleep-based repair. A reproduced counterexample establishes only this owned
sufficiency gap; it cannot identify the historical CI interleaving.

Section6 intended deltas: six candidate ledgers and one auxiliary diagnosis row
first; private scratch probes during pre-screen, with no source-gate change.
After the owned result and Claude336-request pre-audit are reconciled, promote
only useful reproducible evidence: fixture-local shared extraction of the two
unchanged readiness helpers, an owned placement-gossip probe, its meaningful
controls/intended-assertion runner and explicit CI registration/evidence retention.
Pin exact file set and checks before promoting source. If the proposed fault
cannot isolate the gap, record that negative and re-orient rather than widening
the experiment or claiming a repair. All production modules, D235 fixture and
assertions, D64/Gate/installed timers stay fixed. No production connection,
service/VM operation, resource provisioning, admission or B5 closure.

Risk register: route filters may prevent metadata discovery itself; then no
counterexample exists from this method. Route visibility and Raft current flags
do not certify placement cache contents. Additional application connections may
be needed to make discovery explicit; if used they must be identical in control
and fault and declared as a different sequence from the historical CI. Debug
logging is owned only; evidence must exclude configurations/tokens and identify
its log window and truncation. A fault must not be "validated" only by a parser;
require observed behavior and single-attempt accounting. Cleanup failures always
invalidate live proof. Exact-head review/all8 CI and a separate reviewed green
receipt are required for any source prerequisite closure; original placement
repair and current observer remain open at this pre-audit.


### 2026-10-18 15:01 EDT — D236 pre-audit settled after owned pre-screen (Claude339)

337 confirmed the upstream cache/readiness mechanism but predicted a possible
miscellaneous-error outcome unless a connections event first creates bare peer
entries. Actual first owned pair at owned-placement-gossip-mIhOJi does generate
those events: one ordinary own connection to EACH member before the old gate,
identical in control/fault. Fault denies only $SYS.SERVER.*.STATSZ in import and
export of ALL THREE owned members. Old eight checks all pass in both; control
creates once; fault creates once and returns400/10005/peer offline. Leader2's
create-window log discards member1/member3 as offline, required3/found1/peers3,
offline:true/misc:false. Both cohorts shut down normally with no cleanup failures.
Initial report81477bytes SHA256d060942c1b5b5fc4ea882f65119fac46f07367a40eef0eb00b1e47097b3fce1c.
This is the nil-config/statistics discard branch, not a historical CI cause;
the filter and extra per-member connections are deliberate injectors absent
from that historical sequence. No natural trigger, protected provenance or
readiness repair follows. Initial scratch module copied exact source bodies
into an owned static module; it used no eval and changed no repo executable.

339 accepts this narrower observed scope and drops the new system-account RPC/
authentication-domain expansion. Adopt byte-exact placementState/waitCluster
extraction into fixture-only placement_readiness.mjs, imported by original test
and probe; all original callsites/placementCounterexamples fixed. Add synthetic
eight-counterexample controls, source/caller pins and intended-assertion runner.
Promoted probe requires both ready tables, exact NATS2.12.6/10005 wording,
create-window leader discard lines for every other peer and offline:true/
misc:false summary, exactly one create each, separate own roots/ports/tokens/
passwords, sequential execution and normal complete cleanup. Any other result is
inconclusive, never reproduction. Preserve old15s readiness deadline and every
original create/timeout/retry behavior. Four CI registration command lines run
the new suite/runner on Linux22 and MacNode22, including a real owned pair on
both; two always-run JSON-only evidence retention steps preserve the report,
not configurations or raw logs. No new CI job or production deployment.

Final section6 file set: original test_recovery.mjs (only two definitions moved
and one import), new placement_readiness.mjs, probe_placement_gossip.mjs,
test_placement_gossip.mjs and mutate_placement_gossip.mjs; .github/workflows/test.yml
(four command lines plus owned JSON retention), six ledgers. All other existing
bodies, D235 checks, production and VERSION remain fixed. Exact-head review/
all8CI and separately reviewed green five-Markdown receipt before auxiliary
closure. Original B5-CI-R3-placement repair/current observer stay open.

Counter instrumentation pre-screen: upstream jetstream_api.go records total/
errors on the server sending the API response, before publishing it. The create
may be answered by a member other than the connected member. Therefore retain
all three members' /jsz counters before/after the create (after manager setup),
including connected member separately; measure which responder increments and
reconcile339's connected-member delta pin against actual data before commit.
Do not assume local forwarding is counted. No API call is retried to obtain a
preferred counter result. A counter mismatch makes the probe inconclusive.


### 2026-10-18 15:17 EDT — owned placement-gossip source candidate (D236)

Claude341 independently checked tagged jetstream_api.go and corrects339 pin4:
API totals/errors increment per account on the responding server, not necessarily
the connected member. All three before/after rows are identity-bound to ready
server IDs; aggregate totals must rise exactly1 with errors0 control/1 fault,
every member delta nonnegative. Connected member and counter-increment member
names are retained separately. Counters alone do not prove who answered; the
fault's leader debug window is the causal branch evidence. In the first measured
candidate, connected member1 stays flat in BOTH cohorts: control member3 total0→1,
fault leader2 total1→2/errors0→1. No request was repeated to get a preferred delta.
341 accepts two JSON-only always-run artifact steps in addition to four commands.

Final local suite:30/30 pass,0 skips,1341.638125ms on Node24.13.0/macOS;29
portable checks plus one real owned pair using NATS2.12.6. Unmutated portable
controls pass;28/28 named intended-assertion kills: eight old-gate predicate
omissions,12 evidence-acceptance omissions, one-peer/window/summary omissions,
both counter identity bindings, connected-member-only and first-row-only sums.
These are fixture/proof-contract mutants, not production admission defects.
Final full report87319bytes SHA256
57157b665e5f848faa7cdbe1728036276461a4cfb92ae0e4f40916e0121019fb.
Root owned-placement-gossip-N1Oxd1: both eight-check tables true; control creates
once, fault creates once and returns exact400/10005/peer offline. Fault leader1
window8535..9043 contains both other-peer offline discard lines and required3/
found1/peers3/result1/offline:true/misc:false. Aggregate request deltas1/1,
errors0/1; all six owners exit0 with Server Exiting, no cleanup failures.
Independent unfiltered original test_recovery fixture also passes, owned root
openclaw-jetstream-fixture-XPh6Xl, allOwnedServersStopped:true; its output6375bytes
SHA25672286662981609e94d75bdc915d9b21f25e6e7716e605239b92ec517aca86be1.

Local corrections retained: an initial mutant-runner guard rejected the correct
named assertion because Node formats error text as a multiline YAML block; the
guard now accepts that exact block as well as a quoted scalar and still requires
ERR_ASSERTION/status1. Initial negative name-selection pattern unexpectedly ran
the real pair as part of its30-test success; portable selection now uses an
explicit positive prefix and the runner asserts no live-report marker appears.
There were four owned pairs during development: initial scratch, first measured
candidate, that intermediate suite and final suite; every cohort attempted only
one create, every pair succeeded as a counterexample with normal cleanup. These
are distinct instrumentation/validation stages, not retries of a failed create.
An extraction-check mismatch was only removed-definition newline accounting;
removing each exact old definition plus its terminating newline and the new
import makes the remaining original caller byte-identical, including every
placementCounterexamples/callsite. Helper body hashes are pinned by the suite.

CI registers the pair/runner before the old Linux recovery fixture, and before
the D235 group controls on macOS; no prior command/body is altered. Both platforms
now execute a real ephemeral six-server sequential pair. Artifact paths name only
the private JSON report, excluding configs/tokens/raw logs. Four commands plus
15 artifact lines,19 workflow additions total. All production executables,
lib/bin/test/workspace-bin trees and other existing step12 bodies remain fixed.
VERSION staysv1.2-pre; source exact-head review/all8 CI and separate five-Markdown
receipt review/own all8 CI are still pending at this candidate. Diagnosis auxiliary
stays[A]; original R3 placement repair and natural trigger/current observer remain
open. No B5 closure, D64/Gate/timer or production operation.


### 2026-10-18 16:30 EDT — placement proof cardinality re-orient (D238 pre-audit)

D236 sourcefa9f0a4a is clear343/all8CI39158146598; D237 receipt52f31d88 is
clear345 but its OWN CI39161190466 failed attempt1: seven jobs success, native
117774685858 fails only leaderReason. No rerun. Reopen the auxiliary diagnosis
closure until a corrected exact head and separate receipt both satisfy review/CI.
Source's successful evidence remains valid, and this failed history is retained.
B5/1.2 staysopen/pre; B6–B9 held; production/D64/Gate/timers unchanged.

Failed native report87278bytes SHA256
030d5f024aa9f64344f76987abba1e0f1107c3679c2fbea224d5217634b73cd0,
artifact12149732321 (JSON only). Full failed log127193bytes SHA256
0f856e2a4ccc6e01df92ebbecea3d78f89d505f06d97178d6967a43d33d0db44.
Both old eight-check tables pass, control creates once, fault returns exact
400/10005/peer offline, aggregate counters total1/1/errors0/1, six owners exit0
normally, empty cleanup. Fault leader2's create window8819..9433 contains exact
offline discard lines for member2 ITSELF plus member3/member1, then required3/
found0/peers3/result0/offline:true/misc:false. Comparator requires found1/result1,
so honestly reports inconclusive and fails. No failed evidence is called a win.

Tagged NATS2.12.6 selectPeerGroup iterates the peer list without a self exemption;
its nil-cfg-or-stats guard emits this exact offline line. Our source proof assumed
self cache was filled and only the two other peers could be discarded. The log
shows that assumption is unnecessary for the intended nil-cache sufficiency
counterexample. How self stats became absent is not established here; historical
unfiltered CI trigger is still unproved. This is a proof-contract correction,
not a new readiness rule, retry, delay or production admission.

Proposed next atomic outcome: accept either fully evidenced partition, two known
other-peer discards plus remaining1, OR all three known-peer discards plus
remaining0, only when the named ready leader owns the create-window log, every
other peer is discarded at the exact pinned site, discard names are unique/known,
and the single summary's required3/peers3/found/result counts agree with that
partition, offline:true/misc:false. Wrong/missing/duplicate/foreign discards,
contradictory counts or reasons still refuse. Retain the original two-discard
positive and add a three-discard positive plus independent conservation negatives
and intended-assertion mutants. No post-create resampling to pick another window.

Section6 prospective files after Claude review: probe_placement_gossip.mjs,
test_placement_gossip.mjs, mutate_placement_gossip.mjs and six ledgers. Shared
placement_readiness.mjs, original test_recovery, workflow, all other executables
and VERSION fixed. Local portable/mutant/one-real-pair proof, exact source review/
all8CI then separate five-Markdown receipt review/own all8CI required. PR remains
draft. Original placement repair/current observer/natural trigger remain open.


### 2026-10-18 16:36 EDT — D238 partition pre-audit settled (Claude347)

347 independently reproduces the complete failed native1028-line log,127193byte
hash, three-discard leader2 window and every other passing gate/normal cleanup.
Tagged source creates self nodeInfo with cfg nonnil/stats:nil. Its own STATSZ send
fills stats, under a one-second rate limiter; first heartbeat250ms can precede
JetStream loading and discovery-triggered sends share the limiter. Peer selection
includes self with no exemption. This supplies a second LOCAL producer of the
nil-cache state, independent of route denial. The freshly started/elected leader
window is a natural-trigger candidate, not proof of the retained historical cause.

Adopt exact known-peer partition and conservation pins from347: both nonleaders
required, leader optional, unique known names, no unpinned line/reason, exactly
one summary, required3/peers3 and found=result=3-discardCount, offline:true/
misc:false. Keep two-discard positive and add actual-shaped three-discard positive.
Independent negatives include single nonleader, leader-only, self plus one other,
foreign/duplicate names, two summaries, every inconsistent count and unknown
reason/line. Count forced-one, dropped conservation, single-discard acceptance,
foreign/duplicate acceptance, summary uniqueness and leader-only mutants only at
named assertion failures with intact controls. No original helper/fixture,
workflow, injection, create, counter, cleanup, timeout or production change.


### 2026-10-18 16:38 EDT — D238 local partition correction candidate

Only leaderReason changes in the probe: complete known/unique offline-discard
partition from the named leader, no unpinned line, one summary with required3/
peers3/found=result=3-discardCount and fixed flags. Both other peers mandatory;
self optional. Two-discard/found1 and three-discard/found0 are accepted, while
single peer, self-only/subset, foreign/duplicate names, duplicate summaries,
unpinned reason/line and every inconsistent count refuse. Producer, helpers,
original fixture, workflow, VERSION and all other code remain byte-identical.

Local Node24.13.0/macOS proof:45/45 pass,0 skips,1703.582084ms;44 portable tests
and one actual owned NATS2.12.6 pair.34/34 named intended assertions killed with
intact portable controls/no live cohorts in the runner. Old one-peer variant is
replaced by a targeted single-nonleader case; six distinct additions kill forced
remaining1, dropped conservation, accepted foreign/duplicate names, dropped
summary uniqueness and leader-only acceptance. No equivalent mutant is counted.
The final actual pair takes the two-discard form at leader3, both old ready tables
true, exact fault10005, one create per cohort, normal six-owner cleanup[].
Report87328bytes SHA256
432603f113d684d349bbe2ab88a9f82a5e61b2e52a54f37d0324d3c32269e2c5.
The retained failed native JSON is also replayed READ-ONLY through the corrected
comparator: all12checks true/owned-counterexample, including its three discards;
original bytes/hash and its old inconclusive diagnosis are untouched. This is
regression replay, not a rerun or a retroactive green claim for CI39161190466.

Shared helper/original caller hash pins pass. Exact source review/all8CI and a
separate reviewed green five-Markdown receipt remain pending. Diagnosis row[A]
stays reopened; original placement repair/natural trigger/current observer remain
open. B5/1.2pre, B6–B9 held, D64/Gate/timers/production unchanged. Failed D237
native history and successful D236 source history remain separately retained.


### 2026-10-18 17:54 EDT — owned R3 failure evidence pre-audit (D240)

Micro re-orient: B5/1.2 is open at v1.2-pre; B6–B9 remain held.
D239 closes only the injected placement diagnosis with reviewed, green owned proof.
The original unfiltered R3 CI failure still has no phase-local selector evidence.
This unit records that evidence if the owned fixture fails; it does not repair placement.
It feeds the separate B5-CI-R3-placement decision without a production operation.
Still the right next bounded step: yes, because a repair now would guess the old cause.

Pre-screen: source/receipt 5e931120/7dd079d0 are reviewed clear at Claude349/351,
each with all eight CI jobs successful on attempt 1. The worktree is clean and no
BLOCKED.md exists. NATS 2.12.6 selectPeerGroup reads cached peer cfg/stats in
addition to the eight observable route/Raft checks; tagged events.go fills the
cache after STATSZ updates. The old unfiltered CI logs have the API error and
phase, but no selector window. One separate owned unfiltered startup/create
attempt at 17:52 EDT passed with one APP connection, all three normal exits and
no cleanup failure; this is a negative observation, not a historical replay.

Goal: on a failed R3 stream creation in test_recovery.mjs, retain the exact
phase-local owned server log windows and the pre-create readiness observation,
while rethrowing the same error and making no second create attempt. A bounded
private JSON report contains only generated member names/IDs, readiness checks,
known error codes, log offsets and selector lines; no credentials or raw configs.
No readiness predicate, server setting outside the owned fixture, timing,
stream config, recovery mechanism, production path, or create retry changes.

Section 6 prospective delta: fixture-only evidence helper in the existing
placement_readiness.mjs, consumed by all four R3 add sites in test_recovery.mjs;
enable debug logging only on this owned fixture's three servers. Add a portable
negative/positive suite and intended-assertion runner for exact window, no retry,
bounded redaction and original-error behavior; register them on Linux and macOS.
The existing owned placement fault/control probe remains a separate proof and
retains its source and report shape. Add an always-run JSON-only CI artifact for
the failure report, uploaded only if an R3 failure occurs. Six ledgers describe
the scope; VERSION remains v1.2-pre and B5/1.2 stays open.

Verify: scripted pure and fake-manager failure controls, including no duplicate
call and no report on success; run the unchanged unfiltered owned recovery test
once with normal cleanup, then exact-source review and all-eight CI. The failure
path must be exercised by a controlled owned fault without repeating the failed
request. A later five-Markdown receipt gets separate review and all-eight CI
before only this auxiliary row closes. The original B5-CI-R3-placement repair,
natural historical trigger and current inventory/override/fresh-D60 observer
stay open; D64, Gate, installed timers, VMs and production remain untouched.


### 2026-10-18 18:02 EDT — D240 mid-implementation finding

The pre-audit's unchanged-probe-source assumption was too narrow. The existing
controlled STATSZ-denied probe is the only owned, reproducible R3 refusal, so it
now calls the same failure-evidence helper once at its existing create site. Its
report schema and comparator remain unchanged; on the fault side it additionally
writes a private failure report. This also updates the portable original-caller
source hash pin and adds an assertion comparing the helper's selector lines to
the probe's already-retained window. No readiness predicate or second request
was added. Debug logging is enabled only for the three owned cluster servers in
test_recovery.mjs. The original unfiltered CI cause remains unproved.


### 2026-10-18 18:08 EDT — D240 source candidate and owned proof

The four owned R3 creation sites use one evidence helper. The helper snapshots
log offsets immediately before each one-shot create, records the last successful
waitCluster observation, and rethrows the identical error on failure. The private
0600 report is bounded to 128 KiB read per member and 1024 characters per
selector line; it retains offsets, a digest and selector lines, not full raw log
bytes. Oversized windows are marked incomplete. The last waitCluster snapshot is
pre-create evidence, not a contemporaneous check of the server's private peer
stats. Debug logging is enabled for the three owned cluster servers only.

Local controls at candidate source: seven portable tests passed; 12/12
intended-assertion mutants killed with intact controls. The existing placement
suite passed 45/45, and its runner killed 34/34. Plan lint was 14 PASS, 1 WARN,
0 FAIL (historical VERSION-idle warning); diff whitespace check and syntax check
passed. The final bounded-read source ran the entire unfiltered owned recovery
fixture: pass=true, allOwnedServersStopped=true, no failure report. The final
controlled owned pair had one create per cohort, control created, injected fault
refused with API error 10005, both cleanup failures empty. Its 2081-byte report
was mode 0600, SHA256
f4a7c00e4e0e89db15ade38b1aefe3c8e04cfc0638721884d028f7ae3df90786;
three selector lines were retained with all windows complete and pre-create
readiness true. That is injected sufficiency evidence, not the historical CI
cause. No production service, timer, Gate, D64 record or restore was touched.

Source exact-head review and all-eight CI remain pending; this candidate row
stays [A]. A separate reviewed, green five-Markdown receipt is required before
closing only this auxiliary evidence row. The original R3 placement repair,
natural trigger and current inventory/override/fresh-D60 observer remain open;
B5/1.2 stays v1.2-pre and B6–B9 stay held.


### 2026-10-18 18:21 EDT — D240 review correction, scope and freshness

Claude355 reviewed exact source d5f396b9 and reproduced 7/7 new portable tests,
12/12 named kills, 44 portable placement passes and 34/34 existing kills under
uid 65534. It found one required ledger correction: the original debug predicate
also enabled logs on the three later cloned cluster members, so the D240 text
claiming only three servers was false. This correction narrows the source as
well: start() takes an explicit debug flag, passed only at the original three
member starts. A complete unfiltered owned recovery run after that change
passed, stopped all owners, produced no failure report, and its retained
configuration files confirm exactly three debug-enabled servers. The caller
source hash pin was recomputed; the eight old placement predicates remain
byte-identical.

The report now labels its readiness table as caller-supplied observations,
retains each jsz.now and a failedAt timestamp, so the age of the last
waitCluster snapshot can be seen rather than implied fresh. A new negative
for overlong selector lines and a counted mutant raise the portable controls
to 8/8 and 13/13; the success-report mutation now requires its exact assertion.
The corrected controlled owned pair passed with one create per cohort, control
created, fault API10005 refused, three complete selector lines, and empty
cleanup failures. Its private 0600 report was 2456 bytes, SHA256
14f8d8a84dd2a4b75c8d36bfce7075056a0f0cb967cfe6a286a9f49d6c2775d0.
These are final-source local checks; the earlier CI run on d5f396b9 does not
validate this correction. No historical natural failure cause or placement
repair is claimed. Source exact-head review and all-eight CI remain pending;
D240 stays [A], B5/1.2 remains v1.2-pre, and production is untouched.


### 2026-10-18 20:31 EDT — serving-NATS recovery-adapter pre-audit (D242 candidate)

Micro re-orient: B5/1.2 is open at v1.2-pre; B6–B9 remain held.
D241 reconciled the first-open row to this adapter; its exact head 254ef778
has a clear Claude363 review and all-eight CI 39177909270.
The persistent-stop producer and owned capture-ready cohort still cannot run.
This unit addresses restoration before changing the stop producer.
The current observer, R3 placement repair, D64 and production are separate.

Pre-screen: the D185 full-node prior and capture-ready shape, D100 managed
NATS stop receipt, D109–D117 override-clear and recovery fences, D180/D193
fail-closed restoration evidence, B1 owned authority, original JournaledHold,
and the owned macOS NATS 2.12.6 stop fixture exist at this head. The worktree
was clean and no BLOCKED.md existed. `StopWatch.mutate()` in
`managed_launchd.py` lines 631–646 refuses persistent serving-NATS stops
before an intent; `Journal.begin_override_clear()` in
`preservation_journal.py` lines 1158–1183 forbids all four NATS transfer units.
`Journal.recover()` already orders nats, nats-2 and nats-3 before clients,
checks the original hold and protected NATS writer marker, and refuses any
unverified override clear on the same run or reopen. `restore_disabled_daemon()`
already records the clear before enabling, binds the new process generation to
the saved files and loaded job, and leaves failures terminal. Member1 is a
baseline-held class, never a serving daemon or restore target.

Goal: make exactly the three serving daemons eligible for a journaled,
enable-capable owned restoration after each has its own verified persistent
stop, with independent per-member health evidence before its
`recovery-verified` record. Preserve the original member1 hold and full-node
restoration order. This is an adapter prerequisite, not a persistent-stop
producer or production restoration authorization.

Proposed §6 source delta, subject to adversarial pre-audit: narrowly admit
`SERVING_NATS` in `begin_override_clear()` while retaining the full-node,
current-unit, restoration-intent, verified-stop and once-only checks; keep
`nats-1` excluded. Compose the existing `restore_disabled_daemon()` with
`Journal.recover()` in owned tests instead of duplicating its enable/bind
logic. Extend the existing native disposable NATS launchd fixture to prove
stop → journal-before-enable → new bound owner → local readiness, using its
unique owned label. Script the fixed-label full-node journal and hold to prove
all three serving restoration intents, clear intents and verified records in
order, with member1 untouched. The two fixtures have different evidence
scope and must not be described as one native full-node run. Existing test
files and CI registration already execute on both Linux and native macOS;
no new workflow step is presumed necessary.

Local readiness is deliberately less than R3 quorum. In a disposable
single-server NATS 2.12.6 probe at 20:30 EDT, `/varz` had version, server
name, client and monitor ports, a config digest and JetStream store config;
`/jsz` named the same server ID while `meta_cluster` was null. The probe
terminated normally and its temporary files were removed. A native callback
can require those local identities, the pinned pre-stop config/store and a
new bound launchd generation plus an authenticated client PONG. Cluster
membership, leader, three-member readiness and four-history health remain
later verification, never inferred from that per-member check.

Required negatives: wrong class/label/member1; no own verified stop, wrong
stop intent or another restoring unit; changed plist/config or saved owner;
enable/bootstrap/bind/readiness failure and interruption; unresolved clear
prevents a second NATS member or any client restoration and a reopened retry,
with no `recovery-verified`, Gate release or fabricated re-fence receipt.
The native NATS fixture must clean up its disposable label even when an
owner remains running and disabled. No automatic bootout of an unbound owner,
never-spawned assertion or process-absence claim follows from a restored
disabled override. D115's running-disabled reconciliation, survivor proof
and measured production readiness budgets remain separate hard gates.

Verify the narrow diff and existing regressions locally; run the actual owned
macOS fixture and portable journal controls, then request exact-source review
and all-eight exact-head CI. A later reviewed, green receipt may close only
this auxiliary adapter row. The StopWatch persistent-NATS refusal remains
until the next producer can prove its own stops. The original hold, D64, Gate,
timers, VM image and production NATS stores are not operated by this unit.
Claude's read-only design review requested at exact head 254ef778 is pending;
this candidate is not a settled implementation plan yet.


### 2026-10-18 20:35 EDT — D242 pre-audit settled against exact source

Claude365 read exact 254ef778 and accepted the adapter as a separate owned
prerequisite with six required corrections. The candidate above is historical;
the source unit must use this corrected boundary. The durable
`begin_override_clear()` point itself must require no open NATS transfer and
no protected writer marker for a serving member, then admit only the explicit
`SERVING_NATS` allowlist while `nats-1` remains excluded by name and class.
Both new refusal calls need negatives that fail if either guard is removed.
The already-pinned timer/NATS exclusion test must be changed to admit the
three serving members and refuse member1, transfer and marker; the old
StopWatch guard test and D98 native stop test remain byte-identical.

The per-member readiness helper belongs beside `restore_disabled_daemon`,
not in `restore_only.py`. Its callback must pass while the other serving
members remain stopped: the newly bound owner and stable generation, a
`/varz` sample from the saved monitor port with the saved server name and
pinned NATS version, and a TCP accept on the saved client port. The saved
config digest and JetStream store path can strengthen the owned fixture's
local identity comparison. It must not require default `/healthz`, a `/jsz`
leader or cluster route/group convergence; those can refuse a lone healthy
member and leave the override-clear intent permanently unproven. D117's
finite readiness budget is explicit and production values need measurement.
The candidate's authenticated-PONG requirement is removed; no authenticated
client exchange is needed for this local port-readiness claim.

Prospective executable delta: `preservation_journal.py` admission and guards,
one `managed_launchd.py` readiness helper, changed and added controls in
`test_preservation_journal.py` and `test_managed_launchd.py`, plus six ledgers.
`restore_only.py`, the StopWatch persistent-stop refusal, D64, production
driver and existing placement logic stay fixed. Scripted tests exercise
admission, stop/intent matching, failure and interruption, reopen refusal,
held member1 and bus-first ordering. A disposable macOS CI fixture must
exercise actual launchd and NATS 2.12.6 with a real full-node journal and
original hold: restore nats while nats-2/nats-3 remain disabled, then each
other member. A failed start must remain terminal with its disposable label
disabled. The operator Mac currently has `ai.openclaw.nats` loaded, so fixed
serving labels must not be bootstrapped there. On a non-dedicated host, the
fixture skips with a named reason or is gated; on the dedicated clean CI
runner, a label collision is a refusal, never a skip. The older unique-label
native stop test remains a separate proof.

After the third member's individual receipt, a distinct post-restore quorum
gate must positively check D234's group conditions before any non-NATS
restore. Current `buses_ready` only propagates a failure; three local
readiness receipts are not R3 availability. Add that gate as its own open
row between this adapter and the persistent-stop producer. Until it lands,
neither the producer nor production resumption is authorized. The first
source gate is the native owned single-member case with intent-before-enable,
new bound owner, local varz identity, member1 held and other serving members
still disabled, plus a scripted mirror, exact-source review and all-eight CI.
The full three-member native case and failure case are needed before this
adapter row closes. D109/D115 survivor and running-disabled reconciliation
remain open; no automatic re-fence receipt is introduced.

### 2026-10-18 23:32 EDT — D245 post-restore R3 quorum gate pre-audit

Micro re-orient: B5/1.2 remains [A] at v1.2-pre; the serving-NATS adapter is
closed by D243/D244, and the post-restore quorum gate is the first open source
prerequisite. No persistent-stop producer or full-node production recovery
caller exists. B6–B9, D64, Gate, installed timers and production remain held.

Required premise correction: D243's native fixture places `nats`, `nats-2`
and `nats-3` in one cluster. That proves individual per-member restoration,
not the saved role topology: `nats` is standalone, `nats-1` is held member1,
and `nats-2`/`nats-3` are the live two of three cluster members. The existing
D234 `$G` group-count assertions require seeded stream/consumer state and
cannot be copied into an unseeded post-restore meta-quorum gate.

The owned, disposable NATS 2.12.6 probe started three loopback members,
then stopped member1. Both survivors returned `200 {"status":"ok"}` from
`/healthz?js-meta-only=true`; `/jsz` identified the same live leader and
cluster size three; `/raftz` exposed `$SYS._meta_` size three, quorum two,
one leader and one follower, stable peer identities and the held peer. The
tagged 2.12.6 monitor source makes meta-only health check leader contact,
currentness and meta recovery, and exposes `size`, `quorum_needed`, `state`,
`leader`, `term`, `observer`, `paused`, `catching_up` and named peers. A sample
immediately after a stop can still report the old leader, so the gate must
wait for agreement and stability. This disposable probe is schema evidence,
not a live B3 pin or production observation.

Source contract: an owned observer takes the pinned standalone and three
member names, the two live monitor ports and a finite caller-supplied budget.
It checks standalone isolation, both live monitor identities, reciprocal
routes, healthy/current meta, the same size-three/quorum-two group and live
leader/term with exact member peer names, then stable repeated samples. A
missing, stale, isolated, catching-up, undersized or inconsistent group
refuses with bounded diagnostic evidence. The journal requires a fresh
positive callback after this recovery call verifies all three serving units
and before its first non-NATS observation or restoration when a serving NATS
member had a persistent managed stop. It records a durable group receipt;
failure leaves the original hold closed and cannot be reused on retry.

Proof: portable observer and journal refusal/ordering/reentry controls; a
role-faithful disposable Linux cluster with held member1 and a minority
negative; corrected fixed-label macOS fixture with standalone `nats` and
held member1, including a group-failure case after individual receipts.
Source review and all-eight exact-head CI precede row closure. The real
full-node driver, persistent-stop producer, live role binding, D60, reboot,
capture and production remain outside this source unit.


### 2026-10-19 00:21 EDT — D246 quorum-gate source-contract correction

D245 is a pre-audit, not a completed source claim. The owned disposable
cold-restart replay exposed one false refusal: after member1 is held and both
survivors restart, NATS 2.12.6 may report the offline member in `/jsz` as
`Server name unknown at this time (peerID: <id>)`. The source now binds every
replica and `/raftz` peer by the NATS node ID derived from its pinned server
name; the live follower's name must match exactly, while member1's `/jsz`
name may be its pinned name or that exact ID-bearing placeholder and its
`/raftz` peer name may be blank. The real four-role test stops all three
members, restores only members two and three, proves the two-of-three group,
refuses a one-member minority and accepts a survivor rejoin.

The observer needs three monitor ports: standalone `nats` and live `nats-2`
and `nats-3`. The journal requires the callback at recovery entry for any
historical serving-NATS `stop`, `unload` or `disable-and-unload` intent in
full-node scope, even before its managed proof is established. This broader
trigger fails closed. After current-call receipts for all three serving
units, and before the first non-NATS **recovery-loop** observation or
restoration, the gate also refuses if any earlier recovery error exists.
Earlier stopped-state and held-unit preflight observations are safety checks,
not client resumption. A failed gate records a group error, leaves clients
unrestored and the hold closed; a retry observes the group again.

The fixed-label macOS failure case now uses a physical partial topology:
member1 initially links the cluster, then both restored survivors retain
routes only to held member1. A disposable NATS probe confirmed each survivor
had zero routes and no leader after that restart; the native CI case must
still run. Its group callback uses the real observer and must refuse before
any client restoration. The ten-second fixture budget is a test value, not a
measured production budget. The persistent-stop producer, full-node driver,
current inventory, D60, reboot and production remain separate. The quorum
row stays open pending exact-head source review and all-eight CI.

### 2026-10-19 01:48 EDT — D249 serving-NATS persistent-stop producer pre-audit

Micro re-orient: B5/1.2 is [A] at v1.2-pre. D243/D244 provide an owned
serving-member recovery adapter; D247/D248 add a positive post-restore R3 gate.
The first open source prerequisite is the persistent-stop producer, before an
owned capture-ready checkpoint. This still serves recoverable histories; yes,
it is the right next bounded step. B6–B9, D64, Gate and production remain held.

Needs pre-screen: the reviewed adapter and group gate are present; corrected
receipt c34494d1 passed all eight jobs on CI39202808141 and Claude389 cleared
it. The original JournaledHold, StopWatch, class_stop_proven, non-NATS fence,
NATS marker/transfer guards, and dedicated fixed-label native fixture exist.
The worktree is clean and no BLOCKED.md exists. No live B3 pin or approved
production stop window exists, so verification is owned only.

Source contract: permit persistent StopWatch.mutate only for the explicit
SERVING_NATS allowlist when each prior unit is a loaded, running daemon.
`nats-1` remains excluded, as do idle or reclassified serving units. Keep
unit-label binding, prepared kernel/process watch, original hold, disabled
before bootout, verified exit/connection/listener proof and disabled override.
The journal must refuse a protected NATS writer marker before the stop intent;
its existing forward and transfer guards still apply. The existing non-NATS
fence must pass before the first serving stop. The three stops run in saved
capture order: standalone nats, then nats-2, then nats-3. A failure at any
stage leaves durable partial/failed evidence and no capture-ready checkpoint;
recovery is the only continuation.

Delta: managed_launchd.py narrows the guard to serving daemon identities;
preservation_journal.py adds the pre-intent marker refusal and ordered serving
stop checks if the existing record-only checkpoint gate is too late; portable
preflight and journal negatives pin the new admission; the dedicated macOS
full-node fixture uses StopWatch.mutate for all three real disposable NATS
servers, checks each durable receipt and full recovery, and injects a stop
failure to prove no checkpoint. Register any added tests on both CI platforms.
No restore_only.py, release gate, production driver, timeout or installed unit
changes. An architectural expansion or two mid-implementation findings require
re-orientation before implementation proceeds.

Verify: owned positives produce one verified disable-and-unload receipt per
serving member under the same original hold; wrong class/label, nats-1,
preexisting override, missing hold, marker, partial stop and out-of-order
paths refuse for their intended reasons. Run relevant suites and mutation
controls, independent exact-source review and all-eight exact-head CI. This
is source/owned runtime proof, not live NATS, D60, reboot, image or production
acceptance. A separate reviewed green receipt may close only this source row.

## Mid-Implementation Findings — 2026-10-19 01:55 EDT

A local `npm test` run in this worktree was unsafe as a baseline check: the
root suite connected to the host's live NATS at `nats://127.0.0.1:4222` and
exercised integration RPCs before it was interrupted. The test code creates
`test-<timestamp>` mesh tasks and best-effort cancels them in an after hook;
the interruption means cleanup completion and residual test records are not
established. It also found a local `better-sqlite3` Node-24 binary mismatch.
No service, VM, timer, image, NATS process or configuration was intentionally
stopped or changed, but test records may have been written to live application
state. This is an unintended live-bus operation, retained as an explicit
exception to D249's owned-only plan. Do not repeat root `npm test` on this host;
use the focused Python suites and disposable CI for this source unit. This
finding does not authorize deleting test records or expanding the source diff.

### 2026-10-19 02:08 EDT — D250 serving-stop failure and live-bus incident correction

D249's statement that “recovery is the only continuation” after any failed serving stop is withdrawn. In the owned verification-failure case, `nats` is physically booted out and disabled but has a durable `failed` row instead of a verified persistent-stop receipt. `begin_override_clear()` requires that receipt, so automatic recovery refuses to clear the override; retrying does not cure it, and the 17 prior-loaded clients remain held. This is a full-node outage, not a successful rollback. The corrected fixed-label native case now calls recovery after the failure and asserts the refusal, blocked client restoration and closed hold. A failed serving stop requires a separately reviewed operator reconciliation; no automatic override-clear exception is introduced here. The case is specifically a verification refusal after bootout, not a bootout failure. Success-path recovery of all three members remains a separate positive.

The local root `npm test` incident recorded in AUDIT_PRE is wider than the initial single-file description. The Node runner may start files concurrently. Six root integration files connect to the resolved live NATS address and can submit tasks: `agent-recruit` (`recruit-`, also broadcasts a recruit signal), `collab-agent-lifecycle` (`lifecycle-`), `collab-integration` (`test-`, also creates collab sessions), `distributed-mc` (test task IDs), `e2e-collab` (`e2e-`), and `field-roundtrip` (`frt-`). Which of these reached a write before interruption is unknown. Their cancellation hooks are best-effort; a live worker may have claimed or joined a test task. No cleanup or live-state reconciliation was attempted, and residual records are unknown. No production service, VM, timer, NATS process or configuration was intentionally changed. This turn did contact the live application bus, so historical “production untouched” statements must not be repeated as a current-state claim. Local root `npm test` is excluded from subsequent verification on this host; isolated CI and owned tests are the source gate.

The new marker refusal is pre-intent only. It does not hold the legacy writer exclusion lock across a physical serving stop, unlike NATS recovery. That gap is now an explicit open source row before any live full-node stop; capture's later marker recheck does not prove stop-time exclusion. The enforced nats, nats-2, nats-3 sequence is the serving-member stop order, not a fixed order required by the capture validator. The journal's loaded/running serving-baseline check is redundant with valid full-node baseline shape. D249's successful producer evidence and the B5/1.2 boundary are otherwise unchanged; the source and this correction still require exact-head native CI and independent review before the producer row can close.

### 2026-10-19 02:16 EDT — D251 failed-stop blocked-unit count correction

D250 repeated the independent review's incorrect “17 prior-loaded clients” count. The failed `nats` stop leaves all 18 prior-loaded non-NATS units unrestored. Recovery assigns “bus recovery was not verified” to 17, including the scheduler-heartbeat timer that anchors the original hold; the deploy listener separately reports “prior restoration was not verified.” Only nats-2 and nats-3 receive restored/already-restored rows because they were never stopped. The native failed-stop case now asserts all 18 units lack restored rows, the anchor timer remains unloaded, the 17 bus errors, the listener's distinct refusal, and the closed hold. D250's fail-closed, operator-reconciliation and live-bus incident findings otherwise stand. Exact-head native CI and independent review of this correction remain required before the persistent-stop producer row can close.

### 2026-10-19 04:05 EDT — D255 serving-NATS forward writer exclusion pre-audit

Micro re-orient: B5/1.2 remains `[A]` at `v1.2-pre`. D252 closed the owned persistent-stop producer, and D254's corrected current frontier retains its natural-trigger and operator gates. The next open source prerequisite is forward writer exclusion during the three serving stops. Its needs exist: the source producer, original execution hold, protected legacy writer wrapper and root lock contract, and owned fixed-label native fixture. The current worktree began clean at 29209984 with no BLOCKED.md. No live stop, current B3 pins or production capture window is available, so this is an owned source unit only.

Source contract: before a serving NATS intent, require the protected legacy lock file and ancestors, absent protected writer marker, and nonblocking exclusive possession of that lock. Hold the same descriptor through the physical disable/bootout, process/connection/listener verification, entrypoint checks and durable verified or failed row. Check path identity and marker again before accepting a verified receipt. Record matching lock identity, exclusive state and marker absence in the intent and verified evidence; the live and frozen capture-cohort readers must refuse missing, changed or malformed writer evidence. A missing, occupied, redirected or changed lock refuses; member1 stays outside the serving-stop path. The protected legacy writer uses a shared lock, so an exclusive stop lock excludes its concurrent entry. This is a contract for protected writers, not a claim about an unwrapped writer.

§6 delta: change `preservation_journal.py` for the guard, journal boundary and checkpoint evidence predicate; extend `test_preservation_journal.py` for before-intent refusal, subprocess shared-lock contention during apply and verify, and changed-marker/lock failed receipts; extend `test_capture_checkpoint.py` for honest and forged frozen inputs; extend the existing `test_managed_launchd.py` owned serving-member fixture to probe contention at actual disable time. This AUDIT_PRE block records the bounded design. Existing CI commands cover all three suites on Linux and macOS, including the fixed-label native fixture on the dedicated runner. No root writer helper, production service, VM, timer, timeout or release-gate change is in scope.

Verify with focused owned suites, independent exact-head source review and all-eight exact-head CI before a separate receipt can close only the forward-exclusion row. The existing failed-stop operator-reconciliation case and D250 live-bus residue uncertainty remain; do not run local root `npm test` or infer that production data is untouched. Stopped-ASIF extraction, role binding, live B3/D60 observation, original placement repair and its natural trigger, and operator disposable-access/resource choice remain separate gates. B5/1.2, B6–B9, D64 and Gate stay as recorded.

### 2026-10-19 04:21 EDT — D255 first-head CI correction

Source head ca888d88 is rejected, not a successful gate. Its Linux 20/22 jobs stopped in the unchanged user-transfer suite because the new guard correctly refused the suite's lock fixture below world-writable `/tmp`; the macOS ASIF reader refused a synthetic fixture whose writer lock was owned by the runner user because the frozen schema had assumed root ownership despite having no live lock to inspect. The native legacy-writer job was still in progress when these failures were diagnosed. The correction puts the journal and capture test fixtures under the runner's protected home and keeps live root-ownership enforcement in `nats_legacy_stop_guard()`. The frozen cohort checks a nonnegative owner claim and its exact match across intent and verified receipt; that offline claim does not prove the owner of a current file. Local owned replay passed 41 user-transfer, 164 journal, 38 capture, 30 stopped-image, 34 host-commit, 91 mount-wrapper and one native facade test. This correction needs a new exact-head CI run and independent review. No live bus or production operation was used for the replay.

### 2026-10-19 04:29 EDT — D255 second-head CI fixture correction

Source head e1198e94 is also rejected as an all-eight gate. It passes the formerly failing macOS ASIF reader, and both Linux jobs pass the legacy-lock step, including all 41 user-transfer tests. Linux 22 then fails in the journal suite: the workflow's preceding authenticated-bus setup deliberately writes `HOME=/tmp/ci-openclaw-home` to `GITHUB_ENV`, so `Path.home()` again places the lock below world-writable `/tmp`. The source guard is still correct. The fixture now prefers the isolated checkout's `GITHUB_WORKSPACE` when CI supplies it and uses the protected home elsewhere. This changes only test placement; the production lock path and exclusion contract remain fixed. The failing head and its step-specific cause remain retained evidence. A further exact-head CI and review are required.

### 2026-10-19 04:36 EDT — D255 independent-review owner-claim correction

Claude's independent review of e1198e94 also rejected its frozen owner predicate: accepting any nonnegative `legacy_lock.uid` let a rehashed intent and receipt claim the same wrong owner and still pass the capture reader. The frozen predicate again requires the recorded protected root UID and mode 0644, while the live guard continues to inspect the current file before and during the stop. The capture suite now rehashes a forged wrong-owner pair and requires refusal. The macOS ASIF probe seeds a synthetic lock owned by the CI runner, so its reader case temporarily binds the expected UID to that runner while exercising the real frozen reader; this is confined to the CI-only fixture and is not a production acceptance rule. This correction and the `GITHUB_WORKSPACE` fixture placement need one new exact-head all-eight CI run and independent review. Neither earlier source head is a green gate.

### 2026-10-19 04:40 EDT — D255 third-head mutation-runner limit

Source head a9123ef7 is also rejected as an all-eight gate. The formerly failing Linux fixture placement, Linux 20, and macOS ASIF jobs pass, but Linux 22 stops before the boot-process-policy mutant assertions: that pre-existing runner embeds the enlarged 121371-byte journal source in one Python `-c` argument and Linux returns `E2BIG`. The runner now transports the same journal, policy and selected test through standard input; its unchanged 46 controls and intended-assertion kills pass locally. Restoring the protected owner predicate also exposed a synthetic `ReaderSeed` unit that verifies after fixture cleanup; its test now binds the runner UID only around that offline verification, matching the CI-only ASIF probe. The current source head must pass these suites, exact-head all-eight CI, and independent review before any D255 receipt. No failed head is counted as source closure.

### 2026-10-19 04:52 EDT — D255 fourth-head protected-fixture correction

Source head 06c051b4 is not an all-eight gate: its macOS ASIF and Linux 20 jobs pass, but Linux 22 reaches `test_process_observation_envelope.py` and reports ten setup errors because that older synthetic envelope fixture forces an owned guest below `/tmp`. The protected legacy-lock guard correctly refuses that ancestry. The envelope, held-job and managed-job test helpers now place their owned roots below the isolated `GITHUB_WORKSPACE` checkout on CI and protected home elsewhere. Each helper binds its test-only `tempfile.gettempdir()` view to the same parent for its literal-root consumer check, with cleanup restoring the view; production readers and the lock guard are unchanged. Under CI's `HOME=/tmp/ci-openclaw-home`, the affected envelope suite passes 55 tests and 50 intended-reason mutants; held-job 32, managed-job 34 with one platform skip, managed-job negative 20 with one platform skip, and scripted-entrypoint 28 all pass. This is a fixture correction, not permission to accept a world-writable lock ancestor. A new exact-head CI and independent review remain required; the 06c051b4 native job had not reached a terminal result when diagnosed.

### 2026-10-19 06:54 EDT — root-suite live-bus isolation and residue pre-audit

Micro re-orient: D255/D256 closed the forward-writer-exclusion source prerequisite; B5/1.2 stays `[A]` at `v1.2-pre`. The next open row is the D250 interrupted-root-suite incident and future test isolation. Its read-only task/collab access and nine mesh-gated suite files exist. The current worktree began clean at 7f5b79ae, with no BLOCKED.md. The bounded read-only audit is in `ROOT_TEST_BUS_AUDIT_2026-10-19.md`: 36 current test-prefixed tasks and 18 sessions were found, including one queued e2e task and its active session. No live record is changed or removed. Latest KV state cannot exclude transient worker effects or deleted records.

Source contract: route `test`, `test:unit`, `test:strict` and `test:integration` through a disposable authenticated loopback NATS, JetStream store and mesh-task-daemon, with a temporary home, node identity, scratch directory and explicit bus URL. Fail closed when isolated setup fails. Direct invocation of the nine mesh-gated suites must visibly skip their mesh tier without the runner flag, so a developer's direct `node --test` cannot silently use the host's resolver fallback. Preserve the existing nkey test mode and make the root runner refuse unauthenticated bus connections. Clean up its process group and temporary files on completion or interruption.

§6 delta: `package.json` changes four root scripts; `test/run-root-tests.mjs` is the isolated runner; `test/helpers/mesh-available.cjs` guards direct mesh suites; `test/root-test-isolation.test.mjs` proves an inherited configured bus receives no connection and the temporary home is removed; `test/nats-auth-render.test.mjs` replaces its real process reload lookup with a disposable command stub. This pre-audit, the dedicated read-only audit, and later same-silo receipts are the only plan-document changes. No production NATS, task daemon, worker, timer, VM, service or configuration operation is part of the source change. No test-record cleanup is authorized.

Focused probe and integration checks passed locally; the operator-host full root run failed for the recorded Node-24 `better-sqlite3` mismatch and existing native timer fixture, so it is not a source gate. Require an independent exact-head review and all-eight exact-head CI before closing only this prerequisite row. The queued task and active session remain for attended reconciliation. Stopped-ASIF extraction, live role binding, current B3/D60 observation, original R3 placement repair and natural trigger, operator disposable-access/resource choice, B5/1.2 and later gates remain open.

### 2026-10-19 07:02 EDT — first isolation head correction

Source f4f209e2 is not a closure gate. Its Node-20 root job failed `test/publishers.test.mjs` because the runner gave every test process `OPENCLAW_NODE_ID=root-test-lead`, overriding that unit's explicit `nodeId: 'test-node'`; the daemon alone needs the lead ID and role. The runner now reserves those values for the daemon and removes inherited node ID/role from the root test environment. Source review also exposed the pre-existing `nats-auth-render` test's process-wide reload lookup: the first head isolated its task bus but did not isolate that CLI's protected-host-lock re-exec and `nats-server --signal reload` fallback, which could touch the host lock and signal the operator's servers. The test CLI now masks those host paths, receives a disposable `nats-server` command stub, and asserts the stubbed reload. The runner's temporary `openclaw.env` supplies its isolated URL, token and nkey mode when a child drops explicit bus env but keeps the temporary HOME; it also overrides inherited `NATS_URL`, which some publishers prioritize over the shared resolver. The original f4 CI and review remain failed/incomplete evidence; the corrected source requires its own exact-head CI and independent review. No live cleanup was performed.

### 2026-10-19 07:11 EDT — second isolation head host-lock correction

Source head 340d2e8c is not a closure gate. Independent review confirmed its corrected `nats-auth-render` test no longer signals a disposable same-uid `nats-server` and does not contend for a sandbox stand-in host lock. The same review found that sibling `nats-writer-ownership.test.mjs` still forged only the protected handoff marker. Its three spawned CLIs could re-execute under the production writer lock before refusing. In a sandbox reproduction, the uncorrected test held a shared lock during 53 probes. Its test-only preload now also reports the protected legacy lock absent, allowing the handoff-refusal assertions to run without acquiring the host lock. The auth-render test also places a failing `pgrep` stub on its child PATH, so a failed or unexecutable reload stub cannot fall through to a host process list. The prior reference to `nats-server --signal reload` as a fallback was imprecise: it is the primary signal path; `pgrep`/SIGHUP is the fallback. The source change and audit correction require a new exact-head CI run and independent review. The interrupted local root run's process-level lock or reload effects remain unknown; no live cleanup was attempted.

### 2026-10-19 07:27 EDT — third isolation head executable-stub preflight

Claude cleared source ec1968ae with no required finding after a darwin-forced sandbox proof: both corrected CLI tests passed without writer-lock contention, while removing their lock masks made the same tests pass with 485 and 207 contended probes. This replaces the earlier Linux-only zero-contention observation, which did not exercise `lockExists()`. The review also found that libuv can skip an unexecutable `pgrep` stub on a `noexec` temp mount and reach the real executable. At ec1968ae the reload helper crashes before that fallback when its primary stub cannot spawn, so no HUP was observed in the disposable noexec case, but that crash is not an isolation contract. The auth-render fixture now executes both disposable stubs with inert arguments before invoking any CLI and refuses if either cannot run. This source refinement requires a new exact-head review and all-eight CI; ec1968ae is retained as cleared source evidence, not credited as the final gate. No host lock, live process or live bus was operated by this local change.

### 2026-10-19 07:38 EDT — fourth isolation head PATH-delimiter correction

Claude cleared 6aa054d0 with no required finding: under disposable dash and bash shells, its executable-stub preflight refused a `noexec` temp directory before any CLI or SIGHUP, and the normal fixture still required the actual reload marker. Its sandbox also found a different edge: when the temporary directory contains `:`, the fixture's `PATH` entry splits; the direct stub preflight passes, but a child can resolve the real `nats-server` and signal a same-uid decoy before the test assertion fails. The auth-render fixture now rejects a test-bin path containing `path.delimiter` before creating or launching any child. This is a test-fixture safety guard, not a production reload change. The 07:11 statement that a failed or unexecutable stub cannot reach the host process list is superseded by the 07:27 preflight and this path guard; ec1968ae was vulnerable to a noexec/bash primary-path lookup, while 6aa054d0 remained vulnerable to a colon in TMPDIR. The new source head requires its own review and exact-head all-eight CI. No operator-host NATS process or record was operated for this correction.

### 2026-10-19 07:43 EDT — fifth isolation head actual command lookup

Claude cleared 46f85982 with no required finding: the colon guard refused before test-bin creation and a guard-removal mutant restored the disposable decoy's SIGHUP. The same review found that dash interprets `%builtin` and `%func` inside PATH entries. A temporary path with that sequence could pass both direct stub-execution checks and the colon guard, yet `sh -c 'command -v nats-server'` selected the real binary; the decoy saw no HUP in that case, but the host binary was invoked. The fixture now checks the exact `command -v nats-server` result under the identical child PATH and requires its disposable stub before starting any CLI. The executable checks and delimiter guard remain. This is a bounded test-fixture safety correction, not a production reload change, and needs a new exact-head independent review and all-eight CI. The earlier heads remain evidence, not closure gates; no live operator-host NATS process or records were operated by this change.


## 2026-10-19 13:26 EDT — B5 protected byte-anchor source unit (D261)

### Micro Re-Orient
- Step 1.2/B5 remains in flight at v1.2-pre; production capture is disabled.
- D259/D260 verified pre-arm table content binding and the two root/attach test carry-forwards.
- The operator selected interactive sudo per window for owned implementation/tests; no installation.
- This unit retains post-capture bytes under an independent owner and makes a protected reader compare them.
- This serves recoverable histories; it does not produce semantic ACCEPTED, guest admission or B6 release.
- This is the next named prerequisite; pre-stop provenance and full acceptance integration remain tracked.

### Needs and boundary

D189 and D207 govern the residual provenance and terminal-decision limits. The window-pin source at 8f820784 has exact-source review and all-eight CI39285492438; the tree is unchanged through 6f5a651a. D261 records the authority choice. Claude has been asked for a bounded read-only pre-audit at that head. No production root exists or is created. Runtime deployment is not authorized; the source prerequisite requires owned execution evidence and keeps the parent B5 row open.

### Proposed file deltas and proof

Add a self-contained standard-library-only `host_capture_anchor.py`, portable tests `test_host_capture_anchor.py`, an intended-assertion mutation runner `mutate_host_capture_anchor.py`, and a CI-only independent-owner probe `probe_host_capture_anchor.py`. Extend the existing Linux/macOS portable steps and native ownership job in `.github/workflows/test.yml`. Keep existing capture/mount/decision code fixed and production refusals intact. Update only the five existing ledgers and this pre-audit as implementation/evidence becomes concrete.

The owned producer must read fixed host record names and the clone through held no-follow descriptors, validate owner/mode/single-link/ACL/identity and bounded canonical records, preserve their byte hashes plus nonce and directory binding under root, refuse overwrite/re-pin, and publish only a complete record. The privileged consumer must reopen the actual protected root record and compare a fresh descriptor-bound snapshot; caller-supplied verification JSON is not authority. Partial publication refuses; any recoverable complete publication must be explicitly distinguished from partial state. The root store and all ancestors need independent ownership, private leaf mode and no ACL grants. Future installation must provide trusted code, interpreter and import closure; no sudo invocation of the writable checkout is a production model.

Proof: portable source/ordering/refusal/interrupt/rewrite tests and decisive mutants; CI-only native distinct uid/root permissions, parent/mode/ACL controls, trusted temporary code copy and coordinated input/clone rewrite. No local elevated test suite or VM/image operation. Independent exact-source review and all-eight CI remain mandatory before source readiness. All unimplemented integration, installed provenance, B3/live bindings, D62/manual/D175 and macOS reboot gates remain open.


### Pre-audit disposition and bounded integration boundary

Claude Message 55 recommends the same self-contained byte-anchor/privileged-byte-verifier boundary. Incorporate isolated `-I -S -B` invocation and root-controlled interpreter/program/search-path/module checks (misinvocation detection, not self-authentication), explicit capture/SUDO uid binding, honest capture/arm locks, failed-capture refusal and fixture VM identity. Its suggested final frozen-reader receipt correlation is retained as the next protected-acceptance integration, rather than claiming a user-generated receipt is privileged journal verification. This source unit uses a separate synthetic capture/clone probe on Linux and macOS; it does not modify the existing ASIF probe or claim a root-performed frozen-journal read.

Publication is intentionally stricter than the suggested automatic temp recovery: any pending file refuses both routes and requires attended reconciliation. A complete single-link record after final-unlink interruption may be verified only by the protected reader, which repeats the full byte comparison and file/directory sync. Re-publication always refuses; no temporary file is removed automatically and no new snapshot replaces an anchor. This is the ordinary fsync-level contract, with no power-loss or boot-decision claim. Benign deny-only ACLs are allowed; allow grants and unreadable ACL observations refuse.

The parent protected-acceptance-root gate remains in flight. Its source primitive has a separate atomic `B5-protected-byte-anchor source` row so neither owned proof nor a byte-only CLI can close installation, actual frozen-reader receipt integration, B3 provenance or real-window acceptance. VERSION remains v1.2-pre under the existing parent step. No additional production permission is requested or inferred.


### Local candidate verification

The 28-case focused suite passes (22.283 s); the mutation runner's baseline is that same suite and all 18 designated mutants fail with the intended AssertionError. The existing three-module regression batch passes 139 tests (83.812 s, one platform skip). Python 3.9 syntax parsing and diff checks pass. Local plan lint is 14 PASS / one existing WARN / zero FAIL. No local root or native ownership probe was run. Distinct-owner Linux/macOS execution, native macOS ACL evidence, exact-source review and all-eight CI are pending. This candidate closes no row and leaves the full protected acceptance integration open.


### 2026-10-19 14:01 EDT — CI proof re-orientation

D262 records both failed candidate CI boundaries. The owned proof stays one outcome: an independently owned byte anchor detects a later capture-user rewrite. Refine only its CI interpreter selection and fixture ancestry, keeping every production refusal and protection predicate. The root program still validates the selected runtime itself. Portable tests simulate root ownership and ambient ACLs; actual owner/ACL claims depend on completed Linux/macOS probes. Fresh input/program/record fixture objects alone may be normalized; existing runtime/ancestor permissions may not be changed. Corrected local proof is31 focused tests/19 intended kills with baseline passing; root-bootstrap syntax parses under3.9. No local elevated probe is run and no acceptance row closes. The exact corrected head needs its own review and all-eight CI.


### 2026-10-19 14:19 EDT — Message57 proof correction

D263 records the three required source/proof corrections and their bounded changes. The one outcome remains protected post-capture byte integrity; no production path, source authority or semantic acceptance is added. The final local baseline is40 tests OK and40 designated assertion kills. The cache experiment explicitly ignores the caller's cache-prefix setting when creating the forged cache and forces timestamp validation. Its first local attempts used macOS's configured global cache prefix; four exact generated EVIL-only test caches were identified by recent owner/single-link metadata, their code constants/names and deleted unique temporary source paths, and removed. No existing module cache or application history was altered. Future artifacts stay under the owned temporary tree.

The path-based ACL observation on capture-user inputs can describe an alias during a same-uid path race; it is not independent privacy/provenance proof. Descriptor-bound reads and final identity/digest comparison preserve the stated byte-integrity outcome. Root-store paths are independently controlled. Other non-blocking adequacy notes remain notes rather than an exhaustive mutation-coverage claim. Exact final-source review and all-eight CI, including the corrected native invocation/store fixture, remain mandatory. No local elevated probe or production operation was run.


### 2026-10-19 15:18 EDT — B5-CI-serving-group-settle re-orientation before source work

The operator's next go starts protected frozen-reader integration, and Claude has its bounded exact-source pre-audit at 8d3a837e. Before that expansion, this documentation head's macOS legacy job 118251575729 in run39308471837 failed in the existing RealGroup cold-restart positive: its ten-second observer reported `nats-2: meta leader or group size differs`. It never reached the byte-anchor suite. The exact byte-anchor source e2bffb7c still has its own successful all-eight run39301653593; no result from this failed receipt job replaces it. Its raw log has 29095 bytes/300 lines/SHA-256 aa994867cfabb8026a2306e1bb97b12584c57e886d0df82a283626e55db2dc58, retrieved with the raw gh-api job-log method.

Six unprivileged, separately created four-loopback-server reproductions use the installed NATS2.12.6 binary, fresh store roots and only their own child PIDs. All complete the cold restart, minority refusal and rejoin; cold positives take 5.448,6.618,9.382,5.511,9.981 and7.469 seconds under the existing ten-second budget. They do not reproduce the CI refusal or establish its cause. The v2.12.6 tagged raft.go defines randomized four-to-nine-second elections, while our observer requires a further full second of stable agreement and routes. Ten seconds leaves no reliable allowance for that combination, scheduler delay or another election. The failing CI job retained no server logs or monitor snapshots, so this is a demonstrated test-budget weakness, not a proven explanation of that CI event.

One independently executable prerequisite now preempts reader implementation: owned quorum-fixture budget and failure evidence. Keep serving_nats_group.py and every production/recovery predicate unchanged. Give only the real fixture's two positive phases a finite thirty-second test budget; keep the minority's two-second refusal and the observer's one-second stability rule. Route these calls through a test-local observer wrapper that retains phase, budget, elapsed time and last endpoint observations and re-raises the original refusal. Before removing its own temporary tree, the real fixture must retain bounded server-log tails and child cleanup evidence on failure; successful phases print their measured summary. No production timing guarantee follows from the test value.

Meaningful portable proof must make a valid group appear late enough that ten seconds cannot include the required stability window, show acceptance under the owned budget, show the shorter budget still refuses, and ensure a permanently invalid group refuses and propagates its failure with evidence. Designated mutants must kill the shortened positive budget and swallowed refusal. Run the corrected real four-role fixture unprivileged, with cold/minority/rejoin controls; then independent exact-source review and all-eight CI are required. The original CI event's unobserved trigger and the older R3 placement/natural-trigger item remain open. No local root suite, existing NATS process, production service, VM or timer is touched. Protected reader integration, all other B5 work and B6–B9 stay held.

Claude63's integration pre-audit arrived during this repair and confirms a necessary preceding source unit: pure commitment/capture/frozen verification over six held record byte strings, explicit guest-file owner and protected-writer uid, and unchanged existing path wrappers/callers. Its future privileged integration must verify a trusted root-private import closure, keep capture descriptors/locks through the operation, mount a root-controlled copy hashed against the anchored held clone, run the real semantic verifier, release cleanly and publish a protected receipt bound to that anchor and owner context. Neither a user-generated receipt nor a root invocation of current uid-assuming wrappers is that proof. Same-volume CoW availability and guest/capture uid equality require separate evidence; no production assumption or installation authority follows. P's portable/root-CI proof and Q's distinct-owner native mount proof remain future work, not part of this fixture repair.

### 2026-10-19 15:35 EDT — Claude65 fixture-candidate correction

Candidate bdd535a7 is rejected as a source gate: Claude65 independently reproduced seven tests/4 kills and three real NATS2.12.6 successes, but an undecodable log byte replaced an injected refusal and bypassed cleanup, leaving three sandbox children that the reviewer then removed. Its sibling fixed-label native recovery positive also retained the same ten-second allowance. The correction reads only the last16KiB as bytes with replacement decoding, contains evidence errors, attempts every child's stop and exit observation independently, and preserves the primary refusal while retaining secondary cleanup errors. Three committed portable regressions run the actual RealGroup control flow with fake children: corrupt-byte evidence, evidence-read failure and one child-stop failure; all require the original exception and complete cleanup attempts, without claiming a simulated failed stop reaped its child. An additional endpoint-error control/mutant covers the review's non-blocking evidence note.

The sibling native callback now uses the same test-local observer and thirty-second positive budget, retaining its deliberately isolated negative's ten seconds and its original predicates/holds. It emits that callback's actual phase evidence; native execution remains CI-only. The separate real-group minority stays at two seconds. Local final proof is11 tests OK11.742s,8 intended assertion kills with ten portable controls passing, and23 scripted managed-launchd preflight regressions OK. No local launchd fixture or elevated test ran. The superseded candidate's CI cancellation is requested because its source has required findings; it cannot establish readiness even if earlier jobs passed. The corrected source needs a fresh immutable-head review and all-eight CI; no row closes.

### 2026-10-19 16:22 EDT — D267 proof receipt and next source boundary

The corrected owned fixture source36946f55 has Claude67 clear and all-eight successful exact-source run39312416398 attempt1, including actual macOS callback budgets/refusal and order proof. D267 closes only B5-CI-serving-group-settle; the original CI event trigger remains unknown. The next independent source prerequisite is Claude63 pure six-record byte verification with explicit guest-file/protected-writer owner context, preserving path wrappers and semantic checks. Its owned proof and exact-source review/CI precede protected native reader integration. The separate read-only host assessment refreshes B5-macOS-access without granting VM/resource or production authority; all other B5, D250/D251 and B6–B9 holds remain.

### 2026-10-19 16:30 EDT — B5-frozen-byte-owner-context re-orientation

Block1/step1.2 remains pre; D267 closed only the owned fixture gate.
This unit supplies the Claude63 prerequisite to protected frozen-reader integration.
The current path reader assumes caller-owned guest files and a module-global protected writer uid.
B1/D261 permits owned source/tests only; deployment, native mounting and acceptance stay separate.
This remains the right next source gate; existing source369 has exact all-eight CI and clear review.

Goal: one semantic verifier over six held capture-record byte strings, with explicit guest-file owner and protected-writer uid at the future root boundary. Preserve require_captured/require_committed and verify_frozen_checkpoint/verify_stopped_journal path-wrapper patchpoints and ordering; shared pure helpers retain all existing checks. Thread writer uid through verify_capture_checkpoint, capture_cohort and writer-exclusion comparison; live/path callers pass the current preservation_journal.NATS_ROOT_UID dynamically. Thread guest owner through read_inputs and its directory/file/lock/Finder checks; live Journal calls retain their current uid. New byte APIs require explicit context, reject malformed uid values and perform no capture-path reads.

Section6 deltas: host_guest_commit.py shared byte helpers and pure verification; preservation_journal.py explicit owner arguments plus unchanged live calls; stopped_journal_inputs.py explicit owner reads and byte composition; two existing checkpoint test helpers pass dynamic writer uid; new focused owner-context tests, assertion-mutant runner and CI-only distinct-owner probe; workflow wires portable tests/mutants and Linux/macOS root-owned disposable-tree proof; standard ledgers record the candidate/proof and only its own row may close. Existing window-pin mutation anchors may need mechanical retargeting when a check moves into a shared helper; their designated assertions must remain killing.

Verify: pure calls return the same summary after the capture path is renamed and while file/uid accessors refuse; explicit correct writer uid succeeds even under a different global, wrong uid refuses; guest owner checks cover directory, regular files, locks and Finder metadata, and reject malformed context before reads. CI-only root owns the capture records, reads a fresh uid65534 guest tree through the explicit API, and the unchanged current-owner wrapper refuses that tree. AST-reachable pure calls, focused regressions, relevant existing mutators and all-eight exact-source CI plus Claude adversarial review are mandatory. No local sudo/root probe, production service/VM/timer/image operation or broader root suite. The future protected native reader is not implemented here.

### 2026-10-19 16:48 EDT — Mid-Implementation Findings: shared helper callers

Claude71's review of immutable a74df78c identifies one shared-signature regression: existing current-owner consumers did not supply the new required owner keyword. The direct boot-policy content test reproduces the TypeError. Four boot-policy private_dir calls, the observation-envelope call and its held-job/managed-job re-exports also require explicit current uid. An initial narrow direct-import census missed those re-exports; it is not completeness proof. The first expanded local consumer batch Ran256 with35 errors and2 skips, all at the remaining re-export calls. The correction supplies os.getuid() at all seven current-owner private_dir calls plus the existing direct content test, preserving their prior policy. It adds no new owner choice, admission or recovery behavior.

The expanded corrected consumer batch Ran256 in50.096s, OK with2 platform skips (254 executed). Their existing mutation runners and the complete source review/CI remain required. The rejected candidate run39321357854 is completed/cancelled after confirmed source findings and cannot establish readiness. Core byte APIs, fifteen focused controls/thirteen mutants and the CI-only root owner probe are unchanged; no local root probe runs. These five caller/test files are required dependent deltas within the existing owner-context unit. No prerequisite closes and all D268 holds remain.

### 2026-10-19 17:26 EDT — D270 source proof and next boundary

D270 closes only B5-frozen-byte-owner-context (P) at corrected source679e200b: Claude73 clear, all-eight run39322919247 and real Linux/macOS nine-case distinct-owner tree reports with cleanup. Its full dependency replay covers the D269 shared-helper callers. The next separate owned source unit is protected frozen-reader integration (Q), requiring trusted dependency closure, held descriptors/locks, an anchored root-owned image copy, real semantic verification and a protected receipt with native distinct-owner image/cleanup proof. Q is not implemented here; installation, production capture, B5/1.2, D250/D251 limits and B6–B9 remain held. This receipt changes no executable and does not claim its own future CI/review.

### 2026-10-19 17:39 EDT — D271 protected frozen-reader re-orientation and pre-audit

Block1/step1.2 remains pre; D270 closes only the P byte/owner prerequisite.
The operator's next go advances only Q's owned protected native reader receipt.
B1/D261 source authority applies; production entry, installation and B6–B9 stay held.
The source foundation is P679e200b, Claude73 clear and all-eight CI39322919247.
D270747da00e has Claude75 clear; its own documentation CI remains a separate observation.
This is the next source gate; no macOS VM/resource or live window action follows.

Goal: one protected semantic reader receipt over a root-controlled image copy bound to the existing protected anchor and explicit capture, guest-file and protected-writer uids. Refactor anchor snapshot into a held context preserving its existing wrapper. Hold protected-store/anchor and capture directory/record/clone descriptors plus both locks until cleanup and publication. Validate the root-private local dependency closure before importing it, hash and recheck it. Clone only from the held source FD using native fclonefileat with CLONE_NOOWNERCOPY (SDK sys/clonefile.h), require root-owned0600 single-link copy and the anchored hash; no cross-volume/full-copy fallback. Mount only that protected path using existing bounded primitives. Call P on held record bytes and the verified Data mount with explicit owner contexts. Reverify mount, cleanup, copy/source/anchor/runtime before a staged, durable, exclusive protected receipt. Interrupted or failed attempts remain pending and cannot yield a usable receipt or retry automatically.

Section6 deltas: host_capture_anchor.py held snapshot/trusted reader dispatch; new host_protected_journal_reader.py orchestration over existing mount and semantic primitives; focused portable test and designated-mutant runner; CI-only native owned ASIF/distinct-owner probe; workflow wiring; standard ledgers. Existing journal/capture/mount semantic predicates and production refusals remain unchanged. No local root, mount, launchd, production or VM operation. The independent pre-audit is requested before implementation; concrete sequencing or missing-prerequisite findings must settle before source work.

Verify: meaningful real Journal/commitment portable composition with scripted native actions, descriptor and lock continuity through cleanup/publication, source/anchor/copy/mount/context/semantic/receipt refusals and intended mutants. Existing40/40 anchor,15/13 P and checkpoint/stopped-reader/mount regressions must remain green. CI-only actual macOS CoW ASIF and root0/capture-nonroot/guest65534/writer0 proof must execute the real shared verifier, reject wrong owners/writer and corrupt journal or coordinated source rewrite, and retain cleanup/protected-output evidence. Exact-head adversarial review and all-eight CI precede a bounded proof receipt. Installed launch provenance, real B3 origin, four-history restores, D62/D64/D175 and disposable-macOS reboot remain separate.

### D271 pre-audit settled — Claude77, before source implementation

Claude77 finds no external prerequisite or scope error and requires eight implementation constraints. C1 adds one internal file delta: extract the existing capture scope/stopped/fixture-started-sample/Data-UUID predicates from host_journal_mount.capture_inputs into a pure byte helper, retaining their text and using it from both paths; recompute/replay that module's dependent suites and mutators (including dispose/reconcile). C2 passes the single anchor module object into Q, with a no-second-import test. C3 performs all entry/runtime/store/anchor-pending/Q-state/capture-lock/snapshot checks before creating Q's distinct pending directory; exactly one read per nonce, no retry or overwrite after pending/receipt publication.

C4 supersedes the proposed flag repair: refuse any held source st_flags, require a regular root-owned single-link0600 copy on the pending directory device, exact anchored size, zero flags, no ACL and an empty bounded xattr-name list before hashing. Python3.9 Darwin uses descriptor flistxattr through ctypes, not os.listxattr. No attribute repair or copy fallback. Existing retained native reports show empty xattr lists; that is prior observation, not this source's native proof. C5 requires exactly12 source files (anchor, Q and ten dependencies), no extra/cache directory, held source Inputs, stdlib-first sys.path append, exact loaded local set, and fresh source/runtime identity+hash checks before attach and receipt. C6 requires three distinct synthetic uid roles through portable call flow, pairwise-swap and current/global-uid fallback mutants, and a native capture/guest swap refusal; real code permits equality. C7 targets Python3.9 in local parse and macOS CI. C8 retains the18 existing snapshot mutation anchors exactly once, standard-library-only publish/verify and their argv shape; Q has a separate strict-decimal argv shape.

Also implement the small protected receipt reader enforcing the pending fence, scrub subprocess environment for the root action, refuse an attached source and put the Q native step after older macOS probes. Root-owned copy metadata changes caused by attach, source/copy xattrs or root-private attach incompatibility remain refusals, never silent relaxations. Add explicit source/copy metadata/flags/xattr negatives, shared capture-helper dependency regressions, one-anchor-module proof and receipt-readback/pending controls to the existing Verify contract. Q receipts say caller-asserted uids, CI fixture only, no B3/B8 or installed authority. No extra installation or live gate is introduced.


### 2026-10-19 18:34 EDT — D272 candidate fixture and receipt-proof correction

CI39334325475 at6009a904 fails Linux22's new suite: CodeClosure uses HOME=/tmp/ci-openclaw-home, so the unchanged Directory policy correctly rejects its world-writable /tmp ancestor. Only the test fixture base changes to the existing GITHUB_WORKSPACE-or-home convention; no production/root directory policy is relaxed. A replay of all eight CodeClosure tests with Path.home modeled as /tmp and the actual workspace selected passes. The same run's native Q step remains in progress and is not readiness evidence yet.

Claude79 independently reproduces this CI failure, confirms all23 dependent suites pass (Ran723,683 executed/40 platform skips) and all18 dependent mutation runners pass in its isolated uid65534 export. It also identifies required receipt-verifier test adequacy: several binding-term removals survive the original40-test suite. Add one table-driven actual receipt/anchor corruption test covering scope, nonce, owner context, anchor hash, file pins, receipt and anchor authority, code hashes, clean cleanup and copy removal. For the anchor-authority case, update the receipt's anchor digest too so the authority term alone decides. Add ten designated term-removal mutants; all must be intended assertion kills with a passing complete baseline. No runtime behavior changes in this correction.

The corrected local baseline now reports41 tests OK and45 intended assertion kills with controls. This narrows the earlier coverage gap; it is not exhaustive failure-path coverage. Independent review of the exact corrected source and its own all-eight CI/native proof remain required before Q can close. D271 and every historical block stay unchanged; B5/1.2, parent acceptance, installed authority and all operational gates stay held.


D272 native-budget observation: job118339871983 starts22:21:20 UTC; Q begins22:26:12 after the older probes. Its real intact case completes22:29:48, then wrong guest22:31:46, wrong writer22:33:30, capture/guest swap22:34:19 and corrupt chain22:35:56. The unchanged15-minute job ceiling cancels Q at22:36:34 before its remaining three cases and final driver cleanup report. Only four older reports are uploaded; no Q report exists and no final cleanup or readiness is claimed. Increase only this CI-owned job ceiling to30 minutes, allowing the measured integrated workload and cleanup to finish. Per-command timeouts, negative budgets, all checks and the native probe source remain unchanged. This workflow delta is part of the same owned Q source/test unit.


### 2026-10-19 18:40 EDT — D273 complete Claude79 proof corrections

The final Claude79 report adds two details to D272's already-published corrections. R3 includes the protected receipt consumer's runtime recheck, beyond the ten record terms: add a changed-runtime receipt test and a designated removal mutant. R2 also requires progress-report retention after each case, since a whole-job timeout can interrupt the final cleanup block. Add a non-acceptance diagnostic snapshot at initialization, each case start/completion and final cleanup; replace it atomically from a fresh nofollow/exclusive sibling after fsync. Initial output creation stays exclusive, incomplete snapshots say completed=false/cleanup unobserved, and only the final report can record complete cases and measured cleanup. Test this diagnostic writer without root/native operations. No reader/runtime predicate, command/negative timeout or native case changes. The changed probe must receive its own fresh exact-source CI proof; D272's run is superseded before Q proof, not reused as readiness.


### 2026-10-19 18:48 EDT — D274 model the existing no-bytecode root flag in the closure fixture

Exact-source run39336819548 at10113c8a fails Linux22 job118348279024 with four CodeClosure errors after imports: the real exact12-entry check correctly sees Python's generated __pycache__. macOS local Python defaults to an external pycache_prefix; Linux defaults to writing beside source. This is a distinct environment condition from D272's /tmp ancestor failure. An unprivileged local replay with sys.pycache_prefix=None and sys.dont_write_bytecode=False reproduces exactly four errors among eight closure tests. Model sys.dont_write_bytecode=True inside only CodeClosure's reversible fixture patches, matching the already-required real -B root CLI; keep the twelve-file/root runtime policy unchanged. Replay the full43/46 with the default cache prefix cleared and bytecode initially enabled, plus /tmp-home/workspace controls. This test-only delta needs its own exact-source review and all-eight CI; no native predicate or probe changes.


### 2026-10-19 19:46 EDT — D275 source-proof receipt boundary

The corrected source7e945480 is cleared cumulatively by Claude79/81/83. Run39337630740 completes success at attempt2: only failed Linux22 reruns, the other seven successes carry from attempt1. Actual root/capture/guest native eight-case report and final cleanup are complete and retained. D275 closes only Q and adds the separately observed owned preservation-cluster startup failure as an open finding; a later fresh-job pass proves no cause or repair. The receipt changes only six Markdown files, preserves D271–D274, VERSION and all other gate statuses, and needs its own bounded receipt review. Its future documentation CI is separate; no executable or operational action follows.


### 2026-10-19 20:01 EDT — D276 preservation-cluster startup re-orientation and pre-audit

Block1/step1.2 remains pre; D275 closes only Q at7e945480, not parent acceptance.
The operator's next go advances the separate B5-CI-preservation-cluster-startup finding.
The failed first create and successful fresh-job retry remain distinct immutable evidence.
B1 owned source authority applies; no local elevated/native/root suite or production operation.
The next useful outcome is phase-local evidence of this fixture's unchanged startup boundary.
Original R3 readiness repair and its natural trigger remain separate, unproved gates.

Needs are present: D275/Claude85, retained raw failed Linux118350995715 and retry118367021558 logs, current test_preservation_cluster.py, NATS2.12.6 and Node/module, random-loopback allocation and owned cleanup. Headc898bfee is clean. D275 receipt CI39343766023 is independently still running (six succeeded, two macOS jobs pending); its completion is not assumed. An independent pre-audit is requested at c898bfee before source implementation.

Goal: diagnose/retain the actual startup-to-first-create boundary without guessing a readiness repair. Keep the existing leader/route/account readiness predicate, its15-second deadline, one stream create per cohort, post-create group/election/QuietWindow assertions and production paths unchanged. Retain bounded, sanitized projections of startup/accepted-ready monitor facts, exact first-create Node stage/API error/connected-member facts, bounded debug peer-selector log windows and measured cleanup. Monitoring is sequential, not an atomic cache snapshot. Retention failures must preserve the primary exception and allow cleanup of every owned child. No raw configs, stores, credentials or entire logs enter CI artifacts.

Section6 proposed deltas: existing test_preservation_cluster.py diagnostic hooks and fresh-cohort fault seam; a small test-local evidence helper if needed; focused portable/actual-owned proof and designated-mutant runner; Linux/macOS workflow test/report wiring; standard six Markdown ledgers. No production readiness helper, NATS source, timeout budget, retry policy, serving-NATS or protected reader changes. A normal and deliberately STATSZ-route-denied fresh cohort each create once and clean up their own processes. The fault can demonstrate only a controlled sufficiency gap, not the original event's cause. Any pre-audit corrections must settle before implementation.

Verify: meaningful portable evidence-shape/failure-path/primary-error/cleanup controls and intended assertions; actual isolated NATS2.12.6 normal and injected-refusal cohorts with one create each and normal cleanup; existing13 group-readiness controls/22 mutants remain green. Independent exact-source review and all-eight CI precede any owned diagnostic-source closure. Original placement repair/natural trigger remains open. No local root, native mount, launchd, production service, VM, timer, image or history operation.


D276 investigation before implementation: the unchanged local fixture passes once (Ran1/4.467s), with passed=true and cleanupFailures empty. A separate temporary copy changes only owned debug logging and denies $SYS.SERVER.*.STATSZ on the three owned routes. Its unchanged readiness gate returns, its sole first create refuses at stream-add400/peer offline (Ran1/0.917s), and cleanupFailures remains empty. The meta leader owned-raft-2 logs offline discards for owned-raft-0 and owned-raft-1 plus the exact required3/found1/peers3/result1 summary. This is a controlled counterexample to this Python gate's sufficiency, not the original CI interleaving. Scratch outputs are retained locally at /tmp/openclaw-D276-{baseline,fault}.json; no repository source was edited for these two runs. No unfiltered natural refusal was reproduced.

The pinned official nats-io/nats-server v2.12.6 server/jetstream_cluster.go peer-selection loop (lines7360–7364; fetched source SHA-256 dd80405c2587acdfa43f859cd4c650e7fd210e3ae4ccd6224b663dd58bca9516) discards a node when cfg or stats is nil. Its later online-peer quorum check can also mark an offline placement refusal. The old Python gate observes neither private cache; the failed historical error alone does not distinguish these paths. D239/D240 remain prior controlled evidence, not natural-cause proof. New diagnostics must identify their own sequential observation times and may affect fixture timing; they cannot retrospectively recreate absent startup facts.


D276 pre-audit settled — Claude87 trace/Claude89 verdict: proceed within diagnostic scope. Nine constraints are incorporated: preserve the inline gate/predicate15s/.05/503 behavior, one create/5s stream wait and all later assertions; debug only the three owned servers and pin/record2.12.6; bounded selector and verified INFO startup windows; allow-listed Node API/connected identity with non-JSON stderr retained as unparsed; a separate Python schema/helper rather than invented varz facts; exclusive0600/size-capped JSON with credential suppression and primary-error preservation; js/routes initialization and per-owner guarded kill-wait/log cleanup/Popen handle registration; JSON-only always-upload artifacts with source/attempt names; concise live diagnostics. A real fixture fault is introduced only in a scratch copy, never through an environment toggle in the real fixture. The predicate pin and each required portable failure path need designated mutants. Green-path unavailable/suppressed evidence refuses only after cleanup.

Claude89 performed source inspection, not cohort replay; downloaded official dependencies were hash-checked then removed when bounded-scope steering arrived. Its verified source trace identifies route.go:2346's unconditional route-registration overwrite of cached cfg/stats as another unobserved candidate. Append-only correction to D238's speculative heartbeat candidate: routing starts after JetStream, so a pre-JetStream heartbeat cannot reach remote peers over routes; it can affect only the server's own entry. Neither source candidate is the historical CI cause. All original natural-trigger/placement repair and operational gates remain open.


D276 final Section6: test_preservation_cluster.py, cluster_startup_evidence.py, test_cluster_startup_evidence.py, mutate_cluster_startup_evidence.py, .github/workflows/test.yml, COMPONENT_REGISTRY/DECISIONS/INVENTORY/RECOVERY_FRONTIER and this step's AUDIT_PRE/AUDIT_POST. No other source delta. The final15 portable/one actual-pair suite passes16/2.921s;22 new designated kills and13/22 existing group proof pass. Only diagnostic artifacts and owned-fixture code consume this result. Exact-source review/CI and its retained reports remain required before this auxiliary row may close; VERSION stays the parent v1.2-pre.


### 2026-10-19 20:35 EDT — D277 exact-source review correction re-orientation

Claude91 verifies all nine runtime constraints at6a6904de and independently replays16 tests/22 kills, existing13/22, the real unfiltered fixture and Python3.9 controls. It requires five corrections within the same owned diagnostic outcome: stronger one-create/no-extra-observation/503-return pins; an actual primary-plus-cleanup-failure control and finally-wrapper pin; debug config proof; forced-kill call/flag proof; and owned process-group cleanup when the new pair harness times out. The last is a demonstrated real harness hole: killing only its Python parent leaves three owned NATS children. The reviewer terminates those children and retains no production claim. This re-orientation changes no gate policy, source scope, production or acceptance boundary. The candidate's in-flight run39347338288 is requested cancelled after the required findings; its completed Linux diagnostics remain observations of that superseded source, not corrected readiness. D276 history stays intact. D277 is a source/proof correction, not a closure receipt.

The pair driver will create an owned session, TERM then bounded KILL its entire group on timeout, record group/parent cleanup separately from normal per-server evidence, and refuse. A real tiny owned parent/child timeout control and scripted escalation control will prove that boundary without root, NATS/prod ports or launchd. Proof corrections also restore allow-listed last timeout samples, decouple503 policy parsing from the recorder and test file mode under022. Route-close lines remain unretained and explicit as a diagnostic limit. No original natural trigger is established; all B5/1.2/B6–B9 and operator access/reboot holds remain.


D277 local correction proof:19 tests/5.373s,34 intended kills with18 controls; the tiny parent/child and the separate scratch NATS hang both leave their owned group absent and their Python parent waited. The NATS hang yields three shutdown markers and no individually waited server exit-code claim. The ordinary pair keeps six individually waited exit0 owners and one create each. Workflow, group-readiness function and all original predicates stay fixed. Corrected source review/CI remain required; no source/parent gate closes.


### 2026-10-19 20:52 EDT — D278 bounded C1–C3 proof correction

Claude93 clears R2/R3/R4 and confirms R5 on real NATS plus a real TERM-ignoring parent/child escalation;19/34 and the older13/22 pass as uid65534 on Python3.12, with3.9 controls/34 also passing. Runtime behavior is correct. It requires a continuous startup-to-create pin (three neighbouring sleep/query mutants), the full503 branch starting at result.returncode/startup (one forced-parsed-error mutant), and a TERM-ignoring real parent/child control that kills an always-true group-absence mutant. This is bounded proof correction within the same diagnostic unit, not another readiness change. The raw503 refusal record will also use the existing projection. Prior D277's tree removal was the local scratch experiment's own cleanup; the shipped timeout driver retains its diagnostic tree. Group absence includes zombies and depends on host init reaping; an unobserved absence remains false, never accepted as normal cleanup. D276/D277 stay intact, B5/1.2 stays pre and every operational gate remains held. Run39349290479 is requested cancelled after these required proof findings and remains superseded source, not corrected readiness.


### 2026-10-19 22:20 EDT — D279 diagnostic source evidence receipt

Only B5-CI-preservation-cluster-startup closes on d63eb330/Claude95 and all-eight CI39350641642 attempt2, with six original successes carried and exactly one replay of both failed jobs. D279 retains the first TIMEOUT and natural peer-offline reports without a cause or repair claim, corrects the pre-audit INFO-window limitation and tracks separate bounded post-failure evidence work. This is a six-Markdown receipt; no executable or VERSION change, production operation or broader gate closure. Its own review and CI are not preclaimed.


### 2026-10-19 22:30 EDT — D280 first-create failure evidence pre-audit

§0 Micro re-orient: parent1.2 remains[A]/v1.2-pre; only the D279 diagnostic prerequisite is closed.
Claude99 clears a35312c6's receipt; its CI39358395455 is still running, not inherited proof for this unit.
This unit retains missing phase-local facts for later owned CI startup cause analysis.
It serves recoverable histories; neither historical R3 nor the two new natural causes are established.
The D279 follow-up contract remains the correct next owned source unit; all operational gates stay held.

Needs pre-screen: D279's retained Linux/macOS failed and successful artifacts and raw logs are present locally and in CI; the current helper/fixture/proof files exist; fresh unprivileged NATS2.12.6 and the Node nats dependency are available. Official v2.12.6 resolves to0e0639058e0d2d8fce0cc34941f9897da152ab32. Downloaded server/jetstream_cluster.go is327946 bytes/SHA-256dd80405c2587acdfa43f859cd4c650e7fd210e3ae4ccd6224b663dd58bca9516; line4315 emits the stream-leader Noticef, and7021/7033/7035 emit the existing metadata-leader messages. The existing verified route-created INFO site remains in the allow-list.

Design: keep startup filtering fixed, but let the bounded create window retain its existing peer-selector lines plus the verified INFO route-created/metadata-leader messages and the stream-leader prefix. On an exception from the single create window, first finish its log window, then take exactly one existing2-second http_json('/jsz') call per member before owned cleanup. Retain each sequential request's start/end times and allow-listed identity/now/meta/stream-count facts; unavailable facts remain unknown. A failed member observation cannot skip another member or replace the identical primary exception. No post-failure request runs on success. The JSON schema remains additive, private/exclusive/credential-suppressed/size-capped; include the projected post-failure rows in the concise log summary so blob-inaccessible reviewers can inspect them.

§6 deltas: cluster_startup_evidence.py, test_preservation_cluster.py, test_cluster_startup_evidence.py and mutate_cluster_startup_evidence.py; six standard Markdown ledgers. Workflow wiring stays fixed. Add designated INFO-level/filter/offset controls and mutants; scripted actual-fixture create-failure controls must prove three one-shot reads after the create window and before all owner cleanup, per-member read refusal, original exception identity and zero reads on success. The normal/denied owned pair must prove INFO retention, failure-only projections, one create each and six normal exits. Update only the intentional wrapper part of the continuous source boundary pin; retain the original readiness loop,503 branch, client body, budgets and later election assertions. Existing mutation controls remain required.

Risks/limits: up to6 seconds of sequential post-failure monitoring delays cleanup, but changes no pre-create timing or request retry. Monitor replies are later sequential facts, not private-cache or exact-failure snapshots; stream counts do not prove request delivery or acknowledgement. INFO/diagnostics can affect timing. A natural refusal need not recur in this unit. Independent exact-source review, fresh Linux/macOS owned reports and all-eight CI remain required before this auxiliary row can close. No local elevation, launchd/native-image/full-root suite, production, VM or serving-NATS operation is authorized.


D280 local proof:24 tests/12.749s,50 designated intended kills/23 controls, fresh normal+denied pair with one create each and six individually waited exit0/marker/no-force owners. Normal retains stream-leader INFO; denied retains three observed post-failure jsz projections after the create window, streams0/consumers0. Every bounded window is complete. Existing startup/503/client/later assertion/workflow source remains fixed except the intentional try wrapper and diagnostic additions. The first mutator run stopped because the missing-hook mutant hit the earlier one-request assertion; correcting its expected label yields50/50. Exact-source review and fresh CI are required; no gate closes.


### 2026-10-19 22:43 EDT — D281 append-only timeout qualification

Claude101 clears D280 source/proof and requires only a timing-wording correction. The earlier “existing2-second jsz request” and “up to6 seconds” do not specify whole-request or total elapsed limits: urllib timeout=2 applies per socket operation. Continued progress can extend one request and the pre-cleanup diagnostic delay beyond that nominal sum; the reviewer demonstrated4.54s on one valid slow loopback reply. D281 withdraws the hard-time reading in all five ledgers and this pre-audit without rewriting history. Request count/retained bytes stay bounded, but no end-to-end elapsed deadline is added or proved. Source/workflow are unchanged. Corrected-head documentation review and all-eight CI remain required; the row remains[A] and every production/parent gate stays held.


### 2026-10-19 23:25 EDT — D282 first-create failure evidence receipt

Only the owned timeout-evidence source prerequisite closes on24d32299, cumulative Claude101/103 and all-eight CI39360542036. Retained Linux/macOS JSON verifies failure-only post-create samples, INFO selection, one create per cohort and normal owned cleanup. Per-socket timeout semantics supersede the earlier D280 elapsed-time wording; no whole-request or total elapsed bound is added or proved. All original and newly observed natural causes and every broader recovery/resource gate remain open at v1.2-pre. This is six Markdown files only, with no executable change and no preclaim of its own review or CI.


### 2026-10-19 23:43 EDT — D283 extraction source-pointer reconciliation

§0 Micro re-orient: step1.2 and protected acceptance remain[A]/v1.2-pre; B6–B9 held.
D282 is reviewed clear by Claude105; its own CI39364237022 is still incomplete.
Claude107 traces the existing extraction callers at exacte115f84b and finds no missing consumer.
The open extraction pointer conflates delivered owned source with real-window provenance.
Reconcile that pointer without selecting optional coverage or another diagnostic as B5 progress.
Every operational, resource, acceptance and unresolved-cause gate remains separate.

Needs pre-screen: D191/D205/D259/P/Q sources and native workflow consumers exist. Current executable/workflow/VERSION bytes equal24d32299, whose39360542036 run is independently re-read as all-eight success at attempt1. Claude107 traces stopped_journal_inputs.read_inputs/verify_stopped_journal and Q's verify_stopped_bytes consumer, the native intact/corrupt/pending/unknown/changed-config controls and the current workflow. This is prior owned source proof, not B3 origin, installed authority or B8 acceptance. No BLOCKED.md is present in this silo.

§6 deltas: six Markdown ledgers only. Reconcile the current extraction row and its Goal/Needs/Feeds/Verify wording as owned source satisfied; retain protected B3 and real-window requirements under B3/protected acceptance. Change only the B5 frontier owner pointer, then append the same D283 explanation to the five standard ledgers. Prior decision/evidence blocks, every other status, VERSION and all executables/workflow stay fixed. Do not declare all remaining integration code complete: full held/process integration, durable admission/manual restoration and D175 remain separately open and need their own bounded contract and physical proof. T3 and conditional measurement work remain open carry-forwards, not the next required recovery prerequisite.

Verify: plan lint, exact allowed-diff/history-prefix/row/frontier-cell checks and independent immutable documentation review. The original R3 repair/natural trigger and later TIMEOUT/peer-offline causes stay unproved. No source test, elevation, root suite, local native image, launchd, VM, production service, timer or NATS history operation is needed or authorized by this reconciliation. Its own future review/CI is not preclaimed.


### 2026-10-19 23:53 EDT — D284 macOS VM capacity proposal pre-audit

§0 Micro re-orient: B5/1.2 and protected acceptance stay[A]/v1.2-pre; B6–B9 held.
D283 reconciles owned extraction source; Claude109 clears its immutable documentation.
The next operator go selects preparation of the recommended resource proposal, not provisioning.
Read-only host metadata and official installer metadata now feed that proposal.
No production service/VM/image, installer download, cleanup or installed authority is released.
This outcome is a planning artifact; resource admission and physical rehearsal remain open.

Needs pre-screen: D267's dated access assessment exists, and the existing keyed host-shell identity is verified against the same production bundle/image holder. Current host13.984–13.985GiB available is below the20GiB capture floor; only production macOS and the Alpine bundle are observed. Current memory queries and two unchanged-image/holder observations are retained. Apple's official IPSW catalog is fetched as99,450 bytes and its one VirtualMac2,1 restore candidate receives HTTP HEAD200/26,637,307,067 advertised bytes, without an installer body. That candidate is27.0.1/26A434 while this host is26.6.2/25G83; host API support, minimum requirements and rehearsal-version fidelity remain unverified. No compiler, catalog-helper installation or native image operation is needed.

§6 deltas: the proposal HOST_MACOS_RESOURCE_PROPOSAL_20261019.md and normalized HOST_MACOS_RESOURCE_EVIDENCE_20261019.json in this audit directory; six standard Markdown ledgers. Add one planning-only auxiliary row/contract and update only the B5 owner pointer/resource warning. Existing20GiB capture reserve, all existing statuses, VERSION, executables/workflow and all old decision/evidence blocks stay fixed. A proposed256GiB external/separate-host workspace budgets three64GiB images,32GiB installer ceiling,8GiB fixture/evidence and24GiB reserve; candidate guest ceiling8GiB/2vCPU requires actual selected-image support/minimum validation. These are proposed caps, not observed requirements or permission. Prefer a separately designated Mac; no current on-host memory or storage admission is claimed.

Verify: document arithmetic, normalized evidence and SHA/byte bindings, scope/history/status/frontier-cell checks, plan lint and independent immutable review. A planning-only close does not close B5-macOS-access, prove a production growth bound or sufficient memory reserve, approve an OS-version substitution, select capacity, authorize installation/download/start/reboot, or replace D62/B3/B6 gates. The prior CI outcomes are checked separately and not inherited as this document's own CI. No source tests or root suite are required for this document-only outcome.


D284 pre-publication review/re-orient: Claude111 verifies supplied arithmetic and requires a complete image-object census, exact unprivileged/APFS available-space semantics, the full current-host proposal gap, a guest-derived rehearsal version and an explicit production-fidelity exclusion. Source inspection of3bc29dbd does not confirm its suggested fourth image: host_capture_anchor.held_snapshot/snapshot return digest/size metadata and publish writes JSON only; no anchored image file is created. The current capture, anchor, Q, extraction, disposal and reconciliation paths are enumerated and their six source hashes retained. Three image-sized files exist in that bounded path; future unimplemented/overlapping/failed-attempt objects are excluded until separately budgeted. No source changed for this investigation.

The initial256GiB draft is superseded by320GiB for two installer staging slots and a larger workspace contingency:192+64+8+56. This is not a fourth-image charge. The8GiB/2vCPU/64GiB ceilings remain conditional. Use f_bavail*f_frsize on the intended owner's exact APFS volume immediately before use; no added purgeable/snapshot estimates, and no same-pool/system-volume reserve claim. The current host is306.016GiB below320 before extra workload reserve, distinct from its6.016GiB capture-floor shortfall. The cause of19.513GiB net free-space loss and future growth/headroom remain unresolved. Fresh local guest metadata is26.2/25C56/VirtualMac2,1; the host is26.6.2/25G83. No26.2 restore source is identified; the27.0.1 HTTP metadata result is not compatible-image or fidelity proof. A64GiB synthetic image cannot fund or model the roughly197GiB production pipeline. These corrections remain one planning outcome; no new source, cleanup, host operation or provisioning scope follows.


Claude113 independently traces current source and withdraws Message111's suggested fourth-image finding: only capture clone_only and Q clone_fd create images; the anchor is JSON metadata. Its seven hashes match the candidate's retained pins. C1/C2 are incorporated before publication: all three images, capture and protected reader root share one APFS filesystem; with D261's proposed path, the preferred capacity is the designated Mac's internal Data volume. An external disk is not a drop-in path change. Q failure may retain the third budgeted copy and pending evidence; no new/overlapping attempt or automatic cleanup/retry is proposed. The8GiB store/extraction/restore allowance is expressly unmeasured. Draft arithmetic/scope are sound; host/guest/catalog observations remain Codex's, not independent host verification. Immutable artifact/ledger review is still required.


### 2026-10-20 00:15 EDT — D285 bounded host storage assessment contract

The next operator go continues the resource investigation with read-only host metadata. The unit measures the shared APFS pool, swap allocation/timestamps, snapshot metadata and selected directory allocations; it does not admit resources or authorize cleanup, elevation, VM/service operations, installation or rehearsal. The file delta is two assessment/evidence artifacts plus this pre-audit and matching D285 appendices in COMPONENT_REGISTRY, DECISIONS, INVENTORY, RECOVERY_FRONTIER and AUDIT_POST. One new auxiliary inventory row records completion of the bounded assessment only. Existing statuses, current frontier cells, old blocks, VERSION and all executable/workflow bytes stay fixed. Verification will recompute derived figures, check retained metadata and production identity/status/holder guards, check append-only boundaries and run plan lint. Historical free-space samples lack matching per-file and per-volume allocation baselines, so the net loss cannot be attributed from current totals alone. Broader scans, denied paths and cleanup are not silently escalated.


### 2026-10-20 00:24 EDT — D286 current-host cleanup proposal contract

The continued operator go is taken as authorization to prepare a reviewable current-host cleanup proposal, since no separate Mac was named; it is not approval to delete, clear caches, quit applications or operate production. The unit uses bounded size, installer identity, app-version/help and filtered executable metadata to classify exact candidates and distinguish reported allocation from reclaim. Deliver two proposal/evidence artifacts and this pre-audit plus matching D286 appendices in the five ledgers. Add only a planning-artifact inventory row/contract; preserve all old statuses, frontier cells, prior blocks, VERSION and executable/workflow bytes. Verify arithmetic, object/path identities, production guards, vendor-method provenance and append-only boundaries, then plan lint and independent immutable review. The output feeds a specific future cleanup decision, not resource admission. Do not widen into whole-home scans, private contents, active history pruning, a cleanup helper, actual clearing, app interruption or rehearsal.


### 2026-10-20 00:34 EDT — D287 approved two-folder intermediate cleanup contract

The operator answers go to the explicit approval request naming only arcane-semantic-dd/Build/Intermediates.noindex and Unity-iPhone-btlavqxzwobadbdkojemuxzotpjm/Build/Intermediates.noindex under the physical host's Xcode DerivedData. This authorizes removal of those two generated-intermediate trees only, with recompilation cost acknowledged. It does not approve the D286 table, whole DerivedData, finished builds, SourcePackages, logs, project/source files, installers, uv/Spotify cleanup, app interruption or any VM/service/provisioning operation. The read-only precursor maps both outputs to existing ArcaneRapture workspaces and Unity/Pods project configs, pins target/parent/sibling identities and config hashes, and observes no open files/relevant build process. No rebuild was run or guaranteed.

Refresh those exact identities/types/owners, workspace/project configuration hashes, retained siblings, bounded open-file/process observations and production state immediately before deletion; refuse on a mismatch, consumer or incomplete observation. Remove only the two approved paths without elevation, permission changes, symlink traversal or forced app/tool termination. Record any partial failure and stop rather than widen or force. Verify target absence, retained products/packages/logs and project/config identities/hashes, production UUID/status/image identity/holder/allocation, and actual Data-volume f_bavail before/after. Allocation/accounting totals are not a reclaim promise; active-host availability deltas include concurrent activity. This can restore the capture floor only if observed; it cannot admit the320GiB rehearsal or resolve memory/installer/authority/parent gates.

File delta: actual cleanup report/evidence artifacts, this pre-audit, matching D287 appendices in COMPONENT_REGISTRY/DECISIONS/INVENTORY/RECOVERY_FRONTIER/AUDIT_POST and one dedicated inventory row/contract. Preserve old statuses, current frontier cells, old blocks, VERSION and executable/workflow bytes. Verify retained evidence/arithmetic/append-only boundaries, plan lint and independent immutable review. No new cleanup helper is shipped and no local root suite or native rehearsal runs.


### 2026-10-20 00:47 EDT — D288 qualify D287 consumer-check recording gap

Claude121 finds one required receipt correction at9fc51867: the durable runtime JSON has no historical filtered process sample and its holder results omit invocation/recursion/timeout parameters. The successful one-off script's asserted checks are Codex-reported execution details, not independently inspectable consumer-absence proof in that JSON. Correct the result text and evidence limits, preserving all runtime result values, arithmetic and recorded target/retained/production facts. Explicitly say that the raw process sample was never persisted; do not imply it can be recovered from the temporary script. Holder parameters are only in the hash-bound temporary script, with no retention guarantee. No current probe can supply the missing historical observation; repeat neither cleanup nor a substitute observation.

The delta is the two existing D287 result/evidence artifacts plus this pre-audit and identical D288 appendices in the five ledgers. Preserve every existing status/contract/frontier cell, old D287/earlier block, VERSION, executable and workflow. No host operation, source change, new cleanup or new auxiliary closure. Verify old/new runtime JSON equality, derived arithmetic, artifact hashes, history/status/cell boundaries and plan lint, then exact corrected-head document review. The actual two-folder result remains complete; the receipt's unsupported recording claims are what this fixes.


### 2026-10-20 02:59 EDT — D289 approved release and held import source contract (refreshed)

Micro re-orient: Recovery1.2 remains[A]/v1.2-pre, B5-protected-acceptance-root in flight.
D288 qualified cleanup evidence; its unchanged source baseline794ad739 has all-eight own CI.
Claude135 clears the cumulative launch DESIGN contract, not source/host/artifact approval.
This unit makes one independently selected release supply every protected action's source bytes.
It feeds later installed trusted launch, not production enablement or B8/D62 admission.
The operator's continued go and D168/D261 authorize this owned source/test unit; no elevation.

Needs pre-screen: existing anchor/Q implementation and tests/probes, explicit common-entry drift-check contract, local design v6 (27619bytes/SHA256512d2f72ce4353d9380c6faef5359a775fd739a8afc9f258129efcab337e942c), Claude135's design-only verdict and a clean794ad739 worktree all exist. Installed authority, actual release approval and host/runtime profiles do not exist and are not needed to exercise fixture approval values. Source approval must later come from the independent reviewer's recomputation from immutable source, not an author-only digest.

Design: publish/verify/read/receipt all require a separate expected canonical manifest digest. A shared whole-action context opens/holds the root-controlled manifest outside the exact twelve-source directory, verifies strict schema/size/hash entries and retains exact source snapshots/descriptors. The existing reader_code consumes that context, serving eleven names including transitive imports from approved bytes only; the running anchor is compared for drift but is nonimportable and passed explicitly to Q. Refuse preloaded canonical names, pathname fallback, changed descriptor/path mappings, wrong loaded object/origin and unapproved/stale releases before action effects. Preserve existing runtime/origin, CI, uid, path and fixture-UUID refusals. The comparer detects drift/misinvocation; it cannot authenticate its own already-running code.

§6 file deltas: host_capture_anchor.py; new test_host_approved_release.py and mutate_host_approved_release.py; existing test_host_capture_anchor.py/test_host_protected_journal_reader.py and mutate_host_protected_journal_reader.py for changed API/relocated loader proof; probe_host_capture_anchor.py/probe_host_protected_journal_reader.py for the actual twelve-file CI command/manifest contract; .github/workflows/test.yml for both unprivileged proof paths; this pre-audit, immutable design snapshot PROTECTED_ACCEPTANCE_LAUNCH_DESIGN_20261020.txt, and D289 appendices in the five standard ledgers. Add only a dedicated auxiliary source row/contract and prepend its current next-action pointer to the B5 owner cell, retaining every existing requirement. Parent1.2/protected-acceptance statuses and VERSION remain pre; no earlier blocks or evidence are rewritten. No new runtime loader tree, production adapter, installer, identity adapter, root assessment, policy/challenge, disposer or B8 handoff is included.

Verify: fresh-process owned honest selection, independently expected digest refusals, coordinated code+manifest rewrite, exact/noncanonical/schema/type/size/module-set negatives, entry-to-reader/hash-to-exec/transitive swaps, preloaded/anchor-import/object/finder refusals, and designated common/per-action/held/import mutants that die at intended assertions. Existing anchor and Q semantics remain covered after updating their fixture API. Run bounded unprivileged dependent tests/plan lint, exact-source Claude adversarial review and all-eight exact-head CI. Native/distinct-owner tests run only on fresh disposable CI; never a local elevated/full-root suite or live bus. Do not claim source readiness before review/CI or physical/installed/runtime authority from fixtures. B5/1.2 and protected acceptance stay[A]/v1.2-pre; B6–B9 held, D64/Gate unchanged, production capture disabled. Disposable macOS access/resource/installer/reserve, live B3/provenance, integration/admission/manual/D175 and original incidents/causes remain open.
