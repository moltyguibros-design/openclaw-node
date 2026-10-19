#!/usr/bin/env python3
"""CI-only macOS probe: what a read-only ASIF mount really reports, and whether it honours owners.

host_journal_mount.py relies on facts documented but never observed natively: the hdiutil
inventory's `writeable` row, the diskutil WritableVolume / MountPoint / VolumeUUID /
GlobalPermissionsEnabled / Encryption keys, the statfs layout and flags, that `diskutil mount
readOnly -mountOptions nobrowse,nodev,nosuid,noexec,owners` sets them, and that a read-only attach
leaves the image bytes unchanged. This probe observes them on a disposable runner only.

It creates its own fresh ASIF with one APFS volume named Data in a new private directory, mounts
it read-write at a private point, enables ownership, writes a user file and a decisive root-owned
0600 file (`sudo -n chown 0:0`), and ejects. It then mounts the image read-only three ways: the
wrapper's exact options, plain readOnly, and the wrapper's options again after ownership was
disabled. For each it records the attach and inventory rows, both diskutil views, the statfs flags,
the owner and mode the mount reports for both files, whether the runner user can read the root
file, and the wrapper's own verify_mount() verdict. The image's sha256, times, flags and xattr
names are recorded before and after every read-only mount, and every inventory row with its
system entities, so the wrapper's inventory-to-attach binding can be checked. Intended operations
are confined to its own image; inventory-to-eject observations are sequential, not atomic against
concurrent disk replacement. Cleanup unmounts its own mount points, ejects the disks the
inventory binds to its image (retried only while the inventory still binds them, after a pause),
never ejects from a remembered disk number alone (an attach result is an absence check, not
current identity proof), requires every disk its own attaches returned gone,
and only then removes its directory; a removal failure is recorded. An interrupt during cleanup
stops it where it arrived, is recorded, and is raised again once the report is written; a phase's
own earlier interrupt is the one raised. The JSON report is written exclusively on handled
error and cleanup-interrupt paths. An interrupt during directory removal or a report-write
failure can still lose it. A missing report or nonzero exit cannot pass the native verification
gate.

Guards, all required, checked before any command: macOS, CI=true and GITHUB_ACTIONS=true (both set
by GitHub Actions), OPENCLAW_OWNERSHIP_PROBE=1, the --ci-owned-probe flag, a new output path in an
existing directory, a non-root runner, then passwordless sudo.

The isolated asif-mount-ownership-macos CI job invokes this probe and uploads its report:

    OPENCLAW_OWNERSHIP_PROBE=1 /usr/bin/python3 \\
      memory-plan/plans/node-state-recovery/audits/step12_jetstream/probe_asif_mount_ownership.py \\
      --ci-owned-probe "$RUNNER_TEMP/asif-mount-ownership.json"

Exit 0 means the probe completed and cleaned up, not that the wrapper's assumptions hold; that
is read from the report.

--ci-owned-reader instead seeds the existing synthetic checkpoint fixture on its own fresh ASIF
and exercises the complete unmodified journal mount wrapper. Its host VM samples and hold/stop
observations are synthetic; there is no VM or NATS server. The intact read must verify against
the host pins, and corrupt-chain, pending, unknown-entry and changed-config cases must refuse
for their named reasons. Each writable reseed is followed by a detach and a new fixture clone
hash publication; only the subsequent read-only interval claims unchanged image bytes/identity.
Failed reader runs keep their owned image/directory for diagnosis after releasing its disks.
This is frozen-reader mechanism evidence, not a stopped-VM capture or history acceptance.
"""
import datetime
import hashlib
import json
import os
import pathlib
import re
import shutil
import sys
import tempfile
import time
from unittest import mock

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

import host_journal_mount as wrapper  # noqa: E402
from host_journal_mount import DISKUTIL, MOUNT_OPTIONS, attachments, attempt, evidence  # noqa: E402
from host_vm_preflight import require, write_record  # noqa: E402

SUDO = '/usr/bin/sudo'
SCOPE = ('CI-only owned ASIF read-only mount ownership probe; a disposable image it created; '
         'not stopped-ASIF acceptance and no production volume')
KEYS = ('WritableVolume', 'MountPoint', 'VolumeUUID', 'VolumeName', 'Encryption', 'DeviceNode',
        'GlobalPermissionsEnabled', 'FilesystemType')
# sys/mount.h MNT_* bits, for a readable report; unknown bits are kept as a hex remainder.
FLAG_NAMES = (('rdonly', 0x1), ('synchronous', 0x2), ('noexec', 0x4), ('nosuid', 0x8),
              ('nodev', 0x10), ('union', 0x20), ('async', 0x40), ('cprotect', 0x80),
              ('exported', 0x100), ('removable', 0x200), ('quarantine', 0x400), ('local', 0x1000),
              ('quota', 0x2000), ('rootfs', 0x4000), ('dovolfs', 0x8000),
              ('dontbrowse', 0x100000), ('ignore_ownership', 0x200000), ('automounted', 0x400000),
              ('journaled', 0x800000), ('nouserxattr', 0x1000000), ('defwrite', 0x2000000),
              ('multilabel', 0x4000000), ('nofollow', 0x8000000), ('noatime', 0x10000000),
              ('snapshot', 0x40000000), ('strictatime', 0x80000000))
VARIANTS = (('wrapper-options', MOUNT_OPTIONS, False), ('plain-readonly', None, False),
            ('wrapper-options-ownership-disabled', MOUNT_OPTIONS, True))
READER_CASES = (('intact', None), ('corrupt-chain', 'journal chain differs'),
                ('pending', 'unknown or pending entry'), ('unknown', 'unknown entry'),
                ('changed-config', 'config bytes differ from the baseline hash'))


def flag_names(flags):
    names = [name for name, bit in FLAG_NAMES if flags & bit]
    rest = flags & ~sum(bit for _, bit in FLAG_NAMES)
    return names + (['0x%x' % rest] if rest else [])


def guard(argv, environ, platform=sys.platform):
    """The probe's output path, once every guard holds; nothing runs before the last one."""
    require(platform == 'darwin', 'the ownership probe runs only on macOS')
    require(environ.get('CI') == 'true' and environ.get('GITHUB_ACTIONS') == 'true',
            'the ownership probe runs only on a GitHub Actions runner')
    require(environ.get('OPENCLAW_OWNERSHIP_PROBE') == '1', 'OPENCLAW_OWNERSHIP_PROBE=1 is required')
    require(len(argv) == 2 and argv[0] in ('--ci-owned-probe', '--ci-owned-reader'),
            'usage: probe_asif_mount_ownership.py --ci-owned-probe|--ci-owned-reader OUTPUT_JSON')
    output = pathlib.Path(argv[1])
    require(output.is_absolute() and not os.path.lexists(output) and output.parent.is_dir(),
            'probe output must be a new file in an existing directory')
    require(os.getuid() != 0 and os.geteuid() != 0,
            'the ownership probe requires a non-root runner')
    sudo = attempt(SUDO, '-n', '/usr/bin/true')
    require(sudo['returncode'] == 0 and not sudo['timed_out'], 'passwordless sudo is required')
    return output


def checked(row, what):
    require(row['returncode'] == 0 and not row['timed_out'], what + ' failed: ' + row['stderr'])
    return row


def image_state(image):
    raw = image.read_bytes()
    info = image.lstat()
    names = attempt('/usr/bin/xattr', str(image))
    return {'sha256': hashlib.sha256(raw).hexdigest(), 'size': info.st_size, 'inode': info.st_ino,
            'mtime_ns': info.st_mtime_ns, 'ctime_ns': info.st_ctime_ns, 'flags': getattr(info, 'st_flags', 0),
            'xattrs': names['stdout'].decode(errors='replace').split()}


def attach(image, disks, *flags):
    row = attempt(DISKUTIL, 'image', 'attach', '--plist', *flags, '--noMount', str(image))
    # Recorded before the status check: an attach that failed or timed out may still have applied.
    known = wrapper.attached_disk(row)
    disks.extend(known)
    checked(row, 'attach')
    entities = wrapper.plist_of(row, 'attach').get('system-entities') or []
    require(len(known) == 1, 'attach result names no valid whole disk')
    data = []
    for entity in entities:
        if entity.get('content-hint') == 'Apple_APFS_Volume':
            info = wrapper.plist_of(attempt(DISKUTIL, 'info', '-plist',
                                           wrapper.device_node(entity.get('dev-entry'), partition=True)), 'info')
            if info.get('VolumeName') == 'Data':
                data.append((wrapper.data_device(entity['dev-entry'], info), info))
    require(len(data) == 1, 'the probe image does not hold exactly one Data volume')
    return {'command': evidence(row), 'entities': entities, 'volume': data[0][0],
            'info': {key: data[0][1].get(key) for key in KEYS},
            'inventory': [{'keys': sorted(image_row), 'writeable': image_row.get('writeable'),
                           'image-path': image_row.get('image-path'),
                           'system-entities': image_row.get('system-entities')} for image_row in attachments(image)]}


def info_of(volume):
    found = wrapper.plist_of(attempt(DISKUTIL, 'info', '-plist', volume), 'info')
    return {key: found.get(key) for key in KEYS}


def mount_at(point, volume, *options):
    point.mkdir(mode=0o700)
    return checked(attempt(DISKUTIL, 'mount', *options, '-mountPoint', str(point), volume), 'mount')


def release(image, points, disks):
    """Unmount the probe's mount points, eject its image's disks, require them gone.

    Returns the cleanup evidence and the interrupt that stopped it (or None); never raises. An
    eject is retried, after a pause, only while the inventory still binds the disk to the image.
    `disks` are the whole disks the probe's own attaches returned. Every one must be unknown to
    diskutil afterwards, but a remembered number never authorizes an eject: cleanup may run
    twice after a phase error, and that number may already belong to another image.
    """
    rows, errors, remaining, still, gone, listed = [], [], None, None, [], None

    def recorded(call):
        try:
            return call()
        except Exception as error:
            errors.append(repr(error)[:300])
            return None

    def mounted(point):
        return os.path.lexists(point) and wrapper.statfs(point)['mntonname'] == str(point)

    def bound():
        return [disk for disk in (row.get('system-entities', [{}])[0].get('dev-entry') for row in attachments(image))
                if isinstance(disk, str)]

    def gone_now(disk):
        return attempt(DISKUTIL, 'info', '-plist', disk)['returncode'] not in (0, None)

    try:
        for point in points:
            # An unknown mount state is unmounted too: unmounting nothing only fails.
            if recorded(lambda: mounted(point)) is not False:
                rows.append(evidence(attempt(DISKUTIL, 'unmount', str(point))))
        listed = recorded(bound)
        for disk in dict.fromkeys(listed or ()):
            for tries in range(wrapper.EJECT_ATTEMPTS):
                if tries:
                    time.sleep(wrapper.EJECT_PAUSE)
                    # A timed-out eject may have applied and freed the number for another image.
                    if disk not in (recorded(bound) or ()):
                        break
                rows.append(evidence(attempt(DISKUTIL, 'eject', disk)))
                if rows[-1]['returncode'] == 0:
                    break
        remaining = recorded(lambda: len(attachments(image)))
        gone = [recorded(lambda: gone_now(disk)) for disk in dict.fromkeys(disks)]
        still = recorded(lambda: [str(point) for point in points if mounted(point)])
    except BaseException as interrupt:
        rows.append({'interrupted': repr(interrupt)[:300]})
        return {'steps': rows, 'errors': errors, 'listed': listed, 'clean': False}, interrupt
    return {'steps': rows, 'errors': errors, 'listed': listed, 'remaining': remaining, 'mounted': still,
            'disks_gone': gone, 'clean': not errors and remaining == 0 and all(gone) and still == []}, None


def settled(record, late, what, disks):
    """After a phase's own release: an interrupt that stopped it is raised, else it must be clean."""
    if late is not None:
        raise late
    require(record['clean'], what + ' did not release the probe image')
    # Confirmed gone: a later phase must never eject that number again for another image.
    disks.clear()


def write_phase(image, temp, report, disks):
    attached = attach(image, disks)
    point = temp / 'write'
    report['write'] = {'attach': attached}
    try:
        mount_at(point, attached['volume'])
        report['write']['before_enable'] = {'info': info_of(attached['volume']),
                                            'statfs_flags': flag_names(wrapper.statfs(point)['flags'])}
        checked(attempt(SUDO, '-n', DISKUTIL, 'enableOwnership', str(point)), 'enableOwnership')
        info = point.lstat()
        report['write']['fixture_root_before_chown'] = {
            'uid': info.st_uid, 'gid': info.st_gid, 'mode': oct(info.st_mode & 0o7777)}
        checked(attempt(SUDO, '-n', '/usr/sbin/chown', '%s:%s' % (os.getuid(), os.getgid()), str(point)),
                'chown fixture volume root')
        user, root = point / 'user.txt', point / 'root.txt'
        user.write_bytes(b'owned user file\n')
        root.write_bytes(b'decisive root-owned file\n')
        os.chmod(user, 0o600)
        os.chmod(root, 0o600)
        checked(attempt(SUDO, '-n', '/usr/sbin/chown', '0:0', str(root)), 'chown root')
        checked(attempt(SUDO, '-n', '/usr/sbin/chown', '0:0', str(point)), 'restore fixture root owner')
        volume_root = point.lstat()
        report['write']['after_enable'] = {
            'volume_root': {'uid': volume_root.st_uid, 'gid': volume_root.st_gid,
                            'mode': oct(volume_root.st_mode & 0o7777)},
            'info': info_of(attached['volume']),
            'statfs_flags': flag_names(wrapper.statfs(point)['flags']),
            'files': {path.name: {'uid': path.lstat().st_uid, 'gid': path.lstat().st_gid,
                                  'mode': oct(path.lstat().st_mode & 0o7777)} for path in (user, root)}}
    finally:
        report['write']['release'], late = release(image, [point], disks)
    settled(report['write']['release'], late, 'write phase', disks)
    point.rmdir()


def disable_ownership(image, temp, report, disks):
    attached = attach(image, disks)
    point = temp / 'disable'
    try:
        mount_at(point, attached['volume'])
        checked(attempt(SUDO, '-n', DISKUTIL, 'disableOwnership', str(point)), 'disableOwnership')
        report['disable'] = {'info': info_of(attached['volume'])}
    finally:
        report.setdefault('disable', {})['release'], late = release(image, [point], disks)
    settled(report['disable']['release'], late, 'disable phase', disks)
    point.rmdir()


def read_only_variant(image, temp, name, options, disks, row):
    row.update({'image_before': image_state(image), 'stage': 'attach'})
    attached = attach(image, disks, '--readOnly')
    row['attach'] = attached
    point = temp / name
    try:
        row['stage'] = 'mount'
        flags = ['-mountOptions', options] if options else []
        row['mount'] = evidence(mount_at(point, attached['volume'], 'readOnly', *flags))
        row['stage'] = 'observations'
        row['info'] = info_of(attached['volume'])
        volume_root = point.lstat()
        row['volume_root'] = {'uid': volume_root.st_uid, 'gid': volume_root.st_gid,
                              'mode': oct(volume_root.st_mode & 0o7777)}
        found = wrapper.statfs(point)
        row['statfs'] = {**found, 'flag_names': flag_names(found['flags'])}
        row['files'] = {}
        for file in ('user.txt', 'root.txt'):
            info = (point / file).lstat()
            try:
                (point / file).read_bytes()
                readable = True
            except PermissionError:
                readable = False
            row['files'][file] = {'uid': info.st_uid, 'gid': info.st_gid,
                                  'mode': oct(info.st_mode & 0o7777), 'readable_by_runner': readable}
        try:
            wrapper.verify_mount(point, attached['volume'], attached['info']['VolumeUUID'])
            row['verify_mount'] = 'accepted'
        except Exception as error:
            row['verify_mount'] = 'refused: ' + str(error)
    finally:
        row['release'], late = release(image, [point], disks)
    settled(row['release'], late, name, disks)
    point.rmdir()
    row['image_after'] = image_state(image)
    row['stage'] = 'completed'
    return row


def run(output):
    temp = pathlib.Path(tempfile.mkdtemp(prefix='openclaw-asif-ownership-',
                                         dir=os.environ.get('RUNNER_TEMP'))).resolve()
    image = temp / 'probe.asif'
    points = [temp / name for name in ('write', 'disable', *(variant for variant, _, _ in VARIANTS))]
    disks = []
    report = {'scope': SCOPE, 'started_utc': datetime.datetime.now(datetime.timezone.utc).isoformat(),
              'runner_uid': os.getuid(), 'mount_options': MOUNT_OPTIONS,
              'os': attempt('/usr/bin/sw_vers')['stdout'].decode(errors='replace'),
              'variants': {}, 'completed': False}
    interrupt = None
    try:
        checked(attempt(DISKUTIL, 'image', 'create', 'blank', '--format', 'ASIF', '--size', '64m',
                        '--fs', 'APFS', '--volumeName', 'Data', str(image)), 'create')
        os.chmod(image, 0o600)
        report['created'] = image_state(image)
        write_phase(image, temp, report, disks)
        for name, options, disabled in VARIANTS:
            if disabled and 'disable' not in report:
                disable_ownership(image, temp, report, disks)
            row = report['variants'][name] = {}
            read_only_variant(image, temp, name, options, disks, row)
        report['completed'] = True
    except Exception as error:
        report['error'] = repr(error)[:500]
    except BaseException as error:
        # Recorded, then raised again once the image is released and the report is written.
        report['error'] = repr(error)[:500]
        interrupt = error
        raise
    finally:
        report['cleanup'], late = release(image, points, disks)
        if report['cleanup']['clean']:
            try:
                shutil.rmtree(temp)
            except OSError as error:
                report['cleanup']['rmtree_error'] = repr(error)[:300]
        report['cleanup']['removed'] = not os.path.lexists(temp)
        # Plist values reach the report as-is; anything JSON cannot hold is kept as its repr.
        write_record(output, json.loads(json.dumps(report, default=repr)))
        # An interrupt that stopped this cleanup is raised; a phase's earlier one takes precedence.
        if late is not None and interrupt is None:
            raise late
    return 0 if report['completed'] and report['cleanup']['clean'] and report['cleanup']['removed'] else 1


def seed_reader_fixture(capture, seed, volume_uuid):
    from test_stopped_journal_inputs import StoppedImage

    class NativeVolumeFixture(StoppedImage):
        def manifest(self, head=None, **changes):
            return super().manifest(head, **{**changes, 'data_volume_uuid': volume_uuid})

        def host_manifest(self, head=None, **changes):
            spec = json.loads(self.spec.read_bytes())
            self.spec.unlink()
            write_record(self.spec, {**spec, 'data_volume_uuid': volume_uuid})
            return super().host_manifest(head, **changes)

    fixture = NativeVolumeFixture('runTest')
    previous = os.umask(0o077)
    try:
        fixture.setUp()
        shutil.copytree(fixture.data, seed)
        shutil.copytree(fixture.capture, capture, dirs_exist_ok=True)
        return {'table': fixture.table, 'checkpoint_sha256': fixture.record['sha256'],
                'pre_head': fixture.commitment['manifest']['journal_head'],
                'data_volume_uuid': volume_uuid}
    finally:
        fixture.doCleanups()
        os.umask(previous)


def change_reader_seed(root, case):
    from preservation_journal import encoded
    from test_stopped_journal_inputs import config_file, preservation, window_dir

    if case == 'corrupt-chain':
        path = window_dir(root) / '000000.json'
        path.write_bytes(encoded({**json.loads(path.read_bytes()), 'at': 'owned-corruption'}))
    elif case == 'pending':
        path = window_dir(root) / '.pending-owned'
        path.write_bytes(b'owned interrupted write')
        path.chmod(0o600)
    elif case == 'unknown':
        path = preservation(root) / 'unknown-owned'
        path.write_bytes(b'owned unexpected entry')
        path.chmod(0o600)
    elif case == 'changed-config':
        path = config_file(root, 'nats')
        path.write_bytes(path.read_bytes() + b'\n# owned changed config bytes\n')
    else:
        require(case == 'intact', 'unknown reader probe case')


def reader_write_phase(image, temp, seed, capture, disks, case, row):
    attached = attach(image, disks)
    point = temp / 'reader-seed'
    row['seed_attach'] = attached
    try:
        mount_at(point, attached['volume'])
        checked(attempt(SUDO, '-n', DISKUTIL, 'enableOwnership', str(point)), 'enableOwnership')
        checked(attempt(SUDO, '-n', '/usr/sbin/chown', '%s:%s' % (os.getuid(), os.getgid()), str(point)),
                'chown fixture volume root')
        if not seed.exists():
            row['fixture'] = seed_reader_fixture(capture, seed, attached['info']['VolumeUUID'])
        if (point / 'Users').exists():
            shutil.rmtree(point / 'Users')
        shutil.copytree(seed / 'Users', point / 'Users')
        change_reader_seed(point, case)
        checked(attempt(SUDO, '-n', '/usr/sbin/chown', '0:0', str(point)), 'restore fixture root owner')
        info = point.lstat()
        row['seed_root'] = {'uid': info.st_uid, 'gid': info.st_gid, 'mode': oct(info.st_mode & 0o7777)}
        require(row['seed_root'] == {'uid': 0, 'gid': 0, 'mode': '0o755'},
                'seed volume root is not root-owned 0755')
    finally:
        row['seed_release'], late = release(image, [point], disks)
    settled(row['seed_release'], late, 'reader seed', disks)
    point.rmdir()


def reader_case(capture, output, table, expected, row):
    from preservation_checks import Refused

    try:
        receipt = wrapper.read_journal_inputs(capture, output, table=table, fixture=True)
    except Exception as error:
        row['refusal'] = {'type': type(error).__name__, 'message': str(error)}
        if expected is None:
            raise
        require(isinstance(error, Refused) and re.search(expected, str(error)),
                'reader refused for another reason: ' + str(error))
        row['failure'] = json.loads((output / 'FAILED.json').read_bytes())
        require(row['failure']['stage'] == 'read' and not (output / 'JOURNAL_INPUTS.json').exists(),
                'reader negative did not fail at read without a receipt')
        cleanup = row['failure']['cleanup']
    else:
        row['receipt'] = receipt
        require(expected is None, 'reader accepted the damaged fixture')
        require(json.loads((output / 'JOURNAL_INPUTS.json').read_bytes()) == receipt
                and not (output / 'FAILED.json').exists(), 'reader receipt publication differs')
        cleanup = receipt['cleanup']
    gone = [step['result'] for step in cleanup['steps'] if step['step'] == 'attach result disk after eject']
    require(cleanup['clean'] and gone and all(value['returncode'] not in (0, None) for value in gone),
            'reader did not confirm its attached disk gone')


def reader_run(output):
    from host_guest_commit import require_captured, require_committed
    from host_vm_capture import CAPTURE_SCOPE, FIXTURE_UUID, publish_pinned_capture

    temp = pathlib.Path(tempfile.mkdtemp(prefix='openclaw-capture-owned-reader-',
                                         dir=os.environ.get('RUNNER_TEMP'))).resolve()
    capture, seed = temp / 'capture', temp / 'seed'
    capture.mkdir(mode=0o700)
    image = capture / wrapper.CLONE
    points = [temp / 'reader-seed', *(capture / ('journal-read-' + name.replace('-', '')) / 'mount' for name, _ in READER_CASES)]
    disks = []
    report = {'scope': 'CI-only synthetic frozen-journal reader on an owned ASIF; no VM or production volume',
              'started_utc': datetime.datetime.now(datetime.timezone.utc).isoformat(),
              'runner_uid': os.getuid(), 'os': attempt('/usr/bin/sw_vers')['stdout'].decode(errors='replace'),
              'cases': {}, 'completed': False}
    interrupt = None
    try:
        checked(attempt(DISKUTIL, 'image', 'create', 'blank', '--format', 'ASIF', '--size', '64m',
                        '--fs', 'APFS', '--volumeName', 'Data', str(image)), 'create')
        image.chmod(0o600)
        for name, expected in READER_CASES:
            row = report['cases'][name] = {'expected_refusal': expected}
            reader_write_phase(image, temp, seed, capture, disks, name, row)
            if name == 'intact':
                report['fixture'] = row.pop('fixture')
            before = row['image_before'] = image_state(image)
            publish_pinned_capture(capture, {
                'scope': CAPTURE_SCOPE, 'vm_state_at_final_check': 'stopped', 'vm_uuid': FIXTURE_UUID,
                'clone_image_sha256': before['sha256'], 'clone_size': before['size'],
                'data_volume_uuid': report['fixture']['data_volume_uuid']},
                require_committed(capture)['checkpoint'])
            pins = require_captured(capture)
            with mock.patch('preservation_journal.NATS_ROOT_UID', os.getuid()):
                reader_case(capture, capture / ('journal-read-' + name.replace('-', '')),
                            report['fixture']['table'], expected, row)
            row['image_after'] = image_state(image)
            require(row['image_after'] == before, 'reader changed image bytes or identity')
            require(require_captured(capture) == pins, 'reader changed host commitment pins')
            if expected is None:
                require(all(row['receipt']['reader'][key] == report['fixture'][key]
                            for key in ('checkpoint_sha256', 'pre_head')), 'reader verified another fixture')
            row['completed'] = True
        report['completed'] = True
    except Exception as error:
        report['error'] = repr(error)[:500]
    except BaseException as error:
        report['error'] = repr(error)[:500]
        interrupt = error
        raise
    finally:
        report['cleanup'], late = release(image, points, disks)
        if report['completed'] and report['cleanup']['clean']:
            try:
                shutil.rmtree(temp)
            except OSError as error:
                report['cleanup']['rmtree_error'] = repr(error)[:300]
        report['cleanup']['removed'] = not os.path.lexists(temp)
        if not report['cleanup']['removed']:
            report['cleanup']['retained_directory'] = str(temp)
        write_record(output, json.loads(json.dumps(report, default=repr)))
        if late is not None and interrupt is None:
            raise late
    return 0 if report['completed'] and report['cleanup']['clean'] and report['cleanup']['removed'] else 1


def main(argv, environ):
    output = guard(argv, environ)
    return (reader_run if argv[0] == '--ci-owned-reader' else run)(output)


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:], os.environ))
