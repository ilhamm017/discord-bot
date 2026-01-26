// functions/utils/formatting.js

/**
 * Truncate a string to a maximum length and add ellipsis if needed.
 * @param {string} value The string to truncate
 * @param {number} maxLength Maximum length including ellipsis
 * @returns {string} Truncated string
 */
function truncateText(value, maxLength) {
    const text = String(value || "");
    if (text.length <= maxLength) return text;
    return `${text.slice(0, Math.max(0, maxLength - 3))}...`;
}

/**
 * Format seconds into M:SS format.
 * @param {number} totalSeconds Total seconds
 * @returns {string} Formatted string
 */
function formatDuration(totalSeconds) {
    const seconds = Number(totalSeconds);
    if (!Number.isFinite(seconds) || seconds < 0) return "-";

    const minutes = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${minutes}:${String(secs).padStart(2, "0")}`;
}

module.exports = {
    truncateText,
    formatDuration,
};
