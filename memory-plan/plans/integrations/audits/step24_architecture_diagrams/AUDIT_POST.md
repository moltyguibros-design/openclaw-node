# AUDIT_POST — step 2.4 · two architecture diagrams

## §0 Micro re-orient

VERSION v2.3 → v2.4-pre. Needs present: `skills/archify` installed and validating (2.3), both IRs
shipped as its examples, `docs/` writable under the step scope.

## Promised vs landed

| Promised | Landed |
|---|---|
| both IRs delivered to `docs/diagrams/` | yes — `memory-daemon-lifecycle.html` (708 KB), `memory-pipeline-dataflow.html` (712 KB) |
| Google Fonts links stripped | yes — the 7-line async block replaced with a comment saying why |
| linked from `docs/ARCHITECTURE.md` beside the ASCII overview | yes — a two-row table after the fenced block, before `## Services` |

## Verify contract — executed

**`code:` PASS.** `deliver <type> <ir> --quality showcase --json` for both: `ok true`, **9/9**
artifact checks, sha and byte count in the receipt. After stripping, `grep -c
"fonts.googleapis\|fonts.gstatic"` is **0** in both files, and a scan for any `src=`/`href=` on an
`http(s)` scheme returns **0 external URLs** in either document.

**`runtime:` PASS.** Each file opened in a real browser from `file://` with a request listener
attached:

| File | title | `<svg>` | text labels | external requests | page errors |
|---|---|---|---|---|---|
| `memory-daemon-lifecycle.html` | Memory Daemon Session Lifecycle Diagram | 2 | 37 | **0** | 0 |
| `memory-pipeline-dataflow.html` | Memory Pipeline: JSONL to Inject Diagram | 2 | 42 | **0** | 0 |

Labels read back from the rendered SVG confirm real content, not an empty shell: the lifecycle
shows `01 / Daemon states`, `ENDED`, `no live session`; the dataflow shows the five stages
`Sources → Ingest → Process → Store → Serve` and `JSONL transcripts`. Zero external requests is the
claim that matters — the artifact is genuinely self-contained.

## Findings

1. **Stripping the fonts cost 560 bytes and nothing else.** The block was already async
   (`media="print"` with an `onload` swap) with a system-monospace fallback, so removal changes no
   layout; what it buys is a document that provably makes no request, which is the difference
   between "should be offline-safe" and "observed to be".
2. **The diagram sources are the skill's own examples**, so `docs/ARCHITECTURE.md` names them in
   the table. That closes the usual failure of generated docs: the next person to change the daemon
   can find the JSON that produced the picture, edit it, and re-run `deliver` — rather than
   discovering that the diagram is a screenshot nobody can regenerate.
3. The delivered HTML is ~710 KB each because the renderer inlines its entire runtime. That is the
   cost of self-containment and is stated here so it is not mistaken for bloat later.

## §6 carry-forwards

- Block 2's remaining rows (2.1, 2.2 — codebase-memory-mcp) need the operator's macOS box; the
  chain moves to Block 3, whose first step also needs an operator install (VoiceStudio), so the
  next fully-runnable work here is Block 5's detector or Block 6's tool calling.
- Any future edit to the memory daemon's states should update `lifecycle.example.json` and re-run
  `deliver`; the doc table names the path.

## Feeds — landed

`docs/ARCHITECTURE.md` links two rendered, self-contained diagrams; `skills/archify` is proven
end-to-end (validate → deliver → renders offline) rather than only installed.
