# Recovery frontier — 2026-10-12 21:38 EDT

This is the Codex desktop heartbeat's short control surface for recovery step
1.2. It does not change `INVENTORY.md`, `DECISIONS.md`, the no-stop rule, or
the criteria for closing a step. Recheck the listed evidence at every wake;
do not treat this snapshot as current merely because it is in the repo.

**Current outcome:** 1.2 is `[A]/v1.2-pre`. The OpenClaw node is not accepted
as operational. No production service or VM stop is authorized. The standalone
NATS store and all three cluster-member stores, including the held R1 member,
must remain separate until each history has an accepted preservation path.

## Critical path and advance warnings

| ID | Gate and present state | Owner and exact unblock action | Evidence required to clear | First downstream operation held |
|---|---|---|---|---|
| B1 | **Cleared for design only by D168.** The operator's “GO” selected the revised stopped-VM physical boundary in the reviewed candidate. A complete no-writer proof is not claimed on the live mounted Data volume. | Codex designs and tests only on owned resources. This decision gives no authority to stop or restart a production service or the VM. | D168 records the chosen boundary and its limits. B6 remains a separate, fresh, exact-window release. | Boundary design B5; never B7 directly. |
| B2 | **Cleared for the disposable mechanism only.** Codex registered a separate Apple-backend UTM VM with its own ASIF disk and a verified Alpine ISO. It started and stopped normally; while `UF_IMMUTABLE` guarded that stopped disk, UTM refused its start and remained stopped; after unlock it started and stopped normally. The production VM stayed started throughout. | Codex carries this owned result into B5's host boot controller; no further VM creation is requested of the operator. `utmctl start` exited 0 even on the refused attempt, so the controller must check the resulting state and error. | `audits/step12_jetstream/B2_UTM_GUARD_REHEARSAL_20261012.json` records distinct VM/disk identities, ASIF format, guard refusal, unlock recovery and final states. This is not a production boot-denial certificate. | B5 controller implementation and owned tests. |
| B3 | **Just-in-time installation pins:** the October 9 candidate names `viewer-observed-20261008`; the installed viewer has since moved to `viewer-plan-task-links-autosave-20261011`. The 23-job candidate is unapproved and can drift again. | Codex resolves known structural drift now, but re-captures all 23 installed jobs and direct file hashes only immediately before an approved window. Repeating the capture before a window is scheduled does **not** count as progress. | Current installed identities and hashes match the reviewed baseline at window entry. | B6 and B7. |
| B4 | **Cleared as a bounded design input:** all 23 installed plists and direct launch files, activation keys, and current GUI/user/system OpenClaw-label observations are captured. Claude's adversarial review at `ac954055` found no remaining concrete false claim. This is not a no-writer certificate. | Codex carries the identified child, deploy, viewer, bus and file-writing routes into B5; transitive and out-of-cohort writers remain fail-closed uncertainties for the window-time census and stopped-VM boundary. Re-running this static capture alone is not progress. | `audits/step12_jetstream/B4_WRITER_PROVENANCE_AUDIT_20261012.md` and its JSON cover all 23 labels, classify the only observed system-domain OpenClaw label, name re-entry edges, and state residual uncertainty without claiming pre-stop physical exclusion. | Boundary design B5. |
| B5 | **In progress, owned design and rehearsal only:** the journal refuses every serving NATS stop until the prior-loaded non-NATS cohort has class-specific verified persistent stops and is unloaded and disabled. The transfer writer rechecks the fence; root independently requires the cohort's bound receipts before the first serving NATS intent and rejects later loaded snapshots. A fresh original watch-session certificate is bound at the journal's stop-receipt write path; missing or conflicting live certificates refuse before NATS. Owned forged-transfer, late-stop and hold-session negatives pass, including a foreign live session, a tampered cohort receipt, a running known-broken unit's idle proof and a duplicate bound stop; 155 journal and 33 user-transfer tests pass. B2's real disposable UTM start-denial and recovery mechanism passes. The owned host capture worker refuses an observed stop-then-restart or image-holder re-entry after the first clean stop. Its status samples now share the arm-file lock with the legitimate image guard, so the guard's temporary fd cannot appear as a foreign holder. All 14 host-capture tests pass, including a guard-side lock test, and the three earlier guards are mutation-checked. An indefinitely stuck guard can still hold the arm-file lock past the capture deadline; this remains an abort-controller issue, not a completed time bound. The path still does not bind frozen host bytes to a fresh guest hold and root outcome, and no full-node abort/restore controller or physical no-writer proof exists. | Codex builds a fresh guest-to-host completion and byte-continuity contract, tests early-stop and post-commit-write negatives on owned resources, and finishes the abort/restore controller and exact production runbook, including an operator-visible outcome if the guard holds its lock past the deadline. Host state samples and `utmctl start` exit 0 alone cannot certify the transition. No live shutdown or production-service stop belongs to this gate. | Reviewed source, owned missed-writer/boot-denial and early-stop negatives, green exact-head CI, and written entry/abort/resumption criteria. | Per-window release B6. |
| B6 | **Separate live-run release required.** B1's boundary choice and B5's design review never authorize a production stop. | Operator gives a fresh, explicit go/no-go for one exact attended window only after B2, B3 and B5 pass. The two-hour heartbeat may prepare and warn, but must never initiate the live stop. | Recorded window-specific authorization naming the reviewed runbook, current pins, host operator and abort contact. Without it, B7 remains closed. | Live hold and shutdown B7. |
| B7 | **Live full-node hold and shutdown closed.** No service or VM stop has occurred for this recovery. | Only in the attended, specifically authorized B6 window, execute the approved sequence and abort on any failed precondition. No single NATS member may be stopped as a rehearsal. | Application quiescence under the approved boundary, clean VM shutdown, active host boot denial and definitive physical no-writer proof at the boundary specified by B1. | Stopped-VM capture B8. |
| B8 | **Four-store capture and isolated acceptance closed.** No three healthy cold masters have been accepted. | Bind host capture and restore tools to the four declared physical paths and volume, then restore the copies on isolated servers. | Four separately hashed path/volume/window-bound copies faithfully reproduce the observed bytes; offline streams, counts, sequences and expiring-stream treatment match. This does **not** prove historical independence of the four members; that needs deployment-time provenance outside this capture. | Step 1.2 closure and any topology change. |
| B9 | **Verified resumption closed.** A successful fixture cannot establish live recovery. | Follow the reviewed restore order, check all previously active services and writer routes, and record failures or success without claiming operational status early. | The 23-job prior state, NATS identities and routes, application health and retained histories match the approved acceptance contract; then step 1.2 may close. | Coordinated point 1.3 and a truthful operational claim. |

The next two gates after a hold are **stopped-VM capture of all four physical
NATS stores** and **isolated, real-history restoration/acceptance**. Their
fixtures are useful only when bound to authentic guest/host origin and the
actual four source roles; synthetic receipts do not close them. Verified
resumption must follow acceptance, not precede it.

**B5 source-merge warning:** the high-severity dependency fixes from PR #226
are now integrated into draft PR #224. Clean local installs, both audit gates,
the 155 journal tests, 33 user-transfer tests, 13 host-capture tests and 129
Mission Control tests pass. The exact-head workflow is still in progress at
this checkpoint; local results are not a green workflow conclusion. Even a
green workflow will leave the guest-to-host commitment, full-node controller
and physical boundary unproven.

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
