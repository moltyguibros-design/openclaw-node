import pathlib
import subprocess
import sys

STEP = pathlib.Path(__file__).resolve().parent
TEST = 'test_host_journal_mount.ReaderRun'
MUTANTS = (
    ('image', "require(row['image_after'] == before,", 'require(True,',
     'test_changed_image_pins_or_either_verified_head', 'AssertionError: 0 != 1'),
    ('pins', 'require(require_captured(capture) == pins,', 'require(True,',
     'test_changed_image_pins_or_either_verified_head', 'AssertionError: 0 != 1'),
    ('heads', "require(all(row['receipt']['reader'][key] == report['fixture'][key]\n"
              "                            for key in ('checkpoint_sha256', 'pre_head')),", 'require(True,',
     'test_changed_image_pins_or_either_verified_head', 'AssertionError: 0 != 1'),
    ('failed-image-retention', "if report['completed'] and report['cleanup']['clean']:",
     "if report['cleanup']['clean']:",
     'test_later_case_failure_preserves_earlier_rows', 'AssertionError: True is not false'),
)


def main():
    control = subprocess.run([sys.executable, '-m', 'unittest', TEST], cwd=STEP,
                             capture_output=True, text=True, timeout=60)
    if control.returncode:
        print(control.stdout + control.stderr)
        return 1
    print('unmutated reader orchestration: passed', flush=True)
    original = (STEP / 'probe_asif_mount_ownership.py').read_text()
    for name, old, new, intended, assertion in MUTANTS:
        if original.count(old) != 1:
            raise RuntimeError(name + ': mutation anchor differs')
        code = ('import probe_asif_mount_ownership as m; exec(compile(%r,m.__file__,"exec"),m.__dict__); '
                'import unittest; r=unittest.TextTestRunner().run('
                'unittest.defaultTestLoader.loadTestsFromName(%r)); '
                'raise SystemExit(not r.wasSuccessful())' % (original.replace(old, new), TEST))
        done = subprocess.run([sys.executable, '-c', code], cwd=STEP,
                              capture_output=True, text=True, timeout=60)
        output = done.stdout + done.stderr
        killed = done.returncode == 1 and ('FAIL: ' + intended) in output and assertion in output
        print(name + ': intended assertion killed=' + str(killed), flush=True)
        if not killed:
            print(output)
            return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
