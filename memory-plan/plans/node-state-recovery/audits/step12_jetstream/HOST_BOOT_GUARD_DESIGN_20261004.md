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
