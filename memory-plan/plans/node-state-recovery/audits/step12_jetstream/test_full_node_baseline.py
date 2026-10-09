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
from preservation_checks import RESUME_ORDER, STOP_ORDER, disabled_overrides
from preservation_journal import (FULL_NODE_SCOPE, Journal, NATS_TRANSFER_UNITS, Refused, TIMER_UNITS,
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

    def loaded_entry(self, plist):
        source = pathlib.Path(plist)
        config = plistlib.loads(source.read_bytes())
        return {'path': str(source.resolve()), 'arguments': config['ProgramArguments'],
                'program': str(pathlib.Path(config.get('Program', config['ProgramArguments'][0])).resolve()),
                'working_directory': str(pathlib.Path(config.get('WorkingDirectory', '/')).resolve()),
                'environment': config.get('EnvironmentVariables', {})}

    def capture(self, inventory=None, statuses=None):
        inventory = inventory or [self.entrypoints, self.entrypoints]
        statuses = statuses or self.states
        def service(label, plist):
            return SimpleNamespace(status=lambda label=label: copy.deepcopy(statuses[label]),
                                   disabled=lambda label=label: statuses[label]['disabled'],
                                   configuration=lambda include_logs=False, plist=plist:
                                       self.loaded_entry(plist))
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
                                   disabled=lambda: self.states[label]['disabled'],
                                   configuration=lambda include_logs=False: self.loaded_entry(plist))
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

    def test_loaded_arguments_differ_from_approved_plist_refuses(self):
        def service(label, plist):
            entry = self.loaded_entry(plist)
            if label == 'ai.openclaw.gateway':
                entry['arguments'] = ['/bin/other']
            return SimpleNamespace(status=lambda: copy.deepcopy(self.states[label]),
                                   disabled=lambda: self.states[label]['disabled'],
                                   configuration=lambda include_logs=False: entry)
        with (patch('full_node_baseline.capture_entrypoint_inventory',
                    return_value=copy.deepcopy(self.entrypoints)),
              patch('full_node_baseline.Launchd', side_effect=service),
              self.assertRaisesRegex(Refused, 'loaded job differs from approved plist: gateway')):
            capture_full_node_prior(self.gate, self.approved)

    def test_loaded_path_differ_from_approved_plist_refuses(self):
        def service(label, plist):
            entry = self.loaded_entry(plist)
            if label == 'ai.openclaw.gateway':
                entry['path'] = str(self.root / 'stale.plist')
            return SimpleNamespace(status=lambda: copy.deepcopy(self.states[label]),
                                   disabled=lambda: self.states[label]['disabled'],
                                   configuration=lambda include_logs=False: entry)
        with (patch('full_node_baseline.capture_entrypoint_inventory',
                    return_value=copy.deepcopy(self.entrypoints)),
              patch('full_node_baseline.Launchd', side_effect=service),
              self.assertRaisesRegex(Refused, 'loaded job differs from approved plist: gateway')):
            capture_full_node_prior(self.gate, self.approved)

    def test_loaded_environment_differ_from_approved_plist_refuses(self):
        def service(label, plist):
            entry = self.loaded_entry(plist)
            if label == 'ai.openclaw.gateway':
                entry['environment'] = {'STALE': 'value'}
            return SimpleNamespace(status=lambda: copy.deepcopy(self.states[label]),
                                   disabled=lambda: self.states[label]['disabled'],
                                   configuration=lambda include_logs=False: entry)
        with (patch('full_node_baseline.capture_entrypoint_inventory',
                    return_value=copy.deepcopy(self.entrypoints)),
              patch('full_node_baseline.Launchd', side_effect=service),
              self.assertRaisesRegex(Refused, 'loaded job differs from approved plist: gateway')):
            capture_full_node_prior(self.gate, self.approved)

    def test_loaded_program_or_directory_drift_refuses(self):
        for field, value in (('program', '/bin/other'),
                             ('working_directory', str(self.root / 'other'))):
            with self.subTest(field=field):
                def service(label, plist):
                    entry = self.loaded_entry(plist)
                    if label == 'ai.openclaw.gateway':
                        entry[field] = value
                    return SimpleNamespace(status=lambda: copy.deepcopy(self.states[label]),
                                           disabled=lambda: self.states[label]['disabled'],
                                           configuration=lambda include_logs=False: entry)
                with (patch('full_node_baseline.capture_entrypoint_inventory',
                            return_value=copy.deepcopy(self.entrypoints)),
                      patch('full_node_baseline.Launchd', side_effect=service),
                      self.assertRaisesRegex(Refused,
                          'loaded job differs from approved plist: gateway')):
                    capture_full_node_prior(self.gate, self.approved)

    def test_loaded_configuration_change_during_baseline_refuses(self):
        calls = 0
        def service(label, plist):
            def configuration(include_logs=False):
                nonlocal calls
                entry = self.loaded_entry(plist)
                if label == 'ai.openclaw.gateway':
                    calls += 1
                    if calls == 2:
                        entry['arguments'] = ['/bin/other']
                return entry
            return SimpleNamespace(status=lambda: copy.deepcopy(self.states[label]),
                                   disabled=lambda: self.states[label]['disabled'],
                                   configuration=configuration)
        with (patch('full_node_baseline.capture_entrypoint_inventory',
                    return_value=copy.deepcopy(self.entrypoints)),
              patch('full_node_baseline.Launchd', side_effect=service),
              self.assertRaisesRegex(Refused, 'loaded job changed during baseline: gateway')):
            capture_full_node_prior(self.gate, self.approved)

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
                                   disabled=lambda: self.states[label]['disabled'],
                                   configuration=lambda include_logs=False: self.loaded_entry(plist))
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
                                   disabled=lambda: self.states[label]['disabled'],
                                   configuration=lambda include_logs=False: self.loaded_entry(plist))
        with (patch('full_node_baseline.capture_entrypoint_inventory', side_effect=inventory),
              patch('full_node_baseline.Launchd', side_effect=service)):
            with self.assertRaisesRegex(Refused, 'direct files changed during baseline'):
                capture_full_node_prior(self.gate, self.approved)


class OwnedFullNodeInventory(unittest.TestCase):
    def exercise_native_entrypoint_capture(self, release, bridge_failure=False,
                                           loaded_drift=None, daemon_sweep=False,
                                           missing_completion=False):
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
            swept = {'workplan-viewer', 'gateway', 'health-watch', 'node-watch',
                     'lane-watchdog', 'mission-control', 'mesh-task-daemon',
                     'memory-daemon', 'mesh-health-publisher'} if daemon_sweep else set()
            sweep_units = [unit for unit in STOP_ORDER if unit in swept]
            completion = {'health-watch': '[health-watch] shutting down',
                          'node-watch': '[node-watch] stopped',
                          'lane-watchdog': 'Received SIGTERM, shutting down',
                          'mesh-task-daemon': 'Shutdown complete.',
                          'memory-daemon': 'Daemon stopped'}
            sweep_stubs = {}
            for unit in sweep_units:
                script = root / (unit + '.cjs')
                ready = root / (unit + '-ready.json')
                log = root / (unit + '.log')
                err = root / (unit + '.err')
                log.touch(mode=0o600)
                err.touch(mode=0o600)
                script.write_text(listener_script.read_text()
                    .replace('═══ Ready ═══', unit + ' ready.')
                    .replace('SIGTERM — shutting down',
                             'unverified shutdown' if unit == 'mesh-task-daemon' and missing_completion
                             else completion.get(unit, unit + ' stopped.')))
                server = socket.socket()
                server.bind(('127.0.0.1', 0))
                server.listen()
                server.settimeout(20)
                self.addCleanup(server.close)
                sweep_stubs[unit] = {'script': script, 'ready': ready, 'log': log,
                                     'err': err, 'server': server}
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
                            [node, str(sweep_stubs[unit]['script'])]
                            if unit in swept else
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
                    if unit in swept:
                        stub = sweep_stubs[unit]
                        config.update({'EnvironmentVariables': {
                            'OWNED_BUS_PORT': str(stub['server'].getsockname()[1]),
                            'OWNED_READY': str(stub['ready'])},
                            'ExitTimeOut': 5, 'StandardOutPath': str(stub['log']),
                            'StandardErrorPath': str(stub['err'])})
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
                for unit in sweep_units:
                    stub = sweep_stubs[unit]
                    stub['connection'], _ = stub['server'].accept()
                    self.addCleanup(stub['connection'].close)
                while not listener_ready.exists() or '═══ Ready ═══' not in listener_log.read_text():
                    self.assertLess(time.monotonic(), deadline, 'owned listener did not become ready')
                    time.sleep(.05)
                while not bridge_ready.exists() or 'Bridge ready.' not in bridge_log.read_text():
                    self.assertLess(time.monotonic(), deadline, 'owned bridge did not become ready')
                    time.sleep(.05)
                for unit in sweep_units:
                    stub = sweep_stubs[unit]
                    while not stub['ready'].exists() or unit + ' ready.' not in stub['log'].read_text():
                        self.assertLess(time.monotonic(), deadline, 'owned daemon did not become ready: ' + unit)
                        time.sleep(.05)
                    stub['details'] = json.loads(stub['ready'].read_text())
                listener_details = json.loads(listener_ready.read_text())
                bridge_details = json.loads(bridge_ready.read_text())
                writer_lock = root / 'writer.lock'
                writer_lock.write_bytes(b'owned writer lock')
                writer_lock.chmod(0o644)
                if loaded_drift:
                    drift_unit = ('gateway' if loaded_drift == 'arguments'
                                  else 'mesh-deploy-listener')
                    drift_plist = agents / ('ai.openclaw.' + drift_unit + '.plist')
                    drift_config = plistlib.loads(drift_plist.read_bytes())
                    if loaded_drift == 'arguments':
                        drift_config['ProgramArguments'][-1] = '901'
                    else:
                        self.assertEqual(loaded_drift, 'environment')
                        drift_config['EnvironmentVariables']['OWNED_READY'] = str(root / 'stale-ready')
                    drift_plist.write_bytes(plistlib.dumps(drift_config))
                    drift_identity = static_identity(drift_plist)
                    approved[drift_unit]['plist']['sha256'] = drift_identity['plist_sha256']
                with (patch.dict(os.environ, {'HOME': str(home)}),
                      patch('preservation_journal.NATS_WRITER_MARKER', root / 'writer-handoff.json'),
                      patch('preservation_journal.NATS_LEGACY_LOCK', writer_lock),
                      patch('preservation_journal.NATS_ROOT_UID', os.getuid()),
                      gate_module.Gate(gate_root, pins) as gate):
                    if loaded_drift:
                        with self.assertRaisesRegex(Refused,
                                'loaded job differs from approved plist: ' + drift_unit):
                            open_full_node_journal(root / 'journals' / 'window', gate, approved,
                                                   boot='owned-boot', node_lock=root / 'node.lock')
                        self.assertFalse((root / 'node.lock.state.json').exists())
                        return
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
                            for unit in sweep_units:
                                stub = sweep_stubs[unit]
                                daemon = services[unit]
                                saved_identity = prior[unit]['identity']
                                bound = daemon.bind(saved_identity['argv'], saved_identity['argv'][0],
                                                    saved_identity['working_directory'])
                                self.assertEqual(bound['status']['pid'], stub['details']['pid'])
                                stub['binding'] = bound
                                def closed(connection=stub['connection']):
                                    connection.settimeout(.2)
                                    try:
                                        return connection.recv(1, socket.MSG_PEEK) == b''
                                    except socket.timeout:
                                        return False
                                def absent(port=stub['details']['port']):
                                    with socket.socket() as probe:
                                        probe.settimeout(.2)
                                        return probe.connect_ex(('127.0.0.1', port)) != 0
                                self.assertFalse(closed(), unit)
                                self.assertFalse(absent(), unit)
                                with StopWatch(daemon, bound, [stub['log'], stub['err']], unit,
                                               require_disabled=True) as watch:
                                    if unit == 'mesh-task-daemon' and missing_completion:
                                        with self.assertRaisesRegex(Refused,
                                                'normal completion marker missing or repeated'):
                                            watch.mutate(journal, unit, closed, absent, hold=hold)
                                        self.assertTrue(journal.listener_fenced())
                                        self.assertFalse(service.status()['loaded'])
                                        self.assertTrue(service.disabled())
                                        self.assertIsNotNone(gate.marker())
                                        self.assertTrue(any(row['event'] == 'failed'
                                                            and row.get('unit') == unit
                                                            for row in journal.records))
                                        self.assertFalse(any(row['event'] == 'verified'
                                                             and row.get('unit') == unit
                                                             for row in journal.records))
                                        self.assertFalse(any(row['event'] in
                                                             {'override-clear-intent', 'listener-release-verified'}
                                                             for row in journal.records))
                                        self.assertFalse(any(row['event'] == 'intent'
                                                             and row.get('unit') in
                                                             {'memory-daemon', 'mesh-health-publisher'}
                                                             for row in journal.records))
                                        with self.assertRaisesRegex(Refused,
                                                'unrestored node cannot be sealed'):
                                            journal.resolve()
                                        return
                                    stub['proof'] = watch.mutate(journal, unit, closed, absent,
                                                                 hold=hold)
                                self.assertTrue(journal.full_node_stop_proven(unit, stub['proof']), unit)
                                self.assertFalse(daemon.status()['loaded'], unit)
                                self.assertTrue(daemon.disabled(), unit)
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
                                    elif unit in swept:
                                        stub = sweep_stubs[unit]
                                        actual['verified'] = (current['running']
                                            and stub['ready'].exists()
                                            and json.loads(stub['ready'].read_text())['pid'] == current['pid']
                                            and stub['log'].read_text().count(unit + ' ready.') >= 2)
                                    else:
                                        actual['verified'] = all(actual[key] == saved[key]
                                            for key in ('loaded', 'running', 'disabled', 'identity'))
                                    return actual
                                def physical():
                                    others = all(observe(unit, prior[unit])['verified']
                                                 for unit in UNITS
                                                 if unit not in {'mesh-deploy-listener', 'mesh-bridge', *swept})
                                    sweep_ok = True
                                    for unit in sweep_units:
                                        stub = sweep_stubs[unit]
                                        daemon = services[unit]
                                        if daemon.status()['running']:
                                            current = json.loads(stub['ready'].read_text())
                                            with socket.socket() as probe:
                                                probe.settimeout(.2)
                                                present = probe.connect_ex(('127.0.0.1', current['port'])) == 0
                                            sweep_ok = (sweep_ok and observe(unit, prior[unit])['verified']
                                                        and new_bus_alive(stub.get('new_connection'))
                                                        and present)
                                        else:
                                            with socket.socket() as probe:
                                                probe.settimeout(.2)
                                                absent = probe.connect_ex(
                                                    ('127.0.0.1', stub['details']['port'])) != 0
                                            sweep_ok = (sweep_ok and daemon.disabled()
                                                        and stub['proof']['connections_closed'] and absent)
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
                                    return {'verified': others and sweep_ok and bridge_ok and listener_ok}
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
                                            timeout=2 if bridge_failure else 10)
                                        self.assertNotEqual(restarted['status']['pid'],
                                                            bridge_binding['status']['pid'])
                                        new_bridge_bus_connection, _ = bridge_bus_server.accept()
                                        self.addCleanup(new_bridge_bus_connection.close)
                                    elif unit in swept:
                                        self.assertEqual(fence_checks, [])
                                        self.assertTrue(service.disabled())
                                        stub = sweep_stubs[unit]
                                        stub['ready'].unlink()
                                        def ready(owner):
                                            return (stub['ready'].exists()
                                                and json.loads(stub['ready'].read_text())['pid']
                                                == owner['status']['pid']
                                                and stub['log'].read_text().count(unit + ' ready.') >= 2)
                                        restarted = restore_disabled_daemon(
                                            services[unit], journal, unit, saved, ready, timeout=10)
                                        self.assertNotEqual(restarted['status']['pid'],
                                                            stub['binding']['status']['pid'])
                                        stub['new_connection'], _ = stub['server'].accept()
                                        self.addCleanup(stub['new_connection'].close)
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
                                    self.assertTrue(bridge_service.status()['running'])
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
                                    before_retry = len(journal.records)
                                    with self.assertRaisesRegex(Refused,
                                            'cleared without verified recovery: mesh-bridge'):
                                        hold.recover(lambda *_: self.fail('retry restored a service'),
                                                     observe, physical,
                                                     deploy_fence=lambda: self.fail('retry released listener'))
                                    self.assertEqual(len(journal.records), before_retry)
                                    return
                                self.assertTrue(result['restored'], result)
                                self.assertEqual(fence_checks, [True])
                                self.assertTrue(bridge_service.status()['running'])
                                self.assertFalse(bridge_service.disabled())
                                for unit in sweep_units:
                                    self.assertTrue(services[unit].status()['running'], unit)
                                    self.assertFalse(services[unit].disabled(), unit)
                                self.assertTrue(service.status()['running'])
                                self.assertFalse(service.disabled())
                                self.assertIsNone(gate.marker())
                                rows = [(row['event'], row.get('unit')) for row in journal.records]
                                if daemon_sweep:
                                    expected = {unit for unit, saved in prior.items()
                                                if saved['class'] == 'daemon'
                                                and unit not in NATS_TRANSFER_UNITS
                                                and unit != 'mesh-deploy-listener'}
                                    self.assertEqual(expected, set(sweep_units) | {'mesh-bridge'})
                                    self.assertEqual(len(expected), 10)
                                    for unit in expected:
                                        self.assertEqual(rows.count(('intent', unit)), 1, unit)
                                        self.assertEqual(rows.count(('recovery-verified', unit)), 1, unit)
                                        self.assertLess(rows.index(('recovery-verified', unit)),
                                                        rows.index(('listener-release-verified', None)))
                                    ordered = [unit for unit in RESUME_ORDER if unit in expected]
                                    self.assertEqual(
                                        [unit for event, unit in rows
                                         if event == 'recovery-verified' and unit in expected], ordered)
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

    @unittest.skipUnless(sys.platform == 'darwin'
                         and os.environ.get('OPENCLAW_CI_FULL_NODE_INVENTORY_FIXTURE') == '1',
                         '23-label inventory fixture runs only on a dedicated macOS CI runner')
    def test_native_entrypoint_capture_sweeps_plain_daemons(self):
        self.exercise_native_entrypoint_capture(True, daemon_sweep=True)

    @unittest.skipUnless(sys.platform == 'darwin'
                         and os.environ.get('OPENCLAW_CI_FULL_NODE_INVENTORY_FIXTURE') == '1',
                         '23-label inventory fixture runs only on a dedicated macOS CI runner')
    def test_native_entrypoint_capture_refuses_daemon_without_completion(self):
        self.exercise_native_entrypoint_capture(False, daemon_sweep=True,
                                               missing_completion=True)

    @unittest.skipUnless(sys.platform == 'darwin'
                         and os.environ.get('OPENCLAW_CI_FULL_NODE_INVENTORY_FIXTURE') == '1',
                         '23-label inventory fixture runs only on a dedicated macOS CI runner')
    def test_native_entrypoint_capture_refuses_loaded_plist_drift(self):
        self.exercise_native_entrypoint_capture(False, loaded_drift='arguments')

    @unittest.skipUnless(sys.platform == 'darwin'
                         and os.environ.get('OPENCLAW_CI_FULL_NODE_INVENTORY_FIXTURE') == '1',
                         '23-label inventory fixture runs only on a dedicated macOS CI runner')
    def test_native_entrypoint_capture_refuses_loaded_environment_drift(self):
        self.exercise_native_entrypoint_capture(False, loaded_drift='environment')


if __name__ == '__main__':
    unittest.main()
