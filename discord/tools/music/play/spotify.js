const { AudioPlayerStatus } = require("@discordjs/voice");
const { enqueueTrack, enqueueTracks, getState } = require("../../../player/queue");
const { updateControlPanel } = require("../../../player/panel");
const logger = require("../../../../utils/logger");
const {
    isSpotifyConfigured,
    fetchSpotifyCollection,
    resolveSpotifyTracks,
} = require("../../../../utils/common/spotify");

const { resolveSpotify } = require("../../../../functions/tools/music/spotify_logic");

async function handleSpotify(message, voiceChannel, spotifyRef, query) {
    if (!isSpotifyConfigured()) {
        return message.reply(
            "Spotify API belum diset. Isi spotify_client_id dan spotify_client_secret di config.json."
        );
    }

    let resultData;
    try {
        resultData = await resolveSpotify(spotifyRef);
    } catch (error) {
        logger.error("Failed fetching/resolving Spotify data.", error);
        return message.reply("Gagal mengambil data dari Spotify.");
    }

    const { collection, tracks, failedCount } = resultData;

    if (!tracks.length) {
        return message.reply("Data Spotify kosong atau tidak bisa memetakan lagu ke YouTube.");
    }

    const formattedTracks = tracks.map(t => ({
        ...t,
        requestedBy: message.author.tag,
        requestedById: message.author.id,
        requestedByTag: message.author.tag,
        originUrl: query,
    }));


    // Single Track
    if (tracks.length === 1) {
        let result;
        try {
            result = await enqueueTrack(voiceChannel, tracks[0], {
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

        if (result.started) {
            return message.reply(`Memutar: ${tracks[0].title}`);
        }
        return message.reply(
            `Ditambahkan ke antrian #${result.position}: ${tracks[0].title}`
        );
    }

    // Playlist
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

    const name = collection.name || "Spotify";
    if (result.started) {
        return message.reply(
            `Memutar ${name} (${tracks.length} lagu).` +
            (failedCount ? ` ${failedCount} lagu gagal dipetakan.` : "")
        );
    }

    return message.reply(
        `${name} ditambahkan (${tracks.length} lagu), mulai antrian #${result.startPosition}.` +
        (failedCount ? ` ${failedCount} lagu gagal dipetakan.` : "")
    );
}

module.exports = { handleSpotify };
