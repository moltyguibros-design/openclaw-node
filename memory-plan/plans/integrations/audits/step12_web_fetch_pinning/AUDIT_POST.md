# AUDIT_POST — step 1.2 · web-fetch address pinning

## Promised vs landed

| Promised in AUDIT_PRE | Landed |
|---|---|
| `resolvePublicUrl` returning `{ url, addresses }` | yes |
| `resolverRules(hostname, addresses)` building the MAP rule | yes |
| `assertPublicUrl` kept as the URL-only wrapper | yes — no caller or existing test changed |
| launch pins the document host | yes, via `args: ['--host-resolver-rules=…']` |
| unit tests for the rebind sequence and rule shape | yes, plus tests for 1.1's `chromiumBypassList` |

## Deltas (greppable)

- `workspace-bin/web-fetch.mjs`: `resolverRules()`, `resolvePublicUrl()`, `assertPublicUrl()` now
  a wrapper, `pinned` computed in `main()`, `args` on `chromium.launch`.
- `test/web-fetch-guard.test.mjs`: `describe('address pinning (integrations 1.2)')` 4 tests,
  `describe('chromiumBypassList (integrations 1.1)')` 2 tests.

## Verify contract — executed

**`code:` PASS.** `node --test test/web-fetch-guard.test.mjs test/web-fetch-markdown.test.mjs
test/wiring-manifest.test.mjs` → 81 tests, 80 pass, 0 fail, 1 skip (the skip is the browser case
when `WEB_FETCH_CHROMIUM` is unset; it passes when set). The rebind test feeds a `lookup` that
answers public once and private thereafter, then asserts the rule carries the public address and
never the private one.

**`runtime:` PASS, and stronger than written.** The contract asked for a rebinding host refused
with exit 2. Two halves, both observed:

| Probe | Result |
|---|---|
| `web-fetch http://127.0.0.1:7893/memory/inject` | `refused: 127.0.0.1 is a private/reserved address`, **exit 2** |
| `web-fetch http://169.254.169.254/latest/meta-data/` | `refused: … private/reserved address`, **exit 2** |
| `web-fetch https://pypi.org/project/requests/ --markdown` with pinning active | exit 0, 4721 B, header intact — pinning does not break a normal fetch |
| Chromium launched with `MAP pypi.org 192.0.2.1` (TEST-NET-1, RFC 5737) | `net::ERR_CONNECTION_REFUSED` |
| Same navigation with no rule | `status 200` |

The last two are the point. A rebind cannot be staged from this container (no controllable
authoritative DNS, and only NO_PROXY hosts are reachable), so instead the mechanism was made
falsifiable: if Chromium ignored `--host-resolver-rules` the pinned run would have returned 200
like the unpinned one. It did not, so the flag binds this build's resolver and the address this
process vetted is the address the browser connects to.

## Findings

1. **The guarantee is narrower than "no rebinding".** The rule binds Chromium's own resolver,
   which covers direct connections. A proxied request is resolved by the proxy, so there the
   egress policy is the control, not this flag. Written into the code comment rather than left
   for a reader to discover, because the honest scope is easy to overstate.
2. **Sub-requests are still check-time only.** Every sub-request passes `assertPublicUrl` through
   the existing route guard, but each resolves independently, so the same window exists for them.
   Pinning them would need every host at launch, before any is known. Captured in `OUT_OF_SCOPE.md`.
3. A bracketed IPv6 literal is still a literal — the first version of the test expected a MAP rule
   for `[2606:4700::1111]`. The code was right and the expectation was wrong; the test now
   asserts null for literals and a rule for a name that resolves to IPv6.

## §6 carry-forwards

- `resolvePublicUrl` is the function later steps should call when they need the vetted addresses
  (4.6's `/api/arcane` RPC fetch, 6.2's grounding fetches); `assertPublicUrl` stays for callers
  that only need the URL.
- Block 1 is closed after this step's siblings; the macro re-orient is due at 1.6.

## Feeds — landed

`workspace-bin/web-fetch.mjs` exports `resolvePublicUrl` and `resolverRules`; the CLI pins every
document host it fetches. Consumers reached: every caller of web-fetch, and the SSRF guard's own
test file now covers both the check and the pin.
