const { ChannelType } = require("discord.js");
const { getOrCreateState } = require("../../player/voice");
const lavalinkService = require("../../player/LavalinkManager");
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

async function waitForConnected(player, timeoutMs = 6000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (player?.connected) return true;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  return Boolean(player?.connected);
}

async function connectWithLavalink(targetChannel) {
  const manager = lavalinkService.getManager();
  if (!manager) {
    throw new Error("Lavalink manager belum siap.");
  }

  const guildId = targetChannel.guild.id;
  let player = manager.players.get(guildId);
  if (!player) {
    player = await manager.createPlayer({
      guildId,
      voiceChannelId: targetChannel.id,
      textChannelId: null,
      selfDeaf: true,
      selfMute: false,
      volume: 100,
    });
  }

  if (player.voiceChannelId !== targetChannel.id) {
    if (player.voiceChannelId) {
      await player.changeVoiceState({
        voiceChannelId: targetChannel.id,
        selfDeaf: true,
        selfMute: false,
      });
    } else {
      player.options.voiceChannelId = targetChannel.id;
    }
  }

  if (!player.connected) {
    player.options.voiceChannelId = targetChannel.id;
    await player.connect();
    const connected = await waitForConnected(player, 6000);
    if (!connected) {
      throw new Error("Lavalink gagal tersambung ke voice channel.");
    }
  }

  const state = getOrCreateState(guildId);
  state.channelId = targetChannel.id;
  state.engine = "lavalink";
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
        await connectWithLavalink(targetChannel);
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
      await connectWithLavalink(targetChannel);
      return message.reply(`Masuk ke voice: ${targetChannel.name}`);
    } catch (error) {
      logger.error("Join voice failed.", error);
      return message.reply("Gagal masuk ke voice channel.");
    }
  },
};
