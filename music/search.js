let config = {};
try {
  config = require("../config.json");
} catch (error) {
  config = {};
}

const DEFAULT_TTL_MS = 5 * 60 * 1000;
const SEARCH_TTL_MS = Number.isInteger(config.search_select_ttl_ms)
  ? config.search_select_ttl_ms
  : DEFAULT_TTL_MS;

const sessions = new Map();

function cleanupExpired() {
  const now = Date.now();
  for (const [key, session] of sessions.entries()) {
    if (session.expiresAt <= now) {
      sessions.delete(key);
    }
  }
}

function registerSearchSession(messageId, session) {
  if (!messageId || !session) return;
  cleanupExpired();
  const expiresAt = Date.now() + SEARCH_TTL_MS;
  sessions.set(messageId, { ...session, expiresAt });
}

function getSearchSession(messageId) {
  if (!messageId) return null;
  cleanupExpired();
  const session = sessions.get(messageId);
  if (!session) return null;
  if (session.expiresAt <= Date.now()) {
    sessions.delete(messageId);
    return null;
  }
  return session;
}

function clearSearchSession(messageId) {
  if (!messageId) return;
  sessions.delete(messageId);
}

module.exports = {
  registerSearchSession,
  getSearchSession,
  clearSearchSession,
};
