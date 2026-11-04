import pathlib
import subprocess
import sys

STEP = pathlib.Path(__file__).resolve().parent
TEST = 'test_kickstart_applied_timeout.OwnedPlistPolicy'


def main():
    control = subprocess.run([sys.executable, '-m', 'unittest', '-v', TEST], cwd=STEP,
                             capture_output=True, text=True, timeout=60)
    if control.returncode:
        print(control.stdout + control.stderr)
        return 1
    print('unmutated owned plist policy: passed', flush=True)
    source = (STEP / 'restore_only.py').read_text()
    anchor = 'require(plist == expected_plist\n'
    if source.count(anchor) != 1:
        raise RuntimeError('exact plist comparison mutation anchor differs')
    source = source.replace(anchor, 'require(True\n')
    code = ('import restore_only as m; exec(compile(%r,m.__file__,"exec"),m.__dict__); '
            'import unittest; s=unittest.defaultTestLoader.loadTestsFromName(%r); '
            'r=unittest.TextTestRunner(verbosity=2).run(s); raise SystemExit(not r.wasSuccessful())'
            % (source, TEST))
    mutant = subprocess.run([sys.executable, '-c', code], cwd=STEP,
                            capture_output=True, text=True, timeout=60)
    output = mutant.stdout + mutant.stderr
    killed = (mutant.returncode == 1
              and 'FAIL: test_changed_owned_daemon_configuration_refuses_before_launchd' in output
              and 'does not match' in output
              and 'owned launchd configuration differs' in output)
    print('removed equality guard: intended assertion killed=%s' % killed, flush=True)
    if not killed:
        print(output)
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
