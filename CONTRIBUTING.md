# Contributing to DCI Counting

Thanks for taking the time to contribute! Here's how to get involved.

---

## Getting Started

1. Fork the repository and clone your fork
2. Install dependencies with `npm install`
3. Copy `.env.example` to `.env` and fill in your bot credentials
4. Run the bot with `npm start`

---

## How to Contribute

### Reporting Bugs

Open an issue and include:
- A clear description of what went wrong
- Steps to reproduce it
- What you expected to happen
- Any relevant error output or logs

### Suggesting Features

Open an issue with the `enhancement` label. Describe what you want and why it would be useful. Check existing issues first to avoid duplicates.

### Submitting a Pull Request

1. Create a new branch from `main`:
   ```bash
   git checkout -b feat/your-feature-name
   ```
2. Make your changes
3. Test locally before pushing
4. Open a pull request against `main` with a clear description of what changed and why

---

## Code Style

- Use `const`/`let`, never `var`
- Keep commands self-contained in their own file under `commands/`
- Keep event logic in `events/`
- Don't commit your `.env` or `guild-configs.json`
- Avoid adding dependencies unless necessary

### Commit Messages

Follow [Conventional Commits](https://www.conventionalcommits.org/):

```
feat: add fibonacci gamemode
fix: prevent double-counting in relay mode
docs: update README setup steps
refactor: extract flagUser helper into utils
```

---

## Adding a Command

1. Create a new file in `commands/` — e.g. `commands/mycommand.js`
2. Export a `data` (SlashCommandBuilder) and `execute` function:

```js
const { SlashCommandBuilder } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('mycommand')
        .setDescription('Does something useful'),

    async execute(interaction, client) {
        await interaction.reply('Hello!');
    }
};
```

3. The command loader in `index.js` will pick it up automatically on next start.

---

## Questions

Open an issue or start a discussion. We'll get back to you.
