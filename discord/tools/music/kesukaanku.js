const { listFavorites, deleteFavorite } = require("../../../storage/db");
const { truncateText, extractVideoId } = require("../../../functions/tools/kesukaanku");

module.exports = {
  name: "kesukaanku",
  description: "Lihat dan hapus daftar lagu favorit.",
  async execute(message, args) {
    if (!message.guild) {
      return message.reply("Perintah ini hanya bisa dipakai di server.");
    }

    const sub = (args[0] || "").toLowerCase();
    if (sub === "hapus" || sub === "delete") {
      const target = args.slice(1).join(" ").trim();
      if (!target) {
        return message.reply("Gunakan: yova kesukaanku hapus <nomor/url>");
      }

      const favorites = await listFavorites(message.author.id, {
        minPlays: 1,
        limit: LIST_LIMIT,
      });

      if (!favorites.length) {
        return message.reply("Belum ada daftar kesukaan.");
      }

      let videoId = null;
      if (/^\d+$/.test(target)) {
        const index = Number(target) - 1;
        if (index < 0 || index >= favorites.length) {
          return message.reply("Nomor tidak valid.");
        }
        videoId = favorites[index].video_id;
      } else {
        videoId = extractVideoId(target) || target;
      }

      const removed = await deleteFavorite(message.author.id, videoId);
      if (!removed) {
        return message.reply("Lagu favorit tidak ditemukan.");
      }

      return message.reply("Lagu favorit berhasil dihapus.");
    }

    const favorites = await listFavorites(message.author.id, {
      minPlays: 1,
      limit: LIST_LIMIT,
    });

    if (!favorites.length) {
      return message.reply("Belum ada daftar kesukaan.");
    }

    const lines = favorites.map((item, index) => {
      const title = truncateText(item.title || item.url, 60);
      return `${index + 1}. ${title} (${item.play_count}x)`;
    });

    lines.push("");
    lines.push(
      `Mainkan: yova play kesukaanku (min ${MIN_PLAYS_FOR_PLAY}x diputar)`
    );
    lines.push("Hapus: yova kesukaanku hapus <nomor/url>");

    return message.reply(lines.join("\n"));
  },
};
