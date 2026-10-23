# Host storage assessment — 2026-10-20 00:15 EDT

**The current host remains unsuitable for the proposed rehearsal.** This bounded read-only check narrows the storage question but does not explain the entire loss or establish any amount safe to reclaim. No cleanup or provisioning was performed.

The final available-space sample is **14.139 GiB** (15,181,131,776 bytes), **5.861 GiB below the existing 20 GiB capture floor** and **305.861 GiB below the 320 GiB planning candidate**, before any workload reserve. The earlier 33.497 GiB sample was at October 19 15:53:52 EDT. The net loss to this latest sample is 19.359 GiB. Availability rose 0.154 GiB since D284's 23:50:33 sample; no cleanup by this assessment accounts for that change. These are sequential observations on an active host.

## What the metadata establishes

- The internal Data, System and VM/swap volumes share APFS container `disk3`, capacity 994,662,584,320 bytes. Their available-space queries agree within each observation. Swap therefore competes with the same pool used by the production image and proposed internal workspace.
- Twelve current swap files each allocate 1 GiB. Six have recorded birth times after the earlier free-space sample, between October 19 19:13 and 19:48 EDT, and together currently allocate 6 GiB. This identifies allocation now present from that interval; it does **not** prove a 6 GiB net contribution to the loss. There is no earlier swap-file inventory to account for removed/replaced files. Reported swap use at 00:11 EDT is 10,922.25 MiB, distinct from the 12 GiB file allocation.
- Data-volume snapshot enumeration succeeds with an empty list, and Time Machine's local list reports no entries. A mounted-root query lists one non-purgeable OS-update snapshot. The failed first System-volume query is retained. No snapshot recovery credit or deletion recommendation follows.
- The mounted iOS simulator's host backing file allocates 7.817 GiB and was last modified in July. Its mounted virtual filesystem's approximately 16 GiB usage is not an additional host allocation to add to the backing file. It is not evidence of a newly downloaded simulator in the loss interval.
- Selected directory totals include `.codex` 37.374 GiB, user caches 9.643 GiB, `.cache` 5.383 GiB, Downloads 4.889 GiB and Trash 0.434 GiB. Larger existing categories include Application Support 48.075 GiB, Containers 251.613 GiB and user Developer 41.036 GiB. These are current allocated-size summaries, not growth measurements, independent/reclaimable extents or approved deletion targets. Containers includes the production image; do not add it again.
- A recent-large-file metadata scan finds an approximately 7.535 GiB thread-history SQLite file and two session histories of approximately 6.996 and 1.310 GiB, modified during the interval. All three were created before it. Their combined current allocation is 15.840 GiB; without earlier sizes, it cannot be attributed to the loss. No database, message or session contents were read. These are conversation history, not assumed disposable cache.

## Bounds and production guard

Host observations ran at 00:11:34–00:14 EDT. Each query group preserves the same production UUID, `started` state, image device/inode 16777233/17966030, holder PID 8509, logical size 211,267,092,480 and allocated size 211,261,108,224 bytes before and after. The allocation also equals the earlier free-space assessment. This does not prove image content or future growth is unchanged; no image data was opened.

The recent-file scan stops at 50,000 entries, maximum depth four, with 175 directories remaining. A corrected home-size query reaches its 20-second limit without totals; an earlier invalid option combination is retained as failed. Protected paths under AssetsV2 and private var folders refuse access, making those totals incomplete. No denied access was bypassed and no wider scan, elevation, deletion, purge, swap setting, service operation, VM change, installer download or reboot followed.

[The retained evidence](HOST_STORAGE_EVIDENCE_20261020.json) contains the normalized observations, failed and bounded queries, production guards, original temporary-input hashes and independently recomputable arithmetic. Only unrelated SMART fields are omitted from the first disk-info result. The original temporary files are not the durable evidence contract; no later retention or independent host verification is claimed.

## Consequence

The full cause of the net loss remains unresolved. The bounded result does not supply a cleanup plan, capacity source, sustained memory/storage reserve or permission to execute the rehearsal. The existing resource proposal still prefers an explicitly designated separate disposable Mac with the required capacity on its internal APFS Data volume. Installation, protected acceptance/B3 provenance, full held/process/reboot integration and the parent B5 gates remain open. VERSION stays `v1.2-pre`; B6–B9 stay held, D64/Gate unchanged and production capture disabled.
