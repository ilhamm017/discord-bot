const { getBotHelpText, answerBotQuestion } = require("../../../utils/common/bot_docs");
const { waitWithTyping } = require("../../../utils/common/typing");

module.exports = {
  name: "jelaskan",
  description: "Menjelaskan bot dan fitur-fiturnya.",
  async execute(message, args) {
    const prompt = args.join(" ").trim();
    const reply = prompt ? answerBotQuestion(prompt) : getBotHelpText();
    await waitWithTyping(message.channel, reply);
    return message.reply(reply);
  },
};
