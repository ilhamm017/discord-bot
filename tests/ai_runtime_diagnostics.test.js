"use strict";

const assert = require("assert");

const platform = require("../functions/platform");
const controller = require("../ai/controller");

async function runCase(name, fn) {
  await fn();
  console.log(`PASS: ${name}`);
}

runCase("runtime diagnostic fast-path explains invalid YouTube cookies", async () => {
  const originalGetRecentRuntimeIssues = platform.getRecentRuntimeIssues;
  const originalGetMusicStatus = platform.getMusicStatus;

  platform.getRecentRuntimeIssues = async () => ({
    status: "issues_detected",
    issues: [{
      kind: "youtube_cookies_invalid",
      summary: "Cookies YouTube bermasalah atau sudah tidak valid.",
      probableCause: "yt-dlp ditolak YouTube karena cookies login sudah expired, ter-rotate, atau tidak cocok.",
      suggestedAction: "Upload ulang cookies YouTube yang fresh dari browser yang masih login, lalu restart bot/container.",
    }],
  });
  platform.getMusicStatus = async () => "Music: active\nQueue length: 2\nNow playing: Track A";

  try {
    const result = await controller.runAiAgent("yova cookie youtube bot server aman?", {
      guildId: "guild-1",
      channelId: "channel-1",
      userId: "user-1",
    }, 1, []);

    assert.strictEqual(result.type, "final");
    assert.match(result.message, /cookies youtube bermasalah/i);
  } finally {
    platform.getRecentRuntimeIssues = originalGetRecentRuntimeIssues;
    platform.getMusicStatus = originalGetMusicStatus;
  }
});

runCase("music lag diagnostic falls back to runtime issue summary when music status is unavailable", async () => {
  const originalGetRecentRuntimeIssues = platform.getRecentRuntimeIssues;
  const originalGetMusicStatus = platform.getMusicStatus;

  platform.getRecentRuntimeIssues = async () => ({
    status: "issues_detected",
    issues: [{
      kind: "youtube_cookies_invalid",
      summary: "Cookies YouTube bermasalah atau sudah tidak valid.",
      probableCause: "yt-dlp ditolak YouTube karena cookies login sudah expired, ter-rotate, atau tidak cocok.",
      suggestedAction: "Upload ulang cookies YouTube yang fresh dari browser yang masih login, lalu restart bot/container.",
    }],
  });
  platform.getMusicStatus = async () => {
    throw new Error("buildMusicContext is not a function");
  };

  try {
    const result = await controller.runAiAgent("yova kenapa tadi lagu gagal diputar?", {
      guildId: "guild-1",
      channelId: "channel-1",
      userId: "user-1",
    }, 1, []);

    assert.strictEqual(result.type, "final");
    assert.match(result.message, /cookies youtube bermasalah/i);
    assert.doesNotMatch(result.message, /buildMusicContext is not a function/i);
  } finally {
    platform.getRecentRuntimeIssues = originalGetRecentRuntimeIssues;
    platform.getMusicStatus = originalGetMusicStatus;
  }
});

runCase("music failure prompt is diagnosed from runtime issues", async () => {
  const originalGetRecentRuntimeIssues = platform.getRecentRuntimeIssues;
  const originalGetMusicStatus = platform.getMusicStatus;

  platform.getRecentRuntimeIssues = async () => ({
    status: "issues_detected",
    issues: [{
      kind: "youtube_cookies_invalid",
      summary: "Cookies YouTube bermasalah atau sudah tidak valid.",
      probableCause: "yt-dlp ditolak YouTube karena cookies login sudah expired, ter-rotate, atau tidak cocok.",
      suggestedAction: "Upload ulang cookies YouTube yang fresh dari browser yang masih login, lalu restart bot/container.",
    }],
  });
  platform.getMusicStatus = async () => "Music: idle";

  try {
    const result = await controller.runAiAgent("yova kenapa tadi lagu gagal diputar?", {
      guildId: "guild-1",
      channelId: "channel-1",
      userId: "user-1",
    }, 1, []);

    assert.strictEqual(result.type, "final");
    assert.match(result.message, /cookies youtube bermasalah/i);
  } finally {
    platform.getRecentRuntimeIssues = originalGetRecentRuntimeIssues;
    platform.getMusicStatus = originalGetMusicStatus;
  }
});

console.log("\nAI runtime diagnostic regression passed");
