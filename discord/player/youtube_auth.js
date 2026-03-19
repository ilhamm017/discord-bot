const logger = require("../../utils/logger");
const {
  isYoutubeCookiesError,
  getYoutubeUserFacingError,
} = require("../../utils/common/youtube_error");

const DEFAULT_NOTIFY_COOLDOWN_MS = 10 * 60 * 1000;
const DEFAULT_BLOCK_MS = 10 * 60 * 1000;

async function trySendNotification(client, channelId, content) {
  if (!client || !channelId || !content) return false;
  try {
    let channel = client.channels?.cache?.get?.(channelId) || null;
    if (!channel && typeof client.channels?.fetch === "function") {
      channel = await client.channels.fetch(channelId).catch(() => null);
    }
    if (!channel || typeof channel.send !== "function") return false;
    await channel.send({ content });
    return true;
  } catch (error) {
    logger.debug("Failed sending YouTube auth notification.", {
      channelId,
      message: error?.message || String(error),
    });
    return false;
  }
}

async function recordYoutubeCookiesIssue(guildId, track, error, options = {}) {
  if (!guildId || !track || !error) return false;
  if (!isYoutubeCookiesError(error)) return false;

  const { getGuildState } = require("./voice");
  const state = getGuildState(guildId);
  if (!state) return false;

  const now = Date.now();
  const notifyCooldownMs = Number.isFinite(Number(options.notifyCooldownMs))
    ? Math.max(30_000, Number(options.notifyCooldownMs))
    : DEFAULT_NOTIFY_COOLDOWN_MS;
  const blockMs = Number.isFinite(Number(options.blockMs))
    ? Math.max(30_000, Number(options.blockMs))
    : DEFAULT_BLOCK_MS;

  state.youtubeAuthDetectedAt = now;
  state.youtubeAuthLastVideoId = track?.youtubeVideoId || null;

  if (Array.isArray(state.queue)) {
    const idx = state.queue.indexOf(track);
    if (idx >= 0) {
      state.failedPlaybackByIndex = state.failedPlaybackByIndex || {};
      state.failedPlaybackByIndex[idx] = {
        reason: "youtube_auth",
        at: now,
        until: now + blockMs,
        title: track?.title || null,
        url: track?.originalUrl || track?.url || null,
      };
    }
  }

  const lastNotifiedAt = Number(state.youtubeAuthNotifiedAt) || 0;
  if (now - lastNotifiedAt < notifyCooldownMs) return true;

  const client = options.client || null;
  const channelId = options.channelId || state.panelChannelId || null;
  const message =
    getYoutubeUserFacingError(error) ||
    "Gagal akses YouTube karena cookies YouTube bermasalah/expired. Upload ulang cookies di panel web.";

  const sent = await trySendNotification(client, channelId, message);
  if (sent) state.youtubeAuthNotifiedAt = now;
  return true;
}

module.exports = {
  recordYoutubeCookiesIssue,
};

