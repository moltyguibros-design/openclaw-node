"""Decisive tests for nats_identity (synthetic configs only; no files, stores or nats-server)."""
import copy
import hashlib
import os
import pathlib
import sys
import unittest
from unittest.mock import patch

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
if os.environ.get('STEP12'):
    sys.path.insert(1, os.environ['STEP12'])

from nats_identity import ROLES, bind_identities, config_path, parse_identity  # noqa: E402
from preservation_checks import Refused  # noqa: E402

HOME = '/Users/owned'
BINARY = '/opt/homebrew/bin/nats-server'
NAMES = {'nats': 'openclaw-nats-owned-host', 'nats-1': 'openclaw-nats-1',
         'nats-2': 'openclaw-nats-2', 'nats-3': 'openclaw-nats-3'}
STORES = {unit: HOME + '/.openclaw/nats/' + ('jetstream' if unit == 'nats' else 'jetstream-' + unit[-1])
          for unit in ROLES}
CANARY = {unit: 'CANARY-' + unit + '-5f1d' for unit in ROLES}

CLUSTER = """
cluster {
  name: openclaw-cluster
  listen: 127.0.0.1:62@n@0
  // peers, unquoted route URLs
  routes = [
    nats-route://127.0.0.1:6210
    nats-route://127.0.0.1:6220, nats-route://127.0.0.1:6230
  ]
}
"""
TEMPLATE = """# OpenClaw NATS — @unit@ (owned synthetic fixture)
server_name: @name@
listen: 127.0.0.1:42@n@2
http: 127.0.0.1:82@n@2

authorization {
  users = [
    {user: "openclaw", password: "@secret@"}
    {user: 'reader', password: "p#ss{}//x;(y)"}  # quoted comment markers and braces are literal
  ]
}

jetstream {
  store_dir: "@store@"
  max_mem: 256MB
  max_file: 1GB
}
@cluster@"""


def config(unit, **override):
    values = {'unit': unit, 'name': NAMES[unit], 'store': STORES[unit], 'secret': CANARY[unit], **override}
    text = TEMPLATE.replace('@cluster@', '' if unit == 'nats' else CLUSTER)
    for key, value in values.items():
        text = text.replace('@' + key + '@', value)
    return text.replace('@n@', '0' if unit == 'nats' else unit[-1]).encode()


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def fixture(configs=None):
    configs = configs or {unit: config(unit) for unit in ROLES}
    prior, table, data = {}, {}, {}
    for unit, role in ROLES.items():
        path = config_path(HOME, unit)
        held = role == 'member1'
        prior[unit] = {'class': 'held' if held else 'daemon', 'loaded': not held, 'running': not held,
                       'disabled': held,
                       'identity': {'argv': [BINARY, '--config', path], 'working_directory': '/',
                                    'files': {BINARY: '0' * 64, path: sha(configs[unit])},
                                    'dependencies': {}, 'plist_sha256': '1' * 64}}
        table[role] = {'config_sha256': sha(configs[unit]), 'server_name': NAMES[unit],
                       'store_dir': STORES[unit], 'cluster': None if unit == 'nats' else 'openclaw-cluster'}
        data[path] = configs[unit]
    return prior, table, data


def bind(prior, table, data):
    return bind_identities(prior, table, data, binary=BINARY, home=HOME)


class Parse(unittest.TestCase):
    def refuse(self, raw, rule):
        with self.assertRaises(Refused) as caught:
            parse_identity(raw)
        message = str(caught.exception)
        self.assertIn(rule, message)
        for secret in (*CANARY.values(), *NAMES.values(), *STORES.values(), 'evil'):
            self.assertNotIn(secret, message)

    def test_realistic_literal_configs(self):
        for unit in ROLES:
            with self.subTest(unit=unit):
                self.assertEqual(parse_identity(config(unit)), {
                    'server_name': NAMES[unit], 'store_dir': STORES[unit],
                    'cluster': None if unit == 'nats' else 'openclaw-cluster'})

    def test_comments_and_quoted_literals_do_not_define_identity(self):
        raw = config('nats-2').replace(b'jetstream {', b'''# server_name: evil
// store_dir: /evil
jetstream { # } closing brace inside a comment
  // store: /evil''')
        self.assertEqual(parse_identity(raw)['store_dir'], STORES['nats-2'])

    def test_nested_decoys_and_aliases_refuse(self):
        base = config('nats-2')
        cases = {
            'server_name in cluster': base.replace(b'name: openclaw-cluster', b'name: openclaw-cluster\n  server_name: evil'),
            'store_dir in cluster': base.replace(b'name: openclaw-cluster', b'name: openclaw-cluster\n  store_dir: /evil'),
            'store_dir in a user map': base.replace(b'{user: "openclaw"', b'{store_dir: "/evil", user: "openclaw"'),
            'account jetstream store': base.replace(b'jetstream {', b'accounts { A { jetstream { store_dir: /evil } } }\njetstream {'),
            'top-level store_dir': base.replace(b'jetstream {', b'store_dir: /evil\njetstream {'),
            'top-level storedir alias': base.replace(b'jetstream {', b'storedir: /evil\njetstream {'),
            'top-level store alias': base.replace(b'jetstream {', b'STORE: /evil\njetstream {'),
            'storedir alias': base.replace(b'max_file: 1GB', b'max_file: 1GB\n  storedir: /evil'),
            'store alias only': base.replace(b'store_dir:', b'store:'),
            'case duplicate STORE_DIR': base.replace(b'max_file: 1GB', b'max_file: 1GB\n  STORE_DIR: /evil'),
            'case duplicate server name': base.replace(b'listen: 127', b'Server_Name: evil\nlisten: 127'),
            'second jetstream block': base + b'\njetstream { max_file: 1G }\n',
        }
        for label, raw in cases.items():
            with self.subTest(label):
                self.refuse(raw, 'nats config')

    def test_strict_subset_refusals_never_echo_values(self):
        base = config('nats-3')
        secret = CANARY['nats-3'].encode()
        cases = {
            'include': (base + b'\n# include ./extra.conf\n', 'include'),
            'variable': (base.replace(secret, b'$SECRET'), 'variables'),
            'semicolon': (base.replace(b'max_file: 1GB', b'max_file: 1GB;'), 'separator'),
            'block string': (base.replace(b'max_file: 1GB', b'max_file: (\n1GB\n)'), 'separator'),
            'escape': (base.replace(secret, secret + b'\\"'), 'escaped'),
            'quoted key': (base.replace(b'max_file', b'"max_file"'), 'bare identifier'),
            'CR': (base.replace(b'\n', b'\r\n'), 'CR'),
            'non-ASCII value': (base.replace(secret, secret + 'é'.encode()), 'non-ASCII'),
            'unbalanced': (base.replace(b'jetstream {', b'jetstream {{'), 'nats config line'),
            'unknown jetstream key': (base.replace(b'max_file', b'domain: x\n  max_file'), 'reviewed set'),
            'duplicate plain key': (base.replace(b'http: ', b'listen: 127.0.0.1:1\nhttp: '), 'duplicate key'),
            'bare comment marker': (base.replace(b'max_file: 1GB', b'max_file: 1GB#x'), 'comment marker'),
            'route with path': (base.replace(b'nats-route://127.0.0.1:6210', b'nats-route://127.0.0.1:6210/x'), 'comment marker'),
            'secret on malformed line': (base.replace(b'"openclaw", password: "', b'"openclaw", password: ').replace(secret + b'"', secret + b';'), 'separator'),
            'bare store quote': (base.replace(b'\"' + STORES['nats-3'].encode() + b'\"', STORES['nats-3'].encode() + b"'"), 'quote'),
            'bare store double quote': (base.replace(b'\"' + STORES['nats-3'].encode() + b'\"', STORES['nats-3'].encode() + b'"'), 'quote'),
            'relative store': (base.replace(STORES['nats-3'].encode(), b'jetstream-3'), 'normalized absolute'),
            'non-normal store': (base.replace(STORES['nats-3'].encode(), STORES['nats-3'].encode() + b'/../jetstream-3'), 'normalized absolute'),
            'cluster without name': (base.replace(b'name: openclaw-cluster', b''), 'one name'),
            'oversize': (base + b'#' * (1 << 20), 'bounded'),
        }
        for label, (raw, rule) in cases.items():
            with self.subTest(label):
                self.refuse(raw, rule)


class Capacity(unittest.TestCase):
    """Capacity keys and values pinned to nats-server v2.12.6 opts.go parseJetStream and conf/parse.go."""

    def with_jetstream(self, body):
        return config('nats-1').replace(b'  max_mem: 256MB\n  max_file: 1GB\n', body.encode())

    def refuse(self, raw, rule):
        with self.assertRaises(Refused) as caught:
            parse_identity(raw)
        self.assertIn(rule, str(caught.exception))
        self.assertNotIn(CANARY['nats-1'], str(caught.exception))

    def test_each_source_alias_pair_keeps_identity(self):
        expected = parse_identity(config('nats-1'))
        for memory in ('max_memory_store', 'max_mem_store', 'max_mem', 'MAX_MEM'):
            for file in ('max_file_store', 'max_file', 'Max_File'):
                with self.subTest(memory=memory, file=file):
                    raw = self.with_jetstream(f'  {memory}: 256MB\n  {file} 1GB\n')
                    self.assertEqual(parse_identity(raw), expected)
        self.assertEqual(parse_identity(self.with_jetstream('')), expected)

    def test_aliases_of_one_capacity_collide(self):
        for pair in (('max_mem', 'max_memory_store'), ('max_mem_store', 'max_mem'),
                     ('max_file', 'max_file_store'), ('max_mem', 'MAX_MEM')):
            with self.subTest(pair=pair):
                raw = self.with_jetstream(f'  {pair[0]}: 256MB\n  {pair[1]}: 512MB\n')
                self.refuse(raw, 'duplicate key' if pair[0].lower() == pair[1].lower() else 'capacity set twice')

    def test_capacity_values_are_bare_unsigned_in_range_sizes(self):
        for value in ('0', '256MB', '1GB', '2gb', '512M', '1t', '1073741824', '8388607TB'):
            with self.subTest(accepted=value):
                parse_identity(self.with_jetstream(f'  max_mem: {value}\n'))
        for value in ('"1G"', "'256MB'", '-1', '1.5G', '1PB', '1Gi', '1GiB', '1x', '8388608TB',
                      '9223372036854775808', '{ limit: 1 }', '[1G]', CANARY['nats-1'], 'true'):
            with self.subTest(refused=value):
                self.refuse(self.with_jetstream(f'  max_mem: {value}\n'), 'nats config line')

    def test_scope_is_the_top_level_jetstream_block_only(self):
        expected = parse_identity(config('nats-1'))
        for key in ('max_store', 'max_disk', 'mem', 'domain', 'sync', 'key'):
            with self.subTest(top_level_jetstream=key):
                self.refuse(self.with_jetstream(f'  {key}: 1G\n'), 'reviewed set')
        account = config('nats-1') + b'accounts { A { jetstream { max_mem: 1G, max_store: 1G } } }\n'
        self.assertEqual(parse_identity(account), expected)
        self.refuse(config('nats-1') + b'accounts { A { jetstream { store: 1G } } }\n', 'store directory')


class Bind(unittest.TestCase):
    def refuse(self, prior, table, data, rule):
        with self.assertRaises(Refused) as caught:
            bind(prior, table, data)
        message = str(caught.exception)
        self.assertIn(rule, message)
        for secret in CANARY.values():
            self.assertNotIn(secret, message)

    def test_binds_four_roles_without_filesystem_access(self):
        prior, table, data = fixture()
        with patch('builtins.open', side_effect=AssertionError('read')), \
                patch('os.open', side_effect=AssertionError('read')), \
                patch('os.stat', side_effect=AssertionError('read')):
            bound = bind(prior, table, data)
        self.assertEqual({role: (row['unit'], row['store_dir'], row['held']) for role, row in bound.items()}, {
            'standalone': ('nats', STORES['nats'], False), 'member1': ('nats-1', STORES['nats-1'], True),
            'member2': ('nats-2', STORES['nats-2'], False), 'member3': ('nats-3', STORES['nats-3'], False)})

    def test_consistent_member2_member3_swap_refuses(self):
        swapped = {unit: config(unit) for unit in ROLES}
        swapped['nats-2'] = config('nats-2', store=STORES['nats-3'])
        swapped['nats-3'] = config('nats-3', store=STORES['nats-2'])
        for unit in ('nats-2', 'nats-3'):
            parse_identity(swapped[unit])  # each swapped file is individually well formed
        prior, table, data = fixture(swapped)
        honest = fixture()[1]
        for role in ('member2', 'member3'):
            table[role] = {**honest[role], 'config_sha256': table[role]['config_sha256']}
        self.refuse(prior, table, data, 'nats-2: config identity differs from the pinned member2')
        prior, table, data = fixture(swapped)  # pins recaptured from the swapped files
        table['member2']['store_dir'], table['member3']['store_dir'] = STORES['nats-3'], STORES['nats-2']
        self.refuse(prior, table, data, 'nats-2: store_dir is not the unit store path')

    def test_argv_must_be_the_exact_bound_config_form(self):
        cases = {
            'extra store override': lambda argv: argv + ['-sd', '/evil'],
            'short flag': lambda argv: [argv[0], '-c', argv[2]],
            'other unit config': lambda argv: argv[:2] + [config_path(HOME, 'nats-3')],
            'other binary': lambda argv: ['/usr/local/bin/nats-server'] + argv[1:],
        }
        for label, change in cases.items():
            with self.subTest(label):
                prior, table, data = fixture()
                prior['nats-2']['identity']['argv'] = change(prior['nats-2']['identity']['argv'])
                self.refuse(prior, table, data, 'nats-2: argv is not exactly the bound config form')

    def test_baseline_hash_and_bytes_must_match_the_pin(self):
        prior, table, data = fixture()
        table['member3']['config_sha256'] = 'f' * 64
        self.refuse(prior, table, data, 'nats-3: baseline config hash differs from the window pin')
        prior, table, data = fixture()
        data[config_path(HOME, 'nats-3')] += b'\n'
        self.refuse(prior, table, data, 'nats-3: config bytes differ from the baseline hash')
        prior, table, data = fixture()
        files = prior['nats-3']['identity']['files']
        files['/private' + config_path(HOME, 'nats-3')] = files.pop(config_path(HOME, 'nats-3'))
        self.refuse(prior, table, data, 'nats-3: baseline config hash differs from the window pin')

    def test_only_member1_is_baseline_held(self):
        cases = {
            'member1 serving': ('nats-1', {'class': 'daemon', 'loaded': True, 'running': True, 'disabled': False}),
            'member1 held but loaded': ('nats-1', {'loaded': True}),
            'member1 held but enabled': ('nats-1', {'disabled': False}),
            'member2 held': ('nats-2', {'class': 'held', 'loaded': False, 'running': False, 'disabled': True}),
        }
        for label, (unit, change) in cases.items():
            with self.subTest(label):
                prior, table, data = fixture()
                prior[unit].update(change)
                self.refuse(prior, table, data, unit + ': baseline class differs; only member1 is baseline-held')

    def test_pin_table_and_config_set_are_closed(self):
        cases = {
            'missing role': (lambda p, t, d: t.pop('member3'), 'window pin table'),
            'short hash': (lambda p, t, d: t['member2'].update(config_sha256='abc'), 'window pin table'),
            'standalone in cluster': (lambda p, t, d: t['standalone'].update(cluster='openclaw-cluster'), 'cluster membership'),
            'split cluster': (lambda p, t, d: t['member3'].update(cluster='other'), 'cluster membership'),
            'extra config': (lambda p, t, d: d.update({HOME + '/.openclaw/config/extra.conf': b''}), 'four bound paths'),
            'home outside Users': (lambda p, t, d: None, 'fixed binary and home'),
        }
        for label, (change, rule) in cases.items():
            with self.subTest(label):
                prior, table, data = fixture()
                change(prior, table, data)
                with self.assertRaises(Refused) as caught:
                    bind_identities(prior, table, data, binary=BINARY,
                                    home='/var/owned' if label == 'home outside Users' else HOME)
                self.assertIn(rule, str(caught.exception))

    def test_pinned_identity_must_match_content(self):
        prior, table, data = fixture()
        table['member1'] = {**table['member1'], 'server_name': 'openclaw-nats-9'}
        self.refuse(prior, table, data, 'nats-1: config identity differs from the pinned member1')


if __name__ == '__main__':
    unittest.main()
