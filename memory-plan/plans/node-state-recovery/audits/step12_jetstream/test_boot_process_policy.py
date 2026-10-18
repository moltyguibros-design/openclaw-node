import copy
import datetime
import hashlib
import json
import os
import pathlib
import secrets
import shutil
import tempfile
import unittest
from unittest.mock import Mock, patch

import boot_process_policy as policy_module
import preservation_journal as journal_module
import stopped_journal_inputs
import test_capture_checkpoint as guest
import test_host_checkpoint_commit as host
import test_nats_identity as identity_fixture
import test_stopped_journal_inputs as image_fixture
from preservation_journal import (FULL_NODE_SCOPE, LIMIT, PROCESS_POLICY_LIMIT, PROCESS_POLICY_SCOPE,
                                  TIMER_SCOPE, TIMER_UNITS, Journal, Refused, encoded, valid_process_policy)
from test_preservation_journal import full_entrypoint_evidence, full_node_inventory, timer_inventory


def recorded_hold(parent):
    root = parent / 'gate'
    root.mkdir(mode=0o700, exist_ok=True)
    lock = root / 'gate.lock'
    if not lock.exists():
        lock.write_bytes(b'')
        lock.chmod(0o600)
    info = root.stat()
    root_identity = {'device': info.st_dev, 'inode': info.st_ino, 'uid': info.st_uid, 'mode': 0o700}
    info = lock.stat()
    pins = {'root': '%d:%d' % (root_identity['device'], root_identity['inode']),
            'lock': '%d:%d:%d' % (info.st_dev, info.st_ino, info.st_ctime_ns)}
    metadata = {'root': pins['root'], 'lock': pins['lock'], 'nonce': 'a' * 64}
    path = root / 'identity.json'
    if not path.exists():
        path.write_bytes(encoded(metadata))
        path.chmod(0o600)
    info = path.stat()
    return {'root': str(root), 'pins': pins, 'metadata': metadata,
            'metadata_identity': {'device': info.st_dev, 'inode': info.st_ino, 'uid': info.st_uid,
                                  'ctime_ns': info.st_ctime_ns, 'mode': 0o600},
            'metadata_sha256': hashlib.sha256(path.read_bytes()).hexdigest(),
            'paths': [{'path': '/', 'identity': {'uid': 0}},
                      {'path': str(root), 'identity': root_identity}], 'cohort': sorted(TIMER_UNITS)}


def authored(roots):
    return {'scope': PROCESS_POLICY_SCOPE, 'uid': os.getuid(), 'roots': copy.deepcopy(roots),
            'expected': [{'label': 'controller', 'executable': '/usr/bin/python3',
                          'executable_sha256': 'b' * 64,
                          'arguments': ['owned-controller', 'explicit.py', '', 'épreuve'],
                          'uid': os.getuid(), 'gid': os.getgid(), 'cwd': '/', 'count': 1,
                          'attribution': {'kind': 'launchd', 'domain': 'gui',
                                          'label': 'application.owned-controller',
                                          'plist_sha256': 'c' * 64}}]}


class PolicyBinding(unittest.TestCase):
    def setUp(self):
        self.root = pathlib.Path(tempfile.gettempdir()).resolve() / ('openclaw-owned-policy-' + secrets.token_hex(8))
        self.root.mkdir(mode=0o700)
        self.addCleanup(shutil.rmtree, self.root)
        self.prior = full_node_inventory()
        self.prior['scheduler-heartbeat']['execution_hold'] = recorded_hold(self.root)
        self.inventory = full_entrypoint_evidence(self.prior)
        self.inventory['roots'] = [str(self.root)]
        self.policy = authored(self.inventory['roots'])
        self.path = self.root / 'policy.json'
        self.save()
        scripted = patch.object(journal_module, 'capture_entrypoint_inventory',
                                side_effect=lambda _: copy.deepcopy(self.inventory))
        self.census = scripted.start()
        self.addCleanup(scripted.stop)

    def save(self, value=None):
        self.path.write_bytes(encoded(self.policy if value is None else value))
        self.path.chmod(0o600)

    def validate(self, value=None):
        return valid_process_policy(self.policy if value is None else value, self.prior, self.inventory)

    def create(self, **options):
        values = dict(boot='boot-a')
        values.update(options)
        journal = policy_module.bind_owned_policy_journal(
            self.root, 'window', self.prior, self.inventory, self.path, **values)
        self.addCleanup(journal.close)
        return journal

    def direct(self, **options):
        values = dict(boot='boot-a', node_lock=self.root / 'preservation/node.lock',
                      scope=FULL_NODE_SCOPE, process_policy=self.policy)
        values.update(options)
        journal = Journal(self.root / 'preservation/journals/window', self.prior, **values)
        self.addCleanup(journal.close)
        return journal

    def test_complete_policy_and_empty_expectations_are_structural_only(self):
        self.assertIsNone(self.validate())
        empty = {**self.policy, 'expected': []}
        self.assertIsNone(self.validate(empty))

    def test_exact_policy_and_expectation_schemas(self):
        for key in ('pid', 'ppid', 'start_sec', 'start_usec', 'boot', 'self', 'helpers'):
            with self.subTest(key=key):
                value = copy.deepcopy(self.policy)
                value[key] = 1
                with self.assertRaisesRegex(Refused, 'policy schema'):
                    self.validate(value)
                value = copy.deepcopy(self.policy)
                value['expected'][0][key] = 1
                with self.assertRaisesRegex(Refused, 'expectation schema'):
                    self.validate(value)
        for key in self.policy:
            with self.subTest(missing=key), self.assertRaises(Refused):
                self.validate({k: v for k, v in self.policy.items() if k != key})

    def test_scope_and_roots_are_fixed(self):
        for key, invalid in (('scope', 'observed enrollment'), ('uid', True), ('uid', -1),
                             ('roots', ['/']), ('roots', self.policy['roots'] * 2)):
            with self.subTest(key=key, invalid=invalid), self.assertRaises(Refused):
                self.validate({**self.policy, key: invalid})

    def test_code_and_cwd_bindings_are_literal(self):
        for key, invalid in (('executable', 'python3'), ('executable', '/bin/../bin/tool'),
                             ('executable_sha256', 'B' * 64), ('executable_sha256', ''),
                             ('cwd', '/tmp/./owned'), ('cwd', '/tmp/$HOME')):
            value = copy.deepcopy(self.policy)
            value['expected'][0][key] = invalid
            with self.subTest(key=key), self.assertRaisesRegex(Refused, 'code or cwd'):
                self.validate(value)

    def test_arguments_reject_unknown_expansions_and_malformed_values(self):
        for invalid in ([], [''], ['ok', '$ROOT'], ['ok', '~'], ['ok', '\0'],
                        ['ok', '\ufffd'], ['ok', '\ud800'], ['ok', 1], ['ok'] * 257):
            value = copy.deepcopy(self.policy)
            value['expected'][0]['arguments'] = invalid
            with self.subTest(invalid=repr(invalid)[:60]), self.assertRaisesRegex(Refused, 'arguments'):
                self.validate(value)

    def test_strict_uid_gid_count_and_list_bounds(self):
        for key in ('uid', 'gid', 'count'):
            for invalid in (True, -1, 1.5, '1'):
                value = copy.deepcopy(self.policy)
                value['expected'][0][key] = invalid
                with self.subTest(key=key, invalid=invalid), self.assertRaisesRegex(Refused, 'uid, gid or count'):
                    self.validate(value)
        for count in (0, 1025):
            value = copy.deepcopy(self.policy)
            value['expected'][0]['count'] = count
            with self.assertRaisesRegex(Refused, 'count'):
                self.validate(value)
        with self.assertRaisesRegex(Refused, 'expectation list'):
            self.validate({**self.policy, 'expected': self.policy['expected'] * 1025})

    def test_recorded_owner_carriers_are_required(self):
        for key in ('metadata_identity', 'paths'):
            original = self.prior['scheduler-heartbeat']['execution_hold'].pop(key)
            with self.subTest(key=key), self.assertRaisesRegex(Refused, 'recorded hold owner'):
                self.validate()
            self.prior['scheduler-heartbeat']['execution_hold'][key] = original

    def test_each_recorded_owner_uid_is_bound(self):
        hold = self.prior['scheduler-heartbeat']['execution_hold']
        for identity in (hold['metadata_identity'], hold['paths'][-1]['identity']):
            uid = identity['uid']
            for invalid in (uid + 1, True, -1):
                identity['uid'] = invalid
                with self.subTest(invalid=invalid), self.assertRaisesRegex(Refused, 'recorded hold owner'):
                    self.validate()
            identity['uid'] = uid

    def test_recorded_root_identity_and_path_bind_the_owner(self):
        hold = self.prior['scheduler-heartbeat']['execution_hold']
        hold['pins']['root'] = '0:0'
        with self.assertRaisesRegex(Refused, 'pinned gate root'):
            self.validate()
        root = hold['paths'][-1]['identity']
        hold['pins']['root'] = '%d:%d' % (root['device'], root['inode'])
        hold['paths'][-1]['path'] = '/different/gate'
        with self.assertRaisesRegex(Refused, 'hold root identity'):
            self.validate()

    def test_held_job_label_refuses_independently(self):
        self.policy['expected'][0]['attribution']['label'] = 'ai.openclaw.gateway'
        with self.assertRaisesRegex(Refused, 'held managed job'):
            self.validate()

    def test_held_job_plist_digest_refuses_independently(self):
        self.policy['expected'][0]['attribution']['plist_sha256'] = self.inventory['installed']['ai.openclaw.gateway']['sha256']
        with self.assertRaisesRegex(Refused, 'held managed job'):
            self.validate()

    def test_held_full_command_refuses_but_shared_interpreter_does_not(self):
        row = self.policy['expected'][0]
        identity = self.prior['gateway']['identity']
        row['executable'] = identity['argv'][0]
        self.validate()
        row['arguments'] = copy.deepcopy(identity['argv'])
        row['cwd'] = identity['working_directory']
        with self.assertRaisesRegex(Refused, 'held managed command'):
            self.validate()

    def helper(self):
        row = copy.deepcopy(self.policy['expected'][0])
        row.update(label='helper', arguments=['explicit-helper'],
                   attribution={'kind': 'expected', 'label': 'controller'})
        self.policy['expected'].append(row)
        return row

    def test_explicit_parent_chain_terminates_at_a_bound_launchd_row(self):
        self.helper()
        self.validate()

    def test_missing_parent_refuses(self):
        self.helper()['attribution']['label'] = 'absent'
        with self.assertRaisesRegex(Refused, 'missing or cyclic'):
            self.validate()

    def test_self_parent_refuses(self):
        self.policy['expected'][0]['attribution'] = {'kind': 'expected', 'label': 'controller'}
        with self.assertRaisesRegex(Refused, 'missing or cyclic'):
            self.validate()

    def test_parent_cycle_refuses(self):
        self.helper()
        self.policy['expected'][0]['attribution'] = {'kind': 'expected', 'label': 'helper'}
        with self.assertRaisesRegex(Refused, 'missing or cyclic'):
            self.validate()

    def test_attribution_has_no_implicit_ancestor_or_platform_kind(self):
        for attribution in ({'kind': 'parent', 'label': 'launchd'}, {'kind': 'self'},
                            {'kind': 'launchd', 'label': 'application.controller', 'domain': 'root', 'plist_sha256': 'c' * 64},
                            {**self.policy['expected'][0]['attribution'], 'pid': 1}):
            value = copy.deepcopy(self.policy)
            value['expected'][0]['attribution'] = attribution
            with self.subTest(attribution=attribution), self.assertRaisesRegex(Refused, 'attribution'):
                self.validate(value)

    def test_duplicate_labels_and_bindings_refuse(self):
        other = copy.deepcopy(self.policy['expected'][0])
        other['arguments'] = ['different-command']
        self.policy['expected'].append(other)
        with self.assertRaisesRegex(Refused, 'label is invalid or duplicated'):
            self.validate()
        self.policy['expected'][-1]['label'] = 'copy'
        self.policy['expected'][-1]['arguments'] = copy.deepcopy(self.policy['expected'][0]['arguments'])
        with self.assertRaisesRegex(Refused, 'binding is duplicated'):
            self.validate()

    def test_other_uid_requires_lexical_root_scope(self):
        value = copy.deepcopy(self.policy)
        value['expected'][0]['uid'] += 1
        with self.assertRaisesRegex(Refused, 'lexical scope'):
            self.validate(value)
        for key in ('executable', 'cwd', 'arguments'):
            candidate = copy.deepcopy(value)
            candidate['expected'][0][key] = [str(self.root / 'script')] if key == 'arguments' else str(self.root)
            self.validate(candidate)
        value['expected'][0]['cwd'] = str(self.root.parent)
        value['expected'][0]['arguments'] = ['tool', self.root.name + '/script']
        self.validate(value)

    def test_validator_reads_no_live_state(self):
        with patch('os.stat', side_effect=AssertionError('no stat')), \
             patch.object(pathlib.Path, 'resolve', side_effect=AssertionError('no resolve')), \
             patch('subprocess.run', side_effect=AssertionError('no live command')):
            self.validate()

    def test_authored_file_canonical_permissions_links_and_bound(self):
        self.assertEqual(policy_module.read_authored_policy(self.path), self.policy)
        for raw in (json.dumps(self.policy, indent=2).encode(), encoded(self.policy) + b'\n', b'{"x":NaN}'):
            self.path.write_bytes(raw)
            with self.assertRaisesRegex(Refused, 'canonical'):
                policy_module.read_authored_policy(self.path)
        self.save()
        self.path.chmod(0o644)
        with self.assertRaisesRegex(Refused, 'owner-private'):
            policy_module.read_authored_policy(self.path)
        self.save()
        link = self.root / 'hardlink'
        os.link(self.path, link)
        with self.assertRaisesRegex(Refused, 'single-link'):
            policy_module.read_authored_policy(self.path)
        link.unlink()
        alias = self.root / 'alias'
        alias.symlink_to(self.path)
        with self.assertRaisesRegex(Refused, 'literal'):
            policy_module.read_authored_policy(alias)
        self.path.write_bytes(b' ' * (PROCESS_POLICY_LIMIT + 1))
        with self.assertRaisesRegex(Refused, 'bounded regular file'):
            policy_module.read_authored_policy(self.path)

    def test_pure_policy_size_bound_is_independent(self):
        self.policy['expected'][0]['arguments'].append('x' * PROCESS_POLICY_LIMIT)
        with self.assertRaisesRegex(Refused, 'authored bound'):
            self.validate()

    def test_producer_binds_exact_authored_bytes_without_live_enrollment(self):
        with patch('subprocess.run', side_effect=AssertionError('no live enrollment')):
            journal = self.create()
        self.assertIn('process_policy', journal.records[0])
        self.assertEqual(journal.records[0]['process_policy'], self.policy)
        self.assertEqual(journal.records[0]['entrypoint_inventory'], self.inventory)
        self.assertFalse(hasattr(journal, 'process_policy'))
        self.assertEqual(journal.records, journal._read())
        saved = copy.deepcopy(journal.records[0])
        self.policy['expected'][0]['arguments'].append('changed after creation')
        self.assertEqual(journal.records[0], saved)

    def test_producer_derives_the_fixed_lock_and_leaves_mocked_home_empty(self):
        outside = self.root / 'mocked-home'
        outside.mkdir(mode=0o700)
        with patch.object(policy_module, 'Journal', wraps=Journal) as constructor, \
             patch.object(pathlib.Path, 'home', return_value=outside):
            try:
                self.create()
            except Refused:
                pass
        self.assertEqual(constructor.call_args.kwargs['node_lock'], self.root / 'preservation/node.lock',
                         'producer must derive its fixed owned lock')
        self.assertEqual(list(outside.iterdir()), [], 'producer must leave the mocked home empty')

    def test_symlinked_preservation_refuses_before_constructor(self):
        outside = self.root / 'outside'
        outside.mkdir(mode=0o700)
        (self.root / 'preservation').symlink_to(outside)
        with patch.object(policy_module, 'Journal') as constructor:
            with self.assertRaisesRegex(Refused, 'owner-private'):
                self.create()
            constructor.assert_not_called()
        self.assertEqual(list(outside.iterdir()), [])

    def test_symlinked_journal_parent_refuses_before_constructor(self):
        outside = self.root / 'outside'
        outside.mkdir(mode=0o700)
        (self.root / 'preservation').mkdir(mode=0o700)
        (self.root / 'preservation/journals').symlink_to(outside)
        with patch.object(policy_module, 'Journal') as constructor:
            with self.assertRaisesRegex(Refused, 'owner-private'):
                self.create()
            constructor.assert_not_called()
        self.assertEqual(list(outside.iterdir()), [])

    def test_owned_root_policy_and_window_fences(self):
        with self.assertRaisesRegex(Refused, 'owned fixture root'):
            policy_module.bind_owned_policy_journal(self.root / 'different', 'window', self.prior, self.inventory, self.path)
        for window in ('../outside', '.', '/outside', ''):
            with self.subTest(window=window), self.assertRaisesRegex(Refused, 'window differs'):
                policy_module.bind_owned_policy_journal(self.root, window, self.prior, self.inventory, self.path)
        with self.assertRaisesRegex(Refused, 'outside the owned fixture'):
            policy_module.bind_owned_policy_journal(self.root, 'window', self.prior, self.inventory, self.root.parent / 'policy.json')
        self.create().close()
        with self.assertRaisesRegex(Refused, 'cannot reopen a window'):
            self.create()

    def test_producer_uid_is_observed_separately(self):
        uid = os.getuid() + 1
        self.policy['uid'] = self.policy['expected'][0]['uid'] = uid
        hold = self.prior['scheduler-heartbeat']['execution_hold']
        hold['metadata_identity']['uid'] = hold['paths'][-1]['identity']['uid'] = uid
        self.save()
        self.validate()
        with self.assertRaisesRegex(Refused, 'producer owner'):
            self.create()

    def test_viable_fixture_with_wrong_root_name_still_refuses(self):
        self.root = self.root / 'different'
        self.root.mkdir(mode=0o700)
        self.path = self.root / 'policy.json'
        self.prior['scheduler-heartbeat']['execution_hold'] = recorded_hold(self.root)
        self.inventory['roots'] = [str(self.root)]
        self.policy = authored(self.inventory['roots'])
        self.save()
        with self.assertRaisesRegex(Refused, 'owned fixture root'):
            self.create()

    def test_producer_hold_root_must_be_inside_fixture(self):
        hold = self.prior['scheduler-heartbeat']['execution_hold']
        hold['root'] = hold['paths'][-1]['path'] = '/outside/gate'
        self.validate()
        with self.assertRaisesRegex(Refused, 'hold root is outside'):
            self.create()

    def test_timer_scope_cannot_carry_a_policy(self):
        with self.assertRaisesRegex(Refused, 'requires a full-node baseline'):
            Journal(self.root / 'preservation/journals/window', timer_inventory(), boot='boot-a',
                    node_lock=self.root / 'preservation/node.lock', scope=TIMER_SCOPE, process_policy=self.policy)
        self.assertFalse((self.root / 'preservation/node.lock.state.json').exists())
        self.assertFalse((self.root / 'preservation/journals/window').exists())

    def test_direct_carrier_validates_policy_before_publication(self):
        self.policy['expected'][0]['count'] = 0
        with self.assertRaisesRegex(Refused, 'count'):
            self.direct()
        self.assertFalse((self.root / 'preservation/node.lock.state.json').exists())
        self.assertFalse((self.root / 'preservation/journals/window').exists())

    def test_old_baseline_reopens_and_d64_still_refuses_before_actions(self):
        journal = self.direct(process_policy=None)
        baseline = copy.deepcopy(journal.records[0])
        journal.close()
        with Journal(journal.root, boot='boot-b', node_lock=self.root / 'preservation/node.lock') as reopened:
            self.assertEqual(reopened.records, [baseline])
            self.assertNotIn('process_policy', baseline)
            actions = Mock()
            with self.assertRaisesRegex(Refused, '^full-node reboot recovery requires a verified boot hold decision$'):
                reopened.recover(actions, actions, actions)
            actions.assert_not_called()

    def test_reopen_policy_refuses_before_lock_parent_effects(self):
        journal = self.direct()
        journal.close()
        outside = self.root / 'unused-lock-parent'
        with self.assertRaisesRegex(Refused, 'cannot replace a journal process policy'):
            Journal(journal.root, boot='boot-a', node_lock=outside / 'node.lock', process_policy=self.policy)
        self.assertFalse(outside.exists(), 'reopen policy must refuse before lock parent creation')

    def interrupted(self):
        original = Journal._state
        def publish(journal, value):
            original(journal, value)
            raise OSError('owned interruption after receipt publication')
        with patch.object(Journal, '_state', publish), self.assertRaisesRegex(OSError, 'owned interruption'):
            self.direct()
        self.assertFalse((self.root / 'preservation/journals/window').exists())

    def test_interrupted_creation_rejects_policy_before_finish_or_early_return(self):
        self.interrupted()
        with patch.object(Journal, '_finish_initialization', side_effect=OSError('owned finish failure')) as finish:
            with self.assertRaisesRegex(Refused, 'interrupted creation must reopen for restoration only'):
                journal = Journal(self.root / 'preservation/journals/window', boot='boot-a',
                                  node_lock=self.root / 'preservation/node.lock', process_policy=self.policy)
                self.addCleanup(journal.close)
            finish.assert_not_called()

    def test_interrupted_creation_without_policy_finishes_original_baseline(self):
        self.interrupted()
        with Journal(self.root / 'preservation/journals/window', boot='boot-a',
                     node_lock=self.root / 'preservation/node.lock') as reopened:
            self.assertEqual(reopened.records[0]['process_policy'], self.policy)
            self.assertFalse(hasattr(reopened, 'process_policy'))

    def test_internal_reopen_guard_also_rejects_a_supplied_policy(self):
        journal = self.direct()
        journal.close()
        with patch.object(journal, '_lock', return_value=None):
            with self.assertRaisesRegex(Refused, 'cannot replace a journal process policy'):
                journal._open(False, None, None, None, self.policy)

    def threshold(self):
        self.prior['gateway']['identity']['argv'].append('x' * (800 << 10))
        self.policy['expected'][0]['arguments'].append('')
        probe = []
        def inspect(_journal, state):
            probe.append(copy.deepcopy(state))
            raise OSError('owned size probe before publication')
        with patch.object(Journal, '_state', inspect), self.assertRaisesRegex(OSError, 'owned size probe'):
            self.direct()
        self.assertEqual(len(probe), 1)
        return LIMIT - len(encoded(probe[0]))

    def test_complete_initial_receipt_exact_bound_is_readable(self):
        class Clock(datetime.datetime):
            @classmethod
            def now(cls, tz=None):
                return cls(2026, 10, 17, 12, 0, 0, 123456, tzinfo=tz)
        observed = []
        original = Journal._state
        def publish(journal, state):
            observed.append(len(encoded(state)))
            return original(journal, state)
        with patch.object(journal_module.datetime, 'datetime', Clock):
            padding = self.threshold()
            self.policy['expected'][0]['arguments'][-1] = 'x' * padding
            self.assertLessEqual(len(encoded(self.policy)), PROCESS_POLICY_LIMIT)
            with patch.object(Journal, '_state', publish):
                journal = self.direct()
        self.assertEqual(observed[0], LIMIT, 'initial receipt must exercise the actual tighter boundary')
        budget = {'files': 2, 'bytes': 2 * LIMIT, 'read': []}
        for path in (journal.node_state, journal.root / '000000.json'):
            raw, _ = stopped_journal_inputs.content(path, 0o600, budget)
            self.assertLessEqual(len(raw), LIMIT)
        self.assertLess(len((journal.root / '000000.json').read_bytes()), LIMIT)

    def test_one_byte_over_complete_receipt_refuses_before_publication(self):
        class Clock(datetime.datetime):
            @classmethod
            def now(cls, tz=None):
                return cls(2026, 10, 17, 12, 0, 0, 123456, tzinfo=tz)
        with patch.object(journal_module.datetime, 'datetime', Clock):
            padding = self.threshold()
            self.policy['expected'][0]['arguments'][-1] = 'x' * (padding + 1)
            with self.assertRaisesRegex(Refused, 'receipt exceeds the frozen reader bound'):
                self.direct()
        self.assertFalse((self.root / 'preservation/node.lock.state.json').exists())
        self.assertFalse((self.root / 'preservation/journals/window').exists())


def captured(test, transform=None, image=False, absent=False, unvalidated=False):
    fixture = image_fixture.StoppedImage() if image else host.HostCheckpoint()
    test.addCleanup(fixture.doCleanups)
    original = guest.Journal
    policies = []
    def journal(root, prior, **options):
        prior['scheduler-heartbeat']['execution_hold'] = recorded_hold(fixture.temp.resolve())
        policy = authored(fixture.loaded['roots'])
        if transform:
            transform(policy)
        policies.append(policy)
        if absent:
            return original(root, prior, **options)
        if unvalidated:
            with patch.object(journal_module, 'valid_process_policy', return_value=None):
                return original(root, prior, process_policy=policy, **options)
        return original(root, prior, process_policy=policy, **options)
    with patch.object(guest, 'Journal', journal):
        fixture.setUp()
    if not image:
        _, _, record = fixture.committed_flow()
        fixture.host_checkpoint(fixture.journal_file(record))
        fixture.publish()
        fixture.records = fixture.journal._read()
        fixture.journal.close()
    fixture.policy = policies[-1]
    return fixture


class FrozenPolicy(unittest.TestCase):
    def consume(self, fixture, records=None):
        return policy_module.frozen_process_policy(
            fixture.capture, fixture.records if records is None else records,
            table=fixture.table, configs=fixture.configs,
            binary=identity_fixture.BINARY, home=identity_fixture.HOME)

    def test_honest_checkpoint_returns_only_bound_authored_policy(self):
        fixture = captured(self)
        before = image_fixture.snapshot(fixture.temp)
        result = self.consume(fixture)
        self.assertEqual(result['process_policy'], fixture.policy)
        self.assertEqual(result['process_policy_sha256'], hashlib.sha256(encoded(fixture.policy)).hexdigest())
        self.assertFalse(result['admission'])
        self.assertFalse(result['history_certified'])
        self.assertEqual(result['authority'], policy_module.AUTHORITY)
        result['process_policy']['expected'].clear()
        self.assertEqual(fixture.records[0]['process_policy'], fixture.policy)
        self.assertEqual(image_fixture.snapshot(fixture.temp), before)

    def test_missing_policy_remains_generic_checkpoint_but_dedicated_consumer_refuses(self):
        fixture = captured(self, absent=True)
        self.assertEqual(fixture.frozen(fixture.records)['checkpoint_sha256'], fixture.records[-1]['sha256'])
        with self.assertRaisesRegex(Refused, 'no authored process policy'):
            self.consume(fixture)

    def test_recommitted_malformed_policy_refuses_after_checkpoint_verification(self):
        fixture = captured(self, transform=lambda p: p['expected'][0].update(count=0), unvalidated=True)
        self.assertEqual(fixture.frozen(fixture.records)['checkpoint_sha256'], fixture.records[-1]['sha256'])
        with self.assertRaisesRegex(Refused, 'count'):
            self.consume(fixture)

    def test_rehashed_policy_swap_without_external_recommit_refuses(self):
        fixture = captured(self)
        forged = copy.deepcopy(fixture.records)
        forged[0]['process_policy']['expected'][0]['count'] = 2
        forged = guest.rechain(forged, 0)
        with self.assertRaisesRegex(Refused, 'committed digest'):
            self.consume(fixture, forged)

    def test_checkpoint_refusal_precedes_policy_interpretation(self):
        fixture = captured(self)
        missing_inventory = copy.deepcopy(fixture.records)
        del missing_inventory[0]['entrypoint_inventory']
        malformed_prior = copy.deepcopy(fixture.records)
        malformed_prior[0]['prior'] = 'untrusted prior'
        malformed_policy = copy.deepcopy(fixture.records)
        malformed_policy[0]['process_policy']['expected'][0]['count'] = 0
        malformed_policy = guest.rechain(malformed_policy, 0)
        for name, records, message in (
                ('not-a-list', {'untrusted': 'records'}, 'capture journal is incomplete'),
                ('missing-inventory', missing_inventory, 'capture journal chain differs'),
                ('malformed-prior', malformed_prior, 'capture journal chain differs'),
                ('rehashed-malformed-policy', malformed_policy, 'committed digest')):
            with self.subTest(name=name):
                observed = None
                try:
                    self.consume(fixture, records)
                except (Refused, KeyError, TypeError, IndexError) as error:
                    observed = error
                self.assertIsInstance(observed, Refused,
                                      'checkpoint must reject before policy interpretation')
                self.assertRegex(str(observed), message)

    def test_policy_roots_remain_bound_after_external_commit(self):
        fixture = captured(self, transform=lambda p: p.update(roots=['/different']), unvalidated=True)
        with self.assertRaisesRegex(Refused, 'roots differ'):
            self.consume(fixture)

    def test_authored_code_hash_is_a_claim_not_live_eligibility(self):
        fixture = captured(self, transform=lambda p: p['expected'][0].update(executable_sha256='e' * 64))
        result = self.consume(fixture)
        self.assertEqual(result['process_policy']['expected'][0]['executable_sha256'], 'e' * 64)
        self.assertFalse(result['admission'])
        self.assertIn('authorship and pre-stop authenticity unproven', result['authority'])

    def test_image_consumer_uses_real_reader_owner_metadata_without_writes(self):
        fixture = captured(self, image=True)
        before = image_fixture.snapshot(fixture.data)
        result = policy_module.image_process_policy(fixture.capture, fixture.data, table=fixture.table)
        self.assertEqual(result['process_policy'], fixture.policy)
        self.assertEqual(result['owner_observation']['uid'], os.getuid())
        self.assertIn('reader lstat', result['owner_observation']['scope'])
        self.assertFalse(result['admission'])
        self.assertEqual(image_fixture.snapshot(fixture.data), before)

    def test_image_owner_mismatch_cannot_be_ignored(self):
        fixture = captured(self, image=True)
        found = stopped_journal_inputs.read_inputs(fixture.data, fixture.commitment)
        found['read'][-1]['uid'] += 1
        with patch.object(policy_module, 'read_inputs', return_value=found):
            with self.assertRaisesRegex(Refused, 'stopped-image reader ownership'):
                policy_module.image_process_policy(fixture.capture, fixture.data, table=fixture.table)

    def test_image_commitment_must_match_pins_before_window_selection(self):
        fixture = captured(self, image=True)
        divergent = copy.deepcopy(fixture.commitment)
        divergent['checkpoint']['checkpoint_sha256'] = 'f' * 64
        with patch.object(policy_module, 'require_committed', return_value=divergent), \
             patch.object(policy_module, 'read_inputs', wraps=stopped_journal_inputs.read_inputs) as reader:
            observed = None
            try:
                policy_module.image_process_policy(fixture.capture, fixture.data, table=fixture.table)
            except Refused as error:
                observed = error
            self.assertIsInstance(observed, Refused)
            self.assertIn('capture commitment differs from the pinned capture record', str(observed))
            reader.assert_not_called()


if __name__ == '__main__':
    unittest.main()
