const { chatCompletion } = require("./completion");
const tools = require("./tool_definitions");
const { handleToolCalls } = require("./tool_handler");
const logger = require("../utils/logger");

const { YOVA_PERSONA } = require("./persona");
const { formatMemberList } = require("../functions/utils/member_list_format");

const SYSTEM_PROMPT = YOVA_PERSONA;
const COMPACT_SYSTEM_PROMPT = [
    "Kamu Yova, asisten Discord yang ramah dan jelas.",
    "Gunakan Bahasa Indonesia natural, ringkas, dan sopan.",
    "Jika tidak perlu aksi/tool, balas langsung ke pertanyaan user.",
    'Output wajib JSON valid: {"type":"final","message":"..."} atau {"type":"tool_call",...}.',
    "Jangan tampilkan JSON mentah atau detail teknis ke user.",
].join(" ");

/**
 * Parses the model output to ensure it's valid JSON according to the strict rules.
 */
function parseAgentResponse(content) {
    // Strip markdown code blocks if present (Gemma models sometimes do this)
    let cleanedContent = content.trim();

    // Remove ```json ... ``` or ``` ... ```
    const codeBlockMatch = cleanedContent.match(/```(?:json)?\s*([\s\S]*?)\s*```/m);
    if (codeBlockMatch) {
        cleanedContent = codeBlockMatch[1].trim();
    }

    try {
        const json = JSON.parse(cleanedContent);
        if (['tool_call', 'clarify', 'final'].includes(json.type)) {
            return json;
        }
    } catch (e) {
        // Fallback 1: Attempt to extract JSON if there's surrounding text (though the prompt forbids it)
        const jsonMatch = cleanedContent.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
            try {
                const extracted = JSON.parse(jsonMatch[0]);
                if (['tool_call', 'clarify', 'final'].includes(extracted.type)) {
                    return extracted;
                }
            } catch (innerE) {
                // Not valid JSON
            }
        }

        // Fallback 2: Handle <function=name>args</function> hallucination (common in Llama/Qwen)
        const funcMatch = cleanedContent.match(/<function=(\w+)>([\s\S]*?)<\/function>/i);
        if (funcMatch) {
            const name = funcMatch[1];
            const args = funcMatch[2].trim();
            logger.debug(`Detected hallucinated <function> tag for ${name}. Converting to JSON.`);
            return {
                type: 'tool_call',
                tool: name,
                arguments: args
            };
        }
    }
    return null;
}

/**
 * Runs the AI agent loop.
 */
const memberListState = new Map(); // sessionId -> { offset, limit, hasMore, updatedAt }
const MEMBER_LIST_TTL_MS = 5 * 60 * 1000;
const DEFAULT_MEMBER_PAGE_SIZE = 10;

function normalizeInlineText(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
}

function stringifyServerContext(serverContext) {
    if (!serverContext) return "";
    if (typeof serverContext === "string") {
        return serverContext.trim();
    }
    if (typeof serverContext !== "object") {
        return String(serverContext);
    }

    return Object.entries(serverContext)
        .map(([key, value]) => {
            if (value == null) return `${key}: -`;
            if (typeof value === "string") return `${key}:\n${value}`;
            try {
                return `${key}:\n${JSON.stringify(value, null, 2)}`;
            } catch (error) {
                return `${key}: ${String(value)}`;
            }
        })
        .join("\n\n")
        .trim();
}

function extractTrackTitleFromReplyContext(replyContext) {
    const text = normalizeInlineText(replyContext);
    if (!text) return "";

    const patterns = [
        /memutar(?:\s+sound effect)?\s*:\s*(.+)$/i,
        /memutar playlist\s*:\s*(.+)$/i,
        /memutar lagi\s*:\s*(.+)$/i,
    ];

    for (const pattern of patterns) {
        const match = text.match(pattern);
        if (match?.[1]) {
            return match[1].trim();
        }
    }

    return "";
}

function isTrackIdentificationPrompt(userInput) {
    const text = normalizeInlineText(userInput).toLowerCase();
    if (!text) return false;
    return [
        /^(ini\s+)?lagu apa( ini)?\??$/,
        /^judul( lagu)?(nya)? apa\??$/,
        /^yang diputar apa\??$/,
        /^musik apa( ini)?\??$/,
        /^sound effect apa( ini)?\??$/,
    ].some((pattern) => pattern.test(text));
}

function tryBuildDirectReplyFromMusicBubble(userInput, context = {}) {
    if (!context?.isReply || !context?.replyContext) return null;
    if (!isTrackIdentificationPrompt(userInput)) return null;

    const title = extractTrackTitleFromReplyContext(context.replyContext);
    if (!title) return null;

    return `Itu lagu **${title}**.`;
}

function isRuntimeStatusPrompt(userInput) {
    const text = normalizeInlineText(userInput).toLowerCase();
    if (!text) return false;
    return [
        /\bada error apa(?: sekarang)?\b/i,
        /\bada masalah apa(?: sekarang)?\b/i,
        /\bkenapa bot\b/i,
        /\bkenapa yova\b/i,
        /\bdiagnosa\b/i,
        /\bdiagnosis\b/i,
        /\btroubleshoot\b/i,
    ].some((pattern) => pattern.test(text));
}

function isYoutubeCookieBotPrompt(userInput) {
    const text = normalizeInlineText(userInput).toLowerCase();
    if (!text) return false;
    return /\bcookie(?:s)? youtube\b/i.test(text) &&
        /\b(bot|server|yova|aman|sehat|valid|expired|bermasalah)\b/i.test(text);
}

function isMusicLagPrompt(userInput) {
    const text = normalizeInlineText(userInput).toLowerCase();
    if (!text) return false;
    const lagLike = /\b(delay|lag|ngelag|tersendat|patah|putus putus|putus-putus|buffer|buffering|stutter)\b/i.test(text);
    const musicLike = /\b(lagu|musik|music|pemutaran|playback|audio|suara)\b/i.test(text);
    return lagLike && musicLike;
}

function isMusicFailurePrompt(userInput) {
    const text = normalizeInlineText(userInput).toLowerCase();
    if (!text) return false;
    const failLike = /\b(gagal diputar|tidak bisa diputar|ga bisa diputar|nggak bisa diputar|kenapa.*diputar|kenapa.*gagal|error.*musik|error.*lagu)\b/i.test(text);
    const musicLike = /\b(lagu|musik|music|pemutaran|playback|audio|suara)\b/i.test(text);
    return failLike && musicLike;
}

function parseQueueLengthFromMusicStatus(text) {
    const match = String(text || "").match(/Queue length:\s*(\d+)/i);
    return match ? Number(match[1]) : null;
}

function parseNowPlayingFromMusicStatus(text) {
    const match = String(text || "").match(/Now playing:\s*(.+)$/im);
    return match?.[1]?.trim() || null;
}

function buildRuntimeIssueSummary(diagnostics, { cookieOnly = false } = {}) {
    const issues = Array.isArray(diagnostics?.issues) ? diagnostics.issues : [];
    const filtered = cookieOnly
        ? issues.filter((issue) => issue.kind === "youtube_cookies_invalid")
        : issues;

    if (filtered.length === 0) {
        return cookieOnly
            ? "Dari log terbaru, belum ada indikasi cookies YouTube bot sedang invalid."
            : "Dari log terbaru, tidak ada error runtime yang jelas terdeteksi saat ini.";
    }

    const top = filtered[0];
    if (cookieOnly) {
        return `${top.summary} Kemungkinan penyebabnya: ${top.probableCause} Saran: ${top.suggestedAction}`;
    }

    const extra = filtered.slice(1, 3).map((item) => item.summary);
    if (extra.length === 0) {
        return `${top.summary} Kemungkinan penyebabnya: ${top.probableCause} Saran: ${top.suggestedAction}`;
    }
    return `${top.summary} Selain itu ada juga: ${extra.join(" ")} Kemungkinan utama: ${top.probableCause}`;
}

async function tryHandleRuntimeSelfDiagnostics(userInput, context = {}) {
    if (!context?.guildId) return null;

    const wantsRuntimeStatus = isRuntimeStatusPrompt(userInput);
    const wantsCookieStatus = isYoutubeCookieBotPrompt(userInput);
    const wantsMusicLag = isMusicLagPrompt(userInput);
    const wantsMusicFailure = isMusicFailurePrompt(userInput);

    if (!wantsRuntimeStatus && !wantsCookieStatus && !wantsMusicLag && !wantsMusicFailure) {
        return null;
    }

    const platform = require("../functions/platform");
    const diagnostics = await platform.getRecentRuntimeIssues(80, true);

    if (wantsCookieStatus) {
        return buildRuntimeIssueSummary(diagnostics, { cookieOnly: true });
    }

    if (wantsMusicLag || wantsMusicFailure) {
        const issues = Array.isArray(diagnostics?.issues) ? diagnostics.issues : [];
        const voiceIssue = issues.find((item) => ["voice_drift", "lavalink_no_tracks", "youtube_cookies_invalid"].includes(item.kind));
        let musicStatus = "";
        let queueLength = null;
        let nowPlaying = null;

        try {
            musicStatus = await platform.getMusicStatus(context.guildId);
            queueLength = parseQueueLengthFromMusicStatus(musicStatus);
            nowPlaying = parseNowPlayingFromMusicStatus(musicStatus);
        } catch (error) {
            logger.warn("Runtime diagnostic failed to fetch music status; falling back to log-only explanation.", error);
        }

        if (voiceIssue) {
            return `${voiceIssue.summary} Kemungkinan penyebabnya: ${voiceIssue.probableCause}` +
                `${nowPlaying ? ` Sekarang yang terbaca diputar: ${nowPlaying}.` : ""}` +
                `${queueLength != null ? ` Queue saat ini: ${queueLength}.` : ""}`;
        }

        return `Dari log terbaru, saya belum melihat error playback yang tegas.` +
            `${nowPlaying ? ` Sekarang yang diputar: ${nowPlaying}.` : ""}` +
            `${queueLength != null ? ` Queue saat ini ${queueLength}.` : ""}` +
            ` Jadi kalau masih terasa lag, kemungkinan besar masalahnya ada di jalur voice/network atau runtime Lavalink, bukan karena antrian.`;
    }

    if (wantsRuntimeStatus) {
        return buildRuntimeIssueSummary(diagnostics);
    }

    return null;
}

async function runAiAgent(userInput, context = {}, maxIterations = 5, messageHistory = []) {
    // Default capabilities for backward compatibility (Full Access)
    const userCapabilities = context.capabilities || ["discord", "web", "memory", "session", "system", "reminder", "music", "social", "moderation"];

    // ... (allowedTools logic skipped for brevity, keeping existing code) ...
    // Filter tools based on capabilities
    // A tool is allowed if the user possesses ALL tags required by the tool.
    // Tags might be at root (tool.tags) or inside function (tool.function.tags) due to definition structure.
    const allowedTools = tools.filter(tool => {
        const tags = tool.tags || (tool.function && tool.function.tags);
        if (!tags || tags.length === 0) return true;
        return tags.every(tag => {
            if (userCapabilities.includes(tag)) return true;
            const prefix = tag.split("_")[0];
            return userCapabilities.includes(prefix);
        });
    });

    const { analyzeComplexity } = require("./complexity_analyzer");
    const { intent, needsHistory, needsTool } = analyzeComplexity(userInput, { messages: messageHistory });
    let usedTools = false;
    const buildMeta = () => ({
        intent,
        needsHistory,
        needsTool,
        usedTools,
    });

    const useCompactPrompt =
        !context.isReply &&
        !needsTool &&
        !needsHistory &&
        intent === "general";
    const maxTokensForTurn = useCompactPrompt ? 220 : 1500;

    let systemMessage = useCompactPrompt ? COMPACT_SYSTEM_PROMPT : SYSTEM_PROMPT;
    const replyContext = normalizeInlineText(context.replyContext);
    const serverContextText = stringifyServerContext(context.serverContext);

    // Add user info only when using full routing prompt.
    if (!useCompactPrompt && context.userSummary) {
        systemMessage += `\n\n[USER INFO]\n${context.userSummary}`;
    }

    // Keep IDs only for full mode (mainly needed for tool execution path).
    if (!useCompactPrompt) {
        systemMessage += `\n\n[IDs]\nGuild: ${context.guildId}\nChannel: ${context.channelId}`;
    }

    if (replyContext) {
        systemMessage += `\n\n[REPLY CONTEXT]\n${replyContext}`;
    }

    if (serverContextText) {
        systemMessage += `\n\n[SERVER CONTEXT]\n${serverContextText}`;
    }

    const replyAlreadyInHistory = replyContext && messageHistory.some((item) => {
        return item?.role === "assistant" && normalizeInlineText(item.content) === replyContext;
    });

    let conversationHistory = [
        { role: "system", content: systemMessage },
        ...messageHistory,
        ...(replyContext && !replyAlreadyInHistory ? [{ role: "assistant", content: replyContext }] : []),
        { role: "user", content: userInput }
    ];

    const directReply = tryBuildDirectReplyFromMusicBubble(userInput, context);
    if (directReply) {
        logger.info("Direct music bubble reply resolved from reply context.", {
            guildId: context.guildId || null,
            channelId: context.channelId || null,
        });
        return { type: "final", message: directReply, meta: buildMeta() };
    }

    const runtimeDiagnosticReply = await tryHandleRuntimeSelfDiagnostics(userInput, context);
    if (runtimeDiagnosticReply) {
        logger.info("Direct runtime diagnostic reply resolved from bot status prompt.", {
            guildId: context.guildId || null,
            channelId: context.channelId || null,
        });
        return { type: "final", message: runtimeDiagnosticReply, meta: buildMeta() };
    }

    const quickList = await tryHandleMemberListRequest(userInput, context);
    if (quickList) return { type: "final", message: quickList, meta: buildMeta() };

    const quick = await tryHandleMemberPagination(userInput, context);
    if (quick) return { type: "final", message: quick, meta: buildMeta() };

    let iterations = 0;
    while (iterations < maxIterations) {
        iterations++;

        const response = await chatCompletion({
            messages: conversationHistory,
            temperature: 0.1, // Low temperature for consistency with JSON rules
            maxTokens: maxTokensForTurn
        }, {
            tools: allowedTools,
            tool_choice: "auto",
            isReply: context.isReply
        });

        // Case 1: Model wants to call a native tool (handled by completion.js returning message with tool_calls)
        if (response && response.tool_calls) {
            usedTools = true;
            conversationHistory.push(response);
            const toolResults = await handleToolCalls(response.tool_calls, context);
            const direct = buildDirectToolResponse(response.tool_calls, toolResults, context);
            if (direct) {
                return { type: 'final', message: direct, meta: buildMeta() };
            }
            conversationHistory.push(...toolResults);
            continue; // Go back to LLM with tool results
        }

        // Case 2: Model returns a text response (should be JSON according to SYSTEM_PROMPT)
        const content = typeof response === 'string' ? response : response.content;
        const parsed = parseAgentResponse(content);

        if (!parsed) {
            logger.info("Agent returned plain text response (handling as final message).");
            // Fallback: try to nudge the model or wrap it
            return {
                type: "final",
                message: content,
                meta: buildMeta(),
            };
        }

        // Case 1: Model wants to call a native tool
        if (response && response.tool_calls) {
            usedTools = true;
            conversationHistory.push(response);
            const toolResults = await handleToolCalls(response.tool_calls, context);
            const direct = buildDirectToolResponse(response.tool_calls, toolResults, context);
            if (direct) {
                return { type: 'final', message: direct, meta: buildMeta() };
            }
            conversationHistory.push(...toolResults);
            continue; // Go back to LLM with tool results
        }

        // Case 2: Hallucinated JSON format tool call
        if (parsed.type === 'tool_call' || (parsed.tool && !parsed.type)) {
            const toolName = parsed.tool || parsed.function || parsed.name;

            // Check if the tool is actually allowed
            const isToolAllowed = allowedTools.some(t => (t.function?.name || t.name) === toolName);

            if (!isToolAllowed) {
                logger.warn(`AI hallucinated a tool call for "${toolName}" which is not allowed. Handling as persona error.`);
                if (intent === 'game') {
                    // Redirect to direct answer for riddles
                    conversationHistory.push({ role: "assistant", content: JSON.stringify(parsed) });
                    conversationHistory.push({ role: "user", content: "Lupakan soal tool. Jawab teka-teki tadi langsung sebagai Yova (type: final)." });
                    continue;
                }
            }

            let rawArgs = parsed.arguments || parsed.args || parsed.params || parsed.parameters;
            if (!rawArgs || (typeof rawArgs === 'object' && Object.keys(rawArgs).length === 0)) {
                const { type, name, function: fn, tool, ...rest } = parsed;
                if (Object.keys(rest).length > 0) rawArgs = rest;
                else rawArgs = {};
            }

            let args = rawArgs;
            if (typeof rawArgs === 'string') {
                try { args = JSON.parse(rawArgs); } catch (e) { args = {}; }
            }

            const finalToolName = toolName || "unknown";
            const pseudoToolCall = {
                id: `call_${Date.now()}`,
                function: { name: finalToolName, arguments: JSON.stringify(args || {}) }
            };

            const toolOutput = await handleToolCalls([pseudoToolCall], context);
            usedTools = true;
            const direct = buildDirectToolResponse([pseudoToolCall], toolOutput, context);
            if (direct) return { type: 'final', message: direct, meta: buildMeta() };

            conversationHistory.push({ role: "assistant", content: JSON.stringify(parsed) });
            conversationHistory.push(...toolOutput);
            continue;
        }

        // Return final or clarification
        if (parsed.type === 'final' || parsed.type === 'reply') {
            // Flexible parsing: accept message, content, or response
            let msg = parsed.message || parsed.content || parsed.response || parsed.reply;

            // Fallback empty check
            if (!msg) {
                logger.warn("AI returned final type but no message content found.", parsed);
                msg = "Maaf, aku belum bisa menyusun jawaban yang tepat.";
            }

            return { type: 'final', message: msg, meta: buildMeta() };
        }

        return { ...parsed, meta: buildMeta() };
    }

    return {
        type: "final",
        message: "Maaf, prosesnya belum selesai setelah beberapa langkah. Coba kirim ulang permintaannya.",
        meta: buildMeta(),
    };
}

function buildDirectToolResponse(toolCalls = [], toolResults = [], context = {}) {
    if (!Array.isArray(toolResults) || toolResults.length !== 1) return null;
    const tool = toolResults[0];
    if (!tool) return null;

    if (tool.name === 'playMusic') {
        let res;
        try { res = JSON.parse(tool.content); } catch (e) { return null; }
        if (res.error) return res.error;
        if (res.success) {
            const song = res.title || "lagunya";
            const templates = [
                `Siap, **${song}** sedang diputar.`,
                `**${song}** sudah ditambahkan ke antrian.`,
                `Memutar **${song}** sekarang.`,
                `Oke, **${song}** berhasil diproses.`,
                `Berhasil, **${song}** sudah dijalankan.`
            ];
            return templates[Math.floor(Math.random() * templates.length)];
        }
    }

    if (['locateUser', 'findUserLocation'].includes(tool.name)) {
        let res;
        try { res = JSON.parse(tool.content); } catch (e) { return null; }

        if (res.error) return res.error;

        if (res.locationDescription) {
            const templates = [
                `${res.locationDescription}`,
                `Lokasi ditemukan: ${res.locationDescription}`,
                `Berikut info lokasinya: ${res.locationDescription}`,
                `Ditemukan: ${res.locationDescription}`,
                `Informasi lokasi: ${res.locationDescription}`
            ];
            return templates[Math.floor(Math.random() * templates.length)];
        }
    }

    if (tool.name === 'sendMessage') {
        let res;
        try { res = JSON.parse(tool.content); } catch (e) { return null; }

        if (res.error) return res.error;

        // Check for success (either direct messageId or smart delivery object)
        if (res.success || res.messageId) {
            const templates = [
                "Pesan berhasil dikirim.",
                "Sudah, pesannya tersampaikan.",
                "Selesai, pesan sudah masuk.",
                "Berhasil, pesan sudah dikirim.",
                "Oke, pesan sudah diteruskan."
            ];
            return templates[Math.floor(Math.random() * templates.length)];
        }
    }

    if (tool.name !== 'listMembers') return null;

    let data;
    try {
        data = JSON.parse(tool.content);
    } catch (error) {
        return null;
    }

    let items = [];
    let total = null;
    let offset = 0;
    let limit = DEFAULT_MEMBER_PAGE_SIZE;

    if (Array.isArray(data)) {
        items = data;
    } else if (data && typeof data === 'object') {
        if (Array.isArray(data.items)) items = data.items;
        if (typeof data.total === 'number') total = data.total;
        if (typeof data.offset === 'number') offset = data.offset;
        if (typeof data.limit === 'number') limit = data.limit;
    }

    if (!Array.isArray(items) || items.length === 0) {
        return "Tidak menemukan data member. Coba cek lagi servernya.";
    }

    limit = Math.max(1, Math.min(Number.isFinite(limit) ? limit : DEFAULT_MEMBER_PAGE_SIZE, 50));
    offset = Math.max(0, Number.isFinite(offset) ? offset : 0);
    const hasMore = typeof total === 'number'
        ? (offset + items.length) < total
        : items.length >= limit;
    if (context.sessionId) {
        memberListState.set(context.sessionId, {
            offset: offset + items.length,
            limit,
            hasMore,
            total,
            updatedAt: Date.now()
        });
    }

    const { header, body } = formatMemberList(items, offset, total);
    const message = `${header}\n${body}`;
    if (hasMore) {
        return context.source === "discord"
            ? {
                content: `${message}\n\nPakai tombol di bawah ya.`,
                pagination: { kind: "member_list", offset, limit, total, hasMore }
            }
            : `${message}\n\nMau lanjut next?`;
    }
    return context.source === "discord"
        ? {
            content: `${message}\n\nDaftarnya sampai di sini.`,
            pagination: { kind: "member_list", offset, limit, total, hasMore }
        }
        : `${message}\n\nDaftarnya sampai di sini.`;
}

function isNextRequest(text = "") {
    const t = text.trim().toLowerCase();
    if (!t) return false;
    // Stricter regex for pagination: must contain variations of "next" or "daftar selanjutnya"
    // Generic "lagi" can be a search repeat, so we look for "list/daftar/berikutnya" context
    return /\b(next|selanjutnya|halaman berikut|page next)\b/i.test(t) ||
        (/\b(lagi|berikutnya|lanjut)\b/i.test(t) && /\b(daftar|list|anggota|member|semua)\b/i.test(t));
}

function isMemberListRequestStrong(text = "") {
    const t = text.toLowerCase();
    const keywords = /\b(siapa saja|siapa aja|ada siapa|ada siapa saja|ada siapa aja|daftar member|list member|cek member|cek anggota|anggota siapa|member siapa|orang-orang|orang orang|informasikan|informasi|info|kasih tau|beritahu)\b/i;
    const context = /\b(server|sini|ini)\b/i;
    return (
        (keywords.test(t) && context.test(t)) ||
        /\b(daftar|list)\s+(anggota|member)\b/i.test(t)
    );
}

function isMemberListRequestAmbiguous(text = "") {
    const t = text.toLowerCase();
    return /\b(siapa|ada siapa|siapa aja|siapa saja)\b/i.test(t);
}

async function fetchMemberPage(context = {}, offset = 0, limit = DEFAULT_MEMBER_PAGE_SIZE) {
    if (!context.guildId) return null;
    const toolCalls = [{
        id: `call_${Date.now()}`,
        type: "function",
        function: {
            name: "listMembers",
            arguments: JSON.stringify({
                guildId: context.guildId,
                limit,
                offset
            })
        }
    }];
    const toolResults = await handleToolCalls(toolCalls, context);
    return buildDirectToolResponse(toolCalls, toolResults, context);
}

async function tryHandleMemberListRequest(userInput, context = {}) {
    if (!isMemberListRequestStrong(userInput || "")) return null;
    logger.info("Member list request (direct)", {
        guildId: context.guildId || null,
        channelId: context.channelId || null,
        userId: context.userId || null
    });
    const direct = await fetchMemberPage(context, 0, DEFAULT_MEMBER_PAGE_SIZE);
    return direct || null;
}

async function tryHandleMemberPagination(userInput, context = {}) {
    if (!isNextRequest(userInput || "")) return null;
    if (!context.sessionId) return "Belum ada daftar. Coba minta daftar member dulu ya.";
    const state = memberListState.get(context.sessionId);
    if (!state) return "Belum ada daftar. Coba minta daftar member dulu ya.";
    if (!state.hasMore) {
        return "Daftar sudah habis. Tidak ada halaman berikutnya.";
    }
    if (Date.now() - state.updatedAt > MEMBER_LIST_TTL_MS) {
        memberListState.delete(context.sessionId);
        return null;
    }
    logger.info("Member list pagination (text)", {
        guildId: context.guildId || null,
        channelId: context.channelId || null,
        userId: context.userId || null,
        offset: state.offset || 0,
        limit: state.limit || DEFAULT_MEMBER_PAGE_SIZE
    });
    const toolCalls = [{
        id: `call_${Date.now()}`,
        type: "function",
        function: {
            name: "listMembers",
            arguments: JSON.stringify({
                guildId: context.guildId,
                limit: state.limit,
                offset: state.offset
            })
        }
    }];
    const toolResults = await handleToolCalls(toolCalls, context);
    const direct = buildDirectToolResponse(toolCalls, toolResults, context);
    if (!direct) return null;
    if (direct.startsWith("Tidak menemukan data member")) {
        memberListState.set(context.sessionId, {
            offset: state.offset,
            limit: state.limit,
            hasMore: false,
            updatedAt: Date.now()
        });
        return "Daftar sudah habis. Tidak ada halaman berikutnya.";
    }
    return direct;
}

module.exports = {
    runAiAgent,
    SYSTEM_PROMPT,
    extractTrackTitleFromReplyContext,
    isTrackIdentificationPrompt,
    stringifyServerContext,
    tryBuildDirectReplyFromMusicBubble,
    isRuntimeStatusPrompt,
    isYoutubeCookieBotPrompt,
    isMusicLagPrompt,
    isMusicFailurePrompt,
    tryHandleRuntimeSelfDiagnostics,
};
