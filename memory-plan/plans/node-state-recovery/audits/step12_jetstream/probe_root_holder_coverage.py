import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile


sys.path.insert(0, str(Path(__file__).resolve().parents[5] / 'lib'))
import nats_store_holder_census as census
from nats_root_lock import Refused


def main():
    if sys.platform != 'darwin' or os.geteuid() != 0:
        raise SystemExit('owned root holder probe requires macOS root')
    with tempfile.TemporaryDirectory(prefix='owned-root-holder-') as temporary:
        home = Path(temporary)
        for suffix in census.SUFFIXES:
            (home / '.openclaw' / 'nats' / ('jetstream' + suffix)).mkdir(parents=True)
        block = home / '.openclaw' / 'nats' / 'jetstream' / 'block'
        block.write_bytes(b'owned')
        child = '''import ctypes, os, sys
library = ctypes.CDLL('/usr/lib/libSystem.B.dylib')
library.fileport_makeport.argtypes = [ctypes.c_int, ctypes.POINTER(ctypes.c_uint32)]
library.fileport_makeport.restype = ctypes.c_int
fd = os.open(sys.argv[1], os.O_RDWR)
port = ctypes.c_uint32()
result = library.fileport_makeport(fd, ctypes.byref(port))
os.close(fd)
if result: raise RuntimeError('fileport_makeport failed')
print('ready', flush=True)
sys.stdin.read()
'''
        process = subprocess.Popen([sys.executable, '-c', child, str(block)],
                                   stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                   stderr=subprocess.PIPE, text=True)
        try:
            if process.stdout.readline().strip() != 'ready':
                raise RuntimeError('owned fileport writer did not start')
            try:
                report = census.observe(home)
            except Refused as error:
                print(json.dumps({'status': 'refused', 'error': str(error)}, sort_keys=True))
                return
            holders = report['stores']['ai.openclaw.nats']['holders']
            owned = [row for row in holders if row['pid'] == process.pid
                     and row['reference'] == 'fileport' and row['writable'] is True]
            print(json.dumps({'status': 'observed' if owned else 'owned-writer-missed',
                              'owned_writable_fileport_seen': bool(owned),
                              'unreadable_pid_count': len(report['unreadable_pids']),
                              'exited_pid_count': len(report['exited_pids']),
                              'pid_list_stable': report['coverage']['pid_list_stable'],
                              'single_instant': report['coverage']['single_instant'],
                              'physical_absence_certified': report['coverage']['physical_absence_certified']},
                             sort_keys=True))
        finally:
            process.stdin.close()
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait()
            process.stdout.close()
            process.stderr.close()


if __name__ == '__main__':
    main()
