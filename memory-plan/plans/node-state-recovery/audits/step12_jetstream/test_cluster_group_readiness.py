import ast
import copy
import inspect
import json
import pathlib
import tempfile
import unittest
from unittest.mock import patch

import test_preservation_cluster as cluster
from preservation_checks import Refused


class Clock:
    def __init__(self):
        self.now = 0
        self.sleeps = []

    def monotonic(self):
        return self.now

    def sleep(self, seconds):
        self.sleeps.append(seconds)
        self.now = round(self.now + seconds, 3)


def reports(term=1):
    return [{'server_id': 'owned-' + str(i), 'observation': i,
             'raft': {'$SYS': {}, '$G': {
                 'stream': {'leader': 'owned-0', 'term': term},
                 'consumer': {'leader': 'owned-1', 'term': term}}}} for i in range(3)]


class GroupReadiness(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory(prefix='owned-group-readiness-')
        self.addCleanup(temporary.cleanup)
        self.root = pathlib.Path(temporary.name)
        self.clock = Clock()
        self.ports = list(range(101, 110))
        self.calls = []
        self.last = []

    def run_wait(self, build, advance=None):
        def capture(port):
            member = len(self.calls) % 3
            self.calls.append(port)
            if member == 0:
                self.last = copy.deepcopy(build(self.clock.now))
                for row in self.last:
                    row['observation'] = len(self.calls)
            if member == 2 and advance:
                advance(self.clock)
            return self.last[member]
        with patch.object(cluster, 'capture', side_effect=capture):
            return cluster.wait_for_groups(self.ports, self.root,
                                           clock=self.clock.monotonic, sleep=self.clock.sleep)

    def evidence(self):
        path = self.root/'raft-readiness-refused.json'
        self.assertTrue(path.exists(), 'timeout must retain its evidence file')
        return json.loads(path.read_text())

    def test_valid_table_waits_full_interval_and_returns_latest_captures(self):
        result = self.run_wait(lambda now: reports())
        self.assertEqual(result, self.last, 'helper must return the full last captures')
        self.assertEqual(self.clock.now, 1.05, 'stability must begin at the second identical valid sample')
        self.assertEqual(self.clock.sleeps, [.05] * 21, 'existing polling interval must stay fixed')
        self.assertEqual(self.calls, [102, 105, 108] * 22, 'every sample must capture all three monitor ports')
        self.assertFalse((self.root/'raft-readiness-refused.json').exists())

    def test_each_invalid_member_times_out_with_named_conditions(self):
        variants = [('$SYS missing', lambda table: table.pop('$SYS')),
                    ('$G missing', lambda table: table.pop('$G')),
                    ('$G group count below two', lambda table: table['$G'].pop('consumer')),
                    ('$G group count below two', lambda table: table['$G'].clear()),
                    ('$G leader empty', lambda table: table['$G']['consumer'].update(leader='')),
                    ('$G leader empty', lambda table: table['$G']['stream'].update(leader=None))]
        for member in range(3):
            for reason, damage in variants:
                with self.subTest(member=member, reason=reason):
                    self.clock = Clock(); self.calls = []
                    invalid = reports(); damage(invalid[member]['raft'])
                    with self.assertRaisesRegex(AssertionError, 'last reset: invalid',
                                                msg='stable invalid tables must time out'):
                        self.run_wait(lambda now: invalid)
                    evidence = self.evidence()
                    expected = [reason]
                    if reason == '$G missing':
                        expected.append('$G group count below two')
                    self.assertEqual(evidence['failures'][member]['failed'], expected,
                                     'each missing condition must be named independently')
                    self.assertTrue(all(not row['failed'] for i, row in enumerate(evidence['failures']) if i != member),
                                    'healthy members must not inherit another member failure')
                    self.assertEqual(self.clock.now, 10, 'invalid tables must not extend the existing deadline')

    def test_initial_invalid_table_can_converge(self):
        invalid = reports(); invalid[2]['raft']['$G']['consumer']['leader'] = ''
        result = self.run_wait(lambda now: invalid if now < 2 else reports())
        self.assertEqual(result, self.last)
        self.assertEqual(self.clock.now, 3.05, 'valid convergence must receive its own complete stability interval')

    def test_member_tables_need_not_agree(self):
        distinct = reports()
        distinct[1]['raft']['$G']['another-group'] = distinct[1]['raft']['$G'].pop('consumer')
        distinct[2]['raft']['$G']['stream']['leader'] = 'another-elected-leader'
        result = self.run_wait(lambda now: distinct)
        self.assertEqual(result, self.last, 'only the existing per-member conditions may govern readiness')

    def test_invalid_regression_clears_stability(self):
        invalid = reports(); invalid[1]['raft']['$G']['stream']['leader'] = ''
        result = self.run_wait(lambda now: invalid if .6 <= now < 1.2 else reports())
        self.assertEqual(result, self.last)
        self.assertEqual(self.clock.now, 2.25, 'regression must not accumulate disjoint stable intervals')

    def test_changed_valid_groups_clear_stability(self):
        result = self.run_wait(lambda now: reports(1 if now < .6 else 2))
        self.assertEqual(result, self.last)
        self.assertGreaterEqual(self.clock.now, 1.65, 'changed groups must restart the complete stability interval')
        self.assertLessEqual(self.clock.now, 1.7)

    def test_changing_valid_tables_timeout_with_full_evidence(self):
        with self.assertRaisesRegex(AssertionError, 'last reset: change',
                                    msg='changing valid tables must not settle'):
            self.run_wait(lambda now: reports(int(now * 20)))
        evidence = self.evidence()
        self.assertEqual(evidence['captures'], self.last, 'timeout must retain full captures beyond raft')
        self.assertEqual(evidence['last_reset'], 'change', 'timeout must distinguish changed valid tables')
        self.assertEqual(evidence['failures'], [{'member': i, 'failed': []} for i in range(3)])

    def test_timeout_evidence_keeps_last_invalid_capture_and_reset(self):
        invalid = reports(); invalid[0]['raft']['$G']['consumer']['leader'] = ''
        with self.assertRaisesRegex(AssertionError, r'failures: .*\$G leader empty'):
            self.run_wait(lambda now: invalid)
        evidence = self.evidence()
        self.assertEqual(evidence['captures'], self.last, 'timeout must retain full captures beyond raft')
        self.assertEqual(evidence['last_reset'], 'invalid', 'timeout must distinguish invalid tables')
        self.assertEqual(evidence['failures'], [
            {'member': 0, 'failed': ['$G leader empty']},
            {'member': 1, 'failed': []}, {'member': 2, 'failed': []}],
            'timeout must retain per-member failed conditions')

    def test_deadline_is_not_removed_or_extended(self):
        invalid = reports(); invalid[0]['raft']['$G']['consumer']['leader'] = ''
        with self.assertRaisesRegex(AssertionError, 'did not settle',
                                    msg='deadline must refuse rather than accept later convergence'):
            self.run_wait(lambda now: invalid if now < 11 else reports())
        self.assertEqual(self.clock.now, 10)

    def test_sample_started_before_deadline_may_succeed_after_it(self):
        def advance(clock):
            if clock.now == 9.95:
                clock.now = 10.25
        result = self.run_wait(lambda now: reports(int(now * 20) if now < 9 else 999), advance)
        self.assertEqual(result, self.last, 'in-flight final sample must retain existing sample-then-check semantics')
        self.assertEqual(self.clock.now, 10.25, 'polling deadline must not become a hard completion cutoff')
        self.assertFalse((self.root/'raft-readiness-refused.json').exists())

    def test_refused_is_propagated_unchanged(self):
        failure = Refused('owned capture incoherent')
        with patch.object(cluster, 'capture', side_effect=[failure] + reports() * 30):
            with self.assertRaises(Refused, msg='capture refusal must propagate without retry') as caught:
                cluster.wait_for_groups(self.ports, self.root,
                                        clock=self.clock.monotonic, sleep=self.clock.sleep)
        self.assertIs(caught.exception, failure)
        self.assertEqual(self.clock.sleeps, [])
        self.assertFalse((self.root/'raft-readiness-refused.json').exists())

    def test_no_sample_timeout_keeps_an_empty_evidence_table(self):
        with patch.object(cluster, 'capture') as capture:
            with self.assertRaisesRegex(AssertionError, 'last reset: not sampled'):
                cluster.wait_for_groups(self.ports, self.root, clock=iter([0, 11]).__next__, sleep=self.clock.sleep)
        capture.assert_not_called()
        self.assertEqual(self.evidence(), {'captures': [], 'failures': [], 'last_reset': 'not sampled'})

    def test_real_consumer_uses_one_unconfigured_helper_result(self):
        module = ast.parse(inspect.getsource(cluster))
        tree = next(node for node in ast.walk(module) if isinstance(node, ast.FunctionDef)
                    and node.name == 'test_stream_and_consumer_groups_and_real_stream_election')
        calls = [node for node in ast.walk(tree) if isinstance(node, ast.Call)
                 and isinstance(node.func, ast.Name) and node.func.id == 'wait_for_groups']
        self.assertEqual(len(calls), 1, 'real consumer must call the helper exactly once')
        self.assertEqual([ast.dump(node) for node in calls[0].args],
                         [ast.dump(ast.Name(id=name, ctx=ast.Load())) for name in ('ports', 'root')])
        self.assertEqual(calls[0].keywords, [], 'real consumer must not inject clock or sleep')
        assignment = next(node for node in ast.walk(tree) if isinstance(node, ast.Assign) and node.value is calls[0])
        self.assertEqual(ast.dump(assignment.targets[0]), ast.dump(ast.Name(id='before', ctx=ast.Store())),
                         'real assertions must consume the helper returned capture')
        final = '''for report in before:
    self.assertIn('$SYS', report['raft'])
    self.assertIn('$G', report['raft'])
    self.assertGreaterEqual(len(report['raft']['$G']), 2)
    self.assertTrue(all(node['leader'] for node in report['raft']['$G'].values()))'''
        expected = ast.dump(ast.parse(final).body[0])
        matches = [node for node in ast.walk(tree) if isinstance(node, ast.For) and ast.dump(node) == expected]
        self.assertEqual(len(matches), 1, 'existing final assertions must remain unchanged')
        self.assertGreater(matches[0].lineno, assignment.lineno)


if __name__ == '__main__':
    unittest.main()
