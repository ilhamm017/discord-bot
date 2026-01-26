const { getState, previousTrack } = require("../../player/queue");
const logger = require("../../../utils/logger");

module.exports = {
  name: "sebelumnya",
  description: "Kembali ke lagu sebelumnya.",
  async execute(message) {
    if (!message.guild) {
      return message.reply("Perintah ini hanya bisa dipakai di server.");
    }

    const state = getState(message.guild.id);
    if (!state || !Array.isArray(state.queue) || state.queue.length === 0) {
      return message.reply("Tidak ada musik yang sedang diputar.");
    }

    const voiceChannel = message.member?.voice?.channel;
    if (!voiceChannel) {
      return message.reply("Kamu harus join voice channel dulu.");
    }

    if (state.channelId && voiceChannel.id !== state.channelId) {
      return message.reply("Kamu harus berada di voice channel yang sama dengan bot.");
    }

    if (state.currentIndex <= 0) {
      return message.reply("Tidak ada lagu sebelumnya.");
    }

    let track;
    try {
      track = await previousTrack(message.guild.id);
    } catch (error) {
      logger.error("Previous error.", error);
      return message.reply("Gagal memutar lagu sebelumnya.");
    }

    if (!track) {
      return message.reply("Gagal memutar lagu sebelumnya.");
    }

    return message.reply(`Memutar: ${track.title}`);
  },
};
