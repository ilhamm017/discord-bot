/**
 * Token Calculator - Estimate token usage before making API calls
 * This helps with TPM (Tokens Per Minute) rate limiting
 */

const logger = require("../utils/logger");

/**
 * Rough token estimation (1 token ≈ 4 characters for English, ≈ 2-3 for Indonesian)
 * This is a conservative estimate to avoid exceeding limits
 */
function estimateTokens(text) {
    if (!text) return 0;

    // Conservative estimate: 1 token per 3 characters
    // This accounts for both English and Indonesian text
    const charCount = text.length;
    return Math.ceil(charCount / 3);
}

/**
 * Estimate tokens for a complete request
 * @param {Object} params - Request parameters
 * @returns {Object} - { input: number, output: number, total: number }
 */
function estimateRequestTokens(params) {
    const { system, user, messages, maxTokens = 250, tools = [] } = params;

    let inputTokens = 0;

    // 1. System prompt
    if (system) {
        inputTokens += estimateTokens(system);
    }

    // 2. User message
    if (user) {
        inputTokens += estimateTokens(user);
    }

    // 3. Message history
    if (Array.isArray(messages)) {
        for (const msg of messages) {
            if (msg.content) {
                inputTokens += estimateTokens(msg.content);
            }
            // Tool calls in history
            if (msg.tool_calls) {
                inputTokens += msg.tool_calls.length * 50; // Rough estimate per tool call
            }
        }
    }

    // 4. Tools definitions (if using manual function calling)
    // Each tool adds ~100-200 tokens to the prompt
    if (Array.isArray(tools) && tools.length > 0) {
        inputTokens += tools.length * 150; // Conservative estimate
    }

    // 5. Output tokens (from maxTokens parameter)
    const outputTokens = maxTokens;

    const total = inputTokens + outputTokens;

    return {
        input: inputTokens,
        output: outputTokens,
        total: total
    };
}

/**
 * Calculate priority based on estimated token usage and request type
 * Lower number = higher priority
 * @returns {number} Priority level (1-5)
 */
function calculatePriority(estimatedTokens, requestContext = {}) {
    const { isToolCall = false, hasTools = false, isRetry = false } = requestContext;

    // Priority 1: Low token, no tools (simple queries)
    if (estimatedTokens.total < 500 && !hasTools) {
        return 1;
    }

    // Priority 2: Medium token, no tools
    if (estimatedTokens.total < 1500 && !hasTools) {
        return 2;
    }

    // Priority 3: Low token with tools OR medium token
    if (estimatedTokens.total < 1500 || (estimatedTokens.total < 2500 && !isToolCall)) {
        return 3;
    }

    // Priority 4: High token usage
    if (estimatedTokens.total < 4000) {
        return 4;
    }

    // Priority 5: Very high token usage or retry
    return isRetry ? 5 : 4;
}

/**
 * Categorize request by token usage
 */
function categorizeRequest(estimatedTokens) {
    const total = estimatedTokens.total;

    if (total < 500) return 'lightweight';
    if (total < 1500) return 'medium';
    if (total < 3000) return 'heavy';
    return 'very-heavy';
}

module.exports = {
    estimateTokens,
    estimateRequestTokens,
    calculatePriority,
    categorizeRequest
};
