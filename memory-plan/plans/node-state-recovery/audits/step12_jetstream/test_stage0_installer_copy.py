import base64
import contextlib
import hashlib
import json
import os
import pathlib
import pwd
import re
import shutil
import signal
import stat
import subprocess
import sys
import tempfile
import time
import unittest

from test_stage0_installer_auth import UUID, START, SHELL, HASH_TOOL, native_hash, native_tools, executable, absent_group, manifest, sha


STEP = pathlib.Path(__file__).resolve().parent
SCRIPT = pathlib.Path(os.environ.get('OPENCLAW_STAGE0_COPY_TEST_SCRIPT', str(STEP / 'stage0_installer_copy.sh')))
SUCCESS = b'root-copy-observed-v1\n'
OPERATOR = 65533
REPORT = {'schema': 'openclaw-stage0-root-copy-owned-v1', 'completed': False, 'cases': [],
          'fixtures': [], 'workers': [], 'attempts': [], 'observations': [], 'cleanup': {'removed': False},
          'scope': 'CI-owned inert copy observation; no startup, installation, fsync or durable fence',
          'tool_dispatcher_absence': 'fixed platform assumption; only final Bash observed live'}


def identity(path):
    s = os.lstat(path)
    return {k: getattr(s, 'st_' + k) for k in ('dev', 'ino', 'mode', 'uid', 'gid', 'nlink', 'size', 'mtime_ns', 'ctime_ns')} | {'flags': getattr(s, 'st_flags', 0)}


def observe(command, timeout=5):
    begin = time.monotonic()
    p = subprocess.Popen(command, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                         env={'LC_ALL': 'C'}, cwd='/', start_new_session=True)
    try:
        out, err = p.communicate(timeout=timeout)
    except subprocess.TimeoutExpired:
        os.killpg(p.pid, signal.SIGKILL)
        p.communicate(timeout=5)
        raise
    assert absent_group(p.pid), 'observation group remains'
    row = {'argv': command, 'timeout_s': timeout, 'rc': p.returncode,
           'out': out[:4096].decode(errors='replace'), 'err': err[:4096].decode(errors='replace'),
           'output_limit': 4096, 'complete_channels': len(out) <= 4096 and len(err) <= 4096,
           'elapsed_s': time.monotonic() - begin, 'waited': True, 'group_absent': True}
    REPORT['observations'].append(row)
    assert row['complete_channels'] and p.returncode == 0 and not err, row
    return out


def attributes(path):
    if sys.platform == 'darwin':
        return {'acl': observe(['/bin/ls', '-lde', str(path)]).decode(),
                'xattrs': observe(['/usr/bin/xattr', '-s', str(path)]).decode()}
    return {'acl': observe(['/usr/bin/getfacl', '-cpn', '--absolute-names', str(path)]).decode(),
            'xattrs': observe(['/usr/bin/getfattr', '-m', '-', '--absolute-names', str(path)]).decode(),
            'flags': observe(['/usr/bin/lsattr', '-d', str(path)]).decode()}


def preflight(code, expected):
    before = identity(code)
    storage = []
    for path in [code] + list(code.parents):
        s = os.lstat(path)
        assert not stat.S_ISLNK(s.st_mode) and s.st_uid == 0 and not s.st_mode & 0o022, 'root code storage protection'
        if path == code:
            assert stat.S_ISREG(s.st_mode) and stat.S_IMODE(s.st_mode) == 0o600 and s.st_nlink == 1 and 0 < s.st_size <= 65536
        else:
            assert stat.S_ISDIR(s.st_mode)
        if path == code.parent:
            assert stat.S_IMODE(s.st_mode) == 0o700
        if path in (code, code.parent): assert not getattr(s, 'st_flags', 0)
        a = attributes(path)
        if sys.platform == 'darwin':
            rows = a['acl'].splitlines()[1:]
            assert not rows if path in (code, code.parent) else all(re.fullmatch(r'\s*\d+: (user|group):[a-zA-Z0-9_-]+ deny [a-z_,]+', line) for line in rows)
            if path in (code, code.parent): assert not a['xattrs']
        else:
            rows = a['acl'].rstrip('\n').splitlines()
            assert len(rows) == 3 and all(line.startswith(('user::', 'group::', 'other::')) for line in rows)
            assert set(a['flags'].split()[0]) <= set('-e')
            if path in (code, code.parent): assert not a['xattrs']
        storage.append({'path':str(path),'metadata':identity(path),'attributes':a})
    fd = os.open(str(code), os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    try:
        current = os.fstat(fd)
        assert current.st_dev == before['dev'] and current.st_ino == before['ino']
        raw = os.read(fd, 65537)
        assert len(raw) == before['size'] and 0 < len(raw) <= 65536 and identity(code) == before
        after = os.fstat(fd)
        assert all(getattr(after, 'st_'+k) == getattr(current, 'st_'+k) for k in
                   ('dev','ino','mode','uid','gid','nlink','size','mtime_ns','ctime_ns'))
    finally: os.close(fd)
    begin = time.monotonic(); actual = native_hash(raw)
    row = {'argv':HASH_TOOL,'stdin_scope':'exact held protected script bytes','timeout_s':10,'bytes':len(raw),
           'sha256':actual,'validated_rc0_exact_output':True,'elapsed_s':time.monotonic()-begin,'storage':storage}
    REPORT['observations'].append(row)
    assert actual == expected, 'root script pre-authentication refused'
    return row


def close_stdin(p):
    broken=False
    try: p.stdin.close()
    except BrokenPipeError: broken=True
    p.stdin=None
    return broken


def launch(code, arguments, expected, during=None, early=None, timeout=45, expected_timeout=False):
    result = {'worker': False, 'script_prehashed': False, 'out': b'', 'err': b'',
              'rc': 1, 'waited': True, 'group_absent': True, 'failure': None,
              'shell_observed': False, 'handshake_sent': False, 'early_refusal': False}
    try:
        result['preflight'] = preflight(code, expected)
    except AssertionError as error:
        result['err'] = str(error).encode()
        return result
    command = ['/usr/bin/env', '-i', 'CI=true', 'GITHUB_ACTIONS=true', 'LC_ALL=C',
               SHELL, '--noprofile', '--norc', '-p', '-f', str(code)] + arguments
    p = subprocess.Popen(command, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                         cwd='/', env={}, user=0, group=0, extra_groups=[], start_new_session=True)
    result.update(worker=True, script_prehashed=True, pid=p.pid, argv=command, timeout_s=timeout,
                  stdout_limit=4096, stderr_limit=4096, actual_executables=[])
    begin = time.monotonic()
    try:
        while p.poll() is None and time.monotonic() - begin < 5:
            try: actual = executable(p.pid)
            except (OSError, ProcessLookupError):
                time.sleep(0.005)
                continue
            if actual == SHELL:
                result['shell_observed'] = True
                result['actual_executables'].append(actual)
                break
            assert os.path.realpath(actual) in {os.path.realpath(sys.executable), '/usr/bin/env'}, actual
            time.sleep(0.005)
        if result['shell_observed']:
            try:
                p.stdin.write(START); p.stdin.flush()
                result['handshake_sent'] = True
            except BrokenPipeError:
                result['stdin_write_broken']=True
        result['stdin_close_broken']=close_stdin(p)
        if during and p.poll() is None: during(p)
        monitored = time.monotonic() if expected_timeout else begin
        while p.poll() is None and time.monotonic() - monitored < timeout:
            try: actual = executable(p.pid)
            except (OSError, ProcessLookupError): actual = None
            if actual:
                assert actual == SHELL, 'observed final shell changed: ' + actual
            time.sleep(0.005)
        if p.poll() is None:
            os.killpg(p.pid, signal.SIGKILL)
            result['watchdog_killed'] = True
            if not expected_timeout: result['failure'] = 'owned worker deadline'
        out, err = p.communicate(timeout=5)
        assert len(out) <= 4096 and len(err) <= 4096, 'worker output cap'
        result.update(out=out, err=err, rc=p.returncode)
        result['group_absent'] = absent_group(p.pid)
        assert result['group_absent'], 'owned worker group remains'
        if not result['shell_observed'] or not result['handshake_sent']:
            assert early and p.returncode == 1 and not out and err == ('installer authentication refused: ' + early + '\n').encode(), result
            result['early_refusal'] = True
        if expected_timeout: assert result.get('watchdog_killed') and result['rc'] == -9
    except BaseException:
        if p.poll() is None: os.killpg(p.pid, signal.SIGKILL)
        p.communicate(timeout=5)
        result.update(rc=p.returncode, waited=True, group_absent=absent_group(p.pid), failure='harness exception')
        raise
    finally:
        result['elapsed_s'] = time.monotonic() - begin
        saved = dict(result)
        for key in ('out', 'err'): saved[key] = base64.b64encode(result[key]).decode()
        REPORT['workers'].append(saved)
    return result


class Fixture:
    def __init__(self, private=False):
        parent = pathlib.Path('/private/var/db' if sys.platform == 'darwin' else '/var/lib')
        self.outer = pathlib.Path(tempfile.mkdtemp(prefix='openclaw-stage0-copy-fixture-', dir=str(parent)))
        self.outer.chmod(0o700 if private else 0o755)
        self.source = self.outer / 'openclaw-stage0-copy-input-owned-source'
        self.root = self.outer / 'openclaw-stage0-copy-root-owned-root'
        self.source.mkdir(mode=0o700); self.root.mkdir(mode=0o700)
        self.installer = self.source / 'host_release_publish.py'
        self.manifest = self.source / 'installer.manifest'
        self.code = self.root / 'stage0_installer_copy.sh'
        self.code.write_bytes(SCRIPT.read_bytes()); self.code.chmod(0o600)
        self.set_installer((STEP / 'host_release_publish.py').read_bytes(), canonical=False)
        self.manifest.write_bytes((STEP / 'installer.manifest').read_bytes())
        for path in (self.source, self.installer, self.manifest): os.chown(path, OPERATOR, OPERATOR)
        for path in (self.installer, self.manifest): path.chmod(0o600)
        self.original = identity(self.outer)
        self.pending = self.root / ('pending-installer-' + sha(self.manifest.read_bytes()))
        self.row = {'path': str(self.outer), 'identity': self.original, 'removed': False}
        REPORT['fixtures'].append(self.row)
        self.first_worker = len(REPORT['workers'])
        self.instrumentation = []

    def set_installer(self, raw, canonical=True):
        self.installer.write_bytes(raw); self.installer.chmod(0o600); os.chown(self.installer, OPERATOR, OPERATOR)
        if canonical:
            self.manifest.write_bytes(manifest(raw)); self.manifest.chmod(0o600); os.chown(self.manifest, OPERATOR, OPERATOR)
            self.pending = self.root / ('pending-installer-' + sha(self.manifest.read_bytes()))

    def invoke(self, expected_installer=None, expected_manifest=None, expected_script=None, **options):
        args = ['--ci-owned-root-copy', UUID, str(OPERATOR), str(CAPTURE), str(self.source), str(self.root),
                expected_installer or sha(self.installer.read_bytes()), expected_manifest or sha(self.manifest.read_bytes())]
        args = options.pop('arguments', args)
        r = launch(self.code, args, expected_script or sha(self.code.read_bytes()), **options)
        saved = dict(r, requested_arguments=args, expected_script=expected_script or sha(self.code.read_bytes()), fixture=str(self.outer),
                     instrumentation=self.instrumentation, selected_source_sha256=sha(SCRIPT.read_bytes()), executed_variant_sha256=sha(self.code.read_bytes()))
        for key in ('out','err'): saved[key] = base64.b64encode(r[key]).decode()
        REPORT['attempts'].append(saved)
        return r

    def pause(self, anchor, callback):
        raw = self.code.read_text(); assert raw.count(anchor) == 1, anchor
        ready = self.outer / 'ready'; resume = self.outer / 'resume'
        ready.write_bytes(b''); resume.write_bytes(b'')
        injected = 'builtin printf ready > "' + str(ready) + '"\nwhile [[ ! -s "' + str(resume) + '" ]]; do :; done\n'
        self.code.write_text(raw.replace(anchor, injected + anchor))
        self.instrumentation.append({'kind':'fixed busy-loop rendezvous','anchor':anchor,'variant_sha256':sha(self.code.read_bytes())})
        def during(p):
            end = time.monotonic() + 8
            while ready.stat().st_size==0 and p.poll() is None and time.monotonic() < end: time.sleep(0.005)
            assert ready.stat().st_size>0, 'labelled pause not reached'
            callback(self, p)
            resume.write_bytes(b'resume')
        return during

    def snapshot(self):
        result = {}
        for folder in (self.source, self.root):
            for path in [folder] + sorted(folder.rglob('*')):
                s = os.lstat(path); row = {'metadata': identity(path)}
                if stat.S_ISREG(s.st_mode) and s.st_size <= 131586:
                    row.update(bytes=s.st_size, sha256=sha(path.read_bytes()))
                result[str(path)] = row
        return result

    def finish(self):
        self.row['final'] = self.snapshot()
        workers = REPORT['workers'][self.first_worker:]
        assert all(w['waited'] and w['group_absent'] and w['failure'] is None for w in workers), 'uncertain fixture workers'
        now = identity(self.outer)
        assert now['dev'] == self.original['dev'] and now['ino'] == self.original['ino'] and now['uid'] == 0
        assert self.outer.parent == pathlib.Path('/private/var/db' if sys.platform == 'darwin' else '/var/lib')
        assert self.outer.name.startswith('openclaw-stage0-copy-fixture-') and not self.outer.is_symlink()
        shutil.rmtree(self.outer); assert not self.outer.exists()
        self.row['removed'] = True


@contextlib.contextmanager
def fixture(name, private=False):
    f = Fixture(private); row = {'name': name, 'fixture': str(f.outer), 'completed': False}
    REPORT['cases'].append(row)
    try:
        yield f
        row['completed'] = True
    finally:
        f.finish()


class LocalTests(unittest.TestCase):
    def test_closed_pipe_close_is_accounted(self):
        p=subprocess.Popen([SHELL,'--noprofile','--norc','-p','-c','exit 0'],stdin=subprocess.PIPE,
                           stdout=subprocess.PIPE,stderr=subprocess.PIPE,env={},start_new_session=True)
        p.wait(timeout=5)
        with self.assertRaises(BrokenPipeError):
            p.stdin.write(START); p.stdin.flush()
        self.assertTrue(close_stdin(p))
        out,err=p.communicate(timeout=5)
        self.assertEqual((p.returncode,out,err),(0,b'',b'')); self.assertTrue(absent_group(p.pid))

    def test_no_implicit_shell_temporary_files(self):
        raw = SCRIPT.read_bytes()
        self.assertTrue(all(token not in raw for token in (b'<<', b'<(', b'>(')), 'implicit root temporary-file construct')

    def test_unprivileged_root_mode_refuses_before_metadata(self):
        self.assertNotEqual(os.getuid(), 0)
        with tempfile.TemporaryDirectory(prefix='openclaw-copy-role-') as directory:
            code = pathlib.Path(directory) / 'stage0_installer_copy.sh'; code.write_bytes(SCRIPT.read_bytes())
            self.assertEqual(native_hash(code.read_bytes()), sha(SCRIPT.read_bytes()))
            command = ['/usr/bin/env', '-i', 'CI=true', 'GITHUB_ACTIONS=true', 'LC_ALL=C', SHELL,
                       '--noprofile', '--norc', '-p', '-f', str(code), '--ci-owned-root-copy', UUID,
                       '65533', '65532', '/unread-source', '/unread-root', '0'*64, '0'*64]
            p = subprocess.Popen(command, stdout=subprocess.PIPE, stderr=subprocess.PIPE, cwd='/', env={}, start_new_session=True)
            out, err = p.communicate(timeout=5)
            self.assertTrue(absent_group(p.pid))
            self.assertEqual((p.returncode, out, err), (1, b'', b'installer authentication refused: roles\n'), 'root role must refuse before metadata')
            self.assertEqual(list(pathlib.Path(directory).iterdir()), [code])


class NativeTests(unittest.TestCase):
    def test_no_implicit_shell_temporary_files(self):
        LocalTests().test_no_implicit_shell_temporary_files()

    def refused(self, result, reason=None):
        self.assertTrue(result['worker'], 'unexpected pre-exec refusal: '+repr(result))
        self.assertIsNone(result['failure'], result)
        self.assertNotEqual(result['rc'], 0, 'invalid root copy was accepted')
        self.assertEqual(result['out'], b'', result)
        if reason: self.assertIn(('installer authentication refused: ' + reason + '\n').encode(), result['err'], result)

    def honest(self, f, result):
        self.assertIsNone(result['failure'], result)
        self.assertEqual((result['rc'], result['out'], result['err']), (0, SUCCESS, b''), 'honest root copy failed: ' + repr(result))
        self.assertTrue(result['shell_observed'] and result['handshake_sent'])
        self.assertEqual({p.name for p in f.pending.iterdir()}, {'installer.manifest', 'host_release_publish.py'})
        for source in (f.manifest, f.installer):
            dest = f.pending / source.name; s = dest.lstat()
            self.assertEqual(dest.read_bytes(), source.read_bytes(), 'root copy differs from approved input')
            self.assertEqual((s.st_uid, stat.S_IMODE(s.st_mode), s.st_nlink), (0, 0o600, 1))

    def test_honest_root_owned_bytes(self):
        with fixture('honest') as f: self.honest(f, f.invoke())

    def test_binary_installer_copy_is_exact(self):
        with fixture('binary-bytes') as f:
            f.set_installer(bytes(range(256))*4+b'\x00\xff\n')
            self.honest(f,f.invoke())

    def test_unprivileged_role_refusal(self):
        with fixture('unprivileged-role') as f:
            code = f.source / 'stage0_installer_copy.sh'
            code.write_bytes(SCRIPT.read_bytes()); code.chmod(0o600); os.chown(code, OPERATOR, OPERATOR)
            command = ['/usr/bin/env','-i','CI=true','GITHUB_ACTIONS=true','LC_ALL=C',SHELL,
                       '--noprofile','--norc','-p','-f',str(code),'--ci-owned-root-copy',UUID,str(OPERATOR),
                       str(CAPTURE),str(f.source),str(f.root),sha(f.installer.read_bytes()),sha(f.manifest.read_bytes())]
            p = subprocess.Popen(command,stdout=subprocess.PIPE,stderr=subprocess.PIPE,cwd='/',env={},
                                 user=OPERATOR,group=OPERATOR,extra_groups=[],start_new_session=True)
            out,err=p.communicate(timeout=5)
            self.assertTrue(absent_group(p.pid))
            REPORT['cases'][-1]['unprivileged_control']={'argv':command,'uid':OPERATOR,'timeout_s':5,'rc':p.returncode,
                                                       'out':base64.b64encode(out).decode(),'err':base64.b64encode(err).decode(),
                                                       'waited':True,'group_absent':True,'root_startup_credit':False}
            self.assertEqual((p.returncode,out,err),(1,b'',b'installer authentication refused: roles\n'),
                             'root role must refuse before metadata')

    def test_approvals_precede_staging(self):
        for which in ('manifest', 'installer', 'rewrite'):
            with fixture('approval-' + which) as f:
                expected_i, expected_m = sha(f.installer.read_bytes()), sha(f.manifest.read_bytes())
                if which == 'manifest': expected_m = '0'*64
                elif which == 'installer': expected_i = '0'*64
                else: f.set_installer(b'unapproved but self-consistent\n')
                result = f.invoke(expected_installer=expected_i, expected_manifest=expected_m)
                self.refused(result)
                self.assertEqual({p.name for p in f.root.iterdir()}, {'stage0_installer_copy.sh'}, 'staging preceded independent source approvals')

    def test_canonical_schema_and_size(self):
        for mutation in ('trailing', 'nul', 'size', 'oversize'):
            with fixture('schema-' + mutation) as f:
                if mutation == 'oversize': f.set_installer(b'x'*131073)
                elif mutation == 'trailing': f.manifest.write_bytes(f.manifest.read_bytes() + b'\n')
                elif mutation == 'nul': f.manifest.write_bytes(f.manifest.read_bytes().replace(b'v1', b'v\x001'))
                else: f.manifest.write_bytes(f.manifest.read_bytes().replace(b'17889', b'017889'))
                self.refused(f.invoke())
                self.assertEqual({p.name for p in f.root.iterdir()}, {'stage0_installer_copy.sh'})

    def test_external_code_approval_before_root_worker(self):
        with fixture('external-code-approval') as f:
            expected = sha(f.code.read_bytes()); f.code.write_bytes(b'builtin printf BAD\n' + f.code.read_bytes())
            r = f.invoke(expected_script=expected)
            self.assertFalse(r['worker'], 'unapproved root script started')
            self.assertFalse(r['script_prehashed'])
        with fixture('external-code-owner') as f:
            os.chown(f.code, OPERATOR, OPERATOR)
            r = f.invoke(); self.assertFalse(r['worker'], 'unprotected root script started')

    def test_source_metadata_refusals(self):
        for kind in ('owner', 'mode', 'link', 'hardlink', 'extra', 'xattr', 'acl'):
            with fixture('source-' + kind) as f:
                if kind == 'owner': os.chown(f.installer, CAPTURE, CAPTURE_GID)
                elif kind == 'mode': f.installer.chmod(0o640)
                elif kind == 'link':
                    original = f.source / 'saved'; f.installer.rename(original); f.installer.symlink_to(original)
                elif kind == 'hardlink': os.link(f.installer, f.source / 'alias')
                elif kind == 'extra': (f.source / 'extra').write_bytes(b'owned')
                elif kind == 'xattr':
                    if sys.platform == 'darwin': observe(['/usr/bin/xattr', '-w', 'com.openclaw.copy', 'owned', str(f.installer)])
                    else: os.setxattr(f.installer, 'user.openclaw.copy', b'owned')
                elif sys.platform == 'darwin':
                    name = pwd.getpwuid(CAPTURE).pw_name; assert pwd.getpwnam(name).pw_uid == CAPTURE
                    observe(['/bin/chmod', '+a', 'user:' + name + ' allow read', str(f.installer)])
                    REPORT['cases'][-1]['acl_principal'] = {'uid': CAPTURE, 'name': name}
                else: observe(['/usr/bin/setfacl', '-m', 'u:'+str(CAPTURE)+':r,m::---', str(f.installer)])
                REPORT['cases'][-1]['source_metadata'] = identity(f.installer)
                if kind!='link': REPORT['cases'][-1]['source_attributes'] = attributes(f.installer)
                self.refused(f.invoke())
                self.assertEqual({p.name for p in f.root.iterdir()}, {'stage0_installer_copy.sh'})

    def test_root_parent_mode_and_owner_before_write(self):
        anchor = 'inspect_tree "$root" 0'
        for kind in ('mode', 'owner'):
            with fixture('root-parent-' + kind, private=True) as f:
                def change(current, worker):
                    if kind == 'mode': current.root.chmod(0o777)
                    else: os.chown(current.root, OPERATOR, OPERATOR)
                during = f.pause(anchor, change)
                self.refused(f.invoke(during=during))
                self.assertEqual({p.name for p in f.root.iterdir()}, {'stage0_installer_copy.sh'}, 'unsafe root storage was written')

    def test_existing_fences_are_untouched(self):
        for kind in ('empty', 'partial', 'complete', 'other'):
            with fixture('fence-' + kind) as f:
                path = f.pending if kind != 'other' else f.root / ('pending-installer-'+'f'*64)
                path.mkdir(mode=0o700)
                if kind != 'empty': (path / 'installer.manifest').write_bytes(b'held fence')
                before = f.snapshot(); self.refused(f.invoke())
                self.assertEqual(f.snapshot(), before, 'existing pending fence changed')

    def test_copied_bytes_are_independently_checked(self):
        with fixture('copied-byte-corruption', private=True) as f:
            anchor = 'verify_pair "$child/installer.manifest"'
            def corrupt(current, worker):
                p = current.pending / 'host_release_publish.py'; raw = p.read_bytes(); p.write_bytes(b'X'+raw[1:])
            during = f.pause(anchor, corrupt)
            self.refused(f.invoke(during=during),'mapping')
            self.assertTrue(f.pending.exists(), 'failed copy was removed')

    def test_final_code_mapping_drift_refuses(self):
        with fixture('final-code-mapping',private=True) as f:
            anchor='mapping "$script" "$script_record" 5\ncheck_trees\ndeadline'
            during=f.pause(anchor,lambda current,worker: None)
            twin=f.outer/'code-twin'
            raw=f.code.read_text();f.code.write_text(raw.replace(anchor,'exec 5< "'+str(twin)+'"\n'+anchor))
            twin.write_bytes(f.code.read_bytes());twin.chmod(0o600)
            f.instrumentation.append({'kind':'FD5 substitution','twin_metadata':identity(twin),'twin_sha256':sha(twin.read_bytes())})
            self.refused(f.invoke(during=during),'mapping')

    def test_root_entry_set_after_create_and_at_completion(self):
        for phase,anchor in (('after-mkdir','transition "$root" 10'),('final','mapping "$script" "$script_record" 5\ncheck_trees\ndeadline')):
            with fixture('root-entry-'+phase,private=True) as f:
                def extra(current,worker): (current.root/'foreign').write_bytes(b'inert unexpected root entry')
                self.refused(f.invoke(during=f.pause(anchor,extra)),'root-entries')

    def test_source_and_copy_mapping_drift_refuse(self):
        for kind in ('source','copy'):
            with fixture('mapping-'+kind,private=True) as f:
                anchor=('copy_file installer.manifest ' if kind=='source' else '    mapping "$child/$name" "$after" "$read_fd"')
                def replace(current,worker):
                    path=current.manifest if kind=='source' else current.pending/'installer.manifest'
                    raw=path.read_bytes(); path.rename(current.outer/'held-original-data')
                    path.write_bytes(raw); path.chmod(0o600)
                    if kind=='source': os.chown(path,OPERATOR,OPERATOR)
                self.refused(f.invoke(during=f.pause(anchor,replace)))

    def test_overlap_refuses_before_metadata(self):
        with fixture('nested-source') as f:
            args=['--ci-owned-root-copy',UUID,str(OPERATOR),str(CAPTURE),
                  str(f.root/'openclaw-stage0-copy-input-owned-nested'),str(f.root),
                  sha(f.installer.read_bytes()),sha(f.manifest.read_bytes())]
            self.refused(f.invoke(arguments=args,early='overlap'),'overlap')

    def test_transition_fields_are_pinned(self):
        anchor = '    after=$(metadata "$child/$name")'
        for kind in ('gid', 'mode', 'hardlink'):
            with fixture('transition-' + kind, private=True) as f:
                def alter(current, worker):
                    p = current.pending / 'installer.manifest'
                    if kind == 'gid': os.chown(p, 0, OPERATOR)
                    elif kind == 'mode': p.chmod(0o640)
                    else: os.link(p, current.outer / 'held-hardlink')
                self.refused(f.invoke(during=f.pause(anchor, alter)),{'gid':'transition','mode':'type','hardlink':'private'}[kind])

    def test_empty_destination_before_payload(self):
        for hazard in ('symlink', 'fifo'):
            with fixture('prewrite-' + hazard, private=True) as f:
                anchor = '    exec 12> "$name"'
                raw=f.code.read_text(); payload='    /usr/bin/head -c "$((cap+1))" <&"$source_fd" >&12 || refuse copy'
                marker=f.outer/'payload-started'
                self.assertEqual(raw.count(payload),1)
                f.code.write_text(raw.replace(payload,'    builtin printf payload > "'+str(marker)+'"\n'+payload))
                f.instrumentation.append({'kind':'payload-entry canary','anchor':payload})
                def plant(current, worker):
                    p = current.pending / 'installer.manifest'
                    if hazard == 'symlink': p.symlink_to('/dev/null')
                    else: os.mkfifo(p, 0o600)
                result = f.invoke(during=f.pause(anchor, plant), timeout=3, expected_timeout=(hazard == 'fifo'))
                self.assertFalse(marker.exists(),'payload began before empty regular destination validation')
                if hazard == 'fifo':
                    self.assertEqual(result['rc'], -9); self.assertTrue(result.get('watchdog_killed'))
                    self.assertEqual(result['out'], b'')
                else: self.refused(result, 'mapping')
                self.assertTrue(f.pending.exists())

    def test_interruption_retains_and_blocks(self):
        with fixture('interruption', private=True) as f:
            anchor = 'copy_file installer.manifest '
            r = f.invoke(during=f.pause(anchor, lambda current, worker: os.killpg(worker.pid, signal.SIGKILL)))
            self.assertEqual(r['rc'], -9); self.assertEqual(r['out'], b'')
            self.assertTrue(r['waited'] and r['group_absent'] and f.pending.exists())
            before = f.snapshot(); self.refused(f.invoke()); self.assertEqual(f.snapshot(), before)

    def test_approved_bad_installer_is_inert(self):
        with fixture('approved-inert-BAD') as f:
            marker = f.source / 'BAD'
            code = ('#!/bin/sh\n""":"\nprintf BAD > "'+str(marker)+'"\nexit 0\n":"""\n'
                    'with open('+repr(str(marker))+',"w") as f:\n    f.write("BAD")\n').encode()
            f.set_installer(code)
            for command in ([SHELL, '--noprofile', '--norc', '-p'], [sys.executable, '-I', '-S', '-B']):
                p = subprocess.run(command + [str(f.installer)], capture_output=True, timeout=5,
                                   env={}, cwd='/', user=OPERATOR, group=OPERATOR, extra_groups=[])
                self.assertEqual(p.returncode, 0, p.stderr); self.assertEqual(marker.read_bytes(), b'BAD'); marker.unlink()
            result = f.invoke()
            self.assertFalse(marker.exists(), 'BAD installer was executed by root copier')
            self.honest(f, result)

    def test_both_nonroot_principals_are_denied(self):
        driver = ('import os,pathlib,sys,json\np=pathlib.Path(sys.argv[1]);d={}\n'
                  'for k,call in [("list",lambda:list(p.iterdir())),("read",lambda:(p/"stage0_installer_copy.sh").read_bytes()),'
                  '("replace",lambda:os.rename(p/"stage0_installer_copy.sh",p/"changed")),("create",lambda:(p/"made").write_bytes(b"x"))]:\n'
                  ' try:call()\n except PermissionError:d[k]="denied"\n else:raise AssertionError(k)\nprint(json.dumps(d))')
        with fixture('principal-denial') as f:
            self.honest(f, f.invoke())
            rows = []
            for uid, gid in ((OPERATOR, OPERATOR), (CAPTURE, CAPTURE_GID)):
                p = subprocess.Popen([sys.executable, '-I', '-S', '-B', '-c', driver, str(f.root)], stdout=subprocess.PIPE,
                                     stderr=subprocess.PIPE, user=uid, group=gid, extra_groups=[], env={}, cwd='/', start_new_session=True)
                out, err = p.communicate(timeout=5)
                self.assertTrue(absent_group(p.pid)); self.assertEqual((p.returncode, err), (0, b''))
                denial = json.loads(out); self.assertEqual(denial, {k:'denied' for k in ('list','read','replace','create')})
                rows.append({'uid':uid,'argv':[sys.executable,'-I','-S','-B','-c',driver,str(f.root)],'timeout_s':5,
                             'rc':p.returncode,'waited':True,'group_absent':True,'access':denial})
            REPORT['cases'][-1]['denials'] = rows
            REPORT['cases'][-1]['denial_attribution'] = 'root0700 base under traversable root0755 fixture parent'

    def test_cross_artifact_arguments_refuse(self):
        with fixture('cross-arguments') as f:
            args = ['--ci-owned', UUID, str(OPERATOR), str(CAPTURE), str(f.source), sha(f.installer.read_bytes()), sha(f.manifest.read_bytes())]
            self.refused(f.invoke(arguments=args, early='arguments'), 'arguments')
        with fixture('old-artifact-new-arguments') as f:
            old=f.source/'stage0_installer_auth.sh'; old.write_bytes((STEP/'stage0_installer_auth.sh').read_bytes())
            old.chmod(0o600); os.chown(old,OPERATOR,OPERATOR)
            args=['--ci-owned-root-copy',UUID,str(OPERATOR),str(CAPTURE),str(f.source),str(f.root),
                  sha(f.installer.read_bytes()),sha(f.manifest.read_bytes())]
            command=['/usr/bin/env','-i','CI=true','GITHUB_ACTIONS=true','LC_ALL=C',SHELL,
                     '--noprofile','--norc','-p','-f',str(old)]+args
            p=subprocess.Popen(command,stdout=subprocess.PIPE,stderr=subprocess.PIPE,cwd='/',env={},
                               user=OPERATOR,group=OPERATOR,extra_groups=[],start_new_session=True)
            out,err=p.communicate(timeout=5); self.assertTrue(absent_group(p.pid))
            self.assertEqual((p.returncode,out,err),(1,b'',b'installer authentication refused: arguments\n'))
            REPORT['cases'][-1]['old_artifact_control']={'argv':command,'uid':OPERATOR,'timeout_s':5,'rc':p.returncode,
                                                       'out':base64.b64encode(out).decode(),'err':base64.b64encode(err).decode(),
                                                       'waited':True,'group_absent':True,'root_startup_credit':False}


def guard():
    assert os.getuid() == os.geteuid() == 0 and os.environ.get('CI') == 'true' and os.environ.get('GITHUB_ACTIONS') == 'true'
    assert os.environ.get('OPENCLAW_STAGE0_COPY_PROBE') == '1' and os.environ.get('SUDO_UID', '').isdecimal()
    global CAPTURE, CAPTURE_GID
    CAPTURE = int(os.environ['SUDO_UID']); CAPTURE_GID = int(os.environ['SUDO_GID'])
    assert 0 < CAPTURE < 2147483647 and CAPTURE != OPERATOR


def main():
    if len(sys.argv) == 1:
        assert os.getuid() != 0, 'local controls must stay unprivileged'
        result = unittest.TextTestRunner(verbosity=2).run(unittest.defaultTestLoader.loadTestsFromTestCase(LocalTests))
        raise SystemExit(not result.wasSuccessful())
    assert len(sys.argv) in (3,4) and sys.argv[1] in ('--probe','--case')
    guard(); report = pathlib.Path(sys.argv[-1])
    REPORT.update(operator_uid=OPERATOR, capture_uid=CAPTURE, root_is_fixture_plumbing_only=True,
                  script={'bytes':len(SCRIPT.read_bytes()),'sha256':sha(SCRIPT.read_bytes())},
                  source_bindings={n:{'bytes':len((STEP/n).read_bytes()),'sha256':sha((STEP/n).read_bytes())} for n in ('installer.manifest','host_release_publish.py')},
                  tools=native_tools())
    mkdir = '/bin/mkdir' if sys.platform == 'darwin' else '/usr/bin/mkdir'
    info = os.lstat(mkdir); assert stat.S_ISREG(info.st_mode) and info.st_uid == 0 and not info.st_mode & 0o022
    with open(mkdir,'rb') as handle: magic=handle.read(4)
    assert magic in (b'\x7fELF',b'\xca\xfe\xba\xbe',b'\xcf\xfa\xed\xfe',b'\xca\xfe\xba\xbf')
    REPORT['tools'].append({'path':mkdir,'device':info.st_dev,'inode':info.st_ino,'native_format_prefix':magic.hex()})
    try:
        suite = unittest.defaultTestLoader.loadTestsFromTestCase(NativeTests) if sys.argv[1]=='--probe' else unittest.defaultTestLoader.loadTestsFromName('NativeTests.'+sys.argv[2], sys.modules[__name__])
        result = unittest.TextTestRunner(verbosity=2).run(suite)
        REPORT.update(tests=result.testsRun, completed=result.wasSuccessful())
        REPORT['cleanup']['removed'] = all(f['removed'] for f in REPORT['fixtures'])
    finally:
        report.write_text(json.dumps(REPORT,indent=2,sort_keys=True)+'\n'); os.chown(report,CAPTURE,CAPTURE_GID)
    assert REPORT['completed'] and REPORT['cleanup']['removed'], 'root-copy proof incomplete'
    print(json.dumps({'completed':True,'tests':REPORT['tests'],'cases':len(REPORT['cases']),'workers':len(REPORT['workers']),
                      'fixtures':len(REPORT['fixtures']),'cleanup':REPORT['cleanup']}))


if __name__ == '__main__': main()
