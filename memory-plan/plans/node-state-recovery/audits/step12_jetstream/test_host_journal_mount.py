"""Owned tests for the read-only journal mount wrapper (B5), against a scripted host.

diskutil, hdiutil and statfs are one scripted fake (FakeHost) that keeps its own attachment and
mount state, so an attach or mount that failed or timed out can still have applied, the case
cleanup must find through the inventory and statfs rather than the failed command's output. The
capture directory, its pins and commitment are the real host records (StoppedImage); the clone is
an owned stand-in file whose size and sha256 the real pinned publication records. The fake mount
is a copy of the owned stopped Data root, so the real reader runs on it. Nothing is attached or
mounted, no VM is touched, and the CI-only ownership probe is exercised through scripted host controls.
"""
import copy
import errno
import fcntl
import hashlib
import json
import os
import pathlib
import plistlib
import runpy
import shutil
import stat
import subprocess
import sys
import tempfile
import time
import unittest
from unittest import mock

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

import host_journal_mount as wrapper  # noqa: E402
import host_vm_capture  # noqa: E402
import probe_asif_mount_ownership as probe  # noqa: E402
import stopped_journal_inputs  # noqa: E402
import test_capture_checkpoint as guest  # noqa: E402
import test_stopped_journal_inputs as fixture  # noqa: E402
from host_guest_commit import require_captured, require_committed  # noqa: E402
from host_journal_mount import DISKUTIL, HDIUTIL  # noqa: E402
from host_vm_capture import CAPTURE_SCOPE, FIXTURE_UUID  # noqa: E402
from preservation_journal import Refused, encoded  # noqa: E402

UUID = '5E3C8A1D-6B7F-4D2E-9A40-0C1B2D3E4F50'
OTHER = '0A1B2C3D-0000-4000-8000-000000000001'
DISK, CONTAINER = '/dev/disk7', '/dev/disk8'
DATA = CONTAINER + 's2'
FLAGS = (wrapper.MNT_RDONLY | wrapper.MNT_NODEV | wrapper.MNT_NOSUID | wrapper.MNT_NOEXEC
         | 0x00100000)  # MNT_DONTBROWSE, from nobrowse
KEPT = {'step': 'remove mount point', 'kept': 'still mounted or mount state unreadable'}
FOREIGN = {'image-path': '/Users/someone-else/foreign.dmg', 'writeable': True,
           'system-entities': [{'dev-entry': '/dev/disk4', 'content-hint': 'GUID_partition_scheme'}]}


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


class FakeHost:
    """diskutil, hdiutil and statfs as one scripted host with its own attach and mount state."""

    def __init__(self, test):
        self.clone = test.capture / wrapper.CLONE
        self.image = test.data
        self.log = []
        self.reads = []
        self.during_read = []
        self.attached = []
        self.mounted = None
        self.attach = 'ok'
        self.disk = DISK
        self.attach_disk = DISK
        self.native_entries = False
        self.attach_rows = 1
        self.writeable = False
        self.inventory_fails = set()
        self.inventories = 0
        self.inventory_hides_clone = False
        self.during_eject = []
        self.eject_reused = False
        self.summary_change = None
        self.volumes = [
            {'dev-entry': CONTAINER + 's1', 'content-hint': 'Apple_APFS_Volume',
             'info': {'VolumeUUID': OTHER, 'VolumeName': 'Macintosh HD', 'Encryption': False}},
            {'dev-entry': DATA, 'content-hint': 'Apple_APFS_Volume',
             'info': {'VolumeUUID': UUID, 'VolumeName': 'Data', 'Encryption': False}},
            {'dev-entry': CONTAINER + 's3', 'content-hint': 'Apple_APFS_Volume',
             'info': {'VolumeUUID': '0A1B2C3D-0000-4000-8000-000000000003', 'VolumeName': 'Preboot',
                      'Encryption': False}}]
        self.info_fails = set()
        self.mount = 'ok'
        self.mounted_info = {}
        self.statfs_changes = {}
        self.statfs_fails = False
        self.unmount_busy = False
        self.unmount_leaves = None
        self.eject_failures = 0
        self.interrupt_on = self.interrupt = None
        self.real_reader = stopped_journal_inputs.verify_stopped_journal

    def entities(self, disk):
        return ([{'dev-entry': disk, 'content-hint': 'GUID_partition_scheme'},
                 {'dev-entry': disk + 's1', 'content-hint': 'Apple_APFS'},
                 {'dev-entry': CONTAINER, 'content-hint': 'EF57347C-0000-11AA-AA11-00306543ECAC'}]
                + [{key: volume[key] for key in ('dev-entry', 'content-hint')} for volume in self.volumes])

    def attempt(self, *argv, timeout=wrapper.TIMEOUT):
        self.log.append(list(argv))
        if self.interrupt_on and tuple(argv[:len(self.interrupt_on)]) == self.interrupt_on:
            self.interrupt_on = None
            raise self.interrupt
        row = {'argv': list(argv), 'returncode': 0, 'timed_out': False, 'stdout': b'', 'stderr': ''}
        failed = {**row, 'returncode': 1, 'stderr': 'scripted failure'}
        timed_out = {**row, 'returncode': None, 'timed_out': True}
        if argv == (HDIUTIL, 'info', '-plist'):
            self.inventories += 1
            if self.inventories - 1 in self.inventory_fails:
                return failed
            images = [{'image-path': item['path'], 'writeable': item['writeable'],
                       'system-entities': self.entities(item['disk'])} for item in self.attached
                      if not (self.inventory_hides_clone and item['path'] == str(self.clone))]
            return {**row, 'stdout': plistlib.dumps({'images': images + [FOREIGN]})}
        if argv[:3] == (DISKUTIL, 'image', 'attach'):
            if self.attach == 'fail':
                return failed
            for index in range(self.attach_rows):
                self.attached.append({'path': str(self.clone), 'writeable': self.writeable,
                                      'disk': self.disk if index == 0 else '/dev/disk%d' % (9 + index)})
            entities = self.entities(self.attach_disk)
            if self.native_entries:
                entities = [{**entity, 'dev-entry': entity['dev-entry'].removeprefix('/dev/')}
                            for entity in entities]
            out = plistlib.dumps({'system-entities': entities})
            return {'ok': {**row, 'stdout': out}, 'timeout-applied': timed_out,
                    'fail-applied': {**failed, 'stdout': out},
                    'garbage': {**row, 'stdout': b'not a plist'}}[self.attach]
        if argv[:3] == (DISKUTIL, 'info', '-plist') and any(item['disk'] == argv[3] for item in self.attached):
            return {**row, 'stdout': plistlib.dumps({'DeviceNode': argv[3], 'WholeDisk': True})}
        if argv[:3] == (DISKUTIL, 'info', '-plist'):
            volume = next((item for item in self.volumes if item['dev-entry'] == argv[3]), None)
            if volume is None or not self.attached or argv[3] in self.info_fails:
                return failed
            info = {'DeviceNode': argv[3], 'WritableVolume': False, 'GlobalPermissionsEnabled': True,
                    'MountPoint': '', **volume['info']}
            if self.mounted and self.mounted[1] == argv[3]:
                info = {**info, 'MountPoint': self.mounted[0], **self.mounted_info}
            return {**row, 'stdout': plistlib.dumps({key: value for key, value in info.items()
                                                     if value is not None})}
        if argv[:2] == (DISKUTIL, 'mount'):
            if self.mount == 'fail':
                return failed
            shutil.copytree(self.image, argv[-2], symlinks=True, dirs_exist_ok=True)
            self.mounted = (argv[-2], argv[-1])
            return timed_out if self.mount == 'timeout-applied' else row
        if argv[:2] == (DISKUTIL, 'unmount'):
            if self.unmount_busy or not self.mounted or self.mounted[0] != argv[2]:
                return failed
            for path in pathlib.Path(argv[2]).iterdir():
                shutil.rmtree(path) if path.is_dir() and not path.is_symlink() else path.unlink()
            self.mounted = None
            # What a successful unmount may still leave at the mount point.
            if self.unmount_leaves == 'residue':
                (pathlib.Path(argv[2]) / 'residue').write_bytes(b'left behind\n')
            elif self.unmount_leaves == 'symlink':
                os.rename(argv[2], argv[2] + '-aside')
                os.symlink(argv[2] + '-aside', argv[2])
            elif self.unmount_leaves == 'unreadable':
                self.statfs_fails = True
            return row
        if argv[:2] == (DISKUTIL, 'eject'):
            for hook in self.during_eject:
                hook()
            if self.eject_reused:
                # The eject applied, timed out, and another image took the freed disk number.
                self.eject_reused = False
                self.attached = [item for item in self.attached if item['disk'] != argv[2]]
                self.attached.append({'path': '/Users/someone-else/other.dmg', 'writeable': True, 'disk': argv[2]})
                return timed_out
            if self.mounted or self.eject_failures:
                self.eject_failures = max(0, self.eject_failures - 1)
                return failed
            kept = [item for item in self.attached if item['disk'] != argv[2]]
            if len(kept) == len(self.attached):
                return failed
            self.attached = kept
            return row
        raise AssertionError('unscripted command: %r' % (argv,))

    def statfs(self, path):
        if self.statfs_fails:
            raise OSError(errno.EIO, 'scripted statfs failure', str(path))
        if self.mounted and str(path) == self.mounted[0]:
            changes, self.statfs_changes = self.statfs_changes, {}
            return {'flags': FLAGS, 'fstypename': 'apfs', 'mntonname': self.mounted[0],
                    'mntfromname': self.mounted[1], **changes}
        return {'flags': 0x00005000, 'fstypename': 'apfs', 'mntonname': '/', 'mntfromname': '/dev/disk3s1s1'}

    def reader(self, capture_dir, root, *, table):
        self.reads.append(str(root))
        for hook in self.during_read:
            hook()
        summary = self.real_reader(capture_dir, root, table=table)
        return self.summary_change(summary) if self.summary_change else summary


class MountCase(fixture.StoppedImage):
    def setUp(self):
        super().setUp()
        self.clone_bytes = b'owned stand-in for the powered-off ASIF clone\n' * 64
        fixture.host.write_private(self.capture / wrapper.CLONE, self.clone_bytes)
        # The capture worker has published and exited: its CAPTURE_ACTIVE.lock is free again.
        fcntl.flock(self.active, fcntl.LOCK_UN)
        # read_journal_inputs() sets the owner-private umask a capture worker runs under.
        umask = os.umask(0o077)
        os.umask(umask)
        self.addCleanup(os.umask, umask)
        self.publish_clone()
        self.output = self.capture / 'journal-read'
        self.fake = FakeHost(self)
        for name, value in (('attempt', lambda *argv, **options: self.fake.attempt(*argv, **options)),
                            ('statfs', lambda path: self.fake.statfs(path)),
                            ('verify_stopped_journal', lambda *args, **options: self.fake.reader(*args, **options)),
                            ('EJECT_PAUSE', 0)):
            patcher = mock.patch.object(wrapper, name, value)
            patcher.start()
            self.addCleanup(patcher.stop)

    def publish_clone(self, **changes):
        """The worker's real pinned publication, with the clone and volume fields this wrapper reads."""
        host_vm_capture.publish_pinned_capture(self.capture, {
            'scope': CAPTURE_SCOPE, 'vm_state_at_final_check': 'stopped', 'vm_uuid': FIXTURE_UUID,
            'clone_image_sha256': sha(self.clone_bytes), 'clone_size': len(self.clone_bytes),
            'data_volume_uuid': UUID, **changes}, require_committed(self.capture)['checkpoint'])

    def run_mount(self, output=None, table=None, fixture_flag=True):
        try:
            return wrapper.read_journal_inputs(self.capture, output or self.output,
                                               table=self.table if table is None else table,
                                               fixture=fixture_flag), None
        except BaseException as error:
            return None, error

    def failed(self, output=None):
        path = (output or self.output) / 'FAILED.json'
        self.assertEqual(stat.S_IMODE(path.lstat().st_mode), 0o600)
        return json.loads(path.read_bytes())

    def locks_held(self):
        held = []
        for name in ('CAPTURE_ACTIVE.lock', 'ARMED.json'):
            with (self.capture / name).open('rb') as other:
                try:
                    fcntl.flock(other, fcntl.LOCK_EX | fcntl.LOCK_NB)
                    held.append(False)
                except BlockingIOError:
                    held.append(True)
        return held == [True, True]

    def calls(self, *prefix):
        return [argv for argv in self.fake.log if tuple(argv[:len(prefix)]) == prefix]

    def refused(self, pattern, stage, point_left=False):
        """A refusal with its primary error kept, FAILED.json at `stage`, no receipt and no mount point."""
        receipt, error = self.run_mount()
        self.assertIsNone(receipt)
        self.assertRegex(str(error), pattern)
        failed = self.failed()
        self.assertEqual((failed['stage'], failed['primary_error']), (stage, repr(error)[:300]))
        self.assertFalse(os.path.lexists(self.output / 'JOURNAL_INPUTS.json'))
        self.assertEqual(os.path.lexists(self.output / 'mount'), point_left)
        return error, failed

    def released(self, failed, ejected=(DISK,)):
        """Cleanup ejected exactly `ejected`, left nothing of the clone attached or mounted."""
        self.assertEqual([argv[2] for argv in self.calls(DISKUTIL, 'eject')], list(ejected))
        self.assertEqual((self.fake.attached, self.fake.mounted), ([], None))
        self.assertTrue(failed['cleanup']['clean'], failed['cleanup'])

    def unattached(self, pattern, stage):
        """Refused before any attach: nothing attached, nothing ejected, the reader never ran."""
        error, failed = self.refused(pattern, stage)
        self.assertEqual(self.calls(DISKUTIL, 'image', 'attach'), [])
        self.released(failed, ejected=())
        self.assertEqual(self.fake.reads, [])
        return error, failed

    def reset(self):
        """A fresh fake and output for the next subtest of one setUp."""
        self.fake = FakeHost(self)
        self.output = self.capture / ('journal-read-%d' % len(list(self.capture.glob('journal-read*'))))


class Mounted(MountCase):
    def test_reader_runs_only_on_the_verified_read_only_mount_and_the_receipt_lists_what_it_read(self):
        capture_before = {path.name: path.read_bytes() for path in self.capture.iterdir() if path.is_file()}
        seen = {}

        def during():
            seen['mounted'] = self.fake.mounted
            seen['verified'] = list(self.fake.log)
            seen['locked'] = self.locks_held()

        real = wrapper.write_record

        def staged(path, value):
            if path.name == 'JOURNAL_INPUTS.json.partial':
                seen['locked at receipt'] = self.locks_held()
            return real(path, value)

        self.fake.during_read.append(during)
        self.fake.during_eject.append(lambda: seen.setdefault('locked at eject', self.locks_held()))
        os.umask(0o027)
        with mock.patch.object(wrapper, 'write_record', staged):
            receipt, error = self.run_mount()
        self.assertIsNone(error)
        self.assertEqual(os.umask(0o027), 0o027)
        point = str(self.output / 'mount')
        attach = [DISKUTIL, 'image', 'attach', '--plist', '--readOnly', '--noMount', str(self.fake.clone)]
        mount = [DISKUTIL, 'mount', 'readOnly', '-mountOptions', 'nobrowse,nodev,nosuid,noexec,owners',
                 '-mountPoint', point, DATA]
        inventory = [HDIUTIL, 'info', '-plist']
        info = [[DISKUTIL, 'info', '-plist', volume['dev-entry']] for volume in self.fake.volumes]
        before_read = [inventory, attach, inventory, *info, mount, [DISKUTIL, 'info', '-plist', DATA]]
        self.assertEqual(seen, {'mounted': (point, DATA), 'verified': before_read, 'locked': True,
                                'locked at eject': True, 'locked at receipt': True})
        self.assertEqual(self.fake.log, before_read + [[DISKUTIL, 'info', '-plist', DATA], [DISKUTIL, 'unmount', point],
                                                       inventory, [DISKUTIL, 'eject', DISK], inventory,
                                                       [DISKUTIL, 'info', '-plist', DISK]])
        self.assertEqual(self.fake.reads, [point])
        self.assertEqual((self.fake.attached, self.fake.mounted), ([], None))
        self.assertFalse(os.path.lexists(point))
        self.assertFalse(os.path.lexists(self.output / 'FAILED.json'))
        written = self.output / 'JOURNAL_INPUTS.json'
        self.assertEqual(stat.S_IMODE(written.lstat().st_mode), 0o600)
        self.assertEqual(json.loads(written.read_bytes()), receipt)
        self.assertEqual(set(receipt), {'scope', 'at_utc', 'capture_sha256', 'checkpoint_sha256', 'clone_before',
                                        'clone_after', 'attach', 'volume', 'data_volume_uuid', 'mount', 'reader',
                                        'read', 'cleanup'})
        self.assertEqual(receipt['scope'], wrapper.SCOPE)
        self.assertEqual(receipt['capture_sha256'], sha((self.capture / 'CAPTURE.json').read_bytes()))
        self.assertEqual(receipt['checkpoint_sha256'], self.commitment['checkpoint']['checkpoint_sha256'])
        self.assertEqual(receipt['reader']['checkpoint_sha256'], self.record['sha256'])
        clone = self.fake.clone.lstat()
        self.assertEqual({key: receipt['clone_before'][key] for key in ('device', 'inode', 'size', 'sha256')},
                         {'device': clone.st_dev, 'inode': clone.st_ino, 'size': len(self.clone_bytes),
                          'sha256': sha(self.clone_bytes)})
        self.assertEqual(receipt['clone_after'], receipt['clone_before'])
        self.assertEqual(receipt['attach']['disk'], DISK)
        self.assertEqual(receipt['attach']['entities'], self.fake.entities(DISK))
        self.assertNotIn('stdout', receipt['attach']['command'])
        self.assertEqual(receipt['attach']['command']['stdout_sha256'],
                         sha(plistlib.dumps({'system-entities': self.fake.entities(DISK)})))
        self.assertEqual((receipt['volume'], receipt['data_volume_uuid']), (DATA, UUID))
        self.assertEqual(receipt['mount'], {
            'point': point, 'options': 'nobrowse,nodev,nosuid,noexec,owners', 'device': self.output.stat().st_dev,
            'command': {'argv': mount, 'returncode': 0, 'timed_out': False, 'stderr': '',
                        'stdout_sha256': sha(b'')},
            'diskutil': {'WritableVolume': False, 'MountPoint': point, 'VolumeUUID': UUID,
                         'GlobalPermissionsEnabled': True, 'DeviceNode': DATA},
            'statfs': {'flags': FLAGS, 'fstypename': 'apfs', 'mntonname': point, 'mntfromname': DATA}})
        self.assertEqual(receipt['reader'], {
            'window': 'window-1', 'lineage': ['window-1'], 'checkpoint_sha256': self.record['sha256'],
            'pre_head': self.commitment['manifest']['journal_head'], 'session': guest.SESSION,
            'config_modes': {path: 0o600 for path in self.configs}})
        files = {str(path.relative_to(self.data)): path for path in self.data.rglob('*')
                 if stat.S_ISREG(path.lstat().st_mode)}
        self.assertEqual(sorted(row['path'] for row in receipt['read']), sorted(files))
        for row in receipt['read']:
            info = files[row['path']].lstat()
            self.assertEqual({key: row[key] for key in ('size', 'mode', 'uid', 'nlink', 'sha256')},
                             {'size': info.st_size, 'mode': stat.S_IMODE(info.st_mode), 'uid': info.st_uid,
                              'nlink': 1, 'sha256': sha(files[row['path']].read_bytes())})
        self.assertEqual([step['step'] for step in receipt['cleanup']['steps']],
                         ['mounted before cleanup', 'unmount', 'attachments before eject', 'eject ' + DISK,
                          'attachments after eject', 'attach result disk after eject', 'mounted after eject',
                          'remove mount point'])
        self.assertTrue(receipt['cleanup']['clean'])
        self.assertEqual({path.name: path.read_bytes() for path in self.capture.iterdir() if path.is_file()},
                         capture_before)
        self.assertEqual(sorted(os.listdir(self.output)), ['JOURNAL_INPUTS.json'])
        self.assertFalse(self.locks_held())

    def test_ejects_are_retried_within_their_bound(self):
        self.fake.eject_failures = wrapper.EJECT_ATTEMPTS - 1
        receipt, error = self.run_mount()
        self.assertIsNone(error)
        self.assertEqual(len(self.calls(DISKUTIL, 'eject')), wrapper.EJECT_ATTEMPTS)
        self.assertTrue(receipt['cleanup']['clean'])


class EntryRefusals(MountCase):
    def test_production_entrypoint_refuses_before_anything_runs(self):
        receipt, error = self.run_mount(fixture_flag=False)
        self.assertIsNone(receipt)
        self.assertRegex(str(error), '^production journal mount requires a host-pinned B3 table and a '
                                     'protected acceptance root$')
        self.assertEqual(self.fake.log, [])
        self.assertFalse(os.path.lexists(self.output))

    def test_cli_runs_only_as_the_fixture_and_its_usage_is_exact(self):
        table = self.temp / 'table.json'
        fixture.host.write_private(table, encoded(self.table))
        for argv, pattern in (([str(table)], '^production journal mount requires'),
                              ([str(self.temp / 'missing-table.json')], '^production journal mount requires'),
                              ([str(table), '--production'], '^usage: '),
                              ([str(table), '--fixture', '--fixture'], '^usage: '),
                              ([], '^usage: ')):
            with self.subTest(argv), mock.patch.object(sys, 'argv', ['host_journal_mount.py', str(self.capture),
                                                                    str(self.output), *argv]), \
                    mock.patch('subprocess.run', side_effect=AssertionError('command run')):
                with self.assertRaisesRegex(RuntimeError, pattern):
                    runpy.run_path(wrapper.__file__, run_name='__main__')
            self.assertFalse(os.path.lexists(self.output))

    def test_only_an_owned_fixture_parent_is_accepted(self):
        with mock.patch.object(wrapper, 'FIXTURE_PARENTS', ('openclaw-host-capture-',)):
            _, error = self.run_mount()
        self.assertRegex(str(error), '^journal mount requires an owned fixture capture parent$')
        self.assertEqual((self.fake.log, os.path.lexists(self.output)), ([], False))
        # The durable recovery directory is never an owned fixture parent, wherever HOME points.
        self.assertFalse('OpenClawRecovery'.startswith(wrapper.FIXTURE_PARENTS))
        self.assertTrue(self.capture.parent.name.startswith(wrapper.FIXTURE_PARENTS))

    def test_capture_directory_and_output_are_owned_and_fresh(self):
        for path in (self.capture.parent, self.capture):
            with self.subTest(str(path)):
                os.chmod(path, 0o750)
                _, error = self.run_mount()
                os.chmod(path, 0o700)
                self.assertRegex(str(error), '^expected owner-private literal directory: ' + str(path) + '$')
                self.assertFalse(os.path.lexists(self.output))
        elsewhere = self.temp.resolve() / 'elsewhere'
        _, error = self.run_mount(output=elsewhere)
        self.assertRegex(str(error), '^journal mount output must be a child of the capture directory$')
        self.assertFalse(os.path.lexists(elsewhere))
        for name in ('FAILED.json', 'CAPTURE.json.tmp', 'journal-read-', 'Journal-read', 'journal-read-.x'):
            with self.subTest(name):
                _, error = self.run_mount(output=self.capture / name)
                self.assertRegex(str(error), r'^journal mount output must be named journal-read\[-NAME\]$')
                self.assertFalse(os.path.lexists(self.capture / name))
        self.assertEqual(self.fake.log, [])
        self.output.mkdir(mode=0o700)
        _, error = self.run_mount()
        self.assertIsInstance(error, FileExistsError)
        self.assertEqual((self.fake.log, list(self.output.iterdir())), ([], []))

    def test_arm_lock_holder_refuses_before_any_command(self):
        with (self.capture / 'ARMED.json').open('rb') as holder:
            fcntl.flock(holder, fcntl.LOCK_SH)
            _, error = self.run_mount()
        self.assertRegex(str(error), '^capture is busy: another holder has the arm lock$')
        self.assertIsInstance(error.__cause__, BlockingIOError)
        self.assertEqual({key: value for key, value in self.failed().items() if key != 'primary_error'},
                         {'stage': 'lock', 'cleanup': None})
        self.assertEqual(self.fake.log, [])
        self.reset()
        (self.capture / 'ARMED.json').unlink()
        _, error = self.run_mount()
        self.assertIsInstance(error, FileNotFoundError)
        self.assertEqual((self.failed()['stage'], self.fake.log), ('lock', []))

    def test_a_capture_worker_still_running_or_an_unsafe_worker_lock_refuses(self):
        active = self.capture / 'CAPTURE_ACTIVE.lock'
        with self.subTest('worker still active'):
            fcntl.flock(self.active, fcntl.LOCK_EX)
            _, error = self.run_mount()
            fcntl.flock(self.active, fcntl.LOCK_UN)
            self.assertRegex(str(error), '^capture worker is still active$')
            self.assertEqual((self.failed()['stage'], self.fake.log), ('lock', []))
        with self.subTest('not owner-private'):
            self.reset()
            os.chmod(active, 0o644)
            _, error = self.run_mount()
            os.chmod(active, 0o600)
            self.assertRegex(str(error), '^CAPTURE_ACTIVE.lock is not an owner-private lock file$')
            self.assertEqual((self.failed()['stage'], self.fake.log), ('lock', []))
        with self.subTest('symlink'):
            self.reset()
            os.rename(active, self.temp / 'active-aside.lock')
            os.symlink(self.temp / 'active-aside.lock', active)
            _, error = self.run_mount()
            self.assertEqual((type(error), error.errno), (OSError, errno.ELOOP))
            self.assertEqual((self.failed()['stage'], self.fake.log), ('lock', []))

    def test_the_arm_lock_is_a_regular_file_opened_without_following_or_blocking(self):
        armed = self.capture / 'ARMED.json'
        aside = self.temp / 'armed-aside.json'
        os.rename(armed, aside)
        with self.subTest('symlink'):
            os.symlink(aside, armed)
            _, error = self.run_mount()
            self.assertIsInstance(error, OSError)
            self.assertEqual(error.errno, errno.ELOOP)
            self.assertEqual((self.failed()['stage'], self.fake.log), ('lock', []))
            armed.unlink()
        with self.subTest('fifo'):
            self.reset()
            # Without O_NONBLOCK this open would wait for a writer forever.
            os.mkfifo(armed, 0o600)
            _, error = self.run_mount()
            self.assertRegex(str(error), '^ARMED.json is not an owner-private lock file$')
            self.assertEqual((self.failed()['stage'], self.fake.log), ('lock', []))


class InputRefusals(MountCase):
    def test_a_failed_capture_is_never_attached(self):
        fixture.host.write_private(self.capture / 'FAILED.json', b'{}\n')
        self.unattached('^capture failed; its clone is not mounted$', 'inputs')

    def test_capture_pins_and_commitment_hold_before_the_attach(self):
        capture = self.capture / 'CAPTURE.json'
        raw = capture.read_bytes()
        with self.subTest('pin'):
            self.rewrite('CAPTURE.json', guest_commit_sha256='0' * 64)
            self.unattached('^capture record does not pin this checkpoint commitment$', 'inputs')
        with self.subTest('mode'):
            self.reset()
            self.replace(capture, raw)
            os.chmod(capture, 0o640)
            self.unattached('^guest commitment input is not owner-private: ', 'inputs')
        with self.subTest('commitment'):
            self.reset()
            os.chmod(capture, 0o600)
            committed = require_committed(self.capture)
            with mock.patch.object(wrapper, 'require_committed', return_value={
                    **committed, 'checkpoint': {**committed['checkpoint'], 'journal_head': '0' * 64}}):
                self.unattached('^capture commitment differs from the pinned capture record$', 'inputs')

    def test_capture_record_must_be_a_stopped_fixture_capture_naming_its_volume(self):
        for changes, pattern in (({'scope': 'other'}, 'capture record is not a completed stopped-VM capture'),
                                 ({'vm_state_at_final_check': 'started'},
                                  'capture record is not a completed stopped-VM capture'),
                                 ({'vm_uuid': '00000000-0000-0000-0000-000000000003'},
                                  'capture is not of the owned fixture VM'),
                                 ({'data_volume_uuid': ''}, 'capture record names no Data volume'),
                                 ({'data_volume_uuid': None}, 'capture record names no Data volume')):
            with self.subTest(changes):
                self.reset()
                self.publish_clone(**changes)
                self.unattached('^' + pattern + '$', 'inputs')

    def test_clone_must_be_the_owned_single_link_image_of_the_pinned_size_and_hash(self):
        clone = self.fake.clone
        shape = '^clone is not the owned single-link 0600 image of the recorded size$'
        with self.subTest('mode'):
            os.chmod(clone, 0o640)
            self.unattached(shape, 'inputs')
            os.chmod(clone, 0o600)
        with self.subTest('second link'):
            self.reset()
            os.link(clone, self.temp / 'second-link')
            self.unattached(shape, 'inputs')
            os.unlink(self.temp / 'second-link')
        with self.subTest('symlink'):
            self.reset()
            moved = self.temp / 'moved.asif'
            os.rename(clone, moved)
            os.symlink(moved, clone)
            self.unattached(shape, 'inputs')
            os.unlink(clone)
            os.rename(moved, clone)
        with self.subTest('size'):
            self.reset()
            self.publish_clone(clone_size=len(self.clone_bytes) + 1)
            self.unattached(shape, 'inputs')
        with self.subTest('pinned hash'):
            self.reset()
            self.publish_clone(clone_image_sha256='0' * 64)
            self.unattached('^clone hash differs from the capture record$', 'inputs')
        with self.subTest('bytes'):
            self.reset()
            self.publish_clone()
            self.replace(clone, self.clone_bytes[:-1] + b'X')
            self.unattached('^clone hash differs from the capture record$', 'inputs')
        with self.subTest('missing'):
            self.reset()
            clone.unlink()
            error, _ = self.unattached('No such file or directory', 'inputs')
            self.assertIsInstance(error, FileNotFoundError)

    def test_clone_must_not_change_or_be_swapped_while_it_is_hashed(self):
        clone = self.fake.clone
        real_read, real_open = os.read, os.open
        grown = []

        def growing(fd, size):
            # Grow once, after the first chunk was read, as a concurrent writer would.
            chunk = real_read(fd, size)
            if not grown:
                grown.append(True)
                with open(clone, 'ab') as handle:
                    handle.write(b'+')
            return chunk

        def swapping(path, flags, *args, **kwargs):
            if pathlib.Path(path) == clone:
                # Same bytes, size and mtime under a new inode: only the inode check refuses it.
                info = clone.lstat()
                fixture.host.write_private(self.temp / 'swap.asif', self.clone_bytes)
                os.utime(self.temp / 'swap.asif', ns=(info.st_atime_ns, info.st_mtime_ns))
                os.replace(self.temp / 'swap.asif', clone)
            return real_open(path, flags, *args, **kwargs)

        for name, target, side_effect in (('grown', 'read', growing), ('swapped', 'open', swapping)):
            with self.subTest(name):
                self.reset()
                grown.clear()
                fixture.host.write_private(self.temp / 'fresh.asif', self.clone_bytes)
                os.replace(self.temp / 'fresh.asif', clone)
                with mock.patch.object(wrapper.os, target, side_effect=side_effect):
                    self.unattached('^clone changed while it was hashed$', 'inputs')

    def test_the_capture_record_the_pins_were_checked_on_is_the_one_used(self):
        rewritten = []

        def rewriting(capture_dir):
            if not rewritten:
                rewritten.append(True)
                self.rewrite('CAPTURE.json', note='rewritten between the two reads')
            return require_captured(capture_dir)

        with mock.patch.object(wrapper, 'require_captured', side_effect=rewriting):
            self.unattached('^capture record changed while it was read$', 'inputs')

    def test_the_hosts_own_started_sample_must_name_the_fixture_vm(self):
        pinned = require_captured(self.capture)
        committed = json.loads(pinned['COMMITTED.json'])
        committed['started_sample'] = {**committed['started_sample'], 'vm_uuid': '00000000-0000-0000-0000-000000000003'}
        forged = {**pinned, 'COMMITTED.json': encoded(committed)}
        commitment = {**committed, 'checkpoint': json.loads(pinned['CHECKPOINT.json'])}
        with mock.patch.object(wrapper, 'require_captured', return_value=forged), \
                mock.patch.object(wrapper, 'require_committed', return_value=commitment):
            self.unattached('^capture is not of the owned fixture VM$', 'inputs')

    def test_the_locked_arm_record_must_be_the_capture_arm_record(self):
        real = wrapper.capture_locks

        def replaced_after_locking(capture_dir):
            held = real(capture_dir)
            armed = capture_dir / 'ARMED.json'
            fixture.host.write_private(self.temp / 'same-arm.json', armed.read_bytes())
            os.replace(self.temp / 'same-arm.json', armed)
            return held

        with mock.patch.object(wrapper, 'capture_locks', side_effect=replaced_after_locking):
            self.unattached('^the locked ARMED.json is not the capture arm record$', 'inputs')

    def test_a_clone_owned_by_another_user_is_refused(self):
        # Seen from another uid, so it runs without root on every CI host.
        capture = json.loads((self.capture / 'CAPTURE.json').read_bytes())
        with mock.patch('os.getuid', return_value=os.getuid() + 1):
            with self.assertRaisesRegex(RuntimeError,
                                        '^clone is not the owned single-link 0600 image of the recorded size$'):
                wrapper.clone_identity(self.fake.clone, capture)
        self.assertEqual(wrapper.clone_identity(self.fake.clone, capture)['sha256'], sha(self.clone_bytes))

    def test_a_clone_already_attached_by_path_or_identity_is_refused_and_left_attached(self):
        alias = self.temp / 'alias.asif'
        os.symlink(self.fake.clone, alias)
        for path in (self.fake.clone, alias):
            with self.subTest(str(path)):
                self.reset()
                self.fake.attached = [{'path': str(path), 'writeable': False, 'disk': '/dev/disk5'}]
                error, failed = self.refused('^clone is already attached$', 'inventory')
                self.assertEqual((self.calls(DISKUTIL, 'image', 'attach'), self.calls(DISKUTIL, 'eject')), ([], []))
                self.assertEqual(self.fake.attached, [{'path': str(path), 'writeable': False, 'disk': '/dev/disk5'}])
                self.assertTrue(failed['cleanup']['clean'])

    def test_an_unreadable_inventory_refuses_before_the_attach(self):
        self.fake.inventory_fails = {0}
        self.unattached('^attached image inventory failed or timed out$', 'inventory')


class Attach(MountCase):
    def test_an_attach_that_failed_or_timed_out_after_it_applied_is_ejected_from_the_inventory(self):
        for mode in ('timeout-applied', 'fail-applied'):
            with self.subTest(mode):
                self.reset()
                self.fake.attach = mode
                _, failed = self.refused('^read-only attach failed or timed out$', 'attach')
                self.released(failed)
                self.assertEqual((self.calls(DISKUTIL, 'mount'), self.fake.reads), ([], []))

    def test_an_attachment_the_inventory_still_lists_is_never_clean(self):
        # A timed-out attach gives no disk of its own, so the inventory alone shows what is left.
        self.fake.attach, self.fake.eject_failures = 'timeout-applied', wrapper.EJECT_ATTEMPTS
        _, failed = self.refused('^read-only attach failed or timed out$', 'attach')
        steps = {step['step']: step for step in failed['cleanup']['steps']}
        self.assertEqual(steps['attachments after eject']['result'], 1)
        self.assertNotIn('attach result disk after eject', steps)
        self.assertFalse(failed['cleanup']['clean'])

    def test_an_attach_that_did_not_apply_ejects_nothing(self):
        self.fake.attach = 'fail'
        _, failed = self.refused('^read-only attach failed or timed out$', 'attach')
        self.released(failed, ejected=())

    def test_attach_output_that_is_not_a_plist_is_refused_and_ejected(self):
        self.fake.attach = 'garbage'
        _, failed = self.refused('^read-only attach output is not a plist$', 'attach')
        self.released(failed)

    def test_a_successful_attach_must_name_a_harvestable_whole_disk(self):
        for spelling in ('rdisk7', '/dev/rdisk7', 'disk7 ', 'DISK7', '/dev/disk7s1'):
            with self.subTest(spelling=spelling):
                self.reset()
                self.fake.attach_disk = spelling
                _, failed = self.refused('^attach result names no valid whole disk$', 'attach')
                self.released(failed)
                self.assertEqual((self.calls(DISKUTIL, 'mount'), self.fake.reads), ([], []))

    def test_the_clone_must_be_attached_exactly_once_read_only(self):
        with self.subTest('writeable'):
            self.fake.writeable = True
            _, failed = self.refused('^clone is not attached exactly once read-only$', 'attach')
            self.released(failed)
        with self.subTest('twice'):
            self.reset()
            self.fake.attach_rows = 2
            _, failed = self.refused('^clone is not attached exactly once read-only$', 'attach')
            self.released(failed, ejected=(DISK, '/dev/disk10'))

    def test_the_attach_result_must_name_the_inventory_disk_and_cleanup_trusts_the_inventory(self):
        self.fake.attach_disk = '/dev/disk9'
        _, failed = self.refused('^attached clone disk differs from the attach result$', 'attach')
        self.released(failed)

    def test_the_attached_disk_must_be_a_whole_dev_disk_node(self):
        self.fake.disk = self.fake.attach_disk = 'disk7'
        _, failed = self.refused('^attached clone disk differs from the attach result$', 'attach')
        self.released(failed, ejected=('disk7',))

    def test_an_inventory_lost_after_the_attach_does_not_authorize_eject(self):
        self.fake.inventory_fails = {1, 2, 3}
        _, failed = self.refused('^attached image inventory failed or timed out$', 'attach')
        self.assertEqual(self.calls(DISKUTIL, 'eject'), [])
        self.assertTrue(self.fake.attached)
        self.assertFalse(failed['cleanup']['clean'])


class Volume(MountCase):
    def test_the_pinned_uuid_must_name_one_unencrypted_unmounted_apfs_volume_named_data(self):
        cases = ((lambda data: data['info'].update(VolumeUUID=OTHER),
                  'pinned Data volume UUID is not on the attached clone exactly once'),
                 (lambda data: self.fake.volumes[0]['info'].update(VolumeUUID=UUID),
                  'pinned Data volume UUID is not on the attached clone exactly once'),
                 (lambda data: data.update({'content-hint': 'Apple_APFS'}),
                  'pinned Data volume UUID is not on the attached clone exactly once'),
                 (lambda data: data['info'].update(VolumeName='Macintosh HD - Data'),
                  'pinned volume is not named Data'),
                 (lambda data: data['info'].update(Encryption=True), 'pinned Data volume is encrypted'),
                 (lambda data: data['info'].pop('Encryption'), 'pinned Data volume is encrypted'),
                 (lambda data: data['info'].update(MountPoint='/Volumes/Data'),
                  'pinned Data volume is already mounted'),
                 (lambda data: self.fake.info_fails.add(DATA), 'volume information failed or timed out'))
        for index, (change, pattern) in enumerate(cases):
            with self.subTest(index):
                self.reset()
                change(self.fake.volumes[1])
                _, failed = self.refused('^' + pattern + '$', 'volume')
                self.released(failed)
                self.assertEqual((self.calls(DISKUTIL, 'mount'), self.fake.reads), ([], []))

    def test_native_bare_entries_bind_to_the_canonical_inventory_and_device_node(self):
        self.fake.native_entries = True
        receipt, error = self.run_mount()
        self.assertIsNone(error)
        self.assertEqual((receipt['attach']['disk'], receipt['attach']['inventory_disk_raw'],
                          receipt['attach']['entities'][0]['dev-entry'], receipt['volume']),
                         (DISK, DISK, 'disk7', DATA))

    def test_native_partition_must_match_a_canonical_device_node(self):
        for node in ('/dev/disk99s2', '/dev/disk8', 'disk8s2', '/dev/disk8s2/../disk99s2'):
            with self.subTest(node=node):
                self.reset()
                self.fake.native_entries = True
                self.fake.volumes[1]['info']['DeviceNode'] = node
                _, failed = self.refused('^Data DeviceNode differs from its attach entry$', 'volume')
                self.released(failed)
                self.assertEqual((self.calls(DISKUTIL, 'mount'), self.fake.reads), ([], []))


class Mount(MountCase):
    def test_a_failed_mount_is_refused_and_released(self):
        self.fake.mount = 'fail'
        _, failed = self.refused('^read-only mount failed or timed out$', 'mount')
        self.released(failed)
        self.assertEqual((self.calls(DISKUTIL, 'unmount'), self.fake.reads), ([], []))

    def test_a_mount_that_timed_out_after_it_applied_is_found_by_statfs_and_unmounted(self):
        self.fake.mount = 'timeout-applied'
        _, failed = self.refused('^read-only mount failed or timed out$', 'mount')
        self.released(failed)
        self.assertEqual(self.calls(DISKUTIL, 'unmount'), [[DISKUTIL, 'unmount', str(self.output / 'mount')]])
        self.assertEqual(self.fake.reads, [])


class Verify(MountCase):
    def test_the_reader_runs_only_on_a_read_only_nodev_nosuid_noexec_mount_honouring_owners(self):
        every = wrapper.MNT_RDONLY | wrapper.MNT_NODEV | wrapper.MNT_NOSUID | wrapper.MNT_NOEXEC
        cases = (({'WritableVolume': True}, {}, 'Data volume is writable'),
                 ({'WritableVolume': None}, {}, 'Data volume is writable'),
                 ({'MountPoint': '/Volumes/Data'}, {}, 'Data volume is not mounted at the private mount point'),
                 ({'MountPoint': None}, {}, 'Data volume is not mounted at the private mount point'),
                 ({'VolumeUUID': OTHER}, {}, 'mounted volume UUID differs'),
                 ({'GlobalPermissionsEnabled': False}, {}, 'Data volume ownership is not enabled'),
                 ({'GlobalPermissionsEnabled': None}, {}, 'Data volume ownership is not enabled'),
                 ({}, {'mntonname': '/'}, 'private mount point is not a mount'),
                 ({}, {'mntfromname': CONTAINER + 's1'}, 'private mount point holds another device'),
                 ({}, {'fstypename': 'hfs'}, 'mounted filesystem is not APFS'),
                 ({}, {'flags': FLAGS & ~wrapper.MNT_RDONLY}, 'mount is not read-only'),
                 ({}, {'flags': FLAGS & ~wrapper.MNT_NODEV}, 'mount is not nodev'),
                 ({}, {'flags': FLAGS & ~wrapper.MNT_NOSUID}, 'mount is not nosuid'),
                 ({}, {'flags': FLAGS & ~wrapper.MNT_NOEXEC}, 'mount is not noexec'),
                 ({}, {'flags': FLAGS & ~every}, 'mount is not read-only, nodev, nosuid, noexec'),
                 ({}, {'flags': FLAGS | wrapper.MNT_IGNORE_OWNERSHIP}, 'mount ignores ownership'))
        for info, found, pattern in cases:
            with self.subTest(pattern, info=info, found=found):
                self.reset()
                self.fake.mounted_info, self.fake.statfs_changes = info, found
                _, failed = self.refused('^' + pattern + '$', 'verify')
                self.released(failed)
                self.assertEqual(self.fake.reads, [])
                self.assertEqual(len(self.calls(DISKUTIL, 'unmount')), 1)
        with self.subTest('mounted volume information'):
            self.reset()
            original = self.fake.attempt

            def lost(*argv, **options):
                if argv[:2] == (DISKUTIL, 'info') and self.fake.mounted:
                    self.fake.log.append(list(argv))
                    return {'argv': list(argv), 'returncode': None, 'timed_out': True, 'stdout': b'', 'stderr': ''}
                return original(*argv, **options)

            self.fake.attempt = lost
            _, failed = self.refused('^mounted volume information failed or timed out$', 'verify')
            self.released(failed)
            self.assertEqual(self.fake.reads, [])



class RealStatfs(unittest.TestCase):
    """The unscripted statfs: macOS only; there, a read-only syscall on the runner's own root."""

    def test_statfs_is_macos_only_and_decodes_the_sealed_root(self):
        if sys.platform != 'darwin':
            with self.assertRaisesRegex(RuntimeError, '^mount verification requires macOS statfs$'):
                wrapper.statfs('/')
            return
        found = wrapper.statfs('/')
        # The sealed system volume is mounted read-only at /, so name, type and flag layout all show.
        self.assertEqual((found['mntonname'], found['fstypename']), ('/', 'apfs'))
        self.assertTrue(found['mntfromname'].startswith('/dev/disk'))
        self.assertTrue(found['flags'] & wrapper.MNT_RDONLY)
        with self.assertRaises(FileNotFoundError):
            wrapper.statfs('/nonexistent-' + os.urandom(8).hex())


class Reader(MountCase):
    def test_a_reader_failure_keeps_its_primary_error_and_releases(self):
        sentinel = RuntimeError('sentinel reader failure')

        def fail():
            raise sentinel

        self.fake.during_read.append(fail)
        error, failed = self.refused('^sentinel reader failure$', 'read')
        self.assertIs(error, sentinel)
        self.released(failed)
        self.assertEqual(len(self.calls(DISKUTIL, 'unmount')), 1)

    def test_an_interrupt_during_the_read_is_released_and_reraised(self):
        self.fake.during_read.append(lambda: (_ for _ in ()).throw(KeyboardInterrupt()))
        error, failed = self.refused('^$', 'read')
        self.assertIsInstance(error, KeyboardInterrupt)
        self.released(failed)

    def test_the_real_reader_refuses_a_forged_image_on_the_mount(self):
        image = self.image()
        fixture.host.write_private(fixture.preservation(image) / 'extra', b'{}')
        self.fake.image = image
        error, failed = self.refused('preservation directory holds a pending, corrupt-receipt or unknown entry',
                                     'read')
        self.assertIsInstance(error, Refused)
        self.released(failed)

    def test_the_reader_result_is_bound_to_the_mount_and_the_commitment(self):
        def rows(change):
            return lambda summary: {**summary, 'read': change(summary['read'])}

        cases = ((rows(lambda read: [{**read[0], 'device': read[0]['device'] + 1}] + read[1:]),
                  'the reader read outside the verified mount'),
                 (rows(lambda read: []), 'the reader read outside the verified mount'),
                 (lambda summary: {**summary, 'checkpoint_sha256': '0' * 64}, 'the reader verified another commitment'),
                 (lambda summary: {**summary, 'pre_head': '0' * 64}, 'the reader verified another commitment'))
        for index, (change, pattern) in enumerate(cases):
            with self.subTest(index):
                self.reset()
                self.fake.summary_change = change
                _, failed = self.refused('^' + pattern + '$', 'read')
                self.released(failed)

    def test_the_mount_must_verify_unchanged_after_the_read(self):
        for flags, pattern in ((FLAGS | wrapper.MNT_IGNORE_OWNERSHIP, 'mount ignores ownership'),
                               (FLAGS | 0x00001000, 'the mount changed while it was read')):
            with self.subTest(pattern):
                self.reset()
                self.fake.during_read.append(lambda flags=flags: self.fake.statfs_changes.update(flags=flags))
                _, failed = self.refused('^' + pattern + '$', 'reverify')
                self.released(failed)
                self.assertEqual(len(self.fake.reads), 1)

    def test_the_caller_table_decides_the_identities(self):
        table = copy.deepcopy(self.table)
        table['member2']['config_sha256'] = '0' * 64
        receipt, error = self.run_mount(table=table)
        self.assertIsInstance(error, Refused)
        self.assertRegex(str(error), 'nats-2: baseline config hash differs from the window pin')
        self.released(self.failed())


class Cleanup(MountCase):
    def test_a_cleanup_failure_never_replaces_the_primary_error(self):
        sentinel = RuntimeError('sentinel reader failure')

        def fail():
            self.fake.unmount_busy = True
            raise sentinel

        self.fake.during_read.append(fail)
        _, error = self.run_mount()
        self.assertIs(error, sentinel)
        cleanup = self.failed()['cleanup']
        self.assertFalse(cleanup['clean'])
        steps = {step['step']: step for step in cleanup['steps']}
        self.assertEqual(steps['unmount']['result']['returncode'], 1)
        self.assertEqual(len(self.calls(DISKUTIL, 'eject')), wrapper.EJECT_ATTEMPTS)
        self.assertEqual((steps['attachments after eject']['result'], steps['mounted after eject']['result']),
                         (1, True))
        self.assertEqual(steps['remove mount point'], KEPT)
        self.assertEqual(len(self.fake.attached), 1)

    def test_an_unknown_mount_state_is_still_unmounted_and_recorded(self):
        sentinel = RuntimeError('sentinel reader failure')

        def fail():
            self.fake.statfs_fails = True
            raise sentinel

        self.fake.during_read.append(fail)
        _, error = self.run_mount()
        self.assertIs(error, sentinel)
        cleanup = self.failed()['cleanup']
        self.assertFalse(cleanup['clean'])
        self.assertIn('scripted statfs failure', cleanup['steps'][0]['error'])
        self.assertEqual(self.calls(DISKUTIL, 'unmount'), [[DISKUTIL, 'unmount', str(self.output / 'mount')]])
        self.assertEqual((self.fake.attached, self.fake.mounted), ([], None))
        self.assertEqual(cleanup['steps'][-1], KEPT)
        self.assertTrue(os.path.lexists(self.output / 'mount'))

    def test_an_inventory_that_misses_the_attach_never_counts_as_clean(self):
        self.fake.inventory_hides_clone = True
        _, failed = self.refused('^clone is not attached exactly once read-only$', 'attach')
        self.assertEqual(self.calls(DISKUTIL, 'eject'), [])
        gone = [step for step in failed['cleanup']['steps'] if step['step'] == 'attach result disk after eject']
        self.assertEqual([step['result']['returncode'] for step in gone], [0])
        self.assertFalse(failed['cleanup']['clean'])
        self.assertEqual([item['disk'] for item in self.fake.attached], [DISK])

    def test_a_retried_eject_never_takes_a_reused_disk_number(self):
        self.fake.eject_reused = True
        _, failed = self.refused('^journal mount cleanup did not complete$', 'release')
        self.assertEqual(self.calls(DISKUTIL, 'eject'), [[DISKUTIL, 'eject', DISK]])
        self.assertEqual(self.fake.attached, [{'path': '/Users/someone-else/other.dmg', 'writeable': True,
                                               'disk': DISK}])
        self.assertIn('attachments before eject retry', [step['step'] for step in failed['cleanup']['steps']])
        self.assertFalse(failed['cleanup']['clean'])

    def test_the_mount_point_is_removed_only_once_known_unmounted_and_empty(self):
        sentinel = RuntimeError('sentinel reader failure')
        for name, leaves, outcome in (('still mounted', None, KEPT),
                                      ('state unreadable', 'unreadable', KEPT),
                                      ('not empty', 'residue', 'mount point is not empty'),
                                      ('not a directory', 'symlink', 'mount point is not a directory')):
            with self.subTest(name):
                self.reset()
                mount = self.output / 'mount'

                def fail(leaves=leaves):
                    self.fake.unmount_busy = leaves is None
                    self.fake.unmount_leaves = leaves
                    raise sentinel

                self.fake.during_read.append(fail)
                with mock.patch.object(wrapper.os, 'rmdir', wraps=os.rmdir) as rmdir:
                    _, error = self.run_mount()
                self.assertIs(error, sentinel)
                self.assertEqual([call for call in rmdir.call_args_list
                                  if call.args and pathlib.Path(call.args[0]) == mount], [])
                cleanup = self.failed()['cleanup']
                removal = [step for step in cleanup['steps'] if step['step'] == 'remove mount point']
                if outcome == KEPT:
                    self.assertEqual(removal, [KEPT])
                else:
                    self.assertEqual(len(removal), 1)
                    self.assertIn(outcome, removal[0]['error'])
                self.assertTrue(os.path.lexists(mount))
                self.assertFalse(cleanup['clean'])
                # Whatever the unmount left is kept as found, never deleted.
                if leaves == 'residue':
                    self.assertEqual((mount / 'residue').read_bytes(), b'left behind\n')
                elif leaves == 'symlink':
                    self.assertTrue(mount.is_symlink() and pathlib.Path(str(mount) + '-aside').is_dir())

    def test_an_interrupt_stops_cleanup_after_a_failure_and_the_primary_error_is_raised(self):
        for name, primary, where in (('at an eject', RuntimeError('sentinel reader failure'), 'eject'),
                                     ('between ejects', RuntimeError('sentinel reader failure'), 'pause'),
                                     ('after an interrupted read', KeyboardInterrupt('first'), 'eject'),
                                     ('system exit', RuntimeError('sentinel reader failure'), 'exit')):
            with self.subTest(name):
                self.reset()
                interrupt = SystemExit(3) if where == 'exit' else KeyboardInterrupt('during cleanup')

                def fail(primary=primary):
                    raise primary

                self.fake.during_read.append(fail)
                if where == 'pause':
                    self.fake.eject_failures = 1
                    pause = mock.patch.object(wrapper.time, 'sleep', side_effect=interrupt)
                else:
                    self.fake.interrupt_on, self.fake.interrupt = (DISKUTIL, 'eject'), interrupt
                    pause = mock.patch.object(wrapper.time, 'sleep')
                with pause:
                    _, error = self.run_mount()
                self.assertIs(error, primary)
                failed = self.failed()
                self.assertEqual((failed['stage'], failed['primary_error']), ('read', repr(primary)))
                self.assertEqual(failed['cleanup'], {'steps': failed['cleanup']['steps'], 'clean': False})
                self.assertEqual(failed['cleanup']['steps'][-1], {'step': 'interrupted', 'error': repr(interrupt)})
                # Bounded: the interrupt stopped the cleanup; nothing ran after it.
                self.assertEqual(self.fake.log[-1], [DISKUTIL, 'eject', DISK])
                self.assertEqual(len(self.calls(DISKUTIL, 'eject')), 1)

    def test_an_interrupt_during_cleanup_after_a_good_read_is_raised_with_its_evidence(self):
        real = wrapper.write_record

        def interrupted_write(path, value):
            if path.name == 'FAILED.json':
                raise KeyboardInterrupt('during the evidence write')
            return real(path, value)

        for name in ('interrupt', 'system exit', 'second interrupt while recording'):
            with self.subTest(name):
                self.reset()
                interrupt = SystemExit(3) if name == 'system exit' else KeyboardInterrupt('during cleanup')
                self.fake.interrupt_on, self.fake.interrupt = (DISKUTIL, 'eject'), interrupt
                if name.startswith('second'):
                    with mock.patch.object(wrapper, 'write_record', interrupted_write):
                        receipt, error = self.run_mount()
                    self.assertFalse(os.path.lexists(self.output / 'FAILED.json'))
                else:
                    receipt, error = self.run_mount()
                    failed = self.failed()
                    self.assertEqual((failed['stage'], failed['primary_error']), ('release', repr(interrupt)))
                    self.assertEqual(failed['cleanup']['steps'][-1],
                                     {'step': 'interrupted', 'error': repr(interrupt)})
                self.assertIsNone(receipt)
                self.assertIs(error, interrupt)
                self.assertFalse(os.path.lexists(self.output / 'JOURNAL_INPUTS.json'))
                self.assertEqual((len(self.fake.reads), self.fake.log[-1]), (1, [DISKUTIL, 'eject', DISK]))

    def test_a_failing_or_interrupted_evidence_write_never_replaces_the_primary_error(self):
        sentinel = RuntimeError('sentinel reader failure')
        real = wrapper.write_record
        for failure in (TypeError('scripted evidence write failure'), KeyboardInterrupt('during the evidence write')):
            with self.subTest(repr(failure)):
                self.reset()
                self.fake.during_read.append(lambda: (_ for _ in ()).throw(sentinel))

                def broken(path, value, failure=failure):
                    if path.name == 'FAILED.json':
                        raise failure
                    return real(path, value)

                with mock.patch.object(wrapper, 'write_record', broken):
                    _, error = self.run_mount()
                self.assertIs(error, sentinel)
                self.assertEqual((self.fake.attached, self.fake.mounted), ([], None))

    def test_incomplete_cleanup_after_a_good_read_writes_no_receipt(self):
        for name, script in (('unmount busy', lambda: setattr(self.fake, 'unmount_busy', True)),
                             ('eject refused', lambda: setattr(self.fake, 'eject_failures', wrapper.EJECT_ATTEMPTS))):
            with self.subTest(name):
                self.reset()
                self.fake.during_read.append(script)
                with mock.patch.object(wrapper.time, 'sleep') as pause:
                    _, failed = self.refused('^journal mount cleanup did not complete$', 'release',
                                             point_left=name == 'unmount busy')
                self.assertFalse(failed['cleanup']['clean'])
                self.assertEqual(len(self.calls(DISKUTIL, 'eject')), wrapper.EJECT_ATTEMPTS)
                # The pause falls only between attempts, never after the last one.
                self.assertEqual(pause.call_args_list, [mock.call(wrapper.EJECT_PAUSE)] * (wrapper.EJECT_ATTEMPTS - 1))
                self.assertEqual(len(self.fake.reads), 1)


class AfterEject(MountCase):
    def rename_changes_ctime(self):
        probe_file = self.temp / 'ctime-premise'
        fixture.host.write_private(probe_file, b'premise')
        before = probe_file.lstat().st_ctime_ns
        time.sleep(0.05)
        os.rename(probe_file, self.temp / 'ctime-premise-aside')
        os.rename(self.temp / 'ctime-premise-aside', probe_file)
        changed = probe_file.lstat().st_ctime_ns != before
        probe_file.unlink()
        return changed

    def check(self, change, pattern):
        self.fake.during_read.append(change)
        _, failed = self.refused('^' + pattern + '$', 'after eject')
        self.assertTrue(failed['cleanup']['clean'])
        self.assertEqual(len(self.fake.reads), 1)

    def test_a_clone_rewritten_while_mounted_is_refused(self):
        self.check(lambda: self.replace(self.fake.clone, self.clone_bytes[:-1] + b'X'),
                   'clone hash differs from the capture record')

    def test_a_clone_touched_replaced_or_renamed_back_while_mounted_is_refused(self):
        def touched():
            info = self.fake.clone.lstat()
            os.utime(self.fake.clone, ns=(info.st_atime_ns, info.st_mtime_ns + 10 ** 9))

        def replaced():
            fixture.host.write_private(self.temp / 'same-bytes.asif', self.clone_bytes)
            os.replace(self.temp / 'same-bytes.asif', self.fake.clone)

        def renamed_back():
            # Inode, mtime and bytes survive a rename away and back; only ctime records it.
            time.sleep(0.05)
            os.rename(self.fake.clone, self.temp / 'aside.asif')
            os.rename(self.temp / 'aside.asif', self.fake.clone)

        def chmodded():
            # A real mode change and back: every filesystem records that as a status change.
            time.sleep(0.05)
            os.chmod(self.fake.clone, 0o640)
            os.chmod(self.fake.clone, 0o600)

        for name, change in (('touched', touched), ('replaced', replaced), ('renamed back', renamed_back),
                             ('metadata only', chmodded)):
            with self.subTest(name):
                if name == 'renamed back' and not self.rename_changes_ctime():
                    self.skipTest('this filesystem keeps ctime across a rename; inode and hash still bind')
                self.reset()
                self.check(change, 'capture pins, commitment, clone or volume changed while mounted')

    def test_a_capture_republished_or_failed_while_mounted_is_refused(self):
        with self.subTest('republished'):
            # A same-uid rewrite: the real publisher would block on the arm lock this run holds.
            self.check(lambda: self.rewrite('CAPTURE.json', data_volume_uuid=OTHER),
                       'capture pins, commitment, clone or volume changed while mounted')
        with self.subTest('arm record replaced with the same bytes'):
            self.reset()
            self.publish_clone()

            def replace_arm():
                armed = self.capture / 'ARMED.json'
                fixture.host.write_private(self.temp / 'same-arm.json', armed.read_bytes())
                os.replace(self.temp / 'same-arm.json', armed)

            self.check(replace_arm, 'capture pins, commitment, clone or volume changed while mounted')
        with self.subTest('failed'):
            self.reset()
            self.publish_clone()
            self.check(lambda: fixture.host.write_private(self.capture / 'FAILED.json', b'{}\n'),
                       'capture failed; its clone is not mounted')

    def test_the_receipt_is_exclusive(self):
        planted = self.output / 'JOURNAL_INPUTS.json'
        self.fake.during_read.append(lambda: fixture.host.write_private(planted, b'planted\n'))
        receipt, error = self.run_mount()
        self.assertIsInstance(error, FileExistsError)
        self.assertEqual(self.failed()['stage'], 'receipt')
        self.assertEqual(planted.read_bytes(), b'planted\n')
        self.assertFalse(os.path.lexists(self.output / 'JOURNAL_INPUTS.json.partial'))


class Receipt(MountCase):
    def test_the_receipt_is_published_whole_or_not_at_all(self):
        planted = b'planted staging\n'
        cases = (('a value JSON cannot hold', TypeError,
                  lambda: self.fake.mounted_info.update(DeviceNode=b'not json')),
                 ('a failed sync after the link', OSError, None),
                 ('a staging file already there', RuntimeError,
                  lambda: fixture.host.write_private(self.output / 'JOURNAL_INPUTS.json.partial', planted)))
        real = wrapper.fsync_parent
        for name, kind, before in cases:
            with self.subTest(name):
                self.reset()
                if name == 'a value JSON cannot hold':
                    before()
                elif before:
                    self.fake.during_read.append(before)

                def failing_sync(path):
                    if name == 'a failed sync after the link' and path == self.output:
                        raise OSError(errno.EIO, 'scripted sync failure')
                    return real(path)

                with mock.patch.object(wrapper, 'fsync_parent', side_effect=failing_sync):
                    receipt, error = self.run_mount()
                self.assertIsNone(receipt)
                self.assertIsInstance(error, kind)
                self.assertEqual(self.failed()['stage'], 'receipt')
                self.assertFalse(os.path.lexists(self.output / 'JOURNAL_INPUTS.json'))
                staging = self.output / 'JOURNAL_INPUTS.json.partial'
                if name == 'a staging file already there':
                    self.assertEqual(staging.read_bytes(), planted)
                else:
                    self.assertFalse(os.path.lexists(staging))


class Attempt(unittest.TestCase):
    def test_every_command_is_bounded_and_reads_no_stdin(self):
        done = subprocess.CompletedProcess(['x'], 0, b'out', b'err')
        with mock.patch('subprocess.run', return_value=done) as run:
            row = wrapper.attempt(DISKUTIL, 'list')
        run.assert_called_once_with((DISKUTIL, 'list'), capture_output=True, timeout=wrapper.TIMEOUT,
                                    stdin=subprocess.DEVNULL)
        self.assertEqual(row, {'argv': [DISKUTIL, 'list'], 'returncode': 0, 'timed_out': False,
                               'stdout': b'out', 'stderr': 'err'})
        with mock.patch('subprocess.run', side_effect=subprocess.TimeoutExpired('x', 1)):
            self.assertEqual(wrapper.attempt(DISKUTIL, 'list'), {'argv': [DISKUTIL, 'list'], 'returncode': None,
                                                                 'timed_out': True, 'stdout': b'', 'stderr': ''})
        with mock.patch('subprocess.run', side_effect=FileNotFoundError(errno.ENOENT, 'no such tool')):
            row = wrapper.attempt(DISKUTIL, 'list')
        self.assertEqual((row['returncode'], row['timed_out'], 'no such tool' in row['stderr']), (None, False, True))


class ProbeHost:
    """diskutil and hdiutil for the probe's cleanup: which disks exist, and which image holds each."""

    def __init__(self, image, held=None):
        self.image = str(image)
        self.held = dict(held or {})
        self.commands = []
        self.eject = {}
        self.inventory_fails = False
        self.interrupt_on = self.interrupt = None

    def attempt(self, *argv, **options):
        self.commands.append(list(argv))
        if self.interrupt_on and tuple(argv[:len(self.interrupt_on)]) == self.interrupt_on:
            self.interrupt_on = None
            raise self.interrupt
        row = {'argv': list(argv), 'returncode': 0, 'timed_out': False, 'stdout': b'', 'stderr': ''}
        if argv[:2] == (DISKUTIL, 'eject'):
            outcome = self.eject.get(argv[2], ['ok']).pop(0) if self.eject.get(argv[2]) else 'ok'
            if outcome == 'fail':
                return {**row, 'returncode': 1}
            if argv[2] in self.held:
                del self.held[argv[2]]
            if outcome == 'timeout-reused':
                self.held[argv[2]] = FOREIGN['image-path']
                return {**row, 'returncode': None, 'timed_out': True}
            return row
        if argv[:3] == (DISKUTIL, 'info', '-plist'):
            return {**row, 'returncode': 0 if argv[3] in self.held else 1}
        return row

    def attachments(self, image):
        if self.inventory_fails:
            raise RuntimeError('attached image inventory failed or timed out')
        return [{'image-path': path, 'system-entities': [{'dev-entry': disk}]}
                for disk, path in self.held.items() if path == str(image)]

    def ejects(self):
        return [argv[2] for argv in self.commands if argv[:2] == [DISKUTIL, 'eject']]


class ProbeRelease(unittest.TestCase):
    """The probe's cleanup, scripted: ejects bound to the inventory, its own disks confirmed gone."""

    IMAGE = pathlib.Path('/nonexistent/openclaw-asif-ownership-x/probe.asif')

    def release(self, host, disks, points=()):
        escaped = None
        with mock.patch.object(probe, 'attempt', side_effect=host.attempt), \
                mock.patch.object(probe, 'attachments', side_effect=host.attachments), \
                mock.patch.object(probe.time, 'sleep') as pause, \
                mock.patch('subprocess.run', side_effect=AssertionError('command run')):
            try:
                record, late = probe.release(self.IMAGE, list(points), disks)
            except BaseException as error:
                escaped = error
        self.assertIsNone(escaped, 'release raised instead of returning')
        return record, late, pause

    def test_a_listed_disk_is_retried_after_a_pause_only_while_the_inventory_still_binds_it(self):
        with self.subTest('still bound: retried'):
            host = ProbeHost(self.IMAGE, {'/dev/disk7': str(self.IMAGE)})
            host.eject['/dev/disk7'] = ['fail', 'ok']
            record, late, pause = self.release(host, ['/dev/disk7'])
            self.assertEqual((host.ejects(), late), (['/dev/disk7', '/dev/disk7'], None))
            self.assertEqual(pause.call_args_list, [mock.call(wrapper.EJECT_PAUSE)])
            self.assertEqual((record['disks_gone'], record['clean']), ([True], True))
        with self.subTest('number reused after a timed-out eject: not retried, not clean'):
            host = ProbeHost(self.IMAGE, {'/dev/disk7': str(self.IMAGE)})
            host.eject['/dev/disk7'] = ['timeout-reused']
            record, late, _ = self.release(host, ['/dev/disk7'])
            self.assertEqual(host.ejects(), ['/dev/disk7'])
            self.assertEqual(host.held, {'/dev/disk7': FOREIGN['image-path']})
            self.assertEqual((record['remaining'], record['disks_gone'], record['clean']), (0, [False], False))

    def test_an_unlisted_attach_disk_is_only_an_absence_check_never_eject_authority(self):
        for owner in ('', FOREIGN['image-path']):
            with self.subTest(owner=owner):
                host = ProbeHost(self.IMAGE, {'/dev/disk7': owner})
                record, late, _ = self.release(host, ['/dev/disk7', '/dev/disk7'])
                self.assertEqual(host.commands, [[DISKUTIL, 'info', '-plist', '/dev/disk7']])
                self.assertEqual(host.held, {'/dev/disk7': owner})
                self.assertEqual((record['listed'], record['disks_gone'], record['clean']), ([], [False], False))

    def test_an_unreadable_inventory_keeps_known_disks_and_is_never_clean(self):
        host = ProbeHost(self.IMAGE, {'/dev/disk7': str(self.IMAGE)})
        host.inventory_fails = True
        record, late, _ = self.release(host, ['/dev/disk7'])
        self.assertEqual(host.ejects(), [])
        self.assertEqual((record['listed'], record['disks_gone'], record['remaining']), (None, [False], None))
        self.assertFalse(record['clean'])
        self.assertTrue(any('inventory failed' in error for error in record['errors']))

    def test_a_second_cleanup_after_a_phase_error_cannot_eject_a_reused_disk_number(self):
        host = ProbeHost(self.IMAGE, {'/dev/disk7': str(self.IMAGE)})
        remembered = ['/dev/disk7']
        first, _, _ = self.release(host, remembered)
        self.assertTrue(first['clean'])
        self.assertEqual(remembered, ['/dev/disk7'])
        host.held['/dev/disk7'] = FOREIGN['image-path']
        second, _, _ = self.release(host, remembered)
        self.assertEqual(host.ejects(), ['/dev/disk7'])
        self.assertEqual(host.held, {'/dev/disk7': FOREIGN['image-path']})
        self.assertFalse(second['clean'])

    def test_wrapper_cleanup_also_refuses_remembered_disk_authority_without_inventory(self):
        host = ProbeHost(self.IMAGE, {'/dev/disk7': FOREIGN['image-path']})
        host.inventory_fails = True
        with mock.patch.object(wrapper, 'attempt', side_effect=host.attempt), \
                mock.patch.object(wrapper, 'attachments', side_effect=host.attachments), \
                mock.patch('subprocess.run', side_effect=AssertionError('command run')):
            record, late = wrapper.release(self.IMAGE, pathlib.Path('/nonexistent-owned-mount'), True, ['/dev/disk7'])
        self.assertIsNone(late)
        self.assertEqual(host.ejects(), [])
        self.assertEqual(host.held, {'/dev/disk7': FOREIGN['image-path']})
        self.assertFalse(record['clean'])

    def test_an_interrupt_during_release_stops_it_and_is_returned_never_raised(self):
        host = ProbeHost(self.IMAGE, {'/dev/disk7': str(self.IMAGE)})
        host.interrupt_on, host.interrupt = (DISKUTIL, 'eject'), KeyboardInterrupt('during eject')
        record, late, _ = self.release(host, ['/dev/disk7'])
        self.assertIs(late, host.interrupt)
        self.assertEqual((record['clean'], record['steps'][-1]), (False, {'interrupted': repr(host.interrupt)}))
        self.assertEqual(host.held, {'/dev/disk7': str(self.IMAGE)})

    def test_a_phase_raises_a_late_interrupt_else_requires_clean_before_forgetting_its_disks(self):
        disks = ['/dev/disk7']
        with self.assertRaises(KeyboardInterrupt):
            probe.settled({'clean': True}, KeyboardInterrupt('late'), 'write phase', disks)
        self.assertEqual(disks, ['/dev/disk7'])
        with self.assertRaisesRegex(RuntimeError, '^write phase did not release the probe image$'):
            probe.settled({'clean': False}, None, 'write phase', disks)
        self.assertEqual(disks, ['/dev/disk7'])
        probe.settled({'clean': True}, None, 'write phase', disks)
        self.assertEqual(disks, [])


class ProbeAttach(unittest.TestCase):
    """What an attach leaves for cleanup is harvested from its output before its status is read."""

    def attach(self, row):
        disks = []
        with mock.patch.object(probe, 'attempt', return_value={'argv': [], 'stderr': '', **row}), \
                mock.patch('subprocess.run', side_effect=AssertionError('command run')):
            with self.assertRaises(RuntimeError) as raised:
                probe.attach(pathlib.Path('/nonexistent/probe.asif'), disks)
        return disks, str(raised.exception)

    def test_a_failed_or_timed_out_attach_that_applied_is_still_known_to_cleanup(self):
        plist = plistlib.dumps({'system-entities': [{'dev-entry': '/dev/disk7'}]})
        disks, error = self.attach({'returncode': 1, 'timed_out': False, 'stdout': plist})
        self.assertEqual((disks, error), (['/dev/disk7'], 'attach failed: '))
        disks, error = self.attach({'returncode': None, 'timed_out': True, 'stdout': plist})
        self.assertEqual((disks, error), (['/dev/disk7'], 'attach failed: '))
        # Without parseable output or a whole-disk node there is nothing to harvest: the inventory remains.
        disks, error = self.attach({'returncode': None, 'timed_out': True, 'stdout': b''})
        self.assertEqual((disks, error), ([], 'attach failed: '))
        disks, error = self.attach({'returncode': 0, 'timed_out': False, 'stdout': b'not a plist'})
        self.assertEqual((disks, error), ([], 'attach output is not a plist'))
        bare = plistlib.dumps({'system-entities': [{'dev-entry': 'disk7'}]})
        disks, error = self.attach({'returncode': 1, 'timed_out': False, 'stdout': bare})
        self.assertEqual((disks, error), (['/dev/disk7'], 'attach failed: '))

    def test_only_whole_disk_nodes_are_harvested_from_either_native_spelling(self):
        for value in ('disk7', '/dev/disk7'):
            row = {'stdout': plistlib.dumps({'system-entities': [{'dev-entry': value}]})}
            self.assertEqual(wrapper.attached_disk(row), ['/dev/disk7'])
        for value in ('disk7s1', '/dev/disk7s1', '../disk7', 'disk7/..', '/dev//disk7', 'disk７', 7):
            row = {'stdout': plistlib.dumps({'system-entities': [{'dev-entry': value}]})}
            self.assertEqual(wrapper.attached_disk(row), [], repr(value))

    def test_a_successful_probe_attach_requires_a_whole_disk_observation(self):
        for value in ('rdisk7', '/dev/rdisk7', 'disk7 ', 'DISK7', 'disk7s1'):
            disks = []
            rows = [{'system-entities': [{'dev-entry': value},
                                        {'dev-entry': 'disk8s1', 'content-hint': 'Apple_APFS_Volume'}]},
                    {'VolumeName': 'Data', 'DeviceNode': '/dev/disk8s1'}]
            def reply(*args):
                return {'argv': list(args), 'returncode': 0, 'timed_out': False, 'stderr': '',
                        'stdout': plistlib.dumps(rows.pop(0))}
            with mock.patch.object(probe, 'attempt', side_effect=reply), \
                    mock.patch.object(probe, 'attachments', return_value=[]), \
                    mock.patch('subprocess.run', side_effect=AssertionError('command run')):
                with self.assertRaisesRegex(RuntimeError, '^attach result names no valid whole disk$'):
                    probe.attach(pathlib.Path('/nonexistent/probe.asif'), disks)
            self.assertEqual(disks, [])

    def test_data_device_node_must_match_the_raw_attach_identifier(self):
        for spelling in ('disk8s1', '/dev/disk8s1'):
            for node in ('/dev/disk8s1', '/dev/disk9s1', '/dev/disk8', 'disk8s1', '/dev/disk8s1/../disk9s1'):
                disks = []
                raw = {'system-entities': [{'dev-entry': 'disk7'},
                                          {'dev-entry': spelling, 'content-hint': 'Apple_APFS_Volume'}]}
                outputs = [raw, {'DeviceNode': node, 'VolumeName': 'Data'}]
                def reply(*argv):
                    return {'argv': list(argv), 'returncode': 0, 'timed_out': False, 'stderr': '',
                            'stdout': plistlib.dumps(outputs.pop(0))}
                with self.subTest(spelling=spelling, node=node), \
                        mock.patch.object(probe, 'attempt', side_effect=reply), \
                        mock.patch.object(probe, 'attachments', return_value=[]), \
                        mock.patch('subprocess.run', side_effect=AssertionError('command run')):
                    if node == '/dev/disk8s1':
                        result = probe.attach(pathlib.Path('/nonexistent/probe.asif'), disks)
                        self.assertEqual((result['volume'], result['entities']), (node, raw['system-entities']))
                    else:
                        with self.assertRaisesRegex(RuntimeError, '^Data DeviceNode differs from its attach entry$'):
                            probe.attach(pathlib.Path('/nonexistent/probe.asif'), disks)
                self.assertEqual(disks, ['/dev/disk7'])


class ProbeWritePreparation(unittest.TestCase):
    def test_only_the_fresh_volume_root_is_made_runner_writable_before_seeding(self):
        temp = pathlib.Path(tempfile.mkdtemp(prefix='openclaw-probe-setup-')).resolve()
        self.addCleanup(shutil.rmtree, temp, True)
        point, calls, state = temp / 'write', [], {'writable': False}
        original_write = pathlib.Path.write_bytes

        def write(path, payload):
            if path.parent == point and not state['writable']:
                raise PermissionError('owned volume root still owned by root')
            calls.append(('write', str(path)))
            return original_write(path, payload)

        def attempt(*argv):
            calls.append(argv)
            if argv == (probe.SUDO, '-n', '/usr/sbin/chown', '%s:%s' % (os.getuid(), os.getgid()), str(point)):
                state['writable'] = True
            return {'argv': list(argv), 'returncode': 0, 'timed_out': False, 'stdout': b'', 'stderr': ''}

        def release(*args):
            for path in point.iterdir():
                path.unlink()
            return {'clean': True}, None

        report = {}
        with mock.patch.object(probe, 'attach', return_value={'volume': '/dev/disk8s1'}), \
                mock.patch.object(probe, 'mount_at', side_effect=lambda *args: point.mkdir()), \
                mock.patch.object(probe, 'info_of', return_value={}), \
                mock.patch.object(wrapper, 'statfs', return_value={'flags': 0}), \
                mock.patch.object(probe, 'attempt', side_effect=attempt), \
                mock.patch.object(probe, 'release', side_effect=release), \
                mock.patch.object(pathlib.Path, 'write_bytes', write), \
                mock.patch('subprocess.run', side_effect=AssertionError('command run')):
            probe.write_phase(temp / 'probe.asif', temp, report, [])
        owner = (probe.SUDO, '-n', '/usr/sbin/chown', '%s:%s' % (os.getuid(), os.getgid()), str(point))
        root_file = (probe.SUDO, '-n', '/usr/sbin/chown', '0:0', str(point / 'root.txt'))
        self.assertLess(calls.index(owner), calls.index(('write', str(point / 'user.txt'))))
        self.assertIn(root_file, calls)
        root_owner = (probe.SUDO, '-n', '/usr/sbin/chown', '0:0', str(point))
        self.assertIn(root_owner, calls)
        self.assertLess(calls.index(root_file), calls.index(root_owner))
        self.assertLess(calls.index(('write', str(point / 'root.txt'))), calls.index(root_owner))
        self.assertEqual(report['write']['after_enable']['files']['root.txt']['mode'], '0o600')
        self.assertFalse(point.exists())


class NativeDeviceBinding(unittest.TestCase):
    def test_committed_native_rows_bind_and_verify_without_a_device_spelling_refusal(self):
        report = json.loads(pathlib.Path(__file__).with_name('B5_NATIVE_ASIF_COMPLETE_REPORT_20261017.json').read_bytes())
        native = report['variants']['wrapper-options']
        attach = native['attach']
        self.assertEqual(wrapper.attached_disk({'stdout': plistlib.dumps({'system-entities': attach['entities']})}),
                         [attach['inventory'][0]['system-entities'][0]['dev-entry']])
        reply = {'returncode': 0, 'timed_out': False, 'stderr': '', 'stdout': plistlib.dumps(attach['info'])}
        with mock.patch.object(wrapper, 'attempt', return_value=reply), \
                mock.patch('subprocess.run', side_effect=AssertionError('command run')):
            volume = wrapper.data_volume(attach['entities'], native['info']['VolumeUUID'])
        self.assertEqual(volume, native['info']['DeviceNode'])
        reply['stdout'] = plistlib.dumps(native['info'])
        with mock.patch.object(wrapper, 'attempt', return_value=reply), \
                mock.patch.object(wrapper, 'statfs', return_value=native['statfs']), \
                mock.patch('subprocess.run', side_effect=AssertionError('command run')):
            verified = wrapper.verify_mount(pathlib.Path(native['info']['MountPoint']), volume,
                                            native['info']['VolumeUUID'])
        self.assertEqual(verified['statfs']['mntfromname'], volume)


class ReaderProbe(MountCase):
    def test_each_native_case_oracle_runs_the_real_locked_reader_and_only_intact_verifies(self):
        for name, expected in probe.READER_CASES:
            with self.subTest(name=name):
                self.fake.image = self.image()
                probe.change_reader_seed(self.fake.image, name)
                row = {}
                with mock.patch.object(stopped_journal_inputs, 'verify_frozen_checkpoint',
                                       wraps=stopped_journal_inputs.verify_frozen_checkpoint) as frozen:
                    probe.reader_case(self.capture, self.capture / ('journal-read-' + name.replace('-', '')),
                                      self.table, expected, row)
                self.assertEqual(frozen.call_count, int(name in ('intact', 'changed-config')))
                if expected is None:
                    self.assertEqual(row['receipt']['reader']['checkpoint_sha256'], self.record['sha256'])
                else:
                    self.assertRegex(row['refusal']['message'], expected)
                    self.assertTrue(row['failure']['cleanup']['clean'])

    def test_a_verifier_bypass_is_caught_by_the_changed_config_oracle(self):
        authentic = self.fake.real_reader(self.capture, self.data, table=self.table)
        self.fake.image = self.image()
        probe.change_reader_seed(self.fake.image, 'changed-config')
        with mock.patch.object(stopped_journal_inputs, 'verify_frozen_checkpoint', return_value=authentic):
            with self.assertRaisesRegex(RuntimeError, '^reader accepted the damaged fixture$'):
                probe.reader_case(self.capture, self.output, self.table,
                                  dict(probe.READER_CASES)['changed-config'], {})

    def test_an_unrelated_refusal_or_missing_known_disk_check_cannot_satisfy_the_oracle(self):
        self.fake.mount = 'fail'
        with self.assertRaisesRegex(RuntimeError, '^reader refused for another reason: '):
            probe.reader_case(self.capture, self.output, self.table, 'unknown entry', {})
        self.fake.mount = 'ok'
        original = wrapper.release

        def vacuous(*args):
            cleanup, late = original(*args)
            return {**cleanup, 'steps': [step for step in cleanup['steps']
                                        if step['step'] != 'attach result disk after eject']}, late

        with mock.patch.object(wrapper, 'release', side_effect=vacuous):
            with self.assertRaisesRegex(RuntimeError, '^reader did not confirm its attached disk gone$'):
                probe.reader_case(self.capture, self.capture / 'journal-read-vacuous', self.table, None, {})


class ReaderSeed(unittest.TestCase):
    def test_writable_seed_uses_a_distinct_nonroot_owner_then_restores_root(self):
        with tempfile.TemporaryDirectory(prefix='openclaw-reader-seed-owner-') as name:
            temp = pathlib.Path(name).resolve()
            image, seed, capture = temp / 'owned.asif', temp / 'seed', temp / 'capture'
            image.write_bytes(b'owned image')
            capture.mkdir()
            point = temp / 'reader-seed'
            calls = []
            owner = {'uid': 0, 'gid': 0}

            def mount(path, volume):
                self.assertEqual((path, volume), (point, DATA))
                path.mkdir(mode=0o755)
                path.chmod(0o755)

            def command(*argv):
                calls.append(argv)
                if argv[:3] == (probe.SUDO, '-n', '/usr/sbin/chown'):
                    uid, gid = map(int, argv[3].split(':'))
                    owner.update(uid=uid, gid=gid)
                return {'returncode': 0, 'timed_out': False, 'stdout': b'', 'stderr': ''}

            def seed_fixture(*args):
                self.assertEqual((args[0], args[1]), (capture, seed))
                self.assertEqual(owner, {'uid': 501, 'gid': 20})
                seed.mkdir()
                (seed / 'Users').mkdir()
                return {'owned': True}

            def release(*args):
                if (point / 'Users').exists():
                    shutil.rmtree(point / 'Users')
                self.assertEqual(owner, {'uid': 0, 'gid': 0})
                return {'clean': True}, None

            original_lstat = pathlib.Path.lstat

            def lstat(path):
                info = original_lstat(path)
                if path != point:
                    return info
                values = list(info)
                values[4:6] = [owner['uid'], owner['gid']]
                return os.stat_result(values)

            with mock.patch.object(probe, 'attach', return_value={'volume': DATA, 'info': {'VolumeUUID': UUID}}), \
                    mock.patch.object(probe, 'mount_at', side_effect=mount), \
                    mock.patch.object(probe, 'attempt', side_effect=command), \
                    mock.patch.object(probe, 'seed_reader_fixture', side_effect=seed_fixture), \
                    mock.patch.object(probe, 'change_reader_seed'), \
                    mock.patch.object(probe, 'release', side_effect=release), \
                    mock.patch.object(probe, 'settled'), \
                    mock.patch.object(pathlib.Path, 'lstat', lstat), \
                    mock.patch.object(probe.os, 'getuid', return_value=501), \
                    mock.patch.object(probe.os, 'getgid', return_value=20):
                row = {}
                probe.reader_write_phase(image, temp, seed, capture, [], 'intact', row)
            self.assertEqual(row['fixture'], {'owned': True})
            self.assertEqual(row['seed_root'], {'uid': 0, 'gid': 0, 'mode': '0o755'})
            self.assertEqual([argv for argv in calls if argv[:3] ==
                              (probe.SUDO, '-n', '/usr/sbin/chown')], [
                (probe.SUDO, '-n', '/usr/sbin/chown', '501:20', str(point)),
                (probe.SUDO, '-n', '/usr/sbin/chown', '0:0', str(point))])
            self.assertFalse(point.exists())

    def test_native_uuid_is_bound_before_commitment_and_no_fixture_patch_survives_seeding(self):
        with tempfile.TemporaryDirectory(prefix='openclaw-capture-owned-seed-') as name:
            temp = pathlib.Path(name).resolve()
            capture, seed = temp / 'capture', temp / 'seed'
            capture.mkdir(mode=0o700)
            clone = capture / wrapper.CLONE
            clone.write_bytes(b'owned clone must survive host fixture seeding')
            writer = guest.preservation_journal.NATS_WRITER_MARKER
            inventory = guest.preservation_journal.capture_entrypoint_inventory
            seeded = probe.seed_reader_fixture(capture, seed, UUID)
            self.assertEqual(clone.read_bytes(), b'owned clone must survive host fixture seeding')
            self.assertEqual(guest.preservation_journal.NATS_WRITER_MARKER, writer)
            self.assertIs(guest.preservation_journal.capture_entrypoint_inventory, inventory)
            committed = require_committed(capture)
            self.assertEqual(committed['manifest']['data_volume_uuid'], UUID)
            with mock.patch('preservation_journal.NATS_ROOT_UID', os.getuid()):
                summary = stopped_journal_inputs.verify_stopped_journal(capture, seed, table=seeded['table'])
            self.assertEqual(summary['checkpoint_sha256'], seeded['checkpoint_sha256'])
            self.assertEqual(summary['pre_head'], seeded['pre_head'])
            self.assertEqual(summary['window'], 'window-1')
            held = wrapper.capture_locks(capture)
            for fd in held:
                os.close(fd)


class ReaderRun(unittest.TestCase):
    """Only the outer CI orchestration is scripted; ReaderProbe covers its real reader oracle."""

    def setUp(self):
        self.temp = pathlib.Path(tempfile.mkdtemp(prefix='openclaw-reader-run-')).resolve()
        self.addCleanup(shutil.rmtree, self.temp, True)
        self.output = self.temp / 'report.json'
        self.clean = {'clean': True, 'remaining': 0, 'disks_gone': [], 'mounted': [], 'steps': []}
        self.fixture = {'table': {'host': 'synthetic'}, 'data_volume_uuid': UUID,
                        'checkpoint_sha256': 'c' * 64, 'pre_head': 'd' * 64}

    def run_reader(self, fault=None, phase_error=None, cleanup=None, rmtree=None):
        read = []

        def command(*argv, **options):
            if argv[:3] == (DISKUTIL, 'image', 'create'):
                pathlib.Path(argv[-1]).write_bytes(b'owned scripted image')
            return {'returncode': 0, 'timed_out': False, 'stdout': b'scripted macOS', 'stderr': ''}

        def seed(image, temp, seed, capture, disks, case, row):
            row['seed_observation'] = case
            if phase_error:
                raise phase_error
            if case == 'intact':
                row['fixture'] = self.fixture

        def reader(capture, output, table, expected, row):
            read.append((output.name, table, expected))
            if fault == 'second-case' and len(read) == 2:
                raise RuntimeError('owned later read failure')
            row['receipt'] = {'reader': {key: self.fixture[key] for key in ('checkpoint_sha256', 'pre_head')}}
            if fault in ('checkpoint_sha256', 'pre_head'):
                row['receipt']['reader'][fault] = 'f' * 64

        def state(image):
            return {'sha256': '0' * 64, 'size': 20, 'ctime_ns': int(bool(read) and fault == 'image')}

        def pins(capture):
            return {'COMMITTED.json': b'changed' if read and fault == 'pins' else b'original'}

        with mock.patch.dict(os.environ, {'RUNNER_TEMP': str(self.temp)}), \
                mock.patch.object(probe, 'attempt', side_effect=command), \
                mock.patch.object(probe, 'reader_write_phase', side_effect=seed), \
                mock.patch.object(probe, 'reader_case', side_effect=reader), \
                mock.patch.object(probe, 'image_state', side_effect=state), \
                mock.patch('host_guest_commit.require_captured', side_effect=pins), \
                mock.patch('host_guest_commit.require_committed', return_value={'checkpoint': {}}), \
                mock.patch('host_vm_capture.publish_pinned_capture') as publish, \
                mock.patch.object(probe, 'release', return_value=cleanup or (self.clean, None)), \
                mock.patch.object(probe.shutil, 'rmtree', side_effect=rmtree or shutil.rmtree), \
                mock.patch('subprocess.run', side_effect=AssertionError('native command run')):
            code = probe.reader_run(self.output)
        return code, read, publish.call_args_list

    def report(self):
        return json.loads(self.output.read_bytes())

    def test_complete_reader_loop_checks_every_case_and_removes_only_its_directory(self):
        code, read, published = self.run_reader()
        self.assertEqual(code, 0)
        self.assertEqual(read, [('journal-read-' + name.replace('-', ''), self.fixture['table'], expected)
                                for name, expected in probe.READER_CASES])
        self.assertEqual(len(published), len(probe.READER_CASES))
        for call in published:
            self.assertEqual(call.args[1]['data_volume_uuid'], UUID)
            self.assertEqual(call.args[1]['clone_image_sha256'], '0' * 64)
            self.assertEqual(call.args[1]['clone_size'], 20)
        report = self.report()
        self.assertTrue(report['completed'] and report['cleanup']['clean'] and report['cleanup']['removed'])
        self.assertTrue(all(row['completed'] for row in report['cases'].values()))
        self.assertEqual([path.name for path in self.temp.iterdir()], ['report.json'])

    def test_changed_image_pins_or_either_verified_head_fail_the_outer_oracle(self):
        for fault, expected in (('image', 'reader changed image bytes or identity'),
                                ('pins', 'reader changed host commitment pins'),
                                ('checkpoint_sha256', 'reader verified another fixture'),
                                ('pre_head', 'reader verified another fixture')):
            with self.subTest(fault=fault):
                if self.output.exists():
                    self.output.unlink()
                code, read, _ = self.run_reader(fault=fault)
                self.assertEqual(code, 1)
                self.assertEqual(len(read), 1)
                report = self.report()
                self.assertFalse(report['completed'])
                self.assertIn(expected, report['error'])
                self.assertTrue(report['cleanup']['clean'])
                self.assertFalse(report['cleanup']['removed'])
                self.assertTrue(pathlib.Path(report['cleanup']['retained_directory']).is_dir())
                self.assertNotIn('completed', report['cases']['intact'])

    def test_seed_failure_keeps_its_partial_observation_and_reports_cleanup(self):
        code, read, _ = self.run_reader(phase_error=RuntimeError('owned seed failure'))
        report = self.report()
        self.assertEqual((code, read, report['completed']), (1, [], False))
        self.assertEqual(report['cases']['intact']['seed_observation'], 'intact')
        self.assertIn('owned seed failure', report['error'])
        self.assertFalse(report['cleanup']['removed'])

    def test_later_case_failure_preserves_earlier_rows_and_retains_the_owned_image(self):
        code, read, _ = self.run_reader(fault='second-case')
        report = self.report()
        self.assertEqual((code, len(read), report['completed']), (1, 2, False))
        self.assertTrue(report['cases']['intact']['completed'])
        self.assertEqual(report['cases']['corrupt-chain']['seed_observation'], 'corrupt-chain')
        self.assertNotIn('completed', report['cases']['corrupt-chain'])
        self.assertIn('owned later read failure', report['error'])
        self.assertFalse(report['cleanup']['removed'])
        retained = pathlib.Path(report['cleanup']['retained_directory'])
        self.assertEqual((retained / 'capture' / wrapper.CLONE).read_bytes(), b'owned scripted image')

    def test_unclean_cleanup_or_failed_removal_cannot_report_success(self):
        code, _, _ = self.run_reader(cleanup=({**self.clean, 'clean': False}, None))
        self.assertEqual(code, 1)
        self.assertFalse(self.report()['cleanup']['removed'])
        self.output.unlink()
        code, _, _ = self.run_reader(rmtree=OSError(errno.EBUSY, 'owned removal busy'))
        self.assertEqual(code, 1)
        self.assertIn('owned removal busy', self.report()['cleanup']['rmtree_error'])
        self.assertFalse(self.report()['cleanup']['removed'])

    def test_primary_interrupt_wins_and_cleanup_interrupt_after_success_is_raised(self):
        first, late = KeyboardInterrupt('owned phase'), KeyboardInterrupt('owned cleanup')
        for primary in (first, None):
            with self.subTest(primary=primary):
                if self.output.exists():
                    self.output.unlink()
                with self.assertRaises(KeyboardInterrupt) as raised:
                    self.run_reader(phase_error=primary, cleanup=({**self.clean, 'clean': False}, late))
                self.assertIs(raised.exception, primary or late)
                report = self.report()
                self.assertEqual(report['completed'], primary is None)
                self.assertFalse(report['cleanup']['removed'])
                if primary:
                    self.assertEqual(report['error'], repr(primary))


class ProbeRun(unittest.TestCase):
    """run(): handled cleanup failures are reported, cleanup interrupts raised, removal errors recorded."""

    def setUp(self):
        self.temp = pathlib.Path(tempfile.mkdtemp(prefix='openclaw-probe-run-')).resolve()
        self.addCleanup(shutil.rmtree, self.temp, True)
        self.output = self.temp / 'report.json'
        # run() makes its private directory under RUNNER_TEMP: here, so a kept one is cleaned up.
        environ = mock.patch.dict(os.environ, {'RUNNER_TEMP': str(self.temp)})
        environ.start()
        self.addCleanup(environ.stop)
        self.clean = {'steps': [], 'errors': [], 'listed': [], 'remaining': 0, 'mounted': [], 'disks_gone': [],
                      'clean': True}

    def run_probe(self, release, phase=None, rmtree=None, variant=None):
        def scripted(*argv, **options):
            if argv[:3] == (DISKUTIL, 'image', 'create'):
                pathlib.Path(argv[-1]).write_bytes(b'scripted image\n')
            return {'argv': list(argv), 'returncode': 0, 'timed_out': False, 'stdout': b'macOS', 'stderr': ''}

        with mock.patch.object(probe, 'attempt', side_effect=scripted), \
                mock.patch.object(probe, 'release', side_effect=release), \
                mock.patch.object(probe, 'image_state', return_value={}), \
                mock.patch.object(probe, 'write_phase', side_effect=phase), \
                mock.patch.object(probe, 'disable_ownership'), \
                mock.patch.object(probe, 'read_only_variant', side_effect=variant, return_value={}), \
                mock.patch.object(probe.shutil, 'rmtree', side_effect=rmtree or shutil.rmtree), \
                mock.patch('subprocess.run', side_effect=AssertionError('command run')):
            return probe.run(self.output)

    def report(self):
        return json.loads(self.output.read_bytes())

    def test_a_cleanup_interrupt_after_a_completed_run_is_raised_after_the_report(self):
        late = KeyboardInterrupt('during the final cleanup')
        with self.assertRaises(KeyboardInterrupt) as raised:
            self.run_probe(release=[({**self.clean, 'clean': False, 'steps': [{'interrupted': repr(late)}]}, late)])
        self.assertIs(raised.exception, late)
        report = self.report()
        self.assertEqual((report['completed'], report['cleanup']['clean'], 'error' in report), (True, False, False))
        # Not clean: the directory and its image are kept for the operator, never removed.
        kept = [path for path in self.temp.iterdir() if path.name.startswith('openclaw-asif-ownership-')]
        self.assertEqual((report['cleanup']['removed'], len(kept)), (False, 1))
        self.assertEqual(sorted(path.name for path in kept[0].iterdir()), ['probe.asif'])

    def test_a_phase_interrupt_takes_precedence_over_a_cleanup_interrupt(self):
        first, second = KeyboardInterrupt('first'), KeyboardInterrupt('second')
        with self.assertRaises(KeyboardInterrupt) as raised:
            self.run_probe(release=[({**self.clean, 'clean': False}, second)], phase=first)
        self.assertIs(raised.exception, first)
        self.assertEqual(self.report()['error'], repr(first))

    def test_a_failed_removal_is_recorded_and_the_report_still_written(self):
        code = self.run_probe(release=[(dict(self.clean), None)], rmtree=OSError(errno.EBUSY, 'scripted busy'))
        report = self.report()
        self.assertEqual((code, report['completed'], report['cleanup']['clean'], report['cleanup']['removed']),
                         (1, True, True, False))
        self.assertIn('scripted busy', report['cleanup']['rmtree_error'])

    def test_a_completed_clean_run_removes_its_directory_and_exits_zero(self):
        code = self.run_probe(release=[(dict(self.clean), None)])
        report = self.report()
        self.assertEqual((code, report['completed'], report['cleanup']['removed']), (0, True, True))
        self.assertEqual([path.name for path in self.temp.iterdir()], ['report.json'])

    def test_a_failed_variant_retains_its_partial_observations_and_cleanup(self):
        def variant(image, temp, name, options, disks, row):
            row.update({'stage': 'mount', 'attach': {'volume': '/dev/disk8s1'}, 'release': {'clean': True}})
            raise RuntimeError('native mount refused')
        code = self.run_probe(release=[(dict(self.clean), None)], variant=variant)
        report = self.report()
        self.assertEqual((code, report['completed'], report['cleanup']['removed']), (1, False, True))
        self.assertEqual(report['variants']['wrapper-options'], {
            'stage': 'mount', 'attach': {'volume': '/dev/disk8s1'}, 'release': {'clean': True}})
        self.assertIn('native mount refused', report['error'])


class ProbeGuards(unittest.TestCase):
    """The CI-only probe refuses everywhere else before running anything; it never runs here."""

    ENVIRON = {'CI': 'true', 'GITHUB_ACTIONS': 'true', 'OPENCLAW_OWNERSHIP_PROBE': '1'}

    def setUp(self):
        temp = pathlib.Path(tempfile.mkdtemp(prefix='openclaw-probe-guard-')).resolve()
        self.addCleanup(shutil.rmtree, temp)
        self.output = temp / 'report.json'
        self.argv = ['--ci-owned-probe', str(self.output)]

    def refuses(self, pattern, argv=None, environ=None, platform='darwin', sudo=0):
        sudo_row = {'argv': [], 'returncode': sudo, 'timed_out': False, 'stdout': b'', 'stderr': ''}
        with mock.patch.object(probe, 'attempt', return_value=sudo_row) as attempt, \
                mock.patch.object(probe.os, 'getuid', return_value=501), \
                mock.patch.object(probe.os, 'geteuid', return_value=501), \
                mock.patch('subprocess.run', side_effect=AssertionError('command run')):
            with self.assertRaisesRegex(RuntimeError, pattern):
                probe.guard(self.argv if argv is None else argv,
                            self.ENVIRON if environ is None else environ, platform)
        self.assertFalse(os.path.lexists(self.output))
        return attempt

    def test_every_guard_refuses_before_any_command(self):
        for environ, pattern in (({**self.ENVIRON, 'CI': ''}, 'only on a GitHub Actions runner'),
                                 ({**self.ENVIRON, 'GITHUB_ACTIONS': 'false'}, 'only on a GitHub Actions runner'),
                                 ({key: value for key, value in self.ENVIRON.items()
                                   if key != 'OPENCLAW_OWNERSHIP_PROBE'}, 'OPENCLAW_OWNERSHIP_PROBE=1 is required')):
            with self.subTest(pattern, environ=environ):
                self.assertFalse(self.refuses(pattern, environ=environ).called)
        with self.subTest('platform'):
            self.assertFalse(self.refuses('^the ownership probe runs only on macOS$', platform='linux').called)
        for argv in ([], [str(self.output)], ['--ci-owned-probe'], ['--probe', str(self.output)],
                     self.argv + ['extra']):
            with self.subTest(argv=argv):
                self.assertFalse(self.refuses('^usage: ', argv=argv).called)
        self.output.write_bytes(b'')
        for argv in (self.argv, ['--ci-owned-probe', 'relative.json'],
                     ['--ci-owned-probe', str(self.output.parent / 'missing' / 'report.json')]):
            with self.subTest(argv=argv):
                with mock.patch('subprocess.run', side_effect=AssertionError('command run')):
                    with self.assertRaisesRegex(RuntimeError, '^probe output must be a new file in an existing '):
                        probe.guard(argv, self.ENVIRON, 'darwin')
        self.output.unlink()
        with self.subTest('sudo'):
            attempt = self.refuses('^passwordless sudo is required$', sudo=1)
            attempt.assert_called_once_with('/usr/bin/sudo', '-n', '/usr/bin/true')

    def test_the_guarded_path_is_returned_only_when_every_guard_holds(self):
        sudo_row = {'argv': [], 'returncode': 0, 'timed_out': False, 'stdout': b'', 'stderr': ''}
        with mock.patch.object(probe, 'attempt', return_value=sudo_row), \
                mock.patch.object(probe.os, 'getuid', return_value=501), \
                mock.patch.object(probe.os, 'geteuid', return_value=501):
            self.assertEqual(probe.guard(self.argv, self.ENVIRON, 'darwin'), self.output)

    def test_root_runner_refuses_before_sudo_for_both_native_modes(self):
        for mode in ('--ci-owned-probe', '--ci-owned-reader'):
            for uid, euid in ((0, 0), (501, 0)):
                with self.subTest(mode=mode, uid=uid, euid=euid), \
                        mock.patch.object(probe.os, 'getuid', return_value=uid), \
                        mock.patch.object(probe.os, 'geteuid', return_value=euid), \
                        mock.patch.object(probe, 'attempt') as attempt:
                    with self.assertRaisesRegex(RuntimeError, '^the ownership probe requires a non-root runner$'):
                        probe.guard([mode, str(self.output)], self.ENVIRON, 'darwin')
                    attempt.assert_not_called()
                    self.assertFalse(self.output.exists())

    def test_reader_mode_has_the_same_guards_and_dispatches_only_after_them(self):
        argv = ['--ci-owned-reader', str(self.output)]
        sudo_row = {'returncode': 0, 'timed_out': False, 'stdout': b'', 'stderr': ''}
        native_guard = probe.guard
        with mock.patch.object(probe, 'attempt', return_value=sudo_row), \
                mock.patch.object(probe.os, 'getuid', return_value=501), \
                mock.patch.object(probe.os, 'geteuid', return_value=501), \
                mock.patch.object(probe, 'reader_run', return_value=0) as reader, \
                mock.patch.object(probe, 'run', side_effect=AssertionError('ownership mode run')), \
                mock.patch.object(probe, 'guard', side_effect=lambda args, env: native_guard(args, env, 'darwin')):
            with self.assertRaisesRegex(RuntimeError, 'only on a GitHub Actions runner'):
                probe.main(argv, {})
            reader.assert_not_called()
            self.assertEqual(probe.main(argv, self.ENVIRON), 0)
            reader.assert_called_once_with(self.output)

    def test_main_on_this_host_refuses_without_running(self):
        if sys.platform == 'darwin':
            self.skipTest('the platform guard is the one this test exercises')
        with mock.patch('subprocess.run', side_effect=AssertionError('command run')):
            with self.assertRaisesRegex(RuntimeError, '^the ownership probe runs only on macOS$'):
                probe.main(self.argv, self.ENVIRON)
        self.assertFalse(os.path.lexists(self.output))

    def test_an_interrupted_probe_still_releases_writes_its_report_and_reraises(self):
        interrupt = KeyboardInterrupt('during create')
        commands = []

        def scripted(*argv, **options):
            commands.append(list(argv))
            if argv[:3] == (wrapper.DISKUTIL, 'image', 'create'):
                raise interrupt
            return {'argv': list(argv), 'returncode': 0, 'timed_out': False, 'stdout': b'macOS', 'stderr': ''}

        released = {'steps': [], 'errors': [], 'remaining': 0, 'mounted': [], 'clean': True}
        with mock.patch.object(probe, 'attempt', side_effect=scripted), \
                mock.patch.object(probe, 'release', return_value=(released, None)) as release, \
                mock.patch('subprocess.run', side_effect=AssertionError('command run')):
            with self.assertRaises(KeyboardInterrupt) as raised:
                probe.run(self.output)
        self.assertIs(raised.exception, interrupt)
        self.assertEqual([argv[:3] for argv in commands], [['/usr/bin/sw_vers'], [wrapper.DISKUTIL, 'image', 'create']])
        release.assert_called_once()
        report = json.loads(self.output.read_bytes())
        self.assertEqual((report['completed'], report['error'], report['cleanup']['removed']),
                         (False, repr(interrupt), True))

    def test_flag_names_decode_the_wrapper_flags(self):
        self.assertEqual(probe.flag_names(FLAGS), ['rdonly', 'noexec', 'nosuid', 'nodev', 'dontbrowse'])
        self.assertEqual(probe.flag_names(wrapper.MNT_IGNORE_OWNERSHIP | 0x10000000 | 0x800),
                         ['ignore_ownership', 'noatime', '0x800'])
        self.assertEqual(probe.MOUNT_OPTIONS, wrapper.MOUNT_OPTIONS)


if __name__ == '__main__':
    unittest.main()
