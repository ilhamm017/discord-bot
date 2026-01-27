const logger = require("../../utils/logger");

// Track rate-limited models: model -> { blockedUntil: timestamp }
const rateLimitTracker = new Map();

/**
 * Get configuration for model tiers
 */
function getConfig() {
    let config = {};
    try {
        config = require("../../config.json");
    } catch (error) {
        config = {};
    }
    return config;
}

/**
 * Select the best available model for a given tier
 * @param {string} tier - Desired tier: 'lightweight', 'balanced', 'advanced', 'premium'
 * @param {Object} config - Configuration object
 * @param {string} provider - 'google' or 'groq'
 * @returns {string} - Selected model name
 */
function selectModel(tier, config = null, provider = 'google') {
    if (!config) {
        config = getConfig();
    }

    const tierKey = `${provider}_model_tiers`;
    const tiers = config[tierKey] || (provider === 'google' ? {
        lightweight: ["gemma-3-4b-it", "gemma-3-1b-it"],
        balanced: ["gemma-3-12b-it", "gemma-3-4b-it"],
        advanced: ["gemma-3-27b-it", "gemma-3-12b-it"],
        premium: ["gemma-3-27b-it"]
    } : {
        lightweight: ["llama-3.1-8b-instant"],
        balanced: ["llama-3.1-8b-instant"],
        advanced: ["qwen/qwen3-32b"],
        premium: ["llama-3.3-70b-versatile"]
    });

    const models = tiers[tier] || tiers.balanced;

    // Filter out rate-limited models
    const now = Date.now();
    const available = models.filter(model => {
        const blocked = rateLimitTracker.get(model);
        if (!blocked) return true;

        if (now > blocked.blockedUntil) {
            // Cooldown expired, remove from tracker
            rateLimitTracker.delete(model);
            return true;
        }
        return false;
    });

    if (available.length > 0) {
        logger.debug(`Selected model: ${available[0]} (tier: ${tier})`);
        return available[0];
    }

    // All models in this tier are rate-limited, try fallback to lower tier
    logger.warn(`All models in tier '${tier}' are rate-limited. Attempting fallback.`);

    const fallbackTiers = ['premium', 'advanced', 'balanced', 'lightweight'];
    const currentIndex = fallbackTiers.indexOf(tier);

    if (currentIndex < fallbackTiers.length - 1) {
        // Try next lower tier
        return selectModel(fallbackTiers[currentIndex + 1], config, provider);
    }

    // Last resort: return first model from original tier anyway
    logger.warn(`No available models found. Using ${models[0]} despite rate limit.`);
    return models[0];
}

/**
 * Mark a model as rate-limited
 * @param {string} model - Model name
 * @param {number} cooldownMs - Cooldown duration in milliseconds (default: 5 minutes)
 */
function markRateLimited(model, cooldownMs = null) {
    const config = getConfig();
    const cooldown = cooldownMs || config.google_rate_limit_cooldown_ms || 300000; // 5 minutes default

    rateLimitTracker.set(model, {
        blockedUntil: Date.now() + cooldown
    });

    logger.warn(`Model ${model} marked as rate-limited. Cooldown: ${cooldown}ms`);
}

/**
 * Clear rate limit for a specific model (for testing/manual override)
 * @param {string} model - Model name
 */
function clearRateLimit(model) {
    rateLimitTracker.delete(model);
    logger.info(`Rate limit cleared for model: ${model}`);
}

/**
 * Get current rate limit status (for debugging)
 */
function getRateLimitStatus() {
    const status = {};
    const now = Date.now();

    for (const [model, data] of rateLimitTracker.entries()) {
        const remainingMs = Math.max(0, data.blockedUntil - now);
        status[model] = {
            blocked: remainingMs > 0,
            remainingMs: remainingMs,
            remainingMinutes: Math.ceil(remainingMs / 60000)
        };
    }

    return status;
}

module.exports = {
    selectModel,
    markRateLimited,
    clearRateLimit,
    getRateLimitStatus
};
