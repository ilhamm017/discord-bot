const lavalinkDriver = require("./drivers/LavalinkDriver");
const logger = require("../../utils/logger");

class PlayerManager {
    constructor() {
        this.engineCache = new Map(); // guildId -> lavalink driver
    }

    async getEngine(guildId) {
        if (guildId && !this.engineCache.has(guildId)) {
            this.engineCache.set(guildId, lavalinkDriver);
        }
        return lavalinkDriver;
    }

    async isPlaying(guildId) {
        const player = lavalinkDriver.getPlayer(guildId);
        return !!(player && (player.playing || player.paused));
    }

    async isPaused(guildId) {
        const player = lavalinkDriver.getPlayer(guildId);
        return !!(player && player.paused);
    }

    async getEngineType() {
        return "lavalink";
    }

    async setEngine(guildId, engineType) {
        if (engineType && engineType !== "lavalink") {
            logger.warn(
                `Ignoring engine switch to "${engineType}" in guild ${guildId}; ` +
                "player mode is now Lavalink-only."
            );
        }
        if (guildId) {
            this.engineCache.set(guildId, lavalinkDriver);
        }
        return lavalinkDriver;
    }

    async play(guildId, voiceChannel, track) {
        const result = await lavalinkDriver.play(guildId, voiceChannel, track);

        const { getGuildState } = require("./voice");
        const state = getGuildState(guildId);
        if (state) state.engine = "lavalink";

        return result;
    }

    async stop(guildId) {
        return lavalinkDriver.stop(guildId);
    }

    async skip(guildId) {
        return lavalinkDriver.skip(guildId);
    }

    async pause(guildId) {
        return lavalinkDriver.pause(guildId);
    }

    async resume(guildId) {
        return lavalinkDriver.resume(guildId);
    }

    async cleanup(guildId) {
        await lavalinkDriver.cleanup(guildId);
        this.engineCache.delete(guildId);
    }

    async jumpToIndex(guildId, index) {
        if (typeof lavalinkDriver.jumpToIndex === "function") {
            return lavalinkDriver.jumpToIndex(guildId, index);
        }
        return null;
    }
}

module.exports = new PlayerManager();
