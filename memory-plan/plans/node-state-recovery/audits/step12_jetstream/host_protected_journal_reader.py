"""Owned protected semantic receipts; caller-asserted uids, no B3/B8 or installed authority."""
import ctypes
import datetime
import fcntl
import os
import pathlib
import stat
import sys


SCOPE = ('CI-owned protected frozen-journal semantic receipt; caller-asserted owner contexts; '
         'no B3/B8 acceptance, boot decision or installed authority')


def xattrs(fd):
    if sys.platform != 'darwin':
        return tuple(sorted(os.listxattr(fd)))
    function = ctypes.CDLL(None, use_errno=True).flistxattr
    function.argtypes = [ctypes.c_int, ctypes.c_void_p, ctypes.c_size_t, ctypes.c_int]
    function.restype = ctypes.c_ssize_t
    size = function(fd, None, 0, 0)
    if size < 0:
        error = ctypes.get_errno()
        raise OSError(error, os.strerror(error))
    if size > 4096:
        raise RuntimeError('image xattr names exceed bound')
    if not size:
        return ()
    buffer = ctypes.create_string_buffer(size)
    if function(fd, buffer, size, 0) != size:
        raise RuntimeError('image xattr names changed while read')
    raw = buffer.raw
    if not raw.endswith(b'\0'):
        raise RuntimeError('image xattr names are malformed')
    return tuple(sorted(os.fsdecode(name) for name in raw[:-1].split(b'\0')))


def source_shape(a, item):
    item.check()
    a.require(getattr(os.fstat(item.fd), 'st_flags', 0) == 0 and xattrs(item.fd) == (),
              'source image flags or xattrs differ')


def clone_fd(source, directory, name):
    if sys.platform != 'darwin':
        raise RuntimeError('protected image cloning requires macOS')
    function = ctypes.CDLL(None, use_errno=True).fclonefileat
    function.argtypes = [ctypes.c_int, ctypes.c_int, ctypes.c_char_p, ctypes.c_uint32]
    function.restype = ctypes.c_int
    if function(source, directory, os.fsencode(name), 2) != 0:
        error = ctypes.get_errno()
        raise OSError(error, os.strerror(error), name)


def copy_shape(a, info, device, size, attributes):
    a.require(stat.S_ISREG(info.st_mode) and info.st_uid == 0 and info.st_nlink == 1
              and stat.S_IMODE(info.st_mode) == 0o600 and info.st_dev == device
              and info.st_size == size and getattr(info, 'st_flags', 0) == 0 and attributes == (),
              'protected image copy shape differs')


def checked_copy(a, item, work, expected):
    item.check()
    info = os.fstat(item.fd)
    attributes = xattrs(item.fd)
    copy_shape(a, info, os.fstat(work.fd).st_dev, expected['size'], attributes)
    os.lseek(item.fd, 0, os.SEEK_SET)
    _raw, digest, size = item.read(False)
    a.require(digest == expected['sha256'] and size == expected['size'],
              'protected image copy hash differs')
    return {'sha256': digest, 'size': size, 'uid': info.st_uid, 'mode': stat.S_IMODE(info.st_mode),
            'device': info.st_dev, 'inode': info.st_ino, 'nlink': info.st_nlink, 'flags': getattr(info, 'st_flags', 0),
            'xattrs': list(attributes), 'method': 'fclonefileat/CLONE_NOOWNERCOPY'}


def names(nonce):
    return nonce + '.read-pending', nonce + '.read.json', nonce + '.read-staged'


def context(capture_uid, guest_uid, writer_uid):
    return {'capture_uid': capture_uid, 'guest_uid': guest_uid, 'writer_uid': writer_uid}


def write_file(a, directory, name, value):
    raw = a.encoded(value)
    a.require(len(raw) <= a.LIMIT, 'protected reader record exceeds bound')
    fd = os.open(name, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600, dir_fd=directory.fd)
    with os.fdopen(fd, 'wb') as handle:
        os.fchmod(handle.fileno(), 0o600)
        handle.write(raw)
        handle.flush()
        os.fsync(handle.fileno())
    os.fsync(directory.fd)


def protected_anchor(a, directory, nonce):
    a.require(nonce + '.pending' not in os.listdir(directory.fd), 'anchor publication is incomplete')
    return a.Input(directory, nonce + '.json', 0)


def read_receipt(a, root, capture, capture_uid, nonce, guest_uid, writer_uid, authority, code):
    pending, final, staged = names(nonce)
    with a.Directory(root, {0}) as directory:
        fcntl.flock(directory.fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        a.require(not any(name in os.listdir(directory.fd) for name in (pending, staged)),
                  'protected reader publication is incomplete')
        with protected_anchor(a, directory, nonce) as record, a.Input(directory, final, 0) as receipt:
            raw = record.read(True)[0]
            anchored = a.canonical(raw)
            value = a.canonical(receipt.read(True)[0])
            a.require(value.get('scope') == SCOPE and value.get('capture_nonce') == nonce
                      and value.get('owner_context') == context(capture_uid, guest_uid, writer_uid)
                      and value.get('anchor_sha256') == a.sha(raw) and value.get('files') == anchored['files']
                      and anchored.get('authority') == authority
                      and value.get('authority') == authority and value.get('code_sha256') == code['hashes']
                      and value.get('cleanup', {}).get('clean') is True and value.get('copy_removed') is True,
                      'protected reader receipt binding differs')
            record.check()
            receipt.check()
            a.require(code['check']() == code['authority'], 'reader runtime changed')
            directory.check()
            return value


def mounted_read(a, m, stopped, commit, files, copy, mount, guest_uid, writer_uid, code):
    attempted, known = False, []
    try:
        commitment = commit.commitment_from(files)
        capture = m.capture_record(files['CAPTURE.json'], commitment)
        a.require(not m.attachments(copy), 'protected copy is already attached')
        a.require(code['check']() == code['authority'], 'reader runtime changed')
        attempted = True
        attached = m.attempt(m.DISKUTIL, 'image', 'attach', '--plist', '--readOnly', '--noMount', str(copy))
        known = m.attached_disk(attached)
        entities = m.plist_of(attached, 'read-only attach').get('system-entities') or [{}]
        a.require(len(known) == 1, 'attach result names no valid whole disk')
        rows = m.attachments(copy)
        a.require(len(rows) == 1 and rows[0].get('writeable') is False,
                  'protected copy is not attached exactly once read-only')
        disk = rows[0].get('system-entities', [{}])[0].get('dev-entry')
        a.require(isinstance(disk, str) and m.DISK.fullmatch(disk) and known[0] == disk,
                  'attached protected copy disk differs')
        volume = m.data_volume(entities, capture['data_volume_uuid'])
        mount.mkdir(mode=0o700)
        done = m.attempt(m.DISKUTIL, 'mount', 'readOnly', '-mountOptions', m.MOUNT_OPTIONS,
                         '-mountPoint', str(mount), volume)
        a.require(done['returncode'] == 0 and not done['timed_out'], 'read-only mount failed or timed out')
        verified = m.verify_mount(mount, volume, capture['data_volume_uuid'])
        device = os.stat(mount).st_dev
        summary = stopped.verify_stopped_bytes(files, mount, owner=guest_uid, writer_uid=writer_uid)
        a.require(summary['read'] and all(row['device'] == device for row in summary['read']),
                  'protected reader read outside the verified mount')
        a.require(summary['checkpoint_sha256'] == commitment['checkpoint']['checkpoint_sha256']
                  and summary['pre_head'] == commitment['manifest']['journal_head'],
                  'protected reader verified another commitment')
        a.require(m.verify_mount(mount, volume, capture['data_volume_uuid']) == verified
                  and os.stat(mount).st_dev == device, 'protected reader mount changed')
    except BaseException as error:
        cleanup, _interrupt = m.release(copy, mount, attempted, known)
        error.protected_reader_cleanup = cleanup
        raise
    cleanup, interrupt = m.release(copy, mount, attempted, known)
    if interrupt is not None:
        interrupt.protected_reader_cleanup = cleanup
        raise interrupt
    if not cleanup['clean']:
        error = RuntimeError('protected reader cleanup did not complete')
        error.protected_reader_cleanup = cleanup
        raise error
    return {'reader': summary, 'mount': {'point': str(mount), 'device': device, 'volume': volume,
                                        'data_volume_uuid': capture['data_volume_uuid'], **verified},
            'attach': {'disk': disk, 'command': m.evidence(attached)}, 'cleanup': cleanup}


def read_image(a, root, capture, capture_uid, nonce, guest_uid, writer_uid, authority, code):
    modules = code['modules']
    m, stopped, commit = (modules[name] for name in ('host_journal_mount', 'stopped_journal_inputs',
                                                    'host_guest_commit'))
    pending, final, staged = names(nonce)
    with a.Directory(root, {0}) as directory:
        fcntl.flock(directory.fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        a.require(nonce + '.pending' not in os.listdir(directory.fd), 'anchor publication is incomplete')
        a.require(not any(name in os.listdir(directory.fd) for name in (pending, final, staged)),
                  'protected reader already exists or publication is incomplete')
        with protected_anchor(a, directory, nonce) as record, a.held_snapshot(capture, capture_uid, nonce) as held:
            raw = record.read(True)[0]
            anchored = a.canonical(raw)
            check_anchor(a, anchored, held, authority)
            files, source = held['files'], held['clone']
            commit.captured_from(files)
            m.capture_record(files['CAPTURE.json'], commit.commitment_from(files))
            source_shape(a, source)
            a.require(not m.attachments(pathlib.Path(capture) / a.CLONE), 'source clone is already attached')
            a.require(os.fstat(source.fd).st_dev == os.fstat(directory.fd).st_dev
                      and m.statfs(root)['fstypename'] == 'apfs', 'protected copy requires same-volume APFS')
            os.mkdir(pending, mode=0o700, dir_fd=directory.fd)
            os.fsync(directory.fd)
            work_path = pathlib.Path(root) / pending
            published, staging = False, False
            result = None
            try:
                with a.Directory(work_path, {0}) as work:
                    copy = work_path / a.CLONE
                    clone_fd(source.fd, work.fd, a.CLONE)
                    with a.Input(work, a.CLONE, 0) as item:
                        before = checked_copy(a, item, work, anchored['files'][a.CLONE])
                        result = mounted_read(a, m, stopped, commit, files, copy, work_path / 'mount',
                                              guest_uid, writer_uid, code)
                        after = checked_copy(a, item, work, anchored['files'][a.CLONE])
                        a.require(after == before, 'protected image changed during native read')
                    os.unlink(a.CLONE, dir_fd=work.fd)
                    os.fsync(work.fd)
                    source_shape(a, source)
                    check_anchor(a, anchored, held, authority)
                    record.check()
                    a.require(code['check']() == code['authority'], 'reader runtime changed')
                    value = {'scope': SCOPE, 'at_utc': datetime.datetime.now(datetime.timezone.utc).isoformat(),
                             'capture_nonce': nonce, 'owner_context': context(capture_uid, guest_uid, writer_uid),
                             'anchor_sha256': a.sha(raw), 'files': anchored['files'], 'authority': authority,
                             'code_sha256': code['hashes'], 'copy': before, 'copy_removed': True, **result}
                    staging = True
                    write_file(a, directory, staged, value)
                    directory.check()
                    os.link(staged, final, src_dir_fd=directory.fd, dst_dir_fd=directory.fd, follow_symlinks=False)
                    published = True
                    os.fsync(directory.fd)
                    os.unlink(staged, dir_fd=directory.fd)
                    staging = False
                    os.fsync(directory.fd)
                    with a.Input(directory, final, 0) as receipt:
                        a.require(a.canonical(receipt.read(True)[0]) == value, 'protected reader read-back differs')
                    check_anchor(a, anchored, held, authority)
                    record.check()
                    a.require(code['check']() == code['authority'], 'reader runtime changed')
                    work.check()
                os.rmdir(pending, dir_fd=directory.fd)
                os.fsync(directory.fd)
                directory.check()
                return value
            except BaseException as error:
                try:
                    if not os.path.lexists(work_path):
                        os.mkdir(pending, mode=0o700, dir_fd=directory.fd)
                    os.fsync(directory.fd)
                except BaseException:
                    pass
                for name in ([final] if published else []) + ([staged] if staging else []):
                    try:
                        os.unlink(name, dir_fd=directory.fd)
                    except OSError:
                        pass
                try:
                    with a.Directory(work_path, {0}) as work:
                        write_file(a, work, 'FAILED.json', {'error': repr(error)[:500],
                                   'cleanup': getattr(error, 'protected_reader_cleanup', None)
                                              or (result['cleanup'] if result else {'attempted': False})})
                except BaseException:
                    pass
                raise


def check_anchor(a, anchored, held, authority):
    held['check']()
    a.require(anchored == {**held['value'], 'authority': authority}, 'protected capture byte anchor differs')
