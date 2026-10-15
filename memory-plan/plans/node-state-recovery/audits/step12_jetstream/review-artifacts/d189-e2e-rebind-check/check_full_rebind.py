"""Scratch replica of the operator's D189 e2e helper fix: full rebind, no require_committed mock.

Usage: python3 check_full_rebind.py STEP12_DIR   (step12_jetstream at bae1d9ff; Linux is enough:
it drives the real capture worker through test_host_checkpoint_commit.CapturePin, not the macOS
ASIF e2e, and builds each call site's candidate the way test_host_vm_capture.py does).

For a candidate guest manifest, temporarily rebuild COMMITTED (manifest + digest), ACKED (commit
and manifest digests), CHECKPOINT (commit, ack and manifest digests) and the three CAPTURE byte
pins with host_guest_commit.encoded, call the real require_committed and the real host_match,
then restore the four originals byte-exact (0600, one link). Reports, per call-site semantics,
which refusal is actually reached.
"""
import hashlib, json, os, pathlib, stat, sys, unittest
STEP12 = pathlib.Path(sys.argv.pop(1)).resolve()
sys.path.insert(0, str(STEP12))
os.chdir(STEP12)
import stopped_tree_match  # noqa: E402
import test_host_checkpoint_commit as T  # noqa: E402
from host_guest_commit import encoded, require_committed  # noqa: E402
from host_vm_preflight import write_record  # noqa: E402

NAMES = ('COMMITTED.json', 'ACKED.json', 'CHECKPOINT.json', 'CAPTURE.json')
sha = lambda raw: hashlib.sha256(raw).hexdigest()


class FullRebind(T.CapturePin):
    def put(self, name, value):
        path = self.capture / name
        path.unlink()
        T.write_private(path, encoded(value))
        return path.read_bytes()

    def rebound(self, flow, candidate, name):
        out = self.capture
        saved = {n: (out / n).read_bytes() for n in NAMES}
        try:
            manifest = json.loads(candidate.read_bytes())
            committed = dict(json.loads(saved['COMMITTED.json']), manifest=manifest,
                             manifest_sha256=sha(encoded(manifest)))
            c_raw = self.put('COMMITTED.json', committed)
            a_raw = self.put('ACKED.json', dict(json.loads(saved['ACKED.json']), commit_sha256=sha(c_raw),
                                                manifest_sha256=committed['manifest_sha256']))
            k_raw = self.put('CHECKPOINT.json', dict(json.loads(saved['CHECKPOINT.json']), commit_sha256=sha(c_raw),
                                                     ack_sha256=sha(a_raw), manifest_sha256=committed['manifest_sha256']))
            self.put('CAPTURE.json', dict(json.loads(saved['CAPTURE.json']), guest_commit_sha256=sha(c_raw),
                                          guest_ack_sha256=sha(a_raw), guest_checkpoint_sha256=sha(k_raw)))
            require_committed(out)
            return self.match(dict(flow, guest=candidate), name)
        finally:
            for n, raw in saved.items():
                (out / n).unlink()
                T.write_private(out / n, raw)
            for n, raw in saved.items():
                info = (out / n).lstat()
                assert (out / n).read_bytes() == raw and stat.S_IMODE(info.st_mode) == 0o600 and info.st_nlink == 1

    def outcome(self, flow, candidate, name):
        try:
            result = self.rebound(flow, candidate, name)
            return 'MATCHED masters=%d' % len(result['masters'])
        except RuntimeError as error:
            return 'REFUSED: ' + str(error)

    def test_call_sites(self):
        _, error, flow = self.captured()
        self.assertIsNone(error)
        original = json.loads(flow['guest'].read_bytes())
        swapped_paths = dict(original['store_paths'], member2=original['store_paths']['member3'],
                             member3=original['store_paths']['member2'])
        swapped_relative = dict(original['store_relative_paths'], member2=original['store_relative_paths']['member3'],
                                member3=original['store_relative_paths']['member2'])
        legacy_swapped = {k: v for k, v in original.items() if k not in ('capture_nonce', 'journal_head')}
        legacy_swapped.update(spec_sha256='a' * 64, store_paths=swapped_paths, store_relative_paths=swapped_relative)
        cases = [
            ('1166 swapped guest as produced (legacy: no nonce, no head)', legacy_swapped),
            ('1166 swapped guest with arm nonce and head injected into the file',
             dict(legacy_swapped, capture_nonce=original['capture_nonce'], journal_head=original['journal_head'])),
            ('1182 relabeled store paths', dict(original, store_paths=swapped_paths)),
            ('1193 wrong scope', dict(original, scope='host-generated content observation')),
            ('1193 wrong spec', dict(original, spec_sha256='f' * 64)),
            ('1200 old clock', dict(original, at_utc='2020-01-01T00:00:00+00:00')),
            ('1200 ahead clock', dict(original, at_utc='2030-01-01T00:00:00+00:00')),
        ]
        before = {n: (self.capture / n).read_bytes() for n in NAMES}
        for index, (label, manifest) in enumerate(cases):
            candidate = self.temp / ('candidate-%d.json' % index)
            write_record(candidate, manifest)
            print('%-68s %s' % (label, self.outcome(flow, candidate, 'case-%d' % index)))
        self.assertEqual({n: (self.capture / n).read_bytes() for n in NAMES}, before)
        print('authentic host_match after all cases:', 'MATCHED' if self.match(flow, 'after')['masters'] else '?')


if __name__ == '__main__':
    unittest.main(defaultTest='FullRebind.test_call_sites', verbosity=1)
