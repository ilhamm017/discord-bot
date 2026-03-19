"use strict";

const assert = require("assert");

(async () => {
    const prevEnv = { ...process.env };
  try {
    process.env.BROWSER_AUTOMATION_BACKEND = "mock";
    process.env.BROWSER_AUTOMATION_ENABLED = "true";
    process.env.BROWSEROS_RATE_LIMIT_PER_USER_MS = "0";

    const platform = require("../functions/platform");

    {
      const results = await platform.browserosSearch("guild-1", "user-1", "hello", { maxResults: 2 });
      assert.strictEqual(results.length, 2);
      assert.strictEqual(results[0].title, "G Result 1");
      console.log("PASS: browserosSearch(mock) returns Google-like results");
    }

    {
      const results = await platform.browserosSearch("guild-1", "user-1", "captcha test", { maxResults: 2 });
      assert.strictEqual(results.length, 2);
      assert.strictEqual(results[0].title, "DDG Result 1");
      console.log("PASS: browserosSearch(mock) falls back on captcha");
    }

    {
      const page = await platform.browserosFetchPage("guild-1", "user-1", "https://example.com/x", { maxChars: 60 });
      assert.ok(page.markdown.includes("Mock Page"));
      assert.ok(page.markdown.length <= 61);
      assert.ok(Array.isArray(page.links));
      console.log("PASS: browserosFetchPage(mock) returns truncated markdown and links");
    }

    {
      process.env.BROWSEROS_RATE_LIMIT_PER_USER_MS = "5000";
      const results = await platform.browserosSearch("guild-1", "user-rl", "hello", { maxResults: 1 });
      assert.strictEqual(results.length, 1);
      let threw = false;
      try {
        await platform.browserosSearch("guild-1", "user-rl", "hello", { maxResults: 1 });
      } catch {
        threw = true;
      }
      assert.ok(threw, "expected rate limit to throw");
      console.log("PASS: browserosSearch(mock) rate limits per user");
    }
  } finally {
    Object.assign(process.env, prevEnv);
  }
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
