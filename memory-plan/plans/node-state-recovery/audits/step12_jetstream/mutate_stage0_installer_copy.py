import hashlib
import json
import os
import pathlib
import shutil
import signal
import stat
import subprocess
import sys
import tempfile
import time

from test_stage0_installer_auth import absent_group


STEP = pathlib.Path(__file__).resolve().parent
SUCCESS = "builtin printf 'root-copy-observed-v1\\n'"
CASES = [
    ('implicit-temp', [('exec 9>&2', ': <<< inert\nexec 9>&2')],
     'test_no_implicit_shell_temporary_files', 'implicit root temporary-file construct'),
    ('roles', [('[[ "$UID" == 0 && "$EUID" == 0 && "$op_uid" != "$capture_uid" ]]', '[[ true ]]')],
     'test_unprivileged_role_refusal', 'root role must refuse before metadata'),
    ('source-approval-order', [('verify_pair "$manifest" "$manifest_record" 3 "$installer" "$installer_record" 4', ':')],
     'test_approvals_precede_staging', 'staging preceded independent source approvals'),
    ('source-entry-set', [('[[ "$(bounded "$ls_tool" -A1 "$base")" == $\'host_release_publish.py\\ninstaller.manifest\' ]] || refuse entries', ':')],
     'test_source_metadata_refusals', 'invalid root copy was accepted'),
    ('root-owner', [('[[ "$uid" == 0 || "$uid" == "$op_uid" ]] || refuse owner', ':'),
                    ('"$uid" == "$op_uid" && "$flags" == 0', '"$flags" == 0')],
     'test_root_parent_mode_and_owner_before_write', 'invalid root copy was accepted'),
    ('root-mode', [('(( (number & 0022) == 0 )) || refuse writable', ':'),
                   ('(( (number & 07777) == 0700 ))', '(( 1 == 1 ))')],
     'test_root_parent_mode_and_owner_before_write', 'invalid root copy was accepted'),
    ('empty-before-payload', [('    empty_file "$child/$name" 12', '    :')],
     'test_empty_destination_before_payload', 'payload began before empty regular destination validation'),
    ('transition-gid', [('"$1" "$2" "$3" "$4" "$5" "${10}" "${11}"', '"$1" "$2" "$3" "$4" 0 "${10}" "${11}"')],
     'test_transition_fields_are_pinned', 'invalid root copy was accepted'),
    ('copied-readback', [('verify_pair "$child/installer.manifest" "$copied_manifest_record" 6 "$child/host_release_publish.py" "$copied_installer_record" 8', ':'),
                         ('[[ "$(hash_path "$child/host_release_publish.py" "$copied_installer_record" 8 131072)" == "$expected_installer" ]] || refuse final-copy-installer', ':')],
     'test_copied_bytes_are_independently_checked', 'invalid root copy was accepted'),
    ('code-mapping', [('mapping() {\n', 'mapping() {\n    if [[ "$1" == "$script" ]]; then return 0; fi\n')],
     'test_final_code_mapping_drift_refuses', 'invalid root copy was accepted'),
    ('existing-fence', [('[[ "$(bounded "$ls_tool" -A1 "$root")" == stage0_installer_copy.sh ]] || refuse root-entries', ':'),
                        ('"$mkdir_tool" -m 700 -- "$pending" || refuse staging-fence',
                         'if [[ ! -d "$pending" ]]; then "$mkdir_tool" -m 700 -- "$pending" || refuse staging-fence; fi')],
     'test_existing_fences_are_untouched', 'invalid root copy was accepted'),
]
for name, execution in (
    ('source', '. "$child/host_release_publish.py"'),
    ('eval', 'eval "$(/usr/bin/head -c 131072 "$child/host_release_publish.py")"'),
    ('shell', ('/bin/bash' if sys.platform == 'darwin' else '/usr/bin/bash')+' --noprofile --norc -p "$child/host_release_publish.py"'),
    ('python', '/usr/bin/python3 -I -S -B "$child/host_release_publish.py"'),
):
    CASES.append(('execute-'+name, [(SUCCESS, execution+'\n'+SUCCESS)],
                  'test_approved_bad_installer_is_inert', 'BAD installer was executed by root copier'))


def sha(raw): return hashlib.sha256(raw).hexdigest()


def run(test, report, script=None):
    env = dict(os.environ, PYTHONDONTWRITEBYTECODE='1')
    if script: env['OPENCLAW_STAGE0_COPY_TEST_SCRIPT'] = str(script)
    command=[sys.executable,str(STEP/'test_stage0_installer_copy.py'),'--case',test,str(report)]
    begin=time.monotonic()
    p=subprocess.Popen(command,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,env=env,start_new_session=True)
    try: raw,_=p.communicate(timeout=180)
    except subprocess.TimeoutExpired:
        os.killpg(p.pid,signal.SIGKILL); p.communicate(timeout=5)
        raise AssertionError('mutation harness deadline; descendants uncertain, retain fixture')
    assert absent_group(p.pid), 'mutation driver group remains'
    assert len(raw)<=131072, 'mutation output exceeds report bound'
    proof=json.loads(report.read_text())
    assert proof['cleanup']['removed'] and all(w['waited'] and w['group_absent'] and w['failure'] is None for w in proof['workers']), proof
    return {'argv':command,'selected_script':str(script) if script else None,'rc':p.returncode,'output':raw.decode(errors='replace'),
            'output_bytes':len(raw),'output_sha256':sha(raw),'timeout_s':180,'elapsed_s':time.monotonic()-begin,
            'waited':True,'group_absent':True,'proof':proof}


def main():
    assert len(sys.argv)==3 and sys.argv[1]=='--probe'
    assert os.getuid()==os.geteuid()==0 and os.environ.get('CI')==os.environ.get('GITHUB_ACTIONS')=='true'
    assert os.environ.get('OPENCLAW_STAGE0_COPY_PROBE')=='1' and os.environ.get('SUDO_UID','').isdecimal()
    uid=int(os.environ['SUDO_UID']); gid=int(os.environ['SUDO_GID']); assert 0<uid<2147483647 and uid!=65533
    report=pathlib.Path(sys.argv[2]); parent=pathlib.Path('/private/var/db' if sys.platform=='darwin' else '/var/lib')
    outer=pathlib.Path(tempfile.mkdtemp(prefix='openclaw-stage0-copy-mutants-',dir=str(parent)))
    original=outer.lstat(); script=(STEP/'stage0_installer_copy.sh').read_text()
    result={'schema':'openclaw-stage0-root-copy-mutations-v1','completed':False,'baseline':[],'mutants':[],
            'source':{'bytes':len(script.encode()),'sha256':sha(script.encode())},'fixture':str(outer),'removed':False}
    try:
        for test in sorted({c[2] for c in CASES}):
            row=run(test,outer/(test+'.json'))
            result['baseline'].append(row)
            assert row['rc']==0 and '\nOK\n' in row['output'] and row['proof']['completed'], row
        print('Root-copy unmutated designated controls pass',flush=True)
        for name,replacements,test,intended in CASES:
            variant=script
            for old,new in replacements:
                assert variant.count(old)>=1,(name,variant.count(old),old)
                variant=variant.replace(old,new)
            path=outer/'stage0_installer_copy.sh'; path.write_text(variant); path.chmod(0o600)
            row=run(test,outer/(name+'.json'),path)
            row.update(name=name,test=test,intended_assertion=intended,mutant_sha256=sha(variant.encode()),
                       replacements=[{'old':old,'new':new} for old,new in replacements])
            result['mutants'].append(row)
            assert row['rc']!=0 and 'FAIL:' in row['output'] and 'ERROR:' not in row['output'] and intended in row['output'],row
            assert not row['proof']['completed'],row
            print('KILLED '+name+' at NativeTests.'+test,flush=True)
        result['completed']=True
        now=outer.lstat()
        assert (now.st_dev,now.st_ino,now.st_uid)==(original.st_dev,original.st_ino,0) and stat.S_IMODE(now.st_mode)==0o700
        assert outer.parent==parent and outer.name.startswith('openclaw-stage0-copy-mutants-') and not outer.is_symlink()
        shutil.rmtree(outer); assert not outer.exists(); result['removed']=True
    finally:
        report.write_text(json.dumps(result,indent=2,sort_keys=True)+'\n'); os.chown(report,uid,gid)
    print(str(len(CASES))+' intended-assertion root-copy kills',flush=True)


if __name__=='__main__': main()
