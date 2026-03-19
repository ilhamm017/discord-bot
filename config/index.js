const fs = require("fs");
const path = require("path");

const CWD = process.cwd();
const DEFAULT_CONFIG_PATH = path.resolve(CWD, "config.json");
const LOCAL_CONFIG_PATH = path.resolve(CWD, "config.local.json");

function parseBoolean(value) {
  const v = String(value || "").trim().toLowerCase();
  if (!v) return null;
  if (["1", "true", "yes", "on"].includes(v)) return true;
  if (["0", "false", "no", "off"].includes(v)) return false;
  return null;
}

function readJsonFile(filePath) {
  try {
    if (!filePath) return {};
    if (!fs.existsSync(filePath)) return {};
    const raw = fs.readFileSync(filePath, "utf8");
    const json = JSON.parse(raw);
    return json && typeof json === "object" ? json : {};
  } catch {
    return {};
  }
}

function getConfigFilePath() {
  const override = String(process.env.YOVA_CONFIG_PATH || "").trim();
  if (override) {
    return path.isAbsolute(override) ? override : path.resolve(CWD, override);
  }
  if (fs.existsSync(LOCAL_CONFIG_PATH)) return LOCAL_CONFIG_PATH;
  if (fs.existsSync(DEFAULT_CONFIG_PATH)) return DEFAULT_CONFIG_PATH;
  return DEFAULT_CONFIG_PATH;
}

function applyEnvOverrides(config) {
  const next = { ...(config || {}) };

  const map = {
    token: ["DISCORD_BOT_TOKEN", "DISCORD_TOKEN"],
    prefix: ["YOVA_PREFIX", "PREFIX"],
    log_level: ["LOG_LEVEL"],
    terminal_log_level: ["TERMINAL_LOG_LEVEL"],
    log_to_stdout: ["LOG_TO_STDOUT"],

    google_api_key: ["GOOGLE_API_KEY"],
    groq_api_key: ["GROQ_API_KEY"],
    spotify_client_id: ["SPOTIFY_CLIENT_ID"],
    spotify_client_secret: ["SPOTIFY_CLIENT_SECRET"],

    web_search_provider: ["WEB_SEARCH_PROVIDER"],
    google_cse_api_key: ["GOOGLE_CSE_API_KEY"],
    google_cse_cx: ["GOOGLE_CSE_CX"],

    browser_automation_enabled: ["BROWSER_AUTOMATION_ENABLED", "BROWSEROS_MCP_ENABLED"],
    browser_automation_backend: ["BROWSER_AUTOMATION_BACKEND"],
    browser_automation_timeout_ms: ["BROWSER_AUTOMATION_TIMEOUT_MS"],
    browseros_max_results_default: ["BROWSEROS_MAX_RESULTS_DEFAULT"],
    browseros_search_engine: ["BROWSEROS_SEARCH_ENGINE"],
    browser_automation_rate_limit_per_user_ms: ["BROWSER_AUTOMATION_RATE_LIMIT_PER_USER_MS", "BROWSEROS_RATE_LIMIT_PER_USER_MS"],
    browser_automation_allowlist_domains: ["BROWSER_AUTOMATION_ALLOWLIST_DOMAINS"],
    browser_fetch_max_chars: ["BROWSER_FETCH_MAX_CHARS"],
  };

  for (const [key, envNames] of Object.entries(map)) {
    for (const envName of envNames) {
      const raw = process.env[envName];
      if (raw === undefined || raw === null || String(raw).trim() === "") continue;

      if (typeof next[key] === "boolean") {
        const parsed = parseBoolean(raw);
        next[key] = parsed !== null ? parsed : Boolean(raw);
      } else if (typeof next[key] === "number") {
        const n = Number(raw);
        if (Number.isFinite(n)) next[key] = n;
      } else if (key === "browseros_allowlist_domains") {
        next[key] = String(raw)
          .split(/[,\n]/g)
          .map((s) => s.trim())
          .filter(Boolean);
      } else {
        next[key] = String(raw);
      }

      break;
    }
  }

  return next;
}

let __cache = {
  loadedAtMs: 0,
  mtimeMs: 0,
  filePath: null,
  config: {},
};

function getConfig({ fresh = false } = {}) {
  const filePath = getConfigFilePath();
  const now = Date.now();

  if (!fresh && __cache.filePath === filePath && now - __cache.loadedAtMs < 1500) {
    return __cache.config;
  }

  let mtimeMs = 0;
  try {
    const stat = fs.statSync(filePath);
    mtimeMs = stat.mtimeMs || 0;
  } catch {
    mtimeMs = 0;
  }

  if (!fresh && __cache.filePath === filePath && __cache.mtimeMs === mtimeMs) {
    __cache.loadedAtMs = now;
    return __cache.config;
  }

  const fileConfig = readJsonFile(filePath);
  const merged = applyEnvOverrides(fileConfig);

  __cache = {
    loadedAtMs: now,
    mtimeMs,
    filePath,
    config: merged,
  };

  return merged;
}

module.exports = getConfig;
module.exports.getConfig = getConfig;
module.exports.getConfigFilePath = getConfigFilePath;
module.exports.readConfigFile = () => readJsonFile(getConfigFilePath());
