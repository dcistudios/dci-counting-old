const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('setgoal')
        .setDescription('Set a counting goal for this server. A celebration fires when the count hits it.')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
        .addIntegerOption(option =>
            option.setName('number')
                .setDescription('The target number to celebrate (0 to clear the goal)')
                .setMinValue(0)
                .setRequired(true)
        ),

    async execute(interaction, client) {
        const guildId = interaction.guildId;
        const goal = interaction.options.getInteger('number');

        // Ensure guild config exists
        if (!client.config[guildId]) client.config[guildId] = {};

        if (goal === 0) {
            delete client.config[guildId].goal;
            client.saveConfig();

            const embed = new EmbedBuilder()
                .setColor(0x777BB4)
                .setTitle('🎯 Goal Cleared')
                .setDescription('The counting goal for this server has been removed.')
                .setTimestamp();

            return interaction.reply({ embeds: [embed] });
        }

        // Validate goal is ahead of current count
        const currentCount = client.config[guildId].count ?? 0;
        if (goal <= currentCount) {
            return interaction.reply({
                content: `❌ The goal must be higher than the current count (**${currentCount}**).`,
                ephemeral: true
            });
        }

        client.config[guildId].goal = goal;
        client.saveConfig();

        const embed = new EmbedBuilder()
            .setColor(0x777BB4)
            .setTitle('🎯 Goal Set!')
            .setDescription(`The server will celebrate when the count reaches **${goal.toLocaleString()}**!`)
            .addFields({ name: 'Current Count', value: `${currentCount.toLocaleString()}`, inline: true })
            .addFields({ name: 'Numbers Remaining', value: `${(goal - currentCount).toLocaleString()}`, inline: true })
            .setTimestamp();

        return interaction.reply({ embeds: [embed] });
    }
};