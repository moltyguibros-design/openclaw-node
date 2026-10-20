import os
import pathlib
import subprocess
import sys
import tempfile


STEP = pathlib.Path(__file__).resolve().parent
CASES = (
    ('roles', '[[ "$UID" == "$op_uid" && "$EUID" == "$op_uid" && "$op_uid" != "$capture_uid" ]]', '[[ true ]]',
     'test_exact_arguments_roles_environment_and_flags'),
    ('ci-flags', '[[ "$CI" == true && "$GITHUB_ACTIONS" == true && "$LC_ALL" == C && "$entry_flags" == *p* && "$entry_flags" == *f* ]]', '[[ true ]]',
     'test_exact_arguments_roles_environment_and_flags'),
    ('manifest-before-parse', '[[ "$(hash_path "$manifest" "$manifest_record" 3 512)" == "$expected_manifest" ]] || refuse manifest-approval', ':',
     'test_manifest_approval_precedes_interpretation'),
    ('independent-installer', '[[ "${fields[3]}" == "$expected_installer" ]] || refuse installer-approval', ':',
     'test_installer_requires_its_separately_expected_approval'),
    ('canonical-bytes', '[[ "$canonical" == "$expected_manifest" ]] || refuse canonical', ':',
     'test_noncanonical_manifest_fields_and_bytes_refuse'),
    ('schema-version', '"${fields[0]}" == openclaw-installer-v1', 'true',
     'test_noncanonical_manifest_fields_and_bytes_refuse'),
    ('schema-file', '"${fields[1]}" == host_release_publish.py', 'true',
     'test_noncanonical_manifest_fields_and_bytes_refuse'),
    ('data-hash', '[[ "$(hash_path "$installer" "$installer_record" 4 131072)" == "$expected_installer" ]] || refuse installer-bytes', ':',
     'test_declared_size_and_actual_installer_bytes_are_required'),
    ('size-bound', 'size > 0 && size <= private', 'size > 0',
     'test_size_bounds_refuse_before_reading'),
    ('private-mode', '(number & 07777) == 0600', '1 == 1',
     'test_private_modes_and_writable_ancestors_refuse'),
    ('hardlink', '"$links" == 1', 'true',
     'test_links_hardlinks_fifo_directory_refuse'),
    ('xattrs', '[[ "$private" == no || -z "$names" ]] || refuse xattrs', ':',
     'test_real_private_xattr_refuses'),
    ('exact-entries', '[[ "$(bounded "$ls_tool" -A1 "$base")" == "$expected_entries" ]] || refuse entries', ':',
     'test_exact_entry_set_refuses_extra_or_missing'),
    ('final-recheck', '[[ "$(hash_path "$installer" "$installer_record" 4 131072)" == "$expected_installer" ]] || refuse final-installer', ':',
     'test_observed_drift_before_final_hash_refuses'),
    ('budget', '(( SECONDS >= 0 && SECONDS < 60 )) || refuse deadline', ':',
     'test_cooperative_budget_refuses_before_success'),
    ('rendezvous', '[[ "$start" == openclaw-stage0-owned-start-v1 ]] || refuse rendezvous', ':',
     'test_rendezvous_requires_exact_line_eof_and_observation'),
    ('eof', 'if IFS= read -r -n 1 extra; then refuse rendezvous; else eof_status=$?; fi', 'eof_status=1; extra=',
     'test_held_open_stdin_never_counts_as_eof'),
    ('execute-source', "builtin printf 'installer-auth-observed-v1\\n'", '. "$installer"\nbuiltin printf \'installer-auth-observed-v1\\n\'',
     'test_approved_polyglot_never_executes_under_any_interpreter'),
    ('execute-eval', "builtin printf 'installer-auth-observed-v1\\n'", 'eval "$(/usr/bin/head -c 131072 "$installer")"\nbuiltin printf \'installer-auth-observed-v1\\n\'',
     'test_approved_polyglot_never_executes_under_any_interpreter'),
    ('execute-shell', "builtin printf 'installer-auth-observed-v1\\n'", '"' + ('/bin/bash' if sys.platform == 'darwin' else '/usr/bin/bash') + '" --noprofile --norc -p "$installer"\nbuiltin printf \'installer-auth-observed-v1\\n\'',
     'test_approved_polyglot_never_executes_under_any_interpreter'),
    ('execute-python', "builtin printf 'installer-auth-observed-v1\\n'", '/usr/bin/python3 -I -S -B "$installer"\nbuiltin printf \'installer-auth-observed-v1\\n\'',
     'test_approved_polyglot_never_executes_under_any_interpreter'),
)


def check(command, env, expected, label):
    result = subprocess.run(command, env=env, stdout=subprocess.PIPE,
                            stderr=subprocess.STDOUT, timeout=60)
    output = result.stdout.decode(errors='replace')
    if expected:
        assert result.returncode != 0 and 'FAIL:' in output and 'ERROR:' not in output, (label, output)
        assert expected in output, (label, output)
    else:
        assert result.returncode == 0 and '\nOK\n' in output, (label, output)


def main():
    env = dict(os.environ, PYTHONDONTWRITEBYTECODE='1')
    script = (STEP / 'stage0_installer_auth.sh').read_text()
    for test in sorted({case[3] for case in CASES} | {'test_external_script_approval_precedes_any_script_text'}):
        check([sys.executable, str(STEP / 'test_stage0_installer_auth.py'), 'AuthenticationTests.' + test], env, None, test)
    print('Stage0 authentication unmutated designated controls pass', flush=True)
    with tempfile.TemporaryDirectory(prefix='stage0-auth-mutants-') as temporary:
        path = pathlib.Path(temporary) / 'stage0_installer_auth.sh'
        for name, old, new, test in CASES:
            assert script.count(old) in (1, 2), (name, script.count(old))
            path.write_text(script.replace(old, new))
            varied = dict(env, OPENCLAW_STAGE0_TEST_SCRIPT=str(path))
            intended = ('BAD installer was executed' if name.startswith('execute-') else 'AssertionError')
            check([sys.executable, str(STEP / 'test_stage0_installer_auth.py'), 'AuthenticationTests.' + test], varied, intended, name)
            print('KILLED ' + name + ' at AuthenticationTests.' + test, flush=True)
        tests = (STEP / 'test_stage0_installer_auth.py').read_text()
        target = pathlib.Path(temporary) / 'test_stage0_installer_auth.py'
        for name, old, new, test, assertion in [
            ('external-prehash', 'if native_hash(raw, user=user, group=group) != expected_script:', 'if False:',
             'test_external_script_approval_precedes_any_script_text', 'BAD unapproved script was executed'),
            ('launch-env', "command = ['/usr/bin/env', '-i']", "command = ['/usr/bin/env']",
             'test_clean_launch_discards_startup_environment', 'fixed launch did not clear inherited startup keys')]:
            assert tests.count(old) == 1
            target.write_text(tests.replace('STEP = pathlib.Path(__file__).resolve().parent', 'STEP = pathlib.Path(' + repr(str(STEP)) + ')').replace(old, new))
            check([sys.executable, str(target), 'AuthenticationTests.' + test], env, assertion, name)
            print('KILLED ' + name + ' at AuthenticationTests.' + test, flush=True)
    print(str(len(CASES) + 2) + ' intended-assertion Stage0 authentication kills', flush=True)


if __name__ == '__main__':
    main()
