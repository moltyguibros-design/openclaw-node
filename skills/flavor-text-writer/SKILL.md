---
name: flavor-text-writer
description: "Writes short in-world game flavor text for items, spells, locations, enemies, achievements and loading screens, within strict length budgets and the setting's tone. Use when a game asset needs its one-to-three line descriptive blurb."
version: 1.0.0
user-invocable: true
triggers:
  - "write flavor text for this item"
  - "item description for a weapon"
  - "flavor text for a spell"
  - "loading screen tip lines"
  - "achievement description text"
  - "lore blurb for an artifact"
negative_triggers:
  - "write marketing copy for the game"
  - "design the main quest storyline"
  - "build the world history and factions"
  - "write game design documentation"
metadata:
  openclaw:
    requires:
      bins: []
    os:
      - macos
      - linux
---

# Flavor Text Writer

Short, in-world text attached to a game asset: the line under an item name, the
caption on a location card, the quip on an achievement. It is read in a glance,
so every word has to carry tone, a hint of story, or a gameplay cue.

This skill writes the text. The world itself (factions, history, timeline) and
the quest arcs belong to the lore-writer soul's other skills; read what they
have established before writing, and never invent canon that contradicts it.

## When to use

- A new item, spell, enemy, location, achievement or loading screen needs its blurb.
- Existing flavor text breaks tone, runs long, or contradicts the asset's mechanics.
- A batch of assets (a loot table, a skill tree) needs consistent text in one pass.

## When NOT to use

- Store pages, trailers, press or social copy: that is marketing, not in-world text.
- Quest structure, branching dialogue trees, or a faction's history: narrative design and world-building.
- Tooltips that state exact numbers: those are UI copy generated from game data.

## Inputs to gather first

1. **The asset**: name, type, rarity or tier, and what it does mechanically.
2. **The setting canon**: tone guide, faction names, established places and events.
   On a lore-writer task, read the soul's PRINCIPLES.md and any lore docs in the
   project before writing.
3. **The surface**: where the text appears and its character limit, if the UI has one.
4. **Neighbours**: two or three existing blurbs of the same type, to match voice and length.

If the mechanics or the canon are unknown, ask; do not guess at either.

## Length budgets

| Asset | Budget | Shape |
|---|---|---|
| Common item | 1 line, ≤ 90 chars | one image or one wry observation |
| Rare / legendary item | 1–3 lines, ≤ 220 chars | a fragment of its story, optionally attributed |
| Spell / ability | 1–2 lines, ≤ 140 chars | what it feels like, not what it does |
| Enemy | 1–2 lines, ≤ 160 chars | how survivors talk about it |
| Location | 1–3 lines, ≤ 220 chars | what you notice first, and one thing that is wrong |
| Achievement | ≤ 60 chars | a nod or a joke about how it was earned |
| Loading screen | 1 line, ≤ 120 chars | either a lore hint or a gameplay tip in-voice, not both |

A UI limit, when given, overrides the table.

## Craft rules

1. **Show, don't explain.** Imply history through a detail: a scratched name, a
   repaired seam, a warning someone ignored. No "Long ago…" openers.
2. **One idea per blurb.** If a second idea is needed, the asset needs a second
   surface (a codex entry), not a longer blurb.
3. **Support the mechanic.** A fire spell's text should make players expect fire;
   a defensive item should read as protective. Never promise an effect the asset
   does not have.
4. **Specific nouns over adjectives.** "Smells of ozone and burnt coffee" beats
   "mysterious and powerful".
5. **Earn the quote.** An attributed line ("— Last words of …") must come from a
   character or faction that exists in canon.
6. **Vary rhythm across a set.** In a batch, mix statements, fragments and quotes so
   a loot table does not read as one template.
7. **Tone is a red line.** Match the setting's register exactly; one anachronism
   breaks immersion. When the tone guide and a clever line conflict, the tone wins.

## Process

1. Gather the inputs above.
2. Draft three options per asset, each taking a different angle (object, user, rumour).
3. Cut each draft to its budget; remove every adjective that a noun can replace.
4. Check each option against the mechanics and the canon.
5. Pick one and say why in a single line; keep the others as alternates.

## Output format

Per asset:

```
<Asset name> (<type>, <rarity>)
  Text: <the chosen blurb>
  Chars: <n> / <budget>
  Angle: <object | user | rumour | quote>, <one-line reason>
  Alternates:
    - <option 2>
    - <option 3>
  Canon refs: <names/events used, or "none">
```

For a batch, add a closing list of any canon gaps found (names or events the text
needed that are not established yet) so the world-building side can settle them.

## Example

Input: *Static Lantern* (common item, emits light, drains slowly in rain), setting
tone "gritty urban magic, modern tech".

```
Static Lantern (item, common)
  Text: Hums like a fridge, glows like a promise. Keep it out of the rain.
  Chars: 70 / 90
  Angle: object, the hum and the rain warning foreshadow its drain mechanic
  Alternates:
    - Every courier carries one. Every courier has cursed one at 3 a.m.
    - The label says waterproof. The label is lying.
  Canon refs: none
```

## Review checklist

- [ ] Within budget (and the UI limit, if any)
- [ ] Matches the asset's mechanics; promises nothing extra
- [ ] Uses only established canon; gaps listed
- [ ] Tone matches the guide; no anachronism
- [ ] Reads naturally aloud in one breath
