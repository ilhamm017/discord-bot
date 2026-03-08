"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "runtime-diagnostics-test-"));
const botLog = path.join(tempRoot, "bot.log");
const lavalinkLog = path.join(tempRoot, "lavalink.log");

fs.writeFileSync(
  botLog,
  [
    "[2026-03-08 10:11:25] warn: Audio cache download failed for track KpsJWFuVTdI.",
    "ERROR: [youtube] KpsJWFuVTdI: Sign in to confirm you’re not a bot.",
    "[2026-03-08 10:11:25] error: Playback failed, auto-skipping track.",
    "Error: No tracks found via Lavalink (LoadType: error)",
  ].join("\n"),
  "utf8"
);

fs.writeFileSync(
  lavalinkLog,
  [
    "2026-03-08T10:11:25.000+07:00 INFO Loaded track Unknown title",
    "2026-03-08T10:11:25.100+07:00 WARN track stuck for 3000ms",
  ].join("\n"),
  "utf8"
);

process.env.RUNTIME_DIAGNOSTIC_LOG_FILES = `${botLog},${lavalinkLog}`;
process.env.RUNTIME_DIAGNOSTIC_NOW = "2026-03-08T10:12:00+07:00";

const { getRecentRuntimeIssues } = require("../functions/platform/core_logic");

async function runCase(name, fn) {
  await fn();
  console.log(`PASS: ${name}`);
}

runCase("getRecentRuntimeIssues detects youtube cookie and lavalink issues", async () => {
  const result = await getRecentRuntimeIssues(50, true);

  assert.strictEqual(result.status, "issues_detected");
  assert.ok(result.scannedFiles.includes(botLog));
  assert.ok(result.scannedFiles.includes(lavalinkLog));

  const kinds = result.issues.map((item) => item.kind);
  assert.ok(kinds.includes("youtube_cookies_invalid"));
  assert.ok(kinds.includes("lavalink_no_tracks"));
  assert.ok(kinds.includes("voice_drift"));
});

runCase("getRecentRuntimeIssues ignores stale errors outside recent window", async () => {
  fs.writeFileSync(
    botLog,
    [
      "[2026-03-08 09:30:00] error: Playback failed, auto-skipping track.",
      "Error: No tracks found via Lavalink (LoadType: error)",
    ].join("\n"),
    "utf8"
  );

  fs.writeFileSync(
    lavalinkLog,
    [
      "2026-03-08T09:30:00.000+07:00 WARN track stuck for 3000ms",
    ].join("\n"),
    "utf8"
  );

  const result = await getRecentRuntimeIssues(50, true);

  assert.strictEqual(result.status, "no_recent_issue_detected");
  assert.deepStrictEqual(result.issues, []);
});

console.log("\nRuntime diagnostics regression passed");
