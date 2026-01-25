const fs = require("fs");
const path = require("path");

const DOC_PATH = path.join(__dirname, "..", "docs", "BOT_HELP.md");
const MAX_MESSAGE_LENGTH = 1800;

const DEFAULT_TEXT =
  "Yova bot Discord.\n\n" +
  "Fitur utama:\n" +
  "- Musik (YouTube/YouTube Music + Spotify link -> YouTube)\n" +
  "- Panel kontrol + queue + repeat/shuffle\n" +
  "- Favorit (kesukaanku)\n" +
  "- AI chat + ucapkan\n" +
  "- Join voice + restore antrian\n";

let cachedText = null;
let cachedMtimeMs = 0;

function loadDocText() {
  try {
    const stat = fs.statSync(DOC_PATH);
    if (cachedText && cachedMtimeMs === stat.mtimeMs) {
      return cachedText;
    }
    const raw = fs.readFileSync(DOC_PATH, "utf8");
    cachedText = String(raw || "").trim();
    cachedMtimeMs = stat.mtimeMs;
    return cachedText || DEFAULT_TEXT;
  } catch (error) {
    return DEFAULT_TEXT;
  }
}

function getBotHelpText({ maxLength = MAX_MESSAGE_LENGTH } = {}) {
  let text = loadDocText();
  if (text.length > maxLength) {
    text = text.slice(0, maxLength - 3).trimEnd() + "...";
  }
  return text;
}

function answerBotQuestion(prompt) {
  const text = String(prompt || "").toLowerCase();
  if (!text) return getBotHelpText();

  if (text.includes("spotify")) {
    return (
      "Bisa. Pakai `yova play <link spotify>` (track/playlist/album). " +
      "Spotify cuma metadata, playback tetap dari YouTube. " +
      "Kalau cari judul, hasilnya muncul list YT/Spotify."
    );
  }
  if (text.includes("youtube") || text.includes("yt")) {
    return (
      "Bisa. Pakai `yova play <judul|url>` untuk YouTube/YouTube Music. " +
      "Judul akan menampilkan list hasil (YT/Spotify)."
    );
  }
  if (text.includes("panel") || text.includes("kontrol")) {
    return "Ada panel kontrol. Pakai `yova kontrol` buat tombol play/pause/skip/repeat/queue.";
  }
  if (text.includes("queue") || text.includes("antrian")) {
    return "Queue ada. Bisa lihat di panel kontrol dan pilih lagu dari daftar antrian.";
  }
  if (text.includes("favorit") || text.includes("kesukaanku")) {
    return "Ada favorit. Pakai `yova kesukaanku` atau `yova play kesukaanku`.";
  }
  if (text.includes("ringkas") || text.includes("rangkum") || text.includes("summary")) {
    return "Bisa ringkas channel. Pakai `yova ringkas [n]` atau `yova rangkum [n]`.";
  }
  if (text.includes("ai") || text.includes("ucapkan")) {
    return "AI bisa chat bebas atau `yova ucapkan <pesan> @user`.";
  }
  if (text.includes("panggil")) {
    return "Bisa simpan panggilan. Pakai `yova panggil aku <nama>`.";
  }
  if (text.includes("join") || text.includes("voice")) {
    return "Bisa join voice. Pakai `yova join <nama_channel|@user|default>`.";
  }
  if (text.includes("member") || text.includes("anggota")) {
    return (
      "Bisa cek member. Contoh: `yova member awal 5`, `yova member baru 5`, " +
      "`yova member jumlah`, atau `yova cek member awal 5`."
    );
  }
  if (text.includes("restore")) {
    return "Bisa restore antrian. Pakai `yova restore`.";
  }
  if (text.includes("log")) {
    return "Log disimpan di `logs/bot-YYYY-MM-DD.log`.";
  }

  return getBotHelpText();
}

function isBotQuestion(prompt) {
  const text = String(prompt || "").toLowerCase();
  if (!text) return false;
  const helpKeyword = /\b(fitur|perintah|command|menu|panduan|help)\b/.test(text);
  const featureKeyword =
    /\b(spotify|youtube|yt|panel|kontrol|queue|antrian|favorit|kesukaanku|ai|ucapkan|panggil|join|voice|restore|log|play|pause|skip|next|sebelumnya|stop|leave|shuffle|repeat|loop)\b/.test(
      text
    );
  const hasBisa = /\bbisa\b/.test(text);
  return (
    text.includes("jelaskan dirimu") ||
    text.includes("jelasin dirimu") ||
    text.includes("siapa kamu") ||
    text.includes("kamu siapa") ||
    text.includes("bisa apa") ||
    text.includes("bisa ngapain") ||
    helpKeyword ||
    (hasBisa && featureKeyword)
  );
}

module.exports = {
  getBotHelpText,
  answerBotQuestion,
  isBotQuestion,
};
