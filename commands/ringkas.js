const logger = require("../utils/logger");
const { chatCompletion } = require("../utils/groq");
const { waitWithTyping } = require("../utils/typing");
let config = {};

try {
  config = require("../config.json");
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
const SUMMARY_MAX_TOKENS = Number.isFinite(Number(config.groq_summary_max_tokens))
  ? Number(config.groq_summary_max_tokens)
  : 260;
const SUMMARY_TEMPERATURE = Number.isFinite(
  Number(config.groq_summary_temperature)
)
  ? Number(config.groq_summary_temperature)
  : 0.2;

const PREFIX = String(config.prefix || "!");

function parseLimit(args) {
  if (!args?.length) return DEFAULT_LIMIT;
  const match = args.join(" ").match(/\b(\d{1,3})\b/);
  if (!match) return DEFAULT_LIMIT;
  const value = Number.parseInt(match[1], 10);
  if (!Number.isInteger(value) || value <= 0) return DEFAULT_LIMIT;
  return Math.min(value, MAX_LIMIT);
}

function formatMessage(msg) {
  const content = msg.content?.trim();
  const parts = [];
  if (content) {
    parts.push(content.slice(0, MAX_CHARS_PER_MESSAGE));
  }
  if (msg.attachments?.size) {
    parts.push("[attachment]");
  }
  if (!parts.length) return null;
  const name = msg.member?.displayName || msg.author?.username || "unknown";
  return `${name}: ${parts.join(" ")}`;
}

module.exports = {
  name: "ringkas",
  description: "Ringkas percakapan terbaru di channel ini.",
  async execute(message, args) {
    if (!message.guild) {
      return message.reply("Perintah ini hanya bisa dipakai di server.");
    }

    const limit = parseLimit(args);
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
      .map(formatMessage)
      .filter(Boolean);

    if (!items.length) {
      return message.reply("Tidak ada pesan untuk diringkas.");
    }

    const systemPrompt =
      "Kamu merangkum chat Discord dalam Bahasa Indonesia. " +
      "Ringkas, netral, dan akurat. " +
      "Jangan menambah fakta yang tidak ada. " +
      "Gunakan bullet points (3-7 poin) dan sebut topik utama, keputusan, dan pertanyaan penting. " +
      "Jika ada candaan, sebut singkat tanpa detail berlebihan.";
    const userPrompt =
      `Ringkas percakapan terakhir (${items.length} pesan) dari channel ini:\n\n` +
      items.join("\n");

    let summary;
    try {
      summary = await chatCompletion({
        system: systemPrompt,
        user: userPrompt,
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
