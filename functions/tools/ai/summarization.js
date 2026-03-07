// functions/tools/ai/summarization.js
const { chatCompletion } = require("../../../ai/completion");
const { truncateText } = require("../../utils/formatting");

const MAX_CHARS_PER_MESSAGE = 200;

function formatMessage(msg) {
    const content = msg.content?.trim();
    const parts = [];
    if (content) {
        parts.push(truncateText(content, MAX_CHARS_PER_MESSAGE));
    }
    if (msg.attachments?.size || msg.hasAttachments) {
        parts.push("[attachment]");
    }
    if (!parts.length) return null;
    const name = msg.authorName || msg.author?.username || "unknown";
    return `${name}: ${parts.join(" ")}`;
}

async function generateSummary(items, options = {}) {
    const {
        temperature = 0.2,
        maxTokens = 260
    } = options;

    if (!items.length) return null;

    const systemPrompt =
        "Kamu merangkum percakapan dalam Bahasa Indonesia. " +
        "Ringkas, netral, dan akurat. " +
        "Jangan menambah fakta yang tidak ada. " +
        "Gunakan bullet points (3-7 poin) dan sebut topik utama, keputusan, dan pertanyaan penting. " +
        "Jika ada candaan, sebut singkat tanpa detail berlebihan.";
    const userPrompt =
        `Ringkas percakapan terakhir (${items.length} pesan) dari channel ini:\n\n` +
        items.join("\n");

    return await chatCompletion({
        system: systemPrompt,
        user: userPrompt,
        temperature,
        maxTokens,
    });
}

/**
 * Parses a limit from arguments or returns default.
 */
function parseLimit(args, { defaultLimit, maxLimit }) {
    if (!args?.length) return defaultLimit;
    const match = args.join(" ").match(/\b(\d{1,3})\b/);
    if (!match) return defaultLimit;
    const value = Number.parseInt(match[1], 10);
    if (!Number.isInteger(value) || value <= 0) return defaultLimit;
    return Math.min(value, maxLimit);
}

module.exports = {
    formatMessage,
    generateSummary,
    parseLimit,
};
