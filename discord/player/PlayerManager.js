const ffmpegDriver = require("./drivers/FFmpegDriver");
const lavalinkDriver = require("./drivers/LavalinkDriver");
const { Guild } = require("../../models");
const logger = require("../../utils/logger");

class PlayerManager {
    constructor() {
        this.engineCache = new Map(); // guildId -> engine
    }

    async getEngine(guildId) {
        if (this.engineCache.has(guildId)) return this.engineCache.get(guildId);

        try {
            const guildSettings = await Guild.findOne({ where: { guild_id: guildId } });
            const engineType = guildSettings?.audio_engine || "ffmpeg";
            const engine = engineType === "lavalink" ? lavalinkDriver : ffmpegDriver;
            this.engineCache.set(guildId, engine);
            return engine;
        } catch (error) {
            logger.error(`Error fetching engine for guild ${guildId}:`, error);
            return ffmpegDriver;
        }
    }

    async isPlaying(guildId) {
        const engine = await this.getEngine(guildId);
        if (engine.type === "lavalink") {
            const player = engine.getPlayer(guildId);
            // In v2.x player exists if it was created. Check playing/paused status.
            return !!(player && (player.playing || player.paused));
        } else {
            const { getGuildState } = require("./voice");
            const { AudioPlayerStatus } = require("@discordjs/voice");
            const state = getGuildState(guildId);
            return !!(state && state.player.state.status !== AudioPlayerStatus.Idle);
        }
    }

    async isPaused(guildId) {
        const engine = await this.getEngine(guildId);
        if (engine.type === "lavalink") {
            const player = engine.getPlayer(guildId);
            return !!(player && player.paused);
        } else {
            const { getGuildState } = require("./voice");
            const { AudioPlayerStatus } = require("@discordjs/voice");
            const state = getGuildState(guildId);
            return !!(state && (state.player.state.status === AudioPlayerStatus.Paused || state.player.state.status === AudioPlayerStatus.AutoPaused));
        }
    }

    async getEngineType(guildId) {
        const engine = await this.getEngine(guildId);
        return engine.type;
    }

    async setEngine(guildId, engineType) {
        if (!["ffmpeg", "lavalink"].includes(engineType)) throw new Error("Invalid engine type");

        const wasPlaying = await this.isPlaying(guildId);
        await Guild.upsert({ guild_id: guildId, audio_engine: engineType });
        const engine = engineType === "lavalink" ? lavalinkDriver : ffmpegDriver;

        // Cleanup old engine if needed
        const oldEngine = this.engineCache.get(guildId);
        if (oldEngine && oldEngine !== engine) {
            try {
                logger.info(`Cleaning up old engine ${oldEngine.type} for guild ${guildId} to prepare for switch`);
                await oldEngine.cleanup(guildId);
            } catch (err) {
                logger.error(`Failed to cleanup old engine ${oldEngine.type} for guild ${guildId}:`, err);
            }
        }

        this.engineCache.set(guildId, engine);
        logger.info(`Switched audio engine for guild ${guildId} to ${engineType}`);

        // If it was playing, restart on new engine
        if (wasPlaying) {
            const { getGuildState } = require("./voice");
            // Important: fetch state AFTER cleanup to see if it was recreated or persisted
            const state = getGuildState(guildId);

            // We need channelId to restart. If FFmpeg state was deleted, we might need to rely on 
            // the previous 'wasPlaying' check and hope channelId is in the new engine's logic or 
            // cached elsewhere. Actually, state.channelId should still be there if it was just recreated.

            if (state && state.channelId) {
                const index = state.currentIndex >= 0 ? state.currentIndex : 0;
                const track = state.queue[index];
                if (track) {
                    logger.info(`Restarting playback on new engine ${engineType} for guild ${guildId} in 2s...`);
                    // Use a larger delay to ensure Discord voice state has settled after previous engine destruction
                    setTimeout(async () => {
                        try {
                            const { client } = require("../client");
                            const channel = await client.channels.fetch(state.channelId).catch(() => null);
                            if (channel) {
                                logger.info(`Resuming track on ${engineType}: ${track.title}`);
                                await this.play(guildId, channel, track);
                            } else {
                                logger.error(`Could not fetch channel ${state.channelId} to restart playback.`);
                            }
                        } catch (err) {
                            logger.error(`Failed to restart playback after engine switch:`, err);
                        }
                    }, 2000);
                }
            }
        }

        return engine;
    }

    async play(guildId, voiceChannel, track) {
        const engine = await this.getEngine(guildId);
        const result = await engine.play(guildId, voiceChannel, track);

        // Sync engine type to state for panel UI
        const { getGuildState } = require("./voice");
        const state = getGuildState(guildId);
        if (state) state.engine = engine === lavalinkDriver ? "lavalink" : "ffmpeg";

        return result;
    }

    async stop(guildId) {
        const engine = await this.getEngine(guildId);
        return engine.stop(guildId);
    }

    async skip(guildId) {
        const engine = await this.getEngine(guildId);
        return engine.skip(guildId);
    }

    async pause(guildId) {
        const engine = await this.getEngine(guildId);
        return engine.pause(guildId);
    }

    async resume(guildId) {
        const engine = await this.getEngine(guildId);
        return engine.resume(guildId);
    }

    async cleanup(guildId) {
        const engine = await this.getEngine(guildId);
        await engine.cleanup(guildId);
        this.engineCache.delete(guildId);
    }

    async jumpToIndex(guildId, index) {
        const engine = await this.getEngine(guildId);
        if (typeof engine.jumpToIndex === "function") {
            return engine.jumpToIndex(guildId, index);
        }
        return null;
    }
}

module.exports = new PlayerManager();
