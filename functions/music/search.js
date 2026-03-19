const {
    searchWithYtDlp,
    getInfoWithYtDlp,
} = require("../../utils/common/ytdlp");

async function search(query, limit = 5) {
    return searchWithYtDlp(query, limit);
}

async function getInfo(url, options = {}) {
    return getInfoWithYtDlp(url, options);
}

module.exports = {
    search,
    getInfo,
};
