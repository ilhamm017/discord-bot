const { getMemberById } = require("../../../functions/platform/identity_logic");
const logger = require("../../../utils/logger");

module.exports = {
    name: "memberinfo",
    description: "Cek info member. Penggunaan: yova memberinfo [@member]",
    async execute(message, args) {
        const targetMember = message.mentions.members.first() || message.member;
        if (!targetMember) return message.reply("Gagal mengambil data member.");

        try {
            const info = await getMemberById(message.guild.id, targetMember.id);
            if (!info) return message.reply("Info member tidak ditemukan.");

            const roles = targetMember.roles.cache
                .filter(r => r.name !== "@everyone")
                .map(r => r.name)
                .join(", ") || "Tidak ada role.";

            const reply = `**Info Member: ${info.displayName}**
- Username: ${info.username}
- User ID: ${info.userId}
- Bergabung: ${info.joinedAt.toLocaleString("id-ID")}
- Bot: ${info.isBot ? "Ya" : "Tidak"}
- Role: ${roles}`;

            return message.reply(reply);
        } catch (error) {
            logger.error("Memberinfo error", error);
            return message.reply("Error saat mengambil info member.");
        }
    },
};
