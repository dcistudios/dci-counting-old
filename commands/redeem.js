const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('redeem')
        .setDescription('Redeem a DCI Premium key for this server')
        .addStringOption(option => 
            option.setName('key')
                .setDescription('The secret key (e.g., DCI-XXXX)')
                .setRequired(true))
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

    async execute(interaction, client) {
        const key = interaction.options.getString('key');
        const guildId = interaction.guild.id;

        // 1. Validate the key
        if (!client.config.keys || !client.config.keys[key]) {
            return interaction.reply({ content: "❌ Invalid or already used key.", ephemeral: true });
        }

        const keyData = client.config.keys[key];

        // 2. Update Guild Config
        if (!client.config[guildId]) client.config[guildId] = { currentCount: 0 };
        
        client.config[guildId].isPremium = true;
        
        if (keyData.duration !== 'permanent') {
            client.config[guildId].premiumUntil = Date.now() + keyData.duration;
        }

        // 3. Cleanup & Save
        delete client.config.keys[key];
        client.saveConfig();

        await interaction.reply({ 
            content: `💎 **Premium Activated!** Your server now has access to all counting perks.`,
            ephemeral: false 
        });
    },
};
