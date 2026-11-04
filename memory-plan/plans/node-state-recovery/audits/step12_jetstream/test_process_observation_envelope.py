import contextlib
import copy
import hashlib
import io
import itertools
import json
import os
import pathlib
import secrets
import shutil
import subprocess
import sys
import tempfile
import unittest
from types import SimpleNamespace
from unittest.mock import Mock, patch

import process_observation_envelope as envelope
import preservation_journal
import restore_only
import test_boot_process_policy as policy_fixture
import test_capture_checkpoint as guest_fixture
import test_stopped_journal_inputs as image_fixture


BOOT = 'a' * 64


def owned(test):
    parent = pathlib.Path(os.environ.get('GITHUB_WORKSPACE', pathlib.Path.home())).resolve()
    tempdir = patch.object(tempfile, 'gettempdir', return_value=str(parent))
    tempdir.start()
    test.addCleanup(tempdir.stop)
    root = parent / ('openclaw-owned-envelope-' + secrets.token_hex(8))
    root.mkdir(mode=0o700)
    test.addCleanup(shutil.rmtree, root)
    (root / 'protected').mkdir(mode=0o700)
    return root


def raw(row):
    return {'boot': BOOT, 'enumeration': 'substituted', 'before': [row['pid']],
            'after': [row['pid']], 'processes': [copy.deepcopy(row)], 'unknown': [], 'unstable': []}


def prepared(test):
    root = owned(test)
    factory = policy_fixture.authored
    def authored(roots):
        roots[:] = [str(root / 'protected')]
        policy = factory(roots)
        policy['expected'][0]['attribution']['label'] = 'application.' + root.name
        return policy
    fixture_mask = os.umask(0o077)
    try:
        with patch.object(guest_fixture.tempfile, 'TemporaryDirectory',
                          return_value=SimpleNamespace(name=str(root), cleanup=lambda: None)), \
             patch.object(policy_fixture, 'authored', side_effect=authored):
            fixture = policy_fixture.captured(test, image=True)
    finally:
        os.umask(fixture_mask)
    return fixture


class Envelope(unittest.TestCase):
    def setUp(self):
        self.root = owned(self)
        self.binary = self.root / 'protected/program'
        self.binary.write_bytes(b'explicit owned program bytes')
        self.binary.chmod(0o700)
        self.plist = self.root / 'job.plist'
        self.plist.write_bytes(b'owned plist bytes')
        self.plist.chmod(0o600)
        self.row = {'pid': 411, 'ppid': 1, 'uid': os.getuid(), 'gid': os.getgid(),
                    'name': 'program', 'start_sec': 100, 'start_usec': 123,
                    'executable': str(self.binary), 'executable_sha256': hashlib.sha256(self.binary.read_bytes()).hexdigest(),
                    'arguments': [str(self.binary), 'private-argument-value', '', 'épreuve'], 'cwd': str(self.root)}
        self.policy = policy_fixture.authored([str(self.root / 'protected')])
        self.sample = raw(self.row)
        self.job = {'loaded': True, 'state': 'running', 'pid': self.row['pid'],
                    'program': str(self.binary), 'arguments': self.row['arguments'], 'plist': str(self.plist)}

    def collect(self, first=None, second=None, jobs=None, generation=None, clock=None):
        first = self.sample if first is None else first
        second = first if second is None else second
        job_options = {'return_value': {'loaded': False}} if jobs is None else {'side_effect': copy.deepcopy(jobs)}
        clock = itertools.count().__next__ if clock is None else clock
        with patch.object(envelope, 'boot_identity', return_value=BOOT), \
             patch.object(envelope.diagnostic, 'observe', side_effect=copy.deepcopy([first, second])) as observer, \
             patch.object(envelope.census, 'launchd_service', **job_options) as launchd, \
             patch.object(envelope.diagnostic.proc, 'bsd_info',
                          return_value=generation or envelope.generation(self.row)), \
             patch.object(envelope.time, 'monotonic_ns', side_effect=clock):
            result = envelope.collect_envelope(self.policy)
        return result, observer, launchd

    def check(self, result):
        return envelope.valid_envelope(result, self.policy)

    def test_complete_observation_is_not_class_matching_or_admission(self):
        result, observed, launchd = self.collect()
        self.assertEqual(result['outcome'], 'recorded')
        self.assertEqual(observed.call_count, 2)
        self.assertEqual(launchd.call_count, 2)
        self.assertEqual(result['stages']['pass_a']['included'][0]['pid'], self.row['pid'])
        self.assertNotEqual(self.policy['expected'][0]['executable'], self.row['executable'])
        self.assertFalse(result['admission'])
        self.assertFalse(result['history_certified'])
        self.assertNotIn('expected', result)
        self.assertNotIn('clean', result.values())

    def test_validator_is_pure_and_does_not_reobserve_scope_or_processes(self):
        value, _, _ = self.collect()
        with patch.object(envelope.diagnostic, 'in_scope', side_effect=AssertionError('scope IO')), \
             patch.object(envelope.diagnostic, 'observe', side_effect=AssertionError('process IO')), \
             patch.object(envelope.census, 'launchd_service', side_effect=AssertionError('launchd IO')), \
             patch.object(envelope, 'regular_content', side_effect=AssertionError('file IO')), \
             patch.object(pathlib.Path, 'resolve', side_effect=AssertionError('resolve IO')), \
             patch.object(pathlib.Path, 'stat', side_effect=AssertionError('stat IO')):
            result = self.check(value)
        self.assertEqual(result['outcome'], 'recorded')
        self.assertEqual(value['outcome'], 'recorded')

    def test_current_envelope_never_uses_a_baseline_boot_or_generation(self):
        self.policy['expected'] = []
        result, _, _ = self.collect(jobs=[])
        self.assertEqual(result['outcome'], 'recorded')
        self.assertEqual(result['stages']['boot_start'], BOOT)
        self.assertEqual(result['stages']['pass_b']['included'][0]['pid'], self.row['pid'])

    def test_every_raw_unknown_entry_survives_including_duplicates_and_global(self):
        failures = [{'pid': 411, 'field': 'arguments', 'error_type': 'Refused'},
                    {'pid': 411, 'field': 'sample-B:cwd', 'error_type': 'OSError'},
                    {'pid': None, 'field': 'boot-after', 'error_type': 'Refused'}]
        sample = {**self.sample, 'unknown': failures}
        result, _, _ = self.collect(sample)
        for name in ('pass_a', 'pass_b'):
            self.assertEqual(result['stages'][name]['unknown'], failures, 'every unknown entry must survive')
        self.assertEqual(result['outcome'], 'refused')

    def test_inner_boot_failure_keeps_unknown_and_reaches_existing_compare(self):
        failed = {'boot': None, 'enumeration': 'substituted', 'before': [], 'after': [],
                  'processes': [], 'unknown': [{'pid': None, 'field': 'boot-before', 'error_type': 'OSError'}],
                  'unstable': []}
        result, _, _ = self.collect(failed, self.sample)
        self.assertEqual(result['outcome'], 'refused')
        self.assertIsNone(result['stages']['pass_a']['boot'])
        self.assertIsNotNone(result['stages']['scope_a'], 'inner boot failure must reach existing compare')
        self.assertEqual(result['stages']['pass_a']['unknown'], failed['unknown'])
        self.assertEqual(result['failures'], [])

    def test_outer_boot_failure_stops_before_process_collection(self):
        with patch.object(envelope, 'boot_identity', side_effect=OSError('owned boot error')), \
             patch.object(envelope.diagnostic, 'observe') as observe:
            result = envelope.collect_envelope(self.policy)
        observe.assert_not_called()
        self.assertEqual(result['outcome'], 'refused')
        self.assertEqual(result['failures'], [{'stage': 'boot_start', 'error_type': 'OSError'}])
        self.assertTrue(all(stage is None for stage in result['stages'].values()))

    def test_outer_and_each_pass_boot_mismatch_refuse(self):
        result, _, _ = self.collect()
        for key in ('boot_start', 'boot_end', 'pass_a', 'pass_b'):
            forged = copy.deepcopy(result)
            if key.startswith('pass'):
                forged['stages'][key]['boot'] = 'b' * 64
            else:
                forged['stages'][key] = 'b' * 64
            with self.subTest(key=key):
                self.assertEqual(self.check(forged)['outcome'], 'refused')

    def other_uid(self):
        return {**self.row, 'uid': self.row['uid'] + 1, 'executable': str(self.root / 'outside'),
                'cwd': str(self.root), 'arguments': [str(self.root / 'outside')]}

    def test_scope_composes_existing_helper_and_whole_argv_resolution(self):
        alias = self.root / 'alias with spaces;private'
        alias.symlink_to(self.root / 'protected', target_is_directory=True)
        row = {**self.other_uid(), 'arguments': [str(self.root / 'outside'), str(alias / 'program')]}
        original = envelope.diagnostic.in_scope
        with patch.object(envelope.diagnostic, 'in_scope', wraps=original) as scoped:
            result, _, _ = self.collect(raw(row))
        self.assertEqual(result['outcome'], 'recorded')
        self.assertEqual([item['pid'] for item in result['stages']['pass_a']['included']], [row['pid']],
                         'root-scoped other-UID row must be included')
        self.assertEqual(scoped.call_count, 2, 'both scope stages must call the existing helper')
        self.assertEqual(scoped.call_args.args[1:], (self.policy['uid'], self.policy['roots']))

    def test_executable_and_cwd_root_scope_are_independent(self):
        for changed in ({'executable': str(self.binary)}, {'cwd': str(self.root / 'protected')}):
            row = {**self.other_uid(), **changed}
            with self.subTest(changed=changed):
                result, _, _ = self.collect(raw(row))
                self.assertEqual(result['outcome'], 'recorded')
                self.assertEqual(len(result['stages']['pass_a']['included']), 1)

    def test_scope_errors_remain_unknown_even_for_other_uid(self):
        row = {**self.other_uid(), 'arguments': ['$UNOBSERVABLE/path']}
        result, _, _ = self.collect(raw(row))
        self.assertEqual(result['outcome'], 'refused')
        self.assertEqual(result['stages']['pass_a']['unknown'],
                         [{'pid': row['pid'], 'field': 'scope', 'error_type': 'Refused'}])

    def test_excluded_rows_retain_generation_and_full_row_fingerprint(self):
        row = self.other_uid()
        result, _, _ = self.collect(raw(row))
        self.assertEqual(result['outcome'], 'recorded')
        excluded = result['stages']['pass_a']['excluded']
        self.assertEqual(excluded, [{**envelope.generation(row),
                                    'row_sha256': envelope.fingerprint(envelope.diagnostic.redacted(row))}])
        self.assertNotIn(str(self.root / 'outside'), envelope.encoded(result).decode())

    def test_excluded_code_argv_cwd_ppid_changes_between_passes_refuse(self):
        row = self.other_uid()
        for changed in ({'executable': str(self.root / 'another')}, {'executable_sha256': 'd' * 64},
                        {'arguments': ['another-outside-argument']}, {'cwd': str(self.root.parent)},
                        {'ppid': row['ppid'] + 1}):
            with self.subTest(changed=changed):
                result, _, _ = self.collect(raw(row), raw({**row, **changed}))
                self.assertEqual(result['outcome'], 'refused', 'excluded full-row change must refuse')

    def test_included_row_change_and_scope_disagreement_refuse(self):
        result, _, _ = self.collect(second=raw({**self.row, 'arguments': ['changed']}))
        self.assertEqual(result['outcome'], 'refused')
        row = self.other_uid()
        with patch.object(envelope.diagnostic, 'in_scope', side_effect=[False, True]):
            result, _, _ = self.collect(raw(row))
        self.assertEqual(result['outcome'], 'refused')

    def test_same_uid_cannot_be_excluded_by_serialized_facts(self):
        result, _, _ = self.collect()
        for name in ('pass_a', 'pass_b'):
            stage = result['stages'][name]
            stage['included'] = []
            stage['excluded'] = [{**envelope.generation(self.row), 'row_sha256': 'd' * 64}]
        self.assertEqual(self.check(result)['outcome'], 'refused')

    def test_stability_unknown_and_coverage_cannot_be_asserted_by_stored_verdict(self):
        original, _, _ = self.collect()
        for name, change in (
                ('unstable', lambda s: s['stages']['pass_a']['unstable'].append(411)),
                ('unknown', lambda s: s['stages']['pass_a']['unknown'].append(
                    {'pid': 411, 'field': 'identity', 'error_type': 'OSError'})),
                ('coverage', lambda s: s['stages']['pass_b']['included'].clear()),
                ('sample', lambda s: s['stages']['pass_b']['after'].append(412))):
            value = copy.deepcopy(original)
            change(value)
            value.update(outcome='recorded', reasons=[])
            with self.subTest(name=name):
                self.assertEqual(self.check(value)['outcome'], 'refused')

    def test_missing_rows_in_both_passes_still_refuse_coverage(self):
        value, _, _ = self.collect()
        value['stages']['pass_a']['included'].clear()
        value['stages']['pass_b']['included'].clear()
        self.assertEqual(self.check(value)['outcome'], 'refused')

    def test_within_pass_samples_must_agree_even_when_union_and_rows_agree(self):
        second = {**self.row, 'pid': 412}
        sample = {**self.sample, 'before': [411, 412], 'after': [411, 412],
                  'processes': [self.row, second]}
        value, _, _ = self.collect(sample)
        for name in ('pass_a', 'pass_b'):
            value['stages'][name]['before'] = [411]
        self.assertEqual(self.check(value)['outcome'], 'refused', 'all four PID samples must agree')

    def test_expiry_claim_must_match_elapsed_time(self):
        value, _, _ = self.collect()
        for elapsed, expired in ((envelope.WINDOW_NS + 1, False),
                                 (value['budget']['elapsed_ns'], True)):
            forged = copy.deepcopy(value)
            forged['budget'].update(elapsed_ns=elapsed, expired=expired)
            with self.subTest(elapsed=elapsed, expired=expired), \
                 self.assertRaisesRegex(envelope.Refused, 'expiry claim'):
                self.check(forged)

    def test_binding_uid_rejects_boolean_aliases_for_zero_and_one(self):
        for uid, alias in ((0, False), (1, True)):
            self.policy['uid'] = uid
            self.policy['expected'][0]['uid'] = uid
            self.row['uid'] = uid
            self.sample = raw(self.row)
            value, _, _ = self.collect()
            value['policy_binding']['uid'] = alias
            for name in ('scope_a', 'scope_b'):
                value['stages'][name]['expectations_sha256'] = envelope.fingerprint(
                    envelope.expectations(value['policy_binding'], BOOT))
            with self.subTest(uid=uid), self.assertRaisesRegex(envelope.Refused, 'integer'):
                self.check(value)

    def test_exact_schema_rejects_raw_arguments_and_embedded_old_verdicts(self):
        result, _, _ = self.collect()
        for target in ((), ('stages',), ('stages', 'pass_a'), ('stages', 'scope_a'),
                       ('budget',), ('coverage',), ('policy_binding',)):
            value = copy.deepcopy(result)
            node = value
            for key in target:
                node = node[key]
            node['extra'] = True
            with self.subTest(target=target), self.assertRaises(envelope.Refused):
                self.check(value)
        for key in ('outcome', 'admission', 'history_certified', 'matched', 'missing', 'arguments'):
            value = copy.deepcopy(result)
            value['stages']['pass_a'][key] = []
            with self.subTest(key=key), self.assertRaises(envelope.Refused):
                self.check(value)
        value = copy.deepcopy(result)
        value['stages']['pass_a']['included'][0]['arguments'] = ['private-argument-value']
        with self.assertRaises(envelope.Refused):
            self.check(value)

    def test_missing_fields_malformed_samples_rows_and_unknowns_refuse(self):
        result, _, _ = self.collect()
        for key in result:
            with self.subTest(missing=key), self.assertRaises(envelope.Refused):
                self.check({k: v for k, v in result.items() if k != key})
        mutations = [lambda x: x['stages']['pass_a']['before'].append(411),
                     lambda x: x['stages']['pass_a']['included'].append(copy.deepcopy(x['stages']['pass_a']['included'][0])),
                     lambda x: x['stages']['pass_a']['included'][0].update(uid=True),
                     lambda x: x['stages']['pass_a']['included'][0].update(arguments_sha256='wrong'),
                     lambda x: x['stages']['pass_a']['unknown'].append({'pid': True, 'field': 'x', 'error_type': 'x'})]
        for mutate in mutations:
            value = copy.deepcopy(result)
            mutate(value)
            with self.subTest(mutate=mutate), self.assertRaises(envelope.Refused):
                self.check(value)

    def test_policy_and_each_scope_binding_refuse_independently(self):
        result, _, _ = self.collect()
        for key, invalid in (('policy_sha256', 'd' * 64), ('uid', os.getuid() + 1), ('roots', ['/'])):
            value = copy.deepcopy(result)
            value['policy_binding'][key] = invalid
            with self.subTest(key=key), self.assertRaisesRegex(envelope.Refused, 'policy binding'):
                self.check(value)
        for name in ('scope_a', 'scope_b'):
            value = copy.deepcopy(result)
            value['stages'][name]['expectations_sha256'] = 'd' * 64
            with self.subTest(name=name):
                self.assertEqual(self.check(value)['outcome'], 'refused')

    def test_scope_errors_and_interval_order_refuse(self):
        result, _, _ = self.collect()
        value = copy.deepcopy(result)
        value['stages']['scope_a']['errors'] = ['scripted scope failure']
        self.assertEqual(self.check(value)['outcome'], 'refused')
        value = copy.deepcopy(result)
        value['stages']['scope_b']['monotonic_ns']['start'] = 0
        self.assertEqual(self.check(value)['outcome'], 'refused')

    def test_unloaded_and_idle_are_known_negatives_with_two_reads(self):
        for job in ({'loaded': False}, {**self.job, 'state': 'waiting', 'pid': None}):
            with self.subTest(job=job):
                result, _, launchd = self.collect(jobs=[job, job])
                anchor = next(iter(result['stages']['anchors'].values()))
                self.assertEqual(result['outcome'], 'recorded')
                self.assertEqual(launchd.call_count, 2, 'every negative anchor needs J1')
                self.assertEqual(anchor['j0'], anchor['j1'])
                self.assertIsNone(anchor['generation'])
                self.assertIsNone(anchor['plist'])

    def test_running_anchor_preserves_both_reads_generation_and_plist_identities(self):
        result, _, _ = self.collect(jobs=[self.job, self.job])
        self.assertEqual(result['outcome'], 'recorded')
        anchor = next(iter(result['stages']['anchors'].values()))
        self.assertEqual(anchor['generation'], envelope.generation(self.row))
        self.assertEqual(anchor['plist']['before'], anchor['plist']['after'])
        self.assertEqual(anchor['plist']['sha256'], hashlib.sha256(self.plist.read_bytes()).hexdigest())
        self.assertEqual(anchor['j0'], envelope.redacted_job(self.job))
        self.assertEqual(anchor['j1'], envelope.redacted_job(self.job))

    def test_nonrunning_job_with_pid_still_reads_generation_and_plist(self):
        job = {**self.job, 'state': 'waiting'}
        result, _, _ = self.collect(jobs=[job, job])
        self.assertEqual(result['outcome'], 'recorded')
        anchor = next(iter(result['stages']['anchors'].values()))
        self.assertEqual(anchor['generation'], envelope.generation(self.row))
        self.assertIsNotNone(anchor['plist'])

    def test_launchd_bracket_generation_and_plist_changes_refuse_independently(self):
        for changed in ({'arguments': ['changed-job-argument']}, {'pid': 412}, {'state': 'waiting'},
                        {'program': str(self.root / 'different')}):
            result, _, _ = self.collect(jobs=[self.job, {**self.job, **changed}])
            self.assertEqual(result['outcome'], 'refused')
        for key in ('pid', 'uid', 'start_sec', 'start_usec'):
            changed = envelope.generation(self.row)
            changed[key] += 1
            result, _, _ = self.collect(jobs=[self.job, self.job], generation=changed)
            with self.subTest(key=key):
                self.assertEqual(result['outcome'], 'refused')
        original = envelope.file_identity(self.plist)
        with patch.object(envelope, 'file_identity', side_effect=[original, {**original, 'inode': original['inode'] + 1}]):
            result, _, _ = self.collect(jobs=[self.job, self.job])
        self.assertEqual(result['outcome'], 'refused')

    def test_anchor_pid_requires_a_row_in_both_passes_not_only_unknown(self):
        sample = {**self.sample, 'processes': [], 'unknown': [
            {'pid': 411, 'field': 'identity', 'error_type': 'OSError'}]}
        result, _, _ = self.collect(sample, jobs=[self.job, self.job])
        self.assertEqual(result['outcome'], 'refused')
        self.assertTrue(any('generation not bound' in reason for reason in result['reasons']))

    def test_anchor_coverage_and_error_markers_are_independent(self):
        result, _, _ = self.collect(jobs=[self.job, self.job])
        value = copy.deepcopy(result)
        value['stages']['anchors'].clear()
        self.assertEqual(self.check(value)['outcome'], 'refused')
        value = copy.deepcopy(result)
        next(iter(value['stages']['anchors'].values()))['error'] = {'stage': 'j1', 'error_type': 'TimeoutExpired'}
        self.assertEqual(self.check(value)['outcome'], 'refused')
        value, _, _ = self.collect()
        next(iter(value['stages']['anchors'].values()))['generation'] = envelope.generation(self.row)
        self.assertEqual(self.check(value)['outcome'], 'refused')

    def test_anchor_generation_can_bind_an_excluded_row(self):
        row = self.other_uid()
        result, _, _ = self.collect(raw(row), jobs=[self.job, self.job], generation=envelope.generation(row))
        self.assertEqual(result['outcome'], 'recorded')
        self.assertEqual(result['stages']['pass_a']['excluded'][0]['pid'], row['pid'])

    def test_anchor_errors_are_facts_and_never_escape(self):
        for error in (OSError('owned'), envelope.census.Refused('owned'), envelope.Refused('owned'),
                      subprocess.TimeoutExpired('owned', 10)):
            with self.subTest(error=type(error).__name__):
                result, _, _ = self.collect(jobs=[error])
                self.assertEqual(result['outcome'], 'refused')
                self.assertEqual(len(result['stages']['anchors']), 1, 'anchor failures must remain anchor facts')
                anchor = next(iter(result['stages']['anchors'].values()))
                self.assertEqual(anchor['error'], {'stage': 'j0', 'error_type': type(error).__name__})
        for stage, target in (('generation', 'generation'), ('plist', 'plist'), ('j1', 'j1')):
            with self.subTest(stage=stage):
                if target == 'generation':
                    with patch.object(envelope.census, 'launchd_service', return_value=self.job), \
                         patch.object(envelope.diagnostic.proc, 'bsd_info', side_effect=OSError('owned')):
                        anchor = self.anchor()
                elif target == 'plist':
                    with patch.object(envelope.census, 'launchd_service', return_value=self.job), \
                         patch.object(envelope.diagnostic.proc, 'bsd_info', return_value=envelope.generation(self.row)), \
                         patch.object(envelope, 'regular_content', side_effect=OSError('owned')):
                        anchor = self.anchor()
                else:
                    with patch.object(envelope.census, 'launchd_service', side_effect=[{'loaded': False}, OSError('owned')]):
                        anchor = self.anchor()
                self.assertEqual(anchor['error']['stage'], stage)

    def anchor(self):
        try:
            return envelope.collect_anchor('gui/501', 'owned')
        except envelope.ERRORS:
            self.fail('anchor errors must be facts, not escaping exceptions')

    def test_namespace_uses_policy_owner_not_process_uid(self):
        row = {**self.row, 'uid': os.getuid() + 1}
        self.policy['expected'][0].update(uid=row['uid'], executable=str(self.binary))
        result, _, calls = self.collect(raw(row), jobs=[self.job, self.job], generation=envelope.generation(row))
        self.assertEqual(result['outcome'], 'recorded')
        self.assertEqual([call.args[0] for call in calls.call_args_list], ['gui/%d' % os.getuid()] * 2)
        for domain in ('user', 'system'):
            self.policy['expected'][0]['attribution']['domain'] = domain
            _, _, calls = self.collect()
            namespace = domain if domain == 'system' else 'user/%d' % os.getuid()
            self.assertEqual([call.args[0] for call in calls.call_args_list], [namespace] * 2)

    def test_anchor_pairs_are_deduplicated_without_choosing_authored_hash(self):
        row = copy.deepcopy(self.policy['expected'][0])
        row.update(label='second', arguments=['second'])
        row['attribution']['plist_sha256'] = 'd' * 64
        self.policy['expected'].append(row)
        result, _, calls = self.collect()
        self.assertEqual(result['outcome'], 'recorded')
        self.assertEqual(len(result['policy_binding']['anchors']), 1)
        self.assertEqual(len(result['policy_binding']['anchors'][0]), 2)
        self.assertEqual(calls.call_count, 2)

    def test_anchor_cap_refuses_before_any_boot_or_process_io(self):
        base = self.policy['expected'][0]
        self.policy['expected'] = []
        for index in range(17):
            row = copy.deepcopy(base)
            row.update(label='controller%d' % index, arguments=['controller%d' % index])
            row['attribution']['label'] = 'application.controller%d' % index
            self.policy['expected'].append(row)
        with patch.object(envelope, 'boot_identity', return_value=BOOT) as boot, \
             patch.object(envelope.diagnostic, 'observe', return_value=self.sample) as observe, \
             patch.object(envelope.census, 'launchd_service', return_value={'loaded': False}) as launchd:
            result = envelope.collect_envelope(self.policy)
        boot.assert_not_called()
        observe.assert_not_called()
        launchd.assert_not_called()
        self.assertEqual(result['outcome'], 'refused')

    def test_budget_expiry_stops_further_collection_and_retains_partial_facts(self):
        clock = itertools.chain([0], itertools.repeat(envelope.WINDOW_NS + 1)).__next__
        result, observe, launchd = self.collect(clock=clock)
        observe.assert_not_called()
        launchd.assert_not_called()
        self.assertEqual(result['outcome'], 'refused')
        self.assertIsNotNone(result['stages']['boot_start'])
        self.assertIsNone(result['stages']['pass_a'])
        self.assertTrue(result['budget']['expired'])

    def test_acceptance_budget_and_anchor_cap_are_fixed_contract_values(self):
        self.assertEqual(envelope.WINDOW_NS, 120_000_000_000)
        self.assertEqual(envelope.ANCHOR_CAP, 16)
        result, _, _ = self.collect()
        self.assertEqual(result['budget']['limit_ns'], 120_000_000_000)
        self.assertEqual(result['budget']['anchor_cap'], 16)

    def test_final_acceptance_window_boundary_is_checked_after_completed_stages(self):
        for delta, outcome in ((0, 'recorded'), (1, 'refused')):
            calls = [0, 0]
            def boot():
                calls[0] += 1
                return BOOT
            def clock():
                if calls[0] == 2:
                    calls[1] += 1
                    if calls[1] >= 2:
                        return envelope.WINDOW_NS + delta
                return 0
            with patch.object(envelope, 'boot_identity', side_effect=boot), \
                 patch.object(envelope.diagnostic, 'observe', return_value=self.sample), \
                 patch.object(envelope.census, 'launchd_service', return_value={'loaded': False}), \
                 patch.object(envelope.time, 'monotonic_ns', side_effect=clock):
                result = envelope.collect_envelope(self.policy)
            with self.subTest(delta=delta):
                self.assertEqual(result['outcome'], outcome, 'final acceptance timestamp must be checked')
                self.assertTrue(all(stage is not None for stage in result['stages'].values()))

    def test_expired_and_partial_serialized_envelopes_cannot_claim_recorded(self):
        value, _, _ = self.collect()
        expired = copy.deepcopy(value)
        expired['budget'].update(elapsed_ns=envelope.WINDOW_NS + 1, expired=True)
        self.assertEqual(self.check(expired)['outcome'], 'refused')
        for name in envelope.STAGES:
            partial = copy.deepcopy(value)
            partial['stages'][name] = None
            with self.subTest(name=name):
                self.assertEqual(self.check(partial)['outcome'], 'refused')
        for invalid in (True, -1, 1.5):
            bad = copy.deepcopy(value)
            bad['budget']['elapsed_ns'] = invalid
            with self.assertRaises(envelope.Refused):
                self.check(bad)

    def test_collector_order_and_two_scope_stages_are_explicit(self):
        events = []
        def observe():
            events.append('observe')
            return copy.deepcopy(self.sample)
        original = envelope.diagnostic.in_scope
        def scoped(*args):
            events.append('scope')
            return original(*args)
        def job(*args):
            events.append('job')
            return self.job
        original_identity = envelope.file_identity
        original_content = envelope.regular_content
        with patch.object(envelope, 'boot_identity', side_effect=lambda: events.append('boot') or BOOT), \
             patch.object(envelope.diagnostic, 'observe', side_effect=observe), \
             patch.object(envelope.diagnostic, 'in_scope', side_effect=scoped), \
             patch.object(envelope.census, 'launchd_service', side_effect=job), \
             patch.object(envelope.diagnostic.proc, 'bsd_info',
                          side_effect=lambda _: events.append('generation') or envelope.generation(self.row)), \
             patch.object(envelope, 'file_identity', side_effect=lambda path: events.append('identity') or original_identity(path)), \
             patch.object(envelope, 'regular_content', side_effect=lambda *args: events.append('hash') or original_content(*args)):
            result = envelope.collect_envelope(self.policy)
        self.assertEqual(result['outcome'], 'recorded')
        self.assertEqual(events, ['boot', 'observe', 'scope', 'job', 'generation', 'identity', 'hash', 'identity',
                                  'job', 'observe', 'scope', 'boot'])

    def test_process_and_launchd_arguments_are_both_redacted(self):
        result, _, _ = self.collect(jobs=[self.job, self.job])
        text = envelope.encoded(result).decode()
        self.assertNotIn('private-argument-value', text)
        self.assertNotIn('"arguments":', text)
        self.assertEqual(result['stages']['pass_a']['included'][0]['arguments_sha256'],
                         hashlib.sha256(b'\0'.join(arg.encode() for arg in self.row['arguments'])).hexdigest())

    def test_enumeration_labels_are_never_promoted(self):
        result, _, _ = self.collect()
        self.assertEqual(result['coverage']['enumeration'], 'substituted')
        changed = copy.deepcopy(result)
        changed['stages']['pass_b']['enumeration'] = 'full'
        self.assertEqual(self.check(changed)['outcome'], 'refused')
        for key in ('admission', 'history_certified'):
            forged = copy.deepcopy(result)
            forged[key] = True
            with self.assertRaises(envelope.Refused):
                self.check(forged)
        forged = copy.deepcopy(result)
        forged['coverage']['physical_exclusion'] = True
        with self.assertRaises(envelope.Refused):
            self.check(forged)


class Consumer(unittest.TestCase):
    def test_prepared_fixture_is_private_and_restores_permissive_umask(self):
        caller_mask = os.umask(0o022)
        try:
            fixture = prepared(self)
            self.assertEqual(os.umask(0o022), 0o022)
            self.assertEqual((fixture.temp / 'data').stat().st_mode & 0o777, 0o700)
            with patch.object(envelope, 'collect_envelope', return_value={}) as collect:
                self.assertEqual(envelope.inspect_owned(fixture.temp.resolve(), fixture=True), {})
            collect.assert_called_once()
        finally:
            os.umask(caller_mask)

    def test_fixture_flag_precedes_all_path_and_process_access(self):
        with patch.object(envelope.pathlib, 'Path', side_effect=AssertionError('path access')), \
             patch.object(envelope, 'image_process_policy', side_effect=AssertionError('frozen access')), \
             patch.object(envelope, 'collect_envelope', side_effect=AssertionError('process access')):
            with self.assertRaisesRegex(envelope.Refused, 'production process'):
                envelope.inspect_owned('/production')

    def test_honest_prepared_fixture_is_read_without_construction_or_writes(self):
        fixture = prepared(self)
        expected = envelope.binding(fixture.policy)
        before = image_fixture.snapshot(fixture.temp)
        with patch.object(envelope, 'collect_envelope', return_value={'binding': expected}) as collect, \
             patch.object(preservation_journal.Journal, '__init__', side_effect=AssertionError('Journal construction')), \
             patch.object(restore_only.gate_module.Gate, '__init__', side_effect=AssertionError('Gate construction')):
            result = envelope.inspect_owned(fixture.temp.resolve(), fixture=True)
        self.assertEqual(result, {'binding': expected})
        self.assertEqual(collect.call_args.args, (fixture.policy,))
        self.assertEqual(image_fixture.snapshot(fixture.temp), before)

    def test_viable_prepared_fixture_still_requires_flag(self):
        fixture = prepared(self)
        with patch.object(envelope, 'collect_envelope', return_value={}) as collect, \
             self.assertRaisesRegex(envelope.Refused, 'production process'):
            envelope.inspect_owned(fixture.temp.resolve())
        collect.assert_not_called()

    def test_root_and_each_fixed_input_fence_precede_reader_and_collection(self):
        fixture = prepared(self)
        root = fixture.temp.resolve()
        path = root / 'envelope.json'
        path.write_bytes(envelope.encoded({}))
        path.chmod(0o600)
        for path, mode in ((root, 0o755), (root / 'capture', 0o755), (root / 'data', 0o755),
                           (root / 'envelope.json', 0o644)):
            old = path.stat().st_mode & 0o777
            path.chmod(mode)
            with self.subTest(path=path), patch.object(envelope, 'image_process_policy') as reader, \
                 patch.object(envelope, 'collect_envelope') as collect, self.assertRaises(envelope.Refused):
                envelope.inspect_owned(root, fixture=True, scripted=True)
            reader.assert_not_called()
            collect.assert_not_called()
            path.chmod(old)
        alias = root.parent / ('openclaw-owned-envelope-' + secrets.token_hex(8))
        alias.symlink_to(root, target_is_directory=True)
        self.addCleanup(alias.unlink)
        with patch.object(envelope, 'collect_envelope', return_value={}), self.assertRaises(envelope.Refused):
            envelope.inspect_owned(alias, fixture=True)

    def test_viable_private_fixture_with_wrong_name_refuses_before_reader(self):
        holder = tempfile.TemporaryDirectory(prefix='openclaw-wrong-envelope-')
        self.addCleanup(holder.cleanup)
        root = pathlib.Path(holder.name).resolve()
        for name in ('capture', 'data', 'protected'):
            (root / name).mkdir(mode=0o700)
        path = root / 'table.json'
        path.write_bytes(envelope.encoded({}))
        path.chmod(0o600)
        policy = policy_fixture.authored([str(root / 'protected')])
        with patch.object(envelope, 'image_process_policy', return_value={'process_policy': policy}) as reader, \
             patch.object(envelope, 'collect_envelope', return_value={}), \
             self.assertRaisesRegex(envelope.Refused, 'owned fixture root'):
            envelope.inspect_owned(root, fixture=True)
        reader.assert_not_called()

    def test_canonical_private_single_link_envelope_is_required(self):
        fixture = prepared(self)
        root = fixture.temp.resolve()
        path = root / 'envelope.json'
        for raw_bytes in (b'{}\n', b' {}'):
            path.write_bytes(raw_bytes)
            path.chmod(0o600)
            with patch.object(envelope, 'image_process_policy') as reader, self.assertRaises(envelope.Refused):
                envelope.inspect_owned(root, fixture=True, scripted=True)
            reader.assert_not_called()
        path.write_bytes(envelope.encoded({}))
        os.link(path, root / 'envelope-link')
        with self.assertRaisesRegex(envelope.Refused, 'not owner-private'):
            envelope.read_private(path)

    def test_private_reader_byte_bound_and_read_identity_are_independent(self):
        root = owned(self)
        path = root / 'bounded.json'
        value = {'padding': ''}
        overhead = len(envelope.encoded(value))
        value['padding'] = 'x' * (envelope.FILE_LIMIT - overhead)
        path.write_bytes(envelope.encoded(value))
        path.chmod(0o600)
        self.assertEqual(len(path.read_bytes()), envelope.FILE_LIMIT)
        self.assertEqual(envelope.read_private(path), value)
        value['padding'] += 'x'
        path.write_bytes(envelope.encoded(value))
        with self.assertRaisesRegex(envelope.Refused, 'bounded regular file'):
            envelope.read_private(path)
        path.write_bytes(envelope.encoded({}))
        original = envelope.regular_content
        def swapped(*args, **kwargs):
            raw_bytes = original(*args, **kwargs)
            path.unlink()
            path.write_bytes(raw_bytes)
            path.chmod(0o600)
            return raw_bytes
        with patch.object(envelope, 'regular_content', side_effect=swapped), \
             self.assertRaisesRegex(envelope.Refused, 'changed while read'):
            envelope.read_private(path)

    def test_invalid_checkpoint_refuses_before_process_collection(self):
        fixture = prepared(self)
        (fixture.capture / 'CHECKPOINT.json').write_bytes(b'{}')
        with patch.object(envelope, 'collect_envelope') as collect, self.assertRaises(RuntimeError):
            envelope.inspect_owned(fixture.temp.resolve(), fixture=True)
        collect.assert_not_called()

    def test_policy_owner_and_roots_are_separate_owned_consumer_observations(self):
        fixture = prepared(self)
        outside = owned(self)
        for changes in ({'uid': os.getuid() + 1}, {'roots': ['/']}, {'roots': [str(outside)]},
                        {'roots': [str(fixture.temp / 'absent')]}):
            policy = {**fixture.policy, **changes}
            with self.subTest(changes=changes), patch.object(envelope, 'image_process_policy',
                    return_value={'process_policy': policy}), patch.object(envelope, 'collect_envelope') as collect:
                with self.assertRaises((RuntimeError, OSError)):
                    envelope.inspect_owned(fixture.temp.resolve(), fixture=True)
                collect.assert_not_called()
        alias = fixture.temp.resolve() / 'alias'
        alias.symlink_to(fixture.temp.resolve() / 'protected', target_is_directory=True)
        with patch.object(envelope, 'image_process_policy', return_value={
                'process_policy': {**fixture.policy, 'roots': [str(alias)]}}), \
             patch.object(envelope, 'collect_envelope'), self.assertRaises(envelope.Refused):
            envelope.inspect_owned(fixture.temp.resolve(), fixture=True)

    def scripted(self):
        fixture = prepared(self)
        sample = {'boot': BOOT, 'enumeration': 'full', 'before': [], 'after': [],
                  'processes': [], 'unknown': [], 'unstable': []}
        with patch.object(envelope, 'boot_identity', return_value=BOOT), \
             patch.object(envelope.diagnostic, 'observe', return_value=sample), \
             patch.object(envelope.census, 'launchd_service', return_value={'loaded': False}):
            value = envelope.collect_envelope(fixture.policy)
        path = fixture.temp / 'envelope.json'
        path.write_bytes(envelope.encoded(value))
        path.chmod(0o600)
        return fixture, value, path

    def test_scripted_file_cannot_claim_observed_or_full(self):
        fixture, value, path = self.scripted()
        before = image_fixture.snapshot(fixture.temp)
        with patch.object(envelope.diagnostic, 'observe', side_effect=AssertionError('live collection')), \
             patch.object(envelope.census, 'launchd_service', side_effect=AssertionError('live launchd')):
            result = envelope.inspect_owned(fixture.temp.resolve(), fixture=True, scripted=True)
        self.assertEqual(result['outcome'], 'recorded')
        self.assertEqual(result['source'], 'scripted')
        self.assertEqual(result['coverage']['enumeration'], 'scripted')
        self.assertEqual(result['coverage']['attribution'], 'scripted')
        self.assertEqual(result['sample_labels'], {'source': 'observed', 'enumeration': 'full', 'attribution': 'observed'})
        self.assertEqual(image_fixture.snapshot(fixture.temp), before)
        self.assertEqual(path.read_bytes(), envelope.encoded(value))

    def test_scripted_file_is_bound_private_canonical_and_schema_checked(self):
        fixture, value, path = self.scripted()
        invalid = copy.deepcopy(value)
        invalid['policy_binding']['policy_sha256'] = 'd' * 64
        for candidate in (invalid, {k: v for k, v in value.items() if k != 'source'}, {'scope': envelope.SCOPE}):
            path.write_bytes(envelope.encoded(candidate))
            with self.assertRaises(envelope.Refused):
                envelope.inspect_owned(fixture.temp.resolve(), fixture=True, scripted=True)
        path.write_bytes(json.dumps(value).encode())
        with self.assertRaises(envelope.Refused):
            envelope.inspect_owned(fixture.temp.resolve(), fixture=True, scripted=True)
        path.write_bytes(envelope.encoded(value))
        path.chmod(0o644)
        with self.assertRaises(envelope.Refused):
            envelope.inspect_owned(fixture.temp.resolve(), fixture=True, scripted=True)

    def test_cli_prints_diagnostic_and_correct_exit_without_writes(self):
        fixture, _, _ = self.scripted()
        before = image_fixture.snapshot(fixture.temp)
        with patch.object(sys, 'argv', [envelope.__file__, str(fixture.temp.resolve()), '--fixture', '--scripted']), \
             contextlib.redirect_stdout(io.StringIO()) as output:
            self.assertEqual(envelope.main(), 0)
        result = json.loads(output.getvalue())
        self.assertFalse(result['admission'])
        self.assertEqual(result['source'], 'scripted')
        self.assertEqual(image_fixture.snapshot(fixture.temp), before)
        completed = subprocess.run([sys.executable, envelope.__file__, str(fixture.temp)],
                                   text=True, capture_output=True, timeout=15)
        self.assertEqual(completed.returncode, 2)
        self.assertEqual(json.loads(completed.stdout)['outcome'], 'refused')

    @unittest.skipUnless(sys.platform == 'darwin', 'owned libproc observation requires macOS')
    def test_native_owned_child_and_ci_full_runner_are_observations_only(self):
        fixture = prepared(self)
        binary = fixture.temp.resolve() / 'protected/owned-child'
        subprocess.run(['/usr/bin/clang', '-x', 'c', '-o', str(binary), '-'],
                       input='#include <stdio.h>\nint main(void) { puts("ready"); fflush(stdout); getchar(); return 0; }\n',
                       text=True, capture_output=True, check=True, timeout=30)
        arguments = [str(binary), 'native-private-argument', '', 'épreuve']
        child = subprocess.Popen(arguments, cwd=binary.parent, stdin=subprocess.PIPE,
                                 stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        try:
            self.assertEqual(child.stdout.readline().strip(), 'ready')
            before = image_fixture.snapshot(fixture.temp)
            with patch.object(envelope.diagnostic.proc, 'list_pids', return_value=[child.pid]) as listed:
                result = envelope.inspect_owned(fixture.temp.resolve(), fixture=True)
            self.assertEqual(listed.call_count, 4, 'one envelope needs four PID lists')
            self.assertEqual(result['coverage']['enumeration'], 'substituted')
            for name in ('pass_a', 'pass_b'):
                rows = result['stages'][name]['included']
                self.assertEqual([row['pid'] for row in rows], [child.pid])
                self.assertEqual(rows[0]['ppid'], os.getpid())
                self.assertEqual(rows[0]['executable'], str(binary))
                self.assertEqual(rows[0]['arguments_sha256'], hashlib.sha256(b'\0'.join(arg.encode() for arg in arguments)).hexdigest())
            self.assertFalse(result['admission'])
            self.assertNotIn('native-private-argument', envelope.encoded(result).decode())
            self.assertEqual(image_fixture.snapshot(fixture.temp), before)
            if os.environ.get('GITHUB_ACTIONS') == 'true':
                full = envelope.inspect_owned(fixture.temp.resolve(), fixture=True)
                self.assertEqual(full['outcome'], 'refused')
                self.assertEqual(full['coverage']['enumeration'], 'full')
                self.assertIn(child.pid, [row['pid'] for row in full['stages']['pass_a']['included']])
                self.assertIn(child.pid, [row['pid'] for row in full['stages']['pass_b']['included']])
                unknown = sum(len(full['stages'][name]['unknown']) for name in ('pass_a', 'pass_b'))
                print('native owned envelope full scan: refused; child in both passes; unknown_entries=%d reasons=%d' %
                      (unknown, len(full['reasons'])), flush=True)
        finally:
            child.stdin.close()
            try:
                child.wait(timeout=5)
            except subprocess.TimeoutExpired:
                child.kill()
                child.wait()
            child.stdout.close()
            child.stderr.close()


if __name__ == '__main__':
    unittest.main()
