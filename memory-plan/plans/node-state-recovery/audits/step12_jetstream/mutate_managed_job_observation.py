import pathlib
import subprocess
import sys


STEP = pathlib.Path(__file__).resolve().parent
MUTANTS = []


def change(name, old, new, test, assertion):
    MUTANTS.append((name, [(old, new)], test, assertion))


coverage = "    require({namespace + '/' + label for namespace, label in pairs} == held.expected_keys(records),\n            'managed-job pair coverage differs')\n"
change('pair-coverage-unchecked', coverage, '', 'Observation.test_pair_coverage_is_checked_against_existing_derivation',
       "Expected 'launchd_service' to not have been called")
for domain in ('gui', 'user', 'system'):
    old = "('gui/%d' % uid, 'user/%d' % uid, 'system')"
    values = ["'gui/%d' % uid", "'user/%d' % uid", "'system'"]
    new = '(' + ', '.join(value for value in values if not value.startswith("'" + domain)) + ')'
    MUTANTS.append(('drop-domain-' + domain, [(old, new), (coverage, '')],
                    'Observation.test_structured_all_domain_pairs_and_exact_order', 'two complete sweeps must be boot bracketed'))
for unit in ('nats-1', 'federation-tick'):
    MUTANTS.append(('drop-unit-' + unit,
                    [("for unit in records[0]['prior'])", "for unit in records[0]['prior'] if unit != '%s')" % unit),
                     (coverage, '')], 'Observation.test_structured_all_domain_pairs_and_exact_order',
                    'two complete sweeps must be boot bracketed'))
loop = "    boot('boot_start')\n    for stage in ('sweep_a', 'sweep_b'):\n"
for stage in ('sweep_a', 'sweep_b'):
    change('drop-' + stage, loop, "    boot('boot_start')\n    for stage in ('%s',):\n" % stage,
           'Observation.test_structured_all_domain_pairs_and_exact_order', 'two complete sweeps must be boot bracketed')
change('reverse-sweeps', loop, "    boot('boot_start')\n    for stage in ('sweep_b', 'sweep_a'):\n",
       'Observation.test_expiry_stops_acquisition_and_retains_all_remaining_keys', 'expiry must retain later-sweep keys')
for stage in ('boot_start', 'boot_end'):
    change('drop-' + stage, "    boot('%s')\n" % stage, '', 'Observation.test_structured_all_domain_pairs_and_exact_order',
           'two complete sweeps must be boot bracketed')
redact = "envelope.redacted_job(envelope.census.launchd_service(namespace, label))"
change('redaction-bypassed', redact, 'envelope.census.launchd_service(namespace, label)',
       'Observation.test_loaded_idle_and_running_are_recordable_redacted_facts', 'loaded facts must remain recordable')
change('post-redaction-type-check-skipped', '                envelope.valid_job(sweep[key])\n', '',
       'Observation.test_only_exact_absence_can_be_unloaded', 'malformed facts must not escape collection')
catch = "            except envelope.ERRORS as error:\n                sweep[key] = {'error_type': type(error).__name__}"
change('primitive-error-becomes-absence', catch, "            except envelope.ERRORS as error:\n                sweep[key] = {'loaded': False}",
       'Observation.test_each_key_error_survives_independently_in_both_sweeps', 'per-key error must survive')
change('timeout-not-recorded', catch, catch.replace('envelope.ERRORS', '(RuntimeError,)'),
       'Observation.test_timeout_and_missing_domain_errors_are_unknown_in_every_domain', 'timeout must stay an error fact')
change('unexpected-error-silenced', catch, catch.replace('envelope.ERRORS', 'Exception'),
       'Observation.test_only_declared_primitive_failures_are_caught', 'unexpected programming errors must propagate')
change('pre-call-expiry-ignored', 'if time.monotonic_ns() - started > WINDOW_NS:', 'if False:',
       'Observation.test_expiry_stops_acquisition_and_retains_all_remaining_keys', 'expiry must stop new census calls')
change('expired-keys-dropped', '                continue\n            try:', '                break\n            try:',
       'Observation.test_expiry_stops_acquisition_and_retains_all_remaining_keys', 'expiry must retain all keys')
change('expired-facts-become-absence', "sweep[key] = {'error_type': 'BudgetExpired'}", "sweep[key] = {'loaded': False}",
       'Observation.test_expiry_stops_acquisition_and_retains_all_remaining_keys', 'expiry must retain current-sweep keys')
change('post-boot-elapsed-ignored', 'elapsed = time.monotonic_ns() - started', 'elapsed = 0',
       'Observation.test_post_boot_expiry_and_exact_boundary', 'post-boot time must be measured')
change('collector-expiry-flag-forged', "value['budget'].update(elapsed_ns=elapsed, expired=elapsed > WINDOW_NS)",
       "value['budget'].update(elapsed_ns=elapsed, expired=False)",
       'Observation.test_post_boot_expiry_and_exact_boundary', 'post-boot expiry must be recomputed')
change('boot-failure-discarded', "            value['failures'].append({'stage': stage, 'error_type': type(error).__name__})", '',
       'Observation.test_each_boot_change_failure_and_incomplete_stage_refuses', 'boot failure must survive')
change('boot-digest-not-validated-at-collection', "            envelope.digest(value['stages'][stage])\n", '',
       'Observation.test_invalid_boot_digest_is_retained_as_a_stage_failure', 'invalid boot must remain a stage failure')
for expression, name, test, assertion in (
        ("any(stages[name] is None for name in STAGES)", 'incomplete-stages',
         'test_each_boot_change_failure_and_incomplete_stage_refuses', 'incomplete equal stages must refuse recording'),
        ("value['failures']", 'stage-failures', 'test_each_boot_change_failure_and_incomplete_stage_refuses',
         'retained failure must refuse recording'),
        ("budget['expired']", 'expired-budget', 'test_post_boot_expiry_and_exact_boundary', 'post-boot expiry must control recording'),
        ("stages['boot_start'] != stages['boot_end']", 'boot-change',
         'test_each_boot_change_failure_and_incomplete_stage_refuses', 'boot change must refuse recording'),
        ("set(sweep) != expected", 'key-coverage', 'test_missing_extra_and_error_keys_refuse_in_each_sweep',
         'equal missing sweeps must refuse recording'),
        ("stages['sweep_a'] != stages['sweep_b']", 'sweep-inequality',
         'test_sweep_inequality_refuses_even_with_claimed_recorded_verdict', 'changed sweeps must refuse recording')):
    change('validator-ignores-' + name, 'if ' + expression + ':', 'if False:', 'Observation.' + test, assertion)
change('validator-ignores-key-error', "                reasons.append(name + '-error:' + key)\n", '',
       'Observation.test_each_key_error_survives_independently_in_both_sweeps', 'any per-key error must refuse recording')
change('validator-trusts-stored-verdict', "result['outcome'] = 'refused' if reasons else 'recorded'", "result['outcome'] = value['outcome']",
       'Observation.test_verdict_recomputed_without_io_or_mutation', 'stored verdict must not control recording')
change('validator-mutates-input', 'result = copy.deepcopy(value)', 'result = value',
       'Observation.test_verdict_recomputed_without_io_or_mutation', 'validator must not mutate its input')
change('frozen-binding-not-compared', "    require(value['binding'] == binding(records), 'managed-job frozen binding differs')\n", '',
       'Observation.test_binding_is_exact_typed_and_bound_to_both_frozen_digests', 'wrong frozen binding must refuse')
change('binding-uid-bool-alias', "    envelope.integer(value['binding']['uid'])\n", '',
       'Observation.test_binding_is_exact_typed_and_bound_to_both_frozen_digests', 'boolean UID alias must refuse')
for field in ('baseline_sha256', 'checkpoint_sha256'):
    change('binding-ignores-' + field, "value['binding'] == binding(records)",
           "{**value['binding'], '%s': binding(records)['%s']} == binding(records)" % (field, field),
           'Observation.test_binding_is_exact_typed_and_bound_to_both_frozen_digests', 'wrong frozen binding must refuse')
change('expiry-shape-not-recomputed',
       "    require(type(budget['expired']) is bool and budget['expired'] == (budget['elapsed_ns'] > WINDOW_NS),\n            'managed-job expiry flag differs')\n", '',
       'Observation.test_schema_budget_claims_and_raw_argument_fields_refuse', 'invalid schema must refuse')
change('fixed-coverage-claim-bypassed',
       "    require(all(value['coverage'][key] is expected for key, expected in COVERAGE.items()),\n            'managed-job coverage claims differ')\n", '',
       'Observation.test_schema_budget_claims_and_raw_argument_fields_refuse', 'invalid schema must refuse')
change('certification-claim-bypassed',
       "    require(all(value[key] is False for key in ('admission', 'history_certified', 'hold_certified')),\n            'managed-job certification claim differs')\n", '',
       'Observation.test_schema_budget_claims_and_raw_argument_fields_refuse', 'invalid schema must refuse')
change('scope-source-claim-bypassed',
       "    require(value['scope'] == SCOPE and value['source'] in ('observed', 'scripted'),\n            'managed-job scope or source differs')\n", '',
       'Observation.test_schema_budget_claims_and_raw_argument_fields_refuse', 'invalid schema must refuse')
change('private-file-not-forced-scripted', "    value['source'] = 'scripted'\n", "    value['source'] = 'scripted' if False else value['source']\n    value['sample_labels'] = None\n",
       'Consumer.test_scripted_claims_are_retained_without_observed_promotion', 'file source must be forced scripted')
change('file-labels-discarded', "{'source': value['source'], 'coverage': copy.deepcopy(value['coverage'])}",
       "{'source': 'scripted', 'coverage': dict(COVERAGE)}", 'Consumer.test_scripted_claims_are_retained_without_observed_promotion',
       'file source and coverage must remain untrusted sample labels')
change('sample-label-schema-bypassed', "        envelope.keys(value['sample_labels']['coverage'], COVERAGE)\n", '',
       'Observation.test_scripted_sample_labels_have_only_bounded_claim_vocabulary', 'sample-label vocabulary must be bounded')
change('flags-relaxed', 'require(fixture and scripted,', 'require(fixture or scripted,',
       'Consumer.test_flags_precede_all_input_io', 'both flags must gate all IO')
MUTANTS.append(('live-cli-route-added', [('require(fixture and scripted,', 'require(fixture or scripted,'),
    ("value = envelope.read_private(pathlib.Path(root) / 'managed-jobs.json')",
     "value = envelope.read_private(pathlib.Path(root) / 'managed-jobs.json') if scripted else collect_jobs(records)")],
    'Consumer.test_fixture_only_cli_cannot_acquire_live_jobs_even_with_benign_census', 'fixture-only CLI must refuse'))
pin = "    require(commitment == {**json.loads(pinned['COMMITTED.json']),\n                           'checkpoint': json.loads(pinned['CHECKPOINT.json'])},\n            'capture commitment differs from the pinned capture record')\n"
change('pin-coherence-skipped', pin, '', 'Consumer.test_pin_coherence_and_frozen_refusal_precede_observation_read',
       "Expected 'read_inputs' to not have been called")
read = "found = read_inputs(root / 'data', commitment)"
change('image-read-duplicated', read, read + "\n    read_inputs(root / 'data', commitment)",
       'Consumer.test_honest_frozen_path_once_then_scripted_validator_without_constructors_or_writes',
       "Expected 'read_inputs' to have been called once")
verify = "    verified = verify_frozen_checkpoint(capture_dir, found['records'],\n                                        configs=found['configs'], binary=found['binary'], home=found['home'])\n"
change('frozen-verifier-skipped', verify, "    verified = {'checkpoint_sha256': found['records'][-1]['sha256']}\n",
       'Consumer.test_honest_frozen_path_once_then_scripted_validator_without_constructors_or_writes',
       "Expected 'verify_frozen_checkpoint' to have been called once")
change('frozen-verifier-duplicated', verify, verify + verify,
       'Consumer.test_honest_frozen_path_once_then_scripted_validator_without_constructors_or_writes',
       "Expected 'verify_frozen_checkpoint' to have been called once")
change('metadata-empty-accepted', "found['read'] and all", 'all',
       'Consumer.test_every_read_owner_and_nonempty_metadata_bind_to_recorded_uid', 'every reader owner must match')
change('one-reader-owner-enough', "all(row['uid'] == uid for row in found['read'])", "any(row['uid'] == uid for row in found['read'])",
       'Consumer.test_every_read_owner_and_nonempty_metadata_bind_to_recorded_uid', 'every reader owner must match')
change('recorded-owner-inferred-from-image', "uid = held.owner_uid(found['records'])", "uid = found['read'][0]['uid']",
       'Consumer.test_every_read_owner_and_nonempty_metadata_bind_to_recorded_uid', 'every reader owner must match')
change('runtime-owner-substitution', "all(row['uid'] == uid for row in found['read'])",
       "all(row['uid'] == envelope.os.getuid() for row in found['read'])",
       'Consumer.test_foreign_recorded_owner_is_not_replaced_by_runtime_uid', 'foreign recorded owner must refuse')
for name, replacement, assertion in (('always-refuse', 'return 2', 'recorded scripted CLI must exit zero'),
                                     ('always-record', 'return 0', 'refused CLI must exit two')):
    change('cli-' + name, "return 0 if result['outcome'] == 'recorded' else 2", replacement,
           'Consumer.test_cli_canonical_recorded_and_refused_exit_codes', assertion)


def main():
    controls = subprocess.run([sys.executable, '-m', 'unittest',
                              *sorted({'test_managed_job_observation.' + row[2] for row in MUTANTS})],
                             cwd=STEP, capture_output=True, text=True, timeout=240)
    if controls.returncode:
        print(controls.stdout + controls.stderr)
        return 1
    print('unmutated managed-job controls: all passed', flush=True)
    original = (STEP / 'managed_job_observation.py').read_text()
    for name, replacements, test, assertion in MUTANTS:
        source = original
        for old, new in replacements:
            if source.count(old) != 1:
                raise RuntimeError(name + ': mutation anchor differs')
            source = source.replace(old, new)
        code = ("import managed_job_observation as c; exec(compile(%r,c.__file__,'exec'),c.__dict__); "
                "import unittest; r=unittest.TextTestRunner().run(unittest.defaultTestLoader.loadTestsFromName(%r)); "
                "raise SystemExit(not r.wasSuccessful())" % (source, 'test_managed_job_observation.' + test))
        result = subprocess.run([sys.executable, '-c', code], cwd=STEP, capture_output=True, text=True, timeout=180)
        output = result.stdout + result.stderr
        if not (result.returncode == 1 and 'FAIL: ' + test.split('.')[-1] in output
                and assertion in output and 'ERROR:' not in output):
            print(name + ': not an intended-assertion kill\n' + output)
            return 1
        print(name + ': intended assertion killed', flush=True)
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
