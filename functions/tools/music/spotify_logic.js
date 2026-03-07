// functions/tools/music/spotify_logic.js
const {
    fetchSpotifyCollection,
    resolveSpotifyTracks,
} = require("../../../utils/common/spotify");

async function resolveSpotify(spotifyRef) {
    const collection = await fetchSpotifyCollection(spotifyRef);
    if (!collection.tracks.length) {
        return { collection, tracks: [] };
    }

    const resolved = await resolveSpotifyTracks(collection.tracks);
    const tracks = resolved.resolved.map((item) => ({
        url: item.url,
        title: item.title || item.url,
        source: "spotify",
        youtubeVideoId: item.youtubeVideoId || null,
        originalUrl: item.originalUrl || item.url,
    }));

    return {
        collection,
        tracks,
        failedCount: resolved.failed.length
    };
}

module.exports = { resolveSpotify };
