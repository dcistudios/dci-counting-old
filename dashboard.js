const express = require('express');

const RESERVED_KEYS = new Set([
    'globalUsers', 'globalLeaderboard', 'flags', 'blacklist',
    'admins', 'extraOwners', 'globalBlacklist', 'globalLockdown',
    'blockMath', 'antiAlt'
]);

module.exports = function startDashboard(client) {
    const app = express();
    app.use(express.json());

    const TOKEN = process.env.DASHBOARD_TOKEN || 'changeme';
    function auth(req, res, next) {
        const ip = req.ip || req.connection.remoteAddress;
        if (ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1') return next();
        const t = req.headers['x-token'] || req.query.token;
        if (t !== TOKEN) return res.status(401).json({ error: 'Unauthorized' });
        next();
    }

    const usernameCache = new Map();
    const guildNameCache = new Map();

    async function resolveUsername(userId) {
        if (usernameCache.has(userId)) return usernameCache.get(userId);
        try {
            const user = await client.users.fetch(userId);
            usernameCache.set(userId, user.username);
            return user.username;
        } catch {
            usernameCache.set(userId, null);
            return null;
        }
    }

    async function resolveGuildName(guildId) {
        if (guildNameCache.has(guildId)) return guildNameCache.get(guildId);
        try {
            const guild = await client.guilds.fetch(guildId);
            guildNameCache.set(guildId, guild.name);
            return guild.name;
        } catch {
            guildNameCache.set(guildId, null);
            return null;
        }
    }

    const logBuffer = [];
    const MAX_LOGS = 200;
    function pushLog(level, msg) {
        logBuffer.push({ ts: new Date().toISOString(), level, msg });
        if (logBuffer.length > MAX_LOGS) logBuffer.shift();
    }
    const _log = console.log.bind(console);
    const _warn = console.warn.bind(console);
    const _error = console.error.bind(console);
    console.log   = (...a) => { _log(...a);   pushLog('info',  a.join(' ')); };
    console.warn  = (...a) => { _warn(...a);  pushLog('warn',  a.join(' ')); };
    console.error = (...a) => { _error(...a); pushLog('error', a.join(' ')); };

    // ── GET /stats ────────────────────────────────────────────────────────
    app.get('/stats', auth, async (req, res) => {
        const globalUsers   = client.config.globalUsers || {};
        const globalLB      = client.config.globalLeaderboard || {};
        const flags         = client.config.flags || {};
        const totalCounts   = Object.values(globalUsers).reduce((s, u) => s + (u.totalCounts || 0), 0);
        const uptimeSeconds = Math.floor(client.uptime / 1000);

        const guildEntries = Object.entries(client.config)
            .filter(([, v]) => typeof v === 'object' && v !== null && ('currentCount' in v || 'channelId' in v) && !RESERVED_KEYS.has(v));

        const guilds = await Promise.all(guildEntries.map(async ([guildId, data]) => {
            const lbName      = globalLB[guildId]?.name;
            const resolvedName = lbName || await resolveGuildName(guildId) || guildId;
            return {
                guildId,
                name:         resolvedName,
                currentCount: data.currentCount ?? 0,
                bestStreak:   data.bestStreak   ?? 0,
                streak:       data.streak       ?? 0,
                isPremium:    data.isPremium     || false,
                tags:         data.tags          || [],
                saves:        data.saves         ?? 0,
                maxSaves:     data.maxSaves      ?? 3,
                channelId:    data.channelId     || null,
                goal:         data.goal          || null,
                memberCount:  client.guilds.cache.get(guildId)?.memberCount || null,
            };
        }));

        const users = await Promise.all(
            Object.entries(globalUsers)
                .sort(([,a],[,b]) => b.totalCounts - a.totalCounts)
                .map(async ([userId, data]) => {
                    const username = await resolveUsername(userId);
                    return { userId, username, ...data };
                })
        );

        res.json({
            bot: {
                tag:        client.user.tag,
                id:         client.user.id,
                avatar:     client.user.displayAvatarURL(),
                guilds:     client.guilds.cache.size,
                ping:       client.ws.ping,
                uptime:     uptimeSeconds,
                version:    'v2.2 Beta',
                flagged:    Object.keys(flags).length,
                totalCounts,
            },
            guilds,
            users,
        });
    });

    app.get('/flags', auth, async (req, res) => {
        const flags = client.config.flags || {};
        const result = await Promise.all(Object.entries(flags).map(async ([userId, entries]) => {
            const username = await resolveUsername(userId);
            return { userId, username, count: entries.length, recent: entries.slice(-5) };
        }));
        res.json(result);
    });

    app.get('/logs', auth, (req, res) => {
        const since = parseInt(req.query.since || '0');
        res.json(logBuffer.slice(since));
    });

    app.post('/exec', auth, async (req, res) => {
        const { command, args = {} } = req.body || {};
        if (!command || typeof command !== 'string') {
            return res.status(400).json({ error: 'command required' });
        }

        const commands = {
            ping: async () => 'pong',
            getUptime: async () => process.uptime(),
            getMemoryUsage: async () => process.memoryUsage(),
            getLogCount: async () => logBuffer.length
        };

        const handler = commands[command];
        if (!handler) {
            return res.status(400).json({ error: 'Unknown command' });
        }

        try {
            const result = await handler(args);
            res.json({ ok: true, result: require('util').inspect(result, { depth: 3 }) });
        } catch (e) {
            res.json({ ok: false, error: e.message });
        }
    });

    app.post('/clearflags', auth, (req, res) => {
        const { userId } = req.body;
        if (!userId) return res.status(400).json({ error: 'userId required' });
        if (!client.config.flags?.[userId]) return res.status(404).json({ error: 'No flags found' });
        delete client.config.flags[userId];
        client.saveConfig();
        res.json({ ok: true, message: `Flags cleared for ${userId}` });
    });

    app.post('/setpremium', auth, (req, res) => {
        const { guildId, value } = req.body;
        if (!guildId) return res.status(400).json({ error: 'guildId required' });
        if (!client.config[guildId]) client.config[guildId] = { currentCount: 0 };
        client.config[guildId].isPremium = value !== false;
        client.saveConfig();
        res.json({ ok: true, guildId, isPremium: client.config[guildId].isPremium });
    });

    app.post('/setnumber', auth, (req, res) => {
        const { guildId, number } = req.body;
        if (!guildId || number === undefined) return res.status(400).json({ error: 'guildId and number required' });
        if (!client.config[guildId]) return res.status(404).json({ error: 'Guild not found' });
        client.config[guildId].currentCount = parseInt(number, 10);
        client.saveConfig();
        res.json({ ok: true, guildId, currentCount: client.config[guildId].currentCount });
    });

    app.post('/resetcount', auth, (req, res) => {
        const { guildId } = req.body;
        if (!guildId) return res.status(400).json({ error: 'guildId required' });
        if (!client.config[guildId]) return res.status(404).json({ error: 'Guild not found' });
        client.config[guildId].currentCount = 0;
        client.config[guildId].lastCounter  = null;
        client.config[guildId].streak       = 0;
        client.config[guildId].saves        = 0;
        client.saveConfig();
        res.json({ ok: true, guildId });
    });

    app.post('/announce', auth, async (req, res) => {
        const { guildId, message } = req.body;
        if (!guildId || !message) return res.status(400).json({ error: 'guildId and message required' });
        const channelId = client.config[guildId]?.channelId;
        if (!channelId) return res.status(404).json({ error: 'No counting channel set' });
        try {
            const channel = await client.channels.fetch(channelId);
            await channel.send(message);
            res.json({ ok: true });
        } catch(e) { res.status(500).json({ error: e.message }); }
    });

    app.post('/blacklist', auth, (req, res) => {
        const { userId, remove } = req.body;
        if (!userId) return res.status(400).json({ error: 'userId required' });
        if (!client.config.blacklist) client.config.blacklist = [];
        if (remove) {
            client.config.blacklist = client.config.blacklist.filter(id => id !== userId);
        } else {
            if (!client.config.blacklist.includes(userId)) client.config.blacklist.push(userId);
        }
        client.saveConfig();
        res.json({ ok: true });
    });

    app.post('/clearcache', auth, (req, res) => {
        usernameCache.clear();
        guildNameCache.clear();
        res.json({ ok: true, message: 'Name cache cleared' });
    });

    // ── POST /changelog ───────────────────────────────────────────────────
    app.post('/changelog', auth, async (req, res) => {
        const { title, version, changes, guildIds, color, pingEveryone } = req.body;
        if (!title || !changes?.length) return res.status(400).json({ error: 'title and changes required' });

        const { EmbedBuilder } = require('discord.js');

        const colorMap = {
            blue:   '#38bdf8',
            green:  '#22c55e',
            yellow: '#fbbf24',
            red:    '#ef4444',
            purple: '#a855f7',
            gold:   '#f59e0b',
        };

        const embed = new EmbedBuilder()
            .setTitle(`📋 ${title}`)
            .setDescription(changes.map(c => `• ${c}`).join('\n'))
            .setColor(colorMap[color] || '#38bdf8')
            .setFooter({ text: `DCI Counting ${version}|| 'v2.2 Beta'} • Changelog`, iconURL: client.user.displayAvatarURL() })
            .setTimestamp();

        const targets = guildIds?.length
            ? guildIds
            : Object.entries(client.config)
                .filter(([k, v]) => !RESERVED_KEYS.has(k) && typeof v === 'object' && v?.channelId)
                .map(([k]) => k);

        const results = { sent: [], failed: [] };
        for (const guildId of targets) {
            const channelId = client.config[guildId]?.channelId;
            if (!channelId) { results.failed.push({ guildId, reason: 'No channel set' }); continue; }
            try {
                const channel = await client.channels.fetch(channelId);
                await channel.send({
                    content: pingEveryone ? '@everyone' : undefined,
                    embeds:  [embed],
                });
                results.sent.push(guildId);
            } catch(e) {
                results.failed.push({ guildId, reason: e.message });
            }
        }

        res.json({ ok: true, sent: results.sent.length, failed: results.failed.length, details: results });
    });

    // ── HTML ──────────────────────────────────────────────────────────────
    app.get('/', (req, res) => {
        res.send(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>DCI Counting — Dashboard</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{background:#0f172a;color:#e2e8f0;font-family:'Segoe UI',sans-serif;display:flex;min-height:100vh}
.sidebar{width:220px;min-height:100vh;background:#0a1120;border-right:1px solid #1e293b;display:flex;flex-direction:column;padding:1.5rem 1rem;gap:0.25rem;position:fixed;top:0;left:0;bottom:0;overflow-y:auto}
.logo{font-size:1.05rem;font-weight:700;color:#38bdf8;margin-bottom:1rem;display:flex;align-items:center;gap:0.5rem}
.logo img{width:32px;height:32px;border-radius:50%;object-fit:cover}
.nav-item{padding:0.6rem 0.75rem;border-radius:7px;cursor:pointer;font-size:0.875rem;color:#94a3b8;display:flex;align-items:center;gap:0.6rem;transition:all 0.15s;user-select:none}
.nav-item:hover{background:#1e293b;color:#e2e8f0}
.nav-item.active{background:#1e3a5f;color:#38bdf8;font-weight:600}
.nav-section{font-size:0.65rem;text-transform:uppercase;letter-spacing:0.08em;color:#475569;margin:0.75rem 0 0.25rem 0.75rem}
.sidebar-footer{margin-top:auto;font-size:0.72rem;color:#334155;padding:0.5rem;line-height:1.6}
.main{margin-left:220px;flex:1;padding:2rem;max-width:calc(100vw - 220px)}
.page{display:none}.page.active{display:block}
h2{color:#e2e8f0;font-size:1.2rem;margin-bottom:1.25rem;display:flex;align-items:center;gap:0.5rem}
h3{color:#94a3b8;font-size:0.9rem;margin:1.5rem 0 0.75rem;text-transform:uppercase;letter-spacing:0.05em}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:1rem;margin-bottom:2rem}
.card{background:#1e293b;border-radius:10px;padding:1.25rem;border:1px solid #263148}
.card .label{font-size:0.7rem;color:#64748b;text-transform:uppercase;letter-spacing:0.05em}
.card .value{font-size:1.5rem;font-weight:700;color:#38bdf8;margin-top:0.25rem}
.card .sub{font-size:0.7rem;color:#475569;margin-top:0.2rem}
.search-bar{width:100%;background:#1e293b;border:1px solid #334155;color:#e2e8f0;padding:0.6rem 1rem;border-radius:8px;font-size:0.875rem;margin-bottom:0.75rem;outline:none;transition:border 0.15s}
.search-bar:focus{border-color:#38bdf8}
table{width:100%;border-collapse:collapse;background:#1e293b;border-radius:10px;overflow:hidden;margin-bottom:1rem}
th{background:#0d1829;padding:0.7rem 1rem;text-align:left;font-size:0.7rem;text-transform:uppercase;color:#64748b;letter-spacing:0.05em}
td{padding:0.7rem 1rem;border-top:1px solid #0f172a;font-size:0.85rem;vertical-align:middle}
tr:hover td{background:#1d3248;cursor:pointer}
tr.selected td{background:#1a3a5c}
.no-results{text-align:center;color:#475569;padding:2rem;font-size:0.875rem}
.count-badge{display:inline-block;background:#0f172a;border-radius:4px;padding:0.1rem 0.4rem;font-size:0.7rem;color:#64748b;margin-left:0.4rem}
.badge{display:inline-block;padding:0.2rem 0.5rem;border-radius:4px;font-size:0.7rem;font-weight:600}
.badge.premium{background:#854d0e;color:#fde68a}
.badge.free{background:#1e293b;color:#64748b;border:1px solid #334155}
.badge.flagged{background:#7f1d1d;color:#fca5a5}
.avatar{width:24px;height:24px;border-radius:50%;margin-right:0.5rem;vertical-align:middle;background:#334155;object-fit:cover}
.username{display:flex;align-items:center}
.panel{background:#1e293b;border-radius:10px;padding:1.5rem;margin-bottom:1.5rem;border:1px solid #263148}
.panel-hint{font-size:0.75rem;color:#64748b;margin-bottom:1.25rem}
.action-row{display:flex;gap:0.5rem;flex-wrap:wrap;align-items:center;margin-bottom:0.75rem}
.action-row:last-child{margin-bottom:0}
.field{background:#0f172a;border:1px solid #334155;color:#e2e8f0;padding:0.5rem 0.75rem;border-radius:6px;font-size:0.85rem;outline:none;transition:border 0.15s}
.field:focus{border-color:#38bdf8}
.field.wide{width:220px}.field.narrow{width:110px}.field.msg{flex:1;min-width:200px}
select.field{cursor:pointer}
.btn{padding:0.5rem 1rem;border-radius:6px;border:none;cursor:pointer;font-size:0.82rem;font-weight:600;transition:opacity 0.15s;white-space:nowrap}
.btn:hover{opacity:0.82}
.btn.danger{background:#dc2626;color:#fff}
.btn.primary{background:#0284c7;color:#fff}
.btn.success{background:#16a34a;color:#fff}
.btn.warn{background:#d97706;color:#fff}
.btn.ghost{background:#1e293b;color:#94a3b8;border:1px solid #334155}
.btn.purple{background:#7c3aed;color:#fff}
.selected-hint{font-size:0.75rem;color:#38bdf8}
.divider{border:none;border-top:1px solid #263148;margin:1.25rem 0}
.status-line{font-size:0.8rem;margin-top:0.75rem;min-height:1rem}

/* Changelog */
.cl-grid{display:grid;grid-template-columns:1fr 1fr;gap:1.5rem}
@media(max-width:900px){.cl-grid{grid-template-columns:1fr}}
.cl-form{display:flex;flex-direction:column;gap:0.75rem}
.cl-preview-box{background:#020617;border-radius:10px;border:1px solid #1e293b;padding:1.25rem;display:flex;flex-direction:column;gap:0.5rem;min-height:200px}
.cl-preview-title{font-size:1rem;font-weight:700;margin-bottom:0.25rem}
.cl-preview-change{font-size:0.85rem;color:#94a3b8;line-height:1.6}
.cl-preview-footer{font-size:0.72rem;color:#334155;margin-top:auto;padding-top:0.75rem;border-top:1px solid #1e293b}
.cl-color-row{display:flex;gap:0.5rem;flex-wrap:wrap;align-items:center}
.cl-color-btn{width:28px;height:28px;border-radius:50%;border:3px solid transparent;cursor:pointer;transition:border 0.15s;flex-shrink:0}
.cl-color-btn.active{border-color:#fff}
.guild-select-list{max-height:180px;overflow-y:auto;background:#0f172a;border:1px solid #334155;border-radius:6px;padding:0.5rem}
.guild-select-item{display:flex;align-items:center;gap:0.5rem;padding:0.4rem 0.5rem;border-radius:5px;cursor:pointer;font-size:0.82rem}
.guild-select-item:hover{background:#1e293b}
.guild-select-item input[type=checkbox]{accent-color:#38bdf8;width:14px;height:14px}

/* Terminal */
.terminal{background:#020617;border-radius:10px;padding:1rem;font-family:'Cascadia Code','Fira Code',monospace;font-size:0.8rem;border:1px solid #1e293b}
.term-output{height:380px;overflow-y:auto;margin-bottom:0.75rem;display:flex;flex-direction:column;gap:0.15rem}
.term-line{display:flex;gap:0.75rem;line-height:1.6}
.term-line .ts{color:#1e293b;flex-shrink:0;font-size:0.72rem;padding-top:0.1rem}
.term-line.info .msg{color:#94a3b8}
.term-line.warn .msg{color:#fbbf24}
.term-line.error .msg{color:#f87171}
.term-line.exec .msg{color:#34d399}
.term-line.result .msg{color:#a78bfa;white-space:pre-wrap}
.term-input-row{display:flex;gap:0.5rem;align-items:center;border-top:1px solid #1e293b;padding-top:0.75rem}
.term-prompt{color:#38bdf8;flex-shrink:0}
.term-input{flex:1;background:transparent;border:none;outline:none;color:#e2e8f0;font-family:inherit;font-size:inherit}
</style>
</head>
<body>

<nav class="sidebar">
    <div class="logo">
        <img id="bot-avatar" src="" onerror="this.style.display='none'">
        DCI Counting
    </div>
    <div class="nav-section">Overview</div>
    <div class="nav-item active" data-page="overview">📊 Dashboard</div>
    <div class="nav-item" data-page="guilds">🌐 Guilds</div>
    <div class="nav-item" data-page="users">👤 Users</div>
    <div class="nav-item" data-page="flags">🚨 Flags</div>
    <div class="nav-section">Tools</div>
    <div class="nav-item" data-page="actions">⚙️ Actions</div>
    <div class="nav-item" data-page="changelog">📋 Changelog</div>
    <div class="nav-item" data-page="terminal">💻 Terminal</div>
    <div class="sidebar-footer" id="bot-tag">Connecting...</div>
</nav>

<main class="main">

<!-- Overview -->
<div class="page active" id="page-overview">
    <h2>📊 Dashboard</h2>
    <div class="grid">
        <div class="card"><div class="label">Servers</div><div class="value" id="s-guilds">—</div></div>
        <div class="card"><div class="label">Total Counts</div><div class="value" id="s-counts">—</div></div>
        <div class="card"><div class="label">Flagged Users</div><div class="value" id="s-flags">—</div></div>
        <div class="card"><div class="label">Ping</div><div class="value" id="s-ping">—</div></div>
        <div class="card"><div class="label">Uptime</div><div class="value" id="s-uptime">—</div><div class="sub" id="s-uptime-sub"></div></div>
    </div>
    <h2>🏆 Top Servers</h2>
    <table><thead><tr><th>#</th><th>Server</th><th>Count</th><th>Best Streak</th><th>Tier</th></tr></thead><tbody id="top-guilds-tbody"></tbody></table>
    <h2>👤 Top Users</h2>
    <table><thead><tr><th>#</th><th>User</th><th>Total Counts</th><th>Best Streak</th><th>Tags</th></tr></thead><tbody id="top-users-tbody"></tbody></table>
</div>

<!-- Guilds -->
<div class="page" id="page-guilds">
    <h2>🌐 Guilds <span class="count-badge" id="guild-count"></span></h2>
    <input class="search-bar" id="guild-search" placeholder="🔍  Search by name or Guild ID..." oninput="filterGuilds()">
    <table><thead><tr><th>Server</th><th>Guild ID</th><th>Members</th><th>Count</th><th>Streak</th><th>Best</th><th>Tier</th><th>Goal</th></tr></thead><tbody id="guild-tbody"></tbody></table>
</div>

<!-- Users -->
<div class="page" id="page-users">
    <h2>👤 Users <span class="count-badge" id="user-count"></span></h2>
    <input class="search-bar" id="user-search" placeholder="🔍  Search by username or User ID..." oninput="filterUsers()">
    <table><thead><tr><th>#</th><th>User</th><th>User ID</th><th>Total Counts</th><th>Best Streak</th><th>Tags</th></tr></thead><tbody id="user-tbody"></tbody></table>
</div>

<!-- Flags -->
<div class="page" id="page-flags">
    <h2>🚨 Flagged Users <span class="count-badge" id="flag-count"></span></h2>
    <input class="search-bar" id="flag-search" placeholder="🔍  Search by username or User ID..." oninput="filterFlags()">
    <table><thead><tr><th>User</th><th>User ID</th><th>Flags</th><th>Most Recent Incident</th></tr></thead><tbody id="flag-tbody"></tbody></table>
</div>

<!-- Actions -->
<div class="page" id="page-actions">
    <h2>⚙️ Owner Actions</h2>
    <div class="panel">
        <div class="panel-hint">Click a guild or user row in any table to auto-fill IDs below.</div>
        <h3>Guild Actions</h3>
        <div class="action-row">
            <input id="a-guild" class="field wide" placeholder="Guild ID">
            <span class="selected-hint" id="guild-hint"></span>
        </div>
        <div class="action-row">
            <input id="a-num" class="field narrow" placeholder="Number" type="number">
            <button class="btn primary" onclick="guildAction('/setnumber',  { guildId: gi(), number: parseInt(v('a-num')) })">Set Number</button>
            <button class="btn danger"  onclick="guildAction('/resetcount', { guildId: gi() })">Reset Count</button>
            <button class="btn success" onclick="guildAction('/setpremium', { guildId: gi(), value: true })">Grant Premium</button>
            <button class="btn warn"    onclick="guildAction('/setpremium', { guildId: gi(), value: false })">Revoke Premium</button>
        </div>
        <div class="action-row">
            <input id="a-msg" class="field msg" placeholder="Announcement (sends to counting channel)">
            <button class="btn primary" onclick="guildAction('/announce', { guildId: gi(), message: v('a-msg') })">Send to Channel</button>
        </div>
        <hr class="divider">
        <h3>User Actions</h3>
        <div class="action-row">
            <input id="a-user" class="field wide" placeholder="User ID">
            <span class="selected-hint" id="user-hint"></span>
        </div>
        <div class="action-row">
            <button class="btn danger"  onclick="userAction('/clearflags', { userId: ui() })">Clear Flags</button>
            <button class="btn danger"  onclick="userAction('/blacklist',  { userId: ui() })">Blacklist User</button>
            <button class="btn success" onclick="userAction('/blacklist',  { userId: ui(), remove: true })">Unblacklist</button>
        </div>
        <hr class="divider">
        <h3>System</h3>
        <div class="action-row">
            <button class="btn ghost" onclick="doPost('/clearcache', {}).then(() => setStatus('✅ Cache cleared', true))">🔄 Clear Name Cache</button>
            <button class="btn ghost" onclick="load()">🔃 Force Refresh</button>
        </div>
        <div class="status-line" id="status"></div>
    </div>
</div>

<!-- Changelog -->
<div class="page" id="page-changelog">
    <h2>📋 Changelog Sender</h2>
    <div class="panel">
        <div class="cl-grid">
            <!-- Form -->
            <div class="cl-form">
                <div>
                    <div style="font-size:0.75rem;color:#64748b;margin-bottom:0.4rem">Title</div>
                    <input id="cl-title" class="field" style="width:100%" placeholder="e.g. New Features & Fixes" oninput="updatePreview()">
                </div>
                <div style="display:flex;gap:0.75rem">
                    <div style="flex:1">
                        <div style="font-size:0.75rem;color:#64748b;margin-bottom:0.4rem">Version</div>
                        <select id="cl-version" class="field" style="width:100%" onchange="updatePreview()">
                            <option value="v2.2 Beta">v2.2 Beta (current)</option>
                            <option value="v2.3 Beta">v2.3 Beta</option>
                            <option value="v2.4 Beta">v2.4 Beta</option>
                            <option value="v3.0">v3.0</option>
                            <option value="custom">Custom...</option>
                        </select>
                    </div>
                    <div id="cl-custom-wrap" style="flex:1;display:none">
                        <div style="font-size:0.75rem;color:#64748b;margin-bottom:0.4rem">Custom Version</div>
                        <input id="cl-version-custom" class="field" style="width:100%" placeholder="e.g. v2.5 RC1" oninput="updatePreview()">
                    </div>
                </div>
                <div>
                    <div style="font-size:0.75rem;color:#64748b;margin-bottom:0.4rem">Changes <span style="color:#334155">(one per line)</span></div>
                    <textarea id="cl-changes" class="field" style="width:100%;resize:vertical;min-height:130px;font-family:'Segoe UI',sans-serif;line-height:1.6"
                        placeholder="Added /leaderboard command&#10;Fixed streak reset bug&#10;Premium saves now configurable"
                        oninput="updatePreview()"></textarea>
                </div>
                <div>
                    <div style="font-size:0.75rem;color:#64748b;margin-bottom:0.4rem">Embed Color</div>
                    <div class="cl-color-row" id="cl-colors">
                        <div class="cl-color-btn active" data-color="blue"   style="background:#38bdf8" onclick="setColor('blue',this)"   title="Blue"></div>
                        <div class="cl-color-btn"        data-color="green"  style="background:#22c55e" onclick="setColor('green',this)"  title="Green"></div>
                        <div class="cl-color-btn"        data-color="yellow" style="background:#fbbf24" onclick="setColor('yellow',this)" title="Yellow"></div>
                        <div class="cl-color-btn"        data-color="red"    style="background:#ef4444" onclick="setColor('red',this)"    title="Red"></div>
                        <div class="cl-color-btn"        data-color="purple" style="background:#a855f7" onclick="setColor('purple',this)" title="Purple"></div>
                        <div class="cl-color-btn"        data-color="gold"   style="background:#f59e0b" onclick="setColor('gold',this)"   title="Gold"></div>
                    </div>
                </div>
                <div>
                    <div style="font-size:0.75rem;color:#64748b;margin-bottom:0.4rem">Target Guilds</div>
                    <div style="display:flex;gap:0.5rem;margin-bottom:0.5rem">
                        <button class="btn ghost" style="font-size:0.75rem;padding:0.3rem 0.6rem" onclick="selectAllGuilds(true)">Select All</button>
                        <button class="btn ghost" style="font-size:0.75rem;padding:0.3rem 0.6rem" onclick="selectAllGuilds(false)">Deselect All</button>
                        <span style="font-size:0.75rem;color:#64748b;align-self:center" id="cl-selected-count">0 selected</span>
                    </div>
                    <div class="guild-select-list" id="guild-select-list">
                        <div style="color:#475569;font-size:0.8rem;padding:0.5rem">Loading guilds...</div>
                    </div>
                </div>
                <div style="display:flex;align-items:center;gap:0.75rem">
                    <label style="display:flex;align-items:center;gap:0.5rem;cursor:pointer;font-size:0.85rem">
                        <input type="checkbox" id="cl-ping" style="accent-color:#38bdf8;width:14px;height:14px">
                        @everyone ping
                    </label>
                </div>
                <div style="display:flex;gap:0.5rem">
                    <button class="btn primary" style="flex:1" onclick="sendChangelog()">📤 Send Changelog</button>
                </div>
                <div class="status-line" id="cl-status"></div>
            </div>

            <!-- Preview -->
            <div>
                <div style="font-size:0.75rem;color:#64748b;margin-bottom:0.5rem">Live Preview</div>
                <div class="cl-preview-box" id="cl-preview-box">
                    <div style="color:#1e293b;font-size:0.8rem;text-align:center;margin:auto">Fill in the form to see a preview</div>
                </div>
                <div style="font-size:0.72rem;color:#475569;margin-top:0.5rem">* Preview is approximate. Discord renders embeds slightly differently.</div>
            </div>
        </div>
    </div>
</div>

<!-- Terminal -->
<div class="page" id="page-terminal">
    <h2>💻 Terminal</h2>
    <div class="terminal">
        <div class="term-output" id="term-output"></div>
        <div class="term-input-row">
            <span class="term-prompt">dci &gt;</span>
            <input class="term-input" id="term-input" placeholder="type 'help' or eval JS..." autocomplete="off" onkeydown="termKeydown(event)">
        </div>
    </div>
</div>

</main>
<script>
const TOKEN = new URLSearchParams(location.search).get('token') || '';
const H = { 'Content-Type': 'application/json', 'x-token': TOKEN };
const v  = id => document.getElementById(id).value.trim();
const gi = () => v('a-guild');
const ui = () => v('a-user');

let allGuilds = [], allUsers = [], allFlags = [];
let selectedColor = 'blue';
let termHistory = [], termHistIdx = -1, lastLogIdx = 0, logPoller = null;

const colorMap = { blue:'#38bdf8', green:'#22c55e', yellow:'#fbbf24', red:'#ef4444', purple:'#a855f7', gold:'#f59e0b' };

// ── Nav ───────────────────────────────────────────────────────────────────
document.querySelectorAll('.nav-item').forEach(item => {
    item.addEventListener('click', () => {
        document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
        document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
        document.getElementById('page-' + item.dataset.page).classList.add('active');
        item.classList.add('active');
        if (item.dataset.page === 'terminal') startLogPoll();
        if (item.dataset.page === 'changelog') renderGuildSelectList();
    });
});

// ── API ───────────────────────────────────────────────────────────────────
async function doPost(endpoint, body) {
    const r = await fetch(endpoint + '?token=' + TOKEN, { method: 'POST', headers: H, body: JSON.stringify(body) });
    return r.json();
}

function setStatus(msg, ok, elId = 'status') {
    const el = document.getElementById(elId);
    if (!el) return;
    el.style.color = ok ? '#22c55e' : '#ef4444';
    el.textContent = msg;
    setTimeout(() => el.textContent = '', 5000);
}

async function guildAction(endpoint, body) {
    if (!body.guildId) return setStatus('❌ Enter or select a Guild ID first', false);
    try {
        const d = await doPost(endpoint, body);
        setStatus(d.ok ? '✅ ' + (d.message || 'Done') : '❌ ' + (d.error || 'Failed'), d.ok);
        if (d.ok) load();
    } catch(e) { setStatus('❌ ' + e.message, false); }
}

async function userAction(endpoint, body) {
    if (!body.userId) return setStatus('❌ Enter or select a User ID first', false);
    try {
        const d = await doPost(endpoint, body);
        setStatus(d.ok ? '✅ ' + (d.message || 'Done') : '❌ ' + (d.error || 'Failed'), d.ok);
        if (d.ok) load();
    } catch(e) { setStatus('❌ ' + e.message, false); }
}

// ── Row selection ─────────────────────────────────────────────────────────
function selectGuild(guildId, name) {
    document.getElementById('a-guild').value = guildId;
    document.getElementById('guild-hint').textContent = name !== guildId ? name : '';
    document.querySelectorAll('[data-gid]').forEach(r => r.classList.toggle('selected', r.dataset.gid === guildId));
    document.querySelectorAll('.nav-item').forEach(n => { if (n.dataset.page === 'actions') n.click(); });
}

function selectUser(userId, username) {
    document.getElementById('a-user').value = userId;
    const hint = document.getElementById('user-hint');
    if (hint) hint.textContent = username || '';
    document.querySelectorAll('[data-uid]').forEach(r => r.classList.toggle('selected', r.dataset.uid === userId));
    document.querySelectorAll('.nav-item').forEach(n => { if (n.dataset.page === 'actions') n.click(); });
}

// ── Render helpers ────────────────────────────────────────────────────────
function userCell(userId, username) {
    const av = \`<img class="avatar" src="https://cdn.discordapp.com/embed/avatars/\${Number(userId||0)%6}.png" onerror="this.style.display='none'">\`;
    return \`<div class="username">\${av}<span>\${username
        ? \`<strong>\${username}</strong> <span style="color:#475569;font-size:0.72rem">\${userId}</span>\`
        : \`<span style="color:#64748b">\${userId}</span>\`}</span></div>\`;
}

function guildCell(guildId, name) {
    return name && name !== guildId
        ? \`<strong>\${name}</strong>\`
        : \`<span style="color:#64748b">\${guildId}</span>\`;
}

// ── Tables ────────────────────────────────────────────────────────────────
function renderGuilds(list) {
    const el = document.getElementById('guild-tbody');
    el.innerHTML = list.length ? list.map(g => \`
        <tr data-gid="\${g.guildId}" onclick="selectGuild('\${g.guildId}',\${JSON.stringify(g.name)})">
            <td>\${guildCell(g.guildId, g.name)}</td>
            <td><code style="font-size:0.72rem;color:#475569">\${g.guildId}</code></td>
            <td style="color:#64748b">\${g.memberCount ? g.memberCount.toLocaleString() : '—'}</td>
            <td>\${g.currentCount.toLocaleString()}</td>
            <td>\${g.streak.toLocaleString()}</td>
            <td>\${g.bestStreak.toLocaleString()}</td>
            <td><span class="badge \${g.isPremium?'premium':'free'}">\${g.isPremium?'💎 Premium':'Free'}</span></td>
            <td>\${g.goal ? g.goal.toLocaleString() : '—'}</td>
        </tr>\`).join('')
        : '<tr><td colspan="8" class="no-results">No guilds found</td></tr>';
}

function renderUsers(list) {
    const el = document.getElementById('user-tbody');
    el.innerHTML = list.length ? list.map((u,i) => \`
        <tr data-uid="\${u.userId}" onclick="selectUser('\${u.userId}',\${JSON.stringify(u.username||'')})">
            <td style="color:#64748b">#\${i+1}</td>
            <td>\${userCell(u.userId, u.username)}</td>
            <td><code style="font-size:0.72rem;color:#475569">\${u.userId}</code></td>
            <td>\${(u.totalCounts||0).toLocaleString()}</td>
            <td>\${(u.bestStreak||0).toLocaleString()}</td>
            <td style="color:#64748b;font-size:0.8rem">\${(u.tags||[]).join(', ')||'—'}</td>
        </tr>\`).join('')
        : '<tr><td colspan="6" class="no-results">No users found</td></tr>';
}

function renderFlags(list) {
    const el = document.getElementById('flag-tbody');
    el.innerHTML = list.length ? list.map(f => \`
        <tr data-uid="\${f.userId}" onclick="selectUser('\${f.userId}',\${JSON.stringify(f.username||'')})">
            <td>\${userCell(f.userId, f.username)}</td>
            <td><code style="font-size:0.72rem;color:#475569">\${f.userId}</code></td>
            <td><span class="badge flagged">\${f.count} flag\${f.count!==1?'s':''}</span></td>
            <td style="font-size:0.75rem;color:#94a3b8;max-width:380px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">\${f.recent.slice(-1)[0]||'—'}</td>
        </tr>\`).join('')
        : '<tr><td colspan="4" class="no-results">No flagged users 🎉</td></tr>';
}

function renderTopGuilds(list) {
    document.getElementById('top-guilds-tbody').innerHTML = list.slice(0,10).map((g,i) => \`
        <tr data-gid="\${g.guildId}" onclick="selectGuild('\${g.guildId}',\${JSON.stringify(g.name)})">
            <td style="color:#64748b">#\${i+1}</td>
            <td>\${guildCell(g.guildId, g.name)}</td>
            <td>\${g.currentCount.toLocaleString()}</td>
            <td>\${g.bestStreak.toLocaleString()}</td>
            <td><span class="badge \${g.isPremium?'premium':'free'}">\${g.isPremium?'💎 Premium':'Free'}</span></td>
        </tr>\`).join('');
}

function renderTopUsers(list) {
    document.getElementById('top-users-tbody').innerHTML = list.slice(0,10).map((u,i) => \`
        <tr data-uid="\${u.userId}" onclick="selectUser('\${u.userId}',\${JSON.stringify(u.username||'')})">
            <td style="color:#64748b">#\${i+1}</td>
            <td>\${userCell(u.userId, u.username)}</td>
            <td>\${(u.totalCounts||0).toLocaleString()}</td>
            <td>\${(u.bestStreak||0).toLocaleString()}</td>
            <td style="color:#64748b;font-size:0.8rem">\${(u.tags||[]).join(', ')||'—'}</td>
        </tr>\`).join('');
}

function filterGuilds() {
    const q = v('guild-search').toLowerCase();
    renderGuilds(q ? allGuilds.filter(g => g.name.toLowerCase().includes(q) || g.guildId.includes(q)) : allGuilds);
}
function filterUsers() {
    const q = v('user-search').toLowerCase();
    renderUsers(q ? allUsers.filter(u => (u.username||'').toLowerCase().includes(q) || u.userId.includes(q)) : allUsers);
}
function filterFlags() {
    const q = v('flag-search').toLowerCase();
    renderFlags(q ? allFlags.filter(f => (f.username||'').toLowerCase().includes(q) || f.userId.includes(q)) : allFlags);
}

// ── Load ──────────────────────────────────────────────────────────────────
async function load() {
    try {
        const [stats, flags] = await Promise.all([
            fetch('/stats?token=' + TOKEN).then(r => r.json()),
            fetch('/flags?token=' + TOKEN).then(r => r.json()),
        ]);

        if (stats.bot.avatar) document.getElementById('bot-avatar').src = stats.bot.avatar;
        document.getElementById('bot-tag').textContent = stats.bot.tag + '\\n' + stats.bot.version;
        document.getElementById('s-guilds').textContent = stats.bot.guilds;
        document.getElementById('s-counts').textContent = stats.bot.totalCounts.toLocaleString();
        document.getElementById('s-flags').textContent  = stats.bot.flagged;
        document.getElementById('s-ping').textContent   = stats.bot.ping + 'ms';
        const u = stats.bot.uptime;
        document.getElementById('s-uptime').textContent     = Math.floor(u/3600) + 'h ' + Math.floor((u%3600)/60) + 'm';
        document.getElementById('s-uptime-sub').textContent = Math.floor(u%60) + 's';

        allGuilds = stats.guilds.sort((a,b) => b.currentCount - a.currentCount);
        allUsers  = stats.users;
        allFlags  = flags.sort((a,b) => b.count - a.count);

        document.getElementById('guild-count').textContent = allGuilds.length;
        document.getElementById('user-count').textContent  = allUsers.length;
        document.getElementById('flag-count').textContent  = allFlags.length;

        renderTopGuilds(allGuilds);
        renderTopUsers(allUsers);
        filterGuilds();
        filterUsers();
        filterFlags();
    } catch(e) { console.error('Load failed:', e.message); }
}

// ── Changelog ─────────────────────────────────────────────────────────────
function setColor(color, el) {
    selectedColor = color;
    document.querySelectorAll('.cl-color-btn').forEach(b => b.classList.remove('active'));
    el.classList.add('active');
    updatePreview();
}

document.getElementById('cl-version').addEventListener('change', function() {
    document.getElementById('cl-custom-wrap').style.display = this.value === 'custom' ? 'block' : 'none';
    updatePreview();
});

function getVersion() {
    const sel = document.getElementById('cl-version').value;
    return sel === 'custom' ? v('cl-version-custom') || 'v?.?' : sel;
}

function updatePreview() {
    const title   = v('cl-title');
    const version = getVersion();
    const changes = document.getElementById('cl-changes').value
        .split('\\n').map(l => l.trim()).filter(Boolean);
    const color   = colorMap[selectedColor] || '#38bdf8';
    const box     = document.getElementById('cl-preview-box');

    if (!title && !changes.length) {
        box.innerHTML = '<div style="color:#1e293b;font-size:0.8rem;text-align:center;margin:auto">Fill in the form to see a preview</div>';
        return;
    }

    box.style.borderLeft = \`4px solid \${color}\`;
    box.innerHTML = \`
        <div class="cl-preview-title" style="color:\${color}">📋 \${title || 'Untitled'}</div>
        <div class="cl-preview-change">\${changes.length
            ? changes.map(c => \`• \${c}\`).join('<br>')
            : '<span style="color:#334155">No changes yet...</span>'}</div>
        <div class="cl-preview-footer">
            DCI Counting \${version} • Changelog<br>
            <span style="color:#1e293b">Today at \${new Date().toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})}</span>
        </div>\`;
}

function renderGuildSelectList() {
    const list = document.getElementById('guild-select-list');
    if (!allGuilds.length) { list.innerHTML = '<div style="color:#475569;font-size:0.8rem;padding:0.5rem">No guilds loaded yet</div>'; return; }
    list.innerHTML = allGuilds.map(g => \`
        <label class="guild-select-item">
            <input type="checkbox" class="guild-cb" value="\${g.guildId}" checked onchange="updateSelectedCount()">
            <span>\${g.name !== g.guildId ? \`<strong>\${g.name}</strong> <span style="color:#475569;font-size:0.72rem">\${g.guildId}</span>\` : g.guildId}</span>
            \${g.isPremium ? '<span class="badge premium" style="margin-left:auto">💎</span>' : ''}
        </label>\`).join('');
    updateSelectedCount();
}

function updateSelectedCount() {
    const total    = document.querySelectorAll('.guild-cb').length;
    const selected = document.querySelectorAll('.guild-cb:checked').length;
    document.getElementById('cl-selected-count').textContent = \`\${selected} / \${total} selected\`;
}

function selectAllGuilds(checked) {
    document.querySelectorAll('.guild-cb').forEach(cb => cb.checked = checked);
    updateSelectedCount();
}

async function sendChangelog() {
    const title   = v('cl-title');
    const version = getVersion();
    const changes = document.getElementById('cl-changes').value
        .split('\\n').map(l => l.trim()).filter(Boolean);
    const guildIds = [...document.querySelectorAll('.guild-cb:checked')].map(cb => cb.value);
    const pingEveryone = document.getElementById('cl-ping').checked;

    if (!title)          return setStatus('❌ Title is required', false, 'cl-status');
    if (!changes.length) return setStatus('❌ Add at least one change', false, 'cl-status');
    if (!guildIds.length) return setStatus('❌ Select at least one guild', false, 'cl-status');

    const ping = pingEveryone ? ' with @everyone ping' : '';
    if (!confirm(\`Send changelog to \${guildIds.length} guild(s)\${ping}?\`)) return;

    setStatus('⏳ Sending...', true, 'cl-status');

    try {
        const d = await doPost('/changelog', { title, version, changes, guildIds, color: selectedColor, pingEveryone });
        if (d.ok) {
            setStatus(\`✅ Sent to \${d.sent} guild(s)\${d.failed ? \` • \${d.failed} failed\` : ''}\`, true, 'cl-status');
            if (d.failed > 0) console.warn('Failures:\\n' + d.details.failed.map(f => \`\${f.guildId}: \${f.reason}\`).join('\\n'));
        } else {
            setStatus('❌ ' + (d.error || 'Failed'), false, 'cl-status');
        }
    } catch(e) { setStatus('❌ ' + e.message, false, 'cl-status'); }
}

// ── Terminal ──────────────────────────────────────────────────────────────
const HELP = \`Commands:
  help       show this message
  clear      clear terminal
  stats      bot stats summary
  guilds     list all guilds
  users      list top users
  flags      list flagged users
  reload     reload dashboard data
  <JS>       server-side eval\`;

function termPrint(msg, type = 'info') {
    const out  = document.getElementById('term-output');
    const line = document.createElement('div');
    line.className = 'term-line ' + type;
    const ts = new Date().toLocaleTimeString();
    line.innerHTML = \`<span class="ts">\${ts}</span><span class="msg">\${String(msg).replace(/</g,'&lt;')}</span>\`;
    out.appendChild(line);
    out.scrollTop = out.scrollHeight;
}

async function termExec(cmd) {
    if (!cmd.trim()) return;
    termHistory.unshift(cmd);
    termHistIdx = -1;
    termPrint('> ' + cmd, 'exec');

    if (cmd === 'help')   return termPrint(HELP);
    if (cmd === 'clear')  return (document.getElementById('term-output').innerHTML = '');
    if (cmd === 'reload') { await load(); return termPrint('✅ Reloaded', 'result'); }
    if (cmd === 'stats')  return termPrint(\`Guilds: \${allGuilds.length} | Users: \${allUsers.length} | Flags: \${allFlags.length}\`, 'result');
    if (cmd === 'guilds') { allGuilds.forEach((g,i) => termPrint(\`#\${i+1} \${g.name} (\${g.guildId}) — \${g.currentCount.toLocaleString()}\`, 'result')); return; }
    if (cmd === 'users')  { allUsers.slice(0,15).forEach((u,i) => termPrint(\`#\${i+1} \${u.username||u.userId} — \${(u.totalCounts||0).toLocaleString()} counts\`, 'result')); return; }
    if (cmd === 'flags')  { if (!allFlags.length) return termPrint('No flagged users', 'result'); allFlags.forEach(f => termPrint(\`\${f.username||f.userId} — \${f.count} flags\`, 'result')); return; }

    try {
        const r = await fetch('/exec?token=' + TOKEN, { method: 'POST', headers: H, body: JSON.stringify({ code: cmd }) });
        const d = await r.json();
        termPrint(d.ok ? d.result : '❌ ' + d.error, d.ok ? 'result' : 'error');
    } catch(e) { termPrint('❌ ' + e.message, 'error'); }
}

function termKeydown(e) {
    const input = document.getElementById('term-input');
    if (e.key === 'Enter') { const val = input.value; input.value = ''; termExec(val); }
    else if (e.key === 'ArrowUp')   { termHistIdx = Math.min(termHistIdx+1, termHistory.length-1); input.value = termHistory[termHistIdx]||''; e.preventDefault(); }
    else if (e.key === 'ArrowDown') { termHistIdx = Math.max(termHistIdx-1, -1); input.value = termHistIdx>=0 ? termHistory[termHistIdx] : ''; e.preventDefault(); }
}

function startLogPoll() {
    if (logPoller) return;
    logPoller = setInterval(async () => {
        if (!document.getElementById('page-terminal').classList.contains('active')) return;
        try {
            const logs = await fetch(\`/logs?token=\${TOKEN}&since=\${lastLogIdx}\`).then(r => r.json());
            logs.forEach(l => { termPrint(\`[\${l.level.toUpperCase()}] \${l.msg}\`, l.level); lastLogIdx++; });
        } catch {}
    }, 2000);
}

load();
setInterval(load, 20000);
</script>
</body>
</html>`);
    });

    app.listen(8080, () => console.log('📊 Dashboard running on http://localhost:put-port-here'));
};
