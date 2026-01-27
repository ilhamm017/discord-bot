// functions/tools/music/youtube_logic.js
const play = require("play-dl");
const { search: searchWithYtDlp } = require("../../music/search");

function getYoutubeDurationMs(result) {
    if (!result) return null;
    if (Number.isFinite(result.durationInSec)) {
        return Math.round(result.durationInSec * 1000);
    }
    if (Number.isFinite(result.durationInSeconds)) {
        return Math.round(result.durationInSeconds * 1000);
    }
    if (Number.isFinite(result.duration)) {
        return Math.round(result.duration * 1000);
    }
    return null;
}

async function fetchPlaylistVideos(query) {
    const playlist = await play.playlist_info(query, { incomplete: true });
    const videos = await playlist.all_videos();
    return { title: playlist.title, videos };
}

async function searchYoutube(query, limit, { searchWithFallback = true } = {}) {
    let youtubeResults = [];
    try {
        youtubeResults = await play.search(query, { limit });
    } catch (error) {
        if (!searchWithFallback) throw error;
    }

    if (searchWithFallback && (!Array.isArray(youtubeResults) || youtubeResults.length === 0)) {
        youtubeResults = await searchWithYtDlp(query, limit);
    }

    return (Array.isArray(youtubeResults) ? youtubeResults : []).map(video => ({
        source: "youtube",
        title: video?.title || video?.url,
        url: video?.url || video?.webpage_url || (video?.id ? `https://www.youtube.com/watch?v=${video.id}` : null),
        durationMs: getYoutubeDurationMs(video),
        videoId: video?.id,
        thumbnail: video?.thumbnails?.[0]?.url || video?.thumbnail?.url || null
    })).filter(v => v.url);
}

module.exports = {
    getYoutubeDurationMs,
    fetchPlaylistVideos,
    searchYoutube,
};
