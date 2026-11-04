"""Test-only observation of an owned kickstart client, without changing its timeout or result."""
import json
import os
import subprocess
import time


def traced_popen(expected, destination, context):
    original = subprocess.Popen

    class Observed(original):
        def communicate(self, *args, **kwargs):
            started = time.monotonic()

            def record(event, stdout=None, stderr=None, timeout=None):
                if self.args != expected:
                    return
                try:
                    value = {
                        'event': event, 'context': context, 'client_pid': self.pid,
                        'client_returncode_when_sampled': self.poll(),
                        'elapsed_s': time.monotonic() - started, 'timeout_s': timeout,
                        'stdout_length': len(stdout or b''), 'stderr_length': len(stderr or b''),
                        'scope': 'owned test client observation; no cause or deadline-state attribution'}
                    fd = os.open(destination, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
                    with os.fdopen(fd, 'w') as output:
                        json.dump(value, output, sort_keys=True)
                except OSError:
                    pass

            try:
                result = super().communicate(*args, **kwargs)
            except subprocess.TimeoutExpired as error:
                record('timeout', error.output, error.stderr, error.timeout)
                raise
            record('completed', *result, timeout=kwargs.get('timeout'))
            return result

    return Observed
