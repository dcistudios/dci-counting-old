const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('setsaves')
        .setDescription('Configure how many saves are allowed before the count resets.')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
        .addIntegerOption(option =>
            option.setName('amount')
                .setDescription('Max saves allowed (1–10). Default is 3.')
                .setMinValue(1)
                .setMaxValue(10)
                .setRequired(true)
        ),

    async execute(interaction, client) {
        const guildId = interaction.guildId;
        const amount  = interaction.options.getInteger('amount');

        if (!client.config[guildId]) client.config[guildId] = {};

        const oldMax = client.config[guildId].maxSaves ?? 3;
        client.config[guildId].maxSaves = amount;

        // If current saves exceed the new max, cap them
        if ((client.config[guildId].saves ?? 0) > amount) {
            client.config[guildId].saves = amount;
        }

        client.saveConfig();

        const direction = amount > oldMax ? '⬆️ increased' : amount < oldMax ? '⬇️ decreased' : '↔️ unchanged';

        const embed = new EmbedBuilder()
            .setColor(0x777BB4)
            .setTitle('🛡️ Save Limit Updated')
            .setDescription(`The maximum number of saves has been **${direction}**.`)
            .addFields(
                { name: 'Previous Limit', value: `${oldMax}`, inline: true },
                { name: 'New Limit',      value: `${amount}`, inline: true },
            )
            .setFooter({ text: 'Current saves in use have been capped to the new limit if needed.' })
            .setTimestamp();

        return interaction.reply({ embeds: [embed] });
    }
};