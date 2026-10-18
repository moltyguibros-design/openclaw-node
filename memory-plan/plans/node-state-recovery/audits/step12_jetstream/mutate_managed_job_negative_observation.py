import pathlib
import subprocess
import sys


STEP = pathlib.Path(__file__).resolve().parent
MUTANTS = []


def change(name, old, new, test, assertion):
    MUTANTS.append((name, [(old, new)], test, assertion))


gate = "    if checked['outcome'] != 'recorded':"
change('input-verdict-trusted', gate, "    if value['outcome'] != 'recorded':",
       'Comparison.test_forged_recorded_with_error_never_calls_comparator', "Expected 'compare_held_jobs' to not have been called")
change('recorded-gate-skipped', gate, '    if False:',
       'Comparison.test_forged_recorded_with_error_never_calls_comparator', "Expected 'compare_held_jobs' to not have been called")
valid = '    checked = managed.valid_observation(value, records)'
change('validation-bypassed', valid, '    checked = copy.deepcopy(value)',
       'Comparison.test_exact_input_hash_and_recomputed_copied_fields', 'stored refusal must be recomputed')
change('comparison-before-validation', valid,
       "    held.compare_held_jobs(records, value['stages']['sweep_a'])\n" + valid,
       'Comparison.test_forged_recorded_with_error_never_calls_comparator', "Expected 'compare_held_jobs' to not have been called")
change('hash-before-validation', valid, '    envelope.fingerprint(value)\n' + valid,
       'Comparison.test_malformed_input_validates_before_hash_or_comparison', "Expected 'fingerprint' to not have been called")
change('validator-duplicated', valid, valid + '\n' + valid,
       'Comparison.test_validator_runs_once_before_hash_and_comparison', 'validation must precede hashing and comparison')
change('hashing-recomputed-copy', 'envelope.fingerprint(value)', 'envelope.fingerprint(checked)',
       'Comparison.test_exact_input_hash_and_recomputed_copied_fields', 'hash must bind exact input')
change('observation-refusal-phase-promoted', "'phase': 'observation'", "'phase': 'negative'",
       'Comparison.test_forged_recorded_with_error_never_calls_comparator', 'invalid observation must stay in observation phase')
change('negative-phase-not-reported', "result['phase'] = 'negative'", "result['phase'] = 'observation'",
       'Comparison.test_complete_negatives_preserve_nested_result_and_claim_limits', 'recorded observations must reach negative phase')
change('observation-refusal-reasons-lost', "copy.deepcopy(checked['reasons'])", '[]',
       'Comparison.test_forged_recorded_with_error_never_calls_comparator', 'recomputed refusal reasons must survive')
change('observation-refusal-fake-negative', "'negative': None", "'negative': {}",
       'Comparison.test_forged_recorded_with_error_never_calls_comparator', 'invalid observation must have no negative result')
compare = "held.compare_held_jobs(records, checked['stages']['sweep_a'])"
change('loaded-facts-rewritten-as-absence', compare,
       "held.compare_held_jobs(records, {key: {'loaded': False} for key in checked['stages']['sweep_a']})",
       'Comparison.test_loaded_idle_and_running_are_passed_verbatim_and_refuse', 'validated sweep must pass verbatim')
change('nested-source-promoted', "    if result['negative']['outcome'] == 'held-jobs-negative-consistent':",
       "    result['negative']['source'] = checked['source']\n    if result['negative']['outcome'] == 'held-jobs-negative-consistent':",
       'Comparison.test_complete_negatives_preserve_nested_result_and_claim_limits', 'nested comparator result must stay exact')
change('nested-refusal-ignored', "if result['negative']['outcome'] == 'held-jobs-negative-consistent':", 'if True:',
       'Comparison.test_nested_verdict_controls_top_outcome', 'nested refusal must control top outcome')
change('nested-success-never-accepted', "if result['negative']['outcome'] == 'held-jobs-negative-consistent':", 'if False:',
       'Comparison.test_complete_negatives_preserve_nested_result_and_claim_limits', 'complete negatives must be consistent')
change('top-success-promoted', "result['outcome'] = 'managed-jobs-negative-consistent'", "result['outcome'] = 'admitted'",
       'Comparison.test_complete_negatives_preserve_nested_result_and_claim_limits', 'complete negatives must be consistent')
change('wrapper-scope-promoted', "{'scope': SCOPE, 'observation_sha256'", "{'scope': 'live admission', 'observation_sha256'",
       'Comparison.test_complete_negatives_preserve_nested_result_and_claim_limits', 'wrapper scope must stay narrow')
flags = "'admission': False, 'history_certified': False, 'hold_certified': False}"
for flag in ('admission', 'history_certified', 'hold_certified'):
    change(flag + '-claim-added', flags, flags.replace("'%s': False" % flag, "'%s': True" % flag),
           'Comparison.test_complete_negatives_preserve_nested_result_and_claim_limits', flag + ' must stay false')
reader = '    records, verified = managed.owned_records(root, fixture=fixture)'
read = "    value = envelope.read_private(pathlib.Path(root) / 'managed-jobs.json')"
change('owned-image-reader-duplicated', reader, reader + '\n' + reader,
       'Consumer.test_real_frozen_reader_once_before_comparison_without_writes_or_constructors', 'owned frozen reader must run exactly once')
change('observation-file-before-frozen-refusal', reader + '\n' + read, read + '\n' + reader,
       'Consumer.test_frozen_refusal_prevents_observation_file_read', 'frozen refusal must prevent observation read')
change('flags-relaxed', 'require(fixture and scripted,', 'require(fixture or scripted,',
       'Consumer.test_flags_precede_any_input_io', 'both flags must gate IO')
change('file-source-not-forced', "    value['source'] = 'scripted'\n", '',
       'Consumer.test_file_provenance_is_scripted_and_claims_are_retained', 'file source must be forced scripted')
change('file-claims-discarded', "value['sample_labels'] = {'source': value['source'], 'coverage': copy.deepcopy(value['coverage'])}",
       "value['sample_labels'] = {'source': 'scripted', 'coverage': dict(managed.COVERAGE)}",
       'Consumer.test_file_provenance_is_scripted_and_claims_are_retained', 'file claims must survive under sample labels')
MUTANTS.append(('live-cli-route-added', [('require(fixture and scripted,', 'require(fixture or scripted,'),
                                      (read, '    value = managed.collect_jobs(records)')],
                'Consumer.test_fixture_only_cli_never_scans_even_with_benign_census', 'fixture-only CLI must refuse'))
exit_line = "return 0 if result['outcome'] == 'managed-jobs-negative-consistent' else 2"
for name, replacement, assertion in (('always-refuse', 'return 2', 'consistent CLI must exit zero'),
                                     ('always-succeed', 'return 0', 'loaded CLI must exit two')):
    change('cli-' + name, exit_line, replacement,
           'Consumer.test_canonical_cli_positive_loaded_and_envelope_refusal_exits', assertion)


def main():
    controls = subprocess.run([sys.executable, '-m', 'unittest',
                              *sorted({'test_managed_job_negative_observation.' + row[2] for row in MUTANTS})],
                             cwd=STEP, capture_output=True, text=True, timeout=240)
    if controls.returncode:
        print(controls.stdout + controls.stderr); return 1
    print('unmutated managed-job negative controls: all passed', flush=True)
    original = (STEP / 'managed_job_negative_observation.py').read_text()
    for name, replacements, test, assertion in MUTANTS:
        source = original
        for old, new in replacements:
            if source.count(old) != 1: raise RuntimeError(name + ': mutation anchor differs')
            source = source.replace(old, new)
        code = ("import managed_job_negative_observation as c; exec(compile(%r,c.__file__,'exec'),c.__dict__); "
                "import unittest; r=unittest.TextTestRunner().run(unittest.defaultTestLoader.loadTestsFromName(%r)); "
                "raise SystemExit(not r.wasSuccessful())" % (source, 'test_managed_job_negative_observation.' + test))
        result = subprocess.run([sys.executable, '-c', code], cwd=STEP, capture_output=True, text=True, timeout=180)
        output = result.stdout + result.stderr
        if not (result.returncode == 1 and 'FAIL: ' + test.split('.')[-1] in output
                and assertion in output and 'ERROR:' not in output):
            print(name + ': not an intended-assertion kill\n' + output); return 1
        print(name + ': intended assertion killed', flush=True)
    return 0


if __name__ == '__main__': raise SystemExit(main())
