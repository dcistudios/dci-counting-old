const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const OWNERS = ['1149841240897114154', '1478867238550503577'];

module.exports = {
    // This 'data' object is what the reloader is looking for
    data: new SlashCommandBuilder()
        .setName('eval')
        .setDescription('🛠️ Execute JavaScript code (Owner Only)')
        .addStringOption(opt => opt.setName('code').setDescription('Code to run').setRequired(true)),

    async execute(interaction, client) {
        if (!OWNERS.includes(interaction.user.id)) return interaction.reply({ content: '❌ Developer only.', ephemeral: true });

        const code = interaction.options.getString('code');
        try {
            // 'await' fixes the "Promise <pending>" issue
            let evaled = await eval(code);
            
            if (typeof evaled !== "string") evaled = require("util").inspect(evaled);

            const embed = new EmbedBuilder()
                .setTitle('💻 Eval Output')
                .setDescription(`\`\`\`js\n${evaled.slice(0, 2000)}\n\`\`\``)
                .setColor('#22c55e');
            
            await interaction.reply({ embeds: [embed] });
        } catch (err) {
            await interaction.reply({ content: `❌ Error: \`\`\`${err}\`\`\``, ephemeral: true });
        }
    }
};
