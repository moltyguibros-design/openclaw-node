"""Real owned receipt chain/flushes; scripted VM/flags, no admission or VM operation."""
import contextlib
import copy
import hashlib
import json
import os
import pathlib
import stat
import subprocess
import sys
import unittest
from unittest import mock
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import host_clone_dispose as abort
import host_vm_reconcile as decision
import restore_only as guest
from host_guest_commit import encoded
from host_vm_preflight import write_record
from test_host_abort_release import ready, run as release

@contextlib.contextmanager
def prepared():
    with ready() as case:
        release(case)
        case.boot_output = case.capture / 'abort-boot'
        case.checkpoint_raw = guest.encoded(case.journal.records[-1])
        yield case

def run(case, fixture=True):
    return decision.decide_restore_prior(case.host, case.capture, fixture=fixture)

def verify(case, observed=None):
    with abort.abort_context(case.host, case.capture, True) as (host, capture, fd, locks):
        return decision.verify_decision(host, capture, copy.deepcopy(case.stopped) if observed is None else observed,
                                        fd, locks, fixture=True)

def unchanged(case):
    case.assertEqual(len(case.release_calls), 1, 'decision must not make a flag call')
    case.assertEqual(case.flags[case.source], 0)
    case.assertEqual(case.source.read_bytes(), b'owned stopped source image stand-in')
    for name in ('BOOTABLE.json', 'ACCEPTED.json', 'DECISION.json'):
        case.assertEqual(list(case.capture.rglob(name)), [])

def no_decision(case):
    case.assertFalse((case.boot_output / 'RESTORE_PRIOR.json').exists(), 'no decision before its prerequisites')
    case.assertEqual(len(case.release_calls), 1, 'decision must not make a flag call')

class BootDecision(unittest.TestCase):
    def test_real_chain_and_readonly_verifier(self):
        with prepared() as case:
            result = run(case)
            self.assertEqual(result, verify(case))
            raw = (case.boot_output / 'RESTORE_PRIOR.json').read_bytes()
            self.assertEqual(result, {'decision': raw, 'sha256': hashlib.sha256(raw).hexdigest()})
            value = json.loads(raw)
            self.assertEqual(set(value), decision.BOOT_DECISION_KEYS)
            self.assertTrue(raw.endswith(b'\n'))
            self.assertFalse(case.checkpoint_raw.endswith(b'\n'))
            self.assertEqual(value['capture_nonce'], case.nonce)
            self.assertEqual(value['checkpoint_sha256'], case.journal.records[-1]['sha256'])
            self.assertEqual(value['released_source'], json.loads((case.release_output / 'COMPLETE.json').read_bytes())['source'])
            self.assertEqual({p.name for p in case.boot_output.iterdir()}, decision.BOOT_LAYOUT)
            before = {str(p): p.read_bytes() for p in case.capture.rglob('*') if p.is_file()}
            with mock.patch.object(decision, 'preflight', side_effect=AssertionError('no observation')), \
                 mock.patch.object(decision, 'full_sync', side_effect=AssertionError('no sync')), \
                 mock.patch.object(decision, 'publish_release', side_effect=AssertionError('no publish')):
                self.assertEqual(verify(case), result)
            self.assertEqual(before, {str(p): p.read_bytes() for p in case.capture.rglob('*') if p.is_file()})
            unchanged(case)

    def test_production_fence_precedes_inputs(self):
        with mock.patch.object(decision.pathlib, 'Path', side_effect=AssertionError('path read')):
            for call in (lambda: decision.decide_restore_prior('/absent', '/absent'),
                         lambda: decision.verify_decision('/absent', '/absent', {}, -1, []),
                         lambda: guest.decode_restore_prior_claim(None, None, None)):
                with self.assertRaisesRegex(RuntimeError, 'production restore-prior'):
                    call()

    def test_viable_production_and_fixture_fences(self):
        with prepared() as case:
            with self.assertRaisesRegex(RuntimeError, 'production restore-prior'):
                run(case, False)
            self.assertFalse(case.boot_output.exists())
            case.host.write_bytes(encoded({**json.loads(case.host.read_bytes()), 'uuid': 'wrong'}))
            with self.assertRaisesRegex(RuntimeError, 'owned fixture'):
                run(case)
            self.assertFalse(case.boot_output.exists())
            unchanged(case)

    def test_lock_cardinality_before_paths(self):
        with mock.patch.object(decision.pathlib, 'Path', side_effect=AssertionError('path read')):
            for locks in ([], [3], [3, 3], [3, 4, 5]):
                with self.assertRaisesRegex(RuntimeError, 'exactly two distinct'):
                    decision.verify_decision('/missing', '/missing', {}, -1, locks, fixture=True)

    def test_replay_and_partial_are_manual(self):
        for name in (None, 'FAILED.json', 'INTENT.json', 'RESTORE_PRIOR.json'):
            with self.subTest(name=name), prepared() as case:
                case.boot_output.mkdir(mode=0o700)
                if name:
                    write_record(case.boot_output / name, {})
                with self.assertRaisesRegex(RuntimeError, 'already attempted'):
                    run(case)
                unchanged(case)
        with prepared() as case:
            run(case)
            with self.assertRaisesRegex(RuntimeError, 'already attempted'):
                run(case)
            unchanged(case)

    def test_reserved_name(self):
        with prepared() as case:
            with self.assertRaisesRegex(RuntimeError, 'reserved attempt'):
                abort.verify_abort_command(case.host, case.capture, case.boot_output, fixture=True)
            self.assertFalse(case.boot_output.exists())

    def test_release_failure_missing_and_terminal_conflicts(self):
        for name in ('FAILED.json', 'abort-release/FAILED.json', 'ACCEPTED.json', 'DECISION.json', 'other/DECISION.json', 'missing'):
            with self.subTest(name=name), prepared() as case:
                if name == 'missing':
                    (case.release_output / 'COMPLETE.json').unlink()
                else:
                    path = case.capture / name
                    path.parent.mkdir(mode=0o700, exist_ok=True)
                    write_record(path, {})
                with self.assertRaises((RuntimeError, FileNotFoundError)):
                    run(case)
                self.assertFalse((case.boot_output / 'INTENT.json').exists())
                no_decision(case)

    def test_original_barrier_failure_precedes_intent(self):
        with prepared() as case:
            real = decision.durable_evidence
            def barrier(evidence):
                if case.capture / 'ABORT.json' in evidence:
                    raise OSError('original barrier failed')
                return real(evidence)
            with mock.patch.object(decision, 'durable_evidence', side_effect=barrier):
                with self.assertRaisesRegex(OSError, 'original barrier failed'):
                    run(case)
            self.assertFalse((case.boot_output / 'INTENT.json').exists(), 'barrier before INTENT')
            no_decision(case)

    def test_intent_readback(self):
        with prepared() as case:
            real = decision.publish_release
            def publish(fd, name, value):
                real(fd, name, value)
                if name == 'INTENT.json':
                    (case.boot_output / name).write_bytes(encoded({**value, 'decision': 'ACCEPTED'}))
            with mock.patch.object(decision, 'publish_release', side_effect=publish):
                with self.assertRaisesRegex(RuntimeError, 'readback'):
                    run(case)
            no_decision(case)

    def test_final_sample_change_refuses_before_decision(self):
        faults = ('holder', 'state', 'host_boot_session', 'image_inode', 'image_device', 'vmstate',
                  'package', 'config_sha256', 'utmctl_sha256', 'bytes', 'flags', 'ctime', 'mtime', 'unreadable')
        for fault in faults:
            with self.subTest(fault=fault), prepared() as case:
                real = case.sample
                mtime = case.source.stat().st_mtime_ns
                def sampled(host, output):
                    if output == case.boot_output / 'decision':
                        if fault == 'unreadable':
                            raise RuntimeError('observation unreadable')
                        if fault == 'bytes':
                            case.source.write_bytes(b'X' * case.source.stat().st_size)
                            os.utime(case.source, ns=(1, mtime))
                        elif fault == 'flags':
                            case.flags[case.source] = stat.UF_IMMUTABLE
                        elif fault == 'ctime':
                            case.ctime_advance += 1
                        elif fault == 'mtime':
                            os.utime(case.source, ns=(1, 1))
                        else:
                            changes = {'holder': ('image_holders', [99]), 'state': ('state', 'started'),
                                       'image_inode': ('image_inode', case.stopped['image_inode'] + 1),
                                       'image_device': ('image_device', case.stopped['image_device'] + 1)}
                            key, value = changes.get(fault, (fault, 'changed'))
                            case.stopped[key] = value
                    return real(host, output)
                with mock.patch.object(decision, 'preflight', side_effect=sampled):
                    with self.assertRaises((RuntimeError, OSError)):
                        run(case)
                no_decision(case)

    def test_clone_attachment_sibling_refusal(self):
        for fault in ('clone', 'attachment', 'sibling'):
            with self.subTest(fault=fault), prepared() as case:
                real = case.sample
                def sampled(host, output):
                    if output == case.boot_output / 'decision':
                        if fault == 'clone':
                            case.clone.write_bytes(b'late clone')
                        elif fault == 'sibling':
                            sibling = case.temp / 'other'
                            sibling.mkdir(mode=0o700)
                            (sibling / 'powered-off-image.asif').write_bytes(b'late clone')
                        else:
                            case.patch(decision, 'no_disk_attachment', side_effect=RuntimeError('image attached'))
                    return real(host, output)
                with mock.patch.object(decision, 'preflight', side_effect=sampled):
                    with self.assertRaisesRegex(RuntimeError, 'clone|attached'):
                        run(case)
                no_decision(case)

    def test_clone_free_historical_sibling_allowed(self):
        with prepared() as case:
            sibling = case.temp / 'history'
            sibling.mkdir(mode=0o700)
            write_record(sibling / 'CAPTURE.json', {'old': True})
            run(case)
            unchanged(case)

    def test_consumed_written_sample_parity(self):
        for stage in ('verify', 'decision'):
            with self.subTest(stage=stage), prepared() as case:
                real = case.sample
                def sampled(host, output):
                    value = real(host, output)
                    if output == case.boot_output / stage:
                        (output / 'preflight.json').write_bytes(encoded({**value, 'image_inode': 9999}))
                    return value
                with mock.patch.object(decision, 'preflight', side_effect=sampled):
                    with self.assertRaisesRegex(RuntimeError, 'sample differs from consumed'):
                        run(case)
                no_decision(case)

    def test_final_sample_barrier_before_record(self):
        with prepared() as case:
            real = decision.durable_evidence
            def barrier(evidence):
                if case.boot_output / 'decision/preflight.json' in evidence:
                    raise OSError('sample flush failed')
                return real(evidence)
            with mock.patch.object(decision, 'durable_evidence', side_effect=barrier):
                with self.assertRaisesRegex(OSError, 'sample flush failed'):
                    run(case)
            self.assertTrue((case.boot_output / 'INTENT.json').exists())
            no_decision(case)

    def test_visible_record_with_publication_error_refuses(self):
        with prepared() as case:
            real = decision.publish_release
            def publish(fd, name, value):
                real(fd, name, value)
                if name == 'RESTORE_PRIOR.json':
                    raise OSError('visible decision failure')
            with mock.patch.object(decision, 'publish_release', side_effect=publish):
                with self.assertRaisesRegex(OSError, 'visible decision failure'):
                    run(case)
            self.assertTrue((case.boot_output / 'RESTORE_PRIOR.json').exists())
            self.assertTrue((case.boot_output / 'FAILED.json').exists())
            with self.assertRaisesRegex(RuntimeError, 'failed, partial'):
                verify(case)
            with self.assertRaisesRegex(RuntimeError, 'already attempted'):
                run(case)
            unchanged(case)

    def test_primary_interrupt_is_preserved(self):
        with prepared() as case, mock.patch.object(decision, 'preflight', side_effect=KeyboardInterrupt('primary')):
            with self.assertRaisesRegex(KeyboardInterrupt, 'primary'):
                run(case)
            self.assertTrue((case.boot_output / 'FAILED.json').exists())
            no_decision(case)

    def test_verifier_layout(self):
        for name in ('FAILED.json', 'extra', 'RESTORE_PRIOR.json.tmp', 'decision/extra', 'missing'):
            with self.subTest(name=name), prepared() as case:
                run(case)
                if name == 'missing':
                    (case.boot_output / 'RESTORE_PRIOR.json').unlink()
                else:
                    write_record(case.boot_output / name, {})
                with self.assertRaises((RuntimeError, FileNotFoundError)):
                    verify(case)
                unchanged(case)

    def test_verifier_stays_prestart_original_host(self):
        for key, value in (('state', 'started'), ('host_boot_session', 'rebooted'), ('image_holders', [42])):
            with self.subTest(key=key), prepared() as case:
                run(case)
                with self.assertRaisesRegex(RuntimeError, 'original stopped'):
                    verify(case, {**case.stopped, key: value})
                unchanged(case)

    def test_intent_before_final_sample_and_record(self):
        with prepared() as case:
            real = case.sample
            def sampled(host, output):
                if output == case.boot_output / 'decision':
                    self.assertTrue((case.boot_output / 'INTENT.json').exists(), 'INTENT before decision observation')
                    self.assertFalse((case.boot_output / 'RESTORE_PRIOR.json').exists(), 'record only after decision observation')
                return real(host, output)
            with mock.patch.object(decision, 'preflight', side_effect=sampled):
                run(case)
            unchanged(case)

    def test_pinned_evidence_change_after_intent_refuses(self):
        with prepared() as case:
            real = case.sample
            def sampled(host, output):
                if output == case.boot_output / 'decision':
                    (case.capture / 'ABORT.json').write_bytes(encoded({**json.loads((case.capture / 'ABORT.json').read_bytes()), 'reason': 'changed'}))
                return real(host, output)
            with mock.patch.object(decision, 'preflight', side_effect=sampled):
                with self.assertRaises(RuntimeError):
                    run(case)
            no_decision(case)

    def test_both_exclusive_locks_held_at_publication(self):
        with prepared() as case:
            real = decision.publish_release
            def publish(fd, name, value):
                if name == 'RESTORE_PRIOR.json':
                    code = ("import fcntl,sys; busy=0\n"
                            "for p in sys.argv[1:]:\n"
                            " f=open(p,'rb')\n"
                            " try: fcntl.flock(f,fcntl.LOCK_EX|fcntl.LOCK_NB)\n"
                            " except BlockingIOError: busy+=1\n"
                            "print(busy)\n")
                    child = subprocess.run([sys.executable, '-c', code, str(case.capture / 'CAPTURE_ACTIVE.lock'),
                                            str(case.capture / 'ARMED.json')], capture_output=True, text=True, timeout=5)
                    self.assertEqual((child.returncode, child.stdout.strip()), (0, '2'))
                return real(fd, name, value)
            with mock.patch.object(decision, 'publish_release', side_effect=publish):
                run(case)
            unchanged(case)

    def test_claim_bad_checkpoint_body_hash(self):
        with prepared() as case:
            result = run(case)
            row = {**json.loads(case.checkpoint_raw), 'at': 'changed without body hash'}
            with self.assertRaisesRegex(RuntimeError, 'checkpoint is not intact'):
                guest.decode_restore_prior_claim(result['decision'], result['sha256'], guest.encoded(row), fixture=True)
            unchanged(case)

    def test_claim_prehead_binding_with_intact_distinct_checkpoint(self):
        with prepared() as case:
            result = run(case)
            row = {**json.loads(case.checkpoint_raw), 'pre_head': '0' * 64, 'previous': '0' * 64}
            row['sha256'] = hashlib.sha256(guest.encoded({k: v for k, v in row.items() if k != 'sha256'})).hexdigest()
            changed = {**json.loads(result['decision']), 'checkpoint_sha256': row['sha256']}
            raw = encoded(changed)
            with self.assertRaisesRegex(RuntimeError, 'claim differs from the local checkpoint'):
                guest.decode_restore_prior_claim(raw, hashlib.sha256(raw).hexdigest(), guest.encoded(row), fixture=True)
            unchanged(case)

    def test_attempt_directory_sync_failure_is_retained(self):
        with prepared() as case:
            real = os.fsync
            inode = case.capture.stat().st_ino
            def synced(fd):
                if os.fstat(fd).st_ino == inode:
                    raise OSError('attempt directory sync failed')
                return real(fd)
            with mock.patch.object(decision.os, 'fsync', side_effect=synced):
                with self.assertRaisesRegex(OSError, 'attempt directory sync failed'):
                    run(case)
            self.assertTrue((case.boot_output / 'FAILED.json').exists())
            self.assertFalse((case.boot_output / 'INTENT.json').exists())
            no_decision(case)
            with self.assertRaisesRegex(RuntimeError, 'already attempted'):
                run(case)

    def test_verifier_rejects_rebound_evidence_table(self):
        with prepared() as case:
            run(case)
            intent = json.loads((case.boot_output / 'INTENT.json').read_bytes())
            intent['evidence_sha256']['ABORT.json'] = '0' * 64
            intent_raw = encoded(intent)
            (case.boot_output / 'INTENT.json').write_bytes(intent_raw)
            row = json.loads((case.boot_output / 'RESTORE_PRIOR.json').read_bytes())
            row['evidence_sha256'] = intent['evidence_sha256']
            row['intent_sha256'] = hashlib.sha256(intent_raw).hexdigest()
            (case.boot_output / 'RESTORE_PRIOR.json').write_bytes(encoded(row))
            with self.assertRaisesRegex(RuntimeError, 'intent or evidence binding'):
                verify(case)
            unchanged(case)

    def test_verifier_rebound_stored_sample_requires_original_host(self):
        for stage in ('verify', 'decision'):
            with self.subTest(stage=stage), prepared() as case:
                run(case)
                sample = case.boot_output / stage / 'preflight.json'
                sample.write_bytes(encoded({**json.loads(sample.read_bytes()), 'host_boot_session': 'foreign-host-boot'}))
                intent = json.loads((case.boot_output / 'INTENT.json').read_bytes())
                row = json.loads((case.boot_output / 'RESTORE_PRIOR.json').read_bytes())
                table = decision.hashes(decision.sample_files(case.boot_output / stage))
                if stage == 'verify':
                    intent['verify_sample_sha256'] = row['verify_sample_sha256'] = table
                else:
                    row['decision_sample_sha256'] = table
                intent_raw = encoded(intent)
                (case.boot_output / 'INTENT.json').write_bytes(intent_raw)
                row['intent_sha256'] = hashlib.sha256(intent_raw).hexdigest()
                (case.boot_output / 'RESTORE_PRIOR.json').write_bytes(encoded(row))
                with self.assertRaisesRegex(RuntimeError, 'original stopped host/source binding'):
                    verify(case)
                unchanged(case)

    def test_verifier_decision_must_bind_intent(self):
        with prepared() as case:
            run(case)
            path = case.boot_output / 'RESTORE_PRIOR.json'
            path.write_bytes(encoded({**json.loads(path.read_bytes()), 'arm_sha256': '0' * 64}))
            with self.assertRaisesRegex(RuntimeError, 'differs from intent or samples'):
                verify(case)
            unchanged(case)

    def test_claim_independent_nonce_arm_and_checkpoint_bindings(self):
        with prepared() as case:
            result = run(case)
            original = json.loads(result['decision'])
            for field in ('capture_nonce', 'arm_sha256', 'checkpoint_sha256'):
                raw = encoded({**original, field: '0' * 64})
                with self.subTest(field=field), self.assertRaisesRegex(RuntimeError, 'claim differs from the local checkpoint'):
                    guest.decode_restore_prior_claim(raw, hashlib.sha256(raw).hexdigest(), case.checkpoint_raw, fixture=True)
            unchanged(case)

    def test_claim_intact_changed_checkpoint_digest_refuses(self):
        with prepared() as case:
            result = run(case)
            row = {**json.loads(case.checkpoint_raw), 'at': 'changed-body-with-valid-new-digest'}
            row['sha256'] = hashlib.sha256(guest.encoded({k: v for k, v in row.items() if k != 'sha256'})).hexdigest()
            with self.assertRaisesRegex(RuntimeError, 'claim differs from the local checkpoint'):
                guest.decode_restore_prior_claim(result['decision'], result['sha256'], guest.encoded(row), fixture=True)
            unchanged(case)

    def test_claim_previous_must_equal_prehead_independently(self):
        with prepared() as case:
            result = run(case)
            row = {**json.loads(case.checkpoint_raw), 'previous': '0' * 64}
            row['sha256'] = hashlib.sha256(guest.encoded({k: v for k, v in row.items() if k != 'sha256'})).hexdigest()
            raw = encoded({**json.loads(result['decision']), 'checkpoint_sha256': row['sha256']})
            with self.assertRaisesRegex(RuntimeError, 'claim differs from the local checkpoint'):
                guest.decode_restore_prior_claim(raw, hashlib.sha256(raw).hexdigest(), guest.encoded(row), fixture=True)
            unchanged(case)

    def test_claim_released_flags_must_be_clear(self):
        with prepared() as case:
            result = run(case)
            row = json.loads(result['decision'])
            row['released_source']['flags'] |= stat.UF_IMMUTABLE
            raw = encoded(row)
            with self.assertRaisesRegex(RuntimeError, 'released source schema'):
                guest.decode_restore_prior_claim(raw, hashlib.sha256(raw).hexdigest(), case.checkpoint_raw, fixture=True)
            unchanged(case)

    def test_claim_only_no_io_or_host_verification(self):
        with prepared() as case:
            result = run(case)
            with mock.patch.object(guest, 'Journal', side_effect=AssertionError('no journal')), \
                 mock.patch.object(guest.gate_module, 'Gate', side_effect=AssertionError('no gate')), \
                 mock.patch.object(decision, 'verify_decision', side_effect=AssertionError('no postboot verify')), \
                 mock.patch.object(decision, 'verify_release', side_effect=AssertionError('no release verify')), \
                 mock.patch.object(os, 'open', side_effect=AssertionError('no filesystem')):
                claim = guest.decode_restore_prior_claim(result['decision'], result['sha256'], case.checkpoint_raw, fixture=True)
            self.assertEqual(claim['operator_claim'], result['sha256'])
            self.assertEqual(claim['authority'], 'unprotected-user-owned')
            self.assertIs(claim['admission'], False)
            self.assertNotIn('verified', claim)
            unchanged(case)

    def test_claim_digest_schema_enum_and_checkpoint(self):
        with prepared() as case:
            result = run(case)
            value = json.loads(result['decision'])
            for raw, digest in ((result['decision'], '0' * 64), (result['decision'] + b' ', result['sha256']), (b'', ''), (None, '')):
                with self.assertRaisesRegex(RuntimeError, 'digest differs'):
                    guest.decode_restore_prior_claim(raw, digest, case.checkpoint_raw, fixture=True)
            noncanonical = result['decision'] + b' '
            with self.assertRaisesRegex(RuntimeError, 'canonical'):
                guest.decode_restore_prior_claim(noncanonical, hashlib.sha256(noncanonical).hexdigest(), case.checkpoint_raw, fixture=True)
            for change in ({'decision': 'ACCEPTED'}, {'scope': 'verified'}, {'extra': 1}, {'capture_nonce': True},
                           {'evidence_sha256': {}}, {'released_source': {}}, {'vm_uuid': 'production'}):
                raw = encoded({**value, **change})
                with self.subTest(change=change), self.assertRaises(RuntimeError):
                    guest.decode_restore_prior_claim(raw, hashlib.sha256(raw).hexdigest(), case.checkpoint_raw, fixture=True)
            for raw in (case.checkpoint_raw + b' ', b'{}'):
                with self.assertRaisesRegex(RuntimeError, 'checkpoint'):
                    guest.decode_restore_prior_claim(result['decision'], result['sha256'], raw, fixture=True)
            for field in ('capture_nonce', 'arm_sha256', 'pre_head', 'previous', 'sha256'):
                row = {**json.loads(case.checkpoint_raw), field: '0' * 64}
                if field != 'sha256':
                    row['sha256'] = hashlib.sha256(guest.encoded({k: v for k, v in row.items() if k != 'sha256'})).hexdigest()
                with self.subTest(field=field), self.assertRaisesRegex(RuntimeError, 'checkpoint'):
                    guest.decode_restore_prior_claim(result['decision'], result['sha256'], guest.encoded(row), fixture=True)
            unchanged(case)

if __name__ == '__main__':
    unittest.main()
