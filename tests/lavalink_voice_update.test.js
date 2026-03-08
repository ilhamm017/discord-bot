"use strict";

const assert = require("assert");

const lavalinkService = require("../discord/player/LavalinkManager");
const lavalinkDriver = require("../discord/player/drivers/LavalinkDriver");
const { getOrCreateState } = require("../discord/player/voice");

function resetService(managerClientId = "bot-user") {
  lavalinkService.manager = {
    players: new Map(),
    options: {
      client: {
        id: managerClientId,
      },
    },
    sendRawData: async () => {},
  };
  lavalinkService.voiceCloseEvents.clear();
  lavalinkService.autoAdvanceLocks.clear();
  lavalinkService.pendingVoiceServerUpdates.clear();
  lavalinkService.recentVoicePatchKeys.clear();
  lavalinkService.positionDriftCounts.clear();
}

async function runCase(name, fn) {
  await fn();
  console.log(`PASS: ${name}`);
}

function createNode(major, minor) {
  const updateCalls = [];
  return {
    info: { version: { major, minor } },
    sessionId: "node-session",
    updateCalls,
    async updatePlayer(payload) {
      updateCalls.push(payload);
    },
  };
}

async function testManualVoicePatchWaitsForSession() {
  resetService();

  const guildId = "guild-manual";
  const node = createNode(4, 2);
  const sendRawCalls = [];
  const player = {
    guildId,
    node,
    voiceChannelId: "voice-a",
    options: { voiceChannelId: "voice-a" },
    voice: { sessionId: null },
    connected: true,
    playing: true,
    paused: false,
  };

  lavalinkService.manager.players.set(guildId, player);
  lavalinkService.manager.sendRawData = async (raw) => {
    sendRawCalls.push(raw);
    if (raw.t === "VOICE_STATE_UPDATE") {
      player.voice.sessionId = raw.d.session_id;
      player.voiceChannelId = raw.d.channel_id;
      player.options.voiceChannelId = raw.d.channel_id;
    }
  };

  await lavalinkService.handleClientRaw({
    t: "VOICE_SERVER_UPDATE",
    d: {
      guild_id: guildId,
      token: "token-1",
      endpoint: "endpoint-1",
    },
  });

  assert.strictEqual(sendRawCalls.length, 0, "manual VSU path should bypass manager.sendRawData");
  assert.strictEqual(node.updateCalls.length, 0, "manual patch should wait for a session id");
  assert.ok(lavalinkService.pendingVoiceServerUpdates.has(guildId), "pending voice update should be stored");

  await lavalinkService.handleClientRaw({
    t: "VOICE_STATE_UPDATE",
    d: {
      guild_id: guildId,
      user_id: "bot-user",
      session_id: "session-1",
      channel_id: "voice-a",
    },
  });

  assert.strictEqual(sendRawCalls.length, 1, "VOICE_STATE_UPDATE should still go through sendRawData");
  assert.strictEqual(node.updateCalls.length, 1, "manual patch should flush after session id arrives");
  assert.deepStrictEqual(
    node.updateCalls[0].playerOptions.voice,
    {
      token: "token-1",
      endpoint: "endpoint-1",
      sessionId: "session-1",
      channelId: "voice-a",
    }
  );

  const diagnostics = getOrCreateState(guildId).diagnostics;
  assert.strictEqual(diagnostics.lastVoiceSessionId, "session-1");
  assert.strictEqual(diagnostics.lastVoiceChannelId, "voice-a");
  assert.ok(Number.isFinite(diagnostics.lastVoicePatchAt));
  assert.ok(!lavalinkService.pendingVoiceServerUpdates.has(guildId));

  await lavalinkService.handleClientRaw({
    t: "VOICE_SERVER_UPDATE",
    d: {
      guild_id: guildId,
      token: "token-1",
      endpoint: "endpoint-1",
    },
  });

  assert.strictEqual(
    node.updateCalls.length,
    1,
    "duplicate VSU payload within dedupe window should not trigger another patch"
  );
}

async function testLegacyNodeKeepsOriginalVoiceFlow() {
  resetService();

  const guildId = "guild-legacy";
  const node = createNode(4, 1);
  const sendRawCalls = [];
  const player = {
    guildId,
    node,
    voiceChannelId: "voice-b",
    options: { voiceChannelId: "voice-b" },
    voice: { sessionId: null },
    connected: true,
    playing: true,
    paused: false,
  };

  lavalinkService.manager.players.set(guildId, player);
  lavalinkService.manager.sendRawData = async (raw) => {
    sendRawCalls.push(raw);
  };

  await lavalinkService.handleClientRaw({
    t: "VOICE_SERVER_UPDATE",
    d: {
      guild_id: guildId,
      token: "token-legacy",
      endpoint: "endpoint-legacy",
    },
  });

  assert.strictEqual(sendRawCalls.length, 1, "legacy nodes should keep the library raw flow");
  assert.strictEqual(node.updateCalls.length, 0, "legacy nodes should not use manual patching");
  assert.ok(!lavalinkService.pendingVoiceServerUpdates.has(guildId));
}

async function testReconnectDiagnosticsHandlers() {
  resetService();

  const guildId = "guild-reconnect";
  const player = {
    guildId,
    voiceChannelId: "voice-c",
  };

  lavalinkService.rememberVoiceClose(guildId, {
    code: 4015,
    reason: "reconnect-test",
    byRemote: true,
    at: 12345,
  });
  lavalinkService.handlePlayerDisconnect(player, "voice-c");

  let diagnostics = getOrCreateState(guildId).diagnostics;
  assert.strictEqual(diagnostics.lastDisconnectAt, 12345);
  assert.strictEqual(diagnostics.lastDisconnectCode, 4015);
  assert.strictEqual(diagnostics.lastVoiceChannelId, "voice-c");

  lavalinkService.handlePlayerReconnect(player, "voice-c");
  diagnostics = getOrCreateState(guildId).diagnostics;
  assert.ok(Number.isFinite(diagnostics.lastReconnectAt));
  assert.strictEqual(diagnostics.lastVoiceChannelId, "voice-c");

  lavalinkService.handlePlayerMove(player, "voice-c", "voice-d");
  diagnostics = getOrCreateState(guildId).diagnostics;
  assert.strictEqual(diagnostics.lastVoiceChannelId, "voice-d");
}

async function testDriverRecreatesStalePlayerOnce() {
  const originalWaitForConnected = lavalinkDriver.waitForConnected;
  const originalWaitForSessionId = lavalinkDriver.waitForSessionId;

  try {
    let createPlayerCount = 0;
    const guildId = "guild-driver";
    const track = {
      title: "Track Driver",
      url: "https://example.com/track",
    };
    const voiceChannel = { id: "voice-driver" };

    const stalePlayer = {
      guildId,
      connected: false,
      playing: false,
      paused: false,
      voiceChannelId: "voice-driver",
      options: { voiceChannelId: "voice-driver" },
      voice: { sessionId: null },
      queue: { tracks: [], current: null },
      search: async () => ({
        loadType: "track",
        tracks: [{
          info: {
            title: "Track Driver",
            uri: "https://example.com/track",
          },
          userData: {},
        }],
      }),
      async connect() {},
      async changeVoiceState() {},
      async destroy() {
        stalePlayer.destroyed = (stalePlayer.destroyed || 0) + 1;
        manager.players.delete(guildId);
      },
      async play() {},
      async setVolume() {},
      async resume() {},
    };

    const freshPlayer = {
      guildId,
      connected: false,
      playing: false,
      paused: false,
      voiceChannelId: "voice-driver",
      options: { voiceChannelId: "voice-driver" },
      voice: { sessionId: null },
      queue: { tracks: [], current: null },
      search: stalePlayer.search,
      async connect() {
        freshPlayer.connected = true;
        freshPlayer.voice.sessionId = "fresh-session";
      },
      async changeVoiceState() {},
      async destroy() {
        freshPlayer.destroyed = (freshPlayer.destroyed || 0) + 1;
      },
      async play() {
        freshPlayer.playCalled = (freshPlayer.playCalled || 0) + 1;
      },
      async setVolume() {
        freshPlayer.volumeSet = true;
      },
      async resume() {
        freshPlayer.resumed = true;
      },
    };

    const manager = {
      players: new Map([[guildId, stalePlayer]]),
      nodeManager: {
        nodes: new Map([["local", { connected: true }]]),
      },
      async createPlayer(options) {
        createPlayerCount += 1;
        freshPlayer.voiceChannelId = options.voiceChannelId;
        freshPlayer.options.voiceChannelId = options.voiceChannelId;
        manager.players.set(guildId, freshPlayer);
        return freshPlayer;
      },
    };

    resetService();
    lavalinkService.manager = manager;
    lavalinkDriver.waitForConnected = async (player) => Boolean(player.connected);
    lavalinkDriver.waitForSessionId = async (player) => player.voice?.sessionId || null;

    const result = await lavalinkDriver.play(guildId, voiceChannel, track);

    assert.strictEqual(result, track);
    assert.strictEqual(stalePlayer.destroyed, 1, "stale player should be destroyed once before recreation");
    assert.strictEqual(createPlayerCount, 1, "driver should recreate exactly one player");
    assert.strictEqual(freshPlayer.playCalled, 1, "fresh player should handle playback");
    assert.strictEqual(freshPlayer.volumeSet, true, "fresh player should still receive volume sync");
  } finally {
    lavalinkDriver.waitForConnected = originalWaitForConnected;
    lavalinkDriver.waitForSessionId = originalWaitForSessionId;
  }
}

async function testWatchdogRepeatsSingleTrackMode() {
  resetService();

  const guildId = "guild-repeat-track";
  const state = getOrCreateState(guildId);
  state.queue = [{ title: "Repeat Me", url: "https://example.com/repeat" }];
  state.currentIndex = 0;
  state.repeatMode = "track";
  state.channelId = "voice-repeat";
  state.pendingPlayToken = null;
  state.lastPlaybackRequestAt = null;
  state.lastTrackStartAt = null;

  const player = {
    guildId,
    playing: false,
    paused: false,
  };

  lavalinkService.manager.players.set(guildId, player);

  const playback = require("../discord/player/queue/playback");
  const originalPlayIndex = playback.playIndex;
  let repeatedIndex = null;

  playback.playIndex = async (_state, index) => {
    repeatedIndex = index;
    return _state.queue[index];
  };

  try {
    await lavalinkService.runAutoAdvanceWatchdog();
    assert.strictEqual(repeatedIndex, 0, "watchdog should replay the current track in repeat-track mode");
  } finally {
    playback.playIndex = originalPlayIndex;
  }
}

async function testDriverUsesYoutubeCacheAfterPriming() {
  const mediaCache = require("../utils/common/media_cache");
  const driverPath = require.resolve("../discord/player/drivers/LavalinkDriver");
  const originalGetPlaybackSourceInfo = mediaCache.getPlaybackSourceInfo;
  const originalPrimeYoutubeTrack = mediaCache.primeYoutubeTrack;
  const originalCachedDriver = require.cache[driverPath];

  delete require.cache[driverPath];

  let primed = false;
  mediaCache.primeYoutubeTrack = async () => {
    primed = true;
    return "/tmp/cache.webm";
  };
  mediaCache.getPlaybackSourceInfo = () => {
    return primed
      ? {
          url: "/tmp/cache.webm",
          mode: "local-cache",
          cacheKey: "yt-cache",
          filePath: "/tmp/cache.webm",
        }
      : { url: null, mode: "remote", cacheKey: null };
  };

  const freshDriver = require("../discord/player/drivers/LavalinkDriver");
  const originalWaitForConnected = freshDriver.waitForConnected;
  const originalWaitForSessionId = freshDriver.waitForSessionId;

  try {
    const guildId = "guild-driver-cache";
    const track = {
      title: "Track Cache",
      url: "https://www.youtube.com/watch?v=SA5zQB7FIgg",
      originalUrl: "https://www.youtube.com/watch?v=SA5zQB7FIgg",
      youtubeVideoId: "SA5zQB7FIgg",
    };
    const voiceChannel = { id: "voice-cache" };
    let searchQuery = null;
    let searchSource = null;

    const player = {
      guildId,
      connected: true,
      playing: false,
      paused: false,
      voiceChannelId: "voice-cache",
      options: { voiceChannelId: "voice-cache" },
      voice: { sessionId: "session-cache" },
      queue: { tracks: [], current: null },
      async search({ query, source }) {
        searchQuery = query;
        searchSource = source || null;
        return {
          loadType: "track",
          tracks: [{
            info: {
              title: "Track Cache",
              uri: query,
            },
            userData: {},
          }],
        };
      },
      async connect() {},
      async changeVoiceState() {},
      async destroy() {},
      async play() {
        player.playCalled = (player.playCalled || 0) + 1;
      },
      async setVolume() {
        player.volumeSet = true;
      },
      async resume() {},
    };

    const manager = {
      players: new Map([[guildId, player]]),
      nodeManager: {
        nodes: new Map([["local", { connected: true }]]),
      },
    };

    resetService();
    lavalinkService.manager = manager;
    freshDriver.waitForConnected = async () => true;
    freshDriver.waitForSessionId = async () => "session-cache";

    const result = await freshDriver.play(guildId, voiceChannel, track);

    assert.strictEqual(result, track);
    assert.strictEqual(searchQuery, "/tmp/cache.webm");
    assert.strictEqual(searchSource, "local");
    assert.strictEqual(player.playCalled, 1);
    assert.strictEqual(player.volumeSet, true);
  } finally {
    mediaCache.getPlaybackSourceInfo = originalGetPlaybackSourceInfo;
    mediaCache.primeYoutubeTrack = originalPrimeYoutubeTrack;
    freshDriver.waitForConnected = originalWaitForConnected;
    freshDriver.waitForSessionId = originalWaitForSessionId;
    delete require.cache[driverPath];
    if (originalCachedDriver) {
      require.cache[driverPath] = originalCachedDriver;
    }
  }
}

(async () => {
  await runCase("manual voice patch waits for session and dedupes repeated payloads", testManualVoicePatchWaitsForSession);
  await runCase("legacy Lavalink nodes keep original voice flow", testLegacyNodeKeepsOriginalVoiceFlow);
  await runCase("reconnect and move handlers update diagnostics", testReconnectDiagnosticsHandlers);
  await runCase("driver recreates a stale player once before playback", testDriverRecreatesStalePlayerOnce);
  await runCase("watchdog replays current track when repeat-track mode is enabled", testWatchdogRepeatsSingleTrackMode);
  await runCase("driver uses YouTube cache URL after priming before Lavalink search", testDriverUsesYoutubeCacheAfterPriming);
  console.log("\nLavalink playback regression passed (6/6)");
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
