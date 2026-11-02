# Runtime installation records

The source checkout is replaceable input. The installer copies its selected code and dependencies into a content-bound directory under `~/.openclaw/runtime/node/`. Existing databases, learned genes, event history and configuration remain outside that directory. Mission Control has its own staged build directory and retains its existing data directory.

`config/installation.json` records the installer attempt. It does not grant recovery, production or native-execution authority.

- `prepared`: the runtime was selected, but the rest of this installer attempt has not completed. An error, interruption or skipped finalization leaves this phase. The `current` link alone proves neither completion nor running services.
- `installer-complete`: the installer reached its end after its verification step. `acceptance` separately records `accepted`, `incomplete` or `skipped`; `servicesRequested` records whether service activation was requested. An incomplete or skipped result remains unverified on those axes. This is an installer record, not signed CI or physical-liveness evidence.

Each attempt has an identity. Completion must match that identity, the current release and its verified files. The last completed result is retained as `previousComplete` while a later attempt is prepared. Old schema-1 records are qualified as `legacy-unknown`; they are never retroactively credited as completed.

Health and deploy-status reports use `runtime:<digest>` for a managed release. The source Git revision, dirty flag and selection method remain separate recorded metadata. `manifest-receipt-only` means that the report verifies the receipt's manifest digest, not every executable file on each health tick. Staging and installer completion perform their own file verification.

## Repeat installation

A known existing installation enters update mode, preserving configuration and service selection. Missing prerequisites can be checked or repaired explicitly with `bash scripts/install/prereqs.sh` from the selected source. Normal update mode skips system prerequisite installation.

A new Linux installation that only rendered its units records pending initial starts. A later `bash install.sh --update --enable-services` starts those defaults. After the installer has activated a unit, an ordinary update preserves an operator-disabled unit.

Older prepared installations may have no pending-start records. `--start-default-services` deliberately enables the manifest's autostart defaults and implies `--enable-services`; it can re-enable an autostart unit previously disabled by the operator. Masks and non-autostart units remain untouched. Use the ordinary update option when retaining the current selection.

## Retained code and data

Old runtime directories are retained. A runtime bundle carrying its release receipt, or a source path inside the managed runtime directory, cannot be used as installer source. Selecting a non-current retained release from matching independent source is also refused. These are deliberate refusal boundaries, not an automatic rollback path. Preserving code does not establish that old code can read the current database schema, event history, configuration, external tools or native dependencies.

A code-only recovery needs an explicitly selected, independently prepared and reviewed revision plus a compatible-data contract. It must preserve current data, record the exact selection, refresh only authorized services and obtain new runtime evidence. It must not silently restore an old database or borrow the previous installer's acceptance. This installer supplies no retained-release activation command; an actual recovery remains a separately reviewed operation. Removing a receipt or copying old files does not establish compatibility or clearance.

## Installer transactions

A mutating installer, model setup, or standalone Mission Control deploy/cleanup holds the private `.installer-lock`. An existing or interrupted lock refuses another writer; PID records do not authorize stale takeover. Check the owner and retained evidence before reconciling an interrupted transaction.

The installer passes a per-invocation nonce to its direct Node children. A child inherits only when its parent PID and nonce match the current owner record; it never removes the outer lock. Standalone Mission Control takes the same outer lock and its own transaction lock. Canonical paths make root/workspace symlink aliases use the same release and lock. `llm-setup.sh --check` remains advisory and does not acquire a writer lock.

A failed Mission Control selection keeps the old current/data, removes only its own temporary selection link, and retains a failure record. Later cleanup archives that record before pruning the unselected build. Capacity bounds can stop cleanup or another build; those refusals do not authorize data deletion or a hidden fallback.


Retired code archives (Linux)
----------------------------

The runtime limit stays at eight releases. Before another allocation, explicitly select retired digests with `node bin/archive-runtime.mjs --root <root> --release <digest>` (repeat `--release` for one archive group). This command serializes with installer, stage, dependency binding and completion operations. It refuses releases referenced by current/previous installation metadata, workspace links, active top-level configuration/env files, user unit definitions or observed owned Linux processes. These checks coordinate this installer; they do not prove no external writer exists.

Only complete, unmodified receipt-bound code trees qualify. Unknown files, broken links, foreign locks and unfinished archive attempts require reconciliation. The command streams a gzip tar that preserves dependency hardlinks, verifies every archived file/link against the manifest, then checks references and source bytes again before removing the explicitly selected retired code. Database/configuration/model/history paths are outside this operation. Archives and their manifests/results stay private under `runtime/node-archives/`; archive verification executes or extracts nothing. `/usr/bin/python3` and the installed `tar` are the declared data tools, with no fallback. Archives are bounded to 512MiB each, a 1GiB retained archive budget and a 4GiB free-space reserve. Budget exhaustion refuses further work; nothing automatically deletes evidence or raises limits.

An interrupted or failed attempt retains its partial archive and result. Do not repeat that writer automatically. Reconcile its durable record before a new attempt. Archives preserve code for a separately reviewed compatible-data recovery; this command does not select old code, restore data, restart services or grant recovery authority. macOS archival support is not implemented by this Linux unit.


When Linux denies metadata for an owned process (for example the capability-bearing systemd user manager), the default reader refuses. Explicit `--privileged-process-reader` instead selects `sudo -n /usr/bin/python3 -I -S -B` for the same reviewed helper's process-reference-only mode. Authenticate sudo in the VM's terminal beforehand; this command does not change sudo policy or ask for/store a password. Only process metadata (including environment references) for the invoking real/effective UID is read with privilege. Output contains matching release digests, never environment values. The archive, verification and pruning remain unprivileged, and running the whole archival helper as root is refused. Reader failure refuses archival; it never ignores a process or switches methods automatically.


Canonical dependency readiness
-----------------------------

Runtime updates clean-install the checked-in lock with `ci --omit=dev` even when an old `nats` directory exists. Runtime installation and staged Mission Control builds explicitly use `npx --yes --package=npm@11.21.1 npm`, checking that exact version before `ci`. This is the selected toolchain, with no older-writer fallback or global npm replacement. The package comes from the public npm registry; an unavailable tool or failed installation refuses. It requires Node20.17+ or Node22.9+; the node installer remains on its supported Node22 line, and Mission Control's pinned Vite8.1.6 needs Node22.12+. Mission Control owns Vite8.1.6 and Vitest4.1.12 as dev tools. Historical npm10.9.9 proofs remain historical; its internal peer-graph failures are retained rather than represented as source/build failures.

Fresh `install.sh` execution requires Node 22.12+ across its prerequisite gate and both package manifests. Linux installs the pinned NATS server 2.12.15 release only after verifying its platform archive against the selected SHA-256; an override requires a supported version and an explicit archive digest. `--check` and dry-run refuse an installed server older than 2.12.15. A fresh install instead replaces it, on Linux at `/usr/local/bin/nats-server` after verification and on macOS through `brew upgrade nats-server`; the final gate still fails if an older binary remains earlier on `PATH`. The local NATS bus remains required under `--skip-mesh`, while Tailscale is skipped with mesh integration. An update to an existing node skips system prerequisites and does not replace an installed NATS binary.

Before runtime allocation, declared SQLite/vector dependencies are opened only in memory. Sharp and ONNX modules are imported only when model capability is enabled, without loading a model or running inference. An explicit model-free install sets that capability before staging, matching the setting later persisted by the installer. Required probe failure preserves the current release. Readonly dependencies are shared only across matching ABI/platform/architecture receipts. Managed identity refuses a running Node ABI/platform/architecture mismatch and reports recorded/running versions separately. These are staging-time compatibility checks, not continuous executable authentication or inference capacity proof.

Root CI audits the shipped dependency graph at the high/critical threshold using the same pinned tool, within the existing root test driver. Advisory/provider errors fail the gate. Mission Control's shipped/full audits and all fresh final-head CI/artifact/receipt gates remain separate. An audit version fix does not establish a demonstrated exploit in every application's transport or schema path.
