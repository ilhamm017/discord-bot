"use strict";

const assert = require("assert");

const {
  parseYamlPathMap,
  updateManagedLavalinkYaml,
} = require("../config/web/lavalink_config");

function runCase(name, fn) {
  fn();
  console.log(`PASS: ${name}`);
}

const SAMPLE_YAML = `
server:
  port: 2333
  address: 0.0.0.0
lavalink:
  server:
    password: "youshallnotpass"
    sources:
      youtube: false
      http: true
    bufferDurationMs: 1200 # keep comment
    frameBufferDurationMs: 8000
    opusEncodingQuality: 10
    resamplingQuality: HIGH
    gc-warnings: true
youtube:
  enabled: true
`.trim();

runCase("parseYamlPathMap reads managed Lavalink scalar paths", () => {
  const parsed = parseYamlPathMap(SAMPLE_YAML);
  assert.strictEqual(parsed.get("lavalink.server.password"), "youshallnotpass");
  assert.strictEqual(parsed.get("lavalink.server.sources.youtube"), false);
  assert.strictEqual(parsed.get("lavalink.server.bufferDurationMs"), 1200);
  assert.strictEqual(parsed.get("lavalink.server.resamplingQuality"), "HIGH");
  assert.strictEqual(parsed.get("youtube.enabled"), true);
});

runCase("updateManagedLavalinkYaml replaces scalar values and preserves comments", () => {
  const updated = updateManagedLavalinkYaml(SAMPLE_YAML, {
    "server.password": "rahasia-baru",
    "sources.youtube": true,
    "audio.bufferDurationMs": 1800,
    "audio.resamplingQuality": "MEDIUM",
    "runtime.gcWarnings": false,
    "plugin.youtube.enabled": false,
  });

  assert.match(updated, /password: "rahasia-baru"/);
  assert.match(updated, /youtube: true/);
  assert.match(updated, /bufferDurationMs: 1800 # keep comment/);
  assert.match(updated, /resamplingQuality: "MEDIUM"/);
  assert.match(updated, /gc-warnings: false/);
  assert.match(updated, /^  enabled: false$/m);
});

console.log("\nLavalink web config regression passed (2/2)");
