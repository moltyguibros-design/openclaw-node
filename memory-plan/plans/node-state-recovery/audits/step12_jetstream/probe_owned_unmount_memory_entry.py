import json
import os
from pathlib import Path
import plistlib
import select
import shutil
import subprocess
import sys
import tempfile


CONTROL_CHILD = ('import os,sys\n'
                 'fd=os.open(sys.argv[1],os.O_RDWR)\n'
                 'os.close(fd)\n'
                 'print("ready",flush=True)\n'
                 'sys.stdin.readline()\n')


def command(argv, timeout=30):
    return subprocess.run(argv, capture_output=True, text=True, timeout=timeout)


def line_with_deadline(pipe, seconds=10):
    if not select.select([pipe], [], [], seconds)[0]:
        raise RuntimeError('owned child did not respond')
    return pipe.readline().strip()


def attach(image, mount, readonly=False):
    argv = ['/usr/bin/hdiutil', 'attach']
    if readonly:
        argv.append('-readonly')
    attached = subprocess.run(argv + ['-plist', '-mountpoint', str(mount), str(image)],
                              check=True, capture_output=True, timeout=60)
    entities = plistlib.loads(attached.stdout)['system-entities']
    device = entities[0]['dev-entry']
    volumes = [entry for entry in entities if entry.get('mount-point') == str(mount)]
    if len(volumes) != 1:
        command(['/usr/bin/hdiutil', 'detach', device], timeout=20)
        raise RuntimeError('owned image did not mount at its private path')
    return device


def stop_child(child):
    if child is None:
        return
    if child.poll() is None:
        child.terminate()
        try:
            child.wait(timeout=10)
        except subprocess.TimeoutExpired:
            child.kill()
            child.wait(timeout=10)
    child.stdin.close()
    child.stdout.close()
    child.stderr.close()


def main():
    if sys.platform != 'darwin':
        raise SystemExit('owned unmount probe requires macOS')
    source = Path(__file__).with_name('probe_mach_memory_entry_child.c')
    root = Path(tempfile.mkdtemp(prefix='owned-unmount-entry-')).resolve()
    image = root / 'owned.sparseimage'
    mount = root / 'mount'
    device = None
    control = None
    child = None
    try:
        mount.mkdir()
        binary = root / 'entry-child'
        subprocess.run(['/usr/bin/clang', '-Wall', '-Wextra', '-O0', str(source),
                        '-o', str(binary)], check=True)
        created = command(['/usr/bin/hdiutil', 'create', '-size', '128m', '-fs', 'APFS',
                           '-volname', 'OwnedMemoryBoundary', '-type', 'SPARSE', str(image)],
                          timeout=60)
        if created.returncode != 0:
            raise RuntimeError('owned image creation failed: ' + created.stderr.strip())
        device = attach(image, mount)
        block = mount / 'block'
        block.write_bytes(b'0000' + bytes(os.sysconf('SC_PAGESIZE') - 4))

        control = subprocess.Popen(['/usr/bin/python3', '-u', '-c', CONTROL_CHILD, str(block)],
                                   stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                   stderr=subprocess.PIPE, text=True)
        if line_with_deadline(control.stdout) != 'ready':
            raise RuntimeError('owned no-entry control did not start')
        control_unmount = command(['/usr/sbin/diskutil', 'unmount', str(mount)], timeout=20)
        control_mounted_after_attempt = os.path.ismount(mount)
        control.stdin.write('x\n')
        control.stdin.flush()
        control.wait(timeout=10)
        control_error = control.stderr.read().strip()
        detached = command(['/usr/bin/hdiutil', 'detach', device], timeout=20)
        if detached.returncode != 0:
            raise RuntimeError('owned control image did not detach: '
                               + detached.stderr.strip())
        device = None

        device = attach(image, mount)
        child = subprocess.Popen([str(binary), str(block)], stdin=subprocess.PIPE,
                                 stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        if line_with_deadline(child.stdout) != 'ready':
            raise RuntimeError('owned memory entry did not start')
        unmount = command(['/usr/sbin/diskutil', 'unmount', str(mount)], timeout=20)
        mounted_after_attempt = os.path.ismount(mount)
        child.stdin.write('x\n')
        child.stdin.flush()
        outcome = line_with_deadline(child.stdout)
        child.wait(timeout=10)
        child_error = child.stderr.read().strip()
        released_unmount = command(['/usr/sbin/diskutil', 'unmount', str(mount)], timeout=20)
        detached = command(['/usr/bin/hdiutil', 'detach', device], timeout=20)
        if detached.returncode != 0:
            raise RuntimeError('owned image did not detach after child exit: '
                               + detached.stderr.strip())
        device = None

        device = attach(image, mount, readonly=True)
        prefix = (mount / 'block').read_bytes()[:4].decode()
        result = {'control_child_exit': control.returncode,
                  'control_child_error': control_error,
                  'control_unmount_returncode': control_unmount.returncode,
                  'control_unmount_output': (control_unmount.stdout + control_unmount.stderr).strip(),
                  'control_mounted_after_attempt': control_mounted_after_attempt,
                  'entry_child_exit': child.returncode,
                  'entry_child_error': child_error,
                  'entry_unmount_returncode': unmount.returncode,
                  'entry_unmount_output': (unmount.stdout + unmount.stderr).strip(),
                  'entry_mounted_after_attempt': mounted_after_attempt,
                  'remap_outcome': outcome,
                  'unmount_after_entry_exit_returncode': released_unmount.returncode,
                  'content_prefix_after_readonly_reattach': prefix}
        print(json.dumps(result, sort_keys=True))
        if not (control.returncode == 0 and not control_error
                and control_unmount.returncode == 0 and not control_mounted_after_attempt
                and child.returncode == 0 and not child_error
                and unmount.returncode != 0 and mounted_after_attempt
                and outcome == 'wrote' and released_unmount.returncode == 0
                and prefix == 'M000'):
            raise RuntimeError('owned APFS unmount contrast was not reproduced')
    finally:
        stop_child(child)
        stop_child(control)
        if device is not None:
            detached = command(['/usr/bin/hdiutil', 'detach', device], timeout=20)
            if detached.returncode != 0:
                detached = command(['/usr/bin/hdiutil', 'detach', '-force', device], timeout=20)
            if detached.returncode != 0:
                raise RuntimeError('owned image remains attached at ' + str(root))
        if os.path.ismount(mount):
            raise RuntimeError('owned image remains mounted at ' + str(mount))
        shutil.rmtree(root)


if __name__ == '__main__':
    main()
