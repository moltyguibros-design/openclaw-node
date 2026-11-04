import importlib.util
import json
import os
from pathlib import Path
import re
import select
import signal
import subprocess
import sys


def read(config_path, argv):
    config_path = Path(config_path).resolve(strict=True)
    home = config_path.parent
    config = json.loads(config_path.read_text())
    verifier = Path(__file__).resolve().parents[2] / 'scripts/install/verify-runtime-archive.py'
    parent = home / 'røøt/runtime/node'
    expected = ['-n', '/usr/bin/python3', '-I', '-S', '-B', str(verifier),
                '--process-references', str(parent), '--uid', str(os.getuid())]
    if argv != expected:
        raise ValueError('Unexpected owned reader argv')
    if set(config) != {'parent', 'uid', 'mode', 'node', 'liveReference'}:
        raise ValueError('Unexpected owned reader config')
    if config['parent'] != str(parent) or type(config['uid']) is not int or config['uid'] != os.getuid():
        raise ValueError('Owned reader parent/UID mismatch')
    if config['mode'] not in ['live', 'synthetic', 'denied', 'malformed']:
        raise ValueError('Unexpected owned reader mode')
    reference = config['liveReference']
    if reference is not None and (config['mode'] != 'live' or not re.fullmatch(re.escape(str(parent)) + r'/[a-f0-9]{64}', reference)):
        raise ValueError('Unexpected owned child reference')
    record = {'mode': config['mode'], 'scanner_called': False, 'entries': [],
              'child_pid': None, 'child_reaped': None, 'selected': None}
    child = None
    try:
        if config['mode'] == 'denied':
            raise PermissionError('Owned reader denial control')
        if config['mode'] == 'malformed':
            record['outcome'] = 'malformed-output-control'
            return 'not-json'
        spec = importlib.util.spec_from_file_location('owned_retention_archive', verifier)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        if config['mode'] == 'synthetic':
            entries = sorted((home / 'proc').iterdir())
        else:
            entries = [Path('/proc') / str(os.getpid())]
            if reference is not None:
                env = {**os.environ, 'NODE_PATH': reference + ':' + str(home / 'another')}
                child = subprocess.Popen([config['node'], '-e', 'process.stdout.write("ready\\n");setInterval(()=>{},1000)'],
                                         cwd=home, env=env, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True)
                record.update(child_pid=child.pid, child_reaped=False)
                if not select.select([child.stdout], [], [], 5)[0] or child.stdout.readline() != 'ready\n' or child.poll() is not None:
                    raise RuntimeError('Owned process did not become ready')
                entries.append(Path('/proc') / str(child.pid))
        record['entries'] = [str(entry) for entry in entries]

        class OwnedProc:
            def iterdir(self):
                record['enumerated'] = True
                return iter(entries)

        module.Path = lambda value: OwnedProc() if value == '/proc' else Path(value)
        record['scanner_called'] = True
        selected = module.process_references(parent, config['uid'])
        record.update(selected=selected, outcome='success')
        return json.dumps(selected)
    except Exception as error:
        record.update(outcome='error', error_type=type(error).__name__)
        raise
    finally:
        try:
            if child is not None:
                if child.poll() is None:
                    child.terminate()
                try:
                    child.wait(timeout=3)
                except subprocess.TimeoutExpired:
                    child.kill()
                    child.wait(timeout=3)
                child.stdout.close()
                record['child_reaped'] = True
        finally:
            with (home / 'reader.jsonl').open('a') as stream:
                stream.write(json.dumps(record, sort_keys=True) + '\n')


def interrupted(signum, frame):
    raise RuntimeError('Owned reader interrupted by signal ' + str(signum))


if __name__ == '__main__':
    signal.signal(signal.SIGTERM, interrupted)
    try:
        print(read(sys.argv[1], sys.argv[2:]))
    except Exception as error:
        print('Owned retention reader refused: ' + type(error).__name__ + ': ' + str(error), file=sys.stderr)
        sys.exit(77)
