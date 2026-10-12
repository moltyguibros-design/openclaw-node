# Recovery frontier — 2026-10-12 16:54 EDT

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
| B1 | **Decision needed now:** the existing rule requires a complete no-writer proof *before* any production service or VM stop; the demonstrated in-guest mechanisms cannot provide it on the mounted Data volume. | Operator chooses one of the two boundaries in `audits/step12_jetstream/HOLD_BOUNDARY_DECISION_CANDIDATE_20261012.md`. Recommended: approve design and owned tests for a bounded whole-node stop with definitive physical no-writer proof after clean VM shutdown and host boot guard. This choice alone authorizes **no live stop**. Keeping the original rule requires a newly demonstrated pre-stop exclusion mechanism and has no credible completion date. | An explicit operator choice recorded in `DECISIONS.md`; until then retain the existing no-stop rule. B1 never releases B7. | Boundary design B5, then B7. |
| B2 | **Access needed before host rehearsal:** the guest's read-only SSH attempts as `moltymac` to the UTM host at `192.168.64.1` were refused; the host control path is unverified. | Operator supplies the correct existing host access method or performs the disposable-VM rehearsal with the reviewed commands. Codex prepares the exact commands and expected refusal/recovery evidence first. | Successful read-only host identity/UTM inventory, then an owned disposable VM start-denial and recovery receipt. No live VM test. | Host boot guard and B5. |
| B3 | **Just-in-time installation pins:** the October 9 candidate names `viewer-observed-20261008`; the installed viewer has since moved to `viewer-plan-task-links-autosave-20261011`. The 23-job candidate is unapproved and can drift again. | Codex resolves known structural drift now, but re-captures all 23 installed jobs and direct file hashes only immediately before an approved window. Repeating the capture before a window is scheduled does **not** count as progress. | Current installed identities and hashes match the reviewed baseline at window entry. | B6 and B7. |
| B4 | **Executable now, independent of B1:** installed payload and invoker provenance is incomplete. The detached-writer and hidden Mach-entry controls disprove relying on gate, launchd overrides, flags, or census as a complete pre-stop writer certificate. | Codex performs one read-only audit of the installed 23-job payload/invoker set and records any writer outside the current cohort. Do not design the physical boundary against an unchosen B1 contract. | A reviewable installed-code provenance inventory with explicit unresolved writers and a check that the scan covered all 23 declared jobs. | Boundary design B5. |
| B5 | **Owned design and rehearsal only:** B1, B2 and B4 feed the fail-closed hold, host guard, capture/abort and restore controller. | Codex finishes the controller and tests it on owned resources, then presents an exact production runbook and abort path for review. No live shutdown or production-service stop belongs to this gate. | Reviewed source, owned missed-writer/boot-denial negatives, and written entry/abort/resumption criteria. | Per-window release B6. |
| B6 | **Separate live-run release required.** B1's boundary choice and B5's design review never authorize a production stop. | Operator gives a fresh, explicit go/no-go for one exact attended window only after B2, B3 and B5 pass. The two-hour heartbeat may prepare and warn, but must never initiate the live stop. | Recorded window-specific authorization naming the reviewed runbook, current pins, host operator and abort contact. Without it, B7 remains closed. | Live hold and shutdown B7. |
| B7 | **Live full-node hold and shutdown closed.** No service or VM stop has occurred for this recovery. | Only in the attended, specifically authorized B6 window, execute the approved sequence and abort on any failed precondition. No single NATS member may be stopped as a rehearsal. | Application quiescence under the approved boundary, clean VM shutdown, active host boot denial and definitive physical no-writer proof at the boundary specified by B1. | Stopped-VM capture B8. |
| B8 | **Four-store capture and isolated acceptance closed.** No three healthy cold masters have been accepted. | Bind host capture and restore tools to the four declared physical paths and volume, then restore the copies on isolated servers. | Four separately hashed path/volume/window-bound copies faithfully reproduce the observed bytes; offline streams, counts, sequences and expiring-stream treatment match. This does **not** prove historical independence of the four members; that needs deployment-time provenance outside this capture. | Step 1.2 closure and any topology change. |
| B9 | **Verified resumption closed.** A successful fixture cannot establish live recovery. | Follow the reviewed restore order, check all previously active services and writer routes, and record failures or success without claiming operational status early. | The 23-job prior state, NATS identities and routes, application health and retained histories match the approved acceptance contract; then step 1.2 may close. | Coordinated point 1.3 and a truthful operational claim. |

The next two gates after a hold are **stopped-VM capture of all four physical
NATS stores** and **isolated, real-history restoration/acceptance**. Their
fixtures are useful only when bound to authentic guest/host origin and the
actual four source roles; synthetic receipts do not close them. Verified
resumption must follow acceptance, not precede it.

## Heartbeat decision rule

At each wake, inspect the live plan/worktree and check B1–B9 in dependency
order. Choose one independently executable task that directly removes a named
gate, with a predeclared verification. A test or document counts as progress
only if its result changes that gate's state or establishes a required
production-bound prerequisite. Keep step 1.2 open until its runtime contract
is actually satisfied.

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
