import pathlib
import subprocess
import sys


STEP = pathlib.Path(__file__).resolve().parent
MODULE = 'test_serving_nats_group'
TEST = MODULE + '.ScriptedGroup'
CASES = (
    ('short-positive-budget', 'OWNED_GROUP_TIMEOUT = 30', 'OWNED_GROUP_TIMEOUT = 10',
     'test_owned_positive_budget_includes_a_late_election_and_stability',
     'owned positive budget excludes late stable quorum'),
    ('swallowed-refusal', "row['failure'] = repr(error)[:500]\n        raise",
     "row['failure'] = repr(error)[:500]\n        return {}",
     'test_owned_failure_retains_observations_and_propagates_refusal', 'Refused not raised'),
    ('lost-monitor-snapshot', "row['last'][key] = value", "row['last'][key] = {}",
     'test_owned_failure_retains_observations_and_propagates_refusal', 'AssertionError:'),
    ('lost-phase', 'phases.append(row)', 'pass',
     'test_owned_failure_retains_observations_and_propagates_refusal', 'AssertionError: 0 != 1'),
)


def main():
    original = (STEP / (MODULE + '.py')).read_text()
    control = subprocess.run([sys.executable, '-m', 'unittest', TEST], cwd=STEP,
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
                (original.replace(old, new), TEST + '.' + test))
        done = subprocess.run([sys.executable, '-c', code], cwd=STEP,
                              capture_output=True, text=True, timeout=30)
        output = done.stdout + done.stderr
        if not (done.returncode == 1 and 'FAIL: ' + test in output
                and 'AssertionError:' in output and assertion in output):
            print(name + ': did not fail at its designated assertion\n' + output)
            return 1
        print(name + ': intended assertion killed', flush=True)
    return 0


if __name__ == '__main__':
    sys.exit(main())
