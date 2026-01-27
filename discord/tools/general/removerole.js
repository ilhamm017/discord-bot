const { removeRoleFromMember, getRoleByName } = require("../../../functions/platform/identity_logic");
const logger = require("../../../utils/logger");

module.exports = {
    name: "removerole",
    description: "Menghapus role dari member. Penggunaan: yova removerole <role_name/role_id> @member",
    async execute(message, args) {
        if (!message.guild) {
            return message.reply("Perintah ini hanya bisa digunakan di server.");
        }

        if (!message.member.permissions.has("ManageRoles")) {
            return message.reply("Kamu tidak punya izin untuk mengelola role.");
        }

        if (args.length < 2) {
            return message.reply("Format salah. Penggunaan: `yova removerole <role> @member`.");
        }

        const targetMember = message.mentions.members.first();
        if (!targetMember) {
            return message.reply("Sebutkan member yang ingin dihapus rolenya (@member).");
        }

        const roleQuery = args.filter(arg => !arg.startsWith('<@')).join(' ');

        if (!roleQuery) {
            return message.reply("Sebutkan nama role atau ID role yang ingin dihapus.");
        }

        try {
            const role = await getRoleByName(message.guild.id, roleQuery);
            if (!role) {
                return message.reply(`Role "${roleQuery}" tidak ditemukan.`);
            }

            const result = await removeRoleFromMember(message.guild.id, targetMember.id, role.id, `Dihapus oleh ${message.author.tag}`);

            if (result.success) {
                return message.reply(`Berhasil menghapus role **${role.name}** dari **${targetMember.displayName}**.`);
            } else {
                return message.reply(`Gagal menghapus role: ${result.error}`);
            }
        } catch (error) {
            logger.error("Error in removerole command", error);
            return message.reply("Terjadi kesalahan saat memproses perintah.");
        }
    },
};
