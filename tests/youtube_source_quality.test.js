"use strict";

const assert = require("assert");

const {
  buildYoutubeSearchVariants,
  rankYoutubeResults,
  scoreYoutubeResult,
} = require("../functions/tools/music/youtube_logic");

function runCase(name, fn) {
  fn();
  console.log(`PASS: ${name}`);
}

runCase("scoreYoutubeResult prefers official audio over meme edit", () => {
  const official = {
    title: "Maroon 5 - Wait (Official Audio)",
    channel: { name: "Maroon5VEVO" },
    durationInSec: 190,
  };
  const meme = {
    title: "Maroon 5 - Wait (Slowed + Reverb)",
    channel: { name: "random edits" },
    durationInSec: 205,
  };

  assert.ok(
    scoreYoutubeResult(official, "maroon 5 wait") >
      scoreYoutubeResult(meme, "maroon 5 wait")
  );
});

runCase("rankYoutubeResults promotes topic and official audio entries", () => {
  const ranked = rankYoutubeResults(
    [
      {
        title: "Moskau (Live in Berlin)",
        channel: { name: "fan channel" },
        durationInSec: 240,
      },
      {
        title: "Moskau",
        channel: { name: "Dschinghis Khan - Topic" },
        durationInSec: 245,
      },
      {
        title: "Moskau (Nightcore)",
        channel: { name: "speed edits" },
        durationInSec: 180,
      },
    ],
    "dschinghis khan moskau"
  );

  assert.strictEqual(ranked[0].channel.name, "Dschinghis Khan - Topic");
});

runCase("buildYoutubeSearchVariants creates simpler fallback queries", () => {
  const variants = buildYoutubeSearchVariants("End of Beginning | Official Audio | Lyrics");

  assert.ok(variants.includes("End of Beginning | Official Audio | Lyrics"));
  assert.ok(variants.includes("End of Beginning Official Audio Lyrics"));
  assert.ok(variants.includes("End of Beginning"));
  assert.ok(variants.includes("End of Beginning official audio"));
});

console.log("\nYouTube source quality regression passed (3/3)");
