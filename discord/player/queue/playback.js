const { AudioPlayerStatus } = require("@discordjs/voice");
const { getGuildState, cleanupGuild } = require("../voice");
const { persistQueueState, notifyPanel } = require("./state");
const {
    recordPlay,
    clearQueueState,
    saveGuildPlaybackHistory,
} = require("../../../storage/db");
const logger = require("../../../utils/logger");
const {
    primeMyInstantsTrack,
    primeYoutubeTrack,
} = require("../../../utils/common/media_cache");

const PLAY_HISTORY_LIMIT = 25;

function cloneTrackForHistory(track) {
    if (!track || typeof track !== "object") return null;
    return {
        source: track.source || null,
        url: track.url || null,
        originalUrl: track.originalUrl || track.originUrl || track.url || null,
        sourcePageUrl: track.sourcePageUrl || null,
        prePlayDelayMs: Number.isFinite(track.prePlayDelayMs)
            ? Math.max(0, Math.trunc(track.prePlayDelayMs))
            : 0,
        cachedUrl: track.cachedUrl || null,
        youtubeVideoId: track.youtubeVideoId || null,
        title: track.title || track.url || "-",
        requestedById: track.requestedById || null,
        requestedByTag: track.requestedByTag || null,
        requestedBy: track.requestedBy || null,
        info: track.info ? JSON.parse(JSON.stringify(track.info)) : null,
    };
}

function getTrackPrePlayDelayMs(track) {
    if (!track || typeof track !== "object") return 0;
    const rawDelay = Number(track.prePlayDelayMs);
    if (!Number.isFinite(rawDelay) || rawDelay <= 0) return 0;
    return Math.max(0, Math.trunc(rawDelay));
}

function getTrackHistoryKey(track) {
    return track?.youtubeVideoId || track?.originalUrl || track?.url || track?.title || null;
}

function addTrackToHistory(state, track) {
    if (!state) return;
    const snapshot = cloneTrackForHistory(track);
    const historyKey = getTrackHistoryKey(snapshot);
    if (!snapshot || !historyKey) return;

    if (!Array.isArray(state.playHistory)) {
        state.playHistory = [];
    }

    state.playHistory = state.playHistory.filter((item) => {
        return getTrackHistoryKey(item) !== historyKey;
    });
    state.playHistory.unshift(snapshot);
    if (state.playHistory.length > PLAY_HISTORY_LIMIT) {
        state.playHistory = state.playHistory.slice(0, PLAY_HISTORY_LIMIT);
    }
}

function primeTrackInBackground(track) {
    if (!track || typeof track !== "object") return;

    if (track?.source === "myinstants") {
        primeMyInstantsTrack(track).catch((error) => {
            logger.debug("Background MyInstants prefetch failed.", {
                title: track?.title || null,
                url: track?.originalUrl || track?.url || null,
                message: error?.message || String(error),
            });
        });
        return;
    }

    if (track?.youtubeVideoId) {
        primeYoutubeTrack(track).catch((error) => {
            logger.debug("Background YouTube prefetch failed.", {
                title: track?.title || null,
                videoId: track?.youtubeVideoId || null,
                url: track?.originalUrl || track?.url || null,
                message: error?.message || String(error),
            });
        });
    }
}

function prefetchUpcomingTrack(state, currentIndex) {
    if (!state || !Array.isArray(state.queue) || state.queue.length === 0) return;

    let nextIndex = currentIndex + 1;
    if (nextIndex >= state.queue.length) {
        if (state.repeatMode === "all") {
            nextIndex = 0;
        } else {
            return;
        }
    }

    if (nextIndex === currentIndex) return;
    const nextTrack = state.queue[nextIndex];
    if (!nextTrack) return;

    queueMicrotask(() => {
        primeTrackInBackground(nextTrack);
    });
}

async function playIndexOnce(state, index) {
    const track = state.queue[index];
    if (!track) return null;

    state.playToken = (state.playToken || 0) + 1;
    const token = state.playToken;
    state.pendingPlayToken = token;
    state.lastPlaybackRequestAt = Date.now();

    // Use PlayerManager to handle actual playback (Unified Queue)
    const { client } = require("../../client");
    const PlayerManager = require("../PlayerManager");

    const channelId = state.channelId; // Voice channel ID
    let channel = client.channels.cache.get(channelId);
    if (!channel && channelId) {
        channel = await client.channels.fetch(channelId).catch(() => null);
    }

    if (!channel) {
        logger.error(`Cannot play track: Voice channel ${channelId} not found.`);
        throw new Error("Voice channel not found");
    }

    const prePlayDelayMs = getTrackPrePlayDelayMs(track);
    if (prePlayDelayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, prePlayDelayMs));
        if (token !== state.playToken) return null;
    }

    try {
        await PlayerManager.play(state.guildId, channel, track);
    } catch (error) {
        throw error;
    } finally {
        if (state.pendingPlayToken === token) {
            state.pendingPlayToken = null;
        }
    }

    // Re-ensure queue event bindings after a successful play start.
    // This is critical when engine fallback/switch creates a fresh local player
    // after ensureQueueState had run before state.player existed.
    ensureQueueState(state, state.guildId);

    if (token !== state.playToken) return null;

    state.currentIndex = index;
    addTrackToHistory(state, track);
    // state.player.play(resource); // Handled by PlayerManager

    await persistQueueState(state);
    await saveGuildPlaybackHistory(state.guildId, state.playHistory || []);
    await recordPlay({
        userId: track?.requestedById,
        url: track?.url,
        title: track?.title,
    });
    prefetchUpcomingTrack(state, index);
    notifyPanel(state, "play");
    return track;
}

async function playIndex(state, index, options = {}) {
    const queue = Array.isArray(state.queue) ? state.queue : [];
    if (queue.length === 0) return null;

    const allowWrap =
        typeof options.allowWrap === "boolean"
            ? options.allowWrap
            : state.repeatMode === "all";
    const maxAttempts = Math.min(
        queue.length,
        Number.isInteger(options.maxAttempts) ? options.maxAttempts : queue.length
    );

    let attempts = 0;
    let currentIndex = index;
    const tried = new Set();
    let lastError = null;

    while (attempts < maxAttempts) {
        if (currentIndex < 0 || currentIndex >= queue.length) {
            if (!allowWrap) {
                if (lastError) throw lastError;
                return null;
            }
            currentIndex = 0;
        }

        if (tried.has(currentIndex)) return null;
        tried.add(currentIndex);

        try {
            return await playIndexOnce(state, currentIndex);
        } catch (error) {
            const failedTrack = queue[currentIndex];
            lastError = error;
            logger.error("Playback failed, auto-skipping track.", {
                index: currentIndex,
                title: failedTrack?.title,
                url: failedTrack?.url,
                error,
            });
            attempts += 1;
            currentIndex += 1;
        }
    }

    if (lastError) {
        throw lastError;
    }

    return null;
}

async function playNext(state) {
    const nextIndex = state.currentIndex + 1;
    if (nextIndex >= state.queue.length) return null;
    return playIndex(state, nextIndex);
}

async function playPrevious(state) {
    const prevIndex = state.currentIndex - 1;
    if (prevIndex < 0) return null;
    return playIndex(state, prevIndex, { allowWrap: false });
}

async function skipTrack(guildId) {
    const state = getGuildState(guildId);
    if (!state || !Array.isArray(state.queue)) return null;

    if (state.currentIndex >= state.queue.length - 1) {
        if (state.repeatMode === "all" && state.queue.length > 0) {
            return playIndex(state, 0);
        }
        return null;
    }

    return playNext(state);
}

async function previousTrack(guildId) {
    const state = getGuildState(guildId);
    if (!state || !Array.isArray(state.queue)) return null;

    return playPrevious(state);
}

async function jumpToIndex(guildId, index) {
    const state = getGuildState(guildId);
    if (!state || !Array.isArray(state.queue)) return null;

    const targetIndex = Number(index);
    if (!Number.isInteger(targetIndex)) return null;
    if (targetIndex < 0 || targetIndex >= state.queue.length) return null;

    if (targetIndex === state.currentIndex) return state.queue[targetIndex];
    const queue = state.queue;
    const [picked] = queue.splice(targetIndex, 1);
    if (!picked) return null;

    // Move selected track to immediate "next" slot, then trigger playNext().
    // This preserves the rest of queue order instead of exhausting queue when
    // jumping directly to the last item.
    if (targetIndex < state.currentIndex) {
        state.currentIndex -= 1;
    }
    const insertAt = Math.max(0, Math.min(state.currentIndex + 1, queue.length));
    queue.splice(insertAt, 0, picked);

    await persistQueueState(state);
    notifyPanel(state, "jump");

    return playNext(state);
}

function ensureQueueState(state, guildId) {
    if (!state.guildId && guildId) state.guildId = guildId;
    if (!Array.isArray(state.queue)) state.queue = [];
    if (!Number.isInteger(state.currentIndex)) state.currentIndex = -1;
    // Clamp stale/invalid pointers so auto-start logic can recover cleanly.
    if (state.queue.length === 0) {
        state.currentIndex = -1;
    } else if (state.currentIndex < -1 || state.currentIndex >= state.queue.length) {
        state.currentIndex = -1;
    }
    if (typeof state.playToken !== "number") state.playToken = 0;
    if (!["off", "track", "all"].includes(state.repeatMode)) {
        state.repeatMode = "off";
    }

    const canBindLocalPlayerEvents =
        state.player && typeof state.player.on === "function";
    if (!canBindLocalPlayerEvents) {
        // If local player is gone/switched, clear stale binding metadata.
        if (state.queueBoundPlayer && typeof state.queueBoundPlayer.off === "function") {
            if (state.queueIdleHandler) {
                state.queueBoundPlayer.off(AudioPlayerStatus.Idle, state.queueIdleHandler);
            }
            if (state.queueErrorHandler) {
                state.queueBoundPlayer.off("error", state.queueErrorHandler);
            }
        }
        state.queueBound = false;
        state.queueBoundPlayer = null;
        state.queueIdleHandler = null;
        state.queueErrorHandler = null;
        return;
    }

    const alreadyBoundToActivePlayer =
        state.queueBoundPlayer === state.player &&
        typeof state.queueIdleHandler === "function" &&
        typeof state.queueErrorHandler === "function";
    if (alreadyBoundToActivePlayer) return;

    // Rebind listeners when local AudioPlayer instance changed (e.g. FFmpeg recovery).
    if (state.queueBoundPlayer && typeof state.queueBoundPlayer.off === "function") {
        if (state.queueIdleHandler) {
            state.queueBoundPlayer.off(AudioPlayerStatus.Idle, state.queueIdleHandler);
        }
        if (state.queueErrorHandler) {
            state.queueBoundPlayer.off("error", state.queueErrorHandler);
        }
    }

    const idleHandler = () => {
        const current = getGuildState(guildId);
        if (!current || !Array.isArray(current.queue) || current.queue.length === 0) {
            return;
        }

        const mode = current.repeatMode || "off";
        if (mode === "track") {
            const repeatIndex = current.currentIndex >= 0 ? current.currentIndex : 0;
            if (current.queue[repeatIndex]) {
                playIndex(current, repeatIndex).catch((error) => {
                    logger.error(`Auto-repeat track failed for guild ${guildId}.`, error);
                });
                return;
            }
        }

        if (current.currentIndex < current.queue.length - 1) {
            playNext(current).catch((error) => {
                logger.error(`Auto-next failed for guild ${guildId}.`, error);
            });
            return;
        }

        if (mode === "all") {
            playIndex(current, 0).catch((error) => {
                logger.error(`Auto-repeat queue failed for guild ${guildId}.`, error);
            });
        }
    };

    const errorHandler = (error) => {
        const current = getGuildState(guildId);
        if (!current || !Array.isArray(current.queue) || current.queue.length === 0) {
            return;
        }

        const track = current.queue[current.currentIndex];
        logger.error(`Player error in guild ${guildId}, auto-skipping.`, {
            title: track?.title,
            url: track?.url,
            error,
        });

        skipTrack(guildId).catch((skipError) => {
            logger.error(`Auto-skip failed for guild ${guildId}.`, skipError);
        });
    };

    state.player.on(AudioPlayerStatus.Idle, idleHandler);
    state.player.on("error", errorHandler);
    state.queueBound = true;
    state.queueBoundPlayer = state.player;
    state.queueIdleHandler = idleHandler;
    state.queueErrorHandler = errorHandler;
}

async function stopPlayback(guildId) {
    const state = getGuildState(guildId);
    if (!state) return false;

    state.queue = [];
    state.currentIndex = -1;
    state.playToken = (state.playToken || 0) + 1;

    const PlayerManager = require("../PlayerManager");
    await PlayerManager.stop(guildId);
    await clearQueueState(guildId);
    notifyPanel(state, "stop");
    return true;
}

async function leaveVoiceLocal(guildId) {
    const state = getGuildState(guildId);
    const PlayerManager = require("../PlayerManager");

    try {
        await PlayerManager.cleanup(guildId);
    } catch (error) {
        logger.warn(`Engine cleanup failed while leaving guild ${guildId}.`, error);
    }

    if (state) {
        // Leave semantics: disconnect only, keep queue/current index for possible resume.
        state.channelId = null;
        state.connection = null;
    }

    return cleanupGuild(guildId);
}

async function togglePause(guildId) {
    const state = getGuildState(guildId);
    if (!state) return { status: "not_found" };

    const PlayerManager = require("../PlayerManager");
    if (state.pendingPlayToken) {
        return { status: "starting" };
    }

    const isPaused = await PlayerManager.isPaused(guildId);
    const isPlaying = await PlayerManager.isPlaying(guildId);

    if (isPaused) {
        await PlayerManager.resume(guildId);
        notifyPanel(state, "resume");
        return { status: "resumed" };
    }

    if (!isPlaying) {
        // If not playing but we have a queue, try to start playback
        // This helps after engine switches where playback stops
        if (Array.isArray(state.queue) && state.queue.length > 0) {
            const index = state.currentIndex >= 0 ? state.currentIndex : 0;
            const restarted = await playIndex(state, index, {
                allowWrap: false,
                maxAttempts: 1,
            });
            if (restarted) {
                return { status: "resumed" };
            }
            return { status: "idle" };
        }
        return { status: "idle" };
    }

    await PlayerManager.pause(guildId);
    notifyPanel(state, "pause");
    return { status: "paused" };
}

module.exports = {
    addTrackToHistory,
    cloneTrackForHistory,
    getTrackPrePlayDelayMs,
    playIndex,
    playNext,
    ensureQueueState,
    skipTrack,
    previousTrack,
    jumpToIndex,
    stopPlayback,
    leaveVoiceLocal,
    togglePause,
};
