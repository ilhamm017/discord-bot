const { getState, skipTrack } = require("../../player/queue");
const logger = require("../../../utils/logger");

module.exports = {
  name: "skip",
  description: "Lompat ke lagu berikutnya.",
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

    if (state.currentIndex >= state.queue.length - 1 && state.repeatMode !== "all") {
      return message.reply("Tidak ada lagu berikutnya di antrian.");
    }

    let track;
    try {
      track = await skipTrack(message.guild.id);
    } catch (error) {
      logger.error("Skip error.", error);
      return message.reply("Gagal memutar lagu berikutnya.");
    }

    if (!track) {
      return message.reply("Gagal memutar lagu berikutnya.");
    }

    return message.reply(`Memutar: ${track.title}`);
  },
};
