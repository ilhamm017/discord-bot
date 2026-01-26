const { getState, stopPlayback } = require("../../player/queue");

module.exports = {
  name: "stop",
  description: "Hentikan musik dan bersihkan antrian.",
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

    stopPlayback(message.guild.id);
    return message.reply("Playback dihentikan dan antrian dibersihkan.");
  },
};
