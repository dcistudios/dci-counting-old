const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('invite')
        .setDescription('Get the bot invite and join the DCI community'),

    async execute(interaction) {
        // 1. make the invitese winvite command 9i forgotnto push the actual command 
        const botInvite = 'https://discord.com/api/oauth2/authorize?client_id=${interaction.client.user.id}&permissions=8&scope=bot%20applications.commands`;'
        const communityInvite = 'https://discord.gg/hbeSGytT9d';

        // 2. create cool ass embed
        const embed = new EmbedBuilder()
            .setTitle('🚀 EXPAND THE NETWORK')
            .setDescription(
                'Bring **DCI Counting** to your server or join the high-stakes Global War in our community hub.'
            )
            .addFields(
                { name: '🛰️ Global Link', value: 'Connect your server to the grid.', inline: true },
                { name: '🏆 Community', value: 'Join for prizes and support.', inline: true }
            )
            .setColor('#5865F2')
            .setImage('https://cdn.discordapp.com/avatars/1466994657152995412/753e4bda49b10e118895a71100838e23.webp') // cool logo
            .setFooter({ text: 'DCI Counting • Powering Competitive Counting' });

        // 3. cool ass buttons
        const buttons = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setLabel('Add to Discord')
                .setURL(botInvite)
                .setStyle(ButtonStyle.Link)
                .setEmoji('🤖'),
            new ButtonBuilder()
                .setLabel('Join Community')
                .setURL(communityInvite)
                .setStyle(ButtonStyle.Link)
                .setEmoji('🏘️')
        );

        // 4. send message
        return interaction.reply({ 
            embeds: [embed], 
            components: [buttons] 
        });
    }
};