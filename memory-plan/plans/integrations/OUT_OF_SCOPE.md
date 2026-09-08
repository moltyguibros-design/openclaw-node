# OUT_OF_SCOPE — integrations plan

Agnostic-spec capture of things observed while working this plan but not acted on (MASTER_PLAN
§4.3). WHAT + WHY, never HOW — no prescribed solution, no code excerpts. Always-writeable
regardless of scope. Reviewed at scope-closing checkpoints: each entry gets promoted into
SCOPE.md, escalated into INVENTORY.md, archived as won't-fix, or deferred forward.

Format per entry: date · area/file · one-line problem · severity guess · next-touch pointer.

---

(empty)

- 2026-09-08 · cloud session environment (not repo files) · The agent container's browser NSS
  store (`/root/.pki/nssdb`) contains no certificates, so Chromium rejects the egress proxy's
  re-terminated TLS even though every other tool trusts it; the proxy README states the browser
  store is already set up. The CA bundle holds 154 certificates and the interception CA is not
  the first, so importing only the first entry leaves the browser broken. Severity: medium —
  silently blocks every browser-backed runtime evidence in a cloud session and looks like a code
  fault. Next toucher: whoever runs a browser step in a cloud session, or whoever maintains the
  session image.
