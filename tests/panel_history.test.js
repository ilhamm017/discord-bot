"use strict";

const assert = require("assert");

const { buildControlPanel } = require("../discord/player/panel");
const { addTrackToHistory } = require("../discord/player/queue/playback");
const storageDb = require("../storage/db");
const {
  getOrCreateState,
  getGuildState,
  hydratePlaybackHistories,
  setGuildPlaybackHistory,
} = require("../discord/player/voice");

async function runCase(name, fn) {
  await fn();
  console.log(`PASS: ${name}`);
}

(async () => {
await runCase("addTrackToHistory de-duplicates the same track and keeps latest first", () => {
  const state = {
    playHistory: [],
  };

  addTrackToHistory(state, {
    title: "Song A",
    url: "https://www.youtube.com/watch?v=aaaaaaaaaaa",
    youtubeVideoId: "aaaaaaaaaaa",
  });
  addTrackToHistory(state, {
    title: "Song B",
    url: "https://www.youtube.com/watch?v=bbbbbbbbbbb",
    youtubeVideoId: "bbbbbbbbbbb",
  });
  addTrackToHistory(state, {
    title: "Song A Reloaded",
    url: "https://www.youtube.com/watch?v=aaaaaaaaaaa",
    youtubeVideoId: "aaaaaaaaaaa",
  });

  assert.strictEqual(state.playHistory.length, 2);
  assert.strictEqual(state.playHistory[0].title, "Song A Reloaded");
  assert.strictEqual(state.playHistory[1].title, "Song B");
});

await runCase("addTrackToHistory preserves per-track pre-play delay metadata", () => {
  const state = {
    playHistory: [],
  };

  addTrackToHistory(state, {
    source: "myinstants",
    title: "Vine Boom",
    url: "https://www.myinstants.com/media/sounds/vine-boom.mp3",
    originalUrl: "https://www.myinstants.com/media/sounds/vine-boom.mp3",
    prePlayDelayMs: 3000,
  });

  assert.strictEqual(state.playHistory.length, 1);
  assert.strictEqual(state.playHistory[0].prePlayDelayMs, 3000);
});

await runCase("buildControlPanel renders history view with history select menu", () => {
  const panel = buildControlPanel({
    queue: [{
      title: "Now Playing",
      url: "https://www.youtube.com/watch?v=ccccccccccc",
      requestedById: "123",
      info: { video_details: { durationInSec: 120, thumbnails: [] } },
    }],
    currentIndex: 0,
    repeatMode: "off",
    panelView: "history",
    historyPage: 0,
    queuePage: 0,
    playHistory: [{
      title: "Old Song",
      url: "https://www.youtube.com/watch?v=ddddddddddd",
      requestedById: "456",
      info: { video_details: { durationInSec: 180, thumbnails: [] } },
    }],
    player: {
      state: {
        playing: true,
        paused: false,
      },
    },
  });

  assert.ok(Array.isArray(panel.components));
  const hasHistorySelect = panel.components.some((row) =>
    row.components.some((component) => component.data?.custom_id === "music_history_select")
  );
  const hasHistoryToggle = panel.components.some((row) =>
    row.components.some((component) => component.data?.custom_id === "music_history_toggle")
  );

  assert.strictEqual(hasHistorySelect, true);
  assert.strictEqual(hasHistoryToggle, true);
  assert.strictEqual(panel.embeds[0].data.fields.some((field) => field.name === "History List"), true);
});

await runCase("buildControlPanel keeps history accessible when queue is empty", () => {
  const panel = buildControlPanel({
    queue: [],
    currentIndex: -1,
    repeatMode: "off",
    panelView: "history",
    historyPage: 0,
    queuePage: 0,
    playHistory: [{
      title: "History Only Song",
      url: "https://www.youtube.com/watch?v=zzzzzzzzzzz",
      requestedById: "789",
      info: { video_details: { durationInSec: 90, thumbnails: [] } },
    }],
    player: {
      state: {
        playing: false,
        paused: false,
      },
    },
  });

  assert.strictEqual(panel.embeds[0].data.description, "Tidak ada lagu yang diputar.");
  assert.strictEqual(panel.embeds[0].data.fields.some((field) => field.name === "History List"), true);
  const historyToggle = panel.components
    .flatMap((row) => row.components)
    .find((component) => component.data?.custom_id === "music_history_toggle");
  assert.strictEqual(Boolean(historyToggle), true);
  assert.strictEqual(historyToggle.data.disabled, false);
});

await runCase("buildControlPanel shows Play button when current track is idle", () => {
  const panel = buildControlPanel({
    queue: [{
      title: "Idle Song",
      url: "https://www.youtube.com/watch?v=yyyyyyyyyyy",
      requestedById: "111",
      info: { video_details: { durationInSec: 60, thumbnails: [] } },
    }],
    currentIndex: 0,
    repeatMode: "track",
    panelView: "queue",
    historyPage: 0,
    queuePage: 0,
    playHistory: [],
    player: {
      state: {
        playing: false,
        paused: false,
      },
    },
  });

  const pauseButton = panel.components
    .flatMap((row) => row.components)
    .find((component) => component.data?.custom_id === "music_pause");
  assert.strictEqual(Boolean(pauseButton), true);
  assert.strictEqual(pauseButton.data.label, "Play");
});

await runCase("setGuildPlaybackHistory normalizes persisted history into guild state", () => {
  setGuildPlaybackHistory("guild-history-persist", [
    null,
    { title: "Persisted Song", url: "https://www.youtube.com/watch?v=eeeeeeeeeee" },
  ]);

  const state = getGuildState("guild-history-persist");
  assert.strictEqual(Array.isArray(state.playHistory), true);
  assert.strictEqual(state.playHistory.length, 1);
  assert.strictEqual(state.playHistory[0].title, "Persisted Song");
});

await runCase("hydratePlaybackHistories loads persisted rows into memory", async () => {
  const originalLoader = storageDb.loadAllGuildPlaybackHistories;
  storageDb.loadAllGuildPlaybackHistories = async () => ([
    {
      guildId: "guild-hydrated",
      history: [{ title: "Hydrated Song", url: "https://www.youtube.com/watch?v=fffffffffff" }],
    },
  ]);

  try {
    const count = await hydratePlaybackHistories();
    const state = getOrCreateState("guild-hydrated");
    assert.strictEqual(count, 1);
    assert.strictEqual(state.playHistory.length, 1);
    assert.strictEqual(state.playHistory[0].title, "Hydrated Song");
  } finally {
    storageDb.loadAllGuildPlaybackHistories = originalLoader;
  }
});

  console.log("\nPanel history regression passed (7/7)");
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
