// lib/lruCache.js - Least Recently Used Cache implementation for Edge Runtime
import { logger } from "./logger";

/**
 * LRU (Least Recently Used) Cache
 * Automatically evicts least recently used items when limit is reached
 */
export class LRUCache {
  constructor(options = {}) {
    this.maxSize = options.maxSize || 100;
    this.ttl = options.ttl || 600000; // 10 minutes default
    this.cache = new Map(); // key -> { value, timestamp, expiresAt }
    this.accessOrder = []; // Track access order for LRU
  }

  /**
   * Get value from cache
   * @param {string} key - Cache key
   * @returns {any} - Cached value or null if not found/expired
   */
  get(key) {
    const entry = this.cache.get(key);

    if (!entry) {
      return null;
    }

    // Check if expired
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      this.removeFromAccessOrder(key);
      logger.debug(`[CACHE] Expired: ${key}`);
      return null;
    }

    // Update access order (move to end = most recently used)
    this.removeFromAccessOrder(key);
    this.accessOrder.push(key);

    logger.debug(`[CACHE] Hit: ${key}`);
    return entry.value;
  }

  /**
   * Set value in cache
   * @param {string} key - Cache key
   * @param {any} value - Value to cache
   * @param {number} customTTL - Optional custom TTL in milliseconds
   */
  set(key, value, customTTL = null) {
    const ttl = customTTL || this.ttl;
    const expiresAt = Date.now() + ttl;

    // If key already exists, update it
    if (this.cache.has(key)) {
      this.cache.set(key, { value, timestamp: Date.now(), expiresAt });
      // Move to end (most recently used)
      this.removeFromAccessOrder(key);
      this.accessOrder.push(key);
      logger.debug(`[CACHE] Updated: ${key}`);
      return;
    }

    // Evict least recently used if at capacity
    if (this.cache.size >= this.maxSize) {
      this.evictLRU();
    }

    // Add new entry
    this.cache.set(key, { value, timestamp: Date.now(), expiresAt });
    this.accessOrder.push(key);
    logger.debug(`[CACHE] Set: ${key} (TTL: ${ttl}ms)`);
  }

  /**
   * Check if key exists and is not expired
   */
  has(key) {
    const entry = this.cache.get(key);
    if (!entry) return false;

    if (Date.now() > entry.expiresAt) {
      this.delete(key);
      return false;
    }

    return true;
  }

  /**
   * Delete specific key
   */
  delete(key) {
    const deleted = this.cache.delete(key);
    if (deleted) {
      this.removeFromAccessOrder(key);
      logger.debug(`[CACHE] Deleted: ${key}`);
    }
    return deleted;
  }

  /**
   * Clear all cache
   */
  clear() {
    const size = this.cache.size;
    this.cache.clear();
    this.accessOrder = [];
    logger.debug(`[CACHE] Cleared ${size} entries`);
  }

  /**
   * Get current cache size
   */
  get size() {
    return this.cache.size;
  }

  /**
   * Evict least recently used entry
   */
  evictLRU() {
    if (this.accessOrder.length === 0) return;

    const lruKey = this.accessOrder.shift(); // Remove first (least recently used)
    this.cache.delete(lruKey);
    logger.debug(`[CACHE] Evicted LRU: ${lruKey}`);
  }

  /**
   * Remove key from access order array
   */
  removeFromAccessOrder(key) {
    const index = this.accessOrder.indexOf(key);
    if (index > -1) {
      this.accessOrder.splice(index, 1);
    }
  }

  /**
   * Clean up expired entries
   * Call periodically to free memory
   */
  cleanup() {
    const now = Date.now();
    let cleaned = 0;

    for (const [key, entry] of this.cache.entries()) {
      if (now > entry.expiresAt) {
        this.cache.delete(key);
        this.removeFromAccessOrder(key);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      logger.debug(`[CACHE] Cleaned up ${cleaned} expired entries`);
    }

    return cleaned;
  }

  /**
   * Get cache statistics
   */
  getStats() {
    return {
      size: this.cache.size,
      maxSize: this.maxSize,
      ttl: this.ttl,
      oldestEntry: this.accessOrder[0] || null,
      newestEntry: this.accessOrder[this.accessOrder.length - 1] || null,
      utilization: ((this.cache.size / this.maxSize) * 100).toFixed(1) + '%'
    };
  }

  /**
   * Get all keys (for debugging)
   */
  keys() {
    return Array.from(this.cache.keys());
  }
}

/**
 * Factory function to create cache with presets
 */
export function createCache(preset = 'default') {
  const presets = {
    default: { maxSize: 100, ttl: 600000 }, // 10 minutes
    short: { maxSize: 50, ttl: 60000 },     // 1 minute
    long: { maxSize: 200, ttl: 1800000 },   // 30 minutes
    skills: { maxSize: 500, ttl: 600000 },  // 10 minutes, more entries
    database: { maxSize: 50, ttl: 1800000 } // 30 minutes, fewer entries
  };

  const config = presets[preset] || presets.default;
  return new LRUCache(config);
}

export default LRUCache;
