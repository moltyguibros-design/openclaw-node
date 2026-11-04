import pathlib
import re
import subprocess
import sys
import tempfile


STEP = pathlib.Path(__file__).resolve().parent
MUTANTS = [
    ('window-bound', 'e', 'WINDOW = 131072', 'WINDOW = 262144', 'test_window_byte_bound', 'the byte window must remain bounded'),
    ('line-bound', 'e', 'LINE = 1024', 'LINE = 2048', 'test_window_filters_and_line_bound', 'selector lines must be bounded'),
    ('selector-filter', 'e', "elif ('Peer selection:' not in line and not\n              ('[INF]' in line and any(term in line for term in CREATE_INFO))):", 'elif False:', 'test_window_filters_and_line_bound', 'only selector and verified INFO belong in create windows'),
    ('startup-info-filter', 'e', "'[INF]' not in line or ", '', 'test_window_filters_and_line_bound', 'only verified INFO messages belong in startup'),
    ('clipped-complete', 'e', 'and not clipped,', 'and True,', 'test_window_filters_and_line_bound', 'clipped lines must mark the window incomplete'),
    ('credential-suppression', 'e', 'any(secret and secret in raw for secret in self.secrets)', 'False', 'test_credentials_suppress_the_entire_report', 'credential-bearing evidence must be suppressed'),
    ('total-cap', 'e', 'REPORT = 262144', 'REPORT = 524288', 'test_report_total_cap', 'oversized reports must be suppressed'),
    ('exclusive-report', 'e', "path.open('x',", "path.open('w',", 'test_report_is_private_and_exclusive', 'reports must not overwrite an existing object'),
    ('private-report', 'e', 'os.chmod(path, 0o600)', 'os.chmod(path, 0o644)', 'test_report_is_private_and_exclusive', 'reports must be private'),
    ('non-json-parser', 'e', 'except (ValueError, TypeError):', 'except OSError:', 'test_non_json_client_output_is_diagnostic_only', 'non-JSON output must be marked unparsed'),
    ('old-window-offset', 'e', "self.offsets[i] = (self.root/f'server-{i}.log').stat().st_size", 'self.offsets[i] = 0', 'test_offsets_exclude_earlier_selector_lines', 'only the current create window belongs in evidence'),
    ('primary-replaced', 'e', 'if primary is None:', 'if True:', 'test_raising_writer_preserves_primary_after_all_cleanup', 'writer must preserve the identical primary'),
    ('kill-wait-escapes-loop', 'e', "row['error'].append('kill-wait: ' + type(error).__name__)", "row['error'].append('kill-wait: ' + type(error).__name__)\n                break", 'test_failed_kill_wait_does_not_skip_other_owners', 'every owner must receive a stop attempt'),
    ('unreaped-claimed', 'e', "'reaped': False,", "'reaped': True,", 'test_failed_kill_wait_does_not_skip_other_owners', 'failed wait must not claim reaping'),
    ('log-close-dropped', 'e', '                log.close()', '                pass', 'test_failed_kill_wait_does_not_skip_other_owners', 'every owner log must close'),
    ('green-report-ignored', 'e', "if not retained or self.data['diagnosticErrors']:", 'if False:', 'test_green_missing_report_refuses_after_cleanup', 'a green run must require retained evidence'),
    ('empty-sample-unbound', 'c', '            js = routes = None\n', '', 'test_readiness_without_any_sample_keeps_readiness_failure', 'timeout must retain the readiness failure'),
    ('startup-deadline', 'c', 'time.monotonic() + 15', 'time.monotonic() + 20', 'test_inline_gate_contract_is_fixed', 'the existing readiness and stream budgets must stay fixed'),
    ('startup-poll', 'c', "                time.sleep(.05)\n            else:\n                evidence.accepted", "                time.sleep(.1)\n            else:\n                evidence.accepted", 'test_inline_gate_contract_is_fixed', 'the existing readiness and stream budgets must stay fixed'),
    ('startup-503-policy', 'c', "error.get('code') == '503'", "error.get('code') == '400'", 'test_inline_gate_contract_is_fixed', 'the existing readiness and stream budgets must stay fixed'),
    ('stream-deadline', 'c', 'Date.now()+5000', 'Date.now()+10000', 'test_inline_gate_contract_is_fixed', 'the existing readiness and stream budgets must stay fixed'),
    ('duplicate-python-create', 'c', "                    creation = client('create')", "                    creation = client('create')\n                    creation = client('create')", 'test_inline_gate_contract_is_fixed', 'one Python create invocation must stay fixed'),
    ('pre-create-sleep', 'c', '                with evidence.create_window():', '                time.sleep(1)\n                with evidence.create_window():', 'test_inline_gate_contract_is_fixed', 'the accepted-to-create boundary must stay fixed'),
    ('pre-create-monitor', 'c', '                with evidence.create_window():', "                http_json(ports[1], '/jsz')\n                with evidence.create_window():", 'test_inline_gate_contract_is_fixed', 'the accepted-to-create boundary must stay fixed'),
    ('503-accepted', 'c', '                    return False', '                    return True', 'test_inline_gate_contract_is_fixed', 'the complete 503 retry branch must stay fixed'),
    ('fixture-primary-lost', 'c', '            primary = sys.exc_info()[1]', '            primary = None', 'test_fixture_primary_survives_unclean_owner', 'readiness primary must survive cleanup failure'),
    ('fixture-green-swallowed', 'c', '                if primary is None:', '                if False:', 'test_inline_gate_contract_is_fixed', 'the fixture finally wrapper must preserve primary and green failures'),
    ('debug-config-removed', 'c', 'debug: true\n', '', 'test_inline_gate_contract_is_fixed', 'the owned config must enable debug'),
    ('forced-kill-dropped', 'e', '                    proc.kill()', '                    pass', 'test_failed_kill_wait_does_not_skip_other_owners', 'the forced path must invoke kill'),
    ('chmod-dropped', 'e', '            os.chmod(path, 0o600)', '            pass', 'test_report_is_private_and_exclusive', 'reports must be private'),
    ('cohort-session-dropped', 'p', 'start_new_session=True', 'start_new_session=False', 'test_timeout_driver_owns_session_and_escalates_group', 'cohorts must own a new session'),
    ('cohort-term-dropped', 'p', 'for sig in (signal.SIGTERM, signal.SIGKILL):', 'for sig in (signal.SIGKILL,):', 'test_timeout_driver_owns_session_and_escalates_group', 'timeout must TERM then KILL the owned group'),
    ('cohort-kill-dropped', 'p', 'for sig in (signal.SIGTERM, signal.SIGKILL):', 'for sig in (signal.SIGTERM,):', 'test_timeout_driver_owns_session_and_escalates_group', 'timeout must TERM then KILL the owned group'),
    ('delay-before-ready-break', 'c', '                        break\n                except Refused:', '                        time.sleep(1)\n                        break\n                except Refused:', 'test_inline_gate_contract_is_fixed', 'the continuous startup-to-create boundary must stay fixed'),
    ('monitor-before-ready-break', 'c', '                        break\n                except Refused:', "                        http_json(ports[1], '/jsz')\n                        break\n                except Refused:", 'test_inline_gate_contract_is_fixed', 'the continuous startup-to-create boundary must stay fixed'),
    ('delay-before-accept-record', 'c', '            evidence.accepted(js, routes)\n', '            time.sleep(1)\n            evidence.accepted(js, routes)\n', 'test_inline_gate_contract_is_fixed', 'the continuous startup-to-create boundary must stay fixed'),
    ('startup-parser-forces-503', 'c', '                    error = json.loads(result.stderr)', "                    error = {'stage':'account-info','code':'503'}", 'test_inline_gate_contract_is_fixed', 'the complete startup parsing and 503 policy must stay fixed'),
    ('group-absence-invented', 'p', '    end = time.monotonic() + seconds\n', '    return True\n    end = time.monotonic() + seconds\n', 'test_term_ignoring_group_requires_real_absence', 'a TERM-ignoring live group must require KILL'),
    ('inline-gate-weakened', 'c', "for route in report['routes']}) == 2", "for route in report['routes']}) >= 1", 'test_inline_gate_contract_is_fixed', 'the original inline predicate must stay fixed'),
    ('create-info-dropped', 'e', "CREATE_INFO = STARTUP + ('JetStream cluster new stream leader for ',)", 'CREATE_INFO = ()', 'test_create_info_is_retained_only_at_info_level_inside_the_window', 'create windows must retain only current verified INFO and selector lines'),
    ('create-info-level-dropped', 'e', "('[INF]' in line and any(term in line for term in CREATE_INFO))", '(any(term in line for term in CREATE_INFO))', 'test_create_info_is_retained_only_at_info_level_inside_the_window', 'create windows must retain only current verified INFO and selector lines'),
    ('stream-leader-info-dropped', 'e', "CREATE_INFO = STARTUP + ('JetStream cluster new stream leader for ',)", 'CREATE_INFO = STARTUP', 'test_create_info_is_retained_only_at_info_level_inside_the_window', 'create windows must retain only current verified INFO and selector lines'),
    ('post-failure-member-skipped', 'e', "            members = []\n            for i in range(3):\n                row =", "            members = []\n            for i in range(2):\n                row =", 'test_failed_create_records_three_one_shot_samples_before_cleanup', 'one post-failure request per member is required'),
    ('post-failure-read-repeated', 'e', '                    report = read(i)', '                    report = read(i)\n                    report = read(i)', 'test_failed_create_records_three_one_shot_samples_before_cleanup', 'one post-failure request per member is required'),
    ('post-failure-refusal-aborts', 'e', "                    row['error'] = type(error).__name__", "                    row['error'] = type(error).__name__\n                    break", 'test_post_failure_refusal_keeps_primary_and_attempts_remaining_members', 'a refused member must stay unknown without skipping later members'),
    ('post-failure-count-lost', 'e', "'streams': report.get('streams')", "'streams': None", 'test_failed_create_records_three_one_shot_samples_before_cleanup', 'post-failure stream counts must be retained'),
    ('post-failure-raw-fields', 'e', '                    report = read(i)', '                    report = read(i)\n                    row.update(report)', 'test_failed_create_records_three_one_shot_samples_before_cleanup', 'post-failure projection must drop raw fields'),
    ('post-failure-hook-dropped', 'c', "                evidence.post_failure(lambda i: http_json(ports[i*3+1], '/jsz'))", '                pass', 'test_failed_create_records_three_one_shot_samples_before_cleanup', 'one post-failure request per member is required'),
    ('post-failure-primary-replaced', 'c', '                raise\n            leader = int', "                raise AssertionError('replacement')\n            leader = int", 'test_failed_create_records_three_one_shot_samples_before_cleanup', 'post-failure evidence must preserve the identical primary'),
    ('success-adds-post-failure-reads', 'c', "                    creation = client('create')", "                    creation = client('create')\n                    evidence.post_failure(lambda i: http_json(ports[i*3+1], '/jsz'))", 'test_successful_create_does_not_observe_post_failure', 'successful creates must not add monitor requests'),
]


def main():
    controls=subprocess.run([sys.executable,'-m','unittest','test_cluster_startup_evidence.Portable'],
                            cwd=STEP,capture_output=True,text=True,timeout=60)
    if controls.returncode:
        print(controls.stdout+controls.stderr); return 1
    count=re.search(r'Ran (\d+) tests?',controls.stderr)
    if count is None:
        raise RuntimeError('control count unavailable')
    print('unmutated startup-evidence controls: '+count.group(1)+' passed',flush=True)
    with tempfile.TemporaryDirectory(prefix='owned-startup-mutants-') as temporary:
        for name,target,old,new,test,assertion in MUTANTS:
            module={'e':'cluster_startup_evidence','c':'test_preservation_cluster','p':'test_cluster_startup_evidence'}[target]
            original=(STEP/(module+'.py')).read_text()
            if original.count(old)!=1:
                raise RuntimeError(name+': mutation anchor differs')
            path=pathlib.Path(temporary)/(name+'.py');path.write_text(original.replace(old,new))
            code=("import cluster_startup_evidence as e, test_preservation_cluster as c, test_cluster_startup_evidence as p; "
                  "target=%s; target.__file__=%r; exec(compile(open(%r).read(),%r,'exec'),target.__dict__); "
                  "c.StartupEvidence=e.StartupEvidence; import unittest; "
                  "r=unittest.TextTestRunner().run(unittest.defaultTestLoader.loadTestsFromName(%r)); "
                  "raise SystemExit(not r.wasSuccessful())") % (target,str(path),str(path),str(path),'test_cluster_startup_evidence.Portable.'+test)
            result=subprocess.run([sys.executable,'-c',code],cwd=STEP,capture_output=True,text=True,timeout=60)
            output=result.stdout+result.stderr
            if not (result.returncode==1 and 'FAIL: '+test in output and assertion in output and 'ERROR:' not in output):
                print(name+': not an intended-assertion kill\n'+output);return 1
            print(name+': intended assertion killed',flush=True)
    return 0


if __name__=='__main__':
    raise SystemExit(main())
