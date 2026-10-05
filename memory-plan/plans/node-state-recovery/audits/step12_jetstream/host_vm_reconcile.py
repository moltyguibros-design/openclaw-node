#!/usr/bin/env python3
"""Recover a stopped source image after a guarded clone attempt; never start UTM."""

import datetime
import os
import pathlib
import stat
import sys

from host_clone_dispose import CAPTURE_SCOPE, private_record, unattached
from host_image_immutable import change_immutable
from host_vm_guard import GUARD_SCOPE
from host_vm_capture import FIXTURE_UUID, HOST_SPEC_FIELDS, file_hash, fsync_parent, pinned_spec
from host_vm_preflight import owned_directory, preflight, require, write_record


BOOTABLE_SCOPE = ('temporary clone absent and source image bootable; '
                  'no VM start or cold-master acceptance')


def prior_bootable(capture_dir, vm_uuid, identity):
    found = False
    for child in capture_dir.iterdir():
        info = child.lstat()
        require(not stat.S_ISLNK(info.st_mode), 'capture contains a symlink')
        if not stat.S_ISDIR(info.st_mode) or not os.path.lexists(child / 'BOOTABLE.json'):
            continue
        owned_directory(child)
        receipt = private_record(child / 'BOOTABLE.json')
        require(receipt['scope'] == BOOTABLE_SCOPE and receipt['vm_uuid'] == vm_uuid
                and isinstance(receipt.get('guard_completed'), bool)
                and (receipt['source_image_device'], receipt['source_image_inode'],
                     receipt['source_image_size']) == identity,
                'prior BOOTABLE receipt identifies another source')
        found = True
    return found


def no_other_clone(root, current):
    for child in root.iterdir():
        info = child.lstat()
        require(not stat.S_ISLNK(info.st_mode), 'recovery root contains a symlink')
        if stat.S_ISDIR(info.st_mode) and child != current:
            require(not os.path.lexists(child / 'powered-off-image.asif'),
                    'another temporary image clone still exists')


def reconcile(host_spec, capture_dir, output, fixture=False):
    os.umask(0o077)
    host_spec = pathlib.Path(host_spec)
    capture_dir = pathlib.Path(capture_dir)
    output = pathlib.Path(output)
    owned_directory(capture_dir.parent)
    owned_directory(capture_dir)
    require(output.parent == capture_dir and not os.path.lexists(output),
            'reconcile output must be new inside the capture directory')
    if fixture:
        host = pinned_spec(host_spec, HOST_SPEC_FIELDS)
        require(capture_dir.parent.name.startswith(('openclaw-host-reconcile-',
                                                    'openclaw-host-capture-'))
                and host['uuid'] == FIXTURE_UUID
                and pathlib.Path(host['package']).parent == capture_dir.parent,
                'fixture reconcile requires the owned test parent')
    else:
        require(capture_dir.parent == pathlib.Path.home() /
                'Library/Application Support/OpenClawRecovery',
                'production reconcile requires the durable host recovery directory')
    output.mkdir(mode=0o700)
    fsync_parent(capture_dir)
    try:
        armed = private_record(capture_dir / 'ARMED.json')
        initial = private_record(capture_dir / 'before-shutdown/preflight.json')
        require(armed['scope'] == 'waiting for external guest shutdown; no stop request issued'
                and armed['vm_uuid'] == initial['vm_uuid']
                and armed['host_boot_session'] == initial['host_boot_session']
                and (armed['image_device'], armed['image_inode']) ==
                (initial['image_device'], initial['image_inode']),
                'armed source identity differs')
        intent = private_record(capture_dir / 'GUARD_INTENT.json')
        require(intent['scope'] == GUARD_SCOPE
                and intent['vm_uuid'] == armed['vm_uuid']
                and intent['host_boot_session'] == armed['host_boot_session']
                and intent['source_image'] == initial['image']
                and (intent['source_image_device'], intent['source_image_inode'],
                     intent['source_image_size']) ==
                (initial['image_device'], initial['image_inode'], initial['image_size']),
                'guard intent does not identify this source')
        before = preflight(host_spec, output / 'before-reconcile')
        source_identity = (before['image_device'], before['image_inode'], before['image_size'])
        require(before['state'] == 'stopped' and before['holders_consistent']
                and before['vm_uuid'] == armed['vm_uuid']
                and source_identity == (initial['image_device'], initial['image_inode'],
                                        initial['image_size']),
                'stopped VM or original source image differs')
        source = pathlib.Path(before['image'])
        guarded_path = capture_dir / 'GUARD.json'
        guard_completed = False
        if os.path.lexists(guarded_path):
            guarded = private_record(guarded_path)
            require(set(guarded) == set(intent) | {'guarded_at_utc'}
                    and guarded['scope'] == 'stopped source image guarded; no clone or VM start'
                    and all(guarded.get(key) == value for key, value in intent.items()
                            if key != 'scope'),
                    'guard completion receipt differs from its intent')
            guard_completed = True
        clone = capture_dir / 'powered-off-image.asif'
        if prior_bootable(capture_dir, before['vm_uuid'], source_identity):
            require(not os.path.lexists(clone)
                    and not bool(source.lstat().st_flags & stat.UF_IMMUTABLE),
                    'source was guarded again after a BOOTABLE receipt')
        capture_path = capture_dir / 'CAPTURE.json'
        if os.path.lexists(capture_path):
            capture = private_record(capture_path)
            require(capture['scope'] == CAPTURE_SCOPE
                    and capture['vm_uuid'] == before['vm_uuid']
                    and capture['host_boot_session'] == armed['host_boot_session']
                    and capture['source_size'] == before['image_size']
                    and file_hash(source) == capture['source_image_sha256'],
                    'completed capture source image changed')
        if os.path.lexists(clone):
            info = clone.lstat()
            require(stat.S_ISREG(info.st_mode) and info.st_uid == os.getuid()
                    and info.st_nlink == 1 and info.st_dev == before['image_device']
                    and info.st_ino != before['image_inode']
                    and bool(source.lstat().st_flags & stat.UF_IMMUTABLE),
                    'temporary clone or guarded source identity differs')
            unattached(clone)
            change_immutable(clone, (info.st_dev, info.st_ino, info.st_size), False)
            clone.unlink()
            fsync_parent(capture_dir)
        no_other_clone(capture_dir.parent, capture_dir)
        after_clone = preflight(host_spec, output / 'after-clone-removal')
        require(after_clone['state'] == 'stopped' and after_clone['holders_consistent']
                and (after_clone['image_device'], after_clone['image_inode'],
                     after_clone['image_size']) == source_identity
                and not os.path.lexists(clone),
                'VM or source changed while reconciling the clone')
        change_immutable(source, source_identity, False)
        after_unlock = preflight(host_spec, output / 'after-source-unlock')
        require(after_unlock['state'] == 'stopped' and after_unlock['holders_consistent']
                and (after_unlock['image_device'], after_unlock['image_inode'],
                     after_unlock['image_size']) == source_identity
                and not os.path.lexists(clone)
                and not bool(source.lstat().st_flags & stat.UF_IMMUTABLE),
                'VM, clone or source flag changed after unlock')
        result = {
            'scope': BOOTABLE_SCOPE,
            'at_utc': datetime.datetime.now(datetime.timezone.utc).isoformat(),
            'vm_uuid': before['vm_uuid'], 'host_boot_session': before['host_boot_session'],
            'source_image_device': source_identity[0],
            'source_image_inode': source_identity[1],
            'source_image_size': source_identity[2],
            'clone_absent': True, 'source_immutable': False,
            'vm_state_at_final_check': 'stopped',
            'guard_completed': guard_completed,
            'capture_completed': os.path.lexists(capture_path),
        }
        temporary = output / 'BOOTABLE.json.tmp'
        write_record(temporary, result)
        os.replace(temporary, output / 'BOOTABLE.json')
        fsync_parent(output)
        return result
    except Exception as error:
        write_record(output / 'OPERATOR_REQUIRED.json', {
            'at_utc': datetime.datetime.now(datetime.timezone.utc).isoformat(),
            'error': str(error),
        })
        raise


if __name__ == '__main__':
    require(len(sys.argv) in (4, 5),
            'usage: host_vm_reconcile.py HOST_SPEC CAPTURE_DIR NEW_OUTPUT [--fixture]')
    require(len(sys.argv) == 4 or sys.argv[4] == '--fixture', 'invalid reconcile option')
    reconcile(sys.argv[1], sys.argv[2], sys.argv[3], len(sys.argv) == 5)
