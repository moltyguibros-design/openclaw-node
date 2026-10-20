import contextlib
import hashlib
import json
import os
import signal
import time


SCHEMA = 'owned-preservation-cluster-startup-v1'
WINDOW = 131072
LINE = 1024
REPORT = 262144
STARTUP = ('Route connection created', 'Self is new JetStream cluster metadata leader',
           'JetStream cluster new metadata leader:')
CREATE_INFO = STARTUP + ('JetStream cluster new stream leader for ',)


def log_window(path, start, end=None, *, startup=False):
    with path.open('rb') as handle:
        size = os.fstat(handle.fileno()).st_size if end is None else end
        length = max(0, size - start)
        handle.seek(start)
        raw = handle.read(min(length, WINDOW))
    lines = []
    clipped = False
    for line in raw.decode('utf-8', errors='replace').splitlines():
        if startup:
            if '[INF]' not in line or not any(term in line for term in STARTUP):
                continue
        elif ('Peer selection:' not in line and not
              ('[INF]' in line and any(term in line for term in CREATE_INFO))):
            continue
        clipped |= len(line) > LINE
        lines.append(line[:LINE])
    return {'from': start, 'to': size, 'bytesRead': len(raw),
            'complete': size >= start and length <= WINDOW and len(raw) == length and not clipped,
            'sha256': hashlib.sha256(raw).hexdigest(), 'lines': lines}


def stop_owners(owners, root):
    outcomes = []
    for i, (proc, log) in reversed(list(enumerate(owners))):
        row = {'name': f'owned-raft-{i}', 'pid': proc.pid, 'signal': None,
               'exitCode': None, 'forced': False, 'shutdownMarker': False,
               'reaped': False, 'error': []}
        try:
            if proc.poll() is None:
                row['signal'] = 'SIGTERM'
                proc.send_signal(signal.SIGTERM)
            row['exitCode'] = proc.wait(timeout=10)
            row['reaped'] = True
            if row['exitCode'] != 0:
                row['error'].append('nonzero exit')
        except Exception as error:
            row['error'].append('stop: ' + type(error).__name__)
            try:
                if proc.poll() is None:
                    row['forced'] = True
                    proc.kill()
                    row['exitCode'] = proc.wait(timeout=5)
                    row['reaped'] = True
            except Exception as error:
                row['error'].append('kill-wait: ' + type(error).__name__)
        try:
            with (root/f'server-{i}.log').open('rb') as handle:
                handle.seek(max(0, os.fstat(handle.fileno()).st_size - 16384))
                row['shutdownMarker'] = b'Server Exiting' in handle.read(16384)
            if not row['shutdownMarker']:
                row['error'].append('shutdown marker absent')
        except Exception as error:
            row['error'].append('shutdown log: ' + type(error).__name__)
        finally:
            try:
                log.close()
            except Exception as error:
                row['error'].append('log close: ' + type(error).__name__)
        outcomes.append(row)
    return outcomes


class StartupEvidence:
    def __init__(self, root, ports, token, password, output=None):
        self.root, self.secrets, self.output = root, (token, password), output
        self.offsets = [None] * 3
        self.data = {'schema': SCHEMA, 'scope': 'owned three-member fixture; diagnostic only',
                     'debug': True, 'phase': 'startup', 'ports': ports, 'accepted': None,
                     'createInvocations': 0, 'clients': {}, 'selector': [], 'startup': [],
                     'postFailure': None, 'owners': [], 'diagnosticErrors': []}

    def observe(self, key, read):
        try:
            self.data[key] = read()
        except Exception as error:
            self.data['diagnosticErrors'].append(key + ': ' + type(error).__name__)

    def accepted(self, js, routes, *, key='accepted', source='accepting loop iteration; sequential samples'):
        def project():
            members = []
            for i in range(3):
                member = js[i] if js is not None else {}
                route = routes[i] if routes is not None else {}
                meta = member.get('meta_cluster', {})
                members.append({'name': f'owned-raft-{i}', 'serverId': member.get('server_id'),
                    'now': member.get('now'), 'routeNow': route.get('now'),
                    'routeServerId': route.get('server_id'),
                    'leader': meta.get('leader'), 'clusterSize': meta.get('cluster_size'),
                    'replicas': [{key: peer.get(key) for key in ('name', 'current', 'offline', 'lag')}
                                 for peer in meta.get('replicas', [])[:3]],
                    'routeIds': sorted({peer['remote_id'] for peer in route.get('routes', [])})[:3]})
            return {'recordedAt': time.time(), 'source': source,
                    'jsObserved': js is not None, 'routesObserved': routes is not None,
                    'members': members}
        self.observe(key, project)

    def post_failure(self, read):
        def project():
            members = []
            for i in range(3):
                row = {'name': f'owned-raft-{i}', 'observed': False, 'startedAt': time.time()}
                try:
                    report = read(i)
                    meta = report.get('meta_cluster', {})
                    row.update({'observed': True, 'serverId': report.get('server_id'),
                        'now': report.get('now'), 'streams': report.get('streams'),
                        'consumers': report.get('consumers'), 'leader': meta.get('leader'),
                        'clusterSize': meta.get('cluster_size'),
                        'replicas': [{key: peer.get(key) for key in ('name', 'current', 'offline', 'lag')}
                                     for peer in meta.get('replicas', [])[:3]]})
                except Exception as error:
                    row['error'] = type(error).__name__
                    self.data['diagnosticErrors'].append(f'postFailure member{i}: ' + type(error).__name__)
                row['endedAt'] = time.time()
                members.append(row)
            return {'source': 'after failed create; sequential jsz samples', 'members': members}
        self.observe('postFailure', project)

    def client(self, action, result):
        def parse():
            raw = result.stderr if result.returncode else result.stdout
            try:
                value = json.loads(raw)
            except (ValueError, TypeError):
                return {'returncode': result.returncode, 'unparsed': True}
            if not isinstance(value, dict):
                return {'returncode': result.returncode, 'unparsed': True}
            row = {key: value.get(key) for key in
                   ('stage', 'name', 'code', 'message', 'connected', 'streamAddAttempts', 'leader')}
            api = value.get('api_error')
            row['api_error'] = ({key: api.get(key) for key in ('code', 'err_code', 'description')}
                                if isinstance(api, dict) else None)
            row['returncode'] = result.returncode
            return row
        try:
            self.data['clients'][action] = parse()
        except Exception as error:
            self.data['diagnosticErrors'].append('client: ' + type(error).__name__)

    @contextlib.contextmanager
    def create_window(self):
        self.data['phase'] = 'first-create'
        self.data['createInvocations'] += 1
        self.data['createStartedAt'] = time.time()
        for i in range(3):
            try:
                self.offsets[i] = (self.root/f'server-{i}.log').stat().st_size
            except Exception as error:
                self.data['diagnosticErrors'].append('offset: ' + type(error).__name__)
        try:
            yield
        finally:
            self.data['createEndedAt'] = time.time()
            for i, offset in enumerate(self.offsets):
                if offset is not None:
                    try:
                        self.data['selector'].append({'name': f'owned-raft-{i}',
                            **log_window(self.root/f'server-{i}.log', offset)})
                    except Exception as error:
                        self.data['diagnosticErrors'].append('selector: ' + type(error).__name__)

    def encoded(self):
        raw = json.dumps(self.data, sort_keys=True, indent=2) + '\n'
        reason = ('credential' if any(secret and secret in raw for secret in self.secrets)
                  else 'size' if len(raw.encode()) > REPORT else None)
        if reason:
            return json.dumps({'schema': SCHEMA, 'suppressed': True, 'reason': reason}) + '\n', False
        return raw, True

    def write(self, path, raw):
        with path.open('x', encoding='utf-8') as handle:
            os.chmod(path, 0o600)
            handle.write(raw)

    def finish(self, owners, succeeded, primary):
        self.data['owners'] = stop_owners(owners, self.root)
        self.data['primary'] = type(primary).__name__ if primary is not None else None
        for i, offset in enumerate(self.offsets):
            try:
                self.data['startup'].append({'name': f'owned-raft-{i}',
                    **log_window(self.root/f'server-{i}.log', 0, offset, startup=True)})
            except Exception as error:
                self.data['diagnosticErrors'].append('startup: ' + type(error).__name__)
        clean = len(owners) == 3 and all(not row['error'] and row['reaped']
                                       for row in self.data['owners'])
        self.data['passed'] = succeeded and clean and not self.data['diagnosticErrors']
        retained = True
        for path in [self.root/'startup-evidence.json'] + ([self.output] if self.output else []):
            try:
                raw, valid = self.encoded()
                retained &= valid
                self.write(path, raw)
            except Exception as error:
                retained = False
                self.data['passed'] = False
                self.data['diagnosticErrors'].append('write: ' + type(error).__name__)
        try:
            raw, valid = self.encoded()
            retained &= valid
            value = json.loads(raw)
            summary = ({key: value.get(key) for key in ('schema', 'suppressed', 'reason')}
                       if not valid else {
                'schema': SCHEMA, 'phase': self.data['phase'], 'passed': self.data['passed'],
                'accepted': self.data['accepted'], 'createInvocations': self.data['createInvocations'],
                'create': self.data['clients'].get('create'),
                'postFailure': self.data['postFailure'],
                'selectorCounts': [len(row['lines']) for row in self.data['selector']],
                'owners': self.data['owners'], 'diagnosticErrors': self.data['diagnosticErrors']})
            print('preservation-cluster-startup: ' + json.dumps(summary))
        except Exception:
            retained = False
        if primary is None:
            if not clean:
                raise AssertionError('owned cluster shutdown was not normal')
            if not retained or self.data['diagnosticErrors']:
                raise AssertionError('owned cluster diagnostic report unavailable or suppressed')
