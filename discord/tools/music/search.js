const play = require("play-dl");
const { parseSpotifyInput } = require("../../../utils/common/spotify");
const {
  resolveTargetVoiceChannel,
  stripTargetTokens,
} = require("./play/utils");
const { handleSpotify } = require("./play/spotify");
const { handleYoutube } = require("./play/youtube");

const MENTION_TEST_REGEX = /<@!?\d+>/;

module.exports = {
  name: "search",
  description: "Cari lagu dan tampilkan daftar hasil yang bisa dipilih.",
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
        "Masukkan judul lagu. Contoh: yova search feel good inc"
      );
    }

    const spotifyRef = parseSpotifyInput(query);
    if (spotifyRef) {
      return handleSpotify(message, voiceChannel, spotifyRef, query);
    }

    const validation = play.yt_validate(query);
    return handleYoutube(message, voiceChannel, query, validation, {
      forceSelection: validation !== "video" && validation !== "playlist",
      forceTopYoutube: false,
      targetMember: target.targetMember || null,
    });
  },
};
