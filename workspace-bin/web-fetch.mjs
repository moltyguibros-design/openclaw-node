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
 *
 * Reachability guard (review P5-7): this tool runs with the node's network
 * position, so an agent-supplied URL used to reach the NATS monitor, the
 * memory inject server, the cloud metadata endpoint or file:// paths. Only
 * http(s) to PUBLIC addresses is fetched — every sub-request and redirect
 * included — and each response and the output are capped.
 *
 * Chromium never touches the network itself: every request is fetched here by
 * guardedFetch (each redirect hop re-checked, each connection made to the
 * address that was checked) and handed back with route.fulfill. Playwright
 * auto-continues redirect hops and service-worker requests past page.route,
 * and Chromium re-resolves DNS after the check, so a guard that only vetted
 * the URL and continued could be walked into loopback or metadata. Anything
 * that still escapes routing (WebSockets, ...) is sent to a proxy that refuses
 * every connection.
 */

import dns from 'node:dns/promises';
import { realpathSync } from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import { fileURLToPath } from 'node:url';

export const MAX_OUTPUT_BYTES = Number(process.env.WEB_FETCH_MAX_BYTES) || 2 * 1024 * 1024;
export const MAX_RESPONSE_BYTES = Number(process.env.WEB_FETCH_MAX_RESPONSE_BYTES) || 25 * 1024 * 1024;

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

/** Expands a valid IPv6 literal ("::" and a dotted IPv4 tail included) to 8 numeric hextets. */
function ipv6Hextets(ip) {
  let s = ip.toLowerCase().split('%')[0];
  const dotted = s.match(/^(.*:)(\d+\.\d+\.\d+\.\d+)$/);
  if (dotted) {
    const n = ipv4ToInt(dotted[2]);
    s = `${dotted[1]}${(n >>> 16).toString(16)}:${(n & 0xffff).toString(16)}`;
  }
  const [head, tail] = s.split('::');
  const h = head ? head.split(':') : [];
  if (tail === undefined) return h.map(x => parseInt(x, 16));
  const t = tail ? tail.split(':') : [];
  return [...h, ...Array(8 - h.length - t.length).fill('0'), ...t].map(x => parseInt(x, 16));
}

/** True for loopback, link-local, RFC1918/ULA, multicast, unspecified and mapped forms. */
export function isPrivateIp(ip) {
  const v = net.isIP(ip);
  if (v === 4) return PRIVATE_V4.some(c => inCidr4(ip, c));
  if (v !== 6) return true; // not an IP at all → treat as unsafe
  // Judged numerically: the URL parser rewrites [::ffff:127.0.0.1] as [::ffff:7f00:1],
  // so a match on the dotted spelling alone let mapped loopback/metadata addresses through.
  const x = ipv6Hextets(ip);
  const embeddedV4 = () => [x[6] >> 8, x[6] & 255, x[7] >> 8, x[7] & 255].join('.');
  const zeroUpTo = (n) => x.slice(0, n).every(h => h === 0);
  // ::ffff:a.b.c.d (mapped) and ::a.b.c.d (IPv4-compatible, which covers :: and ::1)
  if (zeroUpTo(5) && (x[5] === 0xffff || x[5] === 0)) return isPrivateIp(embeddedV4());
  // ::ffff:0:a.b.c.d (IPv4-translated)
  if (zeroUpTo(4) && x[4] === 0xffff && x[5] === 0) return isPrivateIp(embeddedV4());
  // 64:ff9b::/96 NAT64 — check the embedded v4
  if (x[0] === 0x64 && x[1] === 0xff9b && x.slice(2, 6).every(h => h === 0)) return isPrivateIp(embeddedV4());
  if ((x[0] & 0xfe00) === 0xfc00) return true;     // fc00::/7 unique-local
  if ((x[0] & 0xffc0) === 0xfe80) return true;     // fe80::/10 link-local
  if ((x[0] & 0xff00) === 0xff00) return true;     // multicast
  return false;
}

/**
 * Throws unless `url` is http(s) to a hostname whose EVERY resolved address is
 * public. Resolution happens here so a DNS name that maps to 127.0.0.1 or
 * 169.254.169.254 is refused before any connection.
 */
const defaultLookup = (h) => dns.lookup(h, { all: true });

export async function assertPublicUrl(url, { lookup = defaultLookup, isPrivate = isPrivateIp } = {}) {
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
    if (isPrivate(host)) throw new Error(`refused: ${host} is a private/reserved address`);
    return parsed;
  }
  let addrs;
  try { addrs = await lookup(host); } catch (e) { throw new Error(`refused: cannot resolve ${host} (${e.message})`); }
  checkResolved(host, addrs, isPrivate);
  return parsed;
}

function checkResolved(host, addrs, isPrivate) {
  const list = (Array.isArray(addrs) ? addrs : [addrs]).map(a => (typeof a === 'string' ? a : a.address));
  if (!list.length) throw new Error(`refused: ${host} resolved to nothing`);
  const bad = list.find(a => isPrivate(a));
  if (bad) throw new Error(`refused: ${host} resolves to private/reserved address ${bad}`);
  return list.map(address => ({ address, family: net.isIP(address) }));
}

/** A net lookup that connects only to addresses it has itself just checked (no DNS rebinding window). */
function pinnedLookup(lookup, isPrivate) {
  return (hostname, options, cb) => {
    Promise.resolve()
      .then(() => lookup(hostname))
      .then((addrs) => {
        const list = checkResolved(hostname, addrs, isPrivate);
        if (options?.all) cb(null, list);
        else cb(null, list[0].address, list[0].family);
      })
      .catch((e) => cb(e));
  };
}

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const HOP_HEADERS = new Set(['host', 'connection', 'keep-alive', 'content-length', 'transfer-encoding', 'accept-encoding', 'proxy-authorization', 'upgrade']);
const withoutHeaders = (h, names) => Object.fromEntries(Object.entries(h).filter(([k]) => !names.includes(k.toLowerCase())));

const inflight = new Set();

function requestOnce(url, { method, headers, body, lookup, isPrivate, timeout, maxBytes }) {
  const mod = url.protocol === 'https:' ? https : http;
  return new Promise((resolve, reject) => {
    const fail = (err) => { req.destroy(err); reject(err); };
    const req = mod.request(url, {
      method,
      // identity: the body is handed to Chromium as-is, so it must not be compressed.
      headers: { ...headers, 'accept-encoding': 'identity' },
      agent: false,
      lookup: pinnedLookup(lookup, isPrivate),
      timeout,
    }, (res) => {
      const chunks = [];
      let size = 0;
      res.on('data', (c) => {
        size += c.length;
        if (size > maxBytes) return fail(new Error(`refused: response from ${url.href} exceeds ${maxBytes} bytes`));
        chunks.push(c);
      });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
      res.on('error', reject);
    });
    // The socket timeout is an idle timer: a body trickling in byte by byte never trips it.
    const deadline = setTimeout(() => fail(new Error(`timed out fetching ${url.href}`)), timeout);
    inflight.add(req);
    req.on('close', () => { clearTimeout(deadline); inflight.delete(req); });
    req.on('timeout', () => req.destroy(new Error(`timed out fetching ${url.href}`)));
    req.on('error', reject);
    if (body?.length) req.write(body);
    req.end();
  });
}

/**
 * Fetches `url` as the browser asked, following redirects by hand so every hop
 * passes assertPublicUrl, and connecting only to addresses that were checked.
 */
export async function guardedFetch(url, {
  method = 'GET', headers = {}, body = null, lookup = defaultLookup, isPrivate = isPrivateIp,
  maxRedirects = 10, timeout = 30000, maxBytes = MAX_RESPONSE_BYTES,
} = {}) {
  let current = await assertPublicUrl(url, { lookup, isPrivate });
  let reqHeaders = withoutHeaders(headers, [...HOP_HEADERS]);
  for (let hop = 0; ; hop++) {
    const res = await requestOnce(current, { method, headers: reqHeaders, body, lookup, isPrivate, timeout, maxBytes });
    if (!REDIRECT_STATUSES.has(res.status) || !res.headers.location) return { ...res, url: current.href };
    if (hop >= maxRedirects) throw new Error(`refused: more than ${maxRedirects} redirects`);
    const next = await assertPublicUrl(new URL(res.headers.location, current).href, { lookup, isPrivate });
    if (res.status === 303 || ((res.status === 301 || res.status === 302) && method === 'POST')) {
      method = 'GET';
      body = null;
      reqHeaders = withoutHeaders(reqHeaders, ['content-type']);
    }
    if (next.origin !== current.origin) reqHeaders = withoutHeaders(reqHeaders, ['cookie', 'authorization']);
    current = next;
  }
}

const DROP_RESPONSE_HEADERS = new Set(['content-encoding', 'content-length', 'transfer-encoding', 'connection', 'keep-alive']);

/** Route handler: Chromium's request is answered from guardedFetch, or aborted. */
export function guardedRouteHandler(fetchImpl = guardedFetch) {
  return async (route) => {
    const req = route.request();
    let res;
    try {
      res = await fetchImpl(req.url(), { method: req.method(), headers: req.headers(), body: req.postDataBuffer() });
    } catch {
      await route.abort('blockedbyclient');
      return;
    }
    const headers = {};
    for (const [k, v] of Object.entries(res.headers)) {
      if (!DROP_RESPONSE_HEADERS.has(k)) headers[k] = Array.isArray(v) ? v.join('\n') : String(v);
    }
    await route.fulfill({ status: res.status, headers, body: res.body });
  };
}

/** A browser context whose every request goes through guardedFetch, with service workers unable to bypass routing. */
export async function newGuardedContext(browser, { fetchImpl = guardedFetch } = {}) {
  const context = await browser.newContext({ serviceWorkers: 'block' });
  await context.route('**/*', guardedRouteHandler(fetchImpl));
  return context;
}

/** A local proxy that drops every connection: the browser's only direct network path. */
function startRefusingProxy() {
  const server = net.createServer((sock) => sock.destroy());
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

async function main() {
  const args = process.argv.slice(2);
  const url = args.find(a => !a.startsWith('--'));

  if (!url) {
    console.error('Usage: web-fetch.mjs <url> [--html] [--selector "css"] [--wait ms] [--screenshot file]');
    process.exit(1);
  }

  const flags = { html: args.includes('--html'), selector: null, wait: 3000, screenshot: null };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--selector' && args[i + 1]) flags.selector = args[++i];
    if (args[i] === '--wait' && args[i + 1]) flags.wait = parseInt(args[++i], 10);
    if (args[i] === '--screenshot' && args[i + 1]) flags.screenshot = args[++i];
  }

  try { await assertPublicUrl(url); }
  catch (e) { console.error(`web-fetch: ${e.message}`); process.exit(2); }

  const { chromium } = await import('playwright');
  const proxy = await startRefusingProxy();
  // Playwright puts <-loopback> on the bypass list, so loopback goes to this proxy too.
  const browser = await chromium.launch({ headless: true, proxy: { server: `http://127.0.0.1:${proxy.address().port}` } });
  try {
    const context = await newGuardedContext(browser);
    const page = await context.newPage();
    await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });

    if (flags.wait > 0) await page.waitForTimeout(flags.wait);

    if (flags.screenshot) {
      await page.screenshot({ path: flags.screenshot, fullPage: true });
      console.error(`Screenshot saved: ${flags.screenshot}`);
    }

    let out;
    if (flags.selector) {
      const el = await page.$(flags.selector);
      if (!el) { console.error(`Selector "${flags.selector}" not found`); process.exit(1); }
      out = flags.html ? await el.innerHTML() : await el.innerText();
    } else {
      out = flags.html ? await page.content() : await page.innerText('body');
    }
    if (Buffer.byteLength(out, 'utf8') > MAX_OUTPUT_BYTES) {
      out = Buffer.from(out, 'utf8').subarray(0, MAX_OUTPUT_BYTES).toString('utf8') + `\n[web-fetch: output truncated at ${MAX_OUTPUT_BYTES} bytes]`;
    }
    console.log(out);
  } finally {
    await browser.close();
    proxy.close();
    for (const req of inflight) req.destroy();
  }
}

// Compare real paths: Node resolves symlinks in the main module's URL but not
// in argv[1], so a launch through a symlinked bin/ would otherwise do nothing.
function isEntrypoint() {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false; // argv[1] is not a path, e.g. `node -e '…' arg`
  }
}

if (isEntrypoint()) {
  main().catch((err) => { console.error(`web-fetch: ${err.message}`); process.exit(1); });
}
