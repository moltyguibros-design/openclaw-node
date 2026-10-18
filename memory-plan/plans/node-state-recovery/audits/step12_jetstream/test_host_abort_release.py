"""Real owned receipt producers and file flushes; VM observations and flag changes are scripted."""
import contextlib
import copy
import fcntl
import hashlib
import json
import os
import pathlib
import stat
import subprocess
import sys
import types
import unittest
from unittest import mock

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import host_vm_reconcile as release
import host_clone_dispose as abort
from host_guest_commit import encoded
from host_vm_preflight import write_record
from test_host_terminal_abort import prepared, produce, replace


@contextlib.contextmanager
def ready():
    with prepared() as case:
        produce(case)
        case.release_output = case.capture / 'abort-release'
        case.release_calls = []
        case.ctime_advance = 0
        original_lstat = pathlib.Path.lstat.side_effect

        def lstat(path, *args, **kwargs):
            info = original_lstat(path, *args, **kwargs)
            if path != case.source:
                return info
            values = {key: getattr(info, key) for key in dir(info) if key.startswith('st_')}
            values['st_ctime_ns'] += case.ctime_advance
            return types.SimpleNamespace(**values)

        pathlib.Path.lstat.side_effect = lstat
        case.patch(release, 'preflight', side_effect=case.sample)
        case.patch(release, 'no_disk_attachment', side_effect=case.unattached)

        def clear(path, identity, present):
            case.assertEqual(path, case.source, 'release may only change the recorded source')
            case.assertEqual(identity, (case.source.stat().st_dev, case.source.stat().st_ino, case.source.stat().st_size))
            case.assertFalse(present, 'release must never re-guard')
            case.assertEqual(case.release_calls, [], 'release has exactly one flag attempt')
            case.assertTrue((case.release_output / 'INTENT.json').exists(), 'INTENT must precede the flag call')
            case.assertFalse((case.release_output / 'COMPLETE.json').exists(), 'COMPLETE must follow post-release checks')
            case.release_calls.append((path, identity, present))
            case.flags[path] &= ~stat.UF_IMMUTABLE
            case.ctime_advance = 17

        case.clear = clear
        case.patch(release, 'change_immutable', side_effect=clear)
        yield case


def run(case, fixture=True):
    return release.release_aborted(case.host, case.capture, fixture=fixture)


def verify(case):
    with abort.abort_context(case.host, case.capture, True) as (host, capture, directory_fd, locks):
        return release.verify_release(host, capture, copy.deepcopy(case.stopped), directory_fd, locks, fixture=True)


def unattempted(case):
    case.assertEqual(case.release_calls, [], 'no flag call before the durable prerequisites')
    case.assertEqual(case.flags[case.source], stat.UF_IMMUTABLE)
    case.assertFalse((case.release_output / 'COMPLETE.json').exists())


def manual(case):
    case.assertEqual(len(case.release_calls), 1, 'no automatic re-guard or retry')
    case.assertEqual(case.flags[case.source], 0, 'the failure path must not re-guard')
    case.assertFalse((case.release_output / 'COMPLETE.json').exists())
    failure = json.loads((case.release_output / 'FAILED.json').read_bytes())
    case.assertEqual(failure['cleanup'], {'manual_required': True, 'source_flag_state': 'uncertain'})
    with case.assertRaisesRegex(RuntimeError, 'already attempted'):
        run(case)


class AbortRelease(unittest.TestCase):
    def test_real_chain_release_and_readonly_verifier(self):
        with ready() as case:
            original = case.source.read_bytes()
            result = run(case)
            self.assertEqual(result, verify(case))
            intent = json.loads(result['intent'])
            complete = json.loads(result['complete'])
            self.assertEqual(set(intent), release.RELEASE_INTENT_KEYS)
            self.assertEqual(set(complete), release.RELEASE_COMPLETE_KEYS)
            self.assertEqual(complete['intent_sha256'], hashlib.sha256(result['intent']).hexdigest())
            self.assertEqual(complete['abort_sha256'], intent['abort_sha256'])
            self.assertEqual(complete['source']['ctime_ns'], intent['source']['ctime_ns'] + 17)
            self.assertEqual(complete['source']['flags'], 0)
            self.assertEqual(case.source.read_bytes(), original)
            self.assertEqual(len(case.release_calls), 1)
            self.assertEqual(list(case.capture.rglob('BOOTABLE.json')), [])
            self.assertEqual(list(case.capture.rglob('ACCEPTED.json')), [])
            with abort.abort_context(case.host, case.capture, True) as (host, capture, directory_fd, locks):
                before = {str(p): p.read_bytes() for p in capture.rglob('*') if p.is_file()}
                with mock.patch.object(release, 'preflight', side_effect=AssertionError('verifier must not observe/write')), \
                     mock.patch.object(release, 'full_sync', side_effect=AssertionError('verifier must not sync')), \
                     mock.patch.object(release, 'publish_release', side_effect=AssertionError('verifier must not publish')), \
                     mock.patch.object(release, 'change_immutable', side_effect=AssertionError('verifier must not mutate')):
                    self.assertEqual(release.verify_release(host, capture, case.stopped, directory_fd, locks, fixture=True), result)
                self.assertEqual(before, {str(p): p.read_bytes() for p in capture.rglob('*') if p.is_file()})
            with self.assertRaisesRegex(RuntimeError, 'already attempted'):
                run(case)

    def test_production_fence_precedes_every_observation(self):
        with mock.patch.object(release.pathlib, 'Path', side_effect=AssertionError('path observed')):
            for call in (lambda: release.release_aborted('/absent', '/absent'),
                         lambda: release.verify_release('/absent', '/absent', {}, -1, [])):
                with self.assertRaisesRegex(RuntimeError, 'production source release'):
                    call()

    def test_viable_production_refusal(self):
        with ready() as case:
            with self.assertRaisesRegex(RuntimeError, 'production source release'):
                run(case, fixture=False)
            self.assertFalse(case.release_output.exists())
            unattempted(case)

    def test_fixture_boundary(self):
        with ready() as case:
            replace(case.host, uuid='10000000-0000-0000-0000-000000000002')
            with self.assertRaisesRegex(RuntimeError, 'owned fixture'):
                run(case)
            self.assertFalse(case.release_output.exists())
            unattempted(case)

    def test_existing_attempt_always_refuses(self):
        for name in ('empty', 'FAILED.json', 'INTENT.json', 'COMPLETE.json'):
            with self.subTest(name=name), ready() as case:
                case.release_output.mkdir(mode=0o700)
                if name != 'empty':
                    write_record(case.release_output / name, {})
                with self.assertRaisesRegex(RuntimeError, 'already attempted'):
                    run(case)
                self.assertEqual(case.release_calls, [])
                self.assertEqual(case.flags[case.source], stat.UF_IMMUTABLE)

    def test_reserved_attempt_name(self):
        with ready() as case:
            with self.assertRaisesRegex(RuntimeError, 'reserved attempt'):
                abort.verify_abort_command(case.host, case.capture, case.release_output, fixture=True)
            self.assertFalse(case.release_output.exists())

    def test_barrier_failure_has_no_intent_or_flag(self):
        with ready() as case:
            durable = release.durable_evidence
            def failed(evidence):
                if case.capture / 'ABORT.json' in evidence:
                    raise OSError('flush failed')
                return durable(evidence)
            with mock.patch.object(release, 'durable_evidence', side_effect=failed):
                with self.assertRaisesRegex(OSError, 'flush failed'):
                    run(case)
            self.assertFalse((case.release_output / 'INTENT.json').exists(), 'failed barrier must precede INTENT')
            unattempted(case)

    def test_full_flush_failure_has_no_intent_or_flag(self):
        with ready() as case, mock.patch.object(release, 'full_sync', side_effect=OSError('full flush failed')):
            with self.assertRaisesRegex(OSError, 'full flush failed'):
                run(case)
            self.assertFalse((case.release_output / 'INTENT.json').exists())
            unattempted(case)

    def test_full_sync_calls_strong_flush_when_available_without_error_fallback(self):
        for strong in (False, True):
            with self.subTest(strong=strong):
                events = []
                module = types.SimpleNamespace(fcntl=lambda *args: events.append(('strong', args)))
                if strong:
                    module.F_FULLFSYNC = 12345
                with mock.patch.object(release, 'fcntl', module), \
                     mock.patch.object(release.os, 'fsync', side_effect=lambda fd: events.append(('sync', fd))):
                    release.full_sync(73)
                self.assertEqual(events, [('sync', 73)] + ([('strong', (73, 12345))] if strong else []))
        failing = types.SimpleNamespace(F_FULLFSYNC=12345, fcntl=mock.Mock(side_effect=OSError('strong flush error')))
        with mock.patch.object(release, 'fcntl', failing), mock.patch.object(release.os, 'fsync') as sync:
            with self.assertRaisesRegex(OSError, 'strong flush error'):
                release.full_sync(73)
            sync.assert_called_once_with(73)

    def test_barrier_rechecks_bytes_during_sync(self):
        with ready() as case:
            real = release.full_sync
            def changed(fd):
                real(fd)
                (case.capture / 'ABORT.json').write_bytes((case.capture / 'ABORT.json').read_bytes() + b' ')
            with mock.patch.object(release, 'full_sync', side_effect=changed):
                with self.assertRaisesRegex(RuntimeError, 'evidence.*changed'):
                    run(case)
            unattempted(case)

    def test_directory_flush_failure_refuses(self):
        with ready() as case:
            durable, fsync = release.durable_evidence, os.fsync
            def failing(evidence):
                def sync(fd):
                    if stat.S_ISDIR(os.fstat(fd).st_mode):
                        raise OSError('directory flush failed')
                    fsync(fd)
                with mock.patch.object(release.os, 'fsync', side_effect=sync):
                    durable(evidence)
            with mock.patch.object(release, 'durable_evidence', side_effect=failing):
                with self.assertRaisesRegex(OSError, 'directory flush failed'):
                    run(case)
            unattempted(case)

    def test_every_evidence_file_is_flushed_and_directories_bottom_up(self):
        with ready() as case:
            real = release.durable_evidence
            def observed(evidence):
                paths = {path: path.lstat() for path in evidence}
                directories = {p: p.lstat() for path in paths for p in (path.parent, *path.parents)
                               if p == case.temp or case.temp in p.parents}
                events = []
                fsync = os.fsync
                def sync(fd):
                    info = os.fstat(fd)
                    mapped = [p for p, value in {**paths, **directories}.items()
                              if (value.st_dev, value.st_ino) == (info.st_dev, info.st_ino)]
                    self.assertEqual(len(mapped), 1)
                    events.append((mapped[0], stat.S_ISDIR(info.st_mode)))
                    fsync(fd)
                with mock.patch.object(release.os, 'fsync', side_effect=sync):
                    real(evidence)
                self.assertEqual({p for p, directory in events if not directory}, set(evidence))
                seen = [p for p, directory in events if directory]
                self.assertEqual(seen, sorted(seen, key=lambda p: (-len(p.parts), str(p))))
                self.assertTrue(seen)
            with mock.patch.object(release, 'durable_evidence', side_effect=observed):
                run(case)

    def test_changed_evidence_after_barrier_refuses(self):
        with ready() as case:
            sample = case.sample
            def changed(spec, output):
                result = sample(spec, output)
                if output.name == 'barrier':
                    (case.capture / 'ABORT.json').write_bytes((case.capture / 'ABORT.json').read_bytes() + b' ')
                return result
            with mock.patch.object(release, 'preflight', side_effect=changed):
                with self.assertRaisesRegex(RuntimeError, 'canonical'):
                    run(case)
            unattempted(case)

    def test_intent_exists_at_interrupting_flag_call(self):
        with ready() as case:
            def interrupt(path, identity, present):
                case.clear(path, identity, present)
                raise KeyboardInterrupt('interrupt at clear')
            with mock.patch.object(release, 'change_immutable', side_effect=interrupt):
                with self.assertRaisesRegex(KeyboardInterrupt, 'interrupt at clear'):
                    run(case)
            self.assertTrue((case.release_output / 'INTENT.json').exists(), 'INTENT must precede the flag call')
            manual(case)

    def test_applied_flag_error_never_reguards_or_retries(self):
        with ready() as case:
            def failed(path, identity, present):
                case.clear(path, identity, present)
                raise OSError('applied clear uncertain')
            with mock.patch.object(release, 'change_immutable', side_effect=failed):
                with self.assertRaisesRegex(OSError, 'applied clear uncertain'):
                    run(case)
            manual(case)

    def test_after_sample_failure_never_completes(self):
        with ready() as case:
            def sample(spec, output):
                if output.name == 'after':
                    raise OSError('post-clear observation failed')
                return case.sample(spec, output)
            with mock.patch.object(release, 'preflight', side_effect=sample), \
                 mock.patch.object(release, 'change_immutable', side_effect=case.clear) as flags:
                with self.assertRaisesRegex(OSError, 'post-clear observation failed'):
                    run(case)
            manual(case)
            self.assertEqual(flags.call_count, 1, 'no re-guard attempt after failure')

    def test_post_clear_bytes_require_full_rehash(self):
        with ready() as case:
            def changed(path, identity, present):
                case.clear(path, identity, present)
                path.write_bytes(b'X' * identity[2])
                stamp = json.loads((case.release_output / 'INTENT.json').read_bytes())['source']['mtime_ns']
                os.utime(path, ns=(stamp, stamp))
            with mock.patch.object(release, 'change_immutable', side_effect=changed):
                with self.assertRaisesRegex(RuntimeError, 'hash differs'):
                    run(case)
            manual(case)

    def test_post_clear_mtime_change_refuses(self):
        with ready() as case:
            def changed(path, identity, present):
                case.clear(path, identity, present)
                stamp = path.stat().st_mtime_ns + 1000000
                os.utime(path, ns=(stamp, stamp))
            with mock.patch.object(release, 'change_immutable', side_effect=changed):
                with self.assertRaisesRegex(RuntimeError, 'metadata differs'):
                    run(case)
            manual(case)

    def test_post_clear_host_binding_changes_refuse(self):
        for key, value in (('state', 'started'), ('host_boot_session', 'reboot'), ('image_device', 0),
                           ('vmstate', {'changed': True}), ('image_holders', [99]),
                           ('holders_consistent', False), ('config_sha256', 'f' * 64)):
            with self.subTest(key=key), ready() as case:
                def changed(path, identity, present):
                    case.clear(path, identity, present)
                    case.stopped[key] = value
                with mock.patch.object(release, 'change_immutable', side_effect=changed):
                    with self.assertRaisesRegex(RuntimeError, 'stopped host/source'):
                        run(case)
                manual(case)

    def test_post_clear_clone_or_attachment_refuses(self):
        for fault in ('clone', 'sibling', 'attachment'):
            with self.subTest(fault=fault), ready() as case:
                def changed(path, identity, present):
                    case.clear(path, identity, present)
                    if fault == 'clone':
                        case.clone.write_bytes(b'reappeared')
                    elif fault == 'sibling':
                        sibling = case.temp / 'other'
                        sibling.mkdir(mode=0o700)
                        (sibling / 'powered-off-image.asif').write_bytes(b'other')
                    else:
                        case.patch(release, 'no_disk_attachment', side_effect=RuntimeError('attached clone'))
                with mock.patch.object(release, 'change_immutable', side_effect=changed):
                    with self.assertRaisesRegex(RuntimeError, 'clone reappeared|temporary image clone|attached clone'):
                        run(case)
                manual(case)

    def test_sibling_capture_without_clone_is_allowed(self):
        with ready() as case:
            sibling = case.temp / 'old'
            sibling.mkdir(mode=0o700)
            write_record(sibling / 'CAPTURE.json', {'historical': True})
            try:
                run(case)
            except RuntimeError as error:
                self.fail('clone-free historical sibling must allow release: ' + str(error))
            self.assertEqual(len(case.release_calls), 1)
            verify(case)

    def test_post_clear_transcript_changes_refuse(self):
        for name in ('ABORT.json', 'ABORT_CLEANUP.json', 'abort-decision/after/preflight.json',
                     'FAILED.json', 'ABORT_CLEANUP.json.tmp', 'abort-cleanup/unknown'):
            with self.subTest(name=name), ready() as case:
                def changed(path, identity, present):
                    case.clear(path, identity, present)
                    target = case.capture / name
                    if target.exists():
                        target.write_bytes(target.read_bytes() + b' ')
                    else:
                        write_record(target, {})
                with mock.patch.object(release, 'change_immutable', side_effect=changed):
                    with self.assertRaisesRegex(RuntimeError, 'canonical|bytes|pins|failure|partial|unknown'):
                        run(case)
                manual(case)

    def test_intent_readback_change_refuses_before_clear(self):
        with ready() as case:
            publish = release.publish_release
            def changed(fd, name, value):
                publish(fd, name, value)
                if name == 'INTENT.json':
                    replace(case.release_output / name, checkpoint_sha256='0' * 64)
            with mock.patch.object(release, 'publish_release', side_effect=changed):
                with self.assertRaises(RuntimeError):
                    run(case)
            unattempted(case)

    def test_visible_completion_fsync_failure_is_manual_and_refused(self):
        with ready() as case:
            publish = release.publish_release
            def failed(fd, name, value):
                publish(fd, name, value)
                if name == 'COMPLETE.json':
                    raise OSError('post-rename directory fsync error')
            with mock.patch.object(release, 'publish_release', side_effect=failed):
                with self.assertRaisesRegex(OSError, 'post-rename'):
                    run(case)
            self.assertTrue((case.release_output / 'COMPLETE.json').exists())
            self.assertTrue((case.release_output / 'FAILED.json').exists())
            with self.assertRaisesRegex(RuntimeError, 'failed, partial'):
                verify(case)
            self.assertEqual(len(case.release_calls), 1)
            with self.assertRaisesRegex(RuntimeError, 'already attempted'):
                run(case)

    def test_verifier_requires_completion_and_exact_layout(self):
        for fault in ('missing', 'FAILED.json', 'COMPLETE.json.tmp', 'unknown', 'after/unknown'):
            with self.subTest(fault=fault), ready() as case:
                run(case)
                if fault == 'missing':
                    (case.release_output / 'COMPLETE.json').unlink()
                else:
                    write_record(case.release_output / fault, {})
                with self.assertRaisesRegex(RuntimeError, 'failed|partial|unknown'):
                    verify(case)

    def test_verifier_canonical_schema_hash_and_source_pins(self):
        for name, changes in (('INTENT.json', {'extra': True}), ('INTENT.json', {'arm_sha256': '0' * 64}),
                              ('COMPLETE.json', {'extra': True}), ('COMPLETE.json', {'abort_sha256': '0' * 64}),
                              ('COMPLETE.json', {'source': {}}), ('COMPLETE.json', None)):
            with self.subTest(name=name, changes=changes), ready() as case:
                run(case)
                path = case.release_output / name
                if changes is None:
                    path.write_bytes(path.read_bytes() + b' ')
                else:
                    replace(path, **changes)
                with self.assertRaisesRegex(RuntimeError, 'schema|canonical|binding'):
                    verify(case)

    def test_verifier_requires_exactly_two_distinct_lock_descriptors(self):
        with ready() as case:
            run(case)
            with abort.abort_context(case.host, case.capture, True) as (host, capture, directory_fd, locks):
                for supplied in ([], locks[:1], [locks[0], locks[0]], [*locks, directory_fd]):
                    with self.subTest(supplied=supplied), self.assertRaisesRegex(RuntimeError, 'two distinct'):
                        release.verify_release(host, capture, case.stopped, directory_fd, supplied, fixture=True)

    def test_new_holder_after_intent_must_refuse_before_clear(self):
        with ready() as case:
            publish = release.publish_release
            def changed(fd, name, value):
                publish(fd, name, value)
                if name == 'INTENT.json':
                    case.stopped['image_holders'] = [99999]
                    case.stopped['holders_consistent'] = False
            with mock.patch.object(release, 'publish_release', side_effect=changed):
                with self.assertRaises(RuntimeError):
                    run(case)
            unattempted(case)

    def test_last_live_sample_follows_full_hash_and_precedes_clear(self):
        with ready() as case:
            events = []
            original_hash = abort.clone_identity
            def hashed(*args, **kwargs):
                events.append('full-hash')
                return original_hash(*args, **kwargs)
            def sample(spec, output):
                if output.name == 'before-clear':
                    events.append('last-live-sample')
                return case.sample(spec, output)
            def clear(*args):
                events.append('clear')
                case.clear(*args)
            with mock.patch.object(abort, 'clone_identity', side_effect=hashed), \
                 mock.patch.object(release, 'preflight', side_effect=sample), \
                 mock.patch.object(release, 'change_immutable', side_effect=clear):
                run(case)
            self.assertIn('full-hash', events[:events.index('last-live-sample')])
            self.assertEqual(events[events.index('last-live-sample'):events.index('clear') + 1],
                             ['last-live-sample', 'clear'])

    def test_new_host_state_after_intent_refuses_before_clear(self):
        for key, value in (('state', 'started'), ('host_boot_session', 'reboot'), ('image_device', 0),
                           ('config_sha256', 'f' * 64), ('vmstate', {'changed': True})):
            with self.subTest(key=key), ready() as case:
                publish = release.publish_release
                def changed(fd, name, result):
                    publish(fd, name, result)
                    if name == 'INTENT.json':
                        case.stopped[key] = value
                with mock.patch.object(release, 'publish_release', side_effect=changed):
                    with self.assertRaises(RuntimeError):
                        run(case)
                unattempted(case)

    def test_last_live_observation_failure_refuses_before_clear(self):
        with ready() as case:
            def sample(spec, output):
                if output.name == 'before-clear':
                    raise OSError('source attachment or unreadable live observation')
                return case.sample(spec, output)
            with mock.patch.object(release, 'preflight', side_effect=sample):
                with self.assertRaisesRegex(OSError, 'attachment or unreadable'):
                    run(case)
            unattempted(case)

    def test_last_guarded_source_metadata_refuses_before_clear(self):
        with ready() as case:
            def sample(spec, output):
                value = case.sample(spec, output)
                if output.name == 'before-clear':
                    stamp = case.source.stat().st_mtime_ns + 1000000
                    os.utime(case.source, ns=(stamp, stamp))
                return value
            with mock.patch.object(release, 'preflight', side_effect=sample):
                with self.assertRaises(RuntimeError):
                    run(case)
            unattempted(case)

    def test_last_preclear_clone_attachment_or_sibling_refuses(self):
        for fault in ('clone', 'attachment', 'sibling'):
            with self.subTest(fault=fault), ready() as case:
                def sample(spec, output):
                    value = case.sample(spec, output)
                    if output.name == 'before-clear':
                        if fault == 'clone':
                            case.clone.write_bytes(b'new clone')
                        elif fault == 'attachment':
                            case.patch(release, 'no_disk_attachment', side_effect=RuntimeError('clone attached at last check'))
                        else:
                            sibling = case.temp / 'late-sibling'
                            sibling.mkdir(mode=0o700)
                            (sibling / 'powered-off-image.asif').write_bytes(b'other')
                    return value
                with mock.patch.object(release, 'preflight', side_effect=sample):
                    with self.assertRaises(RuntimeError):
                        run(case)
                unattempted(case)

    def test_last_preclear_ctime_requires_equality(self):
        with ready() as case:
            def sample(spec, output):
                value = case.sample(spec, output)
                if output.name == 'before-clear':
                    case.ctime_advance = 1
                return value
            with mock.patch.object(release, 'preflight', side_effect=sample):
                with self.assertRaises(RuntimeError):
                    run(case)
            unattempted(case)

    def test_verifier_binds_last_preclear_sample_bytes(self):
        with ready() as case:
            run(case)
            replace(case.release_output / 'before-clear/preflight.json', at_utc='later rewritten evidence')
            with self.assertRaisesRegex(RuntimeError, 'completion or released source binding'):
                verify(case)

    def test_both_exclusive_locks_stay_held_at_clear(self):
        with ready() as case:
            def checked(path, identity, present):
                child = subprocess.run([sys.executable, '-c',
                    "import fcntl,sys; held=[]; blocked=0\n"
                    "for name in sys.argv[1:]:\n"
                    " f=open(name,'rb'); held.append(f)\n"
                    " try: fcntl.flock(f,fcntl.LOCK_EX|fcntl.LOCK_NB)\n"
                    " except BlockingIOError: blocked+=1\n"
                    "raise SystemExit(0 if blocked==2 else 1)",
                    str(case.capture / 'CAPTURE_ACTIVE.lock'), str(case.capture / 'ARMED.json')],
                    capture_output=True, timeout=15)
                self.assertEqual(child.returncode, 0, 'both EX locks must remain held at clear')
                case.clear(path, identity, present)
            with mock.patch.object(release, 'change_immutable', side_effect=checked):
                run(case)

    def test_busy_capture_lock_refuses_before_attempt(self):
        with ready() as case, (case.capture / 'CAPTURE_ACTIVE.lock').open('rb') as held:
            fcntl.flock(held, fcntl.LOCK_EX | fcntl.LOCK_NB)
            with self.assertRaisesRegex(RuntimeError, 'active'):
                run(case)
            self.assertFalse(case.release_output.exists())
            unattempted(case)

    def test_written_sample_must_equal_consumed_sample(self):
        for name in ('verify', 'barrier', 'before-clear', 'after'):
            with self.subTest(name=name), ready() as case:
                def sample(spec, output):
                    value = case.sample(spec, output)
                    if output.name == name:
                        replace(output / 'preflight.json', at_utc='not the consumed sample')
                    return value
                with mock.patch.object(release, 'preflight', side_effect=sample):
                    with self.assertRaisesRegex(RuntimeError, 'consumed observation'):
                        run(case)
                if name == 'after':
                    manual(case)
                else:
                    unattempted(case)

    def test_post_clear_source_identity_and_exact_flags(self):
        for fault in ('inode', 'mode', 'link', 'flags', 'older-ctime'):
            with self.subTest(fault=fault), ready() as case:
                def changed(path, identity, present):
                    case.clear(path, identity, present)
                    if fault == 'inode':
                        content = path.read_bytes()
                        path.rename(case.temp / 'retained-original-source')
                        path.write_bytes(content)
                        path.chmod(0o600)
                    elif fault == 'mode':
                        path.chmod(0o640)
                    elif fault == 'link':
                        os.link(path, case.temp / 'extra-link')
                    elif fault == 'flags':
                        case.flags[path] = 1 << 30
                    else:
                        case.ctime_advance = -1
                with mock.patch.object(release, 'change_immutable', side_effect=changed):
                    with self.assertRaisesRegex(RuntimeError, 'metadata differs|single-link'):
                        run(case)
                self.assertEqual(len(case.release_calls), 1)
                self.assertFalse((case.release_output / 'COMPLETE.json').exists())

    def test_primary_interrupt_survives_diagnostic_interrupt(self):
        with ready() as case:
            with mock.patch.object(release, 'change_immutable', side_effect=KeyboardInterrupt('primary')), \
                 mock.patch('host_journal_mount.write_record', side_effect=KeyboardInterrupt('diagnostic')):
                with self.assertRaisesRegex(KeyboardInterrupt, 'primary'):
                    run(case)
            self.assertTrue(case.release_output.exists())
            self.assertFalse((case.release_output / 'COMPLETE.json').exists())
            with self.assertRaisesRegex(RuntimeError, 'already attempted'):
                run(case)


if __name__ == '__main__':
    unittest.main()
