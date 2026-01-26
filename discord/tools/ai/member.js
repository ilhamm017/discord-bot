const logger = require("../../../utils/logger");

const {
  parseLimit,
  formatMemberData,
  formatMemberLine,
  getSortedMembers,
} = require("../../../functions/tools/member_logic");


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

    const memberDataList = Array.from(list.values()).map(formatMemberData);

    const result = getSortedMembers(memberDataList, { type: sub, limit });

    if (!result.length) {
      return message.reply("Tidak ada data member yang bisa ditampilkan.");
    }

    const lines = result.map((data, index) => formatMemberLine(data, index + 1));

    let title = "Daftar member:";
    if (["awal", "pertama", "lama", "oldest"].includes(sub)) title = `Member paling awal join (top ${result.length}):`;
    if (["baru", "terbaru", "newest"].includes(sub)) title = `Member paling baru join (top ${result.length}):`;
    if (["daftar", "list", "sample"].includes(sub)) title = `Daftar member (contoh ${result.length} pertama):`;

    return message.reply(`${title}\n${lines.join("\n")}`);

    return message.reply(
      "Subcommand tidak dikenal. Contoh: `yova member awal 5`."
    );
  },
};
