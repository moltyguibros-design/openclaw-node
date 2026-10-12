import json
import os
from pathlib import Path
import plistlib
import select
import subprocess
import sys
import tempfile


def command(argv, timeout=30):
    return subprocess.run(argv, capture_output=True, text=True, timeout=timeout)


def line_with_deadline(pipe, seconds=10):
    if not select.select([pipe], [], [], seconds)[0]:
        raise RuntimeError('owned memory entry child did not respond')
    return pipe.readline().strip()


def main():
    if sys.platform != 'darwin':
        raise SystemExit('owned unmount probe requires macOS')
    source = Path(__file__).with_name('probe_mach_memory_entry_child.c')
    with tempfile.TemporaryDirectory(prefix='owned-unmount-entry-') as temporary:
        root = Path(temporary).resolve()
        image = root / 'owned.sparseimage'
        mount = root / 'mount'
        mount.mkdir()
        binary = root / 'entry-child'
        subprocess.run(['/usr/bin/clang', '-Wall', '-Wextra', '-O0', str(source),
                        '-o', str(binary)], check=True)
        created = subprocess.run(['/usr/bin/hdiutil', 'create', '-size', '128m', '-fs', 'APFS',
                                  '-volname', 'OwnedMemoryBoundary', '-type', 'SPARSE', str(image)],
                                 capture_output=True, text=True, timeout=60)
        if created.returncode != 0:
            raise RuntimeError('owned image creation failed: ' + created.stderr.strip())
        attached = subprocess.run(['/usr/bin/hdiutil', 'attach', '-plist',
                                   '-mountpoint', str(mount), str(image)],
                                  check=True, capture_output=True, timeout=60)
        entities = plistlib.loads(attached.stdout)['system-entities']
        device = entities[0]['dev-entry']
        volumes = [entry for entry in entities if entry.get('mount-point') == str(mount)]
        child = None
        detached = False
        try:
            if len(volumes) != 1:
                raise RuntimeError('owned image did not mount at its private path')
            block = mount / 'block'
            block.write_bytes(b'0000' + bytes(os.sysconf('SC_PAGESIZE') - 4))
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
            released_unmount = command(['/usr/sbin/diskutil', 'unmount', str(mount)],
                                       timeout=20)
            detach = command(['/usr/bin/hdiutil', 'detach', device], timeout=20)
            if detach.returncode != 0:
                raise RuntimeError('owned image did not detach after child exit: '
                                   + detach.stderr.strip())
            detached = True
            mounted = subprocess.run(['/usr/bin/hdiutil', 'attach', '-readonly', '-plist',
                                      '-mountpoint', str(mount), str(image)],
                                     check=True, capture_output=True, timeout=60)
            remounted_entities = plistlib.loads(mounted.stdout)['system-entities']
            device = remounted_entities[0]['dev-entry']
            detached = False
            volumes = [entry for entry in remounted_entities
                       if entry.get('mount-point') == str(mount)]
            if len(volumes) != 1:
                raise RuntimeError('owned image did not remount for verification')
            prefix = (mount / 'block').read_bytes()[:4].decode()
            result = {'unmount_returncode': unmount.returncode,
                      'mounted_after_attempt': mounted_after_attempt,
                      'remap_outcome': outcome, 'child_exit': child.returncode,
                      'child_error': child_error,
                      'unmount_after_child_exit_returncode': released_unmount.returncode,
                      'content_prefix_after_readonly_reattach': prefix}
            print(json.dumps(result, sort_keys=True))
            if not (unmount.returncode != 0 and mounted_after_attempt
                    and outcome == 'wrote' and child.returncode == 0
                    and not child_error and released_unmount.returncode == 0
                    and prefix == 'M000'):
                raise RuntimeError('owned APFS unmount boundary was not reproduced')
        finally:
            if child is not None:
                if child.poll() is None:
                    child.terminate()
                    child.wait(timeout=10)
                child.stdin.close()
                child.stdout.close()
                child.stderr.close()
            if not detached:
                cleanup = command(['/usr/bin/hdiutil', 'detach', device], timeout=20)
                if cleanup.returncode != 0:
                    command(['/usr/bin/hdiutil', 'detach', '-force', device], timeout=20)


if __name__ == '__main__':
    main()
