import pathlib
import subprocess
import sys

STEP = pathlib.Path(__file__).resolve().parent
MUTANTS = [
    ('exact-schemas', 'set(value) == set(expected)', 'set(expected) <= set(value)',
     'Envelope.test_exact_schema_rejects_raw_arguments_and_embedded_old_verdicts', 'Refused not raised'),
    ('strict-integers', 'type(value) is int and value >= minimum', 'isinstance(value, int) and value >= minimum',
     'Envelope.test_missing_fields_malformed_samples_rows_and_unknowns_refuse', 'Refused not raised'),
    ('outer-boot-expectations', "expectations(bound, target['boot_start'])", "expectations(bound, raw['boot'])",
     'Envelope.test_inner_boot_failure_keeps_unknown_and_reaches_existing_compare', 'inner boot failure must reach'),
    ('unknown-retention', "included=report['unexpected'], unknown=report['unknown']", "included=report['unexpected'], unknown=[]",
     'Envelope.test_every_raw_unknown_entry_survives_including_duplicates_and_global', 'every unknown entry must survive'),
    ('excluded-full-row-fingerprint', 'fingerprint(diagnostic.redacted(row))', 'fingerprint(generation(row))',
     'Envelope.test_excluded_code_argv_cwd_ppid_changes_between_passes_refuse', 'excluded full-row change must refuse'),
    ('other-uid-scope-shortcut', "report = diagnostic.compare(raw, expectations(bound, target['boot_start']))",
     "report = {'unexpected': [diagnostic.redacted(row) for row in raw['processes'] if row['uid'] == bound['uid']], 'excluded_pids': [row['pid'] for row in raw['processes'] if row['uid'] != bound['uid']], 'unknown': raw['unknown'], 'expectations_sha256': fingerprint(expectations(bound, target['boot_start'])), 'errors': []}",
     'Envelope.test_scope_composes_existing_helper_and_whole_argv_resolution', 'root-scoped other-UID row must be included'),
    ('same-uid-exclusion', "if any(row['uid'] == policy['uid'] for row in observed['excluded']):", 'if False:',
     'Envelope.test_same_uid_cannot_be_excluded_by_serialized_facts', 'refused'),
    ('pid-coverage', "if represented != set(observed['before']) | set(observed['after']):", 'if False:',
     'Envelope.test_missing_rows_in_both_passes_still_refuse_coverage', 'refused'),
    ('unknown-refusal', "if observed['unknown']:", 'if False:',
     'Envelope.test_stability_unknown_and_coverage_cannot_be_asserted_by_stored_verdict', 'refused'),
    ('unstable-refusal', "if observed['unstable']:", 'if False:',
     'Envelope.test_stability_unknown_and_coverage_cannot_be_asserted_by_stored_verdict', 'refused'),
    ('cross-pass-row-comparison', "if a['included'] != b['included'] or a['excluded'] != b['excluded']:", 'if False:',
     'Envelope.test_included_row_change_and_scope_disagreement_refuse', 'refused'),
    ('outer-boot-comparison', "if stages['boot_start'] != stages['boot_end']:", 'if False:',
     'Envelope.test_outer_and_each_pass_boot_mismatch_refuse', 'refused'),
    ('inner-boot-comparison', "if observed['boot'] != stages['boot_start']:", 'if False:',
     'Envelope.test_outer_and_each_pass_boot_mismatch_refuse', 'refused'),
    ('scope-binding', "scoped['expectations_sha256'] != fingerprint(", "False and scoped['expectations_sha256'] != fingerprint(",
     'Envelope.test_policy_and_each_scope_binding_refuse_independently', 'refused'),
    ('scope-errors', "if scoped['errors']:", 'if False:',
     'Envelope.test_scope_errors_and_interval_order_refuse', 'refused'),
    ('scope-interval-order', "sa['monotonic_ns']['end'] > sb['monotonic_ns']['start']", 'False',
     'Envelope.test_scope_errors_and_interval_order_refuse', 'refused'),
    ('anchor-coverage', 'if anchors is not None and set(anchors) != expected_anchors:', 'if False:',
     'Envelope.test_anchor_coverage_and_error_markers_are_independent', 'refused'),
    ('anchor-error-marker', "if anchor['error'] is not None:", 'if False:',
     'Envelope.test_anchor_coverage_and_error_markers_are_independent', 'refused'),
    ('launchd-read-bracket', 'j0 is None or j1 is None or j0 != j1', 'j0 is None or j1 is None',
     'Envelope.test_launchd_bracket_generation_and_plist_changes_refuse_independently', 'refused'),
    ('generation-tie', "if gen is None or gen['pid'] != pid or any(\n                    pid not in table or generation(table[pid]) != gen for table in rows):", 'if False:',
     'Envelope.test_launchd_bracket_generation_and_plist_changes_refuse_independently', 'refused'),
    ('plist-identity-bracket', "elif info['before'] != info['after']:", 'elif False:',
     'Envelope.test_launchd_bracket_generation_and_plist_changes_refuse_independently', 'refused'),
    ('negative-anchor-fabrication', "if anchor['generation'] is not None or anchor['plist'] is not None:", 'if False:',
     'Envelope.test_anchor_coverage_and_error_markers_are_independent', 'refused'),
    ('anchor-error-conversion', "except ERRORS as error:\n        value['error'] = {'stage': stage, 'error_type': type(error).__name__}",
     "except () as error:\n        value['error'] = {'stage': stage, 'error_type': type(error).__name__}",
     'Envelope.test_anchor_errors_are_facts_and_never_escape', 'anchor failures must remain anchor facts'),
    ('second-launchd-read', "value['j1'] = redacted_job(census.launchd_service(namespace, label))", "value['j1'] = copy.deepcopy(value['j0'])",
     'Envelope.test_unloaded_and_idle_are_known_negatives_with_two_reads', 'every negative anchor needs J1'),
    ('second-plist-identity', "value['plist']['after'] = file_identity(path)", "value['plist']['after'] = copy.deepcopy(value['plist']['before'])",
     'Envelope.test_launchd_bracket_generation_and_plist_changes_refuse_independently', 'refused'),
    ('anchor-cap-before-io', "require(len(bound['anchors']) <= ANCHOR_CAP, 'observation anchor cap exceeded')", 'pass',
     'Envelope.test_anchor_cap_refuses_before_any_boot_or_process_io', 'not have been called'),
    ('expiry-stops-collection', "require(elapsed <= WINDOW_NS, 'observation acceptance window expired')", 'pass',
     'Envelope.test_budget_expiry_stops_further_collection_and_retains_partial_facts', 'not have been called'),
    ('final-timestamp', "value['budget'].update(elapsed_ns=offset())", 'pass',
     'Envelope.test_final_acceptance_window_boundary_is_checked_after_completed_stages', 'final acceptance timestamp must be checked'),
    ('expired-verdict', "if budget['expired']:", 'if False:',
     'Envelope.test_expired_and_partial_serialized_envelopes_cannot_claim_recorded', 'refused'),
    ('acceptance-window-widened', 'WINDOW_NS = 120_000_000_000', 'WINDOW_NS = 240_000_000_000',
     'Envelope.test_acceptance_budget_and_anchor_cap_are_fixed_contract_values', '120000000000'),
    ('second-process-pass-reused', 'raw_b = diagnostic.observe()', 'raw_b = copy.deepcopy(raw_a)',
     'Envelope.test_collector_order_and_two_scope_stages_are_explicit', 'Lists differ'),
    ('namespace-from-expectation-uid', "'%s/%d' % (domain, policy['uid'])", "'%s/%d' % (domain, row['uid'])",
     'Envelope.test_namespace_uses_policy_owner_not_process_uid', 'Lists differ'),
    ('scripted-provenance', "    value['sample_labels'] = {'source': value['source'], 'enumeration': value['coverage']['enumeration'],\n                              'attribution': value['coverage']['attribution']}\n    value['source'] = 'scripted'\n    value['coverage']['enumeration'] = 'scripted'\n    value['coverage']['attribution'] = 'scripted'", '',
     'Consumer.test_scripted_file_cannot_claim_observed_or_full', 'scripted'),
    ('fixture-flag', "require(fixture, 'production process observation envelope is disabled')", 'pass',
     'Consumer.test_viable_prepared_fixture_still_requires_flag', 'Refused not raised'),
    ('fixture-root-name', "re.fullmatch(r'openclaw-owned-envelope-[0-9a-f]{16}', root.name)", 'True',
     'Consumer.test_viable_private_fixture_with_wrong_name_refuses_before_reader', 'Refused not raised'),
    ('private-canonical-input', "require(encoded(value) == raw, 'envelope input is not canonical')", 'pass',
     'Consumer.test_canonical_private_single_link_table_is_required', 'not have been called'),
    ('private-file-mode', 'and stat.S_IMODE(before.st_mode) == 0o600', '',
     'Consumer.test_root_and_each_fixed_input_fence_precede_reader_and_collection', 'not have been called'),
    ('private-file-single-link', 'and before.st_nlink == 1', '',
     'Consumer.test_canonical_private_single_link_table_is_required', 'Refused not raised'),
    ('private-file-byte-bound', 'regular_content(path, FILE_LIMIT, keep_bytes=True)', 'regular_content(path, 2 * FILE_LIMIT, keep_bytes=True)',
     'Consumer.test_private_reader_byte_bound_and_read_identity_are_independent', 'Refused not raised'),
    ('private-read-identity', "require((before.st_dev, before.st_ino, before.st_ctime_ns) ==\n            (after.st_dev, after.st_ino, after.st_ctime_ns), 'envelope input changed while read')", 'pass',
     'Consumer.test_private_reader_byte_bound_and_read_identity_are_independent', 'Refused not raised'),
    ('consumer-policy-owner', "require(policy['uid'] == os.getuid(), 'envelope policy owner differs')", 'pass',
     'Consumer.test_policy_owner_and_roots_are_separate_owned_consumer_observations', 'not raised'),
    ('consumer-policy-root-boundary', '(path == root or root in path.parents) and path.resolve(strict=True) == path', 'path.resolve(strict=True) == path',
     'Consumer.test_policy_owner_and_roots_are_separate_owned_consumer_observations', 'not raised'),
    ('consumer-policy-root-literal', 'and path.resolve(strict=True) == path\n                and path.stat().st_uid == os.getuid()', 'and path.stat().st_uid == os.getuid()',
     'Consumer.test_policy_owner_and_roots_are_separate_owned_consumer_observations', 'Refused not raised'),
    ('policy-emission', 'return collect_envelope(policy)', "return {**collect_envelope(policy), 'process_policy': policy}",
     'Consumer.test_honest_prepared_fixture_is_read_without_construction_or_writes', 'binding'),
    ('admission-claim', "value['admission'] is False", 'True',
     'Envelope.test_enumeration_labels_are_never_promoted', 'Refused not raised'),
    ('history-claim', "value['history_certified'] is False", 'True',
     'Envelope.test_enumeration_labels_are_never_promoted', 'Refused not raised'),
    ('physical-exclusion-claim', "'physical_exclusion': False", "'physical_exclusion': True",
     'Envelope.test_enumeration_labels_are_never_promoted', 'Refused not raised'),
]


def main():
    controls = subprocess.run([sys.executable, '-m', 'unittest',
                              *sorted({'test_process_observation_envelope.' + row[3] for row in MUTANTS})],
                             cwd=STEP, capture_output=True, text=True, timeout=240)
    if controls.returncode:
        print(controls.stdout + controls.stderr)
        return 1
    print('unmutated observation-envelope controls: all passed', flush=True)
    original = (STEP / 'process_observation_envelope.py').read_text()
    for name, old, new, test, assertion in MUTANTS:
        if original.count(old) != 1:
            raise RuntimeError(name + ': mutation anchor differs')
        code = ("import process_observation_envelope as e; "
                "exec(compile(%r,e.__file__,'exec'),e.__dict__); "
                "import unittest; r=unittest.TextTestRunner().run(unittest.defaultTestLoader.loadTestsFromName(%r)); "
                "raise SystemExit(not r.wasSuccessful())" %
                (original.replace(old, new), 'test_process_observation_envelope.' + test))
        result = subprocess.run([sys.executable, '-c', code], cwd=STEP,
                                capture_output=True, text=True, timeout=180)
        output = result.stdout + result.stderr
        method = test.split('.')[-1]
        if not (result.returncode == 1 and 'FAIL: ' + method in output
                and assertion in output and 'ERROR:' not in output):
            print(name + ': not an intended-assertion kill\n' + output)
            return 1
        print(name + ': intended assertion killed', flush=True)
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
