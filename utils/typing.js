let config = {};
try {
  config = require("../config.json");
} catch (error) {
  config = {};
}

const DEFAULTS = {
  enabled: true,
  minMs: 600,
  maxMs: 1400,
  perCharMs: 8,
  maxTotalMs: 5000,
  intervalMs: 7000,
};

function getTypingConfig() {
  return {
    enabled:
      typeof config.typing_delay_enabled === "boolean"
        ? config.typing_delay_enabled
        : DEFAULTS.enabled,
    minMs: Number.isFinite(Number(config.typing_delay_min_ms))
      ? Number(config.typing_delay_min_ms)
      : DEFAULTS.minMs,
    maxMs: Number.isFinite(Number(config.typing_delay_max_ms))
      ? Number(config.typing_delay_max_ms)
      : DEFAULTS.maxMs,
    perCharMs: Number.isFinite(Number(config.typing_delay_per_char_ms))
      ? Number(config.typing_delay_per_char_ms)
      : DEFAULTS.perCharMs,
    maxTotalMs: Number.isFinite(Number(config.typing_delay_max_ms_total))
      ? Number(config.typing_delay_max_ms_total)
      : DEFAULTS.maxTotalMs,
    intervalMs: Number.isFinite(Number(config.typing_delay_interval_ms))
      ? Number(config.typing_delay_interval_ms)
      : DEFAULTS.intervalMs,
  };
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function computeTypingDelay(text) {
  const cfg = getTypingConfig();
  if (!cfg.enabled) return 0;

  const length = text ? String(text).length : 0;
  const jitter = cfg.minMs + Math.random() * Math.max(0, cfg.maxMs - cfg.minMs);
  const delay = jitter + length * cfg.perCharMs;
  return clamp(delay, cfg.minMs, cfg.maxTotalMs);
}

async function waitWithTyping(channel, text) {
  if (!channel?.sendTyping) return;
  const cfg = getTypingConfig();
  if (!cfg.enabled) return;

  const delay = computeTypingDelay(text);
  if (delay <= 0) return;

  const interval = clamp(cfg.intervalMs, 2000, 9000);
  let remaining = delay;

  await channel.sendTyping();
  while (remaining > interval) {
    await new Promise((resolve) => setTimeout(resolve, interval));
    remaining -= interval;
    await channel.sendTyping();
  }
  if (remaining > 0) {
    await new Promise((resolve) => setTimeout(resolve, remaining));
  }
}

module.exports = {
  waitWithTyping,
  computeTypingDelay,
};
