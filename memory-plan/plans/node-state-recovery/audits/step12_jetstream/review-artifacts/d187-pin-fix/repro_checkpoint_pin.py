"""Owned differential repro for the D187 CHECKPOINT pin fix (review artifact; not part of the patch).

Each test asserts the CORRECT behavior. On the delivered combined v2 tree, R1, R2, R4 and R5 fail
(the defect and two latent native end-to-end expectations); R3 and R6 are controls that pass on
both trees. On v2 plus the D187 incremental patch, all six pass.

    STEP12=<tree>/memory-plan/plans/node-state-recovery/audits/step12_jetstream \
        python3 -m unittest -v repro_checkpoint_pin

The guest journal and capture-ready record, commit(), commit_checkpoint(), the capture worker,
host_match() and verify_frozen_checkpoint() are the tree's real code. Owned stand-ins, host-side
only: VM power/holder samples (preflight), the guard receipt (the real guard needs macOS
st_flags), the APFS clone, the immutable flag and the ASIF extraction. Nothing touches a VM,
launchd job, NATS server, store or production path.
"""
import copy
import hashlib
import json
import os
import shutil
import sys
import threading
import time
import types
import unittest
from unittest import mock

sys.path.insert(0, os.environ['STEP12'])

import host_guest_commit  # noqa: E402
import host_vm_capture  # noqa: E402
import host_vm_guard  # noqa: E402
import stopped_tree_match  # noqa: E402
import test_capture_checkpoint as guest  # noqa: E402
import test_nats_identity as identity_fixture  # noqa: E402
from host_guest_commit import commit, commit_checkpoint, require_committed, verify_frozen_checkpoint  # noqa: E402
from host_vm_preflight import write_record  # noqa: E402

STORE_BYTES = b'owned stopped store'
ROWS = [{'path': 'stream.dat', 'type': 'file', 'size': len(STORE_BYTES),
         'sha256': hashlib.sha256(STORE_BYTES).hexdigest()}]
RUNNING = {'state': 'started', 'vm_uuid': host_vm_capture.FIXTURE_UUID, 'host_boot_session': 'boot',
           'vmstate': None, 'holders_consistent': True, 'image_holders': [42]}


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def write_private(path, raw):
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, 'wb') as handle:
        handle.write(raw)


def drive_capture_worker(parent, store_spec, while_running):
    """The tree's real capture worker, run to publication with only the stand-ins listed above."""
    parent.mkdir(mode=0o700)
    source = parent / 'source.img'
    write_private(source, b'owned stand-in image bytes')
    info = source.stat()
    host = parent / 'host.json'
    write_record(host, {'package': str(parent / 'Owned.utm'), 'name': 'Owned',
                        'uuid': host_vm_capture.FIXTURE_UUID, 'image_name': source.name,
                        'config_sha256': '0' * 64, 'utmctl': '/usr/bin/false', 'utmctl_sha256': '0' * 64})
    running = dict(RUNNING, image=str(source), image_device=info.st_dev, image_inode=info.st_ino,
                   image_size=info.st_size)
    output = parent / 'capture'
    stopped = threading.Event()

    def sampled(_spec, destination, **_options):
        value = dict(running, state='stopped', image_holders=[]) if stopped.is_set() else running
        destination.mkdir(mode=0o700)
        write_record(destination / 'preflight.json', value)
        return value

    def extracted(_clone, spec_path, destination):
        destination.mkdir(mode=0o700)
        for role in stopped_tree_match.ROLES:
            (destination / role).mkdir(mode=0o700)
            write_private(destination / role / 'stream.dat', STORE_BYTES)
        spec = json.loads(spec_path.read_bytes())
        stores = {role: ROWS for role in stopped_tree_match.ROLES}
        write_record(destination / 'manifest.json', {'image_sha256': spec['image_sha256'],
                                                     'data_volume_uuid': spec['data_volume_uuid'],
                                                     'stores': stores})
        return {'stores': stores}

    errors = []

    def worker():
        try:
            host_vm_capture.capture(host, store_spec, output, 30, fixture=True)
        except Exception as error:
            errors.append(error)

    pause = time.sleep
    with mock.patch.object(host_vm_capture, 'preflight', sampled), \
            mock.patch.object(host_guest_commit, 'preflight', sampled), \
            mock.patch.object(host_vm_capture, 'time',
                              types.SimpleNamespace(monotonic=time.monotonic, sleep=lambda _: pause(.005))), \
            mock.patch.object(host_vm_capture, 'shutil',
                              types.SimpleNamespace(disk_usage=lambda _: types.SimpleNamespace(free=30 << 30))), \
            mock.patch.object(host_vm_capture, 'guarded_source',
                              lambda capture_dir, *_: host_vm_capture.file_hash(capture_dir / 'GUARD.json')), \
            mock.patch.object(host_vm_capture, 'clone_only', shutil.copyfile), \
            mock.patch.object(host_vm_capture, 'change_immutable', lambda *_: None), \
            mock.patch.object(host_vm_capture, 'extract', extracted):
        thread = threading.Thread(target=worker)
        thread.start()
        deadline = time.monotonic() + 10
        while not (output / 'power-0000').exists() and thread.is_alive() and time.monotonic() < deadline:
            pause(.005)
        try:
            while_running(output)
            write_record(output / 'GUARD.json', {'scope': 'stopped source image guarded; no clone or VM start'})
        finally:
            stopped.set()
        thread.join(30)
    if errors:
        raise errors[0]
    return output


class ReproCheckpointPin(guest.CaptureCheckpoint):
    def setUp(self):
        super().setUp()
        self.spec = self.temp / 'stores.json'
        write_record(self.spec, {'data_volume_uuid': 'A' * 36, 'stores': [
            {'role': role, 'relative_path': identity_fixture.STORES[guest.UNIT_OF[role]][1:]}
            for role in sorted(guest.UNIT_OF)]})
        self.matches = self.temp / 'matches'
        self.matches.mkdir(mode=0o700)

    def captured(self):
        """Real journal, real commit()/commit_checkpoint() while the worker samples the VM running."""
        def while_running(output):
            self.armed = (output / 'ARMED.json').read_bytes()
            self.nonce = json.loads(self.armed)['capture_nonce']
            self.build()
            manifest = self.manifest(spec_sha256=sha(self.spec.read_bytes()),
                                     stores={role: ROWS for role in stopped_tree_match.ROLES})
            self.guest_path = self.temp / 'guest-manifest.json'
            write_private(self.guest_path, manifest)
            commit(output.parent / 'host.json', self.spec, output, self.guest_path)
            self.record = self.checkpoint(manifest=manifest)
            commit_checkpoint(output.parent / 'host.json', output,
                              self.root / ('%06d.json' % self.record['sequence']))
        self.capture = drive_capture_worker(self.temp / 'worker', self.spec, while_running)

    def match(self, name):
        return stopped_tree_match.host_match(self.guest_path, self.capture / 'extracted-stores', self.matches / name)

    def frozen(self, records):
        return verify_frozen_checkpoint(self.capture, records, table=self.table, configs=self.configs,
                                        binary=identity_fixture.BINARY, home=identity_fixture.HOME)

    def rewrite(self, name, **changes):
        path = self.capture / name
        value = json.loads(path.read_bytes())
        path.unlink()
        write_record(path, {**value, **changes})

    def substitute(self):
        """A guest-forged terminal record, then a host rewrite of only CHECKPOINT's digest."""
        records = self.journal._read()
        swapped = copy.deepcopy(records)
        swapped[-1]['at'] = '2026-10-14T16:30:00+00:00'
        swapped = guest.rechain(swapped, len(swapped) - 1)
        self.rewrite('CHECKPOINT.json', checkpoint_sha256=swapped[-1]['sha256'])
        require_committed(self.capture)
        return records, swapped

    def test_r1_substituted_checkpoint_after_capture_refuses_before_match(self):
        self.captured()
        records, swapped = self.substitute()
        with self.assertRaises(RuntimeError, msg='host_match accepted a rewritten CHECKPOINT.json'):
            self.match('substituted')
        with self.assertRaises(RuntimeError, msg='frozen verifier accepted the substitute'):
            self.frozen(swapped)

    def test_r2_substituted_checkpoint_after_match_refuses_frozen_verification(self):
        self.captured()
        matched = self.match('authentic')
        records, swapped = self.substitute()
        with self.assertRaises(RuntimeError, msg='frozen verifier accepted the substitute after match'):
            self.frozen(swapped)
        self.assertEqual(matched.get('checkpoint_sha256'), self.record['sha256'],
                         'MATCH.json does not record the committed checkpoint digest')

    def test_r3_control_pinned_ack_rewrite_refuses(self):
        self.captured()
        self.rewrite('ACKED.json', at_utc='2026-10-14T16:30:00+00:00')
        self.rewrite('CHECKPOINT.json', ack_sha256=sha((self.capture / 'ACKED.json').read_bytes()))
        with self.assertRaisesRegex(RuntimeError, 'capture receipt, cloned image and extracted stores differ'):
            self.match('ack-rewrite')

    def test_r4_native_e2e_post_capture_ack_change_refuses_at_capture_receipt(self):
        # Mirrors test_host_vm_capture's macOS-only 'changed-guest-ack' expectation.
        self.captured()
        ack = self.capture / 'ACKED.json'
        ack.write_bytes(ack.read_bytes() + b' ')
        with self.assertRaisesRegex(RuntimeError, 'capture receipt'):
            self.match('changed-guest-ack')

    def test_r5_native_e2e_ack_change_during_match_is_named(self):
        # Mirrors the macOS-only mid-match loop's 'ack' case.
        self.captured()
        ack = self.capture / 'ACKED.json'
        original, freeze, changed = ack.read_bytes(), stopped_tree_match.freeze, []

        def after_validation(root):
            freeze(root)
            if not changed:
                ack.write_bytes(original + b' ')
                changed.append(True)
        with mock.patch.object(stopped_tree_match, 'freeze', side_effect=after_validation):
            with self.assertRaisesRegex(RuntimeError, 'input receipts changed during match'):
                self.match('changed-ack-during-match')

    def test_r6_control_guard_refuses_a_commitment_without_checkpoint(self):
        # Why the macOS-only failed-capture flow needs commit_checkpoint() before its guard call.
        def while_running(output):
            self.armed = (output / 'ARMED.json').read_bytes()
            self.nonce = json.loads(self.armed)['capture_nonce']
            path = self.temp / 'guest-manifest.json'
            write_private(path, self.manifest('b' * 64, spec_sha256=sha(self.spec.read_bytes())))
            commit(output.parent / 'host.json', self.spec, output, path)
            with mock.patch.object(host_vm_guard, 'preflight', side_effect=AssertionError('guard sampled')):
                with self.assertRaisesRegex(RuntimeError, 'CHECKPOINT.json'):
                    host_vm_guard.guard_locked(output.parent / 'host.json', output)
            self.assertFalse((output / 'GUARD_INTENT.json').exists())
        with self.assertRaisesRegex(RuntimeError, 'CHECKPOINT.json'):
            drive_capture_worker(self.temp / 'worker', self.spec, while_running)


if __name__ == '__main__':
    unittest.main()
