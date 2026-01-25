module.exports = {
  name: "ping",
  description: "Replies with pong.",
  async execute(message) {
    return message.reply("pong");
  },
};
