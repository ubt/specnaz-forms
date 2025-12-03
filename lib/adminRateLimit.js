// lib/adminRateLimit.js - Rate limiting для админ endpoints
import { NextResponse } from "next/server";
import { logger } from "./logger";
import { CONFIG } from "./config";

/**
 * In-memory rate limiter для Edge Runtime
 */
class AdminRateLimiter {
  constructor(options = {}) {
    this.requests = new Map();
    this.blockedIPs = new Map();
    this.maxRequests = options.maxRequests || CONFIG.ADMIN.MAX_REQUESTS;
    this.windowMs = options.windowMs || CONFIG.ADMIN.WINDOW_MS;
    this.blockDurationMs = options.blockDurationMs || CONFIG.ADMIN.BLOCK_DURATION_MS;
  }

  cleanup() {
    const now = Date.now();
    const cutoff = now - this.windowMs;

    for (const [ip, timestamps] of this.requests.entries()) {
      const filtered = timestamps.filter(t => t > cutoff);
      if (filtered.length === 0) {
        this.requests.delete(ip);
      } else {
        this.requests.set(ip, filtered);
      }
    }

    for (const [ip, expiry] of this.blockedIPs.entries()) {
      if (now > expiry) {
        this.blockedIPs.delete(ip);
      }
    }
  }

  getClientIP(req) {
    return req.headers.get('cf-connecting-ip') ||
           req.headers.get('x-forwarded-for')?.split(',')[0].trim() ||
           req.headers.get('x-real-ip') ||
           'unknown';
  }

  checkLimit(req) {
    this.cleanup();

    const ip = this.getClientIP(req);
    const now = Date.now();

    // Проверка блокировки
    if (this.blockedIPs.has(ip)) {
      const blockExpiry = this.blockedIPs.get(ip);
      if (now < blockExpiry) {
        const remainingBlockTime = Math.ceil((blockExpiry - now) / 1000);
        logger.warn(`[RATE LIMIT] Blocked IP: ${ip}, ${remainingBlockTime}s remaining`);
        return {
          allowed: false,
          remaining: 0,
          resetTime: blockExpiry,
          blocked: true,
          blockDuration: remainingBlockTime
        };
      }
      this.blockedIPs.delete(ip);
    }

    // Проверка лимита
    const timestamps = this.requests.get(ip) || [];
    const recentRequests = timestamps.filter(t => t > now - this.windowMs);

    if (recentRequests.length >= this.maxRequests) {
      const blockExpiry = now + this.blockDurationMs;
      this.blockedIPs.set(ip, blockExpiry);
      logger.warn(`[RATE LIMIT] IP blocked: ${ip}`);

      return {
        allowed: false,
        remaining: 0,
        resetTime: blockExpiry,
        blocked: true,
        blockDuration: Math.ceil(this.blockDurationMs / 1000)
      };
    }

    recentRequests.push(now);
    this.requests.set(ip, recentRequests);

    return {
      allowed: true,
      remaining: this.maxRequests - recentRequests.length,
      resetTime: now + this.windowMs,
      blocked: false
    };
  }

  getStats() {
    this.cleanup();
    return {
      activeIPs: this.requests.size,
      blockedIPs: this.blockedIPs.size,
      config: {
        maxRequests: this.maxRequests,
        windowMs: this.windowMs,
        blockDurationMs: this.blockDurationMs
      }
    };
  }
}

const adminLimiter = new AdminRateLimiter();

/**
 * Middleware для rate limiting админ endpoints
 */
export function checkAdminRateLimit(req) {
  const result = adminLimiter.checkLimit(req);

  if (!result.allowed) {
    const message = result.blocked
      ? `Слишком много запросов. IP заблокирован на ${result.blockDuration} секунд.`
      : `Превышен лимит запросов. Попробуйте через минуту.`;

    return {
      allowed: false,
      response: NextResponse.json(
        {
          error: message,
          retryAfter: Math.ceil((result.resetTime - Date.now()) / 1000)
        },
        {
          status: 429,
          headers: {
            'Retry-After': Math.ceil((result.resetTime - Date.now()) / 1000).toString()
          }
        }
      )
    };
  }

  return { allowed: true, remaining: result.remaining };
}

export function getAdminRateLimitStats() {
  return adminLimiter.getStats();
}

export default { checkAdminRateLimit, getAdminRateLimitStats };
