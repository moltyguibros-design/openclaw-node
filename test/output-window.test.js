#!/usr/bin/env node
/**
 * output-window.test.js — runLLM's capture keeps both ends of an oversized output and says
 * so; the verdict and circling parsers fail closed on a truncated capture.
 *
 * Run: node --test test/output-window.test.js
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { createOutputWindow } = require('../lib/output-window');
const { parseCirclingReflection } = require('../lib/circling-parser');

describe('createOutputWindow', () => {
  it('passes an output under the cap through unchanged', () => {
    const w = createOutputWindow(4, 6);
    for (const chunk of ['ab', 'cdef', 'ghij']) w.push(chunk);
    assert.equal(w.truncated, false);
    assert.equal(w.text(), 'abcdefghij');
  });

  it('keeps the head and a rolling tail once the cap is passed, and marks the cut', () => {
    const w = createOutputWindow(4, 6);
    for (const chunk of ['HEAD', '0123456789', 'TAIL!!']) w.push(chunk);
    assert.equal(w.truncated, true);
    assert.equal(w.text(), 'HEAD\n…(output truncated: 10 characters dropped)…\nTAIL!!');
  });
});

describe('parsers on a truncated capture', () => {
  const circling = 'the artifact\n===CIRCLING_REFLECTION===\ntype: workArtifact\nsummary: ok\nconfidence: 0.9\nvote: converged\n===END_REFLECTION===';

  it('the circling parser reports parse_failed with no artifacts', () => {
    assert.equal(parseCirclingReflection(circling).vote, 'converged');
    const cut = parseCirclingReflection(circling, { truncated: true });
    assert.equal(cut.parse_failed, true);
    assert.equal(cut.vote, 'parse_error');
    assert.deepEqual(cut.circling_artifacts, []);
  });

  it('parseVerdict returns no verdict', async () => {
    const { parseVerdict } = await import('../lib/foreman/verifier.mjs');
    assert.equal(parseVerdict('FOREMAN_VERDICT: PASS').passed, true);
    const cut = parseVerdict('FOREMAN_VERDICT: PASS', { truncated: true });
    assert.equal(cut.passed, null);
    assert.equal(cut.reason, 'output exceeded the capture cap');
  });
});
