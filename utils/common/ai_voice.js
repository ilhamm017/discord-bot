const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { AttachmentBuilder } = require("discord.js");
const logger = require("../logger");
const { getGuildState } = require("../../discord/player/voice");
const {
    getElevenLabsUsage,
    addElevenLabsUsage,
    subtractElevenLabsUsage,
} = require("../../storage/db");
const {
    ensureAudioCacheDir,
    buildCachedTrackUrl,
    findCachedFilePath,
} = require("./media_cache");

const ELEVENLABS_API_BASE = "https://api.elevenlabs.io/v1";
const DEFAULT_OUTPUT_FORMAT = "mp3_44100_128";
const DEFAULT_VOICE_CHANCE = 0.05;
const DEFAULT_PAUSE_DELAY_MS = 2500;
const DEFAULT_MAX_CHARS = 280;
const DEFAULT_MONTHLY_LIMIT = 9500;
const DEFAULT_MONTHLY_RESERVE = 1500;

const activeSpeechLocks = new Set();

function readRuntimeConfig() {
    try {
        const configPath = path.join(process.cwd(), "config.json");
        return JSON.parse(fs.readFileSync(configPath, "utf8"));
    } catch (error) {
        return {};
    }
}

function isTruthy(value, fallback = false) {
    if (typeof value === "boolean") return value;
    return fallback;
}

function getVoiceSettings() {
    const config = readRuntimeConfig();
    return {
        enabled: isTruthy(config.ai_voice_reply_enabled, false),
        chatEnabled: isTruthy(config.ai_voice_reply_chat_enabled, true),
        voiceEnabled: isTruthy(config.ai_voice_reply_voice_enabled, true),
        chance: Number.isFinite(Number(config.ai_voice_reply_chance))
            ? Math.max(0, Math.min(1, Number(config.ai_voice_reply_chance)))
            : DEFAULT_VOICE_CHANCE,
        pauseDelayMs: Number.isInteger(config.ai_voice_reply_pause_delay_ms)
            ? Math.max(0, config.ai_voice_reply_pause_delay_ms)
            : DEFAULT_PAUSE_DELAY_MS,
        maxChars: Number.isInteger(config.ai_voice_reply_max_chars)
            ? Math.max(40, config.ai_voice_reply_max_chars)
            : DEFAULT_MAX_CHARS,
        apiKey: String(config.elevenlabs_api_key || "").trim(),
        voiceId: String(config.elevenlabs_voice_id || "").trim(),
        modelId: String(config.elevenlabs_model_id || "").trim(),
        outputFormat: String(config.elevenlabs_output_format || DEFAULT_OUTPUT_FORMAT).trim() || DEFAULT_OUTPUT_FORMAT,
        monthlyLimit: Number.isInteger(config.elevenlabs_monthly_char_limit)
            ? Math.max(0, config.elevenlabs_monthly_char_limit)
            : DEFAULT_MONTHLY_LIMIT,
        monthlyReserve: Number.isInteger(config.elevenlabs_monthly_char_reserve)
            ? Math.max(0, config.elevenlabs_monthly_char_reserve)
            : DEFAULT_MONTHLY_RESERVE,
    };
}

function isVoiceReplyConfigured() {
    const settings = getVoiceSettings();
    return Boolean(settings.enabled && settings.apiKey && settings.voiceId);
}

function normalizeSpeechText(text, maxChars) {
    const normalized = String(text || "")
        .replace(/<a?:\w+:\d+>/g, "")
        .replace(/<#(\d+)>/g, "channel")
        .replace(/<@!?(\d+)>/g, "teman")
        .replace(/\*\*/g, "")
        .replace(/`/g, "")
        .replace(/\s+/g, " ")
        .trim();
    if (!normalized) return "";
    return normalized.slice(0, Math.max(1, maxChars || DEFAULT_MAX_CHARS));
}

function isCasualNoToolReply(response) {
    if (!response || response.type !== "final") return false;
    const meta = response.meta || {};
    if (meta.usedTools) return false;
    if (meta.needsTool) return false;
    const intent = String(meta.intent || "general").toLowerCase();
    return ["general", "history", "social"].includes(intent);
}

function shouldAttemptVoiceReply(response) {
    if (!isVoiceReplyConfigured()) return false;
    if (!isCasualNoToolReply(response)) return false;
    return true;
}

function getSpeechCacheKey(text, settings) {
    const digest = crypto
        .createHash("sha1")
        .update(`${settings.voiceId}|${settings.modelId}|${settings.outputFormat}|${text}`)
        .digest("hex")
        .slice(0, 16);
    return `tts_${digest}`;
}

function getExtensionFromOutputFormat(outputFormat) {
    const normalized = String(outputFormat || "").toLowerCase();
    if (normalized.startsWith("mp3_")) return ".mp3";
    if (normalized.startsWith("pcm_")) return ".wav";
    if (normalized.startsWith("opus_")) return ".opus";
    return ".mp3";
}

function getUsageMonthKey(date = new Date()) {
    return [
        date.getUTCFullYear(),
        String(date.getUTCMonth() + 1).padStart(2, "0"),
    ].join("-");
}

function calculateVoiceBudgetDecision(settings, usage, charCount) {
    const monthlyLimit = Math.max(0, Number(settings?.monthlyLimit) || 0);
    const monthlyReserve = Math.max(0, Number(settings?.monthlyReserve) || 0);
    const usedChars = Math.max(0, Number(usage?.characterCount) || 0);
    const nextChars = Math.max(0, Number(charCount) || 0);
    const remaining = Math.max(0, monthlyLimit - usedChars);
    const safeRemaining = Math.max(0, remaining - monthlyReserve);

    if (monthlyLimit <= 0) {
        return {
            allowed: false,
            effectiveChance: 0,
            reason: "monthly_limit_disabled",
            remaining,
            safeRemaining,
            usedChars,
        };
    }

    if (nextChars > remaining) {
        return {
            allowed: false,
            effectiveChance: 0,
            reason: "monthly_limit_reached",
            remaining,
            safeRemaining,
            usedChars,
        };
    }

    if (nextChars > safeRemaining) {
        return {
            allowed: false,
            effectiveChance: 0,
            reason: "monthly_reserve_protected",
            remaining,
            safeRemaining,
            usedChars,
        };
    }

    const usageRatio = monthlyLimit > 0 ? usedChars / monthlyLimit : 1;
    let chanceMultiplier = 1;
    if (usageRatio >= 0.9) chanceMultiplier = 0.1;
    else if (usageRatio >= 0.8) chanceMultiplier = 0.25;
    else if (usageRatio >= 0.65) chanceMultiplier = 0.5;
    else if (usageRatio >= 0.5) chanceMultiplier = 0.75;

    return {
        allowed: true,
        effectiveChance: Math.max(0, Math.min(1, (Number(settings?.chance) || 0) * chanceMultiplier)),
        reason: "ok",
        remaining,
        safeRemaining,
        usedChars,
    };
}

async function synthesizeSpeechToFile(text) {
    const settings = getVoiceSettings();
    const speechText = normalizeSpeechText(text, settings.maxChars);
    if (!speechText) {
        throw new Error("ELEVENLABS_EMPTY_TEXT");
    }
    if (!settings.apiKey || !settings.voiceId) {
        throw new Error("ELEVENLABS_NOT_CONFIGURED");
    }

    const usageMonth = getUsageMonthKey();
    const usage = await getElevenLabsUsage(usageMonth);
    const budget = calculateVoiceBudgetDecision(settings, usage, speechText.length);
    if (!budget.allowed) {
        throw new Error(`ELEVENLABS_BUDGET_BLOCKED_${budget.reason}`);
    }

    const cacheKey = getSpeechCacheKey(speechText, settings);
    const existing = findCachedFilePath(cacheKey);
    if (existing) {
        return {
            cacheKey,
            filePath: existing,
            playbackUrl: buildCachedTrackUrl(cacheKey),
            characterCount: speechText.length,
            usageMonth,
        };
    }

    await addElevenLabsUsage(usageMonth, speechText.length);

    const outputExt = getExtensionFromOutputFormat(settings.outputFormat);
    const outputPath = path.join(ensureAudioCacheDir(), `${cacheKey}${outputExt}`);
    try {
        const response = await fetch(
            `${ELEVENLABS_API_BASE}/text-to-speech/${encodeURIComponent(settings.voiceId)}?output_format=${encodeURIComponent(settings.outputFormat)}`,
            {
                method: "POST",
                headers: {
                    "content-type": "application/json",
                    "xi-api-key": settings.apiKey,
                    "accept": "audio/mpeg",
                },
                body: JSON.stringify({
                    text: speechText,
                    ...(settings.modelId ? { model_id: settings.modelId } : {}),
                }),
            }
        );

        if (!response.ok) {
            const details = await response.text().catch(() => "");
            throw new Error(`ELEVENLABS_TTS_FAILED_${response.status}${details ? `: ${details}` : ""}`);
        }

        const audioBuffer = Buffer.from(await response.arrayBuffer());
        if (!audioBuffer.length) {
            throw new Error("ELEVENLABS_TTS_EMPTY_AUDIO");
        }

        fs.writeFileSync(outputPath, audioBuffer);
        logger.info("ElevenLabs speech audio ready.", {
            cacheKey,
            filePath: outputPath,
            characterCount: speechText.length,
            usageMonth,
        });

        return {
            cacheKey,
            filePath: outputPath,
            playbackUrl: buildCachedTrackUrl(cacheKey),
            characterCount: speechText.length,
            usageMonth,
        };
    } catch (error) {
        await subtractElevenLabsUsage(usageMonth, speechText.length).catch(() => { });
        throw error;
    }
}

function getVoiceReplyMode(message, settings = getVoiceSettings()) {
    if (!message?.guild) {
        return settings.chatEnabled ? "chat" : null;
    }

    const state = getGuildState(message.guild.id);
    const userVoiceChannel = message.member?.voice?.channel || null;
    const botVoiceChannelId = state?.channelId || null;

    if (
        settings.voiceEnabled &&
        userVoiceChannel &&
        botVoiceChannelId &&
        userVoiceChannel.id === botVoiceChannelId
    ) {
        return "voice";
    }

    return settings.chatEnabled ? "chat" : null;
}

async function sendAudioAttachmentReply(message, text) {
    const speech = await synthesizeSpeechToFile(text);
    const attachment = new AttachmentBuilder(speech.filePath, {
        name: `yova-vn-${Date.now()}.mp3`,
        description: "Balasan suara Yova",
    });

    try {
        await message.reply({
            files: [attachment],
        });
        return true;
    } catch (error) {
        logger.warn("Failed sending audio attachment reply.", error);
        return false;
    }
}

function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function startVoiceSpeechReply(message, text) {
    const guildId = message.guild?.id;
    if (!guildId || activeSpeechLocks.has(guildId)) {
        return false;
    }

    const state = getGuildState(guildId);
    const voiceChannel = message.member?.voice?.channel || null;
    if (!state || !voiceChannel || state.channelId !== voiceChannel.id) {
        return false;
    }

    const lavalinkService = require("../../discord/player/LavalinkManager");
    const player = lavalinkService.getPlayer(guildId);
    if (!player || player.voiceChannelId !== voiceChannel.id) {
        return false;
    }

    activeSpeechLocks.add(guildId);
    try {
        const speech = await synthesizeSpeechToFile(text);
        const settings = getVoiceSettings();
        const currentIndex = Number.isInteger(state.currentIndex) ? state.currentIndex : -1;
        const restoreTrack = currentIndex >= 0 ? state.queue?.[currentIndex] || null : null;
        const restorePositionMs = Number.isFinite(player.position) ? player.position : 0;
        const restoreWasPaused = Boolean(player.paused);
        const restoreWasPlaying = Boolean(player.playing || player.paused);

        if (player.playing && !player.paused) {
            await player.pause();
        }

        await delay(settings.pauseDelayMs);

        const searchResult = await player.search({ query: speech.playbackUrl });
        if (!searchResult?.tracks?.length) {
            throw new Error("ELEVENLABS_SPEECH_TRACK_NOT_FOUND");
        }

        state.speechPlayback = {
            active: true,
            playbackUrl: speech.playbackUrl,
            restoreTrack,
            restorePositionMs,
            restoreWasPaused,
            restoreWasPlaying,
            startedAt: Date.now(),
        };

        await player.play({
            clientTrack: searchResult.tracks[0],
            noReplace: false,
        });

        logger.info(`Started AI voice reply in guild ${guildId}.`, {
            playbackUrl: speech.playbackUrl,
            restorePositionMs,
            restoreWasPlaying,
            restoreWasPaused,
        });

        return true;
    } catch (error) {
        logger.warn("Failed starting AI voice reply in voice channel.", error);
        if (state) {
            state.speechPlayback = null;
        }
        activeSpeechLocks.delete(guildId);
        return false;
    }
}

async function restoreTrackAfterSpeech(player, speechPlayback) {
    if (!speechPlayback?.restoreTrack || !speechPlayback.restoreWasPlaying) {
        return;
    }

    const restoreTrack = speechPlayback.restoreTrack;
    const restoreQuery =
        restoreTrack.originalUrl ||
        restoreTrack.originUrl ||
        restoreTrack.url ||
        restoreTrack.title;
    if (!restoreQuery) return;

    const searchResult = await player.search({ query: restoreQuery });
    if (!searchResult?.tracks?.length) {
        throw new Error("RESTORE_TRACK_NOT_FOUND_AFTER_SPEECH");
    }

    const track = searchResult.tracks[0];
    if (restoreTrack.requestedById) {
        track.userData = { requesterId: restoreTrack.requestedById };
    }

    await player.play({
        clientTrack: track,
        noReplace: false,
    });

    if (speechPlayback.restorePositionMs > 0 && typeof player.seek === "function") {
        await player.seek(speechPlayback.restorePositionMs).catch(() => { });
    }

    if (speechPlayback.restoreWasPaused) {
        await player.pause().catch(() => { });
    } else if (typeof player.resume === "function") {
        await player.resume().catch(() => { });
    }
}

async function handleSpeechPlaybackLifecycleEvent(player, payload = {}) {
    const guildId = player?.guildId;
    if (!guildId) return false;

    const state = getGuildState(guildId);
    const speechPlayback = state?.speechPlayback;
    if (!speechPlayback?.active) {
        return false;
    }

    if (payload?.reason === "replaced") {
        if (state) {
            state.speechPlayback = null;
        }
        activeSpeechLocks.delete(guildId);
        logger.info(`AI voice reply cancelled in guild ${guildId}.`, {
            reason: "replaced",
        });
        return true;
    }

    try {
        await restoreTrackAfterSpeech(player, speechPlayback);
    } catch (error) {
        logger.warn("Failed restoring music after AI voice reply.", error);
    } finally {
        if (state) {
            state.speechPlayback = null;
        }
        activeSpeechLocks.delete(guildId);
    }

    logger.info(`AI voice reply finished in guild ${guildId}.`, {
        reason: payload?.reason || payload?.type || "unknown",
    });
    return true;
}

async function maybeHandleVoiceReply(message, text, response) {
    if (!shouldAttemptVoiceReply(response)) {
        return { handled: false, skipTextReply: false };
    }

    const settings = getVoiceSettings();
    const speechText = normalizeSpeechText(text, settings.maxChars);
    if (!speechText) {
        return { handled: false, skipTextReply: false };
    }

    const usageMonth = getUsageMonthKey();
    const usage = await getElevenLabsUsage(usageMonth);
    const budget = calculateVoiceBudgetDecision(settings, usage, speechText.length);
    if (!budget.allowed) {
        logger.info("Skipping AI voice reply due to ElevenLabs monthly budget policy.", {
            reason: budget.reason,
            usageMonth,
            usedChars: budget.usedChars,
            remaining: budget.remaining,
            safeRemaining: budget.safeRemaining,
            characterCount: speechText.length,
        });
        return { handled: false, skipTextReply: false };
    }

    if (Math.random() >= budget.effectiveChance) {
        return { handled: false, skipTextReply: false };
    }

    const mode = getVoiceReplyMode(message, settings);
    if (mode === "voice") {
        const started = await startVoiceSpeechReply(message, speechText);
        return { handled: started, skipTextReply: false };
    }

    if (mode === "chat") {
        const sent = await sendAudioAttachmentReply(message, speechText);
        return { handled: sent, skipTextReply: sent };
    }

    return { handled: false, skipTextReply: false };
}

module.exports = {
    calculateVoiceBudgetDecision,
    getUsageMonthKey,
    handleSpeechPlaybackLifecycleEvent,
    isCasualNoToolReply,
    isVoiceReplyConfigured,
    maybeHandleVoiceReply,
    normalizeSpeechText,
    shouldAttemptVoiceReply,
};
