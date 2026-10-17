#!/usr/bin/env python3
"""Owned-only read-only ASIF mount of a published fixture capture's clone for the journal reader (B5).

The clone of a published owned fixture capture is attached read-only without mounting, and its one
Data volume is mounted read-only at a fresh private mount point. Before verify_stopped_journal()
reads anything, the mount must be read-only, nodev, nosuid and noexec, and must honour ownership;
after it, every file it read must be on that mount, it must have verified the pinned commitment,
and the mount must verify unchanged. CAPTURE_ACTIVE.lock and the ARMED.json arm lock are both held
exclusively throughout, so no capture worker still runs and no guard, commit or reconcile acts.
Before the attach and again after the eject, the CAPTURE.json pins and their commitment, the
fixture VM, the locked arm record, the clone's identity (device, inode, size, mtime, ctime, flags)
and hash and the Data volume UUID are checked and must be equal. The receipt lists the metadata of
every file the reader actually read; it is published whole and exclusively, or not at all.

Production refuses: no host-pinned B3 table or protected acceptance root exists, and this tool
claims neither. Only a capture of the owned fixture VM (named by the capture record and by the
host's own pinned started sample), inside an owner-private fixture parent (the native fixture
capture's or the owned tests'), is mounted; that check is positive, so no HOME override or deeper
path reaches the durable recovery directory. The table is the caller's and is never read from the
image. D196 records one native CI runner's mount/ownership/identity observations; they do not
establish end-to-end stopped-image reader acceptance or behavior on other systems.

Every failure keeps its primary exception. Cleanup (unmount, eject, absence check, mount point
removal) runs on every path, records each attempt and never raises; FAILED.json carries the
primary error with the cleanup evidence. An attach or mount that failed or timed out may still
have applied, so cleanup finds the clone's attachments in hdiutil's inventory and the mount
through statfs. A remembered attach disk is only an absence check, never authority to eject:
if the inventory cannot bind it to the clone, cleanup keeps the image and fails closed. Every
remembered disk must also be gone before the run counts as clean. A retried eject first re-reads
the inventory to refuse a number it no longer binds to the clone. These are sequential
observations, not atomic exclusion of concurrent disk replacement. The mount point is removed
only once statfs confirmed it is no longer a mount and it is a plain empty directory.

An interrupt (KeyboardInterrupt, SystemExit) that arrives during cleanup stops the cleanup where
it arrived, so cleanup stays bounded and never swallows it into further steps; it is recorded
and the run is not clean. After a primary error that error is still the one raised, with the
interrupt in its FAILED.json evidence; after a successful read the interrupt itself is raised,
with FAILED.json, and no receipt is written. Python delivers an interrupt between bytecodes, so
one landing in the few bytecodes around the cleanup call can still lose FAILED.json; the next
run's inventory check refuses an attachment any lost cleanup left behind.

Follow-up, deliberately not done here: host_asif_extract.extract() keeps its own attach and mount
for the store extraction. Moving it onto these primitives would bound its commands (they have no
timeout), keep its primary error (it merges cleanup errors into one) and verify the mount's
ownership and nodev/nosuid/noexec flags (it checks only WritableVolume and the mount point).
"""
import ctypes
import datetime
import fcntl
import hashlib
import json
import os
import pathlib
import plistlib
import re
import stat
import subprocess
import sys
import time

from host_guest_commit import private_bytes, require_captured, require_committed
from host_vm_capture import CAPTURE_SCOPE, FIXTURE_UUID, fsync_parent
from host_vm_preflight import owned_directory, require, write_record
from stopped_journal_inputs import verify_stopped_journal

DISKUTIL = '/usr/sbin/diskutil'
HDIUTIL = '/usr/bin/hdiutil'
CLONE = 'powered-off-image.asif'
FIXTURE_PARENTS = ('openclaw-host-capture-', 'openclaw-capture-owned-')
PRODUCTION_REFUSAL = 'production journal mount requires a host-pinned B3 table and a protected acceptance root'
LOCKS = (('CAPTURE_ACTIVE.lock', 'capture worker is still active'),
         ('ARMED.json', 'capture is busy: another holder has the arm lock'))
OUTPUT_NAME = re.compile(r'journal-read(-[0-9A-Za-z]+)?')
TIMEOUT = 60
EJECT_ATTEMPTS = 3
EJECT_PAUSE = 1.0
MOUNT_OPTIONS = 'nobrowse,nodev,nosuid,noexec,owners'
# sys/mount.h
MNT_RDONLY = 0x00000001
MNT_NOEXEC = 0x00000004
MNT_NOSUID = 0x00000008
MNT_NODEV = 0x00000010
MNT_IGNORE_OWNERSHIP = 0x00200000
REQUIRED_FLAGS = (('read-only', MNT_RDONLY), ('nodev', MNT_NODEV), ('nosuid', MNT_NOSUID),
                  ('noexec', MNT_NOEXEC))
SCOPE = ('owned read-only clone mount for the frozen journal reader; not stopped-ASIF acceptance; '
         'B3 host-pinned table and protected acceptance root external')
DISK = re.compile(r'/dev/disk[0-9]+')
PARTITION = re.compile(r'/dev/disk[0-9]+(?:s[0-9]+)+')


def device_node(raw, *, partition=False):
    require(isinstance(raw, str), 'device identifier is not a string')
    node = raw if raw.startswith('/dev/') else '/dev/' + raw
    require((PARTITION if partition else DISK).fullmatch(node), 'device identifier has an invalid shape')
    return node


def attached_disk(row):
    try:
        entities = plistlib.loads(row['stdout']).get('system-entities') or [{}]
        return [device_node(entities[0].get('dev-entry'))]
    except Exception:
        return []


def data_device(raw, info):
    node = info.get('DeviceNode')
    require(isinstance(node, str) and PARTITION.fullmatch(node) and raw in (node, node[5:]),
            'Data DeviceNode differs from its attach entry')
    return node


def attempt(*argv, timeout=TIMEOUT):
    """One bounded command; never raises, so it cannot mask an error."""
    row = {'argv': list(argv), 'returncode': None, 'timed_out': False, 'stdout': b'', 'stderr': ''}
    try:
        # No stdin: an image passphrase prompt would otherwise wait out the whole timeout.
        done = subprocess.run(argv, capture_output=True, timeout=timeout, stdin=subprocess.DEVNULL)
    except subprocess.TimeoutExpired:
        return {**row, 'timed_out': True}
    except OSError as error:
        return {**row, 'stderr': str(error)[:300]}
    return {**row, 'returncode': done.returncode, 'stdout': done.stdout,
            'stderr': done.stderr.decode(errors='replace')[:300]}


def evidence(row):
    """A command attempt as recorded: its output by digest, never its bytes."""
    return {**{key: value for key, value in row.items() if key != 'stdout'},
            'stdout_sha256': hashlib.sha256(row['stdout']).hexdigest()}


def plist_of(row, what):
    require(row['returncode'] == 0 and not row['timed_out'], what + ' failed or timed out')
    try:
        value = plistlib.loads(row['stdout'])
    except Exception as error:
        raise RuntimeError(what + ' output is not a plist') from error
    require(isinstance(value, dict), what + ' output is not a plist dictionary')
    return value


class _Statfs(ctypes.Structure):
    # The 64-bit-inode struct statfs of macOS sys/mount.h.
    _fields_ = [('f_bsize', ctypes.c_uint32), ('f_iosize', ctypes.c_int32),
                ('f_blocks', ctypes.c_uint64), ('f_bfree', ctypes.c_uint64),
                ('f_bavail', ctypes.c_uint64), ('f_files', ctypes.c_uint64),
                ('f_ffree', ctypes.c_uint64), ('f_fsid', ctypes.c_int32 * 2),
                ('f_owner', ctypes.c_uint32), ('f_type', ctypes.c_uint32),
                ('f_flags', ctypes.c_uint32), ('f_fssubtype', ctypes.c_uint32),
                ('f_fstypename', ctypes.c_char * 16), ('f_mntonname', ctypes.c_char * 1024),
                ('f_mntfromname', ctypes.c_char * 1024), ('f_flags_ext', ctypes.c_uint32),
                ('f_reserved', ctypes.c_uint32 * 7)]


def statfs(path):
    """The mount that contains `path`: its flags, filesystem type and both mount names."""
    require(sys.platform == 'darwin', 'mount verification requires macOS statfs')
    libc = ctypes.CDLL(None, use_errno=True)
    try:
        call = libc['statfs$INODE64']
    except AttributeError:
        call = libc.statfs
    call.argtypes = [ctypes.c_char_p, ctypes.POINTER(_Statfs)]
    value = _Statfs()
    if call(os.fsencode(path), ctypes.byref(value)) != 0:
        error = ctypes.get_errno()
        raise OSError(error, os.strerror(error), str(path))
    return {'flags': value.f_flags, 'fstypename': os.fsdecode(value.f_fstypename),
            'mntonname': os.fsdecode(value.f_mntonname), 'mntfromname': os.fsdecode(value.f_mntfromname)}


def attachments(clone):
    """Every hdiutil attachment of this clone file, found by path or by identity."""
    info = plist_of(attempt(HDIUTIL, 'info', '-plist'), 'attached image inventory')
    found = []
    for image in info.get('images', []):
        path = pathlib.Path(image.get('image-path', ''))
        if path == clone or os.path.lexists(path) and os.path.samefile(path, clone):
            found.append(image)
    return found


def clone_identity(path, capture, held=None):
    """The clone's owned single-link identity and sha256, as the capture record pins them."""
    info = path.lstat()
    require(stat.S_ISREG(info.st_mode) and info.st_uid == os.getuid() and info.st_nlink == 1
            and stat.S_IMODE(info.st_mode) == 0o600 and info.st_size == capture.get('clone_size'),
            'clone is not the owned single-link 0600 image of the recorded size')
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW) if held is None else held
    try:
        os.lseek(fd, 0, os.SEEK_SET)
        opened = os.fstat(fd)
        digest = hashlib.sha256()
        while chunk := os.read(fd, 1 << 20):
            digest.update(chunk)
        after = os.fstat(fd)
    finally:
        if held is None:
            os.close(fd)
    require((opened.st_dev, opened.st_ino) == (info.st_dev, info.st_ino)
            and (after.st_size, after.st_mtime_ns) == (info.st_size, info.st_mtime_ns),
            'clone changed while it was hashed')
    require(digest.hexdigest() == capture.get('clone_image_sha256'), 'clone hash differs from the capture record')
    # ctime is compared too: a rename-away-and-back keeps inode, mtime and bytes but not ctime. If
    # probe_asif_mount_ownership.py shows a read-only attach itself changes it, that is a refusal
    # until a reviewed relaxation, never a silent one.
    return {'device': info.st_dev, 'inode': info.st_ino, 'size': info.st_size,
            'mtime_ns': info.st_mtime_ns, 'ctime_ns': info.st_ctime_ns,
            'flags': getattr(info, 'st_flags', 0), 'sha256': digest.hexdigest()}


def capture_inputs(capture_dir):
    """The pinned capture, its commitment, the arm record and the clone, compared before and after."""
    require(not os.path.lexists(capture_dir / 'FAILED.json'), 'capture failed; its clone is not mounted')
    raw = private_bytes(capture_dir / 'CAPTURE.json')
    pinned = require_captured(capture_dir)
    commitment = require_committed(capture_dir)
    require(commitment == {**json.loads(pinned['COMMITTED.json']),
                           'checkpoint': json.loads(pinned['CHECKPOINT.json'])},
            'capture commitment differs from the pinned capture record')
    # require_captured() checked the pins against its own read: it must have read these bytes.
    require(private_bytes(capture_dir / 'CAPTURE.json') == raw, 'capture record changed while it was read')
    capture = json.loads(raw)
    require(capture.get('scope') == CAPTURE_SCOPE and capture.get('vm_state_at_final_check') == 'stopped',
            'capture record is not a completed stopped-VM capture')
    require(capture.get('vm_uuid') == FIXTURE_UUID == commitment['started_sample'].get('vm_uuid'),
            'capture is not of the owned fixture VM')
    require(isinstance(capture.get('data_volume_uuid'), str) and capture['data_volume_uuid'],
            'capture record names no Data volume')
    armed = (capture_dir / 'ARMED.json').lstat()
    return {'capture_sha256': hashlib.sha256(raw).hexdigest(), 'commitment': commitment,
            'data_volume_uuid': capture['data_volume_uuid'], 'arm_record': [armed.st_dev, armed.st_ino],
            'clone': clone_identity(capture_dir / CLONE, capture)}


def data_volume(entities, uuid):
    """The attached image's one unencrypted, unmounted APFS volume named Data with the pinned UUID."""
    found = []
    for entity in entities:
        if entity.get('content-hint') != 'Apple_APFS_Volume':
            continue
        raw = entity.get('dev-entry')
        info = plist_of(attempt(DISKUTIL, 'info', '-plist', device_node(raw, partition=True)), 'volume information')
        if info.get('VolumeUUID') == uuid:
            found.append((data_device(raw, info), info))
    require(len(found) == 1, 'pinned Data volume UUID is not on the attached clone exactly once')
    volume, info = found[0]
    require(info.get('VolumeName') == 'Data', 'pinned volume is not named Data')
    require(info.get('Encryption') is False, 'pinned Data volume is encrypted')
    require(not info.get('MountPoint'), 'pinned Data volume is already mounted')
    return volume


def verify_mount(mount, volume, uuid):
    """The private mount point holds this Data volume read-only, nodev, nosuid, noexec, owners honoured."""
    info = plist_of(attempt(DISKUTIL, 'info', '-plist', volume), 'mounted volume information')
    require(info.get('WritableVolume') is False, 'Data volume is writable')
    require(info.get('MountPoint') and pathlib.Path(info['MountPoint']) == mount,
            'Data volume is not mounted at the private mount point')
    require(info.get('VolumeUUID') == uuid, 'mounted volume UUID differs')
    require(info.get('GlobalPermissionsEnabled') is True, 'Data volume ownership is not enabled')
    found = statfs(mount)
    require(found['mntonname'] == str(mount), 'private mount point is not a mount')
    require(found['mntfromname'] == volume, 'private mount point holds another device')
    require(found['fstypename'] == 'apfs', 'mounted filesystem is not APFS')
    missing = [name for name, bit in REQUIRED_FLAGS if not found['flags'] & bit]
    require(not missing, 'mount is not ' + ', '.join(missing))
    require(not found['flags'] & MNT_IGNORE_OWNERSHIP, 'mount ignores ownership')
    return {'diskutil': {key: info.get(key) for key in ('WritableVolume', 'MountPoint', 'VolumeUUID',
                                                        'GlobalPermissionsEnabled', 'DeviceNode')},
            'statfs': found}


def remove_mount_point(mount):
    """rmdir the private mount point, once it is a plain directory with nothing in it."""
    require(stat.S_ISDIR(mount.lstat().st_mode), 'mount point is not a directory')
    with os.scandir(mount) as entries:
        require(next(entries, None) is None, 'mount point is not empty')
    os.rmdir(mount)
    return 'removed'


def release(clone, mount, attached, known=()):
    """Unmount, eject the clone's attachments, confirm absence, remove the mount point.

    Returns the cleanup evidence and the interrupt that stopped it (or None); never raises. A
    step's error is recorded and the next step still runs. Nothing is ejected unless this run
    attempted the attach (`attached`): any attachment of the clone before that was refused, not
    made here, and is not this run's to eject. `known` is the attach result's disk: never used as
    authority to eject, and required gone (diskutil no longer knows it) for the run to be clean. A still-mounted or unreadable mount point is kept.
    """
    steps = []

    def step(name, call):
        try:
            result = call()
        except Exception as error:
            steps.append({'step': name, 'error': repr(error)[:300]})
            return None
        steps.append({'step': name, 'result': result})
        return result

    def mounted():
        return os.path.lexists(mount) and statfs(mount)['mntonname'] == str(mount)

    def clone_disks():
        return [image.get('system-entities', [{}])[0].get('dev-entry') for image in attachments(clone)]

    try:
        # An unknown mount state (statfs failed) is unmounted too: unmounting nothing only fails.
        if step('mounted before cleanup', mounted) is not False:
            step('unmount', lambda: evidence(attempt(DISKUTIL, 'unmount', str(mount))))
        rows = step('attachments before eject', clone_disks)
        for disk in (rows or ()) if attached else ():
            for tries in range(EJECT_ATTEMPTS):
                if tries:
                    time.sleep(EJECT_PAUSE)
                    # A timed-out eject may have applied and freed the number for another image.
                    if disk not in (step('attachments before eject retry', clone_disks) or ()):
                        break
                ejected = step('eject ' + str(disk), lambda: evidence(attempt(DISKUTIL, 'eject', str(disk))))
                if ejected and ejected['returncode'] == 0:
                    break
        remaining = step('attachments after eject', lambda: len(attachments(clone)))
        gone = [step('attach result disk after eject', lambda: evidence(attempt(DISKUTIL, 'info', '-plist', disk)))
                for disk in (known if attached else ())]
        still = step('mounted after eject', mounted)
        if still is False and os.path.lexists(mount):
            step('remove mount point', lambda: remove_mount_point(mount))
        elif os.path.lexists(mount):
            steps.append({'step': 'remove mount point', 'kept': 'still mounted or mount state unreadable'})
    except BaseException as interrupt:
        # step() records every Exception, so only an interrupt gets here: stop, record, return it.
        steps.append({'step': 'interrupted', 'error': repr(interrupt)[:300]})
        return {'steps': steps, 'clean': False}, interrupt
    return {'steps': steps, 'clean': (remaining == 0 or not attached)
            and all(row is not None and row['returncode'] not in (0, None) for row in gone)
            and still is False and not os.path.lexists(mount)}, None


def publish_receipt(output, receipt):
    """JOURNAL_INPUTS.json whole or not at all: written aside, linked in exclusively, then synced.

    A failure after the link removes it again, so a receipt never stands beside FAILED.json.
    """
    final, aside = output / 'JOURNAL_INPUTS.json', output / 'JOURNAL_INPUTS.json.partial'
    require(not os.path.lexists(aside), 'receipt staging file already exists')
    linked = False
    try:
        write_record(aside, receipt)
        os.link(aside, final)
        linked = True
        os.unlink(aside)
        fsync_parent(output)
    except BaseException:
        for path in (final, aside) if linked else (aside,):
            try:
                os.unlink(path)
            except OSError:
                pass
        raise


def record_failure(output, stage, error, cleanup):
    """FAILED.json for the primary error and its cleanup; never raises, so it cannot replace it.

    An interrupt while writing it is dropped too: the error being recorded is raised right after.
    """
    try:
        write_record(output / 'FAILED.json', {'stage': stage, 'primary_error': repr(error)[:300],
                                              'cleanup': cleanup})
    except BaseException:
        pass


def capture_locks(capture_dir, directory_fd=None):
    """CAPTURE_ACTIVE.lock, then ARMED.json, each locked exclusively without waiting.

    Each is opened without following a link or blocking on a FIFO and must be an owner-private
    regular file. The order is the reconcile tool's, and neither lock is waited for.
    """
    held = []
    try:
        for name, busy in LOCKS:
            held.append(os.open(capture_dir / name if directory_fd is None else name,
                                os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=directory_fd))
            info = os.fstat(held[-1])
            require(stat.S_ISREG(info.st_mode) and info.st_uid == os.getuid() and info.st_nlink == 1
                    and stat.S_IMODE(info.st_mode) == 0o600, name + ' is not an owner-private lock file')
            try:
                fcntl.flock(held[-1], fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError as error:
                raise RuntimeError(busy) from error
    except BaseException:
        for fd in held:
            os.close(fd)
        raise
    return held


def read_journal_inputs(capture_dir, output, *, table, fixture=False):
    """Mount the fixture capture's clone read-only, read its journal inputs, release, receipt."""
    require(fixture, PRODUCTION_REFUSAL)
    capture_dir = pathlib.Path(capture_dir)
    output = pathlib.Path(output)
    owned_directory(capture_dir.parent)
    owned_directory(capture_dir)
    require(capture_dir.parent.name.startswith(FIXTURE_PARENTS),
            'journal mount requires an owned fixture capture parent')
    require(output.parent == capture_dir, 'journal mount output must be a child of the capture directory')
    # A fixed name, so the output can never take a capture record's name (FAILED.json, ...).
    require(OUTPUT_NAME.fullmatch(output.name), 'journal mount output must be named journal-read[-NAME]')
    # The capture worker's owner-private umask, for this run only.
    previous = os.umask(0o077)
    try:
        output.mkdir(mode=0o700)
        fsync_parent(capture_dir)
        try:
            locks = capture_locks(capture_dir)
        except BaseException as error:
            record_failure(output, 'lock', error, None)
            raise
        try:
            return locked_read(capture_dir, output, table, locks[-1])
        finally:
            for fd in locks:
                os.close(fd)
    finally:
        os.umask(previous)


def locked_read(capture_dir, output, table, armed):
    clone = capture_dir / CLONE
    mount = output / 'mount'
    stage = 'inputs'
    attach_attempted, known = False, []
    try:
        before = capture_inputs(capture_dir)
        locked = os.fstat(armed)
        require([locked.st_dev, locked.st_ino] == before['arm_record'],
                'the locked ARMED.json is not the capture arm record')
        stage = 'inventory'
        require(not attachments(clone), 'clone is already attached')
        stage = 'attach'
        attach_attempted = True
        attached = attempt(DISKUTIL, 'image', 'attach', '--plist', '--readOnly', '--noMount', str(clone))
        known = attached_disk(attached)
        entities = plist_of(attached, 'read-only attach').get('system-entities') or [{}]
        require(len(known) == 1, 'attach result names no valid whole disk')
        rows = attachments(clone)
        require(len(rows) == 1 and rows[0].get('writeable') is False,
                'clone is not attached exactly once read-only')
        disk = rows[0].get('system-entities', [{}])[0].get('dev-entry')
        require(isinstance(disk, str) and DISK.fullmatch(disk) and known[0] == disk,
                'attached clone disk differs from the attach result')
        stage = 'volume'
        volume = data_volume(entities, before['data_volume_uuid'])
        stage = 'mount'
        mount.mkdir(mode=0o700)
        done = attempt(DISKUTIL, 'mount', 'readOnly', '-mountOptions', MOUNT_OPTIONS,
                       '-mountPoint', str(mount), volume)
        require(done['returncode'] == 0 and not done['timed_out'], 'read-only mount failed or timed out')
        stage = 'verify'
        verified = verify_mount(mount, volume, before['data_volume_uuid'])
        device = os.stat(mount).st_dev
        stage = 'read'
        summary = verify_stopped_journal(capture_dir, mount, table=table)
        # What the reader returned is bound to what was mounted and committed.
        require(summary['read'] and all(row['device'] == device for row in summary['read']),
                'the reader read outside the verified mount')
        require(summary['checkpoint_sha256'] == before['commitment']['checkpoint']['checkpoint_sha256']
                and summary['pre_head'] == before['commitment']['manifest']['journal_head'],
                'the reader verified another commitment')
        stage = 'reverify'
        require(verify_mount(mount, volume, before['data_volume_uuid']) == verified
                and os.stat(mount).st_dev == device, 'the mount changed while it was read')
    except BaseException as error:
        # The primary error is raised; an interrupt that stopped this cleanup is its evidence.
        cleanup, _ = release(clone, mount, attach_attempted, known)
        record_failure(output, stage, error, cleanup)
        raise
    cleanup, interrupt = release(clone, mount, attach_attempted, known)
    try:
        stage = 'release'
        if interrupt is not None:
            raise interrupt
        require(cleanup['clean'], 'journal mount cleanup did not complete')
        stage = 'after eject'
        after = capture_inputs(capture_dir)
        require(after == before, 'capture pins, commitment, clone or volume changed while mounted')
        receipt = {
            'scope': SCOPE, 'at_utc': datetime.datetime.now(datetime.timezone.utc).isoformat(),
            'capture_sha256': before['capture_sha256'],
            'checkpoint_sha256': before['commitment']['checkpoint']['checkpoint_sha256'],
            'clone_before': before['clone'], 'clone_after': after['clone'],
            'attach': {'disk': disk, 'inventory_disk_raw': rows[0]['system-entities'][0]['dev-entry'],
                       'command': evidence(attached),
                       'entities': [{key: entity.get(key) for key in ('dev-entry', 'content-hint')}
                                    for entity in entities]},
            'volume': volume, 'data_volume_uuid': before['data_volume_uuid'],
            'mount': {'point': str(mount), 'options': MOUNT_OPTIONS, 'command': evidence(done), 'device': device,
                      **verified},
            'reader': {key: summary[key] for key in ('window', 'lineage', 'checkpoint_sha256', 'pre_head',
                                                     'session', 'config_modes')},
            'read': summary['read'], 'cleanup': cleanup}
        stage = 'receipt'
        publish_receipt(output, receipt)
    except BaseException as error:
        record_failure(output, stage, error, cleanup)
        raise
    return receipt


if __name__ == '__main__':
    require(len(sys.argv) in (4, 5) and sys.argv[4:] in ([], ['--fixture']),
            'usage: host_journal_mount.py CAPTURE_DIR OUTPUT TABLE_JSON [--fixture]')
    # Refused before the table is even read.
    require(sys.argv[4:] == ['--fixture'], PRODUCTION_REFUSAL)
    read_journal_inputs(sys.argv[1], sys.argv[2], table=json.loads(private_bytes(pathlib.Path(sys.argv[3]))),
                        fixture=True)
