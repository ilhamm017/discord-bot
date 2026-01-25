const fs = require("fs");
const path = require("path");
const { Client, Collection, GatewayIntentBits } = require("discord.js");
const config = require("./config.json");
const { token, prefix = "!" } = config;
const logger = require("./utils/logger");
const { initDatabase } = require("./storage/db");
const { handleAiRequest } = require("./utils/ai_chat");
const { waitWithTyping } = require("./utils/typing");
const {
  enqueueTrack,
  getState,
  jumpToIndex,
  leaveVoice,
  previousTrack,
  setPanelUpdater,
  setRepeatMode,
  shuffleQueue,
  skipTrack,
  stopPlayback,
  togglePause,
} = require("./music/queue");
const { buildControlPanel, updateControlPanel } = require("./music/panel");
const { getSearchSession, clearSearchSession } = require("./music/search");
const { resolveSpotifyTrackToYoutube } = require("./utils/spotify");

initDatabase();

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildVoiceStates,
  ],
});

client.commands = new Collection();

const commandsPath = path.join(__dirname, "commands");
const commandFiles = fs
  .readdirSync(commandsPath)
  .filter((file) => file.endsWith(".js"));

for (const file of commandFiles) {
  const command = require(path.join(commandsPath, file));
  if (!command || !command.name || typeof command.execute !== "function") {
    logger.warn(`Skipping invalid command file: ${file}`);
    continue;
  }

  client.commands.set(command.name.toLowerCase(), command);
}

client.once("clientReady", () => {
  logger.info(`Logged in as ${client.user.tag}`);
});

setPanelUpdater((state) => updateControlPanel(client, state));

client.on("interactionCreate", async (interaction) => {
  if (interaction.isButton()) {
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

    if (action !== "refresh") {
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

    if (
      action !== "refresh" &&
      (!state || !Array.isArray(state.queue) || state.queue.length === 0)
    ) {
      return interaction.reply({
        content: "Tidak ada musik yang sedang diputar.",
        ephemeral: true,
      });
    }

    try {
      await interaction.deferUpdate();

      let actionError = null;
      switch (action) {
        case "prev": {
          const track = await previousTrack(guildId);
          if (!track) {
            actionError = "Tidak ada lagu sebelumnya.";
          }
          break;
        }
        case "pause": {
          const result = togglePause(guildId);
          if (result.status !== "paused" && result.status !== "resumed") {
            actionError = "Tidak ada musik yang sedang diputar.";
          }
          break;
        }
        case "next": {
          const track = await skipTrack(guildId);
          if (!track) {
            actionError = "Tidak ada lagu berikutnya di antrian.";
          }
          break;
        }
        case "stop": {
          const stopped = stopPlayback(guildId);
          if (!stopped) {
            actionError = "Tidak ada musik yang sedang diputar.";
          }
          break;
        }
        case "leave": {
          const left = leaveVoice(guildId);
          if (!left) {
            actionError = "Bot belum berada di voice channel.";
          }
          break;
        }
        case "shuffle": {
          const shuffled = shuffleQueue(guildId);
          if (!shuffled) {
            actionError = "Tidak ada antrian yang bisa diacak.";
          }
          break;
        }
        case "loop_track": {
          const nextMode = state?.repeatMode === "track" ? "off" : "track";
          const updated = setRepeatMode(guildId, nextMode);
          if (!updated) {
            actionError = "Tidak ada musik yang sedang diputar.";
          }
          break;
        }
        case "loop_all": {
          const nextMode = state?.repeatMode === "all" ? "off" : "all";
          const updated = setRepeatMode(guildId, nextMode);
          if (!updated) {
            actionError = "Tidak ada musik yang sedang diputar.";
          }
          break;
        }
        case "refresh":
          break;
        default:
          actionError = "Kontrol tidak dikenal.";
          break;
      }

      if (actionError) {
        await interaction.followUp({ content: actionError, ephemeral: true });
      }

      const updatedState = getState(guildId);
      await interaction.editReply(buildControlPanel(updatedState));
    } catch (error) {
      logger.error("Control panel action failed.", error);
      if (interaction.deferred || interaction.replied) {
        await interaction.followUp({
          content: "Terjadi error saat menjalankan kontrol.",
          ephemeral: true,
        });
      } else {
        await interaction.reply({
          content: "Terjadi error saat menjalankan kontrol.",
          ephemeral: true,
        });
      }
    }
    return;
  }

  if (interaction.isStringSelectMenu()) {
    if (interaction.customId === "music_search") {
      if (!interaction.guild) {
        return interaction.reply({
          content: "Perintah ini hanya bisa dipakai di server.",
          ephemeral: true,
        });
      }

      const session = getSearchSession(interaction.message?.id);
      if (!session) {
        return interaction.reply({
          content: "Pilihan pencarian sudah kedaluwarsa. Jalankan lagi.",
          ephemeral: true,
        });
      }

      if (session.requesterId && interaction.user.id !== session.requesterId) {
        return interaction.reply({
          content: `Pencarian ini milik <@${session.requesterId}>.`,
          ephemeral: true,
        });
      }

      const rawIndex = interaction.values?.[0];
      const targetIndex = Number(rawIndex);
      if (!Number.isInteger(targetIndex)) {
        return interaction.reply({
          content: "Pilihan tidak valid.",
          ephemeral: true,
        });
      }

      const item = Array.isArray(session.results)
        ? session.results[targetIndex]
        : null;
      if (!item) {
        return interaction.reply({
          content: "Hasil pilihan tidak ditemukan. Coba cari lagi.",
          ephemeral: true,
        });
      }

      let voiceChannel = null;
      if (session.voiceChannelId) {
        voiceChannel =
          interaction.guild.channels.cache.get(session.voiceChannelId) || null;
        if (!voiceChannel) {
          voiceChannel = await interaction.guild.channels
            .fetch(session.voiceChannelId)
            .catch(() => null);
        }
      }

      if (!voiceChannel) {
        voiceChannel = interaction.member?.voice?.channel || null;
      }

      if (!voiceChannel || !voiceChannel.isVoiceBased?.()) {
        return interaction.reply({
          content: "Voice channel tujuan tidak ditemukan. Jalankan lagi.",
          ephemeral: true,
        });
      }

      const memberChannel = interaction.member?.voice?.channel;
      if (memberChannel && memberChannel.id !== voiceChannel.id) {
        return interaction.reply({
          content: "Kamu harus berada di voice channel tujuan.",
          ephemeral: true,
        });
      }

      try {
        await interaction.deferUpdate();

        let track = null;
        if (item.source === "spotify") {
          const spotifyTrack = item.spotify || {
            id: item.spotifyId,
            name: item.title,
            artists: item.artists || [],
            durationMs: item.durationMs || 0,
          };

          const resolved = await resolveSpotifyTrackToYoutube(spotifyTrack);
          if (!resolved?.url) {
            await interaction.followUp({
              content: "Gagal memetakan Spotify ke YouTube.",
              ephemeral: true,
            });
            return;
          }

          track = {
            url: resolved.url,
            title: resolved.title || item.title || resolved.url,
            requestedBy: interaction.user.tag,
            requestedById: interaction.user.id,
            requestedByTag: interaction.user.tag,
            source: "spotify",
            originUrl: item.url || null,
          };
        } else {
          track = {
            url: item.url,
            title: item.title || item.url,
            requestedBy: interaction.user.tag,
            requestedById: interaction.user.id,
            requestedByTag: interaction.user.tag,
            source: "youtube",
          };
        }

        let result;
        try {
          result = await enqueueTrack(voiceChannel, track, {
            textChannelId: session.textChannelId || interaction.channelId,
          });
        } catch (error) {
          logger.error("Queue error (search select).", error);
          if (error?.message === "STREAM_NEEDS_FFMPEG") {
            await interaction.followUp({
              content:
                "Format audio butuh FFmpeg. Install FFmpeg atau gunakan link lain.",
              ephemeral: true,
            });
            return;
          }
          if (error?.message === "STREAM_FALLBACK_FAILED") {
            await interaction.followUp({
              content: "Gagal memutar audio (fallback yt-dlp). Coba lagi nanti.",
              ephemeral: true,
            });
            return;
          }
          if (error?.message === "YTDLP_DOWNLOAD_FAILED") {
            await interaction.followUp({
              content: "Gagal mengunduh yt-dlp. Cek koneksi atau coba lagi nanti.",
              ephemeral: true,
            });
            return;
          }
          await interaction.followUp({
            content: "Gagal memutar audio.",
            ephemeral: true,
          });
          return;
        }

        try {
          await updateControlPanel(client, result.state);
        } catch (error) {
          logger.warn("Failed updating control panel.", error);
        }

        clearSearchSession(interaction.message?.id);

        const status = result.started
          ? `Memutar: ${track.title}`
          : `Ditambahkan ke antrian #${result.position}: ${track.title}`;

        await interaction.editReply({
          content: status,
          components: [],
        });
      } catch (error) {
        logger.error("Search select failed.", error);
        if (interaction.deferred || interaction.replied) {
          await interaction.followUp({
            content: "Terjadi error saat memilih hasil pencarian.",
            ephemeral: true,
          });
        } else {
          await interaction.reply({
            content: "Terjadi error saat memilih hasil pencarian.",
            ephemeral: true,
          });
        }
      }
      return;
    }

    if (interaction.customId !== "music_select") return;
    if (!interaction.guild) {
      return interaction.reply({
        content: "Perintah ini hanya bisa dipakai di server.",
        ephemeral: true,
      });
    }

    const guildId = interaction.guild.id;
    const state = getState(guildId);
    if (state) {
      state.panelChannelId = interaction.channelId;
      state.panelMessageId = interaction.message?.id || state.panelMessageId;
    }

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

    if (!state || !Array.isArray(state.queue) || state.queue.length === 0) {
      return interaction.reply({
        content: "Tidak ada musik yang sedang diputar.",
        ephemeral: true,
      });
    }

    const rawIndex = interaction.values?.[0];
    const targetIndex = Number(rawIndex);
    if (!Number.isInteger(targetIndex)) {
      return interaction.reply({
        content: "Pilihan antrian tidak valid.",
        ephemeral: true,
      });
    }

    try {
      await interaction.deferUpdate();
      const track = await jumpToIndex(guildId, targetIndex);
      if (!track) {
        await interaction.followUp({
          content: "Gagal memutar lagu dari antrian.",
          ephemeral: true,
        });
      }
      const updatedState = getState(guildId);
      await interaction.editReply(buildControlPanel(updatedState));
    } catch (error) {
      logger.error("Queue select failed.", error);
      if (interaction.deferred || interaction.replied) {
        await interaction.followUp({
          content: "Terjadi error saat memilih antrian.",
          ephemeral: true,
        });
      } else {
        await interaction.reply({
          content: "Terjadi error saat memilih antrian.",
          ephemeral: true,
        });
      }
    }
  }
});

client.on("messageCreate", async (message) => {
  if (message.author.bot) return;

  const content = message.content.trim();
  const prefixLower = prefix.toLowerCase();
  const runAiPrompt = async (prompt, source = "chat") => {
    if (!prompt) return;
    try {
      logger.info("AI chat request", {
        authorId: message.author.id,
        channelId: message.channel.id,
        guildId: message.guild?.id || null,
        source,
      });
      const aiResult = await handleAiRequest(message, prompt);
      if (aiResult?.type === "command" && aiResult.name) {
        const aiCommand = client.commands.get(aiResult.name);
        if (!aiCommand) {
          await message.reply("Perintah itu belum tersedia.");
          return;
        }
        logger.info("AI routed command", {
          command: aiResult.name,
          authorId: message.author.id,
          channelId: message.channel.id,
          guildId: message.guild?.id || null,
          source,
        });
        await aiCommand.execute(message, aiResult.args || []);
        return;
      }

      const reply = aiResult?.message?.trim();
      if (reply) {
        await waitWithTyping(message.channel, reply);
        await message.reply(reply);
      } else {
        await message.reply("Nggak paham maksudnya.");
      }
    } catch (error) {
      logger.error("AI chat error", error);
      await message.reply("Gagal menjawab dengan AI. Coba lagi nanti.");
    }
  };

  const startsWithPrefix = content.toLowerCase().startsWith(prefixLower);
  if (!startsWithPrefix) {
    if (message.reference?.messageId && content) {
      try {
        const referenced = await message.fetchReference();
        if (referenced?.author?.id === client.user.id) {
          await runAiPrompt(content, "reply");
        }
      } catch (error) {
        logger.warn("Failed to resolve reply reference.", error);
      }
    }
    return;
  }

  const rest = content.slice(prefix.length);
  if (rest.length) {
    const needsBoundary = /[a-z0-9]$/i.test(prefix);
    if (needsBoundary && !/^\s/.test(rest)) return;
  }

  const args = rest.trim().split(/\s+/).filter(Boolean);
  const commandName = args.shift()?.toLowerCase();
  if (!commandName) return;

  const command = client.commands.get(commandName);
  if (!command) {
    const prompt = rest.trim();
    await runAiPrompt(prompt, "unknown_command");
    return;
  }

  try {
    await command.execute(message, args);
  } catch (error) {
    logger.error(
      `Command ${commandName} error (guild ${message.guild?.id || "dm"})`,
      error
    );
    await message.reply("Terjadi error saat menjalankan perintah.");
  }
});

client.on("error", (error) => {
  logger.error("Discord client error", error);
});

process.on("unhandledRejection", (reason) => {
  logger.error("Unhandled promise rejection", reason);
});

process.on("uncaughtException", (error) => {
  logger.error("Uncaught exception", error);
});

client.login(token).catch((error) => {
  logger.error("Failed to login", error);
});
