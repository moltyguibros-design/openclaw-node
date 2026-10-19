"""CI-only distinct-owner proof with a trusted temporary program copy; no VM resources."""
import getpass
import hashlib
import json
import os
import pathlib
import subprocess
import sys
import unittest

from test_host_capture_anchor import fixture_capture


def checked(argv):
    done = subprocess.run(argv, capture_output=True, text=True, timeout=90)
    if done.returncode:
        raise RuntimeError(done.stdout + done.stderr)
    return done.stdout.strip()


def main(output):
    if (sys.platform not in ('darwin', 'linux') or os.getuid() == 0 or os.geteuid() == 0
            or os.environ.get('CI') != 'true' or os.environ.get('GITHUB_ACTIONS') != 'true'
            or os.environ.get('OPENCLAW_ANCHOR_PROBE') != '1'):
        raise RuntimeError('only the nonroot CI-owned anchor probe is enabled')
    root_home = '/private/var/root' if sys.platform == 'darwin' else '/root'
    chown = '/usr/sbin/chown' if sys.platform == 'darwin' else '/bin/chown'
    sudo = ['/usr/bin/sudo', '-n', '-H']
    python = ['/usr/bin/python3', '-I', '-S', '-B']
    source = pathlib.Path(__file__).with_name('host_capture_anchor.py')
    source_sha = hashlib.sha256(source.read_bytes()).hexdigest()
    bootstrap = '''import pathlib,sys,tempfile,hashlib,os,shutil
p=pathlib.Path(tempfile.mkdtemp(prefix="openclaw-acceptance-owned-",dir=sys.argv[3]))
try:
    os.chmod(p,0o700)
    b=pathlib.Path(sys.argv[1]).read_bytes()
    assert hashlib.sha256(b).hexdigest()==sys.argv[2]
    (p/"program.py").write_bytes(b)
    os.chmod(p/"program.py",0o600)
    (p/"data").mkdir(mode=0o700)
    (p/"data"/"openclaw-acceptance-owned-records").mkdir(mode=0o700)
except BaseException:
    shutil.rmtree(p)
    raise
print(p)
'''
    base = pathlib.Path(checked([*sudo, *python, '-c', bootstrap, str(source), source_sha, root_home]))
    if base.parent != pathlib.Path(root_home) or not base.name.startswith('openclaw-acceptance-owned-'):
        raise RuntimeError('CI root fixture path differs')
    program = base / 'program.py'
    parent = base / 'data'
    root = parent / 'openclaw-acceptance-owned-records'
    case = unittest.TestCase('runTest')
    results = []
    try:
        source_case, capture = fixture_capture(case)
        nonce, uid = source_case.nonce, os.getuid()
        final = root / (nonce + '.json')

        def action(name, error=None):
            done = subprocess.run([*sudo, '/usr/bin/env', 'CI=true', 'GITHUB_ACTIONS=true',
                                   *python, str(program), '--ci-owned', name, str(root),
                                   str(capture), str(uid), nonce],
                                  capture_output=True, text=True, timeout=90)
            if error is None:
                if done.returncode or 'owned byte anchor ' not in done.stdout:
                    raise RuntimeError(done.stdout + done.stderr)
            elif done.returncode == 0 or error not in done.stderr:
                raise RuntimeError('expected refusal ' + error + ': ' + done.stdout + done.stderr)
            results.append({'case': name if error is None else error, 'returncode': done.returncode})

        def root_command(*args):
            return checked([*sudo, *args])

        action('publish')
        action('verify')
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
        root_command('/bin/chmod', '700', str(parent))
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
                  'cases': results, 'completed': True}
    finally:
        case.doCleanups()
        cleanup = ('import pathlib,shutil,sys; p=pathlib.Path(sys.argv[1]); '
                   'assert p.parent==pathlib.Path(sys.argv[2]) '
                   'and p.name.startswith("openclaw-acceptance-owned-"); shutil.rmtree(p)')
        checked([*sudo, *python, '-c', cleanup, str(base), root_home])
    output = pathlib.Path(output)
    with output.open('x') as stream:
        json.dump({**report, 'root_fixture_cleanup': 'removed'}, stream, sort_keys=True)
        stream.write('\n')
    print(json.dumps({'completed': True, 'cases': len(results), 'root_fixture_cleanup': 'removed'}))


if __name__ == '__main__':
    if len(sys.argv) != 2:
        raise RuntimeError('usage: probe_host_capture_anchor.py NEW_REPORT')
    main(sys.argv[1])
