import ast
import contextlib
import errno
import hashlib
import importlib.util
import json
import os
import pathlib
import subprocess
import sys
import tempfile
import threading
import types
import unittest
from unittest import mock


STEP = pathlib.Path(__file__).resolve().parent
SOURCE = STEP / 'host_release_publish.py'


def load():
    spec = importlib.util.spec_from_file_location('owned_publisher', SOURCE)
    result = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(result)
    return result


class Publication(unittest.TestCase):
    def setUp(self):
        self.m = load()
        self.temp = tempfile.TemporaryDirectory(prefix='openclaw-release-publish-test-',
                                                dir=str(pathlib.Path.home()))
        self.addCleanup(self.temp.cleanup)
        self.base = pathlib.Path(self.temp.name).resolve()
        self.payload, self.parent = self.base / 'payload', self.base / 'programs'
        self.payload.mkdir(mode=0o700)
        self.parent.mkdir(mode=0o700)
        self.manifest = self.base / 'approved.json'
        self.bad = self.base / 'BAD'
        self.raw = ('with open(%r, "w") as f: f.write("BAD")\n' % str(self.bad)).encode()
        for name in self.m.NAMES:
            (self.payload / name).write_bytes(self.raw)
            (self.payload / name).chmod(0o600)
        self.value = {'schema': self.m.SCHEMA, 'files': {name: {
            'size': len(self.raw), 'sha256': hashlib.sha256(self.raw).hexdigest()}
            for name in self.m.NAMES}}
        self.bind()
        self.uid = os.getuid()
        self.patches = contextlib.ExitStack()
        self.addCleanup(self.patches.close)
        original_dir, original_file = self.m.dir_shape, self.m.file_shape
        self.patches.enter_context(mock.patch.object(self.m, 'dir_shape',
            side_effect=lambda info, owners, private: original_dir(info, owners | {self.uid}, private)))
        self.patches.enter_context(mock.patch.object(self.m, 'file_shape',
            side_effect=lambda info, owners, private: original_file(info, owners | {self.uid}, private)))
        self.patches.enter_context(mock.patch.object(self.m.os, 'getuid', return_value=0))
        self.patches.enter_context(mock.patch.object(self.m.os, 'geteuid', return_value=0))
        self.patches.enter_context(mock.patch.object(self.m, 'no_acl'))

    def bind(self, raw=None):
        raw = self.m.encoded(self.value) if raw is None else raw
        self.manifest.write_bytes(raw)
        self.manifest.chmod(0o600)
        self.digest = hashlib.sha256(raw).hexdigest()

    @property
    def pending(self):
        return self.parent / ('.pending-' + self.digest)

    @property
    def final(self):
        return self.parent / self.digest

    def attempt(self, **kw):
        values = {'payload_path': self.payload, 'manifest_path': self.manifest,
                  'destination': self.parent, 'capture_uid': self.uid,
                  'payload_uid': self.uid, 'expected': self.digest}
        values.update(kw)
        try:
            return self.m.publish(**values), None
        except Exception as error:
            return None, error

    def refused(self, reason=None, **kw):
        result, error = self.attempt(**kw)
        self.assertIsNone(result)
        self.assertIsNotNone(error)
        if reason:
            self.assertIn(reason, str(error))
        return error

    def test_honest_publication_is_exact_private_inert_and_receipt_only(self):
        result, error = self.attempt()
        self.assertIsNone(error, repr(error))
        self.assertEqual(result['release_sha256'], self.digest)
        self.assertEqual(result['path'], str(self.final))
        self.assertEqual(set(p.name for p in self.final.iterdir()), {'src', 'release.json'})
        self.assertFalse(self.pending.exists())
        self.assertFalse(self.bad.exists(), 'payload executed')
        self.assertEqual(set(p.name for p in (self.final / 'src').iterdir()), self.m.NAMES)
        self.assertEqual((self.final / 'release.json').read_bytes(), self.manifest.read_bytes())
        for name in self.m.NAMES:
            path = self.final / 'src' / name
            self.assertEqual(path.read_bytes(), self.raw)
            self.assertEqual(path.stat().st_mode & 0o7777, 0o600)
            self.assertEqual(result['files'][name]['sha256'], hashlib.sha256(self.raw).hexdigest())
            self.assertEqual(result['files'][name]['ino'], path.stat().st_ino)
        for name, path in (('parent', self.parent), ('bundle', self.final),
                           ('src', self.final / 'src'), ('manifest', self.final / 'release.json')):
            self.assertEqual(result[name]['ino'], path.stat().st_ino)
        self.assertIn('fsync(2) ordering only', result['sync'])
        self.assertEqual(result['rename']['flag'], 4 if sys.platform == 'darwin' else 1)
        self.assertLess(len(self.m.encoded(result)), self.m.MANIFEST_LIMIT)
        self.assertEqual(set(self.parent.iterdir()), {self.final})

    def test_root_and_separate_nonzero_capture_identity_are_required(self):
        with mock.patch.object(self.m.os, 'geteuid', return_value=self.uid):
            self.refused('independent root')
        for capture, owner in ((0, self.uid), (True, self.uid), (-1, self.uid),
                               (self.uid, True), (self.uid, -1)):
            self.refused('principal data', capture_uid=capture, payload_uid=owner)
        self.assertFalse(self.pending.exists())

    def test_manifest_independent_approval_precedes_parsing_or_staging(self):
        self.manifest.write_bytes(b'not json')
        with mock.patch.object(self.m.json, 'loads', side_effect=AssertionError('parsed unapproved')):
            self.refused('not independently approved')
        self.assertFalse(self.pending.exists())

    def test_self_consistent_unapproved_payload_and_manifest_refuse(self):
        expected = self.digest
        name = sorted(self.m.NAMES)[0]
        (self.payload / name).write_bytes(b'changed\n')
        self.value['files'][name] = {'size': 8, 'sha256': hashlib.sha256(b'changed\n').hexdigest()}
        self.bind()
        self.refused('not independently approved', expected=expected)
        self.assertFalse(self.pending.exists())

    def test_schema_canonical_fields_and_binding_types_refuse(self):
        original = json.loads(self.m.encoded(self.value))
        name = sorted(self.m.NAMES)[0]
        cases = [dict(original, extra=1), dict(original, schema='foreign'),
                 {'schema': original['schema'], 'files': {}},
                 {'schema': original['schema'], 'files': []}]
        for field, value in (('size', True), ('size', 0), ('size', -1),
                             ('size', self.m.FILE_LIMIT + 1), ('sha256', 'Z' * 64),
                             ('sha256', 123), ('extra', 1)):
            case = json.loads(self.m.encoded(original))
            case['files'][name][field] = value
            cases.append(case)
        for index, value in enumerate(cases):
            with self.subTest(value=value):
                self.value = value
                self.bind()
                self.refused('manifest schema' if index < 4 else 'manifest binding differs')
                self.assertFalse(self.pending.exists())
        self.value = original
        self.bind(json.dumps(original).encode())
        self.refused('canonical')

    def test_payload_binding_requires_independent_size_and_hash(self):
        name = sorted(self.m.NAMES)[0]
        (self.payload / name).write_bytes(b'x' * len(self.raw))
        self.refused('approved bindings')
        self.assertFalse(self.pending.exists())

    def test_exact_bounded_entry_set_refuses_extras_and_missing(self):
        extra = self.payload / 'extra.py'
        extra.write_bytes(b'bad')
        self.refused('entry bound or set')
        extra.unlink()
        (self.payload / sorted(self.m.NAMES)[0]).unlink()
        self.refused('entry bound or set')
        self.assertFalse(self.pending.exists())

    def test_link_fifo_directory_and_hardlink_inputs_refuse(self):
        path = self.payload / sorted(self.m.NAMES)[0]
        path.unlink()
        for kind in ('symlink', 'fifo', 'directory', 'hardlink'):
            with self.subTest(kind=kind):
                if kind == 'symlink':
                    path.symlink_to(self.manifest)
                elif kind == 'fifo':
                    os.mkfifo(path)
                elif kind == 'directory':
                    path.mkdir()
                else:
                    os.link(self.payload / sorted(self.m.NAMES)[1], path)
                self.refused()
                path.rmdir() if kind == 'directory' else path.unlink()
        self.assertFalse(self.pending.exists())

    def test_input_and_manifest_size_bounds_precede_reads(self):
        path = self.payload / sorted(self.m.NAMES)[0]
        with path.open('wb') as stream:
            stream.truncate(self.m.FILE_LIMIT + 1)
        self.refused('byte bound')
        path.write_bytes(self.raw)
        with self.manifest.open('wb') as stream:
            stream.truncate(self.m.MANIFEST_LIMIT + 1)
        self.refused('byte bound')
        self.assertFalse(self.pending.exists())

    def test_deadline_refuses_without_staging(self):
        with mock.patch.object(self.m.time, 'monotonic', side_effect=[0, self.m.SECONDS + 1]):
            self.refused('deadline expired')
        self.assertFalse(self.pending.exists())

    def test_source_swap_after_snapshot_never_copies_later_path_bytes(self):
        original_mkdir = self.m.os.mkdir
        target = sorted(self.m.NAMES)[0]
        path = self.payload / target
        def swapped(name, *args, **kwargs):
            result = original_mkdir(name, *args, **kwargs)
            if name == 'src':
                path.rename(self.base / 'old-payload')
                path.write_bytes(b'UNAPPROVED LATER PATH\n')
                path.chmod(0o600)
            return result
        with mock.patch.object(self.m.os, 'mkdir', side_effect=swapped):
            self.refused()
        staged = self.pending / 'src' / target
        self.assertTrue(staged.exists())
        self.assertEqual(staged.read_bytes(), self.raw, 'late pathname bytes were copied')
        self.assertFalse(self.final.exists())

    def test_source_content_rehash_detects_drift_with_metadata_checks_isolated(self):
        original_write = self.m.write_snapshot
        original_check = self.m.File.check
        path = self.payload / sorted(self.m.NAMES)[0]
        changed = False
        def copied(*args):
            nonlocal changed
            result = original_write(*args)
            if not changed:
                changed = True
                path.write_bytes(b'x' * len(self.raw))
            return result
        def metadata(item):
            if changed and item.parent.path == self.payload:
                return
            return original_check(item)
        with mock.patch.object(self.m, 'write_snapshot', side_effect=copied), \
                mock.patch.object(self.m.File, 'check', metadata):
            self.refused('payload snapshot changed')
        self.assertFalse(self.final.exists())

    def test_manifest_swap_before_publication_refuses(self):
        original = self.m.write_snapshot
        swapped = False
        def copied(*args):
            nonlocal swapped
            result = original(*args)
            if not swapped:
                swapped = True
                self.manifest.rename(self.base / 'previous-approval')
                self.manifest.write_bytes((self.base / 'previous-approval').read_bytes())
                self.manifest.chmod(0o600)
            return result
        with mock.patch.object(self.m, 'write_snapshot', side_effect=copied):
            self.refused('mapping or metadata')
        self.assertFalse(self.final.exists())

    def test_ancestor_mapping_swap_refuses_before_publication(self):
        original = self.m.write_snapshot
        changed = False
        def copied(*args):
            nonlocal changed
            result = original(*args)
            if not changed:
                changed = True
                self.parent.rename(self.base / 'old-programs')
                self.parent.mkdir(mode=0o700)
            return result
        with mock.patch.object(self.m, 'write_snapshot', side_effect=copied):
            self.refused('directory mapping')
        self.assertFalse(self.final.exists())

    def test_existing_pending_is_not_reused_or_deleted(self):
        self.pending.mkdir(mode=0o700)
        (self.pending / 'retain').write_bytes(b'evidence')
        before = self.pending.stat().st_ino
        self.refused()
        self.assertEqual(self.pending.stat().st_ino, before)
        self.assertEqual((self.pending / 'retain').read_bytes(), b'evidence')
        self.assertEqual({p.name for p in self.pending.iterdir()}, {'retain'})
        self.assertFalse(self.final.exists())

    def test_existing_final_directory_file_and_link_are_never_replaced(self):
        for kind in ('empty', 'nonempty', 'file', 'symlink'):
            with self.subTest(kind=kind):
                if kind in ('empty', 'nonempty'):
                    self.final.mkdir()
                    if kind == 'nonempty':
                        (self.final / 'retain').write_bytes(b'evidence')
                elif kind == 'file':
                    self.final.write_bytes(b'evidence')
                else:
                    self.final.symlink_to(self.payload, target_is_directory=True)
                before = self.final.lstat().st_ino
                self.refused('destination already exists')
                self.assertEqual(self.final.lstat().st_ino, before)
                self.assertFalse(self.pending.exists())
                if kind == 'nonempty':
                    (self.final / 'retain').unlink()
                self.final.rmdir() if kind in ('empty', 'nonempty') else self.final.unlink()

    def test_kernel_exclusivity_wins_against_late_empty_destination(self):
        original = self.m.exclusive_rename
        ino = []
        def raced(parent, source, target):
            self.final.mkdir()
            ino.append(self.final.stat().st_ino)
            return original(parent, source, target)
        with mock.patch.object(self.m, 'exclusive_rename', side_effect=raced):
            error = self.refused()
        self.assertEqual(getattr(error, 'errno', None), errno.EEXIST)
        self.assertEqual(self.final.stat().st_ino, ino[0])
        self.assertEqual(list(self.final.iterdir()), [])
        self.assertTrue(self.pending.is_dir())

    def test_actual_exclusive_rename_refuses_existing_nonempty_and_symlink(self):
        for kind in ('directory', 'symlink'):
            with self.subTest(kind=kind):
                source, target = self.base / 'rename-source', self.base / 'rename-target'
                source.mkdir()
                if kind == 'directory':
                    target.mkdir(); (target / 'retain').write_bytes(b'evidence')
                else:
                    target.symlink_to(self.payload, target_is_directory=True)
                with self.m.directory(self.base, {0}, True, self.m.Deadline()) as parent:
                    try:
                        self.m.exclusive_rename(parent, source.name, target.name)
                    except OSError as error:
                        self.assertEqual(error.errno, errno.EEXIST)
                    else:
                        self.fail('exclusive rename replaced an existing name')
                self.assertTrue(source.exists())
                source.rmdir()
                if kind == 'directory':
                    (target / 'retain').unlink(); target.rmdir()
                else:
                    target.unlink()

    def test_same_release_concurrency_returns_exactly_one_success(self):
        results = []
        threads = [threading.Thread(target=lambda: results.append(self.attempt())) for _ in range(2)]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join(timeout=90)
            self.assertFalse(thread.is_alive())
        self.assertEqual(sum(result is not None for result, _ in results), 1, repr(results))
        self.assertEqual(sum(error is not None for _, error in results), 1, repr(results))
        self.assertEqual(set(p.name for p in self.parent.iterdir()) - {self.digest},
                         {self.pending.name} if self.pending.exists() else set())
        self.assertEqual((self.final / 'src' / sorted(self.m.NAMES)[0]).read_bytes(), self.raw)

    def test_partial_writes_are_completed_without_reopening_source(self):
        original = self.m.os.write
        with mock.patch.object(self.m.os, 'write', side_effect=lambda fd, raw: original(fd, raw[:7])):
            result, error = self.attempt()
        self.assertIsNone(error, repr(error))
        self.assertIsNotNone(result)
        self.assertEqual((self.final / 'release.json').read_bytes(), self.manifest.read_bytes())

    def test_zero_write_retains_failed_staging_and_refuses(self):
        with mock.patch.object(self.m.os, 'write', return_value=0):
            self.refused('short write')
        self.assertTrue(self.pending.is_dir())
        self.assertFalse(self.final.exists())
        self.refused()

    def test_every_output_and_directory_sync_precedes_exclusive_publish(self):
        original_sync, original_rename = self.m.os.fsync, self.m.exclusive_rename
        events = []
        def synced(fd):
            events.append(('sync', os.fstat(fd).st_ino))
            return original_sync(fd)
        def renamed(*args):
            events.append(('rename', None))
            return original_rename(*args)
        with mock.patch.object(self.m.os, 'fsync', side_effect=synced), \
                mock.patch.object(self.m, 'exclusive_rename', side_effect=renamed):
            result, error = self.attempt()
        self.assertIsNone(error, repr(error))
        boundary = events.index(('rename', None))
        inodes = [item['ino'] for item in result['files'].values()]
        inodes.extend(result[name]['ino'] for name in ('manifest', 'src', 'bundle'))
        for inode in inodes:
            self.assertIn(('sync', inode), events[:boundary])
        self.assertIn(('sync', result['parent']['ino']), events[boundary + 1:])

    def test_reread_detects_written_byte_corruption(self):
        original = self.m.os.write
        def corrupt(fd, raw):
            return original(fd, b'X' * len(raw))
        with mock.patch.object(self.m.os, 'write', side_effect=corrupt):
            self.refused('staged bytes differ')
        self.assertTrue(self.pending.is_dir())
        self.assertFalse(self.final.exists())

    def test_fsync_errors_before_and_after_rename_never_return_success(self):
        original_sync, original_rename = self.m.os.fsync, self.m.exclusive_rename
        with mock.patch.object(self.m.os, 'fsync', side_effect=OSError('injected fsync')):
            self.refused('injected fsync')
        self.assertTrue(self.pending.is_dir())
        self.assertFalse(self.final.exists())
        self.pending.rmdir()
        renamed = False
        def renamed_once(*args):
            nonlocal renamed
            result = original_rename(*args)
            renamed = True
            return result
        def synced(fd):
            if renamed:
                raise OSError('injected post-rename fsync')
            return original_sync(fd)
        with mock.patch.object(self.m, 'exclusive_rename', side_effect=renamed_once), \
                mock.patch.object(self.m.os, 'fsync', side_effect=synced):
            self.refused('post-rename fsync')
        self.assertTrue(self.final.is_dir())
        self.assertFalse(self.pending.exists())
        self.refused('already exists')

    def test_output_metadata_and_acl_checks_precede_payload_writes(self):
        original_shape = self.m.file_shape
        writes = []
        original_write = self.m.os.write
        def shape(info, owners, private):
            if private and info.st_size == 0:
                raise RuntimeError('injected new file metadata refusal')
            return original_shape(info, owners, private)
        def wrote(fd, raw):
            writes.append(len(raw))
            return original_write(fd, raw)
        with mock.patch.object(self.m, 'file_shape', side_effect=shape), \
                mock.patch.object(self.m.os, 'write', side_effect=wrote):
            self.refused('new file metadata refusal')
        self.assertEqual(writes, [])
        self.assertTrue(self.pending.exists())

    def test_output_acl_refusal_precedes_any_payload_bytes(self):
        def acl(path, fd, deadline):
            if pathlib.Path(path).parent.name == 'src' and os.fstat(fd).st_size == 0:
                raise RuntimeError('injected new file ACL refusal')
        writes = []
        with mock.patch.object(self.m, 'no_acl', side_effect=acl), \
                mock.patch.object(self.m.os, 'write', side_effect=lambda *args: writes.append(args)):
            self.refused('new file ACL refusal')
        self.assertEqual(writes, [])
        self.assertTrue(self.pending.exists())

    def test_writable_destination_or_ancestor_refuses_before_staging(self):
        self.parent.chmod(0o777)
        try:
            self.refused('directory shape')
        finally:
            self.parent.chmod(0o700)
        self.assertFalse(self.pending.exists())

    def test_read_deadline_is_checked_between_bounded_blocks(self):
        now = [0]
        original = self.m.os.read
        def read(*args):
            result = original(*args)
            now[0] = self.m.SECONDS + 1
            return result
        with mock.patch.object(self.m.time, 'monotonic', side_effect=lambda: now[0]), \
                mock.patch.object(self.m.os, 'read', side_effect=read):
            self.refused('deadline expired')
        self.assertFalse(self.pending.exists())

    def test_flags_xattrs_modes_and_manifest_links_refuse(self):
        path = self.payload / sorted(self.m.NAMES)[0]
        path.chmod(0o666)
        self.refused('file shape')
        path.chmod(0o600)
        attribute = 'com.openclaw.publish-test' if sys.platform == 'darwin' else 'user.openclaw.publish-test'
        if sys.platform == 'darwin':
            subprocess.run(['/usr/bin/xattr', '-w', attribute, 'fixture', str(path)], check=True)
        else:
            os.setxattr(path, attribute, b'fixture')
        self.refused('xattrs')
        if sys.platform == 'darwin':
            subprocess.run(['/usr/bin/xattr', '-d', attribute, str(path)], check=True)
        else:
            os.removexattr(path, attribute)
        os.link(self.manifest, self.base / 'manifest-link')
        self.refused('file shape')
        (self.base / 'manifest-link').unlink()
        if hasattr(os, 'chflags'):
            os.chflags(path, stat_flag())
            try:
                self.refused('file shape')
            finally:
                os.chflags(path, 0)
        self.assertFalse(self.pending.exists())

    def test_schema_and_names_match_existing_consumer(self):
        spec = importlib.util.spec_from_file_location('publication_compatibility', STEP / 'host_capture_anchor.py')
        anchor = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(anchor)
        self.assertEqual(self.m.SCHEMA, anchor.RELEASE_SCHEMA)
        self.assertEqual(self.m.NAMES, anchor.CODE_NAMES)

    def test_python39_and_cli_fixture_environment_barriers(self):
        ast.parse(SOURCE.read_text(), feature_version=(3, 9))
        original = self.m.cli
        valid = ['program', '--ci-owned', self.m.FIXTURE_UUID, '/var/lib/input',
                 '/root/approved.json', '/root/programs', str(self.uid), str(self.uid), self.digest]
        for field, value in ((1, '--production'), (2, 'production-vm'), (None, 'missing')):
            argv = valid.copy()
            if field is None:
                argv.pop()
            else:
                argv[field] = value
            with mock.patch.object(self.m.sys, 'argv', argv), mock.patch.dict(
                    self.m.os.environ, {'CI': 'true', 'GITHUB_ACTIONS': 'true'}):
                with self.assertRaisesRegex(RuntimeError, 'CI-owned'):
                    original()
        with mock.patch.object(self.m.sys, 'argv', valid), mock.patch.dict(
                self.m.os.environ, {'CI': 'false', 'GITHUB_ACTIONS': 'false'}):
            with self.assertRaisesRegex(RuntimeError, 'CI-owned'):
                original()

    def test_cli_flags_paths_and_sudo_metadata_refuse_before_core(self):
        home = '/private/var/root' if sys.platform == 'darwin' else '/root'
        inputs = '/private/var/db' if sys.platform == 'darwin' else '/var/lib'
        base = pathlib.Path(home) / 'openclaw-release-publish-owned-fixture'
        valid = [str(base / 'host_release_publish.py'), '--ci-owned', self.m.FIXTURE_UUID,
                 inputs + '/openclaw-release-publish-input-fixture', str(base / 'approved.json'),
                 str(base / 'programs'), str(self.uid), str(self.uid), self.digest]
        with contextlib.ExitStack() as stack:
            stack.enter_context(mock.patch.object(self.m, '__file__', valid[0]))
            stack.enter_context(mock.patch.object(self.m.sys, 'pycache_prefix', str(base / 'bytecode-disabled')))
            stack.enter_context(mock.patch.dict(self.m.os.environ, {
                'CI': 'true', 'GITHUB_ACTIONS': 'true', 'SUDO_UID': str(self.uid)}))
            called = stack.enter_context(mock.patch.object(self.m, 'publish', return_value={}))
            for key in ('isolated', 'no_site', 'dont_write_bytecode'):
                flags = dict(isolated=True, no_site=True, dont_write_bytecode=True)
                flags[key] = False
                with mock.patch.object(self.m.sys, 'flags', types.SimpleNamespace(**flags)), \
                        mock.patch.object(self.m.sys, 'argv', valid):
                    with self.assertRaisesRegex(RuntimeError, 'isolated'):
                        self.m.cli()
            stack.enter_context(mock.patch.object(self.m.sys, 'flags', types.SimpleNamespace(
                isolated=True, no_site=True, dont_write_bytecode=True)))
            for field, value in ((3, '/production/payload'), (4, '/production/manifest'),
                                 (5, '/production/programs')):
                argv = valid.copy(); argv[field] = value
                with mock.patch.object(self.m.sys, 'argv', argv):
                    with self.assertRaisesRegex(RuntimeError, 'fixture paths'):
                        self.m.cli()
            with mock.patch.object(self.m.sys, 'argv', valid), \
                    mock.patch.dict(self.m.os.environ, {'SUDO_UID': 'unknown'}):
                with self.assertRaisesRegex(RuntimeError, 'capture principal'):
                    self.m.cli()
            called.assert_not_called()

    def test_owned_driver_waits_and_removes_its_interrupted_process_group(self):
        from probe_host_release_publish import DRIVER
        script = ('import os,signal;print("PAUSED "+str(os.getpid()),flush=True);'
                  'os.kill(os.getpid(),signal.SIGSTOP)')
        done = subprocess.run([sys.executable, '-B', '-c', DRIVER,
            json.dumps([sys.executable, '-I', '-S', '-B', '-c', script]), 'interrupt'],
            capture_output=True, text=True, timeout=30)
        self.assertEqual(done.returncode, 0, done.stderr)
        result = json.loads(done.stdout)
        self.assertTrue(result['waited'])
        self.assertTrue(result['interruption_observed'])
        self.assertTrue(result['group_absent'])
        self.assertEqual(result['returncode'], -9)
        self.assertEqual(result['stdout'], '')
        self.assertFalse(result['timed_out'])


def stat_flag():
    import stat
    return stat.UF_HIDDEN


if __name__ == '__main__':
    unittest.main()
