#!/usr/bin/env python3
"""Read-only UTM host identity and power-state preflight.

Run from the logged-in host launchd GUI domain. This does not shut down or copy a VM.
"""

import datetime
import hashlib
import json
import os
import pathlib
import plistlib
import re
import shutil
import stat
import subprocess
import sys
import time
import uuid


def require(condition, reason):
    if not condition:
        raise RuntimeError(reason)


def run(*args):
    result = subprocess.run(args, capture_output=True, timeout=15)
    require(result.returncode == 0,
            f'{args[0]} failed: {result.stderr.decode(errors="replace")[:300]}')
    return result.stdout.decode(errors='strict').strip()


def digest(path):
    h = hashlib.sha256()
    with open(path, 'rb') as source:
        for block in iter(lambda: source.read(1024 * 1024), b''):
            h.update(block)
    return h.hexdigest()


def owned_directory(path):
    info = path.lstat()
    require(stat.S_ISDIR(info.st_mode) and info.st_uid == os.getuid()
            and stat.S_IMODE(info.st_mode) == 0o700 and path.resolve() == path,
            f'expected owner-private literal directory: {path}')


def regular_file(path, owner=None):
    info = path.lstat()
    require(stat.S_ISREG(info.st_mode) and info.st_nlink == 1
            and (owner is None or info.st_uid == owner),
            f'expected unlinked regular file: {path}')
    return info


def write_record(path, value):
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


def gui_status_helper(utmctl, vm_uuid, output):
    result = subprocess.run([utmctl, 'status', vm_uuid], capture_output=True, timeout=15)
    write_record(pathlib.Path(output), {
        'at_utc': datetime.datetime.now(datetime.timezone.utc).isoformat(),
        'returncode': result.returncode,
        'stdout': result.stdout.decode(errors='replace').strip(),
        'stderr': result.stderr.decode(errors='replace').strip()[:300],
    })


def gui_utm_status(utmctl, vm_uuid, output):
    label = 'ai.openclaw.host-preflight.' + uuid.uuid4().hex
    status_path = output / 'utm-status.json'
    agent = output / 'utm-status.plist'
    agent.write_bytes(plistlib.dumps({
        'Label': label,
        'ProgramArguments': ['/usr/bin/python3', str(pathlib.Path(__file__).resolve()),
                             '--utm-status-helper', str(utmctl), vm_uuid, str(status_path)],
        'RunAtLoad': True,
        'StandardOutPath': str(output / 'utm-status.out'),
        'StandardErrorPath': str(output / 'utm-status.err'),
    }))
    os.chmod(agent, 0o600)
    target = 'gui/' + str(os.getuid())
    run('/bin/launchctl', 'bootstrap', target, str(agent))
    try:
        deadline = time.monotonic() + 20
        while not status_path.exists() and time.monotonic() < deadline:
            time.sleep(0.1)
        require(status_path.exists(), 'GUI UTM status helper timed out')
        status = json.loads(status_path.read_text())
    finally:
        run('/bin/launchctl', 'bootout', target + '/' + label)
    require(status['returncode'] == 0 and not status['stderr']
            and status['stdout'] in ('started', 'stopped'),
            'GUI UTM status was not a clear power state')
    return status


def preflight(spec_path, output):
    os.umask(0o077)
    spec_path = pathlib.Path(spec_path)
    output = pathlib.Path(output)
    owned_directory(output.parent)
    require(not os.path.lexists(output), 'output already exists')
    regular_file(spec_path, os.getuid())
    require(stat.S_IMODE(spec_path.stat().st_mode) == 0o600, 'spec is not owner-private')
    spec = json.loads(spec_path.read_text())
    require(set(spec) == {'package', 'name', 'uuid', 'image_name', 'config_sha256',
                          'utmctl', 'utmctl_sha256'}, 'unexpected host preflight spec')
    require(re.fullmatch(r'[0-9a-f]{64}', spec['config_sha256'])
            and re.fullmatch(r'[0-9a-f]{64}', spec['utmctl_sha256'])
            and re.fullmatch(r'[0-9A-F-]{36}', spec['uuid'])
            and re.fullmatch(r'[0-9A-F-]{36}\.img', spec['image_name']),
            'malformed pinned host identity')
    package = pathlib.Path(spec['package'])
    utmctl = pathlib.Path(spec['utmctl'])
    require(package.is_absolute() and utmctl.is_absolute(), 'host paths must be absolute')
    output.mkdir(mode=0o700)
    try:
        package_info = package.lstat()
        require(stat.S_ISDIR(package_info.st_mode) and package_info.st_uid == os.getuid()
                and package.resolve() == package, 'UTM package identity differs')
        config = package / 'config.plist'
        regular_file(config, os.getuid())
        require(digest(config) == spec['config_sha256'], 'UTM config hash differs')
        configured = plistlib.loads(config.read_bytes())
        require(configured.get('Backend') == 'Apple'
                and configured.get('Information', {}).get('Name') == spec['name']
                and configured.get('Information', {}).get('UUID') == spec['uuid']
                and len(configured.get('Drive', [])) == 1
                and configured['Drive'][0].get('ImageName') == spec['image_name']
                and configured['Drive'][0].get('ReadOnly') is False,
                'UTM VM or writable drive configuration differs')
        data = package / 'Data'
        data_info = data.lstat()
        require(stat.S_ISDIR(data_info.st_mode) and data_info.st_uid == os.getuid()
                and data.resolve() == data, 'UTM Data directory identity differs')
        image = data / spec['image_name']
        require(image.resolve() == image, 'UTM image path is redirected')
        image_info = regular_file(image, os.getuid())
        regular_file(utmctl)
        require(digest(utmctl) == spec['utmctl_sha256'] and os.access(utmctl, os.X_OK),
                'UTM controller binary differs')
        status = gui_utm_status(utmctl, spec['uuid'], output)
        state = status['stdout']
        holders = subprocess.run(['/usr/sbin/lsof', '-t', '--', str(image)],
                                 capture_output=True, timeout=15)
        require(holders.returncode in (0, 1) and not holders.stderr,
                'image holder observation failed')
        pids = sorted({int(line) for line in holders.stdout.splitlines()})
        require((state == 'started' and len(pids) == 1)
                or (state == 'stopped' and not pids),
                'UTM state and image holders disagree')
        result = {
            'scope': 'read-only host preflight; not a shutdown or cold-copy receipt',
            'at_utc': datetime.datetime.now(datetime.timezone.utc).isoformat(),
            'host_boot_session': run('/usr/sbin/sysctl', '-n', 'kern.bootsessionuuid'),
            'package': str(package), 'config_sha256': spec['config_sha256'],
            'vm_uuid': spec['uuid'], 'utmctl_sha256': spec['utmctl_sha256'],
            'state': state, 'state_observed_at_utc': status['at_utc'],
            'image': str(image), 'image_size': image_info.st_size,
            'image_device': image_info.st_dev, 'image_inode': image_info.st_ino,
            'image_holders': pids, 'free_bytes': shutil.disk_usage(image.parent).free,
        }
    except Exception as error:
        write_record(output / 'FAILED.json', {'error': str(error)})
        raise
    write_record(output / 'preflight.json', result)
    return result


if __name__ == '__main__':
    if len(sys.argv) == 5 and sys.argv[1] == '--utm-status-helper':
        gui_status_helper(*sys.argv[2:])
    else:
        require(len(sys.argv) == 3, 'usage: host_vm_preflight.py SPEC OUTPUT')
        preflight(*sys.argv[1:])
