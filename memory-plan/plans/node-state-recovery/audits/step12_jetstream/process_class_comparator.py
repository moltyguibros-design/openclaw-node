import argparse
import copy

import process_observation_envelope as envelope


SCOPE = ('owned process-class consistency diagnostic; sampled, not continuous; '
         'no hold, eligibility or admission')


def class_key(row):
    return tuple(row[key] for key in ('executable', 'executable_sha256', 'arguments_sha256',
                                      'uid', 'gid', 'cwd'))


def expected_key(row):
    return class_key(envelope.diagnostic.redacted(row))


def birth(row):
    return row['start_sec'], row['start_usec']


def attributed(row, expected, policy, anchors, assigned, by_pid):
    attribution = expected['attribution']
    if attribution['kind'] == 'launchd':
        domain = attribution['domain']
        namespace = domain if domain == 'system' else '%s/%d' % (domain, policy['uid'])
        key = namespace + '/' + attribution['label']
        return any(name == key and anchor['j0']['loaded']
                   and anchor['j0'].get('state') == 'running'
                   and anchor['generation'] == envelope.generation(row)
                   and anchor['plist']['sha256'] == attribution['plist_sha256']
                   for name, anchor in anchors.items())
    parent = by_pid.get(row['ppid'])
    return (parent is not None and birth(parent) < birth(row)
            and assigned.get(parent['pid']) == attribution['label'])


def compare_classes(policy, observation):
    checked = envelope.valid_envelope(observation, policy)
    result = {'scope': SCOPE, 'policy_sha256': envelope.fingerprint(policy),
              'envelope_sha256': envelope.fingerprint(observation), 'source': checked['source'],
              'coverage': copy.deepcopy(checked['coverage']), 'phase': 'envelope', 'outcome': 'refused',
              'envelope_reasons': copy.deepcopy(checked['reasons']), 'assigned': {},
              'unexpected': [], 'ambiguous': [], 'missing': {}, 'excess': {},
              'admission': False, 'history_certified': False}
    if checked['outcome'] != 'recorded':
        return result
    result['phase'] = 'classes'
    rows = checked['stages']['pass_a']['included']
    anchors = checked['stages']['anchors']
    by_pid = {row['pid']: row for row in rows}
    expected = sorted(policy['expected'], key=lambda row: row['label'])
    keys = {row['label']: expected_key(row) for row in expected}
    assigned = {}
    counts = {row['label']: [] for row in expected}
    for row in sorted(rows, key=lambda row: (*birth(row), row['pid'])):
        key = class_key(row)
        classes = [item for item in expected if keys[item['label']] == key]
        candidates = [item['label'] for item in classes
                      if attributed(row, item, policy, anchors, assigned, by_pid)]
        if not candidates:
            result['unexpected'].append({'process': copy.deepcopy(row),
                                         'class_candidates': [item['label'] for item in classes]})
        elif len(candidates) != 1:
            result['ambiguous'].append({'process': copy.deepcopy(row), 'labels': candidates})
        else:
            assigned[row['pid']] = candidates[0]
            counts[candidates[0]].append(row['pid'])
    result['assigned'] = counts
    result['missing'] = {item['label']: item['count'] - len(counts[item['label']]) for item in expected
                         if len(counts[item['label']]) < item['count']}
    result['excess'] = {item['label']: len(counts[item['label']]) - item['count'] for item in expected
                        if len(counts[item['label']]) > item['count']}
    if not any(result[key] for key in ('unexpected', 'ambiguous', 'missing', 'excess')):
        result['outcome'] = 'class-consistent'
    return result


def inspect_owned(root, *, fixture=False, scripted=False):
    policy, observation = envelope.owned_envelope(root, fixture=fixture, scripted=scripted)
    return compare_classes(policy, observation)


def main():
    parser = argparse.ArgumentParser(description=SCOPE)
    parser.add_argument('owned_root')
    parser.add_argument('--fixture', action='store_true')
    parser.add_argument('--scripted', action='store_true')
    args = parser.parse_args()
    try:
        result = inspect_owned(args.owned_root, fixture=args.fixture, scripted=args.scripted)
    except envelope.ERRORS as error:
        result = {'scope': SCOPE, 'outcome': 'refused', 'admission': False,
                  'history_certified': False, 'error_type': type(error).__name__}
    print(envelope.encoded(result).decode())
    return 0 if result['outcome'] == 'class-consistent' else 2


if __name__ == '__main__':
    raise SystemExit(main())
