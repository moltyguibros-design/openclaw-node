import hashlib
import inspect
import json
import os
import pathlib
import shutil
import signal
import subprocess
import sys
import tempfile
import time
import unittest
from types import SimpleNamespace
from unittest.mock import patch

import cluster_startup_evidence as evidence
import test_preservation_cluster as cluster
from preservation_checks import Refused


STEP = pathlib.Path(__file__).resolve().parent


class CohortTimeout(TimeoutError):
    def __init__(self, cleanup):
        super().__init__('owned cohort timed out')
        self.cleanup = cleanup


def wait_group_absent(group, seconds):
    end = time.monotonic() + seconds
    while True:
        try:
            os.killpg(group, 0)
        except ProcessLookupError:
            return True
        if time.monotonic() >= end:
            return False
        time.sleep(.05)


def run_cohort(command, env, timeout=120, grace=3):
    proc = subprocess.Popen(command, env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                            text=True, start_new_session=True)
    try:
        stdout, stderr = proc.communicate(timeout=timeout)
    except subprocess.TimeoutExpired:
        cleanup = {'group': proc.pid, 'signals': [], 'errors': [], 'groupAbsent': False,
                   'pythonReaped': False, 'pythonExitCode': None}
        for sig in (signal.SIGTERM, signal.SIGKILL):
            try:
                os.killpg(proc.pid, sig)
                cleanup['signals'].append(sig.name)
            except ProcessLookupError:
                pass
            except OSError as error:
                cleanup['errors'].append('signal: ' + type(error).__name__)
            try:
                proc.communicate(timeout=grace)
            except subprocess.TimeoutExpired:
                cleanup['errors'].append(sig.name + ' parent wait expired')
            try:
                cleanup['groupAbsent'] = wait_group_absent(proc.pid, grace)
            except OSError as error:
                cleanup['errors'].append('group observation: ' + type(error).__name__)
            if cleanup['groupAbsent']:
                break
        cleanup['pythonExitCode'] = proc.poll()
        cleanup['pythonReaped'] = cleanup['pythonExitCode'] is not None
        raise CohortTimeout(cleanup) from None
    return subprocess.CompletedProcess(command, proc.returncode, stdout, stderr)


class Owner:
    def __init__(self, pid, calls, stuck=False):
        self.pid, self.calls, self.stuck = pid, calls, stuck
        self.running = True

    def poll(self):
        return None if self.running else 0

    def send_signal(self, value):
        self.calls.append((self.pid, 'term'))

    def wait(self, timeout):
        self.calls.append((self.pid, 'wait', timeout))
        if self.stuck:
            raise subprocess.TimeoutExpired('owned fake', timeout)
        self.running = False
        return 0

    def kill(self):
        self.calls.append((self.pid, 'kill'))


class Portable(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory(prefix='owned-startup-evidence-')
        self.addCleanup(temporary.cleanup)
        self.root = pathlib.Path(temporary.name)
        self.old_umask = os.umask(0o077)
        self.addCleanup(os.umask, self.old_umask)
        self.calls = []

    def recorder(self):
        return evidence.StartupEvidence(self.root, list(range(10000, 10009)), 'owned-token', 'owned-password')

    def owners(self, stuck=None):
        result = []
        for i in range(3):
            p = self.root/f'server-{i}.log'
            p.write_bytes(b'\xff\n[INF] Server Exiting\n')
            handle = p.open('ab')
            self.addCleanup(handle.close)
            result.append((Owner(i, self.calls, i == stuck), handle))
        return result

    def test_window_filters_and_line_bound(self):
        p = self.root/'log'
        p.write_bytes(b'config password must not appear\n[INF] Route connection created\n'
                      b'[DBG] Route connection created\n[INF] Server Exiting\n'
                      b'[DBG] Peer selection: ' + b'x'*2000 + b'\n')
        startup = evidence.log_window(p, 0, startup=True)
        selector = evidence.log_window(p, 0)
        self.assertEqual(startup['lines'], ['[INF] Route connection created'], 'only verified INFO messages belong in startup')
        self.assertEqual(len(selector['lines']), 2, 'only selector and verified INFO belong in create windows')
        self.assertEqual(len(selector['lines'][-1]), 1024, 'selector lines must be bounded')
        self.assertFalse(selector['complete'], 'clipped lines must mark the window incomplete')

    def test_create_info_is_retained_only_at_info_level_inside_the_window(self):
        e = self.recorder()
        messages = list(evidence.STARTUP) + ['JetStream cluster new stream leader for \'$G > HISTORY\'']
        for i in range(3):
            (self.root/f'server-{i}.log').write_text('[INF] ' + messages[-1] + '\n')
        with e.create_window():
            with (self.root/'server-1.log').open('a') as handle:
                for message in messages:
                    handle.write('[DBG] ' + message + '\n[INF] ' + message + '\n')
                handle.write('[INF] Server Exiting\nconfig owned-password\n')
        expected = ['[INF] ' + message for message in messages]
        self.assertEqual([r['lines'] for r in e.data['selector']], [[], expected, []],
                         'create windows must retain only current verified INFO and selector lines')
        self.assertTrue(all(r['complete'] for r in e.data['selector']))

    def test_window_byte_bound(self):
        p = self.root/'log'; p.write_bytes(b'x' * (evidence.WINDOW + 1))
        row = evidence.log_window(p, 0)
        self.assertEqual(row['bytesRead'], 131072, 'the byte window must remain bounded')
        self.assertFalse(row['complete'], 'oversized windows must be incomplete')

    def test_create_offsets_and_primary_survive_capture_failure(self):
        e = self.recorder()
        for i in range(3):
            (self.root/f'server-{i}.log').write_text('Peer selection: before\n')
        primary = RuntimeError('injected primary')
        with self.assertRaises(RuntimeError) as caught:
            with patch.object(evidence, 'log_window', side_effect=OSError('injected capture')):
                with e.create_window():
                    raise primary
        self.assertIs(caught.exception, primary, 'capture must preserve the identical primary')
        self.assertEqual(e.data['createInvocations'], 1, 'create wrapper must count one invocation')
        self.assertEqual(len(e.data['diagnosticErrors']), 3, 'every failed window must remain explicit')

    def test_offsets_exclude_earlier_selector_lines(self):
        e = self.recorder()
        for i in range(3):
            (self.root/f'server-{i}.log').write_text('Peer selection: before\n')
        with e.create_window():
            with (self.root/'server-1.log').open('a') as handle:
                handle.write('Peer selection: inside\n')
        self.assertEqual([r['lines'] for r in e.data['selector']], [[], ['Peer selection: inside'], []],
                         'only the current create window belongs in evidence')

    def test_credentials_suppress_the_entire_report(self):
        e = self.recorder()
        for secret in e.secrets:
            e.data['injected'] = secret
            raw, valid = e.encoded()
            self.assertFalse(valid, 'credential-bearing evidence must be suppressed')
            self.assertNotIn(secret, raw, 'suppression must contain no original credential')
            self.assertTrue(json.loads(raw)['suppressed'])

    def test_report_total_cap(self):
        e = self.recorder(); e.data['injected'] = 'x' * 262144
        raw, valid = e.encoded()
        self.assertFalse(valid, 'oversized reports must be suppressed')
        self.assertEqual(json.loads(raw)['reason'], 'size')

    def test_report_is_private_and_exclusive(self):
        e = self.recorder(); p = self.root/'report.json'
        previous=os.umask(0o022)
        try:
            e.write(p, '{}\n')
        finally:
            os.umask(previous)
        self.assertEqual(p.stat().st_mode & 0o777, 0o600, 'reports must be private')
        with self.assertRaises(FileExistsError, msg='reports must not overwrite an existing object'):
            e.write(p, 'changed')
        self.assertEqual(p.read_text(), '{}\n')

    def test_non_json_client_output_is_diagnostic_only(self):
        e = self.recorder()
        e.client('ready', SimpleNamespace(returncode=1, stdout='', stderr='not json'))
        self.assertTrue(e.data['clients'].get('ready', {}).get('unparsed'), 'non-JSON output must be marked unparsed')
        e.client('create', SimpleNamespace(returncode=0, stdout='[]', stderr=''))
        self.assertTrue(e.data['clients']['create']['unparsed'])

    def test_client_keeps_api_error_and_connected_identity(self):
        e = self.recorder()
        e.client('create', SimpleNamespace(returncode=1, stdout='', stderr=json.dumps({
            'stage':'stream-add', 'connected': {'name':'owned-raft-0','id':'id0'},
            'streamAddAttempts':1, 'api_error':{'code':400,'err_code':10005,'description':'peer offline'},
            'unknown':'discard'})))
        row=e.data['clients']['create']
        self.assertEqual(row['api_error']['err_code'], 10005, 'API error identity must be retained')
        self.assertEqual(row['connected']['id'], 'id0', 'connected identity must be retained')
        self.assertNotIn('unknown', row)

    def test_accepting_samples_are_projected_without_invented_facts(self):
        e=self.recorder()
        js=[{'server_id':str(i),'now':'time'+str(i),'meta_cluster':{'leader':'owned-raft-1'}} for i in range(3)]
        routes=[{'server_id':str(i),'now':'route'+str(i),'routes':[{'remote_id':str(j)} for j in range(3) if j!=i]} for i in range(3)]
        e.accepted(js,routes)
        self.assertEqual([r['now'] for r in e.data['accepted']['members']], ['time0','time1','time2'],
                         'accepting sample times must be retained')
        self.assertIsNone(e.data['accepted']['members'][0]['clusterSize'], 'missing facts must stay unknown')
        self.assertNotIn('varz', json.dumps(e.data['accepted']))

    def test_failed_kill_wait_does_not_skip_other_owners(self):
        owners=self.owners(stuck=1)
        rows=evidence.stop_owners(owners,self.root)
        self.assertEqual({pid for pid, action, *rest in self.calls if action=='term'}, {0,1,2},
                         'every owner must receive a stop attempt')
        self.assertTrue(all(log.closed for proc,log in owners), 'every owner log must close')
        middle=next(row for row in rows if row['pid']==1)
        self.assertIn((1,'kill'),self.calls,'the forced path must invoke kill')
        self.assertTrue(middle['forced'],'the forced path must be explicit')
        self.assertFalse(middle['reaped'], 'failed wait must not claim reaping')
        self.assertIn('kill-wait: TimeoutExpired', middle['error'], 'kill-wait failure must be retained')
        self.assertTrue(all(row['reaped'] for row in rows if row['pid']!=1))

    def test_raising_writer_preserves_primary_after_all_cleanup(self):
        e=self.recorder(); owners=self.owners(); primary=RuntimeError('original failure')
        caught=None
        try:
            try:
                raise primary
            finally:
                with patch.object(e,'write',side_effect=OSError('injected writer')):
                    e.finish(owners,False,sys.exc_info()[1])
        except Exception as error:
            caught=error
        self.assertIs(caught,primary,'writer must preserve the identical primary')
        self.assertEqual(len(e.data['owners']),3,'writer failure must not skip cleanup')
        self.assertTrue(all(row['reaped'] for row in e.data['owners']))

    def test_green_missing_report_refuses_after_cleanup(self):
        e=self.recorder(); owners=self.owners()
        with patch.object(e,'write',side_effect=OSError('injected writer')):
            with self.assertRaisesRegex(AssertionError,'diagnostic report unavailable',
                                        msg='a green run must require retained evidence'):
                e.finish(owners,True,None)
        self.assertTrue(all(log.closed for proc,log in owners),'green refusal must follow cleanup')

    def timeout_case(self, stuck=None):
        eowners=[]
        def start(*args,**kwargs):
            p=Owner(len(eowners),self.calls,len(eowners)==stuck); eowners.append((p,kwargs['stdout']))
            kwargs['stdout'].write(b'[INF] Server Exiting\n'); return p
        clock=iter([0,0,20])
        case=cluster.Cluster()
        with patch.object(cluster.tempfile,'mkdtemp',return_value=str(self.root)), \
             patch.object(cluster.subprocess,'Popen',side_effect=start), \
             patch.object(cluster.subprocess,'run',return_value=SimpleNamespace(stdout='nats-server: v2.12.6\n')), \
             patch.object(cluster,'http_json',side_effect=Refused('not ready')), \
             patch.object(cluster.time,'monotonic',side_effect=lambda:next(clock)), \
             patch.object(cluster.time,'sleep'):
            caught=None
            try:
                case.test_stream_and_consumer_groups_and_real_stream_election()
            except Exception as error:
                caught=error
        return case,caught

    def test_readiness_without_any_sample_keeps_readiness_failure(self):
        case,caught=self.timeout_case()
        self.assertEqual(str(caught),'owned cluster failed readiness','timeout must retain the readiness failure')
        row=case.evidence.data.get('lastReadiness',{})
        self.assertEqual((row.get('jsObserved'),row.get('routesObserved')), (False,False), 'empty startup samples must be explicitly unknown')
        self.assertEqual(len(case.evidence.data['owners']),3)

    def test_fixture_primary_survives_unclean_owner(self):
        case,caught=self.timeout_case(stuck=1)
        self.assertEqual(str(caught),'owned cluster failed readiness','readiness primary must survive cleanup failure')
        self.assertTrue(any(row['error'] for row in case.evidence.data['owners']))

    def create_case(self, *, failed=True, refused_member=None, stuck=None):
        case = cluster.Cluster()
        created = False
        primary_at_sample = []
        owners = []
        later = RuntimeError('after successful create')
        def start(*args, **kwargs):
            owner = Owner(len(owners), self.calls, len(owners) == stuck)
            owners.append((owner, kwargs['stdout']))
            kwargs['stdout'].write(b'[INF] Server Exiting\n')
            return owner
        def run(*args, **kwargs):
            nonlocal created
            if args[0][-1] == '--version':
                return SimpleNamespace(stdout='nats-server: v2.12.6\n')
            action = kwargs['env']['OWNED_ACTION']
            self.calls.append(action)
            created |= action == 'create'
            if action == 'create' and failed:
                return SimpleNamespace(returncode=1, stdout='', stderr=json.dumps({
                    'stage': 'stream-add', 'code': 'TIMEOUT', 'streamAddAttempts': 1}))
            return SimpleNamespace(returncode=0, stderr='', stdout=json.dumps({'leader': 'owned-raft-0'}))
        def read(port, path):
            i = case.evidence.data['ports'].index(port) // 3
            if created:
                if not failed:
                    raise later
                self.calls.append(('post', i))
                primary_at_sample.append(sys.exc_info()[1])
                self.assertEqual(path, '/jsz', 'post-failure observations must be jsz only')
                self.assertIn('createEndedAt', case.evidence.data, 'post-failure reads must follow the create window')
                self.assertEqual(len(case.evidence.data['selector']), 3,
                                 'post-failure reads must follow the create window')
                self.assertFalse(any(isinstance(c, tuple) and len(c) > 1 and c[1] == 'term' for c in self.calls),
                                 'post-failure reads must precede cleanup')
                if i == refused_member:
                    raise Refused('injected monitor refusal')
            if path == '/routez':
                return {'routes': [{'remote_id': str(j)} for j in range(3) if j != i]}
            return {'server_id': str(i), 'now': f'sample-{i}', 'streams': 1 if created else 0,
                    'meta_cluster': {'leader': 'owned-raft-0', 'cluster_size': 3},
                    'not_allowed': 'raw data must be dropped'}
        with patch.object(cluster.tempfile, 'mkdtemp', return_value=str(self.root)), \
             patch.object(cluster.subprocess, 'Popen', side_effect=start), \
             patch.object(cluster.subprocess, 'run', side_effect=run), \
             patch.object(cluster, 'http_json', side_effect=read):
            caught = None
            try:
                case.test_stream_and_consumer_groups_and_real_stream_election()
            except Exception as error:
                caught = error
        return case, caught, primary_at_sample, later

    def test_failed_create_records_three_one_shot_samples_before_cleanup(self):
        case, caught, primary, _ = self.create_case()
        self.assertIsInstance(caught, AssertionError)
        self.assertEqual([c for c in self.calls if isinstance(c, tuple) and c[0] == 'post'],
                         [('post', 0), ('post', 1), ('post', 2)], 'one post-failure request per member is required')
        self.assertTrue(all(p is caught for p in primary), 'post-failure evidence must preserve the identical primary')
        row = case.evidence.data['postFailure']
        self.assertIsInstance(row, dict, 'failed creates must retain post-failure observations')
        self.assertEqual(len(row['members']), 3)
        self.assertTrue(all(m['observed'] for m in row['members']), 'successful post-failure samples must be observed')
        self.assertEqual([m['streams'] for m in row['members']], [1, 1, 1], 'post-failure stream counts must be retained')
        self.assertEqual([m['now'] for m in row['members']], ['sample-0', 'sample-1', 'sample-2'])
        self.assertTrue(all(m['startedAt'] <= m['endedAt'] for m in row['members']))
        self.assertNotIn('not_allowed', json.dumps(row), 'post-failure projection must drop raw fields')
        self.assertTrue(all(o['reaped'] and o['exitCode'] == 0 for o in case.evidence.data['owners']))

    def test_post_failure_refusal_keeps_primary_and_attempts_remaining_members(self):
        case, caught, primary, _ = self.create_case(refused_member=1, stuck=1)
        self.assertIsInstance(caught, AssertionError)
        self.assertTrue(all(p is caught for p in primary), 'post-failure evidence must preserve the identical primary')
        rows = case.evidence.data['postFailure']['members']
        self.assertEqual([r['observed'] for r in rows], [True, False, True],
                         'a refused member must stay unknown without skipping later members')
        self.assertEqual(rows[1]['error'], 'Refused')
        self.assertEqual(len(case.evidence.data['owners']), 3)
        self.assertTrue(any(not o['reaped'] for o in case.evidence.data['owners']))
        self.assertTrue(all(o['reaped'] for o in case.evidence.data['owners'] if o['pid'] != 1))
        self.assertTrue(case.evidence.data['diagnosticErrors'])

    def test_successful_create_does_not_observe_post_failure(self):
        case, caught, _, later = self.create_case(failed=False)
        self.assertIs(caught, later)
        self.assertIsNone(case.evidence.data['postFailure'], 'successful creates must not add monitor requests')
        self.assertFalse(any(isinstance(c, tuple) and c[0] == 'post' for c in self.calls))
        self.assertTrue(all(o['reaped'] for o in case.evidence.data['owners']))

    def test_timeout_driver_owns_session_and_escalates_group(self):
        from unittest.mock import Mock
        proc=SimpleNamespace(pid=12345,returncode=-9,poll=lambda:-9,
            communicate=Mock(side_effect=[subprocess.TimeoutExpired('fake',1),
                                         subprocess.TimeoutExpired('fake',1),('','')]))
        with patch.object(subprocess,'Popen',return_value=proc) as start, \
             patch.object(os,'killpg') as send, \
             patch(__name__+'.wait_group_absent',side_effect=[False,True]):
            with self.assertRaises(CohortTimeout) as caught:
                run_cohort(['owned fake'],{},timeout=1,grace=1)
        self.assertTrue(start.call_args.kwargs.get('start_new_session'),'cohorts must own a new session')
        self.assertEqual(send.call_args_list, [unittest.mock.call(12345,signal.SIGTERM),
                                            unittest.mock.call(12345,signal.SIGKILL)],
                         'timeout must TERM then KILL the owned group')
        self.assertTrue(caught.exception.cleanup['groupAbsent'],'timeout must record group absence')
        self.assertTrue(caught.exception.cleanup['pythonReaped'])

    def test_real_timeout_removes_owned_parent_and_child(self):
        pidfile=self.root/'child.pid'
        source="""import os,signal,subprocess,sys,time
child=subprocess.Popen([sys.executable,'-c','import time;time.sleep(60)'])
def stop(sig,frame):
 child.wait(timeout=2)
 raise SystemExit(0)
signal.signal(signal.SIGTERM,stop)
open(sys.argv[1],'w').write(str(child.pid))
time.sleep(60)
"""
        launched=[]; original=subprocess.Popen
        def start(*args,**kwargs):
            proc=original(*args,**kwargs); launched.append(proc); return proc
        try:
            with patch.object(subprocess,'Popen',side_effect=start):
                with self.assertRaises(CohortTimeout) as caught:
                    run_cohort([sys.executable,'-c',source,str(pidfile)],os.environ.copy(),timeout=2,grace=2)
            self.assertTrue(pidfile.exists(),'the owned timeout must include a real child')
            self.assertTrue(caught.exception.cleanup['groupAbsent'],'the timed-out owned group must disappear')
            self.assertTrue(caught.exception.cleanup['pythonReaped'])
            self.assertFalse(caught.exception.cleanup['errors'])
            print('owned-timeout-cleanup: '+json.dumps(caught.exception.cleanup))
        finally:
            for proc in launched:
                if proc.poll() is None:
                    os.killpg(proc.pid,signal.SIGTERM)
                    proc.wait(timeout=3)

    def test_term_ignoring_group_requires_real_absence(self):
        marker=self.root/'ignoring-child.ready'
        child="import signal,sys,time;signal.signal(signal.SIGTERM,signal.SIG_IGN);open(sys.argv[1],'w').write('ready');time.sleep(60)"
        source="""import pathlib,signal,subprocess,sys,time
signal.signal(signal.SIGTERM,signal.SIG_IGN)
child=subprocess.Popen([sys.executable,'-c',sys.argv[1],sys.argv[2]])
while not pathlib.Path(sys.argv[2]).exists(): time.sleep(.01)
time.sleep(60)
"""
        launched=[]; original=subprocess.Popen
        def start(*args,**kwargs):
            proc=original(*args,**kwargs); launched.append(proc); return proc
        try:
            with patch.object(subprocess,'Popen',side_effect=start):
                with self.assertRaises(CohortTimeout) as caught:
                    run_cohort([sys.executable,'-c',source,child,str(marker)],os.environ.copy(),timeout=2,grace=3)
            self.assertTrue(marker.exists(),'the child must install TERM refusal before timeout')
            self.assertEqual(caught.exception.cleanup['signals'],['SIGTERM','SIGKILL'],
                             'a TERM-ignoring live group must require KILL')
            self.assertTrue(caught.exception.cleanup['groupAbsent'],'forced group absence must be observed')
            self.assertTrue(caught.exception.cleanup['pythonReaped'])
            self.assertEqual(caught.exception.cleanup['pythonExitCode'],-signal.SIGKILL)
            print('owned-forced-timeout-cleanup: '+json.dumps(caught.exception.cleanup))
        finally:
            primary=sys.exc_info()[1]
            for proc in launched:
                try:
                    os.killpg(proc.pid,signal.SIGKILL)
                except ProcessLookupError:
                    pass
                proc.wait(timeout=3)
                end=time.monotonic()+5
                while time.monotonic()<end:
                    try:
                        os.killpg(proc.pid,0)
                    except ProcessLookupError:
                        break
                    time.sleep(.05)
                else:
                    if primary is None:
                        self.fail('owned forced-timeout test group did not disappear')
                    print('owned forced-timeout test cleanup: group absence unobserved')

    def test_inline_gate_contract_is_fixed(self):
        source=inspect.getsource(cluster.Cluster.test_stream_and_consumer_groups_and_real_stream_election)
        gate="""if all(report.get('meta_cluster', {}).get('leader', '').startswith('owned-raft-')
                           for report in js) and all(len({route['remote_id'] for route in report['routes']}) == 2
                                                    for report in routes) and client('ready', startup=True):"""
        self.assertIn(gate,source,'the original inline predicate must stay fixed')
        startup=source[source.index('js = routes = None'):source.index('evidence.accepted(js, routes)')]
        for literal in ('time.monotonic() + 15','time.sleep(.05)'):
            self.assertIn(literal,startup,'the existing readiness and stream budgets must stay fixed')
        for literal in ("error.get('code') == '503'",'Date.now()+5000'):
            self.assertIn(literal,source,'the existing readiness and stream budgets must stay fixed')
        self.assertEqual(source.count('await jm.streams.add('),1,'one stream create must stay fixed')
        self.assertEqual(source.count("client('create')"),1,'one Python create invocation must stay fixed')
        self.assertIn("""            evidence.accepted(js, routes)
            try:
                with evidence.create_window():
                    creation = client('create')
""",source,'the accepted-to-create boundary must stay fixed')
        self.assertIn("""            except Exception:
                evidence.post_failure(lambda i: http_json(ports[i*3+1], '/jsz'))
                raise
""",source,'post-failure requests must remain wrapped and one-shot')
        self.assertIn("""                if isinstance(error, dict) and error.get('stage') == 'account-info' and error.get('code') == '503':
                    evidence.data['startup503Count'] = evidence.data.get('startup503Count', 0) + 1
                    evidence.observe('startupApiRefusal', lambda: evidence.data['clients'].get(action, {'unparsed': True}))
                    return False
""",source,'the complete 503 retry branch must stay fixed')
        self.assertIn('debug: true\nlisten: 127.0.0.1:{ports[i*3]}',source,'the owned config must enable debug')
        self.assertIn("""            primary = sys.exc_info()[1]
            try:
                evidence.finish(owners, succeeded, primary)
            except Exception:
                if primary is None:
                    raise
                print('preservation-cluster-startup: evidence unavailable; primary preserved')
""",source,'the fixture finally wrapper must preserve primary and green failures')
        boundary=source[source.index('js = routes = None'):source.index("creation = client('create')")+len("creation = client('create')")]
        self.assertEqual(hashlib.sha256(boundary.encode()).hexdigest(), '02352af3a10474f7ec7e076998379829fb0b63cd78095f029a20a562365fa729',
                         'the continuous startup-to-create boundary must stay fixed')
        branch=source[source.index('if result.returncode and startup:'):source.index('self.assertEqual(result.returncode')]
        self.assertEqual(hashlib.sha256(branch.encode()).hexdigest(), '41ff2211867734d5f7967739dc38e7644d03fad62c8d568b01ce0e709a9f3554',
                         'the complete startup parsing and 503 policy must stay fixed')


class OwnedPair(unittest.TestCase):
    def test_fresh_normal_and_scratch_denied_cohorts(self):
        base=pathlib.Path(tempfile.mkdtemp(prefix='owned-startup-pair-'))
        reports={}
        try:
            for name in ('normal','stats-denied'):
                folder=base/name; folder.mkdir()
                source=(STEP/'test_preservation_cluster.py').read_text()
                if name=='stats-denied':
                    anchor=' no_advertise: true\n'
                    self.assertEqual(source.count(anchor),1)
                    source=source.replace(anchor,' permissions {{ import {{ allow: [">"], deny: ["$SYS.SERVER.*.STATSZ"] }}, export {{ allow: [">"], deny: ["$SYS.SERVER.*.STATSZ"] }} }}\n'+anchor)
                script=folder/'fixture.py';script.write_text(source)
                output=folder/'report.json'
                try:
                    result=run_cohort([sys.executable,str(script)],env={**os.environ,'PYTHONPATH':str(STEP),
                        'RECOVERY_EVIDENCE_DIR':str(folder),'PRESERVATION_CLUSTER_REPORT':str(output)})
                except CohortTimeout as error:
                    reports[name]={'timedOut':True,'cleanup':error.cleanup}
                    raise
                reports[name]=json.loads(output.read_text())
                row=reports[name]
                self.assertEqual(row['createInvocations'],1,'each fresh cohort must invoke one create')
                self.assertEqual(row['clients']['create']['streamAddAttempts'],1)
                self.assertEqual(row['version'],'nats-server: v2.12.6')
                self.assertTrue(row['debug'])
                self.assertEqual(len(row['accepted']['members']),3)
                self.assertTrue(all(owner['reaped'] and owner['exitCode']==0 and owner['shutdownMarker'] and not owner['error'] for owner in row['owners']),
                                'each fresh cohort must shut down normally')
                self.assertFalse(row['diagnosticErrors'])
                self.assertEqual(row['clients']['create']['connected']['name'],'owned-raft-0')
                if name=='normal':
                    self.assertEqual(result.returncode,0,result.stderr)
                    self.assertTrue(row['passed'])
                    self.assertIsNone(row['postFailure'])
                    self.assertTrue(any('JetStream cluster new stream leader for ' in line
                                        for window in row['selector'] for line in window['lines']))
                else:
                    self.assertEqual(result.returncode,1)
                    self.assertEqual(row['clients']['create']['stage'],'stream-add')
                    self.assertEqual(row['clients']['create']['api_error']['err_code'],10005)
                    self.assertEqual(len(row['postFailure']['members']),3)
                    self.assertTrue(all(member['observed'] for member in row['postFailure']['members']))
                    leader=row['accepted']['members'][0]['leader']
                    lines=next(window['lines'] for window in row['selector'] if window['name']==leader)
                    self.assertTrue(any('reason: offline' in line for line in lines))
                    self.assertTrue(any('required 3 nodes but found' in line and 'offline:true' in line for line in lines))
                    self.assertTrue(all(window['complete'] for window in row['selector']))
            print('owned-startup-pair: '+json.dumps({'normal':'created','stats-denied':'400/10005','creates':[1,1],'cleanup':'six exit0 owners'}))
        finally:
            output=os.environ.get('CLUSTER_STARTUP_PAIR_REPORT')
            if output:
                primary=sys.exc_info()[1]
                try:
                    with pathlib.Path(output).open('x') as handle:
                        os.chmod(output,0o600)
                        handle.write(json.dumps({'schema':'owned-preservation-cluster-controls-v1','reports':reports},indent=2)+'\n')
                except Exception:
                    if primary is None:
                        raise
                    print('owned-startup-pair: report unavailable; primary preserved')
            if len(reports)==2 and all(len(row.get('owners',[]))==3 and all(owner['reaped'] and owner['exitCode']==0 for owner in row['owners']) for row in reports.values()):
                shutil.rmtree(base)


if __name__=='__main__':
    unittest.main()
