const { StringSelectMenuBuilder } = require("discord.js");

const MENTION_REGEX = /<@!?\d+>/g;
const SEARCH_OPTION_LIMIT = 25;
const BROAD_QUERY_STOPWORDS = new Set([
    "lagu",
    "song",
    "music",
    "sound",
    "effect",
    "efek",
    "suara",
    "sfx",
    "myinstants",
    "putar",
    "play",
    "please",
    "dong",
    "tolong",
    "cari",
    "cariin",
    "playlist",
    "judul",
]);

function stripTargetTokens(query, { hasMention } = {}) {
    if (!query) return "";
    let cleaned = query.replace(MENTION_REGEX, " ");
    if (hasMention) {
        cleaned = cleaned.replace(/\b(untuk|buat)\b/gi, " ");
    }
    return cleaned.replace(/\s+/g, " ").trim();
}

const { truncateText, formatDuration } = require("../../../../functions/utils/formatting");


function resolveTargetVoiceChannel(message) {
    const mentionedMember = message.mentions?.members
        ? message.mentions.members.find((member) => !member.user?.bot)
        : null;

    if (mentionedMember) {
        const targetChannel = mentionedMember.voice?.channel;
        if (!targetChannel) {
            return {
                error: "Target belum ada di voice channel.",
            };
        }
        return { channel: targetChannel, targetMember: mentionedMember };
    }

    const memberChannel = message.member?.voice?.channel;
    if (!memberChannel) {
        return { error: "Kamu harus join voice channel dulu atau sebutkan target." };
    }

    return { channel: memberChannel, targetMember: null };
}

function buildSearchSelect(results) {
    const options = results.slice(0, SEARCH_OPTION_LIMIT).map((item, index) => {
        const prefix =
            item.source === "spotify"
                ? "SP"
                : item.source === "myinstants"
                    ? "MYI"
                    : "YT";
        const label = truncateText(`${prefix}: ${item.title}`, 100);
        const duration = item.durationMs
            ? formatDuration(Math.round(item.durationMs / 1000))
            : "-";
        const descriptionBase =
            item.source === "spotify"
                ? `Spotify • ${item.artists?.join(", ") || "-"}`
                : item.source === "myinstants"
                    ? "MyInstants"
                : "YouTube";
        const description = truncateText(`${descriptionBase} • ${duration}`, 100);
        return {
            label,
            description,
            value: String(index),
        };
    });

    if (!options.length) return null;

    return new StringSelectMenuBuilder()
        .setCustomId("music_search")
        .setPlaceholder("Pilih hasil pencarian")
        .addOptions(options);
}

function shouldAutoPlaySearchQuery(query) {
    const text = String(query || "")
        .toLowerCase()
        .replace(/[^\p{L}\p{N}\s]/gu, " ")
        .replace(/\s+/g, " ")
        .trim();

    if (!text) return false;

    const tokens = text
        .split(" ")
        .map((token) => token.trim())
        .filter(Boolean);

    // Broad one-word query should still show selection menu.
    if (tokens.length <= 1) return false;

    const specificTokens = tokens.filter((token) => !BROAD_QUERY_STOPWORDS.has(token));

    // Require at least 2 meaningful terms to assume user has specific intent.
    return specificTokens.length >= 2;
}

module.exports = {
    stripTargetTokens,
    truncateText,
    formatDuration,
    resolveTargetVoiceChannel,
    buildSearchSelect,
    shouldAutoPlaySearchQuery,
};
