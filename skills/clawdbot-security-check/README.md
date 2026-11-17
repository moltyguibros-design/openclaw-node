# OpenClaw Security Check

🔒 **Self-security audit framework for OpenClaw**

Inspired by the security hardening framework from [ᴅᴀɴɪᴇʟ ᴍɪᴇssʟᴇʀ](https://x.com/DanielMiessler) and integrated with [official OpenClaw security documentation](https://docs.openclaw.ai/gateway/security).

This skill teaches OpenClaw to audit its own security posture using first-principles reasoning. Not a hard-coded script—it's a **knowledge framework** that OpenClaw applies dynamically to detect vulnerabilities, understand their impact, and recommend specific remediations.

## What This Is

- 🧠 **Knowledge-based** - Embeds the security framework directly in OpenClaw
- 🔍 **Dynamic detection** - OpenClaw learns to find issues, not just run a script
- 📚 **Extensible** - Add new checks by updating the skill
- 🔒 **100% Read-only** - Only audits; never modifies configuration

## The 12 Security Domains

| # | Domain | Severity | Key Question |
|---|--------|----------|--------------|
| 1 | Gateway Exposure | 🔴 Critical | Is the gateway bound to 0.0.0.0 without auth? |
| 2 | DM Policy | 🟠 High | Are DMs restricted to an allowlist? |
| 3 | Group Access Control | 🟠 High | Are group policies set to allowlist? |
| 4 | Credentials Security | 🔴 Critical | Are secrets in plaintext with loose permissions? |
| 5 | Browser Control Exposure | 🟠 High | Is remote browser control secured? |
| 6 | Gateway Bind & Network | 🟠 High | Is network exposure intentional and controlled? |
| 7 | Tool Access & Elevated | 🟡 Medium | Are tools restricted to minimum needed? |
| 8 | File Permissions & Disk | 🟡 Medium | Are file permissions properly set? |
| 9 | Plugin Trust & Model | 🟡 Medium | Are plugins allowlisted and models current? |
| 10| Logging & Redaction | 🟡 Medium | Is sensitive data redacted in logs? |
| 11| Prompt Injection | 🟡 Medium | Is untrusted content wrapped? |
| 12| Dangerous Commands | 🟡 Medium | Are destructive commands blocked? |

## Installation

```bash
# Through the node's scanner gate
bash skills/openclaw-skill-scanner/install-hook.sh clawdbot-security-check

# Or clone for manual installation
git clone https://github.com/TheSethRose/Clawdbot-Security-Check.git
cp -r Clawdbot-Security-Check ~/.openclaw/workspace/skills/clawdbot-security-check
```

## Usage

### Via the agent
```
audit my security
run security check
what vulnerabilities do I have?
openclaw security audit --deep
```

## Security Principles

Running an AI agent with shell access requires caution. Focus on:

1. **Who can talk to the bot** — DM policies, group allowlists, channel restrictions
2. **Where the bot is allowed to act** — Network exposure, gateway binding, proxy configs
3. **What the bot can touch** — Tool access, file permissions, credential storage

## High-Level Checklist

Treat findings in this priority order:

1. 🔴 Lock down DMs and groups if tools are enabled on open settings
2. 🔴 Fix public network exposure immediately
3. 🟠 Secure browser control with tokens and HTTPS
4. 🟠 Correct file permissions for credentials and config
5. 🟡 Only load trusted plugins
6. 🟡 Use modern models for bots with tool access

## Extending the Framework

Add new checks by contributing to SKILL.md:

```markdown
## 13. New Vulnerability 🟡 Medium

**What to check:** What config reveals this?

**Detection:**
```bash
command-to-check-config
```

**Vulnerability:** What can go wrong?

**Remediation:**
```json
{ "fix": "here" }
```
```

## Architecture

```
Clawdbot-Security-Check/
├── SKILL.md      # Knowledge framework (the skill - source of truth)
├── skill.json    # OpenClaw metadata
├── README.md     # This file
└── .gitignore
```

**SKILL.md** is the source of truth—it teaches OpenClaw everything it needs to know.

## Why This Approach?

Hard-coded scripts get stale. A knowledge framework evolves:

- ✅ Add new vulnerabilities without code changes
- ✅ Customize checks for your environment
- ✅ OpenClaw understands the "why" behind each check
- ✅ Enables intelligent follow-up questions

> "The goal isn't to find vulnerabilities—it's to understand security deeply enough that vulnerabilities can't hide." — Daniel Miessler

## Output Example

```
═══════════════════════════════════════════════════════════════
🔒 OPENCLAW SECURITY AUDIT
═══════════════════════════════════════════════════════════════
Timestamp: 2026-01-26T15:30:00.000Z

┌─ SUMMARY ───────────────────────────────────────────────
│ 🔴 Critical:  1
│ 🟠 High:      2
│ 🟡 Medium:    1
│ ✅ Passed:    8
└────────────────────────────────────────────────────────

┌─ FINDINGS ──────────────────────────────────────────────
│ 🔴 [CRITICAL] Gateway Exposure
│    Finding: Gateway bound to 0.0.0.0:18789 without auth
│    → Fix: Set gateway.auth_token environment variable
│
│ 🟠 [HIGH] DM Policy
│    Finding: dm_policy is "allow" (all users)
│    → Fix: Set dm_policy to "allowlist" with trusted users
└────────────────────────────────────────────────────────

This audit was performed by OpenClaw's self-security framework.
No changes were made to your configuration.
```

## Contributing

1. Fork the repo
2. Add new security knowledge to SKILL.md
3. Submit PR

## License

MIT - Security-first, open source forever.

---

**OpenClaw knows its attack surface. Do you?**
