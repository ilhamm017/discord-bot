const { AudioPlayerStatus } = require("@discordjs/voice");
const play = require("play-dl");
const { enqueueTrack, enqueueTracks, getState } = require("../music/queue");
const logger = require("../utils/logger");
const { updateControlPanel } = require("../music/panel");

module.exports = {
  name: "play",
  description: "Putar audio dari YouTube.",
  async execute(message, args) {
    if (!message.guild) {
      return message.reply("Perintah ini hanya bisa dipakai di server.");
    }

    const voiceChannel = message.member?.voice?.channel;
    if (!voiceChannel) {
      return message.reply("Kamu harus join voice channel dulu.");
    }

    const query = args.join(" ").trim();
    if (!query) {
      return message.reply(
        "Masukkan URL atau judul. Contoh: yova play <url/judul>"
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
    } else if (validation === "playlist") {
      return message.reply("Playlist belum didukung. Gunakan URL video atau judul.");
    } else {
      let results;
      try {
        results = await play.search(query, { limit: 1 });
      } catch (error) {
        logger.error("Failed searching YouTube.", error);
        return message.reply("Gagal mencari video.");
      }

      const video = results?.[0];
      if (!video?.url) {
        return message.reply("Tidak menemukan video untuk judul itu.");
      }

      url = video.url;
      title = video.title;
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
