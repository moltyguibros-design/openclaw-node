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
