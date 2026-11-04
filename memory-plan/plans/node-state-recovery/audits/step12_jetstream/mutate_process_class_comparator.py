import pathlib
import subprocess
import sys


STEP = pathlib.Path(__file__).resolve().parent
MUTANTS = []


def change(name, old, new, test, assertion):
    MUTANTS.append((name, [(old, new)], test, assertion))


change('envelope-validation-skipped', 'checked = envelope.valid_envelope(observation, policy)',
       'checked = observation', 'Classes.test_unknown_unstable_partial_expired_and_forged_recorded_gate_before_classes',
       'recomputed envelope must gate class work')
MUTANTS.append(('envelope-validation-after-expected-keys', [
    ('checked = envelope.valid_envelope(observation, policy)', 'checked = observation'),
    ("keys = {row['label']: expected_key(row) for row in expected}",
     "keys = {row['label']: expected_key(row) for row in expected}\n    checked = envelope.valid_envelope(observation, policy)")],
    'Classes.test_validator_precedes_even_expected_class_key_work', 'envelope validation must be first'))
change('input-verdict-trusted', "if checked['outcome'] != 'recorded':", "if observation['outcome'] != 'recorded':",
       'Classes.test_unknown_unstable_partial_expired_and_forged_recorded_gate_before_classes',
       'recomputed envelope must gate class work')
change('input-refusal-reasons-trusted', "copy.deepcopy(checked['reasons'])", "copy.deepcopy(observation['reasons'])",
       'Classes.test_unknown_unstable_partial_expired_and_forged_recorded_gate_before_classes',
       'recomputed refusal reasons must survive')
change('exact-input-envelope-hash', 'envelope.fingerprint(observation)', 'envelope.fingerprint(checked)',
       'Classes.test_source_coverage_and_exact_input_hashes_survive_without_promotion', 'hash must bind exact input envelope')
change('exact-policy-hash', 'envelope.fingerprint(policy)', "'0' * 64",
       'Classes.test_source_coverage_and_exact_input_hashes_survive_without_promotion', 'hash must bind exact policy')
change('source-promotion', "'source': checked['source']", "'source': 'observed'",
       'Classes.test_source_coverage_and_exact_input_hashes_survive_without_promotion', 'source must not be promoted')
change('coverage-promotion', "copy.deepcopy(checked['coverage'])", "{**checked['coverage'], 'enumeration': 'full'}",
       'Classes.test_source_coverage_and_exact_input_hashes_survive_without_promotion', 'coverage must not be promoted')
change('input-coverage-trusted', "copy.deepcopy(checked['coverage'])", "copy.deepcopy(observation['coverage'])",
       'Classes.test_source_coverage_and_exact_input_hashes_survive_without_promotion', 'coverage must not be promoted')
key = "return tuple(row[key] for key in ('executable', 'executable_sha256', 'arguments_sha256',\n                                      'uid', 'gid', 'cwd'))"
for field in ('executable', 'executable_sha256', 'arguments_sha256', 'uid', 'gid', 'cwd'):
    changed = key.replace("'" + field + "',", '') if field != 'cwd' else key.replace(", 'cwd'", '')
    change('drop-key-' + field, key, changed, 'Classes.test_each_class_key_field_is_required_independently',
           field + ' mismatch must refuse')
change('argv-join-boundaries', 'return class_key(envelope.diagnostic.redacted(row))',
       "return class_key({**envelope.diagnostic.redacted(row), 'arguments_sha256': envelope.hashlib.sha256(''.join(row['arguments']).encode()).hexdigest()})",
       'Classes.test_expected_digest_calls_unchanged_redaction_for_empty_and_unicode_arguments',
       'NUL-joined argv must preserve boundaries')
for field, test in (('pid', 'test_pid_is_not_a_cross_boot_class_key'),
                    ('start_sec', 'test_start_sec_is_not_a_cross_boot_class_key'),
                    ('start_usec', 'test_start_usec_is_not_a_cross_boot_class_key'),
                    ('name', 'test_name_is_not_a_cross_boot_class_key'),
                    ('ppid', 'test_ppid_is_attribution_only_and_not_a_launchd_class_key')):
    change('forbidden-key-' + field, 'key = class_key(row)', "key = class_key(row) + (row['" + field + "'],)",
           'Classes.' + test, 'launchd class must not include ppid' if field == 'ppid' else 'cross-boot class must survive')
change('namespace-from-process-uid', "'%s/%d' % (domain, policy['uid'])", "'%s/%d' % (domain, row['uid'])",
       'Classes.test_policy_owner_namespace_is_independent_of_process_uid', 'namespace must use policy owner')
change('nonrunning-attribution', "and anchor['j0'].get('state') == 'running'", '',
       'Classes.test_nonrunning_with_pid_is_recorded_but_fails_launchd_attribution', 'nonrunning anchor must not attribute')
change('wrong-row-attribution', "and anchor['generation'] == envelope.generation(row)", '',
       'Classes.test_coherent_wrong_row_generation_cannot_attribute_a_matching_class',
       'anchor must name this candidate generation')
change('own-launchd-anchor-label', "return any(name == key and anchor['j0']['loaded']",
       "return any(anchor['j0']['loaded']",
       'Classes.test_shared_plist_swapped_launchd_labels_cannot_borrow_each_others_anchor',
       'each label must use its own launchd anchor')
change('authored-plist-binding', "and anchor['plist']['sha256'] == attribution['plist_sha256']", '',
       'Classes.test_authored_plist_hash_is_separate_from_recorded_anchor_identity', 'authored plist digest must match')
change('strict-parent-birth', 'birth(parent) < birth(row)', 'birth(parent) <= birth(row)',
       'Classes.test_equal_or_later_parent_birth_cannot_be_reused', 'parent birth must be strictly earlier')
change('parent-reference-label', "assigned.get(parent['pid']) == attribution['label']", "parent['pid'] in assigned",
       'Classes.test_parent_assigned_to_another_label_cannot_supply_attribution', 'parent label must match the reference')
change('absent-parent-exemption', 'return (parent is not None and birth(parent) < birth(row)',
       'return (parent is None or birth(parent) < birth(row)',
       'Classes.test_absent_parent_and_pid_one_are_not_exempt', 'unobservable parent must refuse')
change('ppid-not-tied-to-parent', "parent = by_pid.get(row['ppid'])", 'parent = next(iter(by_pid.values()), None)',
       'Classes.test_absent_parent_and_pid_one_are_not_exempt', 'unobservable parent must refuse')
change('unassigned-parent-exemption', "assigned.get(parent['pid'])", "assigned.get(parent['pid'], attribution['label'])",
       'Classes.test_unassigned_parent_does_not_assign_a_child', 'unassigned parent must not attribute child')
change('ambiguous-parent-permission', "result['ambiguous'].append({'process': copy.deepcopy(row), 'labels': candidates})",
       "result['ambiguous'].append({'process': copy.deepcopy(row), 'labels': candidates})\n            assigned[row['pid']] = candidates[0]",
       'Classes.test_ambiguous_parent_does_not_assign_a_child', 'ambiguous parent must not attribute child')
change('birth-order-omitted', "sorted(rows, key=lambda row: (*birth(row), row['pid']))", 'rows',
       'Classes.test_parent_attribution_uses_already_unique_label_and_strict_birth', 'birth order must resolve the parent first')
change('birth-tie-pid-order-omitted', "(*birth(row), row['pid'])", 'birth(row)',
       'Classes.test_equal_birth_tie_and_report_order_are_deterministic', 'report order must follow birth then pid')
change('expectation-label-order-omitted', "sorted(policy['expected'], key=lambda row: row['label'])", "policy['expected']",
       'Classes.test_ambiguous_candidates_are_not_first_pick_or_count_solved', 'all candidates must remain ambiguous')
change('ambiguous-first-pick', 'elif len(candidates) != 1:', 'elif False:',
       'Classes.test_ambiguous_candidates_are_not_first_pick_or_count_solved', 'all candidates must remain ambiguous')
change('missing-cardinality', "result['missing'] = {item['label']: item['count'] - len(counts[item['label']]) for item in expected\n                         if len(counts[item['label']]) < item['count']}", "result['missing'] = {}",
       'Classes.test_missing_and_launchd_count_two_are_exact_deficits', 'missing count must be exact')
change('excess-cardinality', "result['excess'] = {item['label']: len(counts[item['label']]) - item['count'] for item in expected\n                        if len(counts[item['label']]) > item['count']}", "result['excess'] = {}",
       'Classes.test_excess_is_not_at_least_cardinality', 'excess count must refuse')
change('empty-policy-permission', "for row in sorted(rows, key=lambda row: (*birth(row), row['pid'])):",
       "for row in (sorted(rows, key=lambda row: (*birth(row), row['pid'])) if expected else []):",
       'Classes.test_empty_policy_accepts_only_empty_included_table_after_envelope_gate', 'empty policy must reject in-scope rows')
change('class-candidate-labels-lost', "'class_candidates': [item['label'] for item in classes]", "'class_candidates': []",
       'Classes.test_report_contains_no_policy_or_raw_argv_and_retains_class_candidate_labels',
       'class candidates must distinguish failed attribution')
change('unexpected-row-lost', "result['unexpected'].append({'process': copy.deepcopy(row),\n                                         'class_candidates': [item['label'] for item in classes]})", 'pass',
       'Classes.test_report_contains_no_policy_or_raw_argv_and_retains_class_candidate_labels', 'every unexpected row must be retained')
change('admission-claim', "'admission': False, 'history_certified': False}", "'admission': True, 'history_certified': False}",
       'Classes.test_recorded_exact_class_is_consistent_without_admission_or_history', 'True is not false')
change('history-claim', "'admission': False, 'history_certified': False}", "'admission': False, 'history_certified': True}",
       'Classes.test_recorded_exact_class_is_consistent_without_admission_or_history', 'True is not false')
change('clean-claim', "result['outcome'] = 'class-consistent'", "result['outcome'] = 'clean'",
       'Classes.test_recorded_exact_class_is_consistent_without_admission_or_history', 'exact class must match')
change('policy-emission', "if checked['outcome'] != 'recorded':",
       "result['process_policy'] = policy\n    if checked['outcome'] != 'recorded':",
       'Classes.test_report_contains_no_policy_or_raw_argv_and_retains_class_candidate_labels', 'raw argv sentinel must not be emitted')
call = 'policy, observation = envelope.owned_envelope(root, fixture=fixture, scripted=scripted)'
change('fixture-forwarding', call, call.replace('fixture=fixture', 'fixture=True'),
       'Consumer.test_viable_fixture_flag_and_checkpoint_fences_precede_class_work', 'Refused not raised')
change('scripted-forwarding', call, call.replace('scripted=scripted', 'scripted=False'),
       'Consumer.test_shared_owned_reader_is_called_once_and_keeps_policy_private', 'scripted=True')
change('duplicate-owned-read', call, 'envelope.owned_envelope(root, fixture=fixture, scripted=scripted)\n    ' + call,
       'Consumer.test_shared_owned_reader_is_called_once_and_keeps_policy_private', 'called once')
change('raw-envelope-emission', 'return compare_classes(policy, observation)',
       "return {**compare_classes(policy, observation), 'stages': observation['stages']}",
       'Consumer.test_cli_prints_only_class_report_and_refusal_exit_without_writes', 'CLI must emit only class report')
change('cli-positive-exit', "return 0 if result['outcome'] == 'class-consistent' else 2", 'return 2',
       'Consumer.test_cli_prints_only_class_report_and_refusal_exit_without_writes', 'class-consistent CLI must exit zero')
change('cli-refusal-exit', "return 0 if result['outcome'] == 'class-consistent' else 2", 'return 0',
       'Consumer.test_cli_prints_only_class_report_and_refusal_exit_without_writes', 'refused CLI must exit two')


def main():
    controls = subprocess.run([sys.executable, '-m', 'unittest',
                              *sorted({'test_process_class_comparator.' + row[2] for row in MUTANTS})],
                             cwd=STEP, capture_output=True, text=True, timeout=240)
    if controls.returncode:
        print(controls.stdout + controls.stderr)
        return 1
    print('unmutated process-class controls: all passed', flush=True)
    original = (STEP / 'process_class_comparator.py').read_text()
    for name, replacements, test, assertion in MUTANTS:
        source = original
        for old, new in replacements:
            if source.count(old) != 1:
                raise RuntimeError(name + ': mutation anchor differs')
            source = source.replace(old, new)
        code = ("import process_class_comparator as c; "
                "exec(compile(%r,c.__file__,'exec'),c.__dict__); "
                "import unittest; r=unittest.TextTestRunner().run(unittest.defaultTestLoader.loadTestsFromName(%r)); "
                "raise SystemExit(not r.wasSuccessful())" %
                (source, 'test_process_class_comparator.' + test))
        result = subprocess.run([sys.executable, '-c', code], cwd=STEP,
                                capture_output=True, text=True, timeout=180)
        output = result.stdout + result.stderr
        if not (result.returncode == 1 and 'FAIL: ' + test.split('.')[-1] in output
                and assertion in output and 'ERROR:' not in output):
            print(name + ': not an intended-assertion kill\n' + output)
            return 1
        print(name + ': intended assertion killed', flush=True)
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
