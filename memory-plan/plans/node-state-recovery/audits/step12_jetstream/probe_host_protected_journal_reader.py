"""CI-only synthetic ASIF/root-authority proof; no VM or production resource."""
import hashlib
import json
import os
import pathlib
import shutil
import stat
import subprocess
import sys
import tempfile


def write_report(output, report):
    staged = output.with_name(output.name + '.next')
    fd = os.open(staged, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, 'w', encoding='utf-8') as handle:
        json.dump(report, handle, sort_keys=True, indent=2)
        handle.write('\n')
        handle.flush()
        os.fchmod(handle.fileno(), 0o644)
        os.fsync(handle.fileno())
    os.replace(staged, output)
    fd = os.open(output.parent, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def main(output):
    if (sys.platform != 'darwin' or os.getuid() != 0 or os.geteuid() != 0
            or os.environ.get('CI') != 'true' or os.environ.get('GITHUB_ACTIONS') != 'true'
            or os.environ.get('OPENCLAW_PROTECTED_READER_PROBE') != '1'):
        raise RuntimeError('explicit CI-only macOS root protected-reader probe required')
    capture_uid, capture_gid = int(os.environ['SUDO_UID']), int(os.environ['SUDO_GID'])
    if capture_uid <= 0 or capture_uid == 65534:
        raise RuntimeError('distinct nonroot CI capture user required')

    import host_capture_anchor as anchor
    import host_guest_commit as commit
    import host_journal_mount as mount
    import host_protected_journal_reader as reader
    import host_vm_capture as capture_module
    from probe_host_capture_anchor import select_interpreter
    from probe_asif_mount_ownership import (attach, checked, image_state, mount_at, release,
                                          seed_reader_fixture, settled, change_reader_seed)

    step = pathlib.Path(__file__).resolve().parent
    interpreter, characterization = select_interpreter(step / 'host_capture_anchor.py')
    code = pathlib.Path(tempfile.mkdtemp(prefix='openclaw-acceptance-owned-code-', dir='/private/var/root'))
    fixtures = pathlib.Path(tempfile.mkdtemp(prefix='openclaw-q-fixtures-', dir='/private/var/root'))
    inputs = pathlib.Path(tempfile.mkdtemp(prefix='openclaw-acceptance-input-', dir='/private/var/db'))
    store = pathlib.Path(tempfile.mkdtemp(prefix='openclaw-acceptance-owned-store-', dir='/private/var/db'))
    for path in (code, fixtures, inputs, store):
        path.chmod(0o700)
    os.chown(inputs, capture_uid, capture_gid)
    hashes = {}
    for name in (*anchor.READER_MODULES, 'host_capture_anchor'):
        path = code / (name + '.py')
        raw = (step / path.name).read_bytes()
        path.write_bytes(raw)
        path.chmod(0o600)
        hashes[path.name] = hashlib.sha256(raw).hexdigest()
    program = [interpreter, '-I', '-S', '-B', '-X', 'pycache_prefix=' + str(code / 'bytecode-disabled'),
               str(code / 'host_capture_anchor.py'), '--ci-owned']
    environment = {'PATH': '/usr/bin:/bin:/usr/sbin:/sbin', 'LC_ALL': 'C',
                   'CI': 'true', 'GITHUB_ACTIONS': 'true', 'SUDO_UID': str(capture_uid)}
    report = {'scope': 'CI-only protected synthetic journal reader; no B3/B8/VM/installation',
              'capture_uid': capture_uid, 'guest_uid': 65534, 'writer_uid': 0, 'authority_uid': 0,
              'code_sha256': hashes, 'interpreter_characterization': characterization,
              'cases': [], 'completed': False,
              'cleanup': {'clean': False, 'removed': False, 'state': 'not-yet-observed'}}
    fd = os.open(output, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    os.close(fd)
    write_report(output, report)
    images, disks, points = [], [], []
    clean = True
    error = None

    def action(name, root, capture, nonce, guest=65534, writer=0, capture_owner=None, refusal=None):
        owner = capture_uid if capture_owner is None else capture_owner
        args = [*program, name, str(root), str(capture), str(owner), nonce]
        if name in ('read', 'receipt'):
            args.extend((str(guest), str(writer)))
        done = subprocess.run(args, env={**environment, 'SUDO_UID': str(owner)},
                              capture_output=True, text=True, timeout=180)
        if refusal is not None:
            if done.returncode == 0 or refusal not in done.stderr:
                raise RuntimeError('wrong native refusal: ' + done.stdout[-500:] + done.stderr[-3000:])
            return {'returncode': done.returncode, 'refusal': refusal}
        if done.returncode:
            raise RuntimeError(done.stdout[-1000:] + done.stderr[-5000:])
        return json.loads(done.stdout) if name in ('read', 'receipt') else done.stdout.strip()

    def as_capture(code_text, *args):
        def demote():
            os.setgroups([])
            os.setgid(capture_gid)
            os.setuid(capture_uid)
        done = subprocess.run([interpreter, '-I', '-S', '-B', '-c', code_text, *map(str, args)],
                              preexec_fn=demote, capture_output=True, text=True, timeout=30)
        if done.returncode:
            raise RuntimeError('capture-user proof failed: ' + done.stdout + done.stderr)

    def denied(path):
        as_capture('import pathlib,sys; p=pathlib.Path(sys.argv[1]); '
                   '\ntry: p.read_bytes()\nexcept PermissionError: pass\nelse: raise AssertionError("protected read allowed")'
                   '\ntry: p.write_bytes(b"forged")\nexcept PermissionError: pass\nelse: raise AssertionError("protected write allowed")', path)

    cases = (('intact', None), ('wrong-guest', 'not owner-private'),
             ('wrong-writer', 'lacks writer exclusion'), ('capture-guest-swap', 'directory owner or mode differs'),
             ('corrupt-chain', 'journal chain differs'), ('coordinated-rewrite', 'protected capture byte anchor differs'),
             ('flagged-source', 'source image flags or xattrs differ'),
             ('source-xattr', 'source image flags or xattrs differ'))
    try:
        for name, refusal in cases:
            report['active_case'] = name
            write_report(output, report)
            capture = inputs / ('capture-' + name)
            capture.mkdir(mode=0o700)
            image = capture / anchor.CLONE
            images.append(image)
            root = store / ('openclaw-acceptance-owned-' + name)
            root.mkdir(mode=0o700)
            point = fixtures / ('seed-mount-' + name)
            points.append(point)
            checked(mount.attempt(mount.DISKUTIL, 'image', 'create', 'blank', '--format', 'ASIF',
                                  '--size', '64m', '--fs', 'APFS', '--volumeName', 'Data', str(image)), 'create')
            image.chmod(0o600)
            attached = attach(image, disks)
            try:
                mount_at(point, attached['volume'])
                checked(mount.attempt(mount.DISKUTIL, 'enableOwnership', str(point)), 'enableOwnership')
                seed = fixtures / ('seed-' + name)
                expected = seed_reader_fixture(capture, seed, attached['info']['VolumeUUID'])
                shutil.copytree(seed / 'Users', point / 'Users')
                if name == 'corrupt-chain':
                    change_reader_seed(point, name)
                for path in [point / 'Users', *(point / 'Users').rglob('*')]:
                    os.chown(path, 65534, -1)
            finally:
                cleanup, late = release(image, [point], disks)
            settled(cleanup, late, 'protected reader seed', disks)
            point.rmdir()
            before = image_state(image)
            capture_module.publish_pinned_capture(capture, {
                'scope': capture_module.CAPTURE_SCOPE, 'vm_state_at_final_check': 'stopped',
                'vm_uuid': capture_module.FIXTURE_UUID, 'clone_image_sha256': before['sha256'],
                'clone_size': before['size'], 'data_volume_uuid': expected['data_volume_uuid']},
                commit.require_committed(capture)['checkpoint'], window_pins_source=capture / 'WINDOW_PINS.json')
            nonce = json.loads((capture / 'ARMED.json').read_bytes())['capture_nonce']
            for path in [capture, *capture.rglob('*')]:
                os.chown(path, capture_uid, capture_gid)
            action('publish', root, capture, nonce)
            protected_anchor = root / (nonce + '.json')
            anchor_bytes = protected_anchor.read_bytes()
            if name == 'coordinated-rewrite':
                as_capture('import pathlib,json,hashlib,sys; p=pathlib.Path(sys.argv[1]); '
                           'c=p/"powered-off-image.asif"; c.write_bytes(b"owned coordinated rewrite"); '
                           'r=p/"CAPTURE.json"; v=json.loads(r.read_bytes()); '
                           'v.update(clone_image_sha256=hashlib.sha256(c.read_bytes()).hexdigest(),clone_size=c.stat().st_size); '
                           'r.write_text(json.dumps(v,sort_keys=True,separators=(",",":"))+"\\n")', capture)
                anchor.snapshot(capture, capture_uid, nonce)
            if name == 'flagged-source':
                os.chflags(image, stat.UF_IMMUTABLE)
            if name == 'source-xattr':
                checked(mount.attempt('/usr/bin/xattr', '-w', 'openclaw-owned-q', 'unexpected', str(image)), 'xattr')
            row = {'case': name, 'expected_refusal': refusal}
            source_before_read = image_state(image)
            result = action('read', root, capture, nonce, guest=0 if name == 'wrong-guest' else
                            capture_uid if name == 'capture-guest-swap' else 65534,
                            writer=65534 if name == 'wrong-writer' else 0,
                            capture_owner=65534 if name == 'capture-guest-swap' else capture_uid, refusal=refusal)
            pending, final, staged = (root / item for item in reader.names(nonce))
            if refusal is None:
                if (result != action('receipt', root, capture, nonce) or pending.exists() or staged.exists()
                        or result['reader']['checkpoint_sha256'] != expected['checkpoint_sha256']
                        or result['reader']['pre_head'] != expected['pre_head']
                        or not result['reader']['read'] or any(item['uid'] != 65534 for item in result['reader']['read'])
                        or result['copy']['uid'] != 0 or result['copy']['mode'] != 0o600
                        or result['copy']['flags'] != 0 or result['copy']['xattrs'] != []
                        or result['code_sha256'] != hashes or not result['cleanup']['clean']):
                    raise RuntimeError('protected native semantic receipt differs')
                denied(final)
                denied(root / 'capture-user-cannot-traverse')
                row.update(receipt_sha256=hashlib.sha256(final.read_bytes()).hexdigest(),
                           semantic_checkpoint=result['reader']['checkpoint_sha256'],
                           read_files=len(result['reader']['read']), copy=result['copy'],
                           cleanup=result['cleanup'], protected_user_access='denied')
            else:
                if final.exists():
                    raise RuntimeError('refused reader published a receipt')
                if pending.exists():
                    failure = json.loads((pending / 'FAILED.json').read_bytes())
                    if not failure['cleanup'] or not failure['cleanup']['clean']:
                        raise RuntimeError('native refusal did not clean its mount')
                    row['cleanup'] = failure['cleanup']
                    action('receipt', root, capture, nonce, refusal='publication is incomplete')
                row.update(result)
            if image_state(image) != source_before_read:
                raise RuntimeError('source image bytes or identity changed during Q')
            row['source_unchanged_during_read'] = True
            if protected_anchor.read_bytes() != anchor_bytes:
                raise RuntimeError('protected anchor changed')
            if name == 'flagged-source':
                os.chflags(image, 0)
            if name == 'source-xattr':
                checked(mount.attempt('/usr/bin/xattr', '-d', 'openclaw-owned-q', str(image)), 'remove xattr')
            report['cases'].append(row)
            report['active_case'] = None
            write_report(output, report)
            print('protected native reader completed: ' + name, flush=True)
        report['completed'] = True
    except BaseException as failure:
        error = failure
        report['error'] = repr(failure)[:2000]
    finally:
        for image in images:
            if image.exists() and image.stat().st_flags:
                os.chflags(image, 0)
            cleanup, late = release(image, points, disks)
            clean = clean and cleanup['clean'] and late is None
        for copy in store.glob('*/' + '*.read-pending/' + anchor.CLONE):
            cleanup, late = mount.release(copy, copy.parent / 'mount', True)
            clean = clean and cleanup['clean'] and late is None
        if clean:
            for path in (inputs, store, fixtures, code):
                shutil.rmtree(path)
        report['cleanup'] = {'clean': clean, 'removed': all(not path.exists() for path in (inputs, store, fixtures, code))}
        write_report(output, report)
    if error is not None:
        raise error
    if not clean or not report['cleanup']['removed']:
        raise RuntimeError('protected native reader fixture cleanup is incomplete')
    print(json.dumps({'completed': True, 'cases': len(report['cases']), 'fixture_cleanup': 'removed'}))


if __name__ == '__main__':
    if len(sys.argv) != 2:
        raise RuntimeError('usage: probe_host_protected_journal_reader.py NEW_REPORT')
    main(pathlib.Path(sys.argv[1]))
