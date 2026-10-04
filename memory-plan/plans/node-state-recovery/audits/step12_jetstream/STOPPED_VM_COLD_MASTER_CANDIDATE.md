# Stopped-VM cold-master path — candidate, not authorization

Status: design candidate only, 2026-10-03. The current `RECOVERY.md` still
requires a continuous launchd/process watch before a copied history may be
certified. `seal()` and root `begin()` remain closed. No NATS writer, store,
service or VM has been stopped or changed for this candidate.

## Boundary this path would replace

The running guest cannot prove physical writer absence with its current
process census, `eslogger` notifications or file timestamps. A disposable
same-volume APFS probe changed a file through a held writable `MAP_SHARED`
mapping without advancing ctime or mtime until the mapping was torn down,
including after `sync`, `fsync` and `F_FULLFSYNC`. A clean timestamp fence is
therefore a refusal tripwire only. The proposed substitute is a full guest
power-off followed by a host-side copy of the complete VM backing image.
That removes the guest execution substrate for the powered-off copy window,
not the preceding interval between NATS exit and guest power-off. The
guest-to-host store hash comparison checks for changes after the in-guest
hash, but cannot prove writer absence before it. This path moves
the host, hypervisor and backing-storage copy into the trusted base; the
guest cannot attest those facts itself.

This candidate is only for step 1.2's historical, individually verified
JetStream snapshots. The three new masters are the serving standalone store
and cluster members 2/3; the separately held member-1 R1 master remains a
fourth, distinct history. Extract, test, freeze and rehash the three new
masters from the powered-off image **before the original guest boots**. Its later
restore-only recovery resumes the live stores, which may then diverge from the
frozen masters without changing their historical bytes. A failed or incomplete
acceptance cannot be repaired from the resumed stores; it requires a new
stopped-VM copy window. The current Journal still cannot seal this route:
`seal()` requires an uninterrupted forward window, and a clean power-off
ends that window. A separate, typed host receipt and historical acceptance
manifest must be implemented before any step 1.2 certification.

This does not authorize migration or treating the restored node as running
on the certified master state. That later go-forward cutover needs a durable
`cold-copy-pending` hold and a startup interlock that keeps old writers and
clients parked across reboot. Existing restore-only recovery drives prior
running units back online; using it during a cutover would defeat that hold.

## Preconditions inside the guest

1. Capture a fresh full-node structural inventory and every transitive
   dependency/process binding required by the existing recovery contract.
   A watcher report or a plist hash alone is insufficient.
2. Hold dispatch and all application clients, including timers, the
   deploy listener, the on-demand worker and their descendants. Require
   zero active task claims, collaboration sessions, child processes and
   consumer ack-pending. Preserve each prior loaded/disabled state.
3. With application publishers and consumers drained but NATS still
   healthy, capture the exact source stream and consumer snapshots through
   the running servers. Pin all three source roles separately, including
   stream holes, consumer positions and the snapshot high-water marks.
   Refuse an absent or ambiguous source before a stop.
4. Stop NATS through the managed sequence in `RECOVERY.md`: member 1
   remains held, then members 2/3 stop before the standalone. Require
   clean-exit logs, no open store owners, and no forced termination.
5. Hash each stopped store tree and verify the source identity and captured
   high-water marks. Refuse absent or ambiguous stores, configs, service
   identities or changed inventory. These hashes corroborate the later
   host copy; they do not independently certify writer absence between
   server exit and the in-guest hash. A mapped write before that hash
   could be present in both the guest hash and the host copy; a later
   write must make the host-versus-guest store hash comparison refuse.
   The isolated restore must compare histories to the pre-stop running
   snapshots. Changes outside that semantic comparison remain a trust gap
   until the recovery contract defines and accepts its scope.
6. Shut down the guest cleanly, with a recorded OS shutdown transition.
   A forced stop or a suspended guest is not a clean-stop observation.

## Host handoff

The operator must identify the complete UTM backing artifact before any host
command is prescribed. The UTM identification comes from the same-node
host-Ollama installation evidence in PR #195 (`VirtualMac2,1` and host gateway
`192.168.64.1`), not from an image-path inspection. The guest has no verified
path to the UTM package or host copy. The host receipt must
attest a powered-off state, not pause/suspend or saved RAM; disabled
autostart/auto-resume/automatic snapshots for the window; and no second
VM instance opening the same image. It must identify every component of
the disk image, including sparse bands or auxiliary state where relevant,
and demonstrate local materialization if the image resides on a synced,
remote or thin-provisioned store.

Copy the complete powered-off image from a consistent host point. Hash the
source and copy, independently re-read the copy, and retain the original
image unmodified. Record host timestamps, image identity, sizes and hashes
in an operator-attested receipt. The guest may corroborate those values
after boot, but must not fabricate a host observation from guest state.
Host copy completion does not by itself mean the application histories are
healthy or sealed.

## Cold masters and isolated acceptance

Extract each of the three NATS store trees from the copied image without
starting its ordinary jobs. Use a read-only mount where available; if an
isolated clone must boot, disconnect it from the production network and
keep all application/NATS jobs parked. Compare the extracted store trees
to the in-guest stopped-source hashes. Each store becomes its own private,
read-only cold master. A mismatch refuses certification, even when the
image hashes match each other.

Restore from fresh working copies, never a master. Keep the standalone
topology separate from the three-member metadata group; do not start the
standalone as clustered. Check member-1 offline R1 state first, then the
remapped cluster assignments as specified by `RECOVERY.md`. For every
stream, compare sequence range and holes, subjects, nanosecond timestamps,
raw headers and payloads with its own pre-stop snapshot. Compare consumer
configuration, delivered/ack floors, pending ack/redelivery and remaining
pending counts. Verify server and route identities and absence of external
clients. Rehash each master after the tests. Any failed restore or changed
master refuses the path.

## Boot, rollback and acceptance

Keep the original guest powered off until all three masters have been
extracted, restored in isolation, accepted, made read-only with `uchg`, and
rehash-verified. A failed acceptance remains a failed attempt; booting the
original and taking another copy later creates a new window. Do not run the
original concurrently with an isolated clone using its identities or network.
After accepted historical copies are fixed, the original may boot and the
existing restore-only path may restore its prior jobs. Verify the resumed
services and their original identities without claiming the live stores still
equal the masters. A go-forward migration instead needs the separate durable
startup interlock, first-bootstrap intent and reverse-path controls in
`ROOT_WRITER_MIGRATION_DESIGN.md`; restore-only recovery is not that cutover.

This path addresses the three NATS cold masters only. A full-image copy
does not certify the gateway task SQLite store, viewer plan ticks or other
files as a coordinated quiet point. If the image is to support that later
claim, the gateway and viewer need the explicit stop order, process-group
drain and store-level checks required by `RECOVERY.md`; that is separate
work in recovery 1.3.

An accepted implementation would amend the continuous-watch clause in
`RECOVERY.md` for this historical path only and add a typed host receipt,
root-driver verification and separate acceptance manifest after all
guest/host/image/restore proofs pass, including an accepted treatment of the
pre-power-off trust gap. It must not relabel a reopened Journal as an
uninterrupted `seal()`. The current code has no host receipt, host verifier
or historical acceptance manifest. This candidate does not authorize a
cold-copy claim, seal, root migration or service retirement. The later host
discovery below identifies a package candidate and control route; neither is
yet a powered-off artifact or an accepted handoff.

## Owned archive-divergence control — 2026-10-03

`test_recovery.mjs` now keeps a valid online standalone archive at sequence 12,
then publishes and acknowledges sequence 13 before clean server stop. Its
direct cold-store clone restores sequence 13 and the advanced consumer ack
floor; the archive restore still reflects the earlier state. The fixture's
held R1 member has an earlier-capture sequence 7 versus direct cold-store
sequence 8, including an isolated single-member boot. Content, config,
sequence state and consumers are compared with the matching final pre-stop
capture, and each cold master is rehashed after booting only a working copy.
The 2026-10-03 owned run passed on NATS CLI 0.3.1 and server 2.12.6; compact
hashes and counts are in `COLD_STORE_ARCHIVE_DIVERGENCE_FIXTURE.json`.

This control demonstrates why the eventual acceptance must boot extracted
`store_dir` trees directly. It does not establish the host image's provenance,
the three real serving masters, physical writer absence or production recovery.

## Owned final-baseline control — 2026-10-03

The direct pre-stop capture driver now writes an owner-private manifest for
each connected server, including its server identity, stream inventory,
content digest and consumer positions. In the owned fixture it captured the
standalone after the late sequence 13 and the cluster member after its late
R1 sequence 8; its survivor capture recorded the R1 assignment as explicitly
offline. It rechecks stream config/state, consumer positions and offline
assignments before success.
False-offline and undeclared-offline claims, as well as failed
authentication, produced private failure records. All owned servers stopped
and none of the test's cold masters were booted. The compact results are in
`COLD_BASELINE_FIXTURE.json`.

The archive's pending-redelivery control finishes before the final source
capture; its owned source consumer is then removed. The final standalone and
held-R1 fixture baselines assert zero acknowledgements pending, matching the
production drain precondition without relying on the one-second redelivery
timer remaining idle during the baseline sweep.

This remains a sequence of read-only observations made against owned NATS
processes. It does not show a production writer hold, simultaneous state
across the three serving stores, a powered-off host image or a valid host
receipt. The host route, trust-gap decision, extracted master hashes, isolated
production restores and truthful resumption remain open.

## Port-owner identity control — 2026-10-03

The real standalone and held member 1 have historically competed for client
port 4222 and monitor port 8222. A baseline now requires the expected server
name, server ID and cluster name, and refuses a mismatch before reading any
stream. The owned fixture passes correctly pinned standalone/cluster captures
and refuses a wrong name, ID or cluster with `FAILED.json` and no success
manifest. This binds the client connection to an independently pinned
preflight identity; it does not make an ambiguous port safe if the caller
simply copies its expected values from the endpoint that answered. The
production service/process/monitor binding, complete historical baselines
and host-powered-off master provenance remain open. Compact evidence is in
`COLD_BASELINE_IDENTITY_FIXTURE.json`.

## Owned direct-store acceptance-mechanism control — 2026-10-03

`probe_cold_trees.mjs` now accepts four distinct frozen, owner-private store
trees and four matching direct pre-stop manifests. In the owned fixture it
boots only working copies, verifies standalone history through sequence 13,
reads held R1 history through sequence 8 without routing, checks the two
survivors retain R1's offline assignment, then rejoins a second held working
copy and compares R1's content, configuration, state and consumer positions.
The four masters remain unchanged. Replacing the standalone direct baseline
with the earlier online archive produces `FAILED.json` and no success report.
All owned servers stopped after the run. The compact hashes and results are in
`COLD_TREE_PROBE_FIXTURE.json`.

This proves the layout-independent isolated comparison path against synthetic
stores. No powered-off host image, original guest extraction, host receipt,
production master or protected writer absence was observed. The three serving
cold masters and truthful production resumption remain open.

## Host discovery — 2026-10-04 11:51 EDT

An authenticated read-only SSH inventory on the Mac host identified UTM 4.7.5
and the package candidate at
`~/Library/Containers/com.utmapp.UTM/Data/Documents/moltMacOS.utm`. Its
`config.plist` names `moltMacOS`, UUID
`79B25660-B7F1-4DDC-B379-52A4EB317DAE`, one writable image
`Data/CA8B46FE-B9C1-4588-B8DB-1C5D40D620FA.img`, Apple virtualization,
and a shared-network MAC matching the running guest. The package also has
`Data/AuxiliaryStorage`, `Data/vmstate`, and `screenshot.png`; no symlinks
were found. The config hash was
`de181e164d416eacaf5cefd2ff9ff46330995983397fbb28d9cb746af173f4c5`.
The image is 211,136,020,480 bytes; auxiliary storage is 33,579,164 bytes.
The 14,629,736,448-byte `vmstate` last changed on 2026-07-26 and is not
evidence of the current power state. The active Apple virtualization process
held the image open during this inspection, so none of these observations is
a powered-off copy or a cold master.

The local Data volume is APFS with 115.7 GB free, less than the package's
roughly 210 GiB allocated footprint. A disposable 16 MiB same-volume
`cp -c` control produced a distinct copy whose bytes stayed unchanged after
a source write. The local `cp(1)` manual says `-c` falls back to `copyfile(2)`
when `clonefile(2)` is unavailable, so this was not clone-only evidence. A
complete APFS clone may fit, but its shared physical store
offers only same-disk rollback and needs a capacity margin for later writes;
the real package was not cloned. UTM's `utmctl` reports OSStatus -1743 from
SSH and explicitly says it cannot control the app from an SSH session. A
host-GUI stop/restart handoff and a durable host-side copy/receipt mechanism
remain necessary before a production window can begin. The powered-off
state, image-component completeness, source/copy hashes, pre-power-off writer
gap, three extracted masters, isolated restores and resumption are still
unverified.

## Host control and ASIF extraction rehearsal — 2026-10-04 12:08 EDT

The authenticated host account is UID 501, matching the guest store owner.
The live image's first four bytes are `shdw`; [UTM's 4.7 release notes](https://github.com/utmapp/UTM/releases/tag/v4.7.0)
say its Apple backend on macOS 26 creates ASIF drives by default, and
[Apple documents](https://developer.apple.com/documentation/virtualization/vzdiskimagestoragedeviceattachment)
ASIF as a supported VM disk format. The header alone is not conclusive format
identification. `hdiutil imageinfo` did not recognize this
live image, and `diskutil image info` refused it while the virtualization
process held it open. Do not treat either response as an image-health result.

An owner-private one-shot LaunchAgent in the logged-in `gui/501` domain ran
`utmctl status` for the pinned UUID and returned `started`. The same verb
refused from ordinary SSH. The test agent and its temporary files were
removed. This proves that GUI-domain dispatch can query UTM while that login
session exists; it does not prove a controller survives logout, a host reboot,
or a guest power transition. The installed `utmctl stop` help says its default
is forced power-off and `--request` asks the guest OS to power down. A future
controller must use a guest-initiated or explicitly requested clean shutdown,
then independently verify the stopped image and shutdown evidence; it must
never silently fall through to the default force behavior.

On the host, `diskutil image create blank --format ASIF` made a disposable
128 MB APFS image. A marker was written, the image ejected, cloned with
`cp -c`, attached with `diskutil image attach --readOnly --noMount`, and its
APFS volume mounted read-only. The marker read back exactly; the clone's
header also began `shdw`. The test image was ejected and its temporary files
removed. This establishes a host-side read-only extraction mechanism on a
synthetic ASIF image, not that the 211 GB UTM image can be opened or its guest
Data volume mounted after power-off. The actual guest Data volume has UUID
`EF14FD3D-7953-4A6D-9596-CB90B6024CD1`, name `Data`, and FileVault is off;
those are future mount-selection pins, not current host observations of a
clone. The four live NATS store trees are about 107 MB combined; their source
paths and owner must be rechecked at the stop window.

A temporary same-volume COW clone could be removed **before** the original
guest restarts, after extracting and accepting the small store masters. That
would avoid retaining a divergent 211 GB clone next to a running guest, but
free-space floor, clone allocation, read-only mount, source/copy identity,
detachment and clone disposal all need a tested host transaction and failure
receipt. The retained masters would remain same-disk logical rollback, not
machine-loss recovery. No live VM stop, full-image clone, guest mount, store
extraction or cold-master acceptance occurred in this rehearsal.

The bounded `host_asif_extract.py` component now exercises that read leg on a
synthetic four-store ASIF fixture. It pins the image digest and guest Data
volume UUID, mounts read-only, copies each declared store into owner-private
regular files, rehashes source and copy, ejects, and writes a success manifest
only afterward. Both the Mac host and guest fixture recovered all four marker
files; wrong Data volume UUID, path traversal and symlink controls refused
with failure records and no success manifest. The extractor restricts new
files to owner-only access and records detach or mountpoint cleanup failures
without issuing a success manifest. The exact-head Mac CI run completed with
no skipped tests. This is a mechanism test only. It neither acquires the production
clone nor attests VM stop, source provenance, uninterrupted image-holder
absence, pre-stop stream equivalence, immutable masters or live resumption.
Compact outcomes are in `HOST_ASIF_EXTRACT_FIXTURE.json`.

The host also ran the full existing isolated JetStream recovery fixture from
owner-private staged Node and NATS binaries. Its `acceptance.json` reports
`pass: true` and all owned servers stopped. The direct cold-tree probe left its
four source masters unchanged; the standalone and held R1 high-water values
advanced as expected over their archived copies. The test exercised wrong
listener and stale-archive refusals. All inputs were synthetic. This proves
the host can execute the restore comparison machinery, not that any production
store has been preserved or restored.

## Host preflight control — 2026-10-04 12:39 EDT

A detached child launched through the host's authenticated Remote Login
session remained alive after that session ended and could read the pinned UTM
config. A Python LaunchAgent in the GUI domain could call `utmctl status` but
macOS privacy controls denied it direct access to the UTM package. The
read-only `host_vm_preflight.py` now combines those two privileges: it verifies
the package, config hash, writable image, controller hash and owner from the
SSH-owned process, launches a short GUI-domain status helper, checks image
holders and writes a private record. The host run identified the pinned VM as
`started`, its 211,136,020,480-byte image and one holder. A wrong config hash
produced `FAILED.json` and no success record. The VM remained running. This
does not prove a future detached controller can survive every login change or
host reboot, nor a clean stop or absence of holders during a cold copy. Compact
evidence is in `HOST_VM_PREFLIGHT_FIXTURE.json`.

## Host capture worker rehearsal — 2026-10-04

`host_vm_capture.py` starts from the authenticated host account while the VM
is running. It does not stop or boot a guest. It records an arm point, waits
up to a declared deadline for two consecutive UTM `stopped` observations
with no image holder, then invokes `clonefile(2)` directly so unsupported
cloning cannot silently become a full physical copy. It checks source and
clone digests, extracts the four declared stores through the read-only ASIF
tool, and rechecks the pinned host boot, image identity and sampled stopped
state. It writes a candidate `CAPTURE.json` or a failure record and leaves
the VM off; it never declares a historical master accepted.
Production output is restricted to an owner-private persistent host recovery
directory, with a 20 GiB capacity floor before and after the clone and store
extraction. Fixture mode requires the reserved synthetic VM identity.
The host's persistent directory was created owner-only on the same device as
the image; it contains no production capture or master yet.
The pinned UTM identity and four role paths were placed there as 0600 JSON
inputs. A fresh read-only preflight using those durable inputs still reports
the intended VM `started` with one image holder. Their hashes and the capacity
reading are in `HOST_PREPARED_SPECS.json`; neither input starts a capture.

A disposable VM-shaped ASIF/APFS fixture passed on the guest and on the host.
On the host, the fixture ran in a detached Remote Login child after the
initiating SSH session ended. Both runs extracted four owned marker stores;
a no-shutdown control refused before cloning. The first test exposed a normal
transition where the image holder vanished before UTM changed from `started`
to `stopped`; the worker now waits through that transient mismatch. These are
sampled observations, not proof of uninterrupted power-off throughout a real
211 GB copy. No production image was cloned or opened. Compact evidence is
in `HOST_CAPTURE_FIXTURE.json`.

## Guest-to-host stopped-tree match rehearsal — 2026-10-04

`stopped_tree_match.py` captures a private per-role file/directory manifest
from the guest store paths after the writers are stopped. On the host it
compares those entries against both the ASIF extraction manifest and a fresh
read of the extracted bytes, then makes matching trees read-only and rehashes
them. It writes `MATCH.json` only after every role agrees. The integrated
disposable fixture passed on guest and host for four store trees; changing one
extracted file produced only `FAILED.json`. This supplies a content comparison
mechanism, not proof that production writers were excluded when the guest
manifest was taken. The compact result is in
`HOST_STOPPED_TREE_MATCH_FIXTURE.json`.

The matcher now also requires the private `CAPTURE.json` and the exact cloned
image beside the extracted trees. It checks that the receipt binds the
extraction manifest, image digest, Data volume and four roles, then rehashes
the clone before it can write `MATCH.json`. The disposable ASIF fixture passes;
altering the capture receipt refuses the match. This closes a provenance gap
where a free-standing extracted directory could have been matched without its
capture receipt. It still cannot attest continuous VM power-off or a clean
guest shutdown.

## Sampled vmstate refusal candidate — 2026-10-04

The host preflight now records the owner-owned `Data/vmstate` inode, device,
size and nanosecond modification/change times, or its absence. The capture worker
requires that identity to match its initial running observation at every
stopped-state check through extraction. A changed or newly created vmstate
refuses before a clone when observed during shutdown. Disposable tests cover
this refusal and symlink rejection; the full synthetic ASIF capture still
passes. On the real host, the existing 14,629,736,448-byte vmstate is owned
by UID 501 and has not been touched by this work. This is a sampled suspend
warning only. It does not attest a clean power-down, uninterrupted power-off
or a cold restart, and it has not been staged or invoked on the host.
