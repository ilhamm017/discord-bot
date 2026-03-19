"use strict";

const assert = require("assert");

const {
  parseSpotifyInput,
  buildSpotifyUrl,
  fetchSpotifyOEmbedTitle,
} = require("../utils/common/spotify");

async function runCase(name, fn) {
  await fn();
  console.log(`PASS: ${name}`);
}

(async () => {
  await runCase("parseSpotifyInput reads playlist URL", async () => {
    assert.deepStrictEqual(
      parseSpotifyInput("https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM3M"),
      { type: "playlist", id: "37i9dQZF1DXcBWIGoYBM3M" }
    );
  });

  await runCase("parseSpotifyInput reads playlist URI", async () => {
    assert.deepStrictEqual(
      parseSpotifyInput("spotify:playlist:37i9dQZF1DXcBWIGoYBM3M"),
      { type: "playlist", id: "37i9dQZF1DXcBWIGoYBM3M" }
    );
  });

  await runCase("buildSpotifyUrl builds playlist URL", async () => {
    assert.strictEqual(
      buildSpotifyUrl({ type: "playlist", id: "37i9dQZF1DXcBWIGoYBM3M" }),
      "https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM3M"
    );
  });

  await runCase("fetchSpotifyOEmbedTitle returns title on success", async () => {
    const originalFetch = global.fetch;
    global.fetch = async () => ({
      ok: true,
      json: async () => ({ title: "My Playlist Title" }),
    });

    try {
      const title = await fetchSpotifyOEmbedTitle({ type: "playlist", id: "37i9dQZF1DXcBWIGoYBM3M" });
      assert.strictEqual(title, "My Playlist Title");
    } finally {
      global.fetch = originalFetch;
    }
  });

  await runCase("fetchSpotifyOEmbedTitle returns null on non-200", async () => {
    const originalFetch = global.fetch;
    global.fetch = async () => ({
      ok: false,
      json: async () => ({ title: "ignored" }),
    });

    try {
      const title = await fetchSpotifyOEmbedTitle("https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM3M");
      assert.strictEqual(title, null);
    } finally {
      global.fetch = originalFetch;
    }
  });

  await runCase("fetchSpotifyOEmbedTitle returns null on invalid JSON", async () => {
    const originalFetch = global.fetch;
    global.fetch = async () => ({
      ok: true,
      json: async () => {
        throw new Error("bad json");
      },
    });

    try {
      const title = await fetchSpotifyOEmbedTitle("https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM3M");
      assert.strictEqual(title, null);
    } finally {
      global.fetch = originalFetch;
    }
  });

  console.log("\nSpotify oEmbed regression passed (6/6)");
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
