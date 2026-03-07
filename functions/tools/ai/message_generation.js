// functions/tools/ai/message_generation.js
const { chatCompletion } = require("../../../ai/completion");

function sanitizeMessage(text) {
    if (!text) return "";
    return text.trim();
}

function isUsefulContext(content, { minWords = 3, minLetters = 6 } = {}) {
    const cleaned = String(content || "").replace(/\s+/g, " ").trim();
    if (!cleaned) return false;
    const words = cleaned.split(" ").filter(Boolean);
    if (words.length < minWords) return false;
    const letters = (cleaned.match(/[A-Za-z]/g) || []).length;
    return letters >= minLetters;
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
    const letters = (cleaned.match(/[A-Za-z]/g) || []).length;
    if (!letters) return true;
    const ratio = letters / cleaned.length;
    return ratio < 0.25;
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

function replaceGenericCall(text, callName) {
    if (!callName) return text;
    if (typeof text !== "string") return "";
    return text.replace(/\bbro\b/gi, callName);
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

async function generateAiMessage(options) {
    const {
        systemPrompt,
        userPrompt,
        temperature = 0.3,
        maxTokens = 160,
        fallbackPrompt = null,
        rawRequest = ""
    } = options;

    let content;
    content = await chatCompletion({
        system: systemPrompt,
        user: userPrompt,
        temperature,
        maxTokens,
    });

    if (fallbackPrompt && isMessyOutput(content)) {
        content = await chatCompletion({
            system: `${systemPrompt} ${fallbackPrompt}`,
            user: `Permintaan: "${rawRequest}". Balas hanya teks.`,
            temperature: 0.1,
            maxTokens: 120,
        });
    }

    return content;
}

module.exports = {
    sanitizeMessage,
    isUsefulContext,
    isMessyOutput,
    getShortName,
    replaceGenericCall,
    sanitizeCallName,
    generateAiMessage,
};
