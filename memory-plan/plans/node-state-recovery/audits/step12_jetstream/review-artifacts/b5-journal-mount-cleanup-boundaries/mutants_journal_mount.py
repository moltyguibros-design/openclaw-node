"""Scratch review tool: one-rule mutants of the read-only journal mount wrapper and the probe guards.

Usage: python3 mutants_journal_mount.py STEP12_DIR

STEP12_DIR is step12_jetstream at 5b6c84af with journal-mount-wrapper-on-5b6c84af.patch and then
journal-mount-cleanup-boundaries-on-a2c5a0df.patch applied.
Each mutant deletes or weakens exactly one rule of host_journal_mount.py (or one guard of
probe_asif_mount_ownership.py) in a temporary copy. A mutant is killed for the intended reason
when every designated test fails with its marker and the whole test_host_journal_mount.py fails
as well. Markers:
  " is not None"        the forgery that only this rule refuses now passes: a receipt is
                        returned where the run must refuse;
  "Regex didn't match"  the forgery is still refused, but later, by another rule with that
                        rule's message (or the primary error is replaced); a one-shot forged
                        statfs view that a weakened first check accepts is caught by the
                        re-verification after the read ("the mount changed while it was read");
  " != "                the exact command log, eject list, stage or receipt field differs;
  "not raised"          a guard that must refuse now lets the probe through;
  the others name the one observable the rule protects (see each row).
The unmutated copy must pass every designated test and the whole file first. Exit status 1 names
any other outcome. Run it as root so the clone-owner rule's root-only test runs.

Not mutated, each shadowed by a stronger rule a test already pins: the clone's S_ISREG (a symlink
fails the 0600 mode, a directory the single link, a FIFO the size) and O_NOFOLLOW behind it; the
timed_out half of plist_of() and of the mount check (attempt() gives every timed-out row a None
returncode); the receipt's exclusive create, which is host_vm_preflight.write_record's own; and
`still is False` in `clean`, since a mount point whose unmount was not confirmed is always kept
and its presence alone already makes the run unclean; O_NONBLOCK on the lock opens (without it
the FIFO test would hang rather than fail); the st_dev half of the re-verification (the fake
mount cannot change device); and the fsync_parent() calls, which no test can observe.
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
     "    require(fixture, PRODUCTION_REFUSAL)", "    require(True, PRODUCTION_REFUSAL)"),
    ('cli_usage', 'does not match', M + 'EntryRefusals.test_cli_runs_only_as_the_fixture_and_its_usage_is_exact',
     "require(len(sys.argv) in (4, 5) and sys.argv[4:] in ([], ['--fixture']),", "require(len(sys.argv) >= 4,"),
    ('owned_capture', NOMATCH, M + 'EntryRefusals.test_capture_directory_and_output_are_owned_and_fresh',
     "    owned_directory(capture_dir)\n", ""),
    ('output_child', NOMATCH, M + 'EntryRefusals.test_capture_directory_and_output_are_owned_and_fresh',
     "require(output.parent == capture_dir,", "require(True,"),
    ('lock_taken', NOMATCH, M + 'EntryRefusals.test_arm_lock_holder_refuses_before_any_command',
     "                fcntl.flock(held[-1], fcntl.LOCK_EX | fcntl.LOCK_NB)\n", "                pass\n"),
    ('lock_exclusive', NOMATCH, M + 'EntryRefusals.test_arm_lock_holder_refuses_before_any_command',
     "fcntl.flock(held[-1], fcntl.LOCK_EX | fcntl.LOCK_NB)", "fcntl.flock(held[-1], fcntl.LOCK_SH | fcntl.LOCK_NB)"),
    ('lock_held', DIFF, POSITIVE,
     "            return locked_read(capture_dir, output, table, locks[-1])",
     "            fcntl.flock(locks[-1], fcntl.LOCK_UN)\n            return locked_read(capture_dir, output, table, locks[-1])"),
    ('fixture_parent', NOMATCH, M + 'EntryRefusals.test_only_an_owned_fixture_parent_is_accepted',
     "require(capture_dir.parent.name.startswith(FIXTURE_PARENTS),", "require(True,"),
    ('parent_owned', NOMATCH, M + 'EntryRefusals.test_capture_directory_and_output_are_owned_and_fresh',
     "    owned_directory(capture_dir.parent)\n", ""),
    ('output_name', NOMATCH, M + 'EntryRefusals.test_capture_directory_and_output_are_owned_and_fresh',
     "require(OUTPUT_NAME.fullmatch(output.name),", "require(True,"),
    ('umask_restored', DIFF, POSITIVE, "    finally:\n        os.umask(previous)\n", "    finally:\n        pass\n"),
    ('worker_lock', NOMATCH, M + 'EntryRefusals.test_a_capture_worker_still_running_or_an_unsafe_worker_lock_refuses',
     "LOCKS = (('CAPTURE_ACTIVE.lock', 'capture worker is still active'),\n"
     "         ('ARMED.json', 'capture is busy: another holder has the arm lock'))",
     "LOCKS = (('ARMED.json', 'capture is busy: another holder has the arm lock'),)"),
    ('lock_file_regular', NOMATCH, M + 'EntryRefusals.test_the_arm_lock_is_a_regular_file_opened_without_following_or_blocking',
     "require(stat.S_ISREG(info.st_mode) and info.st_uid == os.getuid() and info.st_nlink == 1\n                    and stat.S_IMODE",
     "require(info.st_uid == os.getuid() and info.st_nlink == 1\n                    and stat.S_IMODE"),
    ('lock_file_mode', NOMATCH, M + 'EntryRefusals.test_a_capture_worker_still_running_or_an_unsafe_worker_lock_refuses',
     "\n                    and stat.S_IMODE(info.st_mode) == 0o600, name", ", name"),
    ('lock_nofollow', 'is not an instance of',
     M + 'EntryRefusals.test_the_arm_lock_is_a_regular_file_opened_without_following_or_blocking',
     "os.open(capture_dir / name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)",
     "os.open(capture_dir / name, os.O_RDONLY | os.O_NONBLOCK)"),
    ('cli_early_refusal', 'command run', M + 'EntryRefusals.test_cli_runs_only_as_the_fixture_and_its_usage_is_exact',
     "    require(sys.argv[4:] == ['--fixture'], PRODUCTION_REFUSAL)\n", ""),
    ('stdin_closed', 'expected call not found', M + 'Attempt.test_every_command_is_bounded_and_reads_no_stdin',
     "capture_output=True, timeout=timeout, stdin=subprocess.DEVNULL)", "capture_output=True, timeout=timeout)"),
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
     "require(capture.get('vm_uuid') == FIXTURE_UUID == commitment['started_sample'].get('vm_uuid'),",
     "require(commitment['started_sample'].get('vm_uuid') == FIXTURE_UUID,"),
    ('started_sample_vm', RECEIPT, M + 'InputRefusals.test_the_hosts_own_started_sample_must_name_the_fixture_vm',
     "require(capture.get('vm_uuid') == FIXTURE_UUID == commitment['started_sample'].get('vm_uuid'),",
     "require(capture.get('vm_uuid') == FIXTURE_UUID,"),
    ('capture_read_once', NOMATCH, M + 'InputRefusals.test_the_capture_record_the_pins_were_checked_on_is_the_one_used',
     "    require(private_bytes(capture_dir / 'CAPTURE.json') == raw, 'capture record changed while it was read')\n", ""),
    ('arm_bound', RECEIPT, M + 'InputRefusals.test_the_locked_arm_record_must_be_the_capture_arm_record',
     "require([locked.st_dev, locked.st_ino] == before['arm_record'],", "require(True,"),
    ('volume_named', NOMATCH, M + 'InputRefusals.test_capture_record_must_be_a_stopped_fixture_capture_naming_its_volume',
     "require(isinstance(capture.get('data_volume_uuid'), str) and capture['data_volume_uuid'],",
     "require(True,"),
    ('clone_uid', 'not raised', M + 'InputRefusals.test_a_clone_owned_by_another_user_is_refused',
     "info.st_uid == os.getuid() and info.st_nlink == 1\n            and stat.S_IMODE(info.st_mode) == 0o600 and info.st_size",
     "info.st_nlink == 1\n            and stat.S_IMODE(info.st_mode) == 0o600 and info.st_size"),
    ('clone_nlink', RECEIPT, M + 'InputRefusals.test_clone_must_be_the_owned_single_link_image_of_the_pinned_size_and_hash',
     "and info.st_nlink == 1\n            and stat.S_IMODE(info.st_mode) == 0o600 and info.st_size",
     "\n            and stat.S_IMODE(info.st_mode) == 0o600 and info.st_size"),
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
    ('verify_called', DIFF, M + 'Verify.test_the_reader_runs_only_on_a_read_only_nodev_nosuid_noexec_mount_honouring_owners',
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
    ('mnt_on', NOMATCH, M + 'Verify.test_the_reader_runs_only_on_a_read_only_nodev_nosuid_noexec_mount_honouring_owners',
     "require(found['mntonname'] == str(mount),", "require(True,"),
    ('mnt_from', NOMATCH, M + 'Verify.test_the_reader_runs_only_on_a_read_only_nodev_nosuid_noexec_mount_honouring_owners',
     "require(found['mntfromname'] == volume,", "require(True,"),
    ('fstype', NOMATCH, M + 'Verify.test_the_reader_runs_only_on_a_read_only_nodev_nosuid_noexec_mount_honouring_owners',
     "require(found['fstypename'] == 'apfs',", "require(True,"),
    ('flag_rdonly', NOMATCH, M + 'Verify.test_the_reader_runs_only_on_a_read_only_nodev_nosuid_noexec_mount_honouring_owners',
     "REQUIRED_FLAGS = (('read-only', MNT_RDONLY), ", "REQUIRED_FLAGS = ("),
    ('flag_nodev', NOMATCH, M + 'Verify.test_the_reader_runs_only_on_a_read_only_nodev_nosuid_noexec_mount_honouring_owners',
     "('nodev', MNT_NODEV), ", ""),
    ('flag_nosuid', NOMATCH, M + 'Verify.test_the_reader_runs_only_on_a_read_only_nodev_nosuid_noexec_mount_honouring_owners',
     "('nosuid', MNT_NOSUID),", ""),
    ('flag_noexec', NOMATCH, M + 'Verify.test_the_reader_runs_only_on_a_read_only_nodev_nosuid_noexec_mount_honouring_owners',
     "                  ('noexec', MNT_NOEXEC))", "                  )"),
    ('flags_checked', NOMATCH, M + 'Verify.test_the_reader_runs_only_on_a_read_only_nodev_nosuid_noexec_mount_honouring_owners',
     "require(not missing, 'mount is not ' + ', '.join(missing))", "require(True, '')"),
    ('ignore_ownership', NOMATCH, M + 'Verify.test_the_reader_runs_only_on_a_read_only_nodev_nosuid_noexec_mount_honouring_owners',
     "require(not found['flags'] & MNT_IGNORE_OWNERSHIP,", "require(True,"),
    # The reader's result bound to the mount and the commitment; the mount verified again after it.
    ('read_device', RECEIPT, M + 'Reader.test_the_reader_result_is_bound_to_the_mount_and_the_commitment',
     "all(row['device'] == device for row in summary['read'])", "True"),
    ('read_nonempty', RECEIPT, M + 'Reader.test_the_reader_result_is_bound_to_the_mount_and_the_commitment',
     "require(summary['read'] and all(", "require(all("),
    ('reader_checkpoint', RECEIPT, M + 'Reader.test_the_reader_result_is_bound_to_the_mount_and_the_commitment',
     "require(summary['checkpoint_sha256'] == before['commitment']['checkpoint']['checkpoint_sha256']\n                and ",
     "require("),
    ('reader_pre_head', RECEIPT, M + 'Reader.test_the_reader_result_is_bound_to_the_mount_and_the_commitment',
     "\n                and summary['pre_head'] == before['commitment']['manifest']['journal_head'],", ","),
    ('reverify', RECEIPT, M + 'Reader.test_the_mount_must_verify_unchanged_after_the_read',
     "        require(verify_mount(mount, volume, before['data_volume_uuid']) == verified\n"
     "                and os.stat(mount).st_dev == device, 'the mount changed while it was read')\n", ""),
    ('reverify_equal', RECEIPT, M + 'Reader.test_the_mount_must_verify_unchanged_after_the_read',
     "require(verify_mount(mount, volume, before['data_volume_uuid']) == verified\n",
     "require(verify_mount(mount, volume, before['data_volume_uuid']) is not None\n"),
    # Failure handling: the primary error kept, cleanup on every path, evidence never replacing it.
    ('primary_kept', NOMATCH, M + 'Reader.test_a_reader_failure_keeps_its_primary_error_and_releases',
     "        record_failure(output, stage, error, cleanup)\n        raise\n    cleanup, interrupt",
     "        record_failure(output, stage, error, cleanup)\n        raise RuntimeError('masked') from error\n"
     "    cleanup, interrupt"),
    ('interrupt_released', 'No such file or directory', M + 'Reader.test_an_interrupt_during_the_read_is_released_and_reraised',
     "    except BaseException as error:\n        # The primary error is raised",
     "    except Exception as error:\n        # The primary error is raised"),
    ('released_on_failure', DIFF,
     M + 'Attach.test_an_attach_that_failed_or_timed_out_after_it_applied_is_ejected_from_the_inventory',
     "        cleanup, _ = release(clone, mount, attach_attempted, known)\n", "        cleanup = None\n"),
    ('evidence_never_raises', ' is not ', M + 'Cleanup.test_a_failing_or_interrupted_evidence_write_never_replaces_the_primary_error',
     "                                              'cleanup': cleanup})\n    except BaseException:",
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
     "for tries in range(EJECT_ATTEMPTS):", "for tries in range(1):"),
    ('eject_stops', DIFF, POSITIVE, "                if ejected and ejected['returncode'] == 0:\n                    break\n", ""),
    ('unmount_unknown', DIFF, M + 'Cleanup.test_an_unknown_mount_state_is_still_unmounted_and_recorded',
     "if step('mounted before cleanup', mounted) is not False:", "if step('mounted before cleanup', mounted):"),
    ('point_removed', RECEIPT, POSITIVE, "            step('remove mount point', lambda: remove_mount_point(mount))\n",
     "            pass\n"),
    ('clean_remaining', 'is not false', M + 'Attach.test_an_attachment_the_inventory_still_lists_is_never_clean',
     "'clean': (remaining == 0 or not attached)\n", "'clean': True\n"),
    ('point_only_unmounted', DIFF, M + 'Cleanup.test_the_mount_point_is_removed_only_once_known_unmounted_and_empty',
     "if still is False and os.path.lexists(mount):", "if os.path.lexists(mount):"),
    ('point_empty', DIFF, M + 'Cleanup.test_the_mount_point_is_removed_only_once_known_unmounted_and_empty',
     "    with os.scandir(mount) as entries:\n        require(next(entries, None) is None, 'mount point is not empty')\n", ""),
    ('point_directory', DIFF, M + 'Cleanup.test_the_mount_point_is_removed_only_once_known_unmounted_and_empty',
     "    require(stat.S_ISDIR(mount.lstat().st_mode), 'mount point is not a directory')\n", ""),
    ('pause_between', DIFF, M + 'Cleanup.test_incomplete_cleanup_after_a_good_read_writes_no_receipt',
     "                if tries:\n                    time.sleep(EJECT_PAUSE)\n",
     "                time.sleep(EJECT_PAUSE)\n                if tries:\n"),
    ('interrupt_caught', ' is not ', M + 'Cleanup.test_an_interrupt_stops_cleanup_after_a_failure_and_the_primary_error_is_raised',
     "    except BaseException as interrupt:", "    except Exception as interrupt:"),
    ('interrupt_stops', DIFF, M + 'Cleanup.test_an_interrupt_stops_cleanup_after_a_failure_and_the_primary_error_is_raised',
     "        except Exception as error:\n            steps.append({'step': name, 'error': repr(error)[:300]})",
     "        except BaseException as error:\n            steps.append({'step': name, 'error': repr(error)[:300]})"),
    ('primary_over_interrupt', ' is not ',
     M + 'Cleanup.test_an_interrupt_stops_cleanup_after_a_failure_and_the_primary_error_is_raised',
     "        cleanup, _ = release(clone, mount, attach_attempted, known)\n        record_failure(output, stage, error, cleanup)\n        raise\n",
     "        cleanup, late = release(clone, mount, attach_attempted, known)\n        record_failure(output, stage, error, cleanup)\n"
     "        raise late if late is not None else error\n"),
    ('interrupt_raised', ' is not ', M + 'Cleanup.test_an_interrupt_during_cleanup_after_a_good_read_is_raised_with_its_evidence',
     "        if interrupt is not None:\n            raise interrupt\n", ""),
    ('evidence_interrupt', ' is not ',
     M + 'Cleanup.test_a_failing_or_interrupted_evidence_write_never_replaces_the_primary_error',
     "                                              'cleanup': cleanup})\n    except BaseException:",
     "                                              'cleanup': cleanup})\n    except Exception:"),
    ('known_gone', 'is not false', M + 'Cleanup.test_an_inventory_that_misses_the_attach_never_counts_as_clean',
     "            and all(row is not None and row['returncode'] not in (0, None) for row in gone)\n", ""),
    ('known_checked', DIFF, M + 'Cleanup.test_an_inventory_that_misses_the_attach_never_counts_as_clean',
     "for disk in (known if attached else ())]", "for disk in ()]"),
    ('retry_rebinds', RECEIPT, M + 'Cleanup.test_a_retried_eject_never_takes_a_reused_disk_number',
     "                    if disk not in (step('attachments before eject retry', clone_disks) or ()):\n"
     "                        break\n", ""),
    ('receipt_staged', 'is not false', M + 'Receipt.test_the_receipt_is_published_whole_or_not_at_all',
     "        write_record(aside, receipt)\n        os.link(aside, final)\n        linked = True\n        os.unlink(aside)\n",
     "        write_record(final, receipt)\n        linked = True\n"),
    ('receipt_rollback', 'is not false', M + 'Receipt.test_the_receipt_is_published_whole_or_not_at_all',
     "        for path in (final, aside) if linked else (aside,):", "        for path in (aside,):"),
    ('receipt_staging_fresh', 'is not an instance of', M + 'Receipt.test_the_receipt_is_published_whole_or_not_at_all',
     "    require(not os.path.lexists(aside), 'receipt staging file already exists')\n", ""),
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
    ('probe_report_on_interrupt', "KeyError: 'error'",
     M + 'ProbeGuards.test_an_interrupted_probe_still_releases_writes_its_report_and_reraises',
     "    except BaseException as interrupt:\n"
     "        # Recorded, then raised again once the image is released and the report is written.\n"
     "        report['error'] = repr(interrupt)[:500]\n        raise\n", "", PROBE),
    ('probe_report_in_finally', 'No such file or directory',
     M + 'ProbeGuards.test_an_interrupted_probe_still_releases_writes_its_report_and_reraises',
     "        # Plist values reach the report as-is; anything JSON cannot hold is kept as its repr.\n"
     "        write_record(output, json.loads(json.dumps(report, default=repr)))\n    return 0",
     "    write_record(output, json.loads(json.dumps(report, default=repr)))\n    return 0", PROBE),
    ('probe_known_disks', DIFF, M + 'ProbeRelease.test_an_inventory_blind_to_its_own_attach_is_still_ejected_and_confirmed_gone',
     "        known = [disk for disk in dict.fromkeys(disks) if disk not in listed\n"
     "                 and attempt(DISKUTIL, 'info', '-plist', disk)['returncode'] == 0]\n", "        known = []\n", PROBE),
    ('probe_disks_gone', DIFF, M + 'ProbeRelease.test_an_inventory_blind_to_its_own_attach_is_still_ejected_and_confirmed_gone',
     "and all(gone) and still == []", "and still == []", PROBE),
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
