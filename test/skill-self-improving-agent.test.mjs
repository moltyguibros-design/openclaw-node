/**
 * skill-self-improving-agent.test.mjs — the self-improving-agent hook recipe.
 *
 * Upstream pointed its Claude Code hooks at ./skills/self-improvement/ (not the
 * directory), shipped the scripts 0644 and run directly, read a
 * CLAUDE_TOOL_OUTPUT variable Claude Code never sets, printed a PostToolUse
 * reminder on plain stdout (which never reaches the model), let handler.js lag
 * handler.ts, and logged to .learnings/LEARNINGS.md / ERRORS.md /
 * FEATURE_REQUESTS.md, which boot never reads.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SKILL = join(ROOT, 'skills', 'self-improving-agent');
const SCRIPTS = join(SKILL, 'scripts');
const HAVE_JQ = spawnSync('jq', ['--version']).status === 0;
const LESSON_TAGS = ['correction', 'pattern', 'error', 'preference', 'workflow'];

function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]);
}

const detect = (input) => spawnSync('bash', [join(SCRIPTS, 'error-detector.sh')], {
  input: JSON.stringify(input), encoding: 'utf8', env: { ...process.env, CLAUDE_TOOL_OUTPUT: '' },
});

describe('self-improving-agent hook recipe', () => {
  it('points every hook command at the real skill directory, through bash', () => {
    for (const f of ['references/hooks-setup.md', 'references/templates.md']) {
      const text = readFileSync(join(SKILL, f), 'utf8');
      assert.doesNotMatch(text, /skills\/self-improvement\//, f);
      for (const [, cmd] of text.matchAll(/"command":\s*"([^"]+)"/g)) {
        assert.match(cmd, /^bash \S*skills\/self-improving-agent\/scripts\/[\w-]+\.sh$/, `${f}: ${cmd}`);
        const script = cmd.match(/scripts\/([\w-]+\.sh)$/)[1];
        assert.ok(existsSync(join(SCRIPTS, script)), `${f}: ${script} exists`);
      }
    }
  });

  it('ships the hook scripts executable', () => {
    for (const s of ['activator.sh', 'error-detector.sh', 'extract-skill.sh']) {
      assert.ok(statSync(join(SCRIPTS, s)).mode & 0o111, `${s} is executable`);
    }
  });

  it('error-detector reads the hook JSON on stdin and answers with additionalContext', { skip: !HAVE_JQ && 'jq not installed' }, () => {
    const r = detect({
      hook_event_name: 'PostToolUse', tool_name: 'Bash',
      tool_response: { stdout: '', stderr: 'ls: /nope: No such file or directory', interrupted: false },
    });
    assert.equal(r.status, 0, r.stderr);
    const out = JSON.parse(r.stdout);
    assert.equal(out.hookSpecificOutput.hookEventName, 'PostToolUse');
    assert.match(out.hookSpecificOutput.additionalContext, /<error-detected>/);
    assert.match(out.hookSpecificOutput.additionalContext, /\.learnings\/lessons\.md/);
    assert.match(out.hookSpecificOutput.additionalContext, /\[error\] .* \(YYYY-MM-DD\)/);
  });

  it('error-detector stays silent on a clean command', { skip: !HAVE_JQ && 'jq not installed' }, () => {
    const r = detect({ tool_name: 'Bash', tool_response: { stdout: 'ok\n', stderr: '' } });
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stdout, '');
  });

  it('handler.js behaves like handler.ts, including the sub-agent skip', () => {
    const handler = createRequire(import.meta.url)(join(SKILL, 'hooks', 'openclaw', 'handler.js'));
    const ts = readFileSync(join(SKILL, 'hooks', 'openclaw', 'handler.ts'), 'utf8');
    const reminderTs = ts.match(/const REMINDER_CONTENT = `([\s\S]*?)`;/)[1].replace(/\\`/g, '`');

    const main = { type: 'agent', action: 'bootstrap', sessionKey: 'agent:main', context: { bootstrapFiles: [] } };
    return handler(main).then(async () => {
      assert.equal(main.context.bootstrapFiles.length, 1);
      assert.equal(main.context.bootstrapFiles[0].content, reminderTs);

      const sub = { type: 'agent', action: 'bootstrap', sessionKey: 'agent:main:subagent:x', context: { bootstrapFiles: [] } };
      await handler(sub);
      assert.equal(sub.context.bootstrapFiles.length, 0);
    });
  });

  it('logs only to .learnings/lessons.md with the MEMORY_SPEC tag set', () => {
    assert.ok(!existsSync(join(SKILL, '.learnings')), 'no second log inside the skill');
    const files = walk(SKILL).filter((f) => !f.includes('.clawhub'));
    for (const f of files) {
      const text = readFileSync(f, 'utf8');
      // SKILL.md names the upstream logs once, to say boot does not read them.
      const body = f === join(SKILL, 'SKILL.md')
        ? text.replace(/a ClawHub update would bring back[\s\S]*?boot does not read\./, '')
        : text;
      assert.doesNotMatch(body, /LEARNINGS\.md|ERRORS\.md|FEATURE_REQUESTS\.md|\b(?:LRN|ERR|FEAT)-(?:YYYY|20\d\d)/, f);
    }
    const lines = readFileSync(join(SKILL, 'references', 'examples.md'), 'utf8')
      .split('\n').filter((l) => /^\[\w+\] /.test(l));
    assert.ok(lines.length >= 5);
    for (const l of lines) {
      const [, tag] = l.match(/^\[(\w+)\] .+ \(\d{4}-\d{2}-\d{2}\)$/) || [];
      assert.ok(LESSON_TAGS.includes(tag), l);
    }
  });
});
