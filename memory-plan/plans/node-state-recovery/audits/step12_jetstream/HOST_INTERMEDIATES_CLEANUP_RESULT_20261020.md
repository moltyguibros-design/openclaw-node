# Approved intermediate cleanup — 2026-10-20 00:36 EDT

**Both approved folders were removed.** Host Data-volume available space changed from **14.636 to 24.558 GiB**, an observed increase of **9.923 GiB** across the cleanup interval. The result is **4.558 GiB above the existing 20 GiB capture floor**, but still **295.442 GiB short of the 320 GiB rehearsal proposal**, before workload reserve. No capture or rehearsal is admitted.

The operator answered **go** directly to the explicit two-folder approval request, which described the reported 13.4 GiB allocation, uncertain reclaim, retained outputs and recompilation consequence. The one-shot operation ran at **2026-10-20 00:36:45–00:36:49 EDT** on the physical host as uid501.

## Exact removal

Only these two host paths were selected and removed:

- `/Users/guillaumebrossard/Library/Developer/Xcode/DerivedData/Unity-iPhone-btlavqxzwobadbdkojemuxzotpjm/Build/Intermediates.noindex`
- `/Users/guillaumebrossard/Library/Developer/Xcode/DerivedData/arcane-semantic-dd/Build/Intermediates.noindex`

Both were absent at the final observation. The reported allocation before removal was 13.427 GiB. That accounting value is not the observed pool change or a guaranteed exclusive reclaim amount. The shared APFS pool remained active; concurrent activity can contribute to the before/after delta. The difference is not attributed to a specific mechanism.

## Preconditions and retained state

Both output roots map through their own info.plist to ArcaneRapture workspaces under `builds/` and `builds/InterpreterSoloSemanticDev/`. Each workspace and its referenced Unity-iPhone/Pods projects exist. Their configuration files are pinned by identity, metadata and SHA-256. No source workspace or configuration is a removal target.

Immediately before each removal, the recorded target/parent identities, directory type, owner501, flags, project/configuration pins and retained directory metadata match. Each stored holder result is rc1 with empty stdout/stderr and an elapsed time. **The holder command, recursive arguments and timeout parameter were not stored in the runtime JSON; they exist only in the hash-bound local temporary script, with no later-retention promise. The historical raw process sample was never persisted.** Codex reports that the script asserted no relevant build/DerivedData executable after excluding its observer, and used the recursive holder check before removal. These are reported execution details, not consumer-absence conclusions independently checkable from the durable runtime record. Neither rc1 alone nor observer_pid proves the claimed method or absence, and no exclusion lock is established.

Codex reports that removal used the Python standard library's symlink-resistant directory cleanup from a held, identity-checked parent directory, with an exact two-path allow-list and no permission changes or elevation. The original one-off script is bound by hash only in the evidence; its source is not retained in this repository and is not independently code-traced here. No cleanup helper is installed or shipped.

After each removal and at final verification, the recorded project/workspace configuration identities/hashes and retained `Build/Products`, `SourcePackages` and `Logs` directory identities/metadata still match. This is not a byte hash of every retained file. No actual rebuild was run or promised; subsequent builds must regenerate the removed intermediates, with unmeasured time and dependency requirements.

The production VM is observed `started` throughout the before/per-action/after guards, with the same image device/inode16777233/17966030, holderPID8509, logical211267092480 and allocated211261108224 bytes. No image data was read, and no VM/service/timer operation occurred. The guard does not prove unchanged image contents or future growth. D250/D251 incident and attended reconciliation limits remain unchanged; no blanket historical production-data claim is made.

## Remaining boundary

This authorization is consumed by the recorded execution. Regenerated trees are not automatically removed. Installers, Spotify/uv caches, source/package histories, finished builds, logs, other DerivedData, Xcode user/device data, models/runtimes, system snapshots/swap and all other files remain outside this removal.

[The retained runtime evidence](HOST_INTERMEDIATES_CLEANUP_EVIDENCE_20261020.json) contains target metadata, per-action outcomes, availability samples, retained-state checks and production guards. It **does not retain the historical process sample or holder-check invocation parameters**; the consumer-check claims above are qualified accordingly. Those missing historical records are not replaced by current probes or inferred from a successful status. These are Codex's host observations; independent review can assess internal consistency, not independently verify execution. Temporary-input hashes promise no later retention. This qualification supersedes D287's earlier blanket statement that all normalized preconditions needed for its claims were durable.

Only the approved two-folder cleanup is complete. B5-macOS-access, sustained capacity/memory reserve, installer/version fit, production fidelity, installed protected authority/B3, full held/process/reboot/admission/manual/D175 and parent B5 stay open. VERSION stays `v1.2-pre`; B6–B9 stay held, D64/Gate unchanged and production capture disabled. Original R3/later failure causes and attended task/session reconciliation are not advanced by this cleanup.
