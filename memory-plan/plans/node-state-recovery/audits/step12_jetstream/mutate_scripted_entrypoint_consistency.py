import pathlib
import subprocess
import sys


STEP = pathlib.Path(__file__).resolve().parent
MUTANTS = []


def change(name, old, new, test, assertion):
    MUTANTS.append((name, [(old, new)], test, assertion))


copy_prior = "    expected = copy.deepcopy(records[0]['prior'])"
change('adapter-mutates-frozen-prior', copy_prior, "    expected = records[0]['prior']",
       'Comparison.test_comparison_has_no_io_current_boot_clock_or_input_mutation', 'comparison must not mutate input records or facts')
update = "        state.update({key: records[-1]['observations'][unit][key] for key in ('loaded', 'running', 'disabled')})"
change('terminal-state-substitution-omitted', update, '        state.update({})',
       'Comparison.test_terminal_adapter_changes_only_three_fields_without_persisting', 'terminal flags must be substituted')
change('adapter-corrupts-baseline-identity', update, update + "\n        state['identity'] = {}",
       'Comparison.test_terminal_adapter_changes_only_three_fields_without_persisting', 'all other baseline fields must stay unchanged')
validate_excluded = "    valid_tailscale_exclusion(current.get('excluded'))"
validate_inventory = '    valid_entrypoint_inventory(current, terminal_expectations(records))'
change('explicit-exclusion-order-pin-removed', validate_excluded + '\n', '',
       'Comparison.test_shared_validators_precede_exact_input_hash', 'shared validation must precede hashing')
change('inventory-validator-skipped', validate_inventory + '\n', '',
       'Comparison.test_malformed_outer_boot_inventory_and_exclusion_refuse', 'malformed supplied claims must refuse')
change('shared-validators-reversed', validate_excluded + '\n' + validate_inventory,
       validate_inventory + '\n' + validate_excluded,
       'Comparison.test_shared_validators_precede_exact_input_hash', 'shared validation must precede hashing')
change('hash-before-shared-validation', validate_excluded, '    envelope.fingerprint(value)\n' + validate_excluded,
       'Comparison.test_each_shared_validator_refusal_precedes_hash', "Expected 'fingerprint' to not have been called")
change('hash-only-inventory-not-full-input', 'envelope.fingerprint(value)', 'envelope.fingerprint(current)',
       'Comparison.test_hash_binds_full_input_including_supplied_boot', 'hash must bind exact supplied input')
for key in ('installed', 'roots', 'disabled_artifacts'):
    change('drop-' + key + '-comparison', "('installed', 'roots', 'disabled_artifacts')",
           repr(tuple(item for item in ('installed', 'roots', 'disabled_artifacts') if item != key)),
           'Comparison.test_installed_path_roots_and_disabled_artifact_drift_refuse', key + ' drift must refuse')
change('override-comparison-weakened-to-shared-rule', "for key in ('loaded', 'overrides'):", "for key in ('loaded',):",
       'Comparison.test_exact_override_comparison_exceeds_shared_disabled_predicate', 'exact terminal overrides must refuse drift')
comparison = "if current[key] != records[-1]['entrypoint_' + key]:"
change('only-gui-terminal-state-compared', comparison,
       "if current[key]['gui'] != records[-1]['entrypoint_' + key]['gui']:",
       'Comparison.test_exact_override_comparison_exceeds_shared_disabled_predicate', 'exact terminal overrides must refuse drift')
change('baseline-overrides-used-instead-of-terminal', comparison,
       "if current[key] != (saved[key] if key == 'overrides' else records[-1]['entrypoint_' + key]):",
       'Comparison.test_honest_recorded_nonempty_fixture_has_narrow_consistent_result', 'honest terminal inventory must be consistent')
change('excluded-label-set-not-compared', 'if set(excluded) != set(original):', 'if False:',
       'Comparison.test_excluded_label_sets_must_match_in_both_empty_directions', 'missing excluded label must refuse')
for key in ('plist', 'wrapper', 'app'):
    change('drop-excluded-' + key + '-comparison', "('plist', 'wrapper', 'app')",
           repr(tuple(item for item in ('plist', 'wrapper', 'app') if item != key)),
           'Comparison.test_plist_wrapper_and_full_app_identity_drift_refuse', key + ' identity drift must refuse')
change('excluded-boot-not-bound', "if any(item['boot'] != value['boot'] for item in excluded.values()):", 'if False:',
       'Comparison.test_excluded_boot_must_equal_supplied_boot', 'excluded boot must match supplied boot')
change('old-dynamic-exclusion-compared-whole', '    if set(excluded) != set(original):',
       "    if excluded != original:\n        result['reasons'].append('excluded.dynamic')\n    if set(excluded) != set(original):",
       'Comparison.test_valid_run_and_boot_dynamics_may_change_while_app_is_fixed', 'valid run and boot dynamics must not be compared to old boot')
change('reasons-discarded-before-verdict', "    if not result['reasons']:", "    result['reasons'] = []\n    if not result['reasons']:",
       'Comparison.test_all_changed_reasons_survive_without_raw_values', "['installed', 'roots'")
change('drift-does-not-refuse', "if not result['reasons']:", 'if True:',
       'Comparison.test_installed_path_roots_and_disabled_artifact_drift_refuse', 'installed drift must refuse')
change('success-vocabulary-promoted', "result['outcome'] = 'scripted-entrypoint-consistent'", "result['outcome'] = 'admitted'",
       'Comparison.test_honest_recorded_nonempty_fixture_has_narrow_consistent_result', 'honest terminal inventory must be consistent')
prefix = "result = {'scope': SCOPE, 'source': 'scripted', 'input_sha256':"
change('scope-promoted', prefix, prefix.replace("'scope': SCOPE", "'scope': 'live exclusion proof'"),
       'Comparison.test_honest_recorded_nonempty_fixture_has_narrow_consistent_result', 'scope must remain scripted consistency')
change('source-promoted', prefix, prefix.replace("'source': 'scripted'", "'source': 'observed'"),
       'Comparison.test_honest_recorded_nonempty_fixture_has_narrow_consistent_result', 'source must remain scripted')
flags = "'outcome': 'refused', 'hold_certified': False, 'history_certified': False,\n              'admission': False, 'freshness_certified': False}"
for flag in ('hold_certified', 'history_certified', 'admission', 'freshness_certified'):
    change(flag + '-claim-added', flags, flags.replace("'%s': False" % flag, "'%s': True" % flag),
           'Comparison.test_honest_recorded_nonempty_fixture_has_narrow_consistent_result', flag + ' must stay false')
saved = "    saved = records[0]['entrypoint_inventory']"
for key in ('baseline_sha256', 'checkpoint_sha256'):
    change('misreport-' + key, saved, "    result['binding']['%s'] = '0' * 64\n" % key + saved,
           'Comparison.test_honest_recorded_nonempty_fixture_has_narrow_consistent_result', 'frozen binding must survive')
change('runtime-uid-substituted-in-binding', saved, "    result['binding']['uid'] = envelope.os.getuid()\n" + saved,
       'Comparison.test_binding_uses_foreign_recorded_uid_not_runtime', 'binding UID must be recorded rather than runtime')
change('supplied-boot-misreported', "'boot': value['boot'], 'reasons': []", "'boot': '0' * 64, 'reasons': []",
       'Comparison.test_honest_recorded_nonempty_fixture_has_narrow_consistent_result', 'supplied boot must survive')
reader = '    records, verified = managed.owned_records(root, fixture=fixture)'
read = "    value = envelope.read_private(pathlib.Path(root) / 'entrypoints.json')"
change('owned-reader-duplicated', reader, reader + '\n' + reader,
       'Consumer.test_real_frozen_reader_once_before_comparison_with_no_writes_or_constructors', 'owned reader must run exactly once')
change('entrypoint-file-read-before-frozen-refusal', reader + '\n' + read, read + '\n' + reader,
       'Consumer.test_frozen_refusal_prevents_entrypoint_file_read', 'frozen refusal must prevent entrypoint read')
change('flags-relaxed', 'require(fixture and scripted,', 'require(fixture or scripted,',
       'Consumer.test_flags_precede_all_input_io', 'both flags must gate IO')
MUTANTS.append(('live-cli-route-added', [('require(fixture and scripted,', 'require(fixture or scripted,'),
                                      (read, read + "\n    value['inventory'] = __import__('preservation_checks').capture_entrypoint_inventory(records[0]['prior'])")],
                'Consumer.test_fixture_only_cli_cannot_collect_even_with_benign_inventory', 'fixture-only CLI must refuse'))
exit_line = "return 0 if result['outcome'] == 'scripted-entrypoint-consistent' else 2"
for name, replacement, assertion in (('always-refuse', 'return 2', 'consistent CLI must exit zero'),
                                     ('always-succeed', 'return 0', 'drift CLI must exit two')):
    change('cli-' + name, exit_line, replacement,
           'Consumer.test_cli_consistent_drift_malformed_and_early_error_exit_codes', assertion)


def main():
    controls = subprocess.run([sys.executable, '-m', 'unittest',
                              *sorted({'test_scripted_entrypoint_consistency.' + row[2] for row in MUTANTS})],
                             cwd=STEP, capture_output=True, text=True, timeout=240)
    if controls.returncode:
        print(controls.stdout + controls.stderr); return 1
    print('unmutated scripted-entrypoint controls: all passed', flush=True)
    original = (STEP / 'scripted_entrypoint_consistency.py').read_text()
    for name, replacements, test, assertion in MUTANTS:
        source = original
        for old, new in replacements:
            if source.count(old) != 1: raise RuntimeError(name + ': mutation anchor differs')
            source = source.replace(old, new)
        code = ("import scripted_entrypoint_consistency as c; exec(compile(%r,c.__file__,'exec'),c.__dict__); "
                "import unittest; r=unittest.TextTestRunner().run(unittest.defaultTestLoader.loadTestsFromName(%r)); "
                "raise SystemExit(not r.wasSuccessful())" % (source, 'test_scripted_entrypoint_consistency.' + test))
        result = subprocess.run([sys.executable, '-c', code], cwd=STEP, capture_output=True, text=True, timeout=180)
        output = result.stdout + result.stderr
        if not (result.returncode == 1 and 'FAIL: ' + test.split('.')[-1] in output
                and assertion in output and 'ERROR:' not in output):
            print(name + ': not an intended-assertion kill\n' + output); return 1
        print(name + ': intended assertion killed', flush=True)
    return 0


if __name__ == '__main__': raise SystemExit(main())
