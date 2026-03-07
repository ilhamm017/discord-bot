const { LavalinkManager } = require("lavalink-client");
const logger = require("../../utils/logger");

const MANUAL_VOICE_DEDUPE_MS = 2000;
const PENDING_VOICE_WARN_MS = 2000;
const VOICE_PATCH_RETRY_MS = 750;
const VOICE_PATCH_MAX_RETRIES = 3;
const POSITION_DRIFT_WARN_MS = 250;
const POSITION_DRIFT_WARN_STREAK = 3;

class LavalinkService {
    constructor() {
        this.manager = null;
        this.voiceCloseEvents = new Map(); // guildId -> { code, reason, byRemote, at }
        this.autoAdvanceLocks = new Map(); // guildId -> timestamp
        this.pendingVoiceServerUpdates = new Map(); // guildId -> { ...pending update }
        this.recentVoicePatchKeys = new Map(); // guildId -> { key, at }
        this.positionDriftCounts = new Map(); // guildId -> count
        this.watchdogTimer = null;
    }

    canRunAutoAdvance(guildId, cooldownMs = 4000) {
        const now = Date.now();
        const last = this.autoAdvanceLocks.get(guildId) || 0;
        if (now - last < cooldownMs) return false;
        this.autoAdvanceLocks.set(guildId, now);
        return true;
    }

    clearAutoAdvanceLock(guildId) {
        this.autoAdvanceLocks.delete(guildId);
    }

    isNodeAtLeast(node, major, minor) {
        const nodeMajor = Number(node?.info?.version?.major);
        const nodeMinor = Number(node?.info?.version?.minor);
        if (!Number.isFinite(nodeMajor) || !Number.isFinite(nodeMinor)) return false;
        if (nodeMajor > major) return true;
        if (nodeMajor < major) return false;
        return nodeMinor >= minor;
    }

    async waitForPlayerSessionId(player, timeoutMs = 1500) {
        const start = Date.now();
        while (Date.now() - start < timeoutMs) {
            if (player?.voice?.sessionId) return player.voice.sessionId;
            await new Promise((r) => setTimeout(r, 100));
        }
        return player?.voice?.sessionId || null;
    }

    getGuildState(guildId) {
        const { getOrCreateState } = require("./voice");
        return getOrCreateState(guildId);
    }

    updateDiagnostics(guildId, patch) {
        const state = this.getGuildState(guildId);
        state.diagnostics = state.diagnostics || {};
        Object.assign(state.diagnostics, patch);
        return state.diagnostics;
    }

    makeVoicePatchKey({ token, endpoint, sessionId, channelId }) {
        return [token, endpoint, sessionId, channelId].map((value) => value || "").join("|");
    }

    rememberVoiceClose(guildId, data) {
        if (!guildId) return;
        this.voiceCloseEvents.set(guildId, data);
        this.updateDiagnostics(guildId, {
            lastDisconnectAt: data.at || Date.now(),
            lastDisconnectCode: data.code ?? null,
        });
    }

    handleWebSocketClosed(payload) {
        if (!payload?.guildId) return;

        const data = {
            code: payload.code,
            reason: payload.reason,
            byRemote: payload.byRemote,
            at: Date.now(),
        };
        this.rememberVoiceClose(payload.guildId, data);

        if (payload.code === 4017) {
            logger.warn(
                `Lavalink voice closed for guild ${payload.guildId}: ` +
                `code=4017 reason="${payload.reason}".`
            );
        }
    }

    shouldHandleVoiceServerManually(raw, player) {
        if (!this.manager || !raw || raw.t !== "VOICE_SERVER_UPDATE" || !raw.d) return false;
        if (!player || !player.node) return false;
        if (!player.voiceChannelId) return false;
        if (typeof player.get === "function" && player.get("internal_destroying")) return false;
        return this.isNodeAtLeast(player.node, 4, 2);
    }

    schedulePendingVoiceWarning(guildId, pendingAt) {
        const pending = this.pendingVoiceServerUpdates.get(guildId);
        if (!pending) return;
        if (pending.warnTimer) clearTimeout(pending.warnTimer);

        pending.warnTimer = setTimeout(() => {
            const current = this.pendingVoiceServerUpdates.get(guildId);
            if (!current || current.at !== pendingAt) return;

            logger.warn(
                `Pending Lavalink voice update not flushed within ${PENDING_VOICE_WARN_MS}ms ` +
                `for guild ${guildId}.`,
                {
                    hasToken: Boolean(current.token),
                    hasEndpoint: Boolean(current.endpoint),
                    hasSessionId: Boolean(current.sessionId),
                    voiceChannelId: current.voiceChannelId || null,
                }
            );
        }, PENDING_VOICE_WARN_MS);

        if (typeof pending.warnTimer.unref === "function") {
            pending.warnTimer.unref();
        }
    }

    clearPendingVoiceServerUpdate(guildId) {
        const pending = this.pendingVoiceServerUpdates.get(guildId);
        if (pending?.warnTimer) {
            clearTimeout(pending.warnTimer);
        }
        if (pending?.retryTimer) {
            clearTimeout(pending.retryTimer);
        }
        this.pendingVoiceServerUpdates.delete(guildId);
    }

    scheduleVoicePatchRetry(guildId, pending, error) {
        if (!pending) return;
        if (pending.retryTimer) {
            clearTimeout(pending.retryTimer);
        }
        if (pending.retryCount >= VOICE_PATCH_MAX_RETRIES) {
            logger.warn(
                `Manual Lavalink voice patch abandoned after ${VOICE_PATCH_MAX_RETRIES} retries ` +
                `for guild ${guildId}.`,
                error
            );
            return;
        }

        pending.retryCount += 1;
        pending.retryTimer = setTimeout(() => {
            const current = this.pendingVoiceServerUpdates.get(guildId);
            if (!current || current.at !== pending.at) return;
            current.retryTimer = null;
            this.flushPendingVoiceServerUpdate(guildId).catch((retryError) => {
                logger.warn("Retrying Lavalink manual voice patch failed.", retryError);
            });
        }, VOICE_PATCH_RETRY_MS);

        if (typeof pending.retryTimer.unref === "function") {
            pending.retryTimer.unref();
        }

        logger.warn(
            `Manual Lavalink voice patch timed out for guild ${guildId}; ` +
            `retrying in ${VOICE_PATCH_RETRY_MS}ms (${pending.retryCount}/${VOICE_PATCH_MAX_RETRIES}).`,
            error
        );
    }

    storePendingVoiceServerUpdate(raw, player) {
        if (!raw?.d?.guild_id) return null;

        const guildId = raw.d.guild_id;
        const previous = this.pendingVoiceServerUpdates.get(guildId);
        if (previous?.warnTimer) {
            clearTimeout(previous.warnTimer);
        }

        const pending = {
            at: Date.now(),
            guildId,
            token: raw.d.token,
            endpoint: raw.d.endpoint,
            sessionId: raw.d.session_id || player?.voice?.sessionId || null,
            voiceChannelId: player?.voiceChannelId || player?.options?.voiceChannelId || null,
            warnTimer: null,
            retryTimer: previous?.retryTimer || null,
            retryCount: previous?.retryCount || 0,
        };

        this.pendingVoiceServerUpdates.set(guildId, pending);
        this.updateDiagnostics(guildId, {
            lastVoiceServerUpdateAt: pending.at,
            lastVoiceChannelId: pending.voiceChannelId,
        });
        this.schedulePendingVoiceWarning(guildId, pending.at);
        return pending;
    }

    async flushPendingVoiceServerUpdate(guildId) {
        const pending = this.pendingVoiceServerUpdates.get(guildId);
        if (!pending || !this.manager) return false;

        const player = this.manager.players.get(guildId);
        if (!player || !player.node || !player.voiceChannelId) return false;
        if (!this.isNodeAtLeast(player.node, 4, 2)) return false;
        if (!pending.token || !pending.endpoint) return false;

        const sessionId = pending.sessionId ||
            player.voice?.sessionId ||
            await this.waitForPlayerSessionId(player, 2000);
        const channelId = player.voiceChannelId || pending.voiceChannelId;

        if (!sessionId || !channelId) return false;

        const dedupeKey = this.makeVoicePatchKey({
            token: pending.token,
            endpoint: pending.endpoint,
            sessionId,
            channelId,
        });
        const recent = this.recentVoicePatchKeys.get(guildId);
        const now = Date.now();
        if (recent && recent.key === dedupeKey && now - recent.at < MANUAL_VOICE_DEDUPE_MS) {
            this.clearPendingVoiceServerUpdate(guildId);
            return true;
        }

        const diagnostics = this.updateDiagnostics(guildId, {});
        const isNewSession = diagnostics.lastVoiceSessionId !== sessionId;

        try {
            await player.node.updatePlayer({
                guildId: player.guildId,
                playerOptions: {
                    voice: {
                        token: pending.token,
                        endpoint: pending.endpoint,
                        sessionId,
                        channelId,
                    },
                },
            });
        } catch (error) {
            const message = String(error?.message || error?.cause?.message || "");
            if (/timeout/i.test(message)) {
                this.scheduleVoicePatchRetry(guildId, pending, error);
                return false;
            }
            throw error;
        }

        this.recentVoicePatchKeys.set(guildId, { key: dedupeKey, at: now });
        this.clearPendingVoiceServerUpdate(guildId);
        this.updateDiagnostics(guildId, {
            lastVoicePatchAt: now,
            lastVoiceSessionId: sessionId,
            lastVoiceChannelId: channelId,
        });

        logger.info(
            `Manual Lavalink voice patch applied for guild ${guildId}.`,
            {
                channelId,
                endpoint: pending.endpoint,
                sessionMode: isNewSession ? "new" : "repeat",
            }
        );

        return true;
    }

    async handleClientRaw(raw) {
        if (!this.manager || !raw?.t) return;

        if (raw.t === "VOICE_SERVER_UPDATE") {
            const guildId = raw.d?.guild_id;
            const player = guildId ? this.manager.players.get(guildId) : null;

            if (this.shouldHandleVoiceServerManually(raw, player)) {
                this.storePendingVoiceServerUpdate(raw, player);
                await this.flushPendingVoiceServerUpdate(guildId);
                return;
            }

            await this.manager.sendRawData(raw);
            return;
        }

        if (raw.t === "VOICE_STATE_UPDATE") {
            await this.manager.sendRawData(raw);

            const guildId = raw.d?.guild_id;
            const managerClientId = this.manager.options?.client?.id;
            if (guildId && raw.d?.user_id === managerClientId) {
                this.updateDiagnostics(guildId, {
                    lastVoiceSessionId: raw.d.session_id || null,
                    lastVoiceChannelId: raw.d.channel_id || null,
                });
                await this.flushPendingVoiceServerUpdate(guildId);
            }
            return;
        }

        await this.manager.sendRawData(raw);
    }

    handlePlayerUpdate(player) {
        if (!player?.guildId) return;

        const now = Date.now();
        const position = Number.isFinite(player.position)
            ? player.position
            : (Number.isFinite(player.lastPosition) ? player.lastPosition : null);
        const ping = Number.isFinite(player?.ping?.ws)
            ? player.ping.ws
            : (Number.isFinite(player?.ping?.lavalink) ? player.ping.lavalink : null);

        const diagnostics = this.updateDiagnostics(player.guildId, {});
        let drift = null;

        if (
            Number.isFinite(position) &&
            Number.isFinite(diagnostics.lastPlayerPosition) &&
            Number.isFinite(diagnostics.lastPlayerUpdateAt) &&
            player.playing &&
            !player.paused
        ) {
            const elapsed = now - diagnostics.lastPlayerUpdateAt;
            const expectedPosition = diagnostics.lastPlayerPosition + elapsed;
            drift = Math.abs(position - expectedPosition);
        }

        this.updateDiagnostics(player.guildId, {
            lastPlayerPingMs: ping,
            lastPlayerPosition: position,
            lastPlayerUpdateAt: now,
            lastPositionDriftMs: drift,
        });

        if (Number.isFinite(drift) && drift > POSITION_DRIFT_WARN_MS) {
            const driftCount = (this.positionDriftCounts.get(player.guildId) || 0) + 1;
            this.positionDriftCounts.set(player.guildId, driftCount);

            if (driftCount === POSITION_DRIFT_WARN_STREAK) {
                logger.warn(
                    `Lavalink position drift exceeded ${POSITION_DRIFT_WARN_MS}ms ` +
                    `for ${POSITION_DRIFT_WARN_STREAK} consecutive updates in guild ${player.guildId}.`,
                    {
                        driftMs: drift,
                        pingMs: ping,
                        position,
                    }
                );
            }
        } else {
            this.positionDriftCounts.delete(player.guildId);
        }
    }

    handlePlayerDisconnect(player, voiceChannelId) {
        const closeInfo = this.getLastVoiceClose(player.guildId);
        this.updateDiagnostics(player.guildId, {
            lastDisconnectAt: closeInfo?.at || Date.now(),
            lastDisconnectCode: closeInfo?.code ?? null,
            lastVoiceChannelId: voiceChannelId || null,
        });
        logger.info(`Lavalink player disconnected from ${voiceChannelId} in guild: ${player.guildId}`);
    }

    handlePlayerReconnect(player, voiceChannelId) {
        this.updateDiagnostics(player.guildId, {
            lastReconnectAt: Date.now(),
            lastVoiceChannelId: voiceChannelId || player.voiceChannelId || null,
        });
        logger.info(`Lavalink player reconnected to ${voiceChannelId} in guild: ${player.guildId}`);
    }

    handlePlayerMove(player, oldVoiceChannelId, newVoiceChannelId) {
        this.updateDiagnostics(player.guildId, {
            lastVoiceChannelId: newVoiceChannelId || null,
        });
        logger.info(
            `Lavalink player moved in guild ${player.guildId}: ` +
            `${oldVoiceChannelId || "unknown"} -> ${newVoiceChannelId || "unknown"}`
        );
    }

    async runAutoAdvanceWatchdog() {
        if (!this.manager || !this.manager.players) return;

        const { getGuildState } = require("./voice");
        const { playNext, playIndex } = require("./queue/playback");
        const now = Date.now();

        const players = Array.from(this.manager.players.values());
        for (const player of players) {
            const guildId = player?.guildId;
            if (!guildId) continue;

            // Only attempt recovery when Lavalink is truly idle.
            if (player.playing || player.paused) {
                this.clearAutoAdvanceLock(guildId);
                continue;
            }

            const state = getGuildState(guildId);
            if (!state || !Array.isArray(state.queue) || state.queue.length === 0) continue;
            if (!state.channelId) continue;
            if (state.currentIndex < 0) continue;

            // Avoid duplicate starts while a queue transition is still in flight.
            if (state.pendingPlayToken) continue;
            if (
                Number.isFinite(state.lastPlaybackRequestAt) &&
                now - state.lastPlaybackRequestAt < 6000
            ) {
                continue;
            }
            if (
                Number.isFinite(state.lastTrackStartAt) &&
                now - state.lastTrackStartAt < 3000
            ) {
                continue;
            }

            if (!this.canRunAutoAdvance(guildId)) continue;

            try {
                const mode = state.repeatMode || "off";
                if (mode === "track" && state.queue[state.currentIndex]) {
                    logger.warn(
                        `Watchdog auto-repeating Lavalink track in guild ${guildId} ` +
                        `(currentIndex=${state.currentIndex}).`
                    );
                    await playIndex(state, state.currentIndex, { allowWrap: false, maxAttempts: 1 });
                } else if (state.currentIndex < state.queue.length - 1) {
                    logger.warn(
                        `Watchdog auto-advancing Lavalink queue in guild ${guildId} ` +
                        `(currentIndex=${state.currentIndex}, queue=${state.queue.length}).`
                    );
                    await playNext(state);
                } else if (mode === "all" && state.queue.length > 0) {
                    logger.warn(
                        `Watchdog auto-looping Lavalink queue in guild ${guildId}.`
                    );
                    await playIndex(state, 0, { allowWrap: false });
                }
            } catch (error) {
                logger.warn(`Lavalink auto-advance watchdog failed for guild ${guildId}.`, error);
            }
        }
    }

    init(nodes) {
        if (this.manager) return;

        const { client } = require("../client");

        logger.info(`Initializing Lavalink with ${nodes.length} nodes.`);

        this.manager = new LavalinkManager({
            nodes: nodes,
            sendToShard: (guildId, payload) => {
                const guild = client.guilds.cache.get(guildId);
                if (!guild) {
                    logger.warn(`sendToShard failed: guild ${guildId} not found in cache.`);
                    return;
                }

                const shardFromGuild =
                    guild.shard && typeof guild.shard.send === "function"
                        ? guild.shard
                        : null;
                const shardFromWs =
                    client.ws?.shards?.get?.(guild.shardId ?? 0) ||
                    (typeof client.ws?.shards?.first === "function"
                        ? client.ws.shards.first()
                        : null);
                const shard = shardFromGuild || shardFromWs;

                if (!shard || typeof shard.send !== "function") {
                    logger.error(
                        `sendToShard failed: shard sender unavailable for guild ${guildId}.`
                    );
                    return;
                }

                shard.send(payload);
            },
            client: {
                id: client.user.id,
                username: client.user.username,
            },
            autoSkip: true,
            playerOptions: {
                clientBasedPositionUpdateInterval: 100,
                defaultSearchPlatform: "ytsearch",
                volumeDecrementer: 1,
                onDisconnect: {
                    destroyPlayer: false,
                    autoReconnect: true,
                    autoReconnectOnlyWithTracks: true,
                },
            }
        });

        logger.info(`LavalinkManager created. Nodes in manager: ${this.manager.nodes?.size || this.manager.nodeManager?.nodes?.size || 0}`);

        this.manager.on("debug", (info) => logger.debug(`Lavalink Debug: ${info}`));

        const nodeController = this.manager.nodeManager || this.manager;

        nodeController.on("connect", (node) => {
            logger.info(`Lavalink Node connected: ${node.id || node.options?.id}`);
        });

        nodeController.on("error", (node, error) => {
            logger.error(`Lavalink Node error:`, error);
        });

        nodeController.on("raw", (node, payload) => {
            if (
                payload &&
                payload.op === "event" &&
                payload.type === "WebSocketClosedEvent" &&
                payload.guildId
            ) {
                this.handleWebSocketClosed(payload);
            }
        });

        nodeController.on("disconnect", (node, reason) => {
            logger.warn(`Lavalink Node disconnected: ${node.id}. Reason: ${reason}`);
        });

        nodeController.on("reconnecting", (node) => {
            logger.info(`Lavalink Node reconnecting: ${node.id}`);
        });

        this.manager.on("trackStart", (player, track) => {
            logger.info(`Lavalink playing: ${track.info.title} in ${player.guildId}`);
            try {
                const state = this.getGuildState(player.guildId);
                state.lastTrackStartAt = Date.now();
                this.updateDiagnostics(player.guildId, {
                    lastVoiceChannelId: player.voiceChannelId || null,
                });
            } catch (error) {
                logger.debug(`Failed to stamp lastTrackStartAt for guild ${player.guildId}.`, error);
            }
        });

        this.manager.on("trackEnd", async (player, track, payload) => {
            logger.info(`Lavalink track ended: ${track.info.title} (${payload.reason})`);

            try {
                const { handleSpeechPlaybackLifecycleEvent } = require("../../utils/common/ai_voice");
                if (await handleSpeechPlaybackLifecycleEvent(player, payload)) {
                    return;
                }
            } catch (error) {
                logger.warn(`Speech playback lifecycle handling failed in guild ${player.guildId}.`, error);
            }

            if (payload.reason === "replaced") return;
            if (payload.reason === "loadFailed") {
                logger.error("Lavalink load failed", payload);
            }

            try {
                const { playNext, playIndex } = require("./queue/playback");
                const { getGuildState } = require("./voice");

                const state = getGuildState(player.guildId);
                if (!state || !Array.isArray(state.queue) || state.queue.length === 0) {
                    return;
                }

                const mode = state.repeatMode || "off";
                if (mode === "track") {
                    const repeatIndex = state.currentIndex >= 0 ? state.currentIndex : 0;
                    if (state.queue[repeatIndex]) {
                        await playIndex(state, repeatIndex);
                        return;
                    }
                }

                if (state.currentIndex < state.queue.length - 1) {
                    await playNext(state);
                    return;
                }

                if (mode === "all") {
                    await playIndex(state, 0);
                }
            } catch (error) {
                logger.error(`Lavalink trackEnd handler failed in guild ${player.guildId}.`, error);
            }
        });

        this.manager.on("trackException", (player, track, payload) => {
            logger.error(`Lavalink track exception in ${player.guildId}: ${track.info.title}`, payload.exception);
            const { handleSpeechPlaybackLifecycleEvent } = require("../../utils/common/ai_voice");
            handleSpeechPlaybackLifecycleEvent(player, {
                type: "trackException",
                reason: payload?.exception?.message || "trackException",
            }).catch((error) => {
                logger.warn(`Speech playback exception recovery failed in guild ${player.guildId}.`, error);
            });
        });

        this.manager.on("trackStuck", (player, track, payload) => {
            logger.warn(`Lavalink track stuck in ${player.guildId}: ${track.info.title}`, payload);
            const { handleSpeechPlaybackLifecycleEvent } = require("../../utils/common/ai_voice");
            handleSpeechPlaybackLifecycleEvent(player, {
                type: "trackStuck",
                reason: "trackStuck",
            }).catch((error) => {
                logger.warn(`Speech playback stuck recovery failed in guild ${player.guildId}.`, error);
            });
        });

        this.manager.on("playerCreate", (player) => {
            this.updateDiagnostics(player.guildId, {
                lastVoiceChannelId: player.voiceChannelId || null,
            });
            logger.info(`Lavalink player created for guild: ${player.guildId}`);
        });

        this.manager.on("playerDestroy", (player, reason) => {
            this.clearPendingVoiceServerUpdate(player.guildId);
            this.positionDriftCounts.delete(player.guildId);
            logger.info(`Lavalink player destroyed for guild: ${player.guildId}. Reason: ${reason}`);
        });

        this.manager.on("playerDisconnect", (player, voiceChannelId) => {
            this.handlePlayerDisconnect(player, voiceChannelId);
        });

        this.manager.on("playerReconnect", (player, voiceChannelId) => {
            this.handlePlayerReconnect(player, voiceChannelId);
        });

        this.manager.on("playerMove", (player, oldVoiceChannelId, newVoiceChannelId) => {
            this.handlePlayerMove(player, oldVoiceChannelId, newVoiceChannelId);
        });

        this.manager.on("playerUpdate", (_oldPlayer, player) => {
            this.handlePlayerUpdate(player);
        });

        client.on("raw", (d) => {
            this.handleClientRaw(d).catch((error) => {
                logger.warn("Failed to process Discord raw voice event for Lavalink.", error);
            });
        });

        logger.info("Calling manager.init() to start Lavalink connections...");
        this.manager.init({
            id: client.user.id,
            username: client.user.username
        });

        if (!this.watchdogTimer) {
            this.watchdogTimer = setInterval(() => {
                this.runAutoAdvanceWatchdog().catch((error) => {
                    logger.warn("Lavalink auto-advance watchdog error.", error);
                });
            }, 5000);
            if (typeof this.watchdogTimer.unref === "function") {
                this.watchdogTimer.unref();
            }
        }

        return this.manager;
    }

    getManager() {
        return this.manager;
    }

    getPlayer(guildId) {
        return this.manager?.players.get(guildId);
    }

    getLastVoiceClose(guildId) {
        return this.voiceCloseEvents.get(guildId) || null;
    }

    clearLastVoiceClose(guildId) {
        this.voiceCloseEvents.delete(guildId);
    }
}

module.exports = new LavalinkService();
