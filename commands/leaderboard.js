const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('leaderboard')
        .setDescription('🏆 View the global counting leaderboards')
        .addStringOption(opt =>
            opt.setName('type')
                .setDescription('Which leaderboard to view')
                .setRequired(false)
                .addChoices(
                    { name: '🌐 Servers — highest count reached', value: 'servers' },
                    { name: '👤 Users — most counts submitted',   value: 'users'   },
                )),

    async execute(interaction, client) {
        await interaction.deferReply();

        const type = interaction.options.getString('type') || 'servers';

        if (type === 'servers') {
            const lb = client.config.globalLeaderboard || {};
            const sorted = Object.entries(lb)
                .sort(([, a], [, b]) => b.score - a.score)
                .slice(0, 10);

            if (!sorted.length) {
                return interaction.editReply('❌ No server data yet.');
            }

            const medals = ['🥇', '🥈', '🥉'];
            const rows = sorted.map(([guildId, data], i) => {
                const medal = medals[i] || `\`#${i + 1}\``;
                const isThis = guildId === interaction.guildId ? ' ◄' : '';
                return `${medal} **${data.name}** — \`${data.score.toLocaleString()}\`${isThis}`;
            }).join('\n');

            const thisGuild = lb[interaction.guildId];
            const thisRank  = sorted.findIndex(([id]) => id === interaction.guildId) + 1;

            const embed = new EmbedBuilder()
                .setTitle('🌐 Global Server Leaderboard')
                .setDescription(rows)
                .setColor('#38bdf8')
                .setFooter({
                    text: thisGuild
                        ? `This server — Rank #${thisRank || '10+'} • Best: ${thisGuild.score.toLocaleString()}`
                        : 'This server has no score yet',
                    iconURL: interaction.guild.iconURL() || undefined
                })
                .setTimestamp();

            return interaction.editReply({ embeds: [embed] });
        }

        if (type === 'users') {
            const users = client.config.globalUsers || {};
            const sorted = Object.entries(users)
                .filter(([, u]) => u.totalCounts > 0)
                .sort(([, a], [, b]) => b.totalCounts - a.totalCounts)
                .slice(0, 10);

            if (!sorted.length) {
                return interaction.editReply('❌ No user data yet.');
            }

            const medals = ['🥇', '🥈', '🥉'];
            const rows = await Promise.all(sorted.map(async ([userId, data], i) => {
                const medal = medals[i] || `\`#${i + 1}\``;
                const isThis = userId === interaction.user.id ? ' ◄' : '';
                let username;
                try {
                    const u = await client.users.fetch(userId);
                    username = u.username;
                } catch {
                    username = `\`${userId}\``;
                }
                const tags = data.tags?.length ? ` [${data.tags.join(', ')}]` : '';
                return `${medal} **${username}**${tags} — \`${data.totalCounts.toLocaleString()}\` counts`;
            }));

            const thisUser = users[interaction.user.id];
            const thisRank = sorted.findIndex(([id]) => id === interaction.user.id) + 1;

            const embed = new EmbedBuilder()
                .setTitle('👤 Global User Leaderboard')
                .setDescription(rows.join('\n'))
                .setColor('#a855f7')
                .setFooter({
                    text: thisUser
                        ? `You — Rank #${thisRank || '10+'} • ${thisUser.totalCounts.toLocaleString()} counts`
                        : 'You have no counts yet',
                    iconURL: interaction.user.displayAvatarURL()
                })
                .setTimestamp();

            return interaction.editReply({ embeds: [embed] });
        }
    }
};