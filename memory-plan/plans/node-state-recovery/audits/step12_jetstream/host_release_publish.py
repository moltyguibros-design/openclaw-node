"""Owned release publication core; no bootstrap authentication or production entry.

Real use requires this artifact in the independently approved Stage0 installer set,
loaded from its protected verified copy with an approved runtime. The reader digest
does not authenticate this publisher. Failed names remain fenced; no cleanup/retry.
"""
import contextlib
import ctypes
import hashlib
import json
import os
import pathlib
import re
import stat
import subprocess
import sys
import time


SCHEMA = 'openclaw-approved-reader-v1'
NAMES = frozenset(name + '.py' for name in (
    'host_capture_anchor', 'host_asif_extract', 'host_guest_commit', 'host_image_immutable',
    'host_journal_mount', 'host_vm_capture', 'host_vm_preflight', 'nats_identity',
    'preservation_checks', 'preservation_journal', 'stopped_journal_inputs',
    'host_protected_journal_reader'))
FILE_LIMIT = 2 * 1024 * 1024
MANIFEST_LIMIT = 64 * 1024
SECONDS = 60
FIXTURE_UUID = '00000000-0000-0000-0000-000000000002'


def require(condition, reason):
    if not condition:
        raise RuntimeError(reason)


def encoded(value):
    return (json.dumps(value, sort_keys=True, separators=(',', ':')) + '\n').encode()


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def identity(info):
    result = {key: getattr(info, 'st_' + key) for key in (
        'dev', 'ino', 'mode', 'uid', 'gid', 'nlink', 'size', 'mtime_ns', 'ctime_ns')}
    result['flags'] = getattr(info, 'st_flags', 0)
    return result


class Deadline:
    def __init__(self):
        self.end = time.monotonic() + SECONDS

    def check(self):
        require(time.monotonic() < self.end, 'publication deadline expired')


def has_xattrs(fd):
    if sys.platform != 'darwin':
        return bool(os.listxattr(fd))
    call = ctypes.CDLL(None, use_errno=True).flistxattr
    call.argtypes = [ctypes.c_int, ctypes.c_void_p, ctypes.c_size_t, ctypes.c_int]
    call.restype = ctypes.c_ssize_t
    count = call(fd, None, 0, 0)
    require(count >= 0, 'xattr observation failed')
    return count != 0


def no_acl(path, fd, deadline):
    deadline.check()
    if sys.platform == 'darwin':
        done = subprocess.run(['/bin/ls', '-lde', str(path)], capture_output=True,
                              text=True, timeout=10,
                              env={'PATH': '/usr/bin:/bin', 'LC_ALL': 'C'})
        require(done.returncode == 0 and done.stdout and not done.stderr
                and not any(re.match(r'\s*\d+:', line) and ' allow ' in line
                            for line in done.stdout.splitlines()[1:]), 'granting ACL or unknown ACL')
    else:
        require(not any(name.startswith('system.posix_acl_') for name in os.listxattr(fd)),
                'granting ACL or unknown ACL')
    deadline.check()


def dir_shape(info, owners, private):
    require(stat.S_ISDIR(info.st_mode) and info.st_uid in owners
            and not stat.S_IMODE(info.st_mode) & 0o022
            and (not private or (stat.S_IMODE(info.st_mode) == 0o700
                                 and getattr(info, 'st_flags', 0) == 0)), 'directory shape differs')


def file_shape(info, owners, private):
    require(stat.S_ISREG(info.st_mode) and info.st_uid in owners and info.st_nlink == 1
            and not stat.S_IMODE(info.st_mode) & 0o022 and getattr(info, 'st_flags', 0) == 0
            and (not private or stat.S_IMODE(info.st_mode) == 0o600), 'file shape differs')


class Dir:
    def __init__(self, parent, name, owners, private, deadline):
        self.parent, self.name, self.deadline = parent, name, deadline
        self.private = private
        deadline.check()
        self.fd = os.open(name, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW,
                          dir_fd=None if parent is None else parent.fd)
        try:
            self.initial = os.fstat(self.fd)
            dir_shape(self.initial, owners, private)
            no_acl(self.path, self.fd, deadline)
            if private:
                require(not has_xattrs(self.fd), 'private directory has xattrs')
            self.check()
        except BaseException:
            os.close(self.fd)
            raise

    @property
    def path(self):
        return pathlib.Path('/') if self.parent is None else self.parent.path / self.name

    def check(self):
        self.deadline.check()
        if self.parent is not None:
            self.parent.check()
        mapped = os.stat(self.name, dir_fd=None if self.parent is None else self.parent.fd,
                         follow_symlinks=False)
        held = os.fstat(self.fd)
        keys = ('dev', 'ino', 'mode', 'uid', 'gid', 'flags')
        before = identity(self.initial)
        require(all(before[key] == identity(mapped)[key] == identity(held)[key] for key in keys),
                'directory mapping changed')
        if self.private:
            require(not has_xattrs(self.fd), 'private directory has xattrs')
        no_acl(self.path, self.fd, self.deadline)

    def close(self):
        os.close(self.fd)


@contextlib.contextmanager
def directory(path, owners, private, deadline):
    path = pathlib.Path(path)
    require(path.is_absolute() and '..' not in path.parts and len(path.parts) <= 64,
            'path must be bounded absolute literal data')
    with contextlib.ExitStack() as stack:
        parent = None
        for index, part in enumerate(path.parts):
            node = Dir(parent, part, {0} if parent is None else owners,
                       private and index == len(path.parts) - 1, deadline)
            stack.callback(node.close)
            parent = node
        yield parent


def entries(node, expected):
    found = set()
    with os.scandir(node.fd) as stream:
        for item in stream:
            node.deadline.check()
            require(len(found) < len(expected), 'directory entry bound or set differs')
            found.add(item.name)
    require(found == set(expected), 'directory entry bound or set differs')


class File:
    def __init__(self, parent, name, owners, private, limit, fd=None):
        self.parent, self.name, self.limit = parent, name, limit
        self.fd = os.open(name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK,
                          dir_fd=parent.fd) if fd is None else fd
        try:
            self.initial = os.fstat(self.fd)
            file_shape(self.initial, owners, private)
            require(0 < self.initial.st_size <= limit, 'input byte bound differs')
            self.check()
        except BaseException:
            os.close(self.fd)
            raise

    def check(self):
        self.parent.deadline.check()
        before = identity(os.fstat(self.fd))
        require(not has_xattrs(self.fd), 'file has xattrs')
        no_acl(self.parent.path / self.name, self.fd, self.parent.deadline)
        mapped = os.stat(self.name, dir_fd=self.parent.fd, follow_symlinks=False)
        require(identity(self.initial) == before == identity(mapped) == identity(os.fstat(self.fd)),
                'file mapping or metadata changed')

    def read(self):
        self.check()
        os.lseek(self.fd, 0, os.SEEK_SET)
        blocks, count = [], 0
        while True:
            self.parent.deadline.check()
            block = os.read(self.fd, 64 * 1024)
            if not block:
                break
            count += len(block)
            require(count <= self.limit, 'input byte bound differs')
            blocks.append(block)
        self.check()
        require(count == self.initial.st_size, 'input size changed')
        return b''.join(blocks)

    def close(self):
        os.close(self.fd)


def manifest_value(raw, expected):
    require(isinstance(expected, str) and re.fullmatch('[0-9a-f]{64}', expected),
            'expected digest differs')
    require(sha(raw) == expected, 'manifest is not independently approved')
    value = json.loads(raw)
    require(isinstance(value, dict) and encoded(value) == raw
            and set(value) == {'schema', 'files'} and value['schema'] == SCHEMA
            and isinstance(value['files'], dict) and set(value['files']) == NAMES,
            'manifest schema or canonical bytes differ')
    for item in value['files'].values():
        require(isinstance(item, dict) and set(item) == {'size', 'sha256'}
                and type(item['size']) is int and 0 < item['size'] <= FILE_LIMIT
                and isinstance(item['sha256'], str) and re.fullmatch('[0-9a-f]{64}', item['sha256']),
                'manifest binding differs')
    return value['files']


def write_snapshot(parent, name, raw, limit):
    parent.check()
    fd = os.open(name, os.O_RDWR | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW,
                 0o600, dir_fd=parent.fd)
    try:
        os.fchmod(fd, 0o600)
        file_shape(os.fstat(fd), {0}, True)
        require(not has_xattrs(fd), 'new file has xattrs')
        no_acl(parent.path / name, fd, parent.deadline)
        offset = 0
        while offset < len(raw):
            parent.deadline.check()
            block = memoryview(raw)[offset:offset + 64 * 1024]
            count = os.write(fd, block)
            require(0 < count <= len(block), 'short write made no progress')
            offset += count
        os.fsync(fd)
    except BaseException:
        os.close(fd)
        raise
    result = File(parent, name, {0}, True, limit, fd=fd)
    try:
        require(result.read() == raw, 'staged bytes differ from snapshots')
        return result
    except BaseException:
        result.close()
        raise


def exclusive_rename(parent, source, target):
    library = ctypes.CDLL(None, use_errno=True)
    if sys.platform == 'darwin':
        name, flag = 'renameatx_np', 4
    elif sys.platform == 'linux':
        name, flag = 'renameat2', 1
    else:
        raise RuntimeError('exclusive rename platform unsupported')
    call = getattr(library, name)
    call.argtypes = [ctypes.c_int, ctypes.c_char_p, ctypes.c_int, ctypes.c_char_p, ctypes.c_uint]
    call.restype = ctypes.c_int
    if call(parent.fd, os.fsencode(source), parent.fd, os.fsencode(target), flag) != 0:
        code = ctypes.get_errno()
        raise OSError(code, 'exclusive rename refused')
    return {'api': name, 'flag': flag, 'provider': 'process system C library'}


def publish(payload_path, manifest_path, destination, capture_uid, payload_uid, expected):
    require(os.getuid() == os.geteuid() == 0, 'publisher requires independent root')
    require(type(capture_uid) is int and capture_uid > 0
            and type(payload_uid) is int and payload_uid >= 0, 'principal data differs')
    deadline = Deadline()
    payload_path, manifest_path, destination = map(pathlib.Path,
                                                  (payload_path, manifest_path, destination))
    require(manifest_path.parent != payload_path
            and not any(a == b or a in b.parents for a, b in (
                (payload_path, destination), (destination, payload_path),
                (payload_path, manifest_path), (destination, manifest_path))), 'input paths overlap')
    with contextlib.ExitStack() as stack:
        payload = stack.enter_context(directory(payload_path, {0, payload_uid}, True, deadline))
        approval = stack.enter_context(directory(manifest_path.parent, {0}, True, deadline))
        parent = stack.enter_context(directory(destination, {0}, True, deadline))
        manifest = File(approval, manifest_path.name, {0}, True, MANIFEST_LIMIT)
        stack.callback(manifest.close)
        raw_manifest = manifest.read()
        bindings = manifest_value(raw_manifest, expected)
        entries(payload, NAMES)
        inputs, snapshots = {}, {}
        for name in sorted(NAMES):
            item = File(payload, name, {0, payload_uid}, False, FILE_LIMIT)
            stack.callback(item.close)
            inputs[name] = item
            snapshots[name] = item.read()
            require({'size': len(snapshots[name]), 'sha256': sha(snapshots[name])} == bindings[name],
                    'payload differs from approved bindings')

        def check_sources():
            entries(payload, NAMES)
            require(manifest.read() == raw_manifest, 'approved manifest changed')
            for name, item in inputs.items():
                require(item.read() == snapshots[name], 'payload snapshot changed')
            payload.check()
            approval.check()
            parent.check()

        check_sources()
        try:
            os.stat(expected, dir_fd=parent.fd, follow_symlinks=False)
        except FileNotFoundError:
            pass
        else:
            raise RuntimeError('release destination already exists')
        pending = '.pending-' + expected
        os.mkdir(pending, mode=0o700, dir_fd=parent.fd)
        stage = Dir(parent, pending, {0}, True, deadline)
        stack.callback(stage.close)
        os.fsync(parent.fd)
        os.mkdir('src', mode=0o700, dir_fd=stage.fd)
        code = Dir(stage, 'src', {0}, True, deadline)
        stack.callback(code.close)
        outputs = {}
        for name in sorted(NAMES):
            item = write_snapshot(code, name, snapshots[name], FILE_LIMIT)
            stack.callback(item.close)
            outputs[name] = item
        record = write_snapshot(stage, 'release.json', raw_manifest, MANIFEST_LIMIT)
        stack.callback(record.close)

        def check_bundle():
            entries(stage, {'src', 'release.json'})
            entries(code, NAMES)
            require(record.read() == raw_manifest, 'published manifest differs')
            for name, item in outputs.items():
                require(item.read() == snapshots[name], 'published bytes differ')
            code.check()

        check_sources()
        check_bundle()
        os.fsync(code.fd)
        os.fsync(stage.fd)
        parent.check()
        rename = exclusive_rename(parent, pending, expected)
        stage.name = expected
        os.fsync(parent.fd)
        check_sources()
        check_bundle()
        with directory(parent.path / expected, {0}, True, deadline) as final:
            require(os.fstat(final.fd).st_ino == os.fstat(stage.fd).st_ino
                    and os.fstat(final.fd).st_dev == os.fstat(stage.fd).st_dev,
                    'final directory differs from held stage')
            entries(final, {'src', 'release.json'})
            with directory(final.path / 'src', {0}, True, deadline) as reopened:
                require(os.fstat(reopened.fd).st_ino == os.fstat(code.fd).st_ino
                        and os.fstat(reopened.fd).st_dev == os.fstat(code.fd).st_dev,
                        'final source directory differs')
                entries(reopened, NAMES)
                for name, held in (*outputs.items(), ('release.json', record)):
                    node = final if name == 'release.json' else reopened
                    item = File(node, name, {0}, True,
                                MANIFEST_LIMIT if name == 'release.json' else FILE_LIMIT)
                    try:
                        require(identity(item.initial) == identity(held.initial)
                                and item.read() == held.read(), 'reopened file differs')
                    finally:
                        item.close()
            final.check()
        check_bundle()
        receipt = {'scope': 'owned publication observation only; no startup trust or admission',
                   'release_sha256': expected, 'path': str(stage.path),
                   'parent': identity(os.fstat(parent.fd)), 'bundle': identity(os.fstat(stage.fd)),
                   'src': identity(os.fstat(code.fd)), 'manifest': identity(record.initial),
                   'manifest_sha256': sha(raw_manifest), 'rename': rename,
                   'sync': 'fsync(2) ordering only; no stable-storage or power-loss guarantee',
                   'files': {name: {**identity(item.initial), **bindings[name]}
                             for name, item in outputs.items()}}
        require(len(encoded(receipt)) <= MANIFEST_LIMIT, 'receipt byte bound exceeded')
        deadline.check()
        return receipt


def cli():
    require(len(sys.argv) == 9 and sys.argv[1] == '--ci-owned'
            and sys.argv[2] == FIXTURE_UUID
            and os.environ.get('CI') == 'true' and os.environ.get('GITHUB_ACTIONS') == 'true',
            'only CI-owned publication is enabled')
    require(sys.flags.isolated and sys.flags.no_site and sys.flags.dont_write_bytecode,
            'publisher requires isolated no-site no-bytecode Python')
    payload, manifest, destination = map(pathlib.Path, sys.argv[3:6])
    home = pathlib.Path('/private/var/root' if sys.platform == 'darwin' else '/root')
    input_parent = pathlib.Path('/private/var/db' if sys.platform == 'darwin' else '/var/lib')
    program = pathlib.Path(__file__).absolute()
    base = program.parent
    require(base.parent == home and base.name.startswith('openclaw-release-publish-owned-')
            and program.name == 'host_release_publish.py'
            and manifest == base / 'approved.json' and destination == base / 'programs'
            and payload.parent == input_parent
            and payload.name.startswith('openclaw-release-publish-input-')
            and sys.pycache_prefix == str(base / 'bytecode-disabled')
            and not os.path.lexists(base / 'bytecode-disabled'), 'CI fixture paths differ')
    capture_uid, payload_uid = int(sys.argv[6]), int(sys.argv[7])
    require(os.environ.get('SUDO_UID') == str(capture_uid), 'CI capture principal differs')
    receipt = publish(payload, manifest, destination, capture_uid, payload_uid, sys.argv[8])
    sys.stdout.write(encoded(receipt).decode())


if __name__ == '__main__':
    try:
        cli()
    except Exception as error:
        detail = str(error) if isinstance(error, RuntimeError) else type(error).__name__
        print('release publication refused: ' + detail[:256], file=sys.stderr)
        sys.exit(1)
