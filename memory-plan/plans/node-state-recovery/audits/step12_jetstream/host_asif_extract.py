#!/usr/bin/env python3
"""Extract declared store trees from a read-only mounted ASIF clone.

This tool verifies copy mechanics. Its input image must already have a separately
verified powered-off host provenance receipt; this program cannot create one.
"""

import hashlib
import json
import os
import pathlib
import plistlib
import shutil
import stat
import subprocess
import sys


def require(condition, reason):
    if not condition:
        raise RuntimeError(reason)


def command(*args):
    result = subprocess.run(args, capture_output=True)
    require(result.returncode == 0, f'{args[0]} failed: {result.stderr.decode(errors="replace")[:500]}')
    return result.stdout


def sha256(path):
    digest = hashlib.sha256()
    with open(path, 'rb') as source:
        for block in iter(lambda: source.read(1024 * 1024), b''):
            digest.update(block)
    return digest.hexdigest()


def private_parent(path):
    info = path.lstat()
    require(stat.S_ISDIR(info.st_mode) and info.st_uid == os.getuid()
            and stat.S_IMODE(info.st_mode) == 0o700,
            f'parent must be an owner-private directory: {path}')


def regular_image(path):
    info = path.lstat()
    require(stat.S_ISREG(info.st_mode) and info.st_uid == os.getuid()
            and info.st_nlink == 1, 'image must be an owned, unlinked regular file')
    return info


def declared_path(root, relative):
    parts = pathlib.PurePosixPath(relative).parts
    require(parts and not pathlib.PurePosixPath(relative).is_absolute()
            and all(part not in ('', '.', '..') for part in parts),
            f'invalid store path: {relative}')
    cursor = root
    for part in parts:
        cursor = cursor / part
        info = cursor.lstat()
        require(stat.S_ISDIR(info.st_mode), f'store path is not a real directory: {cursor}')
    return cursor


def copy_tree(source, target):
    target.mkdir(mode=0o700)
    manifest = []

    def visit(current, output, prefix):
        entries = sorted(os.scandir(current), key=lambda entry: entry.name)
        for entry in entries:
            src = pathlib.Path(entry.path)
            dst = output / entry.name
            info = src.lstat()
            rel = '/'.join(prefix + (entry.name,))
            require(info.st_uid == os.getuid(), f'foreign-owned store entry: {rel}')
            if stat.S_ISDIR(info.st_mode):
                dst.mkdir(mode=0o700)
                manifest.append({'path': rel, 'type': 'dir'})
                visit(src, dst, prefix + (entry.name,))
                continue
            require(stat.S_ISREG(info.st_mode) and info.st_nlink == 1,
                    f'non-regular or linked store entry: {rel}')
            before = sha256(src)
            with open(src, 'rb') as reader, open(dst, 'xb') as writer:
                shutil.copyfileobj(reader, writer, 1024 * 1024)
                writer.flush()
                os.fsync(writer.fileno())
            os.chmod(dst, 0o600)
            fd = os.open(dst, os.O_RDONLY)
            try:
                os.fsync(fd)
            finally:
                os.close(fd)
            require(sha256(dst) == before and sha256(src) == before,
                    f'copy changed store bytes: {rel}')
            manifest.append({'path': rel, 'type': 'file', 'size': info.st_size, 'sha256': before})
        fd = os.open(output, os.O_RDONLY)
        try:
            os.fsync(fd)
        finally:
            os.close(fd)

    visit(source, target, ())
    return manifest


def write_json(path, value):
    with open(path, 'x', encoding='utf-8') as output:
        os.chmod(path, 0o600)
        json.dump(value, output, sort_keys=True, separators=(',', ':'))
        output.write('\n')
        output.flush()
        os.fsync(output.fileno())
    fd = os.open(path.parent, os.O_RDONLY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def extract(image, spec_path, output):
    os.umask(0o077)
    image = pathlib.Path(image)
    spec_path = pathlib.Path(spec_path)
    output = pathlib.Path(output)
    private_parent(output.parent)
    require(not output.exists() and not output.is_symlink(), 'output already exists')
    regular_image(image)
    spec = json.loads(spec_path.read_text())
    require(set(spec) == {'image_sha256', 'data_volume_uuid', 'stores'}, 'unexpected extraction spec')
    require(isinstance(spec['stores'], list) and len(spec['stores']) == 4,
            'expected four separately named store trees')
    require(all(isinstance(row, dict) for row in spec['stores']), 'invalid store declaration')
    roles = [row.get('role') for row in spec['stores']]
    require(set(roles) == {'standalone', 'member1', 'member2', 'member3'},
            'store roles must be complete and distinct')
    require(all(set(row) == {'role', 'relative_path'} for row in spec['stores']),
            'unexpected store declaration')
    require(len({row['relative_path'] for row in spec['stores']}) == 4,
            'store paths must be distinct')
    require(sha256(image) == spec['image_sha256'], 'image hash differs before extraction')

    output.mkdir(mode=0o700)
    fd = os.open(output.parent, os.O_RDONLY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)
    mounted = output / '.mounted'
    mounted.mkdir(mode=0o700)
    disk = None
    success = None
    errors = []
    try:
        attached = plistlib.loads(command('/usr/sbin/diskutil', 'image', 'attach',
                                           '--plist', '--readOnly', '--noMount', str(image)))
        entities = attached['system-entities']
        disk = entities[0]['dev-entry']
        matches = []
        for entity in entities:
            if entity.get('content-hint') != 'Apple_APFS_Volume':
                continue
            info = plistlib.loads(command('/usr/sbin/diskutil', 'info', '-plist', entity['dev-entry']))
            if info.get('VolumeUUID') == spec['data_volume_uuid']:
                matches.append((entity['dev-entry'], info))
        require(len(matches) == 1 and matches[0][1].get('VolumeName') == 'Data'
                and matches[0][1].get('Encryption') is False,
                'expected unencrypted Data volume UUID not found exactly once')
        volume = matches[0][0]
        command('/usr/sbin/diskutil', 'mount', 'readOnly', '-mountPoint', str(mounted), volume)
        mounted_info = plistlib.loads(command('/usr/sbin/diskutil', 'info', '-plist', volume))
        require(mounted_info.get('WritableVolume') is False
                and pathlib.Path(mounted_info.get('MountPoint', '')).resolve() == mounted.resolve(),
                'Data volume is not mounted read-only at the private mount point')
        stores = {}
        for row in spec['stores']:
            source = declared_path(mounted, row['relative_path'])
            require(source.lstat().st_uid == os.getuid(), 'foreign-owned store root')
            stores[row['role']] = copy_tree(source, output / row['role'])
        require(sha256(image) == spec['image_sha256'], 'image hash changed during extraction')
        success = {'scope': 'ASIF read-only extraction mechanism; host power provenance external',
                   'image_sha256': spec['image_sha256'],
                   'data_volume_uuid': spec['data_volume_uuid'], 'stores': stores}
    except Exception as error:
        errors.append(str(error))
    finally:
        if disk is not None:
            try:
                command('/usr/sbin/diskutil', 'eject', disk)
            except Exception as error:
                errors.append('eject: ' + str(error))
        try:
            mounted.rmdir()
        except Exception as error:
            errors.append('mountpoint: ' + str(error))
    if errors:
        write_json(output / 'FAILED.json', {'errors': errors})
        raise RuntimeError('; '.join(errors))
    write_json(output / 'manifest.json', success)
    return success


if __name__ == '__main__':
    require(len(sys.argv) == 4, 'usage: host_asif_extract.py IMAGE SPEC OUTPUT')
    extract(*sys.argv[1:])
