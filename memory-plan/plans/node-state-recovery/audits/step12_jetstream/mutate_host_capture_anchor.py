import pathlib
import subprocess
import sys


STEP = pathlib.Path(__file__).resolve().parent
CASES = (
    ('production-refusal', "require(fixture, 'production protected capture anchoring is disabled')",
     "require(True, 'production protected capture anchoring is disabled')",
     'Authority.test_production_and_nonroot_calls_refuse_before_any_open'),
    ('root-authority', 'os.getuid() == 0 and os.geteuid() == 0', 'True',
     'Authority.test_production_and_nonroot_calls_refuse_before_any_open'),
    ('isolated-runtime', 'sys.flags.isolated and sys.flags.no_site and sys.flags.dont_write_bytecode', 'True',
     'Authority.test_invocation_flags_are_required_before_runtime_paths'),
    ('trusted-program', 'program_sha = trusted_path(pathlib.Path(__file__).resolve(), program=True)',
     "program_sha = 'unverified'", 'Authority.test_program_trust_failure_precedes_interpreter_use'),
    ('trusted-parent', 'with Directory(path.parent, {0}, private=False) as directory:',
     'with Directory(path.parent, {0, path.parent.stat().st_uid}, private=False) as directory:',
     'TrustPaths.test_nonroot_directory_and_required_root_parent_refuse'),
    ('trusted-file', 'with Input(directory, path.name, 0, private=False, single_link=program) as item:',
     'with Input(directory, path.name, path.stat().st_uid, private=False, single_link=program) as item:',
     'TrustPaths.test_nonroot_file_refuses_with_its_parent_modelled_separately'),
    ('trusted-path-bypass', '    path = pathlib.Path(path).resolve()',
     '    path = pathlib.Path(path).resolve()\n    return str(path)',
     'TrustPaths.test_nonroot_directory_and_required_root_parent_refuse'),
    ('trusted-module-file', '                trusted_path(file)', '                pass',
     'TrustPaths.test_loaded_module_file_metadata_is_checked_inside_allowed_paths'),
    ('bytecode-prefix', 'sys.pycache_prefix == str(prefix) and not os.path.lexists(prefix)', 'True',
     'TrustPaths.test_missing_wrong_or_existing_cache_prefix_refuses'),
    ('bytecode-policy-call', 'prefix = trusted_cache_prefix(pathlib.Path(__file__).resolve())',
     "prefix = '/unverified'", 'Authority.test_cache_policy_precedes_interpreter_use'),
    ('sudo-capture-user', "os.environ.get('SUDO_UID', str(writer_uid)) == str(writer_uid)", 'True',
     'Authority.test_sudo_uid_mismatch_refuses_before_runtime_checks'),
    ('ancestor-owner', 'and info.st_uid in owners', '',
     'Authority.test_directory_owner_private_mode_and_writable_parent_refuse'),
    ('private-root-mode', '(not private or stat.S_IMODE(info.st_mode) == 0o700)', 'True',
     'Authority.test_directory_owner_private_mode_and_writable_parent_refuse'),
    ('writable-ancestor', 'and not stat.S_IMODE(info.st_mode) & 0o022', '',
     'Authority.test_directory_owner_private_mode_and_writable_parent_refuse'),
    ('acl-grant', "re.match(r'\s*\d+:', line) and ' allow ' in line", 'False',
     'Authority.test_acl_grants_and_unreadable_acl_refuse'),
    ('input-owner', 'and self.initial.st_uid == owner', '', 'Anchor.test_wrong_input_owner_refuses'),
    ('single-link', '(not single_link or self.initial.st_nlink == 1)', 'True',
     'Anchor.test_nonprivate_or_linked_input_refuses'),
    ('descriptor-mapping', 'identity(self.initial) == identity(before) == identity(current)\n'
     '                == identity(os.fstat(self.fd))', 'True',
     'Anchor.test_descriptor_mapping_replacement_refuses_even_for_identical_bytes'),
    ('nonce-binding', "all(value.get('capture_nonce') == nonce for value in (arm, commit, checkpoint))", 'True',
     'Anchor.test_operator_nonce_must_match_the_unchanged_capture'),
    ('capture-pins', 'all(capture_value.get(key) == reads[name][1] for key, name in PINS.items())', 'True',
     'Anchor.test_capture_pin_and_nonce_changes_refuse_before_publication'),
    *((('capture-pin-' + field,
        'all(capture_value.get(key) == reads[name][1] for key, name in PINS.items())',
        "all(capture_value.get(key) == reads[name][1] for key, name in PINS.items() if key != %r)" % field,
        'Anchor.test_capture_pin_and_nonce_changes_refuse_before_publication'))
      for field in ('guest_commit_sha256', 'guest_ack_sha256', 'guest_checkpoint_sha256', 'window_pins_sha256')),
    ('commit-arm', "and commit.get('arm_sha256') == reads['ARMED.json'][1]", '',
     'Anchor.test_each_capture_byte_link_is_enforced'),
    ('arm-table', "and arm.get('window_pins_sha256') == reads['WINDOW_PINS.json'][1]", '',
     'Anchor.test_each_capture_byte_link_is_enforced'),
    ('ack-commit', "and ack.get('commit_sha256') == reads['COMMITTED.json'][1]", '',
     'Anchor.test_each_capture_byte_link_is_enforced'),
    ('checkpoint-commit', "and checkpoint.get('commit_sha256') == reads['COMMITTED.json'][1]", '',
     'Anchor.test_each_capture_byte_link_is_enforced'),
    ('checkpoint-ack', "and checkpoint.get('ack_sha256') == reads['ACKED.json'][1]", '',
     'Anchor.test_each_capture_byte_link_is_enforced'),
    ('clone-hash', "capture_value.get('clone_image_sha256') == reads[CLONE][1]", 'True',
     'Anchor.test_capture_pin_and_nonce_changes_refuse_before_publication'),
    ('clone-size', "and capture_value['clone_size'] == reads[CLONE][2]", '',
     'Anchor.test_each_clone_and_fixture_claim_is_enforced'),
    ('clone-size-type', "and type(capture_value.get('clone_size')) is int", '',
     'Anchor.test_each_clone_and_fixture_claim_is_enforced'),
    ('stopped-capture', "and capture_value.get('vm_state_at_final_check') == 'stopped'", '',
     'Anchor.test_each_clone_and_fixture_claim_is_enforced'),
    ('fixture-identity', "capture_value.get('vm_uuid') == FIXTURE_UUID == arm.get('vm_uuid')", 'True',
     'Anchor.test_each_clone_and_fixture_claim_is_enforced'),
    ('fixture-arm-half', "capture_value.get('vm_uuid') == FIXTURE_UUID == arm.get('vm_uuid')",
     "capture_value.get('vm_uuid') == FIXTURE_UUID", 'Anchor.test_each_capture_byte_link_is_enforced'),
    ('fixture-capture-half', "capture_value.get('vm_uuid') == FIXTURE_UUID == arm.get('vm_uuid')",
     "FIXTURE_UUID == arm.get('vm_uuid')", 'Anchor.test_each_clone_and_fixture_claim_is_enforced'),
    ('no-repin', 'not any(name in os.listdir(directory.fd) for name in (final, pending))', 'True',
     'Anchor.test_repin_and_overwrite_refuse_without_changing_original'),
    ('file-durability', '            os.fsync(stream.fileno())', '            pass',
     'Anchor.test_link_follows_file_and_directory_sync'),
    ('pending-reader-fence', "nonce + '.pending' not in os.listdir(directory.fd)", 'True',
     'Anchor.test_interruption_after_link_keeps_pending_and_cannot_verify'),
    ('protected-byte-comparison', "value == {**snapshot(capture, writer_uid, nonce), 'authority': authority}", 'True',
     'Anchor.test_coordinated_capture_and_clone_rewrite_refuses_the_protected_anchor'),
)


def main():
    baseline = subprocess.run([sys.executable, '-m', 'unittest', '-q', 'test_host_capture_anchor'],
                              cwd=STEP, capture_output=True, text=True, timeout=240)
    if baseline.returncode:
        print(baseline.stdout + baseline.stderr)
        return 1
    print('unmutated anchor controls: passed', flush=True)
    print(baseline.stderr.strip(), flush=True)
    source = (STEP / 'host_capture_anchor.py').read_text()
    for name, old, new, target in CASES:
        if source.count(old) != 1:
            raise RuntimeError((name, 'mutation anchor count', source.count(old)))
        mutated = source.replace(old, new)
        method = target.rsplit('.', 1)[1]
        code = ('import host_capture_anchor as m; exec(compile(%r,m.__file__,"exec"),m.__dict__); '
                'import unittest; s=unittest.defaultTestLoader.loadTestsFromName(%r); '
                'r=unittest.TextTestRunner(verbosity=2).run(s); raise SystemExit(not r.wasSuccessful())'
                % (mutated, 'test_host_capture_anchor.' + target))
        result = subprocess.run([sys.executable, '-c', code], cwd=STEP,
                                capture_output=True, text=True, timeout=90)
        output = result.stdout + result.stderr
        if result.returncode != 1 or ('FAIL: ' + method) not in output or 'AssertionError' not in output:
            print(name + ': no intended assertion kill\n' + output)
            return 1
        print(name + ': intended assertion killed', flush=True)
    return 0


if __name__ == '__main__':
    sys.exit(main())
