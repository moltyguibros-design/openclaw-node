import hashlib
import json
import os
import pathlib
import re
import stat
import tempfile

from host_guest_commit import require_captured, require_committed, verify_frozen_checkpoint
from preservation_checks import require
from preservation_journal import (FULL_NODE_SCOPE, PROCESS_POLICY_LIMIT, Journal, Refused, encoded,
                                  regular_content, valid_entrypoint_inventory, valid_prior,
                                  valid_process_policy)
from stopped_journal_inputs import private_dir, read_inputs


AUTHORITY = 'pinned-checkpoint-consistent; authorship and pre-stop authenticity unproven'


def owned_root(root):
    root = pathlib.Path(root)
    require(root.is_absolute() and root.parent == pathlib.Path(tempfile.gettempdir()).resolve()
            and re.fullmatch(r'openclaw-owned-policy-[0-9a-f]{16}', root.name),
            'process policy producer requires an owned fixture root')
    private_dir(root, owner=os.getuid())
    require(root.resolve(strict=True) == root, 'process policy fixture root is not literal')
    return root


def read_authored_policy(path):
    path = pathlib.Path(path)
    require(path.is_absolute() and path.resolve(strict=True) == path,
            'authored process policy path is not literal')
    before = path.lstat()
    require(stat.S_ISREG(before.st_mode) and before.st_uid == os.getuid()
            and before.st_nlink == 1 and stat.S_IMODE(before.st_mode) == 0o600,
            'authored process policy is not owner-private and single-link')
    raw = regular_content(path, PROCESS_POLICY_LIMIT, keep_bytes=True)
    after = path.lstat()
    require((before.st_dev, before.st_ino, before.st_ctime_ns) ==
            (after.st_dev, after.st_ino, after.st_ctime_ns), 'authored process policy changed while read')
    try:
        policy = json.loads(raw)
        require(raw == encoded(policy), 'authored process policy is not canonical')
    except (ValueError, TypeError, RecursionError) as error:
        raise Refused('authored process policy is not canonical JSON') from error
    return policy


def bind_owned_policy_journal(root, window, prior, entrypoints, policy_path, *, boot=None):
    root = owned_root(root)
    require(isinstance(window, str) and re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9._-]*', window),
            'process policy journal window differs')
    policy_path = pathlib.Path(policy_path)
    require(root in policy_path.parents, 'authored process policy is outside the owned fixture')
    policy = read_authored_policy(policy_path)
    valid_prior(prior, FULL_NODE_SCOPE)
    valid_entrypoint_inventory(entrypoints, prior)
    valid_process_policy(policy, prior, entrypoints)
    require(policy['uid'] == os.getuid(), 'authored process policy uid differs from producer owner')
    hold = prior['scheduler-heartbeat']['execution_hold']
    require(hold['root'] == str(root / 'gate') and hold['paths'][-1]['path'] == str(root / 'gate'),
            'process policy hold root is outside the owned fixture')
    preservation = root / 'preservation'
    if os.path.lexists(preservation):
        private_dir(preservation, owner=os.getuid())
        require(preservation.resolve(strict=True) == preservation,
                'process policy preservation parent is not literal')
    journals = preservation / 'journals'
    if os.path.lexists(journals):
        private_dir(journals, owner=os.getuid())
        require(journals.resolve(strict=True) == journals, 'process policy journal parent is not literal')
    journal_root = journals / window
    require(not os.path.lexists(journal_root), 'process policy producer cannot reopen a window')
    if not preservation.exists():
        preservation.mkdir(mode=0o700)
        private_dir(preservation, owner=os.getuid())
    return Journal(journal_root, prior, boot=boot, node_lock=preservation / 'node.lock',
                   scope=FULL_NODE_SCOPE, expected_entrypoints=entrypoints, process_policy=policy)


def frozen_process_policy(capture_dir, records, *, configs, binary, home):
    checkpoint = verify_frozen_checkpoint(capture_dir, records, configs=configs,
                                          binary=binary, home=home)
    baseline = records[0]
    require('process_policy' in baseline, 'frozen baseline has no authored process policy')
    policy = baseline['process_policy']
    valid_process_policy(policy, baseline['prior'], baseline['entrypoint_inventory'])
    raw = encoded(policy)
    return {**checkpoint, 'process_policy': json.loads(raw),
            'process_policy_sha256': hashlib.sha256(raw).hexdigest(),
            'authority': AUTHORITY, 'admission': False, 'history_certified': False}


def image_process_policy(capture_dir, root):
    pinned = require_captured(capture_dir)
    commitment = require_committed(capture_dir)
    require(commitment == {**json.loads(pinned['COMMITTED.json']),
                           'checkpoint': json.loads(pinned['CHECKPOINT.json'])},
            'capture commitment differs from the pinned capture record')
    found = read_inputs(root, commitment)
    result = frozen_process_policy(capture_dir, found['records'],
                                    configs=found['configs'], binary=found['binary'], home=found['home'])
    uid = result['process_policy']['uid']
    require(found['read'] and all(row['uid'] == uid for row in found['read']),
            'process policy uid differs from stopped-image reader ownership')
    return {**result, 'window': found['window'], 'lineage': found['lineage'], 'read': found['read'],
            'owner_observation': {'scope': 'stopped-image reader lstat; not frozen-validator observation',
                                  'uid': uid}}
