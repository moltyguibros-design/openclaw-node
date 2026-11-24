/**
 * Tests for lib/plan-templates.js
 */

const { describe, it } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');
const os = require('os');
const {
  loadTemplate,
  listTemplates,
  validateTemplate,
  instantiateTemplate,
  substituteVars,
} = require('../lib/plan-templates');

// ── substituteVars ────────────────────────────────

describe('substituteVars', () => {
  it('substitutes {{context}} in strings', () => {
    assert.strictEqual(substituteVars('Design: {{context}}', 'user auth'), 'Design: user auth');
  });

  it('substitutes {{vars.key}} in strings', () => {
    assert.strictEqual(
      substituteVars('Deploy to {{vars.env}}', 'app', { env: 'production' }),
      'Deploy to production'
    );
  });

  it('substitutes recursively in objects', () => {
    const result = substituteVars({
      title: 'Fix: {{context}}',
      scope: ['{{vars.dir}}/'],
    }, 'login bug', { dir: 'src/auth' });

    assert.strictEqual(result.title, 'Fix: login bug');
    assert.deepStrictEqual(result.scope, ['src/auth/']);
  });

  it('keeps $ sequences literal and matches var keys exactly', () => {
    assert.strictEqual(substituteVars('Fix: {{context}}', 'cost $& and $$5'), 'Fix: cost $& and $$5');
    assert.strictEqual(
      substituteVars('{{vars.a.b}} {{vars.aXb}}', 'c', { 'a.b': "x$'y" }),
      "x$'y {{vars.aXb}}"
    );
  });

  it('leaves non-string values unchanged', () => {
    assert.strictEqual(substituteVars(42, 'ctx'), 42);
    assert.strictEqual(substituteVars(true, 'ctx'), true);
    assert.strictEqual(substituteVars(null, 'ctx'), null);
  });
});

// ── loadTemplate ──────────────────────────────────

describe('loadTemplate', () => {
  it('loads template from shipped config', () => {
    const templatePath = path.join(__dirname, '..', 'config', 'plan-templates', 'team-feature.yaml');
    const template = loadTemplate(templatePath);

    assert.strictEqual(template.id, 'team-feature');
    assert.ok(template.phases.length > 0);
    assert.ok(template.phases[0].subtasks.length > 0);
  });

  it('loads all three shipped templates', () => {
    const dir = path.join(__dirname, '..', 'config', 'plan-templates');
    for (const name of ['team-feature', 'team-bugfix', 'team-deploy']) {
      const t = loadTemplate(path.join(dir, `${name}.yaml`));
      assert.strictEqual(t.id, name);
    }
  });
});

// ── listTemplates ─────────────────────────────────

describe('listTemplates', () => {
  it('lists templates from directory', () => {
    const dir = path.join(__dirname, '..', 'config', 'plan-templates');
    const templates = listTemplates(dir);

    assert.ok(templates.length >= 3);
    assert.ok(templates.some(t => t.id === 'team-feature'));
    assert.ok(templates.some(t => t.id === 'team-bugfix'));
    assert.ok(templates.some(t => t.id === 'team-deploy'));
  });

  it('returns empty for missing directory', () => {
    assert.deepStrictEqual(listTemplates('/nonexistent'), []);
  });
});

// ── validateTemplate ──────────────────────────────

describe('validateTemplate', () => {
  it('validates shipped templates', () => {
    const dir = path.join(__dirname, '..', 'config', 'plan-templates');
    for (const name of ['team-feature', 'team-bugfix', 'team-deploy']) {
      const t = loadTemplate(path.join(dir, `${name}.yaml`));
      const result = validateTemplate(t);
      assert.ok(result.valid, `${name}: ${result.errors.join(', ')}`);
    }
  });

  it('detects missing template id', () => {
    const result = validateTemplate({ phases: [{ subtasks: [{ id: 'a' }] }] });
    assert.ok(!result.valid);
    assert.ok(result.errors.some(e => e.includes('Missing template id')));
  });

  it('detects duplicate subtask ids', () => {
    const result = validateTemplate({
      id: 'test',
      phases: [
        { subtasks: [{ id: 'a' }, { id: 'a' }] },
      ],
    });
    assert.ok(!result.valid);
    assert.ok(result.errors.some(e => e.includes('Duplicate')));
  });

  it('detects unknown dependency', () => {
    const result = validateTemplate({
      id: 'test',
      phases: [
        { subtasks: [{ id: 'a', depends_on: ['nonexistent'] }] },
      ],
    });
    assert.ok(!result.valid);
    assert.ok(result.errors.some(e => e.includes('unknown subtask')));
  });

  it('detects circular dependency', () => {
    const result = validateTemplate({
      id: 'test',
      phases: [
        { subtasks: [
          { id: 'a', depends_on: ['b'] },
          { id: 'b', depends_on: ['a'] },
        ]},
      ],
    });
    assert.ok(!result.valid);
    assert.ok(result.errors.some(e => e.includes('Circular')));
  });

  it('detects invalid delegation mode', () => {
    const result = validateTemplate({
      id: 'test',
      phases: [
        { subtasks: [{ id: 'a', delegation: { mode: 'invalid_mode' } }] },
      ],
    });
    assert.ok(!result.valid);
    assert.ok(result.errors.some(e => e.includes('invalid delegation mode')));
  });
});

// ── instantiateTemplate ───────────────────────────

describe('instantiateTemplate', () => {
  it('instantiates team-feature with context', () => {
    const dir = path.join(__dirname, '..', 'config', 'plan-templates');
    const template = loadTemplate(path.join(dir, 'team-feature.yaml'));
    const plan = instantiateTemplate(template, 'Add user authentication', {
      parent_task_id: 'T-001',
    });

    assert.ok(plan.plan_id);
    assert.strictEqual(plan.parent_task_id, 'T-001');
    assert.ok(plan.title.includes('user authentication'));
    assert.ok(plan.subtasks.length === 5); // design, architecture, implement, test, review
    assert.strictEqual(plan.failure_policy, 'abort_on_critical_fail');
    assert.strictEqual(plan.status, 'draft');

    // Check dependency wiring
    const arch = plan.subtasks.find(s => s.subtask_id === 'architecture');
    assert.ok(arch.depends_on.includes('design'));

    // Check wave computation
    const design = plan.subtasks.find(s => s.subtask_id === 'design');
    assert.strictEqual(design.wave, 0);
    assert.strictEqual(arch.wave, 1);
  });

  it('instantiates with variable substitution', () => {
    const dir = path.join(__dirname, '..', 'config', 'plan-templates');
    const template = loadTemplate(path.join(dir, 'team-bugfix.yaml'));
    const plan = instantiateTemplate(template, 'Login redirect loop', { parent_task_id: 'T-002' });

    assert.ok(plan.title.includes('Login redirect loop'));
    assert.ok(plan.subtasks[0].title.includes('Login redirect loop'));
  });

  it('auto-routes subtasks with mode: auto', () => {
    const dir = path.join(__dirname, '..', 'config', 'plan-templates');
    const template = loadTemplate(path.join(dir, 'team-feature.yaml'));
    const plan = instantiateTemplate(template, 'test feature', { parent_task_id: 'T-003' });

    const impl = plan.subtasks.find(s => s.subtask_id === 'implement');
    assert.ok(impl.delegation.mode !== 'auto', 'auto should be resolved by autoRoutePlan');
  });

  it('a non-positive template budget takes the default, a fraction is kept', () => {
    const template = {
      id: 'odd-budgets',
      phases: [{ subtasks: [{ id: 'neg', title: 'neg', budget_minutes: -1 }, { id: 'frac', title: 'frac', budget_minutes: 1.5 }] }],
    };
    const plan = instantiateTemplate(template, 'x', { parent_task_id: 'T-004' });
    assert.deepStrictEqual(plan.subtasks.map(s => s.budget_minutes), [15, 1.5]);
  });

  it('marks critical subtasks', () => {
    const dir = path.join(__dirname, '..', 'config', 'plan-templates');
    const template = loadTemplate(path.join(dir, 'team-feature.yaml'));
    const plan = instantiateTemplate(template, 'test', { parent_task_id: 'T-005' });

    const design = plan.subtasks.find(s => s.subtask_id === 'design');
    const impl = plan.subtasks.find(s => s.subtask_id === 'implement');
    assert.strictEqual(design.critical, true);
    assert.strictEqual(impl.critical, false);
  });

  // The daemon refuses a plan whose parent task does not exist; an invented
  // TEMPLATE-* parent made every flagless `mesh plan create` fail at the server.
  it('requires a parent task id instead of inventing one', () => {
    const dir = path.join(__dirname, '..', 'config', 'plan-templates');
    const template = loadTemplate(path.join(dir, 'team-feature.yaml'));
    assert.throws(() => instantiateTemplate(template, 'test'), /parent_task_id is required/);
  });
});

describe('mesh plan create CLI', () => {
  it('exits 1 with the usage line before connecting when --parent-task is missing', () => {
    const { spawnSync } = require('node:child_process');
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'plan-create-cli-'));
    try {
      const r = spawnSync(process.execPath, [path.join(__dirname, '..', 'bin', 'mesh.js'), 'plan', 'create', '--template', 'team-feature', '--context', 'x'], {
        encoding: 'utf8', timeout: 20000,
        env: { PATH: process.env.PATH, HOME: home, OPENCLAW_NATS: 'nats://127.0.0.1:1', OPENCLAW_OBS_DB: ':memory:' },
      });
      assert.strictEqual(r.status, 1, r.stdout + r.stderr);
      assert.match(r.stderr, /Usage: mesh plan create --template <id> --parent-task <task-id>/);
      assert.doesNotMatch(r.stderr + r.stdout, /ECONNREFUSED|CONNECTION_REFUSED|not found/);
    } finally {
      fs.rmSync(home, { recursive: true, force: true });
    }
  });
});
