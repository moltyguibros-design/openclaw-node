import os
import pathlib
import plistlib
import subprocess
import sys
import tempfile
import time
import unittest

from managed_launchd import Launchd, Refused


@unittest.skipUnless(sys.platform == 'darwin', 'requires macOS launchd')
class DisabledLaunchd(unittest.TestCase):
    def test_owned_gui_override_blocks_managed_restart_until_enabled(self):
        label = 'ai.openclaw.preservation-owned.hold-probe'
        with tempfile.TemporaryDirectory(prefix='openclaw-launchd-disabled-') as directory:
            root = pathlib.Path(directory)
            ready = root / 'ready'
            script = root / 'owner.py'
            script.write_text('import pathlib,sys,time\npathlib.Path(sys.argv[1]).touch()\ntime.sleep(60)\n')
            plist = root / 'unit.plist'
            plist.write_bytes(plistlib.dumps({
                'Label': label, 'ProgramArguments': ['/usr/bin/python3', str(script), str(ready)],
                'WorkingDirectory': str(root), 'RunAtLoad': True, 'KeepAlive': False,
                'StandardOutPath': str(root / 'out.log'),
                'StandardErrorPath': str(root / 'err.log')}))
            service = Launchd(label, plist)
            override_attempted = False
            try:
                service.bootstrap()
                deadline = time.monotonic() + 10
                while not (ready.exists() and service.status()['running']) and time.monotonic() < deadline:
                    time.sleep(.02)
                self.assertTrue(ready.exists() and service.status()['running'])
                override_attempted = True
                service.disable_for_hold()
                self.assertTrue(service.status()['running'])
                subprocess.run(['/bin/launchctl', 'bootout', service.target], check=True,
                               capture_output=True, timeout=10)
                self.assertFalse(service.status()['loaded'])
                self.assertTrue(service.disabled())
                ready.unlink()
                with self.assertRaisesRegex(Refused, 'disabled managed unit'):
                    service.bootstrap()
                self.assertFalse(service.status()['loaded'])
                self.assertFalse(ready.exists())
                service.enable_after_hold()
                self.assertFalse(service.disabled())
                service.bootstrap()
                deadline = time.monotonic() + 10
                while not (ready.exists() and service.status()['running']) and time.monotonic() < deadline:
                    time.sleep(.02)
                self.assertTrue(ready.exists() and service.status()['running'])
            finally:
                try:
                    if service.status()['loaded']:
                        subprocess.run(['/bin/launchctl', 'bootout', service.target], check=True,
                                       capture_output=True, timeout=10)
                finally:
                    if override_attempted and not service.status()['loaded'] and service.disabled():
                        service.enable_after_hold()


if __name__ == '__main__':
    unittest.main()
