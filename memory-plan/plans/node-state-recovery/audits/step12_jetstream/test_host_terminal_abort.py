"""Owned real cleanup producers; VM observations/flags scripted, no native image or service action."""
import ast
import contextlib
import copy
import hashlib
import json
import os
import pathlib
import stat
import sys
import unittest
from unittest import mock

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import host_clone_dispose as abort
import host_vm_preflight
from host_guest_commit import encoded
from host_vm_preflight import write_record
from test_host_abort_cleanup import owned


def digest(raw):
    return hashlib.sha256(raw).hexdigest()


@contextlib.contextmanager
def prepared():
    with owned() as case:
        case.run_cleanup()
        yield case


def produce(case):
    return abort.terminal_abort(case.host, case.capture, fixture=True)


def verify(case):
    with abort.abort_context(case.host, case.capture, True) as (host, capture, directory_fd, locks):
        return abort.verify_abort(host, capture, copy.deepcopy(case.stopped), directory_fd, locks, fixture=True)


def held(case, markers=()):
    case.assertEqual(case.flags[case.source], stat.UF_IMMUTABLE)
    case.assertEqual(case.source.read_bytes(), b'owned stopped source image stand-in')
    case.assertFalse(case.flag_calls)
    case.assertEqual(list(case.capture.rglob('BOOTABLE.json')), [p for p in markers if p.name == 'BOOTABLE.json'])
    case.assertEqual(list(case.capture.rglob('ACCEPTED.json')), [p for p in markers if p.name == 'ACCEPTED.json'])


def replace(path, **changes):
    value = json.loads(path.read_bytes())
    path.write_bytes(encoded({**value, **changes}))


class TerminalAbort(unittest.TestCase):
    def test_valid_decision_and_caller_held_readonly_verifier(self):
        with prepared() as case:
            result = produce(case)
            self.assertEqual(set(result), abort.ABORT_KEYS)
            self.assertEqual(result['decision'], 'ABORT')
            self.assertEqual(result['capture_nonce'], case.nonce)
            self.assertEqual(result['arm_sha256'], digest((case.capture / 'ARMED.json').read_bytes()))
            self.assertEqual(result['capture_sha256'], digest((case.capture / 'CAPTURE.json').read_bytes()))
            self.assertEqual(set(json.loads((case.capture / 'ABORT_CLEANUP_INTENT.json').read_bytes())), abort.CLEANUP_INTENT_KEYS)
            self.assertEqual(set(json.loads((case.capture / 'ABORT_CLEANUP.json').read_bytes())), abort.CLEANUP_KEYS)
            self.assertEqual(set(json.loads((case.capture / 'abort-decision/COMPLETE.json').read_bytes())), abort.COMPLETE_KEYS)
            with abort.abort_context(case.host, case.capture, True) as (host, capture, directory_fd, locks):
                original = {str(path): path.read_bytes() for path in capture.rglob('*') if path.is_file()}
                with mock.patch.object(abort, 'preflight', side_effect=AssertionError('verifier cannot observe/write')), \
                     mock.patch.object(abort, 'capture_locks', side_effect=AssertionError('verifier cannot take locks')), \
                     mock.patch.object(abort, 'write_record', side_effect=AssertionError('verifier cannot write')), \
                     mock.patch.object(abort, 'publish_abort_cleanup', side_effect=AssertionError('verifier cannot publish')):
                    verified = abort.verify_abort(host, capture, copy.deepcopy(case.stopped), directory_fd, locks, fixture=True)
                self.assertEqual(verified['abort'], (capture / 'ABORT.json').read_bytes())
                self.assertEqual(verified['sha256']['abort'], digest(verified['abort']))
                self.assertEqual(original, {str(path): path.read_bytes() for path in capture.rglob('*') if path.is_file()})
            held(case)
            self.assertFalse(case.clone.exists())
            with self.assertRaisesRegex(RuntimeError, 'already attempted'):
                produce(case)

    def test_production_refusal_precedes_every_observation(self):
        with mock.patch.object(abort.pathlib, 'Path', side_effect=AssertionError('path accessed')):
            for call in (lambda: abort.terminal_abort('/missing', '/missing'),
                         lambda: abort.verify_abort('/missing', '/missing', {}, -1, []),
                         lambda: abort.verify_abort_command('/missing', '/missing', '/missing')):
                with self.assertRaisesRegex(RuntimeError, 'production terminal abort'):
                    call()

    def test_viable_production_call_refuses_without_attempt(self):
        with prepared() as case:
            with self.assertRaisesRegex(RuntimeError, 'production terminal abort'):
                abort.terminal_abort(case.host, case.capture)
            self.assertFalse((case.capture / 'abort-decision').exists())
            self.assertFalse((case.capture / 'ABORT.json').exists())
            held(case)

    def test_native_sample_allowlist_tracks_actual_writer_names(self):
        tree = ast.parse(pathlib.Path(host_vm_preflight.__file__).read_text())
        names = {node.right.value for node in ast.walk(tree) if isinstance(node, ast.BinOp)
                 and isinstance(node.op, ast.Div) and isinstance(node.right, ast.Constant)
                 and isinstance(node.right.value, str) and node.right.value.endswith(('.json', '.plist', '.out', '.err'))
                 and isinstance(node.left, ast.Name) and node.left.id == 'output'}
        self.assertEqual(abort.PREFLIGHT_FILES, names - {'FAILED.json'})
        with prepared() as case:
            for name in ('before', 'before-remove', 'after'):
                output = case.capture / 'abort-cleanup' / name
                for filename in abort.PREFLIGHT_FILES - {'preflight.json', 'utm-status-cleanup.json'}:
                    write_record(output / filename, {})
                write_record(output / 'utm-status-cleanup.json', {'primary_error': None, 'booted_out': True})
            result = produce(case)
            self.assertEqual(len(result['cleanup_sample_sha256']), 3 * len(abort.PREFLIGHT_FILES))
            verify(case)
            held(case)

    def test_command_wrapper_records_fresh_sample_and_no_release(self):
        with prepared() as case:
            produce(case)
            result = abort.verify_abort_command(case.host, case.capture, case.capture / 'check-abort', fixture=True)
            self.assertEqual(result['abort'], (case.capture / 'ABORT.json').read_bytes())
            self.assertTrue((case.capture / 'check-abort/observed/preflight.json').exists())
            held(case)

    def test_clone_or_attachment_or_sibling_refuses(self):
        for fault in ('clone', 'sibling', 'attachment'):
            with self.subTest(fault=fault), prepared() as case:
                if fault == 'clone':
                    case.clone.write_bytes(b'new image')
                elif fault == 'sibling':
                    other = case.temp / 'another'
                    other.mkdir(mode=0o700)
                    (other / 'powered-off-image.asif').write_bytes(b'other')
                else:
                    case.patch(abort, 'no_disk_attachment', side_effect=RuntimeError('still attached'))
                with self.assertRaisesRegex(RuntimeError, 'clone reappeared|another temporary|still attached'):
                    produce(case)
                self.assertFalse((case.capture / 'ABORT.json').exists())
                held(case)

    def test_failed_partial_or_unknown_cleanup_refuses(self):
        for name in ('abort-cleanup/FAILED.json', 'ABORT_CLEANUP.json.tmp',
                     'abort-cleanup/after/utm-status.json.tmp', 'abort-cleanup/unknown',
                     'abort-cleanup/after/unknown', 'FAILED.json'):
            with self.subTest(name=name), prepared() as case:
                write_record(case.capture / name, {})
                with self.assertRaisesRegex(RuntimeError, 'fail|temporary|unknown'):
                    produce(case)
                self.assertFalse((case.capture / 'ABORT.json').exists())
                held(case)

    def test_missing_cleanup_or_sample_refuses(self):
        for name in ('ABORT_CLEANUP.json', 'ABORT_CLEANUP_INTENT.json', 'abort-cleanup/after/preflight.json'):
            with self.subTest(name=name), prepared() as case:
                (case.capture / name).unlink()
                with self.assertRaises((RuntimeError, FileNotFoundError)):
                    produce(case)
                self.assertFalse((case.capture / 'ABORT.json').exists())
                held(case)

    def test_helper_cleanup_error_refuses(self):
        for row in ({'primary_error': 'failed', 'booted_out': True}, {'primary_error': None, 'booted_out': False}):
            with self.subTest(row=row), prepared() as case:
                write_record(case.capture / 'abort-cleanup/after/utm-status-cleanup.json', row)
                with self.assertRaisesRegex(RuntimeError, 'unsuccessful helper'):
                    produce(case)
                held(case)

    def test_cleanup_exact_schema_canonical_and_hash_binding(self):
        for name, change in (('ABORT_CLEANUP_INTENT.json', {'extra': 1}),
                             ('ABORT_CLEANUP.json', {'clone_absent': 1}),
                             ('ABORT_CLEANUP.json', {'intent_sha256': '0' * 64}),
                             ('ABORT_CLEANUP.json', {'capture_nonce': '0' * 64}),
                             ('ABORT_CLEANUP.json', {'checkpoint_sha256': '0' * 64}),
                             ('ABORT_CLEANUP_INTENT.json', {'journal_head': '0' * 64}),
                             ('ABORT_CLEANUP.json', None)):
            with self.subTest(name=name, change=change), prepared() as case:
                path = case.capture / name
                if change is None:
                    path.write_bytes(path.read_bytes() + b' ')
                else:
                    replace(path, **change)
                    if name.endswith('INTENT.json'):
                        replace(case.capture / 'ABORT_CLEANUP.json', intent_sha256=digest(path.read_bytes()))
                with self.assertRaisesRegex(RuntimeError, 'schema|canonical|binding'):
                    produce(case)
                held(case)

    def test_consumed_commitment_must_equal_snapshot(self):
        with prepared() as case:
            real = abort.require_committed
            with mock.patch.object(abort, 'require_committed', side_effect=lambda cap: {**real(cap), 'at_utc': 'foreign'}):
                with self.assertRaisesRegex(RuntimeError, 'consumed commitment'):
                    produce(case)
            held(case)

    def test_input_pin_or_added_evidence_refuses(self):
        for name in ('host_spec', 'GUARD.json', 'ARMED.json', 'COMMITTED.json', 'ACKED.json', 'CHECKPOINT.json', 'CAPTURE.json', 'MATCH.json'):
            with self.subTest(name=name), prepared() as case:
                if name == 'MATCH.json':
                    parent = case.capture / 'later'
                    parent.mkdir(mode=0o700)
                    write_record(parent / name, {})
                else:
                    path = case.host if name == 'host_spec' else case.capture / name
                    path.write_bytes(path.read_bytes() + b' ')
                with self.assertRaisesRegex(RuntimeError, 'cleanup receipt binding'):
                    produce(case)
                held(case)

    def test_host_boot_device_state_or_guard_change_refuses(self):
        for key, value in (('host_boot_session', 'reboot'), ('image_device', -7), ('state', 'started'),
                           ('image_holders', [23]), ('holders_consistent', False), ('vmstate', {'new': 1}),
                           ('config_sha256', '1' * 64)):
            with self.subTest(key=key), prepared() as case:
                case.stopped[key] = value
                with self.assertRaisesRegex(RuntimeError, 'sample differs'):
                    produce(case)
                held(case)
        with prepared() as case:
            case.flags[case.source] = 0
            with self.assertRaisesRegex(RuntimeError, 'completed image guard'):
                produce(case)
            self.assertFalse(case.flag_calls)

    def test_source_metadata_touch_refuses_after_cleanup(self):
        with prepared() as case:
            info = case.source.stat()
            os.utime(case.source, ns=(info.st_atime_ns, info.st_mtime_ns + 1_000_000))
            with self.assertRaisesRegex(RuntimeError, 'source metadata'):
                produce(case)
            held(case)

    def test_cleanup_sample_identity_refuses(self):
        with prepared() as case:
            replace(case.capture / 'abort-cleanup/after/preflight.json', host_boot_session='wrong')
            with self.assertRaisesRegex(RuntimeError, 'sample differs'):
                produce(case)
            held(case)

    def test_locks_and_locked_path_mapping(self):
        import fcntl
        for name in ('CAPTURE_ACTIVE.lock', 'ARMED.json'):
            with self.subTest(name=name), prepared() as case:
                fd = os.open(case.capture / name, os.O_RDONLY)
                try:
                    fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
                    with self.assertRaisesRegex(RuntimeError, 'active|arm lock'):
                        produce(case)
                finally:
                    os.close(fd)
                held(case)
        with prepared() as case:
            produce(case)
            with abort.abort_context(case.host, case.capture, True) as (host, cap, directory_fd, locks):
                foreign = case.temp / 'foreign-lock'
                write_record(foreign, {})
                fd = os.open(foreign, os.O_RDONLY)
                try:
                    with self.assertRaisesRegex(RuntimeError, 'locked file'):
                        abort.verify_abort(host, cap, case.stopped, directory_fd, [fd, locks[1]], fixture=True)
                finally:
                    os.close(fd)

    def test_conflicting_terminal_records_refuse(self):
        for name in ('ABORT.json', 'ABORT.json.tmp', 'ACCEPTED.json', 'BOOTABLE.json', 'DECISION.json', 'prior/ABORT.json'):
            with self.subTest(name=name), prepared() as case:
                path = case.capture / name
                if path.parent != case.capture:
                    path.parent.mkdir(mode=0o700)
                write_record(path, {})
                with self.assertRaisesRegex(RuntimeError, 'terminal|release'):
                    produce(case)
                held(case, (path,))

    def test_decision_fields_and_completion_are_strict(self):
        for fault in ('decision', 'scope', 'arm_sha256', 'capture_nonce', 'journal_head', 'checkpoint_sha256',
                      'capture_sha256', 'cleanup_sha256', 'cleanup_sample_sha256', 'decision_sample_sha256', 'extra',
                      'COMPLETE', 'canonical', 'after-sample', 'before-sample', 'ACCEPTED'):
            with self.subTest(fault=fault), prepared() as case:
                produce(case)
                path = case.capture / 'ABORT.json'
                if fault == 'COMPLETE':
                    replace(case.capture / 'abort-decision/COMPLETE.json', abort_sha256='0' * 64)
                elif fault == 'canonical':
                    path.write_bytes(path.read_bytes() + b' ')
                elif fault.endswith('-sample'):
                    sample = case.capture / ('abort-decision/' + fault.split('-')[0] + '/preflight.json')
                    replace(sample, at_utc='changed-but-same-identity')
                elif fault == 'ACCEPTED':
                    write_record(case.capture / 'ACCEPTED.json', {})
                else:
                    replace(path, **{fault: 'ACCEPTED' if fault == 'decision' else 'foreign'})
                    replace(case.capture / 'abort-decision/COMPLETE.json', abort_sha256=digest(path.read_bytes()))
                with self.assertRaises(RuntimeError):
                    verify(case)
                self.assertFalse(case.flag_calls)

    def test_visible_abort_without_completion_or_with_failure_refuses(self):
        for name in ('COMPLETE.json', 'FAILED.json', 'COMPLETE.json.tmp', 'unknown'):
            with self.subTest(name=name), prepared() as case:
                produce(case)
                path = case.capture / 'abort-decision' / name
                if name == 'COMPLETE.json':
                    path.unlink()
                else:
                    write_record(path, {})
                with self.assertRaisesRegex(RuntimeError, 'failed, partial or unknown'):
                    verify(case)
                held(case)

    def test_publication_failures_keep_primary_and_hold(self):
        for filename in ('ABORT.json', 'COMPLETE.json'):
            for when in ('before', 'after'):
                with self.subTest(filename=filename, when=when), prepared() as case:
                    publish = abort.publish_abort_cleanup
                    def failed(fd, name, value):
                        if name == filename and when == 'before':
                            raise OSError('owned publication error')
                        publish(fd, name, value)
                        if name == filename and when == 'after':
                            raise OSError('owned post-rename fsync error')
                    with mock.patch.object(abort, 'publish_abort_cleanup', side_effect=failed):
                        with self.assertRaisesRegex(OSError, 'owned'):
                            produce(case)
                    self.assertTrue((case.capture / 'abort-decision/FAILED.json').exists())
                    if (case.capture / 'ABORT.json').exists():
                        with self.assertRaises(RuntimeError):
                            verify(case)
                    with self.assertRaisesRegex(RuntimeError, 'already attempted'):
                        produce(case)
                    held(case)

    def test_interrupt_after_abort_is_not_completed(self):
        with prepared() as case:
            sample = case.sample
            def interrupted(spec, output):
                if output.name == 'after':
                    raise KeyboardInterrupt('owned interrupt')
                return sample(spec, output)
            with mock.patch.object(abort, 'preflight', side_effect=interrupted), mock.patch.object(abort, 'record_failure', side_effect=abort.record_failure):
                with self.assertRaisesRegex(KeyboardInterrupt, 'owned interrupt'):
                    produce(case)
            self.assertTrue((case.capture / 'ABORT.json').exists())
            self.assertFalse((case.capture / 'abort-decision/COMPLETE.json').exists())
            with self.assertRaises(RuntimeError):
                verify(case)
            held(case)

    def test_verifier_rejects_unexpected_or_unreadable_observation(self):
        with prepared() as case:
            produce(case)
            with abort.abort_context(case.host, case.capture, True) as (host, cap, directory_fd, locks):
                for observed in (None, {}, {**case.stopped, 'state': 'started'},
                                 {**case.stopped, 'image_holders': [23]},
                                 {**case.stopped, 'host_boot_session': 'reboot'}):
                    with self.subTest(observed=observed), self.assertRaisesRegex(RuntimeError, 'sample differs'):
                        abort.verify_abort(host, cap, observed, directory_fd, locks, fixture=True)
            held(case)

    def test_fixture_identity_boundary_cannot_be_renamed_into_authority(self):
        with prepared() as case:
            replace(case.host, uuid='00000000-0000-0000-0000-000000000001')
            with self.assertRaisesRegex(RuntimeError, 'owned fixture'):
                produce(case)
            self.assertFalse((case.capture / 'abort-decision').exists())
            held(case)

    def test_failed_decision_marker_always_refuses(self):
        with prepared() as case:
            produce(case)
            write_record(case.capture / 'abort-decision/FAILED.json', {})
            with self.assertRaisesRegex(RuntimeError, 'failed, partial or unknown'):
                verify(case)
            held(case)

    def test_changed_publication_readback_never_completes(self):
        with prepared() as case:
            publish = abort.publish_abort_cleanup
            def changed(fd, name, value):
                publish(fd, name, value)
                if name == 'ABORT.json':
                    replace(case.capture / name, at_utc='changed-readback')
            with mock.patch.object(abort, 'publish_abort_cleanup', side_effect=changed):
                with self.assertRaisesRegex(RuntimeError, 'readback differs'):
                    produce(case)
            self.assertFalse((case.capture / 'abort-decision/COMPLETE.json').exists())
            held(case)

    def test_rehashed_capture_still_requires_real_guard_binding(self):
        with prepared() as case:
            replace(case.capture / 'CAPTURE.json', guard_receipt_sha256='0' * 64)
            intent_path = case.capture / 'ABORT_CLEANUP_INTENT.json'
            intent = json.loads(intent_path.read_bytes())
            intent['input_sha256']['CAPTURE.json'] = digest((case.capture / 'CAPTURE.json').read_bytes())
            intent_path.write_bytes(encoded(intent))
            replace(case.capture / 'ABORT_CLEANUP.json', intent_sha256=digest(intent_path.read_bytes()))
            with self.assertRaisesRegex(RuntimeError, 'guard differs'):
                produce(case)
            held(case)

    def test_postpublication_input_sample_or_clone_change_never_completes(self):
        for fault in ('input', 'clone', 'sample', 'conflict'):
            with self.subTest(fault=fault), prepared() as case:
                publish = abort.publish_abort_cleanup
                def changed(fd, name, value):
                    publish(fd, name, value)
                    if name != 'ABORT.json':
                        return
                    if fault == 'input':
                        case.host.write_bytes(case.host.read_bytes() + b' ')
                    elif fault == 'clone':
                        case.clone.write_bytes(b'reappeared')
                    elif fault == 'sample':
                        replace(case.capture / 'abort-cleanup/after/preflight.json', at_utc='changed')
                    else:
                        write_record(case.capture / 'ACCEPTED.json', {})
                with mock.patch.object(abort, 'publish_abort_cleanup', side_effect=changed):
                    with self.assertRaises(RuntimeError):
                        produce(case)
                self.assertFalse((case.capture / 'abort-decision/COMPLETE.json').exists())
                self.assertTrue((case.capture / 'abort-decision/FAILED.json').exists())
                self.assertFalse(case.flag_calls)


if __name__ == '__main__':
    unittest.main()
