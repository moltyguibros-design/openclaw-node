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
| B1 | **Decision needed now:** the existing rule requires a complete no-writer proof *before* any production service or VM stop; the demonstrated in-guest mechanisms cannot provide it on the mounted Data volume. | Operator chooses one of the two boundaries in `audits/step12_jetstream/HOLD_BOUNDARY_DECISION_CANDIDATE_20261012.md`. Recommended: approve design and owned tests for a bounded whole-node stop with definitive physical no-writer proof after clean VM shutdown and host boot guard. This choice alone authorizes **no live stop**. Keeping the original rule requires a newly demonstrated pre-stop exclusion mechanism and has no credible completion date. | An explicit operator choice recorded in `DECISIONS.md`; until then retain the existing no-stop rule. | Production stop design, then B5. |
| B2 | **Access needed before host rehearsal:** the guest's read-only SSH attempts as `moltymac` to the UTM host at `192.168.64.1` were refused; the host control path is unverified. | Operator supplies the correct existing host access method or performs the disposable-VM rehearsal with the reviewed commands. Codex prepares the exact commands and expected refusal/recovery evidence first. | Successful read-only host identity/UTM inventory, then an owned disposable VM start-denial and recovery receipt. No live VM test. | Host boot guard and B5. |
| B3 | **Stale installation pins:** the October 9 candidate names `viewer-observed-20261008`; the installed viewer has since moved to `viewer-plan-task-links-autosave-20261011`. The 23-job candidate is unapproved. | Codex re-captures all 23 installed jobs and direct file hashes read-only, resolves every drift, and presents one current baseline for review. | Current installed identities and hashes match the reviewed baseline immediately before a window. | Full-node hold and B5. |
| B4 | **Writer provenance not closed:** the owned detached-writer and hidden Mach-entry controls disprove relying on the gate, launchd overrides, flags, or current census as a complete pre-stop writer certificate. | Codex audits the installed payload/invoker set against the 23-job baseline and designs a fail-closed physical boundary on owned resources. Do not count another synthetic probe as progress unless it resolves this specific gate. | Reviewed provenance inventory and owned negative showing a missed writer refuses the chosen stop/capture sequence. | Full-node hold and B5. |
| B5 | **Full-node hold and shutdown closed.** B1–B4 and a reviewed fail-closed controller/runbook are prerequisites. | Codex finishes the owned hold/abort controller and proposes the exact production sequence for review. | Fresh installed pins, bounded application quiescence, verified clean VM shutdown and active host boot denial, with the physical no-writer proof required by the approved boundary. | Stopped-VM capture. |
| B6 | **Four-store capture and isolated acceptance closed.** No three healthy cold masters have been accepted. | Codex binds the host capture and restore tools to four distinct physical source roles; the operator reviews the exact capture window after B5. | Four separately hashed, origin-bound cold copies; offline restoration on isolated servers with matching streams, counts, sequences and explicit expiring-stream treatment. | Step 1.2 closure and any topology change. |
| B7 | **Verified resumption closed.** A successful fixture cannot establish live recovery. | Codex uses the reviewed restore order, checks all previously active services and writer routes, and records failures or success without claiming operational status early. | The 23-job prior state, NATS identities and routes, application health and retained histories match the approved acceptance contract; then step 1.2 may close. | Coordinated point 1.3 and a truthful operational claim. |

The next two gates after a hold are **stopped-VM capture of all four physical
NATS stores** and **isolated, real-history restoration/acceptance**. Their
fixtures are useful only when bound to authentic guest/host origin and the
actual four source roles; synthetic receipts do not close them. Verified
resumption must follow acceptance, not precede it.

## Heartbeat decision rule

At each wake, inspect the live plan/worktree and check B1–B7 in dependency
order. Choose one independently executable task that directly removes a named
gate, with a predeclared verification. A test or document counts as progress
only if its result changes that gate's state or establishes a required
production-bound prerequisite. Keep step 1.2 open until its runtime contract
is actually satisfied.

An actionable blocker is itself a material event. Emit `NOTIFY` immediately
for a newly discovered or changed blocker, an overdue blocker, or a decision
needed from the operator. Name its ID, evidence, owner, exact unblock action,
and the downstream operation it prevents. Re-alert an unresolved operator
blocker after 24 hours, not every two-hour wake. Emit `DONT_NOTIFY` only when
there is no new gate movement, no newly actionable blocker, and no overdue
re-alert. Check prior alerts in this thread for duplicate suppression; do not
assume a file edit or a quiet heartbeat delivered a warning.

The heartbeat's `NOTIFY` output is a Codex task notification. Delivery to
ChatGPT Dot has **not** been verified. Do not claim a Dot warning was sent
until the user confirms that this task's notification reaches Dot or a
supported connector is configured and tested.
