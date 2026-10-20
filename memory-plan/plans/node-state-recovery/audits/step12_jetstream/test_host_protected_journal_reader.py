import ast
import contextlib
import copy
import ctypes
import fcntl
import hashlib
import json
import os
import pathlib
import shutil
import stat
import sys
import tempfile
import types
import unittest
from unittest import mock

import host_capture_anchor as anchor
import host_guest_commit as commit
import host_journal_mount as mount
import host_protected_journal_reader as reader
import preservation_journal as journal
import stopped_journal_inputs as stopped
from test_host_capture_anchor import selected_entry
from test_host_journal_mount import MountCase
from test_stopped_journal_inputs import window_dir


class Protected(MountCase):
    def setUp(self):
        super().setUp()
        parent = self.temp.resolve() / 'openclaw-acceptance-input-q'
        parent.mkdir(mode=0o700)
        target = parent / 'capture'
        self.capture.rename(target)
        self.capture = target
        self.root_store = self.temp.resolve() / 'openclaw-acceptance-owned-q'
        self.root_store.mkdir(mode=0o700)
        self.nonce = self.commitment['capture_nonce']
        self.uid = os.getuid()
        self.capture_uid = self.guest_uid = self.writer_uid = self.uid
        self.pending, self.final, self.staged = (self.root_store / name for name in reader.names(self.nonce))
        self.authority = {'program_sha256': 'a' * 64, 'root_path': str(self.root_store)}
        directory, read_input = anchor.Directory, anchor.Input
        held_snapshot = anchor.held_snapshot
        copy_shape = reader.copy_shape
        checked_copy = reader.checked_copy

        def root_directory(path, owners, private=True):
            if pathlib.Path(path) == self.root_store or self.root_store in pathlib.Path(path).parents:
                self.assertEqual(owners, {0})
                owners = {0, self.uid}
            return directory(path, owners, private)

        def root_input(directory, name, owner, **options):
            if directory.path == self.root_store or self.root_store in directory.path.parents:
                self.assertEqual(owner, 0)
                owner = self.uid
            return read_input(directory, name, owner, **options)

        @contextlib.contextmanager
        def capture_inputs(path, capture_uid, nonce):
            self.assertEqual(capture_uid, self.capture_uid)
            with held_snapshot(path, self.uid, nonce) as held:
                held['value']['writer_uid'] = capture_uid
                yield held

        def copied(source, directory, name):
            self.assertEqual(os.fstat(source).st_ino, (self.capture / anchor.CLONE).stat().st_ino)
            self.assertTrue(self.locks_held())
            self.held_source = source
            self.fake.clone = self.pending / name
            os.lseek(source, 0, os.SEEK_SET)
            raw = os.read(source, 1 << 20)
            self.fake.clone.write_bytes(raw)
            self.fake.clone.chmod(0o600)

        def owner_shape(a, info, device, size, attributes):
            return copy_shape(a, types.SimpleNamespace(**{**{key: getattr(info, key) for key in
                    ('st_mode', 'st_nlink', 'st_dev', 'st_size')}, 'st_uid': 0,
                    'st_flags': getattr(info, 'st_flags', 0)}), device, size, attributes)

        def copied_metadata(*args):
            return {**checked_copy(*args), 'uid': 0}

        self.read_hooks = []
        actual_reader = stopped.verify_stopped_bytes

        def semantic(files, root, *, owner, writer_uid):
            for hook in self.read_hooks:
                hook()
            if self.uid_roles:
                self.semantic_arguments = (owner, writer_uid)
                owner = writer_uid = self.uid
            result = actual_reader(files, root, owner=owner, writer_uid=writer_uid)
            return self.fake.summary_change(result) if self.fake.summary_change else result

        self.uid_roles = False
        self.runtime_check = mock.Mock(return_value={'program_sha256': 'a' * 64})
        self.code = {'modules': {'host_journal_mount': mount, 'host_guest_commit': commit,
                               'stopped_journal_inputs': stopped, 'host_protected_journal_reader': reader,
                               'preservation_journal': journal},
                     'hashes': {'owned.py': 'b' * 64}, 'authority': self.runtime_check.return_value,
                     'check': self.runtime_check}

        @contextlib.contextmanager
        def loaded_code(_release):
            yield self.code

        for patch in (mock.patch.object(anchor, 'entry', return_value=self.authority),
                      mock.patch.object(anchor, 'approved_entry', side_effect=selected_entry(anchor)),
                      mock.patch.object(anchor, 'no_acl'),
                      mock.patch.object(anchor, 'Directory', side_effect=root_directory),
                      mock.patch.object(anchor, 'Input', side_effect=root_input),
                      mock.patch.object(anchor, 'held_snapshot', side_effect=capture_inputs),
                      mock.patch.object(anchor, 'reader_code', side_effect=loaded_code),
                      mock.patch.object(reader, 'clone_fd', side_effect=copied),
                      mock.patch.object(reader, 'copy_shape', side_effect=owner_shape),
                      mock.patch.object(reader, 'checked_copy', side_effect=copied_metadata),
                      mock.patch.object(stopped, 'verify_stopped_bytes', side_effect=semantic)):
            patch.start()
            self.addCleanup(patch.stop)
        anchor.publish(self.root_store, self.capture, self.uid, self.nonce, release_manifest='/fixture-manifest', release_sha256='a' * 64, fixture=True)
        anchor.entry.reset_mock()

    def read_image(self):
        return anchor.reader_action(self.root_store, self.capture, self.capture_uid, self.nonce,
                                    self.guest_uid, self.writer_uid, release_manifest='/fixture-manifest', release_sha256='a' * 64, fixture=True)

    def receipt(self):
        return anchor.reader_action(self.root_store, self.capture, self.capture_uid, self.nonce,
                                    self.guest_uid, self.writer_uid, release_manifest='/fixture-manifest', release_sha256='a' * 64, fixture=True, receipt=True)

    def failure(self, message):
        with self.assertRaisesRegex((RuntimeError, stopped.Refused, OSError), message):
            self.read_image()
        self.assertFalse(self.final.exists())
        return json.loads((self.pending / 'FAILED.json').read_bytes()) if self.pending.exists() else None

    def test_actual_semantic_reader_and_cleanup_feed_reopened_protected_receipt(self):
        value = self.read_image()
        self.assertEqual(value, self.receipt())
        self.assertEqual(value['reader']['checkpoint_sha256'], self.record['sha256'])
        self.assertEqual(value['reader']['pre_head'], self.commitment['manifest']['journal_head'])
        self.assertTrue(value['reader']['read'])
        self.assertTrue(value['cleanup']['clean'])
        self.assertEqual(value['copy']['sha256'], hashlib.sha256(self.clone_bytes).hexdigest())
        self.assertEqual(value['owner_context'], reader.context(self.uid, self.uid, self.uid))
        self.assertFalse(self.pending.exists())
        self.assertFalse(self.staged.exists())
        self.assertEqual((self.fake.attached, self.fake.mounted), ([], None))
        self.assertTrue(all(call[-1] != str(self.capture / anchor.CLONE)
                            for call in self.calls(mount.DISKUTIL, 'image', 'attach')))

    def test_locks_and_source_descriptor_live_through_publication(self):
        original = reader.write_file
        observed = []
        def write(a, directory, name, value):
            if name.endswith('.read-staged'):
                self.assertTrue(self.locks_held())
                self.assertEqual(os.fstat(self.held_source).st_ino, (self.capture / anchor.CLONE).stat().st_ino)
                fd = os.open(self.root_store, os.O_RDONLY | os.O_DIRECTORY)
                try:
                    with self.assertRaises(BlockingIOError):
                        fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
                finally:
                    os.close(fd)
                observed.append(True)
            return original(a, directory, name, value)
        with mock.patch.object(reader, 'write_file', side_effect=write):
            self.read_image()
        self.assertEqual(observed, [True])
        self.assertFalse(self.locks_held())
        with self.assertRaises(OSError):
            os.fstat(self.held_source)

    def test_three_uid_roles_are_passed_without_swaps_or_current_uid_fallbacks(self):
        self.capture_uid, self.guest_uid, self.writer_uid = 111, 222, 333
        self.uid_roles = True
        path = self.root_store / (self.nonce + '.json')
        value = json.loads(path.read_bytes())
        path.write_bytes(anchor.encoded({**value, 'writer_uid': self.capture_uid}))
        result = self.read_image()
        anchor.entry.assert_called_once_with(self.root_store, self.capture, 111, self.nonce, True)
        self.assertEqual(self.semantic_arguments, (222, 333))
        self.assertEqual(result['owner_context'], {'capture_uid': 111, 'guest_uid': 222, 'writer_uid': 333})

    def test_anchor_mismatch_refuses_before_pending_or_clone(self):
        path = self.root_store / (self.nonce + '.json')
        value = json.loads(path.read_bytes())
        path.write_bytes(anchor.encoded({**value, 'capture_path': '/other-owned-capture'}))
        self.failure('protected capture byte anchor differs')
        reader.clone_fd.assert_not_called()
        self.assertFalse(self.pending.exists())

    def test_busy_capture_lock_refuses_before_pending(self):
        with (self.capture / 'CAPTURE_ACTIVE.lock').open('rb') as handle:
            fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
            self.failure('temporarily unavailable')
        self.assertFalse(self.pending.exists())

    def test_anchor_pending_and_existing_reader_state_refuse_before_native_actions(self):
        for path, kind in ((self.root_store / (self.nonce + '.pending'), 'file'),
                           (self.pending, 'dir'), (self.final, 'file'), (self.staged, 'file')):
            with self.subTest(path=path):
                path.mkdir() if kind == 'dir' else path.write_bytes(b'pending')
                with self.assertRaisesRegex(RuntimeError, 'incomplete|already exists'):
                    self.read_image()
                path.rmdir() if kind == 'dir' else path.unlink()
        reader.clone_fd.assert_not_called()

    def test_wrong_guest_or_writer_context_refuses_without_receipt(self):
        self.guest_uid = self.uid + 1
        failure = self.failure('not owner-private')
        self.assertTrue(failure['cleanup']['clean'])
        self.assertTrue(self.pending.exists())
        with self.assertRaisesRegex(RuntimeError, 'incomplete'):
            self.receipt()
        with self.assertRaisesRegex(RuntimeError, 'already exists'):
            self.read_image()

    def test_wrong_writer_context_refuses(self):
        self.writer_uid = self.uid + 1
        self.assertTrue(self.failure('lacks writer exclusion')['cleanup']['clean'])

    def test_corrupt_chain_is_refused_by_the_actual_shared_reader(self):
        path = window_dir(self.data) / '000000.json'
        path.write_bytes(path.read_bytes().replace(b'boot-a', b'boot-b'))
        self.assertTrue(self.failure('journal chain differs')['cleanup']['clean'])

    def test_source_replacement_during_read_refuses_after_clean_release(self):
        path = self.capture / anchor.CLONE
        def replace():
            path.rename(path.with_suffix('.aside'))
            path.write_bytes(self.clone_bytes)
            path.chmod(0o600)
        self.read_hooks.append(replace)
        self.failure('changed or was replaced')
        self.assertEqual((self.fake.attached, self.fake.mounted), ([], None))

    def test_bad_copy_bytes_refuse_before_attach(self):
        copied = reader.clone_fd.side_effect
        def corrupt(*args):
            copied(*args)
            self.fake.clone.write_bytes(b'X' * len(self.clone_bytes))
        with mock.patch.object(reader, 'clone_fd', side_effect=corrupt):
            self.failure('copy shape differs|copy hash differs')
        self.assertFalse(self.calls(mount.DISKUTIL, 'image', 'attach'))

    def test_post_read_copy_change_refuses(self):
        self.fake.during_eject.append(lambda: self.fake.clone.write_bytes(self.clone_bytes))
        self.failure('changed or was replaced')
        self.assertEqual((self.fake.attached, self.fake.mounted), ([], None))

    def test_read_outside_mount_and_wrong_commitment_refuse(self):
        self.fake.summary_change = lambda value: {**value, 'pre_head': 'f' * 64}
        self.failure('another commitment')
        self.assertEqual((self.fake.attached, self.fake.mounted), ([], None))

    def test_changed_mount_refuses(self):
        self.read_hooks.append(lambda: self.fake.statfs_changes.update(flags=0))
        self.failure('mount is not|mount changed')
        self.assertEqual((self.fake.attached, self.fake.mounted), ([], None))

    def test_failed_attach_result_is_retained_for_cleanup(self):
        self.fake.attach = 'fail-applied'
        failure = self.failure('read-only attach failed')
        self.assertTrue(failure['cleanup']['clean'])
        self.assertTrue(any(row['step'] == 'attach result disk after eject' for row in failure['cleanup']['steps']))

    def test_primary_semantic_failure_survives_cleanup_refusal(self):
        self.fake.eject_failures = 3
        self.guest_uid = self.uid + 1
        failure = self.failure('not owner-private')
        self.assertFalse(failure['cleanup']['clean'])

    def test_cleanup_failure_never_publishes_a_receipt(self):
        self.fake.eject_failures = 3
        self.assertFalse(self.failure('cleanup did not complete')['cleanup']['clean'])

    def test_publication_failure_keeps_pending_and_prevents_receipt_consumption(self):
        original = reader.write_file
        def write(a, directory, name, value):
            if name.endswith('.read-staged'):
                raise OSError('owned publication refusal')
            return original(a, directory, name, value)
        with mock.patch.object(reader, 'write_file', side_effect=write):
            self.failure('owned publication refusal')
        self.assertTrue(self.pending.exists())
        with self.assertRaisesRegex(RuntimeError, 'incomplete'):
            self.receipt()

    def test_receipt_rechecks_anchor_and_owner_context(self):
        self.read_image()
        self.guest_uid += 1
        with self.assertRaisesRegex(RuntimeError, 'binding differs'):
            self.receipt()

    def test_receipt_requires_each_protected_binding(self):
        self.read_image()
        original = self.final.read_bytes()
        anchored = self.root_store / (self.nonce + '.json')
        anchor_raw = anchored.read_bytes()
        cases = {'scope': 'wrong scope', 'capture_nonce': 'f' * 64,
                 'owner_context': {'capture_uid': -1}, 'anchor_sha256': 'f' * 64,
                 'files': {}, 'authority': {}, 'code_sha256': {},
                 'cleanup': {'clean': False}, 'copy_removed': False, 'anchor_authority': None}
        for name, replacement in cases.items():
            with self.subTest(binding=name):
                value = json.loads(original)
                if name == 'anchor_authority':
                    changed = {**json.loads(anchor_raw), 'authority': {}}
                    raw = anchor.encoded(changed)
                    anchored.write_bytes(raw)
                    value['anchor_sha256'] = anchor.sha(raw)
                else:
                    value[name] = replacement
                self.final.write_bytes(anchor.encoded(value))
                with self.assertRaisesRegex(RuntimeError, 'binding differs'):
                    self.receipt()
                anchored.write_bytes(anchor_raw)
                self.final.write_bytes(original)
        self.assertEqual(self.receipt(), json.loads(original))

    def test_receipt_runtime_is_rechecked(self):
        self.read_image()
        self.runtime_check.return_value = {'program_sha256': 'changed'}
        with self.assertRaisesRegex(RuntimeError, 'reader runtime changed'):
            self.receipt()

    def test_receipt_with_pending_is_not_consumed(self):
        self.read_image()
        self.pending.mkdir(mode=0o700)
        with self.assertRaisesRegex(RuntimeError, 'publication is incomplete'):
            self.receipt()

    def test_capture_scope_helper_is_shared_and_rejects_before_pending(self):
        path = self.capture / 'CAPTURE.json'
        value = json.loads(path.read_bytes())
        path.write_bytes(anchor.encoded({**value, 'scope': 'wrong scope'}))
        (self.root_store / (self.nonce + '.json')).unlink()
        anchor.publish(self.root_store, self.capture, self.uid, self.nonce, release_manifest='/fixture-manifest', release_sha256='a' * 64, fixture=True)
        self.failure('not a completed stopped-VM capture')
        self.assertFalse(self.pending.exists())
        reader.clone_fd.assert_not_called()

    def test_read_device_binding_is_required(self):
        self.fake.summary_change = lambda value: {**value, 'read': [{**row, 'device': -1} for row in value['read']]}
        self.failure('outside the verified mount')
        self.assertEqual((self.fake.attached, self.fake.mounted), ([], None))

    def test_runtime_is_rechecked_before_first_attach(self):
        original = reader.clone_fd.side_effect
        def copied(*args):
            original(*args)
            self.runtime_check.return_value = {'program_sha256': 'changed'}
        with mock.patch.object(reader, 'clone_fd', side_effect=copied):
            self.failure('reader runtime changed')
        self.assertFalse(self.calls(mount.DISKUTIL, 'image', 'attach'))

    def test_final_runtime_check_is_required(self):
        original = reader.write_file
        def write(a, directory, name, value):
            result = original(a, directory, name, value)
            if name.endswith('.read-staged'):
                self.runtime_check.return_value = {'program_sha256': 'changed'}
            return result
        with mock.patch.object(reader, 'write_file', side_effect=write):
            self.failure('reader runtime changed')
        self.assertTrue(self.pending.exists())

    def test_one_read_per_nonce_and_no_success_receipt_overwrite(self):
        self.read_image()
        raw = self.final.read_bytes()
        with self.assertRaises((RuntimeError, OSError)):
            self.read_image()
        self.assertEqual(reader.clone_fd.call_count, 1)
        self.assertEqual(self.final.read_bytes(), raw)



class Shape(unittest.TestCase):
    def test_root_copy_shape_rejects_each_wrong_field_and_xattrs(self):
        fields = {'st_mode': stat.S_IFREG | 0o600, 'st_uid': 0, 'st_nlink': 1,
                  'st_dev': 7, 'st_size': 4096, 'st_flags': 0}
        reader.copy_shape(anchor, types.SimpleNamespace(**fields), 7, 4096, ())
        for key, value in (('st_mode', stat.S_IFIFO | 0o600), ('st_mode', stat.S_IFREG | 0o644),
                           ('st_uid', 501), ('st_nlink', 2), ('st_dev', 8), ('st_size', 1), ('st_flags', 2)):
            with self.subTest(key=key):
                with self.assertRaisesRegex(RuntimeError, 'copy shape differs'):
                    reader.copy_shape(anchor, types.SimpleNamespace(**{**fields, key: value}), 7, 4096, ())
        with self.assertRaisesRegex(RuntimeError, 'copy shape differs'):
            reader.copy_shape(anchor, types.SimpleNamespace(**fields), 7, 4096, ('owned-unexpected',))

    def test_native_clone_uses_only_descriptors_and_no_owner_copy_flag(self):
        function = mock.Mock(return_value=0)
        with mock.patch.object(reader.sys, 'platform', 'darwin'), \
             mock.patch.object(reader.ctypes, 'CDLL', return_value=types.SimpleNamespace(fclonefileat=function)):
            reader.clone_fd(41, 73, 'powered-off-image.asif')
        function.assert_called_once_with(41, 73, b'powered-off-image.asif', 2)
        function.return_value = -1
        with mock.patch.object(reader.sys, 'platform', 'darwin'), \
             mock.patch.object(reader.ctypes, 'CDLL', return_value=types.SimpleNamespace(fclonefileat=function)):
            with self.assertRaises(OSError):
                reader.clone_fd(41, 73, 'powered-off-image.asif')

    def test_probe_progress_report_keeps_the_last_complete_snapshot_on_interruption(self):
        import probe_host_protected_journal_reader as probe
        with tempfile.TemporaryDirectory(prefix='openclaw-q-report-') as temp:
            output = pathlib.Path(temp) / 'report.json'
            report = {'completed': False, 'cleanup': {'clean': False, 'removed': False},
                      'cases': [{'case': 'intact'}], 'active_case': 'wrong-guest'}
            probe.write_report(output, report)
            previous = output.read_bytes()
            self.assertEqual(json.loads(previous), report)
            self.assertEqual(stat.S_IMODE(output.stat().st_mode), 0o644)
            self.assertFalse(output.with_name(output.name + '.next').exists())
            with mock.patch.object(probe.os, 'replace', side_effect=OSError('owned interrupted publish')):
                with self.assertRaisesRegex(OSError, 'interrupted publish'):
                    probe.write_report(output, {**report, 'cases': report['cases'] + [{'case': 'wrong-guest'}]})
            self.assertEqual(output.read_bytes(), previous)
            self.assertFalse(json.loads(output.read_bytes())['completed'])
            output.with_name(output.name + '.next').unlink()
            final = {**report, 'completed': True, 'active_case': None,
                     'cleanup': {'clean': True, 'removed': True}}
            probe.write_report(output, final)
            self.assertEqual(json.loads(output.read_bytes()), final)

    def test_native_probe_guards_refuse_without_any_command_or_open(self):
        import probe_host_protected_journal_reader as probe
        with mock.patch.object(probe.subprocess, 'run', side_effect=AssertionError('native command attempted')):
            with self.assertRaisesRegex(RuntimeError, 'CI-only macOS root'):
                probe.main('/unopened')
            with mock.patch.object(probe.sys, 'platform', 'darwin'), \
                 mock.patch.object(probe.os, 'getuid', return_value=0), \
                 mock.patch.object(probe.os, 'geteuid', return_value=0), \
                 mock.patch.dict(probe.os.environ, {'CI': 'true', 'GITHUB_ACTIONS': 'true',
                    'OPENCLAW_PROTECTED_READER_PROBE': '1', 'SUDO_UID': '0', 'SUDO_GID': '0'}, clear=True):
                with self.assertRaisesRegex(RuntimeError, 'distinct nonroot'):
                    probe.main('/unopened')

    def test_python39_sources_and_strict_reader_uid_argv(self):
        for path in (anchor.__file__, reader.__file__):
            ast.parse(pathlib.Path(path).read_text(), feature_version=(3, 9))
        import subprocess
        for uid in ('-1', '01', ' 1', '1.0', 'True', '+1', ''):
            done = subprocess.run([sys.executable, anchor.__file__, '--ci-owned', 'read',
                                   '/owned', '/input', '501', 'a' * 64, uid, '0', '/manifest', 'b' * 64],
                                  env={**os.environ, 'CI': 'true', 'GITHUB_ACTIONS': 'true'},
                                  capture_output=True, text=True, timeout=10)
            self.assertNotEqual(done.returncode, 0)
            self.assertIn('decimal owner context is invalid', done.stderr)

    def test_native_descriptor_xattr_reader_bounds_and_errors(self):
        function = mock.Mock(return_value=0)
        with mock.patch.object(reader.sys, 'platform', 'darwin'), \
             mock.patch.object(reader.ctypes, 'CDLL', return_value=types.SimpleNamespace(flistxattr=function)):
            self.assertEqual(reader.xattrs(42), ())
            function.assert_called_once_with(42, None, 0, 0)
            function.return_value = 4097
            with self.assertRaisesRegex(RuntimeError, 'exceed bound'):
                reader.xattrs(42)
            function.return_value = -1
            with self.assertRaises(OSError):
                reader.xattrs(42)
            def read(fd, buffer, size, options):
                self.assertEqual((fd, options), (42, 0))
                raw = b'owned-test\0'
                if buffer is None:
                    return len(raw)
                ctypes.memmove(buffer, raw, len(raw))
                return len(raw)
            function.side_effect = read
            self.assertEqual(reader.xattrs(42), ('owned-test',))

    def test_shared_capture_record_enforces_scope_fixture_and_uuid(self):
        value = {'scope': mount.CAPTURE_SCOPE, 'vm_state_at_final_check': 'stopped',
                 'vm_uuid': mount.FIXTURE_UUID, 'data_volume_uuid': 'owned-data'}
        commitment = {'started_sample': {'vm_uuid': mount.FIXTURE_UUID}}
        self.assertEqual(mount.capture_record(json.dumps(value).encode(), commitment), value)
        for field, bad, message in (('scope', 'wrong', 'not a completed'),
                                     ('vm_state_at_final_check', 'started', 'not a completed'),
                                     ('vm_uuid', 'other', 'not of the owned'),
                                     ('data_volume_uuid', '', 'names no Data volume')):
            with self.assertRaisesRegex(RuntimeError, message):
                mount.capture_record(json.dumps({**value, field: bad}).encode(), commitment)
        with self.assertRaisesRegex(RuntimeError, 'not of the owned'):
            mount.capture_record(json.dumps(value).encode(), {'started_sample': {'vm_uuid': 'different'}})

    def test_source_flags_and_xattrs_refuse(self):
        item = types.SimpleNamespace(fd=12, check=mock.Mock())
        for flags, attributes in ((2, ()), (0, ('unexpected',))):
            with mock.patch.object(reader.os, 'fstat', return_value=types.SimpleNamespace(st_flags=flags)), \
                 mock.patch.object(reader, 'xattrs', return_value=attributes):
                with self.assertRaisesRegex(RuntimeError, 'source image flags or xattrs differ'):
                    reader.source_shape(anchor, item)


if __name__ == '__main__':
    unittest.main()
