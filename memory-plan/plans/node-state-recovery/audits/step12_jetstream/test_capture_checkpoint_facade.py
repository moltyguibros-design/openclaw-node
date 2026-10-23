"""Real JournaledHold positive control for the capture-ready checkpoint (macOS native observer).

The hold, gate, full-node journal opener and checkpoint are the real code; only launchd and the
stop evidence are owned stand-ins. Serving NATS stops go through JournaledHold.mutate directly:
StopWatch refuses a persistent full-node NATS stop until a NATS recovery adapter exists.
The host side is the real commit(), commit_checkpoint(), capture worker publication, host_match()
and frozen verifier, with only the VM facilities of drive_capture_worker stood in: the frozen
verifier receives its commitment through the CAPTURE.json pins, never from the journal itself.
"""
import contextlib
import copy
import hashlib
import json
import os
import pathlib
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

import preservation_journal  # noqa: E402
import test_nats_identity as identity_fixture  # noqa: E402
from full_node_baseline import open_full_node_journal  # noqa: E402
from journal_hold import ANCHOR, JournaledHold, describe  # noqa: E402
from nats_identity import ROLES  # noqa: E402
from preservation_checks import STOP_ORDER  # noqa: E402
from host_guest_commit import commit, commit_checkpoint, verify_frozen_checkpoint  # noqa: E402
from host_vm_preflight import write_record  # noqa: E402
from preservation_journal import MANIFEST_SCOPE, SERVING_NATS, TIMER_UNITS, Refused  # noqa: E402
from stopped_tree_match import host_match  # noqa: E402
from test_host_checkpoint_commit import ROWS, drive_capture_worker, write_private  # noqa: E402
from test_journal_hold import gate_module, gated_identity  # noqa: E402
from test_preservation_journal import (full_entrypoint_evidence, full_node_inventory,  # noqa: E402
                                       listener_stop_evidence, timer_stop_evidence)

UNIT_OF = {role: unit for unit, role in ROLES.items()}


def canonical(value):
    return (json.dumps(value, sort_keys=True, separators=(',', ':')) + '\n').encode()


@unittest.skipUnless(sys.platform == 'darwin', 'the real hold facade needs the native gate observer')
class RealFacadeCheckpoint(unittest.TestCase):
    def test_real_hold_facade_checkpoint_verifies_frozen(self):
        self.exercise()

    def exercise(self):
        with tempfile.TemporaryDirectory(prefix='openclaw-capture-facade-') as place, \
                contextlib.ExitStack() as stack:
            root = pathlib.Path(place).resolve()
            writer_lock = root / 'writer.lock'
            writer_lock.write_bytes(b'owned writer lock')
            writer_lock.chmod(0o644)
            gate_root = root / 'gate'
            pins = gate_module.initialize(gate_root)
            for name, value in (('NATS_WRITER_MARKER', root / 'writer-handoff.json'),
                                ('NATS_LEGACY_LOCK', writer_lock), ('NATS_ROOT_UID', os.getuid())):
                stack.enter_context(patch.object(preservation_journal, name, value))
            gate = stack.enter_context(gate_module.Gate(gate_root, pins))
            prior = full_node_inventory()
            bound_prior, table, configs = identity_fixture.fixture()
            for unit in ROLES:
                prior[unit]['identity'] = bound_prior[unit]['identity']
            for unit in TIMER_UNITS:
                prior[unit]['identity'] = gated_identity(unit, gate_root, pins)
            prior[ANCHOR]['execution_hold'] = describe(gate, sorted(TIMER_UNITS))
            current = copy.deepcopy(prior)
            entrypoints = full_entrypoint_evidence(prior)
            stack.enter_context(patch('full_node_baseline.capture_full_node_prior',
                                      return_value=(prior, copy.deepcopy(entrypoints))))
            stack.enter_context(patch('preservation_journal.capture_entrypoint_inventory',
                                      side_effect=lambda _: copy.deepcopy(entrypoints)))
            journal = stack.enter_context(open_full_node_journal(
                root / 'journals' / 'window', gate, {}, boot='owned-boot', node_lock=root / 'node.lock'))
            hold = JournaledHold(journal, gate, lambda: {'verified': True,
                                                         'baseline_sha256': journal.records[0]['sha256']})
            stack.callback(hold.close)
            hold.close_and_drain()

            def evidence(unit):
                state = prior[unit]
                if state['class'] in ('timer', 'on-demand') or (
                        state['class'] == 'known-broken' and not state['running']):
                    return timer_stop_evidence(unit)
                return listener_stop_evidence(unit)

            def fence(unit):
                label = 'ai.openclaw.' + unit
                entrypoints['loaded']['gui'].remove(label)
                for domain in ('gui', 'user'):
                    entrypoints['overrides'][domain][label] = True
                current[unit].update(loaded=False, running=False, disabled=True)

            for unit in (*STOP_ORDER, *SERVING_NATS):
                hold.mutate(unit, 'disable-and-unload', lambda unit=unit: fence(unit),
                            lambda unit=unit: evidence(unit))
            events = [row['event'] for row in journal.records]
            self.assertEqual(events[:4], ['baseline', 'intent', 'hold-published', 'verified'])
            self.assertEqual(events[4:], ['intent', 'verified'] * (len(STOP_ORDER) + len(SERVING_NATS)))

            window_pins = root / 'window-pins.json'
            write_record(window_pins, table)
            bindings = {'configs': configs,
                    'binary': identity_fixture.BINARY, 'home': identity_fixture.HOME}
            store_spec = root / 'stores.json'
            write_record(store_spec, {'data_volume_uuid': 'A' * 36, 'stores': [
                {'role': role, 'relative_path': identity_fixture.STORES[UNIT_OF[role]][1:]}
                for role in sorted(UNIT_OF)]})
            head = journal.records[-1]['sha256']
            flow = {}

            def while_running(output):
                """Guest manifest, host commit, guest checkpoint and host checkpoint commitment."""
                armed = (output / 'ARMED.json').read_bytes()
                nonce = json.loads(armed)['capture_nonce']
                flow['manifest'] = canonical({
                    'scope': MANIFEST_SCOPE, 'at_utc': '2026-10-14T15:00:00+00:00', 'capture_nonce': nonce,
                    'journal_head': head, 'data_volume_uuid': 'A' * 36,
                    'spec_sha256': hashlib.sha256(store_spec.read_bytes()).hexdigest(),
                    'stores': {role: ROWS for role in UNIT_OF},
                    'store_paths': {role: identity_fixture.STORES[UNIT_OF[role]] for role in UNIT_OF},
                    'store_relative_paths': {role: identity_fixture.STORES[UNIT_OF[role]][1:]
                                             for role in UNIT_OF}})
                flow['guest'] = root / 'guest-manifest.json'
                write_private(flow['guest'], flow['manifest'])
                commit(output.parent / 'host.json', store_spec, output, flow['guest'])
                flow['record'] = journal.capture_ready(
                    hold, lambda unit, saved: {**copy.deepcopy(current[unit]), 'verified': True},
                    armed=armed, manifest=flow['manifest'], table=table, **bindings)
                commit_checkpoint(output.parent / 'host.json', output,
                                  root / 'journals' / 'window' / ('%06d.json' % flow['record']['sequence']))

            output, error = drive_capture_worker(root / 'host', store_spec, window_pins, while_running)
            self.assertIsNone(error)
            record = flow['record']
            self.assertEqual(record['pre_head'], head)
            self.assertEqual(record['hold_evidence']['watch_session_id'], hold.original_session)
            self.assertTrue(record['hold_evidence']['kernel_file_watch'])
            # The honest relation the checkpoint enforces: one published receipt in every certificate.
            publication = journal.records[2]['receipt']
            self.assertEqual(journal.records[3]['evidence']['receipt'], publication)
            self.assertEqual(record['hold_evidence']['receipt'], publication)
            self.assertTrue(all(row['evidence']['execution_hold']['receipt'] == publication
                                for row in journal.records[5:-1:2]))
            matches = root / 'matches'
            matches.mkdir(mode=0o700)
            matched = host_match(flow['guest'], output / 'extracted-stores', matches / 'match')
            self.assertEqual(matched['checkpoint_sha256'], record['sha256'])
            summary = verify_frozen_checkpoint(output, journal._read(), **bindings)
            self.assertEqual((summary['session'], summary['checkpoint_sha256']),
                             (hold.original_session, record['sha256']))
            self.assertEqual(hashlib.sha256(flow['manifest']).hexdigest(), record['manifest_sha256'])
            with self.assertRaisesRegex(Refused, 'capture checkpoint ended forward work'):
                hold.mutate('nats', 'disable-and-unload', lambda: self.fail('applied'),
                            lambda: self.fail('verified'))


if __name__ == '__main__':
    unittest.main()
