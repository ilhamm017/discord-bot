const { AudioPlayerStatus } = require("@discordjs/voice");
const { enqueueTracks, getState } = require("../../../player/queue");
const { updateControlPanel } = require("../../../player/panel");
const logger = require("../../../../utils/logger");

const FAVORITES_MIN_PLAYS = 5;
const FAVORITES_LIMIT = 20;

const { getFavorites } = require("../../../../functions/tools/music/favorites_logic");

async function handleFavorites(message, voiceChannel) {
    const favorites = await getFavorites(message.author.id, {
        minPlays: FAVORITES_MIN_PLAYS,
        limit: FAVORITES_LIMIT,
    });

    if (!favorites.length) {
        return message.reply(
            `Belum ada lagu favorit (minimal ${FAVORITES_MIN_PLAYS}x diputar).`
        );
    }

    const tracks = favorites.map((item) => ({
        ...item,
        requestedBy: message.author.tag,
        requestedById: message.author.id,
        requestedByTag: message.author.tag,
    }));

    let result;
    try {
        result = await enqueueTracks(voiceChannel, tracks, {
            textChannelId: message.channel.id,
        });
    } catch (error) {
        logger.error("Queue error.", error);
        const state = message.guild ? getState(message.guild.id) : null;
        const status = state?.player?.state?.status;
        if (
            status === AudioPlayerStatus.Playing ||
            status === AudioPlayerStatus.Buffering
        ) {
            return;
        }
        // Simple error handling for brevity, can be expanded
        return message.reply("Gagal memutar audio.");
    }

    try {
        await updateControlPanel(message.client, result.state);
    } catch (error) {
        logger.warn("Failed updating control panel.", error);
    }

    if (result.started) {
        return message.reply(`Memutar kesukaanku (${tracks.length} lagu).`);
    }

    return message.reply(
        `Kesukaanku ditambahkan (${tracks.length} lagu), mulai antrian #${result.startPosition}.`
    );
}

module.exports = { handleFavorites };
