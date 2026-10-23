import ast
import copy
import errno
import io
import json
import math
import pathlib
import signal
import subprocess
import sys
import unittest
from types import SimpleNamespace
from unittest.mock import Mock


STEP = pathlib.Path(__file__).resolve().parent
HELPERS = ('CohortTimeout', 'cohort_error', 'emit_cohort_record', 'wait_group_absent',
           'run_cohort', 'read_cohort_ready', 'cohort_clock', 'require_forced_proof',
           'final_forced_cleanup')


class ClockExhausted(RuntimeError):
    pass


class ProbeExhausted(RuntimeError):
    pass


def helper_nodes(source):
    tree = ast.parse(source)
    selected = []
    for name in HELPERS:
        found = [n for n in tree.body if isinstance(n, (ast.FunctionDef, ast.ClassDef)) and n.name == name]
        assert len(found) == 1, 'control-single-definition'
        assert not any(isinstance(n, (ast.Import, ast.ImportFrom)) for n in ast.walk(found[0])), 'control-no-helper-import'
        selected.append(found[0])
    return tree, selected


def check_wiring(source):
    tree, _ = helper_nodes(source)
    portable = [n for n in tree.body if isinstance(n, ast.ClassDef) and n.name == 'Portable']
    assert len(portable) == 1, 'control-real-class'
    methods = [n for n in portable[0].body if isinstance(n, ast.FunctionDef) and n.name == 'test_term_ignoring_group_requires_real_absence']
    assert len(methods) == 1, 'control-real-method'
    method = methods[0]
    calls = [n for n in ast.walk(method) if isinstance(n, ast.Call)]
    for name in ('run_cohort', 'require_forced_proof', 'final_forced_cleanup'):
        assert len([n for n in calls if isinstance(n.func, ast.Name) and n.func.id == name]) == 1, 'control-real-helper-call'
    final_calls = [n for n in ast.walk(method) if isinstance(n, ast.Try) and any(
        isinstance(c, ast.Call) and isinstance(c.func, ast.Name) and c.func.id == 'final_forced_cleanup'
        for block in n.finalbody for c in ast.walk(block))]
    assert len(final_calls) == 1, 'control-real-finally'
    names = set(HELPERS)
    assert not any(isinstance(n, ast.Name) and isinstance(n.ctx, ast.Store) and n.id in names for n in ast.walk(method)), 'control-real-shadow'
    assert not any(isinstance(n, ast.arg) and n.arg in names for n in ast.walk(method)), 'control-real-shadow'
    assert not any(isinstance(n, (ast.FunctionDef, ast.ClassDef)) and n is not method and n.name in names for n in ast.walk(method)), 'control-real-shadow'
    driver = next(n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == 'run_cohort')
    assert len([n for n in ast.walk(driver) if isinstance(n, ast.Call) and isinstance(n.func, ast.Name) and n.func.id == 'wait_group_absent']) == 1, 'control-driver-helper-call'
    assert not any(isinstance(n, ast.Name) and isinstance(n.ctx, ast.Store) and n.id == 'wait_group_absent' for n in ast.walk(driver)), 'control-driver-shadow'
    assert not any(isinstance(n, ast.arg) and n.arg == 'wait_group_absent' for n in ast.walk(driver)), 'control-driver-shadow'
    assert not any(isinstance(n, (ast.FunctionDef, ast.ClassDef)) and n is not driver and n.name == 'wait_group_absent' for n in ast.walk(driver)), 'control-driver-shadow'
    proof_line = next(n.lineno for n in calls if isinstance(n.func, ast.Name) and n.func.id == 'require_forced_proof')
    old = []
    for call in calls:
        if isinstance(call.func, ast.Attribute) and isinstance(call.func.value, ast.Name) and call.func.value.id == 'self' and call.func.attr in ('assertTrue', 'assertEqual'):
            old.append(call)
    old.sort(key=lambda n: n.lineno)
    assert len(old) == 5 and old[-1].lineno < proof_line, 'control-old-assertion-order'
    assert isinstance(old[0].args[0], ast.Call) and isinstance(old[0].args[0].func, ast.Attribute) and isinstance(old[0].args[0].func.value, ast.Name) and old[0].args[0].func.value.id == 'marker' and old[0].args[0].func.attr == 'exists', 'control-old-first-assertion'
    assert all(isinstance(n.args[0], ast.Subscript) and isinstance(n.args[0].slice, ast.Constant) for n in old[1:]), 'control-old-assertion-shape'
    assert [n.args[0].slice.value for n in old[1:]] == ['signals', 'groupAbsent', 'pythonReaped', 'pythonExitCode'], 'control-old-assertion-order'
    anchors = ('start_new_session=True', 'for sig in (signal.SIGTERM, signal.SIGKILL):',
               '    end = time.monotonic() + seconds\n')
    assert all(source.count(anchor) == 1 for anchor in anchors), 'control-old-anchor-count'


class Harness:
    def __init__(self, source):
        self.now = 0.0
        self.clock_calls = 0
        self.clock_limit = 8192
        self.sleep_scale = 1.0
        self.phase = None
        self.probes = {}
        self.calls = []
        self.outputs = []
        self.events = []
        self.probe = None
        self.signal_error = None
        self.wait_error = None
        self.communicate_error = None
        self.poll_unknown = False
        self.proc = SimpleNamespace(pid=12345, returncode=None, communicate=self.communicate,
                                    poll=self.poll, wait=self.wait)
        _, nodes = helper_nodes(source)
        self.ns = {'__name__': 'owned_cohort_extracted', 'errno': errno, 'json': json, 'math': math,
                   'signal': signal, 'sys': sys, 'os': SimpleNamespace(killpg=self.killpg),
                   'time': SimpleNamespace(monotonic=self.clock, sleep=self.sleep),
                   'subprocess': SimpleNamespace(Popen=self.start, PIPE=-1,
                       TimeoutExpired=subprocess.TimeoutExpired, CompletedProcess=subprocess.CompletedProcess),
                   'print': self.emit}
        exec(compile(ast.Module(body=nodes, type_ignores=[]), 'owned-cohort-extracted', 'exec'), self.ns)

    def clock(self):
        self.clock_calls += 1
        if self.clock_calls > self.clock_limit:
            raise ClockExhausted('owned clock exhausted')
        return self.now

    def sleep(self, seconds):
        self.calls.append(('sleep', seconds))
        self.now += seconds * self.sleep_scale

    def start(self, *args, **kwargs):
        self.calls.append(('start', kwargs))
        return self.proc

    def communicate(self, timeout):
        self.calls.append(('communicate', timeout, self.phase))
        if self.communicate_error and self.phase == 'SIGTERM':
            raise self.communicate_error
        if self.phase != 'SIGKILL':
            self.now += timeout
            raise subprocess.TimeoutExpired('owned fake', timeout)
        self.proc.returncode = -signal.SIGKILL
        return '', ''

    def poll(self):
        self.calls.append(('poll',))
        return None if self.poll_unknown else self.proc.returncode

    def wait(self, timeout):
        self.calls.append(('wait', timeout))
        if self.wait_error:
            raise self.wait_error
        return self.proc.returncode

    def killpg(self, group, sig):
        self.calls.append(('killpg', group, sig))
        if sig:
            self.phase = sig.name
            if self.signal_error:
                raise self.signal_error
            return None
        self.probes[self.phase] = self.probes.get(self.phase, 0) + 1
        if self.probe:
            result = self.probe(self, self.phase, self.probes[self.phase])
            if isinstance(result, BaseException):
                raise result
        else:
            result = 'present' if self.phase == 'SIGTERM' else 'absent'
        if result == 'absent':
            raise ProcessLookupError(errno.ESRCH, 'owned absent')
        if result != 'present':
            raise ProbeExhausted('owned probe exhausted')

    def emit(self, text, **kwargs):
        if kwargs != {'flush': True}:
            raise RuntimeError('owned emission must flush')
        self.events.append('emit')
        self.outputs.append(text)

    def run(self):
        try:
            self.ns['run_cohort'](['owned fake'], {}, timeout=2, grace=3)
        except self.ns['CohortTimeout'] as error:
            self.events.append('caught')
            return error
        raise RuntimeError('owned timeout missing')

    def ready(self):
        return {'state': 'parsed', 'bytes': 81, 'error': None,
                'value': {'ready': True, 'pid': 12346, 'ppid': 12345, 'pgid': 12345, 'session': 12345}}

    def positive(self):
        error = self.run()
        self.ns['require_forced_proof'](error.cleanup, error.observations, self.ready())
        return error


class CohortControls(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.completed = set()
        cls.counts = {'window_cases': 0, 'ready_cases': 0, 'boundary_cases': 0,
                      'exhaustion_guards': 0, 'paired': 0, 'intended_kills': 0}

    @classmethod
    def tearDownClass(cls):
        expected = set(unittest.defaultTestLoader.getTestCaseNames(cls))
        if cls.completed == expected:
            print('COHORT_ABSENCE_CONTROLS ' + json.dumps(cls.counts, sort_keys=True), flush=True)

    def source(self):
        return (STEP / 'test_cluster_startup_evidence.py').read_text()

    def done(self):
        self.completed.add(self._testMethodName)

    def reject(self, h, cleanup, observations, ready, reason):
        try:
            h.ns['require_forced_proof'](cleanup, observations, ready)
        except AssertionError as error:
            self.assertEqual(str(error), reason, 'control-refusal-identity')
        else:
            self.fail('control-missing-refusal')

    def test_callsite_binding_and_old_anchors(self):
        source = self.source()
        check_wiring(source)
        for old, new in (
            ('            require_forced_proof(caught.exception.cleanup,caught.exception.observations,ready)', '            pass'),
            ('                final_forced_cleanup(proc,primary)', '                pass'),
            ('def wait_group_absent(group, seconds):', 'def unused_group_observer(group, seconds):')):
            with self.assertRaises(AssertionError):
                check_wiring(source.replace(old, new, 1))
        self.done()

    def test_boundary_decisions_keep_original_probe_first_rule(self):
        for phase in ('SIGTERM', 'SIGKILL'):
            for returned in (.999, 1.0, 1.001):
                h = Harness(self.source()); h.phase = phase
                def absent(h, phase, count):
                    h.now = returned
                    return 'absent'
                h.probe = absent
                self.assertIs(h.ns['wait_group_absent'](12345, 1), True, 'control-probe-first-boundary')
                row = h.ns['wait_group_absent'].last_observation
                self.assertEqual(row['samples'][0]['returnedAt'], returned)
                self.assertEqual(row['outcome'], 'absent')
                self.counts['boundary_cases'] += 1
            h = Harness(self.source()); h.phase = phase
            def present(h, phase, count):
                h.now = 1.0
                return 'present'
            h.probe = present
            self.assertIs(h.ns['wait_group_absent'](12345, 1), False)
            row = h.ns['wait_group_absent'].last_observation
            self.assertEqual(row['samples'][-1]['deadlineCheckAt'], 1.0)
            self.assertEqual(row['outcome'], 'deadline')
            self.assertEqual(h.probes[phase], 1)
            self.counts['boundary_cases'] += 1
        h = Harness(self.source())
        def late(h, phase, count):
            if phase == 'SIGKILL':
                h.now += 4
                return 'absent'
            return 'present'
        h.probe = late
        h.positive()
        self.counts['boundary_cases'] += 1
        h = Harness(self.source())
        def late_term(h, phase, count):
            h.now += 4
            return 'absent'
        h.probe = late_term
        error = h.run()
        self.assertIs(error.cleanup['groupAbsent'], True)
        self.assertEqual(error.cleanup['signals'], ['SIGTERM'])
        self.reject(h, error.cleanup, error.observations, h.ready(), 'cohort-proof-reaped')
        self.counts['boundary_cases'] += 1
        self.done()

    def test_both_window_errors_stay_attributed_unknown(self):
        for phase in ('SIGTERM', 'SIGKILL'):
            for refusal in (PermissionError(errno.EPERM, 'owned refusal'), OSError(errno.EIO, 'owned refusal'), ProcessLookupError(errno.EPERM, 'owned refusal')):
                h = Harness(self.source())
                def denied(h, current, count):
                    if current == phase:
                        return refusal
                    return 'present' if current == 'SIGTERM' else 'absent'
                h.probe = denied
                error = h.run()
                index = 0 if phase == 'SIGTERM' else 1
                row = error.observations['windows'][index]['observation']
                self.assertEqual(row['outcome'], 'error')
                self.assertEqual(row['samples'][0]['error'], {'type': type(refusal).__name__, 'errno': refusal.errno})
                self.assertIn('group observation: ' + type(refusal).__name__, error.cleanup['errors'])
                self.reject(h, error.cleanup, error.observations, h.ready(), 'cohort-proof-errors' if index == 0 else 'cohort-proof-absence')
                self.counts['window_cases'] += 1
        h = Harness(self.source()); h.sleep_scale = .2
        error = h.run()
        self.assertIs(error.cleanup['groupAbsent'], True, 'control-record-cap-not-decision')
        self.assertTrue(error.observations['windows'][0]['observation']['overflow'])
        self.reject(h, error.cleanup, error.observations, h.ready(), 'cohort-proof-observation-binding')
        self.counts['window_cases'] += 1
        self.done()

    def test_missing_unknown_borrowed_and_outside_windows_refuse(self):
        h = Harness(self.source()); original = h.positive()
        for index in (0, 1):
            cases = (
                ('window-record', lambda w: w.update(observation=None)),
                ('samples', lambda w: w['observation'].update(samples=[])),
                ('present' if index == 0 else 'esrch', lambda w: w['observation']['samples'][0].update(result='unknown')),
                ('sample-clock', lambda w: w['observation']['samples'][0].update(issuedAt=-1)),
                ('sample-clock', lambda w: w['observation']['samples'][0].update(returnedAt=1e10)),
                ('observation-binding', lambda w: w['observation'].update(group=999)),
                ('observation-binding', lambda w: w['observation'].update(overflow=True)),
                ('window-label', lambda w: w.update(signal='unobserved')),
                ('outcome', lambda w: w['observation'].update(outcome='unknown')),
            )
            for suffix, change in cases:
                observations = copy.deepcopy(original.observations)
                change(observations['windows'][index])
                self.reject(h, original.cleanup, observations, h.ready(), 'cohort-proof-' + suffix)
                self.counts['window_cases'] += 1
            for key in original.observations['windows'][index]['observation']['samples'][0]:
                observations = copy.deepcopy(original.observations)
                del observations['windows'][index]['observation']['samples'][0][key]
                self.reject(h, original.cleanup, observations, h.ready(), 'cohort-proof-sample-schema')
                self.counts['window_cases'] += 1
            for key in original.observations['windows'][index]['observation']:
                observations = copy.deepcopy(original.observations)
                del observations['windows'][index]['observation'][key]
                self.reject(h, original.cleanup, observations, h.ready(), 'cohort-proof-observation-schema')
                self.counts['window_cases'] += 1
        observations = copy.deepcopy(original.observations)
        observations['windows'][1]['observation'] = copy.deepcopy(observations['windows'][0]['observation'])
        self.reject(h, original.cleanup, observations, h.ready(), 'cohort-proof-observation-clock')
        for cleanup in ({**original.cleanup, 'pythonReaped': False}, {**original.cleanup, 'groupAbsent': False}):
            self.reject(h, cleanup, original.observations, h.ready(), 'cohort-proof-reaped' if not cleanup['pythonReaped'] else 'cohort-proof-absence')
        self.counts['window_cases'] += 3
        self.done()

    def test_ready_records_are_complete_bounded_and_bound(self):
        h = Harness(self.source()); error = h.positive()
        for raw in (b'', b'{', b'x' * 4097, b'[]', b'null', b'{}'):
            marker = SimpleNamespace(open=lambda mode, raw=raw: io.BytesIO(raw))
            ready = h.ns['read_cohort_ready'](marker)
            reason = 'cohort-proof-ready-record' if ready['state'] != 'parsed' else 'cohort-proof-ready-schema'
            self.reject(h, error.cleanup, error.observations, ready, reason)
            self.counts['ready_cases'] += 1
        def missing(mode):
            raise FileNotFoundError(errno.ENOENT, 'owned missing')
        ready = h.ns['read_cohort_ready'](SimpleNamespace(open=missing))
        self.reject(h, error.cleanup, error.observations, ready, 'cohort-proof-ready-record')
        self.counts['ready_cases'] += 1
        for field in ('pid', 'ppid', 'pgid', 'session'):
            for wrong in (0, 12345 if field == 'pid' else 999, True):
                ready = h.ready(); ready['value'][field] = wrong
                self.reject(h, error.cleanup, error.observations, ready, 'cohort-proof-ready-binding')
                self.counts['ready_cases'] += 1
        raw = json.dumps(h.ready()['value']).encode()
        ready = h.ns['read_cohort_ready'](SimpleNamespace(open=lambda mode: io.BytesIO(raw)))
        h.ns['require_forced_proof'](error.cleanup, error.observations, ready)
        self.counts['ready_cases'] += 1
        self.done()

    def test_emission_precedes_assertions_and_keeps_old_projection(self):
        h = Harness(self.source()); error = h.positive()
        self.assertEqual(h.events, ['emit', 'caught'], 'control-preassert-emission')
        self.assertEqual(set(error.cleanup), {'group', 'signals', 'errors', 'groupAbsent', 'pythonReaped', 'pythonExitCode'})
        record = json.loads(h.outputs[0].split(': ', 1)[1])
        self.assertEqual(record['cleanup'], error.cleanup)
        self.assertEqual(record['observations'], error.observations)
        self.assertFalse(any(value in h.outputs[0] for value in ('FAIL:', 'ERROR:')))
        h = Harness(self.source()); h.communicate_error = OSError(errno.EIO, 'owned communicate')
        with self.assertRaises(OSError):
            h.run()
        self.assertEqual(len(h.outputs), 1)
        self.assertEqual(json.loads(h.outputs[0].split(': ', 1)[1])['observations']['unexpectedError'], {'type': 'OSError', 'errno': errno.EIO})
        h = Harness(self.source())
        proc = SimpleNamespace(pid=12345, returncode=-9, poll=lambda: -9,
                               communicate=Mock(side_effect=[subprocess.TimeoutExpired('owned', 1),
                                   subprocess.TimeoutExpired('owned', 1), ('', '')]))
        h.ns['subprocess'].Popen = Mock(return_value=proc)
        h.ns['os'].killpg = Mock()
        h.ns['wait_group_absent'] = Mock(side_effect=[False, True])
        error = h.run()
        self.assertEqual(proc.communicate.call_count, 3)
        self.assertEqual(h.ns['os'].killpg.call_args_list,
                         [unittest.mock.call(12345, signal.SIGTERM), unittest.mock.call(12345, signal.SIGKILL)])
        self.assertEqual([w['observation'] for w in error.observations['windows']], [None, None])
        self.assertEqual(len(h.outputs), 1)
        self.done()

    def test_final_records_preserve_primary_on_every_error(self):
        for kind in ('signal', 'parent-wait', 'presence', 'deadline', 'normal'):
            h = Harness(self.source()); h.proc.returncode = -signal.SIGKILL
            if kind == 'signal':
                h.signal_error = PermissionError(errno.EPERM, 'owned signal')
            elif kind == 'parent-wait':
                h.wait_error = subprocess.TimeoutExpired('owned wait', 3)
            elif kind == 'presence':
                h.probe = lambda *args: PermissionError(errno.EPERM, 'owned presence')
            elif kind == 'deadline':
                h.probe = lambda *args: 'present'
            primary = RuntimeError('owned primary')
            caught = None
            try:
                try:
                    raise primary
                finally:
                    h.ns['final_forced_cleanup'](h.proc, primary)
            except BaseException as error:
                caught = error
            self.assertIs(caught, primary, 'control-primary-preserved')
            self.assertEqual(len(h.outputs), 1, 'control-final-emission')
            row = json.loads(h.outputs[0].split(': ', 1)[1])
            if kind in ('signal', 'parent-wait', 'presence'):
                self.assertEqual(row['error']['phase'], kind)
                self.assertFalse(row['groupAbsent'])
            elif kind == 'deadline':
                self.assertFalse(row['groupAbsent'])
                self.assertEqual(row['observation']['outcome'], 'deadline')
            else:
                self.assertTrue(row['groupAbsent'])
                self.assertTrue(row['parentWait']['returned'])
                self.assertEqual(row['parentWait']['seconds'], 3)
                self.assertEqual(row['observation']['deadline'] - row['observation']['startedAt'], 5)
        h = Harness(self.source()); h.proc.returncode = -signal.SIGKILL; h.probe = lambda *args: 'present'
        with self.assertRaisesRegex(AssertionError, '^cohort-final-absence$'):
            h.ns['final_forced_cleanup'](h.proc, None)
        self.assertEqual(len(h.outputs), 1)
        self.done()

    def test_script_exhaustion_cannot_count_as_an_assertion(self):
        h = Harness(self.source()); h.phase = 'SIGTERM'; h.sleep_scale = 0; h.clock_limit = 40
        with self.assertRaises(ClockExhausted):
            h.ns['wait_group_absent'](12345, 3)
        h = Harness(self.source()); h.phase = 'SIGTERM'; h.probe = lambda *args: 'exhausted'
        with self.assertRaises(ProbeExhausted):
            h.ns['wait_group_absent'](12345, 3)
        self.assertFalse(issubclass(ClockExhausted, AssertionError))
        self.assertFalse(issubclass(ProbeExhausted, AssertionError))
        self.counts['exhaustion_guards'] += 2
        self.done()

    def mutate(self, source, helper, old, new):
        _, nodes = helper_nodes(source)
        node = next(n for n in nodes if n.name == helper)
        lines = source.splitlines(keepends=True)
        text = ''.join(lines[node.lineno - 1:node.end_lineno])
        self.assertEqual(text.count(old), 1, 'control-mutant-anchor')
        lines[node.lineno - 1:node.end_lineno] = [text.replace(old, new, 1)]
        return ''.join(lines)

    def test_actual_source_intended_mutants_have_paired_positives(self):
        source = self.source()
        def demand(condition, tag):
            if not condition:
                raise AssertionError(tag)
        def signals(h):
            error = h.run()
            demand(error.cleanup['signals'] == ['SIGTERM', 'SIGKILL'], 'control-owned-signal-order')
        def late(h):
            h.phase = 'SIGKILL'
            def probe(h, *args):
                h.now += 4
                return 'absent'
            h.probe = probe
            demand(h.ns['wait_group_absent'](12345, 3) is True, 'control-original-late-decision')
        def error_unknown(h):
            h.phase = 'SIGKILL'; h.probe = lambda *args: PermissionError(errno.EPERM, 'owned denied')
            try:
                result = h.ns['wait_group_absent'](12345, 3)
            except OSError:
                result = False
            demand(result is False, 'control-error-remains-unknown')
        def error_identity(h):
            h.phase = 'SIGKILL'; h.probe = lambda *args: PermissionError(errno.EPERM, 'owned denied')
            try:
                h.ns['wait_group_absent'](12345, 3)
            except OSError:
                pass
            row = h.ns['wait_group_absent'].last_observation
            demand((row['samples'][0].get('error') or {}).get('errno') == errno.EPERM, 'control-error-identity')
        def reaped(h):
            h.poll_unknown = True
            demand(h.run().cleanup['pythonReaped'] is False, 'control-reap-observation')
        def windows(h):
            demand(len(h.run().observations['windows']) == 2, 'control-window-retention')
        def preemit(h):
            h.run()
            demand(h.events == ['emit', 'caught'], 'control-preassert-emission')
        def finalemit(h):
            h.proc.returncode = -signal.SIGKILL
            h.ns['final_forced_cleanup'](h.proc, None)
            demand(len(h.outputs) == 1, 'control-final-emission')
        def primary(h):
            h.signal_error = PermissionError(errno.EPERM, 'owned denied')
            original = RuntimeError('owned primary'); caught = original
            try:
                h.ns['final_forced_cleanup'](h.proc, original)
            except BaseException as error:
                caught = error
            demand(caught is original, 'control-primary-preserved')
        def cap(h):
            h.phase = 'SIGKILL'; h.sleep_scale = .2
            h.probe = lambda h, phase, count: 'present' if count <= 129 else 'absent'
            demand(h.ns['wait_group_absent'](12345, 3) is True, 'control-cap-not-decision')
        def proof_case(h, change, reason, tag):
            error = h.run(); ready = h.ready()
            change(error.cleanup, error.observations)
            try:
                h.ns['require_forced_proof'](error.cleanup, error.observations, ready)
            except AssertionError as error:
                self.assertEqual(str(error), reason, 'control-refusal-identity')
            else:
                self.fail(tag)
        cases = [
            ('wait_group_absent', '    end = time.monotonic() + seconds\n', '    return True\n    end = time.monotonic() + seconds\n', signals, 'control-owned-signal-order'),
            ('wait_group_absent', 'return True', "return sample['returnedAt'] <= end", late, 'control-original-late-decision'),
            ('wait_group_absent', "'absent' if error.errno == errno.ESRCH else 'error'", "'absent'", error_unknown, 'control-error-remains-unknown'),
            ('wait_group_absent', "sample['error'] = cohort_error(error)", "sample['error'] = None", error_identity, 'control-error-identity'),
            ('run_cohort', "cleanup['pythonReaped'] = cleanup['pythonExitCode'] is not None", "cleanup['pythonReaped'] = True", reaped, 'control-reap-observation'),
            ('run_cohort', "observations['windows'].append(window)", 'pass', windows, 'control-window-retention'),
            ('run_cohort', "emit_cohort_record('owned-cohort-timeout-v2',\n                                   {'cleanup': cleanup, 'observations': observations})", 'pass', preemit, 'control-preassert-emission'),
            ('final_forced_cleanup', "emit_cohort_record('owned-forced-final-v2', row)", 'pass', finalemit, 'control-final-emission'),
            ('final_forced_cleanup', 'if primary is None:\n            raise', 'if True:\n            raise', primary, 'control-primary-preserved'),
            ('wait_group_absent', "            else:\n                row['overflow'] = True\n            if check >= end:", "            else:\n                row['overflow'] = True\n                return False\n            if check >= end:", cap, 'control-cap-not-decision'),
            ('require_forced_proof', 'def require_forced_proof(cleanup, observations, ready):\n', 'def require_forced_proof(cleanup, observations, ready):\n    return\n', lambda h: proof_case(h, lambda c, o: o.update(windows=[]), 'cohort-proof-windows', 'control-proof-missing-refusal'), 'control-proof-missing-refusal'),
            ('require_forced_proof', "cleanup.get('errors') == ['SIGTERM parent wait expired']", 'True', lambda h: proof_case(h, lambda c, o: c['errors'].append('unknown'), 'cohort-proof-errors', 'control-proof-error-refusal'), 'control-proof-error-refusal'),
            ('require_forced_proof', 'prior <= issued <= returned <= d', 'True', lambda h: proof_case(h, lambda c, o: o['windows'][1]['observation']['samples'][0].update(issuedAt=-1), 'cohort-proof-sample-clock', 'control-proof-window-refusal'), 'control-proof-window-refusal'),
            ('require_forced_proof', "cleanup.get('pythonReaped') is True and cleanup.get('pythonExitCode') == -signal.SIGKILL", 'True', lambda h: proof_case(h, lambda c, o: c.update(pythonReaped=False), 'cohort-proof-reaped', 'control-proof-reap-refusal'), 'control-proof-reap-refusal'),
        ]
        for helper, old, new, control, tag in cases:
            control(Harness(source))
            self.counts['paired'] += 1
            mutated = self.mutate(source, helper, old, new)
            try:
                control(Harness(mutated))
            except AssertionError as error:
                self.assertEqual(str(error), tag, 'control-intended-tag')
            else:
                self.fail('control-mutant-survived')
            self.counts['intended_kills'] += 1
        self.done()


if __name__ == '__main__':
    unittest.main()
