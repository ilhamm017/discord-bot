const platform = require("../../../functions/platform");
const getConfig = require("../../../config/index.js");

function clampInt(value, min, max, fallback) {
  const num = Number.isFinite(Number(value)) ? Number(value) : fallback;
  const int = Number.isInteger(num) ? num : Math.floor(num);
  return Math.max(min, Math.min(max, int));
}

function truncate(text, maxChars) {
  const s = String(text || "");
  const limit = clampInt(maxChars, 200, 1800, 1400);
  if (s.length <= limit) return s;
  return s.slice(0, limit - 1).trimEnd() + "…";
}

function formatLinks(links, maxItems = 8) {
  if (!Array.isArray(links) || links.length === 0) return "";
  const items = links
    .map((l) => {
      if (!l) return null;
      if (typeof l === "string") return l.trim();
      const url = String(l.url || l.href || "").trim();
      const text = String(l.text || l.title || "").trim();
      if (!url) return null;
      return text ? `${text} — ${url}` : url;
    })
    .filter(Boolean)
    .slice(0, clampInt(maxItems, 1, 25, 8));
  if (!items.length) return "";
  return ["**Links:**", ...items.map((x) => `- ${x}`)].join("\n");
}

module.exports = {
  name: "browse",
  description: "Buka URL via Chromium headless dan ekstrak konten (Markdown) + links.",
  async execute(message, args) {
    const config = getConfig();
    const prefix = String(config.prefix || "yova").trim() || "yova";
    const url = String(args[0] || "").trim();

    if (!url) {
      return message.reply(`Format: \`${prefix} browse <url>\``);
    }

    try {
      const maxChars = clampInt(config.browser_fetch_max_chars ?? config.browseros_fetch_max_chars, 500, 20000, 8000);
      const result = await platform.browserosFetchPage(message.guild?.id || "dm", message.author?.id, url, { maxChars });

      const content = truncate(result.markdown || "", 1400);
      const links = formatLinks(result.links, 8);
      const parts = [
        `Konten dari: ${result.url}`,
        content ? `\n${content}` : "",
        links ? `\n\n${links}` : "",
      ].filter(Boolean);

      return message.reply(parts.join(""));
    } catch (error) {
      return message.reply(`Gagal browse: ${error?.message || String(error)}`);
    }
  },
};
