// lib/adminRateLimit.js - Rate limiting for admin endpoints
import { NextResponse } from "next/server";
import { logger } from "./logger";

/**
 * Simple in-memory rate limiter for Edge Runtime
 * Tracks requests by IP address
 */
class AdminRateLimiter {
  constructor(options = {}) {
    this.requests = new Map(); // IP -> Array of timestamps
    this.maxRequests = options.maxRequests || 10; // Max requests per window
    this.windowMs = options.windowMs || 60000; // 1 minute window
    this.blockDurationMs = options.blockDurationMs || 300000; // 5 minutes block
    this.blockedIPs = new Map(); // IP -> block expiry timestamp
  }

  /**
   * Clean old request records
   */
  cleanup() {
    const now = Date.now();
    const cutoff = now - this.windowMs;

    // Clean request history
    for (const [ip, timestamps] of this.requests.entries()) {
      const filtered = timestamps.filter(t => t > cutoff);
      if (filtered.length === 0) {
        this.requests.delete(ip);
      } else {
        this.requests.set(ip, filtered);
      }
    }

    // Clean expired blocks
    for (const [ip, expiry] of this.blockedIPs.entries()) {
      if (now > expiry) {
        this.blockedIPs.delete(ip);
        logger.info(`[RATE LIMIT] Unblocked IP: ${ip}`);
      }
    }
  }

  /**
   * Get client IP from request
   */
  getClientIP(req) {
    // Try various headers for IP address
    const forwardedFor = req.headers.get('x-forwarded-for');
    if (forwardedFor) {
      return forwardedFor.split(',')[0].trim();
    }

    const realIP = req.headers.get('x-real-ip');
    if (realIP) {
      return realIP;
    }

    const cfConnectingIP = req.headers.get('cf-connecting-ip');
    if (cfConnectingIP) {
      return cfConnectingIP;
    }

    return 'unknown';
  }

  /**
   * Check if request should be rate limited
   * Returns { allowed: boolean, remaining: number, resetTime: number }
   */
  checkLimit(req) {
    this.cleanup();

    const ip = this.getClientIP(req);
    const now = Date.now();

    // Check if IP is blocked
    if (this.blockedIPs.has(ip)) {
      const blockExpiry = this.blockedIPs.get(ip);
      if (now < blockExpiry) {
        const remainingBlockTime = Math.ceil((blockExpiry - now) / 1000);
        logger.warn(`[RATE LIMIT] Blocked IP attempted request: ${ip}, blocked for ${remainingBlockTime}s more`);

        return {
          allowed: false,
          remaining: 0,
          resetTime: blockExpiry,
          blocked: true,
          blockDuration: remainingBlockTime
        };
      } else {
        // Block expired
        this.blockedIPs.delete(ip);
      }
    }

    // Get request history for this IP
    const timestamps = this.requests.get(ip) || [];
    const recentRequests = timestamps.filter(t => t > now - this.windowMs);

    // Check if limit exceeded
    if (recentRequests.length >= this.maxRequests) {
      // Block the IP
      const blockExpiry = now + this.blockDurationMs;
      this.blockedIPs.set(ip, blockExpiry);

      logger.warn(`[RATE LIMIT] IP blocked due to rate limit: ${ip}, ${recentRequests.length} requests in window`);

      return {
        allowed: false,
        remaining: 0,
        resetTime: blockExpiry,
        blocked: true,
        blockDuration: Math.ceil(this.blockDurationMs / 1000)
      };
    }

    // Add current request
    recentRequests.push(now);
    this.requests.set(ip, recentRequests);

    const resetTime = now + this.windowMs;
    const remaining = this.maxRequests - recentRequests.length;

    logger.debug(`[RATE LIMIT] Request allowed for ${ip}: ${recentRequests.length}/${this.maxRequests}`);

    return {
      allowed: true,
      remaining,
      resetTime,
      blocked: false
    };
  }

  /**
   * Get stats for monitoring
   */
  getStats() {
    this.cleanup();

    return {
      activeIPs: this.requests.size,
      blockedIPs: this.blockedIPs.size,
      totalRequests: Array.from(this.requests.values()).reduce((sum, arr) => sum + arr.length, 0),
      config: {
        maxRequests: this.maxRequests,
        windowMs: this.windowMs,
        blockDurationMs: this.blockDurationMs
      }
    };
  }
}

// Global rate limiter instance
const adminLimiter = new AdminRateLimiter({
  maxRequests: 10,      // 10 requests
  windowMs: 60000,      // per minute
  blockDurationMs: 300000 // 5 minute block
});

/**
 * Rate limit middleware for admin endpoints
 * Usage in API route:
 *
 * export async function POST(req) {
 *   const rateLimitResult = checkAdminRateLimit(req);
 *   if (!rateLimitResult.allowed) {
 *     return rateLimitResult.response;
 *   }
 *   // ... rest of handler
 * }
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
          retryAfter: Math.ceil((result.resetTime - Date.now()) / 1000),
          details: {
            maxRequests: adminLimiter.maxRequests,
            windowSeconds: Math.ceil(adminLimiter.windowMs / 1000),
            blocked: result.blocked
          }
        },
        {
          status: 429,
          headers: {
            'Retry-After': Math.ceil((result.resetTime - Date.now()) / 1000).toString(),
            'X-RateLimit-Limit': adminLimiter.maxRequests.toString(),
            'X-RateLimit-Remaining': result.remaining.toString(),
            'X-RateLimit-Reset': Math.ceil(result.resetTime / 1000).toString()
          }
        }
      )
    };
  }

  return {
    allowed: true,
    remaining: result.remaining,
    resetTime: result.resetTime
  };
}

/**
 * Get rate limiter statistics
 */
export function getAdminRateLimitStats() {
  return adminLimiter.getStats();
}

export default {
  checkAdminRateLimit,
  getAdminRateLimitStats
};
