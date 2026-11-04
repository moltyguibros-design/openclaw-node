#!/usr/bin/env python3
"""CI-only owned-label timing experiment derived from Claude artifact7d3e90a4.

Seven fresh launchd jobs vary requested runtime, request delay and ThrottleInterval. A ten-second
post-timeout client sample precedes a further bounded wait; the job records its
own first Python instruction's wall time, not a kernel spawn/exit timestamp.
Controller elapsed time is monotonic; cross-process wall-time deltas can reflect
clock changes. Measurements constrain hypotheses on this runner, not the cause
of a different CI failure. No runtime deadline or production job is changed.

All native guards are mandatory. Bootstrap, kill and bootout use only this run's
fresh owned targets. Known target observations and a readable GUI-domain census
must show no probe label left; failures keep the directory and exit nonzero.
Own launchctl clients are killed/reaped on interrupted measurement. Cleanup is
sequential, not future-start or physical-process exclusion. A job timeout or
report-write failure can lose the report; missing/nonzero reports cannot pass.
The isolated kickstart-timing-macos job always attempts report retention.
"""
import datetime
import json
import os
import pathlib
import plistlib
import re
import secrets
import shutil
import subprocess
import sys
import tempfile
import time

LAUNCHCTL = '/bin/launchctl'
BUDGET = 10.0          # the fixture's command() budget
EXTRA = 15.0
SPAWN_WAIT = 10.0
PREFIX = 'ai.openclaw.owned-kickstart-probe.'
TRIALS = ((None, 0.3, 0.0), (None, 3.0, 0.0), (None, 12.0, 0.0),
          (None, 0.3, 1.0), (1, 0.3, 0.0), (1, 3.0, 0.0), (0, 0.3, 0.0))
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

    at_budget: 'returned' (within budget), 'alive' (launchctl running when sampled after timeout),
    or 'exited-pipe-held' (launchctl had exited, yet communicate() timed out because
    another process holds its stdout/stderr pipe). `block` is the real time until exit for
    'returned' and 'alive'; for 'exited-pipe-held' it is only an upper bound (the exit happened
    some time before the budget, unobserved).
    """
    started = time.monotonic()
    child = subprocess.Popen(argv, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    primary = None
    try:
        result = measure(child, argv, started, budget, extra)
    except BaseException as error:
        primary = error
    finally:
        try:
            try:
                if child.poll() is None:
                    child.kill()
                    child.wait(timeout=5)
            finally:
                for stream in (child.stdout, child.stderr):
                    if stream is not None:
                        stream.close()
        except BaseException as cleanup_error:
            if primary is None:
                raise
            primary.client_cleanup_error = repr(cleanup_error)[:300]
    if primary is not None:
        raise primary
    return result


def measure(child, argv, started, budget, extra):
    try:
        out, err = child.communicate(timeout=budget)
        return {'argv': argv, 'at_budget': 'returned', 'returncode': child.returncode,
                'block': time.monotonic() - started, 'stdout': out.decode(errors='replace')[:2000],
                'stderr': err.decode(errors='replace')[:2000]}
    except subprocess.TimeoutExpired:
        pass
    at_budget = 'alive' if child.poll() is None else 'exited-pipe-held'
    sampled_after = time.monotonic() - started
    returncode_at_budget = child.returncode
    try:
        child.wait(timeout=extra)          # exit only: a held pipe cannot keep this waiting
        ended = 'returned-late'
    except subprocess.TimeoutExpired:
        child.kill()
        child.wait(timeout=5)
        ended = 'killed-after-extra'
    block = time.monotonic() - started
    return {'argv': argv, 'at_budget': at_budget, 'returncode_at_budget': returncode_at_budget,
            'post_timeout_sample_elapsed': sampled_after,
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
    code, out, err = launchctl('print', target, timeout=5)
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


def stopped_observation(target):
    began = time.monotonic()
    fields = print_fields(target)
    if fields['loaded'] and fields['pid'] is None:
        return {'fields': fields, 'poll_seconds': time.monotonic() - began}
    return None


def launchd_log():
    """launchd's own lines about this label, if `log show` answers within its bound; else a note."""
    try:
        done = subprocess.run(['/usr/bin/log', 'show', '--last', '3m', '--style', 'compact', '--predicate',
                               'process == "launchd" AND eventMessage CONTAINS "%s"' % PREFIX],
                              capture_output=True, text=True, timeout=10, stdin=subprocess.DEVNULL)
    except (OSError, subprocess.TimeoutExpired) as error:
        return {'unavailable': repr(error)[:200]}
    lines = [line for line in done.stdout.splitlines() if PREFIX in line]
    return {'returncode': done.returncode, 'lines': lines[-100:]}


def trial(temp, uid, throttle, runtime, cleanup, row, request_delay=0.0):
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
    row.update({'label': label, 'throttle_interval': throttle, 'runtime_before_kill': runtime,
                'request_delay': request_delay, 'load_average': list(os.getloadavg()),
                'signal_method': 'launchctl kill SIGTERM target; differs from fixture os.kill'})
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
    code, out, err = launchctl('kill', 'SIGTERM', target)
    require(code == 0, 'owned target SIGTERM failed: ' + err[:200])
    stopped = wait_until(lambda: stopped_observation(target), 15)
    require(stopped, 'job did not stop after SIGTERM')
    t_exit = time.time()
    row['kill'] = {'at': t_kill, 'exit_seen': t_exit, 'runtime': t_kill - recorded[0],
                   'observation': stopped}
    before_print = time.monotonic()
    row['control_print'] = {'fields': print_fields(target), 'seconds': time.monotonic() - before_print}
    require(row['control_print']['fields']['loaded'] and row['control_print']['fields']['pid'] is None,
            'owned job is not stopped before the request')
    time.sleep(request_delay)
    t_issue = time.time()
    result = issue([LAUNCHCTL, 'kickstart', target])
    t_return = time.time()
    row['kickstart'] = {**result, 'issued_after_exit': t_issue - t_exit, 'returned_at': t_return}
    interval = 10.0 if throttle is None else float(throttle)
    predictions = {'first_instruction_origin': max(0.0, interval - (t_issue - recorded[0])),
                   'exit_observation_origin': max(0.0, interval - (t_issue - t_exit)),
                   'request_origin': interval}
    row['hypotheses'] = {'assumed_interval': interval,
                         'request_after_first_instruction': t_issue - recorded[0],
                         'predicted_block': predictions,
                         'residual': {key: result['block'] - value for key, value in predictions.items()},
                         'limit': 'illustrative models; Python instruction/startup bias, observed exit and wall-clock deltas; zero throttle interpreted literally may differ from launchd'}
    require(result['returncode'] == 0, 'owned kickstart did not return success')
    second = wait_until(lambda: (starts(start_file)[1:2] or None), SPAWN_WAIT)
    fields = print_fields(target)
    row['second'] = {'fields': fields, 'spawn': second[0] if second else None}
    require(second and fields['loaded'] and fields.get('pid'), 'kickstarted instance did not record a running start')
    if second:
        row['second'].update({'spawn_after_first_spawn': second[0] - recorded[0],
                              'spawn_after_exit': second[0] - t_exit,
                              'spawn_after_request': second[0] - t_issue,
                              'spawn_before_launchctl_returned': second[0] <= t_return})
    code, out, err = launchctl('bootout', target, timeout=20)
    row['bootout'] = {'returncode': code, 'stderr': err[:200]}
    require(code == 0, 'owned trial bootout failed')
    row['after_bootout'] = print_fields(target)
    require(row['after_bootout']['loaded'] is False, 'owned trial label is still loaded')


def guard(argv, environ, platform=sys.platform):
    require(platform == 'darwin', 'the kickstart probe runs only on macOS')
    require(os.getuid() != 0, 'the kickstart probe requires a non-root runner')
    require(environ.get('CI') == 'true' and environ.get('GITHUB_ACTIONS') == 'true',
            'the kickstart probe runs only on a GitHub Actions runner')
    require(environ.get('OPENCLAW_KICKSTART_PROBE') == '1', 'OPENCLAW_KICKSTART_PROBE=1 is required')
    require(len(argv) == 2 and argv[0] == '--ci-owned-probe', 'usage: --ci-owned-probe OUTPUT_JSON | --self-test')
    output = pathlib.Path(argv[1])
    require(output.is_absolute() and not os.path.lexists(output) and output.parent.is_dir(),
            'probe output must be a new file in an existing directory')
    return output


def release(cleanup, uid):
    record = {'targets': [], 'errors': [], 'clean': False}
    late = None
    try:
        for target in cleanup:
            row = {'target': target}
            record['targets'].append(row)
            try:
                before = print_fields(target)
                row['before'] = before
                if before['loaded']:
                    code, _, err = launchctl('bootout', target, timeout=20)
                    row['bootout'] = {'returncode': code, 'stderr': err[:200]}
                row['after'] = print_fields(target)
            except Exception as error:
                row['error'] = repr(error)[:300]
                record['errors'].append(row['error'])
        code, out, err = launchctl('print', 'gui/%d' % uid)
        record['domain'] = {'returncode': code, 'stderr': err[:200]}
        require(code == 0, 'cleanup domain observation failed')
        record['labels_left'] = [line.strip() for line in out.splitlines() if PREFIX in line]
        record['clean'] = (not record['errors'] and not record['labels_left']
                           and all(row.get('after', {}).get('loaded') is False for row in record['targets']))
    except BaseException as error:
        record['errors'].append(repr(error)[:300])
        if not isinstance(error, Exception):
            late = error
    return record, late


def run(output):
    uid = os.getuid()
    temp = pathlib.Path(tempfile.mkdtemp(prefix='openclaw-kickstart-probe-', dir=os.environ.get('RUNNER_TEMP')))
    report = {'scope': 'owned labels only; no fixture, runtime or production label touched; post-timeout samples, not exact deadline state',
              'started_utc': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'uid': uid,
              'budget': BUDGET, 'extra': EXTRA, 'trials': [], 'completed': False}
    try:
        report['os'] = subprocess.run(['/usr/bin/sw_vers'], capture_output=True, text=True, timeout=10).stdout
    except (OSError, subprocess.TimeoutExpired):
        report['os'] = None
    cleanup = []
    primary = None
    try:
        code, out, _ = launchctl('print', 'gui/%d' % uid)
        require(code == 0 and PREFIX not in out, 'a probe label is already loaded in this domain')
        for throttle, runtime, delay in TRIALS:
            row = {}
            report['trials'].append(row)
            trial(temp, uid, throttle, runtime, cleanup, row, request_delay=delay)
        report['launchd_log'] = launchd_log()
        report['completed'] = True
    except BaseException as error:
        report['error'] = {'repr': repr(error)[:500], 'text': str(error)[:500],
                           'client_cleanup_error': getattr(error, 'client_cleanup_error', None)}
        primary = error
    finally:
        report['cleanup'], late = release(cleanup, uid)
        if report['completed'] and report['cleanup']['clean']:
            try:
                shutil.rmtree(temp)
            except OSError as error:
                report['cleanup']['removal_error'] = repr(error)[:300]
        report['cleanup']['removed'] = not os.path.lexists(temp)
        fd = os.open(output, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(fd, 'w') as handle:
            json.dump(report, handle, sort_keys=True, indent=1, default=repr)
            handle.write('\n')
        if primary is not None and not isinstance(primary, Exception):
            raise primary
        if late is not None:
            raise late
    return 0 if report['completed'] and report['cleanup']['clean'] and report['cleanup']['removed'] else 1


if __name__ == '__main__':
    if sys.argv[1:] == ['--self-test']:
        sys.exit(self_test())
    sys.exit(run(guard(sys.argv[1:], os.environ)))
