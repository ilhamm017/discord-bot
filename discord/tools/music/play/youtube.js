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
const { buildSearchSelect } = require("./utils");

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

const {
    getYoutubeDurationMs,
    fetchPlaylistVideos,
    searchYoutube,
} = require("../../../../functions/tools/music/youtube_logic");


async function handleYoutube(message, voiceChannel, query, validation) {
    let url = query;
    let title;
    let info;

    // 1. Playlist
    if (validation === "playlist") {
        let playlistData;
        try {
            playlistData = await fetchPlaylistVideos(query);
        } catch (error) {
            logger.error("Failed fetching playlist info.", error);
            return message.reply("Gagal mengambil data playlist.");
        }

        const tracks = playlistData.videos
            .map((video) => {
                const videoUrl =
                    video?.url ||
                    (video?.id ? `https://www.youtube.com/watch?v=${video.id}` : null);
                if (!videoUrl) return null;
                return {
                    url: videoUrl,
                    title: video?.title || videoUrl,
                    requestedBy: message.author.tag,
                    requestedById: message.author.id,
                    requestedByTag: message.author.tag,
                };
            })
            .filter(Boolean);

        if (tracks.length === 0) {
            return message.reply("Playlist kosong atau tidak bisa dibaca.");
        }

        let result;
        try {
            result = await enqueueTracks(voiceChannel, tracks, {
                textChannelId: message.channel.id,
            });
        } catch (error) {
            logger.error("Queue error.", error);
            return message.reply("Gagal memutar audio.");
        }

        try {
            await updateControlPanel(message.client, result.state);
        } catch (error) {
            logger.warn("Failed updating control panel.", error);
        }

        const playlistTitle = playlistData.title || "Playlist";
        if (result.started) {
            return message.reply(
                `Memutar playlist: ${playlistTitle} (${tracks.length} lagu).`
            );
        }

        return message.reply(
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
        let youtubeItems = [];
        try {
            youtubeItems = await searchYoutube(query, YT_SEARCH_LIMIT);
        } catch (error) {
            logger.warn("YouTube search failed.", error);
        }

        let spotifyItems = [];
        if (isSpotifyConfigured()) {
            try {
                const spotifyResults = await searchSpotifyTracks(
                    query,
                    SPOTIFY_SEARCH_LIMIT
                );
                spotifyItems = spotifyResults.map((track) => ({
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
                }));
            } catch (error) {
                logger.warn("Failed searching Spotify, continuing.", error);
            }
        }

        const combined = [...youtubeItems, ...spotifyItems].slice(
            0,
            SEARCH_OPTION_LIMIT
        );

        if (combined.length === 0) {
            return message.reply("Tidak menemukan hasil untuk judul itu.");
        }

        const selectMenu = buildSearchSelect(combined);
        if (!selectMenu) {
            return message.reply("Tidak menemukan hasil untuk judul itu.");
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
        return message.reply("URL tidak valid. Pastikan link YouTube video.");
    }

    url = `https://www.youtube.com/watch?v=${videoId}`;

    const track = {
        url,
        title: title || url,
        requestedBy: message.author.tag,
        requestedById: message.author.id,
        requestedByTag: message.author.tag,
    };
    if (info) track.info = info;

    let result;
    try {
        result = await enqueueTrack(voiceChannel, track, {
            textChannelId: message.channel.id,
        });
    } catch (error) {
        logger.error("Queue error.", error);
        return message.reply("Gagal memutar audio.");
    }

    if (result.started) {
        try {
            await updateControlPanel(message.client, result.state);
        } catch (error) {
            logger.warn("Failed updating control panel.", error);
        }
        return message.reply(`Memutar: ${track.title}`);
    }

    try {
        await updateControlPanel(message.client, result.state);
    } catch (error) {
        logger.warn("Failed updating control panel.", error);
    }
    return message.reply(
        `Ditambahkan ke antrian #${result.position}: ${track.title}`
    );
}

module.exports = { handleYoutube };
