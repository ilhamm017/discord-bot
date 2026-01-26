const { setUserCallName, getUserCallName, clearUserCallName } = require("../../../storage/db");

const { sanitizeCallName } = require("../../../functions/tools/ai/message_generation");

module.exports = {
  name: "panggil",
  description: "Atur panggilan yang dipakai bot untuk kamu.",
  async execute(message, args) {
    const raw = args.join(" ").trim();
    if (!raw) {
      const current = getUserCallName(message.author.id);
      if (current) {
        return message.reply(`Oke, panggilan kamu saat ini: ${current}.`);
      }
      return message.reply("Contoh: yova panggil aku sulifan");
    }

    let payload = raw;
    const selfMatch = payload.match(/^(aku|saya)\s+(.+)/i);
    if (selfMatch) {
      payload = selfMatch[2];
    }

    if (/^(reset|hapus|lupa|clear)$/i.test(payload.trim())) {
      clearUserCallName(message.author.id);
      return message.reply("Oke, panggilan kamu gue hapus.");
    }

    const callName = sanitizeCallName(payload);
    if (!callName) {
      return message.reply("Nama panggilan nggak valid.");
    }

    setUserCallName(message.author.id, callName);
    return message.reply(`Sip, gue panggil kamu ${callName}.`);
  },
};
