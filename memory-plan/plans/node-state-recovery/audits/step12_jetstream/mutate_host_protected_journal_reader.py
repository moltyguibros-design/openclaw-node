import pathlib
import subprocess
import sys


STEP = pathlib.Path(__file__).resolve().parent
CASES = (
    ('anchor-compare', 'host_protected_journal_reader',
     "anchored == {**held['value'], 'authority': authority}", 'True',
     'Protected.test_anchor_mismatch_refuses_before_pending_or_clone'),
    ('copy-hash', 'host_protected_journal_reader',
     "digest == expected['sha256'] and size == expected['size']", 'True',
     'Protected.test_bad_copy_bytes_refuse_before_attach'),
    ('source-shape', 'host_protected_journal_reader',
     "getattr(os.fstat(item.fd), 'st_flags', 0) == 0 and xattrs(item.fd) == ()", 'True',
     'Shape.test_source_flags_and_xattrs_refuse'),
    *((name, 'host_protected_journal_reader', old, 'True',
       'Shape.test_root_copy_shape_rejects_each_wrong_field_and_xattrs') for name, old in (
        ('copy-owner', 'info.st_uid == 0'), ('copy-links', 'info.st_nlink == 1'),
        ('copy-mode', 'stat.S_IMODE(info.st_mode) == 0o600'), ('copy-device', 'info.st_dev == device'),
        ('copy-flags', "getattr(info, 'st_flags', 0) == 0"), ('copy-xattrs', 'attributes == ()'))),
    ('failed-attach-disk', 'host_protected_journal_reader', 'known = m.attached_disk(attached)', 'known = []',
     'Protected.test_failed_attach_result_is_retained_for_cleanup'),
    ('semantic-reader', 'host_protected_journal_reader',
     'summary = stopped.verify_stopped_bytes(files, mount, owner=guest_uid, writer_uid=writer_uid)',
     "summary = {'checkpoint_sha256': commitment['checkpoint']['checkpoint_sha256'], "
     "'pre_head': commitment['manifest']['journal_head'], 'read': [{'device': device}]}",
     'Protected.test_corrupt_chain_is_refused_by_the_actual_shared_reader'),
    ('read-device', 'host_protected_journal_reader',
     "summary['read'] and all(row['device'] == device for row in summary['read'])", 'True',
     'Protected.test_read_device_binding_is_required'),
    ('read-commitment', 'host_protected_journal_reader',
     "and summary['pre_head'] == commitment['manifest']['journal_head']", '',
     'Protected.test_read_outside_mount_and_wrong_commitment_refuse'),
    ('mount-reverify', 'host_protected_journal_reader',
     "m.verify_mount(mount, volume, capture['data_volume_uuid']) == verified\n"
     "                  and os.stat(mount).st_dev == device", 'True', 'Protected.test_changed_mount_refuses'),
    ('cleanup-gate', 'host_protected_journal_reader', "if not cleanup['clean']:", 'if False:',
     'Protected.test_cleanup_failure_never_publishes_a_receipt'),
    ('pending-consumer', 'host_protected_journal_reader',
     'not any(name in os.listdir(directory.fd) for name in (pending, staged))', 'True',
     'Protected.test_receipt_with_pending_is_not_consumed'),
    *((name, 'host_protected_journal_reader', old, 'True',
       'Protected.test_receipt_requires_each_protected_binding') for name, old in (
        ('receipt-scope', "value.get('scope') == SCOPE"),
        ('receipt-nonce', "value.get('capture_nonce') == nonce"),
        ('receipt-owner', "value.get('owner_context') == context(capture_uid, guest_uid, writer_uid)"),
        ('receipt-anchor-hash', "value.get('anchor_sha256') == a.sha(raw)"),
        ('receipt-files', "value.get('files') == anchored['files']"),
        ('receipt-anchor-authority', "anchored.get('authority') == authority"),
        ('receipt-authority', "value.get('authority') == authority"),
        ('receipt-code', "value.get('code_sha256') == code['hashes']"),
        ('receipt-cleanup', "value.get('cleanup', {}).get('clean') is True"),
        ('receipt-copy-removed', "value.get('copy_removed') is True"))),
    ('receipt-runtime', 'host_protected_journal_reader',
     "            a.require(code['check']() == code['authority'], 'reader runtime changed')\n"
     "            directory.check()\n            return value",
     '            directory.check()\n            return value', 'Protected.test_receipt_runtime_is_rechecked'),
    ('one-read', 'host_protected_journal_reader',
     'not any(name in os.listdir(directory.fd) for name in (pending, final, staged))', 'True',
     'Protected.test_one_read_per_nonce_and_no_success_receipt_overwrite'),
    ('runtime-before-attach', 'host_protected_journal_reader',
     "        a.require(code['check']() == code['authority'], 'reader runtime changed')\n        attempted = True",
     '        attempted = True', 'Protected.test_runtime_is_rechecked_before_first_attach'),
    ('runtime-before-final', 'host_protected_journal_reader',
     "                    a.require(code['check']() == code['authority'], 'reader runtime changed')\n                    work.check()",
     '                    work.check()', 'Protected.test_final_runtime_check_is_required'),
    ('code-exact-entries', 'host_capture_anchor', 'set(os.listdir(directory.fd)) == names', 'True',
     'CodeClosure.test_extra_code_or_cache_entry_refuses_before_project_import'),
    ('code-origin', 'host_capture_anchor',
     "module is None or getattr(module, '__file__', None) == str(program.parent / (name + '.py'))", 'True',
     'CodeClosure.test_wrong_preloaded_origin_refuses_before_importing_project_code'),
    ('code-resolution', 'host_capture_anchor',
     "found is not None and found.origin == str(program.parent / (name + '.py'))", 'True',
     'CodeClosure.test_wrong_resolution_refuses_before_project_import'),
    ('code-loaded-set', 'host_capture_anchor', 'observed == names', 'True',
     'CodeClosure.test_changed_loaded_local_set_refuses'),
    ('code-hash', 'host_capture_anchor', "item.read(True)[1] == hashes[name]", 'True',
     'CodeClosure.test_source_digest_is_rechecked_not_just_metadata'),
    ('capture-current-uid', 'host_capture_anchor',
     'authority = entry(root, capture, capture_uid, nonce, fixture)',
     'authority = entry(root, capture, os.getuid(), nonce, fixture)',
     'Protected.test_three_uid_roles_are_passed_without_swaps_or_current_uid_fallbacks'),
    ('guest-current-uid', 'host_protected_journal_reader', 'owner=guest_uid, writer_uid=writer_uid)',
     'owner=os.getuid(), writer_uid=writer_uid)',
     'Protected.test_three_uid_roles_are_passed_without_swaps_or_current_uid_fallbacks'),
    ('writer-current-uid', 'host_protected_journal_reader', 'owner=guest_uid, writer_uid=writer_uid)',
     'owner=guest_uid, writer_uid=os.getuid())',
     'Protected.test_three_uid_roles_are_passed_without_swaps_or_current_uid_fallbacks'),
    ('guest-global-writer', 'host_protected_journal_reader', 'owner=guest_uid, writer_uid=writer_uid)',
     'owner=commit.preservation_journal.NATS_ROOT_UID, writer_uid=writer_uid)',
     'Protected.test_three_uid_roles_are_passed_without_swaps_or_current_uid_fallbacks'),
    ('writer-global-writer', 'host_protected_journal_reader', 'owner=guest_uid, writer_uid=writer_uid)',
     'owner=guest_uid, writer_uid=commit.preservation_journal.NATS_ROOT_UID)',
     'Protected.test_three_uid_roles_are_passed_without_swaps_or_current_uid_fallbacks'),
    *((name, 'host_capture_anchor',
       'sys.modules[__name__], root, capture, capture_uid, nonce,\n                             guest_uid, writer_uid, authority, code)', new,
       'Protected.test_three_uid_roles_are_passed_without_swaps_or_current_uid_fallbacks') for name, new in (
        ('swap-capture-guest', 'sys.modules[__name__], root, capture, guest_uid, nonce,\n                             capture_uid, writer_uid, authority, code)'),
        ('swap-capture-writer', 'sys.modules[__name__], root, capture, writer_uid, nonce,\n                             guest_uid, capture_uid, authority, code)'),
        ('swap-guest-writer', 'sys.modules[__name__], root, capture, capture_uid, nonce,\n                             writer_uid, guest_uid, authority, code)'),
        ('capture-global-writer', "sys.modules[__name__], root, capture, code['modules']['preservation_journal'].NATS_ROOT_UID, nonce,\n                             guest_uid, writer_uid, authority, code)"))),
    ('capture-scope', 'host_journal_mount',
     "capture.get('scope') == CAPTURE_SCOPE", 'True', 'Shape.test_shared_capture_record_enforces_scope_fixture_and_uuid'),
    ('capture-data-uuid', 'host_journal_mount',
     "isinstance(capture.get('data_volume_uuid'), str) and capture['data_volume_uuid']", 'True',
     'Shape.test_shared_capture_record_enforces_scope_fixture_and_uuid'),
)


def main():
    baseline = subprocess.run([sys.executable, '-m', 'unittest', '-q', 'test_host_protected_journal_reader'],
                              cwd=STEP, capture_output=True, text=True, timeout=240)
    if baseline.returncode:
        print(baseline.stdout + baseline.stderr)
        return 1
    print('protected-reader unmutated controls passed', flush=True)
    print(baseline.stderr.strip(), flush=True)
    for name, module, old, new, target in CASES:
        source = (STEP / (module + '.py')).read_text()
        count = source.count(old)
        if count != (2 if name == 'code-exact-entries' else 1):
            raise RuntimeError((name, 'mutation anchor count', count))
        mutated = source.replace(old, new)
        code = ('import host_capture_anchor as a; import importlib; m=importlib.import_module(%r); '
                'a._test_reader_sources={%r:%r}; exec(compile(%r,m.__file__,"exec"),m.__dict__); '
                'import unittest; s=unittest.defaultTestLoader.loadTestsFromName(%r); '
                'r=unittest.TextTestRunner(verbosity=2).run(s); raise SystemExit(not r.wasSuccessful())'
                % (module, module + '.py', mutated.encode(), mutated,
                   'test_host_protected_journal_reader.' + target))
        done = subprocess.run([sys.executable, '-c', code], cwd=STEP, capture_output=True, text=True, timeout=90)
        output = done.stdout + done.stderr
        method = target.rsplit('.', 1)[1]
        if (done.returncode != 1 or 'FAIL: ' + method not in output
                or 'AssertionError' not in output or 'ERROR:' in output):
            print(name + ': no intended assertion kill\n' + output)
            return 1
        print(name + ': intended assertion killed', flush=True)
    return 0


if __name__ == '__main__':
    sys.exit(main())
