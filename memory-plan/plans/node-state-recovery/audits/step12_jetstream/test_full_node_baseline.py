import copy
import hashlib
import json
import os
import pathlib
import plistlib
import shutil
import socket
import subprocess
import sys
import tempfile
import time
import unittest
from types import SimpleNamespace
from unittest.mock import patch

from full_node_baseline import capture_full_node_prior, open_full_node_journal
from journal_hold import JournaledHold
from managed_launchd import Launchd, StopWatch, restore_disabled_daemon
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
    def exercise_native_entrypoint_capture(self, release, bridge_failure=False):
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
            listener_script = root / 'listener.cjs'
            listener_ready = root / 'listener-ready.json'
            listener_log = root / 'listener.log'
            listener_err = root / 'listener.err'
            listener_log.touch(mode=0o600)
            listener_err.touch(mode=0o600)
            listener_script.write_text('''
const fs=require('node:fs'),net=require('node:net');
const bus=net.connect(Number(process.env.OWNED_BUS_PORT),'127.0.0.1');
const listener=net.createServer(connection=>connection.destroy());
bus.once('connect',()=>listener.listen(0,'127.0.0.1',()=>{
 fs.writeFileSync(process.env.OWNED_READY+'.pending',JSON.stringify({pid:process.pid,port:listener.address().port}));
 fs.renameSync(process.env.OWNED_READY+'.pending',process.env.OWNED_READY);
 console.log('═══ Ready ═══');
}));
process.on('SIGTERM',()=>{
 bus.end();
 listener.close(()=>{console.log('SIGTERM — shutting down');process.exit(0);});
});
''')
            bridge_script = root / 'bridge.cjs'
            bridge_script.write_text(listener_script.read_text()
                .replace('═══ Ready ═══', 'Bridge ready.')
                .replace('SIGTERM — shutting down', 'Bridge stopped.'))
            bridge_ready = root / 'bridge-ready.json'
            bridge_log = root / 'bridge.log'
            bridge_err = root / 'bridge.err'
            bridge_log.touch(mode=0o600)
            bridge_err.touch(mode=0o600)
            node = shutil.which('node')
            self.assertIsNotNone(node)
            bus_server = socket.socket()
            bus_server.bind(('127.0.0.1', 0))
            bus_server.listen()
            bus_server.settimeout(20)
            self.addCleanup(bus_server.close)
            bridge_bus_server = socket.socket()
            bridge_bus_server.bind(('127.0.0.1', 0))
            bridge_bus_server.listen()
            bridge_bus_server.settimeout(20)
            self.addCleanup(bridge_bus_server.close)
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
                            [node, str(listener_script)]
                            if unit == 'mesh-deploy-listener' else
                            [node, str(bridge_script)]
                            if unit == 'mesh-bridge' else
                            ['/bin/sleep', '900'])
                    plist = agents / (label + '.plist')
                    config = {
                        'Label': label, 'ProgramArguments': argv,
                        'WorkingDirectory': str(root),
                        'RunAtLoad': kind in ('daemon', 'known-broken'),
                        'KeepAlive': False}
                    if unit == 'mesh-deploy-listener':
                        config.update({'EnvironmentVariables': {
                            'OWNED_BUS_PORT': str(bus_server.getsockname()[1]),
                            'OWNED_READY': str(listener_ready)},
                            'ExitTimeOut': 5, 'StandardOutPath': str(listener_log),
                            'StandardErrorPath': str(listener_err)})
                    if unit == 'mesh-bridge':
                        config.update({'EnvironmentVariables': {
                            'OWNED_BUS_PORT': str(bridge_bus_server.getsockname()[1]),
                            'OWNED_READY': str(bridge_ready)},
                            'ExitTimeOut': 5, 'StandardOutPath': str(bridge_log),
                            'StandardErrorPath': str(bridge_err)})
                    plist.write_bytes(plistlib.dumps(config))
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
                bus_connection, _ = bus_server.accept()
                self.addCleanup(bus_connection.close)
                bridge_bus_connection, _ = bridge_bus_server.accept()
                self.addCleanup(bridge_bus_connection.close)
                while not listener_ready.exists() or '═══ Ready ═══' not in listener_log.read_text():
                    self.assertLess(time.monotonic(), deadline, 'owned listener did not become ready')
                    time.sleep(.05)
                while not bridge_ready.exists() or 'Bridge ready.' not in bridge_log.read_text():
                    self.assertLess(time.monotonic(), deadline, 'owned bridge did not become ready')
                    time.sleep(.05)
                listener_details = json.loads(listener_ready.read_text())
                bridge_details = json.loads(bridge_ready.read_text())
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
                        def fast_check():
                            return {'verified': physical()['verified'] if release else True,
                                    'baseline_sha256': journal.records[0]['sha256']}
                        hold = JournaledHold(journal, gate, fast_check)
                        try:
                            hold.close_and_drain()
                            closed = hold.check_forward()
                            self.assertTrue(closed['verified'])
                            self.assertTrue(closed['kernel_file_watch'])
                            self.assertTrue(closed['path_watch']['kernel_path_watch'])
                            self.assertEqual(gate.marker(), {key: journal.records[1]['hold'][key]
                                                             for key in ('window', 'reason')})
                            self.assertEqual(journal.records[2]['receipt'], closed['receipt'])
                            self.assertEqual([row['event'] for row in journal.records[:4]],
                                             ['baseline', 'intent', 'hold-published', 'verified'])
                            service = services['mesh-deploy-listener']
                            identity = prior['mesh-deploy-listener']['identity']
                            binding = service.bind(identity['argv'], identity['argv'][0],
                                                   identity['working_directory'])
                            self.assertEqual(binding['status']['pid'], listener_details['pid'])
                            def connection_closed():
                                bus_connection.settimeout(.2)
                                try:
                                    return bus_connection.recv(1, socket.MSG_PEEK) == b''
                                except socket.timeout:
                                    return False
                            def listener_absent():
                                with socket.socket() as probe:
                                    probe.settimeout(.2)
                                    return probe.connect_ex(('127.0.0.1', listener_details['port'])) != 0
                            bridge_service = services['mesh-bridge']
                            bridge_identity = prior['mesh-bridge']['identity']
                            bridge_binding = bridge_service.bind(
                                bridge_identity['argv'], bridge_identity['argv'][0],
                                bridge_identity['working_directory'])
                            self.assertEqual(bridge_binding['status']['pid'], bridge_details['pid'])
                            def bridge_connection_closed():
                                bridge_bus_connection.settimeout(.2)
                                try:
                                    return bridge_bus_connection.recv(1, socket.MSG_PEEK) == b''
                                except socket.timeout:
                                    return False
                            def bridge_listener_absent():
                                with socket.socket() as probe:
                                    probe.settimeout(.2)
                                    return probe.connect_ex(('127.0.0.1', bridge_details['port'])) != 0
                            def bridge_listener_present():
                                if not bridge_ready.exists():
                                    return False
                                current = json.loads(bridge_ready.read_text())
                                with socket.socket() as probe:
                                    probe.settimeout(.2)
                                    return probe.connect_ex(('127.0.0.1', current['port'])) == 0
                            self.assertFalse(connection_closed())
                            self.assertFalse(listener_absent())
                            self.assertFalse(bridge_connection_closed())
                            self.assertFalse(bridge_listener_absent())
                            before_bridge = len(journal.records)
                            with StopWatch(bridge_service, bridge_binding,
                                           [bridge_log, bridge_err], 'mesh-bridge',
                                           require_disabled=True) as watch:
                                with self.assertRaisesRegex(Refused,
                                        'deploy listener must be verifiably disabled'):
                                    watch.mutate(journal, 'mesh-bridge',
                                                 bridge_connection_closed,
                                                 bridge_listener_absent, hold=hold)
                            self.assertEqual(len(journal.records), before_bridge)
                            self.assertTrue(bridge_service.status()['running'])
                            self.assertFalse(bridge_service.disabled())
                            with StopWatch(service, binding, [listener_log, listener_err],
                                           'mesh-deploy-listener',
                                           startup_segment=listener_log.read_text(),
                                           require_disabled=True) as watch:
                                proof = watch.mutate(journal, 'mesh-deploy-listener',
                                                     connection_closed, listener_absent, hold=hold)
                            self.assertTrue(Journal.managed_stop_proven(proof))
                            self.assertTrue(journal.listener_fenced())
                            self.assertFalse(service.status()['loaded'])
                            self.assertTrue(service.disabled())
                            with StopWatch(bridge_service, bridge_binding,
                                           [bridge_log, bridge_err], 'mesh-bridge',
                                           require_disabled=True) as watch:
                                bridge_proof = watch.mutate(journal, 'mesh-bridge',
                                                            bridge_connection_closed,
                                                            bridge_listener_absent, hold=hold)
                            self.assertTrue(Journal.managed_stop_proven(bridge_proof))
                            self.assertTrue(journal.full_node_stop_proven('mesh-bridge', bridge_proof))
                            self.assertEqual(bridge_proof['termination'], {'exit': 0})
                            self.assertIs(bridge_proof['entrypoint_overrides']['gui'][
                                'ai.openclaw.mesh-bridge'], True)
                            self.assertIs(bridge_proof['entrypoint_overrides']['user'][
                                'ai.openclaw.mesh-bridge'], True)
                            self.assertFalse(bridge_service.status()['loaded'])
                            self.assertTrue(bridge_service.disabled())
                            if release:
                                new_bus_connection = None
                                new_bridge_bus_connection = None
                                def new_bus_alive(connection):
                                    if connection is None:
                                        return False
                                    connection.settimeout(.2)
                                    try:
                                        return connection.recv(1, socket.MSG_PEEK) != b''
                                    except socket.timeout:
                                        return True
                                def observe(unit, saved):
                                    current = services[unit].status()
                                    actual = {**saved, 'loaded': current['loaded'],
                                              'running': current['running'],
                                              'disabled': services[unit].disabled(),
                                              'identity': static_identity(services[unit].plist)}
                                    if unit == 'mesh-deploy-listener':
                                        actual['verified'] = (current['running']
                                            and listener_ready.exists()
                                            and json.loads(listener_ready.read_text())['pid'] == current['pid']
                                            and listener_log.read_text().count('═══ Ready ═══') >= 2)
                                    elif unit == 'mesh-bridge':
                                        actual['verified'] = (current['running']
                                            and bridge_ready.exists()
                                            and json.loads(bridge_ready.read_text())['pid'] == current['pid']
                                            and bridge_log.read_text().count('Bridge ready.') >= 2)
                                    else:
                                        actual['verified'] = all(actual[key] == saved[key]
                                            for key in ('loaded', 'running', 'disabled', 'identity'))
                                    return actual
                                def physical():
                                    others = all(observe(unit, prior[unit])['verified']
                                                 for unit in UNITS
                                                 if unit not in ('mesh-deploy-listener', 'mesh-bridge'))
                                    if bridge_service.status()['running']:
                                        bridge_ok = (observe('mesh-bridge', prior['mesh-bridge'])['verified']
                                                     and new_bus_alive(new_bridge_bus_connection)
                                                     and bridge_listener_present())
                                    else:
                                        bridge_ok = (bridge_service.disabled()
                                                     and bridge_proof['connections_closed']
                                                     and bridge_listener_absent())
                                    listener_running = service.status()['running']
                                    if listener_running:
                                        listener_ok = (observe('mesh-deploy-listener',
                                                              prior['mesh-deploy-listener'])['verified']
                                                       and new_bus_alive(new_bus_connection))
                                    else:
                                        listener_ok = (service.disabled() and proof['connections_closed']
                                                       and listener_absent())
                                    return {'verified': others and bridge_ok and listener_ok}
                                fence_checks = []
                                def deploy_fence():
                                    checked = (gate.marker() is not None and service.disabled()
                                               and not service.status()['loaded'])
                                    fence_checks.append(checked)
                                    return {'verified': checked}
                                def restore(unit, saved):
                                    nonlocal new_bus_connection, new_bridge_bus_connection
                                    self.assertEqual(gate.marker(),
                                        {key: journal.records[1]['hold'][key]
                                         for key in ('window', 'reason')})
                                    if unit == 'mesh-bridge':
                                        self.assertEqual(fence_checks, [])
                                        self.assertTrue(service.disabled())
                                        bridge_ready.unlink()
                                        def ready(owner):
                                            return (not bridge_failure and bridge_ready.exists()
                                                and json.loads(bridge_ready.read_text())['pid']
                                                == owner['status']['pid']
                                                and bridge_log.read_text().count('Bridge ready.') >= 2)
                                        restarted = restore_disabled_daemon(
                                            bridge_service, journal, unit, saved, ready,
                                            timeout=.3 if bridge_failure else 10)
                                        self.assertNotEqual(restarted['status']['pid'],
                                                            bridge_binding['status']['pid'])
                                        new_bridge_bus_connection, _ = bridge_bus_server.accept()
                                        self.addCleanup(new_bridge_bus_connection.close)
                                    else:
                                        self.assertEqual(unit, 'mesh-deploy-listener')
                                        self.assertEqual(fence_checks, [True])
                                        listener_ready.unlink()
                                        def ready(owner):
                                            return (listener_ready.exists()
                                                and json.loads(listener_ready.read_text())['pid']
                                                == owner['status']['pid']
                                                and listener_log.read_text().count('═══ Ready ═══') >= 2)
                                        restarted = restore_disabled_daemon(service, journal, unit,
                                                                             saved, ready, timeout=10)
                                        self.assertNotEqual(restarted['status']['pid'],
                                                            binding['status']['pid'])
                                        new_bus_connection, _ = bus_server.accept()
                                        self.addCleanup(new_bus_connection.close)
                                result = hold.recover(restore, observe, physical,
                                                      deploy_fence=deploy_fence)
                                if bridge_failure:
                                    self.assertFalse(result['restored'], result)
                                    self.assertEqual(fence_checks, [])
                                    self.assertTrue(bridge_service.disabled())
                                    self.assertFalse(service.status()['loaded'])
                                    self.assertTrue(service.disabled())
                                    self.assertIsNotNone(gate.marker())
                                    self.assertTrue(any(error['unit'] == 'mesh-bridge'
                                                        and 'did not reach readiness' in error['detail']
                                                        for error in result['errors']), result)
                                    rows = [(row['event'], row.get('unit'))
                                            for row in journal.records]
                                    self.assertNotIn(('listener-release-verified', None), rows)
                                    self.assertNotIn(('restoration-intent', 'mesh-deploy-listener'), rows)
                                    with self.assertRaisesRegex(Refused,
                                            'unrestored node cannot be sealed'):
                                        journal.resolve()
                                    return
                                self.assertTrue(result['restored'], result)
                                self.assertEqual(fence_checks, [True])
                                self.assertTrue(bridge_service.status()['running'])
                                self.assertFalse(bridge_service.disabled())
                                self.assertTrue(service.status()['running'])
                                self.assertFalse(service.disabled())
                                self.assertIsNone(gate.marker())
                                rows = [(row['event'], row.get('unit')) for row in journal.records]
                                self.assertLess(rows.index(('restoration-intent', 'mesh-bridge')),
                                                rows.index(('override-clear-intent', 'mesh-bridge')))
                                self.assertLess(rows.index(('override-clear-intent', 'mesh-bridge')),
                                                rows.index(('recovery-verified', 'mesh-bridge')))
                                self.assertLess(rows.index(('recovery-verified', 'mesh-bridge')),
                                                rows.index(('listener-release-verified', None)))
                                self.assertLess(rows.index(('listener-release-verified', None)),
                                                rows.index(('restoration-intent', 'mesh-deploy-listener')))
                                self.assertLess(rows.index(('restoration-intent', 'mesh-deploy-listener')),
                                                rows.index(('override-clear-intent', 'mesh-deploy-listener')))
                                self.assertLess(rows.index(('override-clear-intent', 'mesh-deploy-listener')),
                                                rows.index(('recovery-verified', 'mesh-deploy-listener')))
                                self.assertLess(rows.index(('recovery-verified', 'mesh-deploy-listener')),
                                                rows.index(('final-state-verified', None)))
                                self.assertLess(rows.index(('final-state-verified', None)),
                                                rows.index(('hold-reopen-ready', None)))
                                self.assertLess(rows.index(('hold-reopen-ready', None)),
                                                rows.index(('hold-opened', None)))
                                self.assertLess(rows.index(('hold-opened', None)),
                                                rows.index(('recovery-finished', None)))
                                self.assertFalse(any(row['event'] == 'failed' for row in journal.records))
                                self.assertFalse(next(row for row in journal.records
                                    if row['event'] == 'hold-opened')['restored_only'])
                                self.assertTrue(journal.resolve())
                                self.assertEqual(journal.records[-1]['event'], 'resolved')
                            else:
                                stopped = subprocess.run(['/bin/launchctl', 'bootout',
                                                          'gui/' + uid + '/ai.openclaw.gateway'],
                                                         capture_output=True, timeout=10)
                                self.assertEqual(stopped.returncode, 0, stopped.stderr)
                                deadline = time.monotonic() + 10
                                while services['gateway'].status()['loaded']:
                                    self.assertLess(time.monotonic(), deadline,
                                                    'owned gateway did not unload')
                                    time.sleep(.05)
                                with self.assertRaisesRegex(Refused,
                                        'full-node loaded jobs changed inside the forward window'):
                                    journal.check_entrypoints(forward=True)
                        finally:
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

    @unittest.skipUnless(sys.platform == 'darwin'
                         and os.environ.get('OPENCLAW_CI_FULL_NODE_INVENTORY_FIXTURE') == '1',
                         '23-label inventory fixture runs only on a dedicated macOS CI runner')
    def test_native_entrypoint_capture_refuses_forward_drift(self):
        self.exercise_native_entrypoint_capture(False)

    @unittest.skipUnless(sys.platform == 'darwin'
                         and os.environ.get('OPENCLAW_CI_FULL_NODE_INVENTORY_FIXTURE') == '1',
                         '23-label inventory fixture runs only on a dedicated macOS CI runner')
    def test_native_entrypoint_capture_restores_listener_after_release(self):
        self.exercise_native_entrypoint_capture(True)

    @unittest.skipUnless(sys.platform == 'darwin'
                         and os.environ.get('OPENCLAW_CI_FULL_NODE_INVENTORY_FIXTURE') == '1',
                         '23-label inventory fixture runs only on a dedicated macOS CI runner')
    def test_native_entrypoint_capture_keeps_listener_fenced_after_bridge_failure(self):
        self.exercise_native_entrypoint_capture(True, bridge_failure=True)


if __name__ == '__main__':
    unittest.main()
