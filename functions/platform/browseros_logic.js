const logger = require("../../utils/logger");
const getConfig = require("../../config/index.js");
const { getChromiumBrowser, hookProcessExit } = require("../../utils/browser_automation/playwright_pool");

function clampInt(value, min, max, fallback) {
  const num = Number.isFinite(Number(value)) ? Number(value) : fallback;
  const int = Number.isInteger(num) ? num : Math.floor(num);
  return Math.max(min, Math.min(max, int));
}

function isHttpUrl(url) {
  try {
    const u = new URL(String(url || ""));
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

function hostMatchesAllowlist(host, allowlist = []) {
  const list = Array.isArray(allowlist) ? allowlist : String(allowlist || "").split(/[,\n]/g);
  const normalized = list.map((s) => String(s || "").trim().toLowerCase()).filter(Boolean);
  if (!normalized.length) return true;
  const h = String(host || "").toLowerCase();
  return normalized.some((entry) => h === entry || h.endsWith(`.${entry}`));
}

function truncateText(text, maxChars) {
  const limit = clampInt(maxChars, 50, 50_000, 8000);
  const s = String(text || "");
  if (s.length <= limit) return s;
  return s.slice(0, limit - 1).trimEnd() + "…";
}

function isBrowserEnabled(config) {
  if (typeof config.browser_automation_enabled === "boolean") return config.browser_automation_enabled;
  if (typeof config.browseros_mcp_enabled === "boolean") return config.browseros_mcp_enabled;
  if (process.env.BROWSER_AUTOMATION_ENABLED) return process.env.BROWSER_AUTOMATION_ENABLED !== "false";
  if (process.env.BROWSEROS_MCP_ENABLED) return process.env.BROWSEROS_MCP_ENABLED !== "false";
  return true;
}

function getBrowserTimeoutMs(config) {
  const raw = config.browser_automation_timeout_ms ?? config.browseros_timeout_ms ?? process.env.BROWSER_AUTOMATION_TIMEOUT_MS ?? process.env.BROWSEROS_TIMEOUT_MS;
  return clampInt(raw, 2000, 60000, 15000);
}

function getBrowserBackend(config) {
  const env = String(process.env.BROWSER_AUTOMATION_BACKEND || "").trim().toLowerCase();
  const cfg = String(config.browser_automation_backend || "").trim().toLowerCase();
  return env || cfg || "playwright";
}

function getRateLimitMs(config) {
  const raw = config.browser_automation_rate_limit_per_user_ms ?? config.browseros_rate_limit_per_user_ms ?? process.env.BROWSER_AUTOMATION_RATE_LIMIT_PER_USER_MS ?? process.env.BROWSEROS_RATE_LIMIT_PER_USER_MS;
  return clampInt(raw, 0, 60000, 8000);
}

function getAllowlistDomains(config) {
  return config.browser_automation_allowlist_domains ?? config.browseros_allowlist_domains ?? [];
}

const __rateLimit = new Map(); // key -> lastCallAtMs
function enforceRateLimit({ guildId, userId, key, cooldownMs }) {
  const uid = String(userId || "unknown");
  const gid = String(guildId || "unknown");
  const k = `${gid}:${uid}:${key}`;
  const now = Date.now();
  const last = __rateLimit.get(k) || 0;
  const wait = now - last;
  if (wait < cooldownMs) {
    throw new Error(`Rate limit: tunggu ${Math.ceil((cooldownMs - wait) / 1000)} detik sebelum mencoba lagi.`);
  }
  __rateLimit.set(k, now);
}

function extractPageId(obj) {
  if (!obj || typeof obj !== "object") return "";
  const candidates = [obj.pageId, obj.page_id, obj.id, obj.tabId, obj.tab_id, obj.page, obj.tab];
  for (const c of candidates) {
    const s = String(c || "").trim();
    if (s) return s;
  }
  return "";
}

async function newPageContext(config) {
  hookProcessExit();
  const timeoutMs = getBrowserTimeoutMs(config);
  const browser = await getChromiumBrowser({ headless: true, timeoutMs });
  const context = await browser.newContext({
    userAgent: config.web_search_user_agent ? String(config.web_search_user_agent) : undefined,
    locale: config.web_search_hl ? String(config.web_search_hl) : undefined,
  });
  context.setDefaultTimeout(timeoutMs);
  context.setDefaultNavigationTimeout(timeoutMs);
  const page = await context.newPage();
  return { context, page, timeoutMs };
}

async function closePageContext({ context } = {}) {
  try {
    await context?.close?.();
  } catch {
    // ignore
  }
}

function buildGoogleUrl(query, { hl = null, gl = null } = {}) {
  const u = new URL("https://www.google.com/search");
  u.searchParams.set("q", String(query || ""));
  u.searchParams.set("num", "10");
  u.searchParams.set("pws", "0");
  u.searchParams.set("safe", "active");
  if (hl) u.searchParams.set("hl", String(hl));
  if (gl) u.searchParams.set("gl", String(gl));
  return u.toString();
}

function buildDuckDuckGoUrl(query) {
  const u = new URL("https://duckduckgo.com/");
  u.searchParams.set("q", String(query || ""));
  return u.toString();
}

const GOOGLE_EXTRACT_SCRIPT = `
(() => {
  const text = (document.body && document.body.innerText ? document.body.innerText : "").toLowerCase();
  const captcha = text.includes("unusual traffic") || text.includes("detected unusual traffic") || !!document.querySelector("form#captcha-form, #recaptcha");
  const seen = new Set();
  const results = [];
  const anchors = Array.from(document.querySelectorAll("a")).filter(a => a && a.href && a.querySelector("h3"));
  for (const a of anchors) {
    const h3 = a.querySelector("h3");
    const title = (h3 && h3.innerText ? h3.innerText : "").trim();
    const url = String(a.href || "").trim();
    if (!title || !url) continue;
    if (!/^https?:\\/\\//i.test(url)) continue;
    if (url.includes("google.com/search") || url.includes("webcache.googleusercontent.com")) continue;
    if (seen.has(url)) continue;
    seen.add(url);
    let snippet = "";
    const container = a.closest("div") || a.parentElement;
    if (container) {
      const snippetEl = container.querySelector("div[style*='-webkit-line-clamp'], span[style*='-webkit-line-clamp']") || container.querySelector("div.VwiC3b, span.VwiC3b");
      if (snippetEl && snippetEl.innerText) snippet = snippetEl.innerText.trim();
    }
    results.push({ title, url, snippet });
    if (results.length >= 8) break;
  }
  return { captcha, results };
})()
`;

const DDG_EXTRACT_SCRIPT = `
(() => {
  const results = [];
  const seen = new Set();
  const blocks = Array.from(document.querySelectorAll("[data-testid='result']"));
  for (const b of blocks) {
    const a = b.querySelector("a[data-testid='result-title-a']") || b.querySelector("a");
    const title = a && a.innerText ? a.innerText.trim() : "";
    const url = a && a.href ? String(a.href).trim() : "";
    if (!title || !url) continue;
    if (!/^https?:\\/\\//i.test(url)) continue;
    if (seen.has(url)) continue;
    seen.add(url);
    const sn = b.querySelector("[data-testid='result-snippet']") || b.querySelector(".result__snippet");
    const snippet = sn && sn.innerText ? sn.innerText.trim() : "";
    results.push({ title, url, snippet });
    if (results.length >= 8) break;
  }
  return { results };
})()
`;

async function browserosSearch(guildId, userId, query, {
  engine = null,
  maxResults = null,
  hl = null,
  gl = null,
} = {}) {
  const config = getConfig({ fresh: true });
  if (!isBrowserEnabled(config)) {
    throw new Error("Browser automation is disabled (browser_automation_enabled=false).");
  }
  const backend = getBrowserBackend(config);
  const cooldownMs = getRateLimitMs(config);
  if (cooldownMs > 0) {
    enforceRateLimit({ guildId, userId, key: "browserosSearch", cooldownMs });
  }

  const q = String(query || "").trim();
  if (!q) return [];

  const effectiveEngine = String(engine || config.browseros_search_engine || "google").toLowerCase().trim();
  const limit = clampInt(maxResults ?? config.browseros_max_results_default, 1, 8, 5);

  if (backend === "mock") {
    const isCaptcha = q.toLowerCase().includes("captcha");
    if (effectiveEngine === "duckduckgo" || isCaptcha) {
      return [
        { title: "DDG Result 1", url: "https://ddg.example/1", snippet: "d1" },
        { title: "DDG Result 2", url: "https://ddg.example/2", snippet: "d2" },
      ].slice(0, limit);
    }
    return [
      { title: "G Result 1", url: "https://example.com/1", snippet: "s1" },
      { title: "G Result 2", url: "https://example.com/2", snippet: "s2" },
    ].slice(0, limit);
  }

  const { context, page } = await newPageContext(config);
  try {
    if (effectiveEngine === "duckduckgo") {
      await page.goto(buildDuckDuckGoUrl(q), { waitUntil: "domcontentloaded" });
      const payload = await page.evaluate(DDG_EXTRACT_SCRIPT);
      const results = Array.isArray(payload?.results) ? payload.results : [];
      return results.slice(0, limit);
    }

    await page.goto(buildGoogleUrl(q, { hl, gl }), { waitUntil: "domcontentloaded" });
    const payload = await page.evaluate(GOOGLE_EXTRACT_SCRIPT);
    const results = Array.isArray(payload?.results) ? payload.results : [];
    const captcha = Boolean(payload?.captcha) || results.length === 0;

    if (captcha) {
      logger.debug("BrowserOS Google search yielded no results or captcha; falling back to DuckDuckGo in BrowserOS.", {
        query: q,
      });
      await page.goto(buildDuckDuckGoUrl(q), { waitUntil: "domcontentloaded" });
      const fallbackPayload = await page.evaluate(DDG_EXTRACT_SCRIPT);
      const fallbackResults = Array.isArray(fallbackPayload?.results) ? fallbackPayload.results : [];
      return fallbackResults.slice(0, limit);
    }

    return results.slice(0, limit);
  } finally {
    await closePageContext({ context });
  }
}

async function browserosFetchPage(guildId, userId, url, { maxChars = 8000 } = {}) {
  const config = getConfig({ fresh: true });
  if (!isBrowserEnabled(config)) {
    throw new Error("Browser automation is disabled (browser_automation_enabled=false).");
  }
  const backend = getBrowserBackend(config);
  const cooldownMs = getRateLimitMs(config);
  if (cooldownMs > 0) {
    enforceRateLimit({ guildId, userId, key: "browserosFetchPage", cooldownMs });
  }

  const rawUrl = String(url || "").trim();
  if (!isHttpUrl(rawUrl)) {
    throw new Error("URL harus http/https.");
  }

  const u = new URL(rawUrl);
  if (!hostMatchesAllowlist(u.hostname, getAllowlistDomains(config))) {
    throw new Error(`Domain tidak diizinkan: ${u.hostname}`);
  }

  if (backend === "mock") {
    const markdownRaw = `# Mock Page\n\nURL: ${rawUrl}\n\nHello world.`;
    return {
      url: rawUrl,
      title: "Mock Page",
      markdown: truncateText(markdownRaw, maxChars),
      links: [
        { text: "Link A", url: "https://a.example" },
        { text: "Link B", url: "https://b.example" },
      ],
    };
  }

  const { context, page } = await newPageContext(config);
  try {
    await page.goto(rawUrl, { waitUntil: "domcontentloaded" });
    const payload = await page.evaluate(() => {
      const title = document.title || "";
      const text = document.body && document.body.innerText ? document.body.innerText : "";
      const links = Array.from(document.querySelectorAll("a"))
        .map((a) => {
          const href = a && a.href ? String(a.href) : "";
          if (!href) return null;
          const lower = href.toLowerCase();
          if (!lower.startsWith("http://") && !lower.startsWith("https://")) return null;
          const t = a.innerText ? String(a.innerText).trim() : "";
          return { text: t.slice(0, 120), url: href };
        })
        .filter(Boolean)
        .slice(0, 80);
      return { title, text, links };
    });

    const title = payload?.title ? String(payload.title).trim() : null;
    const bodyText = payload?.text ? String(payload.text).trim() : "";
    const markdownRaw = `${title ? `# ${title}\n\n` : ""}${bodyText}`;
    const markdown = truncateText(markdownRaw, maxChars);
    const links = Array.isArray(payload?.links) ? payload.links : [];
    return {
      url: rawUrl,
      title,
      markdown,
      links,
    };
  } finally {
    await closePageContext({ context });
  }
}

async function browserosOpenInteractive(guildId, userId, url) {
  const config = getConfig({ fresh: true });
  if (!isBrowserEnabled(config)) {
    throw new Error("Browser automation is disabled (browser_automation_enabled=false).");
  }
  const cooldownMs = getRateLimitMs(config);
  if (cooldownMs > 0) {
    enforceRateLimit({ guildId, userId, key: "browserosOpenInteractive", cooldownMs });
  }

  const rawUrl = String(url || "").trim();
  if (!isHttpUrl(rawUrl)) {
    throw new Error("URL harus http/https.");
  }
  const u = new URL(rawUrl);
  if (!hostMatchesAllowlist(u.hostname, getAllowlistDomains(config))) {
    throw new Error(`Domain tidak diizinkan: ${u.hostname}`);
  }

  throw new Error("Open interactive tidak didukung di server/headless. Gunakan `browse <url>` atau jalankan Yova di mesin yang punya GUI.");
}

module.exports = {
  browserosSearch,
  browserosFetchPage,
  browserosOpenInteractive,
};
