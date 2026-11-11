"""Scratch review tool: one-rule mutants of the shared capture-checkpoint predicate.

Usage: python3 mutants_predicate.py STEP12_DIR

STEP12_DIR is step12_jetstream with test-capture-checkpoint-decisive-on-586f66b7.patch applied; the
patch changes tests only. Each mutant deletes or weakens exactly one rule of
preservation_journal.py in a temporary copy. A mutant is killed for the intended reason when its
designated test fails with "Refused not raised", i.e. the forgery that only this rule refuses is
now accepted (every designated test separately, when a rule has a writer and a frozen test), and
the whole test_capture_checkpoint.py fails as well. The unmutated copy must pass
every designated test and the whole file first. Exit status 1 names any other outcome.
"""
import concurrent.futures
import pathlib
import shutil
import subprocess
import sys
import tempfile

STEP12 = pathlib.Path(sys.argv[1]).resolve()
SOURCE = (STEP12 / 'preservation_journal.py').read_text()
D = 'test_capture_checkpoint.Decisive.'
I20 = ' ' * 20

# (name, designated test(s), exact source text, its one-rule replacement)
MUTANTS = [
    # Hash chain: the previous link and the row index.
    ('v_prev', D + 'test_chain_rows_must_link_to_their_predecessor',
     "and row.get('sequence') == index and row.get('previous') == previous,", "and row.get('sequence') == index,"),
    ('v_seq', D + 'test_chain_sequence_must_be_the_row_index',
     "and row.get('sequence') == index and row.get('previous') == previous,", "and row.get('previous') == previous,"),
    # The execution hold leaves launchd state unchanged.
    ('anchor_launchd', D + 'test_execution_hold_must_leave_launchd_state_unchanged',
     "require(after_loaded == loaded and after_overrides == overrides,", "require(True,"),
    # Receipts and the publication close their own intent; the anchor is the scheduler hold.
    ('ver_intent', D + 'test_receipts_and_publication_close_their_own_intent',
     "require(open_intent is not None and row.get('intent') == open_intent['sequence']\n",
     "require(open_intent is not None\n"),
    ('ver_unit', D + 'test_receipts_and_publication_close_their_own_intent',
     "and row.get('unit') == open_intent.get('unit')", "and True"),
    ('ver_action', D + 'test_receipts_and_publication_close_their_own_intent',
     "and row.get('action') == open_intent.get('action'),", "and True,"),
    ('pub_intent_seq', D + 'test_receipts_and_publication_close_their_own_intent',
     "and len(intents) == 1 and not published\n" + I20 + "and row.get('intent') == open_intent['sequence'],",
     "and len(intents) == 1 and not published\n" + I20 + "and True,"),
    ('pub_len_intents', D + 'test_receipts_and_publication_close_their_own_intent',
     "and len(intents) == 1 and not published", "and not published"),
    ('anchor_unit', D + 'test_anchor_is_the_scheduler_close_execution_hold',
     "require(anchor.get('unit') == 'scheduler-heartbeat'", "require(True"),
    ('anchor_action', D + 'test_anchor_is_the_scheduler_close_execution_hold',
     "and anchor.get('action') == 'close-execution-hold'", "and True"),
    # Stops: one disable-and-unload each, listener first.
    ('stop_action', D + 'test_stops_are_one_disable_and_unload_each_listener_first',
     "require(all(row.get('action') == 'disable-and-unload' for row in stops)\n", "require(True\n"),
    ('stop_unique', D + 'test_stops_are_one_disable_and_unload_each_listener_first',
     "and len(set(units)) == len(units) and set(units)", "and set(units)"),
    ('listener_first', D + 'test_stops_are_one_disable_and_unload_each_listener_first',
     "require(units[0] == 'mesh-deploy-listener' and set(units[first:])", "require(set(units[first:])"),
    # Each stop persistently disables its own label in every domain.
    ('cont_user', D + 'test_each_stop_disables_its_own_label_in_every_domain',
     "and after_overrides['user'].get(label) is True", "and True"),
    ('cont_system', D + 'test_each_stop_disables_its_own_label_in_every_domain',
     "and after_overrides['system'].get(label) is not False", "and True"),
    ('cont_label_val', D + 'test_each_stop_disables_its_own_label_in_every_domain',
     "and after_overrides[domain].get(label) in (overrides[domain].get(label), True)", "and True"),
    # Member1 (and every unloaded unit) is observed unchanged in every field.
    ('obs_unloaded_disabled', D + 'test_member1_observation_must_be_unchanged_in_every_field', D + 'test_frozen_member1_observation_must_be_unchanged_in_every_field',
     "return all(actual[key] == prior[key] for key in ('loaded', 'running', 'disabled'))",
     "return all(actual[key] == prior[key] for key in ('loaded', 'running'))"),
    ('obs_unloaded_running', D + 'test_member1_observation_must_be_unchanged_in_every_field', D + 'test_frozen_member1_observation_must_be_unchanged_in_every_field',
     "return all(actual[key] == prior[key] for key in ('loaded', 'running', 'disabled'))",
     "return all(actual[key] == prior[key] for key in ('loaded', 'disabled'))"),
    # Lower-value checks: checkpoint fields, baseline, manifest roles, durable journal.
    ('v_epoverrides', D + 'test_checkpoint_entrypoint_state_and_observed_units_are_rederived',
     "and checkpoint['entrypoint_overrides'] == cohort['overrides'],", "and True,"),
    ('v_obs_set', D + 'test_checkpoint_entrypoint_state_and_observed_units_are_rederived',
     "require(isinstance(observations, dict) and set(observations) == set(cohort['prior'])",
     "require(isinstance(observations, dict)"),
    ('cohort_baseline_scope', D + 'test_baseline_must_be_the_full_node_inventory',
     "require(baseline.get('event') == 'baseline' and baseline.get('scope') == FULL_NODE_SCOPE,",
     "require(baseline.get('event') == 'baseline',"),
    ('cohort_inventory', D + 'test_baseline_must_be_the_full_node_inventory',
     "    valid_entrypoint_inventory(inventory, prior)\n    require(all(row.get('boot')",
     "    require(all(row.get('boot')"),
    ('manifest_roles', D + 'test_manifest_roles_are_exactly_the_bound_roles',
     "and set(seen[key]) == set(identities)", "and True"),
    ('w_read', D + 'test_durable_record_beyond_memory_refuses_without_overwrite',
     "require(self._read() == self.records, 'capture checkpoint requires the exact durable journal')",
     "require(True, 'capture checkpoint requires the exact durable journal')"),
    # Session controls already pinned before this patch; listed so a regression shows here too.
    ('orig_session', 'test_capture_checkpoint.LiveGate.test_forged_original_anchor_flags_refuse',
     "require(isinstance(session, str) and session and valid_execution_hold(original, session),",
     "require(isinstance(session, str) and session,"),
    ('orig_receipt', 'test_capture_checkpoint.LiveGate.test_forged_original_anchor_flags_refuse',
     "require(original.get('receipt') == receipt,", "require(True,"),
    ('stop_hold', 'test_capture_checkpoint.LiveGate.test_receipt_hold_session_is_checked_for_each_stop_class',
     "and original_hold(evidence.get('execution_hold'), session, receipt),", "and True,"),
    ('orighold_receipt', 'test_capture_checkpoint.LiveGate.test_receipt_hold_session_is_checked_for_each_stop_class',
     "return valid_execution_hold(certificate, session) and certificate.get('receipt') == receipt",
     "return valid_execution_hold(certificate, session)"),
]


def run(source, *args):
    with tempfile.TemporaryDirectory(prefix='predicate-mutant-') as temporary:
        copy = pathlib.Path(temporary) / 'step12'
        shutil.copytree(STEP12, copy, ignore=shutil.ignore_patterns('__pycache__'))
        (copy / 'preservation_journal.py').write_text(source)
        done = subprocess.run([sys.executable, '-B', *args], cwd=copy, capture_output=True, text=True,
                              timeout=1200)
        return done.returncode, done.stderr


def judge(mutant):
    name, tests, old, new = mutant[0], mutant[1:-2], mutant[-2], mutant[-1]
    if SOURCE.count(old) != 1:
        return name, 'ANCHOR(%d)' % SOURCE.count(old), ''
    mutated = SOURCE.replace(old, new)
    results = []
    for test in tests:
        code, output = run(mutated, '-m', 'unittest', test)
        results.append((test.rsplit('.', 1)[1], code, output.count('Refused not raised')))
    whole, _ = run(mutated, 'test_capture_checkpoint.py')
    detail = '; '.join('%s: forgery accepted in %d case(s)' % (test, accepted) for test, _, accepted in results)
    if whole and all(code and accepted for _, code, accepted in results):
        return name, 'KILLED', detail
    return name, 'PROBLEM', 'whole rc=%d; %s' % (whole, '; '.join(
        '%s rc=%d accepted=%d' % result for result in results))


if __name__ == '__main__':
    problems = []
    code, output = run(SOURCE, 'test_capture_checkpoint.py')
    print('unmutated test_capture_checkpoint.py:', 'PASS' if code == 0 else 'FAIL', output.strip().splitlines()[-1])
    if code:
        problems.append('unmutated suite fails')
    for test in sorted({test for mutant in MUTANTS for test in mutant[1:-2]}):
        code, _ = run(SOURCE, '-m', 'unittest', test)
        if code:
            problems.append('unmutated designated test fails: ' + test)
    with concurrent.futures.ThreadPoolExecutor(4) as pool:
        for name, status, detail in pool.map(judge, MUTANTS):
            print('%-22s %-8s %s' % (name, status, detail), flush=True)
            if status != 'KILLED':
                problems.append(name)
    print('problems:', problems)
    sys.exit(1 if problems else 0)
