#!/usr/bin/env python3
"""Compare guest stopped-store bytes with host ASIF-extracted trees."""

import datetime
import hashlib
import json
import os
import pathlib
import re
import stat
import sys

from host_asif_extract import declared_path, private_parent, require, write_json
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


def new_output(output):
    private_parent(output.parent)
    require(not os.path.lexists(output), 'stopped-tree output exists')
    output.mkdir(mode=0o700)


def guest_capture(spec_path, output, root=pathlib.Path('/')):
    os.umask(0o077)
    spec_path = pathlib.Path(spec_path)
    output = pathlib.Path(output)
    spec, spec_sha256 = store_spec(spec_path)
    new_output(output)
    try:
        stores = {}
        for row in spec['stores']:
            source = declared_path(root, row['relative_path'])
            stores[row['role']] = entries(source)
            require(any(item['type'] == 'file' for item in stores[row['role']]),
                    f'empty stopped store: {row["role"]}')
        require(sha256(spec_path) == spec_sha256,
                'store specification changed during guest capture')
        result = {'scope': 'guest stopped-tree content observation; writer exclusion external',
                  'at_utc': datetime.datetime.now(datetime.timezone.utc).isoformat(),
                  'data_volume_uuid': spec['data_volume_uuid'],
                  'spec_sha256': spec_sha256, 'stores': stores}
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
    guest = json.loads(guest_path.read_text())
    manifest_path = extracted / 'manifest.json'
    capture_path = extracted.parent / 'CAPTURE.json'
    guard_path = extracted.parent / 'GUARD.json'
    image_path = extracted.parent / 'powered-off-image.asif'
    private_file(manifest_path)
    private_file(capture_path)
    private_file(guard_path)
    private_file(image_path)
    host = json.loads(manifest_path.read_text())
    capture = json.loads(capture_path.read_text())
    guard = json.loads(guard_path.read_text())
    new_output(output)
    try:
        require(capture['scope'] == CAPTURE_SCOPE
                and capture['vm_state_at_final_check'] == 'stopped'
                and capture['source_image_sha256'] == capture['clone_image_sha256']
                and capture['guard_receipt_sha256'] == sha256(guard_path)
                and capture['clone_image_sha256'] == host['image_sha256']
                and capture['extraction_manifest_sha256'] == sha256(manifest_path)
                and capture['data_volume_uuid'] == host['data_volume_uuid']
                and capture['store_roles'] == sorted(ROLES)
                and capture['clone_size'] == image_path.stat().st_size
                and sha256(image_path) == capture['clone_image_sha256'],
                'capture receipt, cloned image and extracted stores differ')
        guest_at = datetime.datetime.fromisoformat(guest['at_utc'])
        guard_at = datetime.datetime.fromisoformat(guard['guarded_at_utc'])
        require(guest['scope'] == 'guest stopped-tree content observation; writer exclusion external',
                'guest stopped-tree scope differs')
        require(guest['spec_sha256'] == capture['store_spec_sha256'],
                'guest store specification differs from host capture')
        require(guest_at.tzinfo is not None and guard_at.tzinfo is not None,
                'guest or host guard timestamp lacks timezone')
        require(guest_at < guard_at,
                f'guest capture is not before host guard: guest={guest_at.isoformat()} guard={guard_at.isoformat()}')
        require(set(guest['stores']) == ROLES and set(host['stores']) == ROLES
                and guest['data_volume_uuid'] == host['data_volume_uuid'],
                'guest and host store roles or Data volume differ')
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
        for role in sorted(ROLES):
            freeze(extracted / role)
            require(entries(extracted / role) == guest['stores'][role],
                    f'frozen host tree changed: {role}')
        result = {'scope': 'content match and read-only mode; not historical master acceptance',
                  'at_utc': datetime.datetime.now(datetime.timezone.utc).isoformat(),
                  'guest_manifest_sha256': sha256(guest_path),
                  'capture_sha256': sha256(capture_path),
                  'extraction_manifest_sha256': sha256(manifest_path),
                  'image_sha256': host['image_sha256'],
                  'data_volume_uuid': guest['data_volume_uuid'], 'matched': matched}
        write_json(output / 'MATCH.json', result)
        return result
    except Exception as error:
        write_json(output / 'FAILED.json', {'error': str(error)})
        raise


if __name__ == '__main__':
    require(len(sys.argv) in (4, 5), 'usage: stopped_tree_match.py capture SPEC OUTPUT | match GUEST EXTRACTED OUTPUT')
    if sys.argv[1] == 'capture' and len(sys.argv) == 4:
        guest_capture(sys.argv[2], sys.argv[3])
    elif sys.argv[1] == 'match' and len(sys.argv) == 5:
        host_match(sys.argv[2], sys.argv[3], sys.argv[4])
    else:
        raise RuntimeError('invalid stopped-tree action')
