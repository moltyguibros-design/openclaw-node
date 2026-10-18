#!/usr/bin/env python3
"""Recover a stopped source image after a guarded clone attempt; never start UTM."""

import datetime
import fcntl
import hashlib
import json
import os
import pathlib
import stat
import sys

from host_clone_dispose import (ABORT_KEYS, ABORT_SCOPE, ABORT_COMPLETE_SCOPE, COMPLETE_KEYS, IMAGE_KEYS,
    abort_conflicts, abort_context, abort_pins, cleanup_bytes, exact_record, hashes,
    no_sibling_clone, private_record, sample_binding, sample_files, verify_abort, CAPTURE_SCOPE, unattached)
from host_guest_commit import encoded
from host_journal_mount import clone_identity, record_failure
from host_image_immutable import change_immutable
from host_vm_guard import GUARD_SCOPE
from host_vm_capture import FIXTURE_UUID, HOST_SPEC_FIELDS, file_hash, fsync_parent, guarded_source, pinned_spec
from host_vm_preflight import no_disk_attachment, owned_directory, preflight, require, write_record
from preservation_journal import DIGEST


BOOTABLE_SCOPE = ('temporary clone absent and source image bootable; '
                  'no VM start or cold-master acceptance')


def prior_bootable(capture_dir, vm_uuid, identity):
    found = False
    for child in capture_dir.iterdir():
        info = child.lstat()
        require(not stat.S_ISLNK(info.st_mode), 'capture contains a symlink')
        if not stat.S_ISDIR(info.st_mode) or not os.path.lexists(child / 'BOOTABLE.json'):
            continue
        owned_directory(child)
        receipt = private_record(child / 'BOOTABLE.json')
        require(receipt['scope'] == BOOTABLE_SCOPE and receipt['vm_uuid'] == vm_uuid
                and isinstance(receipt.get('guard_completed'), bool)
                and (receipt['source_image_device'], receipt['source_image_inode'],
                     receipt['source_image_size']) == identity,
                'prior BOOTABLE receipt identifies another source')
        found = True
    return found


def no_other_clone(root, current):
    for child in root.iterdir():
        info = child.lstat()
        require(not stat.S_ISLNK(info.st_mode), 'recovery root contains a symlink')
        if stat.S_ISDIR(info.st_mode) and child != current:
            require(not os.path.lexists(child / 'powered-off-image.asif')
                    and not os.path.lexists(child / 'CAPTURE.json'),
                    'another temporary image clone or completed capture still exists')


def reconcile(host_spec, capture_dir, output, fixture=False):
    require(fixture,
            'production reconciliation requires a verified host boot decision controller')
    os.umask(0o077)
    host_spec = pathlib.Path(host_spec)
    capture_dir = pathlib.Path(capture_dir)
    output = pathlib.Path(output)
    owned_directory(capture_dir.parent)
    owned_directory(capture_dir)
    require(output.parent == capture_dir and not os.path.lexists(output),
            'reconcile output must be new inside the capture directory')
    if fixture:
        host = pinned_spec(host_spec, HOST_SPEC_FIELDS)
        require(capture_dir.parent.name.startswith(('openclaw-host-reconcile-',
                                                    'openclaw-host-capture-'))
                and host['uuid'] == FIXTURE_UUID
                and pathlib.Path(host['package']).parent == capture_dir.parent,
                'fixture reconcile requires the owned test parent')
    else:
        require(capture_dir.parent == pathlib.Path.home() /
                'Library/Application Support/OpenClawRecovery',
                'production reconcile requires the durable host recovery directory')
    output.mkdir(mode=0o700)
    fsync_parent(capture_dir)
    armed_fd = None
    active_fd = None
    try:
        active_fd = os.open(capture_dir / 'CAPTURE_ACTIVE.lock', os.O_RDONLY | os.O_NOFOLLOW)
        active_info = os.fstat(active_fd)
        require(stat.S_ISREG(active_info.st_mode) and active_info.st_uid == os.getuid()
                and active_info.st_nlink == 1 and stat.S_IMODE(active_info.st_mode) == 0o600,
                'capture worker lock is not owner-private')
        try:
            fcntl.flock(active_fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError as error:
            raise RuntimeError('capture worker is still active') from error
        armed_fd = os.open(capture_dir / 'ARMED.json', os.O_RDONLY | os.O_NOFOLLOW)
        try:
            fcntl.flock(armed_fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError as error:
            raise RuntimeError('arm lock is held by a guard or capture worker') from error
        armed = private_record(capture_dir / 'ARMED.json')
        initial = private_record(capture_dir / 'before-shutdown/preflight.json')
        require(armed['scope'] == 'waiting for external guest shutdown; no stop request issued'
                and armed['vm_uuid'] == initial['vm_uuid']
                and armed['host_boot_session'] == initial['host_boot_session']
                and (armed['image_device'], armed['image_inode']) ==
                (initial['image_device'], initial['image_inode']),
                'armed source identity differs')
        intent = private_record(capture_dir / 'GUARD_INTENT.json')
        require(intent['scope'] == GUARD_SCOPE
                and intent['vm_uuid'] == armed['vm_uuid']
                and intent['host_boot_session'] == armed['host_boot_session']
                and intent['source_image'] == initial['image']
                and (intent['source_image_device'], intent['source_image_inode'],
                     intent['source_image_size']) ==
                (initial['image_device'], initial['image_inode'], initial['image_size']),
                'guard intent does not identify this source')
        before = preflight(host_spec, output / 'before-reconcile')
        source_identity = (before['image_device'], before['image_inode'], before['image_size'])
        require(before['state'] == 'stopped' and before['holders_consistent']
                and before['vm_uuid'] == armed['vm_uuid']
                and source_identity == (initial['image_device'], initial['image_inode'],
                                        initial['image_size']),
                'stopped VM or original source image differs')
        source = pathlib.Path(before['image'])
        guarded_path = capture_dir / 'GUARD.json'
        guard_completed = False
        if os.path.lexists(guarded_path):
            guarded = private_record(guarded_path)
            require(set(guarded) == set(intent) | {'guarded_at_utc'}
                    and guarded['scope'] == 'stopped source image guarded; no clone or VM start'
                    and all(guarded.get(key) == value for key, value in intent.items()
                            if key != 'scope'),
                    'guard completion receipt differs from its intent')
            guard_completed = True
        clone = capture_dir / 'powered-off-image.asif'
        if prior_bootable(capture_dir, before['vm_uuid'], source_identity):
            require(not os.path.lexists(clone)
                    and not bool(source.lstat().st_flags & stat.UF_IMMUTABLE),
                    'source was guarded again after a BOOTABLE receipt')
        capture_path = capture_dir / 'CAPTURE.json'
        if os.path.lexists(capture_path):
            capture = private_record(capture_path)
            require(capture['scope'] == CAPTURE_SCOPE
                    and capture['vm_uuid'] == before['vm_uuid']
                    and capture['host_boot_session'] == armed['host_boot_session']
                    and capture['source_size'] == before['image_size']
                    and file_hash(source) == capture['source_image_sha256'],
                    'completed capture source image changed')
            raise RuntimeError('completed capture requires verified acceptance or abort before reconciliation')
        if os.path.lexists(clone):
            info = clone.lstat()
            require(stat.S_ISREG(info.st_mode) and info.st_uid == os.getuid()
                    and info.st_nlink == 1 and info.st_dev == before['image_device']
                    and info.st_ino != before['image_inode']
                    and bool(source.lstat().st_flags & stat.UF_IMMUTABLE),
                    'temporary clone or guarded source identity differs')
            unattached(clone)
            change_immutable(clone, (info.st_dev, info.st_ino, info.st_size), False)
            clone.unlink()
            fsync_parent(capture_dir)
        no_disk_attachment(clone)
        no_other_clone(capture_dir.parent, capture_dir)
        after_clone = preflight(host_spec, output / 'after-clone-removal')
        require(after_clone['state'] == 'stopped' and after_clone['holders_consistent']
                and (after_clone['image_device'], after_clone['image_inode'],
                     after_clone['image_size']) == source_identity
                and not os.path.lexists(clone),
                'VM or source changed while reconciling the clone')
        change_immutable(source, source_identity, False)
        after_unlock = preflight(host_spec, output / 'after-source-unlock')
        require(after_unlock['state'] == 'stopped' and after_unlock['holders_consistent']
                and (after_unlock['image_device'], after_unlock['image_inode'],
                     after_unlock['image_size']) == source_identity
                and not os.path.lexists(clone)
                and not bool(source.lstat().st_flags & stat.UF_IMMUTABLE),
                'VM, clone or source flag changed after unlock')
        result = {
            'scope': BOOTABLE_SCOPE,
            'at_utc': datetime.datetime.now(datetime.timezone.utc).isoformat(),
            'vm_uuid': before['vm_uuid'], 'host_boot_session': before['host_boot_session'],
            'source_image_device': source_identity[0],
            'source_image_inode': source_identity[1],
            'source_image_size': source_identity[2],
            'clone_absent': True, 'source_immutable': False,
            'vm_state_at_final_check': 'stopped',
            'guard_completed': guard_completed,
            'capture_completed': os.path.lexists(capture_path),
        }
        temporary = output / 'BOOTABLE.json.tmp'
        write_record(temporary, result)
        os.replace(temporary, output / 'BOOTABLE.json')
        fsync_parent(output)
        return result
    except Exception as error:
        write_record(output / 'OPERATOR_REQUIRED.json', {
            'at_utc': datetime.datetime.now(datetime.timezone.utc).isoformat(),
            'error': str(error),
        })
        raise
    finally:
        if armed_fd is not None:
            os.close(armed_fd)
        if active_fd is not None:
            os.close(active_fd)


RELEASE_INTENT_KEYS = frozenset({'abort_sha256', 'complete_sha256', 'cleanup_sha256',
    'cleanup_intent_sha256', 'capture_nonce', 'arm_sha256', 'journal_head',
    'checkpoint_sha256', 'evidence_sha256', 'verify_sample_sha256', 'barrier_sample_sha256', 'source'})
RELEASE_COMPLETE_KEYS = frozenset({'intent_sha256', 'abort_sha256', 'before_clear_sample_sha256', 'after_sample_sha256', 'source'})


def full_sync(fd):
    os.fsync(fd)
    if hasattr(fcntl, 'F_FULLFSYNC'):
        fcntl.fcntl(fd, fcntl.F_FULLFSYNC)


def release_evidence(host_spec, capture_dir, directory_fd, locks):
    pins = abort_pins(host_spec, capture_dir, locks, directory_fd)
    raw = cleanup_bytes('ABORT.json', directory_fd)
    receipt = exact_record(raw, ABORT_KEYS)
    abort_conflicts(capture_dir, raw)
    require(receipt['scope'] == ABORT_SCOPE and receipt['decision'] == 'ABORT'
            and receipt['input_sha256'] == hashes(pins), 'release ABORT input binding differs')
    result = {capture_dir / name: value for name, value in pins.items() if name != 'host_spec'}
    result[host_spec] = pins['host_spec']
    for name, expected in (('ABORT_CLEANUP_INTENT.json', receipt['cleanup_intent_sha256']),
                           ('ABORT_CLEANUP.json', receipt['cleanup_sha256'])):
        result[capture_dir / name] = cleanup_bytes(name, directory_fd)
        require(hashlib.sha256(result[capture_dir / name]).hexdigest() == expected,
                'release cleanup bytes differ from ABORT')
    result[capture_dir / 'ABORT.json'] = raw
    decision = capture_dir / 'abort-decision'
    owned_directory(decision)
    require({p.name for p in decision.iterdir()} == {'before', 'after', 'COMPLETE.json'},
            'release ABORT decision is failed, partial or unknown')
    complete_raw = cleanup_bytes(decision / 'COMPLETE.json')
    complete = exact_record(complete_raw, COMPLETE_KEYS)
    require(complete['scope'] == ABORT_COMPLETE_SCOPE
            and complete['abort_sha256'] == hashlib.sha256(raw).hexdigest(),
            'release ABORT completion differs')
    result[decision / 'COMPLETE.json'] = complete_raw
    cleanup = capture_dir / 'abort-cleanup'
    owned_directory(cleanup)
    require({p.name for p in cleanup.iterdir()} == {'before', 'before-remove', 'after'},
            'release cleanup is failed, partial or unknown')
    for root, names, expected in ((cleanup, ('before', 'before-remove', 'after'), receipt['cleanup_sample_sha256']),
                                  (decision, ('before',), receipt['decision_sample_sha256']),
                                  (decision, ('after',), complete['after_sample_sha256'])):
        samples = {}
        for name in names:
            samples.update({name + '/' + key: value for key, value in sample_files(root / name).items()})
        actual = hashes(samples) if root == cleanup else hashes({k.split('/', 1)[1]: v for k, v in samples.items()})
        require(actual == expected, 'release evidence sample pins differ')
        result.update({root / name: value for name, value in samples.items()})
    require(not os.path.lexists(capture_dir / 'FAILED.json')
            and not any(os.path.lexists(capture_dir / (name + '.tmp')) for name in
                ('ABORT_CLEANUP_INTENT.json', 'ABORT_CLEANUP.json')),
            'release capture or cleanup has failure or temporary evidence')
    return result


def evidence_hashes(host_spec, capture_dir, evidence):
    return hashes({'host_spec' if path == host_spec else str(path.relative_to(capture_dir)): raw
                   for path, raw in evidence.items()})


def durable_evidence(evidence):
    directories = set()
    for path, expected in evidence.items():
        owned_directory(path.parent)
        fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
        try:
            before = os.fstat(fd)
            raw = b''
            while chunk := os.read(fd, 1 << 20):
                raw += chunk
            require(raw == expected, 'release evidence changed before sync')
            full_sync(fd)
            after, named = os.fstat(fd), path.lstat()
            require(stat.S_ISREG(before.st_mode) and before.st_uid == os.getuid()
                    and before.st_nlink == 1 and stat.S_IMODE(before.st_mode) == 0o600
                    and all(getattr(before, key) == getattr(after, key) == getattr(named, key)
                            for key in ('st_dev', 'st_ino', 'st_size', 'st_mtime_ns', 'st_ctime_ns'))
                    and cleanup_bytes(path) == expected,
                    'release evidence descriptor or bytes changed during sync')
        finally:
            os.close(fd)
        directories.add(path.parent)
    common = pathlib.Path(os.path.commonpath([str(path.parent) for path in evidence]))
    for directory in tuple(directories):
        while directory != common:
            directory = directory.parent
            directories.add(directory)
    for directory in sorted(directories, key=lambda path: (-len(path.parts), str(path))):
        owned_directory(directory)
        fd = os.open(directory, os.O_RDONLY | os.O_NOFOLLOW | os.O_DIRECTORY)
        try:
            opened = os.fstat(fd)
            os.fsync(fd)
            named = directory.lstat()
            require((opened.st_dev, opened.st_ino) == (named.st_dev, named.st_ino),
                    'release evidence directory changed during sync')
        finally:
            os.close(fd)


def publish_release(directory_fd, name, value):
    fd = os.open(name + '.tmp', os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW,
                 0o600, dir_fd=directory_fd)
    with os.fdopen(fd, 'wb') as output:
        output.write(encoded(value))
        output.flush()
        full_sync(output.fileno())
    os.rename(name + '.tmp', name, src_dir_fd=directory_fd, dst_dir_fd=directory_fd)
    os.fsync(directory_fd)


def released_source_identity(source, original):
    require(isinstance(original, dict) and set(original) == IMAGE_KEYS
            and bool(original['flags'] & stat.UF_IMMUTABLE), 'release original source schema or flag differs')
    require(source.is_absolute() and source.resolve() == source, 'release source path is redirected')
    identity = clone_identity(source, {'clone_size': original['size'], 'clone_image_sha256': original['sha256']})
    require(all(identity[key] == original[key] for key in IMAGE_KEYS - {'flags', 'ctime_ns'})
            and identity['flags'] == original['flags'] & ~stat.UF_IMMUTABLE
            and identity['ctime_ns'] >= original['ctime_ns'], 'released source metadata differs')
    after = source.lstat()
    require(all(getattr(after, field) == identity[key] for key, field in
                (('device', 'st_dev'), ('inode', 'st_ino'), ('size', 'st_size'),
                 ('mtime_ns', 'st_mtime_ns'), ('ctime_ns', 'st_ctime_ns'), ('flags', 'st_flags'))),
            'released source path changed while hashed')
    return identity


def release_binding(host_spec, capture_dir, directory_fd, locks, output, intent, observed):
    evidence = release_evidence(host_spec, capture_dir, directory_fd, locks)
    receipt = exact_record(evidence[capture_dir / 'ABORT.json'], ABORT_KEYS)
    initial = json.loads(evidence[capture_dir / 'before-shutdown/preflight.json'])
    host = json.loads(evidence[host_spec])
    sample_binding(observed, initial, host)
    require(intent == {'abort_sha256': hashlib.sha256(evidence[capture_dir / 'ABORT.json']).hexdigest(),
            'complete_sha256': hashlib.sha256(evidence[capture_dir / 'abort-decision/COMPLETE.json']).hexdigest(),
            'cleanup_sha256': receipt['cleanup_sha256'], 'cleanup_intent_sha256': receipt['cleanup_intent_sha256'],
            **{key: receipt[key] for key in ('capture_nonce', 'arm_sha256', 'journal_head', 'checkpoint_sha256', 'source')},
            'evidence_sha256': evidence_hashes(host_spec, capture_dir, evidence),
            'verify_sample_sha256': hashes(sample_files(output / 'verify')),
            'barrier_sample_sha256': hashes(sample_files(output / 'barrier'))},
            'release intent or evidence binding differs')
    for name in ('verify', 'barrier', 'before-clear'):
        sample_binding(json.loads(sample_files(output / name)['preflight.json']), initial, host)
    clone = capture_dir / 'powered-off-image.asif'
    require(not os.path.lexists(clone), 'release temporary clone reappeared')
    no_disk_attachment(clone)
    no_sibling_clone(capture_dir)
    return released_source_identity(pathlib.Path(observed['image']), intent['source'])


def verify_release(host_spec, capture_dir, observed, directory_fd, locks, *, fixture=False):
    """Read-only release evidence under caller-held EX locks; never guest admission or boot."""
    require(fixture, 'production source release verification is disabled')
    require(len(locks) == 2 and len(set(locks)) == 2,
            'release verification requires exactly two distinct lock descriptors')
    host_spec, capture_dir = pathlib.Path(host_spec), pathlib.Path(capture_dir)
    host = pinned_spec(host_spec, HOST_SPEC_FIELDS)
    require(capture_dir.parent.name.startswith(('openclaw-host-capture-', 'openclaw-host-reconcile-'))
            and host['uuid'] == FIXTURE_UUID and pathlib.Path(host['package']).parent == capture_dir.parent,
            'release verification requires the owned fixture boundary')
    owned_directory(capture_dir.parent)
    owned_directory(capture_dir)
    output = capture_dir / 'abort-release'
    owned_directory(output)
    require({p.name for p in output.iterdir()} == {'verify', 'barrier', 'before-clear', 'after', 'INTENT.json', 'COMPLETE.json'},
            'release is failed, partial, temporary or unknown; manual handling required')
    raw = cleanup_bytes(output / 'INTENT.json')
    intent = exact_record(raw, RELEASE_INTENT_KEYS)
    complete_raw = cleanup_bytes(output / 'COMPLETE.json')
    complete = exact_record(complete_raw, RELEASE_COMPLETE_KEYS)
    source = release_binding(host_spec, capture_dir, directory_fd, locks, output, intent, observed)
    after = sample_files(output / 'after')
    before_clear = sample_files(output / 'before-clear')
    sample_binding(json.loads(after['preflight.json']),
                   json.loads(cleanup_bytes('before-shutdown/preflight.json', directory_fd)), host)
    require(complete == {'intent_sha256': hashlib.sha256(raw).hexdigest(),
                         'abort_sha256': intent['abort_sha256'],
                         'before_clear_sample_sha256': hashes(before_clear),
                         'after_sample_sha256': hashes(after), 'source': source},
            'release completion or released source binding differs')
    require(cleanup_bytes(output / 'INTENT.json') == raw
            and cleanup_bytes(output / 'COMPLETE.json') == complete_raw
            and sample_files(output / 'after') == after
            and sample_files(output / 'before-clear') == before_clear
            and release_binding(host_spec, capture_dir, directory_fd, locks, output, intent, observed) == source
            and {p.name for p in output.iterdir()} == {'verify', 'barrier', 'before-clear', 'after', 'INTENT.json', 'COMPLETE.json'},
            'release records changed during verification')
    return {'intent': raw, 'complete': complete_raw, 'sha256': hashes({'intent': raw, 'complete': complete_raw})}


def release_aborted(host_spec, capture_dir, fixture=False):
    require(fixture, 'production source release requires a verified host boot decision controller')
    with abort_context(host_spec, capture_dir, fixture) as (host_spec, capture_dir, directory_fd, locks):
        output = capture_dir / 'abort-release'
        require(not os.path.lexists(output), 'source release already attempted; manual handling required')
        output.mkdir(mode=0o700)
        release_fd = os.open(output, os.O_RDONLY | os.O_NOFOLLOW | os.O_DIRECTORY)
        flag_attempted = False
        try:
            os.fsync(directory_fd)
            observed = preflight(host_spec, output / 'verify')
            require(json.loads(sample_files(output / 'verify')['preflight.json']) == observed,
                    'release verify sample differs from the consumed observation')
            verified = verify_abort(host_spec, capture_dir, observed, directory_fd, locks, fixture=True)
            evidence = release_evidence(host_spec, capture_dir, directory_fd, locks)
            durable_evidence(evidence)
            before = preflight(host_spec, output / 'barrier')
            require(json.loads(sample_files(output / 'barrier')['preflight.json']) == before,
                    'release barrier sample differs from the consumed observation')
            require(verify_abort(host_spec, capture_dir, before, directory_fd, locks, fixture=True) == verified
                    and release_evidence(host_spec, capture_dir, directory_fd, locks) == evidence,
                    'release evidence changed after the durability barrier')
            receipt = exact_record(verified['abort'], ABORT_KEYS)
            intent = {'abort_sha256': verified['sha256']['abort'], 'complete_sha256': verified['sha256']['complete'],
                'cleanup_sha256': verified['sha256']['cleanup'], 'cleanup_intent_sha256': verified['sha256']['intent'],
                **{key: receipt[key] for key in ('capture_nonce', 'arm_sha256', 'journal_head', 'checkpoint_sha256', 'source')},
                'evidence_sha256': evidence_hashes(host_spec, capture_dir, evidence),
                'verify_sample_sha256': hashes(sample_files(output / 'verify')),
                'barrier_sample_sha256': hashes(sample_files(output / 'barrier'))}
            durable_evidence({**{output / 'verify' / k: v for k, v in sample_files(output / 'verify').items()},
                              **{output / 'barrier' / k: v for k, v in sample_files(output / 'barrier').items()}})
            publish_release(release_fd, 'INTENT.json', intent)
            raw = cleanup_bytes(output / 'INTENT.json')
            require(exact_record(raw, RELEASE_INTENT_KEYS) == intent, 'release intent readback differs')
            require(verify_abort(host_spec, capture_dir, before, directory_fd, locks, fixture=True) == verified
                    and release_evidence(host_spec, capture_dir, directory_fd, locks) == evidence,
                    'release evidence changed before the flag operation')
            source = pathlib.Path(before['image'])
            identity = receipt['source']
            last = preflight(host_spec, output / 'before-clear')
            before_clear_files = sample_files(output / 'before-clear')
            require(json.loads(before_clear_files['preflight.json']) == last,
                    'release before-clear sample differs from the consumed observation')
            initial = json.loads(evidence[capture_dir / 'before-shutdown/preflight.json'])
            sample_binding(last, initial, json.loads(evidence[host_spec]))
            require(guarded_source(capture_dir, initial, last) ==
                    json.loads(evidence[capture_dir / 'CAPTURE.json'])['guard_receipt_sha256'],
                    'release last source guard differs')
            current = source.lstat()
            require(all(getattr(current, field) == identity[key] for key, field in
                        (('device', 'st_dev'), ('inode', 'st_ino'), ('size', 'st_size'),
                         ('mtime_ns', 'st_mtime_ns'), ('ctime_ns', 'st_ctime_ns'), ('flags', 'st_flags'))),
                    'release last guarded source metadata differs')
            require(release_evidence(host_spec, capture_dir, directory_fd, locks) == evidence
                    and cleanup_bytes(output / 'INTENT.json') == raw,
                    'release inputs changed after the last live observation')
            clone = capture_dir / 'powered-off-image.asif'
            require(not os.path.lexists(clone), 'release before-clear clone reappeared')
            no_disk_attachment(clone)
            no_sibling_clone(capture_dir)
            flag_attempted = True
            change_immutable(source, (identity['device'], identity['inode'], identity['size']), False)
            after = preflight(host_spec, output / 'after')
            require(json.loads(sample_files(output / 'after')['preflight.json']) == after,
                    'release after sample differs from the consumed observation')
            released = release_binding(host_spec, capture_dir, directory_fd, locks, output, intent, after)
            require(cleanup_bytes(output / 'INTENT.json') == raw, 'release intent changed after the flag operation')
            after_files = sample_files(output / 'after')
            durable_evidence({**{output / 'before-clear' / key: value for key, value in before_clear_files.items()},
                              **{output / 'after' / key: value for key, value in after_files.items()}})
            require(release_binding(host_spec, capture_dir, directory_fd, locks, output, intent, after) == released
                    and sample_files(output / 'after') == after_files
                    and sample_files(output / 'before-clear') == before_clear_files,
                    'release bindings changed after the flag operation')
            publish_release(release_fd, 'COMPLETE.json', {'intent_sha256': hashlib.sha256(raw).hexdigest(),
                'abort_sha256': intent['abort_sha256'], 'before_clear_sample_sha256': hashes(before_clear_files),
                'after_sample_sha256': hashes(after_files), 'source': released})
            return verify_release(host_spec, capture_dir, after, directory_fd, locks, fixture=True)
        except BaseException as error:
            record_failure(output, 'abort-source-release', error,
                           {'manual_required': True, 'source_flag_state': 'uncertain' if flag_attempted else 'not changed by release'})
            raise
        finally:
            os.close(release_fd)


RESTORE_PRIOR_SCOPE = ('owned restore-prior-node decision; no new recovery point; unprotected user-owned claim; '
                       'not VM start authorization, acceptance or guest admission')
BOOT_INTENT_SCOPE = 'owned restore-prior decision intent; no VM start, acceptance or guest admission'
BOOT_LAYOUT = frozenset({'verify', 'decision', 'INTENT.json', 'RESTORE_PRIOR.json'})
BOOT_INTENT_KEYS = frozenset({'scope', 'decision', 'capture_nonce', 'arm_sha256', 'journal_head',
    'checkpoint_sha256', 'abort_sha256', 'release_intent_sha256', 'release_complete_sha256',
    'released_source', 'host_boot_session', 'vm_uuid', 'evidence_sha256', 'verify_sample_sha256'})
BOOT_DECISION_KEYS = BOOT_INTENT_KEYS | {'at_utc', 'intent_sha256', 'decision_sample_sha256'}


def restore_prior_record(raw):
    value = exact_record(raw, BOOT_DECISION_KEYS)
    require(value['scope'] == RESTORE_PRIOR_SCOPE and value['decision'] == 'RESTORE_PRIOR'
            and value['vm_uuid'] == FIXTURE_UUID
            and isinstance(value['host_boot_session'], str) and bool(value['host_boot_session'])
            and isinstance(value['at_utc'], str) and bool(value['at_utc']),
            'restore-prior decision scope, kind or host differs')
    for key in ('capture_nonce', 'arm_sha256', 'journal_head', 'checkpoint_sha256', 'abort_sha256',
                'release_intent_sha256', 'release_complete_sha256', 'intent_sha256'):
        require(isinstance(value[key], str) and DIGEST.fullmatch(value[key]),
                'restore-prior decision digest is invalid: ' + key)
    source = value['released_source']
    require(isinstance(source, dict) and set(source) == IMAGE_KEYS
            and all(type(source[key]) is int and source[key] >= 0 for key in IMAGE_KEYS - {'sha256'})
            and not source['flags'] & stat.UF_IMMUTABLE
            and isinstance(source['sha256'], str) and DIGEST.fullmatch(source['sha256']),
            'restore-prior released source schema differs')
    for key in ('evidence_sha256', 'verify_sample_sha256', 'decision_sample_sha256'):
        table = value[key]
        require(isinstance(table, dict) and bool(table)
                and all(isinstance(name, str) and bool(name) and isinstance(digest, str)
                        and DIGEST.fullmatch(digest) for name, digest in table.items()),
                'restore-prior evidence table differs: ' + key)
    return value


def boot_evidence(host_spec, capture_dir, directory_fd, locks):
    evidence = release_evidence(host_spec, capture_dir, directory_fd, locks)
    output = capture_dir / 'abort-release'
    for name in ('INTENT.json', 'COMPLETE.json'):
        evidence[output / name] = cleanup_bytes(output / name)
    for name in ('verify', 'barrier', 'before-clear', 'after'):
        evidence.update({output / name / key: raw for key, raw in sample_files(output / name).items()})
    return evidence


def boot_intent(host_spec, capture_dir, evidence, verify_files):
    abort = exact_record(evidence[capture_dir / 'ABORT.json'], ABORT_KEYS)
    released = exact_record(evidence[capture_dir / 'abort-release/COMPLETE.json'], RELEASE_COMPLETE_KEYS)
    return {'scope': BOOT_INTENT_SCOPE, 'decision': 'RESTORE_PRIOR',
        **{key: abort[key] for key in ('capture_nonce', 'arm_sha256', 'journal_head',
                                     'checkpoint_sha256', 'host_boot_session', 'vm_uuid')},
        'abort_sha256': hashlib.sha256(evidence[capture_dir / 'ABORT.json']).hexdigest(),
        'release_intent_sha256': hashlib.sha256(evidence[capture_dir / 'abort-release/INTENT.json']).hexdigest(),
        'release_complete_sha256': hashlib.sha256(evidence[capture_dir / 'abort-release/COMPLETE.json']).hexdigest(),
        'released_source': released['source'],
        'evidence_sha256': evidence_hashes(host_spec, capture_dir, evidence),
        'verify_sample_sha256': hashes(verify_files)}


def verify_decision(host_spec, capture_dir, observed, directory_fd, locks, *, fixture=False):
    """Pre-start evidence only; the guest must never call this against a booted image."""
    require(fixture, 'production restore-prior decision verification is disabled')
    require(len(locks) == 2 and len(set(locks)) == 2,
            'decision verification requires exactly two distinct lock descriptors')
    host_spec, capture_dir = pathlib.Path(host_spec), pathlib.Path(capture_dir)
    released = verify_release(host_spec, capture_dir, observed, directory_fd, locks, fixture=True)
    output = capture_dir / 'abort-boot'
    owned_directory(output)
    require({path.name for path in output.iterdir()} == BOOT_LAYOUT,
            'restore-prior decision is failed, partial, temporary or unknown; manual handling required')
    evidence = boot_evidence(host_spec, capture_dir, directory_fd, locks)
    samples = {name: sample_files(output / name) for name in ('verify', 'decision')}
    initial = json.loads(evidence[capture_dir / 'before-shutdown/preflight.json'])
    for files in samples.values():
        sample_binding(json.loads(files['preflight.json']), initial, json.loads(evidence[host_spec]))
    intent_raw = cleanup_bytes(output / 'INTENT.json')
    intent = exact_record(intent_raw, BOOT_INTENT_KEYS)
    require(intent == boot_intent(host_spec, capture_dir, evidence, samples['verify']),
            'restore-prior intent or evidence binding differs')
    raw = cleanup_bytes(output / 'RESTORE_PRIOR.json')
    decision = restore_prior_record(raw)
    require(decision == {**intent, 'scope': RESTORE_PRIOR_SCOPE, 'at_utc': decision['at_utc'],
            'intent_sha256': hashlib.sha256(intent_raw).hexdigest(),
            'decision_sample_sha256': hashes(samples['decision'])},
            'restore-prior decision differs from intent or samples')
    require(cleanup_bytes(output / 'INTENT.json') == intent_raw
            and cleanup_bytes(output / 'RESTORE_PRIOR.json') == raw
            and all(sample_files(output / name) == files for name, files in samples.items())
            and boot_evidence(host_spec, capture_dir, directory_fd, locks) == evidence
            and verify_release(host_spec, capture_dir, observed, directory_fd, locks, fixture=True) == released
            and {path.name for path in output.iterdir()} == BOOT_LAYOUT,
            'restore-prior records changed during verification')
    return {'decision': raw, 'sha256': hashlib.sha256(raw).hexdigest()}


def decide_restore_prior(host_spec, capture_dir, fixture=False):
    require(fixture, 'production restore-prior decision requires a verified host boot controller')
    with abort_context(host_spec, capture_dir, fixture) as (host_spec, capture_dir, directory_fd, locks):
        output = capture_dir / 'abort-boot'
        require(not os.path.lexists(output), 'restore-prior decision already attempted; manual handling required')
        output.mkdir(mode=0o700)
        decision_fd = None
        try:
            os.fsync(directory_fd)
            decision_fd = os.open(output, os.O_RDONLY | os.O_NOFOLLOW | os.O_DIRECTORY)
            observed = preflight(host_spec, output / 'verify')
            verify_files = sample_files(output / 'verify')
            require(json.loads(verify_files['preflight.json']) == observed,
                    'decision verify sample differs from consumed observation')
            released = verify_release(host_spec, capture_dir, observed, directory_fd, locks, fixture=True)
            evidence = boot_evidence(host_spec, capture_dir, directory_fd, locks)
            durable_evidence(evidence)
            durable_evidence({output / 'verify' / key: raw for key, raw in verify_files.items()})
            require(verify_release(host_spec, capture_dir, observed, directory_fd, locks, fixture=True) == released
                    and boot_evidence(host_spec, capture_dir, directory_fd, locks) == evidence,
                    'decision inputs changed during the durability barrier')
            intent = boot_intent(host_spec, capture_dir, evidence, verify_files)
            publish_release(decision_fd, 'INTENT.json', intent)
            intent_raw = cleanup_bytes(output / 'INTENT.json')
            require(exact_record(intent_raw, BOOT_INTENT_KEYS) == intent, 'decision intent readback differs')
            final = preflight(host_spec, output / 'decision')
            final_files = sample_files(output / 'decision')
            require(json.loads(final_files['preflight.json']) == final,
                    'decision final sample differs from consumed observation')
            require(verify_release(host_spec, capture_dir, final, directory_fd, locks, fixture=True) == released
                    and boot_evidence(host_spec, capture_dir, directory_fd, locks) == evidence
                    and cleanup_bytes(output / 'INTENT.json') == intent_raw,
                    'decision source or evidence changed after intent')
            durable_evidence({output / 'decision' / key: raw for key, raw in final_files.items()})
            require(verify_release(host_spec, capture_dir, final, directory_fd, locks, fixture=True) == released
                    and boot_evidence(host_spec, capture_dir, directory_fd, locks) == evidence
                    and cleanup_bytes(output / 'INTENT.json') == intent_raw
                    and sample_files(output / 'verify') == verify_files
                    and sample_files(output / 'decision') == final_files,
                    'decision evidence changed after sample durability')
            decision = {**intent, 'scope': RESTORE_PRIOR_SCOPE,
                'at_utc': datetime.datetime.now(datetime.timezone.utc).isoformat(),
                'intent_sha256': hashlib.sha256(intent_raw).hexdigest(),
                'decision_sample_sha256': hashes(final_files)}
            publish_release(decision_fd, 'RESTORE_PRIOR.json', decision)
            return verify_decision(host_spec, capture_dir, final, directory_fd, locks, fixture=True)
        except BaseException as error:
            record_failure(output, 'restore-prior-decision', error,
                           {'manual_required': True, 'source_flag_state': 'not changed by decision'})
            raise
        finally:
            if decision_fd is not None:
                os.close(decision_fd)


if __name__ == '__main__':
    if len(sys.argv) in (4, 5) and sys.argv[1] == 'decide-restore-prior':
        require(len(sys.argv) == 4 or sys.argv[4] == '--fixture', 'invalid decision option')
        result = decide_restore_prior(sys.argv[2], sys.argv[3], len(sys.argv) == 5)
        print(result['sha256'])
        raise SystemExit(0)
    if len(sys.argv) in (4, 5) and sys.argv[1] == 'release-aborted':
        require(len(sys.argv) == 4 or sys.argv[4] == '--fixture', 'invalid release option')
        release_aborted(sys.argv[2], sys.argv[3], len(sys.argv) == 5)
        raise SystemExit(0)
    require(len(sys.argv) in (4, 5),
            'usage: host_vm_reconcile.py HOST_SPEC CAPTURE_DIR NEW_OUTPUT [--fixture]')
    require(len(sys.argv) == 4 or sys.argv[4] == '--fixture', 'invalid reconcile option')
    reconcile(sys.argv[1], sys.argv[2], sys.argv[3], len(sys.argv) == 5)
