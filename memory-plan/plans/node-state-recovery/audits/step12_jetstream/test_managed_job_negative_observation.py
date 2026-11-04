import contextlib
import copy
import inspect
import io
import json
import os
import pathlib
import sys
import unittest
from collections import Counter
from types import SimpleNamespace
from unittest.mock import patch

import managed_job_negative_observation as negative
import test_managed_job_observation as fixtures


managed = negative.managed
held = negative.held
envelope = negative.envelope


class Comparison(unittest.TestCase):
    @classmethod
    def setUpClass(cls): cls.fixture = fixtures.prepared(SimpleNamespace(addCleanup=cls.addClassCleanup))
    def setUp(self):
        self.records = copy.deepcopy(self.fixture.records)
        self.value = fixtures.collected(self.records)
        self.key = sorted(held.expected_keys(self.records))[0]
    def compare(self, value=None): return negative.compare_observed_jobs(self.records, self.value if value is None else value)

    def test_complete_negatives_preserve_nested_result_and_claim_limits(self):
        result = self.compare()
        self.assertEqual(result['outcome'], 'managed-jobs-negative-consistent', 'complete negatives must be consistent')
        self.assertEqual(result['phase'], 'negative', 'recorded observations must reach negative phase')
        self.assertEqual(result['negative'], held.compare_held_jobs(self.records, self.value['stages']['sweep_a']),
                         'nested comparator result must stay exact')
        self.assertEqual(result['negative']['source'], 'scripted')
        self.assertEqual(result['scope'], negative.SCOPE, 'wrapper scope must stay narrow')
        self.assertEqual(result['source'], 'observed', 'direct observed provenance must survive')
        self.assertEqual(result['observation_reasons'], [])
        for target in (result, result['negative']):
            for flag in ('admission', 'history_certified', 'hold_certified'):
                self.assertIs(target[flag], False, flag + ' must stay false')
        self.assertNotEqual(self.records[0]['boot'], self.value['stages']['boot_start'])

    def test_exact_input_hash_and_recomputed_copied_fields(self):
        self.value['outcome'] = 'refused'; self.value['reasons'] = ['forged-claims']
        checked = managed.valid_observation(self.value, self.records)
        result = self.compare()
        self.assertNotEqual(self.value, checked)
        self.assertEqual(result['observation_sha256'], envelope.fingerprint(self.value), 'hash must bind exact input')
        self.assertEqual(result['outcome'], 'managed-jobs-negative-consistent', 'stored refusal must be recomputed')
        for key in ('binding', 'source', 'sample_labels', 'coverage', 'budget'):
            self.assertEqual(result[key], checked[key], key + ' must copy recomputed facts')
        self.assertEqual(result['boot'], {key: checked['stages'][key] for key in ('boot_start', 'boot_end')})
        self.assertEqual(result['observation_reasons'], [], 'recomputed reasons must survive')
        result['binding']['uid'] += 1; result['budget']['elapsed_ns'] += 1
        self.assertEqual(self.value['binding'], checked['binding'])
        self.assertEqual(self.value['budget'], checked['budget'])

    def test_forged_recorded_with_error_never_calls_comparator(self):
        self.value['stages']['sweep_a'][self.key] = {'error_type': 'Refused'}
        self.value['outcome'] = 'recorded'; self.value['reasons'] = []
        with patch.object(held, 'compare_held_jobs', wraps=held.compare_held_jobs) as compare:
            result = self.compare()
        compare.assert_not_called()
        self.assertEqual(result['outcome'], 'refused', 'invalid observation must refuse')
        self.assertEqual(result['phase'], 'observation', 'invalid observation must stay in observation phase')
        self.assertIsNone(result['negative'], 'invalid observation must have no negative result')
        self.assertEqual(result['observation_reasons'], managed.valid_observation(self.value, self.records)['reasons'],
                         'recomputed refusal reasons must survive')

    def test_each_incomplete_changed_or_expired_observation_is_gated(self):
        variants = []
        for stage in managed.STAGES:
            value = copy.deepcopy(self.value); value['stages'][stage] = None; variants.append(value)
        for stage in ('sweep_a', 'sweep_b'):
            for mode in ('missing', 'extra', 'error'):
                value = copy.deepcopy(self.value); sweep = value['stages'][stage]
                if mode == 'missing': del sweep[self.key]
                if mode == 'extra': sweep['foreign/key'] = {'loaded': False}
                if mode == 'error': sweep[self.key] = {'error_type': 'TimeoutExpired'}
                variants.append(value)
        value = copy.deepcopy(self.value); value['stages']['boot_end'] = 'e' * 64; variants.append(value)
        value = copy.deepcopy(self.value); value['budget'].update(elapsed_ns=managed.WINDOW_NS + 1, expired=True); variants.append(value)
        value = copy.deepcopy(self.value); value['failures'] = [{'stage': 'boot_end', 'error_type': 'Refused'}]; variants.append(value)
        value = copy.deepcopy(self.value); value['stages']['sweep_b'][self.key] = envelope.redacted_job(fixtures.raw_loaded()); variants.append(value)
        for value in variants:
            with self.subTest(value=value), patch.object(held, 'compare_held_jobs') as compare:
                result = self.compare(value)
            self.assertEqual(result['outcome'], 'refused', 'all non-recorded observations must refuse')
            self.assertIsNone(result['negative']); compare.assert_not_called()

    def test_malformed_input_validates_before_hash_or_comparison(self):
        variants = [None, {}, {**self.value, 'binding': {**self.value['binding'], 'uid': True}},
                    {**self.value, 'coverage': {**self.value['coverage'], 'continuous': True}}]
        value = copy.deepcopy(self.value); value['binding']['checkpoint_sha256'] = '0' * 64; variants.append(value)
        for value in variants:
            with patch.object(envelope, 'fingerprint') as fingerprint, \
                 patch.object(held, 'compare_held_jobs') as compare, self.assertRaises(envelope.Refused):
                negative.compare_observed_jobs(self.records, value)
            fingerprint.assert_not_called(); compare.assert_not_called()

    def test_validator_runs_once_before_hash_and_comparison(self):
        events = []
        valid, fingerprint, compare = managed.valid_observation, envelope.fingerprint, held.compare_held_jobs
        def validate(*args): events.append('validate'); return valid(*args)
        def digest(*args): events.append('hash'); return fingerprint(*args)
        def compare_jobs(*args): events.append('compare'); return compare(*args)
        with patch.object(managed, 'valid_observation', side_effect=validate) as validator, \
             patch.object(envelope, 'fingerprint', side_effect=digest), \
             patch.object(held, 'compare_held_jobs', side_effect=compare_jobs) as comparator:
            self.compare()
        self.assertEqual(events, ['validate', 'hash', 'compare', 'hash'], 'validation must precede hashing and comparison')
        validator.assert_called_once(); comparator.assert_called_once()

    def test_loaded_idle_and_running_are_passed_verbatim_and_refuse(self):
        for state, pid in (('waiting', None), ('waiting', 481), ('running', 481)):
            value = copy.deepcopy(self.value)
            for stage in ('sweep_a', 'sweep_b'): value['stages'][stage][self.key] = envelope.redacted_job(fixtures.raw_loaded(state, pid))
            self.assertEqual(managed.valid_observation(value, self.records)['outcome'], 'recorded')
            with patch.object(held, 'compare_held_jobs', wraps=held.compare_held_jobs) as compare:
                result = self.compare(value)
            self.assertEqual(compare.call_args.args[1], value['stages']['sweep_a'], 'validated sweep must pass verbatim')
            self.assertEqual(result['negative']['unexpected_loaded'], [self.key], 'loaded jobs must remain unexpected')
            self.assertEqual(result['outcome'], 'refused', 'loaded jobs must refuse top verdict')
            self.assertEqual(result['phase'], 'negative')
            self.assertNotIn(fixtures.SECRET, envelope.encoded(result).decode(), 'raw argv must stay private')
            for key in ('program', 'arguments_sha256', 'plist', 'stages', 'process_policy'):
                self.assertNotIn('"' + key + '":', envelope.encoded(result).decode())

    def test_nested_verdict_controls_top_outcome(self):
        with patch.object(held, 'compare_held_jobs', return_value={'outcome': 'refused', 'missing': ['sentinel']}):
            result = self.compare()
        self.assertEqual(result['outcome'], 'refused', 'nested refusal must control top outcome')
        self.assertEqual(result['negative'], {'outcome': 'refused', 'missing': ['sentinel']})

    def test_comparison_is_pure_and_inputs_are_unchanged(self):
        before = copy.deepcopy((self.records, self.value))
        with patch('builtins.open', side_effect=AssertionError('IO')), \
             patch.object(managed, 'collect_jobs', side_effect=AssertionError('collector')), \
             patch.object(envelope, 'boot_identity', side_effect=AssertionError('live boot')), \
             patch.object(managed.time, 'monotonic_ns', side_effect=AssertionError('clock')):
            self.compare()
        self.assertEqual((self.records, self.value), before)
        self.assertEqual(managed.valid_observation(self.value, self.records), self.value)


class Consumer(unittest.TestCase):
    def fixture(self, **kwargs): return fixtures.prepared(self, **kwargs)
    def consume(self, fixture): return negative.inspect_owned(fixture.temp.resolve(), fixture=True, scripted=True)

    def test_real_frozen_reader_once_before_comparison_without_writes_or_constructors(self):
        fixture = self.fixture(); before = fixtures.image_fixture.snapshot(fixture.temp)
        events = []
        reader, verify, compare = managed.read_inputs, managed.verify_frozen_checkpoint, negative.compare_observed_jobs
        def read(*args, **kwargs): events.append('read'); return reader(*args, **kwargs)
        def frozen(*args, **kwargs): events.append('verify'); return verify(*args, **kwargs)
        def compare_jobs(*args): events.append('compare'); return compare(*args)
        with patch.object(managed, 'read_inputs', side_effect=read) as read_inputs, \
             patch.object(managed, 'verify_frozen_checkpoint', side_effect=frozen) as verifier, \
             patch.object(managed, 'owned_records', wraps=managed.owned_records) as owner, \
             patch.object(negative, 'compare_observed_jobs', side_effect=compare_jobs), \
             patch.object(managed, 'collect_jobs', side_effect=AssertionError('live collector')), \
             patch.object(envelope.census, 'launchd_service', side_effect=AssertionError('census')), \
             patch.object(fixtures.preservation_journal.Journal, '__init__', side_effect=AssertionError('Journal')), \
             patch.object(fixtures.restore_only.gate_module.Gate, '__init__', side_effect=AssertionError('Gate')):
            result = self.consume(fixture)
        self.assertEqual(owner.call_count, 1, 'owned frozen reader must run exactly once')
        read_inputs.assert_called_once(); verifier.assert_called_once()
        self.assertEqual(events, ['read', 'verify', 'compare'], 'frozen verification must precede comparison')
        self.assertEqual(result['outcome'], 'managed-jobs-negative-consistent')
        self.assertEqual(fixtures.image_fixture.snapshot(fixture.temp), before)

    def test_flags_precede_any_input_io(self):
        for fixture, scripted in ((False, False), (False, True), (True, False)):
            with patch.object(managed, 'owned_records', side_effect=envelope.Refused('unexpected reader reached')) as reader, patch.object(envelope, 'read_private') as private, \
                 self.assertRaisesRegex(envelope.Refused, '--fixture and --scripted', msg='both flags must gate IO'):
                negative.inspect_owned('/unread', fixture=fixture, scripted=scripted)
            reader.assert_not_called(); private.assert_not_called()

    def test_frozen_refusal_prevents_observation_file_read(self):
        fixture = self.fixture(); real_private = envelope.read_private; paths = []
        def private(path): paths.append(pathlib.Path(path).name); return real_private(path)
        with patch.object(envelope, 'read_private', side_effect=private), \
             patch.object(managed, 'verify_frozen_checkpoint', side_effect=envelope.Refused('frozen')), \
             patch.object(negative, 'compare_observed_jobs') as compare, self.assertRaises(envelope.Refused):
            self.consume(fixture)
        self.assertNotIn('managed-jobs.json', paths, 'frozen refusal must prevent observation read')
        compare.assert_not_called()

    def test_forcing_block_is_textually_identical_to_existing_consumer(self):
        def block(function):
            text = inspect.getsource(function)
            return text[text.index('    envelope.keys(value, FIELDS)'):text.index("    value['source'] = 'scripted'") + len("    value['source'] = 'scripted'")]
        self.assertEqual(block(negative.inspect_owned), block(managed.inspect_owned))

    def test_file_provenance_is_scripted_and_claims_are_retained(self):
        fixture = self.fixture(); original = envelope.read_private(fixture.temp / 'managed-jobs.json')
        try: result = self.consume(fixture)
        except envelope.Refused: self.fail('file source must be forced scripted')
        self.assertEqual(result['source'], 'scripted', 'file source must be forced scripted')
        self.assertEqual(result['sample_labels'], {'source': original['source'], 'coverage': original['coverage']},
                         'file claims must survive under sample labels')
        self.assertEqual(result['negative']['source'], 'scripted')
        self.assertFalse(result['hold_certified'])

    def test_private_canonical_and_frozen_binding_refusals_precede_comparison(self):
        fixture = self.fixture(); path = fixture.temp / 'managed-jobs.json'; raw = path.read_bytes()
        for content, mode in ((raw + b'\n', 0o600), (raw, 0o644)):
            path.write_bytes(content); path.chmod(mode)
            with patch.object(negative, 'compare_observed_jobs') as compare, self.assertRaises(RuntimeError): self.consume(fixture)
            compare.assert_not_called()
        path.write_bytes(raw); path.chmod(0o600)
        value = envelope.read_private(path); value['binding']['checkpoint_sha256'] = '0' * 64
        path.write_bytes(envelope.encoded(value))
        with self.assertRaisesRegex(envelope.Refused, 'frozen binding'): self.consume(fixture)

    def test_recorded_owner_not_runtime_owner_is_enforced_upstream(self):
        real = fixtures.policy_fixture.recorded_hold
        def foreign(parent):
            hold = real(parent); hold['metadata_identity']['uid'] = os.getuid() + 1; return hold
        with patch.object(fixtures.policy_fixture, 'recorded_hold', side_effect=foreign): fixture = self.fixture()
        with patch.object(negative, 'compare_observed_jobs') as compare, self.assertRaisesRegex(envelope.Refused, 'reader ownership'):
            self.consume(fixture)
        compare.assert_not_called()

    def test_policy_presence_does_not_change_negative_result(self):
        for present in (False, True):
            fixture = self.fixture(policy=present)
            self.assertEqual(self.consume(fixture)['outcome'], 'managed-jobs-negative-consistent')

    def invoke(self, fixture, flags):
        with patch.object(sys, 'argv', ['managed_job_negative_observation.py', str(fixture.temp), *flags]), \
             contextlib.redirect_stdout(io.StringIO()) as output:
            code = negative.main()
        raw = output.getvalue(); result = json.loads(raw)
        self.assertEqual(raw, envelope.encoded(result).decode() + '\n')
        return code, result

    def test_fixture_only_cli_never_scans_even_with_benign_census(self):
        fixture = self.fixture()
        with patch.object(envelope.census, 'launchd_service', return_value={'loaded': False}) as service:
            code, result = self.invoke(fixture, ['--fixture'])
        self.assertEqual(code, 2, 'fixture-only CLI must refuse')
        service.assert_not_called(); self.assertEqual(result['source'], 'scripted')

    def test_canonical_cli_positive_loaded_and_envelope_refusal_exits(self):
        fixture = self.fixture()
        code, result = self.invoke(fixture, ['--fixture', '--scripted'])
        self.assertEqual(code, 0, 'consistent CLI must exit zero')
        self.assertEqual(result['source'], 'scripted')
        path = fixture.temp / 'managed-jobs.json'; value = envelope.read_private(path); key = sorted(held.expected_keys(fixture.records))[0]
        for stage in ('sweep_a', 'sweep_b'): value['stages'][stage][key] = envelope.redacted_job(fixtures.raw_loaded())
        path.write_bytes(envelope.encoded(value))
        code, result = self.invoke(fixture, ['--fixture', '--scripted'])
        self.assertEqual(code, 2, 'loaded CLI must exit two'); self.assertEqual(result['phase'], 'negative')
        value['stages']['sweep_a'][key] = {'error_type': 'Refused'}; path.write_bytes(envelope.encoded(value))
        code, result = self.invoke(fixture, ['--fixture', '--scripted'])
        self.assertEqual(code, 2, 'envelope refusal CLI must exit two'); self.assertEqual(result['phase'], 'observation')
        code, result = self.invoke(fixture, [])
        self.assertEqual(code, 2); self.assertEqual(result['error_type'], 'Refused')

    @unittest.skipUnless(sys.platform == 'darwin' and os.environ.get('GITHUB_ACTIONS') == 'true',
                         'unpatched managed-job negative observation is isolated macOS CI only')
    def test_native_ci_observation_composes_without_node_positive_claim(self):
        fixture = self.fixture(); before = fixtures.image_fixture.snapshot(fixture.temp)
        records, verified = managed.owned_records(fixture.temp.resolve(), fixture=True)
        value = managed.collect_jobs(records); result = negative.compare_observed_jobs(records, value)
        self.assertEqual(value, managed.valid_observation(value, records))
        self.assertEqual(result, negative.compare_observed_jobs(records, value))
        self.assertEqual(result['binding']['checkpoint_sha256'], verified)
        self.assertEqual(result['source'], 'observed'); self.assertEqual(result['coverage'], managed.COVERAGE)
        self.assertEqual(result['phase'], 'negative' if value['outcome'] == 'recorded' else 'observation')
        for stage in ('sweep_a', 'sweep_b'): self.assertEqual(set(value['stages'][stage]), held.expected_keys(records))
        self.assertFalse(result['admission']); self.assertFalse(result['hold_certified'])
        self.assertEqual(fixtures.image_fixture.snapshot(fixture.temp), before)
        errors = Counter(fact['error_type'] for stage in ('sweep_a', 'sweep_b') for fact in value['stages'][stage].values() if 'error_type' in fact)
        print('native owned managed-job negative observation: outcome=%s phase=%s keys=%d sweeps=2 errors=%s elapsed_ns=%d' %
              (result['outcome'], result['phase'], len(held.expected_keys(records)), json.dumps(dict(errors), sort_keys=True), value['budget']['elapsed_ns']), flush=True)


if __name__ == '__main__': unittest.main()
