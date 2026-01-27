const logger = require("../../utils/logger");

/**
 * Analyze the complexity of a user query to determine appropriate model tier
 * @param {string} prompt - The user's input prompt
 * @param {Object} options - Additional context (messages, tools, etc.)
 * @returns {string} - Tier name: 'lightweight', 'balanced', 'advanced', or 'premium'
 */
function analyzeComplexity(prompt, options = {}) {
    let score = 0;

    // 1. Length-based scoring
    const promptLength = prompt?.length || 0;
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
        'play', 'putar', 'lagu', 'music', 'dengar', 'nyanyi'
    ];

    const promptLower = prompt?.toLowerCase() || '';
    const hasComplexKeyword = complexKeywords.some(kw => promptLower.includes(kw));
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

    const musicRegex = /\b(putar|puter|putarin|puterin|play|setel|lagu|music|nyanyi|dengar|skip|stop|pause|resume|next|prev|queue|antrian|lirik|lyric|song|track|mp3|playlist|shuffle|loop|repeat|semangat|mood|temani|audio)\b/i;
    const searchRegex = /\b(cari|cariin|search|google|berita|terbaru|apa itu|crypto|harga|cuaca|weather|info|news|fakta|fact|definisi|artinya|kurs|saham|stock|internet)\b/i;
    const historyRegex = /\b(chat|pesan|tadi|bahas apa|ngomong apa|riwayat|history|kemarin|tadi pagi|semalam|barusan|last message|msg|context|konteks|sebelumnya|dulu|salah|kesalahan|kenapa|ngapain)\b/i;
    const memberRegex = /\b(profil|role|pangkat|member|user|anggota|daftar|panggil|siapa|lokasi|di mana|dimana|posisi|jejak|situasi|jointime|join|avatar|pfp|pp|foto|status|activity|siapa saja|ada siapa|jumlah|adakah|kenal|tahu|username|orang)\b/i;
    const modRegex = /\b(hapus|delete|ban|kick|timeout|mute|warn|peringatan|unban|unmute|clear|purge|bersihkan|nuke|prune|slowmode|lock|unlock)\b/i;
    const reminderRegex = /\b(ingat|remind|nanti jam|besok|lusa|minggu depan|bulan depan|tahun depan|set reminder|alarm|timer|jadwal|schedule|agenda)\b/i;
    const gameRegex = /\b(tebak|teka-teki|riddle|puzzle|kuis|tebak-tebakan|permainan|jawab|siapakah aku|apa aku|tebak siapa)\b/i;
    const statsRegex = /\b(limit|token|stats|status ai|ping|latency|uptime|memory|cpu|usage|quota|kredit|credit|health|info bot|data)\b/i;
    const socialRegex = /\b(bilang|bilangin|sampaikan|ucapkan|tanya|tanyain|panggil|greet|message|send|kirim|bisikin|bisik|katakan|kata|kasih tau|beritahukan)\b/i;

    let provider = 'groq'; // Default for general chat
    let intent = 'general';

    const wordCount = prompt.split(/\s+/).length;
    const hasDirectMention = /<@!?\d+>/.test(prompt);

    // 6. Bot Question Detection & Intent Flags
    const lastAssistantMsg = [...(options.messages || [])].reverse().find(m => m.role === 'assistant')?.content || "";
    const isReplyingToQuestion = lastAssistantMsg.includes('?') || /mau|apa|siapa|cari|judul/i.test(lastAssistantMsg);

    const acknowledgementRegex = /\b(makasih|terima kasih|thanks|thank you|ok|oke|siap|sip|paham|mengerti|done|sudah|ya|iya|ga|gak|tidak|no|yes|gpp|gapapa|test|testing|halo|haloo|hai|hi|p|ping|nurut|setuju|ikut|paham|mengerti)\b/i;

    // Check for repetitive "test test" or similar simple phrases
    const cleanPrompt = prompt.toLowerCase().trim();
    const uniqueWords = new Set(cleanPrompt.split(/\s+/));
    const isRepetitiveSimple = uniqueWords.size === 1 && wordCount <= 3 && acknowledgementRegex.test(cleanPrompt);

    const isAcknowledgement = (acknowledgementRegex.test(prompt) && wordCount <= 2) || isRepetitiveSimple;

    // Explicit flags for data filtering
    let needsHistory = historyRegex.test(prompt);
    const needsMentions = /(@|mention|panggil|siapa|tentang)/i.test(prompt);

    const isMusic = musicRegex.test(prompt);
    const isSearch = searchRegex.test(prompt) && !/\b(siapa|kamu|aku|kita)\b/i.test(prompt); // Avoid searching for users/persona
    const isMember = memberRegex.test(prompt);
    const isMod = modRegex.test(prompt);
    const isGame = gameRegex.test(prompt);
    const isReminder = reminderRegex.test(prompt);
    const isStats = statsRegex.test(prompt);
    const isSocial = socialRegex.test(prompt);

    let needsTool = (isMusic || isSearch || isMember || isMod || isReminder || isStats || isSocial) && !isGame;

    // Intent Inheritance/Override:
    // If the prompt is short and we are replying to a question, check if the PREVIOUS intent was something specific.
    // Skip this if it's just a simple acknowledgment ("thanks", "ok")
    if (!needsTool && !isGame && wordCount <= 5 && isReplyingToQuestion && !isAcknowledgement) {
        if (musicRegex.test(lastAssistantMsg)) {
            intent = 'music';
            needsTool = true;
            provider = 'groq';
            needsHistory = true; // Force history to understand the reply
        } else if (searchRegex.test(lastAssistantMsg) && !/setan|hantu|canda/i.test(prompt)) {
            // Only inherit search if it's not a jokey follow up
            intent = 'search';
            needsTool = true;
            provider = 'groq';
            needsHistory = true;
        } else if (memberRegex.test(lastAssistantMsg)) {
            intent = 'member';
            needsTool = true;
            provider = 'groq';
            needsHistory = true;
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
        // Keep intent as general or whatever it matched, but disable tools
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
    if (intent === 'social' && hasDirectMention && !historyRegex.test(prompt)) {
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

    logger.debug(`Complexity analysis: score=${score}, tier=${tier}, provider=${provider}, intent=${intent}, needsHistory=${needsHistory}, needsTool=${needsTool}`);

    return { tier, provider, intent, needsHistory, needsMentions, needsTool, isReplyingToQuestion };
}

module.exports = {
    analyzeComplexity
};
