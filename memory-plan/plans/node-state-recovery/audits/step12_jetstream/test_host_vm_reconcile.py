#!/usr/bin/env python3
import contextlib
import hashlib
import fcntl
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


def inactive_capture_lock(capture_dir):
    fd = os.open(capture_dir / 'CAPTURE_ACTIVE.lock', os.O_RDWR | os.O_CREAT | os.O_EXCL, 0o600)
    os.close(fd)


@contextlib.contextmanager
def active_capture_lock(capture_dir):
    fd = os.open(capture_dir / 'CAPTURE_ACTIVE.lock', os.O_RDWR)
    try:
        fcntl.flock(fd, fcntl.LOCK_EX)
        yield
    finally:
        os.close(fd)


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
            inactive_capture_lock(capture)
            source_identity = (first['image_device'], first['image_inode'],
                               first['image_size'])
            change_immutable(source, source_identity, True)
            with self.assertRaises(FileNotFoundError):
                reconcile(spec, capture, capture / 'without-guard-intent', fixture=True)
            self.assertTrue(source.lstat().st_flags & stat.UF_IMMUTABLE)
            change_immutable(source, source_identity, False)
            with self.assertRaisesRegex(RuntimeError, 'capture worker is not active'):
                guard(spec, capture, fixture=True)
            self.assertFalse((capture / 'GUARD_INTENT.json').exists())
            self.assertFalse(list(capture.glob('before-guard-*')))
            self.assertFalse(source.lstat().st_flags & stat.UF_IMMUTABLE)

            died_during_preflight = root / 'died-during-preflight'
            died_during_preflight.mkdir(mode=0o700)
            died_initial = preflight(spec, died_during_preflight / 'before-shutdown')
            write_record(died_during_preflight / 'ARMED.json', {
                'scope': 'waiting for external guest shutdown; no stop request issued',
                'vm_uuid': vm_uuid, 'host_boot_session': died_initial['host_boot_session'],
                'image_device': died_initial['image_device'],
                'image_inode': died_initial['image_inode'],
            })
            inactive_capture_lock(died_during_preflight)
            dying_fd = os.open(died_during_preflight / 'CAPTURE_ACTIVE.lock', os.O_RDWR)
            fcntl.flock(dying_fd, fcntl.LOCK_EX)
            original_preflight = host_vm_guard.preflight

            def worker_died_after_preflight(*args, **kwargs):
                nonlocal dying_fd
                observed = original_preflight(*args, **kwargs)
                if dying_fd is not None:
                    os.close(dying_fd)
                    dying_fd = None
                return observed

            try:
                with patch.object(host_vm_guard, 'preflight', worker_died_after_preflight):
                    with self.assertRaisesRegex(RuntimeError, 'capture worker is not active'):
                        guard(spec, died_during_preflight, fixture=True)
            finally:
                if dying_fd is not None:
                    os.close(dying_fd)
            self.assertIsNone(dying_fd)
            self.assertFalse((died_during_preflight / 'GUARD_INTENT.json').exists())
            self.assertFalse(source.lstat().st_flags & stat.UF_IMMUTABLE)
            original_write = host_vm_guard.write_record
            def partial_intent(path, value):
                if not pathlib.Path(path).name.startswith('GUARD_INTENT.json.tmp.'):
                    return original_write(path, value)
                pathlib.Path(path).write_text('{"partial":')
                raise OSError('interrupted guard intent write')
            with active_capture_lock(capture):
                with patch.object(host_vm_guard, 'write_record', partial_intent):
                    with self.assertRaisesRegex(OSError, 'interrupted guard intent write'):
                        guard(spec, capture, fixture=True)
                self.assertFalse((capture / 'GUARD_INTENT.json').exists())
                self.assertFalse(source.lstat().st_flags & stat.UF_IMMUTABLE)
                guard(spec, capture, fixture=True)
            self.assertTrue((capture / 'GUARD_INTENT.json').exists())
            self.assertTrue((capture / 'GUARD.json').exists())
            active_fd = os.open(capture / 'CAPTURE_ACTIVE.lock', os.O_RDWR)
            try:
                fcntl.flock(active_fd, fcntl.LOCK_EX)
                with self.assertRaisesRegex(RuntimeError, 'capture worker is still active'):
                    reconcile(spec, capture, capture / 'capture-active', fixture=True)
                self.assertTrue((capture / 'capture-active' / 'OPERATOR_REQUIRED.json').exists())
                self.assertTrue(source.lstat().st_flags & stat.UF_IMMUTABLE)
            finally:
                os.close(active_fd)
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
            orphan = plistlib.loads(run('/usr/sbin/diskutil', 'image', 'attach',
                                         '--plist', '--readOnly', '--noMount', str(clone)))
            disk = orphan['system-entities'][0]['dev-entry']
            clone_info = clone.lstat()
            change_immutable(clone, (clone_info.st_dev, clone_info.st_ino, clone_info.st_size), False)
            clone.unlink()
            with self.assertRaisesRegex(RuntimeError, 'attached'):
                reconcile(spec, capture, capture / 'orphan-attachment', fixture=True)
            self.assertTrue((capture / 'orphan-attachment' / 'OPERATOR_REQUIRED.json').exists())
            self.assertTrue(source.lstat().st_flags & stat.UF_IMMUTABLE)
            for attempt in range(20):
                result = subprocess.run(['/usr/sbin/diskutil', 'eject', disk],
                                        capture_output=True)
                if result.returncode == 0:
                    break
                if b'Volume failed to eject' not in result.stderr:
                    raise AssertionError(result.stderr.decode(errors='replace')[:500])
                time.sleep(0.25)
            else:
                raise AssertionError('orphan image did not eject')
            disk = None
            attached_source = plistlib.loads(run('/usr/sbin/diskutil', 'image', 'attach',
                                                  '--plist', '--readOnly', '--noMount', str(source)))
            disk = attached_source['system-entities'][0]['dev-entry']
            with self.assertRaisesRegex(RuntimeError, 'image remains attached'):
                reconcile(spec, capture, capture / 'source-attached', fixture=True)
            self.assertTrue((capture / 'source-attached' / 'OPERATOR_REQUIRED.json').exists())
            self.assertTrue(source.lstat().st_flags & stat.UF_IMMUTABLE)
            for attempt in range(20):
                result = subprocess.run(['/usr/sbin/diskutil', 'eject', disk],
                                        capture_output=True)
                if result.returncode == 0:
                    break
                if b'Volume failed to eject' not in result.stderr:
                    raise AssertionError(result.stderr.decode(errors='replace')[:500])
                time.sleep(0.25)
            else:
                raise AssertionError('source image did not eject')
            disk = None
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
            write_record(sibling / 'CAPTURE.json', {'scope': CAPTURE_SCOPE})
            with self.assertRaisesRegex(RuntimeError, 'completed capture'):
                reconcile(spec, capture, capture / 'other-completed-capture', fixture=True)
            self.assertTrue((capture / 'other-completed-capture' /
                             'OPERATOR_REQUIRED.json').exists())
            self.assertTrue(source.lstat().st_flags & stat.UF_IMMUTABLE)
            (sibling / 'CAPTURE.json').unlink()
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
            inactive_capture_lock(held)
            writable = None

            def open_during_guard(path, identity, present):
                nonlocal writable
                writable = os.open(path, os.O_RDWR)
                return change_immutable(path, identity, present)

            try:
                with active_capture_lock(held):
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

            serialized = root / 'serialized-guard'
            serialized.mkdir(mode=0o700)
            serialized_initial = preflight(spec, serialized / 'before-shutdown')
            write_record(serialized / 'ARMED.json', {
                'scope': 'waiting for external guest shutdown; no stop request issued',
                'vm_uuid': vm_uuid, 'host_boot_session': serialized_initial['host_boot_session'],
                'image_device': serialized_initial['image_device'],
                'image_inode': serialized_initial['image_inode'],
            })
            inactive_capture_lock(serialized)
            entered, release = threading.Event(), threading.Event()
            reconcile_ready, reconcile_preflight = threading.Event(), threading.Event()
            errors = []
            result = {}
            original_change = host_vm_guard.change_immutable
            original_fsync = host_vm_reconcile.fsync_parent
            original_reconcile_preflight = host_vm_reconcile.preflight

            def paused_change(path, identity, present):
                entered.set()
                if not release.wait(10):
                    raise RuntimeError('guard fixture was not released')
                return original_change(path, identity, present)

            def observed_fsync(path):
                value = original_fsync(path)
                if path == serialized:
                    reconcile_ready.set()
                return value

            def observed_preflight(*args, **kwargs):
                reconcile_preflight.set()
                return original_reconcile_preflight(*args, **kwargs)

            def guard_worker():
                try:
                    with patch.object(host_vm_guard, 'change_immutable', paused_change):
                        guard(spec, serialized, fixture=True)
                except Exception as error:
                    errors.append(error)

            def reconcile_worker():
                try:
                    with patch.object(host_vm_reconcile, 'fsync_parent', observed_fsync), \
                            patch.object(host_vm_reconcile, 'preflight', observed_preflight):
                        result.update(reconcile(spec, serialized, serialized / 'concurrent', fixture=True))
                except Exception as error:
                    errors.append(error)

            first_worker = threading.Thread(target=guard_worker)
            second_worker = threading.Thread(target=reconcile_worker)
            capture_fd = os.open(serialized / 'CAPTURE_ACTIVE.lock', os.O_RDWR)
            fcntl.flock(capture_fd, fcntl.LOCK_EX)
            first_worker.start()
            try:
                self.assertTrue(entered.wait(10))
                self.assertTrue((serialized / 'GUARD_INTENT.json').exists())
                os.close(capture_fd)
                capture_fd = None
                second_worker.start()
                self.assertTrue(reconcile_ready.wait(10))
                self.assertFalse(reconcile_preflight.wait(1))
                self.assertFalse((serialized / 'concurrent' / 'BOOTABLE.json').exists())
                self.assertTrue(second_worker.is_alive())
            finally:
                if capture_fd is not None:
                    os.close(capture_fd)
                release.set()
                first_worker.join(timeout=10)
                if second_worker.ident is not None:
                    second_worker.join(timeout=10)
            self.assertFalse(errors, errors)
            self.assertFalse(first_worker.is_alive())
            self.assertFalse(second_worker.is_alive())
            self.assertTrue(result['guard_completed'])
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
            inactive_capture_lock(interrupted)
            original_write = host_vm_guard.write_record

            def partial_receipt(path, value):
                if pathlib.Path(path).name != 'GUARD.json.tmp':
                    return original_write(path, value)
                self.assertFalse((interrupted / 'GUARD.json').exists())
                pathlib.Path(path).write_text('{"partial":')
                raise OSError('interrupted guard receipt write')

            with active_capture_lock(interrupted):
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

            partial_capture = root / 'partial-capture-receipt'
            partial_capture.mkdir(mode=0o700)
            partial_initial = preflight(spec, partial_capture / 'before-shutdown')
            write_record(partial_capture / 'ARMED.json', {
                'scope': 'waiting for external guest shutdown; no stop request issued',
                'vm_uuid': vm_uuid, 'host_boot_session': partial_initial['host_boot_session'],
                'image_device': partial_initial['image_device'],
                'image_inode': partial_initial['image_inode'],
            })
            inactive_capture_lock(partial_capture)
            write_record(partial_capture / 'GUARD_INTENT.json', {
                'scope': GUARD_SCOPE, 'vm_uuid': vm_uuid,
                'host_boot_session': partial_initial['host_boot_session'],
                'source_image': str(source),
                'source_image_device': source_identity[0],
                'source_image_inode': source_identity[1],
                'source_image_size': source_identity[2],
            })
            change_immutable(source, source_identity, True)
            partial_clone = partial_capture / 'powered-off-image.asif'
            clone_only(source, partial_clone)
            clones.append(partial_clone)
            (partial_capture / 'CAPTURE.json.tmp').write_text('{"partial":')
            partial_recovery = reconcile(spec, partial_capture,
                                         partial_capture / 'recovered', fixture=True)
            self.assertFalse(partial_recovery['capture_completed'])
            self.assertFalse(partial_clone.exists())
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
            inactive_capture_lock(completed)
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
            with self.assertRaisesRegex(RuntimeError, 'requires verified acceptance or abort'):
                reconcile(spec, completed, completed / 'repaired-source', fixture=True)
            self.assertTrue((completed / 'repaired-source' / 'OPERATOR_REQUIRED.json').exists())
            self.assertFalse((completed / 'repaired-source' / 'BOOTABLE.json').exists())
            self.assertTrue(completed_clone.exists())
            self.assertTrue(source.lstat().st_flags & stat.UF_IMMUTABLE)
            write_record(completed / 'FAILED.json', {'error': 'post-publication failure'})
            with self.assertRaisesRegex(RuntimeError, 'requires verified acceptance or abort'):
                reconcile(spec, completed, completed / 'capture-and-failure', fixture=True)
            self.assertTrue(completed_clone.exists())
            self.assertTrue(source.lstat().st_flags & stat.UF_IMMUTABLE)
            clone_info = completed_clone.lstat()
            change_immutable(completed_clone,
                             (clone_info.st_dev, clone_info.st_ino, clone_info.st_size), False)
            completed_clone.unlink()
            with self.assertRaisesRegex(RuntimeError, 'requires verified acceptance or abort'):
                reconcile(spec, completed, completed / 'missing-clone', fixture=True)
            self.assertFalse((completed / 'missing-clone' / 'BOOTABLE.json').exists())
            self.assertTrue(source.lstat().st_flags & stat.UF_IMMUTABLE)
        finally:
            if disk:
                run('/usr/sbin/diskutil', 'eject', disk)
            for path in clones + ([source] if source else []):
                if path.exists() and path.lstat().st_flags & stat.UF_IMMUTABLE:
                    os.chflags(path, path.lstat().st_flags & ~stat.UF_IMMUTABLE)
            shutil.rmtree(root)


if __name__ == '__main__':
    unittest.main()
