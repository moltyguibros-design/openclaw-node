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
