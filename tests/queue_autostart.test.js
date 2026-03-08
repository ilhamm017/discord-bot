"use strict";

const assert = require("assert");

const controlsPath = require.resolve("../discord/player/queue/controls");
const playbackPath = require.resolve("../discord/player/queue/playback");
const playerManagerPath = require.resolve("../discord/player/PlayerManager");

async function runCase(name, fn) {
  await fn();
  console.log(`PASS: ${name}`);
}

(async () => {
await runCase("enqueueTracks resumes current index instead of skipping to next when queue is idle", async () => {
  delete require.cache[controlsPath];
  delete require.cache[playbackPath];
  delete require.cache[playerManagerPath];

  const voice = require("../discord/player/voice");
  const stateModule = require("../discord/player/queue/state");
  const mediaCache = require("../utils/common/media_cache");
  const playback = require("../discord/player/queue/playback");
  const PlayerManager = require("../discord/player/PlayerManager");

  const originalGetOrCreateState = voice.getOrCreateState;
  const originalPersistQueueState = stateModule.persistQueueState;
  const originalNotifyPanel = stateModule.notifyPanel;
  const originalMarkYoutubeTrack = mediaCache.markYoutubeTrack;
  const originalPrimeYoutubeTrack = mediaCache.primeYoutubeTrack;
  const originalPrimeMyInstantsTrack = mediaCache.primeMyInstantsTrack;
  const originalIsPlaying = PlayerManager.isPlaying;
  const originalPlayIndex = playback.playIndex;
  const originalPlayNext = playback.playNext;

  const state = {
    guildId: "guild-autostart",
    queue: [
      { title: "Current Song", url: "https://www.youtube.com/watch?v=aaaaaaaaaaa", youtubeVideoId: "aaaaaaaaaaa" },
    ],
    currentIndex: 0,
    repeatMode: "off",
    engine: "lavalink",
  };

  let playIndexCalledWith = null;
  let playNextCalled = 0;

  voice.getOrCreateState = () => state;
  stateModule.persistQueueState = async () => {};
  stateModule.notifyPanel = () => {};
  mediaCache.markYoutubeTrack = (track) => track;
  mediaCache.primeYoutubeTrack = () => null;
  mediaCache.primeMyInstantsTrack = () => null;
  PlayerManager.isPlaying = async () => false;
  playback.playIndex = async (_state, index) => {
    playIndexCalledWith = index;
    return _state.queue[index];
  };
  playback.playNext = async () => {
    playNextCalled += 1;
    return null;
  };

  try {
    const { enqueueTracks } = require("../discord/player/queue/controls");
    const voiceChannel = {
      id: "voice-1",
      guild: { id: "guild-autostart" },
    };

    await enqueueTracks(voiceChannel, [
      { title: "Queued Song", url: "https://www.youtube.com/watch?v=bbbbbbbbbbb", youtubeVideoId: "bbbbbbbbbbb" },
    ]);

    assert.strictEqual(playIndexCalledWith, 0);
    assert.strictEqual(playNextCalled, 0);
  } finally {
    voice.getOrCreateState = originalGetOrCreateState;
    stateModule.persistQueueState = originalPersistQueueState;
    stateModule.notifyPanel = originalNotifyPanel;
    mediaCache.markYoutubeTrack = originalMarkYoutubeTrack;
    mediaCache.primeYoutubeTrack = originalPrimeYoutubeTrack;
    mediaCache.primeMyInstantsTrack = originalPrimeMyInstantsTrack;
    PlayerManager.isPlaying = originalIsPlaying;
    playback.playIndex = originalPlayIndex;
    playback.playNext = originalPlayNext;
    delete require.cache[controlsPath];
  }
});

await runCase("enqueueTracks starts newly added track when previous track already ended", async () => {
  delete require.cache[controlsPath];
  delete require.cache[playbackPath];
  delete require.cache[playerManagerPath];

  const voice = require("../discord/player/voice");
  const stateModule = require("../discord/player/queue/state");
  const mediaCache = require("../utils/common/media_cache");
  const playback = require("../discord/player/queue/playback");
  const PlayerManager = require("../discord/player/PlayerManager");

  const originalGetOrCreateState = voice.getOrCreateState;
  const originalPersistQueueState = stateModule.persistQueueState;
  const originalNotifyPanel = stateModule.notifyPanel;
  const originalMarkYoutubeTrack = mediaCache.markYoutubeTrack;
  const originalPrimeYoutubeTrack = mediaCache.primeYoutubeTrack;
  const originalPrimeMyInstantsTrack = mediaCache.primeMyInstantsTrack;
  const originalIsPlaying = PlayerManager.isPlaying;
  const originalPlayIndex = playback.playIndex;
  const originalPlayNext = playback.playNext;

  const state = {
    guildId: "guild-autostart-ended",
    queue: [
      { title: "Finished Song", url: "https://www.youtube.com/watch?v=aaaaaaaaaaa", youtubeVideoId: "aaaaaaaaaaa" },
    ],
    currentIndex: 0,
    repeatMode: "off",
    engine: "lavalink",
    lastTrackStartAt: 1000,
    lastTrackEndAt: 2000,
  };

  let playIndexCalledWith = null;
  let playNextCalled = 0;

  voice.getOrCreateState = () => state;
  stateModule.persistQueueState = async () => {};
  stateModule.notifyPanel = () => {};
  mediaCache.markYoutubeTrack = (track) => track;
  mediaCache.primeYoutubeTrack = () => null;
  mediaCache.primeMyInstantsTrack = () => null;
  PlayerManager.isPlaying = async () => false;
  playback.playIndex = async (_state, index) => {
    playIndexCalledWith = index;
    return _state.queue[index];
  };
  playback.playNext = async () => {
    playNextCalled += 1;
    return state.queue[state.currentIndex + 1] || null;
  };

  try {
    const { enqueueTracks } = require("../discord/player/queue/controls");
    const voiceChannel = {
      id: "voice-2",
      guild: { id: "guild-autostart-ended" },
    };

    await enqueueTracks(voiceChannel, [
      { title: "New Song", url: "https://www.youtube.com/watch?v=bbbbbbbbbbb", youtubeVideoId: "bbbbbbbbbbb" },
    ]);

    assert.strictEqual(playIndexCalledWith, 1);
    assert.strictEqual(playNextCalled, 0);
  } finally {
    voice.getOrCreateState = originalGetOrCreateState;
    stateModule.persistQueueState = originalPersistQueueState;
    stateModule.notifyPanel = originalNotifyPanel;
    mediaCache.markYoutubeTrack = originalMarkYoutubeTrack;
    mediaCache.primeYoutubeTrack = originalPrimeYoutubeTrack;
    mediaCache.primeMyInstantsTrack = originalPrimeMyInstantsTrack;
    PlayerManager.isPlaying = originalIsPlaying;
    playback.playIndex = originalPlayIndex;
    playback.playNext = originalPlayNext;
    delete require.cache[controlsPath];
  }
});

console.log("\nQueue autostart regression passed");
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
