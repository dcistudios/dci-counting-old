const { SlashCommandBuilder } = require('discord.js');
const OWNERS = ['1149841240897114154', '1478867238550503577'];

module.exports = {
    data: new SlashCommandBuilder()
        .setName('resetscore')
        .setDescription('🧹 Reset a user’s global count (Owner Only)')
        .addUserOption(opt => opt.setName('target').setDescription('User to reset').setRequired(true)),

    async execute(interaction, client) {
        if (!OWNERS.includes(interaction.user.id)) return interaction.reply({ content: '❌ Unauthorized.', ephemeral: true });

        const target = interaction.options.getUser('target');
        if (client.config.globalUsers?.[target.id]) {
            client.config.globalUsers[target.id].totalCounts = 0;
            client.saveConfig();
            return interaction.reply(`✅ Reset global counts for **${target.username}**.`);
        }
        interaction.reply('❌ User not found in database.');
    }
};
