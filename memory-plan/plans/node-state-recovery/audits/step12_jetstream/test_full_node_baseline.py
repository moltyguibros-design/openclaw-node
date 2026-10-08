import copy
import hashlib
import os
import pathlib
import plistlib
import subprocess
import sys
import tempfile
import time
import unittest
from types import SimpleNamespace
from unittest.mock import patch

from full_node_baseline import capture_full_node_prior, open_full_node_journal
from journal_hold import JournaledHold
from managed_launchd import Launchd
from preservation_checks import disabled_overrides
from preservation_journal import (FULL_NODE_SCOPE, Journal, Refused, TIMER_UNITS,
                                  UNITS, static_identity, valid_entrypoint_inventory)
from test_journal_hold import gate_module


class FullNodeBaseline(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='openclaw-full-prior-')
        self.addCleanup(self.temp.cleanup)
        self.root = pathlib.Path(self.temp.name)
        self.binary = self.root / 'owned-binary'
        self.binary.write_bytes(b'owned executable')
        digest = hashlib.sha256(self.binary.read_bytes()).hexdigest()
        self.approved = {}
        self.states = {}
        self.entrypoints = {'verified': True, 'installed': {},
            'loaded': {'gui': [], 'user': [], 'system': []},
            'roots': [str(self.root)], 'disabled_artifacts': {}, 'excluded': {},
            'overrides': {domain: {'ai.openclaw.' + unit: None for unit in UNITS}
                          for domain in ('gui', 'user', 'system')}}
        for unit in sorted(UNITS):
            label = 'ai.openclaw.' + unit
            kind = ('held' if unit == 'nats-1' else
                    'unloaded' if unit == 'federation-tick' else
                    'on-demand' if unit == 'mesh-agent' else
                    'known-broken' if unit == 'mesh-tool-discord' else
                    'timer' if unit in TIMER_UNITS else 'daemon')
            loaded = kind not in ('held', 'unloaded')
            running = kind in ('daemon', 'known-broken')
            disabled = kind in ('held', 'unloaded')
            plist = self.root / (label + '.plist')
            plist.write_bytes(plistlib.dumps({'Label': label,
                'ProgramArguments': [str(self.binary)], 'WorkingDirectory': str(self.root)}))
            self.approved[unit] = {'class': kind,
                'plist': {'path': str(plist), 'sha256': hashlib.sha256(plist.read_bytes()).hexdigest()},
                'direct_file_hashes': {str(self.binary): digest}}
            self.states[label] = {'loaded': loaded, 'running': running,
                                  'pid': 100 if running else None, 'disabled': disabled}
            self.entrypoints['installed'][label] = copy.deepcopy(self.approved[unit]['plist'])
            if loaded:
                self.entrypoints['loaded']['gui'].append(label)
            if disabled:
                for domain in ('gui', 'user'):
                    self.entrypoints['overrides'][domain][label] = True
        self.entrypoints['loaded']['gui'].sort()
        self.gate = SimpleNamespace(validate=lambda: None, marker=lambda: None,
            root=self.root / 'gate', expected_root='root-pin', expected_lock='lock-pin',
            metadata={}, metadata_identity={}, metadata_sha='metadata-pin',
            paths=SimpleNamespace(evidence=lambda: {'paths': {}}))

    def capture(self, inventory=None, statuses=None):
        inventory = inventory or [self.entrypoints, self.entrypoints]
        statuses = statuses or self.states
        def service(label, plist):
            return SimpleNamespace(status=lambda label=label: copy.deepcopy(statuses[label]),
                                   disabled=lambda label=label: statuses[label]['disabled'])
        with (patch('full_node_baseline.capture_entrypoint_inventory',
                    side_effect=[copy.deepcopy(value) for value in inventory]),
              patch('full_node_baseline.Launchd', side_effect=service)):
            return capture_full_node_prior(self.gate, self.approved)

    def test_captures_all_jobs_and_hold_from_owned_plists(self):
        prior, entrypoints = self.capture()
        self.assertEqual(set(prior), UNITS)
        self.assertEqual(len(entrypoints['loaded']['gui']), 21)
        self.assertEqual(prior['nats-1']['class'], 'held')
        self.assertTrue(prior['nats-1']['disabled'])
        self.assertEqual(set(prior['scheduler-heartbeat']['execution_hold']['cohort']), TIMER_UNITS)
        self.assertEqual(prior['gateway']['identity']['files'][str(self.binary.resolve())],
                         self.approved['gateway']['direct_file_hashes'][str(self.binary)])

    def test_captured_prior_opens_owned_full_node_journal(self):
        prior, entrypoints = self.capture()
        def service(label, plist):
            return SimpleNamespace(status=lambda: copy.deepcopy(self.states[label]),
                                   disabled=lambda: self.states[label]['disabled'])
        with (patch('full_node_baseline.capture_entrypoint_inventory',
                    side_effect=[copy.deepcopy(entrypoints), copy.deepcopy(entrypoints)]),
              patch('full_node_baseline.Launchd', side_effect=service),
              patch('preservation_journal.capture_entrypoint_inventory',
                    return_value=copy.deepcopy(entrypoints))):
            journal = open_full_node_journal(self.root / 'journals' / 'window',
                                             self.gate, self.approved, boot='owned-boot',
                                             node_lock=self.root / 'node.lock')
        self.addCleanup(journal.close)
        self.assertEqual(journal.scope, FULL_NODE_SCOPE)
        self.assertEqual(journal.records[0]['prior'], prior)
        self.assertEqual(journal.records[0]['entrypoint_inventory'], entrypoints)

    def test_journal_refuses_inventory_drift_after_prior_capture(self):
        prior, entrypoints = self.capture()
        changed = copy.deepcopy(entrypoints)
        changed['loaded']['gui'].remove('ai.openclaw.gateway')
        with patch('preservation_journal.capture_entrypoint_inventory',
                   return_value=changed):
            with self.assertRaisesRegex(Refused, 'loaded entrypoints differ'):
                Journal(self.root / 'journals' / 'window', prior,
                        boot='owned-boot', node_lock=self.root / 'node.lock',
                        scope=FULL_NODE_SCOPE)
        self.assertFalse((self.root / 'node.lock.state.json').exists())

    def test_entrypoint_change_still_valid_against_prior_refuses_handoff(self):
        prior, entrypoints = self.capture()
        changed = copy.deepcopy(entrypoints)
        changed['roots'].append(str(self.root / 'new-root'))
        valid_entrypoint_inventory(changed, prior)
        with patch('preservation_journal.capture_entrypoint_inventory',
                   return_value=changed):
            with self.assertRaisesRegex(Refused, 'changed after baseline capture'):
                Journal(self.root / 'journals' / 'window', prior,
                        boot='owned-boot', node_lock=self.root / 'node.lock',
                        scope=FULL_NODE_SCOPE, expected_entrypoints=entrypoints)
        self.assertFalse((self.root / 'node.lock.state.json').exists())

    def test_owned_entrypoint_refuses_valid_inventory_drift(self):
        prior, entrypoints = self.capture()
        changed = copy.deepcopy(self.entrypoints)
        changed['roots'].append(str(self.root / 'new-root'))
        with (patch('full_node_baseline.capture_full_node_prior',
                    return_value=(prior, entrypoints)),
              patch('preservation_journal.capture_entrypoint_inventory',
                    return_value=changed),
              self.assertRaisesRegex(Refused, 'changed after baseline capture')):
            open_full_node_journal(self.root / 'journals' / 'window', self.gate,
                                   self.approved, boot='owned-boot',
                                   node_lock=self.root / 'node.lock')
        self.assertFalse((self.root / 'node.lock.state.json').exists())

    def test_changed_enabled_override_refuses_handoff(self):
        prior, entrypoints = self.capture()
        changed = copy.deepcopy(entrypoints)
        changed['overrides']['system']['ai.openclaw.gateway'] = True
        valid_entrypoint_inventory(changed, prior)
        with (patch('preservation_journal.capture_entrypoint_inventory',
                    return_value=changed),
              self.assertRaisesRegex(Refused, 'changed after baseline capture')):
            Journal(self.root / 'journals' / 'window', prior,
                    boot='owned-boot', node_lock=self.root / 'node.lock',
                    scope=FULL_NODE_SCOPE, expected_entrypoints=entrypoints)
        self.assertFalse((self.root / 'node.lock.state.json').exists())

    def test_captured_entrypoints_cannot_reopen_an_existing_window(self):
        prior, entrypoints = self.capture()
        with patch('preservation_journal.capture_entrypoint_inventory',
                   return_value=copy.deepcopy(entrypoints)):
            journal = Journal(self.root / 'journals' / 'window', prior,
                              boot='owned-boot', node_lock=self.root / 'node.lock',
                              scope=FULL_NODE_SCOPE, expected_entrypoints=entrypoints)
        original = copy.deepcopy(journal.records)
        journal.close()
        with (patch('full_node_baseline.capture_full_node_prior',
                    return_value=(prior, entrypoints)),
              self.assertRaisesRegex(Refused, 'cannot reopen')):
            open_full_node_journal(self.root / 'journals' / 'window', self.gate,
                                   self.approved, boot='owned-boot',
                                   node_lock=self.root / 'node.lock')
        with Journal(self.root / 'journals' / 'window', boot='owned-boot',
                     node_lock=self.root / 'node.lock') as reopened:
            self.assertEqual(reopened.records, original)

    def test_missing_unit_refuses_before_inventory_read(self):
        del self.approved['gateway']
        with patch('full_node_baseline.capture_entrypoint_inventory') as capture:
            with self.assertRaisesRegex(Refused, 'incomplete'):
                capture_full_node_prior(self.gate, self.approved)
        capture.assert_not_called()

    def test_changed_direct_file_pin_refuses(self):
        self.approved['gateway']['direct_file_hashes'][str(self.binary)] = '0' * 64
        with self.assertRaisesRegex(Refused, 'approved direct files differ'):
            self.capture()

    def test_aliased_approved_direct_file_refuses(self):
        alias = self.root / 'owned-binary-alias'
        alias.symlink_to(self.binary)
        self.approved['gateway']['direct_file_hashes'][str(alias)] = (
            self.approved['gateway']['direct_file_hashes'][str(self.binary)])
        with self.assertRaisesRegex(Refused, 'approved direct-file paths alias'):
            self.capture()

    def test_installed_plist_drift_refuses(self):
        self.entrypoints['installed']['ai.openclaw.gateway']['sha256'] = '0' * 64
        with self.assertRaisesRegex(Refused, 'installed plist differs'):
            self.capture()

    def test_second_inventory_change_refuses(self):
        changed = copy.deepcopy(self.entrypoints)
        changed['loaded']['gui'].remove('ai.openclaw.gateway')
        with self.assertRaisesRegex(Refused, 'changed during baseline'):
            self.capture([self.entrypoints, changed])

    def test_inventory_omits_running_daemon_refuses(self):
        self.entrypoints['loaded']['gui'].remove('ai.openclaw.gateway')
        with self.assertRaisesRegex(Refused, 'loaded entrypoints differ'):
            self.capture()

    def test_idle_daemon_refuses_prior(self):
        self.states['ai.openclaw.gateway']['running'] = False
        self.states['ai.openclaw.gateway']['pid'] = None
        with self.assertRaisesRegex(Refused, 'baseline does not match'):
            self.capture()

    def test_daemon_generation_change_refuses(self):
        calls = {'gateway': 0}
        def service(label, plist):
            def status():
                value = copy.deepcopy(self.states[label])
                if label == 'ai.openclaw.gateway':
                    calls['gateway'] += 1
                    if calls['gateway'] == 2:
                        value['pid'] += 1
                return value
            return SimpleNamespace(status=status,
                                   disabled=lambda: self.states[label]['disabled'])
        with (patch('full_node_baseline.capture_entrypoint_inventory',
                    side_effect=[copy.deepcopy(self.entrypoints)] * 2),
              patch('full_node_baseline.Launchd', side_effect=service)):
            with self.assertRaisesRegex(Refused, 'service changed during baseline: gateway'):
                capture_full_node_prior(self.gate, self.approved)

    def test_direct_file_change_during_baseline_refuses(self):
        calls = 0
        def inventory(_):
            nonlocal calls
            calls += 1
            if calls == 2:
                self.binary.write_bytes(b'changed executable')
            return copy.deepcopy(self.entrypoints)
        def service(label, plist):
            return SimpleNamespace(status=lambda: copy.deepcopy(self.states[label]),
                                   disabled=lambda: self.states[label]['disabled'])
        with (patch('full_node_baseline.capture_entrypoint_inventory', side_effect=inventory),
              patch('full_node_baseline.Launchd', side_effect=service)):
            with self.assertRaisesRegex(Refused, 'direct files changed during baseline'):
                capture_full_node_prior(self.gate, self.approved)


class OwnedFullNodeInventory(unittest.TestCase):
    @unittest.skipUnless(sys.platform == 'darwin'
                         and os.environ.get('OPENCLAW_CI_FULL_NODE_INVENTORY_FIXTURE') == '1',
                         '23-label inventory fixture runs only on a dedicated macOS CI runner')
    def test_native_entrypoint_capture_opens_the_full_node_journal(self):
        labels = {'ai.openclaw.' + unit for unit in UNITS}
        uid = str(os.getuid())
        for folder in (pathlib.Path.home() / 'Library/LaunchAgents',
                       pathlib.Path('/Library/LaunchAgents'), pathlib.Path('/Library/LaunchDaemons')):
            self.assertFalse(any((folder / (label + '.plist')).exists() for label in labels))
        for unit in UNITS:
            label = 'ai.openclaw.' + unit
            service = Launchd(label, '/dev/null')
            self.assertFalse(service.status()['loaded'])
            self.assertFalse(service.status('user')['loaded'])
            system = subprocess.run(['/bin/launchctl', 'print', 'system/' + label],
                                    capture_output=True, timeout=10)
            self.assertNotEqual(system.returncode, 0)
        for domain in ('gui/' + uid, 'user/' + uid, 'system'):
            output = subprocess.check_output(['/bin/launchctl', 'print-disabled', domain],
                                             text=True, timeout=10)
            self.assertFalse(any(value is True for value in
                                 disabled_overrides(output, labels).values()))

        with tempfile.TemporaryDirectory(prefix='openclaw-owned-full-inventory-') as directory:
            root = pathlib.Path(directory).resolve()
            home = root / 'home'
            agents = home / 'Library/LaunchAgents'
            agents.mkdir(parents=True)
            gate_root = root / 'gate'
            pins = gate_module.initialize(gate_root)
            entry = root / 'timer-entry.py'
            manifest = root / 'timer-entry-manifest.json'
            entry.write_text('raise SystemExit(78)\n')
            manifest.write_text('{"owned":true}\n')
            manifest_hash = hashlib.sha256(manifest.read_bytes()).hexdigest()
            services = {}
            approved = {}
            try:
                for unit in sorted(UNITS):
                    label = 'ai.openclaw.' + unit
                    kind = ('held' if unit == 'nats-1' else
                            'unloaded' if unit == 'federation-tick' else
                            'on-demand' if unit == 'mesh-agent' else
                            'known-broken' if unit == 'mesh-tool-discord' else
                            'timer' if unit in TIMER_UNITS else 'daemon')
                    argv = (['/usr/bin/python3', '-I', '-S', str(entry), str(manifest),
                             manifest_hash, label, str(gate_root), pins['lock'], pins['root'],
                             '--', '/bin/sleep', '900'] if kind == 'timer' else
                            ['/bin/sleep', '900'])
                    plist = agents / (label + '.plist')
                    plist.write_bytes(plistlib.dumps({
                        'Label': label, 'ProgramArguments': argv,
                        'WorkingDirectory': str(root),
                        'RunAtLoad': kind in ('daemon', 'known-broken'),
                        'KeepAlive': False}))
                    identity = static_identity(plist)
                    approved[unit] = {'class': kind,
                        'plist': {'path': str(plist), 'sha256': identity['plist_sha256']},
                        'direct_file_hashes': identity['files']}
                    services[unit] = Launchd(label, plist)
                    if kind in ('held', 'unloaded'):
                        services[unit].disable_unloaded_for_hold()
                    else:
                        services[unit].bootstrap()
                deadline = time.monotonic() + 20
                running = {unit for unit in UNITS if approved[unit]['class'] in
                           ('daemon', 'known-broken')}
                while not all(services[unit].status()['running'] for unit in running):
                    self.assertLess(time.monotonic(), deadline, 'owned daemons did not start')
                    time.sleep(.05)
                writer_lock = root / 'writer.lock'
                writer_lock.write_bytes(b'owned writer lock')
                writer_lock.chmod(0o644)
                with (patch.dict(os.environ, {'HOME': str(home)}),
                      patch('preservation_journal.NATS_WRITER_MARKER', root / 'writer-handoff.json'),
                      patch('preservation_journal.NATS_LEGACY_LOCK', writer_lock),
                      patch('preservation_journal.NATS_ROOT_UID', os.getuid()),
                      gate_module.Gate(gate_root, pins) as gate):
                    with open_full_node_journal(root / 'journals' / 'window', gate, approved,
                                                boot='owned-boot', node_lock=root / 'node.lock') as journal:
                        prior = journal.prior
                        evidence = journal.records[0]['entrypoint_inventory']
                        self.assertEqual(set(prior), UNITS)
                        self.assertEqual(set(evidence['installed']), labels)
                        self.assertEqual(set(evidence['loaded']['gui']),
                                         labels - {'ai.openclaw.nats-1',
                                                   'ai.openclaw.federation-tick'})
                        self.assertEqual(evidence['loaded']['user'], [])
                        self.assertEqual(evidence['loaded']['system'], [])
                        self.assertEqual(sum(prior[unit]['running'] for unit in UNITS), len(running))
                        hold = JournaledHold(journal, gate, lambda: {'verified': True})
                        hold.close()
            finally:
                for service in services.values():
                    if service.status()['loaded']:
                        subprocess.run(['/bin/launchctl', 'bootout', 'gui/' + uid + '/' +
                                        service.label], capture_output=True, timeout=10)
                    if service.disabled():
                        subprocess.run(['/bin/launchctl', 'enable', 'gui/' + uid + '/' +
                                        service.label], capture_output=True, timeout=10)
                for unit in services:
                    self.assertFalse(services[unit].status()['loaded'])
                    self.assertFalse(services[unit].disabled())


if __name__ == '__main__':
    unittest.main()
