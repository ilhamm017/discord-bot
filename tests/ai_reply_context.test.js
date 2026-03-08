"use strict";

const assert = require("assert");

const {
  extractTrackTitleFromReplyContext,
  isTrackIdentificationPrompt,
  tryBuildDirectReplyFromMusicBubble,
} = require("../ai/controller");

function runCase(name, fn) {
  fn();
  console.log(`PASS: ${name}`);
}

runCase("extractTrackTitleFromReplyContext parses Memutar bubble text", () => {
  assert.strictEqual(
    extractTrackTitleFromReplyContext("Memutar: Dschinghis Khan - Moskau (Starparade 14.06.1979)"),
    "Dschinghis Khan - Moskau (Starparade 14.06.1979)"
  );
});

runCase("isTrackIdentificationPrompt recognizes simple song identification question", () => {
  assert.strictEqual(isTrackIdentificationPrompt("lagu apa ini?"), true);
  assert.strictEqual(isTrackIdentificationPrompt("judulnya apa?"), true);
  assert.strictEqual(isTrackIdentificationPrompt("siapa penyanyinya?"), false);
});

runCase("tryBuildDirectReplyFromMusicBubble returns direct answer from reply context", () => {
  const reply = tryBuildDirectReplyFromMusicBubble("lagu apa ini?", {
    isReply: true,
    replyContext: "Memutar: Dschinghis Khan - Moskau (Starparade 14.06.1979)",
  });

  assert.strictEqual(
    reply,
    "Itu lagu **Dschinghis Khan - Moskau (Starparade 14.06.1979)**."
  );
});

console.log("\nAI reply-context regression passed (3/3)");
