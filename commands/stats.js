const { SlashCommandBuilder, EmbedBuilder, version } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('stats')
        .setDescription('📊 View v2.2 Beta Global Stats'),

    async execute(interaction, client) {
        const globalData = client.config.globalUsers || {};
        const totalCounts = Object.values(globalData).reduce((s, u) => s + (u.totalCounts || 0), 0);
        const uptime = Math.floor(client.uptime / 60000);

        const embed = new EmbedBuilder()
            .setTitle('🚀 DCI Studios | Analytics')
            .setColor('#38bdf8')
            .addFields(
                { name: '🌐 Servers', value: `\`${client.guilds.cache.size}\``, inline: true },
                { name: '🔢 Global Counts', value: `\`${totalCounts.toLocaleString()}\``, inline: true },
                { name: '⏱️ Uptime', value: `\`${uptime}m\``, inline: true },
                { name: '🛰️ Ping', value: `\`${client.ws.ping}ms\``, inline: true },
                { name: '🛠️ Version', value: '`v2.2 Beta`', inline: true }
            );

        await interaction.reply({ embeds: [embed] });
    }
};
