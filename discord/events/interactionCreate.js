const logger = require("../../utils/logger");
const {
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
const playerManager = require("../player/PlayerManager");

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
            const state = getState(guildId);

            if (state) {
                state.panelChannelId = interaction.channelId;
                state.panelMessageId = interaction.message?.id || state.panelMessageId;
            }

            const voiceRequired = !["refresh", "queue_prev", "queue_next"].includes(action);
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

            if (action !== "refresh" && (!state || !Array.isArray(state.queue) || state.queue.length === 0)) {
                return interaction.reply({
                    content: "Tidak ada musik yang sedang diputar.",
                    ephemeral: true,
                });
            }

            try {
                await interaction.deferUpdate();

                let actionError = null;
                switch (action) {
                    case "prev":
                        if (!(await previousTrack(guildId))) actionError = "Tidak ada lagu sebelumnya.";
                        break;
                    case "pause": {
                        const res = await togglePause(guildId);
                        if (res.status === "idle") actionError = "Gagal pause/resume.";
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
                    case "queue_prev":
                        state.queuePage = Math.max(0, (state.queuePage || 0) - 1);
                        break;
                    case "queue_next":
                        state.queuePage = (state.queuePage || 0) + 1;
                        break;
                    case "switch_engine": {
                        const nextType = (await playerManager.getEngineType(guildId)) === "lavalink" ? "ffmpeg" : "lavalink";
                        await playerManager.setEngine(guildId, nextType);
                        if (state) state.engine = nextType;
                        break;
                    }
                    default:
                        actionError = "Kontrol tidak dikenal.";
                        break;
                }

                if (actionError) {
                    await interaction.followUp({ content: actionError, ephemeral: true }).catch(() => { });
                }

                const updatedState = getState(guildId);
                await interaction.editReply(buildControlPanel(updatedState));
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

                const voiceChannel = interaction.member?.voice?.channel;
                if (!voiceChannel) return interaction.reply({ content: "Join voice dulu!", ephemeral: true });

                try {
                    await interaction.deferUpdate();

                    let track = null;
                    if (item.source === "spotify") {
                        const resolved = await resolveSpotifyTrackToYoutube(item.spotify || item);
                        if (!resolved?.url) {
                            return interaction.followUp({ content: "Gagal petakan Spotify.", ephemeral: true });
                        }
                        track = {
                            ...resolved,
                            requestedBy: interaction.user.tag,
                            requestedById: interaction.member.id
                        };
                    } else {
                        track = {
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
                        };
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
                    const payload = { content: "Terjadi error saat memilih hasil.", ephemeral: true };
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
            }
        }
    },
};
