"""Scratch review tool: the reported reader gaps, run against one stopped_journal_inputs.py tree.

Usage: python3 repro_reader_claims.py STEP12_DIR

STEP12_DIR is step12_jetstream with a reader patch applied. Each case builds the owned fixture of
test_stopped_journal_inputs.StoppedImage (the real Journal, capture-ready record and host
commitment chain), forges one entry in its own copy of the stopped Data root and prints whether
read_inputs() ACCEPTED or REFUSED it, with the refusal. Nothing outside owned temporary
directories is touched.
"""
import copy
import json
import os
import pathlib
import shutil
import sys
import unittest

STEP12 = pathlib.Path(sys.argv.pop(1)).resolve()
sys.path.insert(0, str(STEP12))
os.chdir(STEP12)

import test_capture_checkpoint as guest  # noqa: E402
import test_host_checkpoint_commit as host  # noqa: E402
import test_stopped_journal_inputs as fixture  # noqa: E402
from preservation_journal import Refused, encoded  # noqa: E402
from stopped_journal_inputs import read_inputs  # noqa: E402


class Claims(fixture.StoppedImage):
    def outcome(self, label, root, commitment=None):
        try:
            found = read_inputs(root, commitment or self.commitment)
        except Refused as error:
            print('%-58s REFUSED: %s' % (label, error))
            return
        print('%-58s ACCEPTED (result keys: %s)' % (label, ','.join(sorted(found))))

    def rebased(self, image, **baseline):
        """The committed window re-hashed with a changed baseline, its receipt and digest to match."""
        rows = copy.deepcopy(self.records)
        rows[0].update(baseline)
        rows = guest.rechain(rows, 0)
        for index, row in enumerate(rows):
            self.replace(fixture.window_dir(image) / ('%06d.json' % index), encoded(row))
        self.set_receipt(fixture.preservation(image), baseline=rows[0])
        commitment = copy.deepcopy(self.commitment)
        commitment['checkpoint']['checkpoint_sha256'] = rows[-1]['sha256']
        return commitment

    def receipt_raw(self, image, raw):
        self.replace(fixture.preservation(image) / 'node.lock.state.json', raw)

    def test_claims(self):
        window_lock = lambda image: fixture.window_dir(image) / '.lock'
        node_lock = lambda image: fixture.preservation(image) / 'node.lock'
        for label, target in (('window', window_lock), ('node', node_lock)):
            image = self.image()
            target(image).unlink()
            self.outcome('%s lock absent' % label, image)
            image = self.image()
            self.replace(target(image), b'written')
            self.outcome('%s lock not empty' % label, image)
            image = self.image()
            target(image).chmod(0o644)
            self.outcome('%s lock mode 0644' % label, image)
            image = self.image()
            target(image).unlink()
            os.mkfifo(target(image), 0o600)
            self.outcome('%s lock is a FIFO' % label, image)
            image = self.image()
            target(image).unlink()
            target(image).symlink_to('/dev/null')
            self.outcome('%s lock is a symlink' % label, image)
        receipt = json.loads((fixture.preservation(self.data) / 'node.lock.state.json').read_bytes())
        holder = encoded(receipt['holder'])
        raw = encoded(receipt)
        for token in (b'NaN', b'Infinity', b'-Infinity', b'1e999'):
            image = self.image()
            self.receipt_raw(image, raw.replace(holder, b'{"boot":"x","pid":' + token + b'}'))
            self.outcome('receipt holder pid %s' % token.decode(), image)
        image = self.image()
        self.receipt_raw(image, b'{"status":"unresolved",' + raw[1:])
        self.outcome('receipt duplicate key, same value', image)
        image = self.image()
        self.receipt_raw(image, b'{"status":"restored",' + raw[1:])
        self.outcome('receipt duplicate key, first value differs', image)
        record = encoded(self.records[3])
        image = self.image()
        self.replace(fixture.window_dir(image) / '000003.json', record[:-1] + b',"zz":NaN}')
        self.outcome('record with a NaN member', image)
        image = self.image()
        self.window(image, 'window-0', self.finished())
        self.outcome('predecessor None beside a finished window', image)
        image = self.image()
        commitment = self.rebased(image, predecessor={'root': fixture.GUEST_JOURNALS + 'window-0',
                                                      'head': '0' * 64})
        self.outcome('predecessor naming an absent window', image, commitment)
        image = self.image()
        finished = self.finished()
        self.window(image, 'window-0', finished)
        commitment = self.rebased(image, predecessor={'root': fixture.GUEST_JOURNALS + 'window-0',
                                                      'head': finished[-2]['sha256']})
        self.outcome('predecessor head is not the window head', image, commitment)
        image = self.image()
        for index in range(300):
            self.window(image, 'w%03d' % index, self.finished(2))
        self.outcome('300 finished windows beside the committed one', image)
        image = self.image()
        link = self.temp / 'root-link'
        link.symlink_to(image)
        self.outcome('root reached through a symlink', link)
        os.chdir(image.parent)
        self.outcome('relative root', pathlib.Path(image.name))
        os.chdir(STEP12)
        image = self.image()
        fixture.config_file(image, 'nats-2').chmod(0o644)
        self.outcome('config mode 0644 (accepted by design; recorded?)', image)


if __name__ == '__main__':
    unittest.main(defaultTest='Claims.test_claims', verbosity=1)
