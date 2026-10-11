#!/usr/bin/env python3
import json
import os
import pathlib
import re
import subprocess
import sys
import tempfile
import time


CHILD = r'''
import mmap, os, sys
descriptor = os.open(sys.argv[1], os.O_RDWR)
mapped_file = open(sys.argv[2], 'r+b', buffering=0)
mapping = mmap.mmap(mapped_file.fileno(), 0, access=mmap.ACCESS_WRITE)
print('ready', flush=True)
for command in sys.stdin:
    if command == 'control\n':
        os.stat(sys.argv[3])
    elif command == 'descriptor\n':
        os.write(descriptor, b'D')
        os.fsync(descriptor)
    elif command == 'mapping\n':
        mapping[0:1] = b'M'
        mapping.flush()
    print(command.strip(), flush=True)
'''


def result(**values):
    print(json.dumps(values, sort_keys=True))


def main():
    if os.environ.get('GITHUB_ACTIONS') != 'true' or not os.environ.get('RUNNER_TEMP'):
        result(scope='ephemeral GitHub macOS runner only', status='not-run')
        return
    if sys.platform != 'darwin':
        result(status='not-macos')
        return
    if subprocess.run(['/usr/bin/sudo', '-n', '/usr/bin/true'],
                      stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL).returncode:
        result(status='root-unavailable')
        return
    with tempfile.TemporaryDirectory(prefix='owned-trace-', dir=os.environ['RUNNER_TEMP']) as root:
        root = pathlib.Path(root)
        descriptor = root / 'preexisting-descriptor.bin'
        mapped = root / 'preexisting-mapping.bin'
        control = root / 'trace-control.marker'
        descriptor.write_bytes(b'0000')
        mapped.write_bytes(b'0000')
        control.write_bytes(b'control')
        child = subprocess.Popen(['/usr/bin/python3', '-c', CHILD,
                                  str(descriptor), str(mapped), str(control)],
                                 stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                 stderr=subprocess.PIPE, text=True)
        try:
            if child.stdout.readline().strip() != 'ready':
                raise RuntimeError('owned writer did not start')
            tracer = subprocess.Popen(['/usr/bin/sudo', '-n', '/usr/bin/fs_usage',
                                       '-w', '-f', 'filesys', '-t', '8', str(child.pid)],
                                      stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
            try:
                time.sleep(1)
                last_ack = 'ready'
                for command in ('control', 'descriptor', 'mapping'):
                    try:
                        child.stdin.write(command + '\n')
                        child.stdin.flush()
                    except BrokenPipeError:
                        last_ack = 'writer-closed'
                        break
                    last_ack = child.stdout.readline().strip()
                    if last_ack != command:
                        break
                output, errors = tracer.communicate(timeout=15)
            finally:
                if tracer.poll() is None:
                    tracer.terminate()
                    tracer.communicate(timeout=5)
            lines = output.splitlines()
            write_lines = [line for line in lines if re.search(r'\b(?:p?write|writev|msync)\b', line, re.I)]
            control_seen = any(control.name in line for line in lines)
            child.stdin.close()
            child.wait(timeout=5)
            result(status=('stimulated' if control_seen and last_ack == 'mapping' and child.returncode == 0
                            else 'inconclusive')
                   if tracer.returncode == 0 else 'tracer-refused',
                   tracer_exit=tracer.returncode,
                   last_writer_ack=last_ack,
                   writer_exit=child.returncode,
                   control_path_seen=control_seen,
                   descriptor_path_seen=any(descriptor.name in line for line in write_lines),
                   mapping_path_seen=any(mapped.name in line for line in write_lines),
                   write_event_lines=len(write_lines),
                   unnamed_write_event_lines=sum(not any(name in line for name in
                       (descriptor.name, mapped.name)) for line in write_lines),
                   overrun_reported='buffer overrun' in (output + errors).lower())
        finally:
            try:
                child.stdin.close()
            except BrokenPipeError:
                pass
            child.wait(timeout=5)


if __name__ == '__main__':
    main()
