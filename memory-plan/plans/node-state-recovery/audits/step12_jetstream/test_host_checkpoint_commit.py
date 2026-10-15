"""Owned tests for the host's separate capture-ready checkpoint commitment (B5, D186, D187).

The guest journal, manifest and checkpoint are produced by the real Journal and checkpoint code;
the host records are written by the real commit()/commit_checkpoint(), CAPTURE.json by the real
capture worker's pinned publication, and MATCH.json by the real host_match(). Only host-side VM
facilities are owned stand-ins (see drive_capture_worker). No VM, launchd job, NATS server or
store is touched.
"""
import copy
import fcntl
import hashlib
import json
import os
import pathlib
import secrets
import shutil
import sys
import threading
import time
import types
import unittest
from unittest import mock

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

import host_guest_commit  # noqa: E402
import host_vm_capture  # noqa: E402
import host_vm_guard  # noqa: E402
import stopped_tree_match  # noqa: E402
import test_capture_checkpoint as guest  # noqa: E402
import test_nats_identity as identity_fixture  # noqa: E402
from host_guest_commit import (CAPTURE_PINS, CHECKPOINT_KEYS, commit, commit_checkpoint,  # noqa: E402
                               require_acked, require_committed, verify_frozen_checkpoint)
from host_vm_preflight import write_record  # noqa: E402
from preservation_journal import (ARM_SCOPE, CAPTURE_EVENT, CAPTURE_SCOPE, Refused,  # noqa: E402
                                  encoded as journal_encoded)

PRIOR = {'state': 'started', 'vm_uuid': '00000000-0000-0000-0000-000000000002',
         'host_boot_session': 'boot', 'image_device': 1, 'image_inode': 2, 'image_size': 3,
         'vmstate': None}
STARTED = dict(PRIOR, holders_consistent=True, image_holders=[42])
# Every stand-in extracted store holds one file with these bytes; guest manifests list ROWS.
STORE_BYTES = b'owned stopped store'
ROWS = [{'path': 'stream.dat', 'type': 'file', 'size': len(STORE_BYTES),
         'sha256': hashlib.sha256(STORE_BYTES).hexdigest()}]
# Clone/extraction fields of a published capture: the frozen verifier reads only the pins.
UNREAD = {'scope': host_vm_capture.CAPTURE_SCOPE, 'vm_state_at_final_check': 'stopped'}


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def write_private(path, raw):
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, 'wb') as handle:
        handle.write(raw)


def write_checkpoint_record(path, committed, **changes):
    """A capture-ready record bound to a host commitment, for flows that run no guest journal."""
    head = committed['manifest']['journal_head']
    record = {'sequence': 1, 'previous': head, 'event': CAPTURE_EVENT, 'boot': 'owned-boot',
              'at': '2026-10-14T15:00:00+00:00', 'scope': CAPTURE_SCOPE, 'pre_head': head,
              'baseline_sha256': '0' * 64, 'capture_nonce': committed['capture_nonce'],
              'arm_sha256': committed['arm_sha256'], 'manifest_sha256': committed['manifest_sha256'],
              'identities': {}, 'observations': {}, 'hold_sha256': '0' * 64, 'hold_evidence': {},
              'entrypoint_loaded': {}, 'entrypoint_overrides': {}, **changes}
    record['sha256'] = sha(journal_encoded(record))
    write_private(path, journal_encoded(record))
    return record


def drive_capture_worker(parent, store_spec, while_running, during_extract=None, second_stop=None):
    """Run the real host_vm_capture.capture() worker to CAPTURE.json publication without a VM.

    Owned stand-ins, all host-side and not under test here: VM power/holder samples (preflight,
    shared with host_guest_commit), the image guard receipt (the real guard needs macOS
    st_flags), the APFS clone, the immutable flag and the ASIF store extraction, whose stores
    each hold STORE_BYTES. `while_running(output)` runs while the worker samples the VM started
    and must leave the real COMMITTED/ACKED/CHECKPOINT records; `second_stop(output)` runs as
    the worker takes its second stopped sample, after it handled the first; `during_extract(output)`
    runs after the stop and before publication. Returns (output, worker exception or None).
    """
    parent = parent.resolve()
    parent.mkdir(mode=0o700)
    source = parent / 'source.img'
    write_private(source, b'owned stand-in image bytes')
    info = source.stat()
    host = parent / 'host.json'
    write_record(host, {'package': str(parent / 'Owned.utm'), 'name': 'Owned',
                        'uuid': host_vm_capture.FIXTURE_UUID, 'image_name': source.name,
                        'config_sha256': '0' * 64, 'utmctl': '/usr/bin/false', 'utmctl_sha256': '0' * 64})
    running = dict(STARTED, image=str(source), image_device=info.st_dev, image_inode=info.st_ino,
                   image_size=info.st_size)
    output = parent / 'capture'
    stopped = threading.Event()
    stops = []

    def sampled(_spec, destination, **_options):
        # Like the real preflight, every sample is recorded in its own new directory.
        value = dict(running, state='stopped', image_holders=[]) if stopped.is_set() else running
        if stopped.is_set():
            stops.append(destination.name)
            if len(stops) == 2 and second_stop:
                second_stop(output)
        destination.mkdir(mode=0o700)
        write_record(destination / 'preflight.json', value)
        return value

    def extracted(clone, spec_path, destination):
        if during_extract:
            during_extract(output)
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
        except Exception as error:  # the caller asserts on it
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
        if thread.is_alive():
            try:
                while_running(output)
                write_record(output / 'GUARD.json', {'scope': 'stopped source image guarded; no clone or VM start'})
            finally:
                stopped.set()
        thread.join(30)
    if thread.is_alive():
        raise AssertionError('capture worker did not finish')
    return output, (errors[0] if errors else None)


class HostCheckpoint(guest.CaptureCheckpoint):
    def setUp(self):
        super().setUp()
        self.capture = (self.temp / 'capture').resolve()
        self.capture.mkdir(mode=0o700)
        (self.capture / 'before-shutdown').mkdir(mode=0o700)
        write_record(self.capture / 'before-shutdown' / 'preflight.json', PRIOR)
        self.nonce = secrets.token_hex(32)
        write_record(self.capture / 'ARMED.json', {
            'scope': ARM_SCOPE, 'capture_nonce': self.nonce, 'vm_uuid': PRIOR['vm_uuid'],
            'host_boot_session': 'boot', 'image_device': 1, 'image_inode': 2})
        self.armed = (self.capture / 'ARMED.json').read_bytes()
        self.spec = self.temp / 'stores.json'
        write_record(self.spec, {'data_volume_uuid': 'A' * 36, 'stores': [
            {'role': role, 'relative_path': identity_fixture.STORES[guest.UNIT_OF[role]][1:]}
            for role in sorted(guest.UNIT_OF)]})
        self.host = self.temp / 'host.json'
        # The capture worker holds this lock for the whole running-VM window.
        self.active = os.open(self.capture / 'CAPTURE_ACTIVE.lock', os.O_RDWR | os.O_CREAT | os.O_EXCL, 0o600)
        fcntl.flock(self.active, fcntl.LOCK_EX)
        self.addCleanup(os.close, self.active)

    def host_manifest(self, head=None, **changes):
        return self.manifest(head, spec_sha256=sha(self.spec.read_bytes()), **changes)

    def host_commit(self, manifest):
        path = self.temp / ('guest-manifest-' + secrets.token_hex(4) + '.json')
        write_private(path, manifest)
        with mock.patch('host_guest_commit.preflight', side_effect=[STARTED, STARTED]):
            return commit(self.host, self.spec, self.capture, path)

    def journal_file(self, record):
        return self.root / ('%06d.json' % record['sequence'])

    def host_checkpoint(self, path, sample=STARTED):
        with mock.patch('host_guest_commit.preflight', return_value=sample):
            return commit_checkpoint(self.host, self.capture, path)

    def committed_flow(self):
        """Guest stops, captures its manifest at the quiescent head, host commits, guest checkpoints."""
        self.build()
        manifest = self.host_manifest()
        committed = self.host_commit(manifest)
        record = self.checkpoint(manifest=manifest)
        return manifest, committed, record

    def frozen(self, records=None):
        return verify_frozen_checkpoint(self.capture, records if records is not None else self.journal._read(),
                                        table=self.table, configs=self.configs,
                                        binary=identity_fixture.BINARY, home=identity_fixture.HOME)

    def refuses_checkpoint(self, pattern, path, **options):
        with self.assertRaisesRegex(RuntimeError, pattern):
            self.host_checkpoint(path, **options)
        self.assertFalse((self.capture / 'CHECKPOINT.json').exists())

    def publish(self):
        """The worker's real pinned publication; only the clone/extraction fields are stand-ins."""
        return host_vm_capture.publish_pinned_capture(self.capture, dict(UNREAD),
                                                      require_committed(self.capture)['checkpoint'])

    def rewrite(self, name, **changes):
        """A same-uid host rewrite of one capture-directory record, in write_record's format."""
        path = self.capture / name
        value = json.loads(path.read_bytes())
        path.unlink()
        write_record(path, {**value, **changes})

    def repin(self):
        """A forger who also rewrites the CAPTURE.json pins to the current commitment files."""
        self.rewrite('CAPTURE.json', **{key: sha((self.capture / name).read_bytes())
                                        for key, name in CAPTURE_PINS.items()})


class Authentic(HostCheckpoint):
    def test_commitment_chain_verifies_the_frozen_journal_from_host_records_only(self):
        manifest, committed, record = self.committed_flow()
        self.assertEqual(committed['manifest'], json.loads(manifest))
        self.assertEqual(committed['manifest_sha256'], sha(manifest))
        commitment = self.host_checkpoint(self.journal_file(record))
        checkpoint = json.loads((self.capture / 'CHECKPOINT.json').read_bytes())
        self.assertEqual(set(checkpoint), CHECKPOINT_KEYS)
        self.assertEqual(checkpoint['checkpoint_sha256'], record['sha256'])
        self.assertEqual(checkpoint['journal_head'], record['pre_head'])
        self.assertEqual(checkpoint['commit_sha256'], sha((self.capture / 'COMMITTED.json').read_bytes()))
        self.assertEqual(checkpoint['ack_sha256'], sha((self.capture / 'ACKED.json').read_bytes()))
        self.assertEqual(commitment, require_committed(self.capture))
        self.assertEqual({key: value for key, value in commitment.items() if key != 'checkpoint'},
                         require_acked(self.capture)[0])
        published = self.publish()
        self.assertEqual({key: published[key] for key in CAPTURE_PINS},
                         {key: sha((self.capture / name).read_bytes()) for key, name in CAPTURE_PINS.items()})
        self.journal.close()
        with guest.Journal(self.root, boot='boot-a', node_lock=self.node_lock) as reopened:
            frozen = reopened._read()
        summary = self.frozen(frozen)
        self.assertEqual(summary['checkpoint_sha256'], record['sha256'])
        self.assertEqual(summary['pre_head'], json.loads(manifest)['journal_head'])

    def test_synthetic_record_helper_is_accepted_by_the_host(self):
        manifest = self.host_manifest('b' * 64)
        committed = self.host_commit(manifest)
        record = write_checkpoint_record(self.temp / 'checkpoint.json', committed)
        self.assertEqual(self.host_checkpoint(self.temp / 'checkpoint.json')['checkpoint']['checkpoint_sha256'],
                         record['sha256'])


class HostRefusals(HostCheckpoint):
    def test_host_commit_requires_a_journal_head(self):
        value = json.loads(self.host_manifest('b' * 64))
        for label, manifest in (
                ('absent', guest.canonical({key: item for key, item in value.items() if key != 'journal_head'})),
                ('uppercase', guest.canonical({**value, 'journal_head': 'B' * 64})),
                ('short', guest.canonical({**value, 'journal_head': 'b' * 63})),
                ('not text', guest.canonical({**value, 'journal_head': 7}))):
            with self.subTest(head=label):
                with self.assertRaisesRegex(RuntimeError, 'does not bind this arm'):
                    self.host_commit(manifest)
                self.assertFalse((self.capture / 'COMMITTED.json').exists())

    def test_recorded_commitment_without_a_valid_journal_head_refuses(self):
        committed = self.host_commit(self.host_manifest('b' * 64))
        write_checkpoint_record(self.temp / 'checkpoint.json', committed)
        self.host_checkpoint(self.temp / 'checkpoint.json')
        forged = copy.deepcopy(committed)
        forged['manifest']['journal_head'] = 'B' * 64
        forged['manifest_sha256'] = sha(guest.canonical(forged['manifest']))
        (self.capture / 'COMMITTED.json').unlink()
        write_record(self.capture / 'COMMITTED.json', forged)
        ack = json.loads((self.capture / 'ACKED.json').read_bytes())
        ack.update(commit_sha256=sha((self.capture / 'COMMITTED.json').read_bytes()),
                   manifest_sha256=forged['manifest_sha256'])
        (self.capture / 'ACKED.json').unlink()
        write_record(self.capture / 'ACKED.json', ack)
        with self.assertRaisesRegex(RuntimeError, 'not committed to this host arm'):
            require_committed(self.capture)

    def test_checkpoint_needs_an_acked_commitment_and_an_active_worker(self):
        committed = {'capture_nonce': self.nonce, 'arm_sha256': sha(self.armed), 'manifest_sha256': '0' * 64,
                     'manifest': {'journal_head': 'b' * 64}}
        path = self.temp / 'checkpoint.json'
        write_checkpoint_record(path, committed)
        self.refuses_checkpoint('COMMITTED.json', path)
        self.host_commit(self.host_manifest('b' * 64))
        fcntl.flock(self.active, fcntl.LOCK_UN)
        self.refuses_checkpoint('capture worker is no longer active', path)

    def test_checkpoint_must_bind_this_arm_manifest_and_head(self):
        manifest, committed, record = self.committed_flow()
        cases = {
            'regenerated manifest': {'manifest_sha256': sha(self.host_manifest(
                json.loads(manifest)['journal_head'], at_utc='2026-10-14T16:00:00+00:00'))},
            'foreign arm': {'arm_sha256': '0' * 64},
            'foreign nonce': {'capture_nonce': secrets.token_hex(32)},
            'later head': {'pre_head': '0' * 64, 'previous': '0' * 64},
            'pre-head not previous': {'pre_head': '0' * 64},
            'previous not the committed head': {'previous': '0' * 64},
        }
        for label, changes in cases.items():
            with self.subTest(case=label):
                path = self.temp / ('checkpoint-' + secrets.token_hex(4) + '.json')
                write_checkpoint_record(path, committed, **changes)
                self.refuses_checkpoint('does not bind this arm, committed manifest and journal head', path)

    def test_regenerated_manifest_checkpoint_from_the_real_journal_refuses(self):
        self.build()
        manifest = self.host_manifest()
        self.host_commit(manifest)
        regenerated = self.host_manifest(at_utc='2026-10-14T16:00:00+00:00')
        record = self.checkpoint(manifest=regenerated)
        self.refuses_checkpoint('does not bind this arm, committed manifest and journal head',
                                self.journal_file(record))
        with self.assertRaisesRegex(RuntimeError, 'already committed or ended'):
            self.host_commit(regenerated)

    def test_checkpoint_must_be_an_intact_capture_ready_journal_record(self):
        _, committed, record = self.committed_flow()
        raw = self.journal_file(record).read_bytes()
        value = json.loads(raw)
        body = {key: item for key, item in value.items() if key != 'sha256'}
        rehashed = lambda changed: journal_encoded({**changed, 'sha256': sha(journal_encoded(changed))})  # noqa: E731
        cases = {
            'content changed': journal_encoded({**value, 'at': 'later'}),
            'pretty bytes': json.dumps(value, indent=2).encode(),
            'trailing newline': raw + b'\n',
            'other event': rehashed({**body, 'event': 'verified'}),
            'other scope': rehashed({**body, 'scope': 'writer exclusion'}),
            'extra key': rehashed({**body, 'note': 'x'}),
            'not an object': b'[]',
        }
        for label, data in cases.items():
            with self.subTest(case=label):
                path = self.temp / ('checkpoint-' + secrets.token_hex(4) + '.json')
                write_private(path, data)
                self.refuses_checkpoint('not an intact capture-ready journal record', path)

    def test_checkpoint_commitment_samples_the_same_running_vm(self):
        _, committed, record = self.committed_flow()
        for label, sample in (('stopped', dict(STARTED, state='stopped')),
                              ('holder', dict(STARTED, image_holders=[43])),
                              ('image', dict(STARTED, image_inode=9)),
                              ('vmstate', dict(STARTED, vmstate={'changed': True})),
                              ('inconsistent', dict(STARTED, holders_consistent=False))):
            with self.subTest(sample=label):
                self.refuses_checkpoint('did not observe the original running VM',
                                        self.journal_file(record), sample=sample)

    def test_checkpoint_changed_during_commitment_and_second_commitment_refuse(self):
        _, committed, record = self.committed_flow()
        path = self.temp / 'handoff.json'
        write_private(path, self.journal_file(record).read_bytes())
        def swapped(*_args, **_kwargs):
            path.write_bytes(path.read_bytes().replace(b'"boot-a"', b'"boot-z"'))
            return STARTED
        with mock.patch('host_guest_commit.preflight', side_effect=swapped):
            with self.assertRaisesRegex(RuntimeError, 'changed during host commitment'):
                commit_checkpoint(self.host, self.capture, path)
        self.assertFalse((self.capture / 'CHECKPOINT.json').exists())
        self.host_checkpoint(self.journal_file(record))
        with self.assertRaisesRegex(RuntimeError, 'already committed'):
            self.host_checkpoint(self.journal_file(record))
        (self.capture / 'CHECKPOINT.json').unlink()
        write_record(self.capture / 'GUARD.json', {})
        self.refuses_checkpoint('already committed or the capture has ended', self.journal_file(record))

    def test_capture_guard_refuses_without_a_checkpoint_commitment(self):
        self.host_commit(self.host_manifest('b' * 64))
        with self.assertRaisesRegex(RuntimeError, 'CHECKPOINT.json'):
            require_committed(self.capture)
        with mock.patch.object(host_vm_guard, 'preflight', side_effect=AssertionError('guard sampled')):
            with self.assertRaisesRegex(RuntimeError, 'CHECKPOINT.json'):
                host_vm_guard.guard_locked(self.host, self.capture)
        self.assertFalse((self.capture / 'GUARD_INTENT.json').exists())

    def test_recorded_ack_is_rechecked(self):
        self.host_commit(self.host_manifest('b' * 64))
        original = json.loads((self.capture / 'ACKED.json').read_bytes())
        for label, change in (
                ('scope', {'scope': 'other'}), ('commit', {'commit_sha256': '0' * 64}),
                ('manifest', {'manifest_sha256': '0' * 64}), ('extra key', {'note': 'x'}),
                ('stopped', {'started_sample': dict(original['started_sample'], state='stopped')}),
                ('holder', {'started_sample': dict(original['started_sample'], image_holders=[43])}),
                ('vmstate', {'started_sample': dict(original['started_sample'], vmstate={'changed': True})})):
            with self.subTest(field=label):
                (self.capture / 'ACKED.json').unlink()
                write_record(self.capture / 'ACKED.json', {**original, **change})
                with self.assertRaisesRegex(RuntimeError, 'matching post-commit host sample'):
                    require_acked(self.capture)
        (self.capture / 'ACKED.json').unlink()
        write_record(self.capture / 'ACKED.json', original)
        require_acked(self.capture)

    def test_recorded_checkpoint_commitment_fields_are_rechecked(self):
        _, committed, record = self.committed_flow()
        self.host_checkpoint(self.journal_file(record))
        self.publish()
        published = (self.capture / 'CAPTURE.json').read_bytes()
        original = json.loads((self.capture / 'CHECKPOINT.json').read_bytes())
        for label, change in (
                ('scope', {'scope': 'other'}), ('nonce', {'capture_nonce': '0' * 64}),
                ('commit', {'commit_sha256': '0' * 64}), ('ack', {'ack_sha256': '0' * 64}),
                ('manifest', {'manifest_sha256': '0' * 64}), ('head', {'journal_head': '0' * 64}),
                ('digest shape', {'checkpoint_sha256': 'X' * 64}),
                ('stopped sample', {'started_sample': dict(original['started_sample'], state='stopped')}),
                ('other holder', {'started_sample': dict(original['started_sample'], image_holders=[43])}),
                ('extra key', {'note': 'x'})):
            with self.subTest(field=label):
                (self.capture / 'CHECKPOINT.json').unlink()
                write_record(self.capture / 'CHECKPOINT.json', {**original, **change})
                with self.assertRaisesRegex(RuntimeError, 'not committed to this guest manifest'):
                    require_committed(self.capture)
                # The CAPTURE.json pin refuses first; a forger who re-pins still meets the field check.
                with self.assertRaisesRegex(RuntimeError, 'does not pin this checkpoint commitment'):
                    self.frozen()
                self.repin()
                with self.assertRaisesRegex(RuntimeError, 'not committed to this guest manifest'):
                    self.frozen()
                (self.capture / 'CAPTURE.json').unlink()
                write_private(self.capture / 'CAPTURE.json', published)
        (self.capture / 'CHECKPOINT.json').unlink()
        write_record(self.capture / 'CHECKPOINT.json', original)
        self.frozen()


class FrozenSubstitution(HostCheckpoint):
    def substituted(self, records, **changes):
        """A guest rewrite of its terminal record after the host committed: internally consistent."""
        rows = copy.deepcopy(records)
        rows[-1].update(changes)
        return guest.rechain(rows, len(rows) - 1)

    def test_terminal_checkpoint_substitution_refuses_only_via_the_committed_digest(self):
        manifest, committed, record = self.committed_flow()
        self.host_checkpoint(self.journal_file(record))
        self.publish()
        records = self.journal._read()
        swapped = self.substituted(records, at='2026-10-14T16:00:00+00:00')
        # Self-input would accept the substitute: the record's own digest pins nothing.
        self.verify(swapped, manifest=manifest)
        with self.assertRaisesRegex(Refused, 'differs from the committed digest'):
            self.frozen(swapped)
        self.frozen(records)

    def test_regenerated_manifest_with_rederived_checkpoint_refuses(self):
        manifest, committed, record = self.committed_flow()
        self.host_checkpoint(self.journal_file(record))
        self.publish()
        records = self.journal._read()
        regenerated = self.host_manifest(json.loads(manifest)['journal_head'], at_utc='2026-10-14T16:00:00+00:00')
        swapped = self.substituted(records, manifest_sha256=sha(regenerated))
        # Internally consistent against the regenerated manifest, as the guest would make it.
        self.verify(swapped, manifest=regenerated)
        with self.assertRaisesRegex(Refused, 'differs from the committed digest'):
            self.frozen(swapped)

    def test_rows_after_the_committed_checkpoint_refuse(self):
        _, committed, record = self.committed_flow()
        self.host_checkpoint(self.journal_file(record))
        self.publish()
        self.journal.append('recovery-started')
        with self.assertRaisesRegex(Refused, 'not the terminal record'):
            self.frozen()

    def test_checkpoint_from_another_capture_refuses(self):
        _, committed, record = self.committed_flow()
        self.host_checkpoint(self.journal_file(record))
        self.publish()
        records = self.journal._read()
        other = self.substituted(records, capture_nonce=secrets.token_hex(32))
        with self.assertRaisesRegex(Refused, 'differs from the committed digest'):
            self.frozen(other)

    def test_pure_verifier_refuses_a_missing_or_malformed_commitment(self):
        manifest, committed, record = self.committed_flow()
        commitment = self.host_checkpoint(self.journal_file(record))
        records = self.journal._read()
        options = {'table': self.table, 'configs': self.configs,
                   'binary': identity_fixture.BINARY, 'home': identity_fixture.HOME}
        broken = (None, record['sha256'], {**commitment, 'checkpoint': None},
                  {**commitment, 'manifest_sha256': '0' * 64},
                  {**commitment, 'checkpoint': {**commitment['checkpoint'], 'manifest_sha256': '0' * 64}},
                  {**commitment, 'checkpoint': {**commitment['checkpoint'], 'capture_nonce': '0' * 64}},
                  {**commitment, 'checkpoint': {**commitment['checkpoint'], 'checkpoint_sha256': 'X'}},
                  {**commitment, 'arm_sha256': 'X'})
        for index, value in enumerate(broken):
            with self.subTest(case=index):
                with self.assertRaisesRegex(Refused, 'lacks a host commitment'):
                    guest.verify_capture_checkpoint(records, value, **options)
        moved = {**commitment, 'checkpoint': {**commitment['checkpoint'], 'journal_head': '0' * 64}}
        with self.assertRaisesRegex(Refused, 'not taken at this journal head'):
            guest.verify_capture_checkpoint(records, moved, **options)
        self.assertEqual(guest.verify_capture_checkpoint(records, commitment, **options)['checkpoint_sha256'],
                         record['sha256'])


class CapturePin(HostCheckpoint):
    """CAPTURE.json pins CHECKPOINT.json; host_match and the frozen verifier consume it pinned (D187)."""

    def captured(self, during_extract=None, second_stop=None):
        """Real guest journal and checkpoint, real commit()/commit_checkpoint(), real capture worker."""
        flow = {}

        def while_running(output):
            self.capture = output
            self.armed = (output / 'ARMED.json').read_bytes()
            self.nonce = json.loads(self.armed)['capture_nonce']
            self.build()
            manifest = self.host_manifest(stores={role: ROWS for role in stopped_tree_match.ROLES})
            flow['guest'] = self.temp / 'guest-manifest.json'
            write_private(flow['guest'], manifest)
            commit(self.host, self.spec, output, flow['guest'])
            flow['record'] = self.checkpoint(manifest=manifest)
            commit_checkpoint(self.host, output, self.journal_file(flow['record']))

        output, error = drive_capture_worker(self.temp / 'worker', self.spec, while_running,
                                             during_extract, second_stop)
        return output, error, flow

    def match(self, flow, name):
        matches = self.temp / 'matches'
        if not matches.exists():
            matches.mkdir(mode=0o700)
        return stopped_tree_match.host_match(flow['guest'], self.capture / 'extracted-stores', matches / name)

    def substitute(self):
        """A guest-forged terminal record, then a host rewrite of only the committed digest."""
        records = self.journal._read()
        swapped = copy.deepcopy(records)
        swapped[-1]['at'] = '2026-10-14T16:30:00+00:00'
        swapped = guest.rechain(swapped, len(swapped) - 1)
        self.rewrite('CHECKPOINT.json', checkpoint_sha256=swapped[-1]['sha256'])
        # The rewritten commitment still validates on its own: only the CAPTURE.json pin refuses it.
        require_committed(self.capture)
        return records, swapped

    def test_worker_pins_the_checkpoint_seen_stopped_and_match_records_its_digest(self):
        output, error, flow = self.captured()
        self.assertIsNone(error)
        published = json.loads((output / 'CAPTURE.json').read_bytes())
        for key, name in CAPTURE_PINS.items():
            self.assertEqual(published[key], sha((output / name).read_bytes()))
        result = self.match(flow, 'authentic')
        recorded = json.loads((self.temp / 'matches' / 'authentic' / 'MATCH.json').read_bytes())
        self.assertEqual((result['checkpoint_sha256'], recorded['checkpoint_sha256']),
                         (flow['record']['sha256'], flow['record']['sha256']))
        self.assertEqual(self.frozen()['checkpoint_sha256'], flow['record']['sha256'])

    def test_substituted_checkpoint_before_match_refuses_at_the_capture_pin(self):
        _, error, flow = self.captured()
        self.assertIsNone(error)
        records, swapped = self.substitute()
        with self.assertRaisesRegex(RuntimeError, 'capture receipt, cloned image and extracted stores differ'):
            self.match(flow, 'substituted')
        self.assertFalse((self.temp / 'matches' / 'substituted' / 'MATCH.json').exists())
        for rows in (swapped, records):
            with self.assertRaisesRegex(RuntimeError, 'does not pin this checkpoint commitment'):
                self.frozen(rows)

    def test_substituted_checkpoint_after_match_refuses_frozen_verification(self):
        _, error, flow = self.captured()
        self.assertIsNone(error)
        matched = self.match(flow, 'authentic')
        records, swapped = self.substitute()
        self.assertEqual(matched['checkpoint_sha256'], records[-1]['sha256'])
        for rows in (swapped, records):
            with self.assertRaisesRegex(RuntimeError, 'does not pin this checkpoint commitment'):
                self.frozen(rows)
        with self.assertRaisesRegex(RuntimeError, 'capture receipt, cloned image and extracted stores differ'):
            self.match(flow, 'rematch')

    def test_control_pinned_ack_refuses_with_checkpoint_and_its_pin_rebound(self):
        output, error, flow = self.captured()
        self.assertIsNone(error)
        self.rewrite('ACKED.json', at_utc='2026-10-14T16:30:00+00:00')
        self.rewrite('CHECKPOINT.json', ack_sha256=sha((output / 'ACKED.json').read_bytes()))
        self.rewrite('CAPTURE.json', guest_checkpoint_sha256=sha((output / 'CHECKPOINT.json').read_bytes()))
        require_committed(output)
        with self.assertRaisesRegex(RuntimeError, 'capture receipt, cloned image and extracted stores differ'):
            self.match(flow, 'ack-rewrite')
        with self.assertRaisesRegex(RuntimeError, 'does not pin this checkpoint commitment'):
            self.frozen()

    def test_commitment_bytes_changed_after_capture_refuse_at_the_pins(self):
        output, error, flow = self.captured()
        self.assertIsNone(error)
        for name in CAPTURE_PINS.values():
            with self.subTest(changed=name):
                original = (output / name).read_bytes()
                # Parses identically, so only a byte pin can see it.
                (output / name).write_bytes(original + b' ')
                with self.assertRaisesRegex(RuntimeError, 'capture receipt, cloned image and extracted stores differ'):
                    self.match(flow, 'changed-' + name)
                with self.assertRaisesRegex(RuntimeError, 'does not pin this checkpoint commitment'):
                    self.frozen()
                (output / name).write_bytes(original)
        unpinned = json.loads((output / 'CAPTURE.json').read_bytes())
        del unpinned['guest_checkpoint_sha256']
        (output / 'CAPTURE.json').unlink()
        write_record(output / 'CAPTURE.json', unpinned)
        with self.assertRaisesRegex(RuntimeError, 'capture receipt, cloned image and extracted stores differ'):
            self.match(flow, 'unpinned')
        with self.assertRaisesRegex(RuntimeError, 'does not pin this checkpoint commitment'):
            self.frozen()

    def test_commitment_changed_during_match_names_the_change(self):
        output, error, flow = self.captured()
        self.assertIsNone(error)
        freeze = stopped_tree_match.freeze
        for name in CAPTURE_PINS.values():
            with self.subTest(changed=name):
                path = output / name
                original = path.read_bytes()
                changed = []

                def after_validation(root, path=path, original=original, changed=changed):
                    freeze(root)
                    if not changed:
                        path.write_bytes(original + b' ')
                        changed.append(True)
                try:
                    with mock.patch.object(stopped_tree_match, 'freeze', side_effect=after_validation):
                        with self.assertRaisesRegex(RuntimeError, 'input receipts changed during match'):
                            self.match(flow, 'during-' + name)
                    self.assertTrue(changed)
                finally:
                    path.write_bytes(original)
        self.match(flow, 'restored')

    def test_checkpoint_rewritten_after_the_stop_refuses_publication(self):
        # The digest is well-formed, so the rewritten commitment still validates on its own.
        output, error, _ = self.captured(
            during_extract=lambda output: self.rewrite('CHECKPOINT.json', checkpoint_sha256='0' * 64))
        self.assertRegex(str(error), 'guest capture commitment changed after the VM stopped')
        self.assertTrue((output / 'FAILED.json').exists())
        self.assertFalse((output / 'CAPTURE.json').exists())

    def test_checkpoint_first_seen_stopped_is_the_one_pinned(self):
        # Rewritten after the worker handled its first stopped sample: the later sample is not pinned.
        output, error, _ = self.captured(
            second_stop=lambda output: self.rewrite('CHECKPOINT.json', checkpoint_sha256='0' * 64))
        self.assertRegex(str(error), 'guest capture commitment changed after the VM stopped')
        self.assertFalse((output / 'CAPTURE.json').exists())

    def test_arm_rewritten_after_the_stop_refuses_publication(self):
        # The pinned files are unchanged; only revalidation at publication sees the arm.
        def rearmed(output):
            armed = output / 'ARMED.json'
            armed.write_bytes(armed.read_bytes() + b' ')
        output, error, _ = self.captured(during_extract=rearmed)
        self.assertRegex(str(error), 'guest manifest is not committed to this host arm')
        self.assertFalse((output / 'CAPTURE.json').exists())

    def swapped_at_publication(self, name):
        """`name` differs when the pins are read and is restored before require_committed() runs."""
        held = {}

        def alter(output):
            held['bytes'] = (output / name).read_bytes()
            (output / name).write_bytes(held['bytes'] + b' ')

        def validate(capture_dir):
            if held:
                (capture_dir / name).write_bytes(held.pop('bytes'))
            return require_committed(capture_dir)

        with mock.patch.object(host_vm_capture, 'require_committed', validate):
            output, error, _ = self.captured(during_extract=alter)
        self.assertRegex(str(error), 'guest capture commitment changed after the VM stopped')
        self.assertFalse((output / 'CAPTURE.json').exists())

    def test_committed_bytes_swapped_at_publication_refuse(self):
        self.swapped_at_publication('COMMITTED.json')

    def test_ack_bytes_swapped_at_publication_refuse(self):
        self.swapped_at_publication('ACKED.json')

    def test_checkpoint_bytes_swapped_at_publication_refuse(self):
        # Parses like the validated commitment, so only the re-read after validation sees it.
        self.swapped_at_publication('CHECKPOINT.json')

    def test_checkpoint_validated_between_two_substitutes_refuses(self):
        """A substitute is pinned and back in place afterwards; only the authentic one is validated."""
        held = {}

        def substitute(output):
            path = output / 'CHECKPOINT.json'
            held['authentic'] = path.read_bytes()
            self.rewrite('CHECKPOINT.json', checkpoint_sha256='0' * 64)
            held['substitute'] = path.read_bytes()

        def validate(capture_dir):
            if not held:
                return require_committed(capture_dir)
            path = capture_dir / 'CHECKPOINT.json'
            path.write_bytes(held['authentic'])
            try:
                return require_committed(capture_dir)
            finally:
                path.write_bytes(held.pop('substitute'))
                held.clear()

        with mock.patch.object(host_vm_capture, 'require_committed', validate):
            output, error, _ = self.captured(during_extract=substitute)
        self.assertRegex(str(error), 'guest capture commitment changed after the VM stopped')
        self.assertFalse((output / 'CAPTURE.json').exists())


class FrozenPinOrder(HostCheckpoint):
    def test_capture_pin_is_required_before_provenance_is_consumed(self):
        _, committed, record = self.committed_flow()
        self.host_checkpoint(self.journal_file(record))
        unread = mock.patch.object(host_guest_commit, 'require_committed',
                                   side_effect=AssertionError('provenance consumed before the pin'))
        with unread, self.assertRaisesRegex(RuntimeError, 'CAPTURE.json'):
            self.frozen()
        self.publish()
        published = (self.capture / 'CAPTURE.json').read_bytes()
        value = json.loads(published)
        cases = {'unpinned v2 capture': {key: item for key, item in value.items()
                                         if key != 'guest_checkpoint_sha256'},
                 **{'wrong ' + key: {**value, key: '0' * 64} for key in CAPTURE_PINS}}
        for label, changed in cases.items():
            with self.subTest(capture=label):
                (self.capture / 'CAPTURE.json').unlink()
                write_record(self.capture / 'CAPTURE.json', changed)
                with unread, self.assertRaisesRegex(RuntimeError, 'does not pin this checkpoint commitment'):
                    self.frozen()
        (self.capture / 'CAPTURE.json').unlink()
        write_private(self.capture / 'CAPTURE.json', b'[]')
        with unread, self.assertRaisesRegex(RuntimeError, 'does not pin this checkpoint commitment'):
            self.frozen()
        (self.capture / 'CAPTURE.json').unlink()
        write_private(self.capture / 'CAPTURE.json', published)
        self.assertEqual(self.frozen()['checkpoint_sha256'], record['sha256'])

    def test_provenance_must_be_the_pinned_bytes(self):
        """A commitment file swapped between the pin read and require_committed() refuses."""
        _, committed, record = self.committed_flow()
        self.host_checkpoint(self.journal_file(record))
        self.publish()
        real = require_committed(self.capture)
        for label, swapped in (
                ('checkpoint', {**real, 'checkpoint': {**real['checkpoint'], 'checkpoint_sha256': '0' * 64}}),
                ('manifest', {**real, 'manifest': {**real['manifest'], 'at_utc': 'later'}})):
            with self.subTest(swapped=label):
                with mock.patch.object(host_guest_commit, 'require_committed', return_value=swapped):
                    with self.assertRaisesRegex(RuntimeError, 'differs from the pinned capture record'):
                        self.frozen()
        self.assertEqual(self.frozen()['checkpoint_sha256'], record['sha256'])


if __name__ == '__main__':
    unittest.main()
