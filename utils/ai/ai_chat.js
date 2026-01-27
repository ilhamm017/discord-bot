const logger = require("../logger");
const { chatCompletion } = require("../../functions/ai/completion");
const {
  getUserCallName,
  setUserCallName,
  clearUserCallName,
  addUserMemory,
  listUserMemory,
  loadQueueState,
} = require("../../storage/db");
const { searchWeb } = require("../../functions/platform/core_logic");
const { answerBotQuestion, isBotQuestion } = require("../common/bot_docs");
const { getState } = require("../../discord/player/queue");
let config = {};

try {
  config = require("../../config.json");
} catch (error) {
  config = {};
}

const prefix = String(config.prefix || "!");
const AI_CONTEXT_LIMIT = Number.isInteger(config.groq_chat_context_messages)
  ? config.groq_chat_context_messages
  : Number.isInteger(config.groq_context_messages)
    ? config.groq_context_messages
    : 6;
const AI_HISTORY_FETCH_LIMIT = Number.isInteger(config.groq_chat_history_fetch_limit)
  ? config.groq_chat_history_fetch_limit
  : Number.isInteger(config.groq_history_fetch_limit)
    ? config.groq_history_fetch_limit
    : 80;
const AI_HISTORY_MAX_CHARS = Number.isInteger(config.groq_chat_history_max_chars)
  ? config.groq_chat_history_max_chars
  : Number.isInteger(config.groq_history_max_chars)
    ? config.groq_history_max_chars
    : 500;
const AI_MEMORY_ENABLED =
  typeof config.ai_memory_enabled === "boolean"
    ? config.ai_memory_enabled
    : true;
const AI_MEMORY_MAX_ITEMS = Number.isInteger(config.ai_memory_max_items)
  ? config.ai_memory_max_items
  : 8;
const AI_MEMORY_TTL_DAYS = Number.isInteger(config.ai_memory_ttl_days)
  ? config.ai_memory_ttl_days
  : 90;
const AI_MEMORY_MAX_VALUE_CHARS = Number.isInteger(
  config.ai_memory_max_value_chars
)
  ? config.ai_memory_max_value_chars
  : 80;
const AI_TEMPERATURE = Number.isFinite(Number(config.groq_chat_temperature))
  ? Number(config.groq_chat_temperature)
  : Number.isFinite(Number(config.groq_temperature))
    ? Number(config.groq_temperature)
    : 0.3;
const AI_MAX_TOKENS = Number.isFinite(Number(config.groq_chat_max_tokens))
  ? Number(config.groq_chat_max_tokens)
  : Number.isFinite(Number(config.groq_max_tokens))
    ? Number(config.groq_max_tokens)
    : 200;
const AI_MAX_MESSAGE_LENGTH = 1800;
const MEMBER_SAMPLE_LIMIT = 8;
const MEMBER_FETCH_MODE = String(
  config.guild_members_fetch_mode ||
  config.guildMembersFetchMode ||
  "sample"
).toLowerCase();
const MEMBER_FETCH_COOLDOWN_MS = Number.isInteger(
  config.guild_members_fetch_cooldown_ms
)
  ? config.guild_members_fetch_cooldown_ms
  : 10 * 60 * 1000;
const lastMemberFetchAt = new Map();
const AI_COMMANDS_FALLBACK = [
  "addrole",
  "ban",
  "cek",
  "jelaskan",
  "join",
  "kesukaanku",
  "kontrol",
  "leave",
  "member",
  "memberinfo",
  "next",
  "panggil",
  "pause",
  "ping",
  "play",
  "rangkum",
  "removerole",
  "restore",
  "ringkas",
  "sebelumnya",
  "skip",
  "stop",
  "timeout",
  "ucapkan",
];

function getAiCommandList(message) {
  const commands = message?.client?.commands;
  if (commands && typeof commands.keys === "function") {
    const list = Array.from(commands.keys())
      .map((name) => String(name).toLowerCase())
      .filter(Boolean);
    const unique = Array.from(new Set(list));
    if (unique.length) return unique.sort();
  }
  return AI_COMMANDS_FALLBACK.slice();
}

function sanitizeMessage(text) {
  if (!text) return "";
  return String(text)
    .replace(/@everyone/gi, "@\u200beveryone")
    .replace(/@here/gi, "@\u200bhere")
    .trim();
}

function getHistoryMessageLimit() {
  return Math.max(80, Math.min(AI_HISTORY_MAX_CHARS, 1200));
}

function normalizeReplyContext(text) {
  const cleaned = String(text || "").replace(/\s+/g, " ").trim();
  if (!cleaned) return "";
  const maxChars = getHistoryMessageLimit();
  return cleaned.slice(0, maxChars);
}

const CHANNEL_CONTEXT_PATTERNS = [
  /\bsiapa\b/i,
  /\bbarusan\b/i,
  /\btadi\b.*\b(kenapa|ngapain|apa|bahas|dibahas|ngomong|rame|ramai)\b/i,
  /\b(ngomongin|dibahas|bahas|topik|diskusi|riwayat|timeline)\b/i,
  /\b(di|dalam)\s+(chat|channel|ruangan|room|server)\b/i,
  /\b(orang lain|yang lain|member|anggota|kalian|teman|temen|pada)\b/i,
];

const PERSON_CONTEXT_PATTERNS = [
  /\b(kenapa|ngapain|ngapa|gimana|gmn|dimana|di mana|barusan|tadi|lagi)\b/i,
  /\b(ada apa|kenapa)\b/i,
  /\b(masalah|drama|ribut|berantem|salah|problem)\b/i,
];

const NAME_TOKEN_MIN_LEN = 3;
const NAME_FUZZY_MIN_LEN = 4;
const NAME_STOPWORDS = new Set([
  "yang",
  "tadi",
  "barusan",
  "kenapa",
  "gimana",
  "gmn",
  "dimana",
  "siapa",
  "apa",
  "itu",
  "di",
  "ke",
  "dari",
  "grup",
  "group",
  "chat",
  "channel",
  "ruangan",
  "room",
  "server",
  "member",
  "anggota",
  "orang",
  "teman",
  "temen",
  "kalian",
  "pada",
  "masalah",
  "topik",
  "diskusi",
  "ngomong",
  "bahas",
  "dibahas",
  "ngomongin",
  "ada",
]);

function normalizeNameText(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function extractNameTokens(prompt) {
  const normalized = normalizeNameText(prompt);
  if (!normalized) return [];
  const tokens = normalized
    .split(/\s+/)
    .filter((token) => token.length >= NAME_TOKEN_MIN_LEN)
    .filter((token) => !NAME_STOPWORDS.has(token));
  return Array.from(new Set(tokens));
}

function resolveMemberFromText(message, prompt) {
  const tokens = extractNameTokens(prompt);
  if (!tokens.length) return null;
  const members = message?.guild?.members?.cache;
  if (!members || members.size === 0) return null;

  let bestScore = 0;
  let bestMember = null;
  let isTie = false;

  for (const member of members.values()) {
    if (member.user?.bot) continue;
    const names = [
      member.displayName,
      member.user?.globalName,
      member.user?.username,
    ].filter(Boolean);
    if (!names.length) continue;

    let score = 0;
    for (const rawName of names) {
      const normalizedName = normalizeNameText(rawName);
      if (!normalizedName) continue;
      const parts = normalizedName.split(/\s+/).filter(Boolean);
      for (const token of tokens) {
        if (parts.includes(token)) {
          score = Math.max(score, 3);
        } else if (
          token.length >= NAME_FUZZY_MIN_LEN &&
          parts.some((part) => part.startsWith(token))
        ) {
          score = Math.max(score, 2);
        } else if (
          token.length >= NAME_FUZZY_MIN_LEN + 1 &&
          normalizedName.includes(token)
        ) {
          score = Math.max(score, 1);
        }
      }
    }

    if (score > bestScore) {
      bestScore = score;
      bestMember = member;
      isTie = false;
    } else if (score === bestScore && score > 0) {
      isTie = true;
    }
  }

  if (!bestMember || isTie) return null;
  if (bestScore < 2) return null;
  return {
    id: bestMember.user?.id,
    displayName:
      bestMember.displayName ||
      bestMember.user?.globalName ||
      bestMember.user?.username ||
      "User",
  };
}

function getChannelContextScope(message, prompt) {
  const mentions = message?.mentions;
  if (mentions?.users?.size) {
    const ids = Array.from(mentions.users.keys()).filter(Boolean);
    return { includeOthers: true, allowedAuthorIds: ids.length ? ids : null };
  }
  if (mentions?.roles?.size) {
    return { includeOthers: true, allowedAuthorIds: null };
  }
  if (mentions?.everyone || mentions?.here) {
    return { includeOthers: true, allowedAuthorIds: null };
  }
  if (!prompt) {
    return { includeOthers: false, allowedAuthorIds: null };
  }
  const hasChannelIntent = CHANNEL_CONTEXT_PATTERNS.some((pattern) =>
    pattern.test(prompt)
  );
  const hasPersonIntent = PERSON_CONTEXT_PATTERNS.some((pattern) =>
    pattern.test(prompt)
  );

  if (hasPersonIntent) {
    const resolved = resolveMemberFromText(message, prompt);
    if (resolved?.id) {
      return { includeOthers: true, allowedAuthorIds: [resolved.id] };
    }
  }

  if (hasChannelIntent) {
    return { includeOthers: true, allowedAuthorIds: null };
  }

  return { includeOthers: false, allowedAuthorIds: null };
}

function formatHistoryForRouter(history) {
  if (!Array.isArray(history) || history.length === 0) return "";
  return history
    .map((item) => {
      const label =
        item.role === "assistant" ? "Yova" : item.authorName || "User";
      return `${label}: ${item.content}`;
    })
    .join("\n");
}

function sanitizeCallName(rawName, maxLen = 24) {
  let name = String(rawName || "").replace(/\s+/g, " ").trim();
  if (!name) return "";
  name = name.replace(/@everyone/gi, "everyone").replace(/@here/gi, "here");
  name = name.replace(/<@!?\d+>/g, "").replace(/\s+/g, " ").trim();
  if (name.length > maxLen) {
    name = name.slice(0, maxLen).trim();
  }
  return name;
}

function getShortName(rawName) {
  const cleaned = String(rawName || "").replace(/\s+/g, " ").trim();
  if (!cleaned) return "";
  const parts = cleaned.split(/[\s._-]+/).filter(Boolean);
  const raw = parts[0] || cleaned;
  const ascii = raw.replace(/[^A-Za-z0-9]/g, "");
  const base = ascii || raw;
  if (base.length <= 6) return base;
  return base.slice(0, 6);
}

async function getAuthorCallName(message) {
  const userId = message.author?.id;
  if (userId) {
    const stored = await getUserCallName(userId);
    const normalized = sanitizeCallName(stored);
    if (normalized) return normalized;
  }
  const memberName = message.member?.displayName;
  const userName = message.author?.globalName || message.author?.username;
  return getShortName(memberName || userName);
}

function replaceGenericCall(text, callName) {
  if (typeof text !== "string" || !text) return text || "";
  if (!callName) return text;
  return text.replace(/\bbro\b/gi, callName);
}

const MEMORY_PATTERNS = [
  {
    kind: "dislike",
    regex: /\b(?:aku|saya)\s+(?:gak|ga|nggak|tidak)\s+suka\s+(.+)/i,
  },
  { kind: "like", regex: /\b(?:aku|saya)\s+suka\s+(.+)/i },
  {
    kind: "hobi",
    regex: /\bhobi(?:ku| saya| aku)?\s*(?:adalah|:)?\s+(.+)/i,
  },
  {
    kind: "favorit",
    regex: /\bfavorit(?:ku| saya| aku)?\s*(?:adalah|:)?\s+(.+)/i,
  },
  { kind: "prefer", regex: /\b(?:aku|saya)\s+prefer\s+(.+)/i },
];

function sanitizeMemoryValue(value) {
  let cleaned = String(value || "").replace(/\s+/g, " ").trim();
  if (!cleaned) return "";
  if (cleaned.includes("?")) return "";
  cleaned = cleaned.replace(/@everyone/gi, "everyone").replace(/@here/gi, "here");
  cleaned = cleaned.replace(/<@!?\d+>/g, "").trim();
  if (!cleaned) return "";
  if (cleaned.length > AI_MEMORY_MAX_VALUE_CHARS) {
    cleaned = cleaned.slice(0, AI_MEMORY_MAX_VALUE_CHARS).trim();
  }
  return cleaned;
}

function extractMemoryEntries(prompt) {
  if (!AI_MEMORY_ENABLED) return [];
  const text = String(prompt || "").trim();
  if (!text) return [];

  const entries = [];
  for (const { kind, regex } of MEMORY_PATTERNS) {
    const match = text.match(regex);
    if (!match) continue;
    const rawValue = match[1];
    const value = sanitizeMemoryValue(rawValue);
    if (value) {
      entries.push({ kind, value });
    }
  }
  return entries;
}

async function buildMemorySummary(userId) {
  if (!AI_MEMORY_ENABLED || !userId) return "";
  const rows = await listUserMemory(userId, {
    limit: AI_MEMORY_MAX_ITEMS,
    ttlDays: AI_MEMORY_TTL_DAYS,
  });
  if (!rows.length) return "";

  const labels = {
    like: "Suka",
    dislike: "Tidak suka",
    hobi: "Hobi",
    favorit: "Favorit",
    prefer: "Prefer",
  };

  const seen = new Set();
  const lines = [];
  for (const row of rows) {
    const label = labels[row.kind] || row.kind;
    const value = String(row.value || "").trim();
    if (!value) continue;
    const key = `${row.kind}:${value}`.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    lines.push(`- ${label}: ${value}`);
  }
  if (!lines.length) return "";
  return `Catatan memori user:\n${lines.join("\n")}`;
}

const SUMMARY_PATTERNS = [
  /\b(ringkas|rangkum|summary)\b/i,
  /\b(tadi|barusan).*\b(bahas|dibahas)\b/i,
  /\b(bahas apa|ngomongin apa|dibahas apa)\b/i,
];

function parseSummaryRequest(prompt) {
  const text = String(prompt || "").trim();
  if (!text) return null;
  const isSummary = SUMMARY_PATTERNS.some((pattern) => pattern.test(text));
  if (!isSummary) return null;

  const numberMatch = text.match(/\b(\d{1,3})\b/);
  const limit = numberMatch ? Number.parseInt(numberMatch[1], 10) : null;
  const safeLimit =
    Number.isInteger(limit) && limit > 0 ? Math.min(limit, 200) : null;

  return { limit: safeLimit };
}

const APOLOGY_PATTERNS = [
  /\b(maaf|minta maaf|sorry|sori|ampun)\b/i,
  /\b(udah|udahan|stop|sudah)\s*(debat|ribut|berantem|adu bacot|drama)\b/i,
  /\b(udah cukup|cukup ya|udah ya)\b/i,
  /\b(damai|baik-baik|baikan)\b/i,
];

const POLITE_PATTERNS = [
  /\b(tolong|mohon|please|plis|permisi)\b/i,
  /\b(terima kasih|makasih|makasi|thanks)\b/i,
  /\b(minta bantuan|bisa bantu)\b/i,
];

function getToneHint(prompt) {
  const text = String(prompt || "").trim();
  if (!text) {
    return {
      mode: "normal",
      hint:
        "Mode santai: boleh nyinyir/roast ringan dan sarkas tipis, tapi tetap sopan.",
    };
  }

  const isApology = APOLOGY_PATTERNS.some((pattern) => pattern.test(text));
  const isPolite = POLITE_PATTERNS.some((pattern) => pattern.test(text));

  if (isApology || isPolite) {
    return {
      mode: "friendly",
      hint:
        "Mode ramah: jawab sopan, bantu, dan hentikan debat. " +
        "Jangan nyinyir/roast/sarkas berlebihan.",
    };
  }

  return {
    mode: "normal",
    hint:
      "Mode santai: boleh nyinyir/roast ringan dan sarkas tipis, tapi tetap sopan.",
  };
}

function parseCallNameInstruction(prompt) {
  if (!prompt) return null;
  const trimmed = String(prompt).trim();
  if (!trimmed) return null;

  const setMatch = trimmed.match(
    /\b(?:panggil|sebut)\s+(?:aku|saya)\s+([^\n\r]+)/i
  );
  if (setMatch) {
    const rawName = setMatch[1].trim();
    if (/^(reset|hapus|lupa|clear)$/i.test(rawName)) {
      return { action: "clear" };
    }
    const name = sanitizeCallName(rawName);
    if (name) {
      return { action: "set", value: name };
    }
  }

  const clearMatch = trimmed.match(
    /\b(?:hapus|lupa|reset)\s+(?:panggilan|nama|sebutan)\b/i
  );
  if (clearMatch) return { action: "clear" };

  const stopMatch = trimmed.match(/\bjangan\s+panggil\s+(?:aku|saya)\b/i);
  if (stopMatch) return { action: "clear" };

  return null;
}

const UNCERTAIN_PATTERNS = [
  /\b(ga|gak|nggak|tidak)\s*tau\b/i,
  /\b(gatau|gatahu|nggatau)\b/i,
  /\b(kurang|belum)\s*tahu\b/i,
  /\b(ga|gak|nggak)\s*(paham|ngerti)\b/i,
  /\bbelum\s*(dapet|dapat)\s*info\b/i,
  /\b(ga|gak|nggak|tidak)\s*(punya|ada)\s*info\b/i,
];

const FOLLOW_UP_QUESTIONS = [
  (name) => `Mau ke hotel buat apa${name ? `, ${name}` : ""}?`,
  (name) => `Area mana yang kamu tuju${name ? `, ${name}` : ""}?`,
  (name) => `Nginep berapa malam${name ? `, ${name}` : ""}?`,
  (name) => `Budget kisaran berapa${name ? `, ${name}` : ""}?`,
  (name) => `Butuh hotel dekat apa${name ? `, ${name}` : ""}?`,
  (name) => `Mau yang murah atau yang nyaman${name ? `, ${name}` : ""}?`,
  (name) => `Staycation doang atau ada urusan${name ? `, ${name}` : ""}?`,
];

function pickFollowUp(callName) {
  if (!FOLLOW_UP_QUESTIONS.length) return "";
  const index = Math.floor(Math.random() * FOLLOW_UP_QUESTIONS.length);
  const item = FOLLOW_UP_QUESTIONS[index];
  return typeof item === "function" ? item(callName) : item;
}

function appendFollowUpIfUnknown(text, callName) {
  if (!text) return text;
  const hasUnknown = UNCERTAIN_PATTERNS.some((pattern) => pattern.test(text));
  if (!hasUnknown || text.includes("?")) return text;
  const followUp = pickFollowUp(callName);
  if (!followUp) return text;
  const trimmed = text.trim();
  const separator = /[.!?]$/.test(trimmed) ? " " : ". ";
  return `${trimmed}${separator}${followUp}`;
}

function isMessyOutput(text) {
  const cleaned = String(text || "").replace(/\s+/g, " ").trim();
  if (cleaned.length < 4) return true;
  const normalized = cleaned.toLowerCase();
  if (["safe", "unsafe", "blocked", "error", "refused"].includes(normalized)) {
    return true;
  }
  const words = cleaned.split(" ").filter(Boolean);
  if (words.length < 2) return true;
  return false;
}

function extractJson(text) {
  if (!text) return null;
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;
  const slice = text.slice(start, end + 1);
  try {
    return JSON.parse(slice);
  } catch (error) {
    return null;
  }
}

function describeMember(member) {
  if (!member) return "";
  const roles = member.roles?.cache
    ? Array.from(member.roles.cache.values())
      .filter((role) => role.name !== "@everyone")
      .sort((a, b) => b.position - a.position)
      .slice(0, 3)
      .map((role) => role.name)
    : [];
  const name = member.displayName || member.user?.globalName || member.user?.username || "User";
  const roleText = roles.length ? roles.join(", ") : "-";
  return `${name} (${roleText})`;
}

function formatRepeatMode(mode) {
  switch (mode) {
    case "track":
      return "track";
    case "all":
      return "all";
    default:
      return "off";
  }
}

function formatTrackSummary(track, index, total) {
  if (!track) return "-";
  const title = track?.title || track?.url || "-";
  const requester =
    track?.requestedByTag || track?.requestedBy || track?.requestedById || "-";
  const pos =
    Number.isInteger(index) && total > 0 ? `${index + 1}/${total}` : "-";
  return `${title} (pos ${pos}, req ${requester})`;
}

function buildQueuePreview(queue, startIndex, limit = 3) {
  if (!Array.isArray(queue) || queue.length === 0) return "-";
  const start = Math.max(0, startIndex);
  const list = [];
  for (let i = start; i < queue.length && list.length < limit; i += 1) {
    const track = queue[i];
    const title = track?.title || track?.url || "-";
    list.push(`#${i + 1} ${title}`);
  }
  return list.length ? list.join(" | ") : "-";
}

async function buildMusicContext(message) {
  if (!message.guild) return "Music: (tidak tersedia)";

  const guild = message.guild;
  const guildId = guild.id;
  const live = getState(guildId);
  if (live && Array.isArray(live.queue) && live.queue.length > 0) {
    const queue = live.queue;
    const currentIndex = Number.isInteger(live.currentIndex)
      ? live.currentIndex
      : -1;
    const currentTrack =
      currentIndex >= 0 && currentIndex < queue.length
        ? queue[currentIndex]
        : null;
    const nextIndex = currentIndex >= 0 ? currentIndex + 1 : 0;
    const voiceChannel = live.channelId
      ? guild.channels.cache.get(live.channelId)
      : null;
    const voiceLabel = voiceChannel?.name
      ? `#${voiceChannel.name}`
      : live.channelId || "-";
    const status = live.player?.state?.status || "unknown";

    return [
      "Music: active",
      `Voice: ${voiceLabel}`,
      `Status: ${status}`,
      `Now playing: ${formatTrackSummary(currentTrack, currentIndex, queue.length)}`,
      `Queue length: ${queue.length}`,
      `Next up: ${buildQueuePreview(queue, nextIndex, 3)}`,
      `Repeat: ${formatRepeatMode(live.repeatMode)}`,
    ].join("\n");
  }

  const stored = await loadQueueState(guildId);
  if (stored && Array.isArray(stored.queue) && stored.queue.length > 0) {
    const currentIndex = Number.isInteger(stored.currentIndex)
      ? stored.currentIndex
      : -1;
    const currentTrack =
      currentIndex >= 0 && currentIndex < stored.queue.length
        ? stored.queue[currentIndex]
        : null;
    const nextIndex = currentIndex >= 0 ? currentIndex + 1 : 0;
    return [
      "Music: queued (persisted)",
      `Now playing: ${formatTrackSummary(
        currentTrack,
        currentIndex,
        stored.queue.length
      )}`,
      `Queue length: ${stored.queue.length}`,
      `Next up: ${buildQueuePreview(stored.queue, nextIndex, 3)}`,
      `Repeat: ${formatRepeatMode(stored.repeatMode)}`,
    ].join("\n");
  }

  return "Music: idle";
}

async function ensureMemberCache(guild) {
  if (!guild?.members?.fetch) return;
  const cacheSize = guild.members?.cache?.size || 0;
  const memberCount = guild.memberCount || 0;
  if (MEMBER_FETCH_MODE === "off") return;

  const now = Date.now();
  const lastFetch = lastMemberFetchAt.get(guild.id) || 0;
  if (now - lastFetch < MEMBER_FETCH_COOLDOWN_MS) return;

  lastMemberFetchAt.set(guild.id, now);
  try {
    if (MEMBER_FETCH_MODE === "full") {
      if (memberCount > 0 && cacheSize >= memberCount) return;
      await guild.members.fetch();
      return;
    }
    if (cacheSize >= MEMBER_SAMPLE_LIMIT) return;
    await guild.members.fetch({ limit: MEMBER_SAMPLE_LIMIT });
  } catch (error) {
    logger.warn("Failed fetching guild members for AI context.", error);
  }
}

async function buildServerContext(message) {
  if (!message.guild) return { server: "Server: (tidak tersedia)" };

  const guild = message.guild;
  const channelName = message.channel?.name || "-";
  const memberCount = guild.memberCount || "-";
  const roles = Array.from(guild.roles.cache.values())
    .filter((role) => role.name !== "@everyone")
    .sort((a, b) => b.position - a.position)
    .slice(0, 5)
    .map((role) => role.name);

  const authorInfo = message.member ? describeMember(message.member) : "-";
  const mentionedMembers = message.mentions?.members
    ? Array.from(message.mentions.members.values()).slice(0, 3)
    : [];
  const mentionedInfo = mentionedMembers.length
    ? mentionedMembers.map((member) => describeMember(member)).join(" | ")
    : "-";

  const musicContext = await buildMusicContext(message);

  return {
    server: [
      `Server: ${guild.name}`,
      `Member count: ${memberCount}`,
      `Channel: #${channelName}`,
      `Roles: ${roles.length ? roles.join(", ") : "-"}`,
    ].join("\n"),
    author: `Author: ${authorInfo}`,
    mentioned: `Mentioned: ${mentionedInfo}`,
    music: musicContext,
  };
}

async function getChatHistory(
  channel,
  authorId,
  botId,
  excludeMessageId,
  options = {}
) {
  if (!channel?.messages?.fetch) return [];
  if (!authorId || !botId) return [];
  if (AI_CONTEXT_LIMIT <= 0) return [];

  let fetched;
  try {
    const limit = Math.max(10, Math.min(AI_HISTORY_FETCH_LIMIT, 100));
    fetched = await channel.messages.fetch({ limit });
  } catch (error) {
    logger.warn("Failed fetching chat history for AI.", error);
    return [];
  }

  const includeOthers = options.includeOthers === true;
  const includeAuthorNames = options.includeAuthorNames === true;
  const allowedAuthorIds = Array.isArray(options.allowedAuthorIds)
    ? new Set(options.allowedAuthorIds.filter(Boolean))
    : null;
  const prefixLower = prefix.toLowerCase();
  const messages = Array.from(fetched.values())
    .filter((msg) => msg.id !== excludeMessageId)
    .filter((msg) => {
      const content = msg.content?.trim();
      if (!content) return false;
      if (content.toLowerCase().startsWith(prefixLower)) return false;
      const isAuthor = msg.author?.id === authorId;
      const isBot = msg.author?.id === botId;
      if (isAuthor || isBot) return true;
      if (!includeOthers) return false;
      if (msg.author?.bot) return false;
      if (allowedAuthorIds) {
        return allowedAuthorIds.has(msg.author?.id);
      }
      return true;
    })
    .sort((a, b) => a.createdTimestamp - b.createdTimestamp)
    .slice(-AI_CONTEXT_LIMIT);

  const maxChars = getHistoryMessageLimit();
  return messages.map((msg) => {
    const entry = {
      role: msg.author?.id === botId ? "assistant" : "user",
      content: msg.content.trim().slice(0, maxChars),
      timestamp: msg.createdTimestamp
    };
    if (includeAuthorNames) {
      entry.authorName =
        msg.member?.displayName ||
        msg.author?.globalName ||
        msg.author?.username ||
        "User";
    }
    return entry;
  });
}

async function generateAiReply(message, prompt, options = {}) {
  const authorId = message.author?.id;
  const botId = message.client?.user?.id;
  if (!authorId || !botId) return "";

  const callName = await getAuthorCallName(message);
  const tone = getToneHint(prompt);
  const memorySummary = await buildMemorySummary(authorId);
  const systemPrompt =
    "Kamu adalah Yova, bot Discord yang menjawab dengan Bahasa Indonesia gaul internet. " +
    "Persona: chibi/tsundere/kamidere vibe yang imut tapi sombong dan lucu; kadang pamer diri (contoh: \"Yova paling kece di sini\"). " +
    "Jangan menyebut diri anak/bocil/loli, tetap dewasa. " +
    "Tulis jawaban dengan slang, singkatan, dan sedikit sarkas. " +
    "Gunakan kata-kata seperti: wkwk, gas, no debat, receh, copium, skill issue, triggered. " +
    "Gaya santai, kayak netizen ribut di Twitter/Discord. " +
    "Boleh mengumpat ringan sesekali, tapi jangan menyerang personal, fisik, keluarga, atau SARA. " +
    "Jangan simpan dendam; fokus ke pesan terakhir. " +
    "Kalau user minta maaf/udahan debat, jadi baik dan akhiri debat. " +
    `${tone.hint} ` +
    "Jika ditanya musik yang sedang diputar atau status voice, gunakan konteks musik yang tersedia. " +
    "Kalau tidak tahu, boleh kasih tebakan ringan atau bilang belum tahu, lalu tambahkan pertanyaan balik yang nyambung. " +
    (callName
      ? `Jika menyebut penanya, gunakan panggilan "${callName}" (bukan "bro"). `
      : "Jika menyebut penanya, jangan gunakan panggilan umum seperti \"bro\". ") +
    "Jawab 2-5 kalimat, kecuali diminta singkat. " +
    "Jangan gunakan @everyone atau @here.";
  const memoryContext = memorySummary ? `\n\n${memorySummary}` : "";

  const history = await getChatHistory(
    message.channel,
    authorId,
    botId,
    message.id,
    {
      includeOthers: options.includeOthers,
      allowedAuthorIds: options.allowedAuthorIds,
    }
  );
  const replyContext = normalizeReplyContext(options.replyContext);
  const historyHasReply =
    replyContext &&
    history.some(
      (item) => item.role === "assistant" && item.content === replyContext
    );
  const messages = historyHasReply || !replyContext
    ? [...history, { role: "user", content: prompt }]
    : [
      ...history,
      { role: "assistant", content: replyContext },
      { role: "user", content: prompt },
    ];
  const serverContext = options.serverContext;

  let content;
  try {
    content = await chatCompletion({
      system: serverContext
        ? `${systemPrompt}${memoryContext}\n\nInformasi server:\n${serverContext}`
        : `${systemPrompt}${memoryContext}`,
      messages,
      temperature: AI_TEMPERATURE,
      maxTokens: AI_MAX_TOKENS,
    });

    if (isMessyOutput(content)) {
      content = await chatCompletion({
        system: `${systemPrompt} Jawab hanya 1 kalimat.`,
        user: prompt,
        temperature: 0.1,
        maxTokens: 120,
      });
    }
  } catch (error) {
    logger.error("AI chat failed.", error);
    throw error;
  }

  let output = sanitizeMessage(replaceGenericCall(content, callName));
  output = appendFollowUpIfUnknown(output, callName);
  if (output.length > AI_MAX_MESSAGE_LENGTH) {
    output = output.slice(0, AI_MAX_MESSAGE_LENGTH - 3).trimEnd() + "...";
  }

  return output;
}

async function handleAiRequest(message, prompt, options = {}) {
  const userId = message.author?.id;
  const botId = message.client?.user?.id;
  const preference = parseCallNameInstruction(prompt);
  const replyContext = normalizeReplyContext(options.replyContext);
  if (userId && preference?.action === "set" && preference.value) {
    await setUserCallName(userId, preference.value);
    return {
      type: "reply",
      message: `Oke, gue panggil kamu ${preference.value} mulai sekarang.`,
    };
  }

  if (userId && preference?.action === "clear") {
    await clearUserCallName(userId);
    return {
      type: "reply",
      message: "Sip, panggilan kamu gue reset.",
    };
  }

  if (AI_MEMORY_ENABLED && userId) {
    const entries = extractMemoryEntries(prompt);
    if (entries.length) {
      for (const entry of entries) {
        await addUserMemory({ userId, kind: entry.kind, value: entry.value });
      }
    }
  }

  const summaryRequest = parseSummaryRequest(prompt);
  if (summaryRequest) {
    return {
      type: "command",
      name: "ringkas",
      args: summaryRequest.limit ? [String(summaryRequest.limit)] : [],
    };
  }

  if (isBotQuestion(prompt)) {
    return {
      type: "reply",
      message: answerBotQuestion(prompt),
    };
  }

  const callName = await getAuthorCallName(message);
  const memorySummary = await buildMemorySummary(userId);
  const tone = getToneHint(prompt);
  if (message.guild) {
    await ensureMemberCache(message.guild);
  }
  const serverContext = await buildServerContext(message);
  const { includeOthers, allowedAuthorIds } = getChannelContextScope(
    message,
    prompt
  );
  const history = await getChatHistory(
    message.channel,
    userId,
    botId,
    message.id,
    {
      includeOthers,
      allowedAuthorIds,
      includeAuthorNames: true,
    }
  );
  const historyText = formatHistoryForRouter(history);
  const allowedCommands = getAiCommandList(message);
  const commandHints = [];
  if (allowedCommands.includes("play")) {
    commandHints.push(
      "Jika pengguna meminta memutar musik, gunakan command play dan isi args dengan judul/URL."
    );
  }
  if (allowedCommands.includes("join")) {
    commandHints.push(
      "Jika pengguna meminta bot masuk/join voice, gunakan command join dan isi args dengan nama channel atau mention user."
    );
  }
  if (allowedCommands.includes("jelaskan")) {
    commandHints.push("Jika pengguna meminta penjelasan bot, gunakan command jelaskan.");
  }
  if (allowedCommands.includes("member")) {
    commandHints.push(
      "Jika pengguna minta cek member/anggota server (awal/baru/daftar/jumlah), gunakan command member."
    );
  }
  if (allowedCommands.includes("ringkas") || allowedCommands.includes("rangkum")) {
    commandHints.push(
      `Jika pengguna minta ringkas/rangkum channel, gunakan command ${allowedCommands.includes("ringkas") ? "ringkas" : "rangkum"
      }.`
    );
  }
  if (allowedCommands.includes("memberinfo")) {
    commandHints.push(
      "Jika pengguna minta info detail tentang member tertentu, gunakan command memberinfo."
    );
  }
  if (allowedCommands.includes("addrole") || allowedCommands.includes("removerole")) {
    commandHints.push(
      "Jika pengguna minta tambah/hapus role, gunakan command addrole/removerole."
    );
  }
  if (allowedCommands.includes("timeout") || allowedCommands.includes("ban")) {
    commandHints.push(
      "Jika pengguna minta moderasi (timeout/ban), gunakan command timeout/ban."
    );
  }
  if (allowedCommands.includes("ping")) {
    commandHints.push("Jika pengguna minta uji bot, gunakan command ping.");
  }
  const routerSystem =
    "Kamu adalah router AI untuk bot Discord. " +
    "Selalu jawab dengan JSON valid saja tanpa teks lain. " +
    "Skema: {\"type\":\"command\",\"name\":\"<command>\",\"args\":[\"...\"]} " +
    "atau {\"type\":\"reply\",\"message\":\"...\"} " +
    "atau {\"type\":\"search\",\"query\":\"...\"}. " +
    "Command yang diizinkan: " +
    allowedCommands.join(", ") +
    ". " +
    (commandHints.length ? `${commandHints.join(" ")} ` : "") +
    "Jika pengguna bertanya/bercakap-cakap, gunakan type reply dan tulis jawaban. " +
    "Jika pengguna meminta info server atau musik yang sedang diputar, jawab dengan type reply berdasarkan info yang tersedia. " +
    "Jika pengguna bertanya hal eksternal/real-time (berita, harga crypto/saham, cuaca, fakta umum), GUNAKAN type search. " +
    "Jangan menolak menjawab jika bisa dicari di web. " +
    "Persona: chibi/tsundere/kamidere vibe yang imut tapi sombong dan lucu; kadang pamer diri. " +
    "Jangan menyebut diri anak/bocil/loli, tetap dewasa. " +
    "Gaya reply: gaul internet, nyinyir tipis, sedikit sarkas, gampang diajak bercanda, " +
    "boleh nge-roast ringan dan mengumpat ringan, tapi jangan menghina personal/fisik/keluarga/SARA. " +
    "Gunakan kata-kata seperti: wkwk, gas, no debat, receh, copium, skill issue, triggered. " +
    "Jangan simpan dendam; fokus ke pesan terakhir. " +
    "Kalau user minta maaf/udahan debat, jadi baik dan akhiri debat. " +
    `${tone.hint} ` +
    "Kalau reply menyatakan tidak tahu, tambahkan pertanyaan balik yang nyambung. " +
    (callName
      ? `Jika menyebut penanya, gunakan panggilan "${callName}" (bukan "bro"). `
      : "Jika menyebut penanya, jangan gunakan panggilan umum seperti \"bro\". ") +
    "Jangan gunakan @everyone atau @here.";

  const routerUser =
    `Pesan pengguna: "${prompt}"\n` +
    (callName ? `Nama panggilan penanya: "${callName}".\n` : "") +
    (replyContext ? `Konteks pesan bot yang direply:\n${replyContext}\n` : "") +
    (historyText ? `Riwayat chat terbaru:\n${historyText}\n` : "") +
    (memorySummary ? `\n${memorySummary}\n` : "\n") +
    `Informasi server:\n${serverContext}`;

  let raw;
  try {
    raw = await chatCompletion({
      system: routerSystem,
      user: routerUser,
      temperature: 0.2,
      maxTokens: 260,
    });
  } catch (error) {
    logger.error("AI router failed.", error);
    return { type: "reply", message: "" };
  }

  const parsed = extractJson(raw);
  if (parsed?.type === "command" && typeof parsed.name === "string") {
    const name = parsed.name.toLowerCase();
    if (!allowedCommands.includes(name)) {
      return { type: "reply", message: "" };
    }

    let args = [];
    if (Array.isArray(parsed.args)) {
      args = parsed.args.map((arg) => String(arg)).filter(Boolean);
    } else if (typeof parsed.args === "string") {
      args = [parsed.args];
    }

    return { type: "command", name, args, serverContext };
  }

  if (parsed?.type === "search" && typeof parsed.query === "string") {
    let searchResults = [];
    try {
      searchResults = await searchWeb(parsed.query);
    } catch (e) {
      logger.error("Search failed inside router", e);
    }

    const searchContext = searchResults.length > 0
      ? searchResults.map(r => `[${r.title}](${r.url}): ${r.snippet}`).join("\n\n")
      : "Tidak ada hasil pencarian ditemukan.";

    const enrichedContext = serverContext + "\n\n=== HASIL PENCARIAN WEB ===\n" + searchContext + "\n===========================";

    // Generate reply using the search results
    const answer = await generateAiReply(message, prompt, {
      serverContext: enrichedContext,
      replyContext,
      includeOthers,
      allowedAuthorIds,
    });

    return { type: "reply", message: answer, serverContext: enrichedContext };
  }

  if (parsed?.type === "reply" && typeof parsed.message === "string") {
    let messageText = sanitizeMessage(
      replaceGenericCall(parsed.message, callName)
    );
    messageText = appendFollowUpIfUnknown(messageText, callName);
    return { type: "reply", message: messageText, serverContext };
  }

  const fallback = await generateAiReply(message, prompt, {
    serverContext,
    replyContext,
    includeOthers,
    allowedAuthorIds,
  });
  return { type: "reply", message: fallback, serverContext };
}

module.exports = {
  generateAiReply,
  handleAiRequest,
  buildServerContext,
  buildMemorySummary,
  getAuthorCallName,
  getChatHistory,
  parseCallNameInstruction,
  sanitizeMessage,
  replaceGenericCall
};
