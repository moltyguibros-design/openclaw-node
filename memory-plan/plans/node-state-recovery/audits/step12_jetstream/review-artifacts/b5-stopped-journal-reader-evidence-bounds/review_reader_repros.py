"""Scratch review repros for the corrected stopped-image reader (read-only; owned temp dirs only).

Usage: python3 review_reader_repros.py STEP12_DIR   (bae1d9ff + e74d610b + 4d430e41 applied)
"""
import copy
import gc
import hashlib
import json
import os
import pathlib
import sys
import time
import tracemalloc
import unittest
from unittest import mock

STEP12 = pathlib.Path(sys.argv.pop(1)).resolve()
sys.path.insert(0, str(STEP12))
os.chdir(STEP12)

import preservation_journal  # noqa: E402
import stopped_journal_inputs as reader  # noqa: E402
import test_capture_checkpoint as guest  # noqa: E402
import test_host_checkpoint_commit as host  # noqa: E402
import test_stopped_journal_inputs as fixture  # noqa: E402
from nats_identity import ROLES, config_path, parse_identity  # noqa: E402
from preservation_journal import Refused, encoded  # noqa: E402

UNIT = {role: unit for unit, role in ROLES.items()}


def fds():
    return len(os.listdir('/proc/self/fd'))


class Review(fixture.StoppedImage):
    def test_1_table_derived_from_the_image_passes(self):
        found = reader.read_inputs(self.data, self.commitment)
        # (a) From the committed capture-ready record's own identities.
        identities = found['records'][-1]['identities']
        from_record = {role: {key: identities[role][key] for key in
                              ('config_sha256', 'server_name', 'store_dir', 'cluster')} for role in identities}
        # (b) From the baseline's config hashes and the image's own config bytes.
        prior = found['records'][0]['prior']
        from_baseline = {}
        for unit, role in ROLES.items():
            path = config_path(found['home'], unit)
            from_baseline[role] = {'config_sha256': prior[unit]['identity']['files'][path],
                                   **parse_identity(found['configs'][path])}
        for name, table in (('record identities', from_record), ('baseline + image configs', from_baseline)):
            summary = reader.verify_stopped_journal(self.capture, self.data, table=table)
            print('table rebuilt from %-26s -> verified, checkpoint %s...' % (name, summary['checkpoint_sha256'][:12]))
        print('equal to the fixture B3 table:', from_record == self.table == from_baseline)

    def test_2_memory_amplification_within_bounds(self):
        image = self.image()
        count, size = 8, 1 << 20
        rows = copy.deepcopy(self.records[:1])
        while len(rows) < count:
            filler = []
            row = {'event': 'filler', 'boot': 'boot-a', 'at': 'x', 'f': filler}
            # Grow the record to just under LIMIT with empty lists: 3 bytes each when encoded.
            filler.extend([[]] * ((size - 4096) // 3))
            rows.append(row)
        rows = guest.rechain(rows, 0)
        self.window(image, 'window-0', rows)
        raw = sum(len(encoded(row)) for row in rows)
        gc.collect()
        tracemalloc.start()
        try:
            reader.read_inputs(image, self.commitment)
        except Refused as error:
            refusal = str(error)
        _, peak = tracemalloc.get_traced_memory()
        tracemalloc.stop()
        print('unlinked window of %d records, %.1f MiB raw -> peak %.0f MiB Python heap (x%.0f), then: %s'
              % (count, raw / 2 ** 20, peak / 2 ** 20, peak / raw, refusal))
        print('at MAX_TOTAL %d MiB the same shape peaks near %.1f GiB before any lineage check'
              % (reader.MAX_TOTAL >> 20, reader.MAX_TOTAL * peak / raw / 2 ** 30))

    def test_3_real_journal_leftovers_the_reader_refuses(self):
        # A failed record rename leaves .pending- in the window; Journal itself keeps reading it.
        image = self.image()
        window = fixture.window_dir(image)
        name = '.pending-' + 'd' * 32
        host.write_private(window / name, encoded(self.records[-1]))
        plain = object.__new__(preservation_journal.Journal)
        plain.root = window
        print('Journal._read of the window with %s: %d records (accepted)' % (name[:9], len(plain._read())))
        try:
            reader.read_inputs(image, self.commitment)
        except Refused as error:
            print('reader:', error)
        # A corrupt receipt reopened by the real Journal is renamed aside and never removed.
        image = self.image()
        receipt = fixture.preservation(image) / 'node.lock.state.json'
        receipt.write_bytes(b'{corrupt')
        journal = guest.Journal(fixture.window_dir(image), boot='boot-a',
                                node_lock=fixture.preservation(image) / 'node.lock')
        journal.close()
        left = sorted(path.name for path in fixture.preservation(image).iterdir())
        print('after a real Journal reopen of a corrupt receipt:', left)
        try:
            reader.read_inputs(image, self.commitment)
        except Refused as error:
            print('reader:', error)

    def test_4_descriptors_return_to_baseline_on_every_outcome(self):
        before = fds()
        outcomes = {}
        for _ in range(50):
            for label, root in (('accepted', self.data), ('absent root', self.data.with_name('absent'))):
                try:
                    reader.read_inputs(root, self.commitment)
                    outcomes[label] = 'accepted'
                except Refused as error:
                    outcomes[label] = str(error)[:60]
            with mock.patch.object(reader, 'MAX_TOTAL', 10):
                try:
                    reader.read_inputs(self.data, self.commitment)
                except Refused as error:
                    outcomes['budget'] = str(error)[:60]
            with mock.patch.object(reader, 'MAX_ENTRIES', 2):
                try:
                    reader.read_inputs(self.data, self.commitment)
                except Refused as error:
                    outcomes['entries'] = str(error)[:60]
        print('open descriptors before %d, after 200 reads %d; outcomes %s' % (before, fds(), outcomes))

    def test_5_worst_case_file_count_time(self):
        image = self.image()
        width = 48
        previous = None
        for index in range(width):
            rows = self.finished(width - 1, predecessor=previous)
            name = 'w%03d' % index
            self.window(image, name, rows)
            previous = self.link(name, rows)
        commitment = self.rebased(image, predecessor=previous)
        files = width * (width + 1)
        started = time.monotonic()
        found = reader.read_inputs(image, commitment)
        elapsed = time.monotonic() - started
        per = elapsed / files
        print('%d linked windows x %d records: %d files read in %.2fs (%.0f us/file); lineage %d long'
              % (width, width, files, elapsed, per * 1e6, len(found['lineage'])))
        bound = reader.MAX_ENTRIES * reader.MAX_ENTRIES
        print('MAX_ENTRIES^2 = %d files allowed -> about %.0f s at this rate (records here ~%d B, budget not binding)'
              % (bound, bound * per, len(encoded(self.records[1]))))



class RunbookEvidence(fixture.StoppedImage):
    def test_6_documented_preservation_evidence_file(self):
        # LEGACY_AGENT_RETIREMENT_RUNBOOK.md:294 records this owner-private file in the preservation dir.
        image = self.image()
        evidence = fixture.preservation(image) / 'legacy-agent-retirement-evidence-20261002.json'
        host.write_private(evidence, b'{"scope":"owned stand-in for the runbook evidence record"}\n')
        try:
            reader.read_inputs(image, self.commitment)
            print('reader: accepted')
        except Refused as error:
            print('reader with the runbook evidence file present:', error)
        # Journal resolves receipt roots on the host it runs on, so give this copy a host-path receipt.
        self.set_receipt(fixture.preservation(image), journal_root=str(fixture.window_dir(image).resolve()))
        journal = guest.Journal(fixture.window_dir(image), boot='boot-a',
                                node_lock=fixture.preservation(image) / 'node.lock')
        print('real Journal reopen with the same file present: constructed, %d records' % len(journal.records))
        journal.close()


if __name__ == '__main__':
    unittest.main(verbosity=1)
