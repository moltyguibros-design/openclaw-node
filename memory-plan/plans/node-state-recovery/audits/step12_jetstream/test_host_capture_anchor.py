import json
import ast
import contextlib
import subprocess
import py_compile
import sys
import tempfile
import os
import pathlib
import stat
import types
import unittest
from unittest import mock

import host_capture_anchor as anchor
import test_host_checkpoint_commit as fixture


def fixture_capture(case):
    source = fixture.HostCheckpoint('runTest')
    source.setUp()
    case.addCleanup(source.doCleanups)
    _output, error, _flow = fixture.CapturePin.captured(source)
    if error:
        raise error
    parent = source.temp / 'openclaw-acceptance-input-portable'
    parent.mkdir(mode=0o700)
    target = parent / 'capture'
    source.capture.rename(target)
    source.capture = target
    return source, target


class Anchor(unittest.TestCase):
    def setUp(self):
        self.source, self.capture = fixture_capture(self)
        self.root = self.source.temp / 'openclaw-acceptance-owned-portable'
        self.root.mkdir(mode=0o700)
        self.uid, self.nonce = os.getuid(), self.source.nonce
        self.final = self.root / (self.nonce + '.json')
        self.pending = self.root / (self.nonce + '.pending')
        original_directory, original_input = anchor.Directory, anchor.Input

        def directory(path, owners, private=True):
            if pathlib.Path(path) == self.root:
                self.assertEqual(owners, {0})
                owners = {0, self.uid}
            return original_directory(path, owners, private)

        def read_input(directory, name, owner):
            if directory.path == self.root:
                self.assertEqual(owner, 0)
                owner = self.uid
            return original_input(directory, name, owner)

        for patch in (mock.patch.object(anchor, 'entry', return_value={'program_sha256': 'a' * 64}),
                      mock.patch.object(anchor, 'no_acl'),
                      mock.patch.object(anchor, 'Directory', side_effect=directory),
                      mock.patch.object(anchor, 'Input', side_effect=read_input)):
            patch.start()
            self.addCleanup(patch.stop)

    def publish(self):
        return anchor.publish(self.root, self.capture, self.uid, self.nonce, fixture=True)

    def verify(self):
        return anchor.verify(self.root, self.capture, self.uid, self.nonce, fixture=True)

    def test_protected_record_is_reopened_and_fresh_inputs_compared(self):
        self.publish()
        self.assertIsNone(self.verify())
        value = json.loads(self.final.read_bytes())
        self.assertEqual(value['capture_nonce'], self.nonce)
        self.assertEqual(set(value['files']), {*anchor.FILES, anchor.CLONE})
        self.assertEqual(stat.S_IMODE(self.final.stat().st_mode), 0o600)
        self.assertEqual(self.final.stat().st_nlink, 1)
        self.assertFalse(self.pending.exists())
        self.final.unlink()
        with self.assertRaises(FileNotFoundError):
            self.verify()

    def test_coordinated_capture_and_clone_rewrite_refuses_the_protected_anchor(self):
        self.publish()
        clone = self.capture / anchor.CLONE
        clone.write_bytes(b'rewritten owned clone')
        path = self.capture / 'CAPTURE.json'
        value = json.loads(path.read_bytes())
        path.write_bytes(anchor.encoded({**value, 'clone_image_sha256': anchor.sha(clone.read_bytes()),
                                        'clone_size': clone.stat().st_size}))
        anchor.snapshot(self.capture, self.uid, self.nonce)
        fixture.host_guest_commit.require_captured(self.capture)
        fixture.require_committed(self.capture)
        with self.assertRaisesRegex(RuntimeError, 'protected capture byte anchor differs'):
            self.verify()

    def test_repin_and_overwrite_refuse_without_changing_original(self):
        self.publish()
        original = self.final.read_bytes()
        with self.assertRaises((RuntimeError, OSError)):
            self.publish()
        self.assertEqual(self.final.read_bytes(), original)
        self.assertFalse(self.pending.exists())

    def test_link_follows_file_and_directory_sync(self):
        synced, fsync, link = [], os.fsync, os.link

        def sync(fd):
            synced.append(os.fstat(fd).st_mode)
            return fsync(fd)

        def linked(*args, **kwargs):
            self.assertGreaterEqual(len(synced), 2)
            self.assertTrue(stat.S_ISREG(synced[0]))
            self.assertTrue(stat.S_ISDIR(synced[1]))
            return link(*args, **kwargs)

        with mock.patch.object(anchor.os, 'fsync', side_effect=sync), \
                mock.patch.object(anchor.os, 'link', side_effect=linked):
            self.publish()

    def test_interrupted_file_sync_leaves_only_pending_and_refuses_both_routes(self):
        with mock.patch.object(anchor.os, 'fsync', side_effect=OSError('owned sync interruption')):
            with self.assertRaisesRegex(OSError, 'owned sync interruption'):
                self.publish()
        self.assertTrue(self.pending.exists())
        self.assertFalse(self.final.exists())
        for method in (self.verify, self.publish):
            with self.assertRaisesRegex(RuntimeError, 'incomplete'):
                method()

    def test_interruption_after_link_keeps_pending_and_cannot_verify(self):
        with mock.patch.object(anchor.os, 'unlink', side_effect=OSError('owned unlink interruption')):
            with self.assertRaisesRegex(OSError, 'owned unlink interruption'):
                self.publish()
        self.assertTrue(self.final.exists())
        self.assertTrue(self.pending.exists())
        with self.assertRaisesRegex(RuntimeError, 'incomplete'):
            self.verify()

    def test_complete_publication_can_be_read_after_final_sync_interruption(self):
        original, calls = os.fsync, []

        def synced(fd):
            calls.append(fd)
            if len(calls) == 4:
                raise OSError('owned final sync interruption')
            return original(fd)

        with mock.patch.object(anchor.os, 'fsync', side_effect=synced):
            with self.assertRaisesRegex(OSError, 'owned final sync interruption'):
                self.publish()
        self.assertFalse(self.pending.exists())
        self.assertIsNone(self.verify())
        with self.assertRaisesRegex(RuntimeError, 'already exists'):
            self.publish()

    def test_record_nonce_directory_and_schema_are_compared(self):
        self.publish()
        original = self.final.read_bytes()
        for key, value in (('capture_nonce', '0' * 64), ('capture_inode', -1),
                           ('writer_uid', -1), ('scope', 'ACCEPTED'), ('extra', True)):
            with self.subTest(key=key):
                changed = {**json.loads(original), key: value}
                self.final.write_bytes(anchor.encoded(changed))
                with self.assertRaisesRegex(RuntimeError, 'protected capture byte anchor differs'):
                    self.verify()
        self.final.write_bytes(original)

    def test_partial_or_noncanonical_anchor_refuses(self):
        self.publish()
        for raw in (b'{', self.final.read_bytes() + b' '):
            self.final.write_bytes(raw)
            with self.assertRaises((RuntimeError, ValueError)):
                self.verify()

    def test_nonprivate_or_linked_input_refuses(self):
        path = self.capture / 'CAPTURE.json'
        alias = self.capture / 'alias'
        for kind in ('mode', 'link', 'symlink'):
            with self.subTest(kind=kind):
                if kind == 'mode':
                    path.chmod(0o644)
                elif kind == 'link':
                    os.link(path, alias)
                else:
                    path.rename(alias)
                    path.symlink_to(alias.name)
                try:
                    with self.assertRaises((RuntimeError, OSError)):
                        self.publish()
                    self.assertFalse(self.final.exists())
                finally:
                    if kind == 'mode':
                        path.chmod(0o600)
                    elif kind == 'link':
                        alias.unlink()
                    else:
                        path.unlink()
                        alias.rename(path)

    def test_descriptor_mapping_replacement_refuses_even_for_identical_bytes(self):
        directory = anchor.Directory(self.capture, {0, self.uid})
        self.addCleanup(directory.__exit__)
        with anchor.Input(directory, 'CAPTURE.json', self.uid) as item:
            path = self.capture / 'CAPTURE.json'
            raw = path.read_bytes()
            path.rename(self.capture / 'old-capture')
            fixture.write_private(path, raw)
            with self.assertRaisesRegex(RuntimeError, 'changed or was replaced'):
                item.read(True)

    def test_file_write_during_read_refuses(self):
        original, changed = anchor.os.read, []
        armed_inode = (self.capture / 'ARMED.json').stat().st_ino

        def read(fd, size):
            block = original(fd, size)
            if block and not changed and os.fstat(fd).st_ino == armed_inode:
                path = self.capture / 'ARMED.json'
                path.write_bytes(path.read_bytes())
                changed.append(True)
            return block

        with mock.patch.object(anchor.os, 'read', side_effect=read):
            with self.assertRaisesRegex(RuntimeError, 'changed or was replaced'):
                self.publish()

    def test_wrong_input_owner_refuses(self):
        with anchor.Directory(self.capture, {0, self.uid}) as directory:
            with self.assertRaisesRegex(RuntimeError, 'input owner, mode or links'):
                anchor.Input(directory, 'CAPTURE.json', self.uid + 1)

    def test_protected_record_metadata_and_links_are_checked(self):
        self.publish()
        self.final.chmod(0o644)
        with self.assertRaisesRegex(RuntimeError, 'input owner, mode or links'):
            self.verify()
        self.final.chmod(0o600)
        alias = self.root / 'alias'
        os.link(self.final, alias)
        with self.assertRaisesRegex(RuntimeError, 'input owner, mode or links'):
            self.verify()
        alias.unlink()
        self.final.rename(alias)
        self.final.symlink_to(alias.name)
        with self.assertRaises(OSError):
            self.verify()

    def test_capture_pin_and_nonce_changes_refuse_before_publication(self):
        cases = [('CAPTURE.json', key, '0' * 64, 'byte bindings') for key in anchor.PINS]
        for name, key, value, pattern in (*cases,
                ('ARMED.json', 'capture_nonce', '0' * 64, 'nonce'),
                ('CAPTURE.json', 'clone_image_sha256', '0' * 64, 'clone binding')):
            path = self.capture / name
            raw = path.read_bytes()
            with self.subTest(name=name, key=key):
                path.write_bytes(anchor.encoded({**json.loads(raw), key: value}))
                with self.assertRaisesRegex(RuntimeError, pattern):
                    self.publish()
                self.assertFalse(self.final.exists())
                path.write_bytes(raw)

    def test_operator_nonce_must_match_the_unchanged_capture(self):
        self.nonce = 'f' * 64 if self.nonce != 'f' * 64 else 'e' * 64
        with self.assertRaisesRegex(RuntimeError, 'nonce differs'):
            self.publish()

    def test_each_capture_byte_link_is_enforced(self):
        originals = {name: (self.capture / name).read_bytes() for name in anchor.FILES}
        edges = (('ARMED.json', 'window_pins_sha256', 'WINDOW_PINS.json'),
                 ('COMMITTED.json', 'arm_sha256', 'ARMED.json'),
                 ('ACKED.json', 'commit_sha256', 'COMMITTED.json'),
                 ('CHECKPOINT.json', 'commit_sha256', 'COMMITTED.json'),
                 ('CHECKPOINT.json', 'ack_sha256', 'ACKED.json'))
        targets = [(name, field, 'byte bindings differ') for name, field, _dependency in edges]
        for target, field, pattern in (*targets, ('ARMED.json', 'vm_uuid', 'fixture VM identity')):
            with self.subTest(target=target, field=field):
                values = {name: json.loads(raw) for name, raw in originals.items()}
                if field == 'vm_uuid':
                    values[target][field] = 'not-the-fixture'
                for name, key, dependency in edges:
                    values[name][key] = ('0' * 64 if (name, key) == (target, field)
                                         else anchor.sha(anchor.encoded(values[dependency])))
                for key, name in anchor.PINS.items():
                    values['CAPTURE.json'][key] = anchor.sha(anchor.encoded(values[name]))
                for name, value in values.items():
                    (self.capture / name).write_bytes(anchor.encoded(value))
                with self.assertRaisesRegex(RuntimeError, pattern):
                    self.publish()
                self.assertFalse(self.final.exists())

    def test_each_clone_and_fixture_claim_is_enforced(self):
        path, clone = self.capture / 'CAPTURE.json', self.capture / anchor.CLONE
        raw, clone_raw = path.read_bytes(), clone.read_bytes()
        for field, value, pattern in (('clone_size', len(clone_raw) + 1, 'clone binding'),
                ('vm_state_at_final_check', 'started', 'clone binding'),
                ('vm_uuid', 'not-the-fixture', 'fixture VM identity')):
            with self.subTest(field=field):
                path.write_bytes(anchor.encoded({**json.loads(raw), field: value}))
                with self.assertRaisesRegex(RuntimeError, pattern):
                    self.publish()
                self.assertFalse(self.final.exists())
        clone.write_bytes(b'x')
        path.write_bytes(anchor.encoded({**json.loads(raw), 'clone_size': True,
                                       'clone_image_sha256': anchor.sha(b'x')}))
        with self.assertRaisesRegex(RuntimeError, 'clone binding'):
            self.publish()

    def test_record_size_limit_precedes_json_read(self):
        path = self.capture / 'CAPTURE.json'
        path.write_bytes(b' ' * (anchor.LIMIT + 1))
        with self.assertRaisesRegex(RuntimeError, 'byte limit'):
            self.publish()

    def test_failed_capture_and_contended_capture_lock_refuse(self):
        failed = self.capture / 'FAILED.json'
        failed.write_bytes(b'failed')
        with self.assertRaisesRegex(RuntimeError, 'failed capture'):
            self.publish()
        failed.unlink()
        with (self.capture / 'CAPTURE_ACTIVE.lock').open('rb') as stream:
            anchor.fcntl.flock(stream.fileno(), anchor.fcntl.LOCK_EX | anchor.fcntl.LOCK_NB)
            with self.assertRaises(BlockingIOError):
                self.publish()
        self.assertFalse(self.final.exists())

    def test_fifo_refuses_without_waiting_for_a_writer(self):
        path = self.capture / 'CAPTURE.json'
        path.unlink()
        os.mkfifo(path, mode=0o600)
        with self.assertRaisesRegex(RuntimeError, 'input owner, mode or links'):
            self.publish()


class Authority(unittest.TestCase):
    def test_cache_policy_precedes_interpreter_use(self):
        with mock.patch.object(anchor.sys, 'flags', types.SimpleNamespace(isolated=True, no_site=True,
                                                                         dont_write_bytecode=True)), \
                mock.patch.object(anchor, 'trusted_path', return_value='a' * 64), \
                mock.patch.object(anchor, 'trusted_cache_prefix', side_effect=RuntimeError('absent bytecode prefix')), \
                mock.patch.object(anchor, 'trusted_interpreter') as runtime:
            with self.assertRaisesRegex(RuntimeError, 'absent bytecode prefix'):
                anchor.trusted_runtime()
            runtime.assert_not_called()

    def test_program_trust_failure_precedes_interpreter_use(self):
        with mock.patch.object(anchor.sys, 'flags', types.SimpleNamespace(isolated=True, no_site=True,
                                                                         dont_write_bytecode=True)), \
                mock.patch.object(anchor, 'trusted_path', side_effect=RuntimeError('program owner differs')), \
                mock.patch.object(anchor, 'trusted_interpreter', return_value={'interpreter': '/trusted'}) as runtime:
            with self.assertRaisesRegex(RuntimeError, 'program owner differs'):
                anchor.trusted_runtime()
            runtime.assert_not_called()

    def test_linux_access_and_default_acl_metadata_refuse(self):
        with mock.patch.object(anchor.sys, 'platform', 'linux'):
            for name in ('system.posix_acl_access', 'system.posix_acl_default'):
                with mock.patch.object(anchor.os, 'listxattr', return_value=[name], create=True):
                    with self.assertRaisesRegex(RuntimeError, 'has an ACL'):
                        anchor.no_acl(pathlib.Path('/owned'), 5)

    def test_interpreter_selection_refuses_when_every_existing_candidate_is_untrusted(self):
        import probe_host_capture_anchor as probe

        failure = types.SimpleNamespace(returncode=1, stdout='', stderr='untrusted interpreter')
        with mock.patch.object(probe.sys, 'platform', 'darwin'), \
                mock.patch.object(probe.pathlib.Path, 'is_file', return_value=True), \
                mock.patch.object(probe.subprocess, 'run', return_value=failure) as calls, \
                mock.patch('builtins.print'):
            with self.assertRaisesRegex(RuntimeError, 'no independently protected interpreter'):
                probe.select_interpreter(pathlib.Path(anchor.__file__))
            self.assertEqual(calls.call_count, 2)
            for call in calls.call_args_list:
                self.assertNotIn('/usr/bin/sudo', call.args[0])

    def test_native_probe_refuses_local_or_root_execution_before_sudo(self):
        import probe_host_capture_anchor as probe

        allowed = {'CI': 'true', 'GITHUB_ACTIONS': 'true', 'OPENCLAW_ANCHOR_PROBE': '1'}
        for environment, uid, platform in (({}, 501, 'darwin'), (allowed, 0, 'darwin'),
                                           (allowed, 501, 'win32')):
            with self.subTest(uid=uid, platform=platform), \
                    mock.patch.dict(os.environ, environment, clear=True), \
                    mock.patch.object(probe.sys, 'platform', platform), \
                    mock.patch.object(probe.os, 'getuid', return_value=uid), \
                    mock.patch.object(probe.os, 'geteuid', return_value=uid), \
                    mock.patch.object(probe, 'checked') as sudo:
                with self.assertRaisesRegex(RuntimeError, 'CI-owned anchor probe'):
                    probe.main('/uncreated-report')
                sudo.assert_not_called()

    def test_program_is_python39_and_has_only_standard_library_imports(self):
        tree = ast.parse(pathlib.Path(anchor.__file__).read_text(), feature_version=(3, 9))
        allowed = {'contextlib', 'fcntl', 'hashlib', 'json', 'os', 'pathlib', 're', 'stat', 'subprocess', 'sys'}
        imported = set()
        for node in ast.walk(tree):
            if isinstance(node, ast.Import):
                imported.update(alias.name for alias in node.names)
            self.assertNotIsInstance(node, ast.ImportFrom)
        self.assertLessEqual(imported, allowed)
        self.assertEqual(anchor.FIXTURE_UUID, fixture.host_vm_capture.FIXTURE_UUID)
        self.assertEqual(anchor.PINS, fixture.CAPTURE_PINS)

    def test_invocation_flags_are_required_before_runtime_paths(self):
        for isolated, no_site, bytecode in ((False, True, True), (True, False, True), (True, True, False)):
            with self.subTest(isolated=isolated, no_site=no_site, bytecode=bytecode), \
                    mock.patch.object(anchor.sys, 'flags', types.SimpleNamespace(isolated=isolated, no_site=no_site,
                                                                               dont_write_bytecode=bytecode)), \
                    mock.patch.object(anchor, 'trusted_path', side_effect=AssertionError('path read before invocation refusal')) as paths:
                with self.assertRaisesRegex(RuntimeError, 'isolated Python'):
                    anchor.trusted_runtime()
                paths.assert_not_called()

    def test_module_outside_the_checked_runtime_paths_refuses(self):
        with mock.patch.object(anchor.sys, 'flags', types.SimpleNamespace(isolated=True, no_site=True,
                                                                         dont_write_bytecode=True)), \
                mock.patch.object(anchor.sys, 'path', ['/root/stdlib']), \
                mock.patch.object(anchor.sys, 'modules', {'untrusted': types.SimpleNamespace(__file__='/tmp/user.py')}), \
                mock.patch.object(anchor, 'trusted_cache_prefix', return_value='/root/bytecode-disabled'), \
                mock.patch.object(anchor, 'trusted_path', side_effect=lambda p, **_kwargs: str(p)):
            with self.assertRaisesRegex(RuntimeError, 'untrusted module'):
                anchor.trusted_runtime()

    def test_sudo_uid_mismatch_refuses_before_runtime_checks(self):
        with mock.patch.object(anchor.os, 'getuid', return_value=0), \
                mock.patch.object(anchor.os, 'geteuid', return_value=0), \
                mock.patch.dict(anchor.os.environ, {'SUDO_UID': '502'}), \
                mock.patch.object(anchor, 'trusted_runtime') as runtime:
            with self.assertRaisesRegex(RuntimeError, 'sudo uid differs'):
                anchor.entry('/openclaw-acceptance-owned-a', '/openclaw-acceptance-input-a/capture',
                             501, 'a' * 64, True)
            runtime.assert_not_called()

    def test_production_and_nonroot_calls_refuse_before_any_open(self):
        for uid, euid, fixture_mode, pattern in ((0, 0, False, 'production'),
                (501, 501, True, 'independent root'), (0, 501, True, 'independent root'),
                (501, 0, True, 'independent root')):
            for action in (anchor.publish, anchor.verify):
                with self.subTest(uid=uid, euid=euid, action=action.__name__), \
                        mock.patch.object(anchor.os, 'getuid', return_value=uid), \
                        mock.patch.object(anchor.os, 'geteuid', return_value=euid), \
                        mock.patch.object(anchor, 'Directory') as opened:
                    with self.assertRaisesRegex(RuntimeError, pattern):
                        action('/missing', '/missing', 501, 'a' * 64, fixture=fixture_mode)
                    opened.assert_not_called()

    def test_owner_type_nonce_and_fixture_paths_are_required(self):
        with mock.patch.object(anchor.os, 'getuid', return_value=0), \
                mock.patch.object(anchor.os, 'geteuid', return_value=0):
            for owner, nonce, root in ((0, 'a' * 64, '/openclaw-acceptance-owned-a'),
                    (True, 'a' * 64, '/openclaw-acceptance-owned-a'),
                    (501, '../record', '/openclaw-acceptance-owned-a'),
                    (501, 'a' * 64, '/production')):
                with self.subTest(owner=owner, nonce=nonce, root=root):
                    with self.assertRaises(RuntimeError):
                        anchor.entry(root, '/openclaw-acceptance-input-a/capture', owner, nonce, True)

    def test_directory_owner_private_mode_and_writable_parent_refuse(self):
        good = dict(st_mode=stat.S_IFDIR | 0o700, st_uid=0)
        anchor.directory_shape(types.SimpleNamespace(**good), {0}, True)
        for change, private in (({'st_uid': 501}, True), ({'st_mode': stat.S_IFDIR | 0o755}, True),
                ({'st_mode': stat.S_IFDIR | 0o775}, False), ({'st_mode': stat.S_IFREG | 0o700}, True)):
            with self.subTest(change=change, private=private):
                with self.assertRaisesRegex(RuntimeError, 'directory owner or mode'):
                    anchor.directory_shape(types.SimpleNamespace(**{**good, **change}), {0}, private)

    def test_acl_grants_and_unreadable_acl_refuse(self):
        with mock.patch.object(anchor.sys, 'platform', 'darwin'):
            for acl in (' 0: user:other allow read\n', ' 0: user:other deny write\n', ''):
                result = types.SimpleNamespace(stdout='drwx------ root wheel path\n' + acl, stderr='')
                with mock.patch.object(anchor.subprocess, 'run', return_value=result):
                    if ' allow ' in acl:
                        with self.assertRaisesRegex(RuntimeError, 'has an ACL'):
                            anchor.no_acl(pathlib.Path('/owned'), 5)
                    else:
                        anchor.no_acl(pathlib.Path('/owned'), 5)
            with mock.patch.object(anchor.subprocess, 'run', side_effect=OSError('unreadable')):
                with self.assertRaises(OSError):
                    anchor.no_acl(pathlib.Path('/owned'), 5)


class TrustPaths(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(dir=os.environ.get('GITHUB_WORKSPACE', str(pathlib.Path.home())))
        self.addCleanup(self.temp.cleanup)
        self.directory = pathlib.Path(self.temp.name).resolve()
        self.file = self.directory / 'untrusted.py'
        self.file.write_text('VALUE = "SAFE"\n')
        if os.getuid() == 0:
            os.chown(self.file, 65534, 65534)

    def test_root_controlled_system_file_passes_the_real_path_reader(self):
        self.assertEqual(anchor.trusted_path('/usr/bin/true'), str(pathlib.Path('/usr/bin/true').resolve()))

    def test_nonroot_directory_and_required_root_parent_refuse(self):
        with mock.patch.object(anchor, 'no_acl'):
            if os.getuid() != 0:
                with self.assertRaisesRegex(RuntimeError, 'directory owner or mode'):
                    anchor.trusted_path(self.directory)
        def root_only(path, owners, private=True):
            self.assertEqual(owners, {0})
            raise RuntimeError('untrusted parent')

        with mock.patch.object(anchor, 'Directory', side_effect=root_only):
            with self.assertRaisesRegex(RuntimeError, 'untrusted parent'):
                anchor.trusted_path(self.file)

    def test_nonroot_file_refuses_with_its_parent_modelled_separately(self):
        @contextlib.contextmanager
        def parent(path, owners, private=True):
            self.assertEqual(owners, {0})
            fd = os.open(path, os.O_RDONLY | os.O_DIRECTORY)
            try:
                yield types.SimpleNamespace(fd=fd, path=pathlib.Path(path), check=lambda: None)
            finally:
                os.close(fd)

        with mock.patch.object(anchor, 'Directory', side_effect=parent), mock.patch.object(anchor, 'no_acl'):
            with self.assertRaisesRegex(RuntimeError, 'input owner, mode or links'):
                anchor.trusted_path(self.file)

    def test_loaded_module_file_metadata_is_checked_inside_allowed_paths(self):
        real = anchor.trusted_path

        def checked(path, **kwargs):
            return real(path, **kwargs) if pathlib.Path(path) == self.file else str(path)

        with mock.patch.object(anchor.sys, 'path', [str(self.directory)]), \
                mock.patch.object(anchor.sys, 'modules', {'untrusted': types.SimpleNamespace(__file__=str(self.file))}), \
                mock.patch.object(anchor, 'trusted_path', side_effect=checked), \
                mock.patch.object(anchor, 'no_acl'):
            with self.assertRaisesRegex(RuntimeError, 'owner or mode|input owner'):
                anchor.trusted_interpreter()

    def test_missing_wrong_or_existing_cache_prefix_refuses(self):
        expected = self.directory / 'bytecode-disabled'
        for value, exists in ((None, False), ('/elsewhere', False), (str(expected), True)):
            with self.subTest(value=value, exists=exists), \
                    mock.patch.object(anchor.sys, 'pycache_prefix', value), \
                    mock.patch.object(anchor.os.path, 'lexists', return_value=exists), \
                    mock.patch.object(anchor, 'Directory') as opened:
                with self.assertRaisesRegex(RuntimeError, 'absent bytecode prefix'):
                    anchor.trusted_cache_prefix(self.directory / 'program.py')
                opened.assert_not_called()

    def test_private_absent_cache_prefix_skips_forged_fresh_bytecode(self):
        import importlib.util

        original = self.file.read_bytes()
        stamp = self.file.stat()
        self.file.write_bytes(original.replace(b'SAFE', b'EVIL'))
        os.utime(self.file, ns=(stamp.st_atime_ns, stamp.st_mtime_ns))
        with mock.patch.object(sys, 'pycache_prefix', None):
            cache = pathlib.Path(importlib.util.cache_from_source(str(self.file)))
        cache.parent.mkdir()
        py_compile.compile(str(self.file), cfile=str(cache), doraise=True,
                           invalidation_mode=py_compile.PycInvalidationMode.TIMESTAMP)
        self.file.write_bytes(original)
        os.utime(self.file, ns=(stamp.st_atime_ns, stamp.st_mtime_ns))
        code = 'import sys;sys.path.insert(0,sys.argv[1]);import untrusted;print(untrusted.VALUE)'
        args = [sys.executable, '-I', '-S', '-B']
        forged = subprocess.run([*args, '-c', code, str(self.directory)],
                                capture_output=True, text=True, timeout=15)
        self.assertEqual((forged.returncode, forged.stdout.strip()), (0, 'EVIL'))
        prefix = self.directory / 'bytecode-disabled'
        safe = subprocess.run([*args, '-X', 'pycache_prefix=' + str(prefix), '-c', code, str(self.directory)],
                              capture_output=True, text=True, timeout=15)
        self.assertEqual((safe.returncode, safe.stdout.strip()), (0, 'SAFE'))
        self.assertFalse(prefix.exists())


if __name__ == '__main__':
    unittest.main()
