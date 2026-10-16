"""Scratch review tool: one-rule mutants of the read-only journal mount wrapper and the probe guards.

Usage: python3 mutants_journal_mount.py STEP12_DIR

STEP12_DIR is step12_jetstream at 5b6c84af with journal-mount-wrapper-on-5b6c84af.patch applied.
Each mutant deletes or weakens exactly one rule of host_journal_mount.py (or one guard of
probe_asif_mount_ownership.py) in a temporary copy. A mutant is killed for the intended reason
when every designated test fails with its marker and the whole test_host_journal_mount.py fails
as well. Markers:
  " is not None"        the forgery that only this rule refuses now passes: a receipt is
                        returned where the run must refuse;
  "Regex didn't match"  the forgery is still refused, but later, by another rule with that
                        rule's message (or the primary error is replaced);
  " != "                the exact command log, eject list, stage or receipt field differs;
  "not raised"          a guard that must refuse now lets the probe through;
  the others name the one observable the rule protects (see each row).
The unmutated copy must pass every designated test and the whole file first. Exit status 1 names
any other outcome. Run it as root so the clone-owner rule's root-only test runs.

Not mutated, each shadowed by a stronger rule a test already pins: the clone's S_ISREG (a symlink
fails the 0600 mode, a directory the single link, a FIFO the size) and O_NOFOLLOW behind it; the
timed_out half of plist_of() and of the mount check (attempt() gives every timed-out row a None
returncode); and the receipt's exclusive create, which is host_vm_preflight.write_record's own.
"""
import concurrent.futures
import pathlib
import shutil
import subprocess
import sys
import tempfile

STEP12 = pathlib.Path(sys.argv[1]).resolve()
WRAPPER = 'host_journal_mount.py'
PROBE = 'probe_asif_mount_ownership.py'
SOURCES = {name: (STEP12 / name).read_text() for name in (WRAPPER, PROBE)}
SUITE = 'test_host_journal_mount.py'
M = 'test_host_journal_mount.'
POSITIVE = M + 'Mounted.test_reader_runs_only_on_the_verified_read_only_mount_and_the_receipt_lists_what_it_read'
NOMATCH = "Regex didn't match"
RECEIPT = ' is not None'
DIFF = ' != '
GUARDS = M + 'ProbeGuards.test_every_guard_refuses_before_any_command'

# (name, marker, designated test(s), exact source text, its one-rule replacement[, file])
MUTANTS = [
    # Entry: the production refusal, the capture directory and output, the arm lock.
    ('production', RECEIPT, M + 'EntryRefusals.test_production_entrypoint_refuses_before_anything_runs',
     "    require(fixture, 'production journal mount requires", "    require(True, 'production journal mount requires"),
    ('cli_fixture', 'command run', M + 'EntryRefusals.test_cli_runs_only_as_the_fixture_and_its_usage_is_exact',
     "fixture=sys.argv[4:] == ['--fixture'])", "fixture=True)"),
    ('cli_usage', 'does not match', M + 'EntryRefusals.test_cli_runs_only_as_the_fixture_and_its_usage_is_exact',
     "require(len(sys.argv) in (4, 5) and sys.argv[4:] in ([], ['--fixture']),", "require(len(sys.argv) >= 4,"),
    ('production_parent', NOMATCH, M + 'EntryRefusals.test_production_capture_parent_is_refused',
     "require(capture_dir.parent != PRODUCTION_PARENT,", "require(True,"),
    ('owned_capture', NOMATCH, M + 'EntryRefusals.test_capture_directory_and_output_are_owned_and_fresh',
     "    owned_directory(capture_dir)\n", ""),
    ('output_child', NOMATCH, M + 'EntryRefusals.test_capture_directory_and_output_are_owned_and_fresh',
     "require(output.parent == capture_dir,", "require(True,"),
    ('lock_taken', NOMATCH, M + 'EntryRefusals.test_arm_lock_holder_refuses_before_any_command',
     "            fcntl.flock(armed, fcntl.LOCK_EX | fcntl.LOCK_NB)\n", "            pass\n"),
    ('lock_exclusive', NOMATCH, M + 'EntryRefusals.test_arm_lock_holder_refuses_before_any_command',
     "fcntl.flock(armed, fcntl.LOCK_EX | fcntl.LOCK_NB)", "fcntl.flock(armed, fcntl.LOCK_SH | fcntl.LOCK_NB)"),
    ('lock_held', 'BlockingIOError not raised', POSITIVE,
     "        return locked_read(capture_dir, output, table)",
     "        fcntl.flock(armed, fcntl.LOCK_UN)\n        return locked_read(capture_dir, output, table)"),
    # Inputs before the attach: FAILED marker, pins, commitment, record, clone identity and hash.
    ('failed_capture', RECEIPT, M + 'InputRefusals.test_a_failed_capture_is_never_attached',
     "require(not os.path.lexists(capture_dir / 'FAILED.json'),", "require(True,"),
    ('pins_before', DIFF, M + 'InputRefusals.test_capture_pins_and_commitment_hold_before_the_attach',
     "    pinned = require_captured(capture_dir)\n",
     "    pinned = {name: (capture_dir / name).read_bytes() for name in ('COMMITTED.json', 'CHECKPOINT.json')}\n"),
    ('commitment_equal', RECEIPT, M + 'InputRefusals.test_capture_pins_and_commitment_hold_before_the_attach',
     "    require(commitment == {**json.loads(pinned['COMMITTED.json']),",
     "    require(True or commitment == {**json.loads(pinned['COMMITTED.json']),"),
    ('capture_scope', RECEIPT, M + 'InputRefusals.test_capture_record_must_be_a_stopped_fixture_capture_naming_its_volume',
     "require(capture.get('scope') == CAPTURE_SCOPE and ", "require("),
    ('capture_stopped', RECEIPT, M + 'InputRefusals.test_capture_record_must_be_a_stopped_fixture_capture_naming_its_volume',
     " and capture.get('vm_state_at_final_check') == 'stopped',", ","),
    ('fixture_vm', RECEIPT, M + 'InputRefusals.test_capture_record_must_be_a_stopped_fixture_capture_naming_its_volume',
     "require(capture.get('vm_uuid') == FIXTURE_UUID,", "require(True,"),
    ('volume_named', NOMATCH, M + 'InputRefusals.test_capture_record_must_be_a_stopped_fixture_capture_naming_its_volume',
     "require(isinstance(capture.get('data_volume_uuid'), str) and capture['data_volume_uuid'],",
     "require(True,"),
    ('clone_uid', RECEIPT, M + 'InputRefusals.test_a_clone_owned_by_another_user_is_refused',
     "require(stat.S_ISREG(info.st_mode) and info.st_uid == os.getuid() and info.st_nlink == 1",
     "require(stat.S_ISREG(info.st_mode) and info.st_nlink == 1"),
    ('clone_nlink', RECEIPT, M + 'InputRefusals.test_clone_must_be_the_owned_single_link_image_of_the_pinned_size_and_hash',
     "and info.st_uid == os.getuid() and info.st_nlink == 1", "and info.st_uid == os.getuid()"),
    ('clone_mode', RECEIPT, M + 'InputRefusals.test_clone_must_be_the_owned_single_link_image_of_the_pinned_size_and_hash',
     "and stat.S_IMODE(info.st_mode) == 0o600 and info.st_size", "and info.st_size"),
    ('clone_size', RECEIPT, M + 'InputRefusals.test_clone_must_be_the_owned_single_link_image_of_the_pinned_size_and_hash',
     "and info.st_size == capture.get('clone_size'),", ","),
    ('clone_hash', RECEIPT, M + 'InputRefusals.test_clone_must_be_the_owned_single_link_image_of_the_pinned_size_and_hash',
     "require(digest.hexdigest() == capture.get('clone_image_sha256'),", "require(True,"),
    ('clone_inode', NOMATCH, M + 'InputRefusals.test_clone_must_not_change_or_be_swapped_while_it_is_hashed',
     "require((opened.st_dev, opened.st_ino) == (info.st_dev, info.st_ino)\n            and ", "require("),
    ('clone_grown', NOMATCH, M + 'InputRefusals.test_clone_must_not_change_or_be_swapped_while_it_is_hashed',
     "\n            and (after.st_size, after.st_mtime_ns) == (info.st_size, info.st_mtime_ns),", ","),
    ('clone_ctime', RECEIPT, M + 'AfterEject.test_a_clone_touched_replaced_or_renamed_back_while_mounted_is_refused',
     "'mtime_ns': info.st_mtime_ns, 'ctime_ns': info.st_ctime_ns,", "'mtime_ns': info.st_mtime_ns,"),
    # The inventory before the attach, and the attach itself.
    ('already_attached', NOMATCH,
     M + 'InputRefusals.test_a_clone_already_attached_by_path_or_identity_is_refused_and_left_attached',
     "        require(not attachments(clone), 'clone is already attached')\n", ""),
    ('attached_identity', RECEIPT,
     M + 'InputRefusals.test_a_clone_already_attached_by_path_or_identity_is_refused_and_left_attached',
     "if path == clone or os.path.lexists(path) and os.path.samefile(path, clone):", "if path == clone:"),
    ('plist_status', RECEIPT,
     M + 'Attach.test_an_attach_that_failed_or_timed_out_after_it_applied_is_ejected_from_the_inventory',
     "require(row['returncode'] == 0 and not row['timed_out'], what + ' failed or timed out')",
     "require(not row['timed_out'], what + ' failed or timed out')"),
    ('attach_readonly', DIFF, POSITIVE, "'--plist', '--readOnly', '--noMount', str(clone))", "'--plist', '--noMount', str(clone))"),
    ('attach_nomount', DIFF, POSITIVE, "'--plist', '--readOnly', '--noMount', str(clone))", "'--plist', '--readOnly', str(clone))"),
    ('attach_once', RECEIPT, M + 'Attach.test_the_clone_must_be_attached_exactly_once_read_only',
     "require(len(rows) == 1 and rows[0].get('writeable') is False,", "require(rows[0].get('writeable') is False,"),
    ('attach_writeable', RECEIPT, M + 'Attach.test_the_clone_must_be_attached_exactly_once_read_only',
     "require(len(rows) == 1 and rows[0].get('writeable') is False,", "require(len(rows) == 1,"),
    ('attach_disk', RECEIPT, M + 'Attach.test_the_attach_result_must_name_the_inventory_disk_and_cleanup_trusts_the_inventory',
     " and entities[0].get('dev-entry') == disk,", ","),
    ('disk_shape', RECEIPT, M + 'Attach.test_the_attached_disk_must_be_a_whole_dev_disk_node',
     "require(isinstance(disk, str) and DISK.fullmatch(disk) and ", "require(isinstance(disk, str) and "),
    # The pinned Data volume.
    ('volume_hint', NOMATCH, M + 'Volume.test_the_pinned_uuid_must_name_one_unencrypted_unmounted_apfs_volume_named_data',
     "        if entity.get('content-hint') != 'Apple_APFS_Volume':\n            continue\n", ""),
    ('volume_uuid', RECEIPT, POSITIVE, "        if info.get('VolumeUUID') == uuid:\n", "        if True:\n"),
    ('volume_once', NOMATCH, M + 'Volume.test_the_pinned_uuid_must_name_one_unencrypted_unmounted_apfs_volume_named_data',
     "require(len(found) == 1, 'pinned Data volume UUID", "require(len(found) >= 1, 'pinned Data volume UUID"),
    ('volume_name', RECEIPT, M + 'Volume.test_the_pinned_uuid_must_name_one_unencrypted_unmounted_apfs_volume_named_data',
     "require(info.get('VolumeName') == 'Data',", "require(True,"),
    ('volume_encrypted', RECEIPT, M + 'Volume.test_the_pinned_uuid_must_name_one_unencrypted_unmounted_apfs_volume_named_data',
     "require(info.get('Encryption') is False,", "require(True,"),
    ('volume_unmounted', RECEIPT, M + 'Volume.test_the_pinned_uuid_must_name_one_unencrypted_unmounted_apfs_volume_named_data',
     "require(not info.get('MountPoint'),", "require(True,"),
    # The mount and its verification before the reader.
    ('mount_status', NOMATCH, M + 'Mount.test_a_failed_mount_is_refused_and_released',
     "require(done['returncode'] == 0 and not done['timed_out'],", "require(not done['timed_out'],"),
    ('mount_readonly', DIFF, POSITIVE, "attempt(DISKUTIL, 'mount', 'readOnly', '-mountOptions',", "attempt(DISKUTIL, 'mount', '-mountOptions',"),
    ('mount_options', DIFF, POSITIVE, "MOUNT_OPTIONS = 'nobrowse,nodev,nosuid,noexec,owners'", "MOUNT_OPTIONS = 'nobrowse'"),
    ('verify_called', RECEIPT, M + 'Verify.test_the_reader_runs_only_on_a_read_only_nodev_nosuid_noexec_mount_honouring_owners',
     "        verified = verify_mount(mount, volume, before['data_volume_uuid'])\n", "        verified = {}\n"),
    ('verify_stage', DIFF, M + 'Verify.test_the_reader_runs_only_on_a_read_only_nodev_nosuid_noexec_mount_honouring_owners',
     "        stage = 'verify'\n", ""),
    ('writable', RECEIPT, M + 'Verify.test_the_reader_runs_only_on_a_read_only_nodev_nosuid_noexec_mount_honouring_owners',
     "require(info.get('WritableVolume') is False,", "require(True,"),
    ('mount_point', RECEIPT, M + 'Verify.test_the_reader_runs_only_on_a_read_only_nodev_nosuid_noexec_mount_honouring_owners',
     "require(info.get('MountPoint') and pathlib.Path(info['MountPoint']) == mount,", "require(info.get('MountPoint'),"),
    ('mounted_uuid', RECEIPT, M + 'Verify.test_the_reader_runs_only_on_a_read_only_nodev_nosuid_noexec_mount_honouring_owners',
     "require(info.get('VolumeUUID') == uuid, 'mounted volume UUID differs')", "require(True, 'mounted')"),
    ('ownership_enabled', RECEIPT, M + 'Verify.test_the_reader_runs_only_on_a_read_only_nodev_nosuid_noexec_mount_honouring_owners',
     "require(info.get('GlobalPermissionsEnabled') is True,", "require(True,"),
    ('mnt_on', RECEIPT, M + 'Verify.test_the_reader_runs_only_on_a_read_only_nodev_nosuid_noexec_mount_honouring_owners',
     "require(found['mntonname'] == str(mount),", "require(True,"),
    ('mnt_from', RECEIPT, M + 'Verify.test_the_reader_runs_only_on_a_read_only_nodev_nosuid_noexec_mount_honouring_owners',
     "require(found['mntfromname'] == volume,", "require(True,"),
    ('fstype', RECEIPT, M + 'Verify.test_the_reader_runs_only_on_a_read_only_nodev_nosuid_noexec_mount_honouring_owners',
     "require(found['fstypename'] == 'apfs',", "require(True,"),
    ('flag_rdonly', RECEIPT, M + 'Verify.test_the_reader_runs_only_on_a_read_only_nodev_nosuid_noexec_mount_honouring_owners',
     "REQUIRED_FLAGS = (('read-only', MNT_RDONLY), ", "REQUIRED_FLAGS = ("),
    ('flag_nodev', RECEIPT, M + 'Verify.test_the_reader_runs_only_on_a_read_only_nodev_nosuid_noexec_mount_honouring_owners',
     "('nodev', MNT_NODEV), ", ""),
    ('flag_nosuid', RECEIPT, M + 'Verify.test_the_reader_runs_only_on_a_read_only_nodev_nosuid_noexec_mount_honouring_owners',
     "('nosuid', MNT_NOSUID),", ""),
    ('flag_noexec', RECEIPT, M + 'Verify.test_the_reader_runs_only_on_a_read_only_nodev_nosuid_noexec_mount_honouring_owners',
     "                  ('noexec', MNT_NOEXEC))", "                  )"),
    ('flags_checked', RECEIPT, M + 'Verify.test_the_reader_runs_only_on_a_read_only_nodev_nosuid_noexec_mount_honouring_owners',
     "require(not missing, 'mount is not ' + ', '.join(missing))", "require(True, '')"),
    ('ignore_ownership', RECEIPT, M + 'Verify.test_the_reader_runs_only_on_a_read_only_nodev_nosuid_noexec_mount_honouring_owners',
     "require(not found['flags'] & MNT_IGNORE_OWNERSHIP,", "require(True,"),
    # Failure handling: the primary error kept, cleanup on every path, evidence never replacing it.
    ('primary_kept', NOMATCH, M + 'Reader.test_a_reader_failure_keeps_its_primary_error_and_releases',
     "        record_failure(output, stage, error, release(clone, mount, attach_attempted, known))\n        raise\n",
     "        record_failure(output, stage, error, release(clone, mount, attach_attempted, known))\n"
     "        raise RuntimeError('masked') from error\n"),
    ('interrupt_released', 'No such file or directory', M + 'Reader.test_an_interrupt_during_the_read_is_released_and_reraised',
     "    except BaseException as error:\n        record_failure(output, stage, error, release(",
     "    except Exception as error:\n        record_failure(output, stage, error, release("),
    ('released_on_failure', DIFF,
     M + 'Attach.test_an_attach_that_failed_or_timed_out_after_it_applied_is_ejected_from_the_inventory',
     "record_failure(output, stage, error, release(clone, mount, attach_attempted, known))",
     "record_failure(output, stage, error, None)"),
    ('evidence_never_raises', ' is not ', M + 'Cleanup.test_a_failing_evidence_write_never_replaces_the_primary_error',
     "                                              'cleanup': cleanup})\n    except Exception:",
     "                                              'cleanup': cleanup})\n    except OSError:"),
    # Cleanup: the inventory, not the failed command's output; only this run's attach; bounded.
    ('eject_from_inventory', DIFF,
     M + 'Attach.test_an_attach_that_failed_or_timed_out_after_it_applied_is_ejected_from_the_inventory',
     "for disk in (rows if rows is not None else list(known)) if attached else ():",
     "for disk in list(known) if attached else ():"),
    ('eject_known_fallback', DIFF, M + 'Attach.test_an_inventory_lost_after_the_attach_ejects_the_attach_result_disk',
     "for disk in (rows if rows is not None else list(known)) if attached else ():",
     "for disk in (rows or ()) if attached else ():"),
    ('eject_only_own', DIFF,
     M + 'InputRefusals.test_a_clone_already_attached_by_path_or_identity_is_refused_and_left_attached',
     "for disk in (rows if rows is not None else list(known)) if attached else ():",
     "for disk in (rows if rows is not None else list(known)):"),
    ('attach_recorded', DIFF,
     M + 'Attach.test_an_attach_that_failed_or_timed_out_after_it_applied_is_ejected_from_the_inventory',
     "        attach_attempted = True\n", ""),
    ('eject_retried', RECEIPT, M + 'Mounted.test_ejects_are_retried_within_their_bound',
     "for _ in range(EJECT_ATTEMPTS):", "for _ in range(1):"),
    ('eject_stops', DIFF, POSITIVE, "            if ejected and ejected['returncode'] == 0:\n                break\n", ""),
    ('unmount_unknown', DIFF, M + 'Cleanup.test_an_unknown_mount_state_is_still_unmounted_and_recorded',
     "if step('mounted before cleanup', mounted) is not False:", "if step('mounted before cleanup', mounted):"),
    ('point_removed', RECEIPT, POSITIVE, "        step('remove mount point', lambda: os.rmdir(mount))\n", "        pass\n"),
    ('clean_remaining', RECEIPT, M + 'Cleanup.test_incomplete_cleanup_after_a_good_read_writes_no_receipt',
     "'clean': (remaining == 0 or not attached) and still", "'clean': still"),
    ('clean_unmounted', 'is not false', M + 'Cleanup.test_an_unknown_mount_state_is_still_unmounted_and_recorded',
     " and still is False\n            and not os.path.lexists(mount)}", "\n            and not os.path.lexists(mount)}"),
    ('clean_required', RECEIPT, M + 'Cleanup.test_incomplete_cleanup_after_a_good_read_writes_no_receipt',
     "require(cleanup['clean'], 'journal mount cleanup did not complete')", "require(True, '')"),
    # After the eject: everything compared again.
    ('after_compared', RECEIPT, M + 'AfterEject.test_a_clone_touched_replaced_or_renamed_back_while_mounted_is_refused',
     "require(after == before, 'capture pins", "require(True, 'capture pins"),
    ('after_reread', RECEIPT, M + 'AfterEject.test_a_clone_rewritten_while_mounted_is_refused',
     "        after = capture_inputs(capture_dir)\n", "        after = before\n"),
    ('after_republished', RECEIPT, M + 'AfterEject.test_a_capture_republished_or_failed_while_mounted_is_refused',
     "        after = capture_inputs(capture_dir)\n", "        after = {**capture_inputs(capture_dir), 'data_volume_uuid': before['data_volume_uuid'], 'capture_sha256': before['capture_sha256']}\n"),
    # The receipt lists what the reader actually read.
    ('read_listed', DIFF, POSITIVE, "'read': summary['read'], 'cleanup': cleanup}", "'read': [], 'cleanup': cleanup}"),
    # The probe's guards, each before any command.
    ('probe_platform', 'not raised', GUARDS, "require(platform == 'darwin',", "require(True,", PROBE),
    ('probe_ci', 'not raised', GUARDS, "require(environ.get('CI') == 'true' and environ.get('GITHUB_ACTIONS') == 'true',",
     "require(environ.get('GITHUB_ACTIONS') == 'true',", PROBE),
    ('probe_actions', 'not raised', GUARDS, "require(environ.get('CI') == 'true' and environ.get('GITHUB_ACTIONS') == 'true',",
     "require(environ.get('CI') == 'true',", PROBE),
    ('probe_opt_in', 'not raised', GUARDS, "require(environ.get('OPENCLAW_OWNERSHIP_PROBE') == '1',", "require(True,", PROBE),
    ('probe_usage', 'not raised', GUARDS, "require(len(argv) == 2 and argv[0] == '--ci-owned-probe',", "require(len(argv) == 2,", PROBE),
    ('probe_output', 'command run', GUARDS,
     "require(output.is_absolute() and not os.path.lexists(output) and output.parent.is_dir(),", "require(True,", PROBE),
    ('probe_sudo', 'not raised', GUARDS, "require(sudo['returncode'] == 0 and not sudo['timed_out'],", "require(True,", PROBE),
    ('probe_sudo_last', 'is not false', GUARDS,
     "    require(platform == 'darwin', 'the ownership probe runs only on macOS')\n",
     "    attempt(SUDO, '-n', '/usr/bin/true')\n    require(platform == 'darwin', 'the ownership probe runs only on macOS')\n",
     PROBE),
]


def run(changed, *args):
    with tempfile.TemporaryDirectory(prefix='mount-mutant-') as temporary:
        copy = pathlib.Path(temporary) / 'step12'
        shutil.copytree(STEP12, copy, ignore=shutil.ignore_patterns('__pycache__'))
        for name, source in changed.items():
            (copy / name).write_text(source)
        done = subprocess.run([sys.executable, '-B', *args], cwd=copy, capture_output=True, text=True,
                              timeout=1200)
        return done.returncode, done.stderr


def parts(mutant):
    """name, marker, designated tests, old, new, target file."""
    target = mutant[-1] if mutant[-1] in SOURCES else WRAPPER
    body = mutant[:-1] if mutant[-1] in SOURCES else mutant
    return body[0], body[1], body[2:-2], body[-2], body[-1], target


def judge(mutant):
    name, marker, tests, old, new, target = parts(mutant)
    source = SOURCES[target]
    if source.count(old) != 1:
        return name, 'ANCHOR(%d)' % source.count(old), ''
    mutated = {target: source.replace(old, new)}
    results = []
    for test in tests:
        code, output = run(mutated, '-m', 'unittest', test)
        results.append((test.rsplit('.', 1)[1], code, output.count(marker)))
    whole, _ = run(mutated, SUITE)
    detail = '; '.join('%s: "%s" in %d case(s)' % (test, marker, count) for test, _, count in results)
    if whole and all(code and count for _, code, count in results):
        return name, 'KILLED', detail
    return name, 'PROBLEM', 'whole rc=%d; %s' % (whole, '; '.join(
        '%s rc=%d marker=%d' % result for result in results))


if __name__ == '__main__':
    problems = []
    code, output = run({}, SUITE)
    print('unmutated %s:' % SUITE, 'PASS' if code == 0 else 'FAIL', output.strip().splitlines()[-1])
    if code:
        problems.append('unmutated suite fails')
    for test in sorted({test for mutant in MUTANTS for test in parts(mutant)[2]}):
        code, output = run({}, '-m', 'unittest', test)
        if code or 'skipped' in output:
            problems.append('unmutated designated test fails or skips: ' + test)
    with concurrent.futures.ThreadPoolExecutor(4) as pool:
        for name, status, detail in pool.map(judge, MUTANTS):
            print('%-22s %-8s %s' % (name, status, detail), flush=True)
            if status != 'KILLED':
                problems.append(name)
    print('mutants: %d; problems:' % len(MUTANTS), problems)
    sys.exit(1 if problems else 0)
