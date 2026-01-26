// functions/tools/music/connection_logic.js

function isVoiceChannel(channel, ChannelType) {
    if (!channel) return false;
    // We pass ChannelType from the caller to stay relatively agnostic or use IDs
    return (
        channel.type === ChannelType.GuildVoice ||
        channel.type === ChannelType.GuildStageVoice
    );
}

function findVoiceChannelByName(guild, name, ChannelType) {
    if (!guild || !name) return null;
    const target = String(name).toLowerCase();
    const voiceChannels = guild.channels.cache.filter((channel) =>
        isVoiceChannel(channel, ChannelType)
    );

    let match = voiceChannels.find(
        (channel) => channel.name.toLowerCase() === target
    );
    if (match) return match;

    match = voiceChannels.find((channel) =>
        channel.name.toLowerCase().includes(target)
    );
    return match || null;
}

function resolveDefaultVoiceChannel(guild, config, ChannelType) {
    if (!guild || !config) return null;
    const configured = config.default_voice_channel || config.defaultVoiceChannel || "";
    if (!configured) return null;

    const byId = guild.channels.cache.get(configured);
    if (isVoiceChannel(byId, ChannelType)) return byId;

    return findVoiceChannelByName(guild, configured, ChannelType);
}

module.exports = {
    isVoiceChannel,
    findVoiceChannelByName,
    resolveDefaultVoiceChannel,
};
