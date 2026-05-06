const { SlashCommandBuilder } = require('discord.js');
const ms = require('ms');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('genkey')
        .setDescription('Generate a premium key (Admins Only)')
        .addStringOption(option => 
            option.setName('duration')
                .setDescription('Duration (e.g., 30d, 1h, or "perm")')
                .setRequired(true)),

    async execute(interaction, client) {
        // Check your JSON arrays
        const isAuth = client.config.admins.includes(interaction.user.id) || 
                       client.config.extraOwners.includes(interaction.user.id);

        if (!isAuth) {
            return interaction.reply({ content: "🚫 You do not have permission to generate keys.", ephemeral: true });
        }

        const input = interaction.options.getString('duration');
        const duration = input === 'perm' ? 'permanent' : ms(input);

        if (!duration) return interaction.reply({ content: "❌ Invalid duration format.", ephemeral: true });

        const newKey = `DCI-${Math.random().toString(36).substring(2, 9).toUpperCase()}`;

        client.config.keys[newKey] = { 
            duration: duration,
            genBy: interaction.user.tag 
        };
        client.saveConfig();

        await interaction.reply({ 
            content: `🎫 **Key Generated:** \`${newKey}\`\nExpires: \`${input}\``, 
            ephemeral: true 
        });
    },
};
