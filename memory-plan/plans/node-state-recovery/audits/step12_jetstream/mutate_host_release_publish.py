import pathlib
import subprocess
import sys
import tempfile


STEP = pathlib.Path(__file__).resolve().parent
CASES = (
    ('root', None, 'os.getuid() == os.geteuid() == 0', 'True',
     'test_root_and_separate_nonzero_capture_identity_are_required'),
    ('capture-uid', None, 'capture_uid > 0', 'capture_uid >= 0',
     'test_root_and_separate_nonzero_capture_identity_are_required'),
    ('approval-before-parse', None, 'sha(raw) == expected', 'True',
     'test_manifest_independent_approval_precedes_parsing_or_staging'),
    ('schema-fields', None, "set(value) == {'schema', 'files'}", 'True',
     'test_schema_canonical_fields_and_binding_types_refuse'),
    ('schema-version', None, "value['schema'] == SCHEMA", 'True',
     'test_schema_canonical_fields_and_binding_types_refuse'),
    ('manifest-names', None, "set(value['files']) == NAMES", 'True',
     'test_schema_canonical_fields_and_binding_types_refuse'),
    ('binding-fields', None, "set(item) == {'size', 'sha256'}", 'True',
     'test_schema_canonical_fields_and_binding_types_refuse'),
    ('strict-size', None, "type(item['size']) is int", "isinstance(item['size'], int)",
     'test_schema_canonical_fields_and_binding_types_refuse'),
    ('canonical', None, 'encoded(value) == raw', 'True',
     'test_schema_canonical_fields_and_binding_types_refuse'),
    ('source-bindings', None,
     "{'size': len(snapshots[name]), 'sha256': sha(snapshots[name])} == bindings[name]", 'True',
     'test_payload_binding_requires_independent_size_and_hash'),
    ('source-name-set', None, 'entries(payload, NAMES)', 'None',
     'test_exact_bounded_entry_set_refuses_extras_and_missing'),
    ('snapshot-not-path', None, 'write_snapshot(code, name, snapshots[name], FILE_LIMIT)',
     'write_snapshot(code, name, (payload.path / name).read_bytes(), FILE_LIMIT)',
     'test_source_swap_after_snapshot_never_copies_later_path_bytes'),
    ('inert-payload', None, 'item = write_snapshot(code, name, snapshots[name], FILE_LIMIT)',
     'exec(compile(snapshots[name], name, "exec"), {}); item = write_snapshot(code, name, snapshots[name], FILE_LIMIT)',
     'test_honest_publication_is_exact_private_inert_and_receipt_only'),
    ('source-rehash', None, 'item.read() == snapshots[name]', 'True',
     'test_source_content_rehash_detects_drift_with_metadata_checks_isolated'),
    ('file-mapping', None,
     'identity(self.initial) == before == identity(mapped) == identity(os.fstat(self.fd))', 'True',
     'test_manifest_swap_before_publication_refuses'),
    ('directory-mapping', None,
     'all(before[key] == identity(mapped)[key] == identity(held)[key] for key in keys)', 'True',
     'test_ancestor_mapping_swap_refuses_before_publication'),
    ('new-file-metadata', 'write_snapshot', 'file_shape(os.fstat(fd), {0}, True)', 'None',
     'test_output_metadata_and_acl_checks_precede_payload_writes'),
    ('new-file-acl', 'write_snapshot', 'no_acl(parent.path / name, fd, parent.deadline)', 'None',
     'test_output_acl_refusal_precedes_any_payload_bytes'),
    ('reread', None, 'result.read() == raw', 'True',
     'test_reread_detects_written_byte_corruption'),
    ('file-sync', 'write_snapshot', 'os.fsync(fd)', 'None',
     'test_every_output_and_directory_sync_precedes_exclusive_publish'),
    ('directory-sync', None, 'os.fsync(code.fd)', 'None',
     'test_every_output_and_directory_sync_precedes_exclusive_publish'),
    ('parent-sync', None, 'stage.name = expected\n        os.fsync(parent.fd)', 'stage.name = expected',
     'test_every_output_and_directory_sync_precedes_exclusive_publish'),
    ('replace-rename', None,
     'os.fsencode(target), flag) != 0', 'os.fsencode(target), 0) != 0',
     'test_kernel_exclusivity_wins_against_late_empty_destination'),
    ('reuse-pending', None, 'os.mkdir(pending, mode=0o700, dir_fd=parent.fd)',
     'try:\n            os.mkdir(pending, mode=0o700, dir_fd=parent.fd)\n        except FileExistsError:\n            pass',
     'test_existing_pending_is_not_reused_or_deleted'),
    ('hardlinks', 'file_shape', 'info.st_nlink == 1', 'True',
     'test_link_fifo_directory_and_hardlink_inputs_refuse'),
    ('writable-payload', 'file_shape', 'not stat.S_IMODE(info.st_mode) & 0o022', 'True',
     'test_flags_xattrs_modes_and_manifest_links_refuse'),
    ('xattrs', 'has_xattrs', "if sys.platform != 'darwin':", "return False\n    if sys.platform != 'darwin':",
     'test_flags_xattrs_modes_and_manifest_links_refuse'),
    ('deadline', None, 'time.monotonic() < self.end', 'True',
     'test_read_deadline_is_checked_between_bounded_blocks'),
    ('ci-environment', None,
     "os.environ.get('CI') == 'true' and os.environ.get('GITHUB_ACTIONS') == 'true'", 'True',
     'test_python39_and_cli_fixture_environment_barriers'),
    ('runtime-flags', None,
     'sys.flags.isolated and sys.flags.no_site and sys.flags.dont_write_bytecode', 'True',
     'test_cli_flags_paths_and_sudo_metadata_refuse_before_core'),
    ('fixture-paths', None,
     "manifest == base / 'approved.json' and destination == base / 'programs'", 'True',
     'test_cli_flags_paths_and_sudo_metadata_refuse_before_core'),
    ('sudo-metadata', None, "os.environ.get('SUDO_UID') == str(capture_uid)", 'True',
     'test_cli_flags_paths_and_sudo_metadata_refuse_before_core'),
)


def main():
    baseline = subprocess.run([sys.executable, '-B', '-m', 'unittest', '-q',
                               'test_host_release_publish'], cwd=STEP,
                              capture_output=True, text=True, timeout=120)
    if baseline.returncode:
        print(baseline.stdout + baseline.stderr)
        return 1
    print('release-publication unmutated controls passed\n' + baseline.stderr.strip(), flush=True)
    source = (STEP / 'host_release_publish.py').read_text()
    with tempfile.TemporaryDirectory(prefix='openclaw-publisher-mutants-', dir=STEP) as temp:
        path = pathlib.Path(temp) / 'candidate.py'
        for name, scope, old, new, target in CASES:
            prefix = suffix = ''
            selected = source
            if scope:
                start = source.index('def ' + scope + '(')
                end = source.find('\ndef ', start + 1)
                prefix, selected, suffix = source[:start], source[start:end], source[end:]
            count = selected.count(old)
            expected = {'source-name-set': 2, 'source-rehash': 2}.get(name, 1)
            if count != expected:
                raise RuntimeError((name, 'mutation anchor count', count, expected))
            path.write_text(prefix + selected.replace(old, new) + suffix)
            script = ('import pathlib,unittest,test_host_release_publish as t; '
                      't.SOURCE=pathlib.Path(%r); '
                      's=unittest.defaultTestLoader.loadTestsFromName(%r); '
                      'r=unittest.TextTestRunner(verbosity=2).run(s); raise SystemExit(not r.wasSuccessful())'
                      % (str(path), 'test_host_release_publish.Publication.' + target))
            done = subprocess.run([sys.executable, '-B', '-c', script], cwd=STEP,
                                  capture_output=True, text=True, timeout=120)
            output = done.stdout + done.stderr
            if done.returncode != 1 or 'FAIL: ' + target not in output or 'AssertionError' not in output or 'ERROR:' in output:
                print(name + ': no intended assertion kill\n' + output)
                return 1
            print(name + ': intended assertion killed', flush=True)
    return 0


if __name__ == '__main__':
    sys.exit(main())
