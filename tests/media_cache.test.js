"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "audio-cache-test-"));
process.env.AUDIO_CACHE_DIR = tempRoot;
process.env.AUDIO_CACHE_HOST = "127.0.0.1";
process.env.AUDIO_CACHE_PORT = "8765";

const {
  ensureAudioCacheDir,
  extractYoutubeVideoId,
  getCachedTrackUrl,
  getMyInstantsCacheKey,
  getPlaybackUrlForTrack,
  markYoutubeTrack,
} = require("../utils/common/media_cache");

function runCase(name, fn) {
  fn();
  console.log(`PASS: ${name}`);
}

runCase("extractYoutubeVideoId reads standard youtube URLs", () => {
  assert.strictEqual(
    extractYoutubeVideoId("https://www.youtube.com/watch?v=dQw4w9WgXcQ"),
    "dQw4w9WgXcQ"
  );
});

runCase("markYoutubeTrack attaches cache metadata and cachedUrl when file exists", () => {
  ensureAudioCacheDir();
  fs.writeFileSync(path.join(tempRoot, "dQw4w9WgXcQ.webm"), "dummy");

  const track = markYoutubeTrack({
    url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    title: "Never Gonna Give You Up",
  });

  assert.strictEqual(track.youtubeVideoId, "dQw4w9WgXcQ");
  assert.strictEqual(track.originalUrl, "https://www.youtube.com/watch?v=dQw4w9WgXcQ");
  assert.strictEqual(track.cachedUrl, "http://127.0.0.1:8765/audio-cache/dQw4w9WgXcQ");
});

runCase("getPlaybackUrlForTrack prefers cached URL when available", () => {
  const url = getPlaybackUrlForTrack({
    url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    originalUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    youtubeVideoId: "dQw4w9WgXcQ",
  });

  assert.strictEqual(url, "http://127.0.0.1:8765/audio-cache/dQw4w9WgXcQ");
});

runCase("getPlaybackUrlForTrack falls back to original URL when cache is absent", () => {
  const url = getPlaybackUrlForTrack({
    url: "https://www.youtube.com/watch?v=9bZkp7q19f0",
    originalUrl: "https://www.youtube.com/watch?v=9bZkp7q19f0",
    youtubeVideoId: "9bZkp7q19f0",
  });

  assert.strictEqual(url, "https://www.youtube.com/watch?v=9bZkp7q19f0");
  assert.strictEqual(getCachedTrackUrl("9bZkp7q19f0"), null);
});

runCase("getPlaybackUrlForTrack prefers local cache for MyInstants audio", () => {
  ensureAudioCacheDir();
  const sourceUrl = "https://www.myinstants.com/media/sounds/bonk.mp3";
  const cacheKey = getMyInstantsCacheKey(sourceUrl);
  fs.writeFileSync(path.join(tempRoot, `${cacheKey}.mp3`), "dummy");

  const url = getPlaybackUrlForTrack({
    source: "myinstants",
    url: sourceUrl,
    originalUrl: sourceUrl,
    cacheKey,
  });

  assert.strictEqual(url, `http://127.0.0.1:8765/audio-cache/${cacheKey}`);
});

console.log("\nMedia cache regression passed (5/5)");
