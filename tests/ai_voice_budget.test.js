"use strict";

const assert = require("assert");
const {
  calculateVoiceBudgetDecision,
  getUsageMonthKey,
} = require("../utils/common/ai_voice");

function runCase(name, fn) {
  fn();
  console.log(`PASS: ${name}`);
}

runCase("getUsageMonthKey formats UTC year-month", () => {
  const key = getUsageMonthKey(new Date("2026-03-07T12:00:00.000Z"));
  assert.strictEqual(key, "2026-03");
});

runCase("budget allows normal usage with full chance below soft threshold", () => {
  const decision = calculateVoiceBudgetDecision(
    { chance: 0.05, monthlyLimit: 9500, monthlyReserve: 1500 },
    { characterCount: 1000 },
    120
  );

  assert.strictEqual(decision.allowed, true);
  assert.strictEqual(decision.reason, "ok");
  assert.strictEqual(decision.effectiveChance, 0.05);
});

runCase("budget reduces chance when usage is already high", () => {
  const decision = calculateVoiceBudgetDecision(
    { chance: 0.08, monthlyLimit: 9500, monthlyReserve: 1500 },
    { characterCount: 7000 },
    120
  );

  assert.strictEqual(decision.allowed, true);
  assert.strictEqual(decision.reason, "ok");
  assert.ok(decision.effectiveChance < 0.08);
});

runCase("budget blocks requests that would eat into reserve", () => {
  const decision = calculateVoiceBudgetDecision(
    { chance: 0.05, monthlyLimit: 9500, monthlyReserve: 1500 },
    { characterCount: 7900 },
    200
  );

  assert.strictEqual(decision.allowed, false);
  assert.strictEqual(decision.reason, "monthly_reserve_protected");
});

runCase("budget blocks requests over hard monthly limit", () => {
  const decision = calculateVoiceBudgetDecision(
    { chance: 0.05, monthlyLimit: 9500, monthlyReserve: 1500 },
    { characterCount: 9490 },
    40
  );

  assert.strictEqual(decision.allowed, false);
  assert.strictEqual(decision.reason, "monthly_limit_reached");
});

console.log("\nAI voice budget regression passed (5/5)");
