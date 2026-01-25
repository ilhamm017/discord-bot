const logger = require("../utils/logger");

function parseLimit(value, fallback = 5) {
  const num = Number.parseInt(value, 10);
  if (Number.isInteger(num) && num > 0) {
    return Math.min(num, 20);
  }
  return fallback;
}

function formatMemberLine(member, index) {
  const name = member.displayName || member.user?.username || "unknown";
  const tag = member.user?.tag || member.user?.username || "unknown";
  const joinedAt = member.joinedAt
    ? member.joinedAt.toISOString().slice(0, 10)
    : "unknown";
  return `${index}. ${name} (${tag}) — join ${joinedAt}`;
}

module.exports = {
  name: "member",
  description: "Info member server (awal/baru/daftar/jumlah).",
  async execute(message, args) {
    if (!message.guild) {
      return message.reply("Perintah ini hanya bisa dipakai di server.");
    }

    const sub = (args[0] || "").toLowerCase();
    const limit = parseLimit(args[1], 5);

    let members;
    try {
      members = await message.guild.members.fetch();
    } catch (error) {
      logger.error("Failed fetching full members.", error);
      return message.reply(
        "Gagal mengambil data member. Pastikan Server Members Intent aktif."
      );
    }

    const list = members.filter((member) => !member.user?.bot);
    const count = list.size;

    if (!sub || sub === "help") {
      return message.reply(
        "Gunakan: `yova member awal [n]`, `yova member baru [n]`, " +
          "`yova member daftar [n]`, atau `yova member jumlah`."
      );
    }

    if (["jumlah", "count"].includes(sub)) {
      return message.reply(`Total member (tanpa bot): ${count}.`);
    }

    const sorted = Array.from(list.values()).filter(
      (member) => Boolean(member.joinedAt)
    );
    if (!sorted.length) {
      return message.reply("Tidak ada data join date yang bisa dipakai.");
    }

    if (["awal", "pertama", "lama", "oldest"].includes(sub)) {
      sorted.sort((a, b) => a.joinedAt - b.joinedAt);
      const top = sorted.slice(0, limit);
      const lines = top.map((member, index) =>
        formatMemberLine(member, index + 1)
      );
      return message.reply(
        `Member paling awal join (top ${top.length}):\n` + lines.join("\n")
      );
    }

    if (["baru", "terbaru", "newest"].includes(sub)) {
      sorted.sort((a, b) => b.joinedAt - a.joinedAt);
      const top = sorted.slice(0, limit);
      const lines = top.map((member, index) =>
        formatMemberLine(member, index + 1)
      );
      return message.reply(
        `Member paling baru join (top ${top.length}):\n` + lines.join("\n")
      );
    }

    if (["daftar", "list", "sample"].includes(sub)) {
      const top = sorted.sort((a, b) => a.joinedAt - b.joinedAt).slice(0, limit);
      const lines = top.map((member, index) =>
        formatMemberLine(member, index + 1)
      );
      return message.reply(
        `Daftar member (contoh ${top.length} pertama):\n` + lines.join("\n")
      );
    }

    return message.reply(
      "Subcommand tidak dikenal. Contoh: `yova member awal 5`."
    );
  },
};
