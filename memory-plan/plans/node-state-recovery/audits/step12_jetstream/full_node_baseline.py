import pathlib
import re

from journal_hold import describe
from managed_launchd import Launchd
from preservation_checks import capture_entrypoint_inventory, require
from preservation_journal import (FULL_NODE_SCOPE, TIMER_UNITS, UNITS, Journal, static_identity,
                                  valid_entrypoint_inventory, valid_prior)


def capture_full_node_prior(gate, approved):
    require(isinstance(approved, dict) and set(approved) == UNITS,
            'approved full-node direct-file inventory is incomplete')
    entrypoints = capture_entrypoint_inventory(UNITS)
    prior = {}
    observations = {}
    for unit in sorted(UNITS):
        label = 'ai.openclaw.' + unit
        saved = approved[unit]
        require(isinstance(saved, dict) and saved.get('class') in
                ('daemon', 'timer', 'on-demand', 'known-broken', 'held', 'unloaded')
                and isinstance(saved.get('plist'), dict)
                and set(saved['plist']) == {'path', 'sha256'}
                and isinstance(saved.get('direct_file_hashes'), dict)
                and saved['direct_file_hashes'],
                'approved direct-file record is incomplete: ' + unit)
        installed = entrypoints['installed'].get(label)
        require(installed == saved['plist'], 'installed plist differs from approved record: ' + unit)
        expected = {}
        for name, digest in saved['direct_file_hashes'].items():
            require(isinstance(name, str) and pathlib.Path(name).is_absolute()
                    and isinstance(digest, str) and re.fullmatch(r'[0-9a-f]{64}', digest),
                    'approved direct-file pin is invalid: ' + unit)
            canonical = str(pathlib.Path(name).resolve(strict=True))
            require(canonical not in expected, 'approved direct-file paths alias: ' + unit)
            expected[canonical] = digest
        identity = static_identity(installed['path'], expected)
        plist = str(pathlib.Path(installed['path']).resolve(strict=True))
        require(identity['plist_sha256'] == installed['sha256']
                and {name: digest for name, digest in identity['files'].items() if name != plist}
                == expected,
                'approved direct files differ from installed job: ' + unit)
        service = Launchd(label, installed['path'])
        status = service.status()
        disabled = service.disabled()
        observations[unit] = (service, status, disabled, installed['path'], tuple(expected))
        prior[unit] = {'class': saved['class'], 'loaded': status['loaded'],
                       'running': status['running'], 'disabled': disabled,
                       'identity': identity}
    prior['scheduler-heartbeat']['execution_hold'] = describe(gate, sorted(TIMER_UNITS))
    valid_prior(prior, FULL_NODE_SCOPE)
    valid_entrypoint_inventory(entrypoints, prior)
    require(capture_entrypoint_inventory(UNITS) == entrypoints,
            'full-node entrypoint inventory changed during baseline')
    for unit, (service, status, disabled, plist, files) in observations.items():
        require(service.status() == status and service.disabled() == disabled,
                'full-node service changed during baseline: ' + unit)
        require(static_identity(plist, files) == prior[unit]['identity'],
                'full-node direct files changed during baseline: ' + unit)
    return prior, entrypoints


def open_full_node_journal(root, gate, approved, *, boot=None, node_lock=None):
    prior, entrypoints = capture_full_node_prior(gate, approved)
    return Journal(root, prior, boot=boot, node_lock=node_lock, scope=FULL_NODE_SCOPE,
                   expected_entrypoints=entrypoints)
