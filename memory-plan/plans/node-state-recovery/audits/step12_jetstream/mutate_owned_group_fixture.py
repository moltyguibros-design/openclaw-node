import pathlib
import subprocess
import sys


STEP = pathlib.Path(__file__).resolve().parent
MODULE = 'test_serving_nats_group'
TESTS = (MODULE + '.ScriptedGroup', MODULE + '.FixtureDiagnostics')
CASES = (
    ('short-positive-budget', 'OWNED_GROUP_TIMEOUT = 30', 'OWNED_GROUP_TIMEOUT = 10',
     'ScriptedGroup.test_owned_positive_budget_includes_a_late_election_and_stability',
     'owned positive budget excludes late stable quorum'),
    ('swallowed-refusal', "row['failure'] = repr(error)[:500]\n        raise",
     "row['failure'] = repr(error)[:500]\n        return {}",
     'ScriptedGroup.test_owned_failure_retains_observations_and_propagates_refusal', 'Refused not raised'),
    ('lost-monitor-snapshot', "row['last'][key] = value", "row['last'][key] = {}",
     'ScriptedGroup.test_owned_failure_retains_observations_and_propagates_refusal', 'AssertionError:'),
    ('lost-monitor-error', "row['last'][key] = {'error': repr(error)[:500]}", 'pass',
     'ScriptedGroup.test_owned_endpoint_error_is_retained_until_refusal', 'AssertionError:'),
    ('lost-phase', 'phases.append(row)', 'pass',
     'ScriptedGroup.test_owned_failure_retains_observations_and_propagates_refusal', 'AssertionError: 0 != 1'),
    ('strict-log-decode', ".decode('utf-8', errors='replace')", ".decode('utf-8')",
     'FixtureDiagnostics.test_undecodable_bounded_tail_preserves_refusal_and_reaps_every_child',
     'AssertionError:'),
    ('diagnostic-skips-cleanup',
     "                except BaseException as error:\n                    diagnostic_errors.append(repr(error)[:500])\n            cleanup = {}",
     "                except BaseException as error:\n                    raise\n            cleanup = {}",
     'FixtureDiagnostics.test_evidence_read_failure_still_preserves_refusal_and_reaps_every_child',
     'AssertionError:'),
    ('stop-skips-later-children',
     "                    cleanup[unit]['error'] = repr(error)[:500]\n                    if cleanup_error is None:\n                        cleanup_error = error",
     "                    cleanup[unit]['error'] = repr(error)[:500]\n                    if cleanup_error is None:\n                        cleanup_error = error\n                    break",
     'FixtureDiagnostics.test_one_stop_failure_does_not_skip_other_children_or_replace_refusal',
     'AssertionError: False is not true'),
)


def main():
    original = (STEP / (MODULE + '.py')).read_text()
    control = subprocess.run([sys.executable, '-m', 'unittest', *TESTS], cwd=STEP,
                             capture_output=True, text=True, timeout=30)
    if control.returncode:
        print(control.stdout + control.stderr)
        return 1
    print('unmutated owned-group fixture controls: passed', flush=True)
    for name, old, new, test, assertion in CASES:
        if original.count(old) != 1:
            raise RuntimeError(name + ': mutation anchor differs')
        code = ('import test_serving_nats_group as m; '
                'exec(compile(%r,m.__file__,"exec"),m.__dict__); '
                'import unittest; r=unittest.TextTestRunner().run('
                'unittest.defaultTestLoader.loadTestsFromName(%r)); '
                'raise SystemExit(not r.wasSuccessful())' %
                (original.replace(old, new), MODULE + '.' + test))
        done = subprocess.run([sys.executable, '-c', code], cwd=STEP,
                              capture_output=True, text=True, timeout=30)
        output = done.stdout + done.stderr
        if not (done.returncode == 1 and 'FAIL: ' + test.rsplit('.', 1)[1] in output
                and 'AssertionError:' in output and assertion in output):
            print(name + ': did not fail at its designated assertion\n' + output)
            return 1
        print(name + ': intended assertion killed', flush=True)
    return 0


if __name__ == '__main__':
    sys.exit(main())
