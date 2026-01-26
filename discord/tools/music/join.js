const { ChannelType } = require("discord.js");
const { connectToVoice } = require("../../player/voice");
const logger = require("../../../utils/logger");

let config = {};
try {
  config = require("../../../config.json");
} catch (error) {
  config = {};
}

const {
  isVoiceChannel,
  findVoiceChannelByName,
  resolveDefaultVoiceChannel
} = require("../../../functions/tools/music/connection_logic");


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
        targetChannel = resolveDefaultVoiceChannel(message.guild, config, ChannelType);
      }
    } else if (raw.toLowerCase() === "default") {
      targetChannel = resolveDefaultVoiceChannel(message.guild, config, ChannelType);
    } else {
      targetChannel =
        message.guild.channels.cache.get(raw) ||
        findVoiceChannelByName(message.guild, raw, ChannelType);
    }

    if (!targetChannel) {
      return message.reply(
        "Voice channel tidak ditemukan. Coba mention user atau tulis nama channel."
      );
    }

    if (!isVoiceChannel(targetChannel, ChannelType)) {
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
