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
