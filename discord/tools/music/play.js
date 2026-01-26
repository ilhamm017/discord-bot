const play = require("play-dl");
const { parseSpotifyInput } = require("../../../utils/common/spotify");
const {
  resolveTargetVoiceChannel,
  stripTargetTokens,
} = require("./play/utils");
const { handleFavorites } = require("./play/favorites");
const { handleSpotify } = require("./play/spotify");
const { handleYoutube } = require("./play/youtube");

const MENTION_TEST_REGEX = /<@!?\d+>/;

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

    // 1. Kesukaanku
    if (query.toLowerCase() === "kesukaanku") {
      return handleFavorites(message, voiceChannel);
    }

    // 2. Spotify
    const spotifyRef = parseSpotifyInput(query);
    if (spotifyRef) {
      return handleSpotify(message, voiceChannel, spotifyRef, query);
    }

    // 3. YouTube (Video, Playlist, Search)
    const validation = play.yt_validate(query);
    return handleYoutube(message, voiceChannel, query, validation);
  },
};
