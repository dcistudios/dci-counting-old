const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('integrity')
        .setDescription('🔍 Check the AC v1 logs for a server or user')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
        .addStringOption(opt => 
            opt.setName('id')
                .setDescription('The User ID or Guild ID to inspect')
                .setRequired(true)),

    async execute(interaction, client) {
        const targetId = interaction.options.getString('id');
        const config = client.config;

        // Retrieve flags from the configuration object
        // v2.2 Heuristic Mapping: config.flags[id] = ["Reason", "Timestamp"]
        const flags = config.flags?.[targetId] || [];
        
        const isClean = flags.length === 0;

        const embed = new EmbedBuilder()
            .setTitle(`🔍 Integrity Inspection: ${targetId}`)
            .setColor(isClean ? '#47ff78' : '#ff4747')
            .setThumbnail('https://cdn-icons-png.flaticon.com/512/1063/1063231.png') // Magnifying glass icon
            .setDescription(isClean 
                ? '✅ **Clean Record.**\nNo suspicious activity or automation markers detected by the DCI Anti-Cheat v1 system.' 
                : `⚠️ **Security Flags Detected!**\nThis ID has triggered **${flags.length}** automated warnings.`)
            .addFields(
                { 
                    name: '🛰️ Inspection Status', 
                    value: isClean ? '`VERIFIED SAFE`' : '`UNDER REVIEW`', 
                    inline: true 
                },
                { 
                    name: '🛠️ System Version', 
                    value: '`AC v1.0.2`', 
                    inline: true 
                }
            )
            .setTimestamp()
            .setFooter({ 
                text: 'DCI Integrity Systems • Global Security Protocol', 
                iconURL: client.user.displayAvatarURL() 
            });

        // If flags exist, list the most recent ones (limit to 5 for readability)
        if (!isClean) {
            const flagList = flags.slice(-5).map(f => `• ${f}`).join('\n');
            embed.addFields({ name: '📝 Recent Incident Logs', value: flagList });
        }

        return interaction.reply({ 
            embeds: [embed], 
            ephemeral: true // Keep logs private to staff
        });
    }
};