# Host image guard and boot reconciliation candidate — 2026-10-04

This is a design checkpoint, not a production controller or a cold-master
receipt. The VM is running. The same-volume clone window cannot start until a
disposable UTM VM demonstrates what `utmctl start` does with an immutable ASIF
backing image, including clean recovery after the flag is removed.

`UF_IMMUTABLE` is an advisory accidental-start guard. A new writable open is
refused, but a writable descriptor opened before the flag can still write and
the image owner can clear the flag. The host must first observe UTM stopped
with no source-image holder, set the flag on the pinned source inode, and
observe stopped/no-holder again. Any mismatch refuses the capture. The brief
gap before the flag is set remains a declared trust limit; a later isolated
history comparison must detect meaningful store divergence.

The durable host window has these states:

| State | Source image | Fixed clone path | Safe next action |
| --- | --- | --- | --- |
| Armed | writable, VM still running | absent | wait for clean stop |
| Guarded | immutable, stopped/no holder | absent | create clone or reconcile |
| Copied | immutable, stopped/no holder | present | read-only extraction, then dispose |
| Disposed | immutable, stopped/no holder | absent | verify source and clear source flag |
| Bootable | writable, stopped/no holder | absent | await separate boot decision |

An interrupted process may leave any state without its final receipt. A
fresh, idempotent reconciler must derive state from private arm/preflight
receipts plus current file identity and flags. It must work after host reboot,
which changes the boot-session identifier. It must never treat an old
`DISPOSE.json` or `CLEANUP.json` alone as proof that no clone exists now.

Reconciliation checks all owned capture directories under the private host
recovery root for the fixed clone name. For each present clone, it verifies a
regular owner-owned single-link inode distinct from the live source, no open
holder, and no disk-image attachment; it then clears only that clone's flag,
unlinks it, fsyncs the parent and confirms absence. If any clone cannot be
identified or detached, the source remains guarded and the result requires
operator attention. A completed capture also requires the source hash to
match its receipt; a failed or interrupted attempt without that hash cannot
be certified and uses the pinned source identity only to recover bootability.
All extracted trees and failure evidence remain untouched.

Only after every clone is absent and the pinned source is stopped/no-holder
may reconciliation clear the source flag and issue a scoped `BOOTABLE` receipt.
That receipt means the original disk can be opened again; it **does not**
authorize `utmctl start` or accept a historical master. A separate controller
may start the VM only after the plan's real-store isolated acceptance or an
explicitly recorded abort/restore-only decision. The latter must be designed
against the preservation-first contract before production use. A start
controller must recheck clone absence and source identity immediately before
its GUI-domain action and must not resume a stale `vmstate`.

Minimum tests before production integration: a real disposable UTM VM refuses
to start with a guarded disk and starts normally after unlock; a pre-existing
write descriptor is detected by the post-flag holder check; a process crash
before the guard receipt, after clone creation, during extraction, and after
clone unlink each converges to clone absent and source bootable; an attached
clone, wrong inode, changed source hash or competing VM holder refuses without
clearing the source flag. Host reboot and autostart behavior remain untested.

No external volume with enough room for a full durable image copy is mounted
on the Mac host as of this checkpoint. If one becomes available, preserving an
off-volume copy can avoid this same-volume COW exclusion problem, but the
guest full-node hold and real-store acceptance are still required.

An inactive source candidate now writes `GUARD_INTENT.json` after a fresh
stopped/no-holder preflight and before setting `UF_IMMUTABLE`. The crash
reconciler requires that intent to match the arm receipt, initial source
identity and image path before clearing the source flag. A missing intent
refuses even if an old arm receipt and an immutable image exist. The intent
narrows accidental reuse of an older recovery directory; it cannot exclude
a same-user actor with a pre-existing writable descriptor. Neither the guard
nor the reconciler is connected to the production capture or boot path.

A later reconciliation may repeat an already successful `BOOTABLE` check only
while the source remains unguarded and the fixed clone remains absent. If an
immutable flag reappears after that receipt, the old intent cannot clear it;
the run refuses for operator review. This closes stale-intent reuse after a
successful recovery without weakening idempotent no-op checks.

The `BOOTABLE` receipt now records `guard_completed` only after checking a
matching `GUARD.json` against its durable intent. An aborted guard can still
recover the image's bootability, but its receipt records `guard_completed:false`.
Neither value is a VM start authorization; the missing boot controller must
make an independent acceptance or explicit abort decision.

`GUARD.json` is published after the post-flag check through a private
temporary file, file sync, atomic rename and directory sync. A crash while
writing the temporary file leaves no completion receipt, so reconciliation
can report `guard_completed:false` and restore bootability after its other
checks pass. The capture worker now requires the matching private guard
intent, completion receipt and passing post-guard preflight before it clones
the image. It rechecks the source flag and guard-receipt hash after cloning,
hashing and extraction, and records that hash in `CAPTURE.json`. The clone
inherits the immutable flag; the worker clears it on the clone inode only.
Failed-capture cleanup also clears that flag on a verified, unattached clone
before removing it, covering interruption before the worker can clear it.
The later guest/host tree comparison also checks that the guard receipt still
has the hash pinned by the capture receipt.
Completed-capture disposal checks open holders and disk-image attachments
before unlinking its clone. Reconciliation checks the attachment inventory
even if the clone pathname is absent, because a detached pathname does not
detach an already attached image. A transient guard preflight failure before
intent publication can be retried with a fresh preflight directory; a
post-intent failure stays one-shot and requires reconciliation.
Host preflight also refuses a disk-image attachment of the source: a
disposable ASIF attached through `hdiutil` was invisible to user-level
`lsof`. The guard refuses a capture directory already marked failed or
complete, and writes its intent through a private temporary file and atomic
rename before applying the source flag. An interrupted temporary intent
write is retriable; a published intent remains one-shot.
These are sampled checks, not proof that an owner never cleared and reapplied
the flag or that no pre-existing writable descriptor wrote between samples.
An unexpected existing guard intent, completion receipt or temporary receipt
refuses before the source flag changes. `BOOTABLE.json` also publishes through
a synced temporary file and atomic rename. An interrupted BOOTABLE write leaves
only a temporary file; a fresh reconciliation can issue a complete receipt
after checking the stopped source again.
The capture worker now publishes `CAPTURE.json` through the same synced
temporary-file and atomic-rename sequence. An interrupted write leaves only
`CAPTURE.json.tmp`; reconciliation ignores it, removes an unattached clone
and clears the source flag after fresh checks. This is crash convergence for
the receipt, not proof of an uninterrupted stopped VM or accepted masters.
