# AUDIT_PRE — step 1.2 · web-fetch address pinning

## §0 Micro re-orient (2026-09-08)

- VERSION v1.1 → v1.2-pre. First open row is 1.2. Still the right next step: yes — same file as
  1.1, and 1.1's carry-forward says pinning must compose with the `proxy` option rather than
  replace it.
- Needs pre-screen: `assertPublicUrl` present and resolving once ✔ · the `page.route('**/*')`
  sub-request guard present ✔ · `chromium.launch` site now carries `executablePath` and `proxy`
  from 1.1 ✔ · `test/web-fetch-guard.test.mjs` exercises the guard with an injected `lookup` ✔.

## Intent

A hostname that resolves to a public address when checked and to a private address when the
browser connects must not reach the private host. Today `assertPublicUrl` resolves, approves,
and then Chromium resolves again independently — a DNS rebind lands between the two.

## Design

- Split the guard: `resolvePublicUrl(url, { lookup })` returns `{ url, addresses }`;
  `assertPublicUrl` stays as the thin wrapper the existing tests and the route guard call, so no
  caller changes shape.
- `resolverRules(hostname, addresses)` builds Chromium's `--host-resolver-rules=MAP <host> <ip>`
  from the vetted address, and returns null for an IP literal (nothing to map) or an empty list.
- `main()` pins the document host at launch. Scope of the guarantee, stated plainly because it is
  easy to overclaim: the rule binds Chromium's own resolver, so it protects **direct**
  connections. When traffic goes through a proxy, the proxy resolves the name and the rule cannot
  bind it; there the egress policy is the control. The `bypass` list from 1.1 decides which of
  the two applies per host.
- Sub-requests keep the existing per-request `assertPublicUrl` check. Pinning every sub-request
  host would need a rule per host at launch, before any of them are known; out of scope here and
  noted rather than half-built.

## Risks

- A host with several public addresses: map the first and let the guard reject the set if any
  member is private (unchanged semantics, already the rule in `assertPublicUrl`).
- IPv6 literals in the MAP rule need bracket-free form; covered by a unit test.
- No browser is needed for any of this test coverage — the two new functions are pure.

## §6 file-delta outline

- `workspace-bin/web-fetch.mjs`: `resolvePublicUrl`, `resolverRules`, `assertPublicUrl` wrapper,
  launch `args`.
- `test/web-fetch-guard.test.mjs`: rebind case + rule-shape cases.
- Silo: INVENTORY row, VERSION, COMPONENT_REGISTRY, AUDIT_POST.
