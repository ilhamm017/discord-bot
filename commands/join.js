const { ChannelType } = require("discord.js");
const { connectToVoice } = require("../music/voice");
const logger = require("../utils/logger");

let config = {};
try {
  config = require("../config.json");
} catch (error) {
  config = {};
}

function isVoiceChannel(channel) {
  return (
    channel?.type === ChannelType.GuildVoice ||
    channel?.type === ChannelType.GuildStageVoice
  );
}

function findVoiceChannelByName(guild, name) {
  if (!guild || !name) return null;
  const target = String(name).toLowerCase();
  const voiceChannels = guild.channels.cache.filter((channel) =>
    isVoiceChannel(channel)
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

function resolveDefaultVoiceChannel(guild) {
  if (!guild) return null;
  const configured =
    config.default_voice_channel || config.defaultVoiceChannel || "";
  if (!configured) return null;

  const byId = guild.channels.cache.get(configured);
  if (isVoiceChannel(byId)) return byId;

  return findVoiceChannelByName(guild, configured);
}

module.exports = {
  name: "join",
  description: "Masuk ke voice channel berdasarkan nama atau user.",
  async execute(message, args) {
    if (!message.guild) {
      return message.reply("Perintah ini hanya bisa dipakai di server.");
    }

    const mentionedMember = message.mentions?.members?.first();
    if (mentionedMember) {
      const targetChannel = mentionedMember.voice?.channel;
      if (!targetChannel) {
        return message.reply("Target belum ada di voice channel.");
      }

      try {
        await connectToVoice(targetChannel);
        return message.reply(`Masuk ke voice: ${targetChannel.name}`);
      } catch (error) {
        logger.error("Join voice failed.", error);
        return message.reply("Gagal masuk ke voice channel.");
      }
    }

    const raw = args.join(" ").trim();
    let targetChannel = null;

    if (!raw) {
      targetChannel = message.member?.voice?.channel || null;
      if (!targetChannel) {
        targetChannel = resolveDefaultVoiceChannel(message.guild);
      }
    } else if (raw.toLowerCase() === "default") {
      targetChannel = resolveDefaultVoiceChannel(message.guild);
    } else {
      targetChannel =
        message.guild.channels.cache.get(raw) ||
        findVoiceChannelByName(message.guild, raw);
    }

    if (!targetChannel) {
      return message.reply(
        "Voice channel tidak ditemukan. Coba mention user atau tulis nama channel."
      );
    }

    if (!isVoiceChannel(targetChannel)) {
      return message.reply("Target bukan voice channel.");
    }

    try {
      await connectToVoice(targetChannel);
      return message.reply(`Masuk ke voice: ${targetChannel.name}`);
    } catch (error) {
      logger.error("Join voice failed.", error);
      return message.reply("Gagal masuk ke voice channel.");
    }
  },
};
