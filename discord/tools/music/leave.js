const { getState, leaveVoice } = require("../../player/queue");

module.exports = {
  name: "leave",
  description: "Keluar dari voice channel.",
  async execute(message) {
    if (!message.guild) {
      return message.reply("Perintah ini hanya bisa dipakai di server.");
    }

    const state = getState(message.guild.id);
    if (!state) {
      return message.reply("Bot belum berada di voice channel.");
    }

    const voiceChannel = message.member?.voice?.channel;
    if (!voiceChannel) {
      return message.reply("Kamu harus join voice channel dulu.");
    }

    if (state.channelId && voiceChannel.id !== state.channelId) {
      return message.reply("Kamu harus berada di voice channel yang sama dengan bot.");
    }

    leaveVoice(message.guild.id);
    return message.reply("Keluar dari voice channel.");
  },
};
