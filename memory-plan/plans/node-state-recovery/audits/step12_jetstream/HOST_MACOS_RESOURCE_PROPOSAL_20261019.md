# macOS rehearsal capacity proposal — 2026-10-19 23:53 EDT

**Planning candidate only. Current production host: do not provision.** The operator's “go” selected preparation of this proposal, not a capacity source, budget approval, installer download, VM creation or reboot. B5 and D62 remain open. This proposal uses synthetic owned services/stores; it proposes no clone of the production VM or production history.

The preferred capacity source is a separately designated disposable Apple-silicon Mac, with **at least320GiB actually available on one internal APFS Data volume** for the guest source, capture and protected reader store. No such Mac or volume has been identified or verified. An external APFS disk is not a drop-in solution: the current capture path requires source and capture on one device, and Q requires the capture clone and root-controlled reader store on that same APFS volume. D261's proposed `/private/var/db/openclaw-recovery/acceptance` path is not automatically moved onto an external device. Any external alternative needs a separately reviewed protected-path/mount/ownership mapping as well as independent internal system reserve and memory admission; this proposal selects none.

## Fixed candidate budget

| Item | Proposed ceiling / reservation | Status |
|---|---:|---|
| Guest RAM | 8 GiB / 8,192 MiB | Candidate ceiling; selected restore-image minimum and host support unverified |
| Guest CPU | 2 vCPU | Candidate ceiling; selected restore-image minimum unverified |
| Guest ASIF logical disk | 64 GiB | Candidate limit; installation and rehearsal fit unproved |
| Guest source image, capture clone, protected reader copy | 3 × 64 = 192 GiB | Budget all three in full; do not assume CoW makes a copy free |
| Installer download plus possible tool staging | 2 × 32 = 64 GiB | At most two copies; one catalog candidate advertises 24.808 GiB; no body downloaded |
| Fixture data, evidence, temporary files and image overhead | 8 GiB | Planning allowance, not a measured bound |
| Workspace contingency | 56 GiB | Proposed local storage allowance; not a proven growth bound or reserve on another container |
| **Minimum workspace capacity to designate** | **320 GiB** | **192 + 64 + 8 + 56; source absent** |

“Actually available” means `statvfs.f_bavail × f_frsize` available to the intended unprivileged workspace owner on the exact APFS volume, measured immediately before use. GiB means2³⁰ bytes:320GiB is343.597 decimalGB. Do not add Finder purgeable estimates or hypothetical snapshot/deletion recovery. Other volumes sharing the same APFS container can consume this pool. The56GiB is workspace contingency, not an established host/production growth bound; system-volume swap/update headroom on another container must be measured and funded separately. If the system and workspace share a container, its other-workload reserve must also be demonstrated;320GiB alone is not admission.

The source inventory below counts three image-sized files. D264's “snapshot” is a JSON digest/size record of the existing capture clone; it creates no fourth image. This is source-confirmed, not an assumption that a fourth CoW copy is free.

| Current source consumer | Image-sized allocation | Evidence in current source |
|---|---|---|
| Fresh disposable guest | One64GiB source image | Proposed future guest; no production image is its input |
| `host_vm_capture.py` | One capture clone | `clone_only()` invokes clonefile; capture uses that one `powered-off-image.asif` |
| `host_capture_anchor.py` | None | `held_snapshot()` reads/hash-counts existing input descriptors; `snapshot()` returns metadata; `publish()` writes only the nonce JSON and links its staging name |
| `host_protected_journal_reader.py` | One protected working copy | `read_image()` calls `clone_fd()`/fclonefileat once in the pending directory; clean success removes it, while failure may retain it and pending evidence |
| `host_journal_mount.py` | No image copy | `locked_read()` mounts and reads the existing capture clone read-only |
| `host_asif_extract.py` | Store-directory copies, no new disk image | `copy_tree()` copies declared store files; their aggregate live/restore/evidence footprint must fit the8GiB fixture allowance |
| `host_clone_dispose.py`, `host_vm_reconcile.py` | No additional image created by these current paths | Inspect/remove the existing clone and verify source/release records; no clone/copy producer |

The evidence JSON pins these seven source files to this checkout. The source, capture clone and Q store/copy must share the exact APFS filesystem, not merely a container or capacity pool. A Q copy retained after failure is still the third budgeted image; it is not free or omitted. No new/overlapping attempt is proposed while that copy remains, and no automatic removal or retry is authorized. This census does not certify an unimplemented full rehearsal driver. Any additional future boot/abort fixture, retained attempt, cache or working image must be re-budgeted and reviewed before allocation; a third installer staging copy also requires revision.

The extracted-store and isolated-restore footprint is unmeasured; the8GiB allowance is a planning assumption that must be checked before allocation. These are proposed caps, not Apple requirements, a filesystem quota, validated performance or permission to allocate them. No automatic disk/RAM enlargement is proposed. A selected installer requiring more, additional simultaneous copies or a larger observed fixture would need a revised proposal before allocation. UTM documents that ASIF/raw images can be sparse on APFS; that does not reserve their future capacity. [UTM drive documentation](https://docs.getutm.app/settings-apple/drive/).

A separate host still needs a measured memory admission plan that preserves its own workload reserve after allowing the candidate 8 GiB guest plus virtualization overhead. This proposal admits no production-host memory budget. Physical RAM capacity, process RSS, a low pressure reading or the query's free percentage alone does not prove sufficient available memory for another guest.

## Current measurements

Read-only host observations at **2026-10-19 23:48:43 and 23:50:33 EDT** (03:48:43/03:50:33 UTC on October 20) retain the same production UUID, started state, image device/inode `16777233/17966030`, holder PID8509 and 211,261,108,224 allocated bytes before and after each sample. Logical size is 211,267,092,480 bytes. No image content was opened or modified. Full normalized facts and raw-input byte/hash bindings are in [the evidence record](HOST_MACOS_RESOURCE_EVIDENCE_20261019.json).

| Observation | Measured result | Implication |
|---|---|---|
| Host Data available space | 13.985 then 13.984 GiB | 6.016GiB below the existing20GiB capture floor, and306.016GiB below this320GiB workspace minimum before any additional same-container workload reserve |
| Change from October19 15:53 assessment | 19.513 GiB less available | Net filesystem change; cause uninvestigated, not attributed to this work or the VM |
| Production image allocation | Unchanged from that earlier assessment and across current samples | No observed allocation growth in these samples; no future growth bound follows |
| Physical memory | 64 GiB | Capacity, not available RAM |
| Production configured memory | 20,000 MiB / 19.531 GiB | Its configuration was read, not changed |
| Holder RSS | 31.211 then 31.378 GiB | Process measurement, not an isolated guest or available-memory reserve |
| Memory query / pressure level | 56%, then 58%; numeric pressure level1 | Recorded query metrics, not a guarantee that this percentage is immediately available physical RAM |
| First free + speculative VM pages | 0.122 GiB | Narrow page categories; inactive/compressed memory is not treated as a guaranteed reclaimable reserve |
| Swap used | 11,114.25 MiB / 10.854 GiB in both samples | Existing swap occupancy; stable over this short interval does not establish sustained headroom |
| Physical bundles | Production macOS; 1,024 MiB Linux guard bundle | No observed disposable macOS machine |
| External `/Volumes` disk mounts | None in the bounded query | No external capacity source verified |
| Installer names | None in `/Applications` or top-level Downloads | Bounded inventory only, not a whole-host search |

The20GiB capture floor is unchanged and is only a necessary capture predicate, not a complete capacity budget. Recovering6.016GiB would only restore that floor; it would not close the306.016GiB proposal gap or establish future headroom. The unexplained19.513GiB net loss and a defensible workload/growth allowance must be resolved before a current-host route can be admitted. No deletion, purge, compression, production resize, service stop, swap change or VM change was attempted. A future production-host route needs a separately approved capacity source and defensible host/production growth and memory allowances; the present observations do not supply them.

## Installer availability and version fidelity

Apple's [official IPSW catalog](https://mesu.apple.com/assets/macos/com_apple_macOSIPSW/com_apple_macOSIPSW.xml) was fetched at03:49:31 UTC: 99,450 bytes, SHA-256 `0925a0b28dc2da5342e180dac9a1911eacdae097f055c8b117882cf9b8cb2958`. Its one `VirtualMac2,1` restore entry names **macOS27.0.1 / build26A434**. An HTTP HEAD to that entry's Apple CDN URL at03:50:12 UTC returns200 with advertised `Content-Length: 26637307067` (24.808 GiB). These establish reachable catalog/object metadata only; no installer body, authenticity, successful installation or host compatibility is verified.

The host reports **macOS26.6.2 / build25G83**. The production guest running this Codex checkout was separately queried with sw_vers and reports **macOS26.2 / build25C56**, hardware modelVirtualMac2,1. That guest version, not the host version, is the current candidate rehearsal target; this read-only version observation is not a just-in-time B3 installation pin. The catalog's27.0.1 candidate is not a verified substitute for guest26.2. **No version-matched26.2 restore-image source has been identified in this assessment.** No OS upgrade or version substitution is selected. The earlier `VZMacOSRestoreImage.fetchLatestSupported` catalog-service refusal remains historical evidence; HTTP catalog access is a different observation and does not prove that host API now succeeds.

Before selecting an image, establish a suitable version and actual host-supported configuration/minimums through Apple's APIs, then pin that exact source and validate the download in a separately authorized step. The 8 GiB/2vCPU/64 GiB candidate must be revised if it is incompatible or too small; do not relax checks or use an unverified image. Apple describes restore images and configuration requirements in its [installation documentation](https://developer.apple.com/documentation/virtualization/installing-macos-on-a-virtual-machine) and [minimum memory API](https://developer.apple.com/documentation/virtualization/vzmacosconfigurationrequirements/minimumsupportedmemorysize). UTM recommends its compatible-image selection flow; this proposal does not invoke it or download an image. [UTM macOS documentation](https://docs.getutm.app/guest-support/macos/).

## Production fidelity remains outside this budget

A synthetic64GiB rehearsal image does not represent production's196.758GiB logical image. Rehearsal clone/copy/hash timing, growth and footprint cannot be extrapolated to production. Production capture capacity remains unresolved and is not funded or approved by this proposal; multiple roughly197GiB image objects, extracted/restored stores, installer/staging and workload reserves need their own budget. The existing20GiB floor is not proof that those costs fit and is not a license to assume cheap clones. No production resize, capture, stop or history acceptance follows.

## Decision still required

Name an exact separate disposable Mac and its internal APFS capacity source, or request a revised current-host capacity plan after its existing reserve shortfall is addressed by the operator. The latter still needs measured sustained memory/growth headroom; adding an external disk alone does not clear it. No purchase, deletion, capacity change or access grant is requested by this document.

After designation, separately verify image/version compatibility, resource admission and the exact owned rehearsal contract. Installation, native full pipeline/APFS reattach, reboot/login/process/hold/manual/D175 proof, installed protected acceptance, B3 provenance and any B6 attended production release retain their own gates. This is a completed proposal, not completed access, admitted resources or permission to execute the rehearsal.
