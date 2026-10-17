#!/usr/bin/env python3
"""Pure reader of the user journal and the four NATS configs inside a stopped guest Data volume (B5).

`root` is the Data volume root, given as a literal absolute path: an owned fixture today, later a
read-only mount of the stopped image (no mount wrapper here; its ownership and mount options are
tracked separately). A guest path P is read at root/P[1:], which holds only below /Users, the
firmlink into the Data volume; the home form allows nothing else. The tree must not change while
it is read: each path component and file is checked before use, which is no lock.

Journal files, locks and directories must carry the owner, single link and 0600/0700 modes
Journal gives them; lock files are present and empty, as Journal's O_CREAT open leaves them.
Config modes are recorded, not constrained; their owner and single link are. Every directory
listing, every file, the number of files and the bytes read in all are bounded: parsed JSON can
take about 22 times its raw bytes in the measured crafted records. The 16 MiB raw limit reduces
that measured amplification; it is not a hard Python heap bound. Nothing is created, locked or written, and
preservation_journal.Journal is never constructed: its constructor creates and locks
~/.openclaw/preservation of whatever host runs it, and its recovery path writes.

The policy is fail-closed: anything not named here refuses, even where the guest Journal itself
tolerates it, such as a .pending- file (a write that failed before its rename), a
.corrupt-receipt- file (a corrupt receipt set aside), an unknown entry or a window outside the
lineage. Journal never deletes those leftovers, so one blocks every later capture until the
operator resolves it. The only other preservation entries allowed are the three legacy-agent
retirement records of 2026-10-02 (LEGACY_AGENT_RETIREMENT_RUNBOOK.md): checked as owner-private
single-link files and counted against the bounds, never interpreted.

Every path is fixed by the one home all four committed store paths already name. The journal
window is the unique direct child of the fixed journal parent whose last record carries the
committed checkpoint digest; every other window must be its finished ancestor through the
baseline predecessor links Journal writes. The node receipt is consistency evidence only, never
the selector. The B3 pin table is the caller's: it is never read from the image or rebuilt from
the checkpoint's identities. Its check is only as strong as its host provenance: a table rebuilt
from the image (the checkpoint's own identities, or the baseline hashes with the image's configs)
verifies, so the caller must pass B3's pre-window pin from a host-held record, a gate that is the
caller's and still open. The NATS binary is the one the journal baseline names for all four
units; no pin binds it beyond that. Selection trusts the pinned commitment, so D189's residuals
stand unchanged: a same-uid pre-stop CHECKPOINT rewrite and recommit, or a coordinated CAPTURE
rewrite, selects whatever window matches the rewritten digest.
"""
import hashlib
import json
import os
import pathlib
import re
import stat

from host_guest_commit import require_captured, require_committed, verify_frozen_checkpoint
from nats_identity import LIMIT, ROLES, config_path, store_path
from preservation_checks import Refused, require
from preservation_journal import TERMINAL, encoded, finder_metadata

# bind_identities' home form, without the '.' and '..' names it would also admit.
HOME = re.compile(r'/Users/(?!\.\.?$)[A-Za-z0-9._-]+')
WINDOW = re.compile(r'[A-Za-z0-9][A-Za-z0-9._-]*')
RECORD = re.compile(r'\d{6}\.json')
PRESERVATION = '/.openclaw/preservation'
PRESERVATION_ENTRIES = frozenset(('journals', 'node.lock', 'node.lock.state.json'))
RECEIPT_KEYS = frozenset(('journal_root', 'baseline', 'status', 'phase', 'holder'))
# The node's read-only preservation census found exactly these beside the Journal entries.
EVIDENCE = frozenset(('legacy-agent-retirement-evidence-20261002.json',
                      'legacy-agent-retirement-post-20261002.json',
                      'legacy-agent-retirement-pre-20261002.json'))
# Entries per directory, files and bytes read in all. A full-node window is about a hundred
# records of at most tens of KiB, so each leaves wide headroom.
MAX_ENTRIES = 1024
MAX_FILES = 4096
MAX_TOTAL = 16 << 20


def committed_home(manifest):
    """The one home all four committed store paths name, in the fixed per-unit form."""
    paths = manifest.get('store_paths') if isinstance(manifest, dict) else None
    standalone = paths.get('standalone') if isinstance(paths, dict) else None
    suffix = store_path('', 'nats')
    home = standalone[:-len(suffix)] if isinstance(standalone, str) and standalone.endswith(suffix) else ''
    require(HOME.fullmatch(home)
            and paths == {role: store_path(home, unit) for unit, role in ROLES.items()}
            and manifest.get('store_relative_paths') == {role: path[1:] for role, path in paths.items()},
            'committed manifest store paths are not one fixed home')
    return home


def directory(root, path):
    """Walk an absolute guest path below the Data root; every component a real directory."""
    cursor = root
    for part in path[1:].split('/'):
        cursor = cursor / part
        require(stat.S_ISDIR(cursor.lstat().st_mode), 'stopped image path is not a real directory: ' + part)
    return cursor


def owned(info, mode):
    return info.st_uid == os.getuid() and (mode is None or stat.S_IMODE(info.st_mode) == mode)


def private_dir(path):
    info = path.lstat()
    require(stat.S_ISDIR(info.st_mode) and owned(info, 0o700),
            'journal directory is not owner-private: ' + path.name)


def names(path):
    """At most MAX_ENTRIES directory entries, Finder metadata aside (finder_metadata refuses a foreign one)."""
    found = []
    with os.scandir(path) as entries:
        for entry in entries:
            if not finder_metadata(path / entry.name):
                found.append(entry.name)
                require(len(found) <= MAX_ENTRIES, 'stopped image directory holds too many entries: ' + path.name)
    return sorted(found)


def content(path, mode, budget):
    """Exact bytes and lstat of one owned, single-link regular file of at most LIMIT bytes.

    The entry is checked before it is opened, so a link, FIFO or device node in the guest image is
    never opened; the opened file must then be that same inode. `budget` holds the files and bytes
    the whole read may still take, a file beyond the file bound is not even inspected, and the
    metadata of every file actually read is appended to its `read` list.
    """
    budget['files'] -= 1
    require(budget['files'] >= 0, 'stopped image reads exceed their file bound at: ' + path.name)
    info = path.lstat()
    require(stat.S_ISREG(info.st_mode) and info.st_nlink == 1 and owned(info, mode),
            'stopped image file is not an owned single-link regular file: ' + path.name)
    # Race guards only: O_NOFOLLOW and O_NONBLOCK keep a swapped-in link or FIFO from being followed
    # or blocking before the inode check refuses it.
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    try:
        opened = os.fstat(fd)
        require((opened.st_dev, opened.st_ino) == (info.st_dev, info.st_ino),
                'stopped image file changed while it was read: ' + path.name)
        with os.fdopen(os.dup(fd), 'rb') as handle:
            raw = handle.read(LIMIT + 1)
    finally:
        os.close(fd)
    require(len(raw) <= LIMIT, 'stopped image file exceeds its size bound: ' + path.name)
    budget['bytes'] -= len(raw)
    require(budget['bytes'] >= 0, 'stopped image reads exceed their total bound at: ' + path.name)
    budget['read'].append({'path': str(path), 'size': len(raw), 'mode': stat.S_IMODE(info.st_mode),
                           'uid': info.st_uid, 'nlink': info.st_nlink, 'device': info.st_dev,
                           'inode': info.st_ino, 'sha256': hashlib.sha256(raw).hexdigest()})
    return raw, info


def lock(path, budget):
    """A Journal lock file: created empty by its O_CREAT open and never written."""
    require(content(path, 0o600, budget)[0] == b'', 'journal lock file is not empty: ' + path.name)


def canonical(raw, what):
    """JSON in Journal's own encoding, so the image holds exactly the bytes the guest wrote.

    Byte equality refuses duplicate keys, and encoded() refuses NaN and the infinities as Journal
    itself does when it writes (allow_nan=False).
    """
    try:
        value = json.loads(raw)
        exact = raw == encoded(value)
    except (TypeError, ValueError, RecursionError) as error:
        raise Refused(what + ' is not canonical journal JSON') from error
    require(exact, what + ' is not canonical journal JSON')
    return value


def read_window(path, budget):
    """One window's records as Journal wrote them: locked, named in sequence, canonical, hash-chained."""
    private_dir(path)
    entries = names(path)
    # Journal writes a record through a .pending- file and its rename; anything else is foreign.
    require(all(name == '.lock' or RECORD.fullmatch(name) for name in entries),
            'journal window holds an unknown or pending entry: ' + path.name)
    lock(path / '.lock', budget)
    records, previous = [], None
    for index, name in enumerate(name for name in entries if RECORD.fullmatch(name)):
        require(name == '%06d.json' % index, 'journal window sequence has a gap: ' + path.name)
        row = canonical(content(path / name, 0o600, budget)[0], 'journal record')
        try:
            digest = hashlib.sha256(encoded({key: value for key, value in row.items()
                                             if key != 'sha256'})).hexdigest()
        except AttributeError as error:
            raise Refused('journal record is not an object') from error
        require(row.get('sha256') == digest and row.get('sequence') == index
                and row.get('previous') == previous,
                'journal chain differs: ' + path.name)
        records.append(row)
        previous = digest
    require(records, 'journal window is empty: ' + path.name)
    return records


def lineage(windows, window, parent):
    """The committed window, then each finished ancestor its baseline predecessor links name.

    Journal links a new window to the finished head of the one its receipt last named, and refuses
    a new window without a receipt while any window exists, so every other window is an ancestor.
    """
    chain = [window]
    while windows[chain[-1]][0].get('predecessor') is not None:
        link = windows[chain[-1]][0]['predecessor']
        named = [name for name, rows in windows.items()
                 if isinstance(link, dict) and set(link) == {'root', 'head'}
                 and link.get('root') == parent + name
                 and link.get('head') == rows[-1]['sha256']]
        # The membership test only bounds the walk: a cycle would need a hash fixed point.
        require(len(named) == 1 and named[0] not in chain,
                'journal predecessor is not another window head: ' + chain[-1])
        require(windows[named[0]][-1].get('event') in TERMINAL,
                'journal predecessor is unfinished: ' + named[0])
        chain.append(named[0])
    require(set(chain) == set(windows), 'a journal window is outside the committed window lineage')
    return chain


def read_inputs(root, commitment):
    """The committed window's records, lineage, config bytes and modes, baseline binary and home,
    and `read`: the metadata of every file read, its path relative to `root`, in read order.

    `commitment` is the pinned require_committed() result. Reads only below `root`, at paths
    fixed by the committed home, and returns no pin table.
    """
    root = pathlib.Path(root)
    home = committed_home(commitment['manifest'])
    budget = {'files': MAX_FILES, 'bytes': MAX_TOTAL, 'read': []}
    try:
        require(root.resolve(strict=True) == root, 'stopped image root is not a literal absolute path')
        preservation = directory(root, home + PRESERVATION)
        private_dir(preservation)
        # Presence is the reads' own: the lock and receipt below, the journal parent after them.
        entries = set(names(preservation))
        require(entries <= PRESERVATION_ENTRIES | EVIDENCE,
                'preservation directory holds a pending, corrupt-receipt or unknown entry')
        for name in sorted(entries & EVIDENCE):
            content(preservation / name, 0o600, budget)
        lock(preservation / 'node.lock', budget)
        journals = preservation / 'journals'
        private_dir(journals)
        digest = commitment['checkpoint']['checkpoint_sha256']
        windows = {}
        for name in names(journals):
            require(WINDOW.fullmatch(name), 'unexpected entry in the journal parent')
            rows = read_window(journals / name, budget)
            # Only the committed window is kept whole; the lineage needs each other's ends.
            windows[name] = rows if rows[-1]['sha256'] == digest else [rows[0], rows[-1]]
        chosen = [name for name, rows in windows.items() if rows[-1]['sha256'] == digest]
        require(len(chosen) == 1, 'no unique journal window ends in the committed checkpoint digest')
        window = chosen[0]
        records = windows[window]
        ancestry = lineage(windows, window, home + PRESERVATION + '/journals/')
        receipt = canonical(content(preservation / 'node.lock.state.json', 0o600, budget)[0], 'node receipt')
        require(isinstance(receipt, dict) and set(receipt) == RECEIPT_KEYS
                and receipt.get('journal_root') == home + PRESERVATION + '/journals/' + window
                and receipt.get('status') == 'unresolved'
                and receipt.get('phase') == 'initialized'
                and receipt.get('baseline') == records[0],
                'node receipt does not name the committed window as its unresolved recovery')
        configs, modes = {}, {}
        for unit in ROLES:
            path = config_path(home, unit)
            configs[path], info = content(directory(root, path.rsplit('/', 1)[0]) / (unit + '.conf'), None, budget)
            modes[path] = stat.S_IMODE(info.st_mode)
    except OSError as error:
        raise Refused('stopped image journal or config is absent or unreadable') from error
    try:
        binaries = {records[0]['prior'][unit]['identity']['argv'][0] for unit in ROLES}
    except (KeyError, TypeError, IndexError) as error:
        raise Refused('journal baseline lacks the NATS argv') from error
    require(len(binaries) == 1, 'NATS units name different binaries in the journal baseline')
    return {'home': home, 'window': window, 'lineage': ancestry, 'records': records,
            'configs': configs, 'config_modes': modes, 'binary': binaries.pop(),
            'read': [{**row, 'path': str(pathlib.Path(row['path']).relative_to(root))}
                     for row in budget['read']]}


def verify_stopped_journal(capture_dir, root, *, table):
    """verify_frozen_checkpoint() over the stopped image's own journal window and config bytes.

    The CAPTURE.json pins come first (D189): only the pinned commitment's digest selects a window,
    and verify_frozen_checkpoint() then rechecks the pins, the commitment and every record.
    `table` must be B3's pre-window pin from a host-held record; one rebuilt from the image
    verifies, so its provenance is the caller's gate.
    """
    pinned = require_captured(capture_dir)
    commitment = require_committed(capture_dir)
    require(commitment == {**json.loads(pinned['COMMITTED.json']),
                           'checkpoint': json.loads(pinned['CHECKPOINT.json'])},
            'capture commitment differs from the pinned capture record')
    found = read_inputs(root, commitment)
    summary = verify_frozen_checkpoint(capture_dir, found['records'], table=table,
                                       configs=found['configs'], binary=found['binary'],
                                       home=found['home'])
    return {**summary, 'window': found['window'], 'lineage': found['lineage'],
            'config_modes': found['config_modes'], 'read': found['read']}
