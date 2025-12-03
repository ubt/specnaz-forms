// lib/notionRateLimit.js - Оптимизированный адаптивный rate limiter для Notion API
import { logger } from "./logger";
import { CONFIG } from "./config";

/**
 * Адаптивный rate limiter для Notion API
 * Автоматически подстраивает задержку под текущую нагрузку
 */
class AdaptiveNotionRateLimiter {
  constructor(options = {}) {
    const cfg = CONFIG.RATE_LIMIT;
    
    this.minDelay = options.minDelay || cfg.MIN_DELAY;
    this.maxDelay = options.maxDelay || cfg.MAX_DELAY;
    this.currentDelay = options.initialDelay || cfg.INITIAL_DELAY;
    this.burstThreshold = options.burstThreshold || cfg.BURST_THRESHOLD;
    this.backoffMultiplier = options.backoffMultiplier || cfg.BACKOFF_MULTIPLIER;
    this.recoveryMultiplier = options.recoveryMultiplier || cfg.RECOVERY_MULTIPLIER;
    this.windowMs = options.windowMs || cfg.WINDOW_MS;
    
    this.lastRequest = 0;
    this.requestQueue = [];
    this.consecutiveSuccesses = 0;
    this.consecutiveErrors = 0;
    this.totalRequests = 0;
    this.totalErrors = 0;
  }

  /**
   * Очистка старых записей из очереди
   */
  cleanup() {
    const now = Date.now();
    const cutoff = now - this.windowMs;
    this.requestQueue = this.requestQueue.filter(t => t > cutoff);
  }

  /**
   * Расчет адаптивной задержки
   */
  calculateDelay() {
    this.cleanup();
    const queueLength = this.requestQueue.length;
    
    // Если много успешных запросов подряд - уменьшаем задержку (burst mode)
    if (this.consecutiveSuccesses >= this.burstThreshold) {
      this.currentDelay = Math.max(
        this.minDelay, 
        this.currentDelay * this.recoveryMultiplier
      );
    }
    
    // Если очередь растет - увеличиваем задержку
    if (queueLength > 10) {
      this.currentDelay = Math.min(
        this.currentDelay * this.backoffMultiplier,
        this.maxDelay
      );
    }
    
    // Если давно не было запросов - сбрасываем к минимуму
    const timeSinceLastRequest = Date.now() - this.lastRequest;
    if (timeSinceLastRequest > 5000 && queueLength === 0) {
      this.currentDelay = Math.max(this.minDelay, this.currentDelay * 0.5);
    }
    
    return this.currentDelay;
  }

  /**
   * Ожидание перед запросом
   */
  async wait() {
    const delay = this.calculateDelay();
    const now = Date.now();
    const timeSinceLastRequest = now - this.lastRequest;

    if (timeSinceLastRequest < delay) {
      const waitTime = delay - timeSinceLastRequest;
      logger.debug(`[RATE LIMIT] Waiting ${waitTime}ms (delay: ${delay}ms, queue: ${this.requestQueue.length})`);
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }

    this.lastRequest = Date.now();
    this.requestQueue.push(this.lastRequest);
    this.totalRequests++;
  }

  /**
   * Записать успешный запрос
   */
  recordSuccess() {
    this.consecutiveSuccesses++;
    this.consecutiveErrors = 0;
    
    // Постепенно уменьшаем задержку при успехах
    if (this.consecutiveSuccesses % 5 === 0) {
      this.currentDelay = Math.max(
        this.minDelay,
        this.currentDelay * this.recoveryMultiplier
      );
    }
  }

  /**
   * Записать ошибку
   */
  recordError(error) {
    this.consecutiveErrors++;
    this.consecutiveSuccesses = 0;
    this.totalErrors++;

    // 429 - критическая ошибка rate limit
    if (error?.status === 429 || error?.code === 'rate_limited') {
      logger.warn('[RATE LIMIT] 429 error - switching to maximum delay');
      this.currentDelay = this.maxDelay;
      
      // Извлекаем retry-after если есть
      const retryAfter = error.headers?.['retry-after'];
      if (retryAfter) {
        const retryMs = parseInt(retryAfter, 10) * 1000;
        if (!isNaN(retryMs) && retryMs > 0) {
          this.currentDelay = Math.min(retryMs, this.maxDelay);
        }
      }
    } else {
      // Другие ошибки - умеренное увеличение
      this.currentDelay = Math.min(
        this.currentDelay * this.backoffMultiplier,
        this.maxDelay
      );
    }
  }

  /**
   * Сброс состояния
   */
  reset() {
    this.requestQueue = [];
    this.currentDelay = CONFIG.RATE_LIMIT.INITIAL_DELAY;
    this.lastRequest = 0;
    this.consecutiveSuccesses = 0;
    this.consecutiveErrors = 0;
    logger.debug('[RATE LIMIT] Reset to initial state');
  }

  /**
   * Получение статистики
   */
  getStats() {
    this.cleanup();
    return {
      currentDelay: this.currentDelay,
      queueLength: this.requestQueue.length,
      consecutiveSuccesses: this.consecutiveSuccesses,
      consecutiveErrors: this.consecutiveErrors,
      totalRequests: this.totalRequests,
      totalErrors: this.totalErrors,
      errorRate: this.totalRequests > 0 
        ? ((this.totalErrors / this.totalRequests) * 100).toFixed(2) + '%'
        : '0%',
      minDelay: this.minDelay,
      maxDelay: this.maxDelay,
      lastRequest: this.lastRequest
    };
  }
}

// Глобальный экземпляр rate limiter
const notionRateLimiter = new AdaptiveNotionRateLimiter();

/**
 * Ожидание rate limit перед вызовом Notion API
 */
export async function notionRateLimit() {
  await notionRateLimiter.wait();
}

/**
 * Записать ошибку от Notion API
 */
export function recordNotionError(error) {
  notionRateLimiter.recordError(error);
}

/**
 * Записать успешный запрос
 */
export function recordNotionSuccess() {
  notionRateLimiter.recordSuccess();
}

/**
 * Сброс rate limiter
 */
export function resetNotionRateLimit() {
  notionRateLimiter.reset();
}

/**
 * Получение статистики
 */
export function getNotionRateLimitStats() {
  return notionRateLimiter.getStats();
}

/**
 * Обертка для вызовов Notion API с автоматическим retry и rate limiting
 * @param {Function} apiCall - Функция вызова Notion API
 * @param {Object} options - Опции повтора
 * @returns {Promise} - Результат вызова API
 */
export async function notionApiCall(apiCall, options = {}) {
  const maxRetries = options.maxRetries || CONFIG.BATCH.MAX_RETRIES;
  const baseRetryDelay = options.retryDelay || 500;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      await notionRateLimit();
      const result = await apiCall();
      recordNotionSuccess();
      return result;
    } catch (error) {
      const isLastAttempt = attempt === maxRetries - 1;
      
      logger.debug(
        `[NOTION API] Attempt ${attempt + 1}/${maxRetries} failed:`, 
        error.message
      );

      recordNotionError(error);

      // 429 Rate Limited - exponential backoff
      if (error?.status === 429) {
        if (isLastAttempt) throw error;
        
        const retryAfter = error.headers?.['retry-after'];
        const delay = retryAfter 
          ? parseInt(retryAfter, 10) * 1000 
          : Math.min(baseRetryDelay * Math.pow(2, attempt), 10000);
        
        logger.warn(`[NOTION API] Rate limited (429), waiting ${delay}ms`);
        await new Promise(r => setTimeout(r, delay));
        continue;
      }

      // 5xx Server errors - retry with delay
      if (error?.status >= 500 && error?.status < 600) {
        if (isLastAttempt) throw error;
        
        const delay = baseRetryDelay * (attempt + 1);
        logger.warn(`[NOTION API] Server error (${error.status}), retrying in ${delay}ms`);
        await new Promise(r => setTimeout(r, delay));
        continue;
      }

      // Сетевые ошибки - тоже retry
      if (error?.code === 'ECONNRESET' || error?.code === 'ETIMEDOUT') {
        if (isLastAttempt) throw error;
        
        const delay = baseRetryDelay * (attempt + 1);
        logger.warn(`[NOTION API] Network error (${error.code}), retrying in ${delay}ms`);
        await new Promise(r => setTimeout(r, delay));
        continue;
      }

      // Другие ошибки - пробрасываем сразу
      throw error;
    }
  }

  throw new Error(`Failed after ${maxRetries} attempts`);
}

/**
 * Параллельное выполнение нескольких вызовов с контролем concurrency
 * @param {Array<Function>} apiCalls - Массив функций вызовов API
 * @param {number} concurrency - Максимальное количество параллельных вызовов
 * @returns {Promise<Array>} - Массив результатов
 */
export async function notionApiCallParallel(apiCalls, concurrency = 3) {
  const results = [];
  const executing = new Set();

  for (const apiCall of apiCalls) {
    const promise = notionApiCall(apiCall).then(result => {
      executing.delete(promise);
      return result;
    }).catch(error => {
      executing.delete(promise);
      return { error: error.message, status: 'error' };
    });

    results.push(promise);
    executing.add(promise);

    if (executing.size >= concurrency) {
      await Promise.race(executing);
    }
  }

  return Promise.all(results);
}

export default {
  notionRateLimit,
  recordNotionError,
  recordNotionSuccess,
  resetNotionRateLimit,
  getNotionRateLimitStats,
  notionApiCall,
  notionApiCallParallel
};
