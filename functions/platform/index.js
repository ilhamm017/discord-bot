const chat = require("./chat_logic");
const identity = require("./identity_logic");
const core = require("./core_logic");
const policy = require("./policy_logic");
const music = require("./music_logic");

module.exports = {
    ...chat,
    ...identity,
    ...core,
    ...policy,
    ...music
};
