---
name: tavily-search
description: "AI-optimized web search via Tavily API. Use when the user asks for Tavily by name, or for a deep Tavily research pass or URL extraction; plain web searches go to web-search."
triggers:
  - "search with tavily"
  - "tavily search for"
  - "research this topic with tavily"
  - "use tavily to"
  - "extract this url with tavily"
negative_triggers:
  - "search this codebase"
  - "find this file"
  - "grep for"
  - "summarize this URL"
homepage: https://tavily.com
metadata: {"clawdbot":{"emoji":"🔍","requires":{"bins":["node"],"env":["TAVILY_API_KEY"]},"primaryEnv":"TAVILY_API_KEY"}}
---

# Tavily Search

AI-optimized web search using Tavily API. Designed for AI agents - returns clean, relevant content.

## Search

```bash
node {baseDir}/scripts/search.mjs "query"
node {baseDir}/scripts/search.mjs "query" -n 10
node {baseDir}/scripts/search.mjs "query" --deep
node {baseDir}/scripts/search.mjs "query" --topic news
```

## Options

- `-n <count>`: Number of results (default: 5, max: 20)
- `--deep`: Use advanced search for deeper research (slower, more comprehensive)
- `--topic <topic>`: Search topic - `general` (default) or `news`
- `--days <n>`: For news topic, limit to last n days

## Extract content from URL

```bash
node {baseDir}/scripts/extract.mjs "https://example.com/article"
```

Notes:
- Needs `TAVILY_API_KEY` from https://tavily.com
- Tavily is optimized for AI - returns clean, relevant snippets
- Use `--deep` for complex research questions
- Use `--topic news` for current events
