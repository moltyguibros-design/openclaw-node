import copy
import errno
import json
import os
import pathlib
import signal
import subprocess
import sys
import tempfile
import time
import unittest
import uuid
from types import SimpleNamespace
from unittest.mock import patch

from preservation_journal import CommittedRefusal, FULL_NODE_SCOPE, Journal, NATS_TRANSFER_UNITS, Refused, TIMER_SCOPE, TIMER_UNITS, UNITS, encoded, matches, valid_record
import preservation_journal
from preservation_checks import TAILSCALE_BINARY, TAILSCALE_LABEL, TAILSCALE_PLIST, TAILSCALE_WRAPPER
from managed_launchd import StopWatch
from legacy_fixture import legacy_journal


HERE = pathlib.Path(__file__).resolve().parent
def inventory(active):
    prior = {name: {'loaded': False, 'running': False, 'disabled': False,
                    'class': 'absent', 'identity': {'installed': False}} for name in UNITS}
    for unit, state in active.items():
        prior[unit] = {'loaded': True, 'running': True, 'disabled': False, 'class': 'daemon',
                       'identity': {'plist_sha256': '0' * 64, 'argv': ['/owned/' + unit],
                                    'files': {'/owned/' + unit: '1' * 64}, 'dependencies': {},
                                    'working_directory': '/'}, **state}
    prior['nats-1'] = {**copy.deepcopy(prior['nats']), 'class': 'held',
                       'loaded': False, 'running': False, 'disabled': True}
    return prior


PRIOR = inventory({'nats': {}, 'mesh-agent': {}})


def timer_inventory():
    prior = {}
    for unit in TIMER_UNITS:
        prior[unit] = {'loaded': True, 'running': False, 'disabled': False,
                       'class': 'timer',
                       'identity': {'plist_sha256': '0' * 64, 'argv': ['/owned/' + unit],
                                    'files': {'/owned/' + unit: '1' * 64}, 'dependencies': {},
                                    'working_directory': '/'}}
    prior['scheduler-heartbeat']['execution_hold'] = {'cohort': sorted(TIMER_UNITS)}
    return prior


def full_node_inventory():
    prior = inventory({unit: {} for unit in UNITS if unit not in ('nats-1', 'federation-tick')})
    for unit in TIMER_UNITS:
        prior[unit].update(running=False, **{'class': 'timer'})
    prior['scheduler-heartbeat']['execution_hold'] = {'cohort': sorted(TIMER_UNITS)}
    prior['mesh-agent'].update(running=False, **{'class': 'on-demand'})
    prior['mesh-tool-discord']['class'] = 'known-broken'
    prior['federation-tick'] = {'loaded': False, 'running': False, 'disabled': True,
        'class': 'unloaded', 'identity': {
            'plist_sha256': '0' * 64, 'argv': ['/owned/federation-tick'],
            'files': {'/owned/federation-tick': '1' * 64}, 'dependencies': {},
            'working_directory': '/'}}
    return prior


def full_entrypoint_evidence(prior):
    overrides = {domain: {'ai.openclaw.' + unit: None for unit in prior}
                 for domain in ('gui', 'user', 'system')}
    for unit, state in prior.items():
        if state['disabled']:
            overrides['gui']['ai.openclaw.' + unit] = True
            overrides['user']['ai.openclaw.' + unit] = True
    return {'verified': True,
            'installed': {'ai.openclaw.' + unit: {
                'path': '/owned/' + unit + '.plist',
                'sha256': state['identity']['plist_sha256']}
                for unit, state in prior.items()},
            'loaded': {'gui': sorted('ai.openclaw.' + unit for unit, state in prior.items()
                                   if state['loaded']), 'user': [], 'system': []},
            'roots': ['/owned'], 'disabled_artifacts': {}, 'excluded': {},
            'overrides': overrides}


def fence_unit(entrypoints, unit):
    label = 'ai.openclaw.' + unit
    entrypoints['loaded']['gui'].remove(label)
    entrypoints['overrides']['gui'][label] = True
    entrypoints['overrides']['user'][label] = True


def fence_listener(entrypoints):
    fence_unit(entrypoints, 'mesh-deploy-listener')


def listener_stop_evidence():
    return {'verified': True, 'unit_unloaded': True, 'descendants_absent': True,
            'disabled_override_verified': True, 'connections_closed': True,
            'listeners_absent': True, 'bootout': {'returncode': 0, 'timed_out': False},
            'termination': {'signal': 15}}


def anchor_hold(journal, hold):
    journal.mutate('scheduler-heartbeat', 'close-execution-hold',
                   lambda: None, lambda: {'verified': True}, hold=hold)


def tailscale_record():
    return {TAILSCALE_LABEL: {
        'plist': {'path': str(TAILSCALE_PLIST), 'sha256': '2' * 64},
        'wrapper': {'path': str(TAILSCALE_WRAPPER), 'sha256': '3' * 64},
        'app': {'path': str(TAILSCALE_BINARY), 'sha256': '4' * 64,
                'bundle_id': 'io.tailscale.ipn.macsys', 'version': '1.0',
                'team_id': 'W5364U7YZB', 'cdhash': '5' * 40},
        'launchd': {'domain': 'system', 'state': 'not running',
                    'runs': 1, 'last_exit_code': 0, 'disabled': False}, 'boot': '6' * 64}}


class JournalTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='openclaw-journal-owned-')
        self.parent = pathlib.Path(self.temp.name) / 'journals'
        self.parent.mkdir(mode=0o700)
        self.root = self.parent / 'journal'
        self.node_lock = pathlib.Path(self.temp.name) / 'node.lock'
        self.nats_marker = pathlib.Path(self.temp.name) / 'writer-handoff.json'
        self.nats_lock = pathlib.Path(self.temp.name) / 'writer.lock'
        self.nats_lock.write_bytes(b'owned writer lock')
        self.nats_lock.chmod(0o644)
        for name, path in (('NATS_WRITER_MARKER', self.nats_marker),
                           ('NATS_LEGACY_LOCK', self.nats_lock)):
            guarded = patch.object(preservation_journal, name, path)
            guarded.start()
            self.addCleanup(guarded.stop)
        root_uid = patch.object(preservation_journal, 'NATS_ROOT_UID', os.getuid())
        root_uid.start()
        self.addCleanup(root_uid.stop)

    def journal(self, prior=None, boot='boot-a', root=None):
        if prior is not None:
            return legacy_journal(root or self.root, prior, boot=boot, node_lock=self.node_lock)
        return Journal(root or self.root, boot=boot, node_lock=self.node_lock)

    def prepared_nats_transfer(self, excluded=None, weak_unit=None):
        prior = full_node_inventory()
        loaded = full_entrypoint_evidence(prior)
        loaded['excluded'] = copy.deepcopy(excluded or {})
        inventory_patch = patch('preservation_journal.capture_entrypoint_inventory',
                                side_effect=lambda _: copy.deepcopy(loaded))
        inventory_patch.start()
        self.addCleanup(inventory_patch.stop)
        marker = self.parent / 'writer-handoff.json'
        marker_patch = patch('preservation_journal.NATS_WRITER_MARKER', marker)
        marker_patch.start()
        self.addCleanup(marker_patch.stop)
        journal = Journal(self.root, prior, boot='boot-a', node_lock=self.node_lock,
                          scope=FULL_NODE_SCOPE)
        self.addCleanup(journal.close)
        hold = SimpleNamespace(journal=journal, check_forward=lambda: {'verified': True})
        anchor_hold(journal, hold)
        journal.mutate('mesh-deploy-listener', 'disable-and-unload',
                       lambda: fence_listener(loaded),
                       listener_stop_evidence, hold=hold)
        for unit in ('nats', 'nats-2', 'nats-3'):
            if unit == weak_unit:
                intent = journal.append('intent', unit=unit, action='disable-and-unload')
                fence_unit(loaded, unit)
                journal.append('verified', intent=intent['sequence'], unit=unit,
                               action='disable-and-unload', evidence={
                                   'verified': True,
                                   'entrypoint_loaded': copy.deepcopy(loaded['loaded']),
                                   'entrypoint_overrides': copy.deepcopy(loaded['overrides'])})
            else:
                journal.mutate(unit, 'disable-and-unload',
                               lambda unit=unit: fence_unit(loaded, unit),
                               listener_stop_evidence, hold=hold)
        def observe(unit, saved):
            if unit == 'nats-1':
                return {**saved, 'verified': True}
            return {**saved, 'loaded': False, 'running': False,
                    'disabled': unit in ('nats', 'nats-2', 'nats-3'), 'verified': True}
        return journal, hold, observe, marker

    def publish_nats_return(self, journal, transfer, **changes):
        outcomes = pathlib.Path(self.temp.name) / 'root-outcomes'
        outcomes.mkdir(mode=0o755, exist_ok=True)
        outcomes.chmod(0o755)
        outcomes_patch = patch('preservation_journal.NATS_ROOT_OUTCOMES', outcomes)
        uid_patch = patch('preservation_journal.NATS_ROOT_UID', os.getuid())
        outcomes_patch.start()
        uid_patch.start()
        self.addCleanup(outcomes_patch.stop)
        self.addCleanup(uid_patch.stop)
        receipt = {'transaction': transfer['root_transaction'], 'outcome': 'returned',
                   'ledger_sha256': 'f' * 64, 'user_journal_root': str(journal.root.resolve()),
                   'user_baseline_sha256': journal.records[0]['sha256'],
                   'user_transfer_sha256': transfer['sha256'], **changes}
        path = outcomes / (transfer['root_transaction'] + '.json')
        path.write_bytes(encoded(receipt))
        path.chmod(0o644)
        return path

    def test_nats_transfer_freezes_user_journal_before_root_outcome(self):
        journal, hold, observe, _ = self.prepared_nats_transfer()
        transaction = str(uuid.uuid4())
        record = journal.transfer_nats(transaction, hold, observe)
        self.assertEqual(record['root_transaction'], transaction)
        self.assertEqual(record['event'], 'nats-transfer-intent')
        before = len(journal.records)
        with self.assertRaisesRegex(Refused, 'transfer is open'):
            journal.append('failed', reason='late writer')
        with self.assertRaisesRegex(Refused, 'transfer is open'):
            journal.recover(lambda *_: self.fail('legacy restoration ran'),
                            lambda *_: self.fail('observation ran'),
                            lambda: self.fail('readiness ran'), hold=hold)
        self.assertEqual(len(journal.records), before)
        journal.close()
        with Journal(self.root, boot='boot-a', node_lock=self.node_lock) as reopened:
            self.assertEqual(reopened.nats_transfer_open()['sha256'], record['sha256'])
            with self.assertRaisesRegex(Refused, 'transfer is open'):
                reopened.append('recovery-started')

    def test_nats_transfer_refuses_cleared_listener_override_before_intent(self):
        journal, hold, observe, _ = self.prepared_nats_transfer()
        current = journal.check_entrypoints(forward=True)
        current['overrides']['gui']['ai.openclaw.mesh-deploy-listener'] = False
        before = len(journal.records)
        with patch('preservation_journal.capture_entrypoint_inventory', return_value=current):
            with self.assertRaisesRegex(Refused, 'disabled overrides changed'):
                journal.transfer_nats(str(uuid.uuid4()), hold, observe)
        self.assertEqual(len(journal.records), before)

    def test_nats_transfer_refuses_marker_and_uncertified_unit(self):
        journal, hold, observe, marker = self.prepared_nats_transfer()
        before = len(journal.records)
        marker.write_text('{}')
        with self.assertRaisesRegex(Refused, 'marker already exists'):
            journal.transfer_nats(str(uuid.uuid4()), hold, observe)
        marker.unlink()
        with self.assertRaisesRegex(Refused, 'writer is still active'):
            journal.transfer_nats(str(uuid.uuid4()), hold,
                                  lambda unit, saved: {**observe(unit, saved), 'running': unit == 'nats'})
        self.assertEqual(len(journal.records), before)

    def test_nats_transfer_refuses_weak_preexisting_stop_receipt(self):
        journal, hold, observe, _ = self.prepared_nats_transfer(weak_unit='nats-2')
        before = len(journal.records)
        with self.assertRaisesRegex(Refused, 'no verified persistent journal receipt: nats-2'):
            journal.transfer_nats(str(uuid.uuid4()), hold, observe)
        self.assertEqual(len(journal.records), before)

    def test_nats_transfer_refuses_receipts_without_listener_fence(self):
        prior = full_node_inventory()
        loaded = full_entrypoint_evidence(prior)
        with patch('preservation_journal.capture_entrypoint_inventory',
                   side_effect=lambda _: copy.deepcopy(loaded)), patch(
                   'preservation_journal.NATS_WRITER_MARKER', self.parent / 'writer-handoff.json'):
            with Journal(self.root, prior, node_lock=self.node_lock,
                         scope=FULL_NODE_SCOPE) as journal:
                hold = SimpleNamespace(journal=journal, check_forward=lambda: {'verified': True})
                anchor_hold(journal, hold)
                for unit in ('nats', 'nats-2', 'nats-3'):
                    loaded['loaded']['gui'].remove('ai.openclaw.' + unit)
                    journal.append('verified', intent=100 + len(journal.records), unit=unit,
                                   action='unload', evidence={'verified': True,
                                   'entrypoint_loaded': copy.deepcopy(loaded['loaded'])})
                def observe(unit, saved):
                    return {**saved, 'loaded': False, 'running': False, 'verified': True} \
                        if unit != 'nats-1' else {**saved, 'verified': True}
                before = len(journal.records)
                with self.assertRaisesRegex(Refused, 'listener must be verifiably disabled'):
                    journal.transfer_nats(str(uuid.uuid4()), hold, observe)
                self.assertEqual(len(journal.records), before)

    def test_nats_return_requires_bound_root_receipt_and_forces_restore_only(self):
        journal, hold, observe, marker = self.prepared_nats_transfer()
        transfer = journal.transfer_nats(str(uuid.uuid4()), hold, observe)
        receipt = self.publish_nats_return(journal, transfer)
        receipt.chmod(0o600)
        with self.assertRaisesRegex(Refused, 'outcome identity differs'):
            journal.complete_nats_outcome()
        receipt.chmod(0o644)
        self.publish_nats_return(journal, transfer, user_transfer_sha256='0' * 64)
        with self.assertRaisesRegex(Refused, 'does not bind'):
            journal.complete_nats_outcome()
        self.publish_nats_return(journal, transfer)
        marker.write_text('{}')
        with self.assertRaisesRegex(Refused, 'marker already exists'):
            journal.complete_nats_outcome()
        marker.unlink()
        closed = journal.complete_nats_outcome()
        self.assertEqual(closed['outcome'], 'returned')
        self.assertIsNone(journal.nats_transfer_open())
        marker.write_text('{}')
        with self.assertRaisesRegex(Refused, 'marker already exists'):
            journal.recover(lambda *_: self.fail('legacy restore ran behind marker'),
                            lambda *_: self.fail('observation ran behind marker'),
                            lambda: self.fail('readiness ran behind marker'), hold=hold)
        marker.unlink()
        with self.assertRaisesRegex(Refused, 'restore-only'):
            journal.mutate('nats', 'unload', lambda: None, lambda: {'verified': True}, hold=hold)
        journal.close()
        with Journal(self.root, boot='boot-a', node_lock=self.node_lock) as reopened:
            self.assertIsNone(reopened.nats_transfer_open())
            with self.assertRaisesRegex(Refused, 'restore-only'):
                reopened.require_forward()

    def test_nats_return_refuses_root_outcome_acl(self):
        journal, hold, observe, _ = self.prepared_nats_transfer()
        transfer = journal.transfer_nats(str(uuid.uuid4()), hold, observe)
        self.publish_nats_return(journal, transfer)
        def listed(argv, **_):
            entry = ' 0: user:operator allow read,write\n' if argv[-1].endswith('.json') else ''
            return subprocess.CompletedProcess(argv, 0, stdout='root outcome\n' + entry)
        with patch.object(preservation_journal.sys, 'platform', 'darwin'), patch.object(
                preservation_journal.subprocess, 'run', side_effect=listed):
            with self.assertRaisesRegex(Refused, 'outcome path has an ACL'):
                journal.complete_nats_outcome()
        self.assertIsNotNone(journal.nats_transfer_open())

    def test_production_transfer_refuses_before_durable_intent(self):
        journal, hold, observe, _ = self.prepared_nats_transfer()
        before = len(journal.records)
        with patch.object(preservation_journal.sys, 'platform', 'darwin'), patch(
                'preservation_journal.NATS_WRITER_MARKER',
                pathlib.Path('/private/var/db/openclaw-nats/writer-handoff.json')):
            with self.assertRaisesRegex(Refused, 'production NATS transfer awaits'):
                journal.transfer_nats(str(uuid.uuid4()), hold, observe)
        self.assertEqual(len(journal.records), before)

    def test_returned_legacy_restore_holds_shared_exclusion_and_checks_marker(self):
        lock = pathlib.Path(self.temp.name) / 'writer.lock'
        lock.write_bytes(b'nonce')
        lock.chmod(0o644)
        marker = pathlib.Path(self.temp.name) / 'writer-handoff.json'
        with patch('preservation_journal.NATS_LEGACY_LOCK', lock), patch(
                'preservation_journal.NATS_WRITER_MARKER', marker), patch(
                'preservation_journal.NATS_ROOT_UID', os.getuid()):
            with preservation_journal.nats_legacy_restore_guard():
                script = ('import fcntl,os,sys; '
                          'f=os.open(sys.argv[1],os.O_RDONLY); '
                          'fcntl.flock(f,fcntl.LOCK_EX|fcntl.LOCK_NB)')
                blocked = subprocess.run([sys.executable, '-c', script, str(lock)],
                                         capture_output=True, text=True)
                self.assertNotEqual(blocked.returncode, 0)
                self.assertIn('BlockingIOError', blocked.stderr)
            marker.write_text('{}')
            with self.assertRaisesRegex(Refused, 'marker already exists'):
                with preservation_journal.nats_legacy_restore_guard():
                    self.fail('legacy restoration entered behind marker')

    def test_absent_or_replaced_legacy_lock_is_checked(self):
        self.nats_lock.unlink()
        with preservation_journal.nats_legacy_restore_guard():
            pass
        with self.assertRaisesRegex(Refused, 'lock appeared during restoration'):
            with preservation_journal.nats_legacy_restore_guard():
                self.nats_lock.write_bytes(b'owned writer lock')
        self.nats_lock.chmod(0o644)
        with self.assertRaisesRegex(Refused, 'writer lock changed during restoration'):
            with preservation_journal.nats_legacy_restore_guard():
                self.nats_lock.unlink()
                self.nats_lock.write_bytes(b'replaced writer lock')
                self.nats_lock.chmod(0o644)

    def test_unscoped_recovery_without_legacy_lock_can_finish(self):
        with self.journal(PRIOR) as journal:
            self.nats_lock.unlink()
            result = journal.recover(lambda *_: self.fail('restoration entered'),
                                     lambda unit, _: {**PRIOR[unit], 'verified': True},
                                     lambda: {'verified': True})
            self.assertTrue(result['restored'], result)
            journal.resolve()

    def test_marker_before_resolve_row_refuses_without_terminal_commit(self):
        with self.journal(PRIOR) as journal:
            result = journal.recover(lambda *_: self.fail('restoration entered'),
                                     lambda unit, _: {**PRIOR[unit], 'verified': True},
                                     lambda: {'verified': True})
            self.assertTrue(result['restored'], result)
            original = journal.check_entrypoints
            def publish_before_row(*args, **kwargs):
                evidence = original(*args, **kwargs)
                self.nats_marker.write_text('{}')
                return evidence
            with patch.object(journal, 'check_entrypoints', side_effect=publish_before_row):
                with self.assertRaisesRegex(Refused, 'marker already exists'):
                    journal.resolve()
            self.assertEqual(journal.records[-1]['event'], 'recovery-finished')

    def test_resolve_receipt_failure_reports_committed_terminal_row(self):
        with self.journal(PRIOR) as journal:
            result = journal.recover(lambda *_: self.fail('restoration entered'),
                                     lambda unit, _: {**PRIOR[unit], 'verified': True},
                                     lambda: {'verified': True})
            self.assertTrue(result['restored'], result)
            with patch.object(journal, '_state', side_effect=Refused('receipt failed')):
                with self.assertRaisesRegex(CommittedRefusal, 'resolved committed at'):
                    journal.resolve()
            self.assertEqual(journal.records[-1]['event'], 'resolved')

    def test_marker_before_legacy_restart_prevents_the_restart(self):
        current = copy.deepcopy(PRIOR)
        current['nats'].update(loaded=False, running=False)
        with self.journal(PRIOR) as journal:
            original = journal.append
            restored = []
            def append(event, **data):
                row = original(event, **data)
                if event == 'restoration-intent' and data.get('unit') == 'nats':
                    self.nats_marker.write_text('{}')
                return row
            with patch.object(journal, 'append', side_effect=append):
                result = journal.recover(lambda unit, _: restored.append(unit),
                                         lambda unit, _: {**current[unit], 'verified': True},
                                         lambda: {'verified': True})
            self.assertEqual(restored, [])
            nats_error = next(error for error in result['errors'] if error['unit'] == 'nats')
            self.assertNotIn('after_commit', nats_error)

    def test_lock_appearing_before_legacy_restart_prevents_the_restart(self):
        current = copy.deepcopy(PRIOR)
        current['nats'].update(loaded=False, running=False)
        with self.journal(PRIOR) as journal:
            self.nats_lock.unlink()
            original = journal.append
            restored = []
            def append(event, **data):
                row = original(event, **data)
                if event == 'restoration-intent' and data.get('unit') == 'nats':
                    self.nats_lock.write_bytes(b'new root lock')
                return row
            with patch.object(journal, 'append', side_effect=append):
                result = journal.recover(lambda unit, _: restored.append(unit),
                                         lambda unit, _: {**current[unit], 'verified': True},
                                         lambda: {'verified': True})
            self.assertEqual(restored, [])
            nats_error = next(error for error in result['errors'] if error['unit'] == 'nats')
            self.assertNotIn('after_commit', nats_error)

    def test_marker_during_legacy_restart_reports_its_commit(self):
        current = copy.deepcopy(PRIOR)
        current['nats'].update(loaded=False, running=False)
        with self.journal(PRIOR) as journal:
            restored = []
            def restore(unit, prior):
                restored.append(unit)
                current[unit] = copy.deepcopy(prior)
                self.nats_marker.write_text('{}')
            result = journal.recover(restore,
                                     lambda unit, _: {**current[unit], 'verified': True},
                                     lambda: {'verified': True})
            self.assertEqual(restored, ['nats'])
            nats_error = next(error for error in result['errors'] if error['unit'] == 'nats')
            self.assertEqual(nats_error['after_commit'], 'restore')

    def test_legacy_restart_exception_still_reports_possible_commit(self):
        current = copy.deepcopy(PRIOR)
        current['nats'].update(loaded=False, running=False)
        with self.journal(PRIOR) as journal:
            def restore(unit, _):
                self.assertEqual(unit, 'nats')
                raise OSError('restart outcome unknown')
            result = journal.recover(restore,
                                     lambda unit, _: {**current[unit], 'verified': True},
                                     lambda: {'verified': True})
            nats_error = next(error for error in result['errors'] if error['unit'] == 'nats')
            self.assertEqual(nats_error['after_commit'], 'restore')

    def test_old_unscoped_nats_journal_respects_root_exclusion(self):
        with self.journal(PRIOR) as journal:
            self.nats_lock.write_bytes(b'owned lock')
            self.nats_lock.chmod(0o644)
            script = ('import fcntl,os,sys; '
                      'fd=os.open(sys.argv[1],os.O_RDONLY); '
                      'fcntl.flock(fd,fcntl.LOCK_EX); '
                      'print("locked",flush=True); sys.stdin.read()')
            holder = subprocess.Popen([sys.executable, '-c', script, str(self.nats_lock)],
                                      stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True)
            try:
                self.assertEqual(holder.stdout.readline().strip(), 'locked')
                observed = []
                restored = []
                def observe(unit, _):
                    observed.append(unit)
                    return {**PRIOR[unit], 'verified': True}
                with patch('preservation_journal.NATS_ROOT_UID', os.getuid()):
                    result = journal.recover(lambda unit, _: restored.append(unit),
                                             observe,
                                             lambda: self.fail('old journal certified readiness'))
                self.assertFalse(result['restored'])
                self.assertEqual(restored, [])
                self.assertFalse(set(observed) & set(NATS_TRANSFER_UNITS))
                self.assertIn('nats', [error['unit'] for error in result['errors']])
            finally:
                holder.stdin.close()
                self.assertEqual(holder.wait(timeout=5), 0)
                holder.stdout.close()

    def test_new_unscoped_journal_refuses_before_creation(self):
        with self.assertRaisesRegex(Refused, 'explicit protected scope'):
            Journal(self.root, PRIOR, node_lock=self.node_lock)
        self.assertFalse(self.root.exists())

    def test_full_scope_cannot_skip_entrypoint_preflight(self):
        with patch('preservation_journal.capture_entrypoint_inventory',
                   side_effect=Refused('unclassified loaded job')):
            with self.assertRaisesRegex(Refused, 'unclassified loaded job'):
                Journal(self.root, full_node_inventory(), node_lock=self.node_lock,
                        scope=FULL_NODE_SCOPE)
        self.assertFalse(self.root.exists())

    def test_full_scope_requires_held_overrides_in_both_user_views(self):
        prior = full_node_inventory()
        evidence = full_entrypoint_evidence(prior)
        evidence['overrides']['user']['ai.openclaw.nats-1'] = False
        with patch('preservation_journal.capture_entrypoint_inventory', return_value=evidence):
            with self.assertRaisesRegex(Refused, 'disabled overrides differ'):
                Journal(self.root, prior, node_lock=self.node_lock, scope=FULL_NODE_SCOPE)
        self.assertFalse(self.root.exists())

    def test_full_scope_refuses_explicit_system_enable_of_held_member(self):
        prior = full_node_inventory()
        evidence = full_entrypoint_evidence(prior)
        evidence['overrides']['system']['ai.openclaw.nats-1'] = False
        with patch('preservation_journal.capture_entrypoint_inventory', return_value=evidence):
            with self.assertRaisesRegex(Refused, 'disabled overrides differ'):
                Journal(self.root, prior, node_lock=self.node_lock, scope=FULL_NODE_SCOPE)
        self.assertFalse(self.root.exists())

    def test_full_scope_listener_stop_precedes_other_forward_mutations(self):
        prior = full_node_inventory()
        current = full_entrypoint_evidence(prior)
        calls = []
        with patch('preservation_journal.capture_entrypoint_inventory',
                   side_effect=lambda _: copy.deepcopy(current)):
            with Journal(self.root, prior, node_lock=self.node_lock,
                         scope=FULL_NODE_SCOPE) as journal:
                hold = SimpleNamespace(journal=journal, check_forward=lambda: {'verified': True})
                with self.assertRaisesRegex(Refused, 'listener must follow the verified execution hold'):
                    journal.mutate('mesh-deploy-listener', 'disable-and-unload',
                                   lambda: calls.append('early-listener'), listener_stop_evidence, hold=hold)
                journal.mutate('scheduler-heartbeat', 'close-execution-hold',
                               lambda: calls.append('hold'), lambda: {'verified': True}, hold=hold)
                before = len(journal.records)
                with self.assertRaisesRegex(Refused, 'listener must be verifiably disabled'):
                    journal.mutate('nats', 'disable-and-unload', lambda: calls.append('nats'),
                                   lambda: {'verified': True}, hold=hold)
                self.assertEqual(len(journal.records), before)
                self.assertEqual(calls, ['hold'])
                with self.assertRaisesRegex(Refused, 'listener must be verifiably disabled'):
                    journal.mutate('scheduler-heartbeat', 'disable-and-unload',
                                   lambda: calls.append('early-timer'), lambda: {'verified': True}, hold=hold)
                with self.assertRaisesRegex(Refused, 'listener must follow'):
                    journal.mutate('mesh-deploy-listener', 'stop', lambda: calls.append('listener'),
                                   listener_stop_evidence, hold=hold)
                self.assertEqual(len(journal.records), before)
                journal.mutate('mesh-deploy-listener', 'disable-and-unload',
                               lambda: fence_listener(current),
                               listener_stop_evidence, hold=hold)
                with self.assertRaisesRegex(Refused, 'listener must follow'):
                    journal.mutate('mesh-deploy-listener', 'disable-and-unload',
                                   lambda: calls.append('second-listener'), listener_stop_evidence, hold=hold)
                journal.mutate('nats', 'disable-and-unload',
                               lambda: fence_unit(current, 'nats'),
                               lambda: calls.append('nats') or listener_stop_evidence(), hold=hold)
                self.assertEqual(calls, ['hold', 'nats'])
                verified = [(row['unit'], row['action']) for row in journal.records
                            if row['event'] == 'verified']
                self.assertEqual(verified, [('scheduler-heartbeat', 'close-execution-hold'),
                                            ('mesh-deploy-listener', 'disable-and-unload'),
                                            ('nats', 'disable-and-unload')])

    def test_full_scope_refuses_a_plain_unload_after_listener_hold(self):
        prior = full_node_inventory()
        current = full_entrypoint_evidence(prior)
        with patch('preservation_journal.capture_entrypoint_inventory',
                   side_effect=lambda _: copy.deepcopy(current)):
            with Journal(self.root, prior, node_lock=self.node_lock,
                         scope=FULL_NODE_SCOPE) as journal:
                hold = SimpleNamespace(journal=journal, check_forward=lambda: {'verified': True})
                anchor_hold(journal, hold)
                journal.mutate('mesh-deploy-listener', 'disable-and-unload',
                               lambda: fence_listener(current), listener_stop_evidence, hold=hold)
                before = len(journal.records)
                with self.assertRaisesRegex(Refused, 'persistent disabled override'):
                    journal.mutate('nats', 'unload',
                                   lambda: self.fail('plain unload ran'),
                                   lambda: {'verified': True}, hold=hold)
                self.assertEqual(len(journal.records), before)

    def test_managed_stop_composes_with_full_node_listener_journal(self):
        prior = full_node_inventory()
        current = full_entrypoint_evidence(prior)
        disabled = {'value': False}
        steps = []
        with patch('preservation_journal.capture_entrypoint_inventory',
                   side_effect=lambda _: copy.deepcopy(current)):
            with Journal(self.root, prior, node_lock=self.node_lock,
                         scope=FULL_NODE_SCOPE) as journal:
                hold = SimpleNamespace(journal=journal, check_forward=lambda: {'verified': True})
                hold.mutate = lambda unit, action, apply, verify, failure_evidence: journal.mutate(
                    unit, action, apply, verify, failure_evidence=failure_evidence, hold=hold)
                anchor_hold(journal, hold)
                def disable():
                    self.assertEqual(journal.records[-1]['event'], 'intent')
                    self.assertEqual(journal.records[-1]['action'], 'disable-and-unload')
                    disabled['value'] = True
                    steps.append('disable')
                def bootout():
                    self.assertTrue(disabled['value'])
                    fence_listener(current)
                    steps.append('bootout')
                watch = SimpleNamespace(
                    service=SimpleNamespace(label='ai.openclaw.mesh-deploy-listener',
                                            disabled=lambda: disabled['value'], disable_for_hold=disable),
                    require_disabled=True, ready_for_intent=lambda: None, apply=bootout,
                    verify=lambda *_: listener_stop_evidence(), failure_evidence=lambda error: {})
                evidence = StopWatch.mutate(watch, journal, 'mesh-deploy-listener',
                                            lambda: True, lambda: True, hold=hold)
                self.assertTrue(evidence['disabled_override_verified'])
                self.assertTrue(journal.listener_fenced())
                self.assertEqual(steps, ['disable', 'bootout'])

    def test_full_scope_refuses_reenabled_listener_without_reload(self):
        prior = full_node_inventory()
        current = full_entrypoint_evidence(prior)
        with patch('preservation_journal.capture_entrypoint_inventory',
                   side_effect=lambda _: copy.deepcopy(current)):
            with Journal(self.root, prior, node_lock=self.node_lock,
                         scope=FULL_NODE_SCOPE) as journal:
                hold = SimpleNamespace(journal=journal, check_forward=lambda: {'verified': True})
                anchor_hold(journal, hold)
                journal.mutate('mesh-deploy-listener', 'disable-and-unload',
                               lambda: fence_listener(current), listener_stop_evidence, hold=hold)
                current['overrides']['gui']['ai.openclaw.mesh-deploy-listener'] = False
                before = len(journal.records)
                with self.assertRaisesRegex(Refused, 'disabled overrides changed'):
                    journal.mutate('workplan-viewer', 'disable-and-unload',
                                   lambda: self.fail('viewer stop ran'),
                                   lambda: {'verified': True}, hold=hold)
                self.assertEqual(len(journal.records), before)

    def test_full_scope_refuses_held_member_override_loss(self):
        prior = full_node_inventory()
        current = full_entrypoint_evidence(prior)
        with patch('preservation_journal.capture_entrypoint_inventory',
                   side_effect=lambda _: copy.deepcopy(current)):
            with Journal(self.root, prior, node_lock=self.node_lock,
                         scope=FULL_NODE_SCOPE) as journal:
                hold = SimpleNamespace(journal=journal, check_forward=lambda: {'verified': True})
                anchor_hold(journal, hold)
                journal.mutate('mesh-deploy-listener', 'disable-and-unload',
                               lambda: fence_listener(current), listener_stop_evidence, hold=hold)
                current['overrides']['user']['ai.openclaw.nats-1'] = False
                before = len(journal.records)
                with self.assertRaisesRegex(Refused, 'disabled overrides changed'):
                    journal.mutate('workplan-viewer', 'disable-and-unload',
                                   lambda: self.fail('viewer stop ran'),
                                   lambda: {'verified': True}, hold=hold)
                self.assertEqual(len(journal.records), before)

    def test_full_scope_refuses_unrelated_override_change(self):
        prior = full_node_inventory()
        current = full_entrypoint_evidence(prior)
        with patch('preservation_journal.capture_entrypoint_inventory',
                   side_effect=lambda _: copy.deepcopy(current)):
            with Journal(self.root, prior, node_lock=self.node_lock,
                         scope=FULL_NODE_SCOPE) as journal:
                hold = SimpleNamespace(journal=journal, check_forward=lambda: {'verified': True})
                anchor_hold(journal, hold)
                journal.mutate('mesh-deploy-listener', 'disable-and-unload',
                               lambda: fence_listener(current), listener_stop_evidence, hold=hold)
                current['overrides']['gui']['ai.openclaw.gateway'] = True
                before = len(journal.records)
                with self.assertRaisesRegex(Refused, 'disabled overrides changed'):
                    journal.mutate('workplan-viewer', 'disable-and-unload',
                                   lambda: self.fail('viewer stop ran'),
                                   lambda: {'verified': True}, hold=hold)
                self.assertEqual(len(journal.records), before)

    def test_full_scope_refuses_foreign_enabled_listener_override(self):
        prior = full_node_inventory()
        current = full_entrypoint_evidence(prior)
        with patch('preservation_journal.capture_entrypoint_inventory',
                   side_effect=lambda _: copy.deepcopy(current)):
            with Journal(self.root, prior, node_lock=self.node_lock,
                         scope=FULL_NODE_SCOPE) as journal:
                hold = SimpleNamespace(journal=journal, check_forward=lambda: {'verified': True})
                anchor_hold(journal, hold)
                def apply():
                    fence_listener(current)
                    current['overrides']['system']['ai.openclaw.mesh-deploy-listener'] = False
                with self.assertRaisesRegex(Refused, 'disabled overrides changed'):
                    journal.mutate('mesh-deploy-listener', 'disable-and-unload',
                                   apply, listener_stop_evidence, hold=hold)
                self.assertFalse(journal.listener_fenced())

    def test_full_scope_listener_stop_requires_persistent_process_proof(self):
        prior = full_node_inventory()
        current = full_entrypoint_evidence(prior)
        with patch('preservation_journal.capture_entrypoint_inventory',
                   side_effect=lambda _: copy.deepcopy(current)):
            with Journal(self.root, prior, node_lock=self.node_lock,
                         scope=FULL_NODE_SCOPE) as journal:
                hold = SimpleNamespace(journal=journal, check_forward=lambda: {'verified': True})
                anchor_hold(journal, hold)
                with self.assertRaisesRegex(Refused, 'lacks persistent unload and process proof'):
                    journal.mutate('mesh-deploy-listener', 'disable-and-unload',
                                   lambda: fence_listener(current),
                                   lambda: {'verified': True}, hold=hold)
                self.assertFalse(any(row['event'] == 'verified'
                                     and row.get('unit') == 'mesh-deploy-listener'
                                     for row in journal.records))
                with self.assertRaisesRegex(Refused, 'may only restore prior services'):
                    journal.mutate('nats', 'disable-and-unload', lambda: None,
                                   lambda: {'verified': True}, hold=hold)

    def test_full_scope_nats_stop_requires_persistent_process_proof(self):
        prior = full_node_inventory()
        current = full_entrypoint_evidence(prior)
        with patch('preservation_journal.capture_entrypoint_inventory',
                   side_effect=lambda _: copy.deepcopy(current)):
            with Journal(self.root, prior, node_lock=self.node_lock,
                         scope=FULL_NODE_SCOPE) as journal:
                hold = SimpleNamespace(journal=journal, check_forward=lambda: {'verified': True})
                anchor_hold(journal, hold)
                journal.mutate('mesh-deploy-listener', 'disable-and-unload',
                               lambda: fence_listener(current), listener_stop_evidence, hold=hold)
                with self.assertRaisesRegex(Refused, 'NATS stop lacks persistent unload and process proof'):
                    journal.mutate('nats', 'disable-and-unload',
                                   lambda: fence_unit(current, 'nats'),
                                   lambda: {'verified': True}, hold=hold)
                self.assertFalse(any(row['event'] == 'verified' and row.get('unit') == 'nats'
                                     for row in journal.records))

    def test_full_scope_listener_stop_rejects_incomplete_exit_proof(self):
        cases = [(key, {key: None}) for key in (
            'unit_unloaded', 'descendants_absent', 'disabled_override_verified',
            'connections_closed', 'listeners_absent')]
        cases += [
                ('override', {'disabled_override_verified': False}),
                ('bootout', {'bootout': {'returncode': 1, 'timed_out': False}}),
                ('timeout', {'bootout': {'returncode': 0, 'timed_out': True}}),
                ('termination', {'termination': {'signal': 9}})]
        for name, change in cases:
            with self.subTest(name=name):
                prior = full_node_inventory()
                current = full_entrypoint_evidence(prior)
                case_dir = self.parent / ('listener-' + name)
                case_dir.mkdir(mode=0o700)
                journals = case_dir / 'journals'
                journals.mkdir(mode=0o700)
                with patch('preservation_journal.capture_entrypoint_inventory',
                           side_effect=lambda _: copy.deepcopy(current)):
                    with Journal(journals / 'journal', prior, node_lock=case_dir / 'node.lock',
                                 scope=FULL_NODE_SCOPE) as journal:
                        hold = SimpleNamespace(journal=journal,
                                               check_forward=lambda: {'verified': True})
                        anchor_hold(journal, hold)
                        evidence = {**listener_stop_evidence(), **change}
                        with self.assertRaisesRegex(Refused, 'lacks persistent unload and process proof'):
                            journal.mutate('mesh-deploy-listener', 'disable-and-unload',
                                lambda: fence_listener(current),
                                lambda: evidence, hold=hold)
                        self.assertFalse(journal.listener_fenced())

    def test_full_scope_listener_stop_requires_gui_disabled_override(self):
        prior = full_node_inventory()
        current = full_entrypoint_evidence(prior)
        with patch('preservation_journal.capture_entrypoint_inventory',
                   side_effect=lambda _: copy.deepcopy(current)):
            with Journal(self.root, prior, node_lock=self.node_lock,
                         scope=FULL_NODE_SCOPE) as journal:
                hold = SimpleNamespace(journal=journal, check_forward=lambda: {'verified': True})
                anchor_hold(journal, hold)
                with self.assertRaisesRegex(Refused, 'disabled overrides changed'):
                    journal.mutate('mesh-deploy-listener', 'disable-and-unload',
                                   lambda: current['loaded']['gui'].remove(
                                       'ai.openclaw.mesh-deploy-listener'),
                                   listener_stop_evidence, hold=hold)
                self.assertFalse(journal.listener_fenced())

    def test_full_scope_listener_stop_requires_user_disabled_override(self):
        prior = full_node_inventory()
        current = full_entrypoint_evidence(prior)
        with patch('preservation_journal.capture_entrypoint_inventory',
                   side_effect=lambda _: copy.deepcopy(current)):
            with Journal(self.root, prior, node_lock=self.node_lock,
                         scope=FULL_NODE_SCOPE) as journal:
                hold = SimpleNamespace(journal=journal, check_forward=lambda: {'verified': True})
                anchor_hold(journal, hold)
                def gui_only_stop():
                    current['loaded']['gui'].remove('ai.openclaw.mesh-deploy-listener')
                    current['overrides']['gui']['ai.openclaw.mesh-deploy-listener'] = True
                with self.assertRaisesRegex(Refused, 'disabled overrides changed'):
                    journal.mutate('mesh-deploy-listener', 'disable-and-unload',
                                   gui_only_stop, listener_stop_evidence, hold=hold)
                self.assertFalse(journal.listener_fenced())

    def test_full_scope_listener_stop_requires_gui_override_when_user_disabled(self):
        prior = full_node_inventory()
        current = full_entrypoint_evidence(prior)
        with patch('preservation_journal.capture_entrypoint_inventory',
                   side_effect=lambda _: copy.deepcopy(current)):
            with Journal(self.root, prior, node_lock=self.node_lock,
                         scope=FULL_NODE_SCOPE) as journal:
                hold = SimpleNamespace(journal=journal, check_forward=lambda: {'verified': True})
                anchor_hold(journal, hold)
                def user_only_stop():
                    current['loaded']['gui'].remove('ai.openclaw.mesh-deploy-listener')
                    current['overrides']['user']['ai.openclaw.mesh-deploy-listener'] = True
                with self.assertRaisesRegex(Refused, 'disabled overrides changed'):
                    journal.mutate('mesh-deploy-listener', 'disable-and-unload',
                                   user_only_stop, listener_stop_evidence, hold=hold)
                self.assertFalse(journal.listener_fenced())

    def test_full_scope_rechecks_durable_listener_proof_before_nats(self):
        prior = full_node_inventory()
        current = full_entrypoint_evidence(prior)
        calls = []
        with patch('preservation_journal.capture_entrypoint_inventory',
                   side_effect=lambda _: copy.deepcopy(current)):
            with Journal(self.root, prior, node_lock=self.node_lock,
                         scope=FULL_NODE_SCOPE) as journal:
                hold = SimpleNamespace(journal=journal, check_forward=lambda: {'verified': True})
                anchor_hold(journal, hold)
                intent = journal.append('intent', unit='mesh-deploy-listener',
                                        action='disable-and-unload')
                fence_listener(current)
                proof = listener_stop_evidence()
                del proof['connections_closed']
                journal.append('verified', intent=intent['sequence'], unit='mesh-deploy-listener',
                               action='disable-and-unload', evidence={**proof,
                               'entrypoint_loaded': copy.deepcopy(current['loaded']),
                               'entrypoint_overrides': copy.deepcopy(current['overrides'])})
                before = len(journal.records)
                with self.assertRaisesRegex(Refused, 'listener must be verifiably disabled'):
                    journal.mutate('nats', 'disable-and-unload', lambda: calls.append('nats'),
                                   lambda: {'verified': True}, hold=hold)
                self.assertEqual(len(journal.records), before)
                self.assertEqual(calls, [])

    def test_full_scope_listener_proof_before_its_intent_refuses(self):
        prior = full_node_inventory()
        current = full_entrypoint_evidence(prior)
        with patch('preservation_journal.capture_entrypoint_inventory',
                   side_effect=lambda _: copy.deepcopy(current)):
            with Journal(self.root, prior, node_lock=self.node_lock,
                         scope=FULL_NODE_SCOPE) as journal:
                hold = SimpleNamespace(journal=journal, check_forward=lambda: {'verified': True})
                anchor_hold(journal, hold)
                fence_listener(current)
                future_intent = len(journal.records) + 1
                journal.append('verified', intent=future_intent,
                               unit='mesh-deploy-listener', action='disable-and-unload',
                               evidence={**listener_stop_evidence(),
                               'entrypoint_loaded': copy.deepcopy(current['loaded']),
                               'entrypoint_overrides': copy.deepcopy(current['overrides'])})
                intent = journal.append('intent', unit='mesh-deploy-listener',
                                        action='disable-and-unload')
                self.assertEqual(intent['sequence'], future_intent)
                before = len(journal.records)
                with self.assertRaisesRegex(Refused, 'listener must be verifiably disabled'):
                    journal.mutate('nats', 'disable-and-unload', lambda: self.fail('NATS unload ran'),
                                   lambda: {'verified': True}, hold=hold)
                self.assertEqual(len(journal.records), before)

    def test_full_scope_rechecks_entrypoints_but_restores_known_units_after_drift(self):
        prior = full_node_inventory()
        with patch('preservation_journal.capture_entrypoint_inventory',
                   return_value=full_entrypoint_evidence(prior)):
            with Journal(self.root, prior, node_lock=self.node_lock,
                         scope=FULL_NODE_SCOPE) as journal:
                with patch('preservation_journal.capture_entrypoint_inventory',
                           side_effect=Refused('unclassified loaded job')):
                    with self.assertRaisesRegex(Refused, 'unclassified loaded job'):
                        journal.mutate('gateway', 'stop',
                                       lambda: self.fail('mutation reached'),
                                       lambda: self.fail('verification reached'))
                    current = copy.deepcopy(prior)
                    current['gateway']['loaded'] = False
                    current['gateway']['running'] = False
                    restored = []
                    def restore(unit, saved):
                        restored.append(unit)
                        current[unit] = copy.deepcopy(saved)
                    hold = SimpleNamespace(journal=journal,
                        prepare=lambda *_: None, before_restore=lambda: None,
                        check_closed=lambda: None)
                    result = journal.recover(restore,
                        lambda unit, _: {**current[unit], 'verified': True},
                        lambda: {'verified': True}, hold=hold,
                        deploy_fence=lambda: {'verified': True})
                self.assertIn('gateway', restored)
                self.assertFalse(result['restored'])
                self.assertIn('entrypoints', [row['unit'] for row in result['errors']])
                self.assertEqual(journal.records[-1]['event'], 'recovery-finished')

    def test_full_scope_refuses_all_restores_when_member_one_hold_changed(self):
        prior = full_node_inventory()
        current = copy.deepcopy(prior)
        current['nats-1'].update(loaded=True, running=True, disabled=False)
        current['nats-2'].update(loaded=False, running=False)
        with patch('preservation_journal.capture_entrypoint_inventory',
                   return_value=full_entrypoint_evidence(prior)):
            with Journal(self.root, prior, node_lock=self.node_lock,
                         scope=FULL_NODE_SCOPE) as journal:
                hold = SimpleNamespace(journal=journal, prepare=lambda *_: None)
                result = journal.recover(lambda *_: self.fail('restore preceded member-1 check'),
                    lambda unit, _: {**current[unit], 'verified': True},
                    lambda: {'verified': True}, hold=hold,
                    deploy_fence=lambda: {'verified': True})
                self.assertFalse(result['restored'])
                self.assertIn('nats-1', [row['unit'] for row in result['errors']])
                self.assertFalse(any(row['event'] == 'restoration-intent' for row in journal.records))

    def test_full_scope_refuses_held_unit_changed_during_restoration(self):
        for held_unit in ('nats-1', 'federation-tick'):
            with self.subTest(held_unit=held_unit):
                prior = full_node_inventory()
                current = copy.deepcopy(prior)
                current['nats-2'].update(loaded=False, running=False)
                current['mesh-deploy-listener'].update(loaded=False, running=False)
                restored = []
                def restore(unit, wanted):
                    restored.append(unit)
                    current[unit] = copy.deepcopy(wanted)
                    if unit == 'nats-2':
                        current[held_unit].update(loaded=True, running=True, disabled=False)
                case_root = pathlib.Path(self.temp.name) / ('case-' + held_unit)
                with patch('preservation_journal.capture_entrypoint_inventory',
                           return_value=full_entrypoint_evidence(prior)):
                    with Journal(case_root / 'journals' / 'journal', prior,
                                 node_lock=case_root / 'node.lock',
                                 scope=FULL_NODE_SCOPE) as journal:
                        hold = SimpleNamespace(journal=journal, prepare=lambda *_: None,
                            before_restore=lambda: None, check_closed=lambda: None,
                            complete=lambda *_: self.fail('hold reopened after held unit changed'))
                        result = journal.recover(restore,
                            lambda unit, _: {**current[unit], 'verified': True},
                            lambda: {'verified': True}, hold=hold,
                            deploy_fence=lambda: {'verified': True})
                        self.assertEqual(restored, ['nats-2'])
                        self.assertFalse(result['restored'])
                        self.assertIn(held_unit, [row['unit'] for row in result['errors']])
                        self.assertFalse(any(row['event'] == 'execution-hold-restored'
                                             for row in journal.records))

    def test_full_scope_does_not_release_deploy_listener_after_gateway_failure(self):
        prior = full_node_inventory()
        current = copy.deepcopy(prior)
        for unit in ('gateway', 'mesh-deploy-listener'):
            current[unit].update(loaded=False, running=False)
        restored = []
        def restore(unit, wanted):
            restored.append(unit)
            if unit == 'gateway':
                raise Refused('gateway restoration failed')
            current[unit] = copy.deepcopy(wanted)
        with patch('preservation_journal.capture_entrypoint_inventory',
                   return_value=full_entrypoint_evidence(prior)):
            with Journal(self.root, prior, node_lock=self.node_lock,
                         scope=FULL_NODE_SCOPE) as journal:
                hold = SimpleNamespace(journal=journal, prepare=lambda *_: None,
                    before_restore=lambda: None, check_closed=lambda: None)
                result = journal.recover(restore,
                    lambda unit, _: {**current[unit], 'verified': True},
                    lambda: {'verified': True}, hold=hold,
                    deploy_fence=lambda: {'verified': True})
                self.assertEqual(restored, ['gateway'])
                self.assertFalse(result['restored'])
                self.assertIn('mesh-deploy-listener', [row['unit'] for row in result['errors']])

    def test_full_scope_listener_release_requires_final_state_and_deploy_fence(self):
        for failed_gate in ('final-state', 'deploy-fence'):
            with self.subTest(failed_gate=failed_gate):
                prior = full_node_inventory()
                current = copy.deepcopy(prior)
                baseline = full_entrypoint_evidence(prior)
                def entrypoints(_):
                    result = copy.deepcopy(baseline)
                    result['loaded']['gui'] = sorted('ai.openclaw.' + unit for unit, state in current.items()
                                                     if state['loaded'])
                    return result
                root = pathlib.Path(self.temp.name) / ('listener-' + failed_gate)
                with patch('preservation_journal.capture_entrypoint_inventory', side_effect=entrypoints):
                    with Journal(root / 'journals' / 'journal', prior,
                                 node_lock=root / 'node.lock', scope=FULL_NODE_SCOPE) as journal:
                        current['mesh-deploy-listener'].update(loaded=False, running=False)
                        restored = []
                        fence_calls = []
                        complete_calls = []
                        hold = SimpleNamespace(journal=journal, prepare=lambda *_: None,
                            before_restore=lambda: None, check_closed=lambda: None,
                            complete=lambda *_: complete_calls.append(True) or {'verified': True})
                        def restore(unit, wanted):
                            restored.append(unit)
                            current[unit] = copy.deepcopy(wanted)
                        def fence():
                            fence_calls.append(True)
                            return {'verified': failed_gate != 'deploy-fence'}
                        result = journal.recover(restore,
                            lambda unit, _: {**current[unit], 'verified': True},
                            lambda: {'verified': failed_gate != 'final-state'},
                            hold=hold, deploy_fence=fence)
                        self.assertFalse(result['restored'])
                        self.assertEqual(restored, [])
                        self.assertEqual(fence_calls, [] if failed_gate == 'final-state' else [True])
                        self.assertEqual(complete_calls, [])
                        self.assertFalse(any(row['event'] == 'listener-release-verified'
                                             for row in journal.records))
                        self.assertFalse(any(row['event'] == 'execution-hold-restored'
                                             for row in journal.records))

    def test_full_scope_listener_release_is_durable_before_restore(self):
        prior = full_node_inventory()
        current = copy.deepcopy(prior)
        baseline = full_entrypoint_evidence(prior)
        def entrypoints(_):
            result = copy.deepcopy(baseline)
            result['loaded']['gui'] = sorted('ai.openclaw.' + unit for unit, state in current.items()
                                             if state['loaded'])
            result['overrides']['gui'] = {'ai.openclaw.' + unit: True if state['disabled'] else None
                                          for unit, state in current.items()}
            result['overrides']['user'] = copy.deepcopy(result['overrides']['gui'])
            return result
        with patch('preservation_journal.capture_entrypoint_inventory', side_effect=entrypoints):
            with Journal(self.root, prior, node_lock=self.node_lock,
                         scope=FULL_NODE_SCOPE) as journal:
                current['mesh-deploy-listener'].update(loaded=False, running=False)
                restored = []
                script = ('import fcntl,os,sys; '
                          'fd=os.open(sys.argv[1],os.O_RDONLY); '
                          'fcntl.flock(fd,fcntl.LOCK_EX|fcntl.LOCK_NB)')
                def assert_guarded():
                    probe = subprocess.run([sys.executable, '-c', script, str(self.nats_lock)],
                                           capture_output=True, text=True, timeout=5)
                    self.assertNotEqual(probe.returncode, 0)
                    self.assertIn('BlockingIOError', probe.stderr)
                hold = SimpleNamespace(journal=journal, prepare=lambda *_: None,
                    before_restore=lambda: None, check_closed=lambda: None,
                    complete=lambda *_: {'verified': True})
                def restore(unit, wanted):
                    self.assertEqual(unit, 'mesh-deploy-listener')
                    self.assertTrue(any(row['event'] == 'listener-release-verified'
                                        for row in journal.records))
                    assert_guarded()
                    restored.append(unit)
                    current[unit] = copy.deepcopy(wanted)
                def fence():
                    assert_guarded()
                    return {'verified': True}
                result = journal.recover(restore,
                    lambda unit, _: {**current[unit], 'verified': True},
                    lambda: {'verified': True}, hold=hold,
                    deploy_fence=fence)
                self.assertTrue(result['restored'], result)
                self.assertEqual(restored, ['mesh-deploy-listener'])
                rows = [(row['event'], row.get('unit')) for row in journal.records]
                self.assertLess(rows.index(('listener-release-verified', None)),
                                rows.index(('restoration-intent', 'mesh-deploy-listener')))

    def test_full_scope_listener_precommit_refuses_new_root_marker(self):
        prior = full_node_inventory()
        current = copy.deepcopy(prior)
        baseline = full_entrypoint_evidence(prior)
        def entrypoints(_):
            result = copy.deepcopy(baseline)
            result['loaded']['gui'] = sorted('ai.openclaw.' + unit for unit, state in current.items()
                                             if state['loaded'])
            return result
        with patch('preservation_journal.capture_entrypoint_inventory', side_effect=entrypoints):
            with Journal(self.root, prior, node_lock=self.node_lock,
                         scope=FULL_NODE_SCOPE) as journal:
                current['mesh-deploy-listener'].update(loaded=False, running=False)
                restored = []
                hold = SimpleNamespace(journal=journal, prepare=lambda *_: None,
                    before_restore=lambda: None, check_closed=lambda: None,
                    complete=lambda *_: {'verified': True})
                def fence():
                    self.nats_marker.write_text('owned root marker')
                    return {'verified': True}
                result = journal.recover(lambda unit, _: restored.append(unit),
                    lambda unit, _: {**current[unit], 'verified': True},
                    lambda: {'verified': True}, hold=hold, deploy_fence=fence)
                self.assertFalse(result['restored'])
                self.assertEqual(restored, [])
                self.assertTrue(any(row['event'] == 'listener-release-verified'
                                    for row in journal.records))
                self.assertFalse(any(row['event'] == 'recovery-verified'
                                     and row.get('unit') == 'mesh-deploy-listener'
                                     for row in journal.records))

    def test_full_scope_listener_release_write_failure_prevents_restore(self):
        prior = full_node_inventory()
        current = copy.deepcopy(prior)
        baseline = full_entrypoint_evidence(prior)
        def entrypoints(_):
            result = copy.deepcopy(baseline)
            result['loaded']['gui'] = sorted('ai.openclaw.' + unit for unit, state in current.items()
                                             if state['loaded'])
            return result
        with patch('preservation_journal.capture_entrypoint_inventory', side_effect=entrypoints):
            with Journal(self.root, prior, node_lock=self.node_lock,
                         scope=FULL_NODE_SCOPE) as journal:
                current['mesh-deploy-listener'].update(loaded=False, running=False)
                restored = []
                hold = SimpleNamespace(journal=journal, prepare=lambda *_: None,
                    before_restore=lambda: None, check_closed=lambda: None)
                original = journal.append
                def append(event, **data):
                    if event == 'listener-release-verified':
                        raise OSError('owned receipt write failure')
                    return original(event, **data)
                with patch.object(journal, 'append', side_effect=append):
                    with self.assertRaises(Refused):
                        journal.recover(lambda unit, _: restored.append(unit),
                            lambda unit, _: {**current[unit], 'verified': True},
                            lambda: {'verified': True}, hold=hold,
                            deploy_fence=lambda: {'verified': True})
                self.assertEqual(restored, [])
                self.assertFalse(any(row['event'] == 'restoration-intent'
                                     and row.get('unit') == 'mesh-deploy-listener'
                                     for row in journal.records))

    def test_full_scope_refuses_restarted_nats_before_any_restore(self):
        prior = full_node_inventory()
        current = copy.deepcopy(prior)
        baseline = full_entrypoint_evidence(prior)
        def entrypoints(_):
            result = copy.deepcopy(baseline)
            result['loaded']['gui'] = sorted('ai.openclaw.' + unit for unit, state in current.items()
                                             if state['loaded'])
            result['overrides']['gui'] = {'ai.openclaw.' + unit: True if state['disabled'] else None
                                          for unit, state in current.items()}
            result['overrides']['user'] = copy.deepcopy(result['overrides']['gui'])
            return result
        with patch('preservation_journal.capture_entrypoint_inventory', side_effect=entrypoints):
            with Journal(self.root, prior, node_lock=self.node_lock,
                         scope=FULL_NODE_SCOPE) as journal:
                hold = SimpleNamespace(journal=journal, check_forward=lambda: None,
                    prepare=lambda *_: self.fail('hold preparation ran'))
                anchor_hold(journal, hold)
                journal.mutate('mesh-deploy-listener', 'disable-and-unload',
                    lambda: current['mesh-deploy-listener'].update(loaded=False, running=False, disabled=True),
                    listener_stop_evidence, hold=hold)
                journal.mutate('nats', 'disable-and-unload',
                    lambda: current['nats'].update(loaded=False, running=False, disabled=True),
                    listener_stop_evidence, hold=hold)
                current['nats'] = copy.deepcopy(prior['nats'])
                before = len(journal.records)
                restored = []
                with self.assertRaisesRegex(Refused, 'stopped unit state changed before verified recovery: nats'):
                    journal.recover(lambda unit, _: restored.append(unit),
                        lambda unit, _: {**current[unit], 'verified': True},
                        lambda: {'verified': True}, hold=hold,
                        deploy_fence=lambda: {'verified': True})
                self.assertEqual(restored, [])
                self.assertEqual(len(journal.records), before)

    def test_full_scope_refuses_gateway_restart_during_hold_prepare(self):
        prior = full_node_inventory()
        current = copy.deepcopy(prior)
        baseline = full_entrypoint_evidence(prior)
        def entrypoints(_):
            result = copy.deepcopy(baseline)
            result['loaded']['gui'] = sorted('ai.openclaw.' + unit for unit, state in current.items()
                                             if state['loaded'])
            result['overrides']['gui'] = {'ai.openclaw.' + unit: True if state['disabled'] else None
                                          for unit, state in current.items()}
            result['overrides']['user'] = copy.deepcopy(result['overrides']['gui'])
            return result
        with patch('preservation_journal.capture_entrypoint_inventory', side_effect=entrypoints):
            with Journal(self.root, prior, node_lock=self.node_lock,
                         scope=FULL_NODE_SCOPE) as journal:
                hold = SimpleNamespace(journal=journal, check_forward=lambda: None,
                    prepare=lambda *_: current['gateway'].update(loaded=True, running=True, disabled=False))
                anchor_hold(journal, hold)
                journal.mutate('mesh-deploy-listener', 'disable-and-unload',
                    lambda: current['mesh-deploy-listener'].update(loaded=False, running=False, disabled=True),
                    listener_stop_evidence, hold=hold)
                journal.mutate('gateway', 'disable-and-unload',
                    lambda: current['gateway'].update(loaded=False, running=False, disabled=True),
                    lambda: {'verified': True}, hold=hold)
                before = len(journal.records)
                before_state = copy.deepcopy(journal.active)
                with self.assertRaisesRegex(Refused, 'stopped unit state changed before verified recovery: gateway'):
                    journal.recover(lambda *_: self.fail('restore ran'),
                        lambda unit, _: {**current[unit], 'verified': True},
                        lambda: self.fail('final check ran'), hold=hold,
                        deploy_fence=lambda: self.fail('deploy fence ran'))
                self.assertEqual(len(journal.records), before)
                self.assertEqual(journal.active, before_state)

    def test_full_scope_refuses_cleared_stop_override_before_recovery(self):
        prior = full_node_inventory()
        current = copy.deepcopy(prior)
        baseline = full_entrypoint_evidence(prior)
        def entrypoints(_):
            result = copy.deepcopy(baseline)
            result['loaded']['gui'] = sorted('ai.openclaw.' + unit for unit, state in current.items()
                                             if state['loaded'])
            result['overrides']['gui'] = {'ai.openclaw.' + unit: True if state['disabled'] else None
                                          for unit, state in current.items()}
            result['overrides']['user'] = copy.deepcopy(result['overrides']['gui'])
            return result
        with patch('preservation_journal.capture_entrypoint_inventory', side_effect=entrypoints):
            with Journal(self.root, prior, node_lock=self.node_lock,
                         scope=FULL_NODE_SCOPE) as journal:
                hold = SimpleNamespace(journal=journal, check_forward=lambda: None,
                    prepare=lambda *_: self.fail('hold prepared'))
                anchor_hold(journal, hold)
                journal.mutate('mesh-deploy-listener', 'disable-and-unload',
                    lambda: current['mesh-deploy-listener'].update(loaded=False, running=False, disabled=True),
                    listener_stop_evidence, hold=hold)
                journal.mutate('gateway', 'disable-and-unload',
                    lambda: current['gateway'].update(loaded=False, running=False, disabled=True),
                    lambda: {'verified': True}, hold=hold)
                current['gateway']['disabled'] = False
                before = len(journal.records)
                with self.assertRaisesRegex(Refused, 'stopped unit state changed before verified recovery: gateway'):
                    journal.recover(lambda *_: self.fail('restore ran'),
                        lambda unit, _: {**current[unit], 'verified': True},
                        lambda: self.fail('final check ran'), hold=hold,
                        deploy_fence=lambda: self.fail('deploy fence ran'))
                self.assertEqual(len(journal.records), before)

    def test_full_scope_refuses_gateway_restart_during_recovery_loop(self):
        prior = full_node_inventory()
        current = copy.deepcopy(prior)
        baseline = full_entrypoint_evidence(prior)
        def entrypoints(_):
            result = copy.deepcopy(baseline)
            result['loaded']['gui'] = sorted('ai.openclaw.' + unit for unit, state in current.items()
                                             if state['loaded'])
            result['overrides']['gui'] = {'ai.openclaw.' + unit: True if state['disabled'] else None
                                          for unit, state in current.items()}
            result['overrides']['user'] = copy.deepcopy(result['overrides']['gui'])
            return result
        with patch('preservation_journal.capture_entrypoint_inventory', side_effect=entrypoints):
            with Journal(self.root, prior, node_lock=self.node_lock,
                         scope=FULL_NODE_SCOPE) as journal:
                hold = SimpleNamespace(journal=journal, check_forward=lambda: None,
                    prepare=lambda *_: None, before_restore=lambda: None,
                    check_closed=lambda: None, complete=lambda *_: self.fail('hold reopened'))
                anchor_hold(journal, hold)
                journal.mutate('mesh-deploy-listener', 'disable-and-unload',
                    lambda: current['mesh-deploy-listener'].update(loaded=False, running=False, disabled=True),
                    listener_stop_evidence, hold=hold)
                journal.mutate('gateway', 'disable-and-unload',
                    lambda: current['gateway'].update(loaded=False, running=False, disabled=True),
                    lambda: {'verified': True}, hold=hold)
                journal.mutate('workplan-viewer', 'disable-and-unload',
                    lambda: current['workplan-viewer'].update(loaded=False, running=False, disabled=True),
                    lambda: {'verified': True}, hold=hold)
                def observe(unit, _):
                    if unit == 'health-watch':
                        current['gateway'] = copy.deepcopy(prior['gateway'])
                    return {**current[unit], 'verified': True}
                restored = []
                result = journal.recover(lambda unit, _: restored.append(unit), observe,
                    lambda: {'verified': True}, hold=hold,
                    deploy_fence=lambda: self.fail('deploy fence ran'))
                self.assertFalse(result['restored'])
                self.assertIn('gateway', [row['unit'] for row in result['errors']])
                self.assertEqual(restored, [])
                self.assertFalse(any(row['event'] == 'already-restored'
                                     and row.get('unit') == 'gateway' for row in journal.records))

    def test_full_scope_stops_recovery_when_a_stopped_unit_becomes_unobservable(self):
        prior = full_node_inventory()
        current = copy.deepcopy(prior)
        baseline = full_entrypoint_evidence(prior)
        def entrypoints(_):
            result = copy.deepcopy(baseline)
            result['loaded']['gui'] = sorted('ai.openclaw.' + unit for unit, state in current.items()
                                             if state['loaded'])
            result['overrides']['gui'] = {'ai.openclaw.' + unit: True if state['disabled'] else None
                                          for unit, state in current.items()}
            result['overrides']['user'] = copy.deepcopy(result['overrides']['gui'])
            return result
        with patch('preservation_journal.capture_entrypoint_inventory', side_effect=entrypoints):
            with Journal(self.root, prior, node_lock=self.node_lock,
                         scope=FULL_NODE_SCOPE) as journal:
                hold = SimpleNamespace(journal=journal, check_forward=lambda: None,
                    prepare=lambda *_: None, before_restore=lambda: None,
                    check_closed=lambda: None, complete=lambda *_: self.fail('hold reopened'))
                anchor_hold(journal, hold)
                journal.mutate('mesh-deploy-listener', 'disable-and-unload',
                    lambda: current['mesh-deploy-listener'].update(loaded=False, running=False, disabled=True),
                    listener_stop_evidence, hold=hold)
                for unit in ('gateway', 'workplan-viewer'):
                    journal.mutate(unit, 'disable-and-unload',
                        lambda unit=unit: current[unit].update(loaded=False, running=False, disabled=True),
                        lambda: {'verified': True}, hold=hold)
                def observe(unit, _):
                    if unit == 'health-watch':
                        current['gateway']['unobservable'] = True
                    if unit == 'gateway' and current[unit].get('unobservable'):
                        raise Refused('owned job became unobservable')
                    return {**current[unit], 'verified': True}
                restored = []
                result = journal.recover(lambda unit, _: restored.append(unit), observe,
                    lambda: {'verified': True}, hold=hold,
                    deploy_fence=lambda: self.fail('deploy fence ran'))
                self.assertFalse(result['restored'])
                self.assertIn('gateway', [row['unit'] for row in result['errors']])
                self.assertNotIn('workplan-viewer', restored)

    def test_full_scope_refuses_listener_restart_before_release(self):
        prior = full_node_inventory()
        current = copy.deepcopy(prior)
        baseline = full_entrypoint_evidence(prior)
        def entrypoints(_):
            result = copy.deepcopy(baseline)
            result['loaded']['gui'] = sorted('ai.openclaw.' + unit for unit, state in current.items()
                                             if state['loaded'])
            result['overrides']['gui'] = {'ai.openclaw.' + unit: True if state['disabled'] else None
                                          for unit, state in current.items()}
            result['overrides']['user'] = copy.deepcopy(result['overrides']['gui'])
            return result
        with patch('preservation_journal.capture_entrypoint_inventory', side_effect=entrypoints):
            with Journal(self.root, prior, node_lock=self.node_lock,
                         scope=FULL_NODE_SCOPE) as journal:
                hold = SimpleNamespace(journal=journal, check_forward=lambda: None,
                    prepare=lambda *_: None, complete=lambda *_: self.fail('hold reopened'))
                anchor_hold(journal, hold)
                journal.mutate('mesh-deploy-listener', 'disable-and-unload',
                    lambda: current['mesh-deploy-listener'].update(loaded=False, running=False, disabled=True),
                    listener_stop_evidence, hold=hold)
                current['mesh-deploy-listener'] = copy.deepcopy(prior['mesh-deploy-listener'])
                restored = []
                fence_calls = []
                def fence():
                    fence_calls.append(True)
                    return {'verified': True}
                before = len(journal.records)
                with self.assertRaisesRegex(Refused, 'stopped unit state changed before verified recovery'):
                    journal.recover(lambda unit, _: restored.append(unit),
                        lambda unit, _: {**current[unit], 'verified': True},
                        lambda: {'verified': True}, hold=hold,
                        deploy_fence=fence)
                self.assertEqual(restored, [])
                self.assertEqual(fence_calls, [])
                self.assertEqual(len(journal.records), before)
                self.assertFalse(any(row['event'] == 'listener-release-verified'
                                     for row in journal.records))

    def test_full_scope_refuses_listener_restart_after_unfinished_release(self):
        prior = full_node_inventory()
        current = copy.deepcopy(prior)
        baseline = full_entrypoint_evidence(prior)
        def entrypoints(_):
            result = copy.deepcopy(baseline)
            result['loaded']['gui'] = sorted('ai.openclaw.' + unit for unit, state in current.items()
                                             if state['loaded'])
            result['overrides']['gui'] = {'ai.openclaw.' + unit: True if state['disabled'] else None
                                          for unit, state in current.items()}
            result['overrides']['user'] = copy.deepcopy(result['overrides']['gui'])
            return result
        with patch('preservation_journal.capture_entrypoint_inventory', side_effect=entrypoints):
            with Journal(self.root, prior, node_lock=self.node_lock,
                         scope=FULL_NODE_SCOPE) as journal:
                hold = SimpleNamespace(journal=journal, check_forward=lambda: None,
                    prepare=lambda *_: None, before_restore=lambda: None,
                    check_closed=lambda: None, complete=lambda *_: {'verified': True})
                anchor_hold(journal, hold)
                journal.mutate('mesh-deploy-listener', 'disable-and-unload',
                    lambda: current['mesh-deploy-listener'].update(loaded=False, running=False, disabled=True),
                    listener_stop_evidence, hold=hold)
                journal.append('listener-release-verified', evidence={'verified': True})
                current['mesh-deploy-listener'] = copy.deepcopy(prior['mesh-deploy-listener'])
                restored = []
                fence_calls = []
                before = len(journal.records)
                with self.assertRaisesRegex(Refused, 'stopped unit state changed before verified recovery'):
                    journal.recover(lambda unit, _: restored.append(unit),
                        lambda unit, _: {**current[unit], 'verified': True},
                        lambda: {'verified': True}, hold=hold,
                        deploy_fence=lambda: fence_calls.append(True) or {'verified': True})
                self.assertEqual(restored, [])
                self.assertEqual(fence_calls, [])
                self.assertEqual(len(journal.records), before)
                self.assertFalse(any(row['event'] == 'already-restored'
                                     and row.get('unit') == 'mesh-deploy-listener'
                                     for row in journal.records))

    def test_full_scope_listener_started_but_unverified_requires_stop_before_retry(self):
        prior = full_node_inventory()
        current = copy.deepcopy(prior)
        baseline = full_entrypoint_evidence(prior)
        def entrypoints(_):
            result = copy.deepcopy(baseline)
            result['loaded']['gui'] = sorted('ai.openclaw.' + unit for unit, state in current.items()
                                             if state['loaded'])
            result['overrides']['gui'] = {'ai.openclaw.' + unit: True if state['disabled'] else None
                                          for unit, state in current.items()}
            result['overrides']['user'] = copy.deepcopy(result['overrides']['gui'])
            return result
        with patch('preservation_journal.capture_entrypoint_inventory', side_effect=entrypoints):
            with Journal(self.root, prior, node_lock=self.node_lock,
                         scope=FULL_NODE_SCOPE) as journal:
                starts = []
                fence_calls = []
                hold = SimpleNamespace(journal=journal, check_forward=lambda: None,
                    prepare=lambda *_: None,
                    before_restore=lambda: None, check_closed=lambda: None,
                    complete=lambda *_: {'verified': True})
                anchor_hold(journal, hold)
                journal.mutate('mesh-deploy-listener', 'disable-and-unload',
                    lambda: current['mesh-deploy-listener'].update(loaded=False, running=False, disabled=True),
                    listener_stop_evidence, hold=hold)
                def fence():
                    fence_calls.append(True)
                    return {'verified': True}
                def restore(unit, wanted):
                    starts.append(unit)
                    current[unit] = copy.deepcopy(wanted)
                    if len(starts) == 1:
                        raise TimeoutError('owned readiness timeout after start')
                def recover():
                    return journal.recover(restore,
                        lambda unit, _: {**current[unit], 'verified': True},
                        lambda: {'verified': True}, hold=hold, deploy_fence=fence)
                first = recover()
                self.assertFalse(first['restored'])
                self.assertEqual(starts, ['mesh-deploy-listener'])
                with self.assertRaisesRegex(Refused, 'stopped unit state changed before verified recovery'):
                    recover()
                self.assertEqual(starts, ['mesh-deploy-listener'])
                self.assertEqual(fence_calls, [True])
                current['mesh-deploy-listener'].update(loaded=False, running=False, disabled=True)
                third = recover()
                self.assertTrue(third['restored'], third)
                self.assertEqual(starts, ['mesh-deploy-listener', 'mesh-deploy-listener'])
                self.assertEqual(fence_calls, [True, True])

    def test_full_scope_refuses_listener_release_after_late_service_or_job_drift(self):
        for drift in ('service', 'extra-job', 'missing-job', 'listener-start'):
            with self.subTest(drift=drift):
                prior = full_node_inventory()
                current = copy.deepcopy(prior)
                baseline = full_entrypoint_evidence(prior)
                releasing = []
                def entrypoints(_):
                    result = copy.deepcopy(baseline)
                    result['loaded']['gui'] = sorted('ai.openclaw.' + unit for unit, state in current.items()
                                                     if state['loaded'])
                    if releasing and drift == 'extra-job':
                        result['loaded']['gui'].append('ai.openclaw.foreign')
                    if releasing and drift == 'missing-job':
                        result['loaded']['gui'].remove('ai.openclaw.gateway')
                    return result
                root = pathlib.Path(self.temp.name) / ('listener-drift-' + drift)
                with patch('preservation_journal.capture_entrypoint_inventory', side_effect=entrypoints):
                    with Journal(root / 'journals' / 'journal', prior,
                                 node_lock=root / 'node.lock', scope=FULL_NODE_SCOPE) as journal:
                        current['mesh-deploy-listener'].update(loaded=False, running=False)
                        restored = []
                        fence_calls = []
                        complete_calls = []
                        listener_observations = []
                        def observe(unit, _):
                            if unit == 'mesh-deploy-listener':
                                listener_observations.append(True)
                                if len(listener_observations) == 2:
                                    releasing.append(True)
                                    if drift == 'service':
                                        current['gateway']['running'] = False
                                    if drift == 'listener-start':
                                        current['mesh-deploy-listener'] = copy.deepcopy(prior['mesh-deploy-listener'])
                            return {**current[unit], 'verified': True}
                        hold = SimpleNamespace(journal=journal, prepare=lambda *_: None,
                            before_restore=lambda: None, check_closed=lambda: None,
                            complete=lambda *_: complete_calls.append(True) or {'verified': True})
                        def fence():
                            fence_calls.append(True)
                            return {'verified': True}
                        result = journal.recover(lambda unit, _: restored.append(unit), observe,
                            lambda: {'verified': True}, hold=hold,
                            deploy_fence=fence)
                        self.assertFalse(result['restored'])
                        self.assertEqual(restored, [])
                        self.assertEqual(fence_calls, [])
                        self.assertEqual(complete_calls, [])
                        self.assertFalse(any(row['event'] == 'listener-release-verified'
                                             for row in journal.records))

    def test_full_scope_requires_deploy_fence_before_recovery_records(self):
        prior = full_node_inventory()
        with patch('preservation_journal.capture_entrypoint_inventory',
                   return_value=full_entrypoint_evidence(prior)):
            with Journal(self.root, prior, node_lock=self.node_lock,
                         scope=FULL_NODE_SCOPE) as journal:
                before = len(journal.records)
                with self.assertRaisesRegex(Refused, 'deploy listener fence'):
                    journal.recover(lambda *_: self.fail('restoration entered'),
                        lambda *_: self.fail('observation entered'),
                        lambda: self.fail('final check entered'),
                        hold=SimpleNamespace(journal=journal))
                self.assertEqual(len(journal.records), before)

    def test_full_scope_recovery_refuses_root_marker_without_transfer(self):
        prior = full_node_inventory()
        with patch('preservation_journal.capture_entrypoint_inventory',
                   return_value=full_entrypoint_evidence(prior)):
            with Journal(self.root, prior, node_lock=self.node_lock,
                         scope=FULL_NODE_SCOPE) as journal:
                before = len(journal.records)
                self.nats_marker.write_text('{}')
                with self.assertRaisesRegex(Refused, 'marker already exists'):
                    journal.recover(lambda *_: self.fail('restoration entered'),
                                    lambda *_: self.fail('observation entered'),
                                    lambda: self.fail('readiness entered'), hold=SimpleNamespace(journal=journal))
                self.assertEqual(len(journal.records), before)

    def test_full_scope_recovery_refuses_exclusive_writer_without_transfer(self):
        prior = full_node_inventory()
        current = copy.deepcopy(prior)
        current['nats'].update(loaded=False, running=False)
        self.nats_lock.write_bytes(b'owned lock')
        self.nats_lock.chmod(0o644)
        script = ('import fcntl,os,sys; '
                  'fd=os.open(sys.argv[1],os.O_RDONLY); '
                  'fcntl.flock(fd,fcntl.LOCK_EX); '
                  'print("locked",flush=True); sys.stdin.read()')
        holder = subprocess.Popen([sys.executable, '-c', script, str(self.nats_lock)],
                                  stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True)
        try:
            self.assertEqual(holder.stdout.readline().strip(), 'locked')
            with patch('preservation_journal.NATS_ROOT_UID', os.getuid()), patch(
                    'preservation_journal.capture_entrypoint_inventory',
                    return_value=full_entrypoint_evidence(prior)):
                with Journal(self.root, prior, node_lock=self.node_lock,
                             scope=FULL_NODE_SCOPE) as journal:
                    restored = []
                    observed = []
                    final_checks = []
                    hold = SimpleNamespace(journal=journal, prepare=lambda *_: None)
                    def observe(unit, _):
                        observed.append(unit)
                        return {**current[unit], 'verified': True}
                    def final_check():
                        final_checks.append(True)
                        return {'verified': True}
                    before = len(journal.records)
                    with self.assertRaisesRegex(Refused, 'exclusive exclusion'):
                        journal.recover(lambda unit, _: restored.append(unit),
                                        observe, final_check, hold=hold,
                                        deploy_fence=lambda: {'verified': True})
                    self.assertEqual(len(journal.records), before)
                    self.assertEqual(restored, [])
                    self.assertEqual(observed, [])
                    self.assertEqual(final_checks, [])
        finally:
            holder.stdin.close()
            self.assertEqual(holder.wait(timeout=5), 0)
            holder.stdout.close()

    def test_full_scope_holds_writer_exclusion_through_gate_reopen_and_resolution(self):
        prior = full_node_inventory()
        self.nats_lock.write_bytes(b'owned lock')
        self.nats_lock.chmod(0o644)
        script = ('import fcntl,os,sys; '
                  'fd=os.open(sys.argv[1],os.O_RDONLY); '
                  'fcntl.flock(fd,fcntl.LOCK_EX|fcntl.LOCK_NB)')
        def assert_excluded():
            probe = subprocess.run([sys.executable, '-c', script, str(self.nats_lock)],
                                   capture_output=True, text=True)
            self.assertNotEqual(probe.returncode, 0)
            self.assertIn('BlockingIOError', probe.stderr)
        def complete(observe, final_check, before_open=None):
            assert_excluded()
            observe('nats', prior['nats'])
            final_check()
            if before_open is not None:
                before_open()
            return {'verified': True}
        with patch('preservation_journal.NATS_ROOT_UID', os.getuid()), patch(
                'preservation_journal.capture_entrypoint_inventory',
                return_value=full_entrypoint_evidence(prior)):
            with Journal(self.root, prior, node_lock=self.node_lock,
                         scope=FULL_NODE_SCOPE) as journal:
                hold = SimpleNamespace(journal=journal, prepare=lambda *_: None,
                                       complete=complete)
                result = journal.recover(lambda *_: self.fail('already restored'),
                    lambda unit, _: {**prior[unit], 'verified': True},
                    lambda: {'verified': True}, hold=hold,
                    deploy_fence=lambda: {'verified': True})
                self.assertTrue(result['restored'])
                self.nats_marker.write_text('{}')
                with self.assertRaisesRegex(Refused, 'marker already exists'):
                    journal.resolve()
                self.assertEqual(journal.records[-1]['event'], 'recovery-finished')
                self.nats_marker.unlink()
                self.assertEqual(len(journal.resolve()), 64)

    def test_full_scope_refuses_loaded_inactive_or_restarted_job(self):
        prior = full_node_inventory()
        baseline = full_entrypoint_evidence(prior)
        current = copy.deepcopy(baseline)
        with patch('preservation_journal.capture_entrypoint_inventory',
                   side_effect=lambda _: copy.deepcopy(current)):
            with Journal(self.root, prior, node_lock=self.node_lock,
                         scope=FULL_NODE_SCOPE) as journal:
                current['loaded']['gui'].append('ai.openclaw.federation-tick')
                with self.assertRaisesRegex(Refused, 'outside its original'):
                    journal.check_entrypoints()
                current = copy.deepcopy(baseline)
                hold = SimpleNamespace(journal=journal, check_forward=lambda: None)
                anchor_hold(journal, hold)
                journal.mutate('mesh-deploy-listener', 'disable-and-unload',
                               lambda: fence_listener(current),
                               listener_stop_evidence, hold=hold)
                def stop_viewer():
                    fence_unit(current, 'workplan-viewer')
                journal.mutate('workplan-viewer', 'disable-and-unload', stop_viewer,
                               lambda: {'verified': True}, hold=hold)
                self.assertEqual(journal.records[-1]['evidence']['entrypoint_loaded'],
                                 current['loaded'])
                def unload_timer():
                    fence_unit(current, 'consolidation-scheduler')
                journal.mutate('consolidation-scheduler', 'disable-and-unload', unload_timer,
                               lambda: {'verified': True}, hold=hold)
                self.assertEqual(journal.records[-1]['evidence']['entrypoint_loaded'],
                                 current['loaded'])
                current = copy.deepcopy(baseline)
                with self.assertRaisesRegex(Refused, 'changed inside'):
                    journal.check_entrypoints(forward=True)

    def test_full_scope_resolve_rechecks_loaded_jobs(self):
        prior = full_node_inventory()
        current = full_entrypoint_evidence(prior)
        with patch('preservation_journal.capture_entrypoint_inventory',
                   side_effect=lambda _: copy.deepcopy(current)):
            with Journal(self.root, prior, node_lock=self.node_lock,
                         scope=FULL_NODE_SCOPE) as journal:
                hold = SimpleNamespace(journal=journal, prepare=lambda *_: None,
                    complete=lambda *_: {'verified': True})
                result = journal.recover(lambda *_: self.fail('already restored'),
                    lambda unit, _: {**prior[unit], 'verified': True},
                    lambda: {'verified': True}, hold=hold,
                    deploy_fence=lambda: {'verified': True})
                self.assertTrue(result['restored'])
                with self.assertRaisesRegex(Refused, 'continuous launchd and process watch'):
                    journal.seal()
                with self.assertRaisesRegex(Refused, 'continuous launchd and process watch'):
                    journal._finalize('sealed')
                with self.assertRaisesRegex(Refused, 'continuous launchd and process watch'):
                    journal.append('sealed')
                current['loaded']['gui'].remove('ai.openclaw.gateway')
                with self.assertRaisesRegex(Refused, 'were not restored'):
                    journal.resolve()
                self.assertEqual(journal.records[-1]['event'], 'recovery-finished')

    def tearDown(self):
        self.temp.cleanup()

    def test_production_scope_requires_every_approved_entry_and_saved_hold(self):
        prior = full_node_inventory()
        for unit in ('gateway', 'workplan-viewer', 'federation-tick'):
            with self.subTest(unit=unit):
                changed = copy.deepcopy(prior)
                changed[unit] = {'loaded': False, 'running': False, 'disabled': False,
                                 'class': 'absent', 'identity': {'installed': False}}
                with self.assertRaisesRegex(Refused, 'approved cohort'):
                    Journal(self.parent / ('refuse-' + unit), changed, node_lock=self.node_lock,
                            scope=FULL_NODE_SCOPE)
        changed = copy.deepcopy(prior)
        del changed['scheduler-heartbeat']['execution_hold']
        with self.assertRaisesRegex(Refused, 'execution hold'):
            Journal(self.parent / 'refuse-no-hold', changed, node_lock=self.node_lock,
                    scope=FULL_NODE_SCOPE)
        changed = copy.deepcopy(prior)
        changed['federation-tick']['disabled'] = False
        with self.assertRaisesRegex(Refused, 'must remain disabled'):
            Journal(self.parent / 'refuse-enabled-tick', changed, node_lock=self.node_lock,
                    scope=FULL_NODE_SCOPE)
        evidence = full_entrypoint_evidence(prior)
        with patch('preservation_journal.capture_entrypoint_inventory', return_value=evidence):
            with Journal(self.root, prior, boot='boot-a', node_lock=self.node_lock,
                         scope=FULL_NODE_SCOPE) as journal:
                self.assertEqual(journal.scope, FULL_NODE_SCOPE)
                self.assertEqual(len(journal.prior), 23)
                self.assertEqual(journal.check_entrypoints(final=True), evidence)
        with self.journal() as reopened:
            self.assertEqual(reopened.scope, FULL_NODE_SCOPE)
            changed = copy.deepcopy(evidence)
            changed['loaded']['gui'].remove('ai.openclaw.gateway')
            with patch('preservation_journal.capture_entrypoint_inventory', return_value=changed):
                with self.assertRaisesRegex(Refused, 'were not restored'):
                    reopened.check_entrypoints(final=True)

    def test_excluded_system_job_is_durable_and_refuses_later_runs_or_identity_drift(self):
        prior = full_node_inventory()
        evidence = full_entrypoint_evidence(prior)
        evidence['excluded'] = tailscale_record()
        with patch('preservation_journal.capture_entrypoint_inventory',
                   return_value=copy.deepcopy(evidence)):
            with Journal(self.root, prior, boot='boot-a', node_lock=self.node_lock,
                         scope=FULL_NODE_SCOPE) as journal:
                self.assertEqual(journal.check_entrypoints(final=True)['excluded'],
                                 evidence['excluded'])
                for change in (
                    ('launchd', 'runs', 2), ('launchd', 'last_exit_code', 1),
                    ('plist', 'sha256', '7' * 64), ('wrapper', 'sha256', '8' * 64),
                    ('app', 'sha256', '9' * 64), (None, 'boot', 'a' * 64),
                ):
                    changed = copy.deepcopy(evidence)
                    record = changed['excluded'][TAILSCALE_LABEL]
                    if change[0] is None:
                        record[change[1]] = change[2]
                    else:
                        record[change[0]][change[1]] = change[2]
                    with self.subTest(change=change):
                        with patch('preservation_journal.capture_entrypoint_inventory',
                                   return_value=changed):
                            with self.assertRaisesRegex(Refused, 'excluded system job changed'):
                                journal.check_entrypoints(final=True)
                missing = copy.deepcopy(evidence)
                missing['excluded'] = {}
                with patch('preservation_journal.capture_entrypoint_inventory',
                           return_value=missing):
                    with self.assertRaisesRegex(Refused, 'excluded system job changed'):
                        journal.check_entrypoints(final=True)
        malformed = copy.deepcopy(evidence)
        del malformed['excluded']
        with self.assertRaisesRegex(Refused, 'inventory is absent'):
            preservation_journal.valid_entrypoint_inventory(malformed, prior)
        malformed = copy.deepcopy(evidence)
        malformed['excluded']['com.openclaw.agent'] = tailscale_record()[TAILSCALE_LABEL]
        with self.assertRaisesRegex(Refused, 'not approved'):
            preservation_journal.valid_entrypoint_inventory(malformed, prior)

    def test_full_node_reboot_refuses_recovery_before_boot_hold_decision(self):
        prior = full_node_inventory()
        baseline = full_entrypoint_evidence(prior)
        baseline['excluded'] = tailscale_record()
        current = copy.deepcopy(baseline)
        with patch('preservation_journal.capture_entrypoint_inventory',
                   side_effect=lambda _: copy.deepcopy(current)):
            with Journal(self.root, prior, boot='6' * 64, node_lock=self.node_lock,
                         scope=FULL_NODE_SCOPE):
                pass
            current['excluded'][TAILSCALE_LABEL]['app']['sha256'] = 'a' * 64
            current['excluded'][TAILSCALE_LABEL]['launchd']['runs'] = 2
            current['excluded'][TAILSCALE_LABEL]['boot'] = '7' * 64
            with Journal(self.root, boot='7' * 64, node_lock=self.node_lock) as reopened:
                with self.assertRaisesRegex(Refused, 'excluded system job changed'):
                    reopened.check_entrypoints()
                before = len(reopened.records)
                with self.assertRaisesRegex(Refused, 'boot hold decision'):
                    reopened.recover(lambda *_: self.fail('restoration entered'),
                        lambda *_: self.fail('observation entered'),
                        lambda: self.fail('final check entered'))
                self.assertEqual(len(reopened.records), before)
                with self.assertRaisesRegex(Refused, 'unrestored node'):
                    reopened.resolve()

    def test_excluded_job_run_during_nats_transfer_is_durably_reported(self):
        journal, hold, observe, _ = self.prepared_nats_transfer(tailscale_record())
        transfer = journal.transfer_nats(str(uuid.uuid4()), hold, observe)
        self.publish_nats_return(journal, transfer)
        states = copy.deepcopy(journal.prior)
        for unit in ('nats', 'nats-2', 'nats-3', 'mesh-deploy-listener'):
            states[unit].update(loaded=False, running=False, disabled=True)
        current = copy.deepcopy(journal.entrypoint_inventory)
        current['excluded'][TAILSCALE_LABEL]['launchd']['runs'] = 2
        def entrypoints(_):
            result = copy.deepcopy(current)
            result['loaded']['gui'] = sorted('ai.openclaw.' + unit for unit, state in states.items()
                                             if state['loaded'])
            for domain in ('gui', 'user'):
                result['overrides'][domain] = {'ai.openclaw.' + unit: True if state['disabled'] else None
                                               for unit, state in states.items()}
            return result
        def restore(unit, wanted):
            states[unit] = copy.deepcopy(wanted)
        def observe_current(unit, _):
            return {**states[unit], 'verified': True}
        with patch('preservation_journal.capture_entrypoint_inventory',
                   side_effect=entrypoints):
            closed = journal.complete_nats_outcome()
            self.assertEqual(closed['outcome'], 'returned')
            recovery_hold = SimpleNamespace(journal=journal, prepare=lambda *_: None,
                before_restore=lambda: None, check_closed=lambda: None,
                complete=lambda *_: {'verified': True})
            failed = journal.recover(restore, observe_current,
                lambda: {'verified': False}, hold=recovery_hold,
                deploy_fence=lambda: {'verified': True})
            self.assertFalse(failed['restored'])
            self.assertFalse(states['mesh-deploy-listener']['running'])
            result = journal.recover(restore, observe_current,
                lambda: {'verified': True}, hold=recovery_hold,
                deploy_fence=lambda: {'verified': True})
            self.assertTrue(result['restored'], result)
            started = [row for row in journal.records if row['event'] == 'recovery-started']
            self.assertEqual([row['excluded_unchanged_since_baseline'] for row in started],
                             [False, False])
            self.assertTrue(all(row['entrypoint_excluded'][TAILSCALE_LABEL]['launchd']['runs'] == 2
                                for row in started))
            journal.resolve()


    def test_excluded_job_run_during_recovery_blocks_that_attempt_and_reanchors_on_retry(self):
        prior = full_node_inventory()
        current = full_entrypoint_evidence(prior)
        current['excluded'] = tailscale_record()
        with patch('preservation_journal.capture_entrypoint_inventory',
                   side_effect=lambda _: copy.deepcopy(current)):
            with Journal(self.root, prior, boot='6' * 64, node_lock=self.node_lock,
                         scope=FULL_NODE_SCOPE) as journal:
                hold = SimpleNamespace(journal=journal, prepare=lambda *_: None,
                    complete=lambda *_: {'verified': True})
                def final_check():
                    current['excluded'][TAILSCALE_LABEL]['launchd']['runs'] += 1
                    return {'verified': True}
                result = journal.recover(lambda *_: self.fail('already restored'),
                    lambda unit, _: {**prior[unit], 'verified': True},
                    final_check, hold=hold,
                    deploy_fence=lambda: {'verified': True})
                self.assertFalse(result['restored'])
                self.assertIn('final-state', [row['unit'] for row in result['errors']])
                with self.assertRaisesRegex(Refused, 'unrestored node'):
                    journal.resolve()
                retried = journal.recover(lambda *_: self.fail('already restored'),
                    lambda unit, _: {**prior[unit], 'verified': True},
                    lambda: {'verified': True}, hold=hold,
                    deploy_fence=lambda: {'verified': True})
                self.assertTrue(retried['restored'])
                started = [row for row in journal.records if row['event'] == 'recovery-started']
                self.assertEqual([row['excluded_unchanged_since_baseline'] for row in started],
                                 [True, False])
                journal.resolve()

    def test_excluded_job_static_drift_cannot_reanchor_recovery(self):
        prior = full_node_inventory()
        current = full_entrypoint_evidence(prior)
        current['excluded'] = tailscale_record()
        with patch('preservation_journal.capture_entrypoint_inventory',
                   side_effect=lambda _: copy.deepcopy(current)):
            with Journal(self.root, prior, boot='6' * 64, node_lock=self.node_lock,
                         scope=FULL_NODE_SCOPE) as journal:
                current['excluded'][TAILSCALE_LABEL]['plist']['sha256'] = 'a' * 64
                hold = SimpleNamespace(journal=journal, prepare=lambda *_: None,
                    complete=lambda *_: {'verified': True})
                result = journal.recover(lambda *_: self.fail('already restored'),
                    lambda unit, _: {**prior[unit], 'verified': True},
                    lambda: {'verified': True}, hold=hold,
                    deploy_fence=lambda: {'verified': True})
                self.assertFalse(result['restored'])
                self.assertIn('entrypoints', [row['unit'] for row in result['errors']])

    def test_full_inventory_covers_gateway_viewer_and_installed_unloaded_tick(self):
        self.assertTrue({'gateway', 'workplan-viewer', 'federation-tick'} <= UNITS)
        prior = copy.deepcopy(PRIOR)
        prior['federation-tick'] = {'loaded': False, 'running': False, 'disabled': True,
            'class': 'unloaded', 'identity': {
                'plist_sha256': '0' * 64, 'argv': ['/owned/federation-tick'],
                'files': {'/owned/federation-tick': '1' * 64}, 'dependencies': {},
                'working_directory': '/'}}
        with legacy_journal(self.root, prior, boot='boot-a', node_lock=self.node_lock) as journal:
            with self.assertRaisesRegex(Refused, 'held or unknown unit'):
                journal.mutate('federation-tick', 'stop', lambda: self.fail('must not mutate'),
                               lambda: {'verified': True})
        with self.journal() as reopened:
            current = copy.deepcopy(prior)
            current['federation-tick']['loaded'] = True
            restored = []
            result = reopened.recover(lambda *args: restored.append(args),
                lambda unit, saved: {**current[unit], 'verified': True},
                lambda: {'verified': True})
            self.assertFalse(result['restored'])
            self.assertEqual(result['errors'][0]['unit'], 'federation-tick')
            self.assertEqual(restored, [])
            self.assertFalse(any(row['event'] == 'unloaded-unit-verified'
                                 for row in reopened.records))
            current['federation-tick']['loaded'] = False
            current['federation-tick']['disabled'] = False
            result = reopened.recover(lambda *args: restored.append(args),
                lambda unit, saved: {**current[unit], 'verified': True},
                lambda: {'verified': True})
            self.assertFalse(result['restored'])
            self.assertEqual(result['errors'][0]['unit'], 'federation-tick')
            self.assertEqual(restored, [])
            current['federation-tick']['disabled'] = True
            result = reopened.recover(lambda *args: restored.append(args),
                lambda unit, saved: {**current[unit], 'verified': True},
                lambda: {'verified': True})
            self.assertTrue(result['restored'])
            self.assertEqual(restored, [])
            self.assertTrue(any(row['event'] == 'unloaded-unit-verified'
                                for row in reopened.records))

    def test_timer_commissioning_scope_is_durable_and_cannot_mutate_or_seal(self):
        with Journal(self.root, timer_inventory(), boot='boot-a', node_lock=self.node_lock,
                     scope=TIMER_SCOPE) as journal:
            self.assertEqual(journal.scope, TIMER_SCOPE)
            self.assertEqual(journal.records[0]['scope'], TIMER_SCOPE)
            with self.assertRaisesRegex(Refused, 'cannot mutate'):
                journal.mutate('observer', 'disable', lambda: self.fail('must not apply'),
                               lambda: {'verified': True})
            with self.assertRaisesRegex(Refused, 'cannot seal'):
                journal.seal()
            self.assertEqual(len(journal.records), 1)
        with self.journal(boot='boot-a') as reopened:
            self.assertEqual(reopened.scope, TIMER_SCOPE)
            self.assertEqual(set(reopened.prior), TIMER_UNITS)
            with self.assertRaisesRegex(Refused, 'cannot seal'):
                reopened.seal()

    def test_timer_subset_requires_explicit_scope_and_exact_cohort(self):
        with self.assertRaisesRegex(Refused, 'inventory'):
            self.journal(timer_inventory())
        prior = timer_inventory()
        prior.pop('observer')
        with self.assertRaisesRegex(Refused, 'inventory'):
            Journal(self.root, prior, node_lock=self.node_lock, scope=TIMER_SCOPE)
        prior = timer_inventory()
        prior['scheduler-heartbeat']['execution_hold']['cohort'].remove('observer')
        with self.assertRaisesRegex(Refused, 'omits a scheduled entry'):
            Journal(self.root, prior, node_lock=self.node_lock, scope=TIMER_SCOPE)

    def test_resolved_timer_scope_chains_to_full_node_baseline(self):
        with Journal(self.root, timer_inventory(), boot='boot-a', node_lock=self.node_lock,
                     scope=TIMER_SCOPE) as timer:
            finished = timer.append('recovery-finished', services_verified=True, errors=[])
            timer._state({**timer.active, 'status': 'restored', 'head': finished['sha256']})
            predecessor = timer.resolve()
        prior = full_node_inventory()
        with patch('preservation_journal.capture_entrypoint_inventory',
                   return_value=full_entrypoint_evidence(prior)):
            with Journal(self.parent / 'full-node', prior, boot='boot-a',
                         node_lock=self.node_lock, scope=FULL_NODE_SCOPE) as full:
                self.assertEqual(full.scope, FULL_NODE_SCOPE)
                self.assertEqual(set(full.prior), UNITS)
                self.assertEqual(full.records[0]['predecessor'],
                                 {'root': str(self.root.resolve()), 'head': predecessor})

    def test_intent_is_durable_and_visible_before_mutation(self):
        with self.journal(PRIOR, boot='boot-a') as journal:
            def apply():
                row = json.loads((self.root / '000001.json').read_text())
                self.assertEqual(row['event'], 'intent')
                self.assertEqual(row['unit'], 'mesh-agent')
                self.assertEqual(row['action'], 'disable')
            journal.mutate('mesh-agent', 'disable', apply, lambda: {'verified': True})
            self.assertFalse(journal.pending_intents())
        with self.journal(boot='boot-a') as reopened:
            self.assertEqual(reopened.records[-1]['event'], 'verified')
            with self.assertRaisesRegex(Refused, 'reopened'):
                reopened.require_forward()
        for path in self.root.iterdir():
            self.assertEqual(path.stat().st_mode & 0o777, 0o600)

    def test_failed_fsync_never_calls_mutation(self):
        applied = []
        with self.journal(PRIOR, boot='boot-a') as journal:
            with patch('preservation_journal.os.fsync', side_effect=OSError('owned fault')):
                with self.assertRaises(OSError):
                    journal.mutate('mesh-agent', 'disable', lambda: applied.append(True), lambda: {'verified': True})
            self.assertFalse(applied)
            self.assertEqual(len(journal.records), 1)
            with self.assertRaisesRegex(Refused, 'failed durable write'):
                journal.require_forward()

    def test_directory_sync_failure_cannot_overwrite_an_intent(self):
        with self.journal(PRIOR, boot='boot-a') as journal:
            with patch('preservation_journal.sync_dir', side_effect=OSError('owned directory fault')):
                with self.assertRaises(OSError):
                    journal.mutate('mesh-agent', 'disable', lambda: self.fail('must not run'), lambda: {'verified': True})
            persisted = (self.root / '000001.json').read_bytes()
            with self.assertRaisesRegex(Refused, 'failed durable write'):
                journal.append('anything')
            self.assertEqual((self.root / '000001.json').read_bytes(), persisted)
        with self.journal(boot='boot-a') as reopened:
            self.assertEqual(len(reopened.pending_intents()), 1)
            with self.assertRaisesRegex(Refused, 'only restore'):
                reopened.require_forward()

    def test_failed_verification_refuses_followup_mutation(self):
        with self.journal(PRIOR, boot='boot-a') as journal:
            with self.assertRaisesRegex(Refused, 'verified evidence'):
                journal.mutate('mesh-agent', 'disable', lambda: None, lambda: False)
            self.assertEqual(journal.records[-1]['event'], 'failed')
            with self.assertRaisesRegex(Refused, 'only restore'):
                journal.mutate('nats', 'unload', lambda: self.fail('must not run'), lambda: {'verified': True})

    def test_failure_evidence_survives_reopen_before_service_restoration(self):
        raw = {'kernel_events': [{'ident': 123, 'filter': -10, 'flags': 0,
                                  'fflags': 0, 'data': 0}], 'bootout': None}
        with self.journal(PRIOR, boot='boot-a') as journal:
            def apply():
                raise Refused('owned refusal')
            with self.assertRaisesRegex(Refused, 'owned refusal'):
                journal.mutate('mesh-agent', 'stop', apply, lambda: self.fail('must not verify'),
                               failure_evidence=lambda error: raw)
        with self.journal(boot='boot-a') as reopened:
            self.assertEqual(reopened.records[-1]['event'], 'failed')
            self.assertEqual(reopened.records[-1]['evidence'], raw)
            self.assertEqual(reopened.records[-1]['error_type'], 'Refused')
            with self.assertRaisesRegex(Refused, 'reopened'):
                reopened.require_forward()

    def test_non_string_dictionary_keys_refuse_before_writing_a_poisoned_record(self):
        with self.journal(PRIOR) as journal:
            with self.assertRaisesRegex(TypeError, 'keys must be strings'):
                journal.append('owned-negative', evidence={'exits': {9998: {}, 10001: {}}})
            self.assertEqual(len(journal.records), 1)
            self.assertFalse((self.root / '000001.json').exists())
        with self.journal() as reopened:
            self.assertFalse(reopened.write_failed)
            self.assertEqual(len(reopened.records), 1)
        with self.assertRaisesRegex(TypeError, 'keys must be strings'):
            encoded({'nested': ([{'exits': {9998: {}, 10001: {}}}],)})

    def test_mixed_width_process_keys_survive_verified_and_failed_record_reopen(self):
        for action in ('verified', 'failed'):
            with self.subTest(action=action):
                root = self.parent / action
                evidence = {'verified': True, 'exits': {'9998': {'wait_status': 0},
                            '10001': {'wait_status': 0}},
                            'process_contracts': {'9998': {'allowed_signals': []},
                                                  '10001': {'allowed_signals': []}}}
                with self.journal(PRIOR, root=root) as journal:
                    def apply():
                        if action == 'failed':
                            raise Refused('owned stop failed')
                    if action == 'verified':
                        journal.mutate('mesh-agent', 'stop', apply, lambda: evidence)
                    else:
                        with self.assertRaisesRegex(Refused, 'owned stop failed'):
                            journal.mutate('mesh-agent', 'stop', apply, lambda: self.fail('must not verify'),
                                           failure_evidence=lambda error: evidence)
                with self.journal(root=root) as reopened:
                    self.assertFalse(reopened.write_failed)
                    self.assertEqual(len(reopened.records), 3)
                    self.assertEqual(reopened.records[-1]['event'], action)
                    self.assertEqual(reopened.records[-1]['evidence'], evidence)
                    for row in reopened.records:
                        valid_record(row)
                    result = reopened.recover(lambda *_: self.fail('ready owner must not restart'),
                        lambda unit, prior: {**prior, 'verified': True}, lambda: {'verified': True})
                    self.assertTrue(result['restored'])
                    reopened.resolve()


    def test_reboot_refuses_preservation_but_restores_original_state(self):
        with self.journal(PRIOR, boot='boot-a') as journal:
            journal.mutate('mesh-agent', 'disable', lambda: None, lambda: {'verified': True})
        restored = []
        current = copy.deepcopy(PRIOR)
        current['mesh-agent'].update(loaded=False, running=False, disabled=True)
        with self.journal(boot='boot-b') as journal:
            with self.assertRaisesRegex(Refused, 'reboot'):
                journal.require_forward()
            def restore(unit, prior):
                restored.append((unit, prior)); current[unit].update(prior)
            result = journal.recover(restore,
                                     lambda unit, prior: {**current[unit], 'verified': True}, lambda: {'verified': True})
            self.assertTrue(result['restored'])
            self.assertEqual(restored, [('mesh-agent', PRIOR['mesh-agent'])])
            with self.assertRaises(Refused):
                journal.require_forward()
        self.assertFalse((self.root / 'acceptance.json').exists())

    def test_owned_process_killed_after_mutation_recovers_incomplete_intent(self):
        state = pathlib.Path(self.temp.name) / 'owned-unit-state.json'
        state.write_text(json.dumps(PRIOR['mesh-agent']))
        source = '''import json,os,pathlib,sys,time
from legacy_fixture import legacy_journal
root,state,ready,node_lock=map(pathlib.Path,sys.argv[1:5])
prior=json.loads(sys.argv[5])
with legacy_journal(root,prior,boot='boot-a',node_lock=node_lock) as journal:
 def apply():
  with state.open('w') as f:
   json.dump({**prior['mesh-agent'],'loaded':False,'running':False,'disabled':True},f);f.flush();os.fsync(f.fileno())
  ready.write_text('after-mutation-before-verification')
  while True:time.sleep(1)
 journal.mutate('mesh-agent','disable-and-unload',apply,lambda:{'verified':True})
'''
        ready = pathlib.Path(self.temp.name) / 'ready'
        child = subprocess.Popen([sys.executable, '-c', source, str(self.root), str(state), str(ready), str(self.node_lock), json.dumps(PRIOR)],
                                 cwd=HERE, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
        try:
            end = time.monotonic() + 5
            while not ready.exists() and child.poll() is None and time.monotonic() < end:
                time.sleep(0.01)
            self.assertTrue(ready.exists(), 'owned mutation boundary was not reached')
            child.kill()
            child.wait(timeout=5)
            self.assertEqual(child.returncode, -signal.SIGKILL)
            self.assertTrue(json.loads(state.read_text())['disabled'])
            with self.journal(boot='boot-b') as journal:
                self.assertEqual(len(journal.pending_intents()), 1)
                def restore(unit, prior):
                    intent = json.loads(max(self.root.glob('[0-9]*.json')).read_text())
                    self.assertEqual(intent['action'], 'restore-prior')
                    state.write_text(json.dumps(prior))
                result = journal.recover(restore,
                                         lambda unit, prior: {**(json.loads(state.read_text()) if unit == 'mesh-agent' else prior), 'verified': True},
                                         lambda: {'verified': True})
                self.assertTrue(result['restored'])
            self.assertEqual(json.loads(state.read_text()), PRIOR['mesh-agent'])
        finally:
            if child.poll() is None:
                child.kill()
                child.wait(timeout=5)
            child.stderr.close()

    def test_second_writer_is_refused(self):
        with self.journal(PRIOR, boot='boot-a'):
            result = subprocess.run([sys.executable, '-c',
                'from preservation_journal import Journal; import sys; Journal(sys.argv[1],node_lock=sys.argv[2])', str(self.root), str(self.node_lock)],
                cwd=HERE, capture_output=True, text=True, timeout=5)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn('another process owns', result.stderr)

    def test_corruption_and_missing_record_refuse_replay(self):
        with self.journal(PRIOR, boot='boot-a') as journal:
            journal.append('observation', verified=True)
        path = self.root / '000001.json'
        row = json.loads(path.read_text())
        row['verified'] = False
        path.write_text(json.dumps(row))
        with self.journal() as journal:
            with self.assertRaisesRegex(Refused, 'failed durable write'):
                journal.require_forward()
            result = journal.recover(lambda *_: self.fail('ready owner restarted'),
                lambda unit, prior: {**prior, 'verified': True}, lambda: {'verified': True}, lambda _: None)
            self.assertFalse(result['restored'])
            self.assertTrue(result['services_verified'])
        path.rename(self.root / '000002.json')
        with self.journal() as journal:
            with self.assertRaisesRegex(Refused, 'failed durable write'):
                journal.require_forward()

    def test_owner_privacy_and_symlinks_are_refused(self):
        with self.journal(PRIOR, boot='boot-a'):
            pass
        path = self.root / '000000.json'
        real = self.root / 'retained-original'
        path.rename(real)
        path.symlink_to(real)
        with self.journal() as journal:
            with self.assertRaisesRegex(Refused, 'failed durable write'):
                journal.require_forward()

    def test_recovery_requires_original_states_and_dependency_order(self):
        with self.journal(PRIOR, boot='boot-a') as journal:
            journal.mutate('mesh-agent', 'unload', lambda: None, lambda: {'verified': True})
            journal.mutate('nats', 'unload', lambda: None, lambda: {'verified': True})
            resumed = []
            result = journal.recover( lambda unit, prior: resumed.append(unit),
                                     lambda unit, prior: {**prior, 'running': False, 'verified': True},
                                     lambda: {'verified': True})
            self.assertFalse(result['restored'])
            self.assertEqual(resumed, ['nats'])
            self.assertEqual(result['errors'][-1]['reason'], 'bus recovery was not verified')

    def test_recovery_observes_reboot_restored_units_without_restarting_them(self):
        with self.journal(PRIOR, boot='boot-a') as journal:
            journal.mutate('mesh-agent', 'unload', lambda: None, lambda: {'verified': True})
        with self.journal(boot='boot-b') as journal:
            result = journal.recover( lambda *args: self.fail('already restored unit was restarted'),
                                     lambda unit, prior: {**prior, 'verified': True}, lambda: {'verified': True})
            self.assertTrue(result['restored'])
            self.assertTrue(any(r['event'] == 'already-restored' for r in journal.records))

    def test_final_physical_hold_and_readiness_failure_is_not_restoration(self):
        with self.journal(PRIOR, boot='boot-a') as journal:
            journal.mutate('nats', 'unload', lambda: None, lambda: {'verified': True})
            result = journal.recover( lambda *args: self.fail('ready bus was restarted'),
                                     lambda unit, prior: {**prior, 'verified': True}, lambda: {'verified': False})
            self.assertFalse(result['restored'])
            self.assertEqual(result['errors'][0]['unit'], 'final-state')

    def test_reboot_restores_a_worker_with_no_stop_intent(self):
        with self.journal(PRIOR):
            pass
        current = copy.deepcopy(PRIOR)
        current['mesh-agent'].update(loaded=False, running=False)
        restored = []
        with self.journal(boot='boot-b') as journal:
            def restore(unit, prior):
                restored.append(unit)
                current[unit].update(prior)
            result = journal.recover(restore, lambda unit, prior: {**current[unit], 'verified': True},
                                     lambda: {'verified': True})
        self.assertTrue(result['restored'])
        self.assertEqual(restored, ['mesh-agent'])

    def test_final_hold_check_runs_even_when_bus_recovery_fails(self):
        final = []
        with self.journal(PRIOR) as journal:
            result = journal.recover(lambda *_: None,
                lambda unit, prior: {**prior, 'running': False, 'verified': True},
                lambda: final.append(True) or {'verified': False})
        self.assertFalse(result['restored'])
        self.assertEqual(final, [True])
        self.assertTrue(any(e['unit'] == 'final-state' for e in result['errors']))

    def test_tail_truncation_cannot_resume_a_window_or_skip_baseline_units(self):
        with self.journal(PRIOR) as journal:
            journal.mutate('nats', 'unload', lambda: None, lambda: {'verified': True})
        for name in ('000001.json', '000002.json'):
            (self.root / name).unlink()
        current = copy.deepcopy(PRIOR)
        current['nats'].update(loaded=False, running=False)
        restored = []
        with self.journal() as journal:
            with self.assertRaisesRegex(Refused, 'reopened'):
                journal.require_forward()
            def restore(unit, prior):
                restored.append(unit)
                current[unit].update(prior)
            result = journal.recover(restore, lambda unit, prior: {**current[unit], 'verified': True},
                                     lambda: {'verified': True})
        self.assertTrue(result['restored'])
        self.assertEqual(restored, ['nats'])

    def test_member_one_is_read_only_and_unknown_units_are_refused_at_creation(self):
        prior = copy.deepcopy(PRIOR)
        with self.journal(prior) as journal:
            with self.assertRaisesRegex(Refused, 'held or unknown'):
                journal.mutate('nats-1', 'enable', lambda: self.fail('held member changed'), lambda: {'verified': True})
            self.assertFalse(journal.pending_intents())
            journal.recover(lambda *_: self.fail('ready owner restarted'),
                lambda unit, wanted: {**wanted, 'verified': True}, lambda: {'verified': True})
            journal.resolve()
        prior['unknown'] = copy.deepcopy(PRIOR['mesh-agent'])
        with self.assertRaisesRegex(Refused, 'inventory'):
            self.journal(prior, root=self.parent / 'unknown')

    def test_full_disk_restores_baseline_without_claiming_durable_success(self):
        current = copy.deepcopy(PRIOR)
        for state in current.values():
            state.update(loaded=False, running=False)
        restored, diagnostics, final = [], [], []
        with self.journal(PRIOR) as journal:
            def restore(unit, prior):
                restored.append(unit)
                current[unit].update(prior)
            with patch('preservation_journal.os.fsync', side_effect=OSError(errno.ENOSPC, 'owned full disk')):
                result = journal.recover(restore, lambda unit, prior: {**current[unit], 'verified': True},
                    lambda: final.append(True) or {'verified': True}, diagnostics.append)
            self.assertFalse(result['restored'])
            self.assertTrue(result['services_verified'])
            self.assertFalse(result['evidence_durable'])
            self.assertEqual(restored, ['nats', 'mesh-agent'])
            self.assertEqual(final, [True])
            self.assertTrue(diagnostics)
            self.assertNotIn('identity', json.dumps(diagnostics))
            with self.assertRaises(Refused):
                journal.require_forward()

    def test_different_journal_roots_share_one_node_lock(self):
        other = self.parent / 'other-journal'
        with self.journal(PRIOR) as journal:
            with self.assertRaisesRegex(Refused, 'node preservation lock'):
                self.journal(PRIOR, root=other)
            self.assertFalse(other.exists())
            journal.recover(lambda *_: self.fail('ready owner restarted'),
                            lambda unit, prior: {**prior, 'verified': True}, lambda: {'verified': True})
            journal.resolve()
        with self.journal(PRIOR, root=other):
            pass

    def test_immutable_entry_or_plist_changes_are_not_restored(self):
        current = copy.deepcopy(PRIOR)
        current['mesh-agent']['identity']['files']['/owned/mesh-agent'] = '2' * 64
        current['mesh-agent'].update(loaded=False, running=False)
        final = []
        with self.journal(PRIOR) as journal:
            result = journal.recover(lambda *_: self.fail('changed release was started'),
                lambda unit, prior: {**current[unit], 'verified': True},
                lambda: final.append(True) or {'verified': True})
        self.assertFalse(result['restored'])
        self.assertEqual(final, [True])
        self.assertEqual(result['errors'][0]['unit'], 'mesh-agent')

    def test_every_stop_stage_recovers_the_whole_baseline_in_dependency_order(self):
        names = ('nats', 'nats-2', 'nats-3', 'mesh-task-daemon', 'mesh-agent')
        prior = inventory({name: {} for name in names})
        stages = (('mesh-agent',), ('mesh-agent', 'nats-2'),
                  ('mesh-agent', 'nats-2', 'nats-3'), names)
        for index, changed in enumerate(stages):
            with self.subTest(stage=changed):
                current = copy.deepcopy(prior)
                for name in changed:
                    current[name].update(loaded=False, running=False)
                restored = []
                with self.journal(prior, root=self.parent / str(index)) as journal:
                    def restore(unit, wanted):
                        restored.append(unit)
                        current[unit].update(wanted)
                    result = journal.recover(restore, lambda unit, wanted: {**current[unit], 'verified': True},
                                             lambda: {'verified': True})
                self.assertTrue(result['restored'])
                self.assertEqual(current, prior)
                self.assertEqual(restored, [name for name in names if name in changed])
                with self.journal(root=self.parent / str(index)) as journal:
                    journal.recover(lambda *_: self.fail('ready owner restarted'), lambda unit, wanted: {**wanted, 'verified': True}, lambda: {'verified': True})
                    journal.resolve()

    def test_missing_primary_baseline_uses_validated_copy_without_success_claim(self):
        with self.journal(PRIOR):
            pass
        (self.root / '000000.json').unlink()
        current = copy.deepcopy(PRIOR)
        current['mesh-agent'].update(loaded=False, running=False)
        with self.journal() as journal:
            result = journal.recover(lambda unit, prior: current[unit].update(prior),
                lambda unit, prior: {**current[unit], 'verified': True}, lambda: {'verified': True}, lambda _: None)
        self.assertFalse(result['restored'])
        self.assertTrue(result['services_verified'])
        self.assertEqual(current, PRIOR)
        with self.assertRaisesRegex(Refused, 'unresolved'):
            self.journal(PRIOR, root=self.parent / 'new-window')

    def test_an_unresolved_window_blocks_a_new_root_until_strict_recovery(self):
        with self.journal(PRIOR):
            pass
        other = self.parent / 'later-window'
        with self.assertRaisesRegex(Refused, 'unresolved'):
            self.journal(PRIOR, root=other)
        with self.journal() as journal:
            result = journal.recover(lambda *_: self.fail('ready owner restarted'),
                                    lambda unit, prior: {**prior, 'verified': True}, lambda: {'verified': True})
            self.assertTrue(result['restored'])
            journal.resolve()
        with self.journal(PRIOR, root=other):
            pass

    def test_running_timer_or_stopped_daemon_cannot_be_a_new_baseline(self):
        for index, kind in enumerate(('timer', 'daemon')):
            state = copy.deepcopy(PRIOR['mesh-agent'])
            state.update({'class': kind, 'running': kind == 'timer'})
            with self.assertRaisesRegex(Refused, 'desired service state'):
                self.journal(inventory({'nats': {}, 'mesh-agent': state}), root=self.parent / str(index))

    def test_idle_on_demand_worker_is_an_exact_restoration_baseline(self):
        prior = copy.deepcopy(PRIOR)
        prior['mesh-agent'].update({'class': 'on-demand', 'running': False})
        self.assertTrue(matches(prior['mesh-agent'], prior['mesh-agent']))
        self.assertFalse(matches({**prior['mesh-agent'], 'running': True}, prior['mesh-agent']))
        with self.journal(prior) as journal:
            self.assertEqual(journal.prior['mesh-agent'], prior['mesh-agent'])
        with self.journal() as journal:
            result = journal.recover(lambda *_: self.fail('idle worker was restarted'),
                lambda unit, state: {**state, 'verified': True}, lambda: {'verified': True})
            self.assertTrue(result['services_verified'])
            journal.resolve()

    def test_on_demand_class_refuses_a_running_or_unrelated_owner(self):
        for index, (unit, running) in enumerate((('mesh-agent', True), ('nats', False))):
            prior = copy.deepcopy(PRIOR)
            prior[unit].update({'class': 'on-demand', 'running': running})
            with self.assertRaisesRegex(Refused, 'desired service state'):
                self.journal(prior, root=self.parent / str(index))
        prior = copy.deepcopy(PRIOR)
        prior['mesh-agent'].update({'class': 'known-broken', 'running': False})
        with self.assertRaisesRegex(Refused, 'optional integration'):
            self.journal(prior, root=self.parent / 'misclassified-worker')

    def test_running_on_demand_worker_is_not_a_restoration_target(self):
        prior = copy.deepcopy(PRIOR)
        prior['mesh-agent'].update({'class': 'on-demand', 'running': False})
        restored = []
        with self.journal(prior) as journal:
            result = journal.recover(lambda unit, _: restored.append(unit),
                lambda unit, state: {**state, 'running': True if unit == 'mesh-agent' else state['running'],
                                     'verified': True},
                lambda: {'verified': True})
            self.assertFalse(result['restored'])
            self.assertEqual(restored, [])
            self.assertIn({'unit': 'mesh-agent', 'reason': 'Refused'}, result['errors'])
            self.assertFalse(any(row['event'] == 'restoration-intent' and row.get('unit') == 'mesh-agent'
                                 for row in journal.records))

    def test_known_broken_running_state_is_unconstrained_and_not_restarted(self):
        prior = inventory({'nats': {}, 'mesh-tool-discord': {'class': 'known-broken', 'running': False}})
        with self.journal(prior) as journal:
            result = journal.recover(lambda *_: self.fail('known-broken loop was restarted'),
                lambda unit, state: {**state, 'running': unit == 'nats', 'verified': True}, lambda: {'verified': True})
        self.assertTrue(result['restored'])

    def test_sealed_journal_has_a_pinned_head_and_cannot_be_changed_or_reopened(self):
        with self.journal(PRIOR) as journal:
            journal.recover(lambda *_: self.fail('ready owner restarted'),
                            lambda unit, prior: {**prior, 'verified': True}, lambda: {'verified': True})
            digest = journal.seal()
            self.assertEqual(digest, json.loads(max(self.root.glob('[0-9]*.json')).read_text())['sha256'])
            with self.assertRaisesRegex(Refused, 'sealed'):
                journal.append('late-change')
        with self.assertRaisesRegex(Refused, 'sealed'):
            self.journal()

    def test_missing_prior_record_prevents_a_later_window_from_inheriting_its_receipt(self):
        with self.journal(PRIOR) as journal:
            journal.recover(lambda *_: self.fail('ready owner restarted'),
                            lambda unit, prior: {**prior, 'verified': True}, lambda: {'verified': True})
        (self.root / '000001.json').unlink()
        with self.assertRaisesRegex(Refused, 'sequence has a gap'):
            self.journal(PRIOR, root=self.parent / 'later-window')

    def test_failed_node_restoration_receipt_cannot_be_sealed(self):
        from preservation_journal import write_private
        with self.journal(PRIOR) as journal:
            def write(path, value):
                if value.get('status') == 'restored':
                    raise OSError(errno.EIO, 'owned receipt fault')
                return write_private(path, value)
            with patch('preservation_journal.write_private', side_effect=write):
                result = journal.recover(lambda *_: self.fail('ready owner restarted'),
                    lambda unit, prior: {**prior, 'verified': True}, lambda: {'verified': True})
            self.assertFalse(result['restored'])
            self.assertTrue(result['services_verified'])
            with self.assertRaisesRegex(Refused, 'receipt is not durable'):
                journal.seal()

    def test_restoring_after_a_forward_failure_does_not_accept_the_failed_window(self):
        with self.journal(PRIOR) as journal:
            with self.assertRaises(Refused):
                journal.mutate('mesh-agent', 'unload', lambda: None, lambda: {'verified': False})
            result = journal.recover(lambda *_: self.fail('ready owner restarted'),
                                    lambda unit, prior: {**prior, 'verified': True}, lambda: {'verified': True})
            self.assertTrue(result['restored'])
            with self.assertRaisesRegex(Refused, 'failed forward window'):
                journal.seal()

    def test_closed_journal_cannot_restore_without_node_lock(self):
        journal = self.journal(PRIOR)
        journal.close()
        with self.assertRaisesRegex(Refused, 'node lock'):
            journal.recover(lambda *_: self.fail('unlocked mutation'), lambda *_: {}, lambda: {'verified': True})

    def test_missing_receipt_refuses_new_root_but_intact_primary_restores(self):
        with self.journal(PRIOR) as journal:
            receipt = journal.node_state
        receipt.unlink()
        with self.assertRaisesRegex(Refused, 'missing'):
            self.journal(PRIOR, root=self.parent / 'another')
        self.assertFalse((self.parent / 'another').exists())
        current = copy.deepcopy(PRIOR)
        current['mesh-agent'].update(loaded=False, running=False)
        restored = []
        with self.journal() as journal:
            def restore(unit, prior):
                restored.append(unit)
                current[unit].update(prior)
            result = journal.recover(restore, lambda unit, prior: {**current[unit], 'verified': True},
                                     lambda: {'verified': True})
            self.assertTrue(result['restored'])
            self.assertEqual(restored, ['mesh-agent'])
            journal.resolve()
        with self.journal(PRIOR, root=self.parent / 'another'):
            pass

    def test_corrupt_receipt_is_retained_and_primary_restoration_rebuilds_copy(self):
        with self.journal(PRIOR) as journal:
            receipt = journal.node_state
        receipt.write_bytes(b'{corrupt')
        with self.assertRaisesRegex(Refused, 'corrupt'):
            self.journal(PRIOR, root=self.parent / 'another')
        with self.journal() as journal:
            result = journal.recover(lambda *_: self.fail('ready owner restarted'),
                lambda unit, prior: {**prior, 'verified': True}, lambda: {'verified': True})
            self.assertTrue(result['restored'])
        saved = list(receipt.parent.glob('.corrupt-receipt-*'))
        self.assertEqual(len(saved), 1)
        self.assertEqual(saved[0].read_bytes(), b'{corrupt')

    def test_unsupported_intact_baseline_refuses_without_quarantining_receipt(self):
        with self.journal(PRIOR) as journal:
            receipt = journal.node_state
        original = receipt.read_bytes()
        with patch('preservation_journal.valid_prior', side_effect=Refused('service class is absent')):
            with self.assertRaisesRegex(Refused, 'service class is absent'):
                self.journal()
        self.assertEqual(receipt.read_bytes(), original)
        self.assertEqual(list(receipt.parent.glob('.corrupt-receipt-*')), [])
        with self.journal() as journal:
            result = journal.recover(lambda *_: self.fail('ready owner restarted'),
                lambda unit, prior: {**prior, 'verified': True}, lambda: {'verified': True})
            self.assertTrue(result['restored'])
            journal.resolve()

    def test_crash_between_terminal_record_and_receipt_reconciles_without_reopening_window(self):
        for index, terminal in enumerate(('seal', 'resolve')):
            root = self.parent / ('terminal-' + str(index))
            with self.journal(PRIOR, root=root) as journal:
                journal.recover(lambda *_: self.fail('ready owner restarted'),
                    lambda unit, prior: {**prior, 'verified': True}, lambda: {'verified': True})
                with patch('preservation_journal.write_private', side_effect=OSError(errno.EIO, 'receipt gap')):
                    with self.assertRaises(CommittedRefusal):
                        getattr(journal, terminal)()
            with self.assertRaisesRegex(Refused, 'sealed or resolved'):
                self.journal(root=root)
            state = json.loads(self.node_lock.with_name(self.node_lock.name + '.state.json').read_bytes())
            self.assertEqual(state['head'], json.loads(max(root.glob('[0-9]*.json')).read_bytes())['sha256'])
        with self.journal(PRIOR, root=self.parent / 'new'):
            pass

    def test_incomplete_inventory_and_held_daemon_cannot_create_a_window(self):
        with self.assertRaisesRegex(Refused, 'inventory'):
            self.journal({'nats': PRIOR['nats']})
        prior = copy.deepcopy(PRIOR)
        prior['mesh-agent'].update({'class': 'held', 'loaded': False, 'running': False, 'disabled': True})
        with self.assertRaisesRegex(Refused, 'only member-1'):
            self.journal(prior)
        self.assertFalse(self.root.exists())

    def test_loaded_busy_timer_is_never_restored_and_can_be_reobserved(self):
        prior = copy.deepcopy(PRIOR)
        prior['mesh-agent'].update({'class': 'timer', 'running': False})
        current = copy.deepcopy(prior)
        current['mesh-agent']['running'] = True
        with self.journal(prior) as journal:
            result = journal.recover(lambda *_: self.fail('busy timer restarted'),
                lambda unit, wanted: {**current[unit], 'verified': True}, lambda: {'verified': True})
            self.assertFalse(result['restored'])
            current['mesh-agent']['running'] = False
            result = journal.recover(lambda *_: self.fail('ready timer restarted'),
                lambda unit, wanted: {**current[unit], 'verified': True}, lambda: {'verified': True})
            self.assertTrue(result['restored'])

    def test_unserializable_observation_keeps_restoring_and_never_claims_durability(self):
        current = copy.deepcopy(PRIOR)
        current['mesh-agent'].update(loaded=False, running=False)
        diagnostics, restored, final = [], [], []
        with self.journal(PRIOR) as journal:
            def restore(unit, prior):
                restored.append(unit)
                current[unit].update(prior)
            result = journal.recover(restore,
                lambda unit, wanted: {**current[unit], 'verified': True, 'not_json': {'owned'}},
                lambda: final.append(True) or {'verified': True}, diagnostics.append)
            self.assertEqual(restored, ['mesh-agent'])
            self.assertEqual(final, [True])
            self.assertFalse(result['restored'])
            self.assertTrue(result['services_verified'])
            self.assertFalse(result['evidence_durable'])
            self.assertTrue(diagnostics)

    def test_static_identity_is_required_and_stays_available_when_unloaded(self):
        prior = copy.deepcopy(PRIOR)
        prior['mesh-agent']['identity'] = {'pid': 123}
        with self.assertRaisesRegex(Refused, 'static identity schema'):
            self.journal(prior)
        current = copy.deepcopy(PRIOR)
        current['mesh-agent'].update(loaded=False, running=False)
        with self.journal(PRIOR) as journal:
            result = journal.recover(lambda unit, wanted: current[unit].update(wanted),
                lambda unit, wanted: {**current[unit], 'verified': True}, lambda: {'verified': True})
            self.assertTrue(result['restored'])

    def test_identity_hashes_static_files_and_dependency_targets_without_loaded_job(self):
        import plistlib
        from preservation_journal import static_identity
        parent = pathlib.Path(self.temp.name)
        binary, entry, dependency = (parent / name for name in ('binary', 'entry.py', 'dependency.py'))
        for path in (binary, entry, dependency):
            path.write_bytes(b'owned original')
        alias = parent / 'dependency-link.py'
        alias.symlink_to(dependency)
        unit = parent / 'owned.plist'
        raw = plistlib.dumps({'ProgramArguments': [str(binary), str(entry)]})
        unit.write_bytes(raw)
        before = static_identity(unit, (entry,), {'owned': alias})
        unit.write_bytes(raw)
        self.assertEqual(static_identity(unit, (entry,), {'owned': alias}), before)
        dependency.write_bytes(b'owned changed')
        self.assertNotEqual(static_identity(unit, (entry,), {'owned': alias}), before)
        self.assertEqual(before['dependencies']['owned'], str(dependency.resolve()))
        self.assertEqual(before['working_directory'], '/')

    def test_receipt_readback_mismatch_prevents_forward_mutation(self):
        from preservation_journal import read_private
        def read(path):
            value = read_private(path)
            return {**value, 'status': 'restored'} if path.name.endswith('.state.json') else value
        with patch('preservation_journal.read_private', side_effect=read):
            with self.assertRaisesRegex(Refused, 'readback differs'):
                self.journal(PRIOR)
        self.assertFalse(self.root.exists())

    def test_receipt_write_failure_has_no_false_restored_claim_in_the_chain(self):
        from preservation_journal import read_private, write_private
        with self.journal(PRIOR) as journal:
            def write(path, value):
                if value.get('status') == 'restored':
                    raise OSError(errno.EIO, 'receipt write failure')
                return write_private(path, value)
            with patch('preservation_journal.write_private', side_effect=write):
                result = journal.recover(lambda *_: self.fail('ready owner restarted'),
                    lambda unit, wanted: {**wanted, 'verified': True}, lambda: {'verified': True}, lambda _: None)
            self.assertFalse(result['restored'])
            self.assertNotIn('restored', journal.records[-1])
            self.assertTrue(journal.records[-1]['services_verified'])
            self.assertEqual(read_private(journal.node_state)['status'], 'unresolved')

    def test_arbitrary_journal_parent_is_refused(self):
        with self.assertRaisesRegex(Refused, 'fixed persistent parent'):
            self.journal(PRIOR, root=pathlib.Path(self.temp.name) / 'escape')

    def test_lost_receipt_and_full_disk_still_allow_degraded_primary_restoration(self):
        with self.journal(PRIOR) as journal:
            receipt = journal.node_state
        receipt.unlink()
        current = copy.deepcopy(PRIOR)
        current['mesh-agent'].update(loaded=False, running=False)
        with patch('preservation_journal.write_private', side_effect=OSError(errno.ENOSPC, 'owned full disk')):
            with self.journal() as journal:
                result = journal.recover(lambda unit, wanted: current[unit].update(wanted),
                    lambda unit, wanted: {**current[unit], 'verified': True}, lambda: {'verified': True}, lambda _: None)
                self.assertFalse(result['restored'])
                self.assertTrue(result['services_verified'])
                self.assertFalse(result['evidence_durable'])
        with self.assertRaisesRegex(Refused, 'missing'):
            self.journal(PRIOR, root=self.parent / 'another')

    def test_corrupt_receipt_retention_failure_still_restores_without_overwriting_it(self):
        with self.journal(PRIOR) as journal:
            receipt = journal.node_state
        receipt.write_bytes(b'{owned-corrupt')
        current = copy.deepcopy(PRIOR)
        current['mesh-agent'].update(loaded=False, running=False)
        with patch('preservation_journal.os.rename', side_effect=OSError(errno.ENOSPC, 'cannot retain receipt')):
            with self.journal() as journal:
                result = journal.recover(lambda unit, wanted: current[unit].update(wanted),
                    lambda unit, wanted: {**current[unit], 'verified': True}, lambda: {'verified': True}, lambda _: None)
                self.assertFalse(result['restored'])
                self.assertTrue(result['services_verified'])
                self.assertFalse(result['evidence_durable'])
        self.assertEqual(receipt.read_bytes(), b'{owned-corrupt')

    def test_all_explicitly_absent_units_are_observed_without_installed_state_inference(self):
        prior = {unit: {'loaded': False, 'running': False, 'disabled': False, 'class': 'absent',
                        'identity': {'installed': False}} for unit in UNITS}
        observed = set()
        with self.journal(prior) as journal:
            def observe(unit, wanted):
                observed.add(unit)
                return {**wanted, 'verified': True}
            result = journal.recover(lambda *_: self.fail('absent unit installed'), observe, lambda: {'verified': True})
            self.assertTrue(result['restored'])
            self.assertEqual(observed, UNITS)

    def test_existing_missing_receipt_with_two_unfinished_roots_is_ambiguous(self):
        from preservation_journal import write_private
        with self.journal(PRIOR) as journal:
            baseline, receipt = journal.records[0], journal.node_state
        other = self.parent / 'orphan'
        other.mkdir(mode=0o700)
        write_private(other / '000000.json', baseline)
        receipt.unlink()
        with self.assertRaisesRegex(Refused, 'ambiguous'):
            self.journal()

    def test_a_restored_but_unfinalized_window_cannot_be_superseded(self):
        with self.journal(PRIOR) as journal:
            journal.recover(lambda *_: self.fail('ready owner restarted'),
                lambda unit, wanted: {**wanted, 'verified': True}, lambda: {'verified': True})
        with self.assertRaisesRegex(Refused, 'explicit finalization'):
            self.journal(PRIOR, root=self.parent / 'another')
        with self.journal() as journal:
            journal.recover(lambda *_: self.fail('ready owner restarted'),
                lambda unit, wanted: {**wanted, 'verified': True}, lambda: {'verified': True})
            journal.resolve()
        with self.journal(PRIOR, root=self.parent / 'another'):
            pass

    def test_lost_receipt_after_finalization_is_rebuilt_only_from_lineage_tip(self):
        roots = [self.parent / name for name in ('first', 'second')]
        for root in roots:
            with self.journal(PRIOR, root=root) as journal:
                journal.recover(lambda *_: self.fail('ready owner restarted'),
                    lambda unit, wanted: {**wanted, 'verified': True}, lambda: {'verified': True})
                journal.seal()
                receipt = journal.node_state
        receipt.unlink()
        with self.assertRaisesRegex(Refused, 'current journal'):
            self.journal(root=roots[0])
        with self.assertRaisesRegex(Refused, 'sealed or resolved'):
            self.journal(root=roots[1])
        with self.journal(PRIOR, root=self.parent / 'third'):
            pass

    def test_a_terminal_receipt_gap_is_repaired_directly_before_the_next_window(self):
        with self.journal(PRIOR) as journal:
            journal.recover(lambda *_: self.fail('ready owner restarted'),
                lambda unit, wanted: {**wanted, 'verified': True}, lambda: {'verified': True})
            with patch('preservation_journal.write_private', side_effect=OSError(errno.EIO, 'receipt gap')):
                with self.assertRaises(CommittedRefusal):
                    journal.seal()
        head = max(self.root.glob('[0-9]*.json')).read_bytes()
        with self.journal(PRIOR, root=self.parent / 'next'):
            pass
        self.assertEqual(max(self.root.glob('[0-9]*.json')).read_bytes(), head)

    def test_creation_interruptions_before_mkdir_and_after_baseline_are_restore_only(self):
        from preservation_journal import write_private
        for index, boundary in enumerate(('receipt', 'mkdir', 'baseline')):
            parent = pathlib.Path(self.temp.name) / ('creation-' + str(index))
            parent.mkdir(mode=0o700)
            root, lock = parent / 'journals/window', parent / 'node.lock'
            with legacy_journal(parent / 'journals/previous', PRIOR, boot='a', node_lock=lock) as previous:
                previous.recover(lambda *_: self.fail('previous ready owner restarted'),
                    lambda unit, wanted: {**wanted, 'verified': True}, lambda: {'verified': True})
                previous.seal()
            real_mkdir = pathlib.Path.mkdir
            def mkdir(path, *args, **kwargs):
                value = real_mkdir(path, *args, **kwargs)
                if path == root and boundary == 'mkdir':
                    raise OSError(errno.EIO, 'interrupted after mkdir')
                return value
            def write(path, value):
                write_private(path, value)
                if ((boundary == 'receipt' and value.get('phase') == 'initializing')
                        or (boundary == 'baseline' and path.name == '000000.json')):
                    raise OSError(errno.EIO, 'interrupted after durable setup write')
            with patch('preservation_journal.write_private', side_effect=write), \
                 patch('preservation_journal.pathlib.Path.mkdir', autospec=True, side_effect=mkdir):
                with self.assertRaises(OSError):
                    legacy_journal(root, PRIOR, boot='a', node_lock=lock)
            with Journal(root, boot='b', node_lock=lock) as journal:
                with self.assertRaisesRegex(Refused, 'reboot|reopened'):
                    journal.require_forward()
                result = journal.recover(lambda *_: self.fail('unchanged setup owner restarted'),
                    lambda unit, wanted: {**wanted, 'verified': True}, lambda: {'verified': True})
                self.assertTrue(result['restored'])
                journal.resolve()
            with legacy_journal(parent / 'journals/next', PRIOR, boot='b', node_lock=lock):
                pass

    def test_setup_repair_full_disk_restores_from_the_prepared_receipt(self):
        from preservation_journal import write_private
        def write(path, value):
            write_private(path, value)
            if value.get('phase') == 'initializing':
                raise OSError(errno.EIO, 'crash before mkdir')
        with patch('preservation_journal.write_private', side_effect=write):
            with self.assertRaises(OSError):
                self.journal(PRIOR)
        current = copy.deepcopy(PRIOR)
        current['mesh-agent'].update(loaded=False, running=False)
        with patch('preservation_journal.write_private', side_effect=OSError(errno.ENOSPC, 'setup disk full')):
            with self.journal() as journal:
                result = journal.recover(lambda unit, wanted: current[unit].update(wanted),
                    lambda unit, wanted: {**current[unit], 'verified': True}, lambda: {'verified': True}, lambda _: None)
                self.assertTrue(result['services_verified'])
                self.assertFalse(result['evidence_durable'])
                self.assertFalse(result['restored'])

    def test_finder_metadata_is_ignored_but_unknown_entries_refuse_cleanly(self):
        (self.parent / '.DS_Store').write_bytes(b'owned Finder metadata')
        with self.journal(PRIOR) as journal:
            journal.recover(lambda *_: self.fail('ready owner restarted'),
                lambda unit, wanted: {**wanted, 'verified': True}, lambda: {'verified': True})
            journal.seal()
        with self.journal(PRIOR, root=self.parent / 'second') as journal:
            journal.recover(lambda *_: self.fail('ready owner restarted'),
                lambda unit, wanted: {**wanted, 'verified': True}, lambda: {'verified': True})
            journal.resolve()
        (self.parent / 'unknown-file').write_bytes(b'unknown')
        with self.assertRaisesRegex(Refused, 'unexpected entry'):
            self.journal(PRIOR, root=self.parent / 'third')

    def test_initializing_finder_metadata_preserves_restore_only_recovery(self):
        from preservation_journal import write_private
        for index, boundary in enumerate(('receipt', 'mkdir', 'baseline')):
            parent = pathlib.Path(self.temp.name) / ('finder-setup-' + str(index))
            parent.mkdir(mode=0o700)
            root, lock = parent / 'journals/window', parent / 'node.lock'
            with legacy_journal(parent / 'journals/previous', PRIOR, boot='a', node_lock=lock) as previous:
                previous.recover(lambda *_: self.fail('ready owner restarted'),
                    lambda unit, wanted: {**wanted, 'verified': True}, lambda: {'verified': True})
                previous.seal()
            real_mkdir = pathlib.Path.mkdir
            def mkdir(path, *args, **kwargs):
                value = real_mkdir(path, *args, **kwargs)
                if path == root and boundary == 'mkdir':
                    raise OSError(errno.EIO, 'interrupted after mkdir')
                return value
            def write(path, value):
                write_private(path, value)
                if ((boundary == 'receipt' and value.get('phase') == 'initializing')
                        or (boundary == 'baseline' and path.name == '000000.json')):
                    raise OSError(errno.EIO, 'interrupted setup')
            with patch('preservation_journal.write_private', side_effect=write), \
                 patch('preservation_journal.pathlib.Path.mkdir', autospec=True, side_effect=mkdir):
                with self.assertRaises(OSError):
                    legacy_journal(root, PRIOR, boot='a', node_lock=lock)
            root.mkdir(mode=0o700, exist_ok=True)
            metadata = root / '.DS_Store'
            metadata.write_bytes(b'owned Finder metadata')
            with Journal(root, boot='b', node_lock=lock) as journal:
                with self.assertRaisesRegex(Refused, 'reboot|reopened'):
                    journal.require_forward()
                self.assertTrue(journal.recover(lambda *_: self.fail('unchanged owner restarted'),
                    lambda unit, wanted: {**wanted, 'verified': True}, lambda: {'verified': True})['restored'])
                journal.resolve()
            self.assertEqual(metadata.read_bytes(), b'owned Finder metadata')
            with legacy_journal(parent / 'journals/next', PRIOR, boot='b', node_lock=lock):
                pass

    def test_initializing_metadata_links_owners_and_unknown_entries_remain_fenced(self):
        from preservation_journal import write_private
        for index, kind in enumerate(('link', 'directory', 'foreign-owner', 'unknown')):
            parent = pathlib.Path(self.temp.name) / ('finder-refusal-' + str(index))
            parent.mkdir(mode=0o700)
            root, lock = parent / 'journals/window', parent / 'node.lock'
            def write(path, value):
                write_private(path, value)
                if value.get('phase') == 'initializing':
                    raise OSError(errno.EIO, 'interrupted setup')
            with patch('preservation_journal.write_private', side_effect=write):
                with self.assertRaises(OSError):
                    legacy_journal(root, PRIOR, boot='a', node_lock=lock)
            root.mkdir(mode=0o700)
            metadata = root / ('.DS_Store' if kind != 'unknown' else 'unknown-file')
            if kind == 'link':
                target = parent / 'outside'
                target.write_bytes(b'owned target')
                metadata.symlink_to(target)
            elif kind == 'directory':
                metadata.mkdir(mode=0o700)
            else:
                metadata.write_bytes(b'owned metadata')
            real_lstat = pathlib.Path.lstat
            def lstat(path):
                info = real_lstat(path)
                if path == metadata and kind == 'foreign-owner':
                    fields = list(info)
                    fields[4] = os.getuid() + 1
                    return os.stat_result(fields)
                return info
            with patch('preservation_journal.pathlib.Path.lstat', autospec=True, side_effect=lstat):
                with self.assertRaisesRegex(Refused, 'Finder metadata|unknown files'):
                    Journal(root, boot='b', node_lock=lock)
                next_root = parent / 'journals/next'
                with self.assertRaisesRegex(Refused, 'prior node recovery is unresolved'):
                    legacy_journal(next_root, PRIOR, boot='b', node_lock=lock)
                self.assertFalse(next_root.exists())
            self.assertTrue(os.path.lexists(metadata))

    def test_static_identity_hashes_entry_and_config_arguments_without_extra_files(self):
        import plistlib
        from preservation_journal import static_identity
        parent = pathlib.Path(self.temp.name)
        binary, entry, config = (parent / name for name in ('node', 'entry.js', 'nats.conf'))
        for path in (binary, entry, config):
            path.write_bytes(b'owned original')
        unit = parent / 'owned.plist'
        unit.write_bytes(plistlib.dumps({'ProgramArguments': [str(binary), 'entry.js', '--config', str(config)],
                                        'WorkingDirectory': str(parent)}))
        before = static_identity(unit)
        entry.write_bytes(b'changed entry')
        after_entry = static_identity(unit)
        self.assertNotEqual(after_entry, before)
        config.write_bytes(b'changed config')
        self.assertNotEqual(static_identity(unit), after_entry)
        with self.assertRaisesRegex(Refused, 'resolved entry files'):
            static_identity(unit, dependencies={'package': parent})

    def test_static_identity_refuses_special_files_before_reading(self):
        import plistlib
        from preservation_journal import static_identity
        parent = pathlib.Path(self.temp.name)
        fifo = parent / 'fake-node'
        os.mkfifo(fifo)
        plist = parent / 'owned.plist'
        plist.write_bytes(plistlib.dumps({'ProgramArguments': [str(fifo)]}))
        def deadline(*_):
            raise AssertionError('static identity read blocked')
        previous = signal.signal(signal.SIGALRM, deadline)
        signal.setitimer(signal.ITIMER_REAL, 3)
        try:
            with self.assertRaisesRegex(Refused, 'bounded regular file'):
                static_identity(plist)
            with self.assertRaisesRegex(Refused, 'bounded regular file'):
                static_identity(fifo)
        finally:
            signal.setitimer(signal.ITIMER_REAL, 0)
            signal.signal(signal.SIGALRM, previous)

    def test_static_identity_refuses_symlinked_and_oversized_plists(self):
        from preservation_journal import static_identity
        parent = pathlib.Path(self.temp.name)
        plist = parent / 'owned.plist'
        plist.write_bytes(b'plist')
        alias = parent / 'alias.plist'
        alias.symlink_to(plist)
        with self.assertRaises(Refused):
            static_identity(alias)
        with plist.open('wb') as handle:
            handle.truncate((1 << 20) + 1)
        with self.assertRaisesRegex(Refused, 'bounded regular file'):
            static_identity(plist)

    def test_static_identity_binds_the_resolved_working_directory(self):
        import plistlib
        from preservation_journal import static_identity
        parent = pathlib.Path(self.temp.name)
        binary = parent / 'node'
        binary.write_bytes(b'owned binary')
        first, second, alias = (parent / name for name in ('first-cwd', 'second-cwd', 'cwd'))
        first.mkdir(); second.mkdir(); alias.symlink_to(first, target_is_directory=True)
        unit = parent / 'owned.plist'
        unit.write_bytes(plistlib.dumps({'ProgramArguments': [str(binary)], 'WorkingDirectory': str(alias)}))
        before = static_identity(unit)
        alias.unlink(); alias.symlink_to(second, target_is_directory=True)
        self.assertNotEqual(static_identity(unit), before)

    def test_mac_boot_identity_uses_uuid_and_fullsync_flushes_file_and_directory(self):
        from preservation_journal import boot_identity, sync_dir, sync_fd
        with patch('preservation_journal.sys.platform', 'darwin'), \
             patch('preservation_journal.subprocess.check_output', return_value='owned-uuid\n') as command:
            with patch.dict(os.environ, {'TZ': 'UTC'}):
                first = boot_identity()
            with patch.dict(os.environ, {'TZ': 'America/Montreal'}):
                self.assertEqual(boot_identity(), first)
            command.assert_called_with(['/usr/sbin/sysctl', '-n', 'kern.bootsessionuuid'], text=True)
        file = pathlib.Path(self.temp.name) / 'flush'
        file.write_bytes(b'owned')
        fd = os.open(file, os.O_RDONLY)
        try:
            with patch('preservation_journal.sys.platform', 'darwin'), \
                 patch('preservation_journal.fcntl.F_FULLFSYNC', 51, create=True), \
                 patch('preservation_journal.fcntl.fcntl') as flush:
                sync_fd(fd)
                sync_dir(pathlib.Path(self.temp.name))
                self.assertEqual(flush.call_count, 2)
        finally:
            os.close(fd)


if __name__ == '__main__':
    unittest.main()
