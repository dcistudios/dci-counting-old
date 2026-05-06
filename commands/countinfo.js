const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('countinfo')
        .setDescription('Show the current count, last counter, streak, and goal for this server.'),

    async execute(interaction, client) {
        const guildId = interaction.guildId;
        const guildData = client.config[guildId];

        if (!guildData || guildData.currentCount === undefined) {
            return interaction.reply({
                content: '❌ No counting data found for this server. Start counting first!',
                ephemeral: true
            });
        }

        const count      = guildData.currentCount ?? 0;
        const streak     = guildData.streak        ?? 0;
        const bestStreak = guildData.bestStreak    ?? 0;
        const goal       = guildData.goal          ?? null;
        const lastUserId = guildData.lastCounter   ?? null;
        const saves      = guildData.saves         ?? 0;
        const maxSaves   = guildData.maxSaves      ?? 3;
        const isPremium  = guildData.isPremium     || false;

        // Resolve last counter's username
        let lastCounterDisplay = 'Nobody yet';
        if (lastUserId) {
            try {
                const member = await interaction.guild.members.fetch(lastUserId);
                lastCounterDisplay = member.user.username;
            } catch {
                lastCounterDisplay = `<@${lastUserId}>`;
            }
        }

        // Build progress bar toward goal (20 chars wide)
        let goalValue = 'No goal set — use `/setgoal` to add one.';
        if (goal) {
            const progress = Math.min(count / goal, 1);
            const filled   = Math.round(progress * 20);
            const bar      = '█'.repeat(filled) + '░'.repeat(20 - filled);
            const pct      = (progress * 100).toFixed(1);
            goalValue = `${bar} **${pct}%**\n${count.toLocaleString()} / ${goal.toLocaleString()} (${(goal - count).toLocaleString()} to go)`;
        }

        const embed = new EmbedBuilder()
            .setColor(0x777BB4)
            .setTitle(`📊 Counting Info — ${interaction.guild.name}`)
            .addFields(
                { name: '🔢 Current Count',  value: count.toLocaleString(),      inline: true },
                { name: '🔥 Current Streak', value: streak.toLocaleString(),     inline: true },
                { name: '🏆 Best Streak',    value: bestStreak.toLocaleString(), inline: true },
                { name: '✍️ Last Counter',   value: lastCounterDisplay,          inline: true },
                {
                    name: '🛡️ Saves',
                    value: isPremium ? `${saves} / ${maxSaves} used` : 'Premium only',
                    inline: true
                },
            )
            .addFields({ name: '🎯 Goal Progress', value: goalValue })
            .setTimestamp();

        return interaction.reply({ embeds: [embed] });
    }
};