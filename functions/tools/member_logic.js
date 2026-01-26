// functions/tools/member_logic.js

function parseLimit(value, fallback = 5) {
    const num = Number.parseInt(value, 10);
    if (Number.isInteger(num) && num > 0) {
        return Math.min(num, 20);
    }
    return fallback;
}

function formatMemberData(member) {
    return {
        displayName: member.displayName || member.user?.username || "unknown",
        tag: member.user?.tag || member.user?.username || "unknown",
        joinedAt: member.joinedAt ? member.joinedAt.toISOString().slice(0, 10) : "unknown",
        joinedTimestamp: member.joinedAt ? member.joinedAt.getTime() : 0
    };
}

function formatMemberLine(data, index) {
    return `${index}. ${data.displayName} (${data.tag}) — join ${data.joinedAt}`;
}

function getSortedMembers(memberList, { type = "awal", limit = 5 } = {}) {
    // memberList should be an array of formatted member data
    const sorted = [...memberList].filter(m => m.joinedTimestamp > 0);

    if (["awal", "pertama", "lama", "oldest"].includes(type)) {
        sorted.sort((a, b) => a.joinedTimestamp - b.joinedTimestamp);
    } else if (["baru", "terbaru", "newest"].includes(type)) {
        sorted.sort((a, b) => b.joinedTimestamp - a.joinedTimestamp);
    } else {
        // default "daftar" or "list"
        sorted.sort((a, b) => a.joinedTimestamp - b.joinedTimestamp);
    }

    return sorted.slice(0, limit);
}

module.exports = {
    parseLimit,
    formatMemberData,
    formatMemberLine,
    getSortedMembers,
};
