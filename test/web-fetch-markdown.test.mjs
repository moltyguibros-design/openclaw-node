/**
 * web-fetch-markdown.test.mjs — integrations plan step 1.1.
 *
 * `--markdown` runs Defuddle inside the rendered page and prints a provenance
 * header plus the article as Markdown. The decision and formatting are pure
 * and tested without a browser (CI installs no Chromium). The in-page run is
 * exercised only where Playwright can launch; elsewhere it is skipped, not
 * faked, and the runtime probe in the step's AUDIT_POST carries that proof.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import http from 'node:http';
import { shouldUseClean, formatCleanOutput, MIN_CLEAN_WORDS } from '../workspace-bin/web-fetch.mjs';

const FIXTURE = `<!doctype html><html><head><title>Consolidation cycle notes</title>
<meta name="author" content="Ops"><meta property="article:published_time" content="2026-09-01"></head>
<body><nav><a href="/">Home</a> · <a href="/about">About</a> · Cookie banner: accept?</nav>
<article><h1>Why consolidation skipped 359 times</h1>
<p>The idle gate reads <code>/api/ps</code>, which reports a <em>loaded</em> model, not active inference. Every tick saw a model and declared the daemon busy.</p>
<h2>Fix</h2><ul><li>Measure work, not shape.</li><li>Export the queue snapshot on a timer.</li></ul>
<pre><code>curl -s localhost:11434/api/ps</code></pre></article>
<footer>© 2026 · Privacy · Terms · Subscribe to our newsletter</footer></body></html>`;

describe('shouldUseClean', () => {
  it('accepts an article at or above the word floor', () => {
    assert.equal(shouldUseClean({ content: 'x', wordCount: MIN_CLEAN_WORDS }), true);
    assert.equal(shouldUseClean({ content: 'x', wordCount: 500 }, 40), true);
  });
  it('rejects thin results, missing content and null', () => {
    assert.equal(shouldUseClean({ content: 'x', wordCount: MIN_CLEAN_WORDS - 1 }), false);
    assert.equal(shouldUseClean({ wordCount: 999 }), false);
    assert.equal(shouldUseClean(null), false);
  });
});

describe('formatCleanOutput', () => {
  it('prints title, author, published, source and words, then the body', () => {
    const out = formatCleanOutput(
      { title: 'T', author: 'A', published: '2026-09-01', wordCount: 44, parseTime: 3, content: '## Body' },
      'https://example.org/notes',
    );
    const lines = out.split('\n');
    assert.deepEqual(lines.slice(0, 5), ['# T', 'author: A', 'published: 2026-09-01', 'source: https://example.org/notes', 'words: 44 (defuddle 3ms)']);
    assert.equal(lines[5], '');
    assert.equal(lines[6], '## Body');
  });
  it('omits author and published when the page has none, and never emits "undefined"', () => {
    const out = formatCleanOutput({ wordCount: 50, parseTime: 1, content: 'b' }, 'https://x.example/');
    assert.match(out, /^# \(untitled\)\nsource: https:\/\/x\.example\/\nwords: 50/);
    assert.doesNotMatch(out, /undefined/);
  });
});

describe('in-page Defuddle run (skipped where Chromium cannot launch)', async () => {
  let chromium = null;
  let bundle = null;
  try {
    ({ chromium } = await import('playwright'));
    bundle = createRequire(import.meta.url).resolve('defuddle/full');
  } catch { /* dependency tree not installed here */ }

  it('strips nav, cookie banner and footer and keeps headings, list and code as Markdown', async (t) => {
    if (!chromium || !bundle) return t.skip('playwright or defuddle not installed');
    let browser;
    let server;
    try {
      browser = await chromium.launch({ headless: true, executablePath: process.env.WEB_FETCH_CHROMIUM || undefined });
    } catch (e) {
      return t.skip(`Chromium unavailable: ${e.message.split('\n')[0]}`);
    }
    try {
      // A real navigation, because that is what production does: init scripts
      // are delivered per document, and setContent does not create one.
      server = http.createServer((_req, res) => {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(FIXTURE);
      });
      await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
      const origin = `http://127.0.0.1:${server.address().port}/`;
      const page = await browser.newPage();
      // Same delivery as production: over CDP, before the document exists, so
      // a page CSP forbidding inline <script> cannot refuse it.
      await page.addInitScript({ path: bundle });
      await page.goto(origin);
      const r = await page.evaluate((u) => new window.Defuddle(document, { markdown: true, url: u }).parse(), origin);
      assert.equal(shouldUseClean(r), true);
      const out = formatCleanOutput(r, origin);
      assert.match(out, /^# Consolidation cycle notes\nauthor: Ops\npublished: 2026-09-01\n/);
      assert.match(out, /## Why consolidation skipped 359 times/);
      assert.match(out, /- Measure work, not shape\./);
      assert.match(out, /curl -s localhost:11434\/api\/ps/);
      for (const noise of ['Cookie banner', 'Home', 'About', 'Privacy', 'Subscribe to our newsletter']) {
        assert.doesNotMatch(out, new RegExp(noise), `${noise} should be stripped`);
      }
    } finally {
      await browser.close();
      if (server) await new Promise((resolve) => server.close(resolve));
    }
  });
});
