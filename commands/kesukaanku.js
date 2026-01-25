const { listFavorites, deleteFavorite } = require("../storage/db");

const LIST_LIMIT = 20;
const MIN_PLAYS_FOR_PLAY = 5;

function truncateText(value, maxLength) {
  const text = String(value || "");
  if (text.length <= maxLength) return text;
  return `${text.slice(0, Math.max(0, maxLength - 3))}...`;
}

function extractVideoId(input) {
  if (!input || typeof input !== "string") return null;
  const match = input.match(/[?&]v=([a-zA-Z0-9_-]{11})/);
  if (match) return match[1];
  const shortMatch = input.match(/youtu\.be\/([a-zA-Z0-9_-]{11})/);
  if (shortMatch) return shortMatch[1];
  return null;
}

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

      const favorites = listFavorites(message.author.id, {
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

      const removed = deleteFavorite(message.author.id, videoId);
      if (!removed) {
        return message.reply("Lagu favorit tidak ditemukan.");
      }

      return message.reply("Lagu favorit berhasil dihapus.");
    }

    const favorites = listFavorites(message.author.id, {
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
