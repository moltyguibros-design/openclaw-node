# Node state recovery — registry

## Family 1: persisted application state

### SQLite application stores
| | |
|---|---|
| **Status** | ACCEPTED: twelve per-store snapshots restore correctly; independent review accepted e750e3e; coordinated recovery remains 1.3 |
| **Verified** | 2026-09-28 08:31 EDT: 852,017,152 snapshot bytes, 116 physical tables, matching typed content/rowids/header/FK fingerprints, core integrity; six native FTS checks and eight vector probes pass. Owner-private files; running service PIDs/runs unchanged. Node 24 daemon/knowledge SQLite 3.49.2; Node 22 MC SQLite 3.53.2; gateway node:sqlite 3.50.4/vec 0.1.9. Agent stores have compatibility probes, not owner-engine claims. Header inventory refuses unknown stores/links; explicit browser/historical/source exclusions. |

### JetStream histories
| | |
|---|---|
| **Status** | SPLIT, preservation in flight: standalone 4222 and cluster 4223/4224 serve; failed member 1 persistently held; three healthy cold masters pending |
| **Verified** | 2026-09-28 21:33 EDT: member-1 protected master and its isolated R1 restoration accepted; eleven individual online archives restored with 80,156 non-expiring messages. After the VM crash, nine reachable non-expiring stream states/configs and durable positions match the older archive points; no immediate pre-crash acknowledgement guarantee. Worker explicitly restored under a 65-second idle guard. All three serving bus identities/routes remain unchanged through revised owned recovery tests; member 2 is metadata leader. Fifteen preservation checks, a real account-group election regression, fifty-three journal fault tests and complete owned recovery fixtures pass. Journal is a primitive; managed orchestration remains pending. New managed-window acceptance, three healthy cold copies and coordinated recovery remain open. |

2026-10-01 13:18 EDT — Fresh read-only monitor evidence confirms the split:
8222 has zero routes and no meta-cluster; 8223 and 8224 route to each other,
with metadata leader now reported as member 3. The earlier member-2 leader
observation is historical. `SITE_TOPOLOGY_EVIDENCE.json` records only port
relationships and counts. None of these observations proves replay or cold
 copy health, and no production bus operation occurred.

2026-10-01 13:20 EDT — `SITE_STATIC_EVIDENCE.json` records a read-only
protected-site check: APFS ownership and the root-controlled parent pass;
the dedicated service account and protected root do not exist. The handoff
marker is unpublished. No cutover stage has started.

2026-10-01 13:33 EDT — D30's strengthened read-only check confirms each
ancestor from `/private` through `/private/var/db` is root-controlled and on
one device. A mounted protected root on another device now refuses. The live
site still lacks the dedicated account and protected directory.

2026-10-01 13:47 EDT — D31's live read-only check binds monitor ports
8222/8223/8224 to client ports 4222/4223/4224. The two routed cluster
members still report meta-cluster size three, with one offline replica
reported by a routed peer. This reinforces the separately held member-1 store
as a preservation source, subject to identity and cold-copy verification.
The site audit now refuses ordinary/admin account identities and ACL grants;
the actual dedicated UID and protected root are still absent.

2026-10-01 14:29 EDT — A fresh read-only topology snapshot reports the same
split route graph and metadata leader `openclaw-nats-2`; all three NATS
process start times remain 00:29:20 UTC. The prior leader shift was an
election, not a process restart. This does not prove held-store identity,
stream replay, or protected-site readiness.

2026-10-01 15:05 EDT — PR #175's read-only preflight is merged at `3f60fb7`;
its staging audit still refuses the absent account/root. The active watcher
uses the already-merged PR #173 cohort code from release
`monitor-nats-cohort-529ee53`. Launchd reports PID 83069, runs 1, and the
2026-10-01 19:05:50 UTC snapshot reports `fabric.services` WORKING with the
actual `nats`, `nats-2`, `nats-3` GUI PIDs. This is watcher runtime evidence,
not NATS cold-copy or protected-writer acceptance. Claude's root migration
challenge found four blocking interleavings recorded in D39; the separate
cutover remains unimplemented.

Current mechanism checkpoint 2026-09-28 23:49 EDT: tools-v30 passes53 fresh journal tests; unchanged15 admission/1 election tests inherit identical source hashes. Creation prepares the receipt before mkdir; interrupted setup is restoration-only. bbbc883 CI36516935187 is green, while this newer patch awaits exact CI/review. No new healthy production stop or cold-copy acceptance.

Current mechanism checkpoint 2026-09-29 00:58 EDT: tools-v31 passes55 fresh
journal tests, including initializing-root Finder recovery and fenced invalid
metadata. The unpatched ab7097c control fails as expected. Its exact CI
36518928261 is green and Claude accepted the previous creation fixes; this
new checkpoint requires fresh integration CI/review. PR149 merged55131b8;
installed task-daemon PID82096/runs1 still uses the accepted readiness release.
No production preservation window or healthy cold-copy acceptance exists.

Managed-stop checkpoint 2026-09-29 01:11 EDT: tools-v33 passes six actual owned
macOS launchd/authenticated-NATS controls; crash/surviving-child/timer-race/wrong
argv negatives refuse. Eleven current healthy owners pass read-only binding.
No healthy production stop or preservation window. N3 exact CI36523987643
green3/3 and Claude Message38 accepts it. Adapter exact CI/review pending;
detached orchestrator/static inventory/restoration/cold masters remain open.

Fixture-readiness checkpoint 2026-09-29 01:21 EDT: f3bb44f CI failed before Mac test
collection in old stream placement. Full owned readiness/missing-peer control
and existing recovery checks pass from tools-v36; two refused drafts retained
with normal cleanup. New exact CI/review pending. Production source and service
owners remain unchanged; healthy cold masters and the driver are still open.

Managed-controls checkpoint 2026-09-29 01:44 EDT: private tools-v40 passes13
actual Mac controls/1 explicit cross-domain skip, tools-v39 passes recovery
with actual peer/route negatives. Thirteen owners have read-only entry/code/
environment bindings; Discord has no current root PID and deploy listener
remains unready. Timer idle/log observations alone refuse complete unload
verification. New exact CI/review pending; no production quiet window or
healthy cold-copy acceptance. See D15 and MANAGED_CONTROL_REVIEW.json.

Loaded-provenance checkpoint 2026-09-29 02:09 EDT: tools-v44 passes17
actual Mac controls/1 skip, v42 passes full recovery/all8 placement negatives.
Thirteen live owners retain the same PIDs and pass actual loaded plist/log
provenance. New exact CI/review pending. Producer tick gaps, stop margins,
Discord/timer proof, detached orchestration and healthy cold masters remain
open at1.2-pre. See D16 and LOADED_PROVENANCE_EVIDENCE.json.

Kernel-evidence checkpoint2026-09-29 02:33 EDT: tools-v46 passes20 actual Mac
controls/1 skip; all21 owned jobs unloaded. Four owned NATS stops at restored
archive sizes and one idle memory stop with254MB copied databases exit normally
in34–65ms. No production timeout change or healthy cold master. Discord's
disabled/no-token integration is still restarted by its installed unit.
9deef65 CI36530037917 green3/3, Claude Message46 accepts that source; new
revision awaits exact CI/review. All driver gates remain open at1.2-pre.

2026-09-29 02:50 EDT — Owned/read-only recovery adapter only:21 actual
Mac controls/1 explicit domain skip and56 journal controls pass. Kernel
failure details now persist in post-intent failed journal records; foreign
filters refuse even for a bound PID. No healthy production service operation,
quiet window or cold-master acceptance. See DURABLE_KERNEL_EVIDENCE.json.

2026-09-29 03:09:24 EDT — Recovery journal/tools only: fixed mixed-width PID key
round-trip poisoning before production use.58 journal tests and21 real Mac
controls/1 explicit domain skip pass. No production window, stores or service
state changed. Exact new CI/review required; PID_KEY_EVIDENCE.json.

### Recovery source foundation — 2026-09-29 07:12:37 EDT

Main51a817f integrates without changing the reviewed5fabf6e Journal/stop/checks
tools. A new private copied Journal consumer passes58 controls; prior actual
managed controls are inherited by unchanged hashes, not called new runs.
PR144 is recast as this bounded tools checkpoint pending exact-head CI/review.
No production importer or controller/hold exists. Existing evidence JSONs and
RUNTIME_EVIDENCE.md remain scoped development history. Recovery1.2[A]/v1.2-pre,
its controller/static baseline, three healthy cold masters and full restoration
acceptance remain unfinished. Bus3.5/3.6 are the next explicit dependencies.

2026-10-01 00:01 EDT — Bus3.5–3.11 are merged; five actual Mac timers are
gated and reopened from a resolved timer-only journal. A separate read-only
full-node baseline captured 20 live launchd states and 54 direct file pins
after D21 admitted the legitimate idle on-demand mesh-agent. This is
structural schema evidence only. Standalone still serves five clients,
cluster members 2/3 serve, and member1 remains disabled/unloaded. No complete
source/provenance closure, full-node controller, healthy cold master or
restoration acceptance exists; 1.2 remains active.

2026-10-01 01:29 EDT — D22's source draft expands the full-node Journal
cohort to 23, adding the live gateway and viewer and the installed disabled
federation tick. The prior 20-state/54-file capture is historical and cannot
authorize a new window. A multi-domain read-only preflight refuses two
additional loaded system jobs: a crash-looping legacy agent and an idle
Tailscale one-shot. The protected timer controller `-4` safely refuses the new
full-node scope; it remains usable only for the current timer-only receipt.
Neither system job was altered. Full-node capture, cold masters and truthful
restoration remain open at 1.2[A].

2026-10-01 01:55 EDT — D23's PR #169 correction requires explicit scope for
new journals and binds the full-node baseline to a source-owned, multi-domain
entrypoint scan. Neutral loaded labels and HOME-derived plist paths are now
included; the deploy listener stops first and resumes last. The tightened live
scan still refuses the two unmanaged system jobs. Owned source tests pass, but
exact CI/review and a production driver remain pending. No live full-node hold
or healthy NATS cold copy exists.

2026-10-02 06:20 EDT — The operator-approved host-Ollama change is reflected
in a new read-only 23-unit diagnostic. Mesh-agent remains idle on demand with
plist SHA-256 `d0d01ead…`; memory-daemon runs as PID 37477 with plist SHA-256
`a3fb84ea…` and its live LLM setting matches the plist. The 0600 env file
matches the same target. Structural classes and 59 direct pins over 29 distinct
files were observed. The two unmanaged loaded system jobs still fail the
multi-domain preflight. The recapture is provisional and cannot authorize a
preservation window; 1.2 remains [A] at v1.2-pre.
The source memory-daemon plist template and separate `workspace-bin/install-daemon`
renderer still omit `LLM_BASE_URL`; a future reinstall would drop the live override.

2026-10-02 06:50 EDT — A source-only candidate adds `LLM_BASE_URL` to the
memory-daemon launchd and systemd templates and the direct
macOS/systemd/pm2 installer.
Isolated rendering passes; the live daemon and installed plist are unchanged.
The full-node baseline is still refused by the two loaded system jobs, and
1.2 remains [A] at v1.2-pre.

2026-10-02 07:10 EDT — PR #196 merged at 0d3237f with exact-head 4/4 CI and
Claude's no-blocker review. Memory-daemon source install paths now retain the
configured host-Ollama URL; no installed service changed. Node-init's
mesh-agent renderer still needs to read the saved value on a plain-shell rerun.
The full-node diagnostic remains provisional and 1.2 remains [A].

2026-10-02 07:27 EDT — PR #197 merged at 5caf0b6 with exact-head 4/4 CI and
Claude's no-blocker review. Node-init now preserves the saved host-Ollama URL
when rendering mesh-agent from a plain shell, including one with a stale
localhost value. The live unit and service state were not changed. The
entrypoint scan still refuses the two loaded unapproved system jobs, so the
full-node baseline remains provisional and 1.2 remains [A].

2026-10-02 22:21 EDT — The operator-attested retirement under the exclusive
node lock disabled and unloaded the obsolete `com.openclaw.agent` system job,
retired its three passwordless legacy sudo grants, and preserved the plist
and sudoers file in root-private storage. The private postflight observed no
matching process and unchanged NATS identities; the lock is released. The
private record and its hashes are in the runbook execution record. A fresh
read-only source-owned preflight independently observed the job absent and
accepted 23 installed jobs, 21 GUI-loaded, no user- or system-loaded cohort
jobs, and the explicitly verified idle Tailscale helper as an exclusion.
All 23 structural states, 23 plist hashes and 59 direct file pins still match
the earlier provisional capture. Both host-Ollama plists and the private env
file still target `http://192.168.64.1:11434`. The new diagnostic is
`POST_RETIREMENT_BASELINE_RECAPTURE_20261002.json`. These point-in-time
observations are not a full-node Journal baseline or continuous provenance;
the source template/installer omission above was fixed in merged PR #196.
Merged PR #195 also changed the templates for node-watch, health-watch,
consolidation-scheduler and memory-daemon; their installed plists still have
the captured older shapes. Re-rendering them changes the pinned baseline.
The production controller, protected root observer, healthy cold masters,
isolated restores, reboot persistence check and live resumption remain open.

2026-10-02 23:23 EDT — The standalone bus has a historical
`local-events-daedalus` stream with broad `local.>` ownership; its newest
retained message is from 2026-07-14. The current node's
`local-events-moltymacs-virtual-machine` is
absent; memory-daemon reports subject overlap when creating it. Node-watch's
BROKEN stream verdict is truthful. The old stream is a preservation source,
not evidence that current event publication works. No stream or service was
changed. Protocol step 4.1 observed the current-node stream working in August
under an R=3 topology. A second read-only check at 23:40 found that stream
visible through the still-running cluster members' JetStream APIs at
4223/4224, with 55,173
retained messages through 2026-09-23. Its only replica is led by nats-3. The
current daemon's standalone path cannot publish while `daedalus` owns
`local.>` there. Recovery 1.2 must preserve both histories before any subject
migration. Publication to the cluster stream stopped by 2026-09-23T18:11Z;
the daemon now targets the standalone bus, but the switch's cause and date
are not established. This failure does not reopen the dotted-name source fix.

2026-10-03 08:47 EDT — Retained server logs establish repeated ownership
flips on the shared 4222/8222 pair: cluster member 1 won on August 24 and
August 30; standalone won on August 26 and September 6. Member 1 restarted
under the same ownership on September 5. The memory daemon's current-node
event log initialized on cluster-serving observations and refused for subject
overlap after standalone took the listener. Its current plist, an October 1
backup with preserved July 14 modification time, and loaded launchd state
point to port 4222, but do not exclude an intermediate rendering. The cluster
stream's final eight messages are consolidation-decay subjects, not proof of
which process published them.
See `audits/step12_jetstream/PORT_4222_FORENSIC_20261003.md`. Both histories
remain without healthy cold masters or their isolated acceptance. No service changed.

2026-10-03 08:58 EDT follow-up — retained logs show member 1 winning again
on September 22 and standalone regaining 4222 on September 25. The
September 22–25 interval supplies a path for later cluster publications;
the final message subjects still do not establish the publisher. The first
retained cluster-stream message dates to July 16 and its single replica is
on member 3; no accepted cold master holds that history. No service changed.

2026-10-03 11:48 EDT — Node-watch is now running from the private
`node-watch-ingest-4bc1b936` release (launchd PID 77468). Its installed
plist changed only the entry path and has SHA-256
`0fa1cf482b6c2ba470eb45a3e2b8ed8c377095ad5193a7e20a4ad97f031daf7a`;
the old plist and release are retained for rollback. Four live watch reports
graded `mem.ingest` WORKING against 11 matching transcript sessions, replacing
the old false mtime-based 648-hour lag. The last snapshot has 22 WORKING,
4 BROKEN, 3 OFF and 7 UNKNOWN results. The stream/history split remains
BROKEN, so the node is not operationally accepted. A fresh 23-unit structural
preflight found only this plist changed from the October 2 baseline; the
operator's host-Ollama plist hashes and mode-0600 env setting still match.
`audits/step12_jetstream/POST_WATCHER_BASELINE_RECAPTURE_20261003.json`
records the point-in-time evidence. The release's third-party dependency link
is shared and mutable; continuous process provenance, physical writer
exclusion and the healthy cold masters remain open at recovery 1.2.

2026-10-03 12:24 EDT — The memory daemon now runs from the staged
`~/.openclaw/releases/memory-daemon-vault-20261003` copy. Its loaded plist
changed from `a3fb84ea…` to `7752da7b…` solely to repoint the entry; the
former plist is retained under `~/.openclaw/backups/memory-daemon/`. The
release changes the installed daemon only by running throttled vault sync
and graph-cache refresh when the session is ENDED, and by exporting that
routine for an isolated test. Launchd PID 92501 remained running; the real
graph cache refreshed at 2026-10-03T16:18:10.322Z and node-watch graded
`obs.graph_cache`, `mem.daemon` and `mem.ingest` WORKING. Obsidian sync is
explicitly disabled in private config, so its CLI exit was a no-op. The
`obs.sync` watch reads a different local concept vault; it remains BROKEN
because its latest note is stale, without proof that the disabled sync CLI
caused that condition. No setting was changed.
The release carries copied first-party files but links shared mutable
`node_modules`. The source branch restores the installed flush-result gate
before a future source deployment can replace it. The new 23-unit
structural recapture changed only the memory-daemon plist since the watcher
recapture; the mesh-agent and memory-daemon host-Ollama settings still match
the operator's addendum. See
`audits/step12_jetstream/POST_MEMORY_DAEMON_BASELINE_RECAPTURE_20261003.json`.
Recovery 1.2 remains active without physical writer exclusion or healthy
cold masters.

2026-10-03 12:48 EDT — The live node-watch service now runs from
`~/.openclaw/releases/node-watch-vault-20261003` (PID 7411). Its
`obs.sync` signal is explicitly local-vault Markdown freshness across all
five managed note directories; recent session/daily notes make it WORKING
despite older concept notes. The separate Obsidian sync CLI is still
disabled and unproven. Focused source tests passed 57/57. After a brief
post-restart PID miss, the next report graded memory daemon PID 92501,
ingest, graph cache and vault notes WORKING. The 23-unit structural
recapture changed only the node-watch plist and preserved both host-Ollama
settings. See `audits/step12_jetstream/POST_VAULT_WATCHER_BASELINE_RECAPTURE_20261003.json`.
`net.stream` and `fed.grappe.members` remain BROKEN; recovery 1.2 remains
active without physical writer exclusion or healthy cold masters.

2026-10-11 17:25 EDT — Separate current online archives of the standalone and
cluster buses are private and verified. Eleven reachable streams restored on
two isolated loopback servers; 80,884 non-expiring messages, captured state and
durable positions passed, and the owned servers stopped. Direct message digests
matched for the nine non-expiring streams; the cluster direct baseline completed
while the standalone baseline refused its final transient-consumer recheck, so
its partial message reads are corroboration only. The two offline cluster
streams were recorded but cannot be archived while their sole
owner remains held. The three production NATS PIDs stayed unchanged. This is
online rollback evidence only: the member-1 master, three serving cold masters,
common no-writer interval and full-node recovery remain unaccepted. See
`audits/step12_jetstream/ONLINE_ARCHIVE_REFRESH_20261011.json`.

2026-10-12 20:30 EDT — A host-side disposable Apple-backend UTM VM with a
separate ASIF disk started and stopped normally. With `UF_IMMUTABLE` on that
stopped image, UTM refused to start it and remained stopped; after the flag
was cleared on the same inode, it started and stopped normally. The production
`moltMacOS` VM stayed started and its distinct disk was untouched. The refused
`utmctl start` still returned process exit code zero, so a boot controller
must inspect the resulting UTM state and error. B2's disposable rehearsal is
complete; the B5 controller and its owned tests, full-node hold, four-store
capture and real-history acceptance remain open. See
`audits/step12_jetstream/B2_UTM_GUARD_REHEARSAL_20261012.json`.


2026-10-17 04:45 EDT — D194: B5-owned-journal-mount source is verified at
151bb3bdbcdf0bd09c7d15e6f0679832edae6a3d: all five exact-head jobs pass
(39011578564), including mount71 and reader30; Claude Messages85/89 report
no material defect. The CI-owned kickstart completed at exit0 in9.026776584s
without changing its10s limit. Earlier failures remain unexplained, and no
runtime recovery rule changes. B5-native-ASIF-mount now gets a separate
GitHub-hosted macOS job using only the existing guarded probe and a newly
created64MiB image, with unconditional report retention. This workflow
revision needs its own Claude review/CI. Probe exit0 alone never clears the
gate: inspect ownership/root0600 denial, exact flags/UUID/inventory, image
hash/ctime/xattrs and confirmed cleanup. No local mount or VM operation.
Next two gates: native ASIF characterization (CI-only owned resources under
B1), then owned stopped-ASIF reader integration (reviewed adapter, native
positive/refusal fixture and exact-head CI). Disposable macOS reboot access
remains separately operator-owned; B3/B4 stay just-in-time/bounded and were
not recaptured. B1 design only, B2 Alpine mechanism only, B5/1.2 open,
B6–B9 closed, D64 unchanged and the node not operationally accepted.


2026-10-17 04:56 EDT — D196, B5-native-ASIF-mount runtime observations:
6f7e9371 run39018959320/job117356737655 completed the corrected probe at
exit0. Artifact12096186192 is retained unchanged as
B5_NATIVE_ASIF_COMPLETE_REPORT_20261017.json (SHA2567097f7d9…2e09f4);
B5_NATIVE_ASIF_OBSERVATIONS_20261017.json records the interpretation.
On one isolated macOS26.6.2 arm64 runner, both exact-option variants set
readonly/nodev/nosuid/noexec and honored owners, including after the probe
explicitly disabled ownership before reattach. Root0:0 mode0600 stayed
unreadable to uid501; its own0600 file was readable. Plain readonly was
correctly refused for absent noexec. Image bytes/inode/size/mtime/ctime/flags
and empty xattr-name lists were identical before/after each readonly cycle.
The intervening write/disable phases are not covered by that equality.
Each phase independently confirmed its remembered disk gone, inventory0
and no mount; final cleanup removed the directory. These are sequential
observations, not physical exclusion or real-history acceptance.

B5-native-device-binding is a new Codex-owned source blocker: actual attach
IDs are bare while hdiutil/DeviceNode are /dev paths. The unchanged wrapper
refuses attach equality before mount; replay of the native rows with all
commands mocked also returns bare disk8s1 from data_volume and refuses
verify_mount with 'private mount point holds another device'. The probe's
canonical call is accepted, not the complete wrapper. Exact unblock: reviewed
strict canonical whole-disk/Data identity binding with decisive mismatch and
cleanup controls, then native owned reader integration. No check is relaxed
here. Native facts are observed; the gate stays open for review/current-head
CI and this binding correction. The next two gates are that owned source
correction and integrated stopped-ASIF reader verification; both use only
owned resources and require Claude plus exact-head green CI. D62 reboot
rehearsal still requires separately designated macOS access. B3/B4 were not
repeated; B5/1.2 open, B6–B9 closed, production capture disabled, node not
operationally accepted. No local VM, service, image or timer changed.


2026-10-17 06:51 EDT — D198: native shared device binding observed at
b1119e78 in39026337387/job117377947876 (artifact12097953565), exit0.
B5_NATIVE_DEVICE_BINDING_REPORT_20261017.json retains raw bytes with SHA256
efbd1656…1ae4cd6; the RUNTIME JSON records the interpretation. The seeded
volume root is0:0/0755 after preparation and in all3 variants. Both exact-
option variants honor owners, deny root0600 reads, preserve every recorded
image identity field across their readonly cycle and confirm per-phase
known-disk absence/cleanup. Plain readonly still refuses absent noexec.
The shared whole/Data binding helpers ran natively; the complete wrapper's
locked reader/capture flow did not. Guest uid parity, never-registered UUIDs,
sibling/dirty guest volumes and pre-existing xattrs remain unproved.
All-six exact-head CI and Claude review are pending; B5-native-device-binding
stays open. Next that review/CI gate, then native owned stopped-ASIF journal
reader integration, both within B1's owned-test authorization. D62 rehearsal
access stays operator-owned and separate. B3/B4 were not repeated; B5/1.2
open, B6–B9 closed, D64 unchanged and production untouched.


2026-10-17 09:04 EDT — D200, B5-kickstart-cause-probe runtime report.
1695ce92 job117402189372/run39034737877 exited0; artifact12101407361 and
raw SHA2560659ef76…f6bc3f4 are retained. All7 trial bootouts and individual
post-bootout checks passed; final target/domain observations show all7 absent,
no probe labels left, directory removed. Default short-runtime client stayed
alive after10.007s and returned success at10.016s. DefaultR3/R12 requests took
7.017s/.006s; delayed-request1s short-default took9.011s; explicitThrottle1
short/R3 took1.016s/.010s;Throttle0 short took1.007s. This supports a throttle-
and prior-runtime-related wait and reproduces the failure shape on this
runner, not an exact undocumented timing rule or proof of the earlier CI
cause. The runner was not idle: recorded load averages were24–43. Python
instruction timestamps, observed exits and the changed signal path limit
transfer. No runtime or fixture policy has been changed.
Claude's final source/evidence review and full exact-head CI remain pending.
Next a reviewed owned-fixture remedy justified by these observations, then
exact-head CI before native stopped-ASIF reader integration. Both are B1
source/owned work; D62/macOS access stays separate. B3/B4 not repeated,
B5/1.2 open, B6–B9 closed, D64 unchanged, production untouched.


2026-10-17 09:11 EDT — D201, B5-kickstart-cause-probe review and second CI report.
Claude Message104 finds no material source defect at1695ce92 and independently
passes19 controls plus3 real client classifiers. Runtime and old fixture bytes
are unchanged. The review identifies measurement extensions before interpreting
future anomalous/incomplete runs: second-start deadline anchoring, continuing
other arms after a measured anomaly with verified cleanup, instruction-origin
predictions/residual controls, and bounded logs on failure covering the run.
These do not invalidate the7 completed D200 arms; no exact timer rule or
historical full-suite cause is claimed. Codex corrected the review's prose:
this implementation removes private files only after completed+clean and then
writes the report. Lost reports cannot pass. Evidence interpretation review
of7a8dcb64 is pending in Claude Message105; no fixture remedy is applied.

The normal current-head CI39035129935, job117403289389, independently completed
the unchanged7-arm probe at7a8dcb64 (mergefd9d06db). Artifact12102275128 is
retained as B5_KICKSTART_TIMING_REPORT_REPEAT_20261017.json, SHA256
e25d03de25d904e482f3e238ce4d16b11a24b5a1749872b5494860a400d3bccb.
Default short/R3/R12/delayed-short client blocks are10.031/7.018/.008/9.017s;
Throttle1 short/R3 are1.059/.007s;Throttle0 short is1.019s. The default-short
client was alive at the post-timeout10.0036s sample and returned0 later.
All7 trial bootouts and absence checks, final individual absences/readable
GUI-domain/no-label checks and directory removal passed. Two separate CI
reports support the bounded timing association; they are not a distribution,
exact origin proof or production test. Full all-job CI remains pending, so
source readiness and B5-native-device-binding closure remain held.
Next gates: a reviewed owned-fixture-only remedy with unchanged runtime limits,
then native owned stopped-ASIF reader integration. Both need Claude and exact-
head green CI under B1. D62 disposable-macOS access remains a separate operator
decision. B3/B4 were not repeated; B5/1.2 open, B6–B9 closed, D64 unchanged,
production capture disabled and four physical histories separate. No live
service, VM, production image or timer was changed.


D202 source checkpoint: the owned mesh-agent plist and adapter now require
integer ThrottleInterval1; the timer remains unchanged and refuses that
extra field. Both native and simulated fixture producers match. Portable
real-file policy controls pass (including missing/0/2/bool throttle and extra
fields), and a removed-equality mutant dies at the intended assertion.
5 timeout controls and11 applied-timeout/readiness/policy tests pass locally;
the durable partial/closed/unresolved outcome and retry without another
kickstart remain asserted. Managed launchd/journal/gate/trace/probe bytes are
unchanged from0d329038. Python syntax and plan conformance pass. The new
15-minute focused macOS job exercises the two native cases with explicit
trace output before the existing long all-job gate can finish. No native
host test was run here. B5_OWNED_KICKSTART_FIXTURE_SOURCE_20261017.json records
hashes, baseline failure and proof limits. Candidate Claude review and exact-
head all-job CI remain pending; no source-readiness claim. Next native owned
stopped-ASIF journal reader integration, then D62/D175 admission/resumption
source under B1; actual macOS reboot still needs separate disposable access.
B3/B4 not repeated, B5/1.2 open, B6–B9 closed, capture disabled, production
untouched and all four histories separate.


2026-10-17 11:17 EDT — D203, owned restoration fixture source verified at1e915d8a.
All8 exact-head jobs pass in39042421331; Claude Message108 finds no material
regression and independently verifies preserved runtime hashes, portable
controls, refusal-before-launchd and guard mutants. Focused native job
117424417161 passes2 tests; full macOS job117424417172 passes the31-test
restore-only module in104.459s and completes the remaining job. The focused/
full stopped-daemon traces show explicit integerThrottle1, client rc0 and
completed in.004771/.006608s under timeout10; both recover resolved/open with
receipt restored. The timer-only policy negative passes, and the applied-
timeout controls still preserve partial/closed/unresolved plus a fresh retry
without another kickstart. The full run has no failed check. This source-only
milestone is at the named verified head; this receipt changes no executable
or workflow. Later heads still require their own checks.

The retained native JSON binds source/merge/run/jobs and filtered observations,
not an independent teardown/process-absence proof. It does not prove production
default-throttle recovery, D62 reboot safety, physical writer exclusion or real
history acceptance. B5-default-kickstart-policy remains open. T3 portable
anchor-policy coverage is a separate nonblocking carry-forward; T1/T2 and
future anomalous-probe measurement extensions are not expanded here.
Shared device-binding sources/probe and the differentiated timing probe are
unchanged from their reviewed/native-observed revisions; this green exact-
head run clears their outstanding CI hold without repeating their artifacts.

Next B5-owned-stopped-ASIF-reader uses B1-owned CI storage, a valid synthetic
checkpoint/commitment/CAPTURE fixture, the complete locked reader/mount wrapper
and frozen verifier, decisive corrupt/pending/unknown-entry refusals, unchanged
image identity, cleanup evidence, Claude review and exact-head green CI. Then
D62/D175 restore-only admission/resumption needs durable host ACCEPTED-or-ABORT
binding, scoped launchd/process comparison before Journal.recover, fail-closed
manual fallback and conditional value-only timer migration tested on owned
APFS reattach. Actual reboot/launchd/login/hold-reattach still requires a
separately designated disposable macOS machine or approved measured disk/RAM
budget/capacity source. No local UTM VM was provisioned or operated; only the owned CI checks ran.
B3/B4 were not repeated; B5/1.2 remain open, B6–B9 closed, D64 unchanged,
production capture disabled and all four histories separate. No live service,
VM, production image or installed timer was changed.
