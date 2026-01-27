/**
 * @interface MusicDriver
 */
class MusicDriver {
    async play(guildId, voiceChannel, track) { }
    async stop(guildId) { }
    async skip(guildId) { }
    async pause(guildId) { }
    async resume(guildId) { }
    async cleanup(guildId) { }
    getState(guildId) { }
}
