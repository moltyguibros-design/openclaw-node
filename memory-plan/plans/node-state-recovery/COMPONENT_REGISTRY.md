# Node state recovery — registry

2026-10-18 04:25 EDT — D223 verifies owned class comparator 39638d1e:
all8 CI39109210059, native38/51, Claude261 clear. Only owned source row closes;
B5/1.2 open/pre, B6–B9 held. Receipt CI/review pending at commit.

2026-10-18 03:50 EDT — D222 own-label proof correction38 tests/51 intended mutants;182
regressions pass. Runtime unchanged; source review/CI pending, B5/1.2 open/pre.

2026-10-18 03:30 EDT — D222 class comparator candidate37 tests/50 intended mutants;181
bounded regressions pass. Review/CI pending; B5/1.2 open/pre, no admission.

2026-10-18 03:14 EDT — D222 class comparator pre-audit candidate; no source yet.
D221 receipt e9efb244 all8 CI39104976663, Claude253 clear; B5/1.2 open/pre.

2026-10-18 02:41 EDT — D221 verifies the owned observation-envelope source 89ae67db:
all8 CI39103018309, native55/50, Claude247 no required finding. Only the
owned source row closes; B5/1.2 open/pre, B6–B9 held. Receipt CI/review pending.

2026-10-18 02:08 EDT — D220 correction candidate:55 tests/50 intended mutants,144 bounded
regressions pass. Strict UID type + required sample/expiry proof; review/CI pending.

2026-10-18 01:50 EDT — D220 observation-envelope candidate:52 tests/47 intended mutants and
141 bounded regressions pass. Source review/CI pending; no class matching or admission.

2026-10-18 01:25 EDT — D220 observation-envelope pre-audit candidate; no source/proof yet.
D219 source/receipt all8 green, reviews229/237 clear. B5/1.2 open/pre; B6–B9 held.

2026-10-18 00:40 EDT — D219 verifies authored policy binding at ee311fcd: all8
CI39096484480, native49/46, Linux49/46; Claude229 no required finding. Only
the owned source row closes; B5/1.2 open/pre, B6–B9 held. Receipt CI/review pending.

2026-10-18 00:14 EDT — D218 proof correction: local49/46; runtime/workflow identical433966aa.
Claude227 required ordering proof gap pinned; corrected-test review/CI pending.

2026-10-17 23:56 EDT — D218 authored policy-binding candidate: local47/44 and324 bounded
regressions pass. Exact-source review/CI pending; no admission. D217 remains verified.

2026-10-17 23:02 EDT — D217 verifies the owned current-boot process diagnostic at81ac425b:
all8 CI39090362566 green; native40/29, unpatched scan refused with owned child matched;
Claude215 no required finding. Receipt4e3605bf all8 CI39092308432; Claude221 no required finding. B5/1.2 stay open/pre and
B6–B9 held. D64/production/timers unchanged. Next policy binding, then a separate
boot comparator/observer contract and durable admission before manual/D175.

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


### 2026-10-17 13:12 EDT — B5-owned-stopped-ASIF-reader candidate (D204)

The CI-only ownership probe now has a separately guarded complete-reader mode. It seeds
the existing synthetic checkpoint fixture with the actual fresh ASIF UUID before commitment,
then tests intact/corrupt-chain/pending/unknown/changed-config cases through the real locked
wrapper and frozen verifier. Each readonly interval must preserve the image identity/bytes
and pins and confirm its attached disk gone. All85 portable mount/probe controls pass
(one platform skip); Claude review, native report and current exact-head CI are pending. This is not
a VM capture, guest UID parity, pre-stop writer proof or B8 acceptance. B5/1.2 remain open,
B6–B9 closed, D64/production-capture refusal unchanged. Production was not touched.

D204 review correction: Claude114 finds no reader-mode source defect but requires outer
negative coverage. ReaderRun now covers image/pin/head changes, partial later-case failure
and cleanup/interrupt outcomes; failed native reader runs retain their own image for a
CI diagnostic artifact. Local91 tests pass (one skip); all4 committed guard mutants die
for intended assertions. This corrected revision still needs Claude and exact-head CI;
B5-owned-stopped-ASIF-reader is not yet closed. No production operation occurred.


### 2026-10-17 14:01 EDT — B5-owned-stopped-ASIF-reader verified (D205)

Verified source e120e78d / exact CI39053730664: all8 checks green; Claude116
closes R1/R2 with no material defect. Native job117457344212 verifies54 intact file reads,
4 intended read-stage refusals,5 stable readonly image intervals and nonvacuous seed/read
disk absence, with final directory removed. The reviewed raw report is retained under
step12_jetstream; its SHA256 starts e02ab656. All91 controls and4 intended guard mutants
pass. Failed native upload itself was not exercised; scripted retention/interrupt controls
are explicit. Synthetic fixture evidence only: no VM capture, guest UID parity, physical
pre-stop exclusion or B8 acceptance.
Next B5-D62-admission needs reviewed host-decision/scoped-observation/manual-fallback
source and owned tests; B5-D175-owned-repin then needs that admission and strict5-timer
value-only migration with owned APFS reattach negatives. Both need Claude/exact-head CI.
Actual reboot rehearsal still needs separate operator-designated disposable macOS access
or a measured fixed resource decision. B3/B4 not repeated; B5/1.2 open, B6–B9 closed,
D64 and production capture refusal unchanged. No production operation occurred.

2026-10-17 15:16 EDT — D207 verifies the production release fence at e6543580 / all8 CI39059651789; native job117474802932 passes all7 reconcile tests, Linux all4 fence controls, Claude122 verifies both intended mutants. The test-only directory-mode refinement removes an order dependency; runtime/workflow bytes are unchanged. Host cleanup/terminal decisions, scoped boot admission/manual route, D175 and actual macOS reboot remain open. No production state changed.


### 2026-10-17 15:52 EDT — B5-D62-owned-abort-cleanup candidate (D208)

The existing clone-disposal module now has a completed-capture-only abort-cleanup
operation with an entry-first production refusal. It consumes existing real checkpoint/
commitment/capture validators, both exclusive locks relative to a pinned capture directory,
original-host/guard bindings and stable source/clone bytes. Root fixed-name atomic intent
and cleanup records flank only clone unlink; the clone descriptor remains open and must
report link count zero. Capture already left its flag clear: cleanup refuses an immutable
clone and changes no image flag. Source denial stays applied as sampled, never released.
Existing MATCH/JOURNAL_INPUTS receipt bytes are pinned before further clone reads are
foreclosed; they supply no acceptance. The host-spec hash is a forward pin only.

Claude134 challenged unlink identity, lock self-deadlock, atomic publication, sibling
policy and claim scope. The candidate uses direct preflight under locks, descriptor-based
unlink/link-count verification, root atomic markers and a cleanup-only sibling-clone rule;
a sibling CAPTURE without a clone remains evidence and is allowed. Reconcile's stricter
rule is unchanged. Claude136 accepts retaining the existing mount binding imports and
real HostCheckpoint fixture producers; the exact candidate source still needs review.
The existing shared mount helpers gain only optional directory/held-descriptor inputs;
old callers retain their behavior. No parallel decision controller is introduced.

The fixed abort-cleanup diagnostic directory or either root final/temporary marker makes
all retries refuse for manual handling. A failure after rename but before successful
parent fsync may leave a complete visible receipt with FAILED.json: receipt presence is
not success and future terminal consumers must reject failed/partial attempts. Intent
survives failure. This is a cleanup prerequisite, not terminal ABORT, ACCEPTED, BOOTABLE,
D62 admission or a manual restoration implementation. Same-uid path/flag interference
between observations remains D189's limit; a swapped unlink can be detected by the held
inode but is not atomically prevented. Unlink does not destroy shared image bytes.

Verification in progress: portable real-producer fixtures, decisive identity/pin/lock/
attachment/interruption/publication/replay negatives and guard mutants, existing mount
regression, Claude and exact-head CI. Native flag/ASIF cleanup and actual reboot are not
claimed. No source readiness or gate closure yet. Fresh PR head f83317d3 had all8 checks
success before this candidate. Governance recheck: B1 source/owned only; B2 Alpine is a
bounded historical guard rehearsal; B3's23 pins remain JIT; B4 remains bounded design
input, neither repeated. B5/1.2 open; B6 has no exact attended-window release; B7–B9 remain
held with no production capture, real-history acceptance or verified timer resumption.
D64 and production capture refusal remain unchanged; all four histories stay separate.

Next: terminal ABORT production/strict consumption after checked cleanup, then scoped
guest job/process admission/manual restoration before D175. Both source gates use B1
owned resources, need decisive negatives, Claude and their own exact-head CI; ACCEPTED
still requires a real B8 producer. Actual macOS reboot still needs the operator's exact
disposable-machine designation or measured disk/RAM/capacity decision. No production
service, VM, image or installed timer was operated.


2026-10-17 16:01 EDT — D208 append-only correction, candidate not ready:
cef42140's scripted holder seam hid a real refusal: retained clone_fd makes the
legacy no-holder lsof check report our own PID. The new cleanup-only observation
requires exactly the current PID and known read-only descriptor in lsof's p/f/a/n
fields, no other own/foreign descriptor and no attachment. No image flag changes
are added. An owned regular-file macOS control observes that exact descriptor and
refuses an extra own writable descriptor; it is not native ASIF cleanup or a VM
rehearsal. The original ARMED scope is also checked, with a negative that consistently
re-pins all later records. Thirty controls including the native lsof case and seven
focused mutants passed before this last scope control; final31/eight-mutant runs
and exact-head Claude/CI are pending.

The first cef42140 CI39064371810 has Node22 job117488789488 failing at unchanged
cluster-replicated-r3-create with NATS400 peer offline, before any new Python test.
Raw job-log SHA256 a223c756b1a7c353586048e484d9605bfe8120fd803bc2a378c108446e47485b.
Six other jobs are green; full macOS remains running at this observation. It is
not a green source proof. One specific-job rerun request was refused while the run
was in progress; no blind retry or unrelated fixture rewrite was made. The corrected
candidate needs a new exact-head run in any case. B5-exact-CI is Codex-owned and
holds source readiness; no new operator authority/access is requested. D64, B6–B9,
production capture/reconcile refusals and all production resources remain unchanged.


2026-10-17 16:10 EDT — D208 append-only scope correction after Claude142:
The exact holder filter excludes additional descriptors visible to lsof as the calling
user; it is not a cross-user descriptor census on macOS. The separate hdiutil inventory
checks visible image attachments. Neither observation supplies physical exclusion or
continuous denial. The earlier unqualified “no other own/foreign descriptor” wording
is superseded by this visibility limit. Optional evidence pinning covers only MATCH.json
and JOURNAL_INPUTS.json one directory level below the capture root, not arbitrary files
or receipts elsewhere. The source hashes an owned0600 single-link source as a deliberate
owned-fixture precondition; native ASIF liveness at other modes remains unproved.

Claude142 finds no required source defect at cf98b242 and independently reproduces31
controls (one Linux platform skip), all8 intended mutants, mount91 controls, capture
and reconcile controls as uid65534. It verifies real per-role frozen stores can precede
cleanup while the extracted root stays0700. The native single-fd observation remains
Codex's macOS evidence; Claude used Linux. Four optional surviving guard mutants now
receive focused test-only negatives for post-unlink decisions/sibling clones, intent
read-back, final intent binding and pre-unlink named-entry binding. Runtime/workflow
bytes are unchanged. SourceCI39065020767 remains pending; no source closure yet.


### 2026-10-17 16:32 EDT — B5-D62-owned-abort-cleanup verified (D209)

Verified runtime source cf98b242ad0fa69581dc8ea5e87e051a473c3125, exact CI39065020767 all8 checks success.
CI checkout merge bfe3c82b9f010b590d5b6cb150600c93c2aeb022 has blob-identical step12 sources/tests
and workflow, independently checked against the source head.
Native macOS job117490728969 runs all31 cleanup controls, including the
actual owned regular-file lsof single-readonly/extra-writable-descriptor observation,
and kills all8 source guard mutants. Raw native job-log SHA256 2beceeb79790de542833306808bce20213a3411473a838f31ea98885c3283d0e.
Linux Node22 also passes the complete JetStream step; its macOS-only lsof control is
skipped there. The earlier unchanged R3 fixture failure did not repeat on this head;
no claim that its cause was fixed follows. Superseded cef42140 run39064371810 is
cancelled, with its failure evidence retained, never relabelled green.

Claude142 independently reproduces31 controls with one Linux platform skip, all8
intended mutants, mount91 and capture/reconcile controls as uid65534, and finds no
required source defect. Its required visibility wording is corrected append-only:
lsof covers descriptors visible as the calling user, not a cross-user holder census;
hdiutil inventory is a separate observation. Only one-level MATCH/JOURNAL_INPUTS
receipts are pinned. No continuity, physical exclusion, byte destruction, authorship,
real-history acceptance or native ASIF cleanup claim follows.

This receipt strengthens tests only: four optional surviving guards now have decisive
negatives for late terminal/sibling appearance, changed intent read-back, changed final
intent and a clone swap before the named-entry check. All35 controls pass locally on
macOS; the committed runner passes its controls and kills all12 intended mutants,
with no runner errors. Runtime and workflow bytes are unchanged from the verified
source above. The receipt head still needs its own exact-head CI before readiness.

B5-D62-owned-abort-cleanup closes only this nonterminal owned cleanup prerequisite:
no image flag changes, no terminal ABORT/ACCEPTED/BOOTABLE, no source release or guest
admission. Intent/final/temporary markers or the single-use abort-cleanup directory
make every retry manual. A visible receipt beside FAILED.json is not success; future
terminal consumers must refuse failed/partial evidence. D64 and production capture/
reconcile refusals remain unchanged. B5/1.2 stay open at v1.2-pre, B6–B9 held; B3/B4
were not repeated, all four histories remain separate, and no production resource was
operated. Actual reboot behavior remains unproved.

Next two gates: B5-D62-host-terminal-abort must strictly consume cleanup and all original
arm/nonce/checkpoint/capture/guard/host bindings, reject failed/partial/stale evidence,
recheck physical cleanup under active denial, then publish durable ABORT before a
separately checked owned source release. ACCEPTED still needs a real B8 producer;
MATCH, JOURNAL_INPUTS and the release verifier's byte-only VERIFY are not that decision.
B5-D62-guest-admission/manual then needs that host-decision binding before any gate opens,
all OpenClaw launchd jobs plus every process as the OpenClaw user or executing from
production entrypoint roots compared before Journal.recover, unreadable/unexpected
observations refused, then stopped-unit/override checks and an explicit manual route.
This scope is not a complete physical process census. D175's conditional five-timer
value-only migration follows admission and precedes gate construction; same-boot checks
remain. B1 authorizes source/owned fixtures for both gates; no new VM access is needed
for source work, and each needs decisive controls, Claude and exact-head CI. Actual
macOS reboot/login/hold-reattach and D175 rehearsal still need an exact operator-designated
disposable machine or a measured fixed disk/RAM/capacity decision. No VM is provisioned.


### 2026-10-17 17:18 EDT — terminal ABORT candidate (D210)

Existing clone disposal now produces a fixture-only cleanup-bound ABORT and verifies
canonical exact schemas, original capture/guard/host bindings and forward sample pins.
A matching COMPLETE after post-publication checks is mandatory; visible ABORT beside
FAILED/temp/partial evidence refuses. The core verifier reads under caller-held locks
and caller-supplied fresh observations, returns bytes only, and changes no flags.27owned
terminal tests pass94.927s; mutants/regressions/Claude/exact-head CI pending. This is not
source readiness or release/admission. D64 and production refusals remain; B5/1.2open,
B6–B9held, B3/B4 not repeated, four histories separate. Next: checked owned source release,
then guest scoped admission/manual restoration before D175; actual macOS reboot remains
operator-access/resource-gated. No production operation or local image/VM action.


2026-10-17 17:30 EDT — D210 correction: two distinct descriptors are now required by
both core verifier and shared pin reader; flock ownership remains the caller's duty.
Shared preflight exclusively pre-creates both helper logs0600 before bootstrap, keeping
the strict reader.29terminal tests,15status tests and14intended mutants pass locally.
The existing CI native capture fixture now checks real sample ingestion and log modes;
that assertion, corrected-head Claude and CI are pending. No native terminal pipeline,
source release/admission or B5 closure. See D210 for unobserved old native mode and scope
corrections; production, D64, installed timers and all four histories remain unchanged.


### 2026-10-17 17:58 EDT — owned terminal ABORT source verified (D211)

Verified source00264a3c / CI39071272275, all8 checks green; native117509228208 passes
real before-shutdown/after-guard sample ingestion and private-log assertions,16capture,
29terminal/15status controls and14intended mutants. Native log SHA2564ebd019ed8bdc493bad382baf8386c5185ccd8864a3634f0c2afe9e38ec1638c.
Claude158 independently verifies controls/mutants as non-root, with no required finding.
This closes only B5-D62-host-terminal-abort source: no release, guest admission or boot.
Native terminal pipeline, protected provenance and actual macOS reboot remain open;
D64/production refusals unchanged, B5/1.2open, B6–B9held, B3/B4 not repeated and four
histories separate. Next: checked owned source release, then scoped guest admission/
manual restoration before D175. Receipt head still needs exact-head CI.


### 2026-10-17 20:13 EDT — owned pre-start restore-prior decision candidate (D214)

Existing host_vm_reconcile now records a fixed single-use owned RESTORE_PRIOR after the
completed ABORT/release chain and a fresh unchanged original-host stopped sample; its
read-only verifier is pre-start only. The pure restore_only claim decoder checks the
external digest and local checkpoint, returns authority unprotected-user-owned/admission
false and performs no recovery or filesystem operation. Claude187's four design points
are included; changed-host-session/post-start weakening, automatic platform-process
allow-lists and nested DECISION names are excluded.25 controls pass46.114s; mutants,
regressions, exact-source review and exact-head CI remain pending. D214 records the
Codex-owned B5-gate-device-reattach dependency: all four saved device bindings need a
reviewed per-filesystem stable-identity mapping before D175/gate construction can close.
Manual guest restoration remains future work, not an available command or bypass.
B5/1.2 open, B6–B9 held, D64/production/timers unchanged; B3/B4 not repeated. Four
histories separate. Next guest scoped admission/manual, then D175; actual Mac access
and APFS/reboot proof remain distinct. No production/native image/VM/launchd operation.


D214 pre-publication verification: all27 owned decision/claim controls pass47.922s;
all13 mutants are killed at their designated assertions with unmutated controls passing
and no test errors.45 bounded release/production-fence/D64 regressions pass63.547s.
The attempt-directory fsync/open failure path now enters best-effort FAILED recording;
its new negative preserves the original exception and retained manual attempt. Rebinding
both INTENT/RESTORE_PRIOR to a wrong evidence table refuses. AST comparisons confirm
reconcile, release_aborted, verify_release, abort_conflicts, no_terminal, terminal_abort,
verify_abort, recover_owned and Journal.recover are unchanged. Linux/macOS registration
adds the new27-control suite and13-mutant runner only. Plan lint14PASS/1existingWARN/0FAIL.
Claude187 design corrections are included; exact-source review and new exact-head CI
remain required. No source readiness, guest admission/manual route or B5 closure yet.


D214 mutation-runner integration correction: aa340975 duplicates the prior release
runner's literal durable_evidence(evidence) anchor (2 hits, expected1). CI39082243166
was canceled as superseded before claiming a native/green result. Rename only the new
decision producer's local variable to transcript and update only its own runner anchor;
old release/runtime bodies and runner stay unchanged. All27 decision controls pass
43.692s, all13 new decision mutants pass, and the unchanged prior release runner passes
all13 intended kills with its controls. This is a necessary same-contract test integration
correction, not a production behavior change. Exact corrected-head Claude/CI still required.


D214 proof re-orient, 2026-10-17 20:36 EDT: Claude193 finds no required source
finding at3cbc9cd5 and independently reproduces27controls/13decision/13release mutants
as uid65534 plus regressions. Its live extra mutations expose three material optional
proof gaps: stored-sample host binding, decision-to-intent pin and independent decoder
nonce/arm/checkpoint bindings. Close B5-decision-binding-tests within this same owned
handoff contract before source closure: six new controls also isolate previous/pre-head
and released-flags schema; seven added mutants pin those present guards. All33 controls
pass41.735s, all20 decision mutants fail at their intended assertions with controls
passing/noERROR. Runtime/workflow/release runner bytes are unchanged from3cbc. This
supersedes the27/13 test floor without relabelling earlier runs. Exact test-head Claude
and CI remain required. Smaller JSONDecodeError normalization and host import-graph
notes are carried, not defects or a new refactor. Guest/manual/D175 and Mac proof stay open.


### 2026-10-17 21:06 EDT — owned pre-start decision source verified (D215)

Source d5636b54 / CI39083436062 all8 green; Claude195 reproduces33controls/20mutants
as uid65534 and closes every material193 proof gap plus previous/flags, no required
finding. Native117544960569 runs33controls16.121s/20decision kills (59 with prior runners),
raw SHA256 d63ed33a35dcc81d808077e8c9c8a46b5359f57efd54079a669afa581aeda128. Native/Linux merge34a3bd5a
has identical recovery/workflow bytes; Linux117544960755 passes33controls15.620s/20kills.
Earlier3cbc / CI39082522585 all8 is separately27/13 native15.531s, never relabelled33/20;
aa340975 CI39082243166 canceled, not green. Only the owned source prerequisite closes.
The decoded digest remains an unprotected claim with admission false; no boot or guest
recovery authority. VM/flags scripted; actual owned-file barriers are not native whole-
pipeline, physical authorship or real reboot proof. D189/protected provenance and the
explicit optional notes remain. Source feeds claim decoding, then guest scoped admission/
manual route before D175. B5-gate-device-reattach, serving-NATS adapter and actual Mac
access/APFS/reboot evidence remain open. B5/1.2 pre/open, B6–B9 held, D64/production/timers
unchanged; B3/B4 not repeated and four histories separate. This five-Markdown receipt
head needs its own exact-head green CI; no production operation or local native image/VM/launchd operation.


### 2026-10-17 22:13 EDT — owned process diagnostic candidate (D216)

New scoped_process_diagnostic.py composes unchanged process/path/file primitives and
provides a record-free fixture CLI with explicit current-boot expectations.36 local
controls1.456s and24 intended mutants pass, including an independent spawned C-child
control under explicitly substituted enumeration. No native full-host positive, policy
producer, job/hold/decision comparison or admission is claimed. Report outcome is clean/
refused, never verified; admission/history_certified stay false and argv is redacted.
Claude207 design corrections are included; exact-source review and exact-head CI pending.
B5-boot-process-policy stays open, along with guest admission/manual/D175 and actual Mac
access/measurement/reboot proof. B5/1.2 pre/open, B6–B9 held, D64/production/timers unchanged,
four histories separate. See D216 for sampling, current-disk-image and decoder limits.


### 2026-10-17 22:25 EDT — D216 whole-argument scope correction candidate

An independent argv-with-spaces symlink reproduction falsely excluded an
other-UID root process at ffd7cb8c. Whole process arguments are now resolved
before the unchanged shared plist classifier. Local40 controls/28 intended
mutants pass; corrected source review/CI remain pending. Superseded run39089415728
was canceled, not green. No admission, production or shared-API change.


### 2026-10-17 22:30 EDT — D216 directory-root proof candidate

Claude213 confirms the required whole-argument scope defect is fixed at07347924,
reproduces40 portable tests (one native skip) and28 intended mutants as uid65534,
and finds no required source issue. Its independent delimiter aliases and embedded
flag control behave correctly. The optional live parent-directory branch was still
unproved: the equality-only mutant passed40 tests. The regression now exercises
each delimiter alias against both a file root and its parent directory; a named
parents-branch mutant fails its intended assertion. Local40 tests pass3.023s and
all29 intended mutants pass with intact controls. Runtime/workflow bytes remain
identical to07347924. Superseded CI39090103107 was canceled for the proof extension,
not counted green. Corrected-test exact-source review and exact-head green CI are
pending. B5/1.2 remain open/pre, D64/timers/production unchanged, no admission.


### 2026-10-17 23:02 EDT — owned process diagnostic source verified (D217)

Source81ac425be0c7e6115e4ed1ea7e1ec2a55de6049f passes all8 jobs in
CI39090362566. Native117565607992 passes40 tests7.552s and29 intended mutants;
the unpatched owned-runner scan refuses, matches the independently expected C
child, and reports516 unknown entries/299 unexpected rows. Unknown entries are
not distinct process counts; no per-reason or complete-table measurement is
claimed. Linux117565608002 passes40 tests0.130s with one native skip and29 mutants.
Claude215 independently reproduces40/29 as uid65534 (native skipped), verifies
unchanged runtime/workflow and closes the directory-root proof gap with its
independent equality-only mutant. No required finding remains.

Checkout mergee2529cd5b01f9b5502c381271a54b97ff9589bb1 has source81ac425b as
second parent and identical recovery, lib/bin/test/workspace-bin and workflow
bytes. Native raw log SHA256 c58ce17e2e05bb53e1805d6fdf58b1dfd94452c635854b9bba64a6c754d5259b;
Linux raw log SHA256 47c040b3163577ae5fcf76a67b1fc630f4eddea3737793eb470f5f11aa2aa2d2.
The committed native excerpt B5_SCOPED_PROCESS_DIAGNOSTIC_NATIVE_EXCERPT_20261018.txt retains the result/count lines, not a full table.
Excerpt SHA256 5652932eea85c0f37413e6c61dbb63b82325ff103197b4bbd6b7c69e0dcf6d8f. Earlier runs39089415728 and39090103107 were canceled for the
required scope fix and its proof extension; neither is green evidence.

Only B5-D62-scoped-process-diagnostic closes as an owned source prerequisite.
B5/1.2 remain open/pre, B6–B9 held, and D64, production, journal/Gate/census APIs
and installed timers unchanged. No production operation or local full scan ran.
Current-boot test expectations grant no boot policy, eligibility or admission;
loaded-image, sampling, same-UID D189 and physical-census limits stay. Next is
explicit pre-window process-policy binding, then a separately reviewed boot
comparator/observer contract and durable admission record before manual/D175.
Actual disposable-Mac access, APFS reattach and reboot rehearsal remain separate.
The receipt changes evidence/docs only; its own exact-head CI/review is pending.


### 2026-10-17 23:41 EDT — B5-D62-process-policy-binding candidate (D218)

The owned diagnostic receipt4e3605bf passes all8 CI39092308432; native40
controls8.813s/29 intended mutants, owned child matched/full scan refused with
522 unknown entries and318 unexpected rows. Claude221 finds no required receipt
issue; these receipt-CI observations are Codex's and do not replace D217's
source-native516/299 evidence. No admission or production operation is added.

The next bounded outcome is one authored, generation-free process policy in a
new full-node baseline, plus a fixed-path owned producer and a dedicated frozen
consumer that first verifies the external checkpoint. The optional carrier is
inert for all old no-policy callers/readers. No in-window event, CAPTURE_KEYS,
D64/recover, Gate, identity.json, timer, host executable or production change.
Code/argv/cwd/uid/gid/count and explicit launchd-or-expectation attribution are
exact; references must terminate, and held managed jobs/commands cannot be
authored as expectations. No implicit self, root, platform or ancestor permission.

Claude219/223/225 and Codex222/224 define the pre-audit. The complete initial
receipt, not a policy-only cap or arbitrary growth reserve, is the tighter1MiB
reader threshold; both actual serialized files must fit before publication.
Ordinary reopen, interrupted-created=True initialization (including its OSError
early return), and the final reopen path reject a supplied policy. The owned
producer derives every writable path beneath its literal private temporary
root, rejects symlinked parents before Journal construction, and takes explicit
caller-supplied prior/inventory rather than claiming live process enrollment.

Recorded owner binding uses the actual metadata_identity.uid and last watched
gate-root identity.uid plus the root device:inode pin. Root/lock pins themselves
are strings without uid; ancestor path owners differ. Missing owner carriers in
a new policy refuse. The producer observes its own uid; only the image reader
labels actual file-owner metadata. The pure validator observes no filesystem.
The consumer claims pinned-checkpoint consistency only: same-uid coordinated
rewrite/recommit remains undetected (D189); authorship, pre-stop authenticity,
policy completeness/satisfiability and record-time eligibility remain unproven.

Verify: portable honest producer/frozen/image positives and independent refusal
cases for schema/code/argv/owner/root/count/attribution/held jobs, swap/absence/
malformed rehashed policy, exact complete-receipt byte boundary and all reopen
routes; intended-assertion mutants with intact controls; unchanged old baseline
and D64 controls, exact-source Claude review and exact-head green CI. These
checks are pending. Only this owned source prerequisite may close. B5/1.2 remain
open/pre, B6–B9 held; boot comparator/observer/durable admission, manual/D175,
Mac access/APFS reattach/reboot and the separate physical histories remain open.


### 2026-10-17 23:56 EDT — D218 local binding candidate proof

Local47 portable controls pass5.229s; the44-mutant runner reports intact controls
and44 named intended-assertion kills, never counting ERROR or an unrelated crash.
The combined47 new and277 existing journal/checkpoint/host-commitment/stopped-reader/
scripted-full-node controls pass324 tests162.378s. The first runner assertion token
was corrected to the actual Refused class before any source commit; no failed
runner invocation is counted as proof. Local plan lint14 PASS/1 existing WARN/0 FAIL;
the warning is the existing idle step machinery, not a new close or version bump.

The new honest producer and frozen/image positives use actual owned file bytes,
Journal writes, checkpoint/commitment code and the stopped reader. VM, launchd and
execution-hold observation remain existing scripted facades; this is portable
source evidence on macOS, not a native full-node/reboot/eligibility proof. Only the
two existing Journal constructor/open bodies change (AST comparison to4e3605bf);
recover/D64, forward/capture/frozen verifier bodies and every other existing
executable remain unchanged. The new validator performs no filesystem or process
observation. Complete initial-receipt sizing covers capture-compatible creation
states only, not future post-boot writers or the16MiB whole-lineage read budget.

Exact-source review and exact-head green CI remain pending. The candidate row
stays open; B5/1.2 pre/open and B6–B9 held. No production service, VM, timer, mount,
resource provisioning, new live process scan, policy enrollment or admission.


### 2026-10-18 00:14 EDT — D218 checkpoint-order proof correction candidate

Claude227 reproduces source433966aa:47 controls/44 intended mutants as uid65534,
435 existing tests ran with usual skips and all suites OK, unchanged runtime
bodies except constructor/open. It finds no required source defect, but its
checkpoint-before-policy reordering mutant survives47 tests. That is a required
proof gap because malformed extracted records then escape as key/type errors or
reach policy validation before the external committed digest is checked.

The new negative feeds a non-list, a baseline missing inventory, a string prior
and a rechained malformed policy, requiring the checkpoint's Refused class and
message precedence. Its statement-reordering mutant now fails that named
assertion, with no ERROR counted. A second negative also closes Claude227's
optional image pin-order gap: a scripted divergent second commitment read must
refuse before the real read_inputs can select a window. Local49 controls pass
11.591s and46 intended mutants pass with intact controls. Runtime and workflow
bytes are identical to433966aa; the prior324-test batch remains evidence of the
common executable paths, not a new325/326-test execution claim.

Superseded CI39095435399 is cancelled for this proof correction, not green. Its
Linux117580780740 recorded47/0.960s/44 at merge3a743eddd6137ae831ae4a3441000ab169d4c504
(source433966aa second parent, identical whole tree); raw SHA256
1bc8c68cfa910d921f5c153c183a3bef064a06d8bfde703b955e2af4d03c7590. This
is the earlier proof only. Corrected-test exact-source review and new-head CI
remain pending. B5/1.2 stay open/pre; no admission, production, Gate or timer change.


### 2026-10-18 00:40 EDT — owned authored process-policy binding source verified (D219)

Source ee311fcd24f63df8439e0337588708831f4ff47a passes all eight jobs in
[CI39096484480](https://github.com/moltyguibros-design/openclaw-node/actions/runs/39096484480).
Native job117583902913 passes49 controls in1.188s and all46
intended-assertion mutants with intact controls. Linux job117583902984 passes49
controls in1.113s and46 intended mutants. Both complete raw logs were
read by Codex; no ERROR or unrelated failure is counted as a mutant kill.
Native raw-log SHA256 e034f1a9d62af75ebfdfea48c30b9cf7c73adcc5c75266b267afa72761fb2a1e;
Linux raw-log SHA256 0c024fb7cb08be81448d74270b8a5ef91b62ebb667734bc1adbab91895927eea.
Both logs name checkout merge 6c079518c14761e8ed684d0d51e07f7ee8ff1f9f, whose
second parent is the reviewed source and whose whole tree is identical to it.

Claude229 independently reproduces49/46 as uid65534 and finds no required issue.
Its independent checkpoint-before-policy reordering variant, a variant wrapping
policy errors into checkpoint-worded refusals, and the image pin-equality mutant
all fail the new assertions. Claude227's required proof gap is closed; its six
remaining non-blocking strictness/proof limits stay in INVENTORY. Runtime and
workflow bytes are identical to433966aa; the earlier324-test regression remains
that earlier common-executable run, not a new combined run. Superseded run39095435399
was cancelled for the proof correction and is not counted green.

Only B5-D62-process-policy-binding closes as an owned source prerequisite.
The optional new full-node baseline field binds authored generation-free claims
to the externally pinned checkpoint; every supplied-policy reopen route refuses,
and both actual initial serialized files fit the existing1MiB reader bound.
Owned producer/frozen/image positives use real owned file, Journal, host commitment
and stopped-reader code; VM, launchd and hold observations remain scripted.
This proves checkpoint consistency, not policy authorship, pre-stop authenticity,
completeness, satisfiability, live enrollment, record-time eligibility or admission.
The executable hash remains an on-disk claim, not loaded-image evidence. D189 stays.

B5/1.2 remain open/pre and B6–B9 held. Recover/D64, Gate, forward/capture and frozen
verifier bodies, host executables and installed timers stay unchanged. No production
service/VM/timer operation, mount, resource provisioning, reboot or local live process
scan ran for this unit. Next is a separately reviewed process-observation-envelope
contract, then the pure process-class comparator, jobs/hold/overrides/fresh D60,
durable admission and the attended manual route/D175. The envelope discussion is
design input only; its sampling, scope-evidence, redaction and acceptance-window
budget contract still needs a final pre-audit before implementation. Mac access,
APFS reattach, reboot rehearsal and the four physical histories remain separate.
This receipt changes five Markdown records only; its own exact-head CI/review
remain pending at commit time.


### 2026-10-18 01:25 EDT — B5-D62-process-observation-envelope candidate (D220)

D219 receipt2615452b and sourceee311fcd pass all8 CI39097936909 and39096484480.
Claude229/237 find no required source/receipt issue. Receipt-native49/2.326s/46
and Linux49/0.831s/46 are Codex's final run observations, separate from Claude237's
independently verified source-native log. Receipt merge5335589ac9524a7d66d947453c16958466f64345
has receipt2615452b as second parent and an identical whole tree. The stale B5
frontier summary is corrected here; D219's pending-at-commit text stays historical.

Next bounded outcome: one four-PID-sample, current-boot observation envelope over
a bound authored policy, consumed by a record-free owned diagnostic. Claude241
proposes composing unchanged diagnostic.compare(raw, empty expectations) for
raw schema, scope and redaction rather than a second census/resolver. Its own
clean/refused verdict is stripped. Codex242 pins outer-boot expectations so inner
boot failures survive as unknown, all raw unknown multiplicity, excluded-row
fingerprints, both launchd reads and plist identities, unique namespace/label
pairs, integer monotonic offsets and the fixed owned fixture boundary. Final
pre-audit response is pending; no observer source or test exists at this entry.

Recorded means a complete coherent observation, never a class-policy match or
admission. Unknown, unreadable, unstable, changed, incomplete or expired evidence
refuses. Unloaded/idle job observations are known negative facts for the later
comparator. Same-UID scope cannot be excluded. Other-UID scope remains read-only
observer evidence, bound to the policy and samples, with D189's unprotected-input
limit; no basename/platform/controller exception and no raw argv disclosure.
The120-second acceptance window cannot interrupt blocked filesystem/libproc
calls; at most16 distinct anchors are queried. No hard wall-clock guarantee.

Minimal source surface after the pre-audit: one new step12 module, test and
intended-assertion runner, four CI registration lines, and these six ledgers.
Existing diagnostic, policy binder, shared lib, Journal/schema/recover/D64,
Gate/identity, host executables and timers stay unchanged. The owned consumer
reads a separately prepared fixture; it constructs no Journal/Gate, capture or
policy enrollment and writes no file. Scripted file input always stays scripted.

Verify before closing only this owned source prerequisite: pure schema/coherence
controls and intended mutants; actual helper composition and ordered samples;
unknown-entry retention, all-row stability, namespace/generation/plist bracketing,
redaction, budget/cap and provenance negatives; honest frozen-policy owned reader
with unchanged files and zero constructors; native substituted and CI full-runner
measurements, no full-scope positive claim; exact-source review and green CI.
Class matching, jobs/recorded hold/overrides/fresh D60, durable admission, attended
manual/D175, Mac access/APFS reattach/reboot and four-history acceptance stay later.
B5/1.2 remain open/pre, B6–B9 held. No production operation is added or performed.


### D220 pre-audit settled — Claude243, before source work

Claude243 accepts Codex242 with no required issue. Carry the seven precision pins:
outer boot_start is the empty-expectations boot; inner boot=None and all unknowns
survive unchanged; excluded rows carry full redacted-row fingerprints; J1 is read
for unloaded/idle as well as running jobs; both redacted job reads and both plist
identities survive; reported PID generations bind both passes, including excluded
rows; anchors are unique namespace/label pairs without choosing an authored hash;
integer monotonic_ns offsets use120000000000ns and16 anchors; fixed private owned
fixture capture/data/table/envelope paths precede all reading/collection. table.json
is fixture authority only and supplies no B3 provenance. Scripted source/coverage
is forced by the file consumer; original claims are narrowly typed labels only.
No raw arguments key or inherited diagnostic verdict appears in serialized facts.
Recorded is coherent sampled observation only, never class matching or admission.
The on-disk and D189 limits remain. Source/proof implementation now starts; exact
review/CI and the candidate row remain open.


### 2026-10-18 01:50 EDT — D220 local observation-envelope candidate proof

The new process_observation_envelope composes the existing two-sample observe
and compare scope stages twice, with an outer current boot and bracketed launchd
facts. Its pure serialized validator retains all unknown entries, including
multiple failures for one PID and global failures; compares included rows and
excluded full-row fingerprints across passes; and independently recomputes
coverage, generation/job/plist ties, budget and the envelope verdict. It strips
the old diagnostic verdict and emits no raw process or launchd arguments.
Recorded is coherent sampled observation only, not a class-policy match.

Local52 tests pass11.274s; all47 named intended-assertion mutants pass with their
unmutated controls intact. The combined old diagnostic/policy plus new suite
passes141 tests22.714s. Earlier50/51 and139 executions retain their actual counts.
The first four mutation attempts exposed proof-harness issues (an earlier
assertion firing, nonviable mocks after removed guards, a finite fake clock and
an inherited fixture umask dependency); those attempts are not complete proof.
The final fixture sets private creation permissions only while preparing its
owned files and restores the caller's mask; its standalone022-mask control
passes. No exception or unrelated failure is counted as a kill.

The owned consumer reads an honestly prepared frozen-policy fixture through the
unchanged reader, with Journal/Gate constructors forbidden and unchanged file
snapshots. It fixes capture/data/table/envelope inputs beneath one literal
private temporary root, validates the actual caller/policy-root ownership, bounds
canonical single-link file input at8MiB, and forces file provenance scripted.
The table is fixture authority only, never B3 host-held pin provenance.
Local native evidence is the substituted child run with four PID-list calls and
real existing libproc/argv/hash/cwd primitives; no unpatched local full scan ran.
The native CI full-runner measurement remains pending and must refuse unknown;
no native full-scope or attribution positive is claimed.

Only three new step12 executable/proof files and four CI registration lines
change executable surface; every existing diagnostic, policy-binding, library,
Journal/schema/recover/D64, Gate/identity, host executable and timer byte is
unchanged from2615452b. Some cross-sample refusal predicates are dominated by
coverage/row equality/empty-unknown constraints; no equivalent single-predicate
removal is counted. The process-pass-reuse mutant and real four-list child
control pin actual collection, and all47 counted changes fail named assertions.

Exact-source review and exact-head CI are pending. The D220 row stays open;
B5/1.2 open/pre, B6–B9 held. Class matching, jobs/hold/overrides/fresh D60, durable
admission, attended manual/D175 and physical Mac/APFS/reboot histories stay later.
No production operation, resource provisioning, policy enrollment or admission.


### 2026-10-18 02:08 EDT — D220 sample/expiry proof and strict binding-UID correction

Claude245 reproduces source2393e724 as uid65534:52 ran with one native skip and47
intended kills with intact controls; it verifies the ten-file lineage, unchanged
existing executable trees and each kill's intended assertion. It requires two
proof additions: within-pass before/after equality can fail while union coverage
and cross-pass rows agree, and elapsed_ns above the window can be paired with a
false expired flag. Neither predicate is dominated. The earlier broad dominance
sentence is withdrawn; the new negatives and individual runner mutations pin both.
Only the specifically confirmed pass-B generation half and private symlink-leaf
literal check are treated as dominated; other unpinned cases are carried below.

Codex independently finds a strict-schema source defect: Python deep equality
lets a Boolean binding uid alias valid UID0/1. A scripted pure table with both
scope digests recomputed is recorded with that Boolean at2393e724; admission stays
false. The new test fails for both aliases before the fix. The validator now
checks the binding's exact key set and integer UID before equality, rejecting the
aliases without changing any ordinary observation or production authority.

Local55 tests pass52.273s;50 intended-assertion mutations pass with intact controls,
including the two required predicates and removal of the UID type check. The
combined suite passes144 tests41.351s. Earlier52/47,141 and139 executions retain
their own counts; this is a new run. No ERROR or unrelated failure is counted.
Only the new module's two binding-schema lines and its tests/runner change
executable bytes from2393e724; the existing workflow and all pre-existing runtime
paths stay byte-identical. No local unpatched full scan or production operation.

Superseded CI39101987342 was cancelled for this required correction, not
counted all-eight green. Its Linux117599965393 passed52/1.237s with one native skip
and47 mutants at merge430dd088f8dbce75813c7d7dff0ac28344d8d643, source2393e724 second
parent and identical whole tree; raw SHA256
df5bf9c247e7ca712efdecad62a1490b649c8d1d46adb88a3f78443da204f277.
That evidence is not the corrected55/50 proof. New-head review and CI remain
pending; the D220 row stays candidate/open. B5/1.2 open/pre, B6–B9 held, no class
matching, physical exclusion, eligibility, authorship or admission claim.


### 2026-10-18 02:41 EDT — owned process observation-envelope source verified (D221)

Source 89ae67dbe0057e308c8ae55674a21f8dfaa4247d passes all eight jobs in
[CI39103018309](https://github.com/moltyguibros-design/openclaw-node/actions/runs/39103018309).
Native job 117602984633 passes 55 tests in 5.192s and all 50
intended-assertion mutants with intact designated controls. Its unpatched CI
runner observation refuses while retaining the owned child in both passes:
1030 unknown entries and 6 refusal reasons. These are entries across
both passes, not distinct-process counts or a full table/per-reason measurement.
Linux job 117602984610 passes 55 tests in 1.091s with 1 native skip
and 50 intended mutations. Codex inspected both complete raw logs.
Native raw log: 62453 bytes, SHA256 33127936fb27349d8211f0bcddad436baa3457143422972721ec8b46fe55a6b9;
Linux raw log: 1512918 bytes, SHA256 315e20c6033272a8c2f88e75355b58ffdcca065eab5196a19d29b0798a175442.
Both name checkout merge 756766914c7aa7ac9da290cf7c205ba1e715e640, whose second
parent is the exact reviewed source and whose whole tree is identical to it.

Claude247 independently reproduces 55 tests (one native skip) and all 50
intended mutations as uid65534, with no required issue. Independent after-shorter sample and expiry probes fail the new assertions; removing the UID check is killed, and replay against 2393e724 fails both aliases without errors. Collected-path behaviour is unchanged. The added binding-key-set line is dominated by the following dictionary equality and is not counted as a mutant.
The within-pass sample equality and elapsed/expired consistency gaps from Claude245 are
pinned by coherent scripted negatives and individual mutants. The UID 0/1 Boolean
alias is rejected by an explicit integer check before binding equality; the old
source fails both cases and removal of the guard fails the new assertion.
Earlier 2393e724/52/47, 141 and 139 results retain their counts; cancelled run39101987342
is not counted green. Its Linux proof remains the earlier 52/47 only. Optional
validator/consumer/collector controls from245 and D218's six items stay in INVENTORY.

Only B5-D62-process-observation-envelope closes as an owned source prerequisite.
Recorded is complete coherent sampled observation, never class matching, boot
eligibility, authorship, history or admission. Four PID samples, strict unknown
retention, scope facts, both launchd reads and plist identities remain observations
under D189, not continuous/physical exclusion or loaded-image proof. The 120s
acceptance window cannot interrupt blocked calls; the 16-anchor limit and 8MiB
diagnostic-input bound do not change frozen-journal reader bounds. The private
fixture table supplies no B3 provenance. Local native runs used substituted
enumeration; no local unpatched full scan or production operation occurred.

B5/1.2 remain open/pre and B6–B9 held. Every executable that predated this unit,
including the diagnostic, policy binder, Journal/schema/recover/D64, Gate/identity,
host paths and timers, stays unchanged from 2615452b. No class comparator, jobs/
recorded hold/overrides/fresh D60 gate, durable admission, attended manual or D175
was implemented. Claude249/251 supply design input only for the next pure class comparator;
it needs its separate final pre-audit, exact field/attribution/count proof and
one bounded shared owned-reader extraction. Class consistency cannot imply a
stopped hold; jobs/hold/overrides/fresh D60 stay required. PID/generation/name
key-exclusion claims each need their own intended mutation mechanism. A valid
launchd expectation with count above one stays unsatisfied, without changing
the policy validator. Preserve anchor facts privately and bind the redacted
class report to the envelope hash; emit no policy or raw argv. No next-unit
implementation or closure follows the design input. Mac access/APFS reattach/reboot and four-history acceptance remain separate.
This receipt changes five Markdown records only; its own exact-head CI/review
remain pending at commit time.


### 2026-10-18 03:14 EDT — B5-D62-process-class-comparator candidate (D222)

Micro re-orient: step1.2/B5 stays open at v1.2-pre, B6–B9 held.
D221 verifies the owned observation-envelope source; its receipt e9efb244 now
passes all8 CI39104976663 and Claude253 is clear (255 acknowledges Codex's final
run measurements). Receipt-native55/3.848s/50, full runner refused with child in
both passes,1032 unknown entries and2 reasons; Linux55/1.813s/one skip/50.
Merge34b4bb0423d6b41ca4dc74714d1e2a561ab40f97 has receipt as second parent and
an identical whole tree. These final receipt-CI measurements are Codex's,
separate from Claude253's independently checked source-native proof.

This unit contributes only a pure process-class consistency comparison and its
real record-free owned consumer over that verified envelope and D218 policy.
The prevalidated policy comes from the unchanged frozen/image reader; this is
not an arbitrary-policy parser or a replacement D218 validator. Final pre-audit
is requested in Claude256; no comparator source/proof exists at this entry.

Goal: compare one complete coherent sampled envelope to the bound authored
class/attribution/count claims without granting eligibility or admission.
Needs: D221 exact-head source/receipt all8 green, clear247/253 reviews, unchanged
valid_envelope/binding/image_process_policy, and B1/D189 owned boundaries.
Feeds: jobs/recorded hold/overrides/fresh D60, then durable admission, attended
manual and D175. Class consistency cannot establish a stopped hold.
Verify: code: pure scripted positives/negatives with intended-assertion mutants;
owned frozen-policy consumer with no constructors/writes and unpromoted scripted
provenance; old envelope55/50 behavior; native owned-child substituted refusal
and CI-only full-runner refusal; exact-source review plus all8 CI, then a separate
five-Markdown receipt with its own review/all8 CI. No native positive is claimed.

Proposed contract: validate the envelope first, and refuse its non-recorded or
malformed state before class logic. Bind the report to the exact input's canonical
hash and policy hash. Keys are literal executable, on-disk SHA, NUL-joined argv
SHA, uid/gid/cwd. PID/PPID/birth/name are not cross-boot class keys. Sort observed
rows by birth then PID; attribute launchd rows to their actual policy-owner
namespace/label, running state, current generation and authored plist SHA.
Expected-parent rows need a strictly older included parent already uniquely
assigned the referenced label. Zero candidates is unexpected, multiple ambiguous;
counts are exact after assignment, never a count-solving permission. Launchd
count above one remains valid but unsatisfied. Empty policy matches no included
process. Carry source/coverage unchanged and always admission/history false.

No raw argv representation or policy is emitted; redacted fields may legitimately
overlap argv0/cwd, so tests pin dedicated secret sentinels rather than an impossible
ban on every argument substring (including empty arguments). Keep anchors private
in memory for the later jobs gate; the class report binds their envelope hash and
does not itself carry job-configuration evidence. Do not count dominated single
launchd checks as isolated kills; use coherent recorded wrong-row attribution,
non-running-with-PID and authored-plist mismatches for the relevant mechanisms.

File deltas: one new step12 process_class_comparator.py, its test and intended
mutation runner; four CI registration lines; bounded extraction of inspect_owned
into owned_envelope returning the same policy+envelope privately, with inspect_owned
returning the latter and only its policy-emission mutation anchor updated; these
six ledgers. No D218 binder, Journal/schema/recover/D64, lib, Gate/identity, host
executable or timer change. No production operation or local unpatched full scan.
Optional D220/D218 follow-ups stay carried. Mac access, native positive attribution,
full pipeline, APFS reattach/reboot and four-history acceptance stay separate.


### D222 pre-audit settled — Claude257, before source work

Claude257 clears the contract with two required precisions, adopted: every
unexpected entry carries its redacted process and class_candidates before
attribution; gate on valid_envelope's recomputed copy and use that copy's reasons,
while the hash binds the exact input bytes. Native child candidates must equal
its authored label exactly. Rows/report entries follow (sec,usec,pid) order.
Policy is the prevalidated reader argument; the optional redundant row-schema
check is not added. Optional D220/D218 controls stay carried.

The existing diagnostic.redacted helper only copies dict fields and replaces
arguments with the NUL-join digest; it performs no process-schema validation.
Expected keys can therefore project its actual output over the validated policy
row, reusing that exact helper instead of duplicating its hash expression. Tests
will pin that shared call and empty/non-ASCII/argv-boundary behavior.

Only the settled comparator/extraction surface now enters implementation. No
class comparator, jobs/hold/D60 gate, admission or production operation is claimed
by this pre-audit entry; source review/CI and the candidate row stay open.


### 2026-10-18 03:30 EDT — D222 local class-comparator candidate proof

The102-line pure comparator validates the envelope before expected or observed
class keys, gates on its recomputed outcome/reasons, and hashes the exact input
object plus prevalidated policy. It reuses diagnostic.redacted for expected argv
hashes, sorts rows by birth/PID, requires actual launchd namespace/running/current
generation/authored plist or an older uniquely assigned referenced parent, then
refuses zero/multiple candidates and exact count deficits/excess. Unexpected
rows retain pre-attribution class_candidates. Source/coverage come from the
recomputed envelope, so a forged full label cannot promote substituted/scripted
facts. Redacted reports emit neither policy nor raw argv or job-anchor tables.
Class-consistent establishes no stopped hold, eligibility, authorship or admission.

Local37 tests pass5.536s; all50 intended-assertion mutants pass with intact named
controls. Existing envelope55 tests pass8.781s and its50 mutants still pass after
the bounded helper extraction/re-anchoring. The combined diagnostic/policy/envelope/
class run passes181 tests21.429s. Earlier32/36 tests retain their actual counts;
the32 run failed one incomplete test fixture that correctly stopped at envelope
coverage. The first new mutation attempt left the argv-digest field unchanged
because of whitespace in its replacement; that partial run is not complete proof.
The corrected runner checks every replacement anchor and counts only the named
assertion failure, never ERROR or an unrelated failure.

The native owned C child is authored before spawn, observed through existing
libproc/hash/argv/cwd calls with only PID enumeration substituted (four calls),
and reports exactly its authored class candidate while refusing its absent
parent. This is a native attribution refusal, not an attribution positive.
Owned frozen-policy scripted positives pass through one shared reader; constructors
are forbidden, files remain unchanged, and file source/coverage stays scripted.
Only CI will perform the full-runner observation; no local unpatched full scan
or production service/VM/timer operation occurred.

Only three new files, four workflow lines, the envelope owned helper extraction,
its old policy-emission mutation anchor, and six ledgers change. Every pre-existing
envelope function except inspect_owned is AST-identical; valid_envelope, binding,
collector and all frozen/private reader checks remain unchanged. The extracted
body has the same first fixture gate and fences, returns the same policy plus
value privately, and inspect_owned returns its second item. No D218 binder,
Journal/schema/recover/D64, lib, Gate/identity, host executable or timer change.

Claude257 pre-audit requirements are adopted; exact-source review and exact-head
all8 CI remain pending. Only this owned source prerequisite may close after its
separate reviewed green evidence receipt. B5/1.2 remain open/pre, B6–B9 held.
Jobs/hold/overrides/D60, durable admission, manual/D175, native positive attribution,
full pipeline, Mac access/APFS/reboot and four-history acceptance stay later.


### 2026-10-18 03:50 EDT — D222 own-launchd-label proof correction

Claude259 independently reproduces ea87f6fa as uid65534:37 new tests/one native
skip/50 intended kills; old envelope55/one skip/50; combined181/three skips. It
confirms the twelve-file delta,30 unchanged envelope definitions and the identical
18-statement extracted body except paired returns. Source is correct, but it
requires a proof correction: removing name == key survives the37-test suite.
Two D218-valid launchd expectations can share a plist hash while differing in
label and class. Swapped running anchors are internally recorded facts; the
missing name filter then borrows the other label's matching generation and
wrongly reports class-consistent. This predicate is not dominated by validation.

Codex independently reproduces the surviving removal against the original37
tests (all pass5.676s), then adds the coherent shared-plist/two-label swap control.
The unchanged source refuses both rows, preserves their exact class_candidates,
assigns neither and reports both missing; the new single-predicate removal fails
that named assertion. D218 plist-hash uniqueness is not changed. The source,
workflow, envelope helper and old runner are byte-identical to ea87f6fa.
Only the new test/runner and six ledgers change in this correction.

Local38 tests pass6.733s;51 intended-assertion mutants pass with intact controls;
the combined suite passes182 tests32.091s. Earlier37/50 and181 runs retain their
counts. Superseded CI39107975073 is cancelled for this required proof, not counted
green. Its Linux117617833935 separately passed37/0.470s/one native skip/50, raw
1517497 bytes SHA256145e23cafa336aad6cd1445b9088836f12aebe0e8d13a4e516bb95be694e8817,
checkout4699d64b4786eeadf6716faa12c207d8605dac16 with ea87f6fa as second parent
and an identical whole tree. It is not the corrected38/51 source proof; no native
result is claimed for that cancelled job.

The native CI test now asserts each process pass is non-null before indexing,
turning that failure mode into an explicit assertion. CLI early exceptions can
return a minimal refusal without phase/hashes; no class-consistent result follows.
Claude259's five forbidden-key mutations share the observed7-tuple mechanism;
they are counted, not discriminating, while the separate field positives pin the
contract. Pass-B instead of A, PID instead of generation equality and dropping
loaded are equivalent under recorded input, not gaps or counted extra kills.
D220/D218 optional controls remain carried.

Corrected exact-head source review and CI are pending; D222 stays open, B5/1.2
open/pre, B6–B9 held. Runtime/operational boundaries remain unchanged. No local
unpatched full scan, production operation, policy enrollment, hold eligibility,
loaded-image/history/physical proof or admission is added or claimed.


### 2026-10-18 04:25 EDT — owned process-class-comparator source verified (D223)

Source 39638d1edb6f41aadf217bf3a2c2c92a4e368c7f passes all eight jobs in
[CI39109210059](https://github.com/moltyguibros-design/openclaw-node/actions/runs/39109210059).
Native job 117621494888 passes 38 tests in 3.673s and all 51
intended-assertion mutants with intact controls. The substituted owned C child
matches exactly its pre-authored class label but refuses its unobservable parent;
there is no native positive attribution claim. The CI-only unpatched full-runner
observation refuses at the envelope with the child in both passes, 1092
unknown entries across those passes and 2 envelope refusal reasons.
Those are entries, not distinct-process counts or a full table/per-reason measure.
Linux job 117621494877 passes 38 tests in 0.503s with 1 native skip
and all 51 intended mutations. Codex inspected both complete raw logs.
Native raw: 67213 bytes, SHA256 0f56bad260131e3d95c38a9a65cee18f7446dc997c87282f6edd5350bb1986a1.
Linux raw: 1517552 bytes, SHA256 5db3b98478024f56063f51061c8b5d1491ddfc2c434edb3715e20f2ec3d42819.
Both logs name checkout merge f50f74a8712d9a15822f21fa25ed6362b81954cb; its second
parent is the reviewed source and its whole tree is identical to that head.

Claude261 independently reviews the exact source with no required finding.
It reproduces38 tests (one native skip) and51 intended kills as uid65534, plus old envelope55/50 and182 combined tests (three skips). Its exact guard-removal replay now fails only the new shared-plist swap assertion with no ERROR; D218 validation and a recorded envelope are independently confirmed. Comparator/helper/old proof/workflow blob ids equal ea87f6fa, and the eight-file proof-only correction and six identical ledger blocks are verified. No new required or optional finding remains. Linux raw logs beyond the connector’s last5000-line window remain Codex’s observations; the independent source reproductions stand separately.
The own-label check was already correct; the required shared-plist swapped-label
control now pins its removal with one additional intended assertion. Comparator runtime,
workflow and helper bytes remain identical to ea87f6fa. Superseded CI39107975073
was cancelled for that proof, not counted green; its Linux37/50 and earlier181
remain those executions, never relabelled as the corrected source proof.
The five forbidden-key mutants share a7-tuple mechanism, counted but not
discriminating; per-field positives are separate evidence. Pass-B for A, PID
for generation and dropping loaded are equivalent for recorded input, not gaps
or additional kills. Minimal CLI early-error refusals may omit phase/hashes.
The native CI pass-null condition is now an explicit assertion. D220/D218 optional
items remain carried; no equivalent or ERROR-only mutation is counted.

Only B5-D62-process-class-comparator closes as an owned source prerequisite.
Its concrete consumer reaches the existing frozen-policy and envelope path once,
then validates and compares without another census, file write or constructor.
The envelope validator/binding/collector/private-reader bodies are unchanged;
only the bounded owned-helper extraction and old policy-emission mutant anchor
changed the preceding unit. D218 binder, Journal/schema/recover/D64, lib, Gate/
identity, host executables and timers remain unchanged. This receipt changes
five Markdown records only, with all executable/test/workflow bytes fixed.
Its own exact-head CI and independent review remain pending at commit time.

Class-consistent means exact sampled class/attribution/count consistency against
a prevalidated authored claim. It does not establish a stopped hold, loaded-job
configuration agreement, boot eligibility, completeness, policy authorship,
historical independence, loaded executable image or admission. Exact input hashes
bind received claims; recomputation decides envelope eligibility for comparison.
Source/coverage are not promoted, unknown or unstable evidence refuses before
class work, and admission/history remain false under D189. Scripted positives
stay scripted; the private fixture table supplies no B3 protected provenance.
The 120s window cannot interrupt blocked calls, and the 8MiB diagnostic input bound
does not widen frozen readers. Local native enumeration was substituted; no local
unpatched full scan or production service/VM/timer operation occurred.

B5/1.2 remain open/pre and B6–B9 held. The next pre-audit scopes the smallest jobs/recorded hold/overrides/fresh D60
prerequisite; observation, comparison and durable admission remain separately
reviewable before attended manual and D175. Native positive attribution/full pipeline, Mac access,
APFS reattach/reboot and four-history acceptance remain separate. No production
admission or runtime operation follows this source evidence receipt.


### 2026-10-18 05:16 EDT — owned held-job negative comparator pre-audit (D224)

Micro re-orient: B5/step1.2 stay open at v1.2-pre; B6–B9 held.
D223 source39638d1e/receipt907046d9 have clear261/265 reviews and all8 exact-head
CI39109210059/39111452945. Receipt native38/2.788s/51; full runner refused with
child in both passes,1036 unknown entries and2 reasons; Linux38/.504s/one skip/51.
Merge75c377af0dd4e8269e575fc2b9311819242bd3f3 has receipt second parent and equal
tree. Later receipt-CI facts are Codex's;267 preserves that evidence separation.

Pre-audit correction269: the optional launchd-command comparator does not feed
the held-cohort gate because D218 forbids its labels/commands. Its uncommitted
candidate is replaced before source work; no command-comparator source exists.
The actual frontier is a pure held-cohort negative-job comparator. Claude271
clears request270 at exact907046d9 with the following corrections adopted.

Goal: one scripted negative-job consistency result for every verified managed
label in gui/recordedUID, user/recordedUID and system, without admission.
Needs: D223 clear source/receipt all8 CI, unchanged frozen/stopped readers,
valid_job, complete full-node fixture and B1/D189 owned boundaries.
Feeds: the later full managed-job current-boot collector, then overrides/fresh
D60 and integration with strict process gates before durable admission/manual/D175.
Verify: code: coherent portable/scripted positives and independent four-bucket,
UID/key derivation, ordering, hash/privacy and intended-assertion mutations;
real owned frozen-image reader/CLI with and without policy, no constructors/writes,
unchanged prior regressions, exact-source review/all8 CI then a separate reviewed
all8-green five-Markdown receipt. runtime: none. Native execution is scripted
reader portability with no skip, never a live launchd/process or held-state claim.

compare_held_jobs(records,jobs) takes records already verified by the unchanged
frozen verifier; it is not a journal parser. That verifier already proves prior
and CAPTURE completeness, held_as_checkpointed, all unloaded observations and
empty final loaded inventory. These dominated predicates are reused, not counted
as new proof or new intended mutants. Derive labels only from verified prior,
using ai.openclaw.+unit; no timer-only, original-domain or policy-anchor filter.
Derive all three namespace keys from that count (currently23 units/69 keys), with
no16-anchor cap or hard-coded unit count. Owner UID is strictly int>=0 from
scheduler-heartbeat.execution_hold.metadata_identity.uid, refusing absent/bool;
this is D218's namespace-owner convention, not a caller-derived permission.
The consumer requires nonempty stopped-reader metadata and every read UID equal
to the recorded UID, without using os.getuid for that binding. Older records
without this owner field refuse; no runtime/schema change supplies it here.

Jobs is a string-keyed JSON object. Missing expected keys are missing; outside
keys are extra without interpreting their shape or value; malformed present
expected facts are unknown {key,error_type}, catching only valid_job's Refused.
A well-typed loaded job is unexpected_loaded regardless of state or PID. Only
exact {loaded:false} is negative. Each bucket is retained/sorted and independently
pinned; no basename, command, process or loaded-idle exception. Report exact
encoded(jobs) SHA, baseline and verified checkpoint digests; literal scripted
source, sampled true/continuous false and admission/history/hold_certified false.
Only all four empty yields held-jobs-negative-consistent. No job values, program,
argv digest, plist path, policy or full table is emitted; optional baseline
process_policy is ignored. No timing budget is inferred from the envelope.

Owned consumer: --fixture AND --scripted before any IO; private/literal owned
temp root openclaw-owned-held-jobs-16hex, root/capture/data checks and unchanged
read_private for table.json and held-jobs.json (8MiB diagnostic, not frozen-reader
widening). Copy image_process_policy's pin-coherence sequence textually; pins
precede one read_inputs, then one verify_frozen_checkpoint, then owner binding,
job-file read and compare. A frozen-verifier refusal must prevent compare and is
pinned by an order-swap mutant. Canonical redacted CLI stdout;0 only narrow
consistent,2 refusal, minimal early-error shape accepted. No process_policy need,
new census, Journal/Gate construction or write. The policy-free honest fixture
with recorded owner was read and frozen-verified locally:23 units,54 reads/uid501.
The first prototype asked the fixture for missing binary/home attributes and
failed; the corrected prototype uses read_inputs' actual returned fields.

Deltas: three new held_job_negative_comparator/module-test-mutator files,
four workflow registration lines, six ledgers. Existing executable/test/mutator
bytes stay fixed. No Journal/schema/recover/D64/lib/Gate/identity/host/timer change.
B5/1.2 stay open/pre; row close waits for source and separate receipt review/CI.
No live observation, inventory/overrides/D60, hold/physical absence, eligibility,
authorship/history or admission. No production operation. Optional D220/D218
controls stay carried. Later69-key double sampling at10s per call can exceed20min;
120s cannot be inherited, and system-domain unreadability must stay unknown.
Mac access, APFS reattach/reboot and four-history acceptance remain separate.


### 2026-10-18 05:23 EDT — D224 local held-job comparator candidate proof

The new97-line record-free module consumes prevalidated frozen records and an
explicit scripted job table, derives every managed label in all three domains
from prior and the recorded owner UID, reuses valid_job, and retains sorted
missing/extra/unknown/unexpected_loaded buckets. No optional policy is interpreted.
Malformed expected facts are unknown; extra keys are retained without parsing
key shape or value. Every well-typed loaded job refuses, including idle without
PID. Exact jobs/baseline/checkpoint digests bind the claims; no job values or
policy are emitted. No live node or execution-hold assertion is made.

Local31 tests pass10.692s;44 intended-assertion mutants pass with intact named
controls and no ERROR-only kill. Existing182 process regressions pass21.580s.
The earlier30-test run passed6.477s. The first mutation attempt rejected a
zero-UID guard mutant through a Refused exception rather than its intended
assertion; it is not counted and the real zero-UID positive stays a non-counted
control. The prior42-mutation run passed before adding explicit verifier skipped/
duplicated controls and an owned-root owner mismatch check. Scope and false
claim flags, recorded UID type/carrier, all domains/member1/federation, each
bucket/verdict, idle/malformed loaded, hash/privacy, pin-before-read, exactly one
read/verifier, verifier-before-compare, every read owner and CLI exits are pinned.

The actual owned consumer succeeds with and without a process policy, requires
both flags before IO and the literal private fixture root/files, copies the
existing pin-coherence sequence textually, and runs one read_inputs followed by
one verify_frozen_checkpoint before owner binding/job-file read/comparison.
Constructors are forbidden in the observation test; before/after files match.
Bad checkpoint/receipt, ownership, mode, alias or canonical input refuses through
unchanged readers before comparison. No existing executable/test/mutation runner
changes; only the three new files, four CI registration lines and six ledgers.

Frozen record completeness/held_as_checkpointed/all-unloaded inventory are
upstream verifier proof, not new comparator predicates or counted mutants.
Native CI will execute the same31 scripted checks/44 mutations with no skip;
there is no live job/process observation or new native full-scan measurement.
Source exact-head review/all8 CI remain pending, followed by the separate
five-Markdown receipt review/all8 CI before this owned row closes. B5/1.2
remain open/pre, B6–B9 held; D64/Gate/installed timers/production unchanged.
Full managed-job collection, overrides/freshD60, process-gate integration,
durable admission/manual/D175 and physical Mac/APFS/reboot gates remain later.


### 2026-10-18 05:35 EDT — D224 consumer recorded-owner proof correction

Claude273 independently reproduces exact104d808e as uid65534:31 tests/no skip,
44 intended kills/intact controls,182 prior process regressions/three skips.
It confirms the97-line source correct, the10-file/1332-insertion delta, unchanged
pre-existing executable/test/mutator bytes, identical six-ledger blocks and pin
sequence, full-node preconditions and every claimed source ordering/bucket fact.
It requires one proof correction: replacing the ownership tie's recorded uid
with envelope.os.getuid() survives all31 tests and accepts a constructible frozen
image whose recorded owner is foreign but whose files belong to the runner.

Codex independently reproduces that surviving substitution against the original
31 controls: all pass6.746s. The new control patches only the existing fixture's
recorded_hold metadata UID to runnerUID+1 before the honest journal/commit/capture
flow. The real frozen reader verifies this policy-free chain; every returned
file UID is runnerUID. The unchanged source refuses reader ownership and never
calls compare. The one targeted ownership-tie substitution now fails the named
foreign-owner refusal assertion, not through ERROR. Local32 tests pass11.587s;
45 intended-assertion mutations pass with intact controls. Comparator/runtime,
workflow and all existing source/proof files remain byte-identical to104d808e.
Only the new test/runner and six ledgers change in this correction. The separate
182 local regressions/21.580s are the earlier unchanged-runtime run, not a new run.

Superseded CI39115186066 was cancelled for the required proof, never counted
all8 green. Its completed Linux117639445757 separately passed31/1.597s/no skip/44;
raw1521527 bytes SHA2565ee0980f5397e4f683e13f26b22e453fdf091c38e6d7dee038fd02cbbd5a412b,
merge2042217fa6bfcfaa79d34d9247a1d0aa4a01d3b9 with104d808e second parent and equal
whole tree. No completed native result is claimed for that cancelled run.
The earlier30/42 and rejected ERROR-only control retain their historical counts.

Claude273's optional weak verdict needle is strengthened to loaded-key-refusal
wording without adding a count. Job-file read-after-owner ordering and the
root-name/temp-parent predicates remain source facts but non-discriminating
controls, carried as optional follow-ups; the string-key boundary is tested but
not a counted mutant. Deriving labels from UNITS and dropping the verifier-digest
override are equivalent for prevalidated records, not gaps or additional kills.
No new source predicate, schema, reader, timer, hold or admission behavior changes.

Corrected exact-head review/all8 CI remain pending, followed by the independent
five-Markdown receipt review/all8 CI before only this owned row closes. B5/1.2
stay open/pre,B6–B9 held; source remains scripted-only and all live observation,
overrides/D60/process integration/durable admission/manual/D175/physical gates
remain later. No production operation, caller-UID permission or release occurs.


### 2026-10-18 06:11 EDT — owned held-job negative comparator source verified (D225)

Source d5d6aefd468a6b47c1f969e5bbc50868c864fcc1 passes all eight jobs in
[CI39115988725](https://github.com/moltyguibros-design/openclaw-node/actions/runs/39115988725).
Native job 117641759357 executes 32 scripted tests in 2.258s with no skip
and all 45 intended-assertion mutations with intact controls. These are
scripted frozen-reader portability controls, not live launchd/process observations
or a new full-scan measurement. Linux job 117641759535 executes 32 tests in
1.726s with no skip and all 45 mutations. Codex inspected both complete
raw logs: native 71429 bytes, SHA256 ba222634b29d04560a1c0b5ae5ec35161e95c0b019e03be49251bd205e5fa4fd;
Linux 1521650 bytes, SHA256 0aa2783a5368e096f9bea7a0e9f7eb99cc92d491782dd228f056dcdeb2b6ab2e.
Both logs name checkout merge fa40a7df4e88c60250734a6f9c6e9624f1c2f045, reviewed source
as its second parent and an identical whole tree.

Claude275 independently reviews the exact source with no required finding.
Claude273 found the source correct and independently reproduced31/44 and182 prior regressions as uid65534, requiring the consumer recorded-owner proof. Claude275 independently reproduces32 tests/no skip and45 intended kills on the corrected full-tree export. Its exact runtime-UID replay passes all original31 but fails only the new foreign-owner assertion in the corrected32, with no ERROR. The eight-file proof-only correction, unchanged comparator/workflow/prior executable and proof blobs, six identical ledger blocks and carried optional controls are verified. No new required finding remains; optional job-read/root-name/temp-parent/schema controls remain non-discriminating and equivalent predicates are not counted. The superseded Linux raw digest remains Codex-only because its connector exposes only the last5000 lines.
The comparator and workflow bytes remain identical to104d808e; only proof and
ledgers corrected its recorded-versus-runtime consumer UID coverage. Claude273
required that constructible false-acceptance control; the original31 controls
independently let the substitution pass, while the new honest foreign-owner
fixture and counted mutation pin the unchanged predicate. Superseded
CI39115186066 was cancelled for that proof and is not counted all8 green; its
completed Linux31/44 remains that older run, with no completed native claim.
Optional job-read ordering/root-name/temp-parent/schema controls remain carried,
and the verdict needle is strengthened. Equivalent predicates are not counted.
The final local 32-test/45-mutation proof and the separate182 prior process
regressions keep their actual run counts. Earlier30/42 and the partial rejected
ERROR-only zero-UID counterfactual are not relabelled as final proof. Zero-UID
positive and frozen record preconditions are non-counted controls. Upstream
record completeness, held_as_checkpointed and unloaded CAPTURE inventory remain
the unchanged frozen verifier's proof, not new comparator predicates or kills.

Only B5-D62-held-job-negative-comparator closes as an owned source prerequisite.
Its concrete record-free CLI requires both fixture/scripted flags before IO,
private literal owned inputs, pin coherence before one stopped-image read and
one frozen verification, then recorded-owner equality for every metadata row
before job-file read/comparison. It works with or without optional baseline
process policy. Labels derive from all verified prior units in all three owner
namespaces, not timers or policy anchors. Missing/extra/unknown/loaded facts are
retained; idle loaded/no-PID is not a negative. Exact jobs and frozen digests bind
the received claims, and reports emit no job values or policy. All existing
executable/test/mutation files remain unchanged from907046d9; only the three
new source/proof files, four workflow lines and six ledgers implement this unit.

This establishes scripted negative-job consistency for fixed labels/domains,
not current node state, process absence, complete installed/loaded entrypoint
inventory, disabled overrides, fresh D60, a live execution hold, eligibility,
authorship, historical independence, physical exclusion or admission. D189 and
unprotected owned fixture limits remain. Owner metadata absence refuses; no
caller UID fallback or schema change supplies it. The consumer performs no census,
local unpatched scan, Journal/Gate construction, write or installed timer change.
The optional launchd-command comparator was deferred at pre-audit269, not built.

B5/1.2 remain open/v1.2-pre and B6–B9 held. The later full managed-job collector
needs current-boot complete-domain facts and its own timing budget; double69-key
reads with10s calls can exceed20min, so it cannot inherit the120s envelope window.
Unobservable system-domain reads remain unknown. Overrides/freshD60, integration
with strict process gates, durable admission/manual/D175, Mac access/APFS/reboot
and four-history acceptance remain separate. No production operation or release.
This receipt changes five Markdown records only; executable/tests/workflow bytes
remain fixed. Its own exact-head review and CI remain pending at commit time.


### 2026-10-18 06:46 EDT — managed-job observation pre-audit candidate (D226)

Micro re-orient: B5/1.2 remain open/v1.2-pre; B6–B9 held.
D225 receipt956f6c03/source d5d6aefd have all8 CI39118302426/39115988725
and clear279/275 reviews. Receipt native32 scripted tests/45 mutations; its
complete-log/tree evidence is Codex's, separately acknowledged by Claude281.
Only scripted negative-job consistency closed; current-boot managed-job facts
remain absent. No local production-label scan or production operation is authorized.

Goal: one complete, bounded, current-boot managed-job observation envelope.
Needs: D225 reviewed green source and receipt; unchanged expected_keys/owner_uid,
launchd_service, redacted_job/valid_job, boot_identity, private frozen readers
and the honest full-node owned fixture; B1/D189. All exist at956f6c03.
Feeds: later combination with the held-negative comparator, then overrides/fresh
D60, strict process-gate integration, durable admission/manual restoration/D175.
Verify: portable scripted collector/validator and real frozen-reader consumer
controls, decisive named assertion mutations, isolated macOS CI observations,
exact-source review/all8 CI and a separate reviewed green five-Markdown receipt.
No production runtime verification or live hold/eligibility/admission claim.

Pre-audit request282 is pending. Proposed surface: three new managed_job_observation
module/test/mutator files, four CI registration lines and these six ledgers.
No existing executable/test/mutator changes, no shared census primitive/parser,
Journal/schema/recover/D64/Gate/identity/host/timer change. VERSION stays pre
because the enclosing step has not met its live exit gates.

Proposed observations derive every managed label and all gui/recordedUID,
user/recordedUID and system keys from verified prior, with no policy/timer
filter or16-anchor cap. Two complete sequential launchd_service sweeps retain
per-key typed redacted facts or errors; only the shared parser's exact absent
service return is unloaded. System/domain unreadability and timeouts stay unknown.
Boot identity brackets and a separately reviewed30-minute acceptance-only
budget are proposed, not a hard deadline:138 ten-second calls can take23 minutes
and boot_identity itself has no subprocess timeout. No120s inheritance.
Expiry must stop further job acquisition and retain every unsampled key.
Loaded/idle facts may be recorded, never interpreted as held negatives here.

The validator will rederive frozen binding/key coverage, schema, boot, budget,
unknown and two-sweep agreement; stored outcome cannot authorize anything.
Serialized facts contain argv digests, never raw arguments. No continuous,
physical absence, process generation/attribution, complete entrypoint inventory,
overrides, freshD60, hold, history/authorship or admission claim. D189 applies.
The actual schema/budget/provenance and native boundary await282's review.

The intended real CLI remains --fixture AND --scripted before anyIO, consuming
private literal owned inputs and copied pin-coherence followed by one read_inputs,
one frozen verification, then every read owner tied to recordedUID. It cannot
turn an input file's observed claim into live authority. No constructor or write.
A prepared temp image cannot prove host isolation; a collector library and
isolated CI-owned native harness are proposed, with no local unpatched scan.
Mac access/designation, APFS reattach/reboot and four-history acceptance stay
separate. Optional D218/D220/D224 controls stay carried, not silently closed.


### D226 pre-audit settled — Claude283, before source work

Clear to implement the smallest live half of the held-job gate, with structural
boundary: inspect_owned/main require fixture AND scripted before input IO and
never call the collector. owned_records supplies only frozen records/digest;
collect_jobs is called live only by the test harness's darwin/GITHUB_ACTIONS
branch. That branch is an isolation convention, not environment attestation.
No operator-gated live path is added. The requested two-replacement mutant must
relax flags AND wire collection, and the CLI-with-fixture-only control must
assert refusal and zero census calls.

Use structured (namespace,label) pairs from owner_uid and every prior unit,
never parse keys back into domains; assert their keys equal expected_keys.
Each job entry is either unchanged valid_job shape or exact error_type string.
Catch only envelope.ERRORS, including TimeoutExpired; malformed loaded/arguments
become errors, never unloaded. On budget expiry retain every remaining key in
both sweeps with BudgetExpired, no further census call.30min WINDOW_NS is an
acceptance-only budget checked before each call and after boot_end; validator
recomputes expired from elapsed. Pin30min >=2*keycount*shared10s timeout for the
fixture so cohort growth cannot silently outgrow it. boot_identity has no timeout.

Exact four stages boot_start/sweep_a/sweep_b/boot_end, all present, failures empty,
not expired, two equal hex64 current boot values, complete exact key coverage,
no per-key errors and equal sweep values are required for recorded. Bind exactly
baseline/checkpoint digests and recordedUID, reject typed aliases; baseline boot
is not an expectation. Loaded/idle facts may be recorded; no held-negative verdict.
Stored outcome/reasons never trusted. Scripted input is private/bounded/canonical,
source forced scripted, file source/coverage retained only as sample_labels;
coverage sampled true/continuous false/physical false, admission/history/hold false.
Only recorded/refused vocabulary, no raw arguments. Native CI prints real outcome
and error histogram, asserts coverage/shape only, no native positive assumed.
Per-key/domain/error/timeout/expiry/order/schema/provenance and owner/frozen-path
controls get named intended assertion mutants; no ERROR-only kills. Optional
shape-compatibility control may feed a recorded scripted sweep to the unchanged
negative comparator; this is not full integration. Per-sweep timing and loaded
summary are deferred. Plist digests/overrides/freshD60 remain outside this unit.


### 2026-10-18 06:57 EDT — D226 local managed-job observation candidate proof

The202-line module implements the settled283 boundary: the actual record-free
CLI requires both flags before any input IO and never references collect_jobs.
owned_records copies the unchanged pin-coherence sequence, reads once, frozen-
verifies once and ties every nonempty read metadata row to the recorded UID.
Only the CI-only native test branch composes that path with the live collector.
Environment/fixture claims do not attest isolation; no local unpatched job scan
was run. Source and script inputs remain unprotected under D189.

The collector builds structured namespace/label pairs, cross-checks expected_keys
and records two ordered complete-key sweeps, current boot brackets, elapsed
acceptance budget and every per-key error. Exact shared absence is the only
unloaded return; loaded/idle facts are recordable. TimeoutExpired is retained;
programming errors outside envelope.ERRORS propagate. Expiry prevents more
launchd calls and fills all remaining keys with BudgetExpired. Thirty minutes
is independent of the process120s budget; boot_identity has no timeout and the
limit cannot interrupt an in-flight call. The growth control compares2*keycount
*shared10s against this limit. Plist identities, generations, overrides and D60
are not acquired. No process attribution/absence or live hold can follow.

Pure validation recomputes exact frozen binding, typed UID, four-stage presence,
complete key coverage, both boot and sweep equality, errors/failures and expiry;
stored verdict/reasons cannot control recording. Source/coverage/certification
claims are constrained. The real private canonical bounded file consumer forces
scripted provenance and retains only bounded source/coverage sample claims.
Raw argv is digested through the shared redactor and never serialized. The
optional shape control feeds a scripted sweep to the unchanged negative
comparator without claiming full integration. Reports say recorded/refused only.

Final local34 tests pass15.367s with one intentional CI-only native skip;
55 named intended-assertion mutants pass with intact controls and no ERROR-only
kill. Prior214 process/policy/envelope/class/held regressions pass42.920s with
no local skip. Earlier34-test6.862s and33-test13.948s runs retain their counts;
the final in-method extra sample-label control is included in15.367s.
Initial32-test7.074s run had one error: the unchanged redactor's equality shortcut
lets numeric0 resemble false until valid_job. The collector now invokes valid_job
immediately inside its primitive-failure bracket, recording malformed facts as
errors. The corrected32-test7.256s passed with the CI-only skip. No shared helper
was changed. The first mutation attempt stopped after one kill because a genuine
missing-domain assertion used a different needle; it is not a final full run.
Expected pairs now derive independently from the unchanged held-key helper.
The54-kill run predates the final bounded sample-label schema control;55 is the
final count. Per-domain/unit omissions require removal of the independent pair
coverage guard too; these are explicit two-replacement variants, not single
predicate kills. The live-CLI variant also deliberately relaxes flags and wires
the collector in, as283 required. Shared frozen/record/key preconditions remain
upstream proof, not newly counted predicates.

Delta: three new module/test/runner files, four workflow lines and six ledgers
including the B5 frontier row reconciliation. Existing executable/test/mutation
bytes stay fixed. Local plan-lint14 PASS/1 old idle-version WARN/0 FAIL.
Promised collection/schema/CLI/proof/registration/ledger deltas all land; no
Phase-8 scope expansion. Required source review and all8 exact-head CI remain
pending, followed by a separate five-Markdown reviewed green receipt before
this owned row closes. Native CI will measure only fixed-label job facts and
print actual outcome/error histogram; it need not record successfully. This is
not the earlier process full-scan evidence, which retains its original scope.
B5/1.2 remain open/pre,B6–B9 held; D64/Gate/installed timers/production unchanged.
Full hold/overrides/freshD60/process integration, durable admission/manual/D175,
Mac access/APFS/reboot/four-history acceptance remain separately gated.
