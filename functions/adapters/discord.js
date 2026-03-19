const logger = require("../../utils/logger");
const { runAiAgent } = require("../../ai/controller");
const {
    buildServerContext,
    buildMemorySummary,
    getAuthorCallName,
    sanitizeMessage,
    replaceGenericCall
} = require("../../utils/ai/ai_chat");
const { maybeHandleVoiceReply } = require("../../utils/common/ai_voice");
const { waitWithTyping } = require("../../utils/common/typing");
const {
    buildMemberListComponents,
    registerMemberListSession,
} = require("../../discord/member_list");
const getConfig = require("../../config");
const config = getConfig();

function getContextMode() {
    const mode = String(config.ai_context_mode || "full").toLowerCase().trim();
    return mode === "minimal" ? "minimal" : "full";
}

function getHistoryMode(contextMode = "full") {
    const configured = String(config.ai_history_mode || "").toLowerCase().trim();
    if (["tool", "prefetch", "minimal", "off"].includes(configured)) return configured;
    // Default: when context is minimal, rely on tools; otherwise keep current behavior.
    return contextMode === "minimal" ? "tool" : "prefetch";
}

function shouldFetchChatHistory(prompt, options = {}, historyMode = "prefetch") {
    if (historyMode === "off" || historyMode === "tool") return false;

    // Prefetch mode keeps old behavior; minimal mode only fetches when explicitly needed.
    if (historyMode === "prefetch" && options.replyContext) return true;

    const text = String(prompt || "").toLowerCase().trim();
    if (!text) return false;

    return /\b(chat|pesan|riwayat|history|konteks|context|sebelumnya|tadi|barusan|bahas apa|ngomong apa|last message|msg)\b/i.test(text);
}

function guessIncludeOthers(message, prompt, options = {}) {
    // If user replies to a bot message, default to just user<->bot unless they ask about others explicitly.
    const text = String(prompt || "").toLowerCase();

    if (message?.mentions?.users?.size) return true;
    if (message?.mentions?.roles?.size) return true;
    if (message?.mentions?.everyone || message?.mentions?.here) return true;

    // Explicit multi-user/channel context intent
    if (/\b(di|dalam)\s+(chat|channel|server)\b/i.test(text)) return true;
    if (/\b(orang lain|yang lain|member|anggota|kalian|teman|temen|pada)\b/i.test(text)) return true;
    if (/\bsiapa\b/i.test(text)) return true;

    // For reply threads, keep it narrow by default.
    if (options.replyContext) return false;

    return false;
}

/**
 * Validates if the message is safe to process
 */
function isValidMessage(message) {
    if (message.author.bot) return false;
    if (!message.content.trim()) return false;
    return true;
}

/**
 * Main handler for Discord messages
 * @param {Object} message - Discord message object
 * @param {String} prompt - user input text
 * @param {Object} options - additional options (replyContext, etc)
 */
async function handleDiscordMessage(message, prompt, options = {}) {
    try {
        if (!isValidMessage(message)) return;

        const userId = message.author.id;
        const guildId = message.guild?.id || "dm";
        const channelId = message.channel.id;
        // Session ID: specific to user in this channel (or global per user? usually channel context matters)
        // Let's keep it channel-bound to avoid confusion across channels, but maybe user-bound is better?
        // Legacy didn't strict session, but controller needs one.
        const sessionId = `discord-${guildId}-${channelId}-${userId}`;

        // 1. Build Context
        const contextMode = getContextMode();
        const historyMode = getHistoryMode(contextMode);
        const callName = await getAuthorCallName(message);
        const memorySummary =
            contextMode === "minimal" ? "" : await buildMemorySummary(userId);
        const serverContextObj =
            contextMode === "minimal" ? null : await buildServerContext(message);

        const context = {
            source: "discord",
            userId,
            guildId,
            channelId,
            sessionId,
            isReply: !!options.replyContext,
            replyContext: options.replyContext || "",
            capabilities: ["discord", "web", "memory", "session", "system", "reminder", "music"],
            ...(serverContextObj ? { serverContext: serverContextObj } : {}),
            ...(contextMode === "minimal"
                ? {}
                : {
                    userSummary: `User: ${callName || "User"}${memorySummary ? "\n" + memorySummary : ""}`,
                }),
        };

        // 2. Typing Indicator (Prevent timeout feeling)
        message.channel.sendTyping().catch(() => { });

        // 3. Get Chat History only when the prompt clearly needs channel context.
        let history = [];
        if (shouldFetchChatHistory(prompt, options, historyMode)) {
            const { getChatHistory } = require("../../utils/ai/ai_chat");
            const includeOthers = guessIncludeOthers(message, prompt, options);
            const includeAuthorNames = includeOthers;
            const historyRaw = await getChatHistory(
                message.channel,
                userId,
                message.client.user.id,
                message.id,
                { includeOthers, includeAuthorNames }
            );

            history = historyRaw.map((msg) => {
                if (msg.role === "assistant") {
                    return { role: "assistant", content: msg.content };
                }
                const text = includeAuthorNames && msg.authorName
                    ? `${msg.authorName}: ${msg.content}`
                    : msg.content;
                return { role: "user", content: text };
            });
        }

        // 4. Run Agent
        const response = await runAiAgent(prompt, context, 5, history);

        // 4. Handle Response
        if (response.type === "final" || response.type === "clarify" || response.type === "reply") {
            let replyPayload = null;
            if (typeof response.message === "string") {
                replyPayload = { content: response.message };
            } else if (typeof response.message === "object" && response.message) {
                replyPayload = { ...response.message };
            } else if (typeof response.question === "string") {
                replyPayload = { content: response.question };
            }

            if (replyPayload?.content) {
                replyPayload.content = sanitizeMessage(
                    replaceGenericCall(replyPayload.content, callName)
                );
            }
            if (!replyPayload || !replyPayload.content || !replyPayload.content.trim()) {
                logger.warn("Agent produced empty reply. Sending fallback message.", {
                    type: response.type
                });
                replyPayload = { content: "Duh, aku mau ngomong sesuatu tapi lupaa... Apa ya tadi? 😒" };
            }

            let pagination = null;
            if (replyPayload.pagination?.kind === "member_list") {
                pagination = replyPayload.pagination;
                replyPayload.components = buildMemberListComponents(pagination);
                delete replyPayload.pagination;
            }

            // Use waitWithTyping to simulate natural delay based on length
            await waitWithTyping(message.channel, replyPayload.content).catch(() => { });

            const voiceReply = await maybeHandleVoiceReply(
                message,
                replyPayload.content,
                response
            ).catch((error) => {
                logger.warn("AI voice reply attempt failed.", error);
                return { handled: false, skipTextReply: false };
            });

            if (voiceReply?.skipTextReply) {
                return;
            }

            let sent;
            try {
                // Try to reply first (cleaner UI)
                sent = await message.reply(replyPayload);
            } catch (replyError) {
                logger.warn("Discord reply failed (likely unknown message or channel type). Falling back to channel.send.", { error: replyError.message });
                // Fallback: Just send to channel and mention the user
                const fallbackContent = `<@${message.author.id}>, ${replyPayload.content}`;
                sent = await message.channel.send({
                    ...replyPayload,
                    content: fallbackContent,
                    failIfNotExists: false // Don't crash if something exists check fails
                });
            }

            if (sent && pagination?.kind === "member_list") {
                registerMemberListSession(sent.id, {
                    guildId,
                    channelId,
                    requesterId: userId,
                    offset: pagination.offset || 0,
                    limit: pagination.limit || 10,
                    total: pagination.total,
                    hasMore: pagination.hasMore,
                });
            }
        } else {
            logger.warn("Agent returned unhandled type:", response.type);
        }

    } catch (error) {
        logger.error("Discord Adapter Error:", error);
        // Last ditch attempt: send plain text to channel
        try {
            await message.channel.send("Waduh, ada korslet di otakku. Coba tanya lagi deh! 😒");
        } catch (e) { }
    }
}

module.exports = { handleDiscordMessage };
