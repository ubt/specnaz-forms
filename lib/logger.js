// lib/logger.js - Centralized logging utility with production optimization

const isDevelopment = process.env.NODE_ENV === 'development';
const isProduction = process.env.NODE_ENV === 'production';

/**
 * Logger utility with environment-aware logging levels
 * In production, only info, warn, and error messages are logged
 * In development, all messages including debug are logged
 */
export const logger = {
  /**
   * Debug level - only logged in development
   * Use for detailed debugging information
   */
  debug: (message, ...args) => {
    if (isDevelopment) {
      console.log(`[DEBUG] ${message}`, ...args);
    }
  },

  /**
   * Info level - logged in all environments
   * Use for important application events
   */
  info: (message, ...args) => {
    console.log(`[INFO] ${message}`, ...args);
  },

  /**
   * Warning level - logged in all environments
   * Use for recoverable errors or important warnings
   */
  warn: (message, ...args) => {
    console.warn(`[WARN] ${message}`, ...args);
  },

  /**
   * Error level - logged in all environments
   * Use for errors and exceptions
   */
  error: (message, ...args) => {
    console.error(`[ERROR] ${message}`, ...args);
  },

  /**
   * Performance tracking - only logged in development
   */
  perf: (operation, duration) => {
    if (isDevelopment) {
      console.log(`[PERF] ${operation}: ${duration}ms`);
    }
  },

  /**
   * API logging with prefix - debug level
   */
  api: (endpoint, message, data) => {
    if (isDevelopment) {
      console.log(`[API ${endpoint}] ${message}`, data || '');
    }
  }
};

/**
 * Performance tracker for measuring operation duration
 * Only tracks in development, silent in production
 */
export class PerformanceLogger {
  constructor() {
    this.operations = new Map();
  }

  start(operationName) {
    if (isDevelopment) {
      this.operations.set(operationName, Date.now());
      logger.debug(`Started: ${operationName}`);
    }
  }

  end(operationName) {
    if (isDevelopment) {
      const startTime = this.operations.get(operationName);
      if (startTime) {
        const duration = Date.now() - startTime;
        this.operations.delete(operationName);
        logger.perf(operationName, duration);
        return duration;
      }
    }
    return 0;
  }
}

// Global instance for convenience
export const perfLogger = new PerformanceLogger();

// Helper to sanitize sensitive data from logs
export function sanitizeForLog(data) {
  if (!data || typeof data !== 'object') return data;

  const sanitized = { ...data };
  const sensitiveKeys = ['password', 'token', 'secret', 'key', 'adminKey'];

  for (const key of Object.keys(sanitized)) {
    if (sensitiveKeys.some(sk => key.toLowerCase().includes(sk.toLowerCase()))) {
      sanitized[key] = '[REDACTED]';
    }
  }

  return sanitized;
}

export default logger;
