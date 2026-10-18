import os
import pathlib
import plistlib
import tempfile
import unittest
from unittest.mock import patch

import preservation_checks as checks


DELIMITERS = (' ', '(', ')', '"', "'", ';', ',', '|', '&', '`', '\t', '\n')
LABEL = 'org.fixture.neutral'


class PathScope(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory(prefix='openclaw-owned-path-scope-')
        self.addCleanup(temporary.cleanup)
        self.root = pathlib.Path(temporary.name).resolve()
        self.protected = self.root / 'protected'; self.protected.mkdir()
        self.binary = self.protected / 'entry'; self.binary.write_bytes(b'owned fixture')
        self.home = self.root / 'home'; self.home.mkdir()
        self.outside = self.root / 'outside'; self.outside.mkdir()
        self.plists = self.root / 'plists'; self.plists.mkdir()
        self.source = self.plists / (LABEL + '.plist')

    def relevant(self, values, *, roots=None, **kwargs):
        return checks.relevant_entrypoint(LABEL, values, roots or (self.protected,),
                                         home=self.home, source=self.source, **kwargs)

    def alias(self, delimiter=' ', *, target=None, directory=False):
        path = self.outside / ('alias' + delimiter + 'entry')
        path.symlink_to(target or self.binary, target_is_directory=directory)
        return path

    def test_absolute_whole_values_resolve_all_delimiters(self):
        for delimiter in DELIMITERS:
            alias = self.alias(delimiter)
            with self.subTest(delimiter=repr(delimiter)):
                self.assertEqual(alias.resolve(), self.binary)
                self.assertTrue(self.relevant([str(alias)], roots=(self.binary,)),
                                'whole absolute alias must match an exact file root')
                self.assertTrue(self.relevant([str(alias)]),
                                'whole absolute alias must match a parent root')

    def test_slash_relative_whole_values_resolve_against_expanded_cwd(self):
        for delimiter in DELIMITERS:
            directory = self.outside / ('sub' + delimiter + 'dir'); directory.mkdir()
            (directory / 'entry').symlink_to(self.binary)
            value = directory.name + '/entry'
            with self.subTest(delimiter=repr(delimiter)):
                self.assertTrue(self.relevant([value], working_directory='$BASE',
                                             environment={'BASE': str(self.outside)}),
                                'slash-relative alias must use expanded working directory')
                self.assertTrue(self.relevant(['$ENTRY'], working_directory=str(self.outside),
                                             environment={'ENTRY': value}),
                                'slash introduced by expansion must use working directory')

    def test_working_directory_whole_alias_is_relevant(self):
        alias = self.root / 'cwd alias'; alias.symlink_to(self.protected, target_is_directory=True)
        self.assertTrue(self.relevant([str(alias)], working_directory=str(alias)),
                        'whole working-directory alias must match')

    def test_bare_names_do_not_join_to_working_directory(self):
        (self.outside / 'entry').symlink_to(self.binary)
        self.assertFalse(self.relevant(['entry'], working_directory=str(self.outside)),
                         'bare names must not become cwd-relative paths')
        self.assertFalse(self.relevant(['entry'], working_directory='$BASE',
                                      environment={'BASE': str(self.outside)}))

    def test_slash_relative_without_cwd_ignores_process_working_directory(self):
        alias = self.alias()
        previous = pathlib.Path.cwd()
        os.chdir(self.root)
        self.addCleanup(os.chdir, previous)
        self.assertFalse(self.relevant(['outside/' + alias.name]),
                         'relative input without supplied cwd must stay unclassified')

    def test_dangling_alias_into_root_remains_relevant(self):
        missing = self.protected / 'not-created'
        alias = self.alias(target=missing)
        try:
            result = self.relevant([str(alias)])
        except OSError:
            self.fail('dangling alias must resolve without requiring existence')
        self.assertFalse(missing.exists())
        self.assertTrue(result, 'dangling alias into root must remain relevant')

    def test_resolved_prefix_sibling_alias_is_not_containment(self):
        sibling = self.root / 'protected-other'; sibling.mkdir()
        file = sibling / 'entry'; file.write_bytes(b'outside')
        alias = self.alias(target=file)
        self.assertFalse(self.relevant([str(alias)]),
                         'resolved prefix sibling must not count as containment')
        self.assertTrue(self.relevant([str(file)]),
                        'pre-existing raw substring over-inclusion stays unchanged')

    def test_home_and_environment_expansion_apply_before_whole_resolution(self):
        alias = self.alias()
        for value, environment in (('$ENTRY', {'ENTRY': str(alias)}),
                                    ('${SECOND}', {'SECOND': '$ENTRY', 'ENTRY': str(alias)})):
            self.assertTrue(self.relevant([value], environment=environment),
                            'whole values must use existing environment expansion')
        (self.home / 'alias entry').symlink_to(self.binary)
        self.assertTrue(self.relevant(['~/alias entry']), 'whole values must use existing home expansion')

    def test_hardlink_whole_argument_uses_existing_suspicion_rule(self):
        alias = self.outside / 'hard link'; os.link(self.binary, alias)
        self.assertFalse(checks.unclassified_executable('/owned/native', ['/owned/native', str(alias)], self.source, LABEL))
        self.assertTrue(self.relevant([str(alias)], roots=(self.root / 'unrelated',)),
                        'whole hardlink argument must be relevant')

    def test_system_source_hardlink_exemption_is_preserved(self):
        alias = self.outside / 'hard link'; os.link(self.binary, alias)
        self.assertFalse(checks.relevant_entrypoint(LABEL, [str(alias)], (self.root / 'unrelated',),
                                                   home=self.home, source='/System/Library/fixture.plist'),
                         'system-source hardlink exemption must survive')

    def test_application_hardlink_exemption_is_preserved(self):
        folder = self.outside / 'Owned.app/Contents/MacOS'; folder.mkdir(parents=True)
        alias = folder / 'hard link'; os.link(self.binary, alias)
        self.assertFalse(checks.relevant_entrypoint('application.org.fixture', [str(alias)],
                                                   (self.root / 'unrelated',), home=self.home, source=self.source),
                         'application hardlink exemption must survive')

    def test_root_containment_is_independent_of_hardlink_exemptions(self):
        alias = self.alias()
        self.assertTrue(checks.relevant_entrypoint('application.org.fixture', [str(alias)],
                                                  (self.protected,), home=self.home,
                                                  source='/System/Library/fixture.plist'))

    def test_existing_embedded_and_token_scans_stay_reachable(self):
        for value in ('--flag=' + str(self.binary), 'exec "' + str(self.binary) + '"'):
            self.assertTrue(self.relevant([value]), 'raw substring fallback must survive')
        alias = self.alias('-')
        self.assertTrue(self.relevant(['exec ' + str(alias)]), 'token fallback must survive')

    def test_embedded_delimiter_alias_is_a_declared_token_only_limit(self):
        alias = self.alias()
        self.assertFalse(self.relevant(['--flag=' + str(alias)]),
                         'embedded delimiter alias remains a token-only limit')

    def test_prefixes_short_circuit_and_nonstring_values_are_skipped(self):
        for label in ('ai.openclaw.extra', 'com.openclaw.extra'):
            with patch.object(checks.pathlib.Path, 'resolve', side_effect=AssertionError('path IO')):
                self.assertTrue(checks.relevant_entrypoint(label, [], (self.protected,), home=self.home),
                                'managed prefixes must still short-circuit')
        self.assertFalse(self.relevant([None, 123, {}, False]), 'nonstring values must stay skipped')

    def test_benign_long_and_outside_values_stay_negative(self):
        for value in ('/owned/harmless', 'ordinary argument', 'x' * 1024, str(self.outside / ('x' * 1024))):
            try:
                result = self.relevant([value])
            except OSError:
                self.fail('overlong nonpath value must not raise')
            self.assertFalse(result, 'benign outside value must stay negative')

    def installed(self, value):
        self.source.write_bytes(plistlib.dumps({'Label': LABEL, **value}))
        with patch.object(checks.pathlib.Path, 'home', return_value=self.home), \
             patch.object(checks.subprocess, 'check_output', side_effect=AssertionError('no launchctl')):
            return checks.installed_entrypoints(self.plists, (self.protected,))

    def loaded(self, details):
        with patch.object(checks.pathlib.Path, 'home', return_value=self.home), \
             patch.object(checks.subprocess, 'check_output', side_effect=AssertionError('no launchctl')):
            return checks.loaded_entrypoints('services = {\n  1 - ' + LABEL + '\n}\n',
                                             'gui/501', (self.protected,), inspect=lambda _: details)

    def test_installed_program_argv_cwd_and_expanded_environment_reach_whole_rule(self):
        alias = self.alias(); cwd = self.root / 'cwd alias'; cwd.symlink_to(self.protected, target_is_directory=True)
        cases = ({'Program': str(alias), 'ProgramArguments': [str(alias)]},
                 {'Program': '/owned/native', 'ProgramArguments': ['/owned/native', str(alias)]},
                 {'Program': '/owned/native', 'WorkingDirectory': str(cwd), 'ProgramArguments': ['/owned/native']},
                 {'Program': '$ENTRY', 'EnvironmentVariables': {'ENTRY': str(alias)}, 'ProgramArguments': []})
        for value in cases:
            self.assertEqual(set(self.installed(value)), {LABEL}, 'installed caller must retain delimiter alias')

    def test_loaded_program_argv_cwd_and_environment_values_reach_whole_rule(self):
        alias = self.alias(); cwd = self.root / 'cwd alias'; cwd.symlink_to(self.protected, target_is_directory=True)
        common = 'path = /owned/neutral.plist\n'
        cases = (common + 'program = ' + str(alias) + '\n',
                 common + 'program = /owned/native\narguments = {\n  /owned/native\n  ' + str(alias) + '\n}\n',
                 common + 'program = /owned/native\nworking directory = ' + str(cwd) + '\n',
                 common + 'program = /owned/native\nenvironment = {\n  ENTRY => ' + str(alias) + '\n}\n')
        for details in cases:
            self.assertEqual(self.loaded(details), {LABEL}, 'loaded caller must retain delimiter alias')

    def test_caller_delimiter_matrix_uses_owned_files_and_supplied_details(self):
        for delimiter in DELIMITERS:
            alias = self.alias(delimiter)
            self.assertEqual(set(self.installed({'Program': str(alias), 'ProgramArguments': [str(alias)]})), {LABEL})
            if delimiter != '\n':
                self.assertEqual(self.loaded('path = /owned/neutral.plist\nprogram = ' + str(alias) + '\n'), {LABEL})

    def test_real_callers_preserve_whole_hardlink_arguments(self):
        alias = self.outside / 'hard link'; os.link(self.binary, alias)
        self.assertEqual(set(self.installed({'Program': '/owned/native', 'ProgramArguments': ['/owned/native', str(alias)]})),
                         {LABEL}, 'installed hardlink argument must remain in scope')
        self.assertEqual(self.loaded('path = /owned/neutral.plist\nprogram = /owned/native\narguments = {\n  /owned/native\n  '
                                     + str(alias) + '\n}\n'), {LABEL}, 'loaded hardlink argument must remain in scope')

    def test_inventory_verification_refuses_discovered_extra_labels(self):
        alias = self.alias()
        installed = self.installed({'Program': str(alias), 'ProgramArguments': [str(alias)]})
        loaded = self.loaded('path = /owned/neutral.plist\nprogram = ' + str(alias) + '\n')
        self.assertEqual(set(installed), {LABEL}); self.assertEqual(loaded, {LABEL})
        with self.assertRaises(checks.Refused): checks.verify_entrypoint_inventory(installed, set(), set(), set(), {})
        with self.assertRaises(checks.Refused): checks.verify_entrypoint_inventory({}, loaded, set(), set(), {})


if __name__ == '__main__':
    unittest.main()
