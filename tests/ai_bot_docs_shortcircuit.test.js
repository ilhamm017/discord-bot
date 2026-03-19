"use strict";

process.env.LOG_LEVEL = process.env.LOG_LEVEL || "error";
process.env.TERMINAL_LOG_LEVEL = process.env.TERMINAL_LOG_LEVEL || "error";

const assert = require("assert");
const { runAiAgent } = require("../ai/controller");

async function run() {
  const originalFetch = global.fetch;
  global.fetch = async () => {
    throw new Error("Network fetch should not be called for bot docs help.");
  };

  try {
    const context = {
      source: "discord",
      userId: "u1",
      guildId: "g1",
      channelId: "c1",
      sessionId: "s1",
      isReply: false,
      replyContext: "",
      serverContext: null,
      userSummary: "",
      capabilities: ["discord", "music", "web", "memory", "system", "reminder"],
    };

    const res = await runAiAgent("cara pakai yova?", context, 3, []);
    assert.ok(res && res.type === "final", "Expected final response for help prompt.");
    assert.ok(typeof res.message === "string" && res.message.length > 20, "Expected non-empty help message.");
    assert.ok(/\bPerintah cepat\b/i.test(res.message), "Expected BOT_HELP.md content to be used.");
    assert.ok(/\byova\b/i.test(res.message) || /`!\s*/.test(res.message), "Expected commands to be present.");

    console.log("PASS: Bot docs short-circuit"); // eslint-disable-line no-console
  } finally {
    global.fetch = originalFetch;
  }
}

run().catch((err) => {
  console.error(err); // eslint-disable-line no-console
  process.exitCode = 1;
});

