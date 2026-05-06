# Security Policy

## Reporting a Vulnerability

**Do not open a public issue for security vulnerabilities.**

If you find a security issue — including authentication bypasses, token exposure, dashboard access flaws, or anti-cheat exploits — please report it privately by emailing:

**it@dcistudios.xyz**

Include as much detail as you can:
- A description of the vulnerability
- Steps to reproduce it
- The potential impact
- Any suggested fix if you have one

You'll get a response within **72 hours**. If the issue is confirmed, a fix will be prioritized and a patched release will be issued before any public disclosure.

---

## Scope

The following are in scope for security reports:

- `index.js` — bot startup and token handling
- `dashboard.js` — owner dashboard authentication
- `guild-portal.js` — per-guild portal access
- `events/messageCreate.js` — anti-cheat and counting logic
- Any command that handles user input or modifies guild config

---

## Known Sensitive Areas

- The dashboard is protected by a token passed via `DASHBOARD_TOKEN` in `.env`. Requests from localhost are trusted without a token — do not expose the dashboard port publicly without a firewall rule.
- `guild-configs.json` stores all user data, flags, and leaderboard info in plaintext. Restrict file system access appropriately on your host.
- The `/eval` command executes arbitrary JavaScript and is restricted to bot owner IDs hardcoded in `commands/eval.js`. If you are self-hosting, verify those IDs are yours before deploying.

---

## Supported Versions

Only the latest release is actively maintained. Older versions will not receive security patches.
