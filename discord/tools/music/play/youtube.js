const { AudioPlayerStatus } = require("@discordjs/voice");
const { ActionRowBuilder } = require("discord.js");
const play = require("play-dl");
const { enqueueTrack, enqueueTracks, getState } = require("../../../player/queue");
const { updateControlPanel } = require("../../../player/panel");
const { search: searchWithYtDlp } = require("../../../../functions/music/search");
const { registerSearchSession } = require("../../../player/search");
const logger = require("../../../../utils/logger");
const {
    isSpotifyConfigured,
    searchSpotifyTracks,
} = require("../../../../utils/common/spotify");
const {
    markYoutubeTrack,
    primeYoutubeTrack,
} = require("../../../../utils/common/media_cache");
const { getYoutubeUserFacingError } = require("../../../../utils/common/youtube_error");
const { buildSearchSelect, shouldAutoPlaySearchQuery } = require("./utils");

let config = {};
try {
    config = require("../../../../config.json");
} catch (error) {
    config = {};
}

const YT_SEARCH_LIMIT = Number.isInteger(config.search_results_limit_youtube)
    ? config.search_results_limit_youtube
    : 5;
const SPOTIFY_SEARCH_LIMIT = Number.isInteger(config.search_results_limit_spotify)
    ? config.search_results_limit_spotify
    : 5;
const SEARCH_OPTION_LIMIT = 25;
const SEARCH_TIMEOUT_MS = Number.isInteger(config.music_search_timeout_ms)
    ? config.music_search_timeout_ms
    : 20000;

const {
    getYoutubeDurationMs,
    fetchPlaylistVideos,
    searchYoutube,
} = require("../../../../functions/tools/music/youtube_logic");

function prepareYoutubeTrack(baseTrack, options = {}) {
    const track = markYoutubeTrack(baseTrack, {
        sourceUrl: options.sourceUrl || baseTrack.originalUrl || baseTrack.url,
        youtubeVideoId: options.youtubeVideoId || baseTrack.youtubeVideoId || null,
    });

    if (options.prime !== false) {
        primeYoutubeTrack(track)?.catch((error) => {
            logger.debug("Background audio cache prime failed.", {
                videoId: track.youtubeVideoId,
                message: error?.message || String(error),
            });
        });
    }

    return track;
}

function withTimeout(promise, timeoutMs, label) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            const error = new Error(`${label || "ASYNC_TASK"}_TIMEOUT`);
            error.code = "TIMEOUT";
            error.timeoutMs = timeoutMs;
            reject(error);
        }, timeoutMs);

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


async function handleYoutube(message, voiceChannel, query, validation, options = {}) {
    const forceTopYoutube = Boolean(options?.forceTopYoutube);
    const forceSelection = Boolean(options?.forceSelection);
    let url = query;
    let title;
    let info;
    let progressMessage = null;

    async function ensureProgress(content = "Sedang mencari dan menyiapkan lagu...") {
        if (progressMessage) return progressMessage;
        progressMessage = await message.reply(content);
        return progressMessage;
    }

    async function sendFinal(content, extra = {}) {
        if (progressMessage) {
            return progressMessage.edit({ content, ...extra });
        }
        return message.reply({ content, ...extra });
    }

    async function enqueueAndReply(track) {
        let result;
        try {
            result = await enqueueTrack(voiceChannel, track, {
                textChannelId: message.channel.id,
            });
        } catch (error) {
            logger.error("Queue error.", error);
            return sendFinal(getYoutubeUserFacingError(error) || "Gagal memutar audio.");
        }

        try {
            await updateControlPanel(message.client, result.state);
        } catch (error) {
            logger.warn("Failed updating control panel.", error);
        }

        if (result.started) {
            return sendFinal(`Memutar: ${track.title}`);
        }

        return sendFinal(`Ditambahkan ke antrian #${result.position}: ${track.title}`);
    }

    await ensureProgress();

    // 1. Playlist
    if (validation === "playlist") {
        let playlistData;
        try {
            playlistData = await fetchPlaylistVideos(query);
        } catch (error) {
            logger.error("Failed fetching playlist info.", error);
            return sendFinal("Gagal mengambil data playlist.");
        }

        const tracks = playlistData.videos
            .map((video) => {
                const videoUrl =
                    video?.url ||
                    (video?.id ? `https://www.youtube.com/watch?v=${video.id}` : null);
                if (!videoUrl) return null;
                return prepareYoutubeTrack({
                    url: videoUrl,
                    title: video?.title || videoUrl,
                    requestedBy: message.author.tag,
                    requestedById: message.author.id,
                    requestedByTag: message.author.tag,
                }, {
                    sourceUrl: videoUrl,
                    youtubeVideoId: video?.id || null,
                    prime: false,
                });
            })
            .filter(Boolean);

        if (tracks.length === 0) {
            return sendFinal("Playlist kosong atau tidak bisa dibaca.");
        }

        let result;
        try {
            result = await enqueueTracks(voiceChannel, tracks, {
                textChannelId: message.channel.id,
            });
        } catch (error) {
            logger.error("Queue error.", error);
            return sendFinal(getYoutubeUserFacingError(error) || "Gagal memutar audio.");
        }

        try {
            await updateControlPanel(message.client, result.state);
        } catch (error) {
            logger.warn("Failed updating control panel.", error);
        }

        const playlistTitle = playlistData.title || "Playlist";
        if (result.started) {
            return sendFinal(
                `Memutar playlist: ${playlistTitle} (${tracks.length} lagu).`
            );
        }

        return sendFinal(
            `Playlist ditambahkan: ${playlistTitle} (${tracks.length} lagu), mulai antrian #${result.startPosition}.`
        );
    }

    // 2. Direct Video
    if (validation === "video") {
        url = query;
        try {
            info = await play.video_basic_info(query);
            url = info.video_details?.url || query;
            title = info.video_details?.title;
        } catch (error) {
            logger.warn("Failed getting YouTube info, continuing.", error);
        }
    } else {
        // 3. Search
        let youtubeTimedOut = false;
        let spotifyTimedOut = false;
        const youtubeSearchPromise = withTimeout(
            searchYoutube(query, YT_SEARCH_LIMIT),
            SEARCH_TIMEOUT_MS,
            "YOUTUBE_SEARCH"
        ).catch((error) => {
            if (error?.message === "YOUTUBE_SEARCH_TIMEOUT") {
                youtubeTimedOut = true;
            }
            logger.warn("YouTube search failed.", error);
            return [];
        });

        const spotifySearchPromise = isSpotifyConfigured()
            ? withTimeout(
                searchSpotifyTracks(query, SPOTIFY_SEARCH_LIMIT),
                SEARCH_TIMEOUT_MS,
                "SPOTIFY_SEARCH"
            )
                .then((spotifyResults) => spotifyResults.map((track) => ({
                    source: "spotify",
                    title: track?.name || "Spotify Track",
                    artists: track?.artists || [],
                    durationMs: track?.durationMs || null,
                    spotify: {
                        id: track?.id,
                        name: track?.name,
                        artists: track?.artists || [],
                        durationMs: track?.durationMs || 0,
                    },
                    url: track?.url || null,
                })))
                .catch((error) => {
                    if (error?.message === "SPOTIFY_SEARCH_TIMEOUT") {
                        spotifyTimedOut = true;
                    }
                    logger.warn("Failed searching Spotify, continuing.", error);
                    return [];
                })
            : Promise.resolve([]);

        const [youtubeItems, spotifyItems] = await Promise.all([
            youtubeSearchPromise,
            spotifySearchPromise,
        ]);

        const combined = [...youtubeItems, ...spotifyItems].slice(
            0,
            SEARCH_OPTION_LIMIT
        );

        if (combined.length === 0) {
            if (youtubeTimedOut && spotifyTimedOut) {
                return sendFinal("Pencarian YouTube dan Spotify sedang lambat. Coba lagi sebentar lagi, atau naikkan `music_search_timeout_ms` di config.");
            }
            if (youtubeTimedOut) {
                return sendFinal("Pencarian YouTube sedang lambat atau timeout. Coba lagi sebentar lagi, atau naikkan `music_search_timeout_ms` di config.");
            }
            return sendFinal("Tidak menemukan hasil untuk judul itu.");
        }

        // Mention-target flow: always pick top YouTube result to avoid
        // interactive select mismatch against target voice channel.
        // Specific query (e.g. "maroon5 animals"): also auto-play top result.
        if (!forceSelection && (forceTopYoutube || shouldAutoPlaySearchQuery(query)) && youtubeItems.length > 0) {
            const picked = youtubeItems[0];
            const track = prepareYoutubeTrack({
                url: picked.url,
                title: picked.title || picked.url,
                requestedBy: message.author.tag,
                requestedById: message.author.id,
                requestedByTag: message.author.tag,
                info: {
                    video_details: {
                        title: picked.title || picked.url,
                        durationInSec: picked.durationMs
                            ? Math.round(picked.durationMs / 1000)
                            : 0,
                        thumbnails: picked.thumbnail ? [{ url: picked.thumbnail }] : [],
                    },
                },
            }, {
                sourceUrl: picked.url,
                youtubeVideoId: picked.videoId || null,
            });
            return enqueueAndReply(track);
        }

        if (forceTopYoutube && youtubeItems.length === 0) {
            if (youtubeTimedOut) {
                return sendFinal("Pencarian YouTube sedang lambat atau timeout. Coba lagi sebentar lagi, atau naikkan `music_search_timeout_ms` di config.");
            }
            return sendFinal("Tidak menemukan hasil YouTube untuk judul itu.");
        }

        const selectMenu = buildSearchSelect(combined);
        if (!selectMenu) {
            return sendFinal("Tidak menemukan hasil untuk judul itu.");
        }

        if (progressMessage) {
            await progressMessage.delete().catch(() => { });
            progressMessage = null;
        }

        const row = new ActionRowBuilder().addComponents(selectMenu);
        const targetLabel = voiceChannel?.id ? ` di <#${voiceChannel.id}>` : "";
        const sent = await message.reply({
            content: `Pilih hasil pencarian (YT/Spotify)${targetLabel}:`,
            components: [row],
        });

        registerSearchSession(sent.id, {
            requesterId: message.author.id,
            voiceChannelId: voiceChannel?.id || null,
            textChannelId: message.channel.id,
            results: combined,
        });

        return;
    }

    // 4. Enqueue Direct Video
    let videoId;
    try {
        videoId = play.extractID(url);
    } catch (error) {
        logger.warn("Invalid YouTube URL.", error);
        return sendFinal("URL tidak valid. Pastikan link YouTube video.");
    }

    url = `https://www.youtube.com/watch?v=${videoId}`;

    const track = prepareYoutubeTrack({
        url,
        title: title || url,
        requestedBy: message.author.tag,
        requestedById: message.author.id,
        requestedByTag: message.author.tag,
    }, {
        sourceUrl: url,
        youtubeVideoId: videoId,
    });
    if (info) track.info = info;

    return enqueueAndReply(track);
}

module.exports = { handleYoutube };
