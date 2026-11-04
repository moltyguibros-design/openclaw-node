import inspect
import pathlib
import subprocess
import sys

import preservation_checks as checks


STEP = pathlib.Path(__file__).resolve().parent
MUTANTS = []
WHOLE = '''        candidate = pathlib.Path(expanded)
        if not candidate.is_absolute() and cwd is not None and '/' in expanded:
            candidate = cwd / candidate
        if candidate.is_absolute():
            resolved = candidate.resolve(strict=False)
            if any(resolved == root or root in resolved.parents for root in roots):
                return True
            if suspicious_hardlink(candidate, source, label):
                return True
'''


def change(name, old, new, test, assertion):
    MUTANTS.append((name, old, new, test, assertion))


def whole(name, old, new, test, assertion):
    assert WHOLE.count(old) == 1
    change(name, WHOLE, WHOLE.replace(old, new), test, assertion)


change('whole-value-step-removed', WHOLE, '', 'test_absolute_whole_values_resolve_all_delimiters',
       'whole absolute alias must match an exact file root')
whole('whole-value-unresolved', 'candidate.resolve(strict=False)', 'candidate',
      'test_absolute_whole_values_resolve_all_delimiters', 'whole absolute alias must match an exact file root')
whole('whole-value-resolved-substring', 'resolved == root or root in resolved.parents', 'str(root) in str(resolved)',
      'test_resolved_prefix_sibling_alias_is_not_containment', 'resolved prefix sibling must not count as containment')
whole('relative-absolute-gate-dropped', 'if candidate.is_absolute():', 'if True:',
      'test_slash_relative_without_cwd_ignores_process_working_directory',
      'relative input without supplied cwd must stay unclassified')
whole('slash-tested-before-expansion', "'/' in expanded", "'/' in value",
      'test_slash_relative_whole_values_resolve_against_expanded_cwd',
      'slash introduced by expansion must use working directory')
whole('whole-value-requires-existence', 'strict=False', 'strict=True',
      'test_dangling_alias_into_root_remains_relevant', 'dangling alias must resolve without requiring existence')
whole('whole-value-equality-only', 'resolved == root or root in resolved.parents', 'resolved == root',
      'test_absolute_whole_values_resolve_all_delimiters', 'whole absolute alias must match a parent root')
whole('whole-value-parents-only', 'resolved == root or root in resolved.parents', 'root in resolved.parents',
      'test_absolute_whole_values_resolve_all_delimiters', 'whole absolute alias must match an exact file root')
whole('slash-relative-join-removed', "not candidate.is_absolute() and cwd is not None and '/' in expanded", 'False',
      'test_slash_relative_whole_values_resolve_against_expanded_cwd', 'slash-relative alias must use expanded working directory')
whole('bare-name-cwd-join-added', "cwd is not None and '/' in expanded", 'cwd is not None',
      'test_bare_names_do_not_join_to_working_directory', 'bare names must not become cwd-relative paths')
whole('implicit-process-cwd-added', "if not candidate.is_absolute() and cwd is not None and '/' in expanded:\n            candidate = cwd / candidate",
      "if not candidate.is_absolute() and '/' in expanded:\n            candidate = (cwd or pathlib.Path.cwd()) / candidate",
      'test_slash_relative_without_cwd_ignores_process_working_directory',
      'relative input without supplied cwd must stay unclassified')
whole('whole-expansion-skipped', 'pathlib.Path(expanded)', 'pathlib.Path(value)',
      'test_home_and_environment_expansion_apply_before_whole_resolution', 'whole values must use existing environment expansion')
change('working-directory-expansion-skipped', 'pathlib.Path(expand(working_directory))', 'pathlib.Path(working_directory)',
       'test_slash_relative_whole_values_resolve_against_expanded_cwd', 'slash-relative alias must use expanded working directory')
whole('whole-hardlink-reuse-removed', 'if suspicious_hardlink(candidate, source, label):', 'if False:',
      'test_hardlink_whole_argument_uses_existing_suspicion_rule', 'whole hardlink argument must be relevant')
whole('whole-system-exemption-dropped', 'suspicious_hardlink(candidate, source, label)', 'suspicious_hardlink(candidate, None, label)',
      'test_system_source_hardlink_exemption_is_preserved', 'system-source hardlink exemption must survive')
whole('whole-application-exemption-dropped', 'suspicious_hardlink(candidate, source, label)', 'suspicious_hardlink(candidate, source, "")',
      'test_application_hardlink_exemption_is_preserved', 'application hardlink exemption must survive')
change('raw-substring-fallback-removed', '''        for root in roots:
            if str(root) in expanded:
                return True
''', '', 'test_existing_embedded_and_token_scans_stay_reachable', 'raw substring fallback must survive')
change('managed-prefix-short-circuit-removed', '''    if label.startswith(('ai.openclaw.', 'com.openclaw.')):
        return True
''', '', 'test_prefixes_short_circuit_and_nonstring_values_are_skipped', 'managed prefixes must still short-circuit')
original = inspect.getsource(checks.relevant_entrypoint)
token_start = original.index('        for token in re.findall')
change('token-fallback-removed', original[token_start:original.rindex('    return False')], '',
       'test_existing_embedded_and_token_scans_stay_reachable', 'token fallback must survive')


def main():
    names = sorted({'test_entrypoint_path_scope.PathScope.' + row[3] for row in MUTANTS})
    controls = subprocess.run([sys.executable, '-m', 'unittest', *names], cwd=STEP,
                             capture_output=True, text=True, timeout=120)
    if controls.returncode:
        print(controls.stdout + controls.stderr)
        return 1
    print('unmutated entrypoint-path controls: all passed', flush=True)
    for name, old, new, test, assertion in MUTANTS:
        if original.count(old) != 1:
            raise RuntimeError(name + ': mutation anchor differs')
        source = original.replace(old, new)
        code = ("import preservation_checks as c; exec(compile(%r,c.__file__,'exec'),c.__dict__); "
                "import unittest; r=unittest.TextTestRunner().run(unittest.defaultTestLoader.loadTestsFromName(%r)); "
                "raise SystemExit(not r.wasSuccessful())" % (source, 'test_entrypoint_path_scope.PathScope.' + test))
        result = subprocess.run([sys.executable, '-c', code], cwd=STEP, capture_output=True, text=True, timeout=120)
        output = result.stdout + result.stderr
        if not (result.returncode == 1 and 'FAIL: ' + test in output and assertion in output and 'ERROR:' not in output):
            print(name + ': not an intended-assertion kill\n' + output)
            return 1
        print(name + ': intended assertion killed', flush=True)
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
