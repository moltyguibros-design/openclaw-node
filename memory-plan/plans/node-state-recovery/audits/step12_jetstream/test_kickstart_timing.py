import io
import json
import os
import pathlib
import shutil
import subprocess
import sys
import tempfile
import unittest
from unittest import mock

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import probe_kickstart_timing as probe


class Client:
    def __init__(self, state, error=None):
        self.state, self.error = state, error
        self.returncode = 0 if state == 'pipe' else None
        self.stdout, self.stderr = io.BytesIO(b'observed'), io.BytesIO()
        self.killed, self.waited = False, []

    def communicate(self, timeout):
        if self.error:
            raise self.error
        if self.state == 'returned':
            self.returncode = 0
            return b'normal', b''
        raise subprocess.TimeoutExpired('owned client', timeout)

    def poll(self):
        return self.returncode

    def wait(self, timeout):
        self.waited.append(timeout)
        if self.state == 'never' and not self.killed:
            raise subprocess.TimeoutExpired('owned client', timeout)
        self.returncode = -9 if self.killed else 0

    def kill(self):
        self.killed = True


class Measurement(unittest.TestCase):
    def issue(self, child):
        with mock.patch.object(probe.subprocess, 'Popen', return_value=child):
            return probe.issue(['owned'], budget=.1, extra=.2)

    def test_completed_result_is_preserved(self):
        child = Client('returned')
        row = self.issue(child)
        self.assertEqual((row['at_budget'], row['returncode'], row['stdout']), ('returned', 0, 'normal'))
        self.assertFalse(child.killed)
        self.assertTrue(child.stdout.closed and child.stderr.closed)

    def test_post_timeout_sample_distinguishes_alive_from_exited_pipe(self):
        for state, expected in (('alive', 'alive'), ('pipe', 'exited-pipe-held')):
            child = Client(state)
            with self.subTest(state=state), mock.patch.object(probe, 'drain', return_value='drained'):
                row = self.issue(child)
            self.assertEqual((row['at_budget'], row['ended']), (expected, 'returned-late'))
            self.assertEqual(row['returncode_at_budget'], None if state == 'alive' else 0)
            self.assertEqual(child.waited, [.2])
            self.assertFalse(child.killed)

    def test_late_bound_kills_and_reaps_only_its_client(self):
        child = Client('never')
        with mock.patch.object(probe, 'drain', return_value=''):
            row = self.issue(child)
        self.assertEqual((row['ended'], child.killed, child.waited), ('killed-after-extra', True, [.2, 5]))

    def test_interrupt_preserves_primary_and_reaps_client(self):
        original = KeyboardInterrupt('measure interrupted')
        child = Client('alive', original)
        with self.assertRaises(KeyboardInterrupt) as raised:
            self.issue(child)
        self.assertIs(raised.exception, original)
        self.assertEqual((child.killed, child.waited), (True, [5]))
        self.assertTrue(child.stdout.closed and child.stderr.closed)

    def test_cleanup_failure_does_not_replace_measurement_failure(self):
        original = RuntimeError('primary')
        child = Client('alive', original)
        with mock.patch.object(child, 'wait', side_effect=OSError('wait failed')):
            with self.assertRaises(RuntimeError) as raised:
                self.issue(child)
        self.assertIs(raised.exception, original)
        self.assertIn('wait failed', original.client_cleanup_error)
        self.assertTrue(child.stdout.closed and child.stderr.closed)


class Cleanup(unittest.TestCase):
    def test_stop_observation_uses_one_loaded_snapshot(self):
        with mock.patch.object(probe, 'print_fields', return_value={'loaded': True, 'pid': None}) as fields:
            row = probe.stopped_observation('owned')
        fields.assert_called_once_with('owned')
        self.assertEqual(row['fields'], {'loaded': True, 'pid': None})
        self.assertGreaterEqual(row['poll_seconds'], 0)

    def release(self, fields, domain=(0, '', '')):
        target = 'gui/501/' + probe.PREFIX + 'owned'
        with mock.patch.object(probe, 'print_fields', side_effect=fields), \
                mock.patch.object(probe, 'launchctl', return_value=domain) as command:
            result, late = probe.release([target], 501)
        self.assertIsNone(late)
        return result, command

    def test_loaded_owned_label_is_booted_out_and_observed_absent(self):
        result, command = self.release([{'loaded': True}, {'loaded': False}])
        self.assertTrue(result['clean'])
        self.assertEqual(command.call_args_list[0].args[:1], ('bootout',))

    def test_unreadable_domain_is_not_clean_even_when_targets_are_absent(self):
        result, _ = self.release([{'loaded': False}, {'loaded': False}], (5, '', 'unreadable'))
        self.assertFalse(result['clean'])
        self.assertEqual(result['domain']['returncode'], 5)

    def test_unknown_target_and_loaded_target_each_refuse_cleanup(self):
        for fields in ([OSError('unknown')], [{'loaded': True}, {'loaded': True}]):
            result, _ = self.release(fields)
            self.assertFalse(result['clean'])

    def test_other_probe_label_in_readable_domain_refuses_cleanup(self):
        result, _ = self.release([{'loaded': False}, {'loaded': False}],
                                 (0, probe.PREFIX + 'another', ''))
        self.assertFalse(result['clean'])


class Trial(unittest.TestCase):
    def run_trial(self, second=True, absent=True):
        temp = pathlib.Path(tempfile.mkdtemp(prefix='openclaw-timing-trial-')).resolve()
        self.addCleanup(shutil.rmtree, temp, True)
        row, known = {}, []
        observations = [{'loaded': False}, {'loaded': True, 'pid': None},
                        {'loaded': True, 'pid': 222}, {'loaded': not absent}]
        with mock.patch.object(probe, 'print_fields', side_effect=observations), \
                mock.patch.object(probe, 'wait_until', side_effect=[111, [1.0], True, [2.0] if second else None]), \
                mock.patch.object(probe.time, 'sleep') as sleeps, \
                mock.patch.object(probe, 'issue', return_value={'returncode': 0, 'at_budget': 'returned', 'block': .5}), \
                mock.patch.object(probe, 'launchd_log', return_value={}), \
                mock.patch.object(probe, 'launchctl', return_value=(0, '', '')) as commands, \
                mock.patch.object(os, 'kill', side_effect=AssertionError('stale PID signal')):
            try:
                probe.trial(temp, 501, None, .3, known, row, request_delay=1.0)
                error = None
            except RuntimeError as caught:
                error = caught
        self.assertIn(mock.call(1.0), sleeps.call_args_list)
        return row, known, commands, error

    def test_signal_uses_exact_fresh_target_and_bootout_is_observed(self):
        row, known, commands, error = self.run_trial()
        self.assertIsNone(error)
        self.assertEqual(known, ['gui/501/' + row['label']])
        self.assertIn(mock.call('kill', 'SIGTERM', known[0]), commands.call_args_list)
        self.assertIn(mock.call('bootout', known[0], timeout=20), commands.call_args_list)
        self.assertFalse(row['after_bootout']['loaded'])

    def test_missing_second_start_and_uncertain_bootout_each_refuse(self):
        for second, absent, reason in ((False, True, 'did not record a running start'),
                                       (True, False, 'is still loaded')):
            row, known, commands, error = self.run_trial(second, absent)
            self.assertIsNotNone(error)
            self.assertIn(reason, str(error))
            self.assertTrue(known)
            self.assertIn('second', row)


class Reports(unittest.TestCase):
    def setUp(self):
        self.temp = pathlib.Path(tempfile.mkdtemp(prefix='openclaw-timing-test-')).resolve()
        self.addCleanup(shutil.rmtree, self.temp, True)
        patch = mock.patch.dict(os.environ, {'RUNNER_TEMP': str(self.temp)})
        patch.start()
        self.addCleanup(patch.stop)
        self.output = self.temp / 'report.json'

    def run_probe(self, completed=True, clean=True, late=None, remove=None):
        def trial(temp, uid, throttle, runtime, cleanup, row, request_delay=0.0):
            row['partial-observation'] = True
            if not completed:
                raise RuntimeError('trial failed')
        with mock.patch.object(probe.subprocess, 'run', return_value=mock.Mock(stdout='macOS')), \
                mock.patch.object(probe, 'launchctl', return_value=(0, '', '')), \
                mock.patch.object(probe, 'TRIALS', ((None, .3, 0.0),)), \
                mock.patch.object(probe, 'trial', side_effect=trial), \
                mock.patch.object(probe, 'launchd_log', return_value={}), \
                mock.patch.object(probe, 'release', return_value=({'clean': clean}, late)), \
                mock.patch.object(probe.shutil, 'rmtree', side_effect=remove or shutil.rmtree) as removal:
            code = probe.run(self.output)
        return code, json.loads(self.output.read_bytes()), removal

    def test_partial_trial_survives_and_failed_run_keeps_directory(self):
        code, report, removal = self.run_probe(completed=False)
        self.assertEqual((code, report['completed'], report['cleanup']['removed']), (1, False, False))
        self.assertEqual(report['trials'], [{'partial-observation': True}])
        self.assertIn('trial failed', report['error']['text'])
        removal.assert_not_called()

    def test_unknown_cleanup_keeps_files_and_refuses_even_completed_trials(self):
        code, report, removal = self.run_probe(clean=False)
        self.assertEqual((code, report['completed'], report['cleanup']['removed']), (1, True, False))
        removal.assert_not_called()

    def test_clean_run_removes_directory_and_returns_zero(self):
        code, report, _ = self.run_probe()
        self.assertEqual((code, report['completed'], report['cleanup']['removed']), (0, True, True))

    def test_removal_failure_is_recorded_and_not_successful(self):
        code, report, _ = self.run_probe(remove=OSError('busy'))
        self.assertEqual((code, report['cleanup']['removed']), (1, False))
        self.assertIn('busy', report['cleanup']['removal_error'])

    def test_cleanup_interrupt_is_reported_before_propagation(self):
        original = KeyboardInterrupt('cleanup')
        with self.assertRaises(KeyboardInterrupt) as raised:
            self.run_probe(clean=False, late=original)
        self.assertIs(raised.exception, original)
        self.assertTrue(self.output.exists())

    def test_all_native_guards_refuse_without_commands(self):
        args = ['--ci-owned-probe', str(self.output)]
        env = {'CI': 'true', 'GITHUB_ACTIONS': 'true', 'OPENCLAW_KICKSTART_PROBE': '1'}
        cases = [(args, env, 'linux'), (args, {**env, 'CI': 'false'}, 'darwin'),
                 (args, {**env, 'GITHUB_ACTIONS': ''}, 'darwin'), (args, {}, 'darwin'),
                 ([], env, 'darwin'), (['--ci-owned-probe', 'relative.json'], env, 'darwin')]
        with mock.patch.object(probe, 'launchctl', side_effect=AssertionError('command run')), \
                mock.patch.object(probe.os, 'getuid', return_value=501):
            for argv, environment, platform in cases:
                with self.subTest(argv=argv, environment=environment, platform=platform):
                    with self.assertRaises(RuntimeError):
                        probe.guard(argv, environment, platform)
            self.assertEqual(probe.guard(args, env, 'darwin'), self.output)

    def test_root_runner_refuses_before_any_command(self):
        with mock.patch.object(probe.os, 'getuid', return_value=0):
            with self.assertRaisesRegex(RuntimeError, 'requires a non-root runner'):
                probe.guard(['--ci-owned-probe', str(self.output)], {}, 'darwin')


if __name__ == '__main__':
    unittest.main()
