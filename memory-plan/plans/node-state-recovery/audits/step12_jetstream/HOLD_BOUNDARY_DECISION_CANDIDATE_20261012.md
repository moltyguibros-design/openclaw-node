# Full-node hold boundary: operator decision candidate — 2026-10-12 02:35 EDT

This is a review candidate, not a changed recovery contract or permission to
stop a service or the VM. Step 1.2 remains `[A]/v1.2-pre`. The standalone NATS
store and all three physical cluster-member stores remain separate; no
production process, store, service, VM, or topology was changed here.

## Finding

The current requirement is a *complete no-writer hold before any production
service or VM stop*. The available in-guest checks cannot establish that
property while the guest Data volume remains mounted:

- D151's owned timer payload left a detached writer after the gate drained.
  D156's owned launchd job ran after its disabled override was set but before
  bootout. The gate and override therefore do not close the writer set alone.
- D164 observed a readable child with no descriptor, fileport, or mapping
  reference reported by the census, while it retained a writable Mach memory
  entry. D157/D160 show that immutable flags do not revoke prior writable
  handles. An owned regular-file `revoke(2)` call on this guest returned
  `-1/ENOTSUP` (errno 45), matching the installed `revoke(2)` manual.
- D166 observed normal APFS unmount refuse one such retained entry on an
  owned image. The production Data volume is the mounted system volume; this
  observation supplies no pre-shutdown unmount gate.

An atomic APFS snapshot is not yet an available substitute. Read-only guest
checks found no Time Machine destination, no Data-volume snapshots, and 24.6
GB free in the APFS container. An unprivileged `fs_snapshot_create` call on a
disposable, mounted 128 MB APFS image returned `-1/EPERM` and created no
snapshot. This does not rule out a separately provisioned, entitled snapshot
service; none has been demonstrated for this recovery path. Existing NATS
logical archives protect known history points, but are not one atomic quiet
point for the four physical stores or the offline R1 streams.

The evidence rules out claiming a complete pre-stop no-writer proof from the
current gate, launchd, flags, census, or unmount mechanisms. It does not prove
that every installed OpenClaw payload actually uses a hidden writer: that
requires a separate provenance audit. Claude's read-only adversarial review
retracted both a proposed one-member bootout (it is a forbidden topology
change) and an assumed production APFS snapshot (creation is unproven here).

## Choice required before designing a production stop

**Keep the existing contract.** No production service or VM is stopped. Work
can continue on installed-payload provenance, owned capture/restore fixtures,
and a demonstrated pre-stop exclusion mechanism if one is found. There is no
credible completion date for the current complete pre-stop gate.

**Revise the boundary.** Preserve and independently restore-check all four
physical stores before any topology change, then allow a bounded, reviewed
whole-node quiescence/stop sequence in which the definitive no-writer proof is
made *after* a clean VM stop and host boot guard. Pre-stop checks remain
fail-closed application-quiescence evidence, not an absolute writer-exclusion
claim. This changes the operator's existing no-stop-before-complete-hold rule;
selecting it would authorize design and owned tests only, not a production
stop.

Even under the revised boundary, the production window stays closed until the
23 installed jobs have approved current pins; actual payload and detached
writer provenance has been audited; a disposable UTM VM proves guarded-start
refusal and recovery; a bound host capture/acceptance-or-abort controller is
tested; the standalone and each cluster-member master, including offline R1
history, have separately verified preservation; and the exact stop, failure,
restore, and resumption runbook is reviewed. No single cluster member may be
stopped as a rehearsal. Any failed prerequisite refuses before production
mutation.
