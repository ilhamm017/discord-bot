const fs = require("fs");
const path = require("path");
const { Client, Collection, GatewayIntentBits } = require("discord.js");
const logger = require("../utils/logger");
const config = require("../config.json");
const { token } = config;
const { setPanelUpdater } = require("./player/queue");
const { updateControlPanel } = require("./player/panel");

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildVoiceStates,
    ],
});

client.commands = new Collection();

function loadCommands() {
    const commandsPath = path.join(__dirname, "tools");
    const commandFolders = fs.readdirSync(commandsPath);

    for (const folder of commandFolders) {
        const folderPath = path.join(commandsPath, folder);
        if (!fs.lstatSync(folderPath).isDirectory()) continue;

        const commandFiles = fs
            .readdirSync(folderPath)
            .filter((file) => file.endsWith(".js"));

        for (const file of commandFiles) {
            const filePath = path.join(folderPath, file);
            try {
                const command = require(filePath);
                if (!command || !command.name || typeof command.execute !== "function") {
                    logger.warn(`Skipping invalid command file: ${folder}/${file}`);
                    continue;
                }
                client.commands.set(command.name.toLowerCase(), command);
                logger.debug(`Loaded command: ${command.name}`);
            } catch (error) {
                logger.error(`Failed to load command ${file}:`, error);
            }
        }
    }
}

function loadEvents() {
    const eventsPath = path.join(__dirname, "events");
    const eventFiles = fs
        .readdirSync(eventsPath)
        .filter((file) => file.endsWith(".js"));

    for (const file of eventFiles) {
        try {
            const filePath = path.join(eventsPath, file);
            const event = require(filePath);
            if (event.once) {
                client.once(event.name, (...args) => event.execute(...args));
            } else {
                client.on(event.name, (...args) => event.execute(...args));
            }
            logger.debug(`Loaded event: ${event.name}`);
        } catch (error) {
            logger.error(`Failed to load event ${file}:`, error);
        }
    }
}

async function start() {
    loadCommands();
    loadEvents();

    // Register panel updater
    setPanelUpdater((state) => updateControlPanel(client, state));

    try {
        await client.login(token);

        // Wait for client.user to be defined (Ready state)
        if (!client.user) {
            await new Promise((resolve) => {
                client.once("ready", () => resolve());
            });
        }

        logger.info("Discord client started successfully.");
    } catch (error) {
        logger.error("Failed to login to Discord.", error);
    }
}

module.exports = { start, client };
