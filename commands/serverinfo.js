const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('serverinfo')
        .setDescription('📋 View detailed info about this server'),

    async execute(interaction, client) {
        const guild = interaction.guild;
        await guild.fetch();

        const guildData  = client.config[guild.id] || {};
        const isPremium  = guildData.isPremium || false;
        const count      = guildData.currentCount ?? 0;
        const bestStreak = guildData.bestStreak   ?? 0;
        const goal       = guildData.goal         ?? null;
        const tags       = guildData.tags?.join(', ') || 'None';
        const desc       = isPremium && guildData.customDescription
            ? guildData.customDescription
            : null;

        const owner         = await guild.fetchOwner();
        const textChannels  = guild.channels.cache.filter(c => c.type === 0).size;
        const voiceChannels = guild.channels.cache.filter(c => c.type === 2).size;
        const roles         = guild.roles.cache.size - 1;
        const boosts        = guild.premiumSubscriptionCount ?? 0;
        const boostTier     = guild.premiumTier ?? 0;
        const verifyLevel   = ['None','Low','Medium','High','Highest'][guild.verificationLevel] || 'Unknown';

        // Goal progress bar
        let goalField = null;
        if (goal) {
            const progress = Math.min(count / goal, 1);
            const filled   = Math.round(progress * 20);
            const bar      = '█'.repeat(filled) + '░'.repeat(20 - filled);
            const pct      = (progress * 100).toFixed(1);
            goalField = `${bar} **${pct}%**\n${count.toLocaleString()} / ${goal.toLocaleString()} (${(goal - count).toLocaleString()} to go)`;
        }

        const embed = new EmbedBuilder()
            .setTitle(`📋 ${guild.name}`)
            .setThumbnail(guild.iconURL() || null)
            .setColor(isPremium ? '#fbbf24' : '#38bdf8')
            .addFields(
                { name: '👑 Owner',          value: owner.user.username,          inline: true },
                { name: '🆔 Guild ID',        value: `\`${guild.id}\``,            inline: true },
                { name: '📅 Created',         value: `<t:${Math.floor(guild.createdTimestamp / 1000)}:R>`, inline: true },
                { name: '👥 Members',         value: `\`${guild.memberCount}\``,   inline: true },
                { name: '💬 Text Channels',   value: `\`${textChannels}\``,        inline: true },
                { name: '🔊 Voice Channels',  value: `\`${voiceChannels}\``,       inline: true },
                { name: '🎭 Roles',           value: `\`${roles}\``,               inline: true },
                { name: '✨ Boosts',          value: `\`${boosts}\` (Tier ${boostTier})`, inline: true },
                { name: '🔒 Verification',    value: `\`${verifyLevel}\``,         inline: true },
                { name: '🔢 Current Count',   value: `\`${count.toLocaleString()}\``,     inline: true },
                { name: '🔥 Best Streak',     value: `\`${bestStreak.toLocaleString()}\``, inline: true },
                { name: '💎 Tier',            value: isPremium ? '💎 Premium' : 'Free',    inline: true },
                { name: '🏷️ Tags',           value: tags, inline: false },
            );

        if (desc) {
            embed.setDescription(`*${desc}*`);
        }

        if (goalField) {
            embed.addFields({ name: '🎯 Goal Progress', value: goalField });
        }

        if (guild.bannerURL()) {
            embed.setImage(guild.bannerURL({ size: 1024 }));
        }

        embed
            .setFooter({ text: `DCI Studios Counting • v2.2 Beta${isPremium ? ' • Premium' : ''}` })
            .setTimestamp();

        return interaction.reply({ embeds: [embed] });
    }
};