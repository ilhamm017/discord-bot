const { AudioPlayerStatus } = require("@discordjs/voice");
const { getGuildState, connectToVoice, getOrCreateState } = require("../voice");
const { persistQueueState, notifyPanel } = require("./state");
const { ensureQueueState, playNext } = require("./playback");
const { loadQueueState, clearQueueState, saveUserQueueHistory, loadUserQueueHistory } = require("../../../storage/db");
const logger = require("../../../utils/logger");


async function shuffleQueue(guildId) {
    const state = getGuildState(guildId);
    if (!state || !Array.isArray(state.queue)) return false;

    const start = Math.max(0, state.currentIndex + 1);
    if (start >= state.queue.length - 1) return false;

    const upcoming = state.queue.slice(start);
    for (let i = upcoming.length - 1; i > 0; i -= 1) {
        const j = Math.floor(Math.random() * (i + 1));
        [upcoming[i], upcoming[j]] = [upcoming[j], upcoming[i]];
    }

    state.queue = state.queue.slice(0, start).concat(upcoming);
    await persistQueueState(state);

    // Save history for current requester from shuffle
    const currentTrack = state.queue[state.currentIndex];
    if (currentTrack?.requestedById) {
        await saveUserQueueHistory(currentTrack.requestedById, guildId, state);
    }

    notifyPanel(state, "shuffle");
    return true;
}

async function setRepeatMode(guildId, mode) {
    const state = getGuildState(guildId);
    if (!state) return null;

    const normalized = mode === "track" || mode === "all" ? mode : "off";
    state.repeatMode = normalized;
    await persistQueueState(state);
    notifyPanel(state, "repeat");
    return normalized;
}

async function enqueueTracks(voiceChannel, tracks, options = {}) {
    const PlayerManager = require("../PlayerManager");
    const engineType = await PlayerManager.getEngineType(voiceChannel.guild.id);

    let state;
    if (engineType === "lavalink") {
        state = getOrCreateState(voiceChannel.guild.id);
        state.channelId = voiceChannel.id;
    } else {
        state = await connectToVoice(voiceChannel);
    }

    ensureQueueState(state, voiceChannel.guild.id);

    if (options.textChannelId) {
        if (state.panelChannelId && state.panelChannelId !== options.textChannelId) {
            state.panelMessageId = null;
        }
        state.panelChannelId = options.textChannelId;
    }

    const entries = Array.isArray(tracks) ? tracks.filter(Boolean) : [];
    if (entries.length === 0) {
        return {
            state,
            added: 0,
            startPosition: state.queue.length + 1,
            started: false,
        };
    }

    const wasEmpty = state.queue.length === 0;
    state.queue.push(...entries);
    const added = entries.length;

    // Ensure engine is set to help UI detection
    if (!state.engine) {
        const engine = await PlayerManager.getEngine(voiceChannel.guild.id);
        state.engine = engine.type || "ffmpeg";
    }

    await persistQueueState(state);
    notifyPanel(state, "enqueue");

    // Save User History
    const requesterId = entries[entries.length - 1]?.requestedById;
    if (requesterId) {
        await saveUserQueueHistory(requesterId, voiceChannel.guild.id, state);
    }

    let started = false;
    const isPlaying = await PlayerManager.isPlaying(voiceChannel.guild.id);

    // Auto-start if nothing was playing OR queue was completely empty (meaning no loop running)
    if (wasEmpty || !isPlaying) {
        logger.info(`Auto-starting playback for guild ${voiceChannel.guild.id} (wasEmpty=${wasEmpty}, isPlaying=${isPlaying})`);
        started = Boolean(await playNext(state));
    }

    return { state, added, started };
}

async function enqueueTrack(voiceChannel, track, options = {}) {
    const result = await enqueueTracks(voiceChannel, [track], options);
    return {
        state: result.state,
        track,
        position: result.startPosition,
        started: result.started,
    };
}

async function restoreQueue(voiceChannel, options = {}) {
    const guildId = voiceChannel.guild.id;
    const { userId } = options;

    let persisted;
    if (userId) {
        persisted = await loadUserQueueHistory(userId, guildId);
    }

    if (!persisted) {
        // Fallback to guild state if user state not found or not requested
        persisted = await loadQueueState(guildId);
    }

    if (
        !persisted ||
        !Array.isArray(persisted.queue) ||
        persisted.queue.length === 0
    ) {
        return { restored: false, state: null, queueLength: 0 };
    }

    const state = await connectToVoice(voiceChannel);
    ensureQueueState(state, guildId);

    if (options.textChannelId) {
        if (state.panelChannelId && state.panelChannelId !== options.textChannelId) {
            state.panelMessageId = null;
        }
        state.panelChannelId = options.textChannelId;
    }

    state.queue = persisted.queue;
    state.currentIndex = -1;
    state.repeatMode = persisted.repeatMode || "off";
    state.playToken = (state.playToken || 0) + 1;

    await persistQueueState(state);

    // Also update User History for this interaction
    if (userId) {
        await saveUserQueueHistory(userId, guildId, state);
    }

    notifyPanel(state, "restore");

    return { restored: true, state, queueLength: state.queue.length };
}

module.exports = {
    shuffleQueue,
    setRepeatMode,
    enqueueTracks,
    enqueueTrack,
    restoreQueue,
};
