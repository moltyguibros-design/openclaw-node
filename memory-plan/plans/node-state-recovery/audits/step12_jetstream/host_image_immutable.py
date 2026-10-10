"""Pinned image flag operation; this does not establish a VM hold or authorize boot."""

import ctypes
import os
import pathlib
import stat

from host_vm_preflight import require


def change_immutable(path, identity, present):
    path = pathlib.Path(path)
    require(path.is_absolute() and path.resolve() == path,
            'image path is redirected')
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC)
    try:
        before = os.fstat(fd)
        require(stat.S_ISREG(before.st_mode) and before.st_uid == os.getuid()
                and before.st_nlink == 1
                and (before.st_dev, before.st_ino, before.st_size) == identity,
                'image file identity differs')
        named = path.lstat()
        require((named.st_dev, named.st_ino) == (before.st_dev, before.st_ino),
                'image path changed before flag operation')
        requested = (before.st_flags | stat.UF_IMMUTABLE) if present else (
            before.st_flags & ~stat.UF_IMMUTABLE)
        if requested != before.st_flags:
            library = ctypes.CDLL(None, use_errno=True)
            function = library.fchflags
            function.argtypes = [ctypes.c_int, ctypes.c_uint]
            function.restype = ctypes.c_int
            if function(fd, requested) != 0:
                code = ctypes.get_errno()
                raise OSError(code, os.strerror(code), str(path))
            os.fsync(fd)
        after = os.fstat(fd)
        named = path.lstat()
        require((after.st_dev, after.st_ino, after.st_size) == identity
                and (named.st_dev, named.st_ino) == (after.st_dev, after.st_ino)
                and bool(after.st_flags & stat.UF_IMMUTABLE) == present
                and bool(named.st_flags & stat.UF_IMMUTABLE) == present,
                'image identity or immutable flag changed during operation')
        return {'device': after.st_dev, 'inode': after.st_ino, 'size': after.st_size,
                'immutable': present}
    finally:
        os.close(fd)
