# Node state recovery — decisions

## D1 — Independent preservation (2026-09-28 07:36 EDT)
The operator authorized complete review/repairs with Claude as adversarial collaborator. Viewer 1.6 remains open for production browser acceptance. This supporting silo permits independent preservation while keeping that unfinished outcome explicit. It feeds node-readiness 1.3; no automatic chain is enabled.

## D2 — SQLite snapshots and isolated restoration (2026-09-28 07:36 EDT)
Pin read-only source transactions and use SQLite's backup API, never a raw live DB/WAL copy. Load installed sqlite-vec directly, avoiding application initialization that can migrate/rotate/vacuum state. Compare integrity, schema, user_version, counts and typed content hashes. Keep transcript contents private; publish sanitized acceptance. Private permissions apply before creation.

## D3 — Both bus histories (2026-09-28 07:36 EDT)
Standalone and cluster names overlap but histories differ. Online snapshots miss offline R=1 collaboration/plan data on member 1. Preserve all four physical stores while servers are stopped, then verify on independently routed loopback instances. No union, requeue, deletion or topology change during preservation.

## D4 — Individual snapshots do not prove coordinated recovery (2026-09-28)
Claude identified the coupling between SQLite cursors and JetStream durable acknowledgements. Step 1.1 proves recoverability per store; 1.2 proves the bus histories. New step 1.3 takes their final coordinated set under verified writer quiescence before parent topology repair. Each individual snapshot records its own time window; no globally consistent point is inferred from sequential live copies. Native virtual-table checks run only on declared isolated restores. Source connections load no extension. Self-vector queries accept distance-zero duplicates, since tied results need not choose the probe's identity first.

## D5 — Complete application recovery includes file sources (2026-09-28 08:45 EDT)
Claude accepted child 1.1's SQLite outcome. It does not cover raw session JSONL,
gateway memory-source files, the vault, tokens/configs, notification ledger,
foreman timelines or browser profiles. Step 1.3 must label every store as primary
or derived and include or explicitly exclude these source families in the common
quiet window. Browser vendor state remains excluded from 1.1 only; its coordinated
recovery policy is not silently inherited. ENOENT caused by atomic file churn
currently refuses scans safely; handle it without weakening missing/unknown-store
refusal before the coordinated run. On-disk copies are logical rollback points,
not proof against machine or disk loss.

## D6 — Preserve split bus histories before repair (2026-09-28 08:58 EDT)
Claude Message 70 challenged the sequence. Step 1.2's Needs now requires intact
offline directories, not its own future preservation output. Installed live
units all run the same NATS 2.12.6 binary; the observed member-1 failure is the
monitor bind on 8222, before JetStream recovery. Reconfirm immediately before
operations. After owned fixtures pass, boot out this failing unit and copy its
unopened store first. Persist the non-serving member
hold with `launchctl disable gui/$UID/ai.openclaw.nats-1` and verify it using
`print-disabled`; bootout alone would reload at login and race with standalone.
Keep it disabled until topology 1.4, instead of restarting its failure loop. This reversible
service hold is within the operator's authorized repairs; no stream is deleted
or merged. For the remaining cold copies, drain all clients/timers, stop members
2/3 before standalone, and resume standalone first. Clone routes use fresh
loopback ports, explicit route credentials and no_advertise. Masters are never
server-opened. Replica/TTL overrides affect only isolated recovery, are recorded,
and never become production configuration. File-source coordinated recovery
remains child 1.3; per-stream snapshots are not a common recovery point.

D6 review correction (2026-09-28 09:32 EDT): Claude Message 74 independently
confirmed that deleting an offline stream assignment through survivors causes
its owner to erase the R1 working history on rejoin. Never delete the offline
COLLAB/PLANS assignments. The hold is reversible with enable only after topology
1.4 has independently verified preservation and uncontested listeners.

## D7 — Admission-fenced, reboot-resumable preservation (2026-09-28 21:33 EDT)
Claude demonstrated that sampled zero clients misses millisecond writers and
failed logins. Replace the old managed-window script; do not weaken it into
acceptance. Bind each server by ID/start/config digest and physical listeners.
After named observer closure use HTTP only, cumulative admissions, open/closed
CIDs, JetStream API counters, stream policy/state and durable positions through
every stop. Producer-first stops and actual owner/descendant/queue evidence are
required. A private fsynced journal records intent before each mutation and
retains incomplete copies without an acceptance manifest. Preserve persistent
service holds across a reboot and restore their original loaded/running/disabled
state only after truthful readiness checks; member 1 remains held under D6.
A reboot invalidates the quiet window, not permission to restore the prior node.
Crash recovery and independent older stream snapshots are not a common point.
Worker reboot policy and the unready deploy listener feed parent readiness 1.5
and 2.2; they are not silently repaired or called ready in this preservation step.

## D8 — Reboot restoration and deploy-listener ordering (2026-09-28 22:16 EDT)
Claude's35e56ff review refines D7: normal serving/client units use temporary
bootout-only holds. Member1 remains the sole persistent disable. A reboot can
then restore ordinary jobs; it invalidates the copy window and any partial
master, which must never receive acceptance. Durable recovery first observes
each affected unit and records already-restored owners without restarting them.
Only a known mismatched state permits an idempotent restoration; unverified
readiness refuses. The final check requires physical4222/8222 ownership and
the member1 disabled/unloaded hold. The deploy listener resumes last after
current deploy-marker/HEAD checks, because it can restart other owners. Timers
loaded with RunAtLoad must finish their initial run successfully before the
ready callback compares their originally idle state. These remain operational
gates, not proof supplied by a journal or generic callback alone.

## D9 — Full-baseline restoration after any interruption (2026-09-28 22:43 EDT)
Claude reproduced six journal faults on6659ef1. Recovery now observes every
baseline unit, including a RunAtLoad=false worker with no stop intent. Any
reopen is restore-only; a truncated forensic tail never authorizes continuing
its window. One fixed node lock and an unresolved-state fence cover different
journal roots. Baselines are read back and copied beside that lock. Classes
separate daemons, idle timers, preserved known-broken loops and held member1.
Immutable service identities must match before and after restoration; physical
running-process binding still belongs to the managed driver. The final hold/
listener check always runs, including after unit failures. Disk write failure
allows verified baseline restoration with explicit undurable diagnostics and
no success/acceptance claim. Missing/corrupt primary history may use the valid
secondary baseline in that degraded mode; if neither copy is valid, no static
unit-default inference is authorized. Sealing pins one uninterrupted window's
final hash and prohibits later writing. Darwin boot-session UUID replaces
localized boottime text. Fullfsync is requested for journal records/directories,
with host/hypervisor power-loss survival explicitly unproved. The old duplicate
restore_prior path is removed. Managed owner controls and cold-copy completion
remain step1.2 work; this checkpoint does not close it.

## D10 — Recoverable receipts and complete explicit inventory (2026-09-28 23:22 EDT)
Claude's second-round b38933a review reproduced missing/corrupt secondary,
sealing-gap, partial-inventory, busy-timer and serialization faults. Move the
node fence and all journal roots under one persistent parent. Enforce the full
named inventory with explicit absent units and held member1; static descriptors
come from plist/file contents independently of loaded state. Rebuild a lost
secondary from an intact primary after readback, while retaining corrupt bytes;
ambiguous unfinished roots or both invalid baselines refuse. Disk/serialization
faults allow degraded verified restoration without durable success. Busy loaded
timers never call restore. A terminal append/receipt gap reconciles its hashes
without writing the sealed chain; explicit resolve retires interrupted windows
without accepting copies. New roots require a terminal predecessor; hash-linked predecessor records identify the unique lineage tip when the receipt is lost after finalization. These
mechanisms remain separate from the managed driver and its physical owner,
writer-inventory, timer deadline and cold-copy proof. CI36514681814's main-merge
worker fixture got503 at its first task-list RPC: daemon readiness-before-flush
is a separate lifecycle outcome, not a preservation-test failure or permission
to ignore the red suite.

## D11 — Prepare the complete baseline before directory creation (2026-09-28 23:49 EDT)
Claude's third round accepted bbbc883's eight fixes and lineage, then reproduced
crashes during creation that stranded an unindexed root. Write/read-check the
initializing receipt with the complete baseline before mkdir. Reopen that exact
root for restoration only, completing its baseline if possible or restoring in
degraded mode if setup cannot write. No unindexed-directory heuristic or automatic
retirement is introduced. Ignore only owned regular Finder metadata in the
journal parent; other unexpected entries refuse clearly. Static identity now
hashes existing argv files automatically, resolves cwd targets, and defines
dependencies as resolved entry files with explicitly declared package metadata.
The sealed-receipt messages name the recovery action. Fifty-three owned tests
pass both from source and private deployed tools-v30; unchanged admission/election
tests inherit only identical hashes. Exact new CI and independent review are
still required. This remains a restoration primitive, with the driver and actual
healthy cold-copy acceptance open.

## D12 — Finder metadata during initializing recovery (2026-09-29 00:58 EDT)
Claude Message30 accepted ab7097c's creation/crash-boundary fixes but reproduced
owned regular Finder metadata stranding an initializing root. Apply the same
owned-regular-file rule inside that root as in the parent; preserve its bytes.
Links, directories, foreign owners and other entries still refuse and fence
new windows. This changes no terminal or restore-only semantics. The new
regression rejects ab7097c; all55 tests pass from private tools-v31. The unchanged
15 admission/1 account-election tests are inherited by identical file hashes,
not called fresh runs. ab7097c CI36518928261 is green; this checkpoint integrates
main55131b8, including the installed/verified PR149 readiness prerequisite,
before fresh integration CI. The future driver must explicitly include
nats-auth.conf and Mission Control's actual npm-start build entry in identity;
its tools/dependencies stay pinned throughout an unresolved window. General
managed orchestration and three healthy cold masters remain open at1.2-pre.

## D13 — Bind managed stop to kernel owner evidence (2026-09-29 01:11 EDT)
Use one launchd adapter for the future Journal driver: bind actual kernel argv,
executable, cwd and generation; register owner/known-descendant exit status
notifications before durable stop intent; unload through launchd; then require
normal exit, absence of descendants/listeners, normal former CID closure and
the declared completion marker. Timer callbacks recheck idle state/log sizes
at unload and refuse a race. Six real owned macOS controls and eleven read-only
production bindings pass from tools-v33. The old private sampled-window driver
is retired with original forensic bytes preserved. This adapter supplies stop
evidence; it does not supply a complete production orchestrator, later-child
inventory, immutable/static identities or restoration readiness. Keep1.2 active.

## D14 — Require the complete owned placement cohort (2026-09-29 01:21 EDT)
The old fixture's CI placement error exposed a leader-only readiness gap.
Require all three named server identities, a common leader, two current
followers and reciprocal confined routes before any stream placement. A
missing member refuses by a bounded deadline; no placement retry is added.
Followers omit replica detail, so only the leader supplies those fields.
Private tools-v36 passes the complete owned recovery fixture after two retained
refused drafts with normal cleanup. Exact prior request phase was not captured;
this is a tightened fixture gate, not a confirmed production cause or repair.
Keep1.2 active until the detached orchestration and healthy cold-copy proof.

## D15 — Refuse incomplete managed-stop evidence (2026-09-29 01:44 EDT)
Claude Messages40/42 separate current adapter scope from a production driver.
Read the loaded exit timeout and retain bootout return/stderr plus every kernel
exit, including a forced kill. Watch the union of descendants and process-group
members. Explicit per-PID role contracts do not allow SIGKILL; children must
be observed dead while the owner is still live. Delivery order itself proves
no chronology, so coalesced observations may conservatively refuse. A captured
normal child exit before the stop is allowed. Watch fork/exec without ONESHOT;
any such event refuses because Darwin supplies no forked PID and NOTE_TRACK
is unsupported. Rebind code entry/plist/executable bytes, ctime/start boundary,
text inode and hash-only declared environment before signalling. Bootstrap
checks both gui and user domains, while its actual user-domain negative remains
unproved because this Mac rejected the isolated job. Idle timer/log checks alone
refuse full verification; an independent complete spawn witness is required.
Actual runtime NATS configs use inline authorization and no includes; pin those
full configs. Follow any actual include in future configurations rather than
requiring a nonexistent nats-auth.conf from a template assumption. Private
tools-v40 passes13 actual Mac controls/1 skip, v39 passes recovery plus the
actual two-of-three and four individual-predicate negatives. Refused v37/v38
drafts are retained. Complete orchestration, identities, timer witness and
healthy cold masters remain1.2 work; new exact CI/review is still required.

## D16 — Loaded provenance and prepared stop intent (2026-09-29 02:09 EDT)
Claude Message44 accepts8286c96, then distinguishes remaining driver needs.
Bind the actual loaded plist path and stdout/stderr paths from launchd,
rather than inferring them from equal arguments or caller-selected logs.
Register process/file watches and finish expensive byte/provenance re-binding
before Journal intent. The driver calls ready_for_intent again outside mutate;
the apply callback retains short state/process/lifecycle checks. Vnode mutation
refuses; pure ATTRIB with identical opened/current device/inode/ctime alone
is ignored, including read-atime notifications. No delivery chronology or
automatic forked-child adoption is claimed. Actual completed-tick/child-free
gaps for periodic-fork producers, production-sized NATS/memory stop margins
and Discord crash-loop unload proof remain separate driver prerequisites.
An explicit timeout change must precede the first baseline and be verified
as its own lifecycle prerequisite; this checkpoint changes no production unit.
Private tools-v44 passes17 controls/1 skip, v42 passes full recovery and all
eight single-predicate negatives. The source is deployed only to owned/read-only
consumers; complete production orchestration and healthy cold masters remain
open. The earlier20-unit preparation misparsed enabled/disabled as booleans;
its rejected bytes/correction are retained privately and neither is an approved
preservation baseline. Member1 is still disabled/unloaded. Exact new CI/review
remains required.

## D17 — Retain raw stop failures before classification (2026-09-29 02:33 EDT)
Claude Message46 accepts9deef65 and its provenance/readiness delta, then
identifies missing raw kernel events and the lost pre-watch startup negative.
Record each raw filter/ident/flags/fflags/data before any classification;
EV_ERROR refuses immediately with errno, and context/constructor errors retain
private stop_evidence. Restore the identical-rewrite-after-start negative and
provide one helper for ready-before-journal-intent ordering. Inode watches
cannot pin parent-directory/symlink mappings; restoration must recheck static
paths and dependencies. No dependency build/install during an unresolved window.
Twenty real Mac controls pass/one explicit domain skip; v45's missing-import
draft is retained as refused. Four owned NATS stops with eleven archive restores
measure34–45ms; one idle installed-source memory stop with253,943,808 copied
database bytes measures65ms. These are historical-size idle samples, not worst-
case bounds or active-worker drain proof. Production five-second timeouts are
unchanged. Actual serving NATS configs omit log_file. Discord is configured
disabled with no token, yet its unconditional KeepAlive restarts the missing-
token path; no credential or enabled integration is invented. Timer witness,
that stop prerequisite, detached orchestration and healthy cold masters remain
open. See KERNEL_EVENT_EVIDENCE.json; step1.2 stays active.

## D18 — Make post-intent kernel failures durable (2026-09-29 02:50 EDT)
Claude Message48 finds no blocker on19243eb; both exact CI runs are green3/3.
Its remaining forensic correction is material: in-memory exception evidence
alone does not survive controller loss. Journal.mutate now accepts an optional
sanitized failure-evidence callback, and StopWatch.mutate supplies its complete
raw-event/lifecycle/exit/bootout snapshot before the durable failed append.
Explicit KQ_FILTER_PROC classification prevents any other filter with a bound
PID from being mistaken for a process event. A real EVFILT_USER control uses
that PID, refuses, and reopens its persisted failure detail. Twenty-one actual
Mac controls pass/one domain skip;56 journal controls pass. Two refused fixture
layouts are retained. Pre-intent preparation failures still require a separate
private durable refusal record in the future driver. No production operations
or step close follow; exact new CI and independent review remain required.

## D19 — Require round-trip-stable journal keys (2026-09-29 03:09:24 EDT)
Claude Message54 accepts2c0b7b6's explicit filter and durable callback, then
reproduces integer-PID key sorting that poisons journal hashes after JSON
reload. Numeric and lexicographic order differ for9998/10001; same-width
20001/20002 is the control. This affects successful evidence too. Export
StopWatch exits/process_contracts with string PID keys, and reject every
non-string dictionary key recursively before encoding/hashing any record.
Do not silently normalize ambiguous keys or retrofit old forensic records.
Owned old-source verified/failed mixed-width records reproduce degraded
baseline-only reopen; the control reopens three records. New records on both
paths verify every hash, restore and resolve.58 journal controls and21 actual
Mac controls/1 domain skip pass. No production journal exists, so no production
repair or source-state migration occurred. Full driver/kernel-trace resource
bounds, timer foreground holds and healthy cold masters remain open at1.2.

## D20 — Land the reviewed tools before execution-hold integration (2026-09-29 07:12:37 EDT)

Integrate current main51a817f into the existing5fabf6e recovery branch and land
PR144 as a bounded code-foundation checkpoint after exact CI and independent
review. The Journal, stop adapter and admission tools stay byte-identical;
the diff against main stays confined to this plan plus its recovery CI step.
No production importer, driver, service/timer wiring or healthy cold-copy
claim accompanies the merge. The private copied Journal is the deployed
consumer at this checkpoint; bus3.5 is the next source consumer.

Claude98 checks inertness, disjoint integration and the explicit remaining
outcome; its exact-head re-review is still required. Retain all prior forensic
records as scoped tool-development history. Recovery1.2 stays[A]/v1.2-pre;
the complete production driver/baseline, three healthy cold masters, isolated
restores and restoration evidence remain open. Bus3.5 imports the single
journal from main without copying it or reaching into an absolute worktree.
Bus3.6 then integrates actual timers. This breaks the source dependency cycle
without declaring the unfinished preservation outcome done.

## D21 — Preserve the idle on-demand worker as its own baseline class (2026-10-01 00:01 EDT)

The live mesh-agent is loaded, idle and enabled after the VM restart. The
existing `daemon` class required it running, while `known-broken` ignored its
running bit. Neither represents that state truthfully. Admit `on-demand` only
for mesh-agent with loaded=true, running=false and disabled=false; its exact
running bit remains part of `matches()` during restoration. Reserve
`known-broken` for the explicitly disabled Discord integration, so it cannot
be used to waive the worker's running-state check. This is a baseline-schema
correction, not a production recovery adapter or an accepted cold-copy window.
The full 20-unit read-only structural capture now validates, but its 54 direct
file pins are not a complete dependency or loaded-process provenance proof.
Claude's independent challenge found that recovery otherwise sent an observed
running worker to `restore()`. The Journal now refuses that case before any
restoration intent; the operator must resolve a live worker. An intact receipt
with an unsupported baseline is refused without being renamed as corrupt.
The original immutable 3.11 controller carried the old parser. All three
invocable old bundles were retired at 2026-10-01 00:21 EDT; the compatible
protected `timer-hold-controller-20261001-4` now verifies in place (see
step12_jetstream/RUNTIME_EVIDENCE.md). Keep that replacement pinned before the
first full-node journal. An absent `timer-transition-active` and
present `timer-entry-installed` only make a rerun harmless while the receipt
still names the resolved timer journal. Once a full-node receipt reads
`restored`, the old `--commission` path can reopen its installed timer window,
rename the new receipt as corrupt and block the next window until the current
journal is reopened with the new parser and its receipt repaired. Do not invoke
old `--commission` or `--recover` once a full-node journal owns the receipt.
Production capture must verify the worker's normal idle exit/provenance and refuse a running
worker, rather than selecting a class from a transient observation. Forward
quiescence must unload this latent writer with spawn-race evidence; restoration
may bootstrap its saved idle job but must never kickstart it.

## D22 — Include live gateway/viewer and fence all launchd entry points (2026-10-01 01:28 EDT)

The viewer can detach an agentic plan tick that can drive `launchctl` and NATS;
the gateway owns a live task SQLite store and can start tool-capable turns.
Neither is excludable because it had no NATS socket at one instant. Extend the
full-node Journal cohort from 20 to 23: stop viewer then gateway before other
clients, restore gateway after its dependencies and viewer last, and represent
the installed federation tick as unloaded with its current persistent disabled
flag. The durable `full-node` scope requires these exact classes and the saved
five-timer hold. A loaded or re-enabled federation tick refuses restore-only
recovery; the controller does not silently boot it out or enable it.

Before a full-node journal, enumerate installed and loaded jobs in the GUI,
user and system launchd domains, including `ai.openclaw.*`, `com.openclaw.*`
and programs resolving into the repository or OpenClaw roots. Record disabled
plist artifacts separately. Unknown entry points refuse; disconnected sockets
do not authorize exclusion. Check detached tick/companion processes and the
launchd inventory repeatedly through the copy window. The viewer's old process
group cannot account for a tick already reparented to launchd.

The current widened read-only scan refuses: 23 approved user LaunchAgents plus
root-managed `com.openclaw.agent` and `com.openclaw.tailscale-up` are installed
and loaded. The former is enabled, KeepAlive, points to a missing legacy
`agent.js`, and is repeatedly exiting 1. Missing code prevents execution now
but not future reappearance after a deploy. The latter is an idle one-shot
network helper, not yet accepted as a pinned exclusion. Neither was changed.
The 11 `.plist.disabled` artifacts are inventoried by hash, not treated as
loaded jobs. No live preservation window may start until the legacy system
agent is durably retired or included with a verified stop/restoration contract,
and the network helper has an explicit exclusion and final-state check.

This supersedes D21's statement that timer controller bundle `-4` is compatible
with a future full-node receipt. It still serves the current timer-only receipt
and safely refuses the new 23-unit `full-node` scope without renaming it. Once
a full-node journal exists, timer restoration belongs to that journal's hold
path; `-4 --commission` and `-4 --recover` cannot service it. The gateway's
startup hook and ephemeral token, companion bridge, detached ticks, complete
dependency pins, healthy cold masters and truthful restoration remain driver
prerequisites. This decision changes source schema only, not live services or
the open 1.2[A] outcome.

## D23 — Bind entrypoint evidence to the full-node journal (2026-10-01 01:55 EDT)

Claude's PR #169 review reproduced two omissions in the draft: a new 23-unit
journal could be created with no scope, and a neutral-label job loaded from a
plist outside the scanned directories could evade the label-only check. New
journals now require an explicit timer or full-node scope. Unscoped journals
can only be reopened for historical restoration; fixture tests simulate their
old creation separately. Full-node creation runs the source-owned GUI/user/system
launchd and plist preflight under the node lock before publishing a baseline,
and the baseline durably saves installed plist paths/hashes, loaded labels by
domain, protected roots and disabled-artifact hashes. The journal rechecks the
installed/artifact pins before each forward mutation. Each verified stop
persists the loaded-label map; subsequent forward work requires exactly that
map, except for the unit being stopped or unloaded. A recovery-time inventory failure is
recorded as an uncertified error while independently verified prior units are
still restored. Final restoration and resolution require the original
loaded-label map again. Full-node sealing is refused until a continuous
launchd/process watch can prove that a stopped writer never restarted between
point-in-time scans; the hold completion receipt likewise reports
`history_certified:false`. Unknown entrypoints refuse before a new window.

Loaded services are inspected by `launchctl print` even when their labels are
neutral or Apple-prefixed and their plists live outside the standard
directories. Installed plist relevance includes `Program`,
`ProgramArguments`, working directory, resolved symlinks, shell HOME and
environment indirection, unclassified interpreters and multiply linked
executables. The pinned roots include the repository, live OpenClaw home,
legacy `~/openclaw`, global OpenClaw npm package locations, companion bridge
and Codex worktrees. Relative arguments resolve against the declared working
directory; versioned interpreters and common process wrappers are classified.
System-library jobs and dynamically registered app-bundle executables are
excluded from the hard-link heuristic unless another path or label binds them
to OpenClaw. This is a conservative inventory test, not proof that arbitrary
shell code cannot synthesize another path.

The deploy listener must stop before the viewer and gateway and resume last.
Its stop watch refuses if the listener already has a child process, before
any signal is sent; a newly forked child also invalidates the process watch.
Its missed-deploy catch-up can rewrite code and reinstall gateway state, so the
driver must separately prove no pending deploy before resuming it. The source
order does not itself prove that condition. The current live scan still refuses
the same two root-managed system jobs; no production preservation window has
started.

If a plist or loaded job drifts during recovery, the journal does not certify
or resolve. It restores each independently verified prior unit where safe and
retains the exact unresolved chain and pins. The operator must restore the
original pinned identity from a trusted copy, or investigate the changed job
and its effects, then rerun restore-only recovery. The journal stores hashes,
not plist contents, and cannot reconstruct a changed plist by itself.

## D24 — Treat protected NATS writer transfer as a separate one-way migration (2026-10-01 12:29 EDT)

The existing same-UID preservation Journal restores its prior GUI jobs after
interruption. It cannot own a transfer to root-pinned system jobs and a separate
service UID: after the first protected server start, the old store is stale even
if no client has connected. A separate root-held migration journal must record
the old-job retirement, copied store/config/auth identities and the first
protected bootstrap before it authorizes any further action. Recovery before
that bootstrap may restore the untouched old bus; recovery afterward may only
finish the protected migration or require an explicit reverse migration.

A root-owned handoff marker under `/private/var/db/openclaw-nats/`, outside
operator-writable ancestors and the operator's HOME, must be published
before retiring any old job and retained after commit. `/Library/Application
Support` is excluded because its live parent is group-writable by `admin` on
this Mac. The root journal creates the directory as `root:wheel` mode `0755`
and publishes a root-owned marker there so non-root guards can observe it but
cannot remove it. If recovery fails before the first protected bootstrap, only
that root journal may remove the marker, as its final step after the untouched
legacy bus has been verified restored. After bootstrap the marker remains;
ordinary rollback must never restart the stale legacy stores. Ordinary
installation, user-owned auth rendering and
`openclaw-trust-peer --sync-nats` refuse while it
exists; the trust command checks before changing the registry. The source
guard is an accidental-resurrection barrier, not authority for the root
migration and not a substitute for disabling and quarantining every old GUI
job. The root path, service UID, ownership-enforcing volume, mount identity,
protected binary/config/auth, exact old/new config equivalence, service-UID
isolated replays, system-domain monitoring, targeted auth reload and revocation
proof remain required before cutover. No source change in this decision starts
or stops the live bus or closes 1.2.
The marker content and active-cohort contract are pinned in D27.

## D25 — Fence the stack entry and isolate auth fixtures (2026-10-01 12:41 EDT)

`openclaw-stack up` discovers installed `ai.openclaw.*.plist` files and can
bootstrap a leftover NATS GUI job independently of `install.sh`. It must refuse
before any start when an enabled legacy NATS plist and the protected handoff
marker are both present. Disabled plists are discovered for status but skipped
by `up` and must not block other services. The source guard covers that path
and owned child controls check refusal and the disabled-only case. This does not replace the
migration's durable disable and hash-pinned quarantine of those plists.

The auth tests run CLIs against a private HOME. A host handoff marker should
not turn those isolated fixture tests red after migration. Their child-only
preload makes that one marker appear absent in the fixture; a separate test
simulates its presence and proves that live command paths refuse before the
registry or auth file changes. Production code retains the fixed marker check.
`mesh-deploy --include-services` currently reaches a `preInstall` callback
that always returns false, so its service component does not presently write
plists; it remains a deployment contract to revisit before protected cutover.
Neither this source correction nor its tests operate the live bus.

## D26 — Recheck legacy writes at their immediate boundary (2026-10-01 12:43 EDT)

An installer launched before marker publication can reach NATS token, config or
LaunchAgent writes after the initial preflight. Recheck at entry to the
configuration stage, before NATS config generation, and before each NATS
LaunchAgent render/start. An unreadable marker
location is reported as handoff-verification failure, with legacy writer changes
refused. These checks narrow the race but do not serialize a concurrent root
migration; the root journal must exclude in-flight installers before publishing
the marker and retiring old jobs.

## D27 — Observe protected NATS in the system domain (2026-10-01 12:55 EDT)

The protected active jobs on this Mac are `ai.openclaw.nats`,
`ai.openclaw.nats-2` and `ai.openclaw.nats-3` in `system`, after their GUI
predecessors have been retired. The separate historical `ai.openclaw.nats-1`
job remains held. Other nodes may use the documented `nats-1..3` cohort or
the single `nats` job. In the legacy state, an optional 0600
`config/nats-writer-cohort.json` under the OpenClaw home declares
`{"schema":1,"activeLabels":[...]}`. Fresh installs initialize the single
`nats` cohort before rendering NATS config; existing installs without the file
remain UNKNOWN until explicitly declared. A missing declaration never lowers
the required set during a partial bootout. On this Mac the explicit file names
the observed active cohort.
The fixed root handoff marker selects the system domain and pins the same
`activeLabels` alongside `schema:1` and
`kind:"openclaw-nats-writer-handoff"`. It is a root-owned, readable,
non-group-writable regular JSON file. Only the single-node and two known
three-member layouts are accepted; malformed state is UNKNOWN before any
launchd observation. Other core jobs remain in `gui/<uid>`. A protected NATS
PID in `system` is insufficient while any known NATS label is still loaded
in `gui/<uid>` or `user/<uid>`:
that is a duplicate writer risk and reports BROKEN. Without the marker, a
loaded `system` or `user/<uid>` NATS job also reports BROKEN. An unreadable or
malformed marker reports UNKNOWN rather than assuming the legacy domain.
The WORKING verdict proves only required-label PID liveness and absence of
loaded known-label duplicates in the inspected domains; it does not validate the future
system jobs' binary, UID, config, store identity or an installed-but-unloaded
legacy plist, unlisted launchd label or unmanaged `nats-server` process.
Migration acceptance must pin those identities and inspect
persistently enabled jobs before publishing the marker. This is read-only
monitoring, not migration authority or proof of JetStream health; quorum and
replay checks remain separate. No live service is changed by this decision.

## D28 — Bind protected handoff to the observed split source topology (2026-10-01 13:18 EDT)

The live 4222 server has no NATS routes and no JetStream meta-cluster; the
4223/4224 servers route to each other and report `openclaw-cluster`. The
read-only loopback audit classifies this as `standalone-plus-two`, not a
three-member cluster. The three live PIDs and reachable client ports
must not be interpreted as one replicated history. Each distinct store and
its stream/consumer state remains a separate preservation source. A protected
writer handoff must pin the old topology and verify the new jobs reproduce the
same separation before any topology repair or history union is attempted.

`bin/nats-topology-audit.mjs` observes the three fixed local monitor ports,
checks that `/routez` and `/jsz` name the same server at each port, collapses
duplicate route connections by server ID and reports only the resulting
topology. Its `--expect` control exits nonzero on drift; this Mac's observed
split passes and a three-member expectation fails. It does not inspect
credentials, config/store identity, message contents or cold-copy integrity.
`SITE_TOPOLOGY_EVIDENCE.json` contains counts and port relationships without
server IDs or secret-bearing payloads. The root migration journal, protected
service identity, cold masters and resumption still gate step 1.2.

## D29 — Audit protected site prerequisites without authorizing cutover (2026-10-01 13:20 EDT)

The protected writer requires a distinct `_openclaw_nats` UID, an
ownership-enforcing APFS volume, and a root:wheel `0755` directory under the
root-controlled `/private/var/db` parent. Before a new handoff, the marker
must be absent; if already published, only the root migration journal may
decide recovery. `bin/nats-protected-site-audit.mjs` checks these facts
read-only and returns `readyForStaging`, not `readyForCutover`. It neither
creates the account nor directory, and it does not read or publish secrets.

The live site passes APFS ownership and protected-parent checks, but the
service account and protected directory are absent. The audit exits 1 with
those two exact blockers. Root-owned binary/config/auth staging, immutable
identity pins, store transfer, legacy job retirement, first protected
bootstrap, reverse-path constraints and three healthy cold masters are still
open. No privileged mutation occurred.

## D30 — Verify the protected ancestor chain and device (2026-10-01 13:33 EDT)

D29's parent check now covers `/private`, `/private/var`, and
`/private/var/db`: each must be a root:wheel directory without group or world
write permission, and all three must be on the same device. The protected
root must be on that device too, so a mounted handoff directory cannot pass
the site preflight. This remains a read-only staging check, not cutover
authorization. The live chain passes; the dedicated account and protected
root remain absent.

## D31 — Tighten protected-site identity and expose held Raft membership (2026-10-01 13:47 EDT)

Claude's read-only review of PR #175 at `6035e76` found that a positive
non-operator UID could still be a normal, privileged account. The staging
audit now requires `_openclaw_nats` to be a local system-range UID, with a
matching dedicated primary group, no staff/wheel/admin group membership, a
non-login shell and empty home. A root invocation must identify the original
operator via `SUDO_UID` or `--operator-uid`; UID 0 cannot stand in for that
operator. The audit refuses ACL entries on the protected directory or any
ancestor. It derives its marker path from the legacy-writer guard's constant.
These facts qualify only a staging site; the root journal still has to pin
the exact account, binary, configuration, credential and store identities.

The topology audit now binds `/varz` to `/routez` and `/jsz` by server ID and
checks each monitor against its expected client port. Its classification is
the currently routed graph, not the full JetStream Raft membership. The live
8223/8224 peers each report meta-cluster size three; the leader reports one
replica offline. This is consistent with the separately held member-1 store,
whose identity and history still require their own pins and cold-copy proof.
The two routed peers' stream counts differ. Four distinct store directories
remain preservation sources; no same-named stream may be merged on the basis
of routing alone. Refreshed evidence saves only counts and port relationships.

## D32 — Attribute the offline replica to a peer, not a fixed leader (2026-10-01 13:55 EDT)

D31's phrase "the leader reports one replica offline" overstates the saved
evidence. The leader can change between loopback reads, and the saved report
retains the offline replica count by monitor port without a leader binding.
The supported claim is that one of the two routed cluster peers reported one
offline replica while both reported a meta-cluster size of three. The held
member-1 store remains a separate source by its own prior identity evidence;
the loopback snapshot does not certify that identity or a stable leader.

## D33 — Parse ACL entries and directory membership from macOS command output (2026-10-01 14:03 EDT)

The protected-site audit must inspect the numbered ACL entries printed by
`ls -lde`, not just the mode suffix: an extended attribute makes macOS show
`@` even when ACL entries also exist. A `+` suffix without the expected entry
listing is unobservable and refuses. `dseditgroup checkmember` returns status
67 with a valid `no ... NOT a member` answer on this Mac; the audit accepts
that answer, but refuses other nonzero statuses and malformed output. A local
directory with both an xattr and an ACL confirmed the `@`/numbered-entry case.
This changes read-only staging evidence only; the live account and protected
root remain absent.

## D34 — Make the protected account exclusive before staging (2026-10-01 14:09 EDT)

The D31 account check accepted a second user with the same UID, a second group
with the same GID, an explicit member of `_openclaw_nats`, or a service account
in a supplemental privileged group such as `operator` or `_developer`.
Read-only `dscl -search` results must identify exactly one matching user and
group record, and the dedicated group must have no explicit members or nested
groups. Effective `id -G` groups are limited to the dedicated primary group
and the macOS ambient groups observed for system users on this
host: everyone (12), localaccounts (61), `_lpoperator` (100), and the nested
sharepoint group (701). Any other group refuses staging. The dedicated primary
GID must be in the system range. These are staging qualifications, not proof
that a root migration or any live protected writer exists.

## D35 — Keep routed and healthy three-member claims separate (2026-10-01 14:15 EDT)

Claude's second PR #175 review found that three mutually routed servers could
report metadata cluster size five with no leader and still receive the label
`three-member-cluster`. That label now additionally requires size three at
each monitor, one shared leader matching a present server, and the leader's
two other named replicas both current and not offline. This remains a narrow
metadata gate, not proof that every stream group, client credential or store
is healthy. The live split layout remains `standalone-plus-two`.

Saved topology evidence is now emitted by the CLI's `--public-evidence`
projection. An empty replica list is `null` rather than a false count of zero
offline peers. NATS currently labels the held replica with an unresolved peer
ID instead of a server name; public evidence retains a SHA-256 digest of that
ID, not the raw value. The held store still requires independent identity and
history pinning before migration.

## D36 — Exclude operator access through the protected primary group (2026-10-01 14:25 EDT)

An empty `GroupMembership` attribute does not prove the dedicated GID is
private. macOS can record a member by GUID in `GroupMembers`, and a user's
primary group need not appear as an explicit group member. The protected-site
audit now refuses all three membership attributes (`GroupMembership`,
`GroupMembers`, `NestedGroups`) and compares the service GID against every
effective group of the invoking operator, resolved by UID even under sudo.
It also requires a local-directory `PrimaryGroupID` search to find only the
service account for that GID; checking the operator alone would miss another
user with the service group as its primary group. This is a staging identity
check, not proof that protected credentials or a root migration have been
installed.

## D37 — Preserve leader and process-start evidence in topology snapshots (2026-10-01 14:29 EDT)

The public read-only topology projection retains NATS server names, each
reported metadata leader and each `/varz` start time. These are not secrets;
without them, a saved routed graph cannot distinguish a leader election from
a server restart or re-derive the named-leader part of the classifier. The
fresh snapshot still says `standalone-plus-two`; the opposite expectation
exits 1. All three `/varz` starts remain 2026-10-01 00:29:20 UTC despite
leader changes between snapshots, so that observed shift was an election,
not a process restart. The nearly identical timestamps across three separate
processes are not a precise launch spread on this VM; they establish only no
restart between observations, not survival across a VM state restore. This
does not bind the held store to its Raft peer ID or prove stream-level health.

## D38 — Require a pristine protected root before staging (2026-10-01 14:38 EDT)

The protected-site audit previously checked the root directory's owner, mode,
device and ACL but not its contents. A leftover user-owned store under a root
whose permissions were later corrected could therefore receive
`readyForStaging: true`. The pre-staging audit now reads the directory and
requires it to be empty. The future root migration must separately inventory
and pin all protected assets after staging; this check applies only before
that transaction and is not cutover authorization. The live protected root is
still absent.

## D39 — Root NATS writer migration requires a durable ownership transfer (2026-10-01 15:03 EDT)

Claude's read-only challenge of the proposed protected-writer migration found
four blocking interleavings: an installer already past a marker check can
rewrite and reload a legacy job; the user preservation journal can restore GUI
NATS after root retirement or become permanently unresolved; an enabled
system plist can auto-start after a reboot before first-bootstrap intent; and
bootout-only client holds let clients return at login during post-bootstrap
acceptance. The corrected candidate is in
`audits/step12_jetstream/ROOT_WRITER_MIGRATION_DESIGN.md`. It requires a
durable user-to-root NATS-unit transfer, shared old-writer exclusion plus a
pre-protocol process check, persistent client disable or equivalent physical
hold, no loadable protected plist before durable first-bootstrap intent, and
first boot with only the root acceptance identity. Clustered stores are
single-use copies because startup rewrites `peers.idx`; the standalone store
must never start under cluster config. These are implementation and live
acceptance requirements, not a migration approval. No protected account,
marker, root journal, cold masters or cutover exists yet.

## D40 — Make legacy NATS mutation share a root-owned exclusion lock (2026-10-01 15:17 EDT)

The old-writer source must take a shared `flock` on a root-owned 0644 lock at
`/private/var/db/openclaw-nats-writer.lock` for its entire mutation, including
installer and uninstaller work, auth reload and stack launch. The privileged
transaction will take that same lock exclusively before its process census and handoff marker
publication. The source wrappers validate the lock path and inherited
descriptor, wait for a bounded interval, and refuse a marker observed under
the lock. If the lock is absent they retain the existing marker guard; this
lets the prerequisite source deploy before the privileged transaction creates
the lock. The root migration must still reject old in-flight processes that
started before the lock existed. This is exclusion infrastructure only: the
root-owned lock, ownership transfer, journal and protected writer have not
been staged or exercised live.

## D41 — Root exclusion is an identity-pinned, exclusive lock (2026-10-01 16:02 EDT)

The privileged migration uses the same fixed lock path as D40. Its root-only
entrypoint creates a regular root:wheel 0644 file outside the staging root
only after a durable migration intent. Creation and acquisition are distinct:
acquisition refuses a missing file, so a read-only probe cannot switch the
legacy tools into lock mode. Creation syncs the file and parent directory;
acquisition then takes a bounded exclusive `flock`.
It validates owner, mode, single link, inode, protected ancestors and absence
of granting ACLs before and after acquisition. A current shared holder makes
the root refuse; a replaced lock path after acquisition also refuses. The
file is never deleted or replaced once created: recreating it could leave a
legacy process holding an unlinked old inode. A resumed creation syncs the
existing file and parent before reporting success. The root must retain the
descriptor until the handoff or pre-bootstrap rollback has ended. This is a
source primitive, not a migration driver or proof that deployed legacy copies
honor D40. No live lock file or marker is created by this change.

## D42 — Journal the root lock bootstrap before the live switch (2026-10-01 16:16 EDT)

The root transaction must durably record one lock-create intent under its
protected site before creating the D40 lock file. The intent binds a
transaction UUID, boot identity, user-transfer digest and admission digest.
It also binds the exact protected site, shared lock path and expected owner;
reentry with a different path cannot receipt an unrelated lock.
The lock path cannot lie inside the handoff site, and the source API refuses
the actual D40 production lock until the remaining lifecycle branches are
implemented and reviewed. Both journal begin and private creation refuse
every macOS root caller before writing, so a path alias or direct import
cannot lift this gate or strand the protected site.
Only then may explicit creation run. The pinned root driver must perform a
process census before creation, including unlinked-file holders, then repeat
it and re-observe the same admission under exclusive lock before writing a
lock-created receipt with the inode and change time. Linux can reuse an inode
immediately after deletion, so the durable receipt requires both values. The
in-process descriptor/path identity also checks device; the durable receipt
does not pin a transient device number across reboot. Any metadata change
after the receipt refuses and requires an operator review. A process exit
after a durable intent and before a later record write can reopen that intent
and repeat the admission and census checks; it cannot start a second journal.
A marker already present routes to
the later full recovery path, never this bootstrap.
The source journal stores digests, not the private transfer or cold-master
contents. Claude's exact-head review found that a deleted lock could be
recreated before the receipt, a crash before the first intent or during a
later record write can strand reentry, and reboot has no terminal abandonment
or successor transaction. The production gate must stay until those
lifecycle branches are implemented and tested. The eventual driver must
bind census evidence to transaction, phase and lock identity; copy transfer
evidence to root-owned storage; recompute verified state from fresh physical
observations; and keep volatile fields outside the admission digest. Marker,
retirement, protected bootstrap and live acceptance are also pending.

## D43 — Stage the writer lock from a sibling ledger (2026-10-01 17:30 EDT)

PR #179 supersedes D42's journal location and direct lock-creation step. A
single root-owned ledger lives beside the protected site, keeping the site's
empty-root staging preflight satisfiable. The ledger directory itself carries
the exclusive driver lock; an empty directory and interrupted pending record
are recoverable, while unknown entries or a broken hash chain refuse. Before
the shared lock path can appear, the transaction stages a nonce-bearing lock
under a private name, syncs it, and durably records its inode and nonce. It
then hard-links that same inode at the shared name, syncs, and removes the
staging name. Reentry completes a two-link gap; if both names disappear after
the staged receipt, it refuses rather than creating a different inode. Under
exclusive exclusion, the admission receipt pins inode and change time and
requires census evidence to echo the transaction, boot, phase, inode and
nonce. Claude challenged the exact 0c92cbe head with no blocker; four CI jobs
passed. All macOS-root constructors and publication paths remain gated, so
this is source-only. Reboot abandonment, terminal user-readable outcomes,
successor transactions, physical admission/census, user transfer, marker and
rollback states, and the protected driver are still required before live use.

## D44 — Freeze the user preservation journal during NATS transfer (2026-10-01 18:16 EDT)

The original same-boot full-node owner records a nonce-bearing transfer intent
only after its forward hold remains valid, the three legacy NATS writers have
verified unload receipts and fresh stopped observations, member-1 still matches
the held baseline, the loaded-entrypoint inventory agrees, and the protected
root marker is absent. That record freezes every ordinary user-journal append
and recovery action. A root-return receipt may close the freeze only when its
root-owned public file binds the exact transaction, user journal root, baseline
hash, transfer record hash and durable root ledger head; a marker blocks return.
After closure, the user journal is restore-only. It cannot resume forward
certification and must recover the legacy baseline before resolution.

This first source slice implements only the `returned` outcome. A root `accepted`
outcome requires the new system-service baseline and readiness delta; a
post-marker rollback requires separate root restoration evidence, and a
no-root-intent refusal needs a root-owned `declined` outcome. Until those
branches and the pinned physical root driver are implemented and reviewed,
the root journal's production macOS-root tripwire remains in place. No live
preservation hold or NATS service is changed by this decision.

Claude's exact-head challenge of PR #181 found that a transfer could otherwise
freeze a production journal before any root transaction existed. The user
transfer entrypoint now also refuses on the production macOS marker path until
`declined` and root validation exist. A returned legacy restoration checks the
marker and, when the shared writer lock exists, holds it shared across each
NATS restore and verification. Any transfer record ends same-process
`JournaledHold` forward certification, even after a root return.

## D45 — Root reads the private user transfer under the node lock (2026-10-01 18:46 EDT)

The root must take the operator's nonblocking node lock and journal lock,
retain their descriptors, and read the journal through a pinned directory
descriptor. It verifies owner-private modes and ACLs, the complete hash chain,
the full-node baseline and entrypoint cohort, the current boot, the unresolved
node receipt, the transfer as the exact final record, and the absence of
pending or failed work. The root also proves that the original execution hold
was published and verified before the NATS unload receipts, and that the
transfer-time native observer still reports the same watch session. The user
intent therefore carries both the transfer-time hold evidence and its hash;
the root does not compare volatile observer fields byte-for-byte with the
earlier close receipt. Reentry must read back the same chain while retaining
the node lock. Caller-supplied `verified` fields cannot replace this read.
Root transaction begin must bind to that still-open terminal transfer under
the held node lock. This excludes a concurrent legacy restore in the interval
before a new writer lock exists, as raised in the PR #181 adversarial review.

This is a read-only source validator. Root-owned durable copies of the two
records, its integration into the privileged transaction, production physical
admission, `declined`/marker outcomes, and the cold-master cutover are still
required before the production tripwire can be lifted.

Claude's PR #182 challenge found that the real hold-close verifier writes its
native certificate at the top level of `verified.evidence`; only subsequent
`JournaledHold.mutate` receipts nest `execution_hold`. The validator now reads
that producer shape, and a macOS control builds the transfer with the actual
gate and hold. Root admission accepts owner-owned Finder `.DS_Store` metadata
without treating arbitrary files as journal records, rejects events outside
the uninterrupted forward window, and revalidates the open lock descriptors
against their named inode/ctime identities. The production gate remains
closed until root-owned physical admission and the outcome lifecycle exist.

## D46 — Bind root bootstrap to the still-open user transfer (2026-10-01 19:10 EDT)

The privileged transaction must acquire the owner node and journal locks before
its root ledger intent, derive the user-transfer observation from the locked
validator, and retain those locks until the root transaction is closed. Reentry
reopens both journals and refuses if the saved root descriptor no longer binds
the current terminal user transfer, baseline hash, root path, or boot. Root
lock acquisition rechecks the binding both before and under writer exclusion.
This keeps a second root bootstrap out of the interval in which the legacy
restorer has already closed a prior transfer but the writer lock is absent.

The source wrapper proves this binding with a supplied physical-admission
callback only for isolated tests. It is not the production root driver: the
caller-supplied physical verdict remains untrusted, direct low-level bootstrap
is still available behind the macOS-root tripwire, and the root ledger has not
yet durably copied the user baseline and transfer records. The tripwire stays
closed until those interfaces are replaced by pinned root-owned observations
and the declined/accepted/rollback lifecycle is complete.

## D47 — Copy transfer evidence into the root intent (2026-10-01 19:29 EDT)

The bound root bootstrap writes the exact validated user baseline and terminal
transfer records into its root-owned `lock-create-intent`, in the same durable
append as the descriptor. The root ledger validates each record's content hash
and its linkage to the descriptor; bound reentry requires the copies to equal
the records reread under the owner node and journal locks. No separate copy
write follows intent, so a crash cannot leave an intent that assumes evidence
was pinned when it was not. The low-level journal still permits fixture intents
without these copies, but the bound path rejects them on reentry and the
production macOS-root tripwire remains closed.

This anchors the owner-trusted transfer in root-owned storage. It does not
turn a caller-supplied physical verdict into a trusted observation or supply
the declined/accepted/rollback outcomes and protected NATS cutover. Step 1.2
remains active.

## D48 — Permit prior-boot reentry only for pre-marker return (2026-10-01 19:33 EDT)

A root intent may survive a VM reboot before marker publication. The bound
reentry reader may then load the owner journal from its prior boot under the
node and journal locks, but it must match that boot and the exact root-owned
copies in the existing root intent. It cannot resume writer admission or
recompute the old physical admission verdict on the new boot. It can only
record a verified pre-marker return using fresh release evidence, after which
the existing user journal remains restore-only. A new root begin still
requires a current-boot user transfer. This is a source control; production
root execution remains gated and fresh physical release verification is not
yet implemented.

## D49 — Decline a transfer only under the root ledger lock (2026-10-01 19:56 EDT)

When an owner has durably frozen a NATS transfer but no root intent was
published, the root can return it with a `declined` outcome. The decline takes
the owner node lock, owner journal lock, and root ledger lock in that order.
It creates the empty root ledger directory if needed, settles pending appends
with the ledger's own reader under that lock, and refuses any active root
intent. A one-link pending intent has no effect; a final or two-link intent
blocks decline. The same root ledger receives a terminal, nonce-bearing
`transfer-declined` record with exact user baseline/transfer copies, the prior
ledger head and carried writer lock, old transfer boot, current decline boot,
and a digest of fresh physical absence evidence. The public root-owned receipt
can be republished after interruption and binds that record's hash. A later
root begin rejects reuse of the transaction and inherits the terminal lock
from a decline belonging to an earlier transaction.

The user consumes only the matching root-owned receipt, closes the transfer
with outcome `declined`, and restores the legacy NATS state restore-only. The
receipt reader rejects ACLs on the outcome directory and file. This source
slice still uses a supplied physical-absence callback in owned tests; the
production macOS-root decline and transfer gates remain closed until a pinned
root command, process/service census, protected outcome lifecycle, and live
restoration checks are implemented. A decline never substitutes for a root
return if any root intent already exists.

## D50 — Refuse stale root outcomes before recording a decline (2026-10-01 20:09 EDT)

An existing outcome file for the proposed transaction is evidence of a
root-side inconsistency. The no-intent decline checks the protected outcome
directory and its transaction slot while holding the root ledger lock, before
appending `transfer-declined`. It refuses an occupied slot without creating a
durable decline record, so a stale `returned` receipt cannot strand a newly
recorded decline whose receipt can never be published. Idempotent reentry of
an already recorded decline instead verifies the saved user and physical
identity and republishes the same receipt. This closes Claude's PR #185
exact-head E4 reproducer; production gates remain closed.

## D51 — Hold the carried writer lock and retain decline observation (2026-10-01 20:27 EDT)

An exact carried writer lock is opened without following symlinks and held
shared while a no-intent decline checks physical absence and commits its
ledger record. A concurrent exclusive holder refuses before the append, and
an exclusive writer cannot enter during the observation-to-commit bracket.
The order remains owner node lock, owner journal lock, root ledger lock,
then shared writer lock. With no carried lock, the existing ledger exclusion
remains the protocol fence. The record stores a size-bounded copy of the
physical absence evidence alongside its digest, and replay validates the
evidence, transaction, boot, carried lock and transfer hash. This is a
source-only strengthening. It does not authorize a production decline until
the observer is fixed-path root-owned code with launchd, process and store
census, and the production tripwire is reviewed separately.

## D52 — Recheck decline gates at the durable commit (2026-10-01 20:37 EDT)

Claude's exact-head review of PR #186 found that a lock substituted after
physical observation but during user-journal recheck could be detected only
after `transfer-declined` became durable. The decline now rechecks user state,
marker, stages, the outcome slot, and the named lock against the held file
after observation and immediately before hard-link publication. The original
post-append check remains. Physical evidence must be canonical JSON before
it is recorded, so tuple values, non-string keys and NaN cannot produce an
unreadable durable record. Protocol-compliant root actors are excluded by
the held root ledger lock; an out-of-protocol privileged writer remains
outside that fence and is not claimed to be atomically excluded. Decline
records produced by the earlier source-only PR #185 lack the new evidence
field and cannot be replayed by this format. No production records exist:
the macOS-root decline tripwire has stayed closed throughout both slices.

## D53 — Separate read-only root inspection from recovery (2026-10-01 20:47 EDT)

The eventual physical observer needs the root ledger head without taking an
action. The ordinary journal constructor takes exclusive ownership and its
reader settles pending files, so it cannot serve an observe-only command.
`inspect_readonly` opens an existing ledger directory without creating it,
takes a nonblocking shared lock, validates a complete chain, and reports only
the site/ledger presence, head, count, terminal event and transaction. Any
pending record refuses and remains untouched, including a published
two-link pending record. An exclusive active driver also refuses. A missing
site and ledger are observable as absent, not fabricated as an empty
transaction. This provides one non-mutating input to the future fixed-path
observer; it does not perform launchd/process/store census or authorize
production decline.

## D54 — Bind observe-only reads to the locked directory (2026-10-01 20:53 EDT)

Claude's PR #187 probe replaced the ledger pathname with a valid older copy
after `inspect_readonly` had locked the original directory. A path-based read
could then report the old `returned` event while the held directory contained
an active intent. The read-only path now lists and opens records relative to
the held directory descriptor, compares each opened record with its named
identity, and rechecks the site and ledger directory identities before
returning. The report calls the final record `last_event`, since an active
intent is not a terminal outcome. It declares `scope: ledger-only` and uses
`site_directory`/`ledger_directory` names: directory presence is not marker,
stage, lock or process absence. Owned before-read and after-read swaps
refuse. A privileged actor writing outside the ledger protocol could still
swap a name transiently between syscall checks; this is not a claim of
atomic exclusion from out-of-protocol root activity. The production physical
observer must bracket the complete launchd/process/store census under its
own pinned inputs before a decline is authorized.

## D55 — Bound read-only inspection to opened file types and identities (2026-10-01 22:01 EDT)

Claude's revised-head review of PR #187 found no blocker, but a FIFO named as
a ledger record could block the read-only inspector while it held the shared
ledger lock. An opened directory record could leak a descriptor. The reader
now opens each name nonblocking without a controlling terminal, rejects a
non-regular descriptor before wrapping it as a stream, and closes that
descriptor on every refusal. It checks record identity again after reading
and after chain validation. Site and ledger mode, owner, ACL and named
identity are checked against opened directories; disappearing paths become
`Refused`. A concurrent driver or inspector now reports a busy ledger rather
than claiming the other participant is an active driver. These are
observe-only source checks, not a physical NATS census or a production
cutover authorization. The protected macOS-root tripwire remains closed.

## D56 — Separate the live NATS census from cutover authorization (2026-10-01 22:20 EDT)

The first macOS physical-observation slice is a read-only census. It reads
the exact four legacy GUI and system launchd labels, the GUI disabled
overrides, the loaded plists, kernel NATS process identities and arguments,
open vnode identities, and the four distinct JetStream store trees. A
running GUI job must match the arguments of its loaded plist. The report
contains hashes of argument vectors rather than their values and declares
`scope: live-census-only`; inaccessible PIDs are counted, not silently
treated as absent. On the live node after reboot it observes three running
legacy jobs, a disabled and unloaded member 1, and no system-domain jobs.

This census is not a root-owned installation, a stable cold-master receipt,
or a physical-absence verdict. It has no callback into `decline` and cannot
lift the macOS-root gate. The remaining observer must run from protected
pinned code and inputs, cover all legacy mutators and unlinked store holders,
bracket launchd/process/store checks under the writer lock, and refuse any
unobservable or ambiguous state. It must also verify the protected jobs and
marker before any cutover action. The current user-owned GUI topology stays
unchanged.

Claude's first-head review found that an empty process or vnode list could
look like proof of absence despite unreadable processes, other launchd
domains, unlinked files and observation churn. The revised report explicitly
names the checked domains and holder subset, states that unloaded plists and
other domains are unchecked, and says physical absence is not certified.
Loaded launchd arguments are compared with the plist even for waiting jobs;
the raw arguments are removed before output. Both older boolean and newer
named disabled-override values are accepted, while unknown values refuse.
Plist arguments containing control or Unicode line-separator characters
refuse; loaded arguments are checked as launchctl renders them, but an
embedded newline can be indistinguishable from two arguments for a waiting
job. The report declares that limit. Reported
argument and plist-content digests use a fresh private HMAC key per scan so
they do not expose an offline guess oracle for future low-entropy secrets.

## D57 — Refuse malformed observe-only ledger input uniformly (2026-10-01 22:33 EDT)

The read-only root ledger inspector must return `Refused` for malformed
records rather than let JSON recursion or a schema type error escape into a
future physical observer. It maps only the parsing and schema exception
classes; existing specific `Refused` reasons remain intact. Before opening a
record from the held directory, it also checks the named entry's type, so a
pre-existing device or FIFO is rejected without invoking that entry's open
behavior. The descriptor type and identity checks still decide any race
after this preliminary check. This changes no root write or recovery path,
and it does not authorize production decline.

Claude's review also found a rehashed non-string transaction escaping through
`uuid.UUID` as `AttributeError`. Both intent and decline validators now
require a string before parsing, and the observe-only boundary maps any
remaining `AttributeError` to `Refused`. This leaves the driver path with an
explicit schema refusal and the diagnostic inspector with a uniform failure.

## D58 — Report readable store holders without an absence verdict (2026-10-01 23:04 EDT)

The next diagnostic slice scans vnode descriptors for every process name it
can read, not only `nats-server`. It matches linked store entries by device
and inode and can identify an unlinked handle when the kernel retains a path
under one of the four store roots. Unlinked handles on a store device with no
attributable path are counted separately. Inaccessible PIDs and a changed PID
list remain visible in the report. The scan does not establish a single
instant or physical absence, and has no path into the root decline callback.
Root-run protected observation and writer-lock bracketing are still required
before any migration decision.

Claude's exact-head challenge found that resolving a retained kernel path
against the current filesystem could turn an unrelated deleted file into a
false store holder if its former directory became a symlink. Path comparison
is now lexical. An unlinked descriptor can match its retained path; a linked
descriptor missing from the earlier store walk only matches after a fresh
directory-descriptor traversal with no-follow opens at every component and a
final no-follow stat confirms the kernel device/inode. The opened store root
must still have its walked identity. This avoids traversing arbitrary observed
process paths while finding files created after the walk and refusing a
symlink inserted inside the store. A failed process snapshot is retried once,
then separated into exited or still-unreadable PIDs. The report states that it
covers open vnode file descriptors, not closed-descriptor mappings, cwd/root
references, or in-flight descriptors. Alternate firmlink or case spellings
can remain unattributed. None of these diagnostic observations certifies
physical absence.

## D59 — Reject malformed returned-lock data in the root driver (2026-10-01 23:16 EDT)

A rehashed `returned` record whose `lock` was a JSON scalar escaped the root
driver's ledger validation as a raw `TypeError` at `set(lock)`. The driver now
requires a dictionary before checking its fields, so the ledger refuses with
the existing incomplete-return reason. A direct driver-constructor control
also pins the D57 non-string transaction refusal; the observer's broad
exception mapping alone would not prove that driver behavior. These are
schema refusals on source and owned fixtures. They do not create a physical
absence verdict, change live NATS state, or lift the protected-root gate.

The direct driver also refuses non-finite JSON constants and recursive raw
records. Parsing rejects `NaN` and infinities before chain validation, and
both parse and canonical chain-encoding depth errors become `Refused`. An
interrupted pending record with excessive depth remains ambiguous rather than
escaping as an unhandled exception. This protects the refusal boundary for
malformed bytes; it does not assert that the ledger is physically complete.

## D60 — Pin the idle Tailscale helper as an explicit full-node exclusion (2026-10-02 08:00 EDT)

The root-managed `com.openclaw.tailscale-up` job may be excluded from the
23-unit preservation cohort only while its exact one-shot plist is installed
at the system path, loaded only in the system domain, enabled, idle, and last
exited successfully. The plist key set is limited to `Label`, exact
`ProgramArguments`, and `RunAtLoad=true`; its loaded program, arguments,
properties, and domain must agree. The root-owned wrapper and protected
ancestors are checked, and the Tailscale app must retain the vendor signature.
The baseline saves the plist, wrapper, app and boot identities together with
launchd's run count. Every forward inventory compares that exclusion exactly.
The root transfer reader accepts the same strict excluded-job schema and boot
identity. A new run, changed app, changed disable state, or missing job ends
the user journal's forward window. That window ends at the NATS transfer
intent; root-held transfer needs its own continuous observer before any cold
master or cutover acceptance. Recovery records a fresh exclusion anchor and a
durable `excluded_unchanged_since_baseline` boolean before restoring services.
It is false for a changed or unobserved helper, including a run after transfer
intent, and must not be read as permission to certify the interrupted window.
The user journal's full-node completion is restoration, not cold-master
acceptance. Root-side observation must decide acceptance before restoration
begins; no reader may turn a `recovery-started` true into a certificate, and a
later true value cannot erase an earlier false.
Recovery then requires the new anchor unchanged through final verification and
resolution.
This lets a reboot or vendor app update be reported and restored without
claiming the original forward window stayed certified. The managed cohort's
original static identity still applies. Other `com.openclaw.*` jobs remain
unknown and refuse; this does not exclude or retire `com.openclaw.agent`.

The no-run argument assumes no out-of-band root `bootout` followed by
`bootstrap` of this label during the preservation window: launchd can reset
its run counter to the same value after such a reload. The physical driver
still needs the continuous launchd/process watch and operator control over
root service changes. The source exclusion alone does not authorize a full-node
journal, healthy NATS stop, protected root bootstrap, or acceptance of 1.2.

## D61 — Apply old-writer exclusion to every full-node NATS recovery (2026-10-02 11:08 EDT)

The user journal previously checked the protected marker and held the shared
old-writer lock only after a returned NATS transfer. A full-node restoration
without any transfer could observe or restart the three legacy servers without
that check. Recovery of a full-node-scoped journal, or an older unscoped journal
with installed NATS units, now refuses an existing marker before its first
write. The hold's preparation, each NATS unit's observation, possible
restoration and verification (including the held member 1), the final physical
check, hold completion and gate reopening, and resolution run under the shared
old-writer lock when it exists. An exclusive root holder or a published marker
therefore refuses at entry. Before the root lock is staged, the guard checks
that both marker and lock remain absent on exit. A crash before transfer must
remain recoverable in this lock-free phase: the root protocol cannot begin
without a durable user transfer, and its user-transfer reader cannot acquire
`node.lock` while this journal recovers. Making the root lock mandatory for
recovery would strand such a pre-transfer journal.
The guard also supplies a fresh check immediately before a legacy restart,
inside the gate's final before-open check, and immediately before a terminal
row. A later detection cannot undo a restart, gate unlink or terminal append:
recovery records `after_commit=restore` or `after_commit=gate-open` as
appropriate, using the observed gate marker even if `hold-opened` was not
written. If that write fails and makes the journal sticky, recovery raises
`CommittedRefusal` naming the opened gate instead of attempting another
durable row; a fresh session must inspect the gate and journal. Finalization
raises `CommittedRefusal` with the terminal hash once
the row is durable, so a caller cannot interpret a post-commit refusal as
proof that nothing happened. These checks detect an out-of-protocol privileged
writer; the node lock and transfer rule are the pre-bootstrap exclusion.
This user-side guard does not substitute for root physical observation or
authorize migration. Owned controls hold the lock exclusively, publish a test
marker, and create or replace the lock mid-action to prove refusal. Private test fixtures
must never read or create the production marker or lock. The
production full-node driver, complete readiness checks, legacy root-job
retirement, healthy cold masters, and cutover remain open at 1.2.

## D62 — Planned VM reboot requires a persistent full-node hold (2026-10-04 23:31 EDT)

D8's bootout-only restoration describes an interrupted preservation window,
not the planned stopped-VM capture path. In that path the original guest stays
powered off while all three serving histories are extracted, restored in
isolation, accepted and frozen. Alternatively, an explicit failed-capture or
failed-acceptance abort may permit a later boot only after host cleanup and a
checked decision to restore the prior node without claiming a new recovery
point. This follows `STOPPED_VM_COLD_MASTER_CANDIDATE.md`.

Bootout-only jobs may start at login before the recovery controller runs;
`already-restored` records their current state without enforcing the
dependency or deploy-listener order. It therefore cannot certify the planned
shutdown or authorize acceptance.

Before a production stop, a full-node controller must durably record the
baseline and persistently fence every approved job that could write or launch
another writer across a guest boot, including NATS, clients, viewer, gateway,
deploy listener, and the five timer jobs. The timers' existing on-disk
execution gate does not excuse an unplanned `RunAtLoad` start at login. The
controller must prove the root-managed legacy agent is retired or held and
that excluded jobs remain unchanged within the preservation window. At the
later boot, D60 requires a fresh exclusion anchor for the Tailscale helper;
its expected `RunAtLoad` execution is not a cohort restart.
The exact disable, unload, and re-enable mechanism needs a disposable-VM
reboot rehearsal; no point-in-time launchd inventory is a continuous
no-restart certificate. The controller must keep the deploy listener fenced
until deploy-marker/HEAD and pending-deploy checks pass, then restore it last.
A reboot ends the live quiet window. The controller must keep the captured
evidence and choose the accepted cold-master path or the explicit abort before
the later boot. Before calling `Journal.recover()` it must independently
compare the actual boot-time jobs and processes with the recorded hold and
refuse unexpected starts;
`already-restored` is not a substitute for that check. The decision and its
physical checks must precede any reopening of the execution gate or service
restoration. An unexpected auto-start refuses the path rather than becoming
an `already-restored` success.

The full-node production driver, continuous watch, detached-process coverage,
other launch-path census, host UTM autostart control, disposable rehearsal and
real-history acceptance remain unimplemented. This decision changes no live
job, VM, store, or permission and leaves 1.2 [A]/v1.2-pre.

## D63 — Bind image extraction to a completed source guard (2026-10-04 23:59 EDT)

The stopped-VM capture worker must refuse to clone until a completed
`GUARD.json` and its matching intent and post-guard stopped/no-holder
preflight exist in the same private capture directory. It rechecks the
guarded source and the receipt hash at each later sampling boundary and
records that hash in `CAPTURE.json`. `clonefile` inherits `UF_IMMUTABLE`, so
the worker clears the flag on the verified clone inode only before read-only
extraction; the original source stays guarded until separate reconciliation.
The guest/host tree matcher refuses a missing or changed guard receipt against
the capture receipt's pinned hash. Failed-capture cleanup clears the inherited
flag on a verified, unattached clone before unlinking it.
The capture wait must observe the guard within its stopped/no-holder polling
loop and take a fresh pre-clone preflight. Completed-capture disposal must
likewise refuse an open or attached clone before unlinking it.
Before any guard intent is written, a failed transient preflight may be
retried in a fresh preflight directory within the same armed attempt. Once
the intent exists, the guard remains one-shot and reconciliation is required.
Reconciliation must also check the host disk-image inventory even when the
clone path is absent, before clearing the source flag; an attached image may
survive an external unlink of its pathname.
Host preflight must check the disk-image attachment inventory for the source
as well as process holders; user-level `lsof` did not report an attached
disposable ASIF. The guard refuses a terminal capture attempt and publishes
its intent atomically before setting the source flag. A torn temporary
intent leaves no final intent or flag and can be retried.
The guard now holds the armed receipt lock from its final terminal check
through immutable flagging and `GUARD.json` publication. Reconciliation takes
that same lock before reading the intent and keeps it through its terminal
receipt. A guard paused after intent publication therefore cannot race a
`BOOTABLE` receipt and later re-guard the source within one attempt directory.
The capture worker now owns an attempt-local activity lock from before arming
through its terminal-write attempt; reconciliation refuses while that lock is held,
before reading the guard or touching the clone or source flag. After arming,
capture publishes `FAILED.json` or `CAPTURE.json` under the armed receipt lock,
ordering its terminal state with the guard. These locks do not exclude a
sibling capture attempt against the same source. A killed worker releases the
activity lock without a terminal receipt; the guard now probes that lock
without waiting before publishing intent and refuses when the lock is free.
A concurrent reconciler may also hold that lock, but the armed receipt lock
then orders the guard and reconciler before the latter clears the source flag.
Reconciliation may proceed as crash recovery, subject to its physical checks.
Child processes started by the worker remain outside the lock. Never
wait on the activity lock while holding the armed receipt lock. A source-wide
controller and no-intent abort path remain production gates.
Missing or changed guard evidence refuses the attempt without accepting a
cold master. The check does not prove continuous exclusion of a same-owner
writer or replace the missing full-node hold and real UTM rehearsal.

## D64 — Refuse full-node journal recovery across reboot until the boot hold exists (2026-10-05 03:16 EDT)

D62 requires a durable boot decision and a verified persistent hold before
full-node restoration after a planned VM shutdown. That controller does not
exist yet. `Journal.recover()` previously accepted a unit that had restarted
at login as `already-restored` whenever its sampled state matched the saved
baseline, without proving the writer remained fenced or that dependency order
was respected. Until the boot-time controller and its evidence contract are
implemented, a full-node journal opened in a different boot session refuses
recovery before observation, mutation, or receipt append. This is a temporary
fail-closed boundary, not a recovery mechanism or proof of a full-node hold.
Timer and legacy-scope interrupted restoration retain their existing behavior.
No production service or VM is changed, and step 1.2 stays [A]/v1.2-pre.

## D65 — Reject a cold-probe output nested in a master through a symlinked ancestor (2026-10-05 03:29 EDT)

The isolated four-history probe used a lexical overlap check after creating
its output directory. A symlinked ancestor of an otherwise absent output path
could point inside a cold master, so even the initial directory creation could
alter that master before the overlap check ran. Resolve the nearest existing
output ancestor and each master to physical paths, reject equal or nested
paths before creating output, then verify the created path resolves as planned.
The disposable four-history fixture now supplies a symlink alias into a frozen
master and requires refusal without creating the output or changing the master
hash. This is path isolation for the mechanism probe, not production history
acceptance or protection against a concurrent same-owner filesystem rewrite.
No production history was copied or changed; step 1.2 remains [A]/v1.2-pre.

## D66 — Require the held R1 set to cover every offline assignment (2026-10-05 05:31 EDT)

The isolated cold-tree probe previously accepted `held.streams` as a subset
of `cluster.offline`. An omitted member-1-only R1 stream would not be compared
on the held standalone boot or after rejoin. Before starting any isolated
server, require the declared held set, the serving members' offline set, and
the held baseline's R1 snapshot set to be equal. A disposable negative fixture
marks another stream R1 in the held baseline while omitting it from the plan;
the probe now refuses at validation, with the source master hash unchanged.
This checks set completeness relative to the supplied baselines. It does not
independently prove the member-1 baseline's history, verify each serving
replica locally, or close production acceptance. Step 1.2 stays [A]/v1.2-pre.

## D67 — Close the owned process census over orphaned group members (2026-10-05 05:39 EDT)

The launchd stop watcher enumerated descendants of the owner before adding
all processes in the owner's process group. A helper reparented to PID 1 but
still in that group could have a live child in another group; the child was
absent from the watch and later survivor check. Seed the closure with the
owner's whole group, then recursively include every child's descendants.
A cross-platform four-process regression pins the orphaned-helper case, and
the owned macOS launchd suite passes 26 tests (one existing skip). This fixes
the scoped tree census. It does not prove an exhaustive census of unrelated
detached writers or a full-node hold; step 1.2 remains [A]/v1.2-pre.

## D68 — Precheck held units before full-node restoration and withhold the deployer after errors (2026-10-05 05:47 EDT)

Full-node recovery previously restored serving NATS members and clients before
checking that member 1 and federation-tick were still held. Verify both held
units under the legacy NATS guard before the ordered restore loop; if either
has changed, issue no restoration intent. Separately, a failure of a prior
service or entrypoint check must keep mesh-deploy-listener from being restored
by the same attempt. Keep D23's recovery of independently verified ordinary
units after entrypoint drift; only the deployer is withheld. Two negative
journal tests pin the member-1-first and gateway-failure cases, and the full
journal suite passes 99/99.

This is sampled ordering, not a continuous member-1 exclusion. A clean-path
listener is still restored before the final physical check, and there is no
durable pending-deploy fence or full-node driver. Those remain production
resumption gates; step 1.2 stays [A]/v1.2-pre.

## D69 — Exercise the actual omitted-R1 plan with two held streams (2026-10-05 06:59 EDT)

Claude confirmed D66's set-equality code closes the omitted-R1 path, but its
first negative fixture only altered the held baseline. The disposable cluster
now assigns a second empty R1 stream to the same member by a unique server tag.
Both serving baselines observe both streams offline, and the held baseline
records both as R1. A plan declaring only the first must refuse at the
`held.streams` equality check before any isolated server starts, with the
source master hash unchanged. The positive four-history fixture still passes
with both R1 streams. This closes the test gap in D66; it does not address
per-member replica reads or offline consumer placeholders. Step 1.2 remains
[A]/v1.2-pre, with no production store changed.

## D70 — Refuse unavailable R1 consumer positions in cold baselines (2026-10-05 07:10 EDT)

When an R1 durable consumer is hosted only by a stopped member but its R3
stream remains online, NATS 2.12.6 can return a `CONSUMER.LIST` placeholder
with an empty `name`, zero positions, and a `missing` entry. The shared
`consumerState()` conversion now refuses an empty name instead of recording
that placeholder as a real consumer position. The disposable three-member
fixture creates an R1 durable on an R3 stream, acknowledges a message, stops
that consumer's owner, observes the actual placeholder and `missing` entry,
and requires `take_cold_baseline` to write `FAILED.json` without a manifest.
It restarts the owned member and then completes the four-history positive
probe with all owned processes stopped. This closes the observed false
acceptance on NATS 2.12.6. It does not establish per-member replica contents,
independent knowledge of every expected consumer, or production acceptance.
No production NATS member or history was touched; step 1.2 stays [A]/v1.2-pre.

## D71 — Close the owned stop census over descendant process groups (2026-10-05 07:31 EDT)

Claude's review of D67 found that a descendant could create its own process
group and leave an orphan there. The original closure added children of the
owner's group but did not add other members of a newly discovered group.
Compute the fixed point over both parent-child edges and process-group
membership. The stop watcher records every bound group's ID, refuses a group
change in its pre-signal sample, and checks each recorded group for survivors
after bootout. Synthetic orphaned-group and unrelated-session cases, plus a
survivor-refusal test, pass; the complete owned macOS launchd suite passes
29 tests with one existing skip. A fully detached group with no member
reachable at binding remains outside this tree census, as do unowned writers,
root/user jobs and reboot persistence. No production unit was stopped and
step 1.2 remains [A]/v1.2-pre.

## D72 — Refuse missing-only consumer inventories before recording a cold history (2026-10-05 07:41 EDT)

Claude's independent review found a second NATS 2.12.6 consumer-loss shape:
when an R2 durable's leader is stopped but its R3 stream stays online, the
raw `CONSUMER.LIST` reports the durable in `missing` while returning no
consumer row. The JetStream client iterator silently presents an empty list,
so D70's empty-name refusal alone can record a false baseline. Use one raw,
paginated consumer lister for cold baselines, snapshot manifests and stream
captures. Refuse any `missing` names, incomplete or changing pagination,
empty-name placeholders and duplicate names before writing a successful
manifest. One owned three-member NATS run with an acknowledged R2 durable
observed the missing-only response after its leader stopped, and the cold
baseline wrote `FAILED.json` without a manifest. Repeated attempts were not
deterministic: the consumer-list request sometimes timed out instead of
returning the missing-only shape. The automated regression therefore injects
that exact raw response into the shared lister; the existing real R1
placeholder case still refuses, and the positive four-history fixture passes
with all owned servers stopped. This closes the two observed consumer-list
false acceptances in code, not independent discovery of an entirely absent
consumer, per-member replica validation or production acceptance.
No production history or service changed; step 1.2 stays [A]/v1.2-pre.

## D73 — Recheck excluded member and federation job after service restoration (2026-10-05 07:54 EDT)

Claude found that D68 moved the `nats-1` and `federation-tick` check before the
restoration loop and inadvertently removed the post-loop check in full-node
recovery. The early check prevents restoring any service when the hold is
already broken, but an override can change while other services are being
restored. Run the same held-unit observation again after the loop, before the
final-state receipt or execution-hold reopening. The owned regression flips
each held unit when `nats-2` is restored and requires `restored: false`, a
named error and no `execution-hold-restored` record. The full journal suite
passes 100 tests. This samples and detects a late change; it does not prove
continuous member-1 exclusion or prevent a transient rejoin. No production
job was changed; step 1.2 remains [A]/v1.2-pre.

## D74 — Give the missing-consumer fixture the server's full list window (2026-10-05 08:09 EDT)

Claude reproduced the R2 missing-only response in three owned NATS 2.12.6
trials. Its consumer-list gather takes about four seconds: a one-second client
request always timed out, whereas a ten-second request returned `total: 1`,
no rows and `missing: [r2c]`, and `take_cold_baseline` refused without a
manifest. That explains D72's intermittent real fixture when its helper used
a one-second timeout. Restore the normal ten-second request deadline, retry a
transient JetStream 503 after leader loss, and make the automated fixture
again require a real acknowledged R2 consumer to yield the missing-only
response. Both the cold baseline and the snapshot command must refuse with
the consumer named and no success manifest. The injected raw-response
negative remains as a small direct parser control. The complete owned
four-history fixture passes with all servers stopped. This corrects D72's
fixture-evidence limitation; it does not resolve the per-member replica or
full-node hold gates. No production NATS member was touched and step 1.2
remains [A]/v1.2-pre.

## D75 — Retain completed-capture evidence until an acceptance or abort decision (2026-10-05 09:13 EDT)

The existing completed-capture disposal and reconciliation paths could delete
the only image clone before `stopped_tree_match.py` used it, then clear the
source image's immutable flag without a historical acceptance or explicit
abort decision. Until that decision controller exists, completed-capture
disposal now refuses after its source/clone and holder checks, leaving the
clone intact. Reconciliation still checks a completed capture's source hash
but refuses before clone removal or source unlock. Its no-`CAPTURE.json`
interrupted-guard path and failed-clone cleanup remain available. The owned
macOS fixtures require refusal receipts, an intact clone and an immutable
source after a completed capture; the host test group passes 10/10. This is a
fail-closed evidence boundary, not an acceptance, abort, boot controller or
proof that UTM respects the source flag. No production VM, service or NATS
store was touched; step 1.2 remains [A]/v1.2-pre.

Claude's read-only challenge found that previously staged host tool copies
could still accept the old `CAPTURE.json` scope, that a sibling attempt could
unlock the source after a completed capture lost its clone pathname, and that
this slice gives a completed capture no safe terminal transition. The capture
receipt now uses a new scope shared by the worker, matcher, disposal and
reconciler; older staged tools refuse it after publication. The sibling scan
also refuses any completed receipt, even if its clone is absent. Production
capture entry refuses before output creation until a durable decision
controller exists. Old staged tool packages still require retirement before
production use because they can act before receipt publication. These are
fail-closed source changes and fixture evidence only; they do not certify a
production capture or VM boot.

## D76 — Bound launchd status inspection during a managed stop (2026-10-05 11:50 EDT)

The managed stop and recovery paths inspect each launchd job through
`Launchd.status()`. Unlike the other managed commands, its `launchctl print`
call had no deadline, so a hung inspection could strand a partly applied
full-node hold or restoration without producing a refusal. Give it the same
ten-second deadline as `command()`. A mocked timeout regression requires the
deadline to be passed and the inspection to fail rather than yield a loaded
or unloaded status. The owned preflight tests pass. This bounds only this
inspection; it does not prove persistent disablement, process coverage,
shutdown, or service resumption. No production job or VM changed and step 1.2
remains [A]/v1.2-pre.

## D77 — Gate the deploy listener on final recovery evidence (2026-10-05 12:13 EDT)

Claude's read-only review reproduced a full-node recovery error: the deploy
listener could start before the second held-unit check, final physical check,
loaded-job equality check, or execution-hold readiness failed. It could also
be treated as already restored after this journal stopped it and it restarted
outside the release sequence. Keep the listener in the resume order, but run
the second held-unit check before it and require a new, explicit deploy-fence
callback for every full-node recovery before recording any recovery row.
Immediately before listener release, under one NATS guard, re-observe the
other 22 units, check physical ownership, compare the loaded-job set with the
saved set excluding the listener, run the fence, and durably record
`listener-release-verified`. Only then may a restoration intent start the
listener. If it is already running, record `already-restored` only after the
same gate, and refuse an unapproved restart after a listener intent.

The owned journal suite passes 106 tests. New negative fixtures keep the
listener stopped after physical, held-unit, service-readiness, loaded-job or
fence failure or a failed release-record write; a positive fixture checks
the durable release row precedes the listener restore. No failed-release
fixture calls `hold.complete`. The
callback is a contract, not a production implementation: the full-node
driver must still check the signed latest deploy marker, local HEAD and
deployment records, pending work and deploy processes using the listener's
actual environment, and refuse unobservable inputs. The forward stop order
is not yet enforced, and the complete physical hold and production resumption
remain open. No production service, VM or NATS store changed; step 1.2 stays
[A]/v1.2-pre.

## D78 — Hold the NATS exclusion across deploy-listener release (2026-10-05 12:29 EDT)

Claude's exact-head review caught a D77 error: the listener's release gate
ran inside the restore loop's per-unit context, but that context was a no-op
for `mesh-deploy-listener` because it only selected the NATS transfer units.
Include the listener in the legacy NATS guard for full-node recovery. Its
precommit check, physical and entrypoint checks, deploy-fence callback,
durable release row and listener restore now share the same lock interval.
The owned clean-path test attempts an exclusive writer lock from another
process inside both the fence and restore callbacks and requires refusal.
The journal suite passes 106 tests. This proves the local lock boundary,
not a production deploy fence or continuous full-node hold. No production
service, VM or NATS store changed; step 1.2 stays [A]/v1.2-pre.

## D79 — Require a completed listener restoration before trusting a prior release (2026-10-05 12:40 EDT)

Claude's exact-head review found that a crash after
`listener-release-verified` but before the listener's restoration could let
an out-of-band restart be treated as already restored on the next recovery.
The preflight now compares the latest forward listener intent with a later
`recovery-verified` or `already-restored` row for that listener, not merely
with a release row. A release receipt alone does not certify a completed
restart. The owned negative simulates that crash and outside restart and
requires refusal before the deploy fence or any restore. Other refusal tests
now count fence, completion and restore calls instead of relying on
`self.fail()` exceptions that `recover()` catches; they also pin a listener
started during recovery. The journal suite passes 107 tests. This is owned
fixture evidence, not a production deploy fence, full-node hold, stopped-VM
decision or service resumption. No production service, VM or NATS store
changed; step 1.2 stays [A]/v1.2-pre.

## D80 — Pin listener precommit and retain the conservative retry boundary (2026-10-05 13:05 EDT)

Claude's read-only review of `f72fdaa1` found no new journal release
blocker, but a mutation that skipped the listener's NATS `precommit()` still
passed the existing suites. A new owned negative now creates the root handoff
marker inside the deploy fence and requires zero listener restores; it fails
if the precommit check is skipped. Another owned test starts the listener
through the journal, makes its readiness step fail, then verifies that a
retry refuses while the listener remains running and succeeds only after it
is stopped. The refusal text now names the missing durable restoration proof
and required stop instead of claiming the listener started before release.

The conservative retry can also refuse a listener that the journal did
legitimately start if the subsequent verification or receipt write failed.
That ambiguity is intentional for now: an outside start during the release
window can leave the same durable rows. A future production adapter must
refuse an already-running listener at start time, and a verified start step
with its own durable receipt may narrow the retry boundary. The complete
full-node hold and deploy fence remain prerequisites to production release.
No production service, VM or NATS store changed; step 1.2 stays [A]/v1.2-pre.

## D81 — Require a durable, persistently disabled listener stop before full-node work (2026-10-05 14:06 EDT)

The full-node journal previously accepted any forward mutation order even
though STOP_ORDER starts with the deploy listener. Require the execution-hold
anchor as the first verified intent, then one `disable-and-unload` listener
intent with a matching verified receipt before any other service mutation.
The listener receipt must report successful bootout, normal owner termination,
no remaining descendants, connections or listeners, and a verified launchd
disabled override. The journal checks the listener's loaded-set removal around
verification and rechecks the durable receipt before later work. NATS transfer
performs the same check because it can write an intent without `mutate()`.

Claude independently reproduced the order gap and NATS-transfer bypass using
owned fixtures. The journal suite passes 113 tests, including negatives for
NATS before the listener, a bare `stop`, a second listener stop, incomplete
disable/bootout/termination proof, and forged NATS receipts without the
listener fence. The hold suite passes 43 tests. A restore-only full-suite run
had one final-readiness failure in a loaded-daemon fixture; that single test
passed on isolated rerun, and a second full-suite run passed 30/30. This is
journal contract and disposable-fixture evidence, not a production driver.
An end-to-end macOS test with the real hold and managed listener stop,
continuous restart exclusion, a deploy snapshot and release fence, stopped-VM
controller, four-history acceptance and service resumption remain open. No
production service, VM or NATS store changed; step 1.2 stays [A]/v1.2-pre.

The first CI run exposed a second NATS-transfer fixture that still stopped
NATS before the listener. Its simulated and native-hold paths now record the
listener stop first; all 10 root-admission fixture tests pass locally. The
native-hold path still uses simulated listener stop evidence, not a real
managed-process stop.

## D82 — Root admission independently validates listener-first transfer (2026-10-05 14:30 EDT)

Claude's exact-head read-only review of D81 found a root trust-boundary gap:
the user-side `transfer_nats()` refused a journal without a verified listener
stop, but root `UserTransfer` admitted a separately written transfer intent
after NATS stops with no listener rows. Root admission now requires the
original published hold as the first intent, one listener
`disable-and-unload` as the next intent, a matching verified receipt with
normal bootout and termination, disabled override, no surviving process or
network endpoints, and the original hold watch session. It requires the
listener to be absent from the recorded loaded set and each NATS stop intent
and receipt to follow that listener receipt. This is an independent root
check; it does not rely on the user-side journal method having run.

Owned negatives construct a well-formed transfer intent with no listener,
with a listener stopped after NATS, with a NATS intent inserted before the
listener proof, and with each stop-proof field invalid in turn. A separate
negative now reaches the original hold-certificate check
instead of being refused earlier for a missing publication. The root transfer
suite passes 15 tests, root admission 7, root decline 22, and the journal
suite 114. The listener stop and root proof are still disposable-fixture
evidence. Production transfer remains refused, and the full-node driver,
continuous hold, real VM capture, four-history acceptance and verified
resumption remain open. No production service, VM or NATS store changed;
step 1.2 stays [A]/v1.2-pre.

## D83 — Reject listener completion before its own intent (2026-10-05 14:44 EDT)

Claude's read-only follow-up on D82 found one remaining forged-journal order:
root admission selected a listener `verified` row by its `intent` value but
did not require the row to follow that intent. The user-side durable receipt
check had the same gap. Both now require the listener receipt sequence to be
after its own stop intent. Owned negatives reorder the same complete listener
rows without breaking the hash chain and require root refusal, and append a
future-intent listener receipt in the user journal and require refusal before
NATS unload. The root transfer fixture also mutates the session binding,
loaded-set proof, verified flag and bootout timeout; each refuses. These are
defensive checks against a buggy or separately written journal. The journal
suite passes 115 tests, root transfer 16, root admission 7 and root decline
22; plan lint is conformant. This is not evidence
that a real listener stop or production NATS transfer has occurred. No
production service, VM or NATS store changed; step 1.2 stays [A]/v1.2-pre.

## D84 — Compose a journaled managed listener stop with the execution hold (2026-10-05 15:52 EDT)

The D81 listener-first rule could not be met by `StopWatch.mutate()`: it
always recorded a plain `stop` and had no execution-hold facade. A persistent
managed stop now checks the bound full-node label, the original hold and the
enabled override before a durable intent; its journaled `apply` disables the
owned launchd job before bootout. The receipt uses `disable-and-unload`, with
the existing kernel, process, connection, listener, normal-exit and disabled
override proof. A failed stop records the observed disabled override, or a
named inspection failure, with the kernel evidence. An ordinary held stop
uses the facade with an `unload` receipt; a full-node listener cannot take
that path, and other full-node units cannot take the persistent path until
their enable-capable recovery adapter exists.

Claude challenged the draft composition with a wrong-unit watch, a held
plain-stop path, disabled-but-running failures and the missing macOS CI
coverage. The label binding and separate held-unload path address the first
two; the failure receipt now records the override observation. The complete
owned macOS managed-stop suite passes 36 tests with one explicit domain skip;
the journal and hold suites pass 158 tests. CI now installs the owned NATS
fixture dependencies and runs the managed-stop suite on macOS; exact-head CI
is pending. The positive owned job uses a journal-backed hold stub, so it
does not prove the native execution hold plus a real listener stop end to end.
No production service, VM or NATS store changed. The full-node driver,
continuous 23-job/root/user/detached-process exclusion, deploy fence, stopped
VM decision, four-history acceptance and verified resumption remain open;
step 1.2 stays [A]/v1.2-pre.

## D85 — Pin the owned stop fixture and its failure ordering (2026-10-05 16:07 EDT)

Claude's exact-head review of D84 found no blocker in the full-node path, but
the tests did not catch moving `disable_for_hold()` before the second
readiness check. An owned macOS job now changes readiness after the durable
intent and must remain enabled and running, with a failed receipt recording
`disabled_override_observed: false`. A Linux control refuses a foreign hold
before held unload, and another composes the actual `StopWatch.mutate()` with
a real full-node `Journal`, checking the listener-first fence and unload
action while simulating only launchd and the kernel watcher. The managed
suite passes 38 tests with one domain skip; the journal suite passes 116.

The macOS CI fixture now downloads NATS server 2.12.6 for the runner's
architecture and checks the release artifact's SHA-256 before extraction,
matching the Linux fixture's pinned server version. The previous D84 run was
still queued during review; exact-head CI for this correction remains
pending. The integration test uses a hold facade stub, and no native
execution hold plus real listener stop has yet run end to end. The legacy
scope's unit/label binding and the facade's journal-write trust remain
latent boundaries without a production `StopWatch` caller; full-node binding
is enforced before intent. No production service, VM or NATS history changed.
Step 1.2 remains [A]/v1.2-pre.

## D86 — Connect native stop evidence to the listener fence (2026-10-05 17:45 EDT)

Claude's D85 review found that the full-node journal composition test feeds
canned listener stop evidence to `Journal.listener_stop_proven()`. That test
checks ordering and fence behavior, but it does not constrain the actual
`StopWatch.verify()` evidence shape. The owned macOS persistent-stop test now
passes its real stop receipt into `Journal.listener_stop_proven()`. This
refuses missing proof keys and values that are truthy but not the required
booleans before such a receipt can anchor a full-node transfer. The native
launchd suite passes 38 tests with one domain skip, and plan lint is
conformant. D85's canceled CI jobs were rerun on the same head and all four
jobs passed; the macOS log ran 116 journal and 38 managed-stop tests with one
domain skip, and the pinned NATS download passed its checksum. D86's
exact-head CI remains pending;
full-node production hold, stopped-VM capture, four-history acceptance and
service resumption remain open. No production service, VM or NATS history
changed; step 1.2 remains [A]/v1.2-pre.

## D87 — Refuse an ungated installed timer before the hold (2026-10-05 19:55 EDT)

A closed execution-hold marker cannot stop a scheduled job whose installed
`ProgramArguments` bypasses `timer-entry.py`. For scoped timer commissioning
and full-node holds, `JournaledHold` now requires every baselined timer to
use the staged Python gate, the saved gate root and pins, its own label, and
the pinned manifest digest. It refuses an ungated observer before closing the
gate. The owned native hold suite passes 44 tests and the preservation journal
suite passes 116. D86's exact-head CI passed all four jobs. This validates
a static entry shape; continuous 23-job, root/user, detached-process and
host UTM autostart exclusion still need a production controller and rehearsal.
No production service, VM or NATS history changed; step 1.2 remains
[A]/v1.2-pre.

## D88 — Observe launchd disabled overrides throughout full-node forward work (2026-10-05 21:51 EDT)

A verified listener `disable-and-unload` receipt previously stayed "fenced"
after its launchd disabled override was cleared without reloading the job.
The loaded-label check could not see that change; a disposable journal and
managed-stop reproduction accepted the next mutation. The full-node
entrypoint census now reads `print-disabled` in the GUI, user and system
domains twice per observation, retaining every `ai.openclaw.*` and
`com.openclaw.*` override. The baseline requires the pre-held member 1 and
federation timer disabled in both user views, with no explicit system enable.
Every forward journal step compares the override maps with its last verified
receipt. A `disable-and-unload` may change only its own label to disabled;
the verified receipt records the observed maps. A cleared listener or
member-1 override, an unrelated label change, or an unexpected foreign-domain
enable refuses before the next intent or NATS transfer.

An owned macOS launchd control confirmed that disabling and re-enabling its
disposable GUI job changes both GUI and user `print-disabled` views. The
parser, listener re-enable, held-member drift, foreign-system-enable and
baseline negatives pass locally, along with the focused preservation suites.
The cross-process root transfer reader now requires the same listener
override proof and walks every verified receipt from the baseline through
the NATS stops. A `disable-and-unload` receipt must show its own label
disabled in both user views, preserve every other label and retain any
pre-existing system disable; the transfer intent binds a final observed
override map. A forged pre-listener hold receipt, an extra verified row, a
later NATS receipt claiming the held member was re-enabled, or a changed
transfer map refuses. The user journal applies the same two-view rule.
Disposable negatives isolate missing GUI and user disables, explicit system
enable, and each continuity boundary. This closes the receipt-continuity
gap in D88; it does not turn sampled observations into a continuous host fence.
This is sampled detection, not a persistent hold or continuous no-restart
certificate. The other installed jobs still lack disable-and-unload and an
enable-capable production restore; the root/user/detached-process and other
launch-path census, boot check, host guard rehearsal, capture decision
controller, four-history acceptance and resumption remain open. No production
service, VM or NATS store changed; step 1.2 remains [A]/v1.2-pre.

## D89 — Give idle timers a persistent-stop primitive (2026-10-05 22:58 EDT)

An idle timer unload previously lacked the opt-in disabled override needed
for a full-node boot hold. `unload_idle_timer` can now disable its owned GUI
job after a caller's durable stop intent, recheck that it stayed idle, then
boot it out. Its verifier requires the override to remain disabled as well
as unchanged logs and complete no-spawn evidence. A start during disable
refuses before bootout and leaves the override in place for safe recovery.
An owned macOS control waited one second, then showed that a direct launchd
bootstrap fails while the timer is disabled and succeeds after re-enable;
another control refuses an override lost before verification. The complete
managed-launchd suite passed 41 tests with one domain skip. The spawn
evidence in these owned controls is a fixture, not production watch proof.

This is a primitive, not a full-node driver or a reboot certificate. No
production caller yet journals all timer stops or re-enables the baselined
jobs; continuous launch-path and process coverage, disposable VM reboot,
host capture, four-history acceptance and verified resumption remain open.
No production service, VM or NATS store changed; step 1.2 stays [A]/v1.2-pre.

## D90 — Refuse a restarted stopped job before recovery mutates state (2026-10-05 23:09 EDT)

Claude's read-only D62 review demonstrated that `Journal.recover()` could
classify a job with a verified persistent stop as `already-restored` if it
reappeared running before recovery. That can turn an unexpected restart into
a successful restoration. Full-node recovery now walks stop intents and
later `recovery-verified` receipts before hold preparation or any new
journal/state write. It observes every stopped, unverified unit under the
legacy NATS guard and refuses if the unit is loaded or running, its observed
state is incomplete, or its identity changed. A failed or interrupted stop
intent also requires this preflight; an `already-restored` row does not
authorize an out-of-band restart. A prior verified restoration does.

Disposable tests show that a reappearing NATS server and deploy listener
are refused before any other restore or new journal record, including after
an incomplete listener release. The existing interrupted-listener test
still recovers after the listener is stopped again. The preservation
journal suite passed 127 tests. This is a same-boot recovery preflight; it
does not replace D62's independent boot-time hold check, continuous watch,
or an enable-capable production restore. No live service, VM or NATS store
changed; step 1.2 remains [A]/v1.2-pre.

## D91 — Require persistent stop actions throughout full-node transfer (2026-10-05 23:28 EDT)

A plain `unload` could previously be recorded as a verified full-node stop
after the deploy listener was fenced, even though launchd could load that
job again at login. Full-node `Journal.mutate()` now permits only the
execution-hold anchor or `disable-and-unload` for a baselined service. The
NATS user-to-root transfer also requires a verified persistent stop for each
serving member in both the user journal and the root reader. A disposable
negative refuses a plain NATS unload before `apply()` or a new intent; a
second negative makes the root reader refuse a plain-unload receipt.

The preservation journal suite passed 128 tests, the hold suite 44, and the
root transfer suite 21. This closes acceptance of a *plain-unload action*
as a full-node receipt. It does not prove that an arbitrary
`disable-and-unload` receipt contains the required per-class process and
launchd evidence, nor that all 21 loaded jobs were stopped. The existing
production stop refusal remains until an enable-capable restore and
complete hold certificate are proven. No live service, VM or NATS store
changed; step 1.2 stays [A]/v1.2-pre.

## D92 — Recheck stopped jobs during recovery (2026-10-05 23:53 EDT)

Claude's disposable review of D90 reproduced an out-of-band gateway restart
between its one-time preflight and the gateway's place in `RESUME_ORDER`.
Recovery then recorded `already-restored` without calling the restore
adapter. Full-node recovery now repeats the stopped-unit preflight after
`hold.prepare` and before its first state or journal write. It also checks
each unverified stopped unit again at its restore turn; if it reappeared
loaded or running, lost identity, or became unobservable, recovery records
an error and stops the restore loop
instead of accepting it as already restored or restoring later services.

Disposable tests restart the gateway during hold preparation and while the
loop observes `health-watch`. The first leaves journal bytes unchanged; the
second returns unrestored, does not call the restore adapter, and never
records `already-restored` for the gateway. The preservation suite passes
130 tests and the hold suite 44. This narrows a sampled recovery race; it
is not a continuous no-restart fence. A restore that started a service but
failed readiness still requires an operator-mediated stop before retry,
because the current journal cannot prove whether that running generation
came from its own restore or an outside launcher. D89's failed idle-timer
stop likewise needs a controlled repair path. Those remain open; no live
service, VM or NATS store changed, and step 1.2 stays [A]/v1.2-pre.

## D93 — Retain the persistent stop override through recovery (2026-10-06 00:12 EDT)

D92 rejected a stopped job that reappeared loaded or running, but accepted
one whose `disable-and-unload` override had been cleared while it remained
unloaded. Recovery's entrypoint check did not compare disabled overrides.
The stopped-unit preflight and per-unit check now require `disabled: true`
for a pending persistent stop. A disposable negative clears the gateway
override while it remains unloaded and confirms refusal before hold
preparation or a journal/state write. Earlier `stop` and `unload` receipts
remain subject to the D92 unloaded check; D91 already refuses new ones in
full-node scope.

Claude's independent review also found that an observation exception at a
stopped unit's restore turn bypassed D92's abort flag, allowing later units
to restore. Such an exception now aborts the restore loop. Owned tests make
the later viewer a stopped unit and show that neither a gateway restart nor
an unobservable gateway restores it. The hold-preparation negative now
checks the node receipt as well as journal rows. The preservation and hold
suites pass 176 tests, and plan lint is conformant (14 pass, one warning).
D92's exact-head CI passed
all four jobs on rerun; its first macOS attempt timed out waiting for an
owned service's readiness in the separate restore-only prototype.

These are sampled checks, not a continuous no-restart fence or a complete
full-node hold certificate. Failed-restore retry, reboot, stopped-VM
capture, four-history acceptance and verified production resumption remain
open. No live service, VM or NATS store changed; step 1.2 remains
[A]/v1.2-pre.

## D94 — Make the recovery-abort regression test reach restore (2026-10-06 00:23 EDT)

Claude's read-only D93 review found that the owned hold facade in the two
later-loop negatives lacked `before_restore` and `check_closed`. If the
recovery abort were removed, that missing method could prevent the later
viewer's restore callback and make the tests pass for the wrong reason.
Both facades now provide no-op restore hooks. The pristine tests pass; in a
disposable copy with the abort removed, both fail because `workplan-viewer`
is restored. The preservation and hold suites pass 176 tests, and plan lint
is conformant (14 pass, one warning). This is a test-fixture correction,
not a new production hold
capability. D93 exact-head CI passed four jobs before this correction; no
live service, VM or NATS store changed. Step 1.2 remains [A]/v1.2-pre.

## D95 — Keep an ambiguous enabled-unloaded retry fenced (2026-10-06 00:27 EDT)

Claude's read-only D93 review reproduced a restore that enables a stopped
job, then fails before bootstrap. The unit is unloaded and enabled. D93
refuses the retry, whereas D92 would have retried it. Do not exempt this
state merely because the journal has `restoration-intent`: an outside
`launchctl enable` after that intent is observationally identical, and a
login or reboot could then start the service in the unresolved window.
Current `Launchd.disable_for_hold()` requires a loaded unit, so the
production retry still needs a journaled, verifiable way to re-disable an
unloaded unit. Until that exists, recovery stays fenced and an operator
must reconcile the override. This is an explicit additional failed-restore
case under the existing step 1.2 gate, not accepted resumption evidence.

Correction to D93's CI description: the first macOS attempt raised
`TimeoutExpired` from an owned `launchctl` command. The owned restore-only
readiness loop would have converted its own timeout to `Refused`; the exact
command that timed out was not identified. The failed job passed on rerun.
No production service, VM or NATS store changed.

## D96 — Require managed stop proof for serving NATS transfer receipts (2026-10-06 01:04 EDT)

An owned full-node journal could record each serving NATS member as stopped
with only `verified: true`; the root transfer reader checked the action and
hold session but not the unload, process-absence, normal-termination,
connection, listener or bootout fields. Both sides now require the same
managed-stop evidence shape already
required for the deploy listener. The user journal refuses a weak NATS stop
before its verified row and rechecks the proof at transfer; the independent
root reader refuses weak or altered NATS receipts. Disposable negatives cover
a bare verified flag, false unload, failed bootout and abnormal termination.
The preservation journal suite passes 133 tests, the user-to-root and root
journal suites pass 88, and the owned macOS launchd suite passes 41 with one
domain skip. Plan lint is conformant with its existing idle-step warning.

This closes the bare-receipt acceptance gap for the three serving NATS
stops; it validates receipt fields, not their producer's provenance. The
other full-node units still lack per-class stop proof, an all-job
certificate and an enable-capable production restore. Claude's read-only
review of the prior green head identified those boundaries and the need to
place any future certificate after all stops but before NATS transfer; it did
not review this patch. No production service, VM or NATS store changed, and
step 1.2 remains [A]/v1.2-pre.

## D97 — Pin both NATS receipt validators and retain the physical-admission gate (2026-10-06 01:15 EDT)

Claude's read-only D96 challenge confirmed the receipt-shape refusal but found
that the new root negative could refuse on UID setup before reaching the NATS
predicate in a root-run test environment. The root test now validates a complete
unmodified reader first, then changes each serving member's receipt in memory
and requires the named NATS refusal. It covers failed and timed-out bootout,
missing unload and abnormal termination. A new user-journal negative hand-
appends a weak `nats-2` stop after the listener and requires `transfer_nats()`
to refuse without a transfer intent; otherwise the new `mutate()` guard alone
would make the transfer check untested. The preservation suite passes 134 tests
and user-to-root transfer passes 22. D96's exact-head CI passed all four jobs.

These checks still trust user-writable receipt fields. Root admission has
physical-observation and process-census hooks, but the live NATS and store-
holder censuses are not wired into them. A real NATS 2.12.6 stop under the
persistent `StopWatch` path has also not established its termination field;
the current owned launchd fixture runs a Node script. Both facts remain
production gates, alongside the all-job hold certificate and disposable
reboot. No production service, VM or NATS store changed; step 1.2 stays
[A]/v1.2-pre.

## D98 — Observe a real NATS persistent-stop exit on owned launchd (2026-10-06 02:56 EDT)

An owned macOS launchd job now starts the installed nats-server 2.12.6 with
JetStream storage, client and monitoring listeners under a fresh temporary
directory and loopback ports. `StopWatch` binds the running binary, config,
plist and logs, watches its kernel exit, disables its unique job label, and
boots it out. The observed owner exit was `{'exit': 0}` with wait status 0;
the NATS log contained one `Server Exiting` marker. Bootout returned 0, the
job was unloaded, an owned NATS client received EOF, its client listener
closed, and its disabled override remained set. `Journal.managed_stop_proven()`
accepted the resulting receipt.
The owned test cleanup re-enables the label. This gives D96 a real-server
termination control rather than only the Node-script control.
The owned launchd suite passes 42 tests with one unavailable user-domain
control skipped; plan lint is conformant (14 pass, one idle-step warning).

The owned client proves one connection closure, not production client-drain
evidence. The test calls `StopWatch` directly because full-node `mutate()` still
refuses persistent stops for NATS until an enable-capable recovery adapter
exists. No all-job certificate, root physical census, disposable reboot,
stopped-VM capture, four-history acceptance or production resumption is
claimed. No live service, VM or production NATS store changed; step 1.2
remains [A]/v1.2-pre.

## D99 — Pin the owned NATS version and exact normal exit (2026-10-06 03:10 EDT)

Claude's read-only review of D98 at 0ba99c3f reproduced the isolated
SIGTERM/EOF/marker behavior and confirmed that exact-head CI passed all four
jobs, including the 42-test macOS launchd suite. It also found that the
version and exit-0 statements in D98 were author observations: the test
accepted either normal `SIGTERM` or exit 0 and did not check `/varz.version`.
The owned test now requires `/varz.version == 2.12.6`,
`termination == {'exit': 0}`, and kernel wait status 0, so those claims become checked
regression evidence. The focused macOS test passes locally.

The fixture deliberately retains its temporary root, store, logs and
`proofs.json` for inspection. Normal teardown re-enables its unique launchd
label; a hard kill between disable and teardown can leave that throwaway
label disabled. The test uses a unique owned label, so it does not compose
with the full-node journal's `ai.openclaw.nats` label requirement. Neither
the root physical census nor the production stop/restore driver was
exercised. No live service, VM or production NATS store changed; step 1.2
remains [A]/v1.2-pre.

## D100 — Require class-specific full-node stop receipts (2026-10-06 05:09 EDT)

Every full-node `disable-and-unload` mutation now requires a persistent-stop
receipt matched to its prior-state class. Daemons require the managed
`StopWatch` unload, override, exit, descendant, connection and listener
fields. Timers require the idle-unload receipt with an intact override,
unchanged logs and complete zero-spawn evidence for that unit's launchd
label. The on-demand mesh agent and known-broken Discord integration may
use either shape because their observed loaded state can be idle or running.
The scheduler's separate `close-execution-hold` intent remains its anchor;
its later `disable-and-unload` uses the timer rule. The prior listener and
NATS-specific refusal messages are retained. An owned full-node journal
fixture stops all 21 loaded jobs with class-shaped receipts, and negatives
reject weak, cross-class, incorrect-label, incomplete and spawned timer
receipts. Existing recovery fixtures now supply realistic receipt shapes.
The preservation suite passes 136 tests, the journal-hold suite passes 44,
and plan lint is conformant (14 pass, one existing warning).

This is a receipt-shape gate after the stop action, not the all-job hold
certificate or physical proof. A mismatch writes a failed row and makes
forward work restore-only. `StopWatch.mutate` still refuses persistent
stops for non-listener jobs pending an enable-capable recovery adapter.
`unload_idle_timer` currently has no production spawn-evidence producer;
the strict timer shape remains unreachable there. A future certificate
must bind receipts to the original execution-hold watch session and fresh
entrypoint/physical observations. No production service, VM or NATS store
changed; step 1.2 remains [A]/v1.2-pre.

## D101 — Pin idle receipt clauses and delimit D100 reachability (2026-10-06 05:22 EDT)

Claude's read-only challenge of D100 at d4e63130 found no new false
acceptance or refusal in the receipt predicate. Exact-head CI run
37441636415 passed all four jobs. The owned negative test now rejects
`verified=False`, `unloaded=False`, changed logs and a prior job that was
not loaded, closing the four unpinned idle-receipt clauses.

D100 is not an adapter admission gate: a caller can invoke `Journal.mutate`
directly with a shaped receipt even though `StopWatch.mutate` refuses
persistent non-listener stops until recovery can re-enable them. A production
driver must not bypass that guard. Neither timer nor loaded-idle on-demand
or known-broken job has a production spawn-evidence producer, so the idle
shape cannot currently be issued for any of those classes. A rejected
receipt is also absent from the journal's failed row; this is a forensic
gap, not acceptance evidence. A future complete hold certificate must
bind every receipt to the original watch session and fresh physical state.
No live service, VM or NATS store changed; step 1.2 remains [A]/v1.2-pre.

## D102 — Retain rejected stop receipts in the failure chain (2026-10-06 09:00 EDT)

When `verify()` returns a serializable dictionary but a later journal check
refuses it, the durable `failed` row now keeps that exact candidate under
`rejected_evidence`. The existing adapter-supplied failure evidence remains
separate. This lets a restore operator distinguish an incomplete stop receipt
from a stop that produced no receipt, without treating the rejected proof as
verified. A focused full-node negative checks the persisted hash-chained row;
the journal and hold suites pass 180 tests. No production service, VM or NATS
history changed. The all-job certificate, physical admission and shutdown
gates remain open; step 1.2 remains [A]/v1.2-pre.

## D103 — Keep diagnostic failures from erasing stop failures (2026-10-06 09:12 EDT)

Claude's read-only review of D102 at 456ec93d confirmed that the rejected
receipt cannot be read as a verified one, while finding two untested cases:
an unverified candidate and an unserializable candidate. The negative fixture
now checks both after reopening the hash-chained journal. A failing diagnostic
callback raising an `Exception` no longer replaces the original stop refusal
or prevents a durable `failed` row; its exception type is recorded separately.
The row records a fixed failure stage instead of arbitrary exception text,
distinguishing receipt-shape refusal from later entrypoint drift without a
callback-provided message. The raw rejected candidate remains owner-private
and is retained only when JSON-serializable. This is restoration evidence,
not an all-job hold certificate or authority to stop the VM. No production
service, VM or NATS history changed; step 1.2 remains [A]/v1.2-pre.
`SystemExit` and `KeyboardInterrupt` still escape the mutation guard and
leave a pending intent; reopening remains restore-only in that case.

## D104 — Refuse the three owned cold-master false accepts (2026-10-06 15:16 EDT)

At 157ccc6a the unmodified isolated probe wrote `probe.json` when the two
serving masters were swapped. Claude independently reproduced that case,
a follower with its message blocks removed, and election-dependent acceptance
of a same-length flipped payload on disposable NATS 2.12.6 clusters. Each
member connection uses the stream leader's JetStream API, so two connections
alone do not verify two local copies.

The cold-tree plan now requires a per-role digest of the frozen master. The
probe compares it before boot, checks each surviving member's local stream
state through `/jsz` while that member has no quorum, then makes each member
lead every replicated active stream and compares the full stream capture
while it leads. The direct pre-stop baseline now binds its connection to the
matching loopback monitor and records the physical store directory. The owned
fixture passes with all servers stopped. Three negatives refuse swapped
paths before a working copy, removed message blocks before the pair forms,
and a flipped payload under forced leadership. Two additional flipped-payload
runs also refused at the member-read phase. The original masters remained
unchanged in every case.

This closes those false accepts in the isolated mechanism fixture, not
production acceptance. A plan author can still swap both a master path and
its self-declared digest. Production planning must derive each digest from
the MATCH-verified extraction role and check that role's guest path against
the recorded pre-stop monitor store directory. `MATCH.json` itself still has
the guest-provenance gap described in the review. The full-node hold,
stopped-VM capture, four real-history restores, acceptance and verified
resumption remain open. No production service, VM or NATS history changed;
step 1.2 remains [A]/v1.2-pre.

## D105 — Pin the leader epoch across each cold member read (2026-10-06 15:37 EDT)

Claude's read-only review of D104 independently passed its owned positive and
three corruption negatives. It found that checking the preferred stream leader
before and after `capture()` did not prove the leader stayed the same during
the read. The probe now requires `leader_since` to be present and unchanged
across each replicated stream capture, and records the actual leader and epoch
in `memberReads`. The positive fixture requires each recorded leader to equal
the intended member. This makes the evidence explain which copy served each
comparison and refuses a leader transfer, including a transfer away and back,
during the capture. The owned NATS 2.12.6 fixture passed on Node 22 with all
servers stopped.

The review found no D104 mechanism blocker. It confirmed that the plan digest
and stopped-tree role still need trusted provenance, and that expiring R1/KV
streams can refuse after their baseline ages. Those production acceptance
gates remain open. This change did not contact or modify the live node.

## D106 — Bind stopped-tree comparison to the same four-path specification (2026-10-06 16:49 EDT)

The host capture receipt now records the digest of the owner-private store
specification and refuses if that file changes during capture. The guest
stopped-tree manifest already records its specification digest. The host
matcher now requires those digests to agree, requires the guest content scope,
and requires the guest capture timestamp to precede the host image-guard
receipt. A disposable macOS ASIF fixture with member 1 and member 2 paths
swapped in the guest specification refuses before `MATCH.json`; altered scope
and late-timestamp negatives refuse too. The focused fixture and the eight-test
host capture suite pass.

This makes a path mismatch observable but does not authenticate the guest
manifest's origin. Someone with the same owner access could still produce a
matching specification and manifest on the host, and a stale manifest with
identical content and an earlier timestamp can still pass. Production capture
continues to refuse without its acceptance/abort controller. No VM, production
service or NATS store was stopped or changed; step 1.2 remains [A]/v1.2-pre.

## D107 — Hash the same specification bytes that each producer parses (2026-10-06 17:01 EDT)

Claude's independent D106 review found no blocker in the static binding but
pointed out that both producers parsed and hashed their store specification
in separate reads. A disposable rewrite between those reads reproduced a
guest manifest whose digest named a swapped role declaration while its entries
came from the original declaration. Both producers now hash the exact bytes
they parse. Guest capture also refuses an observed rewrite during the tree
walk, leaving `FAILED.json` and no success manifest. The macOS ASIF fixture
adds a digest-only mismatch to exercise the new clause even when tree content
matches, and matcher refusals distinguish scope, declaration and clock order.
The nine-test capture suite and plan lint pass on the owned checkout.

This does not prove that the guest clock is synchronized with the host or
authenticate the manifest's origin. A cross-machine clock skew can refuse a
valid capture; a backdated host-generated manifest can still pass. The
full-node hold, production capture, four real-history restores, acceptance
and verified resumption remain open. No production VM, service or NATS store
was stopped or changed; step 1.2 remains [A]/v1.2-pre.

## D108 — Re-fence an unloaded job after an interrupted enable (2026-10-06 17:20 EDT)

An enable-capable recovery adapter needs to re-establish a persistent hold if
it enables a stopped job and then fails before bootstrap. The existing
`disable_for_hold()` deliberately requires a loaded job, so it cannot repair
that disabled-override gap. `Launchd.disable_unloaded_for_hold()` now requires
the owned label to be unloaded in both GUI and user domains, requires the
override to be clear, disables it, and verifies it stayed unloaded and
disabled. An actual owned macOS launchd control exercised an interrupted
enable, re-fenced the unloaded job, proved direct bootstrap refused, then
re-enabled and bootstrapped it. The managed-launchd suite passes 43 tests
with one explicit cross-domain skip.

This is a compensation primitive, not the recovery adapter: no journal
callback invokes it, and a crash between enable and re-fencing still needs
a boot-time controller. The current full-node non-listener production stop
refusal remains. No production service, VM or NATS history changed; step 1.2
stays [A]/v1.2-pre.

## D109 — Refuse recovery after an unproven override clear (2026-10-06 21:20 EDT)

Claude's adversarial review of the next recovery adapter exposed a false
acceptance: bare `bootout` followed by a disabled override can make launchd
report an unloaded, stopped job while a detached child keeps writing. The
original stop proof does not cover a process tree started after that stop.
Full-node recovery now treats an `override-clear-intent` after a stop as
unproven until a later `recovery-verified` receipt. It refuses before hold
preparation or any state write, even when launchd again reports unloaded and
disabled, and rechecks the journal before each unit. An owned reopen test
records the interrupted restoration and confirms this refusal. The focused
journal suite passes 138 tests.

This does not enable restoration or certify a compensating stop. A future
adapter must journal the intent before enabling, bind the new process tree,
stop and verify it with the persistent watch on failure, and account for
children detached before binding. Bare `bootout` is not an admissible
compensation. The full-node hold, production stop/capture, four real-history
restores, acceptance and verified resumption remain open. No production VM,
service or NATS history changed; step 1.2 remains [A]/v1.2-pre.

## D110 — Stop the same recovery run after an override-clear failure (2026-10-06 22:25 EDT)

D109 refused a later reopened recovery, but its per-unit check ran before the
restore callback. An owned negative made the callback journal an
`override-clear-intent` for the stopped gateway and then fail. Recovery still
restored the stopped workplan viewer in that same run. The exception path now
checks all stopped units for an unresolved override-clear intent and stops the
restore loop immediately. A separate owned case makes one callback clear a
different stopped unit's override, then return successfully; the next unit
must refuse before another restore. Both negatives fail on D109 and pass here;
the focused journal suite passes 140 tests.

The journal rule is a fail-closed safeguard for an adapter that does not yet
exist. It does not establish a new process-tree stop proof or authorize
production restoration. The full-node hold, stopped-VM capture, isolated
four-history acceptance and verified resumption remain open. No production
VM, service or NATS history changed; step 1.2 remains [A]/v1.2-pre.

## D111 — Pin immediate refusal and name the re-entry limit (2026-10-06 22:45 EDT)

Claude's read-only review at D110 found that removing its exception-path
recheck still left the two new tests green: the next unit's global gate
refused before its restore, but the loop had not stopped immediately. The
failed-restore negative now also requires no error row for that next unit.
Removing the exception-path recheck makes this assertion fail; the actual
code passes. Claude found no unintended refusal, and exact-head macOS CI ran
the 140-test journal suite and 43-test launchd suite successfully.

An `override-clear-intent` followed by a synchronous, proven re-fence remains
terminal in the current journal: only `recovery-verified` clears the gate,
and no validated re-fence receipt exists. An enable-capable adapter must not
be wired until it can durably validate and record a new stop proof, or a
never-spawned proof, and the gate accepts that specific receipt. Otherwise
the journal requires operator reconciliation after a failed restore. The
planned adapter must act on only its current unit; if it can clear another
unit's override mid-turn or after that unit's turn, additional checks are
required before further restores and final hold release. Those cross-unit
callback windows are outside the present adapter contract, not accepted
production evidence. The VM, services and NATS stores remain untouched;
step 1.2 stays [A]/v1.2-pre.

## D112 — An unloaded launchd label is not a never-spawned proof (2026-10-07 01:20 EDT)

D111 left a possible `never-spawned` re-fence receipt for a failed bootstrap.
An owned macOS launchd negative shows the unloaded and disabled post-state is
insufficient evidence for that receipt: successful bootstrap started an owner
that launched a detached child before the test bound the owner. The child
escaped the bound process tree. A later `bootout` followed by
`disable_unloaded_for_hold()` left the label unloaded and disabled while the
child remained alive. The new managed-launchd test retains this state as a
regression fixture. On the operator checkout, the owned suite passes 44 tests
with one explicit cross-domain skip and plan lint passes. A further owned run
observed the disabled override in both GUI and user domains while the detached
child was still alive; the persistent override is not a process-absence proof.

The test does not reproduce a failed `bootstrap()` call. Such a failure would
need separate proof that launchd never spawned a process; this adapter has no
continuous pre-bind observation to supply it. A later process census can catch
a surviving child, but cannot establish that no short-lived process wrote and
exited. Do not issue a `never-spawned` receipt from an unloaded snapshot. An
enable-capable adapter must treat any attempted bootstrap whose owner was not
bound as unproven, retain the D109 override-clear fence, and refuse further
restoration. A bound owner and a verified persistent stop still need a survivor
and connection proof before a re-fence receipt can be admitted. The existing
production refusal for full-node non-listener stops remains in place. No
production service, VM or NATS history changed; step 1.2 remains [A]/v1.2-pre.

## D113 — Journal the daemon override clear before enabling (2026-10-07 05:29 EDT)

A daemon-class restore can now begin through `restore_disabled_daemon()`. Its
full-node journal method requires the current recovery callback, the current
unit's latest restoration intent, and a verified persistent stop before it
durably records `override-clear-intent`. Only then does the adapter enable and
bootstrap that owned label. It binds the new owner to the saved executable,
argv, working directory, environment and file identity, and requires the same
process generation before and after readiness. The recovery loop alone records
`recovery-verified` after its independent observation.

There is deliberately no automatic re-fence receipt: an enable, bootstrap,
bind or readiness failure leaves the override-clear intent unproven. D109/D110
then stop this run and refuse a later recovery, even if launchd looks unloaded
and disabled. An owned macOS stop/restore proves intent-before-enable and a new
bound owner; full-node journal facade controls prove the successful receipt
order and the terminal failed-enable path. The managed-launchd suite passes 46
tests with one cross-domain skip; the journal suite passes 141 tests. An added
owned negative forces observation after a daemon has forked a detached child
and exited before binding; the adapter refuses with no success receipt.

This is a success-path primitive, not an all-job recovery driver or a safe
automatic compensation after failure. `StopWatch.mutate()` still refuses
production full-node non-listener persistent stops. A failed restore can leave
a started process requiring operator reconciliation; detached and transient
writers, timer/on-demand restores, reboot hold, and deploy listener release
remain gates. The production VM, services and four NATS histories were not
changed; step 1.2 remains [A]/v1.2-pre.

## D114 — Restore a failed daemon's disabled override without issuing a stop receipt (2026-10-07 07:28 EDT)

Claude's read-only review of D113 found a physical side effect beyond the
unproven journal state: a bootstrap refusal could leave an installed agent
enabled and unloaded, making it eligible for launch at the next login. A
readiness refusal could leave the new owner running. The journal correctly
refuses further recovery in either case, but it does not itself restore the
launchd override.

`restore_disabled_daemon()` now makes a best-effort physical correction after
any failed enable, bootstrap, bind or readiness check. If the label remains
exclusively in the GUI domain, it disables the loaded or unloaded label and
observes the override. The original refusal also reports whether this
correction was verified and whether the owner remains running. It never
bootouts an unbound process and never writes a re-fence receipt. A bound
running owner remains an operator-reconciliation case, as do failures to
verify the override. Neither an unloaded-and-disabled state nor a disabled
but-running state proves process or writer absence.

Owned macOS negatives cover failed bootstrap, failed readiness, and an owner
that exits after spawning a detached child before binding. The last case now
pins the loaded, not-running, one-run label with a live child and a restored
override. Claude also found that three journal preconditions were untested;
new negatives require one intent per restoration, refuse an already recovered
unit, and refuse timers and NATS members. The valid-prior contract already
forbids an unloaded daemon, making that subcondition redundant in a normally
opened journal. The managed-launchd suite passes 48 tests with one domain
skip, the journal suite 144, and plan lint is conformant on the operator
checkout.

No automatic process compensation or survivor census exists. The full-node
non-listener stop guard remains closed, and no production VM, service or NATS
history changed. Step 1.2 remains [A]/v1.2-pre.

## D115 — Retain failed daemon restore diagnostics (2026-10-07 07:40 EDT)

Claude's read-only review of D114 confirmed the disabled-override correction
does not create an acceptance path, but found that recovery stored only the
exception type. The physical outcome reported by the adapter was lost from
`recovery-finished`. Recovery now records the exception detail for a failed
unit, as it already does for entrypoint and listener-release failures. A
full-node facade negative requires both the original enable failure and the
unverified override to survive in the returned and durable error records.

The review also confirmed a remaining operational gap: a readiness failure
can leave a running owner with the override disabled. The current journal
refuses another restore, while the normal persistent-stop path refuses an
already-disabled label and the journal refuses a new mutation after recovery
starts. An operator has no journaled, process-proven reconciliation path for
that state. No production adapter may use this restart path until that path,
its survivor proof, and measured per-unit readiness budgets are in place.
The full-node non-listener stop guard remains closed; no production VM,
service, or NATS history changed. Step 1.2 remains [A]/v1.2-pre.

## D116 — Restore the disabled override on interrupted daemon restart (2026-10-07 09:22 EDT)

Claude's D114 review found that `KeyboardInterrupt` or `SystemExit` between
enable and bootstrap bypassed the disabled-override correction. The daemon
restore now attempts the same physical correction for `BaseException`, then
re-raises interruptions instead of turning them into normal refusal results.
The durable `override-clear-intent` remains the recovery fence even if no
`recovery-finished` row was written. A platform-independent interruption
negative proves that an interrupted enable restores the override and
propagates `KeyboardInterrupt`; the journal negative now leaves the intent
as its last row and proves a reopened recovery refuses before state writes.

This does not provide process reconciliation for a running disabled owner.
The full-node non-listener stop guard remains closed, and no production VM,
service, or NATS history changed. Step 1.2 remains [A]/v1.2-pre.

## D117 — Require an explicit daemon readiness budget before clearing its override (2026-10-07 11:26 EDT)

Claude's D114 review found that the restore adapter's five-second default
could turn a slow but healthy daemon into a terminal recovery failure after
its disabled override had been cleared. The adapter now requires a finite,
positive, explicitly named `timeout` before it writes `override-clear-intent`
or enables the label. Owned fixture calls provide their own deadlines; a
negative verifies that omission and invalid values refuse before the journal
or launchd is touched. This removes a silent default, not the need to measure
production readiness for every unit and prove its bound owner and stop path.

Claude's D115–D116 review confirmed that late StopWatch binding alone could
launder a child that detached before binding. No post-failure re-fence receipt
or production recovery driver is authorized by this change. The full-node
non-listener stop guard remains closed, and no production VM, service, or NATS
history changed. Step 1.2 remains [A]/v1.2-pre.

## D118 — Refuse a stopped unit's verified installed-plist drift before recovery (2026-10-07 13:35 EDT)

D23 deliberately permits best-effort restoration of known units when the
entrypoint inventory cannot be captured, while withholding the deploy listener
and a success receipt. That behavior must not turn a *verified* change to a
stopped unit's installed plist into authorization to restart it. The initial
entrypoint check recorded such a mismatch but kept restoring units if the
`observe` adapter reported the saved identity. An owned negative demonstrated
the gateway restore callback running under that contradiction.

Before hold preparation, state writes or restoration, `check_stopped()` now
compares each pending stopped unit's currently captured installed plist path
and hash with its baseline entry. An observed mismatch refuses the recovery
without a new journal row. A capture exception leaves D23's best-effort path
intact; the independent observed-unit identity and final entrypoint checks
still apply. A disposable regression changes first the gateway plist hash,
then its path with the original hash, and requires both to refuse before any
restore. The full journal suite passes 145 tests. Claude independently
challenged the distinction between a capture failure and verified drift and
confirmed that blocking all restores on every inventory error would violate
D23's abort path.

This is one preflight binding, not a production full-node recovery driver or
a continuous inventory watch. The non-listener full-node stop guard remains
closed. No production VM, service or NATS history changed; step 1.2 remains
[A]/v1.2-pre.

## D119 — Recheck a transient entrypoint capture failure before best-effort recovery (2026-10-07 15:26 EDT)

Claude's D118 review found that the added preflight treated every capture
exception as unavailable evidence. The inventory itself raises if an installed
plist changes between its two reads, so a concurrent rewrite could be
classified as a diagnostic failure and allow a stale observe adapter to
restore the changed unit. The stopped-unit preflight now attempts one more
complete inventory capture after an exception. A successful retry must still
match every stopped unit's baseline plist path and hash; only two failed
captures preserve D23's best-effort abort path.

The owned regression makes the first capture refuse and the second report a
changed gateway hash. It requires refusal before hold preparation, state
write or restore. A separate negative pins D23 when both attempts fail with
stopped units present: known gateway restoration proceeds, the deploy listener
stays fenced, and recovery remains uncertified. The preservation journal suite
passes 146 tests. This narrows a preflight race; a plist change after the
second preflight still needs a per-unit restore-time binding. No production
VM, service or NATS history changed; step 1.2 remains [A]/v1.2-pre.

## D120 — Bind each stopped-unit restart to its saved installed plist (2026-10-07 17:29 EDT)

The two full-node recovery preflights precede the per-unit restore loop. A
stopped unit's installed plist could change while an earlier service was being
restored; an observe adapter that returned the saved identity would then let
the journal record a restoration intent and call its restore callback. Before
that intent, recovery now recaptures the installed entry for the stopped unit,
retrying once after a capture exception as in D119. A verified path or hash
mismatch refuses that unit before its intent or callback and keeps the deploy
listener fenced. Two failed captures retain D23's best-effort recovery of
known units without certification.

The enable-capable `restore_disabled_daemon` adapter separately reads the
installed plist as a bounded regular file and requires its hash to match the
saved identity before recording `override-clear-intent` or clearing the
launchd override. An owned test changes the file and proves neither action is
reached. Another changes the gateway's captured hash while memory-daemon is
restored, makes the first late capture fail, and proves the retry refuses the
gateway before its restoration intent. The journal suite passes 147 tests and
the managed-launchd suite passes 51, with one explicit domain skip.

This narrows the restart window; it does not make the plist immutable between
the adapter's read and launchctl bootstrap. A sustained concurrent writer can
still exhaust both inventory attempts, and only daemon restores using this
adapter get its physical hash precheck. The full-node hold driver and later
capture, history acceptance and service-resumption gates remain open. No
production VM, service or NATS history changed; step 1.2 remains [A]/v1.2-pre.

## D121 — Keep certification closed after a stopped-unit inventory outage (2026-10-07 17:50 EDT)

Claude's exact-head D120 review found an overclaim in D120's two-failure
fallback: if both late inventory captures failed and a later final capture
succeeded, the journal could restore the unit, release the deploy listener and
certify despite having no installed-plist observation at the restart. The same
gap existed when both attempts failed in a stopped-unit preflight but later
captures recovered. D23 permits best-effort restoration of known units in an
abort; it does not certify an unobserved restart.

Recovery now latches a preflight outage as an entrypoint error and records a
late outage as an entrypoint error for that unit. In both cases, known units
may still restore, while the listener remains fenced and `restored` is false.
The late check runs before the listener's release evidence, so its own outage
cannot produce a listener-release receipt. Owned negatives exhaust exactly
two captures before either gateway restoration or the first preflight, let
later inventory reads succeed, and require the gateway's best-effort restore
without certification. The journal suite passes 149 tests.

The physical daemon adapter still checks saved plist bytes before enable;
the read-to-bootstrap interval and complete full-node hold remain open. No
production VM, service or NATS history changed; step 1.2 remains [A]/v1.2-pre.

## D122 — Reorient step 1.2 to the full-node hold entry point (2026-10-07 19:36 EDT)

The current full-node journal has no production producer for its 23-unit
`prior` inventory and no caller that composes the execution hold with even
the first persistent stop. The timer controller builds a five-unit prior;
the 23-job recapture files use a different identity schema. `StopWatch.mutate`
still refuses persistent full-node stops outside the deploy listener, and
the timer's complete spawn-evidence callback exists only in owned fixtures.
These are earlier prerequisites than further hardening of the same-boot
daemon restoration adapter. Claude independently reviewed this dependency
order at d816897e; the code and plan were rechecked here.

The next bounded implementation is a read-only producer of the full-node
baseline from installed launchd state and pinned static identities, followed
by an owned macOS composition of journal open, execution-hold close,
persistent deploy-listener stop, same-boot abort, verified listener-last
restoration and resolution. Its negative must keep the listener fenced when
deploy release is unsafe. This fixture is an integration prerequisite, not a
full-node hold certificate: it must not certify the other jobs or authorize
stopping any production service. Only after that composition works should
class-specific persistent stops, the timer spawn witness, continuous and
detached-process coverage, the boot-hold decision and the disposable UTM
rehearsal be integrated into one complete shutdown gate. The live VM and
production services remain untouched until that gate is proven.

The owned four-history JetStream fixture was rerun at this head with
`test_recovery.mjs`: it passed, including omitted R1, swapped-master,
removed-block and flipped-payload negatives, and stopped every server it
started. This is disposable mechanism evidence, not production acceptance.
Step 1.2 remains [A]/v1.2-pre; stopped-VM capture, isolated restores of the
actual histories, acceptance and verified service resumption remain open.

## D123 — Produce a read-only 23-unit full-node baseline from approved direct pins (2026-10-07 21:29 EDT)

`full_node_baseline.capture_full_node_prior()` now consumes the `units` map of
an approved 23-unit recapture: each unit's class, installed plist path/hash
and direct-file path/hash map. It captures the actual launchd entrypoint
inventory, hashes the installed plist and direct files through
`static_identity`, reads each label's live status and disabled override, and
constructs the journal's exact `prior` schema. It obtains the five-timer
execution-hold descriptor from the real gate, then requires `valid_prior` and
`valid_entrypoint_inventory`. A second inventory and status/identity pass
refuses observed drift during capture. It does not open a journal, set an
override, stop a service, or contact NATS.

Seven owned tests cover all 23 classes and labels, omitted units, altered
approved file hashes, installed plist drift, a changed second inventory,
a daemon generation change and a direct-file rewrite during capture. The
combined baseline, preservation-journal and hold suites pass 201 tests.
Plan lint remains conformant.

This producer still needs an operator-approved, current direct-file map and
an owned composition with a full-node journal. A returned baseline is only
a point-in-time observation. It is not a continuous launchd/process watch,
a complete hold certificate or permission to stop the production VM or any
service. The production controller, root/user and detached-process census,
timer spawn witness, host UTM rehearsal, stopped-VM capture, four real-history
acceptance and verified resumption remain open. Step 1.2 stays [A]/v1.2-pre.

## D124 — Pin the baseline producer's three remaining refusal contracts and recapture its input (2026-10-07 21:42 EDT)

Adversarial review of D123 at `a1fb350d` confirmed the producer is read-only
and its 23-unit input schema matches
`POST_RETIREMENT_BASELINE_RECAPTURE_20261002.json`. Three decisive owned
negatives now pin rejection of aliased direct-file paths, an inventory that
omits a running daemon, and an idle daemon declared as a required running
member. They exercise the alias check, `valid_entrypoint_inventory`, and
`valid_prior` respectively. The baseline test suite now has ten tests.

The October 2 map cannot serve as a current production input: the October 3
memory-daemon and node-watch recaptures record changed installed plists and
entry files, but neither provides a replacement 23-unit `units` map. A fresh,
operator-approved 23-unit direct-file and plist recapture is required before
calling the producer on the node. The approved direct-file map must include
the program binary and every argv element that resolves to a regular file;
`static_identity` hashes those automatically. This is a fail-closed input
gap, not permission to adapt the old map or relax equality. No live node,
service, VM or NATS store was contacted in this review or these tests.

## D125 — Prepare a current candidate map and prove baseline-to-journal handoff in an owned fixture (2026-10-07 23:33 EDT)

`FULL_NODE_BASELINE_CANDIDATE_20261007.json` is a **candidate**, not an
approved baseline or a journal receipt. Its map is named `proposed_units` to
avoid accidental use as an approved recapture's `units`. A read-only
observation of the host's installed launchd inventory, 23 plist and
direct-file identities, service status, and disabled overrides produced it.
The inventory and each status and
identity were checked again before writing the report. It records only the
managed entrypoint summary and its full-observation digest, rather than the
large unrelated `print-disabled` listing. Against the October 2 map, only
memory-daemon and node-watch changed plist or direct-file pins; their new
plist and entry hashes match the October 3 recaptures. The candidate's
classes, observed states and entrypoint inventory pass the journal's prior
and entrypoint validators. The real execution-hold gate was **not** validated,
and this candidate must not be treated as permission to open a production
journal or stop a service. Pin approval and a fresh observation are still
required at the actual window.

The read-only producer was also run against this candidate's proposed map
and the live launchd/files with an explicitly synthetic gate descriptor. It
accepted all 23 static pins and observed service states. That probe did not validate or
publish the real execution hold and did not open a journal.

Two owned tests now compose D123's producer with `Journal(...,
scope=FULL_NODE_SCOPE)`: the returned prior opens a durable owned journal,
while a changed launchd inventory between producer and journal refuses before
a node receipt is written. This proves the schema handoff, not a continuous
watch or a completed full-node hold. The baseline suite has 12 tests. The
live observation was read-only; the production VM, services and NATS histories
were not stopped or restarted.

## D126 — Bind the candidate to the observed guest boot without certifying a boot hold (2026-10-07 23:46 EDT)

Read-only `kern.boottime` and the hashed `kern.bootsessionuuid` place the
current guest boot at 2026-10-04 10:57:20 EDT, after the October 3
recaptures and before D125's candidate observation. The current launchd
inventory has 23 installed jobs and 21 loaded in the GUI domain; member 1
and federation-tick are unloaded with disabled overrides in GUI and user.
The October 4 boot's cause and its transient launch/process history are not
recorded. Present-state overrides do **not** prove D62's continuous boot hold
or the required no-writer interval, and this prior reboot cannot substitute
for the disposable UTM rehearsal or authorize a production stop.

A later read-only call to the two-pass baseline producer refused because the
`observer` timer's service status changed during capture. This is the
intended fail-closed behavior for a transient timer run. It also means the
current candidate must be rechecked at the actual window, not treated as a
durable live baseline. The candidate now records the subsequent boot
observation and that refusal without changing its `unapproved` status. No
service or VM was stopped or restarted in this investigation.
The earlier D125 checkpoint's "histories remain untouched" referred only to
this agent's actions; continuity across the October 4 boot is unproven.

## D127 — Bind journal creation to the baseline producer's exact entrypoint inventory (2026-10-08 01:32 EDT)

The D125 handoff negative changed the loaded labels, which the journal's
`valid_entrypoint_inventory` already refused. A different inventory could
still satisfy that validator against the same prior: for example, the set of
scanned launchd roots could change between the producer's two observations
and journal creation. The journal would then record an inventory that was
never part of the producer's stable observation.

`open_full_node_journal()` now composes the producer and journal creation with
the exact returned entrypoint inventory. The journal compares its own capture
with that value before writing a node receipt and refuses if they differ. It
also refuses using a newly captured inventory to reopen an existing journal;
restoration must reopen the durable original record without a new prior. The
reopen guard gives an earlier refusal; the existing baseline rule already
refused replacement. Owned negatives cover valid-but-changed inventory,
including a system-domain override on an enabled unit, and attempted reopening.
The baseline suite passes 16 tests and the baseline, journal and hold suites
pass 210 tests. Plan lint is conformant. This closes only the point-in-time handoff; a continuous process
watch and complete full-node hold remain missing. No production service, VM
or NATS store was changed.

## D128 — Compose the native execution hold with listener release in an owned journal (2026-10-08 03:34 EDT)

A new macOS-owned fixture opens a full-node journal through
`open_full_node_journal`, closes and drains the real execution gate as its
first intent, records the deploy listener's persistent stop as its second,
and exercises same-boot recovery. With a verified deploy fence, the listener
gets the only restoration intent, after its release check, and the gate
reopens before resolution. With the deploy fence refused, no listener
restoration intent is recorded, its synthetic loaded state stays false with
the disabled override true, and the owned gate stays closed. The native gate
and journal are real; the 23-unit producer result, launchd inventory,
listener stop evidence and service readiness are synthetic. The fixture
therefore proves sequencing and fail-closed control flow, not process exit,
actual 23-job coverage or a production hold. The hold suite passes 46 tests;
the combined baseline, journal and hold suites passed 212 tests before two
final assertions were added, and those two focused tests passed afterward.

The next bounded slice is the same composition with owned launchd process
evidence and an unpatched entrypoint capture. Until that and the remaining
full-node shutdown gates pass, the live VM and production services stay up.
Stopped-VM capture, isolated acceptance of all four real histories, and
verified service resumption remain open.

## D129 — Require native listener stop proof before a refused release (2026-10-08 04:09 EDT)

The dedicated macOS CI fixture runs an owned process under the exact deploy
listener label only after checking that no plist for the label is installed,
the label is unloaded in GUI, user and system domains, and its GUI override
is clear. It closes the native execution gate, records a full-node journal,
then uses `StopWatch.mutate` to persistently stop that owned listener. The
stop proof includes the bound process's kernel exit, normal termination,
connection closure and listener-port absence; launchd is then unloaded and
disabled. A refused deploy-fence result is reached exactly once and leaves
no listener restoration intent, keeps the gate closed, and makes a direct
launchd bootstrap fail. The owned test's teardown removes its override.

The first CI run at `bfdc4b2f` failed before journal open on an unused
`UNITS` argument in the fixture. The one-line correction at `7f4578a9`
passed the macOS job: journal 150, baseline 16, hold 46, restore-only 30,
managed launchd 52 tests with one skip; the new listener test is `ok`.
Claude's read-only adversarial review of the first head found the missing
name and no other safety issue in the preflight or refusal assertions. This
proves one owned listener stop and refused release. The other 22 unit states,
entrypoint capture, readiness and deploy-fence input are still synthetic;
there is no success-path owned restore, complete 23-job hold or continuous
process census. The next bounded slice is a successful owned listener
restore using live readiness and dynamic identity/override observations,
then an unpatched full inventory fixture. The overall workflow remains red
at pre-existing dependency audit gates. No production service, VM or NATS
store was stopped or changed.

## D130 — Prove owned listener restart follows a verified release (2026-10-08 05:43 EDT)

The D129 fixed-label fixture now has a success twin. After the native gate
closes and `StopWatch` proves the owned listener stopped with its disabled
override, recovery requires a verified deploy-fence result before invoking
`restore_disabled_daemon`. That adapter records `override-clear-intent`,
enables and bootstraps launchd, binds the new process, and waits up to ten
seconds for a fresh ready file bearing the bound PID. The observer recomputes
the listener's static identity and current launchd status. The entrypoint
capture rehashes the plist and reads GUI, user and system overrides on each
call. The test requires the listener release, restoration intent,
override-clear intent and recovery verification in order, a different owner
PID, the gate reopened, and a resolvable journal. The refused-release twin
still requires an unloaded disabled listener and closed gate.

The macOS CI job at `fd081f10` passed both owned listener tests. It ran 53
managed-launchd tests with one skip, alongside 150 journal, 16 baseline, 46
hold and 30 restore-only tests. This is process and launchd evidence for one
owned listener's two recovery branches. The deploy-fence response, other 22
unit states, final physical readiness and much of the entrypoint inventory
are synthetic; the test does not authorize a production hold, VM stop,
history acceptance or service resumption. Next is an owned 23-job inventory
and full-node stop/recover composition without a mocked entrypoint capture,
then the remaining shutdown and reboot gates. The overall workflow remains
red at dependency audit gates unrelated to this fixture. No production
service, VM or NATS store was stopped or changed.

## D131 — Bind owned listener recovery receipts to the restarted owner's readiness (2026-10-08 05:56 EDT)

Claude's adversarial review of D130 distinguished the adapter's real,
in-memory ready-file check from the journal observer's unconditional
`verified` bit. The owned fixture now reports the listener verified only
when launchd shows a running owner, the fresh ready file names that PID,
and the log contains the second startup marker. The adapter's bounded
readiness predicate requires the same marker. The restore callback asserts
the deploy fence was checked while the execution gate remained closed, and
the success path reads GUI and user overrides after restoration to require
that neither still disables the listener. These observations flow into the
durable `recovery-verified` and hold-reopen readiness receipts. The
refused-release branch still keeps the listener and gate fenced.

The macOS CI job at `00d4080a` passed both fixed-label owned tests. Managed
launchd ran 53 tests with one skip, with journal 150, baseline 16, hold 46
and restore-only 30 also passing. The ready file and log marker belong to
the owned fixture; production listener readiness, the other 22 jobs, the
real deploy fence and final physical checks are not covered. The complete
full-node hold, stopped-VM capture, isolated acceptance of all four real
NATS histories and verified production resumption remain open. The overall
workflow is still red at unrelated dependency audit gates. No production
service, VM or NATS store was stopped or changed.

## D132 — Exercise the native 23-job baseline on an owned macOS runner (2026-10-08 07:58 EDT)

An owned fixture installs the exact 23 labels under a temporary HOME on a
dedicated macOS CI runner. Twenty-one jobs are GUI-loaded, with the required
daemon owners running and five timers plus the on-demand unit idle; member 1
and federation-tick remain unloaded with disabled overrides. The fixture
passes a private gate and direct-file map to the unpatched full-node baseline
producer and journal opener. Actual launchd inventory, status, overrides and
installed plist bytes feed the durable prior. `JournaledHold` accepts the five
gated timer argv identities. The fixture uses inert sleep owners and never
starts a NATS server, closes the gate or stops a managed job.
The approved map is derived from those owned plists, so this run does not
independently test its pin mismatch refusal; D123's negatives cover that.
Timer validation here checks argv shape, not timer execution or gate behavior.

The first two macOS runs refused while short-lived Apple `mdworker` labels
disappeared between a domain listing and per-label inspection. The inventory
now re-reads that domain before excluding a neutral label whose inspection
failed; it still refuses a managed OpenClaw label, a neutral label that
remains listed, or an unreadable replacement listing. An owned negative pins
those three cases. At exact head `a86febbb`, the macOS job passed the new
17-test baseline suite, the 53-test managed-launchd suite with one skip, and
the journal/hold checks. The overall workflow remains red at existing root
and Mission Control dependency audits.

This establishes an owned, point-in-time 23-job baseline and journal handoff,
not a continuous no-writer interval or a full-node stop. A neutral job that
vanishes during capture is outside the returned snapshot; the later complete
hold still needs continuous launchd and process evidence, including detached
writers. The production direct-file candidate remains unapproved and the
actual 23-job hold, shutdown gate, disposable UTM rehearsal, stopped-VM
capture, four-history acceptance and verified resumption remain open.
No production service, VM or NATS store changed; step 1.2 remains [A]/v1.2-pre.

## D133 — Close the native execution gate after an owned 23-job baseline (2026-10-08 09:53 EDT)

The dedicated macOS fixture now calls `JournaledHold.close_and_drain()` after
the unpatched 23-label launchd baseline and journal open. It requires the
original native forward observer, a closed marker matching the hold intent,
the published receipt matching the observer, and baseline → intent →
hold-published → verified journal order. After closure it boots out only its
owned gateway and requires `check_entrypoints(forward=True)` to refuse the
changed loaded set. Claude's read-only review of the first head identified
that negative as the missing decisive check; it found no false acceptance in
the closure or failure cleanup.

Exact-head `ad5ff90c` macOS CI job 113343411215 passed the 17-test baseline
suite with no skip, 46 hold tests, and 53 managed-launchd tests with one
explicit skip. The overall workflow remains red at existing root and Mission
Control dependency audit gates; the Node 22 job was canceled by fail-fast.
The five owned timer stubs never execute, so the drain has no foreground
contender in this fixture. The daemon owners remain running until the owned
gateway negative, and no full-node stop, continuous no-writer interval or
UTM shutdown gate is proven. Next compose a native persistent listener stop
with this exact 23-job baseline, then cover the remaining jobs and detached
writers before any production stop. The approved production pin map,
stopped-VM capture, four real-history acceptance and verified resumption
remain open. No production service, VM or NATS store changed; step 1.2 stays
[A]/v1.2-pre.

## D134 — Compose an owned listener stop with the native 23-job window (2026-10-08 11:56 EDT)

The dedicated macOS fixture now replaces its inert deploy-listener owner
with an owned Node process. It connects to a private loopback socket, opens a
private listener port, writes a ready record and emits the normal startup and
SIGTERM completion markers. After the unpatched 23-label baseline and native
execution-gate closure, the fixture binds that process and calls the existing
`StopWatch.mutate` persistent stop under the same full-node journal and hold.
It requires a kernel-backed owner exit, normal completion, closed socket,
absent port, unloaded and disabled launchd state, a verified stop receipt and
`listener_fenced()`. The later owned gateway bootout still has to trip the
forward entrypoint observer. Pre-stop controls now require the private socket
and port to be live so their disappearance is not vacuous.

The first exact-head macOS run at `e6ca32c4` failed before the stop because
Apple's framework Python changed argv during launch. The listener was changed
to the same Node owner pattern already exercised by the managed-launchd
fixture. The macOS job 113400310401 at `8f999e2c` then passed the 17-test
baseline suite without skips, along with the 46-test hold and 53-test
managed-launchd suites (one domain skip). Claude independently identified
the Python failure and reviewed the socket controls at `c952653d`, finding
no code-level false pass or hang. The exact-head macOS job for `c952653d`
is queued as of this checkpoint, so those added controls are not yet runtime
verified.

This composes native inventory, gate and one persistent stop for an owned
fixture. Its socket is not NATS; the other 22 owners are inert, and no full
node no-writer interval, production pin map, UTM shutdown gate, stopped-VM
capture, four real-history acceptance or verified resumption is proven. The
overall workflow remains red at separate dependency audit gates. No live
service, VM or NATS store was changed; step 1.2 remains [A]/v1.2-pre.

## D135 — Exercise owned listener release after the native 23-job stop (2026-10-08 13:59 EDT)

The dedicated macOS fixture now takes the unpatched 23-label launchd baseline,
closes the native execution gate, persistently stops its owned deploy listener,
and recovers that listener through the full-node journal on the same boot. The
recovery twin reads all 23 actual launchd states and installed identities. It
requires the closed gate and a listener fence before restore, a new bound owner
with an atomically published ready record and second startup marker, a new
private bus connection, final physical readiness, a live fast check at gate
reopen, ordered listener-release and override-clear receipts, and a resolved
journal. The other 22 jobs are inert owned stubs. The deploy-fence and physical
checks are owned fixture callbacks; the socket is not NATS.

The first release runs at `f9046bad` and `8ebcfde2` failed before restore
because the fixture re-peeked a dead TCP socket long after `StopWatch` had
already proven normal EOF. The stopped-state physical check now uses that
verified stop receipt and still checks the disabled override and absent port;
the first EOF check remains strict. Exact-head `2a09385f` passed the release
twin and the entire macOS job. The ready file became atomic at `b126270b`;
the final gate-reopen check became live at `99af7732`. Exact-head macOS job
113456011934 passed all 18 baseline tests without skips, 150 journal tests,
46 hold tests, and 53 managed-launchd tests with one explicit skip. The overall
workflow remains red at separate root and Mission Control dependency audits;
the Node 22 job was canceled by fail-fast.

This establishes a same-boot owned listener release after a native 23-job
baseline and one managed stop. It does not prove a complete no-writer hold,
the production pin map or deploy fence, the readiness of the other 22 actual
services, UTM shutdown, stopped-VM capture, acceptance of all four real NATS
histories, or production resumption. No live service, VM or NATS store was
stopped or changed; step 1.2 remains [A]/v1.2-pre.

## D136 — Admit persistent daemon-class stops after the listener fence (2026-10-08 16:08 EDT)

`StopWatch.mutate` now admits a persistent full-node stop beyond the deploy
listener only when the journal's saved class is `daemon` and the unit is
outside the NATS transfer set. The listener-first journal rule, original
execution hold, disabled override, bound process exit, connection and port
closure, completion marker, and class-specific `full_node_stop_proven` check
remain required. Timers, on-demand and known-broken units, the held member,
and NATS members remain outside this adapter. The success-side restoration
adapter records `override-clear-intent` immediately before enable; a failure
leaves the unit unproven and prevents later restores or a retry.

The dedicated macOS 23-label fixture now persistently stops an owned
`mesh-bridge` after the listener fence. Its Node stub has a private TCP bus
connection, listener port, atomic ready record and production completion
marker. The fixture refuses a bridge stop before the listener without adding
an intent, observes disabled overrides in both per-uid domains, and restores
the bridge before listener release through a new bound owner and private
connection. A separate native readiness-failure twin keeps the listener
disabled, the gate closed and resolution refused; a Linux journal negative
also proves a reopened recovery refuses the unproven override clear.

The first release attempts at `b9335a58` and `f1a90bdd` passed the bridge
stop and restore but the fixture's release check probed the old ephemeral
bridge port. `de3de11d` probes the new ready-file port only when the bridge
is running, retaining the original port for stopped-instance absence.
Exact-head macOS job 113510989748 passed all 19 baseline tests without
skips, 151 journal tests, 46 hold tests and 54 managed-launchd tests with
one explicit skip. `e69159da` adds native assertions that the failed owner
remains running and a second recovery refuses before writing; its exact-head
macOS run is pending. The overall workflow remains red at separate root and
Mission Control dependency audit gates.

Only one of the ten newly eligible plain daemon labels has an owned
stop/release proof. The other 21 labels in the native fixture are inert.
This is neither a complete no-writer hold nor approval of the production
pin map. Timer spawn coverage, NATS transfer, detached-process census, boot
hold, UTM rehearsal, stopped-VM capture, all four real-history acceptance
and production resumption remain open. No live service, VM or NATS store was
stopped or changed; step 1.2 remains [A]/v1.2-pre.
