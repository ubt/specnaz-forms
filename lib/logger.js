// lib/logger.js - Оптимизированный логгер с поддержкой метрик

const isDevelopment = process.env.NODE_ENV === 'development';

/**
 * Logger с адаптивными уровнями логирования
 */
export const logger = {
  /**
   * Debug - только в development
   */
  debug: (message, ...args) => {
    if (isDevelopment) {
      console.log(`[DEBUG] ${message}`, ...args);
    }
  },

  /**
   * Info - во всех окружениях
   */
  info: (message, ...args) => {
    console.log(`[INFO] ${message}`, ...args);
  },

  /**
   * Warning - во всех окружениях
   */
  warn: (message, ...args) => {
    console.warn(`[WARN] ${message}`, ...args);
  },

  /**
   * Error - во всех окружениях
   */
  error: (message, ...args) => {
    console.error(`[ERROR] ${message}`, ...args);
  },

  /**
   * Performance - только в development
   */
  perf: (operation, duration) => {
    if (isDevelopment) {
      console.log(`[PERF] ${operation}: ${duration}ms`);
    }
  },

  /**
   * API logging
   */
  api: (endpoint, message, data) => {
    if (isDevelopment) {
      console.log(`[API ${endpoint}] ${message}`, data || '');
    }
  }
};

/**
 * Простой трекер метрик для Edge Runtime
 */
class SimpleMetrics {
  constructor() {
    this.counters = new Map();
    this.timings = new Map();
    this.gauges = new Map();
  }

  /**
   * Увеличить счетчик
   */
  increment(name, value = 1) {
    this.counters.set(name, (this.counters.get(name) || 0) + value);
  }

  /**
   * Записать время выполнения
   */
  timing(name, duration) {
    const arr = this.timings.get(name) || [];
    arr.push(duration);
    // Храним только последние 100 значений
    if (arr.length > 100) arr.shift();
    this.timings.set(name, arr);
  }

  /**
   * Установить gauge (текущее значение)
   */
  gauge(name, value) {
    this.gauges.set(name, { value, timestamp: Date.now() });
  }

  /**
   * Получить статистику по timings
   */
  getTimingStats(name) {
    const arr = this.timings.get(name);
    if (!arr || arr.length === 0) return null;

    const sorted = [...arr].sort((a, b) => a - b);
    const sum = arr.reduce((a, b) => a + b, 0);

    return {
      count: arr.length,
      avg: Math.round(sum / arr.length),
      min: sorted[0],
      max: sorted[sorted.length - 1],
      p50: sorted[Math.floor(sorted.length * 0.5)],
      p95: sorted[Math.floor(sorted.length * 0.95)],
      p99: sorted[Math.floor(sorted.length * 0.99)]
    };
  }

  /**
   * Получить все метрики
   */
  getStats() {
    const stats = {
      counters: Object.fromEntries(this.counters),
      gauges: Object.fromEntries(this.gauges),
      timings: {}
    };

    for (const name of this.timings.keys()) {
      stats.timings[name] = this.getTimingStats(name);
    }

    return stats;
  }

  /**
   * Сброс всех метрик
   */
  reset() {
    this.counters.clear();
    this.timings.clear();
    this.gauges.clear();
  }
}

// Глобальный экземпляр метрик
export const metrics = new SimpleMetrics();

/**
 * Performance Logger для измерения времени операций
 */
export class PerformanceLogger {
  constructor() {
    this.operations = new Map();
  }

  start(operationName) {
    this.operations.set(operationName, Date.now());
    logger.debug(`Started: ${operationName}`);
  }

  end(operationName) {
    const startTime = this.operations.get(operationName);
    if (startTime) {
      const duration = Date.now() - startTime;
      this.operations.delete(operationName);
      logger.perf(operationName, duration);
      metrics.timing(operationName, duration);
      return duration;
    }
    return 0;
  }

  /**
   * Измерение времени выполнения async функции
   */
  async measure(operationName, fn) {
    this.start(operationName);
    try {
      return await fn();
    } finally {
      this.end(operationName);
    }
  }
}

// Глобальный экземпляр
export const perfLogger = new PerformanceLogger();

/**
 * Санитизация чувствительных данных для логов
 */
export function sanitizeForLog(data) {
  if (!data || typeof data !== 'object') return data;

  const sanitized = { ...data };
  const sensitiveKeys = ['password', 'token', 'secret', 'key', 'adminKey', 'authorization'];

  for (const key of Object.keys(sanitized)) {
    if (sensitiveKeys.some(sk => key.toLowerCase().includes(sk.toLowerCase()))) {
      sanitized[key] = '[REDACTED]';
    } else if (typeof sanitized[key] === 'object' && sanitized[key] !== null) {
      sanitized[key] = sanitizeForLog(sanitized[key]);
    }
  }

  return sanitized;
}

/**
 * Декоратор для логирования вызовов функций
 */
export function withLogging(fn, name) {
  return async (...args) => {
    const start = Date.now();
    logger.debug(`[${name}] Starting...`);
    
    try {
      const result = await fn(...args);
      const duration = Date.now() - start;
      logger.debug(`[${name}] Completed in ${duration}ms`);
      metrics.timing(name, duration);
      metrics.increment(`${name}.success`);
      return result;
    } catch (error) {
      const duration = Date.now() - start;
      logger.error(`[${name}] Failed after ${duration}ms:`, error.message);
      metrics.increment(`${name}.error`);
      throw error;
    }
  };
}

export default logger;
