const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { createHash } = require('node:crypto');
const { execFileSync } = require('node:child_process');

const hash = bytes => createHash('sha256').update(bytes).digest('hex');

function readRuntimeIdentity({ repoDir, root = process.env.OPENCLAW_ROOT || path.join(os.homedir(), '.openclaw') }) {
  const repo = fs.realpathSync(repoDir);
  const receiptPath = path.join(repo, '.openclaw-node-release.json');
  if (fs.existsSync(receiptPath)) {
    const parent = path.join(fs.realpathSync(root), 'runtime', 'node');
    const bytes = fs.readFileSync(receiptPath);
    const receipt = JSON.parse(bytes);
    if (path.dirname(repo) !== parent || !/^[a-f0-9]{64}$/.test(path.basename(repo))
      || receipt.schema !== 1 || receipt.digest !== path.basename(repo) || !Array.isArray(receipt.files)
      || !receipt.node || hash(JSON.stringify({ node: receipt.node, files: receipt.files })) !== receipt.digest) {
      throw new Error('Managed runtime manifest receipt does not match its release');
    }
    const source = receipt.sourceGit;
    if (!source || !['packed-roots', 'git-index-unignored-and-generated-schemas'].includes(source.selection)
      || source.head !== null && !/^[a-f0-9]{40}$/.test(source.head)
      || source.dirty !== null && typeof source.dirty !== 'boolean') {
      throw new Error('Managed runtime source qualification is invalid');
    }
    return { kind: 'managed-runtime', deployVersion: `runtime:${receipt.digest}`, digest: receipt.digest,
      sourceGit: source, node: receipt.node, receiptSha256: hash(bytes), verification: 'manifest-receipt-only' };
  }
  if (fs.existsSync(path.join(root, 'config', 'installation.json'))) {
    throw new Error('Managed installation has no receipt at the running code path');
  }
  if (!fs.existsSync(path.join(repo, '.git'))) return { kind: 'unmanaged', deployVersion: 'unknown', sourceGit: null };
  const git = (...args) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  if (fs.realpathSync(git('rev-parse', '--show-toplevel')) !== repo) throw new Error('Git identity belongs to another checkout');
  const head = git('rev-parse', 'HEAD'), dirty = Boolean(git('--no-optional-locks', 'status', '--porcelain'));
  return { kind: 'unmanaged-git', deployVersion: head.slice(0, 12) + (dirty ? '-dirty' : ''), sourceGit: { head, dirty } };
}

module.exports = { readRuntimeIdentity };
