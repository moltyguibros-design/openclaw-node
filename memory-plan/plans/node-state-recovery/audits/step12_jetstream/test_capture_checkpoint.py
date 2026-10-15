"""Owned tests for the B5 capture-ready checkpoint (D173/D174) and its pure frozen verifier.

Every positive journal is written by the honest Journal.mutate path under a certified hold facade;
negatives forge only the one row or input under test. No launchd, NATS, store or VM is touched.
"""
import copy
import hashlib
import json
import os
import pathlib
import secrets
import sys
import tempfile
import unittest
from types import SimpleNamespace
from unittest.mock import patch

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

import preservation_journal  # noqa: E402
import stopped_tree_match  # noqa: E402
import test_nats_identity as identity_fixture  # noqa: E402
from nats_identity import ROLES  # noqa: E402
from preservation_checks import STOP_ORDER  # noqa: E402
from preservation_journal import (ARM_SCOPE, CAPTURE_EVENT, FULL_NODE_SCOPE, MANIFEST_KEYS,  # noqa: E402
                                  MANIFEST_SCOPE, SERVING_NATS, Journal, Refused, encoded,
                                  verify_capture_checkpoint)
from test_preservation_journal import (fence_listener, fence_unit, full_entrypoint_evidence,  # noqa: E402
                                       full_node_inventory, listener_stop_evidence,
                                       timer_stop_evidence)

SESSION = 'owned-session'
WINDOW = 'hold-' + 'a' * 64
# The real ClosedGate certificate carries the receipt its window published (journal_hold._published).
RECEIPT = {'marker': {'window': WINDOW, 'reason': 'preservation execution hold'}}
CERTIFICATE = {'verified': True, 'restoration_only': False, 'kernel_file_watch': True,
               'path_watch': {'kernel_path_watch': True}, 'watch_session_id': SESSION, 'receipt': RECEIPT}
FOREIGN = {'marker': {'window': 'hold-' + 'f' * 64, 'reason': 'preservation execution hold'}}
# Each way a hold certificate can stop certifying the original session and window (D176-D179).
BROKEN = (('verified', False), ('restoration_only', True), ('kernel_file_watch', False),
          ('path_watch', {'kernel_path_watch': False}), ('watch_session_id', 'stale-session'),
          ('receipt', FOREIGN))
UNIT_OF = {role: unit for unit, role in ROLES.items()}


def canonical(value):
    return (json.dumps(value, sort_keys=True, separators=(',', ':')) + '\n').encode()


def rechain(records, start):
    """Re-hash from start onward, as a forger controlling the user journal could."""
    rows = copy.deepcopy(records)
    for index in range(start, len(rows)):
        row = rows[index]
        row.pop('sha256', None)
        row['sequence'] = index
        row['previous'] = rows[index - 1]['sha256'] if index else None
        row['sha256'] = hashlib.sha256(encoded(row)).hexdigest()
    return rows


class CaptureCheckpoint(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory(prefix='openclaw-capture-owned-')
        self.addCleanup(temp.cleanup)
        self.temp = pathlib.Path(temp.name)
        self.parent = self.temp / 'journals'
        self.parent.mkdir(mode=0o700)
        self.root = self.parent / 'journal'
        self.node_lock = self.temp / 'node.lock'
        lock = self.temp / 'writer.lock'
        lock.write_bytes(b'owned writer lock')
        for name, value in (('NATS_WRITER_MARKER', self.temp / 'writer-handoff.json'),
                            ('NATS_LEGACY_LOCK', lock), ('NATS_ROOT_UID', os.getuid())):
            guarded = patch.object(preservation_journal, name, value)
            guarded.start()
            self.addCleanup(guarded.stop)
        # Serving and held NATS identities in the exact bound config form of the D181 binder.
        self.prior = full_node_inventory()
        bound_prior, self.table, self.configs = identity_fixture.fixture()
        for unit in ROLES:
            self.prior[unit]['identity'] = bound_prior[unit]['identity']
        self.loaded = full_entrypoint_evidence(self.prior)
        inventory = patch('preservation_journal.capture_entrypoint_inventory',
                          side_effect=lambda _: copy.deepcopy(self.loaded))
        inventory.start()
        self.addCleanup(inventory.stop)
        self.journal = Journal(self.root, self.prior, boot='boot-a', node_lock=self.node_lock,
                               scope=FULL_NODE_SCOPE)
        self.addCleanup(self.journal.close)
        self.live = dict(CERTIFICATE)
        self.hold = SimpleNamespace(journal=self.journal, check_forward=lambda: copy.deepcopy(self.live))
        self.nonce = secrets.token_hex(32)
        self.armed = canonical({'scope': ARM_SCOPE, 'capture_nonce': self.nonce,
                                'vm_uuid': '00000000-0000-0000-0000-000000000002'})

    # --- honest journal construction -------------------------------------------------------

    def anchor(self, certificate=None):
        fields = {'baseline': self.journal.records[0]['sha256'], 'window': WINDOW,
                  'reason': 'preservation execution hold', 'protective': False}
        def publish():
            intent = self.journal.records[-1]
            self.journal.append('hold-published', intent=intent['sequence'], receipt=copy.deepcopy(RECEIPT),
                                adopted_for_restoration=False)
        if certificate is None:
            # The JournaledHold.close_and_drain shape: publication during apply, certificate as proof.
            self.journal.mutate('scheduler-heartbeat', 'close-execution-hold', publish,
                                lambda: dict(CERTIFICATE), intent_fields={'hold': fields}, hold=self.hold)
            return
        intent = self.journal.append('intent', unit='scheduler-heartbeat',
                                     action='close-execution-hold', hold=fields)
        publish()
        self.journal.append('verified', intent=intent['sequence'], unit='scheduler-heartbeat',
                            action='close-execution-hold',
                            evidence={**certificate, 'entrypoint_loaded': copy.deepcopy(self.loaded['loaded']),
                                      'entrypoint_overrides': copy.deepcopy(self.loaded['overrides'])})

    def stop_evidence(self, unit):
        state = self.prior[unit]
        if state['class'] in ('timer', 'on-demand') or state['class'] == 'known-broken' and not state['running']:
            return timer_stop_evidence(unit)
        return listener_stop_evidence(unit)

    def stop(self, unit):
        fence = fence_listener if unit == 'mesh-deploy-listener' else (lambda loaded: fence_unit(loaded, unit))
        self.journal.mutate(unit, 'disable-and-unload', lambda: fence(self.loaded),
                            lambda: self.stop_evidence(unit), hold=self.hold)

    def forged_stop(self, unit, certificate=CERTIFICATE, evidence=None):
        intent = self.journal.append('intent', unit=unit, action='disable-and-unload')
        if 'ai.openclaw.' + unit in self.loaded['loaded']['gui']:
            fence_unit(self.loaded, unit)
        self.journal.append('verified', intent=intent['sequence'], unit=unit, action='disable-and-unload',
                            evidence={**(evidence if evidence is not None else self.stop_evidence(unit)),
                                      'execution_hold': certificate,
                                      'entrypoint_loaded': copy.deepcopy(self.loaded['loaded']),
                                      'entrypoint_overrides': copy.deepcopy(self.loaded['overrides'])})

    def build(self, forge=None, skip=()):
        """Anchor, listener, other non-NATS jobs, then serving NATS; member1 is never touched."""
        forge = forge or {}
        self.anchor()
        for unit in (*STOP_ORDER, *SERVING_NATS):
            if unit in skip:
                continue
            if unit in forge:
                self.forged_stop(unit, forge[unit])
            else:
                self.stop(unit)

    def observe(self, unit, saved):
        if saved['loaded']:
            return {**saved, 'loaded': False, 'running': False, 'disabled': True, 'verified': True}
        return {**saved, 'verified': True}

    def manifest(self, head=None, **changes):
        value = {'scope': MANIFEST_SCOPE, 'at_utc': '2026-10-14T15:00:00+00:00',
                 'capture_nonce': self.nonce,
                 'journal_head': head if head is not None else self.journal.records[-1]['sha256'],
                 'data_volume_uuid': 'A' * 36, 'spec_sha256': '5' * 64,
                 'stores': {role: [{'path': 'stream.dat', 'type': 'file', 'size': 1, 'sha256': '0' * 64}]
                            for role in UNIT_OF},
                 'store_paths': {role: identity_fixture.STORES[UNIT_OF[role]] for role in UNIT_OF},
                 'store_relative_paths': {role: identity_fixture.STORES[UNIT_OF[role]][1:] for role in UNIT_OF}}
        value.update(changes)
        return canonical(value)

    def checkpoint(self, hold=None, observe=None, **inputs):
        values = {'armed': self.armed, 'manifest': self.manifest(), 'table': self.table,
                  'configs': self.configs, 'binary': identity_fixture.BINARY, 'home': identity_fixture.HOME}
        values.update(inputs)
        return self.journal.capture_ready(hold if hold is not None else self.hold,
                                          observe or self.observe, **values)

    def refused(self, pattern, call):
        before = list(self.journal._read())
        with self.assertRaisesRegex(Refused, pattern):
            call()
        self.assertEqual(self.journal._read(), before, 'a refusal must not append')

    # --- frozen verifier helpers ------------------------------------------------------------

    def authentic(self):
        self.build()
        manifest = self.manifest()
        record = self.checkpoint(manifest=manifest)
        return self.journal._read(), record, manifest

    def verify(self, records, digest=None, **inputs):
        """Rule tests: the commitment is shaped as require_committed() returns it.

        The default digest is the record's own, so these tests isolate content rules; digest
        provenance is pinned by the host-commitment tests, where it comes only from CHECKPOINT.json.
        """
        armed, manifest = inputs.pop('armed', self.armed), inputs.pop('manifest')
        values = {'table': self.table, 'configs': self.configs,
                  'binary': identity_fixture.BINARY, 'home': identity_fixture.HOME}
        values.update(inputs)
        nonce, committed = json.loads(armed)['capture_nonce'], json.loads(manifest)
        sha = hashlib.sha256(manifest).hexdigest()
        commitment = {'capture_nonce': nonce, 'arm_sha256': hashlib.sha256(armed).hexdigest(),
                      'manifest_sha256': sha, 'manifest': committed,
                      'checkpoint': {'capture_nonce': nonce, 'manifest_sha256': sha,
                                     'journal_head': committed['journal_head'],
                                     'checkpoint_sha256': digest or records[-1]['sha256']}}
        return verify_capture_checkpoint(records, commitment, **values)


class Authentic(CaptureCheckpoint):
    def test_authentic_checkpoint_binds_head_arm_manifest_roles_and_verifies_frozen(self):
        self.build()
        head = self.journal.records[-1]['sha256']
        manifest = self.manifest(head)
        record = self.checkpoint(manifest=manifest)
        self.assertEqual(record['event'], CAPTURE_EVENT)
        self.assertEqual((record['previous'], record['pre_head']), (head, head))
        self.assertEqual(record['capture_nonce'], self.nonce)
        self.assertEqual(record['arm_sha256'], hashlib.sha256(self.armed).hexdigest())
        self.assertEqual(record['manifest_sha256'], hashlib.sha256(manifest).hexdigest())
        self.assertEqual({role: row['unit'] for role, row in record['identities'].items()}, UNIT_OF)
        self.assertTrue(record['identities']['member1']['held'])
        self.assertEqual(record['observations']['nats-1']['loaded'], False)
        self.assertEqual(record['hold_evidence']['watch_session_id'], SESSION)
        self.assertEqual(record['entrypoint_loaded'], {'gui': [], 'user': [], 'system': []})
        self.journal.close()
        with Journal(self.root, boot='boot-a', node_lock=self.node_lock) as reopened:
            frozen = reopened._read()
        summary = self.verify(frozen, record['sha256'], manifest=manifest)
        self.assertEqual(summary['checkpoint_sha256'], record['sha256'])
        self.assertEqual(summary['pre_head'], head)
        self.assertEqual(summary['session'], SESSION)

    def test_guest_capture_manifest_has_the_checkpoint_shape(self):
        root = self.temp / 'guest'
        stores = []
        for role in sorted(UNIT_OF):
            relative = 'Users/owned/.openclaw/nats/' + role
            (root / relative).mkdir(parents=True)
            (root / relative / 'stream.dat').write_text(role)
            stores.append({'role': role, 'relative_path': relative})
        spec = self.temp / 'stores.json'
        spec.write_text(json.dumps({'data_volume_uuid': 'A' * 36, 'stores': stores}))
        spec.chmod(0o600)
        head = 'b' * 64
        with patch.object(stopped_tree_match, 'data_volume_uuid', return_value='A' * 36):
            stopped_tree_match.guest_capture(spec, self.temp / 'with-head', root, self.nonce, head)
            raw = (self.temp / 'with-head' / 'manifest.json').read_bytes()
            value = json.loads(raw)
            self.assertEqual(set(value), MANIFEST_KEYS)
            self.assertEqual(raw, canonical(value))
            self.assertEqual((value['capture_nonce'], value['journal_head']), (self.nonce, head))
            stopped_tree_match.guest_capture(spec, self.temp / 'legacy', root, self.nonce)
            self.assertNotIn('journal_head', json.loads((self.temp / 'legacy' / 'manifest.json').read_bytes()))
            for nonce, bad in ((None, head), (self.nonce, 'B' * 64), (self.nonce, head[:-1])):
                with self.subTest(nonce=nonce, head=bad):
                    output = self.temp / ('refused-' + secrets.token_hex(4))
                    with self.assertRaisesRegex(Exception, 'journal head is invalid'):
                        stopped_tree_match.guest_capture(spec, output, root, nonce, bad)
                    self.assertFalse(output.exists())


class LiveGate(CaptureCheckpoint):
    def test_forward_mutation_transfer_and_second_checkpoint_refuse_after_checkpoint(self):
        self.build()
        self.checkpoint()
        for call in (lambda: self.journal.mutate('nats', 'disable-and-unload', lambda: None,
                                                 lambda: {'verified': True}, hold=self.hold),
                     lambda: self.journal.transfer_nats('00000000-0000-4000-8000-000000000000',
                                                        self.hold, self.observe),
                     lambda: self.checkpoint(manifest=self.manifest(self.journal.records[-2]['sha256'])),
                     lambda: self.checkpoint()):
            self.refused('capture checkpoint ended forward work', call)

    def test_d64_cross_boot_recovery_refusal_is_unchanged(self):
        self.build()
        self.checkpoint()
        self.journal.close()
        with Journal(self.root, boot='boot-b', node_lock=self.node_lock) as rebooted:
            before = rebooted._read()
            with self.assertRaisesRegex(Refused, 'full-node reboot recovery requires a verified boot hold decision'):
                rebooted.recover(lambda *_: self.fail('restore ran'), lambda *_: self.fail('observe ran'),
                                 lambda: self.fail('final check ran'), hold=self.hold,
                                 deploy_fence=lambda *_: self.fail('fence ran'))
            self.assertEqual(rebooted._read(), before)

    def test_reboot_before_checkpoint_refuses(self):
        self.build()
        self.journal.close()
        self.journal = Journal(self.root, boot='boot-b', node_lock=self.node_lock)
        self.addCleanup(self.journal.close)
        self.hold.journal = self.journal
        self.refused('reboot invalidated preservation', self.checkpoint)

    def test_absent_foreign_or_uncertified_live_hold_refuses(self):
        self.build()
        self.refused('original execution hold and observations',
                     lambda: self.journal.capture_ready(None, self.observe, armed=self.armed,
                                                        manifest=self.manifest(), table=self.table,
                                                        configs=self.configs, binary=identity_fixture.BINARY,
                                                        home=identity_fixture.HOME))
        self.refused('original execution hold and observations',
                     lambda: self.checkpoint(hold=SimpleNamespace(journal=object(),
                                                                  check_forward=lambda: dict(CERTIFICATE))))
        for field, value in BROKEN:
            with self.subTest(field=field):
                self.live = {**CERTIFICATE, field: value}
                self.refused('live hold differs from the original', self.checkpoint)
        # Drift in either direction between the first check and the post-observation recheck.
        for field, value in (('verified', False), ('receipt', FOREIGN)):
            for bad_first in (False, True):
                with self.subTest(drift=field, bad_first=bad_first):
                    calls = []
                    def drifting(field=field, value=value, bad_first=bad_first, calls=calls):
                        calls.append(1)
                        bad = (len(calls) == 1) == bad_first
                        return {**CERTIFICATE, field: value} if bad else dict(CERTIFICATE)
                    self.refused('live hold differs from the original', lambda: self.checkpoint(
                        hold=SimpleNamespace(journal=self.journal, check_forward=drifting)))

    def test_sessionless_or_uncertified_original_hold_refuses(self):
        self.live = {key: value for key, value in CERTIFICATE.items() if key != 'watch_session_id'}
        self.anchor({key: value for key, value in CERTIFICATE.items() if key != 'watch_session_id'})
        for unit in (*STOP_ORDER, *SERVING_NATS):
            self.stop(unit)
        self.refused('original certified execution hold session', self.checkpoint)

    def test_forged_original_anchor_flags_refuse(self):
        for field, value in (*BROKEN[:4], BROKEN[5]):
            with self.subTest(field=field):
                self.setUp()
                self.anchor({**CERTIFICATE, field: value})
                for unit in (*STOP_ORDER, *SERVING_NATS):
                    self.forged_stop(unit)
                self.refused('not for the published hold window' if field == 'receipt'
                             else 'original certified execution hold session', self.checkpoint)

    def test_receipt_hold_session_is_checked_for_each_stop_class(self):
        for unit in ('mesh-deploy-listener', 'observer', 'mission-control', 'nats-2'):
            for field, value in BROKEN:
                with self.subTest(unit=unit, field=field):
                    self.setUp()
                    self.anchor(CERTIFICATE)
                    for name in (*STOP_ORDER, *SERVING_NATS):
                        self.forged_stop(name, {**CERTIFICATE, field: value} if name == unit else CERTIFICATE)
                    self.refused('stop lacks class proof or the original hold session: ' + unit,
                                 self.checkpoint)

    def test_class_proof_missing_serving_member1_and_order_refuse(self):
        weak = {'verified': True, 'unit_label': 'ai.openclaw.nats-3'}
        self.anchor(CERTIFICATE)
        for unit in (*STOP_ORDER, *SERVING_NATS):
            self.forged_stop(unit, evidence=weak if unit == 'nats-3' else None)
        self.refused('stop lacks class proof or the original hold session: nats-3', self.checkpoint)
        self.setUp()
        self.build(skip=('nats-3',))
        self.refused('not one persistent stop per prior-loaded unit', self.checkpoint)
        self.setUp()
        self.build()
        self.forged_stop('nats-1')
        self.refused('not one persistent stop per prior-loaded unit', self.checkpoint)
        self.setUp()
        self.anchor()
        self.stop('mesh-deploy-listener')
        self.forged_stop('nats')
        for unit in (*STOP_ORDER[1:], 'nats-2', 'nats-3'):
            self.stop(unit)
        self.refused('stop order differs', self.checkpoint)

    def test_unpublished_execution_hold_refuses(self):
        fields = {'baseline': self.journal.records[0]['sha256'], 'window': WINDOW,
                  'reason': 'preservation execution hold', 'protective': False}
        intent = self.journal.append('intent', unit='scheduler-heartbeat', action='close-execution-hold',
                                     hold=fields)
        self.journal.append('verified', intent=intent['sequence'], unit='scheduler-heartbeat',
                            action='close-execution-hold',
                            evidence={**CERTIFICATE, 'entrypoint_loaded': copy.deepcopy(self.loaded['loaded']),
                                      'entrypoint_overrides': copy.deepcopy(self.loaded['overrides'])})
        for unit in (*STOP_ORDER, *SERVING_NATS):
            self.stop(unit)
        self.refused('no unique published first execution hold', self.checkpoint)

    def test_fresh_observations_require_stopped_cohort_and_unchanged_member1(self):
        self.build()
        cases = {
            'nats-2': lambda saved: {**self.observe('nats-2', saved), 'running': True},
            'nats-1': lambda saved: {**saved, 'loaded': True, 'verified': True},
            'mission-control': lambda saved: {**self.observe('mission-control', saved), 'loaded': True},
            'nats': lambda saved: {**self.observe('nats', saved), 'identity': {**saved['identity'], 'argv': ['/x']}},
            'nats-3': lambda saved: {**self.observe('nats-3', saved), 'verified': False},
            'observer': lambda saved: {**self.observe('observer', saved), 'disabled': False},
        }
        for target, change in cases.items():
            with self.subTest(unit=target):
                self.refused('observation is not stopped or held unchanged: ' + target,
                             lambda: self.checkpoint(observe=lambda unit, saved: change(saved)
                                                     if unit == target else self.observe(unit, saved)))
        def reload(unit, saved):
            if unit == 'nats-3':
                self.loaded['loaded']['gui'].append('ai.openclaw.nats-3')
            return self.observe(unit, saved)
        self.refused('loaded jobs changed inside the forward window', lambda: self.checkpoint(observe=reload))

    def test_arm_nonce_head_and_manifest_form_are_bound(self):
        self.build()
        head = self.journal.records[-1]['sha256']
        cases = (
            ('not armed with a nonce', {'armed': canonical({'scope': 'armed elsewhere', 'capture_nonce': self.nonce})}),
            ('not armed with a nonce', {'armed': canonical({'scope': ARM_SCOPE, 'capture_nonce': 'A' * 64})}),
            ('nonce differs from the host arm', {'manifest': self.manifest(capture_nonce=secrets.token_hex(32))}),
            ('not taken at this journal head', {'manifest': self.manifest(self.journal.records[-2]['sha256'])}),
            ('not the canonical capture form', {'manifest': self.manifest(head)[:-1]}),
            ('not the canonical capture form', {'manifest': self.manifest(head).replace(b'":', b'": ', 1)}),
            ('not the canonical capture form', {'manifest': self.manifest(head, scope='other scope')}),
            ('not the canonical capture form', {'manifest': self.manifest(head, extra=1)}),
            ('not the canonical capture form', {'manifest': canonical({key: value for key, value in
                                                 json.loads(self.manifest(head)).items() if key != 'journal_head'})}),
            ('roles differ from the bound identities', {'manifest': self.manifest(head, stores={
                **json.loads(self.manifest(head))['stores'], 'member2': []})}),
            ('arm and manifest must be the exact bytes', {'manifest': json.loads(self.manifest(head))}),
        )
        for pattern, inputs in cases:
            with self.subTest(pattern=pattern, inputs=sorted(inputs)):
                self.refused(pattern, lambda: self.checkpoint(**inputs))

    def test_role_store_and_config_bindings_refuse(self):
        self.build()
        base = json.loads(self.manifest())
        swapped = dict(base['store_paths'], member2=base['store_paths']['member3'],
                       member3=base['store_paths']['member2'])
        relative = dict(base['store_relative_paths'], member1='Users/owned/.openclaw/nats/jetstream-2')
        nats2 = identity_fixture.config_path(identity_fixture.HOME, 'nats-2')
        changed = dict(self.configs, **{nats2: self.configs[nats2] + b'\n'})
        pins = dict(self.table, member2=self.table['member3'], member3=self.table['member2'])
        cases = (
            ('store differs from the bound member2', {'manifest': self.manifest(store_paths=swapped)}),
            ('store differs from the bound member1', {'manifest': self.manifest(store_relative_paths=relative)}),
            ('nats-2: config bytes differ from the baseline hash', {'configs': changed}),
            ('nats-2: baseline config hash differs from the window pin', {'table': pins}),
            ('config bytes are not exactly the four bound paths',
             {'configs': {path: raw for path, raw in self.configs.items() if path != nats2}}),
        )
        for pattern, inputs in cases:
            with self.subTest(pattern=pattern):
                self.refused(pattern, lambda: self.checkpoint(**inputs))

    def test_transfer_pending_and_marker_refuse(self):
        self.build()
        self.journal.transfer_nats('00000000-0000-4000-8000-000000000000', self.hold, self.observe)
        self.refused('returned NATS transfer is restore-only', self.checkpoint)
        self.setUp()
        self.build()
        self.journal.append('intent', unit='nats-1', action='disable-and-unload')
        self.refused('incomplete durable intent', self.checkpoint)
        self.setUp()
        self.build()
        (self.root / '.pending-owned').write_bytes(b'{}')
        self.refused('incomplete durable intent', self.checkpoint)
        (self.root / '.pending-owned').unlink()
        marker = preservation_journal.NATS_WRITER_MARKER
        marker.write_text('{}')
        self.refused('marker already exists', self.checkpoint)
        def clears(unit, saved):
            if marker.exists():
                marker.unlink()
            return self.observe(unit, saved)
        marker.write_text('{}')
        self.refused('marker already exists', lambda: self.checkpoint(observe=clears))
        marker.unlink()
        def appears(unit, saved):
            if unit == 'nats-3':
                marker.write_text('{}')
            return self.observe(unit, saved)
        self.refused('marker already exists', lambda: self.checkpoint(observe=appears))


class Frozen(CaptureCheckpoint):
    def test_chain_digest_terminal_and_duplicate_rules(self):
        records, record, manifest = self.authentic()
        altered = copy.deepcopy(records)
        altered[5]['at'] = 'forged'
        with self.assertRaisesRegex(Refused, 'chain differs'):
            self.verify(altered, record['sha256'], manifest=manifest)
        with self.assertRaisesRegex(Refused, 'differs from the committed digest'):
            self.verify(rechain(altered, 5), record['sha256'], manifest=manifest)
        with self.assertRaisesRegex(Refused, 'chain differs'):
            self.verify(records[:5] + records[6:], record['sha256'], manifest=manifest)
        later = rechain(records + [{'event': 'recovery-started', 'boot': 'boot-a', 'at': 'later'}], len(records))
        with self.assertRaisesRegex(Refused, 'not the terminal record'):
            self.verify(later, manifest=manifest)
        twice = rechain(records + [copy.deepcopy(records[-1])], len(records))
        with self.assertRaisesRegex(Refused, 'outside the uninterrupted forward window'):
            self.verify(twice, manifest=manifest)
        with self.assertRaisesRegex(Refused, 'not the terminal record'):
            self.verify(records[:-1], manifest=manifest)

    def test_inserted_or_removed_rows_before_the_checkpoint_refuse(self):
        records, _, manifest = self.authentic()
        last = len(records) - 1
        def inserted(row):
            return rechain(records[:last] + [{**row, 'boot': 'boot-a', 'at': 'x'}] + records[last:], last)
        cases = (
            ('outside the uninterrupted forward window', inserted({'event': 'failed', 'unit': 'nats'})),
            ('outside the uninterrupted forward window', inserted({'event': 'nats-transfer-intent'})),
            ('outside the uninterrupted forward window', inserted({'event': 'nats-transfer-closed'})),
            ('outside the uninterrupted forward window', inserted({'event': 'recovery-started'})),
            ('unfinished intent', inserted({'event': 'intent', 'unit': 'nats-1', 'action': 'disable-and-unload'})),
            ('unfinished intent', rechain(records[:last - 1] + records[last:], last - 1)),
        )
        for pattern, rows in cases:
            with self.subTest(pattern=pattern):
                with self.assertRaisesRegex(Refused, pattern):
                    self.verify(rows, manifest=manifest)

    def test_boot_continuity_refuses(self):
        records, _, manifest = self.authentic()
        middle = copy.deepcopy(records)
        middle[7]['boot'] = 'boot-b'
        with self.assertRaisesRegex(Refused, 'spans more than one boot'):
            self.verify(rechain(middle, 7), manifest=manifest)
        terminal = copy.deepcopy(records)
        terminal[-1]['boot'] = 'boot-b'
        with self.assertRaisesRegex(Refused, 'fields differ'):
            self.verify(rechain(terminal, len(records) - 1), manifest=manifest)

    def test_original_and_receipt_holds_are_rechecked(self):
        records, _, manifest = self.authentic()
        anchor = next(index for index, row in enumerate(records)
                      if row['event'] == 'verified' and row['action'] == 'close-execution-hold')
        for field, value in BROKEN:
            with self.subTest(row='anchor', field=field):
                rows = copy.deepcopy(records)
                rows[anchor]['evidence'][field] = value
                # A well-formed foreign anchor session orphans every receipt; the first one refuses.
                pattern = ('original hold session: mesh-deploy-listener' if field == 'watch_session_id'
                           else 'not for the published hold window' if field == 'receipt'
                           else 'original certified execution hold session')
                with self.assertRaisesRegex(Refused, pattern):
                    self.verify(rechain(rows, anchor), manifest=manifest)
        for unit in ('mesh-deploy-listener', 'scheduler-heartbeat', 'mesh-agent', 'nats-2'):
            receipt = next(index for index, row in enumerate(records) if row['event'] == 'verified'
                           and row['unit'] == unit and row['action'] == 'disable-and-unload')
            for field, value in BROKEN:
                with self.subTest(row=unit, field=field):
                    rows = copy.deepcopy(records)
                    rows[receipt]['evidence']['execution_hold'][field] = value
                    with self.assertRaisesRegex(Refused, 'original hold session: ' + unit):
                        self.verify(rechain(rows, receipt), manifest=manifest)
            with self.subTest(row=unit, field='class proof'):
                rows = copy.deepcopy(records)
                rows[receipt]['evidence']['verified'] = False
                with self.assertRaisesRegex(Refused, 'class proof or the original hold session: ' + unit):
                    self.verify(rechain(rows, receipt), manifest=manifest)

    def test_execution_hold_publication_is_rechecked(self):
        records, _, manifest = self.authentic()
        published = next(index for index, row in enumerate(records) if row['event'] == 'hold-published')
        intent = published - 1
        cases = (
            (published, lambda row: row.update(adopted_for_restoration=True)),
            (published, lambda row: row['receipt']['marker'].update(window='hold-' + 'b' * 64)),
            (intent, lambda row: row['hold'].update(protective=True)),
            (intent, lambda row: row['hold'].update(baseline='0' * 64)),
            (intent, lambda row: row['hold'].update(extra=True)),
        )
        for index, change in cases:
            with self.subTest(index=index):
                rows = copy.deepcopy(records)
                change(rows[index])
                with self.assertRaisesRegex(Refused, 'no unique published first execution hold'):
                    self.verify(rechain(rows, index), manifest=manifest)

    def test_consistent_foreign_window_forgeries_refuse(self):
        """A guest-side forger can rechain and re-derive the manifest head; only content rules remain."""
        records, _, manifest = self.authentic()
        def forged(rows, start):
            rows = rechain(rows, start)
            head = rows[-2]['sha256']
            again = canonical({**json.loads(manifest), 'journal_head': head})
            rows[-1].update(pre_head=head, manifest_sha256=hashlib.sha256(again).hexdigest())
            return rechain(rows, len(rows) - 1), again
        rows, again = forged(copy.deepcopy(records), 1)
        self.verify(rows, manifest=again)
        index = {key: next(i for i, row in enumerate(records) if test(row)) for key, test in (
            ('anchor', lambda row: row['event'] == 'verified' and row['action'] == 'close-execution-hold'),
            ('published', lambda row: row['event'] == 'hold-published'),
            ('nats', lambda row: row['event'] == 'verified' and row['unit'] == 'nats'))}
        def anchor(rows):
            rows[index['anchor']]['evidence']['receipt'] = FOREIGN
        def window(rows):
            rows[index['published'] - 1]['hold']['window'] = 'not-a-window'
            rows[index['published']]['receipt']['marker']['window'] = 'not-a-window'
        def reason(rows):
            rows[index['published'] - 1]['hold']['reason'] = 'other reason'
            rows[index['published']]['receipt']['marker']['reason'] = 'other reason'
        def nats(rows):
            rows[index['nats']]['evidence']['execution_hold']['receipt'] = FOREIGN
        for change, start, pattern in (
                (anchor, index['anchor'], 'not for the published hold window'),
                (window, index['published'] - 1, 'no unique published first execution hold'),
                (reason, index['published'] - 1, 'no unique published first execution hold'),
                (nats, index['nats'], 'original hold session: nats')):
            with self.subTest(change=change.__name__):
                rows = copy.deepcopy(records)
                change(rows)
                rows, again = forged(rows, start)
                with self.assertRaisesRegex(Refused, pattern):
                    self.verify(rows, manifest=again)

    def test_member1_stop_and_launchd_continuity_refuse(self):
        records, _, manifest = self.authentic()
        last = len(records) - 1
        receipt = copy.deepcopy(records[last - 1])
        intent = {'event': 'intent', 'unit': 'nats-1', 'action': 'disable-and-unload', 'boot': 'boot-a', 'at': 'x'}
        verified = {**receipt, 'unit': 'nats-1', 'intent': last}
        rows = rechain(records[:last] + [intent, verified] + records[last:], last)
        with self.assertRaisesRegex(Refused, 'not one persistent stop per prior-loaded unit'):
            self.verify(rows, manifest=manifest)
        receipt_index = next(index for index, row in enumerate(records) if row['event'] == 'verified'
                             and row['unit'] == 'observer' and row['action'] == 'disable-and-unload')
        rows = copy.deepcopy(records)
        rows[receipt_index]['evidence']['entrypoint_overrides']['gui'] = []
        with self.assertRaisesRegex(Refused, 'capture journal content is malformed'):
            self.verify(rechain(rows, receipt_index), manifest=manifest)
        for change in ('loaded', 'override'):
            with self.subTest(change=change):
                rows = copy.deepcopy(records)
                evidence = rows[receipt_index]['evidence']
                if change == 'loaded':
                    evidence['entrypoint_loaded']['gui'].append('ai.openclaw.nats-1')
                else:
                    evidence['entrypoint_overrides']['gui']['ai.openclaw.nats-1'] = False
                with self.assertRaisesRegex(Refused, 'launchd continuity differs at the stop of observer'):
                    self.verify(rechain(rows, receipt_index), manifest=manifest)

    def test_checkpoint_fields_are_rederived(self):
        records, _, manifest = self.authentic()
        member2 = dict(records[-1]['identities']['member2'], store_dir='/Users/owned/.openclaw/nats/jetstream-3')
        observed = {**records[-1]['observations'],
                    'nats-1': {**records[-1]['observations']['nats-1'], 'loaded': True}}
        cases = {
            'capture_nonce': secrets.token_hex(32), 'arm_sha256': '0' * 64, 'manifest_sha256': '0' * 64,
            'pre_head': '0' * 64, 'baseline_sha256': '0' * 64, 'scope': 'writer exclusion',
            'identities': {**records[-1]['identities'], 'member2': member2},
            'hold_sha256': '0' * 64,
            'entrypoint_loaded': {'gui': ['ai.openclaw.nats'], 'user': [], 'system': []},
            'observations': observed,
        }
        for field, value in cases.items():
            with self.subTest(field=field):
                rows = copy.deepcopy(records)
                rows[-1][field] = value
                pattern = 'observations do not show' if field == 'observations' else 'fields differ'
                with self.assertRaisesRegex(Refused, pattern):
                    self.verify(rechain(rows, len(rows) - 1), manifest=manifest)
        for field, value in BROKEN:
            with self.subTest(hold=field):
                rows = copy.deepcopy(records)
                rows[-1]['hold_evidence'] = {**rows[-1]['hold_evidence'], field: value}
                rows[-1]['hold_sha256'] = hashlib.sha256(encoded(rows[-1]['hold_evidence'])).hexdigest()
                with self.assertRaisesRegex(Refused, 'fields differ'):
                    self.verify(rechain(rows, len(rows) - 1), manifest=manifest)
        rows = copy.deepcopy(records)
        rows[-1]['note'] = 'extra'
        with self.assertRaisesRegex(Refused, 'fields differ'):
            self.verify(rechain(rows, len(rows) - 1), manifest=manifest)

    def test_verifier_inputs_must_be_the_committed_ones(self):
        records, record, manifest = self.authentic()
        value = json.loads(manifest)
        nats2 = identity_fixture.config_path(identity_fixture.HOME, 'nats-2')
        cases = (
            ('differs from the committed digest', {'digest': '0' * 64}),
            ('fields differ', {'armed': canonical({**json.loads(self.armed), 'vm_uuid': 'other'})}),
            ('nonce differs from the host arm',
             {'armed': canonical({**json.loads(self.armed), 'capture_nonce': secrets.token_hex(32)})}),
            ('fields differ', {'manifest': canonical({**value, 'at_utc': 'later'})}),
            ('not taken at this journal head', {'manifest': canonical({**value, 'journal_head': records[-3]['sha256']})}),
            ('store differs from the bound member2', {'manifest': canonical({**value, 'store_paths': {
                **value['store_paths'], 'member3': value['store_paths']['member2'],
                'member2': value['store_paths']['member3']}})}),
            ('config bytes differ from the baseline hash', {'configs': {**self.configs, nats2: b'x'}}),
            ('baseline config hash differs from the window pin',
             {'table': {**self.table, 'member2': self.table['member3'], 'member3': self.table['member2']}}),
        )
        for pattern, inputs in cases:
            with self.subTest(pattern=pattern):
                inputs = dict(inputs)
                digest = inputs.pop('digest', record['sha256'])
                inputs.setdefault('manifest', manifest)
                with self.assertRaisesRegex(Refused, pattern):
                    self.verify(records, digest, **inputs)


if __name__ == '__main__':
    unittest.main()
