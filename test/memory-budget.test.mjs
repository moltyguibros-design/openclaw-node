/**
 * memory-budget.test.mjs — Unit tests for lib/memory-budget.mjs
 *
 * Tests MemoryBudget: the session lifecycle, its events, the budget and stats.
 *
 * Run: node --test test/memory-budget.test.mjs
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { MemoryBudget, createBudget } from '../lib/memory-budget.mjs';
import { repo, daemonFixture, transcript, runDaemon, daemonLog, removeFixture } from './helpers/memory-daemon-harness.mjs';
import { extractFacts, mergeFacts, cleanParentheticalChains, stripSupersedes, truncateAtWord } from '../lib/pre-compression-flush.mjs';

let tmpDir;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'memory-budget-test-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('MemoryBudget', () => {
  it('initializes with correct defaults', () => {
    const mb = new MemoryBudget(path.join(tmpDir, 'MEMORY.md'));
    assert.equal(mb.charBudget, 2200);
    assert.equal(mb.isFrozen, false);
  });

  it('accepts custom char budget', () => {
    const mb = new MemoryBudget(path.join(tmpDir, 'MEMORY.md'), { charBudget: 500 });
    assert.equal(mb.charBudget, 500);
  });

  it('startSession freezes content', () => {
    const filePath = path.join(tmpDir, 'MEMORY.md');
    fs.writeFileSync(filePath, '# Memory\n- entry one\n');

    const mb = new MemoryBudget(filePath);
    const frozen = mb.startSession();
    assert.equal(mb.isFrozen, true);
    assert.equal(frozen, '# Memory\n- entry one\n');
  });

  it('endSession clears frozen state', () => {
    const filePath = path.join(tmpDir, 'MEMORY.md');
    fs.writeFileSync(filePath, 'content');

    const mb = new MemoryBudget(filePath);
    mb.startSession();
    assert.equal(mb.isFrozen, true);
    mb.endSession();
    assert.equal(mb.isFrozen, false);
  });

  it('emits freeze event on startSession', () => {
    const filePath = path.join(tmpDir, 'MEMORY.md');
    fs.writeFileSync(filePath, '# Mem\n- line\n');

    const mb = new MemoryBudget(filePath);
    let event = null;
    mb.on('freeze', (e) => { event = e; });
    mb.startSession();

    assert.ok(event);
    assert.equal(event.charCount, '# Mem\n- line\n'.length);
    assert.equal(event.lineCount, 3);
  });
});

describe('getStats', () => {
  it('returns correct usage stats', () => {
    const filePath = path.join(tmpDir, 'MEMORY.md');
    fs.writeFileSync(filePath, '# Memory\n- item\n');

    const mb = new MemoryBudget(filePath, { charBudget: 100 });
    const stats = mb.getStats();

    assert.equal(stats.totalBudget, 100);
    assert.equal(stats.usedChars, '# Memory\n- item\n'.length);
    assert.ok(stats.pctUsed > 0);
    assert.ok(stats.charsRemaining > 0);
    assert.ok(stats.meterDisplay.includes('%'));
  });

  it('handles missing file gracefully', () => {
    const mb = new MemoryBudget(path.join(tmpDir, 'missing.md'));
    const stats = mb.getStats();
    assert.equal(stats.usedChars, 0);
    assert.equal(stats.pctUsed, 0);
  });
});

describe('createBudget', () => {
  it('creates budget with correct file path', () => {
    const mb = createBudget(tmpDir);
    assert.equal(mb.filePath, path.join(tmpDir, 'MEMORY.md'));
  });
});

// Nothing read the frozen copy (no getRendered caller) and nothing called
// addEntry, so the reloads, the add/warning/trim listeners and the
// "snapshot reloaded" log lines suggested prompts changed when none did.
describe('only the live parts of the budget remain', () => {
  it('MemoryBudget keeps the session events, the budget and the stats, and no prompt-snapshot or write API', () => {
    const mb = createBudget(tmpDir, { charBudget: 300 });
    assert.equal(mb.charBudget, 300);
    assert.equal(typeof mb.startSession, 'function');
    assert.equal(typeof mb.endSession, 'function');
    assert.equal(typeof mb.getStats, 'function');
    for (const gone of ['getRendered', 'reload', 'addEntry']) assert.equal(mb[gone], undefined, `${gone} is still exposed`);
  });

  it('the daemon neither reloads a snapshot nor listens for budget writes', () => {
    const daemon = fs.readFileSync(path.join(repo, 'workspace-bin/memory-daemon.mjs'), 'utf8');
    assert.doesNotMatch(daemon, /\.reload\(\)/);
    assert.doesNotMatch(daemon, /memoryBudget\.on\(/);
    assert.doesNotMatch(daemon, /snapshot reloaded/);
  });

  it('a flush that adds facts logs no snapshot reload', () => {
    const fx = daemonFixture();
    try {
      transcript(fx, 'aaaa1111', 10);
      runDaemon(fx, `await daemon.runRequestedFlush([{ sessionId: 'aaaa1111', state: 'ACTIVE' }], config);`);
      const log = daemonLog(fx);
      assert.match(log, /nats-triggered flush \[regex\]: \d+ facts, [1-9]\d* added, \d+ merged \(session aaaa1111\)/);
      assert.doesNotMatch(log, /memory-budget/);
    } finally {
      removeFixture(fx);
    }
  });
});

describe('mergeFacts parenthetical regression', () => {
  it('a speaker-tagged fact appended in a batch can be merged by a later fact in that batch', () => {
    const base = 'the mesh lead runs the NATS JetStream cluster with three replicas on the VM hosts';
    const result = mergeFacts('# Memory\n\n## Recent\n', [
      { fact: `${base} today`, category: 'fact', speaker: 'user' },
      { fact: `${base} tonight`, category: 'fact', speaker: 'user' },
    ], 5000);
    assert.equal(result.added, 1);
    assert.equal(result.merged, 1);
    assert.ok(result.content.includes('tonight'), 'the merge replaced the appended line');
    assert.ok(!result.content.includes(`${base} today`), 'the superseded text is gone');
  });

  it('`$` sequences in a merged fact are kept literally', () => {
    const content = '# Memory\n\n## Recent\n- the deploy script prints the build cost in dollars per run\n';
    const fact = 'the deploy script prints the total build cost in $& dollars per run'; // similarity 0.83: merge band
    const result = mergeFacts(content, [{ fact, category: 'fact' }], 5000);
    assert.equal(result.merged, 1);
    assert.ok(result.content.includes('$& dollars'), result.content);
  });

  it('10 sequential merges on similar facts stay clean (no parenthetical accumulation)', () => {
    // Use long facts with minimal variation so bigram similarity stays above 0.7
    let content = '# Memory\n\n## Recent\n- always prefer using the NATS JetStream cluster for all messaging needs, config round 1\n';

    for (let i = 0; i < 10; i++) {
      const result = mergeFacts(content, [
        { fact: `always prefer using the NATS JetStream cluster for all messaging needs, config round ${i + 2}`, category: 'preference', confidence: 85 },
      ], 5000);
      content = result.content;
      assert.equal(result.merged, 1, `Merge iteration ${i + 1} should merge`);
    }

    // The final content should NOT contain "(updated:" anywhere
    assert.ok(!content.includes('(updated:'), 'No parenthetical chains should remain');

    // Should contain the most recent version of the fact
    assert.ok(content.includes('config round 11'),
      'Should contain the most recent fact text');

    // Should contain exactly one supersedes comment (on the single entry)
    const supersedesCount = (content.match(/<!-- supersedes:/g) || []).length;
    assert.equal(supersedesCount, 1, 'Should have exactly one supersedes comment (on the single entry)');
  });

  it('cleanParentheticalChains strips nested chains', () => {
    const dirty = '# Memory\n- original fact (updated: newer fact (updated: newest fact))\n- clean entry\n';
    const cleaned = cleanParentheticalChains(dirty);

    assert.ok(!cleaned.includes('(updated:'), 'All parenthetical chains should be stripped');
    assert.ok(cleaned.includes('- newest fact'), 'Should keep the innermost (most recent) segment');
    assert.ok(cleaned.includes('- clean entry'), 'Non-chained entries should be untouched');
  });

  it('supersedes comment is present after merge', () => {
    // Use longer facts so bigram similarity exceeds 0.7 threshold
    const content = '# Memory\n\n## Recent\n- we decided to use the NATS JetStream cluster on port 4222 for messaging\n';
    const result = mergeFacts(content, [
      { fact: 'we decided to use the NATS JetStream cluster on port 8080 for messaging', category: 'environment', confidence: 75 },
    ], 5000);

    assert.equal(result.merged, 1);
    assert.ok(result.content.includes('<!-- supersedes:'), 'Merged entry should have supersedes comment');
    assert.ok(result.content.includes('port 8080'),
      'Merged entry should contain the new fact verbatim');
    assert.ok(!result.content.includes('(updated:'), 'Should not use parenthetical format');
  });

  it('stripSupersedes removes HTML comments for clean text', () => {
    const withComment = 'some fact text <!-- supersedes: abcd1234 -->';
    const cleaned = stripSupersedes(withComment);
    assert.equal(cleaned, 'some fact text');
  });

  it('cleanParentheticalChains handles content with no chains', () => {
    const clean = '# Memory\n- normal entry\n- another entry\n';
    const result = cleanParentheticalChains(clean);
    assert.equal(result, clean, 'Clean content should be unchanged');
  });
});

describe('extractFacts assistant extraction', () => {
  it('includes assistant-role messages in extraction', () => {
    const messages = [
      { role: 'assistant', content: "I found that the database config is in /etc/openclaw/db.conf and needs updating" },
      { role: 'user', content: "always use port 5433 for the database connection instead of default" },
    ];
    const facts = extractFacts(messages);
    // Should extract from both roles
    const assistantFacts = facts.filter(f => f.speaker === 'assistant');
    const userFacts = facts.filter(f => f.speaker === 'user');
    assert.ok(assistantFacts.length > 0, 'Should extract facts from assistant messages');
    assert.ok(userFacts.length > 0, 'Should extract facts from user messages');
  });

  it('speaker field is present on all extracted facts', () => {
    const messages = [
      { role: 'user', content: "don't use the old authentication endpoint for any API calls going forward" },
      { role: 'assistant', content: "I'll switch to the new OAuth2 endpoint at /api/v2/auth for all requests" },
    ];
    const facts = extractFacts(messages);
    assert.ok(facts.length > 0, 'Should extract at least one fact');
    for (const f of facts) {
      assert.ok(f.speaker === 'user' || f.speaker === 'assistant',
        `Speaker field must be 'user' or 'assistant', got '${f.speaker}'`);
    }
  });

  it('assistant-specific patterns match agent actions and findings', () => {
    const messages = [
      { role: 'assistant', content: "I'll switch to the new build pipeline using esbuild instead of webpack for faster builds" },
      { role: 'assistant', content: "I noticed that the memory daemon crashes when NATS is unavailable and needs a fallback" },
    ];
    const facts = extractFacts(messages);
    const categories = facts.map(f => f.category);
    assert.ok(categories.includes('agent_action'), 'Should detect agent_action category');
    assert.ok(categories.includes('finding'), 'Should detect finding category');
  });

  it('the regex fallback redacts credentials before they reach MEMORY.md', () => {
    const key = 'sk-proj-' + 'K'.repeat(40);
    const facts = extractFacts([
      { role: 'user', content: `the api endpoint is https://api.example.test with key ${key} and we'll use it` },
      { role: 'user', content: `please store ${key} somewhere safe for the deploy` },
    ]);
    assert.ok(facts.length > 0);
    for (const f of facts) assert.ok(!f.fact.includes('sk-proj'), f.fact);
  });

  it('tool-role messages are excluded from extraction', () => {
    const messages = [
      { role: 'tool', content: "don't use this pattern, always prefer the other approach for consistency" },
      { role: 'system', content: "I found that the critical config is at /opt/openclaw/system.conf for reference" },
    ];
    const facts = extractFacts(messages);
    assert.equal(facts.length, 0, 'Tool and system role messages should produce no facts');
  });

  it('mergeFacts formats entries with speaker tag', () => {
    const content = '# Memory\n\n## Recent\n';
    const facts = [
      { fact: 'the API endpoint moved to port 8080 for all services', category: 'environment', confidence: 75, speaker: 'assistant' },
      { fact: 'always use dark mode in the editor for all development work', category: 'preference', confidence: 85, speaker: 'user' },
    ];
    const result = mergeFacts(content, facts, 5000);
    assert.equal(result.added, 2);
    assert.ok(result.content.includes('[assistant] the API endpoint'), 'Should prefix assistant fact with [assistant]');
    assert.ok(result.content.includes('[user] always use dark mode'), 'Should prefix user fact with [user]');
  });
});

describe('truncateAtWord', () => {
  it('returns short text unchanged', () => {
    const text = 'hello world';
    assert.equal(truncateAtWord(text, 120), text);
  });

  it('truncates at word boundary instead of mid-word', () => {
    const text = 'the quick brown fox jumps over the lazy dog and keeps running across the field until it reaches the distant mountain range beyond';
    const result = truncateAtWord(text, 80);
    assert.ok(result.length <= 80, `Result should be <= 80 chars, got ${result.length}`);
    assert.ok(!result.endsWith(' '), 'Should not end with a space');
    // Should end at a word boundary (no partial word at the end)
    const lastChar = result[result.length - 1];
    assert.ok(lastChar.match(/[a-z]/i), 'Last char should be a letter, not a mid-word cut');
    // Verify it chose a space-aligned boundary
    assert.ok(text.startsWith(result), 'Result should be a prefix of the original');
  });

  it('falls back to hard slice when last space is too early', () => {
    // A string where the only space is very early — "ab <100+ chars of no-space>"
    const text = 'ab ' + 'x'.repeat(120);
    const result = truncateAtWord(text, 80);
    // lastSpace = 2, which is < 80 * 0.7 = 56, so falls back to hard slice
    assert.equal(result.length, 80, 'Should hard-slice to exactly maxLen');
  });

  it('returns text unchanged when exactly at maxLen', () => {
    const text = 'a'.repeat(120);
    assert.equal(truncateAtWord(text, 120), text);
  });
});

describe('extractFacts confidence removal', () => {
  it('returned fact objects do NOT have a confidence property', () => {
    const messages = [
      { role: 'user', content: "don't use the old authentication endpoint for any API calls going forward" },
      { role: 'assistant', content: "I found that the database config is in /etc/openclaw/db.conf and needs updating" },
    ];
    const facts = extractFacts(messages);
    assert.ok(facts.length > 0, 'Should extract at least one fact');
    for (const f of facts) {
      assert.equal('confidence' in f, false, `Fact should not have confidence property, but found confidence=${f.confidence}`);
    }
  });
});
