import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SKILLS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'skills');

function files(dir, exts = ['.md']) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) return e.name === '_quarantine' || e.name === 'node_modules' ? [] : files(full, exts);
    return exts.some((x) => e.name.endsWith(x)) ? [full] : [];
  });
}
const markdown = (dir) => files(dir);
const hitsOf = (list, re) => list.flatMap((file) => fs.readFileSync(file, 'utf8').split('\n')
  .map((line, i) => (re.test(line) ? `${path.relative(SKILLS, file)}:${i + 1}: ${line.trim()}` : null))
  .filter(Boolean));

// Skill installs and updates go only through openclaw-skill-scanner/install-hook.sh
// (operator decision, audit finding skills-a-l#8).
describe('skill install gate', () => {
  // prompt-guard waits on the operator's scanner decision (skills-m-z-souls-identity#1): the
  // skill gate blocks any commit to it. ui-ux-pro-max's upstream README clones for contributors.
  const BYPASS_EXEMPT = new Set(['prompt-guard', 'ui-ux-pro-max/references/upstream-README.md']);
  it('no loaded skill tells the agent to install or bulk-update skills or global packages around the scanner', () => {
    const bypass = /npx skills (add|update)\b|clawd?hub update --all|npm update -g clawdbot|openclaw skills (install|add)\b|clawd?hub install\b|git clone \S*skill|npm install -g @/;
    const shipped = files(SKILLS, ['.md', '.json']).filter((file) => {
      const rel = path.relative(SKILLS, file).split(path.sep).join('/');
      return !BYPASS_EXEMPT.has(rel) && !BYPASS_EXEMPT.has(rel.split('/')[0]);
    });
    assert.deepEqual(hitsOf(shipped, bypass), []);
    const marketing = JSON.parse(fs.readFileSync(path.join(SKILLS, 'marketing-mode', 'skill.json'), 'utf8'));
    assert.equal(marketing.install, undefined);
    assert.equal(marketing.clawdbot.install, undefined);
    assert.ok(!fs.existsSync(path.join(SKILLS, 'moltbook-interact', 'INSTALL.md')));
  });

  // install-hook.sh replaces an existing workspace copy with the ClawHub one, undoing the repo's fixes.
  it('no repo-shipped skill tells the agent to reinstall or copy itself in', () => {
    const gates = new Set(['_quarantine', 'find-skills', 'openclaw-skill-scanner']);
    const hits = fs.readdirSync(SKILLS, { withFileTypes: true })
      .filter((e) => e.isDirectory() && !gates.has(e.name))
      .flatMap((e) => hitsOf(markdown(path.join(SKILLS, e.name)),
        new RegExp(`install-hook\\.sh ${e.name}\\b|cp -r .*~/\\.openclaw/(workspace/)?skills/`)));
    assert.deepEqual(hits, []);
  });

  // Command output lands in the session transcript, the model provider and the memory store.
  it('no loaded skill prints a token, key or secret value', () => {
    const leak = /printenv\s+\S*(TOKEN|KEY|SECRET)|openclaw\.json[^\n]*grep[^\n]*"token"/;
    const hits = markdown(SKILLS).flatMap((file) => fs.readFileSync(file, 'utf8').split('\n')
      .map((line, i) => (leak.test(line) ? `${path.relative(SKILLS, file)}:${i + 1}: ${line.trim()}` : null))
      .filter(Boolean));
    assert.deepEqual(hits, []);
    const clawguard = fs.readFileSync(path.join(SKILLS, 'clawguard', 'SKILL.md'), 'utf8');
    assert.match(clawguard, /"match" if t==e else "mismatch"/);
    assert.match(clawguard, /Never print token values/);
  });

  it('auto-updater is quarantined', () => {
    assert.ok(!fs.existsSync(path.join(SKILLS, 'auto-updater')));
    assert.ok(fs.existsSync(path.join(SKILLS, '_quarantine', 'auto-updater', 'SKILL.md')));
    assert.match(fs.readFileSync(path.join(SKILLS, '_quarantine', 'README.md'), 'utf8'), /\| `auto-updater` \|/);
  });

  it('find-skills routes any install through the scanner gate without --force or -y', () => {
    const text = fs.readFileSync(path.join(SKILLS, 'find-skills', 'SKILL.md'), 'utf8');
    assert.match(text, /bash skills\/openclaw-skill-scanner\/install-hook\.sh <clawhub-slug>/);
    assert.doesNotMatch(text, /\s-y\b|--yes/);
    assert.match(text, /Never pass `--force`/);
  });

  // The scanner gates skills, not gateway plugins: clawguard's plugin runs inside the gateway.
  // The plugin reads api.pluginConfig, which the gateway fills from plugins.entries.<id>.config.
  it('clawguard installs a pinned gateway plugin as an operator step, metrics off', () => {
    const text = fs.readFileSync(path.join(SKILLS, 'clawguard', 'SKILL.md'), 'utf8');
    const installs = text.split('\n').filter((l) => /plugins install /.test(l));
    assert.equal(installs.length, 2, installs.join('\n'));
    for (const line of installs) assert.match(line, /plugins install @capsulesecurity\/clawguard@0\.1\.5$/, line);
    for (const install of ['openclaw plugins install', 'openclaw-cli plugins install']) {
      const after = text.slice(text.indexOf(install));
      assert.match(after.slice(0, after.indexOf('```')), /config set plugins\.entries\.clawguard\.config\.metricsEnabled false/, install);
    }
    assert.doesNotMatch(text, /config set plugins\.clawguard\./);
    assert.match(text, /The agent does not run the Prerequisites, Installation or Docker commands/);
    assert.match(text, /sent to the configured model/);
  });
});

// The node runs the openclaw CLI from ~/.openclaw; clawdbot, clawdhub and
// ~/.clawdbot are gone (audit findings skills-a-l#17, #2). prompt-guard names the
// old paths on purpose, as attack patterns.
describe('no clawdbot-era commands or paths', () => {
  const LEGACY_EXEMPT = new Set(['prompt-guard']);
  it('no loaded skill runs the clawdbot or clawdhub CLI or touches ~/.clawdbot', () => {
    const legacy = /(~|\$HOME)\/\.clawdbot\b|(^|[\s`$(])clawdhub\s+[a-z]|(^|[\s`$(])clawdbot\s+(skills|security|doctor|daemon|update|cron|gateway|config)\b/;
    const docs = markdown(SKILLS).filter((file) => !LEGACY_EXEMPT.has(path.relative(SKILLS, file).split(path.sep)[0]));
    assert.deepEqual(hitsOf(docs, legacy), []);
  });

  it('no loaded skill shell block uses a clawdbot-named variable, socket or path', () => {
    const legacy = /\bCLAWDBOT_[A-Z_]+|clawdbot-(?!security-check\b)[a-z][a-z.-]*/;
    const hits = markdown(SKILLS)
      .filter((file) => !LEGACY_EXEMPT.has(path.relative(SKILLS, file).split(path.sep)[0]))
      .flatMap((file) => {
        let fenced = false;
        return fs.readFileSync(file, 'utf8').split('\n').flatMap((line, i) => {
          if (/^\s*```/.test(line)) { fenced = !fenced; return []; }
          return fenced && legacy.test(line) ? [`${path.relative(SKILLS, file)}:${i + 1}: ${line.trim()}`] : [];
        });
      });
    assert.deepEqual(hits, []);
  });

  // Every grep against a missing ~/.clawdbot printed nothing, so the audit read as clean.
  it('clawdbot-security-check audits the openclaw config read-only and never reports a missing one as clean', () => {
    const dir = path.join(SKILLS, 'clawdbot-security-check');
    const skill = fs.readFileSync(path.join(dir, 'SKILL.md'), 'utf8');
    const checks = fs.readFileSync(path.join(dir, 'references', 'audit-checks.md'), 'utf8');
    assert.match(skill, /^name: clawdbot-security-check$/m);
    assert.match(skill, /`openclaw security audit --deep`/);
    assert.match(skill, /~\/\.openclaw\/openclaw\.json/);
    assert.doesNotMatch(skill, /security audit --fix|## Audit Fix Actions/);
    assert.match(checks, /audit not run/);
    assert.doesNotMatch(checks, /\.clawdbotrc|clawdbot\.json/);
    assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'skill.json'), 'utf8')).scripts, undefined);
  });

  // A basic-regex `grep -i "a|b"` treats '|' as a literal and prints nothing, which read as clean.
  it('clawdbot-security-check detection commands match the node config keys and never print the gateway token', () => {
    const dir = path.join(SKILLS, 'clawdbot-security-check');
    const skill = fs.readFileSync(path.join(dir, 'SKILL.md'), 'utf8');
    const checks = fs.readFileSync(path.join(dir, 'references', 'audit-checks.md'), 'utf8');
    for (const text of [skill, checks]) {
      assert.doesNotMatch(text, /dm_policy|auth_token/);
      assert.doesNotMatch(text, /stat -c/);
      assert.doesNotMatch(text, /grep -A\d+ '"gateway"'/);
      assert.doesNotMatch(text, /"bind": "127\.0\.0\.1"/);
    }

    const greps = checks.split('\n').flatMap((line) => {
      const m = line.match(/^cat ~\/\.openclaw\/openclaw\.json \| grep((?:\s+-[A-Za-z0-9]+)*)\s+(['"])(.*)\2$/);
      return m ? [{ flags: m[1].trim().split(/\s+/).filter(Boolean), pattern: m[3] }] : [];
    });
    assert.ok(greps.length >= 12, `expected the domain grep commands, found ${greps.length}`);
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'security-check-'));
    try {
      for (const { flags, pattern } of greps) {
        for (const term of pattern.split('|')) {
          const file = path.join(tmp, 'term.json');
          fs.writeFileSync(file, `  ${term}: true\n`);
          const r = spawnSync('grep', [...flags, pattern, file], { encoding: 'utf8' });
          assert.equal(r.status, 0, `grep ${flags.join(' ')} '${pattern}' misses a line containing ${term}`);
        }
      }
      // Keys OpenClaw supports that the node's template does not set.
      const TEMPLATE_ABSENT = new Set(['"browser"', 'controlUi|insecureAuth', 'restrict|mcp|elevated',
        'workspaceAccess|sandbox', 'openRoom', 'logging|redact', 'untrusted|wrap', '"blocked_commands"']);
      const template = path.join(path.dirname(SKILLS), 'config', 'openclaw.json.template');
      const silent = greps.filter(({ flags, pattern }) => !TEMPLATE_ABSENT.has(pattern)
        && spawnSync('grep', [...flags, pattern, template]).status !== 0).map(({ pattern }) => pattern);
      assert.deepEqual(silent, []);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});
