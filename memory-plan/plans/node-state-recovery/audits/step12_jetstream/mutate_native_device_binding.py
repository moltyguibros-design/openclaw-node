import json
import pathlib
import subprocess
import sys

STEP = pathlib.Path(__file__).resolve().parent
CASES = (
    ('bare-normalization', 'host_journal_mount',
     "node = raw if raw.startswith('/dev/') else '/dev/' + raw", 'node = raw',
     'NativeDeviceBinding.test_committed_native_rows_bind_and_verify_without_a_device_spelling_refusal'),
    ('whole-disk-mismatch', 'host_journal_mount', 'and known[0] == disk', 'and True',
     'Attach.test_the_attach_result_must_name_the_inventory_disk_and_cleanup_trusts_the_inventory'),
    ('noncanonical-data-node', 'host_journal_mount', 'and PARTITION.fullmatch(node)', 'and True',
     'ProbeAttach.test_data_device_node_must_match_the_raw_attach_identifier'),
    ('different-data-node', 'host_journal_mount', 'and raw in (node, node[5:])', 'and True',
     'ProbeAttach.test_data_device_node_must_match_the_raw_attach_identifier'),
    ('invented-whole-observation', 'host_journal_mount', 'known = attached_disk(attached)',
     "known = attached_disk(attached) or ['/dev/disk7']",
     'Attach.test_a_successful_attach_must_name_a_harvestable_whole_disk'),
    ('probe-missing-whole-observation', 'probe_asif_mount_ownership',
     "require(len(known) == 1, 'attach result names no valid whole disk')", 'pass',
     'ProbeAttach.test_a_successful_probe_attach_requires_a_whole_disk_observation'),
    ('runner-owned-volume-root', 'probe_asif_mount_ownership',
     "checked(attempt(SUDO, '-n', '/usr/sbin/chown', '0:0', str(point)), 'restore fixture root owner')\n"
     '        volume_root = point.lstat()', 'pass\n        volume_root = point.lstat()',
     'ProbeWritePreparation.test_only_the_fresh_volume_root_is_made_runner_writable_before_seeding'),
    ('root-runner-guard', 'probe_asif_mount_ownership',
     "require(os.getuid() != 0, 'the ownership probe requires a non-root runner')", 'pass',
     'ProbeGuards.test_root_runner_refuses_before_sudo_for_both_native_modes'),
    ('reader-nonroot-seed-owner', 'probe_asif_mount_ownership',
     "        checked(attempt(SUDO, '-n', '/usr/sbin/chown', '%s:%s' % (os.getuid(), os.getgid()), str(point)),\n"
     "                'chown fixture volume root')\n        if not seed.exists():",
     '        pass\n        if not seed.exists():',
     'ReaderSeed.test_writable_seed_uses_a_distinct_nonroot_owner_then_restores_root'),
    ('reader-root-restoration', 'probe_asif_mount_ownership',
     "checked(attempt(SUDO, '-n', '/usr/sbin/chown', '0:0', str(point)), 'restore fixture root owner')\n"
     '        info = point.lstat()', 'pass\n        info = point.lstat()',
     'ReaderSeed.test_writable_seed_uses_a_distinct_nonroot_owner_then_restores_root'),
)


def main():
    controls = ['test_host_journal_mount.' + name for name in
                ('Attach', 'Volume', 'ProbeAttach', 'ProbeWritePreparation', 'NativeDeviceBinding',
                 'ProbeGuards', 'ReaderSeed')]
    positive = subprocess.run([sys.executable, '-m', 'unittest', '-q', *controls], cwd=STEP,
                              capture_output=True, text=True, timeout=120)
    if positive.returncode:
        print(positive.stdout + positive.stderr)
        return 1
    print(json.dumps({'unmutated': 'passed', 'output': positive.stderr.strip()}), flush=True)
    for name, module, old, new, method in CASES:
        source = (STEP / (module + '.py')).read_text()
        if source.count(old) != 1:
            raise RuntimeError((name, 'mutation anchor count', source.count(old)))
        mutated = source.replace(old, new)
        code = ('import %s as m; exec(compile(%r,m.__file__,"exec"),m.__dict__); '
                'import unittest; s=unittest.defaultTestLoader.loadTestsFromName(%r); '
                'r=unittest.TextTestRunner(verbosity=2).run(s); raise SystemExit(not r.wasSuccessful())'
                % (module, mutated, 'test_host_journal_mount.' + method))
        result = subprocess.run([sys.executable, '-c', code], cwd=STEP,
                                capture_output=True, text=True, timeout=120)
        output = result.stdout + result.stderr
        killed = result.returncode == 1 and ('FAIL: ' + method.split('.')[-1]) in output and 'AssertionError' in output
        print(json.dumps({'mutant': name, 'intended_assertion_kill': killed}), flush=True)
        if not killed:
            print(output)
            return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
