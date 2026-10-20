import inspect
import json
import os
import pathlib
import shutil
import subprocess
import sys
import tempfile
import unittest
from types import SimpleNamespace
from unittest.mock import patch

import cluster_startup_evidence as evidence
import test_preservation_cluster as cluster
from preservation_checks import Refused


STEP = pathlib.Path(__file__).resolve().parent


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
        self.assertEqual(len(selector['lines']), 1, 'only selector messages belong in create windows')
        self.assertEqual(len(selector['lines'][0]), 1024, 'selector lines must be bounded')
        self.assertFalse(selector['complete'], 'clipped lines must mark the window incomplete')

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
        e.write(p, '{}\n')
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

    def test_readiness_without_any_sample_keeps_readiness_failure(self):
        eowners=[]
        def start(*args,**kwargs):
            p=Owner(len(eowners),self.calls); eowners.append((p,kwargs['stdout']))
            kwargs['stdout'].write(b'[INF] Server Exiting\n'); return p
        clock=iter([0,0,20])
        case=cluster.Cluster()
        with patch.object(cluster.tempfile,'mkdtemp',return_value=str(self.root)), \
             patch.object(cluster.subprocess,'Popen',side_effect=start), \
             patch.object(cluster.subprocess,'run',return_value=SimpleNamespace(stdout='nats-server: v2.12.6\n')), \
             patch.object(cluster,'http_json',side_effect=Refused('not ready')), \
             patch.object(cluster.time,'monotonic',side_effect=lambda:next(clock)), \
             patch.object(cluster.time,'sleep'):
            with self.assertRaisesRegex(AssertionError,'owned cluster failed readiness',
                                        msg='timeout must retain the readiness failure'):
                case.test_stream_and_consumer_groups_and_real_stream_election()
        self.assertEqual(case.evidence.data.get('lastReadiness'), {'jsObserved':False,'routesObserved':False}, 'empty startup samples must be explicitly unknown')
        self.assertEqual(len(case.evidence.data['owners']),3)

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
                result=subprocess.run([sys.executable,str(script)],env={**os.environ,'PYTHONPATH':str(STEP),
                    'RECOVERY_EVIDENCE_DIR':str(folder),'PRESERVATION_CLUSTER_REPORT':str(output)},
                    capture_output=True,text=True,timeout=120)
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
                else:
                    self.assertEqual(result.returncode,1)
                    self.assertEqual(row['clients']['create']['stage'],'stream-add')
                    self.assertEqual(row['clients']['create']['api_error']['err_code'],10005)
                    leader=row['accepted']['members'][0]['leader']
                    lines=next(window['lines'] for window in row['selector'] if window['name']==leader)
                    self.assertTrue(any('reason: offline' in line for line in lines))
                    self.assertTrue(any('required 3 nodes but found' in line and 'offline:true' in line for line in lines))
                    self.assertTrue(all(window['complete'] for window in row['selector']))
            print('owned-startup-pair: '+json.dumps({'normal':'created','stats-denied':'400/10005','creates':[1,1],'cleanup':'six exit0 owners'}))
        finally:
            output=os.environ.get('CLUSTER_STARTUP_PAIR_REPORT')
            if output:
                with pathlib.Path(output).open('x') as handle:
                    os.chmod(output,0o600)
                    handle.write(json.dumps({'schema':'owned-preservation-cluster-controls-v1','reports':reports},indent=2)+'\n')
            if len(reports)==2 and all(len(row.get('owners',[]))==3 and all(owner['reaped'] and owner['exitCode']==0 for owner in row['owners']) for row in reports.values()):
                shutil.rmtree(base)


if __name__=='__main__':
    unittest.main()
