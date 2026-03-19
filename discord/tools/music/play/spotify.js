const logger = require("../../../../utils/logger");
const { enqueueTrack, enqueueTracks, getState } = require("../../../player/queue");
const { updateControlPanel } = require("../../../player/panel");
const { searchYoutube } = require("../../../../functions/tools/music/youtube_logic");
const { markYoutubeTrack, primeYoutubeTrack } = require("../../../../utils/common/media_cache");
const {
    fetchSpotifyOEmbedTitle,
    buildSpotifyUrl,
    fetchSpotifyPlaylistMeta,
    fetchSpotifyPlaylistTrackEntries,
} = require("../../../../utils/common/spotify");

let config = {};
try {
    // eslint-disable-next-line global-require
    config = require("../../../../config.json");
} catch (error) {
    config = {};
}

function clampNumber(raw, fallback, { min = null, max = null } = {}) {
    const parsed = Number(raw);
    if (!Number.isFinite(parsed)) return fallback;
    let value = Math.trunc(parsed);
    if (typeof min === "number") value = Math.max(min, value);
    if (typeof max === "number") value = Math.min(max, value);
    return value;
}

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

const SPOTIFY_PLAYLIST_IMPORT_BATCH_SIZE = clampNumber(
    process.env.SPOTIFY_PLAYLIST_IMPORT_BATCH_SIZE || config.spotify_playlist_import_batch_size || 50,
    50,
    { min: 1, max: 100 }
);
const SPOTIFY_PLAYLIST_IMPORT_MAX_TRACKS = clampNumber(
    process.env.SPOTIFY_PLAYLIST_IMPORT_MAX_TRACKS ||
    config.spotify_playlist_import_max_tracks ||
    config.spotify_playlist_track_limit ||
    500,
    500,
    { min: 1, max: 2000 }
);
const SPOTIFY_PLAYLIST_IMPORT_PER_TRACK_DELAY_MS = clampNumber(
    process.env.SPOTIFY_PLAYLIST_IMPORT_PER_TRACK_DELAY_MS ||
    config.spotify_playlist_import_per_track_delay_ms ||
    150,
    150,
    { min: 0, max: 5000 }
);
const SPOTIFY_PLAYLIST_IMPORT_BATCH_DELAY_MS = clampNumber(
    process.env.SPOTIFY_PLAYLIST_IMPORT_BATCH_DELAY_MS ||
    config.spotify_playlist_import_batch_delay_ms ||
    1500,
    1500,
    { min: 0, max: 60_000 }
);
const SPOTIFY_PLAYLIST_IMPORT_FLUSH_CHUNK = clampNumber(
    process.env.SPOTIFY_PLAYLIST_IMPORT_FLUSH_CHUNK ||
    config.spotify_playlist_import_flush_chunk ||
    10,
    10,
    { min: 1, max: 50 }
);

const activeImportsByGuild = new Map(); // guildId -> { cancelled: boolean }

function cancelActiveImport(guildId) {
    const current = activeImportsByGuild.get(guildId);
    if (current) current.cancelled = true;
    activeImportsByGuild.delete(guildId);
}

function buildEntryQuery(entry) {
    const entryTitle = String(entry?.title || "").trim();
    const entryArtist = String(entry?.artist || entry?.uploader || entry?.channel || "").trim();
    return [entryTitle, entryArtist].filter(Boolean).join(" ").trim();
}

async function resolveEntryToYoutubeTrack(entry, { playlistUrl, requester }) {
    const query = buildEntryQuery(entry);
    if (!query) return null;

    let youtubeItems = [];
    try {
        youtubeItems = await searchYoutube(`${query} official audio`, 1);
        if (!youtubeItems.length) {
            youtubeItems = await searchYoutube(query, 1);
        }
    } catch (error) {
        youtubeItems = [];
    }

    const picked = youtubeItems[0];
    if (!picked?.url) return null;

    const track = markYoutubeTrack({
        url: picked.url,
        title: picked.title || picked.url,
        requestedBy: requester.tag,
        requestedById: requester.id,
        requestedByTag: requester.tag,
        originUrl: playlistUrl,
        info: {
            video_details: {
                title: picked.title || picked.url,
                durationInSec: picked.durationMs ? Math.round(picked.durationMs / 1000) : 0,
                thumbnails: picked.thumbnail ? [{ url: picked.thumbnail }] : [],
            },
        },
    }, {
        sourceUrl: picked.url,
        youtubeVideoId: picked.videoId || null,
    });

    primeYoutubeTrack(track)?.catch(() => { });
    return track;
}

async function enqueueResolvedTracks(message, voiceChannelId, tracks, { progress = null } = {}) {
    if (!tracks.length) return null;
    const guild = message.guild;
    if (!guild) return null;

    const state = getState(guild.id);
    if (state?.channelId && voiceChannelId && state.channelId !== voiceChannelId) {
        return null;
    }

    const voiceChannel =
        guild.channels.cache.get(voiceChannelId) ||
        (await guild.channels.fetch(voiceChannelId).catch(() => null));
    if (!voiceChannel) return null;

    const result = await enqueueTracks(voiceChannel, tracks, {
        textChannelId: message.channel.id,
    });

    try {
        await updateControlPanel(message.client, result.state);
    } catch (error) {
        logger.warn("Failed updating control panel.", error);
    }

    if (progress) {
        try {
            await progress.edit(progress.content);
        } catch (error) {
            // ignore
        }
    }

    return result;
}

function formatImportStatus({ title, total, maxTracks, added, failed, batchIndex, totalBatches }) {
    const capped = total > maxTracks ? ` (dibatasi ${maxTracks}/${total})` : "";
    return (
        `Spotify playlist: ${title}${capped}\n` +
        `Impor batch ${batchIndex + 1}/${totalBatches} • ` +
        `total ditambahkan ${added} • gagal ${failed}\n` +
        "Bot akan lanjut memproses batch berikutnya di background."
    );
}

async function startBackgroundImport({
    message,
    progress,
    voiceChannelId,
    playlistId,
    playlistUrl,
    title,
    totalTracks,
    batchSize,
    maxTracks,
}) {
    const guildId = message.guild?.id;
    if (!guildId) return;

    cancelActiveImport(guildId);
    const job = { cancelled: false };
    activeImportsByGuild.set(guildId, job);

    const requester = { id: message.author.id, tag: message.author.tag };
    const total = Math.max(0, Number(totalTracks) || 0);
    const target = Math.min(total, maxTracks);
    const totalBatches = Math.max(1, Math.ceil(target / batchSize));

    let added = 0;
    let failed = 0;
    let stoppedBy = null;

    for (let batchIndex = 0; batchIndex < totalBatches; batchIndex += 1) {
        if (job.cancelled) break;

        const offset = batchIndex * batchSize;
        const limit = Math.max(0, Math.min(batchSize, target - offset));
        let slice = [];
        try {
            slice = await fetchSpotifyPlaylistTrackEntries(playlistId, offset, limit);
        } catch (error) {
            if (error?.code === "SPOTIFY_WEB_RATE_LIMITED") {
                stoppedBy = `Rate limit Spotify (retry-after: ${error?.details?.retryAfterSec ?? "?"}s)`;
                break;
            }
            if (error?.code === "SPOTIFY_PLAYLIST_PAGING_UNAVAILABLE") {
                const available = error?.details?.available;
                stoppedBy = `Spotify membatasi akses daftar lagu tanpa API (hanya ${available ?? "sebagian"} lagu pertama yang bisa diambil).`;
                break;
            }
            logger.warn("Spotify playlist track fetch failed; skipping batch.", {
                playlistId,
                offset,
                limit,
                message: error?.message || String(error),
            });
            slice = [];
        }

        let pending = [];
        for (const entry of slice) {
            if (job.cancelled) break;

            const track = await resolveEntryToYoutubeTrack(entry, { playlistUrl, requester });
            if (track) {
                pending.push(track);
                added += 1;
            } else {
                failed += 1;
            }

            if (pending.length >= SPOTIFY_PLAYLIST_IMPORT_FLUSH_CHUNK) {
                await enqueueResolvedTracks(message, voiceChannelId, pending).catch(() => { });
                pending = [];
            }

            if (SPOTIFY_PLAYLIST_IMPORT_PER_TRACK_DELAY_MS > 0) {
                await sleep(SPOTIFY_PLAYLIST_IMPORT_PER_TRACK_DELAY_MS);
            }
        }

        if (pending.length > 0) {
            await enqueueResolvedTracks(message, voiceChannelId, pending).catch(() => { });
        }

        if (progress) {
            try {
                await progress.edit(
                    formatImportStatus({
                        title,
                        total,
                        maxTracks,
                        added,
                        failed,
                        batchIndex,
                        totalBatches,
                    })
                );
            } catch (error) {
                // ignore
            }
        }

        if (batchIndex < totalBatches - 1 && SPOTIFY_PLAYLIST_IMPORT_BATCH_DELAY_MS > 0) {
            await sleep(SPOTIFY_PLAYLIST_IMPORT_BATCH_DELAY_MS);
        }
    }

    if (!job.cancelled && progress) {
        try {
            await progress.edit(
                `Spotify playlist: ${title}\n` +
                (stoppedBy
                    ? `Impor berhenti: ${stoppedBy}\n`
                    : "") +
                `Selesai impor • total ditambahkan ${added} • gagal ${failed}`
            );
        } catch (error) {
            // ignore
        }
    }

    if (activeImportsByGuild.get(guildId) === job) {
        activeImportsByGuild.delete(guildId);
    }
}

async function handleSpotify(message, voiceChannel, spotifyRef) {
    if (!spotifyRef?.type || !spotifyRef?.id) {
        return message.reply("Link Spotify tidak valid.");
    }

    if (spotifyRef.type !== "playlist") {
        return message.reply(
            "Spotify track/album tidak didukung tanpa Spotify API. " +
            "Silakan pakai judul lagu/playlist (teks) atau link YouTube."
        );
    }

    const progress = await message.reply("Mengambil info playlist Spotify...");
    const playlistId = String(spotifyRef.id);
    const playlistUrl = buildSpotifyUrl(spotifyRef);

    let meta = null;
    try {
        meta = await fetchSpotifyPlaylistMeta(playlistId);
    } catch (error) {
        logger.warn("Spotify playlist meta fetch failed; falling back to title-only.", {
            message: error?.message || String(error),
        });
        meta = null;
    }

    const title = meta?.name || (await fetchSpotifyOEmbedTitle(playlistUrl)) || "Spotify Playlist";
    const totalTracks = Math.max(0, Number(meta?.totalTracks) || 0);

    if (totalTracks > 0) {
        const guildId = message.guild?.id;
        const voiceChannelId = voiceChannel?.id || getState(guildId)?.channelId || null;
        if (!voiceChannelId) {
            return progress.edit("Voice channel tidak ditemukan untuk memproses playlist.");
        }

        const target = Math.min(totalTracks, SPOTIFY_PLAYLIST_IMPORT_MAX_TRACKS);
        const totalBatches = Math.max(1, Math.ceil(target / SPOTIFY_PLAYLIST_IMPORT_BATCH_SIZE));
        await progress.edit(
            `Spotify playlist: ${title}\n` +
            `Terdeteksi ${totalTracks} lagu. Mulai impor bertahap ` +
            `${SPOTIFY_PLAYLIST_IMPORT_BATCH_SIZE}/batch (${totalBatches} batch). ` +
            "Batch 1 diprioritaskan dulu, sisanya menyusul di background."
        );

        startBackgroundImport({
            message,
            progress,
            voiceChannelId,
            playlistId,
            playlistUrl,
            title,
            totalTracks,
            batchSize: SPOTIFY_PLAYLIST_IMPORT_BATCH_SIZE,
            maxTracks: SPOTIFY_PLAYLIST_IMPORT_MAX_TRACKS,
        }).catch((error) => {
            logger.warn("Spotify playlist background import failed.", error);
        });
        return;
    }

    await progress.edit(`Spotify playlist: ${title}\nGagal mengambil daftar lagu; memutar hasil YouTube teratas dari judul playlist...`);

    let youtubeItems = [];
    try {
        youtubeItems = await searchYoutube(title, 1);
    } catch (error) {
        logger.warn("YouTube search failed for Spotify playlist title.", error);
    }

    if (!youtubeItems.length) {
        return progress.edit(
            `Gagal menemukan hasil YouTube untuk: ${title}\n` +
            "Coba ganti kata kunci (mis. tambah nama artis) atau pakai link YouTube."
        );
    }

    const picked = youtubeItems[0];
    const track = markYoutubeTrack({
        url: picked.url,
        title: picked.title || picked.url,
        requestedBy: message.author.tag,
        requestedById: message.author.id,
        requestedByTag: message.author.tag,
        originUrl: playlistUrl,
        info: {
            video_details: {
                title: picked.title || picked.url,
                durationInSec: picked.durationMs ? Math.round(picked.durationMs / 1000) : 0,
                thumbnails: picked.thumbnail ? [{ url: picked.thumbnail }] : [],
            },
        },
    }, {
        sourceUrl: picked.url,
        youtubeVideoId: picked.videoId || null,
    });

    primeYoutubeTrack(track)?.catch((error) => {
        logger.debug("Background audio cache prime failed (Spotify playlist fallback).", {
            videoId: track?.youtubeVideoId || null,
            message: error?.message || String(error),
        });
    });

    let result;
    try {
        result = await enqueueTrack(voiceChannel, track, {
            textChannelId: message.channel.id,
        });
    } catch (error) {
        logger.error("Queue error (Spotify playlist fallback).", error);
        return progress.edit("Gagal memutar audio.");
    }

    try {
        await updateControlPanel(message.client, result.state);
    } catch (error) {
        logger.warn("Failed updating control panel.", error);
    }

    const label = result.started ? "Memutar" : `Ditambahkan ke antrian #${result.position}`;
    return progress.edit(`${label}: ${track.title}`);
}

module.exports = { handleSpotify };
