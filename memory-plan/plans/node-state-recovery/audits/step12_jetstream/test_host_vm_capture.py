#!/usr/bin/env python3
import hashlib
import json
import os
import pathlib
import plistlib
import shutil
import subprocess
import sys
import tempfile
import time
import unittest

from stopped_tree_match import guest_capture, host_match


HERE = pathlib.Path(__file__).resolve().parent
CAPTURE = HERE / 'host_vm_capture.py'


def run(*args):
    result = subprocess.run(args, capture_output=True)
    if result.returncode:
        raise AssertionError((args, result.stderr.decode(errors='replace')[:500]))
    return result.stdout


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
        for disk in reversed(self.disks):
            run('/usr/sbin/diskutil', 'eject', disk)
        for directory, dirs, files in os.walk(self.root):
            for name in dirs:
                os.chmod(pathlib.Path(directory) / name, 0o700)
            for name in files:
                os.chmod(pathlib.Path(directory) / name, 0o600)
        shutil.rmtree(self.root)

    def test_external_stop_then_cold_extract(self):
        package = self.root / 'Owned.utm'
        data = package / 'Data'
        data.mkdir(parents=True)
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
        run('/usr/sbin/diskutil', 'eject', self.disks.pop())
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
        holder.terminate()
        holder.wait(timeout=5)
        state.write_text('stopped\n')
        _, stderr = worker.communicate(timeout=30)
        self.assertEqual(worker.returncode, 0, stderr.decode())
        result = json.loads((output / 'CAPTURE.json').read_text())
        self.assertEqual(result['vm_state_at_final_check'], 'stopped')
        self.assertFalse((output / 'FAILED.json').exists())
        for role in ('standalone', 'member1', 'member2', 'member3'):
            self.assertEqual((output / 'extracted-stores' / role / 'stream.dat').read_text(),
                             'owned-' + role)
        matched = self.root / 'matched'
        host_match(guest_output / 'manifest.json', output / 'extracted-stores', matched)
        self.assertTrue((matched / 'MATCH.json').exists())
        capture_receipt = output / 'CAPTURE.json'
        original_receipt = capture_receipt.read_bytes()
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


if __name__ == '__main__':
    unittest.main()
