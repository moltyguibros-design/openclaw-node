#!/usr/bin/env python3
"""CI-only macOS diagnostic: why does `launchctl kickstart` of a just-killed owned job exceed 10 s?

Exact-head macOS CI (b694b342, job 117316604376) timed out the managed kickstart in
test_restore_only.RestoreOnlyOwned.test_loaded_stopped_owned_daemon_is_kickstarted after its 10 s
budget; one second later the job was loaded, running, with a new pid. The fixture job is
RunAtLoad=True, KeepAlive=False, no ThrottleInterval, stdio to files. Two hypotheses:

  H1 throttle: launchd's default 10 s spawn throttle delays the kickstart-induced spawn, and
     `launchctl kickstart` blocks until the spawn, so the block collides with the 10 s budget.
     Documented semantics ("pushing respawn out by interval minus runtime") predict a block of
     about 10 - R - d, where R is the job's runtime before the kill and d the gap from exit to
     the request; the fixture's R is seconds, so H1 needs a different origin (request or exit
     time) to reach 10 s. Only a measurement decides.
  H2 pipe: launchctl itself exited quickly but communicate() still timed out because another
     process inherited its stdout/stderr pipe. subprocess.run kills the child on timeout, so
     the fixture cannot tell H1 from H2; Popen.poll() at the moment of the timeout can.

This probe measures both on its OWN labels only (ai.openclaw.owned-kickstart-probe.<hex>.*) in
the runner's gui domain: for each trial it bootstraps a fresh job that records its own start
time, waits R seconds, SIGTERMs it, waits for launchd to show it stopped, issues
`launchctl kickstart` through Popen with pipes, and at the 10 s budget records whether
launchctl is still alive (H1 shape) or has exited with the pipe held (H2 shape). It then keeps
waiting, bounded, for launchctl to return and for the new instance's start time, so the real
block and the spawn delay (from the first spawn, from the exit and from the request) are
measured, not inferred. Trials vary R and ThrottleInterval (absent, 1, and 0) so the throttle
origin shows as a function of R. launchd's own log lines for the label are recorded when
`log show` answers within its bound.

Decision table, from the report's per-trial `block`, `spawn_after_exit`, `at_budget`:
  - block tracks (ThrottleInterval - R) and collapses with ThrottleInterval=1  -> H1, origin last spawn
  - block ~= ThrottleInterval regardless of R                                  -> H1, origin exit/request
  - at_budget == 'exited-pipe-held'                                             -> H2
  - block ~= 0 and spawn_after_exit ~= 0 in every trial                         -> neither; CI-run specific

It never touches ~/.openclaw, any production label, the fixture, or the runtime. It needs no
sudo. It is not wired into CI; run it by hand on an isolated macOS runner:

    OPENCLAW_KICKSTART_PROBE=1 /usr/bin/python3 probe_kickstart_throttle.py \\
        --ci-owned-probe "$RUNNER_TEMP/kickstart-throttle.json"

`--self-test` runs the measurement core against fake commands on any platform (no launchd),
proving the alive / exited-pipe-held / returned classification before the native run.
"""
import datetime
import json
import os
import pathlib
import plistlib
import re
import secrets
import shutil
import signal
import subprocess
import sys
import tempfile
import time

LAUNCHCTL = '/bin/launchctl'
BUDGET = 10.0          # the fixture's command() budget
EXTRA = 30.0           # how much longer the probe keeps measuring after the budget
SPAWN_WAIT = 30.0      # how long to wait for the kickstarted instance to record its start
PREFIX = 'ai.openclaw.owned-kickstart-probe.'
# (ThrottleInterval or None, runtime before the kill in seconds)
TRIALS = ((None, 0.3), (None, 3.0), (None, 12.0), (1, 0.3), (1, 3.0), (0, 0.3))
# The job records its own wall-clock start, then stays running until killed.
JOB = ('import sys, time\n'
       'open(sys.argv[1], "a").write(repr(time.time()) + "\\n")\n'
       'time.sleep(600)\n')


def require(condition, reason):
    if not condition:
        raise RuntimeError(reason)


def drain(stream):
    """Whatever a pipe holds right now, without blocking on a writer that never closes it."""
    if stream is None:
        return ''
    try:
        os.set_blocking(stream.fileno(), False)
        data = stream.read() or b''
    except (OSError, ValueError):
        data = b''
    finally:
        try:
            stream.close()
        except OSError:
            pass
    return data.decode(errors='replace')[:2000]


def issue(argv, budget=BUDGET, extra=EXTRA):
    """Run argv with pipes; classify it at `budget` without killing it; keep measuring up to `extra`.

    at_budget: 'returned' (within budget), 'alive' (launchctl still running at the budget: a
    block), or 'exited-pipe-held' (launchctl had exited, yet communicate() timed out because
    another process holds its stdout/stderr pipe). `block` is the real time until exit for
    'returned' and 'alive'; for 'exited-pipe-held' it is only an upper bound (the exit happened
    some time before the budget, unobserved).
    """
    started = time.monotonic()
    child = subprocess.Popen(argv, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    try:
        out, err = child.communicate(timeout=budget)
        return {'argv': argv, 'at_budget': 'returned', 'returncode': child.returncode,
                'block': time.monotonic() - started, 'stdout': out.decode(errors='replace')[:2000],
                'stderr': err.decode(errors='replace')[:2000]}
    except subprocess.TimeoutExpired:
        pass
    at_budget = 'alive' if child.poll() is None else 'exited-pipe-held'
    returncode_at_budget = child.returncode
    try:
        child.wait(timeout=extra)          # exit only: a held pipe cannot keep this waiting
        ended = 'returned-late'
    except subprocess.TimeoutExpired:
        child.kill()
        child.wait()
        ended = 'killed-after-extra'
    block = time.monotonic() - started
    return {'argv': argv, 'at_budget': at_budget, 'returncode_at_budget': returncode_at_budget,
            'ended': ended, 'returncode': child.returncode, 'block': block,
            'stdout': drain(child.stdout), 'stderr': drain(child.stderr)}


def self_test():
    """The classification core against fake commands; no launchd involved."""
    cases = (
        ('returned', ['/bin/sh', '-c', 'echo ok']),
        ('alive', ['/bin/sh', '-c', 'sleep 3']),
        # Exits at once but a background child keeps the inherited pipe open past the budget.
        ('exited-pipe-held', ['/bin/sh', '-c', '(sleep 3 &); exit 0']),
    )
    results = []
    for expected, argv in cases:
        found = issue(argv, budget=1.0, extra=5.0)
        results.append({'expected': expected, 'found': found['at_budget'], 'ended': found.get('ended'),
                        'returncode': found['returncode'], 'block': round(found['block'], 2)})
    verdict = all(row['expected'] == row['found'] for row in results)
    print(json.dumps({'self_test': results, 'pass': verdict}, indent=1))
    return 0 if verdict else 1


def launchctl(*argv, timeout=10):
    done = subprocess.run([LAUNCHCTL, *argv], capture_output=True, text=True, timeout=timeout,
                          stdin=subprocess.DEVNULL)
    return done.returncode, done.stdout, done.stderr


def print_fields(target):
    """pid / runs / last exit code / state from `launchctl print`, or loaded=False."""
    code, out, err = launchctl('print', target)
    if code:
        require(code == 113 and 'Could not find service' in err, 'launchctl print failed: ' + err[:200])
        return {'loaded': False, 'pid': None}
    found = {'loaded': True, 'pid': None}
    for key in ('pid', 'runs', 'last exit code'):
        match = re.search(r'^\s*' + re.escape(key) + r' = (\d+)$', out, re.M)
        if match:
            found[key.replace(' ', '_')] = int(match[1])
    match = re.search(r'^\s*state = (.+)$', out, re.M)
    found['state'] = match[1] if match else None
    found['pid'] = found.get('pid')
    return found


def wait_until(check, seconds):
    end = time.monotonic() + seconds
    while time.monotonic() < end:
        value = check()
        if value:
            return value
        time.sleep(0.02)
    return None


def starts(path):
    try:
        return [float(line) for line in path.read_text().split()]
    except (OSError, ValueError):
        return []


def launchd_log(label):
    """launchd's own lines about this label, if `log show` answers within its bound; else a note."""
    try:
        done = subprocess.run(['/usr/bin/log', 'show', '--last', '3m', '--style', 'compact', '--predicate',
                               'process == "launchd" AND eventMessage CONTAINS "%s"' % label],
                              capture_output=True, text=True, timeout=45, stdin=subprocess.DEVNULL)
    except (OSError, subprocess.TimeoutExpired) as error:
        return {'unavailable': repr(error)[:200]}
    lines = [line for line in done.stdout.splitlines() if label in line]
    return {'returncode': done.returncode, 'lines': lines[-40:]}


def trial(temp, uid, throttle, runtime, cleanup):
    label = PREFIX + secrets.token_hex(4) + ('.t%s' % throttle if throttle is not None else '.default')
    target = 'gui/%d/%s' % (uid, label)
    plist = temp / (label + '.plist')
    start_file = temp / (label + '.starts')
    settings = {'Label': label, 'RunAtLoad': True, 'KeepAlive': False,
                'ProgramArguments': ['/usr/bin/python3', '-c', JOB, str(start_file)],
                'StandardOutPath': str(temp / (label + '.out')), 'StandardErrorPath': str(temp / (label + '.err'))}
    if throttle is not None:
        settings['ThrottleInterval'] = throttle
    plist.write_bytes(plistlib.dumps(settings))
    row = {'label': label, 'throttle_interval': throttle, 'runtime_before_kill': runtime}
    require(not print_fields(target)['loaded'], 'probe label already loaded: ' + label)
    cleanup.append(target)
    code, out, err = launchctl('bootstrap', 'gui/%d' % uid, str(plist))
    require(code == 0, 'bootstrap failed: ' + err[:200])
    t_bootstrap = time.time()
    first = wait_until(lambda: print_fields(target)['pid'], 15)
    require(first, 'job did not start after bootstrap')
    recorded = wait_until(lambda: starts(start_file)[:1], 15)
    require(recorded, 'job did not record its start')
    row['first'] = {'pid': first, 'spawn': recorded[0], 'spawn_after_bootstrap': recorded[0] - t_bootstrap}
    time.sleep(runtime)
    t_kill = time.time()
    os.kill(first, signal.SIGTERM)
    stopped = wait_until(lambda: print_fields(target)['pid'] is None and print_fields(target)['loaded'], 15)
    require(stopped, 'job did not stop after SIGTERM')
    t_exit = time.time()
    row['kill'] = {'at': t_kill, 'exit_seen': t_exit, 'runtime': t_kill - recorded[0],
                   'fields_after_exit': print_fields(target)}
    t_issue = time.time()
    result = issue([LAUNCHCTL, 'kickstart', target])
    t_return = time.time()
    row['kickstart'] = {**result, 'issued_after_exit': t_issue - t_exit, 'returned_at': t_return}
    second = wait_until(lambda: (starts(start_file)[1:2] or None), SPAWN_WAIT)
    fields = print_fields(target)
    row['second'] = {'fields': fields, 'spawn': second[0] if second else None}
    if second:
        row['second'].update({'spawn_after_first_spawn': second[0] - recorded[0],
                              'spawn_after_exit': second[0] - t_exit,
                              'spawn_after_request': second[0] - t_issue,
                              'spawn_before_launchctl_returned': second[0] <= t_return})
    row['launchd_log'] = launchd_log(label)
    pid = fields.get('pid')
    if pid:
        try:
            os.kill(pid, signal.SIGTERM)
        except ProcessLookupError:
            pass
    code, out, err = launchctl('bootout', target, timeout=20)
    row['bootout'] = {'returncode': code, 'stderr': err[:200]}
    if code == 0:
        cleanup.remove(target)
    return row


def guard(argv, environ, platform=sys.platform):
    require(platform == 'darwin', 'the kickstart probe runs only on macOS')
    require(environ.get('CI') == 'true' and environ.get('GITHUB_ACTIONS') == 'true',
            'the kickstart probe runs only on a GitHub Actions runner')
    require(environ.get('OPENCLAW_KICKSTART_PROBE') == '1', 'OPENCLAW_KICKSTART_PROBE=1 is required')
    require(len(argv) == 2 and argv[0] == '--ci-owned-probe', 'usage: --ci-owned-probe OUTPUT_JSON | --self-test')
    output = pathlib.Path(argv[1])
    require(output.is_absolute() and not os.path.lexists(output) and output.parent.is_dir(),
            'probe output must be a new file in an existing directory')
    return output


def run(output):
    uid = os.getuid()
    temp = pathlib.Path(tempfile.mkdtemp(prefix='openclaw-kickstart-probe-', dir=os.environ.get('RUNNER_TEMP')))
    report = {'scope': 'owned labels only; no fixture, runtime or production label touched',
              'started_utc': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'uid': uid,
              'budget': BUDGET, 'extra': EXTRA, 'trials': [], 'completed': False}
    try:
        report['os'] = subprocess.run(['/usr/bin/sw_vers'], capture_output=True, text=True, timeout=10).stdout
    except (OSError, subprocess.TimeoutExpired):
        report['os'] = None
    cleanup = []
    try:
        code, out, _ = launchctl('print', 'gui/%d' % uid)
        require(code == 0 and PREFIX not in out, 'a probe label is already loaded in this domain')
        for throttle, runtime in TRIALS:
            report['trials'].append(trial(temp, uid, throttle, runtime, cleanup))
        report['completed'] = True
    except BaseException as error:
        report['error'] = repr(error)[:500]
        if not isinstance(error, Exception):
            raise
    finally:
        for target in list(cleanup):
            try:
                launchctl('bootout', target, timeout=20)
            except (OSError, subprocess.TimeoutExpired):
                pass
        code, out, _ = launchctl('print', 'gui/%d' % uid)
        report['cleanup'] = {'labels_left': [line.strip() for line in out.splitlines() if PREFIX in line]}
        shutil.rmtree(temp, ignore_errors=True)
        fd = os.open(output, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(fd, 'w') as handle:
            json.dump(report, handle, sort_keys=True, indent=1, default=repr)
            handle.write('\n')
    return 0 if report['completed'] and not report['cleanup']['labels_left'] else 1


if __name__ == '__main__':
    if sys.argv[1:] == ['--self-test']:
        sys.exit(self_test())
    sys.exit(run(guard(sys.argv[1:], os.environ)))
