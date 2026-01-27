const { AudioPlayerStatus } = require("@discordjs/voice");
const { getGuildState, cleanupGuild, connectToVoice } = require("../voice");
const { createResource } = require("../queue/resource");
const logger = require("../../../utils/logger");

class FFmpegDriver {
    type = "ffmpeg";
    async play(guildId, voiceChannel, track) {
        let state = getGuildState(guildId);
        if (!state || !state.player) {
            state = await connectToVoice(voiceChannel);
        }

        const resource = await createResource(track);
        state.player.play(resource);
        return track;
    }

    async stop(guildId) {
        const state = getGuildState(guildId);
        if (state) state.player.stop(true);
    }

    async skip(guildId) {
        const state = getGuildState(guildId);
        if (state) state.player.stop();
    }

    async pause(guildId) {
        const state = getGuildState(guildId);
        if (state) state.player.pause();
    }

    async resume(guildId) {
        const state = getGuildState(guildId);
        if (state) state.player.unpause();
    }

    async cleanup(guildId) {
        await cleanupGuild(guildId);
    }

    async jumpToIndex(guildId, index) {
        const { jumpToIndex } = require("../queue");
        return jumpToIndex(guildId, index);
    }

    getState(guildId) {
        return getGuildState(guildId);
    }
}

module.exports = new FFmpegDriver();
