const logger = require("../utils/logger");

/**
 * Analyze the complexity of a user query to determine appropriate model tier
 * @param {string} prompt - The user's input prompt
 * @param {Object} options - Additional context (messages, tools, etc.)
 * @returns {Object} Routing analysis result
 */
function analyzeComplexity(prompt, options = {}) {
    let score = 0;
    const normalizedPrompt = String(prompt || "").toLowerCase().trim();
    const compactPrompt = normalizedPrompt
        .replace(/[!?.,]/g, " ")
        .replace(/\s+/g, " ")
        .trim();

    // 1. Length-based scoring
    const promptLength = normalizedPrompt.length;
    if (promptLength > 2000) {
        score += 3;
    } else if (promptLength > 500) {
        score += 2;
    } else if (promptLength > 100) {
        score += 1;
    }

    // 2. Tool calls indicate complex operations (Only if tools are actually needed/detected, but we can't know for sure)
    // Reducing weight: Just having tools available shouldn't spike complexity.
    // We assume if tools are passed, the agent MIGHT use them. 
    // Let's make it less aggressive.
    if (Array.isArray(options.tools) && options.tools.length > 0) {
        score += 1; // Was 2
    }

    // 3. Keyword detection for complex tasks
    const complexKeywords = [
        'analisis', 'analyze', 'ringkas', 'summarize', 'summary',
        'jelaskan detail', 'explain in detail', 'bandingkan', 'compare',
        'evaluasi', 'evaluate', 'review', 'comprehensive',
        // Music commands need smarter models to avoid roleplaying vs tool use
        'play', 'putar', 'putarkan', 'lagu', 'music', 'dengar', 'nyanyi',
        'sound effect', 'soundboard', 'sfx', 'myinstants'
    ];

    const hasComplexKeyword = complexKeywords.some((kw) => normalizedPrompt.includes(kw));
    if (hasComplexKeyword) {
        score += 1;
    }

    // 4. Message history length
    // Reduced impact: Context is handled by context window, doesn't always need smarter model for simple replies
    const messageCount = Array.isArray(options.messages) ? options.messages.length : 0;
    if (messageCount > 20) {
        score += 1;
    } else if (messageCount > 10) {
        score += 0.5;
    }

    // 5. Map score to tier
    let tier;
    if (score >= 6) {
        tier = 'premium';
    } else if (score >= 4) {
        tier = 'advanced';
    } else if (score >= 2) {
        tier = 'balanced';
    } else {
        tier = 'lightweight';
    }

    // 6. Provider Routing Logic (Regex Enhanced)
    // We use Regex with word boundaries (\b) to avoid false positives (e.g. "banyak" != "ban")

    const musicRegex = /\b(putar|putarkan|puter|putarin|puterin|play|setel|mainkan|lagu|music|nyanyi|dengar|skip|stop|pause|resume|next|prev|queue|antrian|lirik|lyric|song|track|mp3|playlist|shuffle|loop|repeat|semangat|mood|temani|audio|sound\s*effect|soundboard|sfx|efek\s+suara|myinstants?)\b/i;
    const searchRegex = /\b(cari|cariin|search|google|berita|terbaru|apa itu|siapa itu|crypto|harga|cuaca|weather|info|news|fakta|fact|definisi|artinya|kurs|saham|stock|internet)\b/i;
    const factualWhoRegex = /\bsiapa\b.*\b(presiden|menteri|ceo|pendiri|penemu|aktor|penyanyi|ibukota|ibu kota|negara|kota|tokoh)\b/i;
    const historyRegex = /\b(chat|pesan|tadi|bahas apa|ngomong apa|riwayat|history|kemarin|tadi pagi|semalam|barusan|last message|msg|context|konteks|sebelumnya|dulu|salah|kesalahan|kenapa|ngapain)\b/i;
    const memberRegex = /\b(profil|role|pangkat|member|user|anggota|daftar member|lokasi member|jejak member|jointime|avatar|pfp|pp|foto profil|status member|activity|siapa saja|ada siapa|jumlah member|username)\b/i;
    const memberContextRegex = /\bsiapa\b.*\b(member|anggota|online|di server|di sini)\b/i;
    const modRegex = /\b(hapus|delete|ban|kick|timeout|mute|warn|peringatan|unban|unmute|clear|purge|bersihkan|nuke|prune|slowmode|lock|unlock)\b/i;
    const reminderRegex = /\b(ingat|remind|nanti jam|besok|lusa|minggu depan|bulan depan|tahun depan|set reminder|alarm|timer|jadwal|schedule|agenda)\b/i;
    const gameRegex = /\b(tebak|teka-teki|riddle|puzzle|kuis|tebak-tebakan|permainan|jawab|siapakah aku|apa aku|tebak siapa)\b/i;
    const statsRegex = /\b(limit|token|stats|status ai|ping|latency|uptime|memory|cpu|usage|quota|kredit|credit|health|info bot|data)\b/i;
    const socialRegex = /\b(bilang|bilangin|sampaikan|ucapkan|tanya|tanyain|panggil|greet|message|send|kirim|bisikin|bisik|katakan|kata|kasih tau|beritahukan)\b/i;
    const commandLikeRegex = /\b(putar|putarkan|play|skip|stop|pause|resume|ban|kick|timeout|hapus|delete|remind|ingatkan|cari|search|ringkas|rangkum|member|profil|role|join|leave|queue|antrian|kontrol|ucapkan|bilang|kirim|sound\s*effect|sfx|myinstants?)\b/i;

    let provider = 'groq'; // Default for general chat
    let intent = 'general';

    const wordCount = compactPrompt ? compactPrompt.split(/\s+/).length : 0;
    const hasDirectMention = /<@!?\d+>/.test(normalizedPrompt);

    // 6. Bot Question Detection & Intent Flags
    const lastAssistantMsg = [...(options.messages || [])].reverse().find(m => m.role === 'assistant')?.content || "";
    const lastAssistantMsgLower = String(lastAssistantMsg || "").toLowerCase();
    const isReplyingToQuestion = lastAssistantMsgLower.includes('?') || /mau|apa|siapa|cari|judul/i.test(lastAssistantMsgLower);

    const acknowledgementRegex = /\b(makasih|terima kasih|thanks|thank you|ok|oke|siap|sip|paham|mengerti|done|sudah|ya|iya|ga|gak|tidak|no|yes|gpp|gapapa|test|testing|halo|haloo|hai|hi|p|nurut|setuju|ikut)\b/i;
    const acknowledgementPhrases = new Set([
        "makasih",
        "terima kasih",
        "thanks",
        "thank you",
        "ok",
        "oke",
        "siap",
        "sip",
        "paham",
        "mengerti",
        "done",
        "sudah",
        "ya",
        "iya",
        "ga",
        "gak",
        "tidak",
        "no",
        "yes",
        "gpp",
        "gapapa",
        "test",
        "testing",
        "halo",
        "haloo",
        "hai",
        "hi",
        "p",
        "nurut",
        "setuju",
        "ikut",
    ]);

    // Check for repetitive "test test" or similar simple phrases
    const cleanPrompt = compactPrompt;
    const uniqueWords = new Set(cleanPrompt.split(/\s+/));
    const isRepetitiveSimple =
        cleanPrompt.length > 0 &&
        uniqueWords.size === 1 &&
        wordCount <= 3 &&
        acknowledgementRegex.test(cleanPrompt);

    const isCommandLike = commandLikeRegex.test(normalizedPrompt);
    const isAcknowledgement =
        ((acknowledgementRegex.test(normalizedPrompt) && wordCount <= 2) ||
            isRepetitiveSimple ||
            acknowledgementPhrases.has(compactPrompt)) &&
        !isCommandLike;

    // Explicit flags for data filtering
    let needsHistory = historyRegex.test(normalizedPrompt);
    const needsMentions = /(@|mention|panggil|tentang)/i.test(normalizedPrompt);

    const isMusic = musicRegex.test(normalizedPrompt);
    const isSearch =
        (searchRegex.test(normalizedPrompt) || factualWhoRegex.test(normalizedPrompt)) &&
        !/\b(kamu|aku|kita)\b/i.test(normalizedPrompt); // Avoid searching for users/persona
    const isMember = memberRegex.test(normalizedPrompt) || memberContextRegex.test(normalizedPrompt);
    const isMod = modRegex.test(normalizedPrompt);
    const isGame = gameRegex.test(normalizedPrompt);
    const isReminder = reminderRegex.test(normalizedPrompt);
    const isStats = statsRegex.test(normalizedPrompt);
    const isSocial = socialRegex.test(normalizedPrompt);

    const intentSignals = {
        music: isMusic,
        search: isSearch,
        social: isSocial,
        member: isMember,
        moderation: isMod,
        reminder: isReminder,
        stats: isStats,
        game: isGame,
    };
    const matchedIntents = Object.entries(intentSignals)
        .filter(([, matched]) => matched)
        .map(([name]) => name);
    let isAmbiguous = matchedIntents.filter((name) => name !== "game").length > 1;

    let routingConfidence = 0.45;
    if (matchedIntents.length === 1) routingConfidence = 0.9;
    if (matchedIntents.length > 1) routingConfidence = 0.6;
    if (isAcknowledgement) routingConfidence = Math.min(routingConfidence, 0.5);
    if (hasDirectMention && isSocial) routingConfidence = Math.min(1, routingConfidence + 0.1);
    if (wordCount <= 2 && matchedIntents.length === 0) {
        routingConfidence = Math.min(routingConfidence, 0.35);
    }

    let needsTool = (isMusic || isSearch || isMember || isMod || isReminder || isStats || isSocial) && !isGame;

    // Intent Inheritance/Override:
    // If the prompt is short and we are replying to a question, check if the PREVIOUS intent was something specific.
    // Skip this if it's just a simple acknowledgment ("thanks", "ok")
    if (!needsTool && !isGame && wordCount <= 5 && isReplyingToQuestion && !isAcknowledgement) {
        if (musicRegex.test(lastAssistantMsgLower)) {
            intent = 'music';
            needsTool = true;
            provider = 'groq';
            needsHistory = true; // Force history to understand the reply
            routingConfidence = Math.max(routingConfidence, 0.7);
        } else if (searchRegex.test(lastAssistantMsgLower) && !/setan|hantu|canda/i.test(normalizedPrompt)) {
            // Only inherit search if it's not a jokey follow up
            intent = 'search';
            needsTool = true;
            provider = 'groq';
            needsHistory = true;
            routingConfidence = Math.max(routingConfidence, 0.7);
        } else if (memberRegex.test(lastAssistantMsgLower)) {
            intent = 'member';
            needsTool = true;
            provider = 'groq';
            needsHistory = true;
            routingConfidence = Math.max(routingConfidence, 0.7);
        }
    }

    // Prioritize routing
    if (isGame) {
        intent = 'game';
        provider = 'groq';
        tier = 'advanced'; // Riddles need better reasoning
        needsTool = false;
        needsHistory = true;
    }
    else if (isMusic) {
        intent = 'music';
        provider = 'groq';
        tier = 'balanced';
    }
    else if (isSearch) { intent = 'search'; provider = 'groq'; }
    else if (isSocial) {
        intent = 'social';
        provider = 'groq';
        tier = 'balanced'; // Social needs reliability
    }
    else if (isMember) { intent = 'member'; provider = 'groq'; }
    else if (isMod) { intent = 'moderation'; provider = 'groq'; }
    else if (isReminder) { intent = 'reminder'; provider = 'groq'; }
    else if (isStats) { intent = 'stats'; provider = 'groq'; }
    else if (needsHistory && intent === 'general') {
        // Only set intent to 'history' if it's not already pinned to something more specific
        intent = 'history';
        provider = 'groq';
    }

    if (isAcknowledgement) {
        needsTool = false;
        if (intent !== "history") intent = "general";
        isAmbiguous = false;
    }

    // Force history if it's a short reply in a thread (likely needs context)
    // BUT: Skip if it's a simple acknowledgment or has direct mention
    if (!needsHistory && wordCount <= 3 && options.messages?.length > 1 && !hasDirectMention && !isAcknowledgement) {
        needsHistory = true;
        if (intent === 'general') {
            intent = 'history';
        }
    }

    // Special Case: Social commands with direct mentions "bilang hai ke @user" 
    // are often standalone commands. 
    if (intent === 'social' && hasDirectMention && !historyRegex.test(normalizedPrompt)) {
        needsHistory = false;
    }

    // Final provider override for random chat (no history/context)
    const STALE_THRESHOLD_MS = 15 * 60 * 1000;
    const lastRelevantMsg = (options.messages || []).filter(m => m.role !== 'system').slice(-1)[0];
    const isStale = lastRelevantMsg?.timestamp && (Date.now() - lastRelevantMsg.timestamp > STALE_THRESHOLD_MS);

    const isTrulyFresh = !options.isReply && !needsHistory && !isReplyingToQuestion && (isStale || options.messages?.length <= 1 || intent === 'general');

    if (intent === 'general' && isTrulyFresh) {
        // Only use Google if it's REALLY just a simple new message without mentions
        if (!needsMentions) {
            provider = 'google';
            tier = 'lightweight';
        } else {
            // Social requests (mentions) need better JSON reliability than Allam-7b
            provider = 'groq';
            tier = 'balanced';
        }
    }

    if (isAmbiguous && needsTool) {
        // Conservative fallback: keep provider reliable and avoid low-tier under-routing.
        provider = "groq";
        if (tier === "lightweight") tier = "balanced";
    }

    logger.debug(
        `Complexity analysis: score=${score}, tier=${tier}, provider=${provider}, intent=${intent}, ` +
        `needsHistory=${needsHistory}, needsTool=${needsTool}, ambiguous=${isAmbiguous}, ` +
        `confidence=${routingConfidence.toFixed(2)}, matches=${matchedIntents.join(",") || "none"}`
    );

    return {
        tier,
        provider,
        intent,
        needsHistory,
        needsMentions,
        needsTool,
        isReplyingToQuestion,
        isAmbiguous,
        routingConfidence,
        matchedIntents,
    };
}

module.exports = {
    analyzeComplexity
};
