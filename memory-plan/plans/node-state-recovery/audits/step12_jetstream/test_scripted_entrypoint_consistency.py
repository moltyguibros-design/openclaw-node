import contextlib
import copy
import io
import json
import os
import pathlib
import sys
import unittest
from types import SimpleNamespace
from unittest.mock import patch

import scripted_entrypoint_consistency as consistency
import preservation_checks as checks
import preservation_journal as journal
import test_managed_job_observation as fixtures
from test_preservation_journal import tailscale_record


BOOT = 'f' * 64
EXTRA = 'com.openclaw.recorded-fixture'


def supplied(records, boot=BOOT):
    inventory = copy.deepcopy(records[0]['entrypoint_inventory'])
    inventory['loaded'] = copy.deepcopy(records[-1]['entrypoint_loaded'])
    inventory['overrides'] = copy.deepcopy(records[-1]['entrypoint_overrides'])
    for item in inventory['excluded'].values(): item['boot'] = boot
    return {'boot': boot, 'inventory': inventory}


def prepared(test, *, excluded=True, policy=False):
    original = fixtures.guest_fixture.full_entrypoint_evidence
    def inventory(prior):
        value = original(prior)
        value['excluded'] = tailscale_record() if excluded else {}
        value['disabled_artifacts'] = {'/owned/retired.plist.disabled': 'd' * 64}
        for values in value['overrides'].values(): values[EXTRA] = None
        return value
    with patch.object(fixtures.guest_fixture, 'full_entrypoint_evidence', side_effect=inventory):
        fixture = fixtures.prepared(test, policy=policy)
    path = fixture.temp / 'entrypoints.json'
    path.write_bytes(consistency.envelope.encoded(supplied(fixture.records))); path.chmod(0o600)
    return fixture


class Comparison(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        test = SimpleNamespace(addCleanup=cls.addClassCleanup)
        cls.fixture = prepared(test); cls.empty_fixture = prepared(test, excluded=False)

    def setUp(self):
        self.records = copy.deepcopy(self.fixture.records)
        self.value = supplied(self.records)
        self.inventory = self.value['inventory']
        self.label = checks.TAILSCALE_LABEL
        self.exclusion = self.inventory['excluded'][self.label]
        self.managed_label = 'ai.openclaw.gateway'

    def compare(self, value=None):
        return consistency.compare_entrypoints(self.records, self.value if value is None else value)

    def test_honest_recorded_nonempty_fixture_has_narrow_consistent_result(self):
        records, verified = consistency.managed.owned_records(self.fixture.temp.resolve(), fixture=True)
        self.assertEqual(records, self.records)
        self.assertEqual(verified, records[-1]['sha256'])
        self.assertEqual(records[0]['entrypoint_inventory']['excluded'], tailscale_record(), 'exclusion must be recorded before capture')
        self.assertTrue(records[0]['entrypoint_inventory']['disabled_artifacts'])
        result = self.compare()
        self.assertEqual(result['outcome'], 'scripted-entrypoint-consistent', 'honest terminal inventory must be consistent')
        self.assertEqual(result['scope'], consistency.SCOPE, 'scope must remain scripted consistency')
        self.assertEqual(result['source'], 'scripted', 'source must remain scripted')
        self.assertEqual(result['reasons'], [])
        self.assertEqual(result['binding'], consistency.managed.binding(self.records), 'frozen binding must survive')
        self.assertEqual(result['boot'], BOOT, 'supplied boot must survive')
        for flag in ('hold_certified', 'history_certified', 'admission', 'freshness_certified'):
            self.assertIs(result[flag], False, flag + ' must stay false')
        text = consistency.envelope.encoded(result).decode()
        for private in ('/owned/', str(checks.TAILSCALE_PLIST), '"inventory":', '"overrides":', '"excluded":', 'process_policy'):
            self.assertNotIn(private, text, 'raw inventory claims must stay private')

    def test_terminal_adapter_changes_only_three_fields_without_persisting(self):
        before = copy.deepcopy(self.records)
        expected = consistency.terminal_expectations(self.records)
        for unit, state in expected.items():
            actual = self.records[-1]['observations'][unit]
            self.assertEqual({key: state[key] for key in ('loaded', 'running', 'disabled')},
                             {key: actual[key] for key in ('loaded', 'running', 'disabled')}, 'terminal flags must be substituted')
            self.assertEqual({key: value for key, value in state.items() if key not in ('loaded', 'running', 'disabled')},
                             {key: value for key, value in before[0]['prior'][unit].items() if key not in ('loaded', 'running', 'disabled')},
                             'all other baseline fields must stay unchanged')
        self.assertNotEqual(expected, before[0]['prior'])
        with patch.object(journal, 'valid_prior', side_effect=AssertionError('adapter is not a baseline')):
            try: self.compare()
            except consistency.envelope.Refused: self.fail('terminal adapter must accept honest held facts')
        self.assertEqual(self.records, before, 'frozen records must not mutate')

    def test_shared_validators_precede_exact_input_hash(self):
        events = []
        exclusion, inventory, fingerprint = consistency.valid_tailscale_exclusion, consistency.valid_entrypoint_inventory, consistency.envelope.fingerprint
        def validate_excluded(*args): events.append('exclusion'); return exclusion(*args)
        def validate_inventory(*args): events.append('inventory'); return inventory(*args)
        def hashed(*args): events.append('hash'); return fingerprint(*args)
        with patch.object(consistency, 'valid_tailscale_exclusion', side_effect=validate_excluded) as first, \
             patch.object(consistency, 'valid_entrypoint_inventory', side_effect=validate_inventory) as second, \
             patch.object(consistency.envelope, 'fingerprint', side_effect=hashed):
            self.compare()
        self.assertEqual(events, ['exclusion', 'inventory', 'hash'], 'shared validation must precede hashing')
        first.assert_called_once(); second.assert_called_once()

    def test_each_shared_validator_refusal_precedes_hash(self):
        for name in ('valid_tailscale_exclusion', 'valid_entrypoint_inventory'):
            with patch.object(consistency, name, side_effect=consistency.envelope.Refused('shared refusal')), \
                 patch.object(consistency.envelope, 'fingerprint') as fingerprint, self.assertRaises(consistency.envelope.Refused):
                self.compare()
            fingerprint.assert_not_called()

    def test_malformed_outer_boot_inventory_and_exclusion_refuse(self):
        variants = [None, {}, {**self.value, 'extra': True}, {**self.value, 'boot': 'old-boot'},
                    {**self.value, 'boot': True}, {**self.value, 'inventory': None}]
        for field, replacement in (('verified', False), ('excluded', None), ('installed', {}),
                                    ('roots', []), ('overrides', {}), ('loaded', {})):
            value = copy.deepcopy(self.value); value['inventory'][field] = replacement; variants.append(value)
        for value in variants:
            with patch.object(consistency.envelope, 'fingerprint') as fingerprint, self.assertRaises(RuntimeError, msg='malformed supplied claims must refuse'):
                consistency.compare_entrypoints(self.records, value)
            fingerprint.assert_not_called()

    def test_installed_path_roots_and_disabled_artifact_drift_refuse(self):
        changes = [('installed', lambda value: value['installed'][self.managed_label].update(path='/another/gateway.plist')),
                   ('roots', lambda value: value['roots'].append('/another/root')),
                   ('disabled_artifacts', lambda value: value['disabled_artifacts'].update({'/owned/retired.plist.disabled': 'a' * 64}))]
        for reason, change in changes:
            value = copy.deepcopy(self.value); change(value['inventory'])
            result = self.compare(value)
            self.assertEqual(result['outcome'], 'refused', reason + ' drift must refuse')
            self.assertEqual(result['reasons'], [reason], reason + ' reason must survive')

    def test_installed_digest_loaded_and_required_override_shape_are_shared_proof(self):
        variants = []
        value = copy.deepcopy(self.value); value['inventory']['installed'][self.managed_label]['sha256'] = 'a' * 64; variants.append(value)
        for domain in ('gui', 'user', 'system'):
            value = copy.deepcopy(self.value); value['inventory']['loaded'][domain] = [self.managed_label]; variants.append(value)
            value = copy.deepcopy(self.value); del value['inventory']['overrides'][domain][self.managed_label]; variants.append(value)
        for value in variants:
            with self.assertRaises(consistency.envelope.Refused): self.compare(value)

    def test_exact_override_comparison_exceeds_shared_disabled_predicate(self):
        self.inventory['overrides']['system'][self.managed_label] = True
        consistency.valid_entrypoint_inventory(self.inventory, consistency.terminal_expectations(self.records))
        result = self.compare()
        self.assertEqual(result['outcome'], 'refused', 'exact terminal overrides must refuse drift')
        self.assertEqual(result['reasons'], ['overrides'], 'exact override reason must survive')
        self.assertNotEqual(self.records[0]['entrypoint_inventory']['overrides'], self.records[-1]['entrypoint_overrides'])

    def test_every_managed_override_in_each_domain_is_not_an_exemption(self):
        for domain in ('gui', 'user', 'system'):
            for unit in self.records[0]['prior']:
                value = copy.deepcopy(self.value); label = 'ai.openclaw.' + unit
                value['inventory']['overrides'][domain][label] = False if value['inventory']['overrides'][domain][label] is True else True
                try: result = self.compare(value)
                except consistency.envelope.Refused: continue
                self.assertEqual(result['outcome'], 'refused', 'every managed override drift must refuse')
                self.assertIn('overrides', result['reasons'])

    def test_none_false_and_extra_override_keys_are_compared_in_all_domains(self):
        for domain in ('gui', 'user', 'system'):
            for action in ('false', 'missing', 'extra'):
                value = copy.deepcopy(self.value); overrides = value['inventory']['overrides'][domain]
                if action == 'false': overrides[EXTRA] = False
                if action == 'missing': del overrides[EXTRA]
                if action == 'extra': overrides['com.openclaw.new-fixture'] = None
                consistency.valid_entrypoint_inventory(value['inventory'], consistency.terminal_expectations(self.records))
                result = self.compare(value)
                self.assertEqual(result['reasons'], ['overrides'], 'all override keys and values must remain exact')
                self.assertEqual(result['outcome'], 'refused')

    def test_excluded_label_sets_must_match_in_both_empty_directions(self):
        self.inventory['excluded'] = {}
        result = self.compare()
        self.assertEqual(result['reasons'], ['excluded.labels'], 'missing excluded label must refuse')
        value = supplied(self.empty_fixture.records); value['inventory']['excluded'] = tailscale_record()
        value['inventory']['excluded'][self.label]['boot'] = BOOT
        result = consistency.compare_entrypoints(self.empty_fixture.records, value)
        self.assertEqual(result['reasons'], ['excluded.labels'], 'new excluded label must refuse')
        self.assertEqual(result['outcome'], 'refused')
        self.assertEqual(consistency.compare_entrypoints(self.empty_fixture.records, supplied(self.empty_fixture.records))['outcome'],
                         'scripted-entrypoint-consistent')

    def test_plist_wrapper_and_full_app_identity_drift_refuse(self):
        for field in ('plist', 'wrapper', 'app'):
            value = copy.deepcopy(self.value); value['inventory']['excluded'][self.label][field]['sha256'] = 'a' * 64
            result = self.compare(value)
            self.assertEqual(result['outcome'], 'refused', field + ' identity drift must refuse')
            self.assertEqual(result['reasons'], ['excluded.' + field], field + ' identity reason must survive')
        for key, replacement in (('version', '2.0'), ('cdhash', 'a' * 40)):
            value = copy.deepcopy(self.value); value['inventory']['excluded'][self.label]['app'][key] = replacement
            self.assertEqual(self.compare(value)['reasons'], ['excluded.app'], 'full app identity must remain exact')

    def test_shared_exclusion_shape_is_not_a_signature_or_run_measurement(self):
        for field, key, replacement in (('plist', 'path', '/other.plist'), ('wrapper', 'path', '/other-wrapper'),
                                        ('app', 'path', '/other-app'), ('app', 'team_id', 'other'),
                                        ('app', 'bundle_id', 'other'), ('launchd', 'runs', 0),
                                        ('launchd', 'runs', True), ('launchd', 'state', 'running'),
                                        ('launchd', 'last_exit_code', 1), ('launchd', 'disabled', True)):
            value = copy.deepcopy(self.value); value['inventory']['excluded'][self.label][field][key] = replacement
            with self.assertRaises(consistency.envelope.Refused): self.compare(value)

    def test_valid_run_and_boot_dynamics_may_change_while_app_is_fixed(self):
        self.exclusion['launchd']['runs'] = 9
        self.assertNotEqual(self.exclusion['boot'], self.records[0]['entrypoint_inventory']['excluded'][self.label]['boot'])
        self.assertNotEqual(BOOT, self.records[0]['boot'])
        result = self.compare()
        self.assertEqual(result['outcome'], 'scripted-entrypoint-consistent', 'valid run and boot dynamics must not be compared to old boot')
        self.assertFalse(result['freshness_certified'])

    def test_excluded_boot_must_equal_supplied_boot(self):
        self.exclusion['boot'] = '7' * 64
        result = self.compare()
        self.assertEqual(result['outcome'], 'refused', 'excluded boot must match supplied boot')
        self.assertEqual(result['reasons'], ['excluded.boot'])

    def test_hash_binds_full_input_including_supplied_boot(self):
        result = self.compare()
        self.assertEqual(result['input_sha256'], consistency.envelope.fingerprint(self.value), 'hash must bind exact supplied input')
        value = supplied(self.empty_fixture.records); changed = copy.deepcopy(value); changed['boot'] = '7' * 64
        first = consistency.compare_entrypoints(self.empty_fixture.records, value)
        second = consistency.compare_entrypoints(self.empty_fixture.records, changed)
        self.assertNotEqual(first['input_sha256'], second['input_sha256'], 'supplied boot must participate in input digest')

    def test_all_changed_reasons_survive_without_raw_values(self):
        self.inventory['installed'][self.managed_label]['path'] = '/another/gateway.plist'
        self.inventory['roots'].append('/another/root')
        self.inventory['disabled_artifacts']['/owned/retired.plist.disabled'] = 'a' * 64
        self.inventory['overrides']['system'][self.managed_label] = True
        for key in ('plist', 'wrapper', 'app'): self.exclusion[key]['sha256'] = 'a' * 64
        self.exclusion['boot'] = '7' * 64
        self.assertEqual(self.compare()['reasons'], ['installed', 'roots', 'disabled_artifacts', 'overrides',
                                                    'excluded.plist', 'excluded.wrapper', 'excluded.app', 'excluded.boot'])

    def test_comparison_has_no_io_current_boot_clock_or_input_mutation(self):
        before = copy.deepcopy((self.records, self.value))
        with patch('builtins.open', side_effect=AssertionError('IO')), \
             patch.object(consistency.envelope, 'boot_identity', side_effect=AssertionError('current boot')), \
             patch.object(consistency.managed.time, 'monotonic_ns', side_effect=AssertionError('clock')), \
             patch.object(checks, 'capture_entrypoint_inventory', side_effect=AssertionError('live inventory')):
            self.compare()
        self.assertEqual((self.records, self.value), before, 'comparison must not mutate input records or facts')

    def test_every_managed_start_refuses_without_inventing_a_baseline_class(self):
        self.assertTrue(all(state['loaded'] or state['disabled'] for state in self.records[0]['prior'].values()))
        for domain in ('gui', 'user', 'system'):
            for unit in self.records[0]['prior']:
                value = copy.deepcopy(self.value)
                value['inventory']['loaded'][domain] = ['ai.openclaw.' + unit]
                with self.assertRaises(consistency.envelope.Refused): self.compare(value)

    def test_binding_uses_foreign_recorded_uid_not_runtime(self):
        original = fixtures.policy_fixture.recorded_hold
        def foreign(parent):
            value = original(parent); value['metadata_identity']['uid'] = os.getuid() + 1; return value
        with patch.object(fixtures.policy_fixture, 'recorded_hold', side_effect=foreign): fixture = prepared(self)
        self.assertEqual(fixture.frozen(fixture.records)['checkpoint_sha256'], fixture.records[-1]['sha256'])
        result = consistency.compare_entrypoints(fixture.records, supplied(fixture.records))
        self.assertEqual(result['binding']['uid'], os.getuid() + 1, 'binding UID must be recorded rather than runtime')


class Consumer(unittest.TestCase):
    def fixture(self, **kwargs): return prepared(self, **kwargs)
    def consume(self, fixture): return consistency.inspect_owned(fixture.temp.resolve(), fixture=True, scripted=True)

    def test_real_frozen_reader_once_before_comparison_with_no_writes_or_constructors(self):
        fixture = self.fixture(); before = fixtures.image_fixture.snapshot(fixture.temp); events = []
        read, verify, compare = consistency.managed.read_inputs, consistency.managed.verify_frozen_checkpoint, consistency.compare_entrypoints
        def image(*args, **kwargs): events.append('read'); return read(*args, **kwargs)
        def frozen(*args, **kwargs): events.append('verify'); return verify(*args, **kwargs)
        def compare_claims(*args): events.append('compare'); return compare(*args)
        with patch.object(consistency.managed, 'owned_records', wraps=consistency.managed.owned_records) as reader, \
             patch.object(consistency.managed, 'read_inputs', side_effect=image) as inputs, \
             patch.object(consistency.managed, 'verify_frozen_checkpoint', side_effect=frozen) as verifier, \
             patch.object(consistency, 'compare_entrypoints', side_effect=compare_claims), \
             patch.object(checks, 'capture_entrypoint_inventory', side_effect=AssertionError('live inventory')), \
             patch.object(journal.Journal, '__init__', side_effect=AssertionError('Journal')), \
             patch.object(fixtures.restore_only.gate_module.Gate, '__init__', side_effect=AssertionError('Gate')):
            result = self.consume(fixture)
        self.assertEqual(reader.call_count, 1, 'owned reader must run exactly once')
        inputs.assert_called_once(); verifier.assert_called_once()
        self.assertEqual(events, ['read', 'verify', 'compare'], 'frozen verification must precede comparison')
        self.assertEqual(result['outcome'], 'scripted-entrypoint-consistent')
        self.assertEqual(fixtures.image_fixture.snapshot(fixture.temp), before)

    def test_flags_precede_all_input_io(self):
        for fixture, scripted in ((False, False), (False, True), (True, False)):
            with patch.object(consistency.managed, 'owned_records', side_effect=consistency.envelope.Refused('unexpected reader')) as reader, \
                 patch.object(consistency.envelope, 'read_private') as private, \
                 self.assertRaisesRegex(consistency.envelope.Refused, '--fixture and --scripted', msg='both flags must gate IO'):
                consistency.inspect_owned('/unread', fixture=fixture, scripted=scripted)
            reader.assert_not_called(); private.assert_not_called()

    def test_frozen_refusal_prevents_entrypoint_file_read(self):
        fixture = self.fixture(); private = consistency.envelope.read_private; paths = []
        def read(path): paths.append(pathlib.Path(path).name); return private(path)
        with patch.object(consistency.envelope, 'read_private', side_effect=read), \
             patch.object(consistency.managed, 'verify_frozen_checkpoint', side_effect=consistency.envelope.Refused('frozen')), \
             self.assertRaises(consistency.envelope.Refused): self.consume(fixture)
        self.assertNotIn('entrypoints.json', paths, 'frozen refusal must prevent entrypoint read')

    def test_actual_bad_checkpoint_and_foreign_recorded_owner_precede_comparison(self):
        fixture = self.fixture(); (fixture.capture / 'CHECKPOINT.json').write_bytes(b'{}')
        with patch.object(consistency, 'compare_entrypoints') as compare, self.assertRaises(RuntimeError): self.consume(fixture)
        compare.assert_not_called()
        original = fixtures.policy_fixture.recorded_hold
        def foreign(parent):
            value = original(parent); value['metadata_identity']['uid'] = os.getuid() + 1; return value
        with patch.object(fixtures.policy_fixture, 'recorded_hold', side_effect=foreign): fixture = self.fixture()
        with patch.object(consistency, 'compare_entrypoints') as compare, self.assertRaisesRegex(consistency.envelope.Refused, 'reader ownership'):
            self.consume(fixture)
        compare.assert_not_called()

    def test_canonical_private_file_and_wrong_binding_root_refuse(self):
        fixture = self.fixture(); path = fixture.temp / 'entrypoints.json'; raw = path.read_bytes()
        for content, mode in ((raw + b'\n', 0o600), (raw, 0o644)):
            path.write_bytes(content); path.chmod(mode)
            with patch.object(consistency, 'compare_entrypoints') as compare, self.assertRaises(RuntimeError): self.consume(fixture)
            compare.assert_not_called()
        path.write_bytes(raw); path.chmod(0o600)
        target = fixture.temp / 'alias'; path.rename(target); path.symlink_to(target)
        with self.assertRaises(RuntimeError): self.consume(fixture)
        with self.assertRaises(RuntimeError): consistency.inspect_owned(fixture.temp / '..' / fixture.temp.name, fixture=True, scripted=True)

    def test_both_policy_and_exclusion_cases_have_only_scripted_consistency(self):
        for policy in (False, True):
            for excluded in (False, True):
                fixture = self.fixture(policy=policy, excluded=excluded)
                result = self.consume(fixture)
                self.assertEqual(result['outcome'], 'scripted-entrypoint-consistent')
                self.assertEqual(result['source'], 'scripted')
                self.assertFalse(result['freshness_certified'])

    def invoke(self, fixture, flags):
        with patch.object(sys, 'argv', ['scripted_entrypoint_consistency.py', str(fixture.temp), *flags]), \
             contextlib.redirect_stdout(io.StringIO()) as output:
            code = consistency.main()
        raw = output.getvalue(); value = json.loads(raw)
        self.assertEqual(raw, consistency.envelope.encoded(value).decode() + '\n')
        return code, value

    def test_fixture_only_cli_cannot_collect_even_with_benign_inventory(self):
        fixture = self.fixture()
        with patch.object(checks, 'capture_entrypoint_inventory', return_value=supplied(fixture.records)['inventory']) as collector:
            code, value = self.invoke(fixture, ['--fixture'])
        self.assertEqual(code, 2, 'fixture-only CLI must refuse')
        collector.assert_not_called(); self.assertEqual(value['source'], 'scripted')

    def test_cli_consistent_drift_malformed_and_early_error_exit_codes(self):
        fixture = self.fixture(); code, result = self.invoke(fixture, ['--fixture', '--scripted'])
        self.assertEqual(code, 0, 'consistent CLI must exit zero')
        self.assertEqual(result['source'], 'scripted')
        value = supplied(fixture.records); value['inventory']['roots'].append('/another/root')
        (fixture.temp / 'entrypoints.json').write_bytes(consistency.envelope.encoded(value))
        code, result = self.invoke(fixture, ['--fixture', '--scripted'])
        self.assertEqual(code, 2, 'drift CLI must exit two'); self.assertEqual(result['reasons'], ['roots'])
        value['inventory']['verified'] = False; (fixture.temp / 'entrypoints.json').write_bytes(consistency.envelope.encoded(value))
        code, result = self.invoke(fixture, ['--fixture', '--scripted'])
        self.assertEqual(code, 2); self.assertEqual(result['error_type'], 'Refused')
        code, result = self.invoke(fixture, [])
        self.assertEqual(code, 2); self.assertEqual(result['error_type'], 'Refused')
        for flag in ('admission', 'history_certified', 'hold_certified', 'freshness_certified'):
            self.assertIs(result[flag], False)


if __name__ == '__main__': unittest.main()
