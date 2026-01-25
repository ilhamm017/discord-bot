const { AudioPlayerStatus } = require("@discordjs/voice");
const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  StringSelectMenuBuilder,
} = require("discord.js");
const logger = require("../utils/logger");

const QUEUE_PAGE_SIZE = 25;

function formatDuration(totalSeconds) {
  const seconds = Number(totalSeconds);
  if (!Number.isFinite(seconds) || seconds < 0) return "-";

  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(
      2,
      "0"
    )}`;
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

function truncateText(value, maxLength) {
  const text = String(value || "");
  if (text.length <= maxLength) return text;
  return `${text.slice(0, Math.max(0, maxLength - 3))}...`;
}

function clampNumber(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function getQueuePagination(queue, currentIndex, page) {
  const startBase = Math.max(0, currentIndex + 1);
  const totalUpcoming = Math.max(0, queue.length - startBase);
  if (totalUpcoming <= 0) {
    return {
      page: 0,
      totalPages: 0,
      startIndex: startBase,
    };
  }

  const totalPages = Math.max(1, Math.ceil(totalUpcoming / QUEUE_PAGE_SIZE));
  const safePage = clampNumber(
    Number.isInteger(page) ? page : 0,
    0,
    totalPages - 1
  );
  const startIndex = startBase + safePage * QUEUE_PAGE_SIZE;
  return { page: safePage, totalPages, startIndex };
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
    const prevCount = start;
    lines.unshift(`... ${prevCount} lagu sebelum`);
  }

  if (start + maxItems < total) {
    lines.push(`... ${total - (start + maxItems)} lagu lagi`);
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

  const slice = queue.slice(
    pagination.startIndex,
    pagination.startIndex + QUEUE_PAGE_SIZE
  );
  if (slice.length === 0) {
    return { menu: null, pagination };
  }

  const options = slice.map((track, offset) => {
    const index = pagination.startIndex + offset;
    const title = truncateText(track?.title || track?.url || "-", 90);
    const label = `${index + 1}. ${title}`;
    return {
      label: truncateText(label, 100),
      value: String(index),
    };
  });

  if (options.length === 0) {
    return { menu: null, pagination };
  }

  const menu = new StringSelectMenuBuilder()
    .setCustomId("music_select")
    .setPlaceholder("Pilih lagu dari antrian")
    .addOptions(options);

  return { menu, pagination };
}

function buildControlPanel(state) {
  const queue = Array.isArray(state?.queue) ? state.queue : [];
  const queueLength = queue.length;
  const currentIndex =
    typeof state?.currentIndex === "number" ? state.currentIndex : -1;
  const currentTrack = getCurrentTrack(state);
  const status = state?.player?.state?.status || AudioPlayerStatus.Idle;

  const upcoming = currentTrack
    ? Math.max(0, queueLength - currentIndex - 1)
    : queueLength;

  const title = currentTrack?.title || "Tidak ada lagu yang diputar.";
  const durationSeconds = currentTrack?.info?.video_details?.durationInSec;
  const requester = currentTrack?.requestedById
    ? `<@${currentTrack.requestedById}>`
    : currentTrack?.requestedByTag || currentTrack?.requestedBy || "-";
  const statusLabel = getStatusLabel(status);
  const repeatMode = state?.repeatMode || "off";
  const queuePage = typeof state?.queuePage === "number" ? state.queuePage : 0;
  const queueResult = buildQueueSelect(queue, currentIndex, queuePage);
  const pagination = queueResult?.pagination || {
    page: 0,
    totalPages: 0,
    startIndex: Math.max(0, currentIndex),
  };
  if (state) {
    state.queuePage = pagination.page;
  }

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
      {
        name: "Queue List",
        value: buildQueueLines(
          queue,
          pagination.totalPages > 0
            ? pagination.startIndex
            : Math.max(0, currentIndex),
          10,
          currentIndex
        ),
      }
    );

  if (currentTrack?.url) {
    embed.setURL(currentTrack.url);
  }

  if (pagination.totalPages > 1) {
    embed.setFooter({
      text: `Queue Page ${pagination.page + 1}/${pagination.totalPages}`,
    });
  }

  const thumbnail = getThumbnailUrl(currentTrack);
  if (thumbnail) {
    embed.setThumbnail(thumbnail);
  }

  const isPaused =
    status === AudioPlayerStatus.Paused ||
    status === AudioPlayerStatus.AutoPaused;
  const hasState = Boolean(state);
  const hasCurrent = Boolean(currentTrack);

  const canPrev = hasState && hasCurrent && currentIndex > 0;
  const canNext = hasState && hasCurrent && currentIndex < queueLength - 1;
  const canPause = hasState && hasCurrent;
  const canStop = hasState && queueLength > 0;
  const canLeave = hasState;
  const upcomingCount = Math.max(0, queueLength - currentIndex - 1);
  const canShuffle = upcomingCount > 1 || (currentIndex < 0 && queueLength > 1);
  const canLoop = hasState && queueLength > 0;
  const isLoopTrack = repeatMode === "track";
  const isLoopAll = repeatMode === "all";

  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("music_prev")
      .setLabel("Prev")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(!canPrev),
    new ButtonBuilder()
      .setCustomId("music_pause")
      .setLabel(isPaused ? "Resume" : "Pause")
      .setStyle(isPaused ? ButtonStyle.Success : ButtonStyle.Secondary)
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
      .setDisabled(!canLoop)
  );

  const components = [row1, row2, row3];
  if (pagination.totalPages > 1) {
    const queueNav = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("music_queue_prev")
        .setLabel("Queue Prev")
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(pagination.page <= 0),
      new ButtonBuilder()
        .setCustomId("music_queue_next")
        .setLabel("Queue Next")
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(pagination.page >= pagination.totalPages - 1)
    );
    components.push(queueNav);
  }

  if (queueResult?.menu) {
    components.push(new ActionRowBuilder().addComponents(queueResult.menu));
  }

  return { embeds: [embed], components };
}

async function updateControlPanel(client, state) {
  if (!client || !state?.panelChannelId) return null;
  if (state.panelUpdatePromise) return state.panelUpdatePromise;

  const updatePromise = (async () => {
    let channel;
    try {
      channel = await client.channels.fetch(state.panelChannelId);
    } catch (error) {
      logger.warn("Failed fetching panel channel.", error);
      return null;
    }

    if (!channel?.isTextBased?.()) return null;

    const payload = buildControlPanel(state);

    if (state.panelMessageId && channel.messages?.fetch) {
      try {
        const message = await channel.messages.fetch(state.panelMessageId);
        await message.edit(payload);
        return message;
      } catch (error) {
        logger.warn("Failed editing panel message, creating new.", error);
      }
    }

    const sent = await channel.send(payload);
    state.panelMessageId = sent.id;
    return sent;
  })();

  state.panelUpdatePromise = updatePromise;
  try {
    return await updatePromise;
  } finally {
    if (state.panelUpdatePromise === updatePromise) {
      state.panelUpdatePromise = null;
    }
  }
}

module.exports = {
  buildControlPanel,
  updateControlPanel,
};
