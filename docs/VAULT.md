# The fused Obsidian vault

Since 2026-07-04 (operator decision) there is **one** vault: the machine's memory pipeline
lives inside the operator's real Obsidian vault instead of a hidden sibling directory.

```
<real vault>  (workspace/projects/arcane-vault — .obsidian, plugins, your notes)
├── 00-meta … 21-legal          ← operator sync domains (obsidian-sync push routes)
├── nodes/<nodeId>/…            ← per-node pushed files (recaps, lessons, state, …)
│   └── memory/                 ← THE MEMORY PIPELINE (this doc's subject)
│       ├── concepts/  sessions/  decisions/  themes/  daily/
└── (everything is browsable, graph-viewable, linkable in the Obsidian app)
```

## How the pipeline finds it

`getVaultPath()` in [lib/obsidian-vault.mjs](../lib/obsidian-vault.mjs) — one resolution used by
the writers, the graph parser, the link checker, and the node-watch `obs.*` probes
(Mission Control's `config.ts` mirrors it):

1. explicit `opts.vaultPath` (tests always use this — tmp vaults, never the live one)
2. `OBSIDIAN_VAULT_PATH` env override (the pipeline subtree only: the `workspace-bin/obsidian`
   CLI and obsidian-sync find the real vault root through `vaultPath` / `apiKeyFile` in the
   same config file — lib/obsidian-vault.mjs `getObsidianVaultRoot()`)
3. **`memoryVaultPath` in `~/.openclaw/config/obsidian-sync.json`** — the fusion knob;
   workspace-relative (like the file's other paths) or absolute
4. legacy default `~/.openclaw/obsidian-local/` (fresh nodes before the operator points it
   at a real vault; the template ships the key empty)

The value is cached per process — restart the memory daemon and node-watch after changing it.

## What this buys

The vault is simultaneously the **retrieval substrate** (graph parser → graph-cache.db →
spreading activation = retrieval channel 5 → `:7893 /memory/inject`) and a **first-class
Obsidian experience**: machine-written concept/session/decision notes appear in your graph
view next to your own notes, wikilinks cross the boundary, and the operator sync keeps
pushing project docs into the same tree.

Migration record (this node): 157 notes moved from `obsidian-local` (now
`obsidian-local.pre-fusion-backup`), graph rebuilt identical (157 nodes / 1104 edges),
channel 5 verified live from the fused path (152 nodes activated from one seed).

## The global half: extraRoots (project docs & data)

The same vault also receives every doc source, via the operator sync
([workspace-bin/obsidian-sync.mjs](../workspace-bin/obsidian-sync.mjs), run by the memory
daemon's Phase 2 every 30 min — REST API when the Obsidian app is up, direct write otherwise):

- **Workspace routes** (existing): recaps, lessons, state, memory-vault ledgers →
  `nodes/<nodeId>/…`; arcane project docs → the `00`–`21` domains.
- **`extraRoots`** (2026-07-04): additional source trees beyond the workspace, each with its
  own routes. First consumer is the openclaw-nodedev repo itself → domain `22-openclaw-node/`
  (README, `docs/**`, the canonical protocol docs, and every plan silo's
  ROADMAP/DECISIONS/COMPONENT_REGISTRY — `stripPrefix` preserves per-plan dirs so the four
  DECISIONS.md never clobber). Per-root sync-state keys; changed-hash detection; frontmatter
  carries `source_root` + `source_path` back to the origin file.

Adding any future doc source = one `extraRoots` entry in
`~/.openclaw/config/obsidian-sync.json`. No code.
