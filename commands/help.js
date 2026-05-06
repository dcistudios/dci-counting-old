const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('help')
        .setDescription('📚 View all available commands and bot information'),

    async execute(interaction, client) {
        const embed = new EmbedBuilder()
            .setTitle('📚 DCI Studios | Help Menu')
            .setDescription('Welcome to the **v2.2 Beta** counting engine. Below are the commands available to you based on your permissions.')
            .setColor('#38bdf8')
            .setThumbnail(client.user.displayAvatarURL())
            .addFields(
                { 
                    name: '🔢 Counting Commands', 
                    value: '`/stats` - View global bot analytics\n`/whois` - View a user\'s global counting profile\n`/ping` - Check bot latency', 
                    inline: false 
                },
                { 
                    name: '🛠️ Staff & Setup', 
                    value: '`/setchannel` - Configure the counting channel\n`/setnumber` - Correct the current count\n`/premium check` - View server tier status', 
                    inline: false 
                },
                { 
                    name: '👑 Developer Only', 
                    value: '`/eval` - Execute raw code\n`/resetscore` - Wipe a user\'s global data\n`/assign_tag` - Manage user tags\n`/premium add` - Grant premium status', 
                    inline: false 
                },
                {
                    name: '⚙️ Cog Management (Owner Prefix)',
                    value: '`!load`, `!unload`, `!reload` - Manage bot modules live',
                    inline: false
                }
            )
            .setFooter({ text: 'DCI Studios Counting • v2.2 Beta' })
            .setTimestamp();

        await interaction.reply({ embeds: [embed] });
    }
};
