"""CI-only distinct-owner proof with a trusted temporary program copy; no VM resources."""
import getpass
import hashlib
import json
import os
import pathlib
import secrets
import subprocess
import sys
import unittest
from unittest import mock

from test_host_capture_anchor import fixture_capture


def checked(argv):
    done = subprocess.run(argv, capture_output=True, text=True, timeout=90)
    if done.returncode:
        raise RuntimeError(done.stdout + done.stderr)
    return done.stdout.strip()


def select_interpreter(source):
    candidates = ('/Library/Developer/CommandLineTools/usr/bin/python3', '/usr/bin/python3') \
        if sys.platform == 'darwin' else ('/usr/bin/python3',)
    observations = []
    cache_parent = '/private/var/root' if sys.platform == 'darwin' else '/root'
    cache_prefix = cache_parent + '/openclaw-acceptance-bytecode-' + secrets.token_hex(16)
    code = ('import pathlib,sys,json; n={"__name__":"anchor_characterization","__file__":sys.argv[1]}; '
            'exec(compile(pathlib.Path(sys.argv[1]).read_bytes(),sys.argv[1],"exec"),n); '
            'print(json.dumps(n["trusted_interpreter"]()))')
    for candidate in candidates:
        if not pathlib.Path(candidate).is_file():
            observations.append({'candidate': candidate, 'present': False})
            continue
        done = subprocess.run([candidate, '-I', '-S', '-B', '-X', 'pycache_prefix=' + cache_prefix,
                               '-c', code, str(source)],
                              capture_output=True, text=True, timeout=90)
        observations.append({'candidate': candidate, 'returncode': done.returncode,
                             'detail': (done.stdout + done.stderr)[-3000:]})
        if done.returncode == 0:
            print(json.dumps({'interpreter_characterization': observations}), flush=True)
            return candidate, observations
    print(json.dumps({'interpreter_characterization': observations}), flush=True)
    raise RuntimeError('CI has no independently protected interpreter; anchor remains held')


def main(output):
    if (sys.platform not in ('darwin', 'linux') or os.getuid() == 0 or os.geteuid() == 0
            or os.environ.get('CI') != 'true' or os.environ.get('GITHUB_ACTIONS') != 'true'
            or os.environ.get('OPENCLAW_ANCHOR_PROBE') != '1'):
        raise RuntimeError('only the nonroot CI-owned anchor probe is enabled')
    root_home = '/private/var/root' if sys.platform == 'darwin' else '/root'
    input_parent = '/private/var/db' if sys.platform == 'darwin' else '/var/lib'
    chown = '/usr/sbin/chown' if sys.platform == 'darwin' else '/bin/chown'
    sudo = ['/usr/bin/sudo', '-n', '-H']
    source = pathlib.Path(__file__).with_name('host_capture_anchor.py')
    interpreter, characterization = select_interpreter(source)
    python = [interpreter, '-I', '-S', '-B', '-X',
              'pycache_prefix=' + root_home + '/openclaw-acceptance-bytecode-' + secrets.token_hex(16)]
    source_sha = hashlib.sha256(source.read_bytes()).hexdigest()
    bootstrap = '''import pathlib,sys,tempfile,hashlib,os,shutil,json
p=pathlib.Path(tempfile.mkdtemp(prefix="openclaw-acceptance-owned-",dir=sys.argv[3]))
inputs=None
store=None
try:
    os.chmod(p,0o700)
    b=pathlib.Path(sys.argv[1]).read_bytes()
    assert hashlib.sha256(b).hexdigest()==sys.argv[2]
    (p/"programs").mkdir(mode=0o700)
    (p/"programs"/"program.py").write_bytes(b)
    os.chmod(p/"programs"/"program.py",0o600)
    store=pathlib.Path(tempfile.mkdtemp(prefix="openclaw-acceptance-owned-",dir=sys.argv[4]))
    (store/"openclaw-acceptance-owned-records").mkdir(mode=0o700)
    inputs=pathlib.Path(tempfile.mkdtemp(prefix="openclaw-acceptance-input-",dir=sys.argv[4]))
    for path,mode in ((p,0o700),(p/"programs",0o700),(p/"programs"/"program.py",0o600),(store,0o755),
                      (store/"openclaw-acceptance-owned-records",0o700),(inputs,0o700)):
        if sys.platform == "linux":
            for name in os.listxattr(path):
                if name.startswith("system.posix_acl_"):
                    os.removexattr(path,name)
        os.chmod(path,mode)
    os.chown(inputs,int(sys.argv[5]),int(sys.argv[6]))
except BaseException:
    if inputs is not None:
        shutil.rmtree(inputs)
    if store is not None:
        shutil.rmtree(store)
    shutil.rmtree(p)
    raise
print(json.dumps({"root":str(p),"inputs":str(inputs),"store":str(store)}))
'''
    setup = json.loads(checked([*sudo, *python, '-c', bootstrap, str(source), source_sha,
                               root_home, input_parent, str(os.getuid()), str(os.getgid())]))
    base, inputs = pathlib.Path(setup['root']), pathlib.Path(setup['inputs'])
    if base.parent != pathlib.Path(root_home) or not base.name.startswith('openclaw-acceptance-owned-'):
        raise RuntimeError('CI root fixture path differs')
    if inputs.parent != pathlib.Path(input_parent) or not inputs.name.startswith('openclaw-acceptance-input-'):
        raise RuntimeError('CI capture input fixture path differs')
    store = pathlib.Path(setup['store'])
    if store.parent != pathlib.Path(input_parent) or not store.name.startswith('openclaw-acceptance-owned-'):
        raise RuntimeError('CI store fixture path differs')
    program = base / 'programs' / 'program.py'
    program_python = [interpreter, '-I', '-S', '-B', '-X',
                      'pycache_prefix=' + str(program.parent / 'bytecode-disabled')]
    parent = store
    root = parent / 'openclaw-acceptance-owned-records'
    case = unittest.TestCase('runTest')
    results = []
    try:
        with mock.patch.dict(os.environ, {'GITHUB_WORKSPACE': str(inputs)}):
            source_case, capture = fixture_capture(case)
        nonce, uid = source_case.nonce, os.getuid()
        final = root / (nonce + '.json')

        def action(name, error=None, flags=None):
            done = subprocess.run([*sudo, '/usr/bin/env', 'CI=true', 'GITHUB_ACTIONS=true',
                                   *(program_python if flags is None else flags),
                                   str(program), '--ci-owned', name, str(root),
                                   str(capture), str(uid), nonce],
                                  capture_output=True, text=True, timeout=90)
            if error is None:
                if done.returncode or 'owned byte anchor ' not in done.stdout:
                    raise RuntimeError(done.stdout + done.stderr)
            elif done.returncode == 0 or error not in done.stderr:
                raise RuntimeError('expected refusal ' + error + ': ' + done.stdout + done.stderr)
            results.append({'case': name if error is None else error, 'returncode': done.returncode})
            print(json.dumps(results[-1]), flush=True)

        def root_command(*args):
            return checked([*sudo, *args])

        action('publish')
        action('verify')
        action('verify', 'isolated Python', flags=[arg for arg in program_python if arg != '-I'])
        root_command(chown, str(uid), str(program.parent))
        action('verify', 'directory owner or mode differs')
        root_command(chown, '0', str(program.parent))
        root_command('/bin/chmod', '666', str(program))
        action('verify', 'input owner, mode or links differ')
        root_command('/bin/chmod', '600', str(program))
        root_command(chown, str(uid), str(program))
        action('verify', 'input owner, mode or links differ')
        root_command(chown, '0', str(program))
        for name, attempt in (
                ('user-read', lambda: final.read_bytes()),
                ('user-replace', lambda: final.write_bytes(b'forged')),
                ('user-root-entry', lambda: (root / 'forged').write_bytes(b'forged')),
                ('user-program-replace', lambda: program.write_bytes(b'forged'))):
            try:
                attempt()
            except PermissionError:
                results.append({'case': name, 'permission_denied': True})
            else:
                raise RuntimeError('independent owner boundary escaped: ' + name)

        action('publish', 'already exists')
        root_command('/bin/chmod', '755', str(root))
        action('verify', 'directory owner or mode differs')
        root_command('/bin/chmod', '700', str(root))
        root_command('/bin/chmod', '775', str(parent))
        action('verify', 'directory owner or mode differs')
        root_command('/bin/chmod', '755', str(parent))
        root_command(chown, str(uid), str(parent))
        action('verify', 'directory owner or mode differs')
        root_command(chown, '0', str(parent))
        if sys.platform == 'darwin':
            root_command('/bin/chmod', '+a', 'user:' + getpass.getuser() + ' allow list,search', str(root))
            action('verify', 'has an ACL')
            root_command('/bin/chmod', '-N', str(root))
        root_command('/bin/chmod', '644', str(final))
        action('verify', 'input owner, mode or links differ')
        root_command('/bin/chmod', '600', str(final))
        root_command(chown, str(uid), str(final))
        action('verify', 'input owner, mode or links differ')
        root_command(chown, '0', str(final))
        action('verify')

        clone, record = capture / 'powered-off-image.asif', capture / 'CAPTURE.json'
        clone_raw, record_raw = clone.read_bytes(), record.read_bytes()
        clone.write_bytes(b'coordinated owned clone rewrite')
        value = json.loads(record_raw)
        value.update(clone_image_sha256=hashlib.sha256(clone.read_bytes()).hexdigest(),
                     clone_size=clone.stat().st_size)
        record.write_bytes((json.dumps(value, sort_keys=True, separators=(',', ':')) + '\n').encode())
        action('verify', 'protected capture byte anchor differs')
        action('publish', 'already exists')
        clone.write_bytes(clone_raw)
        record.write_bytes(record_raw)
        action('verify')
        report = {'scope': 'CI-owned post-capture anchor only; no production installation or B8 acceptance',
                  'capture_uid': uid, 'authority_uid': 0, 'trusted_program_sha256': source_sha,
                  'interpreter_characterization': characterization,
                  'cases': results, 'completed': True}
    finally:
        case.doCleanups()
        cleanup = ('import pathlib,shutil,sys; p=pathlib.Path(sys.argv[1]); q=pathlib.Path(sys.argv[3]); '
                   'r=pathlib.Path(sys.argv[5]); '
                   'assert p.parent==pathlib.Path(sys.argv[2]) '
                   'and p.name.startswith("openclaw-acceptance-owned-"); '
                   'assert q.parent==pathlib.Path(sys.argv[4]) '
                   'and q.name.startswith("openclaw-acceptance-input-"); '
                   'assert r.parent==pathlib.Path(sys.argv[4]) '
                   'and r.name.startswith("openclaw-acceptance-owned-"); '
                   'shutil.rmtree(q); shutil.rmtree(r); shutil.rmtree(p)')
        checked([*sudo, *python, '-c', cleanup, str(base), root_home, str(inputs), input_parent, str(store)])
    output = pathlib.Path(output)
    with output.open('x') as stream:
        json.dump({**report, 'root_fixture_cleanup': 'removed'}, stream, sort_keys=True)
        stream.write('\n')
    print(json.dumps({'completed': True, 'cases': len(results), 'root_fixture_cleanup': 'removed'}))


if __name__ == '__main__':
    if len(sys.argv) != 2:
        raise RuntimeError('usage: probe_host_capture_anchor.py NEW_REPORT')
    main(sys.argv[1])
