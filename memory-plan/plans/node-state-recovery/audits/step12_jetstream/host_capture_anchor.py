"""Owned post-capture byte anchors, not B8 acceptance or a boot decision.

The privileged caller must load this program and its standard-library interpreter from
a trusted root-controlled installation. Checking ownership after importing writable
code cannot establish that trust. No production invocation or installer is supplied.
"""
import contextlib
import fcntl
import hashlib
import importlib
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


@contextlib.contextmanager
def held_snapshot(capture, writer_uid, nonce):
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
        value = {'scope': SCOPE, 'capture_nonce': nonce, 'writer_uid': writer_uid,
                'capture_path': str(directory.path), 'capture_device': info.st_dev,
                'capture_inode': info.st_ino,
                'files': {name: {'sha256': read[1], 'size': read[2]} for name, read in reads.items()}}


        def check():
            for item in inputs.values():
                item.check()
            active.check()
            require('FAILED.json' not in os.listdir(directory.fd), 'failed capture cannot be anchored')
            directory.check()

        yield {'value': value, 'files': {name: reads[name][0] for name in FILES},
               'clone': inputs[CLONE], 'directory': directory, 'check': check}


def snapshot(capture, writer_uid, nonce):
    with held_snapshot(capture, writer_uid, nonce) as held:
        held['check']()
        return held['value']


READER_MODULES = ('host_asif_extract', 'host_guest_commit', 'host_image_immutable',
                  'host_journal_mount', 'host_vm_capture', 'host_vm_preflight', 'nats_identity',
                  'preservation_checks', 'preservation_journal', 'stopped_journal_inputs',
                  'host_protected_journal_reader')


RELEASE_SCHEMA = 'openclaw-approved-reader-v1'
CODE_NAMES = {name + '.py' for name in (*READER_MODULES, 'host_capture_anchor')}


@contextlib.contextmanager
def approved_release(manifest_path, expected_digest):
    require(isinstance(expected_digest, str) and re.fullmatch('[0-9a-f]{64}', expected_digest),
            'approved release digest is invalid')
    manifest_path = pathlib.Path(manifest_path)
    program = pathlib.Path(__file__).resolve()
    require(manifest_path.is_absolute() and '..' not in manifest_path.parts
            and manifest_path.parent != program.parent and program.name == 'host_capture_anchor.py',
            'approved manifest must be outside the exact code directory')
    with contextlib.ExitStack() as stack:
        parent = stack.enter_context(Directory(manifest_path.parent, {0}))
        manifest = stack.enter_context(Input(parent, manifest_path.name, 0))
        raw, digest, _size = manifest.read(True)
        require(digest == expected_digest, 'release is not independently approved')
        value = canonical(raw)
        require(set(value) == {'schema', 'files'} and value['schema'] == RELEASE_SCHEMA
                and isinstance(value['files'], dict) and set(value['files']) == CODE_NAMES,
                'approved release schema or file set differs')
        for item in value['files'].values():
            require(isinstance(item, dict) and set(item) == {'size', 'sha256'}
                    and type(item['size']) is int and 0 < item['size'] <= LIMIT
                    and isinstance(item['sha256'], str) and re.fullmatch('[0-9a-f]{64}', item['sha256']),
                    'approved release file binding is invalid')
        directory = stack.enter_context(Directory(program.parent, {0}))
        require(set(os.listdir(directory.fd)) == CODE_NAMES, 'reader code directory entries differ')
        inputs = {name: stack.enter_context(Input(directory, name, 0, private=False))
                  for name in sorted(CODE_NAMES)}
        reads = {name: item.read(True) for name, item in inputs.items()}
        require(all({'sha256': read[1], 'size': read[2]} == value['files'][name]
                    for name, read in reads.items()), 'source differs from approved release')

        def check():
            require(set(os.listdir(directory.fd)) == CODE_NAMES, 'reader code directory entries differ')
            os.lseek(manifest.fd, 0, os.SEEK_SET)
            require(manifest.read(True)[0] == raw, 'approved release manifest changed')
            for name, item in inputs.items():
                os.lseek(item.fd, 0, os.SEEK_SET)
                require(item.read(True) == reads[name], 'reader source hash changed')
            parent.check()
            directory.check()

        check()
        yield {'program': program, 'digest': digest,
               'sources': {name: read[0] for name, read in reads.items()},
               'hashes': {name: read[1] for name, read in reads.items()}, 'check': check}


@contextlib.contextmanager
def approved_entry(root, capture, writer_uid, nonce, fixture, manifest_path, expected_digest):
    authority = entry(root, capture, writer_uid, nonce, fixture)
    with approved_release(manifest_path, expected_digest) as release:
        require(authority['program_sha256'] == release['hashes']['host_capture_anchor.py'],
                'running anchor differs from approved release')
        yield {'authority': {**authority, 'release_sha256': release['digest'],
                             'source_sha256': release['hashes']}, 'release': release}
        release['check']()


@contextlib.contextmanager
def reader_code(release):
    program = release['program']
    release['check']()
    require(all(name not in sys.modules for name in (*READER_MODULES, 'host_capture_anchor')),
            'reader project module was preloaded')
    original_path = list(sys.path)
    if str(program.parent) not in sys.path:
        sys.path.append(str(program.parent))
    utility = importlib.import_module('importlib.util')
    loaded = {}
    running = sys.modules[__name__]

    class HeldLoader:
        def find_spec(self, fullname, path=None, target=None):
            if fullname.split('.')[0] not in (*READER_MODULES, 'host_capture_anchor'):
                return None
            require(fullname in READER_MODULES, 'reader anchor or submodule import is forbidden')
            spec = utility.spec_from_loader(fullname, self,
                                            origin=str(program.parent / (fullname + '.py')))
            spec.has_location = True
            return spec

        def create_module(self, spec):
            return None

        def exec_module(self, module):
            release['check']()
            name = module.__name__
            require(name in READER_MODULES and name not in loaded,
                    'reader module execution differs')
            require(module.__spec__.loader is self
                    and module.__spec__.origin == str(program.parent / (name + '.py')),
                    'reader import resolution differs')
            loaded[name] = module
            raw = release['sources'][name + '.py']
            exec(compile(raw, str(program.parent / (name + '.py')), 'exec', dont_inherit=True),
                 module.__dict__)
            release['check']()

    finder = HeldLoader()
    sys.meta_path.insert(0, finder)
    try:
        modules = {name: importlib.import_module(name) for name in READER_MODULES}

        def check():
            release['check']()
            require(sys.meta_path and sys.meta_path[0] is finder,
                    'reader held import guard changed')
            require('host_capture_anchor' not in sys.modules and set(loaded) == set(READER_MODULES)
                    and all(sys.modules.get(name) is module and modules[name] is module
                            and module.__file__ == str(program.parent / (name + '.py'))
                            and module.__spec__.loader is finder for name, module in loaded.items()),
                    'reader loaded module identity differs')
            observed = set()
            for name, module in tuple(sys.modules.items()):
                file = getattr(module, '__file__', None)
                if file and pathlib.Path(file).resolve().parent == program.parent:
                    require((name == __name__ and module is running)
                            or (name in loaded and loaded[name] is module),
                            'reader loaded local module set differs')
                    observed.add(pathlib.Path(file).name)
            require(observed == CODE_NAMES, 'reader loaded local module set differs')
            return trusted_runtime()

        authority = check()
        yield {'modules': modules, 'hashes': release['hashes'], 'authority': authority, 'check': check}
    finally:
        if finder in sys.meta_path:
            sys.meta_path.remove(finder)
        for name, module in loaded.items():
            if sys.modules.get(name) is module:
                del sys.modules[name]
        sys.path[:] = original_path


def reader_action(root, capture, capture_uid, nonce, guest_uid, writer_uid, *,
                  release_manifest, release_sha256, fixture=False, receipt=False):
    require(type(guest_uid) is int and guest_uid >= 0 and type(writer_uid) is int and writer_uid >= 0,
            'reader owner context is invalid')
    with approved_entry(root, capture, capture_uid, nonce, fixture,
                        release_manifest, release_sha256) as selected:
        authority, release = selected['authority'], selected['release']
        with reader_code(release) as code:
            require(code['authority'] == {key: authority[key] for key in code['authority']},
                    'reader authority changed while loading code')
            module = code['modules']['host_protected_journal_reader']
            operation = module.read_receipt if receipt else module.read_image
            environment = dict(os.environ)
            try:
                os.environ.clear()
                os.environ.update(PATH='/usr/bin:/bin:/usr/sbin:/sbin', LC_ALL='C')
                code['check']()
                return operation(sys.modules[__name__], root, capture, capture_uid, nonce,
                                 guest_uid, writer_uid, authority, code)
            finally:
                os.environ.clear()
                os.environ.update(environment)


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


def publish(root, capture, writer_uid, nonce, *, release_manifest, release_sha256, fixture=False):
    with approved_entry(root, capture, writer_uid, nonce, fixture,
                        release_manifest, release_sha256) as selected:
        authority, release = selected['authority'], selected['release']
        with Directory(root, {0}) as directory:
            fcntl.flock(directory.fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
            final, pending = nonce + '.json', nonce + '.pending'
            require(not any(name in os.listdir(directory.fd) for name in (final, pending)),
                    'anchor already exists or publication is incomplete')
            release['check']()
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
            release['check']()
            os.link(pending, final, src_dir_fd=directory.fd, dst_dir_fd=directory.fd,
                    follow_symlinks=False)
            os.fsync(directory.fd)
            os.unlink(pending, dir_fd=directory.fd)
            os.fsync(directory.fd)
            with Input(directory, final, 0) as record:
                require(canonical(record.read(True)[0]) == value, 'anchor publication read-back differs')
            directory.check()


def verify(root, capture, writer_uid, nonce, *, release_manifest, release_sha256, fixture=False):
    with approved_entry(root, capture, writer_uid, nonce, fixture,
                        release_manifest, release_sha256) as selected:
        authority, release = selected['authority'], selected['release']
        with Directory(root, {0}) as directory:
            fcntl.flock(directory.fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
            require(nonce + '.pending' not in os.listdir(directory.fd), 'anchor publication is incomplete')
            with Input(directory, nonce + '.json', 0) as record:
                value = canonical(record.read(True)[0])
                release['check']()
                require(value == {**snapshot(capture, writer_uid, nonce), 'authority': authority},
                        'protected capture byte anchor differs')
                record.check()
                directory.check()
                os.fsync(record.fd)
                os.fsync(directory.fd)


if __name__ == '__main__':
    require(os.environ.get('CI') == 'true' and os.environ.get('GITHUB_ACTIONS') == 'true'
            and len(sys.argv) in (9, 11) and sys.argv[1] == '--ci-owned',
            'only the CI-owned anchor command is enabled')
    if len(sys.argv) == 9:
        require(sys.argv[2] in ('publish', 'verify'), 'only the CI-owned anchor command is enabled')
        action = publish if sys.argv[2] == 'publish' else verify
        action(pathlib.Path(sys.argv[3]), pathlib.Path(sys.argv[4]), int(sys.argv[5]), sys.argv[6],
               release_manifest=sys.argv[7], release_sha256=sys.argv[8], fixture=True)
        print('owned byte anchor ' + ('published' if action == publish else 'verified'))
    else:
        require(sys.argv[2] in ('read', 'receipt')
                and all(re.fullmatch('0|[1-9][0-9]*', sys.argv[index]) for index in (5, 7, 8)),
                'reader action or decimal owner context is invalid')
        value = reader_action(pathlib.Path(sys.argv[3]), pathlib.Path(sys.argv[4]), int(sys.argv[5]),
                              sys.argv[6], int(sys.argv[7]), int(sys.argv[8]),
                              release_manifest=sys.argv[9], release_sha256=sys.argv[10], fixture=True,
                              receipt=sys.argv[2] == 'receipt')
        print(json.dumps(value, sort_keys=True))
