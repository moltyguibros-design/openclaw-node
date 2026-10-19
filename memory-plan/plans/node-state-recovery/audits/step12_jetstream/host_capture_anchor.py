"""Owned post-capture byte anchors, not B8 acceptance or a boot decision.

The privileged caller must load this program and its standard-library interpreter from
a trusted root-controlled installation. Checking ownership after importing writable
code cannot establish that trust. No production invocation or installer is supplied.
"""
import contextlib
import fcntl
import hashlib
import json
import os
import pathlib
import re
import stat
import subprocess
import sys


SCOPE = 'owned post-capture byte anchor; no pre-stop provenance or acceptance'
FIXTURE_UUID = '00000000-0000-0000-0000-000000000002'
FILES = ('ARMED.json', 'COMMITTED.json', 'ACKED.json', 'CHECKPOINT.json',
         'WINDOW_PINS.json', 'CAPTURE.json')
CLONE = 'powered-off-image.asif'
LIMIT = 2 * 1024 * 1024
PINS = {'guest_commit_sha256': 'COMMITTED.json', 'guest_ack_sha256': 'ACKED.json',
        'guest_checkpoint_sha256': 'CHECKPOINT.json', 'window_pins_sha256': 'WINDOW_PINS.json'}


def require(condition, message):
    if not condition:
        raise RuntimeError(message)


def encoded(value):
    return (json.dumps(value, sort_keys=True, separators=(',', ':')) + '\n').encode()


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def identity(info):
    return tuple(getattr(info, key) for key in ('st_dev', 'st_ino', 'st_mode', 'st_uid',
                 'st_gid', 'st_nlink', 'st_size', 'st_mtime_ns', 'st_ctime_ns'))


def no_acl(path, fd):
    if sys.platform == 'darwin':
        result = subprocess.run(['/bin/ls', '-lde', str(path)], capture_output=True,
                                text=True, timeout=10, check=True,
                                env={'PATH': '/usr/bin:/bin', 'LC_ALL': 'C'})
        require(result.stdout and not result.stderr
                and not any(re.match(r'\s*\d+:', line) and ' allow ' in line
                            for line in result.stdout.splitlines()[1:]), 'anchor path has an ACL: ' + str(path))
    else:
        require(not any(name.startswith('system.posix_acl_') for name in os.listxattr(fd)),
                'anchor path has an ACL: ' + str(path))


def directory_shape(info, owners, private):
    require(stat.S_ISDIR(info.st_mode) and info.st_uid in owners
            and not stat.S_IMODE(info.st_mode) & 0o022
            and (not private or stat.S_IMODE(info.st_mode) == 0o700),
            'anchor directory owner or mode differs')


class Directory:
    def __init__(self, path, owners, private=True):
        self.path = pathlib.Path(path)
        require(self.path.is_absolute() and '..' not in self.path.parts,
                'anchor path must be absolute and literal')
        self.stack = contextlib.ExitStack()
        self.entries = []
        try:
            parent = None
            current = pathlib.Path('/')
            for part in self.path.parts:
                current = current / part
                fd = os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW,
                             dir_fd=parent)
                self.stack.callback(os.close, fd)
                info = os.fstat(fd)
                allowed = owners if current != pathlib.Path('/') else {0}
                directory_shape(info, allowed, private and current == self.path)
                no_acl(current, fd)
                self.entries.append((parent, part, fd, info, current))
                parent = fd
            self.fd = parent
            self.check()
        except BaseException:
            self.stack.close()
            raise

    def check(self):
        for parent, part, fd, initial, path in self.entries:
            current = os.stat(part, dir_fd=parent, follow_symlinks=False)
            held = os.fstat(fd)
            keys = ('st_dev', 'st_ino', 'st_mode', 'st_uid', 'st_gid')
            require(all(getattr(initial, key) == getattr(current, key) == getattr(held, key)
                        for key in keys), 'anchor directory mapping changed')
            no_acl(path, fd)

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        self.stack.close()


class Input:
    def __init__(self, directory, name, owner, private=True, single_link=True):
        self.directory, self.name = directory, name
        self.fd = os.open(name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK,
                          dir_fd=directory.fd)
        try:
            self.initial = os.fstat(self.fd)
            require(stat.S_ISREG(self.initial.st_mode) and self.initial.st_uid == owner
                    and (not single_link or self.initial.st_nlink == 1)
                    and not stat.S_IMODE(self.initial.st_mode) & 0o022
                    and (not private or stat.S_IMODE(self.initial.st_mode) == 0o600),
                    'anchor input owner, mode or links differ')
            self.check()
        except BaseException:
            os.close(self.fd)
            raise

    def check(self):
        before = os.fstat(self.fd)
        no_acl(self.directory.path / self.name, self.fd)
        current = os.stat(self.name, dir_fd=self.directory.fd, follow_symlinks=False)
        require(identity(self.initial) == identity(before) == identity(current)
                == identity(os.fstat(self.fd)), 'anchor input changed or was replaced')

    def read(self, bounded):
        if bounded:
            require(self.initial.st_size <= LIMIT, 'anchor record exceeds byte limit')
        result, digest, count = [], hashlib.sha256(), 0
        while True:
            block = os.read(self.fd, 1024 * 1024)
            if not block:
                break
            count += len(block)
            if bounded:
                require(count <= LIMIT, 'anchor record exceeds byte limit')
                result.append(block)
            digest.update(block)
        self.check()
        require(count == self.initial.st_size, 'anchor input size changed')
        return b''.join(result), digest.hexdigest(), count

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        os.close(self.fd)


def canonical(raw):
    value = json.loads(raw)
    require(isinstance(value, dict) and encoded(value) == raw, 'anchor record is not canonical')
    return value


def trusted_path(path, program=False, zip_entry=False):
    path = pathlib.Path(path).resolve()
    if path.is_dir():
        with Directory(path, {0}, private=False):
            return str(path)
    with Directory(path.parent, {0}, private=False) as directory:
        if zip_entry and path.suffix == '.zip' and not path.exists():
            directory.check()
            return str(path)
        with Input(directory, path.name, 0, private=False, single_link=program) as item:
            digest = item.read(True)[1] if program else None
            item.check()
            directory.check()
    return digest if program else str(path)


def trusted_interpreter():
    program = pathlib.Path(__file__).resolve()
    interpreter = trusted_path(sys.executable)
    trusted_path(sys._base_executable)
    paths = [trusted_path(path, zip_entry=True) for path in sys.path]
    for module in tuple(sys.modules.values()):
        file = getattr(module, '__file__', None)
        if file:
            file = pathlib.Path(file).resolve()
            require(file == program or any(os.path.commonpath((str(file), path)) == path
                                          for path in paths), 'anchor loaded an untrusted module')
            if file != program and not any(path.endswith('.zip')
                    and os.path.commonpath((str(file), path)) == path for path in paths):
                trusted_path(file)
    sys.path[:] = paths
    return {'interpreter': interpreter}


def trusted_runtime():
    require(sys.flags.isolated and sys.flags.no_site and sys.flags.dont_write_bytecode,
            'anchor requires isolated Python without site processing or bytecode writes')
    program_sha = trusted_path(pathlib.Path(__file__).resolve(), program=True)
    prefix = trusted_cache_prefix(pathlib.Path(__file__).resolve())
    return {'program_sha256': program_sha, 'bytecode_prefix': prefix, **trusted_interpreter()}


def trusted_cache_prefix(program):
    prefix = program.parent / 'bytecode-disabled'
    require(sys.pycache_prefix == str(prefix) and not os.path.lexists(prefix),
            'anchor requires its protected absent bytecode prefix')
    with Directory(prefix.parent, {0}, private=False):
        return str(prefix)


def snapshot(capture, writer_uid, nonce):
    with Directory(capture, {0, writer_uid}) as directory, contextlib.ExitStack() as stack:
        require(os.fstat(directory.fd).st_uid == writer_uid, 'capture owner differs')
        require('FAILED.json' not in os.listdir(directory.fd), 'failed capture cannot be anchored')
        active = stack.enter_context(Input(directory, 'CAPTURE_ACTIVE.lock', writer_uid))
        require(active.initial.st_size == 0, 'capture lock is not empty')
        fcntl.flock(active.fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        inputs = {name: stack.enter_context(Input(directory, name, writer_uid))
                  for name in (*FILES, CLONE)}
        fcntl.flock(inputs['ARMED.json'].fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        reads = {name: item.read(name != CLONE) for name, item in inputs.items()}
        values = {name: canonical(reads[name][0]) for name in FILES}
        arm, commit, ack, checkpoint, table, capture_value = (values[name] for name in FILES)
        require(capture_value.get('vm_uuid') == FIXTURE_UUID == arm.get('vm_uuid'),
                'anchor requires the disposable fixture VM identity')
        require(all(value.get('capture_nonce') == nonce for value in (arm, commit, checkpoint)),
                'anchor capture nonce differs')
        require(all(capture_value.get(key) == reads[name][1] for key, name in PINS.items())
                and commit.get('arm_sha256') == reads['ARMED.json'][1]
                and arm.get('window_pins_sha256') == reads['WINDOW_PINS.json'][1]
                and ack.get('commit_sha256') == reads['COMMITTED.json'][1]
                and checkpoint.get('commit_sha256') == reads['COMMITTED.json'][1]
                and checkpoint.get('ack_sha256') == reads['ACKED.json'][1],
                'anchor capture byte bindings differ')
        require(capture_value.get('clone_image_sha256') == reads[CLONE][1]
                and type(capture_value.get('clone_size')) is int
                and capture_value['clone_size'] == reads[CLONE][2]
                and capture_value.get('vm_state_at_final_check') == 'stopped',
                'anchor clone binding differs')
        for item in inputs.values():
            item.check()
        active.check()
        require('FAILED.json' not in os.listdir(directory.fd), 'failed capture cannot be anchored')
        directory.check()
        info = os.fstat(directory.fd)
        return {'scope': SCOPE, 'capture_nonce': nonce, 'writer_uid': writer_uid,
                'capture_path': str(directory.path), 'capture_device': info.st_dev,
                'capture_inode': info.st_ino,
                'files': {name: {'sha256': read[1], 'size': read[2]} for name, read in reads.items()}}


def entry(root, capture, writer_uid, nonce, fixture):
    require(fixture, 'production protected capture anchoring is disabled')
    require(os.getuid() == 0 and os.geteuid() == 0, 'anchor requires independent root authority')
    require(type(writer_uid) is int and writer_uid > 0, 'anchor writer must be nonroot')
    require(os.environ.get('SUDO_UID', str(writer_uid)) == str(writer_uid), 'anchor sudo uid differs')
    require(isinstance(nonce, str) and re.fullmatch('[0-9a-f]{64}', nonce), 'anchor nonce differs')
    require(pathlib.Path(root).name.startswith('openclaw-acceptance-owned-')
            and pathlib.Path(capture).parent.name.startswith('openclaw-acceptance-input-'),
            'anchor requires disposable fixture paths')
    return {**trusted_runtime(), 'root_path': str(root)}


def publish(root, capture, writer_uid, nonce, *, fixture=False):
    authority = entry(root, capture, writer_uid, nonce, fixture)
    with Directory(root, {0}) as directory:
        fcntl.flock(directory.fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        final, pending = nonce + '.json', nonce + '.pending'
        require(not any(name in os.listdir(directory.fd) for name in (final, pending)),
                'anchor already exists or publication is incomplete')
        value = {**snapshot(capture, writer_uid, nonce), 'authority': authority}
        fd = os.open(pending, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW,
                     0o600, dir_fd=directory.fd)
        with os.fdopen(fd, 'wb') as stream:
            os.fchmod(stream.fileno(), 0o600)
            stream.write(encoded(value))
            stream.flush()
            os.fsync(stream.fileno())
        os.fsync(directory.fd)
        directory.check()
        os.link(pending, final, src_dir_fd=directory.fd, dst_dir_fd=directory.fd,
                follow_symlinks=False)
        os.fsync(directory.fd)
        os.unlink(pending, dir_fd=directory.fd)
        os.fsync(directory.fd)
        with Input(directory, final, 0) as record:
            require(canonical(record.read(True)[0]) == value, 'anchor publication read-back differs')
        directory.check()


def verify(root, capture, writer_uid, nonce, *, fixture=False):
    authority = entry(root, capture, writer_uid, nonce, fixture)
    with Directory(root, {0}) as directory:
        fcntl.flock(directory.fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        require(nonce + '.pending' not in os.listdir(directory.fd), 'anchor publication is incomplete')
        with Input(directory, nonce + '.json', 0) as record:
            value = canonical(record.read(True)[0])
            require(value == {**snapshot(capture, writer_uid, nonce), 'authority': authority},
                    'protected capture byte anchor differs')
            record.check()
            directory.check()
            os.fsync(record.fd)
            os.fsync(directory.fd)


if __name__ == '__main__':
    require(os.environ.get('CI') == 'true' and os.environ.get('GITHUB_ACTIONS') == 'true'
            and len(sys.argv) == 7 and sys.argv[1] == '--ci-owned'
            and sys.argv[2] in ('publish', 'verify'), 'only the CI-owned anchor command is enabled')
    action = publish if sys.argv[2] == 'publish' else verify
    action(pathlib.Path(sys.argv[3]), pathlib.Path(sys.argv[4]), int(sys.argv[5]), sys.argv[6], fixture=True)
    print('owned byte anchor ' + ('published' if action == publish else 'verified'))
