#!/usr/bin/env python3
"""Capture store trees after an externally initiated clean VM shutdown.

This worker does not stop or restart the VM and does not accept cold masters.
"""

import datetime
import ctypes
import hashlib
import json
import os
import pathlib
import shutil
import stat
import sys
import time

from host_asif_extract import extract
from host_vm_preflight import owned_directory, preflight, require, write_record


def file_hash(path):
    h = hashlib.sha256()
    with open(path, 'rb') as source:
        for block in iter(lambda: source.read(1024 * 1024), b''):
            h.update(block)
    return h.hexdigest()


def pinned_spec(path, expected):
    info = path.lstat()
    require(stat.S_ISREG(info.st_mode) and info.st_uid == os.getuid()
            and info.st_nlink == 1 and stat.S_IMODE(info.st_mode) == 0o600,
            'capture specification is not owner-private')
    value = json.loads(path.read_text())
    require(set(value) == expected, 'capture specification shape differs')
    return value


def fsync_parent(path):
    fd = os.open(path, os.O_RDONLY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def clone_only(source, target):
    library = ctypes.CDLL(None, use_errno=True)
    function = library.clonefile
    function.argtypes = [ctypes.c_char_p, ctypes.c_char_p, ctypes.c_int]
    function.restype = ctypes.c_int
    result = function(os.fsencode(source), os.fsencode(target), 0)
    if result != 0:
        code = ctypes.get_errno()
        raise OSError(code, os.strerror(code), str(target))


def same_host_image(before, after):
    return (after['host_boot_session'] == before['host_boot_session']
            and (after['image_device'], after['image_inode'], after['image_size']) ==
            (before['image_device'], before['image_inode'], before['image_size']))


def capture(host_spec_path, store_spec_path, output, wait_seconds):
    os.umask(0o077)
    host_spec_path = pathlib.Path(host_spec_path)
    store_spec_path = pathlib.Path(store_spec_path)
    output = pathlib.Path(output)
    owned_directory(output.parent)
    require(not os.path.lexists(output), 'capture output already exists')
    host = pinned_spec(host_spec_path, {'package', 'name', 'uuid', 'image_name',
                                          'config_sha256', 'utmctl', 'utmctl_sha256'})
    stores = pinned_spec(store_spec_path, {'data_volume_uuid', 'stores'})
    require(isinstance(stores['stores'], list) and len(stores['stores']) == 4,
            'capture requires four store declarations')
    require(1 <= wait_seconds <= 3600, 'shutdown wait must be bounded to one hour')
    output.mkdir(mode=0o700)
    fsync_parent(output.parent)
    try:
        first = preflight(host_spec_path, output / 'before-shutdown')
        require(first['state'] == 'started', 'capture did not begin with a running VM')
        write_record(output / 'ARMED.json', {
            'scope': 'waiting for external guest shutdown; no stop request issued',
            'at_utc': datetime.datetime.now(datetime.timezone.utc).isoformat(),
            'vm_uuid': host['uuid'], 'host_boot_session': first['host_boot_session'],
            'image_device': first['image_device'], 'image_inode': first['image_inode'],
        })
        deadline = time.monotonic() + wait_seconds
        observation = None
        sequence = 0
        stopped_count = 0
        while time.monotonic() < deadline:
            observation = preflight(host_spec_path, output / f'power-{sequence:04d}',
                                    allow_transition=True)
            require(same_host_image(first, observation),
                    'host boot or VM image identity changed while waiting')
            if observation['state'] == 'stopped' and observation['holders_consistent']:
                stopped_count += 1
                if stopped_count == 2:
                    break
            else:
                stopped_count = 0
            sequence += 1
            time.sleep(2)
        require(observation is not None and observation['state'] == 'stopped'
                and observation['holders_consistent'],
                'VM did not stop before the capture deadline')
        require(shutil.disk_usage(output).free >= 20 * 1024 ** 3,
                'host free-space floor is below 20 GiB')
        source = pathlib.Path(observation['image'])
        clone = output / 'powered-off-image.asif'
        clone_only(source, clone)
        clone_info = clone.lstat()
        require(stat.S_ISREG(clone_info.st_mode) and clone_info.st_uid == os.getuid()
                and clone_info.st_nlink == 1 and clone_info.st_dev == observation['image_device']
                and clone_info.st_size == observation['image_size'],
                'cloned image shape, owner or volume differs')
        os.chmod(clone, 0o600)
        with open(clone, 'rb') as handle:
            os.fsync(handle.fileno())
        fsync_parent(output)
        after_clone = preflight(host_spec_path, output / 'after-clone')
        require(after_clone['state'] == 'stopped' and same_host_image(first, after_clone),
                'VM restarted or host rebooted during clone')
        source_sha = file_hash(source)
        clone_sha = file_hash(clone)
        require(source_sha == clone_sha, 'source and clone hashes differ')
        after_hash = preflight(host_spec_path, output / 'after-hash')
        require(after_hash['state'] == 'stopped' and same_host_image(first, after_hash),
                'VM restarted or host rebooted during image hashing')
        extraction_spec = dict(stores, image_sha256=clone_sha)
        spec_out = output / 'extraction-spec.json'
        write_record(spec_out, extraction_spec)
        extracted = extract(clone, spec_out, output / 'extracted-stores')
        after_extract = preflight(host_spec_path, output / 'after-extract')
        require(after_extract['state'] == 'stopped' and same_host_image(first, after_extract)
                and file_hash(source) == source_sha and file_hash(clone) == clone_sha,
                'VM restarted or image changed during extraction')
        result = {
            'scope': 'sampled stopped-state image extraction; uninterrupted power-off, clean shutdown and master acceptance external',
            'at_utc': datetime.datetime.now(datetime.timezone.utc).isoformat(),
            'vm_uuid': host['uuid'], 'host_boot_session': first['host_boot_session'],
            'source_image_sha256': source_sha, 'clone_image_sha256': clone_sha,
            'source_size': first['image_size'], 'clone_size': clone_info.st_size,
            'data_volume_uuid': stores['data_volume_uuid'],
            'extraction_manifest_sha256': file_hash(output / 'extracted-stores' / 'manifest.json'),
            'store_roles': sorted(extracted['stores']),
            'vm_state_at_final_check': 'stopped',
        }
        write_record(output / 'CAPTURE.json', result)
        return result
    except Exception as error:
        write_record(output / 'FAILED.json', {'error': str(error)})
        raise


if __name__ == '__main__':
    require(len(sys.argv) == 5, 'usage: host_vm_capture.py HOST_SPEC STORE_SPEC OUTPUT WAIT_SECONDS')
    capture(sys.argv[1], sys.argv[2], sys.argv[3], int(sys.argv[4]))
