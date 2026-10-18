#!/usr/bin/env python3
"""Owned in-memory decision faults; each must fail its designated assertion, never test setup."""
import pathlib
import subprocess
import sys
STEP = pathlib.Path(__file__).resolve().parent
PREFIX = 'test_host_boot_decision.BootDecision.'
MUTANTS = (
    ('stored-sample-binding-skipped', 'host_vm_reconcile',
     "    for files in samples.values():\n        sample_binding(json.loads(files['preflight.json']), initial, json.loads(evidence[host_spec]))\n",
     '    pass\n', 1, 'test_verifier_rebound_stored_sample_requires_original_host', 'RuntimeError not raised', False),
    ('decision-to-intent-binding-skipped', 'host_vm_reconcile',
     "decision == {**intent, 'scope': RESTORE_PRIOR_SCOPE, 'at_utc': decision['at_utc'],\n            'intent_sha256': hashlib.sha256(intent_raw).hexdigest(),\n            'decision_sample_sha256': hashes(samples['decision'])}",
     'True', 1, 'test_verifier_decision_must_bind_intent', 'RuntimeError not raised', False),
    ('claim-nonce-binding-skipped', 'restore_only',
     "('capture_nonce', 'capture_nonce')", "('journal_head', 'pre_head')", 1,
     'test_claim_independent_nonce_arm_and_checkpoint_bindings', 'RuntimeError not raised', False),
    ('claim-arm-binding-skipped', 'restore_only',
     "('arm_sha256', 'arm_sha256')", "('journal_head', 'pre_head')", 1,
     'test_claim_independent_nonce_arm_and_checkpoint_bindings', 'RuntimeError not raised', False),
    ('claim-checkpoint-binding-skipped', 'restore_only',
     "('checkpoint_sha256', 'sha256')", "('journal_head', 'pre_head')", 1,
     'test_claim_intact_changed_checkpoint_digest_refuses', 'RuntimeError not raised', False),
    ('claim-previous-binding-skipped', 'restore_only',
     "and checkpoint['previous'] == checkpoint['pre_head']", 'and True', 1,
     'test_claim_previous_must_equal_prehead_independently', 'RuntimeError not raised', False),
    ('claim-released-flags-schema-skipped', 'host_vm_reconcile',
     "and not source['flags'] & stat.UF_IMMUTABLE", 'and True', 1,
     'test_claim_released_flags_must_be_clear', 'RuntimeError not raised', False),
    ('intent-evidence-binding-skipped', 'host_vm_reconcile',
     "intent == boot_intent(host_spec, capture_dir, evidence, samples['verify'])",
     'True', 1, 'test_verifier_rejects_rebound_evidence_table', 'RuntimeError not raised', False),
    ('original-barrier-skipped', 'host_vm_reconcile',
     '            durable_evidence(transcript)\n', '            pass\n', 1,
     'test_original_barrier_failure_precedes_intent', 'OSError not raised', True),
    ('decision-sample-barrier-skipped', 'host_vm_reconcile',
     "            durable_evidence({output / 'decision' / key: raw for key, raw in final_files.items()})\n",
     '            pass\n', 1, 'test_final_sample_barrier_before_record', 'OSError not raised', True),
    ('post-intent-release-validation-skipped', 'host_vm_reconcile',
     'verify_release(host_spec, capture_dir, final, directory_fd, locks, fixture=True)',
     'released', 2, 'test_final_sample_change_refuses_before_decision', 'no decision before its prerequisites', True),
    ('intent-readback-skipped', 'host_vm_reconcile',
     "require(exact_record(intent_raw, BOOT_INTENT_KEYS) == intent, 'decision intent readback differs')",
     "require(True, 'decision intent readback differs')", 1,
     'test_intent_readback', 'does not match', True),
    ('record-before-intent', 'host_vm_reconcile',
     "            publish_release(decision_fd, 'INTENT.json', intent)\n",
     "            publish_release(decision_fd, 'RESTORE_PRIOR.json', {})\n            publish_release(decision_fd, 'INTENT.json', intent)\n",
     1, 'test_intent_before_final_sample_and_record', 'record only after decision observation', True),
    ('failed-record-accepted', 'host_vm_reconcile',
     '{path.name for path in output.iterdir()} == BOOT_LAYOUT',
     '{path.name for path in output.iterdir()} >= BOOT_LAYOUT', 2,
     'test_visible_record_with_publication_error_refuses', 'RuntimeError not raised', False),
    ('decision-kind-widened', 'host_vm_reconcile',
     "and value['decision'] == 'RESTORE_PRIOR'", 'and True', 1,
     'test_claim_digest_schema_enum_and_checkpoint', 'RuntimeError not raised', False),
    ('claim-digest-skipped', 'restore_only',
     'and hashlib.sha256(raw).hexdigest() == expected_digest', 'and True', 1,
     'test_claim_digest_schema_enum_and_checkpoint', 'RuntimeError not raised', False),
    ('checkpoint-canonical-skipped', 'restore_only',
     'and encoded(checkpoint) == checkpoint_raw', 'and True', 1,
     'test_claim_digest_schema_enum_and_checkpoint', 'RuntimeError not raised', False),
    ('checkpoint-body-hash-skipped', 'restore_only',
     "and checkpoint['sha256'] == hashlib.sha256(encoded(\n                {key: value for key, value in checkpoint.items() if key != 'sha256'})).hexdigest()",
     'and True', 1, 'test_claim_bad_checkpoint_body_hash', 'RuntimeError not raised', False),
    ('claim-prehead-binding-skipped', 'restore_only',
     "('journal_head', 'pre_head'), ", '', 1,
     'test_claim_prehead_binding_with_intact_distinct_checkpoint', 'RuntimeError not raised', False),
    ('claim-fence-skipped', 'restore_only',
     "require(fixture, 'production restore-prior claim decoding is disabled')",
     "require(True, 'production restore-prior claim decoding is disabled')", 1,
     'test_production_fence_precedes_inputs', 'does not match', False),
)

def execute(module, source, test):
    code = ("import %s as m; exec(compile(%r,m.__file__,'exec'),m.__dict__); "
            "import unittest; r=unittest.TextTestRunner().run(unittest.defaultTestLoader.loadTestsFromName(%r)); "
            "raise SystemExit(not r.wasSuccessful())" % (module, source, PREFIX + test))
    return subprocess.run([sys.executable, '-c', code], cwd=STEP, capture_output=True, text=True, timeout=300)

def main():
    controls = subprocess.run([sys.executable, '-m', 'unittest', *sorted({PREFIX + row[5] for row in MUTANTS})],
                              cwd=STEP, capture_output=True, text=True, timeout=300)
    if controls.returncode:
        print(controls.stdout + controls.stderr)
        return 1
    print('unmutated host decision controls: all passed', flush=True)
    for name, module, old, new, count, test, assertion, producer in MUTANTS:
        source = (STEP / (module + '.py')).read_text()
        split = source.index('def decide_restore_prior(') if producer else 0
        before, target = source[:split], source[split:]
        if target.count(old) != count:
            raise RuntimeError(name + ': mutation anchor differs')
        done = execute(module, before + target.replace(old, new), test)
        output = done.stdout + done.stderr
        if not (done.returncode == 1 and ('FAIL: ' + test) in output and assertion in output and 'ERROR:' not in output):
            print(name + ': not an intended-assertion kill\n' + output)
            return 1
        print(name + ': intended assertion killed', flush=True)
    return 0

if __name__ == '__main__':
    raise SystemExit(main())
