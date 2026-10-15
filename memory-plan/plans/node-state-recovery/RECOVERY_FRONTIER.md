# Recovery frontier — 2026-10-13 00:17 EDT

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
| B5 | **In progress, owned design and rehearsal only:** the journal refuses every serving NATS stop until the prior-loaded non-NATS cohort has class-specific verified persistent stops and is unloaded and disabled. The root transfer reader checks the bound cohort, but that transfer is production-disabled and is not a prerequisite of D168's stopped-VM preservation boundary. The host arm nonce, committed four-store manifest and post-commit started-state ACK pass owned early-stop and changed-store negatives; 16 host-capture and three reconcile tests pass. **Two newly identified blockers remain:** no capture-ready journal checkpoint and frozen-journal verifier exist; full-node `recover()` explicitly refuses a changed boot, while the hold pins a transient filesystem device number across reboot. `Journal.close()` only releases locks, so the former “durable journal close and root outcome” target was unreachable and is withdrawn. The manifest is not bound to a stopped-ASIF journal, and the full-node abort/restore controller is absent. No physical no-writer proof exists. | Codex builds and adversarially tests a restore-only `capture-ready` checkpoint after all four NATS roles are quiesced under the original hold, binds its host arm nonce and journal head to the four-store manifest, and verifies the frozen user-owned journal from the stopped ASIF. Keep the production-disabled root transfer for a later migration window. Implement and test D175’s conditional, journaled, value-only re-pin of the five installed timer entries after D62 admission and before restore-only gate construction, only if the device number changed. Keep same-boot descriptor/path mapping checks; test owned APFS detach/reattach and a full disposable-macOS reboot. Do not change installed production plists before B6. Implement D62/D64's reboot rule: retain host boot denial until a durable ACCEPTED decision after B8 or an ABORT decision after host cleanup; before guest recovery, bind that decision and compare all boot-time OpenClaw launchd jobs and in-scope processes with the recorded hold, refusing unexpected or unreadable observations. Rehearse launchd/login/hold reattach on disposable macOS, then finish the fail-closed abort/restore controller and reviewed exact runbook. The five installed timer pins embed the device number; B5 must verify the D175 migration and B9 gated-run checks on owned resources without an unauthorized production restart. A stuck guard needs an operator-visible outcome. No live shutdown or production-service stop belongs to B5. | Reviewed source and decisive owned negatives for missing/foreign stop receipts, stale checkpoint, altered frozen head, guard denial, premature boot decision, unexpected boot-time start, unauthorized or repeated timer re-pin, planned-reboot admission and abort; D62 disposable-macOS reboot rehearsal showing persistent disable, login-start refusal, conditional timer re-pin and successful gated runs, comparison of all OpenClaw launchd jobs and every process running as the OpenClaw user or executing from production entrypoint roots (unreadable or unattributable in-scope process refuses), and hold reattach; exact-head green CI; written entry/abort/resumption criteria. This is not a complete process-census claim under D162–D164. A fixture alone cannot satisfy the macOS rehearsal. | Per-window release B6. |
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
