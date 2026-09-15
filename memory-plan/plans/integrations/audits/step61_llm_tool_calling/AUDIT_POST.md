# AUDIT_POST — step 6.1 · tool calling in the local LLM client

## §0 Micro re-orient

VERSION v5.2 → v6.1-pre. Needs present: `lib/llm-client.mjs` with both backend branches; a real
HTTP server is enough to prove the wire contract. No ollama in this session (see the runtime split).

## Deltas (greppable)

- `lib/llm-client.mjs`: exported `normalizeToolCalls()`; `generate()` accepts `tools` and
  `toolChoice` and returns `toolCalls`; `format: 'json'` / `response_format` suppressed when tools
  are present; JSDoc updated.
- `test/llm-client-tools.test.mjs`: 9 tests.

`generateAnalysis()` is deliberately untouched — it is the short fallback path for memory inject,
and giving it tools would widen a hot path nothing asked for (ladder rung 1).

## Verify contract — executed

**`code:` PASS.** `node --test test/llm-client-tools.test.mjs` → **9 tests, 9 pass**. The server in
those tests is a real `http.Server`, so every assertion about the request body is about bytes that
actually crossed a socket, not a stub's recorded arguments.

Proven on both backends:

| | Ollama native `/api/chat` | OpenAI-compatible `/v1/chat/completions` |
|---|---|---|
| tools reach the server unchanged | yes | yes, plus `tool_choice` |
| `arguments` shape returned | object | JSON string |
| normalized to | object, `argumentsRaw: null` | object, raw text kept |
| `think: false` still sent | yes | n/a |
| no tools passed | request unchanged, `toolCalls: []` | request unchanged, `toolCalls: []` |

Also pinned: `jsonMode` + `tools` sends **no** `format`/`response_format` (the two constrain
decoding in different directions and a small model then produces neither a clean call nor clean
JSON), while `jsonMode` alone still sends `format: 'json'`.

**Regression, like-for-like** (both with NATS up): committed baseline `b5d6f5c` **2032 tests / 263
fail**; this branch **2051 / 263** — +19 tests (10 from 5.2, 9 here), +19 passes, **no new
failures**. The four existing `generate()` callers (`extraction-prompt`, `obsidian-summarizer`,
`broadcast-offerer`, `llm-benchmark`) pass no `tools`, and the test above pins that their request
body is unchanged.

**`runtime:` SPLIT — the client contract is proven, the model's is not.** The step's contract asked
for a qwen3 hit-rate over 20 runs with a ≥17/20 bar. That needs a real model: `ollama` is not
installed here and `ollama.com` is refused by this session's egress (`curl` → 000). What was
provable — that the client sends a correct request and parses both real response shapes — is
proven above over real HTTP. What is not provable here is whether qwen3:8b *chooses* the right
tool, which is a property of the model, not of this code.

**Operator probe that completes this row** (design box, ollama running with the node's `LLM_MODEL`):

```bash
node -e '
const { createLlmClient } = require("./lib/llm-client.mjs");
const tools = [{ type:"function", function:{ name:"get_fleet_state",
  description:"Current node health across the mesh",
  parameters:{ type:"object", properties:{ scope:{type:"string"} }, required:[] } } }];
const c = createLlmClient();
let hit = 0;
for (let i = 0; i < 20; i++) {
  const r = await c.generate([{ role:"user", content:"which nodes are down right now?" }],
                             { tools, bypassQueue: true });
  if (r.toolCalls[0]?.name === "get_fleet_state") hit++;
}
console.log(`tool selected ${hit}/20`);
'
```

Record the figure in this file. Below roughly 17/20, step 6.2's grounding agent needs a stricter
"call a context tool first" prompt — or a different model — before Mission Control depends on it.

## Findings

1. **The default backend is Ollama's native endpoint, not the OpenAI one.** The plan said to add
   tools to "the `/v1/chat/completions` branch"; that branch is only used when `LLM_NATIVE_API` is
   explicitly `false`. Adding tools there alone would have shipped a feature the node never
   exercises. Both branches now carry it.
2. **The two backends disagree about `arguments`**, object versus JSON string. Left unnormalized,
   every caller would have needed a `typeof` check, and the first one to forget it would read
   `undefined` from a valid call. The parse failure is surfaced rather than swallowed, because a
   small model emitting broken argument JSON is the expected failure mode here.
3. `generateAnalysis` mirrors `generate` almost line for line, which is why the first patch attempt
   matched two blocks and aborted. The duplication is pre-existing; noted, not refactored, since
   this step has no reason to touch the inject path.

## §6 carry-forwards

- Step 6.2 (`lib/node-agent.mjs`) can now call `generate(messages, { tools })` and read
  `toolCalls`, but should not ship to a Mission Control route until the operator probe above has a
  number, per the step's own contract.
- Step 4.9 (God's Eye View design tool) depends on this and inherits the same caveat.

## Feeds — landed

`lib/llm-client.mjs` exports `normalizeToolCalls` and `generate()` returns `toolCalls` on every
call, empty when the model answers in prose.
