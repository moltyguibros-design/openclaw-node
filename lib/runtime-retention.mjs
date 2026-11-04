import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { withRuntimeTransaction } from './runtime-deploy.mjs';

export function archiveRuntime({ root, releases, privilegedProcessReader = false }) {
  return withRuntimeTransaction(root, 'archive-runtime', canonical => {
    const verifier = fileURLToPath(new URL('../scripts/install/verify-runtime-archive.py', import.meta.url));
    const result = spawnSync('/usr/bin/python3', ['-I', '-S', '-B', verifier, '--root', canonical,
      ...(privilegedProcessReader ? ['--privileged-process-reader'] : []),
      ...releases.flatMap(name => ['--release', name])], { encoding: 'utf8', timeout: 240_000, maxBuffer: 4 * 1024 ** 2 });
    if (result.status !== 0) throw new Error(result.stderr?.trim() || result.error?.message || 'Runtime archive failed');
    return JSON.parse(result.stdout);
  });
}
