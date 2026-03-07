const lavalinkService = require("../LavalinkManager");
const logger = require("../../../utils/logger");
const {
    getPlaybackUrlForTrack,
    primeMyInstantsTrack,
    primeYoutubeTrack,
} = require("../../../utils/common/media_cache");

class LavalinkDriver {
    type = "lavalink";

    async waitForConnected(player, timeoutMs = 5000) {
        const start = Date.now();
        while (Date.now() - start < timeoutMs) {
            if (player.connected) return true;
            await new Promise((r) => setTimeout(r, 200));
        }
        return Boolean(player.connected);
    }

    async waitForSessionId(player, timeoutMs = 4000) {
        const start = Date.now();
        while (Date.now() - start < timeoutMs) {
            if (player?.voice?.sessionId) return player.voice.sessionId;
            await new Promise((r) => setTimeout(r, 100));
        }
        return player?.voice?.sessionId || null;
    }

    isPlayerVoiceReady(player, voiceChannelId) {
        return Boolean(
            player &&
            player.connected === true &&
            player.voiceChannelId === voiceChannelId &&
            player.voice?.sessionId
        );
    }

    async createPlayer(manager, guildId, voiceChannelId) {
        return manager.createPlayer({
            guildId,
            voiceChannelId,
            textChannelId: null,
            selfDeaf: true,
            selfMute: false,
            volume: 100,
        });
    }

    async preparePlayerForChannel(player, voiceChannelId) {
        if (player.voiceChannelId !== voiceChannelId) {
            if (player.voiceChannelId) {
                await player.changeVoiceState({
                    voiceChannelId,
                    selfDeaf: true,
                    selfMute: false,
                });
            } else {
                player.options.voiceChannelId = voiceChannelId;
            }
        }

        if (!player.connected) {
            player.options.voiceChannelId = voiceChannelId;
            await player.connect();
        }
    }

    async recreatePlayer(manager, guildId, voiceChannelId) {
        const stalePlayer = manager.players.get(guildId);
        if (stalePlayer) {
            await stalePlayer.destroy().catch(() => { });
        }
        return this.createPlayer(manager, guildId, voiceChannelId);
    }

    async ensureVoiceReady(manager, guildId, voiceChannel) {
        let player = manager.players.get(guildId);
        if (!player) {
            player = await this.createPlayer(manager, guildId, voiceChannel.id);
        }

        await this.preparePlayerForChannel(player, voiceChannel.id);

        let connected = await this.waitForConnected(player, 6000);
        let sessionId = connected ? await this.waitForSessionId(player, 3000) : null;

        if (!connected || !sessionId || player.voiceChannelId !== voiceChannel.id) {
            logger.warn(
                `Lavalink voice not ready for guild ${guildId}; recreating player once.`,
                {
                    connected,
                    voiceChannelId: player.voiceChannelId,
                    expectedVoiceChannelId: voiceChannel.id,
                    hasSessionId: Boolean(sessionId),
                }
            );

            player = await this.recreatePlayer(manager, guildId, voiceChannel.id);
            await this.preparePlayerForChannel(player, voiceChannel.id);
            connected = await this.waitForConnected(player, 6000);
            sessionId = connected ? await this.waitForSessionId(player, 4000) : null;
        }

        if (!connected || !sessionId || player.voiceChannelId !== voiceChannel.id) {
            const closeInfo = lavalinkService.getLastVoiceClose(guildId);
            if (closeInfo?.code === 4017) {
                throw new Error(
                    "LAVALINK_DAVE_REQUIRED: Discord voice menolak koneksi Lavalink " +
                    "(E2EE/DAVE protocol required). Upgrade Lavalink ke v4.2+."
                );
            }

            throw new Error(
                "LAVALINK_VOICE_NOT_CONNECTED: Bot belum tersambung ke voice channel. " +
                "Periksa permission Connect/Speak dan pastikan bot benar-benar join channel."
            );
        }

        return player;
    }

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

        const player = await this.ensureVoiceReady(manager, guildId, voiceChannel);

        // If switching engines, make sure we stop anything currently 'playing' in Lavalink's mind
        if (player.playing) {
            await this.stop(guildId);
            await new Promise(r => setTimeout(r, 200));
        }

        if (track?.source === "myinstants") {
            try {
                await primeMyInstantsTrack(track);
            } catch (error) {
                logger.warn("MyInstants local audio cache prime failed; falling back to remote URL.", {
                    title: track?.title || null,
                    url: track?.originalUrl || track?.url || null,
                    message: error?.message || String(error),
                });
            }
        }

        if (track?.youtubeVideoId) {
            try {
                await primeYoutubeTrack(track);
            } catch (error) {
                logger.warn("YouTube local audio cache prime failed; falling back to source URL.", {
                    title: track?.title || null,
                    url: track?.originalUrl || track?.url || null,
                    videoId: track?.youtubeVideoId || null,
                    message: error?.message || String(error),
                });
            }
        }

        const cachedPlaybackUrl = getPlaybackUrlForTrack(track);
        const query = cachedPlaybackUrl || track.url || track.title;
        const originalQuery = track.originalUrl || track.originUrl || track.url || track.title;
        logger.debug(`Lavalink Search Query: "${query}"`);

        let searchResult = await player.search({ query });

        if (
            query !== originalQuery &&
            (!searchResult.tracks || searchResult.tracks.length === 0)
        ) {
            logger.warn(
                `Cached playback URL failed for guild ${guildId}; falling back to source URL.`,
                {
                    query,
                    originalQuery,
                    videoId: track?.youtubeVideoId || null,
                }
            );
            searchResult = await player.search({ query: originalQuery });
        }

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

        if (!this.isPlayerVoiceReady(player, voiceChannel.id)) {
            throw new Error(
                "LAVALINK_VOICE_NOT_READY: Voice session Lavalink belum siap untuk mulai playback."
            );
        }

        await player.play({
            clientTrack: lavalinkTrack,
            noReplace: false
        });

        // Guard against silent-play false positive: track started event can happen while voice is disconnected.
        const stillConnected = await this.waitForConnected(player, 1500);
        const sessionId = stillConnected ? await this.waitForSessionId(player, 1500) : null;
        if (!stillConnected || !sessionId || player.voiceChannelId !== voiceChannel.id) {
            await this.stop(guildId).catch(() => { });
            throw new Error(
                "LAVALINK_VOICE_DISCONNECTED_DURING_PLAY: Playback dimulai saat voice disconnected."
            );
        }

        // Ensure volume is set and player is not paused
        await player.setVolume(100);
        if (player.paused) {
            await player.resume();
        }

        lavalinkService.clearLastVoiceClose(guildId);

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
                state: {
                    status,
                    playing: Boolean(player.playing),
                    paused: Boolean(player.paused),
                }
            },
            repeatMode: player.repeatMode === "track" ? "track" : (player.repeatMode === "queue" ? "all" : "off"),
            engine: "lavalink"
        };
    }
}

module.exports = new LavalinkDriver();
