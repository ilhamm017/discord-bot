const { restoreQueue } = require("../music/queue");
const { updateControlPanel } = require("../music/panel");
const logger = require("../utils/logger");

module.exports = {
  name: "restore",
  description: "Restore antrian dari database tanpa auto-play.",
  async execute(message) {
    if (!message.guild) {
      return message.reply("Perintah ini hanya bisa dipakai di server.");
    }

    const voiceChannel = message.member?.voice?.channel;
    if (!voiceChannel) {
      return message.reply("Kamu harus join voice channel dulu.");
    }

    try {
      const result = await restoreQueue(voiceChannel, {
        textChannelId: message.channel.id,
      });

      if (!result.restored) {
        return message.reply("Tidak ada antrian tersimpan untuk direstore.");
      }

      try {
        await updateControlPanel(message.client, result.state);
      } catch (error) {
        logger.warn("Failed updating control panel.", error);
      }

      return message.reply(
        `Antrian berhasil direstore (${result.queueLength} lagu).`
      );
    } catch (error) {
      logger.error("Restore queue failed.", error);
      return message.reply("Gagal restore antrian.");
    }
  },
};
