import copy
import hashlib
import pathlib
import plistlib
import tempfile
import unittest
from types import SimpleNamespace
from unittest.mock import patch

from full_node_baseline import capture_full_node_prior
from preservation_journal import FULL_NODE_SCOPE, Journal, Refused, TIMER_UNITS, UNITS


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
        with patch('preservation_journal.capture_entrypoint_inventory',
                   return_value=copy.deepcopy(entrypoints)):
            journal = Journal(self.root / 'journals' / 'window', prior,
                              boot='owned-boot', node_lock=self.root / 'node.lock',
                              scope=FULL_NODE_SCOPE)
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


if __name__ == '__main__':
    unittest.main()
