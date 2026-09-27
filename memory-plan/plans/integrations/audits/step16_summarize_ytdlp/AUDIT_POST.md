# AUDIT_POST — step 1.6 · local yt-dlp subtitle path in `summarize`

## §0 Micro re-orient

VERSION v1.5 → v1.6-pre. Row 1.6 was the last open row of Block 1. Still the right step: yes.

## Landed

`skills/summarize/SKILL.md` gains a `## YouTube without Apify` section giving the two-command
local recipe (`yt-dlp --skip-download --write-auto-subs …` then `summarize <file>.vtt`), the
`--youtube auto` flag line now says plainly that it sends the video to a hosted service, the
config line marks `APIFY_API_TOKEN` as not needed when yt-dlp is present, and `yt-dlp` is added to
`metadata.clawdbot.install` as an optional formula while `requires.bins` stays `["summarize"]` —
the skill still works without it.

No new code: the recipe is two existing binaries. Rung 1 of the ladder rule installed in 1.3
("does this need to exist at all?") applied to itself here — a wrapper script would have added a
file to maintain for no behaviour the two commands do not already have.

## Verify contract — executed in part

**`code:` PASS.** `skill-audit --skill summarize` → 100/100, grade A, clean (unchanged by the
edit). Scanner exit 0. The inline `metadata:` JSON still parses. `skill-routing-eval --compare` →
829/829, 100.0%, no regression. `yt-dlp` accepts the exact flag combination (exit 0).

**`runtime:` NOT PRODUCIBLE HERE — deferred, not waived.** The contract asks for a real YouTube
video summarized with `APIFY_API_TOKEN` unset. This session's egress refuses YouTube outright:

```
curl https://www.youtube.com   → CONNECT tunnel failed, response 403
curl https://m.youtube.com     → CONNECT tunnel failed, response 403
yt-dlp https://youtu.be/…      → Tunnel connection failed: 403 Forbidden (3 retries, then ERROR)
```

The failure is the network, not the recipe, and no amount of local work changes it. Recorded as
**D9**: the row is `[D]`, not `[x]`.

**Operator probe that closes this row** (on the design box, with `yt-dlp` and `summarize`
installed and `APIFY_API_TOKEN` unset):

```bash
unset APIFY_API_TOKEN
yt-dlp --skip-download --write-auto-subs --sub-lang en --sub-format vtt \
  -o "$TMPDIR/%(id)s.%(ext)s" "https://youtu.be/<a short public video>"
summarize "$TMPDIR/<id>.en.vtt"
```

Expected: a `.en.vtt` file on disk and a summary printed, with no Apify token in the environment.
Paste the two outputs under this heading and flip the row to `[x]`.

## Findings

1. The upstream idea (from the rejected Agent-Reach package) was worth exactly one thing: use the
   local downloader instead of the hosted one. Nothing was copied — the recipe is written against
   yt-dlp's own flags — which is the shape any future borrowing from a rejected package should take.
2. `summarize` itself still calls a model provider over the network. The claim in the skill is
   narrow on purpose: nothing but the summarizer's own model call leaves the machine.

## §6 carry-forwards

- Block 1 closes on 1.1–1.5 with 1.6 deferred; the macro re-orient runs next.
- Block 2's Archify steps need no network beyond a disabled update check, so the chain continues.

## Feeds — landed

`skills/summarize/SKILL.md` now documents a local path for YouTube; `yt-dlp` is an optional
install in its metadata.

---

# MACRO RE-ORIENT — Block 1 close (PROTOCOL §5.2)

**Delivered.** 1.1 web-fetch `--markdown`; 1.2 address pinning; 1.3 the `lazy-senior-ladder` rule
with its advisory dependency check; 1.4 `ponytail-review` plus a fourth review perspective; 1.5 six
agent-skills ports. 1.6's code landed with its probe deferred (D9).

**Block exit criterion, re-read.** "`--markdown` prints a Markdown article with a provenance
header; routing-eval shows zero regressions with the new skills installed; a worker commit adding a
dependency produces a POST-COMMIT FAIL line." All three observed. The skills count went 108 → 115,
routing held at 100.0% with zero regressed skills after two triggers were corrected, and the
harness rule fired against a real worktree.

**What the block taught, carried into Block 2.**
1. A verify contract can be wrong. 1.1's byte-drop threshold measured markup density (D8); 1.6's
   probe needs a host this session cannot reach (D9). Both were recorded, not quietly satisfied.
2. Gate on the per-item comparison, not the headline. Routing accuracy stayed at 100% while two
   skills regressed underneath it.
3. Check a config value against its validator before writing it. 1.3's command shape was refused by
   exec-safety, and the same omission left `git-conventional-commits` inert for however long it has
   been shipped (OUT_OF_SCOPE).

**Still true / re-verified.** No plan step has touched the memory daemon, NATS or the scheduler, so
the queued runtime-repair scope is unaffected (D7). The 246 environmental test failures are
unchanged from unmodified HEAD.

**Next.** Block 2, step 2.1 — codebase-memory-mcp. Its install is `darwin-arm64` and needs the
operator's box; step 2.3 (Archify) is fully runnable here, so if 2.1 blocks, 2.3 is the next
productive row rather than a stall.
