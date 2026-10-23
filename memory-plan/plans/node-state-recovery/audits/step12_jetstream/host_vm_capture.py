#!/usr/bin/env python3
"""Capture store trees after an externally initiated clean VM shutdown.

This worker does not stop or restart the VM and does not accept cold masters.
"""

import datetime
import ctypes
import fcntl
import hashlib
import json
import os
import pathlib
import secrets
import shutil
import stat
import sys
import time

from host_asif_extract import extract
from host_guest_commit import CAPTURE_PINS, bind_window_pins, private_bytes, require_committed, require_window_pins
from host_image_immutable import change_immutable
from host_vm_preflight import owned_directory, preflight, require, write_record

HOST_SPEC_FIELDS = {'package', 'name', 'uuid', 'image_name', 'config_sha256',
                    'utmctl', 'utmctl_sha256'}
FIXTURE_UUID = '00000000-0000-0000-0000-000000000002'
CAPTURE_SCOPE = ('guarded stopped-state image extraction; completed capture requires '
                 'verified acceptance or explicit abort before source release')


def file_hash(path):
    h = hashlib.sha256()
    with open(path, 'rb') as source:
        for block in iter(lambda: source.read(1024 * 1024), b''):
            h.update(block)
    return h.hexdigest()


def pinned_spec(path, expected, with_digest=False):
    info = path.lstat()
    require(stat.S_ISREG(info.st_mode) and info.st_uid == os.getuid()
            and info.st_nlink == 1 and stat.S_IMODE(info.st_mode) == 0o600,
            'capture specification is not owner-private')
    contents = path.read_bytes()
    value = json.loads(contents)
    require(set(value) == expected, 'capture specification shape differs')
    return (value, hashlib.sha256(contents).hexdigest()) if with_digest else value


def fsync_parent(path):
    fd = os.open(path, os.O_RDONLY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def publish_capture_record(output, result):
    temporary = output / 'CAPTURE.json.tmp'
    write_record(temporary, result)
    os.replace(temporary, output / 'CAPTURE.json')
    fsync_parent(output)


def publish_pinned_capture(output, result, stopped_checkpoint, *, window_pins_source):
    """Publish CAPTURE.json pinning the exact COMMITTED, ACKED and CHECKPOINT bytes.

    commit_checkpoint() needs a running VM, so only the checkpoint commitment first seen once the
    VM stopped may be pinned; host_match and the frozen verifier consume it through these pins.
    """
    with (output / 'ARMED.json').open('rb') as armed:
        fcntl.flock(armed, fcntl.LOCK_EX)
        pinned = {key: private_bytes(output / name) for key, name in CAPTURE_PINS.items()}
        digests = {key: hashlib.sha256(raw).hexdigest() for key, raw in pinned.items()}
        checkpoint = require_committed(output)['checkpoint']
        bind_window_pins(output, {name: pinned[key] for key, name in CAPTURE_PINS.items()})
        require(require_window_pins(window_pins_source)[1] == pinned['window_pins_sha256'],
                'window pin table changed during capture')
        # The validated checkpoint records the COMMITTED and ACKED digests, so equal digests bind
        # those pins byte for byte to what require_committed() just accepted. CHECKPOINT itself
        # must parse to that commitment and still hold the pinned bytes once it was accepted.
        require(checkpoint == json.loads(pinned['guest_checkpoint_sha256']) == stopped_checkpoint
                and (output / 'CHECKPOINT.json').read_bytes() == pinned['guest_checkpoint_sha256']
                and checkpoint['commit_sha256'] == digests['guest_commit_sha256']
                and checkpoint['ack_sha256'] == digests['guest_ack_sha256'],
                'guest capture commitment changed after the VM stopped')
        result = {**result, **digests}
        publish_capture_record(output, result)
    return result


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
            (before['image_device'], before['image_inode'], before['image_size'])
            and after['vmstate'] == before['vmstate'])


def capture_preflight(host_spec, capture_dir, destination, **options):
    with (capture_dir / 'ARMED.json').open('rb') as armed:
        fcntl.flock(armed, fcntl.LOCK_SH)
        return preflight(host_spec, destination, **options)


def guarded_source(output, initial, observed):
    intent_path = output / 'GUARD_INTENT.json'
    receipt_path = output / 'GUARD.json'
    intent = pinned_spec(intent_path, {'scope', 'at_utc', 'vm_uuid', 'host_boot_session',
                                      'source_image', 'source_image_device',
                                      'source_image_inode', 'source_image_size'})
    receipt = pinned_spec(receipt_path, set(intent) | {'guarded_at_utc'})
    after = pinned_spec(output / 'after-guard/preflight.json',
                        {'scope', 'at_utc', 'host_boot_session', 'package', 'config_sha256',
                         'vm_uuid', 'utmctl_sha256', 'state', 'state_observed_at_utc',
                         'image', 'image_size', 'image_device', 'image_inode', 'vmstate',
                         'image_holders', 'holders_consistent', 'free_bytes'})
    identity = (initial['image_device'], initial['image_inode'], initial['image_size'])
    source_info = pathlib.Path(observed['image']).lstat()
    require(not os.path.lexists(output / 'after-guard/FAILED.json')
            and intent['scope'] == 'stopped source image guard intent; no clone or VM start'
            and receipt == {**intent, 'scope': 'stopped source image guarded; no clone or VM start',
                            'guarded_at_utc': receipt['guarded_at_utc']}
            and isinstance(receipt['guarded_at_utc'], str) and receipt['guarded_at_utc']
            and intent['vm_uuid'] == initial['vm_uuid'] == observed['vm_uuid'] == after['vm_uuid']
            and intent['host_boot_session'] == initial['host_boot_session'] == observed['host_boot_session'] == after['host_boot_session']
            and intent['source_image'] == initial['image'] == observed['image'] == after['image']
            and (intent['source_image_device'], intent['source_image_inode'],
                 intent['source_image_size']) == identity
            and after['state'] == observed['state'] == 'stopped'
            and after['holders_consistent'] and not after['image_holders']
            and observed['holders_consistent'] and not observed['image_holders']
            and same_host_image(initial, after) and same_host_image(initial, observed)
            and stat.S_ISREG(source_info.st_mode)
            and (source_info.st_dev, source_info.st_ino, source_info.st_size) == identity
            and bool(source_info.st_flags & stat.UF_IMMUTABLE),
            'completed image guard or stopped source identity differs')
    return file_hash(receipt_path)


def capture(host_spec_path, store_spec_path, window_pins_path, output, wait_seconds, fixture=False):
    os.umask(0o077)
    host_spec_path = pathlib.Path(host_spec_path)
    store_spec_path = pathlib.Path(store_spec_path)
    window_pins_path = pathlib.Path(window_pins_path)
    output = pathlib.Path(output)
    owned_directory(output.parent)
    require(not os.path.lexists(output), 'capture output already exists')
    host = pinned_spec(host_spec_path, HOST_SPEC_FIELDS)
    stores, store_spec_sha256 = pinned_spec(store_spec_path,
                                            {'data_volume_uuid', 'stores'}, with_digest=True)
    if fixture:
        require(host['uuid'] == FIXTURE_UUID
                and pathlib.Path(host['package']).parent == output.parent,
                'fixture capture must use the owned disposable VM package')
    else:
        require(output.parent == pathlib.Path.home() /
                'Library/Application Support/OpenClawRecovery',
                'production capture requires the durable host recovery directory')
        raise RuntimeError('production capture requires a verified acceptance or abort controller')
    require(isinstance(stores['stores'], list) and len(stores['stores']) == 4,
            'capture requires four store declarations')
    require(1 <= wait_seconds <= 3600, 'shutdown wait must be bounded to one hour')
    window_pins, window_pins_raw = require_window_pins(window_pins_path)
    output.mkdir(mode=0o700)
    fsync_parent(output.parent)
    active_fd = None
    try:
        active_fd = os.open(output / 'CAPTURE_ACTIVE.lock',
                            os.O_RDWR | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
        fcntl.flock(active_fd, fcntl.LOCK_EX)
        os.fsync(active_fd)
        fsync_parent(output)
        first = preflight(host_spec_path, output / 'before-shutdown')
        require(first['state'] == 'started', 'capture did not begin with a running VM')
        write_record(output / 'WINDOW_PINS.json', window_pins)
        write_record(output / 'ARMED.json', {
            'scope': 'waiting for external guest shutdown; no stop request issued',
            'at_utc': datetime.datetime.now(datetime.timezone.utc).isoformat(),
            'capture_nonce': secrets.token_hex(32),
            'vm_uuid': host['uuid'], 'host_boot_session': first['host_boot_session'],
            'image_device': first['image_device'], 'image_inode': first['image_inode'],
            'window_pins_sha256': hashlib.sha256(window_pins_raw).hexdigest(),
        })
        deadline = time.monotonic() + wait_seconds
        observation = None
        sequence = 0
        stopped_count = 0
        saw_stopped = False
        clean_stopped = False
        guard_observed = False
        stopped_checkpoint = None
        while time.monotonic() < deadline:
            observation = capture_preflight(host_spec_path, output,
                                            output / f'power-{sequence:04d}',
                                            allow_transition=True)
            require(same_host_image(first, observation),
                    'host boot, VM image or vmstate identity changed while waiting')
            if observation['state'] == 'stopped':
                saw_stopped = True
                committed = require_committed(output)
                if stopped_checkpoint is None:
                    stopped_checkpoint = committed['checkpoint']
                if observation['holders_consistent']:
                    clean_stopped = True
                    stopped_count += 1
                    if stopped_count >= 2 and os.path.lexists(output / 'GUARD.json'):
                        guard_observed = True
                        break
                else:
                    require(not clean_stopped,
                            'image holder reappeared after clean stop: '
                            + repr(observation['image_holders']))
                    stopped_count = 0
            else:
                require(not saw_stopped, 'VM restarted after a stopped observation')
                stopped_count = 0
            sequence += 1
            time.sleep(2)
        require(guard_observed and observation is not None and observation['state'] == 'stopped'
                and observation['holders_consistent'] and os.path.lexists(output / 'GUARD.json'),
                'VM did not stop with a completed image guard before the capture deadline')
        observation = capture_preflight(host_spec_path, output, output / 'before-clone')
        require(observation['state'] == 'stopped' and observation['holders_consistent']
                and same_host_image(first, observation),
                'VM restarted or source identity changed before clone')
        guard_sha = guarded_source(output, first, observation)
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
        change_immutable(clone, (clone_info.st_dev, clone_info.st_ino, clone_info.st_size), False)
        os.chmod(clone, 0o600)
        with open(clone, 'rb') as handle:
            os.fsync(handle.fileno())
        fsync_parent(output)
        after_clone = capture_preflight(host_spec_path, output, output / 'after-clone')
        require(after_clone['state'] == 'stopped' and same_host_image(first, after_clone),
                'VM restarted or host, image or vmstate identity changed during clone')
        require(guarded_source(output, first, after_clone) == guard_sha,
                'image guard changed during clone')
        require(shutil.disk_usage(output).free >= 20 * 1024 ** 3,
                'host free-space floor fell below 20 GiB after clone')
        source_sha = file_hash(source)
        clone_sha = file_hash(clone)
        require(source_sha == clone_sha, 'source and clone hashes differ')
        after_hash = capture_preflight(host_spec_path, output, output / 'after-hash')
        require(after_hash['state'] == 'stopped' and same_host_image(first, after_hash),
                'VM restarted or host, image or vmstate identity changed during image hashing')
        require(guarded_source(output, first, after_hash) == guard_sha,
                'image guard changed during hashing')
        extraction_spec = dict(stores, image_sha256=clone_sha)
        spec_out = output / 'extraction-spec.json'
        write_record(spec_out, extraction_spec)
        extracted = extract(clone, spec_out, output / 'extracted-stores')
        after_extract = capture_preflight(host_spec_path, output, output / 'after-extract')
        require(after_extract['state'] == 'stopped' and same_host_image(first, after_extract)
                and file_hash(source) == source_sha and file_hash(clone) == clone_sha,
                'VM restarted or host, image or vmstate changed during extraction')
        require(guarded_source(output, first, after_extract) == guard_sha,
                'image guard changed during extraction')
        require(shutil.disk_usage(output).free >= 20 * 1024 ** 3,
                'host free-space floor fell below 20 GiB after extraction')
        require(file_hash(store_spec_path) == store_spec_sha256,
                'store specification changed during capture')
        result = {
            'scope': CAPTURE_SCOPE,
            'at_utc': datetime.datetime.now(datetime.timezone.utc).isoformat(),
            'vm_uuid': host['uuid'], 'host_boot_session': first['host_boot_session'],
            'source_image_sha256': source_sha, 'clone_image_sha256': clone_sha,
            'guard_receipt_sha256': guard_sha,
            'source_size': first['image_size'], 'clone_size': clone_info.st_size,
            'vmstate_at_arm': first['vmstate'],
            'vmstate_at_final_check': after_extract['vmstate'],
            'data_volume_uuid': stores['data_volume_uuid'],
            'store_spec_sha256': store_spec_sha256,
            'store_relative_paths': {row['role']: row['relative_path']
                                     for row in stores['stores']},
            'extraction_manifest_sha256': file_hash(output / 'extracted-stores' / 'manifest.json'),
            'store_roles': sorted(extracted['stores']),
            'vm_state_at_final_check': 'stopped',
        }
        return publish_pinned_capture(output, result, stopped_checkpoint,
                                      window_pins_source=window_pins_path)
    except Exception as error:
        if os.path.lexists(output / 'ARMED.json'):
            with (output / 'ARMED.json').open('rb') as armed:
                fcntl.flock(armed, fcntl.LOCK_EX)
                write_record(output / 'FAILED.json', {'error': str(error)})
        else:
            write_record(output / 'FAILED.json', {'error': str(error)})
        raise
    finally:
        if active_fd is not None:
            os.close(active_fd)


if __name__ == '__main__':
    require(len(sys.argv) in (6, 7),
            'usage: host_vm_capture.py HOST_SPEC STORE_SPEC WINDOW_PINS OUTPUT WAIT_SECONDS [--fixture]')
    require(len(sys.argv) == 6 or sys.argv[6] == '--fixture', 'invalid capture option')
    capture(sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4], int(sys.argv[5]), len(sys.argv) == 7)
