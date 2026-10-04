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
import unittest


HERE = pathlib.Path(__file__).resolve().parent
TOOL = HERE / 'host_asif_extract.py'


def run(*args):
    result = subprocess.run(args, capture_output=True)
    if result.returncode:
        raise AssertionError((args, result.stderr.decode(errors='replace')[:500]))
    return result.stdout


@unittest.skipUnless(sys.platform == 'darwin' and b'ASIF' in subprocess.run(
    ['/usr/sbin/diskutil', 'image', 'create', 'blank'], capture_output=True).stdout,
    'requires macOS ASIF image tools')
class HostAsifExtractTest(unittest.TestCase):
    def setUp(self):
        self.root = pathlib.Path(tempfile.mkdtemp(prefix='openclaw-asif-extract-'))
        os.chmod(self.root, 0o700)
        self.disks = []

    def tearDown(self):
        for disk in reversed(self.disks):
            run('/usr/sbin/diskutil', 'eject', disk)
        shutil.rmtree(self.root)

    def attach(self, path, *flags):
        response = plistlib.loads(run('/usr/sbin/diskutil', 'image', 'attach', '--plist',
                                      *flags, str(path)))
        entities = response['system-entities']
        self.disks.append(entities[0]['dev-entry'])
        return entities

    def eject(self):
        run('/usr/sbin/diskutil', 'eject', self.disks.pop())

    def test_real_asif_mount_extracts_four_stores_and_refuses_wrong_volume(self):
        source = self.root / 'source.asif'
        clone = self.root / 'clone.asif'
        run('/usr/sbin/diskutil', 'image', 'create', 'blank', '--format', 'ASIF',
            '--size', '128m', '--fs', 'APFS', '--volumeName', 'Data', str(source))
        entities = self.attach(source)
        volume = next(row for row in entities if row.get('volume-name') == 'Data')
        mount = pathlib.Path(volume['mount-point'])
        info = plistlib.loads(run('/usr/sbin/diskutil', 'info', '-plist', volume['dev-entry']))
        stores = []
        for role in ('standalone', 'member1', 'member2', 'member3'):
            relative = 'Users/moltymac/.openclaw/nats/' + role
            location = mount / relative
            location.mkdir(parents=True)
            (location / 'stream.dat').write_bytes(('payload-' + role).encode())
            stores.append({'role': role, 'relative_path': relative})
        self.eject()
        run('/bin/cp', '-c', str(source), str(clone))
        os.chmod(clone, 0o600)
        digest = hashlib.sha256(clone.read_bytes()).hexdigest()
        spec = {'image_sha256': digest, 'data_volume_uuid': info['VolumeUUID'],
                'stores': stores}
        spec_path = self.root / 'spec.json'
        spec_path.write_text(json.dumps(spec))
        positive = subprocess.run([sys.executable, str(TOOL), str(clone), str(spec_path),
                                   str(self.root / 'masters')], capture_output=True)
        self.assertEqual(positive.returncode, 0, positive.stderr.decode())
        report = json.loads((self.root / 'masters' / 'manifest.json').read_text())
        self.assertEqual(set(report['stores']), {'standalone', 'member1', 'member2', 'member3'})
        self.assertEqual(report['image_sha256'], digest)
        for role in report['stores']:
            self.assertEqual((self.root / 'masters' / role / 'stream.dat').read_bytes(),
                             ('payload-' + role).encode())
        self.assertFalse((self.root / 'masters' / '.mounted').exists())

        wrong = dict(spec, data_volume_uuid='00000000-0000-0000-0000-000000000000')
        spec_path.write_text(json.dumps(wrong))
        negative = subprocess.run([sys.executable, str(TOOL), str(clone), str(spec_path),
                                   str(self.root / 'rejected')], capture_output=True)
        self.assertNotEqual(negative.returncode, 0)
        self.assertTrue((self.root / 'rejected' / 'FAILED.json').exists())
        self.assertFalse((self.root / 'rejected' / 'manifest.json').exists())
        self.assertFalse((self.root / 'rejected' / '.mounted').exists())

        wrong_hash = dict(spec, image_sha256='0' * 64)
        spec_path.write_text(json.dumps(wrong_hash))
        bad_image = subprocess.run([sys.executable, str(TOOL), str(clone), str(spec_path),
                                    str(self.root / 'bad-image')], capture_output=True)
        self.assertNotEqual(bad_image.returncode, 0)
        self.assertFalse((self.root / 'bad-image').exists())


if __name__ == '__main__':
    unittest.main()
