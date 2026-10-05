#!/usr/bin/env python3
"""Guard a stopped UTM image for one pinned capture; never stop or start UTM."""

import datetime
import fcntl
import os
import pathlib
import stat
import sys
import uuid

from host_clone_dispose import private_record
from host_image_immutable import change_immutable
from host_vm_capture import FIXTURE_UUID, HOST_SPEC_FIELDS, fsync_parent, pinned_spec
from host_vm_preflight import owned_directory, preflight, require, write_record


GUARD_SCOPE = 'stopped source image guard intent; no clone or VM start'


def publish_guard_intent(capture_dir, intent):
    receipt = capture_dir / 'GUARD_INTENT.json'
    temporary = capture_dir / ('GUARD_INTENT.json.tmp.' + uuid.uuid4().hex)
    with (capture_dir / 'ARMED.json').open('rb') as armed:
        fcntl.flock(armed, fcntl.LOCK_EX)
        require(not os.path.lexists(receipt), 'guard intent already exists')
        require(not any(os.path.lexists(capture_dir / name) for name in
                        ('FAILED.json', 'CAPTURE.json')),
                'capture attempt already ended')
        write_record(temporary, intent)
        os.replace(temporary, receipt)
        fsync_parent(capture_dir)


def guard(host_spec, capture_dir, fixture=False):
    os.umask(0o077)
    capture_dir = pathlib.Path(capture_dir)
    owned_directory(capture_dir.parent)
    owned_directory(capture_dir)
    if fixture:
        host = pinned_spec(pathlib.Path(host_spec), HOST_SPEC_FIELDS)
        require(capture_dir.parent.name.startswith(('openclaw-host-reconcile-',
                                                    'openclaw-host-capture-'))
                and host['uuid'] == FIXTURE_UUID
                and pathlib.Path(host['package']).parent == capture_dir.parent,
                'fixture guard requires the owned test parent')
    else:
        require(capture_dir.parent == pathlib.Path.home() /
                'Library/Application Support/OpenClawRecovery',
                'production guard requires the durable host recovery directory')
    require(not any(os.path.lexists(capture_dir / name) for name in
                    ('GUARD_INTENT.json', 'GUARD.json', 'GUARD.json.tmp')),
            'guard artifact already exists; reconcile the prior attempt')
    require(not any(os.path.lexists(capture_dir / name) for name in
                    ('FAILED.json', 'CAPTURE.json')),
            'capture attempt already ended')
    armed = private_record(capture_dir / 'ARMED.json')
    initial = private_record(capture_dir / 'before-shutdown/preflight.json')
    require(armed['scope'] == 'waiting for external guest shutdown; no stop request issued'
            and armed['vm_uuid'] == initial['vm_uuid']
            and armed['host_boot_session'] == initial['host_boot_session']
            and (armed['image_device'], armed['image_inode']) ==
            (initial['image_device'], initial['image_inode']),
            'armed source identity differs')
    before = preflight(host_spec, capture_dir / ('before-guard-' + uuid.uuid4().hex))
    identity = (initial['image_device'], initial['image_inode'], initial['image_size'])
    require(before['state'] == 'stopped' and before['holders_consistent']
            and before['vm_uuid'] == armed['vm_uuid']
            and before['host_boot_session'] == armed['host_boot_session']
            and (before['image_device'], before['image_inode'], before['image_size']) == identity
            and before['image'] == initial['image'],
            'stopped VM or original source image differs before guard')
    source = pathlib.Path(before['image'])
    require(not bool(source.lstat().st_flags & stat.UF_IMMUTABLE),
            'source image is already immutable before guard intent')
    intent = {
        'scope': GUARD_SCOPE,
        'at_utc': datetime.datetime.now(datetime.timezone.utc).isoformat(),
        'vm_uuid': before['vm_uuid'],
        'host_boot_session': before['host_boot_session'],
        'source_image': str(source),
        'source_image_device': identity[0],
        'source_image_inode': identity[1],
        'source_image_size': identity[2],
    }
    require(not any(os.path.lexists(capture_dir / name) for name in
                    ('FAILED.json', 'CAPTURE.json')),
            'capture attempt already ended')
    publish_guard_intent(capture_dir, intent)
    change_immutable(source, identity, True)
    after = preflight(host_spec, capture_dir / 'after-guard')
    require(after['state'] == 'stopped' and after['holders_consistent']
            and after['host_boot_session'] == intent['host_boot_session']
            and after['image'] == intent['source_image']
            and (after['image_device'], after['image_inode'], after['image_size']) == identity
            and bool(source.lstat().st_flags & stat.UF_IMMUTABLE),
            'VM or source changed after image guard')
    receipt = capture_dir / 'GUARD.json'
    temporary = capture_dir / 'GUARD.json.tmp'
    write_record(temporary, {
        **intent, 'scope': 'stopped source image guarded; no clone or VM start',
        'guarded_at_utc': datetime.datetime.now(datetime.timezone.utc).isoformat(),
    })
    require(not os.path.lexists(receipt), 'guard completion receipt already exists')
    os.replace(temporary, receipt)
    fsync_parent(capture_dir)
    return intent


if __name__ == '__main__':
    require(len(sys.argv) in (3, 4),
            'usage: host_vm_guard.py HOST_SPEC CAPTURE_DIR [--fixture]')
    require(len(sys.argv) == 3 or sys.argv[3] == '--fixture', 'invalid guard option')
    guard(sys.argv[1], sys.argv[2], len(sys.argv) == 4)
