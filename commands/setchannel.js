const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('setchannel')
        .setDescription('📍 Set the counting channel | v2.0 Beta')
        .addChannelOption(option => 
            option.setName('channel')
                .setDescription('The channel to use for counting')
                .setRequired(true))
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),

    async execute(interaction, client) {
        const channel = interaction.options.getChannel('channel');

        // Initialize guild config if it doesn't exist
        if (!client.config[interaction.guildId]) {
            client.config[interaction.guildId] = {
                currentCount: 0,
                isPremium: false
            };
        }

        client.config[interaction.guildId].channelId = channel.id;

        // Save to file
        await client.saveConfig();

        await interaction.reply({
            content: `✅ **Success!** Counting channel has been set to ${channel}.`,
            ephemeral: true
        });
    },
};
