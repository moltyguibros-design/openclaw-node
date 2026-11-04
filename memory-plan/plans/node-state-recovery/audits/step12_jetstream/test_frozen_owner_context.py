import ast
import copy
import inspect
import json
import os
import pathlib
import sys
import textwrap
import unittest
from unittest import mock

import host_guest_commit as commit
import nats_identity
import preservation_journal as journal
import stopped_journal_inputs as stopped
from test_stopped_journal_inputs import StoppedImage, preservation, snapshot


class OwnerContext(StoppedImage):
    def setUp(self):
        super().setUp()
        self.files = {name: (self.capture / name).read_bytes() for name in commit.FROZEN_FILES}
        self.uid = os.getuid()
        self.found = self.read()

    def verify_bytes(self, files=None, records=None, writer_uid=None):
        return commit.verify_frozen_bytes(self.files if files is None else files,
                                          self.records if records is None else records,
                                          configs=self.configs, binary=self.found['binary'],
                                          home=self.found['home'],
                                          writer_uid=self.uid if writer_uid is None else writer_uid)

    def stopped_bytes(self, **context):
        return stopped.verify_stopped_bytes(self.files, self.data,
                                            **{'owner': self.uid, 'writer_uid': self.uid, **context})

    def test_bytes_match_path_verifiers_after_the_capture_path_is_removed(self):
        expected = stopped.verify_stopped_journal(self.capture, self.data)
        expected_commitment = commit.require_committed(self.capture)
        expected_pins = commit.require_captured(self.capture)
        found = self.read()
        self.capture.rename(self.capture.with_name('capture-relocated'))
        before_files, before_records = copy.deepcopy(self.files), copy.deepcopy(found['records'])
        with mock.patch.object(commit, 'private_bytes', side_effect=AssertionError('capture path reopened')), \
             mock.patch.object(os, 'getuid', side_effect=AssertionError('caller uid read')):
            try:
                self.assertEqual(commit.commitment_from(self.files), expected_commitment)
                self.assertEqual(commit.captured_from(self.files), expected_pins)
                summary = commit.verify_frozen_bytes(self.files, found['records'], configs=found['configs'],
                                                      binary=found['binary'], home=found['home'],
                                                      writer_uid=self.uid)
                self.assertEqual(summary, {key: expected[key] for key in summary})
                self.assertEqual(self.stopped_bytes(), expected)
            except AssertionError as error:
                self.fail('byte verification parity or purity failed: ' + str(error))
        self.assertEqual(self.files, before_files)
        self.assertEqual(found['records'], before_records)

    def test_explicit_writer_uid_is_independent_of_the_current_global(self):
        expected = self.verify_bytes()
        with mock.patch.object(journal, 'NATS_ROOT_UID', self.uid + 1):
            try:
                actual = self.verify_bytes()
            except journal.Refused as error:
                self.fail('explicit writer uid was ignored: ' + str(error))
            self.assertEqual(actual, expected)
            with self.assertRaisesRegex(journal.Refused, 'lacks writer exclusion'):
                commit.verify_frozen_checkpoint(self.capture, self.records, configs=self.configs,
                                                 binary=self.found['binary'], home=self.found['home'])
        with self.assertRaisesRegex(journal.Refused, 'lacks writer exclusion'):
            self.verify_bytes(writer_uid=self.uid + 1)

    def test_owner_context_does_not_use_the_current_caller_uid(self):
        expected = self.stopped_bytes()
        before = snapshot(self.data)
        with mock.patch.object(os, 'getuid', return_value=self.uid + 1):
            try:
                actual = self.stopped_bytes()
            except journal.Refused as error:
                self.fail('explicit guest owner was ignored: ' + str(error))
            self.assertEqual(actual, expected)
            with self.assertRaisesRegex(journal.Refused, 'not owner-private: preservation'):
                stopped.read_inputs(self.data, self.commitment)
        self.assertEqual(snapshot(self.data), before)

    def test_wrong_guest_owner_refuses(self):
        with self.assertRaisesRegex(journal.Refused, 'not owner-private: preservation'):
            self.stopped_bytes(owner=self.uid + 1)

    def test_malformed_context_refuses_before_image_reads(self):
        for key in ('owner', 'writer_uid'):
            for value in (None, True, False, -1, '501', 501.0):
                with self.subTest(key=key, value=value), \
                     mock.patch.object(stopped, 'read_inputs', wraps=stopped.read_inputs) as reader:
                    with self.assertRaisesRegex(journal.Refused, 'uid is invalid'):
                        self.stopped_bytes(**{key: value})
                    reader.assert_not_called()

    def test_byte_verifier_rejects_malformed_writer_context(self):
        for writer in (None, True, False, -1, '0', 0.0):
            with self.subTest(writer=writer):
                with self.assertRaisesRegex(journal.Refused, 'protected writer uid is invalid'):
                    commit.verify_frozen_bytes(self.files, self.records, configs=self.configs,
                                               binary=self.found['binary'], home=self.found['home'],
                                               writer_uid=writer)

    def test_both_context_parameters_are_required(self):
        for context in ({}, {'owner': self.uid}, {'writer_uid': self.uid}):
            with self.subTest(context=context), self.assertRaises(TypeError):
                stopped.verify_stopped_bytes(self.files, self.data, **context)
        with self.assertRaises(TypeError):
            commit.verify_frozen_bytes(self.files, self.records, configs=self.configs,
                                       binary=self.found['binary'], home=self.found['home'])

    def test_finder_metadata_uses_the_guest_owner(self):
        path = preservation(self.data) / '.DS_Store'
        path.write_bytes(b'owned metadata')
        actual_lstat = pathlib.Path.lstat

        def foreign(target):
            info = actual_lstat(target)
            if target == path:
                info = os.stat_result((info.st_mode, info.st_ino, info.st_dev, info.st_nlink,
                                       self.uid + 1, info.st_gid, info.st_size,
                                       info.st_atime, info.st_mtime, info.st_ctime))
            return info

        with mock.patch.object(os, 'getuid', side_effect=AssertionError('caller uid read')):
            self.stopped_bytes()
            with mock.patch.object(pathlib.Path, 'lstat', foreign):
                with self.assertRaisesRegex(journal.Refused, 'unexpected Finder metadata owner'):
                    self.stopped_bytes()

    def test_regular_files_and_locks_use_the_guest_owner(self):
        targets = (self.data / next(iter(self.configs))[1:],
                   preservation(self.data) / 'node.lock', self.root / '.lock',
                   self.root / '000001.json')
        actual_lstat = pathlib.Path.lstat
        for path in targets:
            def foreign(target):
                info = actual_lstat(target)
                if target == path:
                    info = os.stat_result((info.st_mode, info.st_ino, info.st_dev, info.st_nlink,
                                           self.uid + 1, info.st_gid, info.st_size,
                                           info.st_atime, info.st_mtime, info.st_ctime))
                return info
            with self.subTest(path=path.name), mock.patch.object(pathlib.Path, 'lstat', foreign):
                with self.assertRaisesRegex(journal.Refused, 'not an owned single-link regular file'):
                    self.stopped_bytes()

    def test_six_bytes_are_required_without_free_table_or_extra_record(self):
        for files in ({**self.files, 'extra.json': b'{}'},
                      {key: raw for key, raw in self.files.items() if key != 'ARMED.json'},
                      {**self.files, 'ARMED.json': json.loads(self.files['ARMED.json'])}):
            with self.subTest(keys=list(files)):
                for function in (commit.commitment_from, commit.captured_from):
                    with self.assertRaisesRegex(RuntimeError, 'exactly six record byte strings'):
                        function(files)
        with self.assertRaises(TypeError):
            stopped.verify_stopped_bytes(self.files, self.data, owner=self.uid,
                                         writer_uid=self.uid, table=self.table)

    def test_pins_refuse_before_image_reads(self):
        forged = {**self.files, 'CAPTURE.json': commit.encoded({})}
        with mock.patch.object(stopped, 'read_inputs', wraps=stopped.read_inputs) as reader:
            with self.assertRaisesRegex(RuntimeError, 'does not pin this checkpoint commitment'):
                stopped.verify_stopped_bytes(forged, self.data, owner=self.uid, writer_uid=self.uid)
            reader.assert_not_called()

    def test_every_capture_pin_is_enforced_by_the_byte_api(self):
        capture = json.loads(self.files['CAPTURE.json'])
        for key in commit.CAPTURE_PINS:
            with self.subTest(pin=key):
                forged = {**self.files, 'CAPTURE.json': commit.encoded({**capture, key: '0' * 64})}
                with self.assertRaisesRegex(RuntimeError, 'does not pin this checkpoint commitment'):
                    commit.captured_from(forged)

    def test_changed_config_bytes_still_refuse(self):
        path = self.data / next(iter(self.configs))[1:]
        path.write_bytes(path.read_bytes() + b'# changed\n')
        with self.assertRaisesRegex(journal.Refused, 'config bytes differ from the baseline hash'):
            self.stopped_bytes()

    def test_altered_frozen_record_still_refuses(self):
        records = copy.deepcopy(self.records)
        records[-1]['at'] = 'changed'
        with self.assertRaisesRegex(journal.Refused, 'capture journal chain differs'):
            self.verify_bytes(records=records)


class PureClosure(unittest.TestCase):
    def test_reachable_byte_verifier_calls_have_no_filesystem_or_caller_identity_access(self):
        pending = [commit.verify_frozen_bytes]
        seen = set()
        forbidden = {'open', 'read_bytes', 'read_text', 'write_bytes', 'write_text', 'stat', 'lstat',
                     'scandir', 'getuid', 'geteuid', 'getgid', 'Popen', 'run', 'preflight', 'private_bytes'}
        modules = {'host_guest_commit', 'preservation_journal', 'preservation_checks',
                   'nats_identity', 'stopped_tree_match', 'host_vm_preflight'}
        while pending:
            function = pending.pop()
            if function in seen:
                continue
            seen.add(function)
            source = ast.parse(textwrap.dedent(inspect.getsource(function)))
            local_imports = {}
            for node in ast.walk(source):
                if isinstance(node, ast.ImportFrom) and node.module in modules:
                    for alias in node.names:
                        local_imports[alias.asname or alias.name] = getattr(sys.modules[node.module], alias.name)
            for node in ast.walk(source):
                if not isinstance(node, ast.Call):
                    continue
                name = node.func.id if isinstance(node.func, ast.Name) else (
                    node.func.attr if isinstance(node.func, ast.Attribute) else '')
                self.assertNotIn(name, forbidden, function.__qualname__ + ': ' + name)
                target = (local_imports.get(name, function.__globals__.get(name))
                          if isinstance(node.func, ast.Name) else None)
                if isinstance(node.func, ast.Attribute) and isinstance(node.func.value, ast.Name):
                    parent = function.__globals__.get(node.func.value.id)
                    target = getattr(parent, name, None) if parent is not None else None
                if inspect.ismethod(target):
                    target = target.__func__
                if inspect.isfunction(target) and target.__module__ in modules:
                    pending.append(target)
                if inspect.isclass(target) and target.__module__ in modules:
                    pending.extend(method for method in vars(target).values() if inspect.isfunction(method))
        self.assertIn(journal.stop_writer_exclusion_proven, seen)
        self.assertIn(journal.capture_cohort, seen)
        self.assertIn(commit.acked_from, seen)
        self.assertIn(commit.bind_window_pin_bytes, seen)
        self.assertIn(nats_identity.validate_window_pins, seen)
        self.assertIn(nats_identity._Reader.skip, seen)


if __name__ == '__main__':
    unittest.main()
