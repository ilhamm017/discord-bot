const {
    searchWithYtDlp,
    getInfoWithYtDlp,
} = require("../../utils/common/ytdlp");

async function search(query, limit = 5) {
    return searchWithYtDlp(query, limit);
}

async function getInfo(url) {
    return getInfoWithYtDlp(url);
}

module.exports = {
    search,
    getInfo,
};
