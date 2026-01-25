const logger = require("./logger");
const { chatCompletion } = require("./groq");
const {
  getUserCallName,
  setUserCallName,
  clearUserCallName,
} = require("../storage/db");
let config = {};

try {
  config = require("../config.json");
} catch (error) {
  config = {};
}

const prefix = String(config.prefix || "!");
const AI_CONTEXT_LIMIT = Number.isInteger(config.groq_chat_context_messages)
  ? config.groq_chat_context_messages
  : Number.isInteger(config.groq_context_messages)
    ? config.groq_context_messages
    : 6;
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
const MEMBER_FETCH_COOLDOWN_MS = 60 * 1000;
const lastMemberFetchAt = new Map();
const AI_COMMANDS = [
  "play",
  "pause",
  "skip",
  "next",
  "sebelumnya",
  "stop",
  "leave",
  "kontrol",
  "kesukaanku",
  "restore",
  "ucapkan",
  "panggil",
  "join",
];

function sanitizeMessage(text) {
  if (!text) return "";
  return String(text)
    .replace(/@everyone/gi, "@\u200beveryone")
    .replace(/@here/gi, "@\u200bhere")
    .trim();
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

function getAuthorCallName(message) {
  const userId = message.author?.id;
  if (userId) {
    const stored = getUserCallName(userId);
    const normalized = sanitizeCallName(stored);
    if (normalized) return normalized;
  }
  const memberName = message.member?.displayName;
  const userName = message.author?.globalName || message.author?.username;
  return getShortName(memberName || userName);
}

function replaceGenericCall(text, callName) {
  if (!callName) return text;
  return text.replace(/\bbro\b/gi, callName);
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
        .slice(0, 5)
        .map((role) => role.name)
    : [];
  const name = member.displayName || member.user?.tag || "Unknown";
  const roleText = roles.length ? `roles: ${roles.join(", ")}` : "roles: -";
  return `${name} (${member.user?.id || "unknown"}, ${roleText})`;
}

async function ensureMemberCache(guild) {
  if (!guild?.members?.fetch) return;
  const cacheSize = guild.members?.cache?.size || 0;
  if (cacheSize >= MEMBER_SAMPLE_LIMIT) return;

  const now = Date.now();
  const lastFetch = lastMemberFetchAt.get(guild.id) || 0;
  if (now - lastFetch < MEMBER_FETCH_COOLDOWN_MS) return;

  lastMemberFetchAt.set(guild.id, now);
  try {
    await guild.members.fetch({ limit: MEMBER_SAMPLE_LIMIT });
  } catch (error) {
    logger.warn("Failed fetching guild members for AI context.", error);
  }
}

function buildServerContext(message) {
  if (!message.guild) return "Server: (tidak tersedia)";

  const guild = message.guild;
  const ownerId = guild.ownerId || "-";
  const ownerTag = guild.members?.cache?.get(ownerId)?.user?.tag || ownerId;
  const channelName = message.channel?.name || "-";
  const memberCount = guild.memberCount || "-";
  const roles = Array.from(guild.roles.cache.values())
    .filter((role) => role.name !== "@everyone")
    .sort((a, b) => b.position - a.position)
    .slice(0, 10)
    .map((role) => role.name);

  const authorInfo = message.member ? describeMember(message.member) : "-";
  const mentionedMembers = message.mentions?.members
    ? Array.from(message.mentions.members.values()).slice(0, 5)
    : [];
  const mentionedInfo = mentionedMembers.length
    ? mentionedMembers.map((member) => describeMember(member)).join(" | ")
    : "-";

  const knownMembers = guild.members?.cache
    ? Array.from(guild.members.cache.values())
        .filter((member) => !member.user?.bot)
        .slice(0, MEMBER_SAMPLE_LIMIT)
        .map((member) => describeMember(member))
    : [];

  return [
    `Server: ${guild.name} (id: ${guild.id})`,
    `Owner: ${ownerTag}`,
    `Member count: ${memberCount}`,
    `Channel: #${channelName}`,
    `Roles (top): ${roles.length ? roles.join(", ") : "-"}`,
    `Author: ${authorInfo}`,
    `Mentioned: ${mentionedInfo}`,
    `Members sample (cache): ${knownMembers.length ? knownMembers.join(" | ") : "-"}`,
    "Catatan: data anggota bisa tidak lengkap (hanya cache).",
  ].join("\n");
}

async function getChatHistory(channel, authorId, botId, excludeMessageId) {
  if (!channel?.messages?.fetch) return [];
  if (!authorId || !botId) return [];
  if (AI_CONTEXT_LIMIT <= 0) return [];

  let fetched;
  try {
    fetched = await channel.messages.fetch({ limit: 50 });
  } catch (error) {
    logger.warn("Failed fetching chat history for AI.", error);
    return [];
  }

  const prefixLower = prefix.toLowerCase();
  const messages = Array.from(fetched.values())
    .filter((msg) => msg.id !== excludeMessageId)
    .filter(
      (msg) => msg.author?.id === authorId || msg.author?.id === botId
    )
    .filter((msg) => {
      const content = msg.content?.trim();
      if (!content) return false;
      if (content.toLowerCase().startsWith(prefixLower)) return false;
      return true;
    })
    .sort((a, b) => a.createdTimestamp - b.createdTimestamp)
    .slice(-AI_CONTEXT_LIMIT);

  return messages.map((msg) => ({
    role: msg.author?.id === botId ? "assistant" : "user",
    content: msg.content.trim().slice(0, 500),
  }));
}

async function generateAiReply(message, prompt, options = {}) {
  const authorId = message.author?.id;
  const botId = message.client?.user?.id;
  if (!authorId || !botId) return "";

  const callName = getAuthorCallName(message);
  const systemPrompt =
    "Kamu adalah Yova, bot Discord yang menjawab dengan Bahasa Indonesia gaul. " +
    "Gaya bicara banyak bacot ala Gen Z: cerewet, receh, gampang diajak bercanda, " +
    "rada sewot, dan boleh sesekali mengumpat ringan. " +
    "Tetap jangan menyerang SARA atau menghina personal. " +
    "Kalau tidak tahu, boleh kasih tebakan ringan atau bilang belum tahu, lalu tambahkan pertanyaan balik yang nyambung. " +
    (callName
      ? `Jika menyebut penanya, gunakan panggilan "${callName}" (bukan "bro"). `
      : "Jika menyebut penanya, jangan gunakan panggilan umum seperti \"bro\". ") +
    "Jawab 2-4 kalimat, kecuali diminta singkat. " +
    "Jangan gunakan @everyone atau @here.";

  const history = await getChatHistory(
    message.channel,
    authorId,
    botId,
    message.id
  );
  const serverContext = options.serverContext;

  let content;
  try {
    content = await chatCompletion({
      system: serverContext
        ? `${systemPrompt}\n\nInformasi server:\n${serverContext}`
        : systemPrompt,
      messages: [...history, { role: "user", content: prompt }],
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

async function handleAiRequest(message, prompt) {
  const userId = message.author?.id;
  const preference = parseCallNameInstruction(prompt);
  if (userId && preference?.action === "set" && preference.value) {
    setUserCallName(userId, preference.value);
    return {
      type: "reply",
      message: `Oke, gue panggil kamu ${preference.value} mulai sekarang.`,
    };
  }

  if (userId && preference?.action === "clear") {
    clearUserCallName(userId);
    return {
      type: "reply",
      message: "Sip, panggilan kamu gue reset.",
    };
  }

  const callName = getAuthorCallName(message);
  if (message.guild) {
    await ensureMemberCache(message.guild);
  }
  const serverContext = buildServerContext(message);
  const routerSystem =
    "Kamu adalah router AI untuk bot Discord. " +
    "Selalu jawab dengan JSON valid saja tanpa teks lain. " +
    "Skema: {\"type\":\"command\",\"name\":\"<command>\",\"args\":[\"...\"]} " +
    "atau {\"type\":\"reply\",\"message\":\"...\"}. " +
    "Command yang diizinkan: " +
    AI_COMMANDS.join(", ") +
    ". " +
    "Jika pengguna meminta memutar musik, gunakan command play dan isi args dengan judul/URL. " +
    "Jika pengguna meminta bot masuk/join voice, gunakan command join dan isi args dengan nama channel atau mention user. " +
    "Jika pengguna bertanya/bercakap-cakap, gunakan type reply dan tulis jawaban. " +
    "Jika pengguna meminta info server, jawab dengan type reply berdasarkan info server yang tersedia. " +
    "Jika data tidak tersedia, katakan tidak punya akses. " +
    "Gaya reply: banyak bacot ala Gen Z, gaul, rada sewot, gampang diajak bercanda, " +
    "boleh sesekali mengumpat ringan, tapi jangan menghina personal/SARA. " +
    "Kalau reply menyatakan tidak tahu, tambahkan pertanyaan balik yang nyambung. " +
    (callName
      ? `Jika menyebut penanya, gunakan panggilan "${callName}" (bukan "bro"). `
      : "Jika menyebut penanya, jangan gunakan panggilan umum seperti \"bro\". ") +
    "Jangan gunakan @everyone atau @here.";

  const routerUser =
    `Pesan pengguna: "${prompt}"\n` +
    (callName ? `Nama panggilan penanya: "${callName}".\n` : "") +
    `\nInformasi server:\n${serverContext}`;

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
    if (!AI_COMMANDS.includes(name)) {
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

  if (parsed?.type === "reply" && typeof parsed.message === "string") {
    let messageText = sanitizeMessage(
      replaceGenericCall(parsed.message, callName)
    );
    messageText = appendFollowUpIfUnknown(messageText, callName);
    return { type: "reply", message: messageText, serverContext };
  }

  const fallback = await generateAiReply(message, prompt, { serverContext });
  return { type: "reply", message: fallback, serverContext };
}

module.exports = {
  generateAiReply,
  handleAiRequest,
};
