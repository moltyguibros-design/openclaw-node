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
from types import SimpleNamespace
from unittest.mock import patch

import held_job_negative_comparator as comparator
import boot_process_policy
import preservation_journal
import restore_only
import test_boot_process_policy as policy_fixture
import test_capture_checkpoint as guest_fixture
import test_stopped_journal_inputs as image_fixture


SECRET = 'held-job-command-private-sentinel-2741'


def jobs_for(records, uid=None):
    if uid is None:
        uid = records[0]['prior']['scheduler-heartbeat']['execution_hold']['metadata_identity']['uid']
    jobs = {}
    for domain in ('gui', 'user', 'system'):
        namespace = domain if domain == 'system' else domain + '/' + str(uid)
        for unit in records[0]['prior']:
            jobs[namespace + '/ai.openclaw.' + unit] = {'loaded': False}
    return jobs


def loaded(state='waiting', pid=None):
    return {'loaded': True, 'state': state, 'pid': pid, 'program': '/' + SECRET,
            'arguments_sha256': 'd' * 64, 'plist': '/' + SECRET + '.plist'}


def prepared(test, policy=False):
    parent = pathlib.Path(os.environ.get('GITHUB_WORKSPACE', pathlib.Path.home())).resolve()
    tempdir = patch.object(tempfile, 'gettempdir', return_value=str(parent))
    tempdir.start()
    test.addCleanup(tempdir.stop)
    root = parent / ('openclaw-owned-held-jobs-' + secrets.token_hex(8))
    root.mkdir(mode=0o700)
    test.addCleanup(shutil.rmtree, root)
    mask = os.umask(0o077)
    try:
        with patch.object(guest_fixture.tempfile, 'TemporaryDirectory',
                          return_value=SimpleNamespace(name=str(root), cleanup=lambda: None)):
            fixture = policy_fixture.captured(test, image=True, absent=not policy)
    finally:
        os.umask(mask)
    for name, value in (('held-jobs.json', jobs_for(fixture.records)),):
        path = root / name
        path.write_bytes(comparator.envelope.encoded(value)); path.chmod(0o600)
    found = comparator.read_inputs(fixture.data, fixture.commitment)
    comparator.verify_frozen_checkpoint(fixture.capture, found['records'],
                                        configs=found['configs'], binary=found['binary'], home=found['home'])
    return fixture


class Comparison(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.fixture = prepared(SimpleNamespace(addCleanup=cls.addClassCleanup))

    def setUp(self):
        self.records = copy.deepcopy(self.fixture.records)
        self.jobs = jobs_for(self.records)
        self.key = sorted(self.jobs)[0]

    def evaluate(self):
        return comparator.compare_held_jobs(self.records, self.jobs)

    def test_complete_negative_table_is_scripted_consistency_only(self):
        result = self.evaluate()
        self.assertEqual(result['outcome'], 'held-jobs-negative-consistent', 'complete negative table must pass')
        self.assertEqual(len(self.jobs), 3 * len(preservation_journal.UNITS))
        self.assertEqual(result['source'], 'scripted', 'source must stay scripted')
        self.assertTrue(result['sampled'], 'sampled must stay true')
        self.assertFalse(result['continuous'], 'continuous must stay false')
        for field in ('admission', 'history_certified', 'hold_certified'):
            self.assertFalse(result[field], field + ' must stay false')
        self.assertEqual(result['scope'], comparator.SCOPE)

    def test_every_unit_in_each_domain_refuses_when_loaded(self):
        for key in sorted(self.jobs):
            with self.subTest(key=key):
                jobs = {**self.jobs, key: loaded('running', 517)}
                result = comparator.compare_held_jobs(self.records, jobs)
                self.assertEqual(result['unexpected_loaded'], [key], 'every loaded managed key must refuse')
                self.assertEqual(result['outcome'], 'refused')

    def test_member1_and_inactive_federation_are_in_all_domains(self):
        expected = comparator.expected_keys(self.records)
        self.assertEqual(expected, set(self.jobs), 'all managed units and domains must be covered')
        for unit in ('nats-1', 'federation-tick'):
            self.assertEqual(sum(key.endswith('/ai.openclaw.' + unit) for key in expected), 3)
        self.assertGreater(len(expected), comparator.envelope.ANCHOR_CAP)

    def test_namespaces_use_recorded_uid_without_calling_runtime_uid(self):
        self.records[0]['prior']['scheduler-heartbeat']['execution_hold']['metadata_identity']['uid'] = 76543
        self.jobs = jobs_for(self.records, uid=76543)
        with patch.object(comparator.envelope.os, 'getuid', side_effect=AssertionError('runtime UID')):
            result = self.evaluate()
        self.assertEqual(result['outcome'], 'held-jobs-negative-consistent', 'namespace must use recorded UID')
        self.assertIn('gui/76543/ai.openclaw.nats-1', comparator.expected_keys(self.records))

    def test_owner_uid_missing_boolean_negative_or_wrong_type_refuses(self):
        hold = self.records[0]['prior']['scheduler-heartbeat']['execution_hold']
        for value in (None, {}, {'uid': True}, {'uid': False}, {'uid': -1}, {'uid': '501'}):
            hold['metadata_identity'] = value
            with self.subTest(value=value), self.assertRaisesRegex(comparator.envelope.Refused, 'recorded owner UID',
                                                                  msg='invalid recorded owner must refuse'):
                self.evaluate()

    def test_zero_uid_is_valid_and_not_an_absence_sentinel(self):
        self.records[0]['prior']['scheduler-heartbeat']['execution_hold']['metadata_identity']['uid'] = 0
        self.jobs = jobs_for(self.records)
        self.assertEqual(self.evaluate()['outcome'], 'held-jobs-negative-consistent', 'zero UID must remain valid')

    def test_missing_expected_key_is_retained_and_refuses(self):
        del self.jobs[self.key]
        result = self.evaluate()
        self.assertEqual(result['missing'], [self.key], 'missing bucket must retain the key')
        self.assertEqual(result['outcome'], 'refused', 'missing key must refuse')

    def test_extra_key_is_retained_without_interpreting_key_or_value(self):
        self.jobs['arbitrary-extra-key'] = None
        result = self.evaluate()
        self.assertEqual(result['extra'], ['arbitrary-extra-key'], 'extra bucket must retain the key')
        self.assertEqual(result['unknown'], [])
        self.assertEqual(result['unexpected_loaded'], [])
        self.assertEqual(result['outcome'], 'refused', 'extra key must refuse')

    def test_null_and_malformed_negative_are_unknown(self):
        for fact in (None, [], False, {'loaded': False, 'pid': None}, {'loaded': 0}, {'loaded': 'false'}):
            self.jobs[self.key] = fact
            with self.subTest(fact=fact):
                result = self.evaluate()
                self.assertEqual(result['unknown'], [{'key': self.key, 'error_type': 'Refused'}],
                                 'malformed fact must be unknown')
                self.assertEqual(result['outcome'], 'refused', 'unknown key must refuse')

    def test_malformed_loaded_fact_is_unknown_not_negative(self):
        fact = loaded(); del fact['program']; self.jobs[self.key] = fact
        result = self.evaluate()
        self.assertEqual(result['unknown'], [{'key': self.key, 'error_type': 'Refused'}],
                         'malformed loaded must stay unknown')
        self.assertEqual(result['unexpected_loaded'], [])
        self.assertEqual(result['outcome'], 'refused')

    def test_idle_loaded_job_without_pid_is_unexpected(self):
        self.jobs[self.key] = loaded()
        result = self.evaluate()
        self.assertEqual(result['unexpected_loaded'], [self.key], 'idle loaded without PID must refuse')
        self.assertEqual(result['unknown'], [])
        self.assertEqual(result['outcome'], 'refused', 'loaded key must refuse')

    def test_loaded_with_pid_in_nonrunning_state_is_unexpected(self):
        self.jobs[self.key] = loaded(pid=517)
        self.assertEqual(self.evaluate()['unexpected_loaded'], [self.key], 'loaded state must not grant an exemption')

    def test_all_four_buckets_survive_and_sort_deterministically(self):
        first, second, third, fourth = sorted(self.jobs)[:4]
        del self.jobs[first]
        self.jobs[second] = None; self.jobs[third] = []; self.jobs[fourth] = loaded()
        self.jobs['z-extra'] = loaded(); self.jobs['a-extra'] = {}
        result = self.evaluate()
        self.assertEqual(result['missing'], [first])
        self.assertEqual(result['extra'], ['a-extra', 'z-extra'], 'extra order must be sorted')
        self.assertEqual([row['key'] for row in result['unknown']], [second, third], 'every unknown must survive in order')
        self.assertEqual(result['unexpected_loaded'], [fourth])
        reversed_jobs = dict(reversed(list(self.jobs.items())))
        self.assertEqual(result, comparator.compare_held_jobs(self.records, reversed_jobs), 'report must be deterministic')

    def test_multiple_loaded_entries_are_not_first_pick(self):
        keys = sorted(self.jobs)[:3]
        for key in keys: self.jobs[key] = loaded()
        self.assertEqual(self.evaluate()['unexpected_loaded'], keys, 'every loaded entry must survive')

    def test_string_keyed_object_is_required_before_hash_or_validation(self):
        for value in ([], None, {1: {'loaded': False}}):
            with self.subTest(value=value), patch.object(comparator.envelope, 'fingerprint') as hashed, \
                 patch.object(comparator.envelope, 'valid_job') as validate, \
                 self.assertRaisesRegex(comparator.envelope.Refused, 'string-keyed', msg='table schema must refuse'):
                comparator.compare_held_jobs(self.records, value)
            hashed.assert_not_called(); validate.assert_not_called()

    def test_hashes_bind_exact_jobs_and_frozen_record_digests(self):
        result = self.evaluate()
        self.assertEqual(result['jobs_sha256'], comparator.envelope.fingerprint(self.jobs), 'jobs hash must bind exact input')
        self.assertEqual(result['baseline_sha256'], self.records[0]['sha256'], 'baseline hash must bind frozen record')
        self.assertEqual(result['checkpoint_sha256'], self.records[-1]['sha256'], 'checkpoint hash must bind frozen record')
        self.jobs[self.key] = loaded()
        self.assertNotEqual(self.evaluate()['jobs_sha256'], result['jobs_sha256'])

    def test_pure_no_io_no_input_mutation_and_existing_validator_reused(self):
        before = comparator.envelope.encoded([self.records, self.jobs])
        with patch.object(comparator.envelope.census, 'launchd_service', side_effect=AssertionError('launchd IO')), \
             patch.object(pathlib.Path, 'resolve', side_effect=AssertionError('path IO')), \
             patch.object(comparator.envelope, 'read_private', side_effect=AssertionError('file IO')), \
             patch.object(comparator.envelope, 'valid_job', wraps=comparator.envelope.valid_job) as validate:
            self.evaluate()
        self.assertEqual(validate.call_count, len(self.jobs), 'existing valid_job must check every expected fact')
        self.assertEqual(comparator.envelope.encoded([self.records, self.jobs]), before)

    def test_validator_non_refusal_exception_is_not_silenced(self):
        with patch.object(comparator.envelope, 'valid_job', side_effect=ValueError('not a Refused')), \
             self.assertRaisesRegex(ValueError, 'not a Refused', msg='only Refused may become unknown'):
            self.evaluate()

    def test_report_excludes_job_values_and_baseline_policy(self):
        self.jobs[self.key] = loaded()
        self.records[0]['process_policy'] = {'unprotected': SECRET}
        text = comparator.envelope.encoded(self.evaluate()).decode()
        for forbidden in (SECRET, 'd' * 64, '"program"', '"arguments_sha256"', '"plist"', '"process_policy"', '"jobs"'):
            self.assertNotIn(forbidden, text, 'job values and policy must stay private')


class Consumer(unittest.TestCase):
    def fixture(self, policy=False):
        return prepared(self, policy=policy)

    def consume(self, fixture):
        return comparator.inspect_owned(fixture.temp.resolve(), fixture=True, scripted=True)

    def test_honest_frozen_reader_once_then_compare_without_writes_or_constructors(self):
        fixture = self.fixture()
        before = image_fixture.snapshot(fixture.temp)
        events = []; read, verify, compare = comparator.read_inputs, comparator.verify_frozen_checkpoint, comparator.compare_held_jobs
        def image(*args, **kwargs): events.append('read'); return read(*args, **kwargs)
        def frozen(*args, **kwargs): events.append('verify'); return verify(*args, **kwargs)
        def comparison(*args, **kwargs): events.append('compare'); return compare(*args, **kwargs)
        with patch.object(comparator, 'read_inputs', side_effect=image) as reader, \
             patch.object(comparator, 'verify_frozen_checkpoint', side_effect=frozen) as verifier, \
             patch.object(comparator, 'compare_held_jobs', side_effect=comparison), \
             patch.object(preservation_journal.Journal, '__init__', side_effect=AssertionError('Journal construction')), \
             patch.object(restore_only.gate_module.Gate, '__init__', side_effect=AssertionError('Gate construction')):
            result = self.consume(fixture)
        reader.assert_called_once(); verifier.assert_called_once()
        self.assertEqual(events, ['read', 'verify', 'compare'], 'frozen verification must precede comparison')
        self.assertEqual(result['outcome'], 'held-jobs-negative-consistent')
        self.assertEqual(image_fixture.snapshot(fixture.temp), before)

    def test_policy_present_and_absent_both_have_identical_narrow_verdict(self):
        for policy in (False, True):
            fixture = self.fixture(policy=policy)
            self.assertEqual('process_policy' in fixture.records[0], policy)
            result = self.consume(fixture)
            self.assertEqual(result['outcome'], 'held-jobs-negative-consistent', 'policy presence must not gate comparison')
            self.assertEqual(result['source'], 'scripted')
            self.assertNotIn('process_policy', result)

    def test_flags_precede_any_io(self):
        for fixture, scripted in ((False, False), (True, False), (False, True)):
            with patch.object(comparator.envelope, 'private_dir') as directory, \
                 patch.object(comparator.envelope, 'read_private') as read, \
                 self.assertRaisesRegex(comparator.envelope.Refused, '--fixture and --scripted',
                                        msg='both flags must gate all IO'):
                comparator.inspect_owned('/not-read', fixture=fixture, scripted=scripted)
            directory.assert_not_called(); read.assert_not_called()

    def test_pin_coherence_refuses_before_image_read(self):
        fixture = self.fixture()
        real = comparator.require_committed(fixture.capture)
        with patch.object(comparator, 'require_committed', return_value={**real, 'capture_nonce': 'f' * 64}), \
             patch.object(comparator, 'read_inputs') as read, \
             patch.object(comparator, 'compare_held_jobs') as compare:
            try: self.consume(fixture)
            except RuntimeError: pass
        read.assert_not_called(); compare.assert_not_called()

    def test_frozen_verifier_refusal_prevents_compare(self):
        fixture = self.fixture()
        with patch.object(comparator, 'verify_frozen_checkpoint', side_effect=comparator.envelope.Refused('frozen refusal')), \
             patch.object(comparator, 'compare_held_jobs') as compare:
            try: self.consume(fixture)
            except comparator.envelope.Refused: pass
            compare.assert_not_called()

    def test_actual_broken_checkpoint_and_receipt_refuse_before_compare(self):
        for broken in ('CHECKPOINT.json', 'node.lock.state.json'):
            fixture = self.fixture()
            path = fixture.capture / broken if broken == 'CHECKPOINT.json' else image_fixture.preservation(fixture.data) / broken
            path.write_bytes(b'{}')
            with patch.object(comparator, 'compare_held_jobs') as compare, self.assertRaises(RuntimeError):
                self.consume(fixture)
            compare.assert_not_called()

    def test_reader_metadata_all_rows_bind_to_recorded_owner(self):
        fixture = self.fixture()
        found = comparator.read_inputs(fixture.data, fixture.commitment)
        uid = comparator.owner_uid(found['records'])
        self.assertTrue(found['read'])
        variants = [[{**row, 'uid': uid + 1} for row in found['read']],
                    [*found['read'][:-1], {**found['read'][-1], 'uid': uid + 1}], []]
        for rows in variants:
            with patch.object(comparator, 'read_inputs', return_value={**found, 'read': rows}), \
                 patch.object(comparator, 'compare_held_jobs') as compare, \
                 self.assertRaisesRegex(comparator.envelope.Refused, 'reader ownership', msg='every read owner must match'):
                self.consume(fixture)
            compare.assert_not_called()

    def test_foreign_recorded_owner_refuses_even_when_every_image_file_has_runtime_owner(self):
        recorded = policy_fixture.recorded_hold
        uid = os.getuid()
        def foreign(parent):
            hold = recorded(parent)
            hold['metadata_identity']['uid'] = uid + 1
            return hold
        with patch.object(policy_fixture, 'recorded_hold', side_effect=foreign):
            fixture = self.fixture()
        self.assertEqual(comparator.owner_uid(fixture.records), uid + 1)
        found = comparator.read_inputs(fixture.data, fixture.commitment)
        self.assertTrue(found['read'])
        self.assertEqual({row['uid'] for row in found['read']}, {uid})
        with patch.object(comparator, 'compare_held_jobs') as compare, \
             self.assertRaisesRegex(comparator.envelope.Refused, 'reader ownership',
                                    msg='foreign recorded owner must refuse'):
            self.consume(fixture)
        compare.assert_not_called()

    def test_private_literal_root_and_input_fences(self):
        fixture = self.fixture(); root = fixture.temp.resolve()
        alias = root.with_name('openclaw-owned-held-jobs-' + secrets.token_hex(8)); alias.symlink_to(root)
        self.addCleanup(alias.unlink)
        with self.assertRaises(RuntimeError): comparator.inspect_owned(alias, fixture=True, scripted=True)
        for target in (root, root / 'capture', root / 'data', root / 'capture' / 'WINDOW_PINS.json', root / 'held-jobs.json'):
            mode = target.stat().st_mode & 0o777
            target.chmod(0o755 if target.is_dir() else 0o644)
            try:
                with patch.object(comparator, 'compare_held_jobs') as compare, self.assertRaises(RuntimeError):
                    self.consume(fixture)
                compare.assert_not_called()
            finally: target.chmod(mode)

    def test_canonical_input_and_file_symlink_are_refused(self):
        fixture = self.fixture(); path = fixture.temp / 'held-jobs.json'; raw = path.read_bytes()
        path.write_bytes(b' ' + raw)
        with self.assertRaisesRegex(RuntimeError, 'canonical'): self.consume(fixture)
        path.write_bytes(raw); alias = fixture.temp / 'alias.json'; path.rename(alias); path.symlink_to(alias)
        with self.assertRaisesRegex(RuntimeError, 'literal'): self.consume(fixture)

    def test_owner_mismatch_in_existing_private_root_guard_precedes_compare(self):
        fixture = self.fixture(); uid = os.getuid()
        with patch.object(comparator.envelope.os, 'getuid', return_value=uid + 1), \
             patch.object(comparator, 'compare_held_jobs') as compare, self.assertRaises(RuntimeError):
            self.consume(fixture)
        compare.assert_not_called()

    def test_pin_coherence_sequence_matches_existing_policy_reader_textually(self):
        text = pathlib.Path(boot_process_policy.__file__).read_text()
        expected = text[text.index('    pinned = require_captured(capture_dir)', text.index('def image_process_policy')):]
        expected = expected[:expected.index('    found = read_inputs')]
        self.assertIn(expected, pathlib.Path(comparator.__file__).read_text())

    def test_cli_positive_refusal_and_minimal_error_exits_keep_values_private(self):
        fixture = self.fixture(); root = fixture.temp.resolve(); before = image_fixture.snapshot(root)
        arguments = [comparator.__file__, str(root), '--fixture', '--scripted']
        with patch.object(sys, 'argv', arguments), contextlib.redirect_stdout(io.StringIO()) as out:
            self.assertEqual(comparator.main(), 0, 'consistent CLI must exit zero')
        result = json.loads(out.getvalue()); self.assertEqual(result['source'], 'scripted')
        self.assertEqual(image_fixture.snapshot(root), before)
        jobs = jobs_for(fixture.records); jobs[sorted(jobs)[0]] = loaded()
        (root / 'held-jobs.json').write_bytes(comparator.envelope.encoded(jobs))
        with patch.object(sys, 'argv', arguments), contextlib.redirect_stdout(io.StringIO()) as out:
            self.assertEqual(comparator.main(), 2, 'refused CLI must exit two')
        self.assertNotIn(SECRET, out.getvalue(), 'CLI must not emit job values')
        completed = subprocess.run([sys.executable, comparator.__file__, str(root)], text=True, capture_output=True, timeout=15)
        self.assertEqual(completed.returncode, 2)
        self.assertEqual(json.loads(completed.stdout)['outcome'], 'refused')
        self.assertFalse(json.loads(completed.stdout)['hold_certified'])


if __name__ == '__main__':
    unittest.main()
