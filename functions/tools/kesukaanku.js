// functions/tools/kesukaanku.js
// Reusable utilities for the kesukaanku tool

/** Truncate a string to a maximum length, adding ellipsis if needed */
function truncateText(value, maxLength) {
    const text = String(value || "");
    if (text.length <= maxLength) return text;
    return `${text.slice(0, Math.max(0, maxLength - 3))}...`;
}

/** Extract YouTube video ID from a URL or return null */
function extractVideoId(input) {
    if (!input || typeof input !== "string") return null;
    const match = input.match(/[?&]v=([a-zA-Z0-9_-]{11})/);
    if (match) return match[1];
    const shortMatch = input.match(/youtu\.be\/([a-zA-Z0-9_-]{11})/);
    if (shortMatch) return shortMatch[1];
    return null;
}

module.exports = { truncateText, extractVideoId };
