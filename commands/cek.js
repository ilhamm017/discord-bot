const memberCommand = require("./member");

module.exports = {
  name: "cek",
  description: "Alias cek untuk beberapa info cepat.",
  async execute(message, args) {
    const target = (args[0] || "").toLowerCase();
    if (["member", "anggota", "members"].includes(target)) {
      return memberCommand.execute(message, args.slice(1));
    }

    return message.reply("Cek apa? Contoh: `yova cek member awal 5`.");
  },
};
