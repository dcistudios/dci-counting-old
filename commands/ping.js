const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('ping')
        .setDescription('🏓 Check the bot\'s latency and heartbeat'),

    async execute(interaction, client) {
        // Calculate latency by comparing timestamps
        const sent = await interaction.reply({ content: 'Pinging...', fetchReply: true, ephemeral: true });
        const roundtrip = sent.createdTimestamp - interaction.createdTimestamp;
        const heartbeat = client.ws.ping;

        const embed = new EmbedBuilder()
            .setTitle('🏓 Pong!')
            .addFields(
                { name: '🌐 API Latency', value: `\`${heartbeat}ms\``, inline: true },
                { name: '⚡ Bot Latency', value: `\`${roundtrip}ms\``, inline: true }
            )
            .setColor(heartbeat < 200 ? '#22c55e' : '#eab308') // Green if fast, Yellow if lagging
            .setFooter({ text: 'DCI Studios v2.2 Beta' })
            .setTimestamp();

        await interaction.editReply({ content: null, embeds: [embed] });
    },
};
