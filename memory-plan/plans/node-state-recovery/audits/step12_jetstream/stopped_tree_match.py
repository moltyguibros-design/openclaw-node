#!/usr/bin/env python3
"""Compare guest stopped-store bytes with host ASIF-extracted trees."""

import datetime
import hashlib
import json
import os
import pathlib
import plistlib
import re
import stat
import subprocess
import sys

from host_asif_extract import declared_path, private_parent, require, write_json
from host_guest_commit import bind_window_pins, private_bytes, require_committed
from host_vm_capture import CAPTURE_SCOPE


ROLES = {'standalone', 'member1', 'member2', 'member3'}


def private_file(path):
    info = path.lstat()
    require(stat.S_ISREG(info.st_mode) and info.st_uid == os.getuid()
            and info.st_nlink == 1 and stat.S_IMODE(info.st_mode) == 0o600,
            f'expected private regular file: {path}')


def sha256(path):
    digest = hashlib.sha256()
    with open(path, 'rb') as source:
        for block in iter(lambda: source.read(1024 * 1024), b''):
            digest.update(block)
    return digest.hexdigest()


def entries(root):
    require(stat.S_ISDIR(root.lstat().st_mode) and root.lstat().st_uid == os.getuid(),
            f'store root differs: {root}')
    result = []

    def visit(location, parts):
        for item in sorted(os.scandir(location), key=lambda row: row.name):
            path = pathlib.Path(item.path)
            info = path.lstat()
            relative = '/'.join(parts + (item.name,))
            require(info.st_uid == os.getuid(), f'foreign-owned store entry: {relative}')
            if stat.S_ISDIR(info.st_mode):
                result.append({'path': relative, 'type': 'directory'})
                visit(path, parts + (item.name,))
            else:
                require(stat.S_ISREG(info.st_mode) and info.st_nlink == 1,
                        f'linked or non-regular store entry: {relative}')
                result.append({'path': relative, 'type': 'file',
                               'size': info.st_size, 'sha256': sha256(path)})
    visit(root, ())
    return result


def store_spec(path):
    private_file(path)
    contents = path.read_bytes()
    value = json.loads(contents)
    require(set(value) == {'data_volume_uuid', 'stores'}
            and re.fullmatch(r'[0-9A-F-]{36}', value['data_volume_uuid'])
            and isinstance(value['stores'], list) and len(value['stores']) == 4
            and all(isinstance(row, dict) and set(row) == {'role', 'relative_path'}
                    for row in value['stores'])
            and {row['role'] for row in value['stores']} == ROLES,
            'stopped-store specification differs')
    return value, hashlib.sha256(contents).hexdigest()


def data_volume_uuid(path):
    mounted = subprocess.run(['/bin/df', '-P', str(path)], capture_output=True,
                             text=True, timeout=10, check=True).stdout.splitlines()
    require(len(mounted) == 2, 'guest store volume mount is ambiguous')
    fields = mounted[1].split(maxsplit=5)
    require(len(fields) == 6 and fields[0].startswith('/dev/'),
            'guest store is not on a disk volume')
    info = plistlib.loads(subprocess.run(['/usr/sbin/diskutil', 'info', '-plist', fields[0]],
                                        capture_output=True, timeout=10, check=True).stdout)
    require(info.get('VolumeName') == 'Data' and info.get('MountPoint') == fields[5]
            and isinstance(info.get('VolumeUUID'), str),
            'guest store is not on the observed Data volume')
    return info['VolumeUUID']


def new_output(output):
    private_parent(output.parent)
    require(not os.path.lexists(output), 'stopped-tree output exists')
    output.mkdir(mode=0o700)


def guest_capture(spec_path, output, root=pathlib.Path('/'), capture_nonce=None, journal_head=None):
    os.umask(0o077)
    spec_path = pathlib.Path(spec_path)
    output = pathlib.Path(output)
    spec, spec_sha256 = store_spec(spec_path)
    require(capture_nonce is None or isinstance(capture_nonce, str)
            and re.fullmatch(r'[0-9a-f]{64}', capture_nonce),
            'guest capture nonce is invalid')
    # The quiescent user-journal head the capture-ready checkpoint must directly follow.
    require(journal_head is None or capture_nonce is not None and isinstance(journal_head, str)
            and re.fullmatch(r'[0-9a-f]{64}', journal_head),
            'guest capture journal head is invalid or lacks a nonce')
    new_output(output)
    try:
        stores = {}
        store_paths = {}
        device = None
        first_source = None
        for row in spec['stores']:
            source = declared_path(root, row['relative_path'])
            if device is None:
                require(data_volume_uuid(source) == spec['data_volume_uuid'],
                        'guest store Data volume UUID differs from specification')
                device = source.stat().st_dev
                first_source = source
            else:
                require(source.stat().st_dev == device,
                        'guest stores span multiple volumes')
            stores[row['role']] = entries(source)
            store_paths[row['role']] = str(source.resolve(strict=True))
            require(any(item['type'] == 'file' for item in stores[row['role']]),
                    f'empty stopped store: {row["role"]}')
        require(data_volume_uuid(first_source) == spec['data_volume_uuid']
                and all(pathlib.Path(path).stat().st_dev == device for path in store_paths.values()),
                'guest store Data volume changed during capture')
        require(sha256(spec_path) == spec_sha256,
                'store specification changed during guest capture')
        result = {'scope': 'guest stopped-tree content observation; writer exclusion external',
                  'at_utc': datetime.datetime.now(datetime.timezone.utc).isoformat(),
                  'data_volume_uuid': spec['data_volume_uuid'],
                  'spec_sha256': spec_sha256, 'stores': stores,
                  'store_paths': store_paths,
                  'store_relative_paths': {row['role']: row['relative_path']
                                           for row in spec['stores']}}
        if capture_nonce is not None:
            result['capture_nonce'] = capture_nonce
        if journal_head is not None:
            result['journal_head'] = journal_head
        write_json(output / 'manifest.json', result)
        return result
    except Exception as error:
        write_json(output / 'FAILED.json', {'error': str(error)})
        raise


def normalized_extract(rows):
    return [dict(row, type='directory' if row['type'] == 'dir' else row['type'])
            for row in rows]


def freeze(root):
    info = root.lstat()
    require(stat.S_ISDIR(info.st_mode) and info.st_uid == os.getuid(),
            f'store root changed during freeze: {root}')
    for item in os.scandir(root):
        path = pathlib.Path(item.path)
        info = path.lstat()
        if stat.S_ISDIR(info.st_mode):
            freeze(path)
            os.chmod(path, 0o500)
        else:
            require(stat.S_ISREG(info.st_mode) and info.st_nlink == 1,
                    f'non-regular entry appeared during freeze: {path}')
            os.chmod(path, 0o400)
    os.chmod(root, 0o500)


def host_match(guest_path, extracted, output):
    os.umask(0o077)
    guest_path = pathlib.Path(guest_path)
    extracted = pathlib.Path(extracted)
    output = pathlib.Path(output)
    private_file(guest_path)
    private_parent(extracted)
    private_parent(extracted.parent)
    private_parent(output.parent)
    guest_bytes = guest_path.read_bytes()
    guest = json.loads(guest_bytes)
    manifest_path = extracted / 'manifest.json'
    capture_path = extracted.parent / 'CAPTURE.json'
    guard_path = extracted.parent / 'GUARD.json'
    image_path = extracted.parent / 'powered-off-image.asif'
    private_file(manifest_path)
    private_file(capture_path)
    private_file(guard_path)
    private_file(image_path)
    host_bytes = manifest_path.read_bytes()
    capture_bytes = capture_path.read_bytes()
    guard_bytes = guard_path.read_bytes()
    committed_bytes = (extracted.parent / 'COMMITTED.json').read_bytes()
    ack_bytes = (extracted.parent / 'ACKED.json').read_bytes()
    checkpoint_bytes = (extracted.parent / 'CHECKPOINT.json').read_bytes()
    window_pins_bytes = private_bytes(extracted.parent / 'WINDOW_PINS.json')
    host = json.loads(host_bytes)
    capture = json.loads(capture_bytes)
    guard = json.loads(guard_bytes)
    new_output(output)
    try:
        # The capture record's byte pins come first: the commitment is consumed only as captured.
        require(capture['scope'] == CAPTURE_SCOPE
                and capture['vm_state_at_final_check'] == 'stopped'
                and capture['source_image_sha256'] == capture['clone_image_sha256']
                and capture['guard_receipt_sha256'] == sha256(guard_path)
                and capture['guest_commit_sha256'] == hashlib.sha256(committed_bytes).hexdigest()
                and capture['guest_ack_sha256'] == hashlib.sha256(ack_bytes).hexdigest()
                and capture.get('guest_checkpoint_sha256') == hashlib.sha256(checkpoint_bytes).hexdigest()
                and capture.get('window_pins_sha256') == hashlib.sha256(window_pins_bytes).hexdigest()
                and capture['clone_image_sha256'] == host['image_sha256']
                and capture['extraction_manifest_sha256'] == sha256(manifest_path)
                and capture['data_volume_uuid'] == host['data_volume_uuid']
                and capture['store_roles'] == sorted(ROLES)
                and capture['clone_size'] == image_path.stat().st_size
                and sha256(image_path) == capture['clone_image_sha256'],
                'capture receipt, cloned image and extracted stores differ')
        bind_window_pins(extracted.parent, {'WINDOW_PINS.json': window_pins_bytes,
                                           'COMMITTED.json': committed_bytes})
        committed = require_committed(extracted.parent)
        require(committed == {**json.loads(committed_bytes),
                              'checkpoint': json.loads(checkpoint_bytes)},
                'capture commitment differs from the pinned capture record')
        require(committed['manifest_sha256'] == hashlib.sha256(guest_bytes).hexdigest()
                and committed['manifest'] == guest,
                'guest manifest differs from the running-VM commitment')
        require(guest['scope'] == 'guest stopped-tree content observation; writer exclusion external',
                'guest stopped-tree scope differs')
        require(guest['spec_sha256'] == capture['store_spec_sha256'],
                'guest store specification differs from host capture')
        require(set(guest['stores']) == ROLES and set(host['stores']) == ROLES
                and guest['data_volume_uuid'] == host['data_volume_uuid'],
                'guest and host store roles or Data volume differ')
        store_paths = guest.get('store_paths')
        require(isinstance(store_paths, dict) and set(store_paths) == ROLES
                and all(isinstance(value, str) and pathlib.Path(value).is_absolute()
                        for value in store_paths.values())
                and len(set(store_paths.values())) == 4,
                'guest store paths are absent or ambiguous')
        relative_paths = capture.get('store_relative_paths')
        require(isinstance(relative_paths, dict) and set(relative_paths) == ROLES
                and guest.get('store_relative_paths') == relative_paths,
                'guest store role paths differ from host specification')
        for role in ROLES:
            relative = pathlib.PurePosixPath(relative_paths[role]).parts
            absolute = pathlib.PurePosixPath(store_paths[role]).parts
            require(relative and len(absolute) >= len(relative)
                    and absolute[-len(relative):] == relative,
                    f'guest store role path differs: {role}')
        matched = {}
        for role in sorted(ROLES):
            root = extracted / role
            actual = entries(root)
            require(actual == guest['stores'][role]
                    and actual == normalized_extract(host['stores'][role]),
                    f'guest, extraction manifest and host tree differ: {role}')
            matched[role] = {'entries': len(actual),
                             'files': sum(row['type'] == 'file' for row in actual),
                             'bytes': sum(row.get('size', 0) for row in actual)}
        frozen_rows = {}
        for role in sorted(ROLES):
            freeze(extracted / role)
            frozen_rows[role] = entries(extracted / role)
            require(frozen_rows[role] == guest['stores'][role],
                    f'frozen host tree changed: {role}')
        masters = {}
        for role in sorted(ROLES):
            root = extracted / role
            rows = frozen_rows[role]
            masters[role] = {
                'path': str(root.resolve(strict=True)),
                'guest_path': store_paths[role],
                'sha256': hashlib.sha256(json.dumps(rows, ensure_ascii=False,
                    separators=(',', ':')).encode()).hexdigest()}
        # Bytes first, so a changed commitment file names the change instead of its own refusal.
        require(guest_path.read_bytes() == guest_bytes
                and (extracted.parent / 'COMMITTED.json').read_bytes() == committed_bytes
                and (extracted.parent / 'ACKED.json').read_bytes() == ack_bytes
                and (extracted.parent / 'CHECKPOINT.json').read_bytes() == checkpoint_bytes
                and (extracted.parent / 'WINDOW_PINS.json').read_bytes() == window_pins_bytes
                and manifest_path.read_bytes() == host_bytes
                and capture_path.read_bytes() == capture_bytes
                and guard_path.read_bytes() == guard_bytes
                and require_committed(extracted.parent) == committed,
                'stopped-tree input receipts changed during match')
        result = {'scope': 'content match and read-only mode; not historical master acceptance',
                  'at_utc': datetime.datetime.now(datetime.timezone.utc).isoformat(),
                  'guest_manifest_sha256': hashlib.sha256(guest_bytes).hexdigest(),
                  'capture_sha256': hashlib.sha256(capture_bytes).hexdigest(),
                  'checkpoint_sha256': committed['checkpoint']['checkpoint_sha256'],
                  'extraction_manifest_sha256': hashlib.sha256(host_bytes).hexdigest(),
                  'image_sha256': host['image_sha256'],
                  'data_volume_uuid': guest['data_volume_uuid'], 'matched': matched,
                  'masters': masters}
        write_json(output / 'MATCH.json', result)
        return result
    except Exception as error:
        write_json(output / 'FAILED.json', {'error': str(error)})
        raise


if __name__ == '__main__':
    require(len(sys.argv) in (4, 5, 6),
            'usage: stopped_tree_match.py capture SPEC OUTPUT [NONCE [HEAD]] | match GUEST EXTRACTED OUTPUT')
    if sys.argv[1] == 'capture' and len(sys.argv) in (4, 5, 6):
        guest_capture(sys.argv[2], sys.argv[3], capture_nonce=(sys.argv[4] if len(sys.argv) >= 5 else None),
                      journal_head=(sys.argv[5] if len(sys.argv) == 6 else None))
    elif sys.argv[1] == 'match' and len(sys.argv) == 5:
        host_match(sys.argv[2], sys.argv[3], sys.argv[4])
    else:
        raise RuntimeError('invalid stopped-tree action')
