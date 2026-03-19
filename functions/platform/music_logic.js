const { client } = require("../../discord/client");
const { enqueueTrack, stopPlayback, skipTrack, togglePause, restoreQueue, getState } = require("../../discord/player/queue");
const { searchYoutube } = require("../tools/music/youtube_logic");
const {
    parseSpotifyInput,
    buildSpotifyUrl,
    fetchSpotifyOEmbedTitle,
    fetchSpotifyPlaylistMeta,
    fetchSpotifyPlaylistTrackEntries,
} = require("../../utils/common/spotify");
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

        let resolvedQuery = query;
        const myInstantsRequest = detectMyInstantsRequest(resolvedQuery, { source });
        let track = null;
        let tracks = [];

        if (myInstantsRequest.shouldUseMyInstants) {
            try {
                const resolved = await resolveMyInstantsTrack(resolvedQuery, {
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
            const spotifyRef = parseSpotifyInput(resolvedQuery);
            if (spotifyRef) {
                if (spotifyRef.type !== "playlist") {
                    return {
                        error:
                            "Spotify track/album tidak didukung tanpa Spotify API. " +
                            "Silakan pakai judul (teks) atau link YouTube.",
                    };
                }

                const playlistUrl = buildSpotifyUrl(spotifyRef);
                const playlistTitle = await fetchSpotifyOEmbedTitle(playlistUrl);
                if (!playlistTitle) {
                    return {
                        error:
                            "Gagal mengambil judul playlist Spotify (oEmbed). " +
                            "Coba lagi, atau copy judul playlistnya lalu kirim judulnya saja.",
                    };
                }

                // Enumerate playlist items via Spotify web access token (no app credentials).
                const playlistId = String(spotifyRef.id);
                let totalTracks = 0;
                try {
                    const meta = await fetchSpotifyPlaylistMeta(playlistId);
                    totalTracks = Number(meta?.totalTracks) || 0;
                } catch (error) {
                    totalTracks = 0;
                }

                if (totalTracks > 0) {
                    const maxResolve = 30;
                    for (let offset = 0; offset < totalTracks && tracks.length < maxResolve; offset += 50) {
                        const entries = await fetchSpotifyPlaylistTrackEntries(playlistId, offset, 50).catch(() => []);
                        if (!entries.length) break;

                        for (const entry of entries) {
                            if (tracks.length >= maxResolve) break;
                            const entryTitle = String(entry?.title || "").trim();
                            const entryArtist = String(entry?.artist || "").trim();
                            const entryQuery = [entryTitle, entryArtist].filter(Boolean).join(" ").trim();
                            if (!entryQuery) continue;

                            const ytResults = await searchYoutube(`${entryQuery} official audio`, 1).catch(() => []);
                            if (!ytResults || ytResults.length === 0) continue;
                            tracks.push({
                                url: ytResults[0].url,
                                title: ytResults[0].title,
                                durationMs: ytResults[0].durationMs,
                                thumbnail: ytResults[0].thumbnail
                            });
                        }
                    }
                }

                if (tracks.length === 0) {
                    resolvedQuery = playlistTitle;
                }
            }

            // Search YouTube
            if (tracks.length === 0) {
                const ytResults = await searchYoutube(resolvedQuery, 10);
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

        if (!track && tracks.length === 0) {
            return {
                error: myInstantsRequest.shouldUseMyInstants
                    ? "Yova gak nemu sound effect MyInstants yang cocok."
                    : "Yova gak nemu lagunya... coba judul lain deh.",
            };
        }

        // 2. Play via Enqueue System (Ensures Unified Queue & Panel update)
        const { enqueueTrack, enqueueTracks } = require("../../discord/player/queue");

        if (tracks.length > 1) {
            // Handle playlist/multiple tracks
            const formattedTracks = tracks.map(t => ({
                ...t,
                requestedBy: member.user.tag,
                requestedById: userId,
                requestedByTag: member.user.tag,
                info: t.info || {
                    video_details: {
                        title: t.title,
                        durationInSec: t.durationMs ? t.durationMs / 1000 : 0,
                        thumbnails: t.thumbnail ? [{ url: t.thumbnail }] : []
                    }
                }
            }));

            const result = await enqueueTracks(voiceChannel, formattedTracks, {
                textChannelId: channelId
            });

            if (result.error) return result;

            return {
                success: true,
                status: result.started ? "playing" : "queued",
                title: "koleksi lagu",
                trackCount: tracks.length,
                position: result.startPosition
            };
        } else {
            // Handle single track
            if (!track && tracks.length === 1) {
                const selected = tracks[0];
                track = {
                    url: selected.url,
                    title: selected.title,
                    requestedBy: member.user.tag,
                    requestedById: userId,
                    requestedByTag: member.user.tag,
                    info: selected.info || {
                        video_details: {
                            title: selected.title,
                            durationInSec: selected.durationMs ? selected.durationMs / 1000 : 0,
                            thumbnails: selected.thumbnail ? [{ url: selected.thumbnail }] : []
                        }
                    }
                };
            }

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
        }
    } catch (error) {
        logger.error(`Error in platform.playMusic: ${error.message}`);
        return { error: `Ada masalah teknis: ${error.message}` };
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
