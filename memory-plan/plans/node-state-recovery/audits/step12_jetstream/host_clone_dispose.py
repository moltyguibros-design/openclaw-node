#!/usr/bin/env python3
"""Remove temporary VM image clones while the source VM is stopped.

abort-cleanup is owned-only and never changes image flags or grants boot permission.
It consumes a completed checkpoint-bound capture and a completed source guard. Its
fixed single-use diagnostic directory, intent/receipt or temporary publication names
make every partial attempt manual; presence of a receipt alone is not success. A
post-rename fsync error can leave a complete visible receipt beside FAILED.json.
Future decision consumers must reject either failure or partial publication evidence.
Cleanup forecloses further clone reads; existing match/reader receipts are byte-pinned,
not accepted. Descriptor/path checks and sampled flags do not exclude a same-uid actor
between observations (D189); an unlink swap is detected by the retained inode's link
count, not prevented atomically. Neither unlink nor a cleanup receipt destroys bytes.
"""

import datetime
import json
import hashlib
import fcntl
import os
import pathlib
import stat
import subprocess
import sys

from host_image_immutable import change_immutable
from preservation_journal import ARM_SCOPE
from host_vm_capture import (CAPTURE_SCOPE, FIXTURE_UUID, HOST_SPEC_FIELDS, file_hash,
                             fsync_parent, guarded_source, pinned_spec, same_host_image)
from host_journal_mount import capture_inputs, capture_locks, clone_identity, record_failure
from host_vm_preflight import no_disk_attachment, owned_directory, preflight, require, write_record


def private_record(path):
    info = path.lstat()
    require(stat.S_ISREG(info.st_mode) and info.st_uid == os.getuid()
            and info.st_nlink == 1 and stat.S_IMODE(info.st_mode) == 0o600,
            f'expected owner-private receipt: {path}')
    return json.loads(path.read_text())


def unattached(clone):
    holders = subprocess.run(['/usr/sbin/lsof', '-t', '--', str(clone)],
                             capture_output=True, timeout=15)
    require(holders.returncode == 1 and not holders.stdout and not holders.stderr,
            'temporary clone has an open holder')
    no_disk_attachment(clone)


def dispose(host_spec, capture_dir, output, fixture=False):
    require(not os.path.lexists(pathlib.Path(capture_dir) / 'ABORT_CLEANUP_INTENT.json'),
            'abort cleanup already initiated; clone disposal is unavailable')
    os.umask(0o077)
    host_spec = pathlib.Path(host_spec)
    capture_dir = pathlib.Path(capture_dir)
    output = pathlib.Path(output)
    owned_directory(capture_dir.parent)
    owned_directory(capture_dir)
    require(output.parent == capture_dir and not os.path.lexists(output),
            'disposal output must be new inside the capture directory')
    if fixture:
        require(capture_dir.parent.name.startswith('openclaw-host-capture-'),
                'fixture disposal requires the owned test parent')
    else:
        require(capture_dir.parent == pathlib.Path.home() /
                'Library/Application Support/OpenClawRecovery',
                'production disposal requires the durable host recovery directory')
    output.mkdir(mode=0o700)
    fsync_parent(capture_dir)
    try:
        armed = private_record(capture_dir / 'ARMED.json')
        capture = private_record(capture_dir / 'CAPTURE.json')
        clone = capture_dir / 'powered-off-image.asif'
        clone_info = clone.lstat()
        require(stat.S_ISREG(clone_info.st_mode) and clone_info.st_uid == os.getuid()
                and clone_info.st_nlink == 1 and stat.S_IMODE(clone_info.st_mode) == 0o600,
                'temporary clone identity differs')
        before = preflight(host_spec, output / 'before-dispose')
        require(before['state'] == 'stopped' and before['holders_consistent']
                and armed['vm_uuid'] == before['vm_uuid'] == capture['vm_uuid']
                and armed['host_boot_session'] == before['host_boot_session'] == capture['host_boot_session']
                and armed['image_device'] == before['image_device'] == clone_info.st_dev
                and armed['image_inode'] == before['image_inode'] != clone_info.st_ino
                and before['image_size'] == capture['source_size'] == capture['clone_size'] == clone_info.st_size
                and capture['scope'] == CAPTURE_SCOPE
                and capture['vm_state_at_final_check'] == 'stopped'
                and capture['source_image_sha256'] == capture['clone_image_sha256'],
                'stopped VM, source image, clone or capture receipt differs')
        require(file_hash(pathlib.Path(before['image'])) == capture['source_image_sha256']
                and file_hash(clone) == capture['clone_image_sha256'],
                'source or temporary clone changed since capture')
        unattached(clone)
        raise RuntimeError('completed capture requires verified acceptance or abort before clone disposal')
    except Exception as error:
        write_record(output / 'FAILED.json', {'error': str(error)})
        raise


def cleanup_failed(host_spec, capture_dir, output, fixture=False):
    os.umask(0o077)
    host_spec = pathlib.Path(host_spec)
    capture_dir = pathlib.Path(capture_dir)
    output = pathlib.Path(output)
    owned_directory(capture_dir.parent)
    owned_directory(capture_dir)
    require(output.parent == capture_dir and not os.path.lexists(output),
            'cleanup output must be new inside the failed capture directory')
    if fixture:
        require(capture_dir.parent.name.startswith('openclaw-host-capture-'),
                'fixture cleanup requires the owned test parent')
    else:
        require(capture_dir.parent == pathlib.Path.home() /
                'Library/Application Support/OpenClawRecovery',
                'production cleanup requires the durable host recovery directory')
    output.mkdir(mode=0o700)
    fsync_parent(capture_dir)
    try:
        armed = private_record(capture_dir / 'ARMED.json')
        failed = private_record(capture_dir / 'FAILED.json')
        initial = private_record(capture_dir / 'before-shutdown/preflight.json')
        require(armed['scope'] == 'waiting for external guest shutdown; no stop request issued'
                and isinstance(failed['error'], str) and failed['error']
                and not os.path.lexists(capture_dir / 'CAPTURE.json'),
                'capture is not an incomplete failed attempt')
        clone = capture_dir / 'powered-off-image.asif'
        info = clone.lstat()
        before = preflight(host_spec, output / 'before-cleanup')
        require(stat.S_ISREG(info.st_mode) and info.st_uid == os.getuid()
                and info.st_nlink == 1 and info.st_dev == before['image_device']
                and info.st_ino != before['image_inode']
                and info.st_size == before['image_size']
                and before['state'] == 'stopped' and before['holders_consistent']
                and armed['vm_uuid'] == initial['vm_uuid'] == before['vm_uuid']
                and armed['host_boot_session'] == initial['host_boot_session'] == before['host_boot_session']
                and (armed['image_device'], armed['image_inode']) ==
                (initial['image_device'], initial['image_inode']) ==
                (before['image_device'], before['image_inode'])
                and initial['image_size'] == before['image_size'],
                'failed capture, clone or stopped VM identity differs')
        unattached(clone)
        change_immutable(clone, (info.st_dev, info.st_ino, info.st_size), False)
        clone.unlink()
        fsync_parent(capture_dir)
        after = preflight(host_spec, output / 'after-cleanup')
        require(after['state'] == 'stopped' and after['holders_consistent']
                and after['host_boot_session'] == before['host_boot_session']
                and (after['image_device'], after['image_inode'], after['image_size']) ==
                (before['image_device'], before['image_inode'], before['image_size'])
                and not os.path.lexists(clone),
                'VM or source image changed during failed-clone cleanup')
        result = {
            'scope': 'failed temporary clone removed while VM sampled stopped; no boot or master acceptance',
            'at_utc': datetime.datetime.now(datetime.timezone.utc).isoformat(),
            'vm_uuid': before['vm_uuid'], 'host_boot_session': before['host_boot_session'],
            'armed_sha256': file_hash(capture_dir / 'ARMED.json'),
            'capture_failure_sha256': file_hash(capture_dir / 'FAILED.json'),
            'clone_absent': True, 'vm_state_at_final_check': 'stopped',
        }
        write_record(output / 'CLEANUP.json', result)
        return result
    except Exception as error:
        write_record(output / 'FAILED.json', {'error': str(error)})
        raise


ABORT_CLEANUP_SCOPE = ('owned completed-capture clone cleanup while source remains guarded; '
                       'not ABORT, acceptance or boot permission; evidence reads foreclosed; '
                       'host spec forward pin only; flags sampled, not continuity; reason carries no authority')
ABORT_INPUTS = ('ARMED.json', 'COMMITTED.json', 'ACKED.json', 'CHECKPOINT.json', 'CAPTURE.json',
                'GUARD_INTENT.json', 'GUARD.json', 'before-shutdown/preflight.json',
                'after-guard/preflight.json')
TERMINALS = ('ABORT.json', 'ACCEPTED.json', 'BOOTABLE.json', 'DECISION.json')


def cleanup_bytes(path, directory_fd=None):
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=directory_fd)
    try:
        before = os.fstat(fd)
        require(stat.S_ISREG(before.st_mode) and before.st_uid == os.getuid()
                and before.st_nlink == 1 and stat.S_IMODE(before.st_mode) == 0o600,
                'cleanup input is not owner-private')
        raw = b''
        while chunk := os.read(fd, 1 << 20):
            raw += chunk
        after = os.fstat(fd)
        named = os.stat(path, dir_fd=directory_fd, follow_symlinks=False)
        require(all(getattr(before, key) == getattr(after, key) == getattr(named, key)
                    for key in ('st_dev', 'st_ino', 'st_size', 'st_mtime_ns', 'st_ctime_ns')),
                'cleanup input changed while read')
        return raw
    finally:
        os.close(fd)


def abort_pins(host_spec, capture_dir, locks, directory_fd):
    for name, fd in zip(('CAPTURE_ACTIVE.lock', 'ARMED.json'), locks):
        opened = os.fstat(fd)
        named = os.stat(name, dir_fd=directory_fd, follow_symlinks=False)
        require((opened.st_dev, opened.st_ino) == (named.st_dev, named.st_ino)
                and stat.S_ISREG(named.st_mode) and named.st_nlink == 1
                and named.st_uid == os.getuid() and stat.S_IMODE(named.st_mode) == 0o600,
                'cleanup lock path no longer names the locked file')
    opened, named = os.fstat(directory_fd), capture_dir.lstat()
    require((opened.st_dev, opened.st_ino) == (named.st_dev, named.st_ino),
            'cleanup capture directory changed')
    evidence = []
    for child in capture_dir.iterdir():
        require(not child.is_symlink(), 'capture contains a symlink')
        if child.is_dir() and child.name != 'abort-cleanup':
            owned_directory(child)
            evidence.extend(str((child / name).relative_to(capture_dir))
                            for name in ('MATCH.json', 'JOURNAL_INPUTS.json')
                            if os.path.lexists(child / name))
    for child in ('before-shutdown', 'after-guard'):
        owned_directory(capture_dir / child)
    return {name: cleanup_bytes(name, directory_fd) for name in (*ABORT_INPUTS, *sorted(evidence))} | {
        'host_spec': cleanup_bytes(host_spec)}


def no_sibling_clone(capture_dir):
    for child in capture_dir.parent.iterdir():
        require(not child.is_symlink(), 'recovery root contains a symlink')
        require(child == capture_dir or not child.is_dir()
                or not os.path.lexists(child / 'powered-off-image.asif'),
                'another temporary image clone still exists')


def no_terminal(capture_dir):
    for child in capture_dir.iterdir():
        require(not child.is_symlink(), 'capture contains a symlink')
        require(child.name not in TERMINALS and not (child.is_dir() and any(
            os.path.lexists(child / name) for name in TERMINALS)),
            'capture already has a boot decision or release record')


def unattached_clone(clone, held):
    require(fcntl.fcntl(held, fcntl.F_GETFL) & os.O_ACCMODE == os.O_RDONLY,
            'cleanup retained clone descriptor is not read-only')
    observed = subprocess.run(['/usr/sbin/lsof', '-Fpfan', '--', str(clone)],
                              capture_output=True, timeout=15)
    expected = (f'p{os.getpid()}\nf{held}\nar\nn{clone}\n').encode()
    require(observed.returncode == 0 and not observed.stderr and observed.stdout == expected,
            'clone holder observation differs from the one retained read-only descriptor')
    no_disk_attachment(clone)


def abort_sample(host_spec, capture_dir, output, pins, source, initial):
    host = json.loads(pins['host_spec'])
    observed = preflight(host_spec, output)
    require(observed['vm_uuid'] == host['uuid'] == FIXTURE_UUID
            and all(observed[key] == initial[key] == host[key] for key in
                    ('package', 'config_sha256', 'utmctl_sha256'))
            and observed['image'] == initial['image'] == str(source)
            and same_host_image(initial, observed), 'cleanup host or source binding differs')
    capture = json.loads(pins['CAPTURE.json'])
    require(guarded_source(capture_dir, initial, observed) == capture['guard_receipt_sha256'],
            'cleanup guard differs from the capture record')
    identity = clone_identity(source, {'clone_size': capture['source_size'],
                                      'clone_image_sha256': capture['source_image_sha256']})
    return observed, identity


def publish_abort_cleanup(directory_fd, name, value):
    temporary = name + '.tmp'
    fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW,
                 0o600, dir_fd=directory_fd)
    with os.fdopen(fd, 'w', encoding='utf-8') as output:
        json.dump(value, output, sort_keys=True, separators=(',', ':'))
        output.write('\n')
        output.flush()
        os.fsync(output.fileno())
    os.rename(temporary, name, src_dir_fd=directory_fd, dst_dir_fd=directory_fd)
    os.fsync(directory_fd)


def abort_cleanup(host_spec, capture_dir, reason, fixture=False):
    require(fixture, 'production abort cleanup requires a verified host boot decision controller')
    host_spec, capture_dir = pathlib.Path(host_spec), pathlib.Path(capture_dir)
    owned_directory(capture_dir.parent)
    owned_directory(capture_dir)
    require(capture_dir.parent.name.startswith(('openclaw-host-capture-', 'openclaw-host-reconcile-')),
            'abort cleanup requires the owned fixture parent')
    host = pinned_spec(host_spec, HOST_SPEC_FIELDS)
    package = pathlib.Path(host['package'])
    require(host['uuid'] == FIXTURE_UUID and package.parent == capture_dir.parent
            and package.resolve() == package and package.is_absolute(),
            'abort cleanup requires the owned fixture VM package')
    require(isinstance(reason, str) and 1 <= len(reason.strip()) <= 300 and reason.isprintable(),
            'abort cleanup requires a bounded explicit reason')
    output = capture_dir / 'abort-cleanup'
    directory_fd = os.open(capture_dir, os.O_RDONLY | os.O_NOFOLLOW | os.O_DIRECTORY)
    locks = []
    previous = os.umask(0o077)
    clone_fd = None
    created = False
    try:
        locks = capture_locks(capture_dir, directory_fd=directory_fd)
        require(not os.path.lexists(output) and not any(os.path.lexists(capture_dir / name)
                for name in ('ABORT_CLEANUP_INTENT.json', 'ABORT_CLEANUP_INTENT.json.tmp',
                             'ABORT_CLEANUP.json', 'ABORT_CLEANUP.json.tmp')),
                'abort cleanup already attempted; manual handling required')
        no_terminal(capture_dir)
        output.mkdir(mode=0o700)
        created = True
        fsync_parent(capture_dir)
        pins = abort_pins(host_spec, capture_dir, locks, directory_fd)
        inputs = capture_inputs(capture_dir)
        initial = json.loads(pins['before-shutdown/preflight.json'])
        capture = json.loads(pins['CAPTURE.json'])
        commitment = inputs['commitment']
        require(json.loads(pins['ARMED.json']).get('scope') == ARM_SCOPE
                and inputs['capture_sha256'] == hashlib.sha256(pins['CAPTURE.json']).hexdigest()
                and commitment == {**json.loads(pins['COMMITTED.json']),
                                   'checkpoint': json.loads(pins['CHECKPOINT.json'])}
                and initial['state'] == 'started'
                and all(initial[key] == commitment['started_sample'][key] for key in
                        ('vm_uuid', 'host_boot_session', 'image_device', 'image_inode',
                         'image_size', 'vmstate'))
                and capture['host_boot_session'] == initial['host_boot_session']
                and capture['source_size'] == capture['clone_size'] == initial['image_size']
                and capture['vmstate_at_arm'] == capture['vmstate_at_final_check'] == initial['vmstate']
                and capture['source_image_sha256'] == capture['clone_image_sha256']
                and capture['data_volume_uuid'] == commitment['manifest']['data_volume_uuid']
                and capture['store_spec_sha256'] == commitment['manifest']['spec_sha256']
                and capture['store_relative_paths'] == commitment['manifest']['store_relative_paths']
                and capture['store_roles'] == sorted(commitment['manifest']['stores']),
                'cleanup capture differs from the pinned checkpoint or original source')
        source = package / 'Data' / host['image_name']
        require(source.resolve() == source and source != capture_dir / 'powered-off-image.asif',
                'cleanup source path is redirected')
        before, source_identity = abort_sample(host_spec, capture_dir, output / 'before',
                                                pins, source, initial)
        clone = capture_dir / 'powered-off-image.asif'
        clone_fd = os.open(clone.name, os.O_RDONLY | os.O_NOFOLLOW, dir_fd=directory_fd)
        opened = os.fstat(clone_fd)
        clone_before = inputs['clone']
        require((opened.st_dev, opened.st_ino) == (clone_before['device'], clone_before['inode'])
                and opened.st_dev == source_identity['device']
                and opened.st_ino != source_identity['inode']
                and not clone_before['flags'] & stat.UF_IMMUTABLE,
                'cleanup clone descriptor differs or clone is immutable')
        no_sibling_clone(capture_dir)
        unattached_clone(clone, clone_fd)
        require(abort_pins(host_spec, capture_dir, locks, directory_fd) == pins
                and clone_identity(clone, capture, held=clone_fd) == clone_before,
                'cleanup inputs changed before intent')
        intent = {'scope': ABORT_CLEANUP_SCOPE, 'at_utc': datetime.datetime.now(datetime.timezone.utc).isoformat(),
                  'reason': reason.strip(), 'capture_nonce': commitment['capture_nonce'],
                  'journal_head': commitment['checkpoint']['journal_head'],
                  'checkpoint_sha256': commitment['checkpoint']['checkpoint_sha256'],
                  'input_sha256': {name: hashlib.sha256(raw).hexdigest() for name, raw in pins.items()},
                  'vm_uuid': before['vm_uuid'], 'host_boot_session': before['host_boot_session'],
                  'source': source_identity, 'clone': clone_before}
        publish_abort_cleanup(directory_fd, 'ABORT_CLEANUP_INTENT.json', intent)
        intent_bytes = cleanup_bytes('ABORT_CLEANUP_INTENT.json', directory_fd)
        require(json.loads(intent_bytes) == intent, 'cleanup intent publication differs')
        _, unchanged = abort_sample(host_spec, capture_dir, output / 'before-remove', pins, source, initial)
        require(unchanged == source_identity and abort_pins(host_spec, capture_dir, locks, directory_fd) == pins
                and clone_identity(clone, capture, held=clone_fd) == clone_before,
                'cleanup inputs changed after intent')
        no_terminal(capture_dir)
        no_sibling_clone(capture_dir)
        unattached_clone(clone, clone_fd)
        require(abort_pins(host_spec, capture_dir, locks, directory_fd) == pins
                and clone_identity(clone, capture, held=clone_fd) == clone_before,
                'cleanup inputs changed before unlink')
        named = os.stat(clone.name, dir_fd=directory_fd, follow_symlinks=False)
        require((named.st_dev, named.st_ino) == (opened.st_dev, opened.st_ino)
                and (capture_dir.stat().st_dev, capture_dir.stat().st_ino) ==
                (os.fstat(directory_fd).st_dev, os.fstat(directory_fd).st_ino),
                'cleanup clone or capture path changed before unlink')
        os.unlink(clone.name, dir_fd=directory_fd)
        os.fsync(directory_fd)
        no_disk_attachment(clone)
        no_terminal(capture_dir)
        no_sibling_clone(capture_dir)
        after, final_source = abort_sample(host_spec, capture_dir, output / 'after', pins, source, initial)
        require(not os.path.lexists(clone) and os.fstat(clone_fd).st_nlink == 0
                and final_source == source_identity
                and abort_pins(host_spec, capture_dir, locks, directory_fd) == pins
                and cleanup_bytes('ABORT_CLEANUP_INTENT.json', directory_fd) == intent_bytes,
                'cleanup final source, input or clone absence differs')
        result = {'scope': ABORT_CLEANUP_SCOPE, 'at_utc': datetime.datetime.now(datetime.timezone.utc).isoformat(),
                  'intent_sha256': hashlib.sha256(intent_bytes).hexdigest(),
                  'capture_nonce': intent['capture_nonce'], 'checkpoint_sha256': intent['checkpoint_sha256'],
                  'clone_absent': True, 'source': final_source, 'vm_uuid': after['vm_uuid'],
                  'host_boot_session': after['host_boot_session'], 'vm_state_at_final_check': 'stopped'}
        publish_abort_cleanup(directory_fd, 'ABORT_CLEANUP.json', result)
        return result
    except BaseException as error:
        if created:
            record_failure(output, 'abort-cleanup', error, None)
        raise
    finally:
        for fd in (clone_fd, directory_fd, *locks):
            if fd is not None:
                os.close(fd)
        os.umask(previous)


if __name__ == '__main__':
    if len(sys.argv) in (5, 6) and sys.argv[1] == 'abort-cleanup':
        require(len(sys.argv) == 5 or sys.argv[5] == '--fixture', 'invalid abort cleanup option')
        abort_cleanup(sys.argv[2], sys.argv[3], sys.argv[4], len(sys.argv) == 6)
    elif len(sys.argv) in (5, 6) and sys.argv[1] == 'cleanup-failed':
        require(len(sys.argv) == 5 or sys.argv[5] == '--fixture', 'invalid cleanup option')
        cleanup_failed(sys.argv[2], sys.argv[3], sys.argv[4], len(sys.argv) == 6)
    else:
        require(len(sys.argv) in (4, 5),
                'usage: host_clone_dispose.py HOST_SPEC CAPTURE_DIR NEW_OUTPUT [--fixture]')
        require(len(sys.argv) == 4 or sys.argv[4] == '--fixture', 'invalid disposal option')
        dispose(sys.argv[1], sys.argv[2], sys.argv[3], len(sys.argv) == 5)
