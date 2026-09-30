# Step 3.9 runtime evidence — 2026-09-30 19:53:10 EDT

The five installed launchd units remained unchanged. The candidate root is
`~/.openclaw/backups/node-readiness/timer-entry-candidate-20260930-3`, owner
private. Its saved manifest SHA-256 is
`e13cb03ce4c7db126102c06df328a5248585c5ae45d970d223f0f654e5afe2c6`.
The selected consolidation release manifest is the Node24/ABI137 release
SHA-256 `6159fb51b28dfc6834962c95afc61fac609cdb758438616a68928290049ddab8`.
The candidate contains five plist renderings, 1,885 pinned source files,
the private gate/launcher, and 21 pinned executable paths. No raw received
environment value is in this audit; the private manifest holds key names and
value hashes. The original plists' configured values, loaded arguments,
schedule and log paths were compared before staging. A fresh neutral launchd
probe captured the received key sets and cwd `/`; each candidate preserves
the original configured environment and schedule. The observer and
consolidation script-path changes are exactly D25's declared relocations.

`python3 workspace-bin/stage-timer-entries.py <candidate> --verify` returned
`verified:true`, five jobs and 1,885 source files without recapturing the
baseline. It rehashed the saved tree, gate pins, executables and five
candidate plists, compared the five installed/loaded originals, repeated
received-environment probes, and checked observer's original symlink and
module bytes. No installed or loaded unit was modified by these probes.

`python3 -m unittest -v test/timer_entry_test.py` passed 4/4 owned Mac
launchd controls. An open gate ran the fixture application. A published
closed marker made the same launch return without running it. Changed
application and launcher source, changed manifest, altered gate pin,
changed delegated resolution and unexpected `NODE_OPTIONS` all refused
before application work. The fixture labels, paths, logs and gate were
temporary and separate from the five real labels.

Claude's adversarial source review found two actionable staging mismatches:
missing UID parity with runtime and unchecked consolidation argv position.
Both now fail during staging. Its XPC hash observation was resolved by
checking both the received service identity and its saved hash. Claude found
no blocker in the declared source relocations. The post-fix owned controls
and saved-candidate verification above passed.

The first local root `npm test` used Node24 with the model cached and was
stopped after its embedding benchmark remained active for 276 seconds.
The second run used Node22 but the native SQLite addon had been installed
under Node24; its 272 failures report ABI137 versus ABI127. Dependencies
were then reinstalled under Node22 and the native binding proved ABI127.
A subsequent Node22 run stopped at the unrelated Mac
`memory-inject-server.test.mjs` worker after its assertions finished; a
single-file `--test-force-exit` run made its native teardown abort with
`SIGABRT`. Running the remaining 182 JavaScript test files completed with
2,500 passes, 3 failures, 14 cancellations and 6 skips. The failures were
the live mesh disappearing between availability and setup, installer dry-run
creating macOS Python cache files under its temporary HOME, and one
restore-only receipt-gap assertion under full-suite load; the recorded
Foreman suite also had one subtest failure. None of those suites touch the
new timer-entry files. Exact-head Linux CI remains required before 3.9
closure; these local results are not called green. Plan lint reports the two
pre-existing silo defects (`automation.json` and `tick-logs/` absent);
canonical sync and `git diff --check` pass.

No production timer is gated yet. Step 3.10 must prove the first transition
from already loaded ungated invocations; 3.11 owns actual commissioning.
