#!/usr/bin/env python3
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
from unittest import mock

import host_vm_capture
from stopped_tree_match import guest_capture, host_match
from host_clone_dispose import cleanup_failed, dispose
from host_vm_capture import capture, clone_only, publish_capture_record
from host_vm_guard import guard
from host_image_immutable import change_immutable
from host_vm_preflight import preflight, vmstate_identity, write_record
from host_vm_reconcile import reconcile


HERE = pathlib.Path(__file__).resolve().parent
CAPTURE = HERE / 'host_vm_capture.py'


def run(*args):
    result = subprocess.run(args, capture_output=True)
    if result.returncode:
        raise AssertionError((args, result.stderr.decode(errors='replace')[:500]))
    return result.stdout


class VmstateGateTest(unittest.TestCase):
    def test_production_capture_requires_decision_controller_before_output_creation(self):
        with tempfile.TemporaryDirectory(prefix='openclaw-host-capture-entry-') as temporary:
            root = pathlib.Path(temporary).resolve()
            durable = root / 'Library/Application Support/OpenClawRecovery'
            durable.mkdir(parents=True, mode=0o700)
            durable.chmod(0o700)
            host = root / 'host.json'
            host.write_text(json.dumps({
                'package': str(root / 'Owned.utm'), 'name': 'Owned',
                'uuid': '00000000-0000-0000-0000-000000000002',
                'image_name': 'image.asif', 'config_sha256': '0' * 64,
                'utmctl': '/tmp/unused', 'utmctl_sha256': '0' * 64,
            }))
            host.chmod(0o600)
            stores = root / 'stores.json'
            stores.write_text(json.dumps({'data_volume_uuid': '0' * 36, 'stores': []}))
            stores.chmod(0o600)
            output = durable / 'capture'
            with mock.patch.object(pathlib.Path, 'home', return_value=root):
                with self.assertRaisesRegex(RuntimeError, 'requires a verified acceptance or abort'):
                    capture(host, stores, output, 5)
            self.assertFalse(output.exists())

    def test_reconcile_refuses_capture_paused_before_clone(self):
        with tempfile.TemporaryDirectory(prefix='openclaw-host-capture-active-') as temporary:
            root = pathlib.Path(temporary).resolve()
            root.chmod(0o700)
            host_spec = root / 'host.json'
            host_spec.write_text(json.dumps({
                'package': str(root / 'Owned.utm'), 'name': 'Owned',
                'uuid': '00000000-0000-0000-0000-000000000002',
                'image_name': '00000000-0000-0000-0000-000000000001.img',
                'config_sha256': '0' * 64, 'utmctl': '/tmp/unused',
                'utmctl_sha256': '0' * 64,
            }))
            host_spec.chmod(0o600)
            store_spec = root / 'stores.json'
            store_spec.write_text(json.dumps({
                'data_volume_uuid': '00000000-0000-0000-0000-000000000003',
                'stores': [{'role': role, 'relative_path': role}
                           for role in ('standalone', 'member1', 'member2', 'member3')],
            }))
            store_spec.chmod(0o600)
            output = root / 'capture'
            source = root / 'source.asif'
            source.write_bytes(b'fixture')
            first = {'state': 'started', 'host_boot_session': 'boot',
                     'image_device': 1, 'image_inode': 2, 'image_size': 3,
                     'image': str(source), 'vm_uuid': '00000000-0000-0000-0000-000000000002',
                     'holders_consistent': True, 'vmstate': None}
            stopped = dict(first, state='stopped')
            observations = 0
            entered, release = threading.Event(), threading.Event()
            errors = []

            def observed_preflight(*args, **kwargs):
                nonlocal observations
                observations += 1
                if observations == 1:
                    write_record(output / 'GUARD.json', {'fixture': True})
                    return first
                return stopped

            def paused_clone(*args):
                entered.set()
                if not release.wait(5):
                    raise RuntimeError('clone fixture was not released')
                raise RuntimeError('clone fixture stopped')

            def worker():
                try:
                    capture(host_spec, store_spec, output, 5, fixture=True)
                except Exception as error:
                    errors.append(error)

            with mock.patch.object(host_vm_capture, 'preflight', observed_preflight), \
                    mock.patch.object(host_vm_capture, 'guarded_source', return_value='guard-hash'), \
                    mock.patch.object(host_vm_capture, 'clone_only', paused_clone), \
                    mock.patch.object(host_vm_capture.shutil, 'disk_usage',
                                      return_value=mock.Mock(free=30 * 1024 ** 3)):
                thread = threading.Thread(target=worker)
                thread.start()
                try:
                    self.assertTrue(entered.wait(5))
                    with self.assertRaisesRegex(RuntimeError, 'capture worker is still active'):
                        reconcile(host_spec, output, output / 'reconcile-while-cloning',
                                  fixture=True)
                    self.assertTrue((output / 'reconcile-while-cloning' /
                                     'OPERATOR_REQUIRED.json').exists())
                    self.assertFalse((output / 'reconcile-while-cloning' / 'BOOTABLE.json').exists())
                finally:
                    release.set()
                    thread.join(timeout=5)
            self.assertFalse(thread.is_alive())
            self.assertEqual(str(errors[0]), 'clone fixture stopped')
            self.assertTrue((output / 'FAILED.json').exists())

    def test_terminal_failure_waits_for_guard_receipt_lock(self):
        with tempfile.TemporaryDirectory(prefix='openclaw-terminal-lock-') as temporary:
            root = pathlib.Path(temporary).resolve()
            root.chmod(0o700)
            host_spec = root / 'host.json'
            host_spec.write_text(json.dumps({
                'package': str(root / 'Owned.utm'), 'name': 'Owned',
                'uuid': '00000000-0000-0000-0000-000000000002',
                'image_name': '00000000-0000-0000-0000-000000000001.img',
                'config_sha256': '0' * 64, 'utmctl': '/tmp/unused',
                'utmctl_sha256': '0' * 64,
            }))
            host_spec.chmod(0o600)
            store_spec = root / 'stores.json'
            store_spec.write_text(json.dumps({
                'data_volume_uuid': '00000000-0000-0000-0000-000000000003',
                'stores': [{'role': role, 'relative_path': role}
                           for role in ('standalone', 'member1', 'member2', 'member3')],
            }))
            store_spec.chmod(0o600)
            output = root / 'capture'
            before = {'state': 'started', 'host_boot_session': 'boot',
                      'image_device': 1, 'image_inode': 2, 'image_size': 3,
                      'vmstate': None}
            entered, release, failure_write = threading.Event(), threading.Event(), threading.Event()
            errors = []
            original_write = host_vm_capture.write_record

            def observed_preflight(*args, **kwargs):
                if not entered.is_set():
                    return before
                raise RuntimeError('terminal fixture failure')

            def observed_write(path, value):
                if pathlib.Path(path).name == 'ARMED.json':
                    original_write(path, value)
                    entered.set()
                    if not release.wait(5):
                        raise RuntimeError('terminal fixture was not released')
                    return
                if pathlib.Path(path).name == 'FAILED.json':
                    failure_write.set()
                return original_write(path, value)

            def worker():
                try:
                    capture(host_spec, store_spec, output, 1, fixture=True)
                except Exception as error:
                    errors.append(error)

            with mock.patch.object(host_vm_capture, 'preflight', observed_preflight), \
                    mock.patch.object(host_vm_capture, 'write_record', observed_write):
                thread = threading.Thread(target=worker)
                thread.start()
                self.assertTrue(entered.wait(5))
                with (output / 'ARMED.json').open('rb') as armed:
                    fcntl.flock(armed, fcntl.LOCK_EX)
                    release.set()
                    self.assertFalse(failure_write.wait(0.2))
                    self.assertFalse((output / 'FAILED.json').exists())
                thread.join(timeout=5)
            self.assertFalse(thread.is_alive())
            self.assertEqual(str(errors[0]), 'terminal fixture failure')
            self.assertTrue(failure_write.is_set())
            self.assertTrue((output / 'FAILED.json').exists())

    def test_partial_capture_receipt_is_never_published(self):
        with tempfile.TemporaryDirectory(prefix='openclaw-capture-receipt-') as temporary:
            root = pathlib.Path(temporary)
            output = root / 'capture'
            output.mkdir()
            def partial_write(path, value):
                self.assertEqual(path.name, 'CAPTURE.json.tmp')
                self.assertFalse((output / 'CAPTURE.json').exists())
                path.write_text('{"partial":')
                raise OSError('interrupted capture receipt write')

            with mock.patch.object(host_vm_capture, 'write_record', partial_write):
                with self.assertRaisesRegex(OSError, 'interrupted capture receipt write'):
                    publish_capture_record(output, {'verified': True})
            self.assertFalse((output / 'CAPTURE.json').exists())
            self.assertEqual((output / 'CAPTURE.json.tmp').read_text(), '{"partial":')
            (output / 'CAPTURE.json.tmp').unlink()
            publish_capture_record(output, {'verified': True})
            self.assertEqual(json.loads((output / 'CAPTURE.json').read_text()),
                             {'verified': True})

    def test_vmstate_change_refuses_before_clone(self):
        with tempfile.TemporaryDirectory(prefix='openclaw-vmstate-gate-') as temporary:
            root = pathlib.Path(temporary).resolve()
            root.chmod(0o700)
            host_spec = root / 'host.json'
            host_spec.write_text(json.dumps({
                'package': str(root / 'Owned.utm'), 'name': 'Owned',
                'uuid': '00000000-0000-0000-0000-000000000002',
                'image_name': '00000000-0000-0000-0000-000000000001.img',
                'config_sha256': '0' * 64, 'utmctl': '/tmp/unused',
                'utmctl_sha256': '0' * 64,
            }))
            host_spec.chmod(0o600)
            store_spec = root / 'stores.json'
            store_spec.write_text(json.dumps({
                'data_volume_uuid': '00000000-0000-0000-0000-000000000003',
                'stores': [{'role': role, 'relative_path': role}
                           for role in ('standalone', 'member1', 'member2', 'member3')],
            }))
            store_spec.chmod(0o600)
            before = {'state': 'started', 'host_boot_session': 'boot',
                      'image_device': 1, 'image_inode': 2, 'image_size': 3,
                      'vmstate': {'device': 1, 'inode': 4, 'size': 5, 'mtime_ns': 6}}
            stopped = dict(before, state='stopped', holders_consistent=True,
                           vmstate=dict(before['vmstate'], mtime_ns=7))
            output = root / 'capture'
            with mock.patch('host_vm_capture.preflight', side_effect=[before, stopped]):
                with self.assertRaisesRegex(RuntimeError, 'identity changed'):
                    capture(host_spec, store_spec, output, 1, fixture=True)
            self.assertTrue((output / 'FAILED.json').exists())
            self.assertFalse((output / 'CAPTURE.json').exists())
            self.assertFalse((output / 'powered-off-image.asif').exists())

    def test_stopped_vm_without_guard_refuses_before_clone(self):
        with tempfile.TemporaryDirectory(prefix='openclaw-vmstate-gate-') as temporary:
            root = pathlib.Path(temporary).resolve()
            root.chmod(0o700)
            host_spec = root / 'host.json'
            host_spec.write_text(json.dumps({
                'package': str(root / 'Owned.utm'), 'name': 'Owned',
                'uuid': '00000000-0000-0000-0000-000000000002',
                'image_name': '00000000-0000-0000-0000-000000000001.img',
                'config_sha256': '0' * 64, 'utmctl': '/tmp/unused',
                'utmctl_sha256': '0' * 64,
            }))
            host_spec.chmod(0o600)
            store_spec = root / 'stores.json'
            store_spec.write_text(json.dumps({
                'data_volume_uuid': '00000000-0000-0000-0000-000000000003',
                'stores': [{'role': role, 'relative_path': role}
                           for role in ('standalone', 'member1', 'member2', 'member3')],
            }))
            store_spec.chmod(0o600)
            before = {'state': 'started', 'host_boot_session': 'boot',
                      'image_device': 1, 'image_inode': 2, 'image_size': 3,
                      'vmstate': None}
            stopped = dict(before, state='stopped', holders_consistent=True)
            output = root / 'capture'
            with mock.patch('host_vm_capture.preflight', side_effect=[before, stopped]), \
                    mock.patch('host_vm_capture.clone_only') as clone:
                with self.assertRaisesRegex(RuntimeError, 'completed image guard'):
                    capture(host_spec, store_spec, output, 1, fixture=True)
            clone.assert_not_called()
            self.assertTrue((output / 'FAILED.json').exists())
            self.assertFalse((output / 'CAPTURE.json').exists())

    def test_vmstate_identity_refuses_link(self):
        with tempfile.TemporaryDirectory(prefix='openclaw-vmstate-path-') as temporary:
            root = pathlib.Path(temporary)
            source = root / 'source'
            source.write_bytes(b'stale')
            self.assertEqual(vmstate_identity(root / 'missing'), None)
            self.assertEqual(vmstate_identity(source)['size'], 5)
            self.assertIn('ctime_ns', vmstate_identity(source))
            (root / 'vmstate').symlink_to(source)
            with self.assertRaisesRegex(RuntimeError, 'regular file'):
                vmstate_identity(root / 'vmstate')


@unittest.skipUnless(sys.platform == 'darwin', 'requires macOS ASIF and GUI launchd')
class HostCaptureTest(unittest.TestCase):
    def setUp(self):
        self.root = pathlib.Path(tempfile.mkdtemp(prefix='openclaw-host-capture-')).resolve()
        os.chmod(self.root, 0o700)
        self.disks = []
        self.processes = []

    def tearDown(self):
        for process in self.processes:
            if process.poll() is None:
                process.terminate()
                process.wait(timeout=5)
        while self.disks:
            self.eject()
        for directory, dirs, files in os.walk(self.root):
            for name in dirs:
                os.chmod(pathlib.Path(directory) / name, 0o700)
            for name in files:
                path = pathlib.Path(directory) / name
                os.chflags(path, 0)
                os.chmod(path, 0o600)
        shutil.rmtree(self.root)

    def eject(self):
        disk = self.disks[-1]
        for _ in range(20):
            result = subprocess.run(['/usr/sbin/diskutil', 'eject', disk], capture_output=True)
            if result.returncode == 0:
                self.disks.pop()
                return
            if b'Volume failed to eject' not in result.stderr:
                raise AssertionError(result.stderr.decode(errors='replace')[:500])
            time.sleep(0.25)
        raise AssertionError(f'disposable image did not eject: {disk}')

    def test_external_stop_then_cold_extract(self):
        package = self.root / 'Owned.utm'
        data = package / 'Data'
        data.mkdir(parents=True)
        (data / 'vmstate').write_bytes(b'old suspend state')
        source = data / '00000000-0000-0000-0000-000000000001.img'
        run('/usr/sbin/diskutil', 'image', 'create', 'blank', '--format', 'ASIF',
            '--size', '128m', '--fs', 'APFS', '--volumeName', 'Data', str(source))
        attached = plistlib.loads(run('/usr/sbin/diskutil', 'image', 'attach', '--plist', str(source)))
        entities = attached['system-entities']
        self.disks.append(entities[0]['dev-entry'])
        volume = next(row for row in entities if row.get('volume-name') == 'Data')
        volume_info = plistlib.loads(run('/usr/sbin/diskutil', 'info', '-plist', volume['dev-entry']))
        mount = pathlib.Path(volume['mount-point'])
        stores = []
        for role in ('standalone', 'member1', 'member2', 'member3'):
            relative = 'Users/moltymac/.openclaw/nats/' + role
            location = mount / relative
            location.mkdir(parents=True)
            (location / 'stream.dat').write_text('owned-' + role)
            stores.append({'role': role, 'relative_path': relative})
        store_spec = self.root / 'store-spec.json'
        store_spec.write_text(json.dumps({'data_volume_uuid': volume_info['VolumeUUID'],
                                          'stores': stores}))
        store_spec.chmod(0o600)
        guest_output = self.root / 'guest-stopped'
        guest_capture(store_spec, guest_output, mount)
        swapped_spec = json.loads(store_spec.read_text())
        swapped_spec['stores'][1]['relative_path'], swapped_spec['stores'][2]['relative_path'] = (
            swapped_spec['stores'][2]['relative_path'], swapped_spec['stores'][1]['relative_path'])
        swapped_spec_path = self.root / 'swapped-store-spec.json'
        write_record(swapped_spec_path, swapped_spec)
        swapped_guest = self.root / 'swapped-guest-stopped'
        guest_capture(swapped_spec_path, swapped_guest, mount)
        self.eject()
        vm_uuid = '00000000-0000-0000-0000-000000000002'
        config = package / 'config.plist'
        config.write_bytes(plistlib.dumps({
            'Backend': 'Apple', 'Information': {'Name': 'Owned', 'UUID': vm_uuid},
            'Drive': [{'ImageName': source.name, 'ReadOnly': False}],
        }))
        state = self.root / 'state.txt'
        state.write_text('started\n')
        controller = self.root / 'fake-utmctl'
        controller.write_text('#!/bin/sh\n/bin/cat ' + str(state) + '\n')
        controller.chmod(0o700)
        spec = self.root / 'host-spec.json'
        spec.write_text(json.dumps({
            'package': str(package), 'name': 'Owned', 'uuid': vm_uuid,
            'image_name': source.name,
            'config_sha256': hashlib.sha256(config.read_bytes()).hexdigest(),
            'utmctl': str(controller),
            'utmctl_sha256': hashlib.sha256(controller.read_bytes()).hexdigest(),
        }))
        spec.chmod(0o600)
        attached_source = plistlib.loads(run('/usr/sbin/diskutil', 'image', 'attach',
                                              '--plist', '--noMount', str(source)))
        self.disks.append(attached_source['system-entities'][0]['dev-entry'])
        with self.assertRaisesRegex(RuntimeError, 'image remains attached'):
            preflight(spec, self.root / 'source-attached')
        self.assertTrue((self.root / 'source-attached' / 'FAILED.json').exists())
        self.eject()
        unsafe = self.root / 'unsafe-production-path'
        refused_path = subprocess.run([sys.executable, str(CAPTURE), str(spec),
                                       str(store_spec), str(unsafe), '1'], capture_output=True)
        self.assertNotEqual(refused_path.returncode, 0)
        self.assertFalse(unsafe.exists())
        holder = subprocess.Popen([sys.executable, '-c',
                                   'import sys,time; f=open(sys.argv[1],"rb"); time.sleep(30)',
                                   str(source)], stdout=subprocess.DEVNULL,
                                  stderr=subprocess.DEVNULL)
        self.processes.append(holder)
        time.sleep(0.2)
        output = self.root / 'capture'
        worker = subprocess.Popen([sys.executable, str(CAPTURE), str(spec), str(store_spec),
                                   str(output), '20', '--fixture'], stdout=subprocess.DEVNULL,
                                  stderr=subprocess.PIPE)
        self.processes.append(worker)
        deadline = time.monotonic() + 15
        while not (output / 'ARMED.json').exists() and time.monotonic() < deadline:
            if worker.poll() is not None:
                raise AssertionError(worker.stderr.read().decode())
            time.sleep(0.1)
        self.assertTrue((output / 'ARMED.json').exists())
        with (output / 'CAPTURE_ACTIVE.lock').open('rb') as active:
            with self.assertRaises(BlockingIOError):
                fcntl.flock(active, fcntl.LOCK_EX | fcntl.LOCK_NB)
        holder.terminate()
        holder.wait(timeout=5)
        with self.assertRaisesRegex(RuntimeError, 'holder|disagree'):
            guard(spec, output, fixture=True)
        self.assertFalse((output / 'GUARD_INTENT.json').exists())
        self.assertFalse(source.lstat().st_flags & stat.UF_IMMUTABLE)
        state.write_text('stopped\n')
        guard(spec, output, fixture=True)
        _, stderr = worker.communicate(timeout=30)
        self.assertEqual(worker.returncode, 0, stderr.decode())
        with (output / 'CAPTURE_ACTIVE.lock').open('rb') as active:
            fcntl.flock(active, fcntl.LOCK_EX | fcntl.LOCK_NB)
        result = json.loads((output / 'CAPTURE.json').read_text())
        self.assertEqual(result['vm_state_at_final_check'], 'stopped')
        self.assertNotEqual(result['scope'],
                            'sampled stopped-state image extraction; uninterrupted power-off, '
                            'clean shutdown and master acceptance external')
        self.assertEqual(result['vmstate_at_arm'], result['vmstate_at_final_check'])
        self.assertEqual(result['guard_receipt_sha256'],
                         hashlib.sha256((output / 'GUARD.json').read_bytes()).hexdigest())
        self.assertEqual(result['store_spec_sha256'],
                         hashlib.sha256(store_spec.read_bytes()).hexdigest())
        self.assertEqual(result['vmstate_at_arm']['size'], len(b'old suspend state'))
        self.assertFalse((output / 'FAILED.json').exists())
        for role in ('standalone', 'member1', 'member2', 'member3'):
            self.assertEqual((output / 'extracted-stores' / role / 'stream.dat').read_text(),
                             'owned-' + role)
        matched = self.root / 'matched'
        host_match(guest_output / 'manifest.json', output / 'extracted-stores', matched)
        self.assertTrue((matched / 'MATCH.json').exists())
        swapped_match = self.root / 'swapped-guest-match'
        with self.assertRaisesRegex(RuntimeError, 'guest scope, store declaration or pre-guard time differs'):
            host_match(swapped_guest / 'manifest.json', output / 'extracted-stores', swapped_match)
        self.assertTrue((swapped_match / 'FAILED.json').exists())
        self.assertFalse((swapped_match / 'MATCH.json').exists())
        original_guest = json.loads((guest_output / 'manifest.json').read_text())
        for label, changes in (
                ('wrong-guest-scope', {'scope': 'host-generated content observation'}),
                ('late-guest-capture', {'at_utc': json.loads((output / 'GUARD.json').read_text())['guarded_at_utc']})):
            candidate = self.root / f'{label}.json'
            write_record(candidate, dict(original_guest, **changes))
            refused = self.root / f'{label}-match'
            with self.assertRaisesRegex(RuntimeError, 'guest scope, store declaration or pre-guard time differs'):
                host_match(candidate, output / 'extracted-stores', refused)
            self.assertTrue((refused / 'FAILED.json').exists())
            self.assertFalse((refused / 'MATCH.json').exists())
        guard_receipt = output / 'GUARD.json'
        original_guard_receipt = guard_receipt.read_bytes()
        guard_receipt.write_bytes(original_guard_receipt + b' ')
        with self.assertRaisesRegex(RuntimeError, 'capture receipt'):
            host_match(guest_output / 'manifest.json', output / 'extracted-stores',
                       self.root / 'wrong-guard')
        guard_receipt.write_bytes(original_guard_receipt)
        capture_receipt = output / 'CAPTURE.json'
        original_receipt = capture_receipt.read_bytes()
        old_receipt = json.loads(original_receipt)
        old_receipt['scope'] = ('sampled stopped-state image extraction; uninterrupted '
                                'power-off, clean shutdown and master acceptance external')
        capture_receipt.write_text(json.dumps(old_receipt))
        with self.assertRaisesRegex(RuntimeError, 'capture receipt'):
            host_match(guest_output / 'manifest.json', output / 'extracted-stores',
                       self.root / 'old-scope')
        capture_receipt.write_bytes(original_receipt)
        changed_receipt = json.loads(original_receipt)
        changed_receipt['clone_image_sha256'] = '0' * 64
        capture_receipt.write_text(json.dumps(changed_receipt))
        with self.assertRaisesRegex(RuntimeError, 'capture receipt'):
            host_match(guest_output / 'manifest.json', output / 'extracted-stores',
                       self.root / 'wrong-capture')
        capture_receipt.write_bytes(original_receipt)
        standalone = output / 'extracted-stores' / 'standalone'
        os.chmod(standalone, 0o700)
        file = standalone / 'stream.dat'
        os.chmod(file, 0o600)
        file.write_text('altered')
        mismatch = self.root / 'mismatch'
        with self.assertRaises(RuntimeError):
            host_match(guest_output / 'manifest.json', output / 'extracted-stores', mismatch)
        self.assertTrue((mismatch / 'FAILED.json').exists())
        self.assertFalse((mismatch / 'MATCH.json').exists())

        state.write_text('started\n')
        second_holder = subprocess.Popen([sys.executable, '-c',
                                          'import sys,time; f=open(sys.argv[1],"rb"); time.sleep(30)',
                                          str(source)], stdout=subprocess.DEVNULL,
                                         stderr=subprocess.DEVNULL)
        self.processes.append(second_holder)
        time.sleep(0.2)
        refused = self.root / 'no-shutdown'
        no_stop = subprocess.run([sys.executable, str(CAPTURE), str(spec), str(store_spec),
                                  str(refused), '1', '--fixture'], capture_output=True)
        self.assertNotEqual(no_stop.returncode, 0)
        self.assertTrue((refused / 'FAILED.json').exists())
        self.assertFalse((refused / 'CAPTURE.json').exists())
        self.assertFalse((refused / 'powered-off-image.asif').exists())
        with self.assertRaisesRegex(RuntimeError, 'already ended'):
            guard(spec, refused, fixture=True)
        self.assertFalse((refused / 'GUARD_INTENT.json').exists())

        with self.assertRaisesRegex(RuntimeError, 'stopped VM'):
            dispose(spec, output, output / 'dispose-while-running', fixture=True)
        self.assertTrue((output / 'dispose-while-running' / 'FAILED.json').exists())
        self.assertFalse((output / 'dispose-while-running' / 'DISPOSE.json').exists())
        self.assertTrue((output / 'powered-off-image.asif').exists())

        second_holder.terminate()
        second_holder.wait(timeout=5)
        state.write_text('stopped\n')
        clone = output / 'powered-off-image.asif'
        with open(clone, 'r+b') as changed:
            changed.write(b'X')
        with self.assertRaisesRegex(RuntimeError, 'temporary clone changed'):
            dispose(spec, output, output / 'dispose-changed-clone', fixture=True)
        self.assertTrue((output / 'dispose-changed-clone' / 'FAILED.json').exists())
        self.assertTrue(clone.exists())
        clone.unlink()
        clone_only(source, clone)
        info = clone.lstat()
        change_immutable(clone, (info.st_dev, info.st_ino, info.st_size), False)
        clone.chmod(0o600)
        attached_clone = plistlib.loads(run('/usr/sbin/diskutil', 'image', 'attach', '--plist',
                                             '--readOnly', '--noMount', str(clone)))
        self.disks.append(attached_clone['system-entities'][0]['dev-entry'])
        with self.assertRaisesRegex(RuntimeError, 'attached'):
            dispose(spec, output, output / 'dispose-attached', fixture=True)
        self.assertTrue(clone.exists())
        self.assertTrue((output / 'dispose-attached' / 'FAILED.json').exists())
        self.assertFalse((output / 'dispose-attached' / 'DISPOSE.json').exists())
        self.eject()
        with self.assertRaisesRegex(RuntimeError, 'requires verified acceptance or abort'):
            dispose(spec, output, output / 'dispose-after-stop', fixture=True)
        self.assertTrue((output / 'dispose-after-stop' / 'FAILED.json').exists())
        self.assertFalse((output / 'dispose-after-stop' / 'DISPOSE.json').exists())
        self.assertTrue(clone.exists())
        with self.assertRaisesRegex(RuntimeError, 'requires verified acceptance or abort'):
            reconcile(spec, output, output / 'bootable', fixture=True)
        self.assertTrue((output / 'bootable' / 'OPERATOR_REQUIRED.json').exists())
        self.assertFalse((output / 'bootable' / 'BOOTABLE.json').exists())
        self.assertTrue(clone.exists())
        self.assertTrue(source.lstat().st_flags & stat.UF_IMMUTABLE)
        os.chflags(clone, clone.lstat().st_flags & ~stat.UF_IMMUTABLE)
        clone.unlink()
        os.chflags(source, source.lstat().st_flags & ~stat.UF_IMMUTABLE)
        for directory, children, _ in os.walk(output):
            for child in children:
                os.chmod(pathlib.Path(directory) / child, 0o700)
        shutil.rmtree(output)

        wrong_store_spec = self.root / 'wrong-store-spec.json'
        wrong_store_spec.write_text(json.dumps({
            'data_volume_uuid': '00000000-0000-0000-0000-000000000000',
            'stores': stores,
        }))
        wrong_store_spec.chmod(0o600)
        state.write_text('started\n')
        third_holder = subprocess.Popen([sys.executable, '-c',
                                         'import sys,time; f=open(sys.argv[1],"rb"); time.sleep(30)',
                                         str(source)], stdout=subprocess.DEVNULL,
                                        stderr=subprocess.DEVNULL)
        self.processes.append(third_holder)
        time.sleep(0.2)
        failed_capture = self.root / 'failed-capture'
        failed_worker = subprocess.Popen([sys.executable, str(CAPTURE), str(spec),
                                          str(wrong_store_spec), str(failed_capture), '20', '--fixture'],
                                         stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
        self.processes.append(failed_worker)
        deadline = time.monotonic() + 15
        while not (failed_capture / 'ARMED.json').exists() and time.monotonic() < deadline:
            if failed_worker.poll() is not None:
                raise AssertionError(failed_worker.stderr.read().decode())
            time.sleep(0.1)
        self.assertTrue((failed_capture / 'ARMED.json').exists())
        third_holder.terminate()
        third_holder.wait(timeout=5)
        state.write_text('stopped\n')
        guard(spec, failed_capture, fixture=True)
        failed_worker.communicate(timeout=30)
        self.assertNotEqual(failed_worker.returncode, 0)
        self.assertTrue((failed_capture / 'FAILED.json').exists())
        self.assertFalse((failed_capture / 'CAPTURE.json').exists())
        failed_clone = failed_capture / 'powered-off-image.asif'
        self.assertTrue(failed_clone.exists())

        attached_clone = plistlib.loads(run('/usr/sbin/diskutil', 'image', 'attach', '--plist',
                                             '--readOnly', '--noMount', str(failed_clone)))
        self.disks.append(attached_clone['system-entities'][0]['dev-entry'])
        with self.assertRaisesRegex(RuntimeError, 'attached'):
            cleanup_failed(spec, failed_capture, failed_capture / 'cleanup-attached', fixture=True)
        self.assertTrue(failed_clone.exists())
        self.eject()
        info = failed_clone.lstat()
        change_immutable(failed_clone, (info.st_dev, info.st_ino, info.st_size), True)
        cleaned = cleanup_failed(spec, failed_capture, failed_capture / 'cleanup-detached',
                                 fixture=True)
        self.assertTrue(cleaned['clone_absent'])
        self.assertTrue((failed_capture / 'cleanup-detached' / 'CLEANUP.json').exists())
        self.assertFalse(failed_clone.exists())
        self.assertTrue(source.exists())
        self.assertFalse(reconcile(spec, failed_capture, failed_capture / 'bootable',
                                   fixture=True)['capture_completed'])


if __name__ == '__main__':
    unittest.main()
