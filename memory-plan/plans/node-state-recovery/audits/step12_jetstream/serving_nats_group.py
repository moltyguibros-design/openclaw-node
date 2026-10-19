"""Owned post-restore NATS meta-quorum observation for the saved four-role topology."""

import hashlib
import time

from preservation_checks import Refused, http_json, require


DIGITS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'


def nats_node_id(server_name):
    return ''.join(DIGITS[value % 62] for value in hashlib.sha256(server_name.encode()).digest()[:8])


def wait_for_serving_group(names, ports, cluster, timeout, *, get=http_json,
                           clock=time.monotonic, sleep=time.sleep):
    require(set(names) == {'nats', 'nats-1', 'nats-2', 'nats-3'}
            and set(ports) == {'nats', 'nats-2', 'nats-3'},
            'serving NATS role names or monitor ports are incomplete')
    require(len(set(names.values())) == 4 and isinstance(cluster, str) and cluster,
            'serving NATS identities are not distinct')
    require(isinstance(timeout, (int, float)) and 1 < timeout <= 120,
            'serving NATS group needs a finite observation budget')
    expected_members = {names[unit] for unit in ('nats-1', 'nats-2', 'nats-3')}
    expected_raft_ids = {unit: nats_node_id(names[unit])
                         for unit in ('nats-1', 'nats-2', 'nats-3')}
    require(len(set(expected_raft_ids.values())) == 3,
            'serving NATS names alias a meta Raft node ID')
    live = ('nats-2', 'nats-3')
    previous = None
    stable_since = None
    last_failure = 'not sampled'
    deadline = clock() + timeout

    def sample():
        standalone = get(ports['nats'], '/varz')
        require(standalone.get('server_name') == names['nats']
                and standalone.get('version') == '2.12.6'
                and isinstance(standalone.get('server_id'), str) and standalone['server_id']
                and isinstance(standalone.get('start'), str) and standalone['start']
                and not standalone.get('cluster'), 'standalone NATS identity or isolation changed')
        standalone_routes = get(ports['nats'], '/routez')
        require(standalone_routes.get('num_routes') == 0
                and standalone_routes.get('routes') == [], 'standalone NATS has cluster routes')
        require(not get(ports['nats'], '/jsz').get('meta_cluster'),
                'standalone NATS joined a JetStream meta group')
        varz = {unit: get(ports[unit], '/varz') for unit in live}
        ids = {unit: varz[unit].get('server_id') for unit in live}
        starts = {unit: varz[unit].get('start') for unit in live}
        require(all(varz[unit].get('server_name') == names[unit]
                    and varz[unit].get('version') == '2.12.6'
                    and varz[unit].get('cluster', {}).get('name') == cluster
                    and isinstance(starts[unit], str) and starts[unit]
                    and isinstance(ids[unit], str) and ids[unit] for unit in live)
                and ids['nats-2'] != ids['nats-3'],
                'serving NATS member identity or cluster changed')
        for unit, other in (('nats-2', 'nats-3'), ('nats-3', 'nats-2')):
            routes = get(ports[unit], '/routez')
            route_peers = {(row.get('remote_name'), row.get('remote_id'))
                           for row in routes.get('routes', [])}
            require(route_peers == {(names[other], ids[other])},
                    unit + ': reciprocal live-member route is absent or foreign')
        meta = {}
        groups = {}
        for unit in live:
            health = get(ports[unit], '/healthz?js-meta-only=true')
            require(health == {'status': 'ok'}, unit + ': meta-only health refused')
            meta[unit] = get(ports[unit], '/jsz').get('meta_cluster')
            require(isinstance(meta[unit], dict)
                    and meta[unit].get('name') == cluster
                    and meta[unit].get('cluster_size') == 3
                    and meta[unit].get('leader') in {names['nats-2'], names['nats-3']},
                    unit + ': meta leader or group size differs')
            groups[unit] = get(ports[unit], '/raftz').get('$SYS', {}).get('_meta_')
            require(isinstance(groups[unit], dict), unit + ': meta Raft group is absent')
        leader = meta['nats-2']['leader']
        require(meta['nats-3']['leader'] == leader, 'serving members disagree on meta leader')
        leader_unit = next(unit for unit in live if names[unit] == leader)
        follower_unit = next(unit for unit in live if unit != leader_unit)
        leader_meta = meta[leader_unit]
        replicas = leader_meta.get('replicas')
        require(isinstance(replicas, list) and len(replicas) == 2
                and {row.get('name') for row in replicas} == expected_members - {leader},
                'meta leader replica set differs from the three pinned members')
        held = next(row for row in replicas if row['name'] == names['nats-1'])
        follower = next(row for row in replicas if row['name'] == names[follower_unit])
        require(held.get('offline') is True and follower.get('current') is True
                and follower.get('offline') is not True,
                'held member or live follower status differs')
        raft_ids = {unit: groups[unit].get('id') for unit in live}
        require(all(raft_ids[unit] == expected_raft_ids[unit] for unit in live),
                'meta Raft member IDs are absent or aliased')
        for unit in live:
            group = groups[unit]
            expected_state = 'LEADER' if unit == leader_unit else 'FOLLOWER'
            require(group.get('state') == expected_state
                    and group.get('size') == 3 and group.get('quorum_needed') == 2
                    and group.get('leader') == raft_ids[leader_unit]
                    and group.get('term', 0) > 0
                    and not any(group.get(key) for key in ('observer', 'paused', 'catching_up')),
                    unit + ': meta Raft quorum, term or role is unready')
            peers = group.get('peers')
            require(isinstance(peers, dict)
                    and set(peers) == {expected_raft_ids[other] for other in expected_raft_ids
                                       if other != unit}
                    and all(peers[expected_raft_ids[other]].get('name') == names[other]
                            and peers[expected_raft_ids[other]].get('known') is True
                            for other in live if other != unit)
                    and peers[expected_raft_ids['nats-1']].get('name')
                    in ('', names['nats-1']),
                    unit + ': meta Raft peer set differs')
        require(groups['nats-2']['term'] == groups['nats-3']['term']
                and leader_meta.get('peer') == raft_ids[leader_unit],
                'meta Raft views disagree on held peer, term or leader')
        signature = (standalone.get('server_id'), standalone['start'],
                     tuple((ids[unit], starts[unit]) for unit in live),
                     tuple(raft_ids[unit] for unit in live), expected_raft_ids['nats-1'],
                     leader, groups[leader_unit]['term'])
        return signature, {'verified': True, 'cluster': cluster,
                           'standalone': names['nats'], 'members': [names[unit] for unit in live],
                           'held_member': names['nats-1'], 'leader': leader,
                           'term': groups[leader_unit]['term'], 'size': 3, 'quorum_needed': 2,
                           'server_ids': ids, 'server_starts': starts,
                           'raft_ids': {**raft_ids, 'nats-1': expected_raft_ids['nats-1']}}

    while clock() < deadline:
        try:
            signature, evidence = sample()
        except (Refused, KeyError, TypeError, ValueError, StopIteration) as error:
            signature = None
            last_failure = str(error) if isinstance(error, Refused) else type(error).__name__
        if signature is not None and signature == previous:
            if stable_since is None:
                stable_since = clock()
            if clock() - stable_since >= 1:
                return evidence
        else:
            stable_since = None
            if signature is not None:
                last_failure = 'valid group did not remain stable'
        previous = signature
        sleep(.05)
    raise Refused('serving NATS meta quorum did not settle: ' + last_failure)
