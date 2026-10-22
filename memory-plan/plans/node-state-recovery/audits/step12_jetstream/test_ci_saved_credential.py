import ast
import contextlib
import copy
import importlib.util
import io
import json
import pathlib
import re
import tempfile
import unittest
from unittest import mock

P2_WORKFLOW_TEMPLATE = r'''      - name: Measure preregistered saved credentials
        timeout-minutes: 3
        env:
          GH_TOKEN: ${{ github.token }}
        run: |
          saved_job_id="$(/usr/bin/python3 -I -S -B - <<'PY_JOB'
          import json, os, re, signal, urllib.request
          def refuse(*args):
              raise TimeoutError()
          def pairs(items):
              result = {}
              for key, value in items:
                  if key in result: raise ValueError()
                  result[key] = value
              return result
          class NoRedirect(urllib.request.HTTPRedirectHandler):
              def redirect_request(self, *args): return None
          phase = 'preflight'
          try:
              env = os.environ
              if env['GITHUB_REPOSITORY'] != 'moltyguibros-design/openclaw-node' or env['GITHUB_JOB'] != 'macos-process-census' or env['GITHUB_EVENT_NAME'] != 'pull_request': raise ValueError()
              run, attempt = env['GITHUB_RUN_ID'], env['GITHUB_RUN_ATTEMPT']
              if any(re.fullmatch(r'[1-9][0-9]{0,18}', n) is None or int(n) > 9223372036854775807 for n in (run, attempt)): raise ValueError()
              with open(env['GITHUB_EVENT_PATH'], 'rb') as source: event_raw = source.read(1048577)
              if len(event_raw) > 1048576: raise ValueError()
              event = json.loads(event_raw, object_pairs_hook=pairs)
              head = event['pull_request']['head']['sha']
              if re.fullmatch(r'[0-9a-f]{40}', head) is None: raise ValueError()
              phase = 'token'
              token = env['GH_TOKEN']
              if re.fullmatch(r'[\x21-\x7e]{1,4096}', token) is None: raise ValueError()
              phase = 'request'
              request = urllib.request.Request('https://api.github.com/repos/moltyguibros-design/openclaw-node/actions/runs/' + run + '/jobs?filter=all&per_page=100', headers={'Authorization':'Bearer ' + token, 'Accept':'application/vnd.github+json', 'X-GitHub-Api-Version':'2022-11-28'})
              opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect)
              signal.signal(signal.SIGALRM, refuse)
              signal.setitimer(signal.ITIMER_REAL, 5)
              try:
                  with opener.open(request, timeout=5) as response:
                      phase = 'response'
                      raw = response.read(262145)
              finally:
                  signal.setitimer(signal.ITIMER_REAL, 0)
              if len(raw) > 262144: raise ValueError()
              value = json.loads(raw, object_pairs_hook=pairs)
              if type(value['total_count']) is not int or not 1 <= value['total_count'] <= 100 or type(value['jobs']) is not list or len(value['jobs']) != value['total_count']: raise ValueError()
              matches = [j for j in value['jobs'] if j['name'] == 'macos-process-census' and type(j['run_id']) is int and j['run_id'] == int(run) and type(j['run_attempt']) is int and j['run_attempt'] == int(attempt) and j['head_sha'] == head]
              if len(matches) != 1 or type(matches[0]['id']) is not int or not 0 < matches[0]['id'] <= 9223372036854775807: raise ValueError()
              print(matches[0]['id'])
          except Exception:
              raise SystemExit('saved-credential job selection unavailable: phase=' + phase) from None
          PY_JOB
          )"
          /usr/bin/python3 -I -S -B memory-plan/plans/node-state-recovery/audits/step12_jetstream/test_ci_saved_credential.py
          /usr/bin/python3 -I -S -B memory-plan/plans/node-state-recovery/audits/step12_jetstream/probe_ci_saved_credential.py --ci-saved-probe 00000000-0000-0000-0000-000000000003 "$RUNNER_TEMP/ci-saved-credential-$GITHUB_RUN_ID-$GITHUB_RUN_ATTEMPT" "$saved_job_id" memory-plan/plans/node-state-recovery/audits/step12_jetstream/ci_saved_credential_execution_registration.json REGISTRATION_SHA256
      - name: Retain saved credential measurement
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: saved-credential-macos-${{ github.sha }}
          path: |
            ${{ runner.temp }}/ci-saved-credential-${{ github.run_id }}-${{ github.run_attempt }}/report.json
            ${{ runner.temp }}/ci-saved-credential-${{ github.run_id }}-${{ github.run_attempt }}/progress.jsonl
            ${{ runner.temp }}/ci-saved-credential-${{ github.run_id }}-${{ github.run_attempt }}/abi-witness
            ${{ runner.temp }}/ci-saved-credential-${{ github.run_id }}-${{ github.run_attempt }}/saved-observer
            ${{ runner.temp }}/ci-saved-credential-${{ github.run_id }}-${{ github.run_attempt }}/sdk-settings.json
            ${{ runner.temp }}/ci-saved-credential-${{ github.run_id }}-${{ github.run_attempt }}/sdk-libproc.h
            ${{ runner.temp }}/ci-saved-credential-${{ github.run_id }}-${{ github.run_attempt }}/sdk-proc_info.h
            ${{ runner.temp }}/ci-saved-credential-${{ github.run_id }}-${{ github.run_attempt }}/sdk-param.h
            ${{ runner.temp }}/ci-saved-credential-${{ github.run_id }}-${{ github.run_attempt }}/sdk-types.h
          if-no-files-found: error
'''

STEP = pathlib.Path(__file__).parent
p = None
ROOT = STEP.parents[4]
INPUTS, P0_BYTES, WORKFLOW_BYTES = {}, b'', b''


def initialize():
    global p, INPUTS, P0_BYTES, WORKFLOW_BYTES
    spec = importlib.util.spec_from_file_location('saved_probe_under_test', STEP / 'probe_ci_saved_credential.py')
    p = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(p)
    INPUTS = {name: (STEP / name).read_bytes() for name in p.FILES}
    P0_BYTES = (ROOT / p.P0['path']).read_bytes()
    observed = (ROOT / p.WORKFLOW['path']).read_bytes()
    if len(observed) == p.WORKFLOW['bytes'] and p.digest(observed) == p.WORKFLOW['sha256']:
        WORKFLOW_BYTES = observed
    else:
        before, after = P2_WORKFLOW_TEMPLATE.encode('ascii').split(b'REGISTRATION_SHA256')
        matches = list(re.finditer(re.escape(before) + rb'([0-9a-f]{64})' + re.escape(after), observed))
        if len(matches) != 1:
            raise AssertionError('unexpected-control-error:workflow-input')
        WORKFLOW_BYTES = p.project_workflow(observed, matches[0].group(1).decode('ascii'), INPUTS[p.FILES[3]])


FIXED_FIELDS = {'pbi_pid': (12, 4), 'pbi_ppid': (16, 4), 'pbi_uid': (20, 4), 'pbi_gid': (24, 4),
                'pbi_ruid': (28, 4), 'pbi_rgid': (32, 4), 'pbi_svuid': (36, 4), 'pbi_svgid': (40, 4),
                'pbi_start_tvsec': (120, 8), 'pbi_start_tvusec': (128, 8)}
FIXED_LAYOUT = {'alignment': 8, 'architecture': 'arm64', 'char_bit': 8, 'endian': 'little',
                'fields': {k: {'offset': v[0], 'width': v[1]} for k, v in FIXED_FIELDS.items()},
                'flavor': 3, 'maxcomlen': 16, 'signature': 'int(int,int,uint64_t,void*,int)', 'size': 136,
                'types': {k: {'bytes': n, 'signed': signed} for k, n, signed in
                          [('gid', 4, False), ('int', 4, True), ('pid', 4, True),
                           ('pointer', 8, None), ('u64', 8, False), ('uid', 4, False)]}}
COUNTS = {'schema_controls': 0, 'protocol_controls': 0, 'capture_controls': 0,
          'guard_probes': 0, 'paired_baselines': 0, 'intended_mutant_kills': []}


def helper(context='plain', rc=136, error=0):
    uid, gid, pid = (1001, 1002, 800) if context == 'plain' else (0, 0, 900)
    getters = {'uid': uid, 'euid': uid, 'gid': gid, 'egid': gid}
    values = {'pbi_pid': pid, 'pbi_ppid': 700, 'pbi_uid': uid, 'pbi_gid': gid,
              'pbi_ruid': uid, 'pbi_rgid': gid, 'pbi_svuid': uid, 'pbi_svgid': gid,
              'pbi_start_tvsec': 1700000000, 'pbi_start_tvusec': 12345}
    raw = bytearray(136)
    for name, (offset, width) in FIXED_FIELDS.items():
        raw[offset:offset + width] = values[name].to_bytes(width, 'little')
    status = 'api-failure' if rc <= 0 else 'length-mismatch' if rc != 136 else 'errno-mismatch' if error else 'exact-success'
    return {'schema': 'openclaw-ci-saved-self-v1', 'context': context, 'pid_before': pid, 'pid_after': pid,
            'ppid_before': 700, 'ppid_after': 700, 'getters_before': getters, 'getters_after': dict(getters),
            'sudo_uid': {'raw_hex': None, 'number': None, 'tag': 'absent'} if context == 'plain' else
                        {'raw_hex': b'1001'.hex(), 'number': 1001, 'tag': 'canonical-decimal'},
            'layout': copy.deepcopy(FIXED_LAYOUT),
            'native': {'rc': rc, 'errno': error, 'status': status,
                       'raw_hex': bytes(raw).hex() if status == 'exact-success' else None,
                       'fields': values if status == 'exact-success' else None},
            'clocks': {'monotonic_ns_before': 1000, 'monotonic_ns_after': 2000,
                       'wallclock_ns_before': 1700000000000000000, 'wallclock_ns_after': 1700000000000001000}}


def change_field(value, name, number):
    result = copy.deepcopy(value)
    raw = bytearray.fromhex(result['native']['raw_hex'])
    offset, width = FIXED_FIELDS[name]
    raw[offset:offset + width] = number.to_bytes(width, 'little')
    result['native']['raw_hex'] = raw.hex()
    result['native']['fields'][name] = number
    return result


class Clock:
    def __init__(self):
        self.value, self.reads = 0, 0

    def now(self):
        self.reads += 1
        if self.reads > 4096:
            raise AssertionError('fake-queue-exhausted:clock')
        self.value += 1000000
        return self.value


class FakeOperations:
    def __init__(self, clock, stdout=b'', stderr=b'', rc=0, mode='normal', input_done=True):
        self.clock = clock
        self.started_ns = clock.now()
        self.pid, self.error = 600, None
        self.input_done = input_done
        self.frames = [[('stdout', stdout), ('stderr', stderr)], [('stdout', None), ('stderr', None)]]
        self.rc, self.mode = rc, mode
        self.reads, self.signals = 0, []
        self.closed = False

    def now(self):
        return self.clock.now()

    def events(self, wait):
        self.reads += 1
        if self.reads > 4096:
            raise AssertionError('fake-queue-exhausted:read')
        self.clock.value += int(wait * 1000000000)
        if self.mode == 'hang':
            return []
        if self.mode == 'missing-eof':
            return self.frames.pop(0) if len(self.frames) == 2 else []
        return self.frames.pop(0) if self.frames else []

    def poll(self):
        return None if self.mode == 'hang' else self.rc

    def send(self, name):
        self.signals.append(name)
        if name == 'KILL':
            self.mode, self.rc = 'normal', -9
            self.frames = [[('stdout', None), ('stderr', None)]]
        return True

    def close(self):
        self.closed = True


class FakeBackend:
    def __init__(self, module=None, fault=None, tripwire=None):
        module = p if module is None else module
        self.module, self.fault, self.tripwire = module, fault, tripwire
        self.root, self.work = '/ci/repo', '/ci/tmp/leaf'
        self.secret = b'synthetic_non_secret_token'
        self.clock = Clock()
        self.deadline = 150000000000
        self.environment = {'CI': 'true', 'GITHUB_ACTIONS': 'true', 'GITHUB_REPOSITORY': 'moltyguibros-design/openclaw-node',
            'GITHUB_JOB': 'macos-process-census', 'GITHUB_EVENT_NAME': 'pull_request',
            'GITHUB_RUN_ID': '39550906038', 'GITHUB_RUN_ATTEMPT': '1', 'GITHUB_SHA': '3' * 40,
            'GITHUB_EVENT_PATH': '/ci/event.json', 'RUNNER_TEMP': '/ci/tmp',
            'RUNNER_OS': 'macOS', 'RUNNER_ARCH': 'ARM64', 'ImageOS': 'synthetic-only', 'ImageVersion': 'synthetic-only'}
        self.event = {'repository': {'full_name': 'moltyguibros-design/openclaw-node'},
            'pull_request': {'number': 224, 'head': {'sha': '2' * 40, 'ref': 'codex/stopped-vm-recovery',
                 'repo': {'full_name': 'moltyguibros-design/openclaw-node'}},
                 'base': {'sha': '1' * 40, 'ref': 'main', 'repo': {'full_name': 'moltyguibros-design/openclaw-node'}}}}
        self.selected = {'schema': 'openclaw-ci-saved-execution-registration-v1', 'p0': dict(p.P0),
            'p1': {'commit': '1' * 40, 'files': {name: {'bytes': len(data), 'sha256': p.digest(data)} for name, data in INPUTS.items()}},
            'source_review': {'reference': 'synthetic-only independently modelled review', 'approved_commit': '1' * 40},
            'workflow_baseline': dict(p.WORKFLOW)}
        self.registration = p.canonical(self.selected)
        self.params = {'work': self.work, 'job_id': 119059630171, 'registration_sha256': p.digest(self.registration)}
        self.files = {self.root + '/' + p.AUDIT + '/' + name: data for name, data in INPUTS.items()}
        self.files[self.root + '/' + p.P0['path']] = P0_BYTES
        anchor = (b'          name: ci-audit-identity-macos-${{ github.sha }}\n'
                  b'          path: ${{ runner.temp }}/ci-audit-identity.json\n'
                  b'          if-no-files-found: error\n')
        self.files[self.root + '/' + p.WORKFLOW['path']] = WORKFLOW_BYTES.replace(anchor,
            anchor + p.workflow_steps(self.params['registration_sha256'], INPUTS[p.FILES[3]]), 1)
        self.files[self.root + '/' + p.REGISTRATION_PATH] = self.registration
        self.files['/ci/event.json'] = p.canonical(self.event)
        for name, (relative, _) in p.SDK_INPUTS.items():
            self.files['/sdk/' + relative] = ('synthetic-only ' + name).encode()
        self.outputs, self.progress_records, self.calls = {}, [], []
        self.raw_size = self.metadata_size = self.argv_size = 0
        self.ready, self.closed = False, False
        if fault:
            fault(self)

    def now(self):
        return self.clock.now()

    def budget(self):
        self.module.require(self.now() < self.deadline, 'budget', 'global-timeout')

    def make_work(self):
        self.ready = True

    def observe(self, path, maximum=None):
        data = self.files.get(path)
        if data is None and maximum is not None:
            raise self.module.Refusal('filesystem', 'missing', 'Synthetic input missing')
        if maximum is not None and len(data) > maximum:
            raise self.module.Refusal('filesystem', 'size', 'Synthetic bounded input exceeded')
        kind = 'directory' if path == '/sdk' else 'file'
        record = {'path': path, 'realpath': path, 'kind': kind,
                  'stat': {'bytes': len(data) if data is not None else 100, 'dev': 1, 'ino': 10,
                           'mode': 0o40700 if kind == 'directory' else 0o100700, 'uid': 1001, 'gid': 1002,
                           'mtime_ns': 100, 'ctime_ns': 100},
                  'sha256': p.digest(data) if maximum is not None else None, 'symlinks': []}
        self.metadata_size += len(p.canonical(record))
        self.module.require(self.metadata_size <= 32768, 'budget', 'metadata')
        return data if maximum is not None else None, record

    def write(self, name, data):
        if name in self.outputs:
            raise AssertionError('unexpected-control-error:exclusive-output')
        if self.secret in data:
            raise self.module.Refusal('artifact', 'secret-output', 'Synthetic secret suppressed')
        self.outputs[name] = data
        self.files[self.work + '/' + name] = data

    def progress(self, record):
        self.module.check_progress(record)
        if self.secret in p.canonical(record):
            raise AssertionError('unexpected-control-error:secret-progress')
        self.progress_records.append(copy.deepcopy(record))
        self.module.require(len(self.progress_records) <= 128 and
            sum(len(p.canonical(r)) for r in self.progress_records) <= 524288, 'progress', 'size')

    def start(self, index, label, argv, timeout, cap, environment='clean', privileged=False, auth=False):
        self.calls.append((label, list(argv)))
        if self.tripwire and ((self.tripwire[0] == 'toolchain' and index >= 4) or
                              (self.tripwire[0] == 'native' and index >= 18)):
            raise AssertionError(self.tripwire[1])
        outputs = {'git-head': b'3' * 40 + b'\n', 'git-tree': b'4' * 40 + b'\n', 'git-status': b'',
            'head-api': p.canonical({'sha': '2' * 40, 'tree': {'sha': '4' * 40}}),
            'sdk-path': b'/sdk\n', 'compiler-path': b'/tool/clang\n', 'compiler-version': b'synthetic compiler\n',
            'uname-s': b'Darwin\n', 'uname-m': b'arm64\n', 'uname-r': b'synthetic-release\n',
            'uname-v': b'synthetic-kernel\n', 'sw-product': b'26.0\n', 'sw-build': b'synthetic-build\n',
            'build-abi': b'', 'build-observer': b'', 'inspect-abi': b'synthetic dependencies\n',
            'inspect-observer': b'synthetic dependencies\n',
            'abi-witness': p.canonical({'schema': 'openclaw-ci-saved-abi-v1', 'layout': FIXED_LAYOUT}),
            'native-plain': p.canonical(helper()), 'native-sudo': p.canonical(helper('sudo'))}
        rc = 64 if label.startswith('refusal-') else 0
        stdout = outputs.get(label, b'')
        stderr = b'ci-saved-self: invalid arguments\n' if rc == 64 else b''
        mode = 'normal'
        if hasattr(self, 'worker_fault'):
            stdout, stderr, rc, mode = self.worker_fault(label, stdout, stderr, rc, mode)
        if label.startswith('build-') and rc == 0:
            self.files[self.work + '/' + ('abi-witness' if label == 'build-abi' else 'saved-observer')] = b'synthetic-only binary'
        self.argv_size += len(p.canonical(list(argv)))
        self.module.require(self.argv_size <= 16384, 'budget', 'argv')
        ops = FakeOperations(self.clock, stdout, stderr, rc, mode)
        record = self.module.capture_worker(ops, index, label, argv, timeout,
            min(timeout * 1000000000, self.deadline - self.now() - 2000000000),
            cap, environment, privileged, self.secret, 49152 - self.raw_size)
        self.raw_size += sum(record[key]['captured_bytes'] for key in ('stdout', 'stderr'))
        return record

    def close(self):
        self.closed = True


def expect_refusal(module, operation, stage=None, kind=None, tag='unexpected-control-accepted'):
    try:
        operation()
    except module.Refusal as error:
        if stage is not None and error.record['stage'] != stage:
            raise AssertionError('unexpected-control-stage:' + error.record['stage'])
        if kind is not None and error.record['kind'] != kind:
            raise AssertionError('unexpected-control-kind:' + error.record['kind'])
        return error.record
    raise AssertionError(tag)


def run_fake(module=None, fault=None, tripwire=None):
    backend = FakeBackend(module, fault, tripwire)
    report = backend.module.run_measurement(backend, backend.params)
    return backend, report


@contextlib.contextmanager
def fake_only(private):
    import builtins
    import socket
    original_open, original_os_open, original_mkdir = builtins.open, p.os.open, p.os.mkdir
    def writable(path):
        if isinstance(path, int):
            return
        value = pathlib.Path(path).resolve()
        if value != private and private not in value.parents:
            raise AssertionError('forbidden-real-write-outside-private-temp')
    def safe_open(path, mode='r', *args, **kwargs):
        if any(flag in mode for flag in 'wax+'):
            writable(path)
        return original_open(path, mode, *args, **kwargs)
    def safe_os_open(path, flags, *args, **kwargs):
        if flags & (p.os.O_WRONLY | p.os.O_RDWR | p.os.O_CREAT | p.os.O_TRUNC | p.os.O_APPEND):
            writable(path)
        return original_os_open(path, flags, *args, **kwargs)
    def safe_mkdir(path, *args, **kwargs):
        writable(path)
        return original_mkdir(path, *args, **kwargs)
    with contextlib.ExitStack() as stack:
        for owner, name in [(p.subprocess, 'Popen'), (socket, 'socket')] + [
                (p.os, name) for name in ('getuid', 'geteuid', 'getgid', 'getegid', 'getgroups', 'getpid', 'getppid',
                                         'uname', 'system', 'fork', 'execv', 'execve', 'posix_spawn') if hasattr(p.os, name)] + [
                (p.time, name) for name in ('monotonic', 'monotonic_ns', 'sleep')]:
            stack.enter_context(mock.patch.object(owner, name,
                side_effect=AssertionError('forbidden-real-call:' + name)))
        stack.enter_context(mock.patch('builtins.open', safe_open))
        stack.enter_context(mock.patch.object(io, 'open', safe_open))
        stack.enter_context(mock.patch.object(p.os, 'open', safe_os_open))
        stack.enter_context(mock.patch.object(p.os, 'mkdir', safe_mkdir))
        yield


class ProtocolTests(unittest.TestCase):
    def test_complete_synthetic_protocol_and_exact_order(self):
        backend, report = run_fake()
        self.assertTrue(report['outcome']['measurement_complete'], report['failure'])
        self.assertEqual([label for label, _ in backend.calls], list(p.LABELS))
        self.assertEqual(len(backend.calls), 23)
        self.assertEqual(report['outcome']['eligible_native_positive'], 'not-tested')
        self.assertEqual(p.decode(backend.outputs['report.json'], p.REPORT_SCHEMA, 262144, 'report'), report)
        p.validate_report(report)
        kinds = [r['kind'] for r in backend.progress_records]
        self.assertLess(kinds.index('prestart'), next(i for i, r in enumerate(backend.progress_records)
                         if r['kind'] == 'worker' and r['data']['label'] == 'sdk-path'))
        self.assertEqual(set(backend.outputs), set(p.SDK_INPUTS) | {'report.json'})
        self.assertEqual(len(report['build']['drift']), 24)
        COUNTS['protocol_controls'] += 1

    def test_prestart_mismatches_keep_no_toolchain(self):
        def event_fault(change):
            def apply(b):
                event = copy.deepcopy(b.event)
                change(event)
                b.files['/ci/event.json'] = p.canonical(event)
            return apply
        faults = [event_fault(lambda e: e['repository'].update(full_name='other/repo')),
                  event_fault(lambda e: e['pull_request'].update(number=225)),
                  event_fault(lambda e: e['pull_request']['head'].update(ref='unreviewed')),
                  event_fault(lambda e: e['pull_request']['head']['repo'].update(full_name='fork/repo')),
                  event_fault(lambda e: e['pull_request']['head'].update(sha='bad')),
                  lambda b: b.environment.update(GITHUB_EVENT_NAME='push'),
                  lambda b: b.environment.update(GITHUB_REPOSITORY='other/repo'),
                  lambda b: b.environment.update(GITHUB_SHA='bad')]
        for fault in faults:
            backend, report = run_fake(fault=fault)
            self.assertFalse(report['outcome']['measurement_complete'])
            self.assertEqual(report['failure']['stage'], 'prestart-tree-binding')
            self.assertFalse(any(p.LABELS.index(label) >= 4 for label, _ in backend.calls))
            COUNTS['protocol_controls'] += 1
        for label, value in [('git-head', b'5' * 40 + b'\n'), ('git-tree', b'bad\n'),
                             ('git-status', b' M unrelated.py\n'),
                             ('head-api', p.canonical({'sha': '2' * 40, 'tree': {'sha': '5' * 40}})),
                             ('head-api', p.canonical({'sha': '6' * 40, 'tree': {'sha': '4' * 40}})),
                             ('head-api', b'{}\n'), ('head-api', b'x' * 65537)]:
            def fault(b, target=label, replacement=value):
                b.worker_fault = lambda name, out, err, rc, mode: (replacement, err, rc, mode) if name == target else (out, err, rc, mode)
            backend, report = run_fake(fault=fault)
            self.assertFalse(report['outcome']['measurement_complete'])
            self.assertEqual(report['failure']['stage'], 'prestart-tree-binding')
            self.assertFalse(any(p.LABELS.index(name) >= 4 for name, _ in backend.calls))
            COUNTS['protocol_controls'] += 1

    def test_source_registration_failures_start_nothing(self):
        faults = [lambda b: b.params.update(registration_sha256='0' * 64),
                  lambda b: b.files.update({b.root + '/' + p.AUDIT + '/' + p.FILES[0]: b'changed source'}),
                  lambda b: b.files.update({b.root + '/' + p.P0['path']: b'changed P0'}),
                  lambda b: b.files.update({b.root + '/' + p.WORKFLOW['path']: b'changed workflow'})]
        for index, fault in enumerate(faults):
            backend, report = run_fake(fault=fault)
            self.assertEqual(backend.calls, [])
            self.assertFalse(report['outcome']['measurement_complete'])
            self.assertEqual(report['failure']['stage'], 'prestart-tree-binding' if index == 3 else 'source-registration')
            COUNTS['protocol_controls'] += 1

    def test_witness_and_argument_guards_precede_native(self):
        for label, value, rc in [('abi-witness', p.canonical({'schema': 'openclaw-ci-saved-abi-v1',
                                           'layout': dict(FIXED_LAYOUT, size=128)}), 0),
                                 ('build-abi', b'synthetic unavailable -lproc', 1),
                                 ('refusal-missing', b'bad', 0)]:
            def fault(b, target=label, replacement=value, code=rc):
                b.worker_fault = lambda name, out, err, status, mode: (replacement, b'', code, mode) if name == target else (out, err, status, mode)
            backend, report = run_fake(fault=fault)
            self.assertFalse(report['outcome']['measurement_complete'])
            self.assertFalse(any(name in ('native-plain', 'native-sudo') for name, _ in backend.calls))
            COUNTS['protocol_controls'] += 1

    def test_plain_failure_prevents_sudo(self):
        cases = [helper(rc=0), helper(rc=-1, error=1), helper(rc=80), helper(rc=140), helper(error=5),
                 change_field(helper(), 'pbi_svuid', 2000)]
        for value in cases:
            def fault(b, payload=value):
                b.worker_fault = lambda name, out, err, rc, mode: (p.canonical(payload), err, rc, mode) if name == 'native-plain' else (out, err, rc, mode)
            backend, report = run_fake(fault=fault)
            self.assertFalse(report['outcome']['measurement_complete'])
            self.assertNotIn('native-sudo', [name for name, _ in backend.calls])
            self.assertEqual(report['contexts'][1], None)
            COUNTS['protocol_controls'] += 1

    def test_secret_output_is_suppressed(self):
        def fault(b):
            b.worker_fault = lambda name, out, err, rc, mode: (b.secret, b'', 0, mode) if name == 'head-api' else (out, err, rc, mode)
        backend, report = run_fake(fault=fault)
        self.assertFalse(report['outcome']['measurement_complete'])
        self.assertNotIn(backend.secret, backend.outputs['report.json'])
        self.assertNotIn(backend.secret, b''.join(p.canonical(v) for v in backend.progress_records))
        self.assertTrue(report['workers'][-1]['stdout']['redacted'])
        COUNTS['protocol_controls'] += 1


class DataTests(unittest.TestCase):
    def test_raw_fields_and_distinct_saved_values(self):
        value = helper()
        self.assertEqual(p.normalize_helper(value, 'plain'), value['native']['fields'])
        for name, (offset, width) in FIXED_FIELDS.items():
            bad = copy.deepcopy(value)
            raw = bytearray.fromhex(bad['native']['raw_hex'])
            raw[offset] ^= 1
            bad['native']['raw_hex'] = raw.hex()
            expect_refusal(p, lambda: p.normalize_helper(bad, 'plain'), 'helper', 'raw-fields')
            bad = copy.deepcopy(value)
            bad['native']['fields'][name] = 1 << (width * 8)
            expect_refusal(p, lambda: p.normalize_helper(bad, 'plain'))
            COUNTS['schema_controls'] += 2
        for name in ('pbi_svuid', 'pbi_svgid'):
            bad = change_field(value, name, 2001)
            self.assertEqual(p.normalize_helper(bad, 'plain')[name], 2001)
            expect_refusal(p, lambda: p.check_plain(bad), 'credential-relations', 'runner-mismatch')
            COUNTS['schema_controls'] += 1

    def test_native_status_and_failed_nulling(self):
        for rc, error in [(0, 0), (-1, 1), (1, 0), (135, 0), (137, 0), (136, 1)]:
            value = helper(rc=rc, error=error)
            self.assertIsNone(p.normalize_helper(value, 'plain'))
            bad = copy.deepcopy(value)
            bad['native'].update(raw_hex=helper()['native']['raw_hex'], fields=helper()['native']['fields'])
            expect_refusal(p, lambda: p.normalize_helper(bad, 'plain'), 'helper', 'failed-buffer')
            COUNTS['schema_controls'] += 2
        for key in ('rc', 'errno'):
            for bad_value in (True, '136', 136.0, None, 1 << 40):
                value = helper();value['native'][key] = bad_value
                expect_refusal(p, lambda: p.normalize_helper(value, 'plain'))
                COUNTS['schema_controls'] += 1

    def test_sudo_classification_and_no_defaults(self):
        for raw in (None, b'', b'0', b'1001', b'01', b'+1', b'-1', b' 1', b'4294967295', b'4294967296', b'x', b'1' * 32):
            item = p.sudo_value(raw)
            value = helper('sudo');value['sudo_uid'] = item
            p.normalize_helper(value, 'sudo')
            if raw == b'1001':
                self.assertEqual(p.relations(helper(), value)['sudo'], 'root-triples-zero')
            else:
                expect_refusal(p, lambda: p.relations(helper(), value), 'credential-relations', 'sudo-metadata')
            COUNTS['schema_controls'] += 1
        expect_refusal(p, lambda: p.sudo_value(b'x' * 33), 'helper', 'sudo-bound')
        COUNTS['schema_controls'] += 1

    def test_canonical_duplicate_extra_and_number_boundaries(self):
        value = helper();raw = p.canonical(value)
        self.assertEqual(p.decode(raw, p.HELPER_SCHEMA, 8192, 'helper'), value)
        for bad in [raw + b'\n', raw[:-1], b'{"schema":1,"schema":2}\n', b'{"schema":NaN}\n', b'[]\n', b'\xff', b'0\n']:
            expect_refusal(p, lambda: p.decode(bad, p.HELPER_SCHEMA, 8192, 'helper'))
            COUNTS['schema_controls'] += 1
        for key in ('pid_before', 'pid_after'):
            for bad in (False, 0, -1, '800', 1.0, 2147483648):
                changed = copy.deepcopy(value);changed[key] = bad
                expect_refusal(p, lambda: p.normalize_helper(changed, 'plain'))
                COUNTS['schema_controls'] += 1


class CaptureTests(unittest.TestCase):
    def capture(self, mode='normal', stdout=b'ok', stderr=b'', cap=16384, privileged=False, budget=100000000):
        ops = FakeOperations(Clock(), stdout, stderr, 0, mode)
        record = p.capture_worker(ops, 0, 'git-head', ['/synthetic'], 5, budget, cap, 'clean', privileged, b'synthetic_secret', 49152)
        COUNTS['capture_controls'] += 1
        return ops, record

    def test_complete_timeout_eof_excess_and_unknown(self):
        ops, record = self.capture()
        p.worker_complete(record, 0)
        self.assertTrue(ops.closed)
        for mode in ('hang', 'missing-eof'):
            ops, record = self.capture(mode)
            expect_refusal(p, lambda: p.worker_complete(record, 0))
            self.assertTrue(record['timed_out'])
            self.assertEqual(ops.signals, ['TERM', 'KILL'])
        ops, record = self.capture(stdout=b'12345', cap=2)
        self.assertEqual(record['stdout']['raw_hex'], b'12'.hex())
        self.assertTrue(record['stdout']['exceeded'])
        expect_refusal(p, lambda: p.worker_complete(record, 0))
        ops, record = self.capture(mode='hang', privileged=True)
        self.assertEqual(ops.signals, [])
        self.assertEqual(record['state'], 'unknown')
        self.assertFalse(record['waited'])
        self.assertFalse(record['term_attempted'])
        expect_refusal(p, lambda: p.worker_complete(record, 0))

    def test_exhaustion_has_own_tags(self):
        clock = Clock();clock.reads = 4096
        with self.assertRaises(AssertionError) as result:clock.now()
        self.assertEqual(str(result.exception), 'fake-queue-exhausted:clock')
        ops = FakeOperations(Clock());ops.reads = 4096
        with self.assertRaises(AssertionError) as result:ops.events(0)
        self.assertEqual(str(result.exception), 'fake-queue-exhausted:read')
        COUNTS['guard_probes'] += 2


def schema_nodes(value, path=()):
    yield path, value
    if type(value) is dict:
        for key, child in value.items():
            yield from schema_nodes(child, path + (key,))
    elif type(value) is list:
        for index, child in enumerate(value):
            yield from schema_nodes(child, path + (index,))


def edit_at(value, path, replacement=None, remove=False):
    result = copy.deepcopy(value)
    parent = result
    for key in path[:-1]:
        parent = parent[key]
    if remove:
        del parent[path[-1]]
    else:
        parent[path[-1]] = replacement
    return result


def static_c(source, witness=False):
    clean = re.sub(r'"(?:\\.|[^"\\])*"', '""', source)
    calls = set(re.findall(r'\b([A-Za-z_]\w*)\s*\(', clean))
    allowed = {'defined', '_Static_assert', '_Generic', '_Alignof', 'sizeof', 'offsetof', 'int', 'if', 'for',
               'emit_layout', 'main', 'printf', 'fputs', 'fflush', 'ferror'}
    if not witness:
        allowed.update({'read_sudo', 'getenv', 'memset', 'strnlen', 'prepare_self_alarm', 'sigemptyset', 'sigaction',
                        'sigaddset', 'sigprocmask', 'setrlimit', 'alarm', 'sample_getters', 'getuid', 'geteuid',
                        'getgid', 'getegid', 'clock_ns', 'clock_gettime', 'emit_getters', 'emit_hex', 'fputc',
                        'strcmp', 'getpid', 'getppid', 'proc_pidinfo', 'UINT64_C'})
    if calls - allowed:
        raise AssertionError('kill:forbidden-C-api')
    if re.search(r'struct\s+proc_bsdinfo\s*\{', clean):
        raise AssertionError('unexpected-control-error:manual-ABI')
    if '_Generic(&proc_pidinfo, int (*)(int,int,uint64_t,void *,int)' not in source:
        raise AssertionError('unexpected-control-error:signature')
    if witness:
        if re.search(r'\b(?:getuid|geteuid|getpid|proc_pidinfo)\s*\(', clean):
            raise AssertionError('kill:forbidden-C-api')
        return
    body = source[source.index('int main('):]
    end = body.index('    struct sudo_value sudo_uid;')
    guard = body[:end]
    if not all(part in guard for part in ('argc != 4', '--ci-saved-self', '00000000-0000-0000-0000-000000000003',
                                         '"plain"', '"sudo"', 'return 64;')):
        raise AssertionError('kill:argument-guard-order')
    guard_end = body.index('return 64;')
    if any(body.index(call) < guard_end for call in ('read_sudo(', 'prepare_self_alarm(', 'clock_ns(', 'sample_getters(', 'proc_pidinfo(')):
        raise AssertionError('kill:argument-guard-order')
    if len(re.findall(r'\bproc_pidinfo\s*\(', clean)) != 1:
        raise AssertionError('unexpected-control-error:query-count')
    if not re.search(r'errno = 0;\s*int rc = proc_pidinfo\(getpid\(\), PROC_PIDTBSDINFO, 0, &info, \(int\)sizeof\(info\)\);\s*int native_errno = errno;', body):
        raise AssertionError('unexpected-control-error:errno-order')
    for name, (offset, width) in FIXED_FIELDS.items():
        if ('offsetof(struct proc_bsdinfo, ' + name + ') == ' + str(offset)) not in source or ('"' + name + '-type"') not in source:
            raise AssertionError('unexpected-control-error:field-assert')


def mutated_module(function, kind, replace=None):
    source = INPUTS['probe_ci_saved_credential.py'].decode()
    tree = ast.parse(source, feature_version=(3, 9))
    selected = []
    if function is not None:
        target = next(node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name == function)
        selected = [node for node in ast.walk(target) if isinstance(node, ast.Call) and
                    isinstance(node.func, ast.Name) and node.func.id == 'require' and len(node.args) >= 3 and
                    isinstance(node.args[2], ast.Constant) and node.args[2].value == kind]
        if len(selected) != 1:
            raise AssertionError('unexpected-control-error:mutant-target')
        selected[0].args[0] = ast.Constant(True)
    else:
        class Replace(ast.NodeTransformer):
            def visit_Constant(self, node):
                if node.value == 'not-tested':
                    return node
                return node
        if kind == 'length':
            target = next(node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name == 'normalize_helper')
            selected = [node for node in ast.walk(target) if isinstance(node, ast.Compare) and
                        isinstance(node.left, ast.Name) and node.left.id == 'rc' and isinstance(node.ops[0], ast.NotEq) and
                        len(node.comparators) == 1 and isinstance(node.comparators[0], ast.Constant) and node.comparators[0].value == 136]
            if len(selected) != 1:raise AssertionError('unexpected-control-error:mutant-length-target')
            selected[0].comparators[0] = ast.Constant(128)
        elif kind == 'mapping':
            target = next(node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name == 'normalize_helper')
            selected = [node for node in ast.walk(target) if isinstance(node, ast.Tuple) and len(node.elts) == 4 and
                        isinstance(node.elts[0], ast.Subscript) and isinstance(node.elts[0].value, ast.Name) and node.elts[0].value.id == 'fields']
            if len(selected) != 1:raise AssertionError('unexpected-control-error:mutant-mapping-target')
            selected[0].elts[0], selected[0].elts[1] = selected[0].elts[1], selected[0].elts[0]
        elif kind == 'saved':
            target = next(node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name == 'check_plain')
            selected = [node for node in ast.walk(target) if isinstance(node, ast.Assign) and
                        isinstance(node.targets[0], ast.Name) and node.targets[0].id == 'saved_plain']
            if len(selected) != 1:raise AssertionError('unexpected-control-error:mutant-saved-target')
            selected[0].value = ast.parse("(left['pbi_uid'], left['pbi_gid'])", mode='eval').body
        elif kind == 'literal':
            selected = [node for node in ast.walk(tree) if isinstance(node, ast.Call) and isinstance(node.func, ast.Name) and
                        node.func.id == 'literal' and len(node.args) == 1 and isinstance(node.args[0], ast.Constant) and node.args[0].value == 'not-tested']
            if len(selected) != 1:raise AssertionError('unexpected-control-error:mutant-literal-target')
            selected[0].func.id = 'string';selected[0].args = [ast.Constant(4096)]
        else:
            raise AssertionError('unexpected-control-error:mutant-kind')
    namespace = {'__name__': 'synthetic_only_mutant', '__file__': str(STEP / 'probe_ci_saved_credential.py')}
    exec(compile(ast.fix_missing_locations(tree), '<synthetic-only-actual-source-mutant>', 'exec'), namespace)
    return type('SourceModule', (), namespace)


def source_control(module, name):
    tag = 'kill:' + name
    if name in ('source-binding', 'whole-tree-before-toolchain', 'witness-before-native'):
        def fault(b):
            if name == 'source-binding':
                b.files[b.root + '/' + p.AUDIT + '/' + p.FILES[0]] = b'synthetic changed registered source'
            elif name == 'whole-tree-before-toolchain':
                b.worker_fault = lambda label, out, err, rc, mode: (p.canonical({'sha': '2' * 40, 'tree': {'sha': '5' * 40}}), err, rc, mode) if label == 'head-api' else (out, err, rc, mode)
            else:
                b.worker_fault = lambda label, out, err, rc, mode: (p.canonical({'schema': 'openclaw-ci-saved-abi-v1', 'layout': dict(FIXED_LAYOUT, size=128)}), err, rc, mode) if label == 'abi-witness' else (out, err, rc, mode)
        mode = 'native' if name == 'witness-before-native' else 'toolchain'
        backend, report = run_fake(module, fault, (mode, tag))
        expected = 'abi-witness' if mode == 'native' else 'prestart-tree-binding' if name.startswith('whole-tree') else 'source-registration'
        if report['failure'] is None or report['failure']['stage'] != expected:
            raise AssertionError('unexpected-control-error:denial-stage')
        return
    value = helper()
    if name == 'fixed-return-length':
        value['native']['rc'] = 128
        expect_refusal(module, lambda: module.normalize_helper(value, 'plain'), 'helper', 'native-status', tag)
    elif name == 'failed-buffer-nulling':
        value['native'].update(rc=0, status='api-failure')
        expect_refusal(module, lambda: module.normalize_helper(value, 'plain'), 'helper', 'failed-buffer', tag)
    elif name == 'raw-field-equality':
        value['native']['fields']['pbi_start_tvusec'] += 1
        expect_refusal(module, lambda: module.normalize_helper(value, 'plain'), 'helper', 'raw-fields', tag)
    elif name == 'self-pid':
        value = change_field(value, 'pbi_pid', 801)
        expect_refusal(module, lambda: module.normalize_helper(value, 'plain'), 'helper', 'self-pid', tag)
    elif name == 'real-effective-getter-map':
        value = change_field(value, 'pbi_uid', 1010)
        value['getters_before']['euid'] = value['getters_after']['euid'] = 1010
        try:
            fields = module.normalize_helper(value, 'plain')
        except module.Refusal as error:
            if (error.record['stage'], error.record['kind']) == ('helper', 'getter-mapping'):
                raise AssertionError(tag)
            raise AssertionError('unexpected-control-error:mapping-refusal')
        if fields['pbi_uid'] != 1010 or fields['pbi_ruid'] != 1001:
            raise AssertionError(tag)
    elif name == 'saved-not-effective':
        value = change_field(value, 'pbi_svuid', 1010)
        expect_refusal(module, lambda: module.check_plain(value), 'credential-relations', 'runner-mismatch', tag)
    elif name == 'sudo-absence-no-default':
        right = helper('sudo');right['sudo_uid'] = {'raw_hex': None, 'number': None, 'tag': 'absent'}
        expect_refusal(module, lambda: module.relations(value, right), 'credential-relations', 'sudo-metadata', tag)
    elif name == 'timeout-eof-wait':
        backend, report = run_fake()
        if not report['outcome']['measurement_complete']:
            raise AssertionError('unexpected-control-error:paired-complete')
        worker = copy.deepcopy(report['workers'][0]);worker['eof'] = False
        worker['stdout'].update(eof=False, complete=False)
        expect_refusal(module, lambda: module.worker_complete(worker, 0), 'worker', 'incomplete', tag)
    elif name == 'no-admission-literal':
        _, report = run_fake()
        report['outcome']['eligible_native_positive'] = 'approved'
        expect_refusal(module, lambda: module.validate_report(report), 'report', 'literal', tag)
    else:
        raise AssertionError('unexpected-control-error:control-name')


class WholeSchemaTests(unittest.TestCase):
    def test_every_nested_object_and_scalar_schema_boundary(self):
        _, report = run_fake()
        self.assertTrue(report['outcome']['measurement_complete'], report['failure'])
        for path, value in list(schema_nodes(report)):
            if type(value) is dict:
                for key in value:
                    bad = edit_at(report, path + (key,), remove=True)
                    expect_refusal(p, lambda: p.shape(bad, p.REPORT_SCHEMA))
                    COUNTS['schema_controls'] += 1
                bad = copy.deepcopy(report)
                target = bad
                for key in path:target = target[key]
                target['unregistered_extra'] = 1
                expect_refusal(p, lambda: p.shape(bad, p.REPORT_SCHEMA))
                COUNTS['schema_controls'] += 1
            elif type(value) in (bool, int, str):
                choices = [True, 1.0, 'wrong-type'] if type(value) is int else [1, 'wrong-type'] if type(value) is bool else [1, False]
                for replacement in choices:
                    bad = edit_at(report, path, replacement)
                    expect_refusal(p, lambda: p.shape(bad, p.REPORT_SCHEMA))
                    COUNTS['schema_controls'] += 1
        for key, number in p.LIMITS.items():
            bad = copy.deepcopy(report);bad['limits'][key] = number + 1
            expect_refusal(p, lambda: p.validate_report(bad))
            COUNTS['schema_controls'] += 1

    def test_partial_report_and_exact_registration(self):
        b = FakeBackend();p.check_registration(b.selected)
        for value in (True, '65536', 65536.0, 0, 65537):
            bad = copy.deepcopy(b.selected);bad['p1']['files'][p.FILES[0]]['bytes'] = value
            expect_refusal(p, lambda: p.check_registration(bad))
            COUNTS['schema_controls'] += 1
        for key in b.selected:
            bad = copy.deepcopy(b.selected);del bad[key]
            expect_refusal(p, lambda: p.check_registration(bad))
            COUNTS['schema_controls'] += 1
        for fault in (lambda item: item['source_review'].update(approved_commit='2' * 40),
                      lambda item: item['p0'].update(path='unregistered'),
                      lambda item: item['workflow_baseline'].update(sha256='0' * 64)):
            bad = copy.deepcopy(b.selected);fault(bad)
            expect_refusal(p, lambda: p.check_registration(bad))
            COUNTS['schema_controls'] += 1
        backend, failed = run_fake(fault=lambda b: b.params.update(registration_sha256='0' * 64))
        p.validate_report(failed)
        self.assertFalse(failed['outcome']['measurement_complete'])
        self.assertIsNotNone(failed['failure'])
        self.assertEqual(failed['contexts'], [None, None])

    def test_template_exact_steps_projection_and_printed_payload(self):
        b = FakeBackend();raw = b.files[b.root + '/' + p.WORKFLOW['path']]
        projected = p.project_workflow(raw, b.params['registration_sha256'], INPUTS[p.FILES[3]])
        self.assertEqual(projected, WORKFLOW_BYTES)
        step = p.workflow_steps(b.params['registration_sha256'], INPUTS[p.FILES[3]])
        self.assertEqual(step.count(b'      - name:'), 2)
        self.assertNotIn(b'REGISTRATION_SHA256', step)
        self.assertNotIn(b'path: |\n            ${{ runner.temp }}/*', step)
        for bad in (raw + b'# extra\n', raw.replace(step, b'', 1), raw.replace(step, step * 2, 1)):
            expect_refusal(p, lambda: p.project_workflow(bad, b.params['registration_sha256'], INPUTS[p.FILES[3]]))
            COUNTS['schema_controls'] += 1
        _, report = run_fake()
        stream = io.StringIO()
        with contextlib.redirect_stdout(stream):p.print_report(report)
        lines = stream.getvalue().splitlines()
        chunks = [bytes.fromhex(line.split(' ', 2)[2]) for line in lines[:-1]]
        self.assertEqual(b''.join(chunks), p.canonical(report))
        self.assertEqual(lines[-1], 'CI_SAVED_CREDENTIAL_REPORT_SHA256 ' + p.digest(p.canonical(report)))
        self.assertTrue(all(len(line) < 8192 for line in lines))


class SourceAndMutationTests(unittest.TestCase):
    def test_C_sources_are_bounded_syntactic_controls(self):
        static_c(INPUTS[p.FILES[0]].decode(), witness=True)
        static_c(INPUTS[p.FILES[1]].decode())
        self.assertEqual(len(p.REPORT_SCHEMA), 13)
        self.assertEqual(p.LAYOUT, FIXED_LAYOUT)
        self.assertTrue(all(len(data) <= 65536 for data in INPUTS.values()))
        self.assertLessEqual(sum(len(data) for data in INPUTS.values()), 262144)
        tree = ast.parse(INPUTS['probe_ci_saved_credential.py'], feature_version=(3, 9))
        self.assertFalse(any(isinstance(node, ast.Import) and any(alias.name in ('ctypes', 'pwd', 'grp') for alias in node.names) for node in ast.walk(tree)))
        self.assertNotIn(b'ci_saved_credential_', WORKFLOW_BYTES)
        for data in INPUTS.values():
            self.assertTrue(b'sudo ' + b'-k' not in data, 'forbidden-credential-cache-operation')
        COUNTS['schema_controls'] += 6

    def test_actual_source_mutants_at_intended_assertions(self):
        definitions = [
            ('source-binding', 'run_measurement', 'source-binding'),
            ('whole-tree-before-toolchain', 'run_measurement', 'tree'),
            ('witness-before-native', 'run_measurement', 'candidate'),
            ('fixed-return-length', None, 'length'),
            ('failed-buffer-nulling', 'normalize_helper', 'failed-buffer'),
            ('raw-field-equality', 'normalize_helper', 'raw-fields'),
            ('self-pid', 'normalize_helper', 'self-pid'),
            ('real-effective-getter-map', None, 'mapping'),
            ('saved-not-effective', None, 'saved'),
            ('sudo-absence-no-default', 'relations', 'sudo-metadata'),
            ('timeout-eof-wait', 'worker_complete', 'incomplete'),
            ('no-admission-literal', None, 'literal')]
        for name, function, kind in definitions:
            source_control(p, name)
            COUNTS['paired_baselines'] += 1
            mutant = mutated_module(function, kind)
            try:
                source_control(mutant, name)
            except AssertionError as error:
                self.assertEqual(str(error), 'kill:' + name)
            else:
                self.fail('designated mutant survived:' + name)
            COUNTS['intended_mutant_kills'].append(name)
        observer = INPUTS[p.FILES[1]].decode()
        for name in ('forbidden-C-api', 'argument-guard-order'):
            static_c(observer)
            COUNTS['paired_baselines'] += 1
            if name == 'forbidden-C-api':
                self.assertEqual(observer.count('getuid()'), 1)
                mutant = observer.replace('getuid()', 'setuid(0)', 1)
            else:
                start = observer.index('    if (argc != 4', observer.index('int main('))
                end = observer.index('    struct sudo_value sudo_uid;', start)
                guard = observer[start:end]
                mutant = observer[:start] + observer[end:]
                position = mutant.index('    uint64_t mono_before', mutant.index('int main('))
                mutant = mutant[:position] + guard + mutant[position:]
            try:
                static_c(mutant)
            except AssertionError as error:
                self.assertEqual(str(error), 'kill:' + name)
            else:
                self.fail('designated C syntactic mutant survived:' + name)
            COUNTS['intended_mutant_kills'].append(name)


class FailureAndBoundsTests(unittest.TestCase):
    def test_prestart_metadata_faults_and_nonmeasurement_base_race(self):
        for label, out, err, rc, mode in [
            ('head-api', b'', b'synthetic transport unavailable', 22, 'normal'),
            ('head-api', b'', b'', 0, 'hang'),
            ('head-api', b'{"sha":"bad","tree":{"sha":"' + b'4' * 40 + b'"}}\n', b'', 0, 'normal'),
            ('head-api', b'{"sha":"' + b'2' * 40 + b'","tree":{}}\n', b'', 0, 'normal'),
            ('head-api', p.canonical({'sha': '2' * 40, 'tree': {'sha': '5' * 40}}), b'', 0, 'normal'),
            ('git-status', b'?? unrelated-base-file\n', b'', 0, 'normal'),
            ('git-head', b'3' * 40 + b'\n', b'warning', 0, 'normal')]:
            def fault(b, target=label, values=(out, err, rc, mode)):
                b.worker_fault = lambda name, *old: values if name == target else old
            backend, report = run_fake(fault=fault)
            self.assertEqual(report['failure']['stage'], 'prestart-tree-binding')
            self.assertTrue(all(p.LABELS.index(name) < 4 for name, _ in backend.calls))
            self.assertTrue(any(item['kind'] == 'failure' for item in backend.progress_records))
            for name, raw in INPUTS.items():
                self.assertEqual(p.digest(backend.files[backend.root + '/' + p.AUDIT + '/' + name]),
                                 backend.selected['p1']['files'][name]['sha256'])
            COUNTS['protocol_controls'] += 1
        for transform in (lambda raw: raw + b'# changed merged workflow\n',
                          lambda raw: raw.replace(b'      - name: Measure preregistered', b'      - name: Unreviewed', 1)):
            def fault(b):
                path = b.root + '/' + p.WORKFLOW['path'];b.files[path] = transform(b.files[path])
            backend, report = run_fake(fault=fault)
            self.assertEqual(report['failure']['stage'], 'prestart-tree-binding')
            self.assertEqual(backend.calls, [])
            COUNTS['protocol_controls'] += 1

    def test_toolchain_input_failure_and_unknown_sudo_stop(self):
        faults = [lambda b: b.files.pop('/sdk/SDKSettings.json'),
                  lambda b: b.files.update({'/sdk/SDKSettings.json': b'x' * 65537}),
                  lambda b: b.files.update({'/sdk/usr/include/libproc.h': b'x' * 262145})]
        for fault in faults:
            backend, report = run_fake(fault=fault)
            self.assertEqual(report['failure']['stage'], 'toolchain')
            self.assertFalse(any(name in ('abi-witness', 'native-plain', 'native-sudo') for name, _ in backend.calls))
            COUNTS['protocol_controls'] += 1
        def fault(b):
            b.worker_fault = lambda name, out, err, rc, mode: (b'', b'', rc, 'hang') if name == 'native-sudo' else (out, err, rc, mode)
        backend, report = run_fake(fault=fault)
        self.assertFalse(report['outcome']['measurement_complete'])
        self.assertEqual(report['failure']['stage'], 'native-sudo')
        self.assertEqual(report['failure']['worker_index'], 22)
        self.assertEqual(report['workers'][-1]['state'], 'unknown')
        self.assertFalse(report['workers'][-1]['term_attempted'])
        self.assertFalse(report['workers'][-1]['kill_attempted'])
        self.assertEqual(report['build']['drift'], [])
        COUNTS['protocol_controls'] += 1

    def test_getter_clock_pid_and_saved_boundaries(self):
        value = helper()
        for mutation in [lambda v: v['getters_after'].update(uid=1003),
                         lambda v: v.update(pid_after=801), lambda v: v.update(ppid_after=701),
                         lambda v: v['clocks'].update(monotonic_ns_after=999),
                         lambda v: v['clocks'].update(wallclock_ns_after=0),
                         lambda v: v['clocks'].update(monotonic_ns_after=9000000001),
                         lambda v: v['layout'].update(endian='big')]:
            bad = copy.deepcopy(value);mutation(bad)
            expect_refusal(p, lambda: p.normalize_helper(bad, 'plain'))
            COUNTS['schema_controls'] += 1
        for name in ('pbi_svuid', 'pbi_svgid'):
            for number in (0, 4294967295, 1003):
                bad = change_field(value, name, number)
                expect_refusal(p, lambda: p.check_plain(bad))
                COUNTS['schema_controls'] += 1
        for raw in (None, b'', b'01', b'+1001', b'1001\n', b'4294967295', b'4294967296', b'1002'):
            right = helper('sudo');right['sudo_uid'] = p.sudo_value(raw)
            expect_refusal(p, lambda: p.relations(value, right))
            COUNTS['schema_controls'] += 1

    def test_capture_stdin_start_errors_split_secret_and_raw_budget(self):
        for mode in ('stdin', 'not-started', 'capture-error', 'split-secret', 'raw-budget'):
            ops = FakeOperations(Clock(), b'abcdefgh', input_done=mode != 'stdin')
            if mode == 'not-started':ops.pid = None
            if mode == 'capture-error':ops.error = 'synthetic-error'
            if mode == 'split-secret':
                ops.frames = [[('stdout', b'synthetic_')], [('stdout', b'secret')], [('stdout', None), ('stderr', None)]]
            worker = p.capture_worker(ops, 3, 'head-api', ['/synthetic'], 5, 5000000000, 16384,
                                      'clean', False, b'synthetic_secret', 3 if mode == 'raw-budget' else 49152)
            expect_refusal(p, lambda: p.worker_complete(worker, 0))
            if mode == 'not-started':self.assertEqual(worker['state'], 'not-started')
            if mode == 'split-secret':
                self.assertTrue(worker['stdout']['redacted'])
                self.assertIsNone(worker['stdout']['raw_hex'])
            if mode == 'raw-budget':self.assertTrue(worker['stdout']['exceeded'])
            self.assertTrue(ops.closed)
            COUNTS['capture_controls'] += 1

    def test_report_worker_artifact_and_progress_consistency(self):
        _, report = run_fake()
        changes = [lambda v: v['workers'][0].update(waited=False),
                   lambda v: v['workers'][0].update(state='unknown'),
                   lambda v: v['workers'][0].update(pid=None),
                   lambda v: v['workers'][0].update(eof=False),
                   lambda v: v['workers'][0].update(environment='toolchain'),
                   lambda v: v['workers'][0].update(privileged_wrapper=True),
                   lambda v: v['workers'][0].update(stdin='api-auth-unrecorded'),
                   lambda v: v['workers'][22].update(term_attempted=True),
                   lambda v: v['build']['artifact'][0].update(sha256='0' * 64),
                   lambda v: v['build']['artifact'][0].update(bytes=0),
                   lambda v: v['build']['drift'].pop(),
                   lambda v: v['source']['prestart_tree_binding'].update(equal=False),
                   lambda v: v['witness'].update(matches_candidate=False)]
        for change in changes:
            bad = copy.deepcopy(report);change(bad)
            expect_refusal(p, lambda: p.validate_report(bad))
            COUNTS['schema_controls'] += 1
        backend, _ = run_fake()
        for item in backend.progress_records:
            p.check_progress(item)
            bad = dict(item, extra=1)
            expect_refusal(p, lambda: p.check_progress(bad))
            COUNTS['schema_controls'] += 1
        for bound, value in [(p.NS, -1), (p.NS, 9223372036854775808), (p.PID, 0),
                             (p.HASH, 'G' * 64), (p.PATH, 'x\n'), (p.U32, 4294967296)]:
            expect_refusal(p, lambda: p.shape(value, bound))
            COUNTS['schema_controls'] += 1

    def test_private_file_resolver_exclusive_writes_and_bounds(self):
        base = PRIVATE / 'files';base.mkdir(mode=0o700)
        source = base / 'input';source.write_bytes(b'synthetic-only-file')
        real, _ = p.resolve_path(str(base))
        leaf = pathlib.Path(real) / 'exclusive'
        environment = {'GH_TOKEN': 'synthetic_non_secret_token', 'RUNNER_TEMP': real}
        with mock.patch.object(p.RealBackend, 'now', return_value=1000):
            backend = p.RealBackend(real, str(leaf), environment, base.stat().st_uid)
            try:
                backend.make_work()
                self.assertEqual(leaf.stat().st_mode & 0o777, 0o700)
                self.assertEqual((leaf / 'progress.jsonl').stat().st_mode & 0o777, 0o600)
                raw, metadata = backend.observe(str(source), 100)
                self.assertEqual(raw, b'synthetic-only-file')
                self.assertEqual(metadata['sha256'], p.digest(raw))
                expect_refusal(p, lambda: backend.observe(str(source), 1), 'filesystem', 'size')
                backend.write('report.json', b'synthetic-only-report')
                with self.assertRaises(FileExistsError):backend.write('report.json', b'overwrite')
                with self.assertRaises(FileExistsError):backend.make_work()
                link = base / 'link';link.symlink_to('input')
                data, observed = backend.observe(str(link), 100)
                self.assertEqual(data, raw)
                self.assertEqual(observed['symlinks'][-1]['target'], 'input')
                cycle = base / 'cycle';cycle.symlink_to('cycle')
                expect_refusal(p, lambda: p.resolve_path(str(cycle)), 'filesystem', 'symlinks')
                expect_refusal(p, lambda: p.resolve_path('/' + '/'.join(['x'] * 17)), 'filesystem', 'components')
                expect_refusal(p, lambda: backend.write('../escape', b'x'), 'artifact', 'name')
                expect_refusal(p, lambda: backend.write('report.json', backend.secret), 'artifact', 'secret-output')
            finally:
                backend.close()
        COUNTS['schema_controls'] += 8


def selector_text(t):
    lines=t.splitlines();a="          saved_job_id=\"$(/usr/bin/python3 -I -S -B - <<'PY_JOB'";z='          PY_JOB'
    assert lines.count(a)==lines.count(z)==1, 'selector-delimiters'
    i,j=lines.index(a),lines.index(z);body=lines[i+1:j]
    assert i<j and body and all(x.startswith(' '*10) for x in body), 'selector-indent'
    return '\n'.join(x[10:] for x in body)+'\n'


def test_tokens(self):
    eq,raises=self.assertEqual,self.assertRaisesRegex
    from types import SimpleNamespace as N
    code=selector_text(P2_WORKFLOW_TEMPLATE)
    def select(token,error=None,read=False,text=code):
        b=FakeBackend();resp=mock.MagicMock();resp.__enter__.return_value=resp
        resp.read.return_value=json.dumps(dict(total_count=1,jobs=[dict(name='macos-process-census',run_id=39550906038,run_attempt=1,head_sha='2'*40,id=123)])).encode()
        op=mock.Mock();op.open.return_value=resp
        if error:(resp.read if read else op.open).side_effect=error
        req=mock.Mock(HTTPRedirectHandler=object);req.build_opener.return_value=op
        sig=mock.Mock(SIGALRM=1,ITIMER_REAL=2);fos=N(environ=dict(b.environment,GH_TOKEN=token));url=N(request=req)
        assert fos.environ is not p.os.environ
        for value,name in [(fos,'os'),(sig,'signal'),(url,'urllib'),(req,'urllib.request')]:assert value is not sys.modules.get(name)
        tree=ast.parse(text);tree.body=[x for x in tree.body if not isinstance(x,ast.Import)];out=io.StringIO();err=None
        with contextlib.redirect_stdout(out):
            try:exec(compile(tree,'<actual-selector>','exec'),dict(json=json,re=re,os=fos,signal=sig,urllib=url,open=lambda *a:io.BytesIO(json.dumps(b.event).encode())))
            except SystemExit as ex:err=str(ex)
        if op.open.called:eq(sig.setitimer.call_args_list,[mock.call(2,5),mock.call(2,0)])
        return out.getvalue(),err
    good=['ghs_'+'A'*36,'ghs_1_'+'A'*170+'.'+'B'*170+'.'+'C-'*86,'X'*4096,'opaque"\\value'];bad=['',' ','\r','\n','\0','\x7f','é','X'*4097]
    for token in good:assert select(token)==('123\n',None), 'kill:selector'
    prefix='saved-credential job selection unavailable: phase='
    for token in bad:eq(select(token),('',prefix+'token'))
    for read in (False,True):eq(select(good[0],ValueError('never print me'),read),('',prefix+('response' if read else 'request')))
    with self.assertRaises(AssertionError):selector_text(P2_WORKFLOW_TEMPLATE*2)
    with raises(AssertionError,'^kill:selector$'):assert select(good[1],text=code.replace(r'[\x21-\x7e]{1,4096}',r'[A-Za-z0-9_]{1,512}'))==('123\n',None), 'kill:selector'
    def driver(raw,token):
        ns=dict(p.__dict__);exec(raw,ns);cls=ns['RealBackend']
        with mock.patch.object(cls,'now',return_value=0):
            try:b=cls('/r','/w',{'GH_TOKEN':token},1)
            except ns['Refusal'] as ex:
                eq((ex.record['stage'],ex.record['kind']),('ci','token'))
                raise AssertionError('kill:driver') from None
            ops=mock.Mock();ns.update(ProcessOperations=ops,capture_worker=lambda *a:dict(stdout=dict(captured_bytes=0),stderr=dict(captured_bytes=0)));b.start(0,'x',['/usr/bin/curl'],5,100,auth=True)
        argv,env,wire=ops.call_args.args;eq((argv,env),(['/usr/bin/curl'],p.CLEAN))
        try:value=json.loads(wire.splitlines()[0].split(b' = ',1)[1])
        except ValueError:raise AssertionError('kill:config') from None
        assert value=='Authorization: Bearer '+token, 'kill:config'
    raw=INPUTS[p.FILES[2]].decode()
    for token in good:driver(raw,token)
    for token in bad:
        with raises(AssertionError,'^kill:driver$'):driver(raw,token)
    for text,token,tag in [(raw.replace(r'[\x21-\x7e]{1,4096}',r'[A-Za-z0-9_]{1,512}'),good[1],'driver'),(raw.replace(".replace(b'\\\\', b'\\\\\\\\').replace(b'\"', b'\\\\\"')",''),good[3],'config')]:
        self.assertNotEqual(text,raw)
        with raises(AssertionError,'^kill:'+tag+'$'):driver(text,token)
    print('CI_SAVED_TOKEN_CONTROLS paired=3 killed=3 synthetic-only',file=sys.stderr)

SourceAndMutationTests.test_tokens=test_tokens

PRIVATE = None


def main():
    global PRIVATE
    initialize()
    with tempfile.TemporaryDirectory(prefix='ci-saved-credential-fakes-') as directory:
        PRIVATE = pathlib.Path(directory).resolve()
        with fake_only(PRIVATE):
            suite = unittest.defaultTestLoader.loadTestsFromModule(sys.modules[__name__])
            result = unittest.TextTestRunner(verbosity=2).run(suite)
        if result.wasSuccessful():
            summary = dict(COUNTS, synthetic_only=True, test_methods=result.testsRun,
                           real_process_network_native_credential_calls=0)
            print('CI_SAVED_CREDENTIAL_FAKE_CONTROLS ' + json.dumps(summary, sort_keys=True, separators=(',', ':')), file=sys.stderr, flush=True)
        return 0 if result.wasSuccessful() else 1


if __name__ == '__main__':
    import sys
    sys.exit(main())
