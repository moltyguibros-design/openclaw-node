"""Strict identity reader and role binder for the four literal legacy NATS configs (proposal).

parse_identity() is pure: it takes config bytes and returns only server_name, store_dir and the
cluster name. It accepts a deliberately small subset of NATS config syntax and refuses everything
else; it is not a NATS parser and does not claim equivalence with nats-server. Refusals name a line
and a rule, never a config value.

bind_identities() is also pure: the caller reads the config bytes. A role comes from the unit,
never from content; content must then equal the baseline and the window pin for that role.
"""
import hashlib
import posixpath
import re

from preservation_checks import Refused, require

ROLES = {'nats': 'standalone', 'nats-1': 'member1', 'nats-2': 'member2', 'nats-3': 'member3'}
IDENTITY = ('server_name', 'store_dir', 'cluster')
# nats-server reads the JetStream store from store_dir, storedir or store (also at top level),
# with keys compared case-insensitively; any of them outside jetstream.store_dir is refused.
STORE_KEYS = frozenset(('store', 'store_dir', 'storedir'))
# nats-server v2.12.6 server/opts.go parseJetStream: the only capacity aliases, matched case-insensitively.
CAPACITY = {'max_memory_store': 'memory', 'max_mem_store': 'memory', 'max_mem': 'memory',
            'max_file_store': 'file', 'max_file': 'file'}
JETSTREAM_KEYS = frozenset(('store_dir', *CAPACITY))
# v2.12.6 conf/parse.go integer suffixes, restricted to unsigned K/M/G/T with an optional B.
SIZE = re.compile(r'([0-9]{1,19})([kmgt]b?)?', re.IGNORECASE)
MULTIPLIER = {'': 1, 'k': 10 ** 3, 'kb': 1 << 10, 'm': 10 ** 6, 'mb': 1 << 20,
              'g': 10 ** 9, 'gb': 1 << 30, 't': 10 ** 12, 'tb': 1 << 40}
LIMIT = 1 << 20
KEY = re.compile(r'[A-Za-z_][A-Za-z0-9_]*')
URL = re.compile(r'[a-z][a-z-]*://[^/\s]+')
NAME = re.compile(r'[A-Za-z0-9._-]{1,128}')
DIGEST = re.compile(r'[0-9a-f]{64}')
BARE_END = frozenset(' \t\n,}]')


class _Reader:
    def __init__(self, text):
        self.text, self.at, self.line = text, 0, 1

    def peek(self):
        return self.text[self.at] if self.at < len(self.text) else ''

    def fail(self, rule):
        raise Refused(f'nats config line {self.line}: {rule}')

    def skip(self, newlines=True):
        while self.at < len(self.text):
            char = self.text[self.at]
            if char == '#' or self.text.startswith('//', self.at):
                end = self.text.find('\n', self.at)
                end = len(self.text) if end < 0 else end
                if any(ord(c) > 127 and c != '—' for c in self.text[self.at:end]):
                    self.fail('non-ASCII comment text')
                self.at = end
            elif char in ' \t' or newlines and char == '\n':
                self.line += char == '\n'
                self.at += 1
            else:
                return

    def scalar(self):
        quote = self.peek()
        quoted = quote in ('"', "'")
        if quoted:
            end = self.text.find(quote, self.at + 1)
            if end < 0 or '\n' in self.text[self.at + 1:end]:
                self.fail('unterminated string')
            value = self.text[self.at + 1:end]
            self.at = end + 1
        else:
            start = self.at
            while self.at < len(self.text) and self.text[self.at] not in BARE_END:
                self.at += 1
            value = self.text[start:self.at]
            if not value:
                self.fail('missing value')
            if any(c in value for c in '#;()') or '//' in value and not URL.fullmatch(value):
                self.fail('separator, block or comment marker inside a bare value')
        if '\\' in value or not value.isascii():
            self.fail('escaped or non-ASCII value')
        return ('scalar', value, quoted)

    def value(self, depth):
        if depth > 8:
            self.fail('nesting too deep')
        if self.peek() == '{':
            self.at += 1
            return ('map', self.entries(depth + 1, '}'))
        if self.peek() != '[':
            return self.scalar()
        self.at += 1
        items = []
        while True:
            self.skip()
            if self.peek() == ']':
                self.at += 1
                return ('array', items)
            if not self.peek():
                self.fail('unbalanced array')
            items.append(self.value(depth + 1))
            self.skip()
            if self.peek() == ',':
                self.at += 1

    def entries(self, depth, closing):
        entries = []
        while True:
            self.skip()
            if self.peek() == closing:
                self.at += len(closing)
                return entries
            if not self.peek():
                self.fail('unbalanced block')
            match = KEY.match(self.text, self.at)
            if match is None:
                self.fail('key is not a bare identifier')
            line = self.line
            self.at = match.end()
            self.skip(newlines=False)
            if self.peek() in (':', '='):
                self.at += 1
                self.skip(newlines=False)
            entries.append((match.group().lower(), self.value(depth), line))
            self.skip(newlines=False)
            if self.peek() == ',':
                self.at += 1
            elif self.peek() not in ('\n', closing):
                self.fail('trailing content after a value')


def parse_identity(config_bytes):
    require(isinstance(config_bytes, bytes) and len(config_bytes) <= LIMIT, 'nats config is not bounded bytes')
    try:
        text = config_bytes.decode('utf-8')
    except UnicodeDecodeError:
        raise Refused('nats config is not UTF-8') from None
    require('\r' not in text and '\0' not in text, 'nats config contains CR or NUL')
    require('$' not in text and 'include' not in text.lower(), 'nats config uses variables or include')
    top = _Reader(text).entries(0, '')
    names, stores, cluster_names = [], [], []

    def walk(entries, path):
        keys = [key for key, _, _ in entries]
        capacities = set()
        for key, value, line in entries:
            require(keys.count(key) == 1, f'nats config line {line}: duplicate key in one block')
            here = path + (key,)
            if path == ('jetstream',):
                require(key in JETSTREAM_KEYS, f'nats config line {line}: jetstream key outside the reviewed set')
            if path == ('jetstream',) and key in CAPACITY:
                # Aliases share one setting and Go map order picks the winner, so one alias per capacity.
                require(CAPACITY[key] not in capacities, f'nats config line {line}: capacity set twice by aliases')
                capacities.add(CAPACITY[key])
                size = SIZE.fullmatch(value[1]) if value[0] == 'scalar' and not value[2] else None
                require(size is not None and int(size[1]) * MULTIPLIER[(size[2] or '').lower()] < 1 << 63,
                        f'nats config line {line}: capacity is not a bare in-range size')
            if key == 'server_name':
                names.append((here, value))
            if key in STORE_KEYS:
                stores.append((here, value))
            if here == ('cluster', 'name'):
                cluster_names.append(value)
            visit(value, here)

    def visit(value, path):
        if value[0] == 'map':
            walk(value[1], path)
        elif value[0] == 'array':
            for item in value[1]:
                visit(item, path + ('[]',))

    walk(top, ())
    require(len(names) == 1 and names[0][0] == ('server_name',), 'nats config: server_name must appear once, at top level')
    require(len(stores) == 1 and stores[0][0] == ('jetstream', 'store_dir'),
            'nats config: store directory must appear once, as jetstream.store_dir')
    clusters = [value for key, value, _ in top if key == 'cluster']
    require(all(value[0] == 'map' for value in clusters) and len(cluster_names) == len(clusters),
            'nats config: cluster must be a block with one name')
    name, store = names[0][1], stores[0][1]
    require(name[0] == 'scalar' and NAME.fullmatch(name[1]), 'nats config: server_name shape')
    require(store[0] == 'scalar' and store[1].startswith('/') and not store[1].startswith('//')
            and posixpath.normpath(store[1]) == store[1] and not any(c.isspace() for c in store[1]),
            'nats config: store_dir is not a normalized absolute path')
    cluster = None
    if cluster_names:
        require(cluster_names[0][0] == 'scalar' and NAME.fullmatch(cluster_names[0][1]), 'nats config: cluster name shape')
        cluster = cluster_names[0][1]
    return {'server_name': name[1], 'store_dir': store[1], 'cluster': cluster}


def config_path(home, unit):
    return home + '/.openclaw/config/' + unit + '.conf'


# Each unit owns its suffixed store (node census naming); a pin table cannot reassign it.
def store_path(home, unit):
    return home + '/.openclaw/nats/' + ('jetstream' if unit == 'nats' else 'jetstream-' + unit[-1])


def bind_identities(prior, table, configs, *, binary, home):
    """Bind each NATS unit to its role through baseline argv and hash plus the window pin table.

    prior: the journal baseline prior; table: role -> {config_sha256, server_name, store_dir, cluster};
    configs: literal config path -> bytes the caller read. member1 is bound from baseline-held
    evidence only: no live interpretation, no stop receipt.
    """
    require(isinstance(binary, str) and binary.startswith('/')
            and isinstance(home, str) and re.fullmatch(r'/Users/[A-Za-z0-9._-]+', home),
            'binding needs the fixed binary and home')
    require(isinstance(table, dict) and set(table) == set(ROLES.values())
            and all(isinstance(pin, dict) and set(pin) == {'config_sha256', *IDENTITY}
                    and isinstance(pin['config_sha256'], str) and DIGEST.fullmatch(pin['config_sha256'])
                    for pin in table.values()), 'window pin table is incomplete or malformed')
    members = {table[role]['cluster'] for role in ('member1', 'member2', 'member3')}
    require(table['standalone']['cluster'] is None and len(members) == 1 and None not in members,
            'window pins disagree on cluster membership')
    require(isinstance(configs, dict) and set(configs) == {config_path(home, unit) for unit in ROLES},
            'config bytes are not exactly the four bound paths')
    bound = {}
    for unit, role in ROLES.items():
        saved = prior.get(unit) if isinstance(prior, dict) else None
        identity = saved.get('identity') if isinstance(saved, dict) else None
        require(isinstance(identity, dict) and isinstance(identity.get('files'), dict),
                unit + ': baseline identity is absent')
        held = role == 'member1'
        require((saved.get('class'), saved.get('loaded'), saved.get('running'), saved.get('disabled'))
                == (('held', False, False, True) if held else ('daemon', True, True, False)),
                unit + ': baseline class differs; only member1 is baseline-held')
        config = config_path(home, unit)
        require(identity.get('argv') == [binary, '--config', config],
                unit + ': argv is not exactly the bound config form')
        digest = identity['files'].get(config)
        require(digest == table[role]['config_sha256'], unit + ': baseline config hash differs from the window pin')
        raw = configs[config]
        require(isinstance(raw, bytes) and hashlib.sha256(raw).hexdigest() == digest,
                unit + ': config bytes differ from the baseline hash')
        parsed = parse_identity(raw)
        require(parsed == {key: table[role][key] for key in IDENTITY},
                unit + ': config identity differs from the pinned ' + role)
        require(parsed['store_dir'] == store_path(home, unit), unit + ': store_dir is not the unit store path')
        bound[role] = {'unit': unit, 'config': config, 'config_sha256': digest, 'held': held, **parsed}
    require(len({row['server_name'] for row in bound.values()}) == len(bound), 'server names are not distinct')
    return bound
