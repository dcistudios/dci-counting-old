const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');
const fs = require('fs');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('tag-manager')
        .setDescription('Manage DCI Global tags for servers and users')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        // SUBCOMMAND: Server Tagging
        .addSubcommand(sub =>
            sub.setName('server')
               .setDescription('Assign a tag to a server')
               .addStringOption(opt => opt.setName('id').setDescription('The Guild ID').setRequired(true))
               .addStringOption(opt => opt.setName('tag').setDescription('Tag to assign').setRequired(true)
                   .addChoices(
                       { name: 'Premium', value: 'Premium' },
                       { name: 'Partner', value: 'Partner' },
                       { name: 'War-Eligible', value: 'War-Eligible' },
                       { name: 'Verified', value: 'Verified' }
                   )))
        // user tag maker thing
        .addSubcommand(sub =>
            sub.setName('user')
               .setDescription('Assign a tag to a global user')
               .addUserOption(opt => opt.setName('target').setDescription('The user to tag').setRequired(true))
               .addStringOption(opt => opt.setName('tag').setDescription('Tag to assign').setRequired(true)
                   .addChoices(
                       { name: 'Beta-Tester', value: 'Beta-Tester' },
                       { name: 'Bug-Hunter', value: 'Bug-Hunter' },
                       { name: 'Staff', value: 'Staff' },
                       { name: 'Donator', value: 'Donator' }
                   ))),

    async execute(interaction) {
        const config = JSON.parse(fs.readFileSync('./guild-configs.json', 'utf8'));
        const sub = interaction.options.getSubcommand();
        const tagName = interaction.options.getString('tag');

        // server tags logic
        if (sub === 'server') {
            const guildId = interaction.options.getString('id');
            if (!config[guildId]) return interaction.reply({ content: `❌ Guild \`${guildId}\` not found.`, ephemeral: true });
            
            if (!config[guildId].tags) config[guildId].tags = [];
            if (config[guildId].tags.includes(tagName)) return interaction.reply({ content: `ℹ️ Server already has that tag.`, ephemeral: true });

            config[guildId].tags.push(tagName);
            saveConfig(config);

            const embed = new EmbedBuilder()
                .setTitle('🛰️ Server Tag Updated')
                .setDescription(`Server \`${guildId}\` is now tagged as **${tagName}**.`)
                .setColor('#5865F2')
                .setTimestamp();
            return interaction.reply({ embeds: [embed] });
        }

        // user tag logic
        if (sub === 'user') {
            const user = interaction.options.getUser('target');
            if (!config.globalUsers) config.globalUsers = {};
            if (!config.globalUsers[user.id]) config.globalUsers[user.id] = { tags: [], totalCounts: 0 };

            if (config.globalUsers[user.id].tags.includes(tagName)) return interaction.reply({ content: `ℹ️ User already has that tag.`, ephemeral: true });

            config.globalUsers[user.id].tags.push(tagName);
            saveConfig(config);

            const embed = new EmbedBuilder()
                .setTitle('👤 User Tag Updated')
                .setDescription(`${user.tag} is now globally recognized as **${tagName}**.`)
                .setColor('#FFD700') // Gold 
                .setThumbnail(user.displayAvatarURL())
                .setTimestamp();
            return interaction.reply({ embeds: [embed] });
        }
    }
};

function saveConfig(data) {
    fs.writeFileSync('./guild-configs.json', JSON.stringify(data, null, 4));
}