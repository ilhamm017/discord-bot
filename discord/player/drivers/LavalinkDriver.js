const lavalinkService = require("../LavalinkManager");
const logger = require("../../../utils/logger");

class LavalinkDriver {
    type = "lavalink";
    async play(guildId, voiceChannel, track) {
        let manager = lavalinkService.getManager();

        // 1. Wait for manager initialization if needed
        if (!manager) {
            logger.warn("Lavalink manager not initialized yet. Waiting 2 seconds...");
            await new Promise(r => setTimeout(r, 2000));
            manager = lavalinkService.getManager();
        }

        if (!manager) throw new Error("Lavalink manager not initialized. Please try again in a few seconds.");

        // 2. Wait for at least one node to be connected
        const isNodeConnected = () => {
            const nodes = manager.nodeManager?.nodes || manager.nodes;
            if (!nodes) return false;
            return Array.from(nodes.values()).some(n => n.connected);
        };

        if (!isNodeConnected()) {
            logger.warn("No Lavalink nodes connected yet. Waiting for connectivity...");
            // Wait up to 30 seconds for connection
            for (let i = 0; i < 30; i++) {
                await new Promise(r => setTimeout(r, 1000));
                if (isNodeConnected()) break;
            }
        }

        if (!isNodeConnected()) {
            throw new Error("Lavalink server is still starting up or connection failed. Please wait a minute and try again.");
        }

        let player = manager.players.get(guildId);
        if (!player) {
            player = await manager.createPlayer({
                guildId: guildId,
                voiceChannelId: voiceChannel.id,
                textChannelId: null, // Can be set later
                selfDeaf: true,
                selfMute: false,
                volume: 100
            });
        }

        if (!player.connected) {
            player.options.voiceChannelId = voiceChannel.id;
            await player.connect();
            // Wait for connection to be confirmed by stats or state
            for (let i = 0; i < 10 && !player.connected; i++) {
                await new Promise(r => setTimeout(r, 200));
            }
        } else if (player.voiceChannelId !== voiceChannel.id) {
            await player.changeVoiceState({ voiceChannelId: voiceChannel.id });
            await new Promise(r => setTimeout(r, 500));
        }

        // If switching engines, make sure we stop anything currently 'playing' in Lavalink's mind
        if (player.playing) {
            await this.stop(guildId);
            await new Promise(r => setTimeout(r, 200));
        }

        const query = track.url || track.title;
        logger.debug(`Lavalink Search Query: "${query}"`);

        const searchResult = await player.search({ query });

        logger.debug(`Lavalink Search Result: loadType=${searchResult.loadType}, tracks=${searchResult.tracks?.length}`);

        if (!searchResult.tracks || searchResult.tracks.length === 0) {
            throw new Error(`No tracks found via Lavalink (LoadType: ${searchResult.loadType})`);
        }

        const lavalinkTrack = searchResult.tracks[0];
        if (track.requestedById) {
            lavalinkTrack.userData = { requesterId: track.requestedById };
        }

        // Unified Queue Strategy:
        // We treat Lavalink as a dumb player. The Queue Logic is in discord/player/queue/playback.js
        // So when we get a play command here, it means "Play this specific track NOW".

        // Clear upcoming tracks to stay in sync with our JS queue
        if (player.queue && Array.isArray(player.queue.tracks)) {
            player.queue.tracks = [];
        }

        // Play now (replaces current track)
        logger.info(`Lavalink starting playback in guild ${guildId}: ${lavalinkTrack.info.title}`);

        await player.play({
            clientTrack: lavalinkTrack,
            noReplace: false
        });

        // Ensure volume is set and player is not paused
        await player.setVolume(100);
        if (player.paused) {
            await player.resume();
        }

        return track;
    }

    async stop(guildId) {
        const player = lavalinkService.getPlayer(guildId);
        if (player) {
            try {
                if (typeof player.stopPlaying === "function") {
                    await player.stopPlaying();
                    logger.debug(`Lavalink player.stopPlaying() called for guild ${guildId}`);
                } else if (typeof player.stop === "function") {
                    await player.stop();
                    logger.debug(`Lavalink player.stop() called for guild ${guildId}`);
                } else if (typeof player.play === "function") {
                    await player.play({ clientTrack: null });
                    logger.debug(`Lavalink player.play(null) used as stop for guild ${guildId}`);
                } else {
                    await player.destroy();
                    logger.debug(`Lavalink player.destroy() used as stop for guild ${guildId}`);
                }
            } catch (err) {
                logger.warn(`Lavalink stop failed for guild ${guildId}, destroying player as fallback.`, err);
                await player.destroy().catch(() => { });
            }
        }
    }

    async skip(guildId) {
        const player = lavalinkService.getPlayer(guildId);
        if (player) await player.skip();
    }

    async pause(guildId) {
        const player = lavalinkService.getPlayer(guildId);
        if (player) await player.pause();
    }

    async resume(guildId) {
        const player = lavalinkService.getPlayer(guildId);
        if (player) await player.resume();
    }

    async cleanup(guildId) {
        const player = lavalinkService.getPlayer(guildId);
        if (player) await player.destroy();
    }

    async jumpToIndex(guildId, index) {
        const player = lavalinkService.getPlayer(guildId);
        if (player && player.queue && player.queue.tracks[index]) {
            const track = player.queue.tracks[index];
            // In v2.x, jump often involves playing the track and removing previous ones
            player.queue.tracks.splice(0, index);
            return player.play({ clientTrack: player.queue.tracks[0] });
        }
        return null;
    }

    getPlayer(guildId) {
        return lavalinkService.getPlayer(guildId);
    }

    getState(guildId) {
        const player = lavalinkService.getPlayer(guildId);
        if (!player) return null;

        // Map Lavalink state to panel-compatible state
        const { AudioPlayerStatus } = require("@discordjs/voice");

        const status = player.playing ? AudioPlayerStatus.Playing :
            (player.paused ? AudioPlayerStatus.Paused : AudioPlayerStatus.Idle);

        const current = player.queue.current;
        const tracks = current ? [current, ...player.queue.tracks] : player.queue.tracks;

        return {
            channelId: player.voiceChannelId,
            currentIndex: 0, // Points to the first item (current track)
            queue: tracks.map(t => ({
                title: t.info.title,
                url: t.info.uri,
                info: {
                    video_details: {
                        durationInSec: t.info.length / 1000,
                        thumbnails: [{ url: t.info.artworkUrl }]
                    }
                },
                requestedById: t.userData?.requesterId
            })),
            player: {
                state: { status }
            },
            repeatMode: player.repeatMode === "track" ? "track" : (player.repeatMode === "queue" ? "all" : "off"),
            engine: "lavalink"
        };
    }
}

module.exports = new LavalinkDriver();
