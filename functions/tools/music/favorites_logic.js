// functions/tools/music/favorites_logic.js
const { getFavoriteTracks } = require("../../../storage/db");

function getFavorites(userId, { minPlays = 5, limit = 20 } = {}) {
    const favorites = getFavoriteTracks(userId, {
        minPlays,
        limit,
    });

    return favorites.map((item) => ({
        url: item.url,
        title: item.title || item.url,
    }));
}

module.exports = { getFavorites };
