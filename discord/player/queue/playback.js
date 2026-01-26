const { AudioPlayerStatus } = require("@discordjs/voice");
const { getGuildState, cleanupGuild, connectToVoice } = require("../voice");
const { persistQueueState, notifyPanel } = require("./state");
const { createResource } = require("./resource");
const { recordPlay, saveQueueState, loadQueueState, clearQueueState } = require("../../../storage/db");
const logger = require("../../../utils/logger");

async function playIndexOnce(state, index) {
    const track = state.queue[index];
    if (!track) return null;

    state.playToken = (state.playToken || 0) + 1;
    const token = state.playToken;

    let resource;
    try {
        resource = await createResource(track);
    } catch (error) {
        throw error;
    }
    if (token !== state.playToken) return null;

    state.currentIndex = index;
    state.player.play(resource);
    await persistQueueState(state);
    await recordPlay({
        userId: track?.requestedById,
        url: track?.url,
        title: track?.title,
    });
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
            if (!allowWrap) return null;
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

function skipTrack(guildId) {
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

    return playIndex(state, targetIndex);
}

function ensureQueueState(state, guildId) {
    if (!state.guildId && guildId) state.guildId = guildId;
    if (!Array.isArray(state.queue)) state.queue = [];
    if (typeof state.currentIndex !== "number") state.currentIndex = -1;
    if (typeof state.playToken !== "number") state.playToken = 0;
    if (!["off", "track", "all"].includes(state.repeatMode)) {
        state.repeatMode = "off";
    }

    if (state.queueBound) return;
    state.queueBound = true;

    state.player.on(AudioPlayerStatus.Idle, () => {
        const current = getGuildState(guildId);
        if (!current || !Array.isArray(current.queue) || current.queue.length === 0) {
            return;
        }

        const mode = current.repeatMode || "off";
        if (mode === "track" && current.currentIndex >= 0) {
            playIndex(current, current.currentIndex).catch((error) => {
                logger.error(`Auto-repeat track failed for guild ${guildId}.`, error);
            });
            return;
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
    });

    state.player.on("error", (error) => {
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
    });
}

async function stopPlayback(guildId) {
    const state = getGuildState(guildId);
    if (!state) return false;

    state.queue = [];
    state.currentIndex = -1;
    state.playToken = (state.playToken || 0) + 1;

    state.player.stop(true);
    await clearQueueState(guildId);
    notifyPanel(state, "stop");
    return true;
}

async function leaveVoiceLocal(guildId) {
    await clearQueueState(guildId);
    return cleanupGuild(guildId);
}

function togglePause(guildId) {
    const state = getGuildState(guildId);
    if (!state) return { status: "not_found" };

    const status = state.player.state.status;
    if (
        status === AudioPlayerStatus.Paused ||
        status === AudioPlayerStatus.AutoPaused
    ) {
        state.player.unpause();
        notifyPanel(state, "resume");
        return { status: "resumed" };
    }

    if (
        status !== AudioPlayerStatus.Playing &&
        status !== AudioPlayerStatus.Buffering
    ) {
        return { status: "idle" };
    }

    const paused = state.player.pause(true);
    notifyPanel(state, "pause");
    return { status: paused ? "paused" : "failed" };
}

module.exports = {
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
