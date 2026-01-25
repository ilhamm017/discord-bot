const { AudioPlayerStatus } = require("@discordjs/voice");
const { ActionRowBuilder, StringSelectMenuBuilder } = require("discord.js");
const play = require("play-dl");
const { enqueueTrack, enqueueTracks, getState } = require("../music/queue");
const logger = require("../utils/logger");
const { updateControlPanel } = require("../music/panel");
const { getFavoriteTracks } = require("../storage/db");
const {
  parseSpotifyInput,
  isSpotifyConfigured,
  fetchSpotifyCollection,
  resolveSpotifyTracks,
  searchSpotifyTracks,
} = require("../utils/spotify");
const { registerSearchSession } = require("../music/search");

let config = {};
try {
  config = require("../config.json");
} catch (error) {
  config = {};
}

const FAVORITES_MIN_PLAYS = 5;
const FAVORITES_LIMIT = 20;
const MENTION_REGEX = /<@!?\d+>/g;
const MENTION_TEST_REGEX = /<@!?\d+>/;
const YT_SEARCH_LIMIT = Number.isInteger(config.search_results_limit_youtube)
  ? config.search_results_limit_youtube
  : 5;
const SPOTIFY_SEARCH_LIMIT = Number.isInteger(config.search_results_limit_spotify)
  ? config.search_results_limit_spotify
  : 5;
const SEARCH_OPTION_LIMIT = 25;

function resolveTargetVoiceChannel(message) {
  const mentionedMember = message.mentions?.members
    ? message.mentions.members.find((member) => !member.user?.bot)
    : null;

  if (mentionedMember) {
    const targetChannel = mentionedMember.voice?.channel;
    if (!targetChannel) {
      return {
        error: "Target belum ada di voice channel.",
      };
    }
    return { channel: targetChannel, targetMember: mentionedMember };
  }

  const memberChannel = message.member?.voice?.channel;
  if (!memberChannel) {
    return { error: "Kamu harus join voice channel dulu atau sebutkan target." };
  }

  return { channel: memberChannel, targetMember: null };
}

function stripTargetTokens(query, { hasMention } = {}) {
  if (!query) return "";
  let cleaned = query.replace(MENTION_REGEX, " ");
  if (hasMention) {
    cleaned = cleaned.replace(/\b(untuk|buat)\b/gi, " ");
  }
  return cleaned.replace(/\s+/g, " ").trim();
}

function truncateText(value, maxLength) {
  const text = String(value || "");
  if (text.length <= maxLength) return text;
  return `${text.slice(0, Math.max(0, maxLength - 3))}...`;
}

function formatDuration(totalSeconds) {
  const seconds = Number(totalSeconds);
  if (!Number.isFinite(seconds) || seconds < 0) return "-";

  const minutes = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${minutes}:${String(secs).padStart(2, "0")}`;
}

function getYoutubeDurationMs(result) {
  if (!result) return null;
  if (Number.isFinite(result.durationInSec)) {
    return Math.round(result.durationInSec * 1000);
  }
  if (Number.isFinite(result.durationInSeconds)) {
    return Math.round(result.durationInSeconds * 1000);
  }
  if (Number.isFinite(result.duration)) {
    return Math.round(result.duration * 1000);
  }
  return null;
}

function buildSearchSelect(results) {
  const options = results.slice(0, SEARCH_OPTION_LIMIT).map((item, index) => {
    const prefix = item.source === "spotify" ? "SP" : "YT";
    const label = truncateText(`${prefix}: ${item.title}`, 100);
    const duration = item.durationMs
      ? formatDuration(Math.round(item.durationMs / 1000))
      : "-";
    const descriptionBase =
      item.source === "spotify"
        ? `Spotify • ${item.artists?.join(", ") || "-"}`
        : "YouTube";
    const description = truncateText(`${descriptionBase} • ${duration}`, 100);
    return {
      label,
      description,
      value: String(index),
    };
  });

  if (!options.length) return null;

  return new StringSelectMenuBuilder()
    .setCustomId("music_search")
    .setPlaceholder("Pilih hasil pencarian")
    .addOptions(options);
}

module.exports = {
  name: "play",
  description: "Putar audio dari YouTube.",
  async execute(message, args) {
    if (!message.guild) {
      return message.reply("Perintah ini hanya bisa dipakai di server.");
    }

    const target = resolveTargetVoiceChannel(message);
    if (target.error) {
      return message.reply(target.error);
    }
    const voiceChannel = target.channel;

    const rawQuery = args.join(" ").trim();
    const hasMention = MENTION_TEST_REGEX.test(rawQuery);
    const query = stripTargetTokens(rawQuery, { hasMention });
    if (!query) {
      return message.reply(
        "Masukkan URL atau judul. Contoh: yova play <url/judul>"
      );
    }

    if (query.toLowerCase() === "kesukaanku") {
      const favorites = getFavoriteTracks(message.author.id, {
        minPlays: FAVORITES_MIN_PLAYS,
        limit: FAVORITES_LIMIT,
      });

      if (!favorites.length) {
        return message.reply(
          `Belum ada lagu favorit (minimal ${FAVORITES_MIN_PLAYS}x diputar).`
        );
      }

      const tracks = favorites.map((item) => ({
        url: item.url,
        title: item.title || item.url,
        requestedBy: message.author.tag,
        requestedById: message.author.id,
        requestedByTag: message.author.tag,
      }));

      let result;
      try {
        result = await enqueueTracks(voiceChannel, tracks, {
          textChannelId: message.channel.id,
        });
      } catch (error) {
        logger.error("Queue error.", error);
        const state = message.guild ? getState(message.guild.id) : null;
        const status = state?.player?.state?.status;
        if (
          status === AudioPlayerStatus.Playing ||
          status === AudioPlayerStatus.Buffering
        ) {
          return;
        }
        if (error?.message === "STREAM_NEEDS_FFMPEG") {
          return message.reply(
            "Format audio butuh FFmpeg. Install FFmpeg atau gunakan link lain."
          );
        }
        if (error?.message === "STREAM_FALLBACK_FAILED") {
          return message.reply(
            "Gagal memutar audio (fallback yt-dlp). Coba lagi nanti."
          );
        }
        if (error?.message === "YTDLP_DOWNLOAD_FAILED") {
          return message.reply(
            "Gagal mengunduh yt-dlp. Cek koneksi atau coba lagi nanti."
          );
        }
        return message.reply("Gagal memutar audio.");
      }

      try {
        await updateControlPanel(message.client, result.state);
      } catch (error) {
        logger.warn("Failed updating control panel.", error);
      }

      if (result.started) {
        return message.reply(
          `Memutar kesukaanku (${tracks.length} lagu).`
        );
      }

      return message.reply(
        `Kesukaanku ditambahkan (${tracks.length} lagu), mulai antrian #${result.startPosition}.`
      );
    }
    const spotifyRef = parseSpotifyInput(query);
    if (spotifyRef) {
      if (!isSpotifyConfigured()) {
        return message.reply(
          "Spotify API belum diset. Isi spotify_client_id dan spotify_client_secret di config.json."
        );
      }

      let collection;
      try {
        collection = await fetchSpotifyCollection(spotifyRef);
      } catch (error) {
        logger.error("Failed fetching Spotify data.", error);
        return message.reply("Gagal mengambil data dari Spotify.");
      }

      if (!collection.tracks.length) {
        return message.reply("Data Spotify kosong atau tidak bisa dibaca.");
      }

      let resolved;
      try {
        resolved = await resolveSpotifyTracks(collection.tracks);
      } catch (error) {
        logger.error("Failed resolving Spotify tracks.", error);
        return message.reply("Gagal memetakan Spotify ke YouTube.");
      }

      if (resolved.resolved.length === 0) {
        return message.reply("Tidak menemukan lagu di YouTube untuk Spotify.");
      }

      const tracks = resolved.resolved.map((item) => ({
        url: item.url,
        title: item.title || item.url,
        requestedBy: message.author.tag,
        requestedById: message.author.id,
        requestedByTag: message.author.tag,
        source: "spotify",
        originUrl: query,
      }));

      if (tracks.length === 1) {
        let result;
        try {
          result = await enqueueTrack(voiceChannel, tracks[0], {
            textChannelId: message.channel.id,
          });
        } catch (error) {
          logger.error("Queue error.", error);
          const state = message.guild ? getState(message.guild.id) : null;
          const status = state?.player?.state?.status;
          if (
            status === AudioPlayerStatus.Playing ||
            status === AudioPlayerStatus.Buffering
          ) {
            return;
          }
          if (error?.message === "STREAM_NEEDS_FFMPEG") {
            return message.reply(
              "Format audio butuh FFmpeg. Install FFmpeg atau gunakan link lain."
            );
          }
          if (error?.message === "STREAM_FALLBACK_FAILED") {
            return message.reply(
              "Gagal memutar audio (fallback yt-dlp). Coba lagi nanti."
            );
          }
          if (error?.message === "YTDLP_DOWNLOAD_FAILED") {
            return message.reply(
              "Gagal mengunduh yt-dlp. Cek koneksi atau coba lagi nanti."
            );
          }
          return message.reply("Gagal memutar audio.");
        }

        try {
          await updateControlPanel(message.client, result.state);
        } catch (error) {
          logger.warn("Failed updating control panel.", error);
        }

        if (result.started) {
          return message.reply(`Memutar: ${tracks[0].title}`);
        }
        return message.reply(
          `Ditambahkan ke antrian #${result.position}: ${tracks[0].title}`
        );
      }

      let result;
      try {
        result = await enqueueTracks(voiceChannel, tracks, {
          textChannelId: message.channel.id,
        });
      } catch (error) {
        logger.error("Queue error.", error);
        const state = message.guild ? getState(message.guild.id) : null;
        const status = state?.player?.state?.status;
        if (
          status === AudioPlayerStatus.Playing ||
          status === AudioPlayerStatus.Buffering
        ) {
          return;
        }
        if (error?.message === "STREAM_NEEDS_FFMPEG") {
          return message.reply(
            "Format audio butuh FFmpeg. Install FFmpeg atau gunakan link lain."
          );
        }
        if (error?.message === "STREAM_FALLBACK_FAILED") {
          return message.reply(
            "Gagal memutar audio (fallback yt-dlp). Coba lagi nanti."
          );
        }
        if (error?.message === "YTDLP_DOWNLOAD_FAILED") {
          return message.reply(
            "Gagal mengunduh yt-dlp. Cek koneksi atau coba lagi nanti."
          );
        }
        return message.reply("Gagal memutar audio.");
      }

      try {
        await updateControlPanel(message.client, result.state);
      } catch (error) {
        logger.warn("Failed updating control panel.", error);
      }

      const name = collection.name || "Spotify";
      const failedCount = resolved.failed.length;
      if (result.started) {
        return message.reply(
          `Memutar ${name} (${tracks.length} lagu).` +
            (failedCount ? ` ${failedCount} lagu gagal dipetakan.` : "")
        );
      }

      return message.reply(
        `${name} ditambahkan (${tracks.length} lagu), mulai antrian #${result.startPosition}.` +
          (failedCount ? ` ${failedCount} lagu gagal dipetakan.` : "")
      );
    }

    let url = query;
    let title;
    let info;

    const validation = play.yt_validate(query);
    if (validation === "playlist") {
      let playlist;
      try {
        playlist = await play.playlist_info(query, { incomplete: true });
      } catch (error) {
        logger.error("Failed fetching playlist info.", error);
        return message.reply("Gagal mengambil data playlist.");
      }

      let videos = [];
      try {
        videos = await playlist.all_videos();
      } catch (error) {
        logger.error("Failed fetching playlist videos.", error);
        return message.reply("Gagal mengambil daftar lagu dari playlist.");
      }

      if (!Array.isArray(videos) || videos.length === 0) {
        return message.reply("Playlist kosong atau tidak bisa dibaca.");
      }

      const tracks = videos
        .map((video) => {
          const videoUrl =
            video?.url || (video?.id ? `https://www.youtube.com/watch?v=${video.id}` : null);
          if (!videoUrl) return null;
          return {
            url: videoUrl,
            title: video?.title || videoUrl,
            requestedBy: message.author.tag,
            requestedById: message.author.id,
            requestedByTag: message.author.tag,
          };
        })
        .filter(Boolean);

      if (tracks.length === 0) {
        return message.reply("Playlist kosong atau tidak bisa dibaca.");
      }

      let result;
      try {
        result = await enqueueTracks(voiceChannel, tracks, {
          textChannelId: message.channel.id,
        });
      } catch (error) {
        logger.error("Queue error.", error);
        const state = message.guild ? getState(message.guild.id) : null;
        const status = state?.player?.state?.status;
        if (
          status === AudioPlayerStatus.Playing ||
          status === AudioPlayerStatus.Buffering
        ) {
          return;
        }
        if (error?.message === "STREAM_NEEDS_FFMPEG") {
          return message.reply(
            "Format audio butuh FFmpeg. Install FFmpeg atau gunakan link lain."
          );
        }
        if (error?.message === "STREAM_FALLBACK_FAILED") {
          return message.reply(
            "Gagal memutar audio (fallback yt-dlp). Coba lagi nanti."
          );
        }
        if (error?.message === "YTDLP_DOWNLOAD_FAILED") {
          return message.reply(
            "Gagal mengunduh yt-dlp. Cek koneksi atau coba lagi nanti."
          );
        }
        return message.reply("Gagal memutar audio.");
      }

      try {
        await updateControlPanel(message.client, result.state);
      } catch (error) {
        logger.warn("Failed updating control panel.", error);
      }

      const playlistTitle = playlist?.title || "Playlist";
      if (result.started) {
        return message.reply(
          `Memutar playlist: ${playlistTitle} (${tracks.length} lagu).`
        );
      }

      return message.reply(
        `Playlist ditambahkan: ${playlistTitle} (${tracks.length} lagu), mulai antrian #${result.startPosition}.`
      );
    }

    if (validation === "video") {
      url = query;
      try {
        info = await play.video_basic_info(query);
        url = info.video_details?.url || query;
        title = info.video_details?.title;
      } catch (error) {
        logger.warn("Failed getting YouTube info, continuing.", error);
      }
    } else {
      let youtubeResults = [];
      try {
        youtubeResults = await play.search(query, { limit: YT_SEARCH_LIMIT });
      } catch (error) {
        logger.error("Failed searching YouTube.", error);
      }

      const youtubeItems = (Array.isArray(youtubeResults) ? youtubeResults : [])
        .map((video) => {
          const videoUrl =
            video?.url || (video?.id ? `https://www.youtube.com/watch?v=${video.id}` : null);
          if (!videoUrl) return null;
          return {
            source: "youtube",
            title: video?.title || videoUrl,
            url: videoUrl,
            durationMs: getYoutubeDurationMs(video),
          };
        })
        .filter(Boolean);

      let spotifyItems = [];
      if (isSpotifyConfigured()) {
        try {
          const spotifyResults = await searchSpotifyTracks(
            query,
            SPOTIFY_SEARCH_LIMIT
          );
          spotifyItems = spotifyResults.map((track) => ({
            source: "spotify",
            title: track?.name || "Spotify Track",
            artists: track?.artists || [],
            durationMs: track?.durationMs || null,
            spotify: {
              id: track?.id,
              name: track?.name,
              artists: track?.artists || [],
              durationMs: track?.durationMs || 0,
            },
            url: track?.url || null,
          }));
        } catch (error) {
          logger.warn("Failed searching Spotify, continuing.", error);
        }
      }

      const combined = [...youtubeItems, ...spotifyItems].slice(
        0,
        SEARCH_OPTION_LIMIT
      );

      if (combined.length === 0) {
        return message.reply("Tidak menemukan hasil untuk judul itu.");
      }

      const selectMenu = buildSearchSelect(combined);
      if (!selectMenu) {
        return message.reply("Tidak menemukan hasil untuk judul itu.");
      }

      const row = new ActionRowBuilder().addComponents(selectMenu);
      const targetLabel = voiceChannel?.id ? ` di <#${voiceChannel.id}>` : "";
      const sent = await message.reply({
        content: `Pilih hasil pencarian (YT/Spotify)${targetLabel}:`,
        components: [row],
      });

      registerSearchSession(sent.id, {
        requesterId: message.author.id,
        voiceChannelId: voiceChannel?.id || null,
        textChannelId: message.channel.id,
        results: combined,
      });

      return;
    }

    let videoId;
    try {
      videoId = play.extractID(url);
    } catch (error) {
      logger.warn("Invalid YouTube URL.", error);
      return message.reply("URL tidak valid. Pastikan link YouTube video.");
    }

    url = `https://www.youtube.com/watch?v=${videoId}`;

    const track = {
      url,
      title: title || url,
      requestedBy: message.author.tag,
      requestedById: message.author.id,
      requestedByTag: message.author.tag,
    };
    if (info) track.info = info;

    let result;
    try {
      result = await enqueueTrack(voiceChannel, track, {
        textChannelId: message.channel.id,
      });
    } catch (error) {
      logger.error("Queue error.", error);
      const state = message.guild ? getState(message.guild.id) : null;
      const status = state?.player?.state?.status;
      if (
        status === AudioPlayerStatus.Playing ||
        status === AudioPlayerStatus.Buffering
      ) {
        return;
      }
      if (error?.message === "STREAM_NEEDS_FFMPEG") {
        return message.reply(
          "Format audio butuh FFmpeg. Install FFmpeg atau gunakan link lain."
        );
      }
      if (error?.message === "STREAM_FALLBACK_FAILED") {
        return message.reply(
          "Gagal memutar audio (fallback yt-dlp). Coba lagi nanti."
        );
      }
      if (error?.message === "YTDLP_DOWNLOAD_FAILED") {
        return message.reply(
          "Gagal mengunduh yt-dlp. Cek koneksi atau coba lagi nanti."
        );
      }
      return message.reply("Gagal memutar audio.");
    }

    if (result.started) {
      try {
        await updateControlPanel(message.client, result.state);
      } catch (error) {
        logger.warn("Failed updating control panel.", error);
      }
      return message.reply(`Memutar: ${track.title}`);
    }

    try {
      await updateControlPanel(message.client, result.state);
    } catch (error) {
      logger.warn("Failed updating control panel.", error);
    }
    return message.reply(`Ditambahkan ke antrian #${result.position}: ${track.title}`);
  },
};
