/**
 * web-fetch-redirect-guard.test.mjs — the P5-7 guard only vetted the first URL.
 *
 * Playwright auto-continues redirect hops and service-worker requests past
 * page.route, and Chromium re-resolved DNS after the check, so a public URL
 * answering `302 Location: http://127.0.0.1:7893/` or a rebinding name loaded
 * the private response into the page. Every request is now fetched in Node,
 * hop by hop, against the address that was checked.
 *
 * The test server listens on 127.0.0.1; the injected policy treats that one
 * address as "public" so it can stand in for an internet host.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { guardedFetch, guardedRouteHandler, newGuardedContext, isPrivateIp } from '../workspace-bin/web-fetch.mjs';

const isPrivate = (ip) => ip !== '127.0.0.1' && isPrivateIp(ip);

describe('guardedFetch', () => {
  let server, port;
  const hits = [];
  const tricklers = [];
  before(async () => {
    server = http.createServer((req, res) => {
      hits.push(req.url);
      if (req.url === '/big') { res.writeHead(200); return res.end(Buffer.alloc(3 * 1024 * 1024, 'a')); }
      if (req.url === '/trickle') {
        res.writeHead(200);
        tricklers.push(setInterval(() => res.write('x'), 100));
        return;
      }
      if (req.url === '/to-metadata') { res.writeHead(302, { location: 'http://169.254.169.254/latest/meta-data/' }); return res.end(); }
      if (req.url === '/to-internal') { res.writeHead(302, { location: `http://internal.test:${port}/secret` }); return res.end(); }
      if (req.url === '/to-loopback-name') { res.writeHead(301, { location: `http://localhost:${port}/secret` }); return res.end(); }
      if (req.url === '/to-ok') { res.writeHead(302, { location: '/ok' }); return res.end(); }
      if (req.url === '/loop') { res.writeHead(302, { location: '/loop' }); return res.end(); }
      if (req.url === '/secret') { res.writeHead(200); return res.end('SECRET'); }
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end('ok');
    });
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    port = server.address().port;
  });
  after(() => {
    tricklers.forEach(clearInterval);
    server.closeAllConnections();
    server.close();
  });

  // public.test is the stand-in public host; internal.test resolves to RFC1918.
  const lookup = async (h) => {
    if (h === 'public.test') return [{ address: '127.0.0.1' }];
    if (h === 'internal.test') return [{ address: '10.0.0.5' }];
    throw new Error('ENOTFOUND');
  };
  const base = () => `http://public.test:${port}`;

  it('refuses a redirect to the metadata endpoint', async () => {
    await assert.rejects(guardedFetch(`${base()}/to-metadata`, { lookup, isPrivate }), /169\.254\.169\.254 is a private/);
  });

  it('refuses a redirect to a name that resolves privately, without requesting it', async () => {
    hits.length = 0;
    await assert.rejects(guardedFetch(`${base()}/to-internal`, { lookup, isPrivate }), /resolves to private/);
    await assert.rejects(guardedFetch(`${base()}/to-loopback-name`, { lookup, isPrivate }), /local\/internal/);
    assert.deepEqual(hits, ['/to-internal', '/to-loopback-name']);
  });

  it('follows a redirect between public URLs and reports the final body', async () => {
    const res = await guardedFetch(`${base()}/to-ok`, { lookup, isPrivate });
    assert.equal(res.status, 200);
    assert.equal(res.body.toString(), 'ok');
    assert.equal(res.url, `${base()}/ok`);
  });

  it('refuses a response past the size cap instead of buffering it whole', async () => {
    await assert.rejects(guardedFetch(`${base()}/big`, { lookup, isPrivate, maxBytes: 1024 * 1024 }), /exceeds 1048576 bytes/);
  });

  it('ends a body that trickles in under the idle timeout at the overall deadline', { timeout: 5000 }, async () => {
    const started = Date.now();
    await assert.rejects(guardedFetch(`${base()}/trickle`, { lookup, isPrivate, timeout: 500 }), /timed out/);
    assert.ok(Date.now() - started < 2000, `settled after ${Date.now() - started} ms`);
  });

  it('caps redirect chains', async () => {
    await assert.rejects(guardedFetch(`${base()}/loop`, { lookup, isPrivate, maxRedirects: 3 }), /more than 3 redirects/);
  });

  it('connects to the address it checked, not a later re-resolution (DNS rebinding)', async () => {
    let calls = 0;
    const rebinding = async () => (calls++ === 0 ? [{ address: '127.0.0.1' }] : [{ address: '169.254.169.254' }]);
    hits.length = 0;
    await assert.rejects(guardedFetch(`http://rebind.test:${port}/secret`, { lookup: rebinding, isPrivate }), /resolves to private/);
    assert.deepEqual(hits, []);
  });
});

describe('browser wiring', () => {
  it('the context blocks service workers and routes every request', async () => {
    const calls = {};
    const context = { route: async (pattern, handler) => { calls.route = { pattern, handler }; } };
    const browser = { newContext: async (opts) => { calls.newContext = opts; return context; } };
    assert.equal(await newGuardedContext(browser), context);
    assert.equal(calls.newContext.serviceWorkers, 'block');
    assert.equal(calls.route.pattern, '**/*');
  });

  function fakeRoute(url) {
    const done = {};
    return {
      done,
      request: () => ({ url: () => url, method: () => 'GET', headers: () => ({ accept: '*/*' }), postDataBuffer: () => null }),
      fulfill: async (r) => { done.fulfill = r; },
      continue: async () => { done.continue = true; },
      abort: async (e) => { done.abort = e; },
    };
  }

  it('answers the request from the guarded fetch, never by continuing it', async () => {
    const route = fakeRoute('https://example.com/');
    await guardedRouteHandler(async () => ({ status: 200, headers: { 'content-type': 'text/html', 'content-encoding': 'gzip', 'set-cookie': ['a=1', 'b=2'] }, body: Buffer.from('hi') }))(route);
    assert.equal(route.done.continue, undefined);
    assert.equal(route.done.fulfill.status, 200);
    assert.equal(route.done.fulfill.body.toString(), 'hi');
    assert.deepEqual(route.done.fulfill.headers, { 'content-type': 'text/html', 'set-cookie': 'a=1\nb=2' });
  });

  it('aborts when the guarded fetch refuses', async () => {
    const route = fakeRoute('https://example.com/');
    await guardedRouteHandler(async () => { throw new Error('refused'); })(route);
    assert.equal(route.done.abort, 'blockedbyclient');
    assert.equal(route.done.fulfill, undefined);
  });
});
