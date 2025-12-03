// lib/lruCache.js - Оптимизированный LRU Cache для Edge Runtime
import { logger } from "./logger";

/**
 * LRU (Least Recently Used) Cache
 * Автоматически удаляет наименее используемые элементы при достижении лимита
 */
export class LRUCache {
  constructor(options = {}) {
    this.maxSize = options.maxSize || 100;
    this.ttl = options.ttl || 600000; // 10 минут по умолчанию
    this.cache = new Map();
    this.hits = 0;
    this.misses = 0;
  }

  /**
   * Получение значения из кэша
   */
  get(key) {
    const entry = this.cache.get(key);

    if (!entry) {
      this.misses++;
      return null;
    }

    // Проверка истечения срока
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      this.misses++;
      return null;
    }

    // Обновление порядка доступа (перемещение в конец Map)
    this.cache.delete(key);
    this.cache.set(key, entry);
    
    this.hits++;
    return entry.value;
  }

  /**
   * Установка значения в кэш
   */
  set(key, value, customTTL = null) {
    const ttl = customTTL || this.ttl;
    const expiresAt = Date.now() + ttl;

    // Если ключ уже существует - обновляем
    if (this.cache.has(key)) {
      this.cache.delete(key);
    } else if (this.cache.size >= this.maxSize) {
      // Удаляем самый старый элемент (первый в Map)
      const firstKey = this.cache.keys().next().value;
      this.cache.delete(firstKey);
    }

    this.cache.set(key, { value, expiresAt, timestamp: Date.now() });
  }

  /**
   * Проверка наличия ключа
   */
  has(key) {
    const entry = this.cache.get(key);
    if (!entry) return false;

    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return false;
    }

    return true;
  }

  /**
   * Удаление ключа
   */
  delete(key) {
    return this.cache.delete(key);
  }

  /**
   * Очистка всего кэша
   */
  clear() {
    this.cache.clear();
    this.hits = 0;
    this.misses = 0;
  }

  /**
   * Размер кэша
   */
  get size() {
    return this.cache.size;
  }

  /**
   * Очистка устаревших записей
   */
  cleanup() {
    const now = Date.now();
    let cleaned = 0;

    for (const [key, entry] of this.cache.entries()) {
      if (now > entry.expiresAt) {
        this.cache.delete(key);
        cleaned++;
      }
    }

    return cleaned;
  }

  /**
   * Получение статистики
   */
  getStats() {
    const total = this.hits + this.misses;
    return {
      size: this.cache.size,
      maxSize: this.maxSize,
      ttl: this.ttl,
      hits: this.hits,
      misses: this.misses,
      hitRate: total > 0 ? ((this.hits / total) * 100).toFixed(1) + '%' : '0%',
      utilization: ((this.cache.size / this.maxSize) * 100).toFixed(1) + '%'
    };
  }

  /**
   * Получение или установка значения (getOrSet pattern)
   */
  async getOrSet(key, factory, customTTL = null) {
    const cached = this.get(key);
    if (cached !== null) {
      return cached;
    }

    const value = await factory();
    this.set(key, value, customTTL);
    return value;
  }

  /**
   * Множественное получение
   */
  getMany(keys) {
    const result = new Map();
    for (const key of keys) {
      const value = this.get(key);
      if (value !== null) {
        result.set(key, value);
      }
    }
    return result;
  }

  /**
   * Множественная установка
   */
  setMany(entries, customTTL = null) {
    for (const [key, value] of entries) {
      this.set(key, value, customTTL);
    }
  }
}

/**
 * Фабрика для создания кэшей с предустановками
 */
export function createCache(preset = 'default') {
  const presets = {
    default: { maxSize: 100, ttl: 600000 },    // 10 минут
    short: { maxSize: 50, ttl: 60000 },        // 1 минута
    long: { maxSize: 200, ttl: 1800000 },      // 30 минут
    skills: { maxSize: 500, ttl: 600000 },     // 10 минут, больше записей
    database: { maxSize: 50, ttl: 1800000 },   // 30 минут, меньше записей
    employee: { maxSize: 200, ttl: 900000 }    // 15 минут
  };

  const config = presets[preset] || presets.default;
  return new LRUCache(config);
}

/**
 * Глобальные кэши для разных типов данных
 */
const globalCaches = {
  skills: createCache('skills'),
  database: createCache('database'),
  employee: createCache('employee'),
  default: createCache('default')
};

/**
 * Получение глобального кэша по типу
 */
export function getGlobalCache(type = 'default') {
  return globalCaches[type] || globalCaches.default;
}

/**
 * Сброс всех глобальных кэшей
 */
export function clearAllCaches() {
  Object.values(globalCaches).forEach(cache => cache.clear());
  logger.debug('[CACHE] All global caches cleared');
}

/**
 * Получение статистики всех кэшей
 */
export function getAllCacheStats() {
  const stats = {};
  for (const [name, cache] of Object.entries(globalCaches)) {
    stats[name] = cache.getStats();
  }
  return stats;
}

export default LRUCache;