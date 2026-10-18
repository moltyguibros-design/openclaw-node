#!/usr/bin/env python3
import datetime
import hashlib
import fcntl
import json
import os
import pathlib
import plistlib
import shutil
import stat
import subprocess
import sys
import tempfile
import threading
import time
import unittest
from unittest import mock

import host_vm_capture
import host_vm_guard
import stopped_tree_match
from host_guest_commit import commit, commit_checkpoint, encoded, require_committed
from stopped_tree_match import guest_capture, host_match
from host_clone_dispose import cleanup_failed, dispose, sample_files
from host_vm_capture import capture, clone_only, publish_capture_record
from host_vm_guard import guard
from host_image_immutable import change_immutable
from host_vm_preflight import preflight, vmstate_identity, write_record
from host_vm_reconcile import reconcile
from test_host_checkpoint_commit import write_checkpoint_record


HERE = pathlib.Path(__file__).resolve().parent
CAPTURE = HERE / 'host_vm_capture.py'


def run(*args):
    result = subprocess.run(args, capture_output=True)
    if result.returncode:
        raise AssertionError((args, result.stderr.decode(errors='replace')[:500]))
    return result.stdout


def capture_timeline(capture_dir, marks, window):
    """Diagnostic text for a failed native capture; it changes no timing, deadline or assertion.

    Read-only: built from the test's wall-clock marks and the records every real preflight already
    leaves in its sample directory. Phases per sample: setup (directory created until the GUI
    status agent's plist: hdiutil info and hashing), helper (plist until the helper's status
    stamp: launchctl bootstrap, spawn, utmctl), observe (status until the preflight stamp: bootout
    and lsof), tail (until preflight.json or FAILED.json: sysctl and the write).
    """
    def when(text):
        return datetime.datetime.fromisoformat(text).timestamp()

    def read(path):
        try:
            return json.loads(path.read_text())
        except (OSError, ValueError):
            return {}

    origin = marks[0][1]
    rows = [(at, 'mark %s' % label) for label, at in marks]
    armed = read(capture_dir / 'ARMED.json')
    if 'at_utc' in armed:
        rows.append((when(armed['at_utc']), 'ARMED; worker deadline at +%.2fs' % (when(armed['at_utc']) + window - origin)))
    failed = read(capture_dir / 'FAILED.json')
    if failed:
        rows.append(((capture_dir / 'FAILED.json').stat().st_mtime, 'capture FAILED: %s' % failed.get('error')))
    for sample in (capture_dir.iterdir() if capture_dir.is_dir() else ()):
        plist, status = sample / 'utm-status.plist', sample / 'utm-status.json'
        record, refused = sample / 'preflight.json', sample / 'FAILED.json'
        if not sample.is_dir() or not any(path.exists() for path in (plist, record, refused)):
            continue
        # Only known points are timed: without st_birthtime (not macOS) the start is unknown, and a
        # refused sample has no preflight stamp, so its span runs from the helper to FAILED.json.
        points = [('setup', getattr(sample.stat(), 'st_birthtime', None)),
                  ('helper', plist.stat().st_mtime if plist.exists() else None),
                  ('observe', when(read(status)['at_utc']) if 'at_utc' in read(status) else None),
                  ('tail', when(read(record)['at_utc']) if 'at_utc' in read(record) else None),
                  ('end', (record if record.exists() else refused).stat().st_mtime
                   if record.exists() or refused.exists() else None)]
        known = [(name, at) for name, at in points if at is not None]
        phases = ' '.join('%s=%.2f' % (name, after - at) for (name, at), (_, after) in zip(known, known[1:]))
        seen = read(record)
        outcome = ('%s holders=%s' % (seen.get('state'), seen.get('image_holders')) if seen
                   else 'FAILED: %s' % read(refused).get('error') if refused.exists()
                   else 'in progress (no preflight.json or FAILED.json yet)')
        rows.append((known[0][1], '%-44s %s %s' % (sample.name, phases, outcome)))
    return '\ncapture timeline (seconds from worker spawn):\n' + '\n'.join(
        '%+8.2f %s' % (at - origin, text) for at, text in sorted(rows))


LAUNCHCTL = '/bin/launchctl'
PRINTED = ('state', 'pid', 'runs', 'last exit code', 'last exit reason', 'last terminating signal',
           'spawn type', 'job state', 'immediate reason')


def helper_snapshot(capture_dir, worker_pid):
    """Read-only native snapshot of every unfinished GUI status sample; diagnostic only.

    It runs only on a failure path and changes no timing or verdict. Each command is bounded
    to 5 s and only reads: `ps`, and `launchctl print` of the sample's own disposable label.
    The facts separate where the helper contract stopped:
    - a live `launchctl bootstrap` child of the worker: bootstrap has not returned;
    - no client, no helper process and no utm-status.out/.err (launchd creates them when it
      spawns the job): bootstrap returned but the job was not spawned (see launchctl print);
    - utm-status.out/.err present, no helper process, no status: the helper ran and exited
      without a status (see its err text and last exit code);
    - a live helper process with a child: the helper is blocked in utmctl (or its child);
      a live helper without a child: helper startup or its status write.
    """
    def bounded(*command):
        try:
            done = subprocess.run(command, capture_output=True, text=True, timeout=5)
        except subprocess.TimeoutExpired:
            return None, 'timed out after 5 s'
        except OSError as error:
            return None, 'unavailable: %s' % error
        return done.returncode, (done.stdout + done.stderr).strip()

    _, table = bounded('/bin/ps', '-A', '-o', 'pid=,ppid=,stat=,etime=,command=')
    processes = {}
    for line in (table or '').splitlines():
        fields = line.split(None, 4)
        if len(fields) == 5 and fields[0].isdigit() and fields[1].isdigit():
            processes[int(fields[0])] = (int(fields[1]), ' '.join(fields[2:]))

    def descendants(root):
        found, frontier = [], [root]
        while frontier:
            parent = frontier.pop()
            for pid, (ppid, text) in sorted(processes.items()):
                if ppid == parent:
                    found.append('%d %s' % (pid, text[:200]))
                    frontier.append(pid)
        return found

    lines = ['native helper snapshot (read-only, worker pid %s):' % worker_pid]
    client = [row for row in descendants(worker_pid) if 'launchctl' in row and 'bootstrap' in row]
    lines += ['  worker descendants: %s' % (descendants(worker_pid) or 'none')]
    unfinished = [sample for sample in (sorted(capture_dir.iterdir()) if capture_dir.is_dir() else ())
                  if (sample / 'utm-status.plist').exists() and not (sample / 'preflight.json').exists()
                  and not (sample / 'FAILED.json').exists()]
    for sample in unfinished:
        try:
            label = plistlib.loads((sample / 'utm-status.plist').read_bytes())['Label']
        except (OSError, ValueError, KeyError) as error:
            label = 'unreadable (%s)' % error
        status_path = str(sample / 'utm-status.json')
        spawned = [name for name in ('utm-status.out', 'utm-status.err') if (sample / name).exists()]
        files = ', '.join('%s %dB' % (item.name, item.stat().st_size) for item in sorted(sample.iterdir()))
        code, printed = bounded(LAUNCHCTL, 'print', 'gui/%d/%s' % (os.getuid(), label))
        kept = [row.strip() for row in printed.splitlines()
                if row.strip().split(' = ')[0] in PRINTED] if code == 0 else [printed[:300]]
        helpers = [pid for pid, (_, text) in processes.items()
                   if '--utm-status-helper' in text and status_path in text]
        children = [row for pid in helpers for row in descendants(pid)]
        if client:
            reading = 'bootstrap has not returned (live launchctl bootstrap client)'
        elif (sample / 'utm-status.json').exists():
            reading = 'helper status written: the worker is past it (bootout, lsof or sysctl; see descendants)'
        elif helpers and children:
            reading = 'helper running with a child: blocked in utmctl or its child'
        elif helpers:
            reading = 'helper running without a child: helper startup or status write'
        elif spawned:
            reading = 'helper spawned and exited without a status: see err text and last exit code'
        else:
            reading = 'bootstrap returned but the job was not spawned: see launchctl print'
        if code is None:
            reading += '; launchctl print did not answer, so launchd itself was not responding'
        # The worker's bootstrap client is killed by its own 15 s timeout, counted from the plist.
        age = time.time() - (sample / 'utm-status.plist').stat().st_mtime
        if not client and age >= 14.5:
            reading += ('; plist is %.2fs old, so an absent bootstrap client is inconclusive '
                        '(the client may have just hit its 15 s timeout)' % age)
        err = (sample / 'utm-status.err').read_text(errors='replace')[:300] if 'utm-status.err' in spawned else ''
        lines += ['  %s label=%s' % (sample.name, label), '    files: %s' % files,
                  '    launchctl print (exit %s): %s' % (code, '; '.join(kept) or 'no listed fields'),
                  '    helper: %s' % (['%d %s' % (pid, processes[pid][1][:200]) for pid in helpers] or 'none'),
                  '    helper children: %s' % (children or 'none'),
                  '    helper err: %r' % err, '    reading: %s' % reading]
    if not unfinished:
        lines.append('  no unfinished GUI status sample')
    return '\n' + '\n'.join(lines)


class VmstateGateTest(unittest.TestCase):
    def test_host_commit_refuses_a_vm_already_stopped(self):
        with tempfile.TemporaryDirectory(prefix='openclaw-late-guest-commit-') as temporary:
            root = pathlib.Path(temporary).resolve()
            root.chmod(0o700)
            capture_dir = root / 'capture'
            capture_dir.mkdir(mode=0o700)
            (capture_dir / 'before-shutdown').mkdir(mode=0o700)
            nonce = 'a' * 64
            vm_uuid = host_vm_capture.FIXTURE_UUID
            prior = {'state': 'started', 'vm_uuid': vm_uuid,
                     'host_boot_session': 'boot', 'image_device': 1,
                     'image_inode': 2, 'image_size': 3, 'vmstate': None}
            write_record(capture_dir / 'before-shutdown' / 'preflight.json', prior)
            write_record(capture_dir / 'ARMED.json', {
                'scope': 'waiting for external guest shutdown; no stop request issued',
                'capture_nonce': nonce, 'vm_uuid': vm_uuid,
                'host_boot_session': 'boot', 'image_device': 1, 'image_inode': 2,
            })
            spec = root / 'stores.json'
            spec_data = {'data_volume_uuid': '0' * 36,
                         'stores': [{'role': role, 'relative_path': role}
                                    for role in ('standalone', 'member1', 'member2', 'member3')]}
            write_record(spec, spec_data)
            claim = root / 'guest.json'
            write_record(claim, {
                'scope': 'guest stopped-tree content observation; writer exclusion external',
                'at_utc': '2020-01-01T00:00:00+00:00',
                'capture_nonce': nonce, 'journal_head': 'b' * 64,
                'spec_sha256': hashlib.sha256(spec.read_bytes()).hexdigest(),
                'data_volume_uuid': spec_data['data_volume_uuid'],
                'stores': {row['role']: [{'path': 'stream.dat', 'type': 'file',
                                          'size': 1, 'sha256': '0' * 64}]
                           for row in spec_data['stores']},
                'store_paths': {row['role']: str(root / row['relative_path'])
                                for row in spec_data['stores']},
                'store_relative_paths': {row['role']: row['relative_path']
                                         for row in spec_data['stores']},
            })
            active = os.open(capture_dir / 'CAPTURE_ACTIVE.lock',
                             os.O_RDWR | os.O_CREAT | os.O_EXCL, 0o600)
            fcntl.flock(active, fcntl.LOCK_EX)
            try:
                def failed_preflight(_, destination):
                    pathlib.Path(destination).mkdir()
                    raise RuntimeError('temporary host status failure')
                with mock.patch('host_guest_commit.preflight',
                                side_effect=failed_preflight):
                    with self.assertRaisesRegex(RuntimeError,
                                                'temporary host status failure'):
                        commit(root / 'host.json', spec, capture_dir, claim)
                def retry_preflight(_, destination):
                    self.assertFalse(pathlib.Path(destination).exists())
                    return dict(prior, state='stopped')
                with mock.patch('host_guest_commit.preflight',
                                side_effect=retry_preflight):
                    with self.assertRaisesRegex(RuntimeError, 'original running VM'):
                        commit(root / 'host.json', spec, capture_dir, claim)
                started = dict(prior, holders_consistent=True, image_holders=[42])
                stopped = dict(prior, state='stopped', holders_consistent=True,
                               image_holders=[])
                with mock.patch('host_guest_commit.preflight',
                                side_effect=[started, stopped]):
                    with self.assertRaisesRegex(RuntimeError,
                                                'before post-commit host sample'):
                        commit(root / 'host.json', spec, capture_dir, claim)
            finally:
                os.close(active)
            self.assertTrue((capture_dir / 'COMMITTED.json').exists())
            self.assertFalse((capture_dir / 'ACKED.json').exists())
            with self.assertRaisesRegex(RuntimeError, 'ACKED.json'):
                require_committed(capture_dir)
            pid_capture = root / 'pid-change-capture'
            pid_capture.mkdir(mode=0o700)
            (pid_capture / 'before-shutdown').mkdir(mode=0o700)
            write_record(pid_capture / 'before-shutdown' / 'preflight.json', prior)
            write_record(pid_capture / 'ARMED.json',
                         json.loads((capture_dir / 'ARMED.json').read_text()))
            pid_active = os.open(pid_capture / 'CAPTURE_ACTIVE.lock',
                                 os.O_RDWR | os.O_CREAT | os.O_EXCL, 0o600)
            fcntl.flock(pid_active, fcntl.LOCK_EX)
            try:
                with mock.patch('host_guest_commit.preflight', side_effect=[
                        started, dict(started, image_holders=[43])]):
                    with self.assertRaisesRegex(RuntimeError,
                                                'before post-commit host sample'):
                        commit(root / 'host.json', spec, pid_capture, claim)
            finally:
                os.close(pid_active)
            self.assertFalse((pid_capture / 'ACKED.json').exists())

    @unittest.skipUnless(sys.platform == 'darwin', 'macOS image guard requires st_flags')
    def test_guard_holds_arm_lock_through_source_image_access(self):
        with tempfile.TemporaryDirectory(prefix='openclaw-host-capture-lock-') as temporary:
            root = pathlib.Path(temporary).resolve()
            root.chmod(0o700)
            capture_dir = root / 'capture'
            capture_dir.mkdir(mode=0o700)
            source = root / 'source.asif'
            source.write_bytes(b'owned image')
            info = source.stat()
            host = root / 'host.json'
            host.write_text(json.dumps({
                'package': str(root / 'Owned.utm'), 'name': 'Owned',
                'uuid': host_vm_capture.FIXTURE_UUID,
                'image_name': source.name, 'config_sha256': '0' * 64,
                'utmctl': '/tmp/unused', 'utmctl_sha256': '0' * 64,
            }))
            host.chmod(0o600)
            baseline = {
                'vm_uuid': host_vm_capture.FIXTURE_UUID, 'host_boot_session': 'boot',
                'image_device': info.st_dev, 'image_inode': info.st_ino,
                'image_size': info.st_size, 'image': str(source), 'state': 'stopped',
                'holders_consistent': True,
            }
            write_record(capture_dir / 'ARMED.json', {
                'scope': 'waiting for external guest shutdown; no stop request issued',
                'vm_uuid': baseline['vm_uuid'],
                'host_boot_session': baseline['host_boot_session'],
                'image_device': info.st_dev, 'image_inode': info.st_ino,
            })
            before = capture_dir / 'before-shutdown'
            before.mkdir()
            write_record(before / 'preflight.json', baseline)
            with mock.patch.object(host_vm_guard, 'require_active_capture'), \
                    mock.patch.object(host_vm_guard, 'preflight', return_value=baseline), \
                    mock.patch.object(host_vm_guard, 'change_immutable',
                                      side_effect=RuntimeError('guard boundary reached')) as mutate:
                with self.assertRaisesRegex(RuntimeError, 'commitment input is missing'):
                    guard(host, capture_dir, fixture=True)
            mutate.assert_not_called()
            self.assertFalse((capture_dir / 'GUARD_INTENT.json').exists())
            entered, release, sampled = threading.Event(), threading.Event(), threading.Event()
            guard_errors = []
            sample_errors = []

            def source_access(*args):
                with source.open('rb'):
                    entered.set()
                    if not release.wait(5):
                        raise RuntimeError('guard source access was not released')

            def sample(*args, **kwargs):
                sampled.set()
                return baseline

            def run_guard():
                try:
                    guard(host, capture_dir, fixture=True)
                except Exception as error:
                    guard_errors.append(error)

            def run_sample():
                try:
                    host_vm_capture.capture_preflight(host, capture_dir,
                                                      capture_dir / 'sample')
                except Exception as error:
                    sample_errors.append(error)

            with mock.patch.object(host_vm_guard, 'preflight', return_value=baseline), \
                    mock.patch.object(host_vm_guard, 'require_active_capture'), \
                    mock.patch.object(host_vm_guard, 'require_committed'), \
                    mock.patch.object(host_vm_guard, 'change_immutable', side_effect=source_access), \
                    mock.patch.object(host_vm_capture, 'preflight', side_effect=sample):
                guarding = threading.Thread(target=run_guard)
                sampling = threading.Thread(target=run_sample)
                guarding.start()
                try:
                    self.assertTrue(entered.wait(5))
                    sampling.start()
                    self.assertFalse(sampled.wait(0.2))
                finally:
                    release.set()
                    guarding.join(timeout=5)
                    if sampling.ident is not None:
                        sampling.join(timeout=5)
            self.assertFalse(guarding.is_alive())
            self.assertFalse(sampling.is_alive())
            self.assertTrue(sampled.is_set())
            self.assertFalse(sample_errors)
            self.assertEqual(len(guard_errors), 1)
            self.assertIn('VM or source changed after image guard', str(guard_errors[0]))

    def test_guard_lock_delays_capture_status_sample(self):
        with tempfile.TemporaryDirectory(prefix='openclaw-host-guard-sample-') as temporary:
            root = pathlib.Path(temporary).resolve()
            armed = root / 'ARMED.json'
            armed.write_text('{}')
            holder = os.open(armed, os.O_RDONLY)
            fcntl.flock(holder, fcntl.LOCK_EX)
            sampled = threading.Event()
            finished = threading.Event()
            errors = []

            def observe(*args, **kwargs):
                sampled.set()
                return {'state': 'stopped'}

            def worker():
                try:
                    host_vm_capture.capture_preflight(root / 'host.json', root,
                                                      root / 'sample')
                except Exception as error:
                    errors.append(error)
                finally:
                    finished.set()

            thread = threading.Thread(target=worker)
            try:
                with mock.patch.object(host_vm_capture, 'preflight', side_effect=observe):
                    thread.start()
                    self.assertFalse(sampled.wait(0.2))
                    fcntl.flock(holder, fcntl.LOCK_UN)
                    self.assertTrue(sampled.wait(5))
                    self.assertTrue(finished.wait(5))
                self.assertFalse(errors)
            finally:
                fcntl.flock(holder, fcntl.LOCK_UN)
                os.close(holder)
                thread.join(timeout=5)

    def test_guest_capture_refuses_store_spec_rewrite_during_walk(self):
        with tempfile.TemporaryDirectory(prefix='openclaw-guest-spec-rewrite-') as temporary:
            root = pathlib.Path(temporary).resolve()
            stores = []
            for role in ('standalone', 'member1', 'member2', 'member3'):
                relative = 'stores/' + role
                directory = root / relative
                directory.mkdir(parents=True)
                (directory / 'data').write_text(role)
                stores.append({'role': role, 'relative_path': relative})
            spec = root / 'stores.json'
            original = {'data_volume_uuid': 'A' * 36, 'stores': stores}
            spec.write_text(json.dumps(original))
            spec.chmod(0o600)
            swapped = json.loads(json.dumps(original))
            swapped['stores'][2]['relative_path'], swapped['stores'][3]['relative_path'] = (
                swapped['stores'][3]['relative_path'], swapped['stores'][2]['relative_path'])
            original_entries = stopped_tree_match.entries
            def rewrite_after_first_tree(path):
                result = original_entries(path)
                if path == root / stores[0]['relative_path']:
                    spec.write_text(json.dumps(swapped))
                return result
            output = root / 'guest-output'
            with mock.patch.object(stopped_tree_match, 'data_volume_uuid', return_value='A' * 36), \
                    mock.patch.object(stopped_tree_match, 'entries', side_effect=rewrite_after_first_tree):
                with self.assertRaisesRegex(RuntimeError, 'store specification changed'):
                    guest_capture(spec, output, root)
            self.assertTrue((output / 'FAILED.json').exists())
            self.assertFalse((output / 'manifest.json').exists())

    def test_production_capture_requires_decision_controller_before_output_creation(self):
        with tempfile.TemporaryDirectory(prefix='openclaw-host-capture-entry-') as temporary:
            root = pathlib.Path(temporary).resolve()
            durable = root / 'Library/Application Support/OpenClawRecovery'
            durable.mkdir(parents=True, mode=0o700)
            durable.chmod(0o700)
            host = root / 'host.json'
            host.write_text(json.dumps({
                'package': str(root / 'Owned.utm'), 'name': 'Owned',
                'uuid': '00000000-0000-0000-0000-000000000002',
                'image_name': 'image.asif', 'config_sha256': '0' * 64,
                'utmctl': '/tmp/unused', 'utmctl_sha256': '0' * 64,
            }))
            host.chmod(0o600)
            stores = root / 'stores.json'
            stores.write_text(json.dumps({'data_volume_uuid': '0' * 36, 'stores': []}))
            stores.chmod(0o600)
            output = durable / 'capture'
            with mock.patch.object(pathlib.Path, 'home', return_value=root):
                with self.assertRaisesRegex(RuntimeError, 'requires a verified acceptance or abort'):
                    capture(host, stores, output, 5)
            self.assertFalse(output.exists())

    def test_reconcile_refuses_capture_paused_before_clone(self):
        with tempfile.TemporaryDirectory(prefix='openclaw-host-capture-active-') as temporary:
            root = pathlib.Path(temporary).resolve()
            root.chmod(0o700)
            host_spec = root / 'host.json'
            host_spec.write_text(json.dumps({
                'package': str(root / 'Owned.utm'), 'name': 'Owned',
                'uuid': '00000000-0000-0000-0000-000000000002',
                'image_name': '00000000-0000-0000-0000-000000000001.img',
                'config_sha256': '0' * 64, 'utmctl': '/tmp/unused',
                'utmctl_sha256': '0' * 64,
            }))
            host_spec.chmod(0o600)
            store_spec = root / 'stores.json'
            store_spec.write_text(json.dumps({
                'data_volume_uuid': '00000000-0000-0000-0000-000000000003',
                'stores': [{'role': role, 'relative_path': role}
                           for role in ('standalone', 'member1', 'member2', 'member3')],
            }))
            store_spec.chmod(0o600)
            output = root / 'capture'
            source = root / 'source.asif'
            source.write_bytes(b'fixture')
            first = {'state': 'started', 'host_boot_session': 'boot',
                     'image_device': 1, 'image_inode': 2, 'image_size': 3,
                     'image': str(source), 'vm_uuid': '00000000-0000-0000-0000-000000000002',
                     'holders_consistent': True, 'vmstate': None}
            stopped = dict(first, state='stopped')
            observations = 0
            entered, release = threading.Event(), threading.Event()
            errors = []

            def observed_preflight(*args, **kwargs):
                nonlocal observations
                observations += 1
                if observations == 1:
                    write_record(output / 'GUARD.json', {'fixture': True})
                    return first
                return stopped

            def paused_clone(*args):
                entered.set()
                if not release.wait(5):
                    raise RuntimeError('clone fixture was not released')
                raise RuntimeError('clone fixture stopped')

            def worker():
                try:
                    capture(host_spec, store_spec, output, 5, fixture=True)
                except Exception as error:
                    errors.append(error)

            with mock.patch.object(host_vm_capture, 'preflight', observed_preflight), \
                    mock.patch.object(host_vm_capture, 'require_committed'), \
                    mock.patch.object(host_vm_capture, 'guarded_source', return_value='guard-hash'), \
                    mock.patch.object(host_vm_capture, 'clone_only', paused_clone), \
                    mock.patch.object(host_vm_capture.shutil, 'disk_usage',
                                      return_value=mock.Mock(free=30 * 1024 ** 3)):
                thread = threading.Thread(target=worker)
                thread.start()
                try:
                    self.assertTrue(entered.wait(5))
                    with self.assertRaisesRegex(RuntimeError, 'capture worker is still active'):
                        reconcile(host_spec, output, output / 'reconcile-while-cloning',
                                  fixture=True)
                    self.assertTrue((output / 'reconcile-while-cloning' /
                                     'OPERATOR_REQUIRED.json').exists())
                    self.assertFalse((output / 'reconcile-while-cloning' / 'BOOTABLE.json').exists())
                finally:
                    release.set()
                    thread.join(timeout=5)
            self.assertFalse(thread.is_alive())
            self.assertEqual(str(errors[0]), 'clone fixture stopped')
            self.assertTrue((output / 'FAILED.json').exists())

    def test_terminal_failure_waits_for_guard_receipt_lock(self):
        with tempfile.TemporaryDirectory(prefix='openclaw-terminal-lock-') as temporary:
            root = pathlib.Path(temporary).resolve()
            root.chmod(0o700)
            host_spec = root / 'host.json'
            host_spec.write_text(json.dumps({
                'package': str(root / 'Owned.utm'), 'name': 'Owned',
                'uuid': '00000000-0000-0000-0000-000000000002',
                'image_name': '00000000-0000-0000-0000-000000000001.img',
                'config_sha256': '0' * 64, 'utmctl': '/tmp/unused',
                'utmctl_sha256': '0' * 64,
            }))
            host_spec.chmod(0o600)
            store_spec = root / 'stores.json'
            store_spec.write_text(json.dumps({
                'data_volume_uuid': '00000000-0000-0000-0000-000000000003',
                'stores': [{'role': role, 'relative_path': role}
                           for role in ('standalone', 'member1', 'member2', 'member3')],
            }))
            store_spec.chmod(0o600)
            output = root / 'capture'
            before = {'state': 'started', 'host_boot_session': 'boot',
                      'image_device': 1, 'image_inode': 2, 'image_size': 3,
                      'vmstate': None}
            entered, release, failure_write = threading.Event(), threading.Event(), threading.Event()
            errors = []
            original_write = host_vm_capture.write_record

            def observed_preflight(*args, **kwargs):
                if not entered.is_set():
                    return before
                raise RuntimeError('terminal fixture failure')

            def observed_write(path, value):
                if pathlib.Path(path).name == 'ARMED.json':
                    original_write(path, value)
                    entered.set()
                    if not release.wait(5):
                        raise RuntimeError('terminal fixture was not released')
                    return
                if pathlib.Path(path).name == 'FAILED.json':
                    failure_write.set()
                return original_write(path, value)

            def worker():
                try:
                    capture(host_spec, store_spec, output, 1, fixture=True)
                except Exception as error:
                    errors.append(error)

            with mock.patch.object(host_vm_capture, 'preflight', observed_preflight), \
                    mock.patch.object(host_vm_capture, 'write_record', observed_write):
                thread = threading.Thread(target=worker)
                thread.start()
                self.assertTrue(entered.wait(5))
                with (output / 'ARMED.json').open('rb') as armed:
                    fcntl.flock(armed, fcntl.LOCK_EX)
                    release.set()
                    self.assertFalse(failure_write.wait(0.2))
                    self.assertFalse((output / 'FAILED.json').exists())
                thread.join(timeout=5)
            self.assertFalse(thread.is_alive())
            self.assertEqual(str(errors[0]), 'terminal fixture failure')
            self.assertTrue(failure_write.is_set())
            self.assertTrue((output / 'FAILED.json').exists())

    def test_partial_capture_receipt_is_never_published(self):
        with tempfile.TemporaryDirectory(prefix='openclaw-capture-receipt-') as temporary:
            root = pathlib.Path(temporary)
            output = root / 'capture'
            output.mkdir()
            def partial_write(path, value):
                self.assertEqual(path.name, 'CAPTURE.json.tmp')
                self.assertFalse((output / 'CAPTURE.json').exists())
                path.write_text('{"partial":')
                raise OSError('interrupted capture receipt write')

            with mock.patch.object(host_vm_capture, 'write_record', partial_write):
                with self.assertRaisesRegex(OSError, 'interrupted capture receipt write'):
                    publish_capture_record(output, {'verified': True})
            self.assertFalse((output / 'CAPTURE.json').exists())
            self.assertEqual((output / 'CAPTURE.json.tmp').read_text(), '{"partial":')
            (output / 'CAPTURE.json.tmp').unlink()
            publish_capture_record(output, {'verified': True})
            self.assertEqual(json.loads((output / 'CAPTURE.json').read_text()),
                             {'verified': True})

    def test_vmstate_change_refuses_before_clone(self):
        with tempfile.TemporaryDirectory(prefix='openclaw-vmstate-gate-') as temporary:
            root = pathlib.Path(temporary).resolve()
            root.chmod(0o700)
            host_spec = root / 'host.json'
            host_spec.write_text(json.dumps({
                'package': str(root / 'Owned.utm'), 'name': 'Owned',
                'uuid': '00000000-0000-0000-0000-000000000002',
                'image_name': '00000000-0000-0000-0000-000000000001.img',
                'config_sha256': '0' * 64, 'utmctl': '/tmp/unused',
                'utmctl_sha256': '0' * 64,
            }))
            host_spec.chmod(0o600)
            store_spec = root / 'stores.json'
            store_spec.write_text(json.dumps({
                'data_volume_uuid': '00000000-0000-0000-0000-000000000003',
                'stores': [{'role': role, 'relative_path': role}
                           for role in ('standalone', 'member1', 'member2', 'member3')],
            }))
            store_spec.chmod(0o600)
            before = {'state': 'started', 'host_boot_session': 'boot',
                      'image_device': 1, 'image_inode': 2, 'image_size': 3,
                      'vmstate': {'device': 1, 'inode': 4, 'size': 5, 'mtime_ns': 6}}
            stopped = dict(before, state='stopped', holders_consistent=True,
                           vmstate=dict(before['vmstate'], mtime_ns=7))
            output = root / 'capture'
            with mock.patch('host_vm_capture.preflight', side_effect=[before, stopped]):
                with self.assertRaisesRegex(RuntimeError, 'identity changed'):
                    capture(host_spec, store_spec, output, 1, fixture=True)
            self.assertTrue((output / 'FAILED.json').exists())
            self.assertFalse((output / 'CAPTURE.json').exists())
            self.assertFalse((output / 'powered-off-image.asif').exists())

    def scripted_capture(self, states, expected, clone_expected):
        with tempfile.TemporaryDirectory(prefix='openclaw-host-restart-gate-') as temporary:
            root = pathlib.Path(temporary).resolve()
            root.chmod(0o700)
            host_spec = root / 'host.json'
            host_spec.write_text(json.dumps({
                'package': str(root / 'Owned.utm'), 'name': 'Owned',
                'uuid': '00000000-0000-0000-0000-000000000002',
                'image_name': '00000000-0000-0000-0000-000000000001.img',
                'config_sha256': '0' * 64, 'utmctl': '/tmp/unused',
                'utmctl_sha256': '0' * 64,
            }))
            host_spec.chmod(0o600)
            store_spec = root / 'stores.json'
            store_spec.write_text(json.dumps({
                'data_volume_uuid': '00000000-0000-0000-0000-000000000003',
                'stores': [{'role': role, 'relative_path': role}
                           for role in ('standalone', 'member1', 'member2', 'member3')],
            }))
            store_spec.chmod(0o600)
            before = {'state': 'started', 'vm_uuid': '00000000-0000-0000-0000-000000000002',
                      'host_boot_session': 'boot', 'image_device': 1,
                      'image_inode': 2, 'image_size': 3, 'vmstate': None,
                      'image': str(root / 'image')}
            output = root / 'capture'
            samples = iter([before] + [dict(before, **state) for state in states])

            def observed(*args, **kwargs):
                sample = next(samples)
                if sample['state'] == 'stopped' and sample['holders_consistent']:
                    (output / 'GUARD.json').touch()
                return sample

            with mock.patch.object(host_vm_capture, 'preflight', side_effect=observed), \
                    mock.patch.object(host_vm_capture, 'require_committed'), \
                    mock.patch.object(host_vm_capture.time, 'sleep'), \
                    mock.patch.object(host_vm_capture, 'guarded_source',
                                      return_value='owned-guard'), \
                    mock.patch.object(host_vm_capture.shutil, 'disk_usage',
                                      return_value=mock.Mock(free=30 * 1024 ** 3)), \
                    mock.patch.object(host_vm_capture, 'clone_only',
                                      side_effect=RuntimeError('clone boundary reached')) as clone:
                with self.assertRaisesRegex(RuntimeError, expected):
                    capture(host_spec, store_spec, output, 3, fixture=True)
            self.assertEqual(clone.called, clone_expected)
            self.assertTrue((output / 'FAILED.json').exists())
            self.assertFalse((output / 'CAPTURE.json').exists())

    def test_observed_restart_after_stop_refuses_before_clone(self):
        clean = {'state': 'stopped', 'holders_consistent': True, 'image_holders': []}
        running = {'state': 'started', 'holders_consistent': True, 'image_holders': [123]}
        self.scripted_capture([clean, running, clean, clean, clean],
                              'VM restarted after a stopped observation', False)

    def test_holder_reappearing_after_clean_stop_refuses_before_clone(self):
        clean = {'state': 'stopped', 'holders_consistent': True, 'image_holders': []}
        reopened = {'state': 'stopped', 'holders_consistent': False,
                    'image_holders': [123]}
        self.scripted_capture([clean, reopened, clean, clean, clean],
                              'image holder reappeared after clean stop: \\[123\\]', False)

    def test_holder_during_initial_stop_transition_is_allowed(self):
        clean = {'state': 'stopped', 'holders_consistent': True, 'image_holders': []}
        transitional = {'state': 'stopped', 'holders_consistent': False,
                        'image_holders': [123]}
        self.scripted_capture([transitional, clean, clean, clean],
                              'clone boundary reached', True)

    def test_stopped_vm_without_guard_refuses_before_clone(self):
        with tempfile.TemporaryDirectory(prefix='openclaw-vmstate-gate-') as temporary:
            root = pathlib.Path(temporary).resolve()
            root.chmod(0o700)
            host_spec = root / 'host.json'
            host_spec.write_text(json.dumps({
                'package': str(root / 'Owned.utm'), 'name': 'Owned',
                'uuid': '00000000-0000-0000-0000-000000000002',
                'image_name': '00000000-0000-0000-0000-000000000001.img',
                'config_sha256': '0' * 64, 'utmctl': '/tmp/unused',
                'utmctl_sha256': '0' * 64,
            }))
            host_spec.chmod(0o600)
            store_spec = root / 'stores.json'
            store_spec.write_text(json.dumps({
                'data_volume_uuid': '00000000-0000-0000-0000-000000000003',
                'stores': [{'role': role, 'relative_path': role}
                           for role in ('standalone', 'member1', 'member2', 'member3')],
            }))
            store_spec.chmod(0o600)
            before = {'state': 'started', 'host_boot_session': 'boot',
                      'image_device': 1, 'image_inode': 2, 'image_size': 3,
                      'vmstate': None}
            stopped = dict(before, state='stopped', holders_consistent=True)
            output = root / 'capture'
            with mock.patch('host_vm_capture.preflight', side_effect=[before, stopped]), \
                    mock.patch.object(host_vm_capture, 'require_committed'), \
                    mock.patch('host_vm_capture.clone_only') as clone:
                with self.assertRaisesRegex(RuntimeError, 'completed image guard'):
                    capture(host_spec, store_spec, output, 1, fixture=True)
            clone.assert_not_called()
            self.assertTrue((output / 'FAILED.json').exists())
            self.assertFalse((output / 'CAPTURE.json').exists())

    def test_stopped_vm_before_guest_commit_refuses_before_clone(self):
        with tempfile.TemporaryDirectory(prefix='openclaw-no-guest-commit-') as temporary:
            root = pathlib.Path(temporary).resolve()
            root.chmod(0o700)
            host = root / 'host.json'
            write_record(host, {
                'package': str(root / 'Owned.utm'), 'name': 'Owned',
                'uuid': host_vm_capture.FIXTURE_UUID,
                'image_name': '00000000-0000-0000-0000-000000000001.img',
                'config_sha256': '0' * 64, 'utmctl': '/tmp/unused',
                'utmctl_sha256': '0' * 64,
            })
            stores = root / 'stores.json'
            write_record(stores, {
                'data_volume_uuid': '0' * 36,
                'stores': [{'role': role, 'relative_path': role}
                           for role in ('standalone', 'member1', 'member2', 'member3')],
            })
            before = {'state': 'started', 'vm_uuid': host_vm_capture.FIXTURE_UUID,
                      'host_boot_session': 'boot',
                      'image_device': 1, 'image_inode': 2, 'image_size': 3,
                      'vmstate': None, 'holders_consistent': True,
                      'image_holders': [42], 'image': str(root / 'owned.asif')}
            stopped = dict(before, state='stopped', image_holders=[])
            output = root / 'capture'
            observations = 0
            def observed(*args, **kwargs):
                nonlocal observations
                observations += 1
                if observations == 1:
                    return before
                if observations == 2:
                    write_record(output / 'GUARD.json', {'fixture': True})
                return stopped

            with mock.patch.object(host_vm_capture, 'preflight', side_effect=observed), \
                    mock.patch.object(host_vm_capture.time, 'sleep'), \
                    mock.patch.object(host_vm_capture, 'guarded_source', return_value='guard'), \
                    mock.patch.object(host_vm_capture.shutil, 'disk_usage',
                                      return_value=mock.Mock(free=30 * 1024 ** 3)), \
                    mock.patch.object(host_vm_capture, 'clone_only',
                                      side_effect=RuntimeError('clone boundary reached')) as clone:
                with self.assertRaisesRegex(RuntimeError, 'commitment input is missing'):
                    capture(host, stores, output, 1, fixture=True)
            clone.assert_not_called()
            self.assertTrue((output / 'FAILED.json').exists())
            self.assertFalse((output / 'CAPTURE.json').exists())

    def test_vmstate_identity_refuses_link(self):
        with tempfile.TemporaryDirectory(prefix='openclaw-vmstate-path-') as temporary:
            root = pathlib.Path(temporary)
            source = root / 'source'
            source.write_bytes(b'stale')
            self.assertEqual(vmstate_identity(root / 'missing'), None)
            self.assertEqual(vmstate_identity(source)['size'], 5)
            self.assertIn('ctime_ns', vmstate_identity(source))
            (root / 'vmstate').symlink_to(source)
            with self.assertRaisesRegex(RuntimeError, 'regular file'):
                vmstate_identity(root / 'vmstate')


@unittest.skipUnless(sys.platform == 'darwin', 'requires macOS ASIF and GUI launchd')
class HostCaptureTest(unittest.TestCase):
    def setUp(self):
        self.root = pathlib.Path(tempfile.mkdtemp(prefix='openclaw-host-capture-')).resolve()
        os.chmod(self.root, 0o700)
        self.disks = []
        self.processes = []

    def tearDown(self):
        for process in self.processes:
            if process.poll() is None:
                process.terminate()
                process.wait(timeout=5)
        while self.disks:
            self.eject()
        for directory, dirs, files in os.walk(self.root):
            for name in dirs:
                os.chmod(pathlib.Path(directory) / name, 0o700)
            for name in files:
                path = pathlib.Path(directory) / name
                os.chflags(path, 0)
                os.chmod(path, 0o600)
        shutil.rmtree(self.root)

    def eject(self):
        disk = self.disks[-1]
        for _ in range(20):
            result = subprocess.run(['/usr/sbin/diskutil', 'eject', disk], capture_output=True)
            if result.returncode == 0:
                self.disks.pop()
                return
            if b'Volume failed to eject' not in result.stderr:
                raise AssertionError(result.stderr.decode(errors='replace')[:500])
            time.sleep(0.25)
        raise AssertionError(f'disposable image did not eject: {disk}')

    def test_external_stop_then_cold_extract(self):
        package = self.root / 'Owned.utm'
        data = package / 'Data'
        data.mkdir(parents=True)
        (data / 'vmstate').write_bytes(b'old suspend state')
        source = data / '00000000-0000-0000-0000-000000000001.img'
        run('/usr/sbin/diskutil', 'image', 'create', 'blank', '--format', 'ASIF',
            '--size', '128m', '--fs', 'APFS', '--volumeName', 'Data', str(source))
        attached = plistlib.loads(run('/usr/sbin/diskutil', 'image', 'attach', '--plist', str(source)))
        entities = attached['system-entities']
        self.disks.append(entities[0]['dev-entry'])
        volume = next(row for row in entities if row.get('volume-name') == 'Data')
        volume_info = plistlib.loads(run('/usr/sbin/diskutil', 'info', '-plist', volume['dev-entry']))
        mount = pathlib.Path(volume['mount-point'])
        stores = []
        for role in ('standalone', 'member1', 'member2', 'member3'):
            relative = 'Users/moltymac/.openclaw/nats/' + role
            location = mount / relative
            location.mkdir(parents=True)
            (location / 'stream.dat').write_text('owned-' + role)
            if role == 'member2':
                (location / 'données.dat').write_text('owned-unicode')
            stores.append({'role': role, 'relative_path': relative})
        store_spec = self.root / 'store-spec.json'
        store_spec.write_text(json.dumps({'data_volume_uuid': volume_info['VolumeUUID'],
                                          'stores': stores}))
        store_spec.chmod(0o600)
        guest_output = self.root / 'guest-stopped'
        guest_capture(store_spec, guest_output, mount)
        wrong_volume_spec = self.root / 'wrong-guest-volume.json'
        wrong_volume = json.loads(store_spec.read_text())
        wrong_volume['data_volume_uuid'] = '0' * 36
        wrong_volume_spec.write_text(json.dumps(wrong_volume))
        wrong_volume_spec.chmod(0o600)
        wrong_volume_output = self.root / 'wrong-guest-volume'
        with self.assertRaisesRegex(RuntimeError, 'guest store Data volume UUID differs'):
            guest_capture(wrong_volume_spec, wrong_volume_output, mount)
        self.assertFalse((wrong_volume_output / 'manifest.json').exists())
        swapped_spec = json.loads(store_spec.read_text())
        swapped_spec['stores'][1]['relative_path'], swapped_spec['stores'][2]['relative_path'] = (
            swapped_spec['stores'][2]['relative_path'], swapped_spec['stores'][1]['relative_path'])
        swapped_spec_path = self.root / 'swapped-store-spec.json'
        write_record(swapped_spec_path, swapped_spec)
        swapped_guest = self.root / 'swapped-guest-stopped'
        guest_capture(swapped_spec_path, swapped_guest, mount)
        self.eject()
        vm_uuid = '00000000-0000-0000-0000-000000000002'
        config = package / 'config.plist'
        config.write_bytes(plistlib.dumps({
            'Backend': 'Apple', 'Information': {'Name': 'Owned', 'UUID': vm_uuid},
            'Drive': [{'ImageName': source.name, 'ReadOnly': False}],
        }))
        state = self.root / 'state.txt'
        state.write_text('started\n')
        controller = self.root / 'fake-utmctl'
        controller.write_text('#!/bin/sh\n/bin/cat ' + str(state) + '\n')
        controller.chmod(0o700)
        spec = self.root / 'host-spec.json'
        spec.write_text(json.dumps({
            'package': str(package), 'name': 'Owned', 'uuid': vm_uuid,
            'image_name': source.name,
            'config_sha256': hashlib.sha256(config.read_bytes()).hexdigest(),
            'utmctl': str(controller),
            'utmctl_sha256': hashlib.sha256(controller.read_bytes()).hexdigest(),
        }))
        spec.chmod(0o600)
        attached_source = plistlib.loads(run('/usr/sbin/diskutil', 'image', 'attach',
                                              '--plist', '--noMount', str(source)))
        self.disks.append(attached_source['system-entities'][0]['dev-entry'])
        with self.assertRaisesRegex(RuntimeError, 'image remains attached'):
            preflight(spec, self.root / 'source-attached')
        self.assertTrue((self.root / 'source-attached' / 'FAILED.json').exists())
        self.eject()
        unsafe = self.root / 'unsafe-production-path'
        refused_path = subprocess.run([sys.executable, str(CAPTURE), str(spec),
                                       str(store_spec), str(unsafe), '1'], capture_output=True)
        self.assertNotEqual(refused_path.returncode, 0)
        self.assertFalse(unsafe.exists())
        holder = subprocess.Popen([sys.executable, '-c',
                                   'import sys; f=open(sys.argv[1],"rb"); sys.stdin.buffer.read()',
                                   str(source)], stdout=subprocess.DEVNULL,
                                  stderr=subprocess.DEVNULL, stdin=subprocess.PIPE)
        self.processes.append(holder)
        self.addCleanup(holder.stdin.close)
        time.sleep(0.2)
        output = self.root / 'capture'
        worker = subprocess.Popen([sys.executable, str(CAPTURE), str(spec), str(store_spec),
                                   str(output), '20', '--fixture'], stdout=subprocess.DEVNULL,
                                  stderr=subprocess.PIPE)
        marks = [('worker spawned', time.time())]
        self.processes.append(worker)
        deadline = time.monotonic() + 15
        while not (output / 'ARMED.json').exists() and time.monotonic() < deadline:
            if worker.poll() is not None:
                raise AssertionError(worker.stderr.read().decode() + capture_timeline(output, marks, 20)
                                     + helper_snapshot(output, worker.pid))
            time.sleep(0.1)
        marks.append(('arm wait ended', time.time()))
        if not (output / 'ARMED.json').exists():
            self.fail('ARMED.json absent' + capture_timeline(output, marks, 20)
                      + helper_snapshot(output, worker.pid))
        nonce = json.loads((output / 'ARMED.json').read_text())['capture_nonce']
        stale = json.loads((guest_output / 'manifest.json').read_text())
        stale['capture_nonce'] = '0' * 64 if nonce != '0' * 64 else '1' * 64
        stale_path = self.root / 'stale-arm-claim.json'
        write_record(stale_path, stale)
        with self.assertRaisesRegex(RuntimeError, 'does not bind this arm'):
            commit(spec, store_spec, output, stale_path)
        self.assertFalse((output / 'COMMITTED.json').exists())
        observed = json.loads((guest_output / 'manifest.json').read_text())
        observed['capture_nonce'] = nonce
        observed['journal_head'] = 'b' * 64
        (guest_output / 'manifest.json').unlink()
        write_record(guest_output / 'manifest.json', observed)
        marks.append(('stale claim refused', time.time()))
        committed = commit(spec, store_spec, output, guest_output / 'manifest.json')
        marks.append(('manifest committed', time.time()))
        # The guard below needs the separately committed capture-ready digest (D186).
        write_checkpoint_record(self.root / 'guest-checkpoint.json', committed)
        commit_checkpoint(spec, output, self.root / 'guest-checkpoint.json')
        marks.append(('checkpoint committed', time.time()))
        ack_path = output / 'ACKED.json'
        valid_ack = json.loads(ack_path.read_text())
        started = valid_ack['started_sample']
        for label, change in (
                ('holder', {'image_holders': [started['image_holders'][0] + 1]}),
                ('vm', {'vm_uuid': 'ffffffff-ffff-ffff-ffff-ffffffffffff'}),
                ('boot', {'host_boot_session': 'different-boot'}),
                ('image', {'image_inode': started['image_inode'] + 1}),
                ('image-device', {'image_device': started['image_device'] + 1}),
                ('image-size', {'image_size': started['image_size'] + 1}),
                ('vmstate', {'vmstate': {'changed': True}}),
                ('state', {'state': 'stopped'}),
                ('holders-consistent', {'holders_consistent': False})):
            with self.subTest(ack_identity=label):
                changed = json.loads(json.dumps(valid_ack))
                changed['started_sample'].update(change)
                ack_path.unlink()
                write_record(ack_path, changed)
                with self.assertRaisesRegex(RuntimeError,
                                            'matching post-commit host sample'):
                    require_committed(output)
                ack_path.unlink()
                write_record(ack_path, valid_ack)
        changed_ack = dict(valid_ack, manifest_sha256='0' * 64)
        ack_path.unlink()
        write_record(ack_path, changed_ack)
        with self.assertRaisesRegex(RuntimeError, 'matching post-commit host sample'):
            require_committed(output)
        ack_path.unlink()
        write_record(ack_path, valid_ack)
        ack_path.unlink()
        write_record(ack_path, dict(valid_ack, scope='wrong scope'))
        with self.assertRaisesRegex(RuntimeError, 'matching post-commit host sample'):
            require_committed(output)
        ack_path.unlink()
        write_record(ack_path, valid_ack)
        with (output / 'CAPTURE_ACTIVE.lock').open('rb') as active:
            with self.assertRaises(BlockingIOError):
                fcntl.flock(active, fcntl.LOCK_EX | fcntl.LOCK_NB)
        marks.append(('ack checks done', time.time()))
        holder.terminate()
        holder.wait(timeout=5)
        marks.append(('holder terminated', time.time()))
        with self.assertRaisesRegex(RuntimeError, 'holder|disagree'):
            guard(spec, output, fixture=True)
        self.assertFalse((output / 'GUARD_INTENT.json').exists())
        self.assertFalse(source.lstat().st_flags & stat.UF_IMMUTABLE)
        marks.append(('running guard refused', time.time()))
        state.write_text('stopped\n')
        marks.append(('external stop', time.time()))
        guard(spec, output, fixture=True)
        marks.append(('guard completed', time.time()))
        _, stderr = worker.communicate(timeout=30)
        marks.append(('worker exited', time.time()))
        if worker.returncode != 0:
            self.fail('worker exited %s: %s' % (worker.returncode, stderr.decode())
                      + capture_timeline(output, marks, 20) + helper_snapshot(output, worker.pid))
        with (output / 'CAPTURE_ACTIVE.lock').open('rb') as active:
            fcntl.flock(active, fcntl.LOCK_EX | fcntl.LOCK_NB)
        for name in ('before-shutdown', 'after-guard'):
            native_sample = output / name
            ingested = sample_files(native_sample)
            self.assertTrue({'utm-status.out', 'utm-status.err'} <= set(ingested))
            for log in ('utm-status.out', 'utm-status.err'):
                self.assertEqual(stat.S_IMODE((native_sample / log).stat().st_mode), 0o600)
        result = json.loads((output / 'CAPTURE.json').read_text())
        self.assertEqual(result['vm_state_at_final_check'], 'stopped')
        self.assertNotEqual(result['scope'],
                            'sampled stopped-state image extraction; uninterrupted power-off, '
                            'clean shutdown and master acceptance external')
        self.assertEqual(result['vmstate_at_arm'], result['vmstate_at_final_check'])
        self.assertEqual(result['guard_receipt_sha256'],
                         hashlib.sha256((output / 'GUARD.json').read_bytes()).hexdigest())
        self.assertEqual(result['guest_commit_sha256'],
                         hashlib.sha256((output / 'COMMITTED.json').read_bytes()).hexdigest())
        self.assertEqual(result['guest_ack_sha256'],
                         hashlib.sha256((output / 'ACKED.json').read_bytes()).hexdigest())
        self.assertEqual(result['guest_checkpoint_sha256'],
                         hashlib.sha256((output / 'CHECKPOINT.json').read_bytes()).hexdigest())
        self.assertEqual(result['store_spec_sha256'],
                         hashlib.sha256(store_spec.read_bytes()).hexdigest())
        self.assertEqual(result['vmstate_at_arm']['size'], len(b'old suspend state'))
        self.assertFalse((output / 'FAILED.json').exists())
        for role in ('standalone', 'member1', 'member2', 'member3'):
            self.assertEqual((output / 'extracted-stores' / role / 'stream.dat').read_text(),
                             'owned-' + role)
        changed_store = output / 'extracted-stores' / 'member2' / 'stream.dat'
        original_store = changed_store.read_bytes()
        extract_path = output / 'extracted-stores' / 'manifest.json'
        original_extract = extract_path.read_bytes()
        capture_path = output / 'CAPTURE.json'
        original_capture = capture_path.read_bytes()
        changed_store.write_bytes(b'post-commit-write')
        changed_extract = json.loads(original_extract)
        changed_rows = changed_extract['stores']['member2']
        changed_file = next(row for row in changed_rows if row['path'] == 'stream.dat')
        changed_file['size'] = changed_store.stat().st_size
        changed_file['sha256'] = hashlib.sha256(changed_store.read_bytes()).hexdigest()
        extract_path.unlink()
        write_record(extract_path, changed_extract)
        changed_capture = json.loads(original_capture)
        changed_capture['extraction_manifest_sha256'] = hashlib.sha256(
            extract_path.read_bytes()).hexdigest()
        capture_path.unlink()
        write_record(capture_path, changed_capture)
        with self.assertRaisesRegex(RuntimeError,
                                    'guest, extraction manifest and host tree differ: member2'):
            host_match(guest_output / 'manifest.json', output / 'extracted-stores',
                       self.root / 'post-commit-byte-change')
        updated_guest = json.loads((guest_output / 'manifest.json').read_text())
        updated_guest['stores']['member2'] = stopped_tree_match.entries(
            output / 'extracted-stores' / 'member2')
        updated_path = self.root / 'post-commit-updated-guest.json'
        write_record(updated_path, updated_guest)
        with self.assertRaisesRegex(RuntimeError, 'running-VM commitment'):
            host_match(updated_path, output / 'extracted-stores',
                       self.root / 'post-commit-updated-guest-match')
        changed_store.write_bytes(original_store)
        extract_path.write_bytes(original_extract)
        capture_path.write_bytes(original_capture)
        matched = self.root / 'matched'
        host_match(guest_output / 'manifest.json', output / 'extracted-stores', matched)
        self.assertTrue((matched / 'MATCH.json').exists())
        match = json.loads((matched / 'MATCH.json').read_text())
        self.assertEqual(match['checkpoint_sha256'],
                         json.loads((output / 'CHECKPOINT.json').read_text())['checkpoint_sha256'])
        guest_manifest = json.loads((guest_output / 'manifest.json').read_text())
        guest_rows = guest_manifest['stores']
        for role in ('standalone', 'member1', 'member2', 'member3'):
            self.assertEqual(match['masters'][role]['path'],
                             str((output / 'extracted-stores' / role).resolve()))
            self.assertEqual(match['masters'][role]['guest_path'],
                             guest_manifest['store_paths'][role])
            self.assertEqual(match['masters'][role]['sha256'], hashlib.sha256(
                json.dumps(stopped_tree_match.entries(output / 'extracted-stores' / role),
                           ensure_ascii=False,
                           separators=(',', ':')).encode()).hexdigest())
        node = shutil.which('node')
        self.assertIsNotNone(node)
        script = ('import { hashTree } from ' + json.dumps((HERE / 'recovery.mjs').as_uri())
                  + '; import { createHash } from "node:crypto"; '
                  + 'console.log(JSON.stringify(process.argv.slice(1).map(dir => { '
                  + 'const rows = hashTree(dir); return { rows, sha256: '
                  + 'createHash("sha256").update(JSON.stringify(rows)).digest("hex") }; })));')
        roles = ('standalone', 'member1', 'member2', 'member3')
        node_results = json.loads(subprocess.check_output([node, '--input-type=module', '-e',
            script, *(str(output / 'extracted-stores' / role) for role in roles)]))
        self.assertEqual([result['rows'] for result in node_results],
                         [guest_rows[role] for role in roles])
        node_digests = [result['sha256'] for result in node_results]
        self.assertEqual(node_digests, [match['masters'][role]['sha256'] for role in roles])
        original_freeze = stopped_tree_match.freeze
        for name, input_path in (
                ('guest', guest_output / 'manifest.json'),
                ('capture', output / 'CAPTURE.json'),
                ('extract', output / 'extracted-stores' / 'manifest.json'),
                ('guard', output / 'GUARD.json'),
                ('committed', output / 'COMMITTED.json'),
                ('ack', output / 'ACKED.json'),
                ('checkpoint', output / 'CHECKPOINT.json')):
            original_bytes = input_path.read_bytes()
            changed = False
            def mutate_after_validation(root):
                nonlocal changed
                original_freeze(root)
                if not changed:
                    input_path.write_bytes(original_bytes + b' ')
                    changed = True
            refused = self.root / f'changed-{name}-during-match'
            try:
                with mock.patch.object(stopped_tree_match, 'freeze',
                                       side_effect=mutate_after_validation):
                    with self.assertRaisesRegex(RuntimeError,
                                                'input receipts changed during match'):
                        host_match(guest_output / 'manifest.json',
                                   output / 'extracted-stores', refused)
                self.assertTrue(changed)
                self.assertTrue((refused / 'FAILED.json').exists())
                self.assertFalse((refused / 'MATCH.json').exists())
            finally:
                input_path.write_bytes(original_bytes)
        swapped_match = self.root / 'swapped-guest-match'
        with self.assertRaisesRegex(RuntimeError, 'running-VM commitment'):
            host_match(swapped_guest / 'manifest.json', output / 'extracted-stores', swapped_match)
        self.assertTrue((swapped_match / 'FAILED.json').exists())
        self.assertFalse((swapped_match / 'MATCH.json').exists())
        def match_claimed(candidate, destination):
            data = candidate.read_bytes()
            names = ('COMMITTED.json', 'ACKED.json', 'CHECKPOINT.json', 'CAPTURE.json')
            original = {name: (output / name).read_bytes() for name in names}
            records = {name: json.loads(raw) for name, raw in original.items()}
            manifest_sha = hashlib.sha256(data).hexdigest()
            records['COMMITTED.json'].update(manifest=json.loads(data), manifest_sha256=manifest_sha)
            def raw(name):
                return encoded(records[name])
            records['ACKED.json'].update(commit_sha256=hashlib.sha256(raw('COMMITTED.json')).hexdigest(),
                                         manifest_sha256=manifest_sha)
            records['CHECKPOINT.json'].update(
                commit_sha256=hashlib.sha256(raw('COMMITTED.json')).hexdigest(),
                ack_sha256=hashlib.sha256(raw('ACKED.json')).hexdigest(),
                manifest_sha256=manifest_sha)
            for key, name in (('guest_commit_sha256', 'COMMITTED.json'),
                              ('guest_ack_sha256', 'ACKED.json'),
                              ('guest_checkpoint_sha256', 'CHECKPOINT.json')):
                records['CAPTURE.json'][key] = hashlib.sha256(raw(name)).hexdigest()
            try:
                for name in names:
                    (output / name).write_bytes(raw(name))
                require_committed(output)
                return host_match(candidate, output / 'extracted-stores', destination)
            finally:
                for name, value in original.items():
                    (output / name).write_bytes(value)
        swapped_claim = json.loads((swapped_guest / 'manifest.json').read_bytes())
        swapped_claim.update(capture_nonce=nonce, journal_head=guest_manifest['journal_head'])
        (swapped_guest / 'manifest.json').unlink()
        write_record(swapped_guest / 'manifest.json', swapped_claim)
        with self.assertRaisesRegex(RuntimeError, 'guest store specification differs'):
            match_claimed(swapped_guest / 'manifest.json', self.root / 'swapped-spec-check')
        original_guest = json.loads((guest_output / 'manifest.json').read_text())
        regenerated = json.loads(json.dumps(original_guest))
        regenerated['stores']['member2'][0]['sha256'] = '0' * 64
        regenerated_path = self.root / 'post-commit-regenerated.json'
        write_record(regenerated_path, regenerated)
        with self.assertRaisesRegex(RuntimeError, 'running-VM commitment'):
            host_match(regenerated_path, output / 'extracted-stores',
                       self.root / 'post-commit-regenerated-match')
        relabeled_guest = json.loads(json.dumps(original_guest))
        relabeled_guest['store_paths']['member2'], relabeled_guest['store_paths']['member3'] = (
            relabeled_guest['store_paths']['member3'], relabeled_guest['store_paths']['member2'])
        relabeled_guest_path = self.root / 'relabeled-guest.json'
        write_record(relabeled_guest_path, relabeled_guest)
        relabeled_match = self.root / 'relabeled-guest-match'
        with self.assertRaisesRegex(RuntimeError, 'guest store role path differs'):
            match_claimed(relabeled_guest_path, relabeled_match)
        self.assertFalse((relabeled_match / 'MATCH.json').exists())
        for label, changes, refusal in (
                ('wrong-guest-scope', {'scope': 'host-generated content observation'},
                 'guest stopped-tree scope differs'),
                ('wrong-guest-spec', {'spec_sha256': 'f' * 64},
                 'guest store specification differs')):
            candidate = self.root / f'{label}.json'
            write_record(candidate, dict(original_guest, **changes))
            refused = self.root / f'{label}-match'
            with self.assertRaisesRegex(RuntimeError, refusal):
                match_claimed(candidate, refused)
            self.assertTrue((refused / 'FAILED.json').exists())
            self.assertFalse((refused / 'MATCH.json').exists())
        for name, moment in (('old', '2020-01-01T00:00:00+00:00'),
                             ('ahead', '2030-01-01T00:00:00+00:00')):
            candidate = self.root / f'{name}-clock.json'
            write_record(candidate, dict(original_guest, at_utc=moment))
            result = match_claimed(candidate, self.root / f'{name}-clock-match')
            self.assertEqual(set(result['masters']), {'standalone', 'member1', 'member2', 'member3'})
        guard_receipt = output / 'GUARD.json'
        committed_path = output / 'COMMITTED.json'
        committed_bytes = committed_path.read_bytes()
        committed_path.write_bytes(committed_bytes + b' ')
        with self.assertRaisesRegex(RuntimeError, 'capture receipt'):
            host_match(guest_output / 'manifest.json', output / 'extracted-stores',
                       self.root / 'changed-guest-commit')
        committed_path.write_bytes(committed_bytes)
        ack_path = output / 'ACKED.json'
        ack_bytes = ack_path.read_bytes()
        ack_path.write_bytes(ack_bytes + b' ')
        with self.assertRaisesRegex(RuntimeError, 'capture receipt'):
            host_match(guest_output / 'manifest.json', output / 'extracted-stores',
                       self.root / 'changed-guest-ack')
        ack_path.write_bytes(ack_bytes)
        checkpoint_path = output / 'CHECKPOINT.json'
        checkpoint_bytes = checkpoint_path.read_bytes()
        substituted = dict(json.loads(checkpoint_bytes), checkpoint_sha256='0' * 64)
        checkpoint_path.unlink()
        write_record(checkpoint_path, substituted)
        require_committed(output)
        with self.assertRaisesRegex(RuntimeError, 'capture receipt'):
            host_match(guest_output / 'manifest.json', output / 'extracted-stores',
                       self.root / 'substituted-checkpoint')
        checkpoint_path.write_bytes(checkpoint_bytes)
        original_guard_receipt = guard_receipt.read_bytes()
        guard_receipt.write_bytes(original_guard_receipt + b' ')
        with self.assertRaisesRegex(RuntimeError, 'capture receipt'):
            host_match(guest_output / 'manifest.json', output / 'extracted-stores',
                       self.root / 'wrong-guard')
        guard_receipt.write_bytes(original_guard_receipt)
        capture_receipt = output / 'CAPTURE.json'
        original_receipt = capture_receipt.read_bytes()
        old_receipt = json.loads(original_receipt)
        old_receipt['scope'] = ('sampled stopped-state image extraction; uninterrupted '
                                'power-off, clean shutdown and master acceptance external')
        capture_receipt.write_text(json.dumps(old_receipt))
        with self.assertRaisesRegex(RuntimeError, 'capture receipt'):
            host_match(guest_output / 'manifest.json', output / 'extracted-stores',
                       self.root / 'old-scope')
        capture_receipt.write_bytes(original_receipt)
        changed_receipt = json.loads(original_receipt)
        changed_receipt['clone_image_sha256'] = '0' * 64
        capture_receipt.write_text(json.dumps(changed_receipt))
        with self.assertRaisesRegex(RuntimeError, 'capture receipt'):
            host_match(guest_output / 'manifest.json', output / 'extracted-stores',
                       self.root / 'wrong-capture')
        capture_receipt.write_bytes(original_receipt)
        standalone = output / 'extracted-stores' / 'standalone'
        os.chmod(standalone, 0o700)
        file = standalone / 'stream.dat'
        os.chmod(file, 0o600)
        file.write_text('altered')
        mismatch = self.root / 'mismatch'
        with self.assertRaises(RuntimeError):
            host_match(guest_output / 'manifest.json', output / 'extracted-stores', mismatch)
        self.assertTrue((mismatch / 'FAILED.json').exists())
        self.assertFalse((mismatch / 'MATCH.json').exists())

        state.write_text('started\n')
        second_holder = subprocess.Popen([sys.executable, '-c',
                                          'import sys; f=open(sys.argv[1],"rb"); sys.stdin.buffer.read()',
                                          str(source)], stdout=subprocess.DEVNULL,
                                         stderr=subprocess.DEVNULL, stdin=subprocess.PIPE)
        self.processes.append(second_holder)
        self.addCleanup(second_holder.stdin.close)
        time.sleep(0.2)
        refused = self.root / 'no-shutdown'
        no_stop = subprocess.run([sys.executable, str(CAPTURE), str(spec), str(store_spec),
                                  str(refused), '1', '--fixture'], capture_output=True)
        self.assertNotEqual(no_stop.returncode, 0)
        self.assertTrue((refused / 'FAILED.json').exists())
        self.assertFalse((refused / 'CAPTURE.json').exists())
        self.assertFalse((refused / 'powered-off-image.asif').exists())
        with self.assertRaisesRegex(RuntimeError, 'already ended'):
            guard(spec, refused, fixture=True)
        self.assertFalse((refused / 'GUARD_INTENT.json').exists())

        with self.assertRaisesRegex(RuntimeError, 'stopped VM'):
            dispose(spec, output, output / 'dispose-while-running', fixture=True)
        self.assertTrue((output / 'dispose-while-running' / 'FAILED.json').exists())
        self.assertFalse((output / 'dispose-while-running' / 'DISPOSE.json').exists())
        self.assertTrue((output / 'powered-off-image.asif').exists())

        second_holder.terminate()
        second_holder.wait(timeout=5)
        state.write_text('stopped\n')
        clone = output / 'powered-off-image.asif'
        with open(clone, 'r+b') as changed:
            changed.write(b'X')
        with self.assertRaisesRegex(RuntimeError, 'temporary clone changed'):
            dispose(spec, output, output / 'dispose-changed-clone', fixture=True)
        self.assertTrue((output / 'dispose-changed-clone' / 'FAILED.json').exists())
        self.assertTrue(clone.exists())
        clone.unlink()
        clone_only(source, clone)
        info = clone.lstat()
        change_immutable(clone, (info.st_dev, info.st_ino, info.st_size), False)
        clone.chmod(0o600)
        attached_clone = plistlib.loads(run('/usr/sbin/diskutil', 'image', 'attach', '--plist',
                                             '--readOnly', '--noMount', str(clone)))
        self.disks.append(attached_clone['system-entities'][0]['dev-entry'])
        with self.assertRaisesRegex(RuntimeError, 'attached'):
            dispose(spec, output, output / 'dispose-attached', fixture=True)
        self.assertTrue(clone.exists())
        self.assertTrue((output / 'dispose-attached' / 'FAILED.json').exists())
        self.assertFalse((output / 'dispose-attached' / 'DISPOSE.json').exists())
        self.eject()
        with self.assertRaisesRegex(RuntimeError, 'requires verified acceptance or abort'):
            dispose(spec, output, output / 'dispose-after-stop', fixture=True)
        self.assertTrue((output / 'dispose-after-stop' / 'FAILED.json').exists())
        self.assertFalse((output / 'dispose-after-stop' / 'DISPOSE.json').exists())
        self.assertTrue(clone.exists())
        with self.assertRaisesRegex(RuntimeError, 'requires verified acceptance or abort'):
            reconcile(spec, output, output / 'bootable', fixture=True)
        self.assertTrue((output / 'bootable' / 'OPERATOR_REQUIRED.json').exists())
        self.assertFalse((output / 'bootable' / 'BOOTABLE.json').exists())
        self.assertTrue(clone.exists())
        self.assertTrue(source.lstat().st_flags & stat.UF_IMMUTABLE)
        os.chflags(clone, clone.lstat().st_flags & ~stat.UF_IMMUTABLE)
        clone.unlink()
        os.chflags(source, source.lstat().st_flags & ~stat.UF_IMMUTABLE)
        for directory, children, _ in os.walk(output):
            for child in children:
                os.chmod(pathlib.Path(directory) / child, 0o700)
        shutil.rmtree(output)

        wrong_store_spec = self.root / 'wrong-store-spec.json'
        wrong_store_spec.write_text(json.dumps({
            'data_volume_uuid': '00000000-0000-0000-0000-000000000000',
            'stores': stores,
        }))
        wrong_store_spec.chmod(0o600)
        state.write_text('started\n')
        third_holder = subprocess.Popen([sys.executable, '-c',
                                         'import sys; f=open(sys.argv[1],"rb"); sys.stdin.buffer.read()',
                                         str(source)], stdout=subprocess.DEVNULL,
                                        stderr=subprocess.DEVNULL, stdin=subprocess.PIPE)
        self.processes.append(third_holder)
        self.addCleanup(third_holder.stdin.close)
        time.sleep(0.2)
        failed_capture = self.root / 'failed-capture'
        failed_worker = subprocess.Popen([sys.executable, str(CAPTURE), str(spec),
                                          str(wrong_store_spec), str(failed_capture), '20', '--fixture'],
                                         stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
        self.processes.append(failed_worker)
        deadline = time.monotonic() + 15
        while not (failed_capture / 'ARMED.json').exists() and time.monotonic() < deadline:
            if failed_worker.poll() is not None:
                raise AssertionError(failed_worker.stderr.read().decode())
            time.sleep(0.1)
        self.assertTrue((failed_capture / 'ARMED.json').exists())
        failed_nonce = json.loads((failed_capture / 'ARMED.json').read_text())['capture_nonce']
        wrong_claim = dict(original_guest,
                           capture_nonce=failed_nonce,
                           spec_sha256=hashlib.sha256(wrong_store_spec.read_bytes()).hexdigest(),
                           data_volume_uuid='00000000-0000-0000-0000-000000000000')
        wrong_claim_path = self.root / 'wrong-volume-claim.json'
        write_record(wrong_claim_path, wrong_claim)
        failed_committed = commit(spec, wrong_store_spec, failed_capture, wrong_claim_path)
        write_checkpoint_record(self.root / 'failed-guest-checkpoint.json', failed_committed)
        commit_checkpoint(spec, failed_capture, self.root / 'failed-guest-checkpoint.json')
        third_holder.terminate()
        third_holder.wait(timeout=5)
        state.write_text('stopped\n')
        guard(spec, failed_capture, fixture=True)
        failed_worker.communicate(timeout=30)
        self.assertNotEqual(failed_worker.returncode, 0)
        self.assertTrue((failed_capture / 'FAILED.json').exists())
        self.assertFalse((failed_capture / 'CAPTURE.json').exists())
        failed_clone = failed_capture / 'powered-off-image.asif'
        self.assertTrue(failed_clone.exists())

        attached_clone = plistlib.loads(run('/usr/sbin/diskutil', 'image', 'attach', '--plist',
                                             '--readOnly', '--noMount', str(failed_clone)))
        self.disks.append(attached_clone['system-entities'][0]['dev-entry'])
        with self.assertRaisesRegex(RuntimeError, 'attached'):
            cleanup_failed(spec, failed_capture, failed_capture / 'cleanup-attached', fixture=True)
        self.assertTrue(failed_clone.exists())
        self.eject()
        info = failed_clone.lstat()
        change_immutable(failed_clone, (info.st_dev, info.st_ino, info.st_size), True)
        cleaned = cleanup_failed(spec, failed_capture, failed_capture / 'cleanup-detached',
                                 fixture=True)
        self.assertTrue(cleaned['clone_absent'])
        self.assertTrue((failed_capture / 'cleanup-detached' / 'CLEANUP.json').exists())
        self.assertFalse(failed_clone.exists())
        self.assertTrue(source.exists())
        self.assertFalse(reconcile(spec, failed_capture, failed_capture / 'bootable',
                                   fixture=True)['capture_completed'])


if __name__ == '__main__':
    unittest.main()
