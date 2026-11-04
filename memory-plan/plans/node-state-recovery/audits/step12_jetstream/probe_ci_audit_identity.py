import hashlib
import importlib.util
import json
import os
import pathlib
import re
import sys
import time

STEP = pathlib.Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('ci_audit_identity_observer', STEP / 'ci_audit_identity_observer.py')
o = importlib.util.module_from_spec(spec)
spec.loader.exec_module(o)
FILES = ('ci_audit_identity_observer.py', 'probe_ci_audit_identity.py', 'test_ci_audit_identity.py')
OBSERVATION_KEYS = {'schema', 'context', 'environment', 'scope', 'uid', 'euid', 'gid', 'egid',
                    'groups', 'pid', 'ppid', 'session_id', 'process_group', 'tty', 'platform',
                    'interpreter', 'uname', 'saved_uid', 'audit'}
FORBIDDEN_FIELDS = {'valid', 'operator', 'authenticated', 'positive', 'admitted', 'admission'}


def canonical(value):
    return (json.dumps(value, sort_keys=True, separators=(',', ':')) + '\n').encode()


def field_check(value):
    if isinstance(value, dict):
        o.require(not FORBIDDEN_FIELDS.intersection(value), 'decision fields are outside observation schema')
        for item in value.values():
            field_check(item)
    elif isinstance(value, list):
        for item in value:
            field_check(item)


def check_scalar(value):
    o.require(set(value) == {'raw_hex', 'tag', 'number', 'error'} and value['tag'] in o.TAGS,
              'scalar schema differs')
    if value['raw_hex'] is not None:
        o.require(isinstance(value['raw_hex'], str) and len(value['raw_hex']) <= 128
                  and re.fullmatch('[0-9a-f]*', value['raw_hex']) is not None, 'raw scalar differs')
    o.require(value['number'] is None or type(value['number']) is int, 'scalar number differs')
    if value['tag'] == 'read-error':
        o.require(value['raw_hex'] is None and value['number'] is None, 'failed scalar has invented raw data')


def exact(value, keys):
    o.require(type(value) is dict and set(value) == set(keys), 'nested observation schema differs')


def check_observation(value, context, runner):
    exact(value, OBSERVATION_KEYS)
    field_check(value)
    o.require(value['schema'] == o.SCHEMA and value['context'] == context
              and value['platform'] == sys.platform, 'observation context differs')
    for name in ('uid', 'euid', 'gid', 'egid', 'pid', 'ppid', 'session_id', 'process_group'):
        o.require(type(value[name]) is int and value[name] >= 0, 'process numeric field differs')
    o.require(value['uid'] == value['euid'] == (runner if context == 'plain' else 0),
              'process uid context differs')
    o.require(type(value['groups']) is list and len(value['groups']) <= 256
              and all(type(g) is int and g >= 0 for g in value['groups']), 'groups differ')
    o.require(type(value['scope']) is str and len(value['scope']) <= 256
              and type(value['uname']) is list and len(value['uname']) == 5
              and all(type(x) is str and len(x.encode()) <= 256 for x in value['uname']),
              'scope or uname differs')
    exact(value['interpreter'], ('path', 'realpath', 'version', 'flags', 'status'))
    o.require(all(type(v) is str and len(v.encode()) <= 4096
                  for v in value['interpreter'].values()), 'interpreter metadata differs')
    exact(value['tty'], ('0', '1', '2'))
    for tty in value['tty'].values():
        exact(tty, ('isatty', 'name', 'errno'))
        o.require(type(tty['isatty']) is bool and (tty['name'] is None
                  or type(tty['name']) is str and len(tty['name'].encode()) <= 4096)
                  and (tty['errno'] is None or type(tty['errno']) is int), 'tty metadata differs')
    environment = value['environment']
    exact(environment, ('keys', 'sudo', 'sudo_uid', 'sudo_gid'))
    o.require(environment['keys'] == sorted(set(environment['keys'])) and len(environment['keys']) <= 256
              and all(type(k) is str and len(k.encode()) <= 256 for k in environment['keys']),
              'environment key set differs')
    exact(environment['sudo'], o.SUDO_KEYS)
    o.require(all(v is None or type(v) is str and len(v.encode()) <= 4096
                  for v in environment['sudo'].values()), 'sudo metadata schema differs')
    for name in ('sudo_uid', 'sudo_gid'):
        check_scalar(environment[name])
        raw = environment['sudo'][name.upper()]
        o.require(environment[name] == o.scalar(None if raw is None else raw.encode()),
                  'sudo scalar raw binding differs')
    if sys.platform == 'linux':
        exact(value['audit'], ('loginuid', 'sessionid'))
        for item in value['audit'].values():
            check_scalar(item)
        saved = value['saved_uid']
        exact(saved, ('getresuid', 'getresgid', 'status_lines'))
        o.require(len(saved['getresuid']) == len(saved['getresgid']) == 3
                  and len(saved['status_lines']) == 2, 'Linux saved uid context differs')
        fields = {}
        for line in saved['status_lines']:
            parts = line.split()
            o.require(parts[0] in ('Uid:', 'Gid:') and len(parts) == 5
                      and all(re.fullmatch('[0-9]+', x) for x in parts[1:]), 'proc uid/gid line differs')
            fields[parts[0]] = list(map(int, parts[1:]))
        o.require(set(fields) == {'Uid:', 'Gid:'}
                  and fields['Uid:'][:3] == saved['getresuid']
                  and fields['Gid:'][:3] == saved['getresgid']
                  and saved['getresuid'][:2] == [value['uid'], value['euid']]
                  and saved['getresgid'][:2] == [value['gid'], value['egid']],
                  'Linux saved uid bindings differ')
    else:
        exact(value['saved_uid'], ('status', 'reason'))
        o.require(value['saved_uid'] == {'status': 'unavailable',
                  'reason': 'Python stdlib has no getresuid on Darwin'}, 'Darwin saved uid claim differs')
        audit = value['audit']
        exact(audit, ('header', 'struct_size', 'struct_alignment', 'offsets',
                      'getauid', 'getaudit_addr', 'id_A'))
        o.require(audit['header'] == o.HEADER and audit['struct_size'] == 48
                  and audit['struct_alignment'] == 8
                  and audit['offsets'] == {'auid': 0, 'mask': 4, 'terminal': 12, 'asid': 36, 'flags': 40},
                  'Darwin audit schema differs')
        exact(audit['getauid'], ('rc', 'errno', 'raw_hex', 'value'))
        check_scalar(audit['getauid']['value'])
        uid = audit['getauid']
        o.require((uid['raw_hex'] is not None and len(uid['raw_hex']) == 8) if uid['rc'] == 0
                  else uid['raw_hex'] is None and uid['value']['raw_hex'] is None
                  and uid['value']['number'] is None and uid['value']['tag'] == 'read-error',
                  'failed getauid has invented raw data')
        info = audit['getaudit_addr']
        exact(info, ('rc', 'errno', 'length', 'raw_hex', 'decoded') if 'error' not in info
              else ('rc', 'errno', 'length', 'raw_hex', 'decoded', 'error'))
        o.require(info['length'] == 48 and (info['raw_hex'] is None or len(info['raw_hex']) == 96),
                  'Darwin raw struct differs')
        o.require((info['raw_hex'] is not None and info['decoded'] is not None) if info['rc'] == 0
                  else info['raw_hex'] is None and info['decoded'] is None,
                  'failed getaudit_addr has invented raw data')
        if info['decoded'] is not None:
            decoded = info['decoded']
            exact(decoded, ('auid', 'asid', 'mask', 'terminal', 'flags'))
            for key in ('auid', 'asid'):
                check_scalar(decoded[key])
            exact(decoded['terminal'], ('port', 'type', 'address'))
            o.require(len(decoded['mask']) == 2 and len(decoded['terminal']['address']) == 4
                      and type(decoded['flags']) is int, 'Darwin decoded fields differ')
        command = audit['id_A']
        expected = {'argv', 'pid', 'started_unix_s', 'ended_unix_s', 'timeout_s', 'channel_bound',
                    'rc', 'waited', 'timed_out', 'truncated', 'stdout_hex', 'stderr_hex', 'descendant_absence'}
        exact(command, expected if 'error' not in command else expected | {'error'})
        o.require(command['argv'] == ['/usr/bin/id', '-A'] and not command['timed_out']
                  and not command['truncated'] and (command['waited'] or command.get('error')),
                  'id-A command incomplete')


def bindings():
    return {name: {'bytes': (STEP / name).stat().st_size,
                   'sha256': hashlib.sha256((STEP / name).read_bytes()).hexdigest()} for name in FILES}


def metadata(command):
    return {key: value for key, value in command.items() if key not in ('stdout_hex', 'stderr_hex')} | {
        name + '_bytes': len(bytes.fromhex(command[name + '_hex'])) for name in ('stdout', 'stderr')} | {
        name + '_sha256': hashlib.sha256(bytes.fromhex(command[name + '_hex'])).hexdigest()
        for name in ('stdout', 'stderr')}


def clean_complete(command, *, expected=0):
    o.require(command['waited'] and not command['timed_out'] and not command['truncated']
              and command['rc'] == expected, 'child status or channel is incomplete')


def execute(report_path, job_id):
    o.require(os.getuid() == os.geteuid() > 0 and os.environ.get('CI') == 'true'
              and os.environ.get('GITHUB_ACTIONS') == 'true', 'probe requires fresh unprivileged CI runner')
    o.require('SUDO_ASKPASS' not in os.environ, 'askpass is not permitted')
    runner = os.getuid()
    canary = os.environ.get('OPENCLAW_IDENTITY_CANARY', '')
    o.require(24 <= len(canary) <= 128, 'real CI canary is missing')
    parent = pathlib.Path(os.environ['RUNNER_TEMP']).resolve()
    o.require(report_path.parent.resolve() == parent and report_path.name == 'ci-audit-identity.json'
              and not report_path.exists(), 'report must be a fresh RUNNER_TEMP file')
    for name in ('GITHUB_RUN_ID', 'GITHUB_RUN_ATTEMPT'):
        o.require(re.fullmatch('[1-9][0-9]*', os.environ.get(name, '')) is not None, 'CI numeric context missing')
    tested = os.environ.get('GITHUB_SHA', '')
    o.require(re.fullmatch('[0-9a-f]{40}', tested) is not None, 'CI tested SHA missing')
    event_raw, error = o.read_bytes(os.environ['GITHUB_EVENT_PATH'], 1048576)
    o.require(error is None, 'CI event context unavailable')
    event = json.loads(event_raw)
    head = event.get('pull_request', {}).get('head', {}).get('sha', tested)
    o.require(re.fullmatch('[0-9a-f]{40}', head) is not None, 'CI source head missing')
    before = bindings()
    result = {'schema': 'openclaw-ci-audit-identity-report-v1', 'completed': False,
              'scope': 'dated hosted CI observations only; no host/runtime/identity/session approval',
              'run': int(os.environ['GITHUB_RUN_ID']), 'attempt': int(os.environ['GITHUB_RUN_ATTEMPT']),
              'job_id': job_id, 'job_name': os.environ['OPENCLAW_IDENTITY_JOB_NAME'],
              'source_head': head, 'tested_checkout': tested, 'started_unix_s': time.time(),
              'runner_reported': {key: os.environ.get(key) for key in ('ImageOS', 'ImageVersion', 'RUNNER_OS', 'RUNNER_ARCH')},
              'source_bindings': before, 'contexts': [], 'workers': [], 'argument_negatives': [],
              'failure': None, 'cleanup': 'no persistent fixture; only the one RUNNER_TEMP report',
              'limitations': ['CI runtime/compiler/dependency substrate is assumed, not authenticated here',
                              'runtime path/realpath are not kernel executable or dispatcher-absence proof',
                              'no audit identity is written; no protected login/session is characterized',
                              'auid and sudo metadata agreement is consistency, never authentication',
                              'existing anchor and post-sudo CI-env fallback are unchanged CI-only assumptions',
                              'no descendant absence or cleanup is inferred from runner teardown']}
    observer = str(STEP / 'ci_audit_identity_observer.py')
    python = sys.executable
    try:
        for context in ('plain', 'sudo'):
            payload = [python, '-I', '-S', '-B', observer, '--ci-audit-observe', o.UUID, context]
            argv = payload if context == 'plain' else ['/usr/bin/env', '-i',
                    'PATH=/usr/bin:/bin:/usr/sbin:/sbin', 'LC_ALL=C', '/usr/bin/sudo', '-n', *payload]
            command = o.child(argv, env=dict(os.environ) if context == 'plain' else {}, timeout=25, limit=65536)
            result['workers'].append(metadata(command))
            clean_complete(command)
            o.require(not command['stderr_hex'], 'observer stderr is not empty')
            raw = bytes.fromhex(command['stdout_hex'])
            value = json.loads(raw)
            check_observation(value, context, runner)
            o.require(canonical(value) == raw, 'observer output is not canonical')
            result['contexts'].append(value)
        for tail in (['--wrong', o.UUID, 'plain'], ['--ci-audit-observe', 'wrong', 'plain'],
                     ['--ci-audit-observe', o.UUID, 'plain', 'extra']):
            command = o.child([python, '-I', '-S', '-B', observer, *tail], timeout=8)
            clean_complete(command, expected=1)
            o.require(not command['stdout_hex'] and bytes.fromhex(command['stderr_hex'])
                      == b'observer requires the exact CI-only shape\n', 'argument refusal differs')
            result['argument_negatives'].append(metadata(command))
        version = o.child(['/usr/bin/sudo', '-V'])
        clean_complete(version)
        result['sudo_version'] = {'command': metadata(version),
            'first_line_hex': bytes.fromhex(version['stdout_hex']).splitlines()[0].hex()}
        if sys.platform == 'darwin':
            release = o.child(['/usr/bin/sw_vers'])
            clean_complete(release)
            result['os_release'] = release
        else:
            raw, error = o.read_bytes('/etc/os-release', 8192)
            o.require(error is None, 'OS release context unavailable')
            result['os_release'] = {'path': '/etc/os-release', 'raw_hex': raw.hex(), 'bound': 8192}
        o.require(bindings() == before, 'source changed during observations')
        result['completed'] = True
    except Exception as error:
        result['failure'] = {'type': type(error).__name__,
                             'reason': str(error) if isinstance(error, o.IntegrityError) else 'probe integrity failure'}
    result['ended_unix_s'] = time.time()
    encoded = canonical(result)
    if canary.encode() in encoded or canary.encode().hex().encode() in encoded:
        result = {'schema': result['schema'], 'completed': False, 'failure': 'canary value reached candidate report'}
        encoded = canonical(result)
    o.require(len(encoded) <= 262144, 'canonical report exceeds bound')
    fd = os.open(report_path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, 'wb') as target:
        target.write(encoded)
    print(encoded.decode(), end='')
    print('CI_AUDIT_REPORT_SHA256=' + hashlib.sha256(encoded).hexdigest())
    return 0 if result['completed'] else 1


def main():
    o.require(len(sys.argv) == 5 and sys.argv[1:3] == ['--ci-audit-probe', o.UUID]
              and re.fullmatch('[1-9][0-9]*', sys.argv[4]) is not None, 'probe requires exact CI shape')
    return execute(pathlib.Path(sys.argv[3]), int(sys.argv[4]))


if __name__ == '__main__':
    try:
        raise SystemExit(main())
    except o.IntegrityError as error:
        raise SystemExit(str(error))
