"""Scratch review tool: one-rule mutants of the pure stopped-image journal and config reader.

Usage: python3 mutants_reader.py STEP12_DIR

STEP12_DIR is step12_jetstream at 5b6c84af (the reader and both corrections published) with
journal-mount-wrapper-on-5b6c84af.patch applied, which adds the `read` metadata list. Each mutant
deletes or weakens exactly one rule of stopped_journal_inputs.py in a temporary copy, except
dep_allow_nan, which weakens the one preservation_journal.encoded() flag the reader's NaN and
infinity refusals rely on. A mutant is killed for the intended reason when every designated test
fails with its marker and the whole test_stopped_journal_inputs.py fails as well. The marker is
"not raised" (the forgery that only this rule refuses is now accepted) except for the two ordering
rules, whose designated tests remove the image so that reading it before the pins surfaces as a
different refusal ("does not match"), the over-strict evidence mutant, whose positive test must now
refuse ("holds a pending, corrupt-receipt or unknown entry"), and the file-bound order and `read`
metadata mutants, whose tests compare exact counts or rows (" != "). The unmutated copy must pass
every designated test and the whole file first. Exit status 1 names any other outcome.

Not mutated: O_NOFOLLOW and O_NONBLOCK (race guards behind the inode check), the lineage walk's
cycle bound (a cycle needs a hash fixed point), the duplicate-window uniqueness count (a second
match is also an unlinked window) and the stdlib's own JSON parsing.
"""
import concurrent.futures
import pathlib
import shutil
import subprocess
import sys
import tempfile

STEP12 = pathlib.Path(sys.argv[1]).resolve()
READER = 'stopped_journal_inputs.py'
SOURCES = {name: (STEP12 / name).read_text() for name in (READER, 'preservation_journal.py')}
SUITE = 'test_stopped_journal_inputs.py'
R = 'test_stopped_journal_inputs.Refusals.'
C = 'test_stopped_journal_inputs.Composition.'
A = 'test_stopped_journal_inputs.Authentic.'
ACCEPTED = 'not raised'
REORDERED = 'does not match'

# (name, marker, designated test(s), exact source text, its one-rule replacement[, file])
MUTANTS = [
    # The home all four committed store paths name.
    ('home_dots', ACCEPTED, R + 'test_store_paths_must_name_one_fixed_home',
     r"HOME = re.compile(r'/Users/(?!\.\.?$)[A-Za-z0-9._-]+')", r"HOME = re.compile(r'/Users/[A-Za-z0-9._-]+')"),
    ('home_paths', ACCEPTED, R + 'test_store_paths_must_name_one_fixed_home',
     "and paths == {role: store_path(home, unit) for unit, role in ROLES.items()}", "and True"),
    ('home_relative', ACCEPTED, R + 'test_store_paths_must_name_one_fixed_home',
     "and manifest.get('store_relative_paths') == {role: path[1:] for role, path in paths.items()},",
     "and True,"),
    # Fixed paths, real directories, owner-private journal tree.
    ('root_literal', ACCEPTED, R + 'test_root_is_a_literal_absolute_path',
     "require(root.resolve(strict=True) == root,", "require(True,"),
    ('real_dir', ACCEPTED, R + 'test_every_path_component_must_be_a_real_directory',
     "require(stat.S_ISDIR(cursor.lstat().st_mode),", "require(True,"),
    ('dir_mode', ACCEPTED, R + 'test_journal_directories_must_be_owner_private',
     "require(stat.S_ISDIR(info.st_mode) and owned(info, 0o700),",
     "require(stat.S_ISDIR(info.st_mode) and owned(info, None),"),
    ('uid', ACCEPTED, R + 'test_the_owner_must_be_the_reading_user',
     "return info.st_uid == os.getuid() and (mode is None",
     "return (mode is None"),
    ('pres_entries', ACCEPTED, R + 'test_preservation_holds_only_its_receipt_lock_and_journals',
     "require(entries <= PRESERVATION_ENTRIES | EVIDENCE,", "require(True,"),
    # The three census-named retirement records: allowed by exact name, read and counted, ignored.
    ('evidence_allowed', 'holds a pending, corrupt-receipt or unknown entry',
     A + 'test_the_three_retirement_evidence_records_are_checked_and_ignored',
     "require(entries <= PRESERVATION_ENTRIES | EVIDENCE,", "require(entries <= PRESERVATION_ENTRIES,"),
    ('evidence_read', ACCEPTED, R + 'test_evidence_records_are_owner_private_single_link_files_within_the_bounds',
     "        for name in sorted(entries & EVIDENCE):\n            content(preservation / name, 0o600, budget)\n", ""),
    # Lock files: present (each read), empty.
    ('win_lock', ACCEPTED, R + 'test_lock_files_are_present_empty_owner_private_files',
     "    lock(path / '.lock', budget)\n", ""),
    ('pres_lock', ACCEPTED, R + 'test_lock_files_are_present_empty_owner_private_files',
     "        lock(preservation / 'node.lock', budget)\n", ""),
    ('lock_empty', ACCEPTED, R + 'test_lock_files_are_present_empty_owner_private_files',
     "require(content(path, 0o600, budget)[0] == b'', 'journal lock file is not empty: ' + path.name)",
     "content(path, 0o600, budget)"),
    # Window entries, canonical bytes and the hash chain of every window.
    ('win_entries', ACCEPTED, R + 'test_window_holds_only_its_lock_and_records_named_in_sequence',
     "require(all(name == '.lock' or RECORD.fullmatch(name) for name in entries),", "require(True,"),
    ('win_names', ACCEPTED, R + 'test_window_holds_only_its_lock_and_records_named_in_sequence',
     "require(name == '%06d.json' % index,", "require(True,"),
    ('canonical', ACCEPTED, R + 'test_records_and_receipt_must_be_canonical',
     "require(exact, what + ' is not canonical journal JSON')", "require(True, what)"),
    ('dep_allow_nan', ACCEPTED, R + 'test_nan_and_the_infinities_are_refused_as_the_journal_encoding_refuses_them',
     "allow_nan=False).encode()", "allow_nan=True).encode()", 'preservation_journal.py'),
    ('chain_sha', ACCEPTED, R + 'test_every_window_is_hash_chained',
     "require(row.get('sha256') == digest and row.get('sequence') == index",
     "require(row.get('sequence') == index"),
    ('chain_seq', ACCEPTED, R + 'test_every_window_is_hash_chained',
     "require(row.get('sha256') == digest and row.get('sequence') == index",
     "require(row.get('sha256') == digest"),
    ('chain_prev', ACCEPTED, R + 'test_every_window_is_hash_chained',
     "and row.get('previous') == previous,", "and True,"),
    # Selection context: finished siblings and the receipt as consistency evidence.
    ('lin_keys', ACCEPTED, R + 'test_every_other_window_is_a_finished_ancestor_of_the_committed_one',
     "if isinstance(link, dict) and set(link) == {'root', 'head'}", "if isinstance(link, dict)"),
    ('lin_root', ACCEPTED, R + 'test_every_other_window_is_a_finished_ancestor_of_the_committed_one',
     "and link.get('root') == parent + name", "and True"),
    ('lin_head', ACCEPTED, R + 'test_every_other_window_is_a_finished_ancestor_of_the_committed_one',
     "and link.get('head') == rows[-1]['sha256']]", "and True]"),
    ('lin_terminal', ACCEPTED, R + 'test_every_other_window_is_a_finished_ancestor_of_the_committed_one',
     "require(windows[named[0]][-1].get('event') in TERMINAL,", "require(True,"),
    ('lin_cover', ACCEPTED, R + 'test_every_other_window_is_a_finished_ancestor_of_the_committed_one',
     "require(set(chain) == set(windows),", "require(True,"),
    ('rcpt_keys', ACCEPTED, R + 'test_receipt_must_name_the_committed_window_as_unresolved',
     "require(isinstance(receipt, dict) and set(receipt) == RECEIPT_KEYS", "require(isinstance(receipt, dict)"),
    ('rcpt_root', ACCEPTED, R + 'test_receipt_must_name_the_committed_window_as_unresolved',
     "and receipt.get('journal_root') == home + PRESERVATION + '/journals/' + window", "and True"),
    ('rcpt_status', ACCEPTED, R + 'test_receipt_must_name_the_committed_window_as_unresolved',
     "and receipt.get('status') == 'unresolved'", "and True"),
    ('rcpt_phase', ACCEPTED, R + 'test_receipt_must_name_the_committed_window_as_unresolved',
     "and receipt.get('phase') == 'initialized'", "and True"),
    ('rcpt_baseline', ACCEPTED, R + 'test_receipt_must_name_the_committed_window_as_unresolved',
     "and receipt.get('baseline') == records[0],", "and True,"),
    # File reads: checked before the open (regular, single link, owner mode), the same inode
    # opened, bounded. O_NOFOLLOW and O_NONBLOCK are race guards behind the inode check and are
    # not mutated: without a race no test can tell them apart from it.
    ('same_inode', ACCEPTED, R + 'test_the_opened_file_must_be_the_checked_one',
     "require((opened.st_dev, opened.st_ino) == (info.st_dev, info.st_ino),", "require(True,"),
    ('regular', ACCEPTED, R + 'test_files_are_owned_single_link_bounded_regular_files',
     "require(stat.S_ISREG(info.st_mode) and info.st_nlink == 1 and owned(info, mode),",
     "require(info.st_nlink == 1 and owned(info, mode),"),
    ('nlink', ACCEPTED, R + 'test_files_are_owned_single_link_bounded_regular_files',
     "require(stat.S_ISREG(info.st_mode) and info.st_nlink == 1 and owned(info, mode),",
     "require(stat.S_ISREG(info.st_mode) and owned(info, mode),"),
    ('file_mode', ACCEPTED, R + 'test_files_are_owned_single_link_bounded_regular_files',
     "require(stat.S_ISREG(info.st_mode) and info.st_nlink == 1 and owned(info, mode),",
     "require(stat.S_ISREG(info.st_mode) and info.st_nlink == 1 and owned(info, None),"),
    ('size', ACCEPTED, R + 'test_files_are_owned_single_link_bounded_regular_files',
     "require(len(raw) <= LIMIT,", "require(True,"),
    # Bounds: entries per directory and bytes read in all.
    ('entries_bound', ACCEPTED, R + 'test_directory_entries_and_total_reads_are_bounded',
     "require(len(found) <= MAX_ENTRIES,", "require(True,"),
    ('total_bound', ACCEPTED, R + 'test_directory_entries_and_total_reads_are_bounded',
     "require(budget['bytes'] >= 0,", "require(True,"),
    ('files_bound', ACCEPTED, R + 'test_directory_entries_and_total_reads_are_bounded',
     "require(budget['files'] >= 0,", "require(True,"),
    ('files_before_open', ' != ', R + 'test_directory_entries_and_total_reads_are_bounded',
     "    budget['files'] -= 1\n    require(budget['files'] >= 0, 'stopped image reads exceed their file bound at: ' + path.name)\n    info = path.lstat()\n    require(stat.S_ISREG(info.st_mode) and info.st_nlink == 1 and owned(info, mode),\n            'stopped image file is not an owned single-link regular file: ' + path.name)\n    # Race guards only: O_NOFOLLOW and O_NONBLOCK keep a swapped-in link or FIFO from being followed\n    # or blocking before the inode check refuses it.\n    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)\n    try:\n        opened = os.fstat(fd)\n        require((opened.st_dev, opened.st_ino) == (info.st_dev, info.st_ino),\n                'stopped image file changed while it was read: ' + path.name)\n        with os.fdopen(os.dup(fd), 'rb') as handle:\n            raw = handle.read(LIMIT + 1)\n    finally:\n        os.close(fd)\n    require(len(raw) <= LIMIT, 'stopped image file exceeds its size bound: ' + path.name)\n    budget['bytes'] -= len(raw)\n    require(budget['bytes'] >= 0, 'stopped image reads exceed their total bound at: ' + path.name)\n",
     "    info = path.lstat()\n    require(stat.S_ISREG(info.st_mode) and info.st_nlink == 1 and owned(info, mode),\n            'stopped image file is not an owned single-link regular file: ' + path.name)\n    # Race guards only: O_NOFOLLOW and O_NONBLOCK keep a swapped-in link or FIFO from being followed\n    # or blocking before the inode check refuses it.\n    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)\n    try:\n        opened = os.fstat(fd)\n        require((opened.st_dev, opened.st_ino) == (info.st_dev, info.st_ino),\n                'stopped image file changed while it was read: ' + path.name)\n        with os.fdopen(os.dup(fd), 'rb') as handle:\n            raw = handle.read(LIMIT + 1)\n    finally:\n        os.close(fd)\n    require(len(raw) <= LIMIT, 'stopped image file exceeds its size bound: ' + path.name)\n    budget['bytes'] -= len(raw)\n    require(budget['bytes'] >= 0, 'stopped image reads exceed their total bound at: ' + path.name)\n    budget['files'] -= 1\n    require(budget['files'] >= 0, 'stopped image reads exceed their file bound at: ' + path.name)\n"),
    # The metadata of every file actually read, relative to the root, for the mount receipt.
    ('read_record', ' != ', A + 'test_read_lists_the_metadata_of_every_file_actually_read_relative_to_the_root',
     "    budget['read'].append({'path': str(path), 'size': len(raw), 'mode': stat.S_IMODE(info.st_mode),\n"
     "                           'uid': info.st_uid, 'nlink': info.st_nlink, 'device': info.st_dev,\n"
     "                           'inode': info.st_ino, 'sha256': hashlib.sha256(raw).hexdigest()})\n", ""),
    ('read_digest', ' != ', A + 'test_read_lists_the_metadata_of_every_file_actually_read_relative_to_the_root',
     "'inode': info.st_ino, 'sha256': hashlib.sha256(raw).hexdigest()})",
     "'inode': info.st_ino, 'sha256': hashlib.sha256(b'').hexdigest()})"),
    ('read_relative', ' != ', A + 'test_read_lists_the_metadata_of_every_file_actually_read_relative_to_the_root',
     "'read': [{**row, 'path': str(pathlib.Path(row['path']).relative_to(root))}",
     "'read': [{**row, 'path': row['path']}"),
    ('read_returned', ' != ', A + 'test_frozen_checkpoint_verifies_from_the_stopped_image_and_host_pins_only',
     "'config_modes': found['config_modes'], 'read': found['read']}", "'config_modes': found['config_modes'], 'read': []}"),
    # The baseline binary.
    ('binary', ACCEPTED, R + 'test_baseline_must_name_one_binary_for_all_four_units',
     "require(len(binaries) == 1,", "require(True,"),
    # D189 order: the pinned commitment, and only it, before anything in the image is read.
    ('pins_first', REORDERED, C + 'test_capture_pins_come_before_the_image_is_read',
     "    pinned = require_captured(capture_dir)\n    commitment = require_committed(capture_dir)\n"
     "    require(commitment == {**json.loads(pinned['COMMITTED.json']),\n"
     "                           'checkpoint': json.loads(pinned['CHECKPOINT.json'])},\n"
     "            'capture commitment differs from the pinned capture record')\n",
     "    commitment = require_committed(capture_dir)\n"),
    ('pinned_equal', REORDERED, C + 'test_only_the_pinned_commitment_selects_a_window',
     "    require(commitment == {**json.loads(pinned['COMMITTED.json']),\n"
     "                           'checkpoint': json.loads(pinned['CHECKPOINT.json'])},\n"
     "            'capture commitment differs from the pinned capture record')\n", ""),
]


def run(changed, *args):
    with tempfile.TemporaryDirectory(prefix='reader-mutant-') as temporary:
        copy = pathlib.Path(temporary) / 'step12'
        shutil.copytree(STEP12, copy, ignore=shutil.ignore_patterns('__pycache__'))
        for name, source in changed.items():
            (copy / name).write_text(source)
        done = subprocess.run([sys.executable, '-B', *args], cwd=copy, capture_output=True, text=True,
                              timeout=1200)
        return done.returncode, done.stderr


def parts(mutant):
    """name, marker, designated tests, old, new, target file."""
    target = mutant[-1] if mutant[-1] in SOURCES else READER
    body = mutant[:-1] if mutant[-1] in SOURCES else mutant
    return body[0], body[1], body[2:-2], body[-2], body[-1], target


def judge(mutant):
    name, marker, tests, old, new, target = parts(mutant)
    source = SOURCES[target]
    if source.count(old) != 1:
        return name, 'ANCHOR(%d)' % source.count(old), ''
    mutated = {target: source.replace(old, new)}
    results = []
    for test in tests:
        code, output = run(mutated, '-m', 'unittest', test)
        results.append((test.rsplit('.', 1)[1], code, output.count(marker)))
    whole, _ = run(mutated, SUITE)
    detail = '; '.join('%s: "%s" in %d case(s)' % (test, marker, count) for test, _, count in results)
    if whole and all(code and count for _, code, count in results):
        return name, 'KILLED', detail
    return name, 'PROBLEM', 'whole rc=%d; %s' % (whole, '; '.join(
        '%s rc=%d marker=%d' % result for result in results))


if __name__ == '__main__':
    problems = []
    code, output = run({}, SUITE)
    print('unmutated %s:' % SUITE, 'PASS' if code == 0 else 'FAIL', output.strip().splitlines()[-1])
    if code:
        problems.append('unmutated suite fails')
    for test in sorted({test for mutant in MUTANTS for test in parts(mutant)[2]}):
        code, _ = run({}, '-m', 'unittest', test)
        if code:
            problems.append('unmutated designated test fails: ' + test)
    with concurrent.futures.ThreadPoolExecutor(4) as pool:
        for name, status, detail in pool.map(judge, MUTANTS):
            print('%-14s %-8s %s' % (name, status, detail), flush=True)
            if status != 'KILLED':
                problems.append(name)
    print('problems:', problems)
    sys.exit(1 if problems else 0)
