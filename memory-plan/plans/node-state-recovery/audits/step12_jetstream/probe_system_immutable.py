#!/usr/bin/env python3
import json
import os
import pathlib
import plistlib
import select
import stat
import subprocess
import sys
import tempfile
import time


CHILD = r'''
import json, mmap, os, sys
descriptor = os.open(sys.argv[1], os.O_RDWR)
mapping = mmap.mmap(descriptor, 0, access=mmap.ACCESS_WRITE)
print('ready', flush=True)
for command in sys.stdin:
    try:
        if command == 'descriptor\n':
            os.pwrite(descriptor, b'D', 0)
        elif command == 'mapping\n':
            mapping[1:2] = b'M'
            mapping.flush()
        else:
            raise RuntimeError('unknown command')
        print(json.dumps({'command': command.strip(), 'outcome': 'wrote'}), flush=True)
    except OSError as error:
        print(json.dumps({'command': command.strip(), 'outcome': 'refused',
                          'errno': error.errno}), flush=True)
'''


def run(*args, timeout=30):
    completed = subprocess.run(args, capture_output=True, timeout=timeout)
    if completed.returncode:
        raise RuntimeError(f'{args[0]} failed with exit {completed.returncode}: '
                           + completed.stderr.decode(errors='replace')[:300])
    return completed.stdout


def next_line(stream, timeout=5):
    if not select.select([stream], [], [], timeout)[0]:
        return None
    return stream.readline().strip() or None


def command(child, name):
    child.stdin.write(name + '\n')
    child.stdin.flush()
    line = next_line(child.stdout)
    return json.loads(line) if line else {'command': name, 'outcome': 'no-ack'}


def main():
    if os.environ.get('GITHUB_ACTIONS') != 'true' or not os.environ.get('RUNNER_TEMP'):
        print(json.dumps({'scope': 'ephemeral GitHub macOS runner only', 'status': 'not-run'}))
        return
    if sys.platform != 'darwin':
        print(json.dumps({'status': 'not-macos'}))
        return
    root_check = subprocess.run(['/usr/bin/sudo', '-n', '/usr/bin/true'],
                                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    if root_check.returncode:
        print(json.dumps({'status': 'root-unavailable'}))
        return
    securelevel = run('/usr/sbin/sysctl', '-n', 'kern.securelevel').decode().strip()
    if securelevel != '0':
        print(json.dumps({'status': 'securelevel-not-zero', 'securelevel': securelevel}))
        return
    with tempfile.TemporaryDirectory(prefix='owned-system-flag-',
                                     dir=os.environ['RUNNER_TEMP']) as root:
        image = pathlib.Path(root) / 'disposable.asif'
        run('/usr/sbin/diskutil', 'image', 'create', 'blank', '--format', 'ASIF',
            '--size', '128m', '--fs', 'APFS', '--volumeName', 'OwnedFlag', str(image))
        attached = plistlib.loads(run('/usr/sbin/diskutil', 'image', 'attach', '--plist', str(image)))
        entities = attached['system-entities']
        disk = entities[0]['dev-entry']
        target = None
        child = None
        flagged = False
        cleanup = {'flag_cleared': False, 'image_ejected': False}
        try:
            volume = next(row for row in entities if row.get('volume-name') == 'OwnedFlag')
            target = pathlib.Path(volume['mount-point']) / 'owned-store.dat'
            target.write_bytes(b'0000')
            child = subprocess.Popen(['/usr/bin/python3', '-c', CHILD, str(target)],
                                     stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                     stderr=subprocess.PIPE, text=True)
            if next_line(child.stdout) != 'ready':
                raise RuntimeError('owned writer did not start')
            run('/usr/bin/sudo', '-n', '/usr/bin/chflags', 'schg', str(target))
            flagged = bool(target.lstat().st_flags & stat.SF_IMMUTABLE)
            if not flagged:
                raise RuntimeError('system immutable flag did not stick')
            user_clear = subprocess.run(['/usr/bin/chflags', 'noschg', str(target)],
                                        capture_output=True)
            descriptor = command(child, 'descriptor')
            mapping = command(child, 'mapping') if child.poll() is None else {
                'command': 'mapping', 'outcome': 'writer-exited'}
            observed = {'status': 'stimulated', 'securelevel': securelevel,
                        'system_flag_set': flagged,
                        'user_clear_refused': user_clear.returncode != 0,
                        'descriptor': descriptor, 'mapping': mapping,
                        'writer_exit': child.poll(),
                        'content_after': target.read_bytes().decode('ascii')}
        finally:
            if child is not None:
                if child.poll() is None:
                    child.terminate()
                try:
                    child.communicate(timeout=5)
                except subprocess.TimeoutExpired:
                    child.kill()
                    child.communicate(timeout=5)
            flag_clear_error = None
            if target is not None and target.exists() and target.lstat().st_flags & stat.SF_IMMUTABLE:
                try:
                    run('/usr/bin/sudo', '-n', '/usr/bin/chflags', 'noschg', str(target))
                    cleanup['flag_cleared'] = not bool(target.lstat().st_flags & stat.SF_IMMUTABLE)
                except Exception as error:
                    flag_clear_error = str(error)
            else:
                cleanup['flag_cleared'] = True
            for attempt in range(20):
                ejected = subprocess.run(['/usr/sbin/diskutil', 'eject', disk],
                                         capture_output=True)
                if ejected.returncode == 0:
                    cleanup['image_ejected'] = True
                    break
                time.sleep(0.25)
            if not cleanup['image_ejected']:
                raise RuntimeError('disposable image did not eject')
            if flag_clear_error:
                raise RuntimeError('disposable system flag could not be cleared: '
                                   + flag_clear_error)
        observed['cleanup'] = cleanup
        print(json.dumps(observed, sort_keys=True))


if __name__ == '__main__':
    main()
