"use strict";

const assert = require("assert");
const { analyzeComplexity } = require("../ai/complexity_analyzer");

function runCase(testCase) {
  const result = analyzeComplexity(testCase.input, testCase.options || {});

  for (const [key, expected] of Object.entries(testCase.expect || {})) {
    assert.deepStrictEqual(
      result[key],
      expected,
      `Case "${testCase.name}" failed on "${key}". Expected ${JSON.stringify(expected)}, got ${JSON.stringify(result[key])}`
    );
  }

  for (const [key, expectedMin] of Object.entries(testCase.min || {})) {
    assert.ok(
      result[key] >= expectedMin,
      `Case "${testCase.name}" failed on "${key}" minimum. Expected >= ${expectedMin}, got ${result[key]}`
    );
  }

  for (const [key, expectedMax] of Object.entries(testCase.max || {})) {
    assert.ok(
      result[key] <= expectedMax,
      `Case "${testCase.name}" failed on "${key}" maximum. Expected <= ${expectedMax}, got ${result[key]}`
    );
  }

  for (const [key, expectedItems] of Object.entries(testCase.includes || {})) {
    assert.ok(
      Array.isArray(result[key]),
      `Case "${testCase.name}" expected "${key}" to be an array.`
    );
    for (const item of expectedItems) {
      assert.ok(
        result[key].includes(item),
        `Case "${testCase.name}" expected "${key}" to include "${item}". Actual: ${JSON.stringify(result[key])}`
      );
    }
  }
}

const cases = [
  {
    name: "Pure acknowledgement should stay lightweight general",
    input: "ok",
    options: { messages: [] },
    expect: {
      intent: "general",
      provider: "google",
      tier: "lightweight",
      needsTool: false,
      isAmbiguous: false,
    },
    max: {
      routingConfidence: 0.4,
    },
  },
  {
    name: "Factual who-question should route to search",
    input: "siapa presiden indonesia sekarang",
    options: { messages: [] },
    expect: {
      intent: "search",
      provider: "groq",
      needsTool: true,
      isAmbiguous: false,
    },
    includes: {
      matchedIntents: ["search"],
    },
  },
  {
    name: "Member presence query should route to member intent",
    input: "siapa aja member online",
    options: { messages: [] },
    expect: {
      intent: "member",
      provider: "groq",
      needsTool: true,
      isAmbiguous: false,
    },
    includes: {
      matchedIntents: ["member"],
    },
  },
  {
    name: "Music command should not be swallowed by acknowledgement token",
    input: "ok putar lagu noah",
    options: { messages: [] },
    expect: {
      intent: "music",
      provider: "groq",
      tier: "balanced",
      needsTool: true,
    },
    min: {
      routingConfidence: 0.8,
    },
  },
  {
    name: "Sound effect command for mentioned user should route to music intent",
    input: "putarkan sound effect tabrak masuk untuk <@823626158713077841>",
    options: { messages: [] },
    expect: {
      intent: "music",
      provider: "groq",
      tier: "balanced",
      needsTool: true,
      isAmbiguous: false,
    },
    includes: {
      matchedIntents: ["music"],
    },
    min: {
      routingConfidence: 0.8,
    },
  },
  {
    name: "Direct mention social request should route to social",
    input: "panggil <@123> bilang halo",
    options: { messages: [] },
    expect: {
      intent: "social",
      provider: "groq",
      needsTool: true,
      needsHistory: false,
    },
    includes: {
      matchedIntents: ["social"],
    },
  },
  {
    name: "Ambiguous mixed request should be marked ambiguous and stay conservative",
    input: "siapa di sini dan cari berita terbaru",
    options: { messages: [] },
    expect: {
      provider: "groq",
      tier: "balanced",
      needsTool: true,
      isAmbiguous: true,
    },
    min: {
      routingConfidence: 0.5,
    },
    includes: {
      matchedIntents: ["search", "member"],
    },
  },
  {
    name: "Short follow-up to assistant music question should inherit music intent",
    input: "noah",
    options: {
      messages: [{ role: "assistant", content: "Mau cari lagu apa?" }],
    },
    expect: {
      intent: "music",
      provider: "groq",
      needsTool: true,
      needsHistory: true,
    },
    min: {
      routingConfidence: 0.65,
    },
  },
  {
    name: "Game query should disable tools and use advanced tier",
    input: "tebak-tebakan dong",
    options: { messages: [] },
    expect: {
      intent: "game",
      provider: "groq",
      tier: "advanced",
      needsTool: false,
      needsHistory: true,
    },
    includes: {
      matchedIntents: ["game"],
    },
  },
];

let passed = 0;
for (const testCase of cases) {
  runCase(testCase);
  passed += 1;
  console.log(`PASS: ${testCase.name}`);
}

console.log(`\nIntent routing regression passed (${passed}/${cases.length})`);
