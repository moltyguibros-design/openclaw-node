---
name: fast-browser-use
displayName: Fastest Browser Use
emoji: "⚡"
summary: Rust-powered browser automation that rips through DOMs 10x faster than Puppeteer.
homepage: https://github.com/rknoche6/fast-browser-use
primaryEnv: bash
os:
  - darwin
  - linux
requires:
  bins:
    - chrome
install:
  - kind: brew
    formula: rknoche6/tap/fast-browser-use
  - kind: cargo
    package: fast-browser-use
description: "Rust-powered browser automation engine driving Chrome via CDP for fast DOM extraction, scraping, screenshots, and session management. Use for high-performance web scraping, infinite-scroll harvesting, page snapshots, or site structure analysis."
triggers:
  - "scrape this website fast"
  - "use fast-browser-use to"
  - "harvest data from this page"
  - "take a screenshot of this site"
  - "analyze the site structure"
negative_triggers:
  - "browse my local files"
  - "use agent-browser"
  - "fetch a single URL and summarize"
---

# Fastest Browser Use

A Rust-based browser automation engine that provides a lightweight binary driving Chrome directly via CDP. It is optimized for token-efficient DOM extraction, robust session management, and speed.

Chrome or Chromium must be installed; the binaries locate it themselves (there is no CHROME_PATH setting).

## Sandbox

Chrome runs with its sandbox **on**: these commands load arbitrary, untrusted pages. Pass `--no-sandbox`
(to the CLI or to `mcp-server`) only where the sandbox cannot start, such as running as root in a container.

## CLI

The `fast-browser-use` binary has seven subcommands: `navigate`, `snapshot`, `login`, `harvest`, `markdown`,
`screenshot`, `sitemap`. Each invocation launches its own Chrome and closes it on exit, so nothing carries
over between commands: every command that reads a page needs its own `--url`.

### 1. Check that a page loads

`navigate` prints nothing; it succeeds once the page (or `--wait-for-selector`) has loaded.
`--human-emulation` only adds a random 1-3 s pause after navigation.

```bash
fast-browser-use navigate --url "https://example.com" --wait-for-selector "#content"
```

### 2. Snapshot a page

An AI-oriented YAML rendering of the page's accessibility tree, to stdout or `--output`.

```bash
fast-browser-use snapshot --url "https://example.com" --output state.yaml
```

### 3. Reuse a logged-in session

`login` opens a visible browser, waits for Enter after you log in, and saves the cookies.
`navigate --load-session` loads them before navigating, which with `--wait-for-selector` confirms the
session is still accepted; no other subcommand takes a session.

```bash
fast-browser-use login --url "https://github.com/login" --save-session ./auth.json
fast-browser-use navigate --url "https://github.com/dashboard" --load-session ./auth.json
```

### 4. 🚜 Infinite Scroll Harvester
**Extract fresh data from infinite-scroll pages** — perfect for harvesting the latest posts, news, or social feeds.

```bash
# Harvest headlines from Hacker News (scrolls 3x, waits 800ms between)
fast-browser-use harvest \
  --url "https://news.ycombinator.com" \
  --selector ".titleline a" \
  --scrolls 3 \
  --delay 800 \
  --output headlines.json
```

**Real output** (59 unique items in ~6 seconds):
```json
[
  "Genode OS is a tool kit for building highly secure special-purpose OS",
  "Mobile carriers can get your GPS location",
  "Students using \"humanizer\" programs to beat accusations of cheating with AI",
  "Finland to end \"uncontrolled human experiment\" with ban on youth social media",
  ...
]
```

Works on any infinite scroll page: Reddit, Twitter, LinkedIn feeds, search results, etc.

### 5. 📸 Quick Screenshot
Capture any page as PNG:

```bash
fast-browser-use screenshot \
  --url "https://example.com" \
  --output page.png \
  --full-page  # Optional: capture entire scrollable page
```

### 6. 🗺️ Sitemap & Page Structure Analyzer
Discover how a site is organized by parsing sitemaps and analyzing page structure.

```bash
# Basic sitemap discovery (checks robots.txt + common sitemap URLs)
fast-browser-use sitemap --url "https://example.com"
```

```bash
# Full analysis with page structure (headings, nav, sections)
fast-browser-use sitemap \
  --url "https://example.com" \
  --analyze-structure \
  --max-pages 10 \
  --max-sitemaps 5 \
  --output site-structure.json
```

**Options:**
- `--analyze-structure`: Also extract page structure (headings, nav, sections, meta)
- `--max-pages N`: Limit structure analysis to N pages (default: 5)
- `--max-sitemaps N`: Limit sitemap parsing to N sitemaps (default: 10, useful for large sites)

**Example output:**
```json
{
  "base_url": "https://example.com",
  "robots_txt": "User-agent: *\nSitemap: https://example.com/sitemap.xml",
  "sitemaps": ["https://example.com/sitemap.xml"],
  "pages": [
    "https://example.com/about",
    "https://example.com/products",
    "https://example.com/contact"
  ],
  "page_structures": [
    {
      "url": "https://example.com",
      "title": "Example - Home",
      "headings": [
        {"level": 1, "text": "Welcome to Example"},
        {"level": 2, "text": "Our Services"}
      ],
      "nav_links": [
        {"text": "About", "href": "/about"},
        {"text": "Products", "href": "/products"}
      ],
      "sections": [
        {"tag": "main", "id": "content", "role": "main"},
        {"tag": "footer", "id": "footer", "role": null}
      ],
      "main_content": {"tag": "main", "id": "content", "word_count": 450},
      "meta": {
        "description": "Example company homepage",
        "canonical": "https://example.com/"
      }
    }
  ]
}
```

Use this to understand site architecture before scraping, map navigation flows, or audit SEO structure.

### 7. 📝 Page to Markdown

```bash
fast-browser-use markdown --url "https://example.com" --output page.md
```

## ⚡ Performance Comparison

| Feature | Fast Browser Use (Rust) | Puppeteer (Node) | Selenium (Java) |
| :--- | :--- | :--- | :--- |
| **Startup Time** | **< 50ms** | ~800ms | ~2500ms |
| **Memory Footprint** | **15 MB** | 100 MB+ | 200 MB+ |
| **DOM Extract** | **Zero-Copy** | JSON Serialize | Slow Bridge |

## MCP server tools

The `mcp-server` binary (stdio by default; `--transport sse|http`) keeps one browser session open across calls
and registers these tools:

### Navigation & Lifecycle
- **browser_navigate**: Visit a URL.
- **browser_go_back** / **browser_go_forward**: Traverse browser history.
- **browser_wait**: Wait for an element to appear.
- **browser_close**: Terminate the browser session.

### Extraction
- **browser_snapshot**: The page with indexed interactive elements (indices feed the interaction tools).
- **browser_get_markdown**: The page content as Markdown (extraction only).
- **browser_screenshot**: Capture the page as an image.
- **browser_evaluate**: Run JavaScript in the page.

### Interaction
- **browser_click**, **browser_hover**, **browser_select**, **browser_input_fill**: Act on an element by CSS selector or snapshot index.
- **browser_press_key**: Send a keyboard event.
- **browser_scroll**: Scroll the viewport.

### Tabs
- **browser_new_tab**, **browser_tab_list**, **browser_switch_tab**, **browser_close_tab**.

## Usage

This skill is specialized for complex web interactions that require maintaining state (like being logged in), handling dynamic JavaScript content, or managing multiple pages simultaneously. It offers higher performance and control compared to standard fetch-based tools.
