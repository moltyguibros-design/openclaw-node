#!/usr/bin/env python3
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import signal
import stat
import subprocess
import sys
import tarfile
import time
import uuid

RESERVE = 4 * 1024 ** 3
ARCHIVE_LIMIT = 512 * 1024 ** 2
BUDGET = 1024 ** 3
RECEIPT = '.openclaw-node-release.json'


def sha_file(path):
    value = hashlib.sha256()
    with open(path, 'rb') as stream:
        while chunk := stream.read(1024 * 1024):
            value.update(chunk)
    return value.hexdigest()


def sync_directory(path):
    descriptor = os.open(path, os.O_RDONLY | os.O_DIRECTORY)
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def write(path, value):
    pending = path.with_name(path.name + '.pending-' + uuid.uuid4().hex)
    with pending.open('x') as stream:
        os.chmod(pending, 0o600)
        json.dump(value, stream, separators=(',', ':'))
        stream.write('\n')
        stream.flush()
        os.fsync(stream.fileno())
    os.replace(pending, path)
    sync_directory(path.parent)


def tree(release):
    if release.is_symlink() or not release.is_dir():
        raise ValueError('Retired release must be a real directory')
    receipt_path = release / RECEIPT
    receipt = json.loads(receipt_path.read_text())
    encoded = json.dumps({'node': receipt['node'], 'files': receipt['files']}, separators=(',', ':'), ensure_ascii=False).encode()
    if receipt['schema'] != 1 or receipt['digest'] != release.name or hashlib.sha256(encoded).hexdigest() != release.name:
        raise ValueError('Retired manifest digest mismatch')
    expected = {}
    for entry in receipt['files']:
        name = entry['name']
        if not name or name.startswith('/') or any(part in ['', '.', '..'] for part in name.split('/')) or name in expected:
            raise ValueError('Unsafe or duplicate manifest name')
        if entry['kind'] == 'file':
            expected[name] = {'kind': 'file', 'bytes': entry['bytes'], 'sha256': entry['sha256'],
                              'mode': entry['mode'] & ~0o222 if name.startswith('node_modules/') else entry['mode']}
        elif entry['kind'] == 'link':
            expected[name] = {'kind': 'link', 'target': entry['target']}
        else:
            raise ValueError('Unknown manifest entry kind')
    expected[RECEIPT] = {'kind': 'file', 'bytes': receipt_path.stat().st_size, 'sha256': sha_file(receipt_path), 'mode': 0o600}
    directories = {'.'}
    for name in expected:
        directories.update(str(p) for p in Path(name).parents)
    found = {}
    for folder, dirs, files in os.walk(release, followlinks=False):
        relative = str(Path(folder).relative_to(release))
        if relative not in directories:
            raise ValueError('Unknown directory in retired release: ' + relative)
        for name in list(dirs) + files:
            absolute = Path(folder) / name
            rel = str(absolute.relative_to(release))
            info = absolute.lstat()
            if stat.S_ISDIR(info.st_mode):
                continue
            entry = expected.get(rel)
            if not entry:
                raise ValueError('Unknown data in retired release: ' + rel)
            if entry['kind'] == 'link':
                if not absolute.is_symlink() or os.readlink(absolute) != entry['target'] or not absolute.resolve(strict=True).is_relative_to(release):
                    raise ValueError('Retired symlink mismatch: ' + rel)
            elif not stat.S_ISREG(info.st_mode) or info.st_size != entry['bytes'] or stat.S_IMODE(info.st_mode) != entry['mode'] or sha_file(absolute) != entry['sha256']:
                raise ValueError('Retired file mismatch: ' + rel)
            found[rel] = entry
    if found != expected:
        raise ValueError('Retired file set differs from manifest')
    result = {str(release.name / Path(name)): value for name, value in found.items()}
    result.update({str(release.name / Path(name)): {'kind': 'directory'} for name in directories})
    return result


def protections(root, privileged=False):
    parent = root / 'runtime/node'
    selected = set()
    pattern = re.compile(re.escape(str(parent)) + r'/([a-f0-9]{64})(?![a-f0-9])')

    def text(value):
        selected.update(pattern.findall(str(value)))

    current = parent / 'current'
    if not current.is_symlink() or current.resolve(strict=True).parent != parent:
        raise ValueError('Current runtime is not contained')
    target = current.resolve(strict=True)
    text(target)
    receipt = json.loads((target / RECEIPT).read_text())
    text(receipt.get('previousRelease'))
    record = json.loads((root / 'config/installation.json').read_text())
    if record['schema'] not in [1, 2]:
        raise ValueError('Unknown installation schema')
    text(json.dumps(record, ensure_ascii=False))
    for config in [root / 'openclaw.env', root / 'openclaw.json', *(root / 'config').iterdir()]:
        if config.is_file() and (config.suffix in ['.json', '.conf', '.env'] or config.name == 'openclaw.env'):
            content = config.read_text()
            text(content)
            selected.update(re.findall(r'/runtime/node/([a-f0-9]{64})(?![a-f0-9])', content))
    for item in (root / 'config/dependency-bindings').glob('*.json'):
        binding = json.loads(item.read_text())
        destination = Path(binding['destination'])
        if destination.exists() or destination.is_symlink():
            text(destination.resolve(strict=True))
    workspace = root / 'workspace'
    for folder, dirs, files in os.walk(workspace, followlinks=False):
        for name in list(dirs) + files:
            p = Path(folder) / name
            if p.is_symlink():
                text(p.resolve(strict=True))
    units = subprocess.run(['systemctl', '--user', 'list-unit-files', 'openclaw-*', '--no-legend', '--no-pager'], check=True, capture_output=True, text=True, timeout=10)
    for line in units.stdout.splitlines():
        name = line.split()[0]
        properties = subprocess.run(['systemctl', '--user', 'show', name, '--property=FragmentPath,DropInPaths'], check=True, capture_output=True, text=True, timeout=10)
        for prop in properties.stdout.splitlines():
            for filename in prop.split('=', 1)[1].split():
                text(Path(filename).read_text())
    if privileged:
        result = subprocess.run(['sudo', '-n', '/usr/bin/python3', '-I', '-S', '-B', str(Path(__file__).resolve()),
                                 '--process-references', str(parent), '--uid', str(os.getuid())],
                                check=True, capture_output=True, text=True, timeout=15)
        selected.update(json.loads(result.stdout))
    else:
        selected.update(process_references(parent, os.getuid()))
    return sorted(selected)

def process_references(parent, uid):
    pattern = re.compile(re.escape(str(parent)) + r'/([a-f0-9]{64})(?![a-f0-9])')
    selected = set()

    def text(value):
        selected.update(pattern.findall(str(value)))

    for process in Path('/proc').iterdir():
        if not process.name.isdigit():
            continue
        try:
            status = (process / 'status').read_text()
            identity = re.search(r'^Uid:\s+([0-9 \t]+)$', status, re.MULTILINE)
            if not identity or uid not in [int(value) for value in identity.group(1).split()]:
                continue
            text((process / 'cmdline').read_bytes().decode(errors='replace'))
            text((process / 'maps').read_text())
            text((process / 'environ').read_bytes().decode(errors='replace'))
            for name in ['cwd', 'exe', 'root']:
                try:
                    text(os.readlink(process / name))
                except FileNotFoundError:
                    pass
            for descriptor in (process / 'fd').iterdir():
                try:
                    text(os.readlink(descriptor))
                except FileNotFoundError:
                    pass
        except (FileNotFoundError, ProcessLookupError):
            pass
    return sorted(selected)


def verify(attempt):
    manifest = json.loads((attempt / 'manifest.json').read_text())
    expected = manifest['entries']
    seen = {}
    archive = attempt / 'runtime.tar.gz'
    if archive.stat().st_size > ARCHIVE_LIMIT:
        raise ValueError('Archive exceeds 512MiB limit')
    with tarfile.open(archive, 'r|gz') as stream:
        for member in stream:
            name = member.name.rstrip('/')
            entry = expected.get(name)
            if not entry or name in seen:
                raise ValueError('Unexpected or duplicate archive member: ' + name)
            if entry['kind'] == 'directory':
                if not member.isdir():
                    raise ValueError('Archive directory mismatch')
            elif entry['kind'] == 'link':
                if not member.issym() or member.linkname != entry['target']:
                    raise ValueError('Archive symlink mismatch')
            else:
                if member.islnk():
                    target = seen.get(member.linkname)
                    if not target or target != entry:
                        raise ValueError('Archive hardlink mismatch')
                elif member.isfile():
                    value = hashlib.sha256()
                    data = stream.extractfile(member)
                    while chunk := data.read(1024 * 1024):
                        value.update(chunk)
                    if member.size != entry['bytes'] or value.hexdigest() != entry['sha256']:
                        raise ValueError('Archive file hash mismatch')
                else:
                    raise ValueError('Unsupported archive member')
                if member.mode != entry['mode']:
                    raise ValueError('Archive file mode mismatch')
            seen[name] = entry
    if seen != expected:
        raise ValueError('Archive entries missing')
    return {'archive_sha256': sha_file(archive), 'archive_bytes': archive.stat().st_size,
            'manifest_sha256': sha_file(attempt / 'manifest.json'), 'entries': len(seen)}


def archive(root, names, privileged=False):
    if sys.platform != 'linux' or not Path('/proc').is_dir():
        raise ValueError('Retired-code archival currently requires Linux reference readers')
    root = root.resolve(strict=True)
    parent = root / 'runtime/node'
    if not names or len(set(names)) != len(names) or any(not re.fullmatch('[a-f0-9]{64}', n) for n in names):
        raise ValueError('Choose explicit unique release digests')
    for entry in parent.iterdir():
        if entry.name not in ['current', '.deploy-lock'] and not re.fullmatch('[a-f0-9]{64}', entry.name):
            raise ValueError('Unknown runtime parent entry requires reconciliation: ' + entry.name)
    protected = protections(root, privileged)
    if set(names) & set(protected):
        raise ValueError('Selected release has a current/previous/config/unit/workspace/process reference')
    entries = {}
    physical = {}
    for name in sorted(names):
        entries.update(tree(parent / name))
        for folder, _, files in os.walk(parent / name):
            for filename in files:
                p = Path(folder) / filename
                info = p.lstat()
                if stat.S_ISREG(info.st_mode):
                    physical[(info.st_dev, info.st_ino)] = info.st_size
    archive_root = root / 'runtime/node-archives'
    archive_root.mkdir(mode=0o700, exist_ok=True)
    sync_directory(archive_root.parent)
    if archive_root.is_symlink():
        raise ValueError('Archive destination cannot be a symlink')
    used = 0
    for attempt in archive_root.iterdir():
        if not attempt.is_dir() or attempt.is_symlink():
            raise ValueError('Unknown archive entry requires reconciliation')
        record = json.loads((attempt / 'result.json').read_text())
        if record['phase'] != 'complete':
            raise ValueError('Unfinished archive requires reconciliation; do not repeat its writer')
        files = list(attempt.iterdir())
        if {p.name for p in files} != {'result.json', 'manifest.json', 'runtime.tar.gz'} or any(not stat.S_ISREG(p.lstat().st_mode) for p in files):
            raise ValueError('Unknown completed archive data requires reconciliation')
        used += sum(p.stat().st_size for p in files)
    worst = sum(physical.values()) + len(entries) * 2048 + 1024 ** 2
    if used + worst > BUDGET or shutil.disk_usage(parent).free < worst + RESERVE:
        raise ValueError('Archive budget/free reserve refuses allocation')
    attempt = archive_root / ('attempt-' + uuid.uuid4().hex)
    attempt.mkdir(mode=0o700)
    sync_directory(archive_root)
    record = {'phase': 'prepared', 'releases': sorted(names), 'protected': protected, 'pruned': [], 'started': time.time()}
    write(attempt / 'result.json', record)
    write(attempt / 'manifest.json', {'schema': 1, 'releases': sorted(names), 'entries': entries})
    try:
        partial = attempt / 'runtime.partial.tar.gz'
        with partial.open('xb') as stream:
            os.chmod(partial, 0o600)
            subprocess.run(['tar', '-czf', '-', '-C', str(parent), '--', *sorted(names)], check=True, stdout=stream, stderr=subprocess.PIPE, timeout=180)
            stream.flush()
            os.fsync(stream.fileno())
        if partial.stat().st_size > ARCHIVE_LIMIT:
            raise ValueError('Archive exceeds 512MiB limit; retained without pruning')
        os.rename(partial, attempt / 'runtime.tar.gz')
        sync_directory(attempt)
        record.update(verify(attempt), phase='verified')
        write(attempt / 'result.json', record)
        if set(names) & set(protections(root, privileged)):
            raise ValueError('References changed before pruning')
        for name in sorted(names):
            actual = tree(parent / name)
            if actual != {k: v for k, v in entries.items() if k == name or k.startswith(name + '/')}:
                raise ValueError('Retired tree changed before pruning')
        for name in sorted(names):
            shutil.rmtree(parent / name)
            sync_directory(parent)
            record['pruned'].append(name)
            write(attempt / 'result.json', record)
        record.update(phase='complete', finished=time.time())
        write(attempt / 'result.json', record)
        return {'attempt': str(attempt), **record}
    except BaseException as error:
        record.update(phase='error', error=str(error))
        write(attempt / 'result.json', record)
        raise


def interrupted(signum, frame):
    raise RuntimeError('Runtime archival interrupted by signal ' + str(signum))


if __name__ == '__main__':
    signal.signal(signal.SIGTERM, interrupted)
    parser = argparse.ArgumentParser()
    parser.add_argument('--root')
    parser.add_argument('--release', action='append', default=[])
    parser.add_argument('--verify')
    parser.add_argument('--privileged-process-reader', action='store_true')
    parser.add_argument('--process-references')
    parser.add_argument('--uid', type=int)
    args = parser.parse_args()
    try:
        if args.process_references:
            if args.uid is None:
                raise ValueError('--uid required for process metadata')
            result = process_references(Path(args.process_references), args.uid)
        else:
            if os.getuid() == 0:
                raise ValueError('Archival and verification must run unprivileged')
            result = verify(Path(args.verify)) if args.verify else archive(Path(args.root), args.release, args.privileged_process_reader)
        print(json.dumps(result))
    except Exception as error:
        print('Runtime archive refused: ' + str(error), file=sys.stderr)
        sys.exit(1)
