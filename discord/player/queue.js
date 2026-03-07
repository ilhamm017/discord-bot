const { getGuildState } = require("./voice");
const lavalinkDriver = require("./drivers/LavalinkDriver");
const { setPanelUpdater } = require("./queue/state");
const {
  playIndex,
  playNext,
  ensureQueueState,
  skipTrack,
  previousTrack,
  jumpToIndex,
  stopPlayback,
  leaveVoiceLocal,
  togglePause,
} = require("./queue/playback");
const {
  shuffleQueue,
  setRepeatMode,
  enqueueTracks,
  enqueueTrack,
  restoreQueue,
} = require("./queue/controls");

// Wrapper for getState to match external interface
function getState(guildId) {
  let state = getGuildState(guildId);
  const lavalinkState = lavalinkDriver.getState(guildId);

  if (state) {
    if (!state.engine) {
      state.engine = "lavalink";
    }

    // Lavalink-only mode: always use live player flags when available.
    if (lavalinkState && lavalinkState.player && lavalinkState.player.state) {
      return {
        ...state,
        engine: "lavalink",
        diagnostics: state.diagnostics || null,
        player: {
          ...state.player,
          state: {
            ...(state.player?.state || {}),
            status: lavalinkState.player.state.status,
            playing: lavalinkState.player.state.playing,
            paused: lavalinkState.player.state.paused,
          }
        }
      };
    }
    return {
      ...state,
      diagnostics: state.diagnostics || null,
    };
  }

  // Fallback if no local state (should be rare with Unified Queue).
  return lavalinkState;
}

// Wrapper for leaveVoice to match external interface
function leaveVoice(guildId) {
  return leaveVoiceLocal(guildId);
}

module.exports = {
  enqueueTrack,
  enqueueTracks,
  getState,
  jumpToIndex,
  shuffleQueue,
  setRepeatMode,
  setPanelUpdater,
  leaveVoice,
  restoreQueue,
  previousTrack,
  skipTrack,
  stopPlayback,
  togglePause,
  // potentially needed internal helpers if any
  ensureQueueState,
};
