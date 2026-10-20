"""Fresh disposable CI fixtures only; cleanup is not production reconciliation."""
import getpass
import hashlib
import json
import os
import pathlib
import subprocess
import sys

from probe_host_capture_anchor import select_interpreter
from test_host_release_publish import load


STEP = pathlib.Path(__file__).resolve().parent
SETUP = r'''
import hashlib,json,os,pathlib,shutil,stat,sys,tempfile
source,expected,raw,names,home,input_parent,uid,gid,owner=sys.argv[1:]
uid,gid,owner=map(int,(uid,gid,owner)); names=json.loads(names)
p=q=None
def read(path,limit):
    fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK)
    try:
        info=os.fstat(fd)
        assert stat.S_ISREG(info.st_mode) and 0<info.st_size<=limit
        result=b''
        while len(result)<=limit:
            block=os.read(fd,65536)
            if not block:break
            result+=block
        assert len(result)==info.st_size and len(result)<=limit
        return result
    finally:os.close(fd)
try:
    code=read(source,512*1024); assert hashlib.sha256(code).hexdigest()==expected
    release=json.loads(raw); assert set(release['files'])==set(names) and len(names)==12
    p=pathlib.Path(tempfile.mkdtemp(prefix='openclaw-release-publish-owned-',dir=home))
    q=pathlib.Path(tempfile.mkdtemp(prefix='openclaw-release-publish-input-',dir=input_parent))
    os.chmod(p,0o700);os.chmod(q,0o700)
    (p/'programs').mkdir(mode=0o700)
    (p/'host_release_publish.py').write_bytes(code);os.chmod(p/'host_release_publish.py',0o600)
    assert len(raw.encode())<=65536
    (p/'approved.json').write_text(raw);os.chmod(p/'approved.json',0o600)
    for name in names:
        assert pathlib.Path(name).name==name and name.endswith('.py')
        data=read(pathlib.Path(source).with_name(name),2*1024*1024)
        assert {'size':len(data),'sha256':hashlib.sha256(data).hexdigest()}==release['files'][name]
        (q/name).write_bytes(data);os.chmod(q/name,0o600);os.chown(q/name,owner,gid)
    os.chown(q,owner,gid)
    print(json.dumps({'base':str(p),'input':str(q),'base_inode':p.stat().st_ino,
                      'input_inode':q.stat().st_ino,'payload_uid':owner}))
except BaseException:
    if q is not None:shutil.rmtree(q)
    if p is not None:shutil.rmtree(p)
    raise
'''

INSPECT = r'''
import hashlib,json,os,pathlib,sys
base,digest,expected=sys.argv[1:];p=pathlib.Path(base);final=p/'programs'/digest
manifest=(final/'release.json').read_bytes();value=json.loads(manifest)
assert hashlib.sha256(manifest).hexdigest()==digest
assert set(x.name for x in final.iterdir())=={'src','release.json'}
assert set(x.name for x in (final/'src').iterdir())==set(value['files'])
bindings={}
for name in value['files']:
    path=final/'src'/name;b=path.read_bytes();s=path.stat()
    assert s.st_uid==0 and s.st_mode&0o7777==0o600 and s.st_nlink==1
    bindings[name]={'size':len(b),'sha256':hashlib.sha256(b).hexdigest()}
assert bindings==value['files']
anchor=final/'src'/'host_capture_anchor.py'
assert hashlib.sha256(anchor.read_bytes()).hexdigest()==expected
ns={'__name__':'publication_consumer','__file__':str(anchor)}
exec(compile(anchor.read_bytes(),str(anchor),'exec'),ns)
with ns['approved_release'](final/'release.json',digest) as release:
    release['check']();assert release['hashes']=={k:v['sha256'] for k,v in bindings.items()}
runtime=ns['trusted_runtime']()
print(json.dumps({'publisher_uid':os.getuid(),'consumer_checked':True,
                  'trusted_runtime_checked':True,'bindings':bindings,'runtime':runtime,
                  'bundle_inode':final.stat().st_ino,'src_inode':(final/'src').stat().st_ino}))
'''

RETAINED = r'''
import json,os,pathlib,sys
p=pathlib.Path(sys.argv[1]);digest=sys.argv[2];pid=int(sys.argv[3]) if len(sys.argv)>3 else None
pending=p/'programs'/('.pending-'+digest);final=p/'programs'/digest
files=[]
if pending.exists():
    for node in sorted(pending.iterdir()):
        if node.is_dir():
            assert node.name=='src'
            for child in sorted(node.iterdir()):
                s=child.lstat();files.append({'name':'src/'+child.name,'size':s.st_size,
                                             'inode':s.st_ino,'uid':s.st_uid})
        else:
            s=node.lstat();files.append({'name':node.name,'size':s.st_size,'inode':s.st_ino,'uid':s.st_uid})
assert len(files)<=13 and sum(x['size'] for x in files)<=24*1024*1024+65536
absent=None
if pid is not None:
    try:os.kill(pid,0)
    except ProcessLookupError:absent=True
    else:absent=False
print(json.dumps({'pending':pending.exists(),'pending_inode':pending.stat().st_ino if pending.exists() else None,
                  'final':final.exists(),'files':files,'bytes':sum(x['size'] for x in files),
                  'worker_pid_absent':absent}))
'''

KERNEL = r'''
import hashlib,json,os,pathlib,sys
p=pathlib.Path(sys.argv[1]);expected=sys.argv[2];raw=(p/'host_release_publish.py').read_bytes()
assert hashlib.sha256(raw).hexdigest()==expected
ns={'__name__':'owned_kernel','__file__':str(p/'host_release_publish.py')};exec(compile(raw,ns['__file__'],'exec'),ns)
observations=[]
with ns['directory'](p,{0},True,ns['Deadline']()) as parent:
    for kind in ('empty','nonempty','symlink'):
        source=p/('stage-'+kind);target=p/('target-'+kind);source.mkdir(mode=0o700)
        if kind=='symlink':target.symlink_to(p/'programs',target_is_directory=True)
        else:
            target.mkdir(mode=0o700)
            if kind=='nonempty':(target/'retain').write_bytes(b'fixture')
        before=target.lstat().st_ino
        try:ns['exclusive_rename'](parent,source.name,target.name)
        except OSError as e:assert e.errno==17
        else:raise RuntimeError('kernel replaced existing destination')
        assert target.lstat().st_ino==before and source.is_dir()
        observations.append({'case':kind,'errno':17,'target_inode_unchanged':True,'stage_retained':True})
print(json.dumps(observations))
'''

PAUSE = r'''
import hashlib,os,pathlib,signal,stat,sys
path=pathlib.Path(sys.argv[1]);expected=sys.argv[2];args=sys.argv[3:];raw=path.read_bytes()
assert hashlib.sha256(raw).hexdigest()==expected
ns={'__name__':'owned_interruption','__file__':str(path)};exec(compile(raw,str(path),'exec'),ns)
original=ns['os'].fsync;paused=False
def sync(fd):
    global paused
    result=original(fd)
    if stat.S_ISREG(os.fstat(fd).st_mode) and not paused:
        paused=True
        print('PAUSED '+str(os.getpid()),flush=True)
        os.kill(os.getpid(),signal.SIGSTOP)
    return result
ns['os'].fsync=sync;sys.argv=[str(path),*args];ns['cli']()
'''


DRIVER = r'''
import json,os,selectors,signal,subprocess,sys
args=json.loads(sys.argv[1]);interrupt=sys.argv[2]=='interrupt'
p=subprocess.Popen(args,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,start_new_session=True)
result={'pid':p.pid,'pgid':p.pid,'timed_out':False,'interruption_observed':False,'waited':False}
prefix=''
try:
    if interrupt:
        with selectors.DefaultSelector() as selector:
            selector.register(p.stdout,selectors.EVENT_READ)
            if not selector.select(120):raise subprocess.TimeoutExpired(args,120)
            prefix=p.stdout.readline(256)
        assert prefix.strip()=='PAUSED '+str(p.pid)
        result['interruption_observed']=True
        os.killpg(p.pid,signal.SIGKILL)
    out,err=p.communicate(timeout=120 if not interrupt else 10)
    result['waited']=True
except BaseException as error:
    result['timed_out']=isinstance(error,subprocess.TimeoutExpired)
    result['control_error']=type(error).__name__
    for sig in (signal.SIGTERM,signal.SIGKILL):
        try:os.killpg(p.pid,sig)
        except ProcessLookupError:pass
        try:
            out,err=p.communicate(timeout=5);result['waited']=True;break
        except subprocess.TimeoutExpired:pass
    else:out,err='','unreaped owned worker'
result['returncode']=p.returncode
try:os.killpg(p.pid,0)
except ProcessLookupError:result['group_absent']=True
else:result['group_absent']=False
assert len(out.encode())+len(err.encode())<=131072
result.update(stdout=out,stderr=err,phase_stdout=prefix)
print(json.dumps(result))
'''


def checked(argv, timeout=150):
    done = subprocess.run(argv, capture_output=True, text=True, timeout=timeout)
    if done.returncode:
        raise RuntimeError((done.stdout + done.stderr)[-4000:])
    return done.stdout.strip()


def main(output):
    if (sys.platform not in ('darwin', 'linux') or os.getuid() == 0 or os.geteuid() == 0
            or os.environ.get('CI') != 'true' or os.environ.get('GITHUB_ACTIONS') != 'true'
            or os.environ.get('OPENCLAW_RELEASE_PUBLISH_PROBE') != '1'):
        raise RuntimeError('only the nonroot disposable CI publication probe is enabled')
    m = load()
    uid, gid = os.getuid(), os.getgid()
    source = STEP / 'host_release_publish.py'
    publisher_sha = hashlib.sha256(source.read_bytes()).hexdigest()
    bindings = {name: {'size': (STEP / name).stat().st_size,
                       'sha256': hashlib.sha256((STEP / name).read_bytes()).hexdigest()}
                for name in m.NAMES}
    manifest = m.encoded({'schema': m.SCHEMA, 'files': bindings})
    digest = hashlib.sha256(manifest).hexdigest()
    home = '/private/var/root' if sys.platform == 'darwin' else '/root'
    inputs = '/private/var/db' if sys.platform == 'darwin' else '/var/lib'
    interpreter, characterization = select_interpreter(STEP / 'host_capture_anchor.py')
    sudo = ['/usr/bin/sudo', '-n', '-H']
    fixtures = []
    results = []
    report = {'scope': 'fresh disposable CI publication mechanism; no host installation/admission',
              'capture_uid': uid, 'publisher_uid': 0, 'publisher_sha256': publisher_sha,
              'publisher_size': source.stat().st_size, 'release_sha256': digest,
              'manifest_size': len(manifest), 'bindings': bindings,
              'interpreter_characterization': characterization, 'cases': results,
              'completed': False, 'cleanup': []}

    def python(base, prefix=None):
        return [interpreter, '-I', '-S', '-B', '-X',
                'pycache_prefix=' + str(prefix or pathlib.Path(base) / 'bytecode-disabled')]

    def setup(owner=uid):
        fixture = json.loads(checked([*sudo, *python(home), '-c', SETUP, str(source),
            publisher_sha, manifest.decode(), json.dumps(sorted(m.NAMES)), home, inputs,
            str(uid), str(gid), str(owner)]))
        base, payload = pathlib.Path(fixture['base']), pathlib.Path(fixture['input'])
        if (base.parent != pathlib.Path(home) or not base.name.startswith('openclaw-release-publish-owned-')
                or payload.parent != pathlib.Path(inputs)
                or not payload.name.startswith('openclaw-release-publish-input-')):
            raise RuntimeError('created fixture identity differs')
        fixtures.append(fixture)
        tool = ['/usr/bin/shasum', '-a', '256', '--'] if sys.platform == 'darwin' else ['/usr/bin/sha256sum', '--']
        observed = checked([*sudo, *tool, str(base / 'host_release_publish.py')]).split()[0]
        if observed != publisher_sha:
            raise RuntimeError('protected fixture publisher digest differs before execution')
        fixture['protected_publisher_digest_checked'] = True
        return fixture

    def argv(fixture, expected=digest):
        base = pathlib.Path(fixture['base'])
        return [str(base / 'host_release_publish.py'), '--ci-owned', m.FIXTURE_UUID,
                fixture['input'], str(base / 'approved.json'), str(base / 'programs'),
                str(uid), str(fixture['payload_uid']), expected]

    def driven(fixture, args, interrupt=False):
        try:
            result = json.loads(checked([*sudo, '/usr/bin/env', 'CI=true', 'GITHUB_ACTIONS=true',
                *python(fixture['base']), '-c', DRIVER, json.dumps(args),
                'interrupt' if interrupt else 'normal'], timeout=180))
        except BaseException:
            fixture['unresolved_worker'] = True
            raise
        if not result['waited'] or not result['group_absent']:
            fixture['unresolved_worker'] = True
            raise RuntimeError('owned worker group cleanup unresolved')
        return result

    def action(fixture, refusal=None, expected=digest):
        done = driven(fixture, [*python(fixture['base']), *argv(fixture, expected)])
        execution = {key: value for key, value in done.items() if key not in ('stdout', 'stderr')}
        if refusal:
            if done['returncode'] == 0 or done['stdout'] or refusal not in done['stderr']:
                raise RuntimeError('expected publication refusal: ' + done['stdout'] + done['stderr'])
            return {'returncode': done['returncode'], 'refusal': refusal,
                    'success_receipt_absent': True, 'execution': execution}
        if done['returncode'] or done['timed_out'] or 'control_error' in done:
            raise RuntimeError(done['stdout'] + done['stderr'])
        value = json.loads(done['stdout'])
        if (value['release_sha256'] != digest or set(value['files']) != m.NAMES
                or any({k: v for k, v in value['files'][name].items() if k in ('size', 'sha256')}
                       != binding for name, binding in bindings.items())):
            raise RuntimeError('actual publication receipt bindings differ')
        return {'receipt': value, 'execution': execution}

    def observe(fixture, pid=None):
        return json.loads(checked([*sudo, *python(fixture['base']), '-c', RETAINED,
                                  fixture['base'], digest, *([] if pid is None else [str(pid)])]))

    def root_code(fixture, script, *args):
        return checked([*sudo, *python(fixture['base']), '-c', script, fixture['base'], *args])

    def consumer(fixture):
        base = pathlib.Path(fixture['base'])
        final = base / 'programs' / digest
        return json.loads(checked([*sudo, *python(base, final / 'src' / 'bytecode-disabled'),
            '-c', INSPECT, str(base), digest, bindings['host_capture_anchor.py']['sha256']]))

    primary = None
    try:
        for owner in (uid, 0, 65534):
            fixture = setup(owner)
            outcome = action(fixture)
            receipt = outcome['receipt']
            base = pathlib.Path(fixture['base'])
            final = base / 'programs' / digest
            compatibility = consumer(fixture)
            denied = []
            for name, attempt in (
                ('list-release', lambda: list(final.iterdir())),
                ('read-program', lambda: (final / 'src' / 'host_capture_anchor.py').read_bytes()),
                ('replace-program', lambda: (final / 'src' / 'host_capture_anchor.py').write_bytes(b'BAD')),
                ('create-release', lambda: (base / 'programs' / 'forged').mkdir())):
                try:
                    attempt()
                except PermissionError:
                    denied.append(name)
                else:
                    raise RuntimeError('capture owner escaped private destination: ' + name)
            again = action(fixture, 'destination already exists')
            results.append({'case': 'honest-payload-owner-' + str(owner), 'receipt': receipt,
                            'execution': outcome['execution'], 'consumer': compatibility,
                            'capture_denied': denied, 'repeat': again})
            print(json.dumps({'case': results[-1]['case'], 'consumer_checked': True,
                              'capture_denied': len(denied)}), flush=True)

        fixture = setup()
        refusal = action(fixture, 'not independently approved', expected='f' * 64)
        retained = observe(fixture)
        if retained['pending'] or retained['final']:
            raise RuntimeError('wrong approval reached staging')
        results.append({'case': 'wrong-independent-approval', **refusal, 'retained': retained})

        fixture = setup()
        kernel = json.loads(root_code(fixture, KERNEL, publisher_sha))
        results.append({'case': 'actual-kernel-existing-targets', 'observations': kernel})

        fixture = setup()
        if sys.platform == 'darwin':
            checked([*sudo, '/bin/chmod', '+a', 'user:' + getpass.getuser() + ' allow list,add_file,search',
                     str(pathlib.Path(fixture['base']) / 'programs')])
        else:
            root_code(fixture, '''import os,pathlib,struct,sys
p=pathlib.Path(sys.argv[1])/'programs';uid=int(sys.argv[2])
entries=((1,7,0xffffffff),(2,7,uid),(4,0,0xffffffff),(16,0,0xffffffff),(32,0,0xffffffff))
os.setxattr(p,'system.posix_acl_access',struct.pack('<I',2)+b''.join(struct.pack('<HHI',*e) for e in entries))
os.chmod(p,0o700)
''', str(uid))
        results.append({'case': 'actual-destination-ACL', **action(fixture, 'ACL')})

        fixture = setup()
        root_code(fixture, 'import os,pathlib,sys;os.chown(pathlib.Path(sys.argv[1])/"programs",int(sys.argv[2]),-1)', str(uid))
        results.append({'case': 'capture-owned-destination', **action(fixture, 'directory shape')})

        fixture = setup()
        target = pathlib.Path(fixture['input']) / sorted(m.NAMES)[0]
        if sys.platform == 'darwin':
            checked(['/usr/bin/xattr', '-w', 'com.openclaw.publish-test', 'fixture', str(target)])
        else:
            os.setxattr(target, 'user.openclaw.publish-test', b'fixture')
        results.append({'case': 'actual-payload-xattr', **action(fixture, 'xattrs')})

        fixture = setup()
        import concurrent.futures
        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
            futures = [pool.submit(driven, fixture, [*python(fixture['base']), *argv(fixture)])
                       for _ in range(2)]
            outcomes = [future.result() for future in futures]
        for outcome in outcomes:
            out = outcome.pop('stdout')
            outcome['receipt'] = json.loads(out) if out else None
            outcome['refusal'] = outcome.pop('stderr')[-512:]
        if sum(item['returncode'] == 0 and item['receipt'] is not None for item in outcomes) != 1:
            raise RuntimeError('same-release concurrency did not yield exactly one receipt')
        retained = observe(fixture)
        if not retained['final']:
            raise RuntimeError('concurrent final bundle absent')
        results.append({'case': 'same-release-concurrency', 'outcomes': outcomes, 'retained': retained,
                        'consumer': consumer(fixture)})

        fixture = setup()
        base = pathlib.Path(fixture['base'])
        interrupted = driven(fixture, [*python(base), '-c', PAUSE,
            str(base / 'host_release_publish.py'), publisher_sha, *argv(fixture)[1:]], interrupt=True)
        retained = observe(fixture, interrupted['pid'])
        if (interrupted['returncode'] == 0 or interrupted['stdout'].strip()
                or not interrupted['interruption_observed'] or not retained['pending'] or retained['final']
                or not retained['worker_pid_absent'] or not retained['files']):
            raise RuntimeError('interruption did not retain a bounded denied attempt')
        retry = action(fixture, 'FileExistsError')
        results.append({'case': 'actual-worker-interruption', 'execution': interrupted,
                        'success_receipt_absent': True, 'retained': retained, 'repeat_refused': retry})
        report['completed'] = True
    except BaseException as error:
        primary = error
        report['error'] = (type(error).__name__ + ': ' + str(error))[-4000:]
    finally:
        for fixture in reversed(fixtures):
            if fixture.get('unresolved_worker'):
                report['completed'] = False
                report['cleanup'].append({'base': fixture['base'], 'removed': False,
                                          'error': 'owned worker unresolved; fixture retained'})
                continue
            try:
                result = json.loads(root_code(fixture, '''import json,pathlib,shutil,sys
p=pathlib.Path(sys.argv[1]);q=pathlib.Path(sys.argv[2]);a,b=map(int,sys.argv[3:])
assert p.name.startswith('openclaw-release-publish-owned-') and q.name.startswith('openclaw-release-publish-input-')
assert p.lstat().st_ino==a and q.lstat().st_ino==b and not p.is_symlink() and not q.is_symlink()
shutil.rmtree(q);shutil.rmtree(p)
print(json.dumps({'base':str(p),'input':str(q),'removed':not p.exists() and not q.exists(),
                  'scope':'enumerated CI fixture cleanup only; not publication reconciliation'}))
''', fixture['input'], str(fixture['base_inode']), str(fixture['input_inode'])))
                report['cleanup'].append(result)
            except BaseException as error:
                report['completed'] = False
                report['cleanup'].append({'base': fixture['base'], 'removed': False,
                                          'error': str(error)[-1000:]})
                if primary is None:
                    primary = error
        output = pathlib.Path(output)
        output.write_text(json.dumps(report, sort_keys=True, indent=2) + '\n')
        os.chmod(output, 0o600)
    if primary is not None:
        raise primary
    print(json.dumps({'publication_cases': len(results), 'fixture_roots': len(fixtures),
                      'completed': report['completed'], 'fixture_cleanup': 'removed'}), flush=True)


if __name__ == '__main__':
    if len(sys.argv) != 2:
        raise SystemExit('requires one retained report path')
    main(sys.argv[1])
