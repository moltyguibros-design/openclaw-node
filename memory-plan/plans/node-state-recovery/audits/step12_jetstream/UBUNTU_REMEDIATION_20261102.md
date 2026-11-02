# Operator-requested Ubuntu installation remediation — 2026-11-02

## Micro re-orient

The selected P2 receipt1a455e19 is complete at its CI-only scope; physical recovery1.2/B5 remains open/pre.
The operator installed a NEW disposable Ubuntu ARM64 VM and requested installation/dependency testing with Claude.
That review recorded22 grouped findings and real OOM/test failures, retained externally without source changes.
The operator now said “fix this”; this authorizes the reviewed source repairs and disposable-Ubuntu verification.
These are new bounded operator units, not reopening P2 or admitting Mac/production operations.
Heartbeat stays PAUSED; D62/D64/D168/D173-D175/D261 and all native/host/resource/reboot gates persist.

## Prospective units

| Unit | Outcome | Review findings | Status |
|---|---|---|---|
| U1 | Runtime model capability and test isolation | R01, R17, R18 | [x] source/runtime; final-head CI pending |
| U2 | Linux service lifecycle and truthful acceptance | R02, R03, R05, R08, R14 | [x] source/runtime; final-head CI pending |
| U3 | Safe runtime updates and installation paths | R07, R12, R13 | [ ] |
| U4 | Reproducible patched dependencies | R06, R09 | [ ] |
| U5 | Capability-aware prerequisites and optional tools | R10, R11, R15 | [ ] |
| U6 | Distribution and portable lifecycle contracts | R04, R16, R19, R21, R22 | [ ] |
| U7 | Bounded local event-log capacity | R20 | [ ] |

Each unit is implemented and verified separately before the next; no unlisted mid-work expansion. Every source commit records actual disposable-Ubuntu runtime evidence. The final immutable candidate requires independent Claude review in the existing session before safe same-commit promotion to existing draftPR224 and new own-head CI. No old successful CI is carried to this change. P0, the four selected measurement sources, registration and enabled workflow remain unchanged.

## U1 — model capability contract (PRE)

Goal: a no-model installation never initiates embedding downloads or model inference from runtime monitoring or unit fixtures.
Needs: exact clean1a45 baseline; user-authorized Ubuntu target; preserved failed runs; existing env/parser/monitor/injector implementations.
Feeds: the disposable Ubuntu runtime and the root test runner; later U2 lifecycle verification.
Verify: installer persists disabled model capability, both light/deep watcher checks skip it, embedder refuses before pipeline creation, concurrent cold callers share one initialization, and injection HTTP unit tests use an actual fake dependency. A bounded full root profile runs without a real model; failures remain failures. No C/SDK/native-Mac or physical-host command.

File delta outline: installer config/env example/model setup; existing watcher and core embedder; injection-server dependency injection; corresponding model/watch/HTTP regression tests; root test concurrency and protected journal fixture placement. No model/precision substitution, database/index migration or new daemon. Model precision remainsfp32; changing it is not a shortcut to green. Other units remain pending until their own PRE/file outline is written here.

Evidence: external review findings.json/REVIEW.txt under full-review-20261102T063349Z; prospective machine PRE under remediation-20261102/PRE.json. Existing current.json retains the completed P2 proof; this explicit operator request is newer steering. No automation is resumed.

### U1 implementation clarification

The disabled capability must be read from the persisted env file because existing service units do not generally source that file. One shared model-policy module is used by the core loader, existing LLM client/health check and extraction feature flag; no new service/template/native method is added. The installer preserves that setting on update, and explicit wave2 model selection can re-enable it. The injection HTTP fixture receives an actual fake injector; no real model/client is constructed. This clarifies the predeclared model-off outcome, not a new unrelated repair.


### U1 exact result — 2026-11-02 02:46 America/Montreal

The initial outline was clarified through preserved immutable correction snapshots: bootstrap download deferral must preserve an existing model profile; wave2 refreshes only active Linux model consumers; scheduled indexing skips before dispatch when disabled. The two Linux unit templates now read saved backend settings and unset the capability variable so that the capability remains live. This supersedes the initial note that no unit template would change. No macOS service method or selected P2 source/workflow changes.

Exact U1-v6 patch: 38,289 bytes, SHA256 `754fcf1f3006ded9e76c734900c9117b22f1a5326eade47bef255f11a9dc8251`, 24 source/test files against1a455e19. SAME Claude rendered request22/response23: **CLEAR for U1 — no required correction left**; static/data-only, no reviewer execution. Earlier v1/v2 required findings and v4 R5 are preserved; v3/v5 were never claimed clear.

Author Ubuntu evidence: v5 complete default runner2707 tests/2699 pass/8 skip/0 fail,280.49s; v6 runtime JS/daemon/installer bytes are identical. Its added unit setting/contract is separately verified by29 tests/0fail, systemd unit validationexit0, and an actual owned transient systemd fixture: samePID reads1 then0 with no capability variable in its environment and zero loader calls. The real guest remains profile0; two active consumers have zero restarts, no new cache and observed peaks below85MiB. Deep model checks, inject and knowledge index reportOFF. This is neither real retrieval nor a15minute v6 soak. v4's targeted stale-test expectation failure is retained and corrected only in the test; original timeout, four failures and seven OOM kills remain failures.

Author proof: `/Users/moltymac/.codex/outputs/openclaw-recovery/linux-vm-first-terrain/remediation-20261102/U1-proof.json`, SHA256 `143fb8783f89689a326d9228a2b7d9eba27f904a8d10898a4a93b7f2afba29a2`. Complete raw Ubuntu bundle2,549,760 bytes/SHA256 `e594a39e7a15dd324be6c17af20ed11371b2c5c7f81795edd9e533e2a87fb997`. Initial PRE was an evolving prospective outline; frozen U1-v6-PRE and all patch snapshots remain external, without claiming earlier mutable PRE bytes were immutable.

- [A] Final immutable combined candidate review, guarded no-run publication/current-base promotion and NEW own-head full CI/receipt evidence remain pending. No old pass clears this source.
- [ ] U2-U7 remain pending under their individual prospective outlines. U2 additionally corrects model-off analysis metadata; missing frontend transcript capabilities remain unproven, not paper-green.

B1-B9, D62/D64/D168/D173-D175/D261, B5/1.2/protected[A]/VERSIONv1.2-pre/B6-B9, all physical-Mac/native-positive/production/reboot/resource gates remain unchanged. Heartbeat stays PAUSED. This Ubuntu repair does not admit the recovery rehearsal.


## U2 — Linux lifecycle and truthful acceptance (PRE)

U1 is locally committed atea341dba982b88d849bd7c2bc587bb64eb97afab. U2 addresses R02/R03/R05/R08/R14: render and validate before manager reload; restart only selected active updates and preserve disabled/timer semantics; reflect unobserved acceptance as incomplete; poll for optional gateway logs; initialize the existing private MC token before scheduler use. It additionally corrects no-model injection metadata. No token rotation, source topology/dependency migration or Mac/production operation. File outline and verification are frozen in external U2-PRE.json; existing runtime/helpers are extended, with owned lifecycle/token/watchdog/API regression fixtures and actual Ubuntu process/manager evidence. U3-U7 remain pending; final exact immutable review/ownCI remains a distinct gate.


### U2 exact result — 2026-11-02

U2-v5 source patch60,069/SHA256a8784d9cbe7524469068a283ca5c86beb20c774bca37075b1bf712ae28bfdef2 is CLEAR in SAME Claude request28/response29, scoped source/data only. Review-required R1/R2 and all earlier snapshots are retained. Actual Ubuntu Step16 source-prefix update succeeded after reload: eight selected daemon PIDs replaced, zero automatic restarts, disabled services kept off, timer handles retained and token digest unchanged. Step16.5 notification/config work was explicitly excluded pending U3. The shared systemd helper/stack now distinguishes inactive/successful SIGTERM (OFF, actual Code2/Status15), crash/restart (UNSTABLE), and invalid load (DOWN, actual owned bad-setting fixture). Actual normal scheduler tick succeeded; nonempty injection returned200/lexical-only/models_disabled; profile0/new-cache absent. Acceptance --no-mutate reports INCOMPLETE,13PASS/0FAIL/3SKIP/9NA/0BLOCK/missingL4. This is partial capability proof, not whole-node acceptance.

v1 complete root2718/2710pass/8skip/0fail289.53s; final v5 targeted154/153pass/1skip/0fail15.15s, not v5 full-head CI. v3 targeted2failures from a real-home setting leak are retained; the fake catalog now owns/restores its model setting. An owned crash fixture's manual restart hit its start-limit; retained. A separate fixture verified manual restart1→0/LIVE with no production limits changed. An actual existing daemon's successful SIGTERM stop/resume and invalid-unit fixture verified the remaining signal/load semantics. No real stack-up/down was run because its separate unsafe bridge/port path remains U3/U6. The consolidation timer backing service has a retained failed result; capability-aware handling remains U5.

External U2-proof.json SHA2568f6c17466eceb74748314d88bf39f46f3222f3ab2341f55508cbdc9dedad8ae3 and raw Ubuntu bundle931,840/SHA256da61d35497ed982e3377da0e9f5182dfbfe1d83ad630a25fe167c176d4b22798 retain the evidence. U3-U7/final immutable review/new own-head CI/receipt remain pending; all P2/Mac/production/native-positive gates and heartbeatPAUSED remain unchanged.
