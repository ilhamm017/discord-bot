const { client } = require("../../discord/client");
const { enqueueTrack, stopPlayback, skipTrack, togglePause, restoreQueue, getState } = require("../../discord/player/queue");
const { searchYoutube } = require("../tools/music/youtube_logic");
const { isSpotifyConfigured, searchSpotifyTracks, resolveSpotifyTrackToYoutube } = require("../../utils/common/spotify");
const {
    buildMyInstantsTrack,
    detectMyInstantsRequest,
    resolveMyInstantsTrack,
} = require("../../utils/common/myinstants");
const logger = require("../../utils/logger");

/**
 * Music Platform Logic for AI Tool Calling
 */

async function playMusic(guildId, userId, channelId, query, targetUserId = null, source = "auto") {
    try {
        const guild = await client.guilds.fetch(guildId);

        // Use targetUserId if provided, otherwise use the caller (userId)
        const normalizedTargetInput =
            typeof targetUserId === "string"
                ? targetUserId.trim().replace(/^<@!?(\d+)>$/, "$1")
                : targetUserId;
        const finalTargetIdOrName = normalizedTargetInput || userId;
        let member;

        const normalizeText = (text) => String(text || "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
        const search = normalizeText(finalTargetIdOrName);

        if (/^\d+$/.test(finalTargetIdOrName)) {
            try { member = await guild.members.fetch(finalTargetIdOrName); } catch (e) { }
        }

        if (!member) {
            const members = await guild.members.fetch();
            member = members.find(m => {
                const uname = normalizeText(m.user.username);
                const dname = normalizeText(m.displayName);
                const tag = normalizeText(m.user.tag);
                return uname === search || dname === search || tag === search || uname.includes(search) || dname.includes(search);
            });
        }

        if (!member) {
            return { error: `Gak nemu member "${finalTargetIdOrName}" di server ini.` };
        }

        let voiceChannel = member.voice.channel;

        // Fallback: If target is not in voice but caller is, maybe they want to play it where THEY are (if they didn't specify a target)
        if (!voiceChannel && targetUserId) {
            return { error: `${member.displayName} lagi gak ada di Voice Channel mana pun...` };
        }

        if (!voiceChannel) {
            const caller = await guild.members.fetch(userId);
            voiceChannel = caller.voice.channel;
        }

        if (!voiceChannel) {
            return { error: "Kamu (atau targetmu) harus join voice channel dulu kalau mau denger musik!" };
        }

        // Auto-restore if queue is empty in memory but might exist in DB
        const currentState = getState(guildId);
        if (!currentState || !currentState.queue || currentState.queue.length === 0) {
            await restoreQueue(voiceChannel).catch(() => { });
        }

        const myInstantsRequest = detectMyInstantsRequest(query, { source });
        let track = null;

        if (myInstantsRequest.shouldUseMyInstants) {
            try {
                const resolved = await resolveMyInstantsTrack(query, {
                    source,
                    limit: 1,
                });
                if (resolved?.audioUrl) {
                    track = buildMyInstantsTrack(resolved, {
                        requestedBy: member.user.tag,
                        requestedById: userId,
                        requestedByTag: member.user.tag,
                    });
                }
            } catch (error) {
                logger.warn("MyInstants search failed in playMusic tool.", error);
            }
        } else {
            let tracks = [];

            // 1. Search Spotify if configured
            if (isSpotifyConfigured()) {
                try {
                    const spotifyResults = await searchSpotifyTracks(query, 10);
                    if (spotifyResults.length > 0) {
                        // Start resolving the first one immediately as the priority
                        const resolved = await resolveSpotifyTrackToYoutube(spotifyResults[0]);
                        if (resolved) {
                            tracks.push(resolved);
                        }
                    }
                } catch (err) {
                    logger.debug("Spotify search failed in playMusic tool.", err);
                }
            }

            // 2. Search YouTube (Always as fallback or additional)
            if (tracks.length === 0) {
                const ytResults = await searchYoutube(query, 10);
                if (ytResults && ytResults.length > 0) {
                    tracks.push({
                        url: ytResults[0].url,
                        title: ytResults[0].title,
                        durationMs: ytResults[0].durationMs,
                        thumbnail: ytResults[0].thumbnail
                    });
                }
            }

            if (tracks.length === 0) {
                return { error: "Yova gak nemu lagunya... coba judul lain deh." };
            }

            const selected = tracks[0];
            track = {
                url: selected.url,
                title: selected.title,
                requestedBy: member.user.tag,
                requestedById: userId,
                requestedByTag: member.user.tag,
                info: {
                    video_details: {
                        title: selected.title,
                        durationInSec: selected.durationMs ? selected.durationMs / 1000 : 0,
                        thumbnails: selected.thumbnail ? [{ url: selected.thumbnail }] : []
                    }
                }
            };
        }

        if (!track) {
            return {
                error: myInstantsRequest.shouldUseMyInstants
                    ? "Yova gak nemu sound effect MyInstants yang cocok."
                    : "Yova gak nemu lagunya... coba judul lain deh.",
            };
        }

        // 2. Play via Enqueue System (Ensures Unified Queue & Panel update)
        const { enqueueTrack } = require("../../discord/player/queue");
        const result = await enqueueTrack(voiceChannel, track, {
            textChannelId: channelId
        });

        if (result.error) return result;

        return {
            success: true,
            status: result.started ? "playing" : "queued",
            title: track.title,
            position: result.position
        };
    } catch (error) {
        logger.error(`Error in platform.playMusic: ${error.message}`);
        return { error: "Ada masalah teknis pas mau putar musik. Hmph!" };
    }
}

async function stopMusic(guildId) {
    try {
        const playerManager = require("../../discord/player/PlayerManager");
        await playerManager.stop(guildId);
        return { success: true, message: "Musik dihentikan!" };
    } catch (error) {
        logger.error(`Error in platform.stopMusic: ${error.message}`);
        return { error: "Gagal stop musiknya." };
    }
}

async function skipMusic(guildId) {
    try {
        const playerManager = require("../../discord/player/PlayerManager");
        await playerManager.skip(guildId);
        return { success: true, message: "Lagu diskip!" };
    } catch (error) {
        logger.error(`Error in platform.skipMusic: ${error.message}`);
        return { error: "Gagal skip lagunya." };
    }
}

async function pauseMusic(guildId) {
    try {
        const playerManager = require("../../discord/player/PlayerManager");
        const status = await playerManager.pause(guildId);
        return { success: true, paused: true }; // Simplified
    } catch (error) {
        logger.error(`Error in platform.pauseMusic: ${error.message}`);
        return { error: "Gagal pause/resume musik." };
    }
}

module.exports = {
    playMusic,
    stopMusic,
    skipMusic,
    pauseMusic
};
