import ast
import contextlib
import hashlib
import importlib.util
import json
import os
import pathlib
import subprocess
import sys
import tempfile
import types
import unittest
from unittest import mock


STEP = pathlib.Path(__file__).resolve().parent
ANCHOR_SOURCE = STEP / 'host_capture_anchor.py'
PROJECT = ('host_asif_extract', 'host_guest_commit', 'host_image_immutable', 'host_journal_mount',
           'host_vm_capture', 'host_vm_preflight', 'nats_identity', 'preservation_checks',
           'preservation_journal', 'stopped_journal_inputs', 'host_protected_journal_reader')


def encoded(value):
    return (json.dumps(value, sort_keys=True, separators=(',', ':')) + '\n').encode()


def worker(options):
    with tempfile.TemporaryDirectory(prefix='openclaw-release-fixture-',
            dir=os.environ.get('GITHUB_WORKSPACE', str(pathlib.Path.home()))) as temp:
        base = pathlib.Path(temp).resolve()
        code = base / 'code'
        code.mkdir(mode=0o700)
        marker, bad = base / 'effect', base / 'unapproved-executed'
        project_started = base / 'project-started'
        for name in PROJECT:
            raw = (STEP / (name + '.py')).read_bytes() if options.get('actual') else b'TOKEN = "approved"\n'
            (code / (name + '.py')).write_bytes(raw)
        if not options.get('actual'):
            (code / 'host_asif_extract.py').write_text(
                'with open(%r, "w") as stream: stream.write("started")\nTOKEN="approved"\n' % str(project_started))
            (code / 'host_guest_commit.py').write_text('import nats_identity\nTOKEN = nats_identity.TOKEN\n')
            operation = '''def read_image(a, *args):
    code = args[-1]
    code['check']()
    with open(%r, 'w') as stream:
        stream.write('read')
    return {'operation': 'read', 'token': code['modules']['host_guest_commit'].TOKEN}
def read_receipt(a, *args):
    result = read_image(a, *args)
    result['operation'] = 'receipt'
    return result
''' % str(marker)
            (code / 'host_protected_journal_reader.py').write_text(operation)
        anchor_path = code / 'host_capture_anchor.py'
        anchor_path.write_bytes(pathlib.Path(options['source']).read_bytes())
        for path in code.iterdir():
            path.chmod(0o600)
        manifest = base / 'release.json'

        def bind():
            raw = encoded({'schema': 'openclaw-approved-reader-v1', 'files': {
                path.name: {'size': path.stat().st_size, 'sha256': hashlib.sha256(path.read_bytes()).hexdigest()}
                for path in code.iterdir() if path.is_file()}})
            manifest.write_bytes(raw)
            manifest.chmod(0o600)
            return hashlib.sha256(raw).hexdigest()

        expected = bind()
        program_sha = hashlib.sha256(anchor_path.read_bytes()).hexdigest()
        spec = importlib.util.spec_from_file_location('owned_anchor', anchor_path)
        a = importlib.util.module_from_spec(spec)
        sys.modules['owned_anchor'] = a
        spec.loader.exec_module(a)
        sys.dont_write_bytecode = True
        initial_meta, initial_path = list(sys.meta_path), list(sys.path)
        uid = os.getuid()
        original_directory, original_input = a.Directory, a.Input
        held = []
        store = base / 'openclaw-acceptance-owned-store'
        store.mkdir(mode=0o700)
        capture = base / 'openclaw-acceptance-input-fixture' / 'capture'
        nonce = 'a' * 64
        authority = {'program_sha256': program_sha, 'root_path': str(store)}
        kind, action = options.get('kind', 'honest'), options.get('action', 'read')
        changed = False
        held_at_effect = False

        def witness():
            nonlocal held_at_effect
            selected_inputs = [item for item in held if item.directory.path in (code, base)]
            held_at_effect = (len(selected_inputs) == 13
                and {item.name for item in selected_inputs} == {name + '.py' for name in (*PROJECT, 'host_capture_anchor')} | {'release.json'}
                and all(os.fstat(item.fd).st_ino == item.initial.st_ino for item in selected_inputs))

        def swap(name='nats_identity'):
            nonlocal changed
            if changed:
                return
            changed = True
            path = code / (name + '.py')
            path.rename(base / 'previous-source')
            path.write_text('with open(%r, "w") as stream: stream.write("BAD")\nTOKEN="unapproved"\n' % str(bad))
            path.chmod(0o600)

        def directory(path, owners, private=True):
            if kind == 'before-effect' and pathlib.Path(path) == store:
                swap()
            return original_directory(path, owners | {uid}, private)

        def read_input(parent, name, owner, **kwargs):
            item = original_input(parent, name, uid if owner == 0 else owner, **kwargs)
            held.append(item)
            return item

        def snapshot(*_args):
            witness()
            marker.write_text(action)
            return {'owned': True}

        def selected(name):
            args = (store, capture, uid, nonce)
            kwargs = {'release_manifest': manifest, 'release_sha256': expected, 'fixture': True}
            if name in ('publish', 'verify'):
                return getattr(a, name)(*args, **kwargs)
            return a.reader_action(*args, uid, uid, receipt=name == 'receipt', **kwargs)

        result = None
        error = None
        with contextlib.ExitStack() as stack:
            import builtins
            original_open = builtins.open
            def opened(file, *args, **kwargs):
                if pathlib.Path(file) == marker:
                    witness()
                return original_open(file, *args, **kwargs)
            stack.enter_context(mock.patch.object(builtins, 'open', side_effect=opened))
            for patch in (mock.patch.object(a, 'Directory', side_effect=directory),
                          mock.patch.object(a, 'Input', side_effect=read_input),
                          mock.patch.object(a, 'no_acl'),
                          mock.patch.object(a, 'entry', return_value=authority),
                          mock.patch.object(a, 'trusted_runtime', return_value={'program_sha256': program_sha}),
                          mock.patch.object(a, 'snapshot', side_effect=snapshot)):
                stack.enter_context(patch)
            if action == 'verify':
                kind_before = kind
                kind = 'honest'
                selected('publish')
                held.clear()
                held_at_effect = False
                marker.unlink()
                kind = kind_before
            if kind == 'digest':
                expected = 'f' * 64
            elif kind == 'digest-type':
                expected = options['value']
            elif kind == 'coordinated':
                swap()
                bind()
            elif kind == 'stale':
                swap()
            elif kind == 'schema':
                if options['field'] == 'size' and options.get('value') is True:
                    (code / 'nats_identity.py').write_bytes(b'\n')
                    bind()
                value = json.loads(manifest.read_bytes())
                field = options['field']
                if field == 'extra':
                    value['extra'] = 1
                elif field == 'version':
                    value['schema'] = 'unapproved-schema'
                elif field == 'missing':
                    value['files'].pop('nats_identity.py')
                elif field == 'extra-file':
                    value['files']['extra.py'] = value['files']['nats_identity.py']
                elif field == 'binding-extra':
                    value['files']['nats_identity.py']['extra'] = 1
                elif field == 'size':
                    value['files']['nats_identity.py']['size'] = options['value']
                elif field == 'hash':
                    value['files']['nats_identity.py']['sha256'] = options['value']
                elif field == 'noncanonical':
                    pass
                raw = json.dumps(value).encode() if field == 'noncanonical' else encoded(value)
                manifest.write_bytes(raw)
                expected = hashlib.sha256(raw).hexdigest()
            elif kind == 'extra-code':
                (code / options['name']).write_bytes(b'extra')
            elif kind == 'missing-source':
                (code / 'nats_identity.py').unlink()
            elif kind == 'link':
                path = code / 'nats_identity.py'
                target = base / 'outside.py'
                path.rename(target)
                path.symlink_to(target)
            elif kind == 'preloaded':
                name = options.get('name', 'nats_identity')
                sys.modules[name] = types.SimpleNamespace(__file__=str(code / (name + '.py')))
            elif kind in ('direct-anchor', 'transitive-anchor', 'lazy-anchor'):
                name = {'direct-anchor': 'host_asif_extract', 'transitive-anchor': 'nats_identity',
                        'lazy-anchor': 'host_protected_journal_reader'}[kind]
                path = code / (name + '.py')
                raw = path.read_text()
                raw = ('import host_capture_anchor\n' + raw) if kind != 'lazy-anchor' else raw.replace(
                    '    code = args[-1]', '    import host_capture_anchor\n    code = args[-1]')
                path.write_text(raw)
                expected = bind()
            if kind in ('entry-reader', 'object', 'origin', 'alias', 'guard', 'manifest-swap', 'rehash',
                        'before-effect'):
                original_reader = a.reader_code
                @contextlib.contextmanager
                def reader(release):
                    if kind == 'entry-reader':
                        swap()
                    with original_reader(release) as loaded:
                        if kind == 'object':
                            sys.modules['nats_identity'] = types.SimpleNamespace(__file__=str(code / 'nats_identity.py'))
                        elif kind == 'origin':
                            loaded['modules']['nats_identity'].__file__ = '/different.py'
                        elif kind == 'alias':
                            sys.modules['unexpected_alias'] = loaded['modules']['nats_identity']
                        elif kind == 'guard':
                            sys.meta_path.pop(0)
                        elif kind == 'manifest-swap':
                            raw = manifest.read_bytes()
                            manifest.rename(base / 'old-manifest')
                            manifest.write_bytes(raw)
                            manifest.chmod(0o600)
                        elif kind == 'rehash':
                            item = next(item for item in held if item.name == 'nats_identity.py')
                            stack.enter_context(mock.patch.object(item, 'read', return_value=(b'changed', 'f' * 64, 7)))
                        elif kind == 'before-effect':
                            swap()
                        yield loaded
                stack.enter_context(mock.patch.object(a, 'reader_code', side_effect=reader))
            if kind == 'hash-exec':
                original_require = a.require
                def require(condition, message):
                    original_require(condition, message)
                    if message == 'reader import resolution differs':
                        swap('host_asif_extract')
                stack.enter_context(mock.patch.object(a, 'require', side_effect=require))
            elif kind == 'transitive-swap':
                import builtins
                original_import = builtins.__import__
                def importer(name, *args, **kwargs):
                    if name == 'nats_identity':
                        swap()
                    return original_import(name, *args, **kwargs)
                stack.enter_context(mock.patch.object(builtins, '__import__', side_effect=importer))
            try:
                if action == 'load':
                    with a.approved_release(manifest, expected) as release, a.reader_code(release) as loaded:
                        witness()
                        result = {'count': len(loaded['hashes']), 'names': sorted(loaded['modules']),
                                  'checked': loaded['check']() == loaded['authority']}
                else:
                    result = selected(action)
            except Exception as exc:
                error = type(exc).__name__ + ': ' + str(exc)
        closed = True
        for item in held:
            try:
                os.fstat(item.fd)
            except OSError:
                continue
            closed = False
        return {'error': error, 'result': result, 'effect': marker.exists(), 'bad': bad.exists(),
                'anchor_imported': 'host_capture_anchor' in sys.modules, 'project_started': project_started.exists(),
                'final': (store / (nonce + '.json')).exists(), 'closed': closed,
                'meta_restored': sys.meta_path == initial_meta, 'path_restored': sys.path == initial_path,
                'cache': any(code.glob('**/*.pyc')), 'held_at_effect': held_at_effect}


class Release(unittest.TestCase):
    def observe(self, **options):
        options['source'] = str(ANCHOR_SOURCE)
        done = subprocess.run([sys.executable, '-I', '-S', '-B', str(pathlib.Path(__file__).resolve()),
                               '--worker', json.dumps(options)], capture_output=True, text=True, timeout=30)
        self.assertEqual(done.returncode, 0, done.stdout + done.stderr)
        value = json.loads(done.stdout)
        self.assertTrue(value['closed'], value)
        self.assertFalse(value['cache'], value)
        return value

    def refused(self, pattern, **options):
        value = self.observe(**options)
        self.assertIsNotNone(value['error'], value)
        self.assertRegex(value['error'], pattern)
        self.assertFalse(value['effect'], value)
        self.assertFalse(value['bad'], value)
        return value

    def test_honest_all_four_actions(self):
        for action in ('publish', 'verify', 'read', 'receipt'):
            with self.subTest(action=action):
                value = self.observe(action=action)
                self.assertIsNone(value['error'], value)
                self.assertTrue(value['effect'], value)
                self.assertTrue(value['held_at_effect'], value)
                self.assertTrue(value['meta_restored'] and value['path_restored'], value)
                self.assertFalse(value['anchor_imported'], value)
                if action in ('read', 'receipt'):
                    self.assertEqual(value['result'], {'operation': action, 'token': 'approved'})

    def test_independent_digest_is_required_for_each_action(self):
        for action in ('publish', 'verify', 'read', 'receipt'):
            with self.subTest(action=action):
                self.refused('not independently approved', kind='digest', action=action)

    def test_coordinated_manifest_and_source_rewrite_refuses_each_action(self):
        for action in ('publish', 'verify', 'read', 'receipt'):
            with self.subTest(action=action):
                self.refused('not independently approved', kind='coordinated', action=action)

    def test_expected_digest_types_and_shape(self):
        for value in (False, 1, '', 'a' * 63, 'A' * 64):
            with self.subTest(value=value):
                self.refused('digest is invalid', kind='digest-type', value=value)

    def test_manifest_schema_and_file_set_are_exact(self):
        for field in ('extra', 'version', 'missing', 'extra-file', 'binding-extra', 'noncanonical'):
            with self.subTest(field=field):
                self.refused('schema or file set|binding is invalid|not canonical', kind='schema', field=field)

    def test_manifest_sizes_are_strict_bounded_integers(self):
        for value in (True, False, 0, -1, 1.5, '1', 2097153):
            with self.subTest(value=value):
                self.refused('binding is invalid', kind='schema', field='size', value=value, action='publish')

    def test_manifest_hashes_are_strict(self):
        for value in (True, 0, 'f' * 63, 'G' * 64):
            with self.subTest(value=value):
                self.refused('binding is invalid', kind='schema', field='hash', value=value)

    def test_wrong_size_and_hash_cannot_select_current_sources(self):
        for field, value in (('size', 1), ('hash', 'f' * 64)):
            with self.subTest(field=field):
                self.refused('source differs', kind='schema', field=field, value=value)

    def test_stale_release_and_extra_missing_linked_sources_refuse(self):
        for kind, pattern in (('stale', 'source differs'), ('missing-source', 'entries differ'),
                              ('link', 'Too many levels|symbolic link')):
            with self.subTest(kind=kind):
                self.refused(pattern, kind=kind)
        for name in ('extra.py', '__pycache__', 'bytecode-disabled'):
            self.refused('entries differ', kind='extra-code', name=name)

    def test_entry_to_reader_swap_refuses(self):
        self.refused('changed or was replaced', kind='entry-reader')

    def test_hash_to_execution_uses_only_snapshots(self):
        self.refused('changed or was replaced', kind='hash-exec')

    def test_transitive_import_swap_never_executes_replacement(self):
        self.refused('changed or was replaced', kind='transitive-swap')

    def test_preloaded_matching_origins_and_anchor_alias_refuse(self):
        for name in ('nats_identity', 'host_capture_anchor'):
            value = self.observe(kind='preloaded', name=name)
            self.assertFalse(value['project_started'], value)
            self.assertIsNotNone(value['error'], value)
            self.assertRegex(value['error'], 'was preloaded')
            self.assertFalse(value['effect'] or value['bad'], value)

    def test_direct_transitive_and_lazy_anchor_imports_refuse_without_second_object(self):
        for kind in ('direct-anchor', 'transitive-anchor', 'lazy-anchor'):
            with self.subTest(kind=kind):
                value = self.observe(kind=kind)
                self.assertFalse(value['anchor_imported'], value)
                self.assertIsNotNone(value['error'], value)
                self.assertRegex(value['error'], 'anchor or submodule import is forbidden')
                self.assertFalse(value['effect'] or value['bad'], value)

    def test_loaded_object_origin_and_alias_drift_refuse(self):
        for kind, pattern in (('object', 'module identity differs'), ('origin', 'module identity differs'),
                              ('alias', 'local module set differs')):
            with self.subTest(kind=kind):
                self.refused(pattern, kind=kind)

    def test_guard_and_manifest_mapping_drift_refuse(self):
        self.refused('held import guard changed', kind='guard')
        self.refused('changed or was replaced', kind='manifest-swap')

    def test_sources_are_rehashed_not_only_metadata_checked(self):
        self.refused('reader source hash changed', kind='rehash')

    def test_each_action_rechecks_before_its_effect(self):
        for action in ('publish', 'verify', 'read', 'receipt'):
            with self.subTest(action=action):
                self.refused('changed or was replaced', kind='before-effect', action=action)

    def test_actual_twelve_file_import_closure_and_fd_cleanup(self):
        value = self.observe(actual=True, action='load')
        self.assertIsNone(value['error'], value)
        self.assertEqual(value['result'], {'count': 12, 'names': sorted(PROJECT), 'checked': True})
        self.assertTrue(value['held_at_effect'], value)
        self.assertTrue(value['meta_restored'] and value['path_restored'], value)

    def test_python39_and_ci_entry_barriers(self):
        source = ANCHOR_SOURCE.read_text()
        ast.parse(source, feature_version=(3, 9))
        for action in ('publish', 'verify', 'read', 'receipt'):
            args = [sys.executable, str(ANCHOR_SOURCE), '--ci-owned', action, '/missing', '/missing', '501', 'a'*64]
            if action in ('read', 'receipt'):
                args.extend(('65534', '0'))
            args.extend(('/manifest', 'b'*64))
            done = subprocess.run(args, env={'PATH': '/usr/bin:/bin'}, capture_output=True, text=True, timeout=10)
            self.assertNotEqual(done.returncode, 0)
            self.assertIn('only the CI-owned anchor command', done.stderr)


if __name__ == '__main__':
    if len(sys.argv) == 3 and sys.argv[1] == '--worker':
        print(json.dumps(worker(json.loads(sys.argv[2])), sort_keys=True))
    else:
        unittest.main()
