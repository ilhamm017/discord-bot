"use strict";

process.env.LOG_LEVEL = process.env.LOG_LEVEL || "error";
process.env.TERMINAL_LOG_LEVEL = process.env.TERMINAL_LOG_LEVEL || "error";

const assert = require("assert");

const tools = require("../ai/tool_definitions");
const { chatCompletion } = require("../ai/completion");
const { analyzeComplexity } = require("../ai/complexity_analyzer");

const INTENT_TOOL_NAME_ALLOWLIST = {
  member: [
    "listMembers",
    "getMemberById",
    "getMemberByName",
    "getUserProfile",
    "setUserProfile",
    "getUserMemory",
    "setUserMemory",
    "clearUserMemory",
    "locateUser",
    "findUserLocation",
    "sendMessage",
    "replyToMessage",
    "getServerInfo",
  ],
  moderation: [
    "deleteMessage",
    "bulkDeleteMessages",
    "timeoutMember",
    "removeTimeout",
    "banMember",
    "unbanMember",
  ],
  reminder: ["createReminder", "listUserReminders", "cancelReminder"],
  search: ["searchWeb"],
  social: [
    "sendMessage",
    "replyToMessage",
    "sendAnnouncement",
    "locateUser",
    "findUserLocation",
    "getServerInfo",
  ],
  music: ["playMusic", "controlMusic", "getMusicStatus", "getRecentRuntimeIssues"],
  stats: ["getAiStats", "getServerInfo", "getRecentRuntimeIssues"],
};

function collectAllowedToolNames(intents) {
  const allowed = new Set();
  for (const intent of intents) {
    const names = INTENT_TOOL_NAME_ALLOWLIST[intent];
    if (!names) continue;
    for (const n of names) allowed.add(n);
  }
  return allowed;
}

function deepFindKeys(obj, keys, found = new Set()) {
  if (!obj || typeof obj !== "object") return found;
  if (Array.isArray(obj)) {
    for (const v of obj) deepFindKeys(v, keys, found);
    return found;
  }
  for (const [k, v] of Object.entries(obj)) {
    if (keys.has(k)) found.add(k);
    deepFindKeys(v, keys, found);
  }
  return found;
}

async function run() {
  const captured = [];
  const originalFetch = global.fetch;

  global.fetch = async (url, opts) => {
    const isGroq = String(url).includes("api.groq.com/openai/v1/chat/completions");
    const isGoogle = String(url).includes("generativelanguage.googleapis.com");

    if (!isGroq && !isGoogle) {
      throw new Error(`Unexpected fetch URL in test: ${url}`);
    }

    const body = opts?.body ? JSON.parse(opts.body) : null;
    captured.push({ url: String(url), body });

    if (isGroq) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          id: "chatcmpl_test",
          object: "chat.completion",
          created: Date.now(),
          model: body?.model || "test",
          choices: [
            {
              index: 0,
              message: { role: "assistant", content: "ok" },
              finish_reason: "stop",
            },
          ],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        }),
      };
    }

    // Google provider (should not be used in these tool-centric cases, but keep a safe stub)
    return {
      ok: true,
      status: 200,
      json: async () => ({
        candidates: [{ content: { parts: [{ text: "ok" }] } }],
        usageMetadata: { totalTokenCount: 2 },
      }),
    };
  };

  try {
    const cases = [
      { input: "putarkan lagu taylor swift terbaru", expectIntent: "music" },
      { input: "putar lagu noah", expectIntent: "music" },
      { input: "stop musik", expectIntent: "music" },
      { input: "pause musik", expectIntent: "music" },
      { input: "skip lagu", expectIntent: "music" },
      { input: "cek antrian lagu", expectIntent: "music" },
      { input: "cek status ai dan runtime issues", expectIntent: "stats" },

      { input: "cari berita taylor swift terbaru", expectIntent: "search" },
      { input: "searchWeb: harga bitcoin hari ini", expectIntent: "search" },
      { input: "apa itu lavalink", expectIntent: "search" },
      { input: "siapa presiden indonesia sekarang", expectIntent: "search" },

      { input: "siapa aja member online", expectIntent: "member" },
      { input: "carikan profil member bernama alice", expectIntent: "member" },
      { input: "tolong cek role member bob", expectIntent: "member" },
      { input: "berapa jumlah member server ini", expectIntent: "member" },

      { input: "hapus pesan 1234567890", expectIntent: "moderation" },
      { input: "bulk delete 10 pesan", expectIntent: "moderation" },
      { input: "timeout member itu 10 menit", expectIntent: "moderation" },
      { input: "unban user 123", expectIntent: "moderation" },
      { input: "ban user 123", expectIntent: "moderation" },
      { input: "remove timeout user 123", expectIntent: "moderation" },

      { input: "ingatkan aku besok jam 7 pagi olahraga", expectIntent: "reminder" },
      { input: "list reminder aku", expectIntent: "reminder" },
      { input: "cancel reminder abc123", expectIntent: "reminder" },

      { input: "kirim pesan ke <@123> bilang halo", expectIntent: "social" },
      { input: "buat announcement: maintenance jam 9", expectIntent: "social" },
      { input: "locate user <@123>", expectIntent: null },
      { input: "find user location <@123>", expectIntent: null },

      { input: "siapa di sini dan cari berita terbaru", expectIntent: null }, // ambiguous member+search
      { input: "tolong cek server info dan bilang ke <@123>", expectIntent: null }, // ambiguous member+social
    ];

    assert.strictEqual(cases.length, 30, "Test must include exactly 30 tool-related prompts.");

    for (const testCase of cases) {
      const analysis = analyzeComplexity(testCase.input, { messages: [], tools, isReply: false });
      assert.ok(analysis.needsTool, `Expected needsTool=true for: ${testCase.input}`);

      if (testCase.expectIntent) {
        assert.strictEqual(
          analysis.intent,
          testCase.expectIntent,
          `Expected intent "${testCase.expectIntent}" for: ${testCase.input}`
        );
      }

      await chatCompletion(
        { messages: [{ role: "user", content: testCase.input }], temperature: 0.1, maxTokens: 40 },
        { tools }
      );

      const last = captured[captured.length - 1];
      assert.ok(last && last.body, `Missing captured request body for: ${testCase.input}`);
      assert.ok(Array.isArray(last.body.tools), `Expected tools array in request for: ${testCase.input}`);

      const toolNames = last.body.tools.map(t => t?.function?.name).filter(Boolean);
      assert.ok(toolNames.length > 0, `Expected at least 1 tool provided for: ${testCase.input}`);
      assert.ok(toolNames.length <= 20, `Tool payload too large (${toolNames.length}) for: ${testCase.input}`);

      const allowed = collectAllowedToolNames(analysis.matchedIntents);
      for (const name of toolNames) {
        assert.ok(
          allowed.has(name),
          `Tool "${name}" should not be present for intents=${analysis.matchedIntents.join(",")} input="${testCase.input}"`
        );
      }

      // Schema minification: parameter-level "description/default/examples/title" should be omitted
      for (const t of last.body.tools) {
        const fn = t?.function;
        if (!fn) continue;
        const params = fn.parameters;
        if (!params) continue;
        const found = deepFindKeys(params, new Set(["description", "default", "examples", "title"]));
        assert.strictEqual(
          found.size,
          0,
          `Minification failed; found keys [${[...found].join(",")}] in parameters for tool "${fn.name}"`
        );
      }

      // Spot-check: known intent tool counts on high-confidence single-intent prompts
      if (!analysis.isAmbiguous && analysis.routingConfidence >= 0.8) {
        if (analysis.intent === "music") assert.strictEqual(toolNames.length, 4);
        if (analysis.intent === "search") assert.strictEqual(toolNames.length, 1);
        if (analysis.intent === "moderation") assert.strictEqual(toolNames.length, 6);
        if (analysis.intent === "reminder") assert.strictEqual(toolNames.length, 3);
        if (analysis.intent === "stats") assert.strictEqual(toolNames.length, 3);
      }
    }

    console.log(`PASS: Tool payload efficiency (30/30)`); // eslint-disable-line no-console
  } finally {
    global.fetch = originalFetch;
  }
}

run().catch((err) => {
  console.error(err); // eslint-disable-line no-console
  process.exitCode = 1;
});
