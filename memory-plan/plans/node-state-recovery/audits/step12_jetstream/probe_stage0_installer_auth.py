"""Fresh disposable CI ownership proof; never a production bootstrap or cleanup."""
import base64
import hashlib
import json
import os
import pathlib
import pwd
import shutil
import stat
import subprocess
import sys
import tempfile
import time

from test_stage0_installer_auth import UUID, SUCCESS, START, launch, native_tools, sha


STEP = pathlib.Path(__file__).resolve().parent
OPERATOR = 65533
DENIAL_DRIVER = r'''
import json,os,pathlib,sys
p=pathlib.Path(sys.argv[1]); results={}
for key,call in (
 ('list',lambda:list(p.iterdir())),
 ('read',lambda:(p/'host_release_publish.py').read_bytes()),
 ('replace',lambda:os.rename(p/'host_release_publish.py',p/'replaced')),
 ('create',lambda:(p/'created').write_bytes(b'BAD'))):
    try:call()
    except PermissionError:results[key]='denied'
    else:raise AssertionError(key+' unexpectedly allowed')
print(json.dumps(results))
'''


def run_owned(command, uid, gid, timeout=45):
    worker = subprocess.Popen(command, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                              cwd='/', env={}, user=uid, group=gid, extra_groups=[],
                              start_new_session=True)
    try:
        out, err = worker.communicate(timeout=timeout)
    except subprocess.TimeoutExpired:
        os.killpg(worker.pid, 9)
        worker.communicate(timeout=5)
        raise
    try:
        os.killpg(worker.pid, 0)
    except ProcessLookupError:
        pass
    else:
        raise RuntimeError('fixture driver group unresolved')
    assert worker.returncode == 0 and not err, (worker.returncode, err[:1024])
    return out


def main():
    if not (os.getuid() == os.geteuid() == 0 and os.environ.get('CI') == 'true'
            and os.environ.get('GITHUB_ACTIONS') == 'true'
            and os.environ.get('OPENCLAW_STAGE0_AUTH_PROBE') == '1'
            and len(sys.argv) == 2 and os.environ.get('SUDO_UID', '').isdecimal()):
        raise SystemExit('Stage0 authentication probe requires fresh disposable CI root fixture authority')
    capture = int(os.environ['SUDO_UID'])
    capture_gid = int(os.environ['SUDO_GID'])
    assert 0 < capture < 2147483647 and capture != OPERATOR
    report_path = pathlib.Path(sys.argv[1])
    parent = pathlib.Path('/private/var/db' if sys.platform == 'darwin' else '/var/lib')
    parent_info = parent.stat()
    assert parent_info.st_uid == 0 and parent_info.st_mode & 0o777 == 0o755
    tools = native_tools()
    script = (STEP / 'stage0_installer_auth.sh').read_bytes()
    installer = (STEP / 'host_release_publish.py').read_bytes()
    approved = (STEP / 'installer.manifest').read_bytes()
    bindings = {name: {'bytes': len(raw), 'sha256': sha(raw)} for name, raw in [
        ('stage0_installer_auth.sh', script), ('host_release_publish.py', installer), ('installer.manifest', approved)]}
    result = {'schema': 'openclaw-stage0-installer-auth-owned-v1', 'completed': False,
              'operator_uid': OPERATOR, 'capture_uid': capture, 'root_is_fixture_plumbing_only': True,
              'bindings': bindings, 'tools': tools, 'cases': [], 'fixtures': [],
              'observation_is_not_startup_authority': True,
              'native_format_is_not_dispatcher_proof': True,
              'tool_dispatcher_absence': 'declared fixed platform assumption; shell observed live',
              'denial_attribution': 'operator0700 base under root-owned traversable parent',
              'parent': {'path': str(parent), 'uid': 0, 'mode': oct(stat.S_IMODE(parent_info.st_mode))},
              'cleanup': {'removed': False}}
    fixtures = []
    uncertain = False
    try:
        for case in ['honest', 'root-refusal', 'wrong-script-approval', 'wrong-installer-approval',
                     'wrong-manifest-approval', 'private-xattr', 'unexpected-acl',
                     'capture-denial', 'interrupted']:
            acl_name = None
            base = pathlib.Path(tempfile.mkdtemp(prefix='openclaw-stage0-auth-owned-', dir=str(parent)))
            os.chmod(base, 0o700)
            os.chown(base, OPERATOR, OPERATOR)
            for name, raw in [('stage0_installer_auth.sh', script), ('host_release_publish.py', installer), ('installer.manifest', approved)]:
                path = base / name
                path.write_bytes(raw)
                path.chmod(0o600)
                os.chown(path, OPERATOR, OPERATOR)
            identity = {'path': str(base), 'device': base.stat().st_dev, 'inode': base.stat().st_ino}
            fixtures.append(identity)
            result['fixtures'].append(dict(identity, removed=False))
            expected = [sha(script), sha(installer), sha(approved)]
            if case.startswith('wrong-'):
                index = {'wrong-script-approval': 0, 'wrong-installer-approval': 1, 'wrong-manifest-approval': 2}[case]
                expected[index] = '0' * 64
            if case == 'private-xattr':
                if sys.platform == 'darwin':
                    subprocess.run(['/usr/bin/xattr', '-w', 'com.openclaw.stage0', 'owned', str(base / 'host_release_publish.py')], check=True)
                else:
                    os.setxattr(base / 'host_release_publish.py', 'user.openclaw.stage0', b'owned')
            if case == 'unexpected-acl':
                if sys.platform == 'darwin':
                    acl_name = pwd.getpwuid(capture).pw_name
                    assert pwd.getpwnam(acl_name).pw_uid == capture and acl_name and acl_name.isascii() and all(c.isalnum() or c in '_-' for c in acl_name)
                    subprocess.run(['/bin/chmod', '+a', 'user:' + acl_name + ' allow read', str(base / 'host_release_publish.py')], check=True)
                else:
                    subprocess.run(['/usr/bin/setfacl', '-m', 'u:' + str(capture) + ':r,m::---', str(base / 'host_release_publish.py')], check=True)
            if case == 'capture-denial':
                denial = run_owned([sys.executable, '-I', '-S', '-B', '-c', DENIAL_DRIVER, str(base)], capture, capture_gid)
                denied = json.loads(denial)
                assert set(denied.values()) == {'denied'}
            callback = (lambda worker: os.killpg(worker.pid, 9)) if case == 'interrupted' else None
            worker_uid = 0 if case == 'root-refusal' else OPERATOR
            observed = launch(base, *expected, op_uid=OPERATOR, capture_uid=capture,
                              user=worker_uid, group=worker_uid, during=callback,
                              early_refusal_reason='roles' if case == 'root-refusal' else None)
            out, err = observed['out'], observed['err']
            if observed.get('worker'):
                assert observed['waited'] and observed['group_absent'], observed
                assert observed['failure'] is None, observed
                assert observed['shell_observed'] or (case == 'root-refusal' and observed['early_refusal']), observed
            if case in ('honest', 'capture-denial'):
                assert observed['rc'] == 0 and out == SUCCESS and not err, observed
            elif case == 'interrupted':
                assert observed['rc'] == -9 and not out and observed['group_absent'], observed
            else:
                assert observed['rc'] != 0 and SUCCESS not in out, observed
            if case == 'root-refusal': assert b'roles' in err
            assert {p.name for p in base.iterdir()} == set(bindings)
            for name, binding in bindings.items():
                path = base / name
                assert sha(path.read_bytes()) == binding['sha256']
            entry = {'name': case, 'worker': observed,
                     'input_bytes_unchanged': True, 'no_startup_or_installation_receipt': True}
            for key in ('out', 'err'): observed[key] = base64.b64encode(observed[key]).decode()
            if case == 'unexpected-acl':
                entry['acl_kind'] = 'granting Darwin ACE' if sys.platform == 'darwin' else 'named masked POSIX ACL (stricter refusal)'
                entry['acl_principal'] = {'uid': capture, 'name': acl_name}
            if case == 'capture-denial': entry['capture_access'] = denied
            result['cases'].append(entry)
            print(json.dumps({'case': case, 'rc': observed['rc'], 'worker_group_absent': observed['group_absent']}), flush=True)
        result['completed'] = True
    except BaseException:
        uncertain = True
        raise
    finally:
        if not uncertain:
            for identity in fixtures:
                path = pathlib.Path(identity['path'])
                info = path.lstat()
                assert stat.S_ISDIR(info.st_mode) and info.st_dev == identity['device'] and info.st_ino == identity['inode']
                assert info.st_uid == OPERATOR and path.parent == parent and path.name.startswith('openclaw-stage0-auth-owned-')
                shutil.rmtree(path)
                assert not path.exists()
                next(row for row in result['fixtures'] if row['path'] == str(path))['removed'] = True
            result['cleanup']['removed'] = True
        else:
            result['cleanup']['retained_due_to_uncertainty'] = True
        report_path.write_text(json.dumps(result, sort_keys=True, indent=2) + '\n')
        os.chown(report_path, capture, capture_gid)
    print(json.dumps({'cases': len(result['cases']), 'fixtures': len(fixtures),
                      'completed': result['completed'], 'cleanup': result['cleanup']}), flush=True)


if __name__ == '__main__':
    main()
