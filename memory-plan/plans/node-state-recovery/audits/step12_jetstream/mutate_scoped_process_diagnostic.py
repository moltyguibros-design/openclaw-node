#!/usr/bin/env python3
import pathlib
import subprocess
import sys

STEP = pathlib.Path(__file__).resolve().parent
PREFIX = 'test_scoped_process_diagnostic.ScopedProcessDiagnostic.'
MUTANTS = [
    ('whole-argument-directory-root-skipped', 'or pathlib.Path(root) in resolved.parents', '',
     'test_other_uid_whole_argument_alias_with_spaces_is_in_scope', "'clean' != 'refused'"),
    ('argv-digest-boundaries-dropped', "b'\\0'.join(arg.encode()", "b''.join(arg.encode()",
     'test_argument_digest_preserves_boundaries', 'argument boundaries must not collapse'),
    ('requested-pid-check-skipped', "and before['pid'] == pid", 'and True',
     'test_snapshot_identity_must_name_requested_pid', 'wrong PID must not produce a stable row'),
    ('cwd-vnode-reread-reduced-to-path', 'and proc.working_directory(pid) == directory',
     "and proc.working_directory(pid)['path'] == directory['path']",
     'test_cwd_vnode_change_with_same_path_is_unknown', 'cwd vnode change must not produce a stable row'),
    ('whole-argument-path-skipped', '    for value in values:\n',
     '    for value in []:\n', 'test_other_uid_whole_argument_alias_with_spaces_is_in_scope', "'clean' != 'refused'"),
    ('empty-full-enumeration-allowed', "enumeration != 'full' or os.getpid() in listed",
     'True', 'test_full_enumeration_cannot_omit_the_diagnostic_process', "'clean' != 'refused'"),
    ('unknown-ignored', 'errors or unknown or unexpected or missing',
     'errors or unexpected or missing', 'test_unknown_refuses_without_any_unexpected_or_missing', "'clean' != 'refused'"),
    ('unstable-check-skipped', "if observed['before'] != observed['after'] or observed['unstable']:",
     'if False:', 'test_unstable_refuses_even_with_all_expected_matched', 'not found in'),
    ('coverage-check-skipped', "if represented != set(observed['before']) | set(observed['after']):",
     'if False:', 'test_missing_enumerated_pid_refuses', "'clean' != 'refused'"),
    ('boot-check-skipped', "if observed['boot'] != expected['boot']:",
     'if False:', 'test_boot_mismatch_refuses_independently', "'clean' != 'refused'"),
    ('second-sample-skipped', '            for pid in after:\n',
     '            for pid in []:\n', 'test_second_sample_generation_change_is_unknown', 'second sample must expose changed process'),
    ('generation-bracket-skipped', "{key: before[key] for key in BRACKET_KEYS}\n                == {key: after[key] for key in BRACKET_KEYS}",
     'True', 'test_changed_generation_during_snapshot_is_unknown', 'changed process must not produce a stable row'),
    ('executable-age-skipped', "pathlib.Path(executable).lstat().st_ctime_ns // 1000\n                <= before['start_sec'] * 1000000 + before['start_usec']",
     'True', 'test_executable_newer_than_process_is_unknown', 'late executable must not produce a stable row'),
    ('fixture-fence-skipped', "require(fixture, 'production scoped process diagnostic is disabled')",
     "require(True, 'production scoped process diagnostic is disabled')", 'test_viable_fixture_still_needs_explicit_flag', 'RuntimeError not raised'),
    ('out-of-scope-expectation-allowed', "require(all(in_scope(row, value['uid'], value['roots']) for row in value['expected']),",
     'require(True,', 'test_out_of_scope_expectation_is_invalid', 'RuntimeError not raised'),
    ('own-uid-scope-skipped', "if row['uid'] == uid:\n        return True",
     'if False:\n        return True', 'test_uid_alone_requires_explicit_expectations', "'clean' != 'refused'"),
    ('raw-arguments-leaked', "{key: value for key, value in row.items() if key != 'arguments'}",
     'dict(row)', 'test_complete_explicit_table_and_redaction', 'unexpectedly found'),
    ('extra-expectation-fields-allowed', "set(value) == {'scope', 'boot', 'uid', 'roots', 'expected'}",
     "{'scope', 'boot', 'uid', 'roots', 'expected'} <= set(value)", 'test_exact_expectation_schema', 'RuntimeError not raised'),
]
for key in ('pid', 'ppid', 'uid', 'gid', 'name', 'start_sec', 'start_usec',
            'executable', 'executable_sha256', 'arguments', 'cwd'):
    MUTANTS.append(('expected-' + key + '-ignored', "elif row in expected['expected']:",
        "elif any(all(row[k] == wanted[k] for k in PROCESS_KEYS - {%r}) for wanted in expected['expected']):" % key,
        'test_each_generation_and_identity_field_is_bound', "'clean' != 'refused'" if key != 'pid' else '0 != 1'))


REDUNDANT_NAMES = {'whole-argument-directory-root-skipped', 'whole-argument-path-skipped'}
REDUNDANT = [row for row in MUTANTS if row[0] in REDUNDANT_NAMES]
MUTANTS = [row for row in MUTANTS if row[0] not in REDUNDANT_NAMES]


def execute(source, name):
    code = ("import scoped_process_diagnostic as m; exec(compile(%r,m.__file__,'exec'),m.__dict__); "
            "import unittest; r=unittest.TextTestRunner().run(unittest.defaultTestLoader.loadTestsFromName(%r)); "
            "raise SystemExit(not r.wasSuccessful())" % (source, PREFIX + name))
    return subprocess.run([sys.executable, '-c', code], cwd=STEP,
                          capture_output=True, text=True, timeout=60)


def main():
    controls = subprocess.run([sys.executable, '-m', 'unittest',
                              *sorted({PREFIX + item[3] for item in MUTANTS + REDUNDANT})],
                             cwd=STEP, capture_output=True, text=True, timeout=60)
    if controls.returncode:
        print(controls.stdout + controls.stderr)
        return 1
    print('unmutated scoped diagnostic controls: all passed', flush=True)
    source = (STEP / 'scoped_process_diagnostic.py').read_text()
    for name, old, new, test, _ in REDUNDANT:
        if source.count(old) != 1:
            raise RuntimeError(name + ': redundant-branch anchor differs')
        changed = execute(source.replace(old, new), test)
        if changed.returncode:
            print(name + ': redundant-branch control failed\n' + changed.stdout + changed.stderr)
            return 1
        print(name + ': redundant-branch control passed (not a kill)', flush=True)
    for name, old, new, test, assertion in MUTANTS:
        if source.count(old) != 1:
            raise RuntimeError(name + ': mutation anchor differs')
        changed = execute(source.replace(old, new), test)
        output = changed.stdout + changed.stderr
        if not (changed.returncode == 1 and 'FAIL: ' + test in output
                and assertion in output and 'ERROR:' not in output):
            print(name + ': not an intended-assertion kill\n' + output)
            return 1
        print(name + ': intended assertion killed', flush=True)
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
