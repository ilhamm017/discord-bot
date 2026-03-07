const { AudioPlayerStatus } = require("@discordjs/voice");
const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  StringSelectMenuBuilder,
} = require("discord.js");
const logger = require("../../utils/logger");

const PAGE_SIZE = 25;

function formatDuration(totalSeconds) {
  const seconds = Number(totalSeconds);
  if (!Number.isFinite(seconds) || seconds < 0) return "-";

  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  }

  return `${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}

function getStatusLabel(status) {
  switch (status) {
    case AudioPlayerStatus.Playing:
      return "Memutar";
    case AudioPlayerStatus.Buffering:
      return "Buffering";
    case AudioPlayerStatus.Paused:
    case AudioPlayerStatus.AutoPaused:
      return "Pause";
    case AudioPlayerStatus.Idle:
      return "Idle";
    default:
      return String(status || "Idle");
  }
}

function getStatusColor(status) {
  switch (status) {
    case AudioPlayerStatus.Playing:
      return 0x2ecc71;
    case AudioPlayerStatus.Paused:
    case AudioPlayerStatus.AutoPaused:
      return 0xf1c40f;
    case AudioPlayerStatus.Buffering:
      return 0x3498db;
    case AudioPlayerStatus.Idle:
    default:
      return 0x95a5a6;
  }
}

function getRepeatLabel(mode) {
  switch (mode) {
    case "track":
      return "Ulang Lagu";
    case "all":
      return "Ulang Playlist";
    default:
      return "Off";
  }
}

function truncateText(value, maxLength) {
  const text = String(value || "");
  if (text.length <= maxLength) return text;
  return `${text.slice(0, Math.max(0, maxLength - 3))}...`;
}

function clampNumber(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function getCurrentTrack(state) {
  if (!state || !Array.isArray(state.queue)) return null;
  if (state.currentIndex < 0 || state.currentIndex >= state.queue.length) {
    return null;
  }
  return state.queue[state.currentIndex];
}

function getThumbnailUrl(track) {
  const thumbs = track?.info?.video_details?.thumbnails;
  if (!Array.isArray(thumbs) || thumbs.length === 0) return null;
  return thumbs[thumbs.length - 1]?.url || null;
}

function getPanelView(state) {
  return state?.panelView === "history" ? "history" : "queue";
}

function getRequesterLabel(track) {
  return track?.requestedById
    ? `<@${track.requestedById}>`
    : track?.requestedByTag || track?.requestedBy || "-";
}

function getListPagination(totalItems, page) {
  if (totalItems <= 0) {
    return { page: 0, totalPages: 0, startIndex: 0 };
  }

  const totalPages = Math.max(1, Math.ceil(totalItems / PAGE_SIZE));
  const safePage = clampNumber(
    Number.isInteger(page) ? page : 0,
    0,
    totalPages - 1
  );
  return {
    page: safePage,
    totalPages,
    startIndex: safePage * PAGE_SIZE,
  };
}

function getQueuePagination(queue, currentIndex, page) {
  const startBase = Math.max(0, currentIndex + 1);
  const totalUpcoming = Math.max(0, queue.length - startBase);
  if (totalUpcoming <= 0) {
    return { page: 0, totalPages: 0, startIndex: startBase };
  }

  const pagination = getListPagination(totalUpcoming, page);
  return {
    page: pagination.page,
    totalPages: pagination.totalPages,
    startIndex: startBase + pagination.startIndex,
  };
}

function buildQueueLines(queue, startIndex, maxItems, currentIndex) {
  if (!Array.isArray(queue) || queue.length === 0) return "-";

  const lines = [];
  const total = queue.length;
  const start = Math.max(0, startIndex);

  for (let i = start; i < total && lines.length < maxItems; i += 1) {
    const track = queue[i];
    const title = truncateText(track?.title || track?.url || "-", 60);
    const suffix = i === currentIndex ? " (now)" : "";
    lines.push(`${i + 1}. ${title}${suffix}`);
  }

  if (start > 0) {
    lines.unshift(`... ${start} lagu sebelum`);
  }

  if (start + maxItems < total) {
    lines.push(`... ${total - (start + maxItems)} lagu lagi`);
  }

  return lines.join("\n");
}

function buildHistoryLines(history, startIndex, maxItems) {
  if (!Array.isArray(history) || history.length === 0) return "-";

  const lines = [];
  const total = history.length;
  const start = Math.max(0, startIndex);

  for (let i = start; i < total && lines.length < maxItems; i += 1) {
    const track = history[i];
    const title = truncateText(track?.title || track?.url || "-", 60);
    lines.push(`${i + 1}. ${title}`);
  }

  if (start > 0) {
    lines.unshift(`... ${start} lagu history sebelum`);
  }

  if (start + maxItems < total) {
    lines.push(`... ${total - (start + maxItems)} lagu history lagi`);
  }

  return lines.join("\n");
}

function buildQueueSelect(queue, currentIndex, page) {
  if (!Array.isArray(queue) || queue.length <= 1) {
    return { menu: null, pagination: { page: 0, totalPages: 0, startIndex: 0 } };
  }

  const pagination = getQueuePagination(queue, currentIndex, page);
  if (pagination.totalPages === 0) {
    return { menu: null, pagination };
  }

  const slice = queue.slice(pagination.startIndex, pagination.startIndex + PAGE_SIZE);
  if (slice.length === 0) {
    return { menu: null, pagination };
  }

  const options = slice.map((track, offset) => {
    const index = pagination.startIndex + offset;
    const title = truncateText(track?.title || track?.url || "-", 90);
    return {
      label: truncateText(`${index + 1}. ${title}`, 100),
      value: String(index),
    };
  });

  const menu = new StringSelectMenuBuilder()
    .setCustomId("music_select")
    .setPlaceholder("Pilih lagu dari antrian")
    .addOptions(options);

  return { menu, pagination };
}

function buildHistorySelect(history, page) {
  if (!Array.isArray(history) || history.length === 0) {
    return { menu: null, pagination: { page: 0, totalPages: 0, startIndex: 0 } };
  }

  const pagination = getListPagination(history.length, page);
  const slice = history.slice(pagination.startIndex, pagination.startIndex + PAGE_SIZE);
  if (slice.length === 0) {
    return { menu: null, pagination };
  }

  const options = slice.map((track, offset) => {
    const index = pagination.startIndex + offset;
    const title = truncateText(track?.title || track?.url || "-", 80);
    const requester = truncateText(getRequesterLabel(track), 45);
    return {
      label: truncateText(`${index + 1}. ${title}`, 100),
      description: truncateText(`Replay • ${requester}`, 100),
      value: String(index),
    };
  });

  const menu = new StringSelectMenuBuilder()
    .setCustomId("music_history_select")
    .setPlaceholder("Pilih lagu dari history")
    .addOptions(options);

  return { menu, pagination };
}

function buildControlPanel(state) {
  const queue = Array.isArray(state?.queue) ? state.queue : [];
  const history = Array.isArray(state?.playHistory) ? state.playHistory : [];
  const queueLength = queue.length;
  const currentIndex = typeof state?.currentIndex === "number" ? state.currentIndex : -1;
  const currentTrack = getCurrentTrack(state);
  const pausedFlag = state?.player?.state?.paused === true;
  const playingFlag = state?.player?.state?.playing === true;
  const status = pausedFlag
    ? AudioPlayerStatus.Paused
    : playingFlag
      ? AudioPlayerStatus.Playing
      : state?.player?.state?.status || AudioPlayerStatus.Idle;

  const upcoming = currentTrack
    ? Math.max(0, queueLength - currentIndex - 1)
    : queueLength;
  const repeatMode = state?.repeatMode || "off";
  const panelView = getPanelView(state);
  const queuePage = typeof state?.queuePage === "number" ? state.queuePage : 0;
  const historyPage = typeof state?.historyPage === "number" ? state.historyPage : 0;
  const queueResult = buildQueueSelect(queue, currentIndex, queuePage);
  const historyResult = buildHistorySelect(history, historyPage);
  const queuePagination = queueResult.pagination;
  const historyPagination = historyResult.pagination;
  const activeResult = panelView === "history" ? historyResult : queueResult;
  const activePagination = panelView === "history" ? historyPagination : queuePagination;
  const activeListLabel = panelView === "history" ? "History" : "Queue";
  const activeListValue = panelView === "history"
    ? buildHistoryLines(history, activePagination.startIndex, 10)
    : buildQueueLines(
        queue,
        queuePagination.totalPages > 0
          ? queuePagination.startIndex
          : Math.max(0, currentIndex),
        10,
        currentIndex
      );

  if (state) {
    state.queuePage = queuePagination.page;
    state.historyPage = historyPagination.page;
    state.panelView = panelView;
  }

  const title = currentTrack?.title || "Tidak ada lagu yang diputar.";
  const durationSeconds = currentTrack?.info?.video_details?.durationInSec;
  const requester = getRequesterLabel(currentTrack);
  const statusLabel = getStatusLabel(status);

  const embed = new EmbedBuilder()
    .setTitle("Now Playing")
    .setColor(getStatusColor(status))
    .setDescription(title)
    .addFields(
      { name: "Duration", value: formatDuration(durationSeconds), inline: true },
      { name: "Queue", value: String(upcoming), inline: true },
      { name: "Status", value: statusLabel, inline: true },
      { name: "Requester", value: requester, inline: true },
      { name: "Repeat", value: getRepeatLabel(repeatMode), inline: true },
      { name: "History", value: String(history.length), inline: true },
      { name: `${activeListLabel} List`, value: activeListValue }
    );

  if (currentTrack?.url) {
    embed.setURL(currentTrack.url);
  }

  if (activePagination.totalPages > 1) {
    embed.setFooter({
      text: `${activeListLabel} Page ${activePagination.page + 1}/${activePagination.totalPages}`,
    });
  }

  const thumbnail = getThumbnailUrl(currentTrack);
  if (thumbnail) {
    embed.setThumbnail(thumbnail);
  }

  const isPaused =
    pausedFlag ||
    status === AudioPlayerStatus.Paused ||
    status === AudioPlayerStatus.AutoPaused;
  const isIdle = !playingFlag && !isPaused;
  const hasState = Boolean(state);
  const hasCurrent = Boolean(currentTrack);
  const canPrev = hasState && hasCurrent && currentIndex > 0;
  const canNext =
    hasState &&
    hasCurrent &&
    (currentIndex < queueLength - 1 || (repeatMode === "all" && queueLength > 0));
  const canPause = hasState && hasCurrent;
  const canStop = hasState && queueLength > 0;
  const canLeave = hasState;
  const upcomingCount = Math.max(0, queueLength - currentIndex - 1);
  const canShuffle = upcomingCount > 1 || (currentIndex < 0 && queueLength > 1);
  const canLoop = hasState && queueLength > 0;
  const isLoopTrack = repeatMode === "track";
  const isLoopAll = repeatMode === "all";
  const canToggleHistory = history.length > 0;

  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("music_prev")
      .setLabel("Prev")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(!canPrev),
    new ButtonBuilder()
      .setCustomId("music_pause")
      .setLabel(isPaused || isIdle ? "Play" : "Pause")
      .setStyle(isPaused || isIdle ? ButtonStyle.Success : ButtonStyle.Secondary)
      .setDisabled(!canPause),
    new ButtonBuilder()
      .setCustomId("music_next")
      .setLabel("Next")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(!canNext)
  );

  const row2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("music_stop")
      .setLabel("Stop")
      .setStyle(ButtonStyle.Danger)
      .setDisabled(!canStop),
    new ButtonBuilder()
      .setCustomId("music_leave")
      .setLabel("Leave")
      .setStyle(ButtonStyle.Danger)
      .setDisabled(!canLeave),
    new ButtonBuilder()
      .setCustomId("music_shuffle")
      .setLabel("Shuffle")
      .setStyle(ButtonStyle.Primary)
      .setDisabled(!canShuffle),
    new ButtonBuilder()
      .setCustomId("music_refresh")
      .setLabel("Refresh")
      .setStyle(ButtonStyle.Primary)
  );

  const row3 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("music_loop_track")
      .setLabel("Ulang Lagu")
      .setStyle(isLoopTrack ? ButtonStyle.Success : ButtonStyle.Secondary)
      .setDisabled(!canLoop),
    new ButtonBuilder()
      .setCustomId("music_loop_all")
      .setLabel("Ulang Playlist")
      .setStyle(isLoopAll ? ButtonStyle.Success : ButtonStyle.Secondary)
      .setDisabled(!canLoop),
    new ButtonBuilder()
      .setCustomId("music_history_toggle")
      .setLabel(panelView === "history" ? "Lihat Queue" : "Lihat History")
      .setStyle(panelView === "history" ? ButtonStyle.Success : ButtonStyle.Secondary)
      .setDisabled(!canToggleHistory)
  );

  const components = [row1, row2, row3];

  if (activePagination.totalPages > 1) {
    components.push(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId("music_panel_prev")
          .setLabel(`${activeListLabel} Prev`)
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(activePagination.page <= 0),
        new ButtonBuilder()
          .setCustomId("music_panel_next")
          .setLabel(`${activeListLabel} Next`)
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(activePagination.page >= activePagination.totalPages - 1)
      )
    );
  }

  if (activeResult?.menu) {
    components.push(new ActionRowBuilder().addComponents(activeResult.menu));
  }

  return { embeds: [embed], components };
}

async function updateControlPanel(client, state) {
  if (!client || !state) return null;

  let baseState = state;
  if (state.guildId) {
    const { getGuildState } = require("./voice");
    const canonical = getGuildState(state.guildId);
    if (canonical) {
      baseState = canonical;
      if (state.panelChannelId && !baseState.panelChannelId) {
        baseState.panelChannelId = state.panelChannelId;
      }
      if (state.panelMessageId && !baseState.panelMessageId) {
        baseState.panelMessageId = state.panelMessageId;
      }
      if (typeof state.queuePage === "number") {
        baseState.queuePage = state.queuePage;
      }
      if (typeof state.historyPage === "number") {
        baseState.historyPage = state.historyPage;
      }
      if (state.panelView) {
        baseState.panelView = state.panelView;
      }
    }
  }

  if (!baseState?.panelChannelId) return null;
  if (baseState.panelUpdatePromise) return baseState.panelUpdatePromise;

  const updatePromise = (async () => {
    let channel;
    try {
      channel = await client.channels.fetch(baseState.panelChannelId);
    } catch (error) {
      logger.warn("Failed fetching panel channel.", error);
      return null;
    }

    if (!channel?.isTextBased?.()) return null;

    let renderState = baseState;
    if (baseState.guildId) {
      try {
        const { getState } = require("./queue");
        renderState = getState(baseState.guildId) || baseState;
      } catch (_) {
        renderState = baseState;
      }
    }

    if (renderState && renderState !== baseState) {
      renderState.panelChannelId = baseState.panelChannelId;
      renderState.panelMessageId = baseState.panelMessageId;
      if (typeof baseState.queuePage === "number") {
        renderState.queuePage = baseState.queuePage;
      }
      if (typeof baseState.historyPage === "number") {
        renderState.historyPage = baseState.historyPage;
      }
      if (baseState.panelView) {
        renderState.panelView = baseState.panelView;
      }
    }

    const payload = buildControlPanel(renderState);

    if (baseState.panelMessageId && channel.messages?.fetch) {
      try {
        const message = await channel.messages.fetch(baseState.panelMessageId);
        await message.edit(payload);
        return message;
      } catch (error) {
        logger.warn("Failed editing panel message, creating new.", error);
      }
    }

    const sent = await channel.send(payload);
    baseState.panelMessageId = sent.id;
    return sent;
  })();

  baseState.panelUpdatePromise = updatePromise;
  try {
    return await updatePromise;
  } finally {
    if (baseState.panelUpdatePromise === updatePromise) {
      baseState.panelUpdatePromise = null;
    }
  }
}

module.exports = {
  buildControlPanel,
  updateControlPanel,
};
