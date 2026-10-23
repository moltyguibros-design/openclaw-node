#!/usr/bin/env python3
"""Verify a private host restore release against a separately pinned manifest hash."""

import hashlib
import json
import os
import pathlib
import re
import stat
import sys


BINARIES = {'node', 'nats', 'nats-server'}


def require(condition, reason):
    if not condition:
        raise RuntimeError(reason)


def digest(path):
    result = hashlib.sha256()
    with open(path, 'rb') as source:
        for block in iter(lambda: source.read(1024 * 1024), b''):
            result.update(block)
    return result.hexdigest()


def private_directory(path):
    info = path.lstat()
    require(stat.S_ISDIR(info.st_mode) and info.st_uid == os.getuid()
            and stat.S_IMODE(info.st_mode) == 0o700 and path.resolve() == path,
            f'private directory differs: {path}')


def private_file(path, mode):
    info = path.lstat()
    require(stat.S_ISREG(info.st_mode) and info.st_uid == os.getuid()
            and info.st_nlink == 1 and stat.S_IMODE(info.st_mode) == mode,
            f'private file differs: {path}')


def write_record(path, value):
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, 'w', encoding='utf-8') as output:
        json.dump(value, output, sort_keys=True, separators=(',', ':'))
        output.write('\n')
        output.flush()
        os.fsync(output.fileno())
    parent = os.open(path.parent, os.O_RDONLY)
    try:
        os.fsync(parent)
    finally:
        os.close(parent)


def module_digest(root, packages):
    private_directory(root)
    require(set(item.name for item in root.iterdir()) == set(packages),
            'dependency package set differs')
    found = []
    for package in packages:
        base = root / package
        private_directory(base)
        for current, dirs, files in os.walk(base, followlinks=False):
            for name in dirs:
                private_directory(pathlib.Path(current) / name)
            for name in files:
                path = pathlib.Path(current) / name
                private_file(path, 0o600)
                found.append((path.relative_to(root).as_posix(), digest(path)))
    result = hashlib.sha256()
    for name, sha in sorted(found):
        result.update(name.encode() + b'\0' + sha.encode() + b'\n')
    return len(found), result.hexdigest()


def verify(root, expected_manifest_sha256, output):
    os.umask(0o077)
    root = pathlib.Path(root)
    output = pathlib.Path(output)
    require(re.fullmatch(r'[0-9a-f]{64}', expected_manifest_sha256),
            'expected manifest hash is malformed')
    private_directory(root.parent)
    private_directory(root)
    private_directory(output.parent)
    require(not os.path.lexists(output), 'verification output already exists')
    output.mkdir(mode=0o700)
    try:
        manifest_path = root / 'release-manifest.json'
        private_file(manifest_path, 0o600)
        require(digest(manifest_path) == expected_manifest_sha256,
                'release manifest hash differs')
        manifest = json.loads(manifest_path.read_text())
        require(set(manifest) == {'source_commit', 'files_sha256', 'node_modules_packages',
                                  'node_modules_files', 'node_modules_sha256'},
                'release manifest shape differs')
        files = manifest['files_sha256']
        require(isinstance(files, dict) and BINARIES <= set(files)
                and all(isinstance(name, str) and '/' not in name and name not in ('', '.', '..')
                        and isinstance(sha, str) and re.fullmatch(r'[0-9a-f]{64}', sha)
                        for name, sha in files.items()),
                'release file declaration differs')
        require(set(item.name for item in root.iterdir()) ==
                set(files) | {'release-manifest.json', 'node_modules'},
                'release root contains an undeclared entry')
        for name, sha in files.items():
            path = root / name
            private_file(path, 0o700 if name in BINARIES else 0o600)
            require(digest(path) == sha, f'release file hash differs: {name}')
        packages = manifest['node_modules_packages']
        require(isinstance(packages, list) and len(packages) == len(set(packages))
                and set(packages) == {'nats', 'nkeys.js', 'tweetnacl'},
                'dependency declaration differs')
        count, sha = module_digest(root / 'node_modules', packages)
        require(count == manifest['node_modules_files']
                and sha == manifest['node_modules_sha256'],
                'dependency tree differs')
        result = {'scope': 'host restore release bytes and modes; no VM or store observation',
                  'source_commit': manifest['source_commit'],
                  'manifest_sha256': expected_manifest_sha256,
                  'files': len(files), 'dependency_files': count,
                  'verified': True}
        write_record(output / 'VERIFY.json', result)
        return result
    except Exception as error:
        write_record(output / 'FAILED.json', {'error': str(error)})
        raise


if __name__ == '__main__':
    require(len(sys.argv) == 4,
            'usage: host_release_verify.py RELEASE EXPECTED_MANIFEST_SHA256 NEW_OUTPUT')
    verify(*sys.argv[1:])
