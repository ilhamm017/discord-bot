// functions/tools/music/favorites_logic.js
const { getFavoriteTracks } = require("../../../storage/db");

async function getFavorites(userId, { minPlays = 5, limit = 20 } = {}) {
    const favorites = await getFavoriteTracks(userId, {
        minPlays,
        limit,
    });

    return favorites.map((item) => ({
        url: item.url,
        title: item.title || item.url,
    }));
}

module.exports = { getFavorites };
