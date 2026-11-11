"""Scratch: run the D188 cleanup tests against the unfixed function and against source mutants.

Usage: python3 mutants_cleanup.py FIXED_STEP12_DIR BASE_STEP12_DIR
FIXED is step12_jetstream with gui-status-cleanup-fix-on-d187.patch applied; BASE is the same
directory without it (v2+D187). 'unfixed' is BASE's exact host_vm_preflight.py with only its two
'/bin/launchctl' literals routed through a LAUNCHCTL name (so the owned fake can stand in); every
other line is unchanged. Each mutant must fail the D188 tests; exit status 1 names any survivor.
"""
import pathlib
import shutil
import subprocess
import sys
import tempfile

FIX, BASE = pathlib.Path(sys.argv[1]), pathlib.Path(sys.argv[2])
MODULE, TEST = 'host_vm_preflight.py', 'test_host_vm_preflight_status.py'
MUTANTS = {
    'no cleanup on failure': ('        evidence = remove_disposable_agent(service)\n        try:\n',
        "        evidence = {'booted_out': True}\n        try:\n"),
    'cleanup failure masks the original': ('        except OSError:\n            pass\n        raise\n',
        "        except OSError:\n            pass\n        require(evidence['booted_out'], 'cleanup failed')\n        raise\n"),
    'evidence write unguarded': ("        try:\n            write_record(cleanup, {'label': label, 'primary_error': repr(error)[:300], **evidence})\n        except OSError:\n            pass\n",
        "        write_record(cleanup, {'label': label, 'primary_error': repr(error)[:300], **evidence})\n"),
    'bootout argv is not exactly the label': ("    bootout = launchctl_attempt('bootout', service)",
        "    bootout = launchctl_attempt('bootout', service.rsplit('/', 1)[0], service)"),
    'any bootout answer counted as booted out': ("    if bootout['returncode'] == 0:\n",
        "    if bootout['returncode'] is not None:\n"),
    'print skipped after an unsuccessful bootout': ("    listed = launchctl_attempt('print', service)\n",
        "    listed = {'returncode': None, 'timed_out': False, 'stderr': ''}\n"),
    'absence assumed, not read': ("            'absent_at_print': listed['returncode'] == 113 and 'Could not find service' in listed['stderr']}",
        "            'absent_at_print': True}"),
    'unanswered print read as absence': ("            'absent_at_print': listed['returncode'] == 113 and 'Could not find service' in listed['stderr']}",
        "            'absent_at_print': listed['returncode'] != 0}"),
    'any answered non-zero print read as absence': ("            'absent_at_print': listed['returncode'] == 113 and 'Could not find service' in listed['stderr']}",
        "            'absent_at_print': listed['returncode'] not in (None, 0)}"),
    'exit code alone read as absence': ("            'absent_at_print': listed['returncode'] == 113 and 'Could not find service' in listed['stderr']}",
        "            'absent_at_print': listed['returncode'] == 113}"),
    'message alone read as absence': ("            'absent_at_print': listed['returncode'] == 113 and 'Could not find service' in listed['stderr']}",
        "            'absent_at_print': 'Could not find service' in listed['stderr']}"),
    'timed-out bootstrap accepted': ("        run(LAUNCHCTL, 'bootstrap', target, str(agent))\n",
        "        try:\n            run(LAUNCHCTL, 'bootstrap', target, str(agent))\n        except subprocess.TimeoutExpired:\n            pass\n"),
    'success accepts absence after an unsuccessful bootout': ("    require(evidence['booted_out'], 'GUI UTM status agent bootout did not succeed: ' + label)\n",
        "    require(evidence['booted_out'] or evidence['absent_at_print'], 'GUI UTM status agent bootout did not succeed: ' + label)\n"),
    'success path skips the bootout check': ("    require(evidence['booted_out'], 'GUI UTM status agent bootout did not succeed: ' + label)\n",
        ''),
    'success cleanup evidence dropped': ("    if not evidence['booted_out']:\n        write_record(cleanup, {'label': label, 'primary_error': None, **evidence})\n",
        ''),
}


def verdict(module_text):
    with tempfile.TemporaryDirectory(prefix='cleanup-mutant-') as temporary:
        copy = pathlib.Path(temporary)
        shutil.copyfile(FIX / TEST, copy / TEST)
        (copy / MODULE).write_text(module_text)
        run = subprocess.run([sys.executable, '-B', TEST], cwd=copy, capture_output=True, text=True, timeout=600)
        tail = [line for line in run.stderr.splitlines() if line.startswith(('FAILED', 'OK', 'Ran'))]
        failing = sorted({line.split()[1] for line in run.stderr.splitlines() if line.startswith(('FAIL:', 'ERROR:'))})
        return run.returncode != 0, ' '.join(tail), failing


source = (FIX / MODULE).read_text()
unfixed = (BASE / MODULE).read_text().replace("'/bin/launchctl'", 'LAUNCHCTL').replace(
    'def gui_status_helper(', "LAUNCHCTL = '/bin/launchctl'\n\n\ndef gui_status_helper(", 1)
killed, tail, failing = verdict(unfixed)
print('%-44s %s %s\n    failing: %s' % ('unfixed v2+D187 structure', 'FAILS' if killed else 'PASSES', tail, failing))
problems = [] if killed else ['unfixed passes']
for name, (old, new) in MUTANTS.items():
    if source.count(old) != 1:
        problems.append(name + ': anchor %d' % source.count(old))
        print('%-44s ANCHOR(%d)' % (name, source.count(old)))
        continue
    killed, tail, failing = verdict(source.replace(old, new))
    print('%-44s %s %s %s' % (name, 'KILLED' if killed else 'SURVIVED', tail, failing))
    if not killed:
        problems.append(name + ': survived')
print('problems:', problems)
sys.exit(1 if problems else 0)
