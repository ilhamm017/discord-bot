const logger = require("../../../utils/logger");
const { chatCompletion } = require("../../../functions/ai/completion");
const { waitWithTyping } = require("../../../utils/common/typing");
let config = {};

try {
  config = require("../../../config.json");
} catch (error) {
  config = {};
}

const DEFAULT_LIMIT = Number.isInteger(config.channel_summary_message_limit)
  ? config.channel_summary_message_limit
  : 50;
const MAX_LIMIT = Number.isInteger(config.channel_summary_message_max_limit)
  ? config.channel_summary_message_max_limit
  : 200;
const MAX_CHARS_PER_MESSAGE = Number.isInteger(
  config.channel_summary_max_chars_per_message
)
  ? config.channel_summary_max_chars_per_message
  : 200;
const SUMMARY_MAX_TOKENS = Number.isFinite(Number(config.google_summary_max_tokens || config.groq_summary_max_tokens))
  ? Number(config.google_summary_max_tokens || config.groq_summary_max_tokens)
  : 260;
const SUMMARY_TEMPERATURE = Number.isFinite(
  Number(config.google_summary_temperature || config.groq_summary_temperature)
)
  ? Number(config.google_summary_temperature || config.groq_summary_temperature)
  : 0.2;

const PREFIX = String(config.prefix || "!");

const { truncateText } = require("../../../functions/utils/formatting");
const {
  formatMessage,
  generateSummary,
  parseLimit
} = require("../../../functions/tools/ai/summarization");


module.exports = {
  name: "ringkas",
  description: "Ringkas percakapan terbaru di channel ini.",
  async execute(message, args) {
    if (!message.guild) {
      return message.reply("Perintah ini hanya bisa dipakai di server.");
    }

    const limit = parseLimit(args, { defaultLimit: DEFAULT_LIMIT, maxLimit: MAX_LIMIT });
    let fetched;
    try {
      fetched = await message.channel.messages.fetch({ limit });
    } catch (error) {
      logger.error("Failed fetching channel messages.", error);
      return message.reply("Gagal mengambil pesan channel.");
    }

    const prefixLower = PREFIX.toLowerCase();
    const items = Array.from(fetched.values())
      .filter((msg) => msg.id !== message.id)
      .filter((msg) => !msg.author?.bot)
      .filter((msg) => {
        const text = msg.content?.trim();
        if (!text) return Boolean(msg.attachments?.size);
        if (text.toLowerCase().startsWith(prefixLower)) return false;
        return true;
      })
      .sort((a, b) => a.createdTimestamp - b.createdTimestamp)
      .map(msg => formatMessage({
        content: msg.content,
        attachments: msg.attachments,
        authorName: msg.member?.displayName || msg.author?.username
      }))
      .filter(Boolean);

    if (!items.length) {
      return message.reply("Tidak ada pesan untuk diringkas.");
    }

    let summary;
    try {
      summary = await generateSummary(items, {
        temperature: SUMMARY_TEMPERATURE,
        maxTokens: SUMMARY_MAX_TOKENS,
      });
    } catch (error) {
      logger.error("Summary generation failed.", error);
      return message.reply("Gagal membuat ringkasan.");
    }

    const output = summary?.trim();
    if (!output) {
      return message.reply("Ringkasan kosong.");
    }

    await waitWithTyping(message.channel, output);
    return message.reply(output);
  },
};
