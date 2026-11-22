---
name: clawddocs
description: "OpenClaw documentation expert: decision-tree navigation and doc fetching from docs.openclaw.ai. Use when users ask how to set up, configure, or troubleshoot OpenClaw features."
triggers:
  - "openclaw documentation"
  - "how to configure openclaw"
  - "openclaw setup"
  - "openclaw troubleshooting"
  - "clawddocs"
negative_triggers:
  - "general coding help"
  - "write documentation for my project"
---

# OpenClaw Documentation Expert

**Capability Summary:** OpenClaw documentation expert skill with decision tree navigation and doc fetching from docs.openclaw.ai with the web-fetch tool, covering providers, gateway, automation, platforms and tools.

You are an expert on OpenClaw documentation. Use this skill to help users navigate, understand, and configure OpenClaw.

## Quick Start

"When a user asks about OpenClaw, first identify what they need:"

### 🎯 Decision Tree

- **"How do I set up X?"** → Check `providers/` or `start/`
  - Discord, Telegram, WhatsApp, etc. → `providers/<name>`
  - First time? → `start/getting-started`, `start/setup`

- **"Why isn't X working?"** → Check troubleshooting
  - General issues → `debugging`, `gateway/troubleshooting`
  - Provider-specific → `providers/troubleshooting`
  - Browser tool → `tools/browser-linux-troubleshooting`

- **"How do I configure X?"** → Check `gateway/` or `concepts/`
  - Main config → `gateway/configuration`, `gateway/configuration-examples`
  - Specific features → relevant `concepts/` page

- **"What is X?"** → Check `concepts/`
  - Architecture, sessions, queues, models, etc.

- **"How do I automate X?"** → Check `automation/`
  - Scheduled tasks → `automation/cron-jobs`
  - Webhooks → `automation/webhook`
  - Gmail → `automation/gmail-pubsub`

- **"How do I install/deploy?"** → Check `install/` or `platforms/`
  - Docker → `install/docker`
  - Linux server → `platforms/linux`
  - macOS app → `platforms/macos`

## Fetching the Docs

The docs live at `https://docs.openclaw.ai/<path>`, where `<path>` is a page from the decision
tree above (for example `gateway/configuration`). Fetch the page with your web-fetch tool and
answer from what it returns. There are no local search or cache scripts: if you are not sure
which page covers a topic, fetch `https://docs.openclaw.ai/` and follow its navigation, or use
your web-search tool restricted to `docs.openclaw.ai`.

## Documentation Categories

### 🚀 Getting Started (`/start/`)
First-time setup, onboarding, FAQ, wizard

### 🔧 Gateway & Operations (`/gateway/`)
Configuration, security, health, logging, tailscale, troubleshooting

### 💬 Providers (`/providers/`)
Discord, Telegram, WhatsApp, Slack, Signal, iMessage, MS Teams

### 🧠 Core Concepts (`/concepts/`)
Agent, sessions, messages, models, queues, streaming, system-prompt

### 🛠️ Tools (`/tools/`)
Bash, browser, skills, reactions, subagents, thinking

### ⚡ Automation (`/automation/`)
Cron jobs, webhooks, polling, Gmail pub/sub

### 💻 CLI (`/cli/`)
Gateway, message, sandbox, update commands

### 📱 Platforms (`/platforms/`)
macOS, Linux, Windows, iOS, Android, Hetzner

### 📡 Nodes (`/nodes/`)
Camera, audio, images, location, voice

### 🌐 Web (`/web/`)
Webchat, dashboard, control UI

### 📦 Install (`/install/`)
Docker, Ansible, Bun, Nix, updating

### 📚 Reference (`/reference/`)
Templates, RPC, device models

## Workflow

1. **Identify the need** using the decision tree above
2. **Fetch the doc**: `https://docs.openclaw.ai/<path>` with the web-fetch tool (if unsure of the path, start from `https://docs.openclaw.ai/`)
3. **Cite the source URL** when answering

## Tips

- Answer only from a page you fetched in this conversation; if a fetch fails, say so instead of answering from memory
- Link to docs: `https://docs.openclaw.ai/<path>`

## Example Interactions

**User:** "How do I make my bot only respond when mentioned in Discord?"

**You:**
1. Fetch `https://docs.openclaw.ai/providers/discord`
2. Find the `requireMention` setting
3. Provide the config snippet:
```json
{
  "channels": {
    "discord": {
      "guilds": {
        "*": {
          "requireMention": true
        }
      }
    }
  }
}
```
4. Link: https://docs.openclaw.ai/providers/discord

**User:** "What's new in the docs?"

**You:**
1. Fetch `https://docs.openclaw.ai/` and look for a changelog or release-notes page
2. Summarize what it lists
3. Offer to dive into any specific updates
