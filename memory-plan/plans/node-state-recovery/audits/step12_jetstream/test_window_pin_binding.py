import copy
import hashlib
import json
import os
import shutil
import unittest
from unittest import mock

import host_guest_commit as commit
import test_host_checkpoint_commit as host_fixture
import test_nats_identity as identities
import host_vm_capture
from host_vm_preflight import write_record


class WindowPins(host_fixture.HostCheckpoint):
    captured = host_fixture.CapturePin.captured

    def replace_pins(self, value):
        self.window_pins.unlink()
        write_record(self.window_pins, value)

    def test_table_bytes_are_bound_before_guest_checkpoint_and_consumed_from_capture(self):
        output, error, flow = self.captured()
        self.assertIsNone(error)
        raw = (output / 'WINDOW_PINS.json').read_bytes()
        arm = json.loads((output / 'ARMED.json').read_bytes())
        capture = json.loads((output / 'CAPTURE.json').read_bytes())
        self.assertEqual(json.loads(raw), self.table)
        self.assertEqual(arm['window_pins_sha256'], hashlib.sha256(raw).hexdigest())
        self.assertEqual(capture['window_pins_sha256'], arm['window_pins_sha256'])
        self.assertEqual(flow['record']['arm_sha256'], hashlib.sha256(self.armed).hexdigest())
        self.assertEqual(self.frozen()['checkpoint_sha256'], flow['record']['sha256'])

    def test_noncanonical_or_malformed_table_refuses_before_arm(self):
        original = self.window_pins.read_bytes()
        bad = copy.deepcopy(self.table)
        bad['member2']['cluster'] = []
        for raw in (original + b' ', b'{}\n', commit.encoded(bad)):
            with self.subTest(raw=raw[:30]):
                self.window_pins.write_bytes(raw)
                output, error, _ = self.captured()
                self.assertIsInstance(error, RuntimeError)
                self.assertFalse((output / 'ARMED.json').exists())
                shutil.rmtree(output.parent)

    def test_nonprivate_linked_or_symlink_table_refuses_before_arm(self):
        original = self.window_pins
        linked = self.temp / 'linked-pins'
        alias = self.temp / 'alias-pins'
        for kind in ('mode', 'link', 'symlink'):
            with self.subTest(kind=kind):
                if kind == 'mode':
                    original.chmod(0o644)
                elif kind == 'link':
                    os.link(original, linked)
                else:
                    alias.symlink_to(original)
                    self.window_pins = alias
                try:
                    output, error, _ = self.captured()
                    self.assertRegex(str(error), 'not owner-private')
                    self.assertFalse((output / 'ARMED.json').exists())
                    shutil.rmtree(output.parent)
                finally:
                    self.window_pins = original
                    original.chmod(0o600)
                    if linked.exists():
                        linked.unlink()
                    if alias.is_symlink():
                        alias.unlink()

    def test_source_table_changed_after_arm_refuses_publication(self):
        changed = copy.deepcopy(self.table)
        changed['member2']['config_sha256'] = '0' * 64
        output, error, _ = self.captured(during_extract=lambda _: self.replace_pins(changed))
        self.assertRegex(str(error), 'window pin table changed during capture')
        self.assertTrue((output / 'FAILED.json').exists())
        self.assertFalse((output / 'CAPTURE.json').exists())

    def test_nonprivate_captured_table_refuses_publication(self):
        output, error, _ = self.captured(
            during_extract=lambda output: (output / 'WINDOW_PINS.json').chmod(0o644))
        self.assertRegex(str(error), 'not owner-private')
        self.assertTrue((output / 'FAILED.json').exists())
        self.assertFalse((output / 'CAPTURE.json').exists())

    def test_interrupted_arm_publication_keeps_the_capture_incomplete(self):
        original = host_vm_capture.write_record

        def interrupted(path, value):
            if path.name == 'ARMED.json':
                raise OSError('owned arm publication interrupted')
            return original(path, value)

        with mock.patch.object(host_vm_capture, 'write_record', side_effect=interrupted):
            output, error, flow = self.captured()
        self.assertRegex(str(error), 'owned arm publication interrupted')
        self.assertEqual(flow, {})
        self.assertTrue((output / 'WINDOW_PINS.json').exists())
        self.assertTrue((output / 'FAILED.json').exists())
        self.assertFalse((output / 'ARMED.json').exists())
        self.assertFalse((output / 'CAPTURE.json').exists())

    def test_capture_requires_the_table_byte_pin(self):
        output, error, _ = self.captured()
        self.assertIsNone(error)
        self.rewrite('CAPTURE.json', window_pins_sha256='0' * 64)
        with self.assertRaisesRegex(RuntimeError, 'does not pin this checkpoint commitment'):
            commit.require_captured(output)

    def test_rebound_capture_pin_cannot_replace_the_arm_table(self):
        output, error, _ = self.captured()
        self.assertIsNone(error)
        changed = copy.deepcopy(self.table)
        changed['member2']['config_sha256'] = '0' * 64
        self.rewrite('WINDOW_PINS.json', **changed)
        self.repin()
        with self.assertRaisesRegex(RuntimeError, 'window pin table differs from the committed arm'):
            commit.require_captured(output)

    def test_arm_table_digest_is_checked_even_with_a_rebound_host_chain(self):
        output, error, _ = self.captured()
        self.assertIsNone(error)
        self.rewrite('ARMED.json', window_pins_sha256='0' * 64)
        self.rebind_host_chain()
        commit.require_committed(output)
        with self.assertRaisesRegex(RuntimeError, 'window pin table differs from the committed arm'):
            commit.require_captured(output)

    def rebind_host_chain(self):
        def digest(name):
            return hashlib.sha256((self.capture / name).read_bytes()).hexdigest()
        self.rewrite('COMMITTED.json', arm_sha256=digest('ARMED.json'))
        self.rewrite('ACKED.json', commit_sha256=digest('COMMITTED.json'))
        self.rewrite('CHECKPOINT.json', commit_sha256=digest('COMMITTED.json'),
                     ack_sha256=digest('ACKED.json'))
        self.repin()

    def test_coordinated_host_rewrite_is_refused_by_the_frozen_image_arm(self):
        output, error, _ = self.captured()
        self.assertIsNone(error)
        self.rewrite('ARMED.json', at_utc='2026-10-19T12:00:00Z')
        self.rebind_host_chain()
        commit.require_committed(output)
        commit.require_captured(output)
        with self.assertRaisesRegex(RuntimeError, 'fields differ from the frozen journal, arm, manifest or pins'):
            self.frozen()

    def test_old_capture_without_window_pins_refuses(self):
        output, error, _ = self.captured()
        self.assertIsNone(error)
        (output / 'WINDOW_PINS.json').unlink()
        with self.assertRaisesRegex(RuntimeError, 'guest commitment input is missing'):
            self.frozen()

    def test_frozen_verifier_has_no_caller_table_argument(self):
        _, error, _ = self.captured()
        self.assertIsNone(error)
        with self.assertRaises(TypeError):
            commit.verify_frozen_checkpoint(self.capture, self.journal._read(), table=self.table,
                                           configs=self.configs, binary=identities.BINARY,
                                           home=identities.HOME)


if __name__ == '__main__':
    unittest.main()
