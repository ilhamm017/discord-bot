const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");

const DEFAULT_TTL_MS = 5 * 60 * 1000;
const sessions = new Map();

function cleanupExpired() {
  const now = Date.now();
  for (const [key, session] of sessions.entries()) {
    if (session.expiresAt <= now) sessions.delete(key);
  }
}

function registerMemberListSession(messageId, session) {
  if (!messageId || !session) return;
  cleanupExpired();
  sessions.set(messageId, {
    ...session,
    expiresAt: Date.now() + DEFAULT_TTL_MS,
  });
}

function getMemberListSession(messageId) {
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

function updateMemberListSession(messageId, patch = {}) {
  if (!messageId) return;
  const session = getMemberListSession(messageId);
  if (!session) return;
  sessions.set(messageId, {
    ...session,
    ...patch,
    expiresAt: Date.now() + DEFAULT_TTL_MS,
  });
}

function buildMemberListComponents(session = {}) {
  const offset = Math.max(0, Number.isFinite(session.offset) ? session.offset : 0);
  const limit = Math.max(1, Number.isFinite(session.limit) ? session.limit : 10);
  const total = typeof session.total === "number" ? session.total : null;
  const hasMore =
    typeof session.hasMore === "boolean"
      ? session.hasMore
      : typeof total === "number"
        ? offset + limit < total
        : true;

  const canPrev = offset > 0;
  const canNext = hasMore;

  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("member_list_prev")
        .setLabel("Prev")
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(!canPrev),
      new ButtonBuilder()
        .setCustomId("member_list_next")
        .setLabel("Next")
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(!canNext)
    ),
  ];
}

module.exports = {
  registerMemberListSession,
  getMemberListSession,
  updateMemberListSession,
  buildMemberListComponents,
};
