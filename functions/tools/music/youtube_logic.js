// functions/tools/music/youtube_logic.js
const play = require("play-dl");
const { search: searchWithYtDlp } = require("../../music/search");
const logger = require("../../../utils/logger");

function normalizeSourceText(value) {
    return String(value || "")
        .normalize("NFKD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .trim();
}

function getChannelText(result) {
    return normalizeSourceText(
        result?.channel?.name ||
        result?.channel?.title ||
        result?.uploader ||
        result?.author?.name ||
        result?.channelName ||
        ""
    );
}

function scoreYoutubeResult(result, query = "") {
    const title = normalizeSourceText(result?.title || "");
    const channel = getChannelText(result);
    const queryText = normalizeSourceText(query);
    let score = 0;

    if (!title) return score;

    if (channel.includes("topic")) score += 35;
    if (title.includes("official audio")) score += 28;
    if (title.includes("audio resmi")) score += 28;
    if (title.includes("lyrics")) score += 8;
    if (title.includes("lyric video")) score += 6;
    if (channel.includes("official")) score += 12;
    if (channel && queryText && queryText.includes(channel)) score += 5;

    if (queryText) {
        const queryTerms = queryText.split(/\s+/).filter(Boolean);
        const matchedTerms = queryTerms.filter((term) => title.includes(term)).length;
        score += matchedTerms * 3;
    }

    if (/\b(remaster|remastered)\b/.test(title)) score += 4;

    if (/\b(live|concert|performance|cover|karaoke|nightcore|slowed|reverb|8d|bass boosted|sped up|remix)\b/.test(title)) {
        score -= 24;
    }
    if (/\b(shorts?)\b/.test(title)) score -= 20;
    if (/\b(tiktok|edit audio|meme)\b/.test(title)) score -= 16;
    if (/\b(fanmade|fan made|amv)\b/.test(title)) score -= 12;

    const durationInSec =
        Number.isFinite(result?.durationInSec) ? result.durationInSec :
            Number.isFinite(result?.durationInSeconds) ? result.durationInSeconds :
                Number.isFinite(result?.duration) ? result.duration :
                    null;

    if (Number.isFinite(durationInSec)) {
        if (durationInSec < 45) score -= 18;
        else if (durationInSec < 90) score -= 8;
        else if (durationInSec > 900) score -= 10;
    }

    return score;
}

function rankYoutubeResults(results, query = "") {
    return (Array.isArray(results) ? results : [])
        .map((result, index) => ({
            result,
            index,
            score: scoreYoutubeResult(result, query),
        }))
        .sort((a, b) => {
            if (b.score !== a.score) return b.score - a.score;
            return a.index - b.index;
        })
        .map((entry) => entry.result);
}

function buildYoutubeSearchVariants(query) {
    const original = String(query || "").trim();
    if (!original) return [];

    const normalized = original
        .normalize("NFKD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[|[\](){}]+/g, " ")
        .replace(/\s+/g, " ")
        .trim();

    const stripped = normalized
        .replace(/\b(lyrics?|lyric video|official audio|official music video|music video|video clip|visualizer|audio)\b/gi, " ")
        .replace(/\s+/g, " ")
        .trim();

    const variants = [
        original,
        normalized,
        stripped,
        stripped ? `${stripped} official audio` : "",
    ].filter(Boolean);

    return [...new Set(variants)];
}

function createDeadline(deadlineAt) {
    if (!Number.isFinite(deadlineAt)) return null;
    return deadlineAt;
}

function isDeadlineExceeded(deadlineAt) {
    return Number.isFinite(deadlineAt) && Date.now() >= deadlineAt;
}

function getRemainingDeadlineMs(deadlineAt) {
    if (!Number.isFinite(deadlineAt)) return null;
    return Math.max(0, deadlineAt - Date.now());
}

function withSearchDeadline(promise, deadlineAt, label = "YOUTUBE_SEARCH") {
    const remainingMs = getRemainingDeadlineMs(deadlineAt);
    if (remainingMs == null) {
        return Promise.resolve(promise);
    }
    if (remainingMs <= 0) {
        const error = new Error(`${label}_TIMEOUT`);
        error.code = "TIMEOUT";
        return Promise.reject(error);
    }

    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            const error = new Error(`${label}_TIMEOUT`);
            error.code = "TIMEOUT";
            reject(error);
        }, remainingMs);

        Promise.resolve(promise)
            .then((value) => {
                clearTimeout(timer);
                resolve(value);
            })
            .catch((error) => {
                clearTimeout(timer);
                reject(error);
            });
    });
}

async function searchYoutubeCandidate(candidate, limit, query, deadlineAt, { searchWithFallback = true } = {}) {
    const tasks = [
        withSearchDeadline(
            searchWithYtDlp(candidate, limit),
            deadlineAt,
            "YOUTUBE_SEARCH"
        ).catch((error) => {
            logger.warn("yt-dlp YouTube search failed.", {
                query: candidate,
                originalQuery: query,
                message: error?.cause?.message || error?.message || String(error),
                stderr: error?.details?.stderr || null,
            });
            if (error?.code === "TIMEOUT" || error?.message === "YOUTUBE_SEARCH_TIMEOUT") {
                throw error;
            }
            return [];
        }),
    ];

    if (searchWithFallback) {
        tasks.push(
            withSearchDeadline(
                play.search(candidate, { limit }),
                deadlineAt,
                "YOUTUBE_SEARCH"
            ).catch((error) => {
                logger.warn("play-dl YouTube search fallback failed.", {
                    query: candidate,
                    originalQuery: query,
                    message: error?.message || String(error),
                });
                if (error?.code === "TIMEOUT" || error?.message === "YOUTUBE_SEARCH_TIMEOUT") {
                    throw error;
                }
                return [];
            })
        );
    }

    const settled = await Promise.allSettled(tasks);
    for (const result of settled) {
        if (result.status === "fulfilled" && Array.isArray(result.value) && result.value.length > 0) {
            return result.value;
        }
    }

    const timeoutFailure = settled.find((result) => (
        result.status === "rejected" &&
        (result.reason?.code === "TIMEOUT" || result.reason?.message === "YOUTUBE_SEARCH_TIMEOUT")
    ));

    if (timeoutFailure) {
        throw timeoutFailure.reason;
    }

    return [];
}

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

async function searchYoutube(query, limit, { searchWithFallback = true, deadlineAt = null } = {}) {
    let youtubeResults = [];
    const queries = buildYoutubeSearchVariants(query).slice(0, 2);
    const activeDeadline = createDeadline(deadlineAt);

    for (const candidate of queries) {
        if (isDeadlineExceeded(activeDeadline)) {
            const timeoutError = new Error("YOUTUBE_SEARCH_TIMEOUT");
            timeoutError.code = "TIMEOUT";
            throw timeoutError;
        }

        youtubeResults = await searchYoutubeCandidate(
            candidate,
            limit,
            query,
            activeDeadline,
            { searchWithFallback }
        );

        if (Array.isArray(youtubeResults) && youtubeResults.length > 0) {
            break;
        }
    }

    const rankedResults = rankYoutubeResults(youtubeResults, query);

    return rankedResults.map(video => ({
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
    buildYoutubeSearchVariants,
    rankYoutubeResults,
    scoreYoutubeResult,
    searchYoutube,
};
