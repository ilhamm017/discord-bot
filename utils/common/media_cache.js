const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { Readable } = require("stream");
const { pipeline } = require("stream/promises");
const play = require("play-dl");
const logger = require("../logger");
const { downloadAudioToFile } = require("./ytdlp");

const DEFAULT_CACHE_HOST = "127.0.0.1";
const DEFAULT_CACHE_PORT = 3211;
let config = {};
try {
    config = require(path.join(process.cwd(), "config.json"));
} catch (error) {
    config = {};
}

const DOWNLOAD_CONCURRENCY = (() => {
    const configured =
        Number(process.env.AUDIO_CACHE_DOWNLOAD_CONCURRENCY) ||
        Number(config.audio_cache_download_concurrency);
    if (Number.isInteger(configured) && configured > 0) {
        return Math.min(configured, 4);
    }
    return 2;
})();

const pendingDownloads = new Map(); // videoId -> Promise
const downloadQueue = [];
let activeDownloads = 0;

function getAudioCacheRoot() {
    return process.env.AUDIO_CACHE_DIR || path.join(process.cwd(), ".data", "audio-cache");
}

function getAudioCacheHost() {
    return process.env.AUDIO_CACHE_HOST || DEFAULT_CACHE_HOST;
}

function getAudioCachePort() {
    const port = Number(process.env.AUDIO_CACHE_PORT || DEFAULT_CACHE_PORT);
    return Number.isInteger(port) && port > 0 ? port : DEFAULT_CACHE_PORT;
}

function ensureAudioCacheDir() {
    const dir = getAudioCacheRoot();
    fs.mkdirSync(dir, { recursive: true });
    return dir;
}

function isValidVideoId(videoId) {
    return typeof videoId === "string" && /^[a-zA-Z0-9_-]{6,32}$/.test(videoId);
}

function extractYoutubeVideoId(input) {
    if (!input) return null;
    if (isValidVideoId(input)) return input;

    try {
        const parsed = play.extractID(String(input));
        return isValidVideoId(parsed) ? parsed : null;
    } catch (error) {
        return null;
    }
}

function findCachedFilePath(videoId) {
    if (!isValidVideoId(videoId)) return null;
    const dir = ensureAudioCacheDir();
    const prefix = `${videoId}.`;

    try {
        const candidates = fs.readdirSync(dir)
            .filter((name) => name.startsWith(prefix) && !name.endsWith(".part"))
            .sort();
        if (candidates.length === 0) return null;
        return path.join(dir, candidates[0]);
    } catch (error) {
        return null;
    }
}

function buildCachedTrackUrl(videoId) {
    return `http://${getAudioCacheHost()}:${getAudioCachePort()}/audio-cache/${encodeURIComponent(videoId)}`;
}

function getCachedTrackUrl(videoId) {
    const filePath = findCachedFilePath(videoId);
    if (!filePath) return null;
    return buildCachedTrackUrl(videoId);
}

function getRemoteAudioCacheKey(prefix, sourceUrl) {
    const safePrefix = String(prefix || "").trim().toLowerCase();
    const safeUrl = String(sourceUrl || "").trim();
    if (!safePrefix || !safeUrl) return null;
    const digest = crypto.createHash("sha1").update(safeUrl).digest("hex").slice(0, 16);
    return `${safePrefix}_${digest}`;
}

function getMyInstantsCacheKey(trackOrUrl) {
    const sourceUrl = typeof trackOrUrl === "string"
        ? trackOrUrl
        : trackOrUrl?.originalUrl || trackOrUrl?.originUrl || trackOrUrl?.url || "";
    if (!sourceUrl || !/myinstants\.com/i.test(sourceUrl)) {
        return null;
    }
    return getRemoteAudioCacheKey("myi", sourceUrl);
}

function markYoutubeTrack(track, options = {}) {
    if (!track || typeof track !== "object") return track;

    const sourceUrl = options.sourceUrl || track.originalUrl || track.originUrl || track.url;
    const youtubeVideoId = options.youtubeVideoId || track.youtubeVideoId || extractYoutubeVideoId(sourceUrl);
    if (!youtubeVideoId) return track;

    const nextTrack = {
        ...track,
        source: "youtube",
        youtubeVideoId,
        originalUrl: sourceUrl,
    };

    const cachedUrl = getCachedTrackUrl(youtubeVideoId);
    if (cachedUrl) {
        nextTrack.cachedUrl = cachedUrl;
    } else if ("cachedUrl" in nextTrack) {
        delete nextTrack.cachedUrl;
    }

    return nextTrack;
}

function getPlaybackUrlForTrack(track) {
    return getPlaybackSourceInfo(track).url;
}

function getPlaybackSourceInfo(track) {
    if (!track || typeof track !== "object") {
        return { url: null, mode: "none", cacheKey: null };
    }

    const youtubeVideoId = track.youtubeVideoId || extractYoutubeVideoId(track.originalUrl || track.url);
    if (youtubeVideoId) {
        const cachedUrl = getCachedTrackUrl(youtubeVideoId);
        if (cachedUrl) {
            return { url: cachedUrl, mode: "cache", cacheKey: youtubeVideoId };
        }
    }

    if (track?.source === "myinstants") {
        const cacheKey = track.cacheKey || getMyInstantsCacheKey(track);
        if (cacheKey) {
            const cachedUrl = getCachedTrackUrl(cacheKey);
            if (cachedUrl) {
                return { url: cachedUrl, mode: "cache", cacheKey };
            }
        }
    }

    return {
        url: track.originalUrl || track.originUrl || track.url || null,
        mode: "remote",
        cacheKey: youtubeVideoId || track.cacheKey || getMyInstantsCacheKey(track) || null,
    };
}

function cleanupPartialFiles(videoId) {
    const dir = ensureAudioCacheDir();
    const prefix = `${videoId}.`;

    try {
        for (const name of fs.readdirSync(dir)) {
            if (!name.startsWith(prefix)) continue;
            if (!name.endsWith(".part") && !name.endsWith(".ytdl")) continue;
            fs.unlinkSync(path.join(dir, name));
        }
    } catch (error) {
        logger.debug("Failed cleaning partial audio cache files.", {
            videoId,
            message: error?.message || String(error),
        });
    }
}

async function downloadYoutubeTrack(videoId, sourceUrl) {
    const dir = ensureAudioCacheDir();
    const outputTemplate = path.join(dir, `${videoId}.%(ext)s`);
    const existing = findCachedFilePath(videoId);
    if (existing) return existing;

    cleanupPartialFiles(videoId);
    const filePath = await downloadAudioToFile(sourceUrl, outputTemplate);
    return filePath;
}

function getExtensionFromContentType(contentType) {
    const normalized = String(contentType || "").toLowerCase();
    if (normalized.includes("audio/mpeg") || normalized.includes("audio/mp3")) return ".mp3";
    if (normalized.includes("audio/ogg") || normalized.includes("audio/opus")) return ".ogg";
    if (normalized.includes("audio/wav") || normalized.includes("audio/x-wav")) return ".wav";
    if (normalized.includes("audio/aac")) return ".aac";
    if (normalized.includes("audio/mp4") || normalized.includes("audio/x-m4a")) return ".m4a";
    if (normalized.includes("audio/webm")) return ".webm";
    return null;
}

function getExtensionFromUrl(sourceUrl) {
    try {
        const parsed = new URL(String(sourceUrl || ""));
        const ext = path.extname(parsed.pathname || "").toLowerCase();
        if (!ext) return null;
        if (/^\.[a-z0-9]{2,5}$/i.test(ext)) {
            return ext;
        }
    } catch (error) {
        return null;
    }
    return null;
}

async function downloadHttpTrack(cacheKey, sourceUrl) {
    const dir = ensureAudioCacheDir();
    const existing = findCachedFilePath(cacheKey);
    if (existing) return existing;

    cleanupPartialFiles(cacheKey);

    const response = await fetch(sourceUrl, {
        headers: {
            "user-agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
            "accept": "audio/*,*/*;q=0.8",
        },
    });
    if (!response.ok || !response.body) {
        throw new Error(`HTTP_AUDIO_DOWNLOAD_FAILED_${response.status}`);
    }

    const ext =
        getExtensionFromContentType(response.headers.get("content-type")) ||
        getExtensionFromUrl(sourceUrl) ||
        ".bin";
    const tempPath = path.join(dir, `${cacheKey}.part`);
    const finalPath = path.join(dir, `${cacheKey}${ext}`);

    try {
        const bodyStream = Readable.fromWeb(response.body);
        await pipeline(bodyStream, fs.createWriteStream(tempPath));
        fs.renameSync(tempPath, finalPath);
        return finalPath;
    } catch (error) {
        try {
            if (fs.existsSync(tempPath)) {
                fs.unlinkSync(tempPath);
            }
        } catch (cleanupError) {
            logger.debug("Failed cleaning partial HTTP audio cache file.", {
                cacheKey,
                message: cleanupError?.message || String(cleanupError),
            });
        }
        throw error;
    }
}

async function runNextDownload() {
    if (activeDownloads >= DOWNLOAD_CONCURRENCY) return;
    const next = downloadQueue.shift();
    if (!next) return;

    activeDownloads += 1;
    const { videoId, sourceUrl, downloader, resolve, reject, label } = next;

    try {
        const filePath = await downloader(videoId, sourceUrl);
        logger.info(`Audio cache ready for ${label || `track ${videoId}`}.`, { filePath });
        resolve(filePath);
    } catch (error) {
        const causeMessage = error?.cause?.message || null;
        logger.warn(
            `Audio cache download failed for ${label || `track ${videoId}`}. ` +
            `${causeMessage || error?.message || "unknown error"}`,
            error
        );
        reject(error);
    } finally {
        pendingDownloads.delete(videoId);
        activeDownloads -= 1;
        if (downloadQueue.length > 0) {
            queueMicrotask(() => {
                runNextDownload().catch((error) => {
                    logger.warn("Audio cache queue processing failed.", error);
                });
            });
        }
    }
}

function queueDownload(videoId, sourceUrl, options = {}) {
    const promise = new Promise((resolve, reject) => {
        downloadQueue.push({
            videoId,
            sourceUrl,
            downloader: options.downloader || downloadYoutubeTrack,
            label: options.label || null,
            resolve,
            reject,
        });
        queueMicrotask(() => {
            runNextDownload().catch((error) => {
                logger.warn("Audio cache queue processing failed.", error);
            });
        });
    });

    pendingDownloads.set(videoId, promise);
    return promise;
}

function primeYoutubeTrack(track) {
    if (!track || typeof track !== "object") return null;

    const sourceUrl = track.originalUrl || track.originUrl || track.url;
    const videoId = track.youtubeVideoId || extractYoutubeVideoId(sourceUrl);
    if (!videoId || !sourceUrl) {
        logger.debug("Audio cache prime skipped: missing YouTube metadata.", {
            videoId: videoId || null,
            url: sourceUrl || track.url || null,
            title: track.title || null,
        });
        return null;
    }

    if (findCachedFilePath(videoId)) {
        logger.info(`Audio cache hit for YouTube track ${videoId}.`, {
            filePath: findCachedFilePath(videoId),
        });
        return Promise.resolve(findCachedFilePath(videoId));
    }

    const existingPromise = pendingDownloads.get(videoId);
    if (existingPromise) {
        logger.debug(`Audio cache prime already queued for YouTube track ${videoId}.`);
        return existingPromise;
    }

    logger.info(`Queueing audio cache prime for YouTube track ${videoId}.`, {
        title: track.title || null,
        url: sourceUrl,
    });

    return queueDownload(videoId, sourceUrl);
}

function primeMyInstantsTrack(track) {
    if (!track || typeof track !== "object") return null;

    const sourceUrl = track.originalUrl || track.originUrl || track.url;
    const cacheKey = track.cacheKey || getMyInstantsCacheKey(track);
    if (!cacheKey || !sourceUrl) {
        logger.debug("Audio cache prime skipped: missing MyInstants metadata.", {
            cacheKey: cacheKey || null,
            url: sourceUrl || track.url || null,
            title: track.title || null,
        });
        return null;
    }

    if (findCachedFilePath(cacheKey)) {
        logger.info(`Audio cache hit for MyInstants track ${cacheKey}.`, {
            filePath: findCachedFilePath(cacheKey),
        });
        return Promise.resolve(findCachedFilePath(cacheKey));
    }

    const existingPromise = pendingDownloads.get(cacheKey);
    if (existingPromise) {
        logger.debug(`Audio cache prime already queued for MyInstants track ${cacheKey}.`);
        return existingPromise;
    }

    logger.info(`Queueing audio cache prime for MyInstants track ${cacheKey}.`, {
        title: track.title || null,
        url: sourceUrl,
    });

    return queueDownload(cacheKey, sourceUrl, {
        downloader: downloadHttpTrack,
        label: `MyInstants track ${cacheKey}`,
    });
}

module.exports = {
    buildCachedTrackUrl,
    ensureAudioCacheDir,
    extractYoutubeVideoId,
    findCachedFilePath,
    getAudioCacheHost,
    getAudioCachePort,
    getCachedTrackUrl,
    getMyInstantsCacheKey,
    getPlaybackSourceInfo,
    getPlaybackUrlForTrack,
    isValidVideoId,
    markYoutubeTrack,
    primeMyInstantsTrack,
    primeYoutubeTrack,
};
