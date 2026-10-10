import copy
import hashlib
import os
import json
from pathlib import Path
import sys
import unittest
import uuid
from types import SimpleNamespace
from unittest.mock import patch


REPO = Path(__file__).resolve().parents[1]
AUDIT = REPO / 'memory-plan/plans/node-state-recovery/audits/step12_jetstream'
sys.path.insert(0, str(REPO / 'lib'))
sys.path.insert(0, str(AUDIT))

import nats_user_transfer as module
import test_preservation_journal as fixture_module
import test_journal_hold as hold_fixture
from journal_hold import JournaledHold, describe


class UserTransferTest(unittest.TestCase):
    def test_root_validates_excluded_job_schema_and_boot(self):
        prior = fixture_module.full_node_inventory()
        inventory = fixture_module.full_entrypoint_evidence(prior)
        inventory['excluded'] = fixture_module.tailscale_record()
        baseline = {'event': 'baseline', 'scope': 'full-node', 'prior': prior,
                    'entrypoint_inventory': inventory, 'boot': '6' * 64}
        module.valid_baseline(baseline)
        for change in (
            {'boot': '7' * 64},
            {'entrypoint_inventory': {**inventory, 'excluded': {
                **inventory['excluded'], 'com.openclaw.agent': {}}}},
            {'entrypoint_inventory': {**inventory, 'excluded': {
                fixture_module.TAILSCALE_LABEL: {
                    **inventory['excluded'][fixture_module.TAILSCALE_LABEL],
                    'launchd': {**inventory['excluded'][fixture_module.TAILSCALE_LABEL]['launchd'],
                                'runs': True}}}}},
            {'entrypoint_inventory': {**inventory, 'overrides': {
                **inventory['overrides'], 'gui': {
                    **inventory['overrides']['gui'], 'ai.openclaw.nats-1': False}}}},
            {'entrypoint_inventory': {**inventory, 'overrides': {
                **inventory['overrides'], 'gui': {
                    key: value for key, value in inventory['overrides']['gui'].items()
                    if key != 'ai.openclaw.nats-1'}}}},
        ):
            with self.subTest(change=change):
                with self.assertRaises(module.Refused):
                    module.valid_baseline({**baseline, **change})

    def prepared(self, extra_event=None, boot='boot-a', missing_listener=False,
                 late_listener=False):
        fixture = fixture_module.JournalTests('test_nats_transfer_freezes_user_journal_before_root_outcome')
        fixture.setUp()
        self.addCleanup(fixture.tearDown)
        self.addCleanup(fixture.doCleanups)
        prior = fixture_module.full_node_inventory()
        loaded = fixture_module.full_entrypoint_evidence(prior)
        inventory_patch = patch('preservation_journal.capture_entrypoint_inventory',
                                side_effect=lambda _: copy.deepcopy(loaded))
        inventory_patch.start()
        fixture.addCleanup(inventory_patch.stop)
        marker_patch = patch('preservation_journal.NATS_WRITER_MARKER',
                             fixture.parent / 'writer-handoff.json')
        marker_patch.start()
        fixture.addCleanup(marker_patch.stop)
        journal = fixture_module.Journal(fixture.root, prior, boot=boot,
                                         node_lock=fixture.node_lock,
                                         scope=fixture_module.FULL_NODE_SCOPE)
        fixture.addCleanup(journal.close)
        certificate = {'verified': True, 'restoration_only': False,
                       'kernel_file_watch': True,
                       'path_watch': {'kernel_path_watch': True},
                       'watch_session_id': 'owned-session'}
        hold = SimpleNamespace(journal=journal, check_forward=lambda: certificate)
        fields = {'baseline': journal.records[0]['sha256'], 'window': 'hold-' + 'a' * 64,
                  'reason': 'preservation execution hold', 'protective': False}
        intent = journal.append('intent', unit='scheduler-heartbeat',
                                action='close-execution-hold', hold=fields)
        journal.append('hold-published', intent=intent['sequence'],
                       receipt={'marker': {'window': fields['window'], 'reason': fields['reason']}},
                       adopted_for_restoration=False)
        journal.append('verified', intent=intent['sequence'], unit='scheduler-heartbeat',
                       action='close-execution-hold',
                       evidence={**certificate,
                                 'entrypoint_loaded': copy.deepcopy(loaded['loaded']),
                                 'entrypoint_overrides': copy.deepcopy(loaded['overrides'])})
        if not missing_listener:
            journal.mutate('mesh-deploy-listener', 'disable-and-unload',
                           lambda: fixture_module.fence_listener(loaded),
                           lambda: {**fixture_module.listener_stop_evidence(),
                                    'execution_hold': certificate}, hold=hold)
        for unit in ('nats', 'nats-2', 'nats-3'):
            if missing_listener:
                intent = journal.append('intent', unit=unit, action='disable-and-unload')
                fixture_module.fence_unit(loaded, unit)
                journal.append('verified', intent=intent['sequence'], unit=unit,
                               action='disable-and-unload', evidence={
                                   **fixture_module.listener_stop_evidence(unit),
                                   'execution_hold': certificate,
                                   'entrypoint_loaded': copy.deepcopy(loaded['loaded']),
                                   'entrypoint_overrides': copy.deepcopy(loaded['overrides'])})
            else:
                journal.mutate(unit, 'disable-and-unload',
                               lambda unit=unit: fixture_module.fence_unit(loaded, unit),
                               lambda unit=unit: {**fixture_module.listener_stop_evidence(unit),
                                        'execution_hold': certificate}, hold=hold)
        def observe(unit, saved):
            if unit == 'nats-1':
                return {**saved, 'verified': True}
            return {**saved, 'loaded': False, 'running': False, 'disabled': True,
                    'verified': True}
        if late_listener:
            intent = journal.append('intent', unit='mesh-deploy-listener',
                                    action='disable-and-unload')
            fixture_module.fence_listener(loaded)
            journal.append('verified', intent=intent['sequence'],
                unit='mesh-deploy-listener', action='disable-and-unload',
                evidence={**fixture_module.listener_stop_evidence(),
                          'execution_hold': certificate,
                          'entrypoint_loaded': copy.deepcopy(loaded['loaded']),
                          'entrypoint_overrides': copy.deepcopy(loaded['overrides'])})
        transaction = str(uuid.uuid4())
        if extra_event is not None:
            journal.append(extra_event)
        if missing_listener:
            transfer = journal.append('nats-transfer-intent', root_transaction=transaction,
                units=list(fixture_module.NATS_TRANSFER_UNITS),
                baseline_sha256=journal.records[0]['sha256'],
                observations={unit: observe(unit, prior[unit])
                              for unit in fixture_module.NATS_TRANSFER_UNITS},
                entrypoint_overrides=copy.deepcopy(loaded['overrides']),
                hold_sha256=hashlib.sha256(module.encoded(certificate)).hexdigest(),
                hold_evidence=certificate)
        else:
            transfer = journal.transfer_nats(transaction, hold, observe)
        return fixture, journal, transaction, transfer

    def test_root_refuses_transfer_without_listener_stop_receipt(self):
        fixture, journal, transaction, _ = self.prepared(missing_listener=True)
        journal.close()
        with patch.object(module, 'boot_identity', return_value='boot-a'):
            with self.assertRaisesRegex(module.Refused, 'listener stop intent is absent'):
                module.UserTransfer(fixture.node_lock, fixture.root, os.getuid(), transaction)

    def test_root_refuses_a_plain_nats_unload_receipt(self):
        _, journal, transaction, _ = self.prepared()
        reader = object.__new__(module.UserTransfer)
        reader.records = copy.deepcopy(journal.records)
        reader.transaction = transaction
        reader.prior_boot = False
        reader.decline_only = False
        for row in reader.records:
            if row.get('unit') == 'nats' and row['event'] in ('intent', 'verified'):
                row['action'] = 'unload'
        with patch.object(module, 'boot_identity', return_value='boot-a'):
            with self.assertRaisesRegex(module.Refused, 'NATS stop receipt is absent'):
                reader._validate()

    def test_root_refuses_listener_stopped_after_nats(self):
        fixture, journal, transaction, _ = self.prepared(
            missing_listener=True, late_listener=True)
        journal.close()
        with patch.object(module, 'boot_identity', return_value='boot-a'):
            with self.assertRaisesRegex(module.Refused, 'listener stop intent is absent or out of order'):
                module.UserTransfer(fixture.node_lock, fixture.root, os.getuid(), transaction)

    def test_root_refuses_nats_intent_before_listener_stop_proof(self):
        fixture, journal, transaction, _ = self.prepared()
        journal.close()
        rows = copy.deepcopy(journal.records)
        listener_index = next(index for index, row in enumerate(rows)
                              if row['event'] == 'verified'
                              and row.get('unit') == 'mesh-deploy-listener')
        nats_index = next(index for index, row in enumerate(rows)
                          if row['event'] == 'intent' and row.get('unit') == 'nats')
        self.assertEqual(nats_index, listener_index + 1)
        rows[listener_index], rows[nats_index] = rows[nats_index], rows[listener_index]
        nats_verified = next(row for row in rows if row['event'] == 'verified'
                             and row.get('unit') == 'nats')
        nats_verified['intent'] = listener_index
        for index, row in enumerate(rows):
            row['sequence'] = index
            row['previous'] = rows[index - 1]['sha256'] if index else None
            row['sha256'] = hashlib.sha256(module.encoded(
                {key: value for key, value in row.items() if key != 'sha256'})).hexdigest()
            (fixture.root / f'{index:06d}.json').write_bytes(module.encoded(row))
        with patch.object(module, 'boot_identity', return_value='boot-a'):
            with self.assertRaisesRegex(module.Refused, 'service intent precedes listener stop proof'):
                module.UserTransfer(fixture.node_lock, fixture.root, os.getuid(), transaction)

    def test_root_refuses_listener_proof_before_its_intent(self):
        fixture, journal, transaction, _ = self.prepared()
        journal.close()
        rows = copy.deepcopy(journal.records)
        intent_index = next(index for index, row in enumerate(rows)
                            if row['event'] == 'intent'
                            and row.get('unit') == 'mesh-deploy-listener')
        proof_index = intent_index + 1
        self.assertEqual(rows[proof_index]['event'], 'verified')
        rows[intent_index], rows[proof_index] = rows[proof_index], rows[intent_index]
        rows[intent_index]['intent'] = proof_index
        for index, row in enumerate(rows):
            row['sequence'] = index
            row['previous'] = rows[index - 1]['sha256'] if index else None
            row['sha256'] = hashlib.sha256(module.encoded(
                {key: value for key, value in row.items() if key != 'sha256'})).hexdigest()
            (fixture.root / f'{index:06d}.json').write_bytes(module.encoded(row))
        with patch.object(module, 'boot_identity', return_value='boot-a'):
            with self.assertRaisesRegex(module.Refused, 'listener stop receipt is absent or precedes'):
                module.UserTransfer(fixture.node_lock, fixture.root, os.getuid(), transaction)

    def test_root_refuses_incomplete_listener_stop_proof(self):
        overrides = fixture_module.full_entrypoint_evidence(
            fixture_module.full_node_inventory())['overrides']
        overrides['gui']['ai.openclaw.mesh-deploy-listener'] = True
        overrides['user']['ai.openclaw.mesh-deploy-listener'] = None
        user_only_overrides = copy.deepcopy(overrides)
        user_only_overrides['gui']['ai.openclaw.mesh-deploy-listener'] = None
        user_only_overrides['user']['ai.openclaw.mesh-deploy-listener'] = True
        changes = [(key, False) for key in module.LISTENER_STOP_FIELDS]
        changes += [('bootout', {'returncode': 1, 'timed_out': False}),
                    ('bootout', {'returncode': 0, 'timed_out': True}),
                    ('verified', False),
                    ('execution_hold', {'watch_session_id': 'other-session'}),
                    ('entrypoint_loaded', {'gui': ['ai.openclaw.mesh-deploy-listener'],
                                           'user': [], 'system': []}),
                    ('entrypoint_overrides', {'gui': {}, 'user': {}, 'system': {}}),
                    ('entrypoint_overrides', overrides),
                    ('entrypoint_overrides', user_only_overrides),
                    ('termination', {'signal': 9})]
        for field, value in changes:
            with self.subTest(field=field):
                fixture, journal, transaction, _ = self.prepared()
                journal.close()
                rows = copy.deepcopy(journal.records)
                listener = next(row for row in rows if row['event'] == 'verified'
                                and row.get('unit') == 'mesh-deploy-listener')
                listener['evidence'][field] = value
                for index, row in enumerate(rows):
                    row['previous'] = rows[index - 1]['sha256'] if index else None
                    row['sha256'] = hashlib.sha256(module.encoded(
                        {key: value for key, value in row.items() if key != 'sha256'})).hexdigest()
                    (fixture.root / f'{index:06d}.json').write_bytes(module.encoded(row))
                with patch.object(module, 'boot_identity', return_value='boot-a'):
                    with self.assertRaisesRegex(module.Refused, 'listener stop proof differs'):
                        module.UserTransfer(fixture.node_lock, fixture.root, os.getuid(), transaction)

    def test_root_refuses_incomplete_nats_stop_proof(self):
        fixture, journal, transaction, _ = self.prepared()
        def reader():
            value = object.__new__(module.UserTransfer)
            value.records = copy.deepcopy(journal.records)
            value.transaction = transaction
            value.prior_boot = False
            value.decline_only = False
            value.node_lock = fixture.node_lock
            value.journal_root = fixture.root
            value.uid = os.getuid()
            return value
        with patch.object(module, 'boot_identity', return_value='boot-a'):
            intact = reader()
            intact._validate()
            self.assertTrue(intact.observation['verified'])
        for unit in ('nats', 'nats-2', 'nats-3'):
            for field, value in (('verified', False),
                                 ('unit_unloaded', False),
                                 ('bootout', {'returncode': 1, 'timed_out': False}),
                                 ('bootout', {'returncode': 0, 'timed_out': True}),
                                 ('termination', {'signal': 9})):
                with self.subTest(unit=unit, field=field):
                    altered = reader()
                    row = next(row for row in altered.records if row['event'] == 'verified'
                               and row.get('unit') == unit)
                    row['evidence'][field] = value
                    with patch.object(module, 'boot_identity', return_value='boot-a'):
                        with self.assertRaisesRegex(module.Refused, 'NATS stop receipt is absent'):
                            altered._validate()

    def test_root_refuses_held_member_override_loss_in_nats_receipt(self):
        fixture, journal, transaction, _ = self.prepared()
        journal.close()
        rows = copy.deepcopy(journal.records)
        nats = next(row for row in rows if row['event'] == 'verified'
                    and row.get('unit') == 'nats')
        nats['evidence']['entrypoint_overrides']['gui']['ai.openclaw.nats-1'] = False
        for index, row in enumerate(rows):
            row['previous'] = rows[index - 1]['sha256'] if index else None
            row['sha256'] = hashlib.sha256(module.encoded(
                {key: value for key, value in row.items() if key != 'sha256'})).hexdigest()
            (fixture.root / f'{index:06d}.json').write_bytes(module.encoded(row))
        with patch.object(module, 'boot_identity', return_value='boot-a'):
            with self.assertRaisesRegex(module.Refused, 'disabled override continuity differs'):
                module.UserTransfer(fixture.node_lock, fixture.root, os.getuid(), transaction)

    def test_root_refuses_override_loss_in_original_hold_receipt(self):
        fixture, journal, transaction, _ = self.prepared()
        journal.close()
        rows = copy.deepcopy(journal.records)
        hold = next(row for row in rows if row['event'] == 'verified'
                    and row.get('action') == 'close-execution-hold')
        hold['evidence']['entrypoint_overrides']['gui']['ai.openclaw.nats-1'] = False
        for index, row in enumerate(rows):
            row['previous'] = rows[index - 1]['sha256'] if index else None
            row['sha256'] = hashlib.sha256(module.encoded(
                {key: value for key, value in row.items() if key != 'sha256'})).hexdigest()
            (fixture.root / f'{index:06d}.json').write_bytes(module.encoded(row))
        with patch.object(module, 'boot_identity', return_value='boot-a'):
            with self.assertRaisesRegex(module.Refused, 'disabled override continuity differs'):
                module.UserTransfer(fixture.node_lock, fixture.root, os.getuid(), transaction)

    def test_root_refuses_extra_verified_receipt_before_listener(self):
        fixture, journal, transaction, _ = self.prepared()
        journal.close()
        rows = copy.deepcopy(journal.records)
        insert_at = next(index for index, row in enumerate(rows)
                         if row['event'] == 'intent'
                         and row.get('unit') == 'mesh-deploy-listener')
        extra = copy.deepcopy(rows[insert_at - 1])
        extra['unit'] = 'observer'
        extra['action'] = 'unload'
        rows.insert(insert_at, extra)
        for index, row in enumerate(rows):
            if index > insert_at and isinstance(row.get('intent'), int) and row['intent'] >= insert_at:
                row['intent'] += 1
            row['sequence'] = index
            row['previous'] = rows[index - 1]['sha256'] if index else None
            row['sha256'] = hashlib.sha256(module.encoded(
                {key: value for key, value in row.items() if key != 'sha256'})).hexdigest()
            (fixture.root / f'{index:06d}.json').write_bytes(module.encoded(row))
            (fixture.root / f'{index:06d}.json').chmod(0o600)
        with patch.object(module, 'boot_identity', return_value='boot-a'):
            with self.assertRaisesRegex(module.Refused, 'unexpected pre-listener receipt'):
                module.UserTransfer(fixture.node_lock, fixture.root, os.getuid(), transaction)

    def test_root_refuses_override_loss_at_transfer_intent(self):
        fixture, journal, transaction, _ = self.prepared()
        journal.close()
        rows = copy.deepcopy(journal.records)
        transfer = rows[-1]
        transfer['entrypoint_overrides']['gui']['ai.openclaw.nats-1'] = False
        transfer['sha256'] = hashlib.sha256(module.encoded(
            {key: value for key, value in transfer.items() if key != 'sha256'})).hexdigest()
        (fixture.root / f'{len(rows) - 1:06d}.json').write_bytes(module.encoded(transfer))
        with patch.object(module, 'boot_identity', return_value='boot-a'):
            with self.assertRaisesRegex(module.Refused, 'disabled override continuity differs'):
                module.UserTransfer(fixture.node_lock, fixture.root, os.getuid(), transaction)

    def test_root_refuses_live_owner_then_pins_exact_transfer(self):
        fixture, journal, transaction, transfer = self.prepared()
        with patch.object(module, 'boot_identity', return_value='boot-a'):
            with self.assertRaisesRegex(module.Refused, 'controller still holds'):
                module.UserTransfer(fixture.node_lock, fixture.root, os.getuid(), transaction)
            journal.close()
            with module.UserTransfer(fixture.node_lock, fixture.root, os.getuid(), transaction) as reader:
                self.assertEqual(reader.observation['head'], transfer['sha256'])
                self.assertEqual(reader.observation['baseline_sha256'], journal.records[0]['sha256'])
                self.assertEqual(reader.recheck(), reader.observation)

    def test_root_refuses_a_changed_head_and_wrong_boot(self):
        fixture, journal, transaction, _ = self.prepared()
        journal.close()
        with patch.object(module, 'boot_identity', return_value='another-boot'):
            with self.assertRaisesRegex(module.Refused, 'current boot'):
                module.UserTransfer(fixture.node_lock, fixture.root, os.getuid(), transaction)
        with patch.object(module, 'boot_identity', return_value='boot-a'):
            with module.UserTransfer(fixture.node_lock, fixture.root, os.getuid(), transaction) as reader:
                extra = fixture.root / f'{len(journal.records):06d}.json'
                extra.write_text('{}')
                extra.chmod(0o600)
                with self.assertRaisesRegex(module.Refused, 'journal chain differs'):
                    reader.recheck()

    def test_root_refuses_pending_file_and_mismatched_node_receipt(self):
        fixture, journal, transaction, _ = self.prepared()
        journal.close()
        pending = fixture.root / ('.pending-' + uuid.uuid4().hex)
        pending.write_bytes(b'partial')
        pending.chmod(0o600)
        with patch.object(module, 'boot_identity', return_value='boot-a'):
            with self.assertRaisesRegex(module.Refused, 'pending or unknown'):
                module.UserTransfer(fixture.node_lock, fixture.root, os.getuid(), transaction)
            pending.unlink()
            receipt = fixture.node_lock.with_name(fixture.node_lock.name + '.state.json')
            saved = json.loads(receipt.read_text())
            receipt.write_text(json.dumps({**saved, 'status': 'restored'}))
            receipt.chmod(0o600)
            with self.assertRaisesRegex(module.Refused, 'node receipt differs'):
                module.UserTransfer(fixture.node_lock, fixture.root, os.getuid(), transaction)

    def test_root_requires_transfer_intent_to_be_the_last_record(self):
        fixture, journal, transaction, _ = self.prepared()
        journal._append_durable('verified', intent=999, unit='nats', action='unload',
                                evidence={'verified': True})
        journal.close()
        with patch.object(module, 'boot_identity', return_value='boot-a'):
            with self.assertRaisesRegex(module.Refused, 'transfer intent differs'):
                module.UserTransfer(fixture.node_lock, fixture.root, os.getuid(), transaction)

    def test_root_refuses_transfer_without_original_hold_publication(self):
        fixture = fixture_module.JournalTests('test_nats_transfer_freezes_user_journal_before_root_outcome')
        fixture.setUp()
        self.addCleanup(fixture.tearDown)
        self.addCleanup(fixture.doCleanups)
        journal, hold, observe, _ = fixture.prepared_nats_transfer()
        transaction = str(uuid.uuid4())
        journal.transfer_nats(transaction, hold, observe)
        journal.close()
        with patch.object(module, 'boot_identity', return_value='boot-a'):
            with self.assertRaisesRegex(module.Refused, 'original hold publication differs'):
                module.UserTransfer(fixture.node_lock, fixture.root, os.getuid(), transaction)

    def test_root_refuses_transfer_with_changed_hold_certificate(self):
        fixture, journal, transaction, _ = self.prepared()
        journal.close()
        transfer = copy.deepcopy(journal.records[-1])
        transfer['hold_evidence']['watch_session_id'] = 'other-session'
        transfer['hold_sha256'] = hashlib.sha256(
            module.encoded(transfer['hold_evidence'])).hexdigest()
        transfer['sha256'] = hashlib.sha256(module.encoded(
            {key: value for key, value in transfer.items() if key != 'sha256'})).hexdigest()
        (fixture.root / f'{transfer["sequence"]:06d}.json').write_bytes(module.encoded(transfer))
        with patch.object(module, 'boot_identity', return_value='boot-a'):
            with self.assertRaisesRegex(module.Refused, 'original hold certificate differs'):
                module.UserTransfer(fixture.node_lock, fixture.root, os.getuid(), transaction)

    def test_root_refuses_replaced_owner_lock_during_recheck(self):
        fixture, journal, transaction, _ = self.prepared()
        journal.close()
        with patch.object(module, 'boot_identity', return_value='boot-a'):
            with module.UserTransfer(fixture.node_lock, fixture.root, os.getuid(), transaction) as reader:
                fixture.node_lock.rename(fixture.parent / 'old-node.lock')
                fixture.node_lock.write_bytes(b'')
                fixture.node_lock.chmod(0o600)
                with self.assertRaisesRegex(module.Refused, 'lock changed during root admission'):
                    reader.recheck()

    def test_root_tolerates_owner_finder_metadata(self):
        fixture, journal, transaction, transfer = self.prepared()
        journal.close()
        metadata = fixture.root / '.DS_Store'
        metadata.write_bytes(b'Finder metadata')
        metadata.chmod(0o640)
        with patch.object(module, 'boot_identity', return_value='boot-a'):
            with module.UserTransfer(fixture.node_lock, fixture.root, os.getuid(), transaction) as reader:
                self.assertEqual(reader.observation['head'], transfer['sha256'])

    def test_root_refuses_unknown_forward_event(self):
        fixture, journal, transaction, _ = self.prepared('restoration-intent')
        journal.close()
        with patch.object(module, 'boot_identity', return_value='boot-a'):
            with self.assertRaisesRegex(module.Refused, 'outside the forward window'):
                module.UserTransfer(fixture.node_lock, fixture.root, os.getuid(), transaction)

    @unittest.skipUnless(sys.platform == 'darwin', 'requires the native execution-hold observer')
    def test_root_reads_real_gate_and_hold_transfer(self):
        fixture = fixture_module.JournalTests('test_nats_transfer_freezes_user_journal_before_root_outcome')
        fixture.setUp()
        self.addCleanup(fixture.temp.cleanup)
        gate_root = Path(fixture.temp.name).resolve() / 'gate'
        pins = hold_fixture.gate_module.initialize(gate_root)
        with hold_fixture.gate_module.Gate(gate_root, pins) as gate:
            prior = fixture_module.full_node_inventory()
            prior['scheduler-heartbeat']['execution_hold'] = describe(
                gate, sorted(fixture_module.TIMER_UNITS))
            for unit in fixture_module.TIMER_UNITS:
                prior[unit]['identity'] = hold_fixture.gated_identity(unit, gate_root, pins)
            loaded = fixture_module.full_entrypoint_evidence(prior)
            with patch('preservation_journal.capture_entrypoint_inventory',
                       side_effect=lambda _: copy.deepcopy(loaded)), patch(
                       'preservation_journal.NATS_WRITER_MARKER',
                       fixture.parent / 'writer-handoff.json'):
                with fixture_module.Journal(fixture.root, prior, boot='boot-a',
                                            node_lock=fixture.node_lock,
                                            scope=fixture_module.FULL_NODE_SCOPE) as journal:
                    hold = JournaledHold(journal, gate,
                        lambda: {'verified': True,
                                 'baseline_sha256': journal.records[0]['sha256']})
                    try:
                        hold.close_and_drain()
                        hold.mutate('mesh-deploy-listener', 'disable-and-unload',
                            lambda: fixture_module.fence_listener(loaded),
                            fixture_module.listener_stop_evidence)
                        for unit in ('nats', 'nats-2', 'nats-3'):
                            hold.mutate(unit, 'disable-and-unload',
                                lambda unit=unit: fixture_module.fence_unit(loaded, unit),
                                lambda unit=unit: fixture_module.listener_stop_evidence(unit))
                        transaction = str(uuid.uuid4())
                        transfer = journal.transfer_nats(transaction, hold,
                            lambda unit, saved: {**saved, 'verified': True,
                                'loaded': False, 'running': False, 'disabled': True})
                    finally:
                        hold.close()
        with patch.object(module, 'boot_identity', return_value='boot-a'):
            with module.UserTransfer(fixture.node_lock, fixture.root, os.getuid(), transaction) as reader:
                self.assertEqual(reader.observation['head'], transfer['sha256'])


if __name__ == '__main__':
    unittest.main()
