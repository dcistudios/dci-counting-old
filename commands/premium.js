const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const OWNERS = ['1149841240897114154', '1478867238550503577'];

module.exports = {
    data: new SlashCommandBuilder()
        .setName('premium')
        .setDescription('💎 Manage Premium status (Owner Only)')
        .addSubcommand(sub => 
            sub.setName('add')
               .setDescription('Add premium to a guild')
               .addStringOption(opt => opt.setName('guildid').setDescription('The Guild ID').setRequired(true)))
        .addSubcommand(sub => 
            sub.setName('check')
               .setDescription('Check current guild status')),

    async execute(interaction, client) {
        const sub = interaction.options.getSubcommand();

        if (sub === 'add') {
            if (!OWNERS.includes(interaction.user.id)) return interaction.reply({ content: '❌ Developer only.', ephemeral: true });
            
            const gId = interaction.options.getString('guildid');
            if (!client.config[gId]) client.config[gId] = { currentCount: 0 };
            
            client.config[gId].isPremium = true;
            client.saveConfig();
            return interaction.reply(`✅ Guild \`${gId}\` is now **Premium**.`);
        }

        if (sub === 'check') {
            const isPremium = client.config[interaction.guildId]?.isPremium || false;
            const embed = new EmbedBuilder()
                .setTitle('💎 Premium Status')
                .setDescription(isPremium ? 'This server has **Premium Features** enabled.' : 'This server is on the **Free Tier**.')
                .setColor(isPremium ? '#fbbf24' : '#64748b');
            
            return interaction.reply({ embeds: [embed] });
        }
    }
};
