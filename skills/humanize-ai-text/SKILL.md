---
name: humanize-ai-text
description: "Detect signs of AI-generated text with a Python script (detect.py). Use when you need to scan text for AI writing patterns, get an AI probability score, or batch-scan files. It reports only; it never rewrites text."
triggers:
  - "scan this text for AI patterns"
  - "run the AI detector on this file"
  - "batch scan these files for AI writing"
  - "check AI probability score"
negative_triggers:
  - "rewrite this to sound more human"
  - "humanize this text"
  - "edit this to remove AI patterns"
  - "make this pass an AI detector"
allowed-tools:
  - Read
  - Shell
  - Glob
---

# Humanize AI Text (detector)

A CLI that scans text for the signs of AI writing listed in [Wikipedia's Signs of AI Writing](https://en.wikipedia.org/wiki/Wikipedia:Signs_of_AI_writing) and scores how likely the text is machine-written. Use it to review drafts, check submissions, or find boilerplate to edit by hand.

It does not rewrite text. For editing your own draft toward a plainer style, use the `humanizer` skill. Do not use either to pass AI-written text off as human-written: that is deceptive, and the node's rules forbid it.

## Quick Start

```bash
python3 scripts/detect.py text.txt        # full report
python3 scripts/detect.py text.txt -j     # JSON
python3 scripts/detect.py text.txt -s     # score only
echo "text" | python3 scripts/detect.py   # stdin
```

---

## Detection Categories

The analyzer checks for **16 pattern categories** from Wikipedia's guide:

### Critical (Immediate AI Detection)
| Category | Examples |
|----------|----------|
| Citation Bugs | `oaicite`, `turn0search`, `contentReference` |
| Knowledge Cutoff | "as of my last training", "based on available information" |
| Chatbot Artifacts | "I hope this helps", "Great question!", "As an AI" |
| Markdown | `**bold**`, `## headers`, ``` code blocks ``` |

### High Signal
| Category | Examples |
|----------|----------|
| AI Vocabulary | delve, tapestry, landscape, pivotal, underscore, foster |
| Significance Inflation | "serves as a testament", "pivotal moment", "indelible mark" |
| Promotional Language | vibrant, groundbreaking, nestled, breathtaking |
| Copula Avoidance | "serves as" instead of "is", "boasts" instead of "has" |

### Medium Signal
| Category | Examples |
|----------|----------|
| Superficial -ing | "highlighting the importance", "fostering collaboration" |
| Filler Phrases | "in order to", "due to the fact that", "Additionally," |
| Vague Attributions | "experts believe", "industry reports suggest" |
| Challenges Formula | "Despite these challenges", "Future outlook" |

### Style Signal
| Category | Examples |
|----------|----------|
| Curly Quotes | “ ” instead of " " |
| Em Dash Overuse | Excessive use of — for emphasis |
| Negative Parallelisms | "Not only... but also", "It's not just... it's" |
| Rule of Three | Forced triplets like "innovation, inspiration, and insight" |

---

## Output

- Issue count and word count
- AI probability (low/medium/high/very high)
- Breakdown by category, with the plainer form noted for copula and filler phrases

## AI Probability Scoring

| Rating | Criteria |
|--------|----------|
| Very High | Citation bugs, knowledge cutoff, or chatbot artifacts present |
| High | >30 issues OR >5% issue density |
| Medium | >15 issues OR >2% issue density |
| Low | <15 issues AND <2% density |

The score is a heuristic: plain human prose can trip it and edited AI text can pass it. Treat it as a pointer for review, never as proof of who wrote something.

---

## Customizing Patterns

Edit `scripts/patterns.json` to add/modify:
- `ai_vocabulary` — words to flag
- `significance_inflation` — puffery phrases
- `promotional_language` — marketing speak
- `copula_avoidance` — phrase → plainer form shown in the report
- `filler_replacements` — phrase → plainer form shown in the report
- `chatbot_artifacts` — chatbot phrases
- `rule_of_three_patterns` — triplet openings

---

## Batch Scanning

```bash
for f in *.txt; do
  echo "=== $f ==="
  python3 scripts/detect.py "$f" -s
done
```

---

## Reference

Based on Wikipedia's [Signs of AI Writing](https://en.wikipedia.org/wiki/Wikipedia:Signs_of_AI_writing), maintained by WikiProject AI Cleanup.
