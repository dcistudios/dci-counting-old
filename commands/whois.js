const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('whois')
        .setDescription('👤 View a user’s global counting profile and Discord info')
        .addUserOption(option => 
            option.setName('target')
                .setDescription('The user to look up')
                .setRequired(false)),

    async execute(interaction, client) {
        const user = interaction.options.getUser('target') || interaction.user;
        const member = await interaction.guild.members.fetch(user.id).catch(() => null);
        
        // Fetch Global Stats from your config
        // Assuming your config structure stores user stats globally
        const globalStats = client.config?.users?.[user.id] || { totalCounts: 0, highestStreak: 0 };

        const embed = new EmbedBuilder()
            .setTitle(`${user.tag}'s Profile`)
            .setThumbnail(user.displayAvatarURL({ dynamic: true }))
            .addFields(
                { name: '🆔 User ID', value: `\`${user.id}\``, inline: true },
                { name: '📅 Joined Discord', value: `<t:${Math.floor(user.createdTimestamp / 1000)}:R>`, inline: true },
                { name: '📥 Joined Server', value: member ? `<t:${Math.floor(member.joinedTimestamp / 1000)}:R>` : 'Not in server', inline: true },
                { name: '🔢 Global Counts', value: `\`${globalStats.totalCounts || 0}\``, inline: true },
                { name: '🔥 Highest Streak', value: `\`${globalStats.highestStreak || 0}\``, inline: true },
                { name: '💎 Premium Status', value: client.config?.[interaction.guildId]?.isPremium ? '✅ Active' : '❌ Inactive', inline: true }
            )
            .setColor(member?.displayHexColor || '#38bdf8')
            .setFooter({ text: 'DCI Studios Global Network • v2.2 Beta' })
            .setTimestamp();

        await interaction.reply({ embeds: [embed] });
    },
};
