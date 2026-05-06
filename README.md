# DCI Counting Bot

A feature-rich Discord counting bot with multiple gamemodes, anti-cheat, global leaderboards, premium saves, and a built-in owner dashboard.

---

## Features

- **Counting** — Standard collaborative counting in a designated channel
- **Gamemodes** — Speed, Relay, Reverse, Skip, and Boss Battle
- **Anti-Cheat** — Rate limiting, burst detection, and automatic flagging
- **Saves** — Premium guilds get a configurable number of mistake saves
- **Global Leaderboard** — Cross-server high scores and user stats
- **Tags** — Assign server and user badges (Premium, Partner, Verified, etc.)
- **Goals** — Set a target count with optional celebration messages
- **Owner Dashboard** — Token-protected HTTP dashboard for managing guilds
- **Guild Portal** — Per-server web interface for viewing stats

---

## Requirements

- **Node.js** v18 or higher
- A Discord bot application with the following enabled in the Developer Portal:
  - `MESSAGE CONTENT` intent
  - `SERVER MEMBERS` intent
  - `PRESENCE` intent (optional)

---

## Setup

### 1. Clone the repository

```bash
git clone https://github.com/your-org/dci-counting-bot.git
cd dci-counting-bot
```

### 2. Install dependencies

```bash
npm install
```

### 3. Configure environment variables

Copy the example file and fill in your values:

```bash
cp .env.example .env
```

Open `.env` and set the following:

```env
# Your bot token — from Discord Developer Portal → Bot → Token
TOKEN=your_bot_token_here

# Your application's client ID — Developer Portal → General Information
DISCORD_CLIENT_ID=your_client_id_here

# Your application's client secret (used by the guild portal OAuth flow)
DISCORD_CLIENT_SECRET=your_client_secret_here

# A random secret string to secure the owner dashboard
# Access the dashboard at: http://yourip:yourport?token=DASHBOARD_TOKEN
DASHBOARD_TOKEN=change_this_to_something_random

# A random secret string for Express session signing
SESSION_SECRET=change_this_too
```

> **Never commit your `.env` file.** It is already listed in `.gitignore`.

### 4. Invite your bot

In the Discord Developer Portal, go to **OAuth2 → URL Generator**, select:
- Scopes: `bot`, `applications.commands`
- Bot permissions: `Send Messages`, `Read Message History`, `Add Reactions`, `Manage Messages`, `Embed Links`

Open the generated URL to invite the bot to your server.

### 5. Start the bot

```bash
npm start
```

On startup the bot will:
1. Sync all slash commands globally
2. Log in and print the bot's tag
3. Start the owner dashboard (default port: `3000`)
4. Start the guild portal (default port: `3001`)

---

## Slash Commands

| Command | Description | Permission |
|---|---|---|
| `/setchannel` | Set the counting channel for this server | Administrator |
| `/setgoal` | Set a count goal with an optional celebration message | Administrator |
| `/setnumber` | Manually set the current count | Administrator |
| `/setsaves` | Configure how many saves Premium guilds get | Administrator |
| `/resetscore` | Reset the server's count to 0 | Administrator |
| `/tag-manager` | Assign tags to servers or users | Bot Owner |
| `/countinfo` | View this server's counting stats | Everyone |
| `/serverinfo` | View detailed server information | Everyone |
| `/leaderboard` | View the global server leaderboard | Everyone |
| `/stats` | View your global counting stats | Everyone |
| `/whois` | Look up a user's global profile | Everyone |
| `/ping` | Check the bot's latency | Everyone |
| `/help` | Show a command list | Everyone |
| `/invite` | Get the bot's invite link | Everyone |
| `/premium` | View Premium features | Everyone |
| `/redeem` | Redeem a Premium key | Everyone |
| `/keygen` | Generate a Premium key | Bot Owner |
| `/givaway` | Run a giveaway | Administrator |
| `/integrity` | Run a data integrity check | Administrator |
| `/eval` | Execute JavaScript (bot owner only) | Bot Owner |

---

## Owner Dashboard

The dashboard is a token-protected HTTP API for managing guild configs, viewing flags, and monitoring the bot.

Access it at:

```
http://yourip:3000?token=YOUR_DASHBOARD_TOKEN
```

Requests from `localhost` are automatically trusted without a token.

---

## Data Storage

Guild configs, user stats, leaderboards, and flags are stored in `guild-configs.json` at the project root. This file is auto-created on first run and is excluded from version control via `.gitignore`.

Back up this file regularly if you care about persistent data.

---

## License

MIT — see [LICENSE](LICENSE) for details.
