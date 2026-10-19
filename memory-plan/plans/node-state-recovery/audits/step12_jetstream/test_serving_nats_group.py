import copy
import json
import os
import pathlib
import secrets
import shutil
import socket
import subprocess
import tempfile
import time
import unittest
import urllib.request

from preservation_checks import Refused, http_json
from serving_nats_group import nats_node_id, wait_for_serving_group


NAMES = {'nats': 'owned-standalone', 'nats-1': 'owned-member-1',
         'nats-2': 'owned-member-2', 'nats-3': 'owned-member-3'}
PORTS = {'nats': 8001, 'nats-2': 8002, 'nats-3': 8003}
OWNED_GROUP_TIMEOUT = 30


def observe_owned_group(names, ports, cluster, phases, phase, *, timeout=OWNED_GROUP_TIMEOUT,
                        get=http_json, clock=time.monotonic, sleep=time.sleep):
    started = clock()
    row = {'phase': phase, 'budget': timeout, 'last': {}}
    units = {port: unit for unit, port in ports.items()}

    def observed(port, path):
        key = units[port] + path
        try:
            value = get(port, path)
        except Exception as error:
            row['last'][key] = {'error': repr(error)[:500]}
            raise
        row['last'][key] = value
        return value

    try:
        result = wait_for_serving_group(names, ports, cluster, timeout,
                                        get=observed, clock=clock, sleep=sleep)
        row['result'] = result
        return result
    except BaseException as error:
        row['failure'] = repr(error)[:500]
        raise
    finally:
        row['elapsed'] = clock() - started
        phases.append(row)


def scripted_responses():
    r1, r2, r3 = (nats_node_id(NAMES[unit]) for unit in ('nats-1', 'nats-2', 'nats-3'))
    varz = lambda name, server_id, cluster=None: {
        'server_name': name, 'server_id': server_id, 'version': '2.12.6',
        'start': '2026-10-18T00:00:00Z', 'cluster': {'name': cluster} if cluster else {}}
    group = lambda own, state, peers: {
        'id': own, 'state': state, 'size': 3, 'quorum_needed': 2,
        'leader': r3, 'term': 4, 'peers': peers}
    return {
        (8001, '/varz'): varz(NAMES['nats'], 'S0'),
        (8001, '/routez'): {'num_routes': 0, 'routes': []},
        (8001, '/jsz'): {},
        (8002, '/varz'): varz(NAMES['nats-2'], 'S2', 'owned-group'),
        (8003, '/varz'): varz(NAMES['nats-3'], 'S3', 'owned-group'),
        (8002, '/routez'): {'routes': [{'remote_name': NAMES['nats-3'], 'remote_id': 'S3'}]},
        (8003, '/routez'): {'routes': [{'remote_name': NAMES['nats-2'], 'remote_id': 'S2'}]},
        (8002, '/healthz?js-meta-only=true'): {'status': 'ok'},
        (8003, '/healthz?js-meta-only=true'): {'status': 'ok'},
        (8002, '/jsz'): {'meta_cluster': {
            'name': 'owned-group', 'leader': NAMES['nats-3'], 'cluster_size': 3}},
        (8003, '/jsz'): {'meta_cluster': {
            'name': 'owned-group', 'leader': NAMES['nats-3'], 'peer': r3,
            'cluster_size': 3, 'replicas': [
                {'name': NAMES['nats-1'], 'peer': r1, 'offline': True, 'current': True},
                {'name': NAMES['nats-2'], 'peer': r2, 'current': True}]}},
        (8002, '/raftz'): {'$SYS': {'_meta_': group(r2, 'FOLLOWER', {
            r1: {'name': NAMES['nats-1'], 'known': True},
            r3: {'name': NAMES['nats-3'], 'known': True}})}},
        (8003, '/raftz'): {'$SYS': {'_meta_': group(r3, 'LEADER', {
            r1: {'name': NAMES['nats-1'], 'known': True},
            r2: {'name': NAMES['nats-2'], 'known': True}})}},
    }


class ScriptedGroup(unittest.TestCase):
    def run_observer(self, responses):
        now = [0.0]
        def get(port, path):
            return copy.deepcopy(responses[(port, path)])
        def sleep(seconds):
            now[0] += seconds
        return wait_for_serving_group(NAMES, PORTS, 'owned-group', 2,
                                      get=get, clock=lambda: now[0], sleep=sleep)

    def test_role_faithful_group_settles(self):
        evidence = self.run_observer(scripted_responses())
        self.assertEqual((evidence['verified'], evidence['size'], evidence['quorum_needed']),
                         (True, 3, 2))
        self.assertEqual(evidence['leader'], NAMES['nats-3'])

    def test_offline_peer_name_can_be_absent_when_hash_matches(self):
        responses = scripted_responses()
        held_id = nats_node_id(NAMES['nats-1'])
        responses[(8003, '/jsz')]['meta_cluster']['replicas'][0]['name'] = (
            'Server name unknown at this time (peerID: ' + held_id + ')')
        for port in (8002, 8003):
            responses[(port, '/raftz')]['$SYS']['_meta_']['peers'][held_id] = {
                'name': '', 'known': False}
        self.assertTrue(self.run_observer(responses)['verified'])

    def test_missing_stale_or_partial_group_refuses(self):
        cases = {
            'standalone joined cluster': lambda r: r[(8001, '/varz')].update(cluster={'name': 'owned-group'}),
            'standalone route': lambda r: r[(8001, '/routez')].update(num_routes=1),
            'foreign route': lambda r: r[(8002, '/routez')]['routes'].append(
                {'remote_name': NAMES['nats-1'], 'remote_id': 'S1'}),
            'meta unhealthy': lambda r: r[(8002, '/healthz?js-meta-only=true')].update(status='unavailable'),
            'stale leader': lambda r: r[(8002, '/jsz')]['meta_cluster'].update(leader=NAMES['nats-1']),
            'short meta group': lambda r: r[(8002, '/raftz')]['$SYS']['_meta_'].update(size=2),
            'minority': lambda r: r[(8003, '/routez')].update(routes=[]),
            'held member online': lambda r: r[(8003, '/jsz')]['meta_cluster']['replicas'][0].update(offline=False),
            'follower lagging': lambda r: r[(8003, '/jsz')]['meta_cluster']['replicas'][1].update(current=False),
            'catching up': lambda r: r[(8002, '/raftz')]['$SYS']['_meta_'].update(catching_up=True),
            'split term': lambda r: r[(8002, '/raftz')]['$SYS']['_meta_'].update(term=3),
            'foreign peer': lambda r: r[(8003, '/raftz')]['$SYS']['_meta_']['peers'][
                nats_node_id(NAMES['nats-1'])].update(name='foreign'),
            'foreign replica': lambda r: r[(8003, '/jsz')]['meta_cluster']['replicas'][0].update(
                peer='foreign'),
            'foreign held display': lambda r: r[(8003, '/jsz')]['meta_cluster']['replicas'][0].update(
                name='foreign'),
            'foreign follower display': lambda r: r[(8003, '/jsz')]['meta_cluster']['replicas'][1].update(
                name='foreign'),
            'wrong peer ID': lambda r: r[(8003, '/raftz')]['$SYS']['_meta_']['peers'].update({
                'foreign': r[(8003, '/raftz')]['$SYS']['_meta_']['peers'].pop(
                    nats_node_id(NAMES['nats-1']))}),
        }
        for name, mutate in cases.items():
            with self.subTest(name=name):
                responses = scripted_responses()
                mutate(responses)
                with self.assertRaisesRegex(Refused, 'did not settle'):
                    self.run_observer(responses)

    def test_stale_sample_resets_the_stability_window(self):
        responses = scripted_responses()
        now = [0.0]
        def get(port, path):
            value = copy.deepcopy(responses[(port, path)])
            if (port, path) == (8002, '/jsz') and .8 <= now[0] < .9:
                value['meta_cluster']['leader'] = NAMES['nats-1']
            return value
        def sleep(seconds):
            now[0] += seconds
        with self.assertRaisesRegex(Refused, 'did not settle'):
            wait_for_serving_group(NAMES, PORTS, 'owned-group', 1.6,
                                   get=get, clock=lambda: now[0], sleep=sleep)

    def test_owned_positive_budget_includes_a_late_election_and_stability(self):
        def run(timeout=None):
            now, phases = [0.0], []
            responses = scripted_responses()
            def get(port, path):
                value = copy.deepcopy(responses[(port, path)])
                if path == '/jsz' and port in (8002, 8003) and now[0] < 9.2:
                    value['meta_cluster']['leader'] = NAMES['nats-1']
                return value
            def sleep(seconds):
                now[0] += seconds
            kwargs = {} if timeout is None else {'timeout': timeout}
            result = observe_owned_group(NAMES, PORTS, 'owned-group', phases, 'cold restore',
                                          get=get, clock=lambda: now[0], sleep=sleep, **kwargs)
            return result, phases, now[0]

        with self.assertRaisesRegex(Refused, 'did not settle'):
            run(10)
        try:
            result, phases, elapsed = run()
        except Refused as error:
            self.fail('owned positive budget excludes late stable quorum: ' + str(error))
        self.assertTrue(result['verified'])
        self.assertGreater(elapsed, 10)
        self.assertLess(elapsed, OWNED_GROUP_TIMEOUT)
        self.assertEqual(phases[0]['result'], result)

    def test_owned_failure_retains_observations_and_propagates_refusal(self):
        now, phases = [0.0], []
        responses = scripted_responses()
        responses[(8002, '/jsz')]['meta_cluster']['leader'] = NAMES['nats-1']
        def sleep(seconds):
            now[0] += seconds
        with self.assertRaisesRegex(Refused, 'meta leader or group size differs'):
            observe_owned_group(NAMES, PORTS, 'owned-group', phases, 'cold restore',
                                get=lambda port, path: copy.deepcopy(responses[(port, path)]),
                                clock=lambda: now[0], sleep=sleep)
        self.assertEqual(len(phases), 1)
        self.assertEqual((phases[0]['phase'], phases[0]['budget']),
                         ('cold restore', OWNED_GROUP_TIMEOUT))
        self.assertIn('meta leader or group size differs', phases[0]['failure'])
        self.assertIn('nats-2/jsz', phases[0]['last'])
        self.assertEqual(phases[0]['last']['nats-2/jsz'], responses[(8002, '/jsz')])
        self.assertNotIn('result', phases[0])
        self.assertGreaterEqual(phases[0]['elapsed'], OWNED_GROUP_TIMEOUT)
        self.assertLess(phases[0]['elapsed'], OWNED_GROUP_TIMEOUT + .1)


class RealGroup(unittest.TestCase):
    def test_disposable_two_of_three_then_minority(self):
        binary = os.environ.get('NATS_SERVER') or shutil.which('nats-server')
        if binary is None:
            self.skipTest('NATS server binary is unavailable')
        root = pathlib.Path(tempfile.mkdtemp(prefix='openclaw-owned-serving-group-'))
        self.addCleanup(shutil.rmtree, root)
        nonce = secrets.token_hex(4)
        names = {unit: name + '-' + nonce for unit, name in NAMES.items()}
        ports = {}
        used = set()
        for unit in ('nats', 'nats-1', 'nats-2', 'nats-3'):
            values = []
            while len(values) < (2 if unit == 'nats' else 3):
                with socket.socket() as sock:
                    sock.bind(('127.0.0.1', 0))
                    value = sock.getsockname()[1]
                if value not in used:
                    used.add(value)
                    values.append(value)
            ports[unit] = values
        cluster = 'owned-group-' + nonce
        processes = {}
        logs = []
        phases = []
        failure = None
        def stop(unit):
            process = processes[unit]
            if process.poll() is None:
                process.terminate()
                try:
                    process.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait(timeout=5)
        def get(unit, path):
            with urllib.request.urlopen(f'http://127.0.0.1:{ports[unit][1]}{path}', timeout=1) as response:
                return json.load(response)
        try:
            for unit in ('nats', 'nats-1', 'nats-2', 'nats-3'):
                folder = root / unit
                folder.mkdir()
                client, monitor, *route = ports[unit]
                config = folder / 'nats.conf'
                config.write_text(f'server_name: {names[unit]}\nhost: 127.0.0.1\nport: {client}\n'
                                  f'http_port: {monitor}\njetstream {{ store_dir: "{folder / "store"}" }}\n')
                if route:
                    others = [other for other in ('nats-1', 'nats-2', 'nats-3') if other != unit]
                    routes = ', '.join(f'"nats-route://127.0.0.1:{ports[other][2]}"' for other in others)
                    with config.open('a') as handle:
                        handle.write(f'cluster {{ name: {cluster}; listen: 127.0.0.1:{route[0]}; '
                                     f'routes: [{routes}] }}\n')
                log = (folder / 'server.log').open('wb')
                logs.append(log)
                processes[unit] = subprocess.Popen([binary, '-c', str(config)], stdout=log, stderr=log)
            deadline = time.monotonic() + 15
            while time.monotonic() < deadline:
                try:
                    if all(process.poll() is None for process in processes.values()) \
                            and all(get(unit, '/healthz?js-meta-only=true')['status'] == 'ok'
                                    for unit in ('nats-1', 'nats-2', 'nats-3')) \
                            and get('nats-2', '/jsz')['meta_cluster']['cluster_size'] == 3:
                        break
                except (OSError, KeyError, ValueError):
                    pass
                time.sleep(.05)
            else:
                self.fail('owned three-member meta group did not form')
            stop('nats-1')
            for unit in ('nats-2', 'nats-3'):
                stop(unit)
            for unit in ('nats-2', 'nats-3'):
                folder = root / unit
                log = (folder / 'restored.log').open('wb')
                logs.append(log)
                processes[unit] = subprocess.Popen(
                    [binary, '-c', str(folder / 'nats.conf')], stdout=log, stderr=log)
            monitor_ports = {unit: ports[unit][1] for unit in ('nats', 'nats-2', 'nats-3')}
            evidence = observe_owned_group(names, monitor_ports, cluster, phases, 'cold restore')
            self.assertEqual((evidence['verified'], evidence['size'], evidence['quorum_needed']),
                             (True, 3, 2))
            stop('nats-3')
            with self.assertRaisesRegex(Refused, 'did not settle'):
                observe_owned_group(names, monitor_ports, cluster, phases, 'minority', timeout=2)
            folder = root / 'nats-3'
            log = (folder / 'restarted.log').open('wb')
            logs.append(log)
            processes['nats-3'] = subprocess.Popen(
                [binary, '-c', str(folder / 'nats.conf')], stdout=log, stderr=log)
            recovered = observe_owned_group(names, monitor_ports, cluster, phases, 'rejoin')
            self.assertTrue(recovered['verified'])
        except BaseException as error:
            failure = repr(error)[:500]
            raise
        finally:
            if failure is not None:
                print(json.dumps({'owned_serving_group_failure': failure, 'phases': phases,
                                  'logs': {str(path.relative_to(root)): path.read_text()[-16384:]
                                           for path in sorted(root.glob('*/*.log'))}}), flush=True)
            cleanup = {}
            for unit in processes:
                try:
                    stop(unit)
                finally:
                    cleanup[unit] = processes[unit].poll()
                    if failure is not None:
                        print(json.dumps({'owned_serving_group_cleanup': cleanup}), flush=True)
            for log in logs:
                log.close()
            if failure is None:
                print(json.dumps({'owned_serving_group_phases': [
                    {key: row[key] for key in ('phase', 'budget', 'elapsed')} for row in phases],
                    'cleanup': cleanup}), flush=True)


if __name__ == '__main__':
    unittest.main()
