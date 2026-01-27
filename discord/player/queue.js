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

  if (state) {
    // Determine engine if not set (helps during initial start or reload)
    if (!state.engine) {
      const lavalinkPlayer = lavalinkDriver.getPlayer(guildId);
      if (lavalinkPlayer) state.engine = 'lavalink';
      else state.engine = 'ffmpeg';
    }

    if (state.engine === 'lavalink') {
      const lavalinkState = lavalinkDriver.getState(guildId);
      if (lavalinkState && lavalinkState.player && lavalinkState.player.state) {
        // Return augmented state with real Lavalink player status
        return {
          ...state,
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
    }
    return state;
  }

  // Fallback if no local state (should be rare with Unified Queue)
  return lavalinkDriver.getState(guildId);
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
