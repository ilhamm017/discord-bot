const logger = require("../utils/logger");

// Track rate-limited/invalid keys: key -> { blockedUntil: timestamp, reason: string }
const keyCooldowns = new Map();
let rrIndex = 0;

function normalizeKey(value) {
  const key = String(value || "").trim();
  return key.length > 0 ? key : "";
}

function parseKeys(value) {
  if (!value) return [];
  if (Array.isArray(value)) {
    return value.map(normalizeKey).filter(Boolean);
  }
  if (typeof value === "string") {
    // allow comma/newline separated values
    return value
      .split(/[\n,]/g)
      .map(normalizeKey)
      .filter(Boolean);
  }
  return [];
}

function getConfiguredGoogleKeys(config = {}, env = process.env) {
  const fromConfigList = parseKeys(config.google_api_keys || config.googleApiKeys);
  const fromConfigSingle = parseKeys(config.google_api_key || config.googleApiKey);
  const fromEnvList = parseKeys(env.GOOGLE_API_KEYS);
  const fromEnvSingle = parseKeys(env.GOOGLE_API_KEY);

  const combined = [
    ...fromConfigList,
    ...fromConfigSingle,
    ...fromEnvList,
    ...fromEnvSingle,
  ];

  // de-dup while keeping order
  const seen = new Set();
  const keys = [];
  for (const k of combined) {
    if (seen.has(k)) continue;
    seen.add(k);
    keys.push(k);
  }
  return keys;
}

function pickNextKey(keys, { allowBlocked = false } = {}) {
  if (!Array.isArray(keys) || keys.length === 0) return "";
  const now = Date.now();

  const start = rrIndex % keys.length;
  for (let offset = 0; offset < keys.length; offset += 1) {
    const idx = (start + offset) % keys.length;
    const key = keys[idx];
    const cooldown = keyCooldowns.get(key);
    const blocked = cooldown && now < cooldown.blockedUntil;
    if (!blocked || allowBlocked) {
      rrIndex = (idx + 1) % keys.length;
      return key;
    }
  }

  return "";
}

function markKeyCooldown(key, cooldownMs, reason) {
  const normalized = normalizeKey(key);
  if (!normalized) return;
  const until = Date.now() + Math.max(0, Number(cooldownMs) || 0);
  keyCooldowns.set(normalized, { blockedUntil: until, reason: String(reason || "") });
  logger.warn(`Google API key marked on cooldown for ${cooldownMs}ms (${reason || "unknown"}).`);
}

module.exports = {
  getConfiguredGoogleKeys,
  pickNextKey,
  markKeyCooldown,
};

