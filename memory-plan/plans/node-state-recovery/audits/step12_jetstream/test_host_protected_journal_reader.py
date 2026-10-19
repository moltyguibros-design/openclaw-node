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
        def loaded_code():
            yield self.code

        for patch in (mock.patch.object(anchor, 'entry', return_value=self.authority),
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
        anchor.publish(self.root_store, self.capture, self.uid, self.nonce, fixture=True)
        anchor.entry.reset_mock()

    def read_image(self):
        return anchor.reader_action(self.root_store, self.capture, self.capture_uid, self.nonce,
                                    self.guest_uid, self.writer_uid, fixture=True)

    def receipt(self):
        return anchor.reader_action(self.root_store, self.capture, self.capture_uid, self.nonce,
                                    self.guest_uid, self.writer_uid, fixture=True, receipt=True)

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
        anchor.publish(self.root_store, self.capture, self.uid, self.nonce, fixture=True)
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


class CodeClosure(unittest.TestCase):
    def setUp(self):
        self.uid = os.getuid()
        temp = tempfile.TemporaryDirectory(prefix='openclaw-q-code-',
                                           dir=pathlib.Path(os.environ.get('GITHUB_WORKSPACE', pathlib.Path.home())))
        self.addCleanup(temp.cleanup)
        self.path = pathlib.Path(temp.name).resolve()
        self.path.chmod(0o700)
        source = pathlib.Path(anchor.__file__).resolve().parent
        for name in (*anchor.READER_MODULES, 'host_capture_anchor'):
            path = self.path / (name + '.py')
            path.write_bytes(getattr(anchor, '_test_reader_sources', {}).get(
                path.name, (source / path.name).read_bytes()))
            path.chmod(0o600)
        self.a = types.ModuleType('host_capture_anchor')
        self.a.__file__ = str(self.path / 'host_capture_anchor.py')
        exec(compile(pathlib.Path(self.a.__file__).read_bytes(), self.a.__file__, 'exec'), self.a.__dict__)
        directory, read_input = self.a.Directory, self.a.Input
        def root_directory(path, owners, private=True):
            self.assertEqual(owners, {0})
            return directory(path, {0, self.uid}, private)
        self.held_sources = []
        def root_input(directory, name, owner, **options):
            self.assertEqual(owner, 0)
            item = read_input(directory, name, self.uid, **options)
            self.held_sources.append(item)
            return item
        for patch in (mock.patch.object(self.a, 'Directory', side_effect=root_directory),
                      mock.patch.object(self.a, 'Input', side_effect=root_input),
                      mock.patch.object(self.a, 'no_acl'),
                      mock.patch.object(self.a, 'trusted_runtime', return_value={'program_sha256': 'a' * 64})):
            patch.start()
            self.addCleanup(patch.stop)
        original_modules = {name: sys.modules.get(name) for name in (*anchor.READER_MODULES, 'host_capture_anchor')}
        original_path = list(sys.path)
        def restore():
            sys.path[:] = original_path
            for name, module in original_modules.items():
                if module is None:
                    sys.modules.pop(name, None)
                else:
                    sys.modules[name] = module
        self.addCleanup(restore)
        for name in anchor.READER_MODULES:
            sys.modules.pop(name, None)
        sys.modules['host_capture_anchor'] = self.a
        sys.path[:] = [path for path in original_path
                       if not (pathlib.Path(path) / 'host_guest_commit.py').exists()]
        self.original_paths = list(sys.path)

    def test_exact_closure_hashes_loaded_origins_and_source_fds_stay_pinned(self):
        with self.a.reader_code() as code:
            self.assertEqual(len(code['hashes']), 12)
            self.assertEqual(set(code['modules']), set(anchor.READER_MODULES))
            self.assertEqual(sys.path[:len(self.original_paths)], self.original_paths)
            self.assertEqual(sys.path[-1], str(self.path))
            self.assertEqual(code['check'](), code['authority'])
            held = []
            for item in self.a.Input.call_args_list:
                self.assertEqual(item.args[2], 0)
                held.append(item.args[1])
            self.assertEqual(set(held), set(code['hashes']))
            self.assertEqual(len(self.held_sources), 12)
            self.assertTrue(all(os.fstat(item.fd).st_ino == item.initial.st_ino for item in self.held_sources))
            self.assertIs(sys.modules['host_capture_anchor'], self.a)
            self.assertNotIn('host_capture_anchor', code['modules'])
        for item in self.held_sources:
            with self.assertRaises(OSError):
                os.fstat(item.fd)

    def test_extra_code_or_cache_entry_refuses_before_project_import(self):
        for name in ('unreviewed.py', '__pycache__', 'bytecode-disabled'):
            path = self.path / name
            path.write_bytes(b'extra')
            with self.assertRaisesRegex(RuntimeError, 'code directory entries differ'):
                with self.a.reader_code():
                    self.fail('extra code entry accepted')
            path.unlink()

    def test_wrong_preloaded_origin_refuses_before_importing_project_code(self):
        sys.modules['host_journal_mount'] = types.SimpleNamespace(__file__='/untrusted/module.py')
        with self.assertRaisesRegex(RuntimeError, 'preloaded from another origin'):
            with self.a.reader_code():
                self.fail('wrong preloaded origin accepted')

    def test_wrong_resolution_refuses_before_project_import(self):
        utility = types.SimpleNamespace(find_spec=mock.Mock(return_value=types.SimpleNamespace(origin='/other.py')))
        importer = mock.Mock(return_value=utility)
        with mock.patch.object(self.a.importlib, 'import_module', importer):
            with self.assertRaisesRegex(RuntimeError, 'import resolution differs'):
                with self.a.reader_code():
                    self.fail('wrong resolution accepted')
        importer.assert_called_once_with('importlib.util')

    def test_changed_source_mapping_refuses_before_receipt(self):
        with self.a.reader_code() as code:
            path = self.path / 'host_journal_mount.py'
            raw = path.read_bytes()
            path.rename(path.with_suffix('.aside'))
            path.write_bytes(raw)
            path.chmod(0o600)
            path.with_suffix('.aside').unlink()
            with self.assertRaisesRegex(RuntimeError, 'changed or was replaced'):
                code['check']()

    def test_source_digest_is_rechecked_not_just_metadata(self):
        with self.a.reader_code() as code:
            item = self.held_sources[0]
            raw, digest, size = b'owned', 'f' * 64, item.initial.st_size
            with mock.patch.object(item, 'read', return_value=(raw, digest, size)):
                with self.assertRaisesRegex(RuntimeError, 'reader source hash changed'):
                    code['check']()

    def test_changed_loaded_local_set_refuses(self):
        with self.a.reader_code() as code:
            previous = sys.modules['host_journal_mount'].__file__
            sys.modules['host_journal_mount'].__file__ = '/other/module.py'
            try:
                with self.assertRaisesRegex(RuntimeError, 'loaded local module set differs'):
                    code['check']()
            finally:
                sys.modules['host_journal_mount'].__file__ = previous

    def test_dispatch_passes_the_same_anchor_object_and_scrubs_child_environment(self):
        code = {'authority': {'program_sha256': 'a' * 64}, 'modules': {}}
        seen = []
        def operation(a, *args):
            self.assertIs(a, self.a)
            self.assertIs(sys.modules['host_capture_anchor'], a)
            self.assertEqual(dict(os.environ), {'PATH': '/usr/bin:/bin:/usr/sbin:/sbin', 'LC_ALL': 'C'})
            seen.append(a)
            return {'owned': True}
        code['modules']['host_protected_journal_reader'] = types.SimpleNamespace(read_image=operation)
        @contextlib.contextmanager
        def loaded():
            yield code
        before = dict(os.environ)
        with mock.patch.object(self.a, 'entry', return_value={'program_sha256': 'a' * 64}), \
             mock.patch.object(self.a, 'reader_code', side_effect=loaded):
            self.assertEqual(self.a.reader_action('/owned', '/input', 111, 'a' * 64, 222, 333, fixture=True),
                             {'owned': True})
        self.assertEqual(dict(os.environ), before)
        self.assertEqual(seen, [self.a])



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
                                   '/owned', '/input', '501', 'a' * 64, uid, '0'],
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
