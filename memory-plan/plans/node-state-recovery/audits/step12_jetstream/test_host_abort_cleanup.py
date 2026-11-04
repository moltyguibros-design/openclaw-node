"""Owned checkpoint producers and scripted host/flags; no VM, disk mount or native flag operation."""
import copy
import contextlib
import fcntl
import hashlib
import json
import os
import pathlib
import stat
import subprocess
import sys
import tempfile
import types
import unittest
from unittest import mock

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

import host_clone_dispose as cleanup
import host_vm_capture
import test_host_checkpoint_commit as fixture
from host_guest_commit import require_committed
from host_vm_preflight import require, write_record
from preservation_journal import ARM_SCOPE


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


class AbortCleanup(fixture.HostCheckpoint):
    def setUp(self):
        tempdir = tempfile.TemporaryDirectory
        with mock.patch.object(tempfile, 'TemporaryDirectory',
                               side_effect=lambda **kw: tempdir(**{**kw, 'prefix': 'openclaw-host-capture-'})):
            super().setUp()
        self.temp = self.temp.resolve()
        self.host = self.temp / 'host.json'
        package = self.temp / 'Owned.utm'
        package.mkdir(mode=0o700)
        (package / 'Data').mkdir(mode=0o700)
        self.source = package / 'Data/00000000-0000-0000-0000-000000000003.img'
        self.source.write_bytes(b'owned stopped source image stand-in')
        self.source.chmod(0o600)
        self.clone = self.capture / 'powered-off-image.asif'
        self.clone.write_bytes(self.source.read_bytes())
        self.clone.chmod(0o600)
        info = self.source.stat()
        host = {'package': str(package), 'name': 'Owned', 'uuid': host_vm_capture.FIXTURE_UUID,
                'image_name': self.source.name, 'config_sha256': '0' * 64,
                'utmctl': '/usr/bin/false', 'utmctl_sha256': '0' * 64}
        write_record(self.host, host)
        self.running = {**fixture.STARTED, 'scope': 'read-only host preflight; not a shutdown or cold-copy receipt',
                        'at_utc': 'owned-time', 'state_observed_at_utc': 'owned-time',
                        'package': str(package), 'config_sha256': host['config_sha256'],
                        'utmctl_sha256': host['utmctl_sha256'], 'free_bytes': 30 << 30,
                        'image': str(self.source), 'image_device': info.st_dev,
                        'image_inode': info.st_ino, 'image_size': info.st_size}
        self.rewrite('before-shutdown/preflight.json', **self.running)
        self.rewrite('ARMED.json', scope=ARM_SCOPE, capture_nonce=self.nonce,
                     vm_uuid=host['uuid'], host_boot_session='boot',
                     image_device=info.st_dev, image_inode=info.st_ino)
        self.armed = (self.capture / 'ARMED.json').read_bytes()
        with mock.patch.object(fixture, 'STARTED', self.running):
            manifest, committed, record = self.committed_flow()
        self.host_checkpoint(self.journal_file(record), sample=self.running)
        fcntl.flock(self.active, fcntl.LOCK_UN)
        self.stopped = {**self.running, 'state': 'stopped', 'image_holders': []}
        intent = {'scope': 'stopped source image guard intent; no clone or VM start',
                  'at_utc': 'owned-time', 'vm_uuid': host['uuid'], 'host_boot_session': 'boot',
                  'source_image': str(self.source), 'source_image_device': info.st_dev,
                  'source_image_inode': info.st_ino, 'source_image_size': info.st_size}
        write_record(self.capture / 'GUARD_INTENT.json', intent)
        write_record(self.capture / 'GUARD.json', {
            **intent, 'scope': 'stopped source image guarded; no clone or VM start',
            'guarded_at_utc': 'owned-time'})
        (self.capture / 'after-guard').mkdir(mode=0o700)
        write_record(self.capture / 'after-guard/preflight.json', self.stopped)
        capture = {**fixture.UNREAD, 'vm_uuid': host['uuid'], 'host_boot_session': 'boot',
                   'source_image_sha256': sha(self.source.read_bytes()),
                   'clone_image_sha256': sha(self.clone.read_bytes()),
                   'source_size': info.st_size, 'clone_size': info.st_size,
                   'guard_receipt_sha256': sha((self.capture / 'GUARD.json').read_bytes()),
                   'vmstate_at_arm': None, 'vmstate_at_final_check': None,
                   'data_volume_uuid': committed['manifest']['data_volume_uuid'],
                   'store_spec_sha256': committed['manifest']['spec_sha256'],
                   'store_relative_paths': committed['manifest']['store_relative_paths'],
                   'store_roles': sorted(committed['manifest']['stores'])}
        host_vm_capture.publish_pinned_capture(self.capture, capture,
                                               require_committed(self.capture)['checkpoint'], window_pins_source=self.capture / 'WINDOW_PINS.json')
        self.flags = {self.source: stat.UF_IMMUTABLE, self.clone: 0}
        real_lstat = pathlib.Path.lstat

        def flagged(path, *args, **kwargs):
            value = real_lstat(path, *args, **kwargs)
            if path not in self.flags:
                return value
            return types.SimpleNamespace(**{key: getattr(value, key) for key in dir(value)
                                             if key.startswith('st_') and key != 'st_flags'},
                                         st_flags=self.flags[path])

        self.patch(pathlib.Path, 'lstat', side_effect=flagged, autospec=True)
        self.patch(cleanup, 'preflight', side_effect=self.sample)
        self.patch(cleanup, 'unattached_clone', side_effect=self.unattached)
        self.patch(cleanup, 'no_disk_attachment', side_effect=self.unattached)
        self.flag_calls = []
        self.patch(cleanup, 'change_immutable', side_effect=self.change_flag)
        self.output = self.capture / 'abort-cleanup'
        self.events = []

    def patch(self, target, name, **options):
        patched = mock.patch.object(target, name, **options)
        value = patched.start()
        self.addCleanup(patched.stop)
        return value

    def sample(self, spec, output):
        self.events.append('sample')
        output.mkdir(mode=0o700)
        write_record(output / 'preflight.json', self.stopped)
        return copy.deepcopy(self.stopped)

    def unattached(self, path, *_):
        self.assertEqual(path, self.clone)
        self.events.append('unattached')

    def change_flag(self, path, identity, present):
        self.assertEqual(path, self.clone, 'cleanup may never change the source flag')
        self.assertEqual(identity, (path.stat().st_dev, path.stat().st_ino, path.stat().st_size))
        self.assertFalse(present)
        self.assertTrue((self.capture / 'ABORT_CLEANUP_INTENT.json').exists(), 'durable intent precedes flag change')
        self.flag_calls.append((path, present))
        self.flags[path] &= ~stat.UF_IMMUTABLE

    def run_cleanup(self):
        return cleanup.abort_cleanup(self.host, self.capture, 'discard owned capture', fixture=True)

    def assert_held(self, source_bytes=b'owned stopped source image stand-in', terminals=None):
        self.assertEqual(self.flags[self.source], stat.UF_IMMUTABLE)
        self.assertEqual(self.source.read_bytes(), source_bytes)
        for name in ('ABORT.json', 'ACCEPTED.json', 'BOOTABLE.json', 'DECISION.json'):
            self.assertEqual(list(self.capture.rglob(name)), (terminals or {}).get(name, []))

    def test_complete_cleanup_pins_intent_and_keeps_source_guarded(self):
        original = {name: (self.capture / name).read_bytes() for name in cleanup.ABORT_INPUTS}
        result = self.run_cleanup()
        self.assertEqual(json.loads((self.capture / 'ABORT_CLEANUP.json').read_bytes()), result)
        intent = json.loads((self.capture / 'ABORT_CLEANUP_INTENT.json').read_bytes())
        self.assertEqual(result['intent_sha256'], sha((self.capture / 'ABORT_CLEANUP_INTENT.json').read_bytes()))
        self.assertEqual(intent['capture_nonce'], self.nonce)
        self.assertEqual(intent['checkpoint_sha256'], require_committed(self.capture)['checkpoint']['checkpoint_sha256'])
        self.assertEqual(intent['input_sha256'], {**{name: sha(raw) for name, raw in original.items()},
                                                  'host_spec': sha(self.host.read_bytes())})
        self.assertEqual(result['scope'], cleanup.ABORT_CLEANUP_SCOPE)
        self.assertTrue(result['clone_absent'])
        self.assertFalse(self.clone.exists())
        self.assertEqual(self.flag_calls, [])
        self.assertEqual(original, {name: (self.capture / name).read_bytes() for name in original})
        self.assertEqual(len([item for item in self.events if item == 'sample']), 3)
        self.assert_held()
        with self.assertRaisesRegex(RuntimeError, 'already attempted'):
            self.run_cleanup()


@contextlib.contextmanager
def owned():
    case = AbortCleanup('test_complete_cleanup_pins_intent_and_keeps_source_guarded')
    try:
        case.setUp()
        yield case
    finally:
        case.doCleanups()


def refusal(case, message):
    source_bytes = case.source.read_bytes()
    terminals = {name: list(case.capture.rglob(name)) for name in cleanup.TERMINALS}
    with case.assertRaisesRegex((RuntimeError, FileNotFoundError), message):
        case.run_cleanup()
    case.assertTrue(case.clone.exists())
    case.assertFalse((case.capture / 'ABORT_CLEANUP.json').exists())
    case.assertFalse(case.flag_calls)
    case.assert_held(source_bytes, terminals)


class Refusals(unittest.TestCase):
    def test_production_refuses_before_any_observation(self):
        with mock.patch.object(cleanup, 'owned_directory') as directory, \
                mock.patch.object(cleanup, 'pinned_spec') as spec, \
                mock.patch.object(cleanup, 'capture_locks') as locks, \
                mock.patch.object(cleanup, 'preflight') as sample, \
                mock.patch.object(cleanup, 'change_immutable') as flags, \
                mock.patch.object(cleanup.os, 'umask') as mask:
            with self.assertRaisesRegex(RuntimeError, 'production abort cleanup requires'):
                cleanup.abort_cleanup('/unread/spec', '/unread/capture', 'owned reason')
        for call in (directory, spec, locks, sample, flags, mask):
            call.assert_not_called()

    def test_viable_production_call_still_refuses(self):
        with owned() as case:
            with self.assertRaisesRegex(RuntimeError, 'production abort cleanup requires'):
                cleanup.abort_cleanup(case.host, case.capture, 'discard', fixture=False)
            self.assertTrue(case.clone.exists())
            self.assertFalse(case.output.exists())
            case.assert_held()

    def test_fixture_identity_reason_and_host_schema(self):
        for fault, message in [('uuid', 'fixture VM package'), ('package', 'fixture VM package'),
                               ('extra', 'specification shape differs'), ('reason', 'explicit reason')]:
            with self.subTest(fault=fault), owned() as case:
                host = json.loads(case.host.read_bytes())
                if fault == 'uuid':
                    host['uuid'] = '10000000-0000-0000-0000-000000000002'
                elif fault == 'package':
                    host['package'] = '/unowned/Other.utm'
                elif fault == 'extra':
                    host['extra'] = True
                case.host.unlink()
                write_record(case.host, host)
                with self.assertRaisesRegex(RuntimeError, message):
                    cleanup.abort_cleanup(case.host, case.capture,
                                          ' ' if fault == 'reason' else 'discard', fixture=True)
                self.assertFalse(case.output.exists())
                case.assert_held()

    def test_missing_or_mutated_pins(self):
        for name in ('ARMED.json', 'COMMITTED.json', 'ACKED.json', 'CHECKPOINT.json', 'CAPTURE.json',
                     'GUARD.json', 'GUARD_INTENT.json', 'after-guard/preflight.json'):
            with self.subTest(name=name), owned() as case:
                (case.capture / name).unlink()
                refusal(case, 'missing|No such file')
        for name in ('COMMITTED.json', 'ACKED.json', 'CHECKPOINT.json'):
            with self.subTest(mutated=name), owned() as case:
                (case.capture / name).write_bytes((case.capture / name).read_bytes() + b' ')
                refusal(case, 'differs|not committed|not captured|pin')

    def test_wrong_arm_scope_refuses_even_when_all_later_pins_are_consistent(self):
        with owned() as case:
            case.rewrite('ARMED.json', scope='other operation')
            case.rewrite('COMMITTED.json', arm_sha256=sha((case.capture / 'ARMED.json').read_bytes()))
            case.rewrite('ACKED.json', commit_sha256=sha((case.capture / 'COMMITTED.json').read_bytes()))
            case.rewrite('CHECKPOINT.json', commit_sha256=sha((case.capture / 'COMMITTED.json').read_bytes()),
                         ack_sha256=sha((case.capture / 'ACKED.json').read_bytes()))
            case.repin()
            refusal(case, 'differs from the pinned checkpoint')

    def test_capture_and_original_identity_bindings(self):
        changes = [('host_boot_session', 'other'), ('source_size', 999),
                   ('vmstate_at_final_check', {'unexpected': True}), ('source_image_sha256', 'f' * 64),
                   ('data_volume_uuid', 'OTHER'), ('store_roles', ['standalone']),
                   ('store_spec_sha256', 'f' * 64), ('store_relative_paths', {}),
                   ('guard_receipt_sha256', 'f' * 64), ('vm_uuid', 'OTHER')]
        for key, value in changes:
            with self.subTest(key=key), owned() as case:
                case.rewrite('CAPTURE.json', **{key: value})
                refusal(case, 'differs|not of the owned fixture')

    def test_fresh_host_sample_and_guard_refusals(self):
        changes = [('state', 'started'), ('image_holders', [42]), ('holders_consistent', False),
                   ('host_boot_session', 'reboot'), ('image_device', -1), ('image_inode', -1),
                   ('image_size', -1), ('vm_uuid', 'OTHER'), ('vmstate', {'unexpected': True}),
                   ('image', '/unowned/image'), ('config_sha256', 'f' * 64),
                   ('utmctl_sha256', 'f' * 64), ('package', '/unowned/Other.utm')]
        for key, value in changes:
            with self.subTest(key=key), owned() as case:
                case.stopped[key] = value
                refusal(case, 'binding differs|guard or stopped source identity differs')
        with owned() as case:
            case.flags[case.source] = 0
            with self.assertRaisesRegex(RuntimeError, 'guard or stopped source identity differs'):
                case.run_cleanup()
            self.assertTrue(case.clone.exists())
            self.assertFalse(case.flag_calls)
            self.assertFalse((case.capture / 'ABORT_CLEANUP.json').exists())

    def test_changed_source_or_clone_bytes(self):
        for role in ('source', 'clone'):
            with self.subTest(role=role), owned() as case:
                getattr(case, role).write_bytes(b'X' * len(case.source.read_bytes()))
                refusal(case, 'clone hash differs')

    def test_competing_worker_or_arm_lock(self):
        for name in ('CAPTURE_ACTIVE.lock', 'ARMED.json'):
            with self.subTest(lock=name), owned() as case:
                fd = os.open(case.capture / name, os.O_RDONLY)
                try:
                    fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
                    refusal(case, 'still active|arm lock')
                finally:
                    os.close(fd)
                self.assertFalse(case.output.exists())

    def test_locked_arm_path_replacement_is_refused(self):
        with owned() as case:
            real = cleanup.capture_locks

            def swapped(path, **options):
                locks = real(path, **options)
                case.rewrite('ARMED.json')
                return locks

            with mock.patch.object(cleanup, 'capture_locks', side_effect=swapped):
                refusal(case, 'no longer names the locked file')

    def test_attachment_or_inventory_failure(self):
        for error in (RuntimeError('clone is attached'), subprocess.TimeoutExpired('inventory', 15)):
            with self.subTest(error=type(error).__name__), owned() as case:
                with mock.patch.object(cleanup, 'unattached_clone', side_effect=error):
                    with self.assertRaises(type(error)):
                        case.run_cleanup()
                self.assertTrue(case.clone.exists())
                self.assertFalse(case.flag_calls)
                self.assertFalse((case.capture / 'ABORT_CLEANUP.json').exists())
                case.assert_held()

    def test_other_capture_and_boot_record_refuse(self):
        for marker in ('powered-off-image.asif', 'BOOTABLE.json', 'ABORT.json'):
            with self.subTest(marker=marker), owned() as case:
                parent = case.temp / 'other-capture' if marker in ('CAPTURE.json', 'powered-off-image.asif') else case.capture / 'prior'
                parent.mkdir(mode=0o700)
                write_record(parent / marker, {})
                refusal(case, 'another temporary image|boot decision or release record')

    def test_inputs_and_source_changed_after_intent_refuse(self):
        for fault in ('spec', 'arm', 'checkpoint', 'source', 'guard'):
            with self.subTest(fault=fault), owned() as case:
                publish = cleanup.publish_abort_cleanup

                def changed(output, name, value):
                    publish(output, name, value)
                    if name != 'ABORT_CLEANUP_INTENT.json':
                        return
                    if fault == 'spec':
                        case.host.write_bytes(case.host.read_bytes() + b' ')
                    elif fault == 'arm':
                        case.rewrite('ARMED.json')
                    elif fault == 'checkpoint':
                        (case.capture / 'CHECKPOINT.json').write_bytes(b'{}')
                    elif fault == 'source':
                        case.source.write_bytes(b'X' * len(case.source.read_bytes()))
                    elif fault == 'guard':
                        case.rewrite('GUARD.json', guarded_at_utc='changed')

                with mock.patch.object(cleanup, 'publish_abort_cleanup', side_effect=changed):
                    with self.assertRaisesRegex(RuntimeError, 'changed|differs|hash|no longer names'):
                        case.run_cleanup()
                self.assertTrue(case.clone.exists())
                self.assertFalse(case.flag_calls)
                self.assertFalse((case.capture / 'ABORT_CLEANUP.json').exists())
                self.assertTrue((case.output / 'FAILED.json').exists())

    def test_failed_intent_publication_never_changes_flags(self):
        with owned() as case:
            publish = cleanup.publish_abort_cleanup

            def failed(directory_fd, name, value):
                if name == 'ABORT_CLEANUP_INTENT.json':
                    raise OSError('intent disk full')
                publish(directory_fd, name, value)

            with mock.patch.object(cleanup, 'publish_abort_cleanup', side_effect=failed):
                with self.assertRaisesRegex(OSError, 'intent disk full'):
                    case.run_cleanup()
            self.assertFalse(case.flag_calls)
            self.assertTrue(case.clone.exists())
            self.assertFalse((case.capture / 'ABORT_CLEANUP.json').exists())
            case.assert_held()

    def test_immutable_clone_refuses_without_flag_operation(self):
        with owned() as case:
            case.flags[case.clone] = stat.UF_IMMUTABLE
            refusal(case, 'clone is immutable')

    def test_interrupt_before_unlink_retains_intent_and_refuses_retry(self):
        with owned() as case:
            real_unlink = os.unlink

            def interrupted(path, **options):
                if path == case.clone.name:
                    raise KeyboardInterrupt('owned unlink interrupt')
                return real_unlink(path, **options)

            with mock.patch.object(cleanup.os, 'unlink', side_effect=interrupted):
                with self.assertRaisesRegex(KeyboardInterrupt, 'owned unlink interrupt'):
                    case.run_cleanup()
            self.assertTrue(case.clone.exists())
            self.assertTrue((case.capture / 'ABORT_CLEANUP_INTENT.json').exists())
            self.assertTrue((case.output / 'FAILED.json').exists())
            self.assertFalse((case.capture / 'ABORT_CLEANUP.json').exists())
            with self.assertRaisesRegex(RuntimeError, 'already attempted'):
                case.run_cleanup()
            self.assertEqual(case.flag_calls, [])
            case.assert_held()

    def test_post_unlink_sample_failure_retains_intent_no_cleanup(self):
        with owned() as case:
            def failed(spec, output):
                if output.name == 'after':
                    raise RuntimeError('final stopped sample unreadable')
                return case.sample(spec, output)

            with mock.patch.object(cleanup, 'preflight', side_effect=failed):
                with self.assertRaisesRegex(RuntimeError, 'final stopped sample unreadable'):
                    case.run_cleanup()
            self.assertFalse(case.clone.exists())
            self.assertTrue((case.capture / 'ABORT_CLEANUP_INTENT.json').exists())
            self.assertTrue((case.output / 'FAILED.json').exists())
            self.assertFalse((case.capture / 'ABORT_CLEANUP.json').exists())
            with self.assertRaisesRegex(RuntimeError, 'already attempted'):
                case.run_cleanup()
            case.assert_held()

    def test_final_inventory_failure_never_publishes_cleanup(self):
        with owned() as case, mock.patch.object(cleanup, 'no_disk_attachment', side_effect=RuntimeError('inventory unreadable')):
            with self.assertRaisesRegex(RuntimeError, 'inventory unreadable'):
                case.run_cleanup()
            self.assertFalse(case.clone.exists())
            self.assertFalse((case.capture / 'ABORT_CLEANUP.json').exists())
            case.assert_held()

    def test_cleanup_publication_failure_keeps_intent_and_primary(self):
        with owned() as case:
            publish = cleanup.publish_abort_cleanup

            def failed(output, name, value):
                if name == 'ABORT_CLEANUP.json':
                    raise OSError('cleanup disk full')
                publish(output, name, value)

            with mock.patch.object(cleanup, 'publish_abort_cleanup', side_effect=failed):
                with self.assertRaisesRegex(OSError, 'cleanup disk full'):
                    case.run_cleanup()
            self.assertFalse(case.clone.exists())
            self.assertFalse((case.capture / 'ABORT_CLEANUP.json').exists())
            self.assertTrue((case.capture / 'ABORT_CLEANUP_INTENT.json').exists())
            self.assertIn('cleanup disk full', (case.output / 'FAILED.json').read_text())
            case.assert_held()

    def test_interrupt_and_failed_error_report_keep_primary(self):
        for primary in (KeyboardInterrupt('owned interrupt'), RuntimeError('primary observation')):
            with self.subTest(primary=type(primary).__name__), owned() as case:
                with mock.patch.object(cleanup, 'preflight', side_effect=primary), \
                        mock.patch('host_journal_mount.write_record', side_effect=OSError('error report failed')):
                    with self.assertRaisesRegex(type(primary), str(primary)):
                        case.run_cleanup()
                self.assertFalse((case.capture / 'ABORT_CLEANUP.json').exists())
                self.assertTrue(case.clone.exists())
                case.assert_held()


    def test_prior_capture_without_clone_is_allowed_and_evidence_is_pinned(self):
        with owned() as case:
            sibling = case.temp / 'previous-capture'
            sibling.mkdir(mode=0o700)
            write_record(sibling / 'CAPTURE.json', {'uninterpreted': 'prior evidence'})
            for directory, name in [('match', 'MATCH.json'), ('journal-read', 'JOURNAL_INPUTS.json')]:
                (case.capture / directory).mkdir(mode=0o700)
                write_record(case.capture / directory / name, {'uninterpreted': 'owned evidence'})
            case.run_cleanup()
            intent = json.loads((case.capture / 'ABORT_CLEANUP_INTENT.json').read_bytes())
            for path in ('match/MATCH.json', 'journal-read/JOURNAL_INPUTS.json'):
                self.assertEqual(intent['input_sha256'][path], sha((case.capture / path).read_bytes()))
            self.assertTrue((sibling / 'CAPTURE.json').exists())
            case.assert_held()

    def test_existing_partial_markers_refuse_even_without_diagnostic_directory(self):
        for name in ('ABORT_CLEANUP_INTENT.json', 'ABORT_CLEANUP_INTENT.json.tmp',
                     'ABORT_CLEANUP.json', 'ABORT_CLEANUP.json.tmp'):
            with self.subTest(marker=name), owned() as case:
                write_record(case.capture / name, {})
                with self.assertRaisesRegex(RuntimeError, 'already attempted'):
                    case.run_cleanup()
                self.assertTrue(case.clone.exists())
                self.assertEqual(case.flag_calls, [])
                self.assertFalse(case.output.exists())

    def test_swapped_unlink_entry_cannot_publish_cleanup_for_retained_original(self):
        with owned() as case:
            real_unlink = os.unlink
            retained = case.capture / 'retained-original.asif'

            def swapped(path, **options):
                if path == case.clone.name:
                    case.clone.rename(retained)
                    case.clone.write_bytes(b'foreign owned fixture file')
                    case.clone.chmod(0o600)
                return real_unlink(path, **options)

            with mock.patch.object(cleanup.os, 'unlink', side_effect=swapped):
                with self.assertRaisesRegex(RuntimeError, 'final source, input or clone absence differs'):
                    case.run_cleanup()
            self.assertTrue(retained.exists())
            self.assertFalse(case.clone.exists())
            self.assertFalse((case.capture / 'ABORT_CLEANUP.json').exists())
            self.assertTrue((case.output / 'FAILED.json').exists())
            case.assert_held()

    def test_changed_consumed_capture_commitment_refuses(self):
        for fault in ('capture', 'checkpoint'):
            with self.subTest(fault=fault), owned() as case:
                real = cleanup.capture_inputs

                def changed(path):
                    inputs = real(path)
                    if fault == 'capture':
                        inputs['capture_sha256'] = 'f' * 64
                    else:
                        inputs['commitment']['checkpoint']['checkpoint_sha256'] = 'f' * 64
                    return inputs

                with mock.patch.object(cleanup, 'capture_inputs', side_effect=changed):
                    refusal(case, 'differs from the pinned checkpoint')

    def test_post_unlink_source_guard_loss_refuses_without_repairing_it(self):
        with owned() as case:
            def changed(spec, output):
                if output.name == 'after':
                    case.flags[case.source] = 0
                return case.sample(spec, output)

            with mock.patch.object(cleanup, 'preflight', side_effect=changed):
                with self.assertRaisesRegex(RuntimeError, 'guard or stopped source identity differs'):
                    case.run_cleanup()
            self.assertFalse(case.clone.exists())
            self.assertFalse((case.capture / 'ABORT_CLEANUP.json').exists())
            self.assertEqual(case.flag_calls, [])
            self.assertEqual(case.flags[case.source], 0)

    def test_changed_evidence_at_final_inventory_refuses(self):
        with owned() as case:
            (case.capture / 'match').mkdir(mode=0o700)
            write_record(case.capture / 'match/MATCH.json', {'uninterpreted': True})

            def changed(path):
                (case.capture / 'match/MATCH.json').write_bytes(b'changed')

            with mock.patch.object(cleanup, 'no_disk_attachment', side_effect=changed):
                with self.assertRaisesRegex(RuntimeError, 'final source, input or clone absence differs'):
                    case.run_cleanup()
            self.assertFalse((case.capture / 'ABORT_CLEANUP.json').exists())
            case.assert_held()

    def test_rename_then_fsync_failure_is_manual_even_with_visible_receipt(self):
        for name in ('ABORT_CLEANUP_INTENT.json', 'ABORT_CLEANUP.json'):
            with self.subTest(name=name), owned() as case:
                sync = os.fsync

                def failed(fd):
                    if (case.capture / name).exists():
                        raise OSError('post-rename sync failure')
                    sync(fd)

                with mock.patch.object(cleanup.os, 'fsync', side_effect=failed):
                    with self.assertRaisesRegex(OSError, 'post-rename sync failure'):
                        case.run_cleanup()
                self.assertTrue((case.capture / name).exists())
                self.assertTrue((case.output / 'FAILED.json').exists())
                self.assertEqual(case.clone.exists(), name == 'ABORT_CLEANUP_INTENT.json')
                with self.assertRaisesRegex(RuntimeError, 'already attempted'):
                    case.run_cleanup()
                case.assert_held()


    def test_post_unlink_terminal_or_sibling_appearance_refuses(self):
        for fault in ('terminal', 'sibling'):
            with self.subTest(fault=fault), owned() as case:
                def appeared(path):
                    if fault == 'terminal':
                        write_record(case.capture / 'ABORT.json', {'untrusted': True})
                    else:
                        sibling = case.temp / 'late-capture'
                        sibling.mkdir(mode=0o700)
                        write_record(sibling / 'powered-off-image.asif', {})

                with mock.patch.object(cleanup, 'no_disk_attachment', side_effect=appeared):
                    with self.assertRaisesRegex(RuntimeError, 'boot decision|another temporary image'):
                        case.run_cleanup()
                self.assertFalse((case.capture / 'ABORT_CLEANUP.json').exists())
                self.assertFalse(case.clone.exists())
                self.assertEqual(case.flag_calls, [])
                self.assertEqual(case.flags[case.source], stat.UF_IMMUTABLE)

    def test_changed_intent_readback_refuses_before_unlink(self):
        with owned() as case:
            publish = cleanup.publish_abort_cleanup

            def rewritten(directory_fd, name, value):
                publish(directory_fd, name, value)
                if name == 'ABORT_CLEANUP_INTENT.json':
                    raw = json.loads((case.capture / name).read_bytes())
                    raw['reason'] = 'rewritten intent'
                    (case.capture / name).write_text(json.dumps(raw))

            with mock.patch.object(cleanup, 'publish_abort_cleanup', side_effect=rewritten):
                with self.assertRaisesRegex(RuntimeError, 'intent publication differs'):
                    case.run_cleanup()
            self.assertTrue(case.clone.exists())
            self.assertFalse((case.capture / 'ABORT_CLEANUP.json').exists())
            case.assert_held()

    def test_changed_final_intent_refuses_receipt(self):
        with owned() as case:
            def rewritten(path):
                intent = case.capture / 'ABORT_CLEANUP_INTENT.json'
                raw = json.loads(intent.read_bytes())
                raw['reason'] = 'rewritten after unlink'
                intent.write_text(json.dumps(raw))

            with mock.patch.object(cleanup, 'no_disk_attachment', side_effect=rewritten):
                with self.assertRaisesRegex(RuntimeError, 'final source, input or clone absence differs'):
                    case.run_cleanup()
            self.assertFalse(case.clone.exists())
            self.assertFalse((case.capture / 'ABORT_CLEANUP.json').exists())
            case.assert_held()

    def test_swap_before_named_check_refuses_without_unlinking_either_file(self):
        with owned() as case:
            identity = cleanup.clone_identity
            clone_checks = 0
            retained = case.capture / 'retained-before-unlink.asif'

            def swapped(path, capture, **options):
                nonlocal clone_checks
                value = identity(path, capture, **options)
                if path == case.clone:
                    clone_checks += 1
                    if clone_checks == 3:
                        case.clone.rename(retained)
                        case.clone.write_bytes(b'foreign owned file before named check')
                        case.clone.chmod(0o600)
                return value

            with mock.patch.object(cleanup, 'clone_identity', side_effect=swapped):
                with self.assertRaisesRegex(RuntimeError, 'clone or capture path changed before unlink'):
                    case.run_cleanup()
            self.assertEqual(clone_checks, 3)
            self.assertTrue(case.clone.exists())
            self.assertTrue(retained.exists())
            self.assertFalse((case.capture / 'ABORT_CLEANUP.json').exists())
            case.assert_held()



class HolderObservation(unittest.TestCase):
    def test_exact_retained_readonly_fd_and_no_attachment(self):
        with tempfile.TemporaryDirectory(prefix='openclaw-abort-holder-') as root:
            clone = pathlib.Path(root).resolve() / 'owned-file'
            clone.write_bytes(b'owned')
            fd = os.open(clone, os.O_RDONLY)
            try:
                output = f'p{os.getpid()}\nf{fd}\nar\nn{clone}\n'.encode()
                for fault in ('intact', 'other-pid', 'other-fd', 'extra-own-fd', 'writable', 'unreadable', 'empty'):
                    raw, code, stderr = output, 0, b''
                    if fault == 'other-pid':
                        raw = output.replace(f'p{os.getpid()}'.encode(), b'p9999999')
                    elif fault == 'other-fd':
                        raw = output.replace(f'f{fd}'.encode(), b'f99999')
                    elif fault == 'extra-own-fd':
                        raw += f'f99999\naw\nn{clone}\n'.encode()
                    elif fault == 'writable':
                        raw = output.replace(b'ar\n', b'aw\n')
                    elif fault == 'unreadable':
                        stderr = b'observation failed'
                    elif fault == 'empty':
                        raw, code = b'', 1
                    with self.subTest(fault=fault), \
                            mock.patch.object(cleanup.subprocess, 'run', return_value=types.SimpleNamespace(
                                returncode=code, stdout=raw, stderr=stderr)) as run, \
                            mock.patch.object(cleanup, 'no_disk_attachment') as attachment:
                        if fault == 'intact':
                            cleanup.unattached_clone(clone, fd)
                            attachment.assert_called_once_with(clone)
                        else:
                            with self.assertRaisesRegex(RuntimeError, 'holder observation differs'):
                                cleanup.unattached_clone(clone, fd)
                            attachment.assert_not_called()
                        run.assert_called_once_with(['/usr/sbin/lsof', '-Fpfan', '--', str(clone)],
                                                    capture_output=True, timeout=15)
            finally:
                os.close(fd)

    def test_retained_writable_descriptor_refuses_before_observation(self):
        with tempfile.TemporaryDirectory(prefix='openclaw-abort-holder-') as root:
            clone = pathlib.Path(root).resolve() / 'owned-file'
            clone.write_bytes(b'owned')
            fd = os.open(clone, os.O_RDWR)
            try:
                with mock.patch.object(cleanup.subprocess, 'run') as observed:
                    with self.assertRaisesRegex(RuntimeError, 'descriptor is not read-only'):
                        cleanup.unattached_clone(clone, fd)
                    observed.assert_not_called()
            finally:
                os.close(fd)

    @unittest.skipUnless(sys.platform == 'darwin', 'native lsof observation requires macOS')
    def test_native_lsof_observes_exact_fd_and_refuses_second_own_fd(self):
        with tempfile.TemporaryDirectory(prefix='openclaw-abort-holder-') as root:
            clone = pathlib.Path(root).resolve() / 'owned-file'
            clone.write_bytes(b'owned native lsof observation')
            fd = os.open(clone, os.O_RDONLY)
            try:
                with mock.patch.object(cleanup, 'no_disk_attachment') as attachment:
                    cleanup.unattached_clone(clone, fd)
                    attachment.assert_called_once_with(clone)
                    second = os.open(clone, os.O_RDWR)
                    try:
                        with self.assertRaisesRegex(RuntimeError, 'holder observation differs'):
                            cleanup.unattached_clone(clone, fd)
                    finally:
                        os.close(second)
            finally:
                os.close(fd)


if __name__ == '__main__':
    unittest.main()
