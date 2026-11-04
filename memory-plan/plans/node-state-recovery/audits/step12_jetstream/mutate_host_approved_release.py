import pathlib
import subprocess
import sys
import tempfile


STEP = pathlib.Path(__file__).resolve().parent
CASES = (
    ('expected-digest', None, 'digest == expected_digest', 'True',
     'test_independent_digest_is_required_for_each_action'),
    ('manifest-fields', None, "set(value) == {'schema', 'files'}", 'True',
     'test_manifest_schema_and_file_set_are_exact'),
    ('manifest-schema', None, "value['schema'] == RELEASE_SCHEMA", 'True',
     'test_manifest_schema_and_file_set_are_exact'),
    ('binding-fields', None, "set(item) == {'size', 'sha256'}", 'True',
     'test_manifest_schema_and_file_set_are_exact'),
    ('bool-size', None, "type(item['size']) is int", "isinstance(item['size'], int)",
     'test_manifest_sizes_are_strict_bounded_integers'),
    ('source-binding', None,
     "all({'sha256': read[1], 'size': read[2]} == value['files'][name]\n                    for name, read in reads.items())", 'True',
     'test_stale_release_and_extra_missing_linked_sources_refuse'),
    ('exact-directory', None, 'set(os.listdir(directory.fd)) == CODE_NAMES', 'True',
     'test_stale_release_and_extra_missing_linked_sources_refuse'),
    ('publish-approval', 'publish', 'release_manifest, release_sha256) as selected:',
     'release_manifest, sha(pathlib.Path(release_manifest).read_bytes())) as selected:',
     'test_independent_digest_is_required_for_each_action'),
    ('verify-approval', 'verify', 'release_manifest, release_sha256) as selected:',
     'release_manifest, sha(pathlib.Path(release_manifest).read_bytes())) as selected:',
     'test_independent_digest_is_required_for_each_action'),
    ('read-approval', 'reader_action', 'release_manifest, release_sha256) as selected:',
     'release_manifest, release_sha256 if receipt else sha(pathlib.Path(release_manifest).read_bytes())) as selected:',
     'test_independent_digest_is_required_for_each_action'),
    ('receipt-approval', 'reader_action', 'release_manifest, release_sha256) as selected:',
     'release_manifest, sha(pathlib.Path(release_manifest).read_bytes()) if receipt else release_sha256) as selected:',
     'test_independent_digest_is_required_for_each_action'),
    ('publish-held', 'publish', "release['check']()", 'None', 'test_each_action_rechecks_before_its_effect'),
    ('verify-held', 'verify', "release['check']()", 'None', 'test_each_action_rechecks_before_its_effect'),
    ('reader-held', 'reader_code', "release['check']()", 'None', 'test_each_action_rechecks_before_its_effect'),
    ('held-context', None, "release['check']()", 'None', 'test_entry_to_reader_swap_refuses'),
    ('snapshot-execution', None, "raw = release['sources'][name + '.py']",
     "raw = (program.parent / (name + '.py')).read_bytes()", 'test_hash_to_execution_uses_only_snapshots'),
    ('held-transitive-finder', None, 'sys.meta_path.insert(0, finder)', 'pass',
     'test_transitive_import_swap_never_executes_replacement'),
    ('anchor-import-fallthrough', None,
     "require(fullname in READER_MODULES, 'reader anchor or submodule import is forbidden')",
     "\n            if fullname not in READER_MODULES:\n                return None",
     'test_direct_transitive_and_lazy_anchor_imports_refuse_without_second_object'),
    ('preloaded-origin-only', None,
     "all(name not in sys.modules for name in (*READER_MODULES, 'host_capture_anchor'))", 'True',
     'test_preloaded_matching_origins_and_anchor_alias_refuse'),
    ('guard-retention', None, 'sys.meta_path and sys.meta_path[0] is finder', 'True',
     'test_guard_and_manifest_mapping_drift_refuse'),
    ('source-rehash', None, 'item.read(True) == reads[name]', 'True',
     'test_sources_are_rehashed_not_only_metadata_checked'),
    ('local-alias', None,
     "(name == __name__ and module is running)\n                            or (name in loaded and loaded[name] is module)", 'True',
     'test_loaded_object_origin_and_alias_drift_refuse'),
    ('ci-command', None,
     "os.environ.get('CI') == 'true' and os.environ.get('GITHUB_ACTIONS') == 'true'", 'True',
     'test_python39_and_ci_entry_barriers'),
)


def main():
    baseline = subprocess.run([sys.executable, '-m', 'unittest', '-q', 'test_host_approved_release'],
                              cwd=STEP, capture_output=True, text=True, timeout=120)
    if baseline.returncode:
        print(baseline.stdout + baseline.stderr)
        return 1
    print('approved-release unmutated controls passed\n' + baseline.stderr.strip(), flush=True)
    source = (STEP / 'host_capture_anchor.py').read_text()
    with tempfile.TemporaryDirectory(prefix='openclaw-release-mutants-', dir=STEP) as temp:
        path = pathlib.Path(temp) / 'candidate.py'
        for name, scope, old, new, target in CASES:
            prefix = suffix = ''
            selected = source
            if scope:
                start = source.index('def ' + scope + '(')
                end = source.find('\ndef ', start + 1)
                if end < 0:
                    end = source.index("\n\nif __name__ == '__main__':", start)
                prefix, selected, suffix = source[:start], source[start:end], source[end:]
            count = selected.count(old)
            expected = {'exact-directory': 2, 'publish-held': 2, 'reader-held': 4, 'held-context': 8}.get(name, 1)
            if count != expected:
                raise RuntimeError((name, 'mutation anchor count', count, expected))
            path.write_text(prefix + selected.replace(old, new) + suffix)
            script = ('import pathlib,unittest,test_host_approved_release as t; '
                      't.ANCHOR_SOURCE=pathlib.Path(%r); '
                      'suite=unittest.defaultTestLoader.loadTestsFromName(%r); '
                      'r=unittest.TextTestRunner(verbosity=2).run(suite); raise SystemExit(not r.wasSuccessful())'
                      % (str(path), 'test_host_approved_release.Release.' + target))
            done = subprocess.run([sys.executable, '-B', '-c', script], cwd=STEP,
                                  capture_output=True, text=True, timeout=90)
            output = done.stdout + done.stderr
            if done.returncode != 1 or 'FAIL: ' + target not in output or 'AssertionError' not in output or 'ERROR:' in output:
                print(name + ': no intended assertion kill\n' + output)
                return 1
            print(name + ': intended assertion killed', flush=True)
    return 0


if __name__ == '__main__':
    sys.exit(main())
