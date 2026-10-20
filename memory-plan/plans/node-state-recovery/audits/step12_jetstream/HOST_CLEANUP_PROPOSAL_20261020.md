# Current-host cleanup proposal — 2026-10-20 00:24 EDT

**Planning only. This cleanup does not fund the rehearsal.** The latest read-only sample has **14.068 GiB available**, 5.932 GiB below the existing 20 GiB capture floor. The identified categories report 35.510 GiB in total. Even if all those reported bytes became available, the result would be about 49.577 GiB, still 270.423 GiB short of the 320 GiB workspace proposal before workload reserve. Conditional and deferred categories are included in that illustration; it is not a reclaim guarantee or an approved batch.

The operator's continued “go” is treated as permission to prepare this proposal. No deletion, cache clearing, app interruption or capacity admission has been performed or inferred.

## Exact candidates

All paths below are on the physical host under `/Users/guillaumebrossard`, not the Codex guest.

| Candidate | Reported allocation | Proposed treatment and consequence |
|---|---:|---|
| `Downloads/Firefox 157.0.dmg` | 0.151 GiB | Optional exact-file deletion after approval and a fresh identity/holder check; installed Firefox 157.0 was observed. Removing it loses this installer copy; no installer-content or authenticity check was done. |
| `Downloads/Brave-Browser.dmg` | 0.332 GiB | Same exact-file treatment. Installed Brave 155.1.97.56 was observed, but the installer version was not inspected. No other Downloads file is selected. |
| `Library/Caches/com.spotify.client` | 2.310 GiB | Conditional use of Spotify's own **Settings → Storage → Clear cache**. The measured directory is not proof of the UI's removable-byte count. No app reinstall, offline-download removal or broader Spotify data deletion is proposed. |
| `Library/Developer/Xcode/DerivedData` | 29.425 GiB | Conditional project-specific build-artifact review and cleanup, after confirming provenance, rebuildability and no active build/consumer. Do not delete the whole directory merely because of its name. Loss of build/index/package intermediates can cause rebuilds, downloads or lost diagnostics. |
| `.cache/uv` | 3.292 GiB | **Deferred.** Two uv executables are active in the process sample. Link-mode/dependent environments are unverified. No forced operation, manual directory removal, `--ci` policy or blanket clean is proposed. A later supported prune needs an idle window and dependency review. |

The two installers sum to **0.483 GiB**, insufficient on their own to restore the capture floor. Their observed identities are pinned in [the evidence](HOST_CLEANUP_EVIDENCE_20261020.json); a current `lsof` sample reports no holder, which is not a lasting exclusion. Moving them into Trash alone would not release space. [Apple storage guidance](https://support.apple.com/en-us/102624).

Spotify distinguishes cache from offline media and documents its app-owned clearing control. The current installed app is 1.3.5.3058; the control has not been opened or exercised in this assessment. [Spotify storage guidance](https://support.spotify.com/us/article/storage-information/).

Installed uv is 0.11.23 at `/opt/homebrew/bin/uv`. Its local prune help confirms the operation and exposes an in-use override; that override is not selected. Vendor guidance calls for tool-owned cache handling and warns that symlink-linked environments can depend on cached files. Host link mode, dependencies and potential freed bytes remain unknown; recreated environments may need network access. [uv cache guidance](https://docs.astral.sh/uv/concepts/cache/), [uv link-mode reference](https://docs.astral.sh/uv/reference/cli/). No uv cleanup command was run.

## Xcode output needs owner review

Most of DerivedData is in two exact directories:

- `Library/Developer/Xcode/DerivedData/arcane-semantic-dd`: 15.174 GiB reported.
- `Library/Developer/Xcode/DerivedData/Unity-iPhone-btlavqxzwobadbdkojemuxzotpjm`: 13.751 GiB reported.

Other entries are ModuleCache, SymbolCache, SDKStatCaches and CompilationCache. The custom Arcane path is not assumed disposable, and neither project is certified rebuildable or independent of running tools. A process-name sample finds no executable located inside DerivedData but does show programs from Xcode's bundle; it cannot prove no consumers or active build. The 29.425 GiB figure is the category's current accounting, not an approved removal list. Apple documents project-specific DerivedData cleanup as a build workaround, which does not validate wholesale removal of these host outputs. [Xcode 26 release notes](https://developer.apple.com/documentation/xcode-release-notes/xcode-26-release-notes).

Xcode `UserData`, the 11.370 GiB `iOS DeviceSupport` category, simulators and any archives are outside this proposal. No upgrade, build, reset or app quit is selected.

## Scope and execution boundary

This proposal excludes conversation databases/sessions, Codex runtimes, models, application support data, VM images, recovery evidence, system assets, swap/snapshots and unrelated Downloads or Trash contents. It does not expand the source plan's protected acceptance authority. No generic cleaner, recurring task or deletion script is created.

Before any future approved action, refresh exact path/type/owner/identity and relevant consumer observations; fail on a mismatch or new consumer rather than widening the target or forcing it. Required app/build quiescence is an operator decision, not permission to stop anything. Candidate approval is per named item and method; approval of one item does not approve the table. Verify actual Data-volume `f_bavail × f_frsize` before and after each action, preserve production identity/status/holder checks, and stop after the approved scope. No amount of file-size accounting substitutes for that available-space result. No restoration guarantee follows without a separately verified backup; regenerable caches may incur rebuild/download costs.

Read-only observations at 00:21–00:23 EDT preserve the production started state, image device/inode 16777233/17966030, holder PID8509 and 211,261,108,224 allocated bytes before and after all three groups. Info.plist application metadata, directory/file metadata, version/help output and filtered executable names were read; no image, installer, conversation or project-source data was read. Measurements are sequential on an active host and do not solve D285's historical-loss attribution.

The [retained metadata](HOST_CLEANUP_EVIDENCE_20261020.json) supplies the object identities, raw normalized command results, method sources, failures/limits and arithmetic. This completes a proposal for review only. B5-macOS-access, the separate-Mac/resource decision, sufficient memory and workload reserve, installer/version fit, protected authority/B3, full integration/reboot and parent B5 remain open. B6–B9 remain held; VERSION remains `v1.2-pre`, D64/Gate unchanged and production capture disabled.
