import argparse
import json
import pathlib
import re
import tempfile

import process_observation_envelope as envelope
from host_guest_commit import require_captured, require_committed, verify_frozen_checkpoint
from preservation_checks import require
from stopped_journal_inputs import read_inputs


SCOPE = ('scripted negative-job consistency for fixed managed labels and domains only; '
         'no live observation, execution hold, eligibility or admission')


def owner_uid(records):
    identity = records[0]['prior']['scheduler-heartbeat']['execution_hold'].get('metadata_identity')
    require(isinstance(identity, dict) and type(identity.get('uid')) is int and identity['uid'] >= 0,
            'held-job recorded owner UID is absent or invalid')
    return identity['uid']


def expected_keys(records):
    uid = owner_uid(records)
    return {namespace + '/ai.openclaw.' + unit for namespace in ('gui/%d' % uid, 'user/%d' % uid, 'system')
            for unit in records[0]['prior']}


def compare_held_jobs(records, jobs):
    """Records must already have passed verify_frozen_checkpoint; this is not a journal parser."""
    expected = expected_keys(records)
    require(isinstance(jobs, dict) and all(isinstance(key, str) for key in jobs),
            'held-job table is not a string-keyed object')
    result = {'scope': SCOPE, 'source': 'scripted', 'sampled': True, 'continuous': False,
              'baseline_sha256': records[0]['sha256'], 'checkpoint_sha256': records[-1]['sha256'],
              'jobs_sha256': envelope.fingerprint(jobs), 'missing': sorted(expected - jobs.keys()),
              'extra': sorted(jobs.keys() - expected), 'unknown': [], 'unexpected_loaded': [],
              'outcome': 'refused', 'admission': False, 'history_certified': False, 'hold_certified': False}
    for key in sorted(expected & jobs.keys()):
        try:
            envelope.valid_job(jobs[key])
        except envelope.Refused as error:
            result['unknown'].append({'key': key, 'error_type': type(error).__name__})
            continue
        if jobs[key]['loaded']:
            result['unexpected_loaded'].append(key)
    if not any(result[key] for key in ('missing', 'extra', 'unknown', 'unexpected_loaded')):
        result['outcome'] = 'held-jobs-negative-consistent'
    return result


def inspect_owned(root, *, fixture=False, scripted=False):
    require(fixture and scripted, 'held-job diagnostic requires --fixture and --scripted; no live observation')
    root = pathlib.Path(root)
    require(root.is_absolute() and root.parent == pathlib.Path(tempfile.gettempdir()).resolve()
            and re.fullmatch(r'openclaw-owned-held-jobs-[0-9a-f]{16}', root.name)
            and root.resolve(strict=True) == root, 'held-job diagnostic requires a literal owned fixture root')
    for path in (root, root / 'capture', root / 'data'):
        envelope.private_dir(path)
        require(path.resolve(strict=True) == path, 'held-job fixture input is not literal')
    table = envelope.read_private(root / 'table.json')
    capture_dir = root / 'capture'
    pinned = require_captured(capture_dir)
    commitment = require_committed(capture_dir)
    require(commitment == {**json.loads(pinned['COMMITTED.json']),
                           'checkpoint': json.loads(pinned['CHECKPOINT.json'])},
            'capture commitment differs from the pinned capture record')
    found = read_inputs(root / 'data', commitment)
    verified = verify_frozen_checkpoint(capture_dir, found['records'], table=table,
                                        configs=found['configs'], binary=found['binary'], home=found['home'])
    uid = owner_uid(found['records'])
    require(found['read'] and all(row['uid'] == uid for row in found['read']),
            'held-job recorded owner differs from stopped-image reader ownership')
    jobs = envelope.read_private(root / 'held-jobs.json')
    result = compare_held_jobs(found['records'], jobs)
    result['checkpoint_sha256'] = verified['checkpoint_sha256']
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
    return 0 if result['outcome'] == 'held-jobs-negative-consistent' else 2


if __name__ == '__main__':
    raise SystemExit(main())
