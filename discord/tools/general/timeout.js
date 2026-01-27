const { timeoutMember } = require("../../../functions/platform/identity_logic");
const logger = require("../../../utils/logger");

module.exports = {
    name: "timeout",
    description: "Kasih timeout ke member. Penggunaan: yova timeout @member <menit> [alasan]",
    async execute(message, args) {
        if (!message.guild) return message.reply("Hanya di server.");
        if (!message.member.permissions.has("ModerateMembers")) return message.reply("Izin kurang.");

        const targetMember = message.mentions.members.first();
        if (!targetMember) return message.reply("Tag membernya.");

        const minutes = parseInt(args[1]);
        if (isNaN(minutes)) return message.reply("Sebutkan durasi dalam menit.");

        const reason = args.slice(2).join(' ') || "Tidak ada alasan.";

        try {
            const result = await timeoutMember(message.guild.id, targetMember.id, minutes * 60 * 1000, reason);
            if (result.timedOut) {
                return message.reply(`Berhasil timeout **${targetMember.user.tag}** selama ${minutes} menit.`);
            } else {
                return message.reply("Gagal timeout member.");
            }
        } catch (error) {
            logger.error("Timeout error", error);
            return message.reply("Error saat timeout.");
        }
    },
};
