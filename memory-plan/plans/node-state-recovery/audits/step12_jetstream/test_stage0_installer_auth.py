import ctypes
import hashlib
import json
import os
import pathlib
import signal
import stat
import subprocess
import sys
import tempfile
import time
import unittest


STEP = pathlib.Path(__file__).resolve().parent
UUID = '00000000-0000-0000-0000-000000000003'
START = b'openclaw-stage0-owned-start-v1\n'
SUCCESS = b'installer-auth-observed-v1\n'
SHELL = '/bin/bash' if sys.platform == 'darwin' else '/usr/bin/bash'
HASH_TOOL = ['/usr/bin/openssl', 'dgst', '-sha256'] if sys.platform == 'darwin' else ['/usr/bin/sha256sum']
SCRIPT = pathlib.Path(os.environ.get('OPENCLAW_STAGE0_TEST_SCRIPT', str(STEP / 'stage0_installer_auth.sh')))
RETAINED = set()


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def manifest(raw):
    return ('openclaw-installer-v1\nhost_release_publish.py\n' + str(len(raw)) + '\n' + sha(raw) + '\n').encode()


def native_hash(raw, user=None, group=None):
    options = {} if user is None else {'user': user, 'group': group, 'extra_groups': []}
    result = subprocess.run(HASH_TOOL, input=raw, capture_output=True,
                            env={}, cwd='/', timeout=10, **options)
    assert result.returncode == 0 and not result.stderr, 'native digest command failed'
    expected = sha(raw).encode() + (b'\n' if sys.platform == 'darwin' else b'  -\n')
    assert result.stdout == expected, 'native digest output differs'
    return result.stdout[:64].decode()


def native_tools():
    common = ['/usr/bin/env', '/usr/bin/head', '/usr/bin/stat', '/usr/bin/uname', SHELL]
    extra = ['/bin/ls', '/usr/bin/xattr', '/usr/bin/openssl'] if sys.platform == 'darwin' else [
        '/usr/bin/ls', '/usr/bin/getfacl', '/usr/bin/getfattr', '/usr/bin/lsattr', '/usr/bin/sha256sum']
    result = []
    for name in common + extra:
        info = os.lstat(name)
        assert stat.S_ISREG(info.st_mode) and info.st_uid == 0 and not info.st_mode & 0o022, name
        with open(name, 'rb') as stream:
            magic = stream.read(4)
        allowed = (b'\xca\xfe\xba\xbe', b'\xbe\xba\xfe\xca', b'\xcf\xfa\xed\xfe', b'\xfe\xed\xfa\xcf', b'\xca\xfe\xba\xbf') if sys.platform == 'darwin' else (b'\x7fELF',)
        assert magic in allowed, 'OS tool is not a recognized native format: ' + name
        result.append({'path': name, 'device': info.st_dev, 'inode': info.st_ino,
                       'native_format_prefix': magic.hex()})
    return result


def executable(pid):
    if sys.platform != 'darwin':
        return os.readlink('/proc/' + str(pid) + '/exe')
    library = ctypes.CDLL('/usr/lib/libproc.dylib', use_errno=True)
    call = library.proc_pidpath
    call.argtypes = [ctypes.c_int, ctypes.c_void_p, ctypes.c_uint32]
    call.restype = ctypes.c_int
    buffer = ctypes.create_string_buffer(4096)
    count = call(pid, buffer, len(buffer))
    if count <= 0:
        raise OSError(ctypes.get_errno(), 'owned executable observation unavailable')
    return os.fsdecode(buffer.value)


def absent_group(pid):
    try:
        os.killpg(pid, 0)
    except ProcessLookupError:
        return True
    return False


def launch(base, expected_script, expected_installer, expected_manifest,
           op_uid=None, capture_uid=None, arguments=None, env_values=None,
           shell_flags=None, start=START, observe=True, during=None, timeout=30,
           user=None, group=None, parent_environment=None, hold_stdin_open=False,
           early_refusal_reason=None, observation_delay=0):
    base = pathlib.Path(base)
    path = base / 'stage0_installer_auth.sh'
    fd = os.open(str(path), os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    try:
        info = os.fstat(fd)
        assert stat.S_ISREG(info.st_mode) and 0 < info.st_size <= 65536
        raw = os.read(fd, 65537)
        assert len(raw) == info.st_size
    finally:
        os.close(fd)
    if native_hash(raw, user=user, group=group) != expected_script:
        return {'rc': 1, 'out': b'', 'err': b'fixture script pre-authentication refused\n',
                'worker': False, 'script_prehashed': False, 'group_absent': True}
    op_uid = os.getuid() if op_uid is None else op_uid
    capture_uid = (65534 if op_uid != 65534 else 65532) if capture_uid is None else capture_uid
    arguments = ['--ci-owned', UUID, str(op_uid), str(capture_uid), str(base),
                 expected_installer, expected_manifest] if arguments is None else arguments
    values = ['CI=true', 'GITHUB_ACTIONS=true', 'LC_ALL=C'] if env_values is None else env_values
    flags = ['--noprofile', '--norc', '-p', '-f'] if shell_flags is None else shell_flags
    command = ['/usr/bin/env', '-i'] + values + [SHELL] + flags + [str(path)] + arguments
    options = {} if user is None else {'user': user, 'group': group, 'extra_groups': []}
    worker = subprocess.Popen(command, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                              stderr=subprocess.PIPE, cwd='/', env=parent_environment or {}, start_new_session=True,
                              **options)
    begin = time.monotonic()
    observations = []
    seen = False
    failure = None
    handshake_sent = False
    allowed_transients = {str(pathlib.Path(sys.executable).resolve()), '/usr/bin/env'}
    stdout = stderr = b''
    try:
        if observation_delay:
            time.sleep(observation_delay)
        while not seen and time.monotonic() - begin < 5:
            if worker.poll() is not None:
                break
            try:
                actual = executable(worker.pid) if observe else None
            except OSError as error:
                try:
                    worker.wait(timeout=0.05)
                    break
                except subprocess.TimeoutExpired:
                    raise error
            if actual == SHELL:
                observations.append(actual)
                seen = True
            elif actual not in allowed_transients:
                raise RuntimeError('unexpected executable before rendezvous')
            else:
                time.sleep(0.0001)
        if not seen:
            if worker.poll() is None:
                raise RuntimeError('no final-shell observation')
        else:
            try:
                worker.stdin.write(start)
                worker.stdin.flush()
                if not hold_stdin_open:
                    worker.stdin.close()
                    worker.stdin = None
                handshake_sent = True
            except BrokenPipeError:
                try:
                    worker.stdin.close()
                except BrokenPipeError:
                    pass
                worker.stdin = None
                worker.wait(timeout=1)
            if handshake_sent and during is not None:
                during(worker)
        while worker.poll() is None:
            if time.monotonic() - begin >= timeout:
                raise RuntimeError('owned worker deadline')
            try:
                actual = executable(worker.pid)
            except OSError as error:
                try:
                    worker.wait(timeout=0.05)
                    break
                except subprocess.TimeoutExpired:
                    raise error
            if actual != SHELL:
                raise RuntimeError('final-shell executable drift')
            if len(observations) < 32:
                observations.append(actual)
            time.sleep(0.005)
        stdout, stderr = worker.communicate(timeout=5)
    except BaseException as error:
        failure = str(error)
        if worker.poll() is None:
            try:
                os.killpg(worker.pid, signal.SIGKILL)
            except (ProcessLookupError, PermissionError):
                try:
                    worker.wait(timeout=1)
                except subprocess.TimeoutExpired:
                    RETAINED.add(str(base))
                    raise RuntimeError('owned worker unresolved; retain fixture')
        try:
            stdout, stderr = worker.communicate(timeout=5)
        except BaseException:
            RETAINED.add(str(base))
            raise
    gone = absent_group(worker.pid)
    if not gone:
        RETAINED.add(str(base))
    assert gone, 'owned worker group unresolved; retain fixture'
    early = (not seen or not handshake_sent) and early_refusal_reason is not None and (
        worker.returncode == 1 and not stdout and
        stderr == ('installer authentication refused: ' + early_refusal_reason + '\n').encode()
        and failure is None)
    if not seen and not early and failure is None:
        failure = 'exited before final-shell observation'
    return {'rc': worker.returncode, 'out': stdout, 'err': stderr, 'worker': True,
            'pid': worker.pid, 'waited': True, 'group_absent': gone,
            'failure': failure, 'shell_observed': seen, 'executables': observations,
            'handshake_sent': handshake_sent, 'early_refusal': early,
            'script_prehashed': True, 'argv': command, 'elapsed_s': time.monotonic() - begin}


class Fixture:
    def __init__(self):
        selected = os.environ.get('OPENCLAW_STAGE0_TEST_PARENT')
        if selected is not None:
            parent = pathlib.Path(selected)
            info = parent.lstat()
            assert os.environ.get('CI') == os.environ.get('GITHUB_ACTIONS') == 'true'
            assert parent.parent == pathlib.Path('/var/lib') and parent.name.startswith('openclaw-stage0-tests-owned-')
            assert str(parent) == str(parent.resolve()) and stat.S_ISDIR(info.st_mode)
            assert info.st_uid == os.getuid() and stat.S_IMODE(info.st_mode) == 0o700
            assert str(info.st_dev) == os.environ['OPENCLAW_STAGE0_TEST_PARENT_DEV']
            assert str(info.st_ino) == os.environ['OPENCLAW_STAGE0_TEST_PARENT_INO']
        else:
            parent = pathlib.Path(os.environ.get('GITHUB_WORKSPACE', str(pathlib.Path.home()))).resolve()
        self.temporary = tempfile.TemporaryDirectory(prefix='openclaw-stage0-auth-owned-', dir=str(parent))
        self.base = pathlib.Path(self.temporary.name)
        os.chmod(self.base, 0o700)
        self.script = self.base / 'stage0_installer_auth.sh'
        self.installer = self.base / 'host_release_publish.py'
        self.manifest = self.base / 'installer.manifest'
        self.script.write_bytes(SCRIPT.read_bytes())
        self.set_installer((STEP / 'host_release_publish.py').read_bytes())
        self.script.chmod(0o600)

    def set_installer(self, raw):
        self.installer.write_bytes(raw)
        self.installer.chmod(0o600)
        self.manifest.write_bytes(manifest(raw))
        self.manifest.chmod(0o600)

    def invoke(self, **kw):
        return launch(self.base, kw.pop('expected_script', sha(self.script.read_bytes())),
                      kw.pop('expected_installer', sha(self.installer.read_bytes())),
                      kw.pop('expected_manifest', sha(self.manifest.read_bytes())), **kw)

    def cleanup(self):
        if str(self.base) in RETAINED:
            self.temporary._finalizer.detach()
            raise RuntimeError('unresolved owned worker; fixture retained at ' + str(self.base))
        self.temporary.cleanup()


class AuthenticationTests(unittest.TestCase):
    def setUp(self):
        self.fixture = Fixture()
        self.addCleanup(self.fixture.cleanup)

    def honest(self, **kw):
        result = self.fixture.invoke(**kw)
        if result['rc'] != 0 and sys.platform != 'darwin':
            diagnostic = []
            for path in list(reversed(self.fixture.base.parents)) + [self.fixture.base]:
                if len(diagnostic) >= 64: break
                try:
                    done = subprocess.run(['/usr/bin/getfacl', '-cpn', '--absolute-names', str(path)],
                                          env={}, capture_output=True, timeout=3)
                except FileNotFoundError:
                    diagnostic.append({'path': str(path), 'missing_tool': '/usr/bin/getfacl'})
                    break
                diagnostic.append({'path': str(path), 'rc': done.returncode,
                                   'acl': done.stdout[:4096].decode(errors='replace'),
                                   'record_truncated': len(done.stdout) > 4096,
                                   'error': done.stderr[:256].decode(errors='replace')})
            print('OWNED ACL DIAGNOSTIC ' + json.dumps(diagnostic, sort_keys=True), flush=True)
        self.assertIsNone(result.get('failure'), result)
        self.assertEqual(result['rc'], 0, result)
        self.assertEqual(result['out'], SUCCESS, result)
        self.assertEqual(result['err'], b'', result)
        self.assertTrue(result['shell_observed'] and result['group_absent'])
        return result

    def refused(self, reason=None, **kw):
        if reason in ('arguments', 'roles', 'environment', 'approvals', 'path', 'fixture'):
            kw.setdefault('early_refusal_reason', reason)
        result = self.fixture.invoke(**kw)
        self.assertIsNone(result.get('failure'), result)
        self.assertNotEqual(result['rc'], 0, result)
        self.assertNotIn(SUCCESS, result['out'], result)
        if reason is not None:
            self.assertIn(reason.encode(), result['err'], result)
        return result

    def pause(self, before):
        ready = self.fixture.base.parent / (self.fixture.base.name + '-ready')
        resume = self.fixture.base.parent / (self.fixture.base.name + '-resume')
        self.addCleanup(lambda: ready.unlink(missing_ok=True))
        self.addCleanup(lambda: resume.unlink(missing_ok=True))
        original = self.fixture.script.read_text()
        self.assertEqual(original.count(before), 1)
        code = 'builtin printf ready > "' + str(ready) + '"\nwhile [[ ! -f "' + str(resume) + '" ]]; do /bin/sleep 0.01; done\n'
        self.fixture.script.write_text(original.replace(before, code + before))
        def act(worker):
            deadline = time.monotonic() + 10
            while not ready.exists() and time.monotonic() < deadline and worker.poll() is None:
                time.sleep(0.005)
            self.assertTrue(ready.exists(), 'instrumented fault rendezvous not reached')
            self.fixture.installer.write_bytes(b'!' * self.fixture.installer.stat().st_size)
            resume.write_text('go')
        return act

    def polyglot(self):
        marker = self.fixture.base / 'BAD'
        code = ('#!/bin/sh\n""":"\nprintf BAD > "' + str(marker) + '"\nexit 0\n":"""\n'
                'with open(' + repr(str(marker)) + ',"w") as f:\n    f.write("BAD")\n').encode()
        return marker, code

    def test_honest_exact_publisher_is_inert_and_uses_observed_final_shell(self):
        native_tools()
        before = {p.name: p.read_bytes() for p in self.fixture.base.iterdir()}
        result = self.honest()
        self.assertEqual(set(result['executables']), {SHELL})
        self.assertEqual(before, {p.name: p.read_bytes() for p in self.fixture.base.iterdir()})
        self.assertEqual(self.fixture.manifest.read_bytes(), (STEP / 'installer.manifest').read_bytes())

    def test_approved_polyglot_never_executes_under_any_interpreter(self):
        marker, code = self.polyglot()
        self.fixture.set_installer(code)
        for command in [[SHELL, '--noprofile', '--norc', '-p'], [sys.executable, '-I', '-S', '-B']]:
            result = subprocess.run(command + [str(self.fixture.installer)], capture_output=True, timeout=5)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(marker.read_bytes(), b'BAD')
            marker.unlink()
        result = self.fixture.invoke()
        self.assertFalse(marker.exists(), 'BAD installer was executed')
        self.assertEqual(result['rc'], 0, result)
        self.assertEqual(result['out'], SUCCESS, result)

    def test_external_script_approval_precedes_any_script_text(self):
        expected = sha(self.fixture.script.read_bytes())
        marker = self.fixture.base / 'BAD'
        self.fixture.script.write_text('builtin printf BAD > "' + str(marker) + '"\n' + self.fixture.script.read_text())
        result = self.fixture.invoke(expected_script=expected)
        self.assertFalse(marker.exists(), 'BAD unapproved script was executed')
        self.assertFalse(result['worker'], result)
        self.assertIn(b'pre-authentication', result['err'])

    def test_manifest_approval_precedes_interpretation(self):
        self.fixture.manifest.write_bytes(b'not a manifest\n')
        self.refused('manifest-approval', expected_manifest='0' * 64)
        self.refused('schema')

    def test_installer_requires_its_separately_expected_approval(self):
        self.refused('installer-approval', expected_installer='0' * 64)

    def test_self_consistent_unapproved_replacement_refuses(self):
        old_installer = sha(self.fixture.installer.read_bytes())
        old_manifest = sha(self.fixture.manifest.read_bytes())
        marker, code = self.polyglot()
        self.fixture.set_installer(code)
        self.refused('manifest-approval', expected_installer=old_installer, expected_manifest=old_manifest)
        self.assertFalse(marker.exists())

    def test_noncanonical_manifest_fields_and_bytes_refuse(self):
        raw = self.fixture.manifest.read_bytes()
        parts = raw.splitlines()
        variants = [raw + b'\n', raw[:-1], raw.replace(b'\n', b'\r\n'), raw + b'X',
                    raw.replace(b'17889', b'017889'), raw.replace(b'openclaw-installer-v1', b'openclaw-installer-v2'),
                    raw.replace(b'host_release_publish.py', b'other.py'),
                    b'\n'.join(parts[:2] + [b'0'] + parts[3:]) + b'\n',
                    b'\n'.join(parts[:3] + [parts[3].upper()]) + b'\n', raw.replace(b'v1', b'v\x001')]
        for value in variants:
            with self.subTest(value=value[:40]):
                self.fixture.manifest.write_bytes(value)
                self.refused('canonical' if b'\x00' in value else 'schema')

    def test_declared_size_and_actual_installer_bytes_are_required(self):
        original = self.fixture.installer.read_bytes()
        expected = sha(original)
        self.fixture.installer.write_bytes(b'!' * len(original))
        self.refused('installer-bytes', expected_installer=expected)
        self.fixture.installer.write_bytes(original + b'!')
        self.refused('installer-size', expected_installer=expected)

    def test_size_bounds_refuse_before_reading(self):
        self.fixture.manifest.write_bytes(b'X' * 513)
        self.refused('size')
        self.fixture.set_installer(b'X' * 131073)
        self.refused('size')

    def test_links_hardlinks_fifo_directory_refuse(self):
        raw = self.fixture.installer.read_bytes()
        outside = self.fixture.base.parent / (self.fixture.base.name + '-other')
        outside.write_bytes(raw)
        outside.chmod(0o600)
        self.addCleanup(lambda: outside.unlink(missing_ok=True))
        self.fixture.installer.unlink()
        self.fixture.installer.symlink_to(outside)
        self.refused('link', expected_installer=sha(raw))
        self.fixture.installer.unlink()
        os.link(outside, self.fixture.installer)
        self.refused('private', expected_installer=sha(raw))
        self.fixture.installer.unlink()
        os.mkfifo(self.fixture.installer, 0o600)
        result = launch(self.fixture.base, sha(self.fixture.script.read_bytes()), sha(raw), sha(self.fixture.manifest.read_bytes()))
        self.assertIsNone(result['failure'], result)
        self.assertNotEqual(result['rc'], 0)
        self.assertLess(result['elapsed_s'], 15)
        self.fixture.installer.unlink()
        self.fixture.installer.mkdir(mode=0o600)
        result = launch(self.fixture.base, sha(self.fixture.script.read_bytes()), sha(raw), sha(self.fixture.manifest.read_bytes()))
        self.assertIsNone(result['failure'], result)
        self.assertNotEqual(result['rc'], 0)

    def test_private_modes_and_writable_ancestors_refuse(self):
        self.fixture.installer.chmod(0o640)
        self.refused('type')
        self.fixture.installer.chmod(0o600)
        self.fixture.base.chmod(0o770)
        self.refused('writable')
        self.fixture.base.chmod(0o700)

    def test_real_private_xattr_refuses(self):
        name = 'com.openclaw.stage0' if sys.platform == 'darwin' else 'user.openclaw.stage0'
        if sys.platform == 'darwin':
            subprocess.run(['/usr/bin/xattr', '-w', name, 'fixture', str(self.fixture.installer)], check=True)
        else:
            os.setxattr(self.fixture.installer, name, b'fixture')
        self.refused('xattrs')
        if sys.platform == 'darwin':
            subprocess.run(['/usr/bin/xattr', '-d', name, str(self.fixture.installer)], check=True)
        else:
            os.removexattr(self.fixture.installer, name)

    def test_exact_entry_set_refuses_extra_or_missing(self):
        (self.fixture.base / 'extra').write_text('inert')
        self.refused('entries')
        (self.fixture.base / 'extra').unlink()
        self.fixture.manifest.unlink()
        result = launch(self.fixture.base, sha(self.fixture.script.read_bytes()), '0' * 64, '0' * 64)
        self.assertIsNone(result['failure'], result)
        self.assertNotEqual(result['rc'], 0)

    def test_exact_arguments_roles_environment_and_flags(self):
        args = ['--ci-owned', UUID, str(os.getuid()), str(65534 if os.getuid() != 65534 else 65532), str(self.fixture.base),
                sha(self.fixture.installer.read_bytes()), sha(self.fixture.manifest.read_bytes())]
        for value in [args + ['extra'], ['--other'] + args[1:], [args[0], 'other'] + args[2:]]:
            self.refused('arguments', arguments=value)
        for index, value, reason in [(2, '0', 'roles'), (2, '0501', 'roles'), (3, str(os.getuid()), 'roles'), (4, str(self.fixture.base) + '/..', 'fixture'), (5, 'A' * 64, 'approvals')]:
            changed = args[:]; changed[index] = value
            self.refused(reason, arguments=changed)
        for values in [['GITHUB_ACTIONS=true', 'LC_ALL=C'], ['CI=true', 'GITHUB_ACTIONS=true', 'LC_ALL=C', 'UNKNOWN=x']]:
            self.refused('environment', env_values=values)
        self.refused('environment', shell_flags=['--noprofile', '--norc', '-p'])

    def test_clean_launch_discards_startup_environment(self):
        marker = self.fixture.base.parent / (self.fixture.base.name + '-BAD')
        poison = self.fixture.base.parent / (self.fixture.base.name + '-startup')
        poison.write_text('printf BAD > "' + str(marker) + '"\n')
        self.addCleanup(lambda: marker.unlink(missing_ok=True))
        self.addCleanup(lambda: poison.unlink(missing_ok=True))
        result = self.fixture.invoke(parent_environment={'BASH_ENV': str(poison), 'UNKNOWN': 'fixture'})
        self.assertFalse(marker.exists())
        self.assertIsNone(result['failure'], result)
        self.assertEqual(result['rc'], 0, 'fixed launch did not clear inherited startup keys: ' + str(result))
        self.assertEqual(result['out'], SUCCESS)

    def test_rendezvous_requires_exact_line_eof_and_observation(self):
        self.refused('rendezvous', start=b'wrong\n')
        self.refused('rendezvous', start=START + b'extra\n')
        result = self.fixture.invoke(observe=False)
        self.assertIsNotNone(result['failure'])
        self.assertTrue(result['waited'] and result['group_absent'])
        self.assertNotEqual(result['rc'], 0)

    def test_interruption_kills_waits_and_preserves_inert_inputs(self):
        before = self.fixture.installer.read_bytes()
        result = self.fixture.invoke(during=lambda worker: os.killpg(worker.pid, signal.SIGKILL))
        self.assertEqual(result['rc'], -9)
        self.assertTrue(result['waited'] and result['group_absent'])
        self.assertEqual(result['out'], b'')
        self.assertEqual(self.fixture.installer.read_bytes(), before)

    def test_held_open_stdin_never_counts_as_eof(self):
        result = self.fixture.invoke(hold_stdin_open=True, timeout=2)
        self.assertEqual(result['rc'], -9, result)
        self.assertEqual(result['failure'], 'owned worker deadline', result)
        self.assertEqual(result['out'], b'', result)
        self.assertTrue(result['waited'] and result['group_absent'])

    def test_exact_early_role_refusal_is_negative_not_shell_proof(self):
        other = 65533 if os.getuid() != 65533 else 65532
        result = self.fixture.invoke(op_uid=other, early_refusal_reason='roles', observation_delay=0.05)
        self.assertEqual(result['rc'], 1, result)
        self.assertEqual(result['err'], b'installer authentication refused: roles\n')
        self.assertEqual(result['out'], b'')
        self.assertTrue(result['early_refusal'] and result['waited'] and result['group_absent'])
        self.assertFalse(result['shell_observed'] or result['handshake_sent'])
        self.assertIsNone(result['failure'])

    def test_observed_drift_before_final_hash_refuses(self):
        during = self.pause('[[ "$(hash_path "$manifest" "$manifest_record" 3 512)" == "$expected_manifest" ]] || refuse final-manifest')
        self.refused(during=during)

    def test_cooperative_budget_refuses_before_success(self):
        raw = self.fixture.script.read_text()
        self.fixture.script.write_text(raw.replace('SECONDS=0', 'SECONDS=60', 1))
        self.refused('deadline')


if __name__ == '__main__':
    unittest.main()
