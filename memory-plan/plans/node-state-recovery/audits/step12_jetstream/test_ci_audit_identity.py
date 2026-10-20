import ast
import importlib.util
import pathlib
import unittest
from unittest import mock

STEP = pathlib.Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('probe_ci_audit_identity', STEP / 'probe_ci_audit_identity.py')
p = importlib.util.module_from_spec(spec)
spec.loader.exec_module(p)
o = p.o


def static_no_identity_writes(source, name):
    tree = ast.parse(source, feature_version=(3, 9))
    setters = {'setauid', 'setaudit', 'setaudit_addr', 'putenv', 'unsetenv'}
    for node in ast.walk(tree):
        identifier = node.attr if isinstance(node, ast.Attribute) else node.id if isinstance(node, ast.Name) else None
        assert identifier not in setters, 'identity or environment setter is forbidden'
        if isinstance(node, ast.Constant) and isinstance(node.value, str):
            assert node.value not in setters, 'dynamic identity setter spelling is forbidden'
        if not isinstance(node, ast.Call):
            continue
        if isinstance(node.func, ast.Name):
            assert node.func.id != 'open', 'built-in file open is outside the audited forms'
        if not isinstance(node.func, ast.Attribute):
            continue
        form = ast.unparse(node.func)
        if node.func.attr == 'open':
            assert form == 'os.open', 'io or pathlib file open is outside the audited forms'
            if name == 'ci_audit_identity_observer.py':
                assert len(node.args) == 2 and ast.unparse(node.args[1]) == 'os.O_RDONLY | os.O_CLOEXEC', 'observer file open is not read-only'
            else:
                assert len(node.args) == 3 and ast.unparse(node.args[0]) == 'report_path' and ast.unparse(node.args[1]) == 'os.O_WRONLY | os.O_CREAT | os.O_EXCL' and ast.literal_eval(node.args[2]) == 0o600, 'driver file open is not the exclusive report'
        if node.func.attr == 'fdopen':
            assert name == 'probe_ci_audit_identity.py' and form == 'os.fdopen' and [ast.unparse(a) for a in node.args] == ['fd', "'wb'"], 'unreviewed descriptor writer'
        assert node.func.attr not in {'write_bytes', 'write_text', 'touch', 'truncate', 'pwrite'}, 'pathlib or positional write is forbidden'
        if node.func.attr == 'write':
            expected = ('sys.stdout.buffer.write', 'raw') if name == 'ci_audit_identity_observer.py' else ('target.write', 'encoded')
            assert (form, ast.unparse(node.args[0])) == expected, 'unreviewed file writer'
    return tree


class ObservationTests(unittest.TestCase):
    def test_lexical_values_never_become_identity_decisions(self):
        cases = [(None, 'absent'), (b'', 'non-canonical'), (b'0', 'decimal'),
                 (b'501', 'decimal'), (b'0501', 'non-canonical'), (b'+501', 'non-canonical'),
                 (b'-1', 'non-canonical'), (b' 501', 'non-canonical'), (b'501\n', 'non-canonical'),
                 (b'4294967295', 'sentinel-4294967295'), (b'4294967296', 'non-canonical'),
                 (b'5\x001', 'non-canonical'), ('５'.encode(), 'non-canonical')]
        for raw, expected in cases:
            with self.subTest(raw=raw):
                value = o.scalar(raw)
                self.assertEqual(value['tag'], expected)
                p.check_scalar(value)
                p.field_check(value)
        self.assertEqual(o.scalar(b'501\n', allow_lf=True)['tag'], 'decimal')
        self.assertEqual(o.scalar(b'501\n\n', allow_lf=True)['tag'], 'non-canonical')
        self.assertEqual(o.scalar(error={'errno': 13})['tag'], 'read-error')

    def test_no_arbitrary_environment_values_or_askpass(self):
        env = {'CANARY_NAME': 'never-emit-this-canary-value', 'PATH': '/not-emitted', 'SUDO_UID': '501'}
        value = o.snapshot_environment(env)
        self.assertEqual(value['keys'], ['CANARY_NAME', 'PATH', 'SUDO_UID'])
        self.assertNotIn(env['CANARY_NAME'], p.canonical(value).decode())
        self.assertNotIn(env['PATH'], p.canonical(value).decode())
        self.assertEqual(value['sudo']['SUDO_UID'], '501')
        for extra in ({'SUDO_ASKPASS': '/bad'}, {'X' * 257: 'bad'},
                      {'SUDO_COMMAND': 'x' * 4097}, {str(i): '' for i in range(257)}):
            with self.assertRaises(o.IntegrityError):
                o.snapshot_environment(extra)

    def test_schema_rejects_decisions_and_invented_scalar_fields(self):
        for name in p.FORBIDDEN_FIELDS:
            with self.assertRaises(o.IntegrityError):
                p.field_check({'nested': [{name: True}]})
        with self.assertRaises(o.IntegrityError):
            p.check_scalar(dict(o.scalar(b'501'), selected=True))
        with self.assertRaises(o.IntegrityError):
            p.check_scalar(dict(o.scalar(b'501'), tag='authenticated'))
        with self.assertRaises(o.IntegrityError):
            p.check_scalar(dict(o.scalar(b'501'), number=True))

    def test_nested_schema_refuses_extra_environment_payloads(self):
        command = {'argv': ['/usr/bin/id', '-A'], 'pid': 100, 'started_unix_s': 0,
                   'ended_unix_s': 1, 'timeout_s': 8, 'channel_bound': 32768,
                   'rc': 0, 'waited': True, 'timed_out': False, 'truncated': False,
                   'stdout_hex': '', 'stderr_hex': '', 'descendant_absence': 'fixture only'}
        value = {'schema': o.SCHEMA, 'context': 'plain', 'environment': o.snapshot_environment({}),
                 'scope': 'pure data fixture, never a native observation', 'uid': 501, 'euid': 501,
                 'gid': 20, 'egid': 20, 'groups': [20], 'pid': 100, 'ppid': 99, 'session_id': 99,
                 'process_group': 100, 'tty': {str(i): {'isatty': False, 'name': None, 'errno': 25}
                                            for i in range(3)},
                 'platform': 'darwin', 'interpreter': {k: 'fixture' for k in
                    ('path', 'realpath', 'version', 'flags', 'status')}, 'uname': ['fixture'] * 5,
                 'saved_uid': {'status': 'unavailable', 'reason': 'Python stdlib has no getresuid on Darwin'},
                 'audit': {'header': o.HEADER, 'struct_size': 48, 'struct_alignment': 8,
                           'offsets': {'auid': 0, 'mask': 4, 'terminal': 12, 'asid': 36, 'flags': 40},
                           'getauid': {'rc': 0, 'errno': 0, 'raw_hex': 'f5010000', 'value': o.scalar(b'501')},
                           'getaudit_addr': {'rc': -1, 'errno': 5, 'length': 48, 'raw_hex': None,
                                             'decoded': None}, 'id_A': command}}
        with mock.patch.object(p.sys, 'platform', 'darwin'):
            p.check_observation(value, 'plain', 501)
            value['audit']['getaudit_addr']['raw_hex'] = '00' * 48
            with self.assertRaises(o.IntegrityError):
                p.check_observation(value, 'plain', 501)
            value['audit']['getaudit_addr']['raw_hex'] = None
            original_uid = value['audit']['getauid']
            value['audit']['getauid'] = {'rc': -1, 'errno': 1, 'raw_hex': 'ffffffff',
                                        'value': o.scalar(error={'errno': 1})}
            with self.assertRaises(o.IntegrityError):
                p.check_observation(value, 'plain', 501)
            value['audit']['getauid']['raw_hex'] = None
            p.check_observation(value, 'plain', 501)
            value['audit']['getauid'] = original_uid
            for target in (value['interpreter'], value['tty']['0'], value['saved_uid'], value['audit']):
                target['extra_environment_values'] = {'CANARY': 'not permitted'}
                with self.assertRaises(o.IntegrityError):
                    p.check_observation(value, 'plain', 501)
                del target['extra_environment_values']
        value['platform'] = 'linux'
        value['saved_uid'] = {'getresuid': [501, 501, 501], 'getresgid': [20, 20, 20],
                              'status_lines': ['Uid: 501 501 501 501', 'Gid: 20 20 20 20']}
        value['audit'] = {'loginuid': o.scalar(b'4294967295'), 'sessionid': o.scalar(b'4294967295')}
        with mock.patch.object(p.sys, 'platform', 'linux'):
            p.check_observation(value, 'plain', 501)
            value['saved_uid']['status_lines'][0] = 'Uid: 501 501 0 501'
            with self.assertRaises(o.IntegrityError):
                p.check_observation(value, 'plain', 501)

    def test_abi_layout_is_explicit_without_calling_native_api(self):
        self.assertEqual(o.ctypes.sizeof(o.AuditInfo), 48)
        self.assertEqual(o.ctypes.alignment(o.AuditInfo), 8)
        self.assertEqual({n: getattr(o.AuditInfo, n).offset for n, _ in o.AuditInfo._fields_},
                         {'auid': 0, 'mask': 4, 'terminal': 12, 'asid': 36, 'flags': 40})
        self.assertEqual(o.HEADER['commit'], 'f6217f891ac0bb64f3d375211650a4c1ff8ca1ea')

    def test_source_has_no_identity_writes_or_environment_replacement(self):
        for name in ('ci_audit_identity_observer.py', 'probe_ci_audit_identity.py'):
            source = (STEP / name).read_text()
            tree = static_no_identity_writes(source, name)
            self.assertNotIn('environ.clear', source)
            self.assertNotIn('environ.update', source)
            if name == 'ci_audit_identity_observer.py':
                self.assertIsInstance(tree.body[0], ast.Assign)
                self.assertEqual(ast.unparse(tree.body[0].targets[0]), 'STARTUP')
        driver = (STEP / 'probe_ci_audit_identity.py').read_text()
        self.assertIn("'LC_ALL=C', '/usr/bin/sudo', '-n', *payload", driver)
        self.assertNotIn("'/usr/bin/sudo', '-S'", driver)
        self.assertNotIn("'/usr/bin/sudo', '-A'", driver)
        self.assertIn('os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600', driver)

    def test_dead_write_forms_fail_the_static_assertion_without_execution(self):
        forms = [
            'open("/proc/self/loginuid", "w")',
            'io.open("/proc/self/loginuid", "w")',
            'os.open("/proc/self/loginuid", os.O_WRONLY)',
            'pathlib.Path("/proc/self/loginuid").open("w")',
            'pathlib.Path("/proc/self/loginuid").write_text("501")',
            'pathlib.Path("/proc/self/loginuid").write_bytes(b"501")',
            'library.setauid(None)',
            'getattr(library, "setaudit_addr")(None, 0)',
        ]
        for name in ('ci_audit_identity_observer.py', 'probe_ci_audit_identity.py'):
            baseline = (STEP / name).read_text()
            for form in forms:
                with self.subTest(file=name, form=form):
                    with self.assertRaises(AssertionError):
                        static_no_identity_writes(baseline + '\nif False:\n    ' + form + '\n', name)

    def test_failed_darwin_calls_never_emit_initialized_buffers_as_raw(self):
        def failure(*args):
            o.ctypes.set_errno(1)
            return -1
        library = type('FakeLibrary', (), {})()
        library.getauid = failure
        library.getaudit_addr = failure
        with mock.patch.object(o.ctypes, 'CDLL', return_value=library), mock.patch.object(o, 'child', return_value={'fixture': True}):
            result = o.darwin_audit()
        self.assertEqual(result['getauid']['rc'], -1)
        self.assertEqual(result['getauid']['errno'], 1)
        self.assertIsNone(result['getauid']['raw_hex'])
        self.assertIsNone(result['getauid']['value']['raw_hex'])
        self.assertIsNone(result['getauid']['value']['number'])
        self.assertEqual(result['getauid']['value']['tag'], 'read-error')
        self.assertEqual(result['getaudit_addr']['rc'], -1)
        self.assertEqual(result['getaudit_addr']['errno'], 1)
        self.assertIsNone(result['getaudit_addr']['raw_hex'])
        self.assertIsNone(result['getaudit_addr']['decoded'])
        self.assertIsNone(o.scalar(b'4294967295', {'errno': 1})['raw_hex'])
        with self.assertRaises(o.IntegrityError):
            p.check_scalar({'tag': 'read-error', 'raw_hex': 'ffffffff', 'number': 4294967295, 'error': {'errno': 1}})


if __name__ == '__main__':
    unittest.main()
