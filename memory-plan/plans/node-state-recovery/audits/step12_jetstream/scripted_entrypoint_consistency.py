import argparse
import copy
import pathlib

import managed_job_observation as managed
import process_observation_envelope as envelope
from preservation_checks import require, valid_tailscale_exclusion
from preservation_journal import valid_entrypoint_inventory


SCOPE = ('scripted entrypoint consistency against a frozen checkpoint; supplied completed-run claims only; '
         'no fresh observation, live hold, eligibility or admission')


def terminal_expectations(records):
    expected = copy.deepcopy(records[0]['prior'])
    for unit, state in expected.items():
        state.update({key: records[-1]['observations'][unit][key] for key in ('loaded', 'running', 'disabled')})
    return expected


def compare_entrypoints(records, value):
    """Records must already have passed the unchanged frozen checkpoint verifier."""
    envelope.keys(value, ('boot', 'inventory'))
    envelope.digest(value['boot'])
    current = value['inventory']
    require(isinstance(current, dict), 'scripted entrypoint inventory is not an object')
    valid_tailscale_exclusion(current.get('excluded'))
    valid_entrypoint_inventory(current, terminal_expectations(records))
    result = {'scope': SCOPE, 'source': 'scripted', 'input_sha256': envelope.fingerprint(value),
              'binding': managed.binding(records), 'boot': value['boot'], 'reasons': [],
              'outcome': 'refused', 'hold_certified': False, 'history_certified': False,
              'admission': False, 'freshness_certified': False}
    saved = records[0]['entrypoint_inventory']
    for key in ('installed', 'roots', 'disabled_artifacts'):
        if current[key] != saved[key]:
            result['reasons'].append(key)
    for key in ('loaded', 'overrides'):
        if current[key] != records[-1]['entrypoint_' + key]:
            result['reasons'].append(key)
    excluded, original = current['excluded'], saved['excluded']
    if set(excluded) != set(original):
        result['reasons'].append('excluded.labels')
    for key in ('plist', 'wrapper', 'app'):
        if any(excluded[label][key] != original[label][key] for label in sorted(excluded.keys() & original.keys())):
            result['reasons'].append('excluded.' + key)
    if any(item['boot'] != value['boot'] for item in excluded.values()):
        result['reasons'].append('excluded.boot')
    if not result['reasons']:
        result['outcome'] = 'scripted-entrypoint-consistent'
    return result


def inspect_owned(root, *, fixture=False, scripted=False):
    require(fixture and scripted, 'entrypoint diagnostic requires --fixture and --scripted; no live CLI')
    records, verified = managed.owned_records(root, fixture=fixture)
    value = envelope.read_private(pathlib.Path(root) / 'entrypoints.json')
    result = compare_entrypoints(records, value)
    require(result['binding']['checkpoint_sha256'] == verified, 'entrypoint verified digest differs')
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
                  'history_certified': False, 'hold_certified': False, 'freshness_certified': False,
                  'error_type': type(error).__name__}
    print(envelope.encoded(result).decode())
    return 0 if result['outcome'] == 'scripted-entrypoint-consistent' else 2


if __name__ == '__main__':
    raise SystemExit(main())
