# Recovery frontier — 2026-10-18 04:25 EDT

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
| B5 | D240 clears only owned R3 failure evidence at94bc8e76/all8CI39171957048/Claude357; receipt86ff2461 is clear359/all8CI39174246835. Original placement repair, natural trigger and current observer remain open. D239 clears only corrected owned placement diagnosis at5e931120/all8CI39164238245/Claude349; own receipt review/CI pending at commit. Failed D237 native history retained, no rerun; original repair/natural trigger/current observer open. D237 records source evidence for owned placement-gossip diagnosis atfa9f0a4a/all8CI39158146598/Claude343; receipt-own review/CI pending at commit. Original placement repair/natural trigger/current observer open. D235 clears the owned group-readiness prerequisite at08f90df7/all8CI39149352811/Claude331; receipt-own review/CI pending at commit. Placement/current observer remain open. D233 closes shared entrypoint whole-value classification at source4abd6360/all8CI39140772095/Claude321; owned path/caller portability only. | Codex's next owned source gate is the serving-NATS recovery adapter, prerequisite to its persistent-stop producer and owned capture-ready checkpoint. Current inventory/override/fresh-D60 observation, full held/process integration, durable admission, manual restoration and D175 remain separate. Operator separately designates disposable access or decides a measured resource proposal. | Reviewed exact-head source/CI; distinct native full pipeline, APFS reattach and disposable-Mac reboot/login/process/hold/migration evidence. D189 and pre-stop limits remain. | Per-window release B6. |
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


2026-10-17 16:10 EDT — D208 append-only scope correction after Claude142:
The exact holder filter excludes additional descriptors visible to lsof as the calling
user; it is not a cross-user descriptor census on macOS. The separate hdiutil inventory
checks visible image attachments. Neither observation supplies physical exclusion or
continuous denial. The earlier unqualified “no other own/foreign descriptor” wording
is superseded by this visibility limit. Optional evidence pinning covers only MATCH.json
and JOURNAL_INPUTS.json one directory level below the capture root, not arbitrary files
or receipts elsewhere. The source hashes an owned0600 single-link source as a deliberate
owned-fixture precondition; native ASIF liveness at other modes remains unproved.

Claude142 finds no required source defect at cf98b242 and independently reproduces31
controls (one Linux platform skip), all8 intended mutants, mount91 controls, capture
and reconcile controls as uid65534. It verifies real per-role frozen stores can precede
cleanup while the extracted root stays0700. The native single-fd observation remains
Codex's macOS evidence; Claude used Linux. Four optional surviving guard mutants now
receive focused test-only negatives for post-unlink decisions/sibling clones, intent
read-back, final intent binding and pre-unlink named-entry binding. Runtime/workflow
bytes are unchanged. SourceCI39065020767 remains pending; no source closure yet.


### 2026-10-17 16:32 EDT — B5-D62-owned-abort-cleanup verified (D209)

Verified runtime source cf98b242ad0fa69581dc8ea5e87e051a473c3125, exact CI39065020767 all8 checks success.
CI checkout merge bfe3c82b9f010b590d5b6cb150600c93c2aeb022 has blob-identical step12 sources/tests
and workflow, independently checked against the source head.
Native macOS job117490728969 runs all31 cleanup controls, including the
actual owned regular-file lsof single-readonly/extra-writable-descriptor observation,
and kills all8 source guard mutants. Raw native job-log SHA256 2beceeb79790de542833306808bce20213a3411473a838f31ea98885c3283d0e.
Linux Node22 also passes the complete JetStream step; its macOS-only lsof control is
skipped there. The earlier unchanged R3 fixture failure did not repeat on this head;
no claim that its cause was fixed follows. Superseded cef42140 run39064371810 is
cancelled, with its failure evidence retained, never relabelled green.

Claude142 independently reproduces31 controls with one Linux platform skip, all8
intended mutants, mount91 and capture/reconcile controls as uid65534, and finds no
required source defect. Its required visibility wording is corrected append-only:
lsof covers descriptors visible as the calling user, not a cross-user holder census;
hdiutil inventory is a separate observation. Only one-level MATCH/JOURNAL_INPUTS
receipts are pinned. No continuity, physical exclusion, byte destruction, authorship,
real-history acceptance or native ASIF cleanup claim follows.

This receipt strengthens tests only: four optional surviving guards now have decisive
negatives for late terminal/sibling appearance, changed intent read-back, changed final
intent and a clone swap before the named-entry check. All35 controls pass locally on
macOS; the committed runner passes its controls and kills all12 intended mutants,
with no runner errors. Runtime and workflow bytes are unchanged from the verified
source above. The receipt head still needs its own exact-head CI before readiness.

B5-D62-owned-abort-cleanup closes only this nonterminal owned cleanup prerequisite:
no image flag changes, no terminal ABORT/ACCEPTED/BOOTABLE, no source release or guest
admission. Intent/final/temporary markers or the single-use abort-cleanup directory
make every retry manual. A visible receipt beside FAILED.json is not success; future
terminal consumers must refuse failed/partial evidence. D64 and production capture/
reconcile refusals remain unchanged. B5/1.2 stay open at v1.2-pre, B6–B9 held; B3/B4
were not repeated, all four histories remain separate, and no production resource was
operated. Actual reboot behavior remains unproved.

Next two gates: B5-D62-host-terminal-abort must strictly consume cleanup and all original
arm/nonce/checkpoint/capture/guard/host bindings, reject failed/partial/stale evidence,
recheck physical cleanup under active denial, then publish durable ABORT before a
separately checked owned source release. ACCEPTED still needs a real B8 producer;
MATCH, JOURNAL_INPUTS and the release verifier's byte-only VERIFY are not that decision.
B5-D62-guest-admission/manual then needs that host-decision binding before any gate opens,
all OpenClaw launchd jobs plus every process as the OpenClaw user or executing from
production entrypoint roots compared before Journal.recover, unreadable/unexpected
observations refused, then stopped-unit/override checks and an explicit manual route.
This scope is not a complete physical process census. D175's conditional five-timer
value-only migration follows admission and precedes gate construction; same-boot checks
remain. B1 authorizes source/owned fixtures for both gates; no new VM access is needed
for source work, and each needs decisive controls, Claude and exact-head CI. Actual
macOS reboot/login/hold-reattach and D175 rehearsal still need an exact operator-designated
disposable machine or a measured fixed disk/RAM/capacity decision. No VM is provisioned.


### 2026-10-17 17:18 EDT — terminal ABORT candidate (D210)

Existing clone disposal now produces a fixture-only cleanup-bound ABORT and verifies
canonical exact schemas, original capture/guard/host bindings and forward sample pins.
A matching COMPLETE after post-publication checks is mandatory; visible ABORT beside
FAILED/temp/partial evidence refuses. The core verifier reads under caller-held locks
and caller-supplied fresh observations, returns bytes only, and changes no flags.27owned
terminal tests pass94.927s; mutants/regressions/Claude/exact-head CI pending. This is not
source readiness or release/admission. D64 and production refusals remain; B5/1.2open,
B6–B9held, B3/B4 not repeated, four histories separate. Next: checked owned source release,
then guest scoped admission/manual restoration before D175; actual macOS reboot remains
operator-access/resource-gated. No production operation or local image/VM action.


2026-10-17 17:30 EDT — D210 correction: two distinct descriptors are now required by
both core verifier and shared pin reader; flock ownership remains the caller's duty.
Shared preflight exclusively pre-creates both helper logs0600 before bootstrap, keeping
the strict reader.29terminal tests,15status tests and14intended mutants pass locally.
The existing CI native capture fixture now checks real sample ingestion and log modes;
that assertion, corrected-head Claude and CI are pending. No native terminal pipeline,
source release/admission or B5 closure. See D210 for unobserved old native mode and scope
corrections; production, D64, installed timers and all four histories remain unchanged.


### 2026-10-17 17:58 EDT — owned terminal ABORT source verified (D211)

Verified source00264a3c / CI39071272275, all8 checks green; native117509228208 passes
real before-shutdown/after-guard sample ingestion and private-log assertions,16capture,
29terminal/15status controls and14intended mutants. Native log SHA2564ebd019ed8bdc493bad382baf8386c5185ccd8864a3634f0c2afe9e38ec1638c.
Claude158 independently verifies controls/mutants as non-root, with no required finding.
This closes only B5-D62-host-terminal-abort source: no release, guest admission or boot.
Native terminal pipeline, protected provenance and actual macOS reboot remain open;
D64/production refusals unchanged, B5/1.2open, B6–B9held, B3/B4 not repeated and four
histories separate. Next: checked owned source release, then scoped guest admission/
manual restoration before D175. Receipt head still needs exact-head CI.


### 2026-10-17 18:40 EDT — owned ABORT source-release candidate (D212)

The existing reconcile module now has a fixture-only checked release and read-only
released-source verifier, with exact canonical schemas, consumer-established file/full-
flush and directory barriers, original host/source/ABORT/cleanup bindings, one source
flag call, post-clear rehash and a fixed single-use attempt. Claude166/168's seven
design corrections are incorporated. Ten intended-assertion mutants pass with their
unmutated controls. An initial barrier-skip mutant survived because the test's blanket
flush failure was reached again by the separate sample-file barrier; narrowing that
fault to the original ABORT evidence table kills removal at its intended assertion.
This was test masking, not a changed runtime permission.32release controls are being
verified after the lock/sample/identity additions; earlier28 pass26.456s. The combined
61release/terminal/fence controls pass88.299s. Exact-source Claude and exact-head CI
remain pending; no source readiness or B5 closure is claimed.

Every failure after flag-call entry is manual with flag state uncertain, never automatic
re-guard/retry or a denial-held claim. A visible COMPLETE is not proof a prior process
returned successfully; future admission must consume evidence under its own contract.
Native complete cleanup→terminal→release and real guest reboot remain unproved. D64,
production capture/reconcile fences and installed timers are unchanged; B5/1.2 open,
B6–B9 held, B3/B4 not repeated, four histories separate. No local image/VM/launchd or
production operation occurred.

Next two gates: B5-D62-guest-admission/manual needs host decision binding before any
guest gate, all OpenClaw launchd jobs and every process as the OpenClaw UID or executing
production entrypoint roots compared against the recorded hold before Journal.recover;
unexpected/unreadable scoped observations refuse, then stopped-unit/override checks and
an explicit manual route. This is not a complete physical process census. B5-D175-owned-
repin follows admission before gate construction: conditional journaled value-only
changes to the five owned timer plists and manifest only if the device changed, with
stable inode/birthtime/nonce/volume/path and same-boot descriptor checks. Both use B1
source/owned authority, decisive negatives, Claude and exact-head CI; APFS reattach and
actual disposable-macOS reboot/login/process/hold/migration rehearsal remain distinct
requirements. Actual Mac access still needs an exact operator designation or a measured
fixed disk/RAM/capacity decision; this gate provisions nothing.

D212 pre-publication update: all32 owned release controls pass32.834s; all10 mutants
are killed at their designated assertions.61bounded release/terminal/fence regressions
pass88.299s. Review and exact-head CI are still pending. No source readiness claim.


D212 required correction B5-release-freshness: c8aa can clear once after an INTENT-time
holder change before its after sample refuses. Owned reproduction only, no COMPLETE.
Codex corrects the last live pre-clear observation and exact guarded metadata/clone/
attachment/sibling checks, bound through COMPLETE; Claude172 confirms design. Corrected
review/CI still required; source row open. CI39076032148 Linux failed earlier in the
unchanged R3 placement fixture, tracked separately as B5-CI-R3-placement; no waiver.
B5/1.2 open, production/D64 unchanged, next scoped guest admission/manual then D175.


2026-10-17 18:50 EDT — D212 corrected candidate proof, still not source ready:
All40 owned release controls pass48.522s. All13 mutants are killed at their intended
assertions with unmutated controls and no test errors. The c8aa holder-at-INTENT
negative fails with one flag call on old source and passes with zero calls after the
new last observation. Pre-clear clone/attachment/sibling, exact ctime/metadata, host
state/identity, unreadable observation and consumed-file parity negatives also pass.
The positive asserts no whole-image rehash between the last live sample and clear;
COMPLETE binds that sample and read-only verification refuses altered bytes. The
ctime fixture preserves the old inode while replacing the path, avoiding inode reuse.
The ordering mutant now moves the flag operation itself before INTENT; the old mutation
produced a setup/file-read error after the new readback guard and was rejected by the
runner. The sibling mutant anchor is now exact to its line/indent after a second
clone-only check was added. Neither runner error was counted as a kill.

Claude172 accepted the corrected design and named the final cheap checks; exact-source
review and current-head CI remain pending. Local Python3.9.6/darwin exposes F_FULLFSYNC51
and the real owned-file barriers pass; current CI native behavior still must be read.
No source readiness, native whole pipeline, guest admission, boot, B8 acceptance or
production recovery claim follows. B5/1.2 open, B6–B9 held, D64 and production fences
unchanged; next guest scoped admission/manual, then D175. No production operation.


### 2026-10-17 19:21 EDT — owned source-release prerequisite verified (D213)

Source004b1ce5 exact CI39076640535 all8 green; Claude174 closes source R1 and finds
no required source defect. Native117525047608 supplies R2 observation:40controls24.107s,
13intended mutants and actual owned-file barriers on read-only descriptors; raw SHA256
de0dc1d6a82c99f5556b494ce394bef4b1114c0c446ab8ae75872d4a3fad43d2. This is not native whole-pipeline,
VM reboot or boot/admission permission. X6 optional final-byte-rewrite negative and
B5-CI-R3-placement remain tracked; D189/protected provenance and helper no-op limits
remain. B5/1.2 open, B6–B9 held, D64/production/timers unchanged, B3/B4 not repeated.
Next guest scoped admission/manual route, then D175 owned conditional re-pin; source
authority B1, decisive controls/Claude/exact CI, separate APFS and real Mac access/evidence.
This evidence-only receipt head must obtain its own exact-head green CI.


### 2026-10-17 20:13 EDT — owned pre-start restore-prior decision candidate (D214)

Existing host_vm_reconcile now records a fixed single-use owned RESTORE_PRIOR after the
completed ABORT/release chain and a fresh unchanged original-host stopped sample; its
read-only verifier is pre-start only. The pure restore_only claim decoder checks the
external digest and local checkpoint, returns authority unprotected-user-owned/admission
false and performs no recovery or filesystem operation. Claude187's four design points
are included; changed-host-session/post-start weakening, automatic platform-process
allow-lists and nested DECISION names are excluded.25 controls pass46.114s; mutants,
regressions, exact-source review and exact-head CI remain pending. D214 records the
Codex-owned B5-gate-device-reattach dependency: all four saved device bindings need a
reviewed per-filesystem stable-identity mapping before D175/gate construction can close.
Manual guest restoration remains future work, not an available command or bypass.
B5/1.2 open, B6–B9 held, D64/production/timers unchanged; B3/B4 not repeated. Four
histories separate. Next guest scoped admission/manual, then D175; actual Mac access
and APFS/reboot proof remain distinct. No production/native image/VM/launchd operation.


D214 pre-publication verification: all27 owned decision/claim controls pass47.922s;
all13 mutants are killed at their designated assertions with unmutated controls passing
and no test errors.45 bounded release/production-fence/D64 regressions pass63.547s.
The attempt-directory fsync/open failure path now enters best-effort FAILED recording;
its new negative preserves the original exception and retained manual attempt. Rebinding
both INTENT/RESTORE_PRIOR to a wrong evidence table refuses. AST comparisons confirm
reconcile, release_aborted, verify_release, abort_conflicts, no_terminal, terminal_abort,
verify_abort, recover_owned and Journal.recover are unchanged. Linux/macOS registration
adds the new27-control suite and13-mutant runner only. Plan lint14PASS/1existingWARN/0FAIL.
Claude187 design corrections are included; exact-source review and new exact-head CI
remain required. No source readiness, guest admission/manual route or B5 closure yet.


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


### 2026-10-17 21:06 EDT — owned pre-start decision source verified (D215)

Source d5636b54 / CI39083436062 all8 green; Claude195 reproduces33controls/20mutants
as uid65534 and closes every material193 proof gap plus previous/flags, no required
finding. Native117544960569 runs33controls16.121s/20decision kills (59 with prior runners),
raw SHA256 d63ed33a35dcc81d808077e8c9c8a46b5359f57efd54079a669afa581aeda128. Native/Linux merge34a3bd5a
has identical recovery/workflow bytes; Linux117544960755 passes33controls15.620s/20kills.
Earlier3cbc / CI39082522585 all8 is separately27/13 native15.531s, never relabelled33/20;
aa340975 CI39082243166 canceled, not green. Only the owned source prerequisite closes.
The decoded digest remains an unprotected claim with admission false; no boot or guest
recovery authority. VM/flags scripted; actual owned-file barriers are not native whole-
pipeline, physical authorship or real reboot proof. D189/protected provenance and the
explicit optional notes remain. Source feeds claim decoding, then guest scoped admission/
manual route before D175. B5-gate-device-reattach, serving-NATS adapter and actual Mac
access/APFS/reboot evidence remain open. B5/1.2 pre/open, B6–B9 held, D64/production/timers
unchanged; B3/B4 not repeated and four histories separate. This five-Markdown receipt
head needs its own exact-head green CI; no production operation or local native image/VM/launchd operation.


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


### 2026-10-17 22:25 EDT — D216 whole-argument scope correction candidate

An independent argv-with-spaces symlink reproduction falsely excluded an
other-UID root process at ffd7cb8c. Whole process arguments are now resolved
before the unchanged shared plist classifier. Local40 controls/28 intended
mutants pass; corrected source review/CI remain pending. Superseded run39089415728
was canceled, not green. No admission, production or shared-API change.


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


### 2026-10-17 23:02 EDT — owned process diagnostic source verified (D217)

Source81ac425be0c7e6115e4ed1ea7e1ec2a55de6049f passes all8 jobs in
CI39090362566. Native117565607992 passes40 tests7.552s and29 intended mutants;
the unpatched owned-runner scan refuses, matches the independently expected C
child, and reports516 unknown entries/299 unexpected rows. Unknown entries are
not distinct process counts; no per-reason or complete-table measurement is
claimed. Linux117565608002 passes40 tests0.130s with one native skip and29 mutants.
Claude215 independently reproduces40/29 as uid65534 (native skipped), verifies
unchanged runtime/workflow and closes the directory-root proof gap with its
independent equality-only mutant. No required finding remains.

Checkout mergee2529cd5b01f9b5502c381271a54b97ff9589bb1 has source81ac425b as
second parent and identical recovery, lib/bin/test/workspace-bin and workflow
bytes. Native raw log SHA256 c58ce17e2e05bb53e1805d6fdf58b1dfd94452c635854b9bba64a6c754d5259b;
Linux raw log SHA256 47c040b3163577ae5fcf76a67b1fc630f4eddea3737793eb470f5f11aa2aa2d2.
The committed native excerpt B5_SCOPED_PROCESS_DIAGNOSTIC_NATIVE_EXCERPT_20261018.txt retains the result/count lines, not a full table.
Excerpt SHA256 5652932eea85c0f37413e6c61dbb63b82325ff103197b4bbd6b7c69e0dcf6d8f. Earlier runs39089415728 and39090103107 were canceled for the
required scope fix and its proof extension; neither is green evidence.

Only B5-D62-scoped-process-diagnostic closes as an owned source prerequisite.
B5/1.2 remain open/pre, B6–B9 held, and D64, production, journal/Gate/census APIs
and installed timers unchanged. No production operation or local full scan ran.
Current-boot test expectations grant no boot policy, eligibility or admission;
loaded-image, sampling, same-UID D189 and physical-census limits stay. Next is
explicit pre-window process-policy binding, then a separately reviewed boot
comparator/observer contract and durable admission record before manual/D175.
Actual disposable-Mac access, APFS reattach and reboot rehearsal remain separate.
The receipt changes evidence/docs only; its own exact-head CI/review is pending.


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


### 2026-10-17 23:56 EDT — D218 local binding candidate proof

Local47 portable controls pass5.229s; the44-mutant runner reports intact controls
and44 named intended-assertion kills, never counting ERROR or an unrelated crash.
The combined47 new and277 existing journal/checkpoint/host-commitment/stopped-reader/
scripted-full-node controls pass324 tests162.378s. The first runner assertion token
was corrected to the actual Refused class before any source commit; no failed
runner invocation is counted as proof. Local plan lint14 PASS/1 existing WARN/0 FAIL;
the warning is the existing idle step machinery, not a new close or version bump.

The new honest producer and frozen/image positives use actual owned file bytes,
Journal writes, checkpoint/commitment code and the stopped reader. VM, launchd and
execution-hold observation remain existing scripted facades; this is portable
source evidence on macOS, not a native full-node/reboot/eligibility proof. Only the
two existing Journal constructor/open bodies change (AST comparison to4e3605bf);
recover/D64, forward/capture/frozen verifier bodies and every other existing
executable remain unchanged. The new validator performs no filesystem or process
observation. Complete initial-receipt sizing covers capture-compatible creation
states only, not future post-boot writers or the16MiB whole-lineage read budget.

Exact-source review and exact-head green CI remain pending. The candidate row
stays open; B5/1.2 pre/open and B6–B9 held. No production service, VM, timer, mount,
resource provisioning, new live process scan, policy enrollment or admission.


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


### 2026-10-18 00:40 EDT — owned authored process-policy binding source verified (D219)

Source ee311fcd24f63df8439e0337588708831f4ff47a passes all eight jobs in
[CI39096484480](https://github.com/moltyguibros-design/openclaw-node/actions/runs/39096484480).
Native job117583902913 passes49 controls in1.188s and all46
intended-assertion mutants with intact controls. Linux job117583902984 passes49
controls in1.113s and46 intended mutants. Both complete raw logs were
read by Codex; no ERROR or unrelated failure is counted as a mutant kill.
Native raw-log SHA256 e034f1a9d62af75ebfdfea48c30b9cf7c73adcc5c75266b267afa72761fb2a1e;
Linux raw-log SHA256 0c024fb7cb08be81448d74270b8a5ef91b62ebb667734bc1adbab91895927eea.
Both logs name checkout merge 6c079518c14761e8ed684d0d51e07f7ee8ff1f9f, whose
second parent is the reviewed source and whose whole tree is identical to it.

Claude229 independently reproduces49/46 as uid65534 and finds no required issue.
Its independent checkpoint-before-policy reordering variant, a variant wrapping
policy errors into checkpoint-worded refusals, and the image pin-equality mutant
all fail the new assertions. Claude227's required proof gap is closed; its six
remaining non-blocking strictness/proof limits stay in INVENTORY. Runtime and
workflow bytes are identical to433966aa; the earlier324-test regression remains
that earlier common-executable run, not a new combined run. Superseded run39095435399
was cancelled for the proof correction and is not counted green.

Only B5-D62-process-policy-binding closes as an owned source prerequisite.
The optional new full-node baseline field binds authored generation-free claims
to the externally pinned checkpoint; every supplied-policy reopen route refuses,
and both actual initial serialized files fit the existing1MiB reader bound.
Owned producer/frozen/image positives use real owned file, Journal, host commitment
and stopped-reader code; VM, launchd and hold observations remain scripted.
This proves checkpoint consistency, not policy authorship, pre-stop authenticity,
completeness, satisfiability, live enrollment, record-time eligibility or admission.
The executable hash remains an on-disk claim, not loaded-image evidence. D189 stays.

B5/1.2 remain open/pre and B6–B9 held. Recover/D64, Gate, forward/capture and frozen
verifier bodies, host executables and installed timers stay unchanged. No production
service/VM/timer operation, mount, resource provisioning, reboot or local live process
scan ran for this unit. Next is a separately reviewed process-observation-envelope
contract, then the pure process-class comparator, jobs/hold/overrides/fresh D60,
durable admission and the attended manual route/D175. The envelope discussion is
design input only; its sampling, scope-evidence, redaction and acceptance-window
budget contract still needs a final pre-audit before implementation. Mac access,
APFS reattach, reboot rehearsal and the four physical histories remain separate.
This receipt changes five Markdown records only; its own exact-head CI/review
remain pending at commit time.


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


### 2026-10-18 02:41 EDT — owned process observation-envelope source verified (D221)

Source 89ae67dbe0057e308c8ae55674a21f8dfaa4247d passes all eight jobs in
[CI39103018309](https://github.com/moltyguibros-design/openclaw-node/actions/runs/39103018309).
Native job 117602984633 passes 55 tests in 5.192s and all 50
intended-assertion mutants with intact designated controls. Its unpatched CI
runner observation refuses while retaining the owned child in both passes:
1030 unknown entries and 6 refusal reasons. These are entries across
both passes, not distinct-process counts or a full table/per-reason measurement.
Linux job 117602984610 passes 55 tests in 1.091s with 1 native skip
and 50 intended mutations. Codex inspected both complete raw logs.
Native raw log: 62453 bytes, SHA256 33127936fb27349d8211f0bcddad436baa3457143422972721ec8b46fe55a6b9;
Linux raw log: 1512918 bytes, SHA256 315e20c6033272a8c2f88e75355b58ffdcca065eab5196a19d29b0798a175442.
Both name checkout merge 756766914c7aa7ac9da290cf7c205ba1e715e640, whose second
parent is the exact reviewed source and whose whole tree is identical to it.

Claude247 independently reproduces 55 tests (one native skip) and all 50
intended mutations as uid65534, with no required issue. Independent after-shorter sample and expiry probes fail the new assertions; removing the UID check is killed, and replay against 2393e724 fails both aliases without errors. Collected-path behaviour is unchanged. The added binding-key-set line is dominated by the following dictionary equality and is not counted as a mutant.
The within-pass sample equality and elapsed/expired consistency gaps from Claude245 are
pinned by coherent scripted negatives and individual mutants. The UID 0/1 Boolean
alias is rejected by an explicit integer check before binding equality; the old
source fails both cases and removal of the guard fails the new assertion.
Earlier 2393e724/52/47, 141 and 139 results retain their counts; cancelled run39101987342
is not counted green. Its Linux proof remains the earlier 52/47 only. Optional
validator/consumer/collector controls from245 and D218's six items stay in INVENTORY.

Only B5-D62-process-observation-envelope closes as an owned source prerequisite.
Recorded is complete coherent sampled observation, never class matching, boot
eligibility, authorship, history or admission. Four PID samples, strict unknown
retention, scope facts, both launchd reads and plist identities remain observations
under D189, not continuous/physical exclusion or loaded-image proof. The 120s
acceptance window cannot interrupt blocked calls; the 16-anchor limit and 8MiB
diagnostic-input bound do not change frozen-journal reader bounds. The private
fixture table supplies no B3 provenance. Local native runs used substituted
enumeration; no local unpatched full scan or production operation occurred.

B5/1.2 remain open/pre and B6–B9 held. Every executable that predated this unit,
including the diagnostic, policy binder, Journal/schema/recover/D64, Gate/identity,
host paths and timers, stays unchanged from 2615452b. No class comparator, jobs/
recorded hold/overrides/fresh D60 gate, durable admission, attended manual or D175
was implemented. Claude249/251 supply design input only for the next pure class comparator;
it needs its separate final pre-audit, exact field/attribution/count proof and
one bounded shared owned-reader extraction. Class consistency cannot imply a
stopped hold; jobs/hold/overrides/fresh D60 stay required. PID/generation/name
key-exclusion claims each need their own intended mutation mechanism. A valid
launchd expectation with count above one stays unsatisfied, without changing
the policy validator. Preserve anchor facts privately and bind the redacted
class report to the envelope hash; emit no policy or raw argv. No next-unit
implementation or closure follows the design input. Mac access/APFS reattach/reboot and four-history acceptance remain separate.
This receipt changes five Markdown records only; its own exact-head CI/review
remain pending at commit time.


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


### 2026-10-18 04:25 EDT — owned process-class-comparator source verified (D223)

Source 39638d1edb6f41aadf217bf3a2c2c92a4e368c7f passes all eight jobs in
[CI39109210059](https://github.com/moltyguibros-design/openclaw-node/actions/runs/39109210059).
Native job 117621494888 passes 38 tests in 3.673s and all 51
intended-assertion mutants with intact controls. The substituted owned C child
matches exactly its pre-authored class label but refuses its unobservable parent;
there is no native positive attribution claim. The CI-only unpatched full-runner
observation refuses at the envelope with the child in both passes, 1092
unknown entries across those passes and 2 envelope refusal reasons.
Those are entries, not distinct-process counts or a full table/per-reason measure.
Linux job 117621494877 passes 38 tests in 0.503s with 1 native skip
and all 51 intended mutations. Codex inspected both complete raw logs.
Native raw: 67213 bytes, SHA256 0f56bad260131e3d95c38a9a65cee18f7446dc997c87282f6edd5350bb1986a1.
Linux raw: 1517552 bytes, SHA256 5db3b98478024f56063f51061c8b5d1491ddfc2c434edb3715e20f2ec3d42819.
Both logs name checkout merge f50f74a8712d9a15822f21fa25ed6362b81954cb; its second
parent is the reviewed source and its whole tree is identical to that head.

Claude261 independently reviews the exact source with no required finding.
It reproduces38 tests (one native skip) and51 intended kills as uid65534, plus old envelope55/50 and182 combined tests (three skips). Its exact guard-removal replay now fails only the new shared-plist swap assertion with no ERROR; D218 validation and a recorded envelope are independently confirmed. Comparator/helper/old proof/workflow blob ids equal ea87f6fa, and the eight-file proof-only correction and six identical ledger blocks are verified. No new required or optional finding remains. Linux raw logs beyond the connector’s last5000-line window remain Codex’s observations; the independent source reproductions stand separately.
The own-label check was already correct; the required shared-plist swapped-label
control now pins its removal with one additional intended assertion. Comparator runtime,
workflow and helper bytes remain identical to ea87f6fa. Superseded CI39107975073
was cancelled for that proof, not counted green; its Linux37/50 and earlier181
remain those executions, never relabelled as the corrected source proof.
The five forbidden-key mutants share a7-tuple mechanism, counted but not
discriminating; per-field positives are separate evidence. Pass-B for A, PID
for generation and dropping loaded are equivalent for recorded input, not gaps
or additional kills. Minimal CLI early-error refusals may omit phase/hashes.
The native CI pass-null condition is now an explicit assertion. D220/D218 optional
items remain carried; no equivalent or ERROR-only mutation is counted.

Only B5-D62-process-class-comparator closes as an owned source prerequisite.
Its concrete consumer reaches the existing frozen-policy and envelope path once,
then validates and compares without another census, file write or constructor.
The envelope validator/binding/collector/private-reader bodies are unchanged;
only the bounded owned-helper extraction and old policy-emission mutant anchor
changed the preceding unit. D218 binder, Journal/schema/recover/D64, lib, Gate/
identity, host executables and timers remain unchanged. This receipt changes
five Markdown records only, with all executable/test/workflow bytes fixed.
Its own exact-head CI and independent review remain pending at commit time.

Class-consistent means exact sampled class/attribution/count consistency against
a prevalidated authored claim. It does not establish a stopped hold, loaded-job
configuration agreement, boot eligibility, completeness, policy authorship,
historical independence, loaded executable image or admission. Exact input hashes
bind received claims; recomputation decides envelope eligibility for comparison.
Source/coverage are not promoted, unknown or unstable evidence refuses before
class work, and admission/history remain false under D189. Scripted positives
stay scripted; the private fixture table supplies no B3 protected provenance.
The 120s window cannot interrupt blocked calls, and the 8MiB diagnostic input bound
does not widen frozen readers. Local native enumeration was substituted; no local
unpatched full scan or production service/VM/timer operation occurred.

B5/1.2 remain open/pre and B6–B9 held. The next pre-audit scopes the smallest jobs/recorded hold/overrides/fresh D60
prerequisite; observation, comparison and durable admission remain separately
reviewable before attended manual and D175. Native positive attribution/full pipeline, Mac access,
APFS reattach/reboot and four-history acceptance remain separate. No production
admission or runtime operation follows this source evidence receipt.


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


### 2026-10-18 06:11 EDT — owned held-job negative comparator source verified (D225)

Source d5d6aefd468a6b47c1f969e5bbc50868c864fcc1 passes all eight jobs in
[CI39115988725](https://github.com/moltyguibros-design/openclaw-node/actions/runs/39115988725).
Native job 117641759357 executes 32 scripted tests in 2.258s with no skip
and all 45 intended-assertion mutations with intact controls. These are
scripted frozen-reader portability controls, not live launchd/process observations
or a new full-scan measurement. Linux job 117641759535 executes 32 tests in
1.726s with no skip and all 45 mutations. Codex inspected both complete
raw logs: native 71429 bytes, SHA256 ba222634b29d04560a1c0b5ae5ec35161e95c0b019e03be49251bd205e5fa4fd;
Linux 1521650 bytes, SHA256 0aa2783a5368e096f9bea7a0e9f7eb99cc92d491782dd228f056dcdeb2b6ab2e.
Both logs name checkout merge fa40a7df4e88c60250734a6f9c6e9624f1c2f045, reviewed source
as its second parent and an identical whole tree.

Claude275 independently reviews the exact source with no required finding.
Claude273 found the source correct and independently reproduced31/44 and182 prior regressions as uid65534, requiring the consumer recorded-owner proof. Claude275 independently reproduces32 tests/no skip and45 intended kills on the corrected full-tree export. Its exact runtime-UID replay passes all original31 but fails only the new foreign-owner assertion in the corrected32, with no ERROR. The eight-file proof-only correction, unchanged comparator/workflow/prior executable and proof blobs, six identical ledger blocks and carried optional controls are verified. No new required finding remains; optional job-read/root-name/temp-parent/schema controls remain non-discriminating and equivalent predicates are not counted. The superseded Linux raw digest remains Codex-only because its connector exposes only the last5000 lines.
The comparator and workflow bytes remain identical to104d808e; only proof and
ledgers corrected its recorded-versus-runtime consumer UID coverage. Claude273
required that constructible false-acceptance control; the original31 controls
independently let the substitution pass, while the new honest foreign-owner
fixture and counted mutation pin the unchanged predicate. Superseded
CI39115186066 was cancelled for that proof and is not counted all8 green; its
completed Linux31/44 remains that older run, with no completed native claim.
Optional job-read ordering/root-name/temp-parent/schema controls remain carried,
and the verdict needle is strengthened. Equivalent predicates are not counted.
The final local 32-test/45-mutation proof and the separate182 prior process
regressions keep their actual run counts. Earlier30/42 and the partial rejected
ERROR-only zero-UID counterfactual are not relabelled as final proof. Zero-UID
positive and frozen record preconditions are non-counted controls. Upstream
record completeness, held_as_checkpointed and unloaded CAPTURE inventory remain
the unchanged frozen verifier's proof, not new comparator predicates or kills.

Only B5-D62-held-job-negative-comparator closes as an owned source prerequisite.
Its concrete record-free CLI requires both fixture/scripted flags before IO,
private literal owned inputs, pin coherence before one stopped-image read and
one frozen verification, then recorded-owner equality for every metadata row
before job-file read/comparison. It works with or without optional baseline
process policy. Labels derive from all verified prior units in all three owner
namespaces, not timers or policy anchors. Missing/extra/unknown/loaded facts are
retained; idle loaded/no-PID is not a negative. Exact jobs and frozen digests bind
the received claims, and reports emit no job values or policy. All existing
executable/test/mutation files remain unchanged from907046d9; only the three
new source/proof files, four workflow lines and six ledgers implement this unit.

This establishes scripted negative-job consistency for fixed labels/domains,
not current node state, process absence, complete installed/loaded entrypoint
inventory, disabled overrides, fresh D60, a live execution hold, eligibility,
authorship, historical independence, physical exclusion or admission. D189 and
unprotected owned fixture limits remain. Owner metadata absence refuses; no
caller UID fallback or schema change supplies it. The consumer performs no census,
local unpatched scan, Journal/Gate construction, write or installed timer change.
The optional launchd-command comparator was deferred at pre-audit269, not built.

B5/1.2 remain open/v1.2-pre and B6–B9 held. The later full managed-job collector
needs current-boot complete-domain facts and its own timing budget; double69-key
reads with10s calls can exceed20min, so it cannot inherit the120s envelope window.
Unobservable system-domain reads remain unknown. Overrides/freshD60, integration
with strict process gates, durable admission/manual/D175, Mac access/APFS/reboot
and four-history acceptance remain separate. No production operation or release.
This receipt changes five Markdown records only; executable/tests/workflow bytes
remain fixed. Its own exact-head review and CI remain pending at commit time.


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


### 2026-10-18 07:32 EDT — owned managed-job observation source verified (D227)

Source 6d2e90961ce8ae9a0be2271e109e0c31cf09c80e passes all eight jobs in
[CI39121279608](https://github.com/moltyguibros-design/openclaw-node/actions/runs/39121279608).
Native job 117657230203 executes34 tests in3.686s with no skip and
55 intended-assertion kills/intact controls. Its new unpatched fixed-label
measurement reports outcome=recorded, 69 keys in two sweeps,
error histogram {}, elapsed900688833ns.
This measures fixed managed-job facts only, not process absence/attribution,
complete installed entrypoint inventory, overrides, freshD60 or execution hold.
The CI branch is an isolation convention, not host/environment attestation.
It need not yield recorded; every error, including unreadable system-domain
facts, remains a refusal. Earlier process full-scan lines retain their own scope.
Linux job 117657230335 executes34 tests in1.778s with one intentional
CI-only native skip and55 kills. Codex inspected both complete raw logs:
native76572 bytes SHA256 e5c433155dc70bfdc78f5e3ae80c471bb8f9f4cc1fd6b874f19de161b45bbbf5;
Linux1526778 bytes SHA256 987995de9d856b63e53b55a94c0d6a7109874171445645eda0a04b6e64e4e49c.
Both name mergeacfc684524f5d708d3b1a0a91dd4d5f3fcc24d46 with reviewed source as second parent
and an identical whole tree. These completed-CI/log facts are Codex observations
separate from review285, which saw six of eight green at11:03UTC.

Claude285 independently clears the exact source with no required source or proof
finding. It confirms sole parent956f6c03, ten-file delta,202-line module and its
SHA, four workflow lines, six identical ledger blocks and unchanged pre-existing
executable/test/runner bytes. A full-tree uid65534 export reproduces34/one skip,
55 intended kills/intact controls and214 prior regressions/three darwin skips.
The local Mac214 run had no skip; those platform results are kept distinct.
Independent namespace-key, error-as-fact and observed-label variants die.
The source follows283: structured keys, pair guard, typed catch-bracket facts,
complete error retention/expiry, four boot/sweep stages, pure recomputation and
a collector-free CLI. The explicit two-replacement domain/unit/live-route
variants retain their declared mechanism; no ERROR-only kill is counted.
The local numeric0 redactor edge and immediate valid_job correction, early
failed/partial runs, final34/15.367s/55 and separate214/42.920s keep their counts.

Optional failure-stage vocabulary and string-key guards remain non-counted;
string keys are guaranteed by JSON on the real consumer path. The verified-digest
tie is dominated by the frozen binding. The conservative exact-expiry variant
is not an extra kill or a permissive acceptance defect. sample_labels.coverage
only repeats constants; the source label carries provenance information. The
CLI always forces scripted source, preserving bounded file claims without
promoting them. No new optional follow-up is silently closed. Existing
D218/D220/D224 carry-forwards remain. Export lint retains its two old failures;
local plan-lint remains14 PASS/1 old idle-version WARN/0 FAIL.

Only B5-D62-managed-job-observation closes as an owned source prerequisite.
The prepared stopped-image consumer uses private literal inputs, coherent pins
before one reader/frozen verifier, and every read-owner equality to recordedUID
before a private canonical bounded observation file. Both fixture/scripted flags
precede input IO; no CLI route calls the live collector. Only the darwin-plus-CI
test branch composes owned_records and collect_jobs, and no local unpatched
fixed-label scan occurred. All existing executable/test/mutation files remain
unchanged from956f6c03; only the three new files, four workflow lines and six
source ledgers implement this unit. No Journal/schema/recover/D64/Gate/identity,
shared census/parser, host executable or installed timer change. No file write
or constructor is performed by observation/validation/consumer operations.

This records sampled current-boot fixed managed-label facts, with loaded/idle
facts recordable, not held-negative consistency, a live hold, eligibility,
history/authorship, physical exclusion or admission. The30-minute acceptance
window cannot interrupt calls and boot_identity has no timeout; cohort growth
that outgrows twice the shared10s call budget fails the fixture control. No120s
process-window inheritance. Serialized argv is hashed, never raw; source data
remains unprotected under D189, with no protected B3 pin provenance.

B5/1.2 stay open/v1.2-pre, B6–B9 held. Full held-gate combination, overrides/fresh
D60, strict process integration, durable admission/manual/D175, Mac access,
APFS reattach/reboot and four-history acceptance remain separate. No production
operation or release. This receipt changes five Markdown records only, keeping
all source/tests/workflow bytes fixed. Its own exact-head review and CI remain
pending at commit time.


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


### 2026-10-18 08:55 EDT — owned managed-job negative observation source verified (D229)

Source 665ccdb4cf82ef52cd73ca03b4f5babfbbbd8045 passes all eight jobs in
[CI39126847156](https://github.com/moltyguibros-design/openclaw-node/actions/runs/39126847156).
Native job 117673662377 runs20 tests in2.207s/no skip and28 intended
assertion kills/intact controls. The new unpatched CI composition reports
outcome=managed-jobs-negative-consistent,phase=negative,69 keys/two sweeps,
errors {},elapsed731220792ns. This is only a sampled
fixed-label runner fact, not a node positive, execution hold or admission proof.
Linux job 117673662424 runs20 tests in1.157s/one CI-only native skip/28kills.
Codex inspected complete raw logs: native79800 bytes SHA256
fa3fa9fec2c911185612a90df64c08ad898b29d82084efb83993f7ead49af8f3; Linux1529725 bytes SHA256
4a206fc3f14160059a86f8163b5054389562cea2fe599eb65897506cef8c56c1. Both name merge69537c6b8c7fae93911b21163d2ef434454668e7
with the reviewed source as second parent and an identical whole tree.
These completed-CI facts are Codex observations, distinct from the independent
review and its CI status at review time. Older observer/process measurements
in the same native log are not this wrapper's new composition evidence.

Claude295 independently clears the exact source with no remaining required
source/proof finding. The full-tree uid65534 replay passes20 tests/one CI-only native skip and28 intended kills, plus248 prior regressions/four platform skips (local Mac248 had one). Exact lineage/three hashes/64-line source/ten-file delta/four CI lines/six ledger copies and all293 pins are confirmed. Independent top-verdict, raw-reasons and non-recorded-comparison mutants die. Shallow-copy fields, raw boot bracket, second/raw first sweep and dropping the verified-digest tie survive as equivalents under the preconditions; no extra kills are claimed. Review saw five of eight CI green at12:23UTC.
The three D228 sections are identical across six source ledgers; the earlier
local note's six-block phrasing means six ledger copies, not six distinct sections.
Local final20/7.981s/one native skip and28 intended kills, and the separate
248/35.246s/one native skip retain their actual run counts. First20 failed only
because the test helper treated explicit None as its valid default; direct-call
control corrected that test, not the source. Intermediate20/5.339s and final
provenance exception-to-assertion control remain historical, not relabelled.

Optional295 clarification: observation_sha256 binds the forced object received
by the wrapper, not the original file bytes. The private file is canonical;
source/sample-label forcing changes that object before hashing. main catches
only envelope.ERRORS as the existing convention; a broader catch surviving
the suite remains an optional control, not a new claim or silently closed gap.

Only B5-D62-managed-job-negative-observation closes as an owned source prerequisite.
The64-line wrapper validates before hashing or comparison, fingerprints the exact
received object, copies recomputed binding/provenance/budget/boot facts, and gates
non-recorded observations with recomputed reasons and negative null. Recorded
passes its first sweep verbatim to the unchanged comparator. Nested result and
its literal scripted scope/source remain untouched; only its exact negative
consistency success yields top managed-jobs-negative-consistent. Loaded idle
and running facts refuse. All hold/history/admission flags remain false.
No raw argv/job values/policy are emitted, and no input mutation or IO occurs
in comparison. Sweep_b/raw-input substitution is equivalent for recorded facts;
missing/extra/unknown buckets are already excluded upstream, not new kills.

The consumer requires both flags before IO, reuses exactly one owned_records
with coherent pins/one reader/frozen verifier/every recorded-owner tie, then
private canonical bounded managed-jobs.json with a textually identical forcing
block. No CLI collector reference; file claims stay untrusted sample labels and
source scripted. The declared live-route mutant needs gate relaxation plus
collector wiring and dies at the fixture-only CLI control with benign census;
no ERROR-only kill is counted. No local unpatched managed-label scan occurred.
The native CI guard remains convention, not environment attestation.

Success means only validated supplied facts were unloaded at the sampled
moments under the existing30min acceptance window, two sweeps and one boot
bracket. It rereads no current clock/boot, does not compare baseline boot, and
adds no freshness/continuous/coherent process-job window, process absence,
disabled override, complete inventory, freshD60, live hold, eligibility/history/
authorship/physical exclusion or admission guarantee. The observer budget
cannot interrupt blocked calls. D189 and unprotected provenance still apply.
Optional loaded_keys omitted; earlier optional controls remain carried.

All existing executables/tests/mutators stay fixed. The source delta is three
new files, four workflow lines and six ledgers; this separate receipt changes
five Markdown records only, leaving AUDIT_PRE and all source/proof/workflow bytes
fixed. Local lint14PASS/1old idle-version WARN/0FAIL; export's old two missing
automation/history failures stay distinct. B5/1.2 open/v1.2-pre,B6–B9 held.
Overrides/freshD60, full held/process integration, durable admission/manual/D175,
Mac designation/APFS/reboot/four-history acceptance remain later. D64/Gate/
installed timers/production remain untouched. Receipt exact-head review and
its own all8 CI are pending at commit time; no production operation or release.


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


### 2026-10-18 10:22 EDT — owned scripted entrypoint consistency source verified (D231)

Source 0aa1df7d78b1dc0d02a15d7a4e7cc4fd18f5f4c4 resolves all eight distinct latest job results successfully
in [CI39133265637](https://github.com/moltyguibros-design/openclaw-node/actions/runs/39133265637)
(attempt2). Native execution117692584475/attempt1
(carried as API job117697503389/attempt2):28 tests in
1.756s/no skip and39 intended-assertion kills/intact controls. Linux22
job 117697502335,attempt2:28/1.689s/no skip/39. These are scripted
frozen-reader portability checks, not new live inventory/override/D60 observations.
Older process/managed-job native lines retain their own prior-unit scope. Codex
inspected completed raw logs: native83783 bytes SHA256
f594827f8c4ed4171e022b8a7d0e9f7ba34403216ac2416df6a0e399c26e2032; Linux1533703 bytes SHA256
742b2441798bd0c9f066c4c57903396388f7ead9a192aa0b9b7706c3b31d4160. Both name mergec6b2e68c8ff6462cbaae986e631f89d9e20c0641
with source as second parent and identical whole tree. These completed-CI facts
are Codex observations, separate from the review and its CI status at that time.

Attempt1 Linux job117692584463 failed at unchanged cluster-offline-consumer-
placeholder, NATS10005 peer-offline placement, before any Python execution. Its
completed raw43966 bytes SHA2567fa9cdfd2ac9b4dfe9b29b2395e4f28a61738c2b1fb6f2693d467b6570f6af2b
remain failed evidence, not relabelled. Existing test_recovery/recovery bytes
are identical to parent. One unmodified local owned fixture control using the
same NATS2.12.6/CLI0.3.1 passed at2026-10-18T13:55:16.292Z; all owned processes exited and
cleanup failures empty. Its raw6375 bytes SHA256
067b6da0a7a31d624d0d98a30daa267cc2aca5b271c83ef466996876129caa36. This Mac/Node24 control is not a Linux reproduction or
root-cause closure. B5-CI-R3-placement remains a separate follow-up; no fixture/
readiness/timeout repair or production operation is included here. An initial
job-rerun request while attempt1 was active was rejected, scheduling nothing.
After attempt1 completed, exactly one targeted Linux22 rerun was scheduled on unchanged source bytes. GitHub lists the other seven carried successes under new attempt2 job IDs but with identical original runner/start/completion timestamps. Native is carried from execution job117692584475/attempt1 into reported job117697503389/attempt2, not a second native execution; matching raw bytes are checked. Only Linux executes anew in attempt2. No additional rerun or all-attempt1-green claim is made. All-green exact-head readiness was not waived.

Claude307 independently clears the exact source with no remaining required
finding. A full-tree uid65534 Linux replay independently reproduces28/no skips and39 intended assertion kills/intact controls. Exact sole parent/10files1681insertions/three hashes/80-line source/4workflowlines/unchanged prior blobs and identical D230 content across six ledgers are confirmed. Its broader workflow extraction passed23 prior unittest files, while two NATS-dependent files errored from missing sandbox server/environment; these are not source defects or a claimed268-test replay.11 prior mutation runners ended on their final kill lines with no failure signature. The separate local268/53.089s/two skips remains Codex proof. It verifies honest47-record nonempty exclusion/extra override chain,21gui/21user override flips, empty terminal loaded sets and exact frozen readback. Own probes confirm purity, comparison coverage and declared equivalents; the running-field contract kill is not an extra acceptance kill. Explicit exclusion call is an order pin with current shape revalidated inside the inventory validator; terminal overrides are chain-verified. Ordered roots and managed-jobs fixture prefix are accepted. It independently reads the complete480-line failed Linux log/BOM/no truncation, confirms no Python ran and unchanged test_recovery blob/parent plus six earlier runs passed. It establishes no root cause and saw six green/one Linux failure/native pending; no all8 claim at review time. The same307 response later adds a terminal attempt1 CI addendum: seven success/one Linux failure, hence no all8 at that time. It independently reads the complete995-line native log/BOM/no truncation and checks703/705/706/707–745:28/1.756s/OK/39 kills,43 OK blocks and no FAILED or runner error. That reproduces the native scripted portability result only; completed attempt2 all8 evidence is later Codex observation.
The three appended D230 segments include the internal Mid-Implementation
Findings heading, which accounts for the review’s four Markdown-block count.
Local final28/8.394s/no skip and39 intended kills remain separate from the prior
268/53.089s/two local CI-only native skips. First27/8.777s StopIteration and next
28/9.095s valid_prior refusal are preserved as two failed proof attempts at one
fixture precondition, not source defects. Full-node valid_prior admits no prior-
unloaded enabled unit at this head. The impossible303 hypothetical was replaced
with every managed start in all3 domains refusing against honest frozen records;
no invalid baseline, bypass or post-verification record mutation. The80-line
source never changed. First39 selected controls passed while that example was
invalid; only the final28 plus fresh39 runner prove the corrected exact bytes.

Only B5-D62-scripted-entrypoint-consistency closes as an owned source prerequisite.
A private copy preserves baseline identities while substituting terminal loaded/
running/disabled expectations; never persisted, called a baseline or passed to
valid_prior. Explicit exclusion validation then unchanged inventory validation
precede exact-input hashing/comparison. Static installed paths/roots/artifacts
match baseline; loaded/overrides match terminal CAPTURE exactly. Exact overrides
include every domain/key and none-versus-false, assuming persistence across reboot.
Exclusion label sets and plist/wrapper/full app identity match baseline; app drift
refuses and needs a separately reviewed baseline. Current excluded boot equals
supplied boot; valid run-count/boot dynamics may differ from baseline.

The honest nonempty exclusion/artifact and extra-override fixture records them
before original Journal creation through the real capture/commit/stopped reader/
frozen verifier. Both policy/exclusion cases pass. Consumer both flags before IO,
one reused owned_records with coherent pins/reader/verifier/all recorded-owner
ties, then private canonical bounded entrypoints.json. No collector reference,
constructor/write or local unpatched inventory/job scan. Pure comparison has no
IO/current clock/boot read or input mutation. Source fixed scripted; frozen
digest/recordedUID binding and named reasons only, no raw inventory/path/override/
exclusion/policy/argv. Hold/history/admission/freshness flags false.

A nonempty consistent input asserts a completed successful run in the supplied
boot but does not observe/authenticate it: verifiedtrue is shape only, no fresh
D60, actual inventory/override completeness, process absence, live hold, eligibility,
history/authorship, physical exclusion/admission or protected provenance. D189
still applies. Loaded equality, installed digest and fixed exclusion paths are
dominated shared proof; explicit exclusion removal/reversal pins ordering only.
Identity corruption is a contract/false-refusal control, not a permissive defect.
Running/copy-before-hash/terminal-identity variants remain equivalents, not extra
kills. The live-route mutant explicitly relaxes flags plus wires a benign patched
collector; no ERROR-only kill is counted. Prior optional controls remain carried.

All pre-existing executables/tests/runners stay fixed. Source delta:3 new files,
4workflowlines,6ledgers. This receipt changes5Markdown only, keeping AUDIT_PRE
and all code/proof/workflow fixed. Local lint14PASS/1old idle-versionWARN/0FAIL;
export's old missing automation/history failures remain separate. B5/1.2 open/
v1.2-pre,B6–B9 held,D64/Gate/installed timers/production untouched. Actual current
entrypoint/override/D60 observer, full held/process integration, durable admission/
manual/D175 and Mac/APFS/reboot/four-history evidence remain later. Receipt exact-
head review and its own all8 CI are pending at commit time; no operation/release.


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


### 2026-10-18 12:14 EDT — owned shared entrypoint path scope verified (D233)

Source4abd636045d074a5d80f5696defc3f972579bfc6 passes all eight distinct latest job results in
[CI39140772095](https://github.com/moltyguibros-design/openclaw-node/actions/runs/39140772095)
attempt2. Native execution117714562189/attempt1
(reported API117722261899/attempt2):21tests/0.073s/no skip/19 intended
assertion kills/intact controls. Linux22 job117722224612:21/0.049s/no skip/19.
Codex inspected completed full raw logs: native85970bytes SHA256
ea0e428e0d6b8de982161641c4517510fad591be8c2140d52e2394c4a0da7d4a; Linux1535966bytes SHA256
2426f7801e2c8c796850dbdbd1f31d3fec5bb19c6e8e25642d748bf005408d94. Both logs name merge3963b71bd73e1ebb534502ca83bdda2669192fac,
source as second parent and identical whole tree. New native proof is owned
filesystem/caller portability, never live inventory/override/D60 or launchd
measurement. Older native lines retain their own scopes.

Claude321 independently clears exact source/proof. Independent321 confirms sole parent488ad0cf then60992e9e and nine-file/521insertions/5deletions proof-only correction. Nine runtime lines, workflow, process shim and existing assertions are fixed. As uid65534 it reproduces21new tests,19 intended kills/intact controls, old27kills plus2explicit redundant-branch passes, and an audit with27kills/0survivors/0errors. Natural absolute-gate and raw-slash variants now die; resolved-path hardlink variant is not counted. It confirms LIFO real-cwd restoration, exact retained replacements, six-ledger blocks and honest failure/history attribution. Its initial488 prior replay finally completes40scripts:37exit0,3exit1 comprising two unavailable sandbox NATS binaries and the old uncorrected process runner; the corrected runner now passes. This is separate from local311regressions. CI was in progress with five early successes when321 read it; completed CI observations are later Codex evidence.
Completed CI evidence remains attributed to Codex wherever the review did not
reach it. Local21/0.064s/no skip and19kills are distinct from prior311/45.650s/
two intentional CI-only native skips. Parent classifier fails all12 absolute
delimiter subcases without errors. Whole-after-token ordering passes21 and
remains an equivalent, not an extra kill. Inventory-extra refusal is a shared
validator control, not an extra kill; every counted mutant dies by its named
assertion with intact selected controls and no ERROR-only kill.

Only B5-D62-entrypoint-whole-value-scope closes as an owned source prerequisite.
The existing shared helper gains nine lines resolving each entire expanded
absolute or slash-relative-with-supplied-cwd value with strict=False and exact
equality/parent containment, then existing suspicious_hardlink with original
source/label. Bare names never join cwd; process cwd is never inferred. Both
hardlink exemptions remain. Existing prefix, raw substring, token fallback and
environment/home expansion stay fixed. Dangling aliases into roots are relevant.
A neutral real job reaching protected roots through delimiter aliases may newly
refuse future baseline validation; that stricter membership is intended. Existing
installed/loaded callers consume the helper; no parallel classifier or observer
is added. The sole existing proof-runner exception retires two rescued process single-site
kill claims into explicit expected-pass controls;27 intended process kills plus
2redundant-branch passes are counted separately. Production process shim/all
existing assertions remain fixed; all other pre-existing bodies stay fixed.

Owned controls cover file/parent roots, delimiters/tab/newline, relative paths,
working directories, home/environment, hardlinks and exemptions, prefix siblings
and harmless/long/nonstring values. Callers use owned plists, supplied launchd
text/inspect and blocked subprocess calls. Installed environment references
expand; unused environment values are not scanned there. Loaded environment
values are scanned. Newline works direct/plist; existing loaded parser cannot
represent embedded newlines. Embedded --flag= delimiter aliases stay token-only
negative; raw substring over-includes raw prefix siblings. The process shim's
broader bare-name join remains fixed; its possible partial-redundancy cleanup
is carried, not performed. No full membership, physical writer or provenance
coverage follows. Initial488ad0cf CI39139556698 failed in the old runner before the new unit.
Its complete Linux943-line/83687byte log SHA256
0a2d6f07d9565620ed039befbef4a107f12d9f59d03894a83d38a42be2c8f7a8
remains failed evidence; no retry or relabelled21/19. Initial native117710976978
also failed the same old mutant before the new unit: raw33125bytes SHA256
5ad7d023fe838a4115aafdf21726da529eda1294d05b0a2cf889d461a29f1831.
Neither initial-platform result is green.319 accepted the narrow
proof re-orient; both redundant variants pass40process tests and are rescued
only by the new shared helper. Its second required proof correction replaces
a Path.cwd mock with actual owned cwd/restoration and kills the natural
absolute-gate variant. Expanded-only slash control is also adopted. Source
nine lines/workflow/production shim remain fixed through4abd6360. Historical
D21729kill proof stays true at its old head; current runner reports27plus2.
Corrected-source attempt1 Linux117714562096 passed21/0.051s/no skip/19
and the old27plus2, then the unchanged test_preservation_cluster failed its
stream-add with peer-offline placement. Full raw116841bytes SHA256
eb06b364fed34425d4412c7cb72ffdba7ac54ef12f1fb027fc5ee2326cb9a557 remain failed evidence; cleanupFailures empty.
One unmodified owned Mac control with NATS2.12.6/Node24.13.0 passed3.275s with
all own cleanup checks; raw342bytes SHA256074f3effbafc7aab67bf43e751d1445930462fa9b8e88ad8ee3a01684baddde3.
That is not a Linux reproduction or root-cause closure. No readiness/timeout/
fixture repair is included. After terminal attempt1 failure, exactly one targeted Linux rerun was scheduled on unchanged4abd6360. The other seven successes are carried under new API attempt2 IDs with identical original runner/start/end metadata; the native raw log is checked by byte identity, never called a second execution. No further retry or all-attempt1-green claim. The earlier488 proof failure was corrected in a new commit, not rerun. The R3 follow-up remains open
and the exact-head all8 prerequisite was not waived.
First noncanonical /var prescreen and failed relative workflow
edit invocation are not used as evidence and changed no source.

This source changes one function, two new proof files, one necessary existing proof-runner exception,
four workflow lines and
six ledgers. This D233 receipt changes five Markdown only, leaving AUDIT_PRE and
all code/tests/runners/workflow fixed. Local lint14PASS/1old idle-versionWARN/
0FAIL; export's old missing ignored automation/history limitation stays separate.
Only source review/CI is closed at commit time; this receipt needs its own exact
review/all8CI. The R3 placement follow-up and earlier optional controls remain
open. Current inventory/override/freshD60 observer, full held/process integration,
durable admission/manual/D175 and Mac/APFS/reboot/four-history evidence remain
later. B5/1.2 open/v1.2-pre,B6–B9 held,D64/Gate/installed timers/production
untouched; no fresh D60, live hold, history/authorship, eligibility or admission.


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


### 2026-10-18 14:01 EDT — owned cluster group-readiness verified (D235)

Source 08f90df7bd9139e3d8dee7e34fcf7507b5e90ef1, sole parent b0d55130, passes all eight distinct jobs in
[CI39149352811](https://github.com/moltyguibros-design/openclaw-node/actions/runs/39149352811)
attempt1, with no rerun. Linux22 job117739620498:13tests/0.266s/no skip,
22 intended assertion kills/intact controls; the actual owned three-member
cluster test passes2.165s with cleanupFailures[]. Native job117739620342:
13tests/0.252s/no skip/22. Native new-unit proof is scripted capture/clock
portability, not an actual cluster execution. Codex inspects completed raw logs:
Linux1538373bytes SHA2567a8c6b9aa3ae7872f24d37d14d28678dab00f6bb29f671af91c7278adda70f0e;
native88375bytes SHA256b9a303bda3e3f8de1e160a6868244919f8c6d6dcdf9480c0fda856df64340d05.
Both name merge c7bfd2b49258f1c3135a8c996f5f5fef291c2edd, source as second parent and
identical whole tree. These completed CI facts are Codex observations, later
than331's source review, not assigned to the reviewer.

Claude331 independently clears exact source/proof after329's pre-audit pins.
It verifies10files/1106insertions/18deletions, only the existing test-local
settle block extracted, one real consumer call, four CI lines, two new proof
files and six ledgers with three identical D234 blocks. Final assertions,
creation, QuietWindow, election and cleanup are byte-fixed; all production code
and other existing executables/tests/runners are fixed. As uid65534 it replays
13tests and22 intended assertion kills with intact controls; own mutants for
previous advancing only on valid samples, strict threshold, accumulated failure
rows, recomputed deadline, raft-only return and node-truthiness leaders die.
Its first full-suite deadline mutant hung and was narrowed to later-convergence;
that is its harness, not source or extra proof. The missing-$G mutation tests
named diagnostic evidence, not an independent count-dominated acceptance gate.
Removing only invalid reset is acceptance-equivalent because next valid table
necessarily differs and resets; it is not counted. No survivor is relabelled.

Only B5-CI-group-readiness closes as an owned fixture prerequisite: each member
must satisfy the same four old conditions before identical samples accrue1s
from their second occurrence. Invalid/changed samples clear stability and every
sample advances previous. Fixed10s top-of-loop deadline preserves sample-then-
check: an in-flight batch may finish after it, with about6s pre-existing capture
overrun; no hard completion bound or longer constant is claimed. Refused still
propagates. Timeout retains full last captures, named per-member failed checks
and last reset cause in the file/assertion. The real call injects no test clock
or sleep; AST pins its one returned result into unchanged final assertions.
Optional331 carry-forward: a late valid stable table may time out with last reset
change/all-empty failures; truthful, but elapsed stability could clarify it later.
No source defect or required correction remains; no unsolicited enhancement.

Local owned Mac NATS2.12.6/Node24.13.0 real cluster1/3.626s and unchanged checks
23/3.286s both have normal owned cleanup, no production connections. Local new
suite13/0.282s/22kills stays distinct from CI. Parent replay accepts stable empty
leaders then fails its final assertion at1.05 scripted seconds/66captures;
its initial wrong-size port harness and the candidate's floating-boundary/AST
harness corrections remain non-proof, not kills. Neither that replay nor the
passing controls proves the cause of the prior receipt failure. Peer-offline
placement diagnosis stays open, including test_recovery.mjs; no create retry,
timeout widening, production scan or operation. Existing captured failure logs
remain failed evidence. Current inventory/override/D60 observer, full held/
process integration, admission/manual/D175 and physical reboot/history evidence
remain later. B5/1.2 open/v1.2-pre,B6–B9held,D64/Gate/installed timers/production
untouched. This receipt changes five Markdown only; AUDIT_PRE and every non-
Markdown byte stay fixed. Local lint14PASS/1old idle-versionWARN/0FAIL. Receipt
exact-head review and its own all8CI remain pending at commit time, separately
required before completion; no whole-B5 closure or source-origin claim.


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


### 2026-10-18 15:58 EDT — owned placement-gossip diagnosis verified (D237)

Sourcefa9f0a4a8a829e1e2cb72ba9cd9f56bdc56fe97b, sole parent6df6c8b6, is independently clear at
Claude343; exact-head Tests CI39158146598 all8 succeeded in attempt1.
No run was retried. Portable/real proof and retained artifacts are Codex CI
observations unless the independent-review details below say otherwise.

linux: job117765560352, attempt1,30 tests/29portable+1real,
1.015242539s,0skips,28 named mutant kills with controls intact. Raw log1601113bytes
SHA25688724f4954ca7be768d7f6b6fe48083db0207786930531deb87eb5a29740b3a0. JSON-only artifact12147498840, report86847bytes
SHA25669a680c06853d4fa829b4389406bb63decac3c2fc28422b8b61225927a0e0ea5; only placement-gossip.json, parsed equal to full live log report.
native: job117765560253, attempt1,30 tests/29portable+1real,
1.476127625s,0skips,28 named mutant kills with controls intact. Raw log150992bytes
SHA256cc125bdc3d2b2a334b8f9854945acb074a35585271d261d1b7b1a60e9c38bc6a. JSON-only artifact12148339981, report87180bytes
SHA2562edf566e4aa62b4f65f506bce5f02b79d7a59f84993c8c1f189307ae84bda64f; only placement-gossip.json, parsed equal to full live log report.

Both CI platforms execute the actual isolated pair on official NATS2.12.6:
all eight unchanged gate checks pass in both cohorts; one control create succeeds,
one fault create returns exact400/10005/peer offline; each fault leader's create
window discards both other peers at the pinned offline site and reports required3/
found1/peers3/result1/offline:true/misc:false. API snapshots bind to ready IDs,
aggregate totals1/1, errors0/1, every member delta nonnegative. All six owned
owners exit0 normally with shutdown marker and empty cleanup failures. This is
injected sufficiency evidence, not the historical CI trigger or readiness repair.

Checkouta4042de3fd3ee5792c1ad78bc977037ec26940e5 has source as second parent; Linux/native
checkout IDs match and both merge-checkout trees are byte-identical to source.
The workflow adds four registration commands and two JSON-only artifact steps;
macOS new-unit proof includes real owned servers, not only scripted controls.
Local30/28 and unchanged original recovery fixture evidence stays in D236.
The explicit APP connection to EACH member and STATSZ route denial on ALL THREE
members are deliberate injectors absent from the retained historical sequence.
Counters identify increment locations, not an authenticated responder identity;
leader debug evidence supports only the specific fault branch. D189 applies.

Claude343 independently verifies sole-parent/twelve-file delta, exact helper extraction and all remaining caller bytes, three D236 block identities across six ledgers and candidate row. Under Node22/uid65534:29 portable pass with no live cohort; full suite29pass/1binary-absent failure (sandbox has no NATS), runner28/28 intended kills with controls intact. Five extra variants die: relaxed total, dropped error/version/discovery/nonnegativity. Three survivors are declared construction equivalents, uncounted: dropped cohort flag, dropped owner count and leader read from last ready row (all rows agree at a ready gate). They are equivalences under the fixed probe construction, not a claim about arbitrary forged report inputs. Truncation flag is a fixed false fact because the entire tail is read. Real pairs remain Codex CI evidence;343 read CI in progress and claims no completed CI result. No required source finding.

Only B5-CI-R3-placement-diagnosis closes as an owned prerequisite. Original
B5-CI-R3-placement repair/natural trigger, current inventory/override/fresh-D60
observer, full held/process integration, durable admission/manual/D175, full
native pipeline and disposable-Mac/APFS/reboot/four-history evidence remain open.
B5/1.2 staysv1.2-pre; B6–B9 held; D64/Gate/installed timers/production untouched.
No production connection/service/VM/resource operation. This five-Markdown receipt
keeps source executables, workflow, VERSION and AUDIT_PRE byte-identical; its own
exact review and all8 CI are pending at commit, not retrospectively preclaimed.


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


### 2026-10-18 17:10 EDT — corrected owned placement diagnosis verified (D239)

Corrected source5e931120ec01de19c861024f8387e77952f104a9, sole parent52f31d88, is independently
clear at Claude349; exact-head CI39164238245 all8 succeeded in attempt1.
This new-head run is not a rerun of failed D237 CI39161190466. The original
sourcefa9f0a4a/all8CI39158146598 evidence and D237 failed receipt remain separate.
Completed CI/live facts are Codex observations unless the review details say
otherwise. Both platforms execute the actual ephemeral six-owner sequential pair.

linux: job117783726805, attempt1,45 tests/44portable+1actual pair, 0.960582542s,
0skips,34 intended-assertion kills with intact controls. Fault leadermember-2,
3 offline discards/remaining0; all12diagnostic checks true.
Raw log1606576bytes SHA25617c8025dd254ff1b96d1e815ede82712d2ac15d2f8f654b700248924e9b312e2.
JSON-only artifact12150182604, report86972bytes SHA256
fa9c92376bb94f32259d6f70d90477194047aa561188cc70fd33dd9ee19c7667; ZIP digest verified, sole placement-gossip.json parsed equal to full live log report.
native: job117783726786, attempt1,45 tests/44portable+1actual pair, 1.530703208s,
0skips,34 intended-assertion kills with intact controls. Fault leadermember-1,
2 offline discards/remaining1; all12diagnostic checks true.
Raw log156387bytes SHA2569843674f8816105f73c684467440fd20cb9f6a40be46f7b65dae29347a3e4b8b.
JSON-only artifact12150912021, report87185bytes SHA256
698970007e9f778878af3d1ddd021b83350759edbe95ce401459d1b89a987a36; ZIP digest verified, sole placement-gossip.json parsed equal to full live log report.

Every actual pair passes all eight unchanged readiness checks in both cohorts,
control creates once, fault refuses once with exact400/10005/peer offline. Fault
leader log contains both nonleaders and optionally self at the exact nil-cache
offline-discard site; unique known names and one full2.12.6 new-stream summary
conserve required3/peers3/found=result=3-discardCount with offline:true/misc:false.
API before/after rows bind ready IDs, aggregate total1/1/errors0/1, per-member
nonnegative; all six owners exit0 with shutdown marker and empty cleanup failures.
Both JSON-only archives match their live report values. Checkout
225e823e8601a701b3a859c9f52cc348aedb5850 matches both jobs, source second parent, identical tree.

Claude349 independently verifies sole parent52f31d88/nine paths, sole probe hunk inside leaderReason, unchanged producer/helper/original/workflows/VERSION/other executables, three identical ledger headings and reopened row/frontier. Under Node22.22.2/uid65534:44 pass and1 real-pair failure solely because binary absent;34/34 runner kills with intact controls/no live cohorts; hash pins pass. From saved CI LOG reports, old failed report is inconclusive only at leaderReason under old probe and owned-counterexample under new; prior fa9 passing report stays accepted under both. Artifact bytes/digests and local Node24 timings stay Codex. Own adversarial variants confirm completeness/required/peers/conservation/self-count/two-discard positive; dropped match validation dies by TypeError, not a counted intended assertion. Optional unproved literals replica:3/existing:[]/0 are declared, not independently claimed as tested gates. End-anchor removal and reading last line are uncounted producer equivalents under pinned2.12.6, not arbitrary-input equivalences. Cosmetic indentation note is unchanged.347 attribution/failure retention accurate. Source CI was in progress with six early successes at reviewer query; no completed CI or logs read there. No required source finding.

Failed history retained, not rewritten: D237 native117774685858/CI39161190466
failed only hardcoded found1/result1, with legitimate three-discard/found0 evidence.
Log127193bytes SHA256
0f856e2a4ccc6e01df92ebbecea3d78f89d505f06d97178d6967a43d33d0db44;
artifact12149732321/report87278bytes SHA256
030d5f024aa9f64344f76987abba1e0f1107c3679c2fbea224d5217634b73cd0.
347 independently reproduced this complete1028-line log and mechanism. Tagged
source initializes self with stats:nil and fills it via rate-limited own STATSZ;
there is no self exemption in placement. New local45/34 and read-only replay of
that exact failed report prove the corrected classification without changing old
bytes/outcome or claiming old CI green. Two and three-discard positives and all
partition negatives are portable proof; fresh actual forms are stated above.

Only B5-CI-R3-placement-diagnosis closes as a corrected owned prerequisite. Both
injected route denial and per-member APP discovery connections remain explicit.
No historical CI cause or readiness repair is established. Original placement
repair/natural trigger/current inventory/override/fresh-D60 observer, full held/
process integration, durable admission/manual/D175, full native pipeline and
disposable-Mac/APFS/reboot/four-history evidence remain open. B5/1.2v1.2-pre,
B6–B9 held; D64/Gate/installed timers/production unchanged. This five-Markdown
receipt keeps source, workflow, VERSION and AUDIT_PRE byte-fixed; its own exact
review and all8 CI are pending at commit and are not preclaimed.


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


### 2026-10-18 18:52 EDT — owned R3 failure evidence verified (D240)

Corrected source 94bc8e766f6a10921d1ae6fa80e62762f6655fd8, sole parent
d5f396b9aa70758fc0fc0522b75e13b311a8f9a1, is independently clear at Claude357.
Claude355's required finding on the first candidate was corrected: only the
original three cluster servers have debug logging, and the report records the
age of caller-supplied pre-create observations. Exact-source CI 39171957048
passed all eight jobs in attempt 1. Completed CI facts below are Codex
observations, not claims that Claude read GitHub logs. Merge checkout
85849f670905eb4c9416c3e6e32fe39e8cbd2a1c has source as its second parent and an
identical tree.

Linux unit-tests (22), job 117806710325: the actual owned fault/control pair
passed 45 tests, its prior mutation runner killed 34/34, the new evidence suite
passed 8/8 with no skips, and its runner killed 13/13 with intact controls. The
controlled fault made one R3 create and refused with API 10005; its bounded
report recorded all eight caller-supplied readiness checks true, timestamped
observations, three complete selector lines on the leader, complete empty
windows on the other members, and the original peer-offline error class. The
full unfiltered owned recovery passed and all servers stopped. Full job log:
24462 lines, 1614893 bytes, SHA256
5c0ecb0a47529d790c301553deed670d2378312bc007ac4fcf7c55af1854f380. JSON-only
placement-gossip artifact 12152962260: 86849 bytes, SHA256
a49fba46c2986ca97ec628d856fc8683b9047cbc7116cd7aca0062068e5791fc; its diagnosis
is owned-counterexample, all 12 checks true, one create per cohort, and empty
cleanup failures. There is no unfiltered placement-failure artifact because the
unfiltered fixture succeeded.

Native legacy-writer-lock-macos, job 117806710192: the actual owned
fault/control pair passed 45 tests, its prior mutation runner killed 34/34, the
new evidence suite passed 8/8 with no skips, and its runner killed 13/13 with
intact controls. The controlled fault made one R3 create and refused with API
10005; the bounded report preserved three complete leader selector lines,
timestamped pre-create observations and the original peer-offline error class.
Full job log: 1472 lines, 163479 bytes, SHA256
b186c260195dbc0d8742db644da2ac72da112c12e6fe47076d98fbe8b9eb5df9. JSON-only
placement-gossip artifact 12153471850: 87192 bytes, SHA256
0efec3acab195ae96e32565ebe4d6346a8bedcb599df631ab74c02d5e0d20686; its diagnosis
is owned-counterexample, all 12 checks true, one create per cohort, and empty
cleanup failures.

Local corrected-source proof is separate from CI: the unfiltered owned recovery
passed, all owned servers stopped, no failure report was produced, and retained
configurations show debug only on the first three cluster servers. The
controlled fault/control pair made one create per cohort, control created and
fault refused with API 10005, all owners cleaned up; the private mode-0600
failure report is 2456 bytes, SHA256
14f8d8a84dd2a4b75c8d36bfce7075056a0f0cb967cfe6a286a9f49d6c2775d0. The new 8/8
and 13/13 portable controls, existing 45/45 and 34/34 controls, and plan lint 14
PASS/1 historical VERSION-idle WARN/0 FAIL support this owned fixture only.

Only B5-CI-R3-failure-evidence closes as an auxiliary evidence prerequisite. A
future natural owned R3 refusal is instrumented to retain bounded selector
evidence without retrying; this did
not establish the cause of past Linux failures or repair peer placement. The
original placement repair, natural trigger, current inventory/override/fresh-D60
observer, full held/process integration, durable admission, manual restoration,
D175, native full pipeline, and disposable-Mac/APFS/reboot/four-history evidence
remain open. B5/1.2 stays v1.2-pre, B6–B9 held; D64, Gate, installed timers and
production remain untouched. This receipt changes five Markdown ledgers only;
AUDIT_PRE, source, workflow and VERSION stay byte-fixed. Its own exact review
and all-eight CI are pending at commit and are not preclaimed.

### 2026-10-18 19:44 EDT — first-open-row reconciliation (D241)

The D240 source 94bc8e76 and receipt 86ff2461 are reviewed clear by Claude357/359. Their exact-head CI runs 39171957048 and 39174246835 both passed all eight jobs at attempt 1. Claude361 independently found the first-open-row pointer stale and recommended reconciliation before another source unit. This change corrects that pointer; it does not deliver a stop, restoration adapter, admission or placement repair.

Three historical rows are normalized against later evidence. B5-exact-head-CI diagnostic draft is marked complete only as fail-closed diagnosis: D180 integration controls, D193 owned client trace and the five-job green D194 carrier 151bb3bd/39011578564 exist; the launchctl delay's cause and default-throttle policy remain open. B5-role-binding integration is marked superseded as an overbroad composite: D181's pure reader and D185–D187's checkpoint/verifier wiring exist, but live serving-unit interpretation and just-in-time B3 binding are explicitly retained in B5-serving-role-runtime-binding. B5-native-ASIF-mount is marked complete only for the owned mechanism: D195/D196's isolated macOS observation is on green 6f7e9371/39018959320, followed by D197 device-binding correction and D205's owned reader integration on green e120e78d/39053730664. None is a production image or physical no-writer proof.

The first still-open executable source prerequisite is now B5-serving-NATS recovery adapter. The existing StopWatch.mutate guard refuses persistent NATS disable-and-unload specifically because recovery lacks that adapter. The adapter therefore precedes the persistent-stop producer; both precede an owned capture-ready checkpoint. Stopped-ASIF extraction and the newly explicit live role-binding row remain open. The current entrypoint/override/fresh-D60 observer is a separate later D62 gate, not a substitute for the pre-capture producer. This ordering replaces the frontier table's stale current-observer-first pointer. The original B5-CI-R3-placement repair still needs a natural failure cause; D240 records future bounded selector evidence without retrying. No guessed readiness repair is included.

Only these five Markdown ledgers change. All executable source, tests, workflow, AUDIT_PRE and VERSION stay byte-identical. B5/step 1.2 stays [A] at v1.2-pre; B6–B9, D64, Gate, installed timers and production stay untouched. No production service, VM, store, mount or history was operated. The next work unit is a separate pre-audit of the owned NATS recovery adapter, with its own exact-source review and CI. This documentation correction itself needs exact-head review and green CI before it is treated as a settled plan pointer.


### 2026-10-18 20:35 EDT — serving-NATS recovery-adapter pre-audit (D242)

The first open source prerequisite remains the serving-NATS recovery adapter. At exact source 254ef778, Claude365 confirmed the adapter-before-producer order, the three serving members' daemon class, Journal.recover's bus-first order and held-member1 check, and the existing success-path restore primitive. The D242 pre-audit in AUDIT_PRE records six required design corrections before source: begin_override_clear itself must refuse an open NATS transfer and protected writer marker; only the explicit serving-member allowlist may clear, never nats-1; per-member readiness must be satisfiable while the other two remain disabled; a positive post-third-member R3 quorum gate is a separate prerequisite before clients or the stop producer; the existing exclusion test must change; and restore_only.py must remain fixed. A disposable single-server NATS 2.12.6 monitor probe confirmed local /varz and /jsz remain readable without a meta leader, but did not test the three-member restore.

The prospective source unit changes preservation_journal.py, adds a small local-readiness helper beside restore_disabled_daemon in managed_launchd.py, and extends its journal and native owned tests. The first native gate must restore nats alone under a real owned full-node journal and hold while nats-2/nats-3 remain disabled and member1 held; later controls must restore all three and retain failure/interruption as terminal. The operator Mac already has ai.openclaw.nats loaded, so a fixed-label native fixture belongs on a clean disposable CI runner and must refuse collisions. D115's running-disabled reconciliation, survivor proof and measured production budgets remain open. StopWatch's persistent-NATS guard, D64, Gate, timers and production stay unchanged. A new open INVENTORY row places the post-restore quorum gate between this adapter and the persistent-stop producer; individual recovery-verified receipts claim local member readiness only.

This pre-audit changes six Markdown files and no executable, test or workflow file. The adapter and quorum rows remain open; B5/1.2 stays [A] at v1.2-pre and B6–B9 stay held. No production service, VM, mount, store or NATS history was operated. Exact-head review and CI for this documentation head are pending; neither the adapter nor the quorum gate is credited as implemented.
