import argparse
import copy
import hashlib
import json
import os
import pathlib
import re
import stat
import subprocess
import tempfile
import time

import scoped_process_diagnostic as diagnostic
import nats_live_census as census
from boot_process_policy import image_process_policy
from preservation_checks import require
from preservation_journal import DIGEST, Refused, boot_identity, encoded, regular_content
from stopped_journal_inputs import private_dir


SCOPE = ('owned current-boot process observation envelope; four PID samples; sampled, not continuous; '
         'no class matching, eligibility or admission')
WINDOW_NS = 120_000_000_000
ANCHOR_CAP = 16
FILE_LIMIT = 8 << 20
STAGES = ('boot_start', 'pass_a', 'scope_a', 'anchors', 'pass_b', 'scope_b', 'boot_end')
ENVELOPE_KEYS = ('scope', 'source', 'sample_labels', 'policy_binding', 'budget', 'stages',
                 'failures', 'outcome', 'reasons', 'admission', 'history_certified', 'coverage')
COVERAGE = {'uid_scope': True, 'sampled': True, 'continuous': False, 'physical_exclusion': False,
            'executable_binding': 'on-disk bytes at observation; not loaded image',
            'authority': 'unprotected owned fixture input; no B3 host-held pin provenance'}
ERRORS = (OSError, RuntimeError, ValueError, subprocess.SubprocessError)


def keys(value, expected):
    require(isinstance(value, dict) and set(value) == set(expected), 'envelope schema differs')


def integer(value, minimum=0):
    require(type(value) is int and value >= minimum, 'envelope integer differs')


def digest(value):
    require(isinstance(value, str) and DIGEST.fullmatch(value), 'envelope digest differs')


def fingerprint(row):
    return hashlib.sha256(encoded(row)).hexdigest()


def binding(policy):
    anchors = set()
    for row in policy['expected']:
        attribution = row['attribution']
        if attribution['kind'] == 'launchd':
            domain = attribution['domain']
            namespace = domain if domain == 'system' else '%s/%d' % (domain, policy['uid'])
            anchors.add((namespace, attribution['label']))
    return {'policy_sha256': fingerprint(policy), 'uid': policy['uid'],
            'roots': copy.deepcopy(policy['roots']), 'anchors': [list(pair) for pair in sorted(anchors)]}


def expectations(bound, boot):
    return {'scope': diagnostic.SCOPE, 'boot': boot, 'uid': bound['uid'],
            'roots': bound['roots'], 'expected': []}


def generation(row):
    return {key: row[key] for key in ('pid', 'uid', 'start_sec', 'start_usec')}


def valid_generation(row):
    keys(row, ('pid', 'uid', 'start_sec', 'start_usec'))
    for key in row:
        integer(row[key], 1 if key in ('pid', 'start_sec') else 0)
    require(row['start_usec'] < 1_000_000, 'envelope generation differs')


def redacted_record(row):
    keys(row, diagnostic.PROCESS_KEYS - {'arguments'} | {'arguments_sha256'})
    valid_generation(generation(row))
    for key in ('ppid', 'gid'):
        integer(row[key])
    require(diagnostic.absolute(row['executable']) and diagnostic.absolute(row['cwd'])
            and isinstance(row['name'], str) and row['name'], 'envelope process paths differ')
    digest(row['executable_sha256'])
    digest(row['arguments_sha256'])


def unknown_records(rows):
    require(isinstance(rows, list), 'envelope unknown table differs')
    for row in rows:
        keys(row, ('pid', 'field', 'error_type'))
        if row['pid'] is not None:
            integer(row['pid'], 1)
        require(all(isinstance(row[key], str) and row[key] for key in ('field', 'error_type')),
                'envelope unknown entry differs')


def sample_list(value):
    require(isinstance(value, list) and all(type(pid) is int and pid > 0 for pid in value)
            and value == sorted(set(value)), 'envelope PID sample differs')


def valid_pass(value):
    keys(value, ('boot', 'enumeration', 'before', 'after', 'unstable', 'included', 'excluded', 'unknown'))
    if value['boot'] is not None:
        digest(value['boot'])
    require(value['enumeration'] in ('full', 'substituted'), 'envelope enumeration differs')
    for key in ('before', 'after', 'unstable'):
        sample_list(value[key])
    require(isinstance(value['included'], list) and isinstance(value['excluded'], list),
            'envelope process table differs')
    for row in value['included']:
        redacted_record(row)
    for row in value['excluded']:
        keys(row, ('pid', 'uid', 'start_sec', 'start_usec', 'row_sha256'))
        valid_generation(generation(row))
        digest(row['row_sha256'])
    pids = [row['pid'] for row in value['included'] + value['excluded']]
    require(len(pids) == len(set(pids)), 'envelope process PID is duplicated')
    unknown_records(value['unknown'])


def valid_job(value):
    require(isinstance(value, dict) and type(value.get('loaded')) is bool,
            'envelope launchd observation differs')
    if not value['loaded']:
        keys(value, ('loaded',))
        return
    keys(value, ('loaded', 'state', 'pid', 'program', 'arguments_sha256', 'plist'))
    require(isinstance(value['state'], str) and value['state']
            and diagnostic.absolute(value['program']) and diagnostic.absolute(value['plist']),
            'envelope launchd paths or state differ')
    if value['pid'] is not None:
        integer(value['pid'], 1)
    require(value['state'] != 'running' or value['pid'] is not None,
            'envelope running job has no PID')
    digest(value['arguments_sha256'])


def file_identity(path):
    info = pathlib.Path(path).lstat()
    return {'device': info.st_dev, 'inode': info.st_ino, 'ctime_ns': info.st_ctime_ns}


def valid_anchor(value):
    keys(value, ('j0', 'j1', 'generation', 'plist', 'error'))
    for key in ('j0', 'j1'):
        if value[key] is not None:
            valid_job(value[key])
    if value['generation'] is not None:
        valid_generation(value['generation'])
    if value['plist'] is not None:
        keys(value['plist'], ('sha256', 'before', 'after'))
        if value['plist']['sha256'] is not None:
            digest(value['plist']['sha256'])
        for key in ('before', 'after'):
            info = value['plist'][key]
            if info is not None:
                keys(info, ('device', 'inode', 'ctime_ns'))
                for number in info.values():
                    integer(number)
    if value['error'] is not None:
        keys(value['error'], ('stage', 'error_type'))
        require(value['error']['stage'] in ('j0', 'generation', 'plist', 'j1')
                and isinstance(value['error']['error_type'], str) and value['error']['error_type'],
                'envelope anchor error differs')


def valid_envelope(value, policy):
    keys(value, ENVELOPE_KEYS)
    require(value['scope'] == SCOPE and value['source'] in ('observed', 'scripted')
            and value['admission'] is False and value['history_certified'] is False,
            'envelope scope or authority differs')
    keys(value['policy_binding'], ('policy_sha256', 'uid', 'roots', 'anchors'))
    integer(value['policy_binding']['uid'])
    require(value['policy_binding'] == binding(policy), 'envelope policy binding differs')
    labels = value['sample_labels']
    if value['source'] == 'observed':
        require(labels is None, 'observed envelope has scripted labels')
    else:
        keys(labels, ('source', 'enumeration', 'attribution'))
        require(labels['source'] in ('observed', 'scripted')
                and labels['enumeration'] in ('full', 'substituted', 'scripted', 'incomplete')
                and labels['attribution'] in ('observed', 'scripted'), 'scripted envelope labels differ')
    budget = value['budget']
    keys(budget, ('limit_ns', 'anchor_cap', 'elapsed_ns', 'expired'))
    require(type(budget['limit_ns']) is int and budget['limit_ns'] == WINDOW_NS
            and type(budget['anchor_cap']) is int and budget['anchor_cap'] == ANCHOR_CAP,
            'envelope budget contract differs')
    integer(budget['elapsed_ns'])
    require(type(budget['expired']) is bool and budget['expired'] == (budget['elapsed_ns'] > WINDOW_NS),
            'envelope expiry claim differs')
    stages = value['stages']
    keys(stages, STAGES)
    for key in ('boot_start', 'boot_end'):
        if stages[key] is not None:
            digest(stages[key])
    for key in ('pass_a', 'pass_b'):
        if stages[key] is not None:
            valid_pass(stages[key])
    for key in ('scope_a', 'scope_b'):
        stage = stages[key]
        if stage is not None:
            keys(stage, ('expectations_sha256', 'errors', 'monotonic_ns'))
            digest(stage['expectations_sha256'])
            require(isinstance(stage['errors'], list)
                    and all(isinstance(item, str) for item in stage['errors']), 'envelope scope errors differ')
            keys(stage['monotonic_ns'], ('start', 'end'))
            start, end = stage['monotonic_ns']['start'], stage['monotonic_ns']['end']
            integer(start)
            integer(end)
            require(start <= end <= budget['elapsed_ns'], 'envelope scope interval differs')
    anchors = stages['anchors']
    require(anchors is None or isinstance(anchors, dict), 'envelope anchor table differs')
    if anchors is not None:
        for anchor in anchors.values():
            valid_anchor(anchor)
    require(isinstance(value['failures'], list), 'envelope failure table differs')
    for failure in value['failures']:
        keys(failure, ('stage', 'error_type'))
        require(all(isinstance(item, str) and item for item in failure.values()), 'envelope failure differs')
    require(value['outcome'] in ('recorded', 'refused') and isinstance(value['reasons'], list)
            and all(isinstance(reason, str) for reason in value['reasons']), 'envelope verdict differs')
    coverage = value['coverage']
    keys(coverage, (*COVERAGE, 'enumeration', 'attribution'))
    require(all(type(coverage[key]) is type(expected) and coverage[key] == expected
                for key, expected in COVERAGE.items())
            and coverage['enumeration'] in ('full', 'substituted', 'scripted', 'incomplete')
            and coverage['attribution'] == value['source'], 'envelope coverage differs')

    reasons = []
    if any(stages[key] is None for key in STAGES):
        reasons.append('collection incomplete')
    if value['failures']:
        reasons.append('collection failed')
    if budget['expired']:
        reasons.append('acceptance window expired; calls are not interruptible')
    pairs = value['policy_binding']['anchors']
    if len(pairs) > ANCHOR_CAP:
        reasons.append('anchor cap exceeded')
    expected_anchors = {'%s/%s' % tuple(pair) for pair in pairs}
    if anchors is not None and set(anchors) != expected_anchors:
        reasons.append('anchor coverage differs')
    a, b = stages['pass_a'], stages['pass_b']
    rows = []
    for name, observed, scoped in (('a', a, stages['scope_a']), ('b', b, stages['scope_b'])):
        if observed is None:
            rows.append({})
            continue
        if observed['boot'] != stages['boot_start']:
            reasons.append('pass ' + name + ' boot differs')
        if observed['unknown']:
            reasons.append('pass ' + name + ' has unknown scope')
        if observed['unstable']:
            reasons.append('pass ' + name + ' has unstable PIDs')
        if observed['before'] != observed['after']:
            reasons.append('pass ' + name + ' PID samples differ')
        table = {row['pid']: row for row in observed['included'] + observed['excluded']}
        represented = set(table) | {row['pid'] for row in observed['unknown'] if row['pid'] is not None}
        if represented != set(observed['before']) | set(observed['after']):
            reasons.append('pass ' + name + ' coverage differs')
        if any(row['uid'] == policy['uid'] for row in observed['excluded']):
            reasons.append('same-UID process was excluded')
        rows.append(table)
        if scoped is not None:
            if stages['boot_start'] is None or scoped['expectations_sha256'] != fingerprint(
                    expectations(value['policy_binding'], stages['boot_start'])):
                reasons.append('pass ' + name + ' scope binding differs')
            if scoped['errors']:
                reasons.append('pass ' + name + ' scope check failed')
    if stages['boot_start'] != stages['boot_end']:
        reasons.append('outer boot differs')
    if a is not None and b is not None:
        if a['before'] != b['before']:
            reasons.append('cross-pass PID samples differ')
        if a['included'] != b['included'] or a['excluded'] != b['excluded']:
            reasons.append('cross-pass process or scope differs')
        if a['enumeration'] != b['enumeration']:
            reasons.append('enumeration source changed')
    sa, sb = stages['scope_a'], stages['scope_b']
    if sa is not None and sb is not None and sa['monotonic_ns']['end'] > sb['monotonic_ns']['start']:
        reasons.append('scope interval order differs')
    if anchors is not None:
        for label, anchor in anchors.items():
            if anchor['error'] is not None:
                reasons.append(label + ': anchor unobservable')
            j0, j1 = anchor['j0'], anchor['j1']
            if j0 is None or j1 is None or j0 != j1:
                reasons.append(label + ': launchd bracket differs')
            if j0 is None:
                continue
            pid = j0.get('pid') if j0['loaded'] else None
            if pid is None:
                if anchor['generation'] is not None or anchor['plist'] is not None:
                    reasons.append(label + ': negative job has invented process facts')
                continue
            gen = anchor['generation']
            if gen is None or gen['pid'] != pid or any(
                    pid not in table or generation(table[pid]) != gen for table in rows):
                reasons.append(label + ': generation not bound to both passes')
            info = anchor['plist']
            if info is None or any(info[key] is None for key in ('sha256', 'before', 'after')):
                reasons.append(label + ': plist incomplete')
            elif info['before'] != info['after']:
                reasons.append(label + ': plist changed')
    enumeration = 'incomplete'
    if a is not None and b is not None and a['enumeration'] == b['enumeration']:
        enumeration = a['enumeration']
    if value['source'] == 'scripted':
        enumeration = 'scripted'
    result = copy.deepcopy(value)
    result['coverage']['enumeration'] = enumeration
    result['reasons'] = reasons
    result['outcome'] = 'refused' if reasons else 'recorded'
    return result


def redacted_job(raw):
    if raw == {'loaded': False}:
        return dict(raw)
    keys(raw, ('loaded', 'state', 'pid', 'program', 'arguments', 'plist'))
    require(isinstance(raw['arguments'], list) and raw['arguments']
            and all(isinstance(arg, str) and '\0' not in arg for arg in raw['arguments']),
            'launchd arguments are unobservable')
    result = {key: value for key, value in raw.items() if key != 'arguments'}
    result['arguments_sha256'] = hashlib.sha256(b'\0'.join(arg.encode() for arg in raw['arguments'])).hexdigest()
    valid_job(result)
    return result


def collect_anchor(namespace, label):
    value = dict(j0=None, j1=None, generation=None, plist=None, error=None)
    stage = 'j0'
    try:
        value['j0'] = redacted_job(census.launchd_service(namespace, label))
        if value['j0'].get('pid') is not None:
            stage = 'generation'
            value['generation'] = generation(diagnostic.proc.bsd_info(value['j0']['pid']))
            valid_generation(value['generation'])
            stage = 'plist'
            path = value['j0']['plist']
            value['plist'] = dict(before=file_identity(path), after=None, sha256=None)
            value['plist']['sha256'] = regular_content(path, 1 << 20)
            value['plist']['after'] = file_identity(path)
        stage = 'j1'
        value['j1'] = redacted_job(census.launchd_service(namespace, label))
    except ERRORS as error:
        value['error'] = {'stage': stage, 'error_type': type(error).__name__}
    return value


def collect_envelope(policy):
    bound = binding(policy)
    value = {'scope': SCOPE, 'source': 'observed', 'sample_labels': None, 'policy_binding': bound,
             'budget': {'limit_ns': WINDOW_NS, 'anchor_cap': ANCHOR_CAP, 'elapsed_ns': 0, 'expired': False},
             'stages': dict.fromkeys(STAGES), 'failures': [], 'outcome': 'refused', 'reasons': [],
             'admission': False, 'history_certified': False,
             'coverage': {**COVERAGE, 'enumeration': 'incomplete', 'attribution': 'observed'}}
    started = time.monotonic_ns()
    def offset():
        return time.monotonic_ns() - started
    def checkpoint():
        elapsed = offset()
        value['budget'].update(elapsed_ns=elapsed, expired=elapsed > WINDOW_NS)
        require(elapsed <= WINDOW_NS, 'observation acceptance window expired')
    def scope(raw, suffix):
        target = value['stages']
        target['pass_' + suffix] = {key: copy.deepcopy(raw[key]) for key in
                                   ('boot', 'before', 'after', 'unstable', 'enumeration', 'unknown')}
        target['pass_' + suffix].update(included=[], excluded=[])
        checkpoint()
        begin = offset()
        report = diagnostic.compare(raw, expectations(bound, target['boot_start']))
        excluded = set(report['excluded_pids'])
        target['pass_' + suffix].update(
            included=report['unexpected'], unknown=report['unknown'],
            excluded=[{**generation(row), 'row_sha256': fingerprint(diagnostic.redacted(row))}
                      for row in raw['processes'] if row['pid'] in excluded])
        target['scope_' + suffix] = {'expectations_sha256': report['expectations_sha256'],
                                     'errors': report['errors'],
                                     'monotonic_ns': {'start': begin, 'end': offset()}}
        checkpoint()
    stage = 'anchor-cap'
    try:
        require(len(bound['anchors']) <= ANCHOR_CAP, 'observation anchor cap exceeded')
        stage = 'boot_start'
        value['stages']['boot_start'] = boot_identity()
        digest(value['stages']['boot_start'])
        checkpoint()
        stage = 'pass_a/scope_a'
        raw_a = diagnostic.observe()
        scope(raw_a, 'a')
        value['stages']['anchors'] = {}
        for namespace, label in bound['anchors']:
            stage = 'anchor:' + namespace + '/' + label
            value['stages']['anchors'][namespace + '/' + label] = collect_anchor(namespace, label)
            checkpoint()
        stage = 'pass_b/scope_b'
        raw_b = diagnostic.observe()
        scope(raw_b, 'b')
        stage = 'boot_end'
        value['stages']['boot_end'] = boot_identity()
        digest(value['stages']['boot_end'])
        checkpoint()
    except ERRORS as error:
        value['failures'].append({'stage': stage, 'error_type': type(error).__name__})
    value['budget'].update(elapsed_ns=offset())
    value['budget']['expired'] = value['budget']['elapsed_ns'] > WINDOW_NS
    return valid_envelope(value, policy)


def read_private(path):
    path = pathlib.Path(path)
    require(path.resolve(strict=True) == path, 'envelope input is not literal')
    before = path.lstat()
    require(stat.S_ISREG(before.st_mode) and before.st_uid == os.getuid() and before.st_nlink == 1
            and stat.S_IMODE(before.st_mode) == 0o600, 'envelope input is not owner-private')
    raw = regular_content(path, FILE_LIMIT, keep_bytes=True)
    after = path.lstat()
    require((before.st_dev, before.st_ino, before.st_ctime_ns) ==
            (after.st_dev, after.st_ino, after.st_ctime_ns), 'envelope input changed while read')
    value = json.loads(raw)
    require(encoded(value) == raw, 'envelope input is not canonical')
    return value


def owned_envelope(root, *, fixture=False, scripted=False):
    require(fixture, 'production process observation envelope is disabled')
    root = pathlib.Path(root)
    require(root.is_absolute() and root.parent == pathlib.Path(tempfile.gettempdir()).resolve()
            and re.fullmatch(r'openclaw-owned-envelope-[0-9a-f]{16}', root.name)
            and root.resolve(strict=True) == root, 'envelope requires a literal owned fixture root')
    for path in (root, root / 'capture', root / 'data'):
        private_dir(path)
        require(path.resolve(strict=True) == path, 'envelope fixture input is not literal')
    if scripted:
        value = read_private(root / 'envelope.json')
    policy = image_process_policy(root / 'capture', root / 'data')['process_policy']
    require(policy['uid'] == os.getuid(), 'envelope policy owner differs')
    for name in policy['roots']:
        path = pathlib.Path(name)
        require((path == root or root in path.parents) and path.resolve(strict=True) == path
                and path.stat().st_uid == os.getuid(), 'envelope policy root escapes the owned fixture')
    if not scripted:
        return policy, collect_envelope(policy)
    value = copy.deepcopy(value)
    keys(value, ENVELOPE_KEYS)
    keys(value['coverage'], (*COVERAGE, 'enumeration', 'attribution'))
    value['sample_labels'] = {'source': value['source'], 'enumeration': value['coverage']['enumeration'],
                              'attribution': value['coverage']['attribution']}
    value['source'] = 'scripted'
    value['coverage']['enumeration'] = 'scripted'
    value['coverage']['attribution'] = 'scripted'
    return policy, valid_envelope(value, policy)


def inspect_owned(root, *, fixture=False, scripted=False):
    return owned_envelope(root, fixture=fixture, scripted=scripted)[1]


def main():
    parser = argparse.ArgumentParser(description=SCOPE)
    parser.add_argument('owned_root')
    parser.add_argument('--fixture', action='store_true')
    parser.add_argument('--scripted', action='store_true')
    args = parser.parse_args()
    try:
        result = inspect_owned(args.owned_root, fixture=args.fixture, scripted=args.scripted)
    except ERRORS as error:
        result = {'scope': SCOPE, 'outcome': 'refused', 'admission': False,
                  'history_certified': False, 'error_type': type(error).__name__}
    print(encoded(result).decode())
    return 0 if result['outcome'] == 'recorded' else 2


if __name__ == '__main__':
    raise SystemExit(main())
