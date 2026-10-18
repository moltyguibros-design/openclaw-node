import contextlib
import copy
import hashlib
import io
import json
import os
import pathlib
import shutil
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

import process_class_comparator as comparator
import process_observation_envelope as envelope
import preservation_journal
import restore_only
import test_boot_process_policy as policy_fixture
import test_process_observation_envelope as envelope_fixture
import test_stopped_journal_inputs as image_fixture


BOOT = 'a' * 64
SECRET = 'class-argv-private-sentinel-9274'


def process(expected, pid=411, ppid=1, sec=100, usec=123):
    return {key: expected[key] for key in ('executable', 'executable_sha256', 'uid', 'gid', 'cwd')} | {
        'pid': pid, 'ppid': ppid, 'start_sec': sec, 'start_usec': usec, 'name': 'owned-process',
        'arguments_sha256': envelope.diagnostic.redacted(expected)['arguments_sha256']}


def anchor(row, expected, state='running'):
    job = {'loaded': True, 'state': state, 'pid': row['pid'], 'program': row['executable'],
           'arguments_sha256': row['arguments_sha256'], 'plist': row['cwd'] + '/owned-job.plist'}
    identity = {'device': 1, 'inode': 2, 'ctime_ns': 3}
    return {'j0': job, 'j1': copy.deepcopy(job), 'generation': envelope.generation(row),
            'plist': {'sha256': expected['attribution']['plist_sha256'],
                      'before': identity, 'after': dict(identity)}, 'error': None}


def observed(policy, rows, anchors, *, excluded=(), source='scripted', enumeration='substituted'):
    excluded = [{**envelope.generation(row), 'row_sha256': envelope.fingerprint(row)} for row in excluded]
    pids = sorted(row['pid'] for row in [*rows, *excluded])
    sample = {'boot': BOOT, 'enumeration': enumeration, 'before': pids, 'after': pids,
              'unstable': [], 'included': copy.deepcopy(rows), 'excluded': excluded, 'unknown': []}
    bound = envelope.binding(policy)
    scope = {'expectations_sha256': envelope.fingerprint(envelope.expectations(bound, BOOT)),
             'errors': [], 'monotonic_ns': {'start': 0, 'end': 0}}
    value = {'scope': envelope.SCOPE, 'source': source,
             'sample_labels': None if source == 'observed' else
             {'source': 'observed', 'enumeration': enumeration, 'attribution': 'observed'},
             'policy_binding': bound, 'budget': {'limit_ns': envelope.WINDOW_NS,
                 'anchor_cap': envelope.ANCHOR_CAP, 'elapsed_ns': 0, 'expired': False},
             'stages': {'boot_start': BOOT, 'pass_a': sample, 'scope_a': scope,
                        'anchors': anchors, 'pass_b': copy.deepcopy(sample),
                        'scope_b': copy.deepcopy(scope), 'boot_end': BOOT},
             'failures': [], 'outcome': 'recorded', 'reasons': [], 'admission': False,
             'history_certified': False, 'coverage': {**envelope.COVERAGE,
                 'enumeration': 'scripted' if source == 'scripted' else enumeration,
                 'attribution': source}}
    return envelope.valid_envelope(value, policy)


class Classes(unittest.TestCase):
    def setUp(self):
        self.root = envelope_fixture.owned(self)
        self.prior = policy_fixture.full_node_inventory()
        self.prior['scheduler-heartbeat']['execution_hold'] = policy_fixture.recorded_hold(self.root)
        self.inventory = policy_fixture.full_entrypoint_evidence(self.prior)
        self.inventory['roots'] = [str(self.root / 'protected')]
        self.policy = policy_fixture.authored(self.inventory['roots'])
        self.policy['expected'][0].update(executable=str(self.root / 'protected/program'),
                                          arguments=[str(self.root / 'protected/program'), SECRET, '', 'épreuve'],
                                          cwd=str(self.root / 'protected'))
        self.parent = process(self.policy['expected'][0])
        self.key = envelope.binding(self.policy)['anchors'][0]
        self.key = '/'.join(self.key)
        self.anchors = {self.key: anchor(self.parent, self.policy['expected'][0])}

    def value(self, rows=None, policy=None, anchors=None, **kwargs):
        policy = self.policy if policy is None else policy
        rows = [self.parent] if rows is None else rows
        if anchors is None:
            anchors = copy.deepcopy(self.anchors) if self.parent['pid'] in [row['pid'] for row in rows] else {
                '/'.join(pair): {'j0': {'loaded': False}, 'j1': {'loaded': False},
                                'generation': None, 'plist': None, 'error': None}
                for pair in envelope.binding(policy)['anchors']}
        return observed(policy, rows, anchors, **kwargs)

    def evaluate(self, value=None, policy=None):
        policy = self.policy if policy is None else policy
        policy_fixture.valid_process_policy(policy, self.prior, self.inventory)
        return comparator.compare_classes(policy, self.value() if value is None else value)

    def worker(self, label='worker', parent='controller', count=1):
        expected = copy.deepcopy(self.policy['expected'][0])
        expected.update(label=label, arguments=[expected['executable'], SECRET + '-' + label],
                        count=count, attribution={'kind': 'expected', 'label': parent})
        self.policy['expected'].append(expected)
        return process(expected, pid=512, ppid=self.parent['pid'], sec=200)

    def test_recorded_exact_class_is_consistent_without_admission_or_history(self):
        result = self.evaluate()
        self.assertEqual(result['outcome'], 'class-consistent', 'exact class must match')
        self.assertEqual(result['phase'], 'classes')
        self.assertEqual(result['assigned'], {'controller': [411]})
        self.assertFalse(result['admission'])
        self.assertFalse(result['history_certified'])
        self.assertEqual(result['scope'], comparator.SCOPE)
        self.assertNotIn('clean', result.values())

    def test_expected_digest_calls_unchanged_redaction_for_empty_and_unicode_arguments(self):
        expected = self.policy['expected'][0]
        with patch.object(envelope.diagnostic, 'redacted', wraps=envelope.diagnostic.redacted) as redacted:
            key = comparator.expected_key(expected)
        self.assertEqual(key[2], hashlib.sha256(b'\0'.join(arg.encode() for arg in expected['arguments'])).hexdigest(),
                         'NUL-joined argv must preserve boundaries')
        redacted.assert_called_once_with(expected)
        self.assertNotEqual(key[2], hashlib.sha256(''.join(expected['arguments']).encode()).hexdigest())

    def test_each_class_key_field_is_required_independently(self):
        variants = {'executable': str(self.root / 'protected/different'), 'executable_sha256': 'd' * 64,
                    'arguments_sha256': 'e' * 64, 'uid': os.getuid() + 1,
                    'gid': os.getgid() + 1, 'cwd': str(self.root)}
        for field, replacement in variants.items():
            row = {**self.parent, field: replacement}
            value = self.value([row], anchors={self.key: anchor(row, self.policy['expected'][0])})
            with self.subTest(field=field):
                result = self.evaluate(value)
                self.assertEqual(result['outcome'], 'refused', field + ' mismatch must refuse')
                self.assertEqual(result['unexpected'][0]['class_candidates'], [])
                self.assertEqual(result['missing'], {'controller': 1})

    def cross_boot(self, change):
        row = {**self.parent, **change}
        value = self.value([row], anchors={self.key: anchor(row, self.policy['expected'][0])})
        result = self.evaluate(value)
        self.assertEqual(result['outcome'], 'class-consistent', 'cross-boot class must survive ' + str(change))
        self.assertEqual(result['assigned']['controller'], [row['pid']])

    def test_pid_is_not_a_cross_boot_class_key(self):
        self.cross_boot({'pid': 987})

    def test_start_sec_is_not_a_cross_boot_class_key(self):
        self.cross_boot({'start_sec': 1000})

    def test_start_usec_is_not_a_cross_boot_class_key(self):
        self.cross_boot({'start_usec': 990})

    def test_name_is_not_a_cross_boot_class_key(self):
        self.cross_boot({'name': 'new-boot-name'})

    def test_ppid_is_attribution_only_and_not_a_launchd_class_key(self):
        row = {**self.parent, 'ppid': 876}
        result = self.evaluate(self.value([row]))
        self.assertEqual(result['outcome'], 'class-consistent', 'launchd class must not include ppid')

    def test_policy_owner_namespace_is_independent_of_process_uid(self):
        self.policy['expected'][0]['uid'] = os.getuid() + 1
        row = process(self.policy['expected'][0])
        value = self.value([row], anchors={self.key: anchor(row, self.policy['expected'][0])})
        self.assertEqual(self.evaluate(value)['outcome'], 'class-consistent', 'namespace must use policy owner')

    def test_gui_user_and_system_domains_select_the_actual_anchor(self):
        for domain in ('gui', 'user', 'system'):
            policy = copy.deepcopy(self.policy)
            policy['expected'][0]['attribution']['domain'] = domain
            key = '/'.join(envelope.binding(policy)['anchors'][0])
            value = self.value(policy=policy, anchors={key: anchor(self.parent, policy['expected'][0])})
            with self.subTest(domain=domain):
                self.assertEqual(self.evaluate(value, policy)['outcome'], 'class-consistent')

    def test_nonrunning_with_pid_is_recorded_but_fails_launchd_attribution(self):
        value = self.value(anchors={self.key: anchor(self.parent, self.policy['expected'][0], state='waiting')})
        self.assertEqual(value['outcome'], 'recorded')
        result = self.evaluate(value)
        self.assertEqual(result['outcome'], 'refused', 'nonrunning anchor must not attribute')
        self.assertEqual(result['unexpected'][0]['class_candidates'], ['controller'])

    def test_unloaded_and_idle_are_known_negative_attribution(self):
        for idle in (False, True):
            negative = {'j0': {'loaded': False}, 'j1': {'loaded': False},
                        'generation': None, 'plist': None, 'error': None}
            if idle:
                negative['j0'] = {**self.anchors[self.key]['j0'], 'state': 'waiting', 'pid': None}
                negative['j1'] = dict(negative['j0'])
            with self.subTest(idle=idle):
                value = self.value(anchors={self.key: negative})
                self.assertEqual(value['outcome'], 'recorded')
                self.assertEqual(self.evaluate(value)['outcome'], 'refused')

    def test_authored_plist_hash_is_separate_from_recorded_anchor_identity(self):
        value = self.value()
        value['stages']['anchors'][self.key]['plist']['sha256'] = 'f' * 64
        self.assertEqual(envelope.valid_envelope(value, self.policy)['outcome'], 'recorded')
        self.assertEqual(self.evaluate(value)['outcome'], 'refused', 'authored plist digest must match')

    def test_coherent_wrong_row_generation_cannot_attribute_a_matching_class(self):
        other = copy.deepcopy(self.policy['expected'][0])
        other.update(label='other', executable=str(self.root / 'protected/other'),
                     arguments=['other-command', SECRET + '-other'])
        self.policy['expected'].append(other)
        row = process(other, pid=733, sec=150)
        value = self.value([self.parent, row])
        self.assertEqual(value['outcome'], 'recorded')
        result = self.evaluate(value)
        self.assertEqual(result['outcome'], 'refused', 'anchor must name this candidate generation')
        self.assertEqual(result['assigned'], {'controller': [411], 'other': []})
        self.assertEqual(result['unexpected'][0]['class_candidates'], ['other'])

    def test_parent_attribution_uses_already_unique_label_and_strict_birth(self):
        child = self.worker()
        result = self.evaluate(self.value([child, self.parent]))
        self.assertEqual(result['outcome'], 'class-consistent', 'birth order must resolve the parent first')
        self.assertEqual(result['assigned'], {'controller': [411], 'worker': [512]})

    def test_multiple_parent_levels_resolve_without_policy_order_dependency(self):
        child = self.worker()
        grandchild = self.worker(label='grandchild', parent='worker')
        grandchild.update(pid=613, ppid=child['pid'], start_sec=300)
        self.policy['expected'].reverse()
        result = self.evaluate(self.value([grandchild, child, self.parent]))
        self.assertEqual(result['outcome'], 'class-consistent')
        self.assertEqual(result['assigned'], {'controller': [411], 'grandchild': [613], 'worker': [512]})

    def test_equal_or_later_parent_birth_cannot_be_reused(self):
        child = self.worker()
        for sec, usec in ((100, 123), (99, 999999), (100, 122)):
            row = {**child, 'start_sec': sec, 'start_usec': usec}
            with self.subTest(birth=(sec, usec)):
                result = self.evaluate(self.value([self.parent, row]))
                self.assertEqual(result['outcome'], 'refused', 'parent birth must be strictly earlier')
                self.assertEqual(result['unexpected'][0]['class_candidates'], ['worker'])

    def test_absent_parent_and_pid_one_are_not_exempt(self):
        child = self.worker()
        for ppid in (9999, 1, child['pid']):
            with self.subTest(ppid=ppid):
                result = self.evaluate(self.value([self.parent, {**child, 'ppid': ppid}]))
                self.assertEqual(result['outcome'], 'refused', 'unobservable parent must refuse')
                self.assertEqual(result['assigned']['worker'], [])

    def test_parent_assigned_to_another_label_cannot_supply_attribution(self):
        child = self.worker()
        other = copy.deepcopy(self.policy['expected'][0])
        other.update(label='other', arguments=['different-controller', SECRET + '-other'],
                     attribution={**other['attribution'], 'label': 'application.other'})
        self.policy['expected'].append(other)
        self.policy['expected'][1]['attribution']['label'] = 'other'
        anchors = {**self.anchors, self.key.rsplit('/', 1)[0] + '/application.other': {
            'j0': {'loaded': False}, 'j1': {'loaded': False}, 'generation': None, 'plist': None, 'error': None}}
        result = self.evaluate(self.value([self.parent, child], anchors=anchors))
        self.assertEqual(result['assigned']['worker'], [], 'parent label must match the reference')
        self.assertEqual(result['unexpected'][0]['class_candidates'], ['worker'])

    def ambiguous_parent(self):
        second = copy.deepcopy(self.policy['expected'][0])
        second.update(label='second', attribution={**second['attribution'], 'label': 'application.second'})
        self.policy['expected'].append(second)
        key = self.key.rsplit('/', 1)[0] + '/application.second'
        return {**self.anchors, key: anchor(self.parent, second)}

    def test_ambiguous_candidates_are_not_first_pick_or_count_solved(self):
        anchors = self.ambiguous_parent()
        self.policy['expected'].reverse()
        result = self.evaluate(self.value(anchors=anchors))
        self.assertEqual(result['outcome'], 'refused')
        self.assertEqual(len(result['ambiguous']), 1, 'all candidates must remain ambiguous')
        self.assertEqual(result['ambiguous'][0]['labels'], ['controller', 'second'], 'all candidates must remain ambiguous')
        self.assertEqual(result['assigned'], {'controller': [], 'second': []})
        self.assertEqual(result['missing'], {'controller': 1, 'second': 1})

    def test_ambiguous_parent_does_not_assign_a_child(self):
        child = self.worker()
        anchors = self.ambiguous_parent()
        result = self.evaluate(self.value([self.parent, child], anchors=anchors))
        self.assertEqual([row['process']['pid'] for row in result['ambiguous']], [411])
        self.assertEqual(result['assigned']['worker'], [], 'ambiguous parent must not attribute child')
        self.assertEqual(result['unexpected'][0]['class_candidates'], ['worker'])

    def test_unassigned_parent_does_not_assign_a_child(self):
        child = self.worker()
        bad = {**self.parent, 'executable_sha256': 'e' * 64}
        result = self.evaluate(self.value([bad, child]))
        self.assertEqual([row['process']['pid'] for row in result['unexpected']], [411, 512],
                         'unassigned parent must not attribute child')

    def test_missing_and_launchd_count_two_are_exact_deficits(self):
        for rows, count, deficit in (([], 1, 1), ([self.parent], 2, 1)):
            policy = copy.deepcopy(self.policy)
            policy['expected'][0]['count'] = count
            with self.subTest(count=count, rows=len(rows)):
                result = self.evaluate(self.value(rows, policy=policy), policy)
                self.assertEqual(result['missing'], {'controller': deficit}, 'missing count must be exact')
                self.assertEqual(result['outcome'], 'refused')

    def test_excess_is_not_at_least_cardinality(self):
        child = self.worker()
        other = {**child, 'pid': 513, 'start_usec': 124}
        result = self.evaluate(self.value([self.parent, child, other]))
        self.assertEqual(result['excess'], {'worker': 1}, 'excess count must refuse')
        self.assertEqual(result['outcome'], 'refused')
        self.policy['expected'][1]['count'] = 2
        self.assertEqual(self.evaluate(self.value([self.parent, child, other]))['outcome'], 'class-consistent')

    def test_empty_policy_accepts_only_empty_included_table_after_envelope_gate(self):
        self.policy['expected'] = []
        value = self.value([], anchors={})
        self.assertEqual(self.evaluate(value)['outcome'], 'class-consistent')
        self.assertEqual(self.evaluate(self.value([self.parent], anchors={}))['outcome'], 'refused',
                         'empty policy must reject in-scope rows')
        value['stages']['pass_a']['unknown'] = [{'pid': None, 'field': 'global', 'error_type': 'Refused'}]
        self.assertEqual(self.evaluate(value)['phase'], 'envelope')

    def test_excluded_rows_are_never_matched_to_policy(self):
        other = {**self.parent, 'pid': 808, 'uid': os.getuid() + 1,
                 'executable': '/outside/program', 'cwd': '/outside', 'arguments_sha256': 'e' * 64}
        result = self.evaluate(self.value(excluded=[other]))
        self.assertEqual(result['outcome'], 'class-consistent')
        self.assertEqual(result['assigned'], {'controller': [411]})

    def test_unknown_unstable_partial_expired_and_forged_recorded_gate_before_classes(self):
        values = []
        unknown = self.value()
        unknown['stages']['pass_a']['unknown'] = [{'pid': None, 'field': 'global', 'error_type': 'Refused'}]
        values.append(unknown)
        unstable = self.value(); unstable['stages']['pass_b']['unstable'] = [411]; values.append(unstable)
        partial = self.value(); partial['stages']['boot_end'] = None; values.append(partial)
        expired = self.value(); expired['budget'].update(elapsed_ns=envelope.WINDOW_NS + 1, expired=True); values.append(expired)
        for value in values:
            value['outcome'] = 'recorded'; value['reasons'] = []
            with self.subTest(value=value['stages']['boot_end'], budget=value['budget']), \
                 patch.object(comparator, 'class_key', wraps=comparator.class_key) as key:
                result = self.evaluate(value)
                self.assertEqual(result['phase'], 'envelope', 'recomputed envelope must gate class work')
                self.assertEqual(result['outcome'], 'refused')
                self.assertTrue(result['envelope_reasons'], 'recomputed refusal reasons must survive')
                key.assert_not_called()
                self.assertEqual(result['assigned'], {})
                self.assertEqual(result['unexpected'], [])

    def test_malformed_envelope_propagates_its_refusal_before_keys_or_hashes(self):
        value = self.value(); value['arguments'] = [SECRET]
        with patch.object(comparator, 'class_key') as key, patch.object(envelope, 'fingerprint') as hashed:
            with self.assertRaisesRegex(envelope.Refused, 'envelope schema differs'):
                comparator.compare_classes(self.policy, value)
        key.assert_not_called(); hashed.assert_not_called()

    def test_validator_precedes_even_expected_class_key_work(self):
        events = []
        validate, key = envelope.valid_envelope, comparator.class_key
        value = self.value()
        with patch.object(envelope, 'valid_envelope', side_effect=lambda *args: (events.append('validate'), validate(*args))[1]), \
             patch.object(comparator, 'class_key', side_effect=lambda row: (events.append('key'), key(row))[1]):
            result = self.evaluate(value)
        self.assertEqual(result['outcome'], 'class-consistent')
        self.assertEqual(events[0], 'validate', 'envelope validation must be first')

    def test_source_coverage_and_exact_input_hashes_survive_without_promotion(self):
        for source, enumeration in (('observed', 'full'), ('observed', 'substituted'), ('scripted', 'substituted')):
            value = self.value(source=source, enumeration=enumeration)
            value['outcome'] = 'refused'; value['reasons'] = ['untrusted stored claim']
            value['coverage']['enumeration'] = 'full'
            with self.subTest(source=source, enumeration=enumeration):
                result = self.evaluate(value)
                self.assertEqual(result['source'], source, 'source must not be promoted')
                self.assertEqual(result['coverage'], envelope.valid_envelope(value, self.policy)['coverage'], 'coverage must not be promoted')
                self.assertEqual(result['envelope_sha256'], envelope.fingerprint(value), 'hash must bind exact input envelope')
                self.assertEqual(result['policy_sha256'], envelope.fingerprint(self.policy), 'hash must bind exact policy')
                self.assertEqual(result['outcome'], 'class-consistent')

    def test_result_is_pure_deterministic_and_does_not_modify_inputs(self):
        child = self.worker()
        value = self.value([child, self.parent])
        before = envelope.encoded([self.policy, value])
        with patch.object(envelope.diagnostic, 'observe', side_effect=AssertionError('process IO')), \
             patch.object(envelope.diagnostic, 'in_scope', side_effect=AssertionError('scope IO')), \
             patch.object(envelope.census, 'launchd_service', side_effect=AssertionError('launchd IO')), \
             patch.object(envelope, 'regular_content', side_effect=AssertionError('file IO')), \
             patch.object(pathlib.Path, 'resolve', side_effect=AssertionError('path IO')), \
             patch.object(pathlib.Path, 'stat', side_effect=AssertionError('stat IO')):
            first = self.evaluate(value); second = self.evaluate(value)
        self.assertEqual(envelope.encoded(first), envelope.encoded(second))
        self.assertEqual(envelope.encoded([self.policy, value]), before)

    def test_equal_birth_tie_and_report_order_are_deterministic(self):
        child = self.worker()
        other = {**child, 'pid': 513}
        value = self.value([other, child, self.parent])
        result = self.evaluate(value)
        self.assertEqual(result['assigned']['worker'], [512, 513], 'report order must follow birth then pid')
        self.assertEqual(list(result['assigned']), ['controller', 'worker'])

    def test_report_contains_no_policy_or_raw_argv_and_retains_class_candidate_labels(self):
        child = self.worker()
        child['ppid'] = 999
        result = self.evaluate(self.value([child, self.parent]))
        text = envelope.encoded(result).decode()
        self.assertNotIn(SECRET, text, 'raw argv sentinel must not be emitted')
        self.assertNotIn('"arguments"', text)
        self.assertNotIn('"expected"', text)
        self.assertNotIn('"anchors"', text)
        self.assertEqual(len(result['unexpected']), 1, 'every unexpected row must be retained')
        self.assertEqual(result['unexpected'][0]['class_candidates'], ['worker'], 'class candidates must distinguish failed attribution')
        self.assertIn(self.parent['executable'], text)


class Consumer(unittest.TestCase):
    def fixture(self):
        fixture = envelope_fixture.prepared(self)
        expected = fixture.policy['expected'][0]
        row = process(expected)
        key = '/'.join(envelope.binding(fixture.policy)['anchors'][0])
        value = observed(fixture.policy, [row], {key: anchor(row, expected)}, source='observed', enumeration='full')
        path = fixture.temp / 'envelope.json'; path.write_bytes(envelope.encoded(value)); path.chmod(0o600)
        return fixture, value, path

    def test_shared_owned_reader_is_called_once_and_keeps_policy_private(self):
        fixture, value, _ = self.fixture()
        before = image_fixture.snapshot(fixture.temp)
        reader = envelope.owned_envelope
        with patch.object(envelope, 'owned_envelope', wraps=reader) as owned, \
             patch.object(envelope, 'image_process_policy', wraps=envelope.image_process_policy) as frozen, \
             patch.object(envelope, 'inspect_owned', side_effect=AssertionError('envelope-only wrapper')), \
             patch.object(envelope.diagnostic, 'observe', side_effect=AssertionError('live census')), \
             patch.object(envelope, 'collect_envelope', return_value=value) as live, \
             patch.object(preservation_journal.Journal, '__init__', side_effect=AssertionError('Journal construction')), \
             patch.object(restore_only.gate_module.Gate, '__init__', side_effect=AssertionError('Gate construction')):
            result = comparator.inspect_owned(fixture.temp.resolve(), fixture=True, scripted=True)
        owned.assert_called_once_with(fixture.temp.resolve(), fixture=True, scripted=True)
        self.assertEqual(frozen.call_count, 1, 'one shared frozen-policy read is required')
        self.assertEqual(result['outcome'], 'class-consistent')
        self.assertEqual(result['source'], 'scripted', 'scripted file must retain forced provenance')
        live.assert_not_called()
        self.assertNotIn('process_policy', result)
        self.assertEqual(image_fixture.snapshot(fixture.temp), before)

    def test_viable_fixture_flag_and_checkpoint_fences_precede_class_work(self):
        fixture, _, _ = self.fixture()
        with patch.object(comparator, 'compare_classes') as compare, self.assertRaisesRegex(envelope.Refused, 'production process'):
            comparator.inspect_owned(fixture.temp.resolve(), scripted=True)
        compare.assert_not_called()
        (fixture.capture / 'CHECKPOINT.json').write_bytes(b'{}')
        with patch.object(comparator, 'compare_classes') as compare, self.assertRaises(RuntimeError):
            comparator.inspect_owned(fixture.temp.resolve(), fixture=True, scripted=True)
        compare.assert_not_called()

    def test_cli_prints_only_class_report_and_refusal_exit_without_writes(self):
        fixture, _, path = self.fixture()
        before = image_fixture.snapshot(fixture.temp)
        with patch.object(sys, 'argv', [comparator.__file__, str(fixture.temp.resolve()), '--fixture', '--scripted']), \
             contextlib.redirect_stdout(io.StringIO()) as output:
            self.assertEqual(comparator.main(), 0, 'class-consistent CLI must exit zero')
        result = json.loads(output.getvalue())
        self.assertEqual(result['outcome'], 'class-consistent')
        self.assertNotIn('stages', result, 'CLI must emit only class report')
        self.assertNotIn('arguments', result)
        self.assertEqual(result['coverage']['enumeration'], 'scripted')
        self.assertEqual(image_fixture.snapshot(fixture.temp), before)
        path.write_bytes(b'{}')
        with patch.object(sys, 'argv', [comparator.__file__, str(fixture.temp.resolve()), '--fixture', '--scripted']), \
             contextlib.redirect_stdout(io.StringIO()) as output:
            self.assertEqual(comparator.main(), 2, 'refused CLI must exit two')
        self.assertEqual(json.loads(output.getvalue())['outcome'], 'refused')
        completed = subprocess.run([sys.executable, comparator.__file__, str(fixture.temp.resolve())],
                                   text=True, capture_output=True, timeout=15)
        self.assertEqual(completed.returncode, 2)
        self.assertFalse(json.loads(completed.stdout)['admission'])

    @unittest.skipUnless(sys.platform == 'darwin', 'owned libproc observation requires macOS')
    def test_native_matching_child_refuses_unobservable_parent_and_ci_full_scan(self):
        built = pathlib.Path(tempfile.mkdtemp(prefix='openclaw-owned-class-build-')).resolve()
        self.addCleanup(shutil.rmtree, built)
        executable = built / 'child'
        subprocess.run(['/usr/bin/clang', '-x', 'c', '-o', str(executable), '-'],
                       input='#include <stdio.h>\nint main(void) { puts("ready"); fflush(stdout); getchar(); return 0; }\n',
                       text=True, capture_output=True, check=True, timeout=30)
        digest = hashlib.sha256(executable.read_bytes()).hexdigest()
        factory = policy_fixture.authored
        def authored(roots):
            policy = factory(roots)
            path = roots[0] + '/class-child'
            policy['expected'].append({'label': 'native-child', 'executable': path,
                'executable_sha256': digest, 'arguments': [path, SECRET, '', 'épreuve'],
                'uid': os.getuid(), 'gid': os.getgid(), 'cwd': roots[0], 'count': 1,
                'attribution': {'kind': 'expected', 'label': 'controller'}})
            return policy
        with patch.object(policy_fixture, 'authored', side_effect=authored):
            fixture = envelope_fixture.prepared(self)
        expected = fixture.policy['expected'][1]
        binary = pathlib.Path(expected['executable']); shutil.copyfile(executable, binary); binary.chmod(0o700)
        child = subprocess.Popen(expected['arguments'], cwd=expected['cwd'], stdin=subprocess.PIPE,
                                 stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        reader = envelope.owned_envelope
        captured = []
        def read(*args, **kwargs):
            pair = reader(*args, **kwargs); captured.append(pair); return pair
        try:
            self.assertEqual(child.stdout.readline().strip(), 'ready')
            before = image_fixture.snapshot(fixture.temp)
            with patch.object(envelope.diagnostic.proc, 'list_pids', return_value=[child.pid]) as listed, \
                 patch.object(envelope, 'owned_envelope', side_effect=read):
                result = comparator.inspect_owned(fixture.temp.resolve(), fixture=True)
            self.assertEqual(listed.call_count, 4)
            self.assertEqual(result['phase'], 'classes')
            self.assertEqual(result['outcome'], 'refused')
            self.assertEqual(result['coverage']['enumeration'], 'substituted')
            unexpected = next(row for row in result['unexpected'] if row['process']['pid'] == child.pid)
            self.assertEqual(unexpected['class_candidates'], ['native-child'])
            self.assertEqual(unexpected['process']['ppid'], os.getpid())
            self.assertEqual(comparator.class_key(unexpected['process']), comparator.expected_key(expected))
            self.assertEqual(image_fixture.snapshot(fixture.temp), before)
            self.assertNotIn(SECRET, envelope.encoded(result).decode())
            if os.environ.get('GITHUB_ACTIONS') == 'true':
                with patch.object(envelope, 'owned_envelope', side_effect=read):
                    full = comparator.inspect_owned(fixture.temp.resolve(), fixture=True)
                policy, value = captured[-1]
                self.assertEqual(full['phase'], 'envelope')
                self.assertEqual(full['outcome'], 'refused')
                self.assertEqual(full['coverage']['enumeration'], 'full')
                for name in ('pass_a', 'pass_b'):
                    self.assertIn(child.pid, [row['pid'] for row in value['stages'][name]['included']])
                unknown = sum(len(value['stages'][name]['unknown']) for name in ('pass_a', 'pass_b'))
                print('native owned class full scan: refused at envelope; child in both passes; unknown_entries=%d reasons=%d' %
                      (unknown, len(full['envelope_reasons'])), flush=True)
        finally:
            child.stdin.close()
            try:
                child.wait(timeout=5)
            except subprocess.TimeoutExpired:
                child.kill(); child.wait()
            child.stdout.close(); child.stderr.close()


if __name__ == '__main__':
    unittest.main()
