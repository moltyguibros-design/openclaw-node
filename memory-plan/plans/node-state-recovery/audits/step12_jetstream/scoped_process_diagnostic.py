#!/usr/bin/env python3
import argparse
import hashlib
import json
import os
import pathlib
import re
import stat
import subprocess
import sys
import tempfile

HERE = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parents[4] / 'lib'))
import nats_macos_proc as proc
from preservation_checks import Refused, relevant_entrypoint, require
from preservation_journal import DIGEST, boot_identity, encoded, regular_content

SCOPE = ('owned current-boot diagnostic; on-disk hash at observation with ctime bound only; '
         'not loaded-image proof, boot policy or admission')
PROCESS_KEYS = {'pid', 'ppid', 'uid', 'gid', 'name', 'start_sec', 'start_usec',
                'executable', 'executable_sha256', 'arguments', 'cwd'}
IDENTITY_KEYS = ('pid', 'ppid', 'uid', 'gid', 'start_sec', 'start_usec')
BRACKET_KEYS = (*IDENTITY_KEYS, 'name')
PID_ENUMERATOR = proc.list_pids


def absolute(value):
    return (isinstance(value, str) and value.startswith('/') and '\0' not in value
            and '\ufffd' not in value and os.path.normpath(value) == value)


def process_record(value):
    require(isinstance(value, dict) and set(value) == PROCESS_KEYS,
            'process schema differs')
    require(all(type(value[key]) is int and value[key] >= 0 for key in IDENTITY_KEYS)
            and value['pid'] > 0 and value['start_sec'] > 0 and value['start_usec'] < 1000000,
            'process generation is invalid')
    require(absolute(value['executable']) and absolute(value['cwd'])
            and isinstance(value['name'], str) and value['name']
            and isinstance(value['executable_sha256'], str)
            and DIGEST.fullmatch(value['executable_sha256'])
            and isinstance(value['arguments'], list) and value['arguments']
            and all(isinstance(arg, str) and '\0' not in arg and '\ufffd' not in arg
                    for arg in value['arguments']), 'process paths or arguments are invalid')


def expectations_record(value):
    require(isinstance(value, dict) and set(value) == {'scope', 'boot', 'uid', 'roots', 'expected'}
            and value['scope'] == SCOPE, 'diagnostic expectation schema differs')
    require(isinstance(value['boot'], str) and DIGEST.fullmatch(value['boot'])
            and type(value['uid']) is int and value['uid'] >= 0,
            'diagnostic boot or UID is invalid')
    require(isinstance(value['roots'], list) and value['roots']
            and all(absolute(root) for root in value['roots'])
            and len(set(value['roots'])) == len(value['roots']),
            'diagnostic roots are invalid')
    require(isinstance(value['expected'], list), 'diagnostic expected table is absent')
    for row in value['expected']:
        process_record(row)
    require(len({row['pid'] for row in value['expected']}) == len(value['expected']),
            'diagnostic expected PID is duplicated')
    require(all(in_scope(row, value['uid'], value['roots']) for row in value['expected']),
            'diagnostic expectation is outside the required scope')


def snapshot(pid):
    field = 'identity'
    try:
        before = proc.bsd_info(pid)
        field = 'executable'
        executable = str(pathlib.Path(proc.executable(pid)).resolve(strict=True))
        field = 'arguments'
        arguments = proc.arguments(pid)
        field = 'cwd'
        directory = proc.working_directory(pid)
        require(isinstance(directory, dict) and absolute(directory.get('path')),
                'process cwd is unobservable')
        cwd = str(pathlib.Path(directory['path']).resolve(strict=True))
        field = 'executable-bytes'
        digest = regular_content(executable, 1 << 30)
        field = 'executable-age'
        require(pathlib.Path(executable).lstat().st_ctime_ns // 1000
                <= before['start_sec'] * 1000000 + before['start_usec'],
                'executable pathname changed after process start')
        field = 'stability'
        after = proc.bsd_info(pid)
        require({key: before[key] for key in BRACKET_KEYS}
                == {key: after[key] for key in BRACKET_KEYS}
                and before['pid'] == pid
                and str(pathlib.Path(proc.executable(pid)).resolve(strict=True)) == executable
                and proc.arguments(pid) == arguments
                and proc.working_directory(pid) == directory,
                'process changed within its observation')
        row = {**{key: before[key] for key in BRACKET_KEYS}, 'executable': executable,
               'executable_sha256': digest, 'arguments': arguments, 'cwd': cwd}
        field = 'schema'
        process_record(row)
        return row, None
    except (OSError, RuntimeError, ValueError, KeyError, TypeError) as error:
        return None, {'pid': pid, 'field': field, 'error_type': type(error).__name__}


def observe():
    unknown, processes = [], []
    before = after = []
    enumeration = 'full' if proc.list_pids is PID_ENUMERATOR else 'substituted'
    try:
        boot = boot_identity()
    except (OSError, RuntimeError, ValueError, subprocess.SubprocessError) as error:
        return {'boot': None, 'before': [], 'after': [], 'processes': [], 'unstable': [],
                'enumeration': enumeration,
                'unknown': [{'pid': None, 'field': 'boot-before', 'error_type': type(error).__name__}]}
    for stage in ('before', 'after'):
        try:
            listed = proc.list_pids()
            require(isinstance(listed, list) and len(set(listed)) == len(listed)
                    and all(type(pid) is int and pid > 0 for pid in listed),
                    'process list is invalid')
            require(enumeration != 'full' or os.getpid() in listed,
                    'full PID list omits the diagnostic process')
            listed = sorted(listed)
        except (OSError, RuntimeError, ValueError, TypeError) as error:
            unknown.append({'pid': None, 'field': 'pid-list-' + stage,
                            'error_type': type(error).__name__})
            listed = []
        if stage == 'before':
            before = listed
            for pid in before:
                row, failure = snapshot(pid)
                if failure is not None:
                    unknown.append(failure)
                else:
                    processes.append(row)
        else:
            after = listed
            initial = {row['pid']: row for row in processes}
            for pid in after:
                row, failure = snapshot(pid)
                if failure is not None:
                    unknown.append({**failure, 'field': 'sample-B:' + failure['field']})
                elif row != initial.get(pid):
                    unknown.append({'pid': pid, 'field': 'between-samples',
                                    'error_type': 'ChangedProcess'})
    unstable = sorted(set(before) ^ set(after))
    unknown.extend({'pid': pid, 'field': 'unstable-pid', 'error_type': 'UnexcludedScope'}
                   for pid in unstable)
    try:
        if boot_identity() != boot:
            unknown.append({'pid': None, 'field': 'boot-changed', 'error_type': 'ChangedBoot'})
    except (OSError, RuntimeError, ValueError, subprocess.SubprocessError) as error:
        unknown.append({'pid': None, 'field': 'boot-after', 'error_type': type(error).__name__})
    return {'boot': boot, 'before': before, 'after': after, 'enumeration': enumeration,
            'processes': processes, 'unknown': unknown, 'unstable': unstable}


def in_scope(row, uid, roots):
    if row['uid'] == uid:
        return True
    values = [row['executable'], row['cwd'], *row['arguments']]
    if any('$' in arg or '~' in arg for arg in row['arguments']):
        raise Refused('other-UID argument path cannot be excluded')
    for value in values:
        candidate = pathlib.Path(value)
        if not candidate.is_absolute():
            candidate = pathlib.Path(row['cwd']) / candidate
        resolved = candidate.resolve(strict=False)
        if any(resolved == pathlib.Path(root) or pathlib.Path(root) in resolved.parents
               for root in roots):
            return True
    values.extend(str(pathlib.Path(row['cwd']) / arg)
                  for arg in row['arguments'] if arg and not arg.startswith('/'))
    return relevant_entrypoint('', values, tuple(map(pathlib.Path, roots)),
                               working_directory=row['cwd'])


def redacted(row):
    return {key: value for key, value in row.items() if key != 'arguments'} | {
        'arguments_sha256': hashlib.sha256(b'\0'.join(arg.encode() for arg in row['arguments'])).hexdigest()}


def compare(observed, expected):
    expectations_record(expected)
    require(isinstance(observed, dict) and set(observed) ==
            {'boot', 'before', 'after', 'processes', 'unknown', 'unstable', 'enumeration'}
            and observed['enumeration'] in ('full', 'substituted'),
            'process observation schema differs')
    require(isinstance(observed['processes'], list) and isinstance(observed['unknown'], list)
            and isinstance(observed['unstable'], list), 'process observation table is invalid')
    for name in ('before', 'after', 'unstable'):
        values = observed[name]
        require(isinstance(values, list) and all(type(pid) is int and pid > 0 for pid in values)
                and values == sorted(set(values)), 'process enumeration schema differs')
    require(all(isinstance(row, dict) and set(row) == {'pid', 'field', 'error_type'}
                and (row['pid'] is None or type(row['pid']) is int and row['pid'] > 0)
                and all(isinstance(row[key], str) and row[key] for key in ('field', 'error_type'))
                for row in observed['unknown']), 'unknown process schema differs')
    for row in observed['processes']:
        process_record(row)
    pids = [row['pid'] for row in observed['processes']]
    require(len(set(pids)) == len(pids), 'observed PID is duplicated')
    matched, unexpected, excluded, unknown = [], [], [], list(observed['unknown'])
    errors = []
    if observed['boot'] != expected['boot']:
        errors.append('current boot differs from explicit expectations')
    if observed['before'] != observed['after'] or observed['unstable']:
        errors.append('process enumeration is unstable')
    represented = set(pids) | {row['pid'] for row in unknown if row['pid'] is not None}
    if represented != set(observed['before']) | set(observed['after']):
        errors.append('process enumeration coverage differs')
    for row in observed['processes']:
        try:
            scoped = in_scope(row, expected['uid'], expected['roots'])
        except (OSError, RuntimeError, ValueError) as error:
            unknown.append({'pid': row['pid'], 'field': 'scope', 'error_type': type(error).__name__})
            continue
        if not scoped:
            excluded.append(row['pid'])
        elif row in expected['expected']:
            matched.append(redacted(row))
        else:
            unexpected.append(redacted(row))
    missing = [redacted(row) for row in expected['expected']
               if row['pid'] not in {item['pid'] for item in matched}]
    clean = not (errors or unknown or unexpected or missing)
    return {'scope': SCOPE, 'outcome': 'clean' if clean else 'refused',
            'admission': False, 'history_certified': False,
            'expectations_sha256': hashlib.sha256(encoded(expected)).hexdigest(),
            'boot': observed['boot'], 'matched': matched, 'unexpected': unexpected,
            'unknown': unknown, 'missing': missing, 'excluded_pids': excluded, 'errors': errors,
            'coverage': {'uid_scope': True, 'sampled': True, 'single_instant': False,
                         'enumeration': observed['enumeration'],
                         'continuous': False, 'physical_exclusion': False,
                         'executable_binding': 'observed on-disk bytes, not loaded-image authorship'}}


def inspect_owned(root, *, fixture=False):
    require(fixture, 'production scoped process diagnostic is disabled')
    root = pathlib.Path(root)
    require(root.is_absolute() and root.parent == pathlib.Path(tempfile.gettempdir()).resolve()
            and re.fullmatch(r'openclaw-owned-process-[0-9a-f]{16}', root.name)
            and root.resolve(strict=True) == root, 'diagnostic requires a literal owned fixture root')
    info = root.lstat()
    require(stat.S_ISDIR(info.st_mode) and info.st_uid == os.getuid()
            and stat.S_IMODE(info.st_mode) == 0o700, 'diagnostic root is not private')
    path = root / 'expectations.json'
    info = path.lstat()
    require(stat.S_ISREG(info.st_mode) and info.st_uid == os.getuid() and info.st_nlink == 1
            and stat.S_IMODE(info.st_mode) == 0o600, 'diagnostic expectations are not private')
    raw = regular_content(path, 1 << 20, keep_bytes=True)
    expected = json.loads(raw)
    expectations_record(expected)
    require(encoded(expected) == raw and expected['uid'] == os.getuid()
            and all(pathlib.Path(item).is_relative_to(root)
                    and pathlib.Path(item).resolve(strict=True) == pathlib.Path(item)
                    for item in expected['roots']),
            'diagnostic expectations escape the owned fixture')
    return compare(observe(), expected)


def main():
    parser = argparse.ArgumentParser(description=SCOPE)
    parser.add_argument('owned_root')
    parser.add_argument('--fixture', action='store_true')
    args = parser.parse_args()
    try:
        result = inspect_owned(args.owned_root, fixture=args.fixture)
    except (OSError, RuntimeError, ValueError, subprocess.SubprocessError) as error:
        result = {'scope': SCOPE, 'outcome': 'refused', 'admission': False,
                  'history_certified': False, 'error': str(error)}
    print(encoded(result).decode())
    return 0 if result['outcome'] == 'clean' else 2


if __name__ == '__main__':
    raise SystemExit(main())
