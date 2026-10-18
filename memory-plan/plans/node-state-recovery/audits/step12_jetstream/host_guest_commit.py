#!/usr/bin/env python3
"""Pin one guest store observation while its disposable VM is still running."""

import datetime
import fcntl
import hashlib
import json
import os
import pathlib
import re
import stat
import sys
import uuid

from host_vm_preflight import preflight, require, write_record
from preservation_journal import (CAPTURE_EVENT, CAPTURE_KEYS, CAPTURE_SCOPE,
                                  encoded as journal_encoded, verify_capture_checkpoint)


ROLES = {'standalone', 'member1', 'member2', 'member3'}
SCOPE = 'guest manifest committed while the host observed the VM running'
CHECKPOINT_SCOPE = 'guest capture-ready checkpoint digest committed while the host observed the VM running'
CHECKPOINT_KEYS = {'scope', 'at_utc', 'capture_nonce', 'commit_sha256', 'ack_sha256',
                   'manifest_sha256', 'journal_head', 'checkpoint_sha256', 'started_sample'}
HEX = re.compile(r'[0-9a-f]{64}')
# CAPTURE.json field -> the commitment file whose exact bytes it pins.
CAPTURE_PINS = {'guest_commit_sha256': 'COMMITTED.json', 'guest_ack_sha256': 'ACKED.json',
                'guest_checkpoint_sha256': 'CHECKPOINT.json'}


def private_bytes(path):
    require(os.path.lexists(path), 'guest commitment input is missing: ' + str(path))
    info = path.lstat()
    require(stat.S_ISREG(info.st_mode) and info.st_uid == os.getuid()
            and info.st_nlink == 1 and stat.S_IMODE(info.st_mode) == 0o600,
            'guest commitment input is not owner-private: ' + str(path))
    return path.read_bytes()


def encoded(value):
    return (json.dumps(value, sort_keys=True, separators=(',', ':')) + '\n').encode()


def require_committed(capture_dir):
    """The host's commitment: arm, manifest, post-commit sample and the separate checkpoint digest.

    This is the only source of the checkpoint digest the frozen verifier may use.
    """
    capture_dir = pathlib.Path(capture_dir)
    committed, committed_bytes, ack_bytes = require_acked(capture_dir)
    checkpoint = json.loads(private_bytes(capture_dir / 'CHECKPOINT.json'))
    ack = json.loads(ack_bytes)
    sample = checkpoint.get('started_sample') if isinstance(checkpoint, dict) else None
    require(isinstance(checkpoint, dict) and set(checkpoint) == CHECKPOINT_KEYS
            and checkpoint['scope'] == CHECKPOINT_SCOPE
            and checkpoint['capture_nonce'] == committed['capture_nonce']
            and checkpoint['commit_sha256'] == hashlib.sha256(committed_bytes).hexdigest()
            and checkpoint['ack_sha256'] == hashlib.sha256(ack_bytes).hexdigest()
            and checkpoint['manifest_sha256'] == committed['manifest_sha256']
            and checkpoint['journal_head'] == committed['manifest']['journal_head']
            and isinstance(checkpoint['checkpoint_sha256'], str)
            and HEX.fullmatch(checkpoint['checkpoint_sha256'])
            and same_running_vm(sample, ack['started_sample']),
            'capture checkpoint digest is not committed to this guest manifest')
    return {**committed, 'checkpoint': checkpoint}


def same_running_vm(sample, reference):
    return (isinstance(sample, dict) and sample.get('state') == 'started'
            and sample.get('holders_consistent') is True
            and sample.get('image_holders') == reference['image_holders']
            and all(sample.get(key) == reference[key] for key in
                    ('vm_uuid', 'host_boot_session', 'image_device', 'image_inode',
                     'image_size', 'vmstate')))


def require_acked(capture_dir):
    capture_dir = pathlib.Path(capture_dir)
    armed_bytes = private_bytes(capture_dir / 'ARMED.json')
    armed = json.loads(armed_bytes)
    committed_bytes = private_bytes(capture_dir / 'COMMITTED.json')
    committed = json.loads(committed_bytes)
    ack_bytes = private_bytes(capture_dir / 'ACKED.json')
    ack = json.loads(ack_bytes)
    nonce = armed.get('capture_nonce')
    manifest = committed.get('manifest')
    require(isinstance(nonce, str) and re.fullmatch(r'[0-9a-f]{64}', nonce)
            and set(committed) == {'scope', 'at_utc', 'capture_nonce', 'arm_sha256',
                                   'manifest_sha256', 'manifest', 'started_sample'}
            and committed['scope'] == SCOPE
            and committed['arm_sha256'] == hashlib.sha256(armed_bytes).hexdigest()
            and committed['capture_nonce'] == nonce
            and isinstance(manifest, dict) and manifest.get('capture_nonce') == nonce
            and isinstance(manifest.get('journal_head'), str) and HEX.fullmatch(manifest['journal_head'])
            and committed['manifest_sha256'] == hashlib.sha256(encoded(manifest)).hexdigest(),
            'guest manifest is not committed to this host arm')
    sample = committed['started_sample']
    require(isinstance(sample, dict) and sample.get('state') == 'started'
            and sample.get('holders_consistent') is True
            and len(sample.get('image_holders', [])) == 1
            and sample.get('vm_uuid') == armed.get('vm_uuid')
            and sample.get('host_boot_session') == armed.get('host_boot_session')
            and (sample.get('image_device'), sample.get('image_inode')) ==
            (armed.get('image_device'), armed.get('image_inode')),
            'guest commitment lacks a matching started host sample')
    after = ack.get('started_sample')
    require(set(ack) == {'scope', 'at_utc', 'commit_sha256', 'manifest_sha256',
                         'started_sample'}
            and ack['scope'] == 'host sampled VM started after guest manifest commitment'
            and ack['commit_sha256'] == hashlib.sha256(committed_bytes).hexdigest()
            and ack['manifest_sha256'] == committed['manifest_sha256']
            and isinstance(after, dict) and after.get('state') == 'started'
            and after.get('holders_consistent') is True
            and after.get('image_holders') == sample['image_holders']
            and after.get('vm_uuid') == sample['vm_uuid']
            and after.get('host_boot_session') == sample['host_boot_session']
            and (after.get('image_device'), after.get('image_inode'),
                 after.get('image_size'), after.get('vmstate')) ==
            (sample.get('image_device'), sample.get('image_inode'),
             sample.get('image_size'), sample.get('vmstate')),
            'guest manifest lacks a matching post-commit host sample')
    return committed, committed_bytes, ack_bytes


def commit(host_spec, store_spec, capture_dir, guest_manifest):
    os.umask(0o077)
    host_spec = pathlib.Path(host_spec)
    store_spec = pathlib.Path(store_spec)
    capture_dir = pathlib.Path(capture_dir)
    guest_manifest = pathlib.Path(guest_manifest)
    require(capture_dir.resolve() == capture_dir and capture_dir.stat().st_uid == os.getuid()
            and stat.S_IMODE(capture_dir.stat().st_mode) == 0o700,
            'capture directory is not owner-private')
    with (capture_dir / 'ARMED.json').open('rb') as armed_file:
        fcntl.flock(armed_file, fcntl.LOCK_EX)
        armed_bytes = private_bytes(capture_dir / 'ARMED.json')
        armed = json.loads(armed_bytes)
        require(armed.get('scope') ==
                'waiting for external guest shutdown; no stop request issued'
                and isinstance(armed.get('capture_nonce'), str)
                and re.fullmatch(r'[0-9a-f]{64}', armed['capture_nonce']),
                'host capture is not armed with a nonce')
        require(not any(os.path.lexists(capture_dir / name) for name in
                        ('COMMITTED.json', 'ACKED.json', 'GUARD_INTENT.json', 'GUARD.json',
                         'FAILED.json', 'CAPTURE.json')),
                'capture has already committed or ended')
        with (capture_dir / 'CAPTURE_ACTIVE.lock').open('rb') as active:
            try:
                fcntl.flock(active, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError:
                pass
            else:
                raise RuntimeError('capture worker is no longer active')
        raw = private_bytes(guest_manifest)
        manifest = json.loads(raw)
        spec_raw = private_bytes(store_spec)
        spec = json.loads(spec_raw)
        require(raw == encoded(manifest)
                and set(manifest) == {'scope', 'at_utc', 'capture_nonce', 'journal_head',
                                      'data_volume_uuid', 'spec_sha256', 'stores',
                                      'store_paths', 'store_relative_paths'}
                and isinstance(manifest['journal_head'], str) and HEX.fullmatch(manifest['journal_head'])
                and manifest['scope'] ==
                'guest stopped-tree content observation; writer exclusion external'
                and manifest.get('capture_nonce') == armed['capture_nonce']
                and manifest.get('spec_sha256') == hashlib.sha256(spec_raw).hexdigest()
                and manifest.get('data_volume_uuid') == spec.get('data_volume_uuid')
                and isinstance(spec.get('stores'), list)
                and len(spec['stores']) == 4
                and {row['role'] for row in spec['stores']} == ROLES
                and isinstance(manifest.get('stores'), dict)
                and set(manifest['stores']) == ROLES
                and all(isinstance(rows, list) and rows for rows in
                        manifest['stores'].values())
                and isinstance(manifest.get('store_paths'), dict)
                and set(manifest['store_paths']) == ROLES
                and len(set(manifest['store_paths'].values())) == 4
                and all(isinstance(path, str) and pathlib.Path(path).is_absolute()
                        for path in manifest['store_paths'].values())
                and manifest.get('store_relative_paths') ==
                {row['role']: row['relative_path'] for row in spec['stores']},
                'guest manifest does not bind this arm and four-store specification')
        before = json.loads(private_bytes(capture_dir / 'before-shutdown' / 'preflight.json'))
        sample = preflight(host_spec, capture_dir / ('commit-preflight-' + uuid.uuid4().hex))
        require(sample['state'] == 'started' and sample['holders_consistent']
                and len(sample['image_holders']) == 1
                and sample['vm_uuid'] == armed['vm_uuid'] == before['vm_uuid']
                and sample['host_boot_session'] == armed['host_boot_session'] ==
                before['host_boot_session']
                and (sample['image_device'], sample['image_inode'], sample['image_size']) ==
                (before['image_device'], before['image_inode'], before['image_size'])
                and sample['vmstate'] == before['vmstate'],
                'guest commitment did not observe the original running VM')
        require(private_bytes(guest_manifest) == raw,
                'guest manifest changed during host commitment')
        result = {'scope': SCOPE,
                  'at_utc': datetime.datetime.now(datetime.timezone.utc).isoformat(),
                  'capture_nonce': armed['capture_nonce'],
                  'arm_sha256': hashlib.sha256(armed_bytes).hexdigest(),
                  'manifest_sha256': hashlib.sha256(raw).hexdigest(),
                  'manifest': manifest, 'started_sample': sample}
        write_record(capture_dir / 'COMMITTED.json', result)
        after = preflight(host_spec, capture_dir / 'commit-ack-preflight',
                          allow_transition=True)
        require(after['state'] == 'started' and after['holders_consistent']
                and after['image_holders'] == sample['image_holders']
                and after['vm_uuid'] == sample['vm_uuid']
                and after['host_boot_session'] == sample['host_boot_session']
                and (after['image_device'], after['image_inode'],
                     after['image_size'], after['vmstate']) ==
                (sample['image_device'], sample['image_inode'],
                 sample['image_size'], sample['vmstate']),
                'VM stopped, holder or source changed before post-commit host sample')
        write_record(capture_dir / 'ACKED.json', {
            'scope': 'host sampled VM started after guest manifest commitment',
            'at_utc': datetime.datetime.now(datetime.timezone.utc).isoformat(),
            'commit_sha256': hashlib.sha256(
                private_bytes(capture_dir / 'COMMITTED.json')).hexdigest(),
            'manifest_sha256': result['manifest_sha256'], 'started_sample': after,
        })
        return require_acked(capture_dir)[0]


def commit_checkpoint(host_spec, capture_dir, guest_checkpoint):
    """Commit the guest's terminal capture-ready record digest while the VM still runs.

    The record must be the exact journal file bytes and bind this arm, the committed manifest and
    its journal head. Only its digest is committed: the record's cohort is rechecked later from
    the journal extracted out of the stopped image.
    """
    os.umask(0o077)
    host_spec = pathlib.Path(host_spec)
    capture_dir = pathlib.Path(capture_dir)
    guest_checkpoint = pathlib.Path(guest_checkpoint)
    require(capture_dir.resolve() == capture_dir and capture_dir.stat().st_uid == os.getuid()
            and stat.S_IMODE(capture_dir.stat().st_mode) == 0o700,
            'capture directory is not owner-private')
    with (capture_dir / 'ARMED.json').open('rb') as armed_file:
        fcntl.flock(armed_file, fcntl.LOCK_EX)
        require(not any(os.path.lexists(capture_dir / name) for name in
                        ('CHECKPOINT.json', 'GUARD_INTENT.json', 'GUARD.json', 'FAILED.json',
                         'CAPTURE.json')),
                'capture checkpoint is already committed or the capture has ended')
        with (capture_dir / 'CAPTURE_ACTIVE.lock').open('rb') as active:
            try:
                fcntl.flock(active, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError:
                pass
            else:
                raise RuntimeError('capture worker is no longer active')
        committed, committed_bytes, ack_bytes = require_acked(capture_dir)
        raw = private_bytes(guest_checkpoint)
        try:
            record = json.loads(raw)
            body = {key: value for key, value in record.items() if key != 'sha256'}
            intact = (raw == journal_encoded(record)
                      and record.get('sha256') == hashlib.sha256(journal_encoded(body)).hexdigest())
        except (AttributeError, TypeError, ValueError):
            intact = False
        require(intact and set(record) == CAPTURE_KEYS and record['event'] == CAPTURE_EVENT
                and record['scope'] == CAPTURE_SCOPE,
                'guest checkpoint is not an intact capture-ready journal record')
        head = committed['manifest']['journal_head']
        require(record['capture_nonce'] == committed['capture_nonce']
                and record['arm_sha256'] == committed['arm_sha256']
                and record['manifest_sha256'] == committed['manifest_sha256']
                and record['pre_head'] == record['previous'] == head,
                'guest checkpoint does not bind this arm, committed manifest and journal head')
        sample = preflight(host_spec, capture_dir / ('checkpoint-preflight-' + uuid.uuid4().hex))
        require(same_running_vm(sample, json.loads(ack_bytes)['started_sample']),
                'checkpoint commitment did not observe the original running VM')
        require(private_bytes(guest_checkpoint) == raw,
                'guest checkpoint changed during host commitment')
        write_record(capture_dir / 'CHECKPOINT.json', {
            'scope': CHECKPOINT_SCOPE,
            'at_utc': datetime.datetime.now(datetime.timezone.utc).isoformat(),
            'capture_nonce': committed['capture_nonce'],
            'commit_sha256': hashlib.sha256(committed_bytes).hexdigest(),
            'ack_sha256': hashlib.sha256(ack_bytes).hexdigest(),
            'manifest_sha256': committed['manifest_sha256'], 'journal_head': head,
            'checkpoint_sha256': record['sha256'], 'started_sample': sample})
        return require_committed(capture_dir)


def require_captured(capture_dir):
    """The exact commitment bytes the published CAPTURE.json pins; refuses any unpinned file."""
    capture_dir = pathlib.Path(capture_dir)
    capture = json.loads(private_bytes(capture_dir / 'CAPTURE.json'))
    pinned = {name: private_bytes(capture_dir / name) for name in CAPTURE_PINS.values()}
    require(isinstance(capture, dict)
            and all(capture.get(key) == hashlib.sha256(pinned[name]).hexdigest()
                    for key, name in CAPTURE_PINS.items()),
            'capture record does not pin this checkpoint commitment')
    return pinned


def verify_frozen_checkpoint(capture_dir, records, *, table, configs, binary, home):
    """Verify a journal extracted from the stopped image against the host's own commitment only.

    The CAPTURE.json pins are required before require_committed() provenance is consumed, and
    that provenance must be the pinned bytes, not a file swapped in between the two reads.
    """
    pinned = require_captured(capture_dir)
    commitment = require_committed(capture_dir)
    require(commitment == {**json.loads(pinned['COMMITTED.json']),
                           'checkpoint': json.loads(pinned['CHECKPOINT.json'])},
            'capture commitment differs from the pinned capture record')
    return verify_capture_checkpoint(records, commitment,
                                     table=table, configs=configs, binary=binary, home=home)


if __name__ == '__main__':
    require(len(sys.argv) == 5,
            'usage: host_guest_commit.py HOST_SPEC STORE_SPEC CAPTURE_DIR GUEST_MANIFEST'
            ' | checkpoint HOST_SPEC CAPTURE_DIR GUEST_CHECKPOINT')
    if sys.argv[1] == 'checkpoint':
        commit_checkpoint(*sys.argv[2:])
    else:
        commit(*sys.argv[1:])
