import inspect
import pathlib
import subprocess
import sys

import test_preservation_cluster as cluster


STEP = pathlib.Path(__file__).resolve().parent
MUTANTS = []


def change(name, old, new, test, assertion):
    MUTANTS.append((name, old, new, test, assertion))


change('validity-dropped', 'if ready and groups == previous:', 'if groups == previous:',
       'test_each_invalid_member_times_out_with_named_conditions', 'stable invalid tables must time out')
change('system-presence-dropped', "('$SYS missing', '$SYS' in table)", "('$SYS missing', True)",
       'test_each_invalid_member_times_out_with_named_conditions', 'stable invalid tables must time out')
change('account-presence-reason-dropped', "('$G missing', '$G' in table),\n", '',
       'test_each_invalid_member_times_out_with_named_conditions', 'each missing condition must be named independently')
change('group-count-lowered', "len(table.get('$G', {})) >= 2", "len(table.get('$G', {})) >= 1",
       'test_each_invalid_member_times_out_with_named_conditions', 'stable invalid tables must time out')
change('empty-account-groups-accepted', "len(table.get('$G', {})) >= 2", "len(table.get('$G', {})) >= 0",
       'test_each_invalid_member_times_out_with_named_conditions', 'stable invalid tables must time out')
change('leader-condition-dropped', "all(node['leader'] for node in table.get('$G', {}).values())", 'True',
       'test_each_invalid_member_times_out_with_named_conditions', 'stable invalid tables must time out')
change('member-failures-ignored', "any(row['failed'] for row in failures)", "bool(failures[0]['failed'])",
       'test_each_invalid_member_times_out_with_named_conditions', 'stable invalid tables must time out')
change('change-reset-dropped', '''        else:
            stable_since = None
            last_reset''', '''        else:
            if not ready:
                stable_since = None
            last_reset''', 'test_changed_valid_groups_clear_stability', 'changed groups must restart the complete stability interval')
change('all-resets-dropped', '''        else:
            stable_since = None
            last_reset''', '''        else:
            last_reset''', 'test_invalid_regression_clears_stability', 'regression must not accumulate disjoint stable intervals')
change('equal-predecessor-check-dropped', 'if ready and groups == previous:', 'if ready:',
       'test_changing_valid_tables_timeout_with_full_evidence', 'changing valid tables must not settle')
change('stability-threshold-lowered', 'clock() - stable_since >= 1:', 'clock() - stable_since >= .5:',
       'test_valid_table_waits_full_interval_and_returns_latest_captures', 'stability must begin at the second identical valid sample')
change('deadline-extended', 'deadline = clock() + 10', 'deadline = clock() + 20',
       'test_deadline_is_not_removed_or_extended', 'deadline must refuse rather than accept later convergence')
change('deadline-dropped', 'while clock() < deadline:', 'while True:',
       'test_deadline_is_not_removed_or_extended', 'deadline must refuse rather than accept later convergence')
change('sample-completion-cutoff-added', 'if clock() - stable_since >= 1:', 'if clock() - stable_since >= 1 and clock() < deadline:',
       'test_sample_started_before_deadline_may_succeed_after_it', 'owned replication groups did not settle after creation')
change('timeout-file-omitted', "    (root/'raft-readiness-refused.json').write_text(json.dumps({\n        'captures': before, 'failures': failures, 'last_reset': last_reset}, indent=2))", '    pass',
       'test_timeout_evidence_keeps_last_invalid_capture_and_reset', 'timeout must retain its evidence file')
change('timeout-reduced-to-raft', "'captures': before", "'captures': groups",
       'test_timeout_evidence_keeps_last_invalid_capture_and_reset', 'timeout must retain full captures beyond raft')
change('timeout-failures-omitted', "'failures': failures", "'failures': []",
       'test_timeout_evidence_keeps_last_invalid_capture_and_reset', 'timeout must retain per-member failed conditions')
change('invalid-reset-misreported', "'invalid' if not ready else 'change'", "'change'",
       'test_each_invalid_member_times_out_with_named_conditions', 'last reset: invalid')
change('change-reset-misreported', "'invalid' if not ready else 'change'", "'invalid'",
       'test_changing_valid_tables_timeout_with_full_evidence', 'last reset: change')
change('capture-refusal-retried', "        before = [capture(ports[i*3+1]) for i in range(3)]", '''        try:
            before = [capture(ports[i*3+1]) for i in range(3)]
        except Refused:
            sleep(.05)
            continue''', 'test_refused_is_propagated_unchanged', 'capture refusal must propagate without retry')
change('returned-captures-reduced', 'return before', 'return previous',
       'test_valid_table_waits_full_interval_and_returns_latest_captures', 'helper must return the full last captures')
change('returned-captures-omitted', 'return before', 'return None',
       'test_valid_table_waits_full_interval_and_returns_latest_captures', 'helper must return the full last captures')


def main():
    original = inspect.getsource(cluster.wait_for_groups)
    names = sorted({'test_cluster_group_readiness.GroupReadiness.' + row[3] for row in MUTANTS})
    controls = subprocess.run([sys.executable, '-m', 'unittest', *names], cwd=STEP,
                             capture_output=True, text=True, timeout=60)
    if controls.returncode:
        print(controls.stdout + controls.stderr)
        return 1
    print('unmutated cluster-group controls: all passed', flush=True)
    for name, old, new, test, assertion in MUTANTS:
        if original.count(old) != 1:
            raise RuntimeError(name + ': mutation anchor differs')
        source = original.replace(old, new)
        code = ("import test_preservation_cluster as c; exec(compile(%r,c.__file__,'exec'),c.__dict__); "
                "import unittest; r=unittest.TextTestRunner().run(unittest.defaultTestLoader.loadTestsFromName(%r)); "
                "raise SystemExit(not r.wasSuccessful())" % (source, 'test_cluster_group_readiness.GroupReadiness.' + test))
        result = subprocess.run([sys.executable, '-c', code], cwd=STEP,
                                capture_output=True, text=True, timeout=60)
        output = result.stdout + result.stderr
        if not (result.returncode == 1 and 'FAIL: ' + test in output
                and assertion in output and 'ERROR:' not in output):
            print(name + ': not an intended-assertion kill\n' + output)
            return 1
        print(name + ': intended assertion killed', flush=True)
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
