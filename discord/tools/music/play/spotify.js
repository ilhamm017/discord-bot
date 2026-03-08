const { AudioPlayerStatus } = require("@discordjs/voice");
const { enqueueTrack, enqueueTracks, getState } = require("../../../player/queue");
const { updateControlPanel } = require("../../../player/panel");
const logger = require("../../../../utils/logger");
const { markYoutubeTrack, primeYoutubeTrack } = require("../../../../utils/common/media_cache");
const { getYoutubeUserFacingError } = require("../../../../utils/common/youtube_error");
const {
    isSpotifyConfigured,
    fetchSpotifyCollection,
    resolveSpotifyTracks,
} = require("../../../../utils/common/spotify");

const { resolveSpotify } = require("../../../../functions/tools/music/spotify_logic");

async function handleSpotify(message, voiceChannel, spotifyRef, query) {
    let progressMessage = null;

    async function ensureProgress(content = "Sedang mengambil dan memetakan lagu Spotify...") {
        if (progressMessage) return progressMessage;
        progressMessage = await message.reply(content);
        return progressMessage;
    }

    async function sendFinal(content) {
        if (progressMessage) {
            return progressMessage.edit(content);
        }
        return message.reply(content);
    }

    if (!isSpotifyConfigured()) {
        return message.reply(
            "Spotify API belum diset. Isi spotify_client_id dan spotify_client_secret di config.json."
        );
    }

    await ensureProgress();

    let resultData;
    try {
        resultData = await resolveSpotify(spotifyRef);
    } catch (error) {
        logger.error("Failed fetching/resolving Spotify data.", error);
        return sendFinal(getYoutubeUserFacingError(error, { spotify: true }) || "Gagal mengambil data dari Spotify.");
    }

    const { collection, tracks, failedCount } = resultData;

    if (!tracks.length) {
        return sendFinal("Data Spotify kosong atau tidak bisa memetakan lagu ke YouTube.");
    }

    const formattedTracks = tracks.map((t) => {
        const track = markYoutubeTrack({
            ...t,
            requestedBy: message.author.tag,
            requestedById: message.author.id,
            requestedByTag: message.author.tag,
            originUrl: query,
        }, {
            sourceUrl: t.originalUrl || t.url,
            youtubeVideoId: t.youtubeVideoId || null,
        });

        primeYoutubeTrack(track)?.catch((error) => {
            logger.debug("Background audio cache prime failed.", {
                videoId: track?.youtubeVideoId || null,
                message: error?.message || String(error),
            });
        });

        return track;
    });


    // Single Track
    if (tracks.length === 1) {
        let result;
        try {
            result = await enqueueTrack(voiceChannel, formattedTracks[0], {
                textChannelId: message.channel.id,
            });
        } catch (error) {
            logger.error("Queue error.", error);
            return sendFinal(getYoutubeUserFacingError(error, { spotify: true }) || "Gagal memutar audio.");
        }

        try {
            await updateControlPanel(message.client, result.state);
        } catch (error) {
            logger.warn("Failed updating control panel.", error);
        }

        if (result.started) {
            return sendFinal(`Memutar: ${formattedTracks[0].title}`);
        }
        return sendFinal(
            `Ditambahkan ke antrian #${result.position}: ${formattedTracks[0].title}`
        );
    }

    // Playlist
    let result;
    try {
        result = await enqueueTracks(voiceChannel, formattedTracks, {
            textChannelId: message.channel.id,
        });
    } catch (error) {
        logger.error("Queue error.", error);
        return sendFinal(getYoutubeUserFacingError(error, { spotify: true }) || "Gagal memutar audio.");
    }

    try {
        await updateControlPanel(message.client, result.state);
    } catch (error) {
        logger.warn("Failed updating control panel.", error);
    }

    const name = collection.name || "Spotify";
    if (result.started) {
        return sendFinal(
            `Memutar ${name} (${tracks.length} lagu).` +
            (failedCount ? ` ${failedCount} lagu gagal dipetakan.` : "")
        );
    }

    return sendFinal(
        `${name} ditambahkan (${tracks.length} lagu), mulai antrian #${result.startPosition}.` +
        (failedCount ? ` ${failedCount} lagu gagal dipetakan.` : "")
    );
}

module.exports = { handleSpotify };
