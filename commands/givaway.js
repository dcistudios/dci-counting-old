const { 
    SlashCommandBuilder, 
    EmbedBuilder, 
    ButtonBuilder, 
    ButtonStyle, 
    ActionRowBuilder, 
    PermissionFlagsBits, 
    ChannelType 
} = require('discord.js');
const ms = require('ms');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('giveaway')
        .setDescription('🚀 Start an advanced premium giveaway')
        .addStringOption(o => o.setName('prize').setDescription('What are they winning?').setRequired(true))
        .addStringOption(o => o.setName('duration').setDescription('How long? (e.g. 1h, 1d, 30m)').setRequired(true))
        .addStringOption(o => o.setName('key_expiry').setDescription('Prize key life (e.g. 30d, perm)').setRequired(true))
        .addIntegerOption(o => o.setName('winners').setDescription('Number of winners').setMinValue(1).setMaxValue(10))
        .addChannelOption(o => o.setName('channel').setDescription('Channel to host in').addChannelTypes(ChannelType.GuildText))
        .addMentionableOption(o => o.setName('ping').setDescription('Role or everyone to notify'))
        .addStringOption(o => o.setName('image').setDescription('Banner Image URL'))
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

    async execute(interaction, client) {
        const prize = interaction.options.getString('prize');
        const durationInput = interaction.options.getString('duration');
        const keyExpiry = interaction.options.getString('key_expiry');
        const winners = interaction.options.getInteger('winners') || 1;
        const channel = interaction.options.getChannel('channel') || interaction.channel;
        const ping = interaction.options.getMentionable('ping');
        const image = interaction.options.getString('image');

        const durationMs = ms(durationInput);
        if (!durationMs) return interaction.reply({ content: '❌ Invalid time format! Use 1m, 1h, 1d.', ephemeral: true });

        const endTime = Date.now() + durationMs;
        const endTs = Math.floor(endTime / 1000);

        // 1. Create the Visual Embed
        const embed = new EmbedBuilder()
            .setTitle(`💎 PREMIUM GIVEAWAY: ${prize}`)
            .setColor(0x38bdf8)
            .addFields(
                { name: '⌛ Ends', value: `<t:${endTs}:R>`, inline: true },
                { name: '👥 Winners', value: `${winners}`, inline: true },
                { name: '🔑 Prize Key', value: `\`${keyExpiry}\``, inline: true }
            )
            .setFooter({ text: `Entries: 0 • Hosted by ${interaction.user.username}` });

        if (image) embed.setImage(image);

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('g_join')
                .setLabel('Enter Giveaway')
                .setEmoji('🎉')
                .setStyle(ButtonStyle.Success)
        );

        // 2. Start the Giveaway
        const msg = await channel.send({ 
            content: ping ? `${ping}` : null, 
            embeds: [embed], 
            components: [row] 
        });

        await interaction.reply({ content: `✅ Giveaway live in ${channel}! View at: http://localhost:9003`, ephemeral: true });

        // 3. Save to Global Config for the Web Dashboard
        if (!client.config.giveaways) client.config.giveaways = [];
        
        const gData = {
            id: msg.id,
            prize,
            keyExpiry,
            startTime: Date.now(),
            endTime: endTime,
            winners,
            entries: [],
            guildId: interaction.guildId
        };

        client.config.giveaways.push(gData);
        client.saveConfig();

        // 4. Handle Button Interactions
        const collector = msg.createMessageComponentCollector({ time: durationMs });

        collector.on('collect', async i => {
            if (i.customId !== 'g_join') return;

            // Blacklist check
            if (client.config.globalBlacklist?.includes(i.user.id)) {
                return i.reply({ content: '🚫 You are blacklisted from DCI giveaways.', ephemeral: true });
            }

            const currentG = client.config.giveaways.find(x => x.id === msg.id);
            if (!currentG) return i.reply({ content: '❌ Giveaway data not found.', ephemeral: true });

            if (currentG.entries.includes(i.user.id)) {
                return i.reply({ content: '❌ You already entered!', ephemeral: true });
            }

            // Add entry and save
            currentG.entries.push(i.user.id);
            client.saveConfig();

            // Update Embed
            embed.setFooter({ text: `Entries: ${currentG.entries.length} • Hosted by ${interaction.user.username}` });
            await msg.edit({ embeds: [embed] });

            await i.reply({ content: '✅ Entry confirmed! Good luck.', ephemeral: true });
        });

        // 5. Pick Winners at the end
        collector.on('end', async () => {
            const finalG = client.config.giveaways.find(x => x.id === msg.id);
            if (!finalG) return;

            const winnersList = [];
            const pool = [...finalG.entries];

            // Randomly select winners
            for (let i = 0; i < Math.min(finalG.winners, pool.length); i++) {
                const winnerId = pool.splice(Math.floor(Math.random() * pool.length), 1)[0];
                winnersList.push(winnerId);
            }

            if (winnersList.length > 0) {
                const mentions = winnersList.map(id => `<@${id}>`).join(', ');
                await channel.send(`🎊 **Congratulations ${mentions}!** You won the **${prize}**!`);

                // Automated Key Delivery
                for (const winId of winnersList) {
                    const prizeKey = `DCI-WIN-${Math.random().toString(36).substring(2, 11).toUpperCase()}`;
                    const duration = finalG.keyExpiry === 'perm' ? 'permanent' : ms(finalG.keyExpiry);
                    
                    if (!client.config.keys) client.config.keys = {};
                    client.config.keys[prizeKey] = { duration: duration };
                    client.saveConfig();

                    const user = await client.users.fetch(winId).catch(() => null);
                    if (user) {
                        user.send(`🏆 **You won a giveaway!**\nPrize: **${prize}**\nYour Key: \`${prizeKey}\`\nRedeem with \`/redeem key:${prizeKey}\` in your server.`).catch(() => {});
                    }
                }
            } else {
                await channel.send(`❌ No one entered the giveaway for **${prize}**.`);
            }

            // Update original message
            const endEmbed = EmbedBuilder.from(embed)
                .setTitle(`🏁 GIVEAWAY ENDED`)
                .setDescription(`**Winners:** ${winnersList.length > 0 ? winnersList.map(id => `<@${id}>`).join(', ') : 'No valid entries.'}`)
                .setColor(0x64748b);
            
            await msg.edit({ embeds: [endEmbed], components: [] });

            // Remove from active dashboard list
            client.config.giveaways = client.config.giveaways.filter(x => x.id !== msg.id);
            client.saveConfig();
        });
    }
};
