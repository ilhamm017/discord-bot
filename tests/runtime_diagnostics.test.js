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

const { getRecentRuntimeIssues, getRecentErrors } = require("../functions/platform/core_logic");

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

runCase("getRecentRuntimeIssues suppresses cookie issue when newer playback recovery exists", async () => {
  fs.writeFileSync(
    botLog,
    [
      "[2026-03-08 10:11:25] warn: Audio cache download failed for track KpsJWFuVTdI.",
      "ERROR: [youtube] KpsJWFuVTdI: Sign in to confirm you’re not a bot.",
      "{\"timestamp\":\"2026-03-08T03:15:00.000Z\",\"level\":\"info\",\"message\":\"Audio cache ready for track KpsJWFuVTdI.\"}",
      "{\"timestamp\":\"2026-03-08T03:15:01.000Z\",\"level\":\"info\",\"message\":\"Resolved playback source for guild 123.\",\"mode\":\"local-cache\"}",
    ].join("\n"),
    "utf8"
  );

  fs.writeFileSync(lavalinkLog, "", "utf8");
  process.env.RUNTIME_DIAGNOSTIC_NOW = "2026-03-08T10:16:00+07:00";

  const result = await getRecentRuntimeIssues(50, true);
  const kinds = result.issues.map((item) => item.kind);

  assert.strictEqual(result.status, "no_recent_issue_detected");
  assert.ok(!kinds.includes("youtube_cookies_invalid"));
});

runCase("getRecentErrors returns recent error lines and redacts secrets", async () => {
  fs.writeFileSync(
    botLog,
    [
      "{\"timestamp\":\"2026-03-08T03:16:25.084Z\",\"level\":\"error\",\"message\":\"Failed to login to Discord.\",\"stack\":\"Error [TokenInvalid]: token MTQ6MTIzNDU2Nzg5MC5hYmNkZWYuMTIzNDU2Nzg5MGFiY2RlZg==\"}",
      "{\"timestamp\":\"2026-03-08T03:16:26.084Z\",\"level\":\"warn\",\"message\":\"Groq key gsk_0123456789abcdef rate limited\"}",
      "[2026-03-08 10:11:25] error: Playback failed, auto-skipping track. AIzaSyABCDEF1234567890abcdefghi",
    ].join("\n"),
    "utf8"
  );

  const result = await getRecentErrors(10, false, { minLevel: "warn", includeStack: true, maxChars: 4000 });
  assert.ok(["ok", "no_recent_error_detected"].includes(result.status));
  assert.ok(Array.isArray(result.items));
  assert.ok(result.items.length >= 2);

  const joined = JSON.stringify(result.items);
  assert.ok(!joined.includes("gsk_0123456789abcdef"), "expected groq key to be redacted");
  assert.ok(!joined.includes("AIzaSyABCDEF"), "expected google key to be redacted");
  assert.ok(joined.includes("[REDACTED_GROQ_KEY]") || joined.includes("[REDACTED_GOOGLE_KEY]"), "expected redaction markers");
  console.log("PASS: getRecentErrors returns and redacts secrets");
});

console.log("\nRuntime diagnostics regression passed");
