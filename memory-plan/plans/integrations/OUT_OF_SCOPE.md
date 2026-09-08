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

- 2026-09-08 · `workspace-bin/web-fetch.mjs` sub-request path · Sub-resources loaded by a fetched
  page are validated at check time by the route guard but are not address-pinned the way the
  document host now is, so the same resolve-twice window remains for them. Severity: low — a page
  would have to control DNS for one of its own sub-resource hosts, and the guard still rejects a
  private answer at check time. Next toucher: whoever revisits the fetch guard, or any step that
  starts trusting sub-resource content.

- 2026-09-08 · `config/harness-rules.json` rule `git-conventional-commits` + `lib/exec-safety.js` ·
  The rule's `mesh_validate_command` can never run: its grep pattern contains regex alternation,
  and the shell-chaining detector reads those `|` characters as pipes into a disallowed command,
  so every mesh task logs `POST-COMMIT FAIL: git-conventional-commits — Validation command
  blocked` regardless of the commit message. The check has therefore never validated anything,
  and its permanent failure line trains readers to ignore POST-COMMIT FAIL output. Observed while
  running the real validation path for step 1.3. Severity: medium — a governance check believed
  active is inert, and the noise degrades a signal other rules depend on. Next toucher: whoever
  owns harness enforcement, or the next step that adds a `post_validate` rule.
