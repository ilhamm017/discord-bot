const { banMember } = require("../../../functions/platform/identity_logic");
const logger = require("../../../utils/logger");

module.exports = {
    name: "ban",
    description: "Ban member dari server. Penggunaan: yova ban @member [alasan]",
    async execute(message, args) {
        if (!message.guild) return message.reply("Hanya di server.");
        if (!message.member.permissions.has("BanMembers")) return message.reply("Izin kurang (BanMembers).");

        const targetMember = message.mentions.members.first();
        if (!targetMember) return message.reply("Tag membernya.");

        const reason = args.slice(1).join(' ') || "Tidak ada alasan.";

        try {
            const result = await banMember(message.guild.id, targetMember.id, reason);
            if (result.banned) {
                return message.reply(`Berhasil ban **${targetMember.user.tag}**. Alasan: ${reason}`);
            } else {
                return message.reply("Gagal ban member.");
            }
        } catch (error) {
            logger.error("Ban error", error);
            return message.reply("Error saat ban.");
        }
    },
};
