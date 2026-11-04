import copy
import datetime
import time
import contextlib
import io
import json
import os
import pathlib
import secrets
import shutil
import subprocess
import sys
import tempfile
import unittest
from unittest import mock

import scoped_process_diagnostic as diagnostic

BOOT = 'b' * 64


class ScopedProcessDiagnostic(unittest.TestCase):
    def setUp(self):
        self.root = pathlib.Path(tempfile.gettempdir()).resolve() / (
            'openclaw-owned-process-' + secrets.token_hex(8))
        self.root.mkdir(mode=0o700)
        self.addCleanup(shutil.rmtree, self.root)
        self.binary = self.root / 'owned-executable'
        self.binary.write_bytes(b'owned executable stand-in')
        self.row = {'pid': 42, 'ppid': 1, 'uid': os.getuid(), 'gid': os.getgid(), 'name': 'owned',
                    'start_sec': int(time.time()) + 1,
                    'start_usec': 200, 'executable': str(self.binary),
                    'executable_sha256': diagnostic.regular_content(self.binary, 1000),
                    'arguments': [str(self.binary), 'secret-argument'], 'cwd': str(self.root)}
        self.expected = {'scope': diagnostic.SCOPE, 'boot': BOOT, 'uid': os.getuid(),
                         'roots': [str(self.root)], 'expected': [copy.deepcopy(self.row)]}
        self.observed = {'boot': BOOT, 'before': [42], 'after': [42],
                         'processes': [copy.deepcopy(self.row)], 'unknown': [], 'unstable': [],
                         'enumeration': 'substituted'}

    def compare(self, observed=None, expected=None):
        return diagnostic.compare(self.observed if observed is None else observed,
                                  self.expected if expected is None else expected)

    def saved(self):
        path = self.root / 'expectations.json'
        path.write_bytes(diagnostic.encoded(self.expected))
        path.chmod(0o600)
        return path

    def test_complete_explicit_table_and_redaction(self):
        report = self.compare()
        self.assertEqual(report['outcome'], 'clean')
        self.assertFalse(report['admission'])
        self.assertFalse(report['history_certified'])
        self.assertEqual(report['scope'], diagnostic.SCOPE)
        self.assertEqual(len(report['matched']), 1)
        self.assertEqual(report['coverage']['uid_scope'], True)
        self.assertEqual(report['coverage']['single_instant'], False)
        self.assertEqual(report['coverage']['physical_exclusion'], False)
        self.assertNotIn('secret-argument', json.dumps(report))
        self.assertNotIn('expected', report)
        self.assertNotIn('arguments', report['matched'][0])
        self.assertNotIn('verified', report)
        self.assertEqual(report['coverage']['enumeration'], 'substituted')

    def test_no_automatic_self_helper_or_parent_exception(self):
        for pid, executable in ((os.getpid(), sys.executable), (43, '/bin/launchctl'), (44, '/bin/sh')):
            with self.subTest(pid=pid):
                row = {**self.row, 'pid': pid, 'ppid': os.getpid(), 'executable': executable}
                observed = {**self.observed, 'before': [pid], 'after': [pid], 'processes': [row]}
                result = self.compare(observed, {**self.expected, 'expected': []})
                self.assertEqual(result['outcome'], 'refused')
                self.assertEqual([item['pid'] for item in result['unexpected']], [pid])

    def test_each_generation_and_identity_field_is_bound(self):
        for key, changed in (('pid', 43), ('ppid', 2), ('uid', self.row['uid'] + 1),
                             ('gid', self.row['gid'] + 1), ('name', 'other-name'),
                             ('start_sec', 101), ('start_usec', 201),
                             ('executable', str(self.root / 'other')),
                             ('executable_sha256', 'c' * 64),
                             ('arguments', ['different-argv']), ('cwd', str(self.root.parent))):
            with self.subTest(key=key):
                row = {**self.row, key: changed}
                observed = {**self.observed, 'before': [row['pid']], 'after': [row['pid']], 'processes': [row]}
                report = self.compare(observed)
                self.assertEqual(report['outcome'], 'refused')
                self.assertEqual(len(report['unexpected']), 1)
                self.assertEqual(len(report['missing']), 1)

    def test_old_pid_reused_by_unrelated_process(self):
        observed = copy.deepcopy(self.observed)
        observed['processes'][0].update(start_sec=999, arguments=['unrelated-new-boot-program'])
        self.assertEqual(self.compare(observed)['outcome'], 'refused')
        self.assertEqual(len(self.compare(observed)['unexpected']), 1)

    def test_extra_and_missing_processes_are_independent(self):
        extra = {**self.row, 'pid': 43}
        observed = {**self.observed, 'before': [42, 43], 'after': [42, 43],
                    'processes': [self.row, extra]}
        result = self.compare(observed)
        self.assertEqual(result['outcome'], 'refused')
        self.assertEqual(len(result['matched']), 1)
        self.assertEqual(result['missing'], [])
        self.assertEqual([row['pid'] for row in result['unexpected']], [43])
        observed = {**self.observed, 'before': [], 'after': [], 'processes': []}
        result = self.compare(observed)
        self.assertEqual(result['outcome'], 'refused')
        self.assertEqual(result['unexpected'], [])
        self.assertEqual([row['pid'] for row in result['missing']], [42])

    def test_other_uid_root_scope_executable_cwd_and_arguments(self):
        for key in ('executable', 'cwd', 'arguments'):
            with self.subTest(key=key):
                row = {**self.row, 'uid': self.row['uid'] + 1,
                       'executable': '/usr/bin/true', 'cwd': '/', 'arguments': ['/usr/bin/true']}
                row[key] = self.row[key]
                result = self.compare({**self.observed, 'processes': [row]},
                                      {**self.expected, 'expected': []})
                self.assertEqual(result['outcome'], 'refused')
                self.assertEqual([item['pid'] for item in result['unexpected']], [42])

    def test_other_uid_bare_relative_alias_is_in_scope(self):
        outside = self.root / 'outside'
        outside.mkdir()
        (outside / 'entry').symlink_to(self.binary)
        row = {**self.row, 'uid': self.row['uid'] + 1, 'executable': '/usr/bin/true',
               'cwd': str(outside), 'arguments': ['entry']}
        expected = {**self.expected, 'roots': [str(self.binary)], 'expected': []}
        result = self.compare({**self.observed, 'processes': [row]}, expected)
        self.assertEqual(result['outcome'], 'refused')
        self.assertEqual(len(result['unexpected']), 1)

    def test_known_other_uid_outside_scope_is_excluded(self):
        row = {**self.row, 'uid': self.row['uid'] + 1, 'executable': '/usr/bin/true',
               'cwd': '/', 'arguments': ['/usr/bin/true']}
        result = self.compare({**self.observed, 'processes': [row]}, {**self.expected, 'expected': []})
        self.assertEqual(result['outcome'], 'clean')
        self.assertEqual(result['excluded_pids'], [42])

    def test_other_uid_whole_argument_alias_with_spaces_is_in_scope(self):
        required = self.root / 'required'
        required.mkdir()
        target = required / 'program'
        target.write_bytes(b'owned target')
        outside = self.root / 'outside'
        outside.mkdir()
        arguments = []
        for name in ('entry with spaces', 'entry(parentheses)', 'entry"quote', "entry'quote",
                     'entry;semicolon', 'entry,comma', 'entry|pipe', 'entry&ampersand', 'entry`tick'):
            alias = outside / name
            alias.symlink_to(target)
            arguments.extend((str(alias), alias.name))
        for argument, root in ((argument, root) for argument in arguments
                               for root in (target, required)):
            with self.subTest(argument=argument, root=root):
                row = {**self.row, 'uid': self.row['uid'] + 1,
                       'executable': '/usr/bin/true', 'cwd': str(outside),
                       'arguments': [argument]}
                expected = {**self.expected, 'roots': [str(root)], 'expected': []}
                result = self.compare({**self.observed, 'processes': [row]}, expected)
                self.assertEqual(result['outcome'], 'refused')
                self.assertEqual([item['pid'] for item in result['unexpected']], [42])
                self.assertEqual(result['excluded_pids'], [])

    def test_argument_digest_preserves_boundaries(self):
        digests = []
        for arguments in (['ab', 'c'], ['a', 'bc']):
            row = {**self.row, 'arguments': arguments}
            result = self.compare({**self.observed, 'processes': [row]},
                                  {**self.expected, 'expected': [row]})
            digests.append(result['matched'][0]['arguments_sha256'])
        self.assertNotEqual(*digests, 'argument boundaries must not collapse')

    def test_uid_alone_requires_explicit_expectations(self):
        row = {**self.row, 'executable': '/usr/bin/true', 'cwd': '/', 'arguments': ['/usr/bin/true']}
        result = self.compare({**self.observed, 'processes': [row]}, {**self.expected, 'expected': []})
        self.assertEqual(result['outcome'], 'refused')
        self.assertEqual([item['pid'] for item in result['unexpected']], [42])

    def test_unknown_refuses_without_any_unexpected_or_missing(self):
        observed = {**self.observed, 'before': [42, 43], 'after': [42, 43],
                    'unknown': [{'pid': 43, 'field': 'arguments', 'error_type': 'Refused'}]}
        result = self.compare(observed)
        self.assertEqual(result['outcome'], 'refused')
        self.assertEqual(result['errors'], [])
        self.assertEqual(result['unexpected'], [])
        self.assertEqual(result['missing'], [])
        self.assertEqual(len(result['unknown']), 1)

    def test_unstable_refuses_even_with_all_expected_matched(self):
        observed = {**self.observed, 'before': [42], 'after': [42, 43], 'unstable': [43],
                    'unknown': [{'pid': 43, 'field': 'unstable-pid', 'error_type': 'UnexcludedScope'}]}
        result = self.compare(observed)
        self.assertEqual(result['outcome'], 'refused')
        self.assertIn('process enumeration is unstable', result['errors'])
        self.assertEqual(len(result['matched']), 1)

    def test_missing_enumerated_pid_refuses(self):
        observed = {**self.observed, 'before': [42, 43], 'after': [42, 43]}
        result = self.compare(observed)
        self.assertEqual(result['outcome'], 'refused')
        self.assertEqual(result['errors'], ['process enumeration coverage differs'])

    def test_boot_mismatch_refuses_independently(self):
        result = self.compare({**self.observed, 'boot': 'c' * 64})
        self.assertEqual(result['outcome'], 'refused')
        self.assertEqual(result['errors'], ['current boot differs from explicit expectations'])

    def test_other_uid_unexpanded_path_is_unknown(self):
        row = {**self.row, 'uid': self.row['uid'] + 1, 'cwd': '/',
               'executable': '/usr/bin/true', 'arguments': ['$ENTRYPOINT']}
        result = self.compare({**self.observed, 'processes': [row]}, {**self.expected, 'expected': []})
        self.assertEqual(result['outcome'], 'refused')
        self.assertEqual(result['unknown'][0]['field'], 'scope')

    def test_exact_expectation_schema(self):
        bad = [None, {}, {**self.expected, 'uid_scope': False},
               {**self.expected, 'scope': 'production-admission'},
               {**self.expected, 'uid': True}, {**self.expected, 'boot': 'old'},
               {**self.expected, 'roots': []}, {**self.expected, 'roots': ['/x/../y']},
               {**self.expected, 'expected': [self.row, self.row]}]
        for value in bad:
            with self.subTest(value=value), self.assertRaises(RuntimeError):
                diagnostic.compare(self.observed, value)

    def test_exact_process_schema(self):
        for key, value in (('pid', True), ('start_sec', 0), ('start_usec', 1000000),
                           ('executable', 'relative'), ('executable_sha256', 'short'),
                           ('arguments', []), ('cwd', '/x/../y')):
            with self.subTest(key=key), self.assertRaises(RuntimeError):
                self.compare(expected={**self.expected, 'expected': [{**self.row, key: value}]})
        with self.assertRaises(RuntimeError):
            self.compare(expected={**self.expected, 'expected': [{**self.row, 'allow_descendants': True}]})

    def test_observation_schema_and_duplicate_pid_refuse(self):
        for observed in ({**self.observed, 'verified': True},
                         {**self.observed, 'before': [True]},
                         {**self.observed, 'before': [42, 42]},
                         {**self.observed, 'unknown': [{}]},
                         {**self.observed, 'processes': [self.row, self.row]}):
            with self.subTest(observed=observed), self.assertRaises(RuntimeError):
                self.compare(observed)

    def collector(self, *, failure=None, change=None, lists=None, boots=None):
        info = {key: self.row[key] for key in diagnostic.BRACKET_KEYS}
        after = {**info, **(change or {})}
        with (mock.patch.object(diagnostic, 'boot_identity', side_effect=boots or [BOOT, BOOT]),
              mock.patch.object(diagnostic.proc, 'list_pids', side_effect=lists or [[42], [42]]),
              mock.patch.object(diagnostic.proc, 'bsd_info', side_effect=[info, after, info, after, info, after]),
              mock.patch.object(diagnostic.proc, 'executable', return_value=str(self.binary)),
              mock.patch.object(diagnostic.proc, 'arguments', return_value=self.row['arguments']),
              mock.patch.object(diagnostic.proc, 'working_directory', return_value={'path': str(self.root)})):
            if failure is None:
                return diagnostic.observe()
            target, error = failure
            with mock.patch.object(target[0], target[1], side_effect=error):
                return diagnostic.observe()

    def test_collector_composes_actual_file_hash_and_stable_process_fields(self):
        observed = self.collector()
        self.assertEqual(observed, self.observed)
        self.assertEqual(self.compare(observed)['outcome'], 'clean')

    def test_each_unreadable_primitive_remains_unknown(self):
        cases = [(diagnostic.proc, 'bsd_info', 'identity'),
                 (diagnostic.proc, 'executable', 'executable'),
                 (diagnostic.proc, 'arguments', 'arguments'),
                 (diagnostic.proc, 'working_directory', 'cwd'),
                 (diagnostic, 'regular_content', 'executable-bytes')]
        for module, name, field in cases:
            with self.subTest(field=field):
                observed = self.collector(failure=((module, name), OSError('unreadable')))
                self.assertEqual(observed['processes'], [])
                self.assertEqual(observed['unknown'][0], {'pid': 42, 'field': field, 'error_type': 'OSError'})
                self.assertEqual(len(observed['unknown']), 2)
                self.assertEqual(self.compare(observed)['outcome'], 'refused')

    def test_changed_generation_during_snapshot_is_unknown(self):
        for change in ({'start_sec': 999}, {'start_usec': 999}, {'ppid': 999},
                       {'uid': self.row['uid'] + 1}, {'gid': self.row['gid'] + 1}, {'name': 'exec-changed'}):
            with self.subTest(change=change):
                observed = self.collector(change=change)
                self.assertEqual(observed['processes'], [], 'changed process must not produce a stable row')
                self.assertEqual(observed['unknown'][0]['field'], 'stability')
                self.assertEqual(self.compare(observed)['outcome'], 'refused')

    def test_executable_newer_than_process_is_unknown(self):
        self.row['start_sec'] = 1
        observed = self.collector()
        self.assertEqual(observed['processes'], [], 'late executable must not produce a stable row')
        self.assertEqual(observed['unknown'][0]['field'], 'executable-age')

    def test_second_sample_generation_change_is_unknown(self):
        info = {key: self.row[key] for key in diagnostic.BRACKET_KEYS}
        changed = {**info, 'start_usec': 999}
        with (mock.patch.object(diagnostic, 'boot_identity', return_value=BOOT),
              mock.patch.object(diagnostic.proc, 'list_pids', return_value=[42]),
              mock.patch.object(diagnostic.proc, 'bsd_info', side_effect=[info, info, changed, changed]),
              mock.patch.object(diagnostic.proc, 'executable', return_value=str(self.binary)),
              mock.patch.object(diagnostic.proc, 'arguments', return_value=self.row['arguments']),
              mock.patch.object(diagnostic.proc, 'working_directory', return_value={'path': str(self.root)})):
            observed = diagnostic.observe()
        self.assertEqual(len(observed['unknown']), 1, 'second sample must expose changed process')
        self.assertEqual(observed['unknown'][0]['field'], 'between-samples')
        self.assertEqual(self.compare(observed)['outcome'], 'refused')

    def test_changed_executable_argv_or_cwd_during_snapshot_is_unknown(self):
        for name, readings in (('executable', [str(self.binary), str(self.root)]),
                               ('arguments', [self.row['arguments'], ['changed']]),
                               ('working_directory', [{'path': str(self.root)}, {'path': '/'}])):
            with self.subTest(name=name):
                info = {key: self.row[key] for key in diagnostic.BRACKET_KEYS}
                with (mock.patch.object(diagnostic.proc, 'bsd_info', return_value=info),
                      mock.patch.object(diagnostic.proc, 'executable', return_value=str(self.binary)),
                      mock.patch.object(diagnostic.proc, 'arguments', return_value=self.row['arguments']),
                      mock.patch.object(diagnostic.proc, 'working_directory', return_value={'path': str(self.root)}),
                      mock.patch.object(diagnostic.proc, name, side_effect=readings)):
                    row, failure = diagnostic.snapshot(42)
                self.assertIsNone(row)
                self.assertEqual(failure['field'], 'stability')

    def test_snapshot_identity_must_name_requested_pid(self):
        self.row['pid'] = 43
        observed = self.collector()
        self.assertEqual(observed['processes'], [], 'wrong PID must not produce a stable row')
        self.assertEqual(observed['unknown'][0]['field'], 'stability')

    def test_cwd_vnode_change_with_same_path_is_unknown(self):
        info = {key: self.row[key] for key in diagnostic.BRACKET_KEYS}
        with (mock.patch.object(diagnostic.proc, 'bsd_info', return_value=info),
              mock.patch.object(diagnostic.proc, 'executable', return_value=str(self.binary)),
              mock.patch.object(diagnostic.proc, 'arguments', return_value=self.row['arguments']),
              mock.patch.object(diagnostic.proc, 'working_directory', side_effect=[
                  {'path': str(self.root), 'inode': 1}, {'path': str(self.root), 'inode': 2}])):
            row, failure = diagnostic.snapshot(42)
        self.assertIsNone(row, 'cwd vnode change must not produce a stable row')
        self.assertEqual(failure['field'], 'stability')

    def test_pid_churn_and_boot_change_are_observed(self):
        observed = self.collector(lists=[[42], [42, 43]])
        self.assertEqual(observed['unstable'], [43])
        self.assertEqual(self.compare(observed)['outcome'], 'refused')
        observed = self.collector(boots=[BOOT, 'c' * 64])
        self.assertEqual(observed['unknown'][0]['field'], 'boot-changed')
        self.assertEqual(self.compare(observed)['outcome'], 'refused')

    def test_both_pid_list_failures_and_bad_lists_are_unknown(self):
        for values in ([OSError('before'), []], [[], OSError('after')], [[True], []], [[42, 42], []]):
            with self.subTest(values=values):
                observed = self.collector(lists=values)
                self.assertTrue(observed['unknown'])
                result = self.compare(observed, {**self.expected, 'expected': []})
                self.assertEqual(result['outcome'], 'refused')

    def test_both_boot_read_failures_are_unknown(self):
        for values, field in (([OSError('before')], 'boot-before'),
                              ([BOOT, subprocess.CalledProcessError(1, 'sysctl')], 'boot-after')):
            with self.subTest(field=field):
                observed = self.collector(boots=values)
                self.assertEqual(observed['unknown'][0]['field'], field)
                self.assertEqual(self.compare(observed)['outcome'], 'refused')

    def test_full_enumeration_cannot_omit_the_diagnostic_process(self):
        fake = lambda: []
        with (mock.patch.object(diagnostic, 'PID_ENUMERATOR', fake),
              mock.patch.object(diagnostic.proc, 'list_pids', fake),
              mock.patch.object(diagnostic, 'boot_identity', return_value=BOOT)):
            observed = diagnostic.observe()
        self.assertEqual(observed['enumeration'], 'full')
        result = self.compare(observed, {**self.expected, 'expected': []})
        self.assertEqual(result['outcome'], 'refused')
        self.assertEqual(len(result['unknown']), 2)

    def test_fixture_fence_precedes_path_or_process_access(self):
        with mock.patch.object(diagnostic.pathlib, 'Path', side_effect=AssertionError('path access')), \
             mock.patch.object(diagnostic, 'observe', side_effect=AssertionError('process access')):
            with self.assertRaisesRegex(RuntimeError, 'production scoped process'):
                diagnostic.inspect_owned('/production')

    def test_owned_inspector_consumes_explicit_file_without_writes(self):
        path = self.saved()
        before = path.read_bytes(), sorted(self.root.iterdir())
        with mock.patch.object(diagnostic, 'observe', return_value=self.observed) as observe:
            result = diagnostic.inspect_owned(self.root, fixture=True)
        self.assertEqual(result['outcome'], 'clean')
        self.assertEqual(observe.call_count, 1)
        self.assertEqual(before, (path.read_bytes(), sorted(self.root.iterdir())))

    def test_viable_fixture_still_needs_explicit_flag(self):
        self.saved()
        with mock.patch.object(diagnostic, 'observe', return_value=self.observed) as observe:
            with self.assertRaisesRegex(RuntimeError, 'production scoped process'):
                diagnostic.inspect_owned(self.root)
            observe.assert_not_called()

    def test_noncanonical_or_escaping_file_refuses_before_observation(self):
        path = self.saved()
        values = [json.dumps(self.expected).encode(),
                  diagnostic.encoded({**self.expected, 'uid': os.getuid() + 1}),
                  diagnostic.encoded({**self.expected, 'roots': ['/']}),
                  diagnostic.encoded({**self.expected, 'extra': True})]
        for raw in values:
            with self.subTest(raw=raw), mock.patch.object(diagnostic, 'observe') as observe:
                path.write_bytes(raw)
                with self.assertRaises(RuntimeError):
                    diagnostic.inspect_owned(self.root, fixture=True)
                observe.assert_not_called()

    def test_out_of_scope_expectation_is_invalid(self):
        row = {**self.row, 'uid': self.row['uid'] + 1, 'executable': '/usr/bin/true',
               'cwd': '/', 'arguments': ['/usr/bin/true']}
        with self.assertRaisesRegex(RuntimeError, 'outside the required scope'):
            self.compare(expected={**self.expected, 'expected': [row]})

    def test_private_root_file_links_and_mode_are_required(self):
        path = self.saved()
        for target, mode in ((self.root, 0o755), (path, 0o644)):
            target.chmod(mode)
            with mock.patch.object(diagnostic, 'observe', return_value=self.observed), \
                 self.assertRaisesRegex(RuntimeError, 'private'):
                diagnostic.inspect_owned(self.root, fixture=True)
            target.chmod(0o700 if target == self.root else 0o600)
        linked = self.root / 'linked'
        os.link(path, linked)
        with self.assertRaisesRegex(RuntimeError, 'private'):
            diagnostic.inspect_owned(self.root, fixture=True)
        linked.unlink()
        alias = self.root / 'alias'
        alias.symlink_to(self.root, target_is_directory=True)
        path.write_bytes(diagnostic.encoded({**self.expected, 'roots': [str(alias)]}))
        with self.assertRaisesRegex(RuntimeError, 'escape'):
            diagnostic.inspect_owned(self.root, fixture=True)

    def test_cli_production_refusal_is_redacted_record_free(self):
        completed = subprocess.run([sys.executable, diagnostic.__file__, str(self.root)],
                                   capture_output=True, text=True, timeout=15)
        self.assertEqual(completed.returncode, 2)
        report = json.loads(completed.stdout)
        self.assertEqual(report['outcome'], 'refused')
        self.assertFalse(report['admission'])
        self.assertIn('production scoped process', report['error'])
        self.assertEqual(sorted(self.root.iterdir()), [self.binary])

    def test_cli_fixture_branch_prints_comparison_and_correct_exit(self):
        path = self.saved()
        before = path.read_bytes(), sorted(self.root.iterdir())
        for observed, code in ((self.observed, 0), ({**self.observed, 'boot': 'c' * 64}, 2)):
            with mock.patch.object(sys, 'argv', [diagnostic.__file__, str(self.root), '--fixture']), \
                 mock.patch.object(diagnostic, 'observe', return_value=observed), \
                 contextlib.redirect_stdout(io.StringIO()) as output:
                self.assertEqual(diagnostic.main(), code)
            report = json.loads(output.getvalue())
            self.assertEqual(report['outcome'], 'clean' if code == 0 else 'refused')
            self.assertFalse(report['admission'])
            self.assertNotIn('secret-argument', output.getvalue())
            self.assertEqual(before, (path.read_bytes(), sorted(self.root.iterdir())))

    @unittest.skipUnless(sys.platform == 'darwin', 'owned libproc child requires macOS')
    def test_native_owned_child_uses_real_primitives_with_scripted_enumeration_only(self):
        child_binary = self.root / 'owned-child'
        subprocess.run(['/usr/bin/clang', '-x', 'c', '-o', str(child_binary), '-'],
                       input='#include <stdio.h>\nint main(void) { puts("ready"); fflush(stdout); getchar(); return 0; }\n',
                       text=True, check=True, capture_output=True, timeout=30)
        arguments = [str(child_binary), 'owned-child-argument', '', 'épreuve']
        child = subprocess.Popen(arguments,
                                 cwd=self.root, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                 stderr=subprocess.PIPE, text=True)
        try:
            self.assertEqual(child.stdout.readline().strip(), 'ready')
            started = diagnostic.proc.bsd_info(child.pid)
            stamp = subprocess.check_output(['/bin/ps', '-p', str(child.pid), '-o', 'lstart='],
                                            text=True, env=dict(os.environ, LC_ALL='C')).strip()
            seconds = int(time.mktime(datetime.datetime.strptime(stamp, '%a %b %d %H:%M:%S %Y').timetuple()))
            self.assertEqual(started['start_sec'], seconds)
            explicit = {'pid': child.pid, 'ppid': os.getpid(), 'uid': os.getuid(), 'gid': os.getgid(),
                        'name': child_binary.name, 'start_sec': seconds, 'start_usec': started['start_usec'],
                        'executable': str(child_binary),
                        'executable_sha256': diagnostic.regular_content(child_binary, 1 << 30),
                        'arguments': arguments, 'cwd': str(self.root)}
            expected = {**self.expected, 'boot': diagnostic.boot_identity(), 'expected': [explicit]}
            with mock.patch.object(diagnostic.proc, 'list_pids', return_value=[child.pid]) as listed:
                observed = diagnostic.observe()
            self.assertEqual(listed.call_count, 2)
            result = diagnostic.compare(observed, expected)
            self.assertEqual(result['outcome'], 'clean')
            self.assertEqual(result['coverage']['enumeration'], 'substituted')
            self.assertEqual([item['pid'] for item in result['matched']], [child.pid])
            self.assertFalse(result['admission'])
            result = diagnostic.compare(observed, {**expected, 'expected': []})
            self.assertEqual(result['outcome'], 'refused')
            self.assertEqual([item['pid'] for item in result['unexpected']], [child.pid])
            self.assertNotIn('owned-child-argument', json.dumps(result))
            if os.environ.get('GITHUB_ACTIONS') == 'true':
                full = diagnostic.compare(diagnostic.observe(), expected)
                self.assertEqual(full['outcome'], 'refused')
                self.assertEqual(full['coverage']['enumeration'], 'full')
                self.assertIn(child.pid, [row['pid'] for row in full['matched']])
                print('native owned runner full scan: refused; owned child matched; unknown=%d unexpected=%d' %
                      (len(full['unknown']), len(full['unexpected'])), flush=True)
        finally:
            child.stdin.close()
            try:
                child.wait(timeout=5)
            except subprocess.TimeoutExpired:
                child.kill()
                child.wait()
            child.stdout.close()
            child.stderr.close()


if __name__ == '__main__':
    unittest.main()
