# B5 journal mount wrapper: boundary review before the CI ownership probe

**Base:** 5b6c84af with `journal-mount-wrapper-on-5b6c84af.patch` (sha256 `a2c5a0df…`, commit 4bf3576c).

**This increment:** `journal-mount-cleanup-boundaries-on-a2c5a0df.patch`. It changes only `host_journal_mount.py`, `probe_asif_mount_ownership.py` and `test_host_journal_mount.py`.

**Where the findings came from:**
- Two findings from the operator's source review.
- An independent read-only reviewer pass over the 4bf3576c source.
- A second pass of my own.

Every fixed row below has a test that fails on 4bf3576c and a one-rule mutant killed for its intended reason. Nothing was run natively: no mount, attach, probe or VM operation.

## Fixed

| # | Boundary | At 4bf3576c | Now |
|---|---|---|---|
| 1 | Mount point removal | `os.rmdir` whenever the mount point existed, even when post-eject statfs said still mounted (`True`) or could not tell (`None`); it relied on the kernel's EBUSY | Removed only when statfs confirmed the point is no longer a mount, and only if it is a plain, empty directory. Otherwise it is kept, recorded as a `kept` step or the reason, and the run is not clean |
| 2 | Interrupt during cleanup | `step()` caught only `Exception`, and the eject pause sat outside it. A KeyboardInterrupt or SystemExit escaped `release()`, replaced the primary error and lost `FAILED.json` | Cleanup stops where the interrupt arrived, records it and is not clean. On the failure path the primary error is raised with the interrupt in its evidence. On the success path the interrupt itself is raised, `FAILED.json` gets stage `release`, and no receipt is written. A second interrupt while `FAILED.json` is written is dropped, because the error being recorded is raised right after |
| 3 | Output name | Any new child name was accepted, e.g. `FAILED.json`, which put a directory where a capture record belongs | Only `journal-read[-NAME]` |
| 4 | Production gate | A deny-list of one HOME-relative parent, which HOME or a deeper path gets past; no parent ownership check | A positive owned fixture-parent prefix (the native fixture capture's or the owned tests') plus `owned_directory(parent)`. The VM must also be the fixture VM in the host's own pinned started sample |
| 5 | Capture locks | ARMED.json opened with `open('rb')`, which follows a symlink and blocks on a FIFO. CAPTURE_ACTIVE.lock was ignored, so a still-running worker could fail the capture after the receipt. A non-busy `flock` error left no evidence. The locked inode was never tied to the arm record | CAPTURE_ACTIVE.lock, then ARMED.json, each opened `O_NOFOLLOW\|O_NONBLOCK`, owner-private regular single-link 0600, and locked `LOCK_EX\|LOCK_NB`. Any lock-stage failure is in `FAILED.json`. The locked ARMED inode must be the arm record, before and after |
| 6 | Cleanup trusts the inventory | If `hdiutil info` missed the attach, nothing was ejected and the run reported `clean: true` with the clone still attached | The attach result's own disk must also be unknown to diskutil afterwards, or the run is not clean. It is never ejected on that evidence alone |
| 7 | Eject retry | A timed-out eject that applied frees the disk number; the retry could eject another image that took it | Each retry first re-reads the inventory and ejects only a disk still bound to the clone |
| 8 | Reader binding | The reader's rows, checkpoint and pre-head were not compared with what was mounted and pinned; no check after the read | Every read row must be on the mount's device, the reader must have verified the pinned commitment, and `verify_mount` must return the same view after the read |
| 9 | CAPTURE.json double read | The pins were checked on one read, the fields came from another | Both reads must be byte-equal |
| 10 | Receipt write | Direct `write_record`, so a failure mid-write (or after it) could leave a partial or complete receipt beside `FAILED.json` | Written aside, linked in exclusively, synced; any failure removes what this run created. A planted staging file is refused and kept |
| 11 | Command stdin | Inherited, so a passphrase prompt would wait out the 60 s timeout | `stdin=DEVNULL` |
| 12 | CLI | Read the table before the production refusal | The refusal comes first |
| 13 | umask | Set before the refusals and never restored | Set for the run only, then restored |
| 14 | Eject pause | Slept after the last failed attempt too | Pauses only between attempts |
| 15 | Probe | Inventory-only cleanup (same gap as 6); no report on an interrupt; report lacked the inventory's system entities and the image's `st_flags` | Ejects and confirms gone the disks its own attaches returned, and clears them once a phase is confirmed clean. Writes the report in `finally` and re-raises an interrupt. Records the entities and flags |
| 16 | Tests | A no-op `probe.run` patch; locks asserted only during the read; a same-mode chmod as the ctime change; the clone-owner rule needed root | Patch removed; both locks asserted held at eject and at the receipt write; a real mode change and back; the owner rule now runs as any uid |

## Evaluation: bounded evidence, never swallowing an interrupt

Deferring an interrupt until cleanup completes was rejected. With bounded commands (60 s each, three ejects per disk) a Ctrl-C would wait several minutes, and a second Ctrl-C would be deferred too.

Stopping at the interrupt honours it at once and records exactly which step it stopped. `clean` stays false, so no receipt can follow. The recorded inventory and statfs evidence say what is left.

The process still unwinds with an exception in every case:
- after a primary error, that primary error;
- after a good read, the interrupt itself.

So only an interrupt that lands while the primary error is already propagating stops being the exception raised; it is still recorded. A successful-path interrupt is never swallowed.

**Residual:** Python delivers signals between bytecodes. An interrupt in the few bytecodes between the handler and `release()`, or between `release()` and `record_failure()`, can still lose `FAILED.json`. The durable guard against what such a lost cleanup leaves behind is the next run's inventory refusal ("clone is already attached").

## Not changed, recorded as residuals

- **Data volume in the inventory row:** the Data volume is not required to appear in the inventory row's `system-entities`. Whether `hdiutil info` lists the synthesized APFS container disks is unobserved, so enforcing it now could refuse every native run. The probe now records those entities, so the rule can be added from evidence.
- **Concurrent attachments:** cleanup ejects every inventory attachment of the clone, including one a same-uid process attached concurrently despite both locks (the D189 same-uid class).
- **Same-uid rewrites:** a same-uid rewrite of capture records between checks is narrowed, by the single CAPTURE read and the arm-inode binding, but not closed (D189).
- **No force-unmount fallback:** a busy unmount leaves the clone attached and the run not clean. The next run refuses until an operator ejects it.
- **Hashing cost:** the clone is hashed in full twice, so time grows with image size; there is no timeout on hashing.
- **Re-verification st_dev half:** the fakes cannot change the mount's device, so that half is not exercised; it is listed as not mutated.
- **Unobserved macOS facts:** these remain unobserved until the CI probe runs:
  - that `diskutil mount readOnly -mountOptions nobrowse,nodev,nosuid,noexec,owners` is accepted and sets those flags;
  - the `GlobalPermissionsEnabled`, `WritableVolume` and `Encryption` keys;
  - hdiutil's `writeable` key and its `system-entities` content;
  - whether ownership is honoured without `enableOwnership`;
  - whether a read-only attach leaves the image's ctime and xattrs unchanged;
  - that `diskutil info` of an ejected whole disk exits non-zero.

## Verification (fresh 5b6c84af, then a2c5a0df, then this patch; Linux, owned scratch)

- **`test_host_journal_mount.py`:** 60 tests, green as root and as uid 65534 with no skips.
- **Neighbour suites:** `test_stopped_journal_inputs.py` (30 tests) and the neighbour suites are green.
- **On 4bf3576c:** the new tests fail there (39 failures and 9 errors across the new and changed cases).
- **`mutants_journal_mount.py`:** 119 one-rule mutants of the wrapper and the probe guards and cleanup, all killed for the intended reason.
- **`mutants_reader.py`:** 46 mutants, unchanged from 4bf3576c, still all killed.
