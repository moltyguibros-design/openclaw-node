"""Owned tests for the pure stopped-image journal and config reader (B5).

The guest tree is the real Journal's own output under an owned Data-volume-shaped root, at the
guest home's relative path: the full-node window with its capture-ready record, the node receipt
and the locks. The host records are the real commit(), commit_checkpoint() and pinned
publication. Only the receipt's journal_root is relocated, from the owned temporary path the
Journal resolved here to the guest path the guest itself records. Each negative forges one entry
or field in its own copy of that tree. No VM, image, mount, launchd job or NATS server is touched.
"""
import copy
import hashlib
import json
import os
import pathlib
import re
import secrets
import shutil
import stat
import sys
import unittest
from unittest import mock

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

import preservation_journal  # noqa: E402
import stopped_journal_inputs  # noqa: E402
import test_capture_checkpoint as guest  # noqa: E402
import test_host_checkpoint_commit as host  # noqa: E402
import test_nats_identity as identity_fixture  # noqa: E402
from host_guest_commit import require_committed  # noqa: E402
from nats_identity import LIMIT, config_path  # noqa: E402
from preservation_journal import FULL_NODE_SCOPE, Refused, encoded  # noqa: E402
from stopped_journal_inputs import read_inputs, verify_stopped_journal  # noqa: E402

HOME = identity_fixture.HOME
GUEST_JOURNALS = HOME + '/.openclaw/preservation/journals/'


def preservation(root, home=HOME):
    return root / home[1:] / '.openclaw' / 'preservation'


def window_dir(root, name='window-1'):
    return preservation(root) / 'journals' / name


def config_file(root, unit):
    return root / config_path(HOME, unit)[1:]


def rehashed(row, **changes):
    value = {key: item for key, item in {**row, **changes}.items() if key != 'sha256'}
    return {**value, 'sha256': hashlib.sha256(encoded(value)).hexdigest()}


def snapshot(root):
    """Every entry's type, owner, links, times and bytes: a read must leave all of them unchanged."""
    rows = {}
    for path in sorted(root.rglob('*')):
        info = path.lstat()
        rows[str(path.relative_to(root))] = (
            info.st_mode, info.st_uid, info.st_nlink, info.st_mtime_ns, info.st_ctime_ns,
            path.read_bytes() if stat.S_ISREG(info.st_mode) else None)
    return rows


class StoppedImage(host.HostCheckpoint):
    def setUp(self):
        super().setUp()
        self.journal.close()
        # The reader takes only a literal root; macOS temporary directories sit below /var -> /private/var.
        self.data = self.temp.resolve() / 'data'
        self.node_lock = preservation(self.data) / 'node.lock'
        self.root = window_dir(self.data)
        self.journal = guest.Journal(self.root, self.prior, boot='boot-a', node_lock=self.node_lock,
                                     scope=FULL_NODE_SCOPE)
        self.addCleanup(self.journal.close)
        self.hold.journal = self.journal
        for path, raw in self.configs.items():
            (self.data / path[1:]).parent.mkdir(mode=0o700, parents=True, exist_ok=True)
            host.write_private(self.data / path[1:], raw)
        # Guest checkpoint, host commitment while running, pinned publication, then the stop.
        _, _, self.record = self.committed_flow()
        self.host_checkpoint(self.journal_file(self.record))
        self.publish()
        self.journal.close()
        self.records = self.journal.records
        receipt = json.loads((preservation(self.data) / 'node.lock.state.json').read_bytes())
        self.assertEqual(receipt['journal_root'], str(self.root.resolve()))
        self.set_receipt(preservation(self.data), journal_root=GUEST_JOURNALS + self.root.name)
        self.commitment = require_committed(self.capture)

    def set_receipt(self, path, **changes):
        path = path / 'node.lock.state.json'
        preservation_journal.write_private(path, {**json.loads(path.read_bytes()), **changes})

    def image(self):
        """A fresh copy of the stopped Data root for one forgery."""
        path = self.temp.resolve() / ('image-' + secrets.token_hex(4))
        shutil.copytree(self.data, path, symlinks=True)
        return path

    def replace(self, path, raw):
        path.unlink()
        host.write_private(path, raw)

    def window(self, root, name, rows):
        """A sibling window as the guest Journal lays one out: private, one record per file."""
        path = window_dir(root, name)
        path.mkdir(mode=0o700)
        host.write_private(path / '.lock', b'')
        for index, row in enumerate(rows):
            host.write_private(path / ('%06d.json' % index), encoded(row))
        return path

    def finished(self, count=3, event='resolved', predecessor=None):
        """A hash-chained window ending in the terminal record an earlier recovery appends."""
        rows = copy.deepcopy(self.records[:count])
        rows[0]['predecessor'] = predecessor
        return guest.rechain(rows + [{'event': event, 'boot': 'boot-a', 'at': '2026-10-14T16:00:00+00:00'}], 0)

    def link(self, name, rows, **changes):
        """The baseline predecessor field Journal writes for the window it follows."""
        return {'root': GUEST_JOURNALS + name, 'head': rows[-1]['sha256'], **changes}

    def rebased(self, image, **baseline):
        """The committed window re-hashed from a changed baseline, its receipt and digest to match.

        Reader-level only: a real Journal records its predecessor's host-resolved path, which a
        host fixture cannot relocate without re-hashing the window and its execution hold.
        """
        rows = copy.deepcopy(self.records)
        rows[0].update(baseline)
        rows = guest.rechain(rows, 0)
        for index, row in enumerate(rows):
            self.replace(window_dir(image) / ('%06d.json' % index), encoded(row))
        self.set_receipt(preservation(image), baseline=rows[0])
        commitment = copy.deepcopy(self.commitment)
        commitment['checkpoint']['checkpoint_sha256'] = rows[-1]['sha256']
        return commitment

    def read(self, root=None, commitment=None):
        return read_inputs(root or self.data, commitment or self.commitment)

    def rejects(self, pattern, root=None, commitment=None):
        with self.assertRaisesRegex(Refused, pattern):
            self.read(root, commitment)


class Authentic(StoppedImage):
    def test_reader_returns_only_the_committed_window_configs_binary_and_home(self):
        before = snapshot(self.data)
        opened = []
        real_open = os.open

        def spy(path, flags, *args, **kwargs):
            opened.append(flags)
            return real_open(path, flags, *args, **kwargs)

        with mock.patch('os.open', spy), mock.patch.object(
                preservation_journal.Journal, '__init__', side_effect=AssertionError('Journal constructed')):
            found = self.read()
        self.assertEqual(set(found), {'home', 'window', 'lineage', 'records', 'configs', 'config_modes', 'binary'})
        self.assertEqual((found['home'], found['window'], found['lineage']), (HOME, 'window-1', ['window-1']))
        self.assertEqual(found['config_modes'], {path: 0o600 for path in self.configs})
        self.assertEqual(found['records'], self.records)
        self.assertEqual(found['records'][-1]['sha256'], self.commitment['checkpoint']['checkpoint_sha256'])
        self.assertEqual(found['configs'], self.configs)
        self.assertEqual(found['binary'], identity_fixture.BINARY)
        self.assertTrue(opened)
        self.assertFalse([flags for flags in opened if flags & (os.O_WRONLY | os.O_RDWR | os.O_CREAT)])
        self.assertEqual(snapshot(self.data), before)

    def test_frozen_checkpoint_verifies_from_the_stopped_image_and_host_pins_only(self):
        before = snapshot(self.data)
        with mock.patch.object(preservation_journal.Journal, '__init__',
                               side_effect=AssertionError('Journal constructed')):
            summary = verify_stopped_journal(self.capture, self.data, table=self.table)
        self.assertEqual((summary['window'], summary['lineage']), ('window-1', ['window-1']))
        self.assertEqual(summary['config_modes'], {path: 0o600 for path in self.configs})
        self.assertEqual(summary['checkpoint_sha256'], self.record['sha256'])
        self.assertEqual(summary['pre_head'], self.commitment['manifest']['journal_head'])
        self.assertEqual(summary['session'], guest.SESSION)
        self.assertEqual(snapshot(self.data), before)

    def test_finished_ancestor_windows_and_finder_metadata_are_accepted(self):
        image = self.image()
        first = self.finished()
        self.window(image, 'window-a', first)
        second = self.finished(5, 'sealed', predecessor=self.link('window-a', first))
        self.window(image, 'window-b', second)
        commitment = self.rebased(image, predecessor=self.link('window-b', second))
        for path in (preservation(image), preservation(image) / 'journals', window_dir(image)):
            host.write_private(path / '.DS_Store', b'owned finder metadata')
        found = self.read(image, commitment)
        self.assertEqual((found['window'], found['lineage']), ('window-1', ['window-1', 'window-b', 'window-a']))

    def test_the_three_retirement_evidence_records_are_checked_and_ignored(self):
        image = self.image()
        for name in stopped_journal_inputs.EVIDENCE:
            # Never interpreted: these bytes are not even JSON.
            host.write_private(preservation(image) / name, b'owned stand-in, not JSON')
        found = self.read(image)
        self.assertEqual((found['window'], found['lineage']), ('window-1', ['window-1']))
        self.assertEqual(found['records'], self.records)
        self.assertEqual(found['configs'], self.configs)

    def test_config_modes_are_recorded_not_constrained(self):
        image = self.image()
        config_file(image, 'nats-2').chmod(0o644)
        self.assertEqual(self.read(image)['config_modes'],
                         {path: 0o644 if path.endswith('/nats-2.conf') else 0o600 for path in self.configs})


class Refusals(StoppedImage):
    def committed(self, **changes):
        value = copy.deepcopy(self.commitment)
        value['manifest'].update(changes)
        return value

    def test_store_paths_must_name_one_fixed_home(self):
        paths = self.commitment['manifest']['store_paths']
        with self.subTest('one role outside the per-unit form'):
            moved = dict(paths, member2=HOME + '/.openclaw/nats/elsewhere')
            self.rejects('not one fixed home', commitment=self.committed(
                store_paths=moved, store_relative_paths={role: path[1:] for role, path in moved.items()}))
        with self.subTest('relative paths that are not the absolute ones'):
            relative = dict(self.commitment['manifest']['store_relative_paths'],
                            member3='Users/other/.openclaw/nats/jetstream-3')
            self.rejects('not one fixed home', commitment=self.committed(store_relative_paths=relative))
        with self.subTest('a dot-dot home'):
            image = self.image()
            shutil.copytree(self.data / HOME[1:] / '.openclaw', image / '.openclaw', symlinks=True)
            self.set_receipt(image / '.openclaw' / 'preservation',
                             journal_root='/Users/../.openclaw/preservation/journals/window-1')
            dotted = {role: path.replace(HOME, '/Users/..', 1) for role, path in paths.items()}
            self.rejects('not one fixed home', image, self.committed(
                store_paths=dotted, store_relative_paths={role: path[1:] for role, path in dotted.items()}))

    def test_root_is_a_literal_absolute_path(self):
        image = self.image()
        link = image.with_name(image.name + '-link')
        link.symlink_to(image)
        self.addCleanup(os.chdir, os.getcwd())
        os.chdir(image.parent)
        for name, root in (('symlink', link), ('dot-dot', image / '..' / image.name),
                           ('relative', pathlib.Path(image.name))):
            with self.subTest(name):
                self.rejects('stopped image root is not a literal absolute path', root)
        with self.subTest('absent'):
            self.rejects('absent or unreadable', image.with_name('absent'))

    def test_every_path_component_must_be_a_real_directory(self):
        for name in ('.openclaw', 'config'):
            with self.subTest(name):
                image = self.image()
                path = image / HOME[1:] / '.openclaw'
                path = path if name == '.openclaw' else path / name
                path.rename(path.with_name(name + '-real'))
                path.symlink_to(name + '-real')
                self.rejects('not a real directory: ' + name, image)

    def test_journal_directories_must_be_owner_private(self):
        for path, mode in ((preservation, 0o750), (lambda root: preservation(root) / 'journals', 0o755),
                           (window_dir, 0o711)):
            image = self.image()
            with self.subTest(path(image).name):
                path(image).chmod(mode)
                self.rejects('not owner-private: ' + path(image).name, image)
        with self.subTest('a file in the journal parent'):
            image = self.image()
            host.write_private(preservation(image) / 'journals' / 'notes', b'owned')
            self.rejects('not owner-private: notes', image)

    def test_the_owner_must_be_the_reading_user(self):
        with mock.patch('os.getuid', return_value=os.getuid() + 1):
            self.rejects('not owner-private: preservation')

    def test_preservation_holds_only_its_receipt_lock_and_journals(self):
        # The three retirement records are allowed by exact name only (see the Authentic test).
        for name in ('.pending-' + 'a' * 32, '.corrupt-receipt-' + 'b' * 32, 'extra',
                     'legacy-agent-retirement-evidence-20261003.json',
                     'legacy-agent-retirement-evidence-20261002.json.bak',
                     'Legacy-agent-retirement-pre-20261002.json'):
            with self.subTest(name):
                image = self.image()
                host.write_private(preservation(image) / name, b'{}')
                self.rejects('preservation directory holds a pending, corrupt-receipt or unknown entry', image)
        with self.subTest('no receipt'):
            image = self.image()
            (preservation(image) / 'node.lock.state.json').unlink()
            self.rejects('absent or unreadable', image)

    def test_evidence_records_are_owner_private_single_link_files_within_the_bounds(self):
        name = 'legacy-agent-retirement-pre-20261002.json'

        def plain(path):
            host.write_private(path, b'{"owned": true}')

        def readable(path):
            plain(path)
            path.chmod(0o644)

        def hardlinked(path):
            plain(path)
            os.link(path, self.temp / ('outside-' + secrets.token_hex(4)))

        def symlinked(path):
            target = self.temp / ('outside-' + secrets.token_hex(4))
            plain(target)
            path.symlink_to(target)

        def fifo(path):
            os.mkfifo(path, 0o600)

        def directory(path):
            path.mkdir(mode=0o700)

        for label, forge in (('readable by others', readable), ('hard link', hardlinked),
                             ('symlink', symlinked), ('fifo', fifo), ('directory', directory)):
            with self.subTest(label):
                image = self.image()
                forge(preservation(image) / name)
                self.rejects('not an owned single-link regular file: ' + re.escape(name), image)
        with self.subTest('oversized'):
            image = self.image()
            host.write_private(preservation(image) / name, b'#' * (LIMIT + 1))
            self.rejects('exceeds its size bound: ' + re.escape(name), image)
        image = self.image()
        files = sum(1 for path in image.rglob('*') if path.is_file())
        size = sum(path.stat().st_size for path in image.rglob('*') if path.is_file())
        for evidence in stopped_journal_inputs.EVIDENCE:
            host.write_private(preservation(image) / evidence, b'{"owned": "evidence bytes"}')
        extra = 3 * len(b'{"owned": "evidence bytes"}')
        for label, patched, value, accepted in (('bytes', 'MAX_TOTAL', size, False),
                                                ('bytes', 'MAX_TOTAL', size + extra, True),
                                                ('files', 'MAX_FILES', files, False),
                                                ('files', 'MAX_FILES', files + 3, True)):
            with self.subTest('evidence counted against the %s bound' % label, value=value):
                with mock.patch.object(stopped_journal_inputs, patched, value):
                    if accepted:
                        self.assertEqual(self.read(image)['window'], 'window-1')
                    else:
                        self.rejects('stopped image reads exceed their (total|file) bound at: ', image)

    def test_lock_files_are_present_empty_owner_private_files(self):
        def written(path):
            self.replace(path, b'written')

        def readable(path):
            path.chmod(0o644)

        def fifo(path):
            path.unlink()
            os.mkfifo(path, 0o600)

        def symlinked(path):
            path.unlink()
            path.symlink_to('/dev/null')

        def hardlinked(path):
            os.link(path, self.temp / ('outside-' + secrets.token_hex(4)))

        for where, target in (('window', lambda root: window_dir(root) / '.lock'),
                              ('node', lambda root: preservation(root) / 'node.lock')):
            for name, forge, pattern in (
                    ('absent', pathlib.Path.unlink, 'absent or unreadable'),
                    ('written', written, 'journal lock file is not empty: '),
                    ('readable by others', readable, 'not an owned single-link regular file: '),
                    ('fifo', fifo, 'not an owned single-link regular file: '),
                    ('symlink', symlinked, 'not an owned single-link regular file: '),
                    ('hard link', hardlinked, 'not an owned single-link regular file: ')):
                with self.subTest(where + ' lock ' + name):
                    image = self.image()
                    forge(target(image))
                    self.rejects(pattern if name == 'absent' else pattern + re.escape(target(image).name), image)

    def test_window_holds_only_its_lock_and_records_named_in_sequence(self):
        last = '%06d.json' % self.record['sequence']
        for name in ('.pending-' + 'c' * 32, 'notes.txt'):
            with self.subTest(name):
                image = self.image()
                host.write_private(window_dir(image) / name, (window_dir(image) / last).read_bytes())
                self.rejects('journal window holds an unknown or pending entry: window-1', image)
        with self.subTest('the committed record renamed out of sequence'):
            image = self.image()
            (window_dir(image) / last).rename(window_dir(image) / ('%06d.json' % (self.record['sequence'] + 5)))
            self.rejects('journal window sequence has a gap: window-1', image)

    def test_records_and_receipt_must_be_canonical(self):
        row = self.records[3]
        raw = encoded(row)
        for name, forged in (('indented', json.dumps(row, indent=1, sort_keys=True).encode()),
                             ('duplicate key', b'{"at":' + json.dumps(row['at']).encode() + b',' + raw[1:])):
            with self.subTest(name):
                self.assertEqual(json.loads(forged), row)
                image = self.image()
                self.replace(window_dir(image) / '000003.json', forged)
                self.rejects('journal record is not canonical journal JSON', image)
        receipt = (preservation(self.data) / 'node.lock.state.json').read_bytes()
        for name, forged in (('receipt indented', json.dumps(json.loads(receipt), indent=1, sort_keys=True).encode()),
                             # A parser keeping the first of duplicate keys would read 'restored'.
                             ('receipt duplicate key, first value differs', b'{"status":"restored",' + receipt[1:])):
            with self.subTest(name):
                image = self.image()
                self.replace(preservation(image) / 'node.lock.state.json', forged)
                self.rejects('node receipt is not canonical journal JSON', image)

    def test_nan_and_the_infinities_are_refused_as_the_journal_encoding_refuses_them(self):
        receipt = (preservation(self.data) / 'node.lock.state.json').read_bytes()
        holder = encoded(json.loads(receipt)['holder'])
        self.assertEqual(receipt.count(holder), 1)
        # The holder is the one receipt field the reader does not interpret, so only encoding refuses.
        for token in (b'NaN', b'Infinity', b'-Infinity', b'1e999'):
            with self.subTest(token.decode()):
                image = self.image()
                self.replace(preservation(image) / 'node.lock.state.json',
                             receipt.replace(holder, b'{"boot":"boot-a","pid":' + token + b'}'))
                self.rejects('node receipt is not canonical journal JSON', image)
        with self.subTest('record member'):
            image = self.image()
            self.replace(window_dir(image) / '000003.json', encoded(self.records[3])[:-1] + b',"zz":NaN}')
            self.rejects('journal record is not canonical journal JSON', image)

    def test_every_window_is_hash_chained(self):
        unsigned = guest.rechain(self.records[:4], 0)
        unsigned[-1]['event'] = 'resolved'
        finished = self.finished()
        for name, rows in (('content changed after hashing', unsigned),
                           ('sequence', finished[:-1] + [rehashed(finished[-1], sequence=9)]),
                           ('previous link', finished[:-1] + [rehashed(finished[-1], previous='0' * 64)])):
            with self.subTest(name):
                # A linked ancestor, so only its own chain rule can refuse it.
                image = self.image()
                self.window(image, 'window-0', rows)
                self.rejects('journal chain differs: window-0', image,
                             self.rebased(image, predecessor=self.link('window-0', rows)))

    def test_selection_needs_exactly_one_window_with_the_committed_digest(self):
        last = '%06d.json' % self.record['sequence']
        with self.subTest('committed record absent'):
            image = self.image()
            (window_dir(image) / last).unlink()
            self.rejects('no unique journal window ends in the committed checkpoint digest', image)
        with self.subTest('committed record substituted after the commitment'):
            image = self.image()
            self.replace(window_dir(image) / last,
                         encoded(rehashed(self.record, at='2026-10-14T16:00:00+00:00')))
            self.rejects('no unique journal window ends in the committed checkpoint digest', image)
        with self.subTest('committed window duplicated'):
            image = self.image()
            shutil.copytree(window_dir(image), window_dir(image, 'window-2'), symlinks=True)
            self.rejects('no unique journal window ends in the committed checkpoint digest', image)

    def test_every_other_window_is_a_finished_ancestor_of_the_committed_one(self):
        ancestor = self.finished()
        unfinished = guest.rechain(self.records[:4], 0)
        for name, rows in (('an unlinked finished window', ancestor), ('an unlinked unfinished window', unfinished)):
            with self.subTest(name):
                image = self.image()
                self.window(image, 'window-0', rows)
                self.rejects('a journal window is outside the committed window lineage', image)
        with self.subTest('a linked ancestor beside an unlinked window'):
            image = self.image()
            self.window(image, 'window-0', ancestor)
            self.window(image, 'window-2', self.finished(4))
            self.rejects('a journal window is outside the committed window lineage', image,
                         self.rebased(image, predecessor=self.link('window-0', ancestor)))
        for name, link in (('the host path of its predecessor', self.link('window-0', ancestor,
                                                                          root=str(window_dir(self.data, 'window-0')))),
                           ('a head that is not the window head', self.link('window-0', ancestor,
                                                                           head=ancestor[-2]['sha256'])),
                           ('an extra link field', self.link('window-0', ancestor, scope=FULL_NODE_SCOPE)),
                           ('an absent window', self.link('window-9', ancestor))):
            with self.subTest(name):
                image = self.image()
                self.window(image, 'window-0', ancestor)
                self.rejects('journal predecessor is not another window head: window-1', image,
                             self.rebased(image, predecessor=link))
        with self.subTest('an unfinished predecessor'):
            image = self.image()
            self.window(image, 'window-0', unfinished)
            self.rejects('journal predecessor is unfinished: window-0', image,
                         self.rebased(image, predecessor=self.link('window-0', unfinished)))

    def test_receipt_must_name_the_committed_window_as_unresolved(self):
        for name, changes in (('another window', {'journal_root': GUEST_JOURNALS + 'window-0'}),
                              ('host path', {'journal_root': str(self.root.resolve())}),
                              ('restored', {'status': 'restored'}),
                              ('initializing', {'phase': 'initializing'}),
                              ('baseline', {'baseline': rehashed(self.records[0], at='2026-10-14T00:00:00+00:00')}),
                              ('extra key', {'head': self.record['sha256']})):
            with self.subTest(name):
                image = self.image()
                self.set_receipt(preservation(image), **changes)
                self.rejects('node receipt does not name the committed window as its unresolved recovery', image)

    def test_files_are_owned_single_link_bounded_regular_files(self):
        def symlinked(path):
            path.rename(path.with_name(path.name + '.real'))
            path.symlink_to(path.name + '.real')

        def hardlinked(path):
            os.link(path, self.temp / ('outside-' + secrets.token_hex(4)))

        def fifo(path):
            path.unlink()
            os.mkfifo(path, 0o600)

        def oversized(path):
            self.replace(path, b'#' * (LIMIT + 1))

        real_open = os.open
        for name, forge, pattern in (
                ('symlink', symlinked, 'not an owned single-link regular file: nats-2.conf'),
                ('hard link', hardlinked, 'not an owned single-link regular file: nats-2.conf'),
                ('fifo', fifo, 'not an owned single-link regular file: nats-2.conf'),
                ('oversized', oversized, 'exceeds its size bound: nats-2.conf'),
                ('absent', pathlib.Path.unlink, 'absent or unreadable')):
            with self.subTest(name):
                image = self.image()
                path = config_file(image, 'nats-2')
                forge(path)
                opened = []

                def spy(target, flags, *args, **kwargs):
                    opened.append(pathlib.Path(target))
                    return real_open(target, flags, *args, **kwargs)

                with mock.patch('os.open', spy):
                    self.rejects(pattern, image)
                if name in ('symlink', 'fifo'):
                    self.assertNotIn(path, opened, 'a non-regular entry was opened')
        with self.subTest('record readable by others'):
            image = self.image()
            (window_dir(image) / '000001.json').chmod(0o644)
            self.rejects('not an owned single-link regular file: 000001.json', image)

    def test_the_opened_file_must_be_the_checked_one(self):
        image = self.image()
        path = config_file(image, 'nats-2')
        real_open = os.open
        swapped = []

        def swap(target, flags, *args, **kwargs):
            if pathlib.Path(target) == path and not swapped:
                # A new inode while the checked one still exists, then renamed over it.
                swapped.append(path.with_name('.swap'))
                host.write_private(swapped[0], path.read_bytes() + b'# swapped in after the check\n')
                os.rename(swapped[0], path)
            return real_open(target, flags, *args, **kwargs)

        with mock.patch('os.open', swap):
            self.rejects('changed while it was read: nats-2.conf', image)
        self.assertTrue(swapped)

    def test_directory_entries_and_total_reads_are_bounded(self):
        self.assertEqual((stopped_journal_inputs.MAX_ENTRIES, stopped_journal_inputs.MAX_FILES,
                          stopped_journal_inputs.MAX_TOTAL), (1024, 4096, 16 << 20))
        # The committed window lists its records and lock: one more entry than records.
        with mock.patch.object(stopped_journal_inputs, 'MAX_ENTRIES', len(self.records)):
            self.rejects('stopped image directory holds too many entries: window-1')
        with mock.patch.object(stopped_journal_inputs, 'MAX_ENTRIES', len(self.records) + 1):
            self.assertEqual(self.read()['window'], 'window-1')
        # Every file of the fixture is read exactly once.
        total = sum(path.stat().st_size for path in self.data.rglob('*') if path.is_file())
        with mock.patch.object(stopped_journal_inputs, 'MAX_TOTAL', total - 1):
            self.rejects('stopped image reads exceed their total bound at: ')
        with mock.patch.object(stopped_journal_inputs, 'MAX_TOTAL', total):
            self.assertEqual(self.read()['window'], 'window-1')
        # Every regular file is read once, and the one beyond the file bound is never opened.
        files = sum(1 for path in self.data.rglob('*') if path.is_file())
        opened = []
        real_open = os.open

        def spy(path, flags, *args, **kwargs):
            opened.append(path)
            return real_open(path, flags, *args, **kwargs)

        with mock.patch.object(stopped_journal_inputs, 'MAX_FILES', files - 1), mock.patch('os.open', spy):
            self.rejects('stopped image reads exceed their file bound at: ')
        self.assertEqual(len(opened), files - 1)
        with mock.patch.object(stopped_journal_inputs, 'MAX_FILES', files):
            self.assertEqual(self.read()['window'], 'window-1')

    def test_baseline_must_name_one_binary_for_all_four_units(self):
        image = self.image()
        prior = copy.deepcopy(self.records[0]['prior'])
        prior['nats-2']['identity']['argv'][0] = '/usr/local/bin/nats-server'
        self.rejects('NATS units name different binaries in the journal baseline', image,
                     self.rebased(image, prior=prior))


class Composition(StoppedImage):
    def verify(self, table=None):
        return verify_stopped_journal(self.capture, self.data, table=table if table is not None else self.table)

    def test_capture_pins_come_before_the_image_is_read(self):
        self.rewrite('CAPTURE.json', guest_checkpoint_sha256='0' * 64)
        shutil.rmtree(self.data)
        with self.assertRaisesRegex(RuntimeError, 'capture record does not pin this checkpoint commitment'):
            self.verify()

    def test_only_the_pinned_commitment_selects_a_window(self):
        foreign = copy.deepcopy(self.commitment)
        foreign['checkpoint']['checkpoint_sha256'] = '0' * 64
        shutil.rmtree(self.data)
        with mock.patch.object(stopped_journal_inputs, 'require_committed', return_value=foreign):
            with self.assertRaisesRegex(RuntimeError, 'capture commitment differs from the pinned capture record'):
                self.verify()

    def test_the_caller_table_decides_the_identities(self):
        table = copy.deepcopy(self.table)
        table['member2']['config_sha256'] = '0' * 64
        with self.assertRaisesRegex(Refused, 'nats-2: baseline config hash differs from the window pin'):
            self.verify(table)
        with self.assertRaisesRegex(Refused, 'window pin table is incomplete or malformed'):
            self.verify({})

    def test_image_config_bytes_must_be_the_baseline_ones(self):
        path = config_file(self.data, 'nats-3')
        self.replace(path, path.read_bytes() + b'# appended\n')
        with self.assertRaisesRegex(Refused, 'nats-3: config bytes differ from the baseline hash'):
            self.verify()

    def test_terminal_record_substituted_after_the_commitment_is_not_selected(self):
        self.replace(window_dir(self.data) / ('%06d.json' % self.record['sequence']),
                     encoded(rehashed(self.record, at='2026-10-14T16:00:00+00:00')))
        with self.assertRaisesRegex(Refused, 'no unique journal window ends in the committed checkpoint digest'):
            self.verify()


if __name__ == '__main__':
    unittest.main()
