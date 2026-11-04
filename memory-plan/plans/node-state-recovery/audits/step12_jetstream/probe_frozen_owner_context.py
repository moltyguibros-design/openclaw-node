import json
import os
import pathlib
import sys


def main(report):
    if (os.getuid() != 0 or os.environ.get('GITHUB_ACTIONS') != 'true'
            or os.environ.get('OPENCLAW_FROZEN_OWNER_PROBE') != '1'):
        raise RuntimeError('explicit CI-only root owner-context probe required')

    import stopped_journal_inputs as stopped
    from test_frozen_owner_context import OwnerContext
    from test_stopped_journal_inputs import preservation, snapshot

    source = OwnerContext('runTest')
    cases = []

    def passed(name):
        cases.append(name)
        print('frozen owner-context completed: ' + name, flush=True)

    def refused(name, message, operation):
        try:
            operation()
        except (RuntimeError, stopped.Refused) as error:
            if message not in str(error):
                raise AssertionError(name + ': wrong refusal: ' + str(error)) from error
        else:
            raise AssertionError(name + ': no refusal')
        passed(name)

    guest_uid = 65534
    try:
        source.setUp()
        expected = source.stopped_bytes()
        finder = preservation(source.data) / '.DS_Store'
        finder.write_bytes(b'owned metadata')
        for path in [source.data, *source.data.rglob('*')]:
            os.chown(path, guest_uid, -1)
        before = snapshot(source.data)

        def verify(**context):
            return stopped.verify_stopped_bytes(source.files, source.data,
                                                **{'owner': guest_uid, 'writer_uid': 0, **context})

        actual = verify()
        if ({key: value for key, value in actual.items() if key != 'read'} !=
                {key: value for key, value in expected.items() if key != 'read'}
                or not actual['read'] or any(row['uid'] != guest_uid for row in actual['read'])):
            raise AssertionError('distinct-owner semantic result or file owners differ')
        passed('root reads the uid65534 guest with writer uid0')
        refused('current-owner path wrapper refuses the guest', 'not owner-private: preservation',
                lambda: stopped.verify_stopped_journal(source.capture, source.data))
        refused('wrong guest owner refuses', 'not owner-private: preservation', lambda: verify(owner=0))
        refused('wrong protected writer refuses', 'lacks writer exclusion', lambda: verify(writer_uid=guest_uid))

        for name, path, message in (
                ('foreign Finder owner', finder, 'unexpected Finder metadata owner'),
                ('foreign config owner', source.data / next(iter(source.configs))[1:],
                 'not an owned single-link regular file'),
                ('foreign lock owner', preservation(source.data) / 'node.lock',
                 'not an owned single-link regular file'),
                ('foreign journal directory owner', source.root, 'not owner-private')):
            os.chown(path, 0, -1)
            try:
                refused(name, message, verify)
            finally:
                os.chown(path, guest_uid, -1)

        after = snapshot(source.data)
        if any(before[key][:4] != after[key][:4] or before[key][-1] != after[key][-1] for key in before):
            raise AssertionError('guest metadata or bytes differ after owner restoration')
        verify()
        passed('valid guest accepted after negative metadata is restored')
    finally:
        source.doCleanups()
        if hasattr(source, 'temp') and source.temp.exists():
            raise RuntimeError('owned owner-context tree remains after cleanup')

    result = {'scope': 'CI-only guest-file and protected-writer owner-context proof; no mount or protected receipt',
              'authority_uid': os.getuid(), 'guest_uid': guest_uid, 'writer_uid': 0,
              'cases': cases, 'fixture_cleanup': 'removed'}
    fd = os.open(report, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, 'w') as handle:
        handle.write(json.dumps(result, sort_keys=True, indent=2) + '\n')
        os.fchmod(handle.fileno(), 0o644)
    print(json.dumps(result, sort_keys=True), flush=True)


if __name__ == '__main__':
    if len(sys.argv) != 2:
        raise RuntimeError('usage: probe_frozen_owner_context.py NEW_REPORT')
    main(pathlib.Path(sys.argv[1]))
