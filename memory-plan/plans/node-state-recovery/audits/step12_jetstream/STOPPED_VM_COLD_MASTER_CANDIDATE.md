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
cold-copy claim, seal, root migration or service retirement. Host operator
access and the complete UTM backing-image path remain unknown from inside
the guest.

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
`cp -c` control produced a distinct clone whose bytes stayed unchanged after
a source write. A complete APFS clone may fit, but its shared physical store
offers only same-disk rollback and needs a capacity margin for later writes;
the real package was not cloned. UTM's `utmctl` reports OSStatus -1743 from
SSH and explicitly says it cannot control the app from an SSH session. A
host-GUI stop/restart handoff and a durable host-side copy/receipt mechanism
remain necessary before a production window can begin. The powered-off
state, image-component completeness, source/copy hashes, pre-power-off writer
gap, three extracted masters, isolated restores and resumption are still
unverified.
