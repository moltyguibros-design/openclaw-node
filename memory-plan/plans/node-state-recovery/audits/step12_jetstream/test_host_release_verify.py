#!/usr/bin/env python3
import hashlib
import json
import pathlib
import tempfile
import unittest

from host_release_verify import verify


def sha(data):
    return hashlib.sha256(data).hexdigest()


class HostReleaseVerifyTest(unittest.TestCase):
    def test_release_bytes_modes_and_exact_entries(self):
        with tempfile.TemporaryDirectory(prefix='openclaw-host-release-') as temporary:
            parent = pathlib.Path(temporary).resolve()
            release = parent / 'release'
            release.mkdir(mode=0o700)
            files = {
                'node': b'owned-node', 'nats': b'owned-cli',
                'nats-server': b'owned-server', 'recovery.mjs': b'owned-code',
            }
            for name, content in files.items():
                path = release / name
                path.write_bytes(content)
                path.chmod(0o700 if name in ('node', 'nats', 'nats-server') else 0o600)
            modules = release / 'node_modules'
            modules.mkdir(mode=0o700)
            rows = []
            for package in ('nats', 'nkeys.js', 'tweetnacl'):
                directory = modules / package
                directory.mkdir(mode=0o700)
                content = package.encode()
                file = directory / 'index.js'
                file.write_bytes(content)
                file.chmod(0o600)
                rows.append((f'{package}/index.js', sha(content)))
            tree = hashlib.sha256()
            for name, digest in sorted(rows):
                tree.update(name.encode() + b'\0' + digest.encode() + b'\n')
            manifest = {
                'source_commit': 'owned-fixture',
                'files_sha256': {name: sha(content) for name, content in files.items()},
                'node_modules_packages': ['nats', 'nkeys.js', 'tweetnacl'],
                'node_modules_files': 3,
                'node_modules_sha256': tree.hexdigest(),
            }
            manifest_path = release / 'release-manifest.json'
            manifest_path.write_text(json.dumps(manifest))
            manifest_path.chmod(0o600)
            expected = sha(manifest_path.read_bytes())
            self.assertTrue(verify(release, expected, parent / 'good')['verified'])

            modules.chmod(0o755)
            with self.assertRaisesRegex(RuntimeError, 'private directory differs'):
                verify(release, expected, parent / 'readable-modules')
            self.assertFalse((parent / 'readable-modules/VERIFY.json').exists())
            modules.chmod(0o700)

            (release / 'recovery.mjs').write_bytes(b'changed-code')
            with self.assertRaisesRegex(RuntimeError, 'release file hash differs'):
                verify(release, expected, parent / 'changed-code')
            self.assertFalse((parent / 'changed-code/VERIFY.json').exists())
            (release / 'recovery.mjs').write_bytes(files['recovery.mjs'])

            link = release / 'unexpected'
            link.symlink_to(release / 'node')
            with self.assertRaisesRegex(RuntimeError, 'undeclared entry'):
                verify(release, expected, parent / 'extra-link')
            link.unlink()

            (modules / 'nats/index.js').write_bytes(b'changed-dependency')
            with self.assertRaisesRegex(RuntimeError, 'dependency tree differs'):
                verify(release, expected, parent / 'changed-module')
            self.assertFalse((parent / 'changed-module/VERIFY.json').exists())


if __name__ == '__main__':
    unittest.main()
