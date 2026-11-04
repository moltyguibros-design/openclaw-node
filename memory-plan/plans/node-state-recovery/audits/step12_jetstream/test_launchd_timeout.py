import subprocess
import unittest
from unittest.mock import patch

from managed_launchd import Launchd, UndeterminedLaunchdAction
from preservation_checks import Refused


class KickstartTimeout(unittest.TestCase):
    def test_precondition_timeout_does_not_issue_kickstart(self):
        service = Launchd('ai.openclaw.owned', '/owned.plist')
        timeout = subprocess.TimeoutExpired('owned inspection', 10)
        with patch.object(service, 'status', side_effect=timeout), \
                patch('managed_launchd.command') as command:
            with self.assertRaises(subprocess.TimeoutExpired) as raised:
                service.kickstart()
            self.assertIs(raised.exception, timeout)
            command.assert_not_called()

    def test_command_refusal_is_not_classified_as_timeout(self):
        service = Launchd('ai.openclaw.owned', '/owned.plist')
        idle = {'loaded': True, 'running': False, 'pid': None}
        refusal = Refused('owned command failed')
        with patch.object(service, 'status', return_value=idle) as observed, \
                patch.object(service, 'disabled', return_value=False), \
                patch('managed_launchd.command', side_effect=refusal):
            with self.assertRaises(Refused) as raised:
                service.kickstart()
            self.assertIs(raised.exception, refusal)
            self.assertEqual(observed.call_count, 2)

    def test_timeout_refuses_even_when_action_was_applied(self):
        for running in (False, True):
            with self.subTest(running=running):
                service = Launchd('ai.openclaw.owned', '/owned.plist')
                idle = {'loaded': True, 'running': False, 'pid': None}
                after = {'loaded': True, 'running': running, 'pid': 123 if running else None}
                timeout = subprocess.TimeoutExpired('owned', 10)
                with patch.object(service, 'status', side_effect=[idle, idle, after]) as observed, \
                        patch.object(service, 'disabled', return_value=False), \
                        patch('managed_launchd.command', side_effect=timeout):
                    with self.assertRaisesRegex(UndeterminedLaunchdAction, 'effect undetermined') as raised:
                        service.kickstart()
                    self.assertIn('running=' + str(running), str(raised.exception))
                    self.assertIn('after 10s', str(raised.exception))
                    self.assertIs(raised.exception.__cause__, timeout)
                    observed.assert_called_with(timeout=1)

    def test_failed_observation_retains_undetermined_action(self):
        service = Launchd('ai.openclaw.owned', '/owned.plist')
        idle = {'loaded': True, 'running': False, 'pid': None}
        with patch.object(service, 'status', side_effect=[idle, idle, OSError('owned')]), \
                patch.object(service, 'disabled', return_value=False), \
                patch('managed_launchd.command', side_effect=subprocess.TimeoutExpired('owned', 10)):
            with self.assertRaisesRegex(UndeterminedLaunchdAction, 'observation unavailable: OSError'):
                service.kickstart()

    def test_success_does_not_add_an_observation(self):
        service = Launchd('ai.openclaw.owned', '/owned.plist')
        idle = {'loaded': True, 'running': False, 'pid': None}
        with patch.object(service, 'status', return_value=idle) as observed, \
                patch.object(service, 'disabled', return_value=False), \
                patch('managed_launchd.command', return_value=''):
            service.kickstart()
            self.assertEqual(observed.call_count, 2)


if __name__ == '__main__':
    unittest.main()
