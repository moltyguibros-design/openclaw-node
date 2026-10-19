"""Owned post-restore NATS meta-quorum observation for the saved four-role topology."""

import time

from preservation_checks import Refused, http_json, require


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
                and not standalone.get('cluster'), 'standalone NATS identity or isolation changed')
        standalone_routes = get(ports['nats'], '/routez')
        require(standalone_routes.get('num_routes') == 0
                and standalone_routes.get('routes') == [], 'standalone NATS has cluster routes')
        require(not get(ports['nats'], '/jsz').get('meta_cluster'),
                'standalone NATS joined a JetStream meta group')
        varz = {unit: get(ports[unit], '/varz') for unit in live}
        ids = {unit: varz[unit].get('server_id') for unit in live}
        require(all(varz[unit].get('server_name') == names[unit]
                    and varz[unit].get('version') == '2.12.6'
                    and varz[unit].get('cluster', {}).get('name') == cluster
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
        require(all(isinstance(value, str) and value for value in raft_ids.values())
                and raft_ids['nats-2'] != raft_ids['nats-3'],
                'meta Raft member IDs are absent or aliased')
        held_ids = set()
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
                    and {row.get('name') for row in peers.values()} == expected_members - {names[unit]}
                    and all(row.get('known') is True for row in peers.values()),
                    unit + ': meta Raft peer set differs')
            other = next(other for other in live if other != unit)
            require(peers.get(raft_ids[other], {}).get('name') == names[other],
                    unit + ': live Raft peer identity differs')
            held_ids.add(next(peer_id for peer_id, row in peers.items()
                              if row['name'] == names['nats-1']))
        require(len(held_ids) == 1
                and groups['nats-2']['term'] == groups['nats-3']['term']
                and leader_meta.get('peer') == raft_ids[leader_unit],
                'meta Raft views disagree on held peer, term or leader')
        signature = (standalone.get('server_id'), tuple(ids[unit] for unit in live),
                     tuple(raft_ids[unit] for unit in live), next(iter(held_ids)),
                     leader, groups[leader_unit]['term'])
        return signature, {'verified': True, 'cluster': cluster,
                           'standalone': names['nats'], 'members': [names[unit] for unit in live],
                           'held_member': names['nats-1'], 'leader': leader,
                           'term': groups[leader_unit]['term'], 'size': 3, 'quorum_needed': 2,
                           'server_ids': ids, 'raft_ids': raft_ids}

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
