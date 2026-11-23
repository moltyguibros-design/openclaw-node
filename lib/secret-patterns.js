'use strict';

// One list for the display scrubber (injection-logger scrubSecrets) and the mesh
// commit gate (mesh-harness preCommitSecretScan). `diff: false` entries are
// scrub-only: test fixtures and doc samples carry bearer/JWT shapes, and the
// commit gate must not start refusing them.
// provider-key wants a 20+ alphanumeric run after `sk-` so the prefixed shapes
// (sk-ant-api03-, sk-proj-, sk-or-v1-, sk-svcacct-) match and kebab identifiers
// such as sk-folding-cube do not.
const SECRET_PATTERNS = [
  { label: 'provider-key', re: /(?<![A-Za-z0-9])sk-[A-Za-z0-9_-]*?[A-Za-z0-9]{20,}[A-Za-z0-9_-]*/, diff: true },
  { label: 'aws-access-key', re: /\bAKIA[0-9A-Z]{16}\b/, diff: true },
  { label: 'github-token', re: /\bgh[pousr]_[A-Za-z0-9]{36,}/, diff: true },
  { label: 'github-pat', re: /\bgithub_pat_[A-Za-z0-9_]{22,}/, diff: true },
  { label: 'slack-token', re: /\bxox[abposr]-[A-Za-z0-9-]{20,}/, diff: true },
  { label: 'bearer', re: /\bBearer\s+[A-Za-z0-9_.~+\-=/]{20,}/i, diff: false },
  { label: 'jwt', re: /\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/, diff: false },
];

module.exports = { SECRET_PATTERNS };
