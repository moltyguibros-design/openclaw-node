import json
import hashlib
import os
import pathlib
import plistlib
import secrets
import select
import shutil
import socket
import subprocess
import sys
import tempfile
import time
import unittest
from types import SimpleNamespace
from unittest.mock import patch

from managed_launchd import (Launchd, StopWatch, process_exists, process_tree,
                             restore_disabled_daemon, unload_idle_timer)
from legacy_fixture import legacy_journal
from preservation_checks import Refused, http_json
from preservation_journal import Journal
from test_preservation_journal import inventory


def free_port():
    with socket.socket() as connection:
        connection.bind(('127.0.0.1', 0))
        return connection.getsockname()[1]


def wait_for(check, seconds=10):
    end = time.monotonic() + seconds
    while time.monotonic() < end:
        value = check()
        if value:
            return value
        time.sleep(.02)
    raise AssertionError('owned fixture deadline exceeded')


class StopWatchPreflight(unittest.TestCase):
    def test_interrupted_restore_reinstates_override_and_propagates_interrupt(self):
        state = {'disabled': True}
        events = []
        def enable():
            state['disabled'] = False
            raise KeyboardInterrupt()
        service = SimpleNamespace(label='ai.openclaw.gateway',
            enable_after_hold=enable, status=lambda domain='gui': {'loaded': False, 'running': False},
            disabled=lambda: state['disabled'],
            disable_unloaded_for_hold=lambda: state.update(disabled=True),
            bootstrap=lambda: self.fail('bootstrap reached'))
        prior = {'class': 'daemon', 'loaded': True}
        journal = SimpleNamespace(begin_override_clear=lambda unit: events.append(unit))
        with self.assertRaises(KeyboardInterrupt):
            restore_disabled_daemon(service, journal, 'gateway', prior, lambda _: False)
        self.assertEqual(events, ['gateway'])
        self.assertTrue(state['disabled'])

    def test_persistent_idle_timer_refuses_a_start_during_disable(self):
        with tempfile.TemporaryDirectory(prefix='openclaw-owned-idle-race-') as directory:
            root = pathlib.Path(directory)
            plist = root / 'timer.plist'
            log = root / 'timer.log'
            plist.write_bytes(b'owned timer')
            log.write_bytes(b'')
            state = {'loaded': True, 'running': False, 'pid': None}
            def disable():
                state.update(running=True, pid=123)
            service = SimpleNamespace(plist=plist, status=lambda: dict(state),
                configuration=lambda: {'path': str(plist.resolve()), 'logs': [str(log.resolve())]},
                disable_for_hold=disable)
            apply, _ = unload_idle_timer(service, [log], require_disabled=True)
            with patch('managed_launchd.command') as command:
                with self.assertRaisesRegex(Refused, 'started while establishing'):
                    apply()
            command.assert_not_called()

    def test_status_inspection_has_a_deadline(self):
        service = Launchd('ai.openclaw.gateway', '/owned/gateway.plist')
        target = 'gui/' + str(os.getuid()) + '/ai.openclaw.gateway'
        with patch('managed_launchd.subprocess.run',
                   side_effect=subprocess.TimeoutExpired(['/bin/launchctl', 'print', target], 10)) as run:
            with self.assertRaises(subprocess.TimeoutExpired):
                service.status()
        run.assert_called_once_with(['/bin/launchctl', 'print', target],
                                    capture_output=True, text=True, timeout=10)

    def test_process_tree_closes_over_orphaned_group_member_children(self):
        processes = '100 1 100\n200 1 100\n300 200 300\n400 300 400\n'
        with patch('managed_launchd.command', return_value=processes):
            self.assertEqual(set(process_tree(100)), {100, 200, 300, 400})

    def test_process_tree_closes_over_descendant_groups(self):
        tables = (
            '100 1 100\n200 100 200\n300 1 200\n500 1 500\n',
            '100 1 100\n200 1 100\n300 200 300\n400 1 300\n500 1 500\n',
        )
        for processes in tables:
            with self.subTest(processes=processes), patch('managed_launchd.command', return_value=processes):
                self.assertEqual(set(process_tree(100)), set(int(line.split()[0]) for line in processes.splitlines()) - {500})

    def test_stop_refuses_survivor_in_descendant_group(self):
        watch = SimpleNamespace(binding={'tree': {100: {}, 200: {}}, 'status': {'pid': 100, 'exit_timeout': 1}},
            events={100: {}, 200: {}}, drain=lambda *_: None,
            service=SimpleNamespace(status=lambda: {'loaded': False}),
            bootout={'timed_out': False, 'returncode': 0}, require_disabled=False,
            unchanged_lifecycle=lambda: None, normal_exit=lambda *_: None,
            groups={100, 200})
        with patch('managed_launchd.process_exists', return_value=False), patch('managed_launchd.process_tree',
                side_effect=lambda _, group: {300: {}} if group == 200 else {}):
            with self.assertRaisesRegex(Refused, 'former process group survives'):
                StopWatch.verify(watch, lambda: self.fail('bus check reached'),
                    lambda: self.fail('listener check reached'), deadline=0)

    def test_stop_refuses_process_group_change_before_signal(self):
        status = {'pid': 100}
        watch = SimpleNamespace(prepared=True, drain=lambda: None,
            unchanged_lifecycle=lambda: None, service=SimpleNamespace(
                label='ai.openclaw.gateway', status=lambda: status),
            binding={'status': status, 'tree': {100: {'group': 100}, 200: {'group': 200}}},
            events={})
        with patch('managed_launchd.process_tree', return_value={
                100: {'group': 100}, 200: {'group': 300}}):
            with self.assertRaisesRegex(Refused, 'process descendants or group changed'):
                StopWatch.ready_for_intent(watch)

    def test_deploy_listener_with_child_refuses_before_signal(self):
        status = {'pid': 101}
        watch = SimpleNamespace(prepared=True, drain=lambda: None,
            unchanged_lifecycle=lambda: None, service=SimpleNamespace(
                label='ai.openclaw.mesh-deploy-listener', status=lambda: status),
            binding={'status': status, 'tree': {101: {}, 102: {}}}, events={})
        with self.assertRaisesRegex(Refused, 'deploy listener has a child'):
            StopWatch.ready_for_intent(watch)

    def test_persistent_stop_refuses_without_disabled_override(self):
        watch = SimpleNamespace(ready_for_intent=lambda: None, drain=lambda: None,
            unchanged_lifecycle=lambda: None, require_disabled=True,
            service=SimpleNamespace(disabled=lambda: False))
        with self.assertRaisesRegex(Refused, 'requires a disabled managed unit'):
            StopWatch.apply(watch)

    def test_persistent_stop_refuses_without_its_journal_hold(self):
        watch = SimpleNamespace(ready_for_intent=lambda: None, require_disabled=True)
        journal = SimpleNamespace(scope=None)
        with self.assertRaisesRegex(Refused, 'original execution hold'):
            StopWatch.mutate(watch, journal, 'mesh-deploy-listener', lambda: True, lambda: True)
        with self.assertRaisesRegex(Refused, 'original execution hold'):
            StopWatch.mutate(watch, journal, 'mesh-deploy-listener', lambda: True, lambda: True,
                             hold=SimpleNamespace(journal=object()))

    def test_held_stop_records_unload_without_disabling(self):
        journal = SimpleNamespace(scope=None)
        calls = []
        hold = SimpleNamespace(journal=journal, mutate=lambda unit, action, apply, verify,
                               failure_evidence: calls.append((unit, action)))
        watch = SimpleNamespace(ready_for_intent=lambda: None, require_disabled=False,
                                apply=lambda: None, verify=lambda *_: {'verified': True},
                                failure_evidence=lambda error: {})
        StopWatch.mutate(watch, journal, 'nats', lambda: True, lambda: True, hold=hold)
        self.assertEqual(calls, [('nats', 'unload')])

    def test_held_unload_refuses_a_foreign_journal(self):
        watch = SimpleNamespace(ready_for_intent=lambda: None, require_disabled=False)
        with self.assertRaisesRegex(Refused, 'original execution hold'):
            StopWatch.mutate(watch, SimpleNamespace(scope=None), 'nats', lambda: True,
                             lambda: True, hold=SimpleNamespace(journal=object()))

    def test_full_node_stop_requires_the_bound_unit_label(self):
        watch = SimpleNamespace(service=SimpleNamespace(label='ai.openclaw.gateway'),
                                ready_for_intent=lambda: self.fail('stop watch reached'))
        with self.assertRaisesRegex(Refused, 'owner differs from journal unit'):
            StopWatch.mutate(watch, SimpleNamespace(scope='full-node'), 'mesh-deploy-listener',
                             lambda: True, lambda: True)

    def test_full_node_stop_refuses_unrestorable_override_or_plain_listener(self):
        journal = SimpleNamespace(scope='full-node')
        for unit, persistent, expected in (
                ('mesh-deploy-listener', False, 'deploy listener requires'),
                ('gateway', True, 'other full-node units lack')):
            watch = SimpleNamespace(service=SimpleNamespace(label='ai.openclaw.' + unit),
                                    require_disabled=persistent,
                                    ready_for_intent=lambda: self.fail('stop watch reached'))
            with self.subTest(unit=unit), self.assertRaisesRegex(Refused, expected):
                StopWatch.mutate(watch, journal, unit, lambda: True, lambda: True)

    def test_persistent_stop_refuses_a_preexisting_override_before_intent(self):
        journal = SimpleNamespace(scope='full-node')
        hold = SimpleNamespace(journal=journal,
                               mutate=lambda *_args, **_kwargs: self.fail('intent reached'))
        watch = SimpleNamespace(service=SimpleNamespace(
            label='ai.openclaw.mesh-deploy-listener', disabled=lambda: True),
            require_disabled=True, ready_for_intent=lambda: None)
        with self.assertRaisesRegex(Refused, 'disabled before its stop intent'):
            StopWatch.mutate(watch, journal, 'mesh-deploy-listener', lambda: True,
                             lambda: True, hold=hold)


@unittest.skipUnless(sys.platform == 'darwin', 'requires actual macOS launchd and exit events')
class OwnedLaunchd(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        os.umask(0o077)
        cls.root = pathlib.Path(tempfile.mkdtemp(prefix='openclaw-owned-launchd-',
                                dir=os.environ.get('OPENCLAW_OWNED_TEST_ROOT'))).resolve()
        cls.proofs = []
        cls.token = secrets.token_hex(32)
        cls.port, cls.monitor = free_port(), free_port()
        cls.node = os.environ.get('RECOVERY_NODE') or shutil.which('node')
        cls.nats = os.environ.get('NATS_SERVER') or shutil.which('nats-server')
        cls.package = pathlib.Path(os.environ.get('RECOVERY_NATS_MODULE') or
                                  pathlib.Path(__file__).parents[5] / 'node_modules/nats').resolve(strict=True)
        config = cls.root / 'server.conf'
        config.write_text(f'host: 127.0.0.1\nport: {cls.port}\nhttp_port: {cls.monitor}\nauthorization {{ token: "{cls.token}" }}\n')
        cls.server_log = (cls.root / 'server.log').open('wb')
        cls.server = subprocess.Popen([cls.nats, '-c', str(config)], stdout=cls.server_log, stderr=cls.server_log)
        def ready():
            try:
                return http_json(cls.monitor, '/varz')
            except Refused:
                return False
        wait_for(ready)
        cls.script = cls.root / 'owner.cjs'
        cls.script.write_text('''
const fs=require('node:fs'),net=require('node:net'),cp=require('node:child_process');
const {connect}=require(process.env.OWNED_NATS_PACKAGE);
process.umask(0o077);
(async()=>{
 const nc=await connect({servers:process.env.OWNED_NATS_URL,token:process.env.OWNED_TOKEN,name:process.env.OWNED_NAME,maxReconnectAttempts:0});
 const listener=net.createServer();await new Promise(r=>listener.listen(0,'127.0.0.1',r));
 let child;
 if(['survivor','child','orphan','exec-child','daemonize','daemonize-exit'].includes(process.env.OWNED_MODE)){
  if(process.env.OWNED_MODE==='orphan') {
   const launcher=cp.spawn(process.execPath,['-e',"require('node:child_process').spawn(process.execPath,[process.env.OWNED_CHILD],{stdio:'ignore',env:process.env}).unref()"],{stdio:'ignore',env:process.env});
   await new Promise(r=>launcher.on('exit',r));
  } else if(['daemonize','daemonize-exit'].includes(process.env.OWNED_MODE)) {
   const launcher=cp.spawn(process.execPath,['-e',"require('node:child_process').spawn(process.execPath,[process.env.OWNED_CHILD],{detached:true,stdio:'ignore',env:process.env}).unref()"],{detached:true,stdio:'ignore',env:process.env});
   await new Promise(r=>launcher.on('exit',r));
  } else if(process.env.OWNED_MODE==='exec-child') {
   child=cp.spawn(process.env.OWNED_PYTHON,[process.env.OWNED_EXEC_CHILD],{stdio:'ignore',env:process.env});child.unref();
  } else {
   child=cp.spawn(process.execPath,[process.env.OWNED_CHILD],{detached:process.env.OWNED_MODE==='survivor',stdio:'ignore',env:process.env});child.unref();
  }
  while(!fs.existsSync(process.env.OWNED_CHILD_READY))await new Promise(r=>setTimeout(r,10));
  if(!child)child={pid:JSON.parse(fs.readFileSync(process.env.OWNED_CHILD_READY)).pid};
  if(process.env.OWNED_MODE==='daemonize-exit')process.exit(0);
 }
 fs.writeFileSync(process.env.OWNED_READY+'.pending',JSON.stringify({pid:process.pid,cid:nc.info.client_id,serverId:nc.info.server_id,port:listener.address().port,child:child?.pid}));fs.renameSync(process.env.OWNED_READY+'.pending',process.env.OWNED_READY);
 console.log('owned fixture ready');
 setInterval(()=>{if(fs.existsSync(process.env.OWNED_FORK)){fs.unlinkSync(process.env.OWNED_FORK);cp.spawn(process.execPath,['-e','setTimeout(()=>process.exit(0),100)'],{stdio:'ignore'});}},10);
 process.on('SIGTERM',async()=>{if(process.env.OWNED_MODE==='hang')return;await nc.close();await new Promise(r=>listener.close(r));console.log('Shutdown complete.');process.exit(process.env.OWNED_MODE==='crash'?2:0);});
})().catch(()=>process.exit(1));
''')
        cls.child = cls.root / 'child.cjs'
        cls.child.write_text('''
const fs=require('node:fs'),net=require('node:net');
process.umask(0o077);
const server=net.createServer();server.listen(0,'127.0.0.1',()=>{fs.writeFileSync(process.env.OWNED_CHILD_READY+'.pending',JSON.stringify({pid:process.pid,port:server.address().port}));fs.renameSync(process.env.OWNED_CHILD_READY+'.pending',process.env.OWNED_CHILD_READY);});
process.on('SIGTERM',()=>{});
setInterval(()=>{if(fs.existsSync(process.env.OWNED_CHILD_STOP))server.close(()=>process.exit(0));},20);
''')
        cls.exec_child = cls.root / 'exec-child.py'
        cls.exec_child.write_text('''
import json,os,pathlib,time
os.umask(0o077)
ready=pathlib.Path(os.environ['OWNED_CHILD_READY'])
pending=ready.with_suffix('.pending')
pending.write_text(json.dumps({'pid':os.getpid()}))
pending.replace(ready)
while not pathlib.Path(os.environ['OWNED_EXEC_TRIGGER']).exists():time.sleep(.02)
os.execv('/bin/sleep',['sleep','30'])
''')

    @classmethod
    def tearDownClass(cls):
        cls.server.terminate()
        cls.server.wait(timeout=10)
        cls.server_log.close()
        print(json.dumps({'ownedEvidence': str(cls.root), 'productionConnections': False,
                          'ownedServerExit': cls.server.returncode}), flush=True)
        (cls.root / 'proofs.json').write_text(json.dumps(cls.proofs, indent=2) + '\n')

    def setUp(self):
        self.hold_override_attempted = False
        suffix = ('hold-probe' if self._testMethodName ==
                  'test_owned_job_disable_precedes_stop_and_enable_precedes_restart'
                  else secrets.token_hex(8))
        self.name = 'ai.openclaw.preservation-owned.' + suffix
        self.directory = self.root / self.name
        self.directory.mkdir(mode=0o700)
        self.ready = self.directory / 'ready.json'
        self.log = self.directory / 'owner.log'
        self.err = self.directory / 'owner.err'
        self.log.touch(mode=0o600)
        self.err.touch(mode=0o600)
        self.plist = self.directory / 'unit.plist'
        self.service = Launchd(self.name, self.plist)
        if suffix == 'hold-probe' and not self.service.status()['loaded'] and self.service.disabled():
            self.service.enable_after_hold()

    def launch(self, mode='good', run_at_load=True, exit_timeout=5, identity_files=None, load_elsewhere=False):
        env = {'HOME': str(self.directory), 'OWNED_NATS_PACKAGE': str(self.package),
               'OWNED_NATS_URL': 'nats://127.0.0.1:' + str(self.port), 'OWNED_TOKEN': self.token,
               'OWNED_NAME': self.name, 'OWNED_MODE': mode, 'OWNED_READY': str(self.ready),
               'OWNED_CHILD': str(self.child), 'OWNED_CHILD_READY': str(self.directory / 'child-ready.json'),
               'OWNED_CHILD_STOP': str(self.directory / 'child-stop'),
               'OWNED_PYTHON': sys.executable, 'OWNED_EXEC_CHILD': str(self.exec_child),
               'OWNED_EXEC_TRIGGER': str(self.directory / 'exec'),
               'OWNED_FORK': str(self.directory / 'fork')}
        self.plist.write_bytes(plistlib.dumps({'Label': self.name, 'ProgramArguments': [self.node, str(self.script)],
            'WorkingDirectory': str(self.directory), 'EnvironmentVariables': env,
            'RunAtLoad': run_at_load, 'KeepAlive': False, 'ExitTimeOut': exit_timeout,
            'StandardOutPath': str(self.log), 'StandardErrorPath': str(self.err)}))
        if load_elsewhere:
            alternate = self.directory / 'alternate.plist'
            alternate.write_bytes(self.plist.read_bytes())
            Launchd(self.name, alternate).bootstrap()
        else:
            self.service.bootstrap()
        if not run_at_load:
            return
        wait_for(self.ready.exists)
        self.details = json.loads(self.ready.read_text())
        binding = self.service.bind([self.node, str(self.script)], self.node, self.directory, identity_files)
        self.assertEqual(binding['status']['pid'], self.details['pid'])
        return binding

    def tearDown(self):
        (self.directory / 'child-stop').touch(mode=0o600)
        try:
            if self.service.status()['loaded']:
                subprocess.run(['/bin/launchctl', 'bootout', self.service.target],
                               capture_output=True, check=True, timeout=10)
        finally:
            try:
                if (self.directory / 'child-ready.json').exists():
                    pid = json.loads((self.directory / 'child-ready.json').read_text())['pid']
                    if (self.directory / 'exec').exists() and process_exists(pid):
                        os.kill(pid, 15)
                    wait_for(lambda: not process_exists(pid))
            finally:
                if (self.hold_override_attempted and not self.service.status()['loaded']
                        and self.service.disabled()):
                    self.service.enable_after_hold()

    def connection_closed(self):
        report = http_json(self.monitor, '/connz?state=closed&limit=10000')
        return any(row['cid'] == self.details['cid'] and row['reason'] == 'Client Closed'
                   for row in report['connections'])

    def listener_absent(self):
        with socket.socket() as connection:
            connection.settimeout(.2)
            return connection.connect_ex(('127.0.0.1', self.details['port'])) != 0

    def test_normal_managed_stop_binds_pid_cid_and_kernel_exit(self):
        binding = self.launch()
        with StopWatch(self.service, binding, [self.log, self.err], 'mesh-task-daemon') as watch:
            watch.apply()
            proof = watch.verify(self.connection_closed, self.listener_absent)
        self.assertTrue(proof['verified'])
        self.assertEqual(proof['exits'][str(self.details['pid'])]['wait_status'], 0)
        self.assertEqual(proof['exit_flags_requested'], 0x84000000)
        self.proofs.append({'test': self._testMethodName, 'proof': proof})

    def test_completion_marker_does_not_hide_nonzero_exit(self):
        binding = self.launch('crash')
        with StopWatch(self.service, binding, [self.log, self.err], 'mesh-task-daemon') as watch:
            watch.apply()
            with self.assertRaisesRegex(Refused, 'termination violates'):
                watch.verify(self.connection_closed, self.listener_absent)
        self.assertIn('Shutdown complete.', self.log.read_text())
        self.proofs.append({'test': self._testMethodName, 'exits': watch.events, 'refused': True})

    def test_completion_marker_does_not_hide_surviving_detached_child(self):
        binding = self.launch('survivor')
        self.assertIn(self.details['child'], binding['tree'])
        with StopWatch(self.service, binding, [self.log, self.err], 'mesh-task-daemon') as watch:
            watch.apply()
            with self.assertRaisesRegex(Refused, 'descendant exit was not observed'):
                watch.verify(self.connection_closed, self.listener_absent, deadline=.5)
        self.assertIn('Shutdown complete.', self.log.read_text())
        self.assertTrue(process_exists(self.details['child']))
        self.proofs.append({'test': self._testMethodName, 'exits': watch.events,
                            'survivingChild': self.details['child'], 'refused': True})

    def test_unloaded_label_does_not_prove_no_process_was_spawned(self):
        binding = self.launch('daemonize')
        child = self.details['child']
        self.assertNotIn(child, binding['tree'])
        subprocess.run(['/bin/launchctl', 'bootout', self.service.target],
                       capture_output=True, check=True, timeout=10)
        wait_for(lambda: not self.service.status()['loaded'])
        self.assertTrue(process_exists(child))
        self.hold_override_attempted = True
        self.service.disable_unloaded_for_hold()
        self.assertTrue(self.service.disabled())
        self.assertFalse(self.service.status()['loaded'])
        user_overrides = subprocess.run(['/bin/launchctl', 'print-disabled',
                                         'user/' + str(os.getuid())], capture_output=True,
                                        text=True, check=True, timeout=10).stdout
        self.assertIn('"' + self.name + '" => disabled', user_overrides)
        self.assertTrue(process_exists(child))
        self.proofs.append({'test': self._testMethodName, 'child': child,
                            'prebind_tree_excluded_child': True,
                            'disabled_unloaded_with_surviving_child': True})

    def test_disabled_daemon_restore_journals_before_enable_and_binds_new_owner(self):
        original = self.launch()
        with StopWatch(self.service, original, [self.log, self.err], 'mesh-task-daemon',
                       require_disabled=True) as watch:
            self.hold_override_attempted = True
            self.service.disable_for_hold()
            watch.apply()
            self.assertTrue(watch.verify(self.connection_closed, self.listener_absent)['verified'])
        self.ready.unlink()
        prior = {'class': 'daemon', 'loaded': True, 'identity': {
            'argv': original['argv'], 'working_directory': original['cwd'],
            'files': {path: item['sha256'] for path, item in original['identity']['files'].items()}}}
        calls = []
        unit = self.name.removeprefix('ai.openclaw.')
        def begin_override_clear(name):
            self.assertEqual(name, unit)
            self.assertTrue(self.service.disabled())
            self.assertFalse(self.service.status()['loaded'])
            calls.append(name)
        def ready(binding):
            return (self.ready.exists()
                    and json.loads(self.ready.read_text())['pid'] == binding['status']['pid'])
        journal = SimpleNamespace(begin_override_clear=begin_override_clear)
        restored = restore_disabled_daemon(self.service, journal, unit, prior, ready)
        self.assertEqual(calls, [unit])
        self.assertNotEqual(restored['status']['pid'], original['status']['pid'])
        self.assertTrue(self.service.status()['running'])
        self.assertFalse(self.service.disabled())
        self.proofs.append({'test': self._testMethodName, 'intent_before_enable': True,
                            'new_owner_bound': True})

    def test_disabled_daemon_restore_keeps_unbound_exit_terminal(self):
        self.launch('daemonize-exit', run_at_load=False)
        subprocess.run(['/bin/launchctl', 'bootout', self.service.target],
                       capture_output=True, check=True, timeout=10)
        wait_for(lambda: not self.service.status()['loaded'])
        plist = plistlib.loads(self.plist.read_bytes())
        plist['RunAtLoad'] = True
        self.plist.write_bytes(plistlib.dumps(plist))
        self.hold_override_attempted = True
        self.service.disable_unloaded_for_hold()
        unit = self.name.removeprefix('ai.openclaw.')
        events = []
        journal = SimpleNamespace(begin_override_clear=lambda name: events.append(name))
        prior = {'class': 'daemon', 'loaded': True, 'identity': {
            'argv': [self.node, str(self.script)], 'working_directory': str(self.directory),
            'files': {}}}
        child_ready = self.directory / 'child-ready.json'
        original_bootstrap = self.service.bootstrap
        original_status = self.service.status
        def bootstrap():
            original_bootstrap()
            def after_spawn(domain='gui'):
                if domain == 'gui':
                    wait_for(lambda: child_ready.exists() and not original_status()['running'])
                return original_status(domain)
            self.service.status = after_spawn
        self.service.bootstrap = bootstrap
        try:
            with self.assertRaisesRegex(Refused, 'restored daemon owner was not bound'):
                restore_disabled_daemon(self.service, journal, unit, prior,
                                        lambda _: False, timeout=.5)
        finally:
            self.service.bootstrap = original_bootstrap
            self.service.status = original_status
        child = json.loads(child_ready.read_text())['pid']
        self.assertTrue(process_exists(child))
        self.assertEqual(events, [unit])
        state = self.service.status()
        self.assertTrue(state['loaded'])
        self.assertFalse(state['running'])
        self.assertEqual(state['runs'], 1)
        self.assertTrue(self.service.disabled())
        self.proofs.append({'test': self._testMethodName,
                            'unbound_owner_refused': True, 'child_alive': child,
                            'unloaded_override_restored': True})

    def test_disabled_daemon_restore_reinstates_override_after_failed_bootstrap(self):
        self.launch(run_at_load=False)
        subprocess.run(['/bin/launchctl', 'bootout', self.service.target],
                       capture_output=True, check=True, timeout=10)
        wait_for(lambda: not self.service.status()['loaded'])
        self.hold_override_attempted = True
        self.service.disable_unloaded_for_hold()
        self.plist.write_bytes(b'not a plist')
        unit = self.name.removeprefix('ai.openclaw.')
        events = []
        prior = {'class': 'daemon', 'loaded': True, 'identity': {
            'argv': [self.node, str(self.script)], 'working_directory': str(self.directory),
            'files': {}}}
        with self.assertRaisesRegex(Refused, 'disabled override restored; owner running=False'):
            restore_disabled_daemon(self.service,
                SimpleNamespace(begin_override_clear=lambda name: events.append(name)),
                unit, prior, lambda _: False)
        self.assertEqual(events, [unit])
        self.assertFalse(self.service.status()['loaded'])
        self.assertTrue(self.service.disabled())

    def test_disabled_daemon_restore_reinstates_override_after_readiness_failure(self):
        original = self.launch()
        with StopWatch(self.service, original, [self.log, self.err], 'mesh-task-daemon',
                       require_disabled=True) as watch:
            self.hold_override_attempted = True
            self.service.disable_for_hold()
            watch.apply()
            self.assertTrue(watch.verify(self.connection_closed, self.listener_absent)['verified'])
        self.ready.unlink()
        prior = {'class': 'daemon', 'loaded': True, 'identity': {
            'argv': original['argv'], 'working_directory': original['cwd'],
            'files': {path: item['sha256'] for path, item in original['identity']['files'].items()}}}
        unit = self.name.removeprefix('ai.openclaw.')
        events = []
        with self.assertRaisesRegex(Refused, 'disabled override restored; owner running=True'):
            restore_disabled_daemon(self.service,
                SimpleNamespace(begin_override_clear=lambda name: events.append(name)),
                unit, prior, lambda _: False, timeout=.5)
        self.assertEqual(events, [unit])
        self.assertTrue(self.service.status()['running'])
        self.assertTrue(self.service.disabled())

    def test_wrong_argv_refuses_before_service_stop(self):
        self.launch()
        with self.assertRaisesRegex(Refused, 'argv does not match'):
            self.service.bind([self.node, '/nonexistent'], self.node, self.directory)
        self.assertTrue(self.service.status()['running'])

    def test_idle_timer_unloads_without_new_log_bytes(self):
        self.launch(run_at_load=False)
        apply, verify = unload_idle_timer(self.service, [self.log, self.err])
        apply()
        with self.assertRaisesRegex(Refused, 'spawn-race evidence is absent'):
            verify()
        self.assertFalse(self.service.status()['loaded'])
        self.assertEqual(self.log.stat().st_size, 0)

    def test_idle_timer_persistent_stop_refuses_direct_restart_until_release(self):
        self.launch(run_at_load=False)
        apply, verify = unload_idle_timer(
            self.service, [self.log, self.err],
            spawn_evidence=lambda: {'label': self.service.label,
                                    'coverage_complete': True, 'spawns': []},
            require_disabled=True)
        apply()
        proof = verify()
        self.assertTrue(proof['disabled_override_verified'])
        self.assertFalse(self.service.status()['loaded'])
        self.assertTrue(self.service.disabled())
        time.sleep(1)
        bootstrap = ['/bin/launchctl', 'bootstrap', 'gui/' + str(os.getuid()), str(self.plist)]
        direct = subprocess.run(bootstrap, capture_output=True, text=True)
        self.assertNotEqual(direct.returncode, 0)
        self.assertFalse(self.service.status()['loaded'])
        self.service.enable_after_hold()
        restarted = subprocess.run(bootstrap, capture_output=True, text=True)
        self.assertEqual(restarted.returncode, 0, restarted.stderr)
        self.assertTrue(self.service.status()['loaded'])
        self.proofs.append({'test': self._testMethodName, 'stop': proof,
                            'direct_bootstrap_refused': direct.returncode,
                            'restored_after_enable': True})

    def test_idle_timer_persistent_stop_refuses_a_lost_override(self):
        self.launch(run_at_load=False)
        apply, verify = unload_idle_timer(
            self.service, [self.log, self.err],
            spawn_evidence=lambda: {'label': self.service.label,
                                    'coverage_complete': True, 'spawns': []},
            require_disabled=True)
        apply()
        self.service.enable_after_hold()
        with self.assertRaisesRegex(Refused, 'lost its disabled override'):
            verify()
        self.assertFalse(self.service.status()['loaded'])

    def test_unloaded_job_can_be_refenced_after_interrupted_enable(self):
        self.launch(run_at_load=False)
        self.hold_override_attempted = True
        self.service.disable_for_hold()
        with self.assertRaisesRegex(Refused, 'loaded while restoring'):
            self.service.disable_unloaded_for_hold()
        subprocess.run(['/bin/launchctl', 'bootout', self.service.target],
                       capture_output=True, check=True, timeout=10)
        self.service.enable_after_hold()
        self.assertFalse(self.service.disabled())
        self.service.disable_unloaded_for_hold()
        self.assertTrue(self.service.disabled())
        self.assertFalse(self.service.status()['loaded'])
        with self.assertRaisesRegex(Refused, 'already disabled'):
            self.service.disable_unloaded_for_hold()
        time.sleep(1)
        direct = subprocess.run(['/bin/launchctl', 'bootstrap', 'gui/' + str(os.getuid()),
                                 str(self.plist)], capture_output=True, text=True)
        self.assertNotEqual(direct.returncode, 0)
        self.assertFalse(self.service.status()['loaded'])
        self.service.enable_after_hold()
        self.service.bootstrap()
        self.assertTrue(self.service.status()['loaded'])
        self.proofs.append({'test': self._testMethodName, 'refenced_unloaded': True,
                            'direct_bootstrap_refused': direct.returncode})

    def test_owned_job_disable_precedes_stop_and_enable_precedes_restart(self):
        binding = self.launch()
        with StopWatch(self.service, binding, [self.log, self.err], 'mesh-task-daemon',
                       require_disabled=True) as watch:
            self.hold_override_attempted = True
            journal_parent = self.directory / 'journals'
            journal_parent.mkdir(mode=0o700)
            with legacy_journal(journal_parent / 'window', inventory({'nats': {}, 'mesh-task-daemon': {}}),
                                boot='owned', node_lock=self.directory / 'node.lock') as journal:
                def held_mutate(unit, action, apply, verify, failure_evidence):
                    return journal.mutate(unit, action, apply, verify, failure_evidence=failure_evidence)
                hold = SimpleNamespace(journal=journal, mutate=held_mutate)
                disable = self.service.disable_for_hold
                def after_intent():
                    self.assertEqual(journal.records[-1]['event'], 'intent')
                    self.assertEqual(journal.records[-1]['action'], 'disable-and-unload')
                    self.assertTrue(self.service.status()['running'])
                    disable()
                    with self.assertRaisesRegex(Refused, 'still loaded'):
                        self.service.enable_after_hold()
                with patch.object(self.service, 'disable_for_hold', side_effect=after_intent):
                    proof = watch.mutate(journal, 'mesh-task-daemon', self.connection_closed,
                                         self.listener_absent, hold=hold)
                self.assertEqual([row['event'] for row in journal.records],
                                 ['baseline', 'intent', 'verified'])
                self.assertEqual(journal.records[-1]['action'], 'disable-and-unload')
        self.assertTrue(proof['verified'])
        self.assertTrue(proof['disabled_override_verified'])
        self.assertTrue(Journal.managed_stop_proven(proof))
        self.assertFalse(self.service.status()['loaded'])
        self.assertTrue(self.service.disabled())
        self.ready.unlink()
        with self.assertRaisesRegex(Refused, 'disabled managed unit'):
            self.service.bootstrap()
        self.assertFalse(self.service.status()['loaded'])
        self.assertFalse(self.ready.exists())
        self.service.enable_after_hold()
        self.assertFalse(self.service.disabled())
        self.service.bootstrap()
        wait_for(lambda: self.ready.exists() and self.service.status()['running'])
        self.proofs.append({'test': self._testMethodName, 'stop': proof,
                            'disabled_after_bootout': True, 'restarted_after_enable': True})

    def test_owned_nats_persistent_stop_has_transfer_termination_shape(self):
        port, monitor = free_port(), free_port()
        config = self.directory / 'nats.conf'
        config.write_text(f'''server_name: owned-stop-{secrets.token_hex(4)}
host: 127.0.0.1
port: {port}
http_port: {monitor}
jetstream {{ store_dir: "{self.directory / 'store'}" }}
''')
        argv = [self.nats, '-c', str(config)]
        self.plist.write_bytes(plistlib.dumps({
            'Label': self.name, 'ProgramArguments': argv,
            'WorkingDirectory': str(self.directory), 'RunAtLoad': True,
            'KeepAlive': False, 'ExitTimeOut': 5,
            'StandardOutPath': str(self.log), 'StandardErrorPath': str(self.err)}))
        self.service.bootstrap()
        def ready():
            try:
                return http_json(monitor, '/varz')
            except Refused:
                return False
        self.assertEqual(wait_for(ready)['version'], '2.12.6')
        binding = self.service.bind(argv, self.nats, self.directory)
        with socket.create_connection(('127.0.0.1', port), timeout=2) as client:
            client.settimeout(2)
            self.assertIn(b'INFO', client.recv(8192))
            client.sendall(b'CONNECT {"verbose":false}\r\nPING\r\n')
            reply = b''
            while b'PONG' not in reply:
                chunk = client.recv(8192)
                self.assertTrue(chunk)
                reply += chunk
            with StopWatch(self.service, binding, [self.log, self.err], 'nats',
                           allowed_signals=(15,), require_disabled=True) as watch:
                self.hold_override_attempted = True
                self.service.disable_for_hold()
                watch.apply()
                def listener_absent():
                    with socket.socket() as connection:
                        connection.settimeout(.2)
                        return connection.connect_ex(('127.0.0.1', port)) != 0
                proof = watch.verify(lambda: client.recv(1) == b'', listener_absent)
        self.assertTrue(Journal.managed_stop_proven(proof))
        self.assertEqual(proof['termination'], {'exit': 0})
        self.assertEqual(proof['exits'][str(proof['owner'])]['wait_status'], 0)
        self.assertTrue(self.service.disabled())
        self.proofs.append({'test': self._testMethodName, 'stop': proof,
                            'isolated_port': port, 'owned_connection_closed': True,
                            'production_connections': False})

    def test_post_disable_stop_failure_is_durable_and_keeps_override(self):
        binding = self.launch()
        journal_parent = self.directory / 'journals'
        journal_parent.mkdir(mode=0o700)
        journal_root = journal_parent / 'window'
        with StopWatch(self.service, binding, [self.log, self.err], 'mesh-task-daemon',
                       require_disabled=True) as watch:
            self.hold_override_attempted = True
            with legacy_journal(journal_root, inventory({'nats': {}, 'mesh-task-daemon': {}}),
                                boot='owned', node_lock=self.directory / 'node.lock') as journal:
                def held_mutate(unit, action, apply, verify, failure_evidence):
                    return journal.mutate(unit, action, apply, verify, failure_evidence=failure_evidence)
                hold = SimpleNamespace(journal=journal, mutate=held_mutate)
                with patch.object(watch, 'apply', side_effect=Refused('owned failure after disable')):
                    with self.assertRaisesRegex(Refused, 'owned failure after disable'):
                        watch.mutate(journal, 'mesh-task-daemon', self.connection_closed,
                                     self.listener_absent, hold=hold)
                self.assertEqual([row['event'] for row in journal.records],
                                 ['baseline', 'intent', 'failed'])
                self.assertEqual(journal.records[-1]['action'], 'disable-and-unload')
                self.assertIsNone(journal.records[-1]['evidence']['bootout'])
                self.assertTrue(journal.records[-1]['evidence']['disabled_override_observed'])
        self.assertTrue(self.service.disabled())
        self.assertTrue(self.service.status()['running'])
        with Journal(journal_root, boot='owned', node_lock=self.directory / 'node.lock') as reopened:
            with self.assertRaisesRegex(Refused, 'reopened'):
                reopened.require_forward()

    def test_post_intent_readiness_failure_does_not_disable(self):
        binding = self.launch()
        journal_parent = self.directory / 'journals'
        journal_parent.mkdir(mode=0o700)
        with StopWatch(self.service, binding, [self.log, self.err], 'mesh-task-daemon',
                       require_disabled=True) as watch:
            with legacy_journal(journal_parent / 'window', inventory({'nats': {}, 'mesh-task-daemon': {}}),
                                boot='owned', node_lock=self.directory / 'node.lock') as journal:
                def held_mutate(unit, action, apply, verify, failure_evidence):
                    return journal.mutate(unit, action, apply, verify, failure_evidence=failure_evidence)
                hold = SimpleNamespace(journal=journal, mutate=held_mutate)
                ready = watch.ready_for_intent
                calls = []
                def change_after_intent():
                    calls.append(len(journal.records))
                    if len(calls) == 2:
                        raise Refused('owned deploy child appeared')
                    ready()
                with patch.object(watch, 'ready_for_intent', side_effect=change_after_intent):
                    with self.assertRaisesRegex(Refused, 'owned deploy child appeared'):
                        watch.mutate(journal, 'mesh-task-daemon', self.connection_closed,
                                     self.listener_absent, hold=hold)
                self.assertEqual(calls, [1, 2])
                self.assertEqual([row['event'] for row in journal.records],
                                 ['baseline', 'intent', 'failed'])
                self.assertFalse(journal.records[-1]['evidence']['disabled_override_observed'])
        self.assertFalse(self.service.disabled())
        self.assertTrue(self.service.status()['running'])

    def test_forced_kill_is_observed_past_loaded_exit_timeout_and_refused(self):
        binding = self.launch('hang', exit_timeout=1)
        with StopWatch(self.service, binding, [self.log, self.err], 'mesh-task-daemon') as watch:
            watch.apply()
            with self.assertRaisesRegex(Refused, 'termination violates'):
                watch.verify(self.connection_closed, self.listener_absent)
        event = watch.events[self.details['pid']]
        self.assertTrue(os.WIFSIGNALED(event['wait_status']))
        self.assertEqual(os.WTERMSIG(event['wait_status']), 9)
        self.assertEqual(binding['status']['exit_timeout'], 1)
        self.proofs.append({'test': self._testMethodName, 'bootout': watch.bootout,
                            'exits': watch.events, 'refused': True})

    def test_orphaned_same_group_helper_is_watched_and_refused_after_owner_exit(self):
        binding = self.launch('orphan')
        helper = self.details['child']
        self.assertIn(helper, binding['tree'])
        self.assertNotEqual(binding['tree'][helper]['parent'], self.details['pid'])
        self.assertEqual(binding['tree'][helper]['group'], binding['tree'][self.details['pid']]['group'])
        with StopWatch(self.service, binding, [self.log, self.err], 'mesh-task-daemon') as watch:
            watch.apply()
            with self.assertRaisesRegex(Refused, 'termination violates|exit was not observed before live owner|descendant exit was not observed'):
                watch.verify(self.connection_closed, self.listener_absent)
        self.assertTrue(helper in watch.events or process_exists(helper))
        self.proofs.append({'test': self._testMethodName, 'exits': watch.events,
                            'contracts': watch.contracts, 'helperSurvives': process_exists(helper), 'refused': True})

    def test_bound_child_normal_exit_while_owner_lives_does_not_abort_stop(self):
        binding = self.launch('child')
        helper = self.details['child']
        with StopWatch(self.service, binding, [self.log, self.err], 'mesh-task-daemon') as watch:
            (self.directory / 'child-stop').touch(mode=0o600)
            wait_for(lambda: (watch.drain(.01), helper in watch.events)[1])
            self.assertTrue(watch.events[helper]['owner_alive_at_observation'])
            wait_for(lambda: not process_exists(helper))
            watch.apply()
            proof = watch.verify(self.connection_closed, self.listener_absent)
        self.assertTrue(proof['verified'])
        self.proofs.append({'test': self._testMethodName, 'proof': proof})

    def test_fork_after_watch_preparation_refuses_before_stop(self):
        binding = self.launch()
        with StopWatch(self.service, binding, [self.log, self.err], 'mesh-task-daemon') as watch:
            (self.directory / 'fork').touch(mode=0o600)
            wait_for(lambda: (watch.drain(.01), bool(watch.lifecycle))[1])
            with self.assertRaisesRegex(Refused, 'fork or exec'):
                watch.apply()
        self.assertTrue(self.service.status()['running'])
        self.proofs.append({'test': self._testMethodName, 'lifecycle': watch.lifecycle, 'refused': True})

    def test_identical_identity_rewrite_after_watch_preparation_refuses_before_stop(self):
        identity = self.directory / 'declared-config.json'
        identity.write_text('{}')
        pins = {str(identity): hashlib.sha256(identity.read_bytes()).hexdigest()}
        binding = self.launch(identity_files=pins)
        with StopWatch(self.service, binding, [self.log, self.err], 'mesh-task-daemon') as watch:
            identity.write_text('{}')
            with self.assertRaisesRegex(Refused, 'identity file mutated after watch preparation'):
                watch.apply()
        self.assertTrue(self.service.status()['running'])

    def test_identical_identity_rewrite_after_start_before_watch_refuses(self):
        identity = self.directory / 'declared-config.json'
        identity.write_text('{}')
        binding = self.launch(identity_files={str(identity): hashlib.sha256(identity.read_bytes()).hexdigest()})
        time.sleep(.01)
        identity.write_text('{}')
        with self.assertRaisesRegex(Refused, 'identity file changed after process startup'):
            StopWatch(self.service, binding, [self.log, self.err], 'mesh-task-daemon')
        self.assertTrue(self.service.status()['running'])

    def test_actual_kernel_registration_error_retains_errno(self):
        binding = self.launch()
        with StopWatch(self.service, binding, [self.log, self.err], 'mesh-task-daemon') as watch:
            returned = watch.queue.control([select.kevent(99999999, filter=select.KQ_FILTER_VNODE,
                flags=select.KQ_EV_ADD | 0x40, fflags=0x7f)], 1, 0)
            with self.assertRaisesRegex(Refused, 'kernel watch error') as caught:
                watch.record_kernel(returned, 'owned-invalid-registration')
            raw = caught.exception.stop_evidence['kernel_events'][-1]
            self.assertEqual(raw['ident'], 99999999)
            self.assertEqual(raw['filter'], select.KQ_FILTER_VNODE)
            self.assertTrue(raw['flags'] & select.KQ_EV_ERROR)
            self.assertGreater(raw['data'], 0)
        self.assertTrue(self.service.status()['running'])

    def test_unexpected_actual_kernel_event_is_retained_on_refusal(self):
        binding = self.launch()
        watch = StopWatch(self.service, binding, [self.log, self.err], 'mesh-task-daemon')
        with self.assertRaisesRegex(Refused, 'unexpected kernel event filter') as caught:
            with watch:
                watch.queue.control([select.kevent(99999999, filter=-10,
                    flags=select.KQ_EV_ADD | select.KQ_EV_CLEAR, fflags=0x01000000)], 0, 0)
                watch.drain()
        raw = caught.exception.stop_evidence['kernel_events'][-1]
        self.assertEqual(raw['ident'], 99999999)
        self.assertEqual(raw['filter'], -10)
        self.assertEqual(raw['phase'], 'drain')
        self.assertTrue(self.service.status()['running'])

    def test_other_filter_with_bound_pid_refuses_and_is_durable(self):
        binding = self.launch()
        watch = StopWatch(self.service, binding, [self.log, self.err], 'mesh-task-daemon')
        journal_parent = self.directory / 'journals'
        journal_parent.mkdir(mode=0o700)
        journal_root = journal_parent / 'window'
        with legacy_journal(journal_root, inventory({'nats': {}, 'mesh-task-daemon': {}}), boot='owned',
                     node_lock=self.directory / 'node.lock') as journal:
            with self.assertRaisesRegex(Refused, 'unexpected kernel event filter'):
                with watch:
                    def apply():
                        watch.queue.control([select.kevent(self.details['pid'], filter=-10,
                            flags=select.KQ_EV_ADD | select.KQ_EV_CLEAR,
                            fflags=0x01000000)], 0, 0)
                        watch.drain()
                    journal.mutate('mesh-task-daemon', 'stop', apply,
                        lambda: self.fail('foreign filter must refuse'),
                        failure_evidence=watch.failure_evidence)
            row = json.loads((journal_root / '000002.json').read_text())
            raw = row['evidence']['kernel_events'][-1]
            self.assertEqual(row['event'], 'failed')
            self.assertEqual(raw['ident'], self.details['pid'])
            self.assertEqual(raw['filter'], -10)
        with Journal(journal_root, boot='owned', node_lock=self.directory / 'node.lock') as reopened:
            self.assertEqual(reopened.records[-1]['evidence']['kernel_events'][-1], raw)
            with self.assertRaisesRegex(Refused, 'reopened'):
                reopened.require_forward()
        self.assertTrue(self.service.status()['running'])
        self.proofs.append({'test': self._testMethodName, 'durableFailure': row, 'refused': True})

    def test_identity_file_replacement_after_preparation_refuses_before_intent(self):
        identity = self.directory / 'declared-config.json'
        identity.write_text('{}')
        binding = self.launch(identity_files={str(identity): hashlib.sha256(identity.read_bytes()).hexdigest()})
        with StopWatch(self.service, binding, [self.log, self.err], 'mesh-task-daemon') as watch:
            identity.rename(self.directory / 'retained-original.json')
            identity.write_text('{}')
            with self.assertRaisesRegex(Refused, 'identity file mutated'):
                watch.ready_for_intent()
        self.assertTrue(self.service.status()['running'])

    def test_loaded_plist_path_cannot_be_inferred_from_identical_arguments(self):
        with self.assertRaisesRegex(Refused, 'loaded plist provenance differs'):
            self.launch(load_elsewhere=True)
        self.assertTrue(self.service.status()['running'])

    def test_identity_permission_change_after_preparation_refuses_before_intent(self):
        identity = self.directory / 'declared-config.json'
        identity.write_text('{}')
        binding = self.launch(identity_files={str(identity): hashlib.sha256(identity.read_bytes()).hexdigest()})
        with StopWatch(self.service, binding, [self.log, self.err], 'mesh-task-daemon') as watch:
            identity.chmod(0o400)
            with self.assertRaisesRegex(Refused, 'identity file mutated'):
                watch.ready_for_intent()
        self.assertTrue(self.service.status()['running'])

    def test_completion_log_must_be_the_loaded_jobs_log(self):
        binding = self.launch()
        fake = self.directory / 'fake-shutdown.log'
        fake.write_text('Shutdown complete.')
        with self.assertRaisesRegex(Refused, 'log paths differ from actual loaded job'):
            StopWatch(self.service, binding, [fake, self.err], 'mesh-task-daemon')
        self.assertTrue(self.service.status()['running'])

    def test_exec_after_watch_preparation_refuses_before_stop(self):
        binding = self.launch('exec-child')
        with StopWatch(self.service, binding, [self.log, self.err], 'mesh-task-daemon') as watch:
            (self.directory / 'exec').touch(mode=0o600)
            wait_for(lambda: (watch.drain(.01), any(item['flags'] & 0x20000000 for item in watch.lifecycle))[1])
            with self.assertRaisesRegex(Refused, 'fork or exec'):
                watch.apply()
        self.assertTrue(self.service.status()['running'])
        self.proofs.append({'test': self._testMethodName, 'lifecycle': watch.lifecycle, 'refused': True})

    def test_declared_environment_mismatch_refuses_without_disclosing_value(self):
        self.launch()
        plist = plistlib.loads(self.plist.read_bytes())
        plist['EnvironmentVariables']['OWNED_TOKEN'] = secrets.token_hex(32)
        self.plist.write_bytes(plistlib.dumps(plist))
        with self.assertRaisesRegex(Refused, 'running environment differs') as error:
            self.service.bind([self.node, str(self.script)], self.node, self.directory)
        self.assertNotIn(self.token, str(error.exception))
        self.assertNotIn(plist['EnvironmentVariables']['OWNED_TOKEN'], str(error.exception))
        self.assertTrue(self.service.status()['running'])

    def test_other_domain_owner_refuses_duplicate_bootstrap(self):
        self.launch(run_at_load=False)
        subprocess.run(['/bin/launchctl', 'bootout', self.service.target], capture_output=True, check=True)
        target = 'user/' + str(os.getuid())
        result = subprocess.run(['/bin/launchctl', 'bootstrap', target, str(self.plist)], capture_output=True)
        elevated = result.returncode != 0
        if elevated:
            result = subprocess.run(['/usr/bin/sudo', '-n', '/bin/launchctl', 'bootstrap', target, str(self.plist)], capture_output=True)
            if result.returncode:
                self.skipTest('user-domain owned job bootstrap is unavailable; duplicate-domain runtime control not proved')
        try:
            self.assertTrue(self.service.status('user')['loaded'])
            with self.assertRaisesRegex(Refused, 'another domain'):
                self.service.bootstrap()
            self.assertFalse(self.service.status()['loaded'])
        finally:
            argv = (['/usr/bin/sudo', '-n'] if elevated else []) + ['/bin/launchctl', 'bootout', target + '/' + self.name]
            subprocess.run(argv, capture_output=True, check=True)

    def test_timer_started_after_preparation_is_not_stopped(self):
        self.launch(run_at_load=False)
        apply, verify = unload_idle_timer(self.service, [self.log, self.err])
        self.service.kickstart()
        wait_for(self.ready.exists)
        with self.assertRaisesRegex(Refused, 'timer started before unload'):
            apply()
        self.assertTrue(self.service.status()['running'])


if __name__ == '__main__':
    unittest.main(verbosity=2)
