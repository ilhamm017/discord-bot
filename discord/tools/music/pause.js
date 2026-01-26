const { getState, togglePause } = require("../../player/queue");

module.exports = {
  name: "pause",
  description: "Pause atau lanjutkan musik.",
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

    const result = togglePause(message.guild.id);
    if (result.status === "paused") {
      return message.reply("Musik dipause.");
    }

    if (result.status === "resumed") {
      return message.reply("Musik dilanjutkan.");
    }

    return message.reply("Tidak ada musik yang sedang diputar.");
  },
};
