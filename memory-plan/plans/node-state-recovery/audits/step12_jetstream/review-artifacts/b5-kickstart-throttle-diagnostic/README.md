# Exact-head macOS CI kickstart timeout: cause challenge and owned diagnostic

**Head:** `b694b34295576139197693255babd5d76a1e4cd2`, CI run 39005360286, macOS job
117316604376. Failing test: `test_restore_only.RestoreOnlyOwned.test_loaded_stopped_owned_daemon_is_kickstarted`
at line 394. Reported result: `UndeterminedLaunchdAction`, kickstart timed out at 10 s;
one second later the job was loaded, running, pid 99399; gate closed, outcome partial,
receipt unresolved. This is the classification D180 added; the cause stayed undetermined then
and is undetermined now.

Nothing here edits source, the fixture or the runtime, triggers CI, runs a native probe or
touches production. The diagnostic is not wired; it runs by hand on an isolated macOS runner.

## What the source fixes before any measurement

From the head's `test_restore_only.py`, `restore_only.py` and `managed_launchd.py`:

- The fixture job is `RunAtLoad=True`, `KeepAlive=False`, no `ThrottleInterval`, stdio to
  files under the owned root (`StandardOutPath`/`StandardErrorPath`).
- The job's runtime before the kill (R) is the whole `setUp` after its bootstrap plus
  `interrupt()`: node startup, the anchor bootstrap, the legacy journal, a child controller
  that imports the journal and gate modules and closes the gate. On a CI runner that is
  seconds, not milliseconds.
- The gap from the observed exit to the kickstart request (δ) is `self.command()`'s
  `restore_only.py` subprocess start plus six or seven `launchctl print` /
  `print-disabled` calls in `restore()` and `kickstart()`: roughly 0.5 to 1.5 s. The 10 s
  budget covers only the `launchctl kickstart` call itself.
- `command()` is `subprocess.run(argv, capture_output=True, text=True, timeout=10)`. On
  timeout it kills launchctl before anyone can ask whether launchctl was still alive.

## The two hypotheses, and why the arithmetic matters

**H1, throttle.** `launchd.plist(5)`: launchd will not spawn a service more often than
`ThrottleInterval`, default 10 s. If `launchctl kickstart` blocks until the spawn and launchd
defers the spawn, the block collides with the 10 s budget.

Under the documented respawn semantics ("service only ran for R seconds, pushing respawn out
by 10 − R"), a request issued δ after the exit blocks for about **10 − R − δ**. With the
fixture's R of a few seconds that is well under 10 s, so H1 only reaches the observed ≥10 s
block if launchd measures the interval from the **request** or from the **exit regardless of
runtime** (a signal exit may be treated that way), or if `kickstart` is throttled differently
from a respawn. That is a measurement, not a reading of the man page.

**H2, inherited pipe.** launchctl exits quickly but `communicate()` still waits for EOF on
its stdout/stderr pipe because another process inherited the write end. For `kickstart` the
spawned job's stdio comes from launchd and the plist (files here), not from launchctl, so H2
is unlikely on this path; but the fixture's exception cannot exclude it. A Linux control in
this directory shows the fixture's `subprocess.run` shape raises the identical
`TimeoutExpired(output=None, stderr=None)` for a blocked client and for an exited client with
a held pipe. `Popen.poll()` at the moment of the timeout, before any kill, is what tells them
apart.

**Not excluded either:** a kickstart that launchd queues behind its own exit bookkeeping for
the SIGTERMed job (the fixture proceeds as soon as `pid` leaves `launchctl print`), or a slow
runner. The diagnostic's R = 12 s trials and the job's own spawn timestamps cover these too.

## The diagnostic: `probe_kickstart_throttle.py`

One standalone script, owned labels only (`ai.openclaw.owned-kickstart-probe.<hex>.*`) in
the runner's gui domain, no sudo, fresh `RUNNER_TEMP` directory, bootout and removal on
every exit, report written exclusively.

Per trial: bootstrap a fresh job that records its own wall-clock start; wait R; SIGTERM it;
wait for launchd to show it stopped; issue `launchctl kickstart` through `Popen` with pipes;
at the 10 s budget record `poll()` (alive or exited-pipe-held) **without killing**; keep
waiting up to 30 s for launchctl to return; wait up to 30 s for the new instance's start
timestamp; record `launchctl print` fields and launchd's own log lines for the label when
`log show` answers within its bound.

Trials: `ThrottleInterval` absent with R ∈ {0.3, 3, 12} s, `ThrottleInterval=1` with
R ∈ {0.3, 3} s, `ThrottleInterval=0` with R = 0.3 s. Each on a fresh label, so no throttle
state carries over.

Measured per trial: `at_budget`, `block` (real time until launchctl exited), the spawn delay
of the second instance from the first spawn, from the exit and from the request, and whether
the spawn preceded launchctl's return.

### Decision table

| Observation | Reading |
|---|---|
| `block` ≈ ThrottleInterval − R, collapses with `ThrottleInterval=1`, ≈ 0 at R = 12 | H1, origin last spawn: the fixture's R makes the collision marginal |
| `block` ≈ ThrottleInterval regardless of R | H1, origin exit or request: the 10 s budget can never cover the default throttle |
| `at_budget == 'exited-pipe-held'` | H2: the request completed; the pipe is the problem |
| `block` ≈ 0 and `spawn_after_exit` ≈ 0 in every trial | neither reproduces on an idle runner: look at the failing job's load, not launchd |
| spawn before launchctl returned, but return late | launchctl waits for something after the spawn |

### Running it

    OPENCLAW_KICKSTART_PROBE=1 /usr/bin/python3 probe_kickstart_throttle.py \
        --ci-owned-probe "$RUNNER_TEMP/kickstart-throttle.json"

Guards: macOS, `CI=true` and `GITHUB_ACTIONS=true`, the opt-in variable, the flag, a new
output path. `--self-test` runs the classifier core against fake commands on any platform.

Exit 0 means the trials completed and no probe label was left loaded; the reading comes from
the report, not the exit code.

## Recommendation

Measure before changing the fixture or the runtime. If the report lands on the first row,
the owned fixture plist is the place to act (a `ThrottleInterval` on the fixture job only, or
a longer owned kickstart budget), and the runtime is untouched. If it lands on the second
row, the managed kickstart's budget and launchd's semantics need a decision of their own,
with the measurement attached. If it lands on H2, the fix is in how the managed command reads
its client, not in launchd. None of that is decided here.

## Linux controls run before delivery (this environment, no launchd)

- `--self-test`: `returned`, `alive` (block 3.02 s), `exited-pipe-held` (block ≤ 1.0 s, the
  budget) classified correctly; exit 0.
- Fixture call shape: `subprocess.run(..., capture_output=True, text=True, timeout=1)` raised
  `TimeoutExpired(timeout=1, output=None, stderr=None)` after 1.00 s for both a client alive
  past the budget and a client that exited with its pipe held by a child.
- Guards refuse on Linux, without the CI variables, without the opt-in, and for a relative
  output path, before any command runs.
