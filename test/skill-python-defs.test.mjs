/**
 * skill-python-defs.test.mjs — no skill Python script defines the same
 * top-level function or class twice.
 *
 * crypto-price's get_price_chart.py carried two copies of _post_json and of
 * its Hyperliquid helpers and three of _hyperliquid_lookup; Python keeps the
 * last definition, so edits to the earlier copies silently did nothing.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync, existsSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SKILLS = join(ROOT, 'skills');
const HAVE_PY = spawnSync('python3', ['--version'], { encoding: 'utf8' }).status === 0;

const DUPLICATE_DEFS = `
import ast, sys
for path in sys.argv[1:]:
    seen = {}
    for node in ast.parse(open(path, encoding="utf-8").read(), path).body:
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
            seen[node.name] = seen.get(node.name, 0) + 1
    dups = sorted(name for name, n in seen.items() if n > 1)
    if dups:
        print(path + ": " + ", ".join(dups))
`;

const SKIP_DIRS = new Set(['_quarantine', 'node_modules', '__pycache__']);
const skillPythonFiles = () =>
  readdirSync(SKILLS, { recursive: true })
    .filter(rel => rel.endsWith('.py') && !rel.split(sep).some(part => SKIP_DIRS.has(part)))
    .map(rel => join(SKILLS, rel));

describe('skill Python scripts', { skip: !HAVE_PY && 'python3 not available' }, () => {
  it('define each top-level function or class once', () => {
    const files = skillPythonFiles();
    assert.ok(files.length > 0);
    const r = spawnSync('python3', ['-I', '-c', DUPLICATE_DEFS, ...files], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stdout, '');
  });

  it('crypto-price get_price_chart.py still loads and reports a missing symbol', () => {
    const r = spawnSync('python3', ['-B', join(SKILLS, 'crypto-price', 'scripts', 'get_price_chart.py')], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    assert.equal(JSON.parse(r.stdout).error, 'missing symbol');
  });

  it('gemini-deep-research sets HTTP timeouts and stops polling a cancelled interaction', () => {
    const stubDir = mkdtempSync(join(tmpdir(), 'deep-research-stub-'));
    try {
      writeFileSync(join(stubDir, 'requests.py'), `
calls = []
class R:
    status_code = 200
    def __init__(self, body): self.body = body
    def json(self): return self.body
def post(url, **kw):
    calls.append(("post", kw.get("timeout")))
    return R({"id": "i1"})
def get(url, **kw):
    calls.append(("get", kw.get("timeout")))
    if len(calls) > 3: raise SystemExit("polled a cancelled interaction again")
    return R({"status": "cancelled"})
`);
      const probe = `
import sys, time
sys.path[:0] = [sys.argv[1], sys.argv[2]]
time.sleep = lambda s: None
import requests, deep_research
deep_research.create_interaction("k", "q")
try:
    deep_research.poll_interaction("k", "i1")
    print("RETURNED")
except SystemExit as e:
    print("EXIT", e.code)
print(requests.calls)
`;
      const r = spawnSync('python3', ['-I', '-B', '-c', probe, stubDir,
        join(SKILLS, 'gemini-deep-research', 'scripts')], { encoding: 'utf8' });
      assert.equal(r.status, 0, r.stderr);
      const [outcome, calls] = r.stdout.trim().split('\n');
      assert.equal(outcome, 'EXIT 1', r.stdout + r.stderr);
      assert.equal(calls, "[('post', 60), ('get', 60)]");
    } finally {
      rmSync(stubDir, { recursive: true, force: true });
    }
  });
});

describe('skill Python dependencies', () => {
  it('every skill script that imports requests declares it in the skill requirements.txt', () => {
    const files = skillPythonFiles().filter(f => /^\s*(import requests|from requests )/m.test(readFileSync(f, 'utf8')));
    assert.ok(files.length > 0);
    for (const f of files) {
      const skill = f.slice(SKILLS.length + 1).split(sep)[0];
      const req = join(SKILLS, skill, 'requirements.txt');
      assert.ok(existsSync(req), `${skill} imports requests without a requirements.txt`);
      assert.match(readFileSync(req, 'utf8'), /^requests\b/m, `${skill}/requirements.txt`);
    }
  });

  it('gemini-deep-research runs its script through python3, which needs no exec bit', () => {
    const md = readFileSync(join(SKILLS, 'gemini-deep-research', 'SKILL.md'), 'utf8');
    assert.doesNotMatch(md, /^scripts\/deep_research\.py/m);
    assert.match(md, /^python3 \{baseDir\}\/scripts\/deep_research\.py --query/m);
  });

  it('shipped SKILL.md files never run a script through a bare `python`, which nodes do not install', () => {
    // humanize-ai-text waits on the operator's keep-or-quarantine decision (audit skills-a-l#21).
    const pending = new Set(['humanize-ai-text']);
    const bare = /(?:^\s*|[|;&]\s*)python\s+(?:\{baseDir\}\/)?scripts\//m;
    const skills = readdirSync(SKILLS).filter(d => !SKIP_DIRS.has(d) && !pending.has(d) && existsSync(join(SKILLS, d, 'SKILL.md')));
    const offenders = skills.filter(d => bare.test(readFileSync(join(SKILLS, d, 'SKILL.md'), 'utf8')));
    assert.deepEqual(offenders, []);
    assert.match(readFileSync(join(SKILLS, 'web-search', 'SKILL.md'), 'utf8'), /^python3 \{baseDir\}\/scripts\/search\.py "<query>"$/m);
    assert.match(readFileSync(join(SKILLS, 'model-usage', 'SKILL.md'), 'utf8'), /\| python3 \{baseDir\}\/scripts\/model_usage\.py --input -/);
  });
});
