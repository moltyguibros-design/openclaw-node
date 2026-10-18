import json
import os
from pathlib import Path
import stat
import subprocess
import sys
import tempfile
from unittest.mock import patch


sys.path.insert(0, str(Path(__file__).resolve().parents[5] / 'lib'))
import nats_macos_proc as proc
import nats_store_holder_census as census


def main():
    if sys.platform != 'darwin':
        raise SystemExit('owned memory-entry probe requires macOS')
    source = Path(__file__).with_name('probe_mach_memory_entry_child.c')
    with tempfile.TemporaryDirectory(prefix='owned-memory-entry-') as temporary:
        home = Path(temporary)
        for suffix in census.SUFFIXES:
            (home / '.openclaw' / 'nats' / ('jetstream' + suffix)).mkdir(parents=True)
        block = home / '.openclaw' / 'nats' / 'jetstream' / 'block'
        block.write_bytes(b'0000' + bytes(os.sysconf('SC_PAGESIZE') - 4))
        child_binary = home / 'memory-entry-child'
        subprocess.run(['/usr/bin/clang', '-Wall', '-Wextra', '-O0', str(source),
                        '-o', str(child_binary)], check=True)
        child = subprocess.Popen([str(child_binary), str(block)], stdin=subprocess.PIPE,
                                 stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        flagged = False
        try:
            ready = child.stdout.readline().strip()
            if ready != 'ready':
                raise RuntimeError('memory entry was not created: ' + child.stderr.read())
            identity = (block.stat().st_dev, block.stat().st_ino)
            process = proc.vnode_snapshot(child.pid)
            references = [entry for key in ('vnodes', 'fileports', 'mappings')
                          for entry in process[key]
                          if (entry['device'], entry['inode']) == identity]
            original_snapshot = census.proc.vnode_snapshot
            child_census_reads = []
            def witnessed_snapshot(pid):
                observed = original_snapshot(pid)
                if pid == child.pid:
                    child_census_reads.append(observed)
                return observed
            with patch.object(census.proc, 'vnode_snapshot', side_effect=witnessed_snapshot):
                report = census.observe(home)
            holders = [row for row in report['stores']['ai.openclaw.nats']['holders']
                       if row['pid'] == child.pid]
            if not child_census_reads or child.pid in (report['unreadable_pids'] +
                                                       report['exited_pids']):
                raise RuntimeError('census did not read the owned child')
            child_identity_stable = all(
                (row['start_sec'], row['start_usec']) ==
                (process['start_sec'], process['start_usec'])
                for row in child_census_reads)
            if not child_identity_stable or references or holders:
                raise RuntimeError('owned child census was not reference-free')
            os.chflags(block, stat.UF_IMMUTABLE)
            flagged = True
            refused = False
            try:
                opened = os.open(block, os.O_WRONLY)
            except PermissionError:
                refused = True
            else:
                os.close(opened)
            child.stdin.write('x\n')
            child.stdin.flush()
            outcome = child.stdout.readline().strip()
            child.wait(timeout=5)
            content = block.read_bytes()[:4].decode()
            flag_after = bool(block.stat().st_flags & stat.UF_IMMUTABLE)
            error = child.stderr.read().strip()
            if not (refused and outcome == 'wrote' and child.returncode == 0
                    and content == 'M000' and flag_after):
                raise RuntimeError('memory-entry write control failed: ' + error)
            print(json.dumps({
                'status': 'stimulated',
                'snapshot_references_to_file': len(references),
                'census_holders_for_child': len(holders),
                'child_readable_in_census': True,
                'child_identity_stable': child_identity_stable,
                'new_writable_open_refused': refused,
                'remap_outcome': outcome,
                'child_exit': child.returncode,
                'child_error': error,
                'content_prefix_after': content,
                'immutable_flag_after': flag_after,
                'census_unreadable_pid_count': len(report['unreadable_pids'])},
                sort_keys=True))
        finally:
            if child.poll() is None:
                child.terminate()
                try:
                    child.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    child.kill()
                    child.wait()
            child.stdin.close()
            child.stdout.close()
            child.stderr.close()
            if flagged:
                os.chflags(block, 0)


if __name__ == '__main__':
    main()
