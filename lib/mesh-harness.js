/**
 * mesh-harness.js — Mechanical enforcement layer for mesh tasks.
 *
 * Two harnesses exist:
 *   LOCAL  — prompt injection only (companion-bridge consumes these)
 *   MESH   — mechanical enforcement at pre/post execution stages
 *
 * This module implements the mesh side. Each rule has a mesh_enforcement type:
 *   - "scope_check"      → post-execution: revert files outside task.scope
 *   - "post_scan"        → post-execution: scan LLM stdout for error patterns
 *   - "post_validate"    → post-commit: run validation command
 *   - "pre_commit_scan"  → pre-commit: scan staged diff for patterns
 *   - "output_block"     → post-execution: scan output for blocked patterns
 *   - "metric_required"  → post-execution: flag metric-less completions
 *   - "pre_check"        → pre-execution: probe the services in mesh_pre_checks
 *
 * All enforcement is LLM-agnostic — it operates on filesystem state and
 * process output, not on prompt compliance.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execSync, execFileSync } = require('child_process');
const { globMatch } = require('./rule-loader');
const { validateExecCommand } = require('./exec-safety');
const { SECRET_PATTERNS } = require('./secret-patterns');
const { createTracer } = require('./tracer');
const tracer = createTracer('mesh-harness');

// ── Rule Loading ─────────────────────────────────────

/**
 * Load harness rules filtered by scope.
 * @param {string} rulesPath — path to harness-rules.json
 * @param {string} scope — "local" or "mesh"
 * @returns {object[]} — active rules for this scope
 */
function loadHarnessRules(rulesPath, scope) {
  if (!fs.existsSync(rulesPath)) return [];
  try {
    const rules = JSON.parse(fs.readFileSync(rulesPath, 'utf-8'));
    return rules.filter(r =>
      r.active !== false &&
      Array.isArray(r.scope) &&
      r.scope.includes(scope)
    );
  } catch (err) {
    console.error(`[mesh-harness] Failed to load ${rulesPath}: ${err.message}`);
    return [];
  }
}

/**
 * Get rules by mesh_enforcement type.
 */
function rulesByEnforcement(rules, type) {
  return rules.filter(r => r.mesh_enforcement === type);
}

// ── Enforcement: Scope Check ─────────────────────────

/**
 * Whether a task scope entry covers a file. Entries are globs, but people
 * write directories too: "docs/" covers everything under docs, and a bare
 * name with no glob characters ("src") covers both the file "src" and
 * everything under it.
 */
function scopeEntryMatches(pattern, file) {
  if (pattern.endsWith('/')) return globMatch(`${pattern}**`, file);
  if (!/[*?{]/.test(pattern)) return globMatch(pattern, file) || globMatch(`${pattern}/**`, file);
  return globMatch(pattern, file);
}

/**
 * Changed and untracked files in a worktree. -z keeps git from C-quoting
 * names with non-ASCII bytes, quotes or backslashes.
 */
function listWorktreeChanges(cwd) {
  const list = (args) => execFileSync('git', args, { cwd, timeout: 10000, encoding: 'utf-8' }).split('\0');
  return [...new Set([
    ...list(['diff', '--name-only', '-z', 'HEAD']),
    ...list(['ls-files', '-z', '--others', '--exclude-standard']),
  ])].filter(Boolean);
}

/**
 * Revert any files changed outside task.scope in a worktree.
 * Returns { violations: string[], reverted: string[] }.
 */
function enforceScopeCheck(worktreePath, taskScope) {
  if (!worktreePath || !taskScope || taskScope.length === 0) {
    return { violations: [], reverted: [] };
  }

  const violations = [];
  const reverted = [];

  try {
    for (const file of listWorktreeChanges(worktreePath)) {
      const inScope = taskScope.some(pattern => scopeEntryMatches(pattern, file));
      if (!inScope) {
        violations.push(file);
        try {
          // Revert tracked files. argv form: the filename is agent-created,
          // and an interpolated `$(...)` name would execute in the parent;
          // a literal pathspec keeps a name like `*.js` from matching other files.
          execFileSync('git', ['--literal-pathspecs', 'checkout', 'HEAD', '--', file], {
            cwd: worktreePath, timeout: 5000, stdio: 'pipe',
          });
          reverted.push(file);
        } catch {
          // Untracked file — remove it
          try {
            fs.unlinkSync(path.join(worktreePath, file));
            reverted.push(file);
          } catch { /* best effort */ }
        }
      }
    }
  } catch (err) {
    console.error(`[mesh-harness] Scope check error: ${err.message}`);
  }

  return { violations, reverted };
}

// ── Enforcement: Post-Execution Scan ─────────────────

/**
 * Scan LLM output for error patterns that suggest silent failure.
 * Returns { suspicious: boolean, matches: string[] }.
 */
function postExecutionScan(llmOutput, scanPatterns) {
  if (!llmOutput || !scanPatterns || scanPatterns.length === 0) {
    return { suspicious: false, matches: [] };
  }

  const matches = [];
  const lines = llmOutput.split('\n');

  for (const line of lines) {
    for (const pattern of scanPatterns) {
      if (line.includes(pattern)) {
        matches.push(line.trim().slice(0, 200));
        break; // one match per line is enough
      }
    }
  }

  // Heuristic: more than 3 matching lines is suspicious
  // Also flag if any FAIL/PANIC/Traceback appears (high-confidence error signals)
  const highConfidence = ['FAIL', 'PANIC', 'Traceback', 'FATAL'];
  const hasHighConfidence = matches.some(m =>
    highConfidence.some(hc => m.includes(hc))
  );

  return {
    suspicious: hasHighConfidence || matches.length > 3,
    matches: matches.slice(0, 10), // cap at 10 matches
  };
}

// ── Enforcement: Output Block ────────────────────────

/**
 * Scan LLM output for blocked patterns (destructive commands, etc.).
 * Returns { blocked: boolean, violations: { ruleId, match }[] }.
 */
function scanOutputForBlocks(llmOutput, blockRules) {
  if (!llmOutput) return { blocked: false, violations: [] };

  const violations = [];

  for (const rule of blockRules) {
    if (!rule.pattern) continue;
    try {
      const regex = new RegExp(rule.pattern, 'gm');
      const matches = llmOutput.match(regex);
      if (matches) {
        violations.push({
          ruleId: rule.id,
          pattern: rule.pattern,
          matches: matches.slice(0, 5),
        });
      }
    } catch { /* skip invalid regex */ }
  }

  return {
    blocked: violations.length > 0,
    violations,
  };
}

// ── Enforcement: Pre-Commit Scan ─────────────────────

const DIFF_SECRET_CHECKS = [
  ...SECRET_PATTERNS.filter((p) => p.diff).map(({ label, re }) => ({ label, re })),
  { label: 'password', re: /password\s*=\s*["'][^"']+["']/i },
  { label: 'api_key', re: /api_key\s*=\s*["'][^"']+["']/i },
  { label: 'secret', re: /secret\s*=\s*["'][^"']+["']/i },
];

/**
 * Scan staged diff for secrets before committing.
 * Returns { blocked: boolean, findings: string[] }.
 */
function preCommitSecretScan(worktreePath) {
  if (!worktreePath) return { blocked: false, findings: [] };

  const findings = [];
  // The scan runs before commitWorktree's `git add -A`, so the worktree's real index
  // holds none of the worker's edits. Stage everything into a scratch copy of the
  // index and scan that; the worker's own staging is left untouched.
  const scratchDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mesh-secret-scan-'));
  const env = { ...process.env, GIT_INDEX_FILE: path.join(scratchDir, 'index') };

  try {
    const realIndex = execFileSync('git', ['rev-parse', '--git-path', 'index'], {
      cwd: worktreePath, timeout: 5000, encoding: 'utf-8',
    }).trim();
    try { fs.copyFileSync(path.resolve(worktreePath, realIndex), env.GIT_INDEX_FILE); } catch { /* no index yet */ }
    execFileSync('git', ['add', '-A', '--', '.'], { cwd: worktreePath, timeout: 30000, env, stdio: 'pipe' });

    try {
      // `detect` has no --staged flag; `protect --staged` scans the scratch index via env.
      execFileSync('gitleaks', ['protect', '--staged', '--no-banner', '--redact'], {
        cwd: worktreePath, timeout: 30000, encoding: 'utf-8', env, stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (glErr) {
      if (glErr.code !== 'ENOENT') {
        // gitleaks also exits 1 on its own fatal errors, so the status alone is not a finding.
        const out = `${glErr.stdout || ''}${glErr.stderr || ''}`.trim();
        if (glErr.status === 1 && /\bleaks found\b/i.test(out) && !/\bno leaks found\b/i.test(out)) {
          findings.push(`gitleaks: ${out.slice(0, 200)}`);
        } else {
          console.error(`[mesh-harness] gitleaks scan error: ${out.slice(0, 200) || glErr.message}`);
        }
      }
    }

    // Fallback: regex scan on the staged (scratch-index) diff
    if (findings.length === 0) {
      const diff = execFileSync('git', ['diff', '--cached', '-U0'], {
        cwd: worktreePath, timeout: 10000, encoding: 'utf-8', env, stdio: ['ignore', 'pipe', 'ignore'],
      });
      for (const { re } of DIFF_SECRET_CHECKS) {
        const match = diff.match(new RegExp(`^\\+.*${re.source}`, `${re.flags}m`));
        if (match) {
          findings.push(`regex: ${match[0].trim().slice(0, 100)}`);
        }
      }
    }
  } catch (err) {
    console.error(`[mesh-harness] Pre-commit scan error: ${err.message}`);
  } finally {
    fs.rmSync(scratchDir, { recursive: true, force: true });
  }

  return {
    blocked: findings.length > 0,
    findings,
  };
}

// ── Enforcement: Post-Commit Validation ──────────────

/**
 * Run a validation command after commit (e.g., conventional commit check).
 * Returns { passed: boolean, output: string }.
 */
function postCommitValidate(worktreePath, command) {
  if (!worktreePath || !command) return { passed: true, output: '' };

  const validation = validateExecCommand(command);
  if (!validation.allowed) {
    return { passed: false, output: `Validation command blocked: ${validation.reason}` };
  }

  try {
    const output = execSync(command, {
      cwd: worktreePath, timeout: 10000, encoding: 'utf-8', stdio: 'pipe',
    });
    return { passed: true, output: output.trim() };
  } catch (err) {
    return {
      passed: false,
      output: (err.stdout || err.stderr || err.message || '').trim().slice(0, 500),
    };
  }
}

// ── Composite: Run All Mesh Enforcement ──────────────

/**
 * Run the full mesh harness enforcement suite for a completed task.
 * Called after LLM exits, before commitAndMergeWorktree.
 *
 * @param {object} opts
 * @param {object[]} opts.rules — loaded mesh harness rules
 * @param {string} opts.worktreePath — task worktree
 * @param {string[]} opts.taskScope — task.scope glob patterns
 * @param {string} opts.llmOutput — LLM stdout
 * @param {boolean} opts.hasMetric — whether task has a metric
 * @param {function} opts.log — logging function
 * @returns {object} — { pass, violations, warnings }
 */
function runMeshHarness(opts) {
  const { rules, worktreePath, taskScope, llmOutput, hasMetric, log, role } = opts;
  const violations = [];
  const warnings = [];

  // 1. Scope enforcement
  const scopeRules = rulesByEnforcement(rules, 'scope_check');
  if (scopeRules.length > 0 && taskScope && taskScope.length > 0) {
    const result = enforceScopeCheck(worktreePath, taskScope);
    if (result.violations.length > 0) {
      const msg = `SCOPE VIOLATION: ${result.violations.length} file(s) outside scope reverted: ${result.reverted.join(', ')}`;
      violations.push({ rule: 'scope-enforcement', message: msg, files: result.violations });
      log(`[HARNESS] ${msg}`);
    }
  }

  // 1.5. Forbidden pattern check (from role profile, runs on worktree files)
  if (role && role.forbidden_patterns && worktreePath) {
    const { checkForbiddenPatterns } = require('./role-loader');
    // Listed after the scope revert, so only the surviving files are scanned.
    try {
      const outputFiles = listWorktreeChanges(worktreePath);

      if (outputFiles.length > 0) {
        const fpResult = checkForbiddenPatterns(role, outputFiles, worktreePath);
        if (!fpResult.passed) {
          for (const v of fpResult.violations) {
            const msg = `FORBIDDEN PATTERN: "${v.description}" in ${v.file} (matched: ${v.match})`;
            violations.push({ rule: `forbidden:${v.pattern}`, message: msg, file: v.file });
            log(`[HARNESS] ${msg}`);
          }
        }
      }
    } catch (err) {
      log(`[HARNESS] Forbidden pattern check error: ${err.message}`);
    }
  }

  // 2. Output block scan
  const blockRules = rulesByEnforcement(rules, 'output_block');
  if (blockRules.length > 0) {
    const result = scanOutputForBlocks(llmOutput, blockRules);
    if (result.blocked) {
      for (const v of result.violations) {
        const msg = `OUTPUT BLOCK: rule "${v.ruleId}" matched pattern /${v.pattern}/ (${v.matches.length} occurrence(s))`;
        violations.push({ rule: v.ruleId, message: msg });
        log(`[HARNESS] ${msg}`);
      }
    }
  }

  // 3. Post-execution error scan (for metric-less tasks only)
  const scanRules = rulesByEnforcement(rules, 'post_scan');
  if (scanRules.length > 0 && !hasMetric) {
    for (const rule of scanRules) {
      const result = postExecutionScan(llmOutput, rule.mesh_scan_patterns);
      if (result.suspicious) {
        const msg = `SUSPICIOUS OUTPUT: ${result.matches.length} error-like patterns found in output (no metric to verify)`;
        warnings.push({ rule: rule.id, message: msg, matches: result.matches });
        log(`[HARNESS] ${msg}`);
      }
    }
  }

  // 4. Metric-required flag
  const metricRules = rulesByEnforcement(rules, 'metric_required');
  if (metricRules.length > 0 && !hasMetric) {
    warnings.push({
      rule: 'build-before-done',
      message: 'Task completed without metric — no mechanical verification of success',
    });
  }

  // 5. Pre-commit secret scan
  const secretRules = rulesByEnforcement(rules, 'pre_commit_scan');
  if (secretRules.length > 0 && worktreePath) {
    const result = preCommitSecretScan(worktreePath);
    if (result.blocked) {
      const msg = `SECRET DETECTED: ${result.findings.join('; ')}`;
      violations.push({ rule: 'no-hardcoded-secrets', message: msg, findings: result.findings });
      log(`[HARNESS] ${msg}`);
    }
  }

  const pass = violations.length === 0;

  return { pass, violations, warnings };
}

// ── Enforcement: Pre-execution Service Checks ─────────

const PRE_CHECK_TIMEOUT_MS = 5000;

/**
 * Probe every service a pre_check rule lists (mesh_pre_checks) before a task
 * starts. `probes` maps a service name to an async function that throws when
 * the service is down; the caller supplies them because it holds the
 * connections. A listed service with no probe fails, so the rules cannot
 * claim a check nothing performs.
 *
 * @returns {Promise<{ pass: boolean, failures: Array<{rule, service, reason}> }>}
 */
async function runPreChecks({ rules, probes = {}, timeoutMs = PRE_CHECK_TIMEOUT_MS, log = () => {} }) {
  const failures = [];
  for (const rule of rulesByEnforcement(rules, 'pre_check')) {
    for (const service of rule.mesh_pre_checks || []) {
      const probe = probes[service];
      if (!probe) {
        failures.push({ rule: rule.id, service, reason: 'no probe for this service' });
        continue;
      }
      let timer;
      try {
        await Promise.race([
          probe(),
          new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`no answer within ${timeoutMs}ms`)), timeoutMs); }),
        ]);
      } catch (err) {
        failures.push({ rule: rule.id, service, reason: err.message });
      } finally {
        clearTimeout(timer);
      }
    }
  }
  for (const f of failures) log(`[HARNESS] PRE-CHECK FAIL: ${f.rule} — ${f.service}: ${f.reason}`);
  return { pass: failures.length === 0, failures };
}

/**
 * Run post-commit validation checks.
 * Called after commitAndMergeWorktree, before reporting completion.
 *
 * @param {object[]} rules — loaded mesh harness rules
 * @param {string} worktreePath
 * @param {function} log
 * @returns {object[]} — array of { rule, passed, output } for each validation
 */
function runPostCommitValidation(rules, worktreePath, log) {
  const results = [];
  const validateRules = rulesByEnforcement(rules, 'post_validate');

  for (const rule of validateRules) {
    if (!rule.mesh_validate_command) continue;
    const result = postCommitValidate(worktreePath, rule.mesh_validate_command);
    results.push({
      rule: rule.id,
      passed: result.passed,
      output: result.output,
    });
    if (!result.passed) {
      log(`[HARNESS] POST-COMMIT FAIL: ${rule.id} — ${result.output}`);
    }
  }

  return results;
}

/**
 * Get inject-type rules for prompt injection (soft enforcement layer).
 * These are injected into the LLM prompt in addition to mechanical enforcement.
 * LLM-agnostic: returns markdown text that any LLM can consume.
 */
function formatHarnessForPrompt(rules, activationText = '') {
  const lower = String(activationText).toLowerCase();
  const injectRules = rules.filter((r) => {
    if (r.retired) return false; // retired stubs are inert even if a stale copy carries content
    if (r.type !== 'inject' || !r.content) return false;
    if (r.tier === 1) return true;
    if (r.tier !== 2 || !Array.isArray(r.activateOn)) return false;
    return r.activateOn.some((keyword) => lower.includes(String(keyword).toLowerCase()));
  });
  if (injectRules.length === 0) return '';

  const parts = ['## Harness Rules', ''];
  for (const rule of injectRules) {
    parts.push(rule.content);
  }
  return parts.join('\n');
}

module.exports = {
  loadHarnessRules: tracer.wrap('loadHarnessRules', loadHarnessRules, { tier: 2, category: 'compute' }),
  rulesByEnforcement,
  enforceScopeCheck,
  scopeEntryMatches,
  postExecutionScan,
  scanOutputForBlocks,
  preCommitSecretScan,
  postCommitValidate,
  runMeshHarness: tracer.wrap('runMeshHarness', runMeshHarness, { tier: 2, category: 'compute' }),
  runPreChecks,
  runPostCommitValidation: tracer.wrap('runPostCommitValidation', runPostCommitValidation, { tier: 2, category: 'compute' }),
  formatHarnessForPrompt: tracer.wrap('formatHarnessForPrompt', formatHarnessForPrompt, { tier: 2, category: 'compute' }),
};
