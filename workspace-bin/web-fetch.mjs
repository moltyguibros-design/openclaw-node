#!/usr/bin/env node
/**
 * web-fetch.mjs — Playwright-based web fetcher
 *
 * Renders JS-heavy pages and returns clean text/HTML.
 * Fallback for when WebFetch gets blocked by anti-bot or JS rendering.
 *
 * Usage:
 *   node bin/web-fetch.mjs <url>                    # returns text content
 *   node bin/web-fetch.mjs <url> --html             # returns raw HTML
 *   node bin/web-fetch.mjs <url> --selector "article"  # extract specific element
 *   node bin/web-fetch.mjs <url> --wait 5000        # custom wait (ms)
 *   node bin/web-fetch.mjs <url> --screenshot out.png  # save screenshot
 *   node bin/web-fetch.mjs <url> --markdown         # readability pass → provenance header + Markdown
 *
 * --markdown injects the Defuddle bundle into the rendered page (inline
 * script content, never a network request, so the route guard below is not
 * involved) and prints the article as Markdown with a title/author/date
 * header. Pages where the extractor finds fewer than WEB_FETCH_MIN_WORDS
 * words fall back to innerText so a thin or app-shell page still yields text.
 *
 * Reachability guard (review P5-7): this tool runs with the node's network
 * position, so an agent-supplied URL used to reach the NATS monitor, the
 * memory inject server, the cloud metadata endpoint or file:// paths. Only
 * http(s) to PUBLIC addresses is fetched — every sub-request and redirect
 * included — and output is capped.
 */

import dns from 'node:dns/promises';
import net from 'node:net';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

export const MAX_OUTPUT_BYTES = Number(process.env.WEB_FETCH_MAX_BYTES) || 2 * 1024 * 1024;
export const MIN_CLEAN_WORDS = Number(process.env.WEB_FETCH_MIN_WORDS) || 40;

// The exports map of the package hides dist/, so resolve through the `full`
// export (the only build that carries the Markdown converter). Resolved lazily:
// importing this module must not require the dependency to be installed.
function defuddleBundlePath() {
  return createRequire(import.meta.url).resolve('defuddle/full');
}

/**
 * Chromium's proxy-bypass parser takes hostname and suffix entries only. A
 * NO_PROXY carrying CIDR blocks (as container runtimes write it) is rejected
 * wholesale, which silently sends direct-only hosts through the proxy — where
 * a re-terminating proxy's certificate then fails validation. Keep the names.
 */
export function chromiumBypassList(raw = process.env.NO_PROXY || process.env.no_proxy || '') {
  const names = raw.split(',')
    .map(e => e.trim())
    .filter(e => e && !e.includes('/') && !net.isIP(e.replace(/^\[|\]$/g, '')));
  return names.length ? names.join(',') : undefined;
}

/** The extractor found enough of an article to trust over raw innerText. */
export function shouldUseClean(result, minWords = MIN_CLEAN_WORDS) {
  return Boolean(result && typeof result.content === 'string' && (result.wordCount || 0) >= minWords);
}

/** Provenance header + Markdown body, the shape downstream extractors read. */
export function formatCleanOutput(result, url) {
  const head = [
    `# ${result.title || '(untitled)'}`,
    result.author && `author: ${result.author}`,
    result.published && `published: ${result.published}`,
    `source: ${url}`,
    `words: ${result.wordCount} (defuddle ${result.parseTime}ms)`,
  ].filter(Boolean).join('\n');
  return `${head}\n\n${result.content}`;
}

const BLOCKED_HOSTNAMES = new Set(['localhost', 'metadata', 'metadata.google.internal', 'instance-data']);

function ipv4ToInt(ip) {
  return ip.split('.').reduce((acc, o) => (acc << 8) + Number(o), 0) >>> 0;
}
function inCidr4(ip, cidr) {
  const [base, bits] = cidr.split('/');
  const mask = bits === '0' ? 0 : (~0 << (32 - Number(bits))) >>> 0;
  return (ipv4ToInt(ip) & mask) === (ipv4ToInt(base) & mask);
}
const PRIVATE_V4 = ['0.0.0.0/8', '10.0.0.0/8', '100.64.0.0/10', '127.0.0.0/8', '169.254.0.0/16',
  '172.16.0.0/12', '192.0.0.0/24', '192.168.0.0/16', '198.18.0.0/15', '224.0.0.0/4', '240.0.0.0/4'];

/** True for loopback, link-local, RFC1918/ULA, multicast, unspecified and mapped forms. */
export function isPrivateIp(ip) {
  const v = net.isIP(ip);
  if (v === 4) return PRIVATE_V4.some(c => inCidr4(ip, c));
  if (v !== 6) return true; // not an IP at all → treat as unsafe
  const lower = ip.toLowerCase();
  const mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isPrivateIp(mapped[1]);
  if (lower === '::' || lower === '::1') return true;
  if (/^f[cd]/.test(lower)) return true;          // fc00::/7 unique-local
  if (/^fe[89ab]/.test(lower)) return true;        // fe80::/10 link-local
  if (/^ff/.test(lower)) return true;              // multicast
  if (lower.startsWith('64:ff9b:')) {              // NAT64 — check the embedded v4
    const tail = lower.split(':').slice(-2);
    if (tail.length === 2 && tail.every(h => /^[0-9a-f]{1,4}$/.test(h))) {
      const n = (parseInt(tail[0], 16) << 16) + parseInt(tail[1], 16);
      return isPrivateIp([n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join('.'));
    }
  }
  return false;
}

/**
 * Throws unless `url` is http(s) to a hostname whose EVERY resolved address is
 * public. Resolution happens here so a DNS name that maps to 127.0.0.1 or
 * 169.254.169.254 is refused before any connection.
 */
export async function assertPublicUrl(url, { lookup = (h) => dns.lookup(h, { all: true }) } = {}) {
  let parsed;
  try { parsed = new URL(url); } catch { throw new Error(`invalid URL: ${url}`); }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`refused: scheme ${parsed.protocol} (only http/https)`);
  }
  if (parsed.username || parsed.password) throw new Error('refused: credentials in URL');
  const host = parsed.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (!host || BLOCKED_HOSTNAMES.has(host) || host.endsWith('.localhost') || host.endsWith('.internal') || host.endsWith('.local')) {
    throw new Error(`refused: host ${host || '(empty)'} is local/internal`);
  }
  if (net.isIP(host)) {
    if (isPrivateIp(host)) throw new Error(`refused: ${host} is a private/reserved address`);
    return parsed;
  }
  let addrs;
  try { addrs = await lookup(host); } catch (e) { throw new Error(`refused: cannot resolve ${host} (${e.message})`); }
  const list = (Array.isArray(addrs) ? addrs : [addrs]).map(a => (typeof a === 'string' ? a : a.address));
  if (!list.length) throw new Error(`refused: ${host} resolved to nothing`);
  const bad = list.find(isPrivateIp);
  if (bad) throw new Error(`refused: ${host} resolves to private/reserved address ${bad}`);
  return parsed;
}

async function main() {
  const args = process.argv.slice(2);
  const url = args.find(a => !a.startsWith('--'));

  if (!url) {
    console.error('Usage: web-fetch.mjs <url> [--html] [--markdown] [--selector "css"] [--wait ms] [--screenshot file]');
    process.exit(1);
  }

  const flags = { html: args.includes('--html'), markdown: args.includes('--markdown'), selector: null, wait: 3000, screenshot: null };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--selector' && args[i + 1]) flags.selector = args[++i];
    if (args[i] === '--wait' && args[i + 1]) flags.wait = parseInt(args[++i], 10);
    if (args[i] === '--screenshot' && args[i + 1]) flags.screenshot = args[++i];
  }

  try { await assertPublicUrl(url); }
  catch (e) { console.error(`web-fetch: ${e.message}`); process.exit(2); }

  const { chromium } = await import('playwright');
  // WEB_FETCH_CHROMIUM points at a system Chromium when Playwright's own
  // download is absent (CI runners, a box that never ran `playwright install`).
  const proxyServer = process.env.HTTPS_PROXY || process.env.https_proxy || process.env.HTTP_PROXY || process.env.http_proxy;
  const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.WEB_FETCH_CHROMIUM || undefined,
    proxy: proxyServer ? { server: proxyServer, bypass: chromiumBypassList() } : undefined,
  });
  try {
    const page = await browser.newPage();
    // Every sub-request and redirect target passes the same guard: a public
    // page must not be able to pull the node's own services into the render.
    await page.route('**/*', async (route) => {
      try { await assertPublicUrl(route.request().url()); await route.continue(); }
      catch { await route.abort('blockedbyclient'); }
    });
    // Delivered before navigation and over the debugger protocol: an injected
    // <script> element is refused by any page whose CSP forbids inline script.
    if (flags.markdown && !flags.selector) await page.addInitScript({ path: defuddleBundlePath() });

    await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });

    if (flags.wait > 0) await page.waitForTimeout(flags.wait);

    if (flags.screenshot) {
      await page.screenshot({ path: flags.screenshot, fullPage: true });
      console.error(`Screenshot saved: ${flags.screenshot}`);
    }

    let out;
    if (flags.markdown && !flags.selector) {
      const result = await page.evaluate(
        (u) => new window.Defuddle(document, { markdown: true, url: u }).parse(),
        page.url(),
      );
      if (shouldUseClean(result)) {
        out = formatCleanOutput(result, page.url());
      } else {
        console.error(`web-fetch: defuddle yielded ${result?.wordCount ?? 0} words (< ${MIN_CLEAN_WORDS}), falling back to innerText`);
      }
    }
    if (out === undefined && flags.selector) {
      const el = await page.$(flags.selector);
      if (!el) { console.error(`Selector "${flags.selector}" not found`); process.exit(1); }
      out = flags.html ? await el.innerHTML() : await el.innerText();
    } else if (out === undefined) {
      out = flags.html ? await page.content() : await page.innerText('body');
    }
    if (Buffer.byteLength(out, 'utf8') > MAX_OUTPUT_BYTES) {
      out = Buffer.from(out, 'utf8').subarray(0, MAX_OUTPUT_BYTES).toString('utf8') + `\n[web-fetch: output truncated at ${MAX_OUTPUT_BYTES} bytes]`;
    }
    console.log(out);
  } finally {
    await browser.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => { console.error(`web-fetch: ${err.message}`); process.exit(1); });
}
