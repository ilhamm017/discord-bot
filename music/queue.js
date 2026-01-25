const {
  AudioPlayerStatus,
  StreamType,
  createAudioResource,
  demuxProbe,
} = require("@discordjs/voice");
const play = require("play-dl");
const { cleanupGuild, connectToVoice, getGuildState } = require("./voice");
const { streamWithYtDlp } = require("./ytdlp");
const logger = require("../utils/logger");
const {
  saveQueueState,
  loadQueueState,
  clearQueueState,
  recordPlay,
} = require("../storage/db");

let panelUpdater = null;

function setPanelUpdater(updater) {
  panelUpdater = typeof updater === "function" ? updater : null;
}

function persistQueueState(state) {
  if (!state?.guildId) return;
  saveQueueState(state.guildId, state);
}

function notifyPanel(state, reason) {
  if (!panelUpdater) return;
  Promise.resolve()
    .then(() => panelUpdater(state, reason))
    .catch((error) => {
      logger.warn("Failed updating control panel.", error);
    });
}

async function getTrackInfo(track) {
  if (track.info) {
    if (!track.title) {
      track.title = track.info.video_details?.title || track.url;
    }
    return track.info;
  }

  if (!track.url) {
    throw new Error("Missing track URL");
  }

  try {
    const info = await play.video_basic_info(track.url);
    track.info = info;

    if (!track.title) {
      track.title = info.video_details?.title || track.url;
    }

    return info;
  } catch (error) {
    logger.warn("Failed fetching track info, continuing without metadata.", {
      url: track.url,
      error,
    });
    if (!track.title) {
      track.title = track.url;
    }
    return null;
  }
}

function ensureValidTrackUrl(track) {
  if (!track?.url || typeof track.url !== "string") {
    throw new Error("Invalid track URL");
  }

  if (play.yt_validate(track.url) !== "video") {
    throw new Error("Invalid track URL");
  }
}

async function createResource(track) {
  ensureValidTrackUrl(track);
  await getTrackInfo(track);

  try {
    let fallbackStream = await streamWithYtDlp(track.url);
    try {
      const probe = await demuxProbe(fallbackStream);
      return createAudioResource(probe.stream, { inputType: probe.type });
    } catch (probeError) {
      fallbackStream.destroy();
    }

    fallbackStream = await streamWithYtDlp(track.url);
    return createAudioResource(fallbackStream, {
      inputType: StreamType.Arbitrary,
    });
  } catch (error) {
    if (error?.message === "YTDLP_DOWNLOAD_FAILED") {
      throw error;
    }

    const message = String(error?.message || "");
    const wrapped = new Error(
      message.toLowerCase().includes("ffmpeg")
        ? "STREAM_NEEDS_FFMPEG"
        : "STREAM_FALLBACK_FAILED"
    );
    wrapped.cause = error;
    throw wrapped;
  }
}

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
  persistQueueState(state);
  recordPlay({
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
    return { state, added: 0, startPosition: state.queue.length + 1, started: false };
  }

  const startPosition = state.queue.length + 1;
  state.queue.push(...entries);
  const added = entries.length;
  persistQueueState(state);

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
  const persisted = loadQueueState(guildId);
  if (!persisted || !Array.isArray(persisted.queue) || persisted.queue.length === 0) {
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

  persistQueueState(state);
  notifyPanel(state, "restore");

  return { restored: true, state, queueLength: state.queue.length };
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

  return playIndex(state, targetIndex);
}

function shuffleQueue(guildId) {
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
  persistQueueState(state);
  notifyPanel(state, "shuffle");
  return true;
}

function setRepeatMode(guildId, mode) {
  const state = getGuildState(guildId);
  if (!state) return null;

  const normalized = mode === "track" || mode === "all" ? mode : "off";
  state.repeatMode = normalized;
  persistQueueState(state);
  notifyPanel(state, "repeat");
  return normalized;
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

  if (status !== AudioPlayerStatus.Playing && status !== AudioPlayerStatus.Buffering) {
    return { status: "idle" };
  }

  const paused = state.player.pause(true);
  notifyPanel(state, "pause");
  return { status: paused ? "paused" : "failed" };
}

function stopPlayback(guildId) {
  const state = getGuildState(guildId);
  if (!state) return false;

  state.queue = [];
  state.currentIndex = -1;
  state.playToken = (state.playToken || 0) + 1;

  state.player.stop(true);
  clearQueueState(guildId);
  notifyPanel(state, "stop");
  return true;
}

function leaveVoice(guildId) {
  clearQueueState(guildId);
  return cleanupGuild(guildId);
}

function getState(guildId) {
  return getGuildState(guildId);
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
};
