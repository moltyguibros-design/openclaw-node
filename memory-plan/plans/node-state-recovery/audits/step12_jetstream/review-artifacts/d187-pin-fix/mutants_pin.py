"""Apply one D187 source mutant at a time to a throwaway copy; every mutant must fail a test.

Usage: python3 mutants_pin.py WORK_TREE [V2_TREE]
Each copy holds the patched step12 directory plus a symlink to the tree's workspace-bin, so the
tests' relative service_gate lookups resolve. The Linux test set is the host checkpoint suite,
the checkpoint suite, the host capture suite and the real-facade control run through the
observer shim (facade_on_linux.py next to this file). With V2_TREE, a final pseudo-mutant puts
the exact v2 sources back under the new tests, which must fail too.
"""
import pathlib
import shutil
import subprocess
import sys
import tempfile

WORK = pathlib.Path(sys.argv[1]).resolve()
V2 = pathlib.Path(sys.argv[2]).resolve() if len(sys.argv) > 2 else None
STEP = 'memory-plan/plans/node-state-recovery/audits/step12_jetstream'
SHIM = pathlib.Path(__file__).resolve().parent / 'facade_on_linux.py'
C, G, H = 'host_vm_capture.py', 'stopped_tree_match.py', 'host_guest_commit.py'
TESTS = ('test_host_checkpoint_commit.py', 'test_capture_checkpoint.py', 'test_host_vm_capture.py')

MUTANTS = {
    # Worker publication (host_vm_capture.publish_pinned_capture and the stopped-sample commitment).
    'publication drops the checkpoint pin': (C, "        result = {**result, **digests}",
        "        result = {**result, **{k: v for k, v in digests.items() if k != 'guest_checkpoint_sha256'}}"),
    'publication ignores the stopped commitment': (C,
        "        require(checkpoint == json.loads(pinned['guest_checkpoint_sha256']) == stopped_checkpoint",
        "        require(checkpoint == json.loads(pinned['guest_checkpoint_sha256'])"),
    'publication pins bytes it did not validate': (C,
        "        require(checkpoint == json.loads(pinned['guest_checkpoint_sha256']) == stopped_checkpoint",
        "        require(checkpoint == stopped_checkpoint"),
    'publication skips revalidation': (C, "        checkpoint = require_committed(output)['checkpoint']",
                                       "        checkpoint = stopped_checkpoint"),
    'publication skips the post-validation re-read': (C,
        "                and (output / 'CHECKPOINT.json').read_bytes() == pinned['guest_checkpoint_sha256']\n", ""),
    'publication commit digest unbound': (C,
        "                and checkpoint['commit_sha256'] == digests['guest_commit_sha256']\n", ""),
    'publication ack digest unbound': (C,
        "                and checkpoint['ack_sha256'] == digests['guest_ack_sha256'],",
        "                and True,"),
    'latest stopped commitment pinned': (C, "                if stopped_checkpoint is None:\n                    stopped_checkpoint",
                                         "                if True:\n                    stopped_checkpoint"),
    'publication unpinned (v2 publish)': (C, "        return publish_pinned_capture(output, result, stopped_checkpoint)",
        "        with (output / 'ARMED.json').open('rb') as armed:\n"
        "            fcntl.flock(armed, fcntl.LOCK_EX)\n"
        "            result.update(guest_commit_sha256=file_hash(output / 'COMMITTED.json'),\n"
        "                          guest_ack_sha256=file_hash(output / 'ACKED.json'))\n"
        "            publish_capture_record(output, result)\n"
        "        return result"),
    # host_match.
    'match checkpoint pin unchecked': (G,
        "                and capture.get('guest_checkpoint_sha256') == hashlib.sha256(checkpoint_bytes).hexdigest()\n", ""),
    'match commit pin unchecked': (G,
        "                and capture['guest_commit_sha256'] == hashlib.sha256(committed_bytes).hexdigest()\n", ""),
    'match ack pin unchecked': (G,
        "                and capture['guest_ack_sha256'] == hashlib.sha256(ack_bytes).hexdigest()\n", ""),
    'match consumes provenance before the pins': (G,
        "    try:\n        # The capture record's byte pins come first: the commitment is consumed only as captured.\n",
        "    try:\n        require_committed(extracted.parent)\n"),
    'match digest not recorded': (G, "                  'checkpoint_sha256': committed['checkpoint']['checkpoint_sha256'],\n", ""),
    'match digest recorded from the pin record': (G,
        "                  'checkpoint_sha256': committed['checkpoint']['checkpoint_sha256'],",
        "                  'checkpoint_sha256': capture['guest_checkpoint_sha256'],"),
    'match end recheck drops checkpoint bytes': (G,
        "                and (extracted.parent / 'CHECKPOINT.json').read_bytes() == checkpoint_bytes\n", ""),
    'match end recheck drops commit bytes': (G,
        "                and (extracted.parent / 'COMMITTED.json').read_bytes() == committed_bytes\n", ""),
    'match end recheck revalidates first': (G,
        "        require(guest_path.read_bytes() == guest_bytes\n                and (extracted.parent / 'COMMITTED.json')",
        "        require(require_committed(extracted.parent) == committed\n                and guest_path.read_bytes() == guest_bytes\n                and (extracted.parent / 'COMMITTED.json')"),
    # Frozen verifier wrapper.
    'frozen verifier skips the capture pin': (H, "    pinned = require_captured(capture_dir)\n    commitment",
                                              "    pinned = {}\n    commitment"),
    'frozen verifier consumes provenance first': (H,
        "    pinned = require_captured(capture_dir)\n    commitment = require_committed(capture_dir)\n",
        "    commitment = require_committed(capture_dir)\n    pinned = require_captured(capture_dir)\n"),
    'frozen provenance not the pinned bytes': (H,
        "    require(commitment == {**json.loads(pinned['COMMITTED.json']),\n                           'checkpoint': json.loads(pinned['CHECKPOINT.json'])},",
        "    require(True,"),
    'capture checkpoint pin not required': (H, "                    for key, name in CAPTURE_PINS.items()),",
        "                    for key, name in CAPTURE_PINS.items() if key != 'guest_checkpoint_sha256'),"),
    'capture ack pin not required': (H, "                    for key, name in CAPTURE_PINS.items()),",
        "                    for key, name in CAPTURE_PINS.items() if key != 'guest_ack_sha256'),"),
    'capture commit pin not required': (H, "                    for key, name in CAPTURE_PINS.items()),",
        "                    for key, name in CAPTURE_PINS.items() if key != 'guest_commit_sha256'),"),
    'capture record shape unchecked': (H, "    require(isinstance(capture, dict)\n            and all(",
                                       "    require(True\n            and all("),
}


def tree(temporary):
    """A throwaway tree: the patched step12 copy plus the repo's workspace-bin by symlink."""
    root = pathlib.Path(temporary) / 'tree'
    copy = root / STEP
    shutil.copytree(WORK / STEP, copy, ignore=shutil.ignore_patterns('__pycache__'))
    (root / 'workspace-bin').symlink_to(WORK / 'workspace-bin')
    return copy


def verdict(copy):
    tails, failed = [], False
    runs = [[sys.executable, '-B', test] for test in TESTS] + [[sys.executable, '-B', str(SHIM), str(copy)]]
    for command in runs:
        run = subprocess.run(command, cwd=copy, capture_output=True, text=True, timeout=900)
        output = (run.stderr.strip() or run.stdout.strip()).splitlines()
        tails.append(output[-1] if output else '')
        failed = failed or run.returncode != 0
    return failed, tails


problems = []
for name, (target, old, new) in MUTANTS.items():
    with tempfile.TemporaryDirectory(prefix='mutant-') as temporary:
        copy = tree(temporary)
        path = copy / target
        source = path.read_text()
        if source.count(old) != 1:
            problems.append(name + ': anchor not unique (%d)' % source.count(old))
            print('%-46s ANCHOR(%d)' % (name, source.count(old)), flush=True)
            continue
        path.write_text(source.replace(old, new))
        failed, tails = verdict(copy)
        print('%-46s %s  %s' % (name, 'KILLED' if failed else 'SURVIVED', ' | '.join(tails)), flush=True)
        if not failed:
            problems.append(name + ': survived')

if V2:
    with tempfile.TemporaryDirectory(prefix='mutant-') as temporary:
        copy = tree(temporary)
        for name in (C, G, H):
            shutil.copyfile(V2 / STEP / name, copy / name)
        failed, tails = verdict(copy)
        print('%-46s %s  %s' % ('exact v2 sources under the new tests', 'KILLED' if failed else 'SURVIVED',
                                 ' | '.join(tails)), flush=True)
        if not failed:
            problems.append('v2 sources: survived')

print('mutants:', len(MUTANTS) + bool(V2), 'problems:', problems)
sys.exit(1 if problems else 0)
