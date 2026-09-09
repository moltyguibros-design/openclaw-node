# AUDIT_PRE — step 1.1 · web-fetch `--markdown`

## §0 Micro re-orient (2026-09-08)

- Plan: integrations, VERSION v0.0 → v1.1-pre. First open row is 1.1. Still the right next step: yes — D7 sequencing confirmed by the operator in-thread (full authorization, Block 1 first).
- Runtime-repair scope is not active; nothing here touches the daemon, NATS or the scheduler.
- Needs pre-screen: `playwright` is a root dependency (package.json) ✔ · `defuddle@0.19.3` added to package.json + lockfile at this phase ✔ · `assertPublicUrl` and the `page.route` guard exist in `workspace-bin/web-fetch.mjs` ✔ · the `playwright-fallback` rule exists in `config/harness-rules.json` ✔ · in-page mechanism proven 2026-09-08 (Playwright 1.51.1, `defuddle/full`, `window.Defuddle`) ✔.

## Intent

`node workspace-bin/web-fetch.mjs <url> --markdown` prints a five-line provenance header
(title, author, published, source, words) and the article body as Markdown, and falls back to
`innerText` when the extractor yields fewer than `WEB_FETCH_MIN_WORDS` words (default 40).

## Design

- Resolve the bundle lazily inside the markdown branch with
  `createRequire(import.meta.url).resolve('defuddle/full')`; a top-level resolve would break
  `test/web-fetch-guard.test.mjs` importing the module on a tree without the dependency.
- `page.addScriptTag({ path })` injects file content inline (Playwright reads the file and
  evaluates it), so the `page.route('**/*')` SSRF guard never sees it. Screenshot branch stays
  before extraction because `parse()` strips `<script>` from the live DOM.
- Two pure helpers exported for tests that must run in CI without a browser:
  `shouldUseClean(result, minWords)` and `formatCleanOutput(result, url)`.
- Existing `MAX_OUTPUT_BYTES` cap applies unchanged.
- `config/harness-rules.json` `playwright-fallback` content names `--markdown`.

## Risks

- CI (Node 20/22, `npm ci`, no `playwright install`): the browser-backed test must skip when
  Chromium cannot launch; the pure helpers carry the assertion weight.
- This container's egress proxy may not be trusted by Chromium for a public page: the runtime
  probe may need the operator's box. If so → BLOCK naming the exact command, do not fake-close.
- A page CSP that forbids inline scripts would reject `addScriptTag`; documented, not handled
  (`bypassCSP` is a later option if it bites in practice).

## §6 file-delta outline

- `package.json`, `package-lock.json`: `defuddle` ^0.19.3 (lock-only update; no tree install).
- `workspace-bin/web-fetch.mjs`: `--markdown` flag, lazy bundle resolve, in-page parse, two
  exported helpers, usage string.
- `test/web-fetch-markdown.test.mjs`: pure-helper tests + browser-backed test that skips without
  Chromium.
- `config/harness-rules.json`: `playwright-fallback.content` mentions `--markdown`.
- Silo: INVENTORY row 1.1 `[A]`→`[x]`, VERSION, COMPONENT_REGISTRY Family 1, AUDIT_POST.
