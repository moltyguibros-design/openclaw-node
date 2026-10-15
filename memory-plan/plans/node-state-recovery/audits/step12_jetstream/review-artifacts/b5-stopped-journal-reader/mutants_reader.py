"""Scratch review tool: one-rule mutants of the pure stopped-image journal and config reader.

Usage: python3 mutants_reader.py STEP12_DIR

STEP12_DIR is step12_jetstream with stopped-journal-reader-on-bae1d9ff.patch applied. Each mutant
deletes or weakens exactly one rule of stopped_journal_inputs.py in a temporary copy. A mutant is
killed for the intended reason when every designated test fails with its marker and the whole
test_stopped_journal_inputs.py fails as well. The marker is "not raised" (the forgery that only
this rule refuses is now accepted) except for the two ordering rules, whose designated tests
remove the image so that reading it before the pins surfaces as a different refusal ("does not
match"). The unmutated copy must pass every designated test and the whole file first. Exit
status 1 names any other outcome.
"""
import concurrent.futures
import pathlib
import shutil
import subprocess
import sys
import tempfile

STEP12 = pathlib.Path(sys.argv[1]).resolve()
SOURCE = (STEP12 / 'stopped_journal_inputs.py').read_text()
SUITE = 'test_stopped_journal_inputs.py'
R = 'test_stopped_journal_inputs.Refusals.'
C = 'test_stopped_journal_inputs.Composition.'
ACCEPTED = 'not raised'
REORDERED = 'does not match'

# (name, marker, designated test(s), exact source text, its one-rule replacement)
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
    ('real_dir', ACCEPTED, R + 'test_every_path_component_must_be_a_real_directory',
     "require(stat.S_ISDIR(cursor.lstat().st_mode),", "require(True,"),
    ('dir_mode', ACCEPTED, R + 'test_journal_directories_must_be_owner_private',
     "require(stat.S_ISDIR(info.st_mode) and owned(info, 0o700),",
     "require(stat.S_ISDIR(info.st_mode) and owned(info, None),"),
    ('uid', ACCEPTED, R + 'test_the_owner_must_be_the_reading_user',
     "return info.st_uid == os.getuid() and (mode is None",
     "return (mode is None"),
    ('pres_entries', ACCEPTED, R + 'test_preservation_holds_only_its_receipt_lock_and_journals',
     "require(set(names(preservation)) <= PRESERVATION_ENTRIES,", "require(True,"),
    # Window entries, canonical bytes and the hash chain of every window.
    ('win_entries', ACCEPTED, R + 'test_window_holds_only_its_lock_and_records_named_in_sequence',
     "require(all(name == '.lock' or RECORD.fullmatch(name) for name in entries),", "require(True,"),
    ('win_names', ACCEPTED, R + 'test_window_holds_only_its_lock_and_records_named_in_sequence',
     "require(name == '%06d.json' % index,", "require(True,"),
    ('canonical', ACCEPTED, R + 'test_records_and_receipt_must_be_canonical',
     "require(exact, what + ' is not canonical journal JSON')", "require(True, what)"),
    ('chain_sha', ACCEPTED, R + 'test_every_window_is_hash_chained',
     "require(row.get('sha256') == digest and row.get('sequence') == index",
     "require(row.get('sequence') == index"),
    ('chain_seq', ACCEPTED, R + 'test_every_window_is_hash_chained',
     "require(row.get('sha256') == digest and row.get('sequence') == index",
     "require(row.get('sha256') == digest"),
    ('chain_prev', ACCEPTED, R + 'test_every_window_is_hash_chained',
     "and row.get('previous') == previous,", "and True,"),
    # Selection context: finished siblings and the receipt as consistency evidence.
    ('siblings', ACCEPTED, R + 'test_other_windows_must_be_finished',
     "require(all(rows[-1].get('event') in TERMINAL for name, rows in windows.items() if name != window),",
     "require(True,"),
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


def run(source, *args):
    with tempfile.TemporaryDirectory(prefix='reader-mutant-') as temporary:
        copy = pathlib.Path(temporary) / 'step12'
        shutil.copytree(STEP12, copy, ignore=shutil.ignore_patterns('__pycache__'))
        (copy / 'stopped_journal_inputs.py').write_text(source)
        done = subprocess.run([sys.executable, '-B', *args], cwd=copy, capture_output=True, text=True,
                              timeout=1200)
        return done.returncode, done.stderr


def judge(mutant):
    name, marker, tests, old, new = mutant[0], mutant[1], mutant[2:-2], mutant[-2], mutant[-1]
    if SOURCE.count(old) != 1:
        return name, 'ANCHOR(%d)' % SOURCE.count(old), ''
    mutated = SOURCE.replace(old, new)
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
    code, output = run(SOURCE, SUITE)
    print('unmutated %s:' % SUITE, 'PASS' if code == 0 else 'FAIL', output.strip().splitlines()[-1])
    if code:
        problems.append('unmutated suite fails')
    for test in sorted({test for mutant in MUTANTS for test in mutant[2:-2]}):
        code, _ = run(SOURCE, '-m', 'unittest', test)
        if code:
            problems.append('unmutated designated test fails: ' + test)
    with concurrent.futures.ThreadPoolExecutor(4) as pool:
        for name, status, detail in pool.map(judge, MUTANTS):
            print('%-14s %-8s %s' % (name, status, detail), flush=True)
            if status != 'KILLED':
                problems.append(name)
    print('problems:', problems)
    sys.exit(1 if problems else 0)
