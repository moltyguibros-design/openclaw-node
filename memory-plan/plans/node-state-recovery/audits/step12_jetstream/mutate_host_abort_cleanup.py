"""Run focused, intended-assertion mutants in fresh processes without changing source files."""
import pathlib
import subprocess
import sys

STEP = pathlib.Path(__file__).resolve().parent
MODULE = 'test_host_abort_cleanup.'
MUTANTS = (
    ('post-unlink-terminal-and-sibling',
     '        no_disk_attachment(clone)\n        no_terminal(capture_dir)\n        no_sibling_clone(capture_dir)',
     '        no_disk_attachment(clone)',
     'Refusals.test_post_unlink_terminal_or_sibling_appearance_refuses', 'RuntimeError not raised'),
    ('intent-readback', "require(json.loads(intent_bytes) == intent,", 'require(True,',
     'Refusals.test_changed_intent_readback_refuses_before_unlink', 'RuntimeError not raised'),
    ('final-intent-binding',
     "and cleanup_bytes('ABORT_CLEANUP_INTENT.json', directory_fd) == intent_bytes,",
     'and True,', 'Refusals.test_changed_final_intent_refuses_receipt', 'RuntimeError not raised'),
    ('pre-unlink-named-binding',
     "require((named.st_dev, named.st_ino) == (opened.st_dev, opened.st_ino)\n"
     "                and (capture_dir.stat().st_dev, capture_dir.stat().st_ino) ==\n"
     "                (os.fstat(directory_fd).st_dev, os.fstat(directory_fd).st_ino),",
     'require(True,', 'Refusals.test_swap_before_named_check_refuses_without_unlinking_either_file',
     'does not match'),
    ('original-arm-scope',
     "require(json.loads(pins['ARMED.json']).get('scope') == ARM_SCOPE",
     'require(True', 'Refusals.test_wrong_arm_scope_refuses_even_when_all_later_pins_are_consistent',
     'not raised'),
    ('exact-retained-holder',
     'require(observed.returncode == 0 and not observed.stderr and observed.stdout == expected,',
     'require(True,', 'HolderObservation.test_exact_retained_readonly_fd_and_no_attachment',
     'RuntimeError not raised'),
    ('production-fence',
     "require(fixture, 'production abort cleanup requires a verified host boot decision controller')",
     "require(True, 'production abort cleanup requires a verified host boot decision controller')",
     'Refusals.test_viable_production_call_still_refuses', 'RuntimeError not raised'),
    ('consumed-pins',
     "and commitment == {**json.loads(pins['COMMITTED.json']),\n"
     "                                   'checkpoint': json.loads(pins['CHECKPOINT.json'])}",
     'and True', 'Refusals.test_changed_consumed_capture_commitment_refuses', 'not raised'),
    ('source-guard',
     "require(guarded_source(capture_dir, initial, observed) == capture['guard_receipt_sha256'],",
     'require(True,', 'Refusals.test_fresh_host_sample_and_guard_refusals', 'RuntimeError not raised'),
    ('held-clone-unlinked', 'and os.fstat(clone_fd).st_nlink == 0', 'and True',
     'Refusals.test_swapped_unlink_entry_cannot_publish_cleanup_for_retained_original', 'RuntimeError not raised'),
    ('premature-receipt',
     "        after, final_source = abort_sample(host_spec, capture_dir, output / 'after', pins, source, initial)",
     "        publish_abort_cleanup(directory_fd, 'ABORT_CLEANUP.json', {'premature': True})\n"
     "        after, final_source = abort_sample(host_spec, capture_dir, output / 'after', pins, source, initial)",
     'Refusals.test_post_unlink_sample_failure_retains_intent_no_cleanup', 'True is not false'),
    ('source-unlock', '        os.unlink(clone.name, dir_fd=directory_fd)',
     '        change_immutable(source, (opened.st_dev, opened.st_ino, opened.st_size), False)\n'
     '        os.unlink(clone.name, dir_fd=directory_fd)',
     'AbortCleanup.test_complete_cleanup_pins_intent_and_keeps_source_guarded',
     'cleanup may never change the source flag'),
)


def main():
    tests = [MODULE + row[3] for row in MUTANTS]
    control = subprocess.run([sys.executable, '-m', 'unittest', *tests], cwd=STEP,
                             capture_output=True, text=True, timeout=120)
    if control.returncode:
        print(control.stdout + control.stderr)
        return 1
    print('unmutated cleanup controls: all passed', flush=True)
    source = (STEP / 'host_clone_dispose.py').read_text()
    for name, old, new, intended, assertion in MUTANTS:
        if source.count(old) != 1:
            raise RuntimeError(name + ': mutation anchor differs')
        code = ('import host_clone_dispose as m; exec(compile(%r,m.__file__,"exec"),m.__dict__); '
                'import unittest; r=unittest.TextTestRunner().run('
                'unittest.defaultTestLoader.loadTestsFromName(%r)); '
                'raise SystemExit(not r.wasSuccessful())' % (source.replace(old, new), MODULE + intended))
        done = subprocess.run([sys.executable, '-c', code], cwd=STEP,
                              capture_output=True, text=True, timeout=120)
        output = done.stdout + done.stderr
        killed = (done.returncode == 1 and ('FAIL: ' + intended.split('.')[-1]) in output
                  and assertion in output and 'ERROR:' not in output)
        print(name + ': intended assertion killed=' + str(killed), flush=True)
        if not killed:
            print(output)
            return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
