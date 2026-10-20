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

## D137 — Refuse the stale full-node candidate after viewer deployment (2026-10-08 17:35 EDT)

A read-only recheck found the same 23 installed jobs, 21 GUI-loaded jobs,
entrypoint roots and excluded helper as the October 7 unapproved candidate.
All 59 paths in that candidate's direct-file map still hash-match, but the
installed `workplan-viewer` plist now points to a new release entry. Its
plist SHA-256 is `f18ffd01…`, not the candidate's `6d2c46a7…`, and the new
entry file is absent from the candidate's map. Running the unmodified
baseline producer against the old map refused on the viewer's installed
plist before it could produce a prior. The current viewer was observed
running under launchd; no service operation was issued by this check.

The October 7 map remains unapproved and is now demonstrably stale. A new
point-in-time recapture, review of the viewer release's file dependencies,
and explicit approval are required before a production full-node journal.
The full hold and shutdown gates remain open; no VM, production service or
NATS store was stopped or restarted for this observation.

## D138 — Bind the full-node baseline to launchd's loaded entry (2026-10-08 21:42 EDT)

The full-node prior producer previously checked installed plist bytes and
launchd loaded/running state separately. A plist rewritten after bootstrap
could therefore supply approved arguments that differed from the job launchd
still had loaded. The producer now reads each loaded job's launchd path and
arguments, requires them to equal the approved plist, and repeats that read
after the inventory handoff. It refuses before journal creation if either
observation differs. The loaded-entry read omits log-path requirements so the
23-label fixture's inert stubs and other jobs without configured logs remain
observable. The existing managed stop still performs its separate running
owner binding.

Owned negatives cover mismatched loaded arguments and a change between the
two reads. The baseline suite passes 22 tests with four dedicated-runner
skips; the adjacent managed-launchd, journal and hold suites pass 251 tests
with three skips. A read-only check of the live workplan-viewer found its
loaded path and arguments match its installed plist. A dedicated macOS CI
negative now rewrites one fixture plist after bootstrap and requires the
producer to refuse; its exact-head run is pending. This is loaded-entry
provenance, not proof that every running owner or detached writer is held.
The approved production map, complete hold, stopped capture, four-history
acceptance and resumption remain open. No live service, VM or NATS store was
stopped or restarted.

## D139 — Reject stale loaded execution context in the full-node prior (2026-10-08 23:50 EDT)

Exact-head `4d653afe` macOS job 113629378165 passed 22 baseline tests without
skips, including the native rewritten-argument negative. Claude's read-only
adversarial review found the remaining loaded-entry gap: a plist rewritten
after bootstrap could retain the same path and arguments while changing its
`Program`, working directory or environment. A daemon's later process bind
would refuse before its stop, but an idle timer or on-demand job has no bound
owner and could enter the full-node prior with a false execution context.

The baseline now also compares launchd's loaded program, working directory
and declared job environment against the installed plist. It refuses extra
job environment keys except launchd's `OSLogRateLimit` and
`XPC_SERVICE_NAME`, and repeats the complete loaded configuration read after
the inventory handoff. Owned negatives cover a stale loaded path, program,
directory, extra environment key, and an argument change between the two
reads. A new dedicated-runner twin rewrites the listener's environment after
bootstrap while approving the new plist hash; it must refuse before a node
receipt. That native twin awaits exact-head CI. Local baseline tests pass 26
cases with five dedicated-runner skips, and managed-launchd tests pass 54
with three skips. A read-only scan found all 21 currently GUI-loaded jobs'
programs, directories and declared environment values matched their installed
plists. No environment values were retained in the journal or printed by the
scan.

This closes the identified loaded-config false accept in the prior producer;
it is not a complete running-process or detached-writer census. Claude
identified the next bounded native gate as a same-window stop and ordered
restore of all ten plain daemon-class units after the listener fence. The
timer spawn witness, NATS transfer, on-demand/known-broken paths, boot and
UTM gates, stopped capture and real-history acceptance remain open. No live
service, VM or NATS store was stopped or restarted.

## D140 — Sweep the plain daemon class in one owned window (2026-10-09 01:40 EDT)

Exact-head `1d8c5eec` macOS job 113661707158 passed all 26 native baseline
tests without skips, including the stale loaded-environment negative. The
overall workflow remained red only at separate dependency-audit gates.

The dedicated-runner fixture now has a full plain-daemon sweep twin. In one
23-label baseline and closed execution window, it starts owned Node processes
for all nine plain daemon labels beyond the existing listener and bridge
owners. Each new owner has its own private bus socket, listener port, ready
file and log; the five marker-bearing units emit their required completion
markers. After the listener fence, `StopWatch` binds and persistently stops
the bridge and nine further daemons, proving kernel exits, connection and
listener closure, disabled overrides and journal stop receipts. Same-boot
recovery must restore the ten in `RESUME_ORDER`, bind new PIDs, observe fresh
readiness and private connections, verify the deploy fence while the listener
remains disabled, then release the listener and reopen the gate. A negative
omits the mesh-task-daemon completion marker: its stop must refuse, leave the
listener and gate fenced and record no later daemon stop intent. The fixture
has no NATS server and does not cover timers or detached writers. Its two new
native tests await exact-head macOS CI; local baseline tests pass 28 cases
with seven dedicated-runner skips.

This is an owned class-composition check, not a production full-node hold.
The unapproved production pin map, timer spawn witness, NATS transfer, idle
on-demand/known-broken paths, detached-process and host UTM/boot controls,
stopped-VM capture, four real-history acceptance and verified production
resumption remain open. No live service, VM or NATS store was stopped or
restarted.

## D141 — Prove a failed daemon receipt blocks the next stop (2026-10-09 09:40 EDT)

Exact-head `102d9c05` macOS job 113762159028 passed all 28 native baseline
tests without skips, including the strengthened missing-completion negative.
Claude's read-only review found its claim that no later daemon stop occurs
was vacuous: the fixture returned before attempting one. The fixture now
binds the still-running memory-daemon stub after mesh-task-daemon's marker
receipt is refused, attempts its persistent stop, and requires the journal's
interrupted-preservation refusal before any new intent. It checks the
memory-daemon PID/state, enabled override, bus connection and listener port
remain live. This is the observable boundary needed before a driver may
handle a failed stop by switching to restore-only work.

The earlier phrase that the mesh-task-daemon "stop refuses" means receipt
verification refuses after launchd has already stopped it. It ends unloaded
and disabled with an unverified failed row; the journal cannot automatically
restore it because override clear requires a verified stop. That path needs
manual reconciliation, so the production driver must not assume a failed
receipt is a harmless no-op. The new native test awaits exact-head CI. No
production service, VM or NATS store changed; step 1.2 remains [A]/v1.2-pre.

## D142 — Recapture the changed production viewer without opening a hold (2026-10-09 13:44 EDT)

The October 7 full-node candidate is stale because the installed workplan
viewer now points to a different release. A fresh read-only producer pass on
the running guest accepted 23 installed jobs and 21 GUI-loaded jobs, with no
user/system-loaded managed labels. The two inventory and static-identity
observations agreed during the 11.7-second capture. The only unit whose
proposed record changed was workplan-viewer: its installed plist, process PID,
and direct-file pins. The new proposal pins its entry, both local imports,
both previously loaded client assets, and the two new overview assets. All
other proposed class, state, plist and direct-file records matched the prior
candidate. `FULL_NODE_BASELINE_CANDIDATE_20261009.json` retains the evidence
as an unapproved proposal.

The producer used a synthetic, open execution-hold descriptor solely to
validate the prior and entrypoint contracts; it did not validate or close the
real gate, open a journal, or prove continuous absence of writers. The map is
point-in-time and can go stale again. Approval of exact pins, a genuine gate,
the complete persistent hold and process census, boot and host controls, and
the stopped-VM/history/resumption gates remain separate prerequisites. No
production job, VM, NATS server or store was stopped or changed.

## D143 — Bind cold masters to the stopped-tree match roles (2026-10-09 15:53 EDT)

An adversarial owned NATS 2.12.6 run exposed a false accept in the isolated
four-history probe. The existing swapped-master negative changed only the two
plan paths, leaving their digests in place, so it refused at the hash check.
When both paths and digests were swapped, the unmodified probe wrote a success
report even though the serving histories had been assigned to the wrong
roles. The two masters' replicated stream content matched, and restarting
each under its planned server name did not reveal the exchange.

`stopped_tree_match.py` now records each frozen extraction role's canonical
path and content digest in `MATCH.json`. The probe requires that private
receipt and binds standalone, held member1, and serving member2/member3 in
plan order before any isolated server starts. It rechecks the receipt hash
after the probe. The owned negative swaps both serving paths and digests while
keeping the independent role receipt fixed; it now refuses before copying or
booting a working server. The existing removed-block and flipped-payload
negatives use separate owned role receipts, so they still reach their local
state and forced-leader checks. The full NATS fixture and disposable ASIF
host-match fixture pass. The test receipts are synthetic and prove only this
binding mechanism. Production acceptance still must establish the actual
`MATCH.json` capture/extraction provenance and all other hold, host, and
historical gates. No production VM, service, or NATS store was changed.

## D144 — Keep the matched receipt inputs stable through host comparison (2026-10-09 17:52 EDT)

`host_match` previously parsed the guest, capture, extraction and guard JSON
files, then hashed some of them only when publishing `MATCH.json`. A rewrite
between validation and publication could make the published digest describe
bytes that were never checked. It now retains the exact input bytes it parsed,
requires all four files to remain byte-identical after the frozen-tree checks,
and publishes digests of those validated bytes. The disposable ASIF fixture
mutates each input in turn after validation; all four cases refuse with
`FAILED.json` and no `MATCH.json`. The nine host capture tests pass on macOS.

This is a same-process consistency check, not guest-origin attestation or an
atomic guarantee against a rewrite after the final check. The production
acceptance controller still has to revalidate the capture/extraction chain.
Exact-head D143 macOS CI passed its 28 native baseline tests and nine host
capture tests; the overall workflow failed at separate root and Mission
Control dependency audits. No production VM, service or NATS store changed.

## D145 — Bind cold-baseline names to guest store paths (2026-10-09 18:09 EDT)

Claude's read-only review of exact head `db329d11` reproduced a second D143
false accept on owned NATS 2.12.6: swapping the two survivors' names and
baseline paths while retaining their master paths, digests and fixed receipt
still produced a success report. The baseline name check compared two fields
from the same edited plan; `MATCH.json` had no independent guest path. A local
copy of that negative failed against the old probe with “Missing expected
rejection.” `guest_capture` now records the canonical guest store path per
role, `host_match` carries it into each frozen master's receipt row, and the
probe requires the baseline monitor's `storeDir` to match that role path before
copying or booting a working server. The owned name-plus-baseline swap now
refuses before any working copy, and the full NATS fixture passes with all
owned servers stopped. The original path-only and path-plus-digest swaps still
refuse.

The real disposable ASIF test exposed another D143 limitation while checking
that chain: `guest_capture` writes sorted JSON keys, so hashing its reloaded
row objects produced a different digest from the probe's Node `hashTree()`
serialization even when their tree contents matched. `host_match` now hashes
its freshly enumerated frozen host rows, preserving the same field order as
`hashTree`. The fixture requires all four Python and Node row lists and
digests to agree; its nine tests pass. This was a false refusal of any genuine
match receipt, not a corruption acceptance.

The fixture's receipt is still synthetic, and the production store-spec role
mapping and guest origin are unproven. The probe checks a receipt named by the
caller; the eventual acceptance controller must validate its capture and
extraction chain. Exact-head D143 CI ran the NATS fixture green as a step in
the Node 22 job, but fail-fast later canceled that job; the macOS job passed
and the overall workflow failed at separate dependency audits. No production
VM, service or NATS store changed.

## D146 — Let both Node matrix jobs finish independently (2026-10-09 19:46 EDT)

The exact-head D145 workflow passed its native macOS job and reached a green
JetStream recovery-fixture step on Node 22, but the Node 20 dependency audit
failure canceled the Node 22 job before its remaining tests and audit finished.
The unit-test matrix now sets `fail-fast: false`, so one version's failure
cannot erase the other version's complete result. The high-severity dependency
audits remain enforced in both jobs; this changes only cancellation behavior.
The workflow parses with that value set to false, and the diff is clean. The
next exact-head run must establish the complete Node 22 result. This is CI
evidence plumbing, not a production history or no-writer acceptance. No live
VM, service or NATS store changed.

## D147 — Bind managed stop receipts to their unit (2026-10-09 23:52 EDT)

The full-node journal required a managed-stop receipt's process and bootout
flags but did not require the receipt to name the unit being stopped. A
callback could therefore return a valid receipt from another service after
the target became unloaded and disabled; the journal would record the target
as proven stopped without its own descendant or connection proof. The same
predicate is used at the listener fence and NATS-transfer checks.

`StopWatch.verify` now records the service label in its evidence, and every
managed-stop predicate compares it with the journal unit. Missing or different
labels refuse. An owned journal negative fences `gateway` but supplies a
`mesh-bridge` receipt; it now records a failed intent and no verified gateway
stop. The 152 journal tests, 54 managed-launchd tests, 46 execution-hold tests,
22 root-transfer tests and 28 local baseline tests pass; seven dedicated-CI
baseline cases are skipped locally. The first exact-head CI run exposed an
imported root-transfer fixture still supplying a listener-labelled receipt
for NATS stops. Its Linux and macOS jobs failed before the longer recovery
suites; the fixture now supplies each NATS unit's own label, and exact-head CI
must be rerun. This binds
receipts against accidental cross-unit reuse, not against a caller forging a
label or a writer that escaped the bound process tree. A production driver,
full-node no-writer proof, stopped-VM capture and four-history acceptance are
still open. No live VM, service or NATS store changed.

## D148 — Require unit-bound stop evidence at root admission (2026-10-10 01:44 EDT)

Claude's read-only review of D147 found that the root-side `UserTransfer`
reader independently validates the user journal but still accepted listener
and NATS stop receipts without checking their `unit_label`. Its row-unit
check did not bind a receipt's process evidence to that row. A journal written
through the current `Journal.mutate` now refuses such a swap, but the root
reader must treat the user journal as untrusted input. The reader now requires
the listener label and each serving NATS member's own label before root-side
admission. A durable negative rewrites an otherwise valid nats-2 receipt to
carry the nats-3 label, rehashes the whole journal chain, and requires root
admission to refuse. The negative failed against the parent reader because
it admitted the swapped receipt, then passed with D148. Wrong and missing
listener labels also refuse. The 23 root-transfer tests pass locally.

Exact-head CI for the preceding `f9de96ba` passed the macOS job, including
the 28-case native baseline, nine host-capture cases, 46 hold cases and 54
managed-launchd cases. Both Node versions passed root unit tests; Node 22
also passed the JetStream fixture. The workflow remains red solely at the
root and Mission Control high-severity dependency audits. D148's own
exact-head CI remains to run. The full-node hold, production capture,
four-history acceptance and verified resumption remain open; no production
VM, service or NATS store changed.

## D149 — Journal a bounded restore for verified idle timers (2026-10-10 13:57 EDT)

A full-node timer stopped with a persistent disabled override had no restore
primitive that wrote an intent before clearing the override. The journal now
permits `begin_override_clear` for a loaded, previously idle timer only after
its own verified `disable-and-unload` receipt. The restore helper rechecks the
saved direct-file identity before that intent, enables and bootstraps the
timer, then requires an idle GUI-domain job with the approved loaded
configuration and a bounded caller readiness check. On any failure it restores
the disabled override when possible. The override-clear intent remains in the
journal, so a later recovery refuses without verified recovery even if launchd
looks fenced again.

This is a resumption primitive, not a timer stop certificate. Production
timers still lack the spawn/writer evidence needed for the original full-node
stop, and the helper does not release the execution gate. Two owned native
timer controls and the journal refusal cases pass; exact-head CI remains to
run. No production service, VM or NATS store changed.

## D150 — Exercise timer restore with a RunAtLoad owner (2026-10-10 15:58 EDT)

D149's native restore controls used idle jobs with `RunAtLoad` disabled. An
additional owned launchd control now boots a short-lived timer with
`RunAtLoad` enabled, observes its first payload, persistently unloads it,
sets a disposable closed marker, then restores through the journaled helper.
The second invocation exits with code 0, reaches idle readiness, and does not
write the payload. It also shows launchd's `runs` count is not a cumulative
readiness signal across bootstrap; the control instead witnesses the second
invocation with an owned attempt file and exit status. This tests restore
timing, not the production execution gate or spawn coverage.

The 58 managed-launchd tests pass locally with three existing skips. At
7628e5b8, the native macOS CI job passed, including the prior D149 controls;
both Linux jobs reached their root tests and failed only at the separate
dependency audit gate, which PR #226 addresses. CI for this new control is
pending. No production service, VM or NATS store changed.

## D151 — A drained timer gate cannot certify detached writers (2026-10-10 17:58 EDT)

The proposed shortcut for the five gated timers was to treat a closed gate
and successful flock drain as complete spawn/writer evidence. An owned
negative now runs a foreground payload through the actual `service_gate.Gate`
wrapper. The payload starts a detached child with the inherited lock file
descriptor closed, then exits. The child publishes that it is waiting.
`close_and_drain` then succeeds with the closed marker present; only after
the drain does the child write its sentinel. No production process or store
was involved.

The gate still excludes new wrapper payloads while its marker remains intact,
but its flock drain cannot prove that an already-started payload left no
detached writer. A timer stop receipt must not claim `coverage_complete` or
empty `spawns` from marker and lock evidence alone. The full-node hold needs
independent process/writer coverage for this case, or a narrower verified
contract that excludes it. This preserves the current fail-closed refusal;
no production VM, service or NATS store changed.

## D152 — Restore a previously running known-broken job with bound evidence (2026-10-10 20:01 EDT)

The owned 23-label window already treats `mesh-tool-discord` as a loaded,
running `known-broken` job and accepts a managed persistent stop for it, but
`begin_override_clear` and the restore adapter admitted only plain daemons.
That would strand this job after a verified stop. Extend the existing bounded
running-owner restore to this class only when the saved owner was running;
the journal still requires its verified persistent-stop receipt before
clearing the disabled override. An idle known-broken job remains outside this
adapter and needs an independently proven idle-stop path.

The dedicated owned 23-label fixture now stops and restores the running
known-broken stub alongside the ten plain daemons, checking journal order,
fresh owner binding, readiness, and listener-last release. Local journal and
managed-launchd suites pass; the native fixture awaits exact-head macOS CI.
This does not supply the timer spawn/writer witness, a full-node driver, or
permission to stop the production VM or services.

## D153 — Admit the running known-broken class at the stop preflight (2026-10-10 21:56 EDT)

Exact-head `87aa6cae` macOS CI exposed a missing precondition in D152: both
owned 23-label sweeps refused `mesh-tool-discord` before its stop intent because
`StopWatch.mutate` still admitted persistent stops only for plain daemons.
The local journal and restore tests did not exercise that native gate. Extend
the preflight to admit a `known-broken` unit only when its saved owner was
running, matching the D152 restore adapter. An idle known-broken unit and
NATS members still refuse this path. The new preflight control covers both
directions, and the 60 managed-launchd tests pass locally with three
dedicated-runner skips. The complete 23-label native sweep needs a green
exact-head macOS CI run before this slice is credited. Other CI failures at
`87aa6cae` were the separate dependency audits addressed by PR #226.

## D154 — Observe the guest Data volume before accepting a stopped-tree manifest (2026-10-11 06:05 EDT)

The guest stopped-tree manifest previously copied `data_volume_uuid` from the
caller-supplied store specification. It could therefore name a Data volume
without observing the volume that held the four walked stores. `guest_capture`
now resolves the first store's mounted disk through `df`, reads that disk's
`diskutil` identity, requires its Data volume UUID to match the specification,
and requires the other three stores to share the same device. It rechecks the
volume and device after walking. An owned ASIF fixture with a deliberately
wrong UUID refuses before writing a manifest; all nine host-capture tests pass
locally.

This binds the manifest's volume field to an observed mounted volume. It does
not establish that the manifest was produced inside the production guest or
that the VM was writer-free; the full-node hold, host guard and capture chain
remain separate admission requirements. No production service, VM or NATS
store changed.

## D155 — Bind MATCH guest role paths to the host store specification (2026-10-11 10:04 EDT)

An owned ASIF negative exchanged only the member-2 and member-3 absolute
`store_paths` in the guest manifest. The old `host_match` still wrote
`MATCH.json`: it compared the four content trees but copied those path claims
into each master's role receipt without checking them against the host's store
specification. A later probe uses that receipt to bind server names to
masters, so the mismatch was a false acceptance of role-path evidence.

The host capture receipt and guest manifest now each carry the specification's
four role-relative paths. `host_match` requires the two maps to agree and
requires each canonical guest path to end with its declared role path before
publishing `MATCH.json`. The same negative now refuses with no match receipt,
and all nine host-capture tests pass locally. This checks consistency between
the two declared inputs; it still does not attest that the guest manifest
originated inside the production VM. No production service, VM or NATS store
changed.

## D156 — A disabled loaded idle job can still be kickstarted (2026-10-11 12:05 EDT)

An owned native launchd control loads an idle `RunAtLoad=false` job, applies
its GUI disabled override, then invokes `launchctl kickstart` directly. The
command succeeds, the owner reaches readiness, and launchd reports it running
while the override remains disabled. The test uses a fresh label and an owned
loopback NATS server and cleans up both. The disabled override excludes a later
bootstrap after bootout, but it is not a spawn fence for a job that remains
loaded during the disable-to-bootout interval.

Keep the idle stop's independent continuous spawn witness mandatory. For
on-demand and idle known-broken jobs, a future driver must arm that witness
before the first hold mutation, reject any spawn through unload and disabled
verification, and account for any writer already detached from the job. The
current `unload_idle_timer` refusal when its witness is absent remains correct.
This owned control does not close the full-node hold or permit a production
service or VM stop.

## D157 — Immutable flags and a tree digest cannot certify continuous writer exclusion (2026-10-11 13:21 EDT)

An owned macOS control sets `UF_IMMUTABLE` on a disposable store directory and
file, then starts a separate same-user process. That process clears both flags,
writes transient bytes, restores the original bytes, and reapplies both flags.
The control confirms the transient bytes were written while the final flags
and `stopped_tree_match.entries` match the values from before the write. Both
native host-image tests pass locally. No production store, service or VM was
contacted.

Thus a post-hoc flag check and content digest can establish the final tree
state, but cannot prove that no writer ran during the interval. A point-in-time
open-descriptor census does not close this path: the process can open only
after that census and clear its same-user flags. Other-user and root processes
are outside the existing unprivileged census as well. Do not substitute an
owned immutable-store fence for the missing full-node spawn/writer witness or
use it to authorize production hold, VM shutdown, capture, acceptance or
resumption. The four NATS histories remain separate, and step 1.2 stays
`[A]/v1.2-pre` pending an independently proven no-writer boundary.

## D158 — Refresh separate online archives without changing the split topology (2026-10-11 17:25 EDT)

The live standalone bus and the routed cluster still serve under their
existing launchd owners. The pinned `take_snapshots.mjs` and NATS CLI 0.3.1
took new, separate owner-private online archives at 17:15 EDT. The standalone
manifest names seven reachable streams, including 24,286 messages in
`local-events-daedalus`. The cluster manifest names six streams, with
`KV_MESH_COLLAB` and `KV_MESH_PLANS` explicitly offline, and records 55,173
messages in `local-events-moltymacs-virtual-machine`. Both manifest file
lists rehash exactly. This run changed no stream assignment or service
configuration.

Eleven reachable archives restored on two owned loopback servers outside the
production port set. The isolated check accepted 80,884 non-expiring messages,
captured state and durable positions, with the time-limited health stream
treated separately: each health archive restored with its archived last
sequence and configuration, then expired; its message bytes were not compared
with a direct source read. A later direct message read matched the restored content
digests for all nine non-expiring streams. The cluster direct baseline completed;
the standalone baseline refused twice at its final recheck because transient
`consumer_count` values changed in the retained assertion diffs. Their cause
is unproven. Its six partial content reads corroborate
the byte comparison but are not a successful stable baseline. Both refused
receipts are retained. The private restore receipt says both owned servers
stopped and the archives remained unchanged. The restore runner writes no
failure receipt; this run is evidenced by its success receipt and normal
server exit markers. No archive failure receipt was produced.

The three serving NATS launchd PIDs were unchanged before and after. See
`ONLINE_ARCHIVE_REFRESH_20261011.json` for receipt hashes and scope.
The exact private restore runner was copied byte-for-byte into the audit as
`ONLINE_RESTORE_RUNNER_20261011.mjs`; the evidence pins its hash, both owned
server IDs and loopback ports, and the direct-baseline tool. The content
comparison used the complete direct and restored content objects for each
of the nine non-expiring streams. The committed
`verify_online_restore_20261011.py` rechecks those nine objects against the
hashed private receipts. The evidence lists the source stream names and the
expected direct-read server identities. The archive producer itself pins only a
loopback URL, not the answering server ID; the subsequent identity-checked
direct comparison corroborates those nine source histories but does not
bind the two expiring health-stream archives. The copied runner is an audit
artifact with this worktree's absolute import path, not a production driver.
The NATS binary hashes were observed after the run, not pinned at execution.

These are two sequential online points, not a shared no-writer recovery point.
The two offline cluster streams, the separately held member-1 store, and each
serving member's cold store still require the full-node hold, stopped-VM
capture and four-role isolated acceptance. This refresh does not authorize a
topology change, production stop or VM shutdown. Step 1.2 remains
`[A]/v1.2-pre`.

## D159 — A scoped root fs_usage trace cannot certify the full-node writer boundary (2026-10-11 19:00 EDT)

An isolated macOS CI job ran `fs_usage` with root privileges against an owned
writer process and disposable files. The writer opened a descriptor and a
writable shared mapping before tracing began. During tracing it acknowledged a
write through the descriptor and a mapping change. Distinct file-path controls
were visible before and after those actions, and the tracer exited normally.
No matching write-call line named the pre-opened file. The PID filter excluded
kernel write-back, so the mapping result cannot establish where or under which
process later page-out occurred. Pipe acknowledgements also contributed to the
unnamed-write count. The exact sanitized result, runner identity, script hash
and job link are in `audits/step12_jetstream/ROOT_TRACE_CHARACTERIZATION_20261011.json`.

This is a negative for using a scoped `fs_usage` trace as the full-node
no-writer certificate. It is not a proof that every possible root observer
fails: a system-wide observer with descriptor and mapping census, loss
detection, and explicit root-writer handling still needs its own owned test.
The characterization script is retained, but its one-time CI job is removed
after recording the result rather than repeating it on every CI run.
No production process, store, service or VM was changed. The unapproved
23-job pin candidate also differs from the installed workplan-viewer plist;
it cannot authorize a hold. Step 1.2 remains `[A]/v1.2-pre`.

## D160 — System immutability does not revoke pre-existing write handles (2026-10-11 19:10 EDT)

An owned macOS CI control created a disposable APFS image and opened one file
for writing and shared mapping before root set `SF_IMMUTABLE`. The runner's
securelevel was 0. The flag was visible and remained set; an ordinary user
could neither clear it nor open a new writable descriptor (`EPERM`). Yet the
already-open descriptor and shared mapping each wrote, and a read before root
cleared the flag returned `DM00` instead of `0000`. Root then cleared the flag
and ejected the image. The exact job, source hash and sanitized result are in
`audits/step12_jetstream/SYSTEM_FLAG_CHARACTERIZATION_20261011.json`.

This proves the system flag is an open-time fence on this owned APFS setup,
not revocation of existing writable handles. It cannot close D151's detached
writer or D157's point-in-time census gap by itself. A future hold design
would need a root-capable, complete descriptor and writable-mapping census
after fencing, plus continuous treatment of new root writers and boot/UTM
starts. That design and a production rehearsal remain unproven. The one-time
CI job is removed after recording this negative; the probe remains for audit.
No production process, store, service or VM was changed. Step 1.2 remains
`[A]/v1.2-pre`.

## D161 — Include retained vnode fileports in the holder census (2026-10-11 19:36 EDT)

The macOS process API exposes fileports separately from ordinary file
descriptors. An owned native control made a fileport from a writable descriptor,
closed the descriptor, and observed the same file's device, inode and write
flag through `proc_pidfileportinfo` and the process's `PROC_PIDLISTFILEPORTS`.
The former census would miss this retained write handle. The process snapshot
now lists vnode fileports and refuses an unobservable or changing list; the
store-holder census includes matching fileports as a distinct reference type.
The owned macOS control, a holder-report integration test and deterministic
write-protection aggregation tests pass locally. A separate owned child
retained the fileport after closing its descriptor; the parent process read
that child's fileport, matching inode and write flag, through the same
`vnode_snapshot` path the census uses.
The dedicated macOS CI job
[`114606174342`](https://github.com/moltyguibros-design/openclaw-node/actions/runs/38185286161/job/114606174342)
passed at exact head `c135e912`, independently of the long launchd suite.

This is evidence plumbing, not a full-node no-writer certificate. It is a
readable-process point-in-time scan, not one instant across the host; the
production same-user scan has unreadable PIDs, and process root, in-flight
handles, unbound detached writers, root writes and boot starts are not closed.
No production process, store, service or VM was changed. The four NATS
histories remain separate, and step 1.2 remains `[A]/v1.2-pre`.

## D162 — Root census on an owned runner still has unreadable processes (2026-10-11 19:52 EDT)

A one-time isolated macOS CI job ran the current store-holder census as root
against four disposable store directories. Its owned child closed the original
write descriptor but retained a writable vnode fileport. The census found
that holder, so the D161 fileport path works across processes under root.
After its retry, 39 PIDs were still unreadable; one failed PID had exited,
and the before/after process lists differed. The sanitized result, probe
hash and exact job are in
`audits/step12_jetstream/ROOT_HOLDER_COVERAGE_20261011.json`.

The counts do not identify why each process was unreadable or establish
whether any held a NATS store. They do establish that this root snapshot
cannot certify complete process coverage even on the owned runner. It also
is not a single instant or a continuous interval. A full-node writer proof
must use a different physical exclusion or observer contract, and prove that
contract on owned resources before production use. The diagnostic script is
retained and its one-time CI job removed. No production process, store,
service or VM was changed; the four histories remain separate and step 1.2
stays `[A]/v1.2-pre`.

## D163 — A retained Mach memory entry defeats the descriptor and mapping census (2026-10-11 20:01 EDT)

An owned macOS child opened a disposable file for shared writable mapping,
created a writable Mach named memory entry from that mapping, then unmapped and
closed the original descriptor. Before the child remapped the entry,
`vnode_snapshot` found no matching descriptor, fileport or mapping, and the
store-holder census listed no holder for that child. The parent then set
`UF_IMMUTABLE`; a new writable open was refused. The child remapped its retained
entry, wrote and synchronized a byte, and the parent read `M000` while the
immutable flag was still set. The independent macOS CI job succeeded at
`e171b4cf`; the exact sanitized result, source hashes and job are retained in
`audits/step12_jetstream/MACH_MEMORY_ENTRY_CHARACTERIZATION_20261011.json`.
The read occurred after the child had unmapped and exited. It proves a change
to the shared VM object visible to a fresh read, not durable media persistence.

This owned negative shows that the current descriptor, fileport and mapping
scan can report no reference while a process retains a path to modify the
file. It also shows that the user immutable flag did not revoke this existing
memory entry. The same-user census had unreadable PIDs; that count is not the
separate root-probe result and is not the cause of this child's false negative.
This experiment does not prove whether a root observer could enumerate Mach
memory-entry rights or provide continuous coverage. The census coverage field
now names unmapped Mach memory entries as excluded. Treat the current census
as a diagnostic, not a full-node no-writer certificate. A different physical
exclusion or observer contract must be demonstrated on owned resources before
production hold. The probe source remains; its one-time CI job is removed.
An adversarial follow-up found that the original probe did not assert the
child was actually read by the separate census. The retained macOS census job
now reruns the probe with a wrapper that records a successful child snapshot,
checks the process start identity and requires the child absent from the
unreadable/exited lists. The probe also fails if the expected refusal or write
does not occur; its first CI result is to be recorded separately.
No production process, store, service or VM was changed. All four NATS
histories remain separate and step 1.2 remains `[A]/v1.2-pre`.

## D164 — Prove the hidden holder was readable in the actual census (2026-10-11 20:12 EDT)

Claude's read-only D163 challenge identified a confound: the initial probe
reported zero holders but did not assert that the separate census successfully
read its child. The probe now witnesses the census's real `vnode_snapshot` call
for the child, requires its start identity unchanged, requires it absent from
the unreadable and exited lists, and fails unless the fresh-open refusal and
post-flag remap/write both occur. A local owned run passed. The first workflow
edit put this strengthened probe in the long legacy macOS job by mistake; the
short dedicated job at `adb62a54` therefore did not run it. It was moved to
the short job at `9cf49deb`, and exact-head job
[`114611521197`](https://github.com/moltyguibros-design/openclaw-node/actions/runs/38187050218/job/114611521197)
passed all three census suites and the strengthened probe. Its result has
`child_readable_in_census:true`, stable identity, zero child references and
holders, new writable open refused, and `M000` after remapping. The sanitized
result and new script hash are appended under `readability_followup` in the
D163 evidence file. Other PIDs being unreadable are no longer a confound for
this owned child's false negative. The result still does not establish durable
media persistence or whole-host and continuous coverage.

The diagnostic cannot authorize a full-node hold. A demonstrably complete
physical exclusion or different observer contract, stable approved 23-job
pins, guest hold and host boot/UTM gates must precede production shutdown.
No production process, store, service or VM was changed, and all four NATS
histories remain separate at step 1.2 `[A]/v1.2-pre`.

## D165 — Ordinary APFS unmount refuses a retained memory entry on an owned image (2026-10-11 21:49 EDT)

The D163 child was run against a file on a disposable APFS sparse image.
While it retained a writable Mach memory entry after closing its descriptor
and unmapping, normal `diskutil unmount` returned 1 and the volume stayed
mounted. The child then remapped the entry and wrote `M`. After child exit,
normal unmount returned 0; the same image was detached and reattached
read-only, and a fresh read showed `M000`. The local run and the short macOS
CI job at `5c360c22` produced the same result. The exact source hashes,
sanitized output and job are in
`audits/step12_jetstream/OWNED_UNMOUNT_MEMORY_ENTRY_20261011.json`.

This is an owned physical-boundary characterization, not a production hold
receipt. The probe did not capture `diskutil`'s refusal reason, and it cannot
show that the live guest's system/Data volume can be unmounted. It does not
exclude writers on other volumes, make UTM boot-safe, or prove a clean VM
shutdown. The one-time CI invocation was removed after recording the result;
the probe remains reproducible. The guest full-node no-writer hold, stable
approved 23-job pins, host boot gate, stopped-VM capture, four-history
acceptance and verified resumption remain open at 1.2 `[A]/v1.2-pre`.
No production process, store, service or VM was changed, and all four NATS
histories remain separate.

## D166 — Contrast retained-entry unmount refusal with a live no-entry child (2026-10-11 21:55 EDT)

Claude's read-only D165 challenge found that the first probe lacked a live
child with no retained entry, did not capture the refusal text, and had two
cleanup failure paths. The revised probe first starts a child that opens and
closes the same file, remains alive, and permits normal unmount of the owned
APFS image. It then reattaches that image and starts the D163 retained-entry
child: normal unmount refuses while mounted, the child remaps and writes, and
normal unmount succeeds after exit. Detach and read-only reattach show `M000`.
The probe records both tool outputs, bounds the child response, kills a child
that does not terminate promptly, and leaves its private directory intact if
an attached image cannot be detached. Local and independent short macOS CI
runs agreed; the exact result, source hash and job are in
`audits/step12_jetstream/OWNED_UNMOUNT_CONTROL_20261011.json`.

This contrast supports, but does not conclusively prove, that the retained
entry caused refusal. `diskutil` reported only "failed to unmount", without
an errno or `EBUSY` reason, and the arms ran sequentially. It tests one hidden
reference class on a disposable, unmountable volume. The guest system/Data
volume remains mounted while the VM runs, so this does not solve the live
full-node no-writer hold. It may inform stopped-image capture checks after a
separately proven shutdown and boot gate. The one-time CI invocation was
removed. All production hold, capture, acceptance and resumption gates remain
open at 1.2 `[A]/v1.2-pre`; the four NATS histories remain separate and no
production state changed.

## D167 — A successful cold probe does not prove serving-master origin (2026-10-12 06:47 EDT)

An owned macOS run at PR #224 head `516a58ec` copied one serving member's
frozen JetStream master into a new path for the other serving member, retained
the latter's original baseline, and regenerated the fixture's synthetic match
receipt and plan for the substituted bytes. The unmodified cold probe exited 0
and wrote `probe.json`; the normal four-history fixture passed afterward and
all owned servers stopped. The exact experiment patch, versions, hashes,
outcome and scope limits are in
`audits/step12_jetstream/OWNED_DUPLICATE_SERVING_MASTER_20261012.md` and its
paired JSON and patch files.

The probe remains a mechanism test, not a source-independence or historical
acceptance certificate. Production `host_match` compares each extracted role
against the guest's observed bytes and would reject a post-guest-capture copy
with an unchanged guest manifest. This experiment used a synthetic receipt and
does not contradict that comparison. A copy already present before guest
capture or a forged guest origin remains a separate provenance problem. Do
not promote unique whole-tree digests into an origin gate; inequality cannot
prove independent source history. The reviewed acceptance boundary must
establish four physical source roles and trustworthy guest origin as well as
the existing content and path checks. The pending hold-boundary choice remains
open; no production process, VM, service, store or topology changed, and step
1.2 remains `[A]/v1.2-pre`.

## D168 — Use the stopped-VM boundary for design and owned tests (2026-10-12 18:02 EDT)

The operator answered “GO” after reviewing the two choices in
`audits/step12_jetstream/HOLD_BOUNDARY_DECISION_CANDIDATE_20261012.md` and the
recommended revised boundary. We select that boundary **for design and owned
tests only**. Pre-stop checks will establish fail-closed application
quiescence, without claiming complete physical writer exclusion on the mounted
Data volume. Definitive physical no-writer proof belongs after a clean
whole-VM shutdown under an active host boot guard. This replaces the impossible
pre-stop proof requirement as a design target; it does not weaken the need to
preserve and independently restore-check the standalone NATS store and all
three cluster-member physical histories before any topology change.

This decision does **not** authorize stopping or restarting a production
service, stopping the live VM, changing NATS topology, or entering a production
window. A separate, fresh, explicit go/no-go for the exact attended window is
required after the installed 23-job pins, writer-provenance audit, disposable
UTM boot-guard rehearsal, owned controller, four-history preservation path,
and reviewed abort/resumption runbook pass. The heartbeat may prepare and
warn, but must not initiate the live stop. Step 1.2 remains `[A]/v1.2-pre`,
and the node is not accepted as operational.

## D169 — Require the non-NATS stop cohort before each serving NATS stop (2026-10-12 19:16 EDT)

The full-node journal previously permitted a serving NATS member to stop after
only the execution hold and deploy-listener fence, while other installed jobs
could remain loaded. Every serving NATS `disable-and-unload` now checks the
baseline-derived prior-loaded non-NATS set for one class-specific verified
persistent stop receipt per job and current unload plus disabled overrides.
The check runs before writing the NATS stop intent or invoking its stop action.
The installed cohort's `STOP_ORDER` remains the intended sweep order; an owned
test pins its equality with the 18 non-NATS, non-held installed units, while
the runtime gate derives completeness from the journal baseline to fail closed
if the cohort changes. Claude's adversarial pass rejected an earlier proposed
NATS-monitor receipt that lacked an anchored server identity and could accept
coherently fabricated caller captures; this smaller ordering gate does not use
those receipts.

The owned negative leaves either a timer or the on-demand mesh agent loaded:
both refuse before NATS stop intent and application; stopping the missing job
then allows the next owned NATS stop. The 155 journal and 23 user-transfer tests
pass on macOS Python 3.9.6. This proves an ordering precondition for the
managed cohort, not absence of detached, external, or physical store writers.
B5 remains open for the complete owned controller, host boot-guard rehearsal,
abort/resumption path and reviewed production runbook. B6 remains a separate
exact-window release; no production process, VM, service, store or topology
changed, and all four NATS histories remain separate.

## D170 — Root independently rejects incomplete non-NATS stop cohorts (2026-10-12 19:35 EDT)

Claude's read-only adversarial review of D169 found a root-admission false
accept: a user-owned transfer journal could omit all 17 non-listener,
prior-loaded non-NATS stops while still passing the privileged reader. The
owned negative reproduced that acceptance against the original reader. Root
admission now derives the required cohort from the baseline and requires each
job's unique stop intent and bound class-specific verified receipt before the
first serving NATS stop intent. It checks the original hold session, unloaded
label and disabled overrides on each receipt, and rejects any later verified
snapshot that shows a cohort label loaded. The separately checked listener
remains part of the loaded-label fence. The user-side transfer writer also
rechecks the complete fence immediately before publishing its transfer intent.

A second owned negative places the observer stop after the first NATS intent:
root refuses even though the job is stopped by transfer time. The positive
full-cohort transfer remains accepted. The idle proof now binds its reported
prior loaded/running state to the baseline, so a running known-broken job
cannot use an idle receipt. The 155 preservation-journal and 25 user-transfer
tests pass on macOS Python 3.9.6; plan-lint reports 14 PASS, one known idle-step
WARN and zero FAIL. These checks validate journal order and evidence fields,
not the physical absence of detached or external writers, and they do not
turn user-controlled evidence into an independent machine attestation. B5,
B6 and the production boundary remain open. No production VM, service, NATS
store or topology changed; all four histories remain separate.

## D171 — Bind full-node stop receipts to the original live hold at write time (2026-10-12 19:53 EDT)

Claude's adversarial follow-up on D170 reproduced a late root refusal: direct
`Journal.mutate(..., hold=hold)` could persist every cohort and NATS stop and
publish a transfer intent with a missing or stale `execution_hold` field. Root
then refused after all serving NATS members were already stopped. The intended
production `JournaledHold.mutate` wrapper supplied the field, but the journal's
public mutation path and owned fixtures did not require it.

The full-node journal now records the certificate returned by its current hold
on every verified `disable-and-unload` receipt. When the original hold has a
native watch session, a missing current certificate or a certificate from a
different session refuses the stop; a callback's conflicting session claim is
also refused instead of silently trusted. Before each serving NATS intent,
`non_nats_fenced` checks that the listener and all prior-loaded non-NATS stop
receipts name the original session. Synthetic legacy fixtures with no native
session remain mechanism tests, not root-admissible production evidence.

Owned negatives refuse a missing certificate and a stale callback claim at
the first affected non-NATS stop. Root also refuses tampered cohort hold,
label, idle baseline, override, duplicate intent and later loaded-snapshot
evidence; the previously unpinned service-before-listener-intent condition now
has a negative. The normal direct-journal fixture binds all 21 stop receipts
to the original session and is admitted by root. The 155 journal and 30
user-transfer tests pass on macOS Python 3.9.6. These are ordering and
evidence-continuity checks, not physical writer exclusion. B5 and B6 remain
open; no production VM, service, store or topology changed, and all four NATS
histories remain separate.

## D172 — Require a host-acknowledged guest store commitment before cold capture (2026-10-12 22:44 EDT)

Claude's adversarial review of the B5 host matcher reproduced acceptance of a
stale guest store manifest and of a manifest regenerated after a later store
write. A separate guest/host timestamp comparison falsely refused a correct
manifest when the guest clock was ahead. These cases meant byte agreement alone
did not bind a store observation to the recovery window.

The owned host capture now arms with a random nonce. While it observes the
original VM started with one image holder, a separate host tool commits the
four-store guest manifest under the arm lock. It then publishes the commitment,
observes the VM still started with the same holder and source identity, and
durably writes `ACKED.json`. This proves a host started-state sample after the
commitment was durable; it does not prove the guest received the acknowledgement
or chose to shut down afterward. The future guest controller must record that
receipt in evidence the stopped image carries. A first stopped observation or
host guard without a valid commitment and acknowledgement refuses before
cloning or guarding. The capture receipt
pins both hashes, and the host matcher uses only the committed manifest. Clock
timestamps are informational. Per-attempt preflight directories allow a retry
before publication; a failed post-publication acknowledgement remains a
fail-closed window abort.

Claude's exact-head review found a non-ASCII manifest false refusal, a
one-shot retry gap and two weak negatives. The serializer now matches the guest
writer. Owned tests cover a Unicode store filename, retry after a failed
preflight, stop or holder change between publication and acknowledgement, a
decisive early-stop clone sentinel, forged acknowledgement identity, a
post-commit byte change and regenerated manifest, and guard refusal before
intent. The macOS owned host-capture
and reconcile suites pass. This is a temporal and byte-continuity component,
not a B5 close: the manifest still lacks durable full-node journal and root
outcome binding, and the stopped ASIF does not yet supply those frozen records.
Physical writer exclusion and complete abort/restore remain unproven. The
production capture path stays disabled. No production VM or service was stopped
or restarted, and all four NATS histories remain separate.

## D173 — Develop a capture checkpoint without root NATS transfer (2026-10-12 23:44 EDT)

Claude's read-only adversarial review of PR #224 at `598013c3` found that B5's
next action described an impossible pre-shutdown state. `Journal.close()` only
releases locks, full-node `seal()` is refused, and `resolve()` requires verified
service restoration. The nearest transfer terminal is `nats-transfer-closed`,
but guest transfer and root decline/publish refuse production use. More
seriously, an owned forged-journal probe with no execution hold or stop
receipts was rejected by root admission yet accepted by root decline, which
published `declined`. A decline receipt therefore cannot be treated as a hold
certificate. Root transfer also creates an open-intent crash state that cannot
abort without the disabled root path.

D168 selected a stopped-whole-VM preservation boundary, not a root handoff
before capture. For **design and owned tests only**, B5 will instead develop a
restore-only `capture-ready` journal checkpoint after the managed full-node
cohort and all three serving NATS members have class-specific stopped receipts
bound to the original execution hold; the fourth, already-held member remains
separate and disabled. The checkpoint will bind the host arm nonce and the
four-store guest manifest to an exact journal head. A host verifier must read
that user-owned journal from the stopped ASIF and recheck its chain, cohort,
session, boot, nonce and terminal state. These records attest application
quiescence and byte continuity, not physical writer exclusion. The latter is
proved only at the clean stopped-VM boundary under active host boot denial,
followed by four separate isolated real-history restores. Protected root
migration remains a later, separately reviewed operation.

The same review found a second B5 blocker: `Journal.recover()` refuses a
full-node journal after the necessary VM reboot, and the execution hold pins
filesystem identities whose stability across a macOS guest reboot is
unverified. A planned-reboot, restore-only admission must be designed and
tested with fresh stopped-unit and persistent-override observations, including
an owned disposable macOS VM identity/reattach test. B2's existing disposable
VM runs Alpine, so this macOS test needs a separately verified non-production
macOS UTM VM and disk; the production `moltMacOS` VM must not be used. Failure
must leave the node held for an explicit manual restoration route. Until that route, host
record extraction and the abort/resumption controller pass, B5 and B6 remain
open. This decision permits no live service or VM stop, topology change or
claim that the node is operational; B6 still needs a fresh exact-window
operator release. Preserve the standalone and all three member histories
separately throughout.

## D174 — Correct checkpoint proof and planned reboot contract (2026-10-13 00:04 EDT)

Claude's read-only adversarial review of D173 at `66e4c2bd` confirmed that
developing a checkpoint without root transfer is within D168's design and
owned-test choice. It found that D173's proof wording and reboot sketch were
too broad. This decision narrows them; D62 and D64 remain governing.

The user-owned `capture-ready` journal is application-quiescence evidence,
not byte-continuity or physical writer-exclusion evidence. Host commitment,
ACK and capture receipts must bind frozen store bytes to the committed
manifest. A stopped VM under active host boot denial excludes writes from
power-off onward. The interval between the last NATS stop and the manifest
still rests on user-owned quiescence evidence. Four isolated restores prove
restorability and consistency, not authorship or historical independence.

The original guest must stay powered off while B8 extracts, restores,
accepts and freezes all four histories. The host boot guard stays applied
until a durable host ACCEPTED decision after B8 or an explicit ABORT decision
after host cleanup. Before any gate reopens, the guest binds that decision.
Before `Journal.recover()`, a controller must compare **all** boot-time
OpenClaw jobs and processes against the recorded hold, refuse unexpected
starts, and freshly check stopped units and persistent overrides. A
stop-receipt-only cross-boot admission is insufficient. Failure remains held
for an explicit manual restoration route.

The execution hold currently pins a transient filesystem device number in
its durable identity. Consistent with D42's earlier rule, B5 must replace
that field with a durable file/volume binding and test an owned APFS image
detach/reattach. This avoids making device-number stability an artificial
macOS reboot dependency. D62 still requires a disposable macOS rehearsal of
the actual disable/unload/re-enable, login-start, process-census and hold-
reattach behavior; B2's Alpine VM cannot supply that evidence. Codex may
inspect existing isolated machines, installer availability and host capacity
read-only. A new macOS VM requires an operator decision on its disk budget
after this assessment, an unchanged production VM state and image holder, and
free space above the 20 GiB capture floor plus a measured production-image
growth margin. Codex must never quit or restart UTM or the host, change the
production VM's configuration or use its disk for rehearsal.

B5's owned fixture results cannot substitute for the macOS reboot rehearsal.
B6's separate exact-window release must name D173's user-owned pre-stop
evidence limit, D62's ACCEPTED-or-ABORT pre-boot rule, and the manual restore
fallback. D174 authorizes no live service or VM stop and no topology change.

## D175 — Conditionally re-pin installed timer gates after an authorized boot (2026-10-13 00:17 EDT)

Claude's code-traced challenge of D174 found that its “replace the durable
device field” instruction missed the five production timer plists and their
manifest. Their installed gate pins encode `device:inode:ctime_ns` for the
lock and `device:inode` for the root; each timer checks those pins before a
run. The full-node baseline and restore-only driver also bind them. A source-
only change or an owned APFS reattach test would not update the node. An
ordinary guest reboot that changes the Data volume's device number can make
all five timers exit 78. This pre-existing risk is now an explicit B5 warning.

No pre-B6 timer reinstall is permitted. Re-pinning would reload production
jobs, contrary to the no-stop rule; re-pinning after the full-node hold but
before shutdown would change the frozen installed identities and cannot know
the post-boot device. B5 instead develops and tests a conditional, journaled,
value-only re-pin in the restore-only controller. It runs **only if the device
number changed**, after D62/D64 reboot admission and before constructing the
post-boot gate or restoring any timer. The same gate objects must be bound by
stable inode, birthtime, lock ctime, metadata nonce/hash, volume UUID and
path-chain evidence. Keep same-boot descriptor and path mapping checks on
`st_dev`; changing the installed pin format is separate future work.

The re-pin records old and new gate pins, then changes only the manifest's
`gate_pins` and the five plists' manifest hash and pin arguments. It records
the byte hashes and field-level diff in the journal before any timer loads.
The restore-only checks may accept exactly this recorded migration for the
five timers and no other code, plist, job or field. Owned negatives must
reject a changed inode, birthtime or nonce, an extra field, a non-timer job,
pre-admission or same-boot migration, and a second migration. The disposable
macOS rehearsal must exercise the complete sequence across reboot on owned
timer copies; an owned APFS detach/reattach exercises the device change.

B3 pins the current installed bytes before a window and records the allowed
conditional migration form; it does not pre-install new pins. B6's fresh
window release must explicitly include the conditional post-admission,
pre-restoration timer re-pin. B9 checks the migration rows and live gate
identity when applicable, then observes one successful gated run of each
timer at exit code 0 and records the new installed hashes for later windows.
No production service, VM or NATS history was changed by this decision.

D174's process wording is also bounded: the reboot controller compares all
OpenClaw launchd jobs and every process running as the OpenClaw user or
executing from the production entrypoint roots; an unreadable or
unattributable process in that scope refuses. D162–D164 prevent treating this
as a complete physical process census. An existing macOS machine cannot be
used for destructive rehearsal until the operator designates that exact
machine disposable. Running any second macOS guest on the production host
needs an operator disk-and-memory budget and the production-VM checks, even
if that guest already exists.

## D176 — Validate each stop receipt's hold certificate before root transfer (2026-10-13 07:07 EDT)

Claude's read-only adversarial review of `82167507` confirmed that D171's R3
and R4 root negatives are decisive, then found a separate evidence-continuity
gap. Root transfer checked the original and transfer hold certificates fully,
but checked each listener, non-NATS and NATS stop receipt's `execution_hold`
only by session ID. A forged receipt with the correct session and
`verified: false` passed the root reader. The user-side non-NATS fence also
accepted it. `Journal.mutate()` refused a false live certificate, but no owned
negative pinned that sole check.

Root admission and the session-bound user fence now require every stop
receipt's certificate to retain `verified: true`, `restoration_only: false`,
the kernel file/path watch flags and the original session. Direct stop mutation
checks the same live certificate before persisting the receipt. Owned tests
tamper each receipt class and each flag; a separate user-side negative pins
refusal of a matching-session but unverified live certificate. Synthetic
sessionless journal fixtures remain usable for older isolated controls; root
transfer still rejects them. These are structural evidence checks, not a
physical writer boundary or permission to run the production-disabled root
transfer. B5 and step 1.2 remain open; no production VM, service, store or
topology changed, and all four NATS histories remain separate.

## D177 — Recheck serving NATS receipt holds before transfer intent (2026-10-13 07:34 EDT)

After D176, a forged serving-NATS stop receipt with the original session but
`verified: false` still passed the user-side `transfer_nats()` recheck, which
used only the managed-stop fields. An owned probe rechained the full on-disk
journal: the user side wrote `nats-transfer-intent`, then root refused that
receipt. The honest `Journal.mutate()` path stamps a valid certificate, so
this is a structural forged-journal divergence, not a demonstrated live
production stop. Production root transfer remains disabled.

For each serving-NATS receipt, `transfer_nats()` now checks the full live
certificate against the original hold session before writing the transfer
intent. A five-case user-side negative covers the four hold flags and a stale
session; deleting the new recheck makes all five cases fail by missing their
expected refusal. This does not prove physical writer exclusion or close B5.
Step 1.2 remains open, no production VM, service, store or topology changed,
and all four NATS histories remain separate.

## D178 — Pair transfer receipt recheck with live hold validation (2026-10-13 07:41 EDT)

Claude independently reproduced D177 at `da26f9aa` and tested the guarded
receipt check against the honest path and sessionless synthetic fixtures. It
also found that `transfer_nats()` could publish an intent under a synthetic
non-facade hold whose live certificate disagreed with the original anchor;
root would refuse that transfer. The production `JournaledHold` facade
rejects such a certificate, so this is the same structural continuity class,
not a demonstrated honest-path failure.

The session-bound transfer gate now validates both the live hold evidence and
each serving-NATS receipt against the original anchor before publishing.
Distinct refusal messages pin the two checks. Owned negatives cover all four
flags and a stale session, including a forged `nats-3` receipt. A sessionless
anchor retains the prior synthetic-fixture behavior; root still rejects it.
Forging the journal after a transfer intent remains root's responsibility.
These checks do not establish a physical no-writer boundary, enable the
production-disabled root transfer, or close B5/step 1.2. No production VM,
service, NATS store or topology changed; four histories remain separate.

## D179 — Pin listener inclusion and original anchor flags (2026-10-13 07:53 EDT)

Claude's exact-head review of D178 found no material failure, but identified
two unpinned pre-intent assumptions. The user fence counts the prior-loaded
deploy listener as a non-NATS job; excluding it would let a forged listener
receipt reach transfer. Separately, `transfer_nats()` checked the original
anchor session but not its own live-watch flags, so a forged anchor could
publish an intent that root then refused. Neither is reachable through the
honest `JournaledHold` facade, and production root transfer is disabled.

The session-bound transfer gate now checks the original anchor's full hold
certificate before intent publication. A valid-chain forged-listener test
pins the implicit non-NATS inclusion before the first serving-NATS stop. Four
forged-anchor cases and a listener-exclusion mutation fail by missing their
expected refusals. Sessionless synthetic fixtures keep their prior behavior;
root still rejects such journals. This is structural evidence continuity,
not physical writer exclusion, and B5/step 1.2 remain open. No production
VM, service, NATS store or topology changed; four histories remain separate.

## D180 — Classify an undetermined managed kickstart (2026-10-13)

Exact-head macOS CI at 69970bb6 timed out a launchctl kickstart in an owned restoration test. The cause remains undetermined. Killing the client does not establish whether launchd applied the action. The managed kickstart now always raises UndeterminedLaunchdAction after a command timeout, with the original timeout budget and one bounded one-second status observation, or only the observation error type. It never accepts or retries based on that sample. Precondition timeouts and nonzero command exits keep their original classification.

Five direct tests and a checksum-verified Claude fixture run against the actual local diff pin classification, durable journal propagation, closed gate/unresolved receipt, forwarded budgets and fresh-observation retry without another kickstart. Claude found no defect in the described revision; review of the published head and exact-head CI remain required. This is diagnostic evidence only: baseline already failed closed; the real launchd cause and B5 checkpoint/abort/reboot work are not resolved. D64 is unchanged, four histories stay separate, and no production state changed.

## D181 — Pure literal NATS identity reader (2026-10-13)

The capture-checkpoint role binding needs a config-derived identity anchored to the baseline argv/hash and a just-in-time window pin table. Add a pure strict-subset reader and binder, with filesystem reads left to the future caller. The reader emits only server_name/store_dir/cluster; errors never include config values. Exact unit roles and suffixed store paths reject consistent member swaps. Member1 binds from baseline-held evidence, not a fabricated stop receipt or continuous physical proof.

Claude verified capacity aliases against tagged NATS v2.12.6 source, supplied checksum-pinned files and killed 23 source mutants. The first reader refused installed max_mem; the revised reader supports only the verified memory/file alias groups, refuses duplicate capacity aliases and bounds unsigned bare sizes. All 15 tests pass locally, and read-only parsing accepts all four installed configs at their unchanged baseline hashes. This does not prove parser equivalence, live server interpretation or origin. B3 must pin the exact window table just in time; the capture checkpoint, frozen-ASIF integration and macOS rehearsal remain open. No production stores were read or mutated, no service/VM changed, four histories remain separate and D64 is unchanged.

## D182 — Preserve owned controller readiness evidence (2026-10-13 22:49 EDT)

A local combined test missed the owned interrupted-controller readiness deadline before any simulated launchd action; the cause remains undetermined. Register cleanup immediately so failed setup closes the gate and removes only its private tree. Run the child with isolated Python and explicit import path. Keep the ten-second deadline and capture phases, pre-signal exit status and a bounded stack request on failure. Label stack presence from received evidence and preserve output if the request terminates a child before the handler is installed. No production code, recovery predicate or applied-timeout assertion changes.

Claude supplied the corrected fixture at SHA256 844413c1f79f0b90567efbfd2d914dc0ed54f419a88e9b306d1f9301d584670e, tested eight scenarios and decisive mutants on owned resources. Local macOS verification and new exact-head CI govern publication readiness; the successful parent CI does not explain either earlier timeout. B5/1.2 remain open; no production state changed.

## D183 — Refuse bare quotes and pin slow fixture startup (2026-10-14 00:53 EDT)

Claude exact-head review at 433248c8 found that a bare trailing quote was retained by the pure reader while NATS terminates that token; role binding still refused it. Refuse quote characters inside bare scalars and pin the refusal. Two owned readiness controls incorrectly assumed interpreter startup within one second; retain their deadlines and assert either observed started-phase evidence or the explicit early-start shape. A 1.5-second injected startup delay exercises both controls. These changes do not explain the real-launchd kickstart CI failure, which recurred with a running owner observed after timeout while the gate and receipt remained closed/unresolved. No production code path or service state changes.

## D184 — Independent readiness-control branch evidence (2026-10-14 02:53 EDT)

Claude found the D183 slow-start branch could conceal discarded controller output: missing phases selected the early-start assertions even after the child had reached its blocking phase. Each control now has a separate child-written marker and branches on that file, not on the output being tested. Injected slow startup retains the original deadlines and reaches the marker-absent branch. A local output-discard mutant is killed by the marker-present assertion requiring the blocking phase. Add the missing bare double-quote refusal case.

Required CI at f9b4c37a again failed the real-launchd kickstart test while all added tests passed; the diagnostic first observed no running owner, then final-state verification observed one. The client-blocking cause is still undetermined and recovery stayed partial/closed/unresolved. These control corrections do not claim to fix that cause or complete B5. No production state changed.

## D185 — Terminal capture-ready checkpoint and frozen verifier, owned tests only (2026-10-14)

Under D168/D173/D174, B5 adds a restore-only `capture-ready` journal checkpoint without root decline or transfer. `Journal.capture_ready()` requires the full-node owner and the original hold facade, then the existing forward preconditions (same boot, not reopened, no failure, pending intent, transfer or prior checkpoint) and the exact durable chain. One record-only predicate, shared with the frozen verifier, requires a strictly serial window: a published first execution hold in the exact `JournaledHold` intent shape whose certificate carries a mandatory session, the deploy listener stopped first, every other prior-loaded non-NATS job next and the three serving NATS units last, each exactly once with a class-specific receipt bound to that session (D176–D179); the original, every stop and the live certificate must also name the one published hold receipt, as the real facade's do, launchd loaded/override continuity at every step and nothing managed left loaded. Member1 has no intent or receipt. Fresh observations must show every prior-loaded unit stopped and disabled and every other unit, member1 included, unchanged, under a live certificate valid before and after observation, an unchanged inventory and no NATS writer marker.

The record binds the pre-head, baseline, host arm nonce and digest, canonical guest manifest digest and D181 role identities, rederived from the same config bytes. The manifest must carry the arm nonce, name the pre-head as `journal_head` (new optional `guest_capture` field) and place each role's store at its bound `store_dir`. Afterward, mutation, transfer and a second checkpoint refuse. Same-boot restoration is unchanged; D64's cross-boot recovery refusal is unchanged and pinned. `verify_capture_checkpoint()` is pure. Over extracted records and supplied arm, manifest, pins, config bytes and committed checkpoint digest, it rechecks chain, single terminal checkpoint, boot continuity, cohort and every checkpoint field. A manifest pre-head names only the prior head and cannot pin checkpoint bytes, so the verifier requires the committed digest.

The checkpoint attests application quiescence only, not byte continuity, physical writer exclusion, authorship or production readiness. Its positive controls compose `Journal.mutate` and the real `JournaledHold`; the real-facade control is macOS-native, so on Linux it ran only with a simulated kqueue source. No full-node driver yet produces the cohort: `StopWatch` refuses a persistent serving-NATS stop until a NATS recovery adapter exists, and timer stops exist only as apply/verify helpers. The verifier's digest check is only as strong as its provenance: the host gate must pass the digest from `require_committed()`, never the extracted record's own digest. Host commitment of the checkpoint digest (with `journal_head` required) and read-only stopped-ASIF extraction of journal, node receipt and config bytes (refusing pending/unknown entries) remain open gates, as do the NATS persistent-stop adapter, the durable hold volume binding, planned-reboot admission (D174/D175), disposable macOS rehearsal and the B3 window pin table. No production service, VM, store or topology changed; four histories remain separate, B5/1.2 stay open and B6 closed.

## D186 — Separate host commitment of the capture-ready checkpoint digest (2026-10-14)

D185's frozen verifier is only as strong as the provenance of its checkpoint digest: given the extracted record's own digest it pins nothing. The host therefore commits that digest itself, separately from the manifest, while it still observes the original VM running. `commit()` now requires the guest manifest to carry a 64-hex `journal_head`, and `require_committed()` rechecks it. After the ACK, `commit_checkpoint()` takes the guest's exact capture-ready journal file. It must be intact and canonical, and must bind the armed nonce and digest, the committed manifest digest and `previous == pre_head == journal_head`. Under the arm lock, with the capture worker active and before any guard or capture artifact, the host takes one more running-VM sample matching the ACK. It then writes `CHECKPOINT.json` binding the COMMITTED and ACKED digests, nonce, manifest digest, journal head and checkpoint digest. A second commitment refuses.

`require_committed()` now requires that record too, so the image guard and capture worker refuse without it. It is the only source of the checkpoint digest. `verify_capture_checkpoint()` takes the commitment object it returns, not a digest string: arm digest, nonce, canonical manifest and checkpoint digest all come from host records. The host wrapper `verify_frozen_checkpoint()` obtains that object only from `require_committed()`. Owned tests drive the real journal, `capture_ready()`, `commit()`, `commit_checkpoint()` and the verifier with only host samples mocked. Refusals cover a terminal-record substitution after commitment, a regenerated manifest with a re-derived checkpoint, a foreign arm, nonce or head, non-intact records, a changed or stopped VM sample, a changing handoff file, a double commitment and every recorded field; the substitutions verify under self-input and refuse under the committed digest.

This does not enable production capture, which still refuses without a verified acceptance or abort controller. It commits a digest, not the record's cohort content, which is rechecked only from the journal extracted from the stopped image. That extraction (journal directory listing, node receipt and config bytes, refusing pending or unknown entries) remains an open gate. So do the serving-NATS persistent-stop producer and NATS recovery adapter, native macOS CI for the updated end-to-end capture and facade tests, and D174/D175 admission and rehearsal. D64 is unchanged; four histories stay separate; B5/1.2 stay open and B6 closed.

## D187 — Pin CHECKPOINT.json in the capture record and consume it only through the pins (2026-10-15)

Claude's review of the combined D185/D186 patch found that CAPTURE.json pinned the guard, COMMITTED.json and ACKED.json but not CHECKPOINT.json, whose `checkpoint_sha256` `require_committed()` checks only for format. After capture, a host rewrite of that one field passed `require_committed()`, `host_match()` and `verify_frozen_checkpoint()`: the frozen verifier then accepted a substituted terminal record and refused the authentic one, while the same rewrite of the pinned ACKED.json was caught.

The capture worker now keeps the checkpoint commitment as `require_committed()` returns it at the first stopped sample (`commit_checkpoint()` needs a running VM, so no later commitment is legitimate). Under the arm lock, `publish_pinned_capture()` reads the COMMITTED, ACKED and CHECKPOINT bytes, revalidates them, requires the CHECKPOINT bytes to parse to that stopped-sample commitment and still be in place after revalidation, and the COMMITTED and ACKED digests to equal those the validated checkpoint records, and pins all three in CAPTURE.json (`guest_checkpoint_sha256` is new); anything else refuses publication. `host_match()` checks the CAPTURE.json byte pins before it consumes `require_committed()`, refuses a capture without the checkpoint pin, records the committed `checkpoint_sha256` in MATCH.json, and its end-of-match recheck compares every input's bytes, now including COMMITTED and CHECKPOINT, before revalidating the commitment, so a changed input is named rather than surfacing as its own refusal. `verify_frozen_checkpoint()` first requires the private CAPTURE.json to pin the exact COMMITTED, ACKED and CHECKPOINT bytes, refusing before `require_committed()` is called, then requires the commitment it consumes to equal those pinned bytes. No digest is taken from the extracted records; the pure verifier still takes only the commitment object.

The v2 macOS end-to-end capture test, which Linux CI does not run, would have failed natively at three points: its post-capture ACKED byte change expected a capture-receipt refusal but CHECKPOINT's ACK binding refused first with another message; its mid-match ACKED change expected "input receipts changed during match" but the end recheck called `require_committed()` first; and its failed-capture flow called the guard without `commit_checkpoint()`, which the guard now requires. All three are corrected; a COMMITTED byte change now also refuses at the capture receipt, and the test adds CHECKPOINT substitution, COMMITTED and CHECKPOINT changes during the match and the MATCH digest.

Owned Linux tests drive the real capture worker to publication with only VM facilities stood in (preflight samples, guard receipt, clone, immutable flag, ASIF extraction): the authentic pin and MATCH digest, substitution before and after a match, the pinned-ACK control with CHECKPOINT and its pin rebound, byte-only changes to each commitment file after capture and during a match, a checkpoint rewritten after the stop or between stopped samples, an arm rewritten after the stop, any commitment file swapped between the pin read and validation (and a substitute put back after the authentic CHECKPOINT was validated), an unpinned capture and the pin-before-provenance order. The real-`JournaledHold` control now obtains its commitment only through real `commit()`, `commit_checkpoint()`, the capture worker's pins, `host_match()` and `verify_frozen_checkpoint()`; on Linux it ran only with a simulated kqueue observer, and it stays native on macOS.

The pins are tamper evidence inside one same-uid capture directory: a writer able to rewrite CAPTURE.json together with CHECKPOINT.json is not detected until an acceptance controller or protected store pins CAPTURE.json, which remains part of the open acceptance/abort gate. Production capture still refuses. D64 is unchanged; four histories stay separate; B5/1.2 stay open and B6 closed.

## D188 — Boot out the GUI status agent by its own label on every path, without masking the primary failure (2026-10-15)

`gui_utm_status()` ran `launchctl bootstrap` before its `try/finally`, so a bootstrap whose client failed or timed out after launchd had applied it left that sample's job loaded with no cleanup at all, and the `bootout` in `finally` raised over the original failure whenever it failed. The bootstrap now runs inside the same guard as the status wait. On any failure the sample's unique service `gui/<uid>/ai.openclaw.host-preflight.<uuid4 hex>` is booted out, and when that bootout fails or times out `launchctl print` of the same label is recorded. Each cleanup call keeps the existing 15 s bound and never raises. The results go to `utm-status-cleanup.json` beside the sample: `booted_out`, and after an unsuccessful bootout `absent_at_print`, true only for an answered 113 "Could not find service" (managed_launchd's reading of absence) and describing only that moment. The record is best effort (an unwritable one never replaces the error), and the original exception is re-raised unchanged.

On success the previous rule stands: a bootout that failed or timed out refuses the sample (`GUI UTM status agent bootout did not succeed: <label>`, with the same record), even when the print then reads the label absent. Absence is evidence about cleanup and never turns the unsuccessful action into acceptance. A timed-out bootstrap is never accepted, even when its helper already wrote a valid status. No deadline or expectation changed; a failing preflight can now take at most 30 s longer (one bootout and one print), which only delays a failure the capture worker already records in FAILED.json.

Owned tests drive the real function against a fake `launchctl` that models launchd state (bootstrap ok, failed, hung, applied then hung, or applied only after the cleanup's print; helper status written, absent or malformed; bootout failing, hanging, or removing the label and then failing or hanging; print hanging or refusing), with two unrelated loaded labels that must stay loaded and every bootout/print required to name exactly the sample's label. Subprocess timeouts and the 20 s wait are compressed by the test only. Thirteen tests pass. The unfixed function fails eleven; on the unsuccessful-bootout case it fails only on the message and the missing record, because it already refused there. Fifteen source mutants are killed, among them a success path that accepts absence after an unsuccessful bootout. The test runs on Linux and, under `/usr/bin/python3`, on macOS CI without touching the real launchd.

Residual: a bootstrap request still in flight inside launchd after its client was killed can apply after the cleanup's bootout found nothing and its print read the label absent. The owned test reproduces it. The original error stands and the record names the label with `absent_at_print` true, but the job is loaded afterwards, and nothing re-checks. The job has no KeepAlive, so it runs one read-only `utmctl status`, writes `utm-status.json` (and launchd's out/err files) into the already failed sample, and stays loaded until booted out by that label. No capture, guard, reconcile or dispose step reads that file; they read only `preflight.json`, which a failed sample never has. Closing this would need a wait, which D188 does not add.

This fixes cleanup, not the native B5 end-to-end stall before ARMED.json: whether that sample's bootstrap client was blocked, its job was never spawned or its helper was blocked in `utmctl` is still for the helper-snapshot diagnostic to show. Production capture still refuses. D64 is unchanged; four histories stay separate; B5/1.2 stay open and B6 closed.

## D189 — 2026-10-15: consume only the capture-pinned commitment in host matching

Exact head 586f66b7 passed all five CI jobs (run 38756995285). Claude review nevertheless reproduced a same-uid read race: host_match checked pinned file bytes, consumed a different require_committed result, then saw authentic files again at its final check. Match now requires the consumed commitment to equal the pinned COMMITTED and CHECKPOINT objects before using it. An owned validation-swap negative refuses without writing MATCH.json; authentic files remain unchanged. Exact-head CI must be repeated on the resulting commit before readiness.

Append-only correction to D186/D187: CHECKPOINT.json is user-owned and unprotected between commit_checkpoint and the first stopped worker sample. A same-uid actor can rewrite it or unlink and recommit before that observation; capture can adopt the replacement. First running observation could narrow this interval but cannot establish protected commitment provenance. CAPTURE.json and its pins also need an independent protected acceptance root against coordinated rewrites. The journal remains user-owned quiescence evidence only; no physical exclusion or authorship claim follows. These residuals remain required inputs to the open acceptance/abort gate, not claims closed by D189.

Shared-predicate mutation gaps identified by the exact-head review remain under owned test work. B5/1.2 remain open, B6 closed, production capture disabled and D64 unchanged.

D189 verification: native CapturePin suite 14/14 passes (6.818 s); deleting the new matcher comparison in an owned source copy makes the validation-swap test fail with RuntimeError not raised. The test-only predicate artifact from 69c42697 (SHA-256 87c72816a476af0c9771865e1198049cb3ce357318a96264c1d9b2e907705795) adds 13 tests; all pass natively (13.059 s). Its full 37-test positive and every designated control pass, and all 28 predicate mutants are killed for the intended acceptance reason locally (problems: []). Plan lint: local 14 PASS / 1 existing WARN / 0 FAIL; clean exports lack ignored automation/tick files and have a different lint baseline.

## D190 — 2026-10-16: preserve native downstream test boundaries and holder lifetime

CI at bae1d9ff (38807031493) correctly refused a mocked commitment before downstream specification checks. The native test now constructs complete COMMITTED/ACKED/CHECKPOINT/CAPTURE bindings, uses the real commitment verifier and restores all original bytes. The pre-arm swapped-spec candidate explicitly receives the arm nonce and journal head at its call site; the helper does not inject them. Downstream refusal messages and success assertions remain unchanged.

The three owned image holders previously exited after 30 s even when sampling continued, causing state/holder disagreement before checkpoint commit in 47.143 s and 51.766 s runs. Each now holds its descriptor until explicit termination or parent-pipe EOF. Existing terminate/wait and teardown remain; stdin pipes are registered for cleanup. Parent death closes the pipe, unlike an orphanable signal.pause holder. Production code and worker/ARMED deadlines are unchanged. Native full cold-extract passes with parent-bound holders (21.334 s); pipe cleanup was then registered to address ResourceWarnings. Exact-head CI is still required. B5 open, B6 closed, production unchanged.

## D191 — 2026-10-16: bounded read-only journal/config reader on owned Data roots

Add stopped_journal_inputs.py as an unmounted reader, not a production capture entrypoint. It derives fixed user paths from the capture-pinned four-role manifest, selects exactly one journal by committed checkpoint digest, validates canonical bytes and hash/sequence/previous links, follows finished predecessor lineage, checks the unresolved node receipt and empty owned locks, and supplies exact config buffers to frozen checkpoint verification. It never constructs Journal, recovers, mounts, writes to the input root, or rebuilds the B3 table from guest evidence. The future caller must provide a host-held pre-window B3 table; this provenance gate is not implemented here.

Fresh read-only local preservation metadata census found exactly three retirement-evidence files (evidence/pre/post-20261002), each uid501,0600,singlelink,regular; one timer window has23records,lastresolved,predecessor field present,no extra entries. Only those exact evidence names are tolerated, metadata checked and bytes budgeted, never interpreted. Pending, corrupt-receipt and unknown entries still refuse, even if Journal tolerates them; no production cleanup is authorized. Locks must exist and be empty. Inputs are bounded to1024entries per directory,4096files total,1MiB each and16MiB total; this bounds raw input, not Python heap amplification. Config modes are recorded but not constrained. A static read-only mounted root with ownership honored remains a required caller precondition.

Evidence:29owned native tests pass28.789s;42one-rule source mutants killed for intended reasons, with unmutated suite and designated controls passing. The three artifact patches were checksum-verified from f027e58c,74d5719f,a193f8c7 before application. No native mount wrapper, copy manifest, host mount ownership probe, or protected acceptance root is delivered. D189 same-uid rewrite limits remain. Source readiness requires exact-head green CI and Claude review. B5/1.2open,B6closed,D64unchanged,production capture disabled.

## D192 — 2026-10-17 01:10 EDT: owned journal mount and fail-closed disk cleanup

The D191 reader now has a fixture-only read-only ASIF mount wrapper. Both
capture locks are held; the capture-pinned commitment and stopped fixture
identity are checked before attach and after eject. The private Data mount
must report the pinned UUID, read-only/nodev/nosuid/noexec/ownership flags;
every read input must belong to that device and the returned checkpoint must
match the pinned commitment. Reverification and unchanged clone bytes/identity
precede atomic publication of JOURNAL_INPUTS.json listing actual reads.
Production entry still refuses before any mount or table read. No native
mount result is claimed; the CI-only characterization probe remains unwired.

Claude's first cleanup corrections still allowed a remembered disk number
to authorize one eject without inventory binding. Codex reproduced a normal
double-cleanup path: a phase's finally ejects its own disk, its primary error
skips settled(), and run's finally reuses the stale list. If another image
then takes that number, the second cleanup ejects it and reports clean. Both
wrapper and probe now treat remembered attach results only as absence checks.
An eject requires current image inventory binding; missing or unreadable
binding leaves cleanup uncertain, keeps the image/directory and refuses a
receipt. There is no force-unmount or remembered-number fallback. Sequential
inventory checks do not provide atomic exclusion against concurrent device
replacement, and the D189 same-uid provenance limitations remain.

The wrapper preserves its primary failure and records cleanup; a cleanup
interrupt stops further steps. The probe records handled cleanup interrupts
and removal errors, but an interrupt during directory removal or failure to
write the report can still lose that report. A missing report or nonzero
exit cannot clear the native mount gate. The older store extractor is not
converted to these primitives by this change. Its command bounds, ownership
and mount flags remain a separately tracked integration requirement.

Owned evidence: 71 native scripted tests pass (one Linux platform-guard
skip), 30 reader tests pass, all 46 reader mutations and three focused eject
rule mutations fail for their intended assertions with unmutated controls
passing. The three patches were checksum-verified; the third was explicitly
a candidate with its broader mutation run pending. Passing earlier 119
mutations did not cover the double-cleanup counterexample and is not proof
of the final probe. See B5_JOURNAL_MOUNT_SOURCE_EVIDENCE_20261017.json for
source/log hashes and exact boundaries. Final Claude review and exact-head
green CI remain required before source readiness. Native mount, serving-NATS
producer/adapter, protected B3/acceptance roots, planned-boot/abort, timer
migration and disposable macOS reboot rehearsal remain open. D64 is unchanged,
B5/1.2 remain open, B6 closed, four histories separate and production untouched.

## D193 — 2026-10-17 02:51 EDT: observe the owned kickstart client without changing recovery

Exact-head b694b342 CI 39005360286 has four green jobs but failed the
macOS owned loaded/stopped daemon restoration test again. The reader's
30 tests and mount wrapper's 71 tests (one platform skip) pass in that
job. D180 still classifies the ten-second kickstart timeout as undetermined;
the sampled owner was running, while the gate remained closed and the
receipt unresolved. Claude Message 85 found no material defect on exact
b694b342. Source readiness is still held by the red required check.

Add a test-only Popen observer for the exact temporary mesh-agent kickstart
argv, injected only into that owned test's restore child. It records the
client's nonblocking poll, elapsed communicate time, output lengths and
fixture timing/config context on timeout or completion, before preserving
the original return or exception. It never supplies recovery evidence or
changes admission. The command's ten-second timeout, one-second subsequent
observation and outer twenty-second fixture timeout stay unchanged. No
ThrottleInterval, launchctl flag, runtime module, installed plist, retry or
acceptance rule changes. Diagnostic writes are best effort; their latency
can affect the later observation, so a poll is explicitly after the timeout,
not proof of client state at the exact deadline.

Six owned subprocess controls distinguish a still-alive client from an
already-exited client with descendant-held output without a startup race;
output/result, non-target command and failed-report controls pass. Three
restored-rule mutants lose the mandatory observation, collapse exited into
alive, or swallow the timeout, and are killed for the intended assertions.
An exclusive-create mutant was not counted: the current POSIX subprocess.run
path waits after killing rather than calling communicate again, so that
control would not exercise replacement. Do not inflate mutation counts.

One native owned restoration case passes with a recorded 9.008 s kickstart
against the unchanged ten-second limit. Its bootstrap-request age before
SIGTERM was 0.301 s, stop wait 0.012 s and explicit ThrottleInterval absent.
The local Apple launchd.plist manual documents a default ten-second spawn
interval. This suggests a timing hypothesis but does not attribute the CI
timeouts or prove a throttle boundary; the original running-owner sample
cannot distinguish a blocked client from completed client/output lifetime.
B5_OWNED_KICKSTART_TRACE_20261017.json records these limits and hashes.

D192 claim clarification from the review: inventory binding is to the
clone's image path, not exclusive proof that this run created each attachment.
A same-uid concurrent attach of that same path can be ejected too. This
remains within the declared sequential/same-uid limits, not physical exclusion.
Final review and new exact-head CI govern this diagnostic revision; no blind
rerun, timeout widening or harmless-flake claim follows. Native ASIF facts,
protected provenance, serving-NATS producer/adapter, D62/D175 rehearsal and
manual abort/resumption remain open. B5/1.2 open, B6 closed, D64 unchanged,
four histories separate and all production services/VM/timers unchanged.


## D194 — 2026-10-17 04:45 EDT: native ASIF observations on an isolated CI runner

Exact 151bb3bdbcdf0bd09c7d15e6f0679832edae6a3d is green in all five
39011578564 jobs. Claude Message89 finds no material defect; Message85
reviewed the unchanged journal mount/probe implementation. This clears the
bounded B5-owned-journal-mount source gate, not B5 or stopped-ASIF extraction.
The existing owned-kickstart case completed at exit0 in9.026776584s against
the original10s deadline. That observation does not attribute earlier CI
failures. Claude's non-serializable diagnostic context counterexample is
unreachable through the current JSON-only caller; no unrelated hardening is
added here.

B5-native-ASIF-mount may now execute the already-reviewed CI-only probe in
its own GitHub-hosted macOS job. All guards remain: macOS, CI=true,
GITHUB_ACTIONS=true, opt-in, explicit flag, new output path and sudo-n. The
probe creates its own64MiB ASIF and private mount points; no local host or
production image is involved. The workflow always attempts to retain the
JSON report, with a missing report failing retention. The15-minute job bound
can interrupt cleanup and lose a report; neither timeout nor a missing or
partial report can establish cleanup or clear the gate.

Exit0 means completion and cleanup, not acceptance of any assumption. Read
the report for actual readonly/nodev/nosuid/noexec/ownership flags, exact
volume/inventory binding, the root-owned0600 unreadable negative, image
bytes/identity/ctime/xattrs before/after and confirmed removal. Any failed
assumption stays a refusal until a reviewed correction; no implementation
condition is relaxed to make the probe green. The D192 sequential inventory
and same-uid limits persist. This change only wires the probe and corrects
its unwired docstring. Claude review and exact-head CI govern these bytes.
After characterization, owned stopped-ASIF reader integration still needs
reviewed wiring, native positive/refusal evidence and exact-head CI. It is
separate from D62 macOS reboot rehearsal and the operator's machine/resource
decision. Production capture is disabled; B3/B4 were not repeated, B5/1.2
stay open, B6–B9 closed and all four histories separate.


## D195 — 2026-10-17 04:51 EDT: correct probe preparation from first native observations

The first isolated native probe ran at6ae7dd58 in39018637637/job117355795880
and refused with exit1. Its unchanged report is retained with hashes and
artifact identity in B5_NATIVE_ASIF_SETUP_20261017.json. It never reached a
read-only variant. After enableOwnership succeeded, file preparation raised
PermissionError13; a root-owned volume root is the source-consistent inference,
not a traceback-proven cause. Actual diskutil attach returns bare disk7 and
disk8s1, while its DeviceNode and hdiutil inventory name /dev/disk8s1 and
/dev/disk7. Inventory-bound unmount/eject succeeded and the probe directory was
removed, but its empty remembered-disk list makes disks_gone[] vacuous.

Correct the CI-only probe's own newly-created volume root to runner ownership
after enabling owners, preserving the root-owned0600 file negative. Harvest
both strict whole-disk spellings into canonical absence checks; these never
authorize eject. Select Data's canonical DeviceNode only when its strict
partition node exactly matches the raw attach identifier, and preserve raw
attach rows. Keep each variant's partial observations/cleanup in the parent
report before calling the variant, so a later refusal cannot discard them.
The journal wrapper is unchanged and still refuses native bare attach rows;
normalizing or relaxing it requires the complete report and separate review.
No native flags, byte-identity condition, privilege check or acceptance rule
is weakened. No unchanged blind rerun.

75 scripted tests pass (one Linux-platform guard skip on macOS), including
nine focused controls; four one-rule mutants fail for their intended reasons
(bare-disk harvest, mismatched volume, missing fixture-root ownership and lost
partial evidence). Source/log hashes are recorded. Publication is for new
native CI and exact-head review, not source readiness or B5 closure. No local
disk image or VM operation took place. B5/1.2 open, B6–B9 closed, D64 unchanged,
four histories separate. Disposable-macOS reboot access remains independent.


## D196 — 2026-10-17 04:56 EDT: bound native mount observations; keep device binding refused

The corrected CI-only probe at6f7e9371 completed in39018959320/job117356737655,
artifact12096186192, on one macOS26.6.2 arm64 runner. Its unchanged report
and interpretation are B5_NATIVE_ASIF_COMPLETE_REPORT_20261017.json and
B5_NATIVE_ASIF_OBSERVATIONS_20261017.json. The exact option variants honor
owners, deny a root-owned0600 read to the runner and enforce readonly,
nodev/nosuid/noexec, including after ownership was disabled before reattach.
Plain readonly correctly refuses missing noexec. Every readonly cycle kept
image bytes and recorded identity/times/flags/empty xattr names unchanged.
Do not extend this to the intervening writable phases, arbitrary xattrs,
other systems, reboot, production or real histories. Every phase confirmed
nonvacuous remembered-disk absence after inventory-bound eject; final cleanup
removed the private directory. Sequential inventory observations do not give
concurrent physical exclusion.

B5-native-device-binding remains a Codex-owned source blocker, not an
operator permission request. The report's raw diskutil entries are bare
(disk7/disk8s1); hdiutil and DeviceNode use /dev paths. The unchanged wrapper
requires exact raw attach/inventory equality and refuses before mount. A
separate replay with all commands mocked confirms data_volume returns bare
disk8s1 and verify_mount refuses its source name. The probe's canonical call
passing is not end-to-end journal wrapper acceptance. Next correct that
strict binding without accepting different disks, partitions or paths, test
mismatch/cleanup negatives, obtain Claude review and exact-head CI, and then
run a native owned stopped-ASIF reader fixture. No wrapper condition changes
in this evidence-only revision. Current-head full CI/review are still pending;
no source-readiness claim. D62 reboot/hold-reattach and D175 timer migration
remain distinct, including the separate macOS access decision. B5/1.2 open,
B6–B9 closed, D64 unchanged and production capture disabled.


## D197 — 2026-10-17 06:48 EDT: strict native device binding with mandatory whole-disk observations

Exact611127b9 passes all6 CI jobs39019163444. Claude Message96 finds no
material defect and confirms the saved native facts, while identifying
unharvestable-success and root-owner fixture-shape limits. The source-only
151bb3bd milestone remains valid as scripted evidence; its inventory row
now points to the native refusal instead of implying native acceptance.

Use one shared parser/harvester in host_journal_mount.py for both wrapper
and probe. Whole disks accept only bare diskN or canonical /dev/diskN;
partitions require sN components. A successful attach must yield exactly
one valid whole-disk observation. Harvest before status checking to retain
an applied failure's known disk, but never let known disks authorize eject.
The wrapper compares the canonical whole disk to its image's canonical
inventory node, then requires a canonical Data DeviceNode whose exact raw
partition is either that node or its bare spelling. Different disk numbers,
whole disks offered as volumes, malformed paths and non-/dev DeviceNode
values refuse. Preserve raw attach entities and raw inventory disk in the
receipt. No mount flag, image hash/ctime or cleanup condition is weakened.

The probe uses the same binding and refuses unharvestable success even
when otherwise valid Data observations exist. After seeding only its own
new volume, restore its volume root to0:0 and report root metadata per
variant; this strengthens the native positive beyond a runner-owned root.
It does not prove guest/host uid parity, a never-registered UUID, sibling
volumes, dirty APFS, pre-existing xattrs, concurrent attachments or reboot.
F3 error-filename/timestamp suggestions remain tracked follow-ups; no unrelated
reporting expansion. D196's previously uncommitted replay is replaced by a
committed test using the exact raw native JSON with all commands mocked.

80 scripted tests pass with one platform guard skip;18 focused controls
pass after a final root-owner assertion tightening. Seven intended-assertion
mutants fail; source, log and runner hashes are recorded. This revision is
for new native CI and Claude exact-head review, not source readiness or B5
closure. Next integrated stopped-ASIF journal verification is separate.
D62/D175, serving-NATS adapter, protected provenance and abort/manual resumption
remain open. B3/B4 not repeated; B5/1.2 open, B6–B9 closed, D64 unchanged,
production capture disabled and all four histories separate.


## D198 — 2026-10-17 06:51 EDT: native shared bindings under a root-owned root

The b1119e78 native job39026337387/117377947876 completed at exit0 and
retained artifact12097953565. B5_NATIVE_DEVICE_BINDING_REPORT_20261017.json
and its RUNTIME JSON preserve the raw report, SHA256 and interpretation.
The probe now exercises the same whole-disk and Data binding helpers as
the wrapper on actual bare diskutil entries and canonical nodes. In all3
variants its root is0:0/0755. Both exact-option cases honor ownership and
deny root0600 reads; plain readonly refuses noexec. Every readonly cycle
keeps all recorded image bytes/identity/times/flags/empty xattr names equal,
and every phase independently confirms known-disk absence and cleanup.
The final known list is empty after settled(), not a second independent
absence proof. Observations remain sequential, not physical exclusion.

This removes the runner-owned-root limitation of the earlier native positive,
not the remaining fixture-shape limits: fresh host-written single-volume ASIF,
uid501 both sides, no pre-existing xattrs or dirty/sibling guest volumes.
It does not execute the complete wrapper/locked journal reader or prove a
stopped VM's actual history. All-six current-head CI and Claude review remain
pending; no source-readiness or gate-closure claim. The next independent
verification is owned stopped-ASIF journal reader integration after this
source's review/CI. D62/D175 reboot/abort/manual resumption, protected roots
and serving-NATS recovery remain open; production capture stays disabled,
B6–B9 closed and all four histories separate.


## D199 — 2026-10-17 08:55 EDT: measure the still-alive kickstart client before a remedy

Exact6912b7e7 is5green/1red in39026495833/job117378396060. The80 mount
controls pass. The recurring owned stopped-daemon test now samples its
launchctl client alive after10.004358542s; bootstrap-request age before stop
was.285780875s and stopped wait.009570166s. This excludes an already-exited
client at that sample for this occurrence, not at the exact deadline, and
does not establish throttle causality. The unchanged recovery response is
partial, gate closed, receipt unresolved. Claude Message100 finds no material
defect in the binding source/native evidence; exact-head red CI still holds
source readiness. T1 root-uid test ambiguity and T2 the untested wrapper
harvest-before-status rule are recorded as separate owned-test carry-forwards.

Consume Claude's checked7d3e90a4 candidate (SHA25677838cc9…7871b64) as design
input, not native-ready code. One adapted CI-only probe measures seven fresh
owned launchd targets across requested runtime and ThrottleInterval arms.
It retains post-timeout poll elapsed time and a bounded later return, plus
job-written first/second instruction wall times and launchd observations.
Controller elapsed time is monotonic; job wall-time deltas may reflect clock
changes and are not kernel spawn/exit timestamps. A separate idle runner's
observations constrain hypotheses; they do not alone attribute the prior
full-suite failure or authorize a runtime policy change.

Before wiring, correct own-client interrupt kill/reap and pipe cleanup,
primary-error retention, numeric stale-PID signals (use exact fresh target),
ignored target/domain observation failures and removal-before-cleanup. Require
a second running job record and a verified trial bootout before another arm.
Retain partial trial rows, preserve files after any failed trial or uncertain
cleanup, and always attempt exclusive report upload. Cleanup is sequential,
not physical exclusion or a guarantee against late starts. A job timeout,
interrupt during directory removal or report-write failure can lose the
report; missing/nonzero reports never pass the gate. The original recovery
10s action/1s observation/20s parent limits, fixture settings and runtime
acceptance are unchanged. No live service, VM, production disk or timer is
involved.19 pure/mock controls pass; the dedicated job also executes the real
returned/alive/exited-pipe-held self-test before native measurement. New
native evidence and Claude/exact-head review/CI remain pending. B5/1.2 open,
B6–B9 closed, D64 unchanged, production capture disabled, histories separate.


D199 prepublication design refinement after Claude Message102: seven arms
include default-throttle/R.3 with a deliberate1s request delay. A single
stopped snapshot, poll latency, load average and control-print elapsed time
avoid the original double-observation ambiguity. Three-origin predictions
and residuals are illustrative: the recorded time is a Python instruction,
not kernel spawn; wall clock and startup bias remain, and throttle0 may be
interpreted specially. Signal-by-label differs from the fixture's os.kill;
do not infer exact transfer. Probe-only extra/second-start/log waits are
15/10/10s; target prints5s, logs once after trials. The isolated job is30min
after conservative summed command/wait/cleanup accounting with margin;
interpreter startup and report I/O are not universally bounded. Timeout or
lost report still refuses. No production timeout changes. A clean-exit arm
or lighter recorder is not included, so signal-specific accounting and
subsecond startup bias are not resolved by this experiment.


## D200 — 2026-10-17 09:04 EDT: native timing shape supports an owned-fixture remedy review

The corrected seven-arm probe at1695ce92 completed at exit0 in39034737877,
job117402189372, artifact12101407361. Its exact report SHA2560659ef76…f6bc3f4
and interpretation are B5_KICKSTART_TIMING_REPORT_20261017.json and OBSERVATIONS
JSON. All7 first/second instruction records and final bootouts exist, each
trial observed its label absent, and final per-target plus readable GUI-domain
observations show none left; private files were removed. These are sequential
owned-label observations, not physical-process exclusion or a live-node test.

The short default-throttle case samples its client alive after10.007s then
observes success at10.016s. DefaultR3/R12 blocks7.017s/.006s; delayed request
by1s reduces short-default block to9.011s. ExplicitThrottle1 short/R3 blocks
1.016s/.010s;Throttle0 short blocks1.007s. Taken together these support a
prior-runtime/throttle-related wait and reproduce the budget-collision shape
on this runner. They do not establish an exact timer-origin, rounding/minimum
rule or the cause of the earlier full-suite failure. Python-instruction time
is not kernel spawn; exits are observed, clocks/startup can bias residuals,
and signal-by-label differs from the fixture's os.kill. Load averages24–43
correct D199's idle-runner wording: the runner was separate, not known idle.
No clean-exit arm or repetition distribution was measured.

Review an owned temporary-fixture remedy using this evidence before changing
any fixture policy; do not widen runtime10s/1s/20s budgets or claim a harmless
flake. No remedy is applied by this evidence-only decision. Current source/
evidence still needs Claude and all exact-head checks green; the native
reader integration stays downstream. T1/T2 remain tracked. Production capture
is disabled, B5/1.2 open, B6–B9 closed, D64 unchanged, histories separate.


## D201 — 2026-10-17 09:11 EDT: retain the source review and independent timing report
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


## D202 — 2026-10-17 10:46 EDT: explicit throttle only for the owned restore fixture

Exact0d329038 CI39035568789 is6green/1red. Its owned stopped-daemon test
again samples an alive client after10.011953291s (bootstrap request age
.366293083s, stopped wait.013771875s). Recovery records partial/closed/
unresolved even though the subsequent process observation is running.
Do not rerun unchanged code or widen the10s action/1s inspection/20s parent.
Claude Message106 independently re-derived D200's report and accepted its
bounded interpretation and cleanup order. The reviewer's whole-second-credit
model is a fit to one loaded runner, not a launchd rule or proof of earlier
failures. D201 supplies a second independent report with the same broad shape.

B5-owned-kickstart-fixture will set ThrottleInterval=1 on the temporary
mesh-agent job only, in both native and simulated owned fixtures, and require
that same exact integer value in OwnedLaunchdAdapter's expected configuration.
The timer policy and exact-dictionary refusal stay intact. This adapter is
restricted to the owned temporary root; no production plist or runtime action
budget changes. Add portable real-file identity controls with a freshly
rebound baseline so a generic hash mismatch cannot mask a missing exact
configuration check. Wrong/missing throttle and extra fields must refuse
before any launchd service observation/action. Kill a removed equality guard
mutant for its intended assertion. Existing applied-timeout durable refusal,
closed gate/unresolved receipt and retry-without-second-kickstart controls
must still pass; the native loaded/stopped test must return resolved with a
trace confirming the explicit1 setting under unchanged budgets.

The fixture no longer represents production's default throttle. Production
or other default-throttle jobs may still collide with the10s action budget;
the safe response remains partial/closed, and this test-only remedy cannot
clear that runtime policy question or D62/B5 resumption. Track it explicitly.
Source readiness needs Claude exact-head review and all CI green. Native
stopped-ASIF reader integration follows; D62 disposable-macOS access remains
separately operator-gated. B3/B4 not repeated, B5/1.2 open, B6–B9 closed,
D64 unchanged, capture disabled and all four histories separate.


## D203 — 2026-10-17 11:17 EDT: verify the owned fixture without certifying production defaults
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


## D204 — 2026-10-17 13:12 EDT: complete owned frozen-journal reader integration

The next B5 slice extends the existing CI-only ASIF probe with --ci-owned-reader.
All existing platform/CI/explicit-flag/new-output/sudo guards still precede disk commands.
The fresh volume UUID is bound before the synthetic journal manifest, host commitment and
checkpoint are produced by the existing StoppedImage fixture; its Journal, capture_ready,
commit/commit_checkpoint and CAPTURE pin publication are real, but its hold/stop/VM
observations are synthetic. Fixture patches are removed before native reading. No actual
VM or NATS server is involved, and runner UID ownership is not guest UID parity evidence.

Each case seeds the owned image while writable, restores its root to0:0/0755, detaches,
then publishes its own clone hash/size before the complete unmodified read_journal_inputs
lock/mount/reader/frozen-verifier path. Intact must verify matching heads; corrupt-chain,
pending, unknown-entry and changed-config cases must refuse at read for their named
reasons without a success receipt. Each readonly cycle checks image hash/size/inode/times/
flags/xattr names unchanged, host commitment pins unchanged and nonvacuous attached-disk
absence in cleanup. The outer probe removes only its own directory after inventory-bound
cleanup. Reseeding and clone republishing are deliberate fixture mutations outside that
readonly interval; this is not capture authenticity or physical writer proof.

Portable controls exercise the case oracle through the scripted complete wrapper, catch
a bypassed frozen verifier on changed config, reject unrelated refusals and vacuous disk
absence, and verify UUID-bound seeding/unlocked copied host locks with no lingering fixture
patches. The first run caught invalid hyphenated output suffixes; the fixture now uses the
wrapper's existing alphanumeric suffix form, with no runtime relaxation. Native evidence,
Claude review and exact-head green CI remain pending until their separate receipts.
B5/1.2 remain open, B6–B9 closed, D64 unchanged and production capture disabled.
B3/B4 were not repeated; all four histories remain separate. No local UTM, production
image/service or installed timer was operated. D62/D175 admission/abort/manual restoration
follows; actual macOS reboot rehearsal still needs the operator's separately designated
disposable machine or approved measured resource decision.

Local D204 verification: all85 mount/probe tests pass (one Linux-platform-only guard skip
on macOS), including the new portable controls. Python AST/workflow YAML parse and plan
lint14PASS/1existingWARN/0FAIL pass. Native reader and Claude/exact-head CI remain pending.

D204 portable correction: guard() binds sys.platform at import as its default argument.
The new dispatch test initially patched sys.platform, which works on this macOS host
but cannot change a Linux-bound default. Its test seam now calls the unchanged guard
with explicit darwin while retaining every other guard. A focused run with the function
default forced to linux passes. No probe/reader/runtime or native observed bytes change.

D204 review follow-up: Claude's in-progress Message114 found that the outer reader_run
image/pin/head oracles were not exercised portably, despite the native positive. Add
ReaderRun controls for all cases and publication values, changed image identity, changed
pins, each verified head, partial seed failure, unclean cleanup, failed removal and primary/
cleanup interrupt precedence. All15 selected reader/seed/guard controls pass (one platform
skip); removing each of the image, pin and head guards is killed by its intended0!=1
assertion. No native probe or runtime bytes changed. Full suite now contains90 cases;
its current-head CI and Claude's completed review remain pending.

Retained B5_OWNED_STOPPED_ASIF_READER_REPORT_20261017.json is byte-identical to
stopped-asif-reader.json in artifact12108516653, merge78acafdf3885ee9dea1398a26c42cdcebd1762d8,
source6286b89c44100ad8be2103bb3f049e939dbe8185, run39052908309/job117454954721.
SHA256 bfc984f22b78898bdeab3e21ad15811ef8e68ad6932f097444b9b814173a3b3c.
The isolated native job passed both ownership and complete-reader steps. Intact read verified
54 files on one readonly device; four named read-stage Refused results have no success
receipt. All5 per-read image states match and known disks are absent after seed/read; final
outer inventory/mounts empty and owned directory removed. Synthetic receipt/hold/VM claims
remain bounded as above; this evidence cannot close D62, D175, B8 or production acceptance.

D204 completed Claude Message114: no material reader-mode source defect and the6286
portable seam is correct; R1 requires outer-loop negative coverage before closure. The
new ReaderRun controls address R1, now including a second-case failure with the earlier
completed row retained. R2 recommends keeping a failed owned image for diagnosis: the
reader loop now removes only after completed plus clean, records its retained directory
otherwise, and CI uploads only the failed CI-owned powered-off-image.asif as a diagnostic
artifact. The older ownership-probe run() behavior is unchanged. This does not authorize
reading, capturing or modifying any production image. A diagnostic failed fixture is not
accepted recovery evidence.

Local91 mount/probe tests pass in36.307s (one platform skip). The committed
mutate_stopped_asif_reader.py runner kills removal of image identity, commitment pins,
verified heads and failed-image-retention guards at their intended assertions; its
unmutated6-test ReaderRun control passes. CI runs it before native disk operations.
Python AST/workflow YAML parse and diff checks pass. Full current-head CI and Claude
review of this correction remain pending. The earlier raw native report stays bound to
its actual6286 source; it is not relabelled as evidence of this retention revision.


## D205 — 2026-10-17 14:01 EDT: verify the owned native frozen-journal reader

B5-owned-stopped-ASIF-reader is verified at e120e78de80ab635a7c8750dac7ef0b10b871309.
Claude Message116 independently closes R1/R2 with no material defect:91 tests pass as a
non-root user, the6-control mutation baseline and all4 committed image/pin/head/retention
mutants pass their intended verdicts; its additional report-write and retention mutants
are killed too. Exact source CI39053730664 has all8 checks green. This is the
source whose complete native reader and mutation job117457344212 passed; merge
2ff7d39f2d4d9af13017f7dd85f439c8c143d402, artifact12108338805. Superseded
cf347343/6286b89c/b2155b3c full workflows were canceled after their completed native
observations were retained; none is relabelled as all-green.

B5_OWNED_STOPPED_ASIF_READER_REVIEWED_REPORT_20261017.json is the raw stopped-asif-reader.json
from that reviewed-source artifact, SHA256 e02ab65672edc4019ace4b9c1c24b7bedd5b9df2ed2790eaa35306fff126e01d.
The intact readonly wrapper read54 owned journal/config/lock/receipt files from one
verified APFS device, matched the pinned checkpoint and pre-head and published its receipt.
Corrupt-chain, pending, unknown-entry and changed-config each raise their intended Refused
at stage read without a success receipt. All5 readonly intervals preserve image hash,
inode, size, mtime, ctime, flags and xattr names; seed and reader cleanup each explicitly
confirm the known attached disk absent. Seed roots are0:0/0755; final inventory/mounts empty
and owned directory removed. Full macOS job117457344183 also completes the91-case module;
its full job log SHA256 is 0c378efeb0d659f68ab40f6c21f1d5658295c86d8cecb6853c92b1bd6d15ef88.

The failed-image upload step is skipped in this successful native run. Its retention
condition/report and interrupted/partial failures are exercised by scripted controls and
mutation, not an intentionally failed native ASIF upload. This is a synthetic checkpoint
fixture with synthetic host power/hold/stop observations and runner UID501, no VM or NATS
server, no guest UID parity or capture authenticity proof. Reseeding/clone re-publication
occurs outside each readonly interval. Journal evidence remains user-owned quiescence;
there is no physical exclusion claim between last NATS stop and manifest. This does not
prove B8 restorability of real histories or authorship/historical independence.

Next two execution forecasts: B5-D62-admission uses B1-authorized source/owned fixtures
to bind a durable ACCEPTED-after-B8 or ABORT-after-host-cleanup decision before any gate
opens, compare the complete required OpenClaw launchd/process scope before Journal.recover,
then verify stopped units/overrides and a fail-closed manual route. It needs the existing
host guard/commitment and recorded hold, a reviewed admission design, decisive negatives,
Claude and exact-head CI. B5-D175-owned-repin follows only after that admission exists;
it needs five owned timer definitions/manifest plus stable volume/lock/path identities,
conditional journaled value-only device re-pin before postboot gate construction, strict
non-timer/extra-field/changed-inode-birthtime-nonce/premature/repeated negatives and owned
APFS detach/reattach evidence, Claude and exact-head CI. These source forecasts do not
close the separate disposable-macOS reboot/launchd/login/process/hold-reattach rehearsal.
The operator still designates an exact disposable machine or decides a measured disk/RAM
budget and capacity source after Codex's proposal; no provisioning permission is inferred.

B1 design-only and historical B2/B4 mechanism/design evidence remain bounded; B3 remains
JIT and was not recaptured. Serving-NATS producer/adapter, protected host provenance,
D62/abort/manual resumption, D175 and actual macOS rehearsal remain open. B5/step1.2 stay
open at v1.2-pre; B6–B9 closed, D64 unchanged and production capture refused. The four
physical histories remain separate. No production service, VM, image or installed timer
was operated. This receipt changes no executable/workflow; later heads need their own CI.

D205 forecast precision: D62 retains host boot denial until the durable decision and
binds it before any guest gate reopens. The pre-recover comparison covers all OpenClaw
launchd jobs and every process as its user or executing from production entrypoint roots;
unexpected/unreadable observations refuse, and this is not a complete physical census.
D175 changes values only if the device changed, after admission and before gate
construction, preserving same-boot descriptor/path mapping checks. These are the existing
D62/D174/D175 constraints, not new production authorization.

## D206 — 2026-10-17 14:50 EDT: fence premature production image release

Source tracing D62's next admission gate found an earlier release boundary that must be
closed first. `host_vm_reconcile.reconcile()` refuses a completed CAPTURE, but its
incomplete-capture path can remove the clone, clear the source image's immutable flag and
publish BOOTABLE without an ACCEPTED or ABORT decision. Its BOOTABLE scope explicitly
claims no acceptance; it is still a boot-denial release. Production capture is already
disabled, so this is a latent tool path, not evidence that a production image was released.

The independently executable prerequisite is B5-D62-release-fence. Reconciliation now
refuses non-fixture invocation before umask, path/directory/output work, locks, preflight
or flag changes. The existing fixture-only path keeps its owned parent, exact fixture VM
UUID and package-parent checks and its existing native cleanup mechanism. This adds no
decision producer, host guard release authority, boot operation or guest admission. D64
and production capture refusal are unchanged. No new controller or parallel restore path
is introduced. `change_immutable` remains a low-level operation, not a boot authority;
direct manual flag changes are outside this command's guarantee.

Four portable tests cover entry-first refusal, an otherwise viable incomplete capture,
the unchanged successful fixture route and three fixture-boundary negatives. The viable
case uses real private receipt/lock files but scripted VM samples, attachment observations
and source flags; no native disk/VM operation. Against the old source both production
assertions fail, with both owned controls passing. The candidate passes all4; deleting
the entry refusal kills both production assertions with no runner errors and the owned
controls still passing. All15 portable capture/guard controls pass. The new class is
registered in Linux CI and runs with the existing full reconcile suite in macOS CI.
Claude review and this source's exact-head green CI remain required before closing it.

The next gates are reviewed host terminal-decision/cleanup production and then guest
scoped boot admission/manual restoration; the separate D175 timer re-pin follows admitted
boot and precedes gate construction. A JSON enum or legacy acceptance.json cannot supply
B8 acceptance or protected provenance. Existing host arm/commitment/checkpoint/capture
bindings must be consumed, boot denial retained through a durable ACCEPTED-after-B8 or
ABORT-after-host-cleanup decision, and the guest must bind it before opening any gate.
The full launchd/process comparison and stopped-unit/override checks precede recover.
Actual macOS reboot rehearsal still needs the operator-designated disposable machine or
an approved measured disk/RAM budget and capacity source; this source work needs neither.
B3/B4 were not repeated. B1 stays design-only; B5/1.2 remain open at v1.2-pre, B6–B9
closed, all four histories separate. No production service, VM, image or timer was operated.


## D207 — 2026-10-17 15:16 EDT: verify the D62 release fence; keep decision design open

Runtime source e6543580facd56e2bef11bfbf94f3c5dd7bb068f passes all8 checks in CI39059651789,
including full native macOS job117474802932. Its log invokes the complete
reconcile module and records all7 tests passing; Linux job117474803164 runs all4
portable fence controls successfully. Native log SHA256 a259f0ffa9b7a984c7f3e164f71e869f5a3efa2e3036f88a4e879c97d15f0401.
Claude Message122 independently checks the exact two-line runtime delta, all callers,
CLI/default fixture dispatch and CI registration, runs the controls,
and kills removal of the fence with exactly the two production assertion failures and
both owned controls passing. Its Linux capture-gate run has14 passes and1 platform
skip; Codex's local macOS run has15 passes. This corrects D206's overly broad portable
wording without changing the runtime result. B5-D62-release-fence is verified only as
this source refusal boundary; no decision controller or cross-boot admission is supplied.

One test-only isolation refinement accompanies this receipt. Recursive mkdir assigned
only the leaf's private mode, so a standalone counterexample under umask022 could fail
at an intermediate directory check instead of reaching the old source release. The
fixture now creates/chmods every component under its own temporary root to0700. Each
of the4 controls passes independently with a fresh umask022; the deleted-fence mutant
still fails each production assertion for its intended reason (viable case: no refusal
raised), with both owned controls passing and no setup/runner errors. Runtime and
workflow bytes are unchanged from the reviewed green source above. Every later head
still needs exact-head green CI before source readiness; no production readiness follows.

Claude120's future decision design was challenged and is not an implementation contract.
Message124 corrected the terminal order; Message126 accepts the further limits: a
nonterminal cleanup intent, checked host cleanup while guarded, then durable terminal
ABORT, then a separately checked release. Two sampled immutable flags do not prove
continuity against D189's same-user actor. Strict host boot/device/image bindings remain;
there is no automatic host-reboot exception or reuse of D175's guest timer migration.
Absent checkpoint, interrupted guard or missing active denial cannot become automatic
BOOTABLE or guest admission. Those cases stay held for an explicitly reviewed manual
route. Receipt schemas, partial-publication/retry policy, host/guest bindings and the
manual route remain open design. ACCEPTED needs a real B8 acceptance producer;
MATCH.json and owned probe acceptance.json cannot stand in for it.

Next two execution forecasts: B5-D62-abort-cleanup design/source needs existing arm,
commitment/checkpoint/capture and guard bindings, the corrected order, decisive crash/
retry and refusal controls, Claude and exact-head CI, using B1-authorized owned resources
only. B5-D62-guest-admission/manual route then needs that decision binding, all required
OpenClaw launchd jobs and user/entrypoint-root processes compared before Journal.recover,
unreadable/unexpected observations refused, then stopped units and persistent overrides.
That scope is not a complete physical census. D175 follows admission and precedes gate
construction, with its separate owned APFS and actual disposable-macOS reboot tests.
No VM access is needed for the source work; actual reboot rehearsal still needs the
operator-designated disposable machine or approved measured disk/RAM/capacity proposal.

B1 remains design-only, B2/B4 bounded historical mechanism/design inputs, B3 JIT and not
recaptured. B5/1.2 stay open at v1.2-pre, B6–B9 closed, production capture disabled and
D64 unchanged. No production VM/service/image/timer was operated; all four histories
remain separate. This source refusal does not establish pre-stop physical exclusion,
real-history restoration/acceptance, timer resumption or node operational status.


## D208 — 2026-10-17 15:52 EDT: owned clone cleanup before any terminal abort decision

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


## D209 — 2026-10-17 16:32 EDT: verify nonterminal owned clone cleanup while denial remains applied

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


## D210 — 2026-10-17 17:18 EDT: owned terminal ABORT after completed clone cleanup

B5-D62-host-terminal-abort extends the existing disposal module, not a parallel
controller. Entry-first production fences and the positive fixture boundary remain.
Both exclusive locks and the capture directory descriptor bind the original arm,
commitment, ACK, checkpoint, capture, guard and host-spec bytes to successful D209
cleanup. Exact exported schemas and canonical bytes refuse extra fields, malformed
receipts and partial/failed attempts. Original host boot/device/VM/image bindings
remain strict; a source metadata touch or host reboot is manual, without an exception.

Claude148's six corrections are incorporated: the native preflight write-set supplies
the sample allow-list; only the matching root ABORT is permitted after publication;
the cleanup's three sample trees are forward-pinned; the verifier takes the caller's
locked descriptors and fresh observed sample without locking, writing or observing
on its own; exported record key sets and explicit arm SHA bind the decision. The
preflight module changes only by adding its filename constant, checked against its
actual writer names. Native logs/status/plist/helper-cleanup files are allowed; FAILED,
temporary or unknown entries refuse. An unsuccessful helper cleanup refuses.

The producer samples before, validates cleanup, atomically publishes ABORT.json,
samples after and rechecks unchanged evidence, then atomically publishes a minimal
abort-decision/COMPLETE.json bound to ABORT bytes and the after sample. Claude150
accepts this completion ordering. ABORT alone is insufficient: missing COMPLETE,
FAILED (even beside complete visible records), temporary or unknown evidence refuses.
Any failure/interrupt retains its primary error, keeps source denial and the single-use
attempt for manual handling. A later consumer must itself establish durability under
its locks before any separately checked release; no receipt proves that an earlier
process returned after fsync. All denial observations are samples, not continuity.

The read-only core verifier returns only evidence bytes/hashes under caller-held locks;
the optional command wrapper obtains a new diagnostic sample. Neither grants source
release, guest admission or boot. The terminal producer changes no flags and starts
nothing. MATCH/JOURNAL_INPUTS and byte-only VERIFY do not become ACCEPTED; a real B8
producer and protected provenance remain open. D189's same-user coordinated-rewrite
limits remain; there is no physical exclusion or authorship claim from these files.

Local owned terminal suite:27 tests pass94.927s, including real checkpoint/commit/ACK/
cleanup producers and scripted host/flag controls. The initial22-test run had two test
assertion failures because its deliberately planted conflicting ACCEPTED/BOOTABLE files
were counted as newly produced files; the assertion now preserves that known baseline.
No runtime refusal was relaxed. Mutants, bounded regressions, exact-head Claude and CI
remain in progress; no source readiness or gate closure yet. A broader local regression
invocation was interrupted in a regular-file cleanup fixture before its native image
class could execute; the replacement explicitly selects the scripted VmstateGateTest.
No local image, VM, UTM, production service or installed timer was operated.

B1 remains source/owned only. B2 Alpine and B4 remain bounded historical mechanism/design
inputs; B3 remains JIT and neither B3 nor B4 was repeated. B5/1.2 open at v1.2-pre,
B6 has no attended-window authorization, B7–B9 held. D64 and production capture/reconcile
refusals are unchanged; four histories remain separate. Next two source gates are a
separately checked owned source release consuming this decision under locks, then guest
decision binding/scoped launchd/process admission and manual restoration before D175.
Each requires decisive owned controls, Claude and exact-head CI. Actual macOS reboot
still needs exact operator-designated disposable access or a measured fixed disk/RAM/
capacity decision; this source slice needs no new VM or production authorization.

D210 local follow-up: committed mutant runner controls pass and all12 mutants are killed
by their intended assertions with no runner errors. Plan lint14PASS/1existingWARN/0FAIL.
The bounded regression and exact-head review/CI remain pending; no readiness claim.


2026-10-17 17:30 EDT — D210 append-only correction, candidate still not ready:
Codex and Claude154 reproduce the verifier's missing/extra-lock gap at a15e9093:
empty, one and three descriptors bypassed the two-name zip; duplicate descriptors
already refused through mapping. Exactly two distinct descriptors are now required
both at verifier entry and in shared abort_pins. The descriptor identities prove the
opened names, not flock ownership; core callers must hold both EX locks. The producer
and CLI wrapper acquire them. No lock-continuity or protected-origin proof is claimed.
The focused counterexample fails before the correction and passes after it; its
removal mutant fails for the intended missing-refusal assertion.

Claude154 also identifies an unverified native log-mode assumption. No existing native
sample logs were retained in the bounded owned-temp search, so no old native mode was
observed or reproduced. Instead of relaxing the reader, the shared preflight writer
now exclusively creates both stdout/stderr files with O_NOFOLLOW and fchmod0600 before
plist creation/bootstrap. A collision, including a symlink, refuses before any agent
operation. This supersedes D210's filename-constant-only delta: capture, guard, reconcile
and cleanup share this writer. Claude156 accepts the fix. Fifteen fake-launchctl controls
pass14.400s; two new cases check real private files before bootstrap, append-open under
umask022 and collision/symlink refusal. The removal mutant fails at the intended assertion.
The existing CI-only native capture fixture now passes its real before-shutdown and
after-guard sample trees through sample_files and checks both log modes. That native
assertion is still pending; parity alone proves names, not native mode ingestion.
No local native image or launchd run was added.

The verifier takes no new VM preflight sample itself; it does readonly attachment
observations, source metadata and full-byte hashing. The earlier unqualified “without
observing” wording is superseded. The cleanup reason is forwarded, with no separate
operator statement. A hypothetical positive helper-cleanup record remains conservatively
validated, but the current writer creates that file only on unsuccessful cleanup and
then refuses; it is not a native success-path claim. The verification wrapper reserves
both fixed attempt directory names, so it cannot pre-empt a future abort attempt.

Current local proof:29terminal controls pass78.869s; designated controls pass and all14
mutants die on their intended assertions, no runner errors. The prior145 bounded
regressions pass98.633s with one expected skip, and all12 previous cleanup mutants pass
their controls and die as intended. These are source/owned proofs, not native terminal
pipeline, actual reboot, source release or guest admission. New exact-head Claude/CI,
including the native private-file assertion, remain required. B5/1.2 open, B6–B9 held;
D64/production refusals unchanged, B3/B4 not repeated, four histories separate.


## D211 — 2026-10-17 17:58 EDT: verify the owned terminal ABORT source checkpoint

Runtime source 00264a3c461076b175c04847727096d072ee8e58 passes exact CI39071272275, all8 checks success.
Native macOS job117509228208 passes the complete16-test capture module, including the
real before-shutdown and after-guard sample ingestion and private-log assertions;
the29 terminal controls,15 helper-status controls and all14 intended mutants also pass.
The terminal controls still use scripted VM/flag samples. Native raw job-log SHA256
4ebd019ed8bdc493bad382baf8386c5185ccd8864a3634f0c2afe9e38ec1638c.
CI checkout merge de6a66eb1e9eb35ccbbe6deb58231fa5ba0d1e90 has identical step12/workflow blobs to
that source, checked against the fetched commit. Linux Node22 completes the full
JetStream and root steps successfully; its terminal suite has29 passes and its runner
kills all14 intended mutants. The superseded a15e run39070356368 is cancelled, not green.

Claude158 independently reproduces29terminal/15status controls and all14 intended
mutants as uid65534, plus the earlier cleanup/mount/capture/reconcile regressions,
and finds no required source or claim defect. It confirms the two-descriptor check in
both shared pins and verifier, explicit pre-created0600 logs, failure-before-bootstrap
collisions, reserved directory names and the corrected D210 limits. Its review leaves
native ingestion to this CI observation and does not claim a native terminal pipeline.

B5-D62-host-terminal-abort closes only this owned source prerequisite. ABORT plus its
completion record remains user-owned sampled evidence, not protected provenance,
continuous denial, source release, guest admission, boot authority, real-history
acceptance or operational recovery. The caller supplies a fresh observed VM sample and
must own both EX flocks; file identities alone do not prove lock ownership. The cleanup
reason is forwarded without a separate operator statement. Complete native cleanup-
then-terminal behavior and macOS guest reboot remain unproved. This evidence receipt
changes no runtime/workflow bytes and still needs its own exact-head green CI before
source readiness. B5/1.2 remain open at v1.2-pre, B6–B9 held, production capture/reconcile
refused and D64 unchanged; B3/B4 not repeated, four histories separate.

Next two source gates: B5-D62-owned-source-release must consume verified ABORT/completion
and successful cleanup under both locks, establish durable decision bytes, freshly
recheck original stopped/guarded host and source before its own journaled release,
and fail held/manual on every uncertain attempt. B5-D62-guest-admission/manual then
binds the host decision before any gate opens, compares all OpenClaw launchd jobs and
every process as the OpenClaw user or executing production entrypoint roots before
Journal.recover, refuses unexpected/unreadable scoped observations, then checks stopped
units/overrides and implements the manual route. This is not a physical process census.
D175 follows admitted boot before gate construction; installed timers stay unchanged.
B1 covers owned source/tests, not production operations. Actual macOS reboot/login/
hold-reattach/D175 evidence still requires exact operator-designated disposable access
or a measured fixed disk/RAM/capacity decision. No new VM, local image or production
resource operation is performed by this receipt.


## D212 — 2026-10-17 18:41 EDT: separately journal an owned ABORT source release

B5-D62-owned-source-release extends existing host_vm_reconcile.py under an entry-first
production fence and the positive owned fixture boundary. Both original EX locks stay
held through a fixed single-use abort-release attempt. Claude166's seven corrections
and168's short schema/flush clarifications govern this slice. The read-only
verify_release consumes caller-held descriptors and a caller-supplied fresh observation;
it does not reuse verify_abort after the source flag is removed. The shared released
identity helper requires the original device/inode/size/mtime/full sha256 and exact flags
with only UF_IMMUTABLE removed; ctime may advance. Clone-only sibling checks permit old
CAPTURE receipts without surviving clones. Core verifier grants no boot/admission.

The release consumer first verifies the original ABORT/cleanup chain, synchronizes every
verified transcript file and containing owned directory, then observes and verifies
again. Files use fsync plus F_FULLFSYNC when available, with failure propagated and no
error fallback; containing directories use fsync bottom-up. INTENT and COMPLETE use
fully flushed temporary files before rename and directory fsync after. Existing producer
records were fsync-level; the release consumer establishes its own barrier rather than
inferring a prior fsync return from file presence. Same-uid coordinated rewrites and
sampled-only denial/provenance limits remain D189/D210; this is not hardware power-loss
proof or a protected acceptance root.

Exact canonical INTENT binds ABORT/decision-completion/cleanup/cleanup-intent hashes,
nonce, arm, head, checkpoint, complete evidence table, both pre-clear sample tables and
original guarded source identity. COMPLETE binds INTENT, ABORT, after sample table and
released source identity. Fixed layout is verify/barrier/after plus INTENT/COMPLETE only;
missing, failed, temporary, unknown or repeated attempts refuse, including a visible
COMPLETE beside FAILED. Before the one pinned source clear the original verification
and transcript bytes are checked again. After it, fresh stopped/no-holder original-
host/VM/boot/device/vmstate/config/controller checks and a full rehash precede completion.
No source FD is held across preflight's holder observation.

A failure before flag-call entry leaves release's flag operation unattempted. From entry
onward the flag state is uncertain on failure: no automatic re-guard, retry, alternate
output or BOOTABLE. Best-effort FAILED diagnostics preserve the primary BaseException
and name manual handling; an intent/attempt remains single use even if diagnostics fail.
This is not the still-open explicit guest manual-restoration route.

Verify uses real owned checkpoint/commit/cleanup/terminal producers and file syncs, with
scripted VM/flags and a ctime advance on clear, decisive failure/ordering/identity/retry
controls and mutants. Claude exact-source and exact-head green CI are required before
source readiness. Native full cleanup→decision→release, real B8 ACCEPTED, protected
provenance, actual macOS reboot and the guest admission/manual route remain open. B5/1.2
open at v1.2-pre, B6–B9 held; B3/B4 not repeated, four histories separate, D64 and all
production fences unchanged. No local native image/VM/launchd operation is performed.


### 2026-10-17 18:40 EDT — owned ABORT source-release candidate (D212)

The existing reconcile module now has a fixture-only checked release and read-only
released-source verifier, with exact canonical schemas, consumer-established file/full-
flush and directory barriers, original host/source/ABORT/cleanup bindings, one source
flag call, post-clear rehash and a fixed single-use attempt. Claude166/168's seven
design corrections are incorporated. Ten intended-assertion mutants pass with their
unmutated controls. An initial barrier-skip mutant survived because the test's blanket
flush failure was reached again by the separate sample-file barrier; narrowing that
fault to the original ABORT evidence table kills removal at its intended assertion.
This was test masking, not a changed runtime permission.32release controls are being
verified after the lock/sample/identity additions; earlier28 pass26.456s. The combined
61release/terminal/fence controls pass88.299s. Exact-source Claude and exact-head CI
remain pending; no source readiness or B5 closure is claimed.

Every failure after flag-call entry is manual with flag state uncertain, never automatic
re-guard/retry or a denial-held claim. A visible COMPLETE is not proof a prior process
returned successfully; future admission must consume evidence under its own contract.
Native complete cleanup→terminal→release and real guest reboot remain unproved. D64,
production capture/reconcile fences and installed timers are unchanged; B5/1.2 open,
B6–B9 held, B3/B4 not repeated, four histories separate. No local image/VM/launchd or
production operation occurred.

Next two gates: B5-D62-guest-admission/manual needs host decision binding before any
guest gate, all OpenClaw launchd jobs and every process as the OpenClaw UID or executing
production entrypoint roots compared against the recorded hold before Journal.recover;
unexpected/unreadable scoped observations refuse, then stopped-unit/override checks and
an explicit manual route. This is not a complete physical process census. B5-D175-owned-
repin follows admission before gate construction: conditional journaled value-only
changes to the five owned timer plists and manifest only if the device changed, with
stable inode/birthtime/nonce/volume/path and same-boot descriptor checks. Both use B1
source/owned authority, decisive negatives, Claude and exact-head CI; APFS reattach and
actual disposable-macOS reboot/login/process/hold/migration rehearsal remain distinct
requirements. Actual Mac access still needs an exact operator designation or a measured
fixed disk/RAM/capacity decision; this gate provisions nothing.

D212 pre-publication update: all32 owned release controls pass32.834s; all10 mutants
are killed at their designated assertions.61bounded release/terminal/fence regressions
pass88.299s. Review and exact-head CI are still pending. No source readiness claim.


2026-10-17 18:45 EDT — D212 freshness correction, candidate not ready:
An owned c8aa5846 reproduction changes the observed holder set immediately after INTENT
publication. The saved barrier observation is reused through the final verification,
so source clear occurs once before the post-clear sample refuses. A new negative fails
at the intended zero-flag-call assertion. No live resource was used. This is a required
release-order correction, not a reason to waive the guard or declare CI green.

Re-oriented this gate after the mutation-test mask and this source finding: its one
outcome remains a checked owned source release. Name the pre-clear freshness prerequisite
B5-release-freshness; guest admission/D175 remain separate next gates. After durable
INTENT and the expensive original re-verification, add a new before-clear live sample,
compare consumed/written bytes, original host binding and cheap source metadata/flag/
guard checks, then the one pinned clear. No further whole-image hash delays that last
observation; the prior hash was under sampled guard with unchanged metadata, subject
to D189's same-uid limit. COMPLETE now additionally binds before_clear_sample_sha256;
the fixed layout includes before-clear, and the shared release binding checks that
saved sample. INTENT cannot forward-bind later sample bytes. The before-clear and after
sample files are synchronized before completion, and all pinned bytes are checked.
The corrected schema/order is under Claude review and decisive new negatives.

CI39076032148 at c8aa5846 failed Linux117523256747 in unchanged test_recovery.mjs at
cluster-replicated-r3-create, NATS peer offline10005, before Python tests. It is not
green; no retry or unrelated NATS fixture change has been made. Native is pending.


D212 review172 independently reproduces the original32 controls and10mutants as uid65534
and confirms the pre-clear defect and revised order/schema. Its two precision points
are incorporated: pre-clear ctime equals the ABORT source exactly (only post-clear may
advance), and the cheap last check also requires clone absence, attachment inventory,
clone-only sibling absence and unchanged INTENT bytes. A no-op if another same-uid actor
clears the flag in the final helper gap remains an explicit D189 limitation; it is not
claimed as a consumer-performed clear or continuous exclusion. No new native control
is claimed until the current-head CI job is observed.

Separate follow-up B5-CI-R3-placement: the unchanged isolated test_recovery.mjs R3 fixture
has failed at least twice today (cef42140 and c8aa5846) before Python collection with
peer-offline10005. Owner Codex, future bounded fixture-readiness diagnosis and decisive
fix in its own work unit; this release slice makes no NATS fixture change and does not
use repeated retries as evidence. Current exact-head all-green CI remains mandatory.


2026-10-17 18:50 EDT — D212 corrected candidate proof, still not source ready:
All40 owned release controls pass48.522s. All13 mutants are killed at their intended
assertions with unmutated controls and no test errors. The c8aa holder-at-INTENT
negative fails with one flag call on old source and passes with zero calls after the
new last observation. Pre-clear clone/attachment/sibling, exact ctime/metadata, host
state/identity, unreadable observation and consumed-file parity negatives also pass.
The positive asserts no whole-image rehash between the last live sample and clear;
COMPLETE binds that sample and read-only verification refuses altered bytes. The
ctime fixture preserves the old inode while replacing the path, avoiding inode reuse.
The ordering mutant now moves the flag operation itself before INTENT; the old mutation
produced a setup/file-read error after the new readback guard and was rejected by the
runner. The sibling mutant anchor is now exact to its line/indent after a second
clone-only check was added. Neither runner error was counted as a kill.

Claude172 accepted the corrected design and named the final cheap checks; exact-source
review and current-head CI remain pending. Local Python3.9.6/darwin exposes F_FULLFSYNC51
and the real owned-file barriers pass; current CI native behavior still must be read.
No source readiness, native whole pipeline, guest admission, boot, B8 acceptance or
production recovery claim follows. B5/1.2 open, B6–B9 held, D64 and production fences
unchanged; next guest scoped admission/manual, then D175. No production operation.


## D213 — 2026-10-17 19:21 EDT: verify the owned ABORT source-release checkpoint

Source004b1ce5722f3935c82599100951e6e4145cedae passes all8 checks in exact CI39076640535.
Native macOS117525047608 runs40 release controls in24.107s, plain OK, and all13
intended release mutants; the real owned-file durability barrier accepts its read-only
file descriptors on the runner. This supplies D212/Claude174's required native
full_sync observation (F_FULLFSYNC where the native attribute exists), not a simulated
power-loss proof.16capture30.417s,29terminal11.651s and15status14.127s are plain OK;
all39 kills include the earlier12cleanup and14terminal mutants. The raw native log
SHA256 is de0dc1d6a82c99f5556b494ce394bef4b1114c0c446ab8ae75872d4a3fad43d2. Native checkout merge
c76523cbc17708c97455af7ab7f26a53c2624a89 has source004b as its second parent; fetched
step12 and workflow blobs are identical. Linux117525047612 passes its JetStream/root
steps,40release12.302s and13mutants; raw log SHA256
c3d3b5f1014e44fb32b16d20392d8d613241ae7edc96e4af206170c45e773aa5.

Claude174 independently reproduces40controls/13mutants and the regressions as uid65534,
closes R1 and both precision points on this exact source, and finds no required source
defect. Its five extra negatives kill removal of attachment/sibling/sample-binding/
consumed-byte checks and pre-clear ctime equality. R2 was native observation only and
is supplied by this completed job. Source c8aa's native117523256965 separately passed
32controls/10mutants; its overall CI39076032148 failed unchanged R3 placement before
Python and is never labelled green or relabelled40/13. Its retained raw native hash
44527f724a594033acd2de149fb38bfd6e98d75bfa71d94a7b564deefa47507d stays distinct.
B5-CI-R3-placement remains a separate follow-up despite the corrected run passing.

B5-D62-owned-source-release closes only this owned source prerequisite. Both original
EX locks, consumer-established transcript durability, canonical INTENT/COMPLETE, the
last live pre-clear observation and strict guarded metadata/ctime, clone/attachment/
sibling checks precede the one pinned clear. A post-clear rehash allows only the
immutable bit removal and advanced ctime. Read-only verify_release returns evidence
bytes under caller-held locks and a fresh caller sample, never admission or boot.
A failed/partial attempt is single use and manual; once the flag call starts its state
is uncertain on failure, with no automatic re-guard/retry. A visible receipt alone
does not prove a prior process returned after fsync; future consumers need their own
checked decision/durability contract.

Explicit carry-forwards: D189's same-uid coordinated-rewrite/protected-provenance and
sampled-denial limits; the helper's final same-uid no-op gap; X3 is an equivalent guard
mutant, not a missing predicate. X6 is an optional coverage gap: the present final
transcript equality guard has no dedicated zero-call negative rewriting a pinned
record during before-clear preflight. It is not silently closed. Full native
cleanup→terminal→release, actual VM hold/reboot/login behavior and real B8 ACCEPTED
remain unproved. The release controls script VM/flags despite using actual owned
files/flushes. No hardware-loss, authorship or pre-stop physical-exclusion claim.

This receipt changes five Markdown files only and requires its own exact-head green
CI before current-head readiness. B5/1.2 remain open at v1.2-pre, B6–B9 held; production
capture/reconcile, D64 and installed timers are unchanged, B3/B4 not repeated and all
four histories separate. No production or local native image/VM/launchd operation.

Next two gates: guest host-decision binding/scoped admission/manual restoration before
any gate opens and before Journal.recover, then D175 conditional journaled value-only
re-pin of the five owned timer plists/manifest after admission and before gate creation.
Admission compares all OpenClaw jobs plus every process as the OpenClaw UID or executing
production entrypoint roots, refuses unreadable/unexpected scoped observations, then
checks stopped units/overrides; this is not a complete physical census. Both source
gates use B1 owned authorization, decisive negatives, Claude and exact-head CI. Actual
APFS reattach and disposable-Mac reboot/migration still require their distinct evidence;
Mac access needs an exact operator designation or a measured fixed resource decision.


## D214 — 2026-10-17 20:13 EDT: record an owned pre-start restore-prior decision

Claude183 identifies the missing handoff between D213's source release and future guest
admission. verify_release requires the original stopped VM, original host session and
unchanged whole-image bytes; calling it after the guest boots is impossible by design.
This unit extends existing host_vm_reconcile.py with decide_restore_prior and a strictly
pre-start, read-only verify_decision. It consumes the real cleanup→ABORT→release chain
under both original EX locks, establishes its own evidence durability, publishes INTENT,
takes a fresh stopped observation and re-verifies the unchanged released source and all
pins before a separate RESTORE_PRIOR record. Neither function starts a VM, changes flags,
permits guest admission or creates a new recovery point. ACCEPTED still has no B8 producer.

The fixed owned-only abort-boot directory has exactly verify/, decision/, INTENT.json and
RESTORE_PRIOR.json. Samples use the existing private-file allow-list and must equal the
consumed observations. The intent pins original ABORT/checkpoint/arm/nonce, original host
session/fixture VM, released source metadata/bytes, full prior evidence and first sample.
The decision also binds intent bytes and the final sample. Consumer-established real file
flushes/full flush where available and directory fsync precede publication. Both records
use the existing exclusive temp/full-flush/rename/directory-sync publication. All partial,
failed, temporary, unknown and repeated attempts refuse for manual handling, including a
visible decision beside FAILED after an applied publication failure. The source state is
not changed by this decision; it is not claimed continuously stopped or protected.

restore_only.py adds a pure owned claim decoder: external expected digest, canonical
host decision bytes, and caller-supplied local checkpoint bytes are required. The host
record uses host_guest_commit.encoded (newline); the journal's canonical body hash uses
preservation_journal.encoded (no newline). Exact schema/event/scope/body hash and
nonce/arm/pre-head/previous/checkpoint bindings refuse mismatches. Output labels the digest
operator_claim, authority unprotected-user-owned, admission false, with historical released
source fields and no verified/provenance claim. It reads no file, constructs no Journal or
Gate, and calls no host verifier/recovery. A caller-supplied checkpoint is not a chain or
protected trust root; the later admission controller still owes the local chain/hold,
boot-time jobs/processes, stopped-unit and override checks. No protected channel, signing
key, start authority or admission capability is invented.

Claude187 confirms four required design points: distinct canonical encoders; reserve the
fixed attempt name in verify_abort_command; unchanged verify_release on both producer
samples and current consumer sample; exact pure-decoder bindings and claim-only output.
RESTORE_PRIOR.json deliberately avoids the existing nested DECISION.json conflict. Both
abort_conflicts and no_terminal stay unchanged; ABORT remains the only root terminal.
Claude withdraws183's changed-host-session/post-start verification, broad platform-binary
allow-list, claimed currently actionable manual commands and blanket path-device mapping.
Those are not adopted. Identity.json bytes/nonce/hash stay immutable in future design.

New Codex-owned warning B5-gate-device-reattach: source reading and Claude183/187 confirm
four device bindings: identity.json root/lock, JournaledHold saved pins, saved metadata/
per-component path evidence, and five installed timer argv/manifest pins. D175's last
binding alone cannot make the old-device Gate construct or the hold validate. Before
that migration closes, a reviewed restore-only reattachment record must allow only the
proven old-Data→new-Data device mapping for the affected filesystem components, preserving
inode/birthtime/lock-ctime/uid/mode/nonce/metadata bytes/hash/volume/path binding and every
same-boot FD/path st_dev comparison. This is source design, not permission to widen D175's
allowed installed value-only diff or change any timer or identity file now. Actual APFS
reattach and disposable-Mac reboot remain separate proof gates.

The manual restoration route is a remaining implementation: after an explicit host
choice and byte-bound operator claim, collect the actual scoped jobs/processes, refuse
unexpected or unreadable observations, inspect stopped units/overrides and fresh exclusions;
only after admission and any reviewed D175 reattachment may an attended restore-only driver
restore in journaled dependency order with history_certified false. A refusal preserves
the hold and names the specific condition for attended correction/re-observation; it never
stops unexpected jobs automatically or turns a login start into already-restored success.
No such full-node guest admission/manual driver is supplied or claimed in this unit.
Platform interpreters and the controller's descendants receive no blanket exception.

Candidate verification:25 owned controls pass46.114s with actual file flushes, scripted
VM/flags and real checkpoint/capture/cleanup/terminal/release producers. Initial test
setup incorrectly used the exclusive write_record for intentional overwrites; corrected
fixture tampering uses write_bytes, without changing runtime policy. Intended-assertion
mutants, bounded release/D64/fence regressions, exact-source Claude and current-head CI
are still pending. An initial mutant control list used the assertion field as a test name;
that runner error was rejected and corrected, not counted as a kill. No readiness claim.
B1 remains source/owned only; B2 Alpine is historical bounded mechanism proof, B3's23 pins
remain JIT and B4 a bounded design input, neither repeated. B5/1.2 stay open/pre, B6 lacks
fresh exact-window approval, B7–B9 held with no live stop/capture/acceptance/resumption.
D64's first cross-boot refusal and existing production fences are unchanged. Four NATS
histories stay separate; no production service/VM/image/timer or local native image/launchd
operation occurred. Next guest scoped admission/manual source, then D175 reattachment;
both need decisive owned tests, Claude and exact CI. Real Mac access still needs the
operator's exact disposable designation or a measured fixed resource decision.


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


## D215 — 2026-10-17 21:06 EDT: verify the owned pre-start restore-prior decision

Exact source d5636b5411a29fbb25ce467c1119cb997f5a6ccb passes all8 checks in CI39083436062.
Native macOS117544960569 passes33 decision controls16.121s and all20 intended decision
mutants; all39 prior cleanup/terminal/release kills also pass (59 total). Raw job-log
SHA256 d63ed33a35dcc81d808077e8c9c8a46b5359f57efd54079a669afa581aeda128. Native and Linux
checkout merge34a3bd5a8a5d172160a97216dfc0c5cafee4f5e1 has source d563 as second parent;
fetched recovery-step/workflow blobs are identical. Linux117544960755 passes33controls
15.620s and20mutants plus its full recovery/root steps; raw log SHA256
2f9a311895cffa339630a62ac892bbf78f42a0b6a34cbae3427c2b27d204badd.

Claude193 finds no required runtime source finding at3cbc9cd5 and reproduces the initial
27/13 and unchanged regressions as uid65534. Its live removals expose present but masked
binding guards. Claude195 independently verifies the test-only d563 descendant:33OK14.1s,
all20 intended kills with passing controls/noERROR. All its formerly surviving stored-
sample, decision/intent, decoder nonce/arm/checkpoint and previous/flags mutations now
fail their matching new negatives. No required finding remains. Runtime/workflow blobs
are identical to3cbc; all lib/bin/test/workspace-bin trees are unchanged by the test proof.

The earlier runtime head3cbc9cd559efdcee1e6742ed954126556d875cce separately passes all8
checks in CI39082522585. Its native117542250800 is27controls15.531s/13decision mutants,
not33/20; raw SHA256 d1fe14a370c6823cb458ef4179d06bc007bc97bda57065d5bc4c3e4a70f5213d.
Its fetched merge10c2f24faa24201882bf5678b29ae2d5eb810f01 has3cbc as second parent and
identical recovery/workflow blobs. The first aa340975 run39082243166 was canceled after
the literal mutation-anchor collision was found; it is not green or native evidence.
These results are distinct and never relabelled.

B5-D62-host-boot-decision closes only the owned source prerequisite; B5-decision-binding-
tests is cleared at the33/20 floor. The fixed single-use restore-prior record consumes
completed ABORT/release under both EX locks and consumer-established file/directory
barriers. Both fresh written/consumed samples and whole-image checks retain the original
host session and source bytes. Pre-start-only verify_decision is read-only. The guest
consumer checks the external digest and canonical local checkpoint, returning an
unprotected operator_claim and admission false, with no I/O, Journal/Gate/recovery or
post-boot host verification. It grants no VM start, guest admission, ACCEPTED or recovery
point. Visible success beside FAILED or any partial/repeated attempt remains manual.
Native controls use actual owned files/barriers on read-only descriptors, with the
existing full-flush branch conditional on attribute availability. VM/flag operations are
scripted; no native whole cleanup→decision→release→boot pipeline or hardware-loss proof.

Carried optional notes: local checkpoint event/scope guard coverage is near-equivalent
under the exact digest binding and D189 same-uid coordinated rewrite limit; JSONDecodeError
normalization and the host import graph are not silently changed. Prior release X6, the
helper no-op gap, strong-flush-attribute assertion, B5-CI-R3-placement and protected host/B3
provenance limits remain tracked. No claim of authorship, continuous sampled denial,
pre-power-off physical exclusion or real-history acceptance follows.

Next B5-D62-guest-scoped-admission/manual needs the claim bound before any guest gate,
local chain and recorded hold validation, all OpenClaw launchd jobs and every process as
the OpenClaw UID or executing production entrypoint roots compared to that hold before
Journal.recover, unreadable/unexpected in-scope observations refused, then stopped units,
overrides and fresh exclusion checks. It is not a complete physical process census, and
platform interpreters get no blanket exception. The explicit attended manual route is
still unimplemented; a refusal leaves the node held and does not become already-restored.

D175 follows admission before post-boot Gate construction/restoration. B5-gate-device-
reattach stays open: a reviewed per-filesystem old-Data→new-Data mapping must account for
identity.json, saved pins, saved metadata/path components and all five timer argv/manifest
pins, preserving inode/birthtime/lock-ctime/nonce/hash/volume/path and same-boot FD/path
checks without rewriting identity.json. Only the exact journaled installed value-only
diff is allowed, only if device changed; altered identities/extra fields/non-timers/
premature/same-boot/repeated migration must refuse. Owned APFS reattach and a separately
designated disposable-Mac full reboot/login/process/hold/migration rehearsal are still
required; no owned fixture substitutes for them. B1 permits the next source tests;
actual Mac access still needs exact operator designation or a measured fixed resource
decision, with Codex's resource proposal remaining a prerequisite for a new guest.

This receipt changes five Markdown records only and requires its own exact-head green
CI before current-head readiness. VERSION remains v1.2-pre; overall1.2/B5 open. B1 design
only, B2 Alpine mechanism only, B3's23 pins JIT and B4 bounded design input, neither
repeated; B6 has no fresh exact-window release, B7–B9 held. D64's first full-node cross-
boot refusal, production capture/reconcile fences and installed timers are unchanged.
All four physical NATS histories remain separate. No production service/VM/image/timer,
local native image/launchd operation or real guest reboot occurred in this work unit.


## D216 — 2026-10-17 22:13 EDT: develop an owned current-boot process diagnostic

Claude203/205 and the current source confirm that the checkpoint and baseline lack an
explicit pre-window boot-process policy. A new record inside the forward window would
violate capture_cohort. B5-boot-process-policy is a Codex-owned dependency: design and
verify its producer/frozen binding before UID-wide guest admission, manual restoration
or D175. Old PIDs, live-sampled exemption lists, broad platform/descendant classes and
a UID-disabled owned positive cannot close it. Production D64 needs no new approval
to remain strict while independent B1-owned prerequisites are developed.

B5-D62-scoped-process-diagnostic is one smaller executable source prerequisite. Its new
module composes the unchanged libproc, file-hash, boot and relevant_entrypoint primitives;
its CLI is the concrete record-free consumer. The exact owner-private canonical expectation
file is current-boot test input, not a pre-stop policy, enrollment output or admission
capability. UID scope is always on, OR executable/cwd/argv paths under the declared roots.
Every expected process has exact pid/ppid/uid/gid/name/start/executable/hash/argv/cwd fields;
duplicates, extra fields and out-of-scope expectations refuse. No self/helper exception.

Two PID samples each read every enumerated process. Per-process brackets compare identity
including gid/name (not nfiles), executable/argv/cwd; both samples must agree. Unreadable
fields, unresolved other-UID paths, unknown membership, churn, uncovered PIDs and a full
list omitting the diagnostic process refuse. Current on-disk executable bytes are hashed
with existing descriptor/path checks and ctime must not be later than process start at
microsecond floor. This is not loaded-image identity/authorship. The comparison resolves
paths through the existing helper, so it is read-only rather than a pure/no-I/O function;
earlier pure-comparator wording is superseded. Substring expansion and hardlink checks
can add scope/refusals; no interpreter-basename or missing-observation exemption exists.

The report has outcome clean/refused, never a top-level verified key, and fixed admission
and history_certified false. It binds the expectation bytes by digest and redacts argv
to SHA256 of NUL-joined UTF-8 values. Enumeration is labelled full only while using the
unchanged shared PID enumerator, otherwise substituted. Both remain sampled, non-atomic
and non-continuous; no physical exclusion or complete readability is claimed. The CLI
requires an explicit fixture flag, a literal private temporary fixture directory, a
private single-link canonical file, current UID and roots inside that fixture. It writes
no files and performs no service, gate, journal, VM or timer action.

Claude207's material design corrections are included: ctime limit, exec-in-place brackets,
second per-PID sample, explicit enumeration labels, no verified output and scope-valid
expectations. The native child is a tiny freshly compiled owned C program: PID/PPID/UID/
GID/name/path/hash/argv/cwd derive from spawn facts, seconds cross-check ps lstart, with
subsecond start measured from the existing kernel primitive. Exact argv includes an empty
later argument and UTF-8; the shared decoder's empty argv[0]/padding ambiguity remains
unmodified and is not tested or closed here. An initial Python-based independent control
correctly refused Apple's launcher re-exec/path/argv0 rewrite; the C fixture replaces it
instead of treating the backend's own output as its expectation. The native positive
uses only an explicitly substituted owned-child PID enumeration, never a full-host positive.
CI additionally runs an unpatched owned-runner scan and requires refusal with that child
matched; that measurement is pending, not relabelled local proof.

Local36 controls pass1.456s including that real macOS child. All24 mutants fail their named
assertions with unmutated controls passing and no ERROR counted. An initial None test
helper default, a UID-scope proof masked by cwd/root scope, and a two-occurrence mutation
anchor were corrected as test/runner setup, not counted kills. Existing executable
bodies are unchanged; Linux/macOS CI registration adds this suite and runner only.
Exact-source Claude and exact-head green CI remain required; this is a candidate, not
source readiness or closure. B5/1.2 remain open/pre, B6–B9 held, D64/production/timers
unchanged, four histories separate. B3/B4 not repeated. Jobs/stopped/overrides/fresh D60,
local full chain/hold/host-decision binding and all cross-boot/manual restoration remain
future admission work. Next two source gates: explicit pre-window process-policy producer
with reviewed frozen binding, then durable boot admission record; both need B1, exact-source
review and green exact-head CI. Manual/D175 follow them, with independent APFS and designated
disposable-Mac rehearsal still required. Codex owes the measured resource proposal before
a new guest budget decision; no provisioning or disposable designation is inferred.


### D216 correction — 2026-10-17 22:25 EDT

Candidate ffd7cb8c independently reproduced a required scope error: an other-UID
argv element naming an absolute or relative symlink with spaces into a declared
root was tokenized by the shared plist helper and could be falsely excluded.
The process adapter now resolves whole executable/cwd/argv values against the
observed cwd before retaining the unchanged shared helper scan. A dedicated
absolute/relative regression and whole-path-removal mutant pin the correction;
no shared classifier or census API changes. Local40 controls pass0.847s and all28
intended-assertion mutants pass with intact controls. Superseded CI39089415728
was canceled for this source correction, never counted green. Exact corrected
source review and exact-head native/full CI remain pending; all D216 limits hold.

Claude211 independently reproduces both false exclusions at ffd7cb8c and finds
no other required source issue. The regression also covers quote, parenthesis
and other tokenizer delimiters. Three optional surviving proof gaps are now
pinned separately: argv-digest boundaries, requested-PID identity, and full cwd
vnode reread with unchanged path. A kernel-canonical executable-path mutation
remains near-equivalent and not counted as a kill. The name is kernel-reported
and can be truncated; arbitrary long executable basenames are not assumed to
match it. Existing mapped-image and same-user limits remain unchanged.


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


## D217 — 2026-10-17 23:02 EDT: close the owned process-diagnostic source prerequisite


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


## D218 — 2026-10-17 23:41 EDT: authored policy binding, owned prerequisite only


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


## D219 — 2026-10-18 00:40 EDT: owned policy-binding source verified


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


## D220 — 2026-10-18 01:25 EDT: owned process observation envelope


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


## D221 — 2026-10-18 02:41 EDT: owned observation-envelope source verified


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


## D222 — 2026-10-18 03:14 EDT: owned class-comparator candidate


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


## D223 — 2026-10-18 04:25 EDT: owned process-class comparator source verified


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


## D224 — 2026-10-18 05:16 EDT: owned held-job negative comparator pre-audit

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


## D225 — 2026-10-18 06:11 EDT: owned held-job negative comparator source verified

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


### 2026-10-18 07:32 EDT — owned managed-job observation source verified (D227)

Source 6d2e90961ce8ae9a0be2271e109e0c31cf09c80e passes all eight jobs in
[CI39121279608](https://github.com/moltyguibros-design/openclaw-node/actions/runs/39121279608).
Native job 117657230203 executes34 tests in3.686s with no skip and
55 intended-assertion kills/intact controls. Its new unpatched fixed-label
measurement reports outcome=recorded, 69 keys in two sweeps,
error histogram {}, elapsed900688833ns.
This measures fixed managed-job facts only, not process absence/attribution,
complete installed entrypoint inventory, overrides, freshD60 or execution hold.
The CI branch is an isolation convention, not host/environment attestation.
It need not yield recorded; every error, including unreadable system-domain
facts, remains a refusal. Earlier process full-scan lines retain their own scope.
Linux job 117657230335 executes34 tests in1.778s with one intentional
CI-only native skip and55 kills. Codex inspected both complete raw logs:
native76572 bytes SHA256 e5c433155dc70bfdc78f5e3ae80c471bb8f9f4cc1fd6b874f19de161b45bbbf5;
Linux1526778 bytes SHA256 987995de9d856b63e53b55a94c0d6a7109874171445645eda0a04b6e64e4e49c.
Both name mergeacfc684524f5d708d3b1a0a91dd4d5f3fcc24d46 with reviewed source as second parent
and an identical whole tree. These completed-CI/log facts are Codex observations
separate from review285, which saw six of eight green at11:03UTC.

Claude285 independently clears the exact source with no required source or proof
finding. It confirms sole parent956f6c03, ten-file delta,202-line module and its
SHA, four workflow lines, six identical ledger blocks and unchanged pre-existing
executable/test/runner bytes. A full-tree uid65534 export reproduces34/one skip,
55 intended kills/intact controls and214 prior regressions/three darwin skips.
The local Mac214 run had no skip; those platform results are kept distinct.
Independent namespace-key, error-as-fact and observed-label variants die.
The source follows283: structured keys, pair guard, typed catch-bracket facts,
complete error retention/expiry, four boot/sweep stages, pure recomputation and
a collector-free CLI. The explicit two-replacement domain/unit/live-route
variants retain their declared mechanism; no ERROR-only kill is counted.
The local numeric0 redactor edge and immediate valid_job correction, early
failed/partial runs, final34/15.367s/55 and separate214/42.920s keep their counts.

Optional failure-stage vocabulary and string-key guards remain non-counted;
string keys are guaranteed by JSON on the real consumer path. The verified-digest
tie is dominated by the frozen binding. The conservative exact-expiry variant
is not an extra kill or a permissive acceptance defect. sample_labels.coverage
only repeats constants; the source label carries provenance information. The
CLI always forces scripted source, preserving bounded file claims without
promoting them. No new optional follow-up is silently closed. Existing
D218/D220/D224 carry-forwards remain. Export lint retains its two old failures;
local plan-lint remains14 PASS/1 old idle-version WARN/0 FAIL.

Only B5-D62-managed-job-observation closes as an owned source prerequisite.
The prepared stopped-image consumer uses private literal inputs, coherent pins
before one reader/frozen verifier, and every read-owner equality to recordedUID
before a private canonical bounded observation file. Both fixture/scripted flags
precede input IO; no CLI route calls the live collector. Only the darwin-plus-CI
test branch composes owned_records and collect_jobs, and no local unpatched
fixed-label scan occurred. All existing executable/test/mutation files remain
unchanged from956f6c03; only the three new files, four workflow lines and six
source ledgers implement this unit. No Journal/schema/recover/D64/Gate/identity,
shared census/parser, host executable or installed timer change. No file write
or constructor is performed by observation/validation/consumer operations.

This records sampled current-boot fixed managed-label facts, with loaded/idle
facts recordable, not held-negative consistency, a live hold, eligibility,
history/authorship, physical exclusion or admission. The30-minute acceptance
window cannot interrupt calls and boot_identity has no timeout; cohort growth
that outgrows twice the shared10s call budget fails the fixture control. No120s
process-window inheritance. Serialized argv is hashed, never raw; source data
remains unprotected under D189, with no protected B3 pin provenance.

B5/1.2 stay open/v1.2-pre, B6–B9 held. Full held-gate combination, overrides/fresh
D60, strict process integration, durable admission/manual/D175, Mac access,
APFS reattach/reboot and four-history acceptance remain separate. No production
operation or release. This receipt changes five Markdown records only, keeping
all source/tests/workflow bytes fixed. Its own exact-head review and CI remain
pending at commit time.


### 2026-10-18 08:14 EDT — managed-job negative observation pre-audit candidate (D228)

Micro re-orient: B5/1.2 remain open/v1.2-pre, B6–B9 held.
D227 receipt2d54d6e9 and source6d2e9096 have clear289/285 reviews and
all8 CI39123687039/39121279608. Claude291 distinguishes its independent
source-native proof from Codex's later receipt-CI observations.
Current managed facts and scripted negative consistency exist separately;
this atom connects them without declaring a live hold or admission.

Goal: one negative consistency result over a validated managed-job observation.
Needs: D227 reviewed green source/receipt; unchanged managed.valid_observation,
owned_records, collect_jobs, held.compare_held_jobs, private readers and honest
frozen fixtures; B1/D189. All are present at2d54d6e9.
Feeds: overrides/freshD60, complete held-gate/process integration, durable
admission/manual/D175; no new production route or window authorization.
Verify: portable envelope-to-comparator and real owned consumer controls with
named assertion mutants; isolated CI native measurement without requiring a
positive; exact-source review/all8 CI, then separate reviewed green receipt.
Runtime: none in production; no local unpatched managed-label scan.

Pre-audit request292 is pending. Proposed source surface: new
managed_job_negative_observation.py plus test/mutation runner, four CI lines,
and these six source ledgers. Existing executables/tests/runners remain fixed.
No Journal/schema/recover/D64/Gate/identity/host/timer change. VERSION remains
v1.2-pre because the enclosing live recovery exit gates are not satisfied.

Proposed comparison first revalidates the complete observation against already
frozen-verified records, recomputes recorded/refused, then and only then passes
the proven complete, error-free, equal first sweep to unchanged held comparison.
Loaded idle/no-PID is recordable but cannot satisfy the negative comparison.
Input observation fingerprint, frozen binding, provenance/coverage and temporal
budget summary remain visible. Nested supplied-fact comparator scope/source
remain scripted; wrapper separately records observed or forced-scripted source.
All hold/history/admission certification flags stay false.

The real owned CLI requires fixture AND scripted before IO, reuses owned_records
for pin coherence, one reader/frozen verification and every metadata owner tied
to recordedUID, then reads the private canonical bounded managed-jobs.json.
File source claims remain untrusted sample labels; no CLI collector reference.
No constructor, state write or installation. The darwin+GITHUB_ACTIONS native
test path may compose the reader, collector and wrapper; that guard is an
isolation convention, not attestation. No native positive is assumed.

Risk/claim limits: this uses only the job30min acceptance budget and two boot-
bracketed sweeps, not a joint process/job window or a new age/freshness proof.
No current clock/boot reread in pure comparison, no baseline-boot expectation,
no continuous/physical exclusion or hold assertion. Blocked calls cannot be
interrupted by the budget. Unprotected supplied facts remain subject to D189.
Overrides/freshD60, strict process scope/attribution, durable admission/manual/
D175, Mac designation/APFS/reboot and four-history acceptance remain later.
Optional prior controls remain carried, not silently closed.


### D228 pre-audit settled — Claude293, before source work

Clear to implement pure composition, no new predicate beyond the recorded gate.
Validate before fingerprint/comparison. Malformed observations propagate refusal;
recomputed non-recorded returns phase observation, recomputed reasons, negative
null and never calls the comparator. Hash the exact received value after validation,
copy binding/source/sample_labels/coverage/budget from the recomputed copy.
Pass its first sweep verbatim; loaded-idle/running facts must refuse. Preserve
the nested comparator result exactly, including scripted scope/source; top success
is managed-jobs-negative-consistent only for its held-jobs-negative-consistent.
All top and nested admission/history/hold flags stay false. Missing/extra/unknown
nested buckets are empty by construction on recorded inputs, upstream proof,
not newly counted predicates. Raw input stages or sweep_b are equivalent on this
path and are not counted mutants. No live authority or authorship follows source.

Reuse one owned_records; fixture AND scripted precede IO. Keep the forcing block
textually identical to managed.inspect_owned, pinned by textual control. Test
frozen refusal before observation read, duplicate image reads, provenance loss,
and explicit two-replacement gate-relaxation/live-route mutant with benign census
and fixture-only CLI refusal/zero calls. No collector reference in real CLI.
Native darwin-plus-CI branch composes reader/collector/wrapper and records actual
phase/outcome/coverage/idempotence only. A negative-consistent runner observation
is a runner fact, not a node positive or hold evidence. No local unpatched scan.
Purity/no-input-mutation and observation idempotence controls are adopted; optional
loaded_keys summary omitted. No new job/process coherence, current clock/boot read
or freshness promise;30min acceptance window and blocked-call limits remain.
Source/receipt exact reviews/all8 CI required separately; B5/1.2 open/pre.


### 2026-10-18 08:19 EDT — D228 local negative-observation candidate proof

The new64-line wrapper validates first, then fingerprints the exact received
object and copies the recomputed frozen binding/provenance/coverage/budget and
boot bracket. Non-recorded returns refused/phase observation/recomputed reasons/
negative null, without a comparator call. Recorded passes the validated first
sweep verbatim to unchanged compare_held_jobs; only its exact negative-consistent
verdict yields top managed-jobs-negative-consistent. Loaded idle and running
facts refuse. The nested result, literal scripted scope/source included, remains
unchanged. Both layers keep admission/history/hold false; no raw job values or
argv/policy appear in the wrapper result. Input immutability and no-IO comparison
are controlled. No live clock/boot read or new temporal/physical guarantee.

Local final20 tests pass7.981s with one intentional CI-only native skip;28 named
intended-assertion mutants die with intact controls, no ERROR-only kill. The
prior248 tests pass35.246s with the managed observer's one CI-only native skip.
The first20-test run failed because the test helper treated explicit None as
its default valid input; the malformed test now calls the wrapper directly.
No source correction was needed. The intermediate20 run passed5.339s; final
7.981s includes the provenance Refused-to-assertion control used by the runner.
No failed/partial mutant run occurred. Live-route mutation has two explicit
replacements: gate relaxation plus collector wiring; not a single-predicate kill.

The real private frozen consumer uses exactly one unchanged owned_records,
then bounded canonical observation read and the textually identical source/
sample-label forcing block. Both flags precede IO; frozen refusal prevents the
observation-file read. Genuine foreign recorded owner refuses upstream, with
and without optional policy the honest fixture reaches the same narrow result.
Journal/Gate construction and live census are forbidden in consumer controls;
files remain identical before/after. Canonical stdout and all three CLI phases
have correct exit codes. The fixture-only CLI with benign census refuses and
makes zero census calls. No local unpatched managed-label scan occurred.

All six pre-audit/local blocks are identical across the source ledgers. Promised
deltas land: three new files, four workflow registration lines and six ledgers.
Existing executable/test/mutator bytes remain fixed. Local plan lint14 PASS,
1 old idle-version WARN,0 FAIL. Upstream full-record/coverage/shape predicates
remain earlier proof, not new kills. Raw-stage or second-sweep substitutions are
equivalent on recorded inputs, not counted. Optional loaded_keys omitted; prior
optional controls remain carried. B5/1.2 open/v1.2-pre,B6–B9 held.

Required exact-source review/all8 CI are pending, then a separate five-Markdown
reviewed green receipt before only this owned row closes. CI native composes
the real reader/collector/wrapper and prints actual outcome/phase/69-key coverage/
errors/elapsed, asserting shape/idempotence only; no native positive is assumed.
Any negative-consistent CI result describes only sampled runner facts, never
node readiness, live hold, process absence, disabled overrides, full inventory,
freshD60, eligibility/history/authorship/physical exclusion or admission.
Overrides/freshD60, strict process integration, durable admission/manual/D175,
Mac/APFS/reboot/four-history acceptance remain later. D64/Gate/timers/production
are unchanged. No Phase-8 scope expansion or production operation occurred.


### 2026-10-18 08:55 EDT — owned managed-job negative observation source verified (D229)

Source 665ccdb4cf82ef52cd73ca03b4f5babfbbbd8045 passes all eight jobs in
[CI39126847156](https://github.com/moltyguibros-design/openclaw-node/actions/runs/39126847156).
Native job 117673662377 runs20 tests in2.207s/no skip and28 intended
assertion kills/intact controls. The new unpatched CI composition reports
outcome=managed-jobs-negative-consistent,phase=negative,69 keys/two sweeps,
errors {},elapsed731220792ns. This is only a sampled
fixed-label runner fact, not a node positive, execution hold or admission proof.
Linux job 117673662424 runs20 tests in1.157s/one CI-only native skip/28kills.
Codex inspected complete raw logs: native79800 bytes SHA256
fa3fa9fec2c911185612a90df64c08ad898b29d82084efb83993f7ead49af8f3; Linux1529725 bytes SHA256
4a206fc3f14160059a86f8163b5054389562cea2fe599eb65897506cef8c56c1. Both name merge69537c6b8c7fae93911b21163d2ef434454668e7
with the reviewed source as second parent and an identical whole tree.
These completed-CI facts are Codex observations, distinct from the independent
review and its CI status at review time. Older observer/process measurements
in the same native log are not this wrapper's new composition evidence.

Claude295 independently clears the exact source with no remaining required
source/proof finding. The full-tree uid65534 replay passes20 tests/one CI-only native skip and28 intended kills, plus248 prior regressions/four platform skips (local Mac248 had one). Exact lineage/three hashes/64-line source/ten-file delta/four CI lines/six ledger copies and all293 pins are confirmed. Independent top-verdict, raw-reasons and non-recorded-comparison mutants die. Shallow-copy fields, raw boot bracket, second/raw first sweep and dropping the verified-digest tie survive as equivalents under the preconditions; no extra kills are claimed. Review saw five of eight CI green at12:23UTC.
The three D228 sections are identical across six source ledgers; the earlier
local note's six-block phrasing means six ledger copies, not six distinct sections.
Local final20/7.981s/one native skip and28 intended kills, and the separate
248/35.246s/one native skip retain their actual run counts. First20 failed only
because the test helper treated explicit None as its valid default; direct-call
control corrected that test, not the source. Intermediate20/5.339s and final
provenance exception-to-assertion control remain historical, not relabelled.

Optional295 clarification: observation_sha256 binds the forced object received
by the wrapper, not the original file bytes. The private file is canonical;
source/sample-label forcing changes that object before hashing. main catches
only envelope.ERRORS as the existing convention; a broader catch surviving
the suite remains an optional control, not a new claim or silently closed gap.

Only B5-D62-managed-job-negative-observation closes as an owned source prerequisite.
The64-line wrapper validates before hashing or comparison, fingerprints the exact
received object, copies recomputed binding/provenance/budget/boot facts, and gates
non-recorded observations with recomputed reasons and negative null. Recorded
passes its first sweep verbatim to the unchanged comparator. Nested result and
its literal scripted scope/source remain untouched; only its exact negative
consistency success yields top managed-jobs-negative-consistent. Loaded idle
and running facts refuse. All hold/history/admission flags remain false.
No raw argv/job values/policy are emitted, and no input mutation or IO occurs
in comparison. Sweep_b/raw-input substitution is equivalent for recorded facts;
missing/extra/unknown buckets are already excluded upstream, not new kills.

The consumer requires both flags before IO, reuses exactly one owned_records
with coherent pins/one reader/frozen verifier/every recorded-owner tie, then
private canonical bounded managed-jobs.json with a textually identical forcing
block. No CLI collector reference; file claims stay untrusted sample labels and
source scripted. The declared live-route mutant needs gate relaxation plus
collector wiring and dies at the fixture-only CLI control with benign census;
no ERROR-only kill is counted. No local unpatched managed-label scan occurred.
The native CI guard remains convention, not environment attestation.

Success means only validated supplied facts were unloaded at the sampled
moments under the existing30min acceptance window, two sweeps and one boot
bracket. It rereads no current clock/boot, does not compare baseline boot, and
adds no freshness/continuous/coherent process-job window, process absence,
disabled override, complete inventory, freshD60, live hold, eligibility/history/
authorship/physical exclusion or admission guarantee. The observer budget
cannot interrupt blocked calls. D189 and unprotected provenance still apply.
Optional loaded_keys omitted; earlier optional controls remain carried.

All existing executables/tests/mutators stay fixed. The source delta is three
new files, four workflow lines and six ledgers; this separate receipt changes
five Markdown records only, leaving AUDIT_PRE and all source/proof/workflow bytes
fixed. Local lint14PASS/1old idle-version WARN/0FAIL; export's old two missing
automation/history failures stay distinct. B5/1.2 open/v1.2-pre,B6–B9 held.
Overrides/freshD60, full held/process integration, durable admission/manual/D175,
Mac designation/APFS/reboot/four-history acceptance remain later. D64/Gate/
installed timers/production remain untouched. Receipt exact-head review and
its own all8 CI are pending at commit time; no production operation or release.


### 2026-10-18 09:36 EDT — scripted entrypoint consistency pre-audit candidate (D230)

Micro re-orient: B5/1.2 open/v1.2-pre, B6–B9 held.
D229 receipt7cdd3ba8/source665ccdb4 have all8 CI39129315402/39126847156
and clear299/295 reviews; Claude301 acknowledges the evidence split.
Fixed managed-job negatives are connected to validated observations; inventory,
overrides and exclusion facts are not yet compared on the new diagnostic path.
This atom targets scripted entrypoint consistency, not fresh observation.

Goal: one scripted entrypoint consistency result against the frozen checkpoint.
Needs: reviewed green D229; unchanged inventory/exclusion validators, frozen
reader and honest fixture construction, full terminal CAPTURE facts; B1/D189.
All source prerequisites exist at7cdd3ba8. A nonempty exclusion must be recorded
through the honest fixture before its baseline, never injected after verification.
Feeds: separately reviewed current entrypoint observer/overrides/freshD60
measurement, full held/process integration, durable admission/manual/D175.
Verify: portable real frozen-reader positives/negatives and decisive named
assertion mutants; scripted native-CI portability only, exact source review/all8
CI plus separate reviewed green five-Markdown receipt. Runtime: no production.

Pre-audit request302 pending. Proposed surface: new scripted_entrypoint_consistency
module/test/runner, four workflow registration lines and six source ledgers.
No existing executable/test/mutator, Journal/schema/recover/D64/Gate/identity/
host/timer change. VERSION stays pre because the enclosing live gates remain.

Read-only source audit: valid_entrypoint_inventory binds baseline loaded and
disabled flags, so original prior cannot validate held current facts. Proposed
private expectation adapter copies baseline prior, replacing loaded/running/
disabled from already-verified terminal observations, then calls that unchanged
validator. No adapter is persisted or treated as a journal/baseline; its exact
role and soundness await302. Compare installed/roots/disabled artifacts to
baseline, loaded/overrides to terminal CAPTURE, all domains/all labels.

Proposed exact supplied input is boot/inventory. D60 current shape uses unchanged
valid_tailscale_exclusion; label set plus plist/wrapper identity equals baseline,
current excluded boot equals the supplied boot. Old dynamic app/run/boot facts
are not compared across boot. No live code/signature/launchd verification or
new age/freshness claim follows a shaped file. Empty exclusions must match
baseline emptiness. All source/hold/history/admission/freshness flags remain
fixed scripted/false. Hash only the exact supplied value after validation,
report binding/reasons without raw inventory/policy/argv.

Consumer proposal: fixture AND scripted before IO, one managed.owned_records
with coherent pins/one reader/frozen verifier/all recorded-owner ties, then
private canonical bounded entrypoints.json and pure comparison. No collector
reference, constructor or write. No local unpatched inventory/job scan.
Current observer timing/boot-coherence and privileged readability remain later,
not inherited from job30min or process120s envelopes. D189/unprotected provenance
still applies. Physical Mac/APFS/reboot/four-history gates remain separate.
Optional older controls remain carried, not silently closed. If adapter/fixture
proof is unsound or scope spans outcomes, split before source work.


### D230 pre-audit settled — Claude303, before implementation

The atom and private terminal-state adapter are sound. valid_entrypoint_inventory
uses prior only for installed plist digests, loaded-set expectation and disabled
override rules; copy only terminal loaded/running/disabled into a private copy.
Never persist it, call it a baseline or pass it to valid_prior. Exact terminal
override equality is additional to the shared true/not-true predicate and rests
on the stated premise that launchd's override database persists across reboot.
A previously unloaded/non-disabled RunAtLoad job starting at login must refuse,
correctly; this unit adds no permitted-start exception.

Decision: app drift refuses. Compare the full per-label app identity as well as
plist and wrapper to baseline; a Tailscale update requires a separately reviewed
new baseline. This conservative owned-comparator choice is made before source
work, not a production re-baseline operation. The proposed app-drift positive
is dropped before implementation. Only validated launchd dynamics (e.g. run
count) and boot may differ; current excluded boot must equal supplied boot.
Equal label sets are mandatory both empty/nonempty ways. A nonempty passing
input asserts not-running, runs>=1, exit0, disabledfalse in that supplied boot.
Those are supplied shaped claims, not observed/authenticated fresh D60 proof.

Order: exact outer schema/boot digest, explicit valid_tailscale_exclusion, then
unchanged valid_entrypoint_inventory over the private adapter, then fingerprint
exact received value, then compare. verifiedtrue is only a shape claim. Report
fixed scripted source, frozen baseline/checkpoint/recordedUID binding and named
field reasons without any raw inventory/overrides/exclusion/paths/policy/argv.
Hold/history/admission/freshness flags false. Consumer both flags before IO,
one owned_records, private canonical bounded file, no collector/constructor/
write. CI scripted portability only, no new native or local unpatched scan.

The pre-screen already proves the nonempty fixture viable: patch only guest
full_entrypoint_evidence to carry tailscale_record and a disabled-artifact hash
before original Journal creation; real capture/commit/stopped reader/frozen
verification succeeds through owned_records.23 managed labels/1 excluded label,
all3 loaded sets empty; private terminal adapter passes the shared validator.
No post-verification record mutation, real Tailscale/file signature measurement
or production operation. Temporary owned probe was cleaned.

Count only decisive named assertions with intact controls, never ERROR-only
kills. Loaded equality and installed digest comparison are dominated by shared
validation; running substitution is unused there. Copying the exact input before
hashing is equivalent because these validators do not normalize it; hashing
only inventory (omitting supplied boot) is the discriminating hash variant.
Copying terminal identity is also equivalent because frozen verification already
binds it; arbitrary fourth-field identity corruption must be detected, not
claimed as a permissive defect. Optional drift-only reporting is not adopted;
all mismatches refuse. Earlier optional controls remain carried.

D230 row stays candidate until source exact review/all8 CI and the separately
reviewed green five-Markdown receipt. B5/1.2 open/pre,B6–B9 held,D64/Gate/
installed timers/production untouched. Actual current inventory/override/D60
observer, full held/process integration, durable admission/manual/D175 and
physical Mac/APFS/reboot/four-history evidence remain later.


### 2026-10-18 09:49 EDT — D230 local scripted entrypoint candidate proof

The new80-line module shape-validates boot/inventory, explicitly validates D60
shape, calls unchanged valid_entrypoint_inventory over the private terminal
expectations, then hashes exact supplied input and compares. Installed paths,
roots and disabled artifacts match baseline; loaded/overrides match terminal
CAPTURE exactly; excluded label sets match and plist/wrapper/full app identity
match baseline. Current exclusion boot equals supplied boot. Changed valid run
counts/boot may pass; app SHA/version/cdhash drift refuses. Full maps preserve
none versus false and extra com.openclaw override keys in every domain.
No inventory/path/override/exclusion table/policy/argv is echoed. Fixed scripted
source, frozen digest/recordedUID binding and all four certification flags false.

Local final28 tests pass8.394s/no skip;39 named intended-assertion mutations
pass with intact selected controls/no ERROR-only kills. Earlier268 regressions
pass53.089s/two intentional CI-only native skips on this Mac. New native CI
coverage is scripted portability only, not live collection or fresh D60.
The honest nonempty exclusion/artifact fixture records them before original
Journal creation and reaches the actual capture/commit/stopped reader/frozen
verification path. Empty/nonempty and both policy cases work. The honest foreign
recorded-owner chain verifies as a frozen input for the pure binding control,
while the real owned consumer correctly refuses its reader UID mismatch.

## Mid-Implementation Findings — D230 fixture precondition

One fixture assumption in303 cannot occur under this head's full-node contract.
All prior-unloaded units are disabled: member1 held and federation tick required
disabled; known-broken Discord must be loaded, not disabled. First27-test run
errors8.777s with StopIteration searching for an unloaded enabled unit. The next
28-test run errors9.095s when a pre-baseline attempt to make Discord unloaded
is correctly refused by unchanged valid_prior. No bypass, rehashed invalid
fixture or post-verification record mutation is used. Replace that impossible
example with every managed-label start in all3 domains refusing against honest
frozen records. This is one precondition finding/two failed proof attempts, not
two source defects or scope expansions. The80-line source never changed.

The first39-kill run had intact selected controls but excluded the then-invalid
example; it was not evidence of a passing28-test suite. After fixture correction
the final full28 and a fresh39-kill runner pass on the same test bytes. Both
runs retain their actual counts.303's generic RunAtLoad forecast is qualified:
a future broadened baseline may allow it, but the current frozen precondition
does not. No new allowed-start exemption is added.

The terminal adapter preserves all other baseline fields and input immutability;
its identity-corruption variant is a contract/false-refusal control, not a claimed
permissive defect. Explicit exclusion removal/reversal pins call order; the later
inventory validator already repeats exclusion shape checking. Installed digest,
static exclusion path constraints and terminal loaded equality are dominated
shared proof, not extra single-predicate acceptance kills. Running substitution,
copying the full input before hashing and terminal identity substitution are
equivalents, not counted. Full-input hash versus inventory-only is discriminating.
The live-CLI variant explicitly relaxes flags AND wires a benign patched inventory
collector; fixture-only CLI refusal/zero calls kills it. No real CLI collector
reference, constructor, write or local unpatched inventory/job scan exists.

Promised deltas land: three new files, four workflow lines and six ledgers. All
pre-existing executable/test/runner bytes remain fixed. Pin/read/frozen verifier
and every recorded-owner tie are reused once before private canonical bounded
entrypoints.json and comparison. Input/capture/owner/flags/no-constructor/no-write/
CLI controls pass. Local lint14PASS/1old idle-version WARN/0FAIL. No Phase-8
patch or source scope expansion. Optional older controls remain carried.

Source exact review/all8 CI are pending, then separate five-Markdown reviewed
green receipt before this owned row closes. Exact override equality assumes
launchd override persistence across reboot; no live measurement certifies it.
Nonempty success supplies a completed successful run claim in the supplied boot,
without observing/authenticating it. verifiedtrue is shape only; no fresh D60,
current clock/boot read, process absence, live hold, eligibility/history/
authorship/physical exclusion/admission or protected provenance. D189 applies.
B5/1.2 open/v1.2-pre,B6–B9 held; D64/Gate/installed timers/production unchanged.
Actual inventory/override/D60 observer, full held/process integration, durable
admission/manual/D175/Mac/APFS/reboot/four-history evidence remain later.


### 2026-10-18 10:22 EDT — owned scripted entrypoint consistency source verified (D231)

Source 0aa1df7d78b1dc0d02a15d7a4e7cc4fd18f5f4c4 resolves all eight distinct latest job results successfully
in [CI39133265637](https://github.com/moltyguibros-design/openclaw-node/actions/runs/39133265637)
(attempt2). Native execution117692584475/attempt1
(carried as API job117697503389/attempt2):28 tests in
1.756s/no skip and39 intended-assertion kills/intact controls. Linux22
job 117697502335,attempt2:28/1.689s/no skip/39. These are scripted
frozen-reader portability checks, not new live inventory/override/D60 observations.
Older process/managed-job native lines retain their own prior-unit scope. Codex
inspected completed raw logs: native83783 bytes SHA256
f594827f8c4ed4171e022b8a7d0e9f7ba34403216ac2416df6a0e399c26e2032; Linux1533703 bytes SHA256
742b2441798bd0c9f066c4c57903396388f7ead9a192aa0b9b7706c3b31d4160. Both name mergec6b2e68c8ff6462cbaae986e631f89d9e20c0641
with source as second parent and identical whole tree. These completed-CI facts
are Codex observations, separate from the review and its CI status at that time.

Attempt1 Linux job117692584463 failed at unchanged cluster-offline-consumer-
placeholder, NATS10005 peer-offline placement, before any Python execution. Its
completed raw43966 bytes SHA2567fa9cdfd2ac9b4dfe9b29b2395e4f28a61738c2b1fb6f2693d467b6570f6af2b
remain failed evidence, not relabelled. Existing test_recovery/recovery bytes
are identical to parent. One unmodified local owned fixture control using the
same NATS2.12.6/CLI0.3.1 passed at2026-10-18T13:55:16.292Z; all owned processes exited and
cleanup failures empty. Its raw6375 bytes SHA256
067b6da0a7a31d624d0d98a30daa267cc2aca5b271c83ef466996876129caa36. This Mac/Node24 control is not a Linux reproduction or
root-cause closure. B5-CI-R3-placement remains a separate follow-up; no fixture/
readiness/timeout repair or production operation is included here. An initial
job-rerun request while attempt1 was active was rejected, scheduling nothing.
After attempt1 completed, exactly one targeted Linux22 rerun was scheduled on unchanged source bytes. GitHub lists the other seven carried successes under new attempt2 job IDs but with identical original runner/start/completion timestamps. Native is carried from execution job117692584475/attempt1 into reported job117697503389/attempt2, not a second native execution; matching raw bytes are checked. Only Linux executes anew in attempt2. No additional rerun or all-attempt1-green claim is made. All-green exact-head readiness was not waived.

Claude307 independently clears the exact source with no remaining required
finding. A full-tree uid65534 Linux replay independently reproduces28/no skips and39 intended assertion kills/intact controls. Exact sole parent/10files1681insertions/three hashes/80-line source/4workflowlines/unchanged prior blobs and identical D230 content across six ledgers are confirmed. Its broader workflow extraction passed23 prior unittest files, while two NATS-dependent files errored from missing sandbox server/environment; these are not source defects or a claimed268-test replay.11 prior mutation runners ended on their final kill lines with no failure signature. The separate local268/53.089s/two skips remains Codex proof. It verifies honest47-record nonempty exclusion/extra override chain,21gui/21user override flips, empty terminal loaded sets and exact frozen readback. Own probes confirm purity, comparison coverage and declared equivalents; the running-field contract kill is not an extra acceptance kill. Explicit exclusion call is an order pin with current shape revalidated inside the inventory validator; terminal overrides are chain-verified. Ordered roots and managed-jobs fixture prefix are accepted. It independently reads the complete480-line failed Linux log/BOM/no truncation, confirms no Python ran and unchanged test_recovery blob/parent plus six earlier runs passed. It establishes no root cause and saw six green/one Linux failure/native pending; no all8 claim at review time. The same307 response later adds a terminal attempt1 CI addendum: seven success/one Linux failure, hence no all8 at that time. It independently reads the complete995-line native log/BOM/no truncation and checks703/705/706/707–745:28/1.756s/OK/39 kills,43 OK blocks and no FAILED or runner error. That reproduces the native scripted portability result only; completed attempt2 all8 evidence is later Codex observation.
The three appended D230 segments include the internal Mid-Implementation
Findings heading, which accounts for the review’s four Markdown-block count.
Local final28/8.394s/no skip and39 intended kills remain separate from the prior
268/53.089s/two local CI-only native skips. First27/8.777s StopIteration and next
28/9.095s valid_prior refusal are preserved as two failed proof attempts at one
fixture precondition, not source defects. Full-node valid_prior admits no prior-
unloaded enabled unit at this head. The impossible303 hypothetical was replaced
with every managed start in all3 domains refusing against honest frozen records;
no invalid baseline, bypass or post-verification record mutation. The80-line
source never changed. First39 selected controls passed while that example was
invalid; only the final28 plus fresh39 runner prove the corrected exact bytes.

Only B5-D62-scripted-entrypoint-consistency closes as an owned source prerequisite.
A private copy preserves baseline identities while substituting terminal loaded/
running/disabled expectations; never persisted, called a baseline or passed to
valid_prior. Explicit exclusion validation then unchanged inventory validation
precede exact-input hashing/comparison. Static installed paths/roots/artifacts
match baseline; loaded/overrides match terminal CAPTURE exactly. Exact overrides
include every domain/key and none-versus-false, assuming persistence across reboot.
Exclusion label sets and plist/wrapper/full app identity match baseline; app drift
refuses and needs a separately reviewed baseline. Current excluded boot equals
supplied boot; valid run-count/boot dynamics may differ from baseline.

The honest nonempty exclusion/artifact and extra-override fixture records them
before original Journal creation through the real capture/commit/stopped reader/
frozen verifier. Both policy/exclusion cases pass. Consumer both flags before IO,
one reused owned_records with coherent pins/reader/verifier/all recorded-owner
ties, then private canonical bounded entrypoints.json. No collector reference,
constructor/write or local unpatched inventory/job scan. Pure comparison has no
IO/current clock/boot read or input mutation. Source fixed scripted; frozen
digest/recordedUID binding and named reasons only, no raw inventory/path/override/
exclusion/policy/argv. Hold/history/admission/freshness flags false.

A nonempty consistent input asserts a completed successful run in the supplied
boot but does not observe/authenticate it: verifiedtrue is shape only, no fresh
D60, actual inventory/override completeness, process absence, live hold, eligibility,
history/authorship, physical exclusion/admission or protected provenance. D189
still applies. Loaded equality, installed digest and fixed exclusion paths are
dominated shared proof; explicit exclusion removal/reversal pins ordering only.
Identity corruption is a contract/false-refusal control, not a permissive defect.
Running/copy-before-hash/terminal-identity variants remain equivalents, not extra
kills. The live-route mutant explicitly relaxes flags plus wires a benign patched
collector; no ERROR-only kill is counted. Prior optional controls remain carried.

All pre-existing executables/tests/runners stay fixed. Source delta:3 new files,
4workflowlines,6ledgers. This receipt changes5Markdown only, keeping AUDIT_PRE
and all code/proof/workflow fixed. Local lint14PASS/1old idle-versionWARN/0FAIL;
export's old missing automation/history failures remain separate. B5/1.2 open/
v1.2-pre,B6–B9 held,D64/Gate/installed timers/production untouched. Actual current
entrypoint/override/D60 observer, full held/process integration, durable admission/
manual/D175 and Mac/APFS/reboot/four-history evidence remain later. Receipt exact-
head review and its own all8 CI are pending at commit time; no operation/release.


### 2026-10-18 11:02 EDT — shared entrypoint whole-value scope pre-audit (D232)

Micro re-orient: B5/1.2 open/v1.2-pre; B6–B9 held.
D231 receipt60992e9e/source0aa1df7d are reviewed clear311/307 and
all8CI39135740710/39133265637;313 acknowledges the temporal evidence split.
Scripted consistency is available; current inventory observation is still open.
Its pre-screen finds the shared classifier can silently omit a relevant job.
Fix that bounded prerequisite before designing the observer envelope.

Goal: classify a whole path containing tokenizer delimiters before token scanning.
Needs: unchanged shared installed/loaded callers and classification contract,
owned symlink/hardlink/plist fixtures, reviewed green D231; all exist at60992e9e.
Feeds: existing installed_entrypoints/loaded_entrypoints/capture_entrypoint_inventory,
then the separate current inventory/override/D60 observer.
Verify: portable real owned-path and caller controls/intended-assertion mutants,
prior preservation/process/job/comparator regressions, native CI owned-path
portability, exact source review/all8CI plus separate reviewed green five-Markdown
receipt. Runtime: no unpatched production inventory/job scan or service action.

Pre-screen uses an owned canonical temporary root, neutral label org.fixture.neutral
and a binary under a protected directory. Program/argv is an outside symlink:
without space shared relevant=True and installed_labels contains the neutral label;
with space both shared relevance and unclassified_executable are False and installed
labels empty, although alias.resolve() has the protected root in its parents.
This reproduces a permissive omission inherited by the prospective observer,
not a defect in D230's supplied-value comparator. D216 corrected whole values in
process scope only and explicitly left this shared API unchanged. The first
noncanonical /var temporary-path probe did not establish containment on this Mac;
only the resolved-root rerun above is evidence. No production path was scanned.

Proposed delta: only relevant_entrypoint resolves each entire expanded absolute
or cwd-relative value with strict=False and the same equal-or-parents predicate
before retaining its existing substring/token scan. Preserve label prefixes,
HOME/environment expansion, source/application/system hardlink rules, embedded
flags/shell scans and nonpath negatives. Whole-value hardlink attribution should
use the same existing suspicious_hardlink rule, never a new exemption. No changes
to installed/loaded collectors, validators, Journal/schema/recover/D64/Gate/host/
identity/timers, or the already-reviewed process shim. Pre-audit314 pending;
settle exact whole-value and relative-path semantics before implementation.

Proof plan: spaces, parentheses, both quotes, semicolon/comma/pipe/ampersand/backtick,
absolute and cwd-relative aliases, equality and parent roots, expanded environment,
whole argument hardlinks, embedded-token fallback, managed prefixes, benign paths,
and actual installed/loaded callers refusing extras through shared inventory
verification. Owned filesystem inputs only; no native launchd mutation or global
scan. New test_entrypoint_path_scope.py and mutate_entrypoint_path_scope.py; four
workflow registration lines plus six source ledgers. Existing executable delta is
restricted to the one shared classifier; existing tests/runners remain fixed.

This corrects one membership false negative; it is not complete physical writer
coverage or fresh observation, process absence, execution hold, eligibility,
protected provenance, history/authorship or admission. All observer timing/boot/
recordedUID/native full-path measurement remains later. Prior optional controls
and the R3 placement follow-up remain open. B5/1.2 open/pre; D64/Gate/installed
timers/production untouched, four histories separate.


### 2026-10-18 11:13 EDT — D232 settled pre-audit and local path-scope proof

Claude315 independently reproduces the shared omission at60992e9e as uid65534
through the helper and both callers; the atom is the smallest useful correction.
Settled semantics, before source implementation: whole expanded absolute paths
or slash-relative paths joined to expanded supplied cwd; bare names are never
joined and no process cwd is inferred. strict=False intentionally includes
dangling aliases resolving into a protected root. Root matching is exact equality
or parent containment, never substring on the resolved value. Reuse existing
hardlink suspicion with both System-source and application-path exemptions.
Keep existing raw substring and token scans, prefix shortcut and expansion.
The D216 process shim retains its broader bare-name join unchanged.

Nine added lines in relevant_entrypoint implement exactly that rule. No other
existing executable changed; callers/validators/process shim/Journal/schema/
recover/D64/Gate/identity/host/timers remain fixed. A real future baseline may
newly refuse a neutral job reaching protected roots through a delimiter alias;
that is the intended rejection of extras, not a production observation here.
The existing installed/loaded callers reach the corrected shared helper now;
no parallel classifier or prospective observer envelope is introduced.

New test_entrypoint_path_scope.py has21 passing controls,0.155s/no skip on this
Mac. New runner kills17 named mutants by intended assertions with intact
selected controls and no ERROR-only kills. All twelve absolute delimiter
subcases fail on the parent helper with0errors. Whole-value-after-token order
passes all21 and is declared equivalent, not counted. Mutants include whole-step
omission/unresolved value/equality-only/parents-only/resolved substring/strict
existence/bare-name or implicit process-cwd joins/no relative join/no expansion/
hardlink removal or either exemption loss and fallback/prefix losses.

Owned real symlinks and hardlinks exercise exact-file and parent roots, all
tokenizer delimiters plus tab/newline, relative cwd/environment/home expansion,
dangling targets and prefix siblings. Real installed caller uses owned plists;
loaded caller uses supplied launchd text/inspect stub with subprocess blocked.
Program/argv/cwd and loaded environment values reach the whole rule. The installed
caller expands referenced environment variables; it does not scan unused
environment values, which remains unchanged. Both discovered extra-label sets
refuse through unchanged inventory verification as controls, not extra kills.
No new native launchd call or unpatched inventory scan is performed locally.
Native new-unit CI is real owned filesystem portability only.

Declared limits: an embedded --flag= delimiter alias stays token-only/False;
slash-relative without cwd staysFalse; nonstring values skipped; over-NAME_MAX
values do not raise. The pre-existing raw substring rule may over-include raw
prefix siblings, while a delimiter alias resolving to a prefix sibling correctly
staysFalse. Supplied roots are resolved and home is explicit/owned. Newline is
covered directly and through plist parsing, but the existing loaded text parser
loses embedded newlines and that caller's delimiter matrix excludes newline.
No full classification/completeness, physical writer or fresh D60 claim follows.
Optional later removal of the now partially redundant process shim is carried,
not implemented. Existing R3 placement and older optional controls stay open.

Prior Gates/process-policy/envelope/class/job/entrypoint regressions:311 pass
45.650s with two intentional CI-only unpatched native skips; no failed control.
All pre-existing tests/runners are fixed. Delta: one existing function, two new
proof files, four workflow registration lines and six ledgers. One workflow edit
invocation initially used the step directory and found no relative workflow
path; it changed nothing, then was applied from checkout root. No source repair
or proof-failure claim follows that invocation.

D231 receipt60992e9e independently clear311/source clear307 with all8 ownCI
39135740710; source CI39133265637 resolves attempt2 with only Linux re-executed
and the seven original successes carried, not relabelled new executions. Its
original placement failure and local-control limits remain.313 acknowledges
the evidence split. This D232 candidate needs exact source review/all8CI and
then a separate reviewed green five-Markdown D233 receipt before row closure.
B5/1.2 open/v1.2-pre,B6–B9 held. Current observer/override/freshD60, full held/
process integration, durable admission/manual/D175 and Mac/APFS/reboot/four-history
evidence remain later. D189 applies; production and installed timers untouched.


## Mid-Implementation Findings — D232 process mutation redundancy

One required proof interaction was exposed by exact source488ad0cf's Linux CI
39139556698/job117710977048: the existing process runner's first mutant no
longer fails because the new shared helper rescues the removed process-shim
parent check. New21/17 was not reached in that job. Raw failed log83687bytes
SHA2560a2d6f07d9565620ed039befbef4a107f12d9f59d03894a83d38a42be2c8f7a8
is retained; no rerun or all8 claim. This is not the old R3 placement failure.

Fresh local audit of all29 prior mutants finds27 intended assertion kills,
exactly two surviving variants and0invalid/error results. Those are whole-
argument-directory-root-skipped and whole-argument-path-skipped. Each also
passes the full40 process tests (0.832s and0.198s, no skip locally). The two
previous single-site kill claims are no longer independent with the shared
whole-value rule; historical D21729-kill evidence at its old head stays true.

Re-orient before correction: retain the production process shim and every
existing assertion, keep the new21/17 proof fixed, and revise only the old
mutation runner to classify these two as explicit expected-pass redundant-
branch controls, never kills. Count27 remaining old process kills separately;
no manufactured two-site variant or silently retained29 claim. This is a
necessary proof-only exception to the earlier old-runners-fixed promise,
not observer or production scope expansion. Claude318 assessment pending.
New source head after this narrow proof/ledger correction must obtain fresh
exact review/all8 CI before the separate D233 receipt. Original failure is
retained. Current observer, B5/1.2 and physical gates remain open; production,
D64/Gate/installed timers unchanged.


### D232 proof re-orient settled — Claude319, before corrected head

Micro re-orient: one shared classification outcome, nine runtime lines unchanged.
CI failed a redundant old proof claim;319 confirms the structural rescue.
319 also requires a real-cwd control for the natural absolute-gate mutant.
Both are proof-only corrections within the same narrow outcome, settled before
the corrected commit; no observer or new runtime outcome is added.
B5/1.2 open/pre; physical and production gates stay held.

319 independently reproduces21new controls/17kills as uid65534 and all315
path/caller probes. Parent replay gives34failures/0errors across the full new
suite, including12absolute and12relative subcases; Codex's selected-parent
12absolute failures remains narrower separate evidence. It verifies all29old
variants:27kills/2survivors/0errors; both survivors pass40process tests and
fail again with the parent shared helper (18/36failures). Executable/cwd rows
are validated absolute, and every relative argument is appended cwd-joined
before the shared fallback, so all shim candidates reach the new shared rule.

Necessary exception: mutate_scoped_process_diagnostic retains the two exact
replacements as expected-pass selected-test controls. Its unmutated controls
still include them, all existing assertions and production shim remain fixed.
It now reports27intended process kills plus2redundant-branch passes, not29kills.
New shared-helper mutations remain separately counted. Local full-module passes
for each redundant variant are40/0.832s and40/0.198s; CI expected-pass checks
use the selected delimiter test, avoiding extra unpatched native census runs.
Historical D21729-kill proof remains attributed to its original source.

319's second required proof correction: replacing the absolute gate byTrue
survives the original21 tests because Path.resolve uses actual cwd, not the
mocked Path.cwd. The same existing test now changes into an owned real cwd and
registers restoration before temporary cleanup; the natural mutant fails its
intended assertion. This is false in-scope classification (and possible false
refusal downstream), not an admission bypass in the committed source. The
optional raw-versus-expanded slash control is also adopted inside the existing
relative test; its natural variant now dies independently. Test count stays21.

Corrected local proof:21controls0.064s/no skip;19new intended-assertion kills
with intact selected controls/noERROR; old runner27kills plus2expected-pass
controls. Nine-line helper and every other runtime executable remain byte-
identical to488ad0cf. The earlier311regressions45.650s/two CI-only native skips
remain valid at those unchanged runtime bytes and are not relabelled a new run.
Whole-after-token order is an equivalent, not counted. Passing a resolved path
to the hardlink helper survives these controls and is not counted; no universal
claim is made about spelling-dependent application exemptions. No shim cleanup.

319 reproduces the complete failed Linux943-line log and its Codex byte count/
digest, confirming Python ran and the first old mutant survived15commands
before the new unit. This initial CI is not green; no retry of it is requested.
Its prior-regression replay was34of40 with missing sandbox NATS and the old
mutator exits when reported, not a claimed311replay. The corrected head needs
its own exact review/full CI; only then D233. D64/Gate/timers/production fixed.


### 2026-10-18 12:14 EDT — owned shared entrypoint path scope verified (D233)

Source4abd636045d074a5d80f5696defc3f972579bfc6 passes all eight distinct latest job results in
[CI39140772095](https://github.com/moltyguibros-design/openclaw-node/actions/runs/39140772095)
attempt2. Native execution117714562189/attempt1
(reported API117722261899/attempt2):21tests/0.073s/no skip/19 intended
assertion kills/intact controls. Linux22 job117722224612:21/0.049s/no skip/19.
Codex inspected completed full raw logs: native85970bytes SHA256
ea0e428e0d6b8de982161641c4517510fad591be8c2140d52e2394c4a0da7d4a; Linux1535966bytes SHA256
2426f7801e2c8c796850dbdbd1f31d3fec5bb19c6e8e25642d748bf005408d94. Both logs name merge3963b71bd73e1ebb534502ca83bdda2669192fac,
source as second parent and identical whole tree. New native proof is owned
filesystem/caller portability, never live inventory/override/D60 or launchd
measurement. Older native lines retain their own scopes.

Claude321 independently clears exact source/proof. Independent321 confirms sole parent488ad0cf then60992e9e and nine-file/521insertions/5deletions proof-only correction. Nine runtime lines, workflow, process shim and existing assertions are fixed. As uid65534 it reproduces21new tests,19 intended kills/intact controls, old27kills plus2explicit redundant-branch passes, and an audit with27kills/0survivors/0errors. Natural absolute-gate and raw-slash variants now die; resolved-path hardlink variant is not counted. It confirms LIFO real-cwd restoration, exact retained replacements, six-ledger blocks and honest failure/history attribution. Its initial488 prior replay finally completes40scripts:37exit0,3exit1 comprising two unavailable sandbox NATS binaries and the old uncorrected process runner; the corrected runner now passes. This is separate from local311regressions. CI was in progress with five early successes when321 read it; completed CI observations are later Codex evidence.
Completed CI evidence remains attributed to Codex wherever the review did not
reach it. Local21/0.064s/no skip and19kills are distinct from prior311/45.650s/
two intentional CI-only native skips. Parent classifier fails all12 absolute
delimiter subcases without errors. Whole-after-token ordering passes21 and
remains an equivalent, not an extra kill. Inventory-extra refusal is a shared
validator control, not an extra kill; every counted mutant dies by its named
assertion with intact selected controls and no ERROR-only kill.

Only B5-D62-entrypoint-whole-value-scope closes as an owned source prerequisite.
The existing shared helper gains nine lines resolving each entire expanded
absolute or slash-relative-with-supplied-cwd value with strict=False and exact
equality/parent containment, then existing suspicious_hardlink with original
source/label. Bare names never join cwd; process cwd is never inferred. Both
hardlink exemptions remain. Existing prefix, raw substring, token fallback and
environment/home expansion stay fixed. Dangling aliases into roots are relevant.
A neutral real job reaching protected roots through delimiter aliases may newly
refuse future baseline validation; that stricter membership is intended. Existing
installed/loaded callers consume the helper; no parallel classifier or observer
is added. The sole existing proof-runner exception retires two rescued process single-site
kill claims into explicit expected-pass controls;27 intended process kills plus
2redundant-branch passes are counted separately. Production process shim/all
existing assertions remain fixed; all other pre-existing bodies stay fixed.

Owned controls cover file/parent roots, delimiters/tab/newline, relative paths,
working directories, home/environment, hardlinks and exemptions, prefix siblings
and harmless/long/nonstring values. Callers use owned plists, supplied launchd
text/inspect and blocked subprocess calls. Installed environment references
expand; unused environment values are not scanned there. Loaded environment
values are scanned. Newline works direct/plist; existing loaded parser cannot
represent embedded newlines. Embedded --flag= delimiter aliases stay token-only
negative; raw substring over-includes raw prefix siblings. The process shim's
broader bare-name join remains fixed; its possible partial-redundancy cleanup
is carried, not performed. No full membership, physical writer or provenance
coverage follows. Initial488ad0cf CI39139556698 failed in the old runner before the new unit.
Its complete Linux943-line/83687byte log SHA256
0a2d6f07d9565620ed039befbef4a107f12d9f59d03894a83d38a42be2c8f7a8
remains failed evidence; no retry or relabelled21/19. Initial native117710976978
also failed the same old mutant before the new unit: raw33125bytes SHA256
5ad7d023fe838a4115aafdf21726da529eda1294d05b0a2cf889d461a29f1831.
Neither initial-platform result is green.319 accepted the narrow
proof re-orient; both redundant variants pass40process tests and are rescued
only by the new shared helper. Its second required proof correction replaces
a Path.cwd mock with actual owned cwd/restoration and kills the natural
absolute-gate variant. Expanded-only slash control is also adopted. Source
nine lines/workflow/production shim remain fixed through4abd6360. Historical
D21729kill proof stays true at its old head; current runner reports27plus2.
Corrected-source attempt1 Linux117714562096 passed21/0.051s/no skip/19
and the old27plus2, then the unchanged test_preservation_cluster failed its
stream-add with peer-offline placement. Full raw116841bytes SHA256
eb06b364fed34425d4412c7cb72ffdba7ac54ef12f1fb027fc5ee2326cb9a557 remain failed evidence; cleanupFailures empty.
One unmodified owned Mac control with NATS2.12.6/Node24.13.0 passed3.275s with
all own cleanup checks; raw342bytes SHA256074f3effbafc7aab67bf43e751d1445930462fa9b8e88ad8ee3a01684baddde3.
That is not a Linux reproduction or root-cause closure. No readiness/timeout/
fixture repair is included. After terminal attempt1 failure, exactly one targeted Linux rerun was scheduled on unchanged4abd6360. The other seven successes are carried under new API attempt2 IDs with identical original runner/start/end metadata; the native raw log is checked by byte identity, never called a second execution. No further retry or all-attempt1-green claim. The earlier488 proof failure was corrected in a new commit, not rerun. The R3 follow-up remains open
and the exact-head all8 prerequisite was not waived.
First noncanonical /var prescreen and failed relative workflow
edit invocation are not used as evidence and changed no source.

This source changes one function, two new proof files, one necessary existing proof-runner exception,
four workflow lines and
six ledgers. This D233 receipt changes five Markdown only, leaving AUDIT_PRE and
all code/tests/runners/workflow fixed. Local lint14PASS/1old idle-versionWARN/
0FAIL; export's old missing ignored automation/history limitation stays separate.
Only source review/CI is closed at commit time; this receipt needs its own exact
review/all8CI. The R3 placement follow-up and earlier optional controls remain
open. Current inventory/override/freshD60 observer, full held/process integration,
durable admission/manual/D175 and Mac/APFS/reboot/four-history evidence remain
later. B5/1.2 open/v1.2-pre,B6–B9 held,D64/Gate/installed timers/production
untouched; no fresh D60, live hold, history/authorship, eligibility or admission.


### 2026-10-18 13:14 EDT — owned cluster group-readiness pre-audit (D234)

Micro re-orient: B5/1.2 open/v1.2-pre; B6–B9 held.
D233 receipt b0d55130/source4abd6360 have clear325/321 reviews and all8 CI.
Current inventory observation remains open; repeated owned fixture failures impede CI.
Split the two symptoms: fix group settling only; peer placement remains undiagnosed.
This unit makes the existing owned test wait for its existing acceptance requirements.
Still the right bounded prerequisite: yes; no production mechanism or admission.

Pre-screen: exact clean parent b0d55130; existing capture and owned three-server
fixture available; local NATS2.12.6/Node24.13.0 available. Retained receipt CI
39144200140 attempt1 Linux117724597070 fails the unchanged nonempty $G leader
assertion after stable-table settling, with cleanupFailures[]. The source loop
can finish with an unchanged but invalid table: stable groups alone do not imply
$SYS/$G presence, two account groups, or nonempty leaders. This source mismatch
is demonstrable with scripted captures; the retained CI log contains no table
and cannot prove which intermediate state caused its failure. No root-cause
claim for peer-offline placement or real NATS convergence follows.

Goal: one independently verifiable outcome: the existing owned replication
fixture cannot finish its settling loop until every sample meets the unchanged
post-loop requirements continuously for the existing one-second stable interval,
within the existing ten-second deadline. Missing/empty groups or empty leaders
reset stability, as do changed group tables. Preserve capture refusal behavior,
the exact final assertions, QuietWindow, real election and own-process cleanup.
Timeout retains the last full capture and raises an assertion; no wider timeout,
stream-create retry, monitor-parser change, production scan or operation.

Section6 file deltas: extract only the existing settle loop into a test-local
wait_for_groups(ports,root) function in test_preservation_cluster.py and call it
from the same place. New test_cluster_group_readiness.py scripts capture/time
without network, covering invalid-stable timeout, eventual valid convergence,
per-member failures, regression/reset, changing tables, capture refusal and
last-observation timeout evidence. New mutate_cluster_group_readiness.py requires
intact selected controls and named assertion failures, never ERROR-only kills.
Four registration lines in .github/workflows/test.yml run the new portable
suite/runner on Linux22 and native macOS. Existing real cluster remains its Linux
consumer; run it once locally against three own loopback servers with normal
cleanup. Six ledgers document candidate/proof and boundaries. All other existing
executable/test/runner bodies stay fixed. Only a source-ready owned prerequisite
may close after exact review/all8 CI and a separate reviewed green receipt;
B5/1.2 and placement follow-up remain open. VERSION remains v1.2-pre.

Risks: a valid table can regress while settling, so invalidate the clock rather
than accumulating disjoint ready samples. The table is sampled, not continuous
physical evidence. The test-local extraction must actually feed the real test;
prove call placement and leave final assertions byte-identical. Missing monitor
keys must be treated as not ready in the scripted predicate without weakening
capture's strict parser. Root timeout evidence is fixture-owned; no raw token
or config copied. No feature deployment/service restart applies to this test-only
unit; actual owned test execution plus CI is its runtime, not serving services.
D64/Gate/installed timers and production remain untouched; no retry-as-proof.


### D234 pre-audit settled — Claude329, before implementation

329 inspected exact b0d55130 without subagents and clears the atom with pins.
Adopt all four existing conditions per member and no agreement/extra readiness
rule; valid identical second sample starts the clock, invalid/change resets,
previous always advances. Preserve sample-then-check deadline semantics: a batch
started before10s may finish and succeed after10s; three unchanged capture calls
can overrun by about6s. This is a polling deadline, not a hard wall-clock bound.
Inject clock/sleep only on the test-local helper; real call passes neither.
Timeout now records full last captures, named failed conditions per member and
last reset cause (invalid/change), also in its assertion. Refused propagates.
AST proves exactly one call/result feeds unchanged final assertions; Linux real
cluster and one own Mac run are live proof, native new suite is scripted only.
Keep syntax Python3.9 compatible. The explicit missing-$G predicate is logically
dominated for acceptance by the >=2 count, but its named evidence remains
independently testable; no false independent acceptance-kill claim.
Parent extracted-loop replay with stable two $G groups/empty leaders reaches
its final assertion at1.05 scripted seconds/66captures, no network. First replay
used a three-port list instead of fixture's nine-port layout and raisedIndexError;
that harness error is corrected and never counted as proof or mutant kill.
No peer-placement root cause inferred, no timer/deadline constant change.


### 2026-10-18 13:23 EDT — D234 local group-readiness candidate proof

Landed only the test-local wait_for_groups extraction/call, two new proof files,
four workflow lines and six ledgers. Final four assertions, creation readiness,
QuietWindow/election/cleanup, preservation_checks and all production code stay
fixed. Returned full captures feed the one real call with no injected clock or
sleep; the portable AST control pins that tie.13controls0.282s/no skip and
22 intended-assertion mutants pass with intact selected controls/no ERROR-only
kills. Scripted cases cover all four original conditions on every member, empty
and single groups, None/empty leaders, eventual convergence, invalid regression,
valid changes, exact original polling/stability/deadline, completion overrun,
no-sample timeout, full evidence, Refused identity and no added member agreement.
The missing-$G condition's counted mutation tests its diagnostic reason; it is
not an independent acceptance gate beyond the >=2 count. Removing only the
invalid-sample clock reset while retaining valid-change reset passes the earlier
12-test suite and is a logical acceptance equivalent, not a kill: next valid
sample necessarily differs, then resets. Both resets remain in source; removing
change reset or all resets dies. Source has no new readiness/member agreement.

One actual owned Mac cluster run on NATS2.12.6/Node24.13.0 passes1test3.626s,
normal three-process shutdown/cleanupFailures[], only random loopback ports and
own credentials/routes. Owned root openclaw-preservation-cluster-xr8694ws;
raw 312bytes SHA256b7c80ce4ef0eddd6f8f7d34d5fcab67dd08d1effc115c735872ba02e1c5c4190.
This exercises the actual helper/QuietWindow/election consumer, not a Linux
failure reproduction, deployment or proof of the retained failure's cause.
Unchanged preservation_checks regressions23tests3.286s pass with three owned
servers/cleanupFailures[]/noProductionConnections true. New macOS CI lines are
scripted only; the existing Linux cluster line supplies real CI execution.
Local plan lint14PASS/1old idle-versionWARN/0FAIL. No timeout extended and no
stream-add retry; the peer-offline placement follow-up stays open.

First local candidate proof failed one floating-point exact boundary expectation
(1.65 became1.7 at the same >=1 comparison) and one AST harness dedent over the
existing multiline JS string. Fixed only tests: permit one existing poll step
of rounding and parse the full module before selecting the consumer AST. Neither
failure is a source defect or counted mutant. No source expansion followed.

Committed candidate digests:
- test_preservation_cluster.py: 5ece2bec768b00d378204103a54c8bc599e55171ed466a1206f18b00b7d47ef6
- test_cluster_group_readiness.py: 547e2e253e538b99c664f2d4fc4f70eef44e7a89d215660ff95fd460fddf875b
- mutate_cluster_group_readiness.py: f679065dac56bde434fb17124913a5bc0813ec69eab2b03a3a6b3d545937bf6a

Source exact-head review/all8CI remain pending; only after those a separate
reviewed green five-Markdown receipt may close this auxiliary row. B5/1.2
open/v1.2-pre,B6–B9held,D64/Gate/installed timers/production untouched. Current
inventory/override/D60 observer, integration, admission/manual/D175 and physical
reboot/history work remain later. This does not close B5-CI-R3-placement.


### 2026-10-18 14:01 EDT — owned cluster group-readiness verified (D235)

Source 08f90df7bd9139e3d8dee7e34fcf7507b5e90ef1, sole parent b0d55130, passes all eight distinct jobs in
[CI39149352811](https://github.com/moltyguibros-design/openclaw-node/actions/runs/39149352811)
attempt1, with no rerun. Linux22 job117739620498:13tests/0.266s/no skip,
22 intended assertion kills/intact controls; the actual owned three-member
cluster test passes2.165s with cleanupFailures[]. Native job117739620342:
13tests/0.252s/no skip/22. Native new-unit proof is scripted capture/clock
portability, not an actual cluster execution. Codex inspects completed raw logs:
Linux1538373bytes SHA2567a8c6b9aa3ae7872f24d37d14d28678dab00f6bb29f671af91c7278adda70f0e;
native88375bytes SHA256b9a303bda3e3f8de1e160a6868244919f8c6d6dcdf9480c0fda856df64340d05.
Both name merge c7bfd2b49258f1c3135a8c996f5f5fef291c2edd, source as second parent and
identical whole tree. These completed CI facts are Codex observations, later
than331's source review, not assigned to the reviewer.

Claude331 independently clears exact source/proof after329's pre-audit pins.
It verifies10files/1106insertions/18deletions, only the existing test-local
settle block extracted, one real consumer call, four CI lines, two new proof
files and six ledgers with three identical D234 blocks. Final assertions,
creation, QuietWindow, election and cleanup are byte-fixed; all production code
and other existing executables/tests/runners are fixed. As uid65534 it replays
13tests and22 intended assertion kills with intact controls; own mutants for
previous advancing only on valid samples, strict threshold, accumulated failure
rows, recomputed deadline, raft-only return and node-truthiness leaders die.
Its first full-suite deadline mutant hung and was narrowed to later-convergence;
that is its harness, not source or extra proof. The missing-$G mutation tests
named diagnostic evidence, not an independent count-dominated acceptance gate.
Removing only invalid reset is acceptance-equivalent because next valid table
necessarily differs and resets; it is not counted. No survivor is relabelled.

Only B5-CI-group-readiness closes as an owned fixture prerequisite: each member
must satisfy the same four old conditions before identical samples accrue1s
from their second occurrence. Invalid/changed samples clear stability and every
sample advances previous. Fixed10s top-of-loop deadline preserves sample-then-
check: an in-flight batch may finish after it, with about6s pre-existing capture
overrun; no hard completion bound or longer constant is claimed. Refused still
propagates. Timeout retains full last captures, named per-member failed checks
and last reset cause in the file/assertion. The real call injects no test clock
or sleep; AST pins its one returned result into unchanged final assertions.
Optional331 carry-forward: a late valid stable table may time out with last reset
change/all-empty failures; truthful, but elapsed stability could clarify it later.
No source defect or required correction remains; no unsolicited enhancement.

Local owned Mac NATS2.12.6/Node24.13.0 real cluster1/3.626s and unchanged checks
23/3.286s both have normal owned cleanup, no production connections. Local new
suite13/0.282s/22kills stays distinct from CI. Parent replay accepts stable empty
leaders then fails its final assertion at1.05 scripted seconds/66captures;
its initial wrong-size port harness and the candidate's floating-boundary/AST
harness corrections remain non-proof, not kills. Neither that replay nor the
passing controls proves the cause of the prior receipt failure. Peer-offline
placement diagnosis stays open, including test_recovery.mjs; no create retry,
timeout widening, production scan or operation. Existing captured failure logs
remain failed evidence. Current inventory/override/D60 observer, full held/
process integration, admission/manual/D175 and physical reboot/history evidence
remain later. B5/1.2 open/v1.2-pre,B6–B9held,D64/Gate/installed timers/production
untouched. This receipt changes five Markdown only; AUDIT_PRE and every non-
Markdown byte stay fixed. Local lint14PASS/1old idle-versionWARN/0FAIL. Receipt
exact-head review and its own all8CI remain pending at commit time, separately
required before completion; no whole-B5 closure or source-origin claim.


### 2026-10-18 14:48 EDT — owned placement-gossip diagnosis pre-audit (D236)

Micro re-orient: B5/1.2 open/v1.2-pre; B6–B9 held.
D235 source08f90df7/receipt6df6c8b6 are clear331/333 with both all8 attempt1 CI.
Group settling is corrected; peer-offline placement diagnosis remains separate.
This unit measures one candidate sufficiency gap in the unchanged placement gate.
It serves trustworthy owned recovery evidence, never a production stop/admission.
Still the right next unit: diagnosis before proposing a readiness repair.

Pre-screen: clean parent6df6c8b6, existing NATS2.12.6/Node24.13.0 and owned
fixture available; no BLOCKED.md. Retained CI39133265637/job117692584463 fails
at cluster-offline-consumer-placeholder after the fixture's current waitCluster;
no forensic root artifact was uploaded. Prior failure cause remains unproved.
Official tagged NATS sources show placement consults peer configuration/statistics
in addition to metadata replication; existing eight Raft/route checks do not
inspect that cache. Source-level sufficiency gap is a hypothesis for the old
failure, not its observed cause. The installed binary accepts a route permission
rule denying only $SYS.SERVER.*.STATSZ; parser-only check started zero servers
and made zero connections. No actual fault/control pair has run at this point.

Goal: produce bounded owned fault/control evidence testing whether the unchanged
placement gate can accept while R3 placement reports peer offline. Run a fresh
three-node normal control and a fresh three-node cohort differing only in the
STATSZ route-deny rule, with random loopback ports, own private tokens/routes,
no advertise and production-port exclusions. Reuse the exact source of the
existing placementState/waitCluster; no duplicate classifier or dynamic eval.
Attempt create once per cohort only after the unchanged gate passes, retain full
ready facts and exact API error/phase-local debug selection reasons, then require
normal own cleanup. A gate timeout, wrong refusal, or failed cleanup is an
inconclusive/failing experiment, never a counterexample. No creation retry or
sleep-based repair. A reproduced counterexample establishes only this owned
sufficiency gap; it cannot identify the historical CI interleaving.

Section6 intended deltas: six candidate ledgers and one auxiliary diagnosis row
first; private scratch probes during pre-screen, with no source-gate change.
After the owned result and Claude336-request pre-audit are reconciled, promote
only useful reproducible evidence: fixture-local shared extraction of the two
unchanged readiness helpers, an owned placement-gossip probe, its meaningful
controls/intended-assertion runner and explicit CI registration/evidence retention.
Pin exact file set and checks before promoting source. If the proposed fault
cannot isolate the gap, record that negative and re-orient rather than widening
the experiment or claiming a repair. All production modules, D235 fixture and
assertions, D64/Gate/installed timers stay fixed. No production connection,
service/VM operation, resource provisioning, admission or B5 closure.

Risk register: route filters may prevent metadata discovery itself; then no
counterexample exists from this method. Route visibility and Raft current flags
do not certify placement cache contents. Additional application connections may
be needed to make discovery explicit; if used they must be identical in control
and fault and declared as a different sequence from the historical CI. Debug
logging is owned only; evidence must exclude configurations/tokens and identify
its log window and truncation. A fault must not be "validated" only by a parser;
require observed behavior and single-attempt accounting. Cleanup failures always
invalidate live proof. Exact-head review/all8 CI and a separate reviewed green
receipt are required for any source prerequisite closure; original placement
repair and current observer remain open at this pre-audit.


### 2026-10-18 15:01 EDT — D236 pre-audit settled after owned pre-screen (Claude339)

337 confirmed the upstream cache/readiness mechanism but predicted a possible
miscellaneous-error outcome unless a connections event first creates bare peer
entries. Actual first owned pair at owned-placement-gossip-mIhOJi does generate
those events: one ordinary own connection to EACH member before the old gate,
identical in control/fault. Fault denies only $SYS.SERVER.*.STATSZ in import and
export of ALL THREE owned members. Old eight checks all pass in both; control
creates once; fault creates once and returns400/10005/peer offline. Leader2's
create-window log discards member1/member3 as offline, required3/found1/peers3,
offline:true/misc:false. Both cohorts shut down normally with no cleanup failures.
Initial report81477bytes SHA256d060942c1b5b5fc4ea882f65119fac46f07367a40eef0eb00b1e47097b3fce1c.
This is the nil-config/statistics discard branch, not a historical CI cause;
the filter and extra per-member connections are deliberate injectors absent
from that historical sequence. No natural trigger, protected provenance or
readiness repair follows. Initial scratch module copied exact source bodies
into an owned static module; it used no eval and changed no repo executable.

339 accepts this narrower observed scope and drops the new system-account RPC/
authentication-domain expansion. Adopt byte-exact placementState/waitCluster
extraction into fixture-only placement_readiness.mjs, imported by original test
and probe; all original callsites/placementCounterexamples fixed. Add synthetic
eight-counterexample controls, source/caller pins and intended-assertion runner.
Promoted probe requires both ready tables, exact NATS2.12.6/10005 wording,
create-window leader discard lines for every other peer and offline:true/
misc:false summary, exactly one create each, separate own roots/ports/tokens/
passwords, sequential execution and normal complete cleanup. Any other result is
inconclusive, never reproduction. Preserve old15s readiness deadline and every
original create/timeout/retry behavior. Four CI registration command lines run
the new suite/runner on Linux22 and MacNode22, including a real owned pair on
both; two always-run JSON-only evidence retention steps preserve the report,
not configurations or raw logs. No new CI job or production deployment.

Final section6 file set: original test_recovery.mjs (only two definitions moved
and one import), new placement_readiness.mjs, probe_placement_gossip.mjs,
test_placement_gossip.mjs and mutate_placement_gossip.mjs; .github/workflows/test.yml
(four command lines plus owned JSON retention), six ledgers. All other existing
bodies, D235 checks, production and VERSION remain fixed. Exact-head review/
all8CI and separately reviewed green five-Markdown receipt before auxiliary
closure. Original B5-CI-R3-placement repair/current observer stay open.

Counter instrumentation pre-screen: upstream jetstream_api.go records total/
errors on the server sending the API response, before publishing it. The create
may be answered by a member other than the connected member. Therefore retain
all three members' /jsz counters before/after the create (after manager setup),
including connected member separately; measure which responder increments and
reconcile339's connected-member delta pin against actual data before commit.
Do not assume local forwarding is counted. No API call is retried to obtain a
preferred counter result. A counter mismatch makes the probe inconclusive.


### 2026-10-18 15:17 EDT — owned placement-gossip source candidate (D236)

Claude341 independently checked tagged jetstream_api.go and corrects339 pin4:
API totals/errors increment per account on the responding server, not necessarily
the connected member. All three before/after rows are identity-bound to ready
server IDs; aggregate totals must rise exactly1 with errors0 control/1 fault,
every member delta nonnegative. Connected member and counter-increment member
names are retained separately. Counters alone do not prove who answered; the
fault's leader debug window is the causal branch evidence. In the first measured
candidate, connected member1 stays flat in BOTH cohorts: control member3 total0→1,
fault leader2 total1→2/errors0→1. No request was repeated to get a preferred delta.
341 accepts two JSON-only always-run artifact steps in addition to four commands.

Final local suite:30/30 pass,0 skips,1341.638125ms on Node24.13.0/macOS;29
portable checks plus one real owned pair using NATS2.12.6. Unmutated portable
controls pass;28/28 named intended-assertion kills: eight old-gate predicate
omissions,12 evidence-acceptance omissions, one-peer/window/summary omissions,
both counter identity bindings, connected-member-only and first-row-only sums.
These are fixture/proof-contract mutants, not production admission defects.
Final full report87319bytes SHA256
57157b665e5f848faa7cdbe1728036276461a4cfb92ae0e4f40916e0121019fb.
Root owned-placement-gossip-N1Oxd1: both eight-check tables true; control creates
once, fault creates once and returns exact400/10005/peer offline. Fault leader1
window8535..9043 contains both other-peer offline discard lines and required3/
found1/peers3/result1/offline:true/misc:false. Aggregate request deltas1/1,
errors0/1; all six owners exit0 with Server Exiting, no cleanup failures.
Independent unfiltered original test_recovery fixture also passes, owned root
openclaw-jetstream-fixture-XPh6Xl, allOwnedServersStopped:true; its output6375bytes
SHA25672286662981609e94d75bdc915d9b21f25e6e7716e605239b92ec517aca86be1.

Local corrections retained: an initial mutant-runner guard rejected the correct
named assertion because Node formats error text as a multiline YAML block; the
guard now accepts that exact block as well as a quoted scalar and still requires
ERR_ASSERTION/status1. Initial negative name-selection pattern unexpectedly ran
the real pair as part of its30-test success; portable selection now uses an
explicit positive prefix and the runner asserts no live-report marker appears.
There were four owned pairs during development: initial scratch, first measured
candidate, that intermediate suite and final suite; every cohort attempted only
one create, every pair succeeded as a counterexample with normal cleanup. These
are distinct instrumentation/validation stages, not retries of a failed create.
An extraction-check mismatch was only removed-definition newline accounting;
removing each exact old definition plus its terminating newline and the new
import makes the remaining original caller byte-identical, including every
placementCounterexamples/callsite. Helper body hashes are pinned by the suite.

CI registers the pair/runner before the old Linux recovery fixture, and before
the D235 group controls on macOS; no prior command/body is altered. Both platforms
now execute a real ephemeral six-server sequential pair. Artifact paths name only
the private JSON report, excluding configs/tokens/raw logs. Four commands plus
15 artifact lines,19 workflow additions total. All production executables,
lib/bin/test/workspace-bin trees and other existing step12 bodies remain fixed.
VERSION staysv1.2-pre; source exact-head review/all8 CI and separate five-Markdown
receipt review/own all8 CI are still pending at this candidate. Diagnosis auxiliary
stays[A]; original R3 placement repair and natural trigger/current observer remain
open. No B5 closure, D64/Gate/timer or production operation.


### 2026-10-18 15:58 EDT — owned placement-gossip diagnosis verified (D237)

Sourcefa9f0a4a8a829e1e2cb72ba9cd9f56bdc56fe97b, sole parent6df6c8b6, is independently clear at
Claude343; exact-head Tests CI39158146598 all8 succeeded in attempt1.
No run was retried. Portable/real proof and retained artifacts are Codex CI
observations unless the independent-review details below say otherwise.

linux: job117765560352, attempt1,30 tests/29portable+1real,
1.015242539s,0skips,28 named mutant kills with controls intact. Raw log1601113bytes
SHA25688724f4954ca7be768d7f6b6fe48083db0207786930531deb87eb5a29740b3a0. JSON-only artifact12147498840, report86847bytes
SHA25669a680c06853d4fa829b4389406bb63decac3c2fc28422b8b61225927a0e0ea5; only placement-gossip.json, parsed equal to full live log report.
native: job117765560253, attempt1,30 tests/29portable+1real,
1.476127625s,0skips,28 named mutant kills with controls intact. Raw log150992bytes
SHA256cc125bdc3d2b2a334b8f9854945acb074a35585271d261d1b7b1a60e9c38bc6a. JSON-only artifact12148339981, report87180bytes
SHA2562edf566e4aa62b4f65f506bce5f02b79d7a59f84993c8c1f189307ae84bda64f; only placement-gossip.json, parsed equal to full live log report.

Both CI platforms execute the actual isolated pair on official NATS2.12.6:
all eight unchanged gate checks pass in both cohorts; one control create succeeds,
one fault create returns exact400/10005/peer offline; each fault leader's create
window discards both other peers at the pinned offline site and reports required3/
found1/peers3/result1/offline:true/misc:false. API snapshots bind to ready IDs,
aggregate totals1/1, errors0/1, every member delta nonnegative. All six owned
owners exit0 normally with shutdown marker and empty cleanup failures. This is
injected sufficiency evidence, not the historical CI trigger or readiness repair.

Checkouta4042de3fd3ee5792c1ad78bc977037ec26940e5 has source as second parent; Linux/native
checkout IDs match and both merge-checkout trees are byte-identical to source.
The workflow adds four registration commands and two JSON-only artifact steps;
macOS new-unit proof includes real owned servers, not only scripted controls.
Local30/28 and unchanged original recovery fixture evidence stays in D236.
The explicit APP connection to EACH member and STATSZ route denial on ALL THREE
members are deliberate injectors absent from the retained historical sequence.
Counters identify increment locations, not an authenticated responder identity;
leader debug evidence supports only the specific fault branch. D189 applies.

Claude343 independently verifies sole-parent/twelve-file delta, exact helper extraction and all remaining caller bytes, three D236 block identities across six ledgers and candidate row. Under Node22/uid65534:29 portable pass with no live cohort; full suite29pass/1binary-absent failure (sandbox has no NATS), runner28/28 intended kills with controls intact. Five extra variants die: relaxed total, dropped error/version/discovery/nonnegativity. Three survivors are declared construction equivalents, uncounted: dropped cohort flag, dropped owner count and leader read from last ready row (all rows agree at a ready gate). They are equivalences under the fixed probe construction, not a claim about arbitrary forged report inputs. Truncation flag is a fixed false fact because the entire tail is read. Real pairs remain Codex CI evidence;343 read CI in progress and claims no completed CI result. No required source finding.

Only B5-CI-R3-placement-diagnosis closes as an owned prerequisite. Original
B5-CI-R3-placement repair/natural trigger, current inventory/override/fresh-D60
observer, full held/process integration, durable admission/manual/D175, full
native pipeline and disposable-Mac/APFS/reboot/four-history evidence remain open.
B5/1.2 staysv1.2-pre; B6–B9 held; D64/Gate/installed timers/production untouched.
No production connection/service/VM/resource operation. This five-Markdown receipt
keeps source executables, workflow, VERSION and AUDIT_PRE byte-identical; its own
exact review and all8 CI are pending at commit, not retrospectively preclaimed.


### 2026-10-18 16:30 EDT — placement proof cardinality re-orient (D238 pre-audit)

D236 sourcefa9f0a4a is clear343/all8CI39158146598; D237 receipt52f31d88 is
clear345 but its OWN CI39161190466 failed attempt1: seven jobs success, native
117774685858 fails only leaderReason. No rerun. Reopen the auxiliary diagnosis
closure until a corrected exact head and separate receipt both satisfy review/CI.
Source's successful evidence remains valid, and this failed history is retained.
B5/1.2 staysopen/pre; B6–B9 held; production/D64/Gate/timers unchanged.

Failed native report87278bytes SHA256
030d5f024aa9f64344f76987abba1e0f1107c3679c2fbea224d5217634b73cd0,
artifact12149732321 (JSON only). Full failed log127193bytes SHA256
0f856e2a4ccc6e01df92ebbecea3d78f89d505f06d97178d6967a43d33d0db44.
Both old eight-check tables pass, control creates once, fault returns exact
400/10005/peer offline, aggregate counters total1/1/errors0/1, six owners exit0
normally, empty cleanup. Fault leader2's create window8819..9433 contains exact
offline discard lines for member2 ITSELF plus member3/member1, then required3/
found0/peers3/result0/offline:true/misc:false. Comparator requires found1/result1,
so honestly reports inconclusive and fails. No failed evidence is called a win.

Tagged NATS2.12.6 selectPeerGroup iterates the peer list without a self exemption;
its nil-cfg-or-stats guard emits this exact offline line. Our source proof assumed
self cache was filled and only the two other peers could be discarded. The log
shows that assumption is unnecessary for the intended nil-cache sufficiency
counterexample. How self stats became absent is not established here; historical
unfiltered CI trigger is still unproved. This is a proof-contract correction,
not a new readiness rule, retry, delay or production admission.

Proposed next atomic outcome: accept either fully evidenced partition, two known
other-peer discards plus remaining1, OR all three known-peer discards plus
remaining0, only when the named ready leader owns the create-window log, every
other peer is discarded at the exact pinned site, discard names are unique/known,
and the single summary's required3/peers3/found/result counts agree with that
partition, offline:true/misc:false. Wrong/missing/duplicate/foreign discards,
contradictory counts or reasons still refuse. Retain the original two-discard
positive and add a three-discard positive plus independent conservation negatives
and intended-assertion mutants. No post-create resampling to pick another window.

Section6 prospective files after Claude review: probe_placement_gossip.mjs,
test_placement_gossip.mjs, mutate_placement_gossip.mjs and six ledgers. Shared
placement_readiness.mjs, original test_recovery, workflow, all other executables
and VERSION fixed. Local portable/mutant/one-real-pair proof, exact source review/
all8CI then separate five-Markdown receipt review/own all8CI required. PR remains
draft. Original placement repair/current observer/natural trigger remain open.


### 2026-10-18 16:36 EDT — D238 partition pre-audit settled (Claude347)

347 independently reproduces the complete failed native1028-line log,127193byte
hash, three-discard leader2 window and every other passing gate/normal cleanup.
Tagged source creates self nodeInfo with cfg nonnil/stats:nil. Its own STATSZ send
fills stats, under a one-second rate limiter; first heartbeat250ms can precede
JetStream loading and discovery-triggered sends share the limiter. Peer selection
includes self with no exemption. This supplies a second LOCAL producer of the
nil-cache state, independent of route denial. The freshly started/elected leader
window is a natural-trigger candidate, not proof of the retained historical cause.

Adopt exact known-peer partition and conservation pins from347: both nonleaders
required, leader optional, unique known names, no unpinned line/reason, exactly
one summary, required3/peers3 and found=result=3-discardCount, offline:true/
misc:false. Keep two-discard positive and add actual-shaped three-discard positive.
Independent negatives include single nonleader, leader-only, self plus one other,
foreign/duplicate names, two summaries, every inconsistent count and unknown
reason/line. Count forced-one, dropped conservation, single-discard acceptance,
foreign/duplicate acceptance, summary uniqueness and leader-only mutants only at
named assertion failures with intact controls. No original helper/fixture,
workflow, injection, create, counter, cleanup, timeout or production change.


### 2026-10-18 16:38 EDT — D238 local partition correction candidate

Only leaderReason changes in the probe: complete known/unique offline-discard
partition from the named leader, no unpinned line, one summary with required3/
peers3/found=result=3-discardCount and fixed flags. Both other peers mandatory;
self optional. Two-discard/found1 and three-discard/found0 are accepted, while
single peer, self-only/subset, foreign/duplicate names, duplicate summaries,
unpinned reason/line and every inconsistent count refuse. Producer, helpers,
original fixture, workflow, VERSION and all other code remain byte-identical.

Local Node24.13.0/macOS proof:45/45 pass,0 skips,1703.582084ms;44 portable tests
and one actual owned NATS2.12.6 pair.34/34 named intended assertions killed with
intact portable controls/no live cohorts in the runner. Old one-peer variant is
replaced by a targeted single-nonleader case; six distinct additions kill forced
remaining1, dropped conservation, accepted foreign/duplicate names, dropped
summary uniqueness and leader-only acceptance. No equivalent mutant is counted.
The final actual pair takes the two-discard form at leader3, both old ready tables
true, exact fault10005, one create per cohort, normal six-owner cleanup[].
Report87328bytes SHA256
432603f113d684d349bbe2ab88a9f82a5e61b2e52a54f37d0324d3c32269e2c5.
The retained failed native JSON is also replayed READ-ONLY through the corrected
comparator: all12checks true/owned-counterexample, including its three discards;
original bytes/hash and its old inconclusive diagnosis are untouched. This is
regression replay, not a rerun or a retroactive green claim for CI39161190466.

Shared helper/original caller hash pins pass. Exact source review/all8CI and a
separate reviewed green five-Markdown receipt remain pending. Diagnosis row[A]
stays reopened; original placement repair/natural trigger/current observer remain
open. B5/1.2pre, B6–B9 held, D64/Gate/timers/production unchanged. Failed D237
native history and successful D236 source history remain separately retained.


### 2026-10-18 17:10 EDT — corrected owned placement diagnosis verified (D239)

Corrected source5e931120ec01de19c861024f8387e77952f104a9, sole parent52f31d88, is independently
clear at Claude349; exact-head CI39164238245 all8 succeeded in attempt1.
This new-head run is not a rerun of failed D237 CI39161190466. The original
sourcefa9f0a4a/all8CI39158146598 evidence and D237 failed receipt remain separate.
Completed CI/live facts are Codex observations unless the review details say
otherwise. Both platforms execute the actual ephemeral six-owner sequential pair.

linux: job117783726805, attempt1,45 tests/44portable+1actual pair, 0.960582542s,
0skips,34 intended-assertion kills with intact controls. Fault leadermember-2,
3 offline discards/remaining0; all12diagnostic checks true.
Raw log1606576bytes SHA25617c8025dd254ff1b96d1e815ede82712d2ac15d2f8f654b700248924e9b312e2.
JSON-only artifact12150182604, report86972bytes SHA256
fa9c92376bb94f32259d6f70d90477194047aa561188cc70fd33dd9ee19c7667; ZIP digest verified, sole placement-gossip.json parsed equal to full live log report.
native: job117783726786, attempt1,45 tests/44portable+1actual pair, 1.530703208s,
0skips,34 intended-assertion kills with intact controls. Fault leadermember-1,
2 offline discards/remaining1; all12diagnostic checks true.
Raw log156387bytes SHA2569843674f8816105f73c684467440fd20cb9f6a40be46f7b65dae29347a3e4b8b.
JSON-only artifact12150912021, report87185bytes SHA256
698970007e9f778878af3d1ddd021b83350759edbe95ce401459d1b89a987a36; ZIP digest verified, sole placement-gossip.json parsed equal to full live log report.

Every actual pair passes all eight unchanged readiness checks in both cohorts,
control creates once, fault refuses once with exact400/10005/peer offline. Fault
leader log contains both nonleaders and optionally self at the exact nil-cache
offline-discard site; unique known names and one full2.12.6 new-stream summary
conserve required3/peers3/found=result=3-discardCount with offline:true/misc:false.
API before/after rows bind ready IDs, aggregate total1/1/errors0/1, per-member
nonnegative; all six owners exit0 with shutdown marker and empty cleanup failures.
Both JSON-only archives match their live report values. Checkout
225e823e8601a701b3a859c9f52cc348aedb5850 matches both jobs, source second parent, identical tree.

Claude349 independently verifies sole parent52f31d88/nine paths, sole probe hunk inside leaderReason, unchanged producer/helper/original/workflows/VERSION/other executables, three identical ledger headings and reopened row/frontier. Under Node22.22.2/uid65534:44 pass and1 real-pair failure solely because binary absent;34/34 runner kills with intact controls/no live cohorts; hash pins pass. From saved CI LOG reports, old failed report is inconclusive only at leaderReason under old probe and owned-counterexample under new; prior fa9 passing report stays accepted under both. Artifact bytes/digests and local Node24 timings stay Codex. Own adversarial variants confirm completeness/required/peers/conservation/self-count/two-discard positive; dropped match validation dies by TypeError, not a counted intended assertion. Optional unproved literals replica:3/existing:[]/0 are declared, not independently claimed as tested gates. End-anchor removal and reading last line are uncounted producer equivalents under pinned2.12.6, not arbitrary-input equivalences. Cosmetic indentation note is unchanged.347 attribution/failure retention accurate. Source CI was in progress with six early successes at reviewer query; no completed CI or logs read there. No required source finding.

Failed history retained, not rewritten: D237 native117774685858/CI39161190466
failed only hardcoded found1/result1, with legitimate three-discard/found0 evidence.
Log127193bytes SHA256
0f856e2a4ccc6e01df92ebbecea3d78f89d505f06d97178d6967a43d33d0db44;
artifact12149732321/report87278bytes SHA256
030d5f024aa9f64344f76987abba1e0f1107c3679c2fbea224d5217634b73cd0.
347 independently reproduced this complete1028-line log and mechanism. Tagged
source initializes self with stats:nil and fills it via rate-limited own STATSZ;
there is no self exemption in placement. New local45/34 and read-only replay of
that exact failed report prove the corrected classification without changing old
bytes/outcome or claiming old CI green. Two and three-discard positives and all
partition negatives are portable proof; fresh actual forms are stated above.

Only B5-CI-R3-placement-diagnosis closes as a corrected owned prerequisite. Both
injected route denial and per-member APP discovery connections remain explicit.
No historical CI cause or readiness repair is established. Original placement
repair/natural trigger/current inventory/override/fresh-D60 observer, full held/
process integration, durable admission/manual/D175, full native pipeline and
disposable-Mac/APFS/reboot/four-history evidence remain open. B5/1.2v1.2-pre,
B6–B9 held; D64/Gate/installed timers/production unchanged. This five-Markdown
receipt keeps source, workflow, VERSION and AUDIT_PRE byte-fixed; its own exact
review and all8 CI are pending at commit and are not preclaimed.


### 2026-10-18 17:54 EDT — owned R3 failure evidence pre-audit (D240)

Micro re-orient: B5/1.2 is open at v1.2-pre; B6–B9 remain held.
D239 closes only the injected placement diagnosis with reviewed, green owned proof.
The original unfiltered R3 CI failure still has no phase-local selector evidence.
This unit records that evidence if the owned fixture fails; it does not repair placement.
It feeds the separate B5-CI-R3-placement decision without a production operation.
Still the right next bounded step: yes, because a repair now would guess the old cause.

Pre-screen: source/receipt 5e931120/7dd079d0 are reviewed clear at Claude349/351,
each with all eight CI jobs successful on attempt 1. The worktree is clean and no
BLOCKED.md exists. NATS 2.12.6 selectPeerGroup reads cached peer cfg/stats in
addition to the eight observable route/Raft checks; tagged events.go fills the
cache after STATSZ updates. The old unfiltered CI logs have the API error and
phase, but no selector window. One separate owned unfiltered startup/create
attempt at 17:52 EDT passed with one APP connection, all three normal exits and
no cleanup failure; this is a negative observation, not a historical replay.

Goal: on a failed R3 stream creation in test_recovery.mjs, retain the exact
phase-local owned server log windows and the pre-create readiness observation,
while rethrowing the same error and making no second create attempt. A bounded
private JSON report contains only generated member names/IDs, readiness checks,
known error codes, log offsets and selector lines; no credentials or raw configs.
No readiness predicate, server setting outside the owned fixture, timing,
stream config, recovery mechanism, production path, or create retry changes.

Section 6 prospective delta: fixture-only evidence helper in the existing
placement_readiness.mjs, consumed by all four R3 add sites in test_recovery.mjs;
enable debug logging only on this owned fixture's three servers. Add a portable
negative/positive suite and intended-assertion runner for exact window, no retry,
bounded redaction and original-error behavior; register them on Linux and macOS.
The existing owned placement fault/control probe remains a separate proof and
retains its source and report shape. Add an always-run JSON-only CI artifact for
the failure report, uploaded only if an R3 failure occurs. Six ledgers describe
the scope; VERSION remains v1.2-pre and B5/1.2 stays open.

Verify: scripted pure and fake-manager failure controls, including no duplicate
call and no report on success; run the unchanged unfiltered owned recovery test
once with normal cleanup, then exact-source review and all-eight CI. The failure
path must be exercised by a controlled owned fault without repeating the failed
request. A later five-Markdown receipt gets separate review and all-eight CI
before only this auxiliary row closes. The original B5-CI-R3-placement repair,
natural historical trigger and current inventory/override/fresh-D60 observer
stay open; D64, Gate, installed timers, VMs and production remain untouched.


### 2026-10-18 18:02 EDT — D240 mid-implementation finding

The pre-audit's unchanged-probe-source assumption was too narrow. The existing
controlled STATSZ-denied probe is the only owned, reproducible R3 refusal, so it
now calls the same failure-evidence helper once at its existing create site. Its
report schema and comparator remain unchanged; on the fault side it additionally
writes a private failure report. This also updates the portable original-caller
source hash pin and adds an assertion comparing the helper's selector lines to
the probe's already-retained window. No readiness predicate or second request
was added. Debug logging is enabled only for the three owned cluster servers in
test_recovery.mjs. The original unfiltered CI cause remains unproved.


### 2026-10-18 18:08 EDT — D240 source candidate and owned proof

The four owned R3 creation sites use one evidence helper. The helper snapshots
log offsets immediately before each one-shot create, records the last successful
waitCluster observation, and rethrows the identical error on failure. The private
0600 report is bounded to 128 KiB read per member and 1024 characters per
selector line; it retains offsets, a digest and selector lines, not full raw log
bytes. Oversized windows are marked incomplete. The last waitCluster snapshot is
pre-create evidence, not a contemporaneous check of the server's private peer
stats. Debug logging is enabled for the three owned cluster servers only.

Local controls at candidate source: seven portable tests passed; 12/12
intended-assertion mutants killed with intact controls. The existing placement
suite passed 45/45, and its runner killed 34/34. Plan lint was 14 PASS, 1 WARN,
0 FAIL (historical VERSION-idle warning); diff whitespace check and syntax check
passed. The final bounded-read source ran the entire unfiltered owned recovery
fixture: pass=true, allOwnedServersStopped=true, no failure report. The final
controlled owned pair had one create per cohort, control created, injected fault
refused with API error 10005, both cleanup failures empty. Its 2081-byte report
was mode 0600, SHA256
f4a7c00e4e0e89db15ade38b1aefe3c8e04cfc0638721884d028f7ae3df90786;
three selector lines were retained with all windows complete and pre-create
readiness true. That is injected sufficiency evidence, not the historical CI
cause. No production service, timer, Gate, D64 record or restore was touched.

Source exact-head review and all-eight CI remain pending; this candidate row
stays [A]. A separate reviewed, green five-Markdown receipt is required before
closing only this auxiliary evidence row. The original R3 placement repair,
natural trigger and current inventory/override/fresh-D60 observer remain open;
B5/1.2 stays v1.2-pre and B6–B9 stay held.


### 2026-10-18 18:21 EDT — D240 review correction, scope and freshness

Claude355 reviewed exact source d5f396b9 and reproduced 7/7 new portable tests,
12/12 named kills, 44 portable placement passes and 34/34 existing kills under
uid 65534. It found one required ledger correction: the original debug predicate
also enabled logs on the three later cloned cluster members, so the D240 text
claiming only three servers was false. This correction narrows the source as
well: start() takes an explicit debug flag, passed only at the original three
member starts. A complete unfiltered owned recovery run after that change
passed, stopped all owners, produced no failure report, and its retained
configuration files confirm exactly three debug-enabled servers. The caller
source hash pin was recomputed; the eight old placement predicates remain
byte-identical.

The report now labels its readiness table as caller-supplied observations,
retains each jsz.now and a failedAt timestamp, so the age of the last
waitCluster snapshot can be seen rather than implied fresh. A new negative
for overlong selector lines and a counted mutant raise the portable controls
to 8/8 and 13/13; the success-report mutation now requires its exact assertion.
The corrected controlled owned pair passed with one create per cohort, control
created, fault API10005 refused, three complete selector lines, and empty
cleanup failures. Its private 0600 report was 2456 bytes, SHA256
14f8d8a84dd2a4b75c8d36bfce7075056a0f0cb967cfe6a286a9f49d6c2775d0.
These are final-source local checks; the earlier CI run on d5f396b9 does not
validate this correction. No historical natural failure cause or placement
repair is claimed. Source exact-head review and all-eight CI remain pending;
D240 stays [A], B5/1.2 remains v1.2-pre, and production is untouched.


### 2026-10-18 18:52 EDT — owned R3 failure evidence verified (D240)

Corrected source 94bc8e766f6a10921d1ae6fa80e62762f6655fd8, sole parent
d5f396b9aa70758fc0fc0522b75e13b311a8f9a1, is independently clear at Claude357.
Claude355's required finding on the first candidate was corrected: only the
original three cluster servers have debug logging, and the report records the
age of caller-supplied pre-create observations. Exact-source CI 39171957048
passed all eight jobs in attempt 1. Completed CI facts below are Codex
observations, not claims that Claude read GitHub logs. Merge checkout
85849f670905eb4c9416c3e6e32fe39e8cbd2a1c has source as its second parent and an
identical tree.

Linux unit-tests (22), job 117806710325: the actual owned fault/control pair
passed 45 tests, its prior mutation runner killed 34/34, the new evidence suite
passed 8/8 with no skips, and its runner killed 13/13 with intact controls. The
controlled fault made one R3 create and refused with API 10005; its bounded
report recorded all eight caller-supplied readiness checks true, timestamped
observations, three complete selector lines on the leader, complete empty
windows on the other members, and the original peer-offline error class. The
full unfiltered owned recovery passed and all servers stopped. Full job log:
24462 lines, 1614893 bytes, SHA256
5c0ecb0a47529d790c301553deed670d2378312bc007ac4fcf7c55af1854f380. JSON-only
placement-gossip artifact 12152962260: 86849 bytes, SHA256
a49fba46c2986ca97ec628d856fc8683b9047cbc7116cd7aca0062068e5791fc; its diagnosis
is owned-counterexample, all 12 checks true, one create per cohort, and empty
cleanup failures. There is no unfiltered placement-failure artifact because the
unfiltered fixture succeeded.

Native legacy-writer-lock-macos, job 117806710192: the actual owned
fault/control pair passed 45 tests, its prior mutation runner killed 34/34, the
new evidence suite passed 8/8 with no skips, and its runner killed 13/13 with
intact controls. The controlled fault made one R3 create and refused with API
10005; the bounded report preserved three complete leader selector lines,
timestamped pre-create observations and the original peer-offline error class.
Full job log: 1472 lines, 163479 bytes, SHA256
b186c260195dbc0d8742db644da2ac72da112c12e6fe47076d98fbe8b9eb5df9. JSON-only
placement-gossip artifact 12153471850: 87192 bytes, SHA256
0efec3acab195ae96e32565ebe4d6346a8bedcb599df631ab74c02d5e0d20686; its diagnosis
is owned-counterexample, all 12 checks true, one create per cohort, and empty
cleanup failures.

Local corrected-source proof is separate from CI: the unfiltered owned recovery
passed, all owned servers stopped, no failure report was produced, and retained
configurations show debug only on the first three cluster servers. The
controlled fault/control pair made one create per cohort, control created and
fault refused with API 10005, all owners cleaned up; the private mode-0600
failure report is 2456 bytes, SHA256
14f8d8a84dd2a4b75c8d36bfce7075056a0f0cb967cfe6a286a9f49d6c2775d0. The new 8/8
and 13/13 portable controls, existing 45/45 and 34/34 controls, and plan lint 14
PASS/1 historical VERSION-idle WARN/0 FAIL support this owned fixture only.

Only B5-CI-R3-failure-evidence closes as an auxiliary evidence prerequisite. A
future natural owned R3 refusal is instrumented to retain bounded selector
evidence without retrying; this did
not establish the cause of past Linux failures or repair peer placement. The
original placement repair, natural trigger, current inventory/override/fresh-D60
observer, full held/process integration, durable admission, manual restoration,
D175, native full pipeline, and disposable-Mac/APFS/reboot/four-history evidence
remain open. B5/1.2 stays v1.2-pre, B6–B9 held; D64, Gate, installed timers and
production remain untouched. This receipt changes five Markdown ledgers only;
AUDIT_PRE, source, workflow and VERSION stay byte-fixed. Its own exact review
and all-eight CI are pending at commit and are not preclaimed.

### 2026-10-18 19:44 EDT — first-open-row reconciliation (D241)

The D240 source 94bc8e76 and receipt 86ff2461 are reviewed clear by Claude357/359. Their exact-head CI runs 39171957048 and 39174246835 both passed all eight jobs at attempt 1. Claude361 independently found the first-open-row pointer stale and recommended reconciliation before another source unit. This change corrects that pointer; it does not deliver a stop, restoration adapter, admission or placement repair.

Three historical rows are normalized against later evidence. B5-exact-head-CI diagnostic draft is marked complete only as fail-closed diagnosis: D180 integration controls, D193 owned client trace and the five-job green D194 carrier 151bb3bd/39011578564 exist; the launchctl delay's cause and default-throttle policy remain open. B5-role-binding integration is marked superseded as an overbroad composite: D181's pure reader and D185–D187's checkpoint/verifier wiring exist, but live serving-unit interpretation and just-in-time B3 binding are explicitly retained in B5-serving-role-runtime-binding. B5-native-ASIF-mount is marked complete only for the owned mechanism: D195/D196's isolated macOS observation is on green 6f7e9371/39018959320, followed by D197 device-binding correction and D205's owned reader integration on green e120e78d/39053730664. None is a production image or physical no-writer proof.

The first still-open executable source prerequisite is now B5-serving-NATS recovery adapter. The existing StopWatch.mutate guard refuses persistent NATS disable-and-unload specifically because recovery lacks that adapter. The adapter therefore precedes the persistent-stop producer; both precede an owned capture-ready checkpoint. Stopped-ASIF extraction and the newly explicit live role-binding row remain open. The current entrypoint/override/fresh-D60 observer is a separate later D62 gate, not a substitute for the pre-capture producer. This ordering replaces the frontier table's stale current-observer-first pointer. The original B5-CI-R3-placement repair still needs a natural failure cause; D240 records future bounded selector evidence without retrying. No guessed readiness repair is included.

Only these five Markdown ledgers change. All executable source, tests, workflow, AUDIT_PRE and VERSION stay byte-identical. B5/step 1.2 stays [A] at v1.2-pre; B6–B9, D64, Gate, installed timers and production stay untouched. No production service, VM, store, mount or history was operated. The next work unit is a separate pre-audit of the owned NATS recovery adapter, with its own exact-source review and CI. This documentation correction itself needs exact-head review and green CI before it is treated as a settled plan pointer.


### 2026-10-18 20:35 EDT — serving-NATS recovery-adapter pre-audit (D242)

The first open source prerequisite remains the serving-NATS recovery adapter. At exact source 254ef778, Claude365 confirmed the adapter-before-producer order, the three serving members' daemon class, Journal.recover's bus-first order and held-member1 check, and the existing success-path restore primitive. The D242 pre-audit in AUDIT_PRE records six required design corrections before source: begin_override_clear itself must refuse an open NATS transfer and protected writer marker; only the explicit serving-member allowlist may clear, never nats-1; per-member readiness must be satisfiable while the other two remain disabled; a positive post-third-member R3 quorum gate is a separate prerequisite before clients or the stop producer; the existing exclusion test must change; and restore_only.py must remain fixed. A disposable single-server NATS 2.12.6 monitor probe confirmed local /varz and /jsz remain readable without a meta leader, but did not test the three-member restore.

The prospective source unit changes preservation_journal.py, adds a small local-readiness helper beside restore_disabled_daemon in managed_launchd.py, and extends its journal and native owned tests. The first native gate must restore nats alone under a real owned full-node journal and hold while nats-2/nats-3 remain disabled and member1 held; later controls must restore all three and retain failure/interruption as terminal. The operator Mac already has ai.openclaw.nats loaded, so a fixed-label native fixture belongs on a clean disposable CI runner and must refuse collisions. D115's running-disabled reconciliation, survivor proof and measured production budgets remain open. StopWatch's persistent-NATS guard, D64, Gate, timers and production stay unchanged. A new open INVENTORY row places the post-restore quorum gate between this adapter and the persistent-stop producer; individual recovery-verified receipts claim local member readiness only.

This pre-audit changes six Markdown files and no executable, test or workflow file. The adapter and quorum rows remain open; B5/1.2 stays [A] at v1.2-pre and B6–B9 stay held. No production service, VM, mount, store or NATS history was operated. Exact-head review and CI for this documentation head are pending; neither the adapter nor the quorum gate is credited as implemented.

### 2026-10-18 22:45 EDT — serving-NATS recovery adapter source receipt (D243)

PR224 source lineage 029f383b → 3ab66ae1 → 18ad6e1d → 85a3ff28 makes the three explicit serving members eligible for a durable override-clear intent only after a verified persistent stop. `nats-1` stays excluded. `begin_override_clear` also checks for an open NATS transfer and the protected writer marker before appending. The journal's existing `append` freeze independently rejects an open transfer, so the explicit transfer check is an early duplicate, not an independently mutation-killed gate; the by-name `nats-1` check is redundant with the serving allowlist. `restore_disabled_daemon` still owns intent-before-enable, a new bound owner, stable generation, finite readiness budget and disabled-override reinstatement on failure. The new callback requires both saved client and monitoring listeners on that bound pid, local `/varz` with the saved member name and pinned 2.12.6 version, and loopback client-port acceptance. It does not claim a group quorum, meta leader or `/healthz` result. `StopWatch.mutate`'s persistent-NATS refusal, `restore_only.py` and D64 remain unchanged; the older D98 native stop test is byte-identical.

The scripted journal suite passed 158 tests, including serving-only admission, open-transfer and marker refusals, member ordering, held member1, and failed-readiness reopen refusal. The full local journal plus managed-launchd suite passed 223 tests on the operator Mac with five fixed-label dedicated-fixture skips. A new unique-label macOS test bound both real NATS listener ports to its real launchd pid; a separate disposable clustered lone member with two offline route peers passed the callback. Claude371 found the initial standalone-fixture and unbound-socket proof gaps; 18ad6e1d corrected them and Claude373 cleared the source. Claude375 cleared the one-line 85a3ff28 fixture correction. The first two CI attempts, 39185971987 and 39187117149, finished 7/8: the native failed-start case passed, and the success case passed the three serving-member restores before its scripted callback misclassified `scheduler-heartbeat` as held. The one-line correction lets that timer follow `RESUME_ORDER`, while only `nats-1` and `federation-tick` remain held.

Exact source head 85a3ff284c8710ae2a56be09987b352c684bb3bc passed all eight jobs on CI run 39188943858, attempt 1. The native macOS job 117857252053 passed both dedicated fixed-label cases: `test_full_node_owned_nats_failed_start_keeps_override` and `test_full_node_owned_nats_members_restore_in_order`. Its managed-launchd suite reports 65 tests OK with one unrelated user-domain duplicate-bootstrap skip. The complete native job log was retained locally at 1475 lines and SHA-256 `07e9e746ba1fcab0545588f70dac84849167d59aee0578359d2950aa51918efb`; the two case outcomes occur at lines 1339–1340 and the suite result at 1389–1391. Claude375 cleared the exact source correction before this run. The earlier two 7/8 failures remain failed evidence, not successes.

The source gate is satisfied and only the B5-serving-NATS recovery adapter row closes in INVENTORY. This receipt head still needs its own exact-head review and CI. The result is owned local evidence: non-NATS units in the fixture are scripted, member1's hold is journal state, and no positive physical R3 quorum, live inventory, reboot persistence, D115 survivor reconciliation or production readiness budget is established. The post-restore R3 quorum gate is the next open source row, followed by the persistent-stop producer. B5/1.2 stays [A] at v1.2-pre and B6–B9 remain held. D64, Gate, installed timers and production are unchanged; no production service, VM, store, mount, timer or history was operated.

### 2026-10-18 22:54 EDT — D243 native-log byte-scope correction (D244)

Claude's read-only review of receipt c30a07d2 independently verified its five-Markdown-only delta, identical D243 blocks, single adapter-row closure, frontier quorum-gate pointer, source CI result and both native fixture outcomes. It found one required evidence-pointer correction: D243's SHA-256 `07e9e746ba1fcab0545588f70dac84849167d59aee0578359d2950aa51918efb` is for the 273804-byte local file produced by `gh run view 39188943858 --job 117857252053 --log > /tmp/pr224-85a-native.log`. That CLI-formatted byte stream includes job, step and timestamp columns; it is not a checksum of the GitHub connector's raw log. The connector returned all 1475 lines with the same cited case outcomes and test-summary line numbers but a different byte stream. Read D243's digest only as the local CLI-file digest; no raw-log byte identity is claimed.

This append-only clarification changes no source, fixture, workflow, original D243 line, source-CI fact or B5 boundary. The adapter remains the sole closed owned prerequisite; the positive post-restore R3 quorum gate and persistent-stop producer stay open. B5/1.2 stays [A] at v1.2-pre, B6–B9 held, and D64, Gate, installed timers and production untouched. The corrected receipt head requires its own exact-head review and CI; no production service, VM, store, mount, timer or history was operated.

### 2026-10-18 23:32 EDT — D245 post-restore R3 quorum gate pre-audit

Micro re-orient: B5/1.2 remains [A] at v1.2-pre; the serving-NATS adapter is
closed by D243/D244, and the post-restore quorum gate is the first open source
prerequisite. No persistent-stop producer or full-node production recovery
caller exists. B6–B9, D64, Gate, installed timers and production remain held.

Required premise correction: D243's native fixture places `nats`, `nats-2`
and `nats-3` in one cluster. That proves individual per-member restoration,
not the saved role topology: `nats` is standalone, `nats-1` is held member1,
and `nats-2`/`nats-3` are the live two of three cluster members. The existing
D234 `$G` group-count assertions require seeded stream/consumer state and
cannot be copied into an unseeded post-restore meta-quorum gate.

The owned, disposable NATS 2.12.6 probe started three loopback members,
then stopped member1. Both survivors returned `200 {"status":"ok"}` from
`/healthz?js-meta-only=true`; `/jsz` identified the same live leader and
cluster size three; `/raftz` exposed `$SYS._meta_` size three, quorum two,
one leader and one follower, stable peer identities and the held peer. The
tagged 2.12.6 monitor source makes meta-only health check leader contact,
currentness and meta recovery, and exposes `size`, `quorum_needed`, `state`,
`leader`, `term`, `observer`, `paused`, `catching_up` and named peers. A sample
immediately after a stop can still report the old leader, so the gate must
wait for agreement and stability. This disposable probe is schema evidence,
not a live B3 pin or production observation.

Source contract: an owned observer takes the pinned standalone and three
member names, the two live monitor ports and a finite caller-supplied budget.
It checks standalone isolation, both live monitor identities, reciprocal
routes, healthy/current meta, the same size-three/quorum-two group and live
leader/term with exact member peer names, then stable repeated samples. A
missing, stale, isolated, catching-up, undersized or inconsistent group
refuses with bounded diagnostic evidence. The journal requires a fresh
positive callback after this recovery call verifies all three serving units
and before its first non-NATS observation or restoration when a serving NATS
member had a persistent managed stop. It records a durable group receipt;
failure leaves the original hold closed and cannot be reused on retry.

Proof: portable observer and journal refusal/ordering/reentry controls; a
role-faithful disposable Linux cluster with held member1 and a minority
negative; corrected fixed-label macOS fixture with standalone `nats` and
held member1, including a group-failure case after individual receipts.
Source review and all-eight exact-head CI precede row closure. The real
full-node driver, persistent-stop producer, live role binding, D60, reboot,
capture and production remain outside this source unit.


### 2026-10-19 00:21 EDT — D246 quorum-gate source-contract correction

D245 is a pre-audit, not a completed source claim. The owned disposable
cold-restart replay exposed one false refusal: after member1 is held and both
survivors restart, NATS 2.12.6 may report the offline member in `/jsz` as
`Server name unknown at this time (peerID: <id>)`. The source now binds every
replica and `/raftz` peer by the NATS node ID derived from its pinned server
name; the live follower's name must match exactly, while member1's `/jsz`
name may be its pinned name or that exact ID-bearing placeholder and its
`/raftz` peer name may be blank. The real four-role test stops all three
members, restores only members two and three, proves the two-of-three group,
refuses a one-member minority and accepts a survivor rejoin.

The observer needs three monitor ports: standalone `nats` and live `nats-2`
and `nats-3`. The journal requires the callback at recovery entry for any
historical serving-NATS `stop`, `unload` or `disable-and-unload` intent in
full-node scope, even before its managed proof is established. This broader
trigger fails closed. After current-call receipts for all three serving
units, and before the first non-NATS **recovery-loop** observation or
restoration, the gate also refuses if any earlier recovery error exists.
Earlier stopped-state and held-unit preflight observations are safety checks,
not client resumption. A failed gate records a group error, leaves clients
unrestored and the hold closed; a retry observes the group again.

The fixed-label macOS failure case now uses a physical partial topology:
member1 initially links the cluster, then both restored survivors retain
routes only to held member1. A disposable NATS probe confirmed each survivor
had zero routes and no leader after that restart; the native CI case must
still run. Its group callback uses the real observer and must refuse before
any client restoration. The ten-second fixture budget is a test value, not a
measured production budget. The persistent-stop producer, full-node driver,
current inventory, D60, reboot and production remain separate. The quorum
row stays open pending exact-head source review and all-eight CI.

### 2026-10-19 00:59 EDT — D247 post-restore R3 quorum gate source receipt

Source lineage fd7b958a through b81e24ebe8fd5e7d7d2bb2b23e5dd28ca4211040 implements the owned gate defined by D245 and corrected by D246. `wait_for_serving_group()` reads three loopback monitors for standalone `nats` and live cluster members `nats-2`/`nats-3`; it binds the pinned names and NATS 2.12.6 version, standalone isolation, reciprocal survivor routes, meta-only health, shared live leader and term, size-three/quorum-two Raft state and exact hashed peer identities. It accepts only the pinned held-member name or that member's exact ID-bearing offline placeholder and requires stable repeated samples within a finite caller-supplied budget. The real four-role test holds member1, cold-restarts both survivors, accepts two-of-three quorum, refuses a one-member minority and accepts rejoin.

Full-node recovery requires a supplied group callback at entry for any historical serving-NATS stop intent. It calls the observer only after fresh current-call `recovery-verified` receipts for all three serving units, with no earlier recovery error, and before the first non-NATS recovery-loop observation or restoration. A failed or partial group records an error and keeps the original hold closed and clients unrestored; retry reobserves. `journal_hold.py` passes the callback through. The corrected fixed-label CI fixture gives `nats` a standalone process and member1 the held cluster role. Its group-failure case uses a physically disconnected cold-restart topology after individual receipts, not a scripted callback failure. `StopWatch.mutate`'s persistent-stop guard, `restore_only.py`, D64 and production paths are unchanged.

Claude383's first source review identified the cold-restart placeholder refusal, missing real restart test, unpinned earlier-error bar and synthetic native failure. The corrected b81e24eb source passed Claude385's independent review with no remaining required source or proof correction. The local scripted journal suite passed 158 tests, the group observer suite passed five including the real disposable cold-restart and minority case, and the earlier-error assertion was killed by its focused mutant. Plan lint was 14 PASS, one historical VERSION-idle WARN, zero FAIL. Exact source CI run 39199540826, attempt 1: passed all eight jobs at b81e24ebe8fd5e7d7d2bb2b23e5dd28ca4211040. Linux job 117889459786 reports the journal suite 158 OK and group suite five OK. macOS job 117889459822 reports the journal suite 158 OK, group suite five OK and all three dedicated fixed-label cases OK: failed-start override retention, physical group-failure client fence and ordered successful restoration; its 66-case managed-launchd suite has one unrelated skip. The complete native CLI-formatted job log fetched from the GitHub job-log API is 1483 lines, 164707 bytes, SHA-256 80bb0ac88c23ce122b3a4f52208fc44066df081c48b79af4ab9118b84f8accf0. The three case outcomes occur at lines 1346-1348 and the managed-launchd suite result at lines 1397-1399; that digest is for the API-returned raw log bytes, not a CLI-formatted stream. Earlier superseded CI runs 39196495672, 39197546958, 39198257408 and 39198719652 were canceled and are not success evidence.

Only the B5-serving-NATS post-restore quorum gate row closes. This receipt head needs its own exact-head review and all-eight CI before the plan pointer is settled. The next source prerequisite is the persistent-stop producer. No full-node driver, live role binding, current inventory or D60 observation, reboot persistence, measured production budget or production restoration is claimed. B5/1.2 stays [A] at v1.2-pre, B6-B9 held; D64, Gate, installed timers and production remain untouched. No production service, VM, store, mount, timer or history was operated.

### 2026-10-19 01:06 EDT — D248 D247 receipt wording correction

Claude387 independently cleared D247's five-Markdown-only lineage, identical
append, one quorum-row closure and persistent-stop frontier pointer, but found
two required proof-wording corrections. First, the cited native log is the raw
GitHub job-log API text, not a CLI-formatted `gh run --log` stream. It starts
with a BOM, has timestamp-only lines without job/step columns, and its
1483-line, 164707-byte SHA-256
`80bb0ac88c23ce122b3a4f52208fc44066df081c48b79af4ab9118b84f8accf0`
covers the fetched content with one trailing newline. The cited three native
case outcomes and 66-test summary remain at D247's lines. Second, the group
callback is reached after each of the three serving units has a current-call
`recovery-verified` **or** `already-restored` row, with no earlier recovery
error. The latter is required on a valid retry; the group observation itself
is fresh in that call, never inherited from a previous receipt.

For precision, D247's held-member identity sentence covers `/jsz`'s exact
pinned name or exact ID-bearing placeholder and `/raftz`'s pinned name or
blank name for that same hashed held peer. The earlier-error assertion killed
the focused mutant, not conversely. D247's “local” 158/5 counts are Codex's
owned runs; Claude385 separately reproduced the affected suites as uid 65534.
The source CI all-eight result at b81e24eb, the native raw-log cases and the
B5 boundary remain as stated. This clarification changes five Markdown
ledgers only: no source, fixture, workflow, AUDIT_PRE, original D247 text,
INVENTORY row or frontier pointer changes. The corrected receipt head needs
its own exact-head review and all-eight CI. B5/1.2 stays [A] at v1.2-pre,
B6-B9 held; the persistent-stop producer is the first open source row. D64,
Gate, installed timers and production are unchanged. No production service,
VM, store, mount, timer or history was operated.

### 2026-10-19 01:48 EDT — D249 serving-NATS persistent-stop producer pre-audit

Micro re-orient: B5/1.2 is [A] at v1.2-pre. D243/D244 provide an owned
serving-member recovery adapter; D247/D248 add a positive post-restore R3 gate.
The first open source prerequisite is the persistent-stop producer, before an
owned capture-ready checkpoint. This still serves recoverable histories; yes,
it is the right next bounded step. B6–B9, D64, Gate and production remain held.

Needs pre-screen: the reviewed adapter and group gate are present; corrected
receipt c34494d1 passed all eight jobs on CI39202808141 and Claude389 cleared
it. The original JournaledHold, StopWatch, class_stop_proven, non-NATS fence,
NATS marker/transfer guards, and dedicated fixed-label native fixture exist.
The worktree is clean and no BLOCKED.md exists. No live B3 pin or approved
production stop window exists, so verification is owned only.

Source contract: permit persistent StopWatch.mutate only for the explicit
SERVING_NATS allowlist when each prior unit is a loaded, running daemon.
`nats-1` remains excluded, as do idle or reclassified serving units. Keep
unit-label binding, prepared kernel/process watch, original hold, disabled
before bootout, verified exit/connection/listener proof and disabled override.
The journal must refuse a protected NATS writer marker before the stop intent;
its existing forward and transfer guards still apply. The existing non-NATS
fence must pass before the first serving stop. The three stops run in saved
capture order: standalone nats, then nats-2, then nats-3. A failure at any
stage leaves durable partial/failed evidence and no capture-ready checkpoint;
recovery is the only continuation.

Delta: managed_launchd.py narrows the guard to serving daemon identities;
preservation_journal.py adds the pre-intent marker refusal and ordered serving
stop checks if the existing record-only checkpoint gate is too late; portable
preflight and journal negatives pin the new admission; the dedicated macOS
full-node fixture uses StopWatch.mutate for all three real disposable NATS
servers, checks each durable receipt and full recovery, and injects a stop
failure to prove no checkpoint. Register any added tests on both CI platforms.
No restore_only.py, release gate, production driver, timeout or installed unit
changes. An architectural expansion or two mid-implementation findings require
re-orientation before implementation proceeds.

Verify: owned positives produce one verified disable-and-unload receipt per
serving member under the same original hold; wrong class/label, nats-1,
preexisting override, missing hold, marker, partial stop and out-of-order
paths refuse for their intended reasons. Run relevant suites and mutation
controls, independent exact-source review and all-eight exact-head CI. This
is source/owned runtime proof, not live NATS, D60, reboot, image or production
acceptance. A separate reviewed green receipt may close only this source row.

### 2026-10-19 02:08 EDT — D250 serving-stop failure and live-bus incident correction

D249's statement that “recovery is the only continuation” after any failed serving stop is withdrawn. In the owned verification-failure case, `nats` is physically booted out and disabled but has a durable `failed` row instead of a verified persistent-stop receipt. `begin_override_clear()` requires that receipt, so automatic recovery refuses to clear the override; retrying does not cure it, and the 17 prior-loaded clients remain held. This is a full-node outage, not a successful rollback. The corrected fixed-label native case now calls recovery after the failure and asserts the refusal, blocked client restoration and closed hold. A failed serving stop requires a separately reviewed operator reconciliation; no automatic override-clear exception is introduced here. The case is specifically a verification refusal after bootout, not a bootout failure. Success-path recovery of all three members remains a separate positive.

The local root `npm test` incident recorded in AUDIT_PRE is wider than the initial single-file description. The Node runner may start files concurrently. Six root integration files connect to the resolved live NATS address and can submit tasks: `agent-recruit` (`recruit-`, also broadcasts a recruit signal), `collab-agent-lifecycle` (`lifecycle-`), `collab-integration` (`test-`, also creates collab sessions), `distributed-mc` (test task IDs), `e2e-collab` (`e2e-`), and `field-roundtrip` (`frt-`). Which of these reached a write before interruption is unknown. Their cancellation hooks are best-effort; a live worker may have claimed or joined a test task. No cleanup or live-state reconciliation was attempted, and residual records are unknown. No production service, VM, timer, NATS process or configuration was intentionally changed. This turn did contact the live application bus, so historical “production untouched” statements must not be repeated as a current-state claim. Local root `npm test` is excluded from subsequent verification on this host; isolated CI and owned tests are the source gate.

The new marker refusal is pre-intent only. It does not hold the legacy writer exclusion lock across a physical serving stop, unlike NATS recovery. That gap is now an explicit open source row before any live full-node stop; capture's later marker recheck does not prove stop-time exclusion. The enforced nats, nats-2, nats-3 sequence is the serving-member stop order, not a fixed order required by the capture validator. The journal's loaded/running serving-baseline check is redundant with valid full-node baseline shape. D249's successful producer evidence and the B5/1.2 boundary are otherwise unchanged; the source and this correction still require exact-head native CI and independent review before the producer row can close.

### 2026-10-19 02:16 EDT — D251 failed-stop blocked-unit count correction

D250 repeated the independent review's incorrect “17 prior-loaded clients” count. The failed `nats` stop leaves all 18 prior-loaded non-NATS units unrestored. Recovery assigns “bus recovery was not verified” to 17, including the scheduler-heartbeat timer that anchors the original hold; the deploy listener separately reports “prior restoration was not verified.” Only nats-2 and nats-3 receive restored/already-restored rows because they were never stopped. The native failed-stop case now asserts all 18 units lack restored rows, the anchor timer remains unloaded, the 17 bus errors, the listener's distinct refusal, and the closed hold. D250's fail-closed, operator-reconciliation and live-bus incident findings otherwise stand. Exact-head native CI and independent review of this correction remain required before the persistent-stop producer row can close.

### 2026-10-19 02:56 EDT — D252 owned serving-NATS persistent-stop producer source receipt

Only the B5-serving-NATS persistent-stop producer row closes. Source 95cfab3f26f4d6fa6c0ab79c6922fb8e7ade3475, following 1855078c, f8e3fcef and the D250/D251 append-only corrections, passed all eight jobs in exact-head CI run 39209196050 at attempt 1. The macOS legacy-writer-lock job's complete log has the dedicated fixed-label `failed_stop_keeps_hold`, `group_failure_holds_clients` and `members_restore_in_order` cases all `ok`, with its managed-launchd module at 68 tests `OK`. Local owned journal/managed/group suites passed 232 tests with seven operator-host native skips, and focused admission/refusal mutants were killed. Plan lint is conformant with 14 PASS, one longstanding VERSION-idle WARN, zero FAIL. Claude391 found two required proof/claim corrections, Claude393 found the inherited count error, and Claude395 found no required finding on the final source head. CI and native results here are Codex's observations; the independent review did not run the fixed-label native case.

The source admits only loaded, running serving-daemon baselines to the watched persistent stop. The Journal requires the non-NATS fence, absent protected writer marker and nats, nats-2, nats-3 stop order before each intent. Under the original execution hold, the owned macOS fixture physically stops each disposable member and records one class-specific verified disable-and-unload receipt; the existing restore adapter and post-restore group gate recover the successful path. A verification refusal after the first physical bootout writes a failed row, leaves its override disabled and the hold closed, and has no automatic recovery: the native case asserts all 18 prior-loaded non-NATS units remain unrestored, 17 with bus refusal including scheduler-heartbeat and the deploy listener with a separate refusal. That outcome requires separately reviewed operator reconciliation, as D250/D251 state; it is not a rollback.

The next open executable source row is forward writer exclusion across the physical stop. A pre-intent marker check alone is not a live stop-time exclusion. Stopped-ASIF checkpoint extraction, live role binding, current inventory/override/fresh-D60 observation, full-node driver, reboot evidence and measured production budgets remain open. The interrupted local root `npm test` contacted the live NATS bus; which of six integration suites wrote records and whether cleanup ran remain unknown. A separate open row tracks read-only residue audit and isolated root testing. No live full-node stop, VM operation, timer operation, NATS process change or configuration update was deliberately performed in this source unit; no blanket production-data-untouched claim is made. B5/1.2 stays `[A]` at `v1.2-pre`, B6–B9 held, and D64/Gate unchanged. This documentation receipt requires its own exact-head independent review and all-eight CI before its closure is settled.

### 2026-10-19 03:02 EDT — D253 current B5 frontier pointer correction

Claude397 found one required receipt defect at 3ea97523: the current B5 frontier table still called the persistent-stop producer open and named it the next source gate, although D252 had closed that INVENTORY row. The table now names D252's source 95cfab3f/all-eight CI39209196050/Claude395, points to forward writer exclusion as the next owned source gate, and shows the separate live-bus residue and isolated-root-test audit. It keeps stopped-ASIF extraction, live role binding, current inventory/override/fresh-D60 observation, original placement repair and attended recovery gates open. This correction changes no executable, fixture, prior receipt block, VERSION, B5/1.2 `[A]` status or further INVENTORY row. The D252 source proof remains unchanged. The earlier receipt run 39213079985 is retained as its own history; this corrected head needs independent exact-head review and all-eight CI before closure is settled.

### 2026-10-19 03:06 EDT — D254 preserve B5 natural-trigger and operator gates in current frontier

Claude399 reviewed 09174628 and found that D253's current B5 table row omitted two still-open gates: the unresolved natural trigger of the original R3 placement failure and the operator's separate choice to designate disposable access or decide a measured resource proposal. The current B5 row now carries both again alongside the D252 producer closure, forward writer-exclusion next source gate, and distinct live-bus residue/isolation audit. D253's corrected source pointer remains valid. This is a table correction only: no executable, fixture, prior receipt block, INVENTORY status or VERSION changes. B5/1.2 remains `[A]` at `v1.2-pre`; B6–B9 are held, D64/Gate unchanged, and no live full-node stop is released. This exact documentation head still requires independent review and all-eight CI before this receipt settles.

### 2026-10-19 05:42 EDT — D255 serving-NATS forward writer exclusion source receipt

Only the `B5-serving-NATS forward writer exclusion` prerequisite closes. Source `47ba8cd6b11ae957ad4c5b5e10ede171b8685dbe` passed all eight jobs in exact-head CI run `39226274374` at attempt 1. Linux `unit-tests (22)` passed the journal (164), capture (38), mount-wrapper (91), boot-policy (49), and all six formerly affected consumer suites and their mutation runners; the boot-policy runner completed all 46 intended-assertion kills. Its complete 24,475-line job log has SHA-256 `658e338ed0eff718ae0e163e9683063b47f3f2ad6f1916cd2e59a7cbbd5244a5`. The macOS legacy-writer-lock job passed 164 journal, 38 capture, 91 mount-wrapper and 68 managed-launchd tests; its fixed-label `failed_stop_keeps_hold`, `group_failure_holds_clients` and `members_restore_in_order` cases were all `ok` while the physical disable callback probed writer-lock contention. The complete 1,484-line, 275,338-byte native job log has SHA-256 `bd099407366cf73318feaa18d8d2564d1740f8df732d510dac46afd623a6185b`. Claude's independent exact-source review found no required finding: 52 of 55 CI-shaped Python commands passed as uid 65534, with the other three reproducing the pre-D255 parent's missing-Node-module sandbox failures; all six affected suites and their six mutation runners passed, with unchanged kill lists, and 207 tests together left `gettempdir()` restored and no fixture residue. The earlier `ca888d88`, `e1198e94`, `a9123ef7` and `06c051b4` all-eight failures remain failed evidence; none is credited as this source gate. This five-Markdown documentation receipt still needs its own exact-head independent review and all-eight CI.

Before each serving-NATS stop intent, the journal checks the protected legacy writer-lock file and ancestors, refuses an existing protected marker, and obtains a nonblocking exclusive lock on the opened descriptor. It keeps that descriptor through physical disable/bootout, process, listener and connection checks, entrypoint verification, and the durable verified or failed row. A second path-identity and marker check precedes an accepted verified receipt; matching lock identity, protected owner/mode, exclusive state and marker absence are recorded in intent and verified evidence. The frozen capture-cohort reader refuses missing, malformed or mismatched exclusion claims. The protected legacy writer enters with a shared lock, so this excludes its concurrent entry over the stop interval. Owned subprocess contention and fixed-label disposable macOS cases exercise the boundary, including the failed-stop path. This does not certify unwrapped writers or fresh future-window state; frozen evidence is a chain-verified recorded claim, not a live file observation.

The D250/D251 failed-stop outcome remains fail-closed: a physical stop can leave all 18 prior-loaded non-NATS units unrestored and require separately reviewed operator reconciliation. The interrupted local root `npm test` reached the live NATS bus; which of six integration suites wrote test-prefixed records and any remaining worker effects are still unknown. No local root suite was repeated, and no production service, VM, timer, NATS process or configuration operation was deliberately performed on the operator host; native CI used disposable resources. The next owned row is the separate read-only live-bus residue audit and root-suite isolation. Stopped-ASIF extraction, live role binding, current inventory/override/fresh-D60 observation, full held/process integration, durable admission, original R3 placement repair and its unresolved natural trigger, manual restoration and D175 remain open. The operator's separate disposable-access or measured-resource choice remains open. `B5/1.2` stays `[A]` at `v1.2-pre`, B6–B9 held, and D64/Gate unchanged; no production-data-untouched claim is made.

### 2026-10-19 05:52 EDT — D256 D255 job-log format and sandbox-attribution correction

Claude's independent review of receipt `088e2cd5` found one required wording correction: D255's 1,484-line, 275,338-byte `bd099407366cf73318feaa18d8d2564d1740f8df732d510dac46afd623a6185b` digest is of the complete text produced by `gh run view 39226274374 --job 117973221395 --log`, which includes job and step prefixes. It is not the raw Actions job-log digest. The raw native log fetched from `actions/jobs/117973221395/logs` is 1,484 lines, 164,698 bytes, SHA-256 `e2013ca9abd23308131c8e2139cd26a0329b77b889f459161be1a0e31a4880ee`; Codex and Claude independently reproduced those raw values. The three fixed-label cases, suite counts and all-eight source-CI result cited in D255 are unchanged. The Linux-22 digest `658e338ed0eff718ae0e163e9683063b47f3f2ad6f1916cd2e59a7cbbd5244a5` is of the raw `actions/jobs/117973221424/logs` output: 24,475 lines and 1,616,739 bytes. Claude's connector exposes only its last 5,000 lines, so that full raw digest remains Codex's observation.

D255's “three missing-Node-module sandbox failures” is imprecise: two independent-replay failures lacked the Node `nats` module, and the third lacked the `node` executable on Claude's restricted PATH. Each failure also occurred at the pre-D255 parent. The commit trailer's 14 PASS / one WARN / zero FAIL plan-lint result describes Codex's local checkout; a bare `git archive` omits untracked `automation.json` and `tick-logs/` and cannot reproduce that local result. Neither sandbox limit changes the source proof. This correction appends identical text to the same five Markdown ledgers only; it changes no code, test, workflow, INVENTORY status, current frontier row, VERSION or D255 source/closure claim. `B5/1.2` remains `[A]` at `v1.2-pre`, B6–B9 held, and D64/Gate unchanged. This corrected documentation head needs its own exact-head independent review and all-eight CI.

### 2026-10-19 08:04 EDT — D257 bounded root-suite isolation and live-bus incident receipt

Only the `B5-root-suite live-bus isolation and residue audit` prerequisite closes. Source `92976416a7b69e8b55ff2cd8cce2f8c16beaa90d` passed all eight jobs in exact-head CI run `39246774559` at attempt 1. The Linux Node-20 and Node-22 root jobs each passed 2,692 tests with eight expected platform skips and zero failures, including the isolation and CLI safety tests. The focused three-file replay passed 10/10 on the operator Mac under Darwin and `/bin/sh` bash 3.2; isolated integration passed 9/9. Claude independently reviewed the final source head with no required finding and used disposable decoys and PATH tripwires: the normal test called only its stubs, `%builtin` and `%func` paths refused before any CLI, and removal of the lookup check reached a real `nats-server`. The superseded f4f209e2 run had Linux job failures; it and the later 340d2e8c, ec1968ae, 6aa054d0 and 46f85982 runs were canceled after source corrections and remain non-gates. This five-Markdown receipt itself still requires exact-head independent review and all-eight CI.

The four root scripts now start a disposable authenticated loopback NATS/JetStream store and mesh-task-daemon with a temporary home, identity, scratch directory and explicit bus URL. The runner rejects unauthenticated connections and tears down its process group and files; a black-box test observed zero connections to an inherited fake bus and removal of the temporary home. Direct runs of the nine mesh-gated suites skip their live tier without the runner flag. The auth-render CLI test masks the host handoff and legacy lock, uses disposable `nats-server` and `pgrep` commands, checks both are executable, rejects a PATH delimiter in its directory, verifies the child shell resolves the disposable `nats-server`, and still requires the actual reload marker. The sibling writer-ownership test masks the host lock while keeping its handoff refusal. These are test-harness changes; no production reload code or installed NATS was modified by the source delta.

At its read-only snapshot, the incident audit found 36 current test-prefixed task records and 18 current collaboration sessions linked to the 2026-10-19 05:50–06:20 UTC window. `e2e-1792389250414-multiround` remained queued and `collab-e2e-1792389250414-multiround-1792389355130` remained active with synthetic test node IDs. Retained task owner fields were null or synthetic test IDs, with no observed real worker owner in those records. `KV_MESH_PLANS` had 11 current older `PLAN-regbug-` JSON records and no current plan JSON created in that incident window. Task/collab stream sequence and message counts were unchanged across the earlier isolated checks. Deleted revisions, transient worker claims, and any host-lock or process reload from the interrupted local root run cannot be reconstructed by this snapshot. The audit deleted or canceled no task, session or plan; the queued/active pair stays for attended operator reconciliation. This receipt makes no production-data-untouched claim.

The next owned source row is stopped-ASIF checkpoint extraction. The D250/D251 failed-stop outage still requires separately reviewed operator reconciliation. Live role binding, current inventory/override/fresh-D60 observation, full held/process integration, durable admission, original R3 placement repair and natural trigger, manual restoration, and the operator's disposable-access or measured-resource choice remain open. `B5/1.2` stays `[A]` at `v1.2-pre`; B6–B9 stay held, D64 and Gate unchanged, and no live full-node stop is released.


### 2026-10-19 12:24 EDT — D258 owned window-pin arm-binding candidate

`B5-window-pin-arm-binding` is a source candidate only; no prerequisite closes here. The capture worker loads a canonical, owner-private single-link role table before creating the arm, copies it to `WINDOW_PINS.json`, and places its digest in `ARMED.json`. Publication rechecks the private source bytes under the arm lock and pins the copied bytes in `CAPTURE.json`. Frozen verification, the journal mount, the content matcher and their diagnostic/policy consumers use only that arm-bound table. The post-capture free table arguments and mount CLI table path are removed. The existing abort input envelope also retains the table bytes; the original arm binding continues through release and restore-prior decisions. Both production refusals remain.

Local focused verification passes twelve new pin-binding tests and four intended mutation kills, the real macOS hold-facade test and the corrected canonical-input test (fourteen together), and the existing thirty-eight checkpoint tests. Six affected mutation runners pass their positive controls and all 212 intended kills: device 12, reader orchestration 4, boot policy 46, held-job comparator 45, managed-job observation 55, process envelope 50. An exploratory 505-case regression had one failure in the migrated canonical-input test and two skips; that test was corrected and the envelope controls and all fifty mutants passed afterward. A clean aggregate rerun is in progress, so no clean aggregate result is claimed in this candidate. Exact candidate review, all-eight CI and the updated native ASIF reader are still required. Parent `bb3f0ee8` run `39280008924` attempt 1 has passed its native ASIF job, including both three-test identity replays and 24 intended device kills; its all-eight conclusion is still pending. The two older test carry-forward rows stay open.

This is content binding to the arm, not protected B3 provenance: identical bytes regenerated later are indistinguishable, and coordinated host-plus-image rewrites by the same uid retain D189's limit. The next two named gates are this candidate's exact-source/native/CI verification and `B5-protected-acceptance-root`. The latter awaits the operator's choice of independent host authority, protected path and interactive-sudo-per-window or restricted-helper model before implementation. The design question grants no installation or production authority. Real-window B3 origin/live role binding, protected acceptance, D62 admission, D175, full native pipeline and disposable-macOS reboot evidence remain separate. D250/D251 incident limits remain; B5/1.2 stays `[A]` at `v1.2-pre`, B6–B9 held, and D64/Gate unchanged. No production operation occurred in this source unit.


### 2026-10-19 13:10 EDT — D259 owned window-pin arm-binding proof receipt

`B5-window-pin-arm-binding`, `B5-test-nonroot-identity` and `B5-test-failed-attach-retention` close only as bounded owned-source prerequisites at `8f82078421fbf19e1529892a6cc216f5b050775b` (sole parent `bb3f0ee8112ec75779c1ea652de488d352c4963d`). B5/1.2 remains `[A]` at `v1.2-pre`; the stopped-ASIF extraction row and protected acceptance root remain open.

Claude Message 49 reviewed that exact source with no required findings. Its byte-identical isolated Linux export replayed 29 portable test commands (1009 tests, all OK with platform skips) and 16 mutation runners (457 intended kills), including all 216 kills in the seven affected runners. Its seven additional adequacy mutants killed four changes; the fresh-read survivor was equivalent under the frozen identity comparisons, and the publication/matcher bind survivors were defence-in-depth. Those two calls are not independently mutation-enforced. The six non-blocking notes require no source correction; D189's existing same-uid check/read race remains.

[CI run 39285492438](https://github.com/moltyguibros-design/openclaw-node/actions/runs/39285492438), attempt 1, completed success with all eight jobs green for that head. CI checked out merge `2f24d0d115318e6d98e0e695ee4f20f280ea70fb`; the recovery plan tree and workflow compare byte-identically to the reviewed head. Linux job `118170119067` and macOS legacy job `118170119570` each executed the new 12-test suite and all four intended window-pin kills. The clean local aggregate also completed 545 tests OK (two platform skips), plus 216 intended kills across the seven affected runners.

Reproducible log pointers use the raw bytes returned by `gh api repos/moltyguibros-design/openclaw-node/actions/jobs/JOB/logs`, not the prefixed output of `gh run view --log`: Linux `118170119067` = 1,619,202 bytes / 24,491 lines / SHA-256 `1159300c0837621bf30f14e61ea3d67bb13d9c81c19ffe6d01957bb03192a411`; macOS legacy `118170119570` = 165,788 bytes / 1,496 lines / `e8d0476daf3c2fef85c10b6cb56dc1fecbc936056f8935a2c2a376e5dbda01d7`; native reader `118170119041` = 20,058 bytes / 228 lines / `068a10b00938bc6e8a7808aa55b319e26c90df6fd3c9e538242fbe94fd8e09a1`.

The native reader job passed the three focused tests under both user and `sudo -n -H` callers, both 27-test mutation baselines, and all 12 device/identity/attach mutants per caller (24 total). This supplies the root/nonroot and failed-applied-attach evidence for the two old carry-forwards; Claude Message 43 had independently cleared their source at the parent. Artifact `12203471767` (`asif-mount-ownership-2f24d0d115318e6d98e0e695ee4f20f280ea70fb`) contains completed, clean reports: `asif-mount-ownership.json` SHA-256 `132e5ef6885bf0dbbd01a16ddc1a36001a2e9f016276b032f6f5a687df63290c`, and `stopped-asif-reader.json` SHA-256 `5f8ea7cf1f98554e46410ee03ab62b3e8ea80ddc14ed3b96a0acc188d6eafdda`. The intact case read 54 files; all four altered cases refused, every case retained identical before/after image metadata and bytes, and cleanup was clean. This is a synthetic owned ASIF reader, not a VM shutdown or production acceptance. Its direct publication helper uses the copied table as its source; the original-source publication recheck is proved by the portable worker-path negative, not by this native report.

Feeds landing: `WINDOW_PINS.json` is loaded before the arm and consumed through arm/capture pins by the frozen verifier, mount reader and policy consumers; the abort envelope retains its bytes. This closes content binding only. Identical regenerated bytes remain acceptable, coordinated host-plus-image rewrites retain D189, and no protected B3 origin or installed production consumer is claimed. The next decision is `B5-protected-acceptance-root`: the operator must choose the independent host authority, protected path and interactive-sudo-per-window or restricted-helper model before implementation; owned protected-record source and proof follow that decision. No installation authority follows from this receipt.

Real-window B3/live role binding, current inventory/override/fresh-D60 observation, full held/process integration, durable admission, original R3 placement repair and its unresolved natural trigger, manual restoration, D175 and disposable-macOS reboot evidence remain separate. D250/D251's incident and attended queued/active-task reconciliation remain. B6–B9 stay held and D64/Gate unchanged. No production service, VM, timer, image or history was operated on. This documentation receipt makes no claim about its own future CI or review.


### 2026-10-19 13:18 EDT — D260 correction to D259's attributed mutation total

This append-only correction supersedes D259's phrase "16 mutation runners (457 intended kills), including all 216 kills in the seven affected runners." Claude Message 51 found that its Message 49 summary had placed the batch total next to the affected-runner subtotal without separating the later replay: the 16-runner batch produced 457 intended kills and included 212 of the affected 216; `mutate_stopped_asif_reader.py` then ran separately and produced four more. The correct combined review total is **17 runners and 461 intended kills (457 + 4)**, including all 216 affected-runner kills. The seven-runner 216 subtotal and Codex's local 216 result are unchanged. D259 remains byte-for-byte intact as the original receipt.

For completeness, one of Claude's 29 portable commands initially failed because `node` was absent from its isolated sandbox PATH. Its corrected-PATH replay passed all 11 tests. This was a local sandbox test replay, not a GitHub Actions rerun, root proof or native observation.

Message 51 otherwise cleared D259's three closures, exact source/CI and merge-tree attribution, artifact pointer, proof limits and preservation of prior ledger content and remaining frontier holds. This correction changes no executable, row status, frontier cell, VERSION, raw-log/report hash or CI claim. Source `8f820784` remains bound to all-eight successful run `39285492438`, attempt 1. B5/1.2 stays `[A]` at `v1.2-pre`; protected-root authority, stopped-ASIF extraction and the remaining B5 work stay open, B6–B9 held and D64/Gate unchanged. No production operation occurred, and this correction makes no claim about its own future CI or review.


### 2026-10-19 13:26 EDT — D261 interactive per-window host authority, owned implementation only

The operator's “go” answers the explicit question whether to proceed with the recommended interactive-sudo-per-window model for owned code and tests. That model is selected, with proposed protected path `/private/var/db/openclaw-recovery/acceptance`, root-owned 0700 directories and 0600 records. This resolves the design choice recorded as pending in D258–D260; it authorizes no installation, persistent helper, sudoers change, production operation or recovery window.

The first source slice is a protected byte anchor and a reader that actually reopens that anchor under the same independent host authority. A post-capture anchor does not attest pre-stop provenance, B3 origin, semantic B8 acceptance, boot-denial continuity or durable ACCEPTED/ABORT. The future privileged invocation must use a reviewed root-controlled interpreter/program/dependency closure; elevating a user-writable checkout is not independent authority. No such production program or directory is installed by this unit. Its real owner-isolation proof runs only on fresh disposable CI resources; local tests remain unprivileged and isolated.

`B5-protected-acceptance-root` is in flight. Its bounded implementation/proof contract follows the independent pre-audit; exact-source review and all-eight CI are required before any source-readiness claim. The production capture and mount refusals remain. Stopped-ASIF extraction, installed protected provenance, live role binding, current inventory/override/fresh-D60 observations, full held/process integration, durable admission, original R3 placement repair and natural trigger, manual restoration, D175 and disposable-macOS rehearsal remain separate. D250/D251 incident limits and attended queued/active-task reconciliation remain. B5/1.2 stays `[A]` at `v1.2-pre`, B6–B9 held, D64/Gate unchanged.

Local candidate proof: 28 focused tests pass, and all 18 designated source mutants fail at their intended assertions with the unmutated controls passing. The existing checkpoint, window-pin and journal-mount regression batch passes 139 tests with one platform skip. All four new Python files parse as Python 3.9; local plan lint is 14 PASS, one existing idle-version WARN, zero FAIL. These are unprivileged owned/scripted results. The Linux/macOS distinct-owner probes and macOS native ACL controls are wired into CI but have not executed for this candidate. Independent exact-source review and all-eight exact-head CI remain pending; no prerequisite closes in this candidate.


### 2026-10-19 14:01 EDT — D262 protected-anchor CI environment corrections

The D261 candidate `a70986339a732e4a6975f134cce5d644303ee43a` is not source-ready. In run39297114041, native job118212383933 refused the interpreter's directory ownership/mode in `trusted_runtime()` before publishing an anchor; its subsequent ASIF probes did not run. Linux job118212383850 failed its new 28-case scripted suite (8 failures, 12 errors), because the ACL predicate refused inherited runner-path ACL metadata before the designated assertions. Neither failure is an acceptance result and no row closes.

The CI probe now characterizes the fixed existing system-interpreter candidates without privilege, using the same interpreter/stdlib/module ownership predicate, and selects only one that passes. The root-installed program still repeats the entire trusted-program and interpreter check under `-I -S -B`; no validation is disabled, no runtime is installed and no system permission is changed. The local read-only characterization passes for the existing Command Line Tools interpreter; this does not establish that candidate's availability or protection on CI.

CI creates its capture input tree under a fresh, protected-parent fixture, hands only that private input leaf to the capture uid, and retains a separate root-private program/record tree. On Linux it removes inherited ACL metadata only from those freshly created fixture objects before use. It never changes an existing ancestor, runtime or production path. The scripted portable class explicitly simulates ambient ACL observations as well as the root-store owner; dedicated ACL predicate tests and the real native proof retain the unchanged refusal. Native cases also refuse a wrongly owned or writable program inside the root-private test tree. The capture user cannot access that tree while those negative metadata cases run.

Local corrected proof:31 focused tests OK and19 intended assertion kills, with a passing unmutated baseline; the four files and the embedded CI bootstrap parse as Python3.9. The earlier139-test checkpoint/window/mount regression result is retained on unchanged existing runtime/test modules. Exact corrected-source review, all-eight CI and completed distinct-owner reports remain required. The source byte-anchor row and full protected-acceptance-root row stay in flight; actual frozen-reader receipt integration, installed authority, B3 provenance and acceptance/admission stay open. B5/1.2 remains `[A]` at `v1.2-pre`, B6–B9 held, D64/Gate unchanged, and no production operation is authorized or performed.


### 2026-10-19 14:19 EDT — D263 decisive trust, bytecode and byte-chain proof corrections

Claude Message57 reviewed immutable candidate a7098633 and reproduced28 tests/18 designated kills, plus a real Linux root-versus-uid65534 positive/rewrite refusal. It found no publication, descriptor/TOCTOU or protected-comparison defect, but required three proof corrections: independently exercise the real trusted-path/module checks; address executable cached bytecode rather than source metadata alone; and independently break every declared byte-chain link. These remain required findings against that earlier candidate, not a cleared review of later source. D262's c01d4ea8 also remains a candidate.

R1: the portable suite now exercises the actual trusted-path reader on a root-controlled system file and on nonroot file metadata, requires a root-controlled parent, and checks a nonroot module inside otherwise allowed search paths. The native probe refuses a writable program, a wrongly owned program, a wrongly owned program parent, and missing isolation. Its intentionally wrong program metadata remains inside an inaccessible root-private outer tree, so the capture uid cannot tamper with code during those negatives. Each portable trust boundary has a designated assertion mutant.

R2: every privileged invocation now supplies `-I -S -B -X pycache_prefix=PROTECTED_ABSENT_PATH`. The anchor requires the prefix to be exactly `bytecode-disabled` beside the verified root-controlled program, requires it to be absent and checks its parent. The CI bootstrap uses a separate fresh prefix beneath root's private home. This prevents default per-module cache loading for the intended invocation; `-B` alone does not. An owned two-process experiment executes a deliberately fresh forged cache without the prefix, then reads the authentic source with the absent prefix and creates no cache directory. Prefix validation and its required runtime call each have killing mutants. These checks detect misinvocation; they cannot retroactively authenticate a tampered interpreter or already executed code. Trusted launch and full installed dependency provenance remain separate prerequisites.

R3: negatives independently corrupt COMMITTED-to-arm, arm-to-table, ACK-to-COMMITTED, CHECKPOINT-to-COMMITTED and CHECKPOINT-to-ACK while rebinding every other digest. Each CAPTURE pin, both fixture-identity halves, clone size/type and stopped state have their own negatives and designated mutants. A late coordinated rewrite still passes the user-side commitment checks but refuses the protected root comparison.

The native store now sits under a fresh root-owned0755 parent in the CI fixture area, separate from the private program tree, so the capture user's denial is attributable to the store rather than root's home. The probe prints each completed privileged case for partial-log evidence. Linux runs it in a separate final step; macOS runs it after the existing ASIF characterization and frozen-reader probes. No existing runtime or system permission changes. An authority's program hash, interpreter, root and cache-prefix changes deliberately make old anchors unverifiable; there is no automatic compatibility migration.

Corrected local proof is40 focused tests OK (14.522s),40 intended assertion kills with baseline passing, Python3.9 parsing including the embedded bootstrap, and clean diff checks. Existing host/checkpoint/mount runtime and regression files remain unchanged. Earlier c01d4ea8 CI run39299208154 native job118219627590 completed19 owned anchor cases and cleanup, selecting the protected existing Command Line Tools interpreter; this establishes CI availability, not corrected-source readiness. The new exact head still requires its own completed owner/ACL reports, independent review and all-eight CI. No row closes here. Protected reader-receipt integration, installation/launch provenance, pre-stop/B3 origin, semantic acceptance and later admission remain open; B5/1.2 stays `[A]` at `v1.2-pre`, B6–B9 held and D64/Gate unchanged.


### 2026-10-19 15:08 EDT — D264 protected byte-anchor source proof and coverage correction

This append-only correction supersedes D263's sentence "Each portable trust boundary has a designated assertion mutant." The designated trust-check mutants cover the program check, required root-controlled parent, file metadata, loaded-module file checks, cache-prefix policy and its required runtime call. They do not separately enforce `trusted_path(sys.executable)`, `trusted_path(sys._base_executable)`, each `sys.path` entry check or `sys.path[:] = paths`. Those checks remain in the implementation; no exhaustive trust-boundary coverage or installed-runtime provenance proof is claimed. D263's authority-context invalidation statement describes implementation behavior, not a separately mutation-proven compatibility or migration guarantee. Nothing relies on it to admit a changed installation.

Only `B5-protected-byte-anchor source` closes, at source `e2bffb7cd17d4bf19b0a8f0e9c2e061babcbc617` (sole parent `c01d4ea8c658dec204ef00eac3bb9b6b9ce861a5`). Claude Message 59 confirmed the three Message 57 corrections: 40 tests OK and 40 intended assertion kills as uid 65534, independent byte-chain edge corruption, the decisive forged-cache experiment, and all 20 end-to-end Linux probe cases with cleanup. Its sole required correction was the coverage sentence narrowed above; it requested no further code change. Its temporary sudo rule existed only in its cloud sandbox and was removed. This receipt's own review is separate.

[CI run 39301653593](https://github.com/moltyguibros-design/openclaw-node/actions/runs/39301653593), attempt 1, completed success with all eight jobs successful for that exact source. Merge `ee5165826e901589452d6909202df4f2fb2e21ca` has the reviewed source as a parent; its recovery-plan tree and workflow compare byte-identically. Linux job `118228104376` and macOS legacy job `118228104285` each ran the 40-test suite and all 40 designated kills with passing unmutated controls. No earlier candidate run substitutes for this result.

The Linux distinct-owner report completed 20 cases (capture uid 1001, authority uid 0); the macOS report completed 21 (capture uid 501, authority uid 0), including the native ACL case. Both report `root_fixture_cleanup: removed` and trusted-program SHA-256 `81611cd363a09bc0a16ee55c830ae801c401ac9b56e68b5c6e06a7827856a554`, matching the reviewed source. The protected store, its accessible protected parent and the separate private program tree are fresh CI fixtures. Coordinated capture-user rewriting refuses through the actual protected reader. No local elevated probe or production operation was run for this unit.

Retained proof: artifact `12212920193`, `capture-anchor-linux-ee5165826e901589452d6909202df4f2fb2e21ca`, contains `host-capture-anchor.json` SHA-256 `5eee25023a66a203d0ed26b0ff26ce5fb05970b1f625369ae68e7b9f10f2980a`. Artifact `12211157846`, `asif-mount-ownership-ee5165826e901589452d6909202df4f2fb2e21ca`, contains the macOS anchor report `50937b8d3a228e532d71214d99c2bd727f59bba43048691c1cf8c9079ed950cf`. That job also completed its existing synthetic owned ASIF and frozen-reader probes with clean cleanup; this is neither a VM rehearsal nor real-history acceptance.

Raw log pointers use exactly the bytes returned by `gh api repos/moltyguibros-design/openclaw-node/actions/jobs/JOB/logs`, not `gh run view --log`: Linux `118228104376` = 1,628,694 bytes / 24,605 lines / SHA-256 `8c604d84b64300c36dcc583f50b391f02f922043672d7cb9cffeb0cbab10ffed`; macOS legacy `118228104285` = 169,586 bytes / 1,548 lines / `be6a8d21ed348848de704bacebcce021886408697ae061f855a525344ecc9932`; native macOS `118228104223` = 22,497 bytes / 256 lines / `3c63915c372d27e1d67c37ba1a6d5cfed7b3dedee7ec019833d656bc1a3a763f`.

Feeds landing is byte-only: an independent owner preserves a post-capture record and clone snapshot, and its protected reader reopens and compares those bytes. This closes neither `B5-protected-acceptance-root` nor stopped-ASIF extraction. The next source gate is actual protected frozen-reader receipt/acceptance integration; installation and trusted launch/dependency provenance need separate authorization and proof. The next native gate needs full owned pipeline/APFS reattach and disposable-macOS reboot/login/process/hold/D175 evidence, with the operator separately designating an exact disposable machine or deciding a measured disk/memory budget and capacity source. B3/live role binding and current inventory/override/fresh-D60 observation remain just-in-time; full held/process integration, durable admission, original R3 placement repair and its unresolved natural trigger, manual restoration, D175, D250/D251 incident limits and attended queued/active-task reconciliation all remain open.

The parent protected-root row and B5/1.2 stay `[A]` at `v1.2-pre`, B6–B9 stay held and D64/Gate is unchanged. Production capture/mount entry remains disabled; no production service, VM, timer, image or NATS history was operated on. This documentation-only receipt changes no executable and makes no claim that its own future CI or review has passed.


### 2026-10-19 15:22 EDT — D265 owned quorum-fixture budget and failure evidence candidate

The D264 receipt's run39308471837 is not all-eight green: macOS legacy job118251575729 failed in the unchanged real serving-group test before the anchor tests ran, reporting `nats-2: meta leader or group size differs` after its ten-second cold-restart budget. Raw job-log bytes from `gh api repos/moltyguibros-design/openclaw-node/actions/jobs/118251575729/logs` are 29095 bytes/300 lines/SHA-256 aa994867cfabb8026a2306e1bb97b12584c57e886d0df82a283626e55db2dc58. This does not replace e2bffb7c's successful all-eight source run39301653593 or Claude61's clear D264 receipt review.

Six fresh, unprivileged four-loopback-server runs complete cold recovery, minority refusal and rejoin, with cold positives between5.448 and9.981 seconds. None reproduces the CI failure. The [tagged NATS2.12.6 Raft source](https://github.com/nats-io/nats-server/blob/v2.12.6/server/raft.go) uses four-to-nine-second election timers; the observer also requires a full second of stable agreement. The old test budget leaves inadequate allowance, but the CI event's actual trigger remains unknown because that job retained neither monitor snapshots nor server logs. This is not a harmless-flake or proven-cause claim.

Only the owned real fixture's positive phases now use a thirty-second test budget. Its two-second minority negative and the observer's actual predicates, stability window and caller-supplied production budget contract are unchanged. A test-local wrapper retains phase, budget, elapsed time, last endpoint responses/errors and the propagated refusal. Before normal child cleanup and removal of its private tree, a failing real test prints bounded server-log tails and phase evidence; it then reports each child exit observation. Successful runs print phase durations and cleanup. This supplies future failure evidence; it does not establish a production timing guarantee or certify an unobserved cleanup failure.

Local corrected proof: seven tests OK in12.741s, including the real NATS2.12.6 cold/minority/rejoin control; its positive phases take6.307 and2.023 seconds. The four designated assertion mutants are killed with a passing portable baseline: shortened positive budget, swallowed refusal, lost monitor snapshot and lost phase. A separate injected observer refusal retains the primary error, phase and server logs, reaps all four owned children (some exit by SIGTERM, not exit0) and removes its own tree. Both changed Python files parse as3.9. Exact-source review and all-eight CI remain required; no new row closes in this candidate.

`B5-CI-serving-group-settle` is the immediate owned source/proof gate. Claude63's read-only integration pre-audit identifies the following prerequisite: a pure six-record byte verifier and explicit guest-file/protected-writer owner parameters, preserving existing path wrappers and semantic checks. Root-controlled mount/receipt integration follows that prerequisite, including a held clone descriptor and a root-owned copy to avoid a user-path attach race. Guest/capture uid equality, same-volume/APFS availability and installed trusted launch remain separate facts to establish; no production assumption is adopted from that design. No protected receipt or root-run journal acceptance is claimed here.

The historical byte-anchor source closure remains bounded by D264. Protected acceptance and stopped-ASIF extraction, B3/live role binding, current inventory/override/fresh-D60 observation, full held/process integration, durable admission, original R3 placement repair and its unresolved natural trigger, manual restoration, D175, native full pipeline and disposable-macOS access/reboot evidence remain open. D250/D251 incident limits and attended queued/active-task reconciliation remain. B5/1.2 stays `[A]` at `v1.2-pre`, B6–B9 held, D64/Gate unchanged. No production NATS process, service, VM, timer, image or history was operated on, and no local elevated test ran.


### 2026-10-19 15:35 EDT — D266 fixture failure-path and sibling-budget corrections

Claude Message65 rejects candidate bdd535a7 as source readiness, despite its three successful real NATS2.12.6 replays and four designated kills. R1: a non-UTF-8 log byte made the new diagnostic raise before cleanup, replacing an injected refusal and leaving three sandbox processes; the reviewer removed them. R2: the same CI job's fixed-label native recovery positive still used ten seconds for the identical group observation. D265 remains intact as the earlier candidate, not a closed proof or established CI cause. Its superseded run39310621066 was requested cancelled after these source findings.

The corrected diagnostic seeks to the last16KiB of each owned server log, reads that bounded byte tail and decodes with replacement. A diagnostic failure is recorded without replacing the primary refusal. Every child stop and exit observation is attempted independently; one failed stop cannot skip later children. Cleanup and log-close errors are retained, and the first cleanup exception is raised only when there is no primary error. An unobservable or unsuccessfully stopped child is reported as such, never certified reaped. Cleanup emits one combined report rather than a cumulative report per child.

Three committed regressions execute the actual RealGroup failure control flow with scripted children and real owned temporary files. A corrupt-byte log must retain the original refusal, bounded tail and reaped children; a log-read failure must retain the original refusal and complete child cleanup; a failed child stop must preserve the original refusal and still attempt the other children, explicitly retaining the simulated unreaped child. The monitor-error branch also has its own control and designated kill. These are portable failure-path tests, not native process proof.

The sibling fixed-label native callback now calls the same test-local observer. Its positive phase uses thirty seconds, its deliberately isolated negative keeps ten seconds, and the separate real-group minority keeps two seconds. It retains the callback's actual phase/budget/observations. No serving_nats_group.py, recovery, hold, journal or admission predicate changes. This is an owned fixture budget, not a measured production timing promise.

Corrected local proof:11 tests OK in11.742s, including real NATS2.12.6 cold/minority/rejoin; positive phases7.061 and1.936 seconds, minority refusal2.042 seconds, all four current children observed at exit0. The mutation baseline's ten portable controls pass and all eight designated mutants die at their intended assertions. The scripted managed-launchd preflight class passes23 tests. All three changed Python files parse as3.9. The fixed-label native sibling and all-eight CI still require this corrected source's own run, and the corrected delta still requires independent exact-head review. No local launchd fixture or elevated probe ran.

No prerequisite closes in this correction. B5-CI-serving-group-settle stays `[A]`; the failed receipt event's actual trigger and the older R3 placement/natural-trigger item remain unknown. The historical D264 byte-anchor source proof is unchanged. Pure frozen-byte/explicit-owner work remains the next prerequisite after this gate, followed by actual protected reader integration and its native owner/mount proof. Every remaining D265 B5/1.2, protected acceptance, stopped-ASIF, live-role/inventory/D60, held/process, admission/manual/D175, disposable-macOS access/reboot and D250/D251 incident/reconciliation item stays open. B5/1.2 remains `[A]` at `v1.2-pre`, B6–B9 held, D64/Gate unchanged. No production service, NATS process, VM, timer, image or history was operated on in this source unit.


### 2026-10-19 16:22 EDT — D267 owned quorum-fixture source proof and access refresh

Only `B5-CI-serving-group-settle` closes, at source `36946f55106f3011b41738a189ec39f3e55eb539`, sole parent `bdd535a77b2b631abdcb45807e1e536470b504fd`. Claude Message67 has no required findings: both Message65 corrections hold, two real-NATS suite runs each pass11 tests, and all eight designated assertion mutants are killed with passing controls. Its plain and corrupt-UTF-8 real-NATS injections preserve the identical primary refusal, retain evidence, reap all four owned children and remove their tree; one child reports SIGTERM/-15 rather than exit0. Its corrected Linux managed-launchd export executes23 tests and skips45 platform cases out of68; the first export's missing workspace-bin file was a sandbox error. Success-path cleanup errors, failing poll and failing log-close paths remain untested; no exhaustive failure-path claim follows.

[Run39312416398](https://github.com/moltyguibros-design/openclaw-node/actions/runs/39312416398), attempt1, completed success with all eight jobs successful for that exact source. Merge `c8cc0d9dce6c87fdc1c6859c44f80a8fb640f523` has that source as a parent; its recovery-plan tree and workflow compare byte-identically. Linux job118265141225 and macOS legacy job118265141340 each pass the11-test group suite and all eight intended kills with passing unmutated controls. Their real cold/rejoin phases take6.161/1.956s and9.757/4.971s respectively; the minority negatives take2.042/2.118s under the unchanged two-second budget. Each current real-group cleanup observes four exit0 children and no diagnostic errors.

The actual macOS fixed-label callback executes both paths: its deliberately isolated group refuses after10.093s under the unchanged ten-second negative budget, and `test_full_node_owned_nats_group_failure_holds_clients` passes. The positive returns verified group evidence after6.894s under the thirty-second owned budget, and `test_full_node_owned_nats_members_restore_in_order` passes. These are owned native fixtures, not production observations. Runtime quorum predicates, recovery, hold, journal and admission behavior remain unchanged. The superseded candidate run39310621066 is completed/cancelled, not a readiness result. The failed receipt run39308471837's actual trigger and the older R3 placement/natural-trigger item remain unestablished; this result proves neither cause nor a production timing guarantee.

Raw bytes returned by `gh api repos/moltyguibros-design/openclaw-node/actions/jobs/JOB/logs`: Linux118265141225 =1629729 bytes/24616 lines/SHA-256 `b67a512036383769d7661fdf03beefc9f6a5a9e37803e063aacd156c755d0ac7`; macOS118265141340 =194139 bytes/1562 lines/`bc4c56811d6aa703162ae95be770cdd1f10e6c961e86cffc7181340da73a8d8f`. These are raw job logs, not prefixed run-view output.

The separate `HOST_MACOS_ACCESS_ASSESSMENT_20261019.md` records the15:53–16:02 EDT read-only host refresh:33.497GiB free,64GiB physical memory, only production macOS and the Alpine physical bundles, no observed installer or external disk mount, and an official Apple metadata query refused by its restore catalog service. Installer availability/size, a production-image growth allowance and a sufficient memory reserve remain unestablished. Production state/image identity/holder are unchanged across each assessment step; no image contents, VM configuration or production service were operated on. Operator-owned `B5-macOS-access` still needs an exact disposable macOS designation or a fixed disk/memory budget and capacity source after those measurements; D62 rehearsal and B5 closure remain held. This assessment authorizes no provisioning, second macOS guest, reboot or installation.

The next source gate is pure six-record frozen-byte verification with explicit guest-file owner and protected-writer uid, preserving existing path wrappers and checks (Claude63). It needs owned portable/distinct-owner CI proof, independent exact-source review and all-eight CI under existing B1/D261 source authority. Actual protected frozen-reader integration follows, with a trusted dependency closure, held descriptors/locks, a root-owned copy hashed against the anchor, real semantic verification and a protected receipt; its distinct-owner native image/cleanup proof is separate. No production owner equality, same-volume/APFS availability, installed launch authority or acceptance is inferred.

All remaining D266 protected-acceptance-root, stopped-ASIF, live-role/inventory/fresh-D60, held/process, durable admission/manual restoration/D175, original R3 trigger, disposable-macOS and D250/D251 incident/reconciliation items remain open. B5/1.2 stays `[A]` at `v1.2-pre`, B6–B9 held and D64/Gate unchanged. This documentation-only receipt changes no executable and makes no claim that its own future CI or review has passed.


### 2026-10-19 16:40 EDT — D268 frozen bytes and explicit owner-context source candidate

The operator's next go advances only `B5-frozen-byte-owner-context`, the Claude63/D267 prerequisite to protected frozen-reader integration. The existing reader equates the guest-file owner with the caller and its record-only writer check uses NATS_ROOT_UID. Those assumptions cannot serve a future root reader of a nonroot guest tree. No production owner relationship is inferred or changed here.

host_guest_commit now exposes commitment_from(files), captured_from(files) and verify_frozen_bytes(files, records, *, configs, binary, home, writer_uid) over exactly six supplied record byte strings. Existing commitment, checkpoint, capture-pin and arm/table checks are shared with the path wrappers, not copied into another semantic verifier. require_captured/require_committed and verify_frozen_checkpoint retain their public signatures and pin-before-provenance patchpoints. The current wrapper supplies preservation_journal.NATS_ROOT_UID dynamically, so fixture patches and the live selected writer context are not frozen by an import-time constant.

The protected-writer uid is explicit through verify_capture_checkpoint, capture_cohort and stop_writer_exclusion_proven. Journal.capture_ready passes its existing current NATS_ROOT_UID. Guest ownership is explicit through stopped-image directory/file/lock/Finder checks and read_inputs; read_inputs without an owner keeps the current-caller policy. Live Journal Finder checks pass their current uid. The new verify_stopped_bytes(files, root, *, owner, writer_uid) requires both contexts, validates their integer/nonnegative shape before guest reads, pins supplied capture bytes before selection and runs the same semantic verifier. It reads the guest tree only, never a capture pathname. It is not a mount wrapper, trusted-launch proof, protected receipt, physical exclusion claim or admission path.

Owned local proof:15 focused tests pass; thirteen designated mutants fail at their intended assertions with a passing full focused baseline. The capture pathname is renamed away and capture-file/caller-uid accessors refuse while byte helpers and stopped-byte composition return the path verifier's summary without changing their supplied bytes/records. Correct writer context survives a different module global, wrong context refuses, current-owner wrappers remain current-owner, and directory/file/lock/Finder and malformed-context negatives refuse. The reachable byte-verifier AST check follows the imported validators and parser methods; it is a static named-call check, not general interpreter or installed import-provenance proof.

Existing regression batch: Ran207, OK with one platform skip (206 executed), including the checkpoint/host commitment/window-pin/stopped-input/mount suites; the40 anchor tests and two Journal Finder regressions also pass. Existing window-pin, native-device, stopped-reader-orchestration and anchor mutation runners retain4/12/4/40 intended kills with passing controls. Changed/new Python sources parse as3.9; workflow YAML parses; plan lint is14 PASS/one existing idle-version WARN/zero FAIL. These local runs are unprivileged; no local root suite, elevated probe, mount or launchd fixture ran.

CI wires the15-test suite and thirteen mutants into Linux22 and macOS legacy. A new explicit CI-only root probe constructs its own honest capture and guest tree, changes only that fresh guest tree to uid65534, requires writer uid0, exercises real owner refusals including the unchanged current-owner path wrapper, restores deliberate negative metadata and requires cleanup before publishing a diagnostic report. It is wired on Linux and macOS; its real distinct-owner cases have not yet run for this candidate. Its output is not a protected acceptance receipt. Independent exact-source Claude review and all-eight CI remain required; no row closes here.

The next source gate after this prerequisite remains actual protected frozen-reader integration: a trusted root-controlled dependency closure, held capture descriptors/locks, a root-owned copy hashed against the anchored clone, real semantic verification and a protected receipt with native distinct-owner image/cleanup proof. Installation/launch provenance and guest/capture uid or same-volume/APFS assumptions remain separate. All other D267 protected acceptance, stopped-ASIF, live-role/inventory/fresh-D60, held/process, admission/manual/D175, original R3 trigger and D250/D251 incident/reconciliation items stay open. Operator-owned macOS access/budget still blocks D62 reboot rehearsal. B5/1.2 stays `[A]` at `v1.2-pre`, B6–B9 held, D64/Gate unchanged; production capture remains disabled and production untouched.


### 2026-10-19 16:52 EDT — D269 preserve existing owner-helper consumers

The source review of a74df78c identifies a required caller correction. D268's local207-test regression batch did not include the boot-policy and process/job-observation consumers of stopped_journal_inputs.private_dir. Seven existing calls, including the two re-exported as envelope.private_dir, omit its new required owner keyword. The existing boot-policy boundary test also calls content without that keyword. A direct local replay reproduces its TypeError; an initially partial caller correction still leaves35 errors in the256-test consumer batch. The earlier candidate is not source-ready. Its run39321357854 is completed/cancelled after these confirmed findings and is not a readiness result.

This correction supplies owner=os.getuid() at the four boot-process-policy calls, the observation-envelope call and the held-job/managed-job calls through that envelope, preserving their previous current-owner policy. The existing direct content boundary test supplies the same current uid. The two consuming modules that lacked os now import it. These are required caller updates within the existing owner-context unit; no caller gains a new owner choice or admission behavior. A narrow direct-import census missed the re-exports and is not completeness proof. The byte APIs, owner validators, fifteen focused tests/thirteen designated mutants, root owner-context probe and workflow are byte-identical to the D268 candidate.

The complete corrected local consumer batch passes: Ran256 in50.096s, OK with two platform skips (254 executed), covering boot policy, observation envelope, held-job comparison, managed observations, managed negative observations, scripted entrypoint consistency and process-class comparison. Their six existing mutation runners pass all46/50/45/55/28/39 intended assertion kills with passing controls. D268's earlier207-test core regression and40-test anchor results remain their scoped historical results, not a claim that those omitted consumers were covered or that the corrected source was already tested in CI.

AUDIT_PRE records this shared-signature finding and the five required dependent caller/test files. Prior ledger blocks remain unchanged; the new owner-context row remains `[A]`. Independent review of the complete corrected source, real Linux/macOS distinct-owner probe reports and all-eight exact-source CI remain required before this prerequisite closes. No local root probe, VM/image operation, production service operation or deployment occurred. Protected native reader integration remains the next separate source gate; every D268 remaining B5, D250/D251 and B6–B9 hold remains, VERSION stays v1.2-pre and D64/Gate is unchanged.


### 2026-10-19 17:26 EDT — D270 frozen-byte and explicit-owner source proof

Only `B5-frozen-byte-owner-context` (P) closes, at source `679e200ba9bbf10b0256c40b3ca35b15e7dda4a9`, sole parent `a74df78c6a3e956cf484a27e4d879090015c208e`. D268 and D269 remain unchanged as the candidate and required caller correction. Claude Message73 is clear with no required corrections after a full repository export replay as uid65534. The seven existing private_dir consumers and direct content test retain their prior current-caller ownership policy; the six-byte semantic API and explicit root-facing owner/writer API remain unchanged by D269.

Claude's 22 dependent suites report Ran683, 643 executed and40 platform skips, with zero owner TypeErrors. Nine additional suites reaching preservation_journal or host_guest_commit report393 tests, all OK. The seven consumer suites'256-test batch passes; its four Linux skips are macOS-only process-observation cases, consistent with two skips in the local macOS replay. The new focused suite passes15 tests and all13 designated assertion mutants are killed with passing controls. The seven consumer runners pass46/50/45/55/28/39/51 intended kills respectively (boot policy, observation envelope, held-job comparator, managed observations, managed-negative, scripted consistency, process class). Existing window-pin/stopped-reader/native-device/anchor runners pass4/4/12/40 with controls. No aggregate executed count or exhaustive failure-path coverage is claimed.

[Run39322919247](https://github.com/moltyguibros-design/openclaw-node/actions/runs/39322919247), attempt1, completed success with all eight jobs successful for that exact source. Both actual checkout logs select merge `5cd85460b25e07aa3abd6ec60a6f23408ba566dd`, whose parents are `b00f5687026d06cfd8c93699e283b6305818b2ad` and the reviewed source679e200b; its recovery-plan tree and workflow compare byte-identically to that source. Linux22 job118301285737 and macOS legacy job118301285688 each complete the15 focused tests and13 intended kills with passing controls. The complete jobs also pass their dependent consumer suites and mutation runners. The cancelled earlier candidate run39321357854 does not establish readiness.

Real Linux and macOS owner-context probes each complete nine cases as authority uid0 against guest files owned by uid65534 and protected-writer records for uid0. The explicit byte API accepts the honest tree; the unchanged current-owner path wrapper refuses it. Wrong guest owner, wrong writer, foreign Finder/config/lock/directory ownership refuse; restoring valid metadata permits verification again. Each probe requires its fresh fixture tree removed before publishing its diagnostic report. These are real owner checks over fresh directory trees, with no native mount or protected acceptance receipt. The macOS job's separate older ASIF/reader/anchor probes also pass; their presence does not establish Q's protected native semantic integration.

Retained reports: Linux artifact `12221162357`, `frozen-owner-context-linux-5cd85460b25e07aa3abd6ec60a6f23408ba566dd`; macOS artifact `12220658598`, `asif-mount-ownership-5cd85460b25e07aa3abd6ec60a6f23408ba566dd`. Each frozen-owner-context report is582 bytes and has SHA-256 `146126823eb237d430f96f00a353d00be9ee58a432f5a97ac100d5a6f9199a81`; both report nine unique completed cases and fixture cleanup removed. Raw job logs, exactly as returned by `gh api repos/moltyguibros-design/openclaw-node/actions/jobs/JOB/logs`: Linux118301285737 =1636692 bytes/24694 lines/SHA-256 `b8b0dda31b1561d555f286ccf01250cce1748c630677b9f5f14521b9e695490c`; macOS legacy118301285688 =195990 bytes/1587 lines/`95bd95657c5661f8f7c12adc4c7001fd72a31d2851ec703e79384fa5344b2add`; macOS owner118301285307 =24610 bytes/273 lines/`664047b4988cb9ed2fb4375aeb632ae970f88952f46f560250ce0333f0f213bf`. These are raw job logs, not prefixed run-view output.

The scoped read_inputs(owner=None) convenience still selects the current caller; verify_stopped_bytes requires both valid owner contexts before guest reads and rejects None. Direct pure-verifier writer-shape checks occur later but perform no filesystem operation. Multiple-fault refusal order is not guaranteed unchanged. The static reachable named-call check is not exhaustive interpreter/import-provenance proof. Byte consistency does not establish capture origin, guest/capture uid equality, same-volume/APFS availability or installed authority.

The next separate source gate is actual protected frozen-reader integration (Q): trusted root-controlled dependency closure, held capture descriptors/locks, a root-owned copy hashed against the anchored clone, real semantic verification and a protected receipt with native distinct-owner image/cleanup proof. It is not implemented or released here. Installation/launch provenance, protected acceptance, stopped-ASIF extraction, B3/live role binding, current inventory/override/fresh-D60 observation, full held/process integration, durable admission, manual restoration, D175, original R3 placement repair and its unresolved natural trigger, D250/D251 incident limits and attended queued/active-task reconciliation all remain open. Operator-owned macOS access or a separately decided measured resource proposal still gates the full reboot rehearsal.

Only P's row changes to `[x]`. B5/1.2 and the parent protected-acceptance row stay `[A]` at `v1.2-pre`, B6–B9 stay held and D64/Gate is unchanged. Production capture remains disabled; no local elevated probe, production service, VM, timer, image or NATS history was operated on. This documentation-only receipt changes no executable; its own review and CI are separate and are not claimed passed here.


### 2026-10-19 18:21 EDT — D271 protected frozen-reader source candidate

The operator's next go advances only B5-protected-frozen-reader-integration (Q). P remains closed at679e200b/Claude73/all-eight CI39322919247; D270747da00e has Claude75 clear and its separate documentation run39327672868 is now completed success, all eight jobs. In D270, “six-byte semantic API” means six record byte strings, and “seven existing private_dir consumers” means seven calls across four modules. Prior blocks remain unchanged.

Claude77's eight pre-audit constraints are implemented. host_journal_mount.capture_record shares the existing capture scope/stopped/fixture-started-sample/Data-UUID predicates with capture_inputs and Q. Anchor snapshot becomes a held context, retaining its wrapper and eighteen mutation anchors. The root read dispatch passes its existing anchor module object; publish/verify stay standard-library-only with their original argv shape. Read/receipt require explicit decimal capture/guest/writer contexts. Exactly twelve protected source files are held, hashed and checked before imports, first attach and publication; imports append the protected directory after stdlib paths, check resolution before execution and recheck the exact loaded local set. The privileged action uses a scrubbed environment.

Q holds the protected store lock, anchor record, capture directory/record/clone descriptors and both capture locks through read, cleanup and publication. Entry/runtime/store/anchor-pending/Q-state/snapshot checks precede Q pending creation. It refuses an attached source, nonzero source flags, xattr names or unavailable same-volume APFS. fclonefileat uses the held source descriptor and CLONE_NOOWNERCOPY, with no path-source copy, repair, full-copy or cross-volume fallback. The copy must be root-owned regular single-link0600 on the pending directory's device, with the anchored size/hash, zero flags, no ACL and an empty bounded xattr-name list. Python3.9 Darwin uses descriptor flistxattr through ctypes.

Only the protected copy is attached read-only and mounted with existing nodev/nosuid/noexec/owners primitives. The real frozen-byte verifier reads the verified Data mount with explicit guest-file and protected-writer uids; read devices, checkpoint and journal head are bound, and the mount is reverified. Attach disk harvest precedes status checks; existing bounded release must prove mount and whole-disk absence. Primary semantic failures retain cleanup evidence. Copy metadata/hash, source/anchor and runtime are checked again after native cleanup. A staged/fsynced/exclusive protected receipt is usable only after its pending directory is removed; the protected receipt reader enforces that fence. Failures retain pending evidence and cannot overwrite or retry the same nonce. This is a CI-owned semantic journal/config receipt with caller-asserted roles, not B3 origin, B8/four-history acceptance, boot decision or installed authority.

Local unprivileged proof:40 focused tests pass, all35 designated assertion mutants are killed with passing full controls. Portable flow uses real Journal/commitment/semantic verification and scripted disk operations; root ownership is modeled, not native proof. Tests cover three distinct synthetic roles and all pairwise swaps/current-uid/global-writer fallbacks, held descriptors/locks, protected source closure/import resolution, anchor/copy/source/mount/semantic/cleanup/publication refusals and receipt pending fences. The existing regression batch reports Ran228, OK with one platform skip (227 executed). The existing anchor runner passes40 controls and40 intended kills. Existing native-device/stopped-reader/window-pin/P-owner mutation runners pass12/4/4/13 intended kills with controls. Changed/new Python parses as3.9, workflow YAML parses and plan lint is14 PASS/one existing idle-version WARN/zero FAIL. No local root, native mount, launchd or elevated probe ran.

The shared mount-helper dependency census contains23 test modules, including clone disposal/reconcile and the new Q suite. The bounded local batch is not a claim to have replayed all23: full dependent replay belongs to exact-source review and CI. Linux22 and macOS legacy now run the new40-test suite and35 mutants. The fresh CI-only native Q probe is last after the older probes: eight independent64m ASIF cases cover intact root0/capture-nonroot/guest65534/writer0 verification, wrong guest, wrong writer, capture/guest swap, corrupt journal, coordinated source-clone/CAPTURE rewrite after anchoring, source flags and source xattrs. It launches the isolated root-controlled closure, requires actual root-owned CoW copy/semantic read/cleanup, capture-user protected-output denial and unchanged source during Q, then removes its own fresh trees. Its diagnostic report is retained. This candidate's actual native cases, independent exact-source review and all-eight CI have not run yet; Q stays [A]. Root-private attach or copy metadata incompatibility must refuse, not silently relax checks.

The protected-acceptance parent and B5/1.2 remain [A] at v1.2-pre. Installation/launch provenance, stopped-ASIF extraction, B3/live role binding, current inventory/override/fresh-D60 observation, full held/process integration, durable admission, manual restoration, D175, original R3 placement repair and unresolved natural trigger, D250/D251 incident limits and attended queued/active-task reconciliation remain open. Operator-owned disposable-macOS access or a separately decided measured resource proposal still gates the full reboot rehearsal. B6–B9 stay held, D64/Gate unchanged and production capture disabled. No production service, VM, timer, image or NATS history was operated on. No row closes in this source candidate.


### 2026-10-19 18:38 EDT — D272 protected-reader fixture and proof corrections

The first Q candidate6009a904 is not ready: run39334325475's Linux22 job118339871920 fails the new40-test suite with three failures/four errors. CodeClosure chooses HOME=/tmp/ci-openclaw-home, whose world-writable /tmp ancestor the unchanged Directory guard correctly refuses. Claude79 reproduces the same seven failing tests. The fixture now uses the existing GITHUB_WORKSPACE-or-home convention. All eight closure tests pass locally with Path.home modeled as /tmp and the actual workspace selected. No runtime guard is relaxed.

Claude79 confirms the23 dependent suites pass in an isolated uid65534 export: Ran723,683 executed and40 platform skips. All18 dependent mutation runners pass with controls, including Q35/35 and the existing anchor40/40. Its source inspection confirms the pre-audit constraints, but required receipt-verifier coverage is missing: several binding-term removals survive the original40 tests. A new table-driven test corrupts each protected receipt binding; for the anchor-authority negative it updates the receipt's anchor digest too, isolating that authority check. Ten designated removal mutants cover scope, nonce, owner context, anchor hash, file pins, both authorities, code hashes, clean cleanup and copy removal. The corrected local full baseline passes41 tests and all45 intended assertion mutants. Other defensive branches are not claimed exhaustively covered. Runtime source remains byte-identical to6009a904.

The first native Q job118339871983 begins22:21:20 UTC, with Q beginning22:26:12 after the older probes. The actual isolated root-controlled reader completes the intact receipt case at22:29:48 and wrong-guest/wrong-writer/capture-guest-swap/corrupt-chain cases at22:31:46/22:33:30/22:34:19/22:35:56. The existing15-minute job ceiling cancels the run at22:36:34, before the final three cases and driver cleanup report. Its upload contains only the four older reports, not Q. These are partial observations, not complete Q proof; final driver cleanup is unestablished. Only this CI-owned job ceiling increases to30 minutes for the measured integrated workload and cleanup. Per-command and negative budgets, predicates and native probe source are unchanged. No local native operation follows.

AUDIT_PRE records both corrections and the measured budget basis. D271 and every historical block are unchanged. This corrected candidate still requires independent exact-source review, its own all-eight CI and the complete fresh eight-case native Q report with cleanup. Q, the protected-acceptance parent and B5/1.2 remain [A] at v1.2-pre; no prerequisite closes here. Installation/launch provenance, stopped-ASIF extraction, B3/live roles/current inventory/override/fresh-D60, full held/process integration, durable admission/manual restoration/D175, original R3 repair/natural trigger, D250/D251 incident/reconciliation and operator-owned disposable-macOS access/resource/reboot gates remain open. B6–B9 stay held, D64/Gate unchanged and production disabled/untouched.


### 2026-10-19 18:42 EDT — D273 complete protected-reader review corrections

Claude79's final review of6009a904 requires R1's workspace fixture, R2's measured job budget plus per-case diagnostic retention, and R3's receipt terms plus receipt-runtime recheck. D272 records the already-published fixture/budget/ten-term corrections atd6db2adc. This follow-up completes the remaining test/probe details without changing the twelve-file privileged reader closure or its runtime predicates.

CodeClosure now explicitly enters its actual Directory policy in setup, establishing its workspace ancestor precondition before each test; all eight closure tests pass with Path.home modeled as /tmp. A new receipt-consumer test changes runtime authority after an honest receipt and requires refusal; its designated check-removal mutant fails at that assertion. The native probe now creates its diagnostic output exclusively and publishes an fsynced atomic snapshot at initialization, each case start/completion and final cleanup. A fresh exclusive/nofollow sibling is replaced into the report path only after writing and syncing. Incomplete snapshots say completed=false, clean=false and cleanup not-yet-observed; they are diagnostics, never acceptance receipts. An interrupted replacement test preserves the previous complete snapshot and a later final snapshot carries measured cleanup. The final local full baseline passes43 tests and all46 designated intended assertion mutants with controls. Changed test/mutator/probe sources parse as3.9; lint remains14 PASS/one existing idle-version WARN/zero FAIL. No local elevated/native operation ran.

The twelve privileged sources, anchor/reader policies, native cases, per-command and negative budgets are byte-identical to6009a904. The30-minute job ceiling from D272 remains the only timing change. D272 run39336312802 is superseded/cancelled while still incomplete after these final review details, not a readiness result. The initial39334325475 partial five-case native observations still establish no final Q report or driver cleanup. Both superseded runs are excluded from closure proof; the corrected exact source requires a fresh complete eight-case native report, independent review and all-eight CI.

Claude79's recommended but unproven defensive branches remain explicit: same-volume/APFS, source/copy already-attached refusals, after-read metadata equality, receipt read-back, dispatch authority and record-size bound have no designated proof in the original suite. No exhaustive failure-path claim follows from43/46. Native capture/guest swap refuses at the ownership walk before guest semantics; wrong-guest exercises the guest check. Capture-user denial is at the probe's0700 store parent. Copy-side flag/xattr refusal is portable only; native source-side negatives stop before cloning. A root-only double fault after pending removal could leave a receipt without its fence. None grants production or installed authority.

No row closes. Q, protected acceptance and B5/1.2 stay [A] at v1.2-pre; installed launch, stopped-ASIF extraction, live B3 roles/current inventory/override/fresh-D60, full held/process integration, durable admission/manual/D175, original R3 placement/natural trigger, D250/D251 incident/reconciliation and operator-owned disposable-macOS access/resource/reboot gates remain open. B6–B9 held, D64/Gate unchanged, production capture disabled and production untouched. Historical D271/D272 blocks remain unchanged.


### 2026-10-19 18:50 EDT — D274 closure fixture models the required no-bytecode runtime

Run39336819548 at10113c8a fails Linux22 job118348279024 with four CodeClosure errors after imports: the exact12-entry policy correctly refuses generated __pycache__ in its copied tree. This is separate from D272's fixed /tmp ancestor condition. Local macOS Python defaults to an external cache prefix; the earlier local commands also suppressed bytecode, so their passing results did not establish this Linux environment condition. Clearing the cache prefix and enabling bytecode locally reproduces exactly four errors among eight closure tests.

Only CodeClosure's reversible fixture patches now set sys.dont_write_bytecode=True, restoring it afterward. This models the existing mandatory -B root CLI; the real exact-source/root runtime policy is unchanged. Full local43 controls and all46 intended assertion mutants pass with every runner-launched Python given an empty pycache_prefix and bytecode initially enabled. The combined Path.home=/tmp model, selected workspace, cleared cache prefix and initially enabled bytecode control also passes all eight closure tests and restores the bytecode setting afterward. These are unprivileged environment replays, not a native or root probe. The changed test parses as3.9 and plan lint remains14 PASS/one existing idle-version WARN/zero FAIL.

Claude81 independently identifies this same remaining R1 condition. It confirms R2's30-minute ceiling/per-case atomic diagnostics and R3's ten receipt terms plus runtime recheck are complete. Its43/46 replay with bytecode suppressed is correctly scoped as such; the prior23-suite723/683/40 replay also had a friendlier home and bytecode setting than CI. No claim is made that either was a passing exact Linux CI run. Its no-workspace plus /tmp-home variant is outside the inherited whole-suite fixture contract, not a new R1 requirement. The diagnostic writer's nonblocking stale-.next limitation remains: replacement failure leaves the previous incomplete snapshot; final diagnostic writing can fail over the primary exception, retained as traceback context. This degrades diagnostics and cannot create completed=true evidence.

The twelve privileged sources, probe, mutator, workflow, native cases and budgets remain byte-identical to10113c8a. That red CI run is superseded/cancelled, excluded from readiness; the corrected exact head still needs independent review, all-eight CI and a complete fresh eight-case native report with measured cleanup. D271–D273 and every historical block stay unchanged. Q, protected acceptance and B5/1.2 stay [A] at v1.2-pre. All installed/operational/B3/B8, extraction/role/inventory/D60, held/process/admission/manual/D175, original R3 trigger, incident/reconciliation and disposable-macOS resource/reboot gates remain open; B6–B9 held and D64/Gate unchanged. Production remains disabled/untouched.


### 2026-10-19 19:46 EDT — D275 protected frozen-reader source proof

Only B5-protected-frozen-reader-integration (Q) closes, at source7e9454803d90085b62fd87c78fe5320822c0b698, sole parent10113c8a9786c6e35f894c1d61e765560d806d96. The twelve privileged sources remain byte-identical to the initial6009a904 candidate. Cumulative Claude79/81/83 review clears the source and required corrections:79 traces the integration and23 dependent suites/18 mutators;81 clears R2/R3;83 clears the final R1 fixture correction under actual CI-shaped Linux conditions as uid65534. Its43 tests and46 intended mutants pass with HOME under /tmp, workspace selected, no bytecode environment suppression and no cache prefix. Reverting only the final fixture line reproduces four errors; its bytecode flag changes False/True/False and leaves no copied cache/tree. Earlier friendly-environment and scoped local results retain their D271–D274 limits, not a falsely relabeled full exact-CI replay.

[Run39337630740](https://github.com/moltyguibros-design/openclaw-node/actions/runs/39337630740) completes success at attempt2 with all eight job statuses successful for that exact source. Only Linux22 is actually rerun: job118367021558 starts23:34:58 UTC and completes23:45:33. The other seven successes are carried from attempt1, with their original execution times; they are not eight fresh attempt2 executions. Linux22's43 focused tests pass in4.188s, its43 controls in4.272s and all46 intended mutants pass. Original macOS legacy execution118350995918 completes success:43 tests in17.326s,43 controls in13.828s and46 intended kills. The complete Linux and macOS regression jobs succeed. Checkout logs for Linux retry, native and macOS legacy all select mergef999e39d50dd11478a32a5ecfb61e375e13fbcd1, parents b00f5687026d06cfd8c93699e283b6305818b2ad and7e945480. Its recovery-plan tree and workflow, and also its whole tree34d90878469a51f363a1ac8e61794ed64da26b84, equal the reviewed source.

Attempt1 Linux job118350995715 is retained as a failure, not erased by the retry. Its Q43 tests/46 mutants passed, then unchanged test_preservation_cluster.Cluster.test_stream_and_consumer_groups_and_real_stream_election failed at its first stream-add with NatsError400, “no suitable peers for placement, peer offline”; Ran1 in2.336s, cleanupFailures empty. That file's last source change remains08f90df7. One bounded fresh-job retry passes the fixture with passed=true and cleanupFailures empty at23:41:55. This different outcome establishes neither the original interleaving nor a readiness repair. Add the separate open B5-CI-preservation-cluster-startup finding for owned diagnosis/ready-fact retention before changing its predicate. No create retry, sleep repair, NATS timeout change or harmless-flake claim follows. The older original R3 repair/natural-trigger and D267 original-event limits stay open. Superseded runs39334325475/39336312802/39336819548 remain cancelled and excluded from readiness.

The real macOS Q execution is attempt1 job118350996013 (carried status now118367023975). All eight fresh64m ASIF cases finish: intact, wrong guest, wrong writer, capture/guest swap, corrupt chain, coordinated clone/CAPTURE rewrite after anchoring, source flags and source xattrs. The isolated root-controlled twelve-source closure runs as authority uid0 with capture uid501, guest-file uid65534 and protected-writer uid0. The honest receipt verifies54 guest-owned files on the verified Data mount. Its held-FD fclonefileat/CLONE_NOOWNERCOPY copy is regular, uid0,0600,single-link, zero flags and empty xattr names; anchored size14680064 and SHA-256 b9430278750161909729c5bf909cc3af71648ad7a6e30a187b47c738a0faa625 hold before and after native use. Receipt read-back/equality and capture-user protected-output denial pass. Every source stays unchanged during Q. Mounted semantic negatives retain clean release evidence, while the earlier anchor/shape negatives refuse before image use; no refused case publishes a receipt. Final report says completed=true, active_case=null, cleanup clean=true/removed=true: all own input/store/seed/code trees, mounts and retained copies are removed. All twelve reported source hashes match7e945480. This is CI-owned journal/config semantic proof with caller-asserted roles, not B3 origin, B8/four-history acceptance or installed authority.

Retained artifact12228188396, asif-mount-ownership-f999e39d50dd11478a32a5ecfb61e375e13fbcd1, contains all five reports. Its downloaded11346-byte zip matches GitHub digest6e7ee4aa7bf9ea29c540bf8e8548af0c2d16c9e99801886cfd0328e650e938ba. protected-journal-reader.json is12367 bytes/SHA-25614173bd367f4592d36a092180246df1e717ae574b0110ebbea85fed592683f5d. The honest protected receipt's reported SHA-256 is83265f29d58415a7590cfd9c6a4c34e5009d5f071b1e00ee558370d9c3d5b8b8. These are actual retained native bytes and source-asserted case results, not reconstruction of the earlier partial five-case log.

Raw logs exactly as returned by gh api repos/moltyguibros-design/openclaw-node/actions/jobs/JOB/logs: Linux retry118367021558 =1640848 bytes/24752 lines/SHA-25626180e949c090d362e6aa6d22eb87a2749c911139c7df49bf5a09b75f5b72821; macOS legacy118350995918 =200202/1645/934544edddf4617ae0418c9fa74c9aaa5546fde62b023239d9b387bc4001781e; native118350996013 =26366/290/91aaee8d54769ceefe5b0fc0d0394a5fd3e40b6c78be1d53bd37af65985ff154. Failed Linux attempt1 log118350995715 =213146/2053/94cc95a73c6df14cd4494fbce2f32622f232627c65cf8495fbf4572dd2c2f14e. These are raw job logs, not prefixed run-view output.

D273/D274 limits remain explicit. Several defensive branches lack designated proof; no exhaustive failure-path claim follows from43/46. Native capture/guest swap refuses at the ownership walk; wrong-guest exercises the reader check. Capture-user denial is at the probe store parent; copy-side flags/xattrs are portable negatives, with native source-side negatives refusing before cloning. Root-only double faults after pending removal and the diagnostic writer's stale-.next/primary-error chaining limit remain unremedied, without granting a completed diagnostic result. Same-volume APFS, uid relationships and root-private attach were observed only on these fixtures; no production availability or timing guarantee follows.

Only Q's row changes to [x]; the separate CI-startup finding is added open. B5/1.2 and protected acceptance remain [A] at v1.2-pre. Installed launch/provenance, stopped-ASIF extraction, B3/live role binding/current inventory/override/fresh-D60, full held/process integration, durable admission/manual restoration/D175, original R3 placement repair/natural trigger, D250/D251 incident limits and attended queued/active-task reconciliation remain open. Operator-owned disposable-macOS access or a separately decided measured resource proposal still gates full reboot rehearsal. B6–B9 held, D64/Gate unchanged and production capture disabled. No local elevation, production service, VM, timer, image or NATS history operation occurred. This receipt changes only Markdown, claims no executable change and does not claim its own future review or CI passed.


### 2026-10-19 20:22 EDT — D276 owned preservation-cluster startup diagnostics candidate

The next owned unit advances only B5-CI-preservation-cluster-startup. D275/Claude85 remain intact: failed Linux118350995715 first-create400/peer-offline and the later successful fresh-job retry are different outcomes, not a repair or a harmless-flake result. Claude87 traces the pinned NATS2.12.6 source, and Claude89 clears the diagnostic scope with nine implementation constraints; it performs no cohort replay. Its downloaded scratch dependencies are removed. The D275 receipt run39343766023 is observed separately; no result for this candidate is inherited from it.

The inline leader/route/account gate,15-second startup deadline,.05 polling,503-only account retry, single stream add, five-second stream wait and all later group/QuietWindow/election assertions remain fixed. Only the three owned configs enable debug, and the fixture pins/records nats-server2.12.6. A test-local Python helper records the accepting loop's existing sequential jsz/routez projections and timestamps without an extra pre-create monitor query; unknown facts stay unknown. It brackets the single client invocation with log offsets, retains at most128KiB per member and1024 characters per selected line, marks truncation incomplete, and keeps only peer-selector lines plus verified INFO route-created/metadata-leader startup messages. The Node reply records its actual connected name/id, stream-add count, stage and structured API error. Non-JSON stderr is marked unparsed; the503 retry remains, with a bounded last refusal/count replacing its unguarded append-only diagnostic write.

The new owned-preservation-cluster-startup-v1 report uses allow-listed facts, an exclusive0600 file and256KiB total bound. Serialized token/password exposure suppresses the whole report to a fixed marker. A diagnostic failure cannot replace an in-flight primary exception. Green paths require usable evidence only after cleanup. Startup js/routes are explicitly initialized, so a timeout before any successful sample retains the readiness refusal. Each owned child has independent stop/kill-wait/log-close handling and an explicit outcome; a failed kill-wait cannot skip later children or claim reaping. Popen failure closes its new log. The fixture retains its own root diagnostics; CI uploads only the JSON reports, never configurations, stores or complete logs. Artifact names include merge SHA and run attempt. Linux exercises the actual fixture plus the new proof; macOS exercises the same code through the fresh normal/fault pair. No readiness repair, sleep or create retry is added.

Local corrected source proof:16 tests pass in2.921s (15 portable plus one real sequential two-cohort control); all22 designated assertion mutants die with passing15-test controls. The normal NATS2.12.6 cohort creates once and completes the unchanged full election test. A separate scratch copy changes only the three owned route permissions to deny STATSZ: its unchanged gate returns and its one create refuses400/10005/peer offline, with three complete leader selector lines and real connected identity. All six children exit0 with shutdown markers, no force and no cleanup/diagnostic errors; both fresh pair trees are removed. The retained private control report is18721 bytes, SHA-256113e984d4bbc7014609b37658cd21c28dd24364165628112ee5a14320dd18fd5. The existing13-test/22-mutant group-readiness proof also passes, and wait_for_groups source SHA-256bf09c7692c304975b867aa1eefb01754255503d3e703318bed520b0383437dd3 remains fixed. All four changed/new Python files parse as3.9; workflow YAML parses; plan lint14 PASS/one existing idle-version WARN/zero FAIL. These are unprivileged owned/scripted observations, not native image or production proof.

Three layers remain separate. Pinned upstream placement discards nil cfg/stats; the old gate cannot observe that cache. The deliberately denied cohorts establish a sufficiency gap, not the historical event's cause. Append-only correction to D238's speculative candidate: routes start after JetStream, so a pre-JetStream heartbeat cannot reach remote peers over routes and can only affect self state. Claude89's route.go:2346 unconditional route-registration overwrite is another unobserved candidate, not an established natural trigger. The original placement repair/natural trigger remains open. Debug and diagnostic work can change fixture timing; accepting monitor facts are not an atomic private-cache snapshot. No exhaustive failure-path or timing guarantee follows from these designated controls.

This is an implementation candidate only: independent exact-source review, all-eight CI and retained Linux/macOS reports are still required. Its own row stays[A]. B5/1.2 and protected acceptance remain[A] at v1.2-pre. Installed launch/provenance, stopped-ASIF extraction, B3/live roles/current inventory/override/fresh-D60, held/process integration, durable admission/manual restoration/D175, D250/D251 incident limits and attended task/session reconciliation remain open. Operator-owned disposable-macOS access or a separately decided measured resource proposal still gates reboot rehearsal. B6–B9 held, D64/Gate unchanged and production capture disabled. No local root/native/launchd or full root suite ran; no production service, VM, timer, image or NATS history was operated on.


### 2026-10-19 20:42 EDT — D277 startup diagnostic review corrections

Claude91 verifies6a6904de's nine runtime constraints and independently replays16 tests/22 intended kills as uid65534 on Python3.12, the original13/22 group proof, a2.326s unfiltered fixture, and Python3.9 controls/22 kills. Its own normal/fault pair creates once each, refuses400/10005 on the injected side with complete selector windows, and observes six exit0 owners. It requires five corrections before closure: pins do not enforce the Python create count, pre-create boundary or503 return; the real fixture's primary/green wrapper lacks decisive proof; debug is only a reported constant without a config pin; the forced-kill call/flag is unproved; and the new pair's120-second subprocess timeout kills only Python, leaving three owned NATS children. Its demonstrated orphaned children are terminated with shutdown markers. D276 remains an earlier candidate, not cleared source.

The corrected proof pins the exact accepted-to-create block, the sole Python create invocation, the whole503 retry branch including return False, the debug config line, and the full fixture finally wrapper. Designated mutants now add a second create, sleep or monitor request; treat503 as ready; lose the primary or swallow a green failure; remove debug or the forced kill. A real fixture-control path combines readiness refusal with an unclean scripted owner and requires the original refusal. The kill-path test requires both kill invocation and the forced flag. Privacy is tested under umask022, and a removal mutant pins chmod. The mutator reports the observed control count rather than a hardcoded number.

The pair driver now starts every cohort with start_new_session=True. On its timeout it signals only that owned group, TERM then bounded KILL if still present, waits the Python parent and records signal/error/group-absence observations. A timeout remains a refusal; it is never normal per-server cleanup evidence. A scripted escalation test and its three session/TERM/KILL mutants prove the required calls. A real tiny owned Python parent/child timeout ends with group absence, parent waited and no errors. A separate deliberately hung scratch NATS fixture passes the old gate then pauses before any create: group TERM leaves all three owned server shutdown markers, the Python parent is waited at-15 and the group is observed absent; the fresh tree is removed. Individual NATS exit codes were not waited by the outer driver, so none are claimed for that timeout control. The real normal/denied pair still creates exactly once per cohort and observes all six individual exit0/marker/no-force outcomes.

Two diagnostic details are also corrected within scope. Startup503 policy parses locally, independently of the recorder. Readiness timeout retains allow-listed last jsz/routez projections, explicitly labelled possibly from different iterations, with unknown samples marked unknown. A pair-report write failure preserves an in-flight primary; green report failures still refuse. The debug flag remains backed by a pinned written-config line, not an independent private-cache observation. Verified route-close lines are not retained; the report cannot establish the route re-registration candidate. No completeness, natural-trigger or readiness-repair claim follows.

Corrected local Python3.9.6 proof:19 tests pass in5.373s (18 no-NATS controls, including a real owned process-group timeout, plus one actual sequential two-cohort NATS control); all34 designated intended-assertion mutants pass with18 controls. The private normal/fault report is21712 bytes/SHA-25654bf40931c4c13d6f17e2344ae74987578b3dbc7c2561f6391f90f888f05a35c. All four Python sources parse as3.9 and plan lint remains14 PASS/one existing idle-version WARN/zero FAIL. wait_for_groups and every original startup predicate, polling/deadline, single stream add and later group/election/QuietWindow assertion remain unchanged. Existing workflow wiring remains byte-identical to6a6904de.

Superseded run39347338288 is completed/cancelled after the review findings and excluded from source readiness. Its completed Linux118383005771 observations are retained only for6a6904de: original fixture and normal control succeed, the denied control refuses400/10005, all nine owned servers exit0 with markers/no force/errors, and all windows are complete. Artifact12232190711 ZIP5362bytes matches digest a8d02cf7bade3f3cd79b34d70070aa762078f2576de875f219b69d7f2ea670ff; unfiltered JSON8377bytes/69ec7c2bd5bab1ef35a0e831f015a61d534f22c6e58435ea9e036fc46fd794a6 and controls19392/d93e665a905115660c742d908edfe88a58c2bc499667281859fa1e75c6412907. Merge53d1c6ba has6a6904de as a parent and their whole treefe521d245e9e584a1f1f0b45fecd81c41dbbc217 is equal. These are superseded-source artifacts, not corrected CI. The older D275 receiptc898bfee separately completes all-eight success in39343766023.

This correction needs its own independent exact-source review, all-eight CI and retained Linux/macOS reports. No row closes: the diagnostic row, protected acceptance and B5/1.2 remain[A] at v1.2-pre. D276 history and the original failed CI event remain intact. The original R3 repair/natural trigger, installed authority, stopped-ASIF extraction, live roles/inventory/override/D60, held/process/admission/manual/D175, incident/reconciliation and operator-owned disposable-macOS resource/reboot gates remain open. B6–B9 held, D64/Gate unchanged. No local elevated/native-image/launchd/full-root suite, production service, VM, timer, image or NATS history operation occurred.


### 2026-10-19 20:56 EDT — D278 startup boundary and live-group proof corrections

Claude93 confirms b3de16ce runtime behavior, R2/R3/R4 and real R5 cleanup. As uid65534 it passes19 tests/5.144s,34 designated kills with18 controls, the existing13/22 proof and the real unfiltered fixture/2.299s; Python3.9.23 controls/34 pass too. Its actual scratch NATS hang yields three shutdown markers, parent waited-15, group absent and no remaining owned processes or zombies. Its real TERM-ignoring parent/child requires TERM then KILL, observes parent-9 and group absence. It requires three final proof corrections: neighbouring edits escape the narrow boundary pin, the local503 parse is outside its pin, and an always-true group-absence observer survives the old controls. No runtime readiness defect or original natural trigger is found.

The source contract now pins the continuous initialized startup loop through the first create, including its accepting branch, break, timeout branch and pre-create diagnostic calls. Three designated neighbouring sleep/query mutants die. A second pin spans the entire result.returncode/startup branch, including local parsing,503-only decision and return False; a forced-parsed503 mutant dies. These are fixed-boundary source contracts, not a claim that arbitrary future source changes are exhaustively mutation-proved. The503 refusal record now reuses the existing allow-listed client projection instead of the raw parsed object, without changing its independent policy parsing.

A committed real owned parent and child both ignore TERM. The driver must send KILL, wait the parent and observe group absence; the always-true observer mutant fails before its test's independent owned-group cleanup kills the remaining controlled processes. Local Python3.9.6:20 tests pass in14.474s (19 no-NATS controls, including real graceful and TERM-ignoring process groups, plus one actual sequential NATS pair); all39 designated mutants die with19 passing controls. The forced control records SIGTERM/SIGKILL, the expected SIGTERM-parent-wait expiry, parent waited at-9 and group absent. The graceful control records TERM, parent waited at0, group absent and no errors. The normal/denied NATS pair retains one create per cohort and six individually waited exit0/marker/no-force owners. Changed Python parses as3.9; plan lint14 PASS/one existing idle-version WARN/zero FAIL. No production or local elevated operation ran.

D277's phrase about removing the hung NATS tree described Codex's scratch experiment cleanup. The shipped pair driver deliberately retains its diagnostic tree on timeout; it is local temporary state and is never uploaded. Group absence includes zombies and depends on host init reaping them; where absence cannot be observed it stays false. Individual server exit codes are not inferred from group absence. Route-close INFO lines remain unretained, and the pair writer's primary preservation is code-traced rather than separately designated. Neither of these bounded proof units establishes the historical startup cause, a placement repair, a production timing promise or installed authority.

Superseded run39349290479 was requested cancelled after Claude93's required proof findings. Its fixture-step artifacts are retained only for b3de16ce: Linux ZIP12233215243 is5408 bytes and matches d771aba08e37769b9fdc167be230a47d448e107cbd905e9be6691c846708e86d. The unfiltered report is8428 bytes/a9fc5799c2f62dd3fbb09d9f0365e3bd04d029d55116a3c33e3f25e87f42380d; controls19347/ffacaa5f1031ee0fbc3384cc3378c0a2dbd8f9e3b241f449dc4758985ad2692c. Both normal cohorts pass, the injected one refuses400/10005, all nine owners exit0 normally and all bounded windows are complete. Merge a42e4075 has b3de16ce as a parent; whole treeb965b3f34423381101903bcdcee32905e4c17968 equals that source. These older reports do not validate this correction's new proof.

This corrected exact head still requires independent review, its own all-eight CI and retained Linux/macOS reports. D276/D277 remain unchanged. The diagnostic row, protected acceptance and B5/1.2 stay[A] at v1.2-pre; no prerequisite closes. Original R3 repair/natural trigger, installed launch/provenance, stopped-ASIF extraction, live roles/inventory/override/D60, held/process/admission/manual/D175, incident/reconciliation and operator-owned disposable-macOS access/resource/reboot gates remain open. B6–B9 held, D64/Gate unchanged and production capture disabled. No production service, VM, timer, image or NATS history was operated on.


### 2026-10-19 22:20 EDT — D279 owned cluster-startup diagnostic source receipt

Claude95 clears exact source d63eb33094d97005e0030b23f0dc87c50259290c, sole parent b3de16ce4d8010a0cd87a9d196d244dfe02cd65e, with no further required corrections. Its independent uid65534/Python3.12 replay passes20 tests in14.553s,39 designated kills with19 controls, the existing13-test/22-mutant group proof and the unfiltered fixture in2.070s. Its normal/denied pair creates once each and observes six individually waited exit0 owners, markers and no force/errors. Real graceful and TERM-ignoring timeout groups are absent with their Python parents waited; no owned processes or zombies remain. Its original-form neighbour, forced-parsed503 and always-true observer mutants die. A separate503-only control refuses readiness after four retries with zero accepts/creates and drops raw extra error fields. These are designated proofs, not exhaustive mutation or failure-path coverage. The continuous pin covers the startup loop through the first create call site; it does not cover arbitrary future delays inside client() or the Node body.

Run39350641642 completes success at attempt2 with eight successful statuses for exact source d63eb330. Only the two failed jobs are replayed once: Linux22 job118405851609 runs01:37:08–01:48:23 UTC and Mac legacy118405851070 runs01:37:13–02:18:29. The other six successes retain their attempt1 execution times; these are not eight fresh attempt2 executions. Both replay checkout logs select merge20502b87da0d9b772557482236583033fd1ae080, parents b00f5687026d06cfd8c93699e283b6305818b2ad and d63eb330. The complete merge tree14151b2a50689838ae4d4776ed004cab2489fb4f equals the reviewed source. Linux passes20 tests/13.294s and39 intended kills/19 controls, then the original unfiltered fixture/1.812s; its full regression job succeeds. Mac passes20 tests/13.523s and39 intended kills/19 controls, plus the remaining legacy regressions. Both real graceful controls record TERM, waited parent0, group absent/no errors; both forced controls record TERM/KILL, the expected TERM-parent-wait expiry, waited parent-9 and group absent.

Codex verifies attempt2 retained JSON bytes against GitHub artifact digests. Linux artifact12234474958 ZIP5431 bytes matches4c1c451bb61d9b55e64627292a4d3b50f05818247c5022a6eba9879fad5427e6; unfiltered JSON8430 bytes/d60299cfa66b0f530b188cbb0ea0a0bd54b5df139a2f89b2db129787632393dd and controls19726/4a1aba33833498d9b244f67a43ac9935d165a3a6a6756977d7c7fd612902d39b. Mac artifact12236187311 ZIP3391 bytes matchesd7da7c3ecda1de848d3b127a65f5a2a184cfa6b2a6b3e426fff09d43b121d9f5; controls19186 bytes/85d9cbbcfaa8ed135493511493d2ebaa7ca515da1ec1f5472a451c4450b0296e. The normal cohort in each pair completes the unchanged election fixture; both separate denied cohorts refuse400/10005 with required3/found1 selector evidence. Every observed cohort creates once. All fifteen owned NATS children across the two pairs and Linux unfiltered fixture are individually reaped at exit0 with markers, no force/errors; all bounded windows are complete and diagnosticErrors empty. The successful Mac normal cohort accepts cluster sizes[2,2,2] before completing; size2 alone therefore is not established as sufficient cause of the Linux TIMEOUT. Raw Linux replay log1653439 bytes/24840 lines has SHA-25657223ec363ec388c7812390f7fc69ce427260e0c78904aa4133b57dfd35af6ac; Mac209597/1721/367b81bd5fc4f28ec2a75720be4188fa0d7f4cda602e88f825012d2fb20fadc3. These later passes validate this diagnostic/proof wiring; they neither repair nor explain either failed attempt.

Attempt1's two natural failures remain evidence. Linux22 job118393744511 passes20 tests/12.642s and39 kills/19 controls, including the normal/denied pair, then the separate original fixture fails its one stream add with code TIMEOUT and no API error; Ran1 in5.325s. Its accepted sequential jsz samples at01:04:29.217/.218/.219Z and routez samples at.221/.221/.222Z report leader owned-raft-1 and two route IDs on every member, with cluster sizes[2,3,3] and both leader replicas current. The connected identity is member0. The complete create windows read4734/3074/5557 bytes and retain no selector lines. All three owners exit0 with shutdown markers, no force/errors and diagnosticErrors empty. No-discard logging cannot distinguish successful selection from an unprocessed request, nor establish whether a stream was applied or a reply lost. Member0's cluster size2 would fail the separate stronger placementState check, but its causal role in this TIMEOUT is unproved. Claude97 independently verifies the raw225877-byte/2141-line log SHA-256 b091fc11ae6babd5f52767ccd5a3e3976bd098af17ef3818a753bcd85197bb31 and the logged characterization. Its artifact host is blocked, so per-window byte/completeness facts are Codex's downloaded-byte verification, not Claude's independent blob verification.

Mac legacy attempt1 job118393744469 fails the normal side of the pair at the same one-create stream-add boundary:400/10005, “no suitable peers for placement, peer offline”; nested Ran1 in2.708s. The20-test run takes13.021s with one failure;19 other controls pass, the denied cohort is not run and the39-mutant command is skipped. Accepted sequential samples all report cluster size3, leader1, two route IDs and both leader replicas current. During the complete create window, leader1 logs discard of the connected member0 as offline and required3/found2 from3 peers/result2. Window bytes read are254/412/0; all three owners exit0 with markers/no force/errors and diagnosticErrors empty. This establishes that occurrence's selector exclusion, not why the peer was offline or the older historical event's cause. Raw log154173 bytes/1325 lines has SHA-256 fcb701e9040ccc6aa21ebeeff13cd7da1588c6bb8ec22fbd67da390655d72cad.

Codex downloads and digest-checks both retained attempt1 artifacts. Linux12232943243 ZIP5417 bytes matches18050a92b735b21eef1591907ca0c6d5e01b06e8d89b0c7d3d928384eb403a02; unfiltered JSON8724 bytes/2766a7cac5deaf0655c910518489c3a1ee8da554958d9a35c45ef09a75261992 and controls19509/8f98489b8b06301dd5b64d794608404b6deaf0dcfab90946bfca7918e6c107b1. Mac12234407855 ZIP2510 bytes matches75f7e835d1318c0e373f8c4e79c1879b2c5adc987af212c6089015de5d301e46; partial normal-only controls12450 bytes/223fc3677480c6d5ff80425b13274bac8374ede0b75958dbde562e4f31f5dd1a. Both have one create per observed cohort and usable refusal/cleanup facts. Earlier cancelled runs39347338288/39349290479 remain superseded-source observations only.

Append-only correction to Claude89's pre-audit claim: verified startup INFO lines do not show “any leader change” during a create. The shipped create-window filter keeps only Peer selection lines; INFO is retained only in the earlier startup window. Claude97 identifies this gap and confirms that implementation followed the agreed wording. Add separate open B5-CI-preservation-cluster-timeout-evidence: retain the verified INFO allow-list plus the pinned upstream stream-leader line during create and one wrapped post-failure jsz projection per member. Its later unit must preserve one create, the existing pre-create observations, deadlines, polling and503 policy, with no retry/sleep/predicate repair. No such source change lands in this receipt. Route-close and Raft-membership debug lines remain outside the current retained evidence. Sequential monitor facts do not snapshot private caches; debug/diagnostic work itself can change timing. The original R3 placement repair/natural trigger and both newly observed failure causes remain open.

Group absence still includes zombies and depends on host init reaping; it cannot substitute for individually waited server exit codes. The pair writer's primary preservation remains code-traced rather than separately designated, and the independent controlled-process cleanup retains the previously stated theoretical PID-reuse limit. D276–D278 candidate/proof histories stay unchanged.

Only B5-CI-preservation-cluster-startup changes from[A] to[x], and the separate bounded evidence follow-up is added open with its own Goal/Needs/Feeds/Verify contract. The diagnostic output feeds later CI startup cause analysis through the workflow's retained JSON; it grants no serving-NATS or production authority. B5/1.2 and protected acceptance remain[A], VERSION remains v1.2-pre. Installation/launch provenance, stopped-ASIF extraction, B3/live role binding/current inventory/override/fresh-D60, full held/process integration, durable admission/manual restoration/D175, original R3 repair/natural trigger, D250/D251 incident limits and attended queued-task/active-session reconciliation remain open. Operator-owned disposable-macOS access or a separately decided measured resource proposal still gates full reboot rehearsal. B6–B9 held, D64/Gate unchanged and production capture disabled. The frontier changes only its B5 gate/owner cells; evidence/downstream cells and all other rows stay unchanged. No local elevation, native-image/launchd/full-root suite, production service, VM, timer, image or NATS history operation occurred. This receipt changes only six Markdown files and does not preclaim its own review or CI.
