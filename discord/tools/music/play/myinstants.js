"use strict";

const { ActionRowBuilder } = require("discord.js");
const { enqueueTrack } = require("../../../player/queue");
const { updateControlPanel } = require("../../../player/panel");
const { registerSearchSession } = require("../../../player/search");
const logger = require("../../../../utils/logger");
const {
  MYINSTANTS_DEFAULT_SEARCH_LIMIT,
  buildMyInstantsTrack,
  detectMyInstantsRequest,
  resolveMyInstantsResult,
  resolveMyInstantsTrack,
  searchMyInstants,
} = require("../../../../utils/common/myinstants");
const { buildSearchSelect, shouldAutoPlaySearchQuery } = require("./utils");

async function enqueueAndReply(message, voiceChannel, track) {
  let result;
  try {
    result = await enqueueTrack(voiceChannel, track, {
      textChannelId: message.channel.id,
    });
  } catch (error) {
    logger.error("Queue error for MyInstants track.", error);
    return message.reply("Gagal memutar sound effect dari MyInstants.");
  }

  try {
    await updateControlPanel(message.client, result.state);
  } catch (error) {
    logger.warn("Failed updating control panel for MyInstants track.", error);
  }

  if (result.started) {
    return message.reply(`Memutar sound effect: ${track.title}`);
  }

  return message.reply(
    `Sound effect ditambahkan ke antrian #${result.position}: ${track.title}`
  );
}

async function handleMyInstants(message, voiceChannel, query, options = {}) {
  const intent = detectMyInstantsRequest(query, {
    source: options.source || "myinstants",
  });

  if (!intent.cleanedQuery && intent.kind === "search") {
    return message.reply("Sebutkan nama sound effect MyInstants yang mau diputar.");
  }

  if (intent.kind === "audio" || intent.kind === "page") {
    try {
      const resolved = await resolveMyInstantsTrack(query, {
        source: "myinstants",
        limit: 1,
      });
      if (!resolved?.audioUrl) {
        return message.reply("Aku belum berhasil ambil audio dari link MyInstants itu.");
      }

      const track = buildMyInstantsTrack(resolved, {
        requestedBy: message.author.tag,
        requestedById: message.author.id,
        requestedByTag: message.author.tag,
      });

      return enqueueAndReply(message, voiceChannel, track);
    } catch (error) {
      logger.error("Failed resolving direct MyInstants link.", error);
      return message.reply("Link MyInstants itu gagal dibaca.");
    }
  }

  let results = [];
  try {
    results = await searchMyInstants(
      intent.cleanedQuery,
      MYINSTANTS_DEFAULT_SEARCH_LIMIT
    );
  } catch (error) {
    logger.error("MyInstants search failed.", error);
    return message.reply("Gagal mencari sound effect dari MyInstants.");
  }

  if (!results.length) {
    return message.reply("Aku gak nemu sound effect MyInstants yang cocok.");
  }

  const shouldAutoPickTop =
    Boolean(options.forceTopResult) ||
    shouldAutoPlaySearchQuery(intent.cleanedQuery);

  if (!options.forceSelection && shouldAutoPickTop) {
    try {
      const resolved = await resolveMyInstantsResult(results[0]);
      const track = buildMyInstantsTrack(resolved, {
        requestedBy: message.author.tag,
        requestedById: message.author.id,
        requestedByTag: message.author.tag,
      });
      return enqueueAndReply(message, voiceChannel, track);
    } catch (error) {
      logger.error("Failed resolving top MyInstants result.", error);
      return message.reply("Aku nemu hasilnya, tapi audio MyInstants-nya gagal diambil.");
    }
  }

  const selectMenu = buildSearchSelect(results);
  if (!selectMenu) {
    return message.reply("Aku gak nemu sound effect MyInstants yang bisa dipilih.");
  }

  const row = new ActionRowBuilder().addComponents(selectMenu);
  const targetLabel = voiceChannel?.id ? ` di <#${voiceChannel.id}>` : "";
  const sent = await message.reply({
    content: `Pilih sound effect MyInstants${targetLabel}:`,
    components: [row],
  });

  registerSearchSession(sent.id, {
    requesterId: message.author.id,
    voiceChannelId: voiceChannel?.id || null,
    textChannelId: message.channel.id,
    results,
  });

  return null;
}

module.exports = {
  handleMyInstants,
};
