import json
import pathlib
import subprocess
import sys

STEP = pathlib.Path(__file__).resolve().parent
JOURNAL = 'preservation_journal'
POLICY = 'boot_process_policy'
MUTANTS = [
    ('policy-extra-fields', JOURNAL, "set(policy) == {'scope', 'uid', 'roots', 'expected'}",
     "{'scope', 'uid', 'roots', 'expected'} <= set(policy)", 'PolicyBinding.test_exact_policy_and_expectation_schemas', 'Refused not raised'),
    ('expectation-extra-fields', JOURNAL, "set(row) ==\n                {'label', 'executable', 'executable_sha256', 'arguments', 'uid', 'gid',\n                 'cwd', 'count', 'attribution'}",
     "{'label', 'executable', 'executable_sha256', 'arguments', 'uid', 'gid', 'cwd', 'count', 'attribution'} <= set(row)",
     'PolicyBinding.test_exact_policy_and_expectation_schemas', 'Refused not raised'),
    ('roots-baseline-binding', JOURNAL, "and roots == inventory['roots']", '',
     'PolicyBinding.test_scope_and_roots_are_fixed', 'Refused not raised'),
    ('code-digest-shape', JOURNAL, "and digest(row['executable_sha256'])", '',
     'PolicyBinding.test_code_and_cwd_bindings_are_literal', 'Refused not raised'),
    ('expansion-arguments', JOURNAL, "for c in '\\0\\ufffd$~'", "for c in '\\0\\ufffd'",
     'PolicyBinding.test_arguments_reject_unknown_expansions_and_malformed_values', 'Refused not raised'),
    ('boolean-ids', JOURNAL, 'return type(value) is int and value >= 0',
     'return isinstance(value, int) and value >= 0', 'PolicyBinding.test_strict_uid_gid_count_and_list_bounds', 'Refused not raised'),
    ('zero-count', JOURNAL, "and 1 <= row['count'] <= 1024", "and 0 <= row['count'] <= 1024",
     'PolicyBinding.test_strict_uid_gid_count_and_list_bounds', 'Refused not raised'),
    ('metadata-owner-binding', JOURNAL, "policy['uid'] == metadata['uid'] == root['uid']",
     "policy['uid'] == root['uid']", 'PolicyBinding.test_each_recorded_owner_uid_is_bound', 'Refused not raised'),
    ('root-owner-binding', JOURNAL, "policy['uid'] == metadata['uid'] == root['uid']",
     "policy['uid'] == metadata['uid']", 'PolicyBinding.test_each_recorded_owner_uid_is_bound', 'Refused not raised'),
    ('pinned-root-identity', JOURNAL, "and hold['pins']['root'] == '%d:%d' % (root['device'], root['inode'])", '',
     'PolicyBinding.test_recorded_root_identity_and_path_bind_the_owner', 'Refused not raised'),
    ('recorded-root-path', JOURNAL, "and watched[-1]['path'] == hold['root']", '',
     'PolicyBinding.test_recorded_root_identity_and_path_bind_the_owner', 'Refused not raised'),
    ('held-label', JOURNAL, "attribution['label'] not in inventory['installed']", 'True',
     'PolicyBinding.test_held_job_label_refuses_independently', 'Refused not raised'),
    ('held-plist', JOURNAL, "and attribution['plist_sha256'] not in\n                    {item['sha256'] for item in inventory['installed'].values()}", '',
     'PolicyBinding.test_held_job_plist_digest_refuses_independently', 'Refused not raised'),
    ('held-command', JOURNAL, "not any(row['arguments'] == state['identity']['argv']\n                        and row['cwd'] == state['identity']['working_directory']\n                        for state in prior.values())", 'True',
     'PolicyBinding.test_held_full_command_refuses_but_shared_interpreter_does_not', 'Refused not raised'),
    ('missing-parent', JOURNAL, "while row['attribution']['kind'] == 'expected':",
     "while row['attribution']['kind'] == 'expected' and row['attribution']['label'] in labels:",
     'PolicyBinding.test_missing_parent_refuses', 'Refused not raised'),
    ('self-parent', JOURNAL, "while row['attribution']['kind'] == 'expected':",
     "while row['attribution']['kind'] == 'expected' and row['attribution']['label'] != row['label']:",
     'PolicyBinding.test_self_parent_refuses', 'Refused not raised'),
    ('cyclic-parent', JOURNAL, "            require(reference in labels and reference not in visited,\n                    'process expectation attribution is missing or cyclic')",
     "            if reference in visited:\n                break\n            require(reference in labels, 'process expectation attribution is missing or cyclic')",
     'PolicyBinding.test_parent_cycle_refuses', 'Refused not raised'),
    ('duplicate-label', JOURNAL, "and row['label'] not in labels", '',
     'PolicyBinding.test_duplicate_labels_and_bindings_refuse', 'Refused not raised'),
    ('duplicate-binding', JOURNAL, "require(binding not in bindings, 'process expectation binding is duplicated')", 'pass',
     'PolicyBinding.test_duplicate_labels_and_bindings_refuse', 'Refused not raised'),
    ('lexical-scope', JOURNAL, "row['uid'] == policy['uid'] or any(", 'True or any(',
     'PolicyBinding.test_other_uid_requires_lexical_root_scope', 'Refused not raised'),
    ('authored-size', JOURNAL, "require(len(encoded(policy)) <= PROCESS_POLICY_LIMIT, 'process policy exceeds its authored bound')", 'pass',
     'PolicyBinding.test_pure_policy_size_bound_is_independent', 'Refused not raised'),
    ('timer-policy-carrier', JOURNAL, "                require(scope == FULL_NODE_SCOPE, 'process policy requires a full-node baseline')\n                valid_process_policy(process_policy, prior, entrypoints)\n", '',
     'PolicyBinding.test_timer_scope_cannot_carry_a_policy', 'Refused not raised'),
    ('preservation-parent-fence', POLICY, 'if os.path.lexists(preservation):', 'if False:',
     'PolicyBinding.test_symlinked_preservation_refuses_before_constructor', 'Refused not raised'),
    ('journal-parent-fence', POLICY, 'if os.path.lexists(journals):', 'if False:',
     'PolicyBinding.test_symlinked_journal_parent_refuses_before_constructor', 'Refused not raised'),
    ('creation-validation', JOURNAL, 'valid_process_policy(process_policy, prior, entrypoints)', 'pass',
     'PolicyBinding.test_direct_carrier_validates_policy_before_publication', 'Refused not raised'),
    ('baseline-carrier', JOURNAL, "fields['process_policy'] = json.loads(encoded(process_policy))", 'pass',
     'PolicyBinding.test_producer_binds_exact_authored_bytes_without_live_enrollment', 'not found in'),
    ('complete-receipt-size', JOURNAL, 'len(encoded(initial)) <= LIMIT and len(encoded(state)) <= LIMIT', 'True',
     'PolicyBinding.test_one_byte_over_complete_receipt_refuses_before_publication', 'Refused not raised'),
    ('early-reopen', JOURNAL, "require(created or process_policy is None, 'cannot replace a journal process policy')", 'pass',
     'PolicyBinding.test_reopen_policy_refuses_before_lock_parent_effects', 'does not match'),
    ('interrupted-reopen', JOURNAL, 'prior is None and process_policy is None', 'prior is None',
     'PolicyBinding.test_interrupted_creation_rejects_policy_before_finish_or_early_return', 'Refused not raised'),
    ('final-reopen', JOURNAL, "require(process_policy is None, 'cannot replace a journal process policy')", 'pass',
     'PolicyBinding.test_internal_reopen_guard_also_rejects_a_supplied_policy', 'Refused not raised'),
    ('fixed-lock', POLICY, "node_lock=preservation / 'node.lock'", 'node_lock=None',
     'PolicyBinding.test_producer_derives_the_fixed_lock_and_leaves_mocked_home_empty', 'producer must derive its fixed owned lock'),
    ('owned-root', POLICY, 'root = owned_root(root)', 'root = pathlib.Path(root)',
     'PolicyBinding.test_viable_fixture_with_wrong_root_name_still_refuses', 'Refused not raised'),
    ('authored-file-mode', POLICY, 'and stat.S_IMODE(before.st_mode) == 0o600', '',
     'PolicyBinding.test_authored_file_canonical_permissions_links_and_bound', 'Refused not raised'),
    ('authored-file-link', POLICY, 'and before.st_nlink == 1', '',
     'PolicyBinding.test_authored_file_canonical_permissions_links_and_bound', 'Refused not raised'),
    ('authored-canonical', POLICY, "require(raw == encoded(policy), 'authored process policy is not canonical')", 'pass',
     'PolicyBinding.test_authored_file_canonical_permissions_links_and_bound', 'Refused not raised'),
    ('producer-owner', POLICY, "require(policy['uid'] == os.getuid(), 'authored process policy uid differs from producer owner')", 'pass',
     'PolicyBinding.test_producer_uid_is_observed_separately', 'Refused not raised'),
    ('producer-hold-root', POLICY, "require(hold['root'] == str(root / 'gate') and hold['paths'][-1]['path'] == str(root / 'gate'),\n            'process policy hold root is outside the owned fixture')", 'pass',
     'PolicyBinding.test_producer_hold_root_must_be_inside_fixture', 'Refused not raised'),
    ('frozen-checkpoint', POLICY, "checkpoint = verify_frozen_checkpoint(capture_dir, records, table=table, configs=configs,\n                                          binary=binary, home=home)", 'checkpoint = {}',
     'FrozenPolicy.test_rehashed_policy_swap_without_external_recommit_refuses', 'Refused not raised'),
    ('checkpoint-policy-order-swapped', POLICY,
     "    checkpoint = verify_frozen_checkpoint(capture_dir, records, table=table, configs=configs,\n                                          binary=binary, home=home)\n    baseline = records[0]\n    require('process_policy' in baseline, 'frozen baseline has no authored process policy')\n    policy = baseline['process_policy']\n    valid_process_policy(policy, baseline['prior'], baseline['entrypoint_inventory'])",
     "    baseline = records[0]\n    require('process_policy' in baseline, 'frozen baseline has no authored process policy')\n    policy = baseline['process_policy']\n    valid_process_policy(policy, baseline['prior'], baseline['entrypoint_inventory'])\n    checkpoint = verify_frozen_checkpoint(capture_dir, records, table=table, configs=configs,\n                                          binary=binary, home=home)",
     'FrozenPolicy.test_checkpoint_refusal_precedes_policy_interpretation',
     'checkpoint must reject before policy interpretation'),
    ('frozen-validation', POLICY, "valid_process_policy(policy, baseline['prior'], baseline['entrypoint_inventory'])", 'pass',
     'FrozenPolicy.test_recommitted_malformed_policy_refuses_after_checkpoint_verification', 'Refused not raised'),
    ('frozen-absence-default', POLICY, "    require('process_policy' in baseline, 'frozen baseline has no authored process policy')\n    policy = baseline['process_policy']",
     "    policy = baseline.get('process_policy', {'scope': __import__('preservation_journal').PROCESS_POLICY_SCOPE, 'uid': baseline['prior']['scheduler-heartbeat']['execution_hold']['metadata_identity']['uid'], 'roots': baseline['entrypoint_inventory']['roots'], 'expected': []})",
     'FrozenPolicy.test_missing_policy_remains_generic_checkpoint_but_dedicated_consumer_refuses', 'Refused not raised'),
    ('image-owner', POLICY, "found['read'] and all(row['uid'] == uid for row in found['read'])", 'True',
     'FrozenPolicy.test_image_owner_mismatch_cannot_be_ignored', 'Refused not raised'),
    ('image-pins-before-selection', POLICY,
     "commitment == {**json.loads(pinned['COMMITTED.json']),\n                           'checkpoint': json.loads(pinned['CHECKPOINT.json'])}", 'True',
     'FrozenPolicy.test_image_commitment_must_match_pins_before_window_selection', 'not found in'),
    ('admission-claim', POLICY, "'admission': False", "'admission': True",
     'FrozenPolicy.test_honest_checkpoint_returns_only_bound_authored_policy', 'is not false'),
    ('history-claim', POLICY, "'history_certified': False", "'history_certified': True",
     'FrozenPolicy.test_honest_checkpoint_returns_only_bound_authored_policy', 'is not false'),
    ('authorship-claim', POLICY, "AUTHORITY = 'pinned-checkpoint-consistent; authorship and pre-stop authenticity unproven'",
     "AUTHORITY = 'trusted pre-stop authorship'", 'FrozenPolicy.test_authored_code_hash_is_a_claim_not_live_eligibility', 'not found in'),
]


def execute(journal, policy, test):
    code = ("import json,sys; journal,policy,test=json.load(sys.stdin); "
            "import preservation_journal as j, boot_process_policy as p; "
            "exec(compile(journal,j.__file__,'exec'),j.__dict__); "
            "exec(compile(policy,p.__file__,'exec'),p.__dict__); "
            "import unittest; r=unittest.TextTestRunner().run(unittest.defaultTestLoader.loadTestsFromName('test_boot_process_policy.'+test)); "
            "raise SystemExit(not r.wasSuccessful())")
    return subprocess.run([sys.executable, '-c', code], cwd=STEP, input=json.dumps((journal, policy, test)),
                          capture_output=True, text=True, timeout=120)


def main():
    controls = subprocess.run([sys.executable, '-m', 'unittest',
                              *sorted({'test_boot_process_policy.' + row[4] for row in MUTANTS})],
                             cwd=STEP, capture_output=True, text=True, timeout=180)
    if controls.returncode:
        print(controls.stdout + controls.stderr)
        return 1
    print('unmutated process policy controls: all passed', flush=True)
    originals = {name: (STEP / (name + '.py')).read_text() for name in (JOURNAL, POLICY)}
    for name, module, old, new, test, assertion in MUTANTS:
        if originals[module].count(old) != 1:
            raise RuntimeError(name + ': mutation anchor differs')
        sources = dict(originals)
        sources[module] = sources[module].replace(old, new)
        result = execute(sources[JOURNAL], sources[POLICY], test)
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
