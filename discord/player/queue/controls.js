const { AudioPlayerStatus } = require("@discordjs/voice");
const { getGuildState, connectToVoice } = require("../voice");
const { persistQueueState, notifyPanel } = require("./state");
const { ensureQueueState, playNext } = require("./playback");
const { loadQueueState, clearQueueState } = require("../../../storage/db");

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
    const state = await connectToVoice(voiceChannel);
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

    const startPosition = state.queue.length + 1;
    state.queue.push(...entries);
    const added = entries.length;
    await persistQueueState(state);

    let started = false;
    if (state.player.state.status === AudioPlayerStatus.Idle) {
        started = Boolean(await playNext(state));
    }

    return { state, added, startPosition, started };
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
    const persisted = await loadQueueState(guildId);
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
