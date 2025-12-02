// lib/notionRateLimit.js - Unified rate limiting for Notion API calls
import { logger } from "./logger";

/**
 * Adaptive rate limiter for Notion API
 * Automatically adjusts delay based on queue length and error responses
 */
class NotionRateLimiter {
  constructor(options = {}) {
    this.lastRequest = 0;
    this.requestQueue = [];
    this.currentDelay = options.minDelay || 200;
    this.minDelay = options.minDelay || 200;
    this.maxDelay = options.maxDelay || 5000;
    this.windowMs = options.windowMs || 60000; // 1 minute
    this.isProcessing = false;
  }

  /**
   * Clean old request records from queue
   */
  cleanup() {
    const now = Date.now();
    const cutoff = now - this.windowMs;
    this.requestQueue = this.requestQueue.filter(t => t > cutoff);
  }

  /**
   * Adaptive delay based on queue length
   */
  async wait() {
    this.cleanup();

    const now = Date.now();
    const timeSinceLastRequest = now - this.lastRequest;

    // Адаптивная задержка в зависимости от нагрузки
    const queueLength = this.requestQueue.length;
    let delay = this.currentDelay;

    if (queueLength > 5) {
      // Много недавних запросов - увеличиваем задержку
      delay = Math.min(delay * 1.2, this.maxDelay);
    } else if (queueLength === 0 && timeSinceLastRequest > 5000) {
      // Нет активности - уменьшаем задержку
      delay = Math.max(delay * 0.9, this.minDelay);
    }

    this.currentDelay = delay;

    // Ожидание если прошло меньше времени чем delay
    if (timeSinceLastRequest < delay) {
      const waitTime = delay - timeSinceLastRequest;
      logger.debug(`[RATE LIMIT] Waiting ${waitTime}ms (queue: ${queueLength})`);
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }

    this.lastRequest = Date.now();
    this.requestQueue.push(this.lastRequest);
  }

  /**
   * Record an error (increases delay for 429 errors)
   */
  recordError(error) {
    if (error?.status === 429 || error?.code === 'rate_limited') {
      logger.warn('[RATE LIMIT] 429 error received, increasing delay');
      this.currentDelay = this.maxDelay;
    }
  }

  /**
   * Reset to initial state
   */
  reset() {
    this.requestQueue = [];
    this.currentDelay = this.minDelay;
    this.lastRequest = 0;
    logger.debug('[RATE LIMIT] Reset to initial state');
  }

  /**
   * Get current statistics
   */
  getStats() {
    this.cleanup();
    return {
      currentDelay: this.currentDelay,
      queueLength: this.requestQueue.length,
      minDelay: this.minDelay,
      maxDelay: this.maxDelay,
      lastRequest: this.lastRequest
    };
  }
}

// Global instance for Notion API rate limiting
const notionRateLimiter = new NotionRateLimiter({
  minDelay: 200,
  maxDelay: 5000,
  windowMs: 60000
});

/**
 * Wait for rate limit before making Notion API call
 * Usage: await notionRateLimit() before each Notion API call
 */
export async function notionRateLimit() {
  await notionRateLimiter.wait();
}

/**
 * Record an error from Notion API
 */
export function recordNotionError(error) {
  notionRateLimiter.recordError(error);
}

/**
 * Reset rate limiter
 */
export function resetNotionRateLimit() {
  notionRateLimiter.reset();
}

/**
 * Get rate limiter statistics
 */
export function getNotionRateLimitStats() {
  return notionRateLimiter.getStats();
}

/**
 * Wrapper for Notion API calls with automatic retry and rate limiting
 * @param {Function} apiCall - The Notion API call to execute
 * @param {Object} options - Retry options
 * @returns {Promise} - Result of the API call
 */
export async function notionApiCall(apiCall, options = {}) {
  const maxRetries = options.maxRetries || 3;
  const retryDelay = options.retryDelay || 500;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      await notionRateLimit();
      const result = await apiCall();
      return result;
    } catch (error) {
      logger.debug(`[NOTION API] Attempt ${attempt + 1}/${maxRetries} failed:`, error.message);

      recordNotionError(error);

      // 429 Rate Limited - exponential backoff
      if (error?.status === 429) {
        const delay = Math.min(retryDelay * Math.pow(2, attempt), 5000);
        logger.warn(`[NOTION API] Rate limited (429), waiting ${delay}ms before retry`);
        await new Promise(r => setTimeout(r, delay));
        continue;
      }

      // 5xx Server errors - retry with delay
      if (error?.status >= 500 && error?.status < 600 && attempt < maxRetries - 1) {
        const delay = retryDelay * (attempt + 1);
        logger.warn(`[NOTION API] Server error (${error.status}), retrying in ${delay}ms`);
        await new Promise(r => setTimeout(r, delay));
        continue;
      }

      // Other errors or last attempt - throw
      throw error;
    }
  }

  throw new Error(`Failed after ${maxRetries} attempts`);
}

export default {
  notionRateLimit,
  recordNotionError,
  resetNotionRateLimit,
  getNotionRateLimitStats,
  notionApiCall
};
