# Recovery frontier — 2026-10-17 15:16 EDT

This is the Codex desktop heartbeat's short control surface for recovery step
1.2. It does not change `INVENTORY.md`, `DECISIONS.md`, the no-stop rule, or
the criteria for closing a step. Recheck the listed evidence at every wake;
do not treat this snapshot as current merely because it is in the repo.

**Current outcome:** 1.2 is `[A]/v1.2-pre`. The OpenClaw node is not accepted
as operational. No production service or VM stop is authorized. The standalone
NATS store and all three cluster-member stores, including the held R1 member,
must remain separate until each history has an accepted preservation path.

## Critical path and advance warnings

### 2026-10-15 00:58 EDT — uncommitted B5 checkpoint verification

The v2 artifact from `c1a9df4b` and incremental D187 artifact from
`7d66baad` are applied locally, with SHA-256 respectively
`990501c5a03d2fc0a81899496914ec468ad66e0a1dcdbcf4cc7ccabbc476cecd` and
`b1abe4a3340a44fcfdac35e28b92199930df0f8d5243ade4ad17805121b2c727`.
The owned worker fixture now resolves its temporary parent before creation;
production's literal-path validation is unchanged. All 34 native macOS
host-checkpoint and real-hold facade tests pass (15.706 s), including all
13 CapturePin cases (7.795 s separately). The earlier combined 50-test run
failed those path cases before this correction and the native cold-extract
test still failed its completed-image-guard deadline. That deadline cause
is undetermined and is under bounded Claude review; no timeout was widened.
An earlier 186-test regression had 185 passes and one cold-extract failure
before ARMED appeared. No source-readiness or exact-head CI claim follows:
the changes remain uncommitted, B5/1.2 open, B6 closed, D64 unchanged,
production capture disabled, and the four histories separate.

Native follow-up: another 53 owned checkpoint/reader/timeout tests pass
(34.692 s). The checksum-verified `b1efbf48` diagnostic patch reproduced
the cold-extract failure: worker spawn +0.00 s, initial sample +0.06 s,
plist setup 0.02 s, no helper status or preflight stamp by the ARMED
assertion at +15.03 s (test 21.748 s total). This narrows that occurrence
to initial GUI helper/bootstrap work, not the later capture window.
Source inspection confirms bootstrap runs outside `gui_utm_status`'s
cleanup and a bootout error can replace the primary error. Codex/Claude
are preparing bounded diagnostics and a separately tested cleanup fix;
no deadline, acceptance rule or production setting has changed.

2026-10-15 11:03 EDT: the helper-snapshot native cold-extract run passed
(54.612 s), so the earlier startup stall is not explained or classified
as a flake. D188 strict cleanup artifact `d95253c3` was hash-verified
(`546792c05a9cae3a6498372b3d54d484d7c8c95313e18929e039e69172b58090`)
and applied: its 13 owned fake-launchctl tests pass natively (13.531 s).
Unsuccessful success-path bootout still refuses even if a later print
reports absence; primary failures retain their identity and cleanup evidence.
Late bootstrap after cleanup remains an explicit limit. Plan lint remains
14 PASS / 1 existing WARN / 0 FAIL. Publication is for exact-head CI and
review only, not source readiness or B5 closure. Production remains untouched.

| ID | Gate and present state | Owner and exact unblock action | Evidence required to clear | First downstream operation held |
|---|---|---|---|---|
| B1 | **Cleared for design only by D168.** The operator's “GO” selected the revised stopped-VM physical boundary in the reviewed candidate. A complete no-writer proof is not claimed on the live mounted Data volume. | Codex designs and tests only on owned resources. This decision gives no authority to stop or restart a production service or the VM. | D168 records the chosen boundary and its limits. B6 remains a separate, fresh, exact-window release. | Boundary design B5; never B7 directly. |
| B2 | **Cleared for the disposable mechanism only.** Codex registered a separate Apple-backend UTM VM with its own ASIF disk and a verified Alpine ISO. It started and stopped normally; while `UF_IMMUTABLE` guarded that stopped disk, UTM refused its start and remained stopped; after unlock it started and stopped normally. The production VM stayed started throughout. | Codex carries this owned result into B5's host boot controller; no further VM creation is needed for B2's guard mechanism. B5's macOS reboot rehearsal has a separate access requirement. `utmctl start` exited 0 even on the refused attempt, so the controller must check the resulting state and error. | `audits/step12_jetstream/B2_UTM_GUARD_REHEARSAL_20261012.json` records distinct VM/disk identities, ASIF format, guard refusal, unlock recovery and final states. This is not a production boot-denial certificate. | B5 controller implementation and owned tests. |
| B3 | **Just-in-time installation pins:** the October 9 candidate names `viewer-observed-20261008`; the installed viewer has since moved to `viewer-plan-task-links-autosave-20261011`. The 23-job candidate is unapproved and can drift again. | Codex resolves known structural drift now, but re-captures all 23 installed jobs and direct file hashes only immediately before an approved window. Repeating the capture before a window is scheduled does **not** count as progress. | Current installed identities and hashes match the reviewed baseline at window entry, including the five old timer pins and the exact conditional migration form. No pre-window timer reinstall. | B6 and B7. |
| B4 | **Cleared as a bounded design input:** all 23 installed plists and direct launch files, activation keys, and current GUI/user/system OpenClaw-label observations are captured. Claude's adversarial review at `ac954055` found no remaining concrete false claim. This is not a no-writer certificate. | Codex carries the identified child, deploy, viewer, bus and file-writing routes into B5; transitive and out-of-cohort writers remain fail-closed uncertainties for the window-time census and stopped-VM boundary. Re-running this static capture alone is not progress. | `audits/step12_jetstream/B4_WRITER_PROVENANCE_AUDIT_20261012.md` and its JSON cover all 23 labels, classify the only observed system-domain OpenClaw label, name re-entry edges, and state residual uncertainty without claiming pre-stop physical exclusion. | Boundary design B5. |
| B5 | **In progress, owned source/rehearsal only:** D185–D207 provide the checkpoint, host pins, bounded reader and fixture-only readonly mount. Complete native reader integration is verified at e120e78d: Claude116 closes R1/R2; all8 checks39053730664 green;54 intact reads,4 intended refusals,5 unchanged readonly intervals and known-disk cleanup. Synthetic hold/VM/UID assumptions remain bounded. Serving-NATS producer/adapter, protected host provenance, D62 admission/abort/manual resumption, D175 timer migration, default-throttle policy and disposable-macOS rehearsal remain open. D64 and production capture refusal unchanged. | Codex develops the D62 decision/scoped-observation/manual route, then D175 owned conditional timer re-pin after admission. Operator separately designates an exact disposable macOS machine or approves a measured fixed disk/RAM budget and capacity source before reboot rehearsal. No pre-B6 installed timer mutation. | Reviewed final source, decisive negatives, exact-head green CI and owned APFS reattach; actual disposable-macOS reboot/launchd/login/process/hold-reattach/migration evidence remains required. Journal is quiescence only; no physical exclusion between last stop and manifest. | Per-window release B6. |
| B6 | **Separate live-run release required.** B1's boundary choice and B5's design review never authorize a production stop. | Operator gives a fresh, explicit go/no-go for one exact attended window only after B2, B3 and B5 pass. The two-hour heartbeat may prepare and warn, but must never initiate the live stop. | Recorded window-specific authorization naming the reviewed runbook, current pins, host operator and abort contact; it explicitly names D173–D175's user-owned pre-stop evidence without root attestation, D62's ACCEPTED-or-ABORT pre-boot rule, the conditional post-admission/pre-restoration timer re-pin, and the manual-restoration fallback. Without it, B7 remains closed. | Live hold and shutdown B7. |
| B7 | **Live full-node hold and shutdown closed.** No service or VM stop has occurred for this recovery. | Only in the attended, specifically authorized B6 window, execute the approved sequence and abort on any failed precondition. No single NATS member may be stopped as a rehearsal. | Application quiescence under the approved boundary, clean VM shutdown, active host boot denial and definitive physical no-writer proof at the boundary specified by B1. | Stopped-VM capture B8. |
| B8 | **Four-store capture and isolated acceptance closed.** No three healthy cold masters have been accepted. | Bind host capture and restore tools to the four declared physical paths and volume, then restore the copies on isolated servers. | Four separately hashed path/volume/window-bound copies faithfully reproduce the observed bytes; offline streams, counts, sequences and expiring-stream treatment match. This does **not** prove historical independence of the four members; that needs deployment-time provenance outside this capture. | Step 1.2 closure and any topology change. |
| B9 | **Verified resumption closed.** A successful fixture cannot establish live recovery. | Follow the reviewed restore order, check all previously active services and writer routes, and record failures or success without claiming operational status early. | The 23-job prior state, NATS identities and routes, application health and retained histories match the approved acceptance contract. If the device changed, both D175 migration rows and the new pins match the live gate identity. Each of the five timers completes one gated run at exit code 0 after the gate opens, and the new installed hashes become the next window baseline; then step 1.2 may close. | Coordinated point 1.3 and a truthful operational claim. |

The host `ACKED.json` is its own receipt; the guest's receipt and shutdown
choice are not yet bound to the frozen journal or stopped ASIF. That is B5 work,
alongside reboot-safe restoration and the abort controller. D168 requires a
stopped-VM boundary, not a root NATS handoff before capture.
Append-only D174 narrows D173's byte-continuity and reboot claims; D175
corrects the installed timer-pin sequence. Use both for implementation and B6
review.

**B5 advance warning, found by the Claude adversarial review of `598013c3`:**
the root decline path can publish `declined` for a schema-valid user journal
with no execution hold or service-stop receipts; root admission rejects that
same forged journal. Root decline and the guest transfer entry point also
refuse production use. Do not treat a declined outcome as proof of the hold or
make it B5's next task. The capture-checkpoint design avoids that path and
retains the root transfer for later topology work. Separately, a clean VM
shutdown changes the guest boot; `Journal.recover()` refuses a full-node
cross-boot recovery before any restoration, and hold object identity may also
change. The heartbeat must surface this as **B5-reboot** if owned tests cannot
establish a reboot-safe restore-only path. B6 cannot be offered until that path
and the abort/resumption runbook are reviewed; a file edit or passing fixture
alone does not clear the blocker.

**B5-timer-pin advance warning:** the five installed production timer plists
and their manifest encode the gate's `st_dev` in launch arguments. If the Data
volume's device number changes on any guest reboot, each gated timer can
exit 78; launchd's loaded/idle state alone would miss this in B9. Owner:
Codex designs and tests D175's conditional, value-only post-admission re-pin
on owned resources. B3 pins the old installed bytes and the allowed diff just
before a window; B6 must explicitly authorize that possible in-window
mutation. B9 checks the new pins and observes one successful gated run of
each timer. Do not reload or reinstall production timers before B6.

**B5-reboot access forecast:** B2's existing disposable VM is Alpine, so it
cannot test macOS launchd, login-start and process behavior across a guest
reboot. Codex can build and test the restore-only source and use an owned APFS
image detach/reattach to test the D175 conditional device-change re-pin. D62's full mechanism
still needs a disposable macOS VM or spare Mac, never production `moltMacOS`.
Codex first checks for an existing isolated machine, installer and host
capacity. An existing machine is usable for destructive rehearsal only after
the operator designates that exact machine disposable. Provisioning a new
macOS VM needs a separate operator decision on its disk and memory budget
after that read-only assessment; running any second macOS guest on the
production host needs the same resource decision. Never quit or restart UTM or
the host, touch `moltMacOS` configuration, or test against its disk. Before
and after each test step, verify the production VM's state, disk identity and
image holder are unchanged; abort on any change. Free host space after the
installer and fixed-size test disk must remain at least the 20 GiB capture
floor plus a measured production-image growth margin, and memory must leave
the running production guest's measured reserve. This is a forecast,
not B6 permission.

**B5-macOS-access warning (2026-10-13 00:20 EDT):** a read-only host-shell
check found about 42 GiB free on the Data volume, 64 GiB physical memory with
45% reported free, and only the production UTM bundle plus the Alpine guard
rehearsal bundle. No macOS installer appeared in `/Applications` or the host
account's top-level Downloads directory. The production ASIF is about 211 GB;
no test-machine disk or memory budget has been approved. Owner: Codex finishes
the independent checkpoint, conditional re-pin and abort source/tests and
calculates a resource budget without changing the host. Before destructive
macOS rehearsal, the operator must designate an existing macOS machine as
disposable, or decide a fixed disk/memory budget and capacity source for a
new isolated guest. This blocks the D62 rehearsal and B5 closure, not owned
source work. A heartbeat warning is required; a thread warning is not a
verified ChatGPT Dot receipt.

The next two gates after a hold are **stopped-VM capture of all four physical
NATS stores** and **isolated, real-history restoration/acceptance**. Their
fixtures are useful only when bound to authentic guest/host origin and the
actual four source roles; synthetic receipts do not close them. Verified
resumption must follow acceptance, not precede it.

**B5 source validation — 2026-10-13 22:53 EDT:** draft PR #224 now carries
D180's undetermined-kickstart diagnostic and D181's pure literal NATS identity
reader plus D182's owned-controller failure evidence. The reader is not wired
into capture: checkpoint publication, host checkpoint digest commitment and
frozen-ASIF journal/config verification are still absent. It accepts the four
installed configs in a bounded read-only syntax check at their unchanged
baseline hashes; this is not a B3 window pin, NATS live interpretation proof,
origin attestation or physical writer exclusion. Member1 remains baseline-held
plus checkpoint-observed evidence, never an invented in-window stop receipt.

At parent `b453b180`, run `38500119800` passed all five jobs, and Claude's
actual-head code review found no defect. The earlier launchctl timeout cause
remains undetermined. At current head `433248c8`, 49 owned/mocked local tests
passed; exact-head CI run `38503126157` failed in the existing real-launchd
kickstart test, with all new reader/fixture tests passing. The diagnostic
observed a running owner after timeout and retained closed/unresolved
recovery. Claude found two bounded defects: bare quotes in parser scalars
and startup assumptions in two owned one-second controls; D183 fixes were published at `f9b4c37a`, whose required macOS check
also failed on the same kickstart test while all new tests passed. D184
corrections now use child-written markers to avoid hiding lost output;
source review and new exact-head CI remain required. The launchctl blocking cause remains undetermined. The owned readiness failure is also unexplained; the
fixture now preserves phase/stack/exit evidence and cleans up on failed setup
without extending its ten-second deadline. Exact-head green CI and reviewed
source remain required; neither clears B5's missing checkpoint, abort/restore
controller or disposable-macOS rehearsal. B6 remains closed.

## Heartbeat decision rule

At each wake, inspect the live plan/worktree and check B1–B9 in dependency
order. Choose one independently executable task that directly removes a named
gate, with a predeclared verification. A test or document counts as progress
only if its result changes that gate's state or establishes a required
production-bound prerequisite. Keep step 1.2 open until its runtime contract
is actually satisfied.

B1's design choice is recorded, but B6 is still closed. No automation or
agent may infer production-stop authorization from B1, the B4 audit, or B5.

An actionable blocker is itself a material event. Emit `NOTIFY` immediately
for a newly discovered or changed blocker, an overdue blocker, or a decision
needed from the operator. Name its ID, evidence, owner, exact unblock action,
and the downstream operation it prevents. A thread `NOTIFY` is an emission,
not a delivery receipt. Repeat an unacknowledged operator blocker once each
24 hours after the previous alert, even if an earlier `NOTIFY` remains in the
thread. Emit `DONT_NOTIFY` only when there is no new gate movement, no newly
actionable blocker, and no overdue re-alert.

The heartbeat's `NOTIFY` output is a Codex task notification. Delivery to
ChatGPT Dot has **not** been verified. Do not claim a Dot warning was sent
until the user confirms that this task's notification reaches Dot or a
supported connector is configured and tested.

## 2026-10-15 17:04 EDT — D189 publication evidence

586f66b7 passed all five jobs in CI run 38756995285. Claude then found a matcher read race; the local correction ties the consumed commitment to the exact pinned objects. All 14 capture-pin tests pass, and removing that comparison makes the new race test fail for accepting the forgery. Added 13 decisive predicate tests pass; all 28 local source mutants are killed, with full unmutated suite and designated controls passing. D189 records the remaining pre-stop same-uid rewrite and protected acceptance-root gaps. Earlier uncommitted notes are historical; D185–D188 are published. D189 still requires its own exact-head CI/review. No B3/B4 probes, production changes or B5 closure. Next: frozen-image extraction and serving-NATS producer/recovery adapter; planned-boot/abort, timer migration and disposable macOS rehearsal remain open before B6.

## 2026-10-16 11:33 EDT — bounded reader publication

60c5df17 passed all five CI jobs(run38878713529). D191 adds only the pure/unmounted journal/config reader and its CI tests:29native tests pass and42mutants are killed. Fresh preservation metadata census reconciles the exact three retirement-evidence files; no production files changed. Native mounted-image ownership/read-only/copy validation and B3host-table provenance remain open, along with serving-NATS producer/adapter and plannedboot/abort/timer migration/macOS rehearsal. B3/B4 were not repeated. D191 needs its own exact-head CI/review; B5open,B6closed.

## 2026-10-17 00:48 EDT — current B5 source reconciliation

The B5 table above supersedes its earlier missing-checkpoint description.
Checkpoint/host commitment/frozen verifier and the pure reader exist at
published 5b6c84af; all five jobs of CI 38930108319 are green. That does not
close their missing operational producer, protected provenance or reboot
requirements. B1 remains design-only; B2 is the Alpine guard mechanism only;
B3 stays just in time, B4 remains a bounded input, and B6–B9 stay closed.
No B3/B4 recapture or production probe was performed in this reconciliation.

The uncommitted fixture mount wrapper has 60 scripted native tests OK (one
Linux platform-guard skip), 30 reader tests OK and 119 intended-reason
mutation kills. These are fake disk commands, not native mount evidence.
All 46 reader mutations are killed for the intended reason, with unmutated
controls passing and no runner problems. A separate scripted cleanup
counterexample issues a foreign eject after an applied timeout/disk-number
reuse and reports clean; Claude confirms this gap and related probe cleanup
issues. **B5-probe-cleanup** is owned by Codex: correct and decisively test
the probe before publication or native execution. It remains unwired.

Next two independently executable gates: **B5-owned-journal-mount source**
needs final Claude review, decisive tests and green exact-head CI, with no
additional production access or authorization; **B5-native-ASIF-mount**
needs that reviewed source and an isolated CI macOS runner, a fresh probe-
created image and the ownership/read-only/identity/cleanup report. Neither
substitutes for B5-macOS-access or the operator-designated D62 macOS reboot
rehearsal. A new VM still requires a concrete capacity/RAM proposal and
operator resource decision before creation; no such budget is approved.


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


2026-10-17 04:45 EDT — D194: B5-owned-journal-mount source is verified at
151bb3bdbcdf0bd09c7d15e6f0679832edae6a3d: all five exact-head jobs pass
(39011578564), including mount71 and reader30; Claude Messages85/89 report
no material defect. The CI-owned kickstart completed at exit0 in9.026776584s
without changing its10s limit. Earlier failures remain unexplained, and no
runtime recovery rule changes. B5-native-ASIF-mount now gets a separate
GitHub-hosted macOS job using only the existing guarded probe and a newly
created64MiB image, with unconditional report retention. This workflow
revision needs its own Claude review/CI. Probe exit0 alone never clears the
gate: inspect ownership/root0600 denial, exact flags/UUID/inventory, image
hash/ctime/xattrs and confirmed cleanup. No local mount or VM operation.
Next two gates: native ASIF characterization (CI-only owned resources under
B1), then owned stopped-ASIF reader integration (reviewed adapter, native
positive/refusal fixture and exact-head CI). Disposable macOS reboot access
remains separately operator-owned; B3/B4 stay just-in-time/bounded and were
not recaptured. B1 design only, B2 Alpine mechanism only, B5/1.2 open,
B6–B9 closed, D64 unchanged and the node not operationally accepted.


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


### 2026-10-17 13:12 EDT — B5-owned-stopped-ASIF-reader candidate (D204)

The CI-only ownership probe now has a separately guarded complete-reader mode. It seeds
the existing synthetic checkpoint fixture with the actual fresh ASIF UUID before commitment,
then tests intact/corrupt-chain/pending/unknown/changed-config cases through the real locked
wrapper and frozen verifier. Each readonly interval must preserve the image identity/bytes
and pins and confirm its attached disk gone. All85 portable mount/probe controls pass
(one platform skip); Claude review, native report and current exact-head CI are pending. This is not
a VM capture, guest UID parity, pre-stop writer proof or B8 acceptance. B5/1.2 remain open,
B6–B9 closed, D64/production-capture refusal unchanged. Production was not touched.

D204 review correction: Claude114 finds no reader-mode source defect but requires outer
negative coverage. ReaderRun now covers image/pin/head changes, partial later-case failure
and cleanup/interrupt outcomes; failed native reader runs retain their own image for a
CI diagnostic artifact. Local91 tests pass (one skip); all4 committed guard mutants die
for intended assertions. This corrected revision still needs Claude and exact-head CI;
B5-owned-stopped-ASIF-reader is not yet closed. No production operation occurred.


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

### 2026-10-17 14:50 EDT — B5-D62-release-fence candidate (D206)

Before building decision admission, close the existing incomplete-capture reconcile
release route: production invocation now refuses at entry, before any filesystem/output,
lock, preflight or image-flag operation. Four scripted tests pass; the old source and a
deleted-fence mutant both fail the two intended production assertions while the owned
controls pass. Fifteen portable capture/guard controls pass. Native fixture regression,
Claude and exact-head CI remain pending. This is a refusal prerequisite, not the missing
ACCEPTED/ABORT producer or D62 admission. The next two gates need reviewed host decision/
cleanup source using the arm/commitment/checkpoint/capture bindings, then guest scoped
job/process admission and manual fallback; D175 follows admission. B1 provides source/
owned-test authority, no new access needed; actual macOS reboot still needs separately
designated disposable access/resource approval. No B3/B4 recapture or production change;
B5/1.2 open, B6–B9 closed, D64 and production capture refusal unchanged.


### 2026-10-17 15:16 EDT — B5-D62-release-fence verified (D207)

Reviewed runtime source e6543580 / all8 CI39059651789 green. Native job
117474802932 includes all7 reconcile tests; Linux all4 fence controls pass.
Claude122 independently verifies both intended fence-removal failures and the retained
owned controls. This receipt strengthens only fixture directory modes, tested independently
at umask022; runtime/workflow bytes remain identical. Production reconciliation refuses
at entry; it does not supply ABORT, ACCEPTED or admission. D207 retains Claude126's
design corrections: cleanup before terminal ABORT; no sampled-flag continuity claim,
host-reboot exception or automatic release for a missing checkpoint/interrupted guard.
Next: corrected host abort-cleanup decision source/owned tests, then scoped guest boot
admission/manual restoration before D175. B1 authority covers source/owned tests; both
need decisive controls, Claude and exact-head CI. Actual macOS reboot still needs
separately designated disposable access/resource approval; no VM is provisioned. B3/B4
not repeated, B5/1.2 open, B6–B9 closed, D64/production capture refusal unchanged.


### 2026-10-17 15:52 EDT — B5-D62-owned-abort-cleanup candidate (D208)

The existing clone-disposal module now has a completed-capture-only abort-cleanup
operation with an entry-first production refusal. It consumes existing real checkpoint/
commitment/capture validators, both exclusive locks relative to a pinned capture directory,
original-host/guard bindings and stable source/clone bytes. Root fixed-name atomic intent
and cleanup records flank only clone unlink; the clone descriptor remains open and must
report link count zero. Capture already left its flag clear: cleanup refuses an immutable
clone and changes no image flag. Source denial stays applied as sampled, never released.
Existing MATCH/JOURNAL_INPUTS receipt bytes are pinned before further clone reads are
foreclosed; they supply no acceptance. The host-spec hash is a forward pin only.

Claude134 challenged unlink identity, lock self-deadlock, atomic publication, sibling
policy and claim scope. The candidate uses direct preflight under locks, descriptor-based
unlink/link-count verification, root atomic markers and a cleanup-only sibling-clone rule;
a sibling CAPTURE without a clone remains evidence and is allowed. Reconcile's stricter
rule is unchanged. Claude136 accepts retaining the existing mount binding imports and
real HostCheckpoint fixture producers; the exact candidate source still needs review.
The existing shared mount helpers gain only optional directory/held-descriptor inputs;
old callers retain their behavior. No parallel decision controller is introduced.

The fixed abort-cleanup diagnostic directory or either root final/temporary marker makes
all retries refuse for manual handling. A failure after rename but before successful
parent fsync may leave a complete visible receipt with FAILED.json: receipt presence is
not success and future terminal consumers must reject failed/partial attempts. Intent
survives failure. This is a cleanup prerequisite, not terminal ABORT, ACCEPTED, BOOTABLE,
D62 admission or a manual restoration implementation. Same-uid path/flag interference
between observations remains D189's limit; a swapped unlink can be detected by the held
inode but is not atomically prevented. Unlink does not destroy shared image bytes.

Verification in progress: portable real-producer fixtures, decisive identity/pin/lock/
attachment/interruption/publication/replay negatives and guard mutants, existing mount
regression, Claude and exact-head CI. Native flag/ASIF cleanup and actual reboot are not
claimed. No source readiness or gate closure yet. Fresh PR head f83317d3 had all8 checks
success before this candidate. Governance recheck: B1 source/owned only; B2 Alpine is a
bounded historical guard rehearsal; B3's23 pins remain JIT; B4 remains bounded design
input, neither repeated. B5/1.2 open; B6 has no exact attended-window release; B7–B9 remain
held with no production capture, real-history acceptance or verified timer resumption.
D64 and production capture refusal remain unchanged; all four histories stay separate.

Next: terminal ABORT production/strict consumption after checked cleanup, then scoped
guest job/process admission/manual restoration before D175. Both source gates use B1
owned resources, need decisive negatives, Claude and their own exact-head CI; ACCEPTED
still requires a real B8 producer. Actual macOS reboot still needs the operator's exact
disposable-machine designation or measured disk/RAM/capacity decision. No production
service, VM, image or installed timer was operated.


2026-10-17 16:01 EDT — D208 append-only correction, candidate not ready:
cef42140's scripted holder seam hid a real refusal: retained clone_fd makes the
legacy no-holder lsof check report our own PID. The new cleanup-only observation
requires exactly the current PID and known read-only descriptor in lsof's p/f/a/n
fields, no other own/foreign descriptor and no attachment. No image flag changes
are added. An owned regular-file macOS control observes that exact descriptor and
refuses an extra own writable descriptor; it is not native ASIF cleanup or a VM
rehearsal. The original ARMED scope is also checked, with a negative that consistently
re-pins all later records. Thirty controls including the native lsof case and seven
focused mutants passed before this last scope control; final31/eight-mutant runs
and exact-head Claude/CI are pending.

The first cef42140 CI39064371810 has Node22 job117488789488 failing at unchanged
cluster-replicated-r3-create with NATS400 peer offline, before any new Python test.
Raw job-log SHA256 a223c756b1a7c353586048e484d9605bfe8120fd803bc2a378c108446e47485b.
Six other jobs are green; full macOS remains running at this observation. It is
not a green source proof. One specific-job rerun request was refused while the run
was in progress; no blind retry or unrelated fixture rewrite was made. The corrected
candidate needs a new exact-head run in any case. B5-exact-CI is Codex-owned and
holds source readiness; no new operator authority/access is requested. D64, B6–B9,
production capture/reconcile refusals and all production resources remain unchanged.
