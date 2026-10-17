"""Owned tests for the GUI status agent's cleanup in host_vm_preflight.gui_utm_status (D188).

launchctl is an owned fake that models launchd state in a temporary directory: which labels are
loaded; a bootstrap that fails, hangs, applies and then hangs (a timed-out bootstrap that still
took effect), or applies only after the cleanup's print answered (a request still in flight in
launchd); a bootout that fails, hangs, or removes the label and then fails or hangs; and a print
that hangs or refuses without finding the label. The helper's status is written by the fake
bootstrap, as RunAtLoad would. Subprocess timeouts are compressed to 1 s and the 20 s status wait
runs on a 40x clock, by the test only; production keeps its bounds. Nothing touches the real
launchd.
"""
import json
import os
import pathlib
import plistlib
import subprocess
import stat
import sys
import tempfile
import time
import types
import unittest
from unittest import mock

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

import host_vm_preflight  # noqa: E402

FAKE_LAUNCHCTL = r'''
import json, os, pathlib, plistlib, subprocess, sys, time
state = pathlib.Path(os.environ['FAKE_LAUNCHD'])
with open(state / 'calls', 'a') as calls:
    calls.write(json.dumps(sys.argv[1:]) + '\n')
loaded = state / 'loaded'


def mode(name, default='ok'):
    path = state / name
    return path.read_text().strip() if path.exists() else default


def apply(agent):
    (loaded / agent['Label']).write_text('')
    previous = os.umask(0o022)
    try:
        for key in ('StandardOutPath', 'StandardErrorPath'):
            with open(agent[key], 'a') as stream:
                stream.write('owned helper ' + key)
    finally:
        os.umask(previous)
    status = pathlib.Path(agent['ProgramArguments'][-1])
    helper = mode('helper', 'write')
    if helper == 'write':
        status.write_text(json.dumps({'at_utc': 'x', 'returncode': 0, 'stdout': 'started', 'stderr': ''}))
    elif helper == 'garbage':
        status.write_text('{not json')


verb = sys.argv[1]
if verb == 'late-apply':
    # launchd applying a bootstrap whose client was already killed: only after the cleanup's
    # print has answered, and never at all if no print comes within 30 s.
    deadline = time.monotonic() + 30
    while not (state / 'printed').exists() and time.monotonic() < deadline:
        time.sleep(0.05)
    if (state / 'printed').exists():
        apply(plistlib.loads(pathlib.Path(sys.argv[2]).read_bytes()))
    sys.exit(0)
if verb == 'bootstrap':
    agent = plistlib.loads(pathlib.Path(sys.argv[3]).read_bytes())
    how = mode('bootstrap')
    if how == 'fail':
        sys.stderr.write('Bootstrap failed: 5: Input/output error\n')
        sys.exit(5)
    if how == 'late':
        subprocess.Popen([sys.executable, __file__, 'late-apply', sys.argv[3]], start_new_session=True,
                         stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    if how in ('hang', 'late'):
        time.sleep(60)
    apply(agent)
    if how == 'apply-then-hang':
        time.sleep(60)
    sys.exit(0)
label = sys.argv[2].rsplit('/', 1)[-1]
if verb == 'bootout':
    how = mode('bootout')
    if how == 'hang':
        time.sleep(60)
    if how == 'fail-keep':
        sys.stderr.write('Boot-out failed: 5: Input/output error\n')
        sys.exit(5)
    if how in ('fail-gone', 'remove-then-hang') and (loaded / label).exists():
        (loaded / label).unlink()
        if how == 'remove-then-hang':
            time.sleep(60)
        sys.stderr.write('Boot-out failed: 5: Input/output error\n')
        sys.exit(5)
    if (loaded / label).exists():
        (loaded / label).unlink()
        sys.exit(0)
    sys.stderr.write('Boot-out failed: 3: No such process\n')
    sys.exit(3)
if verb == 'print':
    how = mode('print')
    if how == 'hang':
        time.sleep(60)
    if how == 'refuse':
        sys.stderr.write('Bad request.\n')
        sys.exit(5)
    if how == 'refuse-113':
        sys.stderr.write('Could not print service: Operation not permitted\n')
        sys.exit(113)
    if how == 'refuse-text':
        sys.stderr.write('Could not find service "%s" in domain for user gui: 501\n' % label)
        sys.exit(1)
    found = (loaded / label).exists()
    (state / 'printed').write_text('')
    if found:
        print('state = not running')
        sys.exit(0)
    sys.stderr.write('Could not find service "%s" in domain for user gui: 501\n' % label)
    sys.exit(113)
sys.exit(64)
'''
OTHERS = ('ai.openclaw.host-preflight.' + 'f' * 32, 'ai.openclaw.mesh-agent')
LABEL = r'ai\.openclaw\.host-preflight\.[0-9a-f]{32}'
real_run = subprocess.run


def compressed(command, **options):
    """The real subprocess.run with its timeout compressed to 1 s (test speed only)."""
    options['timeout'] = min(options.get('timeout', 1), 1.0)
    return real_run(command, **options)


class GuiStatusCleanup(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory(prefix='openclaw-gui-status-')
        self.addCleanup(temporary.cleanup)
        self.temp = pathlib.Path(temporary.name)
        self.state = self.temp / 'launchd'
        (self.state / 'loaded').mkdir(parents=True)
        for label in OTHERS:  # unrelated loaded jobs that cleanup must never touch
            (self.state / 'loaded' / label).write_text('')
        fake = self.temp / 'launchctl'
        fake.write_text('#!%s\n%s' % (sys.executable, FAKE_LAUNCHCTL))
        fake.chmod(0o700)
        origin = time.monotonic()
        for patcher in (mock.patch.object(host_vm_preflight, 'LAUNCHCTL', str(fake)),
                        mock.patch.object(host_vm_preflight, 'subprocess',
                                          types.SimpleNamespace(run=compressed, TimeoutExpired=subprocess.TimeoutExpired)),
                        mock.patch.object(host_vm_preflight, 'time', types.SimpleNamespace(
                            monotonic=lambda: origin + (time.monotonic() - origin) * 40, sleep=time.sleep)),
                        mock.patch.dict(os.environ, {'FAKE_LAUNCHD': str(self.state)})):
            patcher.start()
            self.addCleanup(patcher.stop)
        self.count = 0

    def sample(self, **modes):
        for name, value in modes.items():
            (self.state / name).write_text(value)
        (self.state / 'calls').write_text('')
        self.count += 1
        output = self.temp / ('sample-%d' % self.count)
        output.mkdir(mode=0o700)
        return output

    def status(self, output):
        return host_vm_preflight.gui_utm_status('/fixture/utmctl', 'FIXTURE-UUID', output)

    def label(self, output):
        return plistlib.loads((output / 'utm-status.plist').read_bytes())['Label']

    def loaded(self):
        return sorted(path.name for path in (self.state / 'loaded').iterdir())

    def evidence(self, output):
        return json.loads((output / 'utm-status-cleanup.json').read_text())

    def cleanup_calls(self, output):
        """Every bootout/print names exactly this sample's unique label."""
        label = self.label(output)
        self.assertRegex(label, '^' + LABEL + '$')
        service = 'gui/%d/%s' % (os.getuid(), label)
        calls = [json.loads(line) for line in (self.state / 'calls').read_text().splitlines()]
        self.assertTrue(all(call == [call[0], service] for call in calls if call[0] in ('bootout', 'print')), calls)
        return calls

    def assert_only_own_label(self, output):
        """Cleanup named only this sample's label and left exactly the unrelated jobs loaded."""
        calls = self.cleanup_calls(output)
        self.assertEqual(self.loaded(), sorted(OTHERS))
        return calls

    def test_stdio_is_private_before_bootstrap_and_survives_append_open(self):
        output = self.sample()
        original = host_vm_preflight.run
        def checked(*args):
            if args[1] == 'bootstrap':
                for name in ('utm-status.out', 'utm-status.err'):
                    path = output / name
                    self.assertTrue(path.exists(), 'private stdio must exist before bootstrap')
                    info = path.lstat()
                    self.assertTrue(stat.S_ISREG(info.st_mode))
                    self.assertEqual((info.st_uid, info.st_nlink, stat.S_IMODE(info.st_mode)), (os.getuid(), 1, 0o600))
                    self.assertEqual(path.read_bytes(), b'')
            return original(*args)
        with mock.patch.object(host_vm_preflight, 'run', side_effect=checked):
            self.assertEqual(self.status(output)['stdout'], 'started')
        for name in ('utm-status.out', 'utm-status.err'):
            path = output / name
            self.assertEqual(stat.S_IMODE(path.stat().st_mode), 0o600)
            self.assertIn('owned helper', path.read_text())
        self.assert_only_own_label(output)

    def test_stdio_collision_or_symlink_refuses_before_bootstrap(self):
        for name in ('utm-status.out', 'utm-status.err'):
            for link in (False, True):
                with self.subTest(name=name, link=link):
                    output = self.sample()
                    target = self.temp / ('foreign-' + str(self.count))
                    target.write_bytes(b'foreign log bytes')
                    path = output / name
                    if link:
                        path.symlink_to(target)
                    else:
                        path.write_bytes(b'foreign log bytes')
                    with self.assertRaises(FileExistsError):
                        self.status(output)
                    self.assertEqual(target.read_bytes(), b'foreign log bytes')
                    self.assertEqual(path.read_bytes(), b'foreign log bytes')
                    self.assertEqual((self.state / 'calls').read_text(), '')
                    self.assertEqual(self.loaded(), sorted(OTHERS))

    def test_success_boots_out_its_own_label_without_cleanup_evidence(self):
        output = self.sample()
        self.assertEqual(self.status(output)['stdout'], 'started')
        calls = self.assert_only_own_label(output)
        self.assertEqual([call[0] for call in calls], ['bootstrap', 'bootout'])
        self.assertFalse((output / 'utm-status-cleanup.json').exists())

    def test_timed_out_bootstrap_that_applied_is_booted_out_and_not_accepted(self):
        # The fake bootstrap loads the job and writes a valid status, then the client times out.
        output = self.sample(bootstrap='apply-then-hang')
        with self.assertRaises(subprocess.TimeoutExpired) as raised:
            self.status(output)
        self.assertIn('bootstrap', ' '.join(raised.exception.cmd))
        self.assertTrue((output / 'utm-status.json').exists())
        self.assert_only_own_label(output)
        record = self.evidence(output)
        self.assertEqual((record['booted_out'], record['bootout']['returncode'], 'print' in record), (True, 0, False))
        self.assertIn('TimeoutExpired', record['primary_error'])

    def test_timed_out_bootstrap_that_never_applied_keeps_its_error_and_absence_evidence(self):
        output = self.sample(bootstrap='hang')
        with self.assertRaises(subprocess.TimeoutExpired):
            self.status(output)
        self.assert_only_own_label(output)
        record = self.evidence(output)
        self.assertEqual((record['booted_out'], record['bootout']['returncode'], record['print']['returncode'],
                          record['absent_at_print']), (False, 3, 113, True))

    def test_failed_bootstrap_keeps_its_own_error(self):
        output = self.sample(bootstrap='fail')
        with self.assertRaisesRegex(RuntimeError, 'launchctl failed: Bootstrap failed: 5'):
            self.status(output)
        self.assert_only_own_label(output)
        record = self.evidence(output)
        self.assertEqual((record['booted_out'], record['absent_at_print']), (False, True))

    def test_helper_timeout_is_not_masked_by_a_failing_cleanup(self):
        output = self.sample(helper='none', bootout='fail-keep')
        with self.assertRaisesRegex(RuntimeError, '^GUI UTM status helper timed out$'):
            self.status(output)
        record = self.evidence(output)
        self.assertEqual((record['booted_out'], record['bootout']['returncode'], record['print']['returncode'],
                          record['absent_at_print']), (False, 5, 0, False))
        self.assertIn(self.label(output), self.loaded())  # evidence says so; the error stays the original

    def test_refused_print_is_not_absence(self):
        # Only 113 with "Could not find service" reads as absence, as managed_launchd reads it.
        for refusal, code in (('refuse', 5), ('refuse-113', 113), ('refuse-text', 1)):
            with self.subTest(refusal):
                output = self.sample(bootstrap='hang', print=refusal)
                with self.assertRaises(subprocess.TimeoutExpired):
                    self.status(output)
                record = self.evidence(output)
                self.assertEqual((record['booted_out'], record['bootout']['returncode'],
                                  record['print']['returncode'], record['absent_at_print']), (False, 3, code, False))
                self.assertNotIn(self.label(output), self.loaded())  # absent in fact, not read as such

    def test_hung_cleanup_does_not_mask_the_original_error(self):
        output = self.sample(bootstrap='fail', bootout='hang', print='hang')
        with self.assertRaisesRegex(RuntimeError, 'launchctl failed: Bootstrap failed: 5'):
            self.status(output)
        record = self.evidence(output)
        self.assertEqual((record['booted_out'], record['bootout']['timed_out'], record['print']['timed_out'],
                          record['absent_at_print']), (False, True, True, False))

    def test_malformed_status_cleans_up_and_keeps_the_parse_error(self):
        output = self.sample(helper='garbage')
        with self.assertRaises(ValueError):
            self.status(output)
        self.assert_only_own_label(output)
        self.assertTrue(self.evidence(output)['booted_out'])

    def test_unwritable_evidence_does_not_mask_the_original_error(self):
        output = self.sample(helper='none')
        (output / 'utm-status-cleanup.json').write_text('occupied')
        with self.assertRaisesRegex(RuntimeError, '^GUI UTM status helper timed out$'):
            self.status(output)
        self.assert_only_own_label(output)

    def test_good_status_with_an_unremovable_agent_refuses(self):
        output = self.sample(bootout='fail-keep')
        with self.assertRaisesRegex(RuntimeError, '^GUI UTM status agent bootout did not succeed: ' + LABEL + '$'):
            self.status(output)
        record = self.evidence(output)
        self.assertEqual((record['primary_error'], record['booted_out'], record['absent_at_print']), (None, False, False))

    def test_good_status_after_an_unanswered_cleanup_refuses(self):
        output = self.sample(bootout='hang', print='hang')
        with self.assertRaisesRegex(RuntimeError, '^GUI UTM status agent bootout did not succeed: ' + LABEL + '$'):
            self.status(output)
        self.assertEqual(self.evidence(output)['booted_out'], False)

    def test_good_status_refuses_an_unsuccessful_bootout_even_when_the_label_is_gone(self):
        # The bootout removed the label but reported failure, or timed out after removing it; the
        # print then reads absence. Absence is evidence only: the unsuccessful action refuses.
        for how, outcome in (('fail-gone', (5, False)), ('remove-then-hang', (None, True))):
            with self.subTest(how):
                output = self.sample(bootout=how)
                with self.assertRaisesRegex(RuntimeError, '^GUI UTM status agent bootout did not succeed: ' + LABEL + '$'):
                    self.status(output)
                self.assert_only_own_label(output)
                record = self.evidence(output)
                self.assertEqual((record['primary_error'], record['booted_out'], record['absent_at_print']),
                                 (None, False, True))
                self.assertEqual((record['bootout']['returncode'], record['bootout']['timed_out']), outcome)

    def test_late_applied_bootstrap_is_the_documented_residual(self):
        # Residual, not a guarantee: a bootstrap request launchd applies only after its client was
        # killed and the cleanup's print answered leaves the job loaded. The original error stands,
        # and the evidence names the leftover label as absent only at the time of the print.
        output = self.sample(bootstrap='late')
        with self.assertRaises(subprocess.TimeoutExpired):
            self.status(output)
        record = self.evidence(output)
        self.assertEqual((record['booted_out'], record['absent_at_print']), (False, True))
        deadline = time.monotonic() + 10
        while self.label(output) not in self.loaded() and time.monotonic() < deadline:
            time.sleep(0.05)
        self.cleanup_calls(output)
        self.assertEqual(self.loaded(), sorted(OTHERS + (record['label'],)))
        self.assertEqual(record['label'], self.label(output))


if __name__ == '__main__':
    unittest.main()
