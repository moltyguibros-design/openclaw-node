import argparse
import copy
import pathlib

import held_job_negative_comparator as held
import managed_job_observation as managed
import process_observation_envelope as envelope
from managed_job_observation import FIELDS
from preservation_checks import require


SCOPE = ('owned negative-job consistency over a supplied managed-job observation; sampled, not continuous; '
         'no live execution hold, eligibility or admission')


def compare_observed_jobs(records, value):
    """Records must already have passed the unchanged frozen checkpoint verifier."""
    checked = managed.valid_observation(value, records)
    result = {'scope': SCOPE, 'observation_sha256': envelope.fingerprint(value),
              **{key: copy.deepcopy(checked[key]) for key in
                 ('binding', 'source', 'sample_labels', 'coverage', 'budget')},
              'boot': {name: checked['stages'][name] for name in ('boot_start', 'boot_end')},
              'phase': 'observation', 'outcome': 'refused',
              'observation_reasons': copy.deepcopy(checked['reasons']), 'negative': None,
              'admission': False, 'history_certified': False, 'hold_certified': False}
    if checked['outcome'] != 'recorded':
        return result
    result['phase'] = 'negative'
    result['negative'] = held.compare_held_jobs(records, checked['stages']['sweep_a'])
    if result['negative']['outcome'] == 'held-jobs-negative-consistent':
        result['outcome'] = 'managed-jobs-negative-consistent'
    return result


def inspect_owned(root, *, fixture=False, scripted=False):
    require(fixture and scripted, 'managed-job negative diagnostic requires --fixture and --scripted; no live CLI')
    records, verified = managed.owned_records(root, fixture=fixture)
    value = envelope.read_private(pathlib.Path(root) / 'managed-jobs.json')
    envelope.keys(value, FIELDS)
    value = copy.deepcopy(value)
    value['sample_labels'] = {'source': value['source'], 'coverage': copy.deepcopy(value['coverage'])}
    value['source'] = 'scripted'
    result = compare_observed_jobs(records, value)
    require(result['binding']['checkpoint_sha256'] == verified, 'managed-job negative verified digest differs')
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
    return 0 if result['outcome'] == 'managed-jobs-negative-consistent' else 2


if __name__ == '__main__':
    raise SystemExit(main())
