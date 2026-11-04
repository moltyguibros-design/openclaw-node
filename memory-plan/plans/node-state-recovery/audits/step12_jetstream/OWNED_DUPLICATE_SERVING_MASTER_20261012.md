# Owned serving-master substitution — 2026-10-12 06:47 EDT

At PR #224 head `516a58ec`, the unmodified `probe_cold_trees.mjs` wrote a
success `probe.json` when an owned three-member JetStream fixture supplied one
serving member's frozen master bytes as the other serving member's master.
The target member kept its original pre-stop baseline. The substituted master
had a different path and the source member's digest; the private fixture plan
and its **synthetic** `MATCH` receipt were rebuilt to describe that substituted
tree. The probe exited 0, and the fixture's normal checks subsequently passed.
All owned servers stopped cleanly. The exact inputs, outcome, versions and
cleanup are in `OWNED_DUPLICATE_SERVING_MASTER_20261012.json`; the 15-line
insertion into `test_recovery.mjs` is retained as
`OWNED_DUPLICATE_SERVING_MASTER_20261012.patch` for reproduction.

This establishes a mechanism limit: isolated boot, member-local counters and
forced-leader content comparisons do not by themselves prove that the two
serving masters came from two independent physical member stores. It does
**not** show a production `host_match` false accept. In the real capture chain,
an extraction-time substitution after an accurate guest manifest would be
rejected by the guest/host file comparison. A substitution already present
before guest capture, or a forged guest manifest and receipt chain, is outside
what this owned probe can distinguish. The fixture's `MATCH` is generated from
its caller plan and does not attest guest origin.

Do not add a pairwise whole-tree-digest inequality requirement as a substitute
for origin evidence. Replicated user-stream bytes can legitimately match, and
digest inequality alone cannot prove that a member's bytes came from its
original store. The eventual acceptance controller must retain the existing
four-role path and guest/host content binding, then establish guest origin,
writer exclusion, and the independent source of each physical store through
the reviewed capture boundary. Neither this experiment nor a successful cold
probe authorizes a production stop, VM shutdown, capture, restart or history
acceptance. Step 1.2 remains `[A]/v1.2-pre`; all four production NATS stores
and their topology were untouched.
