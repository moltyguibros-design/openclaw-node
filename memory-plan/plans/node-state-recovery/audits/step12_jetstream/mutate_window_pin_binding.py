import json
import pathlib
import subprocess
import sys


STEP = pathlib.Path(__file__).resolve().parent
CASES = (
    ('arm-table-digest', 'host_guest_commit',
     "            and arm.get('window_pins_sha256') == hashlib.sha256(raw).hexdigest()", '',
     'test_arm_table_digest_is_checked_even_with_a_rebound_host_chain'),
    ('publication-table-recheck', 'host_vm_capture',
     "        require(require_window_pins(window_pins_source)[1] == pinned['window_pins_sha256'],\n"
     "                'window pin table changed during capture')", '        pass',
     'test_source_table_changed_after_arm_refuses_publication'),
    ('capture-table-pin', 'host_guest_commit',
     '                    for key, name in CAPTURE_PINS.items()),',
     "                    for key, name in CAPTURE_PINS.items() if key != 'window_pins_sha256'),",
     'test_capture_requires_the_table_byte_pin'),
    ('free-table-argument', 'host_guest_commit',
     'def verify_frozen_checkpoint(capture_dir, records, *, configs, binary, home):',
     'def verify_frozen_checkpoint(capture_dir, records, *, configs, binary, home, table=None):',
     'test_frozen_verifier_has_no_caller_table_argument'),
)


def main():
    positive = subprocess.run([sys.executable, '-m', 'unittest', '-q', 'test_window_pin_binding'],
                              cwd=STEP, capture_output=True, text=True, timeout=180)
    if positive.returncode:
        print(positive.stdout + positive.stderr)
        return 1
    print(json.dumps({'unmutated': 'passed', 'output': positive.stderr.strip()}), flush=True)
    for name, module, old, new, method in CASES:
        source = (STEP / (module + '.py')).read_text()
        if source.count(old) != 1:
            raise RuntimeError((name, 'mutation anchor count', source.count(old)))
        mutated = source.replace(old, new)
        target = 'test_window_pin_binding.WindowPins.' + method
        code = ('import %s as m; exec(compile(%r,m.__file__,"exec"),m.__dict__); '
                'import unittest; s=unittest.defaultTestLoader.loadTestsFromName(%r); '
                'r=unittest.TextTestRunner(verbosity=2).run(s); raise SystemExit(not r.wasSuccessful())'
                % (module, mutated, target))
        result = subprocess.run([sys.executable, '-c', code], cwd=STEP,
                                capture_output=True, text=True, timeout=180)
        output = result.stdout + result.stderr
        killed = result.returncode == 1 and ('FAIL: ' + method) in output and 'AssertionError' in output
        print(json.dumps({'mutant': name, 'intended_assertion_kill': killed}), flush=True)
        if not killed:
            print(output)
            return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
