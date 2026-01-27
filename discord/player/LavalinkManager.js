const { LavalinkManager } = require("lavalink-client");
// const { client } = require("../client"); // Removed to avoid circular dependency
const logger = require("../../utils/logger");

class LavalinkService {
    constructor() {
        this.manager = null;
    }

    init(nodes) {
        if (this.manager) return;

        // Lazy load client to avoid circular dependency
        const { client } = require("../client");

        logger.info(`Initializing Lavalink with ${nodes.length} nodes.`);

        this.manager = new LavalinkManager({
            nodes: nodes,
            sendToShard: (guildId, payload) => {
                const guild = client.guilds.cache.get(guildId);
                if (guild) guild.shard.send(payload);
            },
            client: {
                id: client.user.id,
                username: client.user.username,
            },
            autoSkip: true,
            playerOptions: {
                clientBasedPositionUpdateInterval: 100,
                defaultSearchPlatform: "ytsearch",
                volumeDecrementer: 1,
            }
        });

        logger.info(`LavalinkManager created. Nodes in manager: ${this.manager.nodes?.size || this.manager.nodeManager?.nodes?.size || 0}`);

        // Track events on the manager itself
        this.manager.on("debug", (info) => logger.debug(`Lavalink Debug: ${info}`));

        const nodeController = this.manager.nodeManager || this.manager;

        nodeController.on("connect", (node) => {
            logger.info(`Lavalink Node connected: ${node.id || node.options?.id}`);
        });

        nodeController.on("error", (node, error) => {
            logger.error(`Lavalink Node error:`, error);
        });

        nodeController.on("raw", (node, payload) => {
            logger.debug(`Lavalink Raw Payload from ${node.id}: ${JSON.stringify(payload)}`);
        });

        nodeController.on("disconnect", (node, reason) => {
            logger.warn(`Lavalink Node disconnected: ${node.id}. Reason: ${reason}`);
        });

        nodeController.on("reconnecting", (node) => {
            logger.info(`Lavalink Node reconnecting: ${node.id}`);
        });

        this.manager.on("trackStart", (player, track) => {
            logger.info(`Lavalink playing: ${track.info.title} in ${player.guildId}`);
        });

        this.manager.on("trackEnd", async (player, track, payload) => {
            logger.info(`Lavalink track ended: ${track.info.title} (${payload.reason})`);

            // If track was replaced (e.g. by playImmediate), don't trigger auto-next
            if (payload.reason === "replaced") return;
            if (payload.reason === "loadFailed") {
                logger.error("Lavalink load failed", payload);
            }

            // Lazy load queue logic to avoid circle
            const { playNext, ensureQueueState } = require("./queue");
            const { getGuildState } = require("./voice");

            // We need to ensure state exists to manipulate queue index
            const state = getGuildState(player.guildId);
            if (state) {
                // Determine if we should play next
                // Note: ensureQueueState logic handles 'Idle' for local, here we manually trigger next
                await playNext(state);
            }
        });

        this.manager.on("trackException", (player, track, payload) => {
            logger.error(`Lavalink track exception in ${player.guildId}: ${track.info.title}`, payload.exception);
        });

        this.manager.on("trackStuck", (player, track, payload) => {
            logger.warn(`Lavalink track stuck in ${player.guildId}: ${track.info.title}`, payload);
        });

        this.manager.on("playerCreate", (player) => {
            logger.info(`Lavalink player created for guild: ${player.guildId}`);
        });

        this.manager.on("playerDestroy", (player, reason) => {
            logger.info(`Lavalink player destroyed for guild: ${player.guildId}. Reason: ${reason}`);
        });

        this.manager.on("playerDisconnect", (player, voiceChannelId) => {
            logger.info(`Lavalink player disconnected from ${voiceChannelId} in guild: ${player.guildId}`);
        });

        // Hook voice raw events
        client.on("raw", (d) => this.manager.sendRawData(d));

        // CRITICAL for v2.x: You must call init() to start the manager and connect nodes
        logger.info("Calling manager.init() to start Lavalink connections...");
        this.manager.init({
            id: client.user.id,
            username: client.user.username
        });

        return this.manager;
    }

    getManager() {
        return this.manager;
    }

    getPlayer(guildId) {
        return this.manager?.players.get(guildId);
    }
}

module.exports = new LavalinkService();
