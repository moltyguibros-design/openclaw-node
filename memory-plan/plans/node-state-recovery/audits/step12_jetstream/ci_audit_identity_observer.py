STARTUP = dict(__import__('os').environ)

import ctypes
import json
import os
import pathlib
import re
import selectors
import signal
import subprocess
import sys
import time

UUID = '00000000-0000-0000-0000-000000000003'
SCHEMA = 'openclaw-ci-audit-identity-observation-v1'
HEADER = {'commit': 'f6217f891ac0bb64f3d375211650a4c1ff8ca1ea',
          'path': 'bsd/bsm/audit.h', 'bytes': 12942,
          'sha256': '338dff615c1c7d8e3bd3379dd491969f1fb39f0d626e9b1c349f2a66fa9d73f4'}
SUDO_KEYS = ('SUDO_UID', 'SUDO_GID', 'SUDO_USER', 'SUDO_COMMAND')
TAGS = {'absent', 'read-error', 'non-canonical', 'sentinel-4294967295', 'decimal'}


class IntegrityError(Exception):
    pass


def require(condition, message):
    if not condition:
        raise IntegrityError(message)


def scalar(raw=None, error=None, *, allow_lf=False):
    value = None
    if error is not None:
        raw = None
        tag = 'read-error'
    elif raw is None:
        tag = 'absent'
    else:
        data = raw[:-1] if allow_lf and raw.endswith(b'\n') else raw
        if not re.fullmatch(rb'(0|[1-9][0-9]{0,9})', data) or int(data) > 4294967295:
            tag = 'non-canonical'
        else:
            value = int(data)
            tag = 'sentinel-4294967295' if value == 4294967295 else 'decimal'
    return {'raw_hex': None if raw is None else raw.hex(), 'tag': tag,
            'number': value, 'error': error}


def read_bytes(path, limit):
    try:
        fd = os.open(path, os.O_RDONLY | os.O_CLOEXEC)
        try:
            data = bytearray()
            while len(data) <= limit:
                chunk = os.read(fd, limit + 1 - len(data))
                if not chunk:
                    break
                data.extend(chunk)
            data = bytes(data)
        finally:
            os.close(fd)
    except OSError as error:
        return None, {'errno': error.errno, 'type': type(error).__name__}
    require(len(data) <= limit, 'read exceeds declared byte bound')
    return data, None


def child(argv, *, env=None, timeout=8, limit=32768):
    started = time.time()
    try:
        process = subprocess.Popen(argv, cwd='/', env=env, stdin=subprocess.DEVNULL,
                                   stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                   start_new_session=True)
    except OSError as error:
        return {'argv': argv, 'pid': None, 'started_unix_s': started, 'ended_unix_s': time.time(),
                'timeout_s': timeout, 'channel_bound': limit, 'rc': None, 'waited': None,
                'timed_out': False, 'truncated': False, 'stdout_hex': '', 'stderr_hex': '',
                'error': {'errno': error.errno, 'type': type(error).__name__},
                'descendant_absence': 'no child started'}
    data = {'stdout': bytearray(), 'stderr': bytearray()}
    timed_out = truncated = False
    deadline = time.monotonic() + timeout
    with selectors.DefaultSelector() as selected:
        for name, pipe in [('stdout', process.stdout), ('stderr', process.stderr)]:
            os.set_blocking(pipe.fileno(), False)
            selected.register(pipe, selectors.EVENT_READ, name)
        while selected.get_map():
            if time.monotonic() >= deadline:
                timed_out = True
                break
            for key, _ in selected.select(min(0.1, max(0, deadline - time.monotonic()))):
                chunk = os.read(key.fileobj.fileno(), min(4096, limit + 1 - len(data[key.data])))
                if not chunk:
                    selected.unregister(key.fileobj)
                    continue
                data[key.data].extend(chunk)
                if len(data[key.data]) > limit:
                    truncated = True
                    break
            if truncated:
                break
    if timed_out or truncated:
        process.send_signal(signal.SIGTERM)
        try:
            process.wait(timeout=2)
        except subprocess.TimeoutExpired:
            process.kill()
    try:
        rc = process.wait(timeout=2)
        waited = True
    except subprocess.TimeoutExpired:
        timed_out = True
        process.terminate()
        try:
            process.wait(timeout=2)
        except subprocess.TimeoutExpired:
            process.kill()
        try:
            rc, waited = process.wait(timeout=2), True
        except subprocess.TimeoutExpired:
            rc, waited = None, False
    for pipe in (process.stdout, process.stderr):
        pipe.close()
    return {'argv': argv, 'pid': process.pid, 'started_unix_s': started,
            'ended_unix_s': time.time(), 'timeout_s': timeout, 'channel_bound': limit,
            'rc': rc, 'waited': waited, 'timed_out': timed_out, 'truncated': truncated,
            'stdout_hex': bytes(data['stdout'][:limit]).hex(),
            'stderr_hex': bytes(data['stderr'][:limit]).hex(),
            'descendant_absence': 'not certified; uncertainty fails complete probe'}


class Mask(ctypes.Structure):
    _fields_ = [('success', ctypes.c_uint32), ('failure', ctypes.c_uint32)]


class Terminal(ctypes.Structure):
    _fields_ = [('port', ctypes.c_int32), ('type', ctypes.c_uint32),
                ('address', ctypes.c_uint32 * 4)]


class AuditInfo(ctypes.Structure):
    _fields_ = [('auid', ctypes.c_uint32), ('mask', Mask), ('terminal', Terminal),
                ('asid', ctypes.c_int32), ('flags', ctypes.c_uint64)]


def darwin_audit():
    layout = {name: getattr(AuditInfo, name).offset for name, _ in AuditInfo._fields_}
    require(ctypes.sizeof(AuditInfo) == 48 and ctypes.alignment(AuditInfo) == 8
            and layout == {'auid': 0, 'mask': 4, 'terminal': 12, 'asid': 36, 'flags': 40},
            'Darwin audit ABI differs from declared layout')
    result = {'header': HEADER, 'struct_size': 48, 'struct_alignment': 8, 'offsets': layout}
    library = None
    try:
        library = ctypes.CDLL('/usr/lib/libSystem.B.dylib', use_errno=True)
        get_uid = library.getauid
        get_uid.argtypes, get_uid.restype = [ctypes.POINTER(ctypes.c_uint32)], ctypes.c_int
        uid = ctypes.c_uint32(4294967295)
        ctypes.set_errno(0)
        rc = get_uid(ctypes.byref(uid))
        error = ctypes.get_errno() if rc else 0
        raw = None if rc else bytes(uid)
        result['getauid'] = {'rc': rc, 'errno': error, 'raw_hex': None if raw is None else raw.hex(),
                            'value': scalar(None if rc else str(uid.value).encode(),
                                            {'errno': error} if rc else None)}
    except (OSError, AttributeError) as error:
        result['getauid'] = {'rc': None, 'errno': getattr(error, 'errno', None),
                            'raw_hex': None, 'value': scalar(error={'type': type(error).__name__})}
    try:
        get_info = library.getaudit_addr
        get_info.argtypes, get_info.restype = [ctypes.POINTER(AuditInfo), ctypes.c_int], ctypes.c_int
        info = AuditInfo()
        ctypes.set_errno(0)
        rc = get_info(ctypes.byref(info), ctypes.sizeof(info))
        error = ctypes.get_errno() if rc else 0
        result['getaudit_addr'] = {'rc': rc, 'errno': error, 'length': 48,
            'raw_hex': None if rc else bytes(info).hex(), 'decoded': None if rc else {
                'auid': scalar(str(info.auid).encode()),
                'asid': scalar(str(info.asid & 4294967295).encode()),
                'mask': [info.mask.success, info.mask.failure],
                'terminal': {'port': info.terminal.port, 'type': info.terminal.type,
                             'address': list(info.terminal.address)}, 'flags': info.flags}}
    except (OSError, AttributeError) as error:
        result['getaudit_addr'] = {'rc': None, 'errno': getattr(error, 'errno', None),
                                 'length': 48, 'raw_hex': None, 'decoded': None,
                                 'error': type(error).__name__}
    result['id_A'] = child(['/usr/bin/id', '-A'])
    return result


def snapshot_environment(environment):
    require(len(environment) <= 256, 'environment key count exceeds bound')
    require(all(len(key.encode()) <= 256 for key in environment), 'environment key exceeds bound')
    require('SUDO_ASKPASS' not in environment, 'askpass is outside this probe')
    sudo = {key: environment.get(key) for key in SUDO_KEYS}
    require(all(value is None or len(value.encode()) <= 4096 for value in sudo.values()),
            'sudo metadata exceeds bound')
    return {'keys': sorted(environment), 'sudo': sudo,
            'sudo_uid': scalar(None if sudo['SUDO_UID'] is None else sudo['SUDO_UID'].encode()),
            'sudo_gid': scalar(None if sudo['SUDO_GID'] is None else sudo['SUDO_GID'].encode())}


def observe(context):
    require(sys.flags.isolated and sys.flags.no_site and sys.flags.dont_write_bytecode,
            'observer needs isolated no-site no-bytecode Python')
    environment = snapshot_environment(STARTUP)
    result = {'schema': SCHEMA, 'context': context, 'environment': environment,
              'scope': 'record-only fresh CI; no authentication or admission decision',
              'uid': os.getuid(), 'euid': os.geteuid(), 'gid': os.getgid(), 'egid': os.getegid(),
              'groups': os.getgroups(), 'pid': os.getpid(), 'ppid': os.getppid(),
              'session_id': os.getsid(0), 'process_group': os.getpgrp(),
              'tty': {}, 'platform': sys.platform,
              'interpreter': {'path': sys.executable, 'realpath': str(pathlib.Path(sys.executable).resolve()),
                              'version': sys.version, 'flags': repr(sys.flags),
                              'status': 'declared CI runtime assumptions, not host approval or kernel executable proof'},
              'uname': list(os.uname())}
    require(len(result['groups']) <= 256, 'group count exceeds bound')
    for fd in range(3):
        try:
            name, error = os.ttyname(fd), None
        except OSError as failure:
            name, error = None, failure.errno
        result['tty'][str(fd)] = {'isatty': os.isatty(fd), 'name': name, 'errno': error}
    if sys.platform == 'linux':
        raw, error = read_bytes('/proc/self/status', 65536)
        require(error is None, 'missing Linux process uid context')
        lines = [line.decode('ascii') for line in raw.splitlines() if line.startswith((b'Uid:', b'Gid:'))]
        require(len(lines) == 2, 'Linux process uid/gid lines differ')
        result['saved_uid'] = {'getresuid': list(os.getresuid()), 'getresgid': list(os.getresgid()),
                               'status_lines': lines}
        result['audit'] = {}
        for name in ('loginuid', 'sessionid'):
            raw, error = read_bytes('/proc/self/' + name, 64)
            result['audit'][name] = scalar(raw, error, allow_lf=True)
    elif sys.platform == 'darwin':
        result['saved_uid'] = {'status': 'unavailable', 'reason': 'Python stdlib has no getresuid on Darwin'}
        result['audit'] = darwin_audit()
    else:
        raise IntegrityError('unsupported CI platform')
    return result


def main():
    require(len(sys.argv) == 4 and sys.argv[1:3] == ['--ci-audit-observe', UUID]
            and sys.argv[3] in ('plain', 'sudo'), 'observer requires the exact CI-only shape')
    raw = (json.dumps(observe(sys.argv[3]), sort_keys=True, separators=(',', ':')) + '\n').encode()
    require(len(raw) <= 65536, 'observer report exceeds bound')
    sys.stdout.buffer.write(raw)


if __name__ == '__main__':
    try:
        main()
    except IntegrityError as error:
        raise SystemExit(str(error))
