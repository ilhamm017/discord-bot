const platform = require("../../../functions/platform");
const getConfig = require("../../../config/index.js");

module.exports = {
  name: "browseros",
  description: "Buka URL (catatan: mode interaktif butuh GUI; server headless tidak bisa).",
  async execute(message, args) {
    const config = getConfig();
    const prefix = String(config.prefix || "yova").trim() || "yova";

    const sub = String(args[0] || "").toLowerCase();
    if (sub !== "open") {
      return message.reply(`Format: \`${prefix} browseros open <url>\``);
    }

    const url = String(args[1] || "").trim();
    if (!url) {
      return message.reply(`Format: \`${prefix} browseros open <url>\``);
    }

    try {
      await platform.browserosOpenInteractive(message.guild?.id || "dm", message.author?.id, url);
      return message.reply(
        [
          "Sudah kubuka di browser (tab visible).",
          "Silakan login/manual action di sana, lalu jalankan:",
          `\`${prefix} browse ${url}\``,
        ].join("\n")
      );
    } catch (error) {
      return message.reply(`Tidak bisa open interaktif: ${error?.message || String(error)}`);
    }
  },
};
