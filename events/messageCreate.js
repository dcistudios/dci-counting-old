const { EmbedBuilder } = require('discord.js');
const path = require('path');

const OWNERS = ['1149841240897114154', '1478867238550503577'];
const PREFIX = '!';

const userCooldowns    = new Map();
const userCountHistory = new Map();
const sessionFlags     = new Map();
const ignoredUsers     = new Set();
const bossTimers       = new Map();

const AC_CONFIG = {
    COOLDOWN_MS:       450,
    BURST_WINDOW_MS:   5000,
    BURST_THRESHOLD:   4,
    AUTO_IGNORE_FLAGS: 5,
};

// ── Helpers ───────────────────────────────────────────────────────────────

function flagUser(client, userId, guildId, reason) {
    const timestamp = new Date().toISOString();
    const entry     = `[${timestamp}] Guild:${guildId} — ${reason}`;
    if (!client.config.flags)         client.config.flags = {};
    if (!client.config.flags[userId]) client.config.flags[userId] = [];
    client.config.flags[userId].push(entry);
    sessionFlags.set(userId, (sessionFlags.get(userId) || 0) + 1);
    if (sessionFlags.get(userId) >= AC_CONFIG.AUTO_IGNORE_FLAGS) ignoredUsers.add(userId);
    client.saveConfig();
    return client.config.flags[userId].length;
}

async function sendACAlert(channel, user, reason, flagCount) {
    const isIgnored = ignoredUsers.has(user.id);
    const embed = new EmbedBuilder()
        .setColor(isIgnored ? '#ff0000' : '#f97316')
        .setTitle(isIgnored ? '🚨 AC v2 — User Ignored' : '⚠️ AC v2 — Suspicious Activity')
        .addFields(
            { name: 'User',        value: `${user} (\`${user.id}\`)`, inline: true },
            { name: 'Reason',      value: reason,                      inline: true },
            { name: 'Total Flags', value: `\`${flagCount}\``,          inline: true },
        )
        .setTimestamp()
        .setFooter({ text: 'DCI Anti-Cheat v2' });
    const msg = await channel.send({ embeds: [embed] });
    setTimeout(() => msg.delete().catch(() => {}), 6000);
}

// ── Boss battle ───────────────────────────────────────────────────────────

function startBossTimer(client, guildId) {
    if (bossTimers.has(guildId)) clearTimeout(bossTimers.get(guildId));

    const guildConfig = client.config[guildId];
    if (!guildConfig || guildConfig.gamemode !== 'boss') return;

    const minutes = guildConfig.gamemodeConfig?.timerMinutes || 10;
    const ms      = minutes * 60 * 1000;

    const timer = setTimeout(async () => {
        const cfg = client.config[guildId];
        if (!cfg || cfg.gamemode !== 'boss') return;

        const channelId  = cfg.channelId;
        const finalCount = cfg.currentCount;
        const hp         = cfg.gamemodeConfig?.hp || 200;

        cfg.currentCount = 0;
        cfg.lastCounter  = null;
        cfg.streak       = 0;
        cfg.saves        = 0;
        cfg.bossActive   = false;
        client.saveConfig();

        try {
            const channel = await client.channels.fetch(channelId);
            const embed = new EmbedBuilder()
                .setColor('#ef4444')
                .setTitle('👹 Boss Attack!')
                .setDescription(
                    `Time ran out! You only reached **${finalCount.toLocaleString()}** / **${hp.toLocaleString()}** HP.\n\n` +
                    `The count has been reset. Start again!`
                )
                .setTimestamp();
            await channel.send({ embeds: [embed] });
        } catch {}

        startBossTimer(client, guildId);
    }, ms);

    bossTimers.set(guildId, timer);
    guildConfig.bossTimerStart = Date.now();
    guildConfig.bossActive     = true;
    client.saveConfig();
}

function stopBossTimer(guildId) {
    if (bossTimers.has(guildId)) {
        clearTimeout(bossTimers.get(guildId));
        bossTimers.delete(guildId);
    }
}

// ── Module ────────────────────────────────────────────────────────────────

module.exports = {
    name: 'messageCreate',
    async execute(message, client) {
        if (message.author.bot) return;

        // ── Owner prefix commands ─────────────────────────────────────────
        if (message.content.startsWith(PREFIX) && OWNERS.includes(message.author.id)) {
            const args        = message.content.slice(PREFIX.length).trim().split(/ +/);
            const commandName = args.shift().toLowerCase();
            const target      = args[0];

            if (commandName === 'reload') {
                if (!target) return message.reply('❌ Specify a command name.');
                const filePath = path.resolve(__dirname, `../commands/${target}.js`);
                try {
                    delete require.cache[require.resolve(filePath)];
                    const newCmd = require(filePath);
                    if (newCmd?.data?.name) {
                        client.commands.set(newCmd.data.name, newCmd);
                        return message.reply(`✅ Reloaded: **${newCmd.data.name}**`);
                    }
                } catch(e) { return message.reply(`❌ Error: \`${e.message}\``); }
            }

            if (commandName === 'clearflags') {
                if (!target) return message.reply('❌ Specify a user ID.');
                if (client.config.flags?.[target]) {
                    delete client.config.flags[target];
                    sessionFlags.delete(target);
                    ignoredUsers.delete(target);
                    client.saveConfig();
                    return message.reply(`✅ Cleared flags for \`${target}\`.`);
                }
                return message.reply('❌ No flags found for that ID.');
            }

            if (commandName === 'unignore') {
                if (!target) return message.reply('❌ Specify a user ID.');
                ignoredUsers.delete(target);
                sessionFlags.delete(target);
                return message.reply(`✅ \`${target}\` can count again.`);
            }

            if (commandName === 'startboss') {
                const guildConfig = client.config[message.guildId];
                if (!guildConfig || guildConfig.gamemode !== 'boss') return message.reply('❌ Boss mode not active.');
                startBossTimer(client, message.guildId);
                return message.reply('👹 Boss battle started!');
            }
        }

        // ── Counting engine ───────────────────────────────────────────────
        const guildConfig = client.config[message.guildId];
        if (!guildConfig || message.channel.id !== guildConfig.channelId) return;
        if (!/^\d+$/.test(message.content.trim())) return;

        // Silently delete ignored users
        if (ignoredUsers.has(message.author.id)) {
            message.delete().catch(() => {});
            return;
        }

        const userId    = message.author.id;
        const isOwner   = OWNERS.includes(userId);
        const isPremium = guildConfig.isPremium || false;
        const now       = Date.now();

        // ── Gamemode setup ────────────────────────────────────────────────
        const gamemode = guildConfig.gamemode || 'none';
        const gmCfg    = guildConfig.gamemodeConfig || {};

        // Start boss timer on first message if not already running
        if (gamemode === 'boss' && !bossTimers.has(message.guildId) && !guildConfig.bossActive) {
            startBossTimer(client, message.guildId);
        }

        // Calculate expected number based on gamemode
        let expected;
        switch(gamemode) {
            case 'reverse': {
                const from = gmCfg.from || 100;
                if (!guildConfig.reverseStart) {
                    guildConfig.reverseStart = from;
                    client.saveConfig();
                }
                expected = guildConfig.reverseStart - (guildConfig.currentCount + 1);
                if (expected < 0) expected = 0;
                break;
            }
            case 'skip': {
                const mult = gmCfg.multiplier || 2;
                expected   = (guildConfig.currentCount + 1) * mult;
                break;
            }
            default:
                expected = guildConfig.currentCount + 1;
        }

        const number = parseInt(message.content.trim(), 10);

        // ── AC v2 ─────────────────────────────────────────────────────────
        // Free servers: AC always on
        // Premium servers: respect guildConfig.acEnabled (defaults to true)
        const acEnabled = isPremium ? (guildConfig.acEnabled !== false) : true;

        if (!isOwner && acEnabled) {

            // Relay: block same user counting twice in same round
            if (gamemode === 'relay') {
                if (!guildConfig.relayRound) guildConfig.relayRound = [];
                if (guildConfig.relayRound.includes(userId)) {
                    message.delete().catch(() => {});
                    return message.channel.send(`🔄 **Relay:** You already counted this round! Wait for others.`)
                        .then(m => setTimeout(() => m.delete().catch(() => {}), 4000));
                }
            }

            // 1. Rate limit
            const lastTime = userCooldowns.get(userId) || 0;
            const cooldown = isPremium && guildConfig.acCooldown
                ? guildConfig.acCooldown
                : AC_CONFIG.COOLDOWN_MS;
            if (now - lastTime < cooldown) {
                message.delete().catch(() => {});
                const flagCount = flagUser(client, userId, message.guildId, `Rate-limit violation (${now - lastTime}ms gap)`);
                await sendACAlert(message.channel, message.author, 'Counting too fast', flagCount);
                return;
            }

            // 2. Burst detection
            const history = userCountHistory.get(userId) || [];
            const recent  = history.filter(t => now - t < AC_CONFIG.BURST_WINDOW_MS);
            recent.push(now);
            userCountHistory.set(userId, recent);

            const burstThreshold = isPremium && guildConfig.acBurstThreshold
                ? guildConfig.acBurstThreshold
                : AC_CONFIG.BURST_THRESHOLD;

            if (recent.length >= burstThreshold) {
                message.delete().catch(() => {});
                const flagCount = flagUser(client, userId, message.guildId, `Burst detected (${recent.length} counts in ${AC_CONFIG.BURST_WINDOW_MS / 1000}s)`);
                await sendACAlert(message.channel, message.author, `Burst counting — ${recent.length}x in ${AC_CONFIG.BURST_WINDOW_MS / 1000}s`, flagCount);
                return;
            }

            // 3. Double count (skip in relay — handled above)
            if (gamemode !== 'relay' && guildConfig.lastCounter === userId) {
                message.delete().catch(() => {});
                const flagCount = flagUser(client, userId, message.guildId, 'Double-count attempt');
                await sendACAlert(message.channel, message.author, 'Attempted to count twice in a row', flagCount);
                return;
            }

            // 4. Number skip (normal/boss/speed/relay only — reverse and skip have non-sequential numbers)
            if (['none', 'boss', 'speed', 'relay'].includes(gamemode)) {
                if (number !== expected && number > guildConfig.currentCount) {
                    message.delete().catch(() => {});
                    const flagCount = flagUser(client, userId, message.guildId, `Number skip — sent ${number}, expected ${expected}`);
                    await sendACAlert(message.channel, message.author, `Sent \`${number}\` — expected \`${expected}\` (possible pre-compute)`, flagCount);
                    return;
                }
            }

        } else if (!isOwner && !acEnabled) {
            // AC off — still enforce basic double count rule
            if (gamemode !== 'relay' && guildConfig.lastCounter === userId) {
                message.delete().catch(() => {});
                return message.channel.send(`🚫 You cannot count twice in a row!`)
                    .then(m => setTimeout(() => m.delete().catch(() => {}), 3000));
            }
            // Still handle relay blocking even with AC off
            if (gamemode === 'relay') {
                if (!guildConfig.relayRound) guildConfig.relayRound = [];
                if (guildConfig.relayRound.includes(userId)) {
                    message.delete().catch(() => {});
                    return message.channel.send(`🔄 **Relay:** You already counted this round! Wait for others.`)
                        .then(m => setTimeout(() => m.delete().catch(() => {}), 4000));
                }
            }
        }

        userCooldowns.set(userId, now);

        // ── Correct count ─────────────────────────────────────────────────
        if (number === expected) {
            guildConfig.currentCount = gamemode === 'reverse'
                ? guildConfig.currentCount + 1
                : expected;
            guildConfig.lastCounter = userId;
            guildConfig.streak      = (guildConfig.streak ?? 0) + 1;
            if (guildConfig.streak > (guildConfig.bestStreak ?? 0)) {
                guildConfig.bestStreak = guildConfig.streak;
            }

            message.react('✅');

            // Global leaderboard
            if (!client.config.globalLeaderboard) client.config.globalLeaderboard = {};
            const lb = client.config.globalLeaderboard;
            if (!lb[message.guildId]) lb[message.guildId] = { name: message.guild.name, score: 0 };
            lb[message.guildId].score = Math.max(lb[message.guildId].score, guildConfig.currentCount);
            lb[message.guildId].name  = message.guild.name;

            // Global user stats
            if (!client.config.globalUsers) client.config.globalUsers = {};
            if (!client.config.globalUsers[userId]) {
                client.config.globalUsers[userId] = { totalCounts: 0, bestStreak: 0, tags: [] };
            }
            client.config.globalUsers[userId].totalCounts++;
            if (guildConfig.streak > (client.config.globalUsers[userId].bestStreak || 0)) {
                client.config.globalUsers[userId].bestStreak = guildConfig.streak;
            }

            // ── Gamemode success handling ─────────────────────────────────

            // Relay: log this user as having counted this round
            if (gamemode === 'relay') {
                if (!guildConfig.relayRound) guildConfig.relayRound = [];
                guildConfig.relayRound.push(userId);
            }

            // Speed: record start time on first count
            if (gamemode === 'speed' && !guildConfig.speedStart) {
                guildConfig.speedStart = Date.now();
            }

            // Speed: check if target reached
            if (gamemode === 'speed' && gmCfg.target && guildConfig.currentCount >= gmCfg.target) {
                const elapsed = ((Date.now() - guildConfig.speedStart) / 1000).toFixed(1);
                const embed = new EmbedBuilder()
                    .setColor(0xFFD700)
                    .setTitle('⚡ Speed Round Complete!')
                    .setDescription(`You counted to **${gmCfg.target.toLocaleString()}** in **${elapsed}s**! 🎉`)
                    .setFooter({ text: 'DCI Counting • Speed Round' })
                    .setTimestamp();
                await message.channel.send({ embeds: [embed] });
                guildConfig.speedStart   = null;
                guildConfig.currentCount = 0;
                guildConfig.lastCounter  = null;
                guildConfig.streak       = 0;
                guildConfig.relayRound   = [];
                client.saveConfig();
                return;
            }

            // Boss: check if boss HP reached
            if (gamemode === 'boss' && gmCfg.hp && guildConfig.currentCount >= gmCfg.hp) {
                stopBossTimer(message.guildId);
                const embed = new EmbedBuilder()
                    .setColor(0x22c55e)
                    .setTitle('👹 Boss Defeated!')
                    .setDescription(`The server counted to **${gmCfg.hp.toLocaleString()}** HP and defeated the boss! 🎉`)
                    .setFooter({ text: 'DCI Counting • Boss Battle' })
                    .setTimestamp();
                await message.channel.send({ embeds: [embed] });
                guildConfig.currentCount = 0;
                guildConfig.lastCounter  = null;
                guildConfig.streak       = 0;
                guildConfig.bossActive   = false;
                client.saveConfig();
                setTimeout(() => startBossTimer(client, message.guildId), 5000);
                return;
            }

            // Reverse: check if countdown complete
            if (gamemode === 'reverse') {
                const from = gmCfg.from || 100;
                if (guildConfig.currentCount >= from) {
                    const embed = new EmbedBuilder()
                        .setColor(0x22c55e)
                        .setTitle('⬇️ Reverse Complete!')
                        .setDescription(`Counted all the way down from **${from.toLocaleString()}** to **0**! 🎉`)
                        .setTimestamp();
                    await message.channel.send({ embeds: [embed] });
                    guildConfig.currentCount = 0;
                    guildConfig.reverseStart = null;
                    guildConfig.lastCounter  = null;
                    guildConfig.streak       = 0;
                    client.saveConfig();
                    return;
                }
            }

            client.saveConfig();

            // ── Goal celebration ──────────────────────────────────────────
            const goal = guildConfig.goal ?? null;
            if (goal && guildConfig.currentCount === goal) {
                const customMsg = guildConfig.celebrationMsg?.trim() || null;
                const celebEmbed = new EmbedBuilder()
                    .setColor(0xFFD700)
                    .setTitle('🎉 GOAL REACHED!')
                    .setDescription(
                        isPremium && customMsg
                            ? customMsg
                            : `This server just counted to **${goal.toLocaleString()}**!\n\nIncredible work everyone. Set a new target with \`/setgoal\`!`
                    )
                    .setTimestamp();
                if (isPremium && customMsg) {
                    celebEmbed.setFooter({ text: `Reached ${goal.toLocaleString()} • DCI Counting` });
                }
                await message.channel.send({ embeds: [celebEmbed] });
                delete guildConfig.goal;
                client.saveConfig();
            }

        // ── Wrong count ───────────────────────────────────────────────────
        } else {
            message.react('❌');

            const finalScore = guildConfig.currentCount;
            const saves      = guildConfig.saves    ?? 0;
            const maxSaves   = guildConfig.maxSaves ?? 3;

            // Boss mode: wrong count = boss attacks immediately
            if (gamemode === 'boss') {
                stopBossTimer(message.guildId);
                const hp = gmCfg.hp || 200;
                guildConfig.currentCount = 0;
                guildConfig.lastCounter  = null;
                guildConfig.streak       = 0;
                guildConfig.saves        = 0;
                guildConfig.bossActive   = false;
                client.saveConfig();
                const embed = new EmbedBuilder()
                    .setColor('#ef4444')
                    .setTitle('👹 Boss Attack!')
                    .setDescription(
                        `<@${userId}> made a mistake and the boss attacked!\n\n` +
                        `Count reset. Get to **${hp.toLocaleString()}** next time!`
                    )
                    .setTimestamp();
                await message.channel.send({ embeds: [embed] });
                setTimeout(() => startBossTimer(client, message.guildId), 3000);
                return;
            }

            // Premium saves
            if (isPremium && saves < maxSaves) {
                guildConfig.saves = saves + 1;
                client.saveConfig();
                return message.reply(
                    `🛡️ **Save Used (${guildConfig.saves}/${maxSaves}):** ` +
                    `Count stays at **${guildConfig.currentCount}**. ` +
                    `${maxSaves - guildConfig.saves} save(s) remaining.`
                );
            }

            // Reset everything
            guildConfig.currentCount = 0;
            guildConfig.lastCounter  = null;
            guildConfig.streak       = 0;
            guildConfig.saves        = 0;
            guildConfig.speedStart   = null;
            guildConfig.reverseStart = null;
            guildConfig.relayRound   = [];
            client.saveConfig();

            const noSavesWarning = isPremium && saves >= maxSaves
                ? `\n*(All ${maxSaves} saves were used up.)*`
                : '';

            const failMessages = {
                speed:   `💥 <@${userId}> ruined the speed run at **${finalScore}**! Back to 1.${noSavesWarning}`,
                relay:   `💥 <@${userId}> broke the relay at **${finalScore}**! Round reset.${noSavesWarning}`,
                reverse: `💥 <@${userId}> messed up the countdown at **${finalScore}**! Starting over.${noSavesWarning}`,
                skip:    `💥 <@${userId}> skipped wrong at **${finalScore}**! Next is **${gmCfg.multiplier || 2}**.${noSavesWarning}`,
                none:    `💥 <@${userId}> ruined it at **${finalScore}**! Next number is **1**.${noSavesWarning}`,
            };

            message.reply(failMessages[gamemode] || failMessages.none);
        }
    },
};
