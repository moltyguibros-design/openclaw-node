import os
import pathlib
import plistlib
import subprocess
import sys
import tempfile
import time
import unittest

from managed_launchd import Launchd, Refused
from preservation_checks import disabled_overrides


@unittest.skipUnless(sys.platform == 'darwin', 'requires macOS launchd')
class DisabledLaunchd(unittest.TestCase):
    def test_owned_gui_override_blocks_managed_restart_until_enabled(self):
        label = 'ai.openclaw.preservation-owned.hold-bootstrap'
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
            def override(domain):
                output = subprocess.check_output(['/bin/launchctl', 'print-disabled',
                                                  domain + '/' + str(os.getuid())],
                                                 text=True, timeout=10)
                return disabled_overrides(output, {label})[label]
            override_attempted = False
            try:
                if not service.status()['loaded'] and service.disabled():
                    service.enable_after_hold()
                service.bootstrap()
                deadline = time.monotonic() + 10
                while not (ready.exists() and service.status()['running']) and time.monotonic() < deadline:
                    time.sleep(.02)
                self.assertTrue(ready.exists() and service.status()['running'])
                override_attempted = True
                service.disable_for_hold()
                self.assertIs(override('gui'), True)
                self.assertIs(override('user'), True)
                self.assertTrue(service.status()['running'])
                subprocess.run(['/bin/launchctl', 'bootout', service.target], check=True,
                               capture_output=True, timeout=10)
                self.assertFalse(service.status()['loaded'])
                self.assertTrue(service.disabled())
                ready.unlink()
                time.sleep(1)
                self.assertFalse(service.status()['loaded'])
                self.assertFalse(ready.exists())
                direct_command = ['/bin/launchctl', 'bootstrap', 'gui/' + str(os.getuid()), str(plist)]
                direct = subprocess.run(direct_command, capture_output=True, text=True, timeout=10)
                self.assertNotEqual(direct.returncode, 0, direct)
                self.assertFalse(service.status()['loaded'])
                self.assertFalse(ready.exists())
                with self.assertRaisesRegex(Refused, 'disabled managed unit'):
                    service.bootstrap()
                self.assertFalse(service.status()['loaded'])
                self.assertFalse(ready.exists())
                service.enable_after_hold()
                self.assertFalse(service.disabled())
                self.assertIsNot(override('gui'), True)
                self.assertIsNot(override('user'), True)
                subprocess.run(direct_command, check=True, capture_output=True, text=True, timeout=10)
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
