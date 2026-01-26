const { getGuildState } = require("./voice");
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
  return getGuildState(guildId);
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
