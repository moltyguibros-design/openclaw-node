#!/usr/bin/env python3
"""Remove temporary VM image clones while the source VM is stopped."""

import datetime
import json
import os
import pathlib
import plistlib
import stat
import subprocess
import sys

from host_image_immutable import change_immutable
from host_vm_capture import file_hash, fsync_parent
from host_vm_preflight import owned_directory, preflight, require, write_record


CAPTURE_SCOPE = ('sampled stopped-state image extraction; uninterrupted power-off, '
                 'clean shutdown and master acceptance external')


def private_record(path):
    info = path.lstat()
    require(stat.S_ISREG(info.st_mode) and info.st_uid == os.getuid()
            and info.st_nlink == 1 and stat.S_IMODE(info.st_mode) == 0o600,
            f'expected owner-private receipt: {path}')
    return json.loads(path.read_text())


def unattached(clone):
    holders = subprocess.run(['/usr/sbin/lsof', '-t', '--', str(clone)],
                             capture_output=True, timeout=15)
    require(holders.returncode == 1 and not holders.stdout and not holders.stderr,
            'temporary clone has an open holder')
    attached = subprocess.run(['/usr/bin/hdiutil', 'info', '-plist'],
                              capture_output=True, timeout=15)
    require(attached.returncode == 0 and not attached.stderr,
            'attached image inventory failed')
    images = plistlib.loads(attached.stdout)['images']
    require(all(pathlib.Path(row['image-path']).resolve() != clone.resolve()
                for row in images), 'temporary clone remains attached')


def dispose(host_spec, capture_dir, output, fixture=False):
    os.umask(0o077)
    host_spec = pathlib.Path(host_spec)
    capture_dir = pathlib.Path(capture_dir)
    output = pathlib.Path(output)
    owned_directory(capture_dir.parent)
    owned_directory(capture_dir)
    require(output.parent == capture_dir and not os.path.lexists(output),
            'disposal output must be new inside the capture directory')
    if fixture:
        require(capture_dir.parent.name.startswith('openclaw-host-capture-'),
                'fixture disposal requires the owned test parent')
    else:
        require(capture_dir.parent == pathlib.Path.home() /
                'Library/Application Support/OpenClawRecovery',
                'production disposal requires the durable host recovery directory')
    output.mkdir(mode=0o700)
    fsync_parent(capture_dir)
    try:
        armed = private_record(capture_dir / 'ARMED.json')
        capture = private_record(capture_dir / 'CAPTURE.json')
        clone = capture_dir / 'powered-off-image.asif'
        clone_info = clone.lstat()
        require(stat.S_ISREG(clone_info.st_mode) and clone_info.st_uid == os.getuid()
                and clone_info.st_nlink == 1 and stat.S_IMODE(clone_info.st_mode) == 0o600,
                'temporary clone identity differs')
        before = preflight(host_spec, output / 'before-dispose')
        require(before['state'] == 'stopped' and before['holders_consistent']
                and armed['vm_uuid'] == before['vm_uuid'] == capture['vm_uuid']
                and armed['host_boot_session'] == before['host_boot_session'] == capture['host_boot_session']
                and armed['image_device'] == before['image_device'] == clone_info.st_dev
                and armed['image_inode'] == before['image_inode'] != clone_info.st_ino
                and before['image_size'] == capture['source_size'] == capture['clone_size'] == clone_info.st_size
                and capture['scope'] == CAPTURE_SCOPE
                and capture['vm_state_at_final_check'] == 'stopped'
                and capture['source_image_sha256'] == capture['clone_image_sha256'],
                'stopped VM, source image, clone or capture receipt differs')
        require(file_hash(pathlib.Path(before['image'])) == capture['source_image_sha256']
                and file_hash(clone) == capture['clone_image_sha256'],
                'source or temporary clone changed since capture')
        unattached(clone)
        clone.unlink()
        fsync_parent(capture_dir)
        after = preflight(host_spec, output / 'after-dispose')
        require(after['state'] == 'stopped' and after['holders_consistent']
                and after['host_boot_session'] == before['host_boot_session']
                and (after['image_device'], after['image_inode'], after['image_size']) ==
                (before['image_device'], before['image_inode'], before['image_size'])
                and not os.path.lexists(clone),
                'VM or source image changed during clone disposal')
        result = {
            'scope': 'temporary clone removed while VM sampled stopped; no boot or master acceptance',
            'at_utc': datetime.datetime.now(datetime.timezone.utc).isoformat(),
            'vm_uuid': capture['vm_uuid'], 'host_boot_session': before['host_boot_session'],
            'capture_sha256': file_hash(capture_dir / 'CAPTURE.json'),
            'clone_image_sha256': capture['clone_image_sha256'],
            'clone_absent': True, 'vm_state_at_final_check': 'stopped',
        }
        write_record(output / 'DISPOSE.json', result)
        return result
    except Exception as error:
        write_record(output / 'FAILED.json', {'error': str(error)})
        raise


def cleanup_failed(host_spec, capture_dir, output, fixture=False):
    os.umask(0o077)
    host_spec = pathlib.Path(host_spec)
    capture_dir = pathlib.Path(capture_dir)
    output = pathlib.Path(output)
    owned_directory(capture_dir.parent)
    owned_directory(capture_dir)
    require(output.parent == capture_dir and not os.path.lexists(output),
            'cleanup output must be new inside the failed capture directory')
    if fixture:
        require(capture_dir.parent.name.startswith('openclaw-host-capture-'),
                'fixture cleanup requires the owned test parent')
    else:
        require(capture_dir.parent == pathlib.Path.home() /
                'Library/Application Support/OpenClawRecovery',
                'production cleanup requires the durable host recovery directory')
    output.mkdir(mode=0o700)
    fsync_parent(capture_dir)
    try:
        armed = private_record(capture_dir / 'ARMED.json')
        failed = private_record(capture_dir / 'FAILED.json')
        initial = private_record(capture_dir / 'before-shutdown/preflight.json')
        require(armed['scope'] == 'waiting for external guest shutdown; no stop request issued'
                and isinstance(failed['error'], str) and failed['error']
                and not os.path.lexists(capture_dir / 'CAPTURE.json'),
                'capture is not an incomplete failed attempt')
        clone = capture_dir / 'powered-off-image.asif'
        info = clone.lstat()
        before = preflight(host_spec, output / 'before-cleanup')
        require(stat.S_ISREG(info.st_mode) and info.st_uid == os.getuid()
                and info.st_nlink == 1 and info.st_dev == before['image_device']
                and info.st_ino != before['image_inode']
                and info.st_size == before['image_size']
                and before['state'] == 'stopped' and before['holders_consistent']
                and armed['vm_uuid'] == initial['vm_uuid'] == before['vm_uuid']
                and armed['host_boot_session'] == initial['host_boot_session'] == before['host_boot_session']
                and (armed['image_device'], armed['image_inode']) ==
                (initial['image_device'], initial['image_inode']) ==
                (before['image_device'], before['image_inode'])
                and initial['image_size'] == before['image_size'],
                'failed capture, clone or stopped VM identity differs')
        unattached(clone)
        change_immutable(clone, (info.st_dev, info.st_ino, info.st_size), False)
        clone.unlink()
        fsync_parent(capture_dir)
        after = preflight(host_spec, output / 'after-cleanup')
        require(after['state'] == 'stopped' and after['holders_consistent']
                and after['host_boot_session'] == before['host_boot_session']
                and (after['image_device'], after['image_inode'], after['image_size']) ==
                (before['image_device'], before['image_inode'], before['image_size'])
                and not os.path.lexists(clone),
                'VM or source image changed during failed-clone cleanup')
        result = {
            'scope': 'failed temporary clone removed while VM sampled stopped; no boot or master acceptance',
            'at_utc': datetime.datetime.now(datetime.timezone.utc).isoformat(),
            'vm_uuid': before['vm_uuid'], 'host_boot_session': before['host_boot_session'],
            'armed_sha256': file_hash(capture_dir / 'ARMED.json'),
            'capture_failure_sha256': file_hash(capture_dir / 'FAILED.json'),
            'clone_absent': True, 'vm_state_at_final_check': 'stopped',
        }
        write_record(output / 'CLEANUP.json', result)
        return result
    except Exception as error:
        write_record(output / 'FAILED.json', {'error': str(error)})
        raise


if __name__ == '__main__':
    if len(sys.argv) in (5, 6) and sys.argv[1] == 'cleanup-failed':
        require(len(sys.argv) == 5 or sys.argv[5] == '--fixture', 'invalid cleanup option')
        cleanup_failed(sys.argv[2], sys.argv[3], sys.argv[4], len(sys.argv) == 6)
    else:
        require(len(sys.argv) in (4, 5),
                'usage: host_clone_dispose.py HOST_SPEC CAPTURE_DIR NEW_OUTPUT [--fixture]')
        require(len(sys.argv) == 4 or sys.argv[4] == '--fixture', 'invalid disposal option')
        dispose(sys.argv[1], sys.argv[2], sys.argv[3], len(sys.argv) == 5)
