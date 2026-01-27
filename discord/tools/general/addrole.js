const { addRoleToMember, getRoleByName } = require("../../../functions/platform/identity_logic");
const logger = require("../../../utils/logger");

module.exports = {
    name: "addrole",
    description: "Menambahkan role ke member. Penggunaan: yova addrole <role_name/role_id> @member",
    async execute(message, args) {
        if (!message.guild) {
            return message.reply("Perintah ini hanya bisa digunakan di server.");
        }

        // Cek izin (opsional, tapi disarankan)
        if (!message.member.permissions.has("ManageRoles")) {
            return message.reply("Kamu tidak punya izin untuk mengelola role.");
        }

        if (args.length < 2) {
            return message.reply("Format salah. Penggunaan: `yova addrole <role> @member` atau `addrole <role> @member` (tergantung prefix)");
        }

        const targetMember = message.mentions.members.first();
        if (!targetMember) {
            return message.reply("Sebutkan member yang ingin ditambahkan role (@member).");
        }

        // Ambil nama role (semua argumen kecuali yang mention)
        const roleQuery = args.filter(arg => !arg.startsWith('<@')).join(' ');

        if (!roleQuery) {
            return message.reply("Sebutkan nama role atau ID role yang ingin ditambahkan.");
        }

        try {
            const role = await getRoleByName(message.guild.id, roleQuery);
            if (!role) {
                return message.reply(`Role "${roleQuery}" tidak ditemukan.`);
            }

            const result = await addRoleToMember(message.guild.id, targetMember.id, role.id, `Ditambahkan oleh ${message.author.tag}`);

            if (result.success) {
                return message.reply(`Berhasil menambahkan role **${role.name}** ke **${targetMember.displayName}**.`);
            } else {
                return message.reply(`Gagal menambahkan role: ${result.error}`);
            }
        } catch (error) {
            logger.error("Error in addrole command", error);
            return message.reply("Terjadi kesalahan saat memproses perintah.");
        }
    },
};
