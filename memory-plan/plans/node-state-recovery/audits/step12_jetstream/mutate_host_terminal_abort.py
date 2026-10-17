#!/usr/bin/env python3
"""In-memory guard mutants on owned fixtures, each killed by its named assertion."""
import pathlib
import subprocess
import sys

STEP = pathlib.Path(__file__).resolve().parent
MODULE = 'test_host_terminal_abort.TerminalAbort.'
MUTANTS = (
    ('production-fence',
     "require(fixture, 'production terminal abort requires a verified host boot decision controller')",
     "require(True, 'production terminal abort requires a verified host boot decision controller')",
     'test_viable_production_call_refuses_without_attempt', 'RuntimeError not raised'),
    ('cleanup-failure',
     "require({child.name for child in output.iterdir()} == {'before', 'before-remove', 'after'},",
     "require({child.name for child in output.iterdir()} >= {'before', 'before-remove', 'after'},",
     'test_failed_partial_or_unknown_cleanup_refuses', 'RuntimeError not raised'),
    ('consumed-commitment',
     "and commitment == {**json.loads(pins['COMMITTED.json']),\n                               'checkpoint': json.loads(pins['CHECKPOINT.json'])}",
     'and True', 'test_consumed_commitment_must_equal_snapshot', 'RuntimeError not raised'),
    ('original-nonce',
     "and intent['capture_nonce'] == cleaned['capture_nonce'] == commitment['capture_nonce']",
     'and True', 'test_cleanup_exact_schema_canonical_and_hash_binding', 'RuntimeError not raised'),
    ('sample-identity',
     "        sample_binding(json.loads(raw['preflight.json']), initial, host)",
     '        pass', 'test_cleanup_sample_identity_refuses', 'RuntimeError not raised'),
    ('guard-capture-binding',
     "require(capture['guard_receipt_sha256'] == guarded_source(capture_dir, initial, observed),",
     'require(True,', 'test_rehashed_capture_still_requires_real_guard_binding', 'RuntimeError not raised'),
    ('decision-string',
     "receipt == abort_value(binding, before, receipt['at_utc'])",
     "receipt == {**abort_value(binding, before, receipt['at_utc']), 'decision': receipt['decision']}",
     'test_decision_fields_and_completion_are_strict', 'RuntimeError not raised'),
    ('decision-sample-pin',
     "receipt == abort_value(binding, before, receipt['at_utc'])",
     "receipt == {**abort_value(binding, before, receipt['at_utc']), 'decision_sample_sha256': receipt['decision_sample_sha256']}",
     'test_decision_fields_and_completion_are_strict', 'RuntimeError not raised'),
    ('failed-visible-decision',
     "require({child.name for child in output.iterdir()} == {'before', 'after', 'COMPLETE.json'},",
     "require({child.name for child in output.iterdir()} >= {'before', 'after', 'COMPLETE.json'},",
     'test_failed_decision_marker_always_refuses', 'RuntimeError not raised'),
    ('publication-readback',
     "require(exact_record(raw, ABORT_KEYS) == result, 'abort publication readback differs')",
     "require(True, 'abort publication readback differs')",
     'test_changed_publication_readback_never_completes', 'RuntimeError not raised'),
    ('premature-completion',
     "            after = preflight(host_spec, output / 'after')\n            require(abort_binding",
     "            write_record(output / 'COMPLETE.json', {})\n            after = preflight(host_spec, output / 'after')\n            require(abort_binding",
     'test_interrupt_after_abort_is_not_completed', 'True is not false'),
    ('source-release',
     "            publish_abort_cleanup(directory_fd, 'ABORT.json', result)",
     "            change_immutable(pathlib.Path(before['image']), (before['image_device'], before['image_inode'], before['image_size']), False)\n            publish_abort_cleanup(directory_fd, 'ABORT.json', result)",
     'test_valid_decision_and_caller_held_readonly_verifier', 'cleanup may never change the source flag'),
)


def main():
    control = subprocess.run([sys.executable, '-m', 'unittest',
                              *[MODULE + row[3] for row in MUTANTS]], cwd=STEP,
                             capture_output=True, text=True, timeout=240)
    if control.returncode:
        print(control.stdout + control.stderr)
        return 1
    print('unmutated terminal abort controls: all passed', flush=True)
    source = (STEP / 'host_clone_dispose.py').read_text()
    for name, old, new, test, assertion in MUTANTS:
        if source.count(old) != (2 if name == 'production-fence' else 1):
            raise RuntimeError(name + ': mutation anchor differs')
        code = ('import host_clone_dispose as m; exec(compile(%r,m.__file__,"exec"),m.__dict__); '
                'import unittest; r=unittest.TextTestRunner().run('
                'unittest.defaultTestLoader.loadTestsFromName(%r)); '
                'raise SystemExit(not r.wasSuccessful())' % (source.replace(old, new), MODULE + test))
        done = subprocess.run([sys.executable, '-c', code], cwd=STEP,
                              capture_output=True, text=True, timeout=240)
        output = done.stdout + done.stderr
        killed = (done.returncode == 1 and ('FAIL: ' + test) in output
                  and assertion in output and 'ERROR:' not in output)
        print(name + ': intended assertion killed=' + str(killed), flush=True)
        if not killed:
            print(output)
            return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
