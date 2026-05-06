const { Client, Collection, GatewayIntentBits, REST, Routes } = require('discord.js');
const fs = require('fs');
const path = require('path');
const startDashboard = require('./dashboard');
const startGuildPortal = require('./guild-portal');
const colors = require('./colors.js');
require('dotenv').config();

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers
    ]
});

client.commands = new Collection();

// Ensure config exists
if (!fs.existsSync('./guild-configs.json')) {
    fs.writeFileSync('./guild-configs.json', JSON.stringify({ globalUsers: {} }, null, 2));
}
client.config = JSON.parse(fs.readFileSync('./guild-configs.json', 'utf8'));

client.saveConfig = () => {
    fs.writeFileSync('./guild-configs.json', JSON.stringify(client.config, null, 2));
};

const token = process.env.TOKEN;
const CLIENT_ID = process.env.DISCORD_CLIENT_ID;

if (!token || !CLIENT_ID) {
    console.error('Missing TOKEN or DISCORD_CLIENT_ID in .env — cannot start.');
    process.exit(1);
}

// Load Commands
const commandsJSON = [];
const commandFiles = fs.readdirSync('./commands').filter(file => file.endsWith('.js'));
for (const file of commandFiles) {
    const command = require(`./commands/${file}`);
    if (command.data && command.execute) {
        client.commands.set(command.data.name, command);
        commandsJSON.push(command.data.toJSON());
    }
}

// Load Events
const eventFiles = fs.readdirSync('./events').filter(file => file.endsWith('.js'));
for (const file of eventFiles) {
    const event = require(`./events/${file}`);
    if (event.once) {
        client.once(event.name, (...args) => event.execute(...args, client));
    } else {
        client.on(event.name, (...args) => event.execute(...args, client));
    }
}

const rest = new REST({ version: '10' }).setToken(token);
(async () => {
    try {
        console.log(colors.system('Syncing Slash Commands...'));

        await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commandsJSON });
        await client.login(token);

        console.log(colors.success(`v2.0 Online: ${client.user.tag}`));

        startDashboard(client);
        startGuildPortal(client);
    } catch (e) {
        console.error(colors.error('Startup Error:'), e);
    }
})();

// Anti-Crash
process.on('unhandledRejection', e => console.error(colors.error('Unhandled Rejection:'), e));
process.on('uncaughtException', e => console.error(colors.error('Uncaught Exception:'), e));
