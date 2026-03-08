const logger = require("../../utils/logger");
const { getGuildState } = require("../player/voice");
const {
    enqueueTrack,
    getState,
    jumpToIndex,
    leaveVoice,
    previousTrack,
    setRepeatMode,
    shuffleQueue,
    skipTrack,
    stopPlayback,
    togglePause,
} = require("../player/queue");
const { buildControlPanel, updateControlPanel } = require("../player/panel");
const { getSearchSession, clearSearchSession } = require("../player/search");
const { resolveSpotifyTrackToYoutube } = require("../../utils/common/spotify");
const {
    markYoutubeTrack,
    primeMyInstantsTrack,
    primeYoutubeTrack,
} = require("../../utils/common/media_cache");
const { getYoutubeUserFacingError } = require("../../utils/common/youtube_error");
const {
    buildMyInstantsTrack,
    resolveMyInstantsResult,
} = require("../../utils/common/myinstants");

module.exports = {
    name: "interactionCreate",
    async execute(interaction) {
        const client = interaction.client;

        if (interaction.isButton()) {
            if (interaction.customId.startsWith("member_list_")) {
                const {
                    getMemberListSession,
                    updateMemberListSession,
                    buildMemberListComponents,
                } = require("../member_list");
                const { listMembers } = require("../../functions/platform/identity_logic");
                const { formatMemberList } = require("../../functions/utils/member_list_format");

                if (!interaction.guild) {
                    return interaction.reply({
                        content: "Perintah ini hanya bisa dipakai di server.",
                        ephemeral: true,
                    });
                }

                const session = getMemberListSession(interaction.message?.id);
                if (!session) {
                    return interaction.reply({
                        content: "Sesi daftar member sudah habis. Minta daftar lagi ya.",
                        ephemeral: true,
                    });
                }

                if (session.requesterId && interaction.user.id !== session.requesterId) {
                    return interaction.reply({
                        content: `Daftar ini milik <@${session.requesterId}>.`,
                        ephemeral: true,
                    });
                }

                const action = interaction.customId.slice("member_list_".length);
                const limit = Math.max(1, Number.isFinite(session.limit) ? session.limit : 10);
                let offset = Math.max(0, Number.isFinite(session.offset) ? session.offset : 0);
                if (action === "next") offset += limit;
                if (action === "prev") offset = Math.max(0, offset - limit);

                const result = await listMembers(session.guildId, limit, offset);
                const items = Array.isArray(result?.items) ? result.items : [];
                if (!items.length) {
                    return interaction.reply({
                        content: "Udah habis. Gak ada list berikutnya.",
                        ephemeral: true,
                    });
                }

                const total = typeof result.total === "number" ? result.total : session.total;
                const hasMore = offset + items.length < total;

                const { header, body } = formatMemberList(items, offset, total);
                const content = `${header}\n${body}\n\n${hasMore ? "Pakai tombol di bawah ya." : "Udah segitu aja."}`;

                updateMemberListSession(interaction.message?.id, {
                    offset,
                    limit,
                    total,
                    hasMore,
                });

                await interaction.update({
                    content,
                    components: buildMemberListComponents({
                        offset,
                        limit,
                        total,
                        hasMore,
                    }),
                });
                return;
            }

            if (!interaction.customId.startsWith("music_")) return;

            if (!interaction.guild) {
                return interaction.reply({
                    content: "Perintah ini hanya bisa dipakai di server.",
                    ephemeral: true,
                });
            }

            const action = interaction.customId.slice("music_".length);
            const guildId = interaction.guild.id;
            const canonicalState = getGuildState(guildId);
            const state = canonicalState || getState(guildId);

            if (state) {
                state.panelChannelId = interaction.channelId;
                state.panelMessageId = interaction.message?.id || state.panelMessageId;
            }

            const voiceRequired = !["refresh", "panel_prev", "panel_next", "history_toggle"].includes(action);
            if (voiceRequired) {
                const voiceChannel = interaction.member?.voice?.channel;
                if (!voiceChannel) {
                    return interaction.reply({
                        content: "Kamu harus join voice channel dulu.",
                        ephemeral: true,
                    });
                }

                if (state?.channelId && voiceChannel.id !== state.channelId) {
                    return interaction.reply({
                        content: "Kamu harus berada di voice channel yang sama dengan bot.",
                        ephemeral: true,
                    });
                }
            }

            const hasQueue = Boolean(state && Array.isArray(state.queue) && state.queue.length > 0);
            const hasHistory = Boolean(state && Array.isArray(state.playHistory) && state.playHistory.length > 0);
            const isHistoryOnlyAction =
                action === "history_toggle" ||
                (action === "panel_prev" && state?.panelView === "history") ||
                (action === "panel_next" && state?.panelView === "history");

            if (action !== "refresh" && !hasQueue && !(isHistoryOnlyAction && hasHistory)) {
                return interaction.reply({
                    content: "Tidak ada musik yang sedang diputar.",
                    ephemeral: true,
                });
            }

            try {
                await interaction.deferUpdate();

                let actionError = null;
                let needsPostRefresh = false;
                switch (action) {
                    case "prev":
                        if (!(await previousTrack(guildId))) actionError = "Tidak ada lagu sebelumnya.";
                        break;
                    case "pause": {
                        const res = await togglePause(guildId);
                        if (res.status === "idle") actionError = "Gagal pause/resume.";
                        needsPostRefresh = true;
                        break;
                    }
                    case "next":
                        if (!(await skipTrack(guildId))) actionError = "Gagal skip lagu.";
                        break;
                    case "stop":
                        if (!(await stopPlayback(guildId))) actionError = "Gagal menghentikan musik.";
                        break;
                    case "leave":
                        if (!(await leaveVoice(guildId))) actionError = "Bot belum ada di voice.";
                        break;
                    case "shuffle":
                        if (!(await shuffleQueue(guildId))) actionError = "Antrian kosong.";
                        break;
                    case "loop_track":
                        await setRepeatMode(guildId, state?.repeatMode === "track" ? "off" : "track");
                        break;
                    case "loop_all":
                        await setRepeatMode(guildId, state?.repeatMode === "all" ? "off" : "all");
                        break;
                    case "refresh":
                        break;
                    case "history_toggle":
                        if (!Array.isArray(state?.playHistory) || state.playHistory.length === 0) {
                            actionError = "History playback masih kosong.";
                            break;
                        }
                        state.panelView = state.panelView === "history" ? "queue" : "history";
                        break;
                    case "panel_prev":
                        if (state.panelView === "history") {
                            state.historyPage = Math.max(0, (state.historyPage || 0) - 1);
                        } else {
                            state.queuePage = Math.max(0, (state.queuePage || 0) - 1);
                        }
                        break;
                    case "panel_next":
                        if (state.panelView === "history") {
                            state.historyPage = (state.historyPage || 0) + 1;
                        } else {
                            state.queuePage = (state.queuePage || 0) + 1;
                        }
                        break;
                    default:
                        actionError = "Kontrol tidak dikenal.";
                        break;
                }

                if (actionError) {
                    await interaction.followUp({ content: actionError, ephemeral: true }).catch(() => { });
                }

                const updatedState = getState(guildId);
                await interaction.editReply(buildControlPanel(updatedState));
                if (needsPostRefresh) {
                    // Lavalink pause/resume can update flags a tick later;
                    // force one additional refresh to keep play/pause button in sync.
                    await new Promise((resolve) => setTimeout(resolve, 200));
                    const latestState = getState(guildId);
                    await updateControlPanel(client, latestState);
                }
            } catch (error) {
                logger.error("Control panel button failed.", error);
                const payload = { content: "Terjadi error saat menjalankan kontrol.", ephemeral: true };
                if (interaction.deferred || interaction.replied) await interaction.followUp(payload).catch(() => { });
                else await interaction.reply(payload).catch(() => { });
            }
            return;
        }

        if (interaction.isStringSelectMenu()) {
            if (interaction.customId === "music_search") {
                if (!interaction.guild) return interaction.reply({ content: "Perintah ini hanya bisa di server.", ephemeral: true });

                const session = getSearchSession(interaction.message?.id);
                if (!session) return interaction.reply({ content: "Sesi habis.", ephemeral: true });

                const item = session.results[Number(interaction.values?.[0])];
                if (!item) return interaction.reply({ content: "Hasil tidak ditemukan.", ephemeral: true });

                let voiceChannel = null;
                if (session.voiceChannelId) {
                    voiceChannel =
                        interaction.guild.channels.cache.get(session.voiceChannelId) ||
                        (await interaction.guild.channels.fetch(session.voiceChannelId).catch(() => null));
                }
                if (!voiceChannel) {
                    voiceChannel = interaction.member?.voice?.channel || null;
                }
                if (!voiceChannel) return interaction.reply({ content: "Join voice dulu!", ephemeral: true });

                try {
                    await interaction.deferUpdate();

                    let track = null;
                    if (item.source === "spotify") {
                        const resolved = await resolveSpotifyTrackToYoutube(item.spotify || item);
                        if (!resolved?.url) {
                            return interaction.followUp({
                                content: "Gagal memetakan Spotify ke YouTube. Coba lagi atau cek cookies YouTube di panel web.",
                                ephemeral: true
                            });
                        }
                        track = markYoutubeTrack({
                            ...resolved,
                            requestedBy: interaction.user.tag,
                            requestedById: interaction.member.id
                        }, {
                            sourceUrl: resolved.originalUrl || resolved.url,
                            youtubeVideoId: resolved.youtubeVideoId || null,
                        });
                    } else if (item.source === "myinstants") {
                        const resolved = await resolveMyInstantsResult(item);
                        track = buildMyInstantsTrack(resolved, {
                            requestedBy: interaction.user.tag,
                            requestedById: interaction.member.id,
                            requestedByTag: interaction.user.tag,
                        });
                    } else {
                        track = markYoutubeTrack({
                            url: item.url,
                            title: item.title,
                            requestedBy: interaction.user.tag,
                            requestedById: interaction.member.id,
                            info: {
                                video_details: {
                                    title: item.title,
                                    durationInSec: item.durationMs ? item.durationMs / 1000 : 0,
                                    thumbnails: item.thumbnail ? [{ url: item.thumbnail }] : []
                                }
                            }
                        }, {
                            sourceUrl: item.url,
                            youtubeVideoId: item.videoId || null,
                        });
                    }

                    if (track?.source === "youtube" || track?.source === "myinstants") {
                        const primePromise = track?.source === "myinstants"
                            ? primeMyInstantsTrack(track)
                            : primeYoutubeTrack(track);
                        primePromise?.catch((error) => {
                            logger.debug("Background audio cache prime failed.", {
                                source: track?.source || null,
                                videoId: track?.youtubeVideoId || null,
                                cacheKey: track?.cacheKey || null,
                                message: error?.message || String(error),
                            });
                        });
                    }

                    const { enqueueTrack } = require("../player/queue");
                    const result = await enqueueTrack(voiceChannel, track, {
                        textChannelId: interaction.channelId
                    });

                    clearSearchSession(interaction.message?.id);
                    const label = result.started ? "Memutar" : "Ditambahkan ke antrian";
                    await interaction.editReply({ content: `${label}: ${track.title}`, components: [] });

                    // Panel update is handled inside enqueueTrack via playNext (if started)
                    // but if it was just added to queue, we need to notify panel manually
                    if (!result.started) {
                        const { notifyPanel } = require("../player/queue/state");
                        notifyPanel(result.state, "enqueue");
                    }
                } catch (error) {
                    logger.error("Search select failed.", error);
                    const payload = {
                        content: getYoutubeUserFacingError(error, { spotify: item?.source === "spotify" }) || "Terjadi error saat memilih hasil.",
                        ephemeral: true
                    };
                    if (interaction.deferred || interaction.replied) await interaction.followUp(payload).catch(() => { });
                    else await interaction.reply(payload).catch(() => { });
                }
                return;
            }

            if (interaction.customId === "music_select") {
                const guildId = interaction.guildId;
                const state = getState(guildId);
                const targetIndex = Number(interaction.values?.[0]);

                try {
                    await interaction.deferUpdate();
                    const { jumpToIndex } = require("../player/queue");
                    await jumpToIndex(guildId, targetIndex);
                    const updatedState = getState(guildId);
                    await interaction.editReply(buildControlPanel(updatedState));
                } catch (error) {
                    logger.error("Queue select failed.", error);
                    const payload = { content: "Terjadi error saat memilih antrian.", ephemeral: true };
                    if (interaction.deferred || interaction.replied) await interaction.followUp(payload).catch(() => { });
                    else await interaction.reply(payload).catch(() => { });
                }
                return;
            }

            if (interaction.customId === "music_history_select") {
                if (!interaction.guild) {
                    return interaction.reply({ content: "Perintah ini hanya bisa di server.", ephemeral: true });
                }

                const guildId = interaction.guildId;
                const state = getState(guildId);
                const targetIndex = Number(interaction.values?.[0]);
                const history = Array.isArray(state?.playHistory) ? state.playHistory : [];
                const selectedTrack = history[targetIndex];

                if (!selectedTrack) {
                    return interaction.reply({ content: "Lagu history tidak ditemukan.", ephemeral: true });
                }

                const voiceChannel = interaction.member?.voice?.channel;
                if (!voiceChannel) {
                    return interaction.reply({ content: "Kamu harus join voice channel dulu.", ephemeral: true });
                }
                if (state?.channelId && voiceChannel.id !== state.channelId) {
                    return interaction.reply({
                        content: "Kamu harus berada di voice channel yang sama dengan bot.",
                        ephemeral: true,
                    });
                }

                try {
                    await interaction.deferUpdate();
                    const replayTrack = {
                        ...selectedTrack,
                        info: selectedTrack.info
                            ? JSON.parse(JSON.stringify(selectedTrack.info))
                            : null,
                    };
                    const result = await enqueueTrack(voiceChannel, replayTrack, {
                        textChannelId: interaction.channelId,
                    });
                    const updatedState = getState(guildId);
                    await interaction.editReply(buildControlPanel(updatedState));
                    await interaction.followUp({
                        content: result.started
                            ? `Memutar lagi: ${replayTrack.title}`
                            : `Ditambahkan dari history ke antrian: ${replayTrack.title}`,
                        ephemeral: true,
                    }).catch(() => { });
                } catch (error) {
                    logger.error("History select failed.", error);
                    const payload = { content: "Terjadi error saat memilih lagu history.", ephemeral: true };
                    if (interaction.deferred || interaction.replied) await interaction.followUp(payload).catch(() => { });
                    else await interaction.reply(payload).catch(() => { });
                }
            }
        }
    },
};
