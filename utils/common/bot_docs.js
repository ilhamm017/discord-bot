const fs = require("fs");
const path = require("path");

const DOC_PATH = path.join(process.cwd(), "docs", "BOT_HELP.md");
const MAX_MESSAGE_LENGTH = 1800;

const DEFAULT_TEXT =
  "Yova bot Discord.\n\n" +
  "Fitur utama:\n" +
  "- Musik (YouTube/YouTube Music + Spotify playlist -> YouTube)\n" +
  "- Panel kontrol + queue + repeat/shuffle\n" +
  "- Favorit (kesukaanku)\n" +
  "- AI chat + ucapkan\n" +
  "- Join voice + restore antrian\n";

let cachedText = null;
let cachedMtimeMs = 0;

function getPrefix() {
  try {
    // Read lazily so tests can set env/config before requiring this module.
    // config.json is expected at repo root (process.cwd()).
    // eslint-disable-next-line global-require
    const config = require("../../config.json");
    const prefix = typeof config?.prefix === "string" ? config.prefix.trim() : "";
    return prefix || "yova";
  } catch {
    return "yova";
  }
}

function applyPrefix(text, prefix) {
  const safePrefix = typeof prefix === "string" && prefix.trim() ? prefix.trim() : "yova";
  return String(text || "").replace(/\byova\b/g, safePrefix);
}

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
  const prefix = getPrefix();
  let text = applyPrefix(loadDocText(), prefix);
  if (text.length > maxLength) {
    text = text.slice(0, maxLength - 3).trimEnd() + "...";
  }
  return text;
}

function answerBotQuestion(prompt) {
  const prefix = getPrefix();
  const text = String(prompt || "").toLowerCase();
  if (!text) return getBotHelpText();

  if (text.includes("spotify")) {
    return applyPrefix(
      "Bisa untuk Spotify playlist saja. Pakai `yova play <link spotify playlist>`. " +
      "Yova akan coba ambil daftar lagu dari playlist lalu cari versi YouTube per lagu dan masukkan ke antrian.",
      prefix
    );
  }
  if (/\byoutube\b/.test(text) || /\byt\b/.test(text)) {
    return applyPrefix(
      "Bisa. Pakai `yova play <judul|url>` untuk YouTube/YouTube Music. " +
      "Judul akan menampilkan list hasil YouTube.",
      prefix
    );
  }
  if (text.includes("panel") || text.includes("kontrol")) {
    return applyPrefix(
      "Ada panel kontrol. Pakai `yova kontrol` buat tombol play/pause/skip/repeat/queue.",
      prefix
    );
  }
  if (text.includes("queue") || text.includes("antrian")) {
    return "Queue ada. Bisa lihat di panel kontrol dan pilih lagu dari daftar antrian.";
  }
  if (text.includes("favorit") || text.includes("kesukaanku")) {
    return applyPrefix("Ada favorit. Pakai `yova kesukaanku` atau `yova play kesukaanku`.", prefix);
  }
  if (text.includes("ringkas") || text.includes("rangkum") || text.includes("summary")) {
    return applyPrefix("Bisa ringkas channel. Pakai `yova ringkas [n]` atau `yova rangkum [n]`.", prefix);
  }
  if (/\bai\b/.test(text) || text.includes("ucapkan")) {
    return applyPrefix("AI bisa chat bebas atau `yova ucapkan <pesan> @user`.", prefix);
  }
  if (text.includes("panggil")) {
    return applyPrefix("Bisa simpan panggilan. Pakai `yova panggil aku <nama>`.", prefix);
  }
  if (text.includes("join") || text.includes("voice")) {
    return applyPrefix("Bisa join voice. Pakai `yova join <nama_channel|@user|default>`.", prefix);
  }
  if (text.includes("member") || text.includes("anggota")) {
    return applyPrefix(
      "Bisa cek member. Contoh: `yova member awal 5`, `yova member baru 5`, " +
      "`yova member jumlah`, atau `yova cek member awal 5`.",
      prefix
    );
  }
  if (text.includes("restore")) {
    return applyPrefix("Bisa restore antrian. Pakai `yova restore`.", prefix);
  }
  if (text.includes("log")) {
    return "Log disimpan di `logs/bot-YYYY-MM-DD.log`.";
  }

  return getBotHelpText();
}

function isBotQuestion(prompt) {
  const text = String(prompt || "").toLowerCase();
  if (!text) return false;
  const helpKeyword = /\b(fitur|perintah|command|commands|menu|panduan|help|cara pakai|cara pake|gimana pakai|gimana pake|how to use|usage)\b/.test(text);
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
