const platform = require("../../../functions/platform");
const getConfig = require("../../../config");
const config = getConfig();

function clampInt(value, min, max, fallback) {
  const num = Number.isFinite(Number(value)) ? Number(value) : fallback;
  const int = Number.isInteger(num) ? num : Math.floor(num);
  return Math.max(min, Math.min(max, int));
}

function formatResults(results, maxChars = 1600) {
  if (!Array.isArray(results) || results.length === 0) return "Tidak ada hasil yang ditemukan.";

  const lines = [];
  let remaining = Math.max(200, maxChars);

  for (let i = 0; i < results.length; i++) {
    const item = results[i] || {};
    const title = String(item.title || "").trim();
    const url = String(item.url || "").trim();
    const snippet = String(item.snippet || "").trim();

    const safeTitle = title || "(tanpa judul)";
    const safeUrl = url || "-";

    const block = [
      `${i + 1}) ${safeTitle}`,
      safeUrl,
      snippet ? `- ${snippet}` : null,
    ].filter(Boolean).join("\n");

    if (block.length + 2 > remaining) break;
    lines.push(block);
    remaining -= (block.length + 2);
    if (remaining <= 60) break;
  }

  return lines.join("\n\n");
}

module.exports = {
  name: "google",
  description: "Cari info terbaru di web (Google CSE jika dikonfigurasi; fallback ke DuckDuckGo).",
  async execute(message, args) {
    const query = args.join(" ").trim();
    const prefix = String(config.prefix || "yova").trim() || "yova";

    if (!query) {
      return message.reply(`Format: \`${prefix} google <kata kunci>\``);
    }

    const maxResults = clampInt(config.web_search_max_results_default, 1, 8, 5);
    const safeSearch = clampInt(config.web_search_safe_default, 0, 2, 1);

    const results = await platform.searchWeb(query, maxResults, safeSearch);
    const header = `Hasil pencarian untuk: **${query}**`;
    const body = formatResults(results);

    return message.reply([header, body].filter(Boolean).join("\n\n"));
  },
};
