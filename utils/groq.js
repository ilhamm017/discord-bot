const logger = require("./logger");

const DEFAULT_MODEL = "llama-3.3-70b-versatile";
const DEFAULT_FALLBACK_MODELS = [
  "llama-3.3-70b-versatile",
  "openai/gpt-oss-120b",
  "moonshotai/kimi-k2-instruct",
  "moonshotai/kimi-k2-instruct-0905",
  "meta-llama/llama-4-maverick-17b-128e-instruct",
  "qwen/qwen3-32b",
  "meta-llama/llama-4-scout-17b-16e-instruct",
  "openai/gpt-oss-20b",
  "groq/compound",
  "groq/compound-mini",
  "llama-3.1-8b-instant",
];

function normalizeModelList(value) {
  if (!value) return [];
  if (Array.isArray(value)) {
    return value.map((item) => String(item).trim()).filter(Boolean);
  }
  if (typeof value === "string") {
    return value
      .split(/[,\n]+/)
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return [];
}

function uniqueModels(list) {
  const seen = new Set();
  return list.filter((model) => {
    if (!model || seen.has(model)) return false;
    seen.add(model);
    return true;
  });
}

function getConfig() {
  let config = {};
  try {
    config = require("../config.json");
  } catch (error) {
    config = {};
  }

  const apiKey =
    config.groq_api_key ||
    config.groqApiKey ||
    process.env.GROQ_API_KEY;
  const model =
    config.groq_model ||
    config.groqModel ||
    process.env.GROQ_MODEL ||
    DEFAULT_MODEL;
  const fallbackRaw =
    config.groq_model_fallbacks ||
    config.groqModelFallbacks ||
    config.groq_models ||
    process.env.GROQ_MODEL_FALLBACKS ||
    process.env.GROQ_MODELS;
  const fallbacks = normalizeModelList(fallbackRaw);
  return { apiKey, model, fallbacks };
}

function buildModelList(model, fallbacks) {
  if (fallbacks.length > 0) {
    return uniqueModels([model, ...fallbacks]);
  }
  return uniqueModels([model, ...DEFAULT_FALLBACK_MODELS]);
}

function makeGroqError(code, message, details = {}) {
  const error = new Error(message || code);
  error.code = code;
  Object.assign(error, details);
  return error;
}

function shouldFallback(error) {
  if (!error) return false;
  if (error.code === "GROQ_API_KEY_MISSING") return false;
  if (error.code === "GROQ_INVALID_REQUEST") return false;

  const status = error.status;
  if ([408, 429, 500, 502, 503, 504].includes(status)) return true;

  const type = String(error.type || "").toLowerCase();
  if (type.includes("rate") || type.includes("overloaded")) return true;

  const message = String(error.message || "").toLowerCase();
  if (
    message.includes("rate limit") ||
    message.includes("too many requests") ||
    message.includes("overload") ||
    message.includes("timeout") ||
    message.includes("temporarily")
  ) {
    return true;
  }

  return [
    "GROQ_REQUEST_FAILED",
    "GROQ_RESPONSE_INVALID",
    "GROQ_EMPTY_RESPONSE",
  ].includes(error.code);
}

async function chatCompletion({
  system,
  user,
  messages,
  temperature = 0.7,
  maxTokens = 200,
}) {
  const { apiKey, model, fallbacks } = getConfig();
  if (!apiKey) {
    throw makeGroqError("GROQ_API_KEY_MISSING", "GROQ_API_KEY_MISSING");
  }

  let payloadMessages = [];
  if (Array.isArray(messages) && messages.length > 0) {
    payloadMessages = messages.filter(
      (entry) => entry && entry.role && entry.content
    );
  }

  if (payloadMessages.length === 0) {
    payloadMessages = [
      { role: "system", content: system || "" },
      { role: "user", content: user || "" },
    ];
  } else if (system) {
    const hasSystem = payloadMessages.some((entry) => entry.role === "system");
    if (!hasSystem) {
      payloadMessages.unshift({ role: "system", content: system });
    }
  }

  const models = buildModelList(model, fallbacks);
  let lastError = null;

  for (const currentModel of models) {
    const body = {
      model: currentModel,
      messages: payloadMessages,
      temperature,
      max_tokens: maxTokens,
    };

    let response;
    try {
      response = await fetch(
        "https://api.groq.com/openai/v1/chat/completions",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(body),
        }
      );
    } catch (error) {
      logger.error("Groq request failed.", error);
      lastError = makeGroqError("GROQ_REQUEST_FAILED", "GROQ_REQUEST_FAILED", {
        cause: error,
      });
      if (!shouldFallback(lastError)) throw lastError;
      logger.warn(`Groq fallback: request failed for ${currentModel}.`);
      continue;
    }

    let data;
    try {
      data = await response.json();
    } catch (error) {
      logger.error("Groq response parse failed.", error);
      lastError = makeGroqError("GROQ_RESPONSE_INVALID", "GROQ_RESPONSE_INVALID", {
        cause: error,
        status: response.status,
      });
      if (!shouldFallback(lastError)) throw lastError;
      logger.warn(`Groq fallback: invalid response for ${currentModel}.`);
      continue;
    }

    if (!response.ok) {
      const message = data?.error?.message || "GROQ_RESPONSE_ERROR";
      const type = data?.error?.type || null;
      const code = response.status === 400 ? "GROQ_INVALID_REQUEST" : "GROQ_RESPONSE_ERROR";
      lastError = makeGroqError(code, message, {
        status: response.status,
        type,
        data,
      });
      logger.error("Groq response error.", data);
      if (!shouldFallback(lastError)) throw lastError;
      logger.warn(`Groq fallback: ${currentModel} rate-limited/failed.`);
      continue;
    }

    const content = data?.choices?.[0]?.message?.content;
    if (!content) {
      lastError = makeGroqError("GROQ_EMPTY_RESPONSE", "GROQ_EMPTY_RESPONSE", {
        status: response.status,
      });
      if (!shouldFallback(lastError)) throw lastError;
      logger.warn(`Groq fallback: empty response for ${currentModel}.`);
      continue;
    }

    return String(content).trim();
  }

  throw lastError || makeGroqError("GROQ_RESPONSE_ERROR", "GROQ_RESPONSE_ERROR");
}

module.exports = {
  chatCompletion,
  DEFAULT_MODEL,
  DEFAULT_FALLBACK_MODELS,
};
