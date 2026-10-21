import ast
import hashlib
import json
import os
import pathlib
import re
import selectors
import signal
import stat
import subprocess
import sys
import time

AUDIT = 'memory-plan/plans/node-state-recovery/audits/step12_jetstream'
FILES = ('ci_saved_credential_abi.c', 'ci_saved_credential_observer.c',
    'probe_ci_saved_credential.py', 'test_ci_saved_credential.py')
REPOSITORY = 'moltyguibros-design/openclaw-node'
BRANCH = 'codex/stopped-vm-recovery'
UUID = '00000000-0000-0000-0000-000000000003'
GIT = '/opt/homebrew/bin/git'
CLEAN = {'PATH': '/usr/bin:/bin:/usr/sbin:/sbin', 'LC_ALL': 'C'}
REGISTRATION_PATH = AUDIT + '/ci_saved_credential_execution_registration.json'
P0 = {'commit': 'c9bc9ed86b8df0004821c171a9b74add739833a5',
    'path': AUDIT + '/CI_SAVED_CREDENTIAL_PREREGISTRATION_20261020.txt',
    'bytes': 36456, 'sha256': 'd55f1a2d1cd9a38579269fb1a61f6a95010e0335a954b389dc4f45421953efbc'}
WORKFLOW = {'commit': '66c1a116141f0694a7e55475f7e99d61db0e60e8',
    'path': '.github/workflows/test.yml', 'bytes': 49066,
    'sha256': '31b25cb486fa780908a9410b83e34dd83c1326c1423b737674f492315b9e0ab9'}
FIELD_LAYOUT = {'pbi_pid': (12, 4), 'pbi_ppid': (16, 4), 'pbi_uid': (20, 4),
    'pbi_gid': (24, 4), 'pbi_ruid': (28, 4), 'pbi_rgid': (32, 4),
    'pbi_svuid': (36, 4), 'pbi_svgid': (40, 4),
    'pbi_start_tvsec': (120, 8), 'pbi_start_tvusec': (128, 8)}
LAYOUT = {'alignment': 8, 'architecture': 'arm64', 'char_bit': 8, 'endian': 'little',
    'fields': {k: {'offset': v[0], 'width': v[1]} for k, v in FIELD_LAYOUT.items()},
    'flavor': 3, 'maxcomlen': 16, 'signature': 'int(int,int,uint64_t,void*,int)', 'size': 136,
    'types': {k: {'bytes': size, 'signed': signed} for k, size, signed in
    [('gid', 4, False), ('int', 4, True), ('pid', 4, True),
    ('pointer', 8, None), ('u64', 8, False), ('uid', 4, False)]}}
SDK_INPUTS = {'sdk-settings.json': ('SDKSettings.json', 65536),
    'sdk-libproc.h': ('usr/include/libproc.h', 262144),
    'sdk-proc_info.h': ('usr/include/sys/proc_info.h', 262144),
    'sdk-param.h': ('usr/include/sys/param.h', 262144),
    'sdk-types.h': ('usr/include/sys/types.h', 262144)}
BINARIES = ('abi-witness', 'saved-observer')
ARTIFACTS = ('report.json', 'progress.jsonl') + BINARIES + tuple(SDK_INPUTS)
PAYLOAD_ARTIFACTS = BINARIES + tuple(SDK_INPUTS)
TOOLS = {'git': GIT, 'xcrun': '/usr/bin/xcrun', 'compiler': None,
    'uname': '/usr/bin/uname', 'sw_vers': '/usr/bin/sw_vers', 'otool': '/usr/bin/otool',
    'env': '/usr/bin/env', 'sudo': '/usr/bin/sudo', 'curl': '/usr/bin/curl', 'python': '/usr/bin/python3'}
LABELS = ('git-head', 'git-tree', 'git-status', 'head-api', 'sdk-path', 'compiler-path',
    'compiler-version', 'uname-s', 'uname-m', 'uname-r', 'uname-v', 'sw-product', 'sw-build',
    'build-abi', 'build-observer', 'inspect-abi', 'inspect-observer', 'abi-witness',
    'refusal-missing', 'refusal-extra', 'refusal-context', 'native-plain', 'native-sudo')
LIMITS = {'workers': 26, 'metadata_requests': 2, 'global_seconds': 150,
    'metadata_seconds': 5, 'compile_seconds': 30, 'witness_seconds': 3,
    'observer_seconds': 8, 'reap_seconds': 2, 'step_seconds': 180,
    'metadata_channel': 16384, 'api_channel': 65536, 'compile_channel': 32768,
    'witness_channel': 4096, 'observer_channel': 8192, 'refusal_channel': 256,
    'sdk_settings': 65536, 'sdk_header': 262144, 'sdk_aggregate': 1114112,
    'binary': 8388608, 'binary_aggregate': 16777216, 'report': 262144,
    'progress': 524288, 'progress_records': 128, 'artifact': 20971520,
    'source_file': 65536, 'source_aggregate': 262144, 'event': 1048576,
    'registration': 16384, 'path_components': 16, 'symlinks': 16,
    'raw_aggregate': 49152, 'file_metadata_aggregate': 32768, 'argv_aggregate': 16384,
    'json_depth': 16, 'json_nodes': 16384, 'job_selection_transport': 262144,
    'job_selection_count': 100}
DRIFT_NAMES = tuple('source:' + name for name in FILES) + ('p0', 'workflow', 'sdk') + tuple(
    'tool:' + name for name in TOOLS) + tuple(SDK_INPUTS) + BINARIES


class Refusal(Exception):
    def __init__(self, stage, kind, detail, worker_index=None):
        self.record = {'stage': stage, 'kind': kind, 'detail': detail, 'worker_index': worker_index}
        super().__init__(kind)


def require(condition, stage, kind, detail=None):
    if not condition:
        raise Refusal(stage, kind, detail or stage + ": " + kind)


def canonical(value):
    return (json.dumps(value, ensure_ascii=True, allow_nan=False, sort_keys=True,
        separators=(',', ':')) + '\n').encode('ascii')


def digest(data):
    return hashlib.sha256(data).hexdigest()


def integer(low, high):
    return ('int', low, high)


def string(maximum, pattern=None):
    return ('str', maximum, pattern)


def literal(value):
    return ('literal', value)


def nullable(spec):
    return ('null', spec)


def array(spec, maximum, minimum=0):
    return ('array', spec, maximum, minimum)


BOOL = ('bool',)
U32 = integer(0, 4294967295)
U64 = integer(0, 18446744073709551615)
NS = integer(0, 9223372036854775807)
PID = integer(1, 2147483647)
SHA = string(40, r'[0-9a-f]{40}')
HASH = string(64, r'[0-9a-f]{64}')
PATH = string(4096, r'[^\x00-\x1f\x7f]+')
TEXT = string(4096, r'[^\x00-\x1f\x7f]*')
INDEX = integer(0, 25)
BINDING = {'bytes': integer(1, 65536), 'sha256': HASH}
SELECTED_FILE = {'commit': SHA, 'path': PATH, 'bytes': integer(1, 1048576), 'sha256': HASH}
REG_SCHEMA = {'schema': literal('openclaw-ci-saved-execution-registration-v1'),
    'p0': SELECTED_FILE, 'p1': {'commit': SHA, 'files': {name: BINDING for name in FILES}},
    'source_review': {'reference': string(4096, r'[^\x00-\x1f\x7f]+'), 'approved_commit': SHA},
    'workflow_baseline': SELECTED_FILE}
STAT_SCHEMA = {'bytes': NS, 'dev': U64, 'ino': U64, 'mode': integer(0, 65535),
    'uid': U32, 'gid': U32, 'mtime_ns': NS, 'ctime_ns': NS}
FILE_SCHEMA = {'path': PATH, 'realpath': PATH, 'kind': ('enum', ('file', 'directory')),
    'stat': STAT_SCHEMA, 'sha256': nullable(HASH),
    'symlinks': array({'path': PATH, 'target': PATH}, 16)}
LAYOUT_SCHEMA = {'alignment': integer(1, 4096), 'architecture': TEXT, 'char_bit': integer(1, 64),
    'endian': ('enum', ('little', 'big')), 'flavor': integer(0, 2147483647),
    'fields': {name: {'offset': integer(0, 1048576), 'width': integer(1, 128)} for name in FIELD_LAYOUT},
    'maxcomlen': integer(0, 4096), 'signature': TEXT, 'size': integer(1, 1048576),
    'types': {name: {'bytes': integer(1, 128), 'signed': nullable(BOOL)} for name in LAYOUT['types']}}
GETTERS = {name: U32 for name in ('uid', 'euid', 'gid', 'egid')}
SUDO_VALUE = {'raw_hex': nullable(string(64, r'(?:[0-9a-f]{2}){0,32}')),
    'tag': ('enum', ('absent', 'canonical-decimal', 'noncanonical', 'sentinel')),
    'number': nullable(U32)}
NATIVE_SCHEMA = {'rc': integer(-2147483648, 2147483647), 'errno': integer(0, 2147483647),
    'status': ('enum', ('exact-success', 'api-failure', 'length-mismatch', 'errno-mismatch')),
    'raw_hex': nullable(string(272, r'[0-9a-f]{272}')),
    'fields': nullable({name: U32 if width == 4 else U64 for name, (_, width) in FIELD_LAYOUT.items()})}
HELPER_SCHEMA = {'schema': literal('openclaw-ci-saved-self-v1'), 'context': ('enum', ('plain', 'sudo')),
    'pid_before': PID, 'pid_after': PID, 'ppid_before': integer(0, 2147483647),
    'ppid_after': integer(0, 2147483647), 'getters_before': GETTERS, 'getters_after': GETTERS,
    'sudo_uid': SUDO_VALUE, 'layout': LAYOUT_SCHEMA, 'native': NATIVE_SCHEMA,
    'clocks': {name: NS for name in ('monotonic_ns_before', 'monotonic_ns_after',
    'wallclock_ns_before', 'wallclock_ns_after')}}
ABI_SCHEMA = {'schema': literal('openclaw-ci-saved-abi-v1'), 'layout': LAYOUT_SCHEMA}
CHANNEL_SCHEMA = {'raw_hex': nullable(string(131072, r'(?:[0-9a-f]{2})*')), 'sha256': nullable(HASH),
    'captured_bytes': integer(0, 65536), 'observed_bytes': NS,
    'limit': integer(0, 65536), 'eof': BOOL, 'complete': BOOL, 'exceeded': BOOL, 'redacted': BOOL}
WORKER_SCHEMA = {'index': INDEX, 'label': ('enum', LABELS), 'argv': array(PATH, 24, 1),
    'environment': ('enum', ('clean', 'toolchain')), 'stdin': ('enum', ('none', 'api-auth-unrecorded')),
    'privileged_wrapper': BOOL, 'started_ns': NS, 'ended_ns': NS, 'elapsed_ns': NS,
    'pid': nullable(PID), 'rc': nullable(integer(-2147483648, 2147483647)),
    'timeout_seconds': integer(1, 30), 'timed_out': BOOL, 'term_sent': BOOL, 'kill_sent': BOOL,
    'budget_ns': integer(1, 30000000000), 'capture_error': nullable(string(64)),
    'term_attempted': BOOL, 'kill_attempted': BOOL,
    'waited': BOOL, 'eof': BOOL, 'stdin_complete': BOOL,
    'state': ('enum', ('reaped', 'unknown', 'not-started')),
    'stdout': CHANNEL_SCHEMA, 'stderr': CHANNEL_SCHEMA}
EVENT_SCHEMA = {'event_name': literal('pull_request'), 'repository': literal(REPOSITORY),
    'number': literal(224), 'head_sha': SHA, 'head_branch': literal(BRANCH),
    'base_sha': SHA, 'base_branch': literal('main'), 'tested_checkout_sha': SHA,
    'event_bytes': integer(1, 1048576), 'event_sha256': HASH}
TREE_SCHEMA = {'event_head_sha': SHA, 'tested_checkout_sha': SHA, 'local_tree_sha': nullable(SHA),
    'api_commit_sha': nullable(SHA), 'api_tree_sha': nullable(SHA), 'api_worker_index': nullable(INDEX),
    'worktree_worker_index': nullable(INDEX), 'worktree_clean': BOOL, 'equal': BOOL,
    'started_ns': NS, 'ended_ns': NS}
CI_SCHEMA = {'repository': literal(REPOSITORY), 'run_id': integer(1, 9223372036854775807), 'run_attempt': integer(1, 9223372036854775807), 'job_id': integer(1, 9223372036854775807),
    'job_name': literal('macos-process-census'), 'event_name': literal('pull_request'),
    'head_sha': SHA, 'tested_checkout_sha': SHA,
    'job_selection': literal('declared-outer-bounded-primary-api-selection'),
    'runner_os': string(256), 'runner_arch': string(256), 'image_os': string(256), 'image_version': string(256)}
PLATFORM_SCHEMA = {'system': nullable(TEXT), 'machine': nullable(TEXT), 'release': nullable(TEXT),
    'version': nullable(TEXT), 'product_version': nullable(TEXT), 'build_version': nullable(TEXT),
    'classification': literal('declared-darwin-arm64-little-endian-candidate')}
SOURCE_SCHEMA = {'files': {name: nullable(FILE_SCHEMA) for name in FILES}, 'p0': nullable(FILE_SCHEMA),
    'workflow': nullable(FILE_SCHEMA), 'event': nullable(EVENT_SCHEMA),
    'workflow_projection': nullable({'bytes': integer(1, 1048576), 'sha256': HASH, 'matched': BOOL}),
    'prestart_tree_binding': nullable(TREE_SCHEMA),
    'ancestry': literal('external-reviewed-P2-promotion-obligation-not-checked-in-shallow-CI'),
    'git_assumption': literal('fixed-Homebrew-git-and-system-config-unverified-no-fallback'),
    'ignored_files': literal('status-excludes-ignored-files-no-physical-exclusion-proof')}
BUILD_SCHEMA = {'tools': {name: nullable(FILE_SCHEMA) for name in TOOLS}, 'sdk': nullable(FILE_SCHEMA),
    'sdk_inputs': {name: nullable(FILE_SCHEMA) for name in SDK_INPUTS},
    'binaries': {name: nullable(FILE_SCHEMA) for name in BINARIES},
    'discovery': {name: nullable(INDEX) for name in ('sdk', 'compiler', 'compiler_version')},
    'inspection': {name: nullable(INDEX) for name in BINARIES},
    'drift': array({'name': ('enum', DRIFT_NAMES), 'after': FILE_SCHEMA, 'unchanged': BOOL}, 32),
    'artifact': array({'name': ('enum', PAYLOAD_ARTIFACTS), 'bytes': NS, 'sha256': HASH}, 7)}
WITNESS_SCHEMA = {'worker_index': INDEX, 'observation': ABI_SCHEMA, 'matches_candidate': BOOL}
CONTEXT_SCHEMA = {'name': ('enum', ('plain', 'sudo')), 'worker_index': INDEX,
    'observation': nullable(HELPER_SCHEMA), 'failure_stage': nullable(string(64))}
REFUSAL_SCHEMA = {'case': ('enum', ('missing', 'extra', 'context')), 'worker_index': INDEX,
    'expected_rc': literal(64), 'passed': BOOL}
OUTCOME_SCHEMA = {'measurement_complete': BOOL, 'abi_candidate_observed': BOOL,
    'credential_relations': {name: ('enum', ('runner-triples-equal', 'root-triples-zero',
    'unsupported-or-mismatch')) for name in ('plain', 'sudo')},
    'eligible_native_positive': literal('not-tested'),
    'claim': literal('dated-self-credential-observation-only')}
FAILURE_SCHEMA = {'stage': string(64, r'[a-z0-9-]+'), 'kind': string(64, r'[a-z0-9-]+'),
    'worker_index': nullable(INDEX), 'detail': string(1024, r'[^\x00-\x1f\x7f]*')}
REG_REPORT_SCHEMA = {'input': {'path': literal(REGISTRATION_PATH), 'bytes': nullable(integer(1, 16384)),
    'sha256': nullable(HASH)}, 'selected': nullable(REG_SCHEMA),
    'execution': nullable({'head_sha': SHA, 'tested_checkout_sha': SHA,
    'workflow': {'path': literal('.github/workflows/test.yml'),
    'bytes': integer(1, 1048576), 'sha256': HASH}})}
REPORT_SCHEMA = {'schema': literal('openclaw-ci-saved-credential-report-v1'),
    'registration': REG_REPORT_SCHEMA, 'source': SOURCE_SCHEMA, 'ci': nullable(CI_SCHEMA),
    'platform': PLATFORM_SCHEMA, 'build': BUILD_SCHEMA, 'witness': nullable(WITNESS_SCHEMA),
    'contexts': array(nullable(CONTEXT_SCHEMA), 2, 2),
    'argument_refusals': array(nullable(REFUSAL_SCHEMA), 3, 3), 'workers': array(WORKER_SCHEMA, 26),
    'outcome': OUTCOME_SCHEMA, 'failure': nullable(FAILURE_SCHEMA),
    'limits': {key: literal(value) for key, value in LIMITS.items()}}
PROGRESS_DATA = {'start': nullable(CI_SCHEMA), 'registration': REG_REPORT_SCHEMA, 'source': SOURCE_SCHEMA,
    'prestart': TREE_SCHEMA, 'build': BUILD_SCHEMA, 'worker': WORKER_SCHEMA,
    'witness': WITNESS_SCHEMA, 'context': CONTEXT_SCHEMA, 'argument': REFUSAL_SCHEMA,
    'failure': FAILURE_SCHEMA, 'outcome': OUTCOME_SCHEMA}


def shape(value, spec, stage='schema', depth=0, nodes=None):
    nodes = [0] if nodes is None else nodes
    nodes[0] += 1
    require(depth <= 16 and nodes[0] <= 16384, stage, 'json-bound')
    if isinstance(spec, dict):
        require(type(value) is dict and set(value) == set(spec), stage, 'keys')
        for key, child in spec.items():
            shape(value[key], child, stage, depth + 1, nodes)
        return
    tag = spec[0]
    if tag == 'null' and value is None:
        return
    if tag == 'null':
        shape(value, spec[1], stage, depth + 1, nodes)
    elif tag == 'literal':
        require(type(value) is type(spec[1]) and value == spec[1], stage, 'literal')
    elif tag == 'bool':
        require(type(value) is bool, stage, 'type')
    elif tag == 'int':
        require(type(value) is int and spec[1] <= value <= spec[2], stage, 'integer')
    elif tag == 'str':
        require(type(value) is str and value.isascii() and len(value.encode('ascii')) <= spec[1],
            stage, 'string')
        require(spec[2] is None or re.fullmatch(spec[2], value) is not None, stage, 'syntax')
    elif tag == 'enum':
        require(type(value) is str and value in spec[1], stage, 'enum')
    elif tag == 'array':
        require(type(value) is list and spec[3] <= len(value) <= spec[2], stage, 'array')
        for child in value:
            shape(child, spec[1], stage, depth + 1, nodes)
    else:
        raise AssertionError('unknown-source-schema-tag')


def decode(data, spec, maximum, stage):
    require(type(data) is bytes and 0 < len(data) <= maximum and data.isascii(),
        stage, 'json-bound')
    def pairs(items):
        result = {}
        for key, value in items:
            require(key not in result, stage, 'duplicate')
            result[key] = value
        return result
    def reject_constant(_):
        raise Refusal(stage, 'json-number', 'Nonfinite JSON number')
    try:
        value = json.loads(data, object_pairs_hook=pairs, parse_constant=reject_constant)
    except (ValueError, UnicodeError, RecursionError):
        raise Refusal(stage, 'json-syntax', 'Malformed JSON')
    require(canonical(value) == data, stage, 'canonical')
    shape(value, spec, stage)
    return value


def inert(data, maximum, stage):
    require(type(data) is bytes and 0 < len(data) <= maximum, stage, 'json-bound')
    def pairs(items):
        result = {}
        for key, value in items:
            require(key not in result, stage, 'duplicate')
            result[key] = value
        return result
    try:
        value = json.loads(data, object_pairs_hook=pairs,
            parse_constant=lambda _: (_ for _ in ()).throw(ValueError()))
    except (ValueError, UnicodeError, RecursionError):
        raise Refusal(stage, 'json-syntax', 'Malformed provider JSON')
    count = [0]
    def walk(item, depth):
        count[0] += 1
        require(depth <= 16 and count[0] <= 16384, stage, 'json-bound')
        if type(item) is dict:
            for key, child in item.items():
                require(type(key) is str and len(key) <= 4096, stage, 'json-bound')
                walk(child, depth + 1)
        elif type(item) is list:
            for child in item:
                walk(child, depth + 1)
        elif type(item) is str:
            require(len(item.encode('utf-8')) <= maximum, stage, 'json-bound')
        else:
            require(item is None or type(item) in (bool, int), stage, 'json-type')
    walk(value, 0)
    return value


def check_registration(value):
    shape(value, REG_SCHEMA, 'source-registration')
    require(value['p0'] == P0 and value['workflow_baseline'] == WORKFLOW,
        'source-registration', 'selected-baseline')
    require(value['source_review']['approved_commit'] == value['p1']['commit'],
        'source-registration', 'review-binding')
    require(sum(item['bytes'] for item in value['p1']['files'].values()) <= 262144,
        'source-registration', 'aggregate')


def sudo_value(raw):
    if raw is None:
        return {'raw_hex': None, 'tag': 'absent', 'number': None}
    require(type(raw) is bytes and len(raw) <= 32, 'helper', 'sudo-bound')
    number = int(raw) if re.fullmatch(rb'0|[1-9][0-9]{0,9}', raw) else None
    if number is not None and number > 4294967295:
        number = None
    tag = 'noncanonical' if number is None else 'sentinel' if number == 4294967295 else 'canonical-decimal'
    return {'raw_hex': raw.hex(), 'tag': tag, 'number': number}


def normalize_helper(payload, context):
    shape(payload, HELPER_SCHEMA, 'helper')
    require(payload['context'] == context, 'helper', 'context')
    require(payload['layout'] == LAYOUT, 'helper', 'layout')
    require(payload['pid_before'] == payload['pid_after'] and payload['ppid_before'] == payload['ppid_after'],
        'helper', 'self-drift')
    require(payload['getters_before'] == payload['getters_after'], 'helper', 'getter-drift')
    clocks = payload['clocks']
    for prefix in ('monotonic_ns', 'wallclock_ns'):
        require(0 <= clocks[prefix + '_after'] - clocks[prefix + '_before'] <= 8000000000,
            'helper', 'clock')
    raw_sudo = None if payload['sudo_uid']['raw_hex'] is None else bytes.fromhex(payload['sudo_uid']['raw_hex'])
    require(sudo_value(raw_sudo) == payload['sudo_uid'], 'helper', 'sudo-normalization')
    native = payload['native']
    rc, error = native['rc'], native['errno']
    status = 'api-failure' if rc <= 0 else 'length-mismatch' if rc != 136 else 'errno-mismatch' if error != 0 else 'exact-success'
    require(native['status'] == status, 'helper', 'native-status')
    if status != 'exact-success':
        require(native['raw_hex'] is None and native['fields'] is None,
            'helper', 'failed-buffer')
        return None
    require(native['raw_hex'] is not None and native['fields'] is not None,
        'helper', 'successful-buffer')
    raw = bytes.fromhex(native['raw_hex'])
    require(len(raw) == 136, 'helper', 'raw-length')
    fields = {name: int.from_bytes(raw[offset:offset + width], 'little')
        for name, (offset, width) in FIELD_LAYOUT.items()}
    require(fields == native['fields'], 'helper', 'raw-fields')
    require(fields['pbi_pid'] == payload['pid_before'] and fields['pbi_ppid'] == payload['ppid_before'],
        'helper', 'self-pid')
    getters = payload['getters_before']
    require((fields['pbi_ruid'], fields['pbi_uid'], fields['pbi_rgid'], fields['pbi_gid']) ==
        (getters['uid'], getters['euid'], getters['gid'], getters['egid']),
        'helper', 'getter-mapping')
    return fields


def check_plain(plain):
    left = normalize_helper(plain, 'plain')
    require(left is not None, 'credential-relations', 'native-unavailable')
    uid, gid = plain['getters_before']['uid'], plain['getters_before']['gid']
    saved_plain = (left['pbi_svuid'], left['pbi_svgid'])
    require(0 < uid < 4294967295 and gid < 4294967295 and
        (left['pbi_ruid'], left['pbi_uid'], saved_plain[0]) == (uid, uid, uid) and
        (left['pbi_rgid'], left['pbi_gid'], saved_plain[1]) == (gid, gid, gid),
        'credential-relations', 'runner-mismatch')
    require(plain['sudo_uid']['tag'] == 'absent', 'credential-relations', 'plain-metadata')
    return uid


def relations(plain, sudo):
    uid = check_plain(plain)
    right = normalize_helper(sudo, 'sudo')
    require(right is not None, 'credential-relations', 'native-unavailable')
    require(all(right[name] == 0 for name in ('pbi_ruid', 'pbi_uid', 'pbi_svuid', 'pbi_rgid', 'pbi_gid', 'pbi_svgid')),
        'credential-relations', 'sudo-mismatch')
    require(plain['sudo_uid']['tag'] == 'absent' and sudo['sudo_uid']['tag'] == 'canonical-decimal' and
        sudo['sudo_uid']['number'] == uid,
        'credential-relations', 'sudo-metadata')
    return {'plain': 'runner-triples-equal', 'sudo': 'root-triples-zero'}


def check_channel(value):
    shape(value, CHANNEL_SCHEMA, 'worker')
    if value['redacted']:
        require(value['raw_hex'] is None and value['sha256'] is None and value['captured_bytes'] == 0 and not value['complete'],
            'worker', 'redaction')
        return
    require(value['raw_hex'] is not None and value['sha256'] is not None,
        'worker', 'channel-data')
    raw = bytes.fromhex(value['raw_hex'])
    require(len(raw) == value['captured_bytes'] <= value['limit'] and digest(raw) == value['sha256'] and
        value['observed_bytes'] >= len(raw), 'worker', 'channel-binding')
    require(value['complete'] == (value['eof'] and not value['exceeded']),
        'worker', 'channel-complete')
    require(not value['exceeded'] or value['observed_bytes'] > value['limit'],
        'worker', 'channel-exceeded')


def worker_complete(value, expected_rc):
    shape(value, WORKER_SCHEMA, 'worker')
    check_channel(value['stdout'])
    check_channel(value['stderr'])
    require(value['pid'] is not None and value['state'] == 'reaped' and value['waited'] and
        value['eof'] and value['stdin_complete'] and value['capture_error'] is None and not value['timed_out'] and
        not value['term_attempted'] and not value['kill_attempted'] and value['rc'] == expected_rc and
        all(value[key]['complete'] and not value[key]['redacted'] and not value[key]['exceeded']
        for key in ('stdout', 'stderr')),
        'worker', 'incomplete')


def output(worker, channel='stdout'):
    value = worker[channel]
    require(value['raw_hex'] is not None, 'worker', 'redacted')
    return bytes.fromhex(value['raw_hex'])


def check_progress(value):
    require(type(value) is dict and value.get('kind') in PROGRESS_DATA,
        'progress', 'kind')
    spec = {'schema': literal('openclaw-ci-saved-progress-v1'), 'index': integer(0, 127),
        'kind': ('enum', tuple(PROGRESS_DATA)), 'monotonic_ns': NS,
        'worker_index': nullable(INDEX), 'data': PROGRESS_DATA[value['kind']]}
    shape(value, spec, 'progress')
    require(len(canonical(value)) <= 524288, 'progress', 'size')


def validate_report(value):
    shape(value, REPORT_SCHEMA, 'report')
    require(len(canonical(value)) <= 262144, 'report', 'size')
    require(len(value['workers']) <= len(LABELS), 'report', 'worker-order')
    raw_count = argv_count = 0
    for index, worker in enumerate(value['workers']):
        require(worker['index'] == index and worker['label'] == LABELS[index], 'report', 'worker-order')
        require(worker['ended_ns'] >= worker['started_ns'] and
            worker['elapsed_ns'] == worker['ended_ns'] - worker['started_ns'],
            'report', 'worker-time')
        require(worker['waited'] == (worker['rc'] is not None) and
            worker['state'] == ('not-started' if worker['pid'] is None else 'reaped' if worker['waited'] else 'unknown') and
            (worker['pid'] is not None or worker['rc'] is None) and
            worker['eof'] == all(worker[k]['eof'] for k in ('stdout', 'stderr')) and
            worker['privileged_wrapper'] == (index == 22) and
            worker['environment'] == ('toolchain' if index in (4, 5, 6, 13, 14) else 'clean') and
            worker['stdin'] == ('api-auth-unrecorded' if index == 3 else 'none') and
            worker['budget_ns'] <= worker['timeout_seconds'] * 1000000000 and
            (not worker['term_sent'] or worker['term_attempted']) and
            (not worker['kill_sent'] or worker['kill_attempted']) and
            (not worker['privileged_wrapper'] or not (worker['term_attempted'] or worker['kill_attempted'])),
            'report', 'worker-state')
        for key in ('stdout', 'stderr'):
            check_channel(worker[key])
            raw_count += worker[key]['captured_bytes']
        argv_count += len(canonical(worker['argv']))
    require(raw_count <= 49152 and argv_count <= 16384, 'report', 'aggregate')
    completed = value['outcome']['measurement_complete']
    require((value['failure'] is None) == completed, 'report', 'failure-state')
    require(not value['outcome']['abi_candidate_observed'] or completed,
        'report', 'abi-state')
    if not completed:
        return
    require(len(value['workers']) == 23 and value['ci'] is not None,
        'report', 'completeness')
    selected = value['registration']['selected']
    require(selected is not None and value['registration']['execution'] is not None,
        'report', 'registration')
    check_registration(selected)
    require(all(value['source']['files'][name] is not None and
        value['source']['files'][name]['stat']['bytes'] == selected['p1']['files'][name]['bytes'] and
        value['source']['files'][name]['sha256'] == selected['p1']['files'][name]['sha256'] for name in FILES),
        'report', 'source-binding')
    binding = value['source']['prestart_tree_binding']
    require(binding is not None and binding['equal'] and binding['worktree_clean'] and
        binding['event_head_sha'] == binding['api_commit_sha'] and
        binding['local_tree_sha'] == binding['api_tree_sha'] and
        binding['tested_checkout_sha'] == value['ci']['tested_checkout_sha'] and
        binding['ended_ns'] <= value['workers'][4]['started_ns'],
        'report', 'prestart-tree-binding')
    for index, worker in enumerate(value['workers']):
        worker_complete(worker, 64 if 18 <= index <= 20 else 0)
    witness = value['witness']
    require(witness is not None and witness['matches_candidate'] and witness['observation']['layout'] == LAYOUT and
        witness['worker_index'] == 17 and output(value['workers'][17]) == canonical(witness['observation']),
        'report', 'witness')
    for index, name in enumerate(('plain', 'sudo')):
        context = value['contexts'][index]
        require(context is not None and context['name'] == name and context['observation'] is not None and
            context['worker_index'] == 21 + index and context['failure_stage'] is None and
            output(value['workers'][21 + index]) == canonical(context['observation']),
            'report', 'context')
    expected = relations(value['contexts'][0]['observation'], value['contexts'][1]['observation'])
    require(value['outcome']['credential_relations'] == expected and value['outcome']['abi_candidate_observed'],
        'report', 'relations')
    require(all(item is not None and item['passed'] and item['worker_index'] == 18 + i
        for i, item in enumerate(value['argument_refusals'])),
        'report', 'argument-refusals')
    require(value['build']['drift'] and all(item['unchanged'] for item in value['build']['drift']),
        'report', 'drift')
    before = {'source:' + name: item for name, item in value['source']['files'].items()}
    before.update({name: value['source'][name] for name in ('p0', 'workflow')})
    before['sdk'] = value['build']['sdk']
    before.update({'tool:' + name: item for name, item in value['build']['tools'].items()})
    before.update(value['build']['sdk_inputs'])
    before.update(value['build']['binaries'])
    require(set(before) == set(DRIFT_NAMES) and all(item is not None for item in before.values()) and
        len(value['build']['drift']) == len(DRIFT_NAMES) and
        {item['name'] for item in value['build']['drift']} == set(DRIFT_NAMES) and
        all(item['after'] == before[item['name']] for item in value['build']['drift']),
        'report', 'drift-set')
    require(value['source']['p0']['sha256'] == P0['sha256'] and
        value['source']['p0']['stat']['bytes'] == P0['bytes'],
        'report', 'p0-binding')
    projection = value['source']['workflow_projection']
    require(projection is not None and projection['matched'] and projection['bytes'] == WORKFLOW['bytes'] and
        projection['sha256'] == WORKFLOW['sha256'], 'report', 'workflow-projection')
    require(all(item is not None for item in value['platform'].values()),
        'report', 'platform')
    artifacts = value['build']['artifact']
    require(len(artifacts) == 7 and {item['name'] for item in artifacts} == set(PAYLOAD_ARTIFACTS) and
        sum(item['bytes'] for item in artifacts) + 262144 + 524288 <= 20971520,
        'report', 'artifact-set')
    require(all(item['bytes'] == before[item['name']]['stat']['bytes'] and
        item['sha256'] == before[item['name']]['sha256'] for item in artifacts), 'report', 'artifact-binding')


def capture_worker(ops, index, label, argv, timeout, budget_ns, cap, environment, privileged, secret, raw_budget):
    start = ops.started_ns
    buffers = {'stdout': bytearray(), 'stderr': bytearray()}
    observed = {key: 0 for key in buffers}
    eof = {key: False for key in buffers}
    excess = {key: False for key in buffers}
    redacted = {key: False for key in buffers}
    bounds = {key: min(cap, raw_budget) for key in buffers}
    left = raw_budget
    abort_at = None
    timed_out = term_sent = kill_sent = term_attempted = kill_attempted = False
    rc = None
    while ops.pid is not None:
        now = ops.now()
        if abort_at is None and now >= start + budget_ns:
            timed_out = True
            abort_at = now
        if abort_at is None and (ops.error is not None or any(excess.values()) or any(redacted.values())):
            abort_at = now
        if abort_at is not None:
            if not privileged and not term_attempted:
                term_attempted = True
                term_sent = ops.send('TERM')
            if not privileged and not kill_attempted and now - abort_at >= 1000000000:
                kill_attempted = True
                kill_sent = ops.send('KILL')
            if now - abort_at >= 2000000000:
                break
        remaining = (start + budget_ns if abort_at is None else abort_at + 2000000000) - now
        for channel, chunk in ops.events(min(20000000, max(0, remaining)) / 1000000000):
            if chunk is None:
                eof[channel] = True
                continue
            observed[channel] += len(chunk)
            if redacted[channel] or excess[channel]:
                continue
            take = min(len(chunk), bounds[channel] - len(buffers[channel]), left)
            buffers[channel].extend(chunk[:take])
            left -= take
            if take < len(chunk):
                bounds[channel] = len(buffers[channel])
                excess[channel] = True
            if secret and (secret in buffers[channel] or (excess[channel] and any(
                buffers[channel].endswith(secret[:n]) for n in range(1, len(secret))))):
                redacted[channel] = True
                buffers[channel].clear()
        rc = ops.poll()
        if all(eof.values()) and rc is not None:
            break
    end = ops.now()
    timed_out = timed_out or end - start > budget_ns
    input_done = ops.input_done
    pid = ops.pid
    error = ops.error
    ops.close()
    channels = {}
    for channel, buf in buffers.items():
        raw = bytes(buf)
        channels[channel] = {'raw_hex': None if redacted[channel] else raw.hex(),
            'sha256': None if redacted[channel] else digest(raw),
            'captured_bytes': len(raw), 'observed_bytes': observed[channel],
            'limit': bounds[channel], 'eof': eof[channel],
            'complete': eof[channel] and not excess[channel] and not redacted[channel],
            'exceeded': excess[channel], 'redacted': redacted[channel]}
    return {'index': index, 'label': label, 'argv': list(argv), 'environment': environment,
        'stdin': 'api-auth-unrecorded' if label == 'head-api' else 'none',
        'privileged_wrapper': privileged, 'started_ns': start, 'ended_ns': end,
        'elapsed_ns': end - start, 'pid': pid, 'rc': rc, 'timeout_seconds': timeout,
        'budget_ns': budget_ns, 'timed_out': timed_out, 'term_sent': term_sent, 'kill_sent': kill_sent,
        'term_attempted': term_attempted, 'kill_attempted': kill_attempted,
        'waited': rc is not None, 'eof': all(eof.values()), 'stdin_complete': input_done,
        'state': 'not-started' if pid is None else 'reaped' if rc is not None else 'unknown', 'capture_error': error,
        'stdout': channels['stdout'], 'stderr': channels['stderr']}


class ProcessOperations:
    def __init__(self, argv, env, input_bytes):
        self.started_ns = time.monotonic_ns()
        self.error = None
        self.input_bytes = input_bytes
        self.input_offset = 0
        self.input_done = not input_bytes
        self.selector = self.proc = self.pid = None
        try:
            self.selector = selectors.DefaultSelector()
            self.proc = subprocess.Popen(argv, stdin=subprocess.PIPE if input_bytes else subprocess.DEVNULL,
                stdout=subprocess.PIPE, stderr=subprocess.PIPE, cwd='/', env=env,
                start_new_session=True, close_fds=True)
            self.pid = self.proc.pid
            for name in ('stdout', 'stderr'):
                pipe = getattr(self.proc, name)
                os.set_blocking(pipe.fileno(), False)
                self.selector.register(pipe, selectors.EVENT_READ, name)
            if input_bytes:
                os.set_blocking(self.proc.stdin.fileno(), False)
                self.selector.register(self.proc.stdin, selectors.EVENT_WRITE, 'stdin')
        except OSError as error:
            self.error = 'bounded-start-' + str(error.errno or 0)

    def now(self):
        return time.monotonic_ns()

    def events(self, wait):
        result = []
        try:
            ready = self.selector.select(wait) if self.selector is not None else []
        except OSError as error:
            self.error = 'bounded-select-' + str(error.errno or 0)
            ready = []
        for key, _ in ready:
            pipe, name = key.fileobj, key.data
            try:
                if name == 'stdin':
                    self.input_offset += os.write(pipe.fileno(), self.input_bytes[self.input_offset:])
                    if self.input_offset == len(self.input_bytes):
                        self.input_done = True
                        self.selector.unregister(pipe)
                        pipe.close()
                        self.input_bytes = b''
                else:
                    data = os.read(pipe.fileno(), 4096)
                    result.append((name, data if data else None))
                    if not data:
                        self.selector.unregister(pipe)
                        pipe.close()
            except BlockingIOError:
                continue
            except OSError as error:
                self.error = 'bounded-io-' + str(error.errno or 0)
                self.selector.unregister(pipe)
                pipe.close()
        return result

    def poll(self):
        try:
            return self.proc.poll() if self.proc is not None else None
        except OSError as error:
            self.error = 'bounded-poll-' + str(error.errno or 0)
            return None

    def send(self, name):
        try:
            os.killpg(self.pid, signal.SIGTERM if name == 'TERM' else signal.SIGKILL)
            return True
        except ProcessLookupError:
            return False
        except OSError as error:
            self.error = 'bounded-signal-' + str(error.errno or 0)
            return False

    def close(self):
        self.input_bytes = b''
        for name in ('stdin', 'stdout', 'stderr'):
            pipe = getattr(self.proc, name) if self.proc is not None else None
            if pipe is not None and not pipe.closed:
                pipe.close()
        if self.selector is not None:
            self.selector.close()


def stat_record(info):
    return {'bytes': info.st_size, 'dev': info.st_dev, 'ino': info.st_ino, 'mode': info.st_mode,
        'uid': info.st_uid, 'gid': info.st_gid, 'mtime_ns': info.st_mtime_ns, 'ctime_ns': info.st_ctime_ns}


def resolve_path(path):
    shape(path, PATH, 'filesystem')
    require(path.startswith('/') and '\\' not in path, 'filesystem', 'path')
    pending = list(pathlib.PurePosixPath(path).parts[1:])
    require(len(pending) <= 16, 'filesystem', 'components')
    resolved, links = [], []
    while pending:
        part = pending.pop(0)
        if part in ('', '.'):
            continue
        if part == '..':
            require(bool(resolved), 'filesystem', 'path')
            resolved.pop()
            continue
        candidate = '/' + '/'.join(resolved + [part])
        info = os.lstat(candidate)
        if stat.S_ISLNK(info.st_mode):
            require(len(links) < 16, 'filesystem', 'symlinks')
            target = os.readlink(candidate)
            shape(target, PATH, 'filesystem')
            links.append({'path': candidate, 'target': target})
            if target.startswith('/'):
                resolved = []
            pending = list(pathlib.PurePosixPath(target).parts[1:] if target.startswith('/') else
                pathlib.PurePosixPath(target).parts) + pending
            require(len(resolved) + len(pending) <= 16, 'filesystem', 'components')
        else:
            resolved.append(part)
            require(not pending or stat.S_ISDIR(info.st_mode), 'filesystem', 'ancestor')
    return '/' + '/'.join(resolved), links


class RealBackend:
    def __init__(self, root, work, environment, uid):
        self.root, self.work, self.environment, self.uid = root, work, environment, uid
        self.deadline = self.now() + 150000000000
        self.progress_size = self.progress_count = self.metadata_size = self.argv_size = self.raw_size = 0
        token = environment.get('GH_TOKEN', '')
        require(type(token) is str and re.fullmatch(r'[A-Za-z0-9_]{1,512}', token) is not None,
            'ci', 'token')
        self.secret = token.encode('ascii')

    def now(self):
        return time.monotonic_ns()

    def budget(self):
        require(self.now() < self.deadline, 'budget', 'global-timeout')

    def make_work(self):
        self.budget()
        parent, _ = resolve_path(self.environment['RUNNER_TEMP'])
        require(pathlib.PurePosixPath(self.work).parent == pathlib.PurePosixPath(parent),
            'work', 'parent')
        os.mkdir(self.work, 0o700)
        info = os.lstat(self.work)
        require(stat.S_ISDIR(info.st_mode) and stat.S_IMODE(info.st_mode) == 0o700 and info.st_uid == self.uid,
            'work', 'mode')
        os.mkdir(self.work + '/compiler-tmp', 0o700)
        self.progress_fd = os.open(self.work + '/progress.jsonl', os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)

    def observe(self, path, maximum=None):
        self.budget()
        real, links = resolve_path(path)
        info = os.stat(real, follow_symlinks=False)
        kind = 'directory' if stat.S_ISDIR(info.st_mode) else 'file'
        require(stat.S_ISDIR(info.st_mode) or stat.S_ISREG(info.st_mode),
            'filesystem', 'kind')
        data = None
        if maximum is not None:
            require(kind == 'file' and info.st_size <= maximum, 'filesystem', 'size')
            fd = os.open(real, os.O_RDONLY | os.O_NONBLOCK | os.O_NOFOLLOW)
            try:
                held = os.fstat(fd)
                require(stat_record(held) == stat_record(info), 'filesystem', 'changed')
                data = bytearray()
                while len(data) <= maximum:
                    chunk = os.read(fd, min(65536, maximum + 1 - len(data)))
                    if not chunk:
                        break
                    data.extend(chunk)
                require(len(data) == info.st_size <= maximum and stat_record(os.fstat(fd)) == stat_record(info),
                    'filesystem', 'changed')
            finally:
                os.close(fd)
            data = bytes(data)
        record = {'path': path, 'realpath': real, 'kind': kind, 'stat': stat_record(info),
            'sha256': None if data is None else digest(data), 'symlinks': links}
        shape(record, FILE_SCHEMA, 'filesystem')
        self.metadata_size += len(canonical(record))
        require(self.metadata_size <= 32768, 'budget', 'metadata')
        self.budget()
        return data, record

    def write(self, name, data):
        require(name in ARTIFACTS and type(data) is bytes, 'artifact', 'name')
        if name in ('report.json', 'progress.jsonl'):
            require(not self.secret or self.secret not in data, 'artifact', 'secret-output')
        fd = os.open(self.work + '/' + name, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
        try:
            position = 0
            while position < len(data):
                position += os.write(fd, data[position:])
        finally:
            os.close(fd)

    def progress(self, record):
        check_progress(record)
        data = canonical(record)
        require(self.secret not in data and self.progress_count < 128 and self.progress_size + len(data) <= 524288,
            'progress', 'bound-or-secret')
        position = 0
        while position < len(data):
            position += os.write(self.progress_fd, data[position:])
        self.progress_count += 1
        self.progress_size += len(data)

    def start(self, index, label, argv, timeout, cap, environment='clean', privileged=False, auth=False):
        self.budget()
        shape(list(argv), array(PATH, 24, 1), 'worker')
        self.argv_size += len(canonical(list(argv)))
        require(index < 26 and self.argv_size <= 16384, 'budget', 'workers-or-argv')
        budget_ns = min(timeout * 1000000000, self.deadline - self.now() - 2000000000)
        require(budget_ns > 0, 'budget', 'global-timeout')
        env = dict(CLEAN)
        if environment == 'toolchain':
            env['TMPDIR'] = self.work + '/compiler-tmp'
        input_bytes = b''
        if auth:
            input_bytes = (b'header = "Authorization: Bearer ' + self.secret + b'"\n'
                b'header = "Accept: application/vnd.github+json"\n'
                b'header = "X-GitHub-Api-Version: 2022-11-28"\n')
        ops = ProcessOperations(argv, env, input_bytes)
        record = capture_worker(ops, index, label, argv, timeout, budget_ns, cap, environment,
            privileged, self.secret, 49152 - self.raw_size)
        self.raw_size += record['stdout']['captured_bytes'] + record['stderr']['captured_bytes']
        return record

    def close(self):
        if hasattr(self, 'progress_fd'):
            os.close(self.progress_fd)


def new_report():
    return {'schema': 'openclaw-ci-saved-credential-report-v1',
        'registration': {'input': {'path': REGISTRATION_PATH, 'bytes': None, 'sha256': None},
        'selected': None, 'execution': None},
        'source': {'files': dict.fromkeys(FILES), 'p0': None, 'workflow': None, 'event': None,
        'workflow_projection': None, 'prestart_tree_binding': None,
        'ancestry': 'external-reviewed-P2-promotion-obligation-not-checked-in-shallow-CI',
        'git_assumption': 'fixed-Homebrew-git-and-system-config-unverified-no-fallback',
        'ignored_files': 'status-excludes-ignored-files-no-physical-exclusion-proof'},
        'ci': None, 'platform': dict.fromkeys(('system', 'machine', 'release', 'version', 'product_version', 'build_version')) |
        {'classification': 'declared-darwin-arm64-little-endian-candidate'},
        'build': {'tools': dict.fromkeys(TOOLS), 'sdk': None, 'sdk_inputs': dict.fromkeys(SDK_INPUTS),
        'binaries': dict.fromkeys(BINARIES), 'discovery': dict.fromkeys(('sdk', 'compiler', 'compiler_version')),
        'inspection': dict.fromkeys(BINARIES), 'drift': [], 'artifact': []},
        'witness': None, 'contexts': [None, None], 'argument_refusals': [None, None, None], 'workers': [],
        'outcome': {'measurement_complete': False, 'abi_candidate_observed': False,
        'credential_relations': {'plain': 'unsupported-or-mismatch', 'sudo': 'unsupported-or-mismatch'},
        'eligible_native_positive': 'not-tested', 'claim': 'dated-self-credential-observation-only'},
        'failure': None, 'limits': dict(LIMITS)}


def positive(value, stage):
    require(type(value) is str and re.fullmatch(r'[1-9][0-9]{0,18}', value) is not None and
        int(value) <= 9223372036854775807, stage, 'decimal')
    return int(value)


def parse_cli(argv):
    require(len(argv) == 7 and argv[1:3] == ['--ci-saved-probe', UUID] and argv[5] == REGISTRATION_PATH,
        'arguments', 'shape')
    shape(argv[3], PATH, 'arguments')
    require(argv[3].startswith('/') and str(pathlib.PurePosixPath(argv[3])) == argv[3] and
        '..' not in pathlib.PurePosixPath(argv[3]).parts, 'arguments', 'work-path')
    shape(argv[6], HASH, 'arguments')
    return {'work': argv[3], 'job_id': positive(argv[4], 'arguments'), 'registration_sha256': argv[6]}


def event_facts(raw, env, job_id):
    event = inert(raw, 1048576, 'prestart-tree-binding')
    try:
        pr = event['pull_request']
        head, base = pr['head'], pr['base']
        require(env['CI'] == 'true' and env['GITHUB_ACTIONS'] == 'true' and
            env['GITHUB_EVENT_NAME'] == 'pull_request' and env['GITHUB_REPOSITORY'] == REPOSITORY and
            env['GITHUB_JOB'] == 'macos-process-census' and
            event['repository']['full_name'] == REPOSITORY and type(pr['number']) is int and pr['number'] == 224 and
            head['repo']['full_name'] == REPOSITORY and base['repo']['full_name'] == REPOSITORY and
            head['ref'] == BRANCH and base['ref'] == 'main',
            'prestart-tree-binding', 'event')
        for value in (head['sha'], base['sha'], env['GITHUB_SHA']):
            shape(value, SHA, 'prestart-tree-binding')
        ci = {'repository': REPOSITORY, 'run_id': positive(env['GITHUB_RUN_ID'], 'ci'),
            'run_attempt': positive(env['GITHUB_RUN_ATTEMPT'], 'ci'), 'job_id': job_id,
            'job_name': 'macos-process-census', 'event_name': 'pull_request', 'head_sha': head['sha'],
            'tested_checkout_sha': env['GITHUB_SHA'], 'job_selection': 'declared-outer-bounded-primary-api-selection',
            'runner_os': env['RUNNER_OS'], 'runner_arch': env['RUNNER_ARCH'],
            'image_os': env['ImageOS'], 'image_version': env['ImageVersion']}
        shape(ci, CI_SCHEMA, 'ci')
        require(ci['runner_os'] == 'macOS' and ci['runner_arch'] == 'ARM64', 'ci', 'platform')
        facts = {'event_name': 'pull_request', 'repository': REPOSITORY, 'number': 224,
            'head_sha': head['sha'], 'head_branch': BRANCH, 'base_sha': base['sha'], 'base_branch': 'main',
            'tested_checkout_sha': env['GITHUB_SHA'], 'event_bytes': len(raw), 'event_sha256': digest(raw)}
        return ci, facts
    except (KeyError, TypeError):
        raise Refusal('prestart-tree-binding', 'event', 'Required provider event facts missing')


def one_line(worker):
    data = output(worker)
    require(data.endswith(b'\n') and data.count(b'\n') == 1 and data[:-1].isascii() and b'\r' not in data,
        'metadata', 'line')
    return data[:-1].decode('ascii')


def run_measurement(b, params):
    report = new_report()
    phase, work_ready, sequence = 'work', False, [0]
    before = {}
    def emit(kind, data, worker=None):
        value = {'schema': 'openclaw-ci-saved-progress-v1', 'index': sequence[0], 'kind': kind,
            'monotonic_ns': b.now(), 'worker_index': worker, 'data': data}
        b.progress(value)
        sequence[0] += 1
    def observe(name, path, maximum=None):
        data, record = b.observe(path, maximum)
        before[name] = record
        return data, record
    def complete(worker, rc):
        try:
            worker_complete(worker, rc)
        except Refusal as error:
            error.record.update(stage=phase, worker_index=worker['index'])
            raise
    def take(label, argv, seconds=5, cap=16384, environment='clean', privileged=False, auth=False, checked=True):
        index = len(report['workers'])
        require(index < len(LABELS) and label == LABELS[index], phase, 'worker-order')
        worker = b.start(index, label, argv, seconds, cap, environment, privileged, auth)
        report['workers'].append(worker)
        emit('worker', worker, index)
        try:
            b.budget()
            if checked:
                worker_complete(worker, 0)
                require(output(worker, 'stderr') == b'', phase, 'stderr')
        except Refusal as failure:
            failure.record.update(stage=phase, worker_index=index)
            raise
        return worker
    try:
        b.make_work()
        work_ready = True
        emit('start', None)
        phase = 'prestart-tree-binding'
        event_raw, _ = b.observe(b.environment['GITHUB_EVENT_PATH'], 1048576)
        ci, event = event_facts(event_raw, b.environment, params['job_id'])
        report['ci'], report['source']['event'] = ci, event
        phase = 'source-registration'
        raw, _ = b.observe(b.root + '/' + REGISTRATION_PATH, 16384)
        report['registration']['input'].update(bytes=len(raw), sha256=digest(raw))
        require(digest(raw) == params['registration_sha256'], phase, 'registration-digest')
        selected = decode(raw, REG_SCHEMA, 16384, phase)
        check_registration(selected)
        report['registration']['selected'] = selected
        emit('registration', report['registration'])
        total = 0
        test_source = None
        for name in FILES:
            data, item = observe('source:' + name, b.root + '/' + AUDIT + '/' + name, 65536)
            report['source']['files'][name] = item
            total += len(data)
            if name == FILES[3]:
                test_source = data
            require({'bytes': len(data), 'sha256': digest(data)} == selected['p1']['files'][name],
                phase, 'source-binding')
        require(total <= 262144, phase, 'source-bound')
        data, report['source']['p0'] = observe('p0', b.root + '/' + P0['path'], P0['bytes'])
        require(len(data) == P0['bytes'] and digest(data) == P0['sha256'], phase, 'p0-binding')
        raw_workflow, report['source']['workflow'] = observe('workflow', b.root + '/' + WORKFLOW['path'], 1048576)
        projected = project_workflow(raw_workflow, params['registration_sha256'], test_source)
        report['source']['workflow_projection'] = {'bytes': len(projected), 'sha256': digest(projected), 'matched': True}
        report['registration']['execution'] = {'head_sha': ci['head_sha'], 'tested_checkout_sha': ci['tested_checkout_sha'],
            'workflow': {'path': WORKFLOW['path'], 'bytes': len(raw_workflow), 'sha256': digest(raw_workflow)}}
        emit('source', report['source'])
        phase = 'prestart-tree-binding'
        _, report['build']['tools']['git'] = observe('tool:git', GIT)
        binding = {'event_head_sha': ci['head_sha'], 'tested_checkout_sha': ci['tested_checkout_sha'],
            'local_tree_sha': None, 'api_commit_sha': None, 'api_tree_sha': None,
            'api_worker_index': None, 'worktree_worker_index': None, 'worktree_clean': False,
            'equal': False, 'started_ns': b.now(), 'ended_ns': b.now()}
        report['source']['prestart_tree_binding'] = binding
        git = [GIT, '--no-optional-locks', '-c', 'core.fsmonitor=false', '-C', b.root]
        try:
            head = one_line(take('git-head', git + ['rev-parse', 'HEAD']))
            shape(head, SHA, phase)
            require(head == ci['tested_checkout_sha'], phase, 'checkout')
            tree = one_line(take('git-tree', git + ['rev-parse', 'HEAD^{tree}']))
            shape(tree, SHA, phase)
            binding['local_tree_sha'] = tree
            status = take('git-status', git + ['status', '--porcelain=v1', '--untracked-files=all'])
            binding['worktree_worker_index'] = status['index']
            binding['worktree_clean'] = output(status) == b''
            require(binding['worktree_clean'], phase, 'worktree')
            response = take('head-api', ['/usr/bin/curl', '--proto', '=https', '--fail', '--silent', '--show-error',
                '--max-time', '5', '--config', '-', 'https://api.github.com/repos/' + REPOSITORY + '/git/commits/' + ci['head_sha']],
                cap=65536, auth=True)
            binding['api_worker_index'] = response['index']
            data = inert(output(response), 65536, phase)
            require(type(data) is dict and type(data.get('tree')) is dict, phase, 'api-schema')
            shape(data.get('sha'), SHA, phase)
            shape(data['tree'].get('sha'), SHA, phase)
            binding.update(api_commit_sha=data['sha'], api_tree_sha=data['tree']['sha'])
            binding['equal'] = data['sha'] == ci['head_sha'] and data['tree']['sha'] == tree
            require(binding['equal'], phase, 'tree')
        finally:
            binding['ended_ns'] = b.now()
            emit('prestart', binding, binding['api_worker_index'])
        phase = 'toolchain'
        for name, path in TOOLS.items():
            if path is not None and name != 'git':
                _, report['build']['tools'][name] = observe('tool:' + name, path)
        sdk = one_line(take('sdk-path', ['/usr/bin/xcrun', '--sdk', 'macosx', '--show-sdk-path'], environment='toolchain'))
        cc = one_line(take('compiler-path', ['/usr/bin/xcrun', '--sdk', 'macosx', '--find', 'clang'], environment='toolchain'))
        for path in (sdk, cc):
            shape(path, PATH, phase)
            require(path.startswith('/') and str(pathlib.PurePosixPath(path)) == path and '..' not in pathlib.PurePosixPath(path).parts,
                phase, 'selected-path')
        _, report['build']['sdk'] = observe('sdk', sdk)
        _, report['build']['tools']['compiler'] = observe('tool:compiler', cc)
        require(report['build']['sdk']['kind'] == 'directory' and report['build']['tools']['compiler']['kind'] == 'file' and
            report['build']['tools']['compiler']['stat']['mode'] & 0o111, phase, 'toolchain-kind')
        report['build']['discovery'].update(sdk=4, compiler=5)
        take('compiler-version', [cc, '--version'], environment='toolchain')
        report['build']['discovery']['compiler_version'] = 6
        for label, key, argv in [('uname-s', 'system', ['/usr/bin/uname', '-s']),
            ('uname-m', 'machine', ['/usr/bin/uname', '-m']), ('uname-r', 'release', ['/usr/bin/uname', '-r']),
            ('uname-v', 'version', ['/usr/bin/uname', '-v']), ('sw-product', 'product_version', ['/usr/bin/sw_vers', '-productVersion']),
            ('sw-build', 'build_version', ['/usr/bin/sw_vers', '-buildVersion'])]:
            report['platform'][key] = one_line(take(label, argv))
        require(report['platform']['system'] == 'Darwin' and report['platform']['machine'] == 'arm64',
            phase, 'unsupported-platform')
        total = 0
        for name, (relative, maximum) in SDK_INPUTS.items():
            data, item = observe(name, sdk + '/' + relative, maximum)
            require(data, phase, 'sdk-empty')
            total += len(data)
            require(total <= 1114112, phase, 'sdk-bound')
            report['build']['sdk_inputs'][name] = item
            b.write(name, data)
        emit('build', report['build'])
        for label, source, binary in [('build-abi', FILES[0], BINARIES[0]), ('build-observer', FILES[1], BINARIES[1])]:
            take(label, [cc, '-std=c11', '-O0', '-Wall', '-Wextra', '-Werror', '-isysroot', sdk,
                b.root + '/' + AUDIT + '/' + source, '-o', b.work + '/' + binary, '-lproc'], 30, 32768, 'toolchain')
            _, item = observe(binary, b.work + '/' + binary, 8388608)
            require(item['stat']['bytes'] > 0 and item['stat']['mode'] & 0o111, phase, 'binary')
            report['build']['binaries'][binary] = item
            emit('build', report['build'])
        require(sum(item['stat']['bytes'] for item in report['build']['binaries'].values()) <= 16777216,
            phase, 'binary-aggregate')
        for label, binary in [('inspect-abi', BINARIES[0]), ('inspect-observer', BINARIES[1])]:
            worker = take(label, ['/usr/bin/otool', '-L', b.work + '/' + binary])
            report['build']['inspection'][binary] = worker['index']
        phase = 'abi-witness'
        worker = take('abi-witness', [b.work + '/abi-witness'], 3, 4096)
        witness = decode(output(worker), ABI_SCHEMA, 4096, phase)
        report['witness'] = {'worker_index': worker['index'], 'observation': witness, 'matches_candidate': witness['layout'] == LAYOUT}
        emit('witness', report['witness'], worker['index'])
        require(report['witness']['matches_candidate'], phase, 'candidate')
        phase = 'argument-refusals'
        for i, (case, arguments) in enumerate([('missing', []), ('extra', ['--ci-saved-self', UUID, 'plain', 'extra']),
            ('context', ['--ci-saved-self', UUID, 'invalid'])]):
            worker = take('refusal-' + case, [b.work + '/saved-observer'] + arguments, 8, 256, checked=False)
            item = {'case': case, 'worker_index': worker['index'], 'expected_rc': 64, 'passed': False}
            report['argument_refusals'][i] = item
            complete(worker, 64)
            require(output(worker) == b'' and output(worker, 'stderr') == b'ci-saved-self: invalid arguments\n',
                phase, 'argument-guard')
            item['passed'] = True
            emit('argument', item, worker['index'])
        for i, name in enumerate(('plain', 'sudo')):
            phase = 'native-' + name
            argv = [b.work + '/saved-observer', '--ci-saved-self', UUID, name]
            if name == 'sudo':
                argv = ['/usr/bin/env', '-i', 'PATH=' + CLEAN['PATH'], 'LC_ALL=C', '/usr/bin/sudo', '-n'] + argv
            worker = take('native-' + name, argv, 8, 8192, privileged=name == 'sudo', checked=False)
            context = {'name': name, 'worker_index': worker['index'], 'observation': None, 'failure_stage': phase}
            report['contexts'][i] = context
            complete(worker, worker['rc'])
            require(output(worker, 'stderr') == b'', phase, 'stderr')
            payload = decode(output(worker), HELPER_SCHEMA, 8192, phase)
            context['observation'] = payload
            normalize_helper(payload, name)
            require(worker['rc'] == 0 and payload['native']['status'] == 'exact-success', phase, 'unavailable')
            if name == 'plain':
                check_plain(payload)
            else:
                report['outcome']['credential_relations'] = relations(report['contexts'][0]['observation'], payload)
            context['failure_stage'] = None
            emit('context', context, worker['index'])
        phase = 'drift'
        for name in DRIFT_NAMES:
            original = before[name]
            maximum = original['stat']['bytes'] if original['sha256'] is not None else None
            _, after = b.observe(original['path'], maximum)
            item = {'name': name, 'after': after, 'unchanged': after == original}
            report['build']['drift'].append(item)
            require(item['unchanged'], phase, 'changed')
        total = 0
        for name in PAYLOAD_ARTIFACTS:
            data, _ = b.observe(b.work + '/' + name, 8388608 if name in BINARIES else SDK_INPUTS[name][1])
            total += len(data)
            report['build']['artifact'].append({'name': name, 'bytes': len(data), 'sha256': digest(data)})
        require(total + 262144 + 524288 <= 20971520, phase, 'artifact-bound')
        emit('build', report['build'])
        b.budget()
        report['outcome'].update(measurement_complete=True, abi_candidate_observed=True)
        validate_report(report)
        emit('outcome', report['outcome'])
    except (Refusal, OSError) as error:
        failure = error.record if isinstance(error, Refusal) else {
            'stage': phase, 'kind': 'filesystem-error', 'worker_index': None,
            'detail': 'Required bounded OS operation failed; errno=' + str(error.errno or 0)}
        if failure['stage'] == 'filesystem':
            failure['stage'] = phase
        report['outcome'].update(measurement_complete=False, abi_candidate_observed=False)
        report['failure'] = failure
        if work_ready:
            emit('failure', failure, failure['worker_index'])
    if work_ready:
        validate_report(report)
        b.write('report.json', canonical(report))
    return report


def workflow_steps(registration_sha, source):
    shape(registration_sha, HASH, 'source-registration')
    try:
        tree = ast.parse(source, feature_version=(3, 9))
        assignments = [node for node in tree.body if isinstance(node, ast.Assign) and len(node.targets) == 1 and
            isinstance(node.targets[0], ast.Name) and node.targets[0].id == 'P2_WORKFLOW_TEMPLATE']
        require(len(assignments) == 1 and isinstance(assignments[0].value, ast.Constant) and
            type(assignments[0].value.value) is str, 'source-registration', 'workflow-template')
        template = assignments[0].value.value.encode('ascii')
    except (SyntaxError, UnicodeError):
        raise Refusal('source-registration', 'workflow-template', 'Registered inert template invalid')
    require(len(template) <= 16384 and template.count(b'REGISTRATION_SHA256') == 1,
        'source-registration', 'workflow-template')
    return template.replace(b'REGISTRATION_SHA256', registration_sha.encode('ascii'))


def project_workflow(raw, registration_sha, source):
    steps = workflow_steps(registration_sha, source)
    anchor = (b'      - name: Retain record-only CI audit identity\n        if: always()\n'
        b'        uses: actions/upload-artifact@v4\n        with:\n'
        b'          name: ci-audit-identity-macos-${{ github.sha }}\n'
        b'          path: ${{ runner.temp }}/ci-audit-identity.json\n'
        b'          if-no-files-found: error\n')
    require(raw.count(steps) == 1 and raw.count(anchor) == 1 and raw.index(steps) == raw.index(anchor) + len(anchor),
        'prestart-tree-binding', 'workflow-location')
    baseline = raw.replace(steps, b'', 1)
    require(len(baseline) == WORKFLOW['bytes'] and digest(baseline) == WORKFLOW['sha256'],
        'prestart-tree-binding', 'workflow-baseline')
    return baseline


def print_report(report):
    wire = canonical(report)
    pieces = [wire[i:i + 4000] for i in range(0, len(wire), 4000)]
    for index, piece in enumerate(pieces):
        print('CI_SAVED_CREDENTIAL_REPORT_HEX ' + str(index + 1) + '/' + str(len(pieces)) + ' ' + piece.hex(), flush=True)
    print('CI_SAVED_CREDENTIAL_REPORT_SHA256 ' + digest(wire), flush=True)


def main():
    backend = None
    try:
        params = parse_cli(sys.argv)
        names = ('CI', 'GITHUB_ACTIONS', 'GITHUB_REPOSITORY', 'GITHUB_JOB', 'GITHUB_EVENT_NAME', 'GITHUB_RUN_ID',
            'GITHUB_RUN_ATTEMPT', 'GITHUB_SHA', 'GITHUB_EVENT_PATH', 'GITHUB_WORKSPACE', 'RUNNER_TEMP',
            'RUNNER_OS', 'RUNNER_ARCH', 'ImageOS', 'ImageVersion', 'GH_TOKEN')
        env = {name: os.environ[name] for name in names}
        require(env['CI'] == 'true' and env['GITHUB_ACTIONS'] == 'true' and sys.platform == 'darwin' and
            env['GITHUB_REPOSITORY'] == REPOSITORY and env['GITHUB_JOB'] == 'macos-process-census' and
            env['GITHUB_EVENT_NAME'] == 'pull_request' and env['RUNNER_ARCH'] == 'ARM64', 'ci', 'context')
        uid = os.getuid()
        require(os.uname().machine == 'arm64' and uid == os.geteuid() and uid != 0, 'ci', 'platform-or-user')
        root = env['GITHUB_WORKSPACE']
        shape(root, PATH, 'ci')
        require(root.startswith('/') and '..' not in pathlib.PurePosixPath(root).parts and
            os.path.abspath(__file__) == root + '/' + AUDIT + '/probe_ci_saved_credential.py', 'ci', 'source-path')
        backend = RealBackend(root, params['work'], env, uid)
        report = run_measurement(backend, params)
        validate_report(report)
        print_report(report)
        return 0 if report['outcome']['measurement_complete'] else 1
    except (Refusal, OSError, KeyError):
        sys.stderr.write('ci-saved-probe: refused or incomplete\n')
        return 1
    finally:
        if backend is not None:
            backend.close()


if __name__ == '__main__':
    sys.exit(main())
