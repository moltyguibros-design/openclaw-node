#!/usr/bin/env python3
"""In-memory release faults with intended-assertion kills on real owned receipt producers."""
import pathlib
import subprocess
import sys

STEP = pathlib.Path(__file__).resolve().parent
MODULE = 'test_host_abort_release.AbortRelease.'
MUTANTS = (
    ('barrier-skipped', '            durable_evidence(evidence)\n', '            pass\n',
     'test_barrier_failure_has_no_intent_or_flag', 'OSError not raised'),
    ('post-release-rehash-dropped',
     "    identity = clone_identity(source, {'clone_size': original['size'], 'clone_image_sha256': original['sha256']})",
     "    info = source.lstat()\n    identity = {**original, 'flags': info.st_flags, 'ctime_ns': info.st_ctime_ns}",
     'test_post_clear_bytes_require_full_rehash', 'RuntimeError not raised'),
    ('mtime-tolerance-widened', "IMAGE_KEYS - {'flags', 'ctime_ns'}", "IMAGE_KEYS - {'flags', 'ctime_ns', 'mtime_ns'}",
     'test_post_clear_mtime_change_refuses', 'RuntimeError not raised'),
    ('reguard-on-failure',
     "        except BaseException as error:\n            record_failure(output, 'abort-source-release'",
     "        except BaseException as error:\n            try:\n                change_immutable(source, (identity['device'], identity['inode'], identity['size']), True)\n            except BaseException:\n                pass\n            record_failure(output, 'abort-source-release'",
     'test_after_sample_failure_never_completes', 'no re-guard attempt after failure'),
    ('premature-completion', "            after = preflight(host_spec, output / 'after')",
     "            publish_release(release_fd, 'COMPLETE.json', {})\n            after = preflight(host_spec, output / 'after')",
     'test_after_sample_failure_never_completes', 'True is not false'),
    ('sibling-capture-refusal', '    no_sibling_clone(capture_dir)\n',
     '    no_other_clone(capture_dir.parent, capture_dir)\n',
     'test_sibling_capture_without_clone_is_allowed', 'clone-free historical sibling must allow release'),
    ('missing-completion-accepted', "    output = capture_dir / 'abort-release'\n    owned_directory(output)",
     "    output = capture_dir / 'abort-release'\n    if not os.path.lexists(output / 'COMPLETE.json'):\n        return {}\n    owned_directory(output)",
     'test_verifier_requires_completion_and_exact_layout', 'RuntimeError not raised'),
    ('failed-completion-accepted',
     "{p.name for p in output.iterdir()} == {'verify', 'barrier', 'after', 'INTENT.json', 'COMPLETE.json'}",
     "{p.name for p in output.iterdir()} >= {'verify', 'barrier', 'after', 'INTENT.json', 'COMPLETE.json'}",
     'test_visible_completion_fsync_failure_is_manual_and_refused', 'RuntimeError not raised'),
    ('intent-readback-skipped', "require(exact_record(raw, RELEASE_INTENT_KEYS) == intent, 'release intent readback differs')",
     "require(True, 'release intent readback differs')", 'test_intent_readback_change_refuses_before_clear',
     'no flag call before the durable prerequisites'),
)


def execute(source, test):
    code = ('import host_vm_reconcile as m; exec(compile(%r,m.__file__,"exec"),m.__dict__); '
            'import unittest; r=unittest.TextTestRunner().run('
            'unittest.defaultTestLoader.loadTestsFromName(%r)); '
            'raise SystemExit(not r.wasSuccessful())' % (source, MODULE + test))
    return subprocess.run([sys.executable, '-c', code], cwd=STEP,
                          capture_output=True, text=True, timeout=240)


def main():
    controls = [row[3] for row in MUTANTS] + ['test_intent_exists_at_interrupting_flag_call']
    control = subprocess.run([sys.executable, '-m', 'unittest', *[MODULE + test for test in sorted(set(controls))]],
                             cwd=STEP, capture_output=True, text=True, timeout=300)
    if control.returncode:
        print(control.stdout + control.stderr)
        return 1
    print('unmutated source release controls: all passed', flush=True)
    source = (STEP / 'host_vm_reconcile.py').read_text()
    cases = list(MUTANTS)
    block = "            publish_release(release_fd, 'INTENT.json', intent)\n            raw = cleanup_bytes(output / 'INTENT.json')\n            require(exact_record(raw, RELEASE_INTENT_KEYS) == intent, 'release intent readback differs')\n"
    assert source.count(block) == 1
    late = source.replace(block, '').replace(
        "            change_immutable(source, (identity['device'], identity['inode'], identity['size']), False)\n",
        "            change_immutable(source, (identity['device'], identity['inode'], identity['size']), False)\n" + block)
    cases.append(('intent-after-clear', source, late, 'test_intent_exists_at_interrupting_flag_call',
                  'INTENT must precede the flag call'))
    for name, old, new, test, assertion in cases:
        if source.count(old) != (2 if name == 'failed-completion-accepted' else 1):
            raise RuntimeError(name + ': mutation anchor differs')
        done = execute(source.replace(old, new), test)
        output = done.stdout + done.stderr
        killed = (done.returncode == 1 and ('FAIL: ' + test) in output and assertion in output and 'ERROR:' not in output)
        print(name + ': intended assertion killed=' + str(killed), flush=True)
        if not killed:
            print(output)
            return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
