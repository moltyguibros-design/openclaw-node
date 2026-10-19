import argparse
import copy
import json
import pathlib
import re
import tempfile
import time

import held_job_negative_comparator as held
import process_observation_envelope as envelope
from host_guest_commit import require_captured, require_committed, verify_frozen_checkpoint
from preservation_checks import require
from stopped_journal_inputs import read_inputs


SCOPE = ('owned current-boot fixed managed-job observations; two sweeps; sampled, not continuous; '
         'no execution hold, process attribution, eligibility or admission')
WINDOW_NS = 1_800_000_000_000
STAGES = ('boot_start', 'sweep_a', 'sweep_b', 'boot_end')
COVERAGE = {'sampled': True, 'continuous': False, 'physical_exclusion': False}
FIELDS = ('scope', 'source', 'sample_labels', 'binding', 'budget', 'stages', 'failures',
          'outcome', 'reasons', 'coverage', 'admission', 'history_certified', 'hold_certified')


def binding(records):
    return {'baseline_sha256': records[0]['sha256'], 'checkpoint_sha256': records[-1]['sha256'],
            'uid': held.owner_uid(records)}


def job_pairs(records):
    uid = held.owner_uid(records)
    pairs = sorted((namespace, 'ai.openclaw.' + unit)
                   for namespace in ('gui/%d' % uid, 'user/%d' % uid, 'system')
                   for unit in records[0]['prior'])
    require({namespace + '/' + label for namespace, label in pairs} == held.expected_keys(records),
            'managed-job pair coverage differs')
    return pairs


def valid_observation(value, records):
    """Records must already have passed the unchanged frozen checkpoint verifier."""
    envelope.keys(value, FIELDS)
    require(value['scope'] == SCOPE and value['source'] in ('observed', 'scripted'),
            'managed-job scope or source differs')
    envelope.keys(value['coverage'], COVERAGE)
    require(all(value['coverage'][key] is expected for key, expected in COVERAGE.items()),
            'managed-job coverage claims differ')
    require(all(value[key] is False for key in ('admission', 'history_certified', 'hold_certified')),
            'managed-job certification claim differs')
    if value['source'] == 'observed':
        require(value['sample_labels'] is None, 'observed managed-job sample labels differ')
    else:
        envelope.keys(value['sample_labels'], ('source', 'coverage'))
        require(value['sample_labels']['source'] in ('observed', 'scripted'), 'scripted sample source differs')
        envelope.keys(value['sample_labels']['coverage'], COVERAGE)
        require(all(type(flag) is bool for flag in value['sample_labels']['coverage'].values()),
                'scripted sample coverage differs')
    envelope.keys(value['binding'], ('baseline_sha256', 'checkpoint_sha256', 'uid'))
    for name in ('baseline_sha256', 'checkpoint_sha256'):
        envelope.digest(value['binding'][name])
    envelope.integer(value['binding']['uid'])
    require(value['binding'] == binding(records), 'managed-job frozen binding differs')
    budget = value['budget']
    envelope.keys(budget, ('limit_ns', 'elapsed_ns', 'expired'))
    require(type(budget['limit_ns']) is int and budget['limit_ns'] == WINDOW_NS,
            'managed-job acceptance limit differs')
    envelope.integer(budget['elapsed_ns'])
    require(type(budget['expired']) is bool and budget['expired'] == (budget['elapsed_ns'] > WINDOW_NS),
            'managed-job expiry flag differs')
    envelope.keys(value['stages'], STAGES)
    require(isinstance(value['failures'], list), 'managed-job failures differ')
    for failure in value['failures']:
        envelope.keys(failure, ('stage', 'error_type'))
        require(failure['stage'] in ('boot_start', 'boot_end') and isinstance(failure['error_type'], str)
                and failure['error_type'], 'managed-job failure differs')
    require(value['outcome'] in ('recorded', 'refused') and isinstance(value['reasons'], list)
            and all(isinstance(reason, str) for reason in value['reasons']), 'managed-job verdict shape differs')
    reasons = []
    stages = value['stages']
    if any(stages[name] is None for name in STAGES):
        reasons.append('incomplete-stages')
    if value['failures']:
        reasons.append('stage-failures')
    if budget['expired']:
        reasons.append('budget-expired')
    for name in ('boot_start', 'boot_end'):
        if stages[name] is not None:
            envelope.digest(stages[name])
    if stages['boot_start'] != stages['boot_end']:
        reasons.append('boot-changed')
    expected = held.expected_keys(records)
    for name in ('sweep_a', 'sweep_b'):
        sweep = stages[name]
        if sweep is None:
            continue
        require(isinstance(sweep, dict) and all(isinstance(key, str) for key in sweep),
                'managed-job sweep is not a string-keyed object')
        if set(sweep) != expected:
            reasons.append(name + '-coverage')
        for key, fact in sorted(sweep.items()):
            if isinstance(fact, dict) and set(fact) == {'error_type'}:
                require(isinstance(fact['error_type'], str) and fact['error_type'], 'managed-job error differs')
                reasons.append(name + '-error:' + key)
            else:
                envelope.valid_job(fact)
    if stages['sweep_a'] != stages['sweep_b']:
        reasons.append('sweeps-differ')
    result = copy.deepcopy(value)
    result['reasons'] = reasons
    result['outcome'] = 'refused' if reasons else 'recorded'
    return result


def collect_jobs(records):
    """Live calls are composed only by the isolated CI test branch, never the CLI."""
    pairs = job_pairs(records)
    value = {'scope': SCOPE, 'source': 'observed', 'sample_labels': None, 'binding': binding(records),
             'budget': {'limit_ns': WINDOW_NS, 'elapsed_ns': 0, 'expired': False},
             'stages': dict.fromkeys(STAGES), 'failures': [], 'outcome': 'refused', 'reasons': [],
             'coverage': dict(COVERAGE), 'admission': False, 'history_certified': False, 'hold_certified': False}
    started = time.monotonic_ns()
    def boot(stage):
        try:
            value['stages'][stage] = envelope.boot_identity()
            envelope.digest(value['stages'][stage])
        except envelope.ERRORS as error:
            value['stages'][stage] = None
            value['failures'].append({'stage': stage, 'error_type': type(error).__name__})
    boot('boot_start')
    for stage in ('sweep_a', 'sweep_b'):
        sweep = value['stages'][stage] = {}
        for namespace, label in pairs:
            key = namespace + '/' + label
            if time.monotonic_ns() - started > WINDOW_NS:
                sweep[key] = {'error_type': 'BudgetExpired'}
                continue
            try:
                sweep[key] = envelope.redacted_job(envelope.census.launchd_service(namespace, label))
                envelope.valid_job(sweep[key])
            except envelope.ERRORS as error:
                sweep[key] = {'error_type': type(error).__name__}
    boot('boot_end')
    elapsed = time.monotonic_ns() - started
    value['budget'].update(elapsed_ns=elapsed, expired=elapsed > WINDOW_NS)
    return valid_observation(value, records)


def owned_records(root, *, fixture=False):
    require(fixture, 'managed-job frozen reader requires --fixture')
    root = pathlib.Path(root)
    require(root.is_absolute() and root.parent == pathlib.Path(tempfile.gettempdir()).resolve()
            and re.fullmatch(r'openclaw-owned-managed-jobs-[0-9a-f]{16}', root.name)
            and root.resolve(strict=True) == root, 'managed-job diagnostic requires a literal owned fixture root')
    for path in (root, root / 'capture', root / 'data'):
        envelope.private_dir(path)
        require(path.resolve(strict=True) == path, 'managed-job fixture input is not literal')
    capture_dir = root / 'capture'
    pinned = require_captured(capture_dir)
    commitment = require_committed(capture_dir)
    require(commitment == {**json.loads(pinned['COMMITTED.json']),
                           'checkpoint': json.loads(pinned['CHECKPOINT.json'])},
            'capture commitment differs from the pinned capture record')
    found = read_inputs(root / 'data', commitment)
    verified = verify_frozen_checkpoint(capture_dir, found['records'],
                                        configs=found['configs'], binary=found['binary'], home=found['home'])
    uid = held.owner_uid(found['records'])
    require(found['read'] and all(row['uid'] == uid for row in found['read']),
            'managed-job recorded owner differs from stopped-image reader ownership')
    return found['records'], verified['checkpoint_sha256']


def inspect_owned(root, *, fixture=False, scripted=False):
    require(fixture and scripted, 'managed-job diagnostic requires --fixture and --scripted; no live CLI')
    records, verified = owned_records(root, fixture=fixture)
    value = envelope.read_private(pathlib.Path(root) / 'managed-jobs.json')
    envelope.keys(value, FIELDS)
    value = copy.deepcopy(value)
    value['sample_labels'] = {'source': value['source'], 'coverage': copy.deepcopy(value['coverage'])}
    value['source'] = 'scripted'
    result = valid_observation(value, records)
    require(result['binding']['checkpoint_sha256'] == verified, 'managed-job verified digest differs')
    return result


def main():
    parser = argparse.ArgumentParser(description=SCOPE)
    parser.add_argument('owned_root')
    parser.add_argument('--fixture', action='store_true')
    parser.add_argument('--scripted', action='store_true')
    args = parser.parse_args()
    try:
        result = inspect_owned(args.owned_root, fixture=args.fixture, scripted=args.scripted)
    except envelope.ERRORS as error:
        result = {'scope': SCOPE, 'source': 'scripted', 'outcome': 'refused', 'admission': False,
                  'history_certified': False, 'hold_certified': False, 'error_type': type(error).__name__}
    print(envelope.encoded(result).decode())
    return 0 if result['outcome'] == 'recorded' else 2


if __name__ == '__main__':
    raise SystemExit(main())
