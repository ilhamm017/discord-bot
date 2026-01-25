const fs = require("fs");
const path = require("path");
const Database = require("better-sqlite3");
const logger = require("../utils/logger");

const dataDir = path.resolve(process.cwd(), ".data");
const dbPath = path.join(dataDir, "bot.db");

let db = null;
let statements = null;

function initDatabase() {
  if (db) return db;

  try {
    fs.mkdirSync(dataDir, { recursive: true });
    db = new Database(dbPath);
    db.pragma("journal_mode = WAL");
    db.pragma("foreign_keys = ON");

    db.exec(`
      CREATE TABLE IF NOT EXISTS queue_state (
        guild_id TEXT PRIMARY KEY,
        current_index INTEGER NOT NULL DEFAULT -1,
        repeat_mode TEXT NOT NULL DEFAULT 'off',
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS queue_items (
        guild_id TEXT NOT NULL,
        position INTEGER NOT NULL,
        url TEXT NOT NULL,
        title TEXT NOT NULL,
        requested_by_id TEXT,
        requested_by_tag TEXT,
        PRIMARY KEY (guild_id, position)
      );

      CREATE INDEX IF NOT EXISTS idx_queue_items_guild
        ON queue_items (guild_id);

      CREATE TABLE IF NOT EXISTS favorites (
        user_id TEXT NOT NULL,
        video_id TEXT NOT NULL,
        url TEXT NOT NULL,
        title TEXT NOT NULL,
        play_count INTEGER NOT NULL DEFAULT 0,
        last_played_at INTEGER NOT NULL,
        PRIMARY KEY (user_id, video_id)
      );

      CREATE INDEX IF NOT EXISTS idx_favorites_user
        ON favorites (user_id);

      CREATE TABLE IF NOT EXISTS user_preferences (
        user_id TEXT PRIMARY KEY,
        call_name TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );
    `);

    statements = {
      upsertQueueState: db.prepare(`
        INSERT INTO queue_state (guild_id, current_index, repeat_mode, updated_at)
        VALUES (@guildId, @currentIndex, @repeatMode, @updatedAt)
        ON CONFLICT(guild_id) DO UPDATE SET
          current_index = excluded.current_index,
          repeat_mode = excluded.repeat_mode,
          updated_at = excluded.updated_at
      `),
      deleteQueueItems: db.prepare(
        "DELETE FROM queue_items WHERE guild_id = ?"
      ),
      insertQueueItem: db.prepare(`
        INSERT INTO queue_items
          (guild_id, position, url, title, requested_by_id, requested_by_tag)
        VALUES (?, ?, ?, ?, ?, ?)
      `),
      selectQueueState: db.prepare(
        "SELECT current_index, repeat_mode FROM queue_state WHERE guild_id = ?"
      ),
      selectQueueItems: db.prepare(`
        SELECT position, url, title, requested_by_id, requested_by_tag
        FROM queue_items
        WHERE guild_id = ?
        ORDER BY position ASC
      `),
      deleteQueueState: db.prepare("DELETE FROM queue_state WHERE guild_id = ?"),
      upsertFavorite: db.prepare(`
        INSERT INTO favorites
          (user_id, video_id, url, title, play_count, last_played_at)
        VALUES (@userId, @videoId, @url, @title, 1, @lastPlayedAt)
        ON CONFLICT(user_id, video_id) DO UPDATE SET
          url = excluded.url,
          title = excluded.title,
          play_count = play_count + 1,
          last_played_at = excluded.last_played_at
      `),
      selectFavorites: db.prepare(`
        SELECT url, title, play_count
        FROM favorites
        WHERE user_id = ? AND play_count >= ?
        ORDER BY play_count DESC, last_played_at DESC, title ASC
        LIMIT ?
      `),
      selectFavoritesDetailed: db.prepare(`
        SELECT video_id, url, title, play_count, last_played_at
        FROM favorites
        WHERE user_id = ? AND play_count >= ?
        ORDER BY play_count DESC, last_played_at DESC, title ASC
        LIMIT ?
      `),
      deleteFavorite: db.prepare(`
        DELETE FROM favorites
        WHERE user_id = ? AND video_id = ?
      `),
      upsertUserPreference: db.prepare(`
        INSERT INTO user_preferences (user_id, call_name, updated_at)
        VALUES (@userId, @callName, @updatedAt)
        ON CONFLICT(user_id) DO UPDATE SET
          call_name = excluded.call_name,
          updated_at = excluded.updated_at
      `),
      selectUserPreference: db.prepare(`
        SELECT call_name
        FROM user_preferences
        WHERE user_id = ?
      `),
      deleteUserPreference: db.prepare(
        "DELETE FROM user_preferences WHERE user_id = ?"
      ),
    };
  } catch (error) {
    logger.error("Failed to initialize database.", error);
    db = null;
    statements = null;
  }

  return db;
}

function ensureReady() {
  if (!db) initDatabase();
  return Boolean(db && statements);
}

function extractVideoId(url) {
  if (!url || typeof url !== "string") return null;
  const match = url.match(/[?&]v=([a-zA-Z0-9_-]{11})/);
  if (match) return match[1];
  const shortMatch = url.match(/youtu\.be\/([a-zA-Z0-9_-]{11})/);
  if (shortMatch) return shortMatch[1];
  return null;
}

function saveQueueState(guildId, state) {
  if (!guildId || !state) return;
  if (!ensureReady()) return;

  const queue = Array.isArray(state.queue) ? state.queue : [];
  const currentIndex = Number.isInteger(state.currentIndex) ? state.currentIndex : -1;
  const repeatMode = state.repeatMode || "off";
  const updatedAt = Date.now();

  const runTx = db.transaction(() => {
    statements.upsertQueueState.run({
      guildId,
      currentIndex,
      repeatMode,
      updatedAt,
    });

    statements.deleteQueueItems.run(guildId);
    for (let i = 0; i < queue.length; i += 1) {
      const track = queue[i];
      const title = track?.title || track?.url || "";
      statements.insertQueueItem.run(
        guildId,
        i,
        track?.url || "",
        title,
        track?.requestedById || null,
        track?.requestedByTag || null
      );
    }
  });

  try {
    runTx();
  } catch (error) {
    logger.error("Failed saving queue state.", error);
  }
}

function loadQueueState(guildId) {
  if (!guildId) return null;
  if (!ensureReady()) return null;

  try {
    const stateRow = statements.selectQueueState.get(guildId);
    const items = statements.selectQueueItems.all(guildId);

    const queue = items.map((row) => ({
      url: row.url,
      title: row.title,
      requestedById: row.requested_by_id || null,
      requestedByTag: row.requested_by_tag || null,
      requestedBy: row.requested_by_tag || row.requested_by_id || "-",
    }));

    return {
      queue,
      currentIndex: Number.isInteger(stateRow?.current_index)
        ? stateRow.current_index
        : -1,
      repeatMode: stateRow?.repeat_mode || "off",
    };
  } catch (error) {
    logger.error("Failed loading queue state.", error);
    return null;
  }
}

function clearQueueState(guildId) {
  if (!guildId) return;
  if (!ensureReady()) return;

  const runTx = db.transaction(() => {
    statements.deleteQueueItems.run(guildId);
    statements.deleteQueueState.run(guildId);
  });

  try {
    runTx();
  } catch (error) {
    logger.error("Failed clearing queue state.", error);
  }
}

function recordPlay({ userId, url, title }) {
  if (!userId || !url) return;
  if (!ensureReady()) return;

  const videoId = extractVideoId(url) || url;
  const lastPlayedAt = Date.now();

  try {
    statements.upsertFavorite.run({
      userId,
      videoId,
      url,
      title: title || url,
      lastPlayedAt,
    });
  } catch (error) {
    logger.error("Failed recording favorite play.", error);
  }
}

function getFavoriteTracks(userId, { minPlays = 5, limit = 20 } = {}) {
  if (!userId) return [];
  if (!ensureReady()) return [];

  try {
    return statements.selectFavorites.all(userId, minPlays, limit);
  } catch (error) {
    logger.error("Failed loading favorites.", error);
    return [];
  }
}

function listFavorites(userId, { minPlays = 1, limit = 20 } = {}) {
  if (!userId) return [];
  if (!ensureReady()) return [];

  try {
    return statements.selectFavoritesDetailed.all(userId, minPlays, limit);
  } catch (error) {
    logger.error("Failed loading favorites.", error);
    return [];
  }
}

function deleteFavorite(userId, videoId) {
  if (!userId || !videoId) return false;
  if (!ensureReady()) return false;

  try {
    const result = statements.deleteFavorite.run(userId, videoId);
    return result.changes > 0;
  } catch (error) {
    logger.error("Failed deleting favorite.", error);
    return false;
  }
}

function setUserCallName(userId, callName) {
  if (!userId || !callName) return false;
  if (!ensureReady()) return false;

  try {
    const result = statements.upsertUserPreference.run({
      userId,
      callName,
      updatedAt: Date.now(),
    });
    return result.changes > 0;
  } catch (error) {
    logger.error("Failed saving user preference.", error);
    return false;
  }
}

function getUserCallName(userId) {
  if (!userId) return null;
  if (!ensureReady()) return null;

  try {
    const row = statements.selectUserPreference.get(userId);
    return row?.call_name || null;
  } catch (error) {
    logger.error("Failed loading user preference.", error);
    return null;
  }
}

function clearUserCallName(userId) {
  if (!userId) return false;
  if (!ensureReady()) return false;

  try {
    const result = statements.deleteUserPreference.run(userId);
    return result.changes > 0;
  } catch (error) {
    logger.error("Failed clearing user preference.", error);
    return false;
  }
}

module.exports = {
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
};
