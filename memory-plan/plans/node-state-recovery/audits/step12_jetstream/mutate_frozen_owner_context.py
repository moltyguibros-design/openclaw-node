import pathlib
import subprocess
import sys


STEP = pathlib.Path(__file__).resolve().parent
CASES = (
    ('extra-frozen-record', 'host_guest_commit',
     'and set(files) == FROZEN_FILES', 'and FROZEN_FILES <= set(files)',
     'test_six_bytes_are_required_without_free_table_or_extra_record'),
    ('capture-path-read', 'host_guest_commit',
     'def verify_frozen_bytes(files, records, *, configs, binary, home, writer_uid):',
     "def verify_frozen_bytes(files, records, *, configs, binary, home, writer_uid):\n    private_bytes(pathlib.Path('/unavailable-capture'))",
     'test_bytes_match_path_verifiers_after_the_capture_path_is_removed'),
    ('byte-capture-pin', 'host_guest_commit',
     "    capture_pins_from(files['CAPTURE.json'], pinned)", '    pass',
     'test_every_capture_pin_is_enforced_by_the_byte_api'),
    ('writer-comparison', 'preservation_journal',
     "lock['uid'] == writer_uid and lock['mode']", "True and lock['mode']",
     'test_explicit_writer_uid_is_independent_of_the_current_global'),
    ('writer-cohort-global', 'preservation_journal',
     'cohort = capture_cohort(records[:-1], writer_uid=writer_uid)',
     'cohort = capture_cohort(records[:-1], writer_uid=NATS_ROOT_UID)',
     'test_explicit_writer_uid_is_independent_of_the_current_global'),
    ('writer-exclusion-global', 'preservation_journal',
     'stop_writer_exclusion_proven(intent, evidence, writer_uid=writer_uid)',
     'stop_writer_exclusion_proven(intent, evidence, writer_uid=NATS_ROOT_UID)',
     'test_explicit_writer_uid_is_independent_of_the_current_global'),
    ('writer-bool', 'preservation_journal',
     "require(type(writer_uid) is int and writer_uid >= 0, 'protected writer uid is invalid')",
     "require(isinstance(writer_uid, int) and writer_uid >= 0, 'protected writer uid is invalid')",
     'test_byte_verifier_rejects_malformed_writer_context'),
    ('guest-owner-comparison', 'stopped_journal_inputs',
     'return info.st_uid == owner and (mode', 'return True and (mode',
     'test_wrong_guest_owner_refuses'),
    ('guest-owner-from-caller', 'stopped_journal_inputs',
     'return info.st_uid == owner and (mode', 'return info.st_uid == os.getuid() and (mode',
     'test_owner_context_does_not_use_the_current_caller_uid'),
    ('finder-owner-comparison', 'preservation_journal',
     "stat.S_ISREG(info.st_mode) and info.st_uid == owner, 'unexpected Finder metadata owner or link'",
     "stat.S_ISREG(info.st_mode), 'unexpected Finder metadata owner or link'",
     'test_finder_metadata_uses_the_guest_owner'),
    ('early-image-read', 'stopped_journal_inputs',
     '    captured_from(files)\n    commitment = commitment_from(files)',
     '    commitment = commitment_from(files)',
     'test_pins_refuse_before_image_reads'),
    ('guest-owner-entry-check', 'stopped_journal_inputs',
     "def verify_stopped_bytes(files, root, *, owner, writer_uid):\n    require(type(owner) is int and owner >= 0, 'guest file owner uid is invalid')",
     "def verify_stopped_bytes(files, root, *, owner, writer_uid):\n    require(isinstance(owner, int) and owner >= 0, 'guest file owner uid is invalid')",
     'test_malformed_context_refuses_before_image_reads'),
    ('writer-entry-check', 'stopped_journal_inputs',
     "    require(type(writer_uid) is int and writer_uid >= 0, 'protected writer uid is invalid')",
     '    pass', 'test_malformed_context_refuses_before_image_reads'),
)


def main():
    controls = subprocess.run([sys.executable, '-m', 'unittest', '-q', 'test_frozen_owner_context'],
                              cwd=STEP, capture_output=True, text=True, timeout=180)
    if controls.returncode:
        print(controls.stdout + controls.stderr)
        return 1
    print('unmutated frozen owner-context controls: passed', flush=True)
    print(controls.stderr.strip(), flush=True)
    for label, module, old, new, method in CASES:
        source = (STEP / (module + '.py')).read_text()
        if source.count(old) != 1:
            raise RuntimeError((label, 'mutation anchor count', source.count(old)))
        target = 'test_frozen_owner_context.OwnerContext.' + method
        code = ('import %s as m; exec(compile(%r,m.__file__,"exec"),m.__dict__); '
                'import unittest; s=unittest.defaultTestLoader.loadTestsFromName(%r); '
                'r=unittest.TextTestRunner(verbosity=2).run(s); raise SystemExit(not r.wasSuccessful())'
                % (module, source.replace(old, new, 1), target))
        result = subprocess.run([sys.executable, '-c', code], cwd=STEP,
                                capture_output=True, text=True, timeout=180)
        output = result.stdout + result.stderr
        killed = (result.returncode == 1 and 'FAIL: ' + method in output
                  and 'AssertionError' in output and 'ERROR:' not in output)
        print(label + ': ' + ('intended assertion killed' if killed else 'NOT an intended kill'), flush=True)
        if not killed:
            print(output)
            return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
