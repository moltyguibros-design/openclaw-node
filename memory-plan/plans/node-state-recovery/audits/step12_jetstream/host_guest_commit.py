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


ROLES = {'standalone', 'member1', 'member2', 'member3'}
SCOPE = 'guest manifest committed while the host observed the VM running'


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
    capture_dir = pathlib.Path(capture_dir)
    armed_bytes = private_bytes(capture_dir / 'ARMED.json')
    armed = json.loads(armed_bytes)
    committed_bytes = private_bytes(capture_dir / 'COMMITTED.json')
    committed = json.loads(committed_bytes)
    ack = json.loads(private_bytes(capture_dir / 'ACKED.json'))
    nonce = armed.get('capture_nonce')
    manifest = committed.get('manifest')
    require(isinstance(nonce, str) and re.fullmatch(r'[0-9a-f]{64}', nonce)
            and set(committed) == {'scope', 'at_utc', 'capture_nonce', 'arm_sha256',
                                   'manifest_sha256', 'manifest', 'started_sample'}
            and committed['scope'] == SCOPE
            and committed['arm_sha256'] == hashlib.sha256(armed_bytes).hexdigest()
            and committed['capture_nonce'] == nonce
            and isinstance(manifest, dict) and manifest.get('capture_nonce') == nonce
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
            and ack['scope'] == 'guest manifest acknowledged while VM remained started'
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
            'guest manifest lacks a post-commit started acknowledgement')
    return committed


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
                and set(manifest) == {'scope', 'at_utc', 'capture_nonce',
                                      'data_volume_uuid', 'spec_sha256', 'stores',
                                      'store_paths', 'store_relative_paths'}
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
                'VM stopped, holder or source changed before guest acknowledgement')
        write_record(capture_dir / 'ACKED.json', {
            'scope': 'guest manifest acknowledged while VM remained started',
            'at_utc': datetime.datetime.now(datetime.timezone.utc).isoformat(),
            'commit_sha256': hashlib.sha256(
                private_bytes(capture_dir / 'COMMITTED.json')).hexdigest(),
            'manifest_sha256': result['manifest_sha256'], 'started_sample': after,
        })
        return require_committed(capture_dir)


if __name__ == '__main__':
    require(len(sys.argv) == 5,
            'usage: host_guest_commit.py HOST_SPEC STORE_SPEC CAPTURE_DIR GUEST_MANIFEST')
    commit(*sys.argv[1:])
