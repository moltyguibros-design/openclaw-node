#!/usr/bin/env python3
import hashlib
import json
import os
import pathlib
import plistlib
import shutil
import stat
import subprocess
import sys
import tempfile
import threading
import time
import unittest
from unittest.mock import patch

import host_vm_preflight
import host_vm_guard
import host_vm_reconcile
from host_image_immutable import change_immutable
from host_clone_dispose import CAPTURE_SCOPE
from host_vm_capture import clone_only, file_hash
from host_vm_preflight import preflight, write_record
from host_vm_guard import GUARD_SCOPE, guard
from host_vm_reconcile import reconcile


def run(*args):
    result = subprocess.run(args, capture_output=True)
    if result.returncode:
        raise AssertionError(result.stderr.decode(errors='replace')[:500])
    return result.stdout


@unittest.skipUnless(sys.platform == 'darwin', 'requires macOS ASIF and GUI launchd')
class HostReconcileTest(unittest.TestCase):
    def test_gui_status_is_published_only_after_json_is_complete(self):
        with tempfile.TemporaryDirectory(prefix='openclaw-status-atomic-') as parent:
            root = pathlib.Path(parent)
            controller = root / 'fake-utmctl'
            controller.write_text('#!/bin/sh\necho stopped\n')
            controller.chmod(0o700)
            status = root / 'utm-status.json'
            opened = threading.Event()
            release = threading.Event()
            errors = []
            original = host_vm_preflight.write_record

            def delayed_write(path, value):
                with open(path, 'x', encoding='utf-8') as output:
                    opened.set()
                    if not release.wait(5):
                        raise RuntimeError('fixture writer was not released')
                    json.dump(value, output)
                    output.flush()
                    os.fsync(output.fileno())

            def helper():
                try:
                    host_vm_preflight.gui_status_helper(controller, 'fixture', status)
                except Exception as error:
                    errors.append(error)

            host_vm_preflight.write_record = delayed_write
            try:
                worker = threading.Thread(target=helper)
                worker.start()
                self.assertTrue(opened.wait(5))
                self.assertFalse(status.exists())
                release.set()
                worker.join(timeout=5)
                self.assertFalse(worker.is_alive())
                self.assertFalse(errors)
                self.assertEqual(json.loads(status.read_text())['stdout'], 'stopped')
            finally:
                release.set()
                host_vm_preflight.write_record = original

    def test_attached_and_other_clone_refuse_then_bootable(self):
        root = pathlib.Path(tempfile.mkdtemp(prefix='openclaw-host-reconcile-')).resolve()
        os.chmod(root, 0o700)
        disk = None
        source = None
        clones = []
        try:
            package = root / 'Owned.utm'
            data = package / 'Data'
            data.mkdir(parents=True)
            source = data / '00000000-0000-0000-0000-000000000001.img'
            run('/usr/sbin/diskutil', 'image', 'create', 'blank', '--format', 'ASIF',
                '--size', '128m', '--fs', 'APFS', '--volumeName', 'Data', str(source))
            vm_uuid = '00000000-0000-0000-0000-000000000002'
            config = package / 'config.plist'
            config.write_bytes(plistlib.dumps({
                'Backend': 'Apple', 'Information': {'Name': 'Owned', 'UUID': vm_uuid},
                'Drive': [{'ImageName': source.name, 'ReadOnly': False}],
            }))
            controller = root / 'fake-utmctl'
            controller.write_text('#!/bin/sh\necho stopped\n')
            controller.chmod(0o700)
            spec = root / 'host-spec.json'
            spec.write_text(json.dumps({
                'package': str(package), 'name': 'Owned', 'uuid': vm_uuid,
                'image_name': source.name,
                'config_sha256': hashlib.sha256(config.read_bytes()).hexdigest(),
                'utmctl': str(controller),
                'utmctl_sha256': hashlib.sha256(controller.read_bytes()).hexdigest(),
            }))
            spec.chmod(0o600)
            capture = root / 'capture'
            capture.mkdir(mode=0o700)
            first = preflight(spec, capture / 'before-shutdown')
            write_record(capture / 'ARMED.json', {
                'scope': 'waiting for external guest shutdown; no stop request issued',
                'vm_uuid': vm_uuid, 'host_boot_session': first['host_boot_session'],
                'image_device': first['image_device'],
                'image_inode': first['image_inode'],
            })
            source_identity = (first['image_device'], first['image_inode'],
                               first['image_size'])
            change_immutable(source, source_identity, True)
            with self.assertRaises(FileNotFoundError):
                reconcile(spec, capture, capture / 'without-guard-intent', fixture=True)
            self.assertTrue(source.lstat().st_flags & stat.UF_IMMUTABLE)
            change_immutable(source, source_identity, False)
            guard(spec, capture, fixture=True)
            self.assertTrue((capture / 'GUARD_INTENT.json').exists())
            self.assertTrue((capture / 'GUARD.json').exists())
            clone = capture / 'powered-off-image.asif'
            clone_only(source, clone)
            clones.append(clone)
            attached = plistlib.loads(run('/usr/sbin/diskutil', 'image', 'attach',
                                           '--plist', '--readOnly', '--noMount', str(clone)))
            disk = attached['system-entities'][0]['dev-entry']
            with self.assertRaisesRegex(RuntimeError, 'holder|attached'):
                reconcile(spec, capture, capture / 'while-attached', fixture=True)
            self.assertTrue((capture / 'while-attached' / 'OPERATOR_REQUIRED.json').exists())
            self.assertTrue(source.lstat().st_flags & stat.UF_IMMUTABLE)
            self.assertTrue(clone.exists())
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
            sibling = root / 'older-capture'
            sibling.mkdir(mode=0o700)
            other = sibling / 'powered-off-image.asif'
            clone_only(source, other)
            clones.append(other)
            with self.assertRaisesRegex(RuntimeError, 'another temporary image clone'):
                reconcile(spec, capture, capture / 'other-clone', fixture=True)
            self.assertTrue((capture / 'other-clone' / 'OPERATOR_REQUIRED.json').exists())
            self.assertFalse(clone.exists())
            self.assertTrue(source.lstat().st_flags & stat.UF_IMMUTABLE)
            info = other.lstat()
            change_immutable(other, (info.st_dev, info.st_ino, info.st_size), False)
            other.unlink()
            result = reconcile(spec, capture, capture / 'recovered', fixture=True)
            self.assertTrue(result['clone_absent'])
            self.assertTrue(result['guard_completed'])
            self.assertFalse(result['source_immutable'])
            self.assertTrue((capture / 'recovered' / 'BOOTABLE.json').exists())
            self.assertFalse(source.lstat().st_flags & stat.UF_IMMUTABLE)
            again = reconcile(spec, capture, capture / 'repeated', fixture=True)
            self.assertTrue(again['clone_absent'])
            change_immutable(source, source_identity, True)
            with self.assertRaisesRegex(RuntimeError, 'guarded again'):
                reconcile(spec, capture, capture / 'reguarded', fixture=True)
            self.assertTrue(source.lstat().st_flags & stat.UF_IMMUTABLE)
            change_immutable(source, source_identity, False)

            held = root / 'held-capture'
            held.mkdir(mode=0o700)
            held_initial = preflight(spec, held / 'before-shutdown')
            write_record(held / 'ARMED.json', {
                'scope': 'waiting for external guest shutdown; no stop request issued',
                'vm_uuid': vm_uuid, 'host_boot_session': held_initial['host_boot_session'],
                'image_device': held_initial['image_device'],
                'image_inode': held_initial['image_inode'],
            })
            writable = None

            def open_during_guard(path, identity, present):
                nonlocal writable
                writable = os.open(path, os.O_RDWR)
                return change_immutable(path, identity, present)

            try:
                with patch.object(host_vm_guard, 'change_immutable', open_during_guard):
                    with self.assertRaisesRegex(RuntimeError, 'image holders disagree'):
                        guard(spec, held, fixture=True)
                self.assertTrue((held / 'GUARD_INTENT.json').exists())
                self.assertFalse((held / 'GUARD.json').exists())
                self.assertTrue(source.lstat().st_flags & stat.UF_IMMUTABLE)
                with self.assertRaisesRegex(RuntimeError, 'image holders disagree'):
                    reconcile(spec, held, held / 'holder-present', fixture=True)
                self.assertTrue((held / 'holder-present' / 'OPERATOR_REQUIRED.json').exists())
                self.assertTrue(source.lstat().st_flags & stat.UF_IMMUTABLE)
            finally:
                if writable is not None:
                    os.close(writable)
            recovered_held = reconcile(spec, held, held / 'holder-gone', fixture=True)
            self.assertTrue(recovered_held['clone_absent'])
            self.assertFalse(recovered_held['guard_completed'])
            self.assertFalse(source.lstat().st_flags & stat.UF_IMMUTABLE)

            unexpected = root / 'unexpected-guard-receipt'
            unexpected.mkdir(mode=0o700)
            write_record(unexpected / 'GUARD.json', {'unrelated': True})
            with self.assertRaisesRegex(RuntimeError, 'guard artifact already exists'):
                guard(spec, unexpected, fixture=True)
            self.assertFalse((unexpected / 'GUARD_INTENT.json').exists())
            self.assertFalse(source.lstat().st_flags & stat.UF_IMMUTABLE)

            interrupted = root / 'interrupted-guard-receipt'
            interrupted.mkdir(mode=0o700)
            interrupted_initial = preflight(spec, interrupted / 'before-shutdown')
            write_record(interrupted / 'ARMED.json', {
                'scope': 'waiting for external guest shutdown; no stop request issued',
                'vm_uuid': vm_uuid, 'host_boot_session': interrupted_initial['host_boot_session'],
                'image_device': interrupted_initial['image_device'],
                'image_inode': interrupted_initial['image_inode'],
            })
            original_write = host_vm_guard.write_record

            def partial_receipt(path, value):
                if pathlib.Path(path).name != 'GUARD.json.tmp':
                    return original_write(path, value)
                self.assertFalse((interrupted / 'GUARD.json').exists())
                pathlib.Path(path).write_text('{"partial":')
                raise OSError('interrupted guard receipt write')

            with patch.object(host_vm_guard, 'write_record', partial_receipt):
                with self.assertRaisesRegex(OSError, 'interrupted guard receipt write'):
                    guard(spec, interrupted, fixture=True)
            self.assertTrue(source.lstat().st_flags & stat.UF_IMMUTABLE)
            self.assertTrue((interrupted / 'GUARD.json.tmp').exists())
            self.assertFalse((interrupted / 'GUARD.json').exists())
            original_reconcile_write = host_vm_reconcile.write_record

            def partial_bootable(path, value):
                if pathlib.Path(path).name != 'BOOTABLE.json.tmp':
                    return original_reconcile_write(path, value)
                self.assertFalse((pathlib.Path(path).parent / 'BOOTABLE.json').exists())
                pathlib.Path(path).write_text('{"partial":')
                raise OSError('interrupted bootable receipt write')

            with patch.object(host_vm_reconcile, 'write_record', partial_bootable):
                with self.assertRaisesRegex(OSError, 'interrupted bootable receipt write'):
                    reconcile(spec, interrupted, interrupted / 'partial-bootable', fixture=True)
            self.assertTrue((interrupted / 'partial-bootable' / 'BOOTABLE.json.tmp').exists())
            self.assertFalse((interrupted / 'partial-bootable' / 'BOOTABLE.json').exists())
            self.assertTrue((interrupted / 'partial-bootable' / 'OPERATOR_REQUIRED.json').exists())
            self.assertFalse(source.lstat().st_flags & stat.UF_IMMUTABLE)
            interrupted_recovery = reconcile(spec, interrupted,
                                             interrupted / 'recovered', fixture=True)
            self.assertFalse(interrupted_recovery['guard_completed'])
            self.assertFalse(source.lstat().st_flags & stat.UF_IMMUTABLE)

            completed = root / 'completed-capture'
            completed.mkdir(mode=0o700)
            completed_initial = preflight(spec, completed / 'before-shutdown')
            write_record(completed / 'ARMED.json', {
                'scope': 'waiting for external guest shutdown; no stop request issued',
                'vm_uuid': vm_uuid, 'host_boot_session': completed_initial['host_boot_session'],
                'image_device': completed_initial['image_device'],
                'image_inode': completed_initial['image_inode'],
            })
            write_record(completed / 'GUARD_INTENT.json', {
                'scope': GUARD_SCOPE, 'vm_uuid': vm_uuid,
                'host_boot_session': completed_initial['host_boot_session'],
                'source_image': str(source),
                'source_image_device': source_identity[0],
                'source_image_inode': source_identity[1],
                'source_image_size': source_identity[2],
            })
            source_hash = file_hash(source)
            write_record(completed / 'CAPTURE.json', {
                'scope': CAPTURE_SCOPE, 'vm_uuid': vm_uuid,
                'host_boot_session': completed_initial['host_boot_session'],
                'source_size': source_identity[2], 'source_image_sha256': source_hash,
            })
            writable = os.open(source, os.O_RDWR)
            try:
                old_tail = os.pread(writable, 1, source_identity[2] - 1)
                change_immutable(source, source_identity, True)
                completed_clone = completed / 'powered-off-image.asif'
                clone_only(source, completed_clone)
                clones.append(completed_clone)
                os.pwrite(writable, b'Z', source_identity[2] - 1)
            finally:
                os.close(writable)
            with self.assertRaisesRegex(RuntimeError, 'source image changed'):
                reconcile(spec, completed, completed / 'changed-source', fixture=True)
            self.assertTrue(completed_clone.exists())
            self.assertTrue(source.lstat().st_flags & stat.UF_IMMUTABLE)
            change_immutable(source, source_identity, False)
            with open(source, 'r+b') as repaired:
                repaired.seek(-1, os.SEEK_END)
                repaired.write(old_tail)
            change_immutable(source, source_identity, True)
            recovered_capture = reconcile(spec, completed, completed / 'repaired-source',
                                          fixture=True)
            self.assertTrue(recovered_capture['capture_completed'])
            self.assertFalse(completed_clone.exists())
            self.assertFalse(source.lstat().st_flags & stat.UF_IMMUTABLE)
        finally:
            if disk:
                run('/usr/sbin/diskutil', 'eject', disk)
            for path in clones + ([source] if source else []):
                if path.exists() and path.lstat().st_flags & stat.UF_IMMUTABLE:
                    os.chflags(path, path.lstat().st_flags & ~stat.UF_IMMUTABLE)
            shutil.rmtree(root)


if __name__ == '__main__':
    unittest.main()
