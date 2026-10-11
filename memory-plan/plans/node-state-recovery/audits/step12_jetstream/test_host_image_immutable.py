#!/usr/bin/env python3
import os
import pathlib
import plistlib
import stat
import subprocess
import sys
import tempfile
import time
import unittest

from host_image_immutable import change_immutable
from host_vm_capture import clone_only
from stopped_tree_match import entries


def run(*args):
    result = subprocess.run(args, capture_output=True)
    if result.returncode:
        raise AssertionError(result.stderr.decode(errors='replace')[:500])
    return result.stdout


@unittest.skipUnless(sys.platform == 'darwin', 'requires macOS APFS file flags')
class HostImageImmutableTest(unittest.TestCase):
    def test_same_user_can_replay_flags_and_tree_digest_after_a_write(self):
        with tempfile.TemporaryDirectory(prefix='openclaw-owned-store-flag-') as parent:
            root = pathlib.Path(parent)
            store = root / 'store'
            store.mkdir()
            block = store / 'block'
            block.write_bytes(b'original bytes')
            before = entries(store)
            attempt = root / 'attempt'
            os.chflags(block, block.stat().st_flags | stat.UF_IMMUTABLE)
            os.chflags(store, store.stat().st_flags | stat.UF_IMMUTABLE)
            child = '''
import os, pathlib, stat, sys
store, block, attempt = map(pathlib.Path, sys.argv[1:])
original = block.read_bytes()
os.chflags(store, store.stat().st_flags & ~stat.UF_IMMUTABLE)
os.chflags(block, block.stat().st_flags & ~stat.UF_IMMUTABLE)
block.write_bytes(b'transient write')
attempt.write_bytes(block.read_bytes())
block.write_bytes(original)
os.chflags(block, block.stat().st_flags | stat.UF_IMMUTABLE)
os.chflags(store, store.stat().st_flags | stat.UF_IMMUTABLE)
'''
            try:
                result = subprocess.run([sys.executable, '-c', child, str(store), str(block),
                                         str(attempt)], capture_output=True, text=True, timeout=10)
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertEqual(attempt.read_bytes(), b'transient write')
                self.assertTrue(block.stat().st_flags & stat.UF_IMMUTABLE)
                self.assertTrue(store.stat().st_flags & stat.UF_IMMUTABLE)
                self.assertEqual(entries(store), before)
            finally:
                if store.exists() and store.stat().st_flags & stat.UF_IMMUTABLE:
                    os.chflags(store, store.stat().st_flags & ~stat.UF_IMMUTABLE)
                if block.exists() and block.stat().st_flags & stat.UF_IMMUTABLE:
                    os.chflags(block, block.stat().st_flags & ~stat.UF_IMMUTABLE)

    def test_disposable_asif_flag_lifecycle(self):
        with tempfile.TemporaryDirectory(prefix='openclaw-image-flag-') as parent:
            root = pathlib.Path(parent).resolve()
            source = root / 'source.asif'
            clone = root / 'clone.asif'
            disk = None
            try:
                run('/usr/sbin/diskutil', 'image', 'create', 'blank', '--format', 'ASIF',
                    '--size', '128m', '--fs', 'APFS', '--volumeName', 'Data', str(source))
                info = source.lstat()
                identity = (info.st_dev, info.st_ino, info.st_size)
                fd = os.open(source, os.O_RDWR)
                try:
                    change_immutable(source, identity, True)
                    with self.assertRaises(PermissionError):
                        open(source, 'r+b')
                    os.pwrite(fd, os.pread(fd, 1, 0), 0)
                finally:
                    os.close(fd)
                clone_only(source, clone)
                clone_info = clone.lstat()
                clone_identity = (clone_info.st_dev, clone_info.st_ino, clone_info.st_size)
                self.assertTrue(clone_info.st_flags & stat.UF_IMMUTABLE)
                attached = plistlib.loads(run('/usr/sbin/diskutil', 'image', 'attach',
                                               '--plist', '--readOnly', '--noMount', str(clone)))
                disk = attached['system-entities'][0]['dev-entry']
                with self.assertRaises(PermissionError):
                    clone.unlink()
                for attempt in range(20):
                    result = subprocess.run(['/usr/sbin/diskutil', 'eject', disk],
                                            capture_output=True)
                    if result.returncode == 0:
                        disk = None
                        break
                    if b'Volume failed to eject' not in result.stderr:
                        raise AssertionError(result.stderr.decode(errors='replace')[:500])
                    time.sleep(0.25)
                self.assertIsNone(disk)
                change_immutable(clone, clone_identity, False)
                clone.unlink()
                self.assertTrue(source.lstat().st_flags & stat.UF_IMMUTABLE)
                change_immutable(source, identity, False)
                with open(source, 'r+b') as writable:
                    writable.write(b'Y')
                with self.assertRaisesRegex(RuntimeError, 'identity differs'):
                    change_immutable(source, (identity[0], identity[1] + 1, identity[2]), True)
                symlink = root / 'redirect.asif'
                symlink.symlink_to(source)
                with self.assertRaisesRegex(RuntimeError, 'redirected'):
                    change_immutable(symlink, identity, True)
                self.assertFalse(source.lstat().st_flags & stat.UF_IMMUTABLE)
            finally:
                if disk:
                    run('/usr/sbin/diskutil', 'eject', disk)
                for path in (clone, source):
                    if path.exists() and path.lstat().st_flags & stat.UF_IMMUTABLE:
                        os.chflags(path, path.lstat().st_flags & ~stat.UF_IMMUTABLE)


if __name__ == '__main__':
    unittest.main()
