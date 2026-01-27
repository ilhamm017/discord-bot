const { buildControlPanel } = require("../../player/panel");
const { getState } = require("../../player/queue");

module.exports = {
  name: "kontrol",
  description: "Tampilkan panel kontrol musik dengan tombol.",
  async execute(message) {
    if (!message.guild) {
      return message.reply("Perintah ini hanya bisa dipakai di server.");
    }

    const state = getState(message.guild.id);
    if (!state) {
      return message.reply("Bot belum berada di voice channel.");
    }

    // Voice channel checks removed to allow control from anywhere
    // const voiceChannel = message.member?.voice?.channel;
    // if (!voiceChannel) ...
    // if (state.channelId && voiceChannel.id !== state.channelId) ...

    const panel = buildControlPanel(state);
    const sent = await message.reply(panel);
    state.panelChannelId = message.channel.id;
    state.panelMessageId = sent.id;
    return sent;
  },
};
