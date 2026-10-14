"""Applied-timeout kickstart through restore_only.recover_owned without launchctl.

Real: preflight, Journal, JournaledHold, service_gate Gate, OwnedLaunchdAdapter, Launchd.
Simulated: every `/bin/launchctl` subprocess.run (FakeLaunchd below); other commands run for real.
Seams (behaviour-neutral for this path):
  - restore_only.sys.platform reads 'darwin' (Linux only needs it; harmless on macOS);
  - OwnedLaunchdAdapter.health checks the simulated pid (Launchd.bind reads a real process via sysctl);
  - Linux only: the timer anchor skips the macOS-literal '/bin/sh' inventory entry, because /bin/sh
    is a symlink there; the kickstarted daemon's identity check is untouched.
"""
import json
import os
import pathlib
import plistlib
import secrets
import shutil
import subprocess
import sys
import tempfile
import time
import types
import unittest
from unittest.mock import patch

HERE = pathlib.Path(os.environ.get('STEP12', pathlib.Path(__file__).resolve().parent)).resolve()
sys.path.insert(0, str(HERE))

import restore_only  # noqa: E402
from journal_hold import ANCHOR, describe  # noqa: E402
from legacy_fixture import legacy_journal  # noqa: E402
from preservation_journal import UNITS, static_identity  # noqa: E402

SOURCE = HERE.parents[4] / 'workspace-bin/service_gate.py'
REAL_RUN = subprocess.run
PREFIX = 'kickstart timed out after 10s; effect undetermined; observed after timeout: '


class FakeLaunchd:
    def __init__(self):
        self.uid = os.getuid()
        self.jobs = {}
        self.log = []          # (verb, target, timeout passed by the caller)
        self.next_pid = 41000
        self.applied_timeout = True

    def add(self, label, plist, settings, running):
        self.jobs[label] = {'plist': str(plist), 's': settings, 'pid': None, 'runs': 0}
        if running:
            self.start(label)

    def start(self, label):
        job = self.jobs[label]
        if job['pid'] is None:
            self.next_pid += 1
            job['pid'], job['runs'] = self.next_pid, job['runs'] + 1

    def render(self, label):
        job, s = self.jobs[label], self.jobs[label]['s']
        env = {**s['EnvironmentVariables'], 'XPC_SERVICE_NAME': label, 'OSLogRateLimit': '64'}
        lines = [f'gui/{self.uid}/{label} = {{', f'\tpath = {job["plist"]}',
                 f'\tprogram = {s["ProgramArguments"][0]}', '\targuments = {',
                 *[f'\t\t{arg}' for arg in s['ProgramArguments']], '\t}',
                 f'\tworking directory = {s["WorkingDirectory"]}',
                 f'\tstdout path = {s["StandardOutPath"]}', f'\tstderr path = {s["StandardErrorPath"]}',
                 '\tenvironment = {', *[f'\t\t{k} => {v}' for k, v in env.items()], '\t}',
                 f'\truns = {job["runs"]}', *([f'\tpid = {job["pid"]}'] if job['pid'] else []),
                 '\tlast exit code = 0',
                 *([f'\trun interval = {s["StartInterval"]} seconds'] if 'StartInterval' in s else []),
                 '\tproperties = inferred program | system service', '}']
        return '\n'.join(lines) + '\n'

    def run(self, argv, *args, **kwargs):
        if not argv or argv[0] != '/bin/launchctl':
            return REAL_RUN(argv, *args, **kwargs)
        verb, target = argv[1], (argv[2] if len(argv) > 2 else None)
        self.log.append((verb, target, kwargs.get('timeout')))
        done = lambda code=0, out='', err='': subprocess.CompletedProcess(argv, code, out, err)  # noqa: E731
        if verb == 'managername':
            return done(out='Aqua\n')
        if verb == 'print-disabled':
            return done(out='disabled services = {\n}\n')
        if verb == 'print' and target in (f'gui/{self.uid}', f'user/{self.uid}'):
            rows = ''.join(f'\t\t{job["pid"] or "-"}\t0\t{label}\n' for label, job in self.jobs.items()
                           if target.startswith('gui/'))
            return done(out=f'{target} = {{\n\tservices = {{\n{rows}\t}}\n}}\n')
        if verb == 'print':
            domain, _, label = target.split('/', 2)
            if domain != 'gui' or label not in self.jobs:
                return done(113, err=f'Could not find service "{label}" in domain for port\n')
            return done(out=self.render(label))
        if verb == 'kickstart' and self.applied_timeout:
            # The request takes effect, but the client gives up first.
            self.start(target.split('/', 2)[2])
            raise subprocess.TimeoutExpired(argv, kwargs.get('timeout'))
        raise AssertionError('unmodelled launchctl call: ' + ' '.join(argv))


class AppliedKickstartTimeout(unittest.TestCase):
    def setUp(self):
        # Same owned layout and interrupted hold as test_restore_only.RestoreOnlyOwned, minus launchd.
        self.root = pathlib.Path(tempfile.gettempdir()).resolve() / ('openclaw-owned-recovery-' + secrets.token_hex(8))
        self.root.mkdir(mode=0o700)
        (self.root / 'plists').mkdir(mode=0o700)
        gate_root = self.root / 'gate'
        pin = restore_only.gate_module.initialize(gate_root)
        self.gate = restore_only.gate_module.Gate(gate_root, pin)
        self.journal_root = self.root / 'preservation/journals/owned'
        node_lock = self.root / 'preservation/node.lock'
        for name, source in (('owned_recovery_service.cjs', HERE / 'owned_recovery_service.cjs'),
                             ('service_gate.py', SOURCE)):
            (self.root / name).write_bytes(source.read_bytes())
            (self.root / name).chmod(0o600)
        self.sim = FakeLaunchd()
        self.label = {}
        for unit in (ANCHOR, 'mesh-agent'):
            label = 'ai.openclaw.' + self.root.name + '.' + unit
            argv = (['/usr/bin/python3', '-I', '-S', str(self.root / 'service_gate.py'), 'run', str(gate_root),
                     '--lock', pin['lock'], '--root-pin', pin['root'], '--', '/bin/sh', '-c',
                     'printf "fired\\n" >> "$OWNED_FIRE_LOG"'] if unit == ANCHOR
                    else [str(pathlib.Path(shutil.which('node')).resolve(strict=True)),
                          str(self.root / 'owned_recovery_service.cjs')])
            settings = {'Label': label, 'ProgramArguments': argv, 'WorkingDirectory': str(self.root),
                        'StandardOutPath': str(self.root / (unit + '.out')),
                        'StandardErrorPath': str(self.root / (unit + '.err')),
                        'EnvironmentVariables': {'OWNED_ROLE': unit, 'OWNED_HEALTH_PORT': '1',
                                                 'OWNED_UNREADY_FILE': str(self.root / 'unready'),
                                                 'OWNED_FIRE_LOG': str(self.root / 'fires.log')},
                        'RunAtLoad': unit != ANCHOR,
                        **({'StartInterval': 3600} if unit == ANCHOR else {'KeepAlive': False})}
            plist = self.root / 'plists' / (unit + '.plist')
            plist.write_bytes(plistlib.dumps(settings))
            plist.chmod(0o600)
            for name in (unit + '.out', unit + '.err'):
                (self.root / name).touch(mode=0o600)
            self.sim.add(label, plist, settings, running=unit == 'mesh-agent')
            self.label[unit] = label
        prior = {unit: {'class': 'absent', 'loaded': False, 'running': False, 'disabled': False,
                        'identity': {'installed': False}} for unit in UNITS}
        for unit, kind in ((ANCHOR, 'timer'), ('mesh-agent', 'daemon')):
            prior[unit] = {'class': kind, 'loaded': True, 'running': kind == 'daemon', 'disabled': False,
                           'identity': static_identity(self.root / 'plists' / (unit + '.plist'))}
        prior[ANCHOR]['execution_hold'] = describe(self.gate, [ANCHOR])
        with legacy_journal(self.journal_root, prior, node_lock=node_lock):
            pass
        self.interrupt(gate_root, node_lock)
        self.sim.jobs[self.label['mesh-agent']]['pid'] = None   # loaded, stopped owned daemon

    def tearDown(self):
        self.gate.close()
        shutil.rmtree(self.root)

    def interrupt(self, gate_root, node_lock):
        # test_restore_only.interrupt('after-receipt'): published closed hold, controller killed.
        ready = self.root / 'controller-ready'
        child = subprocess.Popen([sys.executable, '-c', '''
import importlib.util, pathlib, sys, time
from preservation_journal import Journal
from journal_hold import JournaledHold, ANCHOR
root, gate_root, lock, ready, source = map(pathlib.Path, sys.argv[1:6])
spec = importlib.util.spec_from_file_location('gate', source)
gate_module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(gate_module)
with Journal(root, node_lock=lock) as journal:
    with gate_module.Gate(gate_root, journal.prior[ANCHOR]['execution_hold']['pins']) as gate:
        hold = JournaledHold(journal, gate, lambda: {'verified': False})
        fields = hold._fields(False)
        intent = journal.append('intent', unit=ANCHOR, action='owned-close', **fields)
        guard = gate.close_for_restoration(fields['hold']['window'], fields['hold']['reason'], 2,
                                           on_publication=lambda receipt: hold._published(intent, receipt))
        guard.close()
        ready.touch()
        time.sleep(60)
''', str(self.journal_root), str(gate_root), str(node_lock), str(ready), str(SOURCE)],
            cwd=HERE, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        end = time.monotonic() + 10
        while not ready.exists() and child.poll() is None and time.monotonic() < end:
            time.sleep(.03)
        child.kill()
        _, stderr = child.communicate(timeout=5)
        self.assertTrue(ready.exists(), stderr.decode())
        ready.unlink()

    def recover(self):
        sim, labels = self.sim, self.label
        real_identity = restore_only.OwnedLaunchdAdapter.identity

        def health(adapter, unit, status):
            if unit == 'mesh-agent' and status['running'] and status['pid'] != sim.jobs[labels[unit]]['pid']:
                raise restore_only.Refused('owned process generation changed')
            return True

        def identity(adapter, unit, prior):
            if unit != ANCHOR or sys.platform == 'darwin':
                return real_identity(adapter, unit, prior)
            saved = prior['identity']
            actual = static_identity(adapter.plist(unit), tuple(saved['files']), saved['dependencies'])
            if actual != saved:
                raise restore_only.Refused('immutable owned service identity changed')
            return actual

        with patch('subprocess.run', sim.run), \
                patch.object(restore_only, 'sys', types.SimpleNamespace(platform='darwin')), \
                patch.object(restore_only.OwnedLaunchdAdapter, 'health', health), \
                patch.object(restore_only.OwnedLaunchdAdapter, 'identity', identity):
            return json.loads(json.dumps(restore_only.recover_owned(self.root, 'owned')))

    def records(self):
        return [json.loads(path.read_text()) for path in sorted(self.journal_root.glob('*.json'))]

    def test_applied_timeout_refuses_durably_then_retry_observes_without_second_kickstart(self):
        before = len(self.records())
        result = self.recover()
        pid = self.sim.jobs[self.label['mesh-agent']]['pid']
        self.assertIsNotNone(pid, 'simulated kickstart did not take effect')
        new = self.records()[before:]
        events = [row['event'] for row in new]

        # Durable error row: the only error, identical in the result and the on-disk recovery-finished.
        self.assertEqual(len(result['errors']), 1, result['errors'])
        row = result['errors'][0]
        self.assertEqual((row['unit'], row['reason']), ('mesh-agent', 'UndeterminedLaunchdAction'), row)
        self.assertTrue(row['detail'].startswith(PREFIX), row)
        self.assertIn(str(pid), row['detail'][len(PREFIX):], row)  # tighten to your exact observation format
        self.assertEqual(new[-1]['event'], 'recovery-finished')
        self.assertIs(new[-1]['services_verified'], False)
        self.assertEqual(new[-1]['errors'], result['errors'])

        # Fail closed: partial, gate closed, receipt unresolved.
        self.assertEqual((result['outcome'], result['gate'], result['receipt_status']),
                         ('partial', 'closed', 'unresolved'), result)
        self.assertIsNotNone(self.gate.marker())

        # Intent without verification or reopen, even though the late owner now looks healthy.
        self.assertTrue(any(r['event'] == 'restoration-intent' and r.get('unit') == 'mesh-agent' for r in new))
        self.assertFalse(any(r['event'] == 'recovery-verified' and r.get('unit') == 'mesh-agent' for r in new))
        for forbidden in ('hold-reopen-ready', 'hold-reopen-intent', 'hold-opened',
                          'execution-hold-restored', 'resolved'):
            self.assertNotIn(forbidden, events)

        # One kickstart; forwarded budgets: two precondition prints, the command, one inspection.
        target = 'gui/%d/%s' % (os.getuid(), self.label['mesh-agent'])
        calls = [(verb, budget) for verb, t, budget in self.sim.log
                 if t == target and verb in ('print', 'kickstart')]
        kicks = [i for i, (verb, _) in enumerate(calls) if verb == 'kickstart']
        self.assertEqual(len(kicks), 1, calls)
        k = kicks[0]
        self.assertEqual(calls[k - 2:k + 2], [('print', 10), ('print', 10), ('kickstart', 10), ('print', 1)])

        # Retry: fresh observation adopts the running owner; no second kickstart, no new restore intent.
        self.sim.log.clear()
        before = len(self.records())
        retry = self.recover()
        new = self.records()[before:]
        self.assertEqual((retry['outcome'], retry['gate']), ('resolved', 'open'), retry)
        self.assertTrue(any(r['event'] == 'already-restored' and r.get('unit') == 'mesh-agent' for r in new))
        self.assertFalse(any(r['event'] == 'restoration-intent' and r.get('unit') == 'mesh-agent' for r in new))
        self.assertFalse(any(verb == 'kickstart' for verb, _, _ in self.sim.log))


if __name__ == '__main__':
    unittest.main()
