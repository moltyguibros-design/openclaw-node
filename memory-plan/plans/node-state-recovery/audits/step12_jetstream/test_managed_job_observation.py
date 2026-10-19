import contextlib
import copy
import io
import json
import os
import pathlib
import secrets
import shutil
import subprocess
import sys
import tempfile
import unittest
from collections import Counter
from types import SimpleNamespace
from unittest.mock import patch

import managed_job_observation as observation
import held_job_negative_comparator as held
import preservation_journal
import restore_only
import test_boot_process_policy as policy_fixture
import test_capture_checkpoint as guest_fixture
import test_stopped_journal_inputs as image_fixture


BOOT = 'f' * 64
SECRET = 'managed-job-private-argument-8315'


def raw_loaded(state='waiting', pid=None):
    return {'loaded': True, 'state': state, 'pid': pid, 'program': '/bin/sh',
            'arguments': ['/bin/sh', SECRET, '', 'épreuve'], 'plist': '/owned/job.plist'}


def collected(records, service=None, boots=None, clock=None):
    with patch.object(observation.envelope.census, 'launchd_service',
                      side_effect=service or (lambda namespace, label: {'loaded': False})), \
         patch.object(observation.envelope, 'boot_identity', side_effect=boots or [BOOT, BOOT]), \
         patch.object(observation.time, 'monotonic_ns', side_effect=clock or (lambda: 0)):
        return observation.collect_jobs(records)


def prepared(test, policy=False):
    parent = pathlib.Path(os.environ.get('GITHUB_WORKSPACE', pathlib.Path.home())).resolve()
    tempdir = patch.object(tempfile, 'gettempdir', return_value=str(parent))
    tempdir.start()
    test.addCleanup(tempdir.stop)
    root = parent / ('openclaw-owned-managed-jobs-' + secrets.token_hex(8))
    root.mkdir(mode=0o700)
    test.addCleanup(shutil.rmtree, root)
    mask = os.umask(0o077)
    try:
        with patch.object(guest_fixture.tempfile, 'TemporaryDirectory',
                          return_value=SimpleNamespace(name=str(root), cleanup=lambda: None)):
            fixture = policy_fixture.captured(test, image=True, absent=not policy)
    finally:
        os.umask(mask)
    for name, value in (('table.json', fixture.table), ('managed-jobs.json', collected(fixture.records))):
        path = root / name
        path.write_bytes(observation.envelope.encoded(value)); path.chmod(0o600)
    return fixture


class Observation(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.fixture = prepared(SimpleNamespace(addCleanup=cls.addClassCleanup))

    def setUp(self):
        self.records = copy.deepcopy(self.fixture.records)
        self.keys = held.expected_keys(self.records)
        self.pairs = sorted(tuple(key.rsplit('/', 1)) for key in self.keys)
        self.key = sorted(self.keys)[0]
        self.value = collected(self.records)

    def validate(self, value=None):
        return observation.valid_observation(self.value if value is None else value, self.records)

    def test_complete_other_boot_is_recorded_facts_only(self):
        self.assertNotEqual(self.records[0]['boot'], BOOT)
        result = self.validate()
        self.assertEqual(result['outcome'], 'recorded', 'complete coherent observations must record')
        self.assertEqual(result['source'], 'observed', 'collector source must be observed')
        self.assertIsNone(result['sample_labels'])
        self.assertEqual(result['coverage'], observation.COVERAGE)
        for field in ('admission', 'history_certified', 'hold_certified'):
            self.assertIs(result[field], False, field + ' must stay false')
        self.assertEqual(result['scope'], observation.SCOPE)
        self.assertEqual(result['reasons'], [])
        self.assertEqual(set(result['stages']), set(observation.STAGES))

    def test_structured_all_domain_pairs_and_exact_order(self):
        events = []
        def boot(): events.append('boot'); return BOOT
        def service(namespace, label): events.append((namespace, label)); return {'loaded': False}
        with patch.object(observation.envelope, 'boot_identity', side_effect=boot), \
             patch.object(observation.envelope.census, 'launchd_service', side_effect=service), \
             patch.object(observation.time, 'monotonic_ns', return_value=0):
            result = observation.collect_jobs(self.records)
        self.assertEqual(events, ['boot', *self.pairs, *self.pairs, 'boot'], 'two complete sweeps must be boot bracketed')
        self.assertEqual(len(self.keys), 3 * len(self.records[0]['prior']))
        self.assertGreater(len(self.keys), observation.envelope.ANCHOR_CAP)
        for stage in ('sweep_a', 'sweep_b'):
            self.assertEqual(set(result['stages'][stage]), self.keys, 'every managed key must survive both sweeps')
        for domain in ('gui/' + str(held.owner_uid(self.records)), 'user/' + str(held.owner_uid(self.records)), 'system'):
            for unit in ('nats-1', 'federation-tick'):
                self.assertIn((domain, 'ai.openclaw.' + unit), self.pairs)

    def test_pair_coverage_is_checked_against_existing_derivation(self):
        with patch.object(held, 'expected_keys', return_value=self.keys | {'unexpected'}), \
             patch.object(observation.envelope.census, 'launchd_service') as service:
            try: observation.collect_jobs(self.records)
            except observation.envelope.Refused: pass
        service.assert_not_called()

    def test_recorded_uid_controls_namespaces_without_runtime_default(self):
        self.records[0]['prior']['scheduler-heartbeat']['execution_hold']['metadata_identity']['uid'] = 87654
        with patch.object(observation.envelope.os, 'getuid', side_effect=AssertionError('runtime owner')):
            result = collected(self.records)
        self.assertEqual(result['binding']['uid'], 87654, 'binding must use recorded owner')
        self.assertIn('gui/87654/ai.openclaw.nats-1', result['stages']['sweep_a'])
        self.assertNotIn(self.key, result['stages']['sweep_a'])

    def test_each_key_error_survives_independently_in_both_sweeps(self):
        for target in sorted(self.keys):
            def service(namespace, label):
                if namespace + '/' + label == target: raise observation.envelope.Refused('unreadable')
                return {'loaded': False}
            result = collected(self.records, service=service)
            with self.subTest(target=target):
                for stage in ('sweep_a', 'sweep_b'):
                    self.assertEqual(result['stages'][stage][target], {'error_type': 'Refused'}, 'per-key error must survive')
                self.assertEqual(result['outcome'], 'refused', 'any per-key error must refuse recording')

    def test_timeout_and_missing_domain_errors_are_unknown_in_every_domain(self):
        for domain in ('gui', 'user', 'system'):
            def service(namespace, label):
                if namespace.split('/')[0] == domain:
                    raise subprocess.TimeoutExpired(['/bin/launchctl'], 10)
                return {'loaded': False}
            try: result = collected(self.records, service=service)
            except observation.envelope.ERRORS: self.fail('timeout must stay an error fact')
            self.assertEqual(result['outcome'], 'refused', 'timeout must refuse recording')
            for stage in ('sweep_a', 'sweep_b'):
                errors = [fact for fact in result['stages'][stage].values() if 'error_type' in fact]
                self.assertEqual(errors, [{'error_type': 'TimeoutExpired'}] * len(self.records[0]['prior']),
                                 'timeout must stay an error fact')

    def test_only_exact_absence_can_be_unloaded(self):
        for raw in ({'loaded': False, 'extra': True}, {'loaded': 0}, None,
                    {**raw_loaded(), 'arguments': []}, {**raw_loaded(), 'arguments': ['bad\0argv']}):
            try: result = collected(self.records, service=lambda *args: raw)
            except observation.envelope.ERRORS: self.fail('malformed facts must not escape collection')
            self.assertEqual(result['outcome'], 'refused', 'malformed census facts must refuse')
            self.assertTrue(all(fact == {'error_type': 'Refused'} for fact in result['stages']['sweep_a'].values()),
                            'malformed facts must not become unloaded')

    def test_only_declared_primitive_failures_are_caught(self):
        with self.assertRaises(AssertionError, msg='unexpected programming errors must propagate'):
            collected(self.records, service=lambda *args: (_ for _ in ()).throw(AssertionError('programming error')))

    def test_loaded_idle_and_running_are_recordable_redacted_facts(self):
        for state, pid in (('waiting', None), ('waiting', 472), ('running', 472)):
            result = collected(self.records, service=lambda *args: raw_loaded(state, pid))
            self.assertEqual(result['outcome'], 'recorded', 'loaded facts must remain recordable')
            self.assertEqual(result['stages']['sweep_a'][self.key], observation.envelope.redacted_job(raw_loaded(state, pid)))
            encoded = observation.envelope.encoded(result).decode()
            self.assertNotIn(SECRET, encoded, 'raw arguments must stay private')
            self.assertNotIn('"arguments":', encoded, 'raw arguments key must stay private')
            negative = held.compare_held_jobs(self.records, result['stages']['sweep_a'])
            self.assertEqual(negative['outcome'], 'refused')
            self.assertEqual(set(negative['unexpected_loaded']), self.keys)

    def test_complete_negative_sweep_has_unchanged_comparator_shape(self):
        result = held.compare_held_jobs(self.records, self.value['stages']['sweep_a'])
        self.assertEqual(result['outcome'], 'held-jobs-negative-consistent')
        self.assertEqual(result['source'], 'scripted')
        self.assertFalse(result['hold_certified'])

    def test_sweep_inequality_refuses_even_with_claimed_recorded_verdict(self):
        self.value['stages']['sweep_b'][self.key] = observation.envelope.redacted_job(raw_loaded())
        result = self.validate()
        self.assertEqual(result['outcome'], 'refused', 'changed sweeps must refuse recording')
        self.assertIn('sweeps-differ', result['reasons'])

    def test_each_boot_change_failure_and_incomplete_stage_refuses(self):
        changed = collected(self.records, boots=[BOOT, 'e' * 64])
        self.assertEqual(changed['outcome'], 'refused', 'boot change must refuse recording')
        self.assertIn('boot-changed', changed['reasons'])
        for index in (0, 1):
            boots = [BOOT, BOOT]; boots[index] = subprocess.CalledProcessError(1, 'sysctl')
            result = collected(self.records, boots=boots)
            self.assertEqual(result['outcome'], 'refused', 'boot failure must refuse recording')
            self.assertEqual(result['failures'], [{'stage': ('boot_start', 'boot_end')[index],
                                                  'error_type': 'CalledProcessError'}], 'boot failure must survive')
        for stage in observation.STAGES:
            value = copy.deepcopy(self.value); value['stages'][stage] = None
            self.assertEqual(self.validate(value)['outcome'], 'refused', 'missing stage must refuse recording')
        value = copy.deepcopy(self.value); value['stages'] = dict.fromkeys(observation.STAGES)
        self.assertEqual(self.validate(value)['outcome'], 'refused', 'incomplete equal stages must refuse recording')
        value = copy.deepcopy(self.value)
        value['failures'] = [{'stage': 'boot_start', 'error_type': 'Refused'}]
        self.assertEqual(self.validate(value)['outcome'], 'refused', 'retained failure must refuse recording')

    def test_invalid_boot_digest_is_retained_as_a_stage_failure(self):
        try: result = collected(self.records, boots=['not-a-digest', BOOT])
        except observation.envelope.ERRORS: self.fail('invalid boot must remain a stage failure')
        self.assertEqual(result['failures'], [{'stage': 'boot_start', 'error_type': 'Refused'}])
        self.assertIsNone(result['stages']['boot_start'])
        self.assertEqual(result['outcome'], 'refused')

    def test_budget_fits_two_sweeps_of_shared_ten_second_calls(self):
        self.assertEqual(observation.WINDOW_NS, 30 * 60 * 1_000_000_000)
        self.assertGreaterEqual(observation.WINDOW_NS, 2 * len(self.keys) * 10 * 1_000_000_000,
                                'budget must fit the full cohort at the shared ten-second call timeout')
        self.assertNotEqual(observation.WINDOW_NS, observation.envelope.WINDOW_NS)

    def test_expiry_stops_acquisition_and_retains_all_remaining_keys(self):
        calls = []
        def service(namespace, label): calls.append((namespace, label)); return {'loaded': False}
        offsets = iter([0, 0, 0])
        def clock(): return next(offsets, observation.WINDOW_NS + 1)
        result = collected(self.records, service=service, clock=clock)
        self.assertEqual(calls, self.pairs[:2], 'expiry must stop new census calls')
        self.assertTrue(result['budget']['expired'])
        self.assertEqual(result['outcome'], 'refused', 'expired budget must refuse recording')
        for stage in ('sweep_a', 'sweep_b'):
            self.assertEqual(set(result['stages'][stage]), self.keys, 'expiry must retain all keys')
        remaining = sorted(self.keys)[2:]
        self.assertTrue(all(result['stages']['sweep_a'][key] == {'error_type': 'BudgetExpired'} for key in remaining),
                        'expiry must retain current-sweep keys')
        self.assertTrue(all(fact == {'error_type': 'BudgetExpired'} for fact in result['stages']['sweep_b'].values()),
                        'expiry must retain later-sweep keys')

    def test_post_boot_expiry_and_exact_boundary(self):
        for over in (0, 1):
            clock = iter([0] * (1 + 2 * len(self.keys)) + [observation.WINDOW_NS + over])
            try: result = collected(self.records, clock=lambda: next(clock))
            except observation.envelope.ERRORS: self.fail('post-boot expiry must be recomputed')
            self.assertEqual(result['budget']['elapsed_ns'], observation.WINDOW_NS + over, 'post-boot time must be measured')
            self.assertIs(result['budget']['expired'], bool(over), 'post-boot expiry must be recomputed')
            self.assertEqual(result['outcome'], 'refused' if over else 'recorded', 'post-boot expiry must control recording')

    def test_missing_extra_and_error_keys_refuse_in_each_sweep(self):
        for stage in ('sweep_a', 'sweep_b'):
            for kind in ('missing', 'extra', 'error'):
                value = copy.deepcopy(self.value)
                if kind == 'missing': del value['stages'][stage][self.key]
                elif kind == 'extra': value['stages'][stage]['extra'] = {'loaded': False}
                else: value['stages'][stage][self.key] = {'error_type': 'BudgetExpired'}
                self.assertEqual(self.validate(value)['outcome'], 'refused', stage + ' ' + kind + ' must refuse recording')
        for kind in ('missing', 'extra'):
            value = copy.deepcopy(self.value)
            for stage in ('sweep_a', 'sweep_b'):
                if kind == 'missing': del value['stages'][stage][self.key]
                else: value['stages'][stage]['extra'] = {'loaded': False}
            self.assertEqual(self.validate(value)['outcome'], 'refused', 'equal ' + kind + ' sweeps must refuse recording')

    def test_binding_is_exact_typed_and_bound_to_both_frozen_digests(self):
        for key, val in (('uid', held.owner_uid(self.records) + 1), ('uid', True), ('uid', -1),
                         ('baseline_sha256', '0' * 64), ('checkpoint_sha256', '0' * 64)):
            value = copy.deepcopy(self.value); value['binding'][key] = val
            with self.subTest(key=key, val=val), self.assertRaises(observation.envelope.Refused,
                                                                msg='wrong frozen binding must refuse'):
                self.validate(value)
        self.records[0]['prior']['scheduler-heartbeat']['execution_hold']['metadata_identity']['uid'] = 1
        value = collected(self.records); value['binding']['uid'] = True
        with self.assertRaises(observation.envelope.Refused, msg='boolean UID alias must refuse'):
            self.validate(value)

    def test_verdict_recomputed_without_io_or_mutation(self):
        before = copy.deepcopy(self.value)
        self.value['outcome'] = 'refused'; self.value['reasons'] = ['untrusted']
        with patch.object(observation.envelope.census, 'launchd_service', side_effect=AssertionError('IO')), \
             patch.object(observation.envelope, 'boot_identity', side_effect=AssertionError('IO')):
            result = self.validate()
        self.assertEqual(result['outcome'], 'recorded', 'stored verdict must not control recording')
        self.assertEqual(result['reasons'], [])
        self.assertEqual(self.value['reasons'], ['untrusted'], 'validator must not mutate its input')
        self.assertEqual(before['stages'], self.value['stages'])

    def test_schema_budget_claims_and_raw_argument_fields_refuse(self):
        variants = []
        for location in ((), ('stages',), ('binding',), ('budget',), ('coverage',)):
            value = copy.deepcopy(self.value); target = value
            for name in location: target = target[name]
            target['extra'] = True; variants.append(value)
        for field in ('admission', 'history_certified', 'hold_certified'):
            value = copy.deepcopy(self.value); value[field] = True; variants.append(value)
        for field in observation.COVERAGE:
            value = copy.deepcopy(self.value); value['coverage'][field] = not observation.COVERAGE[field]; variants.append(value)
            value = copy.deepcopy(self.value); value['coverage'][field] = int(observation.COVERAGE[field]); variants.append(value)
        for field, val in (('limit_ns', True), ('limit_ns', observation.WINDOW_NS + 1), ('elapsed_ns', -1),
                           ('elapsed_ns', True), ('expired', True), ('expired', 0)):
            value = copy.deepcopy(self.value); value['budget'][field] = val; variants.append(value)
        value = copy.deepcopy(self.value); value['stages']['boot_start'] = 'bad'; variants.append(value)
        value = copy.deepcopy(self.value); value['stages']['sweep_a'][self.key] = raw_loaded(); variants.append(value)
        value = copy.deepcopy(self.value); value['stages']['sweep_a'][self.key] = {'error_type': ''}; variants.append(value)
        value = copy.deepcopy(self.value); value['source'] = 'arbitrary'; variants.append(value)
        value = copy.deepcopy(self.value); value['sample_labels'] = {}; variants.append(value)
        value = copy.deepcopy(self.value); value['scope'] = 'admission'; variants.append(value)
        for value in variants:
            with self.subTest(value=value), self.assertRaises(observation.envelope.Refused, msg='invalid schema must refuse'):
                self.validate(value)

    def test_scripted_sample_labels_have_only_bounded_claim_vocabulary(self):
        value = copy.deepcopy(self.value)
        value['source'] = 'scripted'
        value['sample_labels'] = {'source': 'observed', 'coverage': dict(observation.COVERAGE)}
        self.assertEqual(self.validate(value)['outcome'], 'recorded')
        for labels in ({'source': SECRET, 'coverage': dict(observation.COVERAGE)},
                       {'source': 'observed', 'coverage': {**observation.COVERAGE, 'extra': True}},
                       {'source': 'observed', 'coverage': {**observation.COVERAGE, 'arguments': [SECRET]}},
                       {'source': 'observed', 'coverage': {**observation.COVERAGE, 'sampled': 1}}):
            value['sample_labels'] = labels
            with self.assertRaises(observation.envelope.Refused, msg='sample-label vocabulary must be bounded'):
                self.validate(value)


class Consumer(unittest.TestCase):
    def fixture(self, **kwargs): return prepared(self, **kwargs)
    def consume(self, fixture): return observation.inspect_owned(fixture.temp.resolve(), fixture=True, scripted=True)

    def test_honest_frozen_path_once_then_scripted_validator_without_constructors_or_writes(self):
        fixture = self.fixture()
        before = image_fixture.snapshot(fixture.temp)
        events = []
        read, verify, valid = observation.read_inputs, observation.verify_frozen_checkpoint, observation.valid_observation
        def image(*args, **kwargs): events.append('read'); return read(*args, **kwargs)
        def frozen(*args, **kwargs): events.append('verify'); return verify(*args, **kwargs)
        def validate(*args, **kwargs): events.append('validate'); return valid(*args, **kwargs)
        with patch.object(observation, 'read_inputs', side_effect=image) as reader, \
             patch.object(observation, 'verify_frozen_checkpoint', side_effect=frozen) as verifier, \
             patch.object(observation, 'valid_observation', side_effect=validate), \
             patch.object(observation, 'collect_jobs', side_effect=AssertionError('collector reached')), \
             patch.object(observation.envelope.census, 'launchd_service', side_effect=AssertionError('census reached')), \
             patch.object(preservation_journal.Journal, '__init__', side_effect=AssertionError('Journal construction')), \
             patch.object(restore_only.gate_module.Gate, '__init__', side_effect=AssertionError('Gate construction')):
            result = self.consume(fixture)
        reader.assert_called_once(); verifier.assert_called_once()
        self.assertEqual(events, ['read', 'verify', 'validate'], 'frozen verification must precede validation')
        self.assertEqual(result['outcome'], 'recorded')
        self.assertEqual(image_fixture.snapshot(fixture.temp), before)

    def test_fixture_only_cli_cannot_acquire_live_jobs_even_with_benign_census(self):
        fixture = self.fixture()
        with patch.object(sys, 'argv', ['managed_job_observation.py', str(fixture.temp), '--fixture']), \
             patch.object(observation.envelope.census, 'launchd_service', return_value={'loaded': False}) as service, \
             contextlib.redirect_stdout(io.StringIO()) as output:
            code = observation.main()
        self.assertEqual(code, 2, 'fixture-only CLI must refuse')
        service.assert_not_called()
        self.assertEqual(json.loads(output.getvalue())['outcome'], 'refused')

    def test_flags_precede_all_input_io(self):
        for fixture, scripted in ((False, False), (False, True), (True, False)):
            with patch.object(observation, 'owned_records', return_value=([], None)) as reader, \
                 patch.object(observation.envelope, 'read_private') as private, \
                 self.assertRaisesRegex(observation.envelope.Refused, '--fixture and --scripted',
                                        msg='both flags must gate all IO'):
                observation.inspect_owned('/unread', fixture=fixture, scripted=scripted)
            reader.assert_not_called(); private.assert_not_called()
        with patch.object(observation.envelope, 'private_dir') as directory, self.assertRaises(observation.envelope.Refused):
            observation.owned_records('/unread')
        directory.assert_not_called()

    def test_scripted_claims_are_retained_without_observed_promotion(self):
        fixture = self.fixture()
        original = observation.envelope.read_private(fixture.temp / 'managed-jobs.json')
        result = self.consume(fixture)
        self.assertEqual(result['source'], 'scripted', 'file source must be forced scripted')
        self.assertEqual(result['sample_labels'], {'source': 'observed', 'coverage': original['coverage']},
                         'file source and coverage must remain untrusted sample labels')
        self.assertFalse(result['hold_certified'])
        self.assertNotIn('process_policy', result)
        result['outcome'] = 'refused'; result['reasons'] = ['ignored']
        (fixture.temp / 'managed-jobs.json').write_bytes(observation.envelope.encoded(result))
        self.assertEqual(self.consume(fixture)['outcome'], 'recorded')

    def test_pin_coherence_and_frozen_refusal_precede_observation_read(self):
        fixture = self.fixture()
        real = observation.require_committed(fixture.capture)
        with patch.object(observation, 'require_committed', return_value={**real, 'capture_nonce': 'f' * 64}), \
             patch.object(observation, 'read_inputs') as reader:
            try: self.consume(fixture)
            except RuntimeError: pass
        reader.assert_not_called()
        real_private = observation.envelope.read_private
        paths = []
        def private(path): paths.append(pathlib.Path(path).name); return real_private(path)
        with patch.object(observation.envelope, 'read_private', side_effect=private), \
             patch.object(observation, 'verify_frozen_checkpoint', side_effect=observation.envelope.Refused('frozen')):
            try: self.consume(fixture)
            except observation.envelope.Refused: pass
        self.assertNotIn('managed-jobs.json', paths, 'frozen refusal must prevent observation-file read')

    def test_real_broken_checkpoint_or_receipt_refuses(self):
        for name in ('CHECKPOINT.json', 'node.lock.state.json'):
            fixture = self.fixture()
            path = fixture.capture / name if name == 'CHECKPOINT.json' else image_fixture.preservation(fixture.data) / name
            path.write_bytes(b'{}')
            with patch.object(observation, 'valid_observation') as valid, self.assertRaises(RuntimeError):
                self.consume(fixture)
            valid.assert_not_called()

    def test_every_read_owner_and_nonempty_metadata_bind_to_recorded_uid(self):
        fixture = self.fixture()
        found = observation.read_inputs(fixture.data, fixture.commitment)
        uid = held.owner_uid(found['records'])
        for rows in ([{**row, 'uid': uid + 1} for row in found['read']],
                     [*found['read'][:-1], {**found['read'][-1], 'uid': uid + 1}], []):
            with patch.object(observation, 'read_inputs', return_value={**found, 'read': rows}), \
                 patch.object(observation, 'valid_observation') as valid, \
                 self.assertRaisesRegex(observation.envelope.Refused, 'reader ownership', msg='every reader owner must match'):
                self.consume(fixture)
            valid.assert_not_called()

    def test_foreign_recorded_owner_is_not_replaced_by_runtime_uid(self):
        real = policy_fixture.recorded_hold
        def foreign(parent):
            hold = real(parent); hold['metadata_identity']['uid'] = os.getuid() + 1; return hold
        with patch.object(policy_fixture, 'recorded_hold', side_effect=foreign): fixture = self.fixture()
        with patch.object(observation, 'valid_observation') as valid, \
             self.assertRaisesRegex(observation.envelope.Refused, 'reader ownership', msg='foreign recorded owner must refuse'):
            self.consume(fixture)
        valid.assert_not_called()

    def test_policy_presence_does_not_limit_fixed_cohort(self):
        for policy in (False, True):
            fixture = self.fixture(policy=policy)
            result = self.consume(fixture)
            self.assertEqual(result['outcome'], 'recorded')
            self.assertEqual(set(result['stages']['sweep_a']), held.expected_keys(fixture.records))

    def test_private_canonical_root_and_file_fences(self):
        fixture = self.fixture()
        path = fixture.temp / 'managed-jobs.json'; raw = path.read_bytes()
        variants = [(raw + b'\n', 0o600), (raw, 0o644), (b'{}', 0o600)]
        for content, mode in variants:
            path.write_bytes(content); path.chmod(mode)
            with self.assertRaises(RuntimeError, msg='private canonical file must be required'): self.consume(fixture)
        path.write_bytes(raw); path.chmod(0o600)
        target = fixture.temp / 'alias-target'; path.rename(target); path.symlink_to(target)
        with self.assertRaises(RuntimeError): self.consume(fixture)
        path.unlink(); target.rename(path)
        fixture.temp.chmod(0o755)
        with self.assertRaises(RuntimeError): self.consume(fixture)
        fixture.temp.chmod(0o700)
        with self.assertRaises(RuntimeError): observation.inspect_owned(fixture.temp / '..' / fixture.temp.name, fixture=True, scripted=True)

    def test_wrong_frozen_binding_refuses_in_real_consumer(self):
        fixture = self.fixture()
        value = observation.envelope.read_private(fixture.temp / 'managed-jobs.json')
        value['binding']['checkpoint_sha256'] = '0' * 64
        (fixture.temp / 'managed-jobs.json').write_bytes(observation.envelope.encoded(value))
        with self.assertRaisesRegex(observation.envelope.Refused, 'frozen binding'): self.consume(fixture)

    def test_cli_canonical_recorded_and_refused_exit_codes(self):
        fixture = self.fixture()
        def invoke(flags):
            with patch.object(sys, 'argv', ['managed_job_observation.py', str(fixture.temp), *flags]), \
                 contextlib.redirect_stdout(io.StringIO()) as output:
                code = observation.main()
            raw = output.getvalue(); value = json.loads(raw)
            self.assertEqual(raw, observation.envelope.encoded(value).decode() + '\n')
            return code, value
        code, result = invoke(['--fixture', '--scripted'])
        self.assertEqual(code, 0, 'recorded scripted CLI must exit zero')
        self.assertEqual(result['source'], 'scripted')
        value = observation.envelope.read_private(fixture.temp / 'managed-jobs.json')
        value['stages']['sweep_b'][next(iter(value['stages']['sweep_b']))] = {'error_type': 'Refused'}
        (fixture.temp / 'managed-jobs.json').write_bytes(observation.envelope.encoded(value))
        code, result = invoke(['--fixture', '--scripted'])
        self.assertEqual(code, 2, 'refused CLI must exit two')
        self.assertEqual(result['outcome'], 'refused')
        code, result = invoke([])
        self.assertEqual(code, 2)
        self.assertEqual(result['error_type'], 'Refused')

    @unittest.skipUnless(sys.platform == 'darwin' and os.environ.get('GITHUB_ACTIONS') == 'true',
                         'unpatched managed-job observation is isolated macOS CI only')
    def test_native_ci_full_managed_job_observation_has_coverage_without_positive_claim(self):
        fixture = self.fixture()
        before = image_fixture.snapshot(fixture.temp)
        records, verified = observation.owned_records(fixture.temp.resolve(), fixture=True)
        result = observation.collect_jobs(records)
        self.assertEqual(result['binding']['checkpoint_sha256'], verified)
        self.assertEqual(result['source'], 'observed')
        self.assertEqual(result['coverage'], observation.COVERAGE)
        for stage in ('sweep_a', 'sweep_b'):
            self.assertEqual(set(result['stages'][stage]), held.expected_keys(records))
        self.assertEqual(result, observation.valid_observation(result, records))
        self.assertFalse(result['admission']); self.assertFalse(result['hold_certified'])
        self.assertEqual(image_fixture.snapshot(fixture.temp), before)
        errors = Counter(fact['error_type'] for stage in ('sweep_a', 'sweep_b')
                         for fact in result['stages'][stage].values() if 'error_type' in fact)
        print('native owned managed-job observation: outcome=%s keys=%d sweeps=2 errors=%s elapsed_ns=%d' %
              (result['outcome'], len(held.expected_keys(records)), json.dumps(dict(errors), sort_keys=True),
               result['budget']['elapsed_ns']), flush=True)


if __name__ == '__main__':
    unittest.main()
