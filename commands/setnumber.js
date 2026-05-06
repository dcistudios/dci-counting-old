const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('setnumber')
        .setDescription('🔢 Set the current counting number')
        .addIntegerOption(opt => opt.setName('num').setDescription('The number').setRequired(true))
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

    async execute(interaction, client) {
        const num = interaction.options.getInteger('num');
        const data = client.config[interaction.guildId];

        if (!data) return interaction.reply('❌ Set a channel first with `/setchannel`.');

        data.currentCount = num;
        client.saveConfig();
        await interaction.reply(`✅ Current number updated to i**${num}**.`);
    }
};
