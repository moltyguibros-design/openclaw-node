import json
import os
import pathlib
import stat
import subprocess
import sys
import tempfile
import unittest
from unittest import mock

from owned_kickstart_trace import traced_popen


class OwnedClientTrace(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix='openclaw-owned-client-trace-')
        self.addCleanup(self.temporary.cleanup)
        self.report = pathlib.Path(self.temporary.name) / 'trace.json'

    def start(self, command, expected=None, **kwargs):
        observed = traced_popen(command if expected is None else expected, self.report, {'owned': True})
        child = observed(command, stdout=subprocess.PIPE, stderr=subprocess.PIPE, **kwargs)
        self.addCleanup(self.finish, child)
        return child

    def finish(self, child):
        if child.poll() is None:
            child.kill()
        child.communicate(timeout=10)
        for stream in (child.stdout, child.stderr):
            stream.close()

    def read_report(self):
        self.assertTrue(self.report.exists(), 'owned client observation was not recorded')
        return json.loads(self.report.read_text())

    def test_a_client_still_alive_after_timeout_is_recorded_without_changing_the_exception(self):
        child = self.start([sys.executable, '-I', '-S', '-c', 'import time; time.sleep(60)'])
        with self.assertRaises(subprocess.TimeoutExpired) as raised:
            child.communicate(timeout=.05)
        self.assertEqual(raised.exception.timeout, .05)
        value = self.read_report()
        self.assertEqual((value['event'], value['client_returncode_when_sampled'], value['timeout_s']),
                         ('timeout', None, .05))
        self.assertEqual(stat.S_IMODE(self.report.stat().st_mode), 0o600)

    def test_an_exited_client_with_descendant_held_output_is_distinguished_without_a_startup_race(self):
        read_fd, write_fd = os.pipe()
        descendant = 'import os,sys; os.read(int(sys.argv[1]),1)'
        source = ('import subprocess,sys; subprocess.Popen([sys.executable,"-I","-S","-c",'
                  + repr(descendant) + ',sys.argv[1]],pass_fds=(int(sys.argv[1]),))')
        try:
            child = self.start([sys.executable, '-I', '-S', '-c', source, str(read_fd)], pass_fds=(read_fd,))
            os.close(read_fd)
            read_fd = None
            self.assertEqual(child.wait(timeout=10), 0)
            with self.assertRaises(subprocess.TimeoutExpired):
                child.communicate(timeout=.05)
            value = self.read_report()
            self.assertEqual((value['event'], value['client_returncode_when_sampled']), ('timeout', 0))
        finally:
            if read_fd is not None:
                os.close(read_fd)
            os.close(write_fd)

    def test_completed_output_is_unchanged_and_only_lengths_are_recorded(self):
        child = self.start([sys.executable, '-I', '-S', '-c',
                            'import sys; print("owned-output"); print("owned-error",file=sys.stderr)'])
        stdout, stderr = child.communicate(timeout=10)
        self.assertEqual((stdout, stderr), (b'owned-output\n', b'owned-error\n'))
        value = self.read_report()
        self.assertEqual((value['event'], value['client_returncode_when_sampled']), ('completed', 0))
        self.assertEqual((value['stdout_length'], value['stderr_length']), (len(stdout), len(stderr)))
        self.assertNotIn('owned-output', self.report.read_text())

    def test_other_commands_are_not_recorded(self):
        child = self.start([sys.executable, '-I', '-S', '-c', 'pass'], expected=['another-command'])
        self.assertEqual(child.communicate(timeout=10), (b'', b''))
        self.assertFalse(self.report.exists())

    def test_an_unwritable_report_does_not_replace_the_timeout(self):
        self.report = self.report / 'missing-parent'
        child = self.start([sys.executable, '-I', '-S', '-c', 'import time; time.sleep(60)'])
        with self.assertRaises(subprocess.TimeoutExpired):
            child.communicate(timeout=.05)
        self.assertFalse(self.report.exists())

    def test_run_keeps_the_timeout_exception_and_initial_observation(self):
        command = [sys.executable, '-I', '-S', '-c', 'import time; time.sleep(60)']
        observed = traced_popen(command, self.report, {'owned': True})
        with mock.patch('subprocess.Popen', observed):
            with self.assertRaises(subprocess.TimeoutExpired):
                subprocess.run(command, capture_output=True, timeout=.05)
        value = self.read_report()
        self.assertEqual((value['event'], value['client_returncode_when_sampled']), ('timeout', None))


if __name__ == '__main__':
    unittest.main()
