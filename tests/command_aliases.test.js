"use strict";

const assert = require("assert");
const { resolveCommandAlias } = require("../discord/command_aliases");

function run(name, fn) {
  try {
    fn();
    console.log(`PASS: ${name}`);
  } catch (e) {
    console.error(`FAIL: ${name}`);
    throw e;
  }
}

run("puterin maps to play and strips 'lagu'", () => {
  const alias = resolveCommandAlias("puterin", ["lagu", "hime", "hime"]);
  assert.deepStrictEqual(alias, { name: "play", args: ["hime", "hime"] });
});

run("putar maps to play without stripping", () => {
  const alias = resolveCommandAlias("putar", ["hime", "hime"]);
  assert.deepStrictEqual(alias, { name: "play", args: ["hime", "hime"] });
});

run("unknown command returns null", () => {
  const alias = resolveCommandAlias("foobar", ["x"]);
  assert.strictEqual(alias, null);
});

