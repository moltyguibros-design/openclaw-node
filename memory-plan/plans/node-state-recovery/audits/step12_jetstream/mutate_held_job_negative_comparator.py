import pathlib
import subprocess
import sys


STEP = pathlib.Path(__file__).resolve().parent
MUTANTS = []


def change(name, old, new, test, assertion):
    MUTANTS.append((name, [(old, new)], test, assertion))


change('recorded-uid-bool-alias', "type(identity.get('uid')) is int", "isinstance(identity.get('uid'), int)",
       'Comparison.test_owner_uid_missing_boolean_negative_or_wrong_type_refuses', 'invalid recorded owner must refuse')
change('negative-uid', " and identity['uid'] >= 0", '',
       'Comparison.test_owner_uid_missing_boolean_negative_or_wrong_type_refuses', 'invalid recorded owner must refuse')
change('missing-owner-default', ".get('metadata_identity')", ".get('metadata_identity') or {'uid': 0}",
       'Comparison.test_owner_uid_missing_boolean_negative_or_wrong_type_refuses', 'invalid recorded owner must refuse')
change('namespace-uid-discarded', 'uid = owner_uid(records)', 'uid = 0',
       'Comparison.test_namespaces_use_recorded_uid_without_calling_runtime_uid', 'namespace must use recorded UID')
for domain in ('gui', 'user', 'system'):
    old = "('gui/%d' % uid, 'user/%d' % uid, 'system')"
    values = ["'gui/%d' % uid", "'user/%d' % uid", "'system'"]
    new = '(' + ', '.join(value for value in values if not value.startswith("'" + domain)) + ')'
    change('omit-domain-' + domain, old, new,
           'Comparison.test_member1_and_inactive_federation_are_in_all_domains', 'all managed units and domains must be covered')
for unit in ('nats-1', 'federation-tick'):
    change('omit-unit-' + unit, "for unit in records[0]['prior']}",
           "for unit in records[0]['prior'] if unit != '%s'}" % unit,
           'Comparison.test_member1_and_inactive_federation_are_in_all_domains', 'all managed units and domains must be covered')
change('missing-bucket-dropped', "sorted(expected - jobs.keys())", '[]',
       'Comparison.test_missing_expected_key_is_retained_and_refuses', 'missing bucket must retain the key')
change('extra-bucket-dropped', "sorted(jobs.keys() - expected)", '[]',
       'Comparison.test_extra_key_is_retained_without_interpreting_key_or_value', 'extra bucket must retain the key')
change('unknown-bucket-dropped', "result['unknown'].append({'key': key, 'error_type': type(error).__name__})", 'pass',
       'Comparison.test_null_and_malformed_negative_are_unknown', 'malformed fact must be unknown')
change('loaded-bucket-dropped', "result['unexpected_loaded'].append(key)", 'pass',
       'Comparison.test_every_unit_in_each_domain_refuses_when_loaded', 'every loaded managed key must refuse')
change('idle-without-pid-exempt', "if jobs[key]['loaded']:", "if jobs[key]['loaded'] and jobs[key]['pid'] is not None:",
       'Comparison.test_idle_loaded_job_without_pid_is_unexpected', 'idle loaded without PID must refuse')
change('only-running-refused', "if jobs[key]['loaded']:", "if jobs[key]['loaded'] and jobs[key]['state'] == 'running':",
       'Comparison.test_loaded_with_pid_in_nonrunning_state_is_unexpected', 'loaded state must not grant an exemption')
change('malformed-loaded-bypassed', 'envelope.valid_job(jobs[key])',
       "envelope.valid_job({'loaded': False} if isinstance(jobs[key], dict) and jobs[key].get('loaded') is True else jobs[key])",
       'Comparison.test_malformed_loaded_fact_is_unknown_not_negative', 'malformed loaded must stay unknown')
change('catch-all-unknown', 'except envelope.Refused as error:', 'except Exception as error:',
       'Comparison.test_validator_non_refusal_exception_is_not_silenced', 'only Refused may become unknown')
change('valid-job-skipped', 'envelope.valid_job(jobs[key])', 'None',
       'Comparison.test_pure_no_io_no_input_mutation_and_existing_validator_reused', 'existing valid_job must check every expected fact')
for bucket, test, assertion in (
        ('missing', 'test_missing_expected_key_is_retained_and_refuses', 'missing key must refuse'),
        ('extra', 'test_extra_key_is_retained_without_interpreting_key_or_value', 'extra key must refuse'),
        ('unknown', 'test_null_and_malformed_negative_are_unknown', 'unknown key must refuse'),
        ('unexpected_loaded', 'test_idle_loaded_job_without_pid_is_unexpected', 'refused')):
    old = "('missing', 'extra', 'unknown', 'unexpected_loaded')"
    new = '(' + ', '.join(repr(item) for item in ('missing', 'extra', 'unknown', 'unexpected_loaded') if item != bucket) + ')'
    change('verdict-ignores-' + bucket, old, new, 'Comparison.' + test, assertion)
for field in ('jobs', 'baseline', 'checkpoint'):
    old = { 'jobs': 'envelope.fingerprint(jobs)', 'baseline': "records[0]['sha256']", 'checkpoint': "records[-1]['sha256']"}[field]
    change('hash-' + field, old, "'0' * 64", 'Comparison.test_hashes_bind_exact_jobs_and_frozen_record_digests',
           {'jobs': 'jobs hash must bind exact input', 'baseline': 'baseline hash must bind frozen record',
            'checkpoint': 'checkpoint hash must bind frozen record'}[field])
for field, old, new, assertion in (
        ('source', "'source': 'scripted'", "'source': 'observed'", 'source must stay scripted'),
        ('sampled', "'sampled': True", "'sampled': False", 'sampled must stay true'),
        ('continuous', "'continuous': False", "'continuous': True", 'continuous must stay false'),
        ('admission', "'admission': False", "'admission': True", 'admission must stay false'),
        ('history', "'history_certified': False", "'history_certified': True", 'history_certified must stay false'),
        ('hold', "'hold_certified': False", "'hold_certified': True", 'hold_certified must stay false')):
    if field in ('admission', 'history', 'hold'):
        full = "'outcome': 'refused', 'admission': False, 'history_certified': False, 'hold_certified': False}"
        old, new = full, full.replace(old, new)
    change('claim-' + field, old + (", 'sampled'" if field == 'source' else ''),
           new + (", 'sampled'" if field == 'source' else ''),
           'Comparison.test_complete_negative_table_is_scripted_consistency_only', assertion)
change('job-value-leak', '    return result\n\n\ndef inspect_owned',
       "    result['jobs'] = jobs\n    return result\n\n\ndef inspect_owned",
       'Comparison.test_report_excludes_job_values_and_baseline_policy', 'job values and policy must stay private')
change('policy-leak', '    return result\n\n\ndef inspect_owned',
       "    result['process_policy'] = records[0].get('process_policy')\n    return result\n\n\ndef inspect_owned",
       'Comparison.test_report_excludes_job_values_and_baseline_policy', 'job values and policy must stay private')
change('fixture-or-scripted', 'require(fixture and scripted,', 'require(fixture or scripted,',
       'Consumer.test_flags_precede_any_io', 'both flags must gate all IO')
pin = "    require(commitment == {**json.loads(pinned['COMMITTED.json']),\n                           'checkpoint': json.loads(pinned['CHECKPOINT.json'])},\n            'capture commitment differs from the pinned capture record')\n"
change('pin-coherence-skipped', pin, '', 'Consumer.test_pin_coherence_refuses_before_image_read',
       "Expected 'read_inputs' to not have been called")
call = "found = read_inputs(root / 'data', commitment)"
change('duplicate-image-read', call, call + "\n    read_inputs(root / 'data', commitment)",
       'Consumer.test_honest_frozen_reader_once_then_compare_without_writes_or_constructors', "Expected 'read_inputs' to have been called once")
verify = "    verified = verify_frozen_checkpoint(capture_dir, found['records'], table=table,\n                                        configs=found['configs'], binary=found['binary'], home=found['home'])\n"
change('frozen-verifier-skipped', verify, "    verified = {'checkpoint_sha256': found['records'][-1]['sha256']}\n",
       'Consumer.test_honest_frozen_reader_once_then_compare_without_writes_or_constructors',
       "Expected 'verify_frozen_checkpoint' to have been called once")
change('duplicate-frozen-verifier', verify, verify + verify,
       'Consumer.test_honest_frozen_reader_once_then_compare_without_writes_or_constructors',
       "Expected 'verify_frozen_checkpoint' to have been called once")
end = "    result = compare_held_jobs(found['records'], jobs)\n"
MUTANTS.append(('compare-before-frozen-verifier', [(verify, ''), (end, end + verify)],
                'Consumer.test_frozen_verifier_refusal_prevents_compare', "Expected 'compare_held_jobs' to not have been called"))
change('owner-inferred-from-image', "uid = owner_uid(found['records'])", "uid = found['read'][0]['uid']",
       'Consumer.test_reader_metadata_all_rows_bind_to_recorded_owner', 'every read owner must match')
change('empty-reader-metadata', "found['read'] and all", 'all',
       'Consumer.test_reader_metadata_all_rows_bind_to_recorded_owner', 'every read owner must match')
change('one-reader-owner-enough', "all(row['uid'] == uid for row in found['read'])", "any(row['uid'] == uid for row in found['read'])",
       'Consumer.test_reader_metadata_all_rows_bind_to_recorded_owner', 'every read owner must match')
change('cli-always-refused', "return 0 if result['outcome'] == 'held-jobs-negative-consistent' else 2", 'return 2',
       'Consumer.test_cli_positive_refusal_and_minimal_error_exits_keep_values_private', 'consistent CLI must exit zero')
change('cli-always-positive', "return 0 if result['outcome'] == 'held-jobs-negative-consistent' else 2", 'return 0',
       'Consumer.test_cli_positive_refusal_and_minimal_error_exits_keep_values_private', 'refused CLI must exit two')


def main():
    controls = subprocess.run([sys.executable, '-m', 'unittest',
                              *sorted({'test_held_job_negative_comparator.' + row[2] for row in MUTANTS})],
                             cwd=STEP, capture_output=True, text=True, timeout=240)
    if controls.returncode:
        print(controls.stdout + controls.stderr)
        return 1
    print('unmutated held-job controls: all passed', flush=True)
    original = (STEP / 'held_job_negative_comparator.py').read_text()
    for name, replacements, test, assertion in MUTANTS:
        source = original
        for old, new in replacements:
            if source.count(old) != 1:
                raise RuntimeError(name + ': mutation anchor differs')
            source = source.replace(old, new)
        code = ("import held_job_negative_comparator as c; exec(compile(%r,c.__file__,'exec'),c.__dict__); "
                "import unittest; r=unittest.TextTestRunner().run(unittest.defaultTestLoader.loadTestsFromName(%r)); "
                "raise SystemExit(not r.wasSuccessful())" % (source, 'test_held_job_negative_comparator.' + test))
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
