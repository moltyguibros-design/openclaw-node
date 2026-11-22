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

  // The stated "change over 24h" came from the 80% window kept for the chart, and a
  // BTC/USDC symbol put a '/' into the chart filename, so savefig raised.
  it('crypto-price measures the change over the full period and names the chart without a path separator', () => {
    const probe = `
import importlib.util, sys
spec = importlib.util.spec_from_file_location("gpc", sys.argv[1])
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
c = [(i * 900000, float(i), float(i), float(i), float(i)) for i in range(200)]
plot, base = m._period_window(c, 24, 15)
print(base == c[-96][4], len(plot), m._period_window(c[:1], 24, 15)[1],
      "/" not in m._chart_path("BTC/USDC", 1)[len("/tmp/"):])
`;
    const r = spawnSync('python3', ['-I', '-B', '-c', probe,
      join(SKILLS, 'crypto-price', 'scripts', 'get_price_chart.py')], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stdout.trim(), 'True 76 None True');
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

const HAVE_OPENPYXL = HAVE_PY && spawnSync('python3', ['-c', 'import openpyxl'], { encoding: 'utf8' }).status === 0;

describe('excel skill script', { skip: !HAVE_OPENPYXL && 'openpyxl not available' }, () => {
  const EXCEL = join(SKILLS, 'excel', 'scripts', 'excel.py');
  const run = (...args) => {
    const r = spawnSync('python3', ['-B', EXCEL, ...args], { encoding: 'utf8' });
    return { status: r.status, out: r.stdout ? JSON.parse(r.stdout) : null, stderr: r.stderr };
  };

  it('cell returns the value and merge state, and format accepts an A1-style column range', () => {
    const dir = mkdtempSync(join(tmpdir(), 'excel-skill-'));
    try {
      const book = join(dir, 't.xlsx');
      assert.equal(run('create', book).status, 0);
      assert.equal(run('write', book, '--data', '[["hello"]]').status, 0);
      const written = run('cell', book, 'A1');
      assert.equal(written.status, 0, JSON.stringify(written));
      assert.equal(written.out.value, 'hello');
      assert.equal(written.out.is_merged, false);
      const empty = run('cell', book, 'Z9');
      assert.equal(empty.status, 0, JSON.stringify(empty));
      assert.equal(empty.out.value, null);
      const fmt = run('format', book, 'A1:A10', '--align', 'center', '--valign', 'top');
      assert.equal(fmt.status, 0, JSON.stringify(fmt));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('skill Python dependencies', () => {
  for (const mod of ['requests', 'openpyxl']) {
    it(`every skill script that imports ${mod} declares it in the skill requirements.txt`, () => {
      const imports = new RegExp(`^\\s*(import ${mod}\\b|from ${mod}[. ])`, 'm');
      const files = skillPythonFiles().filter(f => imports.test(readFileSync(f, 'utf8')));
      assert.ok(files.length > 0);
      for (const f of files) {
        const skill = f.slice(SKILLS.length + 1).split(sep)[0];
        const req = join(SKILLS, skill, 'requirements.txt');
        assert.ok(existsSync(req), `${skill} imports ${mod} without a requirements.txt`);
        assert.match(readFileSync(req, 'utf8'), new RegExp(`^${mod}\\b`, 'm'), `${skill}/requirements.txt`);
        assert.match(readFileSync(join(ROOT, 'README.md'), 'utf8'), new RegExp(`^- \\*\\*${skill}\\*\\* — pip: .*\\b${mod}\\b`, 'm'),
          `README "Skills with their own dependencies" omits ${skill}`);
      }
    });
  }

  it('excel cell reads a full worksheet and SKILL.md formats only A1-style ranges', () => {
    const py = readFileSync(join(SKILLS, 'excel', 'scripts', 'excel.py'), 'utf8');
    const cell = py.match(/^def cmd_cell\(args\):\n([\s\S]*?)^def /m);
    assert.ok(cell);
    assert.doesNotMatch(cell[1], /read_only=True/, 'a read-only worksheet has no merged_cells');
    assert.doesNotMatch(readFileSync(join(SKILLS, 'excel', 'SKILL.md'), 'utf8'), /excel\.py format \S+ [A-Z]+:[A-Z]+ /);
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
