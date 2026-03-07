const logger = require("../../utils/logger");

const guildStates = new Map();

function createDiagnostics() {
  return {
    lastVoiceServerUpdateAt: null,
    lastVoicePatchAt: null,
    lastVoiceSessionId: null,
    lastVoiceChannelId: null,
    lastReconnectAt: null,
    lastDisconnectAt: null,
    lastDisconnectCode: null,
    lastPlayerPingMs: null,
    lastPlayerPosition: null,
    lastPlayerUpdateAt: null,
    lastPositionDriftMs: null,
  };
}

function createPlaybackHistory() {
  return [];
}

function normalizePlaybackHistory(history) {
  if (!Array.isArray(history)) return createPlaybackHistory();
  return history.filter((item) => Boolean(item) && typeof item === "object");
}

function ensureDiagnostics(state) {
  if (!state.diagnostics || typeof state.diagnostics !== "object") {
    state.diagnostics = createDiagnostics();
    return state.diagnostics;
  }

  const defaults = createDiagnostics();
  for (const [key, value] of Object.entries(defaults)) {
    if (!(key in state.diagnostics)) {
      state.diagnostics[key] = value;
    }
  }
  return state.diagnostics;
}

function ensurePlaybackHistory(state) {
  if (!Array.isArray(state.playHistory)) {
    state.playHistory = createPlaybackHistory();
  }
  if (!("speechPlayback" in state)) {
    state.speechPlayback = null;
  }
  if (!["queue", "history"].includes(state.panelView)) {
    state.panelView = "queue";
  }
  if (!Number.isInteger(state.queuePage) || state.queuePage < 0) {
    state.queuePage = 0;
  }
  if (!Number.isInteger(state.historyPage) || state.historyPage < 0) {
    state.historyPage = 0;
  }
}

function getOrCreateState(guildId) {
  let state = guildStates.get(guildId);
  if (!state) {
    state = {
      queue: [],
      currentIndex: -1,
      repeatMode: "off",
      engine: "lavalink",
      diagnostics: createDiagnostics(),
      playHistory: createPlaybackHistory(),
      speechPlayback: null,
      panelView: "queue",
      queuePage: 0,
      historyPage: 0,
    };
    guildStates.set(guildId, state);
  } else {
    ensureDiagnostics(state);
    ensurePlaybackHistory(state);
  }
  return state;
}

function setGuildPlaybackHistory(guildId, history) {
  if (!guildId) return null;
  const state = getOrCreateState(guildId);
  state.playHistory = normalizePlaybackHistory(history);
  if (state.historyPage >= state.playHistory.length && state.historyPage > 0) {
    state.historyPage = 0;
  }
  return state;
}

async function hydratePlaybackHistories() {
  const { loadAllGuildPlaybackHistories } = require("../../storage/db");
  const rows = await loadAllGuildPlaybackHistories();
  for (const row of rows) {
    setGuildPlaybackHistory(row.guildId, row.history);
  }
  return rows.length;
}

function cleanupGuild(guildId) {
  const state = guildStates.get(guildId);
  if (!state) return false;

  if (state.player) {
    try {
      state.player.stop(true);
    } catch (error) {
      logger.warn(`Failed stopping player for guild ${guildId}.`, error);
    }
  }

  if (state.connection) {
    try {
      state.connection.destroy();
    } catch (error) {
      logger.warn(`Failed destroying connection for guild ${guildId}.`, error);
    }
    state.connection = null;
  }

  // NOTE: We don't delete from guildStates here anymore to keep the queue in memory
  // but we can mark it as disconnected if needed.
  // Actually, delete it ONLY if we want total cleanup.
  // Let's keep it for now but be careful.
  // If the user said "bot leaves and queue is empty", it's because this was deleted.
  // We want to keep the queue!

  // guildStates.delete(guildId); 
  return true;
}

function getGuildState(guildId) {
  const state = guildStates.get(guildId);
  if (!state) return state;
  ensureDiagnostics(state);
  ensurePlaybackHistory(state);
  return state;
}

module.exports = {
  cleanupGuild,
  ensureDiagnostics,
  getGuildState,
  getOrCreateState,
  hydratePlaybackHistories,
  normalizePlaybackHistory,
  setGuildPlaybackHistory,
};
