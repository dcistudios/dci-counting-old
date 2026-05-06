const express = require('express');
const session = require('express-session');
const crypto  = require('crypto');
const fetch   = (...args) => import('node-fetch').then(({ default: f }) => f(...args));

const REDIRECT_URI  = 'https://testing.dcicounting.com/callback';
const SCOPES        = 'identify guilds';
const RESERVED_KEYS = new Set([
    'globalUsers', 'globalLeaderboard', 'flags', 'blacklist',
    'admins', 'extraOwners', 'globalBlacklist', 'globalLockdown',
    'blockMath', 'antiAlt'
]);

const GAMEMODES = {
    speed: {
        name:    'Speed Round',
        emoji:   '⚡',
        desc:    'Race to a target number. Fastest time wins a global score.',
        premium: true,
    },
    relay: {
        name:    'Relay',
        emoji:   '🔄',
        desc:    'Each user can only count once per round. Everyone must participate.',
        premium: true,
    },
    boss: {
        name:    'Boss Battle',
        emoji:   '👹',
        desc:    'Count to the boss HP before the timer expires or lose progress.',
        premium: true,
    },
    reverse: {
        name:    'Reverse',
        emoji:   '⬇️',
        desc:    'Count backwards from a set number down to zero.',
        premium: true,
    },
    skip: {
        name:    'Skip Count',
        emoji:   '🦘',
        desc:    'Count by a multiplier — 2s, 5s, or 10s instead of 1s.',
        premium: true,
    },
};

module.exports = function startGuildPortal(client) {
    const app = express();
    app.use(express.json());
    app.use(express.urlencoded({ extended: true }));
    app.use(session({
        secret:            process.env.SESSION_SECRET || 'dci-portal-secret',
        resave:            false,
        saveUninitialized: false,
        cookie:            { secure: false, maxAge: 1000 * 60 * 60 * 24 }
    }));

    const CLIENT_ID     = process.env.DISCORD_CLIENT_ID;
    const CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET;

    // ── Rate limiting ─────────────────────────────────────────────────────
    const rateLimits = new Map();

    function getRateLimit(isPremium) { return isPremium ? 120 : 10; }

    function checkRateLimit(apiKey, isPremium) {
        const now      = Date.now();
        const limit    = getRateLimit(isPremium);
        const existing = rateLimits.get(apiKey);
        if (!existing || now > existing.resetAt) {
            rateLimits.set(apiKey, { count: 1, resetAt: now + 60000 });
            return { allowed: true, remaining: limit - 1, resetAt: now + 60000 };
        }
        if (existing.count >= limit) return { allowed: false, remaining: 0, resetAt: existing.resetAt };
        existing.count++;
        return { allowed: true, remaining: limit - existing.count, resetAt: existing.resetAt };
    }

    // ── Auth middleware ───────────────────────────────────────────────────
    function requireAuth(req, res, next) {
        if (!req.session.user) return res.redirect('/login');
        next();
    }

    function canManageGuild(userGuilds, guildId) {
        const guild = userGuilds.find(g => g.id === guildId);
        if (!guild) return false;
        const perms     = BigInt(guild.permissions);
        const MANAGE    = BigInt(0x20);
        const ADMIN     = BigInt(0x8);
        return (perms & MANAGE) === MANAGE || (perms & ADMIN) === ADMIN;
    }

    // ── API auth middleware ───────────────────────────────────────────────
    function apiAuth(req, res, next) {
        const apiKey = req.headers['x-api-key'] || req.query.api_key;
        if (!apiKey) return res.status(401).json({ error: 'Missing API key. Pass via X-API-Key header or ?api_key= query.' });

        const guildEntry = Object.entries(client.config)
            .find(([k, v]) => !RESERVED_KEYS.has(k) && typeof v === 'object' && v?.apiKey === apiKey);

        if (!guildEntry) return res.status(401).json({ error: 'Invalid API key.' });

        const [guildId, guildData] = guildEntry;
        const isPremium = guildData.isPremium || false;
        const rl        = checkRateLimit(apiKey, isPremium);

        res.setHeader('X-RateLimit-Limit',     getRateLimit(isPremium));
        res.setHeader('X-RateLimit-Remaining', rl.remaining);
        res.setHeader('X-RateLimit-Reset',     Math.ceil(rl.resetAt / 1000));

        if (!rl.allowed) {
            return res.status(429).json({
                error:   'Rate limit exceeded.',
                limit:   getRateLimit(isPremium),
                resetAt: Math.ceil(rl.resetAt / 1000),
                upgrade: !isPremium ? 'Upgrade to premium for 120 req/min.' : undefined,
            });
        }

        req.apiGuildId   = guildId;
        req.apiGuildData = guildData;
        req.isPremium    = isPremium;
        next();
    }

    function premiumOnly(req, res, next) {
        if (!req.isPremium) return res.status(403).json({
            error:   'Premium required.',
            upgrade: 'Contact DCI Studios at https://dcicounting.com/redirect',
        });
        next();
    }

    function freeEndpointCheck(req, res, next) {
        if (req.isPremium) return next();
        const FREE = ['/api/v1/bot', '/api/v1/leaderboard', `/api/v1/guild/${req.apiGuildId}`];
        if (FREE.some(e => req.path === e)) return next();
        return res.status(403).json({
            error:   'Free tier is limited to /bot, /leaderboard, and /guild/:guildId.',
            upgrade: 'Upgrade to premium for all endpoints.',
        });
    }

    // ── OAuth ─────────────────────────────────────────────────────────────
    app.get('/login', (req, res) => {
        const params = new URLSearchParams({
            client_id:     CLIENT_ID,
            redirect_uri:  REDIRECT_URI,
            response_type: 'code',
            scope:         SCOPES,
        });
        res.redirect(`https://discord.com/oauth2/authorize?${params}`);
    });

    app.get('/logout', (req, res) => { req.session.destroy(); res.redirect('/'); });

    app.get('/callback', async (req, res) => {
        const { code } = req.query;
        if (!code) return res.redirect('/');
        try {
            const tokenRes = await fetch('https://discord.com/api/oauth2/token', {
                method:  'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body:    new URLSearchParams({
                    client_id: CLIENT_ID, client_secret: CLIENT_SECRET,
                    grant_type: 'authorization_code', code, redirect_uri: REDIRECT_URI,
                }),
            });
            const tokenData = await tokenRes.json();
            if (!tokenData.access_token) return res.redirect('/error');

            const [userRes, guildsRes] = await Promise.all([
                fetch('https://discord.com/api/users/@me',        { headers: { Authorization: `Bearer ${tokenData.access_token}` } }),
                fetch('https://discord.com/api/users/@me/guilds', { headers: { Authorization: `Bearer ${tokenData.access_token}` } }),
            ]);
            req.session.user   = await userRes.json();
            req.session.guilds = await guildsRes.json();
            req.session.token  = tokenData.access_token;
            res.redirect('/');
        } catch(e) { console.error('OAuth error:', e); res.redirect('/error'); }
    });

    // ── API v1 endpoints ──────────────────────────────────────────────────
    app.get('/api/v1', (req, res) => {
        res.json({
            version: 'v1',
            base:    'https://panel.dcicounting.com/api/v1',
            auth:    'Pass your API key via X-API-Key header or ?api_key= query param.',
            tiers: {
                free:    { requestsPerMinute: 10,  endpoints: ['GET /bot', 'GET /leaderboard', 'GET /guild/:id'] },
                premium: { requestsPerMinute: 120, endpoints: 'All endpoints' },
            },
            endpoints: {
                free:    ['GET /api/v1/bot', 'GET /api/v1/leaderboard', 'GET /api/v1/guild/:guildId'],
                premium: ['GET /api/v1/user/:userId', 'GET /api/v1/guild/:guildId/leaderboard', 'GET /api/v1/guild/:guildId/flags', 'GET /api/v1/user/:userId/guilds', 'POST /api/v1/guild/:guildId/announce'],
                keys:    ['POST /api/v1/keys/generate (authenticated)', 'POST /api/v1/keys/revoke (authenticated)'],
            },
        });
    });

    app.get('/api/v1/bot', apiAuth, freeEndpointCheck, (req, res) => {
        const globalUsers = client.config.globalUsers || {};
        const flags       = client.config.flags || {};
        const totalCounts = Object.values(globalUsers).reduce((s, u) => s + (u.totalCounts || 0), 0);
        const uptime      = Math.floor(client.uptime / 1000);
        res.json({
            name: client.user.username, id: client.user.id, version: 'v3.0',
            guilds: client.guilds.cache.size, totalCounts,
            totalUsers: Object.keys(globalUsers).length,
            flaggedUsers: Object.keys(flags).length,
            ping: client.ws.ping,
            uptime: { seconds: uptime, human: `${Math.floor(uptime/3600)}h ${Math.floor((uptime%3600)/60)}m ${uptime%60}s` },
        });
    });

    app.get('/api/v1/leaderboard', apiAuth, freeEndpointCheck, (req, res) => {
        const globalLB    = client.config.globalLeaderboard || {};
        const globalUsers = client.config.globalUsers || {};
        const limit       = Math.min(parseInt(req.query.limit || '10'), req.isPremium ? 100 : 10);
        const servers = Object.entries(globalLB).sort(([,a],[,b]) => b.score - a.score).slice(0, limit)
            .map(([guildId, d], i) => ({ rank: i+1, guildId, name: d.name, score: d.score, premium: client.config[guildId]?.isPremium || false }));
        const users = Object.entries(globalUsers).filter(([,u]) => u.totalCounts > 0)
            .sort(([,a],[,b]) => b.totalCounts - a.totalCounts).slice(0, limit)
            .map(([userId, u], i) => ({ rank: i+1, userId, totalCounts: u.totalCounts||0, bestStreak: u.bestStreak||0, tags: u.tags||[] }));
        res.json({ servers, users, limit, generatedAt: new Date().toISOString() });
    });

    app.get('/api/v1/guild/:guildId', apiAuth, freeEndpointCheck, (req, res) => {
        const { guildId } = req.params;
        const data = client.config[guildId];
        if (!data) return res.status(404).json({ error: 'Guild not found.' });
        const botGuild = client.guilds.cache.get(guildId);
        const lb       = client.config.globalLeaderboard || {};
        const lbRank   = lb[guildId]
            ? Object.entries(lb).sort(([,a],[,b]) => b.score - a.score).findIndex(([id]) => id === guildId) + 1
            : null;
        res.json({
            guildId, name: botGuild?.name || lb[guildId]?.name || guildId,
            memberCount: botGuild?.memberCount || null,
            currentCount: data.currentCount ?? 0, streak: data.streak ?? 0,
            bestStreak: data.bestStreak ?? 0, isPremium: data.isPremium || false,
            tags: data.tags || [], goal: data.goal || null, globalRank: lbRank,
            gamemode: data.gamemode || null,
            ...(data.isPremium && data.customDescription ? { description: data.customDescription } : {}),
        });
    });

    app.get('/api/v1/user/:userId', apiAuth, freeEndpointCheck, premiumOnly, async (req, res) => {
        const { userId } = req.params;
        const data = client.config.globalUsers?.[userId];
        if (!data) return res.status(404).json({ error: 'User not found.' });
        let username = null;
        try { username = (await client.users.fetch(userId)).username; } catch {}
        const flags = client.config.flags?.[userId] || [];
        res.json({ userId, username, totalCounts: data.totalCounts||0, bestStreak: data.bestStreak||0, tags: data.tags||[], flagged: flags.length > 0, flagCount: flags.length });
    });

    app.get('/api/v1/guild/:guildId/leaderboard', apiAuth, premiumOnly, async (req, res) => {
        const { guildId } = req.params;
        if (!client.config[guildId]) return res.status(404).json({ error: 'Guild not found.' });
        const limit  = Math.min(parseInt(req.query.limit || '10'), 50);
        const guild  = client.guilds.cache.get(guildId);
        if (!guild) return res.status(404).json({ error: 'Bot not in this guild.' });
        const members = await guild.members.fetch().catch(() => null);
        if (!members) return res.status(500).json({ error: 'Could not fetch members.' });
        const globalUsers = client.config.globalUsers || {};
        const ranked = Object.entries(globalUsers).filter(([uid]) => members.has(uid))
            .sort(([,a],[,b]) => b.totalCounts - a.totalCounts).slice(0, limit)
            .map(([userId, u], i) => ({ rank: i+1, userId, username: members.get(userId)?.user.username || null, totalCounts: u.totalCounts||0, bestStreak: u.bestStreak||0, tags: u.tags||[] }));
        res.json({ guildId, leaderboard: ranked, limit, generatedAt: new Date().toISOString() });
    });

    app.get('/api/v1/guild/:guildId/flags', apiAuth, premiumOnly, (req, res) => {
        const { guildId } = req.params;
        if (!client.config[guildId]) return res.status(404).json({ error: 'Guild not found.' });
        const flags   = client.config.flags || {};
        const flagged = Object.entries(flags)
            .map(([userId, entries]) => {
                const gf = entries.filter(e => e.includes(`Guild:${guildId}`));
                return gf.length ? { userId, count: gf.length, recent: gf.slice(-3) } : null;
            }).filter(Boolean).sort((a,b) => b.count - a.count);
        res.json({ guildId, flagged, total: flagged.length });
    });

    app.post('/api/v1/guild/:guildId/announce', apiAuth, premiumOnly, async (req, res) => {
        const { guildId } = req.params;
        const { message, embed } = req.body;
        if (!message && !embed) return res.status(400).json({ error: 'message or embed required' });
        const channelId = client.config[guildId]?.channelId;
        if (!channelId) return res.status(404).json({ error: 'No counting channel set.' });
        try {
            const channel = await client.channels.fetch(channelId);
            const payload = {};
            if (message) payload.content = String(message).slice(0, 2000);
            if (embed && typeof embed === 'object') {
                const { EmbedBuilder } = require('discord.js');
                const e = new EmbedBuilder();
                if (embed.title)       e.setTitle(String(embed.title).slice(0, 256));
                if (embed.description) e.setDescription(String(embed.description).slice(0, 4096));
                if (embed.color)       e.setColor(embed.color);
                if (embed.footer)      e.setFooter({ text: String(embed.footer).slice(0, 2048) });
                e.setTimestamp();
                payload.embeds = [e];
            }
            await channel.send(payload);
            res.json({ ok: true, guildId, channelId });
        } catch(e) { res.status(500).json({ error: e.message }); }
    });

    app.get('/api/v1/user/:userId/guilds', apiAuth, premiumOnly, (req, res) => {
        const { userId } = req.params;
        const lb = client.config.globalLeaderboard || {};
        const guilds = client.guilds.cache.filter(g => client.config[g.id] && client.config.globalUsers?.[userId])
            .map(g => ({ guildId: g.id, name: g.name, score: lb[g.id]?.score||0, premium: client.config[g.id]?.isPremium||false }));
        res.json({ userId, guilds });
    });

    app.post('/api/v1/keys/generate', requireAuth, (req, res) => {
        const guilds = req.session.guilds || [];
        const { guildId } = req.body;
        if (!guildId) return res.status(400).json({ error: 'guildId required' });
        if (!canManageGuild(guilds, guildId)) return res.status(403).json({ error: 'No permission' });
        if (!client.config[guildId]) client.config[guildId] = { currentCount: 0 };
        const newKey = `dci_${crypto.randomBytes(24).toString('hex')}`;
        client.config[guildId].apiKey       = newKey;
        client.config[guildId].apiKeyIssued = new Date().toISOString();
        client.saveConfig();
        res.json({
            ok: true, apiKey: newKey, issued: client.config[guildId].apiKeyIssued,
            tier:   client.config[guildId].isPremium ? 'premium' : 'free',
            limits: { requestsPerMinute: getRateLimit(client.config[guildId].isPremium) },
            warning: 'Store this key securely. It will not be shown again.',
        });
    });

    app.post('/api/v1/keys/revoke', requireAuth, (req, res) => {
        const guilds = req.session.guilds || [];
        const { guildId } = req.body;
        if (!guildId) return res.status(400).json({ error: 'guildId required' });
        if (!canManageGuild(guilds, guildId)) return res.status(403).json({ error: 'No permission' });
        if (!client.config[guildId]?.apiKey) return res.status(404).json({ error: 'No key found' });
        delete client.config[guildId].apiKey;
        delete client.config[guildId].apiKeyIssued;
        client.saveConfig();
        res.json({ ok: true, message: 'API key revoked.' });
    });

    // ── Portal settings API ───────────────────────────────────────────────
    app.get('/api/guild/:guildId', requireAuth, (req, res) => {
        const { guildId } = req.params;
        if (!canManageGuild(req.session.guilds, guildId)) return res.status(403).json({ error: 'No permission' });
        const data      = client.config[guildId] || {};
        const botGuild  = client.guilds.cache.get(guildId);
        const isPremium = data.isPremium || false;
        res.json({
            guildId, name: botGuild?.name || guildId, icon: botGuild?.iconURL() || null,
            memberCount: botGuild?.memberCount || null, inBot: !!botGuild, isPremium,
            currentCount: data.currentCount??0, bestStreak: data.bestStreak??0, streak: data.streak??0,
            channelId: data.channelId||null, goal: data.goal||null,
            maxSaves: data.maxSaves??3, saves: data.saves??0, tags: data.tags||[],
            gamemode: data.gamemode||null, gamemodeConfig: data.gamemodeConfig||{},
            hasApiKey: !!data.apiKey, apiKeyIssued: data.apiKeyIssued||null,
            ...(isPremium ? {
                customDescription: data.customDescription||'', acEnabled: data.acEnabled??true,
                acCooldown: data.acCooldown??450, acBurstThreshold: data.acBurstThreshold??4,
                acIgnoreFlags: data.acIgnoreFlags??5, celebrationMsg: data.celebrationMsg||'',
            } : {}),
        });
    });

    app.post('/api/guild/:guildId', requireAuth, (req, res) => {
        const { guildId } = req.params;
        if (!canManageGuild(req.session.guilds, guildId)) return res.status(403).json({ error: 'No permission' });
        const data = client.config[guildId] || {};
        const isPremium = data.isPremium || false;
        const body = req.body;
        if (body.goal !== undefined) { const g = parseInt(body.goal,10); if(!isNaN(g)&&g>0) data.goal=g; else delete data.goal; }
        if (body.maxSaves !== undefined && isPremium) data.maxSaves = Math.min(10,Math.max(1,parseInt(body.maxSaves,10)||3));
        if (isPremium) {
            if (body.customDescription !== undefined) data.customDescription = String(body.customDescription).slice(0,200);
            if (body.acEnabled         !== undefined) data.acEnabled         = body.acEnabled==='true'||body.acEnabled===true;
            if (body.acCooldown        !== undefined) data.acCooldown        = Math.min(2000,Math.max(100,parseInt(body.acCooldown,10)||450));
            if (body.acBurstThreshold  !== undefined) data.acBurstThreshold  = Math.min(10,Math.max(2,parseInt(body.acBurstThreshold,10)||4));
            if (body.acIgnoreFlags     !== undefined) data.acIgnoreFlags     = Math.min(20,Math.max(1,parseInt(body.acIgnoreFlags,10)||5));
            if (body.celebrationMsg    !== undefined) data.celebrationMsg    = String(body.celebrationMsg).slice(0,300);
            if (body.gamemode          !== undefined) {
                if (body.gamemode === 'none') { delete data.gamemode; delete data.gamemodeConfig; }
                else if (GAMEMODES[body.gamemode]) data.gamemode = body.gamemode;
            }
            if (body.gamemodeConfig !== undefined && typeof body.gamemodeConfig === 'object') {
                data.gamemodeConfig = sanitizeGamemodeConfig(data.gamemode, body.gamemodeConfig);
            }
        }
        client.config[guildId] = data;
        client.saveConfig();
        res.json({ ok: true });
    });

    function sanitizeGamemodeConfig(gamemode, cfg) {
        switch(gamemode) {
            case 'speed':   return { target: Math.min(10000, Math.max(10, parseInt(cfg.target)||100)) };
            case 'relay':   return {};
            case 'boss':    return { hp: Math.min(5000,Math.max(10,parseInt(cfg.hp)||200)), timerMinutes: Math.min(60,Math.max(1,parseInt(cfg.timerMinutes)||10)) };
            case 'reverse': return { from: Math.min(10000,Math.max(10,parseInt(cfg.from)||100)) };
            case 'skip':    return { multiplier: [2,5,10].includes(parseInt(cfg.multiplier)) ? parseInt(cfg.multiplier) : 2 };
            default:        return {};
        }
    }

    app.get('/api/guild/:guildId/channels', requireAuth, async (req, res) => {
        const { guildId } = req.params;
        if (!canManageGuild(req.session.guilds, guildId)) return res.status(403).json({ error: 'No permission' });
        try {
            const guild    = await client.guilds.fetch(guildId);
            const channels = await guild.channels.fetch();
            res.json(channels.filter(c => c.type===0).map(c => ({ id: c.id, name: c.name })).sort((a,b) => a.name.localeCompare(b.name)));
        } catch { res.status(404).json({ error: 'Guild not found or bot not in guild.' }); }
    });

    app.post('/api/guild/:guildId/setchannel', requireAuth, async (req, res) => {
        const { guildId } = req.params;
        const { channelId } = req.body;
        if (!canManageGuild(req.session.guilds, guildId)) return res.status(403).json({ error: 'No permission' });
        if (!client.config[guildId]) client.config[guildId] = { currentCount: 0 };
        client.config[guildId].channelId = channelId;
        client.saveConfig();
        res.json({ ok: true });
    });

    app.post('/api/guild/:guildId/reset', requireAuth, (req, res) => {
        const { guildId } = req.params;
        if (!canManageGuild(req.session.guilds, guildId)) return res.status(403).json({ error: 'No permission' });
        if (!client.config[guildId]) return res.status(404).json({ error: 'No config' });
        Object.assign(client.config[guildId], { currentCount: 0, lastCounter: null, streak: 0, saves: 0 });
        client.saveConfig();
        res.json({ ok: true });
    });

    // ── Error & pages ─────────────────────────────────────────────────────
    app.get('/error', (req, res) => res.send(shell('Error', `
        <div style="text-align:center;padding:4rem">
            <div style="font-size:3rem;margin-bottom:1rem">❌</div>
            <h2 style="color:#ef4444;margin-bottom:0.75rem">Authentication Failed</h2>
            <p style="color:#64748b;margin-bottom:1.5rem">Something went wrong during Discord login.</p>
            <a href="/login" class="btn primary">Try Again</a>
        </div>`)));

    // ── Guild picker ──────────────────────────────────────────────────────
    app.get('/', requireAuth, (req, res) => {
        const user       = req.session.user;
        const guilds     = req.session.guilds || [];
        const manageable = guilds.filter(g => canManageGuild(guilds, g.id));
        const inBot      = manageable.filter(g =>  client.guilds.cache.has(g.id));
        const notInBot   = manageable.filter(g => !client.guilds.cache.has(g.id));

        const guildCard = (g, hasBot) => {
            const icon    = g.icon ? `https://cdn.discordapp.com/icons/${g.id}/${g.icon}.png` : `https://cdn.discordapp.com/embed/avatars/${parseInt(g.id)%6}.png`;
            const data    = client.config[g.id] || {};
            const premium = data.isPremium ? '<span class="badge premium">💎 Premium</span>' : '';
            const gm      = data.gamemode ? `<span class="badge gm">${GAMEMODES[data.gamemode]?.emoji} ${GAMEMODES[data.gamemode]?.name}</span>` : '';
            return `<div class="guild-card${hasBot?'':' dimmed'}" ${hasBot?`onclick="location.href='/dashboard?g=${g.id}'"`:''}>
                <img class="guild-icon" src="${icon}" onerror="this.src='https://cdn.discordapp.com/embed/avatars/0.png'">
                <div class="guild-info">
                    <div class="guild-name">${g.name} ${premium} ${gm}</div>
                    <div class="guild-sub">${hasBot?`Count: ${(data.currentCount||0).toLocaleString()}`:'Bot not in this server'}</div>
                </div>
                ${hasBot?'<div class="guild-arrow">›</div>':`<div class="guild-add"><a href="https://discord.com/oauth2/authorize?client_id=${CLIENT_ID}&permissions=8&scope=bot%20applications.commands&guild_id=${g.id}" target="_blank">Add Bot</a></div>`}
            </div>`;
        };

        res.send(shell('Select Server', `
            <div class="portal-header">
                <img class="portal-avatar" src="https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png" onerror="this.src='https://cdn.discordapp.com/embed/avatars/0.png'">
                <div><div class="portal-username">${user.username}</div><div class="portal-sub">Select a server to manage</div></div>
                <a href="/logout" class="btn ghost" style="margin-left:auto">Logout</a>
            </div>
            <h3 class="section-label">Your Servers</h3>
            <div class="guild-list">${inBot.length?inBot.map(g=>guildCard(g,true)).join(''):'<div class="empty">No servers with the bot installed.</div>'}</div>
            ${notInBot.length?`<h3 class="section-label" style="margin-top:1.5rem">Add Bot</h3><div class="guild-list">${notInBot.map(g=>guildCard(g,false)).join('')}</div>`:''}
        `));
    });

    // ── Guild dashboard ───────────────────────────────────────────────────
    app.get('/dashboard', requireAuth, async (req, res) => {
        const guildId = req.query.g;
        if (!guildId || !canManageGuild(req.session.guilds, guildId)) return res.redirect('/');

        const user      = req.session.user;
        const data      = client.config[guildId] || {};
        const botGuild  = client.guilds.cache.get(guildId);
        const isPremium = data.isPremium || false;
        if (!botGuild) return res.redirect('/');

        let channels = [];
        try {
            const fetched = await botGuild.channels.fetch();
            channels = fetched.filter(c => c.type===0).map(c => ({ id: c.id, name: c.name })).sort((a,b) => a.name.localeCompare(b.name));
        } catch {}

        const channelOptions = channels.map(c => `<option value="${c.id}" ${data.channelId===c.id?'selected':''}>#${c.name}</option>`).join('');
        const gm = data.gamemode || 'none';
        const gmCfg = data.gamemodeConfig || {};

        res.send(shell(`${botGuild.name} — Settings`, `
            <div class="portal-header">
                <img class="portal-avatar" src="${botGuild.iconURL()||''}" onerror="this.src='https://cdn.discordapp.com/embed/avatars/0.png'">
                <div>
                    <div class="portal-username">${botGuild.name}</div>
                    <div class="portal-sub">${botGuild.memberCount?.toLocaleString()} members${isPremium?' • <span style="color:#fbbf24">💎 Premium</span>':''}</div>
                </div>
                <a href="/" class="btn ghost" style="margin-left:auto">← Back</a>
            </div>

            <div class="stats-strip">
                <div class="stat-box"><div class="stat-label">Current Count</div><div class="stat-value">${(data.currentCount||0).toLocaleString()}</div></div>
                <div class="stat-box"><div class="stat-label">Streak</div><div class="stat-value">${(data.streak||0).toLocaleString()}</div></div>
                <div class="stat-box"><div class="stat-label">Best Streak</div><div class="stat-value">${(data.bestStreak||0).toLocaleString()}</div></div>
                <div class="stat-box"><div class="stat-label">Saves</div><div class="stat-value">${data.saves||0}/${data.maxSaves||3}</div></div>
                <div class="stat-box"><div class="stat-label">Gamemode</div><div class="stat-value" style="font-size:1rem">${gm==='none'?'Normal':`${GAMEMODES[gm]?.emoji} ${GAMEMODES[gm]?.name}`}</div></div>
            </div>

            <!-- General -->
            <div class="settings-card">
                <div class="settings-title">⚙️ General Settings</div>
                <div class="setting-row">
                    <div class="setting-info"><div class="setting-label">Counting Channel</div><div class="setting-desc">The channel where counting happens</div></div>
                    <select class="field" id="s-channel" onchange="saveChannel('${guildId}', this.value)">
                        <option value="">— Not set —</option>${channelOptions}
                    </select>
                </div>
                <div class="setting-row">
                    <div class="setting-info"><div class="setting-label">Counting Goal</div><div class="setting-desc">Celebrate when the count hits this number</div></div>
                    <div style="display:flex;gap:0.5rem;align-items:center">
                        <input class="field narrow" type="number" id="s-goal" value="${data.goal||''}" placeholder="None" min="1">
                        <button class="btn primary" onclick="saveSetting('${guildId}',{goal:document.getElementById('s-goal').value})">Save</button>
                        <button class="btn ghost"   onclick="saveSetting('${guildId}',{goal:0})">Clear</button>
                    </div>
                </div>
                <div class="setting-row" style="border-bottom:none">
                    <div class="setting-info"><div class="setting-label">Reset Count</div><div class="setting-desc">Wipe the current count back to 0</div></div>
                    <button class="btn danger" onclick="resetCount('${guildId}')">Reset</button>
                </div>
            </div>

            ${isPremium ? `
            <!-- Gamemodes -->
            <div class="settings-card premium-card">
                <div class="settings-title">🎮 Gamemode <span style="font-size:0.7rem;color:#64748b;font-weight:400;text-transform:none;letter-spacing:0">Premium</span></div>
                <div class="setting-row">
                    <div class="setting-info"><div class="setting-label">Active Gamemode</div><div class="setting-desc">Changes the rules for the counting channel</div></div>
                    <select class="field" id="s-gm" onchange="onGamemodeChange(this.value)">
                        <option value="none" ${gm==='none'?'selected':''}>🔢 Normal</option>
                        ${Object.entries(GAMEMODES).map(([k,v]) => `<option value="${k}" ${gm===k?'selected':''}>${v.emoji} ${v.name}</option>`).join('')}
                    </select>
                </div>

                <!-- Speed config -->
                <div id="cfg-speed" class="gm-config" style="display:${gm==='speed'?'block':'none'}">
                    <div class="setting-row">
                        <div class="setting-info"><div class="setting-label">Target Number</div><div class="setting-desc">Count to this number as fast as possible</div></div>
                        <div style="display:flex;gap:0.5rem;align-items:center">
                            <input class="field narrow" type="number" id="cfg-speed-target" value="${gmCfg.target||100}" min="10" max="10000">
                            <button class="btn primary" onclick="saveGamemode('${guildId}','speed',{target:document.getElementById('cfg-speed-target').value})">Save</button>
                        </div>
                    </div>
                </div>

                <!-- Boss config -->
                <div id="cfg-boss" class="gm-config" style="display:${gm==='boss'?'block':'none'}">
                    <div class="setting-row">
                        <div class="setting-info"><div class="setting-label">Boss HP</div><div class="setting-desc">Count to this number before the timer runs out</div></div>
                        <div style="display:flex;gap:0.5rem;align-items:center">
                            <input class="field narrow" type="number" id="cfg-boss-hp" value="${gmCfg.hp||200}" min="10" max="5000">
                            <button class="btn primary" onclick="saveGamemode('${guildId}','boss',{hp:document.getElementById('cfg-boss-hp').value,timerMinutes:document.getElementById('cfg-boss-timer').value})">Save</button>
                        </div>
                    </div>
                    <div class="setting-row" style="border-bottom:none">
                        <div class="setting-info"><div class="setting-label">Timer (minutes)</div><div class="setting-desc">Time limit to defeat the boss</div></div>
                        <input class="field narrow" type="number" id="cfg-boss-timer" value="${gmCfg.timerMinutes||10}" min="1" max="60">
                    </div>
                </div>

                <!-- Reverse config -->
                <div id="cfg-reverse" class="gm-config" style="display:${gm==='reverse'?'block':'none'}">
                    <div class="setting-row" style="border-bottom:none">
                        <div class="setting-info"><div class="setting-label">Start From</div><div class="setting-desc">Count down from this number to zero</div></div>
                        <div style="display:flex;gap:0.5rem;align-items:center">
                            <input class="field narrow" type="number" id="cfg-reverse-from" value="${gmCfg.from||100}" min="10" max="10000">
                            <button class="btn primary" onclick="saveGamemode('${guildId}','reverse',{from:document.getElementById('cfg-reverse-from').value})">Save</button>
                        </div>
                    </div>
                </div>

                <!-- Skip config -->
                <div id="cfg-skip" class="gm-config" style="display:${gm==='skip'?'block':'none'}">
                    <div class="setting-row" style="border-bottom:none">
                        <div class="setting-info"><div class="setting-label">Multiplier</div><div class="setting-desc">Count by this number instead of 1</div></div>
                        <div style="display:flex;gap:0.5rem;align-items:center">
                            <select class="field" id="cfg-skip-mult">
                                <option value="2"  ${(gmCfg.multiplier||2)===2?'selected':''}>Count by 2s</option>
                                <option value="5"  ${(gmCfg.multiplier||2)===5?'selected':''}>Count by 5s</option>
                                <option value="10" ${(gmCfg.multiplier||2)===10?'selected':''}>Count by 10s</option>
                            </select>
                            <button class="btn primary" onclick="saveGamemode('${guildId}','skip',{multiplier:parseInt(document.getElementById('cfg-skip-mult').value)})">Save</button>
                        </div>
                    </div>
                </div>

                <!-- Relay — no config needed -->
                <div id="cfg-relay" class="gm-config" style="display:${gm==='relay'?'block':'none'}">
                    <div class="setting-row" style="border-bottom:none">
                        <div class="setting-info"><div class="setting-label">Relay Mode</div><div class="setting-desc">Each user can only count once per round. No configuration needed.</div></div>
                        <button class="btn success" onclick="saveGamemode('${guildId}','relay',{})">Enable</button>
                    </div>
                </div>

                <div class="setting-row" style="border-bottom:none;margin-top:0.5rem">
                    <div class="setting-info"><div class="setting-label">Disable Gamemode</div><div class="setting-desc">Return to normal counting</div></div>
                    <button class="btn ghost" onclick="saveGamemode('${guildId}','none',{})">Disable</button>
                </div>
            </div>

            <!-- Premium settings -->
            <div class="settings-card premium-card">
                <div class="settings-title">💎 Premium Settings</div>
                <div class="setting-row">
                    <div class="setting-info"><div class="setting-label">Max Saves</div><div class="setting-desc">Wrong counts that can be saved per run (1–10)</div></div>
                    <div style="display:flex;gap:0.5rem;align-items:center">
                        <input class="field narrow" type="number" id="s-saves" value="${data.maxSaves||3}" min="1" max="10">
                        <button class="btn primary" onclick="saveSetting('${guildId}',{maxSaves:document.getElementById('s-saves').value})">Save</button>
                    </div>
                </div>
                <div class="setting-row">
                    <div class="setting-info"><div class="setting-label">Server Description</div><div class="setting-desc">Shown in /serverinfo. Max 200 characters.</div></div>
                    <div style="display:flex;flex-direction:column;gap:0.5rem;width:100%;max-width:400px">
                        <textarea class="field" id="s-desc" style="width:100%;resize:vertical;min-height:70px" maxlength="200">${data.customDescription||''}</textarea>
                        <button class="btn primary" onclick="saveSetting('${guildId}',{customDescription:document.getElementById('s-desc').value})">Save</button>
                    </div>
                </div>
                <div class="setting-row">
                    <div class="setting-info"><div class="setting-label">Goal Celebration Message</div><div class="setting-desc">Sent when goal is reached. Max 300 chars.</div></div>
                    <div style="display:flex;flex-direction:column;gap:0.5rem;width:100%;max-width:400px">
                        <textarea class="field" id="s-celeb" style="width:100%;resize:vertical;min-height:70px" maxlength="300">${data.celebrationMsg||''}</textarea>
                        <button class="btn primary" onclick="saveSetting('${guildId}',{celebrationMsg:document.getElementById('s-celeb').value})">Save</button>
                    </div>
                </div>
                <div class="settings-title" style="margin-top:1.5rem;font-size:0.8rem">🛡️ Anti-Cheat</div>
                <div class="setting-row">
                    <div class="setting-info"><div class="setting-label">Anti-Cheat Enabled</div><div class="setting-desc">Toggle AC v2 for this server</div></div>
                    <label class="toggle"><input type="checkbox" id="s-ac" ${data.acEnabled!==false?'checked':''} onchange="saveSetting('${guildId}',{acEnabled:this.checked.toString()})"><span class="toggle-slider"></span></label>
                </div>
                <div class="setting-row">
                    <div class="setting-info"><div class="setting-label">Rate Limit (ms)</div><div class="setting-desc">Min time between counts. Default: 450ms</div></div>
                    <div style="display:flex;gap:0.5rem;align-items:center">
                        <input class="field narrow" type="number" id="s-cooldown" value="${data.acCooldown||450}" min="100" max="2000">
                        <button class="btn primary" onclick="saveSetting('${guildId}',{acCooldown:document.getElementById('s-cooldown').value})">Save</button>
                    </div>
                </div>
                <div class="setting-row">
                    <div class="setting-info"><div class="setting-label">Burst Threshold</div><div class="setting-desc">Counts within 5s before flagged. Default: 4</div></div>
                    <div style="display:flex;gap:0.5rem;align-items:center">
                        <input class="field narrow" type="number" id="s-burst" value="${data.acBurstThreshold||4}" min="2" max="10">
                        <button class="btn primary" onclick="saveSetting('${guildId}',{acBurstThreshold:document.getElementById('s-burst').value})">Save</button>
                    </div>
                </div>
                <div class="setting-row" style="border-bottom:none">
                    <div class="setting-info"><div class="setting-label">Auto-Ignore Threshold</div><div class="setting-desc">Flags before user is silently ignored. Default: 5</div></div>
                    <div style="display:flex;gap:0.5rem;align-items:center">
                        <input class="field narrow" type="number" id="s-ignore" value="${data.acIgnoreFlags||5}" min="1" max="20">
                        <button class="btn primary" onclick="saveSetting('${guildId}',{acIgnoreFlags:document.getElementById('s-ignore').value})">Save</button>
                    </div>
                </div>
            </div>

            <!-- API Key -->
            <div class="settings-card premium-card">
                <div class="settings-title">🔑 API Access</div>
                ${data.apiKey ? `
                <div class="setting-row">
                    <div class="setting-info">
                        <div class="setting-label">Active Key</div>
                        <div class="setting-desc">Issued ${new Date(data.apiKeyIssued).toLocaleDateString()} • 120 req/min • All endpoints</div>
                    </div>
                    <div style="display:flex;gap:0.5rem">
                        <button class="btn ghost" onclick="generateKey('${guildId}')">🔄 Regenerate</button>
                        <button class="btn danger" onclick="revokeKey('${guildId}')">Revoke</button>
                    </div>
                </div>
                <div class="setting-row" style="border-bottom:none">
                    <div class="setting-info"><div class="setting-label">Documentation</div><div class="setting-desc">Full API reference with all endpoints</div></div>
                    <a href="/api/v1" target="_blank" class="btn ghost">📄 View Docs</a>
                </div>` : `
                <div class="setting-row" style="border-bottom:none">
                    <div class="setting-info">
                        <div class="setting-label">No Key Generated</div>
                        <div class="setting-desc">Generate an API key to access DCI Counting data programmatically. Premium keys get 120 req/min and all endpoints.</div>
                    </div>
                    <button class="btn primary" onclick="generateKey('${guildId}')">Generate Key</button>
                </div>`}
                <div id="key-display" style="display:none;margin-top:1rem;background:#020617;border-radius:8px;padding:1rem;border:1px solid #334155">
                    <div style="font-size:0.72rem;color:#64748b;margin-bottom:0.5rem">Your new API key — copy it now, it will not be shown again:</div>
                    <div id="key-value" style="font-family:'Courier New',monospace;font-size:0.8rem;color:#38bdf8;word-break:break-all"></div>
                    <button class="btn ghost" style="margin-top:0.75rem;font-size:0.75rem" onclick="navigator.clipboard.writeText(document.getElementById('key-value').textContent).then(()=>this.textContent='✅ Copied!')">Copy Key</button>
                </div>
            </div>
            ` : `
            <!-- Upgrade -->
            <div class="settings-card upgrade-card">
                <div style="font-size:2rem;margin-bottom:0.75rem">💎</div>
                <div class="settings-title">Unlock Premium</div>
                <p style="color:#94a3b8;font-size:0.875rem;margin:0.5rem 0 1.5rem;line-height:1.6">
                    Premium unlocks saves, gamemodes, custom AC thresholds, server descriptions, goal messages, and full API access with 120 req/min.
                </p>
                <div style="display:flex;flex-wrap:wrap;gap:0.5rem;justify-content:center;margin-bottom:1.5rem">
                    ${Object.values(GAMEMODES).map(g=>`<span style="background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.08);padding:0.3rem 0.7rem;border-radius:6px;font-size:0.78rem">${g.emoji} ${g.name}</span>`).join('')}
                </div>
                <a href="https://discord.gg/hbeSGytT9d" target="_blank" class="btn warn">Contact DCI Studios</a>
            </div>`}

            <div class="status-line" id="status"></div>

            <script>
            async function saveSetting(guildId, data) {
                try {
                    const r = await fetch('/api/guild/'+guildId, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(data) });
                    const d = await r.json();
                    showStatus(d.ok?'✅ Saved':'❌ '+(d.error||'Failed'), d.ok);
                } catch(e) { showStatus('❌ '+e.message, false); }
            }
            async function saveChannel(guildId, channelId) {
                try {
                    const r = await fetch('/api/guild/'+guildId+'/setchannel', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({channelId}) });
                    const d = await r.json();
                    showStatus(d.ok?'✅ Channel saved':'❌ '+(d.error||'Failed'), d.ok);
                } catch(e) { showStatus('❌ '+e.message, false); }
            }
            async function resetCount(guildId) {
                if (!confirm('Reset the count to 0?')) return;
                try {
                    const r = await fetch('/api/guild/'+guildId+'/reset', { method:'POST' });
                    const d = await r.json();
                    showStatus(d.ok?'✅ Count reset':'❌ '+(d.error||'Failed'), d.ok);
                    if (d.ok) setTimeout(()=>location.reload(), 1000);
                } catch(e) { showStatus('❌ '+e.message, false); }
            }
            async function saveGamemode(guildId, gm, cfg) {
                try {
                    const r = await fetch('/api/guild/'+guildId, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({gamemode:gm, gamemodeConfig:cfg}) });
                    const d = await r.json();
                    showStatus(d.ok?'✅ Gamemode saved':'❌ '+(d.error||'Failed'), d.ok);
                    if (d.ok) setTimeout(()=>location.reload(), 800);
                } catch(e) { showStatus('❌ '+e.message, false); }
            }
            function onGamemodeChange(gm) {
                document.querySelectorAll('.gm-config').forEach(el => el.style.display='none');
                if (gm !== 'none') { const el = document.getElementById('cfg-'+gm); if (el) el.style.display='block'; }
                if (gm === 'none') saveGamemode('${guildId}', 'none', {});
            }
            async function generateKey(guildId) {
                if (!confirm('Generate a new API key? This will invalidate any existing key.')) return;
                try {
                    const r = await fetch('/api/v1/keys/generate', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({guildId}) });
                    const d = await r.json();
                    if (d.ok) {
                        document.getElementById('key-display').style.display = 'block';
                        document.getElementById('key-value').textContent = d.apiKey;
                        showStatus('✅ Key generated — copy it now!', true);
                        setTimeout(()=>location.reload(), 20000);
                    } else { showStatus('❌ '+(d.error||'Failed'), false); }
                } catch(e) { showStatus('❌ '+e.message, false); }
            }
            async function revokeKey(guildId) {
                if (!confirm('Revoke API key? Apps using it will stop working immediately.')) return;
                try {
                    const r = await fetch('/api/v1/keys/revoke', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({guildId}) });
                    const d = await r.json();
                    showStatus(d.ok?'✅ Key revoked':'❌ '+d.error, d.ok);
                    if (d.ok) setTimeout(()=>location.reload(), 1000);
                } catch(e) { showStatus('❌ '+e.message, false); }
            }
            function showStatus(msg, ok) {
                const el = document.getElementById('status');
                el.style.color = ok?'#22c55e':'#ef4444';
                el.textContent = msg;
                setTimeout(()=>el.textContent='', 4000);
            }
            <\/script>
        `));
    });

    // ── Shell ─────────────────────────────────────────────────────────────
    function shell(title, content) {
        return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title} — DCI Counting</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{background:#0f172a;color:#e2e8f0;font-family:'Segoe UI',sans-serif;min-height:100vh;padding:2rem}
.portal-header{display:flex;align-items:center;gap:1rem;margin-bottom:2rem;padding-bottom:1.5rem;border-bottom:1px solid #1e293b}
.portal-avatar{width:52px;height:52px;border-radius:50%;object-fit:cover;background:#1e293b}
.portal-username{font-size:1.15rem;font-weight:700}
.portal-sub{font-size:0.8rem;color:#64748b;margin-top:0.2rem}
.section-label{font-size:0.7rem;text-transform:uppercase;letter-spacing:0.08em;color:#475569;margin-bottom:0.75rem}
.guild-list{display:flex;flex-direction:column;gap:0.5rem}
.guild-card{display:flex;align-items:center;gap:1rem;background:#1e293b;border-radius:10px;padding:1rem 1.25rem;border:1px solid #263148;transition:all 0.15s;cursor:pointer}
.guild-card:hover{background:#263148;border-color:#334155;transform:translateX(3px)}
.guild-card.dimmed{opacity:0.5;cursor:default}.guild-card.dimmed:hover{transform:none}
.guild-icon{width:44px;height:44px;border-radius:50%;object-fit:cover;background:#334155}
.guild-info{flex:1}
.guild-name{font-weight:600;font-size:0.95rem;display:flex;align-items:center;gap:0.5rem;flex-wrap:wrap}
.guild-sub{font-size:0.78rem;color:#64748b;margin-top:0.2rem}
.guild-arrow{font-size:1.5rem;color:#475569}
.guild-add a{font-size:0.78rem;color:#38bdf8;text-decoration:none;background:#0f172a;padding:0.3rem 0.6rem;border-radius:5px;border:1px solid #334155}
.stats-strip{display:grid;grid-template-columns:repeat(auto-fill,minmax(120px,1fr));gap:1rem;margin-bottom:1.5rem}
.stat-box{background:#1e293b;border-radius:10px;padding:1rem;border:1px solid #263148}
.stat-label{font-size:0.68rem;color:#64748b;text-transform:uppercase;letter-spacing:0.05em}
.stat-value{font-size:1.4rem;font-weight:700;color:#38bdf8;margin-top:0.2rem}
.settings-card{background:#1e293b;border-radius:12px;padding:1.5rem;margin-bottom:1.25rem;border:1px solid #263148}
.settings-card.premium-card{border-color:#854d0e}
.settings-card.upgrade-card{text-align:center;padding:2.5rem;border:1px dashed #334155}
.settings-title{font-size:0.85rem;font-weight:600;color:#94a3b8;margin-bottom:1.25rem;text-transform:uppercase;letter-spacing:0.05em}
.setting-row{display:flex;align-items:flex-start;justify-content:space-between;gap:1.5rem;padding:1rem 0;border-bottom:1px solid #0f172a;flex-wrap:wrap}
.setting-row:last-child{border-bottom:none;padding-bottom:0}
.setting-info{flex:1;min-width:160px}
.setting-label{font-size:0.9rem;font-weight:500}
.setting-desc{font-size:0.78rem;color:#64748b;margin-top:0.2rem;line-height:1.5}
.gm-config{border-top:1px solid #0f172a;margin-top:0}
.field{background:#0f172a;border:1px solid #334155;color:#e2e8f0;padding:0.5rem 0.75rem;border-radius:6px;font-size:0.85rem;outline:none;transition:border 0.15s}
.field:focus{border-color:#38bdf8}
.field.narrow{width:110px}
select.field{cursor:pointer;min-width:180px}
.btn{padding:0.5rem 1rem;border-radius:6px;border:none;cursor:pointer;font-size:0.82rem;font-weight:600;transition:opacity 0.15s;white-space:nowrap;text-decoration:none;display:inline-block}
.btn:hover{opacity:0.82}
.btn.danger{background:#dc2626;color:#fff}
.btn.primary{background:#0284c7;color:#fff}
.btn.success{background:#16a34a;color:#fff}
.btn.warn{background:#d97706;color:#fff}
.btn.ghost{background:#1e293b;color:#94a3b8;border:1px solid #334155}
.badge{display:inline-block;padding:0.15rem 0.4rem;border-radius:4px;font-size:0.68rem;font-weight:600}
.badge.premium{background:#854d0e;color:#fde68a}
.badge.gm{background:#1e3a5f;color:#60a5fa}
.empty{color:#475569;font-size:0.875rem;padding:1.5rem;text-align:center;background:#1e293b;border-radius:10px}
.status-line{font-size:0.85rem;margin-top:1rem;min-height:1.2rem;text-align:center}
.toggle{position:relative;display:inline-block;width:44px;height:24px;flex-shrink:0}
.toggle input{opacity:0;width:0;height:0}
.toggle-slider{position:absolute;cursor:pointer;inset:0;background:#334155;border-radius:24px;transition:0.2s}
.toggle-slider:before{content:'';position:absolute;width:18px;height:18px;left:3px;top:3px;background:#fff;border-radius:50%;transition:0.2s}
.toggle input:checked+.toggle-slider{background:#0284c7}
.toggle input:checked+.toggle-slider:before{transform:translateX(20px)}
@media(max-width:600px){body{padding:1rem}.setting-row{flex-direction:column}}
</style>
</head>
<body>
<div style="max-width:860px;margin:0 auto">${content}</div>
</body>
</html>`;
    }

    app.listen(3002, () => console.log('🌐 Guild portal running on http://localhost:3002'));
};
