const logger = require("../utils/logger");
const { connectDB, sequelize } = require("./sequelize");
const { QueueState, QueueItem } = require("../models/Queue");
const Favorite = require("../models/Favorite");
const User = require("../models/User");
const SpotifyCache = require("../models/SpotifyCache");
const UserMemory = require("../models/UserMemory");
const { Op } = require("sequelize");

async function ensureReady() {
  try {
    await sequelize.authenticate();
    return true;
  } catch (error) {
    return false;
  }
}

// -----------------------------------------------------------------------------
// Queue State
// -----------------------------------------------------------------------------
async function saveQueueState(guildId, state) {
  if (!guildId || !state) return;
  const queue = Array.isArray(state.queue) ? state.queue : [];

  try {
    await sequelize.transaction(async (t) => {
      // 1. Upsert Queue State
      await QueueState.upsert({
        guildId,
        currentIndex: state.currentIndex,
        repeatMode: state.repeatMode || "off",
        engine: state.engine || "ffmpeg",
      }, { transaction: t });

      // 2. Overwrite Queue Items
      await QueueItem.destroy({ where: { guildId }, transaction: t });

      const items = queue.map((track, index) => ({
        guildId,
        position: index,
        url: track?.url || "",
        title: track?.title || track?.url || "",
        requestedById: track?.requestedById || null,
        requestedByTag: track?.requestedByTag || null,
        metadataJson: track?.info ? JSON.stringify(track.info) : null,
      }));

      if (items.length > 0) {
        await QueueItem.bulkCreate(items, { transaction: t });
      }
    });
  } catch (error) {
    logger.error("Failed saving queue state (Sequelize).", error);
  }
}

function loadQueueState(guildId) {
  return loadQueueStateAsync(guildId);
}

async function loadQueueStateAsync(guildId) {
  if (!guildId) return null;
  try {
    const queueState = await QueueState.findByPk(guildId);
    if (!queueState) return null;

    const items = await QueueItem.findAll({
      where: { guildId },
      order: [["position", "ASC"]],
    });

    const queue = items.map((item) => ({
      url: item.url,
      title: item.title,
      requestedById: item.requestedById || null,
      requestedByTag: item.requestedByTag || null,
      requestedBy: item.requestedByTag || item.requestedById || "-",
      info: item.metadataJson ? JSON.parse(item.metadataJson) : null,
    }));

    return {
      queue,
      currentIndex: queueState.currentIndex,
      repeatMode: queueState.repeatMode || "off",
      engine: queueState.engine || "ffmpeg",
    };
  } catch (error) {
    logger.error("Failed loading queue state (Sequelize).", error);
    return null;
  }
}

async function clearQueueState(guildId) {
  if (!guildId) return;
  try {
    await sequelize.transaction(async (t) => {
      await QueueItem.destroy({ where: { guildId }, transaction: t });
      await QueueState.destroy({ where: { guildId }, transaction: t });
    });
  } catch (error) {
    logger.error("Failed clearing queue state (Sequelize).", error);
  }
}

// -----------------------------------------------------------------------------
// Favorites
// -----------------------------------------------------------------------------
function extractVideoId(url) {
  if (!url || typeof url !== "string") return null;
  const match = url.match(/[?&]v=([a-zA-Z0-9_-]{11})/);
  if (match) return match[1];
  const shortMatch = url.match(/youtu\.be\/([a-zA-Z0-9_-]{11})/);
  if (shortMatch) return shortMatch[1];
  return null;
}

async function recordPlay({ userId, url, title }) {
  if (!userId || !url) return;
  const videoId = extractVideoId(url) || url;

  try {
    const existing = await Favorite.findOne({ where: { userId, videoId } });
    if (existing) {
      existing.playCount += 1;
      existing.lastPlayedAt = new Date();
      existing.title = title || url;
      existing.url = url;
      await existing.save();
    } else {
      await Favorite.create({
        userId,
        videoId,
        url,
        title: title || url,
        playCount: 1,
        lastPlayedAt: new Date(),
      });
    }
  } catch (error) {
    logger.error("Failed recording favorite play (Sequelize).", error);
  }
}

// Callers expect Sync return or Promise? Better-sqlite was Sync.
// I WILL CHANGE ALL EXPORTS TO ASYNC. This is a BREAKING CHANGE for the internal modules, 
// so I must update `discord/commands/music/play/favorites.js` etc.
async function getFavoriteTracks(userId, { minPlays = 5, limit = 20 } = {}) {
  try {
    const favs = await Favorite.findAll({
      where: {
        userId,
        playCount: { [Op.gte]: minPlays },
      },
      order: [
        ["playCount", "DESC"],
        ["lastPlayedAt", "DESC"],
        ["title", "ASC"],
      ],
      limit,
    });
    return favs;
  } catch (error) {
    logger.error("Failed loading favorites (Sequelize).", error);
    return [];
  }
}

async function listFavorites(userId, { minPlays = 1, limit = 20 } = {}) {
  return getFavoriteTracks(userId, { minPlays, limit });
}

async function deleteFavorite(userId, videoId) {
  if (!userId || !videoId) return false;
  try {
    const deleted = await Favorite.destroy({ where: { userId, videoId } });
    return deleted > 0;
  } catch (error) {
    logger.error("Failed deleting favorite (Sequelize).", error);
    return false;
  }
}

// -----------------------------------------------------------------------------
// User Preferences (Call Name)
// -----------------------------------------------------------------------------
async function setUserCallName(userId, callName) {
  try {
    const [user] = await User.findOrCreate({ where: { id: userId } });
    user.callName = callName;
    await user.save();
    return true;
  } catch (error) {
    logger.error("Failed saving user call name (Sequelize).", error);
    return false;
  }
}

async function getUserCallName(userId) {
  try {
    const user = await User.findByPk(userId);
    return user?.callName || null;
  } catch (error) {
    logger.error("Failed loading user call name (Sequelize).", error);
    return null;
  }
}

async function clearUserCallName(userId) {
  try {
    const user = await User.findByPk(userId);
    if (!user) return false;
    user.callName = null;
    await user.save();
    return true;
  } catch (error) {
    logger.error("Failed clearing user call name (Sequelize).", error);
    return false;
  }
}

// -----------------------------------------------------------------------------
// Spotify Cache
// -----------------------------------------------------------------------------
async function saveSpotifyCache(entry) {
  if (!entry?.spotifyId || !entry?.youtubeUrl) return false;
  try {
    await SpotifyCache.upsert({
      spotifyId: entry.spotifyId,
      title: entry.title || "",
      artists: entry.artists || "",
      durationMs: Number(entry.durationMs) || 0,
      youtubeUrl: entry.youtubeUrl,
    });
    return true;
  } catch (error) {
    logger.error("Failed saving Spotify cache (Sequelize).", error);
    return false;
  }
}

async function getSpotifyCache(spotifyId) {
  try {
    const cache = await SpotifyCache.findByPk(spotifyId);
    if (!cache) return null;
    return cache; // Sequelize model instance is compatible enough
  } catch (error) {
    logger.error("Failed loading Spotify cache (Sequelize).", error);
    return null;
  }
}

// -----------------------------------------------------------------------------
// User Memory
// -----------------------------------------------------------------------------
async function addUserMemory({ userId, kind, value }) {
  try {
    // Upsert via findOrCreate + update or direct upsert if composite key is handled
    // Sequelize upsert on composite PK works in SQLite/Postgres
    await UserMemory.upsert({
      userId,
      kind,
      value,
    });
    return true;
  } catch (error) {
    logger.error("Failed saving user memory (Sequelize).", error);
    return false;
  }
}

async function listUserMemory(userId, { limit = 10, ttlDays = 90 } = {}) {
  const safeLimit = Math.max(1, Math.min(Number(limit) || 10, 50));
  const ttl = Number(ttlDays) || 0;
  const cutoff = ttl > 0 ? new Date(Date.now() - ttl * 86400 * 1000) : null;

  const where = { userId };
  if (cutoff) {
    where.updatedAt = { [Op.gte]: cutoff };
  }

  try {
    const rows = await UserMemory.findAll({
      where,
      order: [["updatedAt", "DESC"]],
      limit: safeLimit,
    });
    return rows.map(r => ({ kind: r.kind, value: r.value, updated_at: r.updatedAt }));
  } catch (error) {
    logger.error("Failed loading user memory (Sequelize).", error);
    return [];
  }
}

// No-op for initDatabase as sequelize connectDB is handled in index.js, 
// but we keep it for API compatibility if something calls it.
function initDatabase() {
  return connectDB();
}

const UserQueueHistory = require("../models/UserQueueHistory");

// ... (existing imports)

// -----------------------------------------------------------------------------
// User Queue History (Personal Restore)
// -----------------------------------------------------------------------------
async function saveUserQueueHistory(userId, guildId, state) {
  if (!userId || !guildId || !state || !state.queue) return;
  try {
    const payload = {
      tracks: state.queue,
      repeatMode: state.repeatMode || "off"
    };

    await UserQueueHistory.upsert({
      userId,
      guildId,
      queueJson: JSON.stringify(payload),
      currentIndex: state.currentIndex
    });
  } catch (error) {
    logger.error("Failed saving user queue history.", error);
  }
}

async function loadUserQueueHistory(userId, guildId) {
  if (!userId || !guildId) return null;
  try {
    const history = await UserQueueHistory.findOne({
      where: { userId, guildId }
    });
    if (!history) return null;

    const payload = JSON.parse(history.queueJson);
    return {
      queue: payload.tracks || [],
      currentIndex: history.currentIndex,
      repeatMode: payload.repeatMode || "off"
    };
  } catch (error) {
    logger.error("Failed loading user queue history.", error);
    return null;
  }
}

module.exports = {
  // ... existing exports ...
  initDatabase,
  saveQueueState,
  loadQueueState,
  clearQueueState,
  recordPlay,
  getFavoriteTracks,
  listFavorites,
  deleteFavorite,
  setUserCallName,
  getUserCallName,
  clearUserCallName,
  saveSpotifyCache,
  getSpotifyCache,
  addUserMemory,
  listUserMemory,
  saveUserQueueHistory,
  loadUserQueueHistory,
};
