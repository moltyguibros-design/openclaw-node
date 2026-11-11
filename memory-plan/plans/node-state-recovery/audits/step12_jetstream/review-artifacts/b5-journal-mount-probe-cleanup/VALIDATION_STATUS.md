# probe-cleanup-on-6250b496.patch: candidate delivery, validation in progress

Delivered early so the source can be read and tested in parallel. This is artifact delivery
only: not a readiness claim, not a probe, CI or production authorization. The probe stays
unwired. B5 open, B6 closed, D64 unchanged.

**Base:** 5b6c84af + `journal-mount-wrapper-on-5b6c84af.patch` (`a2c5a0df…`)
+ `journal-mount-cleanup-boundaries-on-a2c5a0df.patch` (`6250b496…`).

**Changes:** `probe_asif_mount_ownership.py` (cleanup binding, attach harvest, unreadable
inventory, interrupts, guarded rmtree), `test_host_journal_mount.py` (10 new tests, 69 total),
one docstring paragraph in `host_journal_mount.py`. No wrapper code change.

## Verified on this exact candidate

- Applies cleanly as the third patch on a fresh 5b6c84af archive; the result is byte-identical
  to the work tree.
- `test_host_journal_mount.py`: 69 tests green as root (work tree and fresh tree).
- On the operator's tree before this patch the new tests fail: 1 failure, 11 errors.

## Pending on this exact candidate

- **Full mutant run** (`mutants_journal_mount.py`, 131 rows). Running now.
- **uid 65534 run** of the suite.

The previous candidate of this patch (sha `14296bd2…`, superseded) scored 130 of 132. The two
remaining rows are what changed between the candidates:
- `probe_known_once` was an equivalent mutant: the explicit "unlisted disks get one attempt"
  branch was shadowed by the inventory re-read before each retry, which already stops a retry
  for a disk the inventory does not list. The redundant branch is removed, so one rule carries
  it; the row is dropped.
- `probe_release_interrupt` was killed in substance (the mutated `except Exception` let the
  KeyboardInterrupt escape and end the test process by SIGINT) but not by the runner's marker.
  The test now catches any escape from `release()` and asserts on it, so the mutant fails an
  assertion.

Final results, the review note and the final runner follow in the next artifact commit.
