"use strict";

const assert = require("assert");

const {
  MYINSTANTS_PREPLAY_DELAY_MS,
  buildMyInstantsTrack,
  detectMyInstantsRequest,
  parseMyInstantsPage,
  parseMyInstantsSearchResults,
} = require("../utils/common/myinstants");

function runCase(name, fn) {
  fn();
  console.log(`PASS: ${name}`);
}

runCase("detectMyInstantsRequest recognizes explicit source keyword", () => {
  const result = detectMyInstantsRequest("myinstants vine boom");
  assert.strictEqual(result.shouldUseMyInstants, true);
  assert.strictEqual(result.kind, "search");
  assert.strictEqual(result.cleanedQuery, "vine boom");
});

runCase("detectMyInstantsRequest honors explicit source option", () => {
  const result = detectMyInstantsRequest("bruh", { source: "myinstants" });
  assert.strictEqual(result.shouldUseMyInstants, true);
  assert.strictEqual(result.kind, "search");
  assert.strictEqual(result.cleanedQuery, "bruh");
});

runCase("detectMyInstantsRequest recognizes sound effect phrasing without explicit site name", () => {
  const result = detectMyInstantsRequest("putarkan sound effect tabrak masuk");
  assert.strictEqual(result.shouldUseMyInstants, true);
  assert.strictEqual(result.kind, "search");
  assert.strictEqual(result.cleanedQuery, "tabrak masuk");
});

runCase("parseMyInstantsSearchResults extracts instant entries", () => {
  const html = `
    <div class="instant">
      <a class="instant-link link-secondary" href="/en/instant/vine-boom/">Vine Boom</a>
    </div>
    <div class="instant">
      <a class="instant-link link-secondary" href="/en/instant/bruh-sound-effect/">Bruh &amp; Boom</a>
    </div>
  `;

  const results = parseMyInstantsSearchResults(html, { limit: 5 });
  assert.strictEqual(results.length, 2);
  assert.strictEqual(results[0].source, "myinstants");
  assert.strictEqual(results[0].title, "Vine Boom");
  assert.strictEqual(results[0].url, "https://www.myinstants.com/en/instant/vine-boom/");
  assert.strictEqual(results[1].title, "Bruh & Boom");
});

runCase("parseMyInstantsPage extracts title and direct audio url", () => {
  const html = `
    <html>
      <head>
        <meta property="og:title" content="Bonk Sound Effect" />
      </head>
      <body>
        <a href="/media/sounds/bonk.mp3">Download MP3</a>
      </body>
    </html>
  `;

  const result = parseMyInstantsPage(html, {
    pageUrl: "https://www.myinstants.com/en/instant/bonk/",
  });

  assert.strictEqual(result.title, "Bonk Sound Effect");
  assert.strictEqual(result.pageUrl, "https://www.myinstants.com/en/instant/bonk/");
  assert.strictEqual(result.audioUrl, "https://www.myinstants.com/media/sounds/bonk.mp3");
});

runCase("buildMyInstantsTrack creates a directly playable queue item", () => {
  const track = buildMyInstantsTrack(
    {
      title: "Bonk Sound Effect",
      pageUrl: "https://www.myinstants.com/en/instant/bonk/",
      audioUrl: "https://www.myinstants.com/media/sounds/bonk.mp3",
    },
    {
      requestedBy: "tester#0001",
      requestedById: "123",
      requestedByTag: "tester#0001",
    }
  );

  assert.strictEqual(track.source, "myinstants");
  assert.strictEqual(track.url, "https://www.myinstants.com/media/sounds/bonk.mp3");
  assert.strictEqual(track.originalUrl, "https://www.myinstants.com/media/sounds/bonk.mp3");
  assert.strictEqual(track.sourcePageUrl, "https://www.myinstants.com/en/instant/bonk/");
  assert.ok(/^myi_[a-f0-9]{16}$/.test(track.cacheKey));
  assert.strictEqual(track.prePlayDelayMs, MYINSTANTS_PREPLAY_DELAY_MS);
  assert.strictEqual(track.info.video_details.title, "Bonk Sound Effect");
});

console.log("\nMyInstants regression passed (6/6)");
