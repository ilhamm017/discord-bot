/**
 * Token Rate Limiter with Priority Queue
 * Manages TPM (Tokens Per Minute) limits for Google API
 */

const logger = require("../../utils/logger");
const { estimateRequestTokens, calculatePriority } = require("./token_calculator");

class TokenRateLimiter {
    constructor(config = {}) {
        this.maxTPM = config.maxTPM || 15000;
        this.safetyMargin = config.safetyMargin || 0.8;
        this.windowMs = 60000;

        this.tokenUsage = []; // History of actual usage
        this.activeEstimates = new Map(); // Map of requestId -> tokens reserved
        this.queue = [];
        this.isProcessing = false;

        this.stats = {
            totalRequests: 0,
            queuedRequests: 0,
            totalTokensUsed: 0
        };

        logger.info(`TokenRateLimiter initialized: maxTPM=${this.maxTPM}`);
    }

    getCurrentTPM() {
        const now = Date.now();
        const oneMinuteAgo = now - this.windowMs;

        // Actual usage
        this.tokenUsage = this.tokenUsage.filter(entry => entry.timestamp > oneMinuteAgo);
        const actualTokens = this.tokenUsage.reduce((sum, entry) => sum + entry.tokens, 0);

        // Active reservations
        let reservedTokens = 0;
        for (const tokens of this.activeEstimates.values()) {
            reservedTokens += tokens;
        }

        return actualTokens + reservedTokens;
    }

    canMakeRequest(estimatedTokens) {
        const currentUsage = this.getCurrentTPM();
        const safeLimit = this.maxTPM * this.safetyMargin;
        return (currentUsage + estimatedTokens) <= safeLimit;
    }

    /**
     * Start a request - reserves tokens
     */
    startRequest(requestId, estimatedTokens) {
        this.activeEstimates.set(requestId, estimatedTokens);
    }

    /**
     * Finish a request - replaces reservation with actual usage
     */
    recordUsage(requestId, actualTokens = null) {
        const estimated = this.activeEstimates.get(requestId);
        this.activeEstimates.delete(requestId);

        // If actualTokens is null, we just use the estimate as the record
        const tokensToRecord = actualTokens !== null ? actualTokens : (estimated || 0);

        if (tokensToRecord > 0) {
            this.tokenUsage.push({
                timestamp: Date.now(),
                tokens: tokensToRecord
            });
            this.stats.totalTokensUsed += tokensToRecord;
        }
    }

    async enqueue(priority, requestFn, estimatedTokens) {
        return new Promise((resolve, reject) => {
            const requestId = `req_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
            const item = {
                requestId,
                priority,
                requestFn,
                resolve,
                reject,
                estimatedTokens,
                enqueuedAt: Date.now()
            };

            // Priority sort
            let inserted = false;
            for (let i = 0; i < this.queue.length; i++) {
                if (priority < this.queue[i].priority) {
                    this.queue.splice(i, 0, item);
                    inserted = true;
                    break;
                }
            }
            if (!inserted) this.queue.push(item);

            this.stats.queuedRequests++;
            if (!this.isProcessing) this.processQueue();
        });
    }

    async processQueue() {
        if (this.isProcessing) return;
        this.isProcessing = true;

        while (this.queue.length > 0) {
            const item = this.queue[0];

            if (this.canMakeRequest(item.estimatedTokens.total)) {
                this.queue.shift();

                try {
                    // Reserve tokens
                    this.startRequest(item.requestId, item.estimatedTokens.total);

                    // Execute (chatCompletion will call recordUsage with actual or it will fallback)
                    const result = await item.requestFn(item.requestId);

                    // Final record if not already recorded by caller
                    if (this.activeEstimates.has(item.requestId)) {
                        this.recordUsage(item.requestId);
                    }

                    item.resolve(result);
                } catch (error) {
                    this.activeEstimates.delete(item.requestId);
                    item.reject(error);
                }
            } else {
                await new Promise(r => setTimeout(r, 1000));
            }
        }
        this.isProcessing = false;
    }

    async executeRequest(requestFn, params, context = {}) {
        this.stats.totalRequests++;
        const estimatedTokens = estimateRequestTokens(params);
        const priority = calculatePriority(estimatedTokens, context);

        // Always queue if anything is in queue, to preserve ordering
        if (this.queue.length === 0 && this.canMakeRequest(estimatedTokens.total)) {
            const requestId = `req_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
            try {
                this.startRequest(requestId, estimatedTokens.total);
                const result = await requestFn(requestId);

                if (this.activeEstimates.has(requestId)) {
                    this.recordUsage(requestId);
                }

                return result;
            } catch (error) {
                this.activeEstimates.delete(requestId);
                throw error;
            }
        } else {
            return this.enqueue(priority, requestFn, estimatedTokens);
        }
    }

    getStats() {
        return {
            totalRequests: this.stats.totalRequests,
            totalTokensUsed: this.stats.totalTokensUsed,
            currentTPM: this.getCurrentTPM(),
            maxTPM: this.maxTPM,
            queueLength: this.queue.length,
            activeRequests: this.activeEstimates.size
        };
    }
}

let limiter = null;
function getRateLimiter(config = {}) {
    if (!limiter) limiter = new TokenRateLimiter(config);
    return limiter;
}

module.exports = { getRateLimiter };
